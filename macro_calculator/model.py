import transformers.dynamic_module_utils

transformers.dynamic_module_utils.check_imports = lambda *args, **kwargs: []

from rim_detection import RimDetector
from container_estimation import reconstruct_dish
from food_alignment import associate_foods
from calculate_volume import calculate_volumes

import torch
import numpy as np
from PIL import Image
from transformers import AutoProcessor, AutoModelForCausalLM, AutoImageProcessor, AutoModelForDepthEstimation, DepthProForDepthEstimation, DepthProImageProcessor
from segment_anything import sam_model_registry, SamPredictor

#FIND FOOD AND SEGMENTATION
device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
torch_dtype = torch.float16 if torch.cuda.is_available() else torch.float32

processor = AutoProcessor.from_pretrained("microsoft/Florence-2-large", trust_remote_code=True)
model = AutoModelForCausalLM.from_pretrained("microsoft/Florence-2-large", dtype=torch_dtype, trust_remote_code=True, attn_implementation="eager").to(device)

image_path = "yumgrub.jpg"
image = Image.open(image_path).convert("RGB")

# 1. PASS 1: Get Food Bounding Boxes via standard 
prompt = '<OD>'

inputs = processor(text=prompt, images=image, return_tensors="pt")

inputs = {
    k: v.to(device, dtype=torch_dtype) if v.is_floating_point() else v.to(device)
    for k, v in inputs.items()
}

generated_ids = model.generate(
    input_ids=inputs["input_ids"],
    pixel_values=inputs["pixel_values"],
    max_new_tokens=1024,
    do_sample=False,
    use_cache=False
)

generated_text = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
parsed_answer = processor.post_process_generation(generated_text, task=prompt, image_size=image.size)

parsed_food = parsed_answer['<OD>']['bboxes']
parsed_food_labels = parsed_answer['<OD>']['labels']
print(f"Detected {len(parsed_food)} food items")

# 2. PASS 2: Get Container Bounding Box
def detect_containers(image):
    task = "<OPEN_VOCABULARY_DETECTION>"
    text = "plate, bowl, cup, dish, or container containing food"

    prompt = task + text

    inputs = processor(text=prompt, images=image, return_tensors="pt")

    inputs = {
        k: v.to(device, dtype=torch_dtype) if v.is_floating_point() else v.to(device)
        for k, v in inputs.items()
    }

    generated_ids = model.generate(
        input_ids=inputs["input_ids"],
        pixel_values=inputs["pixel_values"],
        max_new_tokens=1024,
        do_sample=False,
        use_cache=False
    )

    generated_text = processor.batch_decode(
        generated_ids,
        skip_special_tokens=False
    )[0]

    result = processor.post_process_generation(
        generated_text,
        task=task,
        image_size=image.size
    )

    data = result["<OPEN_VOCABULARY_DETECTION>"]
    print(data)

    return [{ "box": box } for box in data["bboxes"]]


containers = detect_containers(image)

print("Container boxes:", containers)

# 3. INITIALIZE SAM AND FEED EVERYTHING IN
print(f"Using device: {device}")

model_type = "vit_b"
checkpoint_path = "sam_vit_b_01ec64.pth"

sam = sam_model_registry[model_type](checkpoint=checkpoint_path)
sam.to(device=device)

predictor = SamPredictor(sam)
image_rgb = np.array(image)
predictor.set_image(image_rgb)

# Get precise mask for the container (for ellipse fitting / volume baseline)
container_masks = []

for container in containers:
    box = np.array(container["box"])

    masks, scores, _ = predictor.predict(
        box=box,
        multimask_output=False
    )

    container_masks.append({
        "box": container["box"],
        "mask": masks[0],
        "score": scores[0]
    })

# Get precise masks for every food item (for individual macro crop-and-caption workflows)
food_masks = []
for i, box in enumerate(parsed_food):
    masks, scores, _ = predictor.predict(box=np.array(box), multimask_output=False)
    food_masks.append({
        'box': box,
        'mask': masks[0],
        'score': scores[0],
        'label': parsed_food_labels[i]
    })

print(f"Success! Container mask generated + {len(food_masks)} food pixel masks extracted.")


#DEPTH

#depth_processor = DepthProImageProcessor.from_pretrained("apple/DepthPro-hf")
#depth_model = DepthProForDepthEstimation.from_pretrained("apple/DepthPro-hf").to(device=device)

depth_processor = AutoImageProcessor.from_pretrained("depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf")

depth_model = AutoModelForDepthEstimation.from_pretrained("depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf").to(device)

image = Image.open("yumgrub.jpg").convert("RGB")

def get_depth(image):
    inputs = depth_processor(images=image, return_tensors="pt").to(device)

    with torch.no_grad():
        outputs = depth_model(**inputs)

    result = depth_processor.post_process_depth_estimation(
        outputs,
        target_sizes=[(image.height, image.width)])[0]

    depth = result["predicted_depth"].detach().cpu().numpy()

    #focal_length = result["focal_length"].item()

    #return depth, focal_length

    return depth


#depth_map, focal_length = get_depth(image)
depth_map = get_depth(image)
print(depth_map.shape)
print(depth_map.min(), depth_map.max())

#COMBINE DEPTH AND CONTAINER SEGMENTATION TO ESTIMATE CAMERA PERSPECTIVE
reconstructed_containers = {}
rim_detector = RimDetector()
food_mask = np.any(np.array([food["mask"] for food in food_masks]), axis=0)

for container in container_masks:
    rim = rim_detector.detect(
        image=image,
        container_box=container["box"],
        container_mask=container["mask"],
        depth=depth_map,
    )

    rim_detector.draw_result(image, rim)

    (cx, cy), (major_axis, minor_axis), angle = rim["ellipse"]
    ellipse = (cx, cy, major_axis / 2, minor_axis / 2, angle)

    reconstruction = reconstruct_dish(
        depth_map=depth_map,
        ellipse=ellipse,
        container_mask=container["mask"],
        food_mask=food_mask,
        #focal_length=focal_length
    )

    reconstructed_containers[tuple(reconstruction["center"])] = reconstruction

#Associate foods with containers
reconstructed_containers, unassociated_foods = associate_foods(food_masks, reconstructed_containers, depth_map)

calculate_volumes(reconstructed_containers)