# Changelog

## Upgrade Notes convention

For each release entry, include an **Upgrade Notes** line:
- `Upgrade Notes: None` if no migration/breaking changes are required
- otherwise include concrete migration/compatibility instructions


All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
