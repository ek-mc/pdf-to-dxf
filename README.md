# pdf-to-dxf

Live: https://ek-mc.github.io/pdf-to-dxf/


A robust, fully local PDF to AutoCAD DXF converter. It extracts vector paths and text from PDF files and converts them into DXF format.

This tool is part of the **ek-mc civil toolset**. It operates entirely on your local machine—no cloud uploads, ensuring your data remains private and secure.

## Features

- **Dual-mode**: Use it as a standalone CLI tool or embed it as a React component.
- **Local processing**: Zero external API calls; your files never leave your machine.
- **Local PDF.js worker**: Browser worker is bundled/served locally (no CDN dependency).
- **Vector extraction**: Accurately extracts lines, curves (approximated as polylines), and rectangles.
- **Text extraction**: Preserves text elements with their relative positioning.
- **Customizable**: Supports page selection, coordinate scaling, and layer prefixing.

## Installation

You can install `pdf-to-dxf` globally to use the CLI, or locally in your project to use the React component.

```bash
# Install globally for CLI usage
npm install -g @ek-mc/pdf-to-dxf

# Or install locally in your project
npm install @ek-mc/pdf-to-dxf
```

## CLI Usage

If installed globally, you can run `pdf-to-dxf` directly from your terminal. Alternatively, use `npx` without installing:

```bash
npx @ek-mc/pdf-to-dxf input.pdf [output.dxf] [options]
```

### Examples

Convert a single file (outputs to `drawing.dxf`):
```bash
pdf-to-dxf drawing.pdf
```

Convert specific pages and apply a scale factor (e.g., from points to millimeters):
```bash
pdf-to-dxf plan.pdf plan_scaled.dxf --pages 1,2,3 --scale 0.3527
```

Exclude text entities:
```bash
pdf-to-dxf schematic.pdf --no-text
```

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `--pages <1,2>` | Comma-separated list of pages to convert (1-indexed). | All pages |
| `--scale <num>` | Uniform scale factor applied to all coordinates. | `1` |
| `--layer-prefix <name>` | Prefix for generated DXF layer names. | `PAGE` |
| `--no-text` | Exclude text entities from the output. | `false` |
| `--no-paths` | Exclude vector path entities from the output. | `false` |
| `--help`, `-h` | Show the help message. | |
| `--version`, `-v` | Show the package version. | |

## React Component Usage

The package includes a ready-to-use React component that provides a drag-and-drop interface for converting PDFs to DXF in the browser.

```tsx
import React from 'react';
import { PdfToDxf } from '@ek-mc/pdf-to-dxf';

export default function App() {
  return (
    <div>
      <h1>PDF to DXF Converter</h1>
      <PdfToDxf 
        options={{ scale: 1, includeText: true }}
        onComplete={(result, filename) => {
          console.log(`Converted ${result.pageCount} pages. Downloaded as ${filename}`);
        }}
        onError={(error) => {
          console.error('Conversion failed:', error);
        }}
      />
    </div>
  );
}
```

### Component Props

| Prop | Type | Description |
|------|------|-------------|
| `options` | `ConvertOptions` | Configuration options for the conversion engine. |
| `onComplete` | `(result: ConvertResult, filename: string) => void` | Callback fired when conversion succeeds. |
| `onError` | `(error: Error) => void` | Callback fired when conversion fails. |
| `className` | `string` | Optional CSS class name for the wrapper element. |

## Core Engine API

If you need programmatic access without the UI, you can use the core conversion function directly.

```typescript
import { convertPdfToDxf } from '@ek-mc/pdf-to-dxf';

// Read your PDF into an ArrayBuffer or Uint8Array
const buffer = await file.arrayBuffer();

const result = await convertPdfToDxf(buffer, {
  pages: [1],
  scale: 1,
  layerPrefix: 'CUSTOM_LAYER',
  includeText: true,
  includePaths: true
});

console.log(result.dxf); // The resulting DXF string
```

## License

MIT License. See the [LICENSE](LICENSE) file for details.
