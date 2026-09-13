import { events, EV } from './events.js'
import { CONFIG } from './config.js'
import { game } from './state.js'

/**
 * Reloj de la simulación: emite EV.TICK a ritmo fijo, independiente de los FPS.
 * La simulación NUNCA se engancha al render: así el juego cuadra igual en un
 * móvil de gama baja que en uno potente.
 */
let acumulado = 0
let ultimo = 0
let corriendo = false

export function arrancarReloj () {
  if (corriendo) return
  corriendo = true
  ultimo = performance.now()
  const bucle = (ahora) => {
    if (!corriendo) return
    let dt = (ahora - ultimo) / 1000
    ultimo = ahora
    if (dt > 1) dt = 1                  // si el móvil se durmió, no dispares la simulación
    acumulado += dt
    const paso = CONFIG.TICK_MS / 1000
    let vueltas = 0
    while (acumulado >= paso && vueltas < 8) {
      game.state.stats.tiempoJugado += paso
      events.emit(EV.TICK, { dt: paso })
      acumulado -= paso
      vueltas++
    }
    requestAnimationFrame(bucle)
  }
  requestAnimationFrame(bucle)
}

export function pararReloj () { corriendo = false }

/** Formatea segundos como 1h 04m / 3m 20s / 45s, para los contadores de obra. */
export function formatoTiempo (seg) {
  seg = Math.max(0, Math.ceil(seg))
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}
