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
                          MongoDB              (Florence-2, SAM, MoGe)
```

1. **Analyze.** The photo is sent to the Python server, which finds the container and each food.
2. **Check.** You pick which saved plate or bowl was used and fix any wrong food names.
3. **Estimate.** The server uses a depth map and your dish's diameter to estimate each food's volume.
4. **Convert.** Node multiplies volume by density and nutrition per 100 g from `foods.csv`.
5. **Log.** The meal is saved under today's date and the day's totals update.

## Tech stack

- **App:** React Native, TypeScript, React Navigation, `react-native-vision-camera`
- **API:** Node.js, Express, TypeScript, Mongoose
- **Database:** MongoDB
- **Vision:** Python 3.11, FastAPI, PyTorch, Florence-2, Segment Anything, MoGe

## Project structure

```
frontend/         React Native app (screens, hooks, API services)
backend/          Node API (routes, models, foods.csv)
macro_calculator/ Python vision server
```

## Setup

**You need:** a Mac with Apple Silicon, Python 3.11, Node.js 20+, MongoDB, Xcode with CocoaPods, and an iPhone on the same Wi-Fi as the Mac.

Start things in this order: Python, then Node, then the app.

### 1. Python server

```bash
cd macro_calculator
python3.11 -m venv moge_env && source moge_env/bin/activate
pip install fastapi uvicorn python-multipart torch transformers pillow numpy scipy matplotlib
```

Install MoGe and Segment Anything from their repositories, and download the SAM checkpoint
(`sam_vit_b_01ec64.pth`) into this folder. Then run:

```bash
uvicorn server:app --host 127.0.0.1 --port 8000
```

Wait for "Application startup complete". Keep it on `127.0.0.1` so only the Node server can reach it.

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

## Accuracy and limits

- **Estimates only.** Height comes from a single-photo depth model, so results vary. Thin foods like bread are the least reliable.
- **Dish diameter matters a lot.** Volume scales with its cube, so measure the outer rim with a ruler.
- **Hidden foods and saucy dishes** (stews, curries) are hard to measure and may need renaming.
- **Check the names.** The detector sometimes guesses wrong.
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

## Roadmap

- [x] Photo to detections, volumes and macros
- [x] Profile selection and food renaming
- [x] Anonymous accounts, goals and progress calendar
- [x] Logging meals into daily totals
- [X] Remove a logged meal from the Tracker
- [ ] Load today's meals into the Tracker at startup
- [ ] Better detection for mixed dishes and rice
- [ ] Support for several users
