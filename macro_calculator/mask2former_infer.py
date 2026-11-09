"""Run the FoodSeg103 Mask2Former checkpoint (mericberktas/foodseg-models) on one image.
UNTESTED: written without network access.

Usage:
    python mask2former_infer.py yumgrub.jpg --overlay overlay.png
    python mask2former_infer.py yumgrub.jpg --device cpu     # if mps errors out
"""
import os
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")  # let unsupported mps ops fall back to CPU

import argparse
import numpy as np
import torch
from PIL import Image
from transformers import Mask2FormerForUniversalSegmentation, Mask2FormerImageProcessor

parser = argparse.ArgumentParser()
parser.add_argument("image")
parser.add_argument("--repo", default="mericberktas/foodseg-models")
parser.add_argument("--subfolder", default="foodseg103/mask2former")
parser.add_argument("--device", default=None, help="mps or cpu (default: mps if available)")
parser.add_argument("--min-frac", type=float, default=0.005)
parser.add_argument("--overlay", default=None, help="save a colored overlay PNG here")
parser.add_argument("--save-mask", default=None, help="save the class-ID map as PNG")
args = parser.parse_args()

device = args.device or ("mps" if torch.backends.mps.is_available() else "cpu")
print("device:", device)

model = Mask2FormerForUniversalSegmentation.from_pretrained(args.repo, subfolder=args.subfolder)
model.to(device).eval()

try:
    processor = Mask2FormerImageProcessor.from_pretrained(args.repo, subfolder=args.subfolder)
except Exception:
    print("no preprocessor config in repo, using default Mask2Former preprocessing")
    processor = Mask2FormerImageProcessor()

image = Image.open(args.image).convert("RGB")
inputs = processor(images=image, return_tensors="pt").to(device)

with torch.no_grad():
    outputs = model(**inputs)

class_map = processor.post_process_semantic_segmentation(
    outputs, target_sizes=[image.size[::-1]]
)[0].cpu().numpy()  # HxW class IDs

id2label = model.config.id2label
ids, counts = np.unique(class_map, return_counts=True)
print(f"\n{'id':>4}  {'label':<28} fraction")
for i, c in sorted(zip(ids, counts), key=lambda x: -x[1]):
    frac = c / class_map.size
    if frac >= args.min_frac:
        print(f"{int(i):>4}  {id2label.get(int(i), '?'):<28} {frac:.3f}")

print("\nlabels containing 'rice':", [(k, v) for k, v in id2label.items() if "rice" in v.lower()])

if args.overlay:
    rng = np.random.RandomState(0)
    palette = rng.randint(30, 255, size=(max(id2label) + 2, 3), dtype=np.uint8)
    palette[0] = 0  # background stays unpainted
    color = palette[class_map]
    base = np.asarray(image).astype(np.float32)
    blend = np.where((class_map > 0)[..., None], 0.5 * base + 0.5 * color, base)
    Image.fromarray(blend.astype(np.uint8)).save(args.overlay)
    print("saved overlay to", args.overlay)

if args.save_mask:
    Image.fromarray(class_map.astype(np.uint8)).save(args.save_mask)
    print("saved class map to", args.save_mask)