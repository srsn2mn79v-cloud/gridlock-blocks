import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Separate config for the single-file build (`npm run build:html`) so the normal
// `npm run build` output stays as a regular dist/ folder. This one inlines everything
// — the bundled JS (Three.js included) and all CSS — straight into index.html, so the
// result is one .html file with no other files alongside it and no network access
// needed to run. Open it by double-clicking; no dev server required.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'esnext',
    outDir: 'dist-singlefile',
    emptyOutDir: true
  }
});
