# Moon Match Points — Living Spec

## Purpose
Single-screen research workstation for exploring lunar image correspondence between a Chandrayaan-2 optical source frame and a selected LROC reference.

## Current MVP flow
1. Load the LROC metadata snapshot from MongoDB; use bundled rows if MongoDB or the upstream source is unavailable.
2. Upload one PNG/JPEG/TIFF/WebP source image. The UI automatically selects the first compatible catalog reference and lets the operator change it.
3. Auto-select from reviewed LROC footprints or choose a reference manually, then run real OpenCV SIFT-first/ORB-fallback matching, Lowe ratio filtering, RANSAC affine estimation, illumination normalization, and local sub-pixel refinement.
4. Coordinate search: enter selenographic latitude/longitude (`GET /api/catalog/search`) to shortlist reviewed footprints that contain or sit nearest the point, and click one to make it the reference.
5. Quality thresholds: set min image similarity, min inlier ratio, and max RMSE; GeoTIFF/JSON exports are gated client-side until the solved run clears every limit.
6. Engine comparison: "Compare engines" (`POST /api/registration/compare`) runs SIFT and ORB on the same source/reference pair and reports RMSE, inliers, inlier ratio, similarity, sub-pixel median, uniformity and runtime side by side with a recommendation.
7. Inspect split/blend/difference/vector views, similarity percentage, match-point descriptor similarity, affine metrics, and selection provenance.
8. Download the registered GeoTIFF with GeoTIFF tiepoint/pixel-scale/GeoKey metadata and an embedded affine citation, plus its JSON sidecar report.

## Data model
- `lunar_catalog`: catalog metadata plus reviewed footprint center, bounds, resolution, CRS label, review date/note, and provenance URL.
- `RegistrationResponse`: source filename, selected `CatalogItem`, method/status labels, affine matrix, artifact URLs, similarity metrics, and distributed inlier `MatchPoint[]`.

## Auth and roles
No authentication. This is a public evaluation console; source files are processed in memory and not stored.

## Integrations
Public LROC Downloads metadata is represented in a Mongo-backed reviewed local snapshot. QuickMap is used only as human-reviewed footprint provenance; no undocumented QuickMap API is called at runtime.

## Processing and export
Accuracy pipeline: CLAHE illumination normalization -> SIFT/ORB detection -> cross-checked Lowe ratio (0.72) -> RANSAC partial affine (2.0 px) -> LMEDS full-affine re-fit on inliers -> intensity-based ECC (MOTION_AFFINE) sub-pixel polish, kept only when it lowers mean residual. Metrics add `ecc_correlation` and `point_uniformity` (grid occupancy + entropy over a 6x4 cell grid); reported match points are grid-distributed inliers (max 48). Artifacts: preview, reference, GeoTIFF, JSON report per result id.
The registration engine is real OpenCV processing. SIFT is the automatic default, ORB is the fallback, and the operator can force either method. Source images are processed in memory and are not retained. Generated preview, GeoTIFF, and report artifacts are stored under opaque UUID result ids.