"""AI service boundary for OpenCV, YOLO and OCR.

The actual model weights and inference pipeline belong here. The Express API
should persist recognition results in MySQL before exposing them to frontend.
"""

from fastapi import FastAPI

app = FastAPI(title="ITS Smart Traffic AI")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ready", "message": "AI pipeline chưa được cấu hình model"}


@app.post("/recognitions", status_code=501)
def recognize_video() -> dict[str, str]:
    return {"message": "Chưa cấu hình OpenCV/YOLO/OCR pipeline"}
