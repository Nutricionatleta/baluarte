import { CONFIG } from './config.js'
import { uid } from './rng.js'
import { territorioInicial, NUCLEO } from './grid.js'

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

    // El valle entero es de 60x60, pero solo estas parcelas son tuyas. Las demás
    // se ganan conquistando comarcas, explorando o al cambiar de edad.
    territorio: territorioInicial(ahora),

    world: { descubierto: {}, nodos: [], enemigos: [] },
    quests: { activas: [], completadas: [] },
    stats: { construidos: 0, recolectado: 0, batallasGanadas: 0, batallasPerdidas: 0, tiempoJugado: 0 },
    ajustes: { sonido: true, musica: true, calidad: 'auto', sombras: true }
  }
}

/**
 * El tablero fijo de antes: 34x34 casillas. Una partida guardada con esa medida
 * hay que recentrarla en el valle nuevo, que es más grande.
 */
const GRID_VIEJO = 34
const DESPLAZAMIENTO = Math.round((CONFIG.GRID - GRID_VIEJO) / 2)

/**
 * Partidas del tablero fijo: se corren al centro del valle nuevo y se quedan
 * con las nueve parcelas del núcleo desbloqueadas. Todo lo construido sigue en
 * pie y en el mismo sitio relativo; lo que cambia es que ahora hay sitio fuera.
 */
function recentrarTableroViejo (s) {
  if (DESPLAZAMIENTO <= 0) return
  // Si algo ya se sale del tablero viejo, la partida no es de las antiguas.
  for (const b of s.buildings || []) {
    if ((b.x || 0) + (b.ancho ?? 2) > GRID_VIEJO || (b.z || 0) + (b.alto ?? 2) > GRID_VIEJO) return
  }
  for (const b of s.buildings || []) { b.x = (b.x || 0) + DESPLAZAMIENTO; b.z = (b.z || 0) + DESPLAZAMIENTO }
  for (const v of s.villagers || []) {
    if (typeof v.x === 'number') v.x += DESPLAZAMIENTO
    if (typeof v.z === 'number') v.z += DESPLAZAMIENTO
    if (v.destino) {
      if (typeof v.destino.x === 'number') v.destino.x += DESPLAZAMIENTO
      if (typeof v.destino.z === 'number') v.destino.z += DESPLAZAMIENTO
    }
  }
}

/** Sube partidas viejas a la versión actual sin perder el progreso. */
export function migrar (guardada) {
  let s = guardada
  if (!s || typeof s !== 'object') return nuevaPartida()
  // Ojo: hay que preguntarlo ANTES del relleno defensivo de abajo, porque el
  // spread le pega el territorio de la partida nueva y ya no se nota que venía
  // del tablero fijo de 34x34.
  const delTableroViejo = !s.territorio || !s.territorio.parcelas
  const base = nuevaPartida(s.seed)
  // relleno defensivo: si una versión antigua no tenía un campo, se añade vacío
  s = { ...base, ...s }
  s.recursos = { ...base.recursos, ...s.recursos }
  s.almacen = { ...base.almacen, ...s.almacen }
  s.jugador = { ...base.jugador, ...s.jugador }
  s.ajustes = { ...base.ajustes, ...s.ajustes }

  // --- territorio: quien no lo tenía venía del tablero fijo de 34x34 ---
  if (delTableroViejo) {
    recentrarTableroViejo(s)
    s.territorio = territorioInicial(Date.now())
  } else {
    // Red de seguridad: el núcleo SIEMPRE es tuyo, pase lo que pase con el
    // guardado. Sin esto un fichero a medio escribir te deja sin aldea.
    if (typeof s.territorio.parcelas !== 'object') s.territorio.parcelas = {}
    for (const id of NUCLEO) {
      if (!s.territorio.parcelas[id]) s.territorio.parcelas[id] = { estado: 'mia', motivo: 'inicio', cuando: s.creada || Date.now() }
    }
    s.territorio.siguienteEdad = s.territorio.siguienteEdad || 0
  }

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
