from datetime import datetime, timezone

from pydantic import BaseModel, Field


class CatalogItem(BaseModel):
    id: str
    product_id: str
    title: str
    product_type: str
    source: str
    status: str
    source_url: str
    download_url: str | None = None
    image_url: str
    location: str
    resolution: str
    observed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CatalogSource(BaseModel):
    name: str
    url: str
    status: str
    note: str