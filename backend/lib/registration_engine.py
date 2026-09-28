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
RATIO_TEST = 0.72


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
    if image.dtype != np.uint8:
        image = cv2.normalize(image, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
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
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    return cv2.GaussianBlur(gray, (3, 3), 0.8)


def detector_for(method: str):
    if method == "orb":
        return cv2.ORB_create(nfeatures=8000, scaleFactor=1.12, nlevels=12, edgeThreshold=15), cv2.NORM_HAMMING
    return cv2.SIFT_create(nfeatures=8000, contrastThreshold=0.015, edgeThreshold=14, sigma=1.6), cv2.NORM_L2


def matched_features(source_gray: np.ndarray, reference_gray: np.ndarray, method: str):
    detector, norm = detector_for(method)
    source_points, source_descriptors = detector.detectAndCompute(source_gray, None)
    reference_points, reference_descriptors = detector.detectAndCompute(reference_gray, None)
    if source_descriptors is None or reference_descriptors is None:
        return [], source_points, reference_points
    matcher = cv2.BFMatcher(norm)
    pairs = matcher.knnMatch(source_descriptors, reference_descriptors, k=2)
    forward = {}
    for pair in pairs:
        if len(pair) != 2:
            continue
        best, second = pair
        if best.distance < RATIO_TEST * second.distance:
            forward[best.queryIdx] = best
    # Cross-check: keep only mutually nearest correspondences (raises inlier ratio materially).
    reverse_pairs = matcher.knnMatch(reference_descriptors, source_descriptors, k=1)
    reverse = {pair[0].queryIdx: pair[0].trainIdx for pair in reverse_pairs if pair}
    good = [match for query_idx, match in forward.items() if reverse.get(match.trainIdx) == query_idx]
    if len(good) < MIN_MATCHES:
        good = list(forward.values())
    return good, source_points, reference_points


def refine_points(gray: np.ndarray, points: np.ndarray) -> np.ndarray:
    refined = points.astype(np.float32).reshape(-1, 1, 2)
    try:
        cv2.cornerSubPix(gray, refined, (5, 5), (-1, -1), (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 60, 0.001))
    except cv2.error:
        pass
    return refined.reshape(-1, 2)


def distributed_indices(points: np.ndarray, errors: np.ndarray, width: int, height: int, limit: int = 48) -> list[int]:
    buckets: dict[tuple[int, int], list[int]] = {}
    for index, (x, y) in enumerate(points):
        cell = (min(5, int(x / max(width, 1) * 6)), min(3, int(y / max(height, 1) * 4)))
        buckets.setdefault(cell, []).append(index)
    chosen: list[int] = []
    taken: set[int] = set()
    while len(chosen) < limit:
        added = False
        for cell in sorted(buckets):
            remaining = [index for index in buckets[cell] if index not in taken]
            if remaining:
                pick = min(remaining, key=lambda index: errors[index])
                chosen.append(pick)
                taken.add(pick)
                added = True
                if len(chosen) == limit:
                    break
        if not added:
            break
    return chosen


def uniformity_percent(points: np.ndarray, width: int, height: int) -> float:
    if len(points) == 0:
        return 0.0
    counts = np.zeros(24, dtype=np.float64)
    for x, y in points:
        cell_x = min(5, int(x / max(width, 1) * 6))
        cell_y = min(3, int(y / max(height, 1) * 4))
        counts[cell_y * 6 + cell_x] += 1
    occupied = float(np.count_nonzero(counts)) / counts.size
    share = counts / counts.sum()
    entropy = float(-np.sum(share[share > 0] * np.log(share[share > 0])) / math.log(counts.size))
    return round(100.0 * (0.5 * occupied + 0.5 * entropy), 2)


def compose(outer: np.ndarray, inner: np.ndarray) -> np.ndarray:
    def to3(matrix: np.ndarray) -> np.ndarray:
        return np.vstack([matrix, [0.0, 0.0, 1.0]])

    return (to3(outer) @ to3(inner))[:2].astype(np.float32)


def ecc_refine(reference_gray: np.ndarray, source_gray: np.ndarray, matrix: np.ndarray) -> tuple[np.ndarray, float]:
    """Intensity-based ECC polish on top of the RANSAC affine — drives residuals sub-pixel."""
    height, width = reference_gray.shape[:2]
    try:
        warped = cv2.warpAffine(source_gray, matrix, (width, height), flags=cv2.INTER_LANCZOS4)
        mask = (cv2.warpAffine(np.full(source_gray.shape[:2], 255, np.uint8), matrix, (width, height)) > 0).astype(np.uint8)
        if int(mask.sum()) < 0.05 * width * height:
            return matrix, 0.0
        template = reference_gray.astype(np.float32) / 255.0
        moving = warped.astype(np.float32) / 255.0
        delta = np.eye(2, 3, dtype=np.float32)
        criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-7)
        correlation, delta = cv2.findTransformECC(template, moving, delta, cv2.MOTION_AFFINE, criteria, mask, 5)
        if not np.isfinite(delta).all():
            return matrix, 0.0
        # delta maps template->moving coordinates; its inverse polishes source->reference.
        inverse = cv2.invertAffineTransform(delta)
        polished = compose(inverse, matrix)
        return polished.astype(np.float32), round(float(correlation), 4)
    except cv2.error:
        return matrix, 0.0


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
        matrix, mask = cv2.estimateAffinePartial2D(source_points, reference_points, method=cv2.RANSAC, ransacReprojThreshold=2.0, maxIters=8000, confidence=0.999, refineIters=50)
        if matrix is None or mask is None or int(mask.sum()) < MIN_MATCHES:
            continue
        inlier_mask = mask.ravel().astype(bool)
        # Second pass: full affine least squares over the RANSAC inliers only.
        if int(inlier_mask.sum()) >= 6:
            tuned, tuned_mask = cv2.estimateAffine2D(source_points[inlier_mask], reference_points[inlier_mask], method=cv2.LMEDS, refineIters=50)
            if tuned is not None and np.isfinite(tuned).all() and tuned_mask is not None:
                candidate = cv2.transform(source_points.reshape(-1, 1, 2), tuned).reshape(-1, 2)
                candidate_error = np.linalg.norm(reference_points[inlier_mask] - candidate[inlier_mask], axis=1)
                current = cv2.transform(source_points.reshape(-1, 1, 2), matrix).reshape(-1, 2)
                current_error = np.linalg.norm(reference_points[inlier_mask] - current[inlier_mask], axis=1)
                if float(candidate_error.mean()) < float(current_error.mean()):
                    matrix = tuned.astype(np.float32)
        solved = (method, matches, source_points, reference_points, matrix.astype(np.float32), inlier_mask)
        break
    if solved is None:
        raise RegistrationError("Insufficient similar features for SIFT/ORB affine registration; try a source frame overlapping the selected LROC reference")

    method, matches, source_points, reference_points, matrix, inlier_mask = solved
    ecc_correlation = 0.0
    if refine:
        polished, ecc_correlation = ecc_refine(reference_gray, source_gray, matrix)
        transformed = cv2.transform(source_points.reshape(-1, 1, 2), polished).reshape(-1, 2)
        polished_error = float(np.linalg.norm(reference_points[inlier_mask] - transformed[inlier_mask], axis=1).mean())
        base = cv2.transform(source_points.reshape(-1, 1, 2), matrix).reshape(-1, 2)
        base_error = float(np.linalg.norm(reference_points[inlier_mask] - base[inlier_mask], axis=1).mean())
        if polished_error <= base_error:
            matrix = polished
        else:
            ecc_correlation = 0.0

    transformed = cv2.transform(source_points.reshape(-1, 1, 2), matrix).reshape(-1, 2)
    errors = np.linalg.norm(reference_points - transformed, axis=1)
    # Tighten the inlier set against the polished transform for honest metrics.
    tight_mask = inlier_mask & (errors <= 2.0)
    if int(tight_mask.sum()) >= MIN_MATCHES:
        inlier_mask = tight_mask
    inlier_indices = np.flatnonzero(inlier_mask)
    selected_local = distributed_indices(source_points[inlier_indices], errors[inlier_indices], source.shape[1], source.shape[0])
    selected_indices = inlier_indices[selected_local]
    max_distance = max((match.distance for match in matches), default=1.0)
    point_rows = []
    for output_index, match_index in enumerate(selected_indices, start=1):
        descriptor_similarity = max(0.0, 100.0 * (1.0 - matches[match_index].distance / max(max_distance, 1.0)))
        point_rows.append({
            "index": output_index,
            "source_x": round(float(source_points[match_index][0]), 3),
            "source_y": round(float(source_points[match_index][1]), 3),
            "reference_x": round(float(reference_points[match_index][0]), 3),
            "reference_y": round(float(reference_points[match_index][1]), 3),
            "residual_error": round(float(errors[match_index]), 3),
            "descriptor_similarity": round(descriptor_similarity, 2),
            "status": "inlier",
        })

    warped = cv2.warpAffine(source, matrix, (reference.shape[1], reference.shape[0]), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT)
    valid = cv2.warpAffine(np.full(source.shape[:2], 255, dtype=np.uint8), matrix, (reference.shape[1], reference.shape[0])) > 0
    warped_gray = illumination_normalized(warped)
    if valid.any():
        pixel_similarity = 100.0 * (1.0 - float(np.mean(np.abs(warped_gray[valid].astype(np.float32) - reference_gray[valid].astype(np.float32)))) / 255.0)
    else:
        pixel_similarity = 0.0
    inlier_errors = errors[inlier_mask]
    a, b = matrix[0, 0], matrix[1, 0]
    metrics = {
        "rmse": round(float(np.sqrt(np.mean(inlier_errors ** 2))), 4),
        "inlier_count": int(inlier_mask.sum()),
        "total_matches": len(matches),
        "inlier_ratio": round(float(inlier_mask.mean()), 4),
        "subpixel_accuracy": round(float(np.median(inlier_errors)), 4),
        "offset_x": round(float(matrix[0, 2]), 3),
        "offset_y": round(float(matrix[1, 2]), 3),
        "rotation_deg": round(math.degrees(math.atan2(b, a)), 4),
        "scale_ratio": round(float(math.sqrt(a * a + b * b)), 6),
        "image_similarity": round(max(0.0, min(100.0, pixel_similarity)), 2),
        "feature_matches": len(matches),
        "ecc_correlation": ecc_correlation,
        "point_uniformity": uniformity_percent(source_points[inlier_mask], source.shape[1], source.shape[0]),
    }
    return warped, point_rows, metrics, matrix.tolist(), method


def write_outputs(result_id: str, warped: np.ndarray, reference: np.ndarray, item: CatalogItem, report: dict):
    preview_path = RESULTS_DIR / f"{result_id}.png"
    reference_path = RESULTS_DIR / f"{result_id}-reference.png"
    geotiff_path = RESULTS_DIR / f"{result_id}.tif"
    report_path = RESULTS_DIR / f"{result_id}.json"
    cv2.imwrite(str(preview_path), warped)
    cv2.imwrite(str(reference_path), reference)
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
