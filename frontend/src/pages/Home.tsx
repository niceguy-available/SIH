import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownToLine,
  Check,
  ChevronRight,
  Crosshair,
  Database,
  ExternalLink,
  Filter,
  Gauge,
  Layers3,
  Moon,
  MousePointer2,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Split,
  Target,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiPostForm } from "@/lib/api";
import type { CatalogItem, CoordinateMatch, EngineComparison, MatchPoint, RegistrationResult } from "@/lib/api";

type ViewMode = "split" | "blend" | "difference" | "vectors";

const FALLBACK_CATALOG: CatalogItem[] = [
  {
    id: "fallback-hapke",
    product_id: "WAC_HAPKE_E000N1800_76P",
    title: "WAC Hapke 7-Band Mosaic",
    product_type: "Global mosaic",
    source: "LROC Downloads",
    status: "verified",
    source_url: "https://lroc.im-ldi.com/images/downloads/",
    download_url: null,
    image_url: "https://lroc.im-ldi.com/data/support/popular_downloads/WAC_HAPKE_E000N1800_76P.png",
    location: "Global / E000 N1800",
    resolution: "76 m / pixel",
    observed_at: "2026-01-01T00:00:00Z",
    footprint: { id: "fallback-hapke", source_url: "https://lroc.im-ldi.com/images/downloads/", center_latitude: 0, center_longitude: 0, bounds: { west: -180, south: -90, east: 180, north: 90 }, resolution_m_per_pixel: 76, crs: "IAU_MOON_2000", review_status: "reviewed", reviewed_at: "2026-09-26", review_note: "Reviewed global product footprint." },
  },
  {
    id: "fallback-tycho",
    product_id: "LROC_Tycho_Crater",
    title: "Tycho Crater Reference",
    product_type: "Feature poster",
    source: "LROC Downloads",
    status: "verified",
    source_url: "https://lroc.im-ldi.com/images/downloads/",
    download_url: null,
    image_url: "https://lroc.im-ldi.com/data/support/popular_downloads/LROC_Tycho_Crater.png",
    location: "South-central highlands",
    resolution: "NAC mosaic",
    observed_at: "2026-01-01T00:00:00Z",
    footprint: { id: "fallback-tycho", source_url: "https://quickmap.lroc.im-ldi.com/", center_latitude: -43.31, center_longitude: -11.36, bounds: { west: -12.5, south: -44.5, east: -10.2, north: -42.1 }, resolution_m_per_pixel: null, crs: "IAU_MOON_2000", review_status: "reviewed", reviewed_at: "2026-09-26", review_note: "Reviewed Tycho context footprint." },
  },
];

const VIEW_MODES: { id: ViewMode; label: string; icon: typeof Layers3 }[] = [
  { id: "split", label: "Split", icon: Layers3 },
  { id: "blend", label: "Blend", icon: ScanLine },
  { id: "difference", label: "Diff", icon: Filter },
  { id: "vectors", label: "Vectors", icon: MousePointer2 },
];

function Metric({ label, value, unit, target, tone = "amber" }: { label: string; value: string; unit: string; target: string; tone?: "amber" | "cyan" | "emerald" }) {
  const slug = label.toLowerCase().replaceAll(" ", "-");
  return (
    <div className="metric-tile" data-testid={`metric-${slug}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="label-mono" data-testid={`metric-${slug}-label`}>{label}</span>
        <span className={`metric-dot metric-dot-${tone}`} aria-hidden="true" />
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <strong className={`metric-value metric-value-${tone}`} data-testid={`metric-${slug}-value`}>{value}</strong>
        <span className="text-xs text-slate-500" data-testid={`metric-${slug}-unit`}>{unit}</span>
      </div>
      <span className="mt-1 block text-[11px] text-slate-500" data-testid={`metric-${slug}-target`}>target {target}</span>
    </div>
  );
}

function SectionHeading({ eyebrow, title, detail, testId }: { eyebrow: string; title: string; detail?: string; testId: string }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4" data-testid={testId}>
      <div>
        <p className="eyebrow" data-testid={`${testId}-eyebrow`}>{eyebrow}</p>
        <h2 className="section-title" data-testid={`${testId}-title`}>{title}</h2>
      </div>
      {detail ? <span className="hidden max-w-xs text-right text-xs leading-relaxed text-slate-500 md:block" data-testid={`${testId}-detail`}>{detail}</span> : null}
    </div>
  );
}

export default function Home() {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [selectedReferenceId, setSelectedReferenceId] = useState("auto");
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [comparison, setComparison] = useState<EngineComparison | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [refineEnabled, setRefineEnabled] = useState(true);
  const [blendOpacity, setBlendOpacity] = useState(0.55);
  const [hudGrid, setHudGrid] = useState(true);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [featureMethod, setFeatureMethod] = useState("auto");
  const [latitude, setLatitude] = useState("-43.31");
  const [longitude, setLongitude] = useState("-11.36");
  const [coordinateQueryKey, setCoordinateQueryKey] = useState<{ lat: number; lon: number } | null>(null);
  const [minSimilarity, setMinSimilarity] = useState(60);
  const [minInlierRatio, setMinInlierRatio] = useState(70);
  const [maxRmse, setMaxRmse] = useState(1.5);

  const catalogQuery = useQuery({
    queryKey: ["catalog"],
    queryFn: () => apiGet<CatalogItem[]>("/catalog"),
    retry: false,
  });
  const catalog = catalogQuery.data?.length ? catalogQuery.data : FALLBACK_CATALOG;

  const coordinateQuery = useQuery({
    queryKey: ["catalog-coordinate", coordinateQueryKey?.lat, coordinateQueryKey?.lon],
    queryFn: () => apiGet<CoordinateMatch[]>(`/catalog/search?latitude=${coordinateQueryKey?.lat}&longitude=${coordinateQueryKey?.lon}`),
    enabled: coordinateQueryKey !== null,
    retry: false,
  });

  const selectedReference = result?.reference ?? catalog.find((item) => item.id === selectedReferenceId) ?? catalog[0];
  const filteredCatalog = useMemo(() => {
    const term = catalogSearch.toLowerCase().trim();
    return term ? catalog.filter((item) => `${item.title} ${item.product_id} ${item.location}`.toLowerCase().includes(term)) : catalog;
  }, [catalog, catalogSearch]);

  const buildForm = () => {
    const form = new FormData();
    if (!sourceFile) throw new Error("Choose a source image first");
    form.append("source_image", sourceFile);
    form.append("reference_id", selectedReferenceId);
    form.append("refine", String(refineEnabled));
    return form;
  };

  const registrationMutation = useMutation({
    mutationFn: async () => {
      const form = buildForm();
      form.append("method", featureMethod);
      return apiPostForm<RegistrationResult>("/registration/run", form);
    },
    onSuccess: (nextResult) => {
      setResult(nextResult);
      setSelectedPoint(null);
      toast.success("Registration solved", { description: `RMSE ${nextResult.metrics.rmse.toFixed(3)} px over ${nextResult.metrics.inlier_count} inliers.` });
    },
    onError: () => toast.error("Registration could not run", { description: "Try another reviewed footprint or a source frame with more overlap." }),
  });

  const comparisonMutation = useMutation({
    mutationFn: async () => apiPostForm<EngineComparison>("/registration/compare", buildForm()),
    onSuccess: (report) => {
      setComparison(report);
      toast.success(`${report.recommended_engine.toUpperCase()} recommended`, { description: report.recommendation_reason });
    },
    onError: () => toast.error("Engine comparison failed", { description: "Neither SIFT nor ORB solved a transform for this pair." }),
  });

  const handleFile = (file?: File) => {
    if (!file) return;
    setSourceFile(file);
    setSourcePreview(URL.createObjectURL(file));
    setResult(null);
    setComparison(null);
    toast.success("Source image staged", { description: "A LROC reference will be resolved automatically." });
  };

  const thresholdChecks = result
    ? [
        { key: "similarity", label: "Image similarity", value: result.metrics.image_similarity, limit: minSimilarity, unit: "%", pass: result.metrics.image_similarity >= minSimilarity, comparator: "min" as const },
        { key: "inlier-ratio", label: "Inlier ratio", value: result.metrics.inlier_ratio * 100, limit: minInlierRatio, unit: "%", pass: result.metrics.inlier_ratio * 100 >= minInlierRatio, comparator: "min" as const },
        { key: "rmse", label: "RMSE", value: result.metrics.rmse, limit: maxRmse, unit: "px", pass: result.metrics.rmse <= maxRmse, comparator: "max" as const },
      ]
    : [];
  const thresholdsPass = thresholdChecks.length > 0 && thresholdChecks.every((check) => check.pass);
  const failedChecks = thresholdChecks.filter((check) => !check.pass).map((check) => check.label);

  const guardExport = (event: React.MouseEvent) => {
    if (!result) {
      event.preventDefault();
      toast.info("Run registration before exporting");
      return;
    }
    if (!thresholdsPass) {
      event.preventDefault();
      toast.error("Export blocked by quality thresholds", { description: `Below acceptance: ${failedChecks.join(", ")}` });
    }
  };

  const exportReport = () => {
    if (!result) {
      toast.info("Run registration before exporting", { description: "The report will include metrics and all point coordinates." });
      return;
    }
    if (!thresholdsPass) {
      toast.error("Export blocked by quality thresholds", { description: `Below acceptance: ${failedChecks.join(", ")}` });
      return;
    }
    const link = document.createElement("a");
    link.href = result.report_url;
    link.download = `moon-registration-${result.id}.json`;
    link.click();
    toast.success("Evaluation report exported");
  };

  const resetSession = () => {
    setSourceFile(null);
    setSourcePreview(null);
    setResult(null);
    setComparison(null);
    setSelectedPoint(null);
    setCoordinateQueryKey(null);
    toast.success("Session reset");
  };

  const searchCoordinate = () => {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      toast.error("Enter a latitude in -90…90 and longitude in -180…180");
      return;
    }
    setCoordinateQueryKey({ lat, lon });
  };

  const points = result?.match_points ?? [];
  const sourceWidth = result?.source_width ?? 1024;
  const sourceHeight = result?.source_height ?? 768;
  const referenceWidth = result?.reference_width ?? 1024;
  const referenceHeight = result?.reference_height ?? 768;
  const referenceDisplay = result?.reference_url ?? selectedReference?.image_url;
  const registeredDisplay = result?.preview_url ?? sourcePreview ?? undefined;

  return (
    <main className={`min-h-screen bg-[#0b1120] text-slate-100 ${hudGrid ? "hud-grid" : ""}`} data-testid="mission-control-dashboard">
      <header className="sticky top-0 z-50 border-b border-slate-800/90 bg-[#080d19]/90 px-4 py-3 backdrop-blur-xl md:px-6" data-testid="mission-telemetry-header">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded border border-amber-400/30 bg-amber-400/10 text-amber-300" data-testid="mission-mark"><Moon className="size-5" /></div>
            <div className="min-w-0">
              <p className="truncate font-mono text-sm font-semibold tracking-tight text-slate-100" data-testid="product-name">MOON MATCH POINTS</p>
              <p className="hidden truncate text-[10px] uppercase tracking-[0.22em] text-slate-500 sm:block" data-testid="product-subtitle">Chandrayaan-2 optical registration console</p>
            </div>
          </div>
          <div className="hidden items-center gap-5 lg:flex" data-testid="telemetry-readouts">
            <div className="telemetry-readout"><span>FRAME</span><strong data-testid="frame-coordinate-system">MOON2000</strong></div>
            <div className="telemetry-readout"><span>ENGINE</span><strong data-testid="ingest-status">SIFT / ORB / ECC</strong></div>
            <div className="telemetry-readout"><span>GATE</span><strong data-testid="threshold-gate-readout">{result ? (thresholdsPass ? "PASS" : "BLOCKED") : "IDLE"}</strong></div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="hidden border-emerald-400/20 bg-emerald-400/10 font-mono text-[10px] text-emerald-300 sm:inline-flex" data-testid="mission-status-badge"><span className="mr-1.5 size-1.5 rounded-full bg-emerald-400" />ONLINE</Badge>
            <Button variant="ghost" size="sm" onClick={() => setHudGrid((current) => !current)} data-testid="toggle-hud-grid-button" aria-label="Toggle HUD grid"><Activity className="mr-1.5 size-3.5" />HUD</Button>
            <Button variant="outline" size="sm" onClick={exportReport} data-testid="export-report-btn"><ArrowDownToLine className="mr-1.5 size-3.5" />Export</Button>
            <Button variant="ghost" size="sm" onClick={resetSession} data-testid="reset-session-btn"><RefreshCw className="mr-1.5 size-3.5" />Reset</Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] p-4 md:p-6 lg:p-8">
        <div className="mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end" data-testid="mission-introduction">
          <div>
            <p className="eyebrow text-cyan-300" data-testid="mission-eyebrow">REGISTRATION RUN / 001</p>
            <h1 className="mt-2 max-w-3xl font-mono text-2xl font-bold tracking-tight text-slate-100 md:text-3xl" data-testid="mission-title">Find the lunar correspondence field.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400" data-testid="mission-description">Stage a Chandrayaan-2 optical frame. The console resolves a compatible LROC reference, polishes the transform to sub-pixel with ECC, and exposes every match for evaluation.</p>
          </div>
          <div className="flex items-center gap-2 self-start rounded border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-emerald-300 lg:self-end" data-testid="real-cv-mode-notice"><Sparkles className="size-3.5" /> SIFT / ORB + RANSAC + ECC polish</div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <section className="space-y-5 lg:col-span-4" data-testid="source-reference-column">
            <Card className="panel-card p-5" data-testid="source-upload-panel">
              <SectionHeading eyebrow="01 / INPUT" title="Source frame" detail="One optical image is enough. Reference selection is automatic." testId="source-frame-heading" />
              <label className="upload-dropzone" data-testid="source-image-upload-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); handleFile(event.dataTransfer.files[0]); }}>
                <input className="sr-only" type="file" accept="image/png,image/jpeg,image/tiff,image/webp" onChange={(event) => handleFile(event.target.files?.[0])} data-testid="source-image-input" />
                {sourcePreview ? <img src={sourcePreview} alt="Uploaded Chandrayaan-2 source preview" className="absolute inset-0 size-full object-cover opacity-45" data-testid="source-image-preview" /> : null}
                <div className="relative z-10 flex flex-col items-center gap-3 text-center">
                  <div className="flex size-11 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-cyan-300"><UploadCloud className="size-5" /></div>
                  <div><p className="font-mono text-sm font-semibold text-slate-200" data-testid="source-upload-label">{sourceFile ? sourceFile.name : "Drop source image here"}</p><p className="mt-1 text-xs text-slate-500" data-testid="source-upload-help">PNG · JPEG · TIFF · WebP / max 20 MB</p></div>
                  <span className="rounded border border-slate-700 bg-slate-900/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-300" data-testid="source-browse-button">Browse local frame</span>
                </div>
              </label>

              <div className="mt-5 border-t border-slate-800 pt-4" data-testid="automatic-reference-panel">
                <div className="mb-3 flex items-center justify-between"><span className="label-mono" data-testid="automatic-reference-label">Automatic reference</span><Badge variant="outline" className="border-cyan-300/30 text-[10px] text-cyan-300" data-testid="auto-reference-status-badge"><Check className="mr-1 size-3" />Resolved</Badge></div>
                <div className="relative">
                  <select value={selectedReferenceId} onChange={(event) => setSelectedReferenceId(event.target.value)} className="h-11 w-full appearance-none rounded border border-slate-700 bg-slate-950/70 px-3 pr-9 font-mono text-xs text-slate-200 outline-none focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10" data-testid="reference-catalog-select" aria-label="Reference catalog selection">
                    <option value="auto" label="AUTO · Match reviewed LROC footprints" />
                    {catalog.map((item) => <option value={item.id} key={item.id} label={`${item.product_id} · ${item.title}`} />)}
                  </select>
                  <ChevronRight className="pointer-events-none absolute right-3 top-3.5 size-4 rotate-90 text-slate-500" />
                </div>
                {selectedReference ? <div className="mt-3 flex gap-3 rounded border border-slate-800 bg-slate-950/40 p-2.5" data-testid="selected-reference-summary"><img src={selectedReference.image_url} alt="Selected LROC reference" className="size-14 rounded object-cover grayscale" /><div className="min-w-0"><p className="truncate font-mono text-xs text-slate-200" data-testid="selected-reference-title">{selectedReferenceId === "auto" && !result ? "Automatic footprint match" : selectedReference.title}</p><p className="mt-1 text-[11px] text-slate-500" data-testid="selected-reference-location">{selectedReference.location} · {selectedReference.footprint.center_latitude.toFixed(2)}°, {selectedReference.footprint.center_longitude.toFixed(2)}°</p><p className="mt-1 font-mono text-[10px] text-emerald-300/80" data-testid="selected-reference-review-status">{selectedReference.footprint.review_status} · {selectedReference.footprint.crs}</p></div></div> : null}
              </div>
            </Card>

            <Card className="panel-card p-5" data-testid="coordinate-search-panel">
              <SectionHeading eyebrow="02 / LOCATE" title="Coordinate search" detail="Shortlist reviewed footprints that intersect a selenographic coordinate." testId="coordinate-search-heading" />
              <div className="grid grid-cols-2 gap-3">
                <label className="block" data-testid="latitude-field"><span className="label-mono mb-1.5 block">Latitude °</span><input value={latitude} onChange={(event) => setLatitude(event.target.value)} inputMode="decimal" className="h-10 w-full rounded border border-slate-700 bg-slate-950/70 px-3 font-mono text-xs text-slate-200 outline-none focus:border-cyan-300/60" data-testid="latitude-input" aria-label="Latitude" /></label>
                <label className="block" data-testid="longitude-field"><span className="label-mono mb-1.5 block">Longitude °</span><input value={longitude} onChange={(event) => setLongitude(event.target.value)} inputMode="decimal" className="h-10 w-full rounded border border-slate-700 bg-slate-950/70 px-3 font-mono text-xs text-slate-200 outline-none focus:border-cyan-300/60" data-testid="longitude-input" aria-label="Longitude" /></label>
              </div>
              <Button className="mt-4 w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300" onClick={searchCoordinate} disabled={coordinateQuery.isFetching} data-testid="coordinate-search-btn"><Crosshair className="mr-2 size-4" />{coordinateQuery.isFetching ? "Searching footprints…" : "Find intersecting footprints"}</Button>
              {coordinateQuery.isError ? <p className="mt-3 font-mono text-[11px] text-rose-300" data-testid="coordinate-search-error">Coordinate search unavailable.</p> : null}
              {coordinateQuery.data ? (
                <div className="mt-4 space-y-2" data-testid="coordinate-search-results">
                  {coordinateQuery.data.length === 0 ? <p className="font-mono text-[11px] text-slate-500" data-testid="coordinate-search-empty">No reviewed footprint near this coordinate.</p> : null}
                  {coordinateQuery.data.map((match) => (
                    <button key={match.item.id} onClick={() => { setSelectedReferenceId(match.item.id); toast.success(`${match.item.product_id} selected as reference`); }} className={`flex w-full items-center gap-3 rounded border p-2.5 text-left transition-colors duration-200 hover:border-cyan-300/50 ${selectedReferenceId === match.item.id ? "border-cyan-300/60 bg-cyan-300/10" : "border-slate-800 bg-slate-950/40"}`} data-testid={`coordinate-result-${match.item.id}`}>
                      <img src={match.item.image_url} alt={match.item.title} className="size-11 shrink-0 rounded object-cover grayscale" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[11px] text-slate-200" data-testid={`coordinate-result-title-${match.item.id}`}>{match.item.title}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-500" data-testid={`coordinate-result-distance-${match.item.id}`}>{match.contains ? "contains point" : "nearby"} · Δ {match.distance_deg.toFixed(2)}°</p>
                      </div>
                      <Badge variant="outline" className={`shrink-0 px-1.5 text-[9px] ${match.contains ? "border-emerald-400/30 text-emerald-300" : "border-slate-700 text-slate-400"}`} data-testid={`coordinate-result-badge-${match.item.id}`}>{match.contains ? "INSIDE" : `${match.distance_deg.toFixed(1)}°`}</Badge>
                    </button>
                  ))}
                </div>
              ) : null}
            </Card>

            <Card className="panel-card p-5" data-testid="alignment-controls-panel">
              <SectionHeading eyebrow="03 / ALIGN" title="Sub-pixel refinement" detail="ECC polish and feature strategy drive the solved transform." testId="alignment-controls-heading" />
              <div className="mb-4 flex items-center justify-between rounded border border-amber-400/20 bg-amber-400/5 px-3 py-2.5" data-testid="refinement-status"><div className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-amber-300" /><span className="font-mono text-xs text-amber-200" data-testid="refinement-status-label">Sub-pixel + ECC polish</span></div><button className={`relative h-5 w-9 rounded-full ${refineEnabled ? "bg-amber-400" : "bg-slate-700"}`} onClick={() => setRefineEnabled((enabled) => !enabled)} data-testid="subpixel-refine-trigger-btn" aria-label="Toggle pixel refinement"><span className={`absolute top-1 size-3 rounded-full bg-slate-950 transition-transform ${refineEnabled ? "translate-x-5" : "translate-x-1"}`} /></button></div>
              <label className="block" data-testid="feature-method-control"><span className="label-mono mb-1.5 block">Feature strategy</span><select value={featureMethod} onChange={(event) => setFeatureMethod(event.target.value)} className="h-10 w-full rounded border border-slate-700 bg-slate-950/70 px-3 font-mono text-xs text-slate-200" data-testid="feature-method-select"><option value="auto" label="SIFT default · ORB fallback" /><option value="sift" label="SIFT only · scale robust" /><option value="orb" label="ORB only · faster" /></select></label>
              <Button className="mt-5 w-full bg-amber-400 text-slate-950 hover:bg-amber-300" onClick={() => registrationMutation.mutate()} disabled={!sourceFile || registrationMutation.isPending} data-testid="run-registration-btn"><Crosshair className="mr-2 size-4" />{registrationMutation.isPending ? "Solving correspondence…" : "Run registration"}</Button>
              <Button variant="outline" className="mt-2 w-full" onClick={() => comparisonMutation.mutate()} disabled={!sourceFile || comparisonMutation.isPending} data-testid="compare-engines-btn"><Split className="mr-2 size-4" />{comparisonMutation.isPending ? "Benchmarking SIFT vs ORB…" : "Compare engines"}</Button>
              <p className="mt-2 text-center text-[10px] text-slate-600" data-testid="registration-engine-note">Real feature matching · source image is not retained after processing</p>
            </Card>

            <Card className="panel-card p-5" data-testid="quality-thresholds-panel">
              <SectionHeading eyebrow="04 / ACCEPT" title="Quality thresholds" detail="Exports stay locked until the run clears every acceptance limit." testId="quality-thresholds-heading" />
              <div className="space-y-3">
                <ThresholdField label="Min image similarity" value={minSimilarity} unit="%" step={1} onChange={setMinSimilarity} testId="threshold-similarity" />
                <ThresholdField label="Min inlier ratio" value={minInlierRatio} unit="%" step={1} onChange={setMinInlierRatio} testId="threshold-inlier-ratio" />
                <ThresholdField label="Max RMSE" value={maxRmse} unit="px" step={0.05} onChange={setMaxRmse} testId="threshold-rmse" />
              </div>
              <div className="mt-4 border-t border-slate-800 pt-4">
                {result ? (
                  <div className="space-y-2" data-testid="threshold-evaluation">
                    {thresholdChecks.map((check) => (
                      <div key={check.key} className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/40 px-3 py-2 font-mono text-[11px]" data-testid={`threshold-check-${check.key}`}>
                        <span className="text-slate-400">{check.label}</span>
                        <span className={check.pass ? "text-emerald-300" : "text-rose-300"} data-testid={`threshold-check-${check.key}-status`}>
                          {check.pass ? <Check className="mr-1 inline size-3" /> : <X className="mr-1 inline size-3" />}
                          {check.value.toFixed(check.unit === "px" ? 3 : 1)} {check.unit} / {check.comparator} {check.limit} {check.unit}
                        </span>
                      </div>
                    ))}
                    <p className={`rounded border px-3 py-2 font-mono text-[11px] ${thresholdsPass ? "border-emerald-400/30 bg-emerald-400/5 text-emerald-300" : "border-rose-400/30 bg-rose-400/5 text-rose-300"}`} data-testid="threshold-gate-status">
                      <ShieldCheck className="mr-1.5 inline size-3.5" />{thresholdsPass ? "Accepted · export unlocked" : `Export blocked · ${failedChecks.join(", ")}`}
                    </p>
                  </div>
                ) : (
                  <p className="font-mono text-[11px] text-slate-500" data-testid="threshold-idle-state">Run a registration to evaluate against these limits.</p>
                )}
              </div>
            </Card>
          </section>

          <section className="lg:col-span-8" data-testid="registration-workspace">
            <Card className="panel-card overflow-hidden" data-testid="registration-viewport-panel">
              <div className="flex flex-col justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:flex-row sm:items-center" data-testid="registration-viewport-toolbar"><div><p className="eyebrow" data-testid="viewport-eyebrow">05 / SOLUTION VIEW</p><h2 className="mt-1 font-mono text-sm font-semibold text-slate-100" data-testid="viewport-title">Registered product preview</h2></div><div className="flex items-center gap-1 rounded border border-slate-800 bg-slate-950/60 p-1" data-testid="registration-mode-controls">{VIEW_MODES.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setViewMode(id)} className={`view-mode-btn ${viewMode === id ? "view-mode-active" : ""}`} data-testid={`registration-mode-${id}-btn`}><Icon className="size-3.5" />{label}</button>)}</div></div>
              <div className="p-4">
                <div className={`registration-viewport mode-${viewMode}`} data-testid="registration-viewport">
                  {!sourcePreview ? <div className="absolute inset-0 flex flex-col items-center justify-center text-center"><div className="mb-4 flex size-16 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-600"><Target className="size-7" /></div><p className="font-mono text-sm text-slate-400" data-testid="viewport-empty-title">Awaiting source frame</p><p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-600" data-testid="viewport-empty-help">Upload a Chandrayaan-2 optical image to resolve a LROC reference and expose match geometry.</p></div> : null}

                  {sourcePreview && viewMode === "split" ? (
                    <div className="grid h-full grid-cols-2 gap-px bg-cyan-300/20" data-testid="split-view">
                      <ViewportImage src={sourcePreview} alt="Source image" label="SOURCE / CHANDRAYAAN-2" tone="amber" dataTestId="source-viewport-image">
                        {points.map((point) => <Marker key={point.index} point={point} left={(point.source_x / sourceWidth) * 100} top={(point.source_y / sourceHeight) * 100} selected={selectedPoint === point.index} />)}
                      </ViewportImage>
                      <ViewportImage src={referenceDisplay} alt="Registered lunar image" label={result ? "REGISTERED / GEOTIFF PREVIEW" : "REFERENCE / LROC"} tone="cyan" dataTestId="reference-viewport-image">
                        {points.map((point) => <Marker key={point.index} point={point} left={(point.reference_x / referenceWidth) * 100} top={(point.reference_y / referenceHeight) * 100} selected={selectedPoint === point.index} />)}
                      </ViewportImage>
                    </div>
                  ) : null}

                  {sourcePreview && viewMode === "blend" ? (
                    <div className="relative size-full overflow-hidden bg-black" data-testid="blend-view">
                      <img src={referenceDisplay} alt="LROC reference image" className="absolute inset-0 size-full object-cover grayscale" data-testid="reference-overlay-image" />
                      <img src={registeredDisplay} alt="Registered image overlay" className="absolute inset-0 size-full object-cover mix-blend-screen transition-opacity duration-300" style={{ opacity: blendOpacity }} data-testid="source-overlay-image" />
                      <div className="absolute bottom-3 right-3 w-40 rounded border border-slate-700/70 bg-slate-950/85 px-3 py-2 backdrop-blur" data-testid="blend-opacity-control">
                        <div className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-slate-400"><span>blend</span><span className="text-amber-300" data-testid="blend-opacity-value">{Math.round(blendOpacity * 100)}%</span></div>
                        <input type="range" min={0} max={1} step={0.01} value={blendOpacity} onChange={(event) => setBlendOpacity(Number(event.target.value))} className="range-amber w-full" data-testid="blend-opacity-input" aria-label="Blend opacity" />
                      </div>
                    </div>
                  ) : null}

                  {sourcePreview && viewMode === "difference" ? (
                    <div className="relative size-full overflow-hidden bg-black" data-testid="difference-view">
                      <img src={referenceDisplay} alt="LROC reference image" className="absolute inset-0 size-full object-cover grayscale" data-testid="reference-overlay-image" />
                      <img src={registeredDisplay} alt="Registered difference overlay" className="absolute inset-0 size-full object-cover grayscale mix-blend-difference contrast-[1.6]" data-testid="source-overlay-image" />
                      <div className="absolute bottom-3 right-3 rounded border border-slate-700/70 bg-slate-950/85 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-wider text-slate-300 backdrop-blur" data-testid="difference-legend">dark = aligned residual</div>
                    </div>
                  ) : null}

                  {sourcePreview && viewMode === "vectors" ? (
                    <div className="relative size-full overflow-hidden bg-black" data-testid="vectors-view">
                      <img src={referenceDisplay} alt="LROC reference image" className="absolute inset-0 size-full object-cover opacity-40 grayscale" data-testid="reference-overlay-image" />
                      {points.length ? (
                        <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" data-testid="residual-vector-overlay">
                          {points.map((point) => {
                            const x1 = (point.source_x / sourceWidth) * 100;
                            const y1 = (point.source_y / sourceHeight) * 100;
                            const x2 = (point.reference_x / referenceWidth) * 100;
                            const y2 = (point.reference_y / referenceHeight) * 100;
                            const active = selectedPoint === point.index;
                            return (
                              <g key={point.index} data-testid={`residual-vector-${point.index}`}>
                                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={active ? "#fcd34d" : "#22d3ee"} strokeWidth={active ? 0.6 : 0.3} strokeOpacity={active ? 1 : 0.75} vectorEffect="non-scaling-stroke" />
                                <circle cx={x1} cy={y1} r={0.5} fill="#fbbf24" />
                                <circle cx={x2} cy={y2} r={0.5} fill="#22d3ee" />
                              </g>
                            );
                          })}
                        </svg>
                      ) : (
                        <p className="absolute inset-0 flex items-center justify-center font-mono text-xs text-slate-500" data-testid="vectors-empty-state">Run registration to draw residual vectors.</p>
                      )}
                    </div>
                  ) : null}

                  {sourcePreview ? <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded border border-slate-700/70 bg-slate-950/80 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-wider backdrop-blur" data-testid="viewport-legend"><span className="flex items-center gap-1.5 text-amber-300"><i className="legend-dot bg-amber-300" />source</span><span className="flex items-center gap-1.5 text-cyan-300"><i className="legend-dot bg-cyan-300" />reference</span>{result ? <span className="text-emerald-300">{points.length} points</span> : <span className="text-slate-500">preview</span>}</div> : null}
                </div>
                <div className="mt-3 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-600" data-testid="viewport-footer"><span>{result ? `${sourceWidth}×${sourceHeight} → ${referenceWidth}×${referenceHeight} px` : "Coordinate frame / pixel"}</span><span>{result ? `run ${result.id.slice(0, 8)}` : "not solved"}</span></div>
              </div>
            </Card>

            <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-5">
              <Card className="panel-card p-5 xl:col-span-2" data-testid="evaluation-metrics-panel">
                <SectionHeading eyebrow="06 / EVALUATE" title="Registration quality" detail="Evaluation metrics from the current correspondence set." testId="evaluation-heading" />
                {result ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Metric label="RMSE" value={result.metrics.rmse.toFixed(3)} unit="px" target={`under ${maxRmse} px`} />
                    <Metric label="Inlier count" value={String(result.metrics.inlier_count)} unit="points" target="over 20" tone="cyan" />
                    <Metric label="Inlier ratio" value={`${(result.metrics.inlier_ratio * 100).toFixed(1)}`} unit="%" target={`over ${minInlierRatio}%`} tone="emerald" />
                    <Metric label="Subpixel accuracy" value={`±${result.metrics.subpixel_accuracy.toFixed(3)}`} unit="px" target="± 0.50 px" />
                    <Metric label="Image similarity" value={result.metrics.image_similarity.toFixed(1)} unit="%" target={`over ${minSimilarity}%`} tone="cyan" />
                    <Metric label="Point uniformity" value={result.metrics.point_uniformity.toFixed(1)} unit="%" target="over 70%" tone="emerald" />
                  </div>
                ) : (
                  <div className="rounded border border-dashed border-slate-700 p-5 text-center"><Gauge className="mx-auto size-6 text-slate-600" /><p className="mt-3 font-mono text-xs text-slate-500" data-testid="metrics-empty-state">Metrics appear after a registration run.</p></div>
                )}
                <div className="mt-4 border-t border-slate-800 pt-4" data-testid="transform-summary">
                  <p className="label-mono" data-testid="transform-summary-label">Transform solution</p>
                  <div className="mt-2 grid grid-cols-4 gap-2 font-mono text-xs">
                    <TransformReadout label="delta-x" value={result?.metrics.offset_x ?? 0} unit="px" />
                    <TransformReadout label="delta-y" value={result?.metrics.offset_y ?? 0} unit="px" />
                    <TransformReadout label="rotation" value={result?.metrics.rotation_deg ?? 0} unit="deg" />
                    <TransformReadout label="ecc" value={result?.metrics.ecc_correlation ?? 0} unit="corr" />
                  </div>
                </div>
                {result ? <div className="mt-4 grid grid-cols-2 gap-2" data-testid="registered-product-downloads"><a href={thresholdsPass ? result.geotiff_url : undefined} download onClick={guardExport} className={`inline-flex h-9 items-center justify-center rounded border font-mono text-[10px] uppercase tracking-wider transition-colors duration-200 ${thresholdsPass ? "border-amber-300/30 bg-amber-300/10 text-amber-200 hover:bg-amber-300/20" : "cursor-not-allowed border-slate-700 bg-slate-900/60 text-slate-500"}`} data-testid="download-geotiff-button"><ArrowDownToLine className="mr-1.5 size-3.5" />GeoTIFF</a><a href={thresholdsPass ? result.report_url : undefined} download onClick={guardExport} className={`inline-flex h-9 items-center justify-center rounded border font-mono text-[10px] uppercase tracking-wider transition-colors duration-200 ${thresholdsPass ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-200 hover:bg-cyan-300/20" : "cursor-not-allowed border-slate-700 bg-slate-900/60 text-slate-500"}`} data-testid="download-report-button"><ArrowDownToLine className="mr-1.5 size-3.5" />JSON sidecar</a><p className="col-span-2 text-[10px] leading-relaxed text-slate-500" data-testid="reference-selection-reason">{result.selection_reason}</p></div> : null}
              </Card>
              <Card className="panel-card min-w-0 p-5 xl:col-span-3" data-testid="match-points-panel">
                <div className="mb-4 flex items-start justify-between gap-3"><SectionHeading eyebrow="07 / CORRESPONDENCES" title="Match point coordinates" detail="Click a row to highlight its vector in the viewport." testId="match-points-heading" /><Badge variant="outline" className="shrink-0 border-slate-700 font-mono text-[10px] text-slate-400" data-testid="match-point-count-badge">{points.length} points</Badge></div>
                {points.length ? (
                  <div className="max-h-[420px] overflow-auto rounded border border-slate-800" data-testid="match-points-table">
                    <Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Source x / y</TableHead><TableHead>Reference x / y</TableHead><TableHead>Similarity</TableHead><TableHead>Residual</TableHead></TableRow></TableHeader><TableBody>
                      {points.map((point) => <TableRow key={point.index} className={selectedPoint === point.index ? "cursor-pointer bg-cyan-300/10" : "cursor-pointer"} onClick={() => setSelectedPoint(point.index)} data-testid={`match-point-row-${point.index}`}><TableCell className="font-mono text-slate-500">{String(point.index).padStart(2, "0")}</TableCell><TableCell className="font-mono text-amber-200/90" data-testid={`match-point-source-coordinate-${point.index}`}>{point.source_x.toFixed(2)} / {point.source_y.toFixed(2)}</TableCell><TableCell className="font-mono text-cyan-200/90" data-testid={`match-point-reference-coordinate-${point.index}`}>{point.reference_x.toFixed(2)} / {point.reference_y.toFixed(2)}</TableCell><TableCell className="font-mono text-emerald-300" data-testid={`match-point-similarity-${point.index}`}>{point.descriptor_similarity.toFixed(1)}%</TableCell><TableCell className="font-mono text-slate-400">{point.residual_error.toFixed(3)} px</TableCell></TableRow>)}
                    </TableBody></Table>
                  </div>
                ) : (
                  <div className="flex min-h-40 items-center justify-center rounded border border-dashed border-slate-700 text-center"><p className="font-mono text-xs text-slate-600" data-testid="match-points-empty-state">No correspondence set yet.</p></div>
                )}
              </Card>
            </div>

            <Card className="panel-card mt-5 p-5" data-testid="engine-comparison-panel">
              <SectionHeading eyebrow="08 / BENCHMARK" title="SIFT versus ORB" detail="Both engines run on the same source and reference pair for a fair comparison." testId="engine-comparison-heading" />
              {comparison ? (
                <div data-testid="engine-comparison-report">
                  <div className="mb-4 flex flex-wrap items-center gap-3 rounded border border-emerald-400/25 bg-emerald-400/5 px-3 py-2.5 font-mono text-[11px] text-emerald-300" data-testid="engine-recommendation">
                    <ShieldCheck className="size-4" />
                    <span data-testid="engine-recommendation-text">{comparison.recommendation_reason}</span>
                    <Badge variant="outline" className="ml-auto border-emerald-400/30 text-[9px] text-emerald-300" data-testid="engine-recommended-badge">{comparison.recommended_engine.toUpperCase()}</Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {comparison.engines.map((engine) => (
                      <div key={engine.engine} className={`rounded border p-4 ${engine.engine === comparison.recommended_engine ? "border-emerald-400/40 bg-emerald-400/5" : "border-slate-800 bg-slate-950/40"}`} data-testid={`engine-card-${engine.engine}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-mono text-xs font-semibold text-slate-200" data-testid={`engine-name-${engine.engine}`}>{engine.engine.toUpperCase()}</p>
                          <span className="font-mono text-[10px] text-slate-500" data-testid={`engine-elapsed-${engine.engine}`}>{engine.elapsed_ms.toFixed(0)} ms</span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500" data-testid={`engine-label-${engine.engine}`}>{engine.label}</p>
                        {engine.solved && engine.metrics ? (
                          <dl className="mt-3 grid grid-cols-2 gap-2 font-mono text-[11px]">
                            <ComparisonStat label="RMSE" value={`${engine.metrics.rmse.toFixed(3)} px`} testId={`engine-rmse-${engine.engine}`} />
                            <ComparisonStat label="Inliers" value={`${engine.metrics.inlier_count} / ${engine.metrics.total_matches}`} testId={`engine-inliers-${engine.engine}`} />
                            <ComparisonStat label="Inlier ratio" value={`${(engine.metrics.inlier_ratio * 100).toFixed(1)}%`} testId={`engine-inlier-ratio-${engine.engine}`} />
                            <ComparisonStat label="Similarity" value={`${engine.metrics.image_similarity.toFixed(1)}%`} testId={`engine-similarity-${engine.engine}`} />
                            <ComparisonStat label="Sub-pixel" value={`±${engine.metrics.subpixel_accuracy.toFixed(3)} px`} testId={`engine-subpixel-${engine.engine}`} />
                            <ComparisonStat label="Uniformity" value={`${engine.metrics.point_uniformity.toFixed(1)}%`} testId={`engine-uniformity-${engine.engine}`} />
                          </dl>
                        ) : (
                          <p className="mt-3 font-mono text-[11px] text-rose-300" data-testid={`engine-failure-${engine.engine}`}>{engine.detail ?? "No transform solved"}</p>
                        )}
                        <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => { setFeatureMethod(engine.engine); toast.success(`${engine.engine.toUpperCase()} selected for the next run`); }} data-testid={`engine-select-${engine.engine}`}>Use {engine.engine.toUpperCase()}</Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded border border-dashed border-slate-700 p-6 text-center" data-testid="engine-comparison-empty-state">
                  <Split className="mx-auto size-6 text-slate-600" />
                  <p className="mt-3 font-mono text-xs text-slate-500">Stage a source frame and run “Compare engines” for a side-by-side metric report.</p>
                </div>
              )}
            </Card>
          </section>
        </div>

        <section className="mt-5" data-testid="lroc-catalog-drawer">
          <Card className="panel-card p-5" data-testid="catalog-metadata-drawer"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><SectionHeading eyebrow="09 / REFERENCE LIBRARY" title="Reviewed LROC footprints" detail="Curated bounds, centers, resolution and provenance enhance automatic reference selection." testId="catalog-heading" /><div className="flex items-center gap-2"><div className="relative"><Database className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-slate-500" /><input value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Filter products" className="h-9 w-44 rounded border border-slate-700 bg-slate-950/60 pl-9 pr-3 font-mono text-xs text-slate-200 outline-none focus:border-cyan-300/60" data-testid="catalog-search-input" /></div><span className="font-mono text-[10px] uppercase tracking-wider text-emerald-300" data-testid="catalog-connection-status"><span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-400" />{catalogQuery.isError ? "offline fallback" : "reviewed mongo snapshot"}</span></div></div><div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">{filteredCatalog.map((item) => <div key={item.id} className="catalog-card" data-testid={`catalog-card-${item.id}`}><img src={item.image_url} alt={item.title} className="h-28 w-full object-cover grayscale transition duration-300 hover:grayscale-0" /><div className="p-3"><div className="flex items-start justify-between gap-2"><p className="font-mono text-xs font-semibold leading-relaxed text-slate-200" data-testid={`catalog-title-${item.id}`}>{item.title}</p><Badge variant="outline" className="shrink-0 border-emerald-400/20 px-1.5 text-[9px] text-emerald-300">{item.footprint.review_status}</Badge></div><p className="mt-2 text-[11px] text-slate-500" data-testid={`catalog-location-${item.id}`}>{item.location} · {item.resolution}</p><p className="mt-1 font-mono text-[10px] text-slate-600" data-testid={`catalog-footprint-${item.id}`}>CTR {item.footprint.center_latitude.toFixed(2)}°, {item.footprint.center_longitude.toFixed(2)}° · {item.footprint.crs}</p><div className="mt-3 flex items-center justify-between"><span className="font-mono text-[10px] text-slate-600">{item.product_id}</span><a href={item.footprint.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-cyan-300 hover:text-cyan-200" data-testid={`catalog-source-link-${item.id}`}>footprint <ExternalLink className="size-3" /></a></div></div></div>)}</div><div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-800 pt-4 text-[10px] uppercase tracking-wider text-slate-500"><span className="flex items-center gap-1.5" data-testid="catalog-source-label"><Database className="size-3.5 text-cyan-300" /> reviewed provenance</span><a href="https://lroc.im-ldi.com/images/downloads/" target="_blank" rel="noreferrer" className="hover:text-slate-300" data-testid="lroc-downloads-link">LROC Downloads ↗</a><a href="https://quickmap.lroc.im-ldi.com/" target="_blank" rel="noreferrer" className="hover:text-slate-300" data-testid="lroc-quickmap-link">QuickMap ↗</a><span className="ml-auto flex items-center gap-1.5 text-emerald-300/80" data-testid="catalog-fallback-note"><Check className="size-3" /> reviewed local footprint table</span></div></Card>
        </section>

        <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-slate-800/80 pt-4 text-[10px] font-mono uppercase tracking-wider text-slate-600 sm:flex-row" data-testid="mission-footer"><span>Moon Match Points / research workstation</span><span data-testid="footer-method-note">sub-pixel ECC polish · affine geometry · uniform point field</span></footer>
      </div>
    </main>
  );
}

function ComparisonStat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-950/60 p-2" data-testid={testId}>
      <dt className="text-[9px] uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-200">{value}</dd>
    </div>
  );
}

function ThresholdField({ label, value, unit, step, onChange, testId }: { label: string; value: number; unit: string; step: number; onChange: (value: number) => void; testId: string }) {
  return (
    <label className="flex items-center justify-between gap-3" data-testid={testId}>
      <span className="label-mono">{label}</span>
      <span className="flex items-center gap-1.5">
        <input type="number" step={step} min={0} value={value} onChange={(event) => onChange(Number(event.target.value))} className="h-9 w-20 rounded border border-slate-700 bg-slate-950/70 px-2 text-right font-mono text-xs text-amber-300 outline-none focus:border-amber-300/60" data-testid={`${testId}-input`} aria-label={label} />
        <span className="font-mono text-[10px] text-slate-500">{unit}</span>
      </span>
    </label>
  );
}

function Marker({ point, left, top, selected }: { point: MatchPoint; left: number; top: number; selected: boolean }) {
  if (left < 0 || left > 100 || top < 0 || top > 100) return null;
  return (
    <div className={`match-marker ${selected ? "match-marker-selected" : ""}`} style={{ left: `${left}%`, top: `${top}%` }} data-testid={`match-point-marker-${point.index}`}>
      <span>{point.index}</span>
    </div>
  );
}

function TransformReadout({ label, value, unit }: { label: string; value: number; unit: string }) {
  return <div className="rounded border border-slate-800 bg-slate-950/50 p-2" data-testid={`transform-${label}-value`}><span className="block text-slate-600">{label}</span><strong className="mt-1 block text-slate-300">{value.toFixed(2)} {unit}</strong></div>;
}

function ViewportImage({ src, alt, label, tone, dataTestId, children }: { src?: string; alt: string; label: string; tone: "amber" | "cyan"; dataTestId: string; children?: React.ReactNode }) {
  return (
    <div className="relative min-w-0 overflow-hidden bg-black" data-testid={`${dataTestId}-panel`}>
      <img src={src} alt={alt} className="size-full object-cover opacity-80 grayscale" data-testid={dataTestId} />
      <div className={`absolute left-2 top-2 rounded border px-2 py-1 font-mono text-[9px] tracking-wider backdrop-blur ${tone === "amber" ? "border-amber-300/30 bg-amber-300/10 text-amber-200" : "border-cyan-300/30 bg-cyan-300/10 text-cyan-200"}`} data-testid={`${dataTestId}-label`}>{label}</div>
      {children}
    </div>
  );
}
