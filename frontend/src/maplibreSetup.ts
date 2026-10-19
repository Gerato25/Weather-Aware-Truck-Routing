import { setWorkerUrl } from 'maplibre-gl'

import { registerOmProtocol } from './lib/omWeather'

// MapLibre 6 looks for its worker next to import.meta.url. Vite relocates the
// bundle, so that lookup 404s and the WebGL canvas stays black. The Vite plugin
// in vite.config.ts serves the worker at this stable same-origin path.
setWorkerUrl(new URL('maplibre-gl-worker.mjs', window.location.origin + import.meta.env.BASE_URL).href)
registerOmProtocol()
