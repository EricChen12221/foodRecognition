from transformers import pipeline
import torch

device = torch.device("cpu")
if torch.cuda.is_available():
    device = torch.device("cuda")
elif torch.backends.mps.is_available():
    device = torch.device("mps")

clip = pipeline("zero-shot-image-classification",
                model="openai/clip-vit-base-patch32", device=device) 

CONTAINER_WORDS = {"plate", "bowl", "cup", "mug", "glass", "dish", "tray",
                   "platter", "container", "pan", "pot", "tableware", "dishware"}

def is_container(label):
    words = label.lower().replace("-", " ").split()
    return bool(words) and words[-1] in CONTAINER_WORDS


FOOD = "a photo of food"
NOT_FOOD = "a photo of furniture, a utensil, an electronic device, a person, or a table"

def food_flags(image, boxes, threshold=0.6):
    crops = []
    for b in boxes:
        x1, y1, x2, y2 = [int(v) for v in b]
        crops.append(image.crop((max(x1, 0), max(y1, 0), min(x2, image.width), min(y2, image.height))))
    if not crops:
        return []
    results = clip(crops, candidate_labels=[FOOD, NOT_FOOD], hypothesis_template="{}")
    flags = []
    for preds in results:
        food_score = next(p["score"] for p in preds if p["label"] == FOOD)
        flags.append(food_score >= threshold)
    return flags