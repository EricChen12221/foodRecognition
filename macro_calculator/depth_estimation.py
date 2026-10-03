import hashlib
import os
from functools import lru_cache

import cv2
import numpy as np

# Smaller = faster. vits ~35M params, vitb ~100M, vitl ~326M.
DEFAULT_MODEL = "Ruicheng/moge-2-vitb-normal"

def pick_device():
    import torch
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


@lru_cache(maxsize=2)
def load_model(name=DEFAULT_MODEL, device=None):
    """Load once per process; reloading the weights every call is slow."""
    from moge.model.v2 import MoGeModel
    device = device or pick_device()
    model = MoGeModel.from_pretrained(name).to(device).eval()
    return model, device


def _to_np(x):
    return x.detach().cpu().numpy() if hasattr(x, "detach") else np.asarray(x)


def _run_moge(model_and_device, rgb_small, resolution_level):
    """The only place that touches torch / MoGe. Returns depth, mask, intrinsics."""
    import torch
    model, device = model_and_device
    x = torch.tensor(rgb_small / 255.0, dtype=torch.float32, device=device).permute(2, 0, 1)
    with torch.no_grad():
        # fp16 only on CUDA; it is unreliable on MPS/CPU
        out = model.infer(x, resolution_level=resolution_level,
                          use_fp16=(device.type == "cuda"))
    return _to_np(out["depth"]), _to_np(out["mask"]), _to_np(out["intrinsics"])


def _upsample_depth(depth, valid, size):
    """Resize depth to (W, H) without letting invalid pixels bleed into valid ones."""
    W, H = size
    d = np.where(valid, depth, 0.0).astype(np.float32)
    m = valid.astype(np.float32)
    d_up = cv2.resize(d, (W, H), interpolation=cv2.INTER_LINEAR)
    m_up = cv2.resize(m, (W, H), interpolation=cv2.INTER_LINEAR)
    out = np.full((H, W), np.nan, dtype=np.float32)
    ok = m_up > 0.5
    out[ok] = d_up[ok] / m_up[ok]
    return out


def estimate_depth(image, model=None, max_side=768, resolution_level=6,
                   cache_dir=None, infer_fn=None):
    """
    image: RGB uint8 array (H, W, 3) or a path to an image file.
    Returns dict:
        depth      (H, W) float32 metric z-depth at the ORIGINAL image size,
                   NaN where the model says the pixel is invalid
        focal_px   focal length in pixels of the ORIGINAL image
        fov_x_deg  horizontal field of view

    max_side: longest side the model sees. Lower = faster (try 512-768).
    resolution_level: MoGe quality/speed knob; lower is faster. Check the
        MoGeModel.infer docstring for the valid range.
    infer_fn: override the model call (used for testing).
    """
    if isinstance(image, (str, os.PathLike)):
        image = cv2.cvtColor(cv2.imread(str(image)), cv2.COLOR_BGR2RGB)
    H, W = image.shape[:2]

    key = None
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
        h = hashlib.sha1(image.tobytes())
        h.update(f"{DEFAULT_MODEL}|{max_side}|{resolution_level}".encode())
        key = os.path.join(cache_dir, h.hexdigest() + ".npz")
        if os.path.exists(key):
            z = np.load(key)
            return {"depth": z["depth"], "focal_px": float(z["focal_px"]),
                    "fov_x_deg": float(z["fov_x_deg"])}

    scale = min(1.0, max_side / max(H, W))
    small = image if scale == 1.0 else cv2.resize(
        image, (round(W * scale), round(H * scale)), interpolation=cv2.INTER_AREA)

    run = infer_fn or _run_moge
    if infer_fn is None:
        model = model or load_model()
    depth_s, mask_s, Kn = run(model, small, resolution_level)

    depth = _upsample_depth(depth_s, mask_s.astype(bool) & np.isfinite(depth_s), (W, H))

    # MoGe intrinsics are normalised (fx relative to image width), so they are
    # independent of the resolution the model ran at.
    focal_px = float(Kn[0, 0] * W)
    fov_x = float(np.degrees(2 * np.arctan(0.5 / Kn[0, 0])))

    if key:
        np.savez_compressed(key, depth=depth, focal_px=focal_px, fov_x_deg=fov_x)
    return {"depth": depth, "focal_px": focal_px, "fov_x_deg": fov_x}