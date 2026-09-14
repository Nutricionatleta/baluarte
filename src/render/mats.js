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
  /**
   * Pirámide de base CUADRADA y alineada con los ejes (el cono de 4 lados nace
   * girado 45°). Así se puede escalar en X y en Z por separado y sale un tejado
   * a cuatro aguas de verdad; girando el objeto en vez de la geometría salía un
   * rombo escorado, porque la escala se aplica antes que el giro.
   */
  get piramide () {
    return geo('piramide', () => {
      const g = new THREE.ConeGeometry(0.5, 1, 4)
      g.rotateY(Math.PI / 4)
      return g
    })
  },
  get cono6 () { return geo('cono6', () => new THREE.ConeGeometry(0.5, 1, 6)) },
  get cono8 () { return geo('cono8', () => new THREE.ConeGeometry(0.5, 1, 8)) },
  get cilindro () { return geo('cil', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 8)) },
  get cilindro6 () { return geo('cil6', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 6)) },
  /** Torreones, pozos y chimeneas: con 12 caras el cilindro ya se lee redondo. */
  get cilindro12 () { return geo('cil12', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 12)) },
  /** Fuste que se estrecha: molinos y torres con entasis. */
  get fuste12 () { return geo('fus12', () => new THREE.CylinderGeometry(0.42, 0.5, 1, 12)) },
  get tronco () { return geo('troncoG', () => new THREE.CylinderGeometry(0.35, 0.5, 1, 6)) },
  get esfera () { return geo('esf', () => new THREE.IcosahedronGeometry(0.5, 0)) },     // roca low-poly
  get esfera1 () { return geo('esf1', () => new THREE.IcosahedronGeometry(0.5, 1)) },
  get plano () { return geo('plano', () => new THREE.PlaneGeometry(1, 1)) },
  /**
   * Medio cilindro tumbado: vale a la vez de ARCO DE MEDIO PUNTO (puertas y
   * ventanas) y de BÓVEDA DE CAÑÓN (el tejado del almacén). Unidad: 1 de luz,
   * 0.5 de flecha, 1 de grosor; el arranque del arco está en y=0.
   */
  get arco () {
    return geo('arco', () => {
      const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, false, 0, Math.PI)
      g.rotateZ(Math.PI / 2)      // la media luna queda mirando hacia arriba
      g.rotateY(Math.PI / 2)      // y el eje del cilindro pasa a ser Z (el grosor)
      return g
    })
  },
  /** Media esfera facetada: cúpulas de cobre y remates de torre. */
  get cupula () { return geo('cupula', () => new THREE.SphereGeometry(0.5, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2)) }
}

/**
 * CAJA CON LOS CANTOS VERTICALES ACHAFLANADOS.
 *
 * Es el cambio que más se nota a simple vista: un edificio hecho de cajas
 * peladas se ve tosco, y el mismo edificio con las cuatro aristas cortadas se
 * ve "modelado" sin perder ni una cara plana. Cuesta 28 triángulos en vez de
 * 12, así que se reserva para los VOLÚMENES GRANDES (muros, zócalos, torres);
 * los detallitos siguen con `G.caja`.
 *
 * La geometría se genera al tamaño real (no se escala) para que el chaflán
 * mida lo mismo en los tres ejes, y se cachea por tamaño: como los modelos se
 * montan una vez por tipo+nivel, la caché se llena enseguida y no crece más.
 */
const cacheChaflan = new Map()

export function geoCajaCh (sx, sy, sz, ch = 0.08) {
  const c = Math.max(0.02, Math.min(ch, sx * 0.32, sz * 0.32))
  const k = `${sx.toFixed(2)}|${sy.toFixed(2)}|${sz.toFixed(2)}|${c.toFixed(3)}`
  const hecha = cacheChaflan.get(k)
  if (hecha) return hecha
  // Cada tamaño genera su geometría, y los tamaños cambian con el nivel. Como
  // los modelos ya se cachean por tipo+nivel, la caché se estabiliza sola; el
  // tope es solo un seguro para que un móvil no acumule memoria sin límite.
  if (cacheChaflan.size > 700) {
    for (const g of cacheChaflan.values()) g.dispose?.()
    cacheChaflan.clear()
  }
  const hx = sx / 2; const hz = sz / 2
  const s = new THREE.Shape()
  s.moveTo(-hx + c, -hz)
  s.lineTo(hx - c, -hz)
  s.lineTo(hx, -hz + c)
  s.lineTo(hx, hz - c)
  s.lineTo(hx - c, hz)
  s.lineTo(-hx + c, hz)
  s.lineTo(-hx, hz - c)
  s.lineTo(-hx, -hz + c)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: sy, bevelEnabled: false, curveSegments: 1, steps: 1 })
  g.rotateX(-Math.PI / 2)      // la extrusión sale en Z; la queremos en Y
  g.translate(0, -sy / 2, 0)   // centrada en el origen, como el resto de geometrías
  g.computeVertexNormals()
  cacheChaflan.set(k, g)
  return g
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
