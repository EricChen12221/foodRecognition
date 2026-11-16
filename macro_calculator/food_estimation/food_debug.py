"""Debug images for stage 1: what Florence saw, what SegFormer saw, and what was kept."""
import os
import time
import zlib

import numpy as np
from PIL import Image, ImageDraw


def _color(key):
    """Stable color per name, so a label looks the same in every image."""
    rng = np.random.RandomState(zlib.crc32(str(key).encode()) % (2 ** 32))
    return tuple(int(v) for v in rng.randint(50, 256, 3))


def _overlay(image, layers, alpha=0.55):
    """Blend colored masks onto a copy of the image. layers: (bool mask, rgb)."""
    arr = np.array(image, dtype=np.float32)
    for mask, color in layers:
        arr[mask] = (1 - alpha) * arr[mask] + alpha * np.array(color, dtype=np.float32)
    return Image.fromarray(arr.astype(np.uint8))


def _text(img, xy, text, color=(255, 255, 255)):
    ImageDraw.Draw(img).text(xy, text, fill=color, stroke_width=2, stroke_fill=(0, 0, 0))


def save_food_debug(out_dir, image, od, probs, foods, containers, analyzer):
    """Writes three JPEGs into out_dir and returns their paths.

    1_florence : every raw Florence box. green = kept as a food, gray = container, red = dropped
    2_segformer: SegFormer's class map over the whole photo, before any SAM (background not drawn)
    3_final    : the masks that were actually kept, with label and source (florence / segformer)
    """
    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.join(out_dir, f"food_debug_{os.getpid()}_{time.time_ns()}")
    paths = []

    # 1. Florence boxes
    kept = {tuple(f["box"]) for f in foods if f["source"] == "florence"}
    img = image.copy()
    draw = ImageDraw.Draw(img)
    for box, label in zip(od["bboxes"], od["labels"]):
        if tuple(box) in kept:
            color = (0, 200, 0)
        elif analyzer._is_container(label):
            color = (160, 160, 160)
        else:
            color = (230, 0, 0)
        draw.rectangle([float(v) for v in box], outline=color, width=3)
        _text(img, (box[0] + 4, box[1] + 2), label, color)
    paths.append(f"{stem}_1_florence.jpg")
    img.save(paths[-1])

    # 2. SegFormer class map over the whole photo
    seg = analyzer.segmenter
    cls = probs.argmax(dim=0).cpu().numpy().astype(np.uint8)
    cls = np.array(Image.fromarray(cls).resize(image.size, Image.NEAREST))
    layers, names = [], []
    for k in np.unique(cls):
        if int(k) in seg.background_ids:
            continue
        name = analyzer._normalize(seg.id2label[int(k)])
        region = cls == k
        layers.append((region, _color(name)))
        ys, xs = np.nonzero(region)
        names.append(((float(xs.mean()), float(ys.mean())), name))
    img = _overlay(image, layers)
    for xy, name in names:
        _text(img, xy, name)
    paths.append(f"{stem}_2_segformer.jpg")
    img.save(paths[-1])

    # 3. Final kept masks (containers in gray)
    layers = [(c["mask"], (128, 128, 128)) for c in containers]
    layers += [(f["mask"], _color(f["label"])) for f in foods]
    img = _overlay(image, layers)
    for f in foods:
        _text(img, (f["box"][0] + 4, f["box"][1] + 2), f"{f['label']} [{f['source']}]")
    paths.append(f"{stem}_3_final.jpg")
    img.save(paths[-1])

    return paths