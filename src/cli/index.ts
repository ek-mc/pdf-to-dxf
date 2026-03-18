#!/usr/bin/env node
/**
 * pdf-to-dxf CLI
 * Part of the ek-mc civil toolset
 *
 * Usage:
 *   npx pdf-to-dxf <input.pdf> [output.dxf] [options]
 *
 * Options:
 *   --pages <1,2,3>        Pages to convert (comma-separated, 1-indexed)
 *   --scale <number>       Scale factor (default: 1)
 *   --layer-prefix <name>  DXF layer name prefix (default: PAGE)
 *   --no-text              Exclude text entities
 *   --no-paths             Exclude vector paths
 *   --help                 Show this help message
 *   --version              Show version
 */

import fs from 'node:fs';
import path from 'node:path';
import { convertPdfToDxf } from '../core/converter.js';

// Use the pdfjs-dist legacy build for Node.js compatibility
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// Disable the worker in Node — pdfjs will run in-process
pdfjs.GlobalWorkerOptions.workerSrc = '';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
pdf-to-dxf — PDF to AutoCAD DXF converter (ek-mc civil toolset)

Usage:
  pdf-to-dxf <input.pdf> [output.dxf] [options]

Arguments:
  input.pdf     Path to the source PDF file
  output.dxf    Path for the output DXF file (default: <input>.dxf)

Options:
  --pages <1,2,3>        Comma-separated list of pages to convert (default: all)
  --scale <number>       Uniform scale factor applied to all coordinates (default: 1)
  --layer-prefix <name>  Prefix for DXF layer names (default: PAGE)
  --no-text              Exclude text entities from output
  --no-paths             Exclude vector path entities from output
  --help                 Show this help message
  --version              Show package version

Examples:
  pdf-to-dxf drawing.pdf
  pdf-to-dxf drawing.pdf output.dxf --scale 0.0394 --pages 1,2
  npx pdf-to-dxf plan.pdf --no-text
`);
}

function printVersion() {
  try {
    const pkgPath = new URL('../../package.json', import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    console.log(pkg.version);
  } catch {
    console.log('unknown');
  }
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { flags.help = true; }
    else if (arg === '--version' || arg === '-v') { flags.version = true; }
    else if (arg === '--no-text') { flags.noText = true; }
    else if (arg === '--no-paths') { flags.noPaths = true; }
    else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      flags[key] = args[++i] ?? true;
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { positional, flags } = parseArgs(process.argv);

  if (flags.help) { printHelp(); process.exit(0); }
  if (flags.version) { printVersion(); process.exit(0); }

  if (positional.length === 0) {
    console.error('Error: No input file specified.\n');
    printHelp();
    process.exit(1);
  }

  const inputPath = path.resolve(positional[0]);
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: File not found — ${inputPath}`);
    process.exit(1);
  }

  const defaultOutput = inputPath.replace(/\.pdf$/i, '.dxf');
  const outputPath = path.resolve(positional[1] ?? defaultOutput);

  // Parse options
  const pages = flags.pages
    ? String(flags.pages).split(',').map((p) => parseInt(p.trim(), 10)).filter(Boolean)
    : [];
  const scale = flags.scale ? parseFloat(String(flags.scale)) : 1;
  const layerPrefix = flags['layer-prefix'] ? String(flags['layer-prefix']) : 'PAGE';
  const includeText = !flags.noText;
  const includePaths = !flags.noPaths;

  console.log(`\npdf-to-dxf`);
  console.log(`  Input  : ${inputPath}`);
  console.log(`  Output : ${outputPath}`);
  if (pages.length) console.log(`  Pages  : ${pages.join(', ')}`);
  if (scale !== 1)  console.log(`  Scale  : ${scale}`);
  console.log('');

  try {
    const buffer = new Uint8Array(fs.readFileSync(inputPath));
    console.log('Converting…');

    const result = await convertPdfToDxf(buffer, {
      pages,
      scale,
      layerPrefix,
      includeText,
      includePaths,
    });

    fs.writeFileSync(outputPath, result.dxf, 'utf8');

    console.log(`✓ Done — ${result.pageCount} page(s) converted.`);
    console.log(`  Saved to: ${outputPath}`);

    if (result.warnings.length > 0) {
      console.warn('\nWarnings:');
      result.warnings.forEach((w) => console.warn(`  ⚠ ${w}`));
    }
  } catch (err) {
    console.error(`\nConversion failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
