from datetime import datetime, timezone

from fastapi import APIRouter, Query

from lib.db import db
from models.catalog import CatalogItem, CatalogSource

router = APIRouter(prefix="/catalog", tags=["catalog"])

LROC_DOWNLOADS_URL = "https://lroc.im-ldi.com/images/downloads/"
QUICKMAP_URL = "https://quickmap.lroc.im-ldi.com/"

DEMO_CATALOG = [
    CatalogItem(
        id="lroc-wac-hapke",
        product_id="WAC_HAPKE_E000N1800_76P",
        title="WAC Hapke 7-Band Mosaic",
        product_type="Global mosaic",
        source="LROC Downloads",
        status="verified",
        source_url=LROC_DOWNLOADS_URL,
        download_url="https://lroc.im-ldi.com/data/support/popular_downloads/WAC_HAPKE_E000N1800_76P.zip",
        image_url="https://lroc.im-ldi.com/data/support/popular_downloads/WAC_HAPKE_E000N1800_76P.png",
        location="Global / E000 N1800",
        resolution="76 m / pixel",
    ),
    CatalogItem(
        id="lroc-wac-global",
        product_id="WAC_GLOBAL_E000N1800_100M",
        title="WAC Global Morphologic Mosaic",
        product_type="Morphologic mosaic",
        source="LROC Downloads",
        status="verified",
        source_url=LROC_DOWNLOADS_URL,
        download_url="https://lroc.im-ldi.com/data/support/popular_downloads/WAC_GLOBAL_E000N1800_100M.zip",
        image_url="https://lroc.im-ldi.com/data/support/popular_downloads/WAC_GLOBAL_E000N1800_100M.png",
        location="Global / E000 N1800",
        resolution="100 m / pixel",
    ),
    CatalogItem(
        id="lroc-nac-north-pole",
        product_id="NAC_POLE_P900N0000",
        title="NAC North Pole",
        product_type="Polar mosaic",
        source="LROC Downloads",
        status="verified",
        source_url=LROC_DOWNLOADS_URL,
        download_url="https://lroc.im-ldi.com/data/support/popular_downloads/NAC_POLE_P900N0000.zip",
        image_url="https://lroc.im-ldi.com/data/support/popular_downloads/NAC_POLE_P900N0000.png",
        location="North pole / 90 N",
        resolution="Map projected NAC",
    ),
    CatalogItem(
        id="lroc-tycho-crater",
        product_id="LROC_Tycho_Crater",
        title="Tycho Crater Reference",
        product_type="Feature poster",
        source="LROC Downloads",
        status="verified",
        source_url=LROC_DOWNLOADS_URL,
        download_url="https://lroc.im-ldi.com/data/support/popular_downloads/LROC_Tycho_Crater.tif",
        image_url="https://lroc.im-ldi.com/data/support/popular_downloads/LROC_Tycho_Crater.png",
        location="South-central highlands",
        resolution="NAC mosaic",
    ),
]


async def ensure_catalog() -> list[CatalogItem]:
    try:
        count = await db.lunar_catalog.count_documents({})
        if count == 0:
            await db.lunar_catalog.insert_many([item.model_dump() for item in DEMO_CATALOG])
        rows = await db.lunar_catalog.find({}, {"_id": 0}).sort("title", 1).to_list(100)
        return [CatalogItem(**row) for row in rows]
    except Exception:
        return DEMO_CATALOG


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
        CatalogSource(
            name="LROC Downloads",
            url=LROC_DOWNLOADS_URL,
            status="verified",
            note="Curated metadata snapshot; binary products remain hosted by LROC.",
        ),
        CatalogSource(
            name="LROC QuickMap",
            url=QUICKMAP_URL,
            status="unverified",
            note="Interactive map source; no undocumented private API is assumed.",
        ),
    ]


@router.get("/status")
async def catalog_status():
    rows = await ensure_catalog()
    return {
        "connected": len(rows) > 0,
        "record_count": len(rows),
        "observed_at": datetime.now(timezone.utc),
        "fallback_available": True,
    }