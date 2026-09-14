import * as THREE from 'three'
import { CONFIG, PALETA } from '../core/config.js'
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { makeRng } from '../core/rng.js'
import {
  gridAMundo, parcelaDe, rectParcela, centroParcela, parcelaEsMia, parcelaDisponible,
  LADO_PARCELA, PARCELAS, idParcela
} from '../core/grid.js'
import { ctx, aEscena, onFrame } from './ctx.js'
import { mat, M, G } from './mats.js'

/**
 * EL VALLE. Isla-maqueta de 60x60 casillas flotando sobre el mar:
 * tablero LLANO donde se construye, lomas suaves alrededor, acantilado de
 * tierra y roca, playa, bosques, rocas y caminos. Todo generado con la semilla
 * de la partida, así que al recargar la aldea es SIEMPRE la misma.
 *
 * `alturaEn()` es la única fuente de verdad del suelo: devuelve EXACTAMENTE la
 * cota de la malla que se dibuja, y se prepara sola si se la llama antes de
 * init() (scene.js y buildings.js lo hacen).
 *
 * Se construye una sola vez. Por frame solo se mueve un número: el reloj que
 * ondula el mar en el sombreador.
 *
 * EL TERRITORIO SE VE. El valle está repartido en parcelas (core/grid.js) y solo
 * unas cuantas son tuyas. Lo que no lo es se pinta apagado, se llena de maleza y
 * se cierra con una linde de mojones y estacas; al ganar una parcela la linde se
 * abre, la maleza se retira y el verde vuelve, con la cámara mirando.
 */

// ── Medidas del escenario ────────────────────────────────────────────────
const MITAD = (CONFIG.GRID * CONFIG.CELDA) / 2   // 30: media anchura del tablero jugable
const MEDIO_LADO = MITAD + 16                    // la isla se pasa del tablero: hierba de sobra + acantilado
const R_ISLA = 42                                // radio (superelipse) donde empieza a caer el acantilado
const ANCHO_ORILLA = 3                           // franja en la que el prado baja hasta la arena
const ANCHO_PLAYA = 2                            // reborde de arena antes del tajo
const ANCHO_ACANTILADO = 2.6
const FONDO = -3.3                               // pie del acantilado, bien hundido
const NIVEL_MAR = -1.05                          // el mar deja el acantilado a la vista: la isla es una maqueta sobre el agua
const CENTRO_LIBRE = 7.2                         // media anchura de la plaza central (≈14x14 casillas) que se deja despejada

/**
 * LA MESETA DEL JUGADOR. Las 60x60 casillas del valle están LLANAS,
 * como en Clash of Clans: colocar edificios en pendiente hace que se apoyen
 * torcidos, que el dedo apunte a una casilla y toque otra, y que las murallas
 * no casen entre sí. El relieve se queda donde sí suma: el borde y los
 * alrededores, que es lo que se ve de fondo y da forma a la isla.
 */
const ALTURA_PLAZA = 0.3                         // cota única del tablero (a media altura del relieve viejo)
const MARGEN_LLANO = 3                           // franja en la que la meseta se funde con las lomas de fuera

// paso de la malla: fino dentro del tablero (1 cara por casilla, que es donde se
// mira de cerca) y mucho más grueso fuera, donde solo se ve de lejos y en
// escorzo. Con el valle de 60x60 esto es lo que salva al triángulo de más.
const PASO_FUERA = 4

// ── Estado del módulo ────────────────────────────────────────────────────
let ruidoBajo, ruidoAlto, ruidoCosta, ruidoPiedra, ruidoTono
let caminos = []                                 // polilíneas en coordenadas de mundo
let rejilla = null
let opacidadObjetivo = 0
let mar = null
/** Reloj del oleaje: se comparte con el sombreador del mar (un solo número por frame). */
const relojMar = { value: 0 }
/** decoración por casilla del tablero: 'x|z' -> [{ malla, i }] para poder talar */
const porCasilla = new Map()
const casillasDespejadas = new Set()

// ── Territorio: lo que hace falta para aclarar una parcela en caliente ───
/** color real de cada cara del valle, sin apagar: Float32Array(caras*3) */
let colBase = null
let atribColor = null
/** id de parcela -> índices de sus caras, y el trozo de búfer que ocupan */
const carasDeParcela = new Map()
const rangoDeParcela = new Map()
/** id de parcela -> cuánto está apagada ahora mismo (1 = barbecho, 0 = tuya) */
const opacoParcela = new Map()
/** maleza y zarzas de cada parcela: 'id' -> [{ malla, i }], para retirarlas al conquistar */
const malezaPorParcela = new Map()
/** linde (mojones y estacas) y banderas de las parcelas que esperan dueño */
let linde = null
let banderas = null
const banderaDe = new Map()
/** animaciones vivas: { id, t, dur, maleza:[{malla,i,m}] } */
const conquistas = []

// ── Ruido de valor con semilla ───────────────────────────────────────────
const suavizar = (t) => t * t * (3 - 2 * t)

/** Ruido de valor 2D periódico: barato, continuo y siempre igual con la misma semilla. */
function crearRuido (rng, n = 16) {
  const v = new Float32Array(n * n)
  for (let i = 0; i < v.length; i++) v[i] = rng.next()
  return (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z)
    const fx = suavizar(x - xi), fz = suavizar(z - zi)
    const i = ((xi % n) + n) % n, j = ((zi % n) + n) % n
    const i2 = (i + 1) % n, j2 = (j + 1) % n
    const a = v[j * n + i], b = v[j * n + i2], c = v[j2 * n + i], d = v[j2 * n + i2]
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz
  }
}

// ── Forma del terreno ────────────────────────────────────────────────────

/** Relieve del prado: lomas muy suaves, entre 0 y ALTURA_MAX. */
function relieve (wx, wz) {
  const n = ruidoBajo(wx * 0.085 + 3.1, wz * 0.085 + 7.7) * 0.68 +
            ruidoAlto(wx * 0.21 - 1.3, wz * 0.21 + 4.2) * 0.32
  return n * CONFIG.ALTURA_MAX
}

/**
 * Distancia al centro con forma de cuadrado redondeado y el borde mordido por
 * el ruido: así la isla cabe el tablero entero pero no parece una galleta.
 */
function distIsla (wx, wz) {
  const p = 6
  const d = Math.pow(Math.pow(Math.abs(wx), p) + Math.pow(Math.abs(wz), p), 1 / p)
  return d + (ruidoCosta(wx * 0.04, wz * 0.04) - 0.5) * 2
}

const INICIO_PLAYA = R_ISLA - ANCHO_PLAYA
const INICIO_ORILLA = INICIO_PLAYA - ANCHO_ORILLA

/**
 * Prado: llano dentro del tablero y con lomas fuera, fundiéndose sin costura.
 * Se mide en cuadrado (no en círculo) porque el tablero es cuadrado.
 */
function alturaPrado (wx, wz) {
  const q = Math.abs(wx) > Math.abs(wz) ? Math.abs(wx) : Math.abs(wz)
  if (q <= MITAD) return ALTURA_PLAZA
  if (q >= MITAD + MARGEN_LLANO) return relieve(wx, wz)
  const t = suavizar((q - MITAD) / MARGEN_LLANO)
  return ALTURA_PLAZA * (1 - t) + relieve(wx, wz) * t
}

/** Altura del terreno en coordenadas de MUNDO. Única fuente de verdad del relieve. */
function alturaMundo (wx, wz) {
  const d = distIsla(wx, wz)
  if (d <= INICIO_ORILLA) return alturaPrado(wx, wz)
  if (d <= INICIO_PLAYA) {
    const t = suavizar((d - INICIO_ORILLA) / ANCHO_ORILLA)
    return alturaPrado(wx, wz) * (1 - t) + 0.12 * t
  }
  if (d <= R_ISLA) return 0.12 - 0.12 * ((d - INICIO_PLAYA) / ANCHO_PLAYA)   // reborde de arena casi llano
  if (d <= R_ISLA + ANCHO_ACANTILADO) {
    const t = (d - R_ISLA) / ANCHO_ACANTILADO
    return FONDO * Math.pow(t, 0.8)   // casi vertical arriba: parece un tajo de tierra y roca
  }
  return FONDO
}

// ── Caminos ──────────────────────────────────────────────────────────────

/** Cuatro sendas que salen del centro hacia los bordes. Solo son color en el suelo. */
function trazarCaminos (rng) {
  const rutas = []
  for (let k = 0; k < 4; k++) {
    const base = k * Math.PI / 2 + rng.float(-0.3, 0.3)
    const puntos = []
    for (let r = 0; r <= R_ISLA - 3.5; r += 3.5) {
      const a = base + Math.sin(r * 0.22 + k) * 0.16
      puntos.push([Math.cos(a) * r, Math.sin(a) * r])
    }
    rutas.push(puntos)
  }
  return rutas
}

function distACamino (wx, wz) {
  let mejor = 99
  for (const ruta of caminos) {
    for (let i = 1; i < ruta.length; i++) {
      const [ax, az] = ruta[i - 1], [bx, bz] = ruta[i]
      const dx = bx - ax, dz = bz - az
      const largo = dx * dx + dz * dz
      let t = largo ? ((wx - ax) * dx + (wz - az) * dz) / largo : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const px = ax + dx * t - wx, pz = az + dz * t - wz
      const d = Math.sqrt(px * px + pz * pz)
      if (d < mejor) mejor = d
    }
  }
  return mejor
}

// ── Malla del valle ──────────────────────────────────────────────────────

const cHierba = new THREE.Color(PALETA.hierba)
const cHierbaClara = new THREE.Color(PALETA.hierbaClara)
const cHierbaOscura = new THREE.Color(PALETA.hierbaOscura)
const cArena = new THREE.Color(PALETA.arena)
const cTierra = new THREE.Color(PALETA.tierra)
const cRoca = new THREE.Color(PALETA.roca)
const cRocaOscura = new THREE.Color(PALETA.rocaOscura)
const cCamino = new THREE.Color(PALETA.camino)
const cBarbecho = new THREE.Color(PALETA.barbecho)
const tmpColor = new THREE.Color()
const tmpColor2 = new THREE.Color()

/**
 * El verde de lo que todavía no es tuyo: el mismo terreno, pero apagado y tirando
 * a gris. Es a propósito el MISMO color de base: así se lee "esto es tierra que
 * podría ser mía" y no "esto es otro bioma".
 */
function apagar (r, g, b, f, salida) {
  salida.setRGB(r, g, b)
  if (f <= 0) return salida
  tmpColor2.copy(salida).lerp(cBarbecho, 0.7).multiplyScalar(0.78)
  return salida.lerp(tmpColor2, f)
}

const acotar = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Color plano de una cara según dónde cae: prado, camino, playa o acantilado. */
function colorDeCara (cx, cy, cz, salida) {
  const d = distIsla(cx, cz)

  if (d > R_ISLA + 0.1) {                       // el tajo: tierra arriba, roca según se hunde
    const r = ruidoPiedra(cx * 0.5, cz * 0.5)
    if (cy < -1.9) salida.copy(r > 0.45 ? cRocaOscura : cRoca)
    else if (cy < -0.8) salida.copy(r > 0.5 ? cRoca : cTierra)
    else salida.copy(r > 0.72 ? cRoca : cTierra)
    return salida
  }
  if (d > INICIO_PLAYA - 0.6) { salida.copy(cArena); return salida }

  const dc = distACamino(cx, cz)
  if (dc < 0.9) { salida.copy(cCamino); return salida }

  // mezcla de tres verdes: ruido ancho + pellizco por faceta para que no haya manchas planas.
  // El matiz sigue el relieve ORIGINAL aunque el tablero esté aplanado: así el
  // prado conserva sus lomas de color y no se convierte en una moqueta verde.
  const m = acotar(
    0.58 + (ruidoTono(cx * 0.16 + 9.1, cz * 0.16 - 2.4) - 0.5) * 1.7 +
    (relieve(cx, cz) / CONFIG.ALTURA_MAX - 0.45) * 0.42 +
    (ruidoPiedra(cx * 3.1, cz * 3.1) - 0.5) * 0.24
  )
  if (m < 0.5) salida.lerpColors(cHierbaOscura, cHierba, m * 2)
  else salida.lerpColors(cHierba, cHierbaClara, (m - 0.5) * 2)
  if (dc < 1.6) salida.lerp(cCamino, (1.6 - dc) / 0.7 * 0.3)   // bordes del camino desgastados
  return salida
}

/**
 * Líneas de corte de la malla: una por casilla dentro del tablero (que es donde
 * se juega y se mira de cerca) y del doble de anchas fuera. Recorta casi un
 * tercio de los triángulos del valle sin que se note en pantalla.
 */
function cortes () {
  const v = []
  for (let w = -MEDIO_LADO; w < -MITAD - 1e-6; w += PASO_FUERA) v.push(w)
  for (let w = -MITAD; w <= MITAD + 1e-6; w += CONFIG.CELDA) v.push(w)
  for (let w = MITAD + PASO_FUERA; w <= MEDIO_LADO + 1e-6; w += PASO_FUERA) v.push(w)
  if (v[v.length - 1] < MEDIO_LADO - 1e-6) v.push(MEDIO_LADO)
  return v
}

function construirValle () {
  // geometría propia: el terreno es la única malla que no puede salir de mats.js.
  // Se teje a mano (sin PlaneGeometry) para poder usar paso fino dentro del
  // tablero y grueso fuera, y para escribir ya las caras sin índices: cada
  // triángulo es una faceta independiente con SU color plano.
  const ejes = cortes()
  const n = ejes.length
  const alturas = new Float32Array(n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) alturas[j * n + i] = alturaMundo(ejes[i], ejes[j])
  }

  const caras = (n - 1) * (n - 1) * 2
  const pos = new Float32Array(caras * 9)
  const col = new Float32Array(caras * 9)
  let o = 0
  const vertice = (i, j) => {
    pos[o] = ejes[i]; pos[o + 1] = alturas[j * n + i]; pos[o + 2] = ejes[j]
    o += 3
  }
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      // el orden de los vértices deja la cara mirando al cielo
      vertice(i, j); vertice(i, j + 1); vertice(i + 1, j)
      vertice(i + 1, j); vertice(i, j + 1); vertice(i + 1, j + 1)
    }
  }
  // Color "de verdad" de cada cara (sin apagar) y a qué parcela pertenece: es lo
  // que permite aclarar una parcela entera al conquistarla sin recalcular nada.
  colBase = new Float32Array(caras * 3)
  const deParcela = new Map()
  const off = (CONFIG.GRID - 1) / 2
  for (let t = 0; t < caras; t++) {
    const b = t * 9
    const cx = (pos[b] + pos[b + 3] + pos[b + 6]) / 3
    const cy = (pos[b + 1] + pos[b + 4] + pos[b + 7]) / 3
    const cz = (pos[b + 2] + pos[b + 5] + pos[b + 8]) / 3
    colorDeCara(cx, cy, cz, tmpColor)
    colBase[t * 3] = tmpColor.r
    colBase[t * 3 + 1] = tmpColor.g
    colBase[t * 3 + 2] = tmpColor.b

    const p = parcelaDe(Math.round(cx / CONFIG.CELDA + off), Math.round(cz / CONFIG.CELDA + off))
    let f = 0
    if (p) {
      let lote = deParcela.get(p.id)
      if (!lote) deParcela.set(p.id, lote = [])
      lote.push(t)
      f = parcelaEsMia(game.state, p.id) ? 0 : 1
      opacoParcela.set(p.id, f)
    }
    apagar(tmpColor.r, tmpColor.g, tmpColor.b, f, tmpColor)
    for (let k = 0; k < 3; k++) {
      col[b + k * 3] = tmpColor.r
      col[b + k * 3 + 1] = tmpColor.g
      col[b + k * 3 + 2] = tmpColor.b
    }
  }
  // Índice por parcela + el trozo contiguo del búfer que la contiene: al animar
  // una conquista se sube a la tarjeta ese pedazo y no el valle entero.
  carasDeParcela.clear()
  for (const [id, lista] of deParcela) {
    carasDeParcela.set(id, Int32Array.from(lista))
    rangoDeParcela.set(id, [lista[0] * 9, (lista[lista.length - 1] - lista[0] + 1) * 9])
  }

  const plano = new THREE.BufferGeometry()
  plano.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  plano.setAttribute('color', new THREE.BufferAttribute(col, 3))
  plano.computeVertexNormals()
  atribColor = plano.getAttribute('color')

  // clon del material compartido: mats.js no expone colores por vértice
  const material = mat(PALETA.hierba).clone()
  material.vertexColors = true
  const malla = new THREE.Mesh(plano, material)
  malla.receiveShadow = true
  malla.castShadow = false
  malla.name = 'valle'
  return malla
}

// ── Mar ──────────────────────────────────────────────────────────────────

/**
 * El oleaje lo hace la TARJETA, no la CPU: antes se reescribían y se subían a la
 * GPU los 841 vértices del mar en cada frame. Ahora solo se mueve un número
 * (el reloj) y el vértice se desplaza en el sombreador. Se ve exactamente igual.
 */
function materialDelMar () {
  const m = M.agua.clone()
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uReloj = relojMar
    m.userData.ondulado = true      // marca de comprobación: el oleaje va por sombreador
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n uniform float uReloj;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y += sin(position.x * 0.19 + uReloj * 1.15) * 0.16
                       + cos(position.z * 0.26 - uReloj * 0.85) * 0.12;`)
  }
  // sin esto Three reutilizaría el programa del agua plana de otros módulos
  m.customProgramCacheKey = () => 'mar-ondulado'
  return m
}

function construirMar () {
  const g = new THREE.PlaneGeometry(170, 170, 28, 28)
  g.rotateX(-Math.PI / 2)
  const malla = new THREE.Mesh(g, materialDelMar())
  malla.position.y = NIVEL_MAR
  malla.receiveShadow = false
  malla.castShadow = false
  malla.frustumCulled = false
  malla.name = 'mar'

  // fondo oscuro que se ve a través del agua y cierra el horizonte
  const fondo = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mat(PALETA.aguaProfunda))
  fondo.rotation.x = -Math.PI / 2
  fondo.position.y = NIVEL_MAR - 1.2
  fondo.receiveShadow = false
  fondo.castShadow = false
  fondo.frustumCulled = false

  return { malla, fondo }
}


// ── Vegetación y rocas instanciadas ──────────────────────────────────────

/**
 * Cada "planta" es un objeto compuesto por varias piezas. Cada pieza vive en su
 * propio InstancedMesh (una llamada de dibujo) y comparte la matriz base de la
 * planta multiplicada por su desplazamiento local.
 */
const PIEZAS = {
  pino: [
    { geo: () => G.cilindro, matl: () => M.tronco, y: 0.3, s: [0.15, 0.6, 0.15] },
    { geo: () => G.cono6, matl: () => M.copaPino, y: 0.85, s: [1.05, 1.0, 1.05] },
    { geo: () => G.cono6, matl: () => M.copaPino, y: 1.35, s: [0.82, 0.85, 0.82] },
    { geo: () => G.cono6, matl: () => mat(PALETA.copaPinoClara), y: 1.78, s: [0.55, 0.7, 0.55] }
  ],
  roble: [
    { geo: () => G.cilindro, matl: () => M.tronco, y: 0.35, s: [0.17, 0.7, 0.17] },
    { geo: () => G.esfera, matl: () => M.copaRoble, y: 1.0, s: [1.5, 1.05, 1.5] },
    { geo: () => G.esfera, matl: () => mat(PALETA.arbusto), y: 1.35, x: 0.22, s: [0.95, 0.7, 0.95] }
  ],
  roca: [
    { geo: () => G.esfera, matl: () => mat(PALETA.roca), y: 0.2, s: [1, 0.8, 1] }
  ],
  penasco: [
    { geo: () => G.esfera, matl: () => mat(PALETA.rocaOscura), y: 0.25, s: [1, 0.85, 1] }
  ],
  arbusto: [
    { geo: () => G.esfera, matl: () => mat(PALETA.arbusto), y: 0.18, s: [1, 0.75, 1] }
  ],
  hierba: [
    { geo: () => G.cono, matl: () => mat(PALETA.hierbaOscura), y: 0.2, s: [0.5, 0.4, 0.5] }
  ],
  flor: [
    { geo: () => G.esfera, matl: () => mat(PALETA.florBlanca), y: 0.16, s: [0.16, 0.16, 0.16] }
  ],
  // --- lo que cubre la tierra que aún no es tuya ---
  zarza: [
    { geo: () => G.esfera, matl: () => mat(PALETA.maleza), y: 0.22, s: [1, 0.85, 1] },
    { geo: () => G.cono, matl: () => mat(PALETA.barbechoOscuro), y: 0.5, s: [0.55, 0.8, 0.55] }
  ],
  ruina: [
    { geo: () => G.caja, matl: () => mat(PALETA.piedraOscura), y: 0.26, s: [1, 0.5, 0.4] },
    { geo: () => G.caja, matl: () => mat(PALETA.linde), y: 0.6, x: 0.3, s: [0.45, 0.55, 0.34] }
  ]
}

/** Los que se talan al construir encima. La hierba y las flores no estorban. */
const TALABLE = new Set(['pino', 'roble', 'roca', 'penasco', 'arbusto', 'zarza', 'ruina'])
/** Lo que se retira SOLO al conquistar la parcela: es la señal de "esto está en barbecho". */
const MALEZA = new Set(['zarza', 'ruina'])

const COLORES_FLOR = [PALETA.florBlanca, PALETA.florRoja, PALETA.florAmarilla, PALETA.florAzul]

function sembrar (rng) {
  const factor = ctx.calidad === 'bajo' ? 0.5 : ctx.calidad === 'alto' ? 1.3 : 1
  const cuantos = (n) => Math.max(1, Math.round(n * factor))
  const plantas = []

  const libre = (wx, wz, margen = CENTRO_LIBRE, camino = 1.35) => {
    if (Math.abs(wx) < margen && Math.abs(wz) < margen) return null   // la plaza es del jugador
    if (distIsla(wx, wz) > INICIO_PLAYA - 1) return null              // ni en la arena ni en el acantilado
    if (distACamino(wx, wz) < camino) return null
    return alturaMundo(wx, wz)
  }

  const soltar = (tipo, wx, wz, y, sBase, giroLibre = false) => {
    plantas.push({
      tipo,
      x: wx,
      y,
      z: wz,
      s: sBase,
      sx: giroLibre ? sBase * rng.float(0.7, 1.35) : sBase,
      sz: giroLibre ? sBase * rng.float(0.7, 1.35) : sBase,
      rx: giroLibre ? rng.float(-0.5, 0.5) : 0,
      ry: rng.float(0, Math.PI * 2),
      rz: giroLibre ? rng.float(-0.5, 0.5) : 0,
      color: tipo === 'flor' ? rng.pick(COLORES_FLOR) : null
    })
  }

  /** Siembra n elementos en un disco, con rechazo si el sitio no vale. */
  const enDisco = (tipo, cx, cz, radio, n, escala, giroLibre = false) => {
    let puestos = 0, intentos = 0
    while (puestos < n && intentos < n * 14) {
      intentos++
      const a = rng.float(0, Math.PI * 2)
      const r = Math.sqrt(rng.next()) * radio
      const wx = cx + Math.cos(a) * r, wz = cz + Math.sin(a) * r
      const y = libre(wx, wz)
      if (y === null) continue
      soltar(tipo, wx, wz, y, escala(), giroLibre)
      puestos++
    }
  }

  const porLaIsla = (tipo, n, escala, giroLibre = false) => {
    let puestos = 0, intentos = 0
    while (puestos < n && intentos < n * 16) {
      intentos++
      const wx = rng.float(-R_ISLA, R_ISLA), wz = rng.float(-R_ISLA, R_ISLA)
      const y = libre(wx, wz)
      if (y === null) continue
      soltar(tipo, wx, wz, y, escala(), giroLibre)
      puestos++
    }
  }

  // --- 1. Bosquecillos: ahí es donde el jugador querrá poner serrerías ---
  const anilloBosque = rng.shuffle([0, 1, 2, 3, 4, 5])
  for (let k = 0; k < 4; k++) {
    const a = (anilloBosque[k] / 6) * Math.PI * 2 + rng.float(-0.25, 0.25)
    const r = rng.float(11, 17)
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r
    enDisco('pino', cx, cz, 4.2, cuantos(22), () => rng.float(0.85, 1.35))
    enDisco('roble', cx, cz, 5.0, cuantos(7), () => rng.float(0.9, 1.3))
    enDisco('arbusto', cx, cz, 5.2, cuantos(10), () => rng.float(0.5, 0.9), true)
  }

  // --- 2. Afloramientos de piedra: la pista visual de dónde va la cantera ---
  for (let k = 0; k < 3; k++) {
    const a = ((anilloBosque[(k + 3) % 6] + 0.5) / 6) * Math.PI * 2 + rng.float(-0.3, 0.3)
    const r = rng.float(12, 18)
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r
    enDisco('penasco', cx, cz, 2.6, cuantos(5), () => rng.float(1.1, 2.0), true)
    enDisco('roca', cx, cz, 4.2, cuantos(9), () => rng.float(0.5, 1.1), true)
  }

  // --- 3. Relleno disperso por todo el valle ---
  // Las cuentas van con el tamaño de la isla: el valle de 60x60 es casi el triple
  // de superficie que el tablero viejo y con las cifras de antes parecía pelado.
  porLaIsla('pino', cuantos(60), () => rng.float(0.8, 1.25))
  porLaIsla('roble', cuantos(80), () => rng.float(0.85, 1.35))
  porLaIsla('roca', cuantos(70), () => rng.float(0.35, 0.85), true)
  porLaIsla('arbusto', cuantos(180), () => rng.float(0.4, 0.85), true)
  porLaIsla('hierba', cuantos(420), () => rng.float(0.5, 1.0))
  porLaIsla('flor', cuantos(260), () => rng.float(0.7, 1.3))

  // --- 4. Barbecho: lo que cubre las parcelas que todavía no son tuyas ---
  // Zarzas, matojos y cuatro piedras de algo que hubo. Es la mitad del mensaje:
  // se ve que ahí se PUEDE construir, pero que hoy no es tuyo.
  for (let pz = 0; pz < PARCELAS; pz++) {
    for (let px = 0; px < PARCELAS; px++) {
      const id = idParcela(px, pz)
      if (parcelaEsMia(game.state, id)) continue
      const r = rectParcela(id)
      if (!r) continue
      const c = gridAMundo(r.x + (r.ancho - 1) / 2, r.z + (r.alto - 1) / 2)
      const radio = (Math.max(r.ancho, r.alto) / 2) * CONFIG.CELDA
      enDisco('zarza', c.x, c.z, radio, cuantos(Math.round(r.ancho * r.alto * 0.26)), () => rng.float(0.45, 1.0), true)
      enDisco('pino', c.x, c.z, radio, cuantos(7), () => rng.float(0.8, 1.3))
      enDisco('ruina', c.x, c.z, radio * 0.8, cuantos(3), () => rng.float(0.7, 1.5), true)
    }
  }

  return plantas
}

function montarInstancias (plantas) {
  const raiz = new THREE.Group()
  raiz.name = 'decoracion'

  const mBase = new THREE.Matrix4()
  const mLocal = new THREE.Matrix4()
  const mFinal = new THREE.Matrix4()
  const vPos = new THREE.Vector3()
  const vEsc = new THREE.Vector3()
  const qGiro = new THREE.Quaternion()
  const euler = new THREE.Euler()
  const colorFlor = new THREE.Color()

  const porTipo = new Map()
  for (const p of plantas) {
    if (!porTipo.has(p.tipo)) porTipo.set(p.tipo, [])
    porTipo.get(p.tipo).push(p)
  }

  const off = (CONFIG.GRID - 1) / 2

  for (const [tipo, lista] of porTipo) {
    const defs = PIEZAS[tipo]
    const mallas = defs.map((d) => {
      const im = new THREE.InstancedMesh(d.geo(), d.matl(), lista.length)
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      im.castShadow = tipo !== 'hierba' && tipo !== 'flor'
      im.receiveShadow = false
      im.name = `deco_${tipo}`
      return im
    })

    for (let i = 0; i < lista.length; i++) {
      const p = lista[i]
      euler.set(p.rx, p.ry, p.rz)
      qGiro.setFromEuler(euler)
      vPos.set(p.x, p.y, p.z)
      vEsc.set(p.sx, p.s, p.sz)
      mBase.compose(vPos, qGiro, vEsc)

      for (let k = 0; k < defs.length; k++) {
        const d = defs[k]
        mLocal.makeScale(d.s[0], d.s[1], d.s[2])
        mLocal.setPosition(d.x || 0, d.y || 0, d.z || 0)
        mFinal.multiplyMatrices(mBase, mLocal)
        mallas[k].setMatrixAt(i, mFinal)
        if (p.color !== null && mallas[k].instanceColor !== undefined) {
          mallas[k].setColorAt(i, colorFlor.set(p.color))
        }
      }

      // índice por casilla del tablero, para poder talar al construir
      if (TALABLE.has(tipo)) {
        const gx = Math.round(p.x / CONFIG.CELDA + off)
        const gz = Math.round(p.z / CONFIG.CELDA + off)
        const clave = `${gx}|${gz}`
        let lote = porCasilla.get(clave)
        if (!lote) porCasilla.set(clave, lote = [])
        for (const m of mallas) lote.push({ malla: m, i })
        // la maleza además se indexa por parcela: al conquistarla se retira sola
        if (MALEZA.has(tipo)) {
          const par = parcelaDe(gx, gz)
          if (par) {
            let lm = malezaPorParcela.get(par.id)
            if (!lm) malezaPorParcela.set(par.id, lm = [])
            for (const m of mallas) lm.push({ malla: m, i })
          }
        }
      }
    }

    for (const m of mallas) {
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      m.computeBoundingSphere()
      raiz.add(m)
    }
  }

  return raiz
}

// ── Rejilla de construcción ──────────────────────────────────────────────

/**
 * Solo se dibuja sobre TU terreno: la rejilla es la promesa de "aquí puedes
 * poner algo", y enseñarla sobre el barbecho sería mentir. Se rehace al
 * conquistar (son cuatro mil líneas: rehacerla cuesta menos que mantenerla).
 */
function puntosRejilla () {
  const puntos = []
  const y = (wx, wz) => alturaMundo(wx, wz) + 0.06
  const mia = (x, z) => {
    const p = parcelaDe(x, z)
    return !!p && parcelaEsMia(game.state, p.id)
  }
  for (let z = 0; z < CONFIG.GRID; z++) {
    for (let x = 0; x < CONFIG.GRID; x++) {
      if (!mia(x, z)) continue
      const a = gridAMundo(x, z)
      const x0 = a.x - CONFIG.CELDA / 2; const x1 = a.x + CONFIG.CELDA / 2
      const z0 = a.z - CONFIG.CELDA / 2; const z1 = a.z + CONFIG.CELDA / 2
      puntos.push(x0, y(x0, z0), z0, x0, y(x0, z1), z1)   // lado oeste
      puntos.push(x0, y(x0, z0), z0, x1, y(x1, z0), z0)   // lado norte
      if (!mia(x + 1, z)) puntos.push(x1, y(x1, z0), z0, x1, y(x1, z1), z1)
      if (!mia(x, z + 1)) puntos.push(x0, y(x0, z1), z1, x1, y(x1, z1), z1)
    }
  }
  return puntos
}

function construirRejilla () {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(puntosRejilla(), 3))
  // mats.js solo fabrica materiales de malla; las líneas necesitan el suyo
  const material = new THREE.LineBasicMaterial({
    color: PALETA.rejilla, transparent: true, opacity: 0, depthWrite: false
  })
  const lineas = new THREE.LineSegments(g, material)
  lineas.name = 'rejilla'
  lineas.visible = false
  lineas.renderOrder = 2
  return lineas
}

// ── La linde: dónde acaba tu reino ───────────────────────────────────────

/**
 * Mojón de piedra con su estaca, clavado en cada tramo de frontera. No es una
 * muralla (eso lo construye el jugador): es la señal de "hasta aquí llega lo
 * tuyo", que es justo lo que había que poder ver en el mapa de la ciudad.
 */
const MAX_LINDE = 520
const _m4 = new THREE.Matrix4()
const _v3 = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _esc = new THREE.Vector3()
const _nada = new THREE.Matrix4().makeScale(0, 0, 0)

function construirLinde () {
  const g = new THREE.Group()
  g.name = 'linde'
  const piedras = new THREE.InstancedMesh(G.esfera, mat(PALETA.linde), MAX_LINDE)
  const estacas = new THREE.InstancedMesh(G.cilindro6, mat(PALETA.tronco), MAX_LINDE)
  for (const m of [piedras, estacas]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    m.castShadow = true
    m.receiveShadow = false
    m.frustumCulled = false
    g.add(m)
  }
  g.userData.piedras = piedras
  g.userData.estacas = estacas
  return g
}

/** Recorre la frontera y recoloca los mojones. Se llama al arrancar y al conquistar. */
function actualizarLinde () {
  if (!linde) return
  const { piedras, estacas } = linde.userData
  const mia = (x, z) => {
    const p = parcelaDe(x, z)
    return !!p && parcelaEsMia(game.state, p.id)
  }
  let n = 0
  const poner = (wx, wz, giro) => {
    if (n >= MAX_LINDE) return
    const y = alturaMundo(wx, wz)
    _e.set(0, giro, 0); _q.setFromEuler(_e)
    _v3.set(wx, y + 0.16, wz); _esc.set(0.62, 0.42, 0.62)
    _m4.compose(_v3, _q, _esc)
    piedras.setMatrixAt(n, _m4)
    _v3.set(wx, y + 0.52, wz); _esc.set(0.13, 1.05, 0.13)
    _m4.compose(_v3, _q, _esc)
    estacas.setMatrixAt(n, _m4)
    n++
  }

  for (let z = 0; z < CONFIG.GRID; z++) {
    for (let x = 0; x < CONFIG.GRID; x++) {
      if (!mia(x, z)) continue
      const c = gridAMundo(x, z)
      // un mojón sí y otro no: la linde se lee igual y cuesta la mitad
      if (!mia(x, z - 1) && (x & 1) === 0) poner(c.x, c.z - 0.5, 0)
      if (!mia(x, z + 1) && (x & 1) === 0) poner(c.x, c.z + 0.5, 0)
      if (!mia(x - 1, z) && (z & 1) === 0) poner(c.x - 0.5, c.z, Math.PI / 2)
      if (!mia(x + 1, z) && (z & 1) === 0) poner(c.x + 0.5, c.z, Math.PI / 2)
    }
  }
  for (let i = n; i < MAX_LINDE; i++) {
    piedras.setMatrixAt(i, _nada)
    estacas.setMatrixAt(i, _nada)
  }
  piedras.instanceMatrix.needsUpdate = true
  estacas.instanceMatrix.needsUpdate = true
}

// ── Banderas: "esta parcela te está esperando" ───────────────────────────

/** Una bandera clavada en el centro de la parcela que se puede reclamar. */
function plantarBandera (id) {
  if (!banderas || banderaDe.has(id)) return
  const c = centroParcela(id)
  if (!c) return
  const w = gridAMundo(c.x, c.z)
  const y = alturaMundo(w.x, w.z)
  const g = new THREE.Group()
  const palo = new THREE.Mesh(G.cilindro6, mat(PALETA.madera))
  palo.position.set(0, 1.5, 0); palo.scale.set(0.14, 3, 0.14)
  const tela = new THREE.Mesh(G.caja, mat(PALETA.estandarte))
  tela.position.set(0.55, 2.55, 0); tela.scale.set(1.1, 0.72, 0.08)
  const piedra = new THREE.Mesh(G.esfera, mat(PALETA.linde))
  piedra.position.set(0, 0.16, 0); piedra.scale.set(0.9, 0.5, 0.9)
  g.add(palo, tela, piedra)
  g.position.set(w.x, y, w.z)
  g.userData.tela = tela
  banderas.add(g)
  banderaDe.set(id, g)
}

function quitarBandera (id) {
  const g = banderaDe.get(id)
  if (!g) return
  banderas.remove(g)
  banderaDe.delete(id)
}

/** Pone una bandera en cada parcela que espera dueño y retira las que ya no. */
function refrescarBanderas () {
  if (!banderas) return
  for (let pz = 0; pz < PARCELAS; pz++) {
    for (let px = 0; px < PARCELAS; px++) {
      const id = idParcela(px, pz)
      if (parcelaDisponible(game.state, id)) plantarBandera(id)
      else quitarBandera(id)
    }
  }
}

// ── Conquista: que se vea que has ganado algo ────────────────────────────

/** Repinta una parcela con su grado de "barbecho" (1 apagada, 0 tuya). */
function pintarParcela (id, f) {
  const caras = carasDeParcela.get(id)
  if (!caras || !atribColor || !colBase) return
  const col = atribColor.array
  for (let k = 0; k < caras.length; k++) {
    const t = caras[k]
    apagar(colBase[t * 3], colBase[t * 3 + 1], colBase[t * 3 + 2], f, tmpColor)
    const b = t * 9
    for (let v = 0; v < 3; v++) {
      col[b + v * 3] = tmpColor.r
      col[b + v * 3 + 1] = tmpColor.g
      col[b + v * 3 + 2] = tmpColor.b
    }
  }
  // se sube a la tarjeta SOLO el trozo de esta parcela, no el valle entero
  const rango = rangoDeParcela.get(id)
  if (rango && atribColor.addUpdateRange) {
    atribColor.clearUpdateRanges()
    atribColor.addUpdateRange(rango[0], rango[1])
  } else if (rango && atribColor.updateRange) {
    atribColor.updateRange.offset = rango[0]
    atribColor.updateRange.count = rango[1]
  }
  atribColor.needsUpdate = true
  opacoParcela.set(id, f)
}

/**
 * El momento de ganar terreno: la maleza se retira desde el centro hacia fuera,
 * el verde vuelve y la linde se abre. Dura poco más de un segundo, que es lo que
 * aguanta la vista sin aburrirse.
 */
function conquistar (id, animado = true) {
  quitarBandera(id)
  const lote = malezaPorParcela.get(id) || []
  const centro = centroParcela(id)
  const cw = centro ? gridAMundo(centro.x, centro.z) : { x: 0, z: 0 }
  const maleza = []
  for (const { malla, i } of lote) {
    const m = new THREE.Matrix4()
    malla.getMatrixAt(i, m)
    const d = Math.hypot(m.elements[12] - cw.x, m.elements[14] - cw.z)
    maleza.push({ malla, i, m, retraso: Math.min(0.55, d / (LADO_PARCELA * 1.6)) })
  }
  if (!animado) {
    for (const p of maleza) { p.malla.setMatrixAt(p.i, _nada); p.malla.instanceMatrix.needsUpdate = true }
    pintarParcela(id, 0)
    actualizarLinde()
    rehacerRejilla()
    return
  }
  conquistas.push({ id, t: 0, dur: 1.25, maleza })
}

function pasoConquistas (dt) {
  if (!conquistas.length) return
  for (let k = conquistas.length - 1; k >= 0; k--) {
    const c = conquistas[k]
    c.t += dt
    const p = Math.min(1, c.t / c.dur)
    pintarParcela(c.id, 1 - suavizar(p))
    const tocadas = new Set()
    for (const z of c.maleza) {
      const avance = Math.min(1, Math.max(0, (p - z.retraso) / 0.45))
      const s = 1 - suavizar(avance)
      _m4.copy(z.m).scale(_v3.set(s, s, s))
      z.malla.setMatrixAt(z.i, s > 0.01 ? _m4 : _nada)
      tocadas.add(z.malla)
    }
    for (const m of tocadas) m.instanceMatrix.needsUpdate = true
    if (p >= 1) {
      conquistas.splice(k, 1)
      actualizarLinde()
      rehacerRejilla()
    }
  }
}

function rehacerRejilla () {
  if (!rejilla) return
  rejilla.geometry.dispose()
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(puntosRejilla(), 3))
  rejilla.geometry = g
}

// ── API pública ──────────────────────────────────────────────────────────

/**
 * Altura del terreno en una casilla (admite decimales, para aldeanos andando).
 * Los edificios y las unidades se apoyan aquí para no flotar ni hundirse.
 *
 * Se prepara el relieve SOLA si hace falta: scene.js y buildings.js piden
 * alturas en cuanto arrancan, antes de que este módulo llegue a su init(), y
 * antes eso devolvía 0 en todas las casillas — edificios y aldeanos apoyados
 * en el aire y el dedo apuntando a una casilla distinta de la que se ve.
 */
export function alturaEn (x, z) {
  if (!ruidoBajo) prepararRelieve()
  const w = gridAMundo(x, z)
  return alturaMundo(w.x, w.z)
}

/**
 * Tala árboles y quita rocas de un rectángulo de casillas: al construir encima
 * hay que despejar. Con InstancedMesh no se borra nada, se pone la escala a 0.
 */
const _cero = new THREE.Matrix4().makeScale(0, 0, 0)
const _tocadas = new Set()
export function despejarZona (x, z, ancho = 1, alto = 1) {
  const cero = _cero
  const tocadas = _tocadas
  tocadas.clear()
  for (let i = 0; i < ancho; i++) {
    for (let j = 0; j < alto; j++) {
      const clave = `${x + i}|${z + j}`
      if (casillasDespejadas.has(clave)) continue
      casillasDespejadas.add(clave)
      const lote = porCasilla.get(clave)
      if (!lote) continue
      for (const { malla, i: idx } of lote) {
        malla.setMatrixAt(idx, cero)
        tocadas.add(malla)
      }
    }
  }
  for (const m of tocadas) m.instanceMatrix.needsUpdate = true
  return tocadas.size > 0
}

/**
 * Semilla, ruidos y caminos: TODO lo que define la forma del valle.
 * Idempotente y sin nada de Three.js, para poder llamarla desde `alturaEn()`.
 */
let semillaRelieve = null
function prepararRelieve () {
  const semilla = (game.state?.seed ?? 1) >>> 0 || 1
  if (ruidoBajo && semillaRelieve === semilla) return
  semillaRelieve = semilla
  const rng = makeRng(semilla)
  ruidoBajo = crearRuido(rng, 16)
  ruidoAlto = crearRuido(rng, 24)
  ruidoCosta = crearRuido(rng, 12)
  ruidoPiedra = crearRuido(rng, 20)
  ruidoTono = crearRuido(rng, 18)
  caminos = trazarCaminos(rng)
}

export function init () {
  prepararRelieve()
  // rng aparte para la siembra: así el valle sale idéntico tanto si alguien pidió
  // una altura antes de este init() como si no
  const rng = makeRng((semillaRelieve ^ 0x51ed270b) >>> 0)

  const raiz = new THREE.Group()
  raiz.name = 'terreno'
  raiz.add(construirValle())

  const agua = construirMar()
  mar = agua.malla
  raiz.add(agua.fondo, mar)

  raiz.add(montarInstancias(sembrar(rng)))

  rejilla = construirRejilla()
  raiz.add(rejilla)

  linde = construirLinde()
  banderas = new THREE.Group()
  banderas.name = 'banderas'
  raiz.add(linde, banderas)
  actualizarLinde()
  refrescarBanderas()

  aEscena(raiz)

  // los edificios ya guardados en la partida también tienen su sitio despejado
  for (const b of game.state?.buildings ?? []) {
    despejarZona(b.x, b.z, b.ancho ?? 2, b.alto ?? 2)
  }

  events.on(EV.BUILD_MODE, ({ activo } = {}) => { opacidadObjetivo = activo ? 0.5 : 0 })
  events.on(EV.BUILD_PLACED, ({ building } = {}) => {
    if (building) despejarZona(building.x, building.z, building.ancho ?? 2, building.alto ?? 2)
  })

  // --- territorio ---
  events.on(EV.TERRITORIO_DESBLOQUEADO, ({ parcela } = {}) => { if (parcela) conquistar(parcela, true) })
  events.on(EV.TERRITORIO_DISPONIBLE, ({ parcela } = {}) => { if (parcela) plantarBandera(parcela) })
  // otra partida cargada: se repinta lo que sea suyo sin rehacer el valle
  events.on(EV.STATE_LOADED, () => {
    for (const id of carasDeParcela.keys()) pintarParcela(id, parcelaEsMia(game.state, id) ? 0 : 1)
    actualizarLinde()
    rehacerRejilla()
    refrescarBanderas()
  })

  // lo único que se mueve por frame: el reloj del oleaje (un número) y, cuando
  // se está construyendo, el fundido de la rejilla. Ni un `new` aquí dentro.
  onFrame((dt, t) => {
    relojMar.value = t
    pasoConquistas(dt)
    // la tela de las banderas ondea: cuatro senos y ni un `new` por frame
    if (banderaDe.size) {
      for (const g of banderaDe.values()) {
        const tela = g.userData.tela
        if (tela) { tela.rotation.y = Math.sin(t * 2.2) * 0.22; tela.position.y = 2.55 + Math.sin(t * 3.1) * 0.04 }
      }
    }
    if (!rejilla) return
    const o = rejilla.material.opacity
    if (Math.abs(o - opacidadObjetivo) > 0.002) {
      rejilla.material.opacity = o + (opacidadObjetivo - o) * Math.min(1, dt * 9)
      rejilla.visible = rejilla.material.opacity > 0.015
    }
  })
}
