/**
 * pdf-to-dxf — Core conversion engine
 * Part of the ek-mc civil toolset
 *
 * Strategy:
 *  1. Parse each PDF page with pdfjs-dist to extract vector paths and text.
 *  2. Translate each element into DXF entities using @tarikjabiri/dxf DxfWriter.
 *  3. Return the DXF string (or write to file in CLI mode).
 *
 * Notes on pdfjs v4:
 *  pdfjs v4 batches all path sub-operations (moveTo, lineTo, curveTo, rectangle,
 *  closePath) into a single `constructPath` operator. The first argument is an
 *  array of sub-op codes, and the second argument is a flat array of coordinates.
 *
 * Coordinate mapping:
 *  PDF uses bottom-left origin; DXF (AutoCAD) also uses bottom-left — no flip needed.
 *  PDF units are points (1 pt = 1/72 inch). Preserved as-is; scale via the `scale` option.
 */

import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { DxfWriter, Colors, point3d } from '@tarikjabiri/dxf';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure the pdfjs worker for browser environments.
// The worker is bundled locally and served by the app (no CDN dependency).
// In Node (CLI), the worker is set separately in src/cli/index.ts.
if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export interface ConvertOptions {
  /** Pages to convert, 1-indexed. Defaults to all pages. */
  pages?: number[];
  /** Uniform scale factor applied to all coordinates. Default: 1. */
  scale?: number;
  /** Layer name prefix for each page. Default: "PAGE". */
  layerPrefix?: string;
  /** Include text entities. Default: true. */
  includeText?: boolean;
  /** Include vector paths. Default: true. */
  includePaths?: boolean;
}

export interface ConvertResult {
  dxf: string;
  pageCount: number;
  warnings: string[];
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Vec3 = { x: number; y: number; z: number };

function pt(x: number, y: number): Vec3 {
  return point3d(x, y, 0);
}

// ─── Path sub-op codes used by pdfjs constructPath ──────────────────────────
// These are the raw PDF operator codes embedded inside the constructPath batch.
const PATH_OPS = {
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
} as const;

// ─── Adaptive Bézier Subdivision ─────────────────────────────────────────────
//
// Replaces the old fixed-step approximation with a recursive De Casteljau
// subdivision approach. The curve is split until the maximum distance from
// the chord (chordal deviation) is below `tolerance`. This produces smooth
// output for large curves and minimal segments for near-straight ones.
//
// tolerance: maximum allowed deviation in DXF units (default: 0.5 pt ≈ 0.18mm)
// maxDepth:  recursion guard to prevent stack overflow on degenerate curves

const BEZIER_TOLERANCE = 0.5;
const BEZIER_MAX_DEPTH = 12;

function bezierPoint(
  p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number
): Vec3 {
  const u = 1 - t;
  return pt(
    u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  );
}

function chordalDeviation(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): number {
  // Maximum distance of the two inner control points from the chord p0→p3.
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    // Degenerate chord: use distance from p0
    const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const d2 = Math.hypot(p2.x - p0.x, p2.y - p0.y);
    return Math.max(d1, d2);
  }
  const cross1 = Math.abs(dx * (p0.y - p1.y) - dy * (p0.x - p1.x)) / Math.sqrt(lenSq);
  const cross2 = Math.abs(dx * (p0.y - p2.y) - dy * (p0.x - p2.x)) / Math.sqrt(lenSq);
  return Math.max(cross1, cross2);
}

/**
 * Adaptively subdivide a cubic Bézier curve and emit LINE entities.
 * Produces far fewer segments for straight/near-straight sections and
 * more segments only where the curve actually bends.
 */
export function approximateBezierAdaptive(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  writer: DxfWriter,
  tolerance = BEZIER_TOLERANCE,
  depth = 0,
): void {
  if (depth >= BEZIER_MAX_DEPTH || chordalDeviation(p0, p1, p2, p3) <= tolerance) {
    // Flat enough — emit a single line segment
    writer.addLine(p0, p3);
    return;
  }

  // De Casteljau split at t=0.5
  const m01 = pt((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
  const m12 = pt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
  const m23 = pt((p2.x + p3.x) / 2, (p2.y + p3.y) / 2);
  const m012 = pt((m01.x + m12.x) / 2, (m01.y + m12.y) / 2);
  const m123 = pt((m12.x + m23.x) / 2, (m12.y + m23.y) / 2);
  const mid = pt((m012.x + m123.x) / 2, (m012.y + m123.y) / 2);

  approximateBezierAdaptive(p0, m01, m012, mid, writer, tolerance, depth + 1);
  approximateBezierAdaptive(mid, m123, m23, p3, writer, tolerance, depth + 1);
}

// ─── Circle / Arc fitting ─────────────────────────────────────────────────────
//
// A PDF circle is encoded as 4 cubic Bézier curves (one per quadrant).
// Each quadrant uses the standard kappa approximation factor ≈ 0.5523.
// We detect this pattern in a closed sub-path and, when confirmed, emit a
// true DXF CIRCLE entity instead of 32+ line segments.
//
// Detection strategy:
//  1. Collect all Bézier control points for a closed sub-path.
//  2. If there are exactly 4 curveTo ops, attempt a least-squares circle fit
//     on the 4 anchor points (start of each curve).
//  3. Accept the fit if the residual is below CIRCLE_FIT_TOLERANCE.

const CIRCLE_FIT_TOLERANCE = 0.5; // max deviation of anchor points from fitted circle

interface SubPath {
  ops: Array<{ type: 'line'; to: Vec3 } | { type: 'curve'; p1: Vec3; p2: Vec3; p3: Vec3 }>;
  start: Vec3;
  closed: boolean;
}

/**
 * Fit a circle through 3+ points using the algebraic least-squares method.
 * Returns { cx, cy, r } or null if the points are collinear / too few.
 */
function fitCircle(points: Vec3[]): { cx: number; cy: number; r: number } | null {
  if (points.length < 3) return null;

  // Build the linear system: (x-cx)^2 + (y-cy)^2 = r^2
  // Rearranged: 2*cx*x + 2*cy*y + (r^2 - cx^2 - cy^2) = x^2 + y^2
  // Let c = r^2 - cx^2 - cy^2 → solve [2x, 2y, 1] * [cx, cy, c]^T = x^2+y^2
  let sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0;
  let sumXY = 0, sumX3 = 0, sumY3 = 0, sumXY2 = 0, sumX2Y = 0;
  const n = points.length;

  for (const p of points) {
    const x = p.x, y = p.y;
    sumX += x; sumY += y;
    sumX2 += x * x; sumY2 += y * y;
    sumXY += x * y;
    sumX3 += x * x * x; sumY3 += y * y * y;
    sumXY2 += x * y * y; sumX2Y += x * x * y;
  }

  const A = 2 * (sumX2 - sumX * sumX / n);
  const B = 2 * (sumXY - sumX * sumY / n);
  const C = 2 * (sumY2 - sumY * sumY / n);
  const D = sumX3 + sumXY2 - (sumX2 + sumY2) * sumX / n;
  const E = sumX2Y + sumY3 - (sumX2 + sumY2) * sumY / n;

  const det = A * C - B * B;
  if (Math.abs(det) < 1e-10) return null; // collinear

  const cx = (D * C - B * E) / det;
  const cy = (A * E - B * D) / det;
  const r = Math.sqrt((sumX2 + sumY2 - 2 * cx * sumX - 2 * cy * sumY) / n + cx * cx + cy * cy);

  if (!isFinite(r) || r <= 0) return null;
  return { cx, cy, r };
}

/**
 * Check if a closed sub-path with exactly 4 curveTo ops is a circle.
 * Returns { cx, cy, r } if it is, or null otherwise.
 */
function tryFitCircleFromSubPath(
  sub: SubPath,
): { cx: number; cy: number; r: number } | null {
  if (!sub.closed) return null;

  const curves = sub.ops.filter((o) => o.type === 'curve');
  if (curves.length !== 4) return null;

  // Anchor points: start of sub-path + p3 of each curve
  const anchors: Vec3[] = [sub.start];
  for (const op of sub.ops) {
    if (op.type === 'curve') anchors.push(op.p3);
  }
  // anchors[4] === anchors[0] (closed), so use first 4
  const pts = anchors.slice(0, 4);

  const fit = fitCircle(pts);
  if (!fit) return null;

  // Validate: all anchor points must be within tolerance of the fitted circle
  for (const p of pts) {
    const dist = Math.abs(Math.hypot(p.x - fit.cx, p.y - fit.cy) - fit.r);
    if (dist > CIRCLE_FIT_TOLERANCE) return null;
  }

  return fit;
}

// ─── Sub-path collector ───────────────────────────────────────────────────────
//
// We first collect sub-paths from the constructPath batch, then decide per
// sub-path whether to emit a CIRCLE entity or fall back to line/curve output.

function collectSubPaths(
  subOps: number[],
  coords: number[],
  scale: number,
): SubPath[] {
  const paths: SubPath[] = [];
  let current: SubPath | null = null;
  let ci = 0;
  const s = (v: number) => v * scale;

  for (const op of subOps) {
    switch (op) {
      case PATH_OPS.moveTo: {
        const p = pt(s(coords[ci]), s(coords[ci + 1]));
        ci += 2;
        current = { ops: [], start: p, closed: false };
        paths.push(current);
        break;
      }

      case PATH_OPS.lineTo: {
        const to = pt(s(coords[ci]), s(coords[ci + 1]));
        ci += 2;
        if (current) current.ops.push({ type: 'line', to });
        break;
      }

      case PATH_OPS.curveTo: {
        const p1 = pt(s(coords[ci]), s(coords[ci + 1]));
        const p2 = pt(s(coords[ci + 2]), s(coords[ci + 3]));
        const p3 = pt(s(coords[ci + 4]), s(coords[ci + 5]));
        ci += 6;
        if (current) current.ops.push({ type: 'curve', p1, p2, p3 });
        break;
      }

      case PATH_OPS.curveTo2: {
        // p1 = current position (handled at emit time — store as curveTo with p1=p3 sentinel)
        const p2 = pt(s(coords[ci]), s(coords[ci + 1]));
        const p3 = pt(s(coords[ci + 2]), s(coords[ci + 3]));
        ci += 4;
        if (current) {
          // We store a sentinel: p1 will be resolved to the previous position at emit time.
          // For circle detection we only need p3, so this is fine.
          current.ops.push({ type: 'curve', p1: p3, p2, p3 }); // p1 sentinel = p3 (resolved at emit)
        }
        break;
      }

      case PATH_OPS.curveTo3: {
        const p1 = pt(s(coords[ci]), s(coords[ci + 1]));
        const p3 = pt(s(coords[ci + 2]), s(coords[ci + 3]));
        ci += 4;
        if (current) current.ops.push({ type: 'curve', p1, p2: p3, p3 });
        break;
      }

      case PATH_OPS.closePath: {
        if (current) current.closed = true;
        break;
      }

      case PATH_OPS.rectangle: {
        const rx = s(coords[ci]);
        const ry = s(coords[ci + 1]);
        const rw = s(coords[ci + 2]);
        const rh = s(coords[ci + 3]);
        ci += 4;
        const bl = pt(rx, ry);
        const br = pt(rx + rw, ry);
        const tr = pt(rx + rw, ry + rh);
        const tl = pt(rx, ry + rh);
        const rectPath: SubPath = {
          start: bl,
          ops: [
            { type: 'line', to: br },
            { type: 'line', to: tr },
            { type: 'line', to: tl },
            { type: 'line', to: bl },
          ],
          closed: true,
        };
        paths.push(rectPath);
        current = rectPath;
        break;
      }

      default:
        break;
    }
  }

  return paths;
}

// ─── Sub-path emitter ─────────────────────────────────────────────────────────

function emitSubPath(sub: SubPath, writer: DxfWriter): void {
  // Attempt circle detection first
  const circle = tryFitCircleFromSubPath(sub);
  if (circle) {
    writer.addCircle(pt(circle.cx, circle.cy), circle.r);
    return;
  }

  // Fall back to adaptive line/curve emission
  let pos = sub.start;

  for (const op of sub.ops) {
    if (op.type === 'line') {
      writer.addLine(pos, op.to);
      pos = op.to;
    } else {
      // curveTo2 sentinel: p1 was stored as p3, resolve to actual current pos
      const p1 = op.p1 === op.p3 ? pos : op.p1;
      approximateBezierAdaptive(pos, p1, op.p2, op.p3, writer);
      pos = op.p3;
    }
  }

  if (sub.closed && (pos.x !== sub.start.x || pos.y !== sub.start.y)) {
    writer.addLine(pos, sub.start);
  }
}

// ─── Process a constructPath batch ──────────────────────────────────────────

export function processConstructPath(
  subOps: number[],
  coords: number[],
  writer: DxfWriter,
  scale: number
): void {
  const paths = collectSubPaths(subOps, coords, scale);
  for (const sub of paths) {
    emitSubPath(sub, writer);
  }
}

// ─── Page processor ─────────────────────────────────────────────────────────

async function processPage(
  page: PDFPageProxy,
  writer: DxfWriter,
  pageIndex: number,
  opts: Required<ConvertOptions>,
  warnings: string[]
): Promise<void> {
  const layerName = `${opts.layerPrefix}_${pageIndex + 1}`;
  writer.addLayer(layerName, Colors.White, 'CONTINUOUS');
  writer.setCurrentLayerName(layerName);

  // ── Vector paths ─────────────────────────────────────────────────────────
  if (opts.includePaths) {
    try {
      const opList = await page.getOperatorList();
      const fnArray = opList.fnArray;
      const argsArray = opList.argsArray;

      for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];

        // pdfjs v4: all path sub-ops are batched into constructPath
        if (fn === pdfjs.OPS.constructPath) {
          const [subOps, coords] = argsArray[i] as [number[], number[]];
          processConstructPath(subOps, coords, writer, opts.scale);
        }
      }
    } catch (err) {
      warnings.push(`Page ${pageIndex + 1}: path extraction failed — ${String(err)}`);
    }
  }

  // ── Text items ───────────────────────────────────────────────────────────
  if (opts.includeText) {
    try {
      const textContent = await page.getTextContent();
      for (const item of textContent.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const tx = item.transform[4];
        const ty = item.transform[5];
        const fontSize = Math.abs(item.transform[3]) || 12;
        const pos = pt(tx * opts.scale, ty * opts.scale);
        writer.addText(pos, fontSize * opts.scale, item.str);
      }
    } catch (err) {
      warnings.push(`Page ${pageIndex + 1}: text extraction failed — ${String(err)}`);
    }
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Convert a PDF (supplied as an ArrayBuffer or Uint8Array) to a DXF string.
 * Runs entirely locally — no network requests are made.
 */
export async function convertPdfToDxf(
  data: ArrayBuffer | Uint8Array,
  options: ConvertOptions = {}
): Promise<ConvertResult> {
  const opts: Required<ConvertOptions> = {
    pages: options.pages ?? [],
    scale: options.scale ?? 1,
    layerPrefix: options.layerPrefix ?? 'PAGE',
    includeText: options.includeText ?? true,
    includePaths: options.includePaths ?? true,
  };

  const warnings: string[] = [];

  const loadingTask = pdfjs.getDocument({
    data: data instanceof ArrayBuffer ? new Uint8Array(data) : data,
  });
  const pdf: PDFDocumentProxy = await loadingTask.promise;
  const totalPages = pdf.numPages;

  const pagesToProcess =
    opts.pages.length > 0
      ? opts.pages.filter((p) => p >= 1 && p <= totalPages)
      : Array.from({ length: totalPages }, (_, i) => i + 1);

  if (pagesToProcess.length === 0) {
    warnings.push('No valid pages to process.');
  }

  const writer = new DxfWriter();

  for (const pageNum of pagesToProcess) {
    const page = await pdf.getPage(pageNum);
    await processPage(page, writer, pageNum - 1, opts, warnings);
    page.cleanup();
  }

  return {
    dxf: writer.stringify(),
    pageCount: pagesToProcess.length,
    warnings,
  };
}
