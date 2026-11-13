"""SegFormer food segmentation, wrapped in a class so model.py only calls methods.

Role in the pipeline:
  * propose():    find food regions (used because Florence often misses food)
  * label_mask(): name a region that SAM already outlined
Both work from one forward pass, `probs = segmenter.probs(image)`.
"""
import cv2
import numpy as np
import torch
import torch.nn.functional as F
from transformers import SegformerForSemanticSegmentation, SegformerImageProcessor


class FoodSegmenter:
    def __init__(
        self,
        repo,
        token=None,
        device="cpu",
        min_area_frac=0.004,   # ignore regions smaller than this fraction of the SegFormer map
        min_conf=0.35,         # mean top-class probability a region needs to count as real
        max_proposals=12,
    ):
        self.device = torch.device(device)
        self.min_area_frac = min_area_frac
        self.min_conf = min_conf
        self.max_proposals = max_proposals

        self.processor = SegformerImageProcessor.from_pretrained(repo, token=token)
        self.model = (
            SegformerForSemanticSegmentation.from_pretrained(repo, token=token)
            .to(self.device)
            .eval()
        )
        self.id2label = {int(i): n for i, n in self.model.config.id2label.items()}
        self.background_ids = {i for i, n in self.id2label.items() if "background" in str(n).lower()}

    # inference
    def probs(self, image):
        """One forward pass -> (num_classes, h, w) probabilities, background included.
        Covers the whole image regardless of aspect ratio."""
        inputs = self.processor(images=image, return_tensors="pt").to(self.device)
        with torch.inference_mode():
            logits = self.model(**inputs).logits       # (1, C, h, w)
        return logits.softmax(dim=1)[0]

    # proposals
    def propose(self, probs, img_w, img_h):
        """Connected single-class, non-background regions -> list of dicts with
        box / point (image pixel coords), class_name, area. Largest first."""
        _, h, w = probs.shape
        conf, cls = probs.max(dim=0)
        cls, conf = cls.cpu().numpy(), conf.cpu().numpy()
        sx, sy = img_w / w, img_h / h

        props = []
        for k in np.unique(cls):
            if int(k) in self.background_ids:
                continue
            n, lab, stats, _ = cv2.connectedComponentsWithStats(
                (cls == k).astype(np.uint8), connectivity=8
            )
            for j in range(1, n):
                x, y, bw, bh, area = [int(v) for v in stats[j]]
                if area < self.min_area_frac * h * w:
                    continue
                comp = lab == j
                if conf[comp].mean() < self.min_conf:
                    continue
                # point deepest inside the region: a good SAM prompt even for crescent shapes
                dist = cv2.distanceTransform(comp.astype(np.uint8), cv2.DIST_L2, 3)
                py, px = np.unravel_index(int(dist.argmax()), dist.shape)
                props.append({
                    "box": [x * sx, y * sy, (x + bw) * sx, (y + bh) * sy],
                    "point": [(px + 0.5) * sx, (py + 0.5) * sy],
                    "class_name": self.id2label[int(k)],
                    "area": area,
                })
        props.sort(key=lambda p: -p["area"])
        return props[: self.max_proposals]

    # labeling
    def label_mask(self, probs, mask):
        """Most likely FOOD class inside a SAM mask -> (label, confidence) or (None, 0.0).
        Confidence is the class's share of the food probability mass inside the mask."""
        _, h, w = probs.shape
        m = torch.from_numpy(np.asarray(mask, dtype=np.float32))[None, None].to(probs.device)
        m = F.interpolate(m, size=(h, w), mode="area")[0, 0]   # mask at SegFormer resolution
        if float(m.sum()) < 1e-6:
            return None, 0.0
        mean = (probs * m).sum(dim=(1, 2)) / m.sum()
        for i in self.background_ids:
            mean[i] = 0.0
        total = float(mean.sum())
        if total < 1e-6:
            return None, 0.0
        conf, idx = mean.max(dim=0)
        return self.id2label[int(idx)], float(conf) / total