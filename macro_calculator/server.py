"""
Backend for the app: receives the photo, runs your pipeline, returns JSON.

Run (from macro_calculator, with moge_env active):
    pip install fastapi uvicorn python-multipart
    uvicorn server:app --host 0.0.0.0 --port 8000
"""
import io
import os
import threading
import time
import traceback
import uuid

import numpy as np
import torch
from PIL import Image, ImageOps

from typing import List

# Optional: lets Pillow open HEIC photos if pillow-heif is installed.
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

SESSION_TTL_S = 15 * 60  # how long stage-1 results stay available for stage 2


import base64

class Cancelled(Exception):
    """Raised inside the pipeline when the request should stop."""

def crop_thumb(img, box, size=160, mask=None):
    if len(box) != 4:
        return None
    x1, y1, x2, y2 = [int(v) for v in box]
    x1, y1 = max(x1, 0), max(y1, 0)
    x2, y2 = min(x2, img.width), min(y2, img.height)
    if x2 - x1 < 2 or y2 - y1 < 2:
        return None
    crop = img.crop((x1, y1, x2, y2))
 
    if mask is not None:                                   # same size as the image: cut out the same area
        inside = np.asarray(mask)[y1:y2, x1:x2] > 0
        arr = np.array(crop)
        arr[~inside] = 128                                 # neutral gray outside this food
        crop = Image.fromarray(arr)
 
    crop.thumbnail((size, size))
    buf = io.BytesIO()
    crop.save(buf, format="JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode()

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


def serialize_foods(foods, img):
    """Keep only what the app needs; masks are far too large for JSON."""
    out = []
    for i, f in enumerate(foods):
        out.append({
            "id": i,
            "label": f.get("label"),
            "box": [float(x) for x in f.get("box", [])],
            "score": _py(f.get("score")),
            "thumbnail": crop_thumb(img, f.get("box", []), mask=f.get("mask", None))
        })
    return out


def serialize_containers(containers, img):
    return [
        {
            "id": f"container_{i}",
            "box": [float(x) for x in c.get("box", [])],
            "score": _py(c.get("score")),
            "thumbnail": crop_thumb(img, c.get("box", []))
        }
        for i, c in enumerate(containers)
    ]


def create_app():
    import asyncio
    from fastapi import Body, FastAPI, File, Header, HTTPException, Request, Response, UploadFile, Form
    from typing import Any, Dict, Optional

    from dish_calibration import shape_payload
    from model import calibrateDish, getFoodsAndContainers, estimateVolume  # imported here so the models load once, at startup

    app = FastAPI()
    analysis_lock = asyncio.Lock()         
    sessions = {}
    cancel_flags: Dict[str, threading.Event] = {}

    MAX_SESSIONS = 20
    MAX_WAITING = 4                      # people queued behind the one running
    counter = {"n": 0}
    latest_analyze: Dict[str, int] = {}  # user id -> that user's newest /analyze number
    waiting = {"n": 0}

    def purge_old_sessions():
        now = time.time()
        for k in [k for k, v in list(sessions.items()) if now - v["created"] > SESSION_TTL_S]:
            sessions.pop(k, None)
        while len(sessions) > MAX_SESSIONS:                      # memory cap: each session holds a photo and masks
            oldest = min(sessions, key=lambda k: sessions[k]["created"])
            sessions.pop(oldest, None)

    def warm_up():
        path = os.path.join(os.path.dirname(__file__), "yumgrub.jpg")
        t = time.perf_counter()
        with open(path, "rb") as f:
            img = load_upload(f.read())  # same path real uploads take
        with torch.inference_mode():
            foods, containers = getFoodsAndContainers(img)
            estimateVolume(foods, containers, img)
        print(f"Warm-up finished in {time.perf_counter() - t:.1f}s")

    def flag_for(request_id: str) -> threading.Event:
        if len(cancel_flags) > 500:          # a cancel for an id that never arrives must not pile up forever
            cancel_flags.clear()
        return cancel_flags.setdefault(request_id, threading.Event())
    
    try:
        warm_up()
    except Exception as e:
        traceback.print_exc()
        print(f"Warm-up failed (server will still start): {e}")

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.post("/cancel/{request_id}")
    def cancel(request_id: str):
        flag_for(request_id).set() 
        return {"ok": True}

    async def run_cancellable(request: Request, request_id: str, work, superseded=lambda: False):
        """Run work(should_stop) in a thread, one at a time. Raises Cancelled if it should not run or must stop."""
        flag = flag_for(request_id)
        if waiting["n"] >= MAX_WAITING:
            raise HTTPException(status_code=429, detail="The server is busy. Try again in a moment.")
        counted = True
        waiting["n"] += 1
        try:
            async with analysis_lock:
                waiting["n"] -= 1
                counted = False
                if flag.is_set() or superseded() or await request.is_disconnected():
                    raise Cancelled()        # cancelled, replaced or abandoned while waiting in line: never start

                def should_stop():
                    return flag.is_set() or superseded()

                async def watch():           # backup: a dropped connection counts as a cancel
                    while not flag.is_set():
                        if await request.is_disconnected():
                            flag.set()
                            return
                        await asyncio.sleep(0.5)

                watcher = asyncio.create_task(watch())
                try:
                    return await asyncio.to_thread(work, should_stop)
                finally:
                    watcher.cancel()
        finally:
            if counted:
                waiting["n"] -= 1                                # left the line without ever getting the lock
            cancel_flags.pop(request_id, None)

    @app.post("/calibrate")
    async def calibrate_endpoint(
        request: Request,
        image: UploadFile = File(...),
        diameter_m: float = Form(...),
        measured_depth_mm: Optional[float] = Form(None),
        x_request_id: Optional[str] = Header(None),
    ):
        if not (0.05 <= diameter_m <= 0.8):
            raise HTTPException(status_code=400, detail="diameter_m must be between 0.05 and 0.8.")
        try:
            img = load_upload(await image.read())
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        def work(should_stop):
            with torch.inference_mode():
                return calibrateDish(img, diameter_m, measured_depth_mm, should_stop)

        try:
            record, warnings = await run_cancellable(request, x_request_id or uuid.uuid4().hex, work)
        except Cancelled:
            return Response(status_code=499)
        except ValueError as e:                       # messages written for the user
            raise HTTPException(status_code=422, detail=str(e))

        return to_jsonable({"shape": shape_payload(record), "warnings": warnings})

    @app.post("/analyze")
    async def analyze(
        request: Request,
        image: UploadFile = File(...),
        x_request_id: Optional[str] = Header(None),
        x_user_id: Optional[str] = Header(None),
    ):
        user = x_user_id or "anonymous"
        request_id = x_request_id or uuid.uuid4().hex
        counter["n"] += 1
        mine = counter["n"]
        latest_analyze[user] = mine                                   # per user, not global
        superseded = lambda: latest_analyze.get(user) != mine

        raw = await image.read()
        try:
            img = load_upload(raw)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        def work(should_stop):
            with torch.inference_mode():
                return getFoodsAndContainers(img, should_stop)

        try:
            foods, containers = await run_cancellable(request, request_id, work, superseded)
        except Cancelled:
            if superseded():
                # the client may still be waiting, so give it a real answer
                raise HTTPException(status_code=409, detail="Replaced by a newer photo.")
            print("analyze cancelled: client left")
            return Response(status_code=499)             # nobody is listening, so this is only for the log

        for k in [k for k, v in sessions.items() if v.get("owner") == user]:
            sessions.pop(k, None)                                     # one session per user: old photo is replaced
        purge_old_sessions()
        session_id = uuid.uuid4().hex
        sessions[session_id] = {
            "created": time.time(),
            "owner": user,
            "image": img,
            "foods": foods,
            "containers": containers,
        }

        return {
            "session_id": session_id,
            "foods": serialize_foods(foods, img),
            "containers": serialize_containers(containers, img),
        }

    @app.post("/estimate")
    async def estimate(
        request: Request,
        session_id: str = Body(...),
        containers: List[Dict[str, Any]] = Body(default=[]),
        foods: Optional[List[Dict[str, Any]]] = Body(default=None),
        x_request_id: Optional[str] = Header(None),
        x_user_id: Optional[str] = Header(None)
    ):
        s = sessions.get(session_id)
        if s is None or s.get("owner") != (x_user_id or "anonymous"):
            raise HTTPException(status_code=404, detail="Session expired or unknown. Re-upload the photo.")

        if foods is None:
            chosen = s["foods"]
        else:
            stored = {i: f for i, f in enumerate(s["foods"])}   # the ids /analyze sent out
            chosen, seen = [], set()
            for item in foods:
                fid = item.get("id")
                new_label = item.get("newLabel")
                if fid not in stored:
                    raise HTTPException(status_code=400, detail=f"Unknown food id: {fid}")
                if fid in seen:
                    continue
                seen.add(fid)

                original = stored[fid].get("label")
                if new_label is None:
                    label = original
                elif isinstance(new_label, str) and new_label.strip() and len(new_label) <= 40:
                    label = new_label.strip().lower()
                else:
                    raise HTTPException(status_code=400, detail=f"newLabel for {fid} must be 1 to 40 characters.")
                chosen.append(dict(stored[fid], label=label, original_label=original))

        if not chosen:
            raise HTTPException(status_code=400, detail="Pick at least one food to measure.")

        profile_by_id = {c.get("id"): c.get("radial_profile") for c in containers}
        container_masks = [
            dict(c, radial_profile=profile_by_id.get(f"container_{i}"))
            for i, c in enumerate(s["containers"])
        ]

        def work(should_stop):
            with torch.inference_mode():
                return estimateVolume(chosen, container_masks, s["image"], should_stop)

        try:
            volumes = await run_cancellable(request, x_request_id or uuid.uuid4().hex, work)
        except Cancelled:
            print("estimate cancelled: client left")
            return Response(status_code=499)
        except Exception as e:
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"Volume estimation failed: {e}")

        return {"volumes": to_jsonable(volumes)}

    return app


app = create_app()