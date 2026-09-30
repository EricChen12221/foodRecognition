import numpy as np

def calculate_food_volume(evaluation, food_mask):
    points = evaluation["food_points"]
    heights = evaluation["food_heights"]
    pixels = evaluation["food_pixels"]

    if len(points) < 4:
        return 0.0

    H, W = food_mask.shape

    x = points[:, 0]
    y = points[:, 1]

    u = pixels[:, 0]
    v = pixels[:, 1]

    x_map = np.full((H, W), np.nan)
    y_map = np.full((H, W), np.nan)
    height_map = np.full((H, W), np.nan)

    x_map[v, u] = x
    y_map[v, u] = y
    height_map[v, u] = heights

    dx_du = np.full_like(x_map, np.nan)
    dx_dv = np.full_like(x_map, np.nan)
    dy_du = np.full_like(y_map, np.nan)
    dy_dv = np.full_like(y_map, np.nan)

    dx_du[:, 1:-1] = (x_map[:, 2:] - x_map[:, :-2]) / 2.0
    dy_du[:, 1:-1] = (y_map[:, 2:] - y_map[:, :-2]) / 2.0
    dx_dv[1:-1, :] = (x_map[2:, :] - x_map[:-2, :]) / 2.0
    dy_dv[1:-1, :] = (y_map[2:, :] - y_map[:-2, :]) / 2.0

    area = np.abs(dx_du * dy_dv - dx_dv * dy_du)

    valid = (
        np.isfinite(area) &
        (area > 0) &
        np.isfinite(height_map)
    )

    if not np.any(valid):
        return 0.0

    return float(np.sum(height_map[valid] * area[valid]))

def calculate_volumes(reconstructions):
    for center, reconstruction in reconstructions.items():
        if center == "None":
            continue

        for food in reconstruction["foods"]:
            volume_m3 = calculate_food_volume(food["eval"], food["mask"])

            food["volume_m3"] = volume_m3
            food["volume_ml"] = volume_m3 * 1_000_000