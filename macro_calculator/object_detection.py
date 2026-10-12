from transformers import pipeline
import torch

device = torch.device("cpu")
if torch.cuda.is_available():
    device = torch.device("cuda")
elif torch.backends.mps.is_available():
    device = torch.device("mps")

clip = pipeline("zero-shot-image-classification",
                model="openai/clip-vit-base-patch32", device=device) 

FOOD = "a photo of food"
NOT_FOOD = "a photo of furniture, a utensil, an electronic device, a person, or a table"

def filter_foods(image, boxes, labels, threshold=0.6):
    """Keep only the detections whose crop CLIP judges to be food.
    Returns (boxes, labels) with the pairs still matched up."""
    if not boxes:
        return [], []

    crops = []
    for b in boxes:
        x1, y1, x2, y2 = [int(v) for v in b]
        crops.append(image.crop((max(x1, 0), max(y1, 0), min(x2, image.width), min(y2, image.height))))

    results = clip(crops, candidate_labels=[FOOD, NOT_FOOD], hypothesis_template="{}")

    kept_boxes, kept_labels = [], []
    for box, label, preds in zip(boxes, labels, results):
        food_score = next(p["score"] for p in preds if p["label"] == FOOD)
        if food_score >= threshold:
            kept_boxes.append(box)
            kept_labels.append(label)
    return kept_boxes, kept_labels