import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from lib.registration_engine import RESULTS_DIR, RegistrationError, decode_image, fetch_reference, register_images, write_outputs
from models.registration import RegistrationResponse
from routers.catalog import DEMO_CATALOG, ensure_catalog

router = APIRouter(prefix="/registration", tags=["registration"])


@router.post("/run", response_model=RegistrationResponse)
async def run_registration(
    source_image: UploadFile = File(...),
    reference_id: str | None = Form(default=None),
    refine: bool = Form(default=True),
    method: str = Form(default="auto"),
):
    if not source_image.filename:
        raise HTTPException(status_code=422, detail="A source image filename is required")
    suffix = source_image.filename.lower().rsplit(".", 1)[-1] if "." in source_image.filename else ""
    if source_image.content_type not in {"image/png", "image/jpeg", "image/jpg", "image/tiff", "image/webp"} and suffix not in {"png", "jpg", "jpeg", "tif", "tiff", "webp"}:
        raise HTTPException(status_code=415, detail="Upload a PNG, JPEG, TIFF, or WebP optical image")
    if method not in {"auto", "sift", "orb"}:
        raise HTTPException(status_code=422, detail="Method must be auto, sift, or orb")
    payload = await source_image.read()
    if len(payload) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Source image must be 20 MB or smaller")
    if not payload:
        raise HTTPException(status_code=422, detail="Source image is empty")

    catalog = await ensure_catalog()
    try:
        source = await run_in_threadpool(decode_image, payload)
        if reference_id and reference_id != "auto":
            reference = next((item for item in catalog if item.id == reference_id), None)
            if reference is None:
                raise HTTPException(status_code=404, detail="Reviewed reference footprint not found")
            reference_image = await run_in_threadpool(fetch_reference, reference)
            warped, points, metrics, matrix, resolved_method = await run_in_threadpool(register_images, source, reference_image, method, refine)
            selection_prefix = "Operator-selected reviewed footprint"
        else:
            best = None
            for candidate in catalog or DEMO_CATALOG:
                try:
                    candidate_image = await run_in_threadpool(fetch_reference, candidate)
                    solution = await run_in_threadpool(register_images, source, candidate_image, method, refine)
                    score = solution[2]["image_similarity"] + min(solution[2]["inlier_count"], 100)
                    if best is None or score > best[0]:
                        best = (score, candidate, solution)
                except RegistrationError:
                    continue
            if best is None:
                raise RegistrationError("No reviewed LROC footprint produced enough similar features for registration")
            _, reference, solution = best
            warped, points, metrics, matrix, resolved_method = solution
            selection_prefix = "Automatically selected from reviewed footprints"
    except RegistrationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    result_id = str(uuid.uuid4())
    selection_reason = f"{selection_prefix} at {reference.footprint.center_latitude:.2f}°, {reference.footprint.center_longitude:.2f}°; visually validated by {resolved_method.upper()} features"
    response = RegistrationResponse(
        id=result_id,
        source_filename=source_image.filename,
        reference=reference,
        method=f"OpenCV {resolved_method.upper()} + Lowe ratio test + RANSAC affine + sub-pixel refinement",
        product_status="REGISTERED PRODUCT / REAL CV",
        registered_product_label="GeoTIFF with affine metadata + JSON sidecar",
        selection_reason=selection_reason,
        affine_matrix=matrix,
        preview_url=f"/api/registration/{result_id}/preview",
        geotiff_url=f"/api/registration/{result_id}/geotiff",
        report_url=f"/api/registration/{result_id}/report",
        metrics=metrics,
        match_points=points,
    )
    report = response.model_dump(mode="json")
    await run_in_threadpool(write_outputs, result_id, warped, reference, report)
    return response


@router.get("/{result_id}/{artifact}")
async def download_registration_artifact(result_id: str, artifact: str):
    try:
        uuid.UUID(result_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Registration product not found") from exc
    suffixes = {"preview": (".png", "image/png"), "geotiff": (".tif", "image/tiff"), "report": (".json", "application/json")}
    if artifact not in suffixes:
        raise HTTPException(status_code=404, detail="Artifact not found")
    suffix, media_type = suffixes[artifact]
    path = RESULTS_DIR / f"{result_id}{suffix}"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Registration product not found")
    filename = f"moon-registration-{result_id}{suffix}"
    return FileResponse(path, media_type=media_type, filename=filename)