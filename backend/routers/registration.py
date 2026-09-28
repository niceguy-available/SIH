import uuid
from time import perf_counter

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from lib.registration_engine import RESULTS_DIR, RegistrationError, decode_image, fetch_reference, register_images, write_outputs
from models.catalog import CatalogItem
from models.registration import EngineComparison, EngineResult, RegistrationResponse
from routers.catalog import DEMO_CATALOG, ensure_catalog

router = APIRouter(prefix="/registration", tags=["registration"])

ALLOWED_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/tiff", "image/webp"}
ALLOWED_SUFFIXES = {"png", "jpg", "jpeg", "tif", "tiff", "webp"}


async def read_source(source_image: UploadFile, method: str) -> bytes:
    if not source_image.filename:
        raise HTTPException(status_code=422, detail="A source image filename is required")
    suffix = source_image.filename.lower().rsplit(".", 1)[-1] if "." in source_image.filename else ""
    if source_image.content_type not in ALLOWED_TYPES and suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=415, detail="Upload a PNG, JPEG, TIFF, or WebP optical image")
    if method not in {"auto", "sift", "orb"}:
        raise HTTPException(status_code=422, detail="Method must be auto, sift, or orb")
    payload = await source_image.read()
    if len(payload) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Source image must be 20 MB or smaller")
    if not payload:
        raise HTTPException(status_code=422, detail="Source image is empty")
    return payload


async def resolve_solution(catalog: list[CatalogItem], reference_id: str | None, source, method: str, refine: bool):
    """Returns (reference item, reference image, solution tuple, selection prefix)."""
    if reference_id and reference_id != "auto":
        reference = next((item for item in catalog if item.id == reference_id), None)
        if reference is None:
            raise HTTPException(status_code=404, detail="Reviewed reference footprint not found")
        reference_image = await run_in_threadpool(fetch_reference, reference)
        solution = await run_in_threadpool(register_images, source, reference_image, method, refine)
        return reference, reference_image, solution, "Operator-selected reviewed footprint"

    best = None
    for candidate in catalog or DEMO_CATALOG:
        try:
            candidate_image = await run_in_threadpool(fetch_reference, candidate)
            solution = await run_in_threadpool(register_images, source, candidate_image, method, refine)
            score = solution[2]["image_similarity"] + min(solution[2]["inlier_count"], 100)
            if best is None or score > best[0]:
                best = (score, candidate, candidate_image, solution)
        except RegistrationError:
            continue
    if best is None:
        raise RegistrationError("No reviewed LROC footprint produced enough similar features for registration")
    _, reference, reference_image, solution = best
    return reference, reference_image, solution, "Automatically selected from reviewed footprints"


@router.post("/run", response_model=RegistrationResponse)
async def run_registration(
    source_image: UploadFile = File(...),
    reference_id: str | None = Form(default=None),
    refine: bool = Form(default=True),
    method: str = Form(default="auto"),
):
    payload = await read_source(source_image, method)
    catalog = await ensure_catalog()
    try:
        source = await run_in_threadpool(decode_image, payload)
        reference, reference_image, solution, selection_prefix = await resolve_solution(catalog, reference_id, source, method, refine)
    except RegistrationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    warped, points, metrics, matrix, resolved_method = solution
    result_id = str(uuid.uuid4())
    selection_reason = f"{selection_prefix} at {reference.footprint.center_latitude:.2f}°, {reference.footprint.center_longitude:.2f}°; visually validated by {resolved_method.upper()} features"
    response = RegistrationResponse(
        id=result_id,
        source_filename=source_image.filename or "source",
        reference=reference,
        method=f"OpenCV {resolved_method.upper()} + cross-checked Lowe ratio + RANSAC affine + LMEDS re-fit + ECC sub-pixel polish",
        product_status="REGISTERED PRODUCT / REAL CV",
        registered_product_label="GeoTIFF with affine metadata + JSON sidecar",
        selection_reason=selection_reason,
        affine_matrix=matrix,
        preview_url=f"/api/registration/{result_id}/preview",
        reference_url=f"/api/registration/{result_id}/reference",
        geotiff_url=f"/api/registration/{result_id}/geotiff",
        report_url=f"/api/registration/{result_id}/report",
        source_width=int(source.shape[1]),
        source_height=int(source.shape[0]),
        reference_width=int(reference_image.shape[1]),
        reference_height=int(reference_image.shape[0]),
        metrics=metrics,
        match_points=points,
    )
    report = response.model_dump(mode="json")
    await run_in_threadpool(write_outputs, result_id, warped, reference_image, reference, report)
    return response


@router.post("/compare", response_model=EngineComparison)
async def compare_engines(
    source_image: UploadFile = File(...),
    reference_id: str | None = Form(default=None),
    refine: bool = Form(default=True),
):
    payload = await read_source(source_image, "auto")
    catalog = await ensure_catalog()
    try:
        source = await run_in_threadpool(decode_image, payload)
        reference, reference_image, _, _ = await resolve_solution(catalog, reference_id, source, "auto", refine)
    except RegistrationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    labels = {"sift": "SIFT · scale & illumination robust", "orb": "ORB · fast binary descriptors"}
    engines: list[EngineResult] = []
    for engine in ("sift", "orb"):
        started = perf_counter()
        try:
            _, points, metrics, _, _ = await run_in_threadpool(register_images, source, reference_image, engine, refine)
            engines.append(EngineResult(engine=engine, label=labels[engine], solved=True, elapsed_ms=round((perf_counter() - started) * 1000, 1), point_count=len(points), metrics=metrics))
        except RegistrationError as exc:
            engines.append(EngineResult(engine=engine, label=labels[engine], solved=False, detail=str(exc), elapsed_ms=round((perf_counter() - started) * 1000, 1)))

    solved = [item for item in engines if item.solved and item.metrics]
    if not solved:
        raise HTTPException(status_code=422, detail="Neither SIFT nor ORB solved a transform against this reference")
    winner = max(solved, key=lambda item: (item.metrics.inlier_ratio * 100 + item.metrics.image_similarity - item.metrics.rmse * 10) if item.metrics else 0)
    reason = (
        f"{winner.engine.upper()} wins with RMSE {winner.metrics.rmse:.3f} px, "
        f"inlier ratio {winner.metrics.inlier_ratio * 100:.1f}% and similarity {winner.metrics.image_similarity:.1f}%"
        if winner.metrics
        else "No metrics available"
    )
    return EngineComparison(
        source_filename=source_image.filename or "source",
        reference=reference,
        engines=engines,
        recommended_engine=winner.engine,
        recommendation_reason=reason,
    )


@router.get("/{result_id}/{artifact}")
async def download_registration_artifact(result_id: str, artifact: str):
    try:
        uuid.UUID(result_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Registration product not found") from exc
    suffixes = {
        "preview": (".png", "image/png"),
        "reference": ("-reference.png", "image/png"),
        "geotiff": (".tif", "image/tiff"),
        "report": (".json", "application/json"),
    }
    if artifact not in suffixes:
        raise HTTPException(status_code=404, detail="Artifact not found")
    suffix, media_type = suffixes[artifact]
    path = RESULTS_DIR / f"{result_id}{suffix}"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Registration product not found")
    filename = f"moon-registration-{result_id}{suffix}"
    return FileResponse(path, media_type=media_type, filename=filename)
