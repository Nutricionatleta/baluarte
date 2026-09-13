/**
 * Service worker de Baluarte.
 *
 * La promesa es simple: en la primera visita se guarda la app entera y a partir de
 * ahí el juego abre SIN INTERNET (en el avión, en el metro, con datos agotados).
 * Estrategia "cache first" para todo lo propio, con refresco silencioso por detrás.
 *
 * Sube VERSION cuando cambie la app: al activarse borra las cachés viejas.
 */
const VERSION = 'v1'
const CACHE = `baluarte-${VERSION}`

/** Lo mínimo imprescindible para arrancar sin red. */
const ESENCIALES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './favicon.png'
]

/**
 * Saca del HTML lo que cuelga de él: con Vite los módulos llevan hash en el nombre,
 * así que no hay forma de escribirlos a mano en una lista.
 */
async function assetsDelHtml (cache) {
  const urls = []
  try {
    const res = await fetch('./index.html', { cache: 'reload' })
    if (!res.ok) return urls
    await cache.put('./index.html', res.clone())
    const html = await res.text()
    for (const re of [/<script[^>]+src=["']([^"']+)["']/gi, /<link[^>]+href=["']([^"']+)["']/gi]) {
      let m
      while ((m = re.exec(html))) {
        const u = m[1]
        if (!u || u.startsWith('http') || u.startsWith('data:')) continue
        urls.push(u.startsWith('./') || u.startsWith('/') ? u : `./${u}`)
      }
    }
  } catch { /* sin red: ya se cachea al vuelo en cuanto la haya */ }
  return urls
}

/**
 * Recorre los módulos siguiendo sus imports (los dinámicos incluidos) y los guarda.
 * Así el juego queda ENTERO en el móvil desde la primera visita, sin esperar a que
 * el jugador toque cada pantalla.
 */
async function precachearModulos (cache, semillas) {
  const vistos = new Set()
  const cola = semillas.map(u => new URL(u, self.registration.scope).href)
  while (cola.length && vistos.size < 120) {
    const url = cola.shift()
    if (vistos.has(url)) continue
    vistos.add(url)
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      await cache.put(url, res.clone())
      if (!/\.js(\?|$)/.test(url)) continue
      const txt = await res.text()
      const re = /["'`](\.{1,2}\/[\w.\-/]+\.js)["'`]/g
      let m
      while ((m = re.exec(txt))) cola.push(new URL(m[1], url).href)
    } catch { /* un archivo suelto que falle no puede tumbar la instalación */ }
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await Promise.all(ESENCIALES.map(u => cache.add(u).catch(() => {})))
    await precachearModulos(cache, await assetsDelHtml(cache))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nombres = await caches.keys()
    await Promise.all(nombres.filter(n => n.startsWith('baluarte-') && n !== CACHE).map(n => caches.delete(n)))
    await self.clients.claim()
  })())
})

/** Refresca en segundo plano: el jugador ya tiene su copia, esto es para la próxima vez. */
function refrescar (req, cache) {
  fetch(req).then(res => {
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone())
  }).catch(() => {})
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return   // el juego no pide nada de fuera

  // Navegación: siempre el index cacheado; si no lo hay todavía, red.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE)
      const guardado = await cache.match('./index.html')
      if (guardado) { refrescar('./index.html', cache); return guardado }
      try {
        const res = await fetch(req)
        if (res.ok) cache.put('./index.html', res.clone())
        return res
      } catch {
        return (await cache.match('./')) || new Response('Baluarte no está aún en tu móvil. Ábrelo una vez con conexión.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })
      }
    })())
    return
  }

  // Todo lo demás: de la caché primero, y si no estaba, se guarda al pasar.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const guardado = await cache.match(req)
    if (guardado) { refrescar(req, cache); return guardado }
    const res = await fetch(req)
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone())
    return res
  })())
})

// Permite forzar la actualización desde la app sin recargar a lo bruto.
self.addEventListener('message', (e) => { if (e.data === 'actualizar') self.skipWaiting() })
