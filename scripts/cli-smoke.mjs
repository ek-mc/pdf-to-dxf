import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'pdf-to-dxf-'));
try {
  const stream = '0 0 0 RG 10 20 m 100 20 l S\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((obj, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += 'xref\n0 5\n0000000000 65535 f \n';
  pdf += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const input = join(dir, 'line.pdf');
  const output = join(dir, 'line.dxf');
  writeFileSync(input, pdf);
  const cli = new URL('../dist/cli.mjs', import.meta.url);
  const log = execFileSync(process.execPath, [cli.pathname, input, output, '--no-text'], { encoding: 'utf8' });
  assert.doesNotMatch(log, /path extraction failed/);
  const dxf = readFileSync(output, 'utf8').replaceAll('\r\n', '\n');
  assert.match(dxf, /\nLINE\n/);
  assert.match(dxf, /\n10\n10\n20\n20\n/);
  assert.match(dxf, /\n11\n100\n21\n20\n/);
  // Exercise the real PDF.js -> converter -> DXF path, not copied geometry helpers.
  const scaled = join(dir, 'scaled.dxf');
  execFileSync(process.execPath, [cli.pathname, input, scaled, '--no-text', '--scale', '2', '--layer-prefix', 'SURVEY'], { encoding: 'utf8' });
  const scaledDxf = readFileSync(scaled, 'utf8').replaceAll('\r\n', '\n');
  assert.match(scaledDxf, /\n10\n20\n20\n40\n/);
  assert.match(scaledDxf, /\n11\n200\n21\n40\n/);
  assert.match(scaledDxf, /\n8\nSURVEY_1\n/);
  assert.equal((scaledDxf.match(/\nLINE\n/g) ?? []).length, 1);
  const empty = join(dir, 'no-paths.dxf');
  execFileSync(process.execPath, [cli.pathname, input, empty, '--no-text', '--no-paths'], { encoding: 'utf8' });
  assert.doesNotMatch(readFileSync(empty, 'utf8').replaceAll('\r\n', '\n'), /\nLINE\n/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const version = execFileSync(process.execPath, [cli.pathname, '--version'], { encoding: 'utf8' });
  assert.equal(version.trim().split('\n').at(-1), pkg.version);
  console.log('Real PDF.js CLI conversion and package version passed.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
