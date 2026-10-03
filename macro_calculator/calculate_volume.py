import numpy as np


def calculate_food_volume(evaluation, food_mask=None, method="area", max_area_ratio=4.0):
    """
    method="area": sum(height * per-point footprint area) from evaluate_food_container.
    method="jacobian": footprint from finite differences of dish-plane x/y over the
    pixel grid. Needs food_pixels and food_mask, and drops pixels with a missing
    neighbour or a depth jump (area > max_area_ratio * median).
    """
    points = evaluation["food_points"]
    heights = evaluation["food_heights"]
    if len(points) < 4:
        return 0.0

    if method == "area":
        return float(np.sum(heights * evaluation["food_areas"]))

    pixels = evaluation["food_pixels"].astype(int)
    H, W = food_mask.shape
    u, v = pixels[:, 0], pixels[:, 1]

    x_map = np.full((H, W), np.nan); y_map = np.full((H, W), np.nan)
    h_map = np.full((H, W), np.nan)
    x_map[v, u] = points[:, 0]; y_map[v, u] = points[:, 1]; h_map[v, u] = heights

    dx_du = np.full((H, W), np.nan); dy_du = np.full((H, W), np.nan)
    dx_dv = np.full((H, W), np.nan); dy_dv = np.full((H, W), np.nan)
    dx_du[:, 1:-1] = (x_map[:, 2:] - x_map[:, :-2]) / 2.0
    dy_du[:, 1:-1] = (y_map[:, 2:] - y_map[:, :-2]) / 2.0
    dx_dv[1:-1, :] = (x_map[2:, :] - x_map[:-2, :]) / 2.0
    dy_dv[1:-1, :] = (y_map[2:, :] - y_map[:-2, :]) / 2.0

    area = np.abs(dx_du * dy_dv - dx_dv * dy_du)
    valid = np.isfinite(area) & (area > 0) & np.isfinite(h_map)
    if not valid.any():
        return 0.0
    valid &= area < max_area_ratio * np.median(area[valid])   # reject depth jumps
    return float(np.sum(h_map[valid] * area[valid]))


def calculate_volumes(reconstructions):
    """reconstructions: {container_key: reconstruction}. Each food dict needs
    'label' and 'eval' (output of evaluate_food_container for ITS container)."""
    foods = []
    for key, reconstruction in reconstructions.items():
        if key == "None":      # food with no container has no reference surface
            continue
        for food in reconstruction["foods"]:
            vol_m3 = calculate_food_volume(food["eval"], food.get("mask"))
            food["volume_m3"] = vol_m3
            food["volume_ml"] = vol_m3 * 1_000_000
            foods.append({"container": key, "food_label": food["label"],
                          "volume_ml": food["volume_ml"]})
    return foods