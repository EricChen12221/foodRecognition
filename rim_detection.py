import cv2
import numpy as np
from PIL import Image


class RimDetector:
    """
    Detects the opening rim of a circular/elliptical container.
    """

    def __init__(self, n_angles=720, search_depth_ratio=0.90, min_edge_strength=0.12, min_points=50, edge_band=3, mask_band=3, ellipse_outlier_threshold=0.15, ransac_iterations=500, ransac_threshold_px=12,):
        self.n_angles = n_angles
        self.search_depth_ratio = search_depth_ratio
        self.min_edge_strength = min_edge_strength
        self.min_points = min_points

        # Number of pixels to search around the predicted ellipse.
        self.edge_band = edge_band
        self.mask_band = mask_band

        # Maximum normalized distance from ellipse.
        self.ellipse_outlier_threshold = ellipse_outlier_threshold

        #RANSAC
        self.ransac_iterations = ransac_iterations
        self.ransac_threshold_px = ransac_threshold_px

    def detect(self, image, container_box, container_mask, depth=None):
        """
        Detect the rim for one container.

        Parameters
        ----------
        image:
            PIL.Image

        container_box:
            [x1, y1, x2, y2]

        container_mask:
            Full-resolution SAM boolean mask.

        depth:
            Full-resolution Depth Anything depth map.
            Optional.

        Returns
        -------
        dict or None
        """

        image_np = np.asarray(image)

        crop_rgb, crop_mask, crop_depth, offset = (
            self._crop_container(image_np, container_box, container_mask, depth)
        )

        if crop_rgb is None:
            return None

        x1, y1 = offset

        # 2. Estimate center
        center = self._estimate_center(crop_mask)

        if center is None:
            return None

        # 3. Create combined RGB + depth edge map
        edge_map = self._create_edge_map(crop_rgb, crop_depth)
        # 4. Find candidate rim points
        points = self._find_rim_points(
            edge_map=edge_map,
            container_mask=crop_mask,
            center=center
        )

        if len(points) < self.min_points:
            return None

        # 5. Fit ellipse
        ellipse, inlier_points = self._fit_ellipse(points)

        if ellipse is None:
            return None

        # 6. Validate ellipse
        validation = self._validate_ellipse(
            ellipse,
            inlier_points,
            crop_mask,
            edge_map
        )

        # 7. Convert ellipse back to original coordinates
        original_ellipse = ((ellipse[0][0] + x1, ellipse[0][1] + y1,), ellipse[1], ellipse[2])

        return {
            "ellipse": original_ellipse,

            "center": (original_ellipse[0][0], original_ellipse[0][1]),

            "major_axis": original_ellipse[1][0],
            "minor_axis": original_ellipse[1][1],

            "angle": original_ellipse[2],

            "aspect_ratio": (min(original_ellipse[1]) / max(original_ellipse[1])),

            "confidence": validation["confidence"],
            "edge_score": validation["edge_score"],
            "mask_score": validation["mask_score"],
            "fit_error": validation["fit_error"],

            # Useful for debugging / visualization
            "rim_points": (points[:, :2] + np.array([x1, y1])),

            "container_box": container_box,
        }

    # CROP
    def _crop_container(self, image, box, mask, depth):
        x1, y1, x2, y2 = map(int, box)

        h, w = image.shape[:2]

        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(w, x2)
        y2 = min(h, y2)

        if x2 <= x1 or y2 <= y1:
            return None, None, None, None

        crop_rgb = image[y1:y2, x1:x2]
        crop_mask = mask[y1:y2, x1:x2]

        crop_depth = None

        if depth is not None:
            crop_depth = depth[y1:y2, x1:x2]

        return (
            crop_rgb,
            crop_mask,
            crop_depth,
            (x1, y1)
        )

    # CENTER
    def _estimate_center(self, mask):
        ys, xs = np.where(mask)

        if len(xs) == 0:
            return None

        x_center = (xs.min() + xs.max()) / 2.0
        y_center = (ys.min() + ys.max()) / 2.0

        return (x_center, y_center)



    # NORMALIZATION
    def _normalize(self, values, low_percentile=2, high_percentile=98):

        values = values.astype(np.float32)

        low = np.percentile(values, low_percentile)
        high = np.percentile(values, high_percentile)

        if high - low < 1e-8:
            return np.zeros_like(values)

        values = (values - low) / (high - low)

        return np.clip(values, 0, 1)

    # EDGE MAP
    def _create_edge_map(self, rgb, depth=None):
        """
        Creates a combined geometric edge map.

        RGB edges:
            Useful for visible bowl boundaries.

        Depth edges:
            Useful for actual geometric transitions.
        """

        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)

        # RGB gradient
        gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)

        rgb_edges = np.sqrt(gx * gx + gy * gy)
        rgb_edges = self._normalize(rgb_edges)

        # Depth gradient
        if depth is not None:

            depth = depth.astype(np.float32)

            dx = cv2.Sobel(depth, cv2.CV_32F, 1, 0, ksize=3)
            dy = cv2.Sobel(depth, cv2.CV_32F, 0, 1, ksize=3)

            depth_edges = np.sqrt(dx * dx + dy * dy)
            depth_edges = self._normalize(depth_edges)

            # Combine the two sources.
            edge_map = (0.55 * rgb_edges + 0.45 * depth_edges)
        else:
            edge_map = rgb_edges

        return self._normalize(edge_map)

    # FIND MASK RADIUS
    def _find_mask_radius(self, mask, center, theta):
        """
        Shoot one ray from the center and find where
        it exits the SAM container mask.
        """

        cx, cy = center
        h, w = mask.shape

        max_radius = int(np.sqrt(h * h + w * w))

        cos_t = np.cos(theta)
        sin_t = np.sin(theta)

        last_inside = None

        for r in range(max_radius):

            x = int(round(cx + r * cos_t))
            y = int(round(cy + r * sin_t))

            if (x < 0 or x >= w or y < 0 or y >= h):
                break

            if mask[y, x]:
                last_inside = r
            elif last_inside is not None:
                break

        return last_inside

    # RADIAL RIM DETECTION
    def _find_rim_points(self, edge_map, container_mask, center):
        """
        Find multiple candidate rim points for each radial direction.

        Instead of committing to the strongest edge on each ray, retain several candidates. RANSAC will later determine
        which candidates form the actual rim.
        """

        cx, cy = center

        h, w = edge_map.shape

        results = []

        angles = np.linspace(0, 2 * np.pi, self.n_angles, endpoint=False)

        # Number of candidates retained per ray.
        candidates_per_ray = 5

        for theta in angles:

            mask_radius = self._find_mask_radius(container_mask, center, theta)

            if mask_radius is None:
                continue

            start = int(mask_radius)
            end = int(mask_radius * self.search_depth_ratio)

            if start <= end:
                continue

            cos_t = np.cos(theta)
            sin_t = np.sin(theta)

            candidates = []

            for r in range(start, end - 1, -1):

                x = int(round(cx + r * cos_t))
                y = int(round(cy + r * sin_t))

                if (x < 0 or x >= w or y < 0 or y >= h):
                    continue

                edge_strength = float(edge_map[y, x])

                if edge_strength < self.min_edge_strength:
                    continue

                # Distance from SAM boundary.
                boundary_distance = (mask_radius - r)
                search_width = max(1.0, mask_radius * (1.0 - self.search_depth_ratio))

                boundary_score = (1.0 - boundary_distance / search_width)
                boundary_score = np.clip(boundary_score, 0.0, 1.0)

                # Candidate score.
                score = (0.75 * edge_strength + 0.25 * boundary_score)
                candidates.append([x, y, r, score, theta])

            if not candidates:
                continue

            # Strongest candidates on this ray.
            candidates.sort(key=lambda p: p[3], reverse=True)
            candidates = candidates[:candidates_per_ray]

            results.extend(candidates)

        if not results:
            return np.empty((0, 5), dtype=np.float32)

        return np.asarray(results, dtype=np.float32)

    # FIT ELLIPSE
    def _fit_ellipse(self, points):
        xy = points[:, :2].astype(np.float32)

        if len(xy) < 5:
            return None

        best_ellipse = None
        best_inliers = None
        best_score = -np.inf

        n_points = len(xy)


        for _ in range(self.ransac_iterations):

            # Need at least 5 points for an ellipse.
            sample_indices = self._sample_diverse_points(points, n_samples=5)
            
            if sample_indices is None:
                continue

            sample = xy[sample_indices]

            try:
                ellipse = cv2.fitEllipse(sample)
            except cv2.error:
                continue

            # Reject degenerate ellipses.
            (cx, cy), (width, height), angle = ellipse

            if (width <= 0 or height <= 0):
                continue   

            candidate_x = points[:, 0]
            candidate_y = points[:, 1]

            min_x = np.min(candidate_x)
            max_x = np.max(candidate_x)

            min_y = np.min(candidate_y)
            max_y = np.max(candidate_y)

            if (width > (max_x - min_x) * 2.0 or
                height > (max_y - min_y) * 2.0):
                continue

            # Calculate residual for every candidate.
            residuals = (self._ellipse_residuals(ellipse, points))
            inliers = (residuals < self.ransac_threshold_px)

            n_inliers = np.sum(inliers)

            if n_inliers < 5:
                continue

            # Score the hypothesis.
            inlier_strength = np.mean(points[inliers, 3])

            # We want the ellipse supported around the entire rim, not just one section.
            inlier_angles = points[inliers, 4]
            n_bins = 36

            angle_bins = np.floor((inlier_angles / (2 * np.pi)) * n_bins).astype(int)
            angle_bins = np.clip(angle_bins, 0, n_bins - 1)
            angular_coverage = (len(np.unique(angle_bins)) /n_bins)

            # Residual quality.
            median_residual = np.median(residuals[inliers])

            residual_score = np.exp(-median_residual / 10.0)

            # Combined RANSAC score.
            inlier_score = (n_inliers / n_points)

            score = (
                0.45 * inlier_score +
                0.25 * inlier_strength +
                0.20 * angular_coverage +
                0.10 * residual_score
            )

            if score > best_score:
                best_score = score
                best_ellipse = ellipse
                best_inliers = inliers

        # No valid ellipse found.

        if best_ellipse is None:
            return None

        if best_inliers is None:
            return None

        inlier_points = points[best_inliers]

        if len(inlier_points) < 5:
            return None

        # Final refit using ALL RANSAC inliers.
        try:
            refined_ellipse = cv2.fitEllipse(
                inlier_points[:, :2].astype(np.float32)
            )
        except cv2.error:
            return best_ellipse

        print("RANSAC ellipse: ", refined_ellipse)
        print("RANSAC inliers:", len(inlier_points), "/", len(points))

        return refined_ellipse, inlier_points

    def _sample_diverse_points(self, points, n_samples=5):
        """
        Select points from different angular regions.

        This prevents RANSAC from choosing five points
        that all come from one tiny section of the rim.
        """

        if len(points) < n_samples:
            return None

        angles = points[:, 4]

        # Divide the circle into angular bins.
        bins = np.linspace(0, 2 * np.pi, n_samples + 1)

        selected = []

        for i in range(n_samples):

            low = bins[i]
            high = bins[i + 1]

            if i == n_samples - 1:
                valid = ((angles >= low) & (angles <= high))
            else:
                valid = ((angles >= low) & (angles < high))

            candidates = np.where(valid)[0]

            if len(candidates) == 0:
                return None

            # Prefer stronger candidates.
            candidate_scores = points[candidates, 3]
            probabilities = (candidate_scores + 1e-6)

            probabilities /= np.sum(probabilities)

            selected.append(np.random.choice(candidates, p=probabilities))

        return np.asarray(selected,dtype=np.int32)


    # ELLIPSE RESIDUALS
    def _ellipse_residuals(self, ellipse, points):

        xy = points[:, :2]

        (cx, cy), (width, height), angle = ellipse

        a = width / 2.0
        b = height / 2.0

        if (a <= 0 or b <= 0):
            return np.full(len(points), np.inf)

        angle = np.deg2rad(angle)
        cos_a = np.cos(angle)
        sin_a = np.sin(angle)

        dx = (xy[:, 0] - cx)
        dy = (xy[:, 1] - cy)

        # Rotate points into ellipse coordinates.
        xr = (dx * cos_a + dy * sin_a)
        yr = (-dx * sin_a + dy * cos_a)

        theta = np.arctan2(yr / b, xr / a)

        # Point on ellipse at same angular direction.
        ellipse_x = (a * np.cos(theta))
        ellipse_y = (b *np.sin(theta))

        # Difference between point and ellipse.
        diff_x = xr - ellipse_x
        diff_y = yr - ellipse_y

        residuals = np.sqrt(diff_x ** 2 + diff_y ** 2)

        return residuals

    # ELLIPSE POINTS
    def _ellipse_points(self, ellipse, n=720):
        """
        Sample points along an ellipse.
        """

        (cx, cy), (width,height), angle = ellipse

        a = width / 2
        b = height / 2

        theta = np.linspace(0, 2 * np.pi, n)
        angle = np.deg2rad(angle)

        cos_a = np.cos(angle)
        sin_a = np.sin(angle)

        x = (cx + a * np.cos(theta) * cos_a - b * np.sin(theta) * sin_a)
        y = (cy + a * np.cos(theta) * sin_a + b * np.sin(theta) * cos_a)

        return np.column_stack([x, y])

    # ELLIPSE → MASK SCORE
    def _mask_score(self, ellipse, mask):
        points = self._ellipse_points(ellipse)

        h, w = mask.shape

        x = np.round(points[:, 0]).astype(int)
        y = np.round(points[:, 1]).astype(int)

        valid = ((x >= 0) & (x < w) & (y >= 0) & (y < h))

        if not np.any(valid):
            return 0.0

        x = x[valid]
        y = y[valid]

        inside = []

        for dx in range(-self.mask_band, self.mask_band + 1):
            for dy in range(-self.mask_band, self.mask_band + 1):

                xx = x + dx
                yy = y + dy

                valid_neighbor = ((xx >= 0) & (xx < w) & (yy >= 0) & (yy < h))

                if np.any(valid_neighbor):
                    inside.append(mask[yy[valid_neighbor], xx[valid_neighbor]])

        if not inside:
            return 0.0

        inside = np.concatenate(inside)

        return float(np.mean(inside))

    # ELLIPSE → EDGE SCORE
    def _edge_score(self, ellipse, edge_map):
        points = self._ellipse_points(ellipse)

        h, w = edge_map.shape

        x = np.round(points[:, 0]).astype(int)
        y = np.round(points[:, 1]).astype(int)

        valid = ((x >= 0) & (x < w) & (y >= 0) & (y < h))

        if not np.any(valid):
            return 0.0

        x = x[valid]
        y = y[valid]

        values = []

        for dx in range(-self.edge_band, self.edge_band + 1):
            for dy in range(-self.edge_band, self.edge_band + 1):

                xx = x + dx
                yy = y + dy

                valid_neighbor = ((xx >= 0) & (xx < w) & (yy >= 0) & (yy < h))

                if np.any(valid_neighbor):
                    values.append(edge_map[yy[valid_neighbor], xx[valid_neighbor]])

        if not values:
            return 0.0

        values = np.concatenate(values)

        return float(np.mean(values))

    # ELLIPSE FIT ERROR
    def _ellipse_fit_error(self, ellipse, points):
        """
        Calculate how far observed rim points are
        from the fitted ellipse.

        Lower is better.
        """

        xy = points[:, :2]

        (cx, cy), (width, height), angle = ellipse

        a = width / 2
        b = height / 2

        if a <= 0 or b <= 0:
            return float("inf")

        theta = np.deg2rad(angle)

        cos_t = np.cos(theta)
        sin_t = np.sin(theta)

        dx = xy[:, 0] - cx
        dy = xy[:, 1] - cy

        xr = (dx * cos_t + dy * sin_t)
        yr = (-dx * sin_t + dy * cos_t)

        ellipse_value = ((xr / a) ** 2 +(yr / b) ** 2)

        # 1.0 means exactly on ellipse.
        error = np.abs(np.sqrt(ellipse_value) - 1)

        return float(np.median(error))

    # VALIDATION
    def _validate_ellipse(self, ellipse, points, mask, edge_map):
        """
        Determine whether the detected ellipse is
        geometrically plausible.
        """

        edge_score = self._edge_score(ellipse, edge_map)
        mask_score = self._mask_score(ellipse, mask)
        fit_error = self._ellipse_fit_error(ellipse, points)

        # Aspect ratio
        _, (width, height), _ = ellipse

        aspect = (min(width, height) / max(width, height))

        # Fit score
        fit_score = np.exp(-5.0 * fit_error)

        # Combined confidence
        confidence = (0.45 * edge_score + 0.30 * mask_score + 0.20 * fit_score + 0.05 * aspect)

        # Basic validation.
        valid = (
            len(points) >= self.min_points and
            mask_score > 0.70 and
            edge_score > 0.08 and
            fit_error < 0.15
        )

        return {
            "valid": valid,
            "confidence": float(confidence),
            "edge_score": float(edge_score),
            "mask_score": float(mask_score),
            "fit_error": float(fit_error)
        }

    # DEBUG VISUALIZATION
    def draw_result(self, image, result):
        """
        Draw detected rim and candidate points
        on the original image.
        """

        img = np.asarray(image).copy()

        # Draw rim points
        points = result["rim_points"]

        for x, y in points:
            cv2.circle(img, (int(x), int(y)), 2, (0, 255, 255), -1)

        # Draw ellipse
        ellipse = result["ellipse"]
        
        center = tuple(np.round(ellipse[0]).astype(int))
        axes = tuple(np.round(np.array(ellipse[1]) / 2).astype(int))

        angle = ellipse[2]

        cv2.ellipse(img, center, axes, angle, 0, 360, (255, 0, 0), 4)

        # Draw center
        cv2.circle(img, center, 5, (0, 255, 0), -1)

        return Image.fromarray(img)