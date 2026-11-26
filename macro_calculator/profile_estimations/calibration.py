import numpy as np
from profile_estimations.container_estimation import reconstruct_dish
PLATE_DIAMETER_M = 0.26

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
USER_DIAMETER_UNCERTAINTY = 0.03       


def choose_scale(model_rim_radius_m, container_class="dinner_plate", known_diameter_m=None):
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