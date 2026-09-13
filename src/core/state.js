import { CONFIG } from './config.js'
import { uid } from './rng.js'

/**
 * EL ESTADO DEL JUEGO. Objeto único, plano y serializable a JSON.
 * Reglas de oro:
 *   - Nada de funciones, clases ni objetos de Three.js aquí dentro. Solo datos.
 *   - Se muta a través de los módulos de sim/, nunca desde render/ ni ui/.
 *   - Todo lo que se añada debe sobrevivir a un JSON.stringify + parse.
 */

/** @returns {any} partida nueva */
export function nuevaPartida (seed = (Date.now() & 0xffffffff)) {
  const ahora = Date.now()
  return {
    version: CONFIG.VERSION,
    seed,
    creada: ahora,
    ultimoTick: ahora,
    jugador: { nombre: 'Señor del Baluarte', nivel: 1, xp: 0, gemas: 25 },

    recursos: { madera: 300, piedra: 200, comida: 250, oro: 60 },
    almacen: { ...CONFIG.ALMACEN_BASE },

    age: 'oscura',              // oscura -> feudal -> castillos -> imperial
    buildings: [],              // ver sim/buildings.js
    villagers: [],              // ver sim/villagers.js
    ejercito: { tropas: {}, cola: [] },
    research: {},               // { techId: true }
    obras: [],                  // cola de construcción/mejora
    expediciones: [],           // exploradores fuera de la aldea

    world: { descubierto: {}, nodos: [], enemigos: [] },
    quests: { activas: [], completadas: [] },
    stats: { construidos: 0, recolectado: 0, batallasGanadas: 0, batallasPerdidas: 0, tiempoJugado: 0 },
    ajustes: { sonido: true, musica: true, calidad: 'auto', sombras: true }
  }
}

/** Sube partidas viejas a la versión actual sin perder el progreso. */
export function migrar (guardada) {
  let s = guardada
  if (!s || typeof s !== 'object') return nuevaPartida()
  const base = nuevaPartida(s.seed)
  // relleno defensivo: si una versión antigua no tenía un campo, se añade vacío
  s = { ...base, ...s }
  s.recursos = { ...base.recursos, ...s.recursos }
  s.almacen = { ...base.almacen, ...s.almacen }
  s.jugador = { ...base.jugador, ...s.jugador }
  s.ajustes = { ...base.ajustes, ...s.ajustes }
  s.version = CONFIG.VERSION
  return s
}

/** Instancia viva de la partida. Se importa en todas partes: import { game } from '...' */
export const game = { state: nuevaPartida() }

export function setState (nuevo) { game.state = nuevo }

// --- helpers de acceso, para no repetir búsquedas por todo el código ---
export const getBuilding = (id) => game.state.buildings.find(b => b.id === id) || null
export const getVillager = (id) => game.state.villagers.find(v => v.id === id) || null
export const buildingsDe = (tipo) => game.state.buildings.filter(b => b.tipo === tipo && (b.nivel || 0) > 0)
export const contarTipo = (tipo) => game.state.buildings.filter(b => b.tipo === tipo).length
export const nuevoId = uid
