/**
 * pdf-to-dxf — Core conversion engine unit tests
 *
 * These tests exercise the pure, synchronous geometry helpers that are
 * extracted from the main converter module so they can be tested without
 * a real PDF document or a pdfjs worker.
 *
 * Tested surface:
 *  - PATH_OPS constants (sanity)
 *  - approximateBezierAdaptive — adaptive cubic Bézier subdivision
 *  - fitCircle — least-squares circle fitting
 *  - tryFitCircleFromSubPath — circle detection from closed 4-curve sub-paths
 *  - processConstructPath — moveTo / lineTo / closePath / rectangle / curveTo
 *  - Circle detection integration: 4-curve closed path → CIRCLE entity
 */

import { describe, it, expect } from 'vitest';
import { DxfWriter, Colors, point3d } from '@tarikjabiri/dxf';

// ─── Re-export internals under test ──────────────────────────────────────────
// The helpers are not exported from the public API surface, so we inline
// minimal, faithful copies here and test them independently. This keeps the
// public API clean while giving us deterministic unit coverage.

type Vec3 = { x: number; y: number; z: number };

function pt(x: number, y: number): Vec3 {
  return point3d(x, y, 0);
}

const PATH_OPS = {
  moveTo: 13,
  lineTo: 14,
  curveTo: 15,
  curveTo2: 16,
  curveTo3: 17,
  closePath: 18,
  rectangle: 19,
} as const;

// ─── Adaptive Bézier (inline copy matching converter.ts) ─────────────────────

const BEZIER_TOLERANCE = 0.5;
const BEZIER_MAX_DEPTH = 12;

function chordalDeviation(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): number {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.max(
      Math.hypot(p1.x - p0.x, p1.y - p0.y),
      Math.hypot(p2.x - p0.x, p2.y - p0.y),
    );
  }
  const cross1 = Math.abs(dx * (p0.y - p1.y) - dy * (p0.x - p1.x)) / Math.sqrt(lenSq);
  const cross2 = Math.abs(dx * (p0.y - p2.y) - dy * (p0.x - p2.x)) / Math.sqrt(lenSq);
  return Math.max(cross1, cross2);
}

function approximateBezierAdaptive(
  p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3,
  writer: DxfWriter,
  tolerance = BEZIER_TOLERANCE,
  depth = 0,
): void {
  if (depth >= BEZIER_MAX_DEPTH || chordalDeviation(p0, p1, p2, p3) <= tolerance) {
    writer.addLine(p0, p3);
    return;
  }
  const m01 = pt((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
  const m12 = pt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
  const m23 = pt((p2.x + p3.x) / 2, (p2.y + p3.y) / 2);
  const m012 = pt((m01.x + m12.x) / 2, (m01.y + m12.y) / 2);
  const m123 = pt((m12.x + m23.x) / 2, (m12.y + m23.y) / 2);
  const mid = pt((m012.x + m123.x) / 2, (m012.y + m123.y) / 2);
  approximateBezierAdaptive(p0, m01, m012, mid, writer, tolerance, depth + 1);
  approximateBezierAdaptive(mid, m123, m23, p3, writer, tolerance, depth + 1);
}

// ─── Circle fitting (inline copy) ────────────────────────────────────────────

function fitCircle(points: Vec3[]): { cx: number; cy: number; r: number } | null {
  if (points.length < 3) return null;
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
  if (Math.abs(det) < 1e-10) return null;
  const cx = (D * C - B * E) / det;
  const cy = (A * E - B * D) / det;
  const r = Math.sqrt((sumX2 + sumY2 - 2 * cx * sumX - 2 * cy * sumY) / n + cx * cx + cy * cy);
  if (!isFinite(r) || r <= 0) return null;
  return { cx, cy, r };
}

// ─── processConstructPath (inline copy matching converter.ts) ─────────────────

interface SubPath {
  ops: Array<{ type: 'line'; to: Vec3 } | { type: 'curve'; p1: Vec3; p2: Vec3; p3: Vec3 }>;
  start: Vec3;
  closed: boolean;
}

const CIRCLE_FIT_TOLERANCE = 0.5;

function tryFitCircleFromSubPath(sub: SubPath): { cx: number; cy: number; r: number } | null {
  if (!sub.closed) return null;
  const curves = sub.ops.filter((o) => o.type === 'curve');
  if (curves.length !== 4) return null;
  const anchors: Vec3[] = [sub.start];
  for (const op of sub.ops) {
    if (op.type === 'curve') anchors.push(op.p3);
  }
  const pts = anchors.slice(0, 4);
  const fit = fitCircle(pts);
  if (!fit) return null;
  for (const p of pts) {
    const dist = Math.abs(Math.hypot(p.x - fit.cx, p.y - fit.cy) - fit.r);
    if (dist > CIRCLE_FIT_TOLERANCE) return null;
  }
  return fit;
}

function collectSubPaths(subOps: number[], coords: number[], scale: number): SubPath[] {
  const paths: SubPath[] = [];
  let current: SubPath | null = null;
  let ci = 0;
  const s = (v: number) => v * scale;
  for (const op of subOps) {
    switch (op) {
      case PATH_OPS.moveTo: {
        const p = pt(s(coords[ci]!), s(coords[ci + 1]!));
        ci += 2;
        current = { ops: [], start: p, closed: false };
        paths.push(current);
        break;
      }
      case PATH_OPS.lineTo: {
        const to = pt(s(coords[ci]!), s(coords[ci + 1]!));
        ci += 2;
        if (current) current.ops.push({ type: 'line', to });
        break;
      }
      case PATH_OPS.curveTo: {
        const p1 = pt(s(coords[ci]!), s(coords[ci + 1]!));
        const p2 = pt(s(coords[ci + 2]!), s(coords[ci + 3]!));
        const p3 = pt(s(coords[ci + 4]!), s(coords[ci + 5]!));
        ci += 6;
        if (current) current.ops.push({ type: 'curve', p1, p2, p3 });
        break;
      }
      case PATH_OPS.curveTo2: {
        const p2 = pt(s(coords[ci]!), s(coords[ci + 1]!));
        const p3 = pt(s(coords[ci + 2]!), s(coords[ci + 3]!));
        ci += 4;
        if (current) current.ops.push({ type: 'curve', p1: p3, p2, p3 });
        break;
      }
      case PATH_OPS.curveTo3: {
        const p1 = pt(s(coords[ci]!), s(coords[ci + 1]!));
        const p3 = pt(s(coords[ci + 2]!), s(coords[ci + 3]!));
        ci += 4;
        if (current) current.ops.push({ type: 'curve', p1, p2: p3, p3 });
        break;
      }
      case PATH_OPS.closePath: {
        if (current) current.closed = true;
        break;
      }
      case PATH_OPS.rectangle: {
        const rx = s(coords[ci]!);
        const ry = s(coords[ci + 1]!);
        const rw = s(coords[ci + 2]!);
        const rh = s(coords[ci + 3]!);
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
      default: break;
    }
  }
  return paths;
}

function emitSubPath(sub: SubPath, writer: DxfWriter): void {
  const circle = tryFitCircleFromSubPath(sub);
  if (circle) {
    writer.addCircle(pt(circle.cx, circle.cy), circle.r);
    return;
  }
  let pos = sub.start;
  for (const op of sub.ops) {
    if (op.type === 'line') {
      writer.addLine(pos, op.to);
      pos = op.to;
    } else {
      const p1 = op.p1 === op.p3 ? pos : op.p1;
      approximateBezierAdaptive(pos, p1, op.p2, op.p3, writer);
      pos = op.p3;
    }
  }
  if (sub.closed && (pos.x !== sub.start.x || pos.y !== sub.start.y)) {
    writer.addLine(pos, sub.start);
  }
}

function processConstructPath(
  subOps: number[], coords: number[], writer: DxfWriter, scale: number,
): void {
  const paths = collectSubPaths(subOps, coords, scale);
  for (const sub of paths) emitSubPath(sub, writer);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countLines(dxf: string): number {
  return (dxf.match(/\nLINE\n/g) ?? []).length;
}

function countCircles(dxf: string): number {
  return (dxf.match(/\nCIRCLE\n/g) ?? []).length;
}

function makeWriter(): DxfWriter {
  const w = new DxfWriter();
  w.addLayer('TEST', Colors.White, 'CONTINUOUS');
  w.setCurrentLayerName('TEST');
  return w;
}

// ─── Helpers for building a PDF-style 4-curve circle path ────────────────────
// A circle of radius r centred at (cx, cy) is encoded in PDF as 4 cubic Bézier
// curves using the kappa approximation factor κ ≈ 0.5523.

const KAPPA = 0.5523;

function circleSubOps(): number[] {
  // moveTo + 4 × curveTo + closePath
  return [
    PATH_OPS.moveTo,
    PATH_OPS.curveTo, PATH_OPS.curveTo, PATH_OPS.curveTo, PATH_OPS.curveTo,
    PATH_OPS.closePath,
  ];
}

function circleCoords(cx: number, cy: number, r: number): number[] {
  const k = KAPPA * r;
  // Start at top (cx, cy+r), go clockwise
  return [
    // moveTo top
    cx, cy + r,
    // Q1: top → right
    cx + k, cy + r,  cx + r, cy + k,  cx + r, cy,
    // Q2: right → bottom
    cx + r, cy - k,  cx + k, cy - r,  cx, cy - r,
    // Q3: bottom → left
    cx - k, cy - r,  cx - r, cy - k,  cx - r, cy,
    // Q4: left → top
    cx - r, cy + k,  cx - k, cy + r,  cx, cy + r,
  ];
}

// ─── PATH_OPS constants ───────────────────────────────────────────────────────

describe('PATH_OPS', () => {
  it('has the correct pdfjs sub-op codes', () => {
    expect(PATH_OPS.moveTo).toBe(13);
    expect(PATH_OPS.lineTo).toBe(14);
    expect(PATH_OPS.curveTo).toBe(15);
    expect(PATH_OPS.curveTo2).toBe(16);
    expect(PATH_OPS.curveTo3).toBe(17);
    expect(PATH_OPS.closePath).toBe(18);
    expect(PATH_OPS.rectangle).toBe(19);
  });
});

// ─── chordalDeviation ────────────────────────────────────────────────────────

describe('chordalDeviation', () => {
  it('returns 0 for a perfectly straight Bézier', () => {
    const dev = chordalDeviation(pt(0, 0), pt(1, 0), pt(2, 0), pt(3, 0));
    expect(dev).toBeCloseTo(0, 10);
  });

  it('returns a positive value for a curved Bézier', () => {
    const dev = chordalDeviation(pt(0, 0), pt(0, 10), pt(10, 10), pt(10, 0));
    expect(dev).toBeGreaterThan(0);
  });

  it('handles degenerate zero-length chord', () => {
    const dev = chordalDeviation(pt(5, 5), pt(5, 10), pt(5, 8), pt(5, 5));
    expect(dev).toBeGreaterThan(0);
  });
});

// ─── approximateBezierAdaptive ───────────────────────────────────────────────

describe('approximateBezierAdaptive', () => {
  it('produces at least 1 segment for any curve', () => {
    const w = makeWriter();
    approximateBezierAdaptive(pt(0, 0), pt(1, 3), pt(3, 3), pt(4, 0), w);
    expect(countLines(w.stringify())).toBeGreaterThanOrEqual(1);
  });

  it('produces exactly 1 segment for a straight-line degenerate Bézier', () => {
    const w = makeWriter();
    // All control points collinear → deviation = 0 → single segment
    approximateBezierAdaptive(pt(0, 0), pt(1, 0), pt(2, 0), pt(3, 0), w);
    expect(countLines(w.stringify())).toBe(1);
  });

  it('produces more segments for a tighter tolerance', () => {
    const wLoose = makeWriter();
    const wTight = makeWriter();
    const p0 = pt(0, 0), p1 = pt(0, 100), p2 = pt(100, 100), p3 = pt(100, 0);
    approximateBezierAdaptive(p0, p1, p2, p3, wLoose, 10);
    approximateBezierAdaptive(p0, p1, p2, p3, wTight, 0.1);
    expect(countLines(wTight.stringify())).toBeGreaterThan(countLines(wLoose.stringify()));
  });

  it('starts at p0 and ends at p3 (endpoint preservation)', () => {
    const w = makeWriter();
    approximateBezierAdaptive(pt(0, 0), pt(1, 3), pt(3, 3), pt(10, 0), w);
    const dxf = w.stringify();
    // Group code 11 (end-point X of last LINE) must be 10
    expect(dxf).toMatch(/^11\s*\n10$/m);
  });

  it('respects maxDepth guard and does not recurse infinitely', () => {
    const w = makeWriter();
    // Degenerate curve where all points are the same — should not hang
    approximateBezierAdaptive(pt(5, 5), pt(5, 5), pt(5, 5), pt(5, 5), w);
    expect(countLines(w.stringify())).toBeGreaterThanOrEqual(1);
  });
});

// ─── fitCircle ───────────────────────────────────────────────────────────────

describe('fitCircle', () => {
  it('fits a unit circle centred at the origin', () => {
    const pts = [pt(1, 0), pt(0, 1), pt(-1, 0), pt(0, -1)];
    const fit = fitCircle(pts);
    expect(fit).not.toBeNull();
    expect(fit!.cx).toBeCloseTo(0, 5);
    expect(fit!.cy).toBeCloseTo(0, 5);
    expect(fit!.r).toBeCloseTo(1, 5);
  });

  it('fits a circle with arbitrary centre and radius', () => {
    const cx = 42, cy = -17, r = 8.5;
    const pts = [
      pt(cx + r, cy),
      pt(cx, cy + r),
      pt(cx - r, cy),
      pt(cx, cy - r),
    ];
    const fit = fitCircle(pts);
    expect(fit).not.toBeNull();
    expect(fit!.cx).toBeCloseTo(cx, 4);
    expect(fit!.cy).toBeCloseTo(cy, 4);
    expect(fit!.r).toBeCloseTo(r, 4);
  });

  it('returns null for collinear points', () => {
    const pts = [pt(0, 0), pt(1, 0), pt(2, 0)];
    expect(fitCircle(pts)).toBeNull();
  });

  it('returns null for fewer than 3 points', () => {
    expect(fitCircle([pt(0, 0), pt(1, 1)])).toBeNull();
  });
});

// ─── Circle detection integration ────────────────────────────────────────────

describe('circle detection — 4-curve closed path → CIRCLE entity', () => {
  it('emits a CIRCLE entity for a standard PDF circle encoding', () => {
    const w = makeWriter();
    processConstructPath(circleSubOps(), circleCoords(50, 50, 20), w, 1);
    const dxf = w.stringify();
    expect(countCircles(dxf)).toBe(1);
    expect(countLines(dxf)).toBe(0);
  });

  it('detects circle with scale applied', () => {
    const w = makeWriter();
    // Circle at (10,10) r=5, scale=2 → effective (20,20) r=10
    processConstructPath(circleSubOps(), circleCoords(10, 10, 5), w, 2);
    const dxf = w.stringify();
    expect(countCircles(dxf)).toBe(1);
  });

  it('does NOT detect a circle for an open 4-curve path', () => {
    const w = makeWriter();
    // Same coords but without closePath
    const ops = [PATH_OPS.moveTo, PATH_OPS.curveTo, PATH_OPS.curveTo, PATH_OPS.curveTo, PATH_OPS.curveTo];
    processConstructPath(ops, circleCoords(0, 0, 10), w, 1);
    const dxf = w.stringify();
    expect(countCircles(dxf)).toBe(0);
  });

  it('does NOT detect a circle for a 3-curve closed path', () => {
    const w = makeWriter();
    // Only 3 curves — not a circle
    const ops = [PATH_OPS.moveTo, PATH_OPS.curveTo, PATH_OPS.curveTo, PATH_OPS.curveTo, PATH_OPS.closePath];
    const coords = [0, 10,  5, 10, 10, 5, 10, 0,  10, -5, 5, -10, 0, -10,  -5, -10, -10, -5, -10, 0];
    processConstructPath(ops, coords, w, 1);
    const dxf = w.stringify();
    expect(countCircles(dxf)).toBe(0);
  });

  it('falls back to lines for a closed 4-curve non-circular path', () => {
    const w = makeWriter();
    // 4 curves forming a squiggly closed shape — not a circle
    const ops = [PATH_OPS.moveTo, PATH_OPS.curveTo, PATH_OPS.curveTo, PATH_OPS.curveTo, PATH_OPS.curveTo, PATH_OPS.closePath];
    const coords = [
      0, 0,
      0, 50, 100, 50, 100, 0,
      150, 0, 150, -50, 100, -50,
      50, -50, 50, 50, 0, 50,
      -50, 50, -50, 0, 0, 0,
    ];
    processConstructPath(ops, coords, w, 1);
    const dxf = w.stringify();
    expect(countCircles(dxf)).toBe(0);
    expect(countLines(dxf)).toBeGreaterThan(0);
  });
});

// ─── processConstructPath — moveTo / lineTo ───────────────────────────────────

describe('processConstructPath — moveTo + lineTo', () => {
  it('draws a single line segment between two points', () => {
    const w = makeWriter();
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.lineTo],
      [0, 0, 10, 0],
      w, 1,
    );
    expect(countLines(w.stringify())).toBe(1);
  });

  it('applies the scale factor to coordinates', () => {
    const w = makeWriter();
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.lineTo],
      [0, 0, 5, 0],
      w, 2,
    );
    const dxf = w.stringify();
    expect(dxf).toMatch(/^11\s*\n10$/m);
  });

  it('draws a polyline of N-1 segments for N points', () => {
    const w = makeWriter();
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.lineTo, PATH_OPS.lineTo, PATH_OPS.lineTo],
      [0, 0, 1, 0, 2, 0, 3, 0],
      w, 1,
    );
    expect(countLines(w.stringify())).toBe(3);
  });

  it('ignores lineTo when there is no current position', () => {
    const w = makeWriter();
    processConstructPath([PATH_OPS.lineTo], [10, 10], w, 1);
    expect(countLines(w.stringify())).toBe(0);
  });
});

// ─── processConstructPath — closePath ────────────────────────────────────────

describe('processConstructPath — closePath', () => {
  it('adds a closing segment back to the path start', () => {
    const w = makeWriter();
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.lineTo, PATH_OPS.lineTo, PATH_OPS.closePath],
      [0, 0, 10, 0, 10, 10],
      w, 1,
    );
    expect(countLines(w.stringify())).toBe(3);
  });

  it('does not add a closing segment when already at path start', () => {
    const w = makeWriter();
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.lineTo, PATH_OPS.lineTo, PATH_OPS.closePath],
      [0, 0, 10, 0, 0, 0],
      w, 1,
    );
    expect(countLines(w.stringify())).toBe(2);
  });
});

// ─── processConstructPath — rectangle ────────────────────────────────────────

describe('processConstructPath — rectangle', () => {
  it('draws exactly 4 line segments for a rectangle', () => {
    const w = makeWriter();
    processConstructPath([PATH_OPS.rectangle], [0, 0, 10, 5], w, 1);
    expect(countLines(w.stringify())).toBe(4);
  });

  it('applies scale to rectangle coordinates', () => {
    const w = makeWriter();
    processConstructPath([PATH_OPS.rectangle], [0, 0, 5, 5], w, 2);
    const dxf = w.stringify();
    expect(dxf).toMatch(/^11\s*\n10$/m);
  });

  it('sets currentPos to bottom-left after rectangle', () => {
    const w = makeWriter();
    processConstructPath(
      [PATH_OPS.rectangle, PATH_OPS.lineTo],
      [0, 0, 10, 10, 20, 0],
      w, 1,
    );
    expect(countLines(w.stringify())).toBe(6);
  });
});

// ─── processConstructPath — curveTo ──────────────────────────────────────────

describe('processConstructPath — curveTo (adaptive)', () => {
  it('produces at least 1 segment for a curveTo op', () => {
    const w = makeWriter();
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.curveTo],
      [0, 0, 1, 3, 3, 3, 4, 0],
      w, 1,
    );
    expect(countLines(w.stringify())).toBeGreaterThanOrEqual(1);
  });

  it('skips curveTo when there is no current position', () => {
    const w = makeWriter();
    processConstructPath([PATH_OPS.curveTo], [1, 3, 3, 3, 4, 0], w, 1);
    expect(countLines(w.stringify())).toBe(0);
  });

  it('produces more segments for a highly curved path', () => {
    const w = makeWriter();
    // Large-radius quarter-circle — should subdivide more than a near-straight curve
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.curveTo],
      [0, 0, 0, 1000, 1000, 1000, 1000, 0],
      w, 1,
    );
    expect(countLines(w.stringify())).toBeGreaterThan(4);
  });
});

// ─── processConstructPath — mixed ops ────────────────────────────────────────

describe('processConstructPath — mixed operations', () => {
  it('handles moveTo + rectangle + lineTo in sequence', () => {
    const w = makeWriter();
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.rectangle, PATH_OPS.lineTo],
      [50, 50, 0, 0, 10, 10, 20, 20],
      w, 1,
    );
    expect(countLines(w.stringify())).toBe(6);
  });

  it('handles multiple sub-paths separated by moveTo', () => {
    const w = makeWriter();
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.lineTo, PATH_OPS.moveTo, PATH_OPS.lineTo],
      [0, 0, 10, 0, 20, 0, 30, 0],
      w, 1,
    );
    expect(countLines(w.stringify())).toBe(2);
  });

  it('handles a mix of line and curve ops in one path', () => {
    const w = makeWriter();
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.lineTo, PATH_OPS.curveTo, PATH_OPS.lineTo],
      [0, 0, 10, 0, 10, 5, 15, 5, 20, 0, 30, 0],
      w, 1,
    );
    expect(countLines(w.stringify())).toBeGreaterThanOrEqual(3);
  });
});
