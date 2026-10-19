from transformers import pipeline
import torch

device = torch.device("cpu")
if torch.cuda.is_available():
    device = torch.device("cuda")
elif torch.backends.mps.is_available():
    device = torch.device("mps")

clip = pipeline("zero-shot-image-classification",
                model="openai/clip-vit-base-patch32", device=device) 

FOOD_PROMPTS = [
    "a close-up photo of food",
    "a photo of a meal",
    "a photo of a snack",
]
NON_FOOD_PROMPTS = [
    "a photo of a table",
    "a photo of a desk",
    "a photo of a kitchen countertop",
    "a photo of a bowl",
    "a photo of a plate",
    "a photo of a plastic bag",
    "a photo of a laptop or a phone",
    "a photo of a hand",
    "a photo of a cable",
    "a photo of a fork, knife or spoon",
]
 
 
def filter_foods(image, boxes, labels, threshold=0.5):
    """Keep detections whose crop CLIP judges to be food. Returns (boxes, labels), still paired."""
    if not boxes:
        return [], []
 
    crops = []
    for b in boxes:
        x1, y1, x2, y2 = [int(v) for v in b]
        crops.append(image.crop((max(x1, 0), max(y1, 0), min(x2, image.width), min(y2, image.height))))
 
    candidates = FOOD_PROMPTS + NON_FOOD_PROMPTS
    results = clip(crops, candidate_labels=candidates, hypothesis_template="{}")
 
    kept_boxes, kept_labels = [], []
    for box, label, preds in zip(boxes, labels, results):
        food_score = sum(p["score"] for p in preds if p["label"] in FOOD_PROMPTS)
        print(f"  clip: {label!r} food_score={food_score:.2f} top={preds[0]['label']!r}")
        if food_score >= threshold:
            kept_boxes.append(box)
            kept_labels.append(label)
    return kept_boxes, kept_labels