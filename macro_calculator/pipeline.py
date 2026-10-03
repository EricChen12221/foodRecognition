import numpy as np
 
from container_estimation import reconstruct_dish
from food_alignment import assign_foods
from calculate_volume import calculate_food_volume
from calibration import calibrate, volume_range
 
 
def measure_meal(depth_map, focal_px, containers, food_masks, food_labels=None,
                 reference=0):
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
        "scale_info": info,                 # scale, source, rel_uncertainty
        "depth": scaled_depth,
        "reconstructions": reconstructions,
    }