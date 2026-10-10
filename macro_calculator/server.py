"""
Backend for the app: receives the photo, runs your pipeline, returns JSON.

Run (from macro_calculator, with moge_env active):
    pip install fastapi uvicorn python-multipart
    uvicorn server:app --host 0.0.0.0 --port 8000

Two-stage flow:
    1. POST /analyze   (image)                      -> foods + containers + session_id
       ... user reviews detections and enters radial profiles in the app ...
    2. POST /estimate  (session_id, radial_profiles) -> depth + volumes
"""
import hmac
import io
import os
import threading
import time
import traceback
import uuid

import numpy as np
import torch
from PIL import Image, ImageOps

# Optional: lets Pillow open HEIC photos if pillow-heif is installed.
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

SESSION_TTL_S = 15 * 60  # how long stage-1 results stay available for stage 2


def load_upload(data: bytes) -> Image.Image:
    """Uploaded bytes -> upright, resized RGB PIL image.
    Phones usually store rotation in EXIF instead of rotating the pixels, and PIL
    ignores it unless told to, so without exif_transpose the image (and every mask
    and depth value computed from it) can come out sideways.
    Resizing once here keeps masks, depth and rims consistent downstream."""
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")
        img.thumbnail((1280, 1280))  # in-place, keeps aspect ratio
        return img
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


def to_jsonable(v):
    """Recursively make a result JSON-safe. Large arrays (masks, depth maps) are dropped."""
    if isinstance(v, np.generic):
        return v.item()
    if isinstance(v, np.ndarray):
        return None if v.size > 1000 else v.tolist()
    if isinstance(v, dict):
        return {str(k): to_jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [to_jsonable(x) for x in v]
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
    from pydantic import BaseModel
    from typing import Any, Dict, Optional

    from model import getFoodsAndContainers, estimateVolume  # imported here so the models load once, at startup

    app = FastAPI()
    lock = threading.Lock()  # SAM's predictor keeps global state: one request at a time
    sessions = {}            # session_id -> {"created", "image", "foods", "containers"}

    class EstimateRequest(BaseModel):
        session_id: str
        # food id (e.g. "food_0") -> that food's radial profile, exactly as the app sends it
        radial_profiles: Dict[str, Any] = {}
        plate_diameter_m: Optional[float] = None

    def check_key(x_internal_key):
        expected = os.environ.get("PYTHON_API_KEY")  # unset = no check (local dev)
        if expected and not hmac.compare_digest(x_internal_key or "", expected):
            raise HTTPException(status_code=401, detail="Invalid internal key.")

    def purge_old_sessions():
        now = time.time()
        for k in [k for k, v in list(sessions.items()) if now - v["created"] > SESSION_TTL_S]:
            sessions.pop(k, None)

    def warm_up():
        path = os.path.join(os.path.dirname(__file__), "yumgrub.jpg")
        t = time.perf_counter()
        with open(path, "rb") as f:
            img = load_upload(f.read())  # same path real uploads take
        with torch.inference_mode():
            foods, containers = getFoodsAndContainers(img)
            estimateVolume(foods, containers, img)
        print(f"Warm-up finished in {time.perf_counter() - t:.1f}s")

    try:
        with lock:
            warm_up()
    except Exception as e:
        print(f"Warm-up failed (server will still start): {e}")

    @app.get("/health")
    def health():
        return {"ok": True}

    # ---- Stage 1: detection + segmentation -------------------------------------------
    @app.post("/analyze")
    def analyze(
        image: UploadFile = File(...),
        x_internal_key: Optional[str] = Header(None),  # header "x-internal-key"
    ):
        check_key(x_internal_key)

        raw = image.file.read()
        try:
            img = load_upload(raw)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        with lock, torch.inference_mode():
            foods, containers = getFoodsAndContainers(img)

        # Masks live only on the server (too big for JSON), so keep them for stage 2.
        purge_old_sessions()
        session_id = uuid.uuid4().hex
        sessions[session_id] = {
            "created": time.time(),
            "image": img,
        }

        return {
            "session_id": session_id,
            "foods": serialize_foods(foods),
            "containers": serialize_containers(containers),
        }

    # ---- Stage 2: depth + volume, using the user's radial profiles -------------------
    @app.post("/estimate")
    def estimate(req: EstimateRequest, x_internal_key: Optional[str] = Header(None)):
        check_key(x_internal_key)

        s = sessions.get(req.session_id)
        if s is None:
            raise HTTPException(status_code=404, detail="Session expired or unknown. Re-upload the photo.")

        valid_ids = {f"food_{i}" for i in range(len(s["foods"]))}
        unknown = set(req.radial_profiles) - valid_ids
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown food ids: {sorted(unknown)}")

        try:
            with lock, torch.inference_mode():
                volumes = estimateVolume(
                    s["foods"], s["containers"], s["image"],
                    plate_diameter_m=req.plate_diameter_m,
                    radial_profiles=req.radial_profiles,
                )
        except Exception as e:
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"Volume estimation failed: {e}")

        # Session stays alive until it expires, so the user can tweak profiles and re-run.
        return {"volumes": to_jsonable(volumes)}

    return app


try:
    import fastapi  # noqa: F401
except ImportError:  # fastapi not installed: the helpers above still import
    app = None
else:
    # Any error from model.py (missing package, bad path, ...) now shows up as itself
    # instead of being hidden behind "app = None".
    app = create_app()