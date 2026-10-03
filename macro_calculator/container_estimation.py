import numpy as np
import matplotlib.pyplot as plt
from scipy.ndimage import binary_erosion, binary_dilation
from scipy.optimize import least_squares


# 1. Sample rim ellipse
def sample_ellipse(cx, cy, a, b, angle_deg, n=200):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    angle = np.deg2rad(angle_deg)

    x = a * np.cos(t)
    y = b * np.sin(t)

    u = cx + x * np.cos(angle) - y * np.sin(angle)
    v = cy + x * np.sin(angle) + y * np.cos(angle)

    return np.column_stack([u, v])


# 2. Get depth at pixels
def sample_depth(depth_map, points):
    h, w = depth_map.shape[:2]

    u = np.round(points[:, 0]).astype(int)
    v = np.round(points[:, 1]).astype(int)

    valid = (u >= 0) & (u < w) & (v >= 0) & (v < h)
    u, v = u[valid], v[valid]
    z = depth_map[v, u]

    valid = np.isfinite(z) & (z > 0)
    return np.column_stack([u, v])[valid], z[valid]


# 3. Approximate camera intrinsics
def create_intrinsics(width, height, focal_length=0):
    if not focal_length:
        fov_degrees = 60
        focal_length = (width / 2) / np.tan(np.radians(fov_degrees / 2))
    return np.array([
        [focal_length, 0, width / 2],
        [0, focal_length, height / 2],
        [0, 0, 1]
    ], dtype=np.float64)


# 4. Convert depth pixels to approximate 3D
def depth_to_3d(points, depths, K):
    fx, fy = K[0, 0], K[1, 1]
    cx, cy = K[0, 2], K[1, 2]

    u, v = points[:, 0], points[:, 1]
    x = (u - cx) * depths / fx
    y = (v - cy) * depths / fy
    return np.column_stack([x, y, depths])


# 5. Fit a plane to rim points (RANSAC + SVD refit)
def fit_plane(points, iterations=500, rel_threshold=0.01, rng=None):
    rng = np.random.default_rng() if rng is None else rng
    # Threshold scales with scene depth so it works for any depth units
    threshold = rel_threshold * np.median(points[:, 2])

    best_inliers = None
    for _ in range(iterations):
        ids = rng.choice(len(points), 3, replace=False)
        p1, p2, p3 = points[ids]
        normal = np.cross(p2 - p1, p3 - p1)

        norm = np.linalg.norm(normal)
        if norm < 1e-8:
            continue
        normal /= norm

        distances = np.abs((points - p1) @ normal)
        inliers = distances < threshold
        if best_inliers is None or inliers.sum() > best_inliers.sum():
            best_inliers = inliers

    pts = points[best_inliers]
    center = pts.mean(axis=0)
    _, _, vh = np.linalg.svd(pts - center)
    normal = vh[-1] / np.linalg.norm(vh[-1])

    return normal, -normal @ center, best_inliers


def orient_normal(normal, points):
    """Make the normal point toward the camera (camera at origin)."""
    center = points.mean(axis=0)
    if np.dot(normal, -center) < 0:
        normal = -normal
    return normal


# 6. Build dish coordinate system
def make_basis(axis):
    z_axis = axis / np.linalg.norm(axis)

    helper = np.array([0., 1., 0.])
    if abs(helper @ z_axis) > 0.9:
        helper = np.array([1., 0., 0.])

    x_axis = np.cross(helper, z_axis)
    x_axis /= np.linalg.norm(x_axis)

    y_axis = np.cross(z_axis, x_axis)
    y_axis /= np.linalg.norm(y_axis)

    return x_axis, y_axis, z_axis


# 7. Camera -> dish coordinates
def to_dish_coordinates(points, origin, basis):
    x_axis, y_axis, z_axis = basis
    p = points - origin
    return np.column_stack([p @ x_axis, p @ y_axis, p @ z_axis])


# 7b. Circle fit for the rim (fixes biased mean center / median radius)
def fit_circle_2d(xy):
    """Kasa algebraic fit followed by geometric refinement. Returns (cx, cy, R)."""
    x, y = xy[:, 0], xy[:, 1]
    A = np.column_stack([2 * x, 2 * y, np.ones_like(x)])
    b = x ** 2 + y ** 2
    (cx, cy, c), *_ = np.linalg.lstsq(A, b, rcond=None)
    R = np.sqrt(max(c + cx ** 2 + cy ** 2, 1e-12))

    def res(p):
        return np.hypot(x - p[0], y - p[1]) - p[2]

    sol = least_squares(res, [cx, cy, R])
    return sol.x


def refine_rim_center(rim_3d, normal, center0):
    """Fit a circle to the rim in its plane; returns 3D center, radius, basis."""
    basis = make_basis(normal)
    rim_dish = to_dish_coordinates(rim_3d, center0, basis)
    cx, cy, R = fit_circle_2d(rim_dish[:, :2])
    center = center0 + cx * basis[0] + cy * basis[1]
    return center, R, basis


# 8. Fit radial profile: monotone piecewise-linear, joint with axis/center/radius
N_KNOTS = 12


def knots_from_increments(inc):
    """z at knots x = 0..1. z(1) = 0 at the rim, rising monotonically outward."""
    return np.append(-np.cumsum(inc[::-1])[::-1], 0.0)


def _frame(normal0, basis0, a, b, c0, dx, dy):
    n = normal0 + a * basis0[0] + b * basis0[1]
    n = n / np.linalg.norm(n)
    c = c0 + dx * basis0[0] + dy * basis0[1]
    return c, make_basis(n), n


def fit_radial_profile(pts_cam, rim_3d, normal0, center0, R0,
                       n_knots=N_KNOTS, w_rim=3.0, smooth=0.5,
                       max_points=5000, inner_frac=0.97, seed=0):
    """
    Jointly refine tilt (2), in-plane center (2), rim radius (1) and a monotone
    piecewise-linear depth profile, using a robust loss on all visible dish
    points (camera coordinates) plus rim residuals.
    """
    rng = np.random.default_rng(seed)
    if len(pts_cam) > max_points:
        pts_cam = pts_cam[rng.choice(len(pts_cam), max_points, replace=False)]

    basis0 = make_basis(normal0)
    kx = np.linspace(0, 1, n_knots)

    # Initialise increments from binned medians in the initial frame
    d0 = to_dish_coordinates(pts_cam, center0, basis0)
    x0 = np.hypot(d0[:, 0], d0[:, 1]) / R0
    zb = np.zeros(n_knots)
    edges = np.linspace(0, inner_frac, n_knots)
    for i in range(n_knots - 1):
        lo, hi = edges[i], edges[i + 1]
        m = (x0 >= lo) & (x0 < hi)
        zb[i] = np.median(d0[m, 2]) if m.sum() >= 10 else np.nan
    zb[-1] = 0.0
    idx = np.arange(n_knots)
    ok = np.isfinite(zb)
    zb = np.interp(idx, idx[ok], zb[ok])
    zb = np.minimum(zb, 0.0)
    zb = np.maximum.accumulate(zb)
    inc0 = np.maximum(np.diff(zb), 1e-6 * R0)

    def residuals(th):
        a, b, dx, dy, R = th[:5]
        inc = th[5:] ** 2
        c, basis, _ = _frame(normal0, basis0, a, b, center0, dx, dy)

        d = to_dish_coordinates(pts_cam, c, basis)
        r = np.hypot(d[:, 0], d[:, 1])
        zk = knots_from_increments(inc)
        zf = np.interp(r / R, kx, zk)
        w = (r < inner_frac * R).astype(float)   # fixed-length residual vector
        r_data = w * (d[:, 2] - zf)

        dr = to_dish_coordinates(rim_3d, c, basis)
        r_rim = w_rim * np.concatenate([np.hypot(dr[:, 0], dr[:, 1]) - R, dr[:, 2]])

        r_smooth = smooth * R * np.diff(zk, 2)
        return np.concatenate([r_data, r_rim, r_smooth])

    th0 = np.concatenate([[0, 0, 0, 0, R0], np.sqrt(inc0)])
    sol = least_squares(residuals, th0, loss="soft_l1", f_scale=0.01 * R0)

    a, b, dx, dy, R = sol.x[:5]
    c, basis, n = _frame(normal0, basis0, a, b, center0, dx, dy)
    return {
        "normal": n,
        "center": c,
        "basis": basis,
        "rim_radius": R,
        "knots_x": kx,
        "knots_z": knots_from_increments(sol.x[5:] ** 2),
    }


def evaluate_profile(profile, r):
    """Depth (dish z) at raw radius r. Negative inside the dish, 0 at the rim."""
    x = np.asarray(r) / profile["rim_radius"]
    return np.interp(x, profile["knots_x"], profile["knots_z"])


# 9. Extract visible dish points
def get_visible_dish_points(depth_map, dish_mask, food_mask, K,
                            erode_px=3, dilate_px=5):
    # Depth maps blur at boundaries: shrink the dish mask, grow the food mask
    dish = binary_erosion(dish_mask > 0, iterations=erode_px) if erode_px else dish_mask > 0
    food = binary_dilation(food_mask > 0, iterations=dilate_px) if dilate_px else food_mask > 0

    valid = dish & ~food & np.isfinite(depth_map) & (depth_map > 0)

    v, u = np.where(valid)
    z = depth_map[v, u]
    pixels = np.column_stack([u, v])
    return depth_to_3d(pixels, z, K)


# 10. Main reconstruction
def reconstruct_dish(depth_map, ellipse, container_mask, food_mask, focal_length):
    h, w = depth_map.shape[:2]
    cx, cy, a, b, angle = ellipse

    rim_2d = sample_ellipse(cx, cy, a, b, angle)
    rim_2d, rim_depth = sample_depth(depth_map, rim_2d)

    K = create_intrinsics(w, h, focal_length)
    rim_3d = depth_to_3d(rim_2d, rim_depth, K)

    # Plane -> circle fit (unbiased center and radius)
    normal, _, inliers = fit_plane(rim_3d)
    normal = orient_normal(normal, rim_3d)
    center0 = rim_3d[inliers].mean(axis=0)
    center0, R0, _ = refine_rim_center(rim_3d[inliers], normal, center0)

    # Visible dish points in camera coordinates
    dish_points_cam = get_visible_dish_points(depth_map, container_mask, food_mask, K)

    # Joint refinement of axis, center, radius and profile
    profile = fit_radial_profile(dish_points_cam, rim_3d[inliers], normal, center0, R0)

    dish_points = to_dish_coordinates(dish_points_cam, profile["center"], profile["basis"])
    rim_dish = to_dish_coordinates(rim_3d, profile["center"], profile["basis"])

    return {
        "K": K,
        "rim_3d": rim_3d,
        "rim_dish": rim_dish,
        "center": profile["center"],
        "axis": profile["normal"],
        "basis": profile["basis"],
        "dish_points": dish_points,
        "profile": profile,
        "foods": [],
    }


def plot_profile(dish_points, profile):
    r = np.hypot(dish_points[:, 0], dish_points[:, 1])
    z = dish_points[:, 2]
    theta = np.arctan2(dish_points[:, 1], dish_points[:, 0])

    inside = r < 0.97 * profile["rim_radius"]
    resid = z - evaluate_profile(profile, r)

    r_fit = np.linspace(0, profile["rim_radius"], 300)
    z_fit = evaluate_profile(profile, r_fit)

    fig, ax = plt.subplots(1, 3, figsize=(15, 4))

    ax[0].scatter(r, z, s=2, alpha=0.25)
    ax[0].plot(r_fit, z_fit, "r", linewidth=3)
    ax[0].set_xlabel("Radius")
    ax[0].set_ylabel("Dish depth")
    ax[0].set_title("Profile")

    ax[1].scatter(r[inside], resid[inside], s=2, alpha=0.25)
    ax[1].axhline(0, color="r")
    ax[1].set_xlabel("Radius")
    ax[1].set_ylabel("Residual")
    ax[1].set_title("Residual vs radius (structure = model too rigid)")

    ax[2].scatter(theta[inside], resid[inside], s=2, alpha=0.25)
    ax[2].axhline(0, color="r")
    ax[2].set_xlabel("Polar angle")
    ax[2].set_title("Residual vs angle (structure = axis/center off)")

    plt.tight_layout()
    plt.show()