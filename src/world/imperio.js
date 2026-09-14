import { game } from '../core/state.js'
import { events, EV } from '../core/events.js'
import { makeRng } from '../core/rng.js'
import { CONFIG, PALETA } from '../core/config.js'
import { MUNDO, tileEn, nodoEn, descubrir, dentroMundo } from './map.js'
import * as Rivales from './enemies.js'

/**
 * EL IMPERIO: el mapa se conquista a manchas, al estilo Million Lords.
 *
 * ── LA IDEA EN UNA FRASE ────────────────────────────────────────────────
 * Cada comarca del valle (cada casilla con un señor dentro) tiene su PLAZA.
 * Le ganas y pasa a ser tuya: produce para ti, se mejora, se defiende y te
 * sirve de puesto avanzado para llegar a la siguiente. Conquisto → produce →
 * con eso conquisto más. Y lo que se toma también se pierde.
 *
 * ── CÓMO ENCAJA CON LO QUE YA HABÍA (esto es importante) ────────────────
 * No se duplica nada. Los tres sistemas que ya existían son ahora los tres
 * escalones de la MISMA escalera:
 *
 *   1) VASALLO (world/enemies.js) — le ganas UNA vez: hinca la rodilla y te
 *      paga tributo cada media hora. Sigue siendo suya la plaza; tú cobras.
 *      Es el escalón barato: renta sin tener que defender nada.
 *   2) PLAZA CONQUISTADA (este módulo) — le ganas DEL TODO (vuelves y le
 *      ganas al vasallo): la plaza cambia de bandera. Deja de pagarte tributo
 *      y empieza a PRODUCIR para ti por minuto, se puede mejorar, tiene
 *      guarnición y te extiende el alcance para atacar a sus vecinos.
 *   3) PARCELA DE TU ALDEA (core/grid.js + sim/buildings.js) — tomar la
 *      comarca es justo lo que abre la linde de tu aldea en esa dirección.
 *      sim/buildings.js ya deja la parcela «disponible» al ganar el asalto;
 *      aquí se guarda cuál es (`plaza.parcela`) y al conquistar la plaza se
 *      pide plantar la bandera. Mapa del mundo y tablero de la aldea crecen
 *      a la vez y por el mismo motivo: una comarca ganada, una linde abierta.
 *      (Si luego te quitan la plaza pierdes su renta, pero NO la parcela: allí
 *      ya has construido y tirar la aldea de alguien por un revés lejano sería
 *      un castigo absurdo. Lo que se pierde es lo que produce, no lo levantado.)
 *
 * ── LAS REGLAS DEL TABLERO ──────────────────────────────────────────────
 * · ADYACENCIA: solo se ataca lo que toca tu valle o una plaza tuya. El resto
 *   sale como «fuera de tu alcance: conquista antes X». Por eso el imperio
 *   crece en mancha y cada conquista abre la siguiente.
 * · EQUILIBRIO: la renta del imperio tiene rendimiento decreciente y un techo
 *   atado a lo que produce TU ALDEA (TOPE_SOBRE_ALDEA): un imperio enorme suma
 *   como mucho un 60 % sobre tu aldea. Se nota muchísimo y no la sustituye.
 * · REVERSIBLE: los señores rivales también se expanden. Cada cierto tiempo
 *   uno se queda con una plaza neutral o con una tuya mal guarnecida.
 *
 * Este módulo solo escribe en game.state.imperio (JSON puro) y en las marcas
 * de dominio de los rivales. Los tiles y los nodos son de world/map.js.
 */

// ------------------------------------------------------------------ ajustes ---

const RECURSOS = CONFIG.RECURSOS || ['madera', 'piedra', 'comida', 'oro']
const MINUTO = 60000
const HORA = 3600000

/** Nuestra bandera y la de los señores rivales. Todo sale de PALETA. */
export const COLOR_JUGADOR = PALETA.tela
const COLORES_RIVALES = [PALETA.telaAzul, PALETA.telaVerde, PALETA.cobre, PALETA.pizarra, PALETA.carbon]

/** Hasta dónde llega tu brazo. En casillas del mapa del mundo (distancia rey). */
const RADIO_CAPITAL = 2    // desde tu valle: el anillo de comarcas de al lado
const RADIO_PLAZA = 2      // desde cada plaza tuya: otro tanto, y así en mancha
const RADIO_RIVAL = 2      // lo mismo para ellos: nadie salta el mapa

/** Mejora de plaza: cinco escalones, cada uno más caro y más productivo. */
const NIVEL_MAX_PLAZA = 5
const FACTOR_NIVEL = 0.35          // +35 % de renta por escalón
const COSTE_MEJORA = { madera: 240, piedra: 200, comida: 160, oro: 60 }
const COSTE_CRECE = 1.85           // cada escalón casi dobla el anterior

/**
 * CUÁNTO RINDE UNA PLAZA. Medido con el banco de pruebas: la aldea pasa de
 * 130 por minuto el primer día a 26.000 el trigésimo (tres órdenes de
 * magnitud). Una renta fija sería un regalo el día 1 y calderilla el día 20,
 * así que una plaza rinde una CUOTA de lo que produce tu propia aldea: la
 * administra tu gente y se beneficia de tus tecnologías, igual que el resto.
 * Con un suelo fijo para que valga algo desde el primer minuto.
 */
const CUOTA_POR_PLAZA = 0.035      // una plaza de nivel 1 = +3,5 % de tu aldea
const RENTA_BASE = { madera: 3, piedra: 2.5, comida: 3, oro: 0.5 }   // suelo y reparto
const SESGO = 1.8                  // lo que pega con la comarca
const SESGO_POBRE = 0.55           // lo que no

/**
 * EL FRENO. Sin esto, veinte plazas convierten tu aldea en decoración: el
 * banco lo enseñaba en la primera prueba. Dos topes a la vez:
 *  · rendimiento decreciente por plaza (administrar lejos cuesta),
 *  · y un techo duro atado a la producción de tu aldea.
 */
const MERMA_POR_PLAZA = 0.055
const TOPE_SOBRE_ALDEA = 0.6

/** Como el resto del juego: volver tras dos días no llena el granero de golpe. */
const TOPE_OFFLINE = 8 * HORA

/** La milicia de la plaza se repone sola; la tropa que mandes tú, no. */
const REFUERZO_CADA = 15 * MINUTO
const REFUERZO_FRACCION = 0.25

/** Cada cuánto le da a un señor rival por estirar la pata. */
const EXPANSION_CADA = 35 * MINUTO
const EXPANSION_AZAR = 25 * MINUTO
const MAX_SEÑORES = 4
/** Una plaza tuya solo cae si va MUY floja frente al que viene. */
const MARGEN_DEFENSA = 0.85

// ------------------------------------------------------------- utilidades ---

const clave = (x, y) => `${x},${y}`
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by))
const casaDelMapa = () => {
  const w = game.state && game.state.world
  return (w && w.casa) ? w.casa : MUNDO.CASA
}

/**
 * El banco (sim/resources.js) es la misma excepción pactada que ya usa
 * world/enemies.js para los tributos: las rentas del imperio son ingresos de
 * verdad y tienen que respetar los topes del almacén. Si no está, se apaña.
 */
let banco = null
async function cargarBanco () {
  try { return await import('../sim/resources.js') } catch { return null }
}

function ingresar (recursos, motivo) {
  if (banco && typeof banco.ingresarVarios === 'function') {
    try { return banco.ingresarVarios(recursos, motivo) } catch { /* a mano */ }
  }
  const s = game.state
  if (!s || !s.recursos) return {}
  for (const r of RECURSOS) {
    if (!recursos[r]) continue
    const tope = (s.almacen && s.almacen[r]) ?? Infinity
    s.recursos[r] = Math.min(tope, (s.recursos[r] || 0) + recursos[r])
  }
  events.emit(EV.RESOURCES_CHANGED, { resources: s.recursos })
  return recursos
}

function produccionAldea () {
  if (banco && typeof banco.produccionPorMinuto === 'function') {
    try { return banco.produccionPorMinuto() } catch { /* nada */ }
  }
  return { madera: 0, piedra: 0, comida: 0, oro: 0 }
}

const toast = (texto, tipo = 'info') => events.emit(EV.UI_TOAST, { texto, tipo })

// ----------------------------------------------------------------- estado ---

/** Crea el hueco del imperio si la partida no lo trae (partidas ya empezadas). */
function asegurar () {
  const s = game.state
  if (!s) return null
  const ahora = Date.now()
  if (!s.imperio || typeof s.imperio !== 'object') {
    s.imperio = {
      color: COLOR_JUGADOR,
      plazas: {},
      rivales: {},
      señores: {},
      conquistadas: 0,
      perdidas: 0,
      ultimaRenta: ahora,
      proximaExpansion: ahora + EXPANSION_CADA,
      expansionSeq: 0
    }
  }
  const i = s.imperio
  if (!i.plazas || typeof i.plazas !== 'object') i.plazas = {}
  if (!i.rivales || typeof i.rivales !== 'object') i.rivales = {}
  if (!i.señores || typeof i.señores !== 'object') i.señores = {}
  if (!i.color) i.color = COLOR_JUGADOR
  if (!Number.isFinite(i.conquistadas)) i.conquistadas = 0
  if (!Number.isFinite(i.perdidas)) i.perdidas = 0
  if (!Number.isFinite(i.expansionSeq)) i.expansionSeq = 0
  if (!i.ultimaRenta || i.ultimaRenta > ahora) i.ultimaRenta = ahora
  if (!i.proximaExpansion) i.proximaExpansion = ahora + EXPANSION_CADA

  // relleno defensivo de plazas guardadas por versiones anteriores
  for (const k of Object.keys(i.plazas)) {
    const p = i.plazas[k]
    if (!p || typeof p !== 'object') { delete i.plazas[k]; continue }
    const c = k.split(',')
    if (!Number.isFinite(p.x)) p.x = Number(c[0])
    if (!Number.isFinite(p.y)) p.y = Number(c[1])
    if (!Number.isFinite(p.nivel)) p.nivel = 1
    if (!Number.isFinite(p.nivelRival)) p.nivelRival = 1
    if (!p.desde) p.desde = ahora
    if (!p.estado) p.estado = 'mia'
    if (!p.guarnicion || typeof p.guarnicion !== 'object') p.guarnicion = milicia(p.nivel, p.nivelRival)
    if (!p.plantilla || typeof p.plantilla !== 'object') p.plantilla = { ...p.guarnicion }
    if (!p.nombre) p.nombre = nombreDe(p.x, p.y)
    // 'produce' es la foto de lo que rendía al tomarla o al mejorarla: NO se
    // recalcula al cargar la partida, o guardar y cargar cambiaría el estado.
    // El número vivo lo da resumenImperio(), que no escribe nada.
    if (!p.produce) p.produce = rentaDe(p)
  }
  return i
}

const imp = () => asegurar()

// --------------------------------------------------- señores rivales ---

/**
 * Los señores con nombre: los rivales más gordos del valle, cada uno con su
 * color. Son los que se expanden. El resto son plazas neutrales (de la
 * máquina) que cualquiera puede tomar, tú o ellos.
 */
function nombrarSeñores () {
  const i = imp()
  if (!i) return {}
  const lista = Rivales.todosLosRivales().filter(e => !e.conquistado && !e.criado)
  if (!lista.length) return i.señores

  // los que siguen en pie mandan; si a un señor le tomaste la capital, se cae
  for (const id of Object.keys(i.señores)) {
    const s = i.señores[id]
    const suyo = lista.find(e => e.id === s.rivalId)
    if (!suyo || suyo.conquistado) delete i.señores[id]
  }

  const yaSon = new Set(Object.values(i.señores).map(s => s.rivalId))
  if (Object.keys(i.señores).length >= MAX_SEÑORES) return i.señores

  const casa = casaDelMapa()
  const fuertes = lista
    .filter(e => !yaSon.has(e.id) && !e.vasallo)
    .sort((a, b) => (b.nivel || 1) - (a.nivel || 1))

  for (const e of fuertes) {
    if (Object.keys(i.señores).length >= MAX_SEÑORES) break
    // ni pegados a casa ni pegados entre ellos: cada señor, su rincón del mapa
    if (cheb(e.x, e.y, casa.x, casa.y) < 3) continue
    const pegado = Object.values(i.señores).some(s => cheb(e.x, e.y, s.x, s.y) < 4)
    if (pegado) continue
    const id = `s${Object.keys(i.señores).length + 1}_${e.id}`
    i.señores[id] = {
      id,
      rivalId: e.id,
      nombre: e.nombre,
      casa: e.casa || '',
      color: COLORES_RIVALES[Object.keys(i.señores).length % COLORES_RIVALES.length],
      x: e.x,
      y: e.y,
      desde: Date.now()
    }
    i.rivales[clave(e.x, e.y)] = { señor: id, desde: Date.now() }
    e.señor = id
  }
  return i.señores
}

/** Casillas bajo la bandera de un señor: la suya propia y lo que ha ido tomando. */
function dominioDe (id) {
  const i = imp()
  const fuera = []
  for (const k of Object.keys(i.rivales)) {
    if (i.rivales[k].señor !== id) continue
    const c = k.split(',')
    fuera.push({ x: Number(c[0]), y: Number(c[1]) })
  }
  return fuera
}

// ------------------------------------------------------------ consultas ---

const nombreDe = (x, y) => { const t = tileEn(x, y); return (t && t.nombre) || 'Comarca sin nombre' }

/** Tus plazas, como lista. */
export function plazas () {
  const i = imp()
  return i ? Object.values(i.plazas) : []
}

export function plazaEn (x, y) {
  const i = imp()
  return (i && i.plazas[clave(x, y)]) || null
}

export const esMia = (x, y) => !!plazaEn(x, y)

/** Quién manda en una casilla: 'jugador', el id de un señor, o null (neutral). */
export function dueñoDe (x, y) {
  const i = imp()
  if (!i) return null
  const k = clave(x, y)
  if (i.plazas[k]) return 'jugador'
  const casa = casaDelMapa()
  if (x === casa.x && y === casa.y) return 'jugador'
  return (i.rivales[k] && i.rivales[k].señor) || null
}

/**
 * Lo que el mapa 3D necesita para pintar: casilla -> color de la bandera.
 * Va también dentro de EV.IMPERIO_CAMBIADO, así el render no pregunta nada.
 */
export function coloresDelMapa () {
  const i = imp()
  const out = {}
  if (!i) return out
  const casa = casaDelMapa()
  out[clave(casa.x, casa.y)] = i.color
  for (const k of Object.keys(i.plazas)) out[k] = i.color
  for (const k of Object.keys(i.rivales)) {
    const s = i.señores[i.rivales[k].señor]
    if (s) out[k] = s.color
  }
  return out
}

/** ¿Toca tu frontera? Devuelve el porqué, que es lo que lee la interfaz. */
export function alcanzable (x, y) {
  if (!dentroMundo(x, y)) return { ok: false, motivo: 'Eso ya no es el valle' }
  const casa = casaDelMapa()
  if (cheb(x, y, casa.x, casa.y) <= RADIO_CAPITAL) {
    return { ok: true, motivo: 'A tiro desde tu valle' }
  }
  for (const p of plazas()) {
    if (cheb(x, y, p.x, p.y) <= RADIO_PLAZA) {
      return { ok: true, motivo: `Sales desde ${p.nombre}` }
    }
  }
  const puente = puenteHacia(x, y)
  return {
    ok: false,
    motivo: 'Fuera de tu alcance',
    puente,
    sugerencia: puente
      ? `Fuera de tu alcance: conquista antes ${puente.nombre}`
      : 'Fuera de tu alcance: acerca tu frontera antes de mirar tan lejos'
  }
}

/** La plaza conquistable que más te acerca a un objetivo lejano. */
function puenteHacia (x, y) {
  let mejor = null
  let mejorD = Infinity
  for (const e of Rivales.todosLosRivales()) {
    if (e.conquistado) continue
    if (!alcanzableBruto(e.x, e.y)) continue
    const d = cheb(e.x, e.y, x, y)
    if (d < mejorD) { mejorD = d; mejor = e }
  }
  return mejor ? { x: mejor.x, y: mejor.y, nombre: mejor.nombre, id: mejor.id } : null
}

/** Versión sin explicaciones, para los bucles. */
function alcanzableBruto (x, y) {
  const casa = casaDelMapa()
  if (cheb(x, y, casa.x, casa.y) <= RADIO_CAPITAL) return true
  const i = imp()
  if (!i) return false
  for (const k of Object.keys(i.plazas)) {
    const p = i.plazas[k]
    if (cheb(x, y, p.x, p.y) <= RADIO_PLAZA) return true
  }
  return false
}

/**
 * TODO lo conquistable del valle con su etiqueta de alcance. Lo que la
 * interfaz necesita para pintar «atacable» y «fuera de tu alcance».
 * @returns {Array<{x:number,y:number,id:string,nombre:string,nivel:number,paso:string,alcanzable:boolean,motivo:string,sugerencia:string|null}>}
 */
export function objetivosAlcanzables () {
  const fuera = []
  for (const e of Rivales.todosLosRivales()) {
    if (e.conquistado) continue
    const a = alcanzable(e.x, e.y)
    fuera.push({
      x: e.x,
      y: e.y,
      id: e.id,
      nombre: e.nombre,
      comarca: nombreDe(e.x, e.y),
      nivel: e.nivel || 1,
      poder: e.poder || 0,
      señor: e.señor || null,
      descubierto: !!e.descubierto,
      // el escalón en el que está: primero se le somete, después se le toma
      paso: e.vasallo ? 'conquistar' : 'someter',
      vasallo: !!e.vasallo,
      alcanzable: a.ok,
      motivo: a.motivo,
      sugerencia: a.ok ? null : a.sugerencia
    })
  }
  return fuera.sort((a, b) => (b.alcanzable - a.alcanzable) || (a.nivel - b.nivel))
}

// ---------------------------------------------------------------- renta ---

/** Qué recurso pega con esta comarca: lo que hay en ella manda sobre el bioma. */
const SESGO_NODO = {
  bosque_viejo: 'madera', cantera: 'piedra', veta_oro: 'oro',
  campo_fertil: 'comida', ruinas: 'oro', aldea_abandonada: null
}
const SESGO_BIOMA = {
  bosque: 'madera', colinas: 'piedra', montaña: 'piedra',
  llanura: 'comida', costa: 'comida', paramo: 'oro', pantano: null, agua: null
}

/** Lo que da una plaza por minuto, ella sola, antes de mermas y topes. */
function rentaDe (plaza, aldea = produccionAldea()) {
  const n = nodoEn(plaza.x, plaza.y)
  const t = tileEn(plaza.x, plaza.y)
  const sesgo = (n && SESGO_NODO[n.tipo] !== undefined ? SESGO_NODO[n.tipo] : null) ||
    (t ? SESGO_BIOMA[t.bioma] : null)
  // el escalón de la plaza manda; el señorío que le quitaste solo matiza
  const escala = (1 + FACTOR_NIVEL * (Math.max(1, plaza.nivel || 1) - 1)) *
    (1 + 0.06 * (Math.max(1, plaza.nivelRival || 1) - 1)) *
    (plaza.estado === 'asediada' ? 0.5 : 1)

  const sumaAldea = RECURSOS.reduce((a, k) => a + (aldea[k] || 0), 0)
  const suelo = RECURSOS.reduce((a, k) => a + (RENTA_BASE[k] || 0), 0) * escala
  const bruto = Math.max(suelo, sumaAldea * CUOTA_POR_PLAZA * escala)

  // el total se reparte con el sesgo de la comarca: en bosque, madera
  const peso = {}
  let suma = 0
  for (const k of RECURSOS) {
    peso[k] = (RENTA_BASE[k] || 0) * (!sesgo ? 1 : (sesgo === k ? SESGO : SESGO_POBRE))
    suma += peso[k]
  }
  const r = {}
  for (const k of RECURSOS) r[k] = Math.round((bruto * peso[k] / (suma || 1)) * 100) / 100
  return r
}

/**
 * Lo que entra por minuto por TODO el imperio, ya con el freno puesto.
 * @returns {{madera:number,piedra:number,comida:number,oro:number}}
 */
export function produccionImperio () {
  const lista = plazas()
  const total = { madera: 0, piedra: 0, comida: 0, oro: 0 }
  if (!lista.length) return total
  const aldea = produccionAldea()
  for (const p of lista) {
    const r = rentaDe(p, aldea)
    for (const k of RECURSOS) total[k] += r[k] || 0
  }
  // administrar lejos cuesta: cada plaza de más rinde un poco menos
  const merma = 1 / (1 + MERMA_POR_PLAZA * (lista.length - 1))
  for (const k of RECURSOS) total[k] *= merma

  // techo duro: tu aldea siempre es la que manda en tu economía
  const sumaAldea = RECURSOS.reduce((a, k) => a + (aldea[k] || 0), 0)
  const suma = RECURSOS.reduce((a, k) => a + total[k], 0)
  if (sumaAldea > 0 && suma > sumaAldea * TOPE_SOBRE_ALDEA) {
    const f = (sumaAldea * TOPE_SOBRE_ALDEA) / suma
    for (const k of RECURSOS) total[k] *= f
  }
  for (const k of RECURSOS) total[k] = Math.round(total[k] * 10) / 10
  return total
}

/** Decimales sueltos entre tick y tick. Fuera del estado: no son progreso. */
const pendiente = { madera: 0, piedra: 0, comida: 0, oro: 0 }

/** Cobra lo producido desde la última vez. Por reloj real: también offline. */
function cobrarRenta (ahora) {
  const i = imp()
  if (!i || !Object.keys(i.plazas).length) { if (i) i.ultimaRenta = ahora; return }
  const transcurrido = Math.min(Math.max(0, ahora - (i.ultimaRenta || ahora)), TOPE_OFFLINE)
  i.ultimaRenta = ahora
  if (transcurrido < 1000) return

  const pm = produccionImperio()
  const minutos = transcurrido / MINUTO
  const entrega = {}
  let algo = 0
  for (const k of RECURSOS) {
    const acumulado = pendiente[k] + (pm[k] || 0) * minutos
    const enteros = Math.floor(acumulado + 1e-9)
    pendiente[k] = acumulado - enteros
    if (enteros > 0) { entrega[k] = enteros; algo += enteros }
  }
  if (algo) ingresar(entrega, 'rentas del imperio')
}

// ------------------------------------------------------------ guarnición ---

/** La gente de la propia plaza: se queda tras la conquista y se repone sola. */
function milicia (nivel = 1, nivelRival = 1) {
  const n = Math.max(1, Math.round(1 + nivel * 1.6 + nivelRival * 0.45))
  const g = { lancero: n }
  if (nivel >= 2 || nivelRival >= 4) g.arquero = Math.max(1, Math.round(n * 0.6))
  if (nivel >= 4) g.espadachin = Math.max(1, Math.round(n * 0.4))
  return g
}

/**
 * Lo que aguanta una plaza: su gente MÁS los muros que le tomaste. Al
 * conquistar una plaza fuerte te quedas con sus defensas, y eso es justo lo
 * que hace que valga la pena tomar la buena y no la fácil. Sin esta parte, el
 * banco enseñaba una puerta giratoria: nueve plazas perdidas en un mes.
 */
const MUROS_HEREDADOS = 70
export function poderPlaza (plaza) {
  if (!plaza) return 0
  const tropa = Rivales.poderTropas(plaza.guarnicion || {})
  const muros = MUROS_HEREDADOS * Math.max(1, plaza.nivelRival || 1)
  return Math.round((tropa + muros) * (1 + 0.3 * (Math.max(1, plaza.nivel || 1) - 1)))
}

/** Repone la milicia caída, poco a poco. La tropa que mandaste tú no se repone. */
function reponerMilicias (ahora) {
  for (const p of plazas()) {
    if (ahora - (p.ultimoRefuerzo || 0) < REFUERZO_CADA) continue
    p.ultimoRefuerzo = ahora
    const plantilla = p.plantilla || milicia(p.nivel, p.nivelRival)
    let completa = true
    for (const [tipo, tope] of Object.entries(plantilla)) {
      const hay = (p.guarnicion && p.guarnicion[tipo]) || 0
      if (hay >= tope) continue
      if (!p.guarnicion) p.guarnicion = {}
      p.guarnicion[tipo] = Math.min(tope, hay + Math.max(1, Math.round(tope * REFUERZO_FRACCION)))
      if (p.guarnicion[tipo] < tope) completa = false
    }
    // con el muro otra vez guarnecido se levanta el asedio y vuelve a rendir entera
    if (completa && p.estado === 'asediada') { p.estado = 'mia'; cambio('asedio-levantado') }
  }
}

/**
 * Manda tropa de tu ejército a defender una plaza. Sale de casa: deja de
 * contar para tus asaltos, que es justo la decisión interesante.
 * @returns {{ok:boolean, motivo:string, guarnicion?:any}}
 */
export function reforzarPlaza (x, y, tropas) {
  const p = plazaEn(x, y)
  if (!p) return { ok: false, motivo: 'Esa plaza no es tuya' }
  const s = game.state
  const mias = (s.ejercito && s.ejercito.tropas) || {}
  const movidas = {}
  let total = 0
  for (const [tipo, cant] of Object.entries(tropas || {})) {
    const n = Math.min(Math.max(0, Math.round(cant) || 0), mias[tipo] || 0)
    if (n <= 0) continue
    mias[tipo] -= n
    if (!mias[tipo]) delete mias[tipo]
    if (!p.guarnicion) p.guarnicion = {}
    p.guarnicion[tipo] = (p.guarnicion[tipo] || 0) + n
    movidas[tipo] = n
    total += n
  }
  if (!total) return { ok: false, motivo: 'No tienes esa tropa en casa' }
  toast(`🛡️ ${total} a la guarnición de ${p.nombre}`, 'bien')
  cambio('refuerzo')
  return { ok: true, motivo: 'Guarnición reforzada', guarnicion: { ...p.guarnicion }, movidas }
}

// ---------------------------------------------------------------- mejora ---

/** Lo que cuesta subir un escalón esta plaza. */
export function costeMejora (x, y) {
  const p = plazaEn(x, y)
  if (!p) return null
  if ((p.nivel || 1) >= NIVEL_MAX_PLAZA) return null
  const f = Math.pow(COSTE_CRECE, (p.nivel || 1) - 1)
  const c = {}
  for (const k of RECURSOS) c[k] = Math.round((COSTE_MEJORA[k] || 0) * f)
  return c
}

/**
 * Subir una plaza: más renta y más milicia. Es donde se reinvierte lo que
 * produce el imperio, para no tener que conquistar sin parar.
 * @returns {{ok:boolean, motivo:string, plaza?:any, coste?:any}}
 */
export function mejorarPlaza (x, y) {
  const p = plazaEn(x, y)
  if (!p) return { ok: false, motivo: 'Esa plaza no es tuya' }
  if ((p.nivel || 1) >= NIVEL_MAX_PLAZA) return { ok: false, motivo: 'Ya está en su mejor momento' }
  const coste = costeMejora(x, y)
  if (banco && typeof banco.puedePagar === 'function') {
    if (!banco.puedePagar(coste)) {
      if (typeof banco.faltaPara === 'function') events.emit(EV.RESOURCE_DENIED, { falta: banco.faltaPara(coste) })
      return { ok: false, motivo: 'No hay con qué pagarlo', coste }
    }
    banco.pagar(coste, `mejorar ${p.nombre}`)
  } else {
    const s = game.state
    for (const k of RECURSOS) if ((s.recursos[k] || 0) < (coste[k] || 0)) return { ok: false, motivo: 'No hay con qué pagarlo', coste }
    for (const k of RECURSOS) s.recursos[k] -= (coste[k] || 0)
  }

  p.nivel = Math.min(NIVEL_MAX_PLAZA, (p.nivel || 1) + 1)
  p.plantilla = milicia(p.nivel, p.nivelRival)
  // la gente nueva llega ya: mejorar tiene que notarse al momento
  for (const [tipo, n] of Object.entries(p.plantilla)) {
    p.guarnicion[tipo] = Math.max(p.guarnicion[tipo] || 0, n)
  }
  p.produce = rentaDe(p)
  toast(`🏯 ${p.nombre} sube a nivel ${p.nivel}: más renta y más gente en el muro`, 'bien')
  cambio('mejora')
  return { ok: true, motivo: 'Plaza mejorada', plaza: p, coste }
}

// ------------------------------------------------------------ conquista ---

/** Parcelas que sim/buildings.js ha dejado libres por una comarca concreta. */
const ofertasPorComarca = {}

/**
 * LA PLAZA CAMBIA DE BANDERA. Lo llama world/enemies.js cuando le ganas del
 * todo a un rival (a un vasallo tuyo, que es el segundo escarmiento).
 * @returns {any|null} la plaza ya tuya
 */
export function conquistar (rival, motivo = 'asalto') {
  if (!rival || !Number.isFinite(rival.x)) return null
  const i = imp()
  const k = clave(rival.x, rival.y)
  if (i.plazas[k]) return i.plazas[k]

  const plaza = {
    x: rival.x,
    y: rival.y,
    nombre: nombreDe(rival.x, rival.y),
    señorPrevio: rival.nombre || null,
    rivalId: rival.id || null,
    nivel: 1,
    nivelRival: rival.nivel || 1,
    desde: Date.now(),
    estado: 'mia',
    guarnicion: milicia(1, rival.nivel || 1),
    ultimoRefuerzo: Date.now(),
    parcela: ofertasPorComarca[k] || null,
    motivo
  }
  plaza.plantilla = { ...plaza.guarnicion }
  plaza.produce = rentaDe(plaza)

  i.plazas[k] = plaza
  i.conquistadas++
  // si era de un señor, su bandera se retira de esa casilla
  const eraDe = i.rivales[k] ? i.rivales[k].señor : null
  delete i.rivales[k]
  Rivales.marcarConquistado(rival)

  // una plaza tuya alumbra su comarca: se acabó la niebla ahí
  descubrir(rival.x, rival.y, 1)

  events.emit(EV.PLAZA_CONQUISTADA, {
    x: plaza.x,
    y: plaza.y,
    plaza,
    color: i.color,
    señorPrevio: plaza.señorPrevio,
    eraDe,
    total: Object.keys(i.plazas).length,
    produccion: produccionImperio(),
    texto: `🚩 ${plaza.nombre} es tuya. Su gente trabaja ahora para tu baluarte.`
  })
  events.emit(EV.SFX, { nombre: 'listo' })
  toast(`🚩 ${plaza.nombre} pasa a tu bandera: renta cada minuto y desde ahí alcanzas a sus vecinos`, 'bien')
  cambio('conquista')

  // la comarca ganada es lo que abre la linde de tu aldea en esa dirección
  if (plaza.parcela) events.emit(EV.TERRITORIO_RECLAMAR, { parcela: plaza.parcela })
  return plaza
}

/**
 * Te la quitan. La plaza vuelve a manos del señor que la tomó (o a nadie) y
 * su gente se queda dentro: conquistar no puede ser un billete de ida.
 */
export function perderPlaza (x, y, señorId = null, texto = null) {
  const i = imp()
  const k = clave(x, y)
  const p = i.plazas[k]
  if (!p) return false
  delete i.plazas[k]
  i.perdidas++
  if (señorId && i.señores[señorId]) i.rivales[k] = { señor: señorId, desde: Date.now() }

  const rival = (p.rivalId && Rivales.rivalPorId(p.rivalId)) || Rivales.rivalEn(x, y)
  if (rival) Rivales.devolverPlaza(rival, señorId)

  const señor = señorId ? i.señores[señorId] : null
  events.emit(EV.PLAZA_PERDIDA, {
    x,
    y,
    plaza: p,
    señor: señorId,
    nombreSeñor: señor ? señor.nombre : null,
    color: señor ? señor.color : null,
    total: Object.keys(i.plazas).length,
    texto: texto || `🏴 Has perdido ${p.nombre}${señor ? `: la bandera de ${señor.nombre} ondea allí` : ''}.`
  })
  toast(texto || `🏴 ${p.nombre} ya no es tuya. Se defiende lo que se quiere conservar.`, 'mal')
  cambio('perdida')
  return true
}

// ------------------------------------------------ los rivales se expanden ---

/**
 * El mapa está vivo aunque juegues solo: cada cierto rato un señor rival se
 * queda con una plaza neutral vecina o, si la ve floja, con una tuya.
 */
function expansionRival (ahora) {
  const i = imp()
  if (!i) return
  if (ahora < (i.proximaExpansion || 0)) return
  const rng = makeRng((((game.state.seed >>> 0) ^ ((i.expansionSeq = (i.expansionSeq || 0) + 1) * 0x9e3779b1)) >>> 0) || 1)
  i.proximaExpansion = ahora + EXPANSION_CADA + rng.float(0, EXPANSION_AZAR)

  nombrarSeñores()
  const señores = Object.values(i.señores)
  if (!señores.length) return

  const señor = rng.pick(señores)
  const suyas = dominioDe(señor.id)
  if (!suyas.length) return
  const cerca = (x, y) => suyas.some(s => cheb(s.x, s.y, x, y) <= RADIO_RIVAL)

  // 1) ¿tienes tú algo cerca y mal defendido? eso es lo goloso
  const empuje = poderSeñor(señor.id)
  const mias = plazas().filter(p => cerca(p.x, p.y))
  const floja = mias.slice().sort((a, b) => poderPlaza(a) - poderPlaza(b))[0]
  // una plaza bien guarnecida ni se la miran: se van a por algo más fácil
  if (floja && rng.chance(0.6) && poderPlaza(floja) < empuje * 1.25) {
    if (poderPlaza(floja) < empuje * MARGEN_DEFENSA) {
      perderPlaza(floja.x, floja.y, señor.id,
        `🏴 ${señor.nombre} ha entrado en ${floja.nombre}: la guarnición no dio para tanto.`)
      return
    }
    // aguantó: queda ASEDIADA (produce la mitad) hasta que se rehaga la guarnición
    floja.estado = 'asediada'
    for (const tipo of Object.keys(floja.guarnicion || {})) {
      floja.guarnicion[tipo] = Math.max(0, floja.guarnicion[tipo] - Math.max(1, Math.round(floja.guarnicion[tipo] * 0.25)))
      if (!floja.guarnicion[tipo]) delete floja.guarnicion[tipo]
    }
    toast(`⚔️ ${señor.nombre} ha probado ${floja.nombre} y ha rebotado. La guarnición ha pagado el gusto.`, 'info')
    cambio('asedio')
    return
  }

  // 2) si no, se come a un vecino neutral: su color crece por el mapa. Se mira
  // primero lo pegado a su bandera y, si no hay nada, un poco más lejos: un
  // señor que no puede crecer deja el mapa muerto, que es justo lo que se evita.
  let neutrales = []
  for (let radio = RADIO_RIVAL; radio <= RADIO_RIVAL + 2 && !neutrales.length; radio++) {
    neutrales = Rivales.todosLosRivales().filter(e =>
      !e.conquistado && !e.criado && !e.señor && !esMia(e.x, e.y) &&
      suyas.some(s => cheb(s.x, s.y, e.x, e.y) <= radio))
  }
  if (!neutrales.length) return
  const presa = rng.pick(neutrales)
  presa.señor = señor.id
  i.rivales[clave(presa.x, presa.y)] = { señor: señor.id, desde: ahora }
  Rivales.absorberRival(presa, señor)

  if ((game.state.world.descubierto || {})[clave(presa.x, presa.y)]) {
    toast(`🏴 ${señor.nombre} se ha quedado con ${nombreDe(presa.x, presa.y)}. Su bandera se extiende.`, 'mal')
  }
  cambio('expansion-rival')
}

/**
 * La hueste que un señor manda a una plaza: NO su imperio entero, sino lo que
 * da de sí una de sus plazas, con un punto más por cada bandera que ya tiene.
 * Si se suma todo su dominio, el que va ganando se vuelve imparable y el mapa
 * deja de ser un tira y afloja para ser una apisonadora (medido con el banco).
 */
function poderSeñor (id) {
  const suyas = dominioDe(id)
  let poder = 0
  let n = 0
  for (const p of suyas) {
    const e = Rivales.rivalEn(p.x, p.y)
    if (e) { poder += e.poder || 0; n++ }
  }
  if (!n) return 150
  return Math.max(150, Math.round((poder / n) * 0.55 * (1 + 0.08 * (n - 1))))
}

// --------------------------------------------------------------- resumen ---

/**
 * QUE CRECER SE NOTE. Todo lo que la interfaz necesita para enseñar de un
 * vistazo cuánto has crecido y por dónde vas frente a los señores del valle.
 */
export function resumenImperio () {
  const i = imp()
  const lista = plazas()
  const pm = produccionImperio()
  const aldea = produccionAldea()
  const trib = Rivales.imperio()

  const sumaPm = RECURSOS.reduce((a, k) => a + (pm[k] || 0), 0)
  const sumaAldea = RECURSOS.reduce((a, k) => a + (aldea[k] || 0), 0)

  // tabla de poder: tú y los señores con nombre, ordenados por lo que pesan
  const tabla = [{
    id: 'jugador',
    nombre: (game.state.jugador && game.state.jugador.nombre) || 'Tú',
    eresTu: true,
    color: i.color,
    plazas: lista.length,
    comarcas: 1 + lista.length,
    poder: Math.round(Rivales.poderJugadorActual() + lista.length * 160)
  }]
  for (const s of Object.values(i.señores)) {
    const suyas = dominioDe(s.id)
    tabla.push({
      id: s.id,
      nombre: s.nombre,
      eresTu: false,
      color: s.color,
      plazas: suyas.length,
      comarcas: suyas.length,
      poder: Math.round(poderSeñor(s.id) + suyas.length * 160)
    })
  }
  tabla.sort((a, b) => (b.plazas - a.plazas) || (b.poder - a.poder))
  const puesto = tabla.findIndex(t => t.eresTu) + 1

  const objetivos = objetivosAlcanzables()
  return {
    color: i.color,
    plazas: lista.length,
    comarcas: 1 + lista.length,          // tu valle y cada plaza tomada
    conquistadas: i.conquistadas,
    perdidas: i.perdidas,
    nivelMedio: lista.length ? Math.round((lista.reduce((a, p) => a + (p.nivel || 1), 0) / lista.length) * 10) / 10 : 0,
    produccion: pm,
    produccionTotal: Math.round(sumaPm * 10) / 10,
    produccionAldea: Math.round(sumaAldea * 10) / 10,
    // la cifra honrada: cuánto suma el imperio sobre lo que da tu aldea
    porcentajeSobreAldea: sumaAldea > 0 ? Math.round((sumaPm / sumaAldea) * 100) : 0,
    vasallos: trib.vasallos,
    tributoDia: trib.tributoDia,
    tributoDiaTotal: trib.tributoDiaTotal,
    guarnicion: lista.reduce((a, p) => a + Object.values(p.guarnicion || {}).reduce((x, y) => x + y, 0), 0),
    alAlcance: objetivos.filter(o => o.alcanzable).length,
    fueraDeAlcance: objetivos.filter(o => !o.alcanzable).length,
    señores: tabla,
    puesto,
    lista: lista.map(p => ({
      x: p.x,
      y: p.y,
      nombre: p.nombre,
      nivel: p.nivel,
      estado: p.estado,
      desde: p.desde,
      produce: rentaDe(p, aldea),
      guarnicion: { ...(p.guarnicion || {}) },
      poder: poderPlaza(p),
      mejora: costeMejora(p.x, p.y)
    }))
  }
}

/** Un solo sitio que avisa al mapa 3D de que hay que repintar banderas. */
function cambio (motivo = 'cambio') {
  const i = imp()
  if (!i) return
  events.emit(EV.IMPERIO_CAMBIADO, {
    motivo,
    color: i.color,
    plazas: plazas().map(p => ({ x: p.x, y: p.y, nivel: p.nivel, nombre: p.nombre, estado: p.estado })),
    rivales: Object.keys(i.rivales).map(k => {
      const c = k.split(',')
      const s = i.señores[i.rivales[k].señor]
      return { x: Number(c[0]), y: Number(c[1]), señor: i.rivales[k].señor, color: s ? s.color : null }
    }),
    colores: coloresDelMapa(),
    resumen: resumenImperio()
  })
}

// -------------------------------------------------------------- arranque ---

let acumulado = 0

function alTick (p) {
  acumulado += (p && p.dt) ? p.dt : 0.25
  if (acumulado < 5) return
  acumulado = 0
  const ahora = Date.now()
  // Va en el tick y no solo al cargar: si un señor se queda sin tierra hay que
  // relevarlo EN LA PARTIDA, no al abrirla, o guardar y cargar cambiaría el estado.
  nombrarSeñores()
  cobrarRenta(ahora)
  reponerMilicias(ahora)
  expansionRival(ahora)
}

export async function init () {
  banco = await cargarBanco()
  asegurar()
  nombrarSeñores()

  // enemies.js no nos importa a nosotros: se le pasa el brazo y lo usa si está.
  Rivales.registrarImperio({
    alcanzable,
    alcanzableBruto,
    conquistar,
    esMia,
    plazas,
    dueñoDe
  })

  events.on(EV.STATE_LOADED, () => {
    asegurar()
    nombrarSeñores()
    cambio('partida-cargada')
  })
  events.on(EV.TICK, alTick)

  // sim/buildings.js deja libre la linde de la aldea al ganar una comarca:
  // se apunta cuál para que la conquista de la plaza sea lo que planta la bandera
  events.on(EV.TERRITORIO_DISPONIBLE, (p) => {
    if (!p || p.motivo !== 'conquista' || !p.origen) return
    if (!Number.isFinite(p.origen.x) || !Number.isFinite(p.origen.y)) return
    ofertasPorComarca[clave(p.origen.x, p.origen.y)] = p.parcela
  })

  // el valle puede poblarse después que nosotros: en cuanto haya rivales, señores
  events.on(EV.WORLD_REVEALED, () => {
    if (!Object.keys(imp().señores).length) nombrarSeñores()
  })

  cambio('arranque')
}
