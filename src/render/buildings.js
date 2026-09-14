import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETA } from '../core/config.js'
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { gridAMundo, huecoLibre } from '../core/grid.js'
import { def } from '../data/buildings.js'
import { ctx, aEscena, onFrame, cuandoListo } from './ctx.js'
import { mat, M, G, pieza, geoCajaCh, geoTejado2, geoHastial, geoTejado4, geoAguja, geoBulbo, geoZocalo } from './mats.js'

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

/**
 * TONO 0..4: la categoría de los materiales. Sube CUATRO veces a lo largo de
 * la vida del edificio (al 25%, 50%, 75% y 100% de sus niveles) y cada subida
 * cambia el color del muro Y el del tejado. Es el cambio de nivel más barato
 * que existe —no añade ni un triángulo— y el que más se ve de lejos.
 */
function tonoDe (nivel, maxNivel = 8) {
  const n = Math.max(1, nivel)
  if (maxNivel <= 1) return edadVisual >= 2 ? 2 : 1
  const r = (n - 1) / Math.max(1, maxNivel - 1)
  let e = Math.min(4, Math.floor(r * 4.999))
  if (edadVisual >= 3 && e < 4) e++
  return e
}

/**
 * Escalón ESTRUCTURAL 0..2 (empalizada / sillería / almenas). Manda en la
 * FORMA, no en el color, así que va aparte del tono y cambia menos veces.
 */
const escalonDeTono = (tono) => (tono >= 3 ? 2 : tono >= 2 ? 1 : 0)

/**
 * FAMILIA VISUAL de cada edificio: es el código de color que hace que la aldea
 * se lea de un vistazo. El tejado dice la función antes de que el jugador
 * distinga ningún detalle.
 *   centro   → teja roja y azul heráldico   (ayuntamiento, casas, pozo)
 *   recursos → tablilla de madera y verde   (bosque, campo, mina, mercado)
 *   militar  → teja granate y acero         (cuartel, arquería, herrería…)
 *   noble    → azul y cobre                 (universidad, monasterio)
 *   defensa  → piedra y pizarra             (torres, castillo, muralla)
 */
const FAMILIA = {
  ayuntamiento: 'centro', casa: 'centro', pozo: 'centro', estandarte: 'centro',
  serreria: 'recursos', cantera: 'recursos', granja: 'recursos', mina_oro: 'recursos',
  molino: 'recursos', almacen: 'recursos', granero: 'recursos', mercado: 'recursos',
  cuartel: 'militar', arqueria: 'militar', establo: 'militar', taller_asedio: 'militar',
  herreria: 'militar', campamento_explorador: 'militar',
  universidad: 'noble', monasterio: 'noble',
  torre_vigia: 'defensa', torre_ballesta: 'defensa', castillo: 'defensa',
  // el puesto de frontera es un poblado, no una fortaleza: madera, teja y
  // estandarte, para que cante sobre el verde apagado del barbecho
  puesto_avanzado: 'centro',
  muralla: 'defensa', puerta: 'defensa',
  // el foso es defensa, pero de tierra y agua: su paleta la pone él mismo
  foso: 'defensa'
}

/**
 * Tejado de cada familia en los CINCO tonos. La familia manda en el color
 * (verde para recursos, granate para militar…) y el tono en su categoría:
 * paja -> tablilla -> teja -> teja vieja -> pizarra.
 */
const TONOS = {
  centro: { techo: [PALETA.paja, PALETA.tejaMadera, PALETA.tejado, PALETA.tejadoOscuro, PALETA.pizarra], acento: PALETA.telaAzul },
  recursos: { techo: [PALETA.paja, PALETA.tejaMadera, PALETA.tejaMaderaOscura, PALETA.pizarraClara, PALETA.pizarra], acento: PALETA.telaVerde },
  militar: { techo: [PALETA.cuero, PALETA.tejaMaderaOscura, PALETA.tejado, PALETA.tejadoOscuro, PALETA.pizarra], acento: PALETA.tela },
  noble: { techo: [PALETA.tejado, PALETA.tejadoAzul, PALETA.tejadoAzulOscuro, PALETA.cobre, PALETA.pizarra], acento: PALETA.cobre },
  defensa: { techo: [PALETA.tejaMaderaOscura, PALETA.piedraOscura, PALETA.pizarraClara, PALETA.pizarra, PALETA.tejadoAzulOscuro], acento: PALETA.telaAzul }
}

const cachePaleta = new Map()

/** Materiales del escalón y de la familia. Se comparten: nadie crea materiales por edificio. */
function paletaDe (t, familia = 'centro') {
  const clave = `${t}|${familia}`
  if (cachePaleta.has(clave)) return cachePaleta.get(clave)
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
  const e = Math.min(4, Math.max(0, t))
  const est = escalonDeTono(e)
  // La defensa es de cantería desde el primer día: una torre de adobe no cuela.
  const esDefensa = familia === 'defensa'
  // El muro sube de categoría en cada tono: adobe crudo, adobe encalado, yeso,
  // sillería y sillería de buena piedra. Cuatro saltos de color, gratis.
  const porTono = [
    { muro: esDefensa ? M.piedra : mat(PALETA.adobe), muroAlt: esDefensa ? M.piedraOscura : M.madera, zocalo: M.piedraOscura, suelo: M.tierra },
    { muro: esDefensa ? M.piedra : mat(PALETA.telaCruda), muroAlt: esDefensa ? M.piedraOscura : M.madera, zocalo: M.piedraOscura, suelo: M.tierra },
    { muro: esDefensa ? M.piedra : M.yeso, muroAlt: esDefensa ? M.piedraOscura : mat(PALETA.adobe), zocalo: M.piedra, suelo: M.camino },
    { muro: M.piedra, muroAlt: esDefensa ? M.piedraOscura : mat(PALETA.adobe), zocalo: M.piedra, suelo: M.camino },
    { muro: M.piedra, muroAlt: M.piedraOscura, zocalo: M.piedraOscura, suelo: M.camino }
  ][e]
  const tono = TONOS[familia] || TONOS.centro
  const p = {
    ...comun,
    ...porTono,
    techo: mat(tono.techo[e]),
    techoAlt: mat(tono.techo[Math.min(4, e + 1)]),
    // El acento es LA seña de color de la familia: banderas, toldos, remates.
    acento: mat(tono.acento),
    // Un único tono oscuro por edificio (vigas, herrajes, huecos): así los
    // detalles no multiplican las llamadas de dibujo.
    oscuro: familia === 'militar' || familia === 'defensa' ? M.hierro : mat(PALETA.entramado),
    // Los remates (bolas, faroles, pináculos, filos) son de madera hasta que el
    // edificio entra en el último cuarto de sus niveles: ahí se vuelven de ORO
    // sin una línea de código más. Es el premio visual de llegar al tope.
    remate: e >= 3 ? M.oro : (esDefensa ? M.piedra : M.madera),
    // Vidriera: apagada en los tonos bajos, encendida cuando el edificio ya es
    // de piedra. De noche es lo único que brilla en la aldea.
    vidrio: mat(PALETA.vidriera, { emisivo: e >= 3 ? 0x1d3a52 : 0x000000 }),
    t: est,
    tono: e,
    fam: familia
  }
  cachePaleta.set(clave, p)
  return p
}

// ── helpers geométricos (la `y` que reciben SIEMPRE es la base, no el centro) ──

/** Caja apoyada en `y`. El ladrillo de los DETALLES pequeños. */
const caja = (m, x, y, z, sx, sy, sz, ry = 0) => pieza(G.caja, m, { x, y: y + sy / 2, z, sx, sy, sz, ry })

/**
 * Caja con los cantos verticales achaflanados, apoyada en `y`. Es la que se usa
 * para TODO volumen grande (muros, zócalos, torres): el chaflán es lo que quita
 * de golpe la sensación de "montón de cajas".
 */
const cajaR = (m, x, y, z, sx, sy, sz, ry = 0, ch = 0.09) =>
  pieza(geoCajaCh(sx, sy, sz, ch), m, { x, y: y + sy / 2, z, ry })

const cil = (m, x, y, z, d, h, ry = 0) => pieza(G.cilindro, m, { x, y: y + h / 2, z, sx: d, sy: h, sz: d, ry })
const cil6 = (m, x, y, z, d, h, ry = 0) => pieza(G.cilindro6, m, { x, y: y + h / 2, z, sx: d, sy: h, sz: d, ry })
/** Torreón, pozo, chimenea: doce caras y ya se lee redondo desde el móvil. */
const cil12 = (m, x, y, z, d, h, ry = 0) => pieza(G.cilindro12, m, { x, y: y + h / 2, z, sx: d, sy: h, sz: d, ry })
/** Fuste que se estrecha hacia arriba: molino y torres esbeltas. */
const fuste = (m, x, y, z, d, h, ry = 0) => pieza(G.fuste12, m, { x, y: y + h / 2, z, sx: d, sy: h, sz: d, ry })
const leno = (m, x, y, z, d, h, ry = 0) => pieza(G.tronco, m, { x, y: y + h / 2, z, sx: d, sy: h, sz: d, ry })
/** Tronco tumbado, apoyado en `y`: a lo largo de X o de Z. */
const lenoX = (m, x, y, z, d, largo) => pieza(G.tronco, m, { x, y: y + d / 2, z, sx: d, sy: largo, sz: d, rz: PI / 2 })
const lenoZ = (m, x, y, z, d, largo) => pieza(G.tronco, m, { x, y: y + d / 2, z, sx: d, sy: largo, sz: d, rx: PI / 2 })
const roca = (m, x, y, z, d, ry = 0) => pieza(G.esfera, m, { x, y: y + d * 0.32, z, sx: d, sy: d * 0.8, sz: d, ry })

/**
 * TEJADOS. Todos nacen del mismo perfil curvo: empinado en la cumbrera,
 * tendido en el alero y volando por fuera del muro. Es lo que da el aire de
 * juguete de Clash of Clans sin renunciar a la cara plana de Stellar Settlers.
 * La `y` que reciben sigue siendo el arranque (la línea del alero).
 */
/** Capirote cónico con panza y alero: la silueta que dice "torreón" desde lejos. */
const techoCono = (m, x, y, z, d, alt, lados = 8) => pieza(geoAguja(lados), m, { x, y, z, sx: d, sy: alt, sz: d })

/**
 * Cuatro aguas sobre rectángulo: silueta compacta, sin hastiales. Se le sube
 * una PENDIENTE MÍNIMA: a cuatro aguas el faldón se ve mucho más tumbado que a
 * dos, y con la altura que pedían los edificios el tejado quedaba de plato.
 */
const techo4Aguas = (m, x, y, z, ancho, prof, alt) =>
  pieza(geoTejado4(), m, { x, y, z, sx: ancho * 1.4143, sy: Math.max(alt * 1.12, Math.min(ancho, prof) * 0.42), sz: prof * 1.4143 })

/** Triángulo del hastial: un cono de 4 lados aplastado en Z es exactamente eso. */
const hastial = (m, x, y, z, ancho, alt, gro = 0.16) =>
  pieza(G.cono, m, { x, y: y + alt / 2, z, sx: ancho, sy: alt, sz: gro })

/**
 * ARCO DE MEDIO PUNTO. Medio cilindro de ocho caras: puertas, ventanas, arquerías
 * y soportales. Es lo que separa un edificio "de verdad" de una caja con un
 * rectángulo oscuro pintado. `y` es el arranque del arco (la línea de imposta).
 */
const arco = (m, x, y, z, luz, gro) => pieza(G.arco, m, { x, y, z, sx: luz, sy: luz, sz: gro })

/** Hueco de puerta/ventana ya completo: jamba recta + arco arriba. */
function hueco (l, m, x, y, z, luz, alto, gro = 0.06) {
  l.push(caja(m, x, y, z, luz, alto, gro))
  l.push(arco(m, x, y + alto, z, luz, gro))
}

/** Bóveda de cañón: el mismo medio cilindro, pero a tamaño de tejado. */
const boveda = (m, x, y, z, ancho, prof) => pieza(G.arco, m, { x, y, z, sx: ancho, sy: ancho, sz: prof })

/**
 * Tejado a dos aguas: dos losas inclinadas con vuelo, CABALLETE redondeado y
 * canto de alero. El caballete corre en Z, así que los hastiales miran a ±Z.
 * El cilindro de la cumbrera es barato y es lo que da el aire de teja curva.
 */
const techo2Aguas = (m, x, y, z, ancho, prof, alt, vuelo = 0.16) =>
  pieza(geoTejado2(ancho, prof, alt, vuelo), m, { x, y, z })

/** Testero del tejado a dos aguas: MISMO perfil que el faldón, encaja al milímetro. */
const fronton = (m, x, y, z, ancho, alt, gro = 0.14) => pieza(geoHastial(ancho, alt, gro), m, { x, y, z })

/** Cúpula bulbosa (de cebolla): el remate que más carácter da a un edificio noble. */
const bulbo = (m, x, y, z, d, alt) => pieza(geoBulbo(10), m, { x, y, z, sx: d, sy: alt, sz: d })

/** Plinto con TODOS los cantos matados: lo que asienta el edificio en el suelo. */
const plinto = (m, x, y, z, sx, sy, sz, ch = 0.1) => pieza(geoZocalo(sx, sy, sz, ch), m, { x, y: y + sy / 2, z })

/** Cornisa: una losa fina que vuela sobre el muro. Da sombra y "acaba" el edificio. */
const cornisa = (m, x, y, z, sx, sz, gro = 0.09) => cajaR(m, x, y, z, sx, gro, sz, 0, 0.05)

/** Entramado de madera en una fachada. Cuatro piezas y ya parece medieval. */
function entramado (l, p, x, y, z, ancho, alt, prof) {
  const gro = 0.1
  const zf = z + prof / 2 + 0.015
  l.push(caja(p.oscuro, x, y + alt - gro, zf, ancho, gro, 0.05))
  l.push(caja(p.oscuro, x - ancho / 2 + gro / 2, y, zf, gro, alt, 0.05))
  l.push(caja(p.oscuro, x + ancho / 2 - gro / 2, y, zf, gro, alt, 0.05))
  l.push(pieza(G.caja, p.oscuro, {
    x, y: y + alt / 2, z: zf, sx: Math.hypot(ancho, alt) * 0.92, sy: gro, sz: 0.05, rz: Math.atan2(alt, ancho)
  }))
}

/** Almenas sobre un muro: la firma de la piedra de nivel alto. Merlones con el canto matado. */
function almenas (l, m, x, y, z, largo, prof, paso = 0.36, alt = 0.2, enZ = false) {
  const n = Math.max(3, Math.round(largo / paso) | 1)
  const d = largo / n
  for (let i = 0; i < n; i += 2) {
    const o = -largo / 2 + d / 2 + i * d
    // Merlón con caja simple: a este tamaño el chaflán no se distingue y son
    // 16 triángulos menos POR MERLÓN, y un castillo lleva cuarenta.
    l.push(enZ ? caja(m, x, y, z + o, prof, alt, d * 0.92) : caja(m, x + o, y, z, d * 0.92, alt, prof))
  }
}

/** Estandarte con la tela viva: el grupo `tela` pivota en lo alto del mástil. */
function bandera (p, mTela, x, y, z, alt = 1.0, ancho = 0.46) {
  const g = new THREE.Group()
  g.add(caja(p.madera, 0, 0, 0, 0.06, alt, 0.06))
  // la bola del mástil va del material de remate (madera abajo, oro arriba): así
  // una bandera no obliga a un material extra en cada edificio
  g.add(pieza(G.esfera, p.remate, { x: 0, y: alt + 0.05, z: 0, sx: 0.12, sy: 0.14, sz: 0.12 }))
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
  const h = 1.1 + 0.055 * n
  const y = SUELO + 0.2
  l.push(cajaR(p.zocalo, 0, SUELO, 0, 3.5, 0.2, 3.1, 0, 0.14))
  l.push(cajaR(p.muro, 0, y, 0, 3.0, h, 2.6, 0, 0.14))
  if (t < 2) entramado(l, p, 0, y, 0, 3.0, h, 2.6)
  l.push(cornisa(p.muroAlt, 0, y + h, 0, 3.3, 2.9, 0.13))
  // CUATRO AGUAS: es el único tejado grande de la aldea sin hastiales. Desde
  // arriba se lee como una pirámide y ya no se confunde con ningún almacén.
  l.push(techo4Aguas(p.techo, 0, y + h + 0.13, 0, 3.32, 2.92, 0.92))
  // soportal de arco de medio punto: empaque de casa consistorial
  l.push(cajaR(p.zocalo, 0, SUELO, 1.72, 2.3, 0.13, 0.7, 0, 0.07))
  const hc = h * 0.62
  // en el escalón de adobe el soportal es de madera; en piedra, de cantería
  const mPortico = t === 0 ? p.madera : p.zocalo
  for (const x of [-0.82, 0.82]) l.push(cil12(mPortico, x, SUELO + 0.13, 1.66, 0.3, hc))
  l.push(arco(mPortico, 0, SUELO + 0.13 + hc, 1.66, 1.64, 0.26))
  l.push(cornisa(p.techo, 0, SUELO + 0.13 + hc + 0.84, 1.66, 2.2, 0.8, 0.13))
  hueco(l, p.madera, 0, y, 1.32, 0.82, 0.62, 0.08)
  // TORRE DEL RELOJ CON CÚPULA DORADA: la seña que se ve desde cualquier zoom
  const yt = y + h + 0.13
  const ht = 1.0 + 0.05 * n
  l.push(cajaR(p.muro, 0, yt, -0.6, 1.0, ht, 1.0, 0, 0.12))
  l.push(cornisa(p.muroAlt, 0, yt + ht, -0.6, 1.2, 1.2, 0.12))
  l.push(bulbo(p.oro, 0, yt + ht + 0.12, -0.6, 1.12, 0.78))
  l.push(caja(p.oro, 0, yt + ht + 0.7, -0.6, 0.07, 0.36, 0.07))
  l.push(pieza(G.esfera, p.oro, { x: 0, y: yt + ht + 1.14, z: -0.6, sx: 0.17, sy: 0.21, sz: 0.17 }))
  // dos esferas de reloj, a las dos caras que mira la cámara del juego
  l.push(pieza(G.cilindro, p.oro, { x: 0, y: yt + ht * 0.62, z: -0.08, sx: 0.5, sy: 0.06, sz: 0.5, rx: PI / 2 }))
  l.push(pieza(G.cilindro, p.oro, { x: 0.52, y: yt + ht * 0.62, z: -0.6, sx: 0.5, sy: 0.06, sz: 0.5, rz: PI / 2 }))
  l.push(bandera(p, p.acento, -1.45, y, 1.3, 1.2, 0.44))
  l.push(bandera(p, p.acento, 1.45, y, 1.3, 1.2, 0.44))
  if (t >= 2) {
    almenas(l, p.muroAlt, 0, y + h + 0.13, 1.46, 3.3, 0.2, 0.44, 0.22)
    almenas(l, p.muroAlt, 0, y + h + 0.13, -1.46, 3.3, 0.2, 0.44, 0.22)
  }
  if (det) {
    hueco(l, p.oscuro, -1.05, y + 0.34, 1.32, 0.32, 0.3, 0.05)
    hueco(l, p.oscuro, 1.05, y + 0.34, 1.32, 0.32, 0.3, 0.05)
  }
  return l
}

function fCasa ({ p, n, t, det }) {
  const l = []
  const h = 0.6 + 0.055 * n
  const y = SUELO + 0.12
  const ht = 0.64 + 0.03 * n      // tejado MUY empinado: la casa es un pico, no un cajón
  l.push(cajaR(p.zocalo, 0, SUELO, 0, 1.55, 0.12, 1.45, 0, 0.1))
  l.push(cajaR(p.muro, 0, y, 0, 1.42, h, 1.32, 0, 0.1))
  if (t < 2) entramado(l, p, 0, y, 0, 1.42, h, 1.32)
  l.push(techo2Aguas(p.techo, 0, y + h, 0, 1.68, 1.48, ht))
  l.push(fronton(p.muroAlt, 0, y + h, 0.71, 1.68, ht))
  l.push(fronton(p.muroAlt, 0, y + h, -0.71, 1.68, ht))
  hueco(l, p.madera, -0.3, y, 0.67, 0.4, 0.4, 0.07)
  hueco(l, p.oscuro, 0.34, y + 0.28, 0.67, 0.32, 0.18, 0.05)
  // CHIMENEA REDONDA: en toda la aldea solo la casa tiene tubo cilíndrico
  const yc = y + h * 0.25
  l.push(cil12(p.zocalo, 0.46, yc, -0.46, 0.34, h * 0.85 + ht + 0.1))
  l.push(cil12(p.oscuro, 0.46, yc + h * 0.85 + ht + 0.1, -0.46, 0.42, 0.1))
  if (det) {
    l.push(barril(p, -0.6, SUELO, -0.5))
    lena(l, p, 0.3, SUELO, -0.66)
    l.push(caja(p.madera, 0.34, y + 0.24, 0.72, 0.36, 0.1, 0.12))       // jardinera
    l.push(roca(mat(PALETA.florRoja), 0.34, y + 0.32, 0.72, 0.2))
  }
  if (t >= 2) l.push(bandera(p, p.acento, 0.64, y, 0.64, 0.72, 0.3))
  return l
}

function fSerreria ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 0.88 + 0.04 * n
  // cobertizo A UN AGUA y abierto: ni tejado a dos aguas ni hastiales
  for (const x of [-1.15, 1.15]) for (const z of [-1.15, 0.15]) l.push(caja(p.madera, x, y, z, 0.16, h, 0.16))
  l.push(cajaR(p.muro, 0, y, -1.28, 2.6, h + 0.46, 0.3, 0, 0.08))
  // el faldón cae hacia el frente: el muro alto queda DEBAJO del alero, nunca asomando
  l.push(pieza(G.caja, p.techo, { x: 0, y: y + h + 0.62, z: -0.5, sx: 2.85, sy: 0.12, sz: 1.9, rx: 0.3 }))
  // RUEDA HIDRÁULICA girando: la seña de la serrería, visible desde arriba
  const rd = new THREE.Group()
  rd.position.set(-1.42, y + 0.72, 0.5)
  rd.userData.anim = 'rueda'
  rd.add(pieza(G.cilindro12, p.maderaClara, { x: 0, y: 0, z: 0, sx: 1.3, sy: 0.12, sz: 1.3, rz: PI / 2 }))
  rd.add(pieza(G.cilindro6, p.madera, { x: 0, y: 0, z: 0, sx: 0.26, sy: 0.5, sz: 0.26, rz: PI / 2 }))
  for (let i = 0; i < 8; i++) {
    const a = (i * PI) / 4
    rd.add(pieza(G.caja, p.madera, { x: 0, y: Math.sin(a) * 0.58, z: Math.cos(a) * 0.58, sx: 0.36, sy: 0.2, sz: 0.14, rx: -a }))
  }
  l.push(rd)
  l.push(cajaR(p.piedraOscura, -1.42, y - 0.02, 0.5, 0.6, 0.16, 1.5, 0, 0.07))   // canal del agua
  l.push(caja(mat(PALETA.agua), -1.42, y + 0.14, 0.5, 0.44, 0.05, 1.4))
  // TRONCOS APILADOS: madera en bruto, siempre visible
  for (let i = 0; i < 3; i++) l.push(lenoX(p.tronco, 0.45, y, 0.5 + i * 0.32, 0.32, 1.7))
  l.push(lenoX(p.tronco, 0.45, y + 0.3, 0.66, 0.32, 1.7))
  l.push(lenoX(p.tronco, 0.45, y + 0.3, 0.98, 0.32, 1.7))
  // sierra circular sobre su banco
  // el banco de la sierra va FUERA del cobertizo: si el disco queda bajo el
  // tejado, desde la cámara del juego no se ve y la serrería pierde su icono
  l.push(cajaR(p.maderaClara, 1.12, y, 0.72, 0.95, 0.44, 0.7, 0.3, 0.06))
  l.push(pieza(G.cilindro12, p.metal, { x: 1.12, y: y + 0.72, z: 0.72, sx: 0.7, sy: 0.05, sz: 0.7, rx: PI / 2, ry: 0.3 }))
  l.push(caja(p.metal, 1.12, y + 0.44, 0.72, 0.1, 0.3, 0.1))
  if (det) {
    for (let i = 0; i < 3; i++) l.push(caja(p.maderaClara, -0.45, y + i * 0.09, -0.75, 1.0, 0.08, 0.34, 0.07 * i))
    l.push(barril(p, 1.25, y, -0.8))
  }
  l.push(bandera(p, p.acento, 1.3, y, 1.25, 0.85, 0.32))
  return l
}

function fCantera ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  // SIN TEJADO: una cantera es un hoyo, y eso sola ya la separa del resto
  l.push(cajaR(p.tierra, -0.45, y - 0.05, -0.45, 1.9, 0.1, 1.9, 0, 0.2))
  l.push(roca(p.piedraOscura, -0.95, y, -0.95, 1.1, 0.4))
  l.push(roca(p.piedraOscura, -0.1, y, -1.05, 0.85, 1.1))
  l.push(roca(p.piedra, -1.1, y + 0.3, -0.25, 0.75, 0.6))
  // SILLARES CORTADOS en pila ordenada: el contrapunto geométrico al pedrusco
  for (let i = 0; i < 3; i++) l.push(cajaR(p.piedra, 0.8, y + i * 0.27, 0.62, 0.66, 0.27, 0.54, 0.07 * i, 0.05))
  l.push(cajaR(p.piedra, 0.8, y, 1.1, 0.66, 0.27, 0.44, 0, 0.05))
  l.push(cajaR(p.piedra, 0.12, y, 0.9, 0.54, 0.25, 0.48, 0.3, 0.05))
  l.push(cajaR(p.piedra, 0.12, y + 0.25, 0.9, 0.46, 0.22, 0.4, 0.5, 0.05))
  // GRÚA DE MADERA alta: la silueta vertical de la cantera
  l.push(caja(p.madera, 0.95, y, -0.75, 0.18, 1.85, 0.18))
  l.push(pieza(G.caja, p.madera, { x: 0.45, y: y + 1.78, z: -0.75, sx: 1.5, sy: 0.13, sz: 0.13, rz: -0.16 }))
  l.push(pieza(G.caja, p.madera, { x: 0.72, y: y + 1.1, z: -0.75, sx: 1.0, sy: 0.1, sz: 0.1, rz: 0.9 }))
  l.push(caja(p.oscuro, -0.05, y + 1.1, -0.75, 0.04, 0.62, 0.04))
  l.push(cajaR(p.piedra, -0.05, y + 0.85, -0.75, 0.34, 0.26, 0.34, 0.2, 0.05))
  // carretilla
  l.push(cajaR(p.maderaClara, -0.65, y + 0.26, 1.0, 0.58, 0.28, 0.42, 0.4, 0.05))
  l.push(rueda(p, -0.9, y, 0.9, 0.32))
  if (det) {
    l.push(pieza(G.caja, p.metal, { x: 0.35, y: y + 0.5, z: -0.25, sx: 0.5, sy: 0.06, sz: 0.06, rz: 0.8 }))
    l.push(roca(p.piedra, 0.3, y, -0.5, 0.3))
    l.push(roca(p.piedra, -0.2, y, 0.3, 0.24))
  }
  return l
}

function fGranja ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  l.push(cajaR(p.tierra, 0, y - 0.02, 0.15, 2.75, 0.08, 2.45, 0, 0.16))
  // BANCALES DE TRIGO en franjas: se leen perfectamente desde arriba
  const franjas = det ? 5 : 4
  for (let i = 0; i < franjas; i++) {
    const z = -0.95 + (i * 2.2) / (franjas - 1)
    l.push(caja(p.trigo, 0, y + 0.02, z, 2.5, 0.24 + 0.02 * (i % 2) + 0.02 * n, 0.26))
    l.push(caja(p.tierra, 0, y, z + 0.24, 2.5, 0.05, 0.14))
  }
  // espantapájaros
  l.push(caja(p.madera, -1.0, y, -1.15, 0.09, 1.05, 0.09))
  l.push(caja(p.madera, -1.0, y + 0.7, -1.15, 0.82, 0.08, 0.08))
  l.push(caja(p.acento, -1.0, y + 0.62, -1.15, 0.44, 0.44, 0.2))
  l.push(pieza(G.esfera, p.paja, { x: -1.0, y: y + 1.12, z: -1.15, sx: 0.32, sy: 0.32, sz: 0.32 }))
  l.push(techoCono(p.madera, -1.0, y + 1.26, -1.15, 0.5, 0.24))
  // cerca baja de estacas redondas
  for (let i = 0; i < 5; i++) l.push(cil6(p.madera, -1.4 + i * 0.7, y, 1.38, 0.1, 0.44))
  l.push(caja(p.madera, 0, y + 0.3, 1.38, 3.0, 0.06, 0.06))
  if (t >= 1) {
    // pajar pequeño, para que la granja tenga algo de volumen
    l.push(cajaR(p.muro, 1.05, y, -1.05, 0.9, 0.62, 0.78, 0, 0.08))
    l.push(techo2Aguas(p.techo, 1.05, y + 0.62, -1.05, 1.05, 0.9, 0.36))
  }
  if (det) {
    l.push(roca(p.paja, 0.55, y, -1.3, 0.55))
    l.push(roca(p.paja, 0.1, y, -1.25, 0.42))
  }
  return l
}

function fMinaOro ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  // el cerro con la bocamina
  // el cerro, contenido dentro de la parcela: unos pedruscos enormes se comían
  // media aldea desde la cámara de juego
  l.push(roca(p.piedraOscura, -0.1, y, -1.0, 1.7, 0.3))
  l.push(roca(p.piedraOscura, -1.0, y, -0.45, 1.1, 1.0))
  l.push(roca(p.piedra, 0.95, y + 0.05, -0.75, 0.85, 0.6))
  l.push(caja(p.oscuro, 0, y, 0.02, 0.9, 0.9, 0.5))
  l.push(arco(p.oscuro, 0, y + 0.9, 0.02, 0.9, 0.5))
  // CASTILLETE: la torre de madera sobre la bocamina, seña vertical de la mina
  for (const sx of [-1, 1]) {
    l.push(pieza(G.caja, p.madera, { x: sx * 0.6, y: y + 0.85, z: 0.34, sx: 0.15, sy: 1.75, sz: 0.15, rz: sx * 0.1 }))
    l.push(pieza(G.caja, p.madera, { x: sx * 0.52, y: y + 0.85, z: -0.3, sx: 0.13, sy: 1.7, sz: 0.13, rz: sx * 0.1 }))
  }
  l.push(caja(p.madera, 0, y + 1.7, 0.34, 1.4, 0.16, 0.16))
  l.push(caja(p.madera, 0, y + 1.7, -0.3, 1.3, 0.16, 0.16))
  l.push(pieza(G.cilindro12, p.maderaClara, { x: 0, y: y + 1.82, z: 0.02, sx: 0.5, sy: 0.28, sz: 0.5, rz: PI / 2 }))
  l.push(caja(p.oscuro, 0, y + 1.0, 0.2, 0.04, 0.8, 0.04))
  // VETAS Y CARGA DE ORO bien a la vista
  l.push(pieza(G.esfera, p.oro, { x: -1.0, y: y + 0.78, z: -0.6, sx: 0.32, sy: 0.22, sz: 0.32 }))
  l.push(pieza(G.esfera, p.oro, { x: 0.8, y: y + 0.58, z: -1.05, sx: 0.26, sy: 0.18, sz: 0.26 }))
  // vagoneta sobre raíles
  l.push(caja(p.madera, -0.22, y, 1.05, 0.09, 0.05, 1.3))
  l.push(caja(p.madera, 0.22, y, 1.05, 0.09, 0.05, 1.3))
  l.push(cajaR(p.metal, 0, y + 0.22, 1.2, 0.7, 0.42, 0.58, 0, 0.06))
  l.push(pieza(G.esfera, p.oro, { x: 0, y: y + 0.64, z: 1.2, sx: 0.44, sy: 0.22, sz: 0.36 }))
  l.push(rueda(p, -0.22, y, 1.38, 0.24))
  l.push(rueda(p, 0.22, y, 1.38, 0.24))
  if (det) {
    l.push(caja(p.madera, -1.2, y, 0.95, 0.12, 0.9, 0.12))
    l.push(pieza(G.esfera, p.brasa, { x: -1.2, y: y + 0.95, z: 0.95, sx: 0.2, sy: 0.22, sz: 0.2 }))
    l.push(roca(p.piedra, 1.15, y, 0.75, 0.4))
  }
  return l
}

function fMolino ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 1.75 + 0.12 * n       // el más ESBELTO de la aldea
  l.push(cil12(p.zocalo, 0, y, 0, 1.32, 0.18))
  l.push(fuste(p.muro, 0, y + 0.18, 0, 1.16, h))
  l.push(cil12(p.remate, 0, y + 0.18 + h * 0.52, 0, 1.06, 0.09))
  l.push(cil12(p.muroAlt, 0, y + 0.18 + h, 0, 1.06, 0.12))
  l.push(techoCono(p.techo, 0, y + 0.3 + h, 0, 1.12, 0.72))
  l.push(pieza(G.esfera, p.remate, { x: 0, y: y + 1.02 + h, z: 0, sx: 0.16, sy: 0.2, sz: 0.16 }))
  hueco(l, p.madera, 0, y + 0.18, 0.5, 0.38, 0.46, 0.08)
  hueco(l, p.oscuro, 0, y + 0.18 + h * 0.62, 0.46, 0.24, 0.14, 0.06)
  // ASPAS: giran de verdad; es la seña del molino a cualquier zoom
  const aspas = new THREE.Group()
  aspas.position.set(0, y + 0.2 + h * 0.88, 0.56)
  aspas.userData.anim = 'aspas'
  aspas.add(pieza(G.cilindro, p.oscuro, { x: 0, y: 0, z: -0.06, sx: 0.24, sy: 0.24, sz: 0.24, rx: PI / 2 }))
  for (let i = 0; i < 4; i++) {
    const brazo = new THREE.Group()
    brazo.rotation.z = (i * PI) / 2
    brazo.add(caja(p.madera, 0, 0.06, 0, 0.1, 1.45, 0.05))
    brazo.add(caja(p.telaCruda, 0.14, 0.32, -0.02, 0.28, 1.02, 0.03))
    aspas.add(brazo)
  }
  l.push(aspas)
  // sacos de harina al pie: recurso a la vista
  l.push(roca(p.paja, -0.76, y, 0.62, 0.44))
  l.push(roca(p.paja, -0.52, y, 0.86, 0.38))
  if (det) l.push(barril(p, 0.78, y, -0.62))
  return l
}

function fAlmacen ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 0.62 + 0.04 * n
  // BÓVEDA DE CAÑÓN: medio cilindro de punta a punta. Es el único tejado curvo
  // de la aldea, así que el almacén no se puede confundir con nada.
  l.push(cajaR(p.zocalo, 0, y, 0, 2.75, 0.16, 2.35, 0, 0.12))
  l.push(cajaR(p.muro, 0, y + 0.16, 0, 2.55, h, 2.15, 0, 0.12))
  l.push(cornisa(p.muroAlt, 0, y + 0.16 + h, 0, 2.8, 2.4, 0.11))
  l.push(boveda(p.techo, 0, y + 0.27 + h, 0, 2.8, 2.45))
  l.push(pieza(G.cilindro6, p.techoAlt, { x: 0, y: y + 0.27 + h + 1.4, z: 0, sx: 0.18, sy: 2.45, sz: 0.18, rx: PI / 2 }))
  // el tímpano de la bóveda, con el portón arqueado dentro
  l.push(arco(p.muroAlt, 0, y + 0.27 + h, 1.2, 2.78, 0.1))
  l.push(arco(p.muroAlt, 0, y + 0.27 + h, -1.2, 2.78, 0.1))
  hueco(l, p.madera, 0, y + 0.16, 1.1, 1.25, 0.72, 0.09)
  l.push(pieza(G.caja, p.oscuro, { x: 0, y: y + 0.62, z: 1.16, sx: 1.5, sy: 0.08, sz: 0.04, rz: 0.6 }))
  l.push(pieza(G.caja, p.oscuro, { x: 0, y: y + 0.62, z: 1.16, sx: 1.5, sy: 0.08, sz: 0.04, rz: -0.6 }))
  // MERCANCÍA fuera: madera, piedra y barriles, que es lo que guarda
  for (let i = 0; i < 3; i++) l.push(lenoX(p.tronco, -1.15, y + (i % 2) * 0.25, -0.6 + i * 0.25, 0.23, 0.85))
  l.push(cajaR(p.piedra, 1.35, y, 0.55, 0.52, 0.25, 0.46, 0, 0.05))
  l.push(cajaR(p.piedra, 1.35, y + 0.25, 0.55, 0.46, 0.23, 0.42, 0.2, 0.05))
  l.push(barril(p, 1.3, y, -0.6))
  l.push(barril(p, 1.3, y, -1.0))
  if (det) {
    l.push(barril(p, 1.3, y + 0.35, -0.8))
    l.push(cajon(p, -1.3, y, 1.0, 0.44))
  }
  l.push(bandera(p, p.acento, -1.2, y + 0.16, 1.2, 0.95, 0.36))
  return l
}

function fGranero ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 0.92 + 0.05 * n
  // sobre pilares redondos, y con un TEJADO A CUATRO AGUAS MUY ALTO: el granero
  // es un cono sobre patas, nada que ver con la bóveda del almacén
  for (const x of [-0.85, 0.85]) for (const z of [-0.75, 0.75]) l.push(cil12(p.zocalo, x, y, z, 0.32, 0.38))
  l.push(cajaR(p.madera, 0, y + 0.38, 0, 2.2, 0.15, 1.95, 0, 0.1))
  l.push(cajaR(p.muro, 0, y + 0.53, 0, 2.0, h, 1.75, 0, 0.11))
  if (t < 2) {
    l.push(caja(p.oscuro, 0, y + 0.53 + h * 0.45, 0.9, 2.0, 0.09, 0.06))
    l.push(caja(p.oscuro, 0, y + 0.53 + h - 0.09, 0.9, 2.0, 0.09, 0.06))
  }
  l.push(cornisa(p.muroAlt, 0, y + 0.53 + h, 0, 2.3, 2.05, 0.11))
  l.push(techo4Aguas(p.techo, 0, y + 0.64 + h, 0, 2.3, 2.05, 1.25))
  // VELETA dorada en la cumbre: remate inconfundible desde arriba, y a
  // calidad alta gira a rachas, como si soplara el viento de verdad
  l.push(caja(p.remate, 0, y + 1.89 + h, 0, 0.06, 0.34, 0.06))
  const gallo = pieza(G.cono6, p.oro, { x: 0.13, y: y + 2.12 + h, z: 0, sx: 0.3, sy: 0.26, sz: 0.06, rz: -PI / 2 })
  if (ctx.calidad === 'alto') {
    const eje = new THREE.Group()
    eje.position.set(0, y + 2.12 + h, 0)
    gallo.position.set(0.13, 0, 0)
    eje.add(gallo)
    eje.add(caja(p.oro, -0.11, -0.03, 0, 0.2, 0.05, 0.05))
    eje.userData.anim = 'veleta'
    l.push(eje)
  } else {
    l.push(gallo)
  }
  hueco(l, p.madera, 0, y + 0.53, 0.9, 0.72, 0.6, 0.07)
  // GAVILLAS DE TRIGO al pie: el grano se ve, no hace falta leer el cartel
  l.push(roca(p.trigo, 1.18, y, 1.05, 0.5))
  l.push(roca(p.trigo, 0.85, y, 1.22, 0.42))
  l.push(roca(p.trigo, -1.18, y, 1.0, 0.48))
  for (let i = 0; i < 4; i++) l.push(cil6(p.trigo, -1.2 + i * 0.12, y, -1.1, 0.14, 0.62 + (i % 2) * 0.08))
  // escalera de acceso
  l.push(pieza(G.caja, p.madera, { x: 0, y: y + 0.22, z: 1.2, sx: 0.36, sy: 0.06, sz: 0.76, rx: 0.55 }))
  for (let i = 0; i < 3; i++) l.push(caja(p.madera, 0, y + 0.09 + i * 0.12, 1.36 - i * 0.17, 0.42, 0.05, 0.06))
  if (det) l.push(barril(p, 1.22, y, -1.1))
  return l
}

function fMercado ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  l.push(cajaR(p.suelo, 0, y - 0.02, 0, 2.85, 0.08, 2.85, 0, 0.22))
  // TRES TOLDOS de colores distintos y bien grandes: la mancha de color más
  // alegre de la aldea, y la única que se mueve con el viento en horizontal
  const telas = [p.tela, p.telaVerde, p.telaAzul]
  const sitios = [[-0.82, -0.78, 0], [0.85, -0.72, 0.18], [-0.75, 0.88, 0.42]]
  for (let i = 0; i < 3; i++) {
    const [x, z, ry] = sitios[i]
    const h = 0.9 + 0.03 * n
    for (const dx of [-0.45, 0.45]) for (const dz of [-0.38, 0.38]) l.push(caja(p.madera, x + dx, y, z + dz, 0.08, h, 0.08))
    l.push(toldo(telas[i], x, y + h + 0.1, z, 1.3, 1.05, ry))
    l.push(cajaR(p.maderaClara, x, y, z + 0.32, 1.05, 0.52, 0.34, 0, 0.05))
    l.push(cajon(p, x - 0.26, y + 0.52, z + 0.32, 0.26))
    l.push(pieza(G.esfera, i === 1 ? p.trigo : p.tela, { x: x + 0.26, y: y + 0.64, z: z + 0.32, sx: 0.26, sy: 0.22, sz: 0.26 }))
  }
  // BALANZA del tendero: el icono del trueque
  l.push(cil12(p.zocalo, 0.92, y, 0.92, 0.44, 0.32))
  l.push(caja(p.madera, 0.92, y + 0.32, 0.92, 0.09, 1.15, 0.09))
  l.push(caja(p.madera, 0.92, y + 1.36, 0.92, 0.95, 0.07, 0.07))
  l.push(cil12(p.oro, 0.53, y + 1.2, 0.92, 0.32, 0.09))
  l.push(cil12(p.oro, 1.31, y + 1.27, 0.92, 0.32, 0.09))
  if (det) {
    l.push(barril(p, 1.3, y, -1.3))
    l.push(cajon(p, -1.3, y, -1.3, 0.4))
  }
  return l
}

function fCuartel ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 0.92 + 0.045 * n
  l.push(cajaR(p.zocalo, 0, y, -0.25, 2.55, 0.16, 1.95, 0, 0.12))
  l.push(cajaR(p.muro, 0, y + 0.16, -0.25, 2.35, h, 1.75, 0, 0.12))
  if (t < 2) entramado(l, p, 0, y + 0.16, -0.25, 2.35, h, 1.75)
  l.push(cornisa(p.muroAlt, 0, y + 0.16 + h, -0.25, 2.6, 2.0, 0.11))
  // CUATRO AGUAS BAJO + TORREÓN ALMENADO en un extremo: perfil de cuartel
  l.push(techo4Aguas(p.techo, 0, y + 0.27 + h, -0.25, 2.6, 2.0, 0.62))
  const ht = h + 0.85
  l.push(cajaR(p.muroAlt, -1.05, y, -0.9, 1.0, ht + 0.16, 1.0, 0, 0.11))
  l.push(cornisa(p.muro, -1.05, y + ht + 0.16, -0.9, 1.18, 1.18, 0.1))
  almenas(l, p.muroAlt, -1.05, y + ht + 0.26, -0.42, 1.18, 0.16, 0.32, 0.24)
  almenas(l, p.muroAlt, -1.05, y + ht + 0.26, -1.38, 1.18, 0.16, 0.32, 0.24)
  l.push(cajaR(p.muroAlt, -1.62, y + ht + 0.26, -0.9, 0.16, 0.24, 1.18, 0, 0.05))
  l.push(cajaR(p.muroAlt, -0.48, y + ht + 0.26, -0.9, 0.16, 0.24, 1.18, 0, 0.05))
  hueco(l, p.oscuro, -1.05, y + ht * 0.5, -0.42, 0.18, 0.34, 0.05)
  hueco(l, p.madera, 0.35, y + 0.16, 0.65, 0.72, 0.68, 0.09)
  // ESTANDARTE DE GUERRA colgando sobre la puerta
  l.push(caja(p.madera, 0.35, y + h - 0.05, 0.72, 0.06, 0.06, 0.5))
  const tela = new THREE.Group()
  tela.position.set(0.35, y + h - 0.03, 0.92)
  tela.add(caja(p.tela, 0, -0.66, 0, 0.54, 0.66, 0.04))
  tela.add(hastial(p.tela, 0, -0.86, 0, 0.54, 0.22, 0.04))
  tela.userData.anim = 'bandera'
  l.push(tela)
  // ARMERO DE LANZAS: tres puntas de acero, siempre visibles
  l.push(cajaR(p.madera, -0.95, y, 0.85, 0.95, 0.5, 0.22, 0, 0.05))
  for (let i = 0; i < 3; i++) {
    l.push(pieza(G.caja, p.madera, { x: -1.22 + i * 0.26, y: y + 0.68, z: 0.82, sx: 0.05, sy: 1.25, sz: 0.05, rz: 0.1 }))
    l.push(pieza(G.cono6, p.metal, { x: -1.22 + i * 0.26 + 0.07, y: y + 1.34, z: 0.82, sx: 0.13, sy: 0.26, sz: 0.13 }))
  }
  // muñeco de entrenamiento
  l.push(caja(p.madera, 1.18, y, 1.0, 0.12, 1.0, 0.12))
  l.push(caja(p.madera, 1.18, y + 0.74, 1.0, 0.7, 0.1, 0.1))
  l.push(pieza(G.esfera, p.paja, { x: 1.18, y: y + 1.1, z: 1.0, sx: 0.3, sy: 0.3, sz: 0.3 }))
  if (det) {
    l.push(pieza(G.cilindro12, p.metal, { x: 1.4, y: y + 0.4, z: -0.95, sx: 0.5, sy: 0.08, sz: 0.5, rz: 0.4, rx: 0.3 }))
    l.push(barril(p, 0.4, y, -1.15))
  }
  return l
}

function fArqueria ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 0.78 + 0.035 * n     // LARGA Y BAJA: nada que ver con el cuartel
  l.push(cajaR(p.zocalo, 0, y, -0.75, 2.6, 0.14, 1.3, 0, 0.12))
  l.push(cajaR(p.muro, 0, y + 0.14, -1.05, 2.4, h, 0.62, 0, 0.1))
  // GALERÍA DE TIRO: cinco arcos abiertos al frente, la firma de la arquería
  for (let i = 0; i < 5; i++) {
    const x = -0.96 + i * 0.48
    l.push(cil12(p.muroAlt, x, y + 0.14, -0.42, 0.19, h * 0.6))
  }
  for (let i = 0; i < 4; i++) {
    l.push(arco(p.muroAlt, -0.72 + i * 0.48, y + 0.14 + h * 0.6, -0.42, 0.48, 0.22))
  }
  l.push(cornisa(p.muroAlt, 0, y + 0.14 + h, -0.72, 2.62, 1.32, 0.1))
  l.push(pieza(G.caja, p.techo, { x: 0, y: y + 0.32 + h, z: -0.72, sx: 2.75, sy: 0.11, sz: 1.5, rx: 0.24 }))
  l.push(pieza(G.cilindro6, p.techoAlt, { x: 0, y: y + 0.44 + h, z: -1.4, sx: 0.15, sy: 2.75, sz: 0.15, rz: PI / 2 }))
  // DOS DIANAS grandes de paja con el centro rojo: se ven desde cualquier zoom
  for (const x of [-0.9, 0.5]) {
    l.push(pieza(G.caja, p.madera, { x: x - 0.16, y: y + 0.48, z: 0.95, sx: 0.07, sy: 0.98, sz: 0.07, rz: 0.22 }))
    l.push(pieza(G.caja, p.madera, { x: x + 0.16, y: y + 0.48, z: 0.95, sx: 0.07, sy: 0.98, sz: 0.07, rz: -0.22 }))
    l.push(pieza(G.cilindro12, p.telaCruda, { x, y: y + 0.92, z: 0.95, sx: 0.72, sy: 0.12, sz: 0.72, rx: PI / 2 }))
    l.push(pieza(G.cilindro12, p.tela, { x, y: y + 0.92, z: 1.02, sx: 0.34, sy: 0.05, sz: 0.34, rx: PI / 2 }))
    l.push(pieza(G.caja, p.maderaClara, { x: x + 0.06, y: y + 0.95, z: 1.14, sx: 0.04, sy: 0.04, sz: 0.42 }))
  }
  // HAZ DE FLECHAS apoyado
  l.push(cil12(p.maderaClara, 1.32, y, 0.5, 0.32, 0.5))
  for (let i = 0; i < 4; i++) l.push(caja(p.maderaClara, 1.32 + (i - 1.5) * 0.07, y + 0.5, 0.5, 0.03, 0.55, 0.03))
  if (det) {
    l.push(roca(p.paja, 1.2, y, 1.1, 0.48))
    l.push(barril(p, -1.35, y, -1.0))
  }
  l.push(bandera(p, p.acento, 1.25, y, -1.2, 1.05, 0.36))
  return l
}

function fEstablo ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 0.86 + 0.04 * n      // EL MÁS LARGO Y EL MÁS BAJO de la aldea
  l.push(cajaR(p.zocalo, 0, y, -0.55, 3.6, 0.14, 1.7, 0, 0.14))
  l.push(cajaR(p.muro, 0, y + 0.14, -0.95, 3.4, h, 0.9, 0, 0.11))
  // CUADRAS ABIERTAS con arcos: cuatro bocas oscuras alineadas
  for (const x of [-1.5, -0.5, 0.5, 1.5]) {
    l.push(cil12(p.madera, x, y + 0.14, -0.25, 0.14, h * 0.62))
    l.push(caja(p.oscuro, x - 0.25, y + 0.14, -0.5, 0.42, h * 0.55, 0.06))
  }
  for (let i = 0; i < 3; i++) l.push(arco(p.madera, -1.0 + i * 1.0, y + 0.14 + h * 0.62, -0.25, 1.0, 0.16))
  l.push(cornisa(p.muroAlt, 0, y + 0.14 + h, -0.6, 3.65, 1.9, 0.1))
  // tablilla de madera, como las cuadras de verdad: separa el establo del cuartel
  l.push(techo4Aguas(p.madera, 0, y + 0.24 + h, -0.6, 3.6, 1.85, 0.58))
  // EL CABALLO: sin él esto es un cobertizo cualquiera
  const c = mat(PALETA.caballo)
  const cab = new THREE.Group()
  cab.add(cajaR(c, 0, 0.36, 0, 0.74, 0.34, 0.32, 0, 0.07))
  cab.add(caja(c, 0.31, 0.56, 0, 0.2, 0.34, 0.22))
  cab.add(caja(c, 0.43, 0.8, 0, 0.38, 0.18, 0.2))
  for (const dx of [-0.25, 0.25]) for (const dz of [-0.1, 0.1]) cab.add(caja(c, dx, 0, dz, 0.09, 0.36, 0.09))
  cab.add(caja(p.oscuro, -0.39, 0.42, 0, 0.08, 0.28, 0.12))
  cab.add(caja(p.oscuro, 0.21, 0.72, 0, 0.16, 0.14, 0.2))
  cab.position.set(0.6, y, 0.8)
  cab.rotation.y = -0.5
  l.push(cab)
  // abrevadero y paja: el patio de un establo
  l.push(cajaR(p.madera, -1.2, y, 0.85, 0.95, 0.32, 0.46, 0, 0.06))
  l.push(caja(mat(PALETA.agua), -1.2, y + 0.28, 0.85, 0.85, 0.06, 0.38))
  l.push(roca(p.paja, -1.8, y, 0.5, 0.58))
  for (let i = 0; i < 5; i++) l.push(cil6(p.madera, -1.8 + i * 0.75, y, 1.4, 0.09, 0.46))
  l.push(caja(p.madera, -0.55, y + 0.32, 1.4, 3.0, 0.06, 0.06))
  if (det) l.push(barril(p, 1.65, y, 1.2))
  l.push(bandera(p, p.tela, 1.7, y, -1.2, 1.0, 0.34))
  return l
}

function fTallerAsedio ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 1.05 + 0.05 * n
  // ARMAZÓN ABIERTO: no hay muros ni tejado completo, solo cerchas de madera.
  // Desde arriba se ve el interior, que es justo lo que lo hace reconocible.
  for (const z of [-1.5, -0.55, 0.4]) {
    l.push(pieza(G.caja, p.madera, { x: -0.72, y: y + h * 0.62, z, sx: 0.16, sy: h * 1.5, sz: 0.16, rz: 0.42 }))
    l.push(pieza(G.caja, p.madera, { x: 0.72, y: y + h * 0.62, z, sx: 0.16, sy: h * 1.5, sz: 0.16, rz: -0.42 }))
    l.push(caja(p.madera, 0, y + h * 0.72, z, 1.5, 0.11, 0.11))
  }
  l.push(pieza(G.cilindro6, p.madera, { x: 0, y: y + h * 1.32, z: -0.55, sx: 0.17, sy: 2.2, sz: 0.17, rx: PI / 2 }))
  l.push(pieza(G.caja, p.techo, { x: -0.62, y: y + h * 0.98, z: -0.55, sx: 1.35, sy: 0.1, sz: 2.2, rz: 0.42 }))
  // el fondo es un tablero de madera con sus montantes, no un lienzo blanco
  l.push(cajaR(p.maderaClara, 0, y, -1.85, 3.0, h + 0.25, 0.2, 0, 0.06))
  for (const x of [-1.2, 0, 1.2]) l.push(caja(p.madera, x, y, -1.76, 0.18, h + 0.3, 0.1))
  l.push(caja(p.madera, 0, y + h + 0.2, -1.76, 3.0, 0.14, 0.1))
  // CATAPULTA montada, con el brazo en alto y la piedra cargada
  l.push(cajaR(p.madera, -0.5, y, 1.0, 1.6, 0.26, 0.95, 0, 0.07))
  l.push(rueda(p, -1.2, y, 0.62, 0.58))
  l.push(rueda(p, -1.2, y, 1.35, 0.58))
  l.push(rueda(p, 0.18, y, 0.62, 0.58))
  l.push(rueda(p, 0.18, y, 1.35, 0.58))
  l.push(caja(p.madera, -0.5, y + 0.26, 1.0, 0.2, 0.9, 0.2))
  l.push(pieza(G.caja, p.madera, { x: -0.06, y: y + 1.02, z: 1.0, sx: 1.6, sy: 0.13, sz: 0.13, rz: 0.78 }))
  l.push(pieza(G.esfera, p.piedraOscura, { x: 0.42, y: y + 1.62, z: 1.0, sx: 0.38, sy: 0.38, sz: 0.38 }))
  // ARIETE con la cabeza de hierro
  l.push(lenoZ(p.tronco, 1.3, y + 0.5, 0.55, 0.34, 1.6))
  l.push(pieza(G.cilindro12, p.metal, { x: 1.3, y: y + 0.67, z: 1.3, sx: 0.42, sy: 0.24, sz: 0.42, rx: PI / 2 }))
  l.push(caja(p.madera, 1.3, y, -0.1, 0.12, 0.55, 0.12))
  l.push(caja(p.madera, 1.3, y, 1.15, 0.12, 0.55, 0.12))
  if (det) {
    for (let i = 0; i < 3; i++) l.push(caja(p.maderaClara, -1.3, y + i * 0.15, -1.3, 1.2, 0.14, 0.42))
    l.push(barril(p, 1.45, y, -1.4))
  }
  return l
}

function fHerreria ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 0.85 + 0.04 * n
  l.push(cajaR(p.zocalo, 0, y, -0.55, 2.5, 0.15, 1.85, 0, 0.13))
  l.push(cajaR(p.muro, 0, y + 0.15, -0.75, 2.3, h, 1.4, 0, 0.11))
  if (t < 2) entramado(l, p, 0, y + 0.15, -0.75, 2.3, h, 1.4)
  // TEJADO A UN AGUA volado sobre la fragua: taller abierto, no vivienda
  // techumbre de chapa ennegrecida por el humo: dentro de la familia militar,
  // la herrería tiene que separarse del cuartel sin salirse de la paleta
  l.push(pieza(G.caja, p.oscuro, { x: 0, y: y + 0.35 + h, z: -0.35, sx: 2.6, sy: 0.12, sz: 2.0, rx: 0.3 }))
  for (const x of [-1.05, 1.05]) l.push(caja(p.madera, x, y + 0.15, 0.35, 0.14, h * 0.92, 0.14))
  // CHIMENEA REDONDA ENORME con la lumbre encendida: la seña de la herrería
  const hc = h + 1.5
  l.push(cil12(p.piedraOscura, -0.8, y, 0.3, 0.82, hc))
  l.push(cil12(p.piedra, -0.8, y + hc, 0.3, 0.96, 0.14))
  l.push(cil12(p.oscuro, -0.8, y + hc + 0.14, 0.3, 0.66, 0.1))
  l.push(arco(p.oscuro, -0.8, y + 0.12, 0.72, 0.52, 0.2))
  l.push(caja(p.oscuro, -0.8, y, 0.72, 0.52, 0.12, 0.2))
  const fuego = pieza(G.caja, p.fuego, { x: -0.8, y: y + 0.22, z: 0.7, sx: 0.4, sy: 0.34, sz: 0.16 })
  fuego.userData.anim = 'llama'
  fuego.castShadow = false
  l.push(fuego)
  // YUNQUE: cuatro piezas y se reconoce al instante
  l.push(cil12(p.madera, 0.6, y, 0.72, 0.48, 0.3))
  l.push(caja(p.metal, 0.6, y + 0.3, 0.72, 0.22, 0.18, 0.26))
  l.push(cajaR(p.metal, 0.6, y + 0.48, 0.72, 0.66, 0.17, 0.32, 0, 0.05))
  l.push(pieza(G.cono6, p.metal, { x: 1.03, y: y + 0.57, z: 0.72, sx: 0.3, sy: 0.32, sz: 0.24, rz: -PI / 2 }))
  l.push(pieza(G.caja, p.madera, { x: 0.42, y: y + 0.72, z: 0.94, sx: 0.06, sy: 0.52, sz: 0.06, rz: 0.5 }))
  l.push(caja(p.metal, 0.26, y + 0.93, 0.94, 0.22, 0.13, 0.13))
  // HERRADURAS colgadas del muro: tres aros de acero bien visibles
  for (let i = 0; i < 3; i++) {
    l.push(pieza(G.cilindro12, p.metal, { x: 0.1 + i * 0.32, y: y + h * 0.78, z: -0.02, sx: 0.24, sy: 0.05, sz: 0.24, rx: PI / 2 }))
  }
  if (det) {
    l.push(cajaR(p.madera, 1.3, y, -0.2, 0.52, 0.42, 0.52, 0, 0.06))
    l.push(caja(mat(PALETA.agua), 1.3, y + 0.38, -0.2, 0.44, 0.06, 0.44))
    l.push(roca(p.carbon, -1.35, y, 0.85, 0.46))
    // FUELLE: el cuero respira y mueve la fragua. Una malla, un seno.
    const fuelle = caja(p.madera, 0.05, y + 0.16, 0.95, 0.3, 0.26, 0.52)
    fuelle.userData.anim = 'fuelle'
    l.push(fuelle)
  }
  // PENACHO DE HUMO saliendo de la chimenea. Cuesta una llamada de dibujo, y
  // solo hay una herrería por aldea, pero se reserva a calidad alta igual.
  if (ctx.calidad === 'alto') {
    const humo = pieza(G.esfera, mat(PALETA.humo, { transparente: 0.5 }), {
      x: -0.8, y: y + hc + 0.35, z: 0.3, sx: 0.62, sy: 0.56, sz: 0.62
    })
    humo.userData.anim = 'humo'
    humo.castShadow = false
    humo.receiveShadow = false
    l.push(humo)
  }
  return l
}

function fUniversidad ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 1.3 + 0.07 * n       // ALTA y esbelta: edificio noble
  l.push(cajaR(p.zocalo, 0, y, -0.25, 2.6, 0.24, 2.2, 0, 0.14))
  l.push(cajaR(p.muro, 0, y + 0.24, -0.25, 2.3, h, 1.95, 0, 0.13))
  // ARCADA de medio punto en la fachada: la marca del saber
  for (let i = 0; i < 4; i++) {
    const x = -1.05 + i * 0.7
    l.push(cil12(p.zocalo, x, y + 0.24, 0.95, 0.24, h * 0.72))
  }
  for (let i = 0; i < 3; i++) l.push(arco(p.muroAlt, -0.7 + i * 0.7, y + 0.24 + h * 0.72, 0.95, 0.7, 0.3))
  l.push(cornisa(p.muroAlt, 0, y + 0.24 + h * 0.72 + 0.35, 0.95, 2.45, 0.55, 0.14))
  l.push(cornisa(p.muroAlt, 0, y + 0.24 + h, -0.25, 2.55, 2.2, 0.13))
  l.push(techo2Aguas(p.techo, 0, y + 0.37 + h, -0.25, 2.55, 2.2, 0.82))
  l.push(fronton(p.muroAlt, 0, y + 0.37 + h, 0.85, 2.55, 0.82))
  l.push(fronton(p.muroAlt, 0, y + 0.37 + h, -1.35, 2.55, 0.82))
  // VENTANALES ALTOS con arco: tres huecos azules muy verticales
  for (const x of [-0.72, 0, 0.72]) hueco(l, p.vidrio, x, y + 0.24 + h * 0.3, -1.24, 0.28, h * 0.45, 0.06)
  // TORRE DEL ESCRIBANO con CÚPULA DE COBRE: el remate verde que la identifica
  const ht = h + 0.75
  l.push(cil12(p.muro, 1.08, y + 0.24, -1.08, 0.72, ht))
  l.push(cil12(p.muroAlt, 1.08, y + 0.24 + ht, -1.08, 0.86, 0.12))
  l.push(bulbo(p.acento, 1.08, y + 0.36 + ht, -1.08, 0.9, 0.72))
  l.push(caja(p.oro, 1.08, y + 0.88 + ht, -1.08, 0.06, 0.3, 0.06))
  l.push(pieza(G.esfera, p.oro, { x: 1.08, y: y + 1.22 + ht, z: -1.08, sx: 0.15, sy: 0.18, sz: 0.15 }))
  if (det) {
    l.push(cajaR(p.maderaClara, -1.05, y + 0.24, 1.3, 0.62, 0.42, 0.42, 0, 0.06))
    l.push(pieza(G.cilindro12, p.telaCruda, { x: -1.05, y: y + 0.68, z: 1.3, sx: 0.17, sy: 0.52, sz: 0.17, rz: PI / 2 }))
    l.push(caja(p.tela, 0.95, y + 0.66, 1.3, 0.3, 0.08, 0.24))
  }
  l.push(bandera(p, p.telaAzul, -1.3, y + 0.24, -1.3, 1.25, 0.42))
  // ESFERA ARMILAR de oro en el patio: el icono del saber, y lo que impide
  // confundir la universidad con el monasterio desde arriba
  l.push(cil12(p.zocalo, -0.35, y, 1.35, 0.36, 0.44))
  l.push(pieza(G.esfera1, p.oro, { x: -0.35, y: y + 0.72, z: 1.35, sx: 0.42, sy: 0.42, sz: 0.42 }))
  l.push(pieza(G.cilindro12, p.oro, { x: -0.35, y: y + 0.72, z: 1.35, sx: 0.56, sy: 0.04, sz: 0.56, rx: 0.5 }))
  l.push(pieza(G.cilindro12, p.oro, { x: -0.35, y: y + 0.72, z: 1.35, sx: 0.56, sy: 0.04, sz: 0.56, rz: 1.2 }))
  return l
}

function fMonasterio ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 1.12 + 0.06 * n
  l.push(cajaR(p.zocalo, 0.25, y, 0, 2.3, 0.22, 2.3, 0, 0.14))
  l.push(cajaR(p.muro, 0.25, y + 0.22, 0, 2.0, h, 2.0, 0, 0.13))
  l.push(cornisa(p.muroAlt, 0.25, y + 0.22 + h, 0, 2.25, 2.25, 0.12))
  l.push(techo2Aguas(p.techo, 0.25, y + 0.34 + h, 0, 2.25, 2.2, 0.72))
  l.push(fronton(p.muroAlt, 0.25, y + 0.34 + h, 1.1, 2.25, 0.72))
  l.push(fronton(p.muroAlt, 0.25, y + 0.34 + h, -1.1, 2.25, 0.72))
  // CAMPANARIO CON AGUJA DE COBRE: la torre más fina y más alta de la aldea
  const ht = h + 1.85
  l.push(cajaR(p.muro, -1.05, y, 0.9, 0.82, ht, 0.82, 0, 0.1))
  l.push(caja(p.oscuro, -1.05, y + ht - 0.66, 0.9, 0.5, 0.54, 0.88))
  l.push(arco(p.muro, -1.05, y + ht - 0.12, 0.9, 0.82, 0.86))
  l.push(pieza(G.cono8, p.oro, { x: -1.05, y: y + ht - 0.4, z: 0.9, sx: 0.36, sy: 0.36, sz: 0.36, rx: PI }))
  l.push(cornisa(p.muroAlt, -1.05, y + ht + 0.29, 0.9, 0.98, 0.98, 0.11))
  l.push(techoCono(p.acento, -1.05, y + ht + 0.4, 0.9, 1.0, 1.15))
  l.push(caja(p.oro, -1.05, y + ht + 1.5, 0.9, 0.07, 0.42, 0.07))
  l.push(caja(p.oro, -1.05, y + ht + 1.66, 0.9, 0.28, 0.07, 0.07))
  // ROSETÓN: la mancha de color de la fachada
  l.push(pieza(G.cilindro12, p.vidrio, { x: 0.25, y: y + 0.22 + h * 0.62, z: 1.03, sx: 0.66, sy: 0.06, sz: 0.66, rx: PI / 2 }))
  l.push(pieza(G.cilindro12, p.acento, { x: 0.25, y: y + 0.22 + h * 0.62, z: 1.07, sx: 0.32, sy: 0.05, sz: 0.32, rx: PI / 2 }))
  // portada con arco apuntado sobre arco de medio punto
  hueco(l, p.madera, 0.25, y + 0.22, 1.03, 0.56, h * 0.4, 0.07)
  // CLAUSTRO: cuatro columnas con arcos al costado
  for (let i = 0; i < 3; i++) l.push(cil12(p.zocalo, 1.2, y + 0.22, -1.0 + i * 0.75, 0.22, 0.78))
  for (let i = 0; i < 2; i++) l.push(pieza(G.arco, p.muroAlt, { x: 1.2, y: y + 1.0, z: -0.62 + i * 0.75, sx: 0.75, sy: 0.75, sz: 0.3, ry: PI / 2 }))
  if (det) l.push(roca(p.hierba, -1.2, y, -0.95, 0.52))
  return l
}

function fCampamento ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  // TIENDAS CÓNICAS: no hay ningún otro edificio hecho de conos de tela
  for (const [x, z, d] of [[-0.85, -0.6, 1.5], [0.85, 0.25, 1.2]]) {
    l.push(pieza(G.cono6, p.telaCruda, { x, y: y + d * 0.44, z, sx: d, sy: d * 0.9, sz: d }))
    l.push(caja(p.oscuro, x, y, z + d * 0.4, d * 0.28, d * 0.44, 0.05))
    l.push(caja(p.madera, x, y + d * 0.84, z, 0.05, 0.32, 0.05))
    l.push(hastial(p.tela, x, y + d * 0.9, z, 0.32, 0.18, 0.03))
  }
  hoguera(l, p, 0, y, 1.0, det)
  // MESA DE MAPAS
  l.push(cajaR(p.maderaClara, 0.92, y + 0.44, -0.98, 1.05, 0.09, 0.72, 0.3, 0.06))
  for (const dx of [-0.4, 0.4]) for (const dz of [-0.25, 0.25]) l.push(caja(p.madera, 0.92 + dx, y, -0.98 + dz, 0.07, 0.44, 0.07))
  l.push(caja(p.telaCruda, 0.92, y + 0.53, -0.98, 0.72, 0.03, 0.52, 0.3))
  l.push(bandera(p, p.acento, -1.25, y, 1.15, 1.6, 0.44))
  if (det) {
    l.push(cajon(p, 0.15, y, -0.35, 0.34))
    l.push(barril(p, -0.2, y, -1.2))
    for (let i = 0; i < 3; i++) l.push(pieza(G.caja, p.madera, { x: 1.35, y: y + 0.52, z: 0.95, sx: 0.05, sy: 1.05, sz: 0.05, rz: 0.2 * (i - 1), ry: i }))
  }
  if (t >= 1) {
    l.push(cajaR(p.zocalo, -0.85, y, -0.6, 1.6, 0.12, 1.6, 0, 0.2))
    l.push(cajaR(p.zocalo, 0.85, y, 0.25, 1.3, 0.12, 1.3, 0, 0.18))
  }
  return l
}

function fTorreVigia ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 1.6 + 0.15 * n       // TORRE CUADRADA, alta y estrecha
  l.push(cajaR(p.zocalo, 0, y, 0, 1.5, 0.22, 1.5, 0, 0.14))
  l.push(cajaR(p.muro, 0, y + 0.22, 0, 1.12, h, 1.12, 0, 0.12))
  hueco(l, p.oscuro, 0, y + 0.22 + h * 0.4, 0.58, 0.16, 0.34, 0.05)
  // el remate vuela sobre el fuste: cadalso de madera con tejadillo a cuatro aguas
  const yp = y + 0.22 + h
  l.push(cornisa(p.muroAlt, 0, yp, 0, 1.5, 1.5, 0.14))
  if (t >= 1) {
    almenas(l, p.muroAlt, 0, yp + 0.14, 0.66, 1.5, 0.18, 0.38, 0.26)
    almenas(l, p.muroAlt, 0, yp + 0.14, -0.66, 1.5, 0.18, 0.38, 0.26)
    l.push(cajaR(p.muroAlt, -0.66, yp + 0.14, 0, 0.18, 0.26, 1.5, 0, 0.05))
    l.push(cajaR(p.muroAlt, 0.66, yp + 0.14, 0, 0.18, 0.26, 1.5, 0, 0.05))
  } else {
    for (const [x, z] of [[0, 0.7], [0, -0.7], [0.7, 0], [-0.7, 0]]) l.push(caja(p.madera, x, yp + 0.14, z, x ? 0.1 : 1.5, 0.26, x ? 1.5 : 0.1))
  }
  for (const px of [-0.5, 0.5]) for (const pz of [-0.5, 0.5]) l.push(caja(p.madera, px, yp + 0.4, pz, 0.11, 0.36, 0.11))
  l.push(techo4Aguas(p.techo, 0, yp + 0.76, 0, 1.2, 1.2, 0.68))
  l.push(pieza(G.esfera, p.remate, { x: 0, y: yp + 1.5, z: 0, sx: 0.14, sy: 0.17, sz: 0.14 }))
  // BRASERO DE SEÑALES: la luz que avisa de que esto es una atalaya
  l.push(cil12(p.metal, 0.52, yp + 0.14, 0.52, 0.3, 0.2))
  if (det) {
    const f = pieza(G.cono6, p.fuego, { x: 0.52, y: yp + 0.46, z: 0.52, sx: 0.24, sy: 0.34, sz: 0.24 })
    f.userData.anim = 'llama'; f.castShadow = false
    l.push(f)
    l.push(pieza(G.caja, p.madera, { x: 0.6, y: y + h * 0.5, z: 0.72, sx: 0.08, sy: h * 1.05, sz: 0.08, rz: 0.12 }))
    for (let i = 0; i < 3; i++) l.push(caja(p.madera, 0.6, y + 0.35 + i * 0.4, 0.72, 0.32, 0.06, 0.06))
  }
  if (t >= 2) l.push(bandera(p, p.acento, -0.52, yp + 0.14, -0.52, 0.75, 0.3))
  return l
}

function fTorreBallesta ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const h = 0.95 + 0.1 * n       // TORRE REDONDA, baja y ancha: el contrario exacto de la vigía
  l.push(cil12(p.zocalo, 0, y, 0, 1.55, 0.24))
  l.push(cil12(p.muro, 0, y + 0.24, 0, 1.35, h))
  l.push(cil12(p.muroAlt, 0, y + 0.24 + h * 0.5, 0, 1.42, 0.1))    // cordón a media altura
  l.push(cil12(p.muroAlt, 0, y + 0.24 + h, 0, 1.62, 0.16))
  // almenas en corona: doce merlones alrededor
  for (let i = 0; i < 10; i += 2) {
    const a = (i * PI) / 5
    l.push(cajaR(p.muroAlt, Math.sin(a) * 0.68, y + 0.4 + h, Math.cos(a) * 0.68, 0.34, 0.26, 0.24, -a, 0.05))
  }
  hueco(l, p.oscuro, 0, y + 0.24 + h * 0.22, 0.68, 0.18, 0.32, 0.05)
  // LA BALLESTA montada: dos brazos de acero y el virote cargado
  const yb = y + 0.56 + h
  l.push(cil12(p.madera, 0, y + 0.4 + h, 0, 0.5, 0.18))
  l.push(pieza(G.caja, p.madera, { x: 0, y: yb + 0.1, z: 0, sx: 0.2, sy: 0.13, sz: 1.15, rx: -0.18 }))
  l.push(pieza(G.caja, p.metal, { x: 0, y: yb + 0.19, z: -0.16, sx: 1.45, sy: 0.08, sz: 0.08, rz: 0.12 }))
  l.push(pieza(G.caja, p.metal, { x: 0, y: yb + 0.23, z: -0.1, sx: 1.18, sy: 0.03, sz: 0.03 }))
  l.push(pieza(G.caja, p.maderaClara, { x: 0, y: yb + 0.21, z: 0.26, sx: 0.06, sy: 0.06, sz: 0.85, rx: -0.18 }))
  l.push(pieza(G.cono6, p.metal, { x: 0, y: yb + 0.3, z: 0.68, sx: 0.15, sy: 0.24, sz: 0.15, rx: PI / 2 - 0.18 }))
  if (det) l.push(cajon(p, 0.52, y + 0.4 + h, 0.48, 0.32))
  if (t >= 2) l.push(bandera(p, p.tela, -0.55, y + 0.4 + h, -0.5, 0.85, 0.32))
  return l
}

function fCastillo ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const hm = 1.0 + 0.06 * n        // muro cortina
  const ht = 1.95 + 0.12 * n       // torre del homenaje
  l.push(cajaR(p.zocalo, 0, y, 0, 3.85, 0.24, 3.85, 0, 0.2))
  // muro cortina con almenas en los cuatro lados
  for (const s of [1, -1]) {
    l.push(cajaR(p.muro, 0, y + 0.24, s * 1.45, 3.4, hm, 0.45, 0, 0.08))
    l.push(cajaR(p.muro, s * 1.45, y + 0.24, 0, 0.45, hm, 3.4, 0, 0.08))
    l.push(cornisa(p.muroAlt, 0, y + 0.24 + hm, s * 1.45, 3.45, 0.56, 0.1))
    l.push(cornisa(p.muroAlt, s * 1.45, y + 0.24 + hm, 0, 0.56, 3.45, 0.1))
    almenas(l, p.muroAlt, 0, y + 0.34 + hm, s * 1.45, 3.4, 0.45, 0.42, 0.28)
    almenas(l, p.muroAlt, s * 1.45, y + 0.34 + hm, 0, 3.4, 0.45, 0.42, 0.28, true)
  }
  // torre del homenaje
  l.push(cajaR(p.muro, 0, y + 0.24, -0.2, 1.7, ht, 1.7, 0, 0.14))
  l.push(cornisa(p.muroAlt, 0, y + 0.24 + ht, -0.2, 1.9, 1.9, 0.12))
  almenas(l, p.muroAlt, 0, y + 0.36 + ht, 0.66, 1.9, 0.22, 0.42, 0.28)
  almenas(l, p.muroAlt, 0, y + 0.36 + ht, -1.06, 1.9, 0.22, 0.42, 0.28)
  l.push(cajaR(p.muroAlt, -0.94, y + 0.36 + ht, -0.2, 0.22, 0.28, 1.9, 0, 0.05))
  l.push(cajaR(p.muroAlt, 0.94, y + 0.36 + ht, -0.2, 0.22, 0.28, 1.9, 0, 0.05))
  l.push(bandera(p, p.acento, 0, y + 0.36 + ht + 0.28, -0.2, 1.15, 0.52))
  // CUATRO TORRES REDONDAS con capirote: el perfil del castillo
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 1.5; const z = sz * 1.5
    l.push(cil12(p.muro, x, y + 0.24, z, 1.0, ht * 0.88))
    l.push(cil12(p.muroAlt, x, y + 0.24 + ht * 0.88, z, 1.18, 0.18))
    l.push(techoCono(p.techo, x, y + 0.42 + ht * 0.88, z, 1.24, 0.92))
    l.push(pieza(G.esfera, p.remate, { x, y: y + 1.42 + ht * 0.88, z, sx: 0.12, sy: 0.15, sz: 0.12 }))
    hueco(l, p.oscuro, x, y + 0.24 + ht * 0.4, z + sz * 0.5, 0.16, 0.3, 0.06)
  }
  // PUERTA con arco, rastrillo y puente levadizo
  l.push(caja(p.oscuro, 0, y + 0.24, 1.5, 0.95, hm * 0.72, 0.5))
  l.push(arco(p.oscuro, 0, y + 0.24 + hm * 0.72, 1.5, 0.95, 0.5))
  l.push(arco(p.muroAlt, 0, y + 0.24 + hm * 0.72, 1.72, 1.2, 0.12))
  // el puente BAJADO y apoyado en el suelo: levantado quedaba un tablón flotando
  l.push(cajaR(p.madera, 0, y - 0.06, 2.42, 0.95, 0.12, 1.5, 0, 0.06))
  for (const dx of [-0.42, 0.42]) {
    l.push(pieza(G.caja, p.metal, { x: dx, y: y + 0.72, z: 2.05, sx: 0.05, sy: 1.5, sz: 0.05, rx: -0.72 }))
  }
  if (det) {
    l.push(bandera(p, p.tela, -1.5, y + 0.42 + ht * 0.88 + 0.85, -1.5, 0.62, 0.3))
    l.push(bandera(p, p.tela, 1.5, y + 0.42 + ht * 0.88 + 0.85, -1.5, 0.62, 0.3))
  }
  return l
}

function fPozo ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  l.push(cil12(p.zocalo, 0, y, 0, 0.88, 0.2))
  l.push(cil12(p.piedra, 0, y + 0.2, 0, 0.78, 0.22))
  l.push(cil12(p.oscuro, 0, y + 0.42, 0, 0.6, 0.03))
  l.push(cil6(p.madera, -0.3, y + 0.42, 0, 0.11, 0.76))
  l.push(cil6(p.madera, 0.3, y + 0.42, 0, 0.11, 0.76))
  l.push(techo2Aguas(p.techo, 0, y + 1.18, 0, 0.9, 0.7, 0.44, 0.09))
  l.push(pieza(G.cilindro12, p.madera, { x: 0, y: y + 1.0, z: 0, sx: 0.17, sy: 0.62, sz: 0.17, rz: PI / 2 }))
  l.push(caja(p.oscuro, 0, y + 0.66, 0, 0.03, 0.34, 0.03))
  l.push(cil6(p.maderaClara, 0, y + 0.52, 0, 0.21, 0.17))
  if (det) l.push(pieza(G.caja, p.madera, { x: 0.34, y: y + 1.0, z: 0.14, sx: 0.06, sy: 0.2, sz: 0.06, rz: 0.6 }))
  return l
}

function fEstandarte ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  l.push(cil12(p.zocalo, 0, y, 0, 0.62, 0.2))
  l.push(cil12(p.piedraOscura, 0, y + 0.2, 0, 0.42, 0.14))
  l.push(bandera(p, p.acento, 0, y + 0.34, 0, 1.65, 0.56))
  if (det) {
    l.push(roca(p.piedra, 0.34, y, 0.3, 0.24))
    l.push(roca(p.piedra, -0.3, y, -0.26, 0.2))
  }
  return l
}


/**
 * PUESTO AVANZADO: el poblado fortificado de la frontera.
 *
 * Vive en tierra recién ganada, sobre el verde apagado del barbecho, así que
 * tira de madera caliente, teja y un estandarte azul para cantar contra ese
 * fondo. La silueta es un RECINTO CERRADO de empalizada con una torrecilla
 * REDONDA de madera en una esquina y dos casitas dentro: ni la torre vigía
 * (una torre cuadrada de piedra, suelta) ni el castillo (cantería, cuatro
 * torreones y almenas) se parecen a esto desde la cámara del juego.
 */
function fPuestoAvanzado ({ p, n, t, det }) {
  const l = []
  const y = SUELO
  const R = 1.3
  const hp = 0.64 + 0.028 * n          // altura de la empalizada
  const yp = y + (t >= 1 ? 0.14 : 0)   // desde el escalón de piedra, sobre zócalo

  // EMPALIZADA: paño de troncos con las puntas afiladas y su amarre a media
  // altura. Un paño macizo con las puntas encima cuesta la décima parte que
  // cuarenta troncos sueltos y se lee exactamente igual desde arriba.
  const tramo = (cx, cz, largo, enZ, hueco = 0) => {
    if (hueco) {
      const semi = (largo - hueco) / 2
      const off = (hueco + semi) / 2
      tramo(enZ ? cx : cx - off, enZ ? cz - off : cz, semi, enZ)
      tramo(enZ ? cx : cx + off, enZ ? cz + off : cz, semi, enZ)
      return
    }
    const sx = enZ ? 0.18 : largo
    const sz = enZ ? largo : 0.18
    if (t >= 1) l.push(cajaR(p.zocalo, cx, y, cz, sx + 0.12, 0.14, sz + 0.12, 0, 0.05))
    l.push(cajaR(p.madera, cx, yp, cz, sx, hp, sz, 0, 0.05))
    l.push(caja(p.oscuro, cx, yp + hp * 0.6, cz, enZ ? 0.22 : largo, 0.07, enZ ? largo : 0.22))
    const nn = Math.max(2, Math.round(largo / 0.3))
    for (let i = 0; i < nn; i++) {
      const u = -largo / 2 + largo / (2 * nn) + (i * largo) / nn
      l.push(pieza(G.cono6, p.maderaClara, {
        x: enZ ? cx : cx + u, y: yp + hp + 0.09, z: enZ ? cz + u : cz, sx: 0.21, sy: 0.22, sz: 0.21
      }))
    }
  }
  tramo(0, -R, R * 2, false)
  tramo(-R, 0, R * 2, true)
  tramo(R, 0, R * 2, true)
  tramo(0, R, R * 2, false, 0.9)        // el portón mira al frente

  // PORTÓN: dos postes gordos, dintel y las hojas de madera
  for (const s of [-1, 1]) {
    l.push(leno(p.madera, s * 0.5, y, R, 0.28, hp + 0.34))
    l.push(pieza(G.cono6, p.maderaClara, { x: s * 0.5, y: y + hp + 0.44, z: R, sx: 0.3, sy: 0.26, sz: 0.3 }))
  }
  l.push(caja(p.oscuro, 0, y + hp + 0.16, R, 1.2, 0.14, 0.22))
  l.push(caja(p.madera, 0, y, R, 0.86, hp * 0.92, 0.14))
  l.push(caja(p.oscuro, 0, y + hp * 0.4, R, 0.86, 0.08, 0.18))

  // TORRECILLA REDONDA de madera con su capirote: la seña vertical del puesto
  const tx = -0.66; const tz = -0.66
  const ht = 1.45 + 0.1 * n
  l.push(cil12(t >= 2 ? p.zocalo : p.madera, tx, y, tz, 0.88, ht))
  l.push(cil12(p.maderaClara, tx, y + ht, tz, 1.16, 0.13))
  for (let i = 0; i < 6; i++) {
    const a = (i * PI) / 3
    l.push(caja(p.madera, tx + Math.sin(a) * 0.52, y + ht + 0.13, tz + Math.cos(a) * 0.52, 0.1, 0.28, 0.1))
  }
  l.push(techoCono(p.techo, tx, y + ht + 0.41, tz, 1.22, 0.64))
  l.push(bandera(p, p.acento, tx, y + ht + 1.05, tz, 0.68, 0.36))
  // escala de mano apoyada en el fuste
  l.push(pieza(G.caja, p.madera, { x: tx + 0.5, y: y + ht * 0.5, z: tz + 0.5, sx: 0.07, sy: ht * 1.08, sz: 0.07, rz: 0.14 }))
  for (let i = 0; i < 3; i++) l.push(caja(p.maderaClara, tx + 0.5, y + 0.3 + i * 0.36, tz + 0.5, 0.28, 0.05, 0.05))

  // DOS CASITAS dentro: esto es un poblado en la linde, no una torre suelta
  const casita = (cx, cz, w, alt) => {
    l.push(cajaR(p.zocalo, cx, y, cz, w + 0.14, 0.1, w * 0.84 + 0.14, 0, 0.06))
    l.push(cajaR(p.muro, cx, y + 0.1, cz, w, alt, w * 0.84, 0, 0.07))
    l.push(techo2Aguas(p.techo, cx, y + 0.1 + alt, cz, w + 0.24, w * 0.84 + 0.2, 0.34, 0.1))
    l.push(fronton(p.muroAlt, cx, y + 0.1 + alt, cz + (w * 0.84 + 0.2) / 2, w + 0.24, 0.34, 0.08))
    l.push(fronton(p.muroAlt, cx, y + 0.1 + alt, cz - (w * 0.84 + 0.2) / 2, w + 0.24, 0.34, 0.08))
    hueco(l, p.oscuro, cx, y + 0.1, cz + w * 0.42 + 0.02, w * 0.32, alt * 0.5, 0.05)
  }
  casita(0.62, -0.62, 0.92, 0.5 + 0.02 * n)
  casita(-0.58, 0.62, 0.82, 0.46 + 0.02 * n)

  // hoguera del turno de guardia y el huerto que da la comida del puesto
  hoguera(l, p, 0.38, y, 0.34, det)
  for (let i = 0; i < 2; i++) l.push(caja(p.trigo, 0.92, y, 0.62 + i * 0.3, 0.72, 0.2, 0.16))
  if (det) {
    l.push(barril(p, -1.02, y, -0.12))
    lena(l, p, 1.0, y, -1.0)
    l.push(cajon(p, 0.05, y, -1.0, 0.32))
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

/** La misma máscara para el foso, que solo se traba consigo mismo: una zanja
 *  sigue en la casilla de al lado si al lado hay otra zanja, y con nada más. */
function mascaraFosoEn (x, z) {
  let m = 0
  for (const [dx, dz, bit] of DIRS) if (ocupadas.get(`${x + dx}|${z + dz}`) === 'foso') m |= bit
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
    // extremo: torreta REDONDA de doce caras, para que el muro no acabe en un tajo
    l.push(cil12(muroP, 0, y + 0.14, 0, 0.8, h + 0.18))
    l.push(cil12(cor, 0, y + 0.32 + h, 0, 0.92, 0.12))
    l.push(techoCono(p.techo, 0, y + 0.44 + h, 0, 1.0, 0.68))
  } else {
    // el machón de la esquina va achaflanado: es lo que quita el aire de cajas
    l.push(cajaR(muroP, 0, y + 0.14, 0, gro + 0.08, h + 0.1, gro + 0.08, 0, 0.08))
    l.push(cajaR(cor, 0, y + 0.24 + h, 0, gro + 0.18, 0.22, gro + 0.18, 0, 0.06))
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
  // dos torreones con el ARCO DE MEDIO PUNTO en medio: se lee como puerta desde arriba
  for (const s of [-1, 1]) {
    l.push(cajaR(p.piedraOscura, s * 0.62, y, 0, 0.76, 0.16, 0.76, 0, 0.07))
    l.push(cajaR(muroP, s * 0.62, y + 0.16, 0, 0.64, h + 0.35, 0.64, 0, 0.08))
    almenas(l, cor, s * 0.62, y + 0.51 + h, 0, 0.74, 0.74, 0.28, 0.18)
    if (det) l.push(caja(p.carbon, s * 0.62, y + 0.16 + h * 0.55, 0.33, 0.12, 0.3, 0.04))
  }
  l.push(arco(muroP, 0, y + 0.16 + h * 0.6, 0, 0.62, 0.62))
  l.push(caja(muroP, 0, y + 0.16 + h * 0.9, 0, 0.72, h * 0.25, 0.6))
  almenas(l, cor, 0, y + 0.16 + h * 1.15, 0, 0.72, 0.6, 0.24, 0.16)
  // hojas de madera con herrajes
  for (const s of [-1, 1]) {
    l.push(caja(p.madera, s * 0.17, y + 0.1, 0, 0.32, h * 0.78, 0.28))
    l.push(caja(p.metal, s * 0.17, y + 0.1 + h * 0.28, 0.15, 0.3, 0.07, 0.04))
    l.push(caja(p.metal, s * 0.17, y + 0.1 + h * 0.6, 0.15, 0.3, 0.07, 0.04))
  }
  if (t >= 1) {
    l.push(bandera(p, p.acento, -0.62, y + 0.51 + h + 0.18, 0, 0.7, 0.3))
    l.push(bandera(p, p.acento, 0.62, y + 0.51 + h + 0.18, 0, 0.7, 0.3))
  }
  return l
}

/**
 * FOSO: una ZANJA, y lo único del catálogo que tiene que leerse como un AGUJERO.
 *
 * El suelo del valle es una malla de una pieza: no se puede agujerear. Así que
 * el hueco se finge SUBIENDO EL BORDE en vez de bajar el fondo —desde la cámara
 * del juego el ojo lee lo mismo— con cuatro capas, de dentro afuera y de oscuro
 * a claro, que es el orden en que se lee la profundidad:
 *   FONDO casi negro que cubre la casilla entera: es lo que canta "aquí hay hueco"
 *   AGUA y ESTACAS dentro, en cuanto la zanja es honda (tono >= 1)
 *   ESCARPA de tierra mojada: el escalón intermedio de la pared
 *   CABALLÓN de tierra excavada, levantado, con los cascotes que salieron al cavar
 * Los lados por los que la zanja SIGUE van limpios —ni caballón ni escarpa— así
 * que dos casillas seguidas salen como un foso corrido y no como dos cuadraditos
 * sueltos, igual que hacen las murallas con su máscara de vecinos.
 */
function fFoso ({ p, n, t, det, mask }) {
  const l = []
  // N(-z) · E(+x) · S(+z) · O(-x): true = la zanja continúa por ese lado
  const sigue = [!!(mask & 1), !!(mask & 2), !!(mask & 4), !!(mask & 8)]
  const CAB = 0.2                        // ancho del caballón de tierra
  const ESC = 0.1                        // ancho de la escarpa
  const alto = 0.15 + 0.013 * n          // un foso del 8 es una zanja seria
  const conAgua = t >= 1

  // 1 · EL FONDO, en dos tonos. La tierra mojada cubre la casilla entera —así dos
  //     fosos pegados comparten suelo y no se ve ni la juntura ni el verde— y
  //     dentro va una vena casi negra: el corte en V es lo que se lee como hondo
  //     desde arriba. Un solo tono plano se leería como una baldosa oscura.
  l.push(caja(p.viga, 0, -0.05, 0, 1.0, 0.07, 1.0))

  // 2 · el hueco que queda a la vista: se encoge solo por los lados cerrados
  const borde = (k) => (sigue[k] ? 0.5 : 0.5 - CAB - ESC + 0.02)
  const xO = -borde(3); const xE = borde(1); const zN = -borde(0); const zS = borde(2)
  const cx = (xO + xE) / 2; const cz = (zN + zS) / 2
  const ax = xE - xO; const az = zS - zN
  const nucleo = (k) => (sigue[k] ? 0.5 : borde(k) - 0.09)
  const nxO = -nucleo(3); const nxE = nucleo(1); const nzN = -nucleo(0); const nzS = nucleo(2)
  l.push(caja(p.carbon, (nxO + nxE) / 2, -0.01, (nzN + nzS) / 2, nxE - nxO, 0.035, nzS - nzN))

  if (conAgua) {
    l.push(caja(M.agua, cx, -0.01, cz, ax, 0.045, az))
    if (det) {
      // dos brillos cruzados: es lo que hace que se lea agua y no baldosa azul
      l.push(pieza(G.caja, p.telaCruda, { x: cx - 0.09, y: 0.045, z: cz + 0.06, sx: ax * 0.4, sy: 0.012, sz: 0.05, ry: 0.5 }))
      l.push(pieza(G.caja, p.telaCruda, { x: cx + 0.13, y: 0.045, z: cz - 0.11, sx: ax * 0.2, sy: 0.012, sz: 0.04, ry: 0.5 }))
    }
  }

  // 3 · las estacas del fondo: lo que dice que la zanja no es decorativa. Pocas y
  //     flacas: puestas en fila casilla tras casilla, cualquier exceso se lee como
  //     una valla y no como lo que hay DENTRO de un hoyo.
  const estaca = (x, z, h, incl) => l.push(pieza(G.cono6, p.viga, { x, y: 0.02 + h / 2, z, sx: 0.07, sy: h, sz: 0.07, rz: incl }))
  estaca(cx - Math.min(0.13, ax * 0.3), cz + Math.min(0.09, az * 0.25), 0.2, 0.26)
  if (n >= 4) estaca(cx + Math.min(0.12, ax * 0.26), cz - Math.min(0.07, az * 0.2), 0.25, -0.2)
  if (det && n >= 7) estaca(cx, cz + Math.min(0.18, az * 0.4), 0.17, 0.1)

  // 4 · las paredes del lado cerrado: escalón y caballón
  const LADOS = [[0, -1], [1, 0], [0, 1], [-1, 0]]
  for (let k = 0; k < 4; k++) {
    if (sigue[k]) continue
    const [dx, dz] = LADOS[k]
    const enX = dx !== 0
    // escalón de tierra removida entre el caballón y el fondo: el peldaño de la
    // escarpa. Bajo, a propósito: si sube tapa el hueco desde la cámara y la
    // zanja se lee como un muro oscuro en vez de como un agujero.
    const ex = dx * (0.5 - CAB - ESC / 2); const ez = dz * (0.5 - CAB - ESC / 2)
    l.push(caja(p.tierra, ex, -0.02, ez, enX ? ESC : 1.0, 0.085, enX ? 1.0 : ESC))
    // el caballón se pasa un pelo de la casilla para empalmar con el de al lado
    const bx = dx * (0.5 - CAB / 2); const bz = dz * (0.5 - CAB / 2)
    l.push(cajaR(p.tierra, bx, -0.02, bz, enX ? CAB : 1.02, alto, enX ? 1.02 : CAB, 0, 0.05))
    // un cascote de la piedra que salió al cavar. Uno por lado y menudo: el
    // caballón corre de casilla en casilla y dos ya se leen como un collar.
    if (det) l.push(roca(p.piedraOscura, bx + (enX ? 0 : 0.24), alto - 0.05, bz + (enX ? 0.24 : 0), 0.12))
  }
  return l
}

// ── GALONES DE NIVEL ─────────────────────────────────────────────────────

/**
 * Lo que hace que subir de nivel SE VEA, nivel a nivel.
 *
 * Es una lista ACUMULATIVA: el nivel n lleva todo lo del anterior y una cosa
 * más. Se reparte entre el nivel 1 y el máximo del edificio, así que en uno de
 * 14 niveles cae un añadido por nivel y en uno de 8 caen dos. Todo vive en el
 * PERÍMETRO de la plataforma —el único sitio que se conoce sin saber la forma
 * del edificio— y todo reutiliza materiales que el edificio ya tiene, así que
 * se funde en las mismas mallas: ni una llamada de dibujo más.
 *
 * OJO: p.remate es madera hasta el escalón de piedra y ORO en el último, así
 * que los mismos adornos se vuelven dorados al llegar al tope sin código aparte.
 */
const ORNAMENTOS = [
  // 1 · PEANA: un escalón ancho al pie. El edificio deja de flotar sobre el césped.
  (l, p, o) => l.push(caja(p.piedra, 0, o.y - 0.07, 0, o.ancho - 0.02, 0.08, o.alto - 0.02)),
  // 2 · ESCALINATA al frente: ya hay por dónde entrar, y se nota desde arriba
  (l, p, o) => l.push(caja(p.piedra, 0, o.y - 0.09, o.hz + 0.3, Math.min(1.25, o.ancho * 0.45), 0.1, 0.44)),
  // 3 · FAROL a la izquierda de la puerta
  (l, p, o) => farol(l, p, o, -1),
  // 4 · …y el de la derecha: dos niveles, dos cambios
  (l, p, o) => farol(l, p, o, 1),
  // 5 · CONTRAFUERTES: los machones que dicen "esto ya pesa"
  (l, p, o) => {
    for (const sx of [-1, 1]) {
      l.push(pieza(G.caja, p.piedra, { x: sx * (o.hx + 0.02), y: o.y + 0.44, z: -o.hz * 0.3, sx: 0.26, sy: 0.95, sz: 0.44, rz: sx * 0.1 }))
    }
  },
  // 6 · ESTANDARTE alto a la espalda: la primera seña de rango que se ve de lejos
  (l, p, o) => {
    const z = -(o.hz + 0.3)
    l.push(caja(p.palo, 0, o.y - 0.05, z, 0.09, 1.5, 0.09))
    l.push(caja(p.tela, 0.25, o.y + 0.9, z, 0.44, 0.52, 0.04))
    l.push(pieza(G.cono, p.tela, { x: 0.25, y: o.y + 0.79, z, sx: 0.44, sy: 0.22, sz: 0.04, rz: PI }))
  },
  // 7 · MOJONES delanteros: el recinto propio empieza a cerrarse
  (l, p, o) => {
    for (const sx of [-1, 1]) l.push(caja(p.piedra, sx * o.hx, o.y - 0.04, o.hz, 0.24, 0.52, 0.24))
  },
  // 8 · …y los de atrás: el recinto queda cerrado
  (l, p, o) => {
    for (const sx of [-1, 1]) l.push(caja(p.piedra, sx * o.hx, o.y - 0.04, -o.hz, 0.24, 0.52, 0.24))
  },
  // 9 · PINÁCULOS sobre los mojones (de madera abajo, de oro en el tope)
  (l, p, o) => {
    for (const sx of [-1, 1]) {
      l.push(pieza(G.cono6, p.luz, { x: sx * o.hx, y: o.y + 0.62, z: -o.hz, sx: 0.3, sy: 0.36, sz: 0.3 }))
      l.push(pieza(G.cono6, p.luz, { x: sx * o.hx, y: o.y + 0.62, z: o.hz, sx: 0.3, sy: 0.36, sz: 0.3 }))
    }
  },
  // 10 · FILO DE ORO en el plinto: una losa un pelín MÁS ANCHA que el plinto y
  //      metida a media altura, así solo asoma el canto. El edificio ya es de los caros.
  (l, p, o) => l.push(caja(p.luz, 0, o.y - 0.055, 0, o.ancho - 0.1, 0.05, o.alto - 0.1)),
  // 11 · CORONA de remates dorados: el tope, y se ve sin leer el número
  (l, p, o) => {
    for (const sx of [-1, 1]) {
      l.push(caja(p.luz, sx * o.hx, o.y + 0.06, 0, 0.16, 0.18, 0.16))
      l.push(caja(p.luz, sx * o.hx * 0.42, o.y + 0.06, -o.hz, 0.16, 0.18, 0.16))
    }
  }
]

/** Farol de la entrada: poste de piedra y luz encima (dorada en el tope). */
function farol (l, p, o, lado) {
  const x = lado * (Math.min(1.25, o.ancho * 0.45) / 2 + 0.3)
  const z = o.hz + 0.26
  l.push(caja(p.piedra, x, o.y - 0.08, z, 0.13, 0.7, 0.13))
  l.push(caja(p.luz, x, o.y + 0.62, z, 0.16, 0.17, 0.16))
  l.push(pieza(G.cono6, p.piedra, { x, y: o.y + 0.86, z, sx: 0.24, sy: 0.14, sz: 0.24 }))
}

/**
 * Paleta de los galones RESUELTA contra los materiales que el edificio ya usa.
 *
 * Es la clave de que esto sea gratis: un adorno nunca estrena material, y un
 * material nuevo en un edificio es una llamada de dibujo más POR EDIFICIO. Si
 * la piedra que pide el adorno no está en la casa, se coge la que sí esté.
 * La única excepción es la LUZ dorada del tope, que sí se permite estrenar:
 * es el premio de llegar al último cuarto de niveles y se ve a la legua.
 */
function paletaGalon (p, usados) {
  const hay = (m) => m && usados.has(m.uuid)
  const primero = (...ms) => ms.find(hay) || ms[0]
  return {
    piedra: primero(p.zocalo, p.muroAlt, p.piedraOscura, p.piedra, p.muro),
    palo: primero(p.madera, p.oscuro, p.muroAlt, p.zocalo),
    tela: primero(p.acento, p.tela, p.techo, p.muroAlt),
    luz: p.remate
  }
}

/** Cuántos galones toca lucir, y los coloca. */
function galones (l, p, o, usados) {
  const max = Math.max(1, o.max | 0)
  if (max <= 1) return
  const N = ORNAMENTOS.length
  const cuantos = Math.max(0, Math.min(N, Math.round(((o.n - 1) / (max - 1)) * N)))
  if (!cuantos) return
  const pg = paletaGalon(p, usados)
  const c = {
    ...o,
    hx: o.ancho / 2 - 0.17,
    hz: o.alto / 2 - 0.17,
    y: o.plano ? 0.02 : SUELO
  }
  for (let i = 0; i < cuantos; i++) ORNAMENTOS[i](l, pg, c)
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
  l.push(fronton(p.muroAlt, 0, y + 0.14 + h, (alto - 0.6) / 2, ancho - 0.3, 0.5))
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
  foso: fFoso,
  castillo: fCastillo,
  pozo: fPozo,
  estandarte: fEstandarte,
  puesto_avanzado: fPuestoAvanzado
}

/** Estos se apoyan directamente en la hierba: una plataforma les quedaría fatal. */
const SIN_PLATAFORMA = new Set(['muralla', 'puerta', 'estandarte', 'pozo', 'cantera', 'mina_oro', 'granja', 'campamento_explorador', 'foso'])

/**
 * Y estos tampoco lucen galones de nivel: los trozos de muralla son de una
 * casilla y se trenzan con sus vecinos (cualquier adorno rompe el encaje), y
 * el pozo y el estandarte no suben de nivel.
 */
const SIN_GALONES = new Set(['muralla', 'puerta', 'estandarte', 'pozo', 'foso'])

// ── fábrica de modelos (una vez por tipo+nivel+escalón, el resto son clones) ──

const cacheModelos = new Map()

const tieneAnim = (o) => !!(o.userData && o.userData.anim)

/**
 * Funde todas las piezas estáticas que comparten material en una sola malla.
 * Un edificio de 30 cajas pasa a 4-6 llamadas de dibujo: es la diferencia entre
 * cincuenta edificios a 60 fps y un móvil ardiendo. Lo animado se queda fuera.
 */
/**
 * Compacta el INTERIOR de una pieza animada (las aspas del molino, la rueda de
 * la serrería): sus hijos se funden por material sin tocar el pivote, que es lo
 * que gira. Sin esto, unas aspas de nueve mallas costaban nueve llamadas.
 */
function fusionarDentro (nodo) {
  if (!nodo.children || nodo.children.length < 2) return
  const porMat = new Map()
  const recoger = (o, m) => {
    const mm = m.clone().multiply(o.matrix)
    if (o.isMesh) {
      let e = porMat.get(o.material.uuid)
      if (!e) porMat.set(o.material.uuid, e = { material: o.material, geos: [], sombra: o.castShadow })
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
      g.applyMatrix4(mm)
      e.geos.push(g)
    }
    for (const h of [...o.children]) recoger(h, mm)
  }
  for (const h of [...nodo.children]) recoger(h, new THREE.Matrix4())
  if (!porMat.size) return
  nodo.clear()
  for (const e of porMat.values()) {
    const geo = e.geos.length === 1 ? e.geos[0] : mergeGeometries(e.geos, false)
    if (!geo) continue
    const malla = new THREE.Mesh(geo, e.material)
    malla.castShadow = e.sombra
    malla.receiveShadow = true
    nodo.add(malla)
  }
}

function fusionar (raiz) {
  try {
    raiz.updateMatrixWorld(true)
    const porMat = new Map()
    const vivos = []
    const base = raiz.matrix.clone()      // el escalado de nivel de la raíz se hornea aquí
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
      fusionarDentro(nodo)      // las aspas y la rueda también se compactan
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
  // muralla y foso se trenzan con sus vecinos, así que cada combinación de
  // vecinos es un modelo distinto y la máscara entra en la clave del caché
  const mask = (tipo === 'muralla' || tipo === 'foso') ? (o.mask | 0) : 0
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
  const p = paletaDe(tonoDe(n, d.maxNivel || 8), FAMILIA[tipo] || 'centro')
  const t = p.t
  const det = ctx.calidad !== 'bajo'
  const raiz = new THREE.Group()
  let piezas
  if (estado === 'obra') piezas = fAndamio(p, det, ancho, alto)
  else if (estado === 'ruina') piezas = fRuina(p, ancho, alto)
  else {
    piezas = []
    const plano = SIN_PLATAFORMA.has(tipo)
    if (!plano) {
      // PLATAFORMA PROPIA: un plinto con los doce cantos matados. Sin él el
      // edificio se ve pegado al césped como una calcomanía; con él se asienta,
      // que es media pelea del acabado. Va del MISMO material que el zócalo del
      // edificio, así que no estrena material ni cuesta una llamada de dibujo.
      piezas.push(plinto(p.zocalo, 0, -0.015, 0, ancho - 0.16, SUELO + 0.025, alto - 0.16, 0.12))
    }
    const cuerpo = (CONSTRUCTORES[tipo] || fGenerico)({ p, n, t, det, ancho, alto, mask })
    piezas.push(...cuerpo)
    if (!SIN_GALONES.has(tipo)) {
      // qué materiales gasta ya este edificio: los galones se atendrán a ellos
      const usados = new Set(plano ? [] : [p.zocalo.uuid])
      const anotar = (x) => {
        // lo que cuelga de una pieza ANIMADA no entra en la fusión estática, así
        // que su material no vale como "ya lo tengo": contarlo colaría un
        // material nuevo en la malla fusionada y con él una llamada de dibujo
        if (tieneAnim(x)) return
        if (x.isMesh) usados.add(x.material.uuid)
        if (x.children) for (const h of x.children) anotar(h)
      }
      for (const x of piezas) if (x) anotar(x)
      galones(piezas, p, { n, max: d.maxNivel || 8, t, det, ancho, alto, plano }, usados)
    }
  }
  for (const x of piezas) if (x) raiz.add(x)
  // CRECER CON EL NIVEL: un empujón por nivel, mucho más en alto que en planta
  // (en planta hay vecinos pegados). Acumulado, el nivel 14 saca una cabeza al
  // nivel 1 y la diferencia entre dos niveles seguidos ya se nota en la silueta.
  if (estado === 'ok') {
    const ex = 1 + 0.005 * (n - 1)
    raiz.scale.set(ex, 1 + 0.021 * (n - 1), ex)
  }
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
  const m = b.tipo === 'muralla' ? mascaraEn(b.x, b.z) : b.tipo === 'foso' ? mascaraFosoEn(b.x, b.z) : 0
  return `${b.tipo}|${b.nivel}|${estadoDe(b)}|${m}|${b.x}|${b.z}|${b.rot | 0}`
}

/** Quita de la escena sin liberar geometrías: TODAS son compartidas. */
function desmontar (g) {
  if (g && g.parent) g.parent.remove(g)
}

function giroDe (b, ancho, alto) {
  const rot = (b.rot | 0) % 4
  if (b.tipo === 'muralla' || b.tipo === 'foso') return 0   // los orienta su máscara de vecinos
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
      py: o.position.y,
      s0: o.scale.x,
      sy: o.scale.y
    })
  })
}

function olvidarAnim (id) {
  for (let i = animados.length - 1; i >= 0; i--) if (animados[i].id === id) animados.splice(i, 1)
}

function tween (g, tipo, dur, alAcabar) {
  tweens.push({ g, tipo, k: 0, dur, alAcabar, y0: g.position.y })
}

// ── el polvo de la mejora ────────────────────────────────────────────────
// Cuando el edificio nuevo golpea el suelo levanta un halo de polvo que se
// abre y se deshace. Es UNA malla reciclada de una reserva de tres: ni se
// crea nada por frame ni se toca el material compartido (se apaga aplastando
// el disco, no bajando la opacidad, que afectaría a los demás).
const anillosPolvo = []
const polvos = []

function polvoDeMejora (pos, b) {
  if (ctx.calidad === 'bajo') return
  const r = Math.max(b?.ancho ?? 2, b?.alto ?? 2) * 0.42
  let a = anillosPolvo.find(x => !x.visible)
  if (!a) {
    if (anillosPolvo.length >= 3) return
    a = pieza(G.cilindro12, mat(PALETA.polvo, { transparente: 0.5 }), {})
    a.castShadow = false
    a.receiveShadow = false
    a.renderOrder = 2
    anillosPolvo.push(a)
    aEscena(a)
  }
  a.position.set(pos.x, pos.y + 0.05, pos.z)
  a.visible = true
  polvos.push({ obj: a, k: 0, r })
}

/** Dibuja (o redibuja) un edificio. `efecto` da el plop, la mejora o nada. */
function pintar (b, efecto = null) {
  const viejo = mallas.get(b.id)
  const g = crearEdificio(b.tipo, Math.max(1, b.nivel), {
    estado: estadoDe(b),
    mask: b.tipo === 'muralla' ? mascaraEn(b.x, b.z) : b.tipo === 'foso' ? mascaraFosoEn(b.x, b.z) : 0
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
      tween(viejo.g, 'encoger', 0.2, () => desmontar(viejo.g))
      tween(g, 'aterrizar', 0.62)
      polvoDeMejora(g.position, b)
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

/**
 * Tras tocar una muralla —o un foso— hay que repasar a sus vecinos: el trozo
 * cambia de forma. Cada familia mira solo a la suya (el foso se traba con fosos
 * y la muralla con sus anclajes), así que una cosa nunca redibuja la otra.
 */
function refrescarVecinas (b) {
  if (!b) return
  const esFoso = b.tipo === 'foso'
  if (!esFoso && !ANCLAJES.has(b.tipo)) return
  const vecino = esFoso ? 'foso' : 'muralla'
  const a = b.ancho ?? 1; const h = b.alto ?? 1
  for (const otro of game.state.buildings) {
    if (otro.tipo !== vecino || otro.id === b.id) continue
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
      case 'rueda':
        // la rueda hidráulica gira despacio y en el eje X: es la que mueve la sierra
        a.obj.rotation.x += dt * 0.55 * a.vel
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
      case 'humo': {
        // El penacho SUBE, se abre y se deshace, y vuelve a empezar. Un solo
        // objeto reciclado: ni una malla nueva por frame.
        const u = (t * 0.3 * a.vel + a.fase * 0.16) % 1
        a.obj.position.y = a.py + u * 1.25
        const e = a.s0 * (0.4 + u * 1.15) * (1 - u * 0.82)
        a.obj.scale.set(Math.max(0.01, e), Math.max(0.01, e), Math.max(0.01, e))
        a.obj.rotation.y = a.by + u * 1.4
        break
      }
      case 'fuelle':
        // el fuelle de la fragua respira: aplasta y estira despacio
        a.obj.scale.y = a.sy * (1 + Math.sin(t * 1.9 + a.fase) * 0.28)
        break
      case 'veleta':
        // gira a rachas, no a velocidad constante: parece viento y no un motor
        a.obj.rotation.y = a.by + Math.sin(t * 0.31 + a.fase) * 1.5 + Math.sin(t * 0.73 + a.fase) * 0.35
        break
    }
  }

  for (let i = polvos.length - 1; i >= 0; i--) {
    const d = polvos[i]
    d.k += dt / 0.5
    const k = Math.min(1, d.k)
    const e = d.r * (0.55 + k * 1.7)
    d.obj.scale.set(e, Math.max(0.005, 0.3 * (1 - k) * (1 - k)), e)
    d.obj.position.y += dt * 0.22
    if (k >= 1) { d.obj.visible = false; polvos.splice(i, 1) }
  }

  for (let i = tweens.length - 1; i >= 0; i--) {
    const w = tweens[i]
    w.k += dt / w.dur
    const k = Math.min(1, w.k)
    if (w.tipo === 'aterrizar') {
      // LA MEJORA: el edificio nuevo cae desde arriba y da un golpe al asentar.
      // El rebote amortiguado (squash & stretch) es lo que le da el empaque.
      const caida = k < 0.4 ? Math.pow(1 - k / 0.4, 2) * 0.85 : 0
      const g2 = Math.max(0, (k - 0.4) / 0.6)
      const golpe = k < 0.4 ? 0 : Math.sin(g2 * Math.PI * 2.3) * Math.exp(-g2 * 3.6) * 0.2
      w.g.position.y = w.y0 + caida
      w.g.scale.set(1 + golpe, Math.max(0.05, 1 - golpe * 1.4), 1 + golpe)
      if (k >= 1) { w.g.position.y = w.y0; w.g.scale.set(1, 1, 1) }
    } else if (w.tipo === 'plop') {
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
