import { defineConfig } from 'vite';

// two pages: the game (index.html) and the Studio editor (studio.html)
export default defineConfig({
  base: './',
  server: { open: true },
  build: { rollupOptions: { input: { main: 'index.html', studio: 'studio.html' } } }
});
