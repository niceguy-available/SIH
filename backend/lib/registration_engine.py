import json
import math
from pathlib import Path

import cv2
import httpx
import numpy as np
from PIL import Image, TiffImagePlugin

from models.catalog import CatalogItem

RESULTS_DIR = Path(__file__).parent.parent / "data" / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
MAX_DIMENSION = 1800
MIN_MATCHES = 4


class RegistrationError(ValueError):
    pass


def decode_image(payload: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise RegistrationError("The uploaded file is not a decodable optical image")
    if image.ndim == 3 and image.shape[2] == 4:
        image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
    elif image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    height, width = image.shape[:2]
    scale = min(1.0, MAX_DIMENSION / max(height, width))
    if scale < 1:
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return image


def fetch_reference(item: CatalogItem) -> np.ndarray:
    try:
        response = httpx.get(item.image_url, timeout=20, follow_redirects=True, headers={"User-Agent": "moon-match-points/1.0"})
        response.raise_for_status()
        return decode_image(response.content)
    except (httpx.HTTPError, RegistrationError) as exc:
        raise RegistrationError(f"Reference preview unavailable for {item.product_id}") from exc


def illumination_normalized(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)


def detector_for(method: str):
    if method == "orb":
        return cv2.ORB_create(nfeatures=6000, scaleFactor=1.15, nlevels=10), cv2.NORM_HAMMING
    return cv2.SIFT_create(nfeatures=6000, contrastThreshold=0.02, edgeThreshold=12), cv2.NORM_L2


def matched_features(source_gray: np.ndarray, reference_gray: np.ndarray, method: str):
    detector, norm = detector_for(method)
    source_points, source_descriptors = detector.detectAndCompute(source_gray, None)
    reference_points, reference_descriptors = detector.detectAndCompute(reference_gray, None)
    if source_descriptors is None or reference_descriptors is None:
        return [], source_points, reference_points
    pairs = cv2.BFMatcher(norm).knnMatch(source_descriptors, reference_descriptors, k=2)
    good = [best for pair in pairs if len(pair) == 2 for best, second in [pair] if best.distance < 0.75 * second.distance]
    return good, source_points, reference_points


def refine_points(gray: np.ndarray, points: np.ndarray) -> np.ndarray:
    refined = points.astype(np.float32).reshape(-1, 1, 2)
    try:
        cv2.cornerSubPix(gray, refined, (4, 4), (-1, -1), (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 30, 0.01))
    except cv2.error:
        pass
    return refined.reshape(-1, 2)


def distributed_indices(points: np.ndarray, errors: np.ndarray, width: int, height: int, limit: int = 48) -> list[int]:
    buckets: dict[tuple[int, int], list[int]] = {}
    for index, (x, y) in enumerate(points):
        cell = (min(5, int(x / max(width, 1) * 6)), min(3, int(y / max(height, 1) * 4)))
        buckets.setdefault(cell, []).append(index)
    chosen: list[int] = []
    while len(chosen) < limit:
        added = False
        for cell in sorted(buckets):
            remaining = [index for index in buckets[cell] if index not in chosen]
            if remaining:
                chosen.append(min(remaining, key=lambda index: errors[index]))
                added = True
                if len(chosen) == limit:
                    break
        if not added:
            break
    return chosen


def register_images(source: np.ndarray, reference: np.ndarray, requested_method: str, refine: bool):
    source_gray = illumination_normalized(source)
    reference_gray = illumination_normalized(reference)
    methods = [requested_method] if requested_method in {"sift", "orb"} else ["sift", "orb"]
    solved = None
    for method in methods:
        matches, source_keypoints, reference_keypoints = matched_features(source_gray, reference_gray, method)
        if len(matches) < MIN_MATCHES:
            continue
        source_points = np.float32([source_keypoints[match.queryIdx].pt for match in matches])
        reference_points = np.float32([reference_keypoints[match.trainIdx].pt for match in matches])
        if refine:
            source_points = refine_points(source_gray, source_points)
            reference_points = refine_points(reference_gray, reference_points)
        matrix, mask = cv2.estimateAffinePartial2D(source_points, reference_points, method=cv2.RANSAC, ransacReprojThreshold=3.0, maxIters=4000, confidence=0.995, refineIters=25)
        if matrix is not None and mask is not None and int(mask.sum()) >= MIN_MATCHES:
            solved = (method, matches, source_points, reference_points, matrix, mask.ravel().astype(bool))
            break
    if solved is None:
        raise RegistrationError("Insufficient similar features for SIFT/ORB affine registration; try a source frame overlapping the selected LROC reference")

    method, matches, source_points, reference_points, matrix, inlier_mask = solved
    transformed = cv2.transform(source_points.reshape(-1, 1, 2), matrix).reshape(-1, 2)
    errors = np.linalg.norm(reference_points - transformed, axis=1)
    inlier_indices = np.flatnonzero(inlier_mask)
    selected_local = distributed_indices(source_points[inlier_indices], errors[inlier_indices], source.shape[1], source.shape[0])
    selected_indices = inlier_indices[selected_local]
    max_distance = max((match.distance for match in matches), default=1.0)
    point_rows = []
    for output_index, match_index in enumerate(selected_indices, start=1):
        descriptor_similarity = max(0.0, 100.0 * (1.0 - matches[match_index].distance / max(max_distance, 1.0)))
        point_rows.append({"index": output_index, "source_x": round(float(source_points[match_index][0]), 3), "source_y": round(float(source_points[match_index][1]), 3), "reference_x": round(float(reference_points[match_index][0]), 3), "reference_y": round(float(reference_points[match_index][1]), 3), "residual_error": round(float(errors[match_index]), 3), "descriptor_similarity": round(descriptor_similarity, 2), "status": "inlier"})

    warped = cv2.warpAffine(source, matrix, (reference.shape[1], reference.shape[0]), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT)
    valid = cv2.warpAffine(np.full(source.shape[:2], 255, dtype=np.uint8), matrix, (reference.shape[1], reference.shape[0])) > 0
    warped_gray = illumination_normalized(warped)
    if valid.any():
        pixel_similarity = 100.0 * (1.0 - float(np.mean(np.abs(warped_gray[valid].astype(np.float32) - reference_gray[valid].astype(np.float32)))) / 255.0)
    else:
        pixel_similarity = 0.0
    inlier_errors = errors[inlier_mask]
    a, b = matrix[0, 0], matrix[1, 0]
    return warped, point_rows, {"rmse": round(float(np.sqrt(np.mean(inlier_errors ** 2))), 3), "inlier_count": int(inlier_mask.sum()), "total_matches": len(matches), "inlier_ratio": round(float(inlier_mask.mean()), 3), "subpixel_accuracy": round(float(np.median(inlier_errors)), 3), "offset_x": round(float(matrix[0, 2]), 3), "offset_y": round(float(matrix[1, 2]), 3), "rotation_deg": round(math.degrees(math.atan2(b, a)), 4), "scale_ratio": round(float(math.sqrt(a * a + b * b)), 6), "image_similarity": round(max(0.0, min(100.0, pixel_similarity)), 2), "feature_matches": len(matches)}, matrix.tolist(), method


def write_outputs(result_id: str, warped: np.ndarray, item: CatalogItem, report: dict):
    preview_path = RESULTS_DIR / f"{result_id}.png"
    geotiff_path = RESULTS_DIR / f"{result_id}.tif"
    report_path = RESULTS_DIR / f"{result_id}.json"
    cv2.imwrite(str(preview_path), warped)
    bounds = item.footprint.bounds
    pixel_width = (bounds.east - bounds.west) / warped.shape[1]
    pixel_height = (bounds.north - bounds.south) / warped.shape[0]
    tags = TiffImagePlugin.ImageFileDirectory_v2()
    tags[33550] = (pixel_width, pixel_height, 0.0)  # ModelPixelScaleTag
    tags[33922] = (0.0, 0.0, 0.0, bounds.west, bounds.north, 0.0)  # ModelTiepointTag
    tags[34735] = (1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 32767)  # GeoKeyDirectoryTag
    citation = "Moon 2000 geographic|" + json.dumps({"product_id": item.product_id, "affine_pixel_matrix": report["affine_matrix"], "similarity_percent": report["metrics"]["image_similarity"]})
    tags[34737] = citation  # GeoAsciiParamsTag
    tags[270] = f"Registered lunar product; source CRS={item.footprint.crs}; reviewed footprint={item.footprint.review_status}"
    rgb = cv2.cvtColor(warped, cv2.COLOR_BGR2RGB)
    Image.fromarray(rgb).save(geotiff_path, format="TIFF", compression="tiff_deflate", tiffinfo=tags)
    report_path.write_text(json.dumps(report, indent=2, default=str))
    return preview_path, geotiff_path, report_path