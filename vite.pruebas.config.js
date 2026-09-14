import { defineConfig } from 'vite'

// Config SOLO para mirar la batalla mientras otros agentes tocan ficheros:
// sin vigilante y sin HMR, la página no se recarga a mitad de una prueba.
export default defineConfig({
  base: '',
  server: {
    port: 5231,
    hmr: false,
    watch: { ignored: ['**/*'] }
  }
})
