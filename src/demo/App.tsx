/**
 * pdf-to-dxf — Demo application
 * Part of the ek-mc civil toolset
 */

import { PdfToDxf } from '../react/PdfToDxf';

export default function App() {
  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f8' }}>
      {/* Header */}
      <header style={{
        background: '#1a202c',
        color: '#fff',
        padding: '1rem 2rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
      }}>
        <span style={{ fontSize: '1.5rem' }}>📐</span>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>pdf-to-dxf</h1>
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#a0aec0' }}>
            ek-mc civil toolset
          </p>
        </div>
      </header>

      {/* Converter */}
      <main style={{ padding: '2rem 1rem' }}>
        <PdfToDxf
          options={{ scale: 1, includeText: true, includePaths: true }}
          onComplete={(result, filename) => {
            console.log(`Converted ${result.pageCount} page(s) → ${filename}`);
          }}
          onError={(err) => {
            console.error('Conversion error:', err.message);
          }}
        />
      </main>

      {/* Footer */}
      <footer style={{
        textAlign: 'center',
        padding: '1.5rem',
        fontSize: '0.75rem',
        color: '#718096',
      }}>
        <a
          href="https://github.com/ek-mc/pdf-to-dxf"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#3182ce' }}
        >
          github.com/ek-mc/pdf-to-dxf
        </a>
        {' · '}MIT License
      </footer>
    </div>
  );
}
