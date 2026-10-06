import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Marketing site. Static build: `npm run build:site` writes dist-site/.
// base './' keeps asset URLs relative so the build works on any path (GitHub Pages, Netlify).
export default defineConfig({
  root: fileURLToPath(new URL('./site', import.meta.url)),
  base: './',
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL('./dist-site', import.meta.url)),
    emptyOutDir: true,
  },
  server: { port: 5180, strictPort: true },
  preview: { port: 5180, strictPort: true },
});
