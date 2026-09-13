import { game, migrar, nuevaPartida, setState } from './state.js'
import { events, EV } from './events.js'
import { CONFIG } from './config.js'

/**
 * Guardado en el propio móvil (localStorage). Sin servidor, sin cuentas, sin coste.
 * Se guarda solo cada 10 s y siempre que la app pasa a segundo plano.
 */
const CLAVE = 'baluarte.save.v1'
const CLAVE_BK = 'baluarte.save.backup'

export function guardar () {
  try {
    game.state.ultimoTick = Date.now()
    const json = JSON.stringify(game.state)
    const previo = localStorage.getItem(CLAVE)
    if (previo) localStorage.setItem(CLAVE_BK, previo)   // copia de seguridad de la anterior
    localStorage.setItem(CLAVE, json)
    events.emit(EV.STATE_SAVED, { state: game.state })
    return true
  } catch (err) {
    console.error('[save] no se pudo guardar', err)
    return false
  }
}

/** @returns {number} segundos que el jugador ha estado fuera (0 si es partida nueva) */
export function cargar () {
  let crudo = localStorage.getItem(CLAVE)
  let s = null
  try { s = crudo ? JSON.parse(crudo) : null } catch { s = null }
  if (!s) {
    try { s = JSON.parse(localStorage.getItem(CLAVE_BK) || 'null') } catch { s = null }
  }
  if (!s) {
    setState(nuevaPartida())
    events.emit(EV.STATE_LOADED, { state: game.state, offlineSeconds: 0 })
    return 0
  }
  const migrada = migrar(s)
  const fuera = Math.max(0, (Date.now() - (migrada.ultimoTick || Date.now())) / 1000)
  const limitada = Math.min(fuera, CONFIG.MAX_OFFLINE_HORAS * 3600)
  setState(migrada)
  events.emit(EV.STATE_LOADED, { state: game.state, offlineSeconds: limitada })
  return limitada
}

export function borrarPartida () {
  localStorage.removeItem(CLAVE)
  localStorage.removeItem(CLAVE_BK)
}

export function exportar () { return btoa(unescape(encodeURIComponent(JSON.stringify(game.state)))) }

export function importar (texto) {
  const s = JSON.parse(decodeURIComponent(escape(atob(texto.trim()))))
  setState(migrar(s))
  guardar()
  return game.state
}

export function autoguardado () {
  setInterval(guardar, 10000)
  document.addEventListener('visibilitychange', () => { if (document.hidden) guardar() })
  window.addEventListener('pagehide', guardar)
}
