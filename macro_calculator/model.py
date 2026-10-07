import transformers.dynamic_module_utils

transformers.dynamic_module_utils.check_imports = lambda *args, **kwargs: []

from rim_detection import RimDetector
from pipeline import measure_meal

import torch
import numpy as np
from PIL import Image
from PIL.ExifTags import TAGS
from transformers import AutoProcessor, AutoModelForCausalLM, AutoImageProcessor, AutoModelForDepthEstimation, DepthProForDepthEstimation, DepthProImageProcessor
from segment_anything import sam_model_registry, SamPredictor
from depth_estimation import estimate_depth

#FIND FOOD AND SEGMENTATION
device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
torch_dtype = torch.float16 if torch.cuda.is_available() else torch.float32

processor = AutoProcessor.from_pretrained("microsoft/Florence-2-large", trust_remote_code=True)
model = AutoModelForCausalLM.from_pretrained("microsoft/Florence-2-large", torch_dtype=torch_dtype, trust_remote_code=True, attn_implementation="eager").to(device)

model_type = "vit_b"
checkpoint_path = "sam_vit_b_01ec64.pth"

sam = sam_model_registry[model_type](checkpoint=checkpoint_path)
sam.to(device=device)

predictor = SamPredictor(sam)

depth_processor = AutoImageProcessor.from_pretrained("depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf")
depth_model = AutoModelForDepthEstimation.from_pretrained("depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf").to(device)

def getFoodsAndContainers(path):
    image = Image.open(path).convert("RGB")

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

    containers =  [{ "box": box } for box in data["bboxes"]]

    print("Container boxes:", containers)

    # 3. INITIALIZE SAM AND FEED EVERYTHING IN
    print(f"Using device: {device}")

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

def estimateVolume(food_masks, container_masks, path, plate_diameter_m=None):
    #DEPTH  (pass the PIL image, not the filename)
    image = Image.open(path).convert("RGB")

    r = estimate_depth(path, max_side=768, cache_dir=".depth_cache")
    depth_map, focal_length = r["depth"], r["focal_px"]
    print(depth_map.shape, np.nanmin(depth_map), np.nanmax(depth_map), focal_length)

    #RIMS
    rim_detector = RimDetector()
    containers_in = []
    for i, container in enumerate(container_masks):
        rim = rim_detector.detect(image=image,
                                container_box=container["box"],
                                container_mask=container["mask"],
                                depth=depth_map)
        if rim is None:
            print(f"Container {i}: no rim found, skipping")
            continue
        print(f"Container {i}: valid={rim['valid']} conf={rim['confidence']:.2f} "
            f"arc={rim['arc_coverage']:.2f}")
        rim_detector.draw_result(image, rim).save(f"rim_debug_{i}.jpg")

        containers_in.append({
            "key": f"container_{i}",
            "rim": rim,
            "mask": container["mask"],
            "container_class": "dinner_plate",
            "known_diameter_m": plate_diameter_m,     # new argument, None = class prior
        })

    # the largest ellipse sets the scale
    containers_in.sort(key=lambda c: -c["rim"]["major_axis"])

    #SCALE, RECONSTRUCT, ASSIGN, VOLUMES
    result = measure_meal(depth_map, focal_length, containers_in, food_masks)

    print("scale:", result["scale_info"])
    print("unassigned foods:", len(result["unassigned"]))
    print("dropped foods:", result["dropped"])
    return result["foods"]


foods, containers = getFoodsAndContainers("yumgrub.jpg")
volumes = estimateVolume(foods, containers, "yumgrub.jpg")