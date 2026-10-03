import numpy as np
from scipy.ndimage import binary_erosion
from container_estimation import to_dish_coordinates, evaluate_profile, depth_to_3d


def evaluate_food_container(food_points, reconstruction, food_pixels=None,
                            tol_frac=0.03, max_height_frac=1.0):
    """
    Relate one food's camera-frame points to ONE container. No volume is
    computed here; calculate_food_volume does that from the returned arrays.
    """
    K = reconstruction["K"]
    profile = reconstruction["profile"]
    R = profile["rim_radius"]
    tol = tol_frac * R

    local = to_dish_coordinates(food_points, reconstruction["center"],
                                reconstruction["basis"])
    r = np.hypot(local[:, 0], local[:, 1])
    height = local[:, 2] - evaluate_profile(profile, np.minimum(r, R))

    # Footprint of each pixel on the dish's horizontal plane
    d = food_points / np.linalg.norm(food_points, axis=1, keepdims=True)
    pix_area = food_points[:, 2] ** 2 / (K[0, 0] * K[1, 1])
    area = pix_area * np.abs(d[:, 2]) / np.maximum(np.abs(d @ reconstruction["axis"]), 1e-3)

    # Inside this container: within the rim laterally and at a plausible height
    # (not far below the bowl surface, not absurdly high above it).
    inside = (r <= R) & (height > -tol) & (height < max_height_frac * R)

    pixels = None if food_pixels is None else np.asarray(food_pixels)
    return {
        "contained_fraction": area[inside].sum() / max(area.sum(), 1e-12),
        "inside_mask": inside,
        "food_points": local[inside],          # dish frame
        "food_heights": np.clip(height[inside], 0, None),
        "food_areas": area[inside],
        "food_pixels": None if pixels is None else pixels[inside],
    }


def assign_food_to_container(food_points, reconstructions, food_pixels=None,
                             min_fraction=0.5):
    """
    reconstructions: {container_key: reconstruction}. Returns (key, evaluation)
    for the container holding the largest share of the food, or ("None", None)
    if no container holds at least min_fraction of it.
    """
    best_key, best_eval = "None", None
    best_frac = min_fraction
    for key, rec in reconstructions.items():
        if key == "None":
            continue
        ev = evaluate_food_container(food_points, rec, food_pixels)
        if ev["contained_fraction"] >= best_frac:
            best_key, best_eval, best_frac = key, ev, ev["contained_fraction"]
    return best_key, best_eval


def mask_to_points(mask, depth_map, K, erode_px=0):
    """Food mask -> (camera-frame points, pixels), one per valid masked pixel."""
    m = mask > 0
    if erode_px:
        m = binary_erosion(m, iterations=erode_px)   # trims depth bleed at the edge
    v, u = np.where(m & np.isfinite(depth_map) & (depth_map > 0))
    pixels = np.column_stack([u, v])
    return depth_to_3d(pixels, depth_map[v, u], K), pixels


def assign_foods(foods, reconstructions, depth_map, min_fraction=0.5, erode_px=0):
    """
    foods: list of dicts, each with at least "mask" (and usually "label").
    reconstructions: {container_key: reconstruction}, all from the same image.

    Each food is assigned to its best container. Returns the foods as new dicts
    carrying the original info plus:
        container  key of the assigned container ("None" if none fits)
        eval       evaluation dict from evaluate_food_container (None if "None")
        contained_fraction
    Foods are also stored in reconstructions[key]["foods"], which is what
    calculate_volumes reads. Unassigned foods go under reconstructions["None"].
    """
    real = {k: r for k, r in reconstructions.items() if k != "None"}
    for rec in reconstructions.values():
        rec["foods"] = []                      # makes repeated calls safe
    reconstructions.setdefault("None", {"foods": []})

    results = []
    if not real:
        K = None
    else:
        K = next(iter(real.values()))["K"]     # same camera for every container

    for food in foods:
        entry = dict(food)
        key, ev = "None", None
        if K is not None:
            points, pixels = mask_to_points(food["mask"], depth_map, K, erode_px)
            if len(points) >= 4:
                key, ev = assign_food_to_container(points, real, pixels, min_fraction)
        entry["container"] = key
        entry["eval"] = ev
        entry["contained_fraction"] = None if ev is None else ev["contained_fraction"]
        reconstructions[key]["foods"].append(entry)
        results.append(entry)
    return results