import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The Studio as ONE html file (`npm run build:html` makes it next to the game's single file)
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { outDir: 'dist-singlefile-studio', emptyOutDir: true, rollupOptions: { input: 'studio.html' } }
});
