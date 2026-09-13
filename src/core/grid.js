import { CONFIG } from './config.js'

/**
 * Utilidades del tablero de la aldea. Coordenadas en CASILLAS (enteros 0..GRID-1).
 * El render convierte a coordenadas de mundo con gridAMundo().
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

/** ¿Caben las casillas de un edificio de wxh en (x,z) sin salirse ni solaparse? */
export function huecoLibre (state, x, z, ancho, alto, ignorarId = null) {
  if (!dentro(x, z) || !dentro(x + ancho - 1, z + alto - 1)) return false
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
