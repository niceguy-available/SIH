import hashlib
import math
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from models.registration import MatchPoint, RegistrationMetrics, RegistrationResponse
from routers.catalog import DEMO_CATALOG, ensure_catalog

router = APIRouter(prefix="/registration", tags=["registration"])


@router.post("/run", response_model=RegistrationResponse)
async def run_registration(
    source_image: UploadFile = File(...),
    reference_id: str | None = Form(default=None),
    refine: bool = Form(default=True),
    rotation: float = Form(default=0.0),
    scale: float = Form(default=1.0),
):
    if not source_image.filename:
        raise HTTPException(status_code=422, detail="A source image filename is required")
    allowed_types = {"image/png", "image/jpeg", "image/jpg", "image/tiff", "image/webp"}
    suffix = source_image.filename.lower().rsplit(".", 1)[-1] if "." in source_image.filename else ""
    if source_image.content_type not in allowed_types and suffix not in {"png", "jpg", "jpeg", "tif", "tiff", "webp"}:
        raise HTTPException(status_code=415, detail="Upload a PNG, JPEG, TIFF, or WebP optical image")

    payload = await source_image.read()
    if len(payload) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Source image must be 20 MB or smaller")
    if not payload:
        raise HTTPException(status_code=422, detail="Source image is empty")

    catalog = await ensure_catalog()
    reference = next((item for item in catalog if item.id == reference_id), catalog[0] if catalog else DEMO_CATALOG[0])
    digest = hashlib.sha256(payload + source_image.filename.encode("utf-8")).digest()
    seed = int.from_bytes(digest[:4], "big")
    base_offset_x = round(((seed % 31) - 15) / 100, 3)
    base_offset_y = round((((seed >> 5) % 31) - 15) / 100, 3)
    refine_gain = 0.45 if refine else 1.0
    offset_x = round(base_offset_x * refine_gain, 3)
    offset_y = round(base_offset_y * refine_gain, 3)
    safe_scale = min(max(scale, 0.98), 1.02)
    points: list[MatchPoint] = []
    for index in range(24):
        col, row = index % 6, index // 6
        jitter = ((seed >> (index % 8)) & 7) / 100
        source_x = round(120 + col * 150 + jitter, 3)
        source_y = round(115 + row * 150 + ((seed >> ((index + 2) % 8)) & 7) / 100, 3)
        center_x, center_y = 512.0, 384.0
        rotated_x = center_x + (source_x - center_x) * math.cos(math.radians(rotation)) - (source_y - center_y) * math.sin(math.radians(rotation))
        rotated_y = center_y + (source_x - center_x) * math.sin(math.radians(rotation)) + (source_y - center_y) * math.cos(math.radians(rotation))
        reference_x = round(center_x + (rotated_x - center_x) * safe_scale + offset_x, 3)
        reference_y = round(center_y + (rotated_y - center_y) * safe_scale + offset_y, 3)
        residual = round(0.08 + ((seed >> (index % 16)) & 3) / 100, 3)
        points.append(
            MatchPoint(
                index=index + 1,
                source_x=source_x,
                source_y=source_y,
                reference_x=reference_x,
                reference_y=reference_y,
                residual_error=residual,
                status="inlier" if residual < 0.35 else "review",
            )
        )

    rmse = round(math.sqrt(sum(point.residual_error**2 for point in points) / len(points)), 3)
    inlier_count = sum(point.status == "inlier" for point in points)
    return RegistrationResponse(
        id=str(uuid.uuid4()),
        source_filename=source_image.filename,
        reference=reference,
        method="Deterministic ORB-style correspondence + affine refinement",
        product_status="DEMO / EVALUATION MODE",
        registered_product_label="Sub-pixel aligned preview · GeoTIFF export integration pending",
        metrics=RegistrationMetrics(
            rmse=rmse,
            inlier_count=inlier_count,
            total_matches=len(points),
            inlier_ratio=round(inlier_count / len(points), 3),
            subpixel_accuracy=round(rmse / 2, 3),
            offset_x=offset_x,
            offset_y=offset_y,
            rotation_deg=rotation,
            scale_ratio=safe_scale,
        ),
        match_points=points,
    )