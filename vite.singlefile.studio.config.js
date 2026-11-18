import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The Studio as ONE html file (`npm run build:html` makes it next to the game's single file)
export default defineConfig({
  plugins: [viteSingleFile()],
  define: { __GAME_FILE__: JSON.stringify('gridlock-blocks.html') },   // 'Save & play' opens this file next to the studio, not a generic index.html that may belong to something else
  build: { outDir: 'dist-singlefile-studio', emptyOutDir: true, rollupOptions: { input: 'studio.html' } }
});
