import numpy as np
from container_estimation import reconstruct_dish

PLATE_DIAMETER_M = 0.26


def estimate_depth_scale(depth_map, ellipse, container_mask, food_mask, focal_length,
                         known_diameter_m=PLATE_DIAMETER_M):
    """
    Factor s that makes the fitted rim radius equal the real one.

    Every 3D coordinate is proportional to the depth values (x = (u-cx)*z/fx),
    so multiplying the depth map by s scales the whole scene by s: lengths by s,
    areas by s^2, volumes by s^3. The intrinsics K do not change.
    """
    rec = reconstruct_dish(depth_map, ellipse, container_mask, food_mask, focal_length)
    return (known_diameter_m / 2.0) / rec["profile"]["rim_radius"]


def check_scale_from_ellipse(ellipse_full_axes_px, focal_px, known_diameter_m=PLATE_DIAMETER_M):
    """
    Independent sanity check that does not use the depth map: for a plate seen
    roughly top-down, distance = focal * real_diameter / apparent_diameter.
    Compare with the median rim depth after calibration.
    """
    d_px = max(ellipse_full_axes_px)
    return focal_px * known_diameter_m / d_px


# Scale without a hard-coded size: container-class prior + optional user value

# (typical, min, max) OUTER diameter in meters. Approximate figures for common
# US tableware; replace with measurements of the dishes your users actually have.
CONTAINER_PRIORS = {
    "dinner_plate": (0.265, 0.24, 0.30),
    "large_plate":  (0.30,  0.28, 0.33),
    "salad_plate":  (0.20,  0.18, 0.23),
    "small_plate":  (0.16,  0.14, 0.18),
    "bowl":         (0.16,  0.14, 0.20),
    "large_bowl":   (0.23,  0.20, 0.26),
    "rice_bowl":    (0.12,  0.10, 0.14),
}
USER_DIAMETER_UNCERTAINTY = 0.03       # relative; a typed or measured size


def choose_scale(model_rim_radius_m, container_class="dinner_plate", known_diameter_m=None):
    """
    model_rim_radius_m: rim_radius from reconstruct_dish on the UNSCALED depth.
    Returns dict(scale, diameter_m, source, rel_uncertainty).

    known_diameter_m (user-confirmed or measured) always wins.
    Otherwise: keep the model's scale if its implied diameter is plausible for
    the container class, else snap to the class's typical diameter.
    """
    model_d = 2.0 * model_rim_radius_m
    if known_diameter_m:
        return {"scale": known_diameter_m / model_d, "diameter_m": known_diameter_m,
                "source": "user", "rel_uncertainty": USER_DIAMETER_UNCERTAINTY}

    typical, lo, hi = CONTAINER_PRIORS[container_class]
    rel = (hi - lo) / (2.0 * typical)               # half-range as relative uncertainty
    if lo <= model_d <= hi:
        return {"scale": 1.0, "diameter_m": model_d, "source": "model", "rel_uncertainty": rel}
    return {"scale": typical / model_d, "diameter_m": typical, "source": "prior",
            "rel_uncertainty": rel}


def volume_range(volume_ml, rel_diameter_uncertainty):
    """Volume goes with diameter cubed, so a +-u diameter error is about (1 +- u)^3."""
    u = rel_diameter_uncertainty
    return volume_ml * (1 - u) ** 3, volume_ml * (1 + u) ** 3


def calibrate(depth_map, ellipse, container_mask, food_mask, focal_length,
              container_class="dinner_plate", known_diameter_m=None):
    """
    Returns (scaled_depth_map, info). Pass the scaled depth to reconstruct_dish
    and assign_foods; then use info["rel_uncertainty"] with volume_range().
    """
    rec = reconstruct_dish(depth_map, ellipse, container_mask, food_mask, focal_length)
    info = choose_scale(rec["profile"]["rim_radius"], container_class, known_diameter_m)
    return depth_map * info["scale"], info


def add_volume_ranges(foods, info):
    """foods: output of calculate_volumes. Adds volume_ml_low / volume_ml_high."""
    for f in foods:
        f["volume_ml_low"], f["volume_ml_high"] = volume_range(f["volume_ml"], info["rel_uncertainty"])
    return foods