/**
 * pdf-to-dxf — React component
 * Part of the ek-mc civil toolset
 */

import React, { useCallback, useRef, useState } from 'react';
import { convertPdfToDxf } from '../core/converter';
import type { ConvertOptions, ConvertResult } from '../core/converter';

export interface PdfToDxfProps {
  /** Called when conversion completes successfully */
  onComplete?: (result: ConvertResult, filename: string) => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Conversion options forwarded to the core engine */
  options?: ConvertOptions;
  /** Custom class name for the root element */
  className?: string;
}

type Status = 'idle' | 'loading' | 'done' | 'error';

export function PdfToDxf({ onComplete, onError, options = {}, className }: PdfToDxfProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<string>('');
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [dxfBlob, setDxfBlob] = useState<string | null>(null);
  const [outputName, setOutputName] = useState<string>('output.dxf');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        const err = new Error('Only PDF files are supported.');
        setStatus('error');
        setProgress(err.message);
        onError?.(err);
        return;
      }

      const baseName = file.name.replace(/\.pdf$/i, '');
      setOutputName(`${baseName}.dxf`);
      setStatus('loading');
      setProgress('Reading file…');
      setResult(null);
      setDxfBlob(null);
      setWarnings([]);

      try {
        const buffer = await file.arrayBuffer();
        setProgress('Parsing PDF and converting to DXF…');
        const res = await convertPdfToDxf(buffer, options);
        const blob = new Blob([res.dxf], { type: 'application/dxf' });
        const url = URL.createObjectURL(blob);
        setDxfBlob(url);
        setResult(res);
        setWarnings(res.warnings);
        setStatus('done');
        setProgress(`Done — ${res.pageCount} page(s) converted.`);
        onComplete?.(res, `${baseName}.dxf`);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setStatus('error');
        setProgress(`Error: ${e.message}`);
        onError?.(e);
      }
    },
    [options, onComplete, onError]
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      processFile(files[0]);
    },
    [processFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleReset = () => {
    if (dxfBlob) URL.revokeObjectURL(dxfBlob);
    setStatus('idle');
    setProgress('');
    setResult(null);
    setDxfBlob(null);
    setWarnings([]);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className={className} style={styles.wrapper}>
      <div style={styles.card}>
        <h2 style={styles.title}>PDF → DXF Converter</h2>
        <p style={styles.subtitle}>
          Converts PDF vector geometry and text to AutoCAD DXF — fully local, no uploads.
        </p>

        {/* Drop zone */}
        {status === 'idle' || status === 'error' ? (
          <div
            style={{
              ...styles.dropZone,
              ...(dragOver ? styles.dropZoneActive : {}),
            }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
            aria-label="Drop a PDF file here or click to browse"
          >
            <span style={styles.dropIcon}>📄</span>
            <p style={styles.dropText}>
              {dragOver ? 'Release to convert' : 'Drop a PDF here, or click to browse'}
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              style={{ display: 'none' }}
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        ) : null}

        {/* Progress / status */}
        {status === 'loading' && (
          <div style={styles.statusBox}>
            <span style={styles.spinner} aria-label="Loading" />
            <p style={styles.statusText}>{progress}</p>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <p style={{ ...styles.statusText, color: '#e74c3c', marginTop: 12 }}>{progress}</p>
        )}

        {/* Result */}
        {status === 'done' && result && dxfBlob && (
          <div style={styles.resultBox}>
            <p style={styles.successText}>✓ {progress}</p>

            {warnings.length > 0 && (
              <div style={styles.warningBox}>
                <strong>Warnings:</strong>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            <div style={styles.actions}>
              <a href={dxfBlob} download={outputName} style={styles.btnPrimary}>
                ⬇ Download {outputName}
              </a>
              <button onClick={handleReset} style={styles.btnSecondary}>
                Convert another
              </button>
            </div>
          </div>
        )}

        {/* Options summary */}
        {(options.scale && options.scale !== 1) ||
         options.pages?.length ||
         options.layerPrefix ? (
          <div style={styles.optionsBadge}>
            {options.scale && options.scale !== 1 && <span>Scale: {options.scale}×</span>}
            {options.pages?.length ? <span>Pages: {options.pages.join(', ')}</span> : null}
            {options.layerPrefix && <span>Layer prefix: {options.layerPrefix}</span>}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Inline styles (zero external CSS dependency) ───────────────────────────

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: '2rem',
    minHeight: '100%',
    boxSizing: 'border-box',
  },
  card: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '2rem',
    maxWidth: '520px',
    width: '100%',
    boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
  },
  title: {
    margin: '0 0 4px',
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#1a202c',
  },
  subtitle: {
    margin: '0 0 1.5rem',
    fontSize: '0.875rem',
    color: '#718096',
  },
  dropZone: {
    border: '2px dashed #cbd5e0',
    borderRadius: '8px',
    padding: '2.5rem 1rem',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'border-color 0.2s, background 0.2s',
    background: '#f7fafc',
  },
  dropZoneActive: {
    borderColor: '#3182ce',
    background: '#ebf8ff',
  },
  dropIcon: {
    fontSize: '2.5rem',
    display: 'block',
    marginBottom: '0.5rem',
  },
  dropText: {
    margin: 0,
    color: '#4a5568',
    fontSize: '0.95rem',
  },
  statusBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    marginTop: '1.25rem',
  },
  spinner: {
    display: 'inline-block',
    width: '20px',
    height: '20px',
    border: '3px solid #e2e8f0',
    borderTop: '3px solid #3182ce',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    flexShrink: 0,
  },
  statusText: {
    margin: 0,
    color: '#4a5568',
    fontSize: '0.9rem',
  },
  resultBox: {
    marginTop: '1.25rem',
  },
  successText: {
    margin: '0 0 0.75rem',
    color: '#276749',
    fontWeight: 600,
    fontSize: '0.95rem',
  },
  warningBox: {
    background: '#fffbeb',
    border: '1px solid #f6e05e',
    borderRadius: '6px',
    padding: '0.75rem',
    fontSize: '0.8rem',
    color: '#744210',
    marginBottom: '1rem',
  },
  actions: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
  },
  btnPrimary: {
    display: 'inline-block',
    padding: '0.6rem 1.2rem',
    background: '#3182ce',
    color: '#fff',
    borderRadius: '6px',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: '0.9rem',
    border: 'none',
    cursor: 'pointer',
  },
  btnSecondary: {
    padding: '0.6rem 1.2rem',
    background: 'transparent',
    color: '#3182ce',
    border: '1px solid #3182ce',
    borderRadius: '6px',
    fontWeight: 600,
    fontSize: '0.9rem',
    cursor: 'pointer',
  },
  optionsBadge: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
    marginTop: '1rem',
    fontSize: '0.75rem',
    color: '#718096',
  },
};
