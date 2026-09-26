import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  Activity,
  ArrowDownToLine,
  Check,
  ChevronRight,
  Crosshair,
  Database,
  ExternalLink,
  FileImage,
  Filter,
  Gauge,
  Layers3,
  Moon,
  MousePointer2,
  RefreshCw,
  ScanLine,
  SlidersHorizontal,
  Sparkles,
  Target,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiPostForm } from "@/lib/api";
import type { CatalogItem, MatchPoint, RegistrationResult } from "@/lib/api";

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
  const [selectedReferenceId, setSelectedReferenceId] = useState("");
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [refineEnabled, setRefineEnabled] = useState(true);
  const [shiftX, setShiftX] = useState(0);
  const [shiftY, setShiftY] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(1);
  const [hudGrid, setHudGrid] = useState(true);
  const [catalogSearch, setCatalogSearch] = useState("");

  const catalogQuery = useQuery({
    queryKey: ["catalog"],
    queryFn: () => apiGet<CatalogItem[]>("/catalog"),
    retry: false,
  });
  const catalog = catalogQuery.data?.length ? catalogQuery.data : FALLBACK_CATALOG;

  useEffect(() => {
    if (!selectedReferenceId && catalog[0]) setSelectedReferenceId(catalog[0].id);
  }, [catalog, selectedReferenceId]);

  const selectedReference = catalog.find((item) => item.id === selectedReferenceId) ?? catalog[0];
  const filteredCatalog = useMemo(() => {
    const term = catalogSearch.toLowerCase().trim();
    return term ? catalog.filter((item) => `${item.title} ${item.product_id} ${item.location}`.toLowerCase().includes(term)) : catalog;
  }, [catalog, catalogSearch]);

  const registrationMutation = useMutation({
    mutationFn: async () => {
      if (!sourceFile) throw new Error("Choose a source image first");
      const form = new FormData();
      form.append("source_image", sourceFile);
      form.append("reference_id", selectedReference?.id ?? "");
      form.append("refine", String(refineEnabled));
      form.append("rotation", String(rotation));
      form.append("scale", String(scale));
      return apiPostForm<RegistrationResult>("/registration/run", form);
    },
    onSuccess: (nextResult) => {
      setResult(nextResult);
      setShiftX(nextResult.metrics.offset_x);
      setShiftY(nextResult.metrics.offset_y);
      toast.success("Registration preview generated", { description: "Correspondences and residuals are ready for review." });
    },
    onError: () => toast.error("Registration could not run", { description: "The interface remains available with the local catalog fallback." }),
  });

  const handleFile = (file?: File) => {
    if (!file) return;
    setSourceFile(file);
    setSourcePreview(URL.createObjectURL(file));
    setResult(null);
    toast.success("Source image staged", { description: "A LROC reference will be resolved automatically." });
  };

  const exportReport = () => {
    if (!result) {
      toast.info("Run registration before exporting", { description: "The report will include metrics and all point coordinates." });
      return;
    }
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `moon-registration-${result.id}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success("Evaluation report exported");
  };

  const resetSession = () => {
    setSourceFile(null);
    setSourcePreview(null);
    setResult(null);
    setSelectedPoint(null);
    setShiftX(0);
    setShiftY(0);
    setRotation(0);
    setScale(1);
    toast.success("Session reset");
  };

  const transform = `translate(${shiftX * 2}px, ${shiftY * 2}px) rotate(${rotation}deg) scale(${scale})`;
  const points = result?.match_points ?? [];

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
            <div className="telemetry-readout"><span>INGEST</span><strong data-testid="ingest-status">LROC SNAPSHOT</strong></div>
            <div className="telemetry-readout"><span>LATENCY</span><strong data-testid="latency-readout">12 ms</strong></div>
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
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400" data-testid="mission-description">Stage a Chandrayaan-2 optical frame. The console resolves a compatible LROC reference, refines a geometric transform, and exposes every match for evaluation.</p>
          </div>
          <div className="flex items-center gap-2 self-start rounded border border-amber-400/20 bg-amber-400/5 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-amber-300 lg:self-end" data-testid="demo-mode-notice"><Sparkles className="size-3.5" /> Demo evaluation engine / deterministic</div>
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
                    {catalog.map((item) => <option value={item.id} key={item.id} label={`${item.product_id} · ${item.title}`} />)}
                  </select>
                  <ChevronRight className="pointer-events-none absolute right-3 top-3.5 size-4 rotate-90 text-slate-500" />
                </div>
                {selectedReference ? <div className="mt-3 flex gap-3 rounded border border-slate-800 bg-slate-950/40 p-2.5" data-testid="selected-reference-summary"><img src={selectedReference.image_url} alt="Selected LROC reference" className="size-14 rounded object-cover grayscale" /><div className="min-w-0"><p className="truncate font-mono text-xs text-slate-200" data-testid="selected-reference-title">{selectedReference.title}</p><p className="mt-1 text-[11px] text-slate-500" data-testid="selected-reference-location">{selectedReference.location}</p><p className="mt-1 font-mono text-[10px] text-amber-300/80" data-testid="selected-reference-resolution">{selectedReference.resolution}</p></div></div> : null}
              </div>
            </Card>

            <Card className="panel-card p-5" data-testid="alignment-controls-panel">
              <SectionHeading eyebrow="02 / ALIGN" title="Sub-pixel refinement" detail="Affine controls are passed into each evaluation run." testId="alignment-controls-heading" />
              <div className="mb-4 flex items-center justify-between rounded border border-amber-400/20 bg-amber-400/5 px-3 py-2.5" data-testid="refinement-status"><div className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-amber-300" /><span className="font-mono text-xs text-amber-200" data-testid="refinement-status-label">Pixel refinement</span></div><button className={`relative h-5 w-9 rounded-full ${refineEnabled ? "bg-amber-400" : "bg-slate-700"}`} onClick={() => setRefineEnabled((enabled) => !enabled)} data-testid="subpixel-refine-trigger-btn" aria-label="Toggle pixel refinement"><span className={`absolute top-1 size-3 rounded-full bg-slate-950 transition-transform ${refineEnabled ? "translate-x-5" : "translate-x-1"}`} /></button></div>
              <div className="space-y-4">
                <Control label="X shift" value={shiftX} min={-2} max={2} step={0.01} unit="px" onChange={setShiftX} testId="x-shift-control" />
                <Control label="Y shift" value={shiftY} min={-2} max={2} step={0.01} unit="px" onChange={setShiftY} testId="y-shift-control" />
                <Control label="Rotation" value={rotation} min={-4} max={4} step={0.01} unit="deg" onChange={setRotation} testId="rotation-control" />
                <Control label="Scale ratio" value={scale} min={0.98} max={1.02} step={0.001} unit="×" onChange={setScale} testId="scale-control" />
              </div>
              <Button className="mt-5 w-full bg-amber-400 text-slate-950 hover:bg-amber-300" onClick={() => registrationMutation.mutate()} disabled={!sourceFile || registrationMutation.isPending} data-testid="run-registration-btn"><Crosshair className="mr-2 size-4" />{registrationMutation.isPending ? "Solving correspondence…" : "Run registration"}</Button>
              <p className="mt-2 text-center text-[10px] text-slate-600" data-testid="registration-engine-note">Deterministic evaluation engine · no source image is stored</p>
            </Card>
          </section>

          <section className="lg:col-span-8" data-testid="registration-workspace">
            <Card className="panel-card overflow-hidden" data-testid="registration-viewport-panel">
              <div className="flex flex-col justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:flex-row sm:items-center" data-testid="registration-viewport-toolbar"><div><p className="eyebrow" data-testid="viewport-eyebrow">03 / SOLUTION VIEW</p><h2 className="mt-1 font-mono text-sm font-semibold text-slate-100" data-testid="viewport-title">Registered product preview</h2></div><div className="flex items-center gap-1 rounded border border-slate-800 bg-slate-950/60 p-1" data-testid="registration-mode-controls">{VIEW_MODES.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setViewMode(id)} className={`view-mode-btn ${viewMode === id ? "view-mode-active" : ""}`} data-testid={`registration-mode-${id}-btn`}><Icon className="size-3.5" />{label}</button>)}</div></div>
              <div className="p-4">
                <div className={`registration-viewport mode-${viewMode}`} data-testid="registration-viewport">
                  {!sourcePreview ? <div className="absolute inset-0 flex flex-col items-center justify-center text-center"><div className="mb-4 flex size-16 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-600"><Target className="size-7" /></div><p className="font-mono text-sm text-slate-400" data-testid="viewport-empty-title">Awaiting source frame</p><p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-600" data-testid="viewport-empty-help">Upload a Chandrayaan-2 optical image to resolve a LROC reference and expose match geometry.</p></div> : null}
                  {sourcePreview && viewMode === "split" ? <div className="grid h-full grid-cols-2 gap-px bg-cyan-300/20"><ViewportImage src={sourcePreview} alt="Source image" label="SOURCE / CHANDRAYAAN-2" tone="amber" dataTestId="source-viewport-image" /><ViewportImage src={selectedReference?.image_url} alt="LROC reference image" label="REFERENCE / LROC" tone="cyan" transform={transform} dataTestId="reference-viewport-image" /></div> : null}
                  {sourcePreview && viewMode !== "split" ? <div className="relative size-full overflow-hidden bg-black"><img src={selectedReference?.image_url} alt="LROC reference image" className={`absolute inset-0 size-full object-cover ${viewMode === "difference" ? "brightness-[0.7] grayscale contrast-150" : ""}`} style={{ transform }} data-testid="reference-overlay-image" /><img src={sourcePreview} alt="Source image overlay" className={`absolute inset-0 size-full object-cover mix-blend-screen ${viewMode === "blend" ? "opacity-55" : viewMode === "difference" ? "opacity-35 mix-blend-difference" : "opacity-30"}`} data-testid="source-overlay-image" />{viewMode === "vectors" ? <div className="absolute inset-0" data-testid="residual-vector-overlay">{points.slice(0, 10).map((point) => <span key={point.index} className="vector-line" style={{ left: `${(point.source_x / 1024) * 100}%`, top: `${(point.source_y / 768) * 100}%`, transform: `rotate(${(point.index % 2 ? 20 : -18)}deg)` }} />)}</div> : null}</div> : null}
                  {sourcePreview && points.slice(0, 12).map((point) => <div key={`marker-${point.index}`} className={`match-marker ${selectedPoint === point.index ? "match-marker-selected" : ""}`} style={{ left: `${(point.source_x / 1024) * 100}%`, top: `${(point.source_y / 768) * 100}%` }} data-testid={`match-point-marker-${point.index}`}><span>{point.index}</span></div>)}
                  {sourcePreview ? <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded border border-slate-700/70 bg-slate-950/80 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-wider backdrop-blur" data-testid="viewport-legend"><span className="flex items-center gap-1.5 text-amber-300"><i className="legend-dot bg-amber-300" />source</span><span className="flex items-center gap-1.5 text-cyan-300"><i className="legend-dot bg-cyan-300" />reference</span>{result ? <span className="text-emerald-300">{points.length} points</span> : <span className="text-slate-500">preview</span>}</div> : null}
                </div>
                <div className="mt-3 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-600" data-testid="viewport-footer"><span>Coordinate frame / pixel</span><span>{result ? `run ${result.id.slice(0, 8)}` : "not solved"}</span></div>
              </div>
            </Card>

            <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-5">
              <Card className="panel-card p-5 xl:col-span-2" data-testid="evaluation-metrics-panel">
                <SectionHeading eyebrow="04 / EVALUATE" title="Registration quality" detail="Evaluation metrics from the current correspondence set." testId="evaluation-heading" />
                {result ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Metric label="RMSE" value={result.metrics.rmse.toFixed(3)} unit="px" target="under 0.35 px" />
                    <Metric label="Inlier count" value={String(result.metrics.inlier_count)} unit="points" target="over 20" tone="cyan" />
                    <Metric label="Inlier ratio" value={`${(result.metrics.inlier_ratio * 100).toFixed(1)}`} unit="%" target="over 88.5%" tone="emerald" />
                    <Metric label="Subpixel accuracy" value={`±${result.metrics.subpixel_accuracy.toFixed(3)}`} unit="px" target="± 0.08 px" />
                  </div>
                ) : (
                  <div className="rounded border border-dashed border-slate-700 p-5 text-center"><Gauge className="mx-auto size-6 text-slate-600" /><p className="mt-3 font-mono text-xs text-slate-500" data-testid="metrics-empty-state">Metrics appear after a registration run.</p></div>
                )}
                <div className="mt-4 border-t border-slate-800 pt-4" data-testid="transform-summary">
                  <p className="label-mono" data-testid="transform-summary-label">Transform solution</p>
                  <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-xs">
                    <TransformReadout label="delta-x" value={result?.metrics.offset_x ?? shiftX} unit="px" />
                    <TransformReadout label="delta-y" value={result?.metrics.offset_y ?? shiftY} unit="px" />
                    <TransformReadout label="rotation" value={result?.metrics.rotation_deg ?? rotation} unit="deg" />
                  </div>
                </div>
              </Card>
              <Card className="panel-card min-w-0 p-5 xl:col-span-3" data-testid="match-points-panel">
                <div className="mb-4 flex items-start justify-between gap-3"><SectionHeading eyebrow="05 / CORRESPONDENCES" title="Match point coordinates" detail="Click a row to highlight its source coordinate." testId="match-points-heading" /><Badge variant="outline" className="shrink-0 border-slate-700 font-mono text-[10px] text-slate-400" data-testid="match-point-count-badge">{points.length || 0} / 24</Badge></div>
                {points.length ? (
                  <div className="overflow-hidden rounded border border-slate-800" data-testid="match-points-table">
                    <Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Source x / y</TableHead><TableHead>Reference x / y</TableHead><TableHead>Residual</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
                      {points.map((point) => <TableRow key={point.index} className={selectedPoint === point.index ? "cursor-pointer bg-cyan-300/10" : "cursor-pointer"} onClick={() => setSelectedPoint(point.index)} data-testid={`match-point-row-${point.index}`}><TableCell className="font-mono text-slate-500">{String(point.index).padStart(2, "0")}</TableCell><TableCell className="font-mono text-amber-200/90" data-testid={`match-point-source-coordinate-${point.index}`}>{point.source_x.toFixed(2)} / {point.source_y.toFixed(2)}</TableCell><TableCell className="font-mono text-cyan-200/90" data-testid={`match-point-reference-coordinate-${point.index}`}>{point.reference_x.toFixed(2)} / {point.reference_y.toFixed(2)}</TableCell><TableCell className="font-mono text-slate-400">{point.residual_error.toFixed(3)} px</TableCell><TableCell><span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-400" />{point.status}</span></TableCell></TableRow>)}
                    </TableBody></Table>
                  </div>
                ) : (
                  <div className="flex min-h-40 items-center justify-center rounded border border-dashed border-slate-700 text-center"><p className="font-mono text-xs text-slate-600" data-testid="match-points-empty-state">No correspondence set yet.</p></div>
                )}
              </Card>
            </div>
          </section>
        </div>

        <section className="mt-5" data-testid="lroc-catalog-drawer">
          <Card className="panel-card p-5" data-testid="catalog-metadata-drawer"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><SectionHeading eyebrow="06 / REFERENCE LIBRARY" title="LROC catalog snapshot" detail="Metadata is cached in the app database. Large binaries stay on the public LROC host." testId="catalog-heading" /><div className="flex items-center gap-2"><div className="relative"><Database className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-slate-500" /><input value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Filter products" className="h-9 w-44 rounded border border-slate-700 bg-slate-950/60 pl-9 pr-3 font-mono text-xs text-slate-200 outline-none focus:border-cyan-300/60" data-testid="catalog-search-input" /></div><span className="font-mono text-[10px] uppercase tracking-wider text-emerald-300" data-testid="catalog-connection-status"><span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-400" />{catalogQuery.isError ? "offline fallback" : "mongo snapshot"}</span></div></div><div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">{filteredCatalog.map((item) => <div key={item.id} className="catalog-card" data-testid={`catalog-card-${item.id}`}><img src={item.image_url} alt={item.title} className="h-28 w-full object-cover grayscale transition duration-300 hover:grayscale-0" /><div className="p-3"><div className="flex items-start justify-between gap-2"><p className="font-mono text-xs font-semibold leading-relaxed text-slate-200" data-testid={`catalog-title-${item.id}`}>{item.title}</p><Badge variant="outline" className="shrink-0 border-emerald-400/20 px-1.5 text-[9px] text-emerald-300">{item.status}</Badge></div><p className="mt-2 text-[11px] text-slate-500" data-testid={`catalog-location-${item.id}`}>{item.location} · {item.resolution}</p><div className="mt-3 flex items-center justify-between"><span className="font-mono text-[10px] text-slate-600">{item.product_id}</span><a href={item.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-cyan-300 hover:text-cyan-200" data-testid={`catalog-source-link-${item.id}`}>source <ExternalLink className="size-3" /></a></div></div></div>)}</div><div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-800 pt-4 text-[10px] uppercase tracking-wider text-slate-500"><span className="flex items-center gap-1.5" data-testid="catalog-source-label"><Database className="size-3.5 text-cyan-300" /> source links</span><a href="https://lroc.im-ldi.com/images/downloads/" target="_blank" rel="noreferrer" className="hover:text-slate-300" data-testid="lroc-downloads-link">LROC Downloads ↗</a><a href="https://quickmap.lroc.im-ldi.com/" target="_blank" rel="noreferrer" className="hover:text-slate-300" data-testid="lroc-quickmap-link">QuickMap ↗</a><span className="ml-auto flex items-center gap-1.5 text-amber-300/80" data-testid="catalog-fallback-note"><RefreshCw className="size-3" /> last-good snapshot retained on source outage</span></div></Card>
        </section>

        <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-slate-800/80 pt-4 text-[10px] font-mono uppercase tracking-wider text-slate-600 sm:flex-row" data-testid="mission-footer"><span>Moon Match Points / research workstation</span><span data-testid="footer-method-note">sub-pixel refinement · affine geometry · uniform point field</span></footer>
      </div>
    </main>
  );
}

function TransformReadout({ label, value, unit }: { label: string; value: number; unit: string }) {
  return <div className="rounded border border-slate-800 bg-slate-950/50 p-2" data-testid={`transform-${label}-value`}><span className="block text-slate-600">{label}</span><strong className="mt-1 block text-slate-300">{value.toFixed(2)} {unit}</strong></div>;
}

function Control({ label, value, min, max, step, unit, onChange, testId }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (value: number) => void; testId: string }) {
  return <label className="block" data-testid={testId}><div className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider"><span className="text-slate-400">{label}</span><span className="text-amber-300" data-testid={`${testId}-value`}>{value.toFixed(step < 0.01 ? 3 : 2)} {unit}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="range-amber w-full" data-testid={`${testId}-input`} aria-label={label} /></label>;
}

function ViewportImage({ src, alt, label, tone, transform: imageTransform, dataTestId }: { src?: string; alt: string; label: string; tone: "amber" | "cyan"; transform?: string; dataTestId: string }) {
  return <div className="relative min-w-0 overflow-hidden bg-black" data-testid={`${dataTestId}-panel`}><img src={src} alt={alt} className="size-full object-cover opacity-80 grayscale" style={{ transform: imageTransform }} data-testid={dataTestId} /><div className={`absolute left-2 top-2 rounded border px-2 py-1 font-mono text-[9px] tracking-wider backdrop-blur ${tone === "amber" ? "border-amber-300/30 bg-amber-300/10 text-amber-200" : "border-cyan-300/30 bg-cyan-300/10 text-cyan-200"}`} data-testid={`${dataTestId}-label`}>{label}</div></div>;
}