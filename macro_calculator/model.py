"""Find foods and containers in a meal photo, calibrate a dish, estimate volumes."""
import logging
import os
import threading

import numpy as np
import torch
import transformers.dynamic_module_utils as dmu
from segment_anything import SamPredictor, sam_model_registry
from transformers import AutoModelForCausalLM, AutoProcessor

from models.depth_estimation import estimate_depth
from models.food_segmenter import FoodSegmenter

from profile_estimations.dish_calibration import calibrate_dish, record_from_profile
from profile_estimations.rim_detection import RimDetector

from errors import Cancelled

from pipeline import measure_meal

from food_estimation.food_debug import save_food_debug


log = logging.getLogger(__name__)

CONTAINER_WORDS = {
    "plate", "bowl", "cup", "mug", "glass", "dish", "tray", "platter",
    "container", "pan", "pot", "tableware", "dishware", "kitchenware",
}
MAX_CONTAINER_FRAC = 0.97   # a box this close to the whole image is a detection miss
MIN_RIM_ARC = 0.5           # rims with less edge support are rejected
SEG_LABEL_MIN_CONF = 0.5    # use SegFormer's name only if it is this sure
FOOD_FRACTION_MIN = 0.4     # drop a Florence box that is less than this much food
INSIDE_MIN = 0.6            # SegFormer-only region must lie this much inside the container
ALREADY_FOUND = 0.5         # SegFormer region this covered by Florence foods is a duplicate
MIN_FOOD_PIXELS = 300

# Set DEBUG_RIM_DIR=/some/dir to save rim debug images (unique filename each).
DEBUG_RIM_DIR = os.environ.get("DEBUG_RIM_DIR")
DEBUG_FOOD_DIR = os.environ.get("DEBUG_FOOD_DIR")

# SegFormer class names -> names in foods.csv. Anything not listed is used as-is.
SEG_ALIASES = {
    "chicken duck": "chicken", "hamburg": "hamburger", "french fries": "french fry",
    "fried meat": "meat", "steak": "beef", "noodles": "noodle", "spring onion": "scallion",
}
IGNORE_CLASSES = {"sauce", "other ingredients"}  # a sauce is part of the dish


def _never():
    return False

def _checker(should_stop):
    def check():
        if should_stop():
            raise Cancelled()
    return check

def _area(box):
    return (box[2] - box[0]) * (box[3] - box[1])

def _covered(mask, others):
    """Fraction of `mask` already inside any mask in `others`."""
    if not others:
        return 0.0
    return float((mask & np.any(others, axis=0)).sum()) / max(1, int(mask.sum()))

class MealAnalyzer:
    def __init__(self, segformer_repo=None, hf_token=None, sam_checkpoint="sam_vit_b_01ec64.pth"):
        repo = segformer_repo or os.environ.get("SEGFORMER_REPO", "echen344/foodseg103-segformer-b5")
        if not repo:
            raise RuntimeError("Pass segformer_repo or set SEGFORMER_REPO.")

        if torch.cuda.is_available():
            self.device = torch.device("cuda")
        elif torch.backends.mps.is_available():
            self.device = torch.device("mps")
        else:
            self.device = torch.device("cpu")
        self.dtype = torch.float16 if self.device.type == "cuda" else torch.float32

        # Florence-2's remote code demands flash_attn in an import check even
        # though we use eager attention. Skip that check.
        dmu.check_imports = lambda *a, **k: []
        name = "microsoft/Florence-2-large"
        self.florence_proc = AutoProcessor.from_pretrained(name, trust_remote_code=True)
        self.florence = AutoModelForCausalLM.from_pretrained(
            name, torch_dtype=self.dtype, trust_remote_code=True, attn_implementation="eager",
        ).to(self.device)

        self.segmenter = FoodSegmenter(
            repo=repo, token=hf_token or os.environ.get("HF_TOKEN"), device=self.device,
            min_area_frac=0.004, min_conf=0.35, max_proposals=12,
        )
        log.info("SegFormer classes: %s", sorted(self.segmenter.id2label.values()))

        sam = sam_model_registry["vit_b"](checkpoint=sam_checkpoint).to(device=self.device)
        self.sam = SamPredictor(sam)

        # SamPredictor.set_image() stores state, so serialize all model work.
        self.lock = threading.Lock()

    #  model helpers (caller holds self.lock)
    def _florence(self, image, task, text="", max_new_tokens=256):
        inputs = self.florence_proc(text=task + text, images=image, return_tensors="pt")
        inputs = {k: v.to(self.device, dtype=self.dtype) if v.is_floating_point() else v.to(self.device)
                  for k, v in inputs.items()}
        with torch.inference_mode():
            ids = self.florence.generate(
                input_ids=inputs["input_ids"], pixel_values=inputs["pixel_values"],
                max_new_tokens=max_new_tokens, num_beams=3, do_sample=False, use_cache=True,
            )
        raw = self.florence_proc.batch_decode(ids, skip_special_tokens=False)[0]
        return self.florence_proc.post_process_generation(raw, task=task, image_size=image.size)[task]

    def _sam(self, box=None, point=None):
        """One mask from a box and/or one positive point. set_image() must have been called."""
        kw = {"multimask_output": False}
        if box is not None:
            kw["box"] = np.asarray(box)
        if point is not None:
            kw["point_coords"] = np.asarray([point], dtype=np.float32)
            kw["point_labels"] = np.asarray([1])
        masks, scores, _ = self.sam.predict(**kw)
        return masks[0], float(scores[0])

    @staticmethod
    def _depth(image):
        r = estimate_depth(np.array(image), max_side=768, cache_dir=None)
        return r["depth"], r["focal_px"]

    @staticmethod
    def _is_container(label):
        words = label.lower().replace("-", " ").split()
        return bool(words) and words[-1] in CONTAINER_WORDS

    def _find_container_box(self, image, od):
        """Largest plausible container box, or None."""
        boxes = [b for b, l in zip(od["bboxes"], od["labels"]) if self._is_container(l)]
        for text in ("plate", "bowl"):          # fallback: one short noun per prompt
            if boxes:
                break
            boxes = self._florence(image, "<OPEN_VOCABULARY_DETECTION>", text, 128)["bboxes"]
        limit = MAX_CONTAINER_FRAC * image.width * image.height
        boxes = [b for b in boxes if _area(b) < limit]
        return max(boxes, key=_area) if boxes else None

    # public API 
    def calibrate_dish(self, image, diameter_m, measured_depth_mm=None, should_stop=_never):
        """Photo of an EMPTY dish -> (record, warnings). Raises ValueError for the user."""
        check = _checker(should_stop)
        image = image.convert("RGB")

        with self.lock:
            check()
            box = self._find_container_box(image, self._florence(image, "<OD>"))
            if box is None:
                raise ValueError("Could not find the dish. Photograph it from above, "
                                 "filling most of the frame.")
            self.sam.set_image(np.array(image))
            mask, _ = self._sam(box=box)
            check()
            depth, focal = self._depth(image)

        rim = RimDetector().detect(image=image, container_box=box, container_mask=mask, depth=depth)
        if rim is None or rim["arc_coverage"] < MIN_RIM_ARC:
            raise ValueError("The rim was not clearly visible. Use a plain surface and good light.")

        check()
        return calibrate_dish(depth, rim["ellipse_params"], mask, diameter_m * 1000.0, focal,
                              measured_depth_mm=measured_depth_mm)

    def find_foods_and_containers(self, image, should_stop=_never):
        """Stage 1: photo -> (foods, container_masks)."""
        check = _checker(should_stop)
        image = image.convert("RGB")

        with self.lock:
            od = self._florence(image, "<OD>")
            check()
            log.info("OD labels: %s", od["labels"])
            box = self._find_container_box(image, od)

            probs = self.segmenter.probs(image)     # one pass over the whole photo
            check()
            self.sam.set_image(np.array(image))

            containers = []
            if box is not None:
                mask, score = self._sam(box=box)
                containers.append({"box": box, "mask": mask, "score": score})
            container_union = np.any([c["mask"] for c in containers], axis=0) if containers else None

            foods = []

            # 1. Florence detections: outline each, keep it only if SegFormer says food, name it.
            for b, label in zip(od["bboxes"], od["labels"]):
                if self._is_container(label):
                    continue
                check()
                mask, score = self._sam(box=b)
                if int(mask.sum()) < MIN_FOOD_PIXELS:
                    continue
                if self.segmenter.food_fraction(probs, mask) < FOOD_FRACTION_MIN:
                    log.info("dropped %r: mostly not food", label)
                    continue
                seg_label, conf = self.segmenter.label_mask(probs, mask)
                trusted = seg_label and conf >= SEG_LABEL_MIN_CONF \
                    and seg_label.lower() not in IGNORE_CLASSES
                foods.append({
                    "box": b, "mask": mask, "score": score,
                    "label": self._normalize(seg_label) if trusted else label,
                    "detector_label": label, "label_conf": conf, "source": "florence",
                })

            # 2. Food regions SegFormer sees that Florence missed.
            for p in self.segmenter.propose(probs, image.width, image.height):
                check()
                if p["class_name"].lower() in IGNORE_CLASSES:
                    continue
                mask, score = self._sam(box=p["box"], point=p["point"])
                area = int(mask.sum())
                if area < MIN_FOOD_PIXELS:
                    continue
                if container_union is not None and (mask & container_union).sum() / area < INSIDE_MIN:
                    continue                        # not on the plate: a counter, a hand
                if _covered(mask, [f["mask"] for f in foods]) > ALREADY_FOUND:
                    continue
                foods.append({
                    "box": [float(v) for v in p["box"]], "mask": mask, "score": score,
                    "label": self._normalize(p["class_name"]),
                    "detector_label": None, "label_conf": None, "source": "segformer",
                })
                
        if DEBUG_FOOD_DIR:
            try:
                save_food_debug(DEBUG_FOOD_DIR, image, od, probs, foods, containers, self)
            except Exception:
                log.exception("food debug images failed")

        log.info("foods: %s", [(f["label"], f["source"]) for f in foods])
        return foods, containers

    @staticmethod
    def _normalize(name):
        key = str(name).lower().strip().replace("_", " ")
        return SEG_ALIASES.get(key, key)

    @staticmethod
    def _save_rim_debug(detector, image, rim, i):
        os.makedirs(DEBUG_RIM_DIR, exist_ok=True)
        path = os.path.join(DEBUG_RIM_DIR, f"rim_debug_{os.getpid()}_{id(image)}_{i}.jpg")
        detector.draw_result(image, rim).save(path)

    def estimate_volume(self, food_masks, container_masks, image, should_stop=_never):
        """Stage 2. container_masks may carry a "radial_profile" (set by server.py)."""
        check = _checker(should_stop)
        image = image.convert("RGB")

        check()
        with self.lock:
            depth, focal = self._depth(image)

        detector = RimDetector()
        containers_in = []
        for i, c in enumerate(container_masks):
            rim = detector.detect(image=image, container_box=c["box"],
                                  container_mask=c["mask"], depth=depth)
            if rim is None:
                log.info("Container %d: no rim found, skipping", i)
                continue
            log.info("Container %d: valid=%s conf=%.2f arc=%.2f",
                     i, rim["valid"], rim["confidence"], rim["arc_coverage"])
            if DEBUG_RIM_DIR:
                self._save_rim_debug(detector, image, rim, i)
            if rim["arc_coverage"] < MIN_RIM_ARC:
                log.info("Container %d: rim not reliable, skipping", i)
                continue

            profile = c.get("radial_profile") or {}
            containers_in.append({
                "key": f"container_{i}",
                "rim": rim,
                "mask": c["mask"],
                "container_class": "bowl" if "bowl" in str(profile.get("label", "")).lower()
                                   else "dinner_plate",
                "known_diameter_m": profile.get("diameter"),
                "shape_record": record_from_profile(profile) if profile else None,
            })

        if not containers_in:
            raise ValueError("No plate or bowl with a usable rim was found in the photo.")

        containers_in.sort(key=lambda c: -c["rim"]["major_axis"])   # largest ellipse sets scale
        result = measure_meal(depth, focal, containers_in, food_masks)
        log.info("scale=%s unassigned=%d dropped=%s", result["scale_info"],
                 len(result["unassigned"]), result["dropped"])
        return result["foods"]