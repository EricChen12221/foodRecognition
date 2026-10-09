"""
Backend for the app: receives the photo, runs your pipeline, returns JSON.

Run (from macro_calculator, with moge_env active):
    pip install fastapi uvicorn python-multipart
    uvicorn server:app --host 0.0.0.0 --port 8000
"""
import hmac
import io
import os
import threading

import numpy as np
from PIL import Image, ImageOps


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
    """Keep only what the app needs; masks and eval arrays are far too large for JSON."""
    out_foods, container_ids = [], []
    for i, f in enumerate(foods):
        cid = f.get("container")
        cid = None if cid in (None, "None") else str(cid)
        if cid is not None and cid not in container_ids:
            container_ids.append(cid)
        out_foods.append({
            "id": f"food_{i}",
            "label": f.get("label"),
            "containerId": cid,
            "box": [float(x) for x in f.get("box", [])],
            "score": _py(f.get("score")),
            "contained_fraction": _py(f.get("contained_fraction")),
            "volume_ml": _py(f.get("volume_ml")),
            "volume_ml_low": _py(f.get("volume_ml_low")),
            "volume_ml_high": _py(f.get("volume_ml_high")),
        })
    return {"containers": [{"id": c} for c in container_ids], "foods": out_foods}


def create_app():
    from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
    from typing import Optional

    from model import getFoods      # imported here so the models load once, at startup

    app = FastAPI()
    lock = threading.Lock()         # SAM's predictor keeps global state: one request at a time

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.post("/analyze")
    def analyze(
        image: UploadFile = File(...),
        plate_diameter_m: Optional[float] = Form(None),
        x_internal_key: Optional[str] = Header(None),     # header "x-internal-key"
    ):
        expected = os.environ.get("PYTHON_API_KEY")        # unset = no check (local dev)
        if expected and not hmac.compare_digest(x_internal_key or "", expected):
            raise HTTPException(status_code=401, detail="Invalid internal key.")
        try:
            img = load_upload(image.file.read())
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        with lock:
            foods = getFoods(img, plate_diameter_m=plate_diameter_m)
        return serialize_foods(foods)

    return app


try:
    import fastapi  # noqa: F401
except ImportError:                 # fastapi not installed: the helpers above still import
    app = None
else:
    # Any error from model.py (missing package, bad path, ...) now shows up as itself
    # instead of being hidden behind "app = None".
    app = create_app()