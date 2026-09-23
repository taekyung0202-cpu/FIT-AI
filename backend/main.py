from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

# CORS 설정 (프론트엔드 연동 지원)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class BodyMetrics(BaseModel):
    height: float
    weight: float
    chest: float
    waist: float
    pelvis: float

@app.get("/")
def read_root():
    return {"status": "AI Body Fitting Backend Running"}

@app.post("/predict")
def predict_body_shape(metrics: BodyMetrics):
    # 입력 수치에 비례한 scale 계산 (기본값 기준: 가슴 95cm, 허리 80cm, 골반 97cm)
    chest_scale = round(metrics.chest / 95.0, 2)
    waist_scale = round(metrics.waist / 80.0, 2)
    pelvis_scale = round(metrics.pelvis / 97.0, 2)

    return {
        "chest_scale": chest_scale,
        "waist_scale": waist_scale,
        "pelvis_scale": pelvis_scale
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)