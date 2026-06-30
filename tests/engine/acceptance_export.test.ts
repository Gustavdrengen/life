/**
 * Acceptance #8 — single-file HTML export round-trip (VISION §Success).
 *
 * Spec: VISION §Success #8 ("Export a world as `.html`, open it on the
 * same machine in a fresh browser profile, see the same world.")
 *
 * The base build is exercised by `tools/export-singlefile.mjs`. This
 * test pins the round-trip contract: the export script produces a
 * file that
 *  - exists at the requested path
 *  - is under 5 MB (VISION §Constraints)
 *  - contains the engine's entry-point wiring (Vite singlefile
 *    plugin must have inlined the JS bundle — no /assets/ paths
 *    remain)
 *  - is a self-contained HTML document the browser can open offline
 *
 * The test runs the export script in a temp directory and asserts on
 * the produced file. The Vite build is shared with `npm run build`
 * — it takes ~10 s on commodity hardware. Tagged with a long
 * timeout so CI doesn't trip on slow nodes.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(here, '..', '..');
const exportScript = join(projectRoot, 'tools', 'export-singlefile.mjs');
const MAX_BYTES = 5 * 1024 * 1024;

describe('acceptance #8: single-file HTML export round-trip', () => {
  it('produces a self-contained, in-budget HTML file', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'life-export-'));
    const outFile = join(tempDir, 'life.html');
    try {
      execFileSync('node', [exportScript, outFile], {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 60_000
      });
      // File exists at the requested path.
      expect(existsSync(outFile)).toBe(true);
      // Under the 5 MB VISION §Constraints ceiling.
      const bytes = statSync(outFile).size;
      expect(bytes).toBeLessThanOrEqual(MAX_BYTES);
      // Vite singlefile plugin inlined the bundle — no /assets/
      // paths remain. A real browser can open the file offline.
      const html = readFileSync(outFile, 'utf8');
      expect(/\/assets\/[^"']+\.(js|css)/.test(html)).toBe(false);
      // Entry-point wiring is present: the Vite-built `index.html`
      // always contains a `<script type="module"` tag (with
      // attributes Vite adds — `crossorigin`, etc.) and the mount
      // point selector (`#app` by default).
      expect(html).toMatch(/<script\s+type="module"/);
      expect(html).toMatch(/<div\s+id="app"/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 60_000);
});
