import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    open: false,
  },
  plugins: [
    {
      name: 'yandex-sdk-absolute',
      transformIndexHtml(html: string) {
        // Platform injects /sdk.js at site root — must stay absolute
        return html.replace(/\bsrc=["']\.\/sdk\.js["']/g, 'src="/sdk.js"');
      },
    },
  ],
});
