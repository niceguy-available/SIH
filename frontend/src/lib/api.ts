// Typed fetch layer over the FastAPI backend. Base is the relative "/api" prefix so the
// same code works in dev (Vite proxies /api → :8001) and behind a single origin in prod.
const BASE = "/api";

// Fields are declared, not constructor parameter properties: tsconfig sets
// erasableSyntaxOnly, which rejects `constructor(readonly status: number)`.
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`request failed with ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type JsonBody = unknown;

async function request<T>(method: string, path: string, body?: JsonBody): Promise<T> {
  // Auth rides the httpOnly session cookie automatically — never add auth headers here.
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // FastAPI reports request-validation failures as 422 with a {detail: [...]} body.
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new ApiError(res.status, errBody);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// The response type is yours to declare: nothing infers across the Python boundary, so a
// TS interface here mirrors the endpoint's Pydantic model by hand — keep the two in sync.
export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: JsonBody) => request<T>("POST", path, body ?? null);
export const apiPostForm = async <T>(path: string, body: FormData): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, { method: "POST", body });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new ApiError(res.status, errBody);
  }
  return (await res.json()) as T;
};
export const apiPut = <T>(path: string, body?: JsonBody) => request<T>("PUT", path, body ?? null);
export const apiPatch = <T>(path: string, body?: JsonBody) =>
  request<T>("PATCH", path, body ?? null);
export const apiDelete = <T>(path: string) => request<T>("DELETE", path);

export interface CatalogItem {
  id: string;
  product_id: string;
  title: string;
  product_type: string;
  source: string;
  status: string;
  source_url: string;
  download_url: string | null;
  image_url: string;
  location: string;
  resolution: string;
  observed_at: string;
  footprint: Footprint;
}

export interface FootprintBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface Footprint {
  id: string;
  source_url: string;
  center_latitude: number;
  center_longitude: number;
  bounds: FootprintBounds;
  resolution_m_per_pixel: number | null;
  crs: string;
  review_status: string;
  reviewed_at: string;
  review_note: string;
}

export interface MatchPoint {
  index: number;
  source_x: number;
  source_y: number;
  reference_x: number;
  reference_y: number;
  residual_error: number;
  descriptor_similarity: number;
  status: string;
}

export interface RegistrationMetrics {
  rmse: number;
  inlier_count: number;
  total_matches: number;
  inlier_ratio: number;
  subpixel_accuracy: number;
  offset_x: number;
  offset_y: number;
  rotation_deg: number;
  scale_ratio: number;
  image_similarity: number;
  feature_matches: number;
}

export interface RegistrationResult {
  id: string;
  source_filename: string;
  reference: CatalogItem;
  method: string;
  product_status: string;
  registered_product_label: string;
  selection_reason: string;
  affine_matrix: number[][];
  preview_url: string;
  geotiff_url: string;
  report_url: string;
  generated_at: string;
  metrics: RegistrationMetrics;
  match_points: MatchPoint[];
}
