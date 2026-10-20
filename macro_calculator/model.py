import transformers.dynamic_module_utils

transformers.dynamic_module_utils.check_imports = lambda *args, **kwargs: []

from rim_detection import RimDetector
from pipeline import measure_meal

import torch
import numpy as np
from transformers import AutoProcessor, AutoModelForCausalLM
from segment_anything import sam_model_registry, SamPredictor
from depth_estimation import estimate_depth
from object_detection import filter_foods

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

# A container box this close to the whole image is a detection miss, not a real container.
# (Not lower: a big plate can legitimately fill most of a close-up photo.)
MAX_CONTAINER_FRAC = 0.97
MIN_RIM_ARC = 0.5   # rims with less edge support than this are rejected


def box_area(b):
    return (b[2] - b[0]) * (b[3] - b[1])


def run_florence(image, task, text="", max_new_tokens=256):
    inputs = processor(text=task + text, images=image, return_tensors="pt")
    inputs = {
        k: v.to(device, dtype=torch_dtype) if v.is_floating_point() else v.to(device)
        for k, v in inputs.items()
    }
    generated_ids = model.generate(
        input_ids=inputs["input_ids"],
        pixel_values=inputs["pixel_values"],
        max_new_tokens=max_new_tokens,
        num_beams=3,
        early_stopping=False,
        do_sample=False,
        use_cache=True,
    )
    generated_text = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
    return processor.post_process_generation(
        generated_text, task=task, image_size=image.size
    )[task]


def pick_container(image, od_boxes, od_labels):
    """Container boxes from <OD> labels; if none, short open-vocabulary prompts.
    Returns a list with the single largest plausible container (or [])."""
    cands = [b for b, l in zip(od_boxes, od_labels) if is_container(l)]
    if not cands:
        for text in ("plate", "bowl"):                      # one short noun per prompt
            cands = run_florence(image, "<OPEN_VOCABULARY_DETECTION>", text, 128)["bboxes"]
            if cands:
                break
    img_area = image.width * image.height
    cands = [b for b in cands if box_area(b) < MAX_CONTAINER_FRAC * img_area]
    return [{"box": max(cands, key=box_area)}] if cands else []


def getFoodsAndContainers(image):
    image = image.convert("RGB")

    # 1. ONE <OD> pass: objects with labels
    od = run_florence(image, "<OD>")
    parsed_objects = od['bboxes']
    parsed_objects_labels = od['labels']
    print("OD labels:", parsed_objects_labels)

    # Foods: everything that is NOT a container by label, then CLIP removes non-food objects.
    pairs = [(b, l) for b, l in zip(parsed_objects, parsed_objects_labels)]
    
    parsed_food, parsed_food_labels = filter_foods(
        [b for b, _ in pairs], [l for _, l in pairs]
    )
    print(f"Detected {len(parsed_food)} food items:", parsed_food_labels)

    # 2. Container: from <OD> if it found one, else a short open-vocabulary prompt
    containers = pick_container(image, parsed_objects, parsed_objects_labels)
    print("Container boxes:", containers)

    # 3. SAM
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

    print(f"Success! {len(container_masks)} container mask(s) + {len(food_masks)} food pixel masks extracted.")

    return food_masks, container_masks


#  stage 2
def estimateVolume(food_masks, container_masks, image):
    image = image.convert("RGB")

    r = estimate_depth(np.array(image), max_side=768, cache_dir=None)
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

        # NEW: a rim with little edge support is a fit to the wrong edges (e.g. the countertop)
        if rim["arc_coverage"] < MIN_RIM_ARC:
            print(f"Container {i}: rim not reliable (arc={rim['arc_coverage']:.2f}), skipping")
            continue

        # NEW: the user's chosen profile (attached by the server) sets the scale
        profile = container.get("radial_profile") or {}
        containers_in.append({
            "key": f"container_{i}",
            "rim": rim,
            "mask": container["mask"],
            "container_class": "bowl" if "bowl" in str(profile.get("label", "")).lower() else "dinner_plate",
            "known_diameter_m": profile.get("diameter"),
        })

    # NEW: fail with a readable message instead of an index error downstream
    if not containers_in:
        raise ValueError("No plate or bowl with a usable rim was found in the photo.")

    # the largest ellipse sets the scale
    containers_in.sort(key=lambda c: -c["rim"]["major_axis"])

    #SCALE, RECONSTRUCT, ASSIGN, VOLUMES
    result = measure_meal(depth_map, focal_length, containers_in, food_masks)

    print("scale:", result["scale_info"])
    print("unassigned foods:", len(result["unassigned"]))
    print([f["label"] for f in result["unassigned"]])
    print("dropped foods:", result["dropped"])
    return result["foods"]