import numpy as np
import matplotlib.pyplot as plt


# 1. Sample rim ellipse
def sample_ellipse(cx, cy, a, b, angle_deg, n=200):
    t = np.linspace(0, 2*np.pi, n, endpoint=False)
    angle = np.deg2rad(angle_deg)

    x = a * np.cos(t)
    y = b * np.sin(t)

    u = cx + x*np.cos(angle) - y*np.sin(angle)
    v = cy + x*np.sin(angle) + y*np.cos(angle)

    return np.column_stack([u, v])


# 2. Get depth at pixels
def sample_depth(depth_map, points):
    h, w = depth_map.shape[:2]

    u = np.round(points[:, 0]).astype(int)
    v = np.round(points[:, 1]).astype(int)

    valid = (
        (u >= 0) & (u < w) &
        (v >= 0) & (v < h)
    )

    u, v = u[valid], v[valid]
    z = depth_map[v, u]

    valid = np.isfinite(z) & (z > 0)

    return np.column_stack([u, v])[valid], z[valid]


# 3. Approximate camera intrinsics
def create_intrinsics(width, height, focal_length):
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
    z = depths

    return np.column_stack([x, y, z])


# 5. Fit a plane to rim points
def fit_plane(points, iterations=500, threshold=0.03):
    best_inliers = None

    for _ in range(iterations):
        ids = np.random.choice(len(points), 3, replace=False)

        p1, p2, p3 = points[ids]
        normal = np.cross(p2 - p1, p3 - p1)

        norm = np.linalg.norm(normal)
        if norm < 1e-8:
            continue

        normal /= norm
        d = -normal @ p1

        distances = np.abs(points @ normal + d)
        inliers = distances < threshold

        if best_inliers is None or inliers.sum() > best_inliers.sum():
            best_inliers = inliers

    pts = points[best_inliers]
    center = pts.mean(axis=0)

    _, _, vh = np.linalg.svd(pts - center)
    normal = vh[-1]
    normal /= np.linalg.norm(normal)

    d = -normal @ center

    return normal, d, best_inliers


def orient_normal(normal, points):
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


# 7. Camera → dish coordinates
def to_dish_coordinates(points, origin, basis):
    x_axis, y_axis, z_axis = basis

    p = points - origin

    return np.column_stack([
        p @ x_axis,
        p @ y_axis,
        p @ z_axis
    ])


# 8. Fit radial bowl/plate profile
def fit_radial_profile(points, degree=2):
    r = np.sqrt(points[:, 0]**2 + points[:, 1]**2)
    z = points[:, 2]

    return np.polyfit(r, z, degree)


def evaluate_profile(coeffs, r):
    return np.polyval(coeffs, r)


# 9. Extract visible dish points
def get_visible_dish_points(depth_map, dish_mask, food_mask, K):
    valid = (
        (dish_mask > 0) &
        (food_mask == 0) &
        np.isfinite(depth_map) &
        (depth_map > 0)
    )

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

    normal, _, inliers = fit_plane(rim_3d)
    normal = orient_normal(normal, rim_3d)

    center = rim_3d[inliers].mean(axis=0)

    basis = make_basis(normal)

    dish_points_3d = get_visible_dish_points(depth_map, container_mask, food_mask, K)
    dish_points = to_dish_coordinates(dish_points_3d, center, basis)

    profile = fit_radial_profile(dish_points)

    return {
        "K": K,
        "rim_3d": rim_3d,
        "center": center,
        "axis": normal,
        "basis": basis,
        "dish_points": dish_points,
        "profile": profile,
        "foods": []
    }

def plot_profile(dish_points, profile):
    r = np.sqrt(dish_points[:, 0]**2 + dish_points[:, 1]**2)

    z = dish_points[:, 2]

    r_fit = np.linspace(0, np.percentile(r, 99), 300)
    z_fit = evaluate_profile(profile, r_fit)

    plt.scatter(r, z, s=2, alpha=0.25)
    plt.plot(r_fit, z_fit, "r", linewidth=3)

    plt.xlabel("Radius")
    plt.ylabel("Dish depth")
    plt.show()