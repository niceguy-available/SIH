# Moon Match Points — Living Spec

## Purpose
Single-screen research workstation for exploring lunar image correspondence between a Chandrayaan-2 optical source frame and a selected LROC reference.

## Current MVP flow
1. Load the LROC metadata snapshot from MongoDB; use bundled rows if MongoDB or the upstream source is unavailable.
2. Upload one PNG/JPEG/TIFF/WebP source image. The UI automatically selects the first compatible catalog reference and lets the operator change it.
3. Auto-select from reviewed LROC footprints or choose a reference manually, then run real OpenCV SIFT-first/ORB-fallback matching, Lowe ratio filtering, RANSAC affine estimation, illumination normalization, and local sub-pixel refinement.
4. Inspect split/blend/difference/vector views, similarity percentage, match-point descriptor similarity, affine metrics, and selection provenance.
5. Download the registered GeoTIFF with GeoTIFF tiepoint/pixel-scale/GeoKey metadata and an embedded affine citation, plus its JSON sidecar report.

## Data model
- `lunar_catalog`: catalog metadata plus reviewed footprint center, bounds, resolution, CRS label, review date/note, and provenance URL.
- `RegistrationResponse`: source filename, selected `CatalogItem`, method/status labels, affine matrix, artifact URLs, similarity metrics, and distributed inlier `MatchPoint[]`.

## Auth and roles
No authentication. This is a public evaluation console; source files are processed in memory and not stored.

## Integrations
Public LROC Downloads metadata is represented in a Mongo-backed reviewed local snapshot. QuickMap is used only as human-reviewed footprint provenance; no undocumented QuickMap API is called at runtime.

## Processing and export
The registration engine is real OpenCV processing. SIFT is the automatic default, ORB is the fallback, and the operator can force either method. Source images are processed in memory and are not retained. Generated preview, GeoTIFF, and report artifacts are stored under opaque UUID result ids.