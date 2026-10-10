"""
Backend for the app: receives the photo, runs your pipeline, returns JSON.

Run (from macro_calculator, with moge_env active):
    pip install fastapi uvicorn python-multipart
    uvicorn server:app --host 0.0.0.0 --port 8000
"""
import hmac
import io
import os, time
import threading

import numpy as np
from PIL import Image, ImageOps

# Optional: lets Pillow open HEIC photos if pillow-heif is installed.
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass


def load_upload(data: bytes) -> Image.Image:
    """Uploaded bytes -> upright RGB PIL image.
    Phones usually store rotation in EXIF instead of rotating the pixels, and PIL
    ignores it unless told to, so without exif_transpose the image (and every mask
    and depth value computed from it) can come out sideways."""
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
        return img.convert("RGB")
    except Exception as e:
        raise ValueError("The upload is not a readable image.") from e


def _py(v):
    """numpy scalars/arrays -> plain Python so json can handle them."""
    if v is None:
        return None
    if isinstance(v, np.generic):
        return v.item()
    if isinstance(v, np.ndarray):
        return v.tolist()
    return v


def serialize_foods(foods):
    """Keep only what the app needs; masks are far too large for JSON."""
    out = []
    for i, f in enumerate(foods):
        out.append({
            "id": f"food_{i}",
            "label": f.get("label"),
            "box": [float(x) for x in f.get("box", [])],
            "score": _py(f.get("score")),
        })
    return out


def serialize_containers(containers):
    return [
        {
            "id": f"container_{i}",
            "box": [float(x) for x in c.get("box", [])],
            "score": _py(c.get("score")),
        }
        for i, c in enumerate(containers)
    ]


def create_app():
    from fastapi import FastAPI, File, Header, HTTPException, UploadFile
    from typing import Optional

    from model import getFoodsAndContainers, estimateVolume  # imported here so the models load once, at startup

    app = FastAPI()
    lock = threading.Lock()  # SAM's predictor keeps global state: one request at a time

    def warm_up():
        path = os.path.join(os.path.dirname(__file__), "yumgrub.jpg")
        t = time.perf_counter()
        img = load_upload(open(path, "rb").read())   # same path real uploads take
        foods, containers = getFoodsAndContainers(img)
        estimateVolume(foods, containers, img)
        print(f"Warm-up finished in {time.perf_counter() - t:.1f}s")

    with lock:
        warm_up()

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.post("/analyze")
    def analyze(
        image: UploadFile = File(...),
        x_internal_key: Optional[str] = Header(None),  # header "x-internal-key"
    ):
        expected = os.environ.get("PYTHON_API_KEY")  # unset = no check (local dev)
        if expected and not hmac.compare_digest(x_internal_key or "", expected):
            raise HTTPException(status_code=401, detail="Invalid internal key.")

        raw = image.file.read()
        try:
            img = load_upload(raw)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        with lock:
            foods, containers = getFoodsAndContainers(img)

        return {
            "foods": serialize_foods(foods),
            "containers": serialize_containers(containers),
        }

    return app


try:
    import fastapi  # noqa: F401
except ImportError:  # fastapi not installed: the helpers above still import
    app = None
else:
    # Any error from model.py (missing package, bad path, ...) now shows up as itself
    # instead of being hidden behind "app = None".
    app = create_app()