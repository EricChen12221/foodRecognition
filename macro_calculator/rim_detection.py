import cv2
import numpy as np
from PIL import Image
from scipy.ndimage import binary_fill_holes
 
 
class RimDetector:
    """
    Detects the opening rim of a circular/elliptical container.
 
    Fixes over the original:
      * Rays now find the OUTER mask boundary. The old code stopped at the first
        pixel where the ray left the mask, so food holes in the container mask
        ended the ray early and produced rim candidates at food edges.
      * Rays that end on the image border (plate cut off by the frame) are
        dropped, because no rim is visible there.
      * Optional occluder mask (hand, utensils, food over the rim): rays whose
        boundary touches it are dropped.
      * NaN depth (e.g. from MoGe) no longer poisons the edge map.
      * RANSAC samples only from angular bins that actually have candidates, so
        a missing arc no longer makes every sample fail.
      * _fit_ellipse always returns (ellipse, inliers) or (None, None); the old
        code could return a bare ellipse or None and crash on unpacking.
      * The mask score measures how many ellipse points sit ON the mask
        boundary. The old version averaged a window around the boundary, which
        is ~0.5 for a perfect fit and so could never pass its own 0.70 test.
      * Result includes semi-axes and "ellipse_params" = (cx, cy, a, b, angle),
        ready for reconstruct_dish (which expects semi-axes, not full lengths).
    """
 
    def __init__(self, n_angles=720, search_depth_ratio=0.90, min_edge_strength=0.12,
                 min_points=50, edge_band=3, mask_band=3, ellipse_outlier_threshold=0.15,
                 ransac_iterations=500, ransac_threshold_px=12, candidates_per_ray=3,
                 nms_window=6, border_margin=4, occluder_dilate=15,
                 min_arc_coverage=0.30, verbose=False, seed=None):
        self.n_angles = n_angles
        self.search_depth_ratio = search_depth_ratio
        self.min_edge_strength = min_edge_strength
        self.min_points = min_points
        self.edge_band = edge_band
        self.mask_band = mask_band
        self.ellipse_outlier_threshold = ellipse_outlier_threshold
        self.ransac_iterations = ransac_iterations
        self.ransac_threshold_px = ransac_threshold_px
        self.candidates_per_ray = candidates_per_ray
        self.nms_window = nms_window
        self.border_margin = border_margin
        self.occluder_dilate = occluder_dilate
        self.min_arc_coverage = min_arc_coverage
        self.verbose = verbose
        self.rng = np.random.default_rng(seed)
 
    # ------------------------------------------------------------------ main
    def detect(self, image, container_box, container_mask, depth=None, occluder_mask=None):
        """
        image: PIL.Image
        container_box: [x1, y1, x2, y2]
        container_mask: full-resolution boolean mask (may have holes for food)
        depth: optional full-resolution depth map (NaN allowed)
        occluder_mask: optional full-resolution boolean mask of things that hide
            the rim (hand, utensils, ...). Foods that sit inside the plate do
            not need to be included.
        Returns a dict (check result["valid"]) or None if no ellipse was found.
        """
        image_np = np.asarray(image)
        H, W = image_np.shape[:2]
 
        crop = self._crop_container(image_np, container_box, container_mask,
                                    depth, occluder_mask)
        if crop is None:
            return None
        crop_rgb, crop_mask, crop_depth, crop_occ, (x1, y1) = crop
 
        crop_mask = self._clean_mask(crop_mask)
        if crop_mask is None:
            return None
 
        center = self._estimate_center(crop_mask)
        edge_map = self._create_edge_map(crop_rgb, crop_depth)
 
        points = self._find_rim_points(edge_map, crop_mask, center,
                                       offset=(x1, y1), image_size=(W, H),
                                       occluder=crop_occ)
        if len(points) < self.min_points:
            return None
 
        ellipse, inlier_points = self._fit_ellipse(points, crop_mask)
        if ellipse is None:
            return None
 
        validation = self._validate_ellipse(ellipse, inlier_points, crop_mask, edge_map)
 
        (ecx, ecy), (w_full, h_full), angle = ellipse
        original_ellipse = ((ecx + x1, ecy + y1), (w_full, h_full), angle)
        a, b = w_full / 2.0, h_full / 2.0
        offset = np.array([x1, y1], dtype=np.float32)
 
        return {
            "ellipse": original_ellipse,                 # cv2.fitEllipse convention (FULL axes)
            "semi_axes": (a, b),
            "ellipse_params": (ecx + x1, ecy + y1, a, b, angle),   # for reconstruct_dish
            "center": (ecx + x1, ecy + y1),
            "major_axis": max(w_full, h_full),           # full length
            "minor_axis": min(w_full, h_full),
            "angle": angle,
            "aspect_ratio": min(w_full, h_full) / max(w_full, h_full),
            "valid": validation["valid"],
            "confidence": validation["confidence"],
            "edge_score": validation["edge_score"],
            "mask_score": validation["mask_score"],
            "fit_error": validation["fit_error"],
            "arc_coverage": validation["arc_coverage"],
            "rim_points": points[:, :2] + offset,
            "inlier_points": inlier_points[:, :2] + offset,
            "container_box": container_box,
        }
 
    # ------------------------------------------------------------------ crop
    def _crop_container(self, image, box, mask, depth, occluder):
        x1, y1, x2, y2 = map(int, box)
        h, w = image.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        if x2 <= x1 or y2 <= y1:
            return None
 
        crop_rgb = image[y1:y2, x1:x2]
        crop_mask = np.asarray(mask)[y1:y2, x1:x2] > 0
        crop_depth = None if depth is None else depth[y1:y2, x1:x2]
        crop_occ = None
        if occluder is not None:
            occ = (np.asarray(occluder)[y1:y2, x1:x2] > 0).astype(np.uint8)
            k = max(3, int(self.occluder_dilate))
            crop_occ = cv2.dilate(occ, np.ones((k, k), np.uint8)) > 0
        return crop_rgb, crop_mask, crop_depth, crop_occ, (x1, y1)
 
    def _clean_mask(self, mask):
        """Fill holes (food cut-outs) and keep the largest component."""
        filled = binary_fill_holes(mask).astype(np.uint8)
        n, lab, stats, _ = cv2.connectedComponentsWithStats(filled)
        if n <= 1:
            return None
        k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        return lab == k
 
    def _estimate_center(self, mask):
        """Mask centroid. Any interior point works as a ray origin for a convex
        container; the centroid is safer than the bounding-box centre when the
        container is cut off by the frame."""
        m = cv2.moments(mask.astype(np.uint8), binaryImage=True)
        return (m["m10"] / m["m00"], m["m01"] / m["m00"])
 
    # ------------------------------------------------------------- edge map
    def _normalize(self, values, low_percentile=2, high_percentile=98):
        values = values.astype(np.float32)
        low = np.percentile(values, low_percentile)
        high = np.percentile(values, high_percentile)
        if high - low < 1e-8:
            return np.zeros_like(values)
        return np.clip((values - low) / (high - low), 0, 1)
 
    def _create_edge_map(self, rgb, depth=None):
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        rgb_edges = self._normalize(np.sqrt(gx * gx + gy * gy))
 
        if depth is None:
            return self._normalize(rgb_edges)
 
        depth = depth.astype(np.float32)
        finite = np.isfinite(depth)
        if finite.any():
            depth = np.where(finite, depth, np.median(depth[finite]))   # NaN would spread through Sobel
            dx = cv2.Sobel(depth, cv2.CV_32F, 1, 0, ksize=3)
            dy = cv2.Sobel(depth, cv2.CV_32F, 0, 1, ksize=3)
            depth_edges = self._normalize(np.sqrt(dx * dx + dy * dy))
            return self._normalize(0.55 * rgb_edges + 0.45 * depth_edges)
        return self._normalize(rgb_edges)
 
    # ------------------------------------------------------------ ray casting
    def _rim_radii(self, mask, center, thetas, offset, image_size, occluder):
        """
        For every angle, the radius of the OUTERMOST mask pixel on that ray.
        NaN for rays that are unusable: no mask, boundary on the image border,
        or boundary touching an occluder.
        """
        h, w = mask.shape
        cx, cy = center
        ox, oy = offset
        W, H = image_size
        max_r = int(np.hypot(h, w)) + 1
        r = np.arange(max_r, dtype=np.float32)
 
        xs = np.rint(cx + np.cos(thetas)[:, None] * r[None, :]).astype(np.int32)
        ys = np.rint(cy + np.sin(thetas)[:, None] * r[None, :]).astype(np.int32)
        in_bounds = (xs >= 0) & (xs < w) & (ys >= 0) & (ys < h)
        xs = np.clip(xs, 0, w - 1)
        ys = np.clip(ys, 0, h - 1)
        inside = in_bounds & mask[ys, xs]
 
        has = inside.any(axis=1)
        last = max_r - 1 - np.argmax(inside[:, ::-1], axis=1)
        rows = np.arange(len(thetas))
        bx, by = xs[rows, last], ys[rows, last]
 
        gx, gy = bx + ox, by + oy
        m = self.border_margin
        on_border = (gx <= m) | (gx >= W - 1 - m) | (gy <= m) | (gy >= H - 1 - m)
 
        valid = has & ~on_border
        if occluder is not None:
            valid &= ~occluder[by, bx]
 
        radii = np.where(valid, last, np.nan).astype(np.float32)
        return radii
 
    def _find_rim_points(self, edge_map, mask, center, offset, image_size, occluder=None):
        """Several candidate edge points per usable ray (non-max suppressed)."""
        cx, cy = center
        h, w = edge_map.shape
        thetas = np.linspace(0, 2 * np.pi, self.n_angles, endpoint=False)
        radii = self._rim_radii(mask, center, thetas, offset, image_size, occluder)
 
        results = []
        for theta, mask_radius in zip(thetas, radii):
            if not np.isfinite(mask_radius):
                continue
            start = int(mask_radius)
            end = int(mask_radius * self.search_depth_ratio)
            if start <= end:
                continue
 
            rs = np.arange(end, start + 1)
            xs = np.clip(np.rint(cx + rs * np.cos(theta)).astype(int), 0, w - 1)
            ys = np.clip(np.rint(cy + rs * np.sin(theta)).astype(int), 0, h - 1)
            edge = edge_map[ys, xs]
 
            search_width = max(1.0, mask_radius * (1.0 - self.search_depth_ratio))
            boundary_score = np.clip(1.0 - (mask_radius - rs) / search_width, 0.0, 1.0)
            score = 0.75 * edge + 0.25 * boundary_score
            score = np.where(edge >= self.min_edge_strength, score, -1.0)
 
            # non-max suppression: distinct edges, not neighbouring pixels of one edge
            work = score.copy()
            for _ in range(self.candidates_per_ray):
                i = int(np.argmax(work))
                if work[i] <= 0:
                    break
                results.append([xs[i], ys[i], rs[i], score[i], theta])
                work[max(0, i - self.nms_window): i + self.nms_window + 1] = -1.0
 
        if not results:
            return np.empty((0, 5), dtype=np.float32)
        return np.asarray(results, dtype=np.float32)
 
    # ----------------------------------------------------------- ellipse RANSAC
    def _fit_ellipse(self, points, mask=None):
        xy = points[:, :2].astype(np.float32)
        n_points = len(xy)
        if n_points < 5:
            return None, None
 
        n_bins = 36
        bin_id = np.clip((points[:, 4] / (2 * np.pi) * n_bins).astype(int), 0, n_bins - 1)
        occupied = np.unique(bin_id)
        if len(occupied) < 5:
            return None, None
        members = {int(b): np.where(bin_id == b)[0] for b in occupied}
 
        ext_w = np.ptp(points[:, 0])
        ext_h = np.ptp(points[:, 1])
 
        best_score, best_ellipse, best_inliers = -np.inf, None, None
 
        for _ in range(self.ransac_iterations):
            chosen = self.rng.choice(occupied, 5, replace=False)
            idx = []
            for b in chosen:
                cand = members[int(b)]
                p = points[cand, 3] + 1e-6
                idx.append(self.rng.choice(cand, p=p / p.sum()))
            try:
                ellipse = cv2.fitEllipse(xy[idx])
            except cv2.error:
                continue
 
            (_, _), (width, height), _ = ellipse
            if not (np.isfinite(width) and np.isfinite(height)) or width <= 0 or height <= 0:
                continue
            if width > ext_w * 2.0 or height > ext_h * 2.0:
                continue
 
            residuals = self._ellipse_residuals(ellipse, points)
            inliers = residuals < self.ransac_threshold_px
            n_inliers = int(inliers.sum())
            if n_inliers < 5:
                continue
 
            ib = np.clip((points[inliers, 4] / (2 * np.pi) * n_bins).astype(int), 0, n_bins - 1)
            coverage = len(np.unique(ib)) / n_bins
            residual_score = np.exp(-np.median(residuals[inliers]) / 10.0)
            score = (0.45 * n_inliers / n_points
                     + 0.25 * float(np.mean(points[inliers, 3]))
                     + 0.20 * coverage
                     + 0.10 * residual_score)
 
            if score > best_score:
                best_score, best_ellipse, best_inliers = score, ellipse, inliers
 
        if best_ellipse is None:
            return None, None
 
        ellipse, inliers = best_ellipse, best_inliers
 
        # Refit on all inliers, but only accept if it is sane and still well supported.
        try:
            refit = cv2.fitEllipse(xy[inliers])
            (_, _), (rw, rh), _ = refit
            (_, _), (bw, bh), _ = best_ellipse
            sane = (np.isfinite(rw) and np.isfinite(rh) and rw > 0 and rh > 0
                    and 0.8 < max(rw, rh) / max(bw, bh) < 1.25)
            if sane:
                new_inl = self._ellipse_residuals(refit, points) < self.ransac_threshold_px
                if new_inl.sum() >= 0.9 * inliers.sum():
                    ellipse, inliers = refit, new_inl
        except cv2.error:
            pass
 
        if self.verbose:
            print("RANSAC ellipse:", ellipse)
            print("RANSAC inliers:", int(inliers.sum()), "/", n_points)
        return ellipse, points[inliers]
 
    def _ellipse_residuals(self, ellipse, points):
        xy = points[:, :2]
        (cx, cy), (width, height), angle = ellipse
        a, b = width / 2.0, height / 2.0
        if a <= 0 or b <= 0:
            return np.full(len(points), np.inf)
 
        ang = np.deg2rad(angle)
        cos_a, sin_a = np.cos(ang), np.sin(ang)
        dx, dy = xy[:, 0] - cx, xy[:, 1] - cy
        xr = dx * cos_a + dy * sin_a
        yr = -dx * sin_a + dy * cos_a
 
        theta = np.arctan2(yr / b, xr / a)
        return np.hypot(xr - a * np.cos(theta), yr - b * np.sin(theta))
 
    # ---------------------------------------------------------------- scoring
    def _ellipse_points(self, ellipse, n=720):
        (cx, cy), (width, height), angle = ellipse
        a, b = width / 2, height / 2
        t = np.linspace(0, 2 * np.pi, n)
        ang = np.deg2rad(angle)
        cos_a, sin_a = np.cos(ang), np.sin(ang)
        x = cx + a * np.cos(t) * cos_a - b * np.sin(t) * sin_a
        y = cy + a * np.cos(t) * sin_a + b * np.sin(t) * cos_a
        return np.column_stack([x, y])
 
    def _in_frame(self, points, shape):
        h, w = shape
        x = np.round(points[:, 0]).astype(int)
        y = np.round(points[:, 1]).astype(int)
        ok = (x >= 0) & (x < w) & (y >= 0) & (y < h)
        return x[ok], y[ok]
 
    def _mask_score(self, ellipse, mask):
        """Fraction of (visible) ellipse points that lie on the mask boundary."""
        x, y = self._in_frame(self._ellipse_points(ellipse), mask.shape)
        if len(x) == 0:
            return 0.0
        radius = np.sqrt(mask.sum() / np.pi)
        band = max(self.mask_band, int(round(0.012 * radius)))
        k = np.ones((2 * band + 1, 2 * band + 1), np.uint8)
        m = mask.astype(np.uint8)
        boundary = (cv2.dilate(m, k) - cv2.erode(m, k)) > 0
        return float(np.mean(boundary[y, x]))
 
    def _edge_score(self, ellipse, edge_map):
        x, y = self._in_frame(self._ellipse_points(ellipse), edge_map.shape)
        if len(x) == 0:
            return 0.0
        k = 2 * self.edge_band + 1
        return float(np.mean(cv2.blur(edge_map, (k, k))[y, x]))
 
    def _ellipse_fit_error(self, ellipse, points):
        xy = points[:, :2]
        (cx, cy), (width, height), angle = ellipse
        a, b = width / 2, height / 2
        if a <= 0 or b <= 0:
            return float("inf")
        th = np.deg2rad(angle)
        cos_t, sin_t = np.cos(th), np.sin(th)
        dx, dy = xy[:, 0] - cx, xy[:, 1] - cy
        xr = dx * cos_t + dy * sin_t
        yr = -dx * sin_t + dy * cos_t
        return float(np.median(np.abs(np.sqrt((xr / a) ** 2 + (yr / b) ** 2) - 1)))
 
    def _validate_ellipse(self, ellipse, points, mask, edge_map):
        edge_score = self._edge_score(ellipse, edge_map)
        mask_score = self._mask_score(ellipse, mask)
        fit_error = self._ellipse_fit_error(ellipse, points)
 
        _, (width, height), _ = ellipse
        aspect = min(width, height) / max(width, height)
        fit_score = np.exp(-5.0 * fit_error)
 
        n_bins = 36
        ib = np.clip((points[:, 4] / (2 * np.pi) * n_bins).astype(int), 0, n_bins - 1)
        arc_coverage = len(np.unique(ib)) / n_bins
 
        confidence = 0.45 * edge_score + 0.30 * mask_score + 0.20 * fit_score + 0.05 * aspect
        valid = (len(points) >= self.min_points
                 and mask_score > 0.50
                 and edge_score > 0.08
                 and fit_error < self.ellipse_outlier_threshold
                 and arc_coverage >= self.min_arc_coverage)
 
        return {"valid": bool(valid), "confidence": float(confidence),
                "edge_score": edge_score, "mask_score": mask_score,
                "fit_error": fit_error, "arc_coverage": arc_coverage}
 
    # ------------------------------------------------------------------ debug
    def draw_result(self, image, result):
        """Candidates in yellow, RANSAC inliers in magenta, ellipse in red."""
        img = np.asarray(image).copy()
        for x, y in result["rim_points"]:
            cv2.circle(img, (int(x), int(y)), 2, (255, 255, 0), -1)
        for x, y in result["inlier_points"]:
            cv2.circle(img, (int(x), int(y)), 3, (255, 0, 255), -1)
 
        (cx, cy), (w, h), angle = result["ellipse"]
        cv2.ellipse(img, (int(round(cx)), int(round(cy))),
                    (int(round(w / 2)), int(round(h / 2))), angle, 0, 360, (255, 0, 0), 4)
        cv2.circle(img, (int(round(cx)), int(round(cy))), 6, (0, 255, 0), -1)
        return Image.fromarray(img)