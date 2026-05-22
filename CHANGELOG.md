# Changelog

## Upgrade Notes convention

For each release entry, include an **Upgrade Notes** line:
- `Upgrade Notes: None` if no migration/breaking changes are required
- otherwise include concrete migration/compatibility instructions


All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-05-22

### Added
- **Adaptive Bézier subdivision** (`approximateBezierAdaptive`): replaces the
  fixed-step (8-segment) approximation with a recursive De Casteljau algorithm.
  Curves are subdivided until the chordal deviation falls below `BEZIER_TOLERANCE`
  (0.5 pt). Near-straight sections now emit a single `LINE`; highly-curved
  sections subdivide as needed. Results in smaller DXF files and smoother output
  for large-scale civil/topo drawings.
- **True circle detection** (`tryFitCircleFromSubPath`, `fitCircle`): closed
  sub-paths composed of exactly 4 cubic Bézier curves are tested against a
  least-squares circle fit. When the anchor points lie within `CIRCLE_FIT_TOLERANCE`
  (0.5 pt) of the fitted circle, a native DXF `CIRCLE` entity is emitted instead
  of 30+ `LINE` segments. This makes circles fully editable in CAD (centre snap,
  radius query, offset, etc.).
- New test coverage in `converter.test.ts`:
  - `chordalDeviation` unit tests.
  - Adaptive subdivision: endpoint preservation, depth guard, tolerance comparison.
  - `fitCircle`: unit circle, arbitrary centre/radius, collinear/degenerate inputs.
  - Circle detection integration: standard PDF circle encoding, scale factor,
    open path (no detection), 3-curve path (no detection), non-circular 4-curve path.
  - Total test count: 33 (up from 18).

### Changed
- `processConstructPath` now uses a two-phase pipeline (`collectSubPaths` +
  `emitSubPath`) instead of a single-pass loop, enabling per-sub-path analysis
  before emission.

Upgrade Notes: None

## [1.1.0] - 2026-05-17

### Added
- Unit tests for the core conversion engine (`src/core/converter.test.ts`) using Vitest.
  - Tests cover `PATH_OPS` constants, `approximateBezier`, and `processConstructPath` for all sub-operations: `moveTo`, `lineTo`, `closePath`, `rectangle`, `curveTo`, `curveTo2`, `curveTo3`, and mixed sequences.
  - 18 test cases in total; all passing.
- `vitest` added as a dev dependency.

### Changed
- `package.json`: added `"test": "vitest run"` script so `pnpm test` / `npm test` now executes the test suite.

Upgrade Notes: None

## [1.0.0] - 2026-03-18

### Added
- Initial release.
- Core conversion engine parsing PDF vectors and text using `pdfjs-dist` and exporting via `@tarikjabiri/dxf`.
- Dual-mode architecture: Node.js CLI tool and React component.
- Support for selecting specific pages to convert.
- Support for custom scaling and layer prefixing.
- Demo application to preview the React component.

## 2026-04-29

- Added basic GitHub Actions CI workflow (`.github/workflows/basic-ci.yml`).
- Maintenance: closed stale dependency PR queue for cleaner triage (where applicable).
