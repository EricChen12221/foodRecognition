import json
import numpy as np
from scipy.optimize import least_squares
 
from container_estimation import (
    sample_ellipse, sample_depth, create_intrinsics, depth_to_3d,
    fit_plane, orient_normal, to_dish_coordinates, make_basis,
    refine_rim_center, get_visible_dish_points, _frame,
)
 
# Shared radial grid (r / R) for every stored profile, so records can be averaged.
KX = np.linspace(0.0, 1.0, 64)
 
# Parametric flat-floor model (summary numbers d and w)
def profile_knots(d, R, w, kx=KX):
    """z at kx = r/R: flat floor of radius w*R, then a tangent circular wall up to the rim."""
    L = (1.0 - w) * R
    rho = (L ** 2 + d ** 2) / (2.0 * d)
    s = np.clip(kx - w, 0.0, None) * R
    return -(d - (rho - np.sqrt(np.maximum(rho ** 2 - s ** 2, 0.0))))
 
 
def fit_flat_floor(pts_cam, rim_3d, normal0, center0, R0,
                   w_rim=3.0, max_points=8000, inner_frac=0.97, seed=0):
    """
    Fit tilt (2), center shift (2), rim radius, depth d and floor fraction w.
    The floor is fully visible in an empty-dish photo, so d and w are well constrained.
    Several starting floor widths guard against local minima.
    """
    rng = np.random.default_rng(seed)
    if len(pts_cam) > max_points:
        pts_cam = pts_cam[rng.choice(len(pts_cam), max_points, replace=False)]
    basis0 = make_basis(normal0)
 
    def residuals(th):
        a, b, dx, dy, R, d, w = th
        c, basis, _ = _frame(normal0, basis0, a, b, center0, dx, dy)
        dd = to_dish_coordinates(pts_cam, c, basis)
        r = np.hypot(dd[:, 0], dd[:, 1])
        zf = np.interp(r / R, KX, profile_knots(d, R, w, KX))
        data = (r < inner_frac * R) * (dd[:, 2] - zf)
        dr = to_dish_coordinates(rim_3d, c, basis)
        rim = w_rim * np.concatenate([np.hypot(dr[:, 0], dr[:, 1]) - R, dr[:, 2]])
        return np.concatenate([data, rim])
 
    lb = [-0.5, -0.5, -0.3 * R0, -0.3 * R0, 0.8 * R0, 0.05 * R0, 0.0]
    ub = [0.5, 0.5, 0.3 * R0, 0.3 * R0, 1.2 * R0, 0.9 * R0, 0.7]
 
    best = None
    for w0 in (0.0, 0.3, 0.6):
        th0 = [0, 0, 0, 0, R0, 0.4 * R0, w0]
        sol = least_squares(residuals, th0, bounds=(lb, ub),
                            loss="soft_l1", f_scale=0.01 * R0)
        if best is None or sol.cost < best.cost:
            best = sol
 
    a, b, dx, dy, R, d, w = best.x
    c, basis, n = _frame(normal0, basis0, a, b, center0, dx, dy)
    return {"center": c, "basis": basis, "normal": n,
            "R": R, "d": d, "w": w, "cost": best.cost}
 
 
# Empirical profile (the actual curve, no model assumed)
def empirical_profile(dish_pts, R, n_bins=24, inner_frac=0.97, min_count=15):
    """
    Median z/R in radial bins, interpolated onto KX. Pinned to z = 0 at the rim.
    Also returns the innermost bin radius with data, as a coverage check.
    """
    r = np.hypot(dish_pts[:, 0], dish_pts[:, 1]) / R
    z = dish_pts[:, 2] / R
    edges = np.linspace(0.0, inner_frac, n_bins + 1)
    idx = np.digitize(r, edges) - 1
 
    xs, zs = [], []
    for i in range(n_bins):
        sel = idx == i
        if sel.sum() >= min_count:
            xs.append(np.median(r[sel]))
            zs.append(np.median(z[sel]))
    if len(xs) < 6:
        raise ValueError("Too few populated radial bins; check the dish mask.")
    min_x = xs[0]
    xs.append(1.0)
    zs.append(0.0)
    return np.interp(KX, xs, zs), float(min_x)
 
 
# Shared step: rim circle and real-scale factor
def _rim_and_scale(depth_map, ellipse, K, rim_diameter=None):
    """
    Fit the rim circle in the depth map's own units. If rim_diameter is given, also
    compute the factor that makes the fitted rim diameter equal it (depth is linear in
    the 3D coordinates, so one factor rescales x, y and z together). With rim_diameter
    None the depth map is assumed to be scaled already and the factor is 1.
    Returns (rim points, normal, center, R, scale); all in the scaled units.
    """
    rim_2d, rim_depth = sample_depth(depth_map, sample_ellipse(*ellipse))
    rim_3d = depth_to_3d(rim_2d, rim_depth, K)
    normal, _, inl = fit_plane(rim_3d)
    normal = orient_normal(normal, rim_3d)
    c0 = rim_3d[inl].mean(axis=0)
    c0, R0, _ = refine_rim_center(rim_3d[inl], normal, c0)
 
    scale = 1.0 if rim_diameter is None else (rim_diameter / 2.0) / R0
    return rim_3d[inl] * scale, normal, c0 * scale, R0 * scale, scale
 
 
# Calibration from an empty-dish photo
def calibrate_dish(depth_map, ellipse, container_mask, rim_diameter_mm, focal_length,
                   dish_id="dish", measured_depth_mm=None):
    """
    depth_map:         (H, W) depth of the EMPTY dish, any units
    ellipse:           (cx, cy, a, b, angle_deg) of the rim, in pixels
    container_mask:    boolean mask of the whole dish
    rim_diameter_mm:   ruler measurement, same convention (inner lip or outer edge) every time
    measured_depth_mm: optional ruler/depth-gauge check of rim-to-floor depth
 
    Returns a record whose shape is normalized by R and whose only real-scale
    number is rim_diameter_mm, plus a warnings list.
    """
    h, w_img = depth_map.shape[:2]
    K = create_intrinsics(w_img, h, focal_length)
 
    rim_3d, normal, center0, R0, scale = _rim_and_scale(depth_map, ellipse, K, rim_diameter_mm)
 
    no_food = np.zeros_like(container_mask, dtype=bool)
    pts_cam = get_visible_dish_points(depth_map, container_mask, no_food, K) * scale
    if len(pts_cam) < 2000:
        raise ValueError(f"Only {len(pts_cam)} dish points; check the dish mask.")
 
    fit = fit_flat_floor(pts_cam, rim_3d, normal, center0, R0)
    R = fit["R"]
    dish_pts = to_dish_coordinates(pts_cam, fit["center"], fit["basis"])
    emp_z, min_x = empirical_profile(dish_pts, R)
 
    model_z = profile_knots(fit["d"], R, fit["w"], KX) / R
    inner = KX <= 0.97
    rms = float(np.sqrt(np.mean((emp_z[inner] - model_z[inner]) ** 2)))
 
    depth_mm = float(-emp_z[0] * R)
 
    warnings = []
    if min_x > 0.10:
        warnings.append(f"Innermost data is at {min_x:.2f} R; the dish center is not visible. "
                        "Was anything in the dish, or is the mask wrong?")
    if rms > 0.02:
        warnings.append(f"Flat-floor model deviates from the data (RMS {rms:.3f} R). "
                        "The stored knots are still valid; d and w are only a rough summary.")
    depth_err = None
    if measured_depth_mm:
        depth_err = float((depth_mm - measured_depth_mm) / measured_depth_mm * 100.0)
        if abs(depth_err) > 5.0:
            warnings.append(f"Depth is {depth_err:+.1f}% off the ruler value. Suspect the field of "
                            "view or a depth offset; do not trust this record yet.")
 
    record = {
        "dish_id": dish_id,
        "rim_diameter_mm": float(rim_diameter_mm),
        "knots_x": KX.tolist(),
        "knots_z_over_R": emp_z.tolist(),
        "depth_frac": float(-emp_z[0]),
        "floor_frac": float(fit["w"]),
        "depth_mm": depth_mm,
        "measured_depth_mm": measured_depth_mm,
        "depth_error_pct": depth_err,
        "fit_rms_over_R": rms,
        "innermost_x": min_x,
        "scale_factor": float(scale),   # depth-map units to mm; compare across photos
        "n_photos": 1,
    }
    return record, warnings
 
 
def average_records(records):
    """Combine several calibration photos of the same dish (median of the knots)."""
    out = dict(records[0])
    z = np.median([r["knots_z_over_R"] for r in records], axis=0)
    out["knots_z_over_R"] = z.tolist()
    out["depth_frac"] = float(-z[0])
    out["depth_mm"] = float(-z[0] * out["rim_diameter_mm"] / 2.0)
    out["floor_frac"] = float(np.median([r["floor_frac"] for r in records]))
    out["scale_factor"] = float(np.median([r["scale_factor"] for r in records]))
    out["n_photos"] = len(records)
    return out
 
 
def save_record(record, path):
    with open(path, "w") as f:
        json.dump(record, f, indent=2)
 
 
def load_record(path):
    with open(path) as f:
        return json.load(f)
 
 

# Meal time: fixed stored profile, fit only the pose
def fit_pose_known_profile(pts_cam, rim_3d, normal0, center0, R0, record,
                           w_rim=3.0, max_points=5000, inner_frac=0.97, seed=0):
    """Fit tilt (2), center shift (2) and a tightly bounded rim radius; the shape is fixed."""
    kx = np.array(record["knots_x"])
    kz = np.array(record["knots_z_over_R"])
 
    rng = np.random.default_rng(seed)
    if len(pts_cam) > max_points:
        pts_cam = pts_cam[rng.choice(len(pts_cam), max_points, replace=False)]
    basis0 = make_basis(normal0)
 
    def residuals(th):
        a, b, dx, dy, R = th
        c, basis, _ = _frame(normal0, basis0, a, b, center0, dx, dy)
        dd = to_dish_coordinates(pts_cam, c, basis)
        r = np.hypot(dd[:, 0], dd[:, 1])
        zf = np.interp(r / R, kx, kz) * R
        data = (r < inner_frac * R) * (dd[:, 2] - zf)
        dr = to_dish_coordinates(rim_3d, c, basis)
        rim = w_rim * np.concatenate([np.hypot(dr[:, 0], dr[:, 1]) - R, dr[:, 2]])
        return np.concatenate([data, rim])
 
    lb = [-0.5, -0.5, -0.3 * R0, -0.3 * R0, 0.97 * R0]
    ub = [0.5, 0.5, 0.3 * R0, 0.3 * R0, 1.03 * R0]
    sol = least_squares(residuals, [0, 0, 0, 0, R0], bounds=(lb, ub),
                        loss="soft_l1", f_scale=0.01 * R0)
 
    a, b, dx, dy, R = sol.x
    c, basis, n = _frame(normal0, basis0, a, b, center0, dx, dy)
    # Same keys as the profile dict from fit_cap_profile, so evaluate_profile and plot_profile work.
    return {"normal": n, "center": c, "basis": basis, "rim_radius": R,
            "knots_x": kx, "knots_z": kz * R, "depth_frac": float(-kz[0]),
            "floor_frac": record["floor_frac"]}
 
 
def reconstruct_with_record(depth_map, ellipse, container_mask, food_mask,
                            focal_length, record, rescale=True, units_per_mm=1.0):
    """
    Reconstruction using a stored dish record. Returns the same keys as reconstruct_dish.
 
    rescale=True:   depth_map is in arbitrary units; rescale it so the fitted rim equals
                    the record's rim diameter (output in mm).
    rescale=False:  depth_map is already scaled (e.g. by your calibrate step); keep its units.
    unit_scale:     depth-map length unit expressed in mm, only used for rescale=False
                    (1e-3 for a depth map in meters). Used for the rim_ratio check.
 
    rim_ratio = fitted rim radius / expected rim radius. Far from 1 means the scale is wrong
    for this dish (or the record belongs to a different dish).
    """
    h, w_img = depth_map.shape[:2]
    K = create_intrinsics(w_img, h, focal_length)
 
    D_mm = record["rim_diameter_mm"]
    rim_in, normal, center0, R0, scale = _rim_and_scale(
        depth_map, ellipse, K, D_mm if rescale else None)
 
    pts_cam = get_visible_dish_points(depth_map, container_mask, food_mask, K) * scale
    if len(pts_cam) < 500:
        raise ValueError(f"Only {len(pts_cam)} visible dish points; the dish is hidden or masked.")
 
    profile = fit_pose_known_profile(pts_cam, rim_in, normal, center0, R0, record)
 
    expected_R = (D_mm / 2.0) * (1.0 if rescale else units_per_mm)
    return {
        "K": K,
        "scale": scale,
        "rim_ratio": float(R0 / expected_R),
        "rim_3d": rim_in,
        "rim_dish": to_dish_coordinates(rim_in, profile["center"], profile["basis"]),
        "center": profile["center"],
        "axis": profile["normal"],
        "basis": profile["basis"],
        "dish_points": to_dish_coordinates(pts_cam, profile["center"], profile["basis"]),
        "profile": profile,
        "foods": [],
    }

def shape_payload(record):
    """What gets stored on the profile. No depth in mm: it is computed from depthFrac and the diameter."""
    return {
        "knotsZOverR": record["knots_z_over_R"],
        "depthFrac": record["depth_frac"],
        "floorFrac": record["floor_frac"],
        "fitRms": record["fit_rms_over_R"],
        "scaleFactor": record["scale_factor"],
        "nPhotos": record["n_photos"],
    }

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
# Calibration (once per dish, empty dish, nothing in the mask but the dish):
#   rec, warns = calibrate_dish(depth_empty, ellipse, dish_mask,
#                               rim_diameter_mm=220.0, focal_length=0,
#                               dish_id="blue_pasta_bowl", measured_depth_mm=47.0)
#   for w in warns: print("WARNING:", w)
#   save_record(rec, "blue_pasta_bowl.json")
#
# Several photos:
#   rec = average_records([rec1, rec2, rec3])
#
# Meal time:
#   rec = load_record("blue_pasta_bowl.json")
#   out = reconstruct_with_record(depth_meal, ellipse, dish_mask, food_mask, 0, rec)
#   plot_profile(out["dish_points"], out["profile"])   # your existing function