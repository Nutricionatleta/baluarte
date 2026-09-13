import * as THREE from 'three'
import { PALETA } from '../core/config.js'

/**
 * Materiales y geometrías COMPARTIDOS.
 *
 * En un móvil, cada material nuevo es un programa de sombreado más que compilar
 * y un cambio de estado más por frame. Con cientos de edificios y aldeanos eso
 * se nota en fluidez y en batería. Aquí se crean una sola vez y se reparten.
 *
 * Regla: nadie hace `new THREE.MeshLambertMaterial` fuera de este fichero.
 */

const cache = new Map()

/**
 * Material plano low-poly del color que pidas.
 * @param {number} color hexadecimal, preferiblemente de PALETA
 * @param {{ emisivo?: number, transparente?: number, plano?: boolean }} [opts]
 */
export function mat (color, opts = {}) {
  const clave = `${color}|${opts.emisivo ?? 0}|${opts.transparente ?? 1}|${opts.plano ?? 1}`
  if (cache.has(clave)) return cache.get(clave)
  const m = new THREE.MeshLambertMaterial({
    color,
    flatShading: opts.plano !== false,          // las caras planas son la firma del estilo
    emissive: opts.emisivo ?? 0x000000,
    transparent: (opts.transparente ?? 1) < 1,
    opacity: opts.transparente ?? 1
  })
  cache.set(clave, m)
  return m
}

/** Atajos con los colores de la paleta ya puestos. */
export const M = {
  get hierba () { return mat(PALETA.hierba) },
  get hierbaOscura () { return mat(PALETA.hierbaOscura) },
  get tierra () { return mat(PALETA.tierra) },
  get camino () { return mat(PALETA.camino) },
  get agua () { return mat(PALETA.agua, { transparente: 0.85 }) },
  get madera () { return mat(PALETA.madera) },
  get maderaClara () { return mat(PALETA.maderaClara) },
  get piedra () { return mat(PALETA.piedra) },
  get piedraOscura () { return mat(PALETA.piedraOscura) },
  get tejado () { return mat(PALETA.tejado) },
  get paja () { return mat(PALETA.paja) },
  get yeso () { return mat(PALETA.yeso) },
  get hierro () { return mat(PALETA.hierro) },
  get oro () { return mat(PALETA.oro, { emisivo: 0x332200 }) },
  get tela () { return mat(PALETA.tela) },
  get copaPino () { return mat(PALETA.copaPino) },
  get copaRoble () { return mat(PALETA.copaRoble) },
  get tronco () { return mat(PALETA.tronco) },
  get trigo () { return mat(PALETA.trigo) },
  /** Fantasma verde/rojo para previsualizar dónde se coloca un edificio. */
  get fantasmaOk () { return mat(0x6ee06e, { transparente: 0.55 }) },
  get fantasmaMal () { return mat(0xe06e6e, { transparente: 0.55 }) },
  /** Andamios: lo que se ve mientras el edificio está en obra. */
  get andamio () { return mat(PALETA.maderaClara) }
}

// ── Geometrías básicas, también compartidas ──────────────────────────────
// Todas de tamaño 1 y centradas: se escalan y colocan con mesh.scale/position.
const geoCache = new Map()
const geo = (clave, crear) => {
  if (!geoCache.has(clave)) geoCache.set(clave, crear())
  return geoCache.get(clave)
}

export const G = {
  get caja () { return geo('caja', () => new THREE.BoxGeometry(1, 1, 1)) },
  get cono () { return geo('cono', () => new THREE.ConeGeometry(0.5, 1, 4)) },          // pirámide: tejado
  get cono6 () { return geo('cono6', () => new THREE.ConeGeometry(0.5, 1, 6)) },
  get cono8 () { return geo('cono8', () => new THREE.ConeGeometry(0.5, 1, 8)) },
  get cilindro () { return geo('cil', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 8)) },
  get cilindro6 () { return geo('cil6', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 6)) },
  get tronco () { return geo('troncoG', () => new THREE.CylinderGeometry(0.35, 0.5, 1, 6)) },
  get esfera () { return geo('esf', () => new THREE.IcosahedronGeometry(0.5, 0)) },     // roca low-poly
  get esfera1 () { return geo('esf1', () => new THREE.IcosahedronGeometry(0.5, 1)) },
  get plano () { return geo('plano', () => new THREE.PlaneGeometry(1, 1)) }
}

/**
 * Crea una malla de un tirón: `pieza(G.caja, M.madera, {x,y,z, sx,sy,sz, ry})`.
 * Es el ladrillo con el que se construye todo el arte del juego.
 */
export function pieza (geometria, material, o = {}) {
  const m = new THREE.Mesh(geometria, material)
  m.position.set(o.x || 0, o.y || 0, o.z || 0)
  m.scale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1)
  if (o.rx) m.rotation.x = o.rx
  if (o.ry) m.rotation.y = o.ry
  if (o.rz) m.rotation.z = o.rz
  m.castShadow = o.sombra !== false
  m.receiveShadow = o.recibe !== false
  return m
}

/** Agrupa piezas: `grupo([pieza(...), pieza(...)])`. */
export function grupo (piezas = []) {
  const g = new THREE.Group()
  for (const p of piezas) if (p) g.add(p)
  return g
}
