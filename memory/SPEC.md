# Moon Match Points — Living Spec

## Purpose
Single-screen research workstation for exploring lunar image correspondence between a Chandrayaan-2 optical source frame and a selected LROC reference.

## Current MVP flow
1. Load the LROC metadata snapshot from MongoDB; use bundled rows if MongoDB or the upstream source is unavailable.
2. Upload one PNG/JPEG/TIFF/WebP source image. The UI automatically selects the first compatible catalog reference and lets the operator change it.
3. Run the deterministic evaluation registration endpoint. It returns a uniform 24-point correspondence field, affine transform values, residuals, and evaluation metrics.
4. Inspect split/blend/difference/vector views, tune X/Y sub-pixel offsets, rotation and scale, select coordinate rows, and export a JSON evaluation report.

## Data model
- `lunar_catalog`: string ids, LROC product ids, title/type/source, public source/download/image URLs, location, resolution, status, observed timestamp.
- `RegistrationResponse`: source filename, selected `CatalogItem`, method/status labels, `RegistrationMetrics`, and `MatchPoint[]`.

## Auth and roles
No authentication. This is a public evaluation console; source files are processed in memory and not stored.

## Integrations
Public LROC Downloads metadata is represented in a local Mongo snapshot. QuickMap is linked as an unverified interactive source; no undocumented QuickMap API is assumed.

## Evaluation caveat
The current registration engine is a clearly labeled deterministic demo/evaluation engine, not a validated OpenCV/SIFT production pipeline. GeoTIFF output and true pixel-level computer vision integration remain future work.