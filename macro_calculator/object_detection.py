from transformers import pipeline
import torch

device = torch.device("cpu")
if torch.cuda.is_available():
    device = torch.device("cuda")
elif torch.backends.mps.is_available():
    device = torch.device("mps")

classifier = pipeline(
    "zero-shot-classification",
    model="facebook/bart-large-mnli",
    device=device
)

FOOD_TYPES = ["fruit", "vegetable", "meat", "seafood", "egg", "dairy product",
              "baked good", "prepared dish", "snack", "drink"]
NON_FOOD_TYPES = ["kitchenware", "furniture", "electronic device", "clothing",
                  "person", "animal", "tool or utensil", "packaging"]
 
 
def filter_foods(boxes, labels, threshold=0.5):
    """Keep detections whose label is most likely a kind of food. Returns (boxes, labels), paired.
    Does not modify the lists you pass in."""
    if len(boxes) != len(labels):
        raise ValueError("boxes and labels must have equal lengths")
    if not labels:
        return [], []
 
    unique = sorted(set(labels))                      # 13 detections are often only 3 distinct words
    results = classifier(
        unique,                                       # the premise is just the word, e.g. "orange"
        candidate_labels=FOOD_TYPES + NON_FOOD_TYPES,
        hypothesis_template="This word is a kind of {}.",
    )
    if isinstance(results, dict):                     # a single input returns a dict, not a list
        results = [results]
 
    food_score = {}
    for word, r in zip(unique, results):
        scores = dict(zip(r["labels"], r["scores"]))
        food_score[word] = sum(scores.get(t, 0.0) for t in FOOD_TYPES)   # all food categories together
        print(f"  nli: {word!r} food_score={food_score[word]:.2f}")
 
    kept = [(b, l) for b, l in zip(boxes, labels) if food_score[l] >= threshold]
    return [b for b, _ in kept], [l for _, l in kept]