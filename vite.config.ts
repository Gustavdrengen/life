import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, 'src/lib'),
      $engine: path.resolve(__dirname, 'src/engine'),
      $ui: path.resolve(__dirname, 'src/ui'),
      $specs: path.resolve(__dirname, 'specs')
    }
  },
  plugins: [
    svelte(),
    // Single-file HTML export is opt-in via `vite build --mode singlefile` (see npm
    // script `export:html`) so the dev server stays slim and HMR keeps working.
    ...(process.env.VITE_SINGLEFILE === 'true' ? [viteSingleFile()] : [])
  ],
  server: {
    port: 5173,
    strictPort: false,
    open: false
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  },
  esbuild: {
    target: 'esnext'
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    }
  }
});
