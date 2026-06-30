#!/usr/bin/env node
/**
 * tools/export-singlefile.mjs
 *
 * Produces a single self-contained `.html` file containing the entire
 * engine + UI so a friend can open it in any modern browser with no
 * install. Builds the project with vite-plugin-singlefile enabled
 * (`VITE_SINGLEFILE=true`), then copies the resulting `dist/index.html`
 * to the destination path supplied by the user.
 *
 * Usage:
 *   node tools/export-singlefile.mjs <output.html>
 *
 *   e.g.  node tools/export-singlefile.mjs life.html
 *         node tools/export-singlefile.mjs ./dist/ecosystem.html
 *         node tools/export-singlefile.mjs /mnt/c/Users/gusta/Desktop/life.html
 *
 * The source HTML is always `dist/index.html`. The destination can be
 * an absolute or relative path; relative paths are resolved against the
 * current working directory.
 *
 * Exits non-zero if the build fails, the produced file exceeds the 5 MB
 * VISION §Constraints file-budget ceiling, or the destination path
 * cannot be written.
 *
 * @see specs/ROOT.md §10 (acceptance #8 — round-trip)
 * @see VISION.md §12 "Single-file HTML export"
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = process.cwd();
const outArg = process.argv[2];

if (outArg === undefined) {
  console.error('[export] usage: node tools/export-singlefile.mjs <output.html>');
  console.error('         e.g. node tools/export-singlefile.mjs life.html');
  process.exit(2);
}

if (!outArg.toLowerCase().endsWith('.html')) {
  console.error(`[export] destination must end in .html, got: ${outArg}`);
  process.exit(2);
}

const outPath = resolve(cwd, outArg);

// vite lives at <project-root>/node_modules/.bin/vite. The script sits
// at tools/export-singlefile.mjs so its dirname is two segments below
// the project root.
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const viteBin = resolve(projectRoot, 'node_modules', '.bin', 'vite');

console.log('[export] single-file mode (VITE_SINGLEFILE=true)');
const build = spawnSync(viteBin, ['build'], {
  cwd: projectRoot,
  env: { ...process.env, VITE_SINGLEFILE: 'true' },
  stdio: 'inherit'
});
if (build.error) {
  console.error(`[export] failed to spawn vite at ${viteBin}: ${build.error.message}`);
  process.exit(1);
}
if (build.status !== 0) {
  console.error(`[export] vite build failed (exit ${build.status ?? 'unknown'})`);
  process.exit(build.status ?? 1);
}

const built = resolve(projectRoot, 'dist', 'index.html');
if (!existsSync(built)) {
  console.error(`[export] expected ${built} after build; not found`);
  process.exit(1);
}

const html = readFileSync(built, 'utf8');
// Sanity: the inlined bundle must not still reference external assets.
// If /assets/ URLs appear here the single-file plugin didn't engage.
if (/\/assets\/[^"']+\.(js|css)/.test(html)) {
  console.error('[export] built HTML still references external /assets/');
  console.error('           single-file plugin did not engage; aborting');
  process.exit(3);
}

const bytes = statSync(built).size;
const MAX_BYTES = 5 * 1024 * 1024;
if (bytes > MAX_BYTES) {
  console.error(
    `[export] output is ${(bytes / 1024 / 1024).toFixed(2)} MB; budget is 5 MB`
  );
  process.exit(4);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
console.log(`[export] wrote ${outPath} (${(bytes / 1024).toFixed(1)} kB)`);
