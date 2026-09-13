import { defineConfig } from 'vite'

// base '' => rutas relativas, funciona igual en GitHub Pages, en local y abierto desde archivo
export default defineConfig({
  base: '',
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 100000 },
  server: { port: 5180 }
})
