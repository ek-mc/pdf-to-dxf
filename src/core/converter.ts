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

// ─── Process a constructPath batch ──────────────────────────────────────────

function processConstructPath(
  subOps: number[],
  coords: number[],
  writer: DxfWriter,
  scale: number
): void {
  let ci = 0; // coordinate index
  let pathStart: Vec3 | null = null;
  let currentPos: Vec3 | null = null;

  const s = (v: number) => v * scale;

  for (const op of subOps) {
    switch (op) {
      case PATH_OPS.moveTo: {
        const p = pt(s(coords[ci]), s(coords[ci + 1]));
        ci += 2;
        pathStart = p;
        currentPos = p;
        break;
      }

      case PATH_OPS.lineTo: {
        if (currentPos) {
          const to = pt(s(coords[ci]), s(coords[ci + 1]));
          ci += 2;
          writer.addLine(currentPos, to);
          currentPos = to;
        } else {
          ci += 2;
        }
        break;
      }

      case PATH_OPS.curveTo: {
        // 6 coords: p1x p1y p2x p2y p3x p3y
        if (!currentPos) { ci += 6; break; }
        const p1 = pt(s(coords[ci]), s(coords[ci + 1]));
        const p2 = pt(s(coords[ci + 2]), s(coords[ci + 3]));
        const p3 = pt(s(coords[ci + 4]), s(coords[ci + 5]));
        ci += 6;
        approximateBezier(currentPos, p1, p2, p3, writer);
        currentPos = p3;
        break;
      }

      case PATH_OPS.curveTo2: {
        // 4 coords: p2x p2y p3x p3y (current replaces p1)
        if (!currentPos) { ci += 4; break; }
        const p1 = currentPos;
        const p2 = pt(s(coords[ci]), s(coords[ci + 1]));
        const p3 = pt(s(coords[ci + 2]), s(coords[ci + 3]));
        ci += 4;
        approximateBezier(currentPos, p1, p2, p3, writer);
        currentPos = p3;
        break;
      }

      case PATH_OPS.curveTo3: {
        // 4 coords: p1x p1y p3x p3y (p3 replaces p2)
        if (!currentPos) { ci += 4; break; }
        const p1 = pt(s(coords[ci]), s(coords[ci + 1]));
        const p3 = pt(s(coords[ci + 2]), s(coords[ci + 3]));
        ci += 4;
        approximateBezier(currentPos, p1, p3, p3, writer);
        currentPos = p3;
        break;
      }

      case PATH_OPS.closePath: {
        if (currentPos && pathStart) {
          if (currentPos.x !== pathStart.x || currentPos.y !== pathStart.y) {
            writer.addLine(currentPos, pathStart);
          }
        }
        currentPos = pathStart;
        break;
      }

      case PATH_OPS.rectangle: {
        // 4 coords: x y w h
        const rx = s(coords[ci]);
        const ry = s(coords[ci + 1]);
        const rw = s(coords[ci + 2]);
        const rh = s(coords[ci + 3]);
        ci += 4;
        const bl = pt(rx, ry);
        const br = pt(rx + rw, ry);
        const tr = pt(rx + rw, ry + rh);
        const tl = pt(rx, ry + rh);
        writer.addLine(bl, br);
        writer.addLine(br, tr);
        writer.addLine(tr, tl);
        writer.addLine(tl, bl);
        // rectangle also sets the current path
        pathStart = bl;
        currentPos = bl;
        break;
      }

      default:
        break;
    }
  }
}

function approximateBezier(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  writer: DxfWriter,
  steps = 8
): void {
  let prev = p0;
  for (let t = 1; t <= steps; t++) {
    const u = t / steps;
    const v = 1 - u;
    const bx =
      v * v * v * p0.x +
      3 * v * v * u * p1.x +
      3 * v * u * u * p2.x +
      u * u * u * p3.x;
    const by =
      v * v * v * p0.y +
      3 * v * v * u * p1.y +
      3 * v * u * u * p2.y +
      u * u * u * p3.y;
    const next = pt(bx, by);
    writer.addLine(prev, next);
    prev = next;
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
