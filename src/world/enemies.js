import { game } from '../core/state.js'
import { events, EV } from '../core/events.js'
import { makeRng } from '../core/rng.js'
import { parcelasMias, NUCLEO } from '../core/grid.js'
import { def } from '../data/buildings.js'
import { UNIDADES } from '../data/units.js'
import { nombreEnemigo } from '../data/names.js'

/**
 * LOS RIVALES. Quién vive ahí fuera, cómo tiene montada su aldea, qué guarda
 * dentro y cuándo se le ocurre venir a por ti.
 *
 * Este módulo SOLO escribe en game.state.world.enemigos. Los `tiles` y los
 * `nodos` son de world/map.js: aquí se leen, nunca se tocan.
 *
 * Todo sale de una semilla: la base de "Don Vela el Negro" es la misma hoy que
 * mañana, porque el jugador tiene que poder estudiarla, perder y volver.
 */

// ---------------------------------------------------------------- ajustes ---

const HORA = 3600000
const GRID_BASE = 24                 // rejilla propia de cada aldea enemiga
const CENTRO = (GRID_BASE - 1) / 2   // 11.5
const NIVEL_MAX = 14

/**
 * ═══════════════ EL RITMO DE LOS ASEDIOS ═══════════════
 *
 * EL PROBLEMA QUE HABÍA: el descanso entre asedios era global y de 25-45 min de
 * RELOJ. Con más de treinta rivales en el valle siempre había alguno con su
 * turno cumplido, así que en cuanto pasaba el descanso caía otro asedio. Y lo
 * peor: el reloj corría con la app CERRADA, de modo que cada vez que el jugador
 * volvía tenía un asedio esperándole en la puerta. En el banco de pruebas salían
 * 3 asedios por día de juego, uno por sesión, clavados. De ahí el "¿por qué me
 * atacan tanto?".
 *
 * CÓMO FUNCIONA AHORA:
 *  1. El descanso se mide en TIEMPO JUGADO, no de reloj (`state.asedios.jugado`,
 *     que solo crece en los ticks). Cerrar la app no acumula asedios: es
 *     imposible que te esperen tres a la vuelta.
 *  2. Cuánto descanso depende de UN ESCALÓN DE PROGRESO, no del azar: los
 *     primeros días nadie viene, y a partir de ahí el ritmo sube con lo que
 *     tienes que perder (ayuntamiento, parcelas ganadas, plazas sometidas).
 *  3. Tras CADA defensa —se gane o se pierda— hay un respiro largo garantizado:
 *     nunca caen dos seguidos.
 *  4. Si el jugador estaba fuera y le tocaba asedio, se resuelve UNO solo y se
 *     le cuenta al volver. Ni dos, ni cinco.
 */

/** Horas de calma al empezar: que le dé tiempo a montar la aldea sin sustos. */
const HORAS_TRANQUILAS = 30
/** Y además, hasta que no hay algo que merezca la pena robar, no viene nadie. */
const AYTO_MINIMO = 3

/**
 * LA ESCALERA. `descansoMin` son MINUTOS DE JUEGO entre asedio y asedio.
 * La cuenta: alguien juega a esto en tres ratos de 20-25 min, o sea unos 70
 * minutos al día. Con 75 min de descanso sale ~1 asedio al día; con 28, unos
 * 2,3. Ese es el suelo y el techo que se buscaban: uno o dos asedios diarios de
 * base y algo más cuando ya tienes medio valle y mucho que perder.
 */
const ESCALERA_ASEDIOS = [
  { nombre: 'Colonos', descansoMin: 0, asediosDia: 0, porQue: 'Acabas de levantar las primeras casas: nadie pierde el tiempo contigo.' },
  { nombre: 'Aldea', descansoMin: 75, asediosDia: 0.9, porQue: 'Ya sale humo de tus chimeneas. Algún bandido de camino vendrá a probar.' },
  { nombre: 'Villa', descansoMin: 55, asediosDia: 1.2, porQue: 'Tu granero da de comer a mucha gente, y eso se sabe en toda la comarca.' },
  { nombre: 'Señorío', descansoMin: 42, asediosDia: 1.5, porQue: 'Mandas sobre varias parcelas: los señores de al lado ya te tienen fichado.' },
  { nombre: 'Comarca', descansoMin: 34, asediosDia: 1.9, porQue: 'Media comarca lleva tu bandera. Quien quiera crecer tiene que quitártela.' },
  { nombre: 'Reino', descansoMin: 28, asediosDia: 2.3, porQue: 'Eres el más rico del valle. Todos los estandartes de por aquí apuntan a tu plaza.' }
]

/** Respiro garantizado tras defender, gane o pierda: nunca dos asedios seguidos. */
const RESPIRO_TRAS_DEFENDER_MIN = 15
/** Suelo de reloj real: aunque juegues del tirón, dos asedios no se pisan. */
const ENTRE_ATAQUES_RELOJ = 12 * 60000
/** Margen para reforzar la defensa antes de que lleguen (3 a 8 minutos). */
const AVISO_MIN_SEG = 180
const AVISO_MAX_SEG = 480
/** Fuera más de esto y, si te tocaba asedio, se resuelve solo (uno, y contado). */
const FUERA_PARA_ASEDIO_SOLO = 45 * 60

/** Rivales que la lista de asalto tiene SIEMPRE, desde el primer minuto. */
const RIVALES_MINIMOS = 3

/**
 * Vasallaje al PRIMER escarmiento: es el escalón intermedio de la escalera de
 * conquista (ver la cabecera de world/imperio.js). Le ganas una vez y te paga
 * tributo; vuelves y le ganas del todo, y su plaza pasa a tu bandera.
 */
const DERROTAS_PARA_VASALLO = 1
const TRIBUTO_CADA_MIN = 30
/**
 * De su despensa, en cada entrega. Al 5 % y con entregas de media hora, un
 * vasallo rinde dos veces y media su granero al día: se nota, crece con el
 * imperio y no sustituye a tu propia producción.
 */
const TRIBUTO_FRACCION = 0.05
const TRIBUTOS_OFFLINE_MAX = 8     // volver tras un día fuera no revienta el granero

/**
 * Las cinco formas de vivir del mapa. Cada una construye distinto, pelea
 * distinto y guarda cosas distintas: es lo que hace que no todas las aldeas
 * enemigas se parezcan a la misma mancha gris.
 */
export const PERSONALIDADES = {
  bandido: {
    nombre: 'Bandidos',
    icono: '🏴',
    guarnicion: 0.60,   // poca gente…
    botin: 1.80,        // …y todo lo robado dentro
    defensa: 0.35,
    anillos: 1,
    gemas: 0.5,
    rencor: 1.6,        // el que menos aguanta una afrenta
    lema: 'Viven de lo ajeno y duermen con un ojo abierto.'
  },
  señor: {
    nombre: 'Señor feudal',
    icono: '🛡️',
    guarnicion: 1.00,
    botin: 1.00,
    defensa: 1.40,
    anillos: 2,
    gemas: 1.0,
    rencor: 1.0,
    lema: 'Castillo, estandarte y una mesnada que cobra puntual.'
  },
  abad: {
    nombre: 'Abadía',
    icono: '⛪',
    guarnicion: 0.75,
    botin: 1.20,
    defensa: 1.25,
    anillos: 3,
    gemas: 1.6,         // las reliquias son suyas
    rencor: 0.6,        // perdonan… casi siempre
    lema: 'Rezan mucho y guardan más. Los muros son de piedra, no de fe.'
  },
  mercenario: {
    nombre: 'Compañía mercenaria',
    icono: '⚔️',
    guarnicion: 2.10,   // poco edificio, mucha lanza
    botin: 0.85,
    defensa: 0.55,
    anillos: 1,
    gemas: 0.8,
    rencor: 1.4,
    lema: 'Cuatro tiendas, ningún muro y más hierro del que parece.'
  },
  cruzado: {
    nombre: 'Hueste cruzada',
    icono: '✝️',
    guarnicion: 0.95,
    botin: 0.90,
    defensa: 1.90,      // torres hasta en la sopa
    anillos: 2,
    gemas: 1.2,
    rencor: 1.2,
    lema: 'Torres por todas partes y la certeza de tener razón.'
  }
}

export const TIPOS_PERSONALIDAD = Object.keys(PERSONALIDADES)

/** Cómo suena cada nivel en la ficha del explorador. */
const ESCALONES = [
  { max: 2, texto: 'Escaramuza' },
  { max: 4, texto: 'Partida de armas' },
  { max: 6, texto: 'Cabalgada seria' },
  { max: 9, texto: 'Asalto en regla' },
  { max: 12, texto: 'Campaña' },
  { max: 99, texto: 'Locura gloriosa' }
]

// ------------------------------------------------------------- utilidades ---

const clamp = (v, a, b) => v < a ? a : v > b ? b : v
const mundo = () => (game.state && game.state.world) ? game.state.world : null

/**
 * El banco (sim/resources.js) es la excepción pactada a la regla de no
 * importarse: los tributos de los vasallos son ingresos de verdad y tienen que
 * respetar los topes del almacén. Se carga si está; si no, se apaña a mano y el
 * módulo sigue funcionando.
 */
let MODULOS_BANCO = {}
try { MODULOS_BANCO = import.meta.glob('../sim/resources.js') } catch { MODULOS_BANCO = {} }
let banco = null
async function cargarBanco () {
  const carga = MODULOS_BANCO['../sim/resources.js']
  if (typeof carga === 'function') {
    try { return await carga() } catch { /* se prueba con el import normal */ }
  }
  // Fuera de Vite (el banco de pruebas de scripts/) el glob no existe: con el
  // import normal los tributos pasan por caja igual que dentro del juego.
  try { return await import('../sim/resources.js') } catch { return null }
}

/** Mete recursos en el granero respetando los topes. Devuelve lo que cupo. */
function ingresarRecursos (recursos, motivo = 'tributo') {
  if (banco && typeof banco.ingresarVarios === 'function') {
    try { banco.ingresarVarios(recursos, motivo); return recursos } catch { /* a mano */ }
  }
  const s = game.state
  if (!s || !s.recursos) return recursos
  for (const r of ['madera', 'piedra', 'comida', 'oro']) {
    if (!recursos[r]) continue
    const tope = (s.almacen && s.almacen[r]) ?? Infinity
    s.recursos[r] = Math.min(tope, (s.recursos[r] || 0) + recursos[r])
  }
  events.emit(EV.RESOURCES_CHANGED, { resources: s.recursos })
  return recursos
}
/**
 * EL IMPERIO. world/imperio.js se registra aquí al arrancar (inyección: este
 * módulo no lo importa, así no hay ciclo). Si no está, todo sigue funcionando
 * como antes: sin regla de adyacencia y sin plazas que cambien de bandera.
 */
let IMPERIO = null
export function registrarImperio (api) { IMPERIO = api || null; return IMPERIO }

/** ¿Toca tu frontera? Sin imperio cargado, todo está a tiro (modo degradado). */
const aTiro = (e) => !IMPERIO || typeof IMPERIO.alcanzableBruto !== 'function' ||
  IMPERIO.alcanzableBruto(e.x, e.y)

const enemigos = () => {
  const w = mundo()
  if (!w) return []
  if (!Array.isArray(w.enemigos)) w.enemigos = []
  return w.enemigos
}
const clave = (x, y) => `${x},${y}`
const casaDelMapa = () => {
  const w = mundo()
  return (w && w.casa) ? w.casa : { x: 8, y: 8 }
}

/** Semilla estable a partir de un texto: dos bases nunca comparten dados. */
function semillaDe (txt) {
  let h = 2166136261
  for (let i = 0; i < txt.length; i++) {
    h ^= txt.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) || 1
}

/** Huella del edificio ya rotado. `rot` impar gira el rectángulo 90°. */
export function huellaDe (tipo, rot = 0) {
  const d = def(tipo)
  const a = d ? (d.ancho || 1) : 1
  const h = d ? (d.alto || 1) : 1
  return (rot % 2) ? { ancho: h, alto: a } : { ancho: a, alto: h }
}

const nivelTope = (tipo, n) => clamp(n, 1, (def(tipo) || {}).maxNivel || 1)

// ============================================================================
//  1. GENERACIÓN DE LA BASE
// ============================================================================

/** Contexto de trazado: la rejilla ocupada y lo que llevamos puesto. */
function nuevoLienzo (rng) {
  return { ocupadas: new Set(), buildings: [], rng }
}

/** Adaptación de core/grid.js a la rejilla propia de 24x24 de la aldea enemiga. */
function huecoLibreBase (lienzo, x, z, ancho, alto) {
  if (x < 0 || z < 0 || x + ancho > GRID_BASE || z + alto > GRID_BASE) return false
  for (let i = 0; i < ancho; i++) {
    for (let j = 0; j < alto; j++) {
      if (lienzo.ocupadas.has(clave(x + i, z + j))) return false
    }
  }
  return true
}

function sellar (lienzo, tipo, nivel, x, z, rot) {
  const { ancho, alto } = huellaDe(tipo, rot)
  for (let i = 0; i < ancho; i++) {
    for (let j = 0; j < alto; j++) lienzo.ocupadas.add(clave(x + i, z + j))
  }
  lienzo.buildings.push({ tipo, nivel, x, z, rot })
  return lienzo.buildings[lienzo.buildings.length - 1]
}

/** Distancia de Chebyshev del edificio al centro: encaja con los muros cuadrados. */
function radioDe (x, z, ancho, alto) {
  const dx = Math.max(Math.abs(x - CENTRO), Math.abs(x + ancho - 1 - CENTRO))
  const dz = Math.max(Math.abs(z - CENTRO), Math.abs(z + alto - 1 - CENTRO))
  return Math.max(dx, dz)
}

/**
 * Coloca un edificio en la primera casilla libre de la banda pedida.
 * `banda` es el radio (Chebyshev) permitido: así se construye en coronas
 * alrededor del ayuntamiento y no en un montón informe.
 * @returns {any|null} el edificio colocado, o null si no cabía.
 */
function colocar (lienzo, tipo, nivel, banda, opciones = {}) {
  const rot = opciones.rot ?? 0
  const { ancho, alto } = huellaDe(tipo, rot)
  const desorden = opciones.desorden ?? 0
  const candidatas = []

  for (let z = 0; z <= GRID_BASE - alto; z++) {
    for (let x = 0; x <= GRID_BASE - ancho; x++) {
      const r = radioDe(x, z, ancho, alto)
      if (r < banda.min || r > banda.max) continue
      candidatas.push({ x, z, r })
    }
  }
  if (!candidatas.length) return null

  // De dentro hacia fuera, con el ángulo barajado: queda anillo, no rejilla.
  for (const c of candidatas) c.orden = c.r * 10 + lienzo.rng.float(0, 1 + desorden * 9)
  candidatas.sort((a, b) => a.orden - b.orden)

  for (const c of candidatas) {
    if (!huecoLibreBase(lienzo, c.x, c.z, ancho, alto)) continue
    return sellar(lienzo, tipo, nivelTope(tipo, nivel), c.x, c.z, rot)
  }
  return null
}

/** El mismo edificio a un lado y al otro del eje: el sello del señor feudal. */
function colocarSimetrico (lienzo, tipo, nivel, banda, opciones = {}) {
  const a = colocar(lienzo, tipo, nivel, banda, opciones)
  if (!a) return [null, null]
  const { ancho, alto } = huellaDe(tipo, a.rot)
  const espejoX = GRID_BASE - (a.x + ancho)
  if (espejoX === a.x || !huecoLibreBase(lienzo, espejoX, a.z, ancho, alto)) return [a, null]
  const b = sellar(lienzo, tipo, a.nivel, espejoX, a.z, a.rot)
  return [a, b]
}

/**
 * Un anillo de muralla: tramos rectos, torre en cada esquina y puerta en el
 * camino. Lo que ya esté construido en la línea se respeta (una serrería
 * embutida en el muro es exactamente lo que pasa en un pueblo de verdad).
 */
function levantarAnillo (lienzo, radio, nivelMuro, opciones = {}) {
  const x0 = Math.round(CENTRO - radio + 0.5)
  const x1 = Math.round(CENTRO + radio - 0.5)
  const z0 = x0
  const z1 = x1
  if (x0 < 0 || x1 > GRID_BASE - 1 || x1 - x0 < 5) return null

  const huecos = opciones.huecos ?? 0            // empalizada rota
  const torres = opciones.torres !== false
  const tipoTorre = opciones.tipoTorre || 'torre_vigia'
  const puertas = opciones.puertas || []         // 'n' | 's' | 'e' | 'o'
  const rng = lienzo.rng
  const info = { radio, x0, x1, z0, z1, muros: 0, torres: 0, puertas: 0 }

  // 1) torres en las cuatro esquinas (2x2, comidas hacia dentro del recinto)
  if (torres) {
    const esquinas = [[x0, z0], [x1 - 1, z0], [x0, z1 - 1], [x1 - 1, z1 - 1]]
    for (const [tx, tz] of esquinas) {
      if (huecoLibreBase(lienzo, tx, tz, 2, 2)) {
        sellar(lienzo, tipoTorre, nivelTope(tipoTorre, nivelMuro), tx, tz, 0)
        info.torres++
      }
    }
  }

  // 2) puertas reservadas ANTES que el muro: si no, el muro se las come
  const centroPuerta = Math.floor(CENTRO)
  const sitiosPuerta = {
    n: { x: centroPuerta, z: z0, rot: 0 },
    s: { x: centroPuerta, z: z1, rot: 0 },
    o: { x: x0, z: centroPuerta, rot: 1 },
    e: { x: x1, z: centroPuerta, rot: 1 }
  }
  for (const lado of puertas) {
    const p = sitiosPuerta[lado]
    if (!p) continue
    const { ancho, alto } = huellaDe('puerta', p.rot)
    if (huecoLibreBase(lienzo, p.x, p.z, ancho, alto)) {
      sellar(lienzo, 'puerta', nivelTope('puerta', nivelMuro), p.x, p.z, p.rot)
      info.puertas++
    }
  }

  // 3) el muro, tramo a tramo
  const tramo = (x, z) => {
    if (huecos > 0 && rng.chance(huecos)) return          // brecha
    if (!huecoLibreBase(lienzo, x, z, 1, 1)) return
    sellar(lienzo, 'muralla', nivelTope('muralla', nivelMuro), x, z, 0)
    info.muros++
  }
  for (let x = x0; x <= x1; x++) { tramo(x, z0); tramo(x, z1) }
  for (let z = z0 + 1; z <= z1 - 1; z++) { tramo(x0, z); tramo(x1, z) }

  return info
}

/** Qué levanta cada personalidad, y cuánto, según su nivel. */
function programaDeObra (nivel, personalidad) {
  const n = nivel
  const casas = clamp(2 + Math.floor(n / 2), 2, 7)
  const lista = []
  const meter = (tipo, veces = 1, nv = null) => {
    for (let i = 0; i < veces; i++) lista.push({ tipo, nivel: nv ?? nivelEdificio(n) })
  }

  switch (personalidad) {
    case 'bandido':
      meter('casa', casas + 1)
      meter('almacen', n >= 3 ? 2 : 1)
      meter('granero', 1)
      meter('cuartel', 1)
      meter('granja', clamp(Math.floor(n / 3) + 1, 1, 3))
      meter('serreria', 1)
      if (n >= 5) meter('cantera', 1)
      meter('pozo', 2, 1)
      meter('estandarte', 1, 1)
      break

    case 'señor':
      if (n >= 4) meter('castillo', 1)
      meter('cuartel', n >= 6 ? 2 : 1)
      if (n >= 3) meter('herreria', 1)
      if (n >= 5) meter('arqueria', 1)
      if (n >= 8) meter('establo', 1)
      if (n >= 11) meter('taller_asedio', 1)
      meter('casa', casas)
      meter('granja', clamp(2 + Math.floor(n / 5), 2, 4))
      meter('serreria', 1)
      meter('cantera', 1)
      if (n >= 6) meter('mina_oro', 1)
      meter('almacen', 1)
      meter('granero', 1)
      if (n >= 7) meter('mercado', 1)
      meter('pozo', 1, 1)
      meter('estandarte', 2, 1)
      break

    case 'abad':
      meter('monasterio', 1)
      if (n >= 7) meter('universidad', 1)
      meter('granja', clamp(2 + Math.floor(n / 3), 2, 5))
      if (n >= 4) meter('molino', 1)
      meter('granero', 2)
      meter('casa', casas)
      if (n >= 6) meter('mina_oro', 1)
      meter('almacen', 1)
      meter('pozo', 2, 1)
      break

    case 'mercenario':
      meter('cuartel', n >= 5 ? 2 : 1)
      if (n >= 6) meter('establo', 1)
      if (n >= 4) meter('herreria', 1)
      if (n >= 9) meter('arqueria', 1)
      meter('casa', clamp(2 + Math.floor(n / 4), 2, 4))
      meter('granero', 1)
      meter('almacen', 1)
      meter('estandarte', 3, 1)
      break

    case 'cruzado':
    default:
      if (n >= 5) meter('castillo', 1)
      if (n >= 3) meter('monasterio', 1)
      meter('cuartel', 1)
      if (n >= 4) meter('arqueria', 1)
      meter('casa', clamp(2 + Math.floor(n / 3), 2, 5))
      meter('granja', 2)
      meter('granero', 1)
      meter('almacen', 1)
      if (n >= 7) meter('herreria', 1)
      meter('estandarte', 2, 1)
      break
  }
  return lista
}

/** Nivel de los edificios de una base de nivel `n`. */
const nivelEdificio = (n) => clamp(Math.round(0.3 + n * 0.58), 1, 8)

/**
 * Radios de los anillos de muralla. El primero se calcula con lo que hay que
 * meter dentro (un recinto que no cabe es lo que deja el grano extramuros) y
 * el NIVEL decide cuántos anillos hay: uno de pueblo, dos de villa, tres de plaza fuerte.
 */
function radiosDe (nivel, personalidad, areaNecesaria) {
  const p = PERSONALIDADES[personalidad] || PERSONALIDADES.bandido
  const porNivel = nivel >= 11 ? 3 : nivel >= 6 ? 2 : 1
  const cuantos = clamp(Math.min(p.anillos, porNivel), 1, 3)

  let r = Math.ceil((Math.sqrt(areaNecesaria * 1.9) + 3) / 2)
  if (personalidad === 'bandido') r = Math.min(r, 6)   // el campamento siempre se les queda pequeño
  if (personalidad === 'abad') r = Math.min(r, 8)      // los anillos concéntricos piden sitio fuera
  r = clamp(r, 5, 10)

  const radios = [r]
  if (cuantos === 2) radios.push(Math.min(12, r + 2))
  if (cuantos === 3) { radios.push(Math.min(10, r + 2)); radios.push(12) }
  return radios.filter((v, i, a) => i === 0 || v > a[i - 1])
}

/** Cuántas casillas de rejilla pide el programa de obra (con holgura para calles). */
function areaDelPrograma (programa) {
  let a = 16   // el ayuntamiento
  for (const o of programa) {
    const h = huellaDe(o.tipo, 0)
    a += h.ancho * h.alto
  }
  return a
}

/**
 * UNA ALDEA ENEMIGA. Ayuntamiento en el centro, producción en corona,
 * murallas cerrando el perímetro con torres y puertas, y lo que no cupo
 * dentro, fuera (que es donde el explorador encuentra el negocio).
 *
 * @param {number} nivel 1..14
 * @param {string} personalidad 'bandido'|'señor'|'abad'|'mercenario'|'cruzado'
 * @param {{int:Function,float:Function,pick:Function,chance:Function,next:Function}} rng
 * @returns {{grid:number, buildings:Array, anillos:Array, recinto:number, fuera:number}}
 */
export function generarBase (nivel, personalidad, rng) {
  const n = clamp(Math.round(nivel) || 1, 1, NIVEL_MAX)
  const p = PERSONALIDADES[personalidad] ? personalidad : 'bandido'
  const ficha = PERSONALIDADES[p]
  const lienzo = nuevoLienzo(rng)
  const nvEdif = nivelEdificio(n)

  // --- el corazón: siempre ayuntamiento, siempre en el centro ---
  sellar(lienzo, 'ayuntamiento', nivelTope('ayuntamiento', nvEdif), 10, 10, 0)

  // --- los anillos: se eligen antes para saber dónde termina el recinto ---
  const programa = programaDeObra(n, p)
  const radios = radiosDe(n, p, areaDelPrograma(programa))
  const recinto = radios[0]                       // el muro interior manda

  // --- producción y cuarteles DENTRO del recinto; lo que no quepa, extramuros ---
  const desorden = p === 'bandido' ? 1 : p === 'mercenario' ? 0.5 : 0
  const simetrico = p === 'señor'
  let fuera = 0

  for (const obra of programa) {
    const dentro = { min: 2.5, max: recinto - 1.5 }
    let puesto = simetrico
      ? colocarSimetrico(lienzo, obra.tipo, obra.nivel, dentro, { desorden })[0]
      : colocar(lienzo, obra.tipo, obra.nivel, dentro, { desorden })
    if (!puesto) {
      // el arrabal: granjas y almacenes a la intemperie, mal negocio para ellos
      puesto = colocar(lienzo, obra.tipo, obra.nivel, { min: recinto + 0.5, max: 11.5 }, { desorden: 1 })
      if (puesto) fuera++
    }
  }

  // --- el cruzado siembra torres por todas partes, dentro y fuera ---
  if (p === 'cruzado') {
    const cuantas = clamp(3 + Math.floor(n / 2), 3, 9)
    for (let i = 0; i < cuantas; i++) {
      const avanzada = i % 3 === 2
      const tipo = (n >= 7 && i % 2 === 0) ? 'torre_ballesta' : 'torre_vigia'
      colocar(lienzo, tipo, nvEdif,
        avanzada ? { min: recinto + 0.5, max: 11.5 } : { min: 2.5, max: recinto - 1.5 },
        { desorden: 0.6 })
    }
  }

  // --- ahora sí, los muros ---
  const anillos = []
  radios.forEach((r, i) => {
    const opciones = {
      huecos: p === 'bandido' ? 0.34 : 0,                        // empalizada rota
      torres: p !== 'bandido' && !(p === 'mercenario' && i > 0),
      tipoTorre: (p === 'cruzado' && n >= 7 && i === 0) ? 'torre_ballesta' : 'torre_vigia',
      puertas: puertasDe(p, i)
    }
    const info = levantarAnillo(lienzo, r, nvEdif, opciones)
    if (info) anillos.push(info)
  })

  // --- el señor remata con torres a media cortina; el abad, con dos y basta ---
  if (p === 'señor' || p === 'cruzado') {
    colocarSimetrico(lienzo, 'torre_vigia', nvEdif, { min: recinto - 2.5, max: recinto - 1.5 })
  }

  return { grid: GRID_BASE, buildings: lienzo.buildings, anillos, recinto, fuera }
}

/** Por dónde se entra en cada clase de recinto. */
function puertasDe (personalidad, anillo) {
  if (personalidad === 'bandido') return []                    // ni puerta: un boquete
  if (personalidad === 'mercenario') return ['n', 's', 'e', 'o'] // entran y salen a todas horas
  if (personalidad === 'abad') return anillo === 0 ? ['s'] : ['s']
  return anillo === 0 ? ['n', 's'] : ['s']
}

// ============================================================================
//  2. GUARNICIÓN, BOTÍN Y PODER
// ============================================================================

/** Qué tropa sabe reclutar una base de este nivel. */
function reparto (nivel, personalidad) {
  const n = nivel
  const mezcla = { lancero: 0.55, arquero: 0, espadachin: 0, ballestero: 0, jinete: 0, caballero: 0 }
  if (n >= 3) { mezcla.arquero = 0.28; mezcla.lancero = 0.52 }
  if (n >= 5) { mezcla.espadachin = 0.20; mezcla.lancero = 0.40; mezcla.arquero = 0.25 }
  if (n >= 7) { mezcla.ballestero = 0.14; mezcla.jinete = 0.10; mezcla.lancero = 0.30; mezcla.arquero = 0.14; mezcla.espadachin = 0.18 }
  if (n >= 10) { mezcla.caballero = 0.12; mezcla.jinete = 0.14; mezcla.lancero = 0.22; mezcla.espadachin = 0.16 }

  // cada oficio tira para el suyo
  if (personalidad === 'bandido') { mezcla.lancero += 0.2; mezcla.caballero = 0; mezcla.espadachin *= 0.5 }
  if (personalidad === 'mercenario') { mezcla.espadachin += 0.15; mezcla.jinete += 0.08 }
  if (personalidad === 'cruzado') { mezcla.caballero += 0.08; mezcla.arquero += 0.06 }
  if (personalidad === 'abad') { mezcla.arquero += 0.12; mezcla.jinete = 0 }
  if (personalidad === 'señor') { mezcla.caballero += 0.04 }
  return mezcla
}

/** @returns {any} { lancero: 8, arquero: 4, ... } sin ceros. */
export function generarGuarnicion (nivel, personalidad, rng) {
  const p = PERSONALIDADES[personalidad] || PERSONALIDADES.bandido
  // Crece casi con el cuadrado del nivel porque el hueco de ejército del jugador
  // también se dispara (4 al empezar, 250 y pico al final): con la vieja cuenta
  // lineal, un señor de nivel 12 defendía su castillo con 28 hombres contra 300.
  const total = Math.max(3, Math.round((3 + Math.pow(nivel, 1.95)) * p.guarnicion * rng.float(0.88, 1.14)))
  const mezcla = reparto(nivel, personalidad)
  const suma = Object.values(mezcla).reduce((a, b) => a + b, 0) || 1

  const g = {}
  let puestos = 0
  for (const tipo in mezcla) {
    if (!mezcla[tipo]) continue
    const u = UNIDADES[tipo]
    const cuantos = Math.floor(total * (mezcla[tipo] / suma) / Math.max(1, u.espacio))
    if (cuantos > 0) { g[tipo] = cuantos; puestos += cuantos * u.espacio }
  }
  if (!puestos) g.lancero = Math.max(3, Math.round(total / 2))
  return g
}

/** Poder militar de un puñado de tropas. Misma vara para el jugador y para ellos. */
export function poderTropas (tropas) {
  let p = 0
  for (const tipo in (tropas || {})) {
    const u = UNIDADES[tipo]
    if (!u || !u.espacio) continue
    p += (tropas[tipo] || 0) * (u.hp * 0.45 + u.ataque * 2.6 + u.armadura * 5)
  }
  return Math.round(p)
}

/**
 * Lo que aporta un edificio a la defensa. Las torres pesan mucho (disparan) y
 * la muralla poco de una en una: es el conjunto lo que duele, no el tramo.
 */
export function valorDefensivo (b) {
  const d = def(b.tipo)
  if (!d) return 0
  if (d.dano) return d.dano(b.nivel) * 2.2 + (d.hp ? d.hp(b.nivel) * 0.015 : 0)
  // El muro pesa POCO en el número: no mata a nadie, solo retrasa. Contándolo
  // alto, una plaza fuerte sin guarnición marcaba 8.600 de poder y la lista te
  // la vendía como "igualada" cuando era, sencillamente, intomable.
  if (b.tipo === 'muralla') return d.hp(b.nivel) * 0.004
  if (b.tipo === 'puerta') return d.hp(b.nivel) * 0.006
  return 0
}

/** Lo que aporta el ladrillo: torres que disparan y muros que hay que tirar. */
export function poderDefensas (base) {
  if (!base || !Array.isArray(base.buildings)) return 0
  let p = 0
  for (const b of base.buildings) p += valorDefensivo(b)
  return Math.round(p)
}

/** Lo que hay en las despensas. Proporcional al nivel y al oficio del dueño. */
export function generarBotin (nivel, personalidad, rng) {
  const p = PERSONALIDADES[personalidad] || PERSONALIDADES.bandido
  // Calibrado contra la producción real de la aldea (unos 12 de madera por
  // minuto al empezar): un buen asalto a un campamento de nivel 3 deja cerca de
  // 700 de madera, o sea VARIAS HORAS de serrería. Si el botín no se nota,
  // nadie vuelve a atacar dos veces.
  const escala = (60 + Math.pow(nivel, 1.55) * 75) * p.botin
  const j = () => rng.float(0.85, 1.18)

  const botin = {
    madera: Math.round(escala * 1.00 * j()),
    piedra: Math.round(escala * 0.72 * j()),
    comida: Math.round(escala * 0.90 * j()),
    oro: Math.round(escala * 0.22 * j()),
    gemas: 0
  }
  // sesgo de oficio: robar a un abad no es como robar a un mercenario
  if (personalidad === 'abad') { botin.oro = Math.round(botin.oro * 1.6); botin.comida = Math.round(botin.comida * 1.3) }
  if (personalidad === 'bandido') { botin.oro = Math.round(botin.oro * 1.35); botin.piedra = Math.round(botin.piedra * 0.6) }
  if (personalidad === 'mercenario') { botin.oro = Math.round(botin.oro * 1.5); botin.madera = Math.round(botin.madera * 0.7) }
  if (personalidad === 'señor') { botin.piedra = Math.round(botin.piedra * 1.3) }

  // GEMAS: el premio de los duros. Es la única fuente del juego, no se venden.
  if (nivel >= 5) {
    const g = 1 + (nivel - 4) * 0.9 * p.gemas
    botin.gemas = Math.max(1, Math.round(g * rng.float(0.7, 1.35)))
  } else if (nivel >= 3 && rng.chance(0.35 * p.gemas)) {
    botin.gemas = 1
  }
  return botin
}

// ============================================================================
//  3. FICHA COMPLETA DE UN RIVAL
// ============================================================================

/** Personalidad probable según lo lejos que viva de casa. */
function personalidadPorDistancia (d, rng) {
  const bolsa = []
  const meter = (t, veces) => { for (let i = 0; i < veces; i++) bolsa.push(t) }
  if (d <= 3.2) { meter('bandido', 6); meter('mercenario', 2); meter('señor', 1); meter('abad', 1) }
  else if (d <= 6) { meter('bandido', 3); meter('señor', 3); meter('abad', 2); meter('mercenario', 2); meter('cruzado', 1) }
  else { meter('señor', 4); meter('cruzado', 3); meter('abad', 2); meter('mercenario', 2); meter('bandido', 1) }
  return rng.pick(bolsa)
}

/** La casa a la que pertenece. Un apellido da mundo por cuatro letras. */
function casaDe (nombre, personalidad, rng) {
  if (personalidad === 'abad') return rng.pick(['la Orden del Yermo', 'la Abadía de San Millán', 'los Monjes Negros', 'la Regla de Silos'])
  if (personalidad === 'bandido') return rng.pick(['la gente del camino', 'los sin nombre', 'la mala hierba'])
  if (personalidad === 'mercenario') return rng.pick(['la Compañía Blanca', 'los Lobos de Paga', 'la Bandera Rota', 'los Hijos del Contrato'])
  if (personalidad === 'cruzado') return rng.pick(['la Cruz de Calatrava', 'la Milicia del Sepulcro', 'los Freires de Uclés'])
  // "Don Vela el Negro" -> la casa de Vela; una banda sin apellido no tiene casa
  const m = /^(?:Don|Doña|El|La)\s+(?:conde|condesa|infanzón|infanta|señor|señora|alcaide)?\s*([A-ZÁÉÍÓÚÑ][^\s]+)/.exec(nombre)
  if (m) return `la casa de ${m[1]}`
  return rng.pick(['su propia mesnada', 'la gente de su bandera', 'los suyos y nadie más'])
}

/**
 * La base de un rival. Se genera PEREZOSAMENTE: mientras vive en la niebla no
 * ocupa un byte del guardado, y en cuanto el jugador lo avista se levanta
 * entera a partir de su semilla, siempre igual.
 * @returns {any|null}
 */
export function baseDe (enemigo) {
  if (!enemigo) return null
  if (enemigo.base && Array.isArray(enemigo.base.buildings) && enemigo.base.buildings.length) return enemigo.base
  enemigo.semilla = enemigo.semilla || semillaDe(enemigo.id || `${enemigo.x},${enemigo.y}`)
  enemigo.base = generarBase(enemigo.nivel || 1, enemigo.personalidad || 'bandido', makeRng(enemigo.semilla))
  return enemigo.base
}

/**
 * Construye la ficha entera de un rival. Determinista: misma semilla, mismo
 * enemigo, misma base. Se puede reconstruir tras un guardado sin que cambie nada.
 */
export function crearEnemigo (x, y, nivel, personalidad, semilla) {
  const rng = makeRng(semilla)
  const n = clamp(Math.round(nivel), 1, NIVEL_MAX)
  const p = PERSONALIDADES[personalidad] ? personalidad : 'bandido'
  const nombre = nombreEnemigo(rng)

  const base = generarBase(n, p, rng)
  const guarnicion = generarGuarnicion(n, p, rng)
  const botin = generarBotin(n, p, rng)
  const poder = poderTropas(guarnicion) + poderDefensas(base)

  const e = {
    id: `e_${x}_${y}_${(semilla % 46656).toString(36)}`,
    x,
    y,
    nombre,
    titulo: PERSONALIDADES[p].nombre,
    casa: casaDe(nombre, p, rng),
    nivel: n,
    poder,
    personalidad: p,
    base,
    guarnicion,

    // plantilla completa: lo que reponen cuando les matas gente

    guarnicionBase: { ...guarnicion },
    botin,
    derrotado: false,
    ultimoAtaque: 0,
    reaparece: 0,

    // --- campos propios de este módulo ---
    semilla,
    descubierto: false,
    saqueos: 0,          // cuántas veces le has entrado: el botín se va secando
    rencor: 0,           // 0..5; cuanto más alto, antes vienen a por ti
    proximoAtaque: 0,
    descripcion: '',
    amenaza: ''
  }

  e.descripcion = describirBase(e)
  e.amenaza = etiquetaAmenaza(n)
  return e
}

const etiquetaAmenaza = (nivel) => (ESCALONES.find(s => nivel <= s.max) || ESCALONES[ESCALONES.length - 1]).texto

// ============================================================================
//  4. POBLAR EL MUNDO
// ============================================================================

/** Nivel que corresponde a una casilla: lo fácil cerca, lo duro en el confín. */
function nivelPorDistancia (d, rng) {
  return clamp(Math.round(0.4 + d * 1.15 + rng.float(-0.6, 0.9)), 1, NIVEL_MAX)
}

/**
 * Reparte entre 25 y 35 rivales por el valle. Respeta lo que ya hubiera
 * (partida guardada) y nunca pisa la casilla de casa ni el agua.
 * @returns {Array} la lista de enemigos del mundo
 */
export function poblarMundo (forzar = false) {
  const w = mundo()
  if (!w || !Array.isArray(w.tiles) || !w.tiles.length) return []
  const lista = enemigos()
  if (lista.length && !forzar) { sincronizarNiebla(); return lista }

  const casa = casaDelMapa()
  const semillaMundo = ((game.state.seed >>> 0) ^ 0x9e3779b9) >>> 0
  const rng = makeRng(semillaMundo)
  const objetivo = rng.int(25, 35)

  // candidatas: todo lo pisable y a distancia razonable del hogar
  const libres = []
  for (const t of w.tiles) {
    if (t.bioma === 'agua') continue
    const d = Math.hypot(t.x - casa.x, t.y - casa.y)
    if (d < 1.9) continue                                   // el valle de casa se respeta
    libres.push({ t, d })
  }
  if (!libres.length) return lista

  // cupos por anillo para que siempre haya con quien empezar y a quien temer
  const anillo = (d) => d < 3.5 ? 0 : d < 6.5 ? 1 : 2
  const cupo = [Math.round(objetivo * 0.34), Math.round(objetivo * 0.38), objetivo]
  const puestos = [0, 0, 0]
  const ocupadas = new Set()

  const barajadas = rng.shuffle(libres).sort((a, b) => a.d - b.d)
  const nuevos = []
  for (const c of barajadas) {
    if (nuevos.length >= objetivo) break
    const a = anillo(c.d)
    if (puestos[a] >= cupo[a]) continue
    const k = clave(c.t.x, c.t.y)
    if (ocupadas.has(k)) continue
    // ni dos vecinos pegados: el mapa tiene que respirar
    if (nuevos.some(e => Math.abs(e.x - c.t.x) + Math.abs(e.y - c.t.y) <= 1)) continue

    const nivel = nivelPorDistancia(c.d, rng)
    const pers = personalidadPorDistancia(c.d, rng)
    const e = crearEnemigo(c.t.x, c.t.y, nivel, pers, semillaDe(`${semillaMundo}:${k}`))
    // Todos se ponen en marcha al acabar la gracia, repartidos en las tres
    // horas siguientes: así el primer asedio llega cuando toca y no "algún día".
    e.proximoAtaque = finGracia() + rng.float(0, 3) * HORA
    nuevos.push(e)
    ocupadas.add(k)
    puestos[a]++
  }

  lista.length = 0
  for (const e of nuevos) lista.push(e)
  sincronizarNiebla()
  // lo que sigue en la niebla no necesita base guardada: se levanta al avistarla
  for (const e of lista) if (!e.descubierto) e.base = null
  // …salvo los tres vecinos de siempre: esos se ven desde la torre el primer día
  revelarVecinos(RIVALES_MINIMOS)
  return lista
}

/** Marca como vistos los rivales que caen en casillas ya descubiertas. */
function sincronizarNiebla (tiles = null) {
  const w = mundo()
  if (!w) return []
  const vistos = []
  const lista = enemigos()
  const set = (tiles && tiles.length) ? new Set(tiles.map(t => clave(t.x, t.y))) : null
  const mira = set
    ? (e) => set.has(clave(e.x, e.y))
    : (e) => !!(w.descubierto || {})[clave(e.x, e.y)]

  for (const e of lista) {
    if (e.descubierto || !mira(e)) continue
    e.descubierto = true
    baseDe(e)                       // sale de la niebla: ahora sí se levanta su aldea
    vistos.push(e)
  }
  return vistos
}

// -------------------------------------------------------------- consultas ---

/** Si el rival ya está avistado, se le levanta la aldea antes de devolverlo. */
const conBase = (e) => { if (e && e.descubierto) baseDe(e); return e || null }

export const enemigoEn = (x, y) => conBase(enemigos().find(e => e.x === x && e.y === y))
/** Lo mismo pero SIN levantarles la aldea: para recorrer el valle entero barato. */
export const todosLosRivales = () => enemigos()
export const rivalEn = (x, y) => enemigos().find(e => e.x === x && e.y === y) || null
export const rivalPorId = (id) => enemigos().find(e => e.id === id) || null
export const enemigoPorId = (id) => conBase(enemigos().find(e => e.id === id))
export const enemigosVisibles = () => enemigos().filter(e => e.descubierto)
export const enemigosVivos = () => enemigos().filter(e => e.descubierto && !e.derrotado && !e.vasallo && !e.conquistado)

/**
 * A quién se puede asaltar hoy mismo. Los VASALLOS siguen en la lista: ya te
 * pagan, pero volver y ganarles del todo es lo que te da su plaza. Lo que ya
 * ondea tu bandera sale de aquí para siempre.
 */
const asaltables = () => enemigos().filter(e => e.descubierto && !e.derrotado && !e.conquistado)

/** De los asaltables, los que tocan tu frontera. Si ninguno, se devuelven todos. */
function alcanzables () {
  const todos = asaltables()
  const cerca = todos.filter(aTiro)
  return cerca.length ? cerca : todos
}

/** Cuándo se acaban las horas de calma del principio de la partida. */
function finGracia () {
  const s = game.state
  return ((s && s.creada) || Date.now()) + HORAS_TRANQUILAS * HORA
}

/**
 * Saca de la niebla a los rivales más cercanos a casa. Sin esto, el jugador
 * abría «Ejército» el primer día y no veía a NADIE a quien atacar (los 30
 * rivales del valle nacen todos en niebla y el panel se quedaba vacío): el
 * juego parecía muerto aunque el mapa estuviera lleno de gente.
 * @returns {Array} los que acaban de salir a la luz
 */
export function revelarVecinos (cuantos = RIVALES_MINIMOS) {
  const casa = casaDelMapa()
  const d = (e) => Math.hypot(e.x - casa.x, e.y - casa.y)
  const candidatos = enemigos().filter(e => !e.descubierto && !e.derrotado && !e.conquistado && !e.vasallo)
  // primero los que tu brazo alcanza: sacar de la niebla algo inatacable no sirve
  const cerca = candidatos.filter(aTiro)
  const ocultos = (cerca.length ? cerca : candidatos)
    .sort((a, b) => (a.nivel - b.nivel) || (d(a) - d(b)))
  const sacados = []
  for (const e of ocultos) {
    if (sacados.length >= cuantos) break
    e.descubierto = true
    e.rumor = true                  // se conoce de oídas: humo en el horizonte
    baseDe(e)
    sacados.push(e)
  }
  return sacados
}

// ============================================================================
//  5. EMPAREJAMIENTO
// ============================================================================

/** Poder del ejército del jugador ahora mismo (misma escala que el enemigo). */
/** Suelo del poder del jugador: sin esto, "sin tropa" salía como 4800 % de tu fuerza. */
const PODER_MINIMO = 120

export function poderJugadorActual () {
  const s = game.state
  if (!s) return 0
  const tropas = (s.ejercito && s.ejercito.tropas) || {}
  const p = poderTropas(tropas)
  // un jugador sin tropa no vale cero: tiene aldeanos y muros, y hay que darle rival
  return Math.max(PODER_MINIMO, p)
}

// ---------------------------------------------- cuánto pesa ya tu reino ---

/** Parcelas ganadas además del núcleo de partida: hasta dónde llega tu bandera. */
const parcelasGanadas = () => Math.max(0, parcelasMias(game.state).length - NUCLEO.length)

/** Avanzadillas en pie y con la soldada pagada. */
const avanzadillas = () => (game.state.buildings || []).filter(b =>
  b.tipo === 'puesto_avanzado' && !b.enObra && !b.arruinado && (b.nivel || 0) > 0 && !b.desabastecido).length

/**
 * CRECER TIENE CONSECUENCIAS. Quien tiene medio valle ya no se pelea con
 * bandidos: los señores de al lado se lo toman en serio, montan mejor y vienen
 * con más gente. Esta es la vara con la que se escoge (y se cría) a los rivales.
 * Tope en 1,8: que el reino aprieta, no que el juego se vuelva imposible.
 */
export function escalaDelReino () {
  return Math.min(1.8, 1 + 0.09 * parcelasGanadas() + 0.04 * avanzadillas())
}

const OBJETIVOS = [
  { etiqueta: 'cómodo', ratio: 0.55, consejo: 'Te lo llevas con lo que tienes. Botín seguro.' },
  { etiqueta: 'igualado', ratio: 0.92, consejo: 'Pelea de verdad. Lleva la tropa entera.' },
  { etiqueta: 'exigente', ratio: 1.45, consejo: 'Vas a perder gente. Lo que hay dentro lo vale.' }
]

/**
 * Tres rivales para el momento del jugador: uno cómodo, uno igualado y uno
 * exigente. Si el valle descubierto no da para tanto, se levanta un campamento
 * nuevo a la medida: el juego NUNCA se queda sin siguiente objetivo.
 * @param {number} [poderJugador]
 * @returns {Array<{enemigo:any, etiqueta:string, ratio:number, recompensa:any, consejo:string}>}
 */
export function emparejar (poderJugador = poderJugadorActual()) {
  const pj = Math.max(PODER_MINIMO, poderJugador)
  // Regla dura: SIEMPRE hay a quien atacar. Si el valle avistado no da para
  // tres, se sacan de la niebla los vecinos más flojos antes de emparejar.
  if (alcanzables().length < RIVALES_MINIMOS) revelarVecinos(RIVALES_MINIMOS - alcanzables().length)
  // REGLA DE ADYACENCIA: solo se empareja con lo que toca tu valle o una plaza
  // tuya. El resto lo devuelve imperio.objetivosAlcanzables() con su motivo.
  const pool = alcanzables()
  const usados = new Set()
  const salida = []
  // El listón no lo pone solo tu ejército: lo pone también tu territorio.
  const escala = escalaDelReino()

  for (const obj of OBJETIVOS) {
    const deseado = pj * obj.ratio * escala
    let mejor = null
    let mejorError = Infinity
    for (const e of pool) {
      if (usados.has(e.id)) continue
      // MEMORIA DE DERROTAS: al que ya te ha barrido dos veces se le sube el
      // precio. Antes la lista te ofrecía cinco veces seguidas el mismo muro
      // como "igualado" y perdías el ejército entero cada vez.
      const castigo = 1 + 0.45 * Math.min(4, e.fracasos || 0)
      const err = Math.abs(Math.log(Math.max(1, e.poder * castigo) / deseado))
      if (err < mejorError) { mejorError = err; mejor = e }
    }
    // ni un paseo ni un muro: si lo más cercano se desvía más de un 55 %, se cría uno
    if (!mejor || mejorError > 0.44) {
      const criado = criarRival(deseado, usados)
      if (criado) mejor = criado
    }
    if (!mejor) continue
    usados.add(mejor.id)
    salida.push(fichaDeAsalto(mejor, pj, obj.etiqueta, obj.consejo))
  }

  // Red de seguridad: si algún hueco se quedó vacío (valle pequeño, todo
  // arrasado…) se rellena con lo que haya, ordenado por lo que más se te
  // parece. El panel NUNCA debe quedarse sin lista.
  if (salida.length < RIVALES_MINIMOS) {
    const resto = pool.filter(e => !usados.has(e.id))
      .sort((a, b) => Math.abs(Math.log(Math.max(1, a.poder) / pj)) - Math.abs(Math.log(Math.max(1, b.poder) / pj)))
    for (const e of resto) {
      if (salida.length >= RIVALES_MINIMOS) break
      usados.add(e.id)
      salida.push(fichaDeAsalto(e, pj))
    }
  }
  return salida
}

/** La tarjeta que lee el jugador: quién es, cuánto pesa y qué se saca. */
function fichaDeAsalto (enemigo, pj, etiqueta = null, consejo = null) {
  const ratio = enemigo.poder / Math.max(1, pj)
  enemigo.amenaza = amenazaPara(enemigo, pj)
  const eti = etiqueta || (ratio < 0.7 ? 'cómodo' : ratio < 1.2 ? 'igualado' : 'exigente')
  let aviso = consejo || (OBJETIVOS.find(o => o.etiqueta === eti) || OBJETIVOS[1]).consejo
  if ((enemigo.fracasos || 0) >= 1) {
    aviso = `Ya te ha parado ${enLetra(enemigo.fracasos)} ${enemigo.fracasos === 1 ? 'vez' : 'veces'}: vuelve con arietes o con más gente.`
  }
  const alc = (IMPERIO && typeof IMPERIO.alcanzable === 'function')
    ? IMPERIO.alcanzable(enemigo.x, enemigo.y)
    : { ok: true, motivo: '' }
  if (enemigo.vasallo) aviso = 'Ya te paga tributo. Gánale otra vez y su plaza pasa a tu bandera.'
  return {
    enemigo,
    etiqueta: eti,
    ratio: Math.round(ratio * 100) / 100,
    recompensa: recompensaDe(enemigo),
    fracasos: enemigo.fracasos || 0,
    consejo: aviso,
    // en qué escalón está: primero se le somete, después se le toma la plaza
    paso: enemigo.vasallo ? 'conquistar' : 'someter',
    alcanzable: alc.ok,
    bloqueo: alc.ok ? null : (alc.sugerencia || alc.motivo)
  }
}

/** Etiqueta de amenaza relativa: lo que el jugador necesita leer de un vistazo. */
export function amenazaPara (enemigo, poderJugador = poderJugadorActual()) {
  const r = enemigo.poder / Math.max(PODER_MINIMO, poderJugador)
  if (r < 0.45) return 'Un paseo'
  if (r < 0.75) return 'Asequible'
  if (r < 1.15) return 'Igualada'
  if (r < 1.7) return 'Dura'
  if (r < 2.6) return 'Muy peligrosa'
  return 'Suicida'
}

/** Cuántas huestes de paso se toleran a la vez: tres, una por hueco de la lista. */
const MAX_CRIADOS = 3
const MAX_ENEMIGOS = 45

/**
 * Levanta (o reaprovecha) una "hueste de paso" con el poder pedido, en una
 * casilla descubierta y libre. Es la válvula antiatasco: si el jugador ha
 * arrasado todo lo que veía, o si se ha hecho tan fuerte que ya nada le hace
 * cosquillas, siempre hay un siguiente objetivo a su medida.
 */
function criarRival (poderDeseado, usados = new Set()) {
  const w = mundo()
  if (!w || !Array.isArray(w.tiles)) return null
  const lista = enemigos()
  const casa = casaDelMapa()
  const rng = makeRng(semillaDe(`cria:${Date.now()}:${Math.round(poderDeseado)}`))

  // nivel de partida: el que más se acerca al poder pedido
  let nivel = 1
  let mejorErr = Infinity
  for (let n = 1; n <= NIVEL_MAX; n++) {
    const err = Math.abs(poderTipico(n) - poderDeseado)
    if (err < mejorErr) { mejorErr = err; nivel = n }
  }

  // 1) ¿hay ya una hueste de paso que nadie está mirando? se recicla
  const reciclable = lista.find(e => e.criado && !usados.has(e.id) && !e.derrotado &&
    !e.conquistado && !e.vasallo)
  if (reciclable) {
    reciclable.nivel = nivel
    reciclable.semilla = semillaDe(`cria:${reciclable.id}:${Date.now()}`)
    reciclable.base = generarBase(nivel, reciclable.personalidad, makeRng(reciclable.semilla))
    reciclable.guarnicion = generarGuarnicion(nivel, reciclable.personalidad, makeRng(reciclable.semilla + 1))
    reciclable.botin = generarBotin(nivel, reciclable.personalidad, makeRng(reciclable.semilla + 2))
    return rematarCriado(reciclable, poderDeseado, nivel)
  }

  const criados = lista.filter(e => e.criado).length
  if (criados >= MAX_CRIADOS || lista.length >= MAX_ENEMIGOS) return null

  // 2) si no, se planta el campamento donde el jugador ya ha estado
  const ocupadas = new Set(lista.map(e => clave(e.x, e.y)))
  const libre = (t) => t.bioma !== 'agua' && !ocupadas.has(clave(t.x, t.y)) &&
    Math.hypot(t.x - casa.x, t.y - casa.y) >= 1.9
  let candidatas = w.tiles.filter(t => libre(t) && (w.descubierto || {})[clave(t.x, t.y)])
  // Si el jugador todavía no ha explorado nada, el campamento se planta igual y
  // se ve desde la torre: quedarse sin rival por no haber explorado era la razón
  // de que el panel de ataque apareciese vacío el primer día.
  if (!candidatas.length) candidatas = w.tiles.filter(libre).sort((a, b) =>
    Math.hypot(a.x - casa.x, a.y - casa.y) - Math.hypot(b.x - casa.x, b.y - casa.y)).slice(0, 12)
  // y siempre dentro de tu alcance: un campamento que no puedes atacar no es
  // una válvula, es una burla. Si no hay sitio a tiro, se deja donde se pueda.
  const aTiroDeAqui = candidatas.filter(t => aTiro(t))
  if (aTiroDeAqui.length) candidatas = aTiroDeAqui
  if (!candidatas.length) return null

  const t = rng.pick(candidatas)
  const d = Math.hypot(t.x - casa.x, t.y - casa.y)
  // Cuanto más gordo es el campamento, más señorial: los niveles altos traen
  // castillo y torres, que es lo que obliga a llevar ejército de verdad.
  const pers = nivel >= 9 ? rng.pick(['señor', 'cruzado', 'señor'])
    : nivel >= 5 ? rng.pick(['señor', 'cruzado', 'abad', 'mercenario'])
      : personalidadPorDistancia(d, rng)
  const e = crearEnemigo(t.x, t.y, nivel, pers, semillaDe(`cria:${t.x},${t.y}:${nivel}:${Date.now()}`))
  e.criado = true
  lista.push(e)
  return rematarCriado(e, poderDeseado, nivel)
}

/** Le da el último apretón al rival de paso para que case con el jugador. */
function rematarCriado (e, poderDeseado, nivel) {
  e.criado = true
  e.descubierto = true
  e.derrotado = false
  e.reaparece = 0
  ajustarPoder(e, poderDeseado)
  e.amenaza = etiquetaAmenaza(nivel)
  e.descripcion = `${describirBase(e)} Acaban de plantar las tiendas: no conocen el terreno.`
  e.proximoAtaque = Date.now() + 8 * HORA
  return e
}

/**
 * Ajusta un campamento al poder pedido: primero se le cae el muro que le sobra
 * (empezando por el anillo de fuera, que es lo que se ve a medio hacer) y
 * después se le quita o se le suma gente. Sin esto, un jugador recién llegado
 * no tendría a quién atacar y uno veterano no tendría a quién temer.
 */
function ajustarPoder (enemigo, deseado) {
  const base = baseDe(enemigo)
  const objetivo = Math.max(60, deseado)

  let pd = poderDefensas(base)
  const techo = objetivo * 0.45
  if (pd > techo) {
    const muros = base.buildings
      .filter(b => b.tipo === 'muralla' || b.tipo === 'puerta' || b.tipo.startsWith('torre'))
      .sort((a, b) => radioDe(b.x, b.z, 1, 1) - radioDe(a.x, a.z, 1, 1))
    const caidos = new Set()
    for (const b of muros) {
      if (pd <= techo) break
      caidos.add(b)
      pd -= valorDefensivo(b)
    }
    if (caidos.size) base.buildings = base.buildings.filter(b => !caidos.has(b))
    base.anillos = []
    base.derruida = true
  }

  const pt = poderTropas(enemigo.guarnicion)
  escalarGuarnicion(enemigo.guarnicion, Math.max(0, objetivo - poderDefensas(base)) / Math.max(1, pt))
  enemigo.poder = poderTropas(enemigo.guarnicion) + poderDefensas(base)
  return enemigo
}

/**
 * Multiplica la guarnición sin dejarla nunca vacía. El tope de arriba es alto
 * a propósito: contra un jugador que ya lo ha ganado todo, la única respuesta
 * creíble es una hueste enorme, no un castillo imposible.
 */
function escalarGuarnicion (g, factor) {
  const f = clamp(factor, 0.05, 120)
  let vivos = 0
  for (const tipo of Object.keys(g)) {
    const n = Math.round((g[tipo] || 0) * f)
    if (n <= 0) delete g[tipo]
    else { g[tipo] = n; vivos += n }
  }
  if (!vivos) g.lancero = 2
  return g
}

/** Poder de referencia de una base de nivel n (sin dados: para comparar). */
const cachePoderTipico = {}
function poderTipico (n) {
  if (cachePoderTipico[n]) return cachePoderTipico[n]
  const base = generarBase(n, 'señor', makeRng(1000 + n))
  const p = poderTropas(generarGuarnicion(n, 'señor', makeRng(1000 + n))) + poderDefensas(base)
  cachePoderTipico[n] = p
  return p
}

// ============================================================================
//  6. RECOMPENSA
// ============================================================================

/**
 * Lo que se saca de reventar esta base. Proporcional a la dificultad y con
 * rendimiento decreciente: la misma aldea saqueada cinco veces ya no da igual,
 * así que hay que ir a por otra (y ahí está la gracia del mapa).
 * @returns {{madera:number,piedra:number,comida:number,oro:number,gemas:number,xp:number,texto:string}}
 */
export function recompensaDe (enemigo) {
  if (!enemigo) return { madera: 0, piedra: 0, comida: 0, oro: 0, gemas: 0, xp: 0, texto: 'Nada' }
  const p = PERSONALIDADES[enemigo.personalidad] || PERSONALIDADES.bandido
  const desgaste = Math.max(0.35, 1 / (1 + 0.20 * (enemigo.saqueos || 0)))
  const b = enemigo.botin || {}

  const r = {
    madera: Math.round((b.madera || 0) * desgaste),
    piedra: Math.round((b.piedra || 0) * desgaste),
    comida: Math.round((b.comida || 0) * desgaste),
    oro: Math.round((b.oro || 0) * desgaste),
    // las gemas no se desgastan tan rápido: son el premio gordo
    gemas: Math.round((b.gemas || 0) * Math.max(0.4, 1 / (1 + 0.35 * (enemigo.saqueos || 0)))),
    xp: 0,
    texto: ''
  }
  r.xp = Math.round((18 + Math.pow(enemigo.nivel, 1.7) * 9) * (0.6 + 0.4 * p.defensa) * desgaste)

  const partes = []
  if (r.gemas) partes.push(`${r.gemas} 💎`)
  if (r.oro) partes.push(`${r.oro} 🪙`)
  const bruto = r.madera + r.piedra + r.comida
  if (bruto) partes.push(`${bruto} en grano y materiales`)
  r.texto = partes.length ? `${partes.join(', ')} y ${r.xp} de experiencia` : `${r.xp} de experiencia y poco más`
  return r
}

// ============================================================================
//  7. EL PARTE DEL EXPLORADOR
// ============================================================================

const enLetra = (n) => ['cero', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'][n] || String(n)

/** Plurales a mano: "espadachíns" canta muchísimo en pantalla. */
const PLURAL = {
  lancero: 'lanceros', arquero: 'arqueros', espadachin: 'espadachines',
  ballestero: 'ballesteros', jinete: 'jinetes', caballero: 'caballeros', monje: 'monjes'
}

/** Cuenta lo que hay en la base sin repasarla dos veces. */
function inventario (base) {
  const c = { muralla: 0, puerta: 0, torres: 0, ballestas: 0, castillo: 0, granja: 0, granero: 0, almacen: 0, oro: 0, casa: 0, militar: 0, monasterio: 0, fuera: base.fuera || 0 }
  for (const b of (base.buildings || [])) {
    switch (b.tipo) {
      case 'muralla': c.muralla++; break
      case 'puerta': c.puerta++; break
      case 'torre_vigia': c.torres++; break
      case 'torre_ballesta': c.ballestas++; c.torres++; break
      case 'castillo': c.castillo++; break
      case 'granja': c.granja++; break
      case 'granero': c.granero++; break
      case 'almacen': c.almacen++; break
      case 'mina_oro': c.oro++; break
      case 'casa': c.casa++; break
      case 'monasterio': c.monasterio++; break
      case 'cuartel': case 'arqueria': case 'establo': case 'taller_asedio': c.militar++; break
    }
  }
  return c
}

/**
 * El parte del explorador, en cristiano y con retranca. Es lo que el jugador
 * lee antes de decidir, así que tiene que decir algo útil en cada frase.
 * @param {any} enemigo
 * @returns {string}
 */
export function describirBase (enemigo) {
  if (!enemigo) return 'No se ve nada desde aquí.'
  const base = baseDe(enemigo)
  if (!base) return 'No se ve nada desde aquí.'
  const inv = inventario(base)
  const rng = makeRng(semillaDe(`parte:${enemigo.id || enemigo.semilla || 1}:${enemigo.nivel}`))
  const anillos = (base.anillos || []).length
  const lanzas = Object.values(enemigo.guarnicion || {}).reduce((a, b) => a + b, 0)
  const frases = []

  // 1) el muro
  if (!anillos || inv.muralla < 8) {
    frases.push(rng.pick([
      'Ni muralla digna: cuatro estacas y mucha confianza.',
      'La empalizada está podrida y con más boquetes que tramos.',
      'Se defienden con carros y sacos. Eso no para a nadie.'
    ]))
  } else {
    const nombreMuro = anillos === 1 ? 'Muralla sencilla' : anillos === 2 ? 'Muralla doble' : 'Tres anillos de muralla'
    const remate = inv.torres
      ? `${enLetra(Math.min(10, inv.torres))} torre${inv.torres === 1 ? '' : 's'}`
      : 'sin una sola torre'
    frases.push(`${nombreMuro}, ${remate}${inv.puerta ? ` y ${enLetra(Math.min(10, inv.puerta))} puerta${inv.puerta === 1 ? '' : 's'}` : ', y ni una puerta a la vista'}.`)
  }

  // 2) la gente de armas
  if (lanzas) {
    const grueso = Object.entries(enemigo.guarnicion).sort((a, b) => b[1] - a[1])[0]
    const nom = PLURAL[grueso[0]] || `${((UNIDADES[grueso[0]] || {}).nombre || grueso[0]).toLowerCase()}s`
    const cuantos = lanzas === 1 ? 'un' : lanzas <= 10 ? enLetra(lanzas) : String(lanzas)
    frases.push(`Guarnición de ${cuantos} ${lanzas === 1 ? 'hombre' : 'hombres'}, con el grueso en ${lanzas === 1 ? (UNIDADES[grueso[0]] || {}).nombre?.toLowerCase() || nom : nom}.`)
  }

  // 3) el punto flaco o el punto fuerte: la frase que decide el asalto
  if (inv.fuera >= 2) {
    frases.push(rng.pick([
      'El grano está fuera del recinto: mal negocio para ellos.',
      'Media aldea duerme extramuros. Se entra sin romper nada.',
      'Los almacenes quedaron al otro lado del muro. Torpeza que se paga.'
    ]))
  } else if (inv.ballestas) {
    frases.push('Hay torres de ballesta cubriendo el paso. Entrar por el frente es un suicidio caro.')
  } else if (inv.castillo) {
    frases.push('El torreón domina toda la plaza; mientras siga en pie, no hay saqueo.')
  } else if (!inv.torres) {
    frases.push('Nadie vigila de noche. Un golpe de mano y fuera.')
  } else if (inv.puerta === 0) {
    frases.push('No hay puerta que forzar: o se rompe muro o no se entra.')
  } else {
    frases.push(rng.pick([
      'Todo bien atado; habrá que pagar el paso con sangre.',
      'Muros cuidados y relevos puntuales. Gente seria.'
    ]))
  }

  // 4) el bocado
  if (enemigo.botin && enemigo.botin.gemas) {
    frases.push(rng.pick([
      'Dentro guardan algo que brilla y que no es oro.',
      'Se habla de una reliquia en la capilla. Eso vale más que el grano.'
    ]))
  } else if (inv.oro) {
    frases.push('Tienen mina propia: la bolsa estará llena.')
  }

  if (enemigo.rencor >= 2) frases.push('Y te tienen ganas: no hará falta que los busques.')
  return frases.join(' ')
}

// ============================================================================
//  8. REAPARICIÓN Y ATAQUES
// ============================================================================

/** Horas que tarda en rehacerse una base arrasada. Lo gordo cuesta más. */
const horasReaparicion = (nivel) => clamp(1 + nivel * 0.35, 1, 5)

// ---------------------------------------------------------------- VASALLOS ---

/**
 * Lo que rinde un vasallo en CADA entrega: una parte de su despensa. El que
 * tenía mucho que robar, mucho paga; el campamento de cuatro tiendas, poco.
 * @returns {{madera:number,piedra:number,comida:number,oro:number}}
 */
export function tributoDe (enemigo) {
  const b = (enemigo && enemigo.botin) || {}
  const t = { madera: 0, piedra: 0, comida: 0, oro: 0 }
  let algo = 0
  for (const r of ['madera', 'piedra', 'comida', 'oro']) {
    t[r] = Math.round((b[r] || 0) * TRIBUTO_FRACCION)
    algo += t[r]
  }
  if (!algo) t.comida = 5 + (enemigo?.nivel || 1) * 3
  return t
}

const textoTributo = (t) => ['madera', 'piedra', 'comida', 'oro']
  .filter(r => t[r] > 0)
  .map(r => `${t[r]} de ${r}`).join(', ') || 'poca cosa'

/**
 * Al segundo escarmiento el rival hinca la rodilla: deja de ser enemigo, se
 * queda en el mapa como VASALLO y te paga tributo cada media hora. Es la pata
 * de "hacerse un imperio": cada aldea sometida es renta para siempre.
 */
export function hacerVasallo (enemigo) {
  enemigo.vasallo = true
  enemigo.derrotado = false
  enemigo.reaparece = 0
  enemigo.rencor = 0
  enemigo.proximoAtaque = 0
  enemigo.tributo = tributoDe(enemigo)
  enemigo.proximoTributo = Date.now() + TRIBUTO_CADA_MIN * 60000
  enemigo.tributosPagados = 0
  enemigo.descubierto = true
  enemigo.tituloPrevio = enemigo.tituloPrevio || enemigo.titulo
  enemigo.titulo = `Vasallo · ${enemigo.tituloPrevio}`
  enemigo.amenaza = 'Vasallo tuyo'
  enemigo.descripcion = `Han hincado la rodilla. Cada ${TRIBUTO_CADA_MIN} minutos mandan ${textoTributo(enemigo.tributo)} a tu granero. ` +
    'Si vuelves y les ganas del todo, la plaza deja de ser suya.'
  events.emit(EV.UI_TOAST, {
    texto: `🏳️ ${enemigo.nombre} te jura vasallaje: tributo cada ${TRIBUTO_CADA_MIN} min. Vuelve a ganarle y su plaza será tuya`,
    tipo: 'bien'
  })
  return enemigo
}

/** Los que te pagan. */
export const vasallos = () => enemigos().filter(e => e.vasallo)

/** Las comarcas que ya ondean tu estandarte (su ficha vive en imperio.plazas). */
export const conquistados = () => enemigos().filter(e => e.conquistado)

/**
 * Su plaza pasa a tu bandera: deja de ser rival, deja de pagar tributo (ahora
 * produce) y deja de rehacerse. Lo llama world/imperio.js al conquistar.
 */
export function marcarConquistado (enemigo) {
  if (!enemigo) return null
  enemigo.conquistado = true
  enemigo.vasallo = false
  enemigo.derrotado = false
  enemigo.reaparece = 0
  enemigo.rencor = 0
  enemigo.proximoAtaque = 0
  enemigo.proximoTributo = 0
  enemigo.tributo = null
  enemigo.descubierto = true
  enemigo.señor = null
  enemigo.tituloPrevio = enemigo.tituloPrevio || enemigo.titulo
  enemigo.titulo = `Plaza tuya · ${enemigo.tituloPrevio}`
  enemigo.amenaza = 'Bajo tu bandera'
  enemigo.descripcion = 'Tu estandarte ondea en la plaza: produce para tu granero y desde ella alcanzas a sus vecinos.'
  return enemigo
}

/**
 * Te la han quitado. Vuelve a estar en pie y con ganas, bajo la bandera del
 * señor que entró (o de nadie). Conquistar no puede ser un billete de ida.
 */
export function devolverPlaza (enemigo, señorId = null) {
  if (!enemigo) return null
  enemigo.conquistado = false
  enemigo.vasallo = false
  enemigo.derrotas = 0
  enemigo.fracasos = 0
  enemigo.derrotado = false
  enemigo.señor = señorId || null
  enemigo.titulo = enemigo.tituloPrevio || enemigo.titulo
  enemigo.rencor = clamp((enemigo.rencor || 0) + 1, 0, 5)
  enemigo.motivoRencor = 'plaza'    // te la tiene jurada por la comarca, no por el grano
  reconstruir(enemigo)
  enemigo.proximoAtaque = Date.now() + intervaloAtaque(enemigo)
  return enemigo
}

/** Un señor rival se queda con una plaza neutral: sube de talla y cambia de casa. */
export function absorberRival (enemigo, señor) {
  if (!enemigo) return null
  enemigo.señor = señor ? señor.id : enemigo.señor || null
  if (señor) enemigo.casa = `la bandera de ${señor.nombre}`
  subirDeNivel(enemigo, 1)
  return enemigo
}

/**
 * El contador de imperio: cuánta gente te debe pleitesía, cuánta tierra hay
 * bajo tu bandera y cuánto entra al día sin mover un dedo.
 */
export function imperio () {
  const lista = enemigos()
  const v = lista.filter(e => e.vasallo)
  const w = mundo()
  const entregasDia = (24 * 60) / TRIBUTO_CADA_MIN
  const dia = { madera: 0, piedra: 0, comida: 0, oro: 0 }
  let proximo = Infinity
  for (const e of v) {
    const t = e.tributo || (e.tributo = tributoDe(e))
    for (const r of Object.keys(dia)) dia[r] += Math.round((t[r] || 0) * entregasDia)
    proximo = Math.min(proximo, e.proximoTributo || Infinity)
  }
  return {
    vasallos: v.length,
    comarcas: 1 + v.length,                 // tu valle y el de cada vasallo
    señores: v.filter(e => e.nivel >= 8).length,
    explorado: Object.keys((w && w.descubierto) || {}).length,
    asaltosGanados: lista.reduce((n, e) => n + (e.derrotas || 0), 0),
    enPie: lista.filter(e => !e.vasallo && !e.derrotado && !e.conquistado).length,
    plazas: lista.filter(e => e.conquistado).length,
    tributoDia: dia,
    tributoDiaTotal: Object.values(dia).reduce((a, b) => a + b, 0),
    proximoTributo: Number.isFinite(proximo) ? proximo : 0,
    lista: v.map(e => ({
      id: e.id, nombre: e.nombre, nivel: e.nivel, x: e.x, y: e.y,
      titulo: e.tituloPrevio || e.titulo, icono: (PERSONALIDADES[e.personalidad] || PERSONALIDADES.bandido).icono,
      tributo: e.tributo || tributoDe(e),
      tributoTexto: textoTributo(e.tributo || tributoDe(e)),
      proximoTributo: e.proximoTributo || 0,
      pagados: e.tributosPagados || 0
    }))
  }
}

/** Cobra lo que deban los vasallos. Va por reloj real: también cobra offline. */
function cobrarTributos () {
  const ahora = Date.now()
  const total = { madera: 0, piedra: 0, comida: 0, oro: 0 }
  let entregas = 0
  let cuantos = 0
  for (const e of vasallos()) {
    if (!e.tributo) e.tributo = tributoDe(e)
    if (!e.proximoTributo) { e.proximoTributo = ahora + TRIBUTO_CADA_MIN * 60000; continue }
    let n = 0
    while (e.proximoTributo <= ahora && n < TRIBUTOS_OFFLINE_MAX) {
      n++
      e.proximoTributo += TRIBUTO_CADA_MIN * 60000
    }
    // Si vuelves tras dos días, no se cobran cuarenta entregas: se pierde el resto.
    if (e.proximoTributo <= ahora) e.proximoTributo = ahora + TRIBUTO_CADA_MIN * 60000
    if (!n) continue
    for (const r of Object.keys(total)) total[r] += (e.tributo[r] || 0) * n
    e.tributosPagados = (e.tributosPagados || 0) + n
    entregas += n
    cuantos++
  }
  if (!entregas) return
  ingresarRecursos(total, 'tributo de vasallos')
  events.emit(EV.UI_TOAST, {
    texto: `🏳️ Tributo de ${cuantos === 1 ? 'tu vasallo' : `tus ${cuantos} vasallos`}: ${textoTributo(total)}`,
    tipo: 'bien'
  })
}

/** Marca la base como arrasada y pone el reloj de la reconstrucción. */
export function derrotar (enemigo) {
  if (!enemigo || enemigo.derrotado || enemigo.conquistado) return enemigo
  enemigo.saqueos = (enemigo.saqueos || 0) + 1
  enemigo.derrotas = (enemigo.derrotas || 0) + 1

  // SEGUNDO ESCARMIENTO: al vasallo que vuelves a batir se le toma la plaza.
  // A partir de aquí la comarca es tuya y produce para ti (world/imperio.js).
  if (enemigo.vasallo) {
    if (IMPERIO && typeof IMPERIO.conquistar === 'function' && IMPERIO.conquistar(enemigo)) return enemigo
    return enemigo          // sin imperio cargado sigue de vasallo: nada se rompe
  }

  // PRIMER ESCARMIENTO: hinca la rodilla y pasa a pagarte tributo.
  // Tomar una comarca no despeja el camino: lo que hay DETRÁS cierra filas.
  endurecerDetras(enemigo)
  if (enemigo.derrotas >= DERROTAS_PARA_VASALLO) return hacerVasallo(enemigo)
  enemigo.derrotado = true
  enemigo.rencor = clamp((enemigo.rencor || 0) + 1, 0, 5)
  enemigo.motivoRencor = 'saqueo'   // para que el aviso pueda decirle POR QUÉ viene
  enemigo.reaparece = Date.now() + horasReaparicion(enemigo.nivel) * HORA
  // el que ha sido saqueado no espera su turno: la próxima visita la hace él
  const p = PERSONALIDADES[enemigo.personalidad] || PERSONALIDADES.bandido
  enemigo.proximoAtaque = enemigo.reaparece + (6 / Math.max(0.5, p.rencor)) * HORA
  return enemigo
}

/**
 * Le sube el nivel a un rival y le rehace la aldea a esa talla. Es lo que
 * permite que el valle entero se endurezca mientras tú creces, sin tener que
 * repoblarlo ni inventarse gente nueva.
 */
function subirDeNivel (enemigo, cuantos = 1) {
  const nivel = clamp((enemigo.nivel || 1) + cuantos, 1, NIVEL_MAX)
  if (nivel === enemigo.nivel) return enemigo
  enemigo.nivel = nivel
  enemigo.semilla = semillaDe(`sube:${enemigo.id}:${nivel}`)
  // La base solo se levanta si ya estaba levantada: la niebla no gasta guardado.
  if (enemigo.base) enemigo.base = generarBase(nivel, enemigo.personalidad, makeRng(enemigo.semilla))
  enemigo.guarnicion = generarGuarnicion(nivel, enemigo.personalidad, makeRng(enemigo.semilla + 1))
  enemigo.guarnicionBase = { ...enemigo.guarnicion }
  enemigo.botin = generarBotin(nivel, enemigo.personalidad, makeRng(enemigo.semilla + 2))
  enemigo.poder = poderTropas(enemigo.guarnicion) + (enemigo.base ? poderDefensas(enemigo.base) : 0)
  enemigo.amenaza = etiquetaAmenaza(nivel)
  enemigo.descripcion = describirBase(enemigo)
  return enemigo
}

/**
 * Al tomar una comarca, los que viven MÁS ALLÁ en esa misma dirección se
 * preparan: suben un nivel. Así avanzar hacia el confín es cada vez más caro y
 * el mapa no se convierte en una lista de aldeas indefensas.
 * @returns {number} a cuántos les ha subido la sangre
 */
function endurecerDetras (caido) {
  if (!caido || !Number.isFinite(caido.x)) return 0
  const casa = casaDelMapa()
  const dx = caido.x - casa.x; const dy = caido.y - casa.y
  const d0 = Math.hypot(dx, dy)
  if (d0 < 0.5) return 0
  let tocados = 0
  for (const e of enemigos()) {
    if (e === caido || e.vasallo || e.criado) continue
    const ex = e.x - casa.x; const ey = e.y - casa.y
    const de = Math.hypot(ex, ey)
    if (de <= d0) continue                                       // los de acá ya los conoces
    if ((ex * dx + ey * dy) / (de * d0) < 0.55) continue          // que estén detrás, no a un lado
    if (Math.hypot(e.x - caido.x, e.y - caido.y) > 4.5) continue  // vecinos suyos, no el confín entero
    subirDeNivel(e, 1)
    e.motivoRencor = 'plaza'          // han visto el humo de la comarca de al lado
    if (++tocados >= 3) break
  }
  if (tocados) {
    events.emit(EV.UI_TOAST, {
      texto: '⚔️ Al otro lado de la comarca han visto el humo: los vecinos cierran filas.',
      tipo: 'info'
    })
  }
  return tocados
}

/**
 * Se rehacen un poco más fuertes: reconstruyen con lo aprendido, suben un
 * nivel de vez en cuando y nunca se olvidan de quién les quemó el granero.
 * Cuanto más grande es tu reino, más seguro es que se rehagan un escalón arriba.
 */
export function reconstruir (enemigo) {
  const rng = makeRng(semillaDe(`re:${enemigo.id}:${enemigo.saqueos}`))
  const sube = enemigo.rencor >= 2 || rng.chance(0.65 + 0.05 * parcelasGanadas())
  const nivel = clamp(enemigo.nivel + (sube ? 1 : 0), 1, NIVEL_MAX)
  const semilla = semillaDe(`${enemigo.semilla}:${enemigo.saqueos}`)
  const poderAntes = enemigo.poder || 0

  enemigo.nivel = nivel
  enemigo.semilla = semilla
  enemigo.base = generarBase(nivel, enemigo.personalidad, makeRng(semilla))
  enemigo.guarnicion = generarGuarnicion(nivel, enemigo.personalidad, makeRng(semilla + 1))
  enemigo.guarnicionBase = { ...enemigo.guarnicion }
  enemigo.botin = generarBotin(nivel, enemigo.personalidad, makeRng(semilla + 2))
  // Regla dura: rehacerse NUNCA debilita. Si los dados dan una aldea peor que
  // la que arrasaste, se compensa con gente: han aprendido a quién temer.
  const minimo = Math.round(poderAntes * (1.06 + 0.04 * enemigo.rencor))
  let poder = poderTropas(enemigo.guarnicion) + poderDefensas(enemigo.base)
  if (poderAntes && poder < minimo) {
    const pd = poderDefensas(enemigo.base)
    escalarGuarnicion(enemigo.guarnicion, Math.max(1.05, (minimo - pd) / Math.max(1, poderTropas(enemigo.guarnicion))))
    poder = poderTropas(enemigo.guarnicion) + pd
  }
  enemigo.poder = poder
  enemigo.derrotado = false
  enemigo.reaparece = 0
  enemigo.amenaza = etiquetaAmenaza(nivel)
  enemigo.descripcion = describirBase(enemigo)
  if (enemigo.rencor >= 1) {
    enemigo.descripcion += ' Han levantado el muro más alto justo por donde entraste.'
  }
  return enemigo
}

/**
 * ¿Tiene el jugador escudo de protección? Lo pone sim/combat tras una derrota
 * (`state.escudo.hasta`); aquí solo se lee, y se aceptan otras formas por si
 * algún módulo lo guarda a su manera.
 */
export function escudoActivo () {
  const s = game.state
  if (!s) return false
  const hasta = (s.escudo && s.escudo.hasta) || s.escudoHasta ||
    (s.jugador && s.jugador.escudoHasta) || 0
  return hasta > Date.now()
}

/** Nivel del ayuntamiento terminado: la vara más honesta de "cuánto tengo". */
function nivelAyuntamiento () {
  const bs = (game.state && game.state.buildings) || []
  let n = 0
  for (const b of bs) if (b.tipo === 'ayuntamiento' && !b.enObra) n = Math.max(n, b.nivel || 0)
  return n
}

/** Plazas que ya te deben algo: vasallos y comarcas bajo tu bandera. */
const plazasSometidas = () => enemigos().filter(e => e.vasallo || e.conquistado).length

/**
 * EN QUÉ ESCALÓN DE GUERRA ESTÁ EL JUGADOR. No lo decide el reloj ni el azar:
 * lo decide lo que tiene que perder. Los primeros días, cero; luego sube con el
 * ayuntamiento, con las parcelas que ha ganado y con las plazas que ha sometido.
 * @returns {number} índice dentro de ESCALERA_ASEDIOS
 */
export function escalonAsedios () {
  const s = game.state
  if (!s) return 0
  if (Date.now() < finGracia()) return 0
  const ayto = nivelAyuntamiento()
  if (ayto < AYTO_MINIMO) return 0
  const parcelas = parcelasGanadas()
  const plazas = plazasSometidas()
  let n = 1
  if (ayto >= 4 || parcelas >= 1) n = 2
  if (ayto >= 6 || parcelas >= 3 || plazas >= 1) n = 3
  if (ayto >= 8 || parcelas >= 6 || plazas >= 3) n = 4
  if (ayto >= 10 || parcelas >= 10 || plazas >= 6) n = 5
  return n
}

/** El bloque de estado del ritmo, saneado. Es JSON puro y se guarda con la partida. */
function relojAsedios () {
  const s = game.state
  if (!s) return { jugado: 0, total: 0, ultimo: 0 }
  if (!s.asedios || typeof s.asedios !== 'object') s.asedios = {}
  const a = s.asedios
  if (!Number.isFinite(a.jugado)) a.jugado = 0
  if (!Number.isFinite(a.total)) a.total = 0
  if (!Number.isFinite(a.ultimo)) a.ultimo = 0
  return a
}

/**
 * CADA CUÁNTO TE VISITAN, en segundos DE JUEGO. Cero significa "hoy no viene
 * nadie". La interfaz lo cuenta tal cual con EV.ASEDIO_RITMO.
 */
export function ritmoAsedios () {
  const i = escalonAsedios()
  const paso = ESCALERA_ASEDIOS[i]
  const a = relojAsedios()
  const descanso = paso.descansoMin * 60
  return {
    escalon: i,
    nombre: paso.nombre,
    porQue: paso.porQue,
    asediosDia: paso.asediosDia,
    descansoMin: paso.descansoMin,
    faltanMin: descanso ? Math.max(0, Math.round((descanso - a.jugado) / 60)) : 0,
    enCalma: i === 0,
    total: a.total
  }
}

/** ¿Le toca ya? Solo con el reloj de JUEGO cumplido: estar fuera no acumula. */
function tocaAsedio () {
  const i = escalonAsedios()
  if (!i) return false
  const descanso = ESCALERA_ASEDIOS[i].descansoMin * 60
  return relojAsedios().jugado >= descanso
}

/** Se anuncia un asedio: el descanso vuelve a cero y se apunta en la cuenta. */
function marcarAsedio () {
  const a = relojAsedios()
  a.jugado = 0
  a.ultimo = Date.now()
  a.total = (a.total || 0) + 1
}

/**
 * NUNCA DOS SEGUIDOS. Después de defender —se gane o se pierda— hay un respiro
 * garantizado. Entra como "tiempo jugado en negativo": hasta que no lo agote,
 * el descanso ni siquiera empieza a contar.
 */
function darRespiro (minutos = RESPIRO_TRAS_DEFENDER_MIN) {
  const a = relojAsedios()
  a.jugado = Math.min(a.jugado, -minutos * 60)
}

/**
 * POR QUÉ TE ATACA ESTE. El jugador tiene derecho a entenderlo: nadie viene
 * porque sí. Se devuelve todo masticado para que la interfaz lo cuente sin
 * tener que deducir nada.
 * @returns {{clave:string, icono:string, titulo:string, porQue:string}}
 */
export function motivoDelAsedio (enemigo) {
  const e = enemigo || {}
  if (e.motivoRencor === 'plaza' || e.señor) {
    return {
      clave: 'plaza',
      icono: '🏴',
      titulo: 'Le tomaste una plaza',
      porQue: `Tu estandarte ondea en tierra que era de ${e.nombre}. Viene a recuperar lo suyo.`
    }
  }
  if ((e.saqueos || 0) > 0) {
    return {
      clave: 'venganza',
      icono: '🔥',
      titulo: 'Le saqueaste',
      porQue: 'Le quemaste el granero y no lo ha olvidado. Viene a cobrárselo.'
    }
  }
  if ((e.fracasos || 0) > 0) {
    return {
      clave: 'orgullo',
      icono: '⚔️',
      titulo: 'Te paró una vez y quiere más',
      porQue: `${e.nombre} aguantó tu asalto. Ahora le toca a él salir de casa.`
    }
  }
  if (escalonAsedios() >= 3) {
    return {
      clave: 'riqueza',
      icono: '💰',
      titulo: 'Eres el más rico de la comarca',
      porQue: 'Tus almacenes son el mejor botín del valle y todo el mundo lo sabe.'
    }
  }
  if (parcelasGanadas() >= 1) {
    return {
      clave: 'frontera',
      icono: '🚩',
      titulo: 'Tu bandera llegó a su linde',
      porQue: `Has crecido hasta tocar el territorio de ${e.nombre}, y eso no gusta a nadie.`
    }
  }
  return {
    clave: 'saqueo',
    icono: '🏴',
    titulo: 'Vienen a por el granero',
    porQue: `${e.nombre} anda buscando qué llevarse y tu aldea le queda de camino.`
  }
}

/** Cada cuánto se decide a venir un rival concreto. El rencor lo acelera. */
function intervaloAtaque (enemigo) {
  const p = PERSONALIDADES[enemigo.personalidad] || PERSONALIDADES.bandido
  const base = (55 + enemigo.nivel * 6) * 60000      // de una hora a dos y media
  const prisa = 1 / (1 + 0.35 * (enemigo.rencor || 0) * p.rencor)
  return base * prisa
}

/**
 * Lo que tu aldea puede oponer: tropa en casa + torres y muros. Es la vara con
 * la que se elige quién viene y con cuánta gente, para que un asedio sea una
 * pelea y no una ejecución.
 */
export function poderDefensivoJugador () {
  const s = game.state
  if (!s) return 150
  const tropas = (s.ejercito && s.ejercito.tropas) || {}
  return Math.max(150, poderTropas(tropas) + poderDefensas({ buildings: s.buildings || [] }))
}

let ultimoAviso = 0
let descansoHasta = 0
let acumulado = 0

/** Cada cuánto recluta un rival para tapar los huecos de su guarnición. */
const REFUERZO_CADA = 20 * 60000
const REFUERZO_FRACCION = 0.2

/**
 * Reponen bajas. Sin esto, machacar la guarnición de una plaza fuerte la dejaba
 * VACÍA para siempre: un castillo de nivel 14 con cero hombres, imposible de
 * tomar por sus muros y sin nadie a quien matar. Reclutan poco a poco hasta
 * volver a su plantilla, y el `poder` de la ficha se pone al día con ellos.
 */
function reforzarGuarniciones (ahora) {
  for (const e of enemigos()) {
    if (e.derrotado || e.conquistado || !e.guarnicionBase) continue
    if (ahora - (e.ultimoRefuerzo || 0) < REFUERZO_CADA) continue
    e.ultimoRefuerzo = ahora
    let cambio = false
    for (const [tipo, tope] of Object.entries(e.guarnicionBase)) {
      const hay = e.guarnicion[tipo] || 0
      if (hay >= tope) continue
      const suma = Math.max(1, Math.round(tope * REFUERZO_FRACCION))
      e.guarnicion[tipo] = Math.min(tope, hay + suma)
      cambio = true
    }
    if (cambio) e.poder = poderTropas(e.guarnicion) + poderDefensas(baseDe(e))
  }
}

/** Último escalón anunciado, para no repetir el aviso en cada tick. */
let escalonAnunciado = -1

/** Cuenta a la interfaz en qué escalón de guerra está, cuando cambia. */
function avisarRitmo (forzar = false) {
  const r = ritmoAsedios()
  if (!forzar && r.escalon === escalonAnunciado) return r
  escalonAnunciado = r.escalon
  events.emit(EV.ASEDIO_RITMO, r)
  return r
}

/** Quién está en condiciones de venir hoy a por ti. */
function candidatosDeAsedio () {
  return enemigos().filter(e =>
    !e.derrotado && !e.vasallo && !e.conquistado &&
    Object.keys(e.guarnicion || {}).length            // sin gente no se sale de casa
  )
}

/** Revisa reconstrucciones y decide si alguien se anima a visitarte. */
function alTick (p) {
  const dt = (p && p.dt) ? p.dt : 0.25
  // EL RELOJ DEL ASEDIO CORRE SOLO MIENTRAS SE JUEGA. Es la pieza que arregla lo
  // de "siempre me atacan al abrir": cerrar la app ya no acumula nada.
  relojAsedios().jugado += dt
  acumulado += dt
  if (acumulado < 5) return            // basta con mirar esto cada cinco segundos
  acumulado = 0
  const ahora = Date.now()
  const lista = enemigos()
  if (!lista.length) return

  // --- se rehacen las bases arrasadas ---
  for (const e of lista) {
    if (e.derrotado && e.reaparece && ahora >= e.reaparece) reconstruir(e)
  }

  // --- tus vasallos pasan por caja ---
  cobrarTributos()

  // --- los rivales reponen la gente que les mataste ---
  reforzarGuarniciones(ahora)

  // --- ¿viene alguien? ---
  // El reloj no crece sin fin: si no, al salir de los días de calma (o del
  // escudo) caería un asedio en el primer segundo por todo lo acumulado.
  const escalon = escalonAsedios()
  const tope = (escalon ? ESCALERA_ASEDIOS[escalon].descansoMin : 40) * 60
  const reloj = relojAsedios()
  if (reloj.jugado > tope) reloj.jugado = tope
  avisarRitmo()
  if (escudoActivo()) return
  // EL RITMO LO MARCA EL ESCALÓN, no los relojes de treinta rivales sueltos.
  if (!tocaAsedio()) return
  if (ahora < descansoHasta) return

  // Ojo: aquí ya NO se exige que el rival esté avistado. Las partidas de
  // bandidos salen de la niebla; si no, un jugador que no explora no recibía
  // una sola visita en toda la partida.
  const puede = candidatosDeAsedio()
  if (!puede.length) return
  // Si a ninguno le toca todavía su turno, viene el que lo tenga más cerca: el
  // descanso ya se ha cumplido y prometer un ritmo y no cumplirlo es peor.
  const suyos = puede.filter(e => e.proximoAtaque && ahora >= e.proximoAtaque)
  const candidatos = suyos.length
    ? suyos
    : [puede.slice().sort((a, b) => (a.proximoAtaque || Infinity) - (b.proximoAtaque || Infinity))[0]]

  lanzarAtaque(elegirAtacante(candidatos))
}

/**
 * Quién se anima. Primero el que guarda rencor (te la tenía jurada) y, entre
 * los demás, el que más se parece a lo que tu aldea puede aguantar: la gracia
 * está en que el asedio se pueda ganar poniendo torres, no en que te arrase un
 * conde con castillo por vivir cerca.
 */
function elegirAtacante (candidatos) {
  const rencorosos = candidatos.filter(e => (e.rencor || 0) > 0)
  const lista = rencorosos.length ? rencorosos : candidatos
  const pd = poderDefensivoJugador()
  const err = (e) => Math.abs(Math.log(Math.max(1, e.poder) / pd))
  return lista.slice().sort((a, b) => ((b.rencor || 0) - (a.rencor || 0)) || (err(a) - err(b)))[0]
}

/**
 * Avisa de un ataque enemigo con margen para reforzar la defensa.
 * No resuelve nada: emite el aviso y sim/combat decide qué pasa al llegar.
 */
export function lanzarAtaque (enemigo, segundos = null, opciones = {}) {
  if (!enemigo) return null
  // Un rival al que le mataste la guarnición entera no puede venir a por ti:
  // primero recluta (reforzarGuarniciones) y ya vendrá.
  if (!Object.keys(enemigo.guarnicion || {}).length) {
    enemigo.proximoAtaque = Date.now() + REFUERZO_CADA
    return null
  }
  const rng = makeRng(semillaDe(`atk:${enemigo.id}:${Date.now()}`))
  // Para esto están las avanzadillas: el vigía las ve cruzar la linde y manda
  // el aviso antes. Cada puesto abastecido regala 45 s para reforzar la defensa.
  const vigias = avanzadillas()
  const adelanto = Math.min(180, vigias * 45)
  const llegaEn = (segundos ?? rng.int(AVISO_MIN_SEG, AVISO_MAX_SEG)) + adelanto
  const ahora = Date.now()

  enemigo.ultimoAtaque = ahora
  enemigo.proximoAtaque = ahora + intervaloAtaque(enemigo)
  ultimoAviso = ahora
  // El descanso de verdad va por tiempo JUGADO (marcarAsedio); este de reloj es
  // solo un suelo para que dos asedios no se pisen si juegas del tirón.
  descansoHasta = ahora + llegaEn * 1000 + ENTRE_ATAQUES_RELOJ
  marcarAsedio()
  // Al que te visita se le ve la cara: a partir de ahora sale en tu lista de
  // rivales y puedes devolvérsela. Ese es el bucle: te pegan, te vengas.
  enemigo.descubierto = true
  baseDe(enemigo)

  // vienen a por lo suyo: una parte de la guarnición, no la aldea entera
  const parte = enemigo.rencor >= 2 ? 0.75 : 0.55
  const hueste = {}
  for (const tipo in enemigo.guarnicion) {
    const n = Math.max(1, Math.round(enemigo.guarnicion[tipo] * parte))
    if (n > 0) hueste[tipo] = n
  }
  // Tope honrado: mandan una avanzadilla proporcional a lo que puedes oponer.
  // Sin esto, el primer asedio de un señor de nivel 12 te borra del mapa.
  const tope = poderDefensivoJugador() * ((enemigo.rencor || 0) >= 2 ? 1.3 : 1.05)
  const pt = poderTropas(hueste)
  if (pt > tope) escalarGuarnicion(hueste, tope / Math.max(1, pt))

  // POR QUÉ VIENE ESTE. Nadie ataca porque sí: el aviso lleva el motivo ya
  // explicado para que la interfaz pueda contarlo con todas las letras.
  const causa = motivoDelAsedio(enemigo)
  const ritmo = ritmoAsedios()

  const aviso = {
    enemigo,
    llegaEn,
    cuando: ahora + llegaEn * 1000,
    tropas: hueste,          // así lo espera sim/combat para resolver la defensa
    hueste,
    poder: poderTropas(hueste),
    unidades: Object.values(hueste).reduce((a, b) => a + b, 0),
    motivo: causa.clave,
    motivoIcono: causa.icono,
    motivoTitulo: causa.titulo,
    porQue: causa.porQue,
    // en qué escalón de guerra estás y cada cuánto te toca: la interfaz lo cuenta
    escalon: ritmo.escalon,
    escalonNombre: ritmo.nombre,
    ritmo,
    mientrasFuera: !!opciones.mientrasFuera,
    avisoAvanzadilla: adelanto,
    texto: `${causa.icono} ${causa.porQue}` +
      (adelanto ? ' Tus avanzadillas los han visto cruzar la linde: tienes más tiempo.' : '')
  }
  events.emit(EV.ATTACK_INCOMING, aviso)
  avisarRitmo(true)
  return aviso
}

/**
 * VOLVER DE ESTAR FUERA. Los asedios ya NO se acumulan con la app cerrada,
 * porque el descanso va por tiempo jugado. Lo único que puede haber pasado es
 * que ya te tocase uno cuando cerraste: entonces se resuelve UNO —solo uno— y
 * se te cuenta nada más entrar, con su parte. Nunca hay cola esperándote.
 * @returns {any|null} el aviso del asedio que pasó sin ti, o null
 */
export function asedioMientrasFuera (segundosFuera = 0) {
  if (!(segundosFuera >= FUERA_PARA_ASEDIO_SOLO)) return null
  if (escudoActivo() || !tocaAsedio()) return null
  const candidatos = candidatosDeAsedio()
  if (!candidatos.length) return null
  // llegaEn = 0: sim/combat lo resuelve en el siguiente tick y suelta el parte.
  return lanzarAtaque(elegirAtacante(candidatos), 0, { mientrasFuera: true })
}

// ============================================================================
//  9. ARRANQUE
// ============================================================================

/** Guarda a quién ha atacado el jugador para saber a quién duele el orgullo. */
let ultimoObjetivo = null

/** La interfaz manda una COPIA de la base al asalto; aquí se busca el original. */
function deLaFicha (ficha) {
  if (!ficha) return null
  return enemigoPorId(ficha.id) ||
    (Number.isFinite(ficha.x) && Number.isFinite(ficha.y) ? enemigoEn(ficha.x, ficha.y) : null)
}

export async function init () {
  banco = await cargarBanco()
  asegurar()

  events.on(EV.STATE_LOADED, (p) => {
    asegurar()
    // Si le tocaba asedio cuando cerró la app, se resuelve UNO y se le cuenta.
    asedioMientrasFuera((p && p.offlineSeconds) || 0)
    avisarRitmo(true)
  })
  events.on(EV.TICK, alTick)

  // NUNCA DOS SEGUIDOS: defender (ganando o perdiendo) da respiro garantizado.
  events.on(EV.DEFENSE_RESOLVED, () => { darRespiro(); avisarRitmo(true) })

  events.on(EV.WORLD_REVEALED, (p) => {
    const tiles = (p && p.tiles) || null
    const vistos = sincronizarNiebla(tiles)
    // el mundo puede haberse generado después que nosotros: si aún no hay nadie, se puebla
    if (!enemigos().length) poblarMundo()
    return vistos
  })

  // el escudo de protección también aplaza lo que ya venía de camino
  events.on(EV.SHIELD_STARTED ?? 'shield:started', (p) => {
    const hasta = (p && p.hasta) || 0
    if (!hasta) return
    for (const e of enemigos()) {
      if (e.proximoAtaque && e.proximoAtaque < hasta) e.proximoAtaque = hasta + 15 * 60000
    }
  })

  // --- rencor: al que saqueas, te la guarda ---
  events.on(EV.RAID_STARTED, (p) => { ultimoObjetivo = deLaFicha(p && (p.enemyBase || p.base || p.enemigo)) })

  events.on(EV.RAID_RESOLVED, (p) => {
    const e = deLaFicha(p && (p.base || p.enemyBase || p.enemigo)) || ultimoObjetivo
    if (!e) return
    // La guarnición que cayó en la batalla NO resucita: si vuelves mañana, te
    // encuentras la aldea con menos gente. Perder un asalto también cuenta.
    const caidos = (p && p.resultado && p.resultado.bajasDefensa) || {}
    let algo = false
    for (const [tipo, n] of Object.entries(caidos)) {
      if (!e.guarnicion || !e.guarnicion[tipo]) continue
      e.guarnicion[tipo] = Math.max(0, e.guarnicion[tipo] - n)
      if (!e.guarnicion[tipo]) delete e.guarnicion[tipo]
      algo = true
    }
    if (algo) e.poder = poderTropas(e.guarnicion) + poderDefensas(baseDe(e))
    if (p && p.victoria) {
      derrotar(e)
    } else if (!e.conquistado) {
      // aguantar el asalto también les sube la sangre a la cabeza
      e.fracasos = (e.fracasos || 0) + 1     // y tú aprendes que ahí no se entra
      e.rencor = clamp((e.rencor || 0) + 1, 0, 5)
      e.proximoAtaque = Math.min(e.proximoAtaque || Infinity, Date.now() + 40 * 60000)
    }
    ultimoObjetivo = null
  })
}

/** Crea la población si hace falta y repara fichas de versiones anteriores. */
function asegurar () {
  const w = mundo()
  if (!w) return []
  if (!Array.isArray(w.enemigos)) w.enemigos = []

  for (const e of w.enemigos) {
    e.semilla = e.semilla || semillaDe(e.id || `${e.x},${e.y}`)
    // la base solo se levanta para quien ya está fuera de la niebla (ahorra guardado)
    if (e.descubierto) baseDe(e)
    if (!e.guarnicion) e.guarnicion = generarGuarnicion(e.nivel || 1, e.personalidad || 'bandido', makeRng(e.semilla + 1))
    if (!e.botin) e.botin = generarBotin(e.nivel || 1, e.personalidad || 'bandido', makeRng(e.semilla + 2))
    if (!e.poder) e.poder = poderTropas(e.guarnicion) + poderDefensas(baseDe(e))
    if (typeof e.rencor !== 'number') e.rencor = 0
    if (typeof e.saqueos !== 'number') e.saqueos = 0
    if (typeof e.derrotas !== 'number') e.derrotas = e.saqueos || 0
    if (!e.guarnicionBase) e.guarnicionBase = { ...e.guarnicion }
    if (e.conquistado) {
      e.vasallo = false
      e.derrotado = false
      e.proximoAtaque = 0
      e.proximoTributo = 0
      if (!e.amenaza || e.amenaza !== 'Bajo tu bandera') e.amenaza = 'Bajo tu bandera'
    } else if (e.vasallo) {
      if (!e.tributo) e.tributo = tributoDe(e)
      if (!e.proximoTributo) e.proximoTributo = Date.now() + TRIBUTO_CADA_MIN * 60000
      e.proximoAtaque = 0
      e.derrotado = false
    } else if (!e.proximoAtaque || (!e.horarioListo && e.proximoAtaque > finGracia() + 12 * HORA)) {
      // Partidas viejas venían con el ataque a 6-20 horas vista: se recolocan UNA
      // vez (la marca evita que cargar la partida vuelva a mover el reloj).
      e.proximoAtaque = finGracia() + makeRng(e.semilla + 7).float(0, 3) * HORA
    }
    e.horarioListo = true
    if (!e.amenaza) e.amenaza = etiquetaAmenaza(e.nivel || 1)
    if (!e.descripcion) e.descripcion = describirBase(e)
  }

  if (!w.enemigos.length) poblarMundo()
  else sincronizarNiebla()
  // pase lo que pase, el jugador tiene a quien atacar desde el primer minuto
  if (asaltables().length < RIVALES_MINIMOS) revelarVecinos(RIVALES_MINIMOS - asaltables().length)
  return w.enemigos
}
