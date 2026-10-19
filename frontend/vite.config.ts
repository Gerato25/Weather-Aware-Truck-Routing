import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const maplibreWorkerFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs',
)

/** Serves MapLibre's web worker at a stable same-origin URL. */
function maplibreWorker(): Plugin {
  const urlPath = '/maplibre-gl-worker.mjs'
  return {
    name: 'maplibre-worker',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== urlPath) {
          next()
          return
        }
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        fs.createReadStream(maplibreWorkerFile).pipe(res)
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'maplibre-gl-worker.mjs',
        source: fs.readFileSync(maplibreWorkerFile),
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), maplibreWorker()],
  server: {
    port: 5173,
    // Bind IPv4 explicitly; the default IPv6-only bind is unreachable for
    // tooling and browsers that resolve localhost to 127.0.0.1.
    host: '127.0.0.1',
    // Talk to Django through the dev server so the browser sees one origin.
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  // Keep MapLibre out of the pre-bundle so its worker URL stays resolvable in
  // development even if maplibreSetup.ts is imported slightly late.
  optimizeDeps: {
    exclude: ['maplibre-gl', '@openmeteo/weather-map-layer'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // MapLibre GL is ~1 MB on its own and is already isolated in its own chunk.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // MapLibre is by far the largest dependency; splitting it lets the
        // app shell paint without waiting on the whole GL bundle.
        manualChunks(id: string) {
          if (id.includes('maplibre-gl')) return 'maplibre'
          if (id.includes('/node_modules/react')) return 'react'
          return undefined
        },
      },
    },
  },
})
