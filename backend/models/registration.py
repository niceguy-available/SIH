from datetime import datetime, timezone

from pydantic import BaseModel, Field

from models.catalog import CatalogItem


class MatchPoint(BaseModel):
    index: int
    source_x: float
    source_y: float
    reference_x: float
    reference_y: float
    residual_error: float
    descriptor_similarity: float
    status: str


class RegistrationMetrics(BaseModel):
    rmse: float
    inlier_count: int
    total_matches: int
    inlier_ratio: float
    subpixel_accuracy: float
    offset_x: float
    offset_y: float
    rotation_deg: float
    scale_ratio: float
    image_similarity: float
    feature_matches: int


class RegistrationResponse(BaseModel):
    id: str
    source_filename: str
    reference: CatalogItem
    method: str
    product_status: str
    registered_product_label: str
    selection_reason: str
    affine_matrix: list[list[float]]
    preview_url: str
    geotiff_url: str
    report_url: str
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    metrics: RegistrationMetrics
    match_points: list[MatchPoint]