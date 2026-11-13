import transformers.dynamic_module_utils

# Florence-2's remote code does an import check that demands flash_attn even
# though we run with attn_implementation="eager". Skip that check.
transformers.dynamic_module_utils.check_imports = lambda *args, **kwargs: []

import logging
import os
import threading

import numpy as np
import torch
from transformers import (
    AutoModelForCausalLM,
    AutoProcessor,
    SegformerForSemanticSegmentation,
    SegformerImageProcessor,
)
from segment_anything import sam_model_registry, SamPredictor

from rim_detection import RimDetector
from pipeline import measure_meal
from errors import Cancelled
from dish_calibration import calibrate_dish, record_from_profile
from depth_estimation import estimate_depth
from classifier import filter_foods

log = logging.getLogger(__name__)

# ---------------------------------------------------------------- device
if torch.cuda.is_available():
    device = torch.device("cuda")
elif torch.backends.mps.is_available():
    device = torch.device("mps")
else:
    device = torch.device("cpu")

florence_dtype = torch.float16 if device.type == "cuda" else torch.float32

# ---------------------------------------------------------------- models
# Florence-2: object detection / open-vocabulary detection
florence_proc = AutoProcessor.from_pretrained(
    "microsoft/Florence-2-large", trust_remote_code=True
)
florence = AutoModelForCausalLM.from_pretrained(
    "microsoft/Florence-2-large",
    torch_dtype=florence_dtype,
    trust_remote_code=True,
    attn_implementation="eager",
).to(device)

# SegFormer (private HF repo). NOTE: not used by any function below yet.
# Delete this block if you don't plan to use it, it costs a lot of memory.
SEG_REPO = "echen344/foodseg103-segformer-b5"
HF_TOKEN = os.environ.get("HF_TOKEN")
if not HF_TOKEN:
    raise RuntimeError("HF_TOKEN is not set")
seg_proc = SegformerImageProcessor.from_pretrained(SEG_REPO, token=HF_TOKEN)
seg_model = (
    SegformerForSemanticSegmentation.from_pretrained(SEG_REPO, token=HF_TOKEN)
    .to(device)
    .eval()
)

# SAM
sam = sam_model_registry["vit_b"](checkpoint="sam_vit_b_01ec64.pth")
sam.to(device=device)
predictor = SamPredictor(sam)

# SamPredictor.set_image() stores state on the predictor, so concurrent
# requests would corrupt each other. Serialize all GPU/model work.
_model_lock = threading.Lock()

# config
CONTAINER_WORDS = {
    "plate", "bowl", "cup", "mug", "glass", "dish", "tray", "platter",
    "container", "pan", "pot", "tableware", "dishware", "kitchenware",
}

# A container box this close to the whole image is a detection miss, not a real
# container. (Not lower: a big plate can legitimately fill most of a close-up.)
MAX_CONTAINER_FRAC = 0.97
MIN_RIM_ARC = 0.5  # rims with less edge support than this are rejected

# Set DEBUG_RIM_DIR=/some/dir to save rim debug images (unique filename each).
DEBUG_RIM_DIR = os.environ.get("DEBUG_RIM_DIR")


# helpers
def is_container(label):
    words = label.lower().replace("-", " ").split()
    return bool(words) and words[-1] in CONTAINER_WORDS


def box_area(b):
    return (b[2] - b[0]) * (b[3] - b[1])


def segment_box(box):
    """SAM: one box in -> (mask, score) out. Caller must have called set_image."""
    masks, scores, _ = predictor.predict(box=np.asarray(box), multimask_output=False)
    return masks[0], scores[0]


def run_florence(image, task, text="", max_new_tokens=256):
    inputs = florence_proc(text=task + text, images=image, return_tensors="pt")
    inputs = {
        k: v.to(device, dtype=florence_dtype) if v.is_floating_point() else v.to(device)
        for k, v in inputs.items()
    }
    with torch.inference_mode():
        generated_ids = florence.generate(
            input_ids=inputs["input_ids"],
            pixel_values=inputs["pixel_values"],
            max_new_tokens=max_new_tokens,
            num_beams=3,
            early_stopping=False,
            do_sample=False,
            use_cache=True,
        )
    generated_text = florence_proc.batch_decode(
        generated_ids, skip_special_tokens=False
    )[0]
    return florence_proc.post_process_generation(
        generated_text, task=task, image_size=image.size
    )[task]


def pick_container(image, od_boxes, od_labels):
    """Container boxes from <OD> labels; if none, short open-vocabulary prompts.
    Returns a list with the single largest plausible container (or [])."""
    cands = [b for b, l in zip(od_boxes, od_labels) if is_container(l)]
    if not cands:
        for text in ("plate", "bowl"):  # one short noun per prompt
            cands = run_florence(image, "<OPEN_VOCABULARY_DETECTION>", text, 128)["bboxes"]
            if cands:
                break
    img_area = image.width * image.height
    cands = [b for b in cands if box_area(b) < MAX_CONTAINER_FRAC * img_area]
    return [{"box": max(cands, key=box_area)}] if cands else []


def _make_check(should_stop):
    def check():
        if should_stop():
            raise Cancelled()
    return check


# calibration
def calibrateDish(image, diameter_m, measured_depth_mm=None, should_stop=lambda: False):
    """Photo of an EMPTY dish -> (record, warnings).
    Raises ValueError with a message for the user."""
    check = _make_check(should_stop)
    image = image.convert("RGB")

    with _model_lock:
        check()
        od = run_florence(image, "<OD>")
        check()

        containers = pick_container(image, od["bboxes"], od["labels"])
        if not containers:
            raise ValueError(
                "Could not find the dish. Photograph it from above, filling most of the frame."
            )
        box = containers[0]["box"]

        predictor.set_image(np.array(image))
        mask, _ = segment_box(box)

        check()
        r = estimate_depth(np.array(image), max_side=768, cache_dir=None)
        depth_map, focal = r["depth"], r["focal_px"]

    rim = RimDetector().detect(
        image=image, container_box=box, container_mask=mask, depth=depth_map
    )
    if rim is None or rim["arc_coverage"] < MIN_RIM_ARC:
        raise ValueError("The rim was not clearly visible. Use a plain surface and good light.")

    check()
    return calibrate_dish(
        depth_map, rim["ellipse_params"], mask, diameter_m * 1000.0, focal,
        measured_depth_mm=measured_depth_mm,
    )


# stage 1
def getFoodsAndContainers(image, should_stop=lambda: False):
    check = _make_check(should_stop)
    image = image.convert("RGB")

    with _model_lock:
        # 1. ONE <OD> pass: objects with labels
        check()
        od = run_florence(image, "<OD>")
        boxes, labels = od["bboxes"], od["labels"]
        log.info("OD labels: %s", labels)

        # Foods: CLIP-based filter removes non-food objects (and containers).
        food_boxes, food_labels = filter_foods(list(boxes), list(labels))
        log.info("Detected %d food items: %s", len(food_boxes), food_labels)

        # 2. Container: from <OD> if found, else short open-vocabulary prompt
        check()
        containers = pick_container(image, boxes, labels)
        log.info("Container boxes: %s", containers)

        # 3. SAM
        log.info("Using device: %s", device)
        predictor.set_image(np.array(image))

        # Container masks (for ellipse fitting / volume baseline)
        container_masks = []
        for container in containers:
            check()
            mask, score = segment_box(container["box"])
            container_masks.append(
                {"box": container["box"], "mask": mask, "score": score}
            )

        # Food masks (for per-item volume / macro workflows)
        food_masks = []
        for i, box in enumerate(food_boxes):
            check()
            mask, score = segment_box(box)
            food_masks.append(
                {"id": i, "box": box, "mask": mask, "score": score, "label": food_labels[i]}
            )

    log.info(
        "Extracted %d container mask(s) + %d food mask(s)",
        len(container_masks), len(food_masks),
    )
    return food_masks, container_masks


# stage 2
def estimateVolume(food_masks, container_masks, image, should_stop=lambda: False):
    """container_masks may carry a "radial_profile" (set by server.py from the client)."""
    check = _make_check(should_stop)
    image = image.convert("RGB")

    check()
    with _model_lock:
        r = estimate_depth(np.array(image), max_side=768, cache_dir=None)
    depth_map, focal_length = r["depth"], r["focal_px"]
    log.info(
        "depth %s min=%s max=%s focal=%s",
        depth_map.shape, np.nanmin(depth_map), np.nanmax(depth_map), focal_length,
    )

    # RIMS
    rim_detector = RimDetector()
    containers_in = []
    for i, container in enumerate(container_masks):
        rim = rim_detector.detect(
            image=image,
            container_box=container["box"],
            container_mask=container["mask"],
            depth=depth_map,
        )
        if rim is None:
            log.info("Container %d: no rim found, skipping", i)
            continue
        log.info(
            "Container %d: valid=%s conf=%.2f arc=%.2f",
            i, rim["valid"], rim["confidence"], rim["arc_coverage"],
        )

        if DEBUG_RIM_DIR:
            os.makedirs(DEBUG_RIM_DIR, exist_ok=True)
            path = os.path.join(DEBUG_RIM_DIR, f"rim_debug_{os.getpid()}_{id(image)}_{i}.jpg")
            rim_detector.draw_result(image, rim).save(path)

        if rim["arc_coverage"] < MIN_RIM_ARC:
            log.info("Container %d: rim not reliable (arc=%.2f), skipping", i, rim["arc_coverage"])
            continue

        profile = container.get("radial_profile") or {}
        shape_record = record_from_profile(profile)
        log.info(
            "Container %d: dish shape %s", i,
            "from calibration" if shape_record else "not calibrated (fitted)",
        )

        containers_in.append({
            "key": f"container_{i}",
            "rim": rim,
            "mask": container["mask"],
            "container_class": "bowl" if "bowl" in str(profile.get("label", "")).lower() else "dinner_plate",
            "known_diameter_m": profile.get("diameter"),
            "shape_record": shape_record,
        })

    if not containers_in:
        raise ValueError("No plate or bowl with a usable rim was found in the photo.")

    # the largest ellipse sets the scale
    containers_in.sort(key=lambda c: -c["rim"]["major_axis"])

    # SCALE, RECONSTRUCT, ASSIGN, VOLUMES
    result = measure_meal(depth_map, focal_length, containers_in, food_masks)

    log.info("scale: %s", result["scale_info"])
    log.info("unassigned foods: %d %s", len(result["unassigned"]),
             [f["label"] for f in result["unassigned"]])
    log.info("dropped foods: %s", result["dropped"])
    return result["foods"]