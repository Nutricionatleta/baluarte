import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETA } from '../core/config.js'
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { gridAMundo, huecoLibre } from '../core/grid.js'
import { def } from '../data/buildings.js'
import { ctx, aEscena, onFrame, cuandoListo } from './ctx.js'
import { mat, M, G, pieza } from './mats.js'

/**
 * EL ASPECTO DE LA ALDEA.
 *
 * Los 25 edificios del catálogo montados a base de cajas, conos y cilindros:
 * cero archivos de arte, todo geometría. La regla de estilo es una sola —
 * maqueta de mesa low-poly, luminosa y facetada, pero medieval de verdad:
 * adobe con entramado, paja, teja roja, sillería, pizarra y tela al viento.
 *
 * Cómo está organizado:
 *   1. paletas por "escalón" (paja -> teja -> pizarra): es lo que hace que subir
 *      de nivel se VEA sin leer un número.
 *   2. helpers geométricos (tejados, entramado, banderas, barriles…).
 *   3. un constructor por tipo de edificio.
 *   4. cacheado: cada modelo se monta UNA vez por tipo+nivel+escalón y el resto
 *      son clones que comparten geometría y material.
 *   5. enganche con el estado: obra, mejora, derribo, ruina y fantasma.
 */

// ── ajustes de estilo ────────────────────────────────────────────────────
const PI = Math.PI

/** 0..3 según la edad (lo manda EV.EDAD_VISUAL). Reviste la aldea entera. */
let edadVisual = 0

/** Escalón visual: 0 madera y paja, 1 piedra y teja, 2 pizarra y oro. */
function escalon (nivel, maxNivel = 8) {
  const n = Math.max(1, nivel)
  if (maxNivel <= 1) return edadVisual >= 2 ? 1 : 0
  const r = (n - 1) / Math.max(1, maxNivel - 1)
  let e = r >= 0.62 ? 2 : r >= 0.28 ? 1 : 0
  if (edadVisual >= 3 && e < 2) e++
  return e
}

const cachePaleta = new Map()

/** Materiales del escalón. Se comparten: nadie crea materiales por edificio. */
function paletaDe (t) {
  if (cachePaleta.has(t)) return cachePaleta.get(t)
  const comun = {
    madera: M.madera,
    maderaClara: M.maderaClara,
    viga: mat(PALETA.entramado),
    metal: M.hierro,
    oro: M.oro,
    tela: M.tela,
    telaVerde: mat(PALETA.telaVerde),
    telaAzul: mat(PALETA.telaAzul),
    telaCruda: mat(PALETA.telaCruda),
    tierra: M.tierra,
    tronco: M.tronco,
    piedra: M.piedra,
    piedraOscura: M.piedraOscura,
    trigo: M.trigo,
    hierba: M.hierbaOscura,
    carbon: mat(PALETA.carbon),
    ceniza: mat(PALETA.ceniza),
    fuego: mat(PALETA.fuego, { emisivo: 0x772200 }),
    brasa: mat(PALETA.brasa, { emisivo: 0x885500 }),
    paja: M.paja,
    andamio: M.andamio
  }
  const porEscalon = [
    { muro: mat(PALETA.adobe), muroAlt: M.madera, zocalo: M.piedraOscura, techo: M.paja, techoAlt: mat(PALETA.tejadoOscuro), remate: M.madera, suelo: M.tierra },
    { muro: M.yeso, muroAlt: mat(PALETA.adobe), zocalo: M.piedra, techo: mat(PALETA.tejado), techoAlt: mat(PALETA.tejadoOscuro), remate: M.piedra, suelo: M.camino },
    { muro: M.piedra, muroAlt: M.piedraOscura, zocalo: M.piedraOscura, techo: mat(PALETA.pizarra), techoAlt: mat(PALETA.pizarraClara), remate: M.oro, suelo: M.camino }
  ]
  const p = { ...comun, ...porEscalon[Math.min(2, Math.max(0, t))], t }
  cachePaleta.set(t, p)
  return p
}

// ── helpers geométricos (la `y` que reciben SIEMPRE es la base, no el centro) ──

/** Caja apoyada en `y`. El ladrillo con el que está hecho el 80 % del juego. */
const caja = (m, x, y, z, sx, sy, sz, ry = 0) => pieza(G.caja, m, { x, y: y + sy / 2, z, sx, sy, sz, ry })

const cil = (m, x, y, z, d, h, ry = 0) => pieza(G.cilindro, m, { x, y: y + h / 2, z, sx: d, sy: h, sz: d, ry })
const cil6 = (m, x, y, z, d, h, ry = 0) => pieza(G.cilindro6, m, { x, y: y + h / 2, z, sx: d, sy: h, sz: d, ry })
const leno = (m, x, y, z, d, h, ry = 0) => pieza(G.tronco, m, { x, y: y + h / 2, z, sx: d, sy: h, sz: d, ry })
/** Tronco tumbado, apoyado en `y`: a lo largo de X o de Z. */
const lenoX = (m, x, y, z, d, largo) => pieza(G.tronco, m, { x, y: y + d / 2, z, sx: d, sy: largo, sz: d, rz: PI / 2 })
const lenoZ = (m, x, y, z, d, largo) => pieza(G.tronco, m, { x, y: y + d / 2, z, sx: d, sy: largo, sz: d, rx: PI / 2 })
const roca = (m, x, y, z, d, ry = 0) => pieza(G.esfera, m, { x, y: y + d * 0.32, z, sx: d, sy: d * 0.8, sz: d, ry })

/** Tejado piramidal de base cuadrada (torres y torreones). */
const techo4 = (m, x, y, z, lado, alt, ry = PI / 4) =>
  pieza(G.cono, m, { x, y: y + alt / 2, z, sx: lado * 1.4143, sy: alt, sz: lado * 1.4143, ry })

/** Tejado cónico: la silueta que dice "torreón" desde lejos. */
const techoCono = (m, x, y, z, d, alt) => pieza(G.cono8, m, { x, y: y + alt / 2, z, sx: d, sy: alt, sz: d })

/** Triángulo del hastial: un cono de 4 lados aplastado en Z es exactamente eso. */
const hastial = (m, x, y, z, ancho, alt, gro = 0.16) =>
  pieza(G.cono, m, { x, y: y + alt / 2, z, sx: ancho, sy: alt, sz: gro })

/**
 * Tejado a dos aguas: dos losas inclinadas con vuelo. El caballete corre en Z,
 * así que los hastiales miran a ±Z.
 */
function techo2Aguas (m, x, y, z, ancho, prof, alt, vuelo = 0.16) {
  const g = new THREE.Group()
  const ang = Math.atan2(alt, ancho / 2)
  const largo = Math.hypot(ancho / 2, alt) + vuelo
  const gro = 0.11
  g.add(pieza(G.caja, m, { x: -ancho / 4, y: alt / 2, z: 0, sx: largo, sy: gro, sz: prof + vuelo * 2, rz: ang }))
  g.add(pieza(G.caja, m, { x: ancho / 4, y: alt / 2, z: 0, sx: largo, sy: gro, sz: prof + vuelo * 2, rz: -ang }))
  g.position.set(x, y, z)
  return g
}

/** Entramado de madera en una fachada. Cuatro piezas y ya parece medieval. */
function entramado (l, p, x, y, z, ancho, alt, prof) {
  const gro = 0.1
  const zf = z + prof / 2 + 0.015
  l.push(caja(p.viga, x, y + alt - gro, zf, ancho, gro, 0.05))
  l.push(caja(p.viga, x - ancho / 2 + gro / 2, y, zf, gro, alt, 0.05))
  l.push(caja(p.viga, x + ancho / 2 - gro / 2, y, zf, gro, alt, 0.05))
  l.push(pieza(G.caja, p.viga, {
    x, y: y + alt / 2, z: zf, sx: Math.hypot(ancho, alt) * 0.92, sy: gro, sz: 0.05, rz: Math.atan2(alt, ancho)
  }))
}

/** Almenas sobre un muro: la firma de la piedra de nivel alto. */
function almenas (l, m, x, y, z, largo, prof, paso = 0.36, alt = 0.2, enZ = false) {
  const n = Math.max(3, Math.round(largo / paso) | 1)
  const d = largo / n
  for (let i = 0; i < n; i += 2) {
    const o = -largo / 2 + d / 2 + i * d
    l.push(enZ ? caja(m, x, y, z + o, prof, alt, d * 0.92) : caja(m, x + o, y, z, d * 0.92, alt, prof))
  }
}

/** Estandarte con la tela viva: el grupo `tela` pivota en lo alto del mástil. */
function bandera (p, mTela, x, y, z, alt = 1.0, ancho = 0.46) {
  const g = new THREE.Group()
  g.add(caja(p.madera, 0, 0, 0, 0.06, alt, 0.06))
  g.add(pieza(G.esfera, p.oro, { x: 0, y: alt + 0.05, z: 0, sx: 0.12, sy: 0.14, sz: 0.12 }))
  const tela = new THREE.Group()
  tela.position.set(0, alt - 0.08, 0)
  tela.add(caja(mTela, ancho / 2 + 0.04, -0.44, 0, ancho, 0.44, 0.04))
  tela.add(hastial(mTela, ancho / 2 + 0.04, -0.62, 0, ancho, 0.18, 0.04))
  tela.userData.anim = 'bandera'
  g.add(tela)
  g.position.set(x, y, z)
  return g
}

/** Toldo de tela inclinado que respira con el viento. */
function toldo (mTela, x, y, z, ancho, prof, ry = 0) {
  const g = new THREE.Group()
  g.add(pieza(G.caja, mTela, { x: 0, y: 0, z: 0, sx: ancho, sy: 0.05, sz: prof, rx: 0.32 }))
  g.userData.anim = 'toldo'
  g.position.set(x, y, z)
  g.rotation.y = ry
  return g
}

const barril = (p, x, y, z, s = 1) => cil6(p.madera, x, y, z, 0.26 * s, 0.34 * s)
const cajon = (p, x, y, z, s = 0.3) => caja(p.maderaClara, x, y, z, s, s * 0.8, s)

/** Montón de leña: dos filas cruzadas de troncos. */
function lena (l, p, x, y, z) {
  for (let i = 0; i < 3; i++) l.push(lenoX(p.madera, x, y, z - 0.18 + i * 0.18, 0.17, 0.62))
  for (let i = 0; i < 2; i++) l.push(lenoZ(p.madera, x - 0.09 + i * 0.18, y + 0.17, z, 0.17, 0.62))
}

/** Hoguera con llama viva (la llama se salta en calidad baja). */
function hoguera (l, p, x, y, z, det) {
  for (let i = 0; i < 3; i++) {
    l.push(pieza(G.tronco, p.madera, {
      x: x + Math.cos(i * 2.1) * 0.12, y: y + 0.08, z: z + Math.sin(i * 2.1) * 0.12,
      sx: 0.1, sy: 0.34, sz: 0.1, rz: 0.5, ry: i * 2.1
    }))
  }
  l.push(roca(p.piedraOscura, x + 0.26, y, z, 0.18))
  l.push(roca(p.piedraOscura, x - 0.26, y, z + 0.1, 0.18))
  if (!det) return
  const llama = pieza(G.cono6, p.fuego, { x, y: y + 0.34, z, sx: 0.26, sy: 0.42, sz: 0.26 })
  llama.userData.anim = 'llama'
  llama.castShadow = false
  l.push(llama)
}

/** Rueda de carro, carreta y catapulta. */
const rueda = (p, x, y, z, d = 0.36) => pieza(G.cilindro6, p.madera, { x, y: y + d / 2, z, sx: d, sy: 0.09, sz: d, rz: PI / 2 })

// ── LOS 25 EDIFICIOS ─────────────────────────────────────────────────────
// Cada constructor recibe { p: paleta, n: nivel, t: escalón, det: detalles,
// ancho, alto } y devuelve una lista de piezas. Todo se monta sobre la
// plataforma, así que la base útil está en SUELO.

const SUELO = 0.09

function fAyuntamiento ({ p, n, t, det }) {
  const l = []
  const h = 1.05 + 0.06 * n
  const y = SUELO + 0.18
  l.push(caja(p.zocalo, 0, SUELO, 0, 3.5, 0.18, 3.1))
  l.push(caja(p.muro, 0, y, 0, 3.0, h, 2.6))
  if (t < 2) entramado(l, p, 0, y, 0, 3.0, h, 2.6)
  else almenas(l, p.muroAlt, 0, SUELO + 0.18, 1.5, 3.4, 0.2, 0.4, 0.18)
  l.push(techo2Aguas(p.techo, 0, y + h, 0, 3.25, 2.85, 0.8))
  l.push(hastial(p.muroAlt, 0, y + h, 1.42, 3.25, 0.8))
  l.push(hastial(p.muroAlt, 0, y + h, -1.42, 3.25, 0.8))
  // pórtico de entrada: dos columnas y un frontón, lo que le da empaque
  l.push(caja(p.madera, 0, y, 1.32, 0.8, 0.95, 0.08))
  l.push(caja(p.zocalo, 0, SUELO, 1.7, 1.5, 0.1, 0.5))
  l.push(cil(p.zocalo, -0.55, y, 1.6, 0.22, 0.95))
  l.push(cil(p.zocalo, 0.55, y, 1.6, 0.22, 0.95))
  l.push(caja(p.techoAlt, 0, y + 0.95, 1.58, 1.5, 0.12, 0.7))
  // torre del reloj: la silueta que lo hace inconfundible desde arriba
  const yt = y + h + 0.6
  l.push(caja(p.muro, 0, yt, -0.5, 0.95, 1.0 + 0.05 * n, 0.95))
  l.push(caja(p.viga, 0, yt + 0.98 + 0.05 * n, -0.5, 1.05, 0.1, 1.05))
  l.push(techo4(t >= 2 ? p.techo : p.techoAlt, 0, yt + 1.08 + 0.05 * n, -0.5, 1.15, 0.75))
  l.push(pieza(G.esfera, p.oro, { x: 0, y: yt + 1.9 + 0.05 * n, z: -0.5, sx: 0.18, sy: 0.24, sz: 0.18 }))
  if (det) {
    l.push(caja(p.oro, 0, yt + 0.35, -0.02, 0.42, 0.42, 0.06))    // esfera del reloj
    l.push(caja(p.carbon, -0.28, y + 0.45, 1.32, 0.24, 0.3, 0.04))
    l.push(caja(p.carbon, 0.28, y + 0.45, 1.32, 0.24, 0.3, 0.04))
  }
  if (t >= 1) {
    l.push(bandera(p, p.telaAzul, -1.35, y + h * 0.2, 1.3, 1.1))
    l.push(bandera(p, p.tela, 1.35, y + h * 0.2, 1.3, 1.1))
  }
  return l
}

function fCasa ({ p, n, t, det }) {
  const l = []
  const h = 0.72 + 0.07 * n
  const y = SUELO + 0.12
  l.push(caja(p.zocalo, 0, SUELO, 0, 1.55, 0.12, 1.45))
  l.push(caja(p.muro, 0, y, 0, 1.42, h, 1.32))
  if (t < 2) entramado(l, p, 0, y, 0, 1.42, h, 1.32)
  l.push(techo2Aguas(p.techo, 0, y + h, 0, 1.7, 1.5, 0.52 + 0.03 * n))
  l.push(hastial(p.muroAlt, 0, y + h, 0.72, 1.7, 0.52 + 0.03 * n))
  l.push(hastial(p.muroAlt, 0, y + h, -0.72, 1.7, 0.52 + 0.03 * n))
  l.push(caja(p.madera, -0.32, y, 0.68, 0.36, 0.56, 0.06))
  l.push(caja(p.oro, -0.2, y + 0.28, 0.72, 0.06, 0.06, 0.03))
  l.push(caja(p.carbon, 0.32, y + h * 0.45, 0.68, 0.3, 0.26, 0.04))
  l.push(caja(p.viga, 0.32, y + h * 0.45, 0.7, 0.34, 0.05, 0.05))
  l.push(caja(p.zocalo, 0.46, y + h * 0.35, -0.42, 0.32, 1.0, 0.32))   // chimenea
  l.push(caja(p.carbon, 0.46, y + h * 0.35 + 1.0, -0.42, 0.4, 0.09, 0.4))
  if (det) {
    l.push(barril(p, -0.58, SUELO, -0.5))
    lena(l, p, 0.35, SUELO, -0.62)
  }
  if (t >= 2) l.push(bandera(p, p.telaAzul, 0.62, y, 0.62, 0.7, 0.3))
  return l
}

function fSerreria ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 0.95 + 0.05 * n
  // el cobertizo va al fondo: lo que identifica la serrería tiene que quedar
  // FUERA del tejado, o desde arriba no se ve nada
  for (const x of [-1.05, 1.05]) for (const z of [-1.15, 0.05]) l.push(caja(p.madera, x, y, z, 0.16, h, 0.16))
  l.push(caja(p.muro, 0, y, -1.25, 2.4, h, 0.32))
  l.push(techo2Aguas(p.techo, 0, y + h, -0.55, 2.6, 1.6, 0.5))
  l.push(hastial(p.madera, 0, y + h, 0.25, 2.6, 0.5))
  // troncos apilados delante
  for (let i = 0; i < 3; i++) l.push(lenoX(p.tronco, 0.5, y, 0.55 + i * 0.32, 0.3, 1.7))
  l.push(lenoX(p.tronco, 0.5, y + 0.29, 0.71, 0.3, 1.7))
  l.push(lenoX(p.tronco, 0.5, y + 0.29, 1.03, 0.3, 1.7))
  // sierra circular sobre su banco, al descubierto
  l.push(caja(p.maderaClara, -0.9, y, 0.75, 0.95, 0.42, 0.75))
  l.push(pieza(G.cilindro, p.metal, { x: -0.9, y: y + 0.68, z: 0.75, sx: 0.68, sy: 0.05, sz: 0.68, rx: PI / 2 }))
  l.push(caja(p.metal, -0.9, y + 0.42, 0.75, 0.1, 0.28, 0.1))
  if (det) {
    for (let i = 0; i < 3; i++) l.push(caja(p.maderaClara, -0.55, y + i * 0.09, -0.7, 1.1, 0.08, 0.34, 0.08 * i))
    l.push(roca(p.paja, -1.15, y, -0.1, 0.36))
    l.push(barril(p, 1.15, y, -0.85))
  }
  if (t >= 1) l.push(bandera(p, p.telaVerde, 1.25, y, 1.25, 0.8, 0.3))
  return l
}

function fCantera ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  // el hoyo y la roca madre
  l.push(caja(p.tierra, -0.5, y - 0.04, -0.5, 1.7, 0.1, 1.7))
  l.push(roca(p.piedraOscura, -0.9, y, -0.9, 1.0, 0.4))
  l.push(roca(p.piedraOscura, -0.1, y, -1.0, 0.8, 1.1))
  l.push(roca(p.piedra, -1.05, y + 0.3, -0.3, 0.7, 0.6))
  // sillares cortados y bien apilados
  for (let i = 0; i < 3; i++) l.push(caja(p.piedra, 0.75, y + i * 0.26, 0.6, 0.62, 0.26, 0.5, 0.08 * i))
  l.push(caja(p.piedra, 0.75, y, 1.05, 0.62, 0.26, 0.4))
  l.push(caja(p.piedra, 0.1, y, 0.85, 0.5, 0.24, 0.44, 0.3))
  // grúa de madera para izar la piedra
  l.push(caja(p.madera, 0.9, y, -0.7, 0.16, 1.5, 0.16))
  l.push(pieza(G.caja, p.madera, { x: 0.5, y: y + 1.45, z: -0.7, sx: 1.2, sy: 0.12, sz: 0.12, rz: -0.18 }))
  l.push(caja(p.metal, 0.05, y + 0.95, -0.7, 0.04, 0.45, 0.04))
  l.push(caja(p.madera, 0.05, y + 0.75, -0.7, 0.3, 0.22, 0.3))
  // carretilla
  l.push(caja(p.maderaClara, -0.6, y + 0.24, 0.95, 0.55, 0.26, 0.4, 0.4))
  l.push(rueda(p, -0.85, y, 0.86, 0.3))
  l.push(pieza(G.caja, p.madera, { x: -0.35, y: y + 0.36, z: 1.06, sx: 0.5, sy: 0.06, sz: 0.06, ry: 0.4 }))
  if (det) {
    l.push(caja(p.metal, 0.35, y + 0.5, -0.3, 0.5, 0.06, 0.06, 0.8))   // pico apoyado
    l.push(roca(p.piedra, 0.3, y, -0.55, 0.3))
    l.push(roca(p.piedra, -0.15, y, 0.25, 0.24))
  }
  return l
}

function fGranja ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  l.push(caja(p.tierra, 0, y - 0.02, 0.15, 2.7, 0.08, 2.4))
  // bancales de trigo en franjas: se leen perfectamente desde arriba
  const franjas = det ? 5 : 3
  for (let i = 0; i < franjas; i++) {
    const z = -0.95 + (i * 2.2) / (franjas - 1)
    l.push(caja(p.trigo, 0, y + 0.02, z, 2.5, 0.22 + 0.02 * (i % 2) + 0.02 * n, 0.24))
    if (det) l.push(caja(p.tierra, 0, y, z + 0.22, 2.5, 0.05, 0.14))
  }
  // espantapájaros
  l.push(caja(p.madera, -0.95, y, -1.1, 0.09, 1.0, 0.09))
  l.push(caja(p.madera, -0.95, y + 0.68, -1.1, 0.8, 0.08, 0.08))
  l.push(caja(p.tela, -0.95, y + 0.62, -1.1, 0.42, 0.42, 0.2))
  l.push(pieza(G.esfera, p.paja, { x: -0.95, y: y + 1.08, z: -1.1, sx: 0.3, sy: 0.3, sz: 0.3 }))
  l.push(techo4(p.madera, -0.95, y + 1.2, -1.1, 0.46, 0.22))
  // cerca baja
  if (det) {
    for (let i = 0; i < 4; i++) l.push(caja(p.madera, -1.35 + i * 0.9, y, 1.35, 0.08, 0.42, 0.08))
    l.push(caja(p.madera, 0, y + 0.28, 1.35, 3.0, 0.06, 0.06))
    l.push(barril(p, 1.25, y, -1.2))
    l.push(roca(p.paja, 0.6, y, -1.25, 0.5))
  }
  if (t >= 1) {
    l.push(caja(p.muro, 1.05, y, -1.05, 0.8, 0.6, 0.7))
    l.push(techo2Aguas(p.techo, 1.05, y + 0.6, -1.05, 0.95, 0.85, 0.3))
  }
  return l
}

function fMinaOro ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  // el cerro con la bocamina
  l.push(roca(p.piedraOscura, 0, y, -0.85, 2.2, 0.3))
  l.push(roca(p.piedraOscura, -0.85, y, -0.2, 1.3, 1.0))
  l.push(roca(p.piedra, 0.85, y + 0.1, -0.5, 1.0, 0.6))
  l.push(caja(p.carbon, 0, y, 0.05, 0.85, 0.85, 0.5))
  l.push(caja(p.madera, -0.5, y, 0.3, 0.14, 1.0, 0.14))
  l.push(caja(p.madera, 0.5, y, 0.3, 0.14, 1.0, 0.14))
  l.push(caja(p.madera, 0, y + 1.0, 0.3, 1.25, 0.16, 0.2))
  // vetas de oro a la vista
  l.push(pieza(G.esfera, p.oro, { x: -0.95, y: y + 0.75, z: -0.55, sx: 0.28, sy: 0.2, sz: 0.28 }))
  l.push(pieza(G.esfera, p.oro, { x: 0.75, y: y + 0.55, z: -1.0, sx: 0.22, sy: 0.16, sz: 0.22 }))
  // vagoneta sobre raíles
  l.push(caja(p.madera, 0, y, 0.95, 0.1, 0.05, 1.3))
  l.push(caja(p.madera, 0.45, y, 0.95, 0.1, 0.05, 1.3))
  l.push(caja(p.metal, 0.22, y + 0.22, 1.15, 0.66, 0.4, 0.55))
  l.push(pieza(G.esfera, p.oro, { x: 0.22, y: y + 0.62, z: 1.15, sx: 0.4, sy: 0.2, sz: 0.34 }))
  l.push(rueda(p, 0, y, 1.35, 0.24))
  l.push(rueda(p, 0.45, y, 1.35, 0.24))
  if (det) {
    l.push(caja(p.madera, -1.15, y, 0.9, 0.12, 0.9, 0.12))
    l.push(pieza(G.esfera, p.brasa, { x: -1.15, y: y + 0.95, z: 0.9, sx: 0.2, sy: 0.22, sz: 0.2 }))
    l.push(roca(p.piedra, 1.1, y, 0.7, 0.4))
  }
  if (t >= 2) l.push(techo2Aguas(p.techo, 0, y + 1.16, 0.3, 1.5, 0.9, 0.35))
  return l
}

function fMolino ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 1.45 + 0.11 * n
  l.push(cil6(p.zocalo, 0, y, 0, 1.3, 0.16))
  l.push(pieza(G.tronco, p.muro, { x: 0, y: y + 0.16 + h / 2, z: 0, sx: 1.15, sy: h, sz: 1.15 }))
  l.push(cil6(p.viga, 0, y + 0.16 + h * 0.55, 0, 1.02, 0.1))
  l.push(techoCono(p.techo, 0, y + 0.16 + h, 0, 1.15, 0.7))
  l.push(caja(p.madera, 0, y + 0.16, 0.52, 0.34, 0.6, 0.08))
  l.push(caja(p.carbon, 0, y + 0.16 + h * 0.6, 0.46, 0.22, 0.24, 0.06))
  // aspas: giran de verdad (onFrame), es el detalle que da vida a la aldea
  const aspas = new THREE.Group()
  aspas.position.set(0, y + 0.16 + h * 0.84, 0.58)
  aspas.userData.anim = 'aspas'
  aspas.add(pieza(G.cilindro, p.viga, { x: 0, y: 0, z: -0.06, sx: 0.22, sy: 0.22, sz: 0.22, rx: PI / 2 }))
  for (let i = 0; i < 4; i++) {
    const brazo = new THREE.Group()
    brazo.rotation.z = (i * PI) / 2
    brazo.add(caja(p.madera, 0, 0.06, 0, 0.1, 1.35, 0.05))
    brazo.add(caja(p.telaCruda, 0.13, 0.3, -0.02, 0.26, 0.95, 0.03))
    aspas.add(brazo)
  }
  l.push(aspas)
  if (det) {
    l.push(roca(p.paja, -0.72, y, 0.6, 0.42))
    l.push(roca(p.paja, -0.5, y, 0.82, 0.36))
    l.push(barril(p, 0.75, y, -0.6))
  }
  return l
}

function fAlmacen ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 0.95 + 0.05 * n
  l.push(caja(p.zocalo, 0, y, 0, 2.6, 0.14, 2.2))
  l.push(caja(p.muro, 0, y + 0.14, 0, 2.4, h, 2.0))
  l.push(techo2Aguas(p.techo, 0, y + 0.14 + h, 0, 2.75, 2.3, 0.62))
  l.push(hastial(p.muroAlt, 0, y + 0.14 + h, 1.12, 2.75, 0.62))
  l.push(hastial(p.muroAlt, 0, y + 0.14 + h, -1.12, 2.75, 0.62))
  // portón grande con refuerzos en aspa
  l.push(caja(p.madera, 0, y + 0.14, 1.02, 1.3, 1.0, 0.08))
  l.push(pieza(G.caja, p.viga, { x: 0, y: y + 0.64, z: 1.08, sx: 1.5, sy: 0.08, sz: 0.04, rz: 0.62 }))
  l.push(pieza(G.caja, p.viga, { x: 0, y: y + 0.64, z: 1.08, sx: 1.5, sy: 0.08, sz: 0.04, rz: -0.62 }))
  // la mercancía a la vista: madera y piedra
  for (let i = 0; i < 3; i++) l.push(lenoX(p.tronco, -1.1, y + (i % 2) * 0.24, -0.55 + i * 0.24, 0.22, 0.8))
  l.push(caja(p.piedra, 1.3, y, 0.5, 0.5, 0.24, 0.44))
  l.push(caja(p.piedra, 1.3, y + 0.24, 0.5, 0.44, 0.22, 0.4, 0.2))
  if (det) {
    l.push(barril(p, 1.25, y, -0.6))
    l.push(barril(p, 1.25, y, -1.0))
    l.push(barril(p, 1.25, y + 0.34, -0.8))
    l.push(cajon(p, -1.25, y, 0.95, 0.42))
  }
  if (t >= 1) l.push(bandera(p, p.telaVerde, -1.15, y + 0.14, 1.15, 0.9, 0.34))
  return l
}

function fGranero ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 1.0 + 0.06 * n
  // apoyado en pilares para que no suban los ratones
  for (const x of [-0.85, 0.85]) for (const z of [-0.75, 0.75]) l.push(cil6(p.zocalo, x, y, z, 0.3, 0.34))
  l.push(caja(p.madera, 0, y + 0.34, 0, 2.2, 0.14, 1.9))
  l.push(caja(p.muro, 0, y + 0.48, 0, 2.05, h, 1.75))
  if (t < 2) {
    l.push(caja(p.viga, 0, y + 0.48 + h * 0.5, 0.9, 2.05, 0.1, 0.06))
    l.push(caja(p.viga, 0, y + 0.48 + h - 0.1, 0.9, 2.05, 0.1, 0.06))
  }
  l.push(techo2Aguas(p.techo, 0, y + 0.48 + h, 0, 2.4, 2.05, 0.75))
  l.push(hastial(p.muroAlt, 0, y + 0.48 + h, 1.0, 2.4, 0.75))
  l.push(hastial(p.muroAlt, 0, y + 0.48 + h, -1.0, 2.4, 0.75))
  l.push(caja(p.madera, 0, y + 0.48, 0.9, 0.7, 0.8, 0.06))
  // escalera de acceso
  l.push(pieza(G.caja, p.madera, { x: 0, y: y + 0.2, z: 1.16, sx: 0.34, sy: 0.06, sz: 0.72, rx: 0.55 }))
  for (let i = 0; i < 3; i++) l.push(caja(p.maderaClara, 0, y + 0.08 + i * 0.11, 1.32 - i * 0.17, 0.4, 0.05, 0.06))
  if (det) {
    l.push(roca(p.paja, -1.15, y, 1.0, 0.46))
    l.push(roca(p.paja, -0.85, y, 1.2, 0.4))
    l.push(roca(p.trigo, 1.15, y, 1.05, 0.44))
    l.push(barril(p, 1.2, y, -1.1))
  }
  if (t >= 2) l.push(pieza(G.esfera, p.oro, { x: 0, y: y + 0.48 + h + 0.8, z: 0, sx: 0.2, sy: 0.24, sz: 0.2 }))
  return l
}

function fMercado ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  l.push(caja(p.suelo, 0, y - 0.02, 0, 2.8, 0.08, 2.8))
  const telas = [p.tela, p.telaVerde, p.telaAzul]
  const sitios = [[-0.85, -0.75, 0], [0.85, -0.75, 0], [-0.85, 0.85, 0.35]]
  for (let i = 0; i < (det ? 3 : 2); i++) {
    const [x, z, ry] = sitios[i]
    const h = 0.85 + 0.03 * n
    for (const dx of [-0.42, 0.42]) for (const dz of [-0.35, 0.35]) l.push(caja(p.madera, x + dx, y, z + dz, 0.08, h, 0.08))
    l.push(toldo(telas[i], x, y + h + 0.08, z, 1.15, 0.95, ry))
    l.push(caja(p.maderaClara, x, y, z + 0.3, 1.0, 0.5, 0.32))
    l.push(cajon(p, x - 0.25, y + 0.5, z + 0.3, 0.26))
    if (det) l.push(pieza(G.esfera, i === 1 ? p.trigo : p.tela, { x: x + 0.25, y: y + 0.62, z: z + 0.3, sx: 0.24, sy: 0.2, sz: 0.24 }))
  }
  // la balanza del tendero: el icono del mercado
  l.push(caja(p.zocalo, 0.9, y, 0.9, 0.4, 0.3, 0.4))
  l.push(caja(p.madera, 0.9, y + 0.3, 0.9, 0.09, 1.1, 0.09))
  l.push(caja(p.madera, 0.9, y + 1.3, 0.9, 0.9, 0.07, 0.07))
  l.push(cil(p.oro, 0.52, y + 1.16, 0.9, 0.3, 0.09))
  l.push(cil(p.oro, 1.28, y + 1.22, 0.9, 0.3, 0.09))
  if (t >= 1) l.push(bandera(p, p.telaAzul, -1.3, y, -1.3, 1.2, 0.4))
  return l
}

function fCuartel ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 1.0 + 0.05 * n
  l.push(caja(p.zocalo, 0, y, -0.2, 2.5, 0.14, 1.9))
  l.push(caja(p.muro, 0, y + 0.14, -0.2, 2.3, h, 1.7))
  if (t < 2) entramado(l, p, 0, y + 0.14, -0.2, 2.3, h, 1.7)
  else almenas(l, p.muroAlt, 0, y + 0.14 + h, -0.2, 2.3, 1.7, 0.4, 0.2)
  l.push(techo2Aguas(p.techo, 0, y + 0.14 + h, -0.2, 2.6, 2.0, 0.6))
  l.push(hastial(p.muroAlt, 0, y + 0.14 + h, 0.78, 2.6, 0.6))
  l.push(caja(p.madera, 0, y + 0.14, 0.68, 0.7, 0.9, 0.08))
  // estandarte de guerra sobre la puerta
  l.push(caja(p.madera, 0, y + h, 0.78, 0.06, 0.06, 0.45))
  const tela = new THREE.Group()
  tela.position.set(0, y + h + 0.02, 0.95)
  tela.add(caja(p.tela, 0, -0.6, 0, 0.5, 0.6, 0.04))
  tela.add(hastial(p.tela, 0, -0.78, 0, 0.5, 0.2, 0.04))
  tela.userData.anim = 'bandera'
  l.push(tela)
  // armero con lanzas
  l.push(caja(p.madera, -1.0, y, 1.05, 0.9, 0.5, 0.2))
  for (let i = 0; i < 3; i++) {
    l.push(pieza(G.caja, p.madera, { x: -1.25 + i * 0.24, y: y + 0.65, z: 1.02, sx: 0.05, sy: 1.2, sz: 0.05, rz: 0.12 }))
    l.push(pieza(G.cono, p.metal, { x: -1.25 + i * 0.24 + 0.08, y: y + 1.28, z: 1.02, sx: 0.12, sy: 0.24, sz: 0.12 }))
  }
  // muñeco de entrenamiento
  l.push(caja(p.madera, 1.05, y, 1.0, 0.12, 1.0, 0.12))
  l.push(caja(p.madera, 1.05, y + 0.72, 1.0, 0.7, 0.1, 0.1))
  l.push(pieza(G.esfera, p.paja, { x: 1.05, y: y + 1.08, z: 1.0, sx: 0.3, sy: 0.3, sz: 0.3 }))
  if (det) {
    l.push(cil6(p.metal, 1.35, y + 0.35, -0.9, 0.5, 0.08, 0.4))    // escudo apoyado
    l.push(barril(p, -1.3, y, -0.9))
  }
  return l
}

function fArqueria ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 0.95 + 0.05 * n
  l.push(caja(p.zocalo, 0, y, -0.65, 2.4, 0.14, 1.4))
  l.push(caja(p.muro, 0, y + 0.14, -0.65, 2.2, h, 1.25))
  if (t < 2) entramado(l, p, 0, y + 0.14, -0.65, 2.2, h, 1.25)
  l.push(techo2Aguas(p.techo, 0, y + 0.14 + h, -0.65, 2.5, 1.6, 0.55))
  l.push(hastial(p.muroAlt, 0, y + 0.14 + h, 0.13, 2.5, 0.55))
  l.push(caja(p.carbon, 0, y + 0.14, -0.02, 0.7, 0.85, 0.06))
  // dianas de paja: el emblema de la arquería
  for (const x of [-0.85, 0.45]) {
    l.push(pieza(G.caja, p.madera, { x: x - 0.14, y: y + 0.45, z: 0.95, sx: 0.07, sy: 0.9, sz: 0.07, rz: 0.2 }))
    l.push(pieza(G.caja, p.madera, { x: x + 0.14, y: y + 0.45, z: 0.95, sx: 0.07, sy: 0.9, sz: 0.07, rz: -0.2 }))
    l.push(pieza(G.cilindro, p.telaCruda, { x, y: y + 0.85, z: 0.95, sx: 0.62, sy: 0.1, sz: 0.62, rx: PI / 2 }))
    l.push(pieza(G.cilindro, p.tela, { x, y: y + 0.85, z: 1.01, sx: 0.3, sy: 0.04, sz: 0.3, rx: PI / 2 }))
    if (det) l.push(pieza(G.caja, p.maderaClara, { x: x + 0.05, y: y + 0.88, z: 1.12, sx: 0.04, sy: 0.04, sz: 0.4 }))
  }
  if (det) {
    l.push(roca(p.paja, 1.15, y, 0.9, 0.5))
    l.push(cil6(p.maderaClara, -1.3, y, 0.35, 0.3, 0.5))      // haz de flechas
    for (let i = 0; i < 3; i++) l.push(caja(p.maderaClara, -1.3 + (i - 1) * 0.06, y + 0.5, 0.35, 0.03, 0.5, 0.03))
  }
  if (t >= 1) l.push(bandera(p, p.telaVerde, 1.15, y, -1.15, 1.0, 0.35))
  return l
}

function fEstablo ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 1.0 + 0.05 * n
  l.push(caja(p.zocalo, 0, y, -0.55, 3.5, 0.14, 1.6))
  l.push(caja(p.muro, 0, y + 0.14, -0.85, 3.3, h, 0.95))
  // cuadras abiertas hacia el frente
  for (const x of [-1.5, -0.5, 0.5, 1.5]) l.push(caja(p.madera, x, y + 0.14, -0.2, 0.12, h * 0.75, 0.9))
  l.push(caja(p.madera, 0, y + 0.14 + h * 0.75, -0.2, 3.3, 0.12, 0.9))
  l.push(techo2Aguas(p.techo, 0, y + 0.14 + h, -0.6, 3.6, 1.9, 0.6))
  l.push(hastial(p.muroAlt, 0, y + 0.14 + h, 0.3, 3.6, 0.6))
  // el caballo: sin él esto es un cobertizo cualquiera
  const c = mat(PALETA.caballo)
  const cab = new THREE.Group()
  cab.add(caja(c, 0, 0.36, 0, 0.72, 0.32, 0.3))
  cab.add(caja(c, 0.3, 0.55, 0, 0.2, 0.32, 0.22))
  cab.add(caja(c, 0.42, 0.78, 0, 0.36, 0.17, 0.19))
  for (const dx of [-0.25, 0.25]) for (const dz of [-0.1, 0.1]) cab.add(caja(c, dx, 0, dz, 0.09, 0.36, 0.09))
  cab.add(caja(p.carbon, -0.38, 0.42, 0, 0.08, 0.26, 0.11))
  cab.add(caja(p.carbon, 0.2, 0.7, 0, 0.16, 0.14, 0.2))
  cab.position.set(0.55, y, 0.75)
  cab.rotation.y = -0.5
  l.push(cab)
  if (det) {
    l.push(caja(p.madera, -1.15, y, 0.85, 0.9, 0.3, 0.45))       // abrevadero
    l.push(caja(mat(PALETA.agua), -1.15, y + 0.26, 0.85, 0.8, 0.06, 0.36))
    l.push(roca(p.paja, -1.75, y, 0.5, 0.55))
    for (let i = 0; i < 3; i++) l.push(caja(p.madera, -1.8 + i * 0.9, y, 1.35, 0.08, 0.45, 0.08))
    l.push(caja(p.madera, -0.9, y + 0.3, 1.35, 1.9, 0.06, 0.06))
  }
  if (t >= 1) l.push(bandera(p, p.tela, 1.6, y, 1.2, 1.0, 0.35))
  return l
}

function fTallerAsedio ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 1.1 + 0.05 * n
  // nave abierta al fondo; las máquinas, delante y a la vista
  for (const x of [-1.45, 1.45]) for (const z of [-1.6, -0.2]) l.push(caja(p.madera, x, y, z, 0.18, h, 0.18))
  l.push(caja(p.muro, 0, y, -1.7, 3.1, h, 0.35))
  l.push(techo2Aguas(p.techo, 0, y + h, -0.9, 3.5, 1.9, 0.6))
  l.push(hastial(p.madera, 0, y + h, -1.75, 3.5, 0.6))
  // catapulta montada delante
  l.push(caja(p.madera, -0.55, y, 0.9, 1.5, 0.24, 0.9))
  l.push(rueda(p, -1.25, y, 0.55, 0.56))
  l.push(rueda(p, -1.25, y, 1.25, 0.56))
  l.push(rueda(p, 0.1, y, 0.55, 0.56))
  l.push(rueda(p, 0.1, y, 1.25, 0.56))
  l.push(caja(p.madera, -0.55, y + 0.24, 0.9, 0.18, 0.85, 0.18))
  l.push(pieza(G.caja, p.madera, { x: -0.15, y: y + 0.95, z: 0.9, sx: 1.5, sy: 0.12, sz: 0.12, rz: 0.75 }))
  l.push(pieza(G.esfera, p.piedraOscura, { x: 0.28, y: y + 1.5, z: 0.9, sx: 0.34, sy: 0.34, sz: 0.34 }))
  // ariete apoyado
  l.push(lenoZ(p.tronco, 1.15, y + 0.45, 0.55, 0.32, 1.5))
  l.push(pieza(G.cilindro, p.metal, { x: 1.15, y: y + 0.61, z: 1.25, sx: 0.38, sy: 0.2, sz: 0.38, rx: PI / 2 }))
  l.push(caja(p.madera, 1.15, y, -0.05, 0.12, 0.5, 0.12))
  l.push(caja(p.madera, 1.15, y, 1.1, 0.12, 0.5, 0.12))
  if (det) {
    for (let i = 0; i < 3; i++) l.push(caja(p.maderaClara, 0.9 + i * 0.02, y + i * 0.14, -0.9, 1.1, 0.13, 0.4))
    l.push(barril(p, -1.3, y, -0.9))
  }
  return l
}

function fHerreria ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 0.95 + 0.05 * n
  l.push(caja(p.zocalo, 0, y, -0.5, 2.4, 0.14, 1.8))
  l.push(caja(p.muro, 0, y + 0.14, -0.5, 2.2, h, 1.6))
  if (t < 2) entramado(l, p, 0, y + 0.14, -0.5, 2.2, h, 1.6)
  l.push(techo2Aguas(p.techo, 0, y + 0.14 + h, -0.5, 2.5, 1.9, 0.55))
  l.push(hastial(p.muroAlt, 0, y + 0.14 + h, 0.44, 2.5, 0.55))
  // chimenea de piedra con la fragua encendida
  l.push(caja(p.piedraOscura, -0.75, y, 0.25, 0.7, h + 1.15, 0.7))
  l.push(caja(p.carbon, -0.75, y + h + 1.29, 0.25, 0.8, 0.12, 0.8))
  l.push(caja(p.carbon, -0.75, y + 0.2, 0.62, 0.45, 0.45, 0.1))
  if (det) {
    const fuego = pieza(G.caja, p.fuego, { x: -0.75, y: y + 0.36, z: 0.6, sx: 0.36, sy: 0.3, sz: 0.14 })
    fuego.userData.anim = 'llama'
    fuego.castShadow = false
    l.push(fuego)
  }
  // yunque: cuatro piezas y se reconoce al instante
  l.push(caja(p.piedraOscura, 0.55, y, 0.75, 0.45, 0.3, 0.45))
  l.push(caja(p.metal, 0.55, y + 0.3, 0.75, 0.2, 0.18, 0.24))
  l.push(caja(p.metal, 0.55, y + 0.48, 0.75, 0.62, 0.16, 0.3))
  l.push(pieza(G.cono, p.metal, { x: 0.95, y: y + 0.56, z: 0.75, sx: 0.28, sy: 0.3, sz: 0.22, rz: -PI / 2 }))
  l.push(pieza(G.caja, p.madera, { x: 0.4, y: y + 0.7, z: 0.95, sx: 0.06, sy: 0.5, sz: 0.06, rz: 0.5 }))
  l.push(caja(p.metal, 0.25, y + 0.9, 0.95, 0.2, 0.12, 0.12))
  if (det) {
    l.push(caja(p.madera, 1.15, y, -0.1, 0.5, 0.4, 0.5))
    l.push(caja(mat(PALETA.agua), 1.15, y + 0.36, -0.1, 0.42, 0.06, 0.42))
    l.push(roca(p.carbon, -1.2, y, 0.85, 0.45))
    for (let i = 0; i < 2; i++) l.push(pieza(G.cilindro, p.metal, { x: 0.15 + i * 0.3, y: y + h * 0.75, z: 0.34, sx: 0.22, sy: 0.05, sz: 0.22, rx: PI / 2 }))
  }
  return l
}

function fUniversidad ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 1.25 + 0.07 * n
  l.push(caja(p.zocalo, 0, y, -0.25, 2.6, 0.22, 2.2))
  l.push(caja(p.muro, 0, y + 0.22, -0.25, 2.3, h, 1.95))
  // arcada de columnas: lo que separa un edificio noble de un granero
  for (let i = 0; i < 4; i++) {
    const x = -1.05 + i * 0.7
    l.push(cil(p.zocalo, x, y + 0.22, 0.95, 0.24, h * 0.8))
    l.push(caja(p.muroAlt, x, y + 0.22 + h * 0.8, 0.95, 0.34, 0.12, 0.34))
  }
  l.push(caja(p.muroAlt, 0, y + 0.22 + h * 0.8 + 0.12, 0.95, 2.4, 0.16, 0.5))
  l.push(techo2Aguas(p.techo, 0, y + 0.22 + h, -0.25, 2.55, 2.2, 0.8))
  l.push(hastial(p.muroAlt, 0, y + 0.22 + h, 0.85, 2.55, 0.8))
  l.push(hastial(p.muroAlt, 0, y + 0.22 + h, -1.35, 2.55, 0.8))
  // ventanales altos y estrechos
  for (const x of [-0.7, 0, 0.7]) {
    l.push(caja(p.telaAzul, x, y + 0.22 + h * 0.35, -1.23, 0.26, h * 0.5, 0.05))
    l.push(pieza(G.cono, p.telaAzul, { x, y: y + 0.22 + h * 0.85 - 0.06, z: -1.23, sx: 0.26, sy: 0.2, sz: 0.05 }))
  }
  // torreta del escribano
  l.push(cil6(p.muro, 1.05, y + 0.22, -1.05, 0.7, h + 0.45))
  l.push(techoCono(t >= 1 ? p.techoAlt : p.techo, 1.05, y + 0.22 + h + 0.45, -1.05, 0.85, 0.6))
  if (det) {
    l.push(caja(p.maderaClara, -1.05, y + 0.22, 1.3, 0.6, 0.4, 0.4))
    l.push(pieza(G.cilindro, p.telaCruda, { x: -1.05, y: y + 0.66, z: 1.3, sx: 0.16, sy: 0.5, sz: 0.16, rz: PI / 2 }))
    l.push(caja(p.tela, 0.95, y + 0.62, 1.3, 0.3, 0.08, 0.24))
  }
  if (t >= 1) l.push(bandera(p, p.telaAzul, -1.25, y + 0.22, -1.25, 1.2, 0.4))
  return l
}

function fMonasterio ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 1.15 + 0.06 * n
  l.push(caja(p.zocalo, 0.2, y, 0, 2.3, 0.2, 2.3))
  l.push(caja(p.muro, 0.2, y + 0.2, 0, 2.0, h, 2.0))
  l.push(techo2Aguas(p.techo, 0.2, y + 0.2 + h, 0, 2.25, 2.2, 0.7))
  l.push(hastial(p.muroAlt, 0.2, y + 0.2 + h, 1.1, 2.25, 0.7))
  l.push(hastial(p.muroAlt, 0.2, y + 0.2 + h, -1.1, 2.25, 0.7))
  // campanario: tiene que sobresalir del tejado o no se lee como monasterio
  const ht = h + 1.75
  l.push(caja(p.muro, -1.05, y, 0.9, 0.85, ht, 0.85))
  l.push(caja(p.carbon, -1.05, y + ht - 0.62, 0.9, 0.52, 0.5, 0.9))
  l.push(pieza(G.cono8, p.oro, { x: -1.05, y: y + ht - 0.38, z: 0.9, sx: 0.36, sy: 0.36, sz: 0.36, rx: PI }))
  l.push(caja(p.viga, -1.05, y + ht, 0.9, 0.98, 0.1, 0.98))
  l.push(techo4(t >= 2 ? p.techo : p.techoAlt, -1.05, y + ht + 0.1, 0.9, 1.02, 0.78))
  l.push(caja(p.oro, -1.05, y + ht + 0.88, 0.9, 0.07, 0.42, 0.07))
  l.push(caja(p.oro, -1.05, y + ht + 1.04, 0.9, 0.28, 0.07, 0.07))
  // vidriera redonda: la mancha de color que lo identifica
  l.push(pieza(G.cilindro, p.telaAzul, { x: 0.2, y: y + 0.2 + h * 0.62, z: 1.03, sx: 0.62, sy: 0.06, sz: 0.62, rx: PI / 2 }))
  l.push(pieza(G.cilindro, p.tela, { x: 0.2, y: y + 0.2 + h * 0.62, z: 1.06, sx: 0.3, sy: 0.05, sz: 0.3, rx: PI / 2 }))
  l.push(pieza(G.cono, p.madera, { x: 0.2, y: y + 0.2 + h * 0.2, z: 1.02, sx: 0.55, sy: 1.1, sz: 0.06 }))
  l.push(caja(p.madera, 0.2, y + 0.2, 1.04, 0.5, h * 0.42, 0.06))
  if (det) {
    for (let i = 0; i < 3; i++) {
      l.push(cil(p.zocalo, 1.15, y + 0.2, -1.0 + i * 0.7, 0.22, 0.75))
      l.push(caja(p.muroAlt, 1.15, y + 0.95, -1.0 + i * 0.7, 0.3, 0.12, 0.3))
    }
    l.push(roca(p.hierba, -1.15, y, -0.9, 0.5))
  }
  return l
}

function fCampamento ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  // dos tiendas de campaña
  for (const [x, z, d] of [[-0.85, -0.6, 1.4], [0.85, 0.25, 1.15]]) {
    l.push(pieza(G.cono6, p.telaCruda, { x, y: y + d * 0.42, z, sx: d, sy: d * 0.85, sz: d }))
    l.push(caja(p.carbon, x, y, z + d * 0.4, d * 0.28, d * 0.42, 0.05))
    l.push(caja(p.madera, x, y + d * 0.8, z, 0.05, 0.3, 0.05))
    l.push(hastial(p.tela, x, y + d * 0.86, z, 0.3, 0.16, 0.03))
  }
  hoguera(l, p, 0, y, 1.0, det)
  // mesa de mapas
  l.push(caja(p.maderaClara, 0.9, y + 0.42, -0.95, 1.0, 0.08, 0.7, 0.3))
  for (const dx of [-0.38, 0.38]) for (const dz of [-0.24, 0.24]) l.push(caja(p.madera, 0.9 + dx, y, -0.95 + dz, 0.07, 0.42, 0.07))
  l.push(caja(p.telaCruda, 0.9, y + 0.5, -0.95, 0.7, 0.03, 0.5, 0.3))
  // asta con el gallardete
  l.push(bandera(p, p.telaVerde, -1.2, y, 1.1, 1.5, 0.42))
  if (det) {
    l.push(cajon(p, 0.15, y, -0.35, 0.34))
    l.push(barril(p, -0.2, y, -1.15))
    for (let i = 0; i < 3; i++) l.push(pieza(G.caja, p.madera, { x: 1.3, y: y + 0.5, z: 0.9, sx: 0.05, sy: 1.0, sz: 0.05, rz: 0.2 * (i - 1), ry: i }))
  }
  if (t >= 1) {
    l.push(caja(p.zocalo, -0.85, y, -0.6, 1.5, 0.12, 1.5))
    l.push(caja(p.zocalo, 0.85, y, 0.25, 1.25, 0.12, 1.25))
  }
  return l
}

function fTorreVigia ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 1.25 + 0.14 * n
  l.push(caja(p.zocalo, 0, y, 0, 1.45, 0.2, 1.45))
  l.push(caja(p.muro, 0, y + 0.2, 0, 1.15, h, 1.15))
  l.push(caja(p.carbon, 0, y + 0.2 + h * 0.45, 0.6, 0.16, 0.42, 0.04))   // saetera
  // remate: plataforma de madera y voladizo
  const yp = y + 0.2 + h
  l.push(caja(p.viga, 0, yp, 0, 1.5, 0.14, 1.5))
  if (t >= 1) {
    almenas(l, p.muroAlt, 0, yp + 0.14, 0.66, 1.5, 0.18, 0.38, 0.26)
    almenas(l, p.muroAlt, 0, yp + 0.14, -0.66, 1.5, 0.18, 0.38, 0.26)
    l.push(caja(p.muroAlt, -0.66, yp + 0.14, 0, 0.18, 0.26, 1.5))
    l.push(caja(p.muroAlt, 0.66, yp + 0.14, 0, 0.18, 0.26, 1.5))
  } else {
    for (const [x, z] of [[0, 0.7], [0, -0.7], [0.7, 0], [-0.7, 0]]) l.push(caja(p.madera, x, yp + 0.14, z, x ? 0.1 : 1.5, 0.24, x ? 1.5 : 0.1))
  }
  // caseta del vigía: el tejadillo va POR ENCIMA del pretil, nunca metido dentro
  for (const px of [-0.52, 0.52]) for (const pz of [-0.52, 0.52]) l.push(caja(p.madera, px, yp + 0.4, pz, 0.11, 0.34, 0.11))
  l.push(techo4(p.techo, 0, yp + 0.74, 0, 1.5, 0.62))
  if (t >= 2) l.push(bandera(p, p.telaAzul, 0, yp + 1.36, 0, 0.55, 0.3))
  if (det) {
    l.push(pieza(G.caja, p.madera, { x: 0.62, y: y + h * 0.5, z: 0.72, sx: 0.08, sy: h * 1.1, sz: 0.08, rz: 0.12 }))
    for (let i = 0; i < 3; i++) l.push(caja(p.madera, 0.62, y + 0.3 + i * 0.35, 0.72, 0.32, 0.06, 0.06))
  }
  return l
}

function fTorreBallesta ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 0.95 + 0.11 * n
  l.push(caja(p.zocalo, 0, y, 0, 1.5, 0.22, 1.5))
  l.push(caja(p.muro, 0, y + 0.22, 0, 1.25, h, 1.25))
  l.push(caja(p.viga, 0, y + 0.22 + h, 0, 1.55, 0.14, 1.55))
  almenas(l, p.muroAlt, 0, y + 0.36 + h, 0.68, 1.55, 0.18, 0.4, 0.24)
  almenas(l, p.muroAlt, 0, y + 0.36 + h, -0.68, 1.55, 0.18, 0.4, 0.24)
  // la ballesta montada: dos brazos, carril y virote
  const yb = y + 0.5 + h
  l.push(cil6(p.madera, 0, y + 0.36 + h, 0, 0.45, 0.18))
  l.push(pieza(G.caja, p.madera, { x: 0, y: yb + 0.1, z: 0, sx: 0.18, sy: 0.12, sz: 1.1, rx: -0.18 }))
  l.push(pieza(G.caja, p.metal, { x: 0, y: yb + 0.18, z: -0.15, sx: 1.35, sy: 0.08, sz: 0.08, rz: 0.12 }))
  l.push(pieza(G.caja, p.metal, { x: 0, y: yb + 0.22, z: -0.1, sx: 1.1, sy: 0.03, sz: 0.03 }))
  l.push(pieza(G.caja, p.maderaClara, { x: 0, y: yb + 0.2, z: 0.25, sx: 0.06, sy: 0.06, sz: 0.8, rx: -0.18 }))
  l.push(pieza(G.cono, p.metal, { x: 0, y: yb + 0.28, z: 0.66, sx: 0.14, sy: 0.22, sz: 0.14, rx: PI / 2 - 0.18 }))
  if (det) {
    l.push(cajon(p, 0.5, y + 0.36 + h, 0.45, 0.32))
    l.push(caja(p.carbon, 0, y + 0.22 + h * 0.4, 0.65, 0.16, 0.4, 0.04))
  }
  if (t >= 2) l.push(bandera(p, p.tela, -0.55, y + 0.36 + h, -0.5, 0.8, 0.3))
  return l
}

function fCastillo ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const hm = 1.0 + 0.06 * n        // muro cortina
  const ht = 1.9 + 0.12 * n        // torreones
  l.push(caja(p.zocalo, 0, y, 0, 3.8, 0.22, 3.8))
  // muro cortina con almenas en los cuatro lados
  for (const s of [1, -1]) {
    l.push(caja(p.muro, 0, y + 0.22, s * 1.45, 3.4, hm, 0.45))
    l.push(caja(p.muro, s * 1.45, y + 0.22, 0, 0.45, hm, 3.4))
    almenas(l, p.muroAlt, 0, y + 0.22 + hm, s * 1.45, 3.4, 0.45, 0.42, 0.26)
    almenas(l, p.muroAlt, s * 1.45, y + 0.22 + hm, 0, 3.4, 0.45, 0.42, 0.26, true)
  }
  // torreón central
  l.push(caja(p.muro, 0, y + 0.22, -0.2, 1.7, ht, 1.7))
  almenas(l, p.muroAlt, 0, y + 0.22 + ht, 0.62, 1.7, 0.22, 0.42, 0.26)
  almenas(l, p.muroAlt, 0, y + 0.22 + ht, -1.02, 1.7, 0.22, 0.42, 0.26)
  l.push(caja(p.muroAlt, -0.84, y + 0.22 + ht, -0.2, 0.22, 0.26, 1.7))
  l.push(caja(p.muroAlt, 0.84, y + 0.22 + ht, -0.2, 0.22, 0.26, 1.7))
  l.push(bandera(p, p.telaAzul, 0, y + 0.22 + ht + 0.26, -0.2, 1.1, 0.5))
  // cuatro torres redondas con capirote de pizarra
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 1.5; const z = sz * 1.5
    l.push(cil6(p.muro, x, y + 0.22, z, 1.0, ht * 0.85))
    l.push(cil6(p.muroAlt, x, y + 0.22 + ht * 0.85, z, 1.15, 0.18))
    l.push(techoCono(p.techo, x, y + 0.4 + ht * 0.85, z, 1.2, 0.85))
    l.push(caja(p.carbon, x, y + 0.22 + ht * 0.45, z + sz * 0.5, 0.14, 0.36, 0.05))
  }
  // puerta con puente levadizo y cadenas
  l.push(caja(p.carbon, 0, y + 0.22, 1.5, 0.9, hm * 0.9, 0.5))
  l.push(pieza(G.cono, p.carbon, { x: 0, y: y + 0.22 + hm * 0.9, z: 1.5, sx: 0.9, sy: 0.4, sz: 0.5 }))
  l.push(pieza(G.caja, p.madera, { x: 0, y: y + 0.55, z: 2.3, sx: 0.85, sy: 0.1, sz: 1.5, rx: -0.55 }))
  for (const dx of [-0.38, 0.38]) {
    l.push(pieza(G.caja, p.metal, { x: dx, y: y + 0.95, z: 2.15, sx: 0.05, sy: 1.1, sz: 0.05, rz: 0.1, rx: 0.35 }))
  }
  if (det) {
    l.push(bandera(p, p.tela, -1.5, y + 0.4 + ht * 0.85 + 0.8, -1.5, 0.6, 0.3))
    l.push(bandera(p, p.tela, 1.5, y + 0.4 + ht * 0.85 + 0.8, -1.5, 0.6, 0.3))
  }
  return l
}

function fPozo ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  l.push(cil6(p.zocalo, 0, y, 0, 0.82, 0.36))
  l.push(cil6(p.carbon, 0, y + 0.36, 0, 0.62, 0.03))
  l.push(caja(p.madera, -0.3, y + 0.36, 0, 0.09, 0.78, 0.09))
  l.push(caja(p.madera, 0.3, y + 0.36, 0, 0.09, 0.78, 0.09))
  l.push(techo2Aguas(p.techo, 0, y + 1.14, 0, 0.82, 0.66, 0.46, 0.08))
  l.push(pieza(G.cilindro, p.madera, { x: 0, y: y + 0.95, z: 0, sx: 0.16, sy: 0.62, sz: 0.16, rz: PI / 2 }))
  l.push(caja(p.metal, 0, y + 0.6, 0, 0.03, 0.32, 0.03))
  l.push(cil6(p.maderaClara, 0, y + 0.46, 0, 0.2, 0.16))
  if (det) l.push(pieza(G.caja, p.madera, { x: 0.34, y: y + 0.95, z: 0.14, sx: 0.06, sy: 0.2, sz: 0.06, rz: 0.6 }))
  return l
}

function fEstandarte ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  l.push(cil6(p.zocalo, 0, y, 0, 0.6, 0.22))
  l.push(caja(p.piedraOscura, 0, y + 0.22, 0, 0.3, 0.14, 0.3))
  l.push(bandera(p, p.telaAzul, 0, y + 0.36, 0, 1.6, 0.55))
  if (det) {
    l.push(roca(p.piedra, 0.32, y, 0.28, 0.24))
    l.push(roca(p.piedra, -0.3, y, -0.25, 0.2))
  }
  return l
}

// ── murallas que encajan entre ellas ─────────────────────────────────────
// Bits de conexión: 1 norte(-z), 2 este(+x), 4 sur(+z), 8 oeste(-x).
// Con la máscara salen solos todos los trozos: recto, esquina, cruce y
// extremo con torreta. Una muralla que no encaja canta muchísimo.

const DIRS = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]]
/** Tipos con los que una muralla se traba: otra muralla, una puerta o una torre. */
const ANCLAJES = new Set(['muralla', 'puerta', 'torre_vigia', 'torre_ballesta', 'castillo'])
const ocupadas = new Map()

function reindexar () {
  ocupadas.clear()
  for (const b of game.state.buildings) {
    const a = b.ancho ?? 2; const h = b.alto ?? 2
    for (let i = 0; i < a; i++) for (let j = 0; j < h; j++) ocupadas.set(`${b.x + i}|${b.z + j}`, b.tipo)
  }
}

const anclaEn = (x, z) => ANCLAJES.has(ocupadas.get(`${x}|${z}`))

function mascaraEn (x, z) {
  let m = 0
  for (const [dx, dz, bit] of DIRS) if (anclaEn(x + dx, z + dz)) m |= bit
  return m
}

function fMuralla ({ p, n, t, det, mask }) {
  const l = []
  const y = 0
  const muroP = t >= 2 ? p.piedraOscura : p.piedra
  const cor = t >= 2 ? p.piedra : p.piedraOscura
  const h = 0.62 + 0.075 * n
  const gro = t === 0 ? 0.42 : 0.5
  const brazos = DIRS.filter(d => mask & d[2])
  const cuenta = brazos.length

  if (t === 0) {
    // empalizada de troncos puntiagudos
    const palo = (x, z, alt) => {
      l.push(leno(p.madera, x, y, z, 0.22, alt))
      l.push(pieza(G.cono6, p.maderaClara, { x, y: y + alt + 0.08, z, sx: 0.24, sy: 0.2, sz: 0.24 }))
    }
    palo(0, 0, h + 0.12)
    for (const [dx, dz] of brazos) {
      for (let i = 1; i <= 2; i++) palo(dx * i * 0.22, dz * i * 0.22, h - 0.04 * i)
      l.push(pieza(G.caja, p.viga, { x: dx * 0.3, y: y + h * 0.55, z: dz * 0.3, sx: dx ? 0.62 : 0.08, sy: 0.08, sz: dz ? 0.62 : 0.08 }))
    }
    if (cuenta <= 1) l.push(caja(p.piedraOscura, 0, y, 0, 0.62, 0.16, 0.62))
    return l
  }

  // sillería: zócalo, paño, cordón y almenas
  l.push(caja(p.piedraOscura, 0, y, 0, gro + 0.16, 0.14, gro + 0.16))
  for (const [dx, dz] of brazos) {
    const cx = dx * 0.26; const cz = dz * 0.26
    const sx = dx ? 0.54 : gro; const sz = dz ? 0.54 : gro
    l.push(caja(p.piedraOscura, cx, y, cz, sx + 0.12, 0.14, sz + 0.12))
    l.push(caja(muroP, cx, y + 0.14, cz, sx, h, sz))
    l.push(caja(cor, cx, y + 0.14 + h, cz, sx + 0.1, 0.1, sz + 0.1))
    almenas(l, cor, cx, y + 0.24 + h, cz, dx ? 0.54 : gro, dx ? gro : 0.54, 0.26, 0.2, !dx)
  }
  if (cuenta <= 1) {
    // extremo: torreta redonda, para que el muro no acabe en un tajo
    l.push(cil6(muroP, 0, y + 0.14, 0, 0.78, h + 0.18))
    l.push(cil6(cor, 0, y + 0.32 + h, 0, 0.9, 0.12))
    l.push(techoCono(p.techo, 0, y + 0.44 + h, 0, 0.98, 0.66))
  } else {
    l.push(caja(muroP, 0, y + 0.14, 0, gro + 0.08, h + 0.1, gro + 0.08))
    l.push(caja(cor, 0, y + 0.24 + h, 0, gro + 0.18, 0.22, gro + 0.18))
  }
  if (det && t >= 2 && cuenta <= 2) {
    l.push(caja(p.madera, 0.3, y + h * 0.7, 0.3, 0.06, 0.3, 0.06))
    const f = pieza(G.cono6, p.fuego, { x: 0.3, y: y + h * 0.7 + 0.34, z: 0.3, sx: 0.18, sy: 0.26, sz: 0.18 })
    f.userData.anim = 'llama'; f.castShadow = false
    l.push(f)
  }
  return l
}

function fPuerta ({ p, n, t, det }) {
  const l = []
  const y = 0
  // en la empalizada la puerta también es de madera: mezclar cantería con
  // troncos en el mismo muro queda a parches
  const muroP = t === 0 ? p.madera : t >= 2 ? p.piedraOscura : p.piedra
  const cor = t === 0 ? p.maderaClara : t >= 2 ? p.piedra : p.piedraOscura
  const h = 0.72 + 0.075 * n
  // dos torreones con el arco en medio: se lee como puerta desde arriba
  for (const s of [-1, 1]) {
    l.push(caja(p.piedraOscura, s * 0.62, y, 0, 0.76, 0.16, 0.76))
    l.push(caja(muroP, s * 0.62, y + 0.16, 0, 0.64, h + 0.35, 0.64))
    almenas(l, cor, s * 0.62, y + 0.51 + h, 0, 0.74, 0.74, 0.28, 0.18)
    if (det) l.push(caja(p.carbon, s * 0.62, y + 0.16 + h * 0.55, 0.33, 0.12, 0.3, 0.04))
  }
  l.push(caja(muroP, 0, y + 0.16 + h * 0.78, 0, 0.72, h * 0.35, 0.6))
  almenas(l, cor, 0, y + 0.16 + h * 1.13, 0, 0.72, 0.6, 0.24, 0.16)
  // hojas de madera con herrajes
  for (const s of [-1, 1]) {
    l.push(caja(p.madera, s * 0.17, y + 0.1, 0, 0.32, h * 0.78, 0.28))
    l.push(caja(p.metal, s * 0.17, y + 0.1 + h * 0.28, 0.15, 0.3, 0.07, 0.04))
    l.push(caja(p.metal, s * 0.17, y + 0.1 + h * 0.6, 0.15, 0.3, 0.07, 0.04))
  }
  l.push(pieza(G.cono, p.piedraOscura, { x: 0, y: y + 0.16 + h * 0.78, z: 0, sx: 0.72, sy: 0.3, sz: 0.62 }))
  if (t >= 1) {
    l.push(bandera(p, p.telaAzul, -0.62, y + 0.51 + h + 0.18, 0, 0.7, 0.3))
    l.push(bandera(p, p.telaAzul, 0.62, y + 0.51 + h + 0.18, 0, 0.7, 0.3))
  }
  return l
}

// ── obra, ruina y respaldo genérico ──────────────────────────────────────

/** Andamio: estructura a medias, montón de material y cartel de obra. */
function fAndamio (p, det, ancho, alto) {
  const l = []
  const y = SUELO
  const ax = Math.max(1, ancho - 0.5); const az = Math.max(1, alto - 0.5)
  const h = 0.5 + Math.min(ancho, alto) * 0.25
  l.push(caja(p.tierra, 0, 0, 0, ancho - 0.14, SUELO, alto - 0.14))
  // lo poco que lleva levantado
  l.push(caja(p.piedraOscura, 0, y, 0, ax * 0.86, 0.22, az * 0.86))
  l.push(caja(p.muro, 0, y + 0.22, -az * 0.3, ax * 0.7, h * 0.7, az * 0.24))
  l.push(caja(p.muro, -ax * 0.28, y + 0.22, 0, ax * 0.2, h * 0.45, az * 0.5))
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    l.push(caja(p.andamio || p.maderaClara, sx * ax / 2, y, sz * az / 2, 0.11, h + 0.3, 0.11))
  }
  for (const sz of [-1, 1]) {
    l.push(caja(p.maderaClara, 0, y + h * 0.55, sz * az / 2, ax + 0.11, 0.09, 0.09))
    l.push(caja(p.maderaClara, 0, y + h, sz * az / 2, ax + 0.11, 0.09, 0.09))
  }
  // pasarelas laterales, no una tapa: hay que VER la obra a medias desde arriba
  l.push(caja(p.maderaClara, -ax * 0.42, y + h + 0.09, 0, 0.34, 0.07, az + 0.11))
  l.push(caja(p.maderaClara, ax * 0.42, y + h + 0.09, 0, 0.34, 0.07, az + 0.11))
  l.push(pieza(G.caja, p.madera, { x: ax * 0.28, y: y + h * 0.6, z: az * 0.55, sx: 0.16, sy: h * 1.5, sz: 0.08, rz: -0.3 }))
  // cartel de obra: hay que ver de lejos qué se está construyendo
  l.push(caja(p.madera, -ax * 0.42, y, az / 2 + 0.22, 0.08, 0.62, 0.08))
  const cartel = caja(p.maderaClara, -ax * 0.42, y + 0.58, az / 2 + 0.24, 0.62, 0.42, 0.06)
  cartel.rotation.z = 0.08
  l.push(cartel)
  l.push(caja(p.carbon, -ax * 0.42, y + 0.86, az / 2 + 0.28, 0.08, 0.18, 0.03))
  l.push(caja(p.carbon, -ax * 0.42, y + 0.68, az / 2 + 0.28, 0.08, 0.07, 0.03))
  if (det) {
    l.push(caja(p.piedra, ax * 0.35, y, -az * 0.35, 0.36, 0.2, 0.32))
    l.push(caja(p.piedra, ax * 0.35, y + 0.2, -az * 0.35, 0.3, 0.18, 0.28, 0.3))
    l.push(lenoX(p.tronco, -ax * 0.35, y, az * 0.3, 0.2, 0.8))
    l.push(lenoX(p.tronco, -ax * 0.35, y + 0.19, az * 0.3, 0.2, 0.8))
    l.push(barril(p, ax * 0.4, y, az * 0.35, 0.8))
  }
  return l
}

/** Escombros ennegrecidos: un edificio arruinado se ve a la primera. */
function fRuina (p, ancho, alto) {
  const l = []
  const y = SUELO * 0.5
  l.push(caja(p.carbon, 0, 0, 0, ancho - 0.2, y, alto - 0.2))
  const r = Math.min(ancho, alto)
  l.push(caja(p.ceniza, -r * 0.2, y, -r * 0.15, r * 0.5, 0.26, r * 0.4, 0.3))
  l.push(caja(p.ceniza, r * 0.25, y, r * 0.2, r * 0.38, 0.34, r * 0.3, -0.5))
  l.push(roca(p.ceniza, r * 0.1, y, -r * 0.3, r * 0.34))
  l.push(roca(p.carbon, -r * 0.3, y, r * 0.25, r * 0.28))
  l.push(pieza(G.caja, p.carbon, { x: -r * 0.15, y: y + 0.3, z: r * 0.05, sx: 0.12, sy: r * 0.8, sz: 0.12, rz: 0.9, ry: 0.6 }))
  l.push(pieza(G.caja, p.carbon, { x: r * 0.3, y: y + 0.25, z: -r * 0.2, sx: 0.12, sy: r * 0.6, sz: 0.12, rz: -1.1 }))
  l.push(pieza(G.caja, p.ceniza, { x: 0, y: y + 0.12, z: r * 0.35, sx: r * 0.5, sy: 0.1, sz: 0.3, rz: 0.2, ry: 0.9 }))
  return l
}

/** Si algún día se añade un tipo nuevo al catálogo, al menos se verá algo digno. */
function fGenerico ({ p, n, t, det, ancho, alto }) {
  const l = []
  const y = SUELO
  const h = 0.8 + 0.06 * n
  l.push(caja(p.zocalo, 0, y, 0, ancho - 0.4, 0.14, alto - 0.4))
  l.push(caja(p.muro, 0, y + 0.14, 0, ancho - 0.6, h, alto - 0.6))
  l.push(techo2Aguas(p.techo, 0, y + 0.14 + h, 0, ancho - 0.3, alto - 0.35, 0.5))
  l.push(hastial(p.muroAlt, 0, y + 0.14 + h, (alto - 0.6) / 2, ancho - 0.3, 0.5))
  l.push(caja(p.madera, 0, y + 0.14, (alto - 0.6) / 2, 0.4, 0.6, 0.06))
  return l
}

const CONSTRUCTORES = {
  ayuntamiento: fAyuntamiento,
  casa: fCasa,
  serreria: fSerreria,
  cantera: fCantera,
  granja: fGranja,
  mina_oro: fMinaOro,
  molino: fMolino,
  almacen: fAlmacen,
  granero: fGranero,
  mercado: fMercado,
  cuartel: fCuartel,
  arqueria: fArqueria,
  establo: fEstablo,
  taller_asedio: fTallerAsedio,
  herreria: fHerreria,
  universidad: fUniversidad,
  monasterio: fMonasterio,
  campamento_explorador: fCampamento,
  torre_vigia: fTorreVigia,
  torre_ballesta: fTorreBallesta,
  muralla: fMuralla,
  puerta: fPuerta,
  castillo: fCastillo,
  pozo: fPozo,
  estandarte: fEstandarte
}

/** Estos se apoyan directamente en la hierba: una plataforma les quedaría fatal. */
const SIN_PLATAFORMA = new Set(['muralla', 'puerta', 'estandarte', 'pozo', 'cantera', 'mina_oro', 'granja', 'campamento_explorador'])

// ── fábrica de modelos (una vez por tipo+nivel+escalón, el resto son clones) ──

const cacheModelos = new Map()

const tieneAnim = (o) => !!(o.userData && o.userData.anim)

/**
 * Funde todas las piezas estáticas que comparten material en una sola malla.
 * Un edificio de 30 cajas pasa a 4-6 llamadas de dibujo: es la diferencia entre
 * cincuenta edificios a 60 fps y un móvil ardiendo. Lo animado se queda fuera.
 */
function fusionar (raiz) {
  try {
    raiz.updateMatrixWorld(true)
    const porMat = new Map()
    const vivos = []
    const base = new THREE.Matrix4()
    const recoger = (nodo, m) => {
      const mm = m.clone().multiply(nodo.matrix)
      if (tieneAnim(nodo)) { vivos.push({ nodo, mm }); return }
      if (nodo.isMesh) {
        const clave = nodo.material.uuid
        let e = porMat.get(clave)
        if (!e) porMat.set(clave, e = { material: nodo.material, geos: [] })
        const g = nodo.geometry.index ? nodo.geometry.toNonIndexed() : nodo.geometry.clone()
        g.applyMatrix4(mm)
        e.geos.push(g)
      }
      for (const h of [...nodo.children]) recoger(h, mm)
    }
    for (const h of [...raiz.children]) recoger(h, base)

    const out = new THREE.Group()
    for (const e of porMat.values()) {
      const geo = e.geos.length === 1 ? e.geos[0] : mergeGeometries(e.geos, false)
      if (!geo) continue
      const malla = new THREE.Mesh(geo, e.material)
      malla.castShadow = true
      malla.receiveShadow = true
      out.add(malla)
    }
    for (const { nodo, mm } of vivos) {
      mm.decompose(nodo.position, nodo.quaternion, nodo.scale)
      out.add(nodo)
    }
    return out
  } catch (err) {
    console.warn('[buildings] no se pudo fusionar, se usa el grupo suelto', err)
    return raiz
  }
}

/**
 * Devuelve el modelo 3D de un edificio, centrado en el origen y ocupando su
 * ancho x alto en casillas.
 * @param {string} tipo del catálogo de data/buildings.js
 * @param {number} nivel 1..maxNivel; cambia materiales, altura y adornos
 * @param {{estado?:'ok'|'obra'|'ruina', mask?:number}} [o]
 * @returns {THREE.Group}
 */
export function crearEdificio (tipo, nivel = 1, o = {}) {
  const d = def(tipo) || {}
  const n = Math.max(1, Math.min(d.maxNivel || 8, Math.round(nivel) || 1))
  const estado = o.estado || 'ok'
  const mask = tipo === 'muralla' ? (o.mask | 0) : 0
  const clave = `${tipo}|${n}|${estado}|${mask}|${edadVisual}|${ctx.calidad}`
  let proto = cacheModelos.get(clave)
  if (!proto) {
    proto = montar(tipo, n, estado, mask, d)
    cacheModelos.set(clave, proto)
  }
  return proto.clone()
}

function montar (tipo, n, estado, mask, d) {
  const ancho = d.ancho ?? 2
  const alto = d.alto ?? 2
  const t = escalon(n, d.maxNivel || 8)
  const p = paletaDe(t)
  const det = ctx.calidad !== 'bajo'
  const raiz = new THREE.Group()
  let piezas
  if (estado === 'obra') piezas = fAndamio(p, det, ancho, alto)
  else if (estado === 'ruina') piezas = fRuina(p, ancho, alto)
  else {
    piezas = []
    if (!SIN_PLATAFORMA.has(tipo)) piezas.push(caja(p.suelo, 0, 0, 0, ancho - 0.14, SUELO, alto - 0.14))
    piezas.push(...(CONSTRUCTORES[tipo] || fGenerico)({ p, n, t, det, ancho, alto, mask }))
  }
  for (const x of piezas) if (x) raiz.add(x)
  return fusionar(raiz)
}

// ── la aldea en la escena ────────────────────────────────────────────────

/** Altura del terreno; si terrain.js no está, todo se apoya en y=0. */
let alturaEn = () => 0

const mallas = new Map()          // buildingId -> { g, firma }
const animados = []               // piezas vivas: aspas, telas y llamas
const tweens = []                 // plop, mejora y derrumbe

const estadoDe = (b) => b.arruinado ? 'ruina' : (b.enObra || b.mejorando) ? 'obra' : 'ok'

function firmaDe (b) {
  const m = b.tipo === 'muralla' ? mascaraEn(b.x, b.z) : 0
  return `${b.tipo}|${b.nivel}|${estadoDe(b)}|${m}|${b.x}|${b.z}|${b.rot | 0}`
}

/** Quita de la escena sin liberar geometrías: TODAS son compartidas. */
function desmontar (g) {
  if (g && g.parent) g.parent.remove(g)
}

function giroDe (b, ancho, alto) {
  const rot = (b.rot | 0) % 4
  if (b.tipo === 'muralla') return 0              // la orienta la máscara de vecinos
  if (ancho === alto || b.tipo === 'puerta') return -rot * PI / 2
  return rot % 2 ? 0 : -rot * PI / 2              // en rectángulos solo 0 y 180 cuadran con la rejilla
}

function situar (g, b) {
  const ancho = b.ancho ?? 2
  const alto = b.alto ?? 2
  const cx = b.x + (ancho - 1) / 2
  const cz = b.z + (alto - 1) / 2
  const w = gridAMundo(cx, cz)
  g.position.set(w.x, alturaEn(cx, cz), w.z)
  g.rotation.y = giroDe(b, ancho, alto)
}

function registrarAnim (g, id) {
  g.traverse((o) => {
    if (!tieneAnim(o)) return
    animados.push({
      id,
      obj: o,
      tipo: o.userData.anim,
      fase: Math.random() * 6.283,
      vel: 0.8 + Math.random() * 0.5,
      bx: o.rotation.x,
      by: o.rotation.y,
      bz: o.rotation.z,
      sy: o.scale.y
    })
  })
}

function olvidarAnim (id) {
  for (let i = animados.length - 1; i >= 0; i--) if (animados[i].id === id) animados.splice(i, 1)
}

function tween (g, tipo, dur, alAcabar) {
  tweens.push({ g, tipo, k: 0, dur, alAcabar })
}

/** Dibuja (o redibuja) un edificio. `efecto` da el plop, la mejora o nada. */
function pintar (b, efecto = null) {
  const viejo = mallas.get(b.id)
  const g = crearEdificio(b.tipo, Math.max(1, b.nivel), {
    estado: estadoDe(b),
    mask: b.tipo === 'muralla' ? mascaraEn(b.x, b.z) : 0
  })
  g.userData.buildingId = b.id     // scene.js sube por los padres hasta encontrarlo
  g.name = `${b.tipo}:${b.id}`
  situar(g, b)
  aEscena(g)
  registrarAnim(g, b.id)
  mallas.set(b.id, { g, firma: firmaDe(b) })

  if (viejo) {
    olvidarAnimDe(viejo.g, b.id)
    if (efecto === 'mejora') {
      tween(viejo.g, 'encoger', 0.28, () => desmontar(viejo.g))
      tween(g, 'plop', 0.45)
    } else {
      desmontar(viejo.g)
      if (efecto === 'plop') tween(g, 'plop', 0.45)
    }
  } else if (efecto) {
    tween(g, 'plop', efecto === 'mejora' ? 0.45 : 0.4)
  }
  return g
}

/** El grupo viejo y el nuevo comparten id: hay que limpiar solo las piezas del viejo. */
function olvidarAnimDe (gViejo, id) {
  for (let i = animados.length - 1; i >= 0; i--) {
    if (animados[i].id !== id) continue
    let o = animados[i].obj
    while (o) { if (o === gViejo) { animados.splice(i, 1); break } o = o.parent }
  }
}

function borrar (id, conDerrumbe = false) {
  const m = mallas.get(id)
  if (!m) return
  mallas.delete(id)
  olvidarAnim(id)
  if (conDerrumbe) tween(m.g, 'derrumbe', 0.5, () => desmontar(m.g))
  else desmontar(m.g)
}

/** Pasada completa: crea lo que falta, redibuja lo que cambió y borra lo que ya no está. */
function sincronizar (conEfecto = false) {
  reindexar()
  const vistos = new Set()
  for (const b of game.state.buildings) {
    vistos.add(b.id)
    const m = mallas.get(b.id)
    if (!m) pintar(b, conEfecto ? 'plop' : null)
    else if (m.firma !== firmaDe(b)) pintar(b)
  }
  for (const id of [...mallas.keys()]) if (!vistos.has(id)) borrar(id)
}

/** Tras tocar una muralla hay que repasar a sus vecinas: el trozo cambia de forma. */
function refrescarVecinas (b) {
  if (!b || !ANCLAJES.has(b.tipo)) return
  const a = b.ancho ?? 1; const h = b.alto ?? 1
  for (const otro of game.state.buildings) {
    if (otro.tipo !== 'muralla' || otro.id === b.id) continue
    if (otro.x >= b.x - 1 && otro.x <= b.x + a && otro.z >= b.z - 1 && otro.z <= b.z + h) {
      const m = mallas.get(otro.id)
      if (m && m.firma !== firmaDe(otro)) pintar(otro)
    }
  }
}

/** Redibuja la aldea entera: cambio de edad o de calidad. */
function redibujarTodo () {
  for (const id of [...mallas.keys()]) borrar(id)
  cacheModelos.clear()
  sincronizar()
}

// ── animaciones (un solo onFrame para toda la aldea, cero objetos por frame) ──

function animar (dt, t) {
  for (let i = 0; i < animados.length; i++) {
    const a = animados[i]
    switch (a.tipo) {
      case 'aspas':
        a.obj.rotation.z += dt * 0.9 * a.vel
        break
      case 'bandera':
        a.obj.rotation.y = a.by + Math.sin(t * 2.1 * a.vel + a.fase) * 0.3
        a.obj.rotation.z = a.bz + Math.sin(t * 3.3 + a.fase) * 0.07
        break
      case 'toldo':
        a.obj.rotation.x = a.bx + Math.sin(t * 1.7 + a.fase) * 0.06
        break
      case 'llama':
        a.obj.scale.y = a.sy * (1 + Math.sin(t * 7 + a.fase) * 0.22)
        a.obj.rotation.y = a.by + Math.sin(t * 4 + a.fase) * 0.25
        break
    }
  }

  for (let i = tweens.length - 1; i >= 0; i--) {
    const w = tweens[i]
    w.k += dt / w.dur
    const k = Math.min(1, w.k)
    if (w.tipo === 'plop') {
      // rebote corto: aparece cayendo y asienta. Es la recompensa de tocar "construir".
      const c = 2.2
      const s = 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2)
      w.g.scale.set(Math.max(0.02, s), Math.max(0.02, s * (2 - s)), Math.max(0.02, s))
    } else if (w.tipo === 'encoger') {
      const s = Math.max(0.01, 1 - k)
      w.g.scale.set(s, s, s)
    } else if (w.tipo === 'derrumbe') {
      w.g.scale.set(1 - k * 0.35, Math.max(0.01, 1 - k), 1 - k * 0.35)
      w.g.rotation.z = k * 0.25
      w.g.position.y -= dt * 0.35
    }
    if (k >= 1) {
      if (w.tipo === 'plop') w.g.scale.set(1, 1, 1)
      if (w.alAcabar) w.alAcabar()
      tweens.splice(i, 1)
    }
  }
}

// ── fantasma de colocación ───────────────────────────────────────────────

let fantasma = null
let fantasmaTipo = null
let fantasmaValido = null
let modo = { activo: false, tipo: null }
// El fantasma persigue su casilla con un pelín de retraso: saltar de golpe entre
// casillas se ve a tirones. SUAVE_FANTASMA alto = pega el salto casi entero en un
// frame, lo justo para que se note vivo pero sin retardo perceptible.
const SUAVE_FANTASMA = 26
const metaFantasma = new THREE.Vector3()
let bajaFantasma = null

function pintarFantasma (tipo) {
  const d = def(tipo) || {}
  const g = crearEdificio(tipo, 1, { mask: tipo === 'muralla' ? 15 : 0 })
  // huella en el suelo: sin ella no se sabe qué casillas ocupa
  const huella = caja(M.fantasmaOk, 0, -0.02, 0, (d.ancho ?? 2) - 0.04, 0.05, (d.alto ?? 2) - 0.04)
  huella.castShadow = false
  g.add(huella)
  g.traverse((o) => { o.castShadow = false; o.receiveShadow = false })
  g.userData.ignorarPicking = true
  g.renderOrder = 3
  return g
}

/** El edificio semitransparente que sigue al dedo mientras colocas. */
export function mostrarFantasma (tipo, x, z, valido = true, rot = 0) {
  if (!tipo) return ocultarFantasma()
  let recienCreado = false
  if (tipo !== fantasmaTipo) {
    if (fantasma) desmontar(fantasma)
    fantasma = pintarFantasma(tipo)
    fantasmaTipo = tipo
    fantasmaValido = null
    recienCreado = true
    aEscena(fantasma)
    bajaFantasma = bajaFantasma || onFrame(seguirFantasma)
  }
  if (valido !== fantasmaValido) {
    fantasmaValido = valido
    const m = valido ? M.fantasmaOk : M.fantasmaMal
    fantasma.traverse((o) => { if (o.isMesh) o.material = m })
  }
  const d = def(tipo) || {}
  // Al girar, el edificio ocupa las casillas al revés: el fantasma debe enseñar
  // la huella de verdad, o el jugador coloca a ciegas.
  const giro = (rot | 0) % 4
  const ancho = giro % 2 ? (d.alto ?? 2) : (d.ancho ?? 2)
  const alto = giro % 2 ? (d.ancho ?? 2) : (d.alto ?? 2)
  const cx = x + (ancho - 1) / 2
  const cz = z + (alto - 1) / 2
  const w = gridAMundo(cx, cz)
  metaFantasma.set(w.x, alturaEn(cx, cz) + 0.02, w.z)
  if (recienCreado || !fantasma.visible) fantasma.position.copy(metaFantasma)
  fantasma.rotation.y = -giro * Math.PI / 2
  fantasma.visible = true
}

/** Persigue la casilla objetivo. Suavizado independiente de los FPS. */
function seguirFantasma (dt) {
  if (!fantasma || !fantasma.visible) return
  const k = 1 - Math.exp(-SUAVE_FANTASMA * dt)
  fantasma.position.lerp(metaFantasma, k)
  if (fantasma.position.distanceToSquared(metaFantasma) < 1e-6) fantasma.position.copy(metaFantasma)
}

export function ocultarFantasma () {
  if (fantasma) { desmontar(fantasma); fantasma = null }
  bajaFantasma?.()
  bajaFantasma = null
  fantasmaTipo = null
  fantasmaValido = null
}

// ── arranque y enganche con el estado ────────────────────────────────────

export async function init () {
  try {
    const terreno = await import('./terrain.js')
    if (typeof terreno.alturaEn === 'function') alturaEn = terreno.alturaEn
  } catch { /* sin terreno: todo a ras de suelo */ }

  const nivelDeEdad = { oscura: 0, feudal: 1, castillos: 2, imperial: 3 }
  edadVisual = nivelDeEdad[game.state.age] ?? 0

  events.on(EV.BUILD_PLACED, ({ building, movido }) => {
    if (!building) return
    reindexar()
    if (movido) {
      const m = mallas.get(building.id)
      if (m) { situar(m.g, building); m.firma = firmaDe(building); tween(m.g, 'plop', 0.3) }
      else pintar(building, 'plop')
    } else {
      pintar(building, 'plop')
    }
    refrescarVecinas(building)
  })

  events.on(EV.BUILD_COMPLETED, ({ building }) => {
    if (!building) return
    reindexar()
    pintar(building, 'plop')            // fuera el andamio, entra el edificio de verdad
    refrescarVecinas(building)
  })

  events.on(EV.BUILD_UPGRADED, ({ building }) => {
    if (!building) return
    pintar(building, 'mejora')
    refrescarVecinas(building)
  })

  events.on(EV.BUILD_DEMOLISHED, ({ buildingId }) => {
    const b = game.state.buildings.find(x => x.id === buildingId)
    borrar(buildingId, true)
    reindexar()
    if (b) refrescarVecinas(b)
    else setTimeout(() => sincronizar(), 520)
  })

  events.on(EV.STATE_LOADED, () => {
    edadVisual = nivelDeEdad[game.state.age] ?? 0
    redibujarTodo()
  })

  events.on(EV.EDAD_VISUAL, (p) => {
    const nuevo = p && typeof p.nivelVisual === 'number' ? p.nivelVisual : (nivelDeEdad[p && p.age] ?? edadVisual)
    if (nuevo === edadVisual) return
    edadVisual = nuevo
    redibujarTodo()                     // la aldea entera cambia de materiales
  })

  events.on(EV.AGE_ADVANCED, ({ age }) => {
    const nuevo = nivelDeEdad[age] ?? edadVisual
    if (nuevo === edadVisual) return
    edadVisual = nuevo
    redibujarTodo()
  })

  events.on(EV.BUILD_MODE, ({ activo, tipo }) => {
    modo = { activo: !!activo, tipo: tipo || null }
    if (!modo.activo || !modo.tipo) ocultarFantasma()
  })

  events.on(EV.GRID_TAP, ({ x, z }) => {
    if (!modo.activo || !modo.tipo) return
    const d = def(modo.tipo)
    if (!d) return
    mostrarFantasma(modo.tipo, x, z, huecoLibre(game.state, x, z, d.ancho ?? 2, d.alto ?? 2))
  })

  // El panel de construcción ya sabe si la casilla vale y con qué giro: le hacemos
  // caso a él antes que a nuestra propia comprobación, porque también lleva la
  // cuenta de constructores libres y del giro que el jugador ha elegido.
  events.on(EV.BUILD_GHOST, ({ tipo, x, z, rot, valido }) => {
    if (!modo.activo || !tipo) return
    modo.rot = rot | 0
    mostrarFantasma(tipo, x, z, valido !== false, rot | 0)
  })

  // red de seguridad: cambios que nadie anuncia (ruinas de un asalto, cargas raras)
  let acumulado = 0
  events.on(EV.TICK, ({ dt }) => {
    acumulado += dt || 0.25
    if (acumulado < 2) return
    acumulado = 0
    if (mallas.size !== game.state.buildings.length) { sincronizar(); return }
    for (const b of game.state.buildings) {
      const m = mallas.get(b.id)
      if (!m || m.firma !== firmaDe(b)) { sincronizar(); return }
    }
  })

  cuandoListo(() => {
    sincronizar()
    onFrame(animar)
  })
}

export default { init, crearEdificio, mostrarFantasma, ocultarFantasma }
