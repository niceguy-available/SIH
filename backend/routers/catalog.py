import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Query

from lib.db import db
from models.catalog import CatalogItem, CatalogSource

router = APIRouter(prefix="/catalog", tags=["catalog"])

LROC_DOWNLOADS_URL = "https://lroc.im-ldi.com/images/downloads/"
QUICKMAP_URL = "https://quickmap.lroc.im-ldi.com/"
FOOTPRINTS_PATH = Path(__file__).parent.parent / "data" / "footprints.json"


def curated_catalog() -> list[CatalogItem]:
    return [CatalogItem.model_validate(row) for row in json.loads(FOOTPRINTS_PATH.read_text())]


DEMO_CATALOG = curated_catalog()


async def ensure_catalog() -> list[CatalogItem]:
    curated = curated_catalog()
    try:
        for item in curated:
            await db.lunar_catalog.replace_one(
                {"id": item.id}, item.model_dump(), upsert=True
            )
        rows = await db.lunar_catalog.find(
            {"footprint.review_status": "reviewed"}, {"_id": 0}
        ).sort("title", 1).to_list(100)
        return [CatalogItem(**row) for row in rows]
    except Exception:
        return curated


@router.get("", response_model=list[CatalogItem])
async def get_catalog(q: str | None = Query(default=None), limit: int = Query(default=20, ge=1, le=100)):
    rows = await ensure_catalog()
    if q:
        term = q.lower()
        rows = [row for row in rows if term in f"{row.product_id} {row.title} {row.location}".lower()]
    return rows[:limit]


@router.get("/sources", response_model=list[CatalogSource])
async def get_catalog_sources():
    return [
        CatalogSource(name="LROC Downloads", url=LROC_DOWNLOADS_URL, status="verified", note="Product descriptions and reviewed catalog metadata."),
        CatalogSource(name="LROC QuickMap", url=QUICKMAP_URL, status="reviewed-provenance", note="Human-reviewed footprint context only; no undocumented API dependency."),
    ]


@router.get("/status")
async def catalog_status():
    rows = await ensure_catalog()
    return {"connected": bool(rows), "record_count": len(rows), "reviewed_footprints": sum(row.footprint.review_status == "reviewed" for row in rows), "observed_at": datetime.now(timezone.utc), "fallback_available": True}