import { CONFIG } from './config.js'

/**
 * Utilidades del tablero de la aldea. Coordenadas en CASILLAS (enteros 0..GRID-1).
 * El render convierte a coordenadas de mundo con gridAMundo().
 *
 * EL TABLERO CRECE. El valle entero mide GRID x GRID, pero no todo es tuyo: se
 * reparte en PARCELAS cuadradas y solo se construye en las que has ganado. Las
 * demás se ven (hierba alta, bosque, ruinas) pero están en barbecho hasta que
 * las conquistes, las encuentres explorando o te las traiga una edad nueva.
 *
 * El territorio vive en `state.territorio.parcelas` como JSON puro:
 *   { '2,2': { estado:'mia'|'disponible', motivo, cuando, origen } }
 * Lo que no aparece ahí, no es tuyo. El dueño del estado es sim/buildings.js;
 * aquí solo hay geometría y consultas de solo lectura.
 */

export const dentro = (x, z) => x >= 0 && z >= 0 && x < CONFIG.GRID && z < CONFIG.GRID

/** Centro de la casilla en coordenadas de Three.js (el centro del tablero es el 0,0). */
export function gridAMundo (x, z) {
  const off = (CONFIG.GRID - 1) / 2
  return { x: (x - off) * CONFIG.CELDA, z: (z - off) * CONFIG.CELDA }
}

export function mundoAGrid (wx, wz) {
  const off = (CONFIG.GRID - 1) / 2
  return { x: Math.round(wx / CONFIG.CELDA + off), z: Math.round(wz / CONFIG.CELDA + off) }
}

// ── Parcelas: el tablero repartido ───────────────────────────────────────

export const LADO_PARCELA = CONFIG.PARCELA || CONFIG.GRID
/** Cuántas parcelas por lado. Con GRID 60 y parcelas de 12: cinco. */
export const PARCELAS = Math.max(1, Math.round(CONFIG.GRID / LADO_PARCELA))

export const idParcela = (px, pz) => `${px},${pz}`
/** 'px,pz' -> { px, pz }. Devuelve null si el texto no es un id válido. */
export function coordsParcela (id) {
  const p = String(id).split(',')
  const px = Number(p[0]); const pz = Number(p[1])
  if (!Number.isInteger(px) || !Number.isInteger(pz)) return null
  if (px < 0 || pz < 0 || px >= PARCELAS || pz >= PARCELAS) return null
  return { px, pz }
}

/** Parcela a la que pertenece una casilla. null si la casilla se sale del valle. */
export function parcelaDe (x, z) {
  if (!dentro(x, z)) return null
  const px = Math.floor(x / LADO_PARCELA)
  const pz = Math.floor(z / LADO_PARCELA)
  return { px, pz, id: idParcela(px, pz) }
}

/** Rectángulo de casillas de una parcela: { x, z, ancho, alto }. */
export function rectParcela (id) {
  const c = coordsParcela(id)
  if (!c) return null
  const x = c.px * LADO_PARCELA
  const z = c.pz * LADO_PARCELA
  return {
    x,
    z,
    ancho: Math.min(LADO_PARCELA, CONFIG.GRID - x),
    alto: Math.min(LADO_PARCELA, CONFIG.GRID - z)
  }
}

/** Casilla central de una parcela: a dónde vuela la cámara al conquistarla. */
export function centroParcela (id) {
  const r = rectParcela(id)
  return r ? { x: r.x + (r.ancho - 1) / 2, z: r.z + (r.alto - 1) / 2 } : null
}

/** La del medio del valle: donde nace tu baluarte. */
export const PARCELA_CENTRAL = idParcela((PARCELAS - 1) >> 1, (PARCELAS - 1) >> 1)

/**
 * Las parcelas con las que empieza la partida: el bloque de 3x3 del centro.
 * Son 36x36 casillas, un pelo más de lo que tenía el tablero fijo de antes, así
 * que una partida vieja cabe entera sin perder un solo edificio.
 */
export const NUCLEO = (() => {
  const c = (PARCELAS - 1) >> 1
  const ids = []
  for (let pz = Math.max(0, c - 1); pz <= Math.min(PARCELAS - 1, c + 1); pz++) {
    for (let px = Math.max(0, c - 1); px <= Math.min(PARCELAS - 1, c + 1); px++) {
      ids.push(idParcela(px, pz))
    }
  }
  return ids
})()

/** El territorio de partida, listo para meter en el estado. */
export function territorioInicial (cuando = Date.now()) {
  const parcelas = {}
  for (const id of NUCLEO) parcelas[id] = { estado: 'mia', motivo: 'inicio', cuando }
  return { parcelas, siguienteEdad: 0 }
}

/** Mapa de parcelas del estado. Si la partida aún no lo tiene, vale el núcleo. */
function mapaParcelas (state) {
  const p = state && state.territorio && state.territorio.parcelas
  return (p && typeof p === 'object') ? p : NUCLEO_POR_DEFECTO
}
const NUCLEO_POR_DEFECTO = territorioInicial(0).parcelas

export const parcelaEsMia = (state, id) => (mapaParcelas(state)[id] || {}).estado === 'mia'
export const parcelaDisponible = (state, id) => (mapaParcelas(state)[id] || {}).estado === 'disponible'

/** Ids de todas tus parcelas. */
export function parcelasMias (state) {
  const m = mapaParcelas(state)
  return Object.keys(m).filter(id => m[id].estado === 'mia')
}
export const cuantasParcelas = (state) => parcelasMias(state).length
/** Casillas de terreno que ya son tuyas: la medida honrada de "cuánto has crecido". */
export const casillasDeTerritorio = (state) =>
  parcelasMias(state).reduce((a, id) => { const r = rectParcela(id); return a + (r ? r.ancho * r.alto : 0) }, 0)

/** ¿Esta casilla es terreno tuyo? */
export function esTerritorio (state, x, z) {
  const p = parcelaDe(x, z)
  return !!p && parcelaEsMia(state, p.id)
}

/** ¿El rectángulo entero cae dentro de lo tuyo? Un edificio no se parte en dos reinos. */
export function territorioLibre (state, x, z, ancho, alto) {
  for (let i = 0; i < ancho; i++) {
    for (let j = 0; j < alto; j++) {
      if (!esTerritorio(state, x + i, z + j)) return false
    }
  }
  return true
}

/**
 * Rectángulo de casillas que ocupa TODO tu territorio: { x0, z0, x1, z1 }.
 * Útil para no recorrer el valle entero cuando solo importa lo tuyo (pathing,
 * campos de flujo del combate, encuadres de cámara). Con el valle de 60x60,
 * hacer un barrido completo cuesta tres veces más que con el tablero viejo.
 */
export function limitesDelTerritorio (state) {
  let x0 = CONFIG.GRID; let z0 = CONFIG.GRID; let x1 = 0; let z1 = 0
  for (const id of parcelasMias(state)) {
    const r = rectParcela(id)
    if (!r) continue
    if (r.x < x0) x0 = r.x
    if (r.z < z0) z0 = r.z
    if (r.x + r.ancho - 1 > x1) x1 = r.x + r.ancho - 1
    if (r.z + r.alto - 1 > z1) z1 = r.z + r.alto - 1
  }
  if (x1 < x0) return { x0: 0, z0: 0, x1: CONFIG.GRID - 1, z1: CONFIG.GRID - 1 }
  return { x0, z0, x1, z1 }
}

/** Parcelas pegadas a las tuyas que todavía no lo son: por ahí crece el reino. */
export function fronteraDe (state) {
  const mias = parcelasMias(state)
  const fuera = new Set()
  for (const id of mias) {
    const c = coordsParcela(id)
    if (!c) continue
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const px = c.px + dx; const pz = c.pz + dz
      if (px < 0 || pz < 0 || px >= PARCELAS || pz >= PARCELAS) continue
      const vid = idParcela(px, pz)
      if (!parcelaEsMia(state, vid)) fuera.add(vid)
    }
  }
  return [...fuera]
}

/** ¿Caben las casillas de un edificio de wxh en (x,z) sin salirse ni solaparse? */
export function huecoLibre (state, x, z, ancho, alto, ignorarId = null) {
  if (!dentro(x, z) || !dentro(x + ancho - 1, z + alto - 1)) return false
  // El territorio manda: en barbecho no se levanta nada. Va aquí a propósito,
  // porque esta función la llaman el fantasma, la interfaz y la simulación.
  if (!territorioLibre(state, x, z, ancho, alto)) return false
  for (const b of state.buildings) {
    if (b.id === ignorarId) continue
    const s = tamañoDe(b)
    if (x < b.x + s.ancho && x + ancho > b.x && z < b.z + s.alto && z + alto > b.z) return false
  }
  return true
}

/** Tamaño en casillas de un edificio ya colocado. El catálogo manda. */
export function tamañoDe (b) {
  return { ancho: b.ancho ?? 2, alto: b.alto ?? 2 }
}

/** Casilla central de un edificio, útil para que los aldeanos caminen hacia él. */
export function centroDe (b) {
  const s = tamañoDe(b)
  return { x: b.x + (s.ancho - 1) / 2, z: b.z + (s.alto - 1) / 2 }
}

export const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz)

/** Vecinas en cruz (para caminos y pathing). */
export const vecinas = (x, z) => [
  { x: x + 1, z }, { x: x - 1, z }, { x, z: z + 1 }, { x, z: z - 1 }
].filter(c => dentro(c.x, c.z))
