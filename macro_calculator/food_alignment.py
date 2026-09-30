import numpy as np

def depth_to_points(mask, depth, K):
    """
    Convert masked depth pixels into 3D camera-coordinate points.
    """
    ys, xs = np.where(mask)

    z = depth[ys, xs]

    # Remove invalid depth
    valid = np.isfinite(z) & (z > 0)

    xs = xs[valid]
    ys = ys[valid]
    z = z[valid]

    fx, fy = K[0, 0], K[1, 1]
    cx, cy = K[0, 2], K[1, 2]

    x = (xs - cx) * z / fx
    y = (ys - cy) * z / fy

    points = np.column_stack((x, y, z))
    pixels = np.column_stack((xs, ys))

    return points, pixels


def transform_to_container_frame(points, center, basis):
    """
    Transform camera/world points into the container's local frame.
    """
    centered = points - center

    # Equivalent to basis.T @ centered for each point
    return centered @ basis

def evaluate_food_container(food_points, food_pixels, reconstruction):
    center = reconstruction["center"]
    basis = reconstruction["basis"]
    profile = reconstruction["profile"]
    rim_3d = reconstruction["rim_3d"]

    local = transform_to_container_frame(food_points, center, basis)

    x = local[:, 0]
    y = local[:, 1]
    z = local[:, 2]

    r = np.sqrt(x**2 + y**2)

    rim_local = transform_to_container_frame(rim_3d, center, basis)

    rim_r = np.sqrt(rim_local[:, 0]**2 + rim_local[:, 1]**2)

    rim_radius = np.max(rim_r)
    rim_z = np.mean(rim_local[:, 2])

    bowl_z = np.polyval(profile, r)

    inside_volume = (
        (r <= rim_radius) &
        (z >= bowl_z - 0.02) &
        (z <= rim_z + 0.02)
    )

    height_difference = z - bowl_z
    food_heights = height_difference[inside_volume]

    contained_fraction = np.mean(inside_volume)

    return {
        "contained_fraction": contained_fraction,
        "inside_volume": inside_volume,
        "radius": r,
        "bowl_z": bowl_z,
        "rim_radius": rim_radius,
        "rim_z": rim_z,
        "local_points": local,
        "height_difference": height_difference,
        "food_points": local[inside_volume],
        "food_heights": food_heights,
        "food_pixels": food_pixels[inside_volume],
    }

def associate_foods(food_masks, reconstructions, depth, threshold=0.9, margin=0.15):
    unassociated_foods = []

    for food in food_masks:
        best_container = None
        best_score = -1
        best_eval = None
        second_best_score = -1

        for center, reconstruction in reconstructions.items():

            # Use the K belonging to this reconstruction
            K = reconstruction["K"]

            # Convert food mask to 3D using this reconstruction's camera
            food_points, food_pixels = depth_to_points(food["mask"], depth, K)

            evaluation = evaluate_food_container(food_points, food_pixels, reconstruction)

            score = evaluation["contained_fraction"]

            if score > best_score:
                second_best_score = best_score
                best_score = score
                best_container = center
                best_eval = evaluation

            elif score > second_best_score:
                second_best_score = score

        if (
            best_container is not None
            and best_score >= threshold
            and best_score - second_best_score >= margin
        ):
            reconstructions[best_container]["foods"].append({
                **food,
                "eval": best_eval,
                "association_score": best_score,
                "second_best_score": second_best_score,
            })

        else:
            unassociated_foods.append({
                **food,
                "eval": best_eval,
                "association_score": best_score,
                "second_best_score": second_best_score,
            })

    return reconstructions, unassociated_foods
