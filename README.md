# Food Recognition

A personal React Native app that estimates the calories, protein, carbs and fat of a meal from one photo.

> **Work in progress.** Estimates are rough. Treat them as estimates, not measurements.

## What it does

- Finds the plate or bowl and each food on it from a photo
- Estimates how much of each food there is, using the dish's real size
- Turns that into calories and macros using a CSV of about a hundred foods you can edit
- Lets you rename foods the detector got wrong
- Tracks daily goals, with rings on the Tracker and a progress calendar
- Saves your bowl and plate sizes so the scale is right
- Signs you in automatically with an anonymous account

## How it works

```
Phone (React Native)  ->  Node / Express  ->  Python / FastAPI
camera and UI             accounts, macros,    vision models
                          MongoDB              (Florence-2, SegFormer, SAM, MoGe)
```

1. **Analyze.** The photo is sent to the Python server, which finds the container and each food (see below).
2. **Check.** You pick which saved plate or bowl was used and fix any wrong food names.
3. **Estimate.** The server uses a depth map and your dish's diameter to estimate each food's volume.
4. **Convert.** Node multiplies volume by density and nutrition per 100 g from `foods.csv`.
5. **Log.** The meal is saved under today's date and the day's totals update.

### What the vision server does

**Stage 1: find the foods and the dish.**

- **Florence-2** detects objects in the photo and finds the plate or bowl.
- **SAM** (Segment Anything) outlines each detection.
- **SegFormer**, trained on FoodSeg103, checks that each outline is really food, names it, and finds food regions Florence missed.
- Duplicate and merged masks (for example one box around several eggs) are removed.

**Stage 2: measure.**

- **MoGe** estimates a depth map. The plate rim and your dish's diameter set the scale.
- Each food's volume comes from its mask and its height above the dish.

## Debugging with images

Set `DEBUG_FOOD_DIR` and `DEBUG_RIM_DIR` in `macro_calculator/.env` (or export them) before starting the Python server. Each analysis then saves images showing what the models did. The examples below are from one photo: pan-seared fish with green beans in a white bowl.

### Food segmentation

`DEBUG_FOOD_DIR=/some/folder` saves three images per analysis, one for each step of finding foods.

**1. Florence-2 detection** (`_1_florence.jpg`)

Every box Florence found. Green is kept as a food, gray is treated as the container, and red is dropped.

![Florence detections](./macro_estimator/debug_food/1_florence.jpg)

The bowl is gray and the green vegetables are kept. The person and footwear boxes are red because SegFormer says they are not food. Florence missed the fish entirely, which the next step catches.

**2. SegFormer** (`_2_segformer.jpg`)

What SegFormer sees across the whole photo, before any SAM outlining.

![SegFormer output](./macro_estimator/debug_food/2_segformer.jpg)

SegFormer finds the fish, but it splits the vegetables into two overlapping classes: "asparagus" and "french beans". Its masks are blocky because it predicts at low resolution.

**3. Final foods** (`_3_final.jpg`)

The masks that were kept, each labelled with its name and where it came from: `florence`, `segformer` or `residual`.

![Final foods](./macro_estimator/debug_food/3_final.jpg)

The vegetables come from Florence and are outlined cleanly by SAM, and they take the name "french beans". The fish comes from SegFormer, which found it after Florence missed it. The overlapping "asparagus" region was dropped as a duplicate, because most of it was already covered by the french beans mask.

If a food is missing from the final image, check the first two images to see whether Florence or SegFormer saw it. If a name is wrong, rename it in the app. SegFormer's names come from FoodSeg103.

### Rim detection

`DEBUG_RIM_DIR=/some/folder` saves one image per container, showing the rim the server found. The rim sets the scale for every volume estimate.

![Detected rim](./macro_estimator/debug_rim/rim.jpg)

The red ellipse is the fitted rim. The magenta and yellow points are the edge pixels that support the fit, and the green dot is the ellipse center. A good result looks like this one, with the ellipse hugging the outer edge of the bowl and edge points covering most of the circumference.

Rims whose edge support (arc coverage) is below 0.5 are rejected, and the container is skipped. Signs of a bad rim:

- The ellipse is visibly bigger or smaller than the dish.
- Edge points cover only one side of the dish.
- The ellipse follows a shadow, a countertop pattern or a table edge instead of the rim.

If the rim fails, retake the photo from directly above with the whole dish in frame, on a plain surface with even light.

The startup warm-up photo also writes debug images, so you will see a set as soon as the server is ready.

## Tech stack

- **App:** React Native, TypeScript, React Navigation, `react-native-vision-camera`
- **API:** Node.js, Express, TypeScript, Mongoose
- **Database:** MongoDB
- **Vision:** Python 3.11, FastAPI, PyTorch, Florence-2, SegFormer (FoodSeg103), Segment Anything, MoGe

## Project structure

```
frontend/         React Native app (screens, hooks, API services)
backend/          Node API (routes, models, foods.csv)
macro_calculator/ Python vision server
  server.py              FastAPI endpoints (/calibrate, /analyze, /estimate)
  model.py               MealAnalyzer: runs the vision models
  pipeline.py            volume measurement and duplicate removal
  errors.py              shared exceptions
  models/                depth estimation, SegFormer wrapper, classifier
  profile_estimations/   rim detection, dish calibration, container shape
  food_estimation/       food alignment, volume calculation, debug images
```

## Setup

**You need:** a Mac with Apple Silicon, Python 3.11, Node.js 20+, MongoDB, Xcode with CocoaPods, and an iPhone on the same Wi-Fi as the Mac.

Start things in this order: Python, then Node, then the app.

### 1. Python server

```bash
cd macro_calculator
python3.11 -m venv moge_env && source moge_env/bin/activate
pip install fastapi uvicorn python-multipart torch transformers pillow numpy scipy matplotlib opencv-python python-dotenv
```

Install MoGe and Segment Anything from their repositories, and download the SAM checkpoint
(`sam_vit_b_01ec64.pth`) into this folder.

Create `macro_calculator/.env`:

```
SEGFORMER_REPO=<Hugging Face repo id of your food segmentation model>
HF_TOKEN=<your Hugging Face token>
```

`HF_TOKEN` is only needed if the SegFormer repo is private. Keep this file out of git.

Then run:

```bash
uvicorn server:app --host 127.0.0.1 --port 8000
```

The first start downloads the Florence-2 and SegFormer models, so it is slow. Later starts use the local cache.
Wait for "Application startup complete". Keep it on `127.0.0.1` so only the Node server can reach it.

Optional settings (in the same `.env`):

| Variable | What it does |
|---|---|
| `SEGFORMER_REPO` | Hugging Face repo id of the food segmentation model. Falls back to a built-in default. |
| `HF_TOKEN` | Token for private Hugging Face repos. |
| `DEBUG_FOOD_DIR` | Saves food debug images for each analysis (see Debugging). |
| `DEBUG_RIM_DIR` | Saves the detected plate rim for each estimate (see Debugging). |

### 2. Node API

```bash
cd backend
npm install
```

Create `backend/.env`:

```
PORT=3000
PYTHON_URL=http://127.0.0.1:8000
PYTHON_TIMEOUT_MS=180000
MONGODB_URI=<your MongoDB connection string>
```

Put `foods.csv` at `backend/data/foods.csv`, then start the server (for example `npm run dev`).

### 3. The app

```bash
cd frontend
npm install
cd ios && pod install && cd ..
```

Create `frontend/.env` using your Mac's address (`ipconfig getifaddr en0`), not `localhost`:

```
API_URL=http://<your-mac-ip>:3000/api
```

```bash
npx react-native start --reset-cache
npx react-native run-ios --device
```

Rebuild the iOS app whenever you add a package with native code. A JavaScript reload is not enough.

## Food data

`foods.csv` has one row per food: `name, density, kcal, protein, fat, carbs, basis`.
Density is g/ml, nutrition is per 100 g, and `basis` is `solid`, `pile` or `liquid`.
The values are approximate, so check the ones you rely on and add the foods you eat.

SegFormer's food names come from FoodSeg103 and some are unusual (for example "hamburg" for hamburger).
Names that aren't in `foods.csv` show "no estimate" until you add a row or rename the food in the app.

## Performance

On the warm-up photo (`yumgrub.jpg`: eggs, carrots, orange slices and two muffins on one plate), the Python
server takes about **16 seconds** on average to run both stages, finding the foods and then estimating
volumes. This was measured on Apple Silicon using MPS. It does not include uploading the photo or the Node step.

- The server runs this photo once at startup, so the first real request doesn't pay the model warm-up cost.
- Uploads are resized to 1280 px on the longest side, so large originals don't add time.
- Plates with more foods take longer, because each food needs its own mask.
- Photos are processed one at a time. Up to four more can wait in line before the server answers "busy" (429).

## Debugging

Set these in `macro_calculator/.env` (or export them) before starting the Python server. Each saves
images into the folder you give, so you can see what the models did.

**`DEBUG_FOOD_DIR=/some/folder`** saves three images for every analysis:

| File ends with | Shows |
|---|---|
| `_1_florence.jpg` | Every box Florence found. Green = kept as a food, gray = treated as the container, red = dropped. |
| `_2_segformer.jpg` | What SegFormer sees across the whole photo, before any SAM outlining. |
| `_3_final.jpg` | The masks that were kept, each labelled with its name and where it came from: `florence`, `segformer` or `residual`. |

**`DEBUG_RIM_DIR=/some/folder`** saves an image of the detected plate rim for each container.

The startup warm-up also writes debug images, so you will see a set as soon as the server is ready.

## Accuracy and limits

- **Estimates only.** Height comes from a single-photo depth model, so results vary. Thin foods like bread are the least reliable.
- **Dish diameter matters a lot.** Volume scales with its cube, so measure the outer rim with a ruler.
- **Hidden foods and saucy dishes** (stews, curries) are hard to measure and may need renaming.
- **Check the names.** The detector sometimes guesses wrong, and SegFormer can split one food across several odd names (a muffin may show up as "bread" or "pie").
- **One photo at a time.** Built for one person or a few, not many users at once.
- **Accounts belong to the install.** Deleting the app loses the account.

## Troubleshooting

| Problem | Fix |
|---|---|
| `502` or "Could not reach the analysis server" | The Python server isn't running. Check its terminal. |
| `zsh: killed` on Python startup | The Mac ran out of memory. Close other apps. |
| "Network request timed out" | Check `API_URL` matches your Mac's IP, both devices are on the same Wi-Fi, and no VPN or firewall is blocking. |
| `404` on any call | The URL has a doubled or missing `/api`. |
| "AsyncStorage is null" | Rebuild the iOS app after `pod install`. |
| "No foods were found" | Retake the photo with better light and the whole plate in view. |
| Estimate looks too high or low | Check the profile's diameter. |
| `401` or "Repository Not Found" from Hugging Face on startup | Set `HF_TOKEN` in `macro_calculator/.env` and check `SEGFORMER_REPO` is spelled exactly as on huggingface.co. |
| "Warm-up failed (server will still start)" | Read the traceback printed above that line. The server starts anyway, but real requests will probably fail the same way. |
| `ModuleNotFoundError` after moving files | Imports use the full folder path, for example `from profile_estimations.rim_detection import RimDetector`. Run uvicorn from `macro_calculator/`. |

## Roadmap

- [x] Photo to detections, volumes and macros
- [x] Profile selection and food renaming
- [x] Anonymous accounts, goals and progress calendar
- [x] Logging meals into daily totals
- [X] Remove a logged meal from the Tracker
- [X] Load today's meals into the Tracker at startup
- [X] Better detection for mixed dishes and rice
- [ ] More accurate macro estimation 
