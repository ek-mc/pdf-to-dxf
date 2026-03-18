import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// https://vitejs.dev/guide/build#library-mode
export default defineConfig(({ mode }) => {
  if (mode === 'lib') {
    // ── Library build (ESM + CJS) ──────────────────────────────────────────
    return {
      plugins: [react()],
      build: {
        lib: {
          entry: resolve(__dirname, 'src/index.ts'),
          name: 'PdfToDxf',
          formats: ['es', 'cjs'],
          fileName: (format) => `pdf-to-dxf.${format === 'es' ? 'mjs' : 'cjs'}`,
        },
        rollupOptions: {
          // Peer deps — do not bundle React
          external: ['react', 'react-dom', 'react/jsx-runtime'],
          output: {
            globals: {
              react: 'React',
              'react-dom': 'ReactDOM',
            },
          },
        },
        outDir: 'dist',
        emptyOutDir: true,
      },
    };
  }

  if (mode === 'cli') {
    // ── CLI build (Node ESM) ───────────────────────────────────────────────
    return {
      build: {
        lib: {
          entry: resolve(__dirname, 'src/cli/index.ts'),
          formats: ['es'],
          fileName: () => 'cli.mjs',
        },
        rollupOptions: {
          external: [
            'node:fs', 'node:path', 'node:url',
            'pdfjs-dist', '@tarikjabiri/dxf',
          ],
        },
        outDir: 'dist',
        emptyOutDir: false,
        target: 'node18',
      },
    };
  }

  // ── Demo / GitHub Pages build ─────────────────────────────────────────────
  return {
    plugins: [react()],
    base: mode === 'ghpages' ? '/pdf-to-dxf/' : '/',
    build: {
      outDir: 'dist-demo',
      emptyOutDir: true,
    },
  };
});
