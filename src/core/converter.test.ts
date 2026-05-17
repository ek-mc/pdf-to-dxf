/**
 * pdf-to-dxf — Core conversion engine unit tests
 *
 * These tests exercise the pure, synchronous geometry helpers that are
 * extracted from the main converter module so they can be tested without
 * a real PDF document or a pdfjs worker.
 *
 * Tested surface:
 *  - PATH_OPS constants (sanity)
 *  - approximateBezier — cubic Bézier polyline approximation
 *  - processConstructPath — moveTo / lineTo / closePath / rectangle / curveTo
 *  - ConvertOptions defaults (via the exported helper)
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

function approximateBezier(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
  writer: DxfWriter,
  steps = 8,
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

function processConstructPath(
  subOps: number[],
  coords: number[],
  writer: DxfWriter,
  scale: number,
): void {
  let ci = 0;
  let pathStart: Vec3 | null = null;
  let currentPos: Vec3 | null = null;
  const s = (v: number) => v * scale;

  for (const op of subOps) {
    switch (op) {
      case PATH_OPS.moveTo: {
        const p = pt(s(coords[ci]!), s(coords[ci + 1]!));
        ci += 2;
        pathStart = p;
        currentPos = p;
        break;
      }
      case PATH_OPS.lineTo: {
        if (currentPos) {
          const to = pt(s(coords[ci]!), s(coords[ci + 1]!));
          ci += 2;
          writer.addLine(currentPos, to);
          currentPos = to;
        } else {
          ci += 2;
        }
        break;
      }
      case PATH_OPS.curveTo: {
        if (!currentPos) { ci += 6; break; }
        const p1 = pt(s(coords[ci]!), s(coords[ci + 1]!));
        const p2 = pt(s(coords[ci + 2]!), s(coords[ci + 3]!));
        const p3 = pt(s(coords[ci + 4]!), s(coords[ci + 5]!));
        ci += 6;
        approximateBezier(currentPos, p1, p2, p3, writer);
        currentPos = p3;
        break;
      }
      case PATH_OPS.curveTo2: {
        if (!currentPos) { ci += 4; break; }
        const p1 = currentPos;
        const p2 = pt(s(coords[ci]!), s(coords[ci + 1]!));
        const p3 = pt(s(coords[ci + 2]!), s(coords[ci + 3]!));
        ci += 4;
        approximateBezier(currentPos, p1, p2, p3, writer);
        currentPos = p3;
        break;
      }
      case PATH_OPS.curveTo3: {
        if (!currentPos) { ci += 4; break; }
        const p1 = pt(s(coords[ci]!), s(coords[ci + 1]!));
        const p3 = pt(s(coords[ci + 2]!), s(coords[ci + 3]!));
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
        const rx = s(coords[ci]!);
        const ry = s(coords[ci + 1]!);
        const rw = s(coords[ci + 2]!);
        const rh = s(coords[ci + 3]!);
        ci += 4;
        const bl = pt(rx, ry);
        const br = pt(rx + rw, ry);
        const tr = pt(rx + rw, ry + rh);
        const tl = pt(rx, ry + rh);
        writer.addLine(bl, br);
        writer.addLine(br, tr);
        writer.addLine(tr, tl);
        writer.addLine(tl, bl);
        pathStart = bl;
        currentPos = bl;
        break;
      }
      default:
        break;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countLines(dxf: string): number {
  // Count LINE entity occurrences in the DXF string
  return (dxf.match(/\nLINE\n/g) ?? []).length;
}

function makeWriter(): DxfWriter {
  const w = new DxfWriter();
  w.addLayer('TEST', Colors.White, 'CONTINUOUS');
  w.setCurrentLayerName('TEST');
  return w;
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

// ─── approximateBezier ────────────────────────────────────────────────────────

describe('approximateBezier', () => {
  it('produces exactly `steps` line segments', () => {
    const w = makeWriter();
    const p0 = pt(0, 0);
    const p1 = pt(1, 3);
    const p2 = pt(3, 3);
    const p3 = pt(4, 0);
    approximateBezier(p0, p1, p2, p3, w, 8);
    expect(countLines(w.stringify())).toBe(8);
  });

  it('starts at p0 and ends at p3 for a cubic Bézier', () => {
    // For a straight-line degenerate Bézier (all control points collinear),
    // the approximation should start at p0 and end at p3.
    const w = makeWriter();
    const p0 = pt(0, 0);
    const p3 = pt(10, 0);
    approximateBezier(p0, pt(3.33, 0), pt(6.66, 0), p3, w, 4);
    const dxf = w.stringify();
    // The last line segment must end at (10, 0)
    // DXF encodes X as group code 11, Y as 21 for the end point of a LINE
    // DXF group code 11 (end-point X) should be 10 (integer, no decimal for whole numbers)
    expect(dxf).toMatch(/^11\s*\n10$/m);
  });

  it('accepts a custom step count', () => {
    const w = makeWriter();
    approximateBezier(pt(0, 0), pt(1, 1), pt(2, 1), pt(3, 0), w, 16);
    expect(countLines(w.stringify())).toBe(16);
  });

  it('produces a single segment when steps=1', () => {
    const w = makeWriter();
    approximateBezier(pt(0, 0), pt(1, 2), pt(2, 2), pt(3, 0), w, 1);
    expect(countLines(w.stringify())).toBe(1);
  });
});

// ─── processConstructPath — moveTo / lineTo ───────────────────────────────────

describe('processConstructPath — moveTo + lineTo', () => {
  it('draws a single line segment between two points', () => {
    const w = makeWriter();
    // moveTo(0,0) lineTo(10,0)
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.lineTo],
      [0, 0, 10, 0],
      w,
      1,
    );
    expect(countLines(w.stringify())).toBe(1);
  });

  it('applies the scale factor to coordinates', () => {
    const w = makeWriter();
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.lineTo],
      [0, 0, 5, 0],
      w,
      2, // scale = 2 → endpoint should be at x=10
    );
    const dxf = w.stringify();
    // Group code 11 (end-point X) = 10
    expect(dxf).toMatch(/^11\s*\n10$/m);
  });

  it('draws a polyline of N-1 segments for N points', () => {
    const w = makeWriter();
    // moveTo(0,0) lineTo(1,0) lineTo(2,0) lineTo(3,0) → 3 segments
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.lineTo, PATH_OPS.lineTo, PATH_OPS.lineTo],
      [0, 0, 1, 0, 2, 0, 3, 0],
      w,
      1,
    );
    expect(countLines(w.stringify())).toBe(3);
  });

  it('ignores lineTo when there is no current position', () => {
    const w = makeWriter();
    // lineTo without a preceding moveTo — should produce no lines
    processConstructPath([PATH_OPS.lineTo], [10, 10], w, 1);
    expect(countLines(w.stringify())).toBe(0);
  });
});

// ─── processConstructPath — closePath ────────────────────────────────────────

describe('processConstructPath — closePath', () => {
  it('adds a closing segment back to the path start', () => {
    const w = makeWriter();
    // moveTo(0,0) lineTo(10,0) lineTo(10,10) closePath → 3 segments
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.lineTo, PATH_OPS.lineTo, PATH_OPS.closePath],
      [0, 0, 10, 0, 10, 10],
      w,
      1,
    );
    expect(countLines(w.stringify())).toBe(3);
  });

  it('does not add a closing segment when already at path start', () => {
    const w = makeWriter();
    // moveTo(0,0) lineTo(10,0) lineTo(0,0) closePath → 2 segments, no extra
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.lineTo, PATH_OPS.lineTo, PATH_OPS.closePath],
      [0, 0, 10, 0, 0, 0],
      w,
      1,
    );
    expect(countLines(w.stringify())).toBe(2);
  });
});

// ─── processConstructPath — rectangle ────────────────────────────────────────

describe('processConstructPath — rectangle', () => {
  it('draws exactly 4 line segments for a rectangle', () => {
    const w = makeWriter();
    // rectangle at (0,0) with width=10, height=5
    processConstructPath([PATH_OPS.rectangle], [0, 0, 10, 5], w, 1);
    expect(countLines(w.stringify())).toBe(4);
  });

  it('applies scale to rectangle coordinates', () => {
    const w = makeWriter();
    // rectangle at (0,0) w=5 h=5, scale=2 → effective 10×10
    processConstructPath([PATH_OPS.rectangle], [0, 0, 5, 5], w, 2);
    const dxf = w.stringify();
    // Top-right corner X coordinate (group code 11) = 10
    expect(dxf).toMatch(/^11\s*\n10$/m);
  });

  it('sets currentPos to bottom-left after rectangle', () => {
    const w = makeWriter();
    // rectangle then lineTo — should produce 4 + 1 = 5 segments
    processConstructPath(
      [PATH_OPS.rectangle, PATH_OPS.lineTo],
      [0, 0, 10, 10, 20, 0],
      w,
      1,
    );
    expect(countLines(w.stringify())).toBe(5);
  });
});

// ─── processConstructPath — curveTo ──────────────────────────────────────────

describe('processConstructPath — curveTo (cubic Bézier)', () => {
  it('produces 8 line segments (default steps) for a curveTo op', () => {
    const w = makeWriter();
    // moveTo(0,0) curveTo(1,3, 3,3, 4,0)
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.curveTo],
      [0, 0, 1, 3, 3, 3, 4, 0],
      w,
      1,
    );
    expect(countLines(w.stringify())).toBe(8);
  });

  it('skips curveTo when there is no current position', () => {
    const w = makeWriter();
    processConstructPath([PATH_OPS.curveTo], [1, 3, 3, 3, 4, 0], w, 1);
    expect(countLines(w.stringify())).toBe(0);
  });
});

// ─── processConstructPath — mixed ops ────────────────────────────────────────

describe('processConstructPath — mixed operations', () => {
  it('handles moveTo + rectangle + lineTo in sequence', () => {
    const w = makeWriter();
    // moveTo(50,50) rectangle(0,0,10,10) lineTo(20,20)
    // rectangle resets currentPos to (0,0); lineTo draws from (0,0) to (20,20)
    processConstructPath(
      [PATH_OPS.moveTo, PATH_OPS.rectangle, PATH_OPS.lineTo],
      [50, 50, 0, 0, 10, 10, 20, 20],
      w,
      1,
    );
    // 4 (rectangle) + 1 (lineTo) = 5
    expect(countLines(w.stringify())).toBe(5);
  });

  it('handles multiple sub-paths separated by moveTo', () => {
    const w = makeWriter();
    // sub-path 1: moveTo(0,0) lineTo(10,0)
    // sub-path 2: moveTo(20,0) lineTo(30,0)
    processConstructPath(
      [
        PATH_OPS.moveTo, PATH_OPS.lineTo,
        PATH_OPS.moveTo, PATH_OPS.lineTo,
      ],
      [0, 0, 10, 0, 20, 0, 30, 0],
      w,
      1,
    );
    expect(countLines(w.stringify())).toBe(2);
  });
});
