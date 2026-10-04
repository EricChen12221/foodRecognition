"""
End-to-end measurement with scale calibration.

Uses your repo's module names. Order of operations:
  1. calibrate: reconstruct once on the raw depth, choose a scale from the plate
     (user size > class prior), and scale the depth map.
  2. reconstruct every container on the SCALED depth.
  3. assign each food mask to its best container (scaled depth too).
  4. volumes (ml) with ranges from the scale uncertainty, written onto each food dict.
"""
import numpy as np

from container_estimation import reconstruct_dish
from food_alignment import assign_foods
from calculate_volume import calculate_food_volume
from calibration import calibrate, volume_range


def dedupe_foods(foods, containment=0.4, iou_thresh=0.8):
    """
    Drop masks that would double count food:
      * merged masks: a big mask whose area is mostly covered (> containment) by
        two or more smaller masks with the same label;
      * near duplicates: same label, IoU > iou_thresh (keep the higher score).
    Returns (kept, dropped).
    """
    masks = [np.asarray(f["mask"]) > 0 for f in foods]
    areas = [int(m.sum()) for m in masks]
    keep = [a > 0 for a in areas]

    for i in sorted(range(len(foods)), key=lambda k: -areas[k]):      # big masks first
        if not keep[i]:
            continue
        smaller = [j for j in range(len(foods))
                   if j != i and keep[j] and areas[j] < areas[i]
                   and foods[j].get("label") == foods[i].get("label")]
        if len(smaller) >= 2:
            union = np.zeros_like(masks[i])
            for j in smaller:
                union |= masks[j]
            if (masks[i] & union).sum() / areas[i] > containment:
                keep[i] = False

    for i in range(len(foods)):
        for j in range(i + 1, len(foods)):
            if keep[i] and keep[j] and foods[i].get("label") == foods[j].get("label"):
                inter = (masks[i] & masks[j]).sum()
                union = areas[i] + areas[j] - inter
                if union and inter / union > iou_thresh:
                    drop = j if float(foods[i].get("score", 0)) >= float(foods[j].get("score", 0)) else i
                    keep[drop] = False

    kept = [f for f, k in zip(foods, keep) if k]
    dropped = [f for f, k in zip(foods, keep) if not k]
    return kept, dropped


def measure_meal(depth_map, focal_px, containers, food_masks, food_labels=None,
                 reference=0, dedupe=True):
    """
    depth_map:   (H, W) depth from estimate_depth (NaN allowed)
    focal_px:    focal length in pixels from estimate_depth
    containers:  list of dicts, one per container:
                   {"key": any hashable,
                    "rim": result of RimDetector.detect(...),
                    "mask": boolean container mask (full image),
                    "container_class": "dinner_plate" | "bowl" | ...,
                    "known_diameter_m": optional, user-confirmed outer diameter}
    food_masks:  either your list of dicts ({'mask':..., 'label':..., ...}) or a list of
                 boolean masks together with food_labels
    reference:   index of the container used to set the scale (one scale per image)
    """
    if food_masks and isinstance(food_masks[0], dict):
        foods = [dict(f) for f in food_masks]
    else:
        foods = [{"label": l, "mask": m} for l, m in zip(food_labels, food_masks)]

    dropped = []
    if dedupe:
        foods, dropped = dedupe_foods(foods)

    food_union = np.zeros(depth_map.shape[:2], dtype=bool)
    for f in foods:
        food_union |= np.asarray(f["mask"]) > 0

    # 1. scale from the reference container
    ref = containers[reference]
    scaled_depth, info = calibrate(
        depth_map, ref["rim"]["ellipse_params"], ref["mask"], food_union, focal_px,
        container_class=ref.get("container_class", "dinner_plate"),
        known_diameter_m=ref.get("known_diameter_m"))

    # 2. every container, on the scaled depth
    reconstructions = {}
    for c in containers:
        reconstructions[c["key"]] = reconstruct_dish(
            scaled_depth, c["rim"]["ellipse_params"], c["mask"], food_union, focal_px)

    # 3. foods -> containers (the scaled depth must be used here too)
    assigned = assign_foods(foods, reconstructions, scaled_depth)

    # 4. attach volumes to the SAME food dicts (label, box, mask, score are kept)
    u = info["rel_uncertainty"]
    for food in assigned:
        if food["eval"] is None:                       # not inside any container
            food["volume_ml"] = food["volume_ml_low"] = food["volume_ml_high"] = None
            continue
        vol_ml = calculate_food_volume(food["eval"], food.get("mask")) * 1e6
        food["volume_ml"] = vol_ml
        food["volume_ml_low"], food["volume_ml_high"] = volume_range(vol_ml, u)

    return {
        "foods": assigned,                  # one dict per input food, original order
        "unassigned": [f for f in assigned if f["container"] == "None"],
        "dropped": dropped,                 # duplicate / merged masks removed before measuring
        "scale_info": info,                 # scale, source, rel_uncertainty
        "depth": scaled_depth,
        "reconstructions": reconstructions,
    }