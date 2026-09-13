import { game } from '../core/state.js'
import { events, EV } from '../core/events.js'
import { makeRng, uid } from '../core/rng.js'
import { CONFIG } from '../core/config.js'
import { def as defEdificio } from '../data/buildings.js'
import { nombreAldeano } from '../data/names.js'
import * as mapa from './map.js'
import { pagar, puedePagar, ingresar, ingresarVarios, gemas as moverGemas } from '../sim/resources.js'

/**
 * EXPEDICIONES: la tercera pata del juego (construir / explorar / atacar).
 * Mandas a un aldeano al mapa del mundo, cierras el móvil y al rato vuelve
 * con noticias. Todo se resuelve contra Date.now(), así que la expedición
 * avanza igual con el juego cerrado.
 *
 * Este módulo solo escribe en game.state.expediciones. Los recursos entran por
 * sim/resources.js, el mapa se toca por la API de world/map.js y el aldeano se
 * pide y se devuelve por eventos: aquí nadie le cambia el estado a nadie.
 *
 * El informe de vuelta es lo mejor del módulo: si no apetece leerlo, no apetece
 * mandar otra expedición.
 */

// ------------------------------------------------------------------ misiones

export const MISIONES = {
  explorar: {
    nombre: 'Explorar',
    icono: '🧭',
    desc: 'Levantar la niebla y ver qué hay detrás de la loma.',
    factorTiempo: 1.0,
    factorComida: 1.0,
    riesgoExtra: 0
  },
  recolectar: {
    nombre: 'Recolectar',
    icono: '🎒',
    desc: 'Traerse a hombros lo que dé un yacimiento.',
    factorTiempo: 1.25,
    factorComida: 1.15,
    riesgoExtra: 0.02
  },
  espiar: {
    nombre: 'Espiar',
    icono: '👁️',
    desc: 'Contar cuántos son y con qué duermen antes de atacar.',
    factorTiempo: 0.9,
    factorComida: 1.1,
    riesgoExtra: 0.06
  },
  saquear: {
    nombre: 'Saquear',
    icono: '🗡️',
    desc: 'Un pellizco rápido sin dar batalla. Sale bien… casi siempre.',
    factorTiempo: 1.1,
    factorComida: 1.25,
    riesgoExtra: 0.14
  }
}

export const TIPOS_MISION = Object.keys(MISIONES)

const MAX_HISTORIAL = 12          // informes viejos que se guardan para releer
const TOPE_SEGUNDOS = 1800        // ninguna salida pasa de media hora
const MINUTO = 60000

// --------------------------------------------------- envoltorios sobre map.js
// map.js lo escribe otro módulo: si una función aún no está, aquí no se rompe nada.

const casaMundo = () => (game.state.world && game.state.world.casa) || { x: 8, y: 8 }

const distancia = (x, y) => typeof mapa.distanciaACasa === 'function'
  ? mapa.distanciaACasa(x, y)
  : Math.hypot(x - casaMundo().x, y - casaMundo().y)

const tileEn = (x, y) => typeof mapa.tileEn === 'function' ? mapa.tileEn(x, y) : null
const nodoEn = (x, y) => typeof mapa.nodoEn === 'function' ? mapa.nodoEn(x, y) : null

const visible = (x, y) => typeof mapa.visible === 'function'
  ? mapa.visible(x, y)
  : !!(game.state.world && game.state.world.descubierto && game.state.world.descubierto[`${x},${y}`])

const dentro = (x, y) => {
  if (typeof mapa.dentroMundo === 'function') return mapa.dentroMundo(x, y)
  const w = game.state.world
  return !!w && x >= 0 && y >= 0 && x < (w.ancho || 17) && y < (w.alto || 17)
}

function descubrir (x, y, radio) {
  if (typeof mapa.descubrir !== 'function') return { tiles: [], nodos: [] }
  return mapa.descubrir(x, y, radio) || { tiles: [], nodos: [] }
}

function recolectarNodo (id, cantidad) {
  if (typeof mapa.recolectarNodo !== 'function') return { ok: false, dado: 0 }
  return mapa.recolectarNodo(id, cantidad) || { ok: false, dado: 0 }
}

/** Segundos de la salida entera (ida y vuelta): 30 s la casilla de al lado, ~25 min el confín. */
function viajeCompleto (x, y, velocidad) {
  if (typeof mapa.tiempoViaje === 'function') return mapa.tiempoViaje(x, y, velocidad)
  const d = distancia(x, y)
  return Math.round(Math.min(1500, Math.max(25, 30 * Math.pow(d, 1.61) / Math.max(0.2, velocidad))))
}

/** Misma escala de dificultad que usa el mapa al sembrar nodos. */
function dificultadPorDistancia (d) {
  if (d <= 2.2) return 1
  if (d <= 4.2) return 2
  if (d <= 6.2) return 3
  if (d <= 8.5) return 4
  return 5
}

const costeTerreno = (x, y) => {
  const t = tileEn(x, y)
  const b = t && mapa.BIOMAS ? mapa.BIOMAS[t.bioma] : null
  return b ? b.coste : 1.15
}

const nombreDe = (x, y) => {
  const t = tileEn(x, y)
  return t && t.nombre ? t.nombre : 'un lugar sin nombre'
}

/** Lo que aún está en la niebla no tiene nombre, pero sí rumbo. */
function rumbo (x, y) {
  const c = casaMundo()
  const dx = x - c.x
  const dy = y - c.y
  const v = Math.abs(dy) > Math.abs(dx) * 1.8 ? (dy < 0 ? 'norte' : 'sur')
    : Math.abs(dx) > Math.abs(dy) * 1.8 ? (dx < 0 ? 'oeste' : 'este')
      : (dy < 0 ? (dx < 0 ? 'noroeste' : 'noreste') : (dx < 0 ? 'suroeste' : 'sureste'))
  return `la niebla del ${v}`
}

// ------------------------------------------------------------- el campamento

function campamento () {
  const bs = game.state.buildings || []
  return bs.find(b => b && b.tipo === 'campamento_explorador' && !b.enObra && !b.arruinado && b.nivel > 0) || null
}

export function nivelCampamento () {
  const b = campamento()
  return b ? (b.nivel || 1) : 0
}

/** Bonos permanentes de las tecnologías de exploración ya investigadas. */
function bonoTech (objetivo) {
  const r = game.state.research || {}
  let v = 0
  if (objetivo === 'alcance' && r.mapas_pergamino) v += 0.20
  if (objetivo === 'velocidad' && r.caballo_refresco) v += 0.30
  return v
}

/** @returns {number} expediciones simultáneas que aguanta el campamento. 0 si no hay. */
export function plazas () {
  const n = nivelCampamento()
  if (!n) return 0
  const d = defEdificio('campamento_explorador')
  return d && typeof d.exploradores === 'function' ? Math.max(1, d.exploradores(n)) : 1
}

/** Casillas de radio a las que se puede mandar gente desde la aldea. */
export function alcance () {
  const n = nivelCampamento()
  if (!n) return 0
  const d = defEdificio('campamento_explorador')
  const base = d && typeof d.alcance === 'function' ? d.alcance(n) : 6 + 3 * n
  return Math.round(base * (1 + bonoTech('alcance')))
}

/** Lo que carga un explorador a la espalda: sube mucho con el campamento. */
export function capacidadCarga () {
  const n = nivelCampamento()
  if (!n) return 0
  return Math.round(90 * Math.pow(1.5, n - 1))
}

const velocidadExplorador = () => (1 + 0.1 * Math.max(0, nivelCampamento() - 1)) * (1 + bonoTech('velocidad'))

/** Radio de niebla que levanta una expedición de exploración. */
const radioVista = () => 1 + Math.floor(nivelCampamento() / 2)

// ------------------------------------------------------------ estado y listas

function lista () {
  if (!Array.isArray(game.state.expediciones)) game.state.expediciones = []
  return game.state.expediciones
}

const fuera = () => lista().filter(e => e.estado === 'fuera')
const curandose = () => lista().filter(e => e.estado === 'herido')

/** Plazas ocupadas: los que están fuera y los que se están curando. */
const ocupadas = () => fuera().length + curandose().length

export const plazasLibres = () => Math.max(0, plazas() - ocupadas())

// ------------------------------------------------------------- estimaciones

/** @returns {number} segundos de la salida entera. */
export function tiempoDe (x, y, mision = 'explorar') {
  const f = (MISIONES[mision] || MISIONES.explorar).factorTiempo
  const seg = viajeCompleto(x, y, velocidadExplorador()) * f
  return Math.max(30, Math.min(TOPE_SEGUNDOS, Math.round(seg)))
}

/** La provisión del viaje: comida. Cuanto más lejos, más talegas. */
export function costeDe (x, y, mision = 'explorar') {
  const seg = tiempoDe(x, y, mision)
  const f = (MISIONES[mision] || MISIONES.explorar).factorComida
  return { comida: Math.max(8, Math.round((6 + seg / 60 * 3.2) * f)) }
}

/**
 * Lo que hay que enseñar ANTES de mandar a nadie: cómo de chunga es la casilla.
 * @returns {{nivel:'seguro'|'moderado'|'peligroso', prob:number, pct:number,
 *            probPerdida:number, pctPerdida:number, dificultad:number, texto:string}}
 */
export function riesgoDe (x, y, mision = 'explorar') {
  const d = distancia(x, y)
  const n = nodoEn(x, y)
  const dif = n && n.dificultad ? n.dificultad : dificultadPorDistancia(d)

  let p = 0.03 + 0.021 * d + 0.045 * (dif - 1) + (costeTerreno(x, y) - 1) * 0.12
  p += (MISIONES[mision] || MISIONES.explorar).riesgoExtra
  if (n && n.ocupado) p += 0.12            // hay bandidos acampados ahí
  if (n && n.tipo === 'pantano') p += 0.08
  // el campamento mejorado son mejores botas, mejores mapas y menos sustos
  p *= 1 - 0.05 * Math.max(0, nivelCampamento() - 1)
  p = Math.min(0.62, Math.max(0.03, p))

  // que no vuelva es raro de verdad, y saquear es lo único que lo dispara
  const perdida = Math.min(0.045, p * (mision === 'saquear' ? 0.09 : 0.05))

  const nivel = p < 0.16 ? 'seguro' : p < 0.34 ? 'moderado' : 'peligroso'
  const texto = nivel === 'seguro'
    ? 'Camino trillado: como mucho, ampollas.'
    : nivel === 'moderado'
      ? 'Hay quien no ha vuelto por menos, pero se puede.'
      : 'Tierra fea. Manda a alguien de quien te puedas despedir.'

  return {
    nivel,
    prob: p,
    pct: Math.round(p * 100),
    probPerdida: perdida,
    pctPerdida: Math.round(perdida * 1000) / 10,
    dificultad: dif,
    distancia: Math.round(d * 10) / 10,
    texto
  }
}

/** @returns {{ok:boolean, motivo:string}} por qué no se puede mandar esta expedición. */
export function puedeEnviar ({ x, y, mision = 'explorar' } = {}) {
  if (!nivelCampamento()) return { ok: false, motivo: 'Necesitas un campamento de exploradores.' }
  if (!MISIONES[mision]) return { ok: false, motivo: 'Esa misión no existe.' }
  if (!Number.isFinite(x) || !Number.isFinite(y) || !dentro(x, y)) return { ok: false, motivo: 'Ahí fuera no hay mapa.' }
  const casa = casaMundo()
  if (x === casa.x && y === casa.y) return { ok: false, motivo: 'Eso es tu propia aldea.' }
  if (plazasLibres() <= 0) {
    return { ok: false, motivo: curandose().length && !fuera().length
      ? 'Tus exploradores se están curando.'
      : 'No te quedan exploradores libres.' }
  }
  const d = distancia(x, y)
  if (d > alcance()) return { ok: false, motivo: `Demasiado lejos: tus exploradores llegan a ${alcance()} casillas.` }
  const t = tileEn(x, y)
  if (t && t.bioma === 'agua' && visible(x, y)) return { ok: false, motivo: 'Ahí solo hay agua y un explorador no es una barca.' }
  if (mision === 'recolectar') {
    const n = nodoEn(x, y)
    if (!n || !n.recurso) return { ok: false, motivo: 'Ahí no hay nada que recoger.' }
    if (n.agotado || n.restante <= 0) return { ok: false, motivo: 'Esa tierra ya está exprimida.' }
  }
  if (mision === 'espiar' && !enemigoEn(x, y)) return { ok: false, motivo: 'No hay ninguna base enemiga ahí.' }
  if (!puedePagar(costeDe(x, y, mision))) return { ok: false, motivo: 'No tienes comida para el viaje.' }
  if (!hayAldeanoLibre()) return { ok: false, motivo: 'No hay ningún aldeano libre para ir.' }
  return { ok: true, motivo: '' }
}

// ----------------------------------------------------------------- enviar

/**
 * Manda una expedición. Cobra la comida, pide un aldeano por eventos y lo anota.
 * @returns {any|null} la expedición, o null con un aviso si no se puede.
 */
export function enviar ({ x, y, mision = 'explorar' } = {}) {
  const check = puedeEnviar({ x, y, mision })
  if (!check.ok) {
    events.emit(EV.UI_TOAST, { texto: check.motivo, tipo: 'mal' })
    return null
  }

  const coste = costeDe(x, y, mision)
  if (!pagar(coste, 'expedición')) return null

  const ahora = Date.now()
  const seg = tiempoDe(x, y, mision)
  const riesgo = riesgoDe(x, y, mision)
  const nodo = nodoEn(x, y)
  const enemigo = enemigoEn(x, y)

  const exp = {
    id: uid('exp'),
    x,
    y,
    destino: { x, y },                       // el mapa lee esto al volver
    destinoNombre: visible(x, y) ? nombreDe(x, y) : rumbo(x, y),
    mision,
    estado: 'fuera',
    aldeanoId: null,
    aldeanoNombre: '',
    sale: ahora,
    llega: ahora + Math.round(seg * 0.45) * 1000,
    vuelve: ahora + seg * 1000,
    duracion: seg,
    coste,
    riesgo: riesgo.nivel,
    riesgoPct: riesgo.pct,
    riesgoProb: Math.round(riesgo.prob * 1000) / 1000,
    riesgoPerdida: Math.round(riesgo.probPerdida * 10000) / 10000,
    riesgoPerdidaPct: riesgo.pctPerdida,
    nodoId: nodo ? nodo.id : null,
    enemigoId: enemigo ? enemigo.id : null,
    semilla: semillaDe(x, y, mision, ahora),
    leido: true,
    resultado: null
  }

  const aldeano = reclutarAldeano(exp)
  exp.aldeanoId = aldeano ? aldeano.id : null
  exp.aldeanoNombre = (aldeano && aldeano.nombre) || nombreAldeano(makeRng(exp.semilla))

  lista().push(exp)
  events.emit(EV.SCOUT_SENT, { expedicion: exp })
  events.emit(EV.SFX, { nombre: 'expedicion' })
  events.emit(EV.UI_TOAST, {
    texto: `${MISIONES[mision].icono} ${exp.aldeanoNombre} sale hacia ${exp.destinoNombre}. Vuelve en ${enTexto(seg)}.`,
    tipo: 'info'
  })
  return exp
}

/** Semilla estable por expedición: la misma salida da siempre la misma historia. */
function semillaDe (x, y, mision, ahora) {
  const base = (game.state.seed >>> 0) ^ (x * 73856093) ^ (y * 19349663) ^ (mision.length * 83492791)
  return ((base ^ (ahora & 0xffffff)) >>> 0) || 1
}

// ---------------------------------------------------------------- aldeanos
// No se toca game.state.villagers: se pide por evento y el módulo de aldeanos manda.

const enExpedicion = (id) => lista().some(e => (e.estado === 'fuera' || e.estado === 'herido') && e.aldeanoId === id)

function candidatos () {
  const vs = game.state.villagers || []
  return vs.filter(v => v && !v.fuera && v.job !== 'explorador' && !enExpedicion(v.id))
}

function hayAldeanoLibre () {
  const vs = game.state.villagers || []
  if (!vs.length) return true            // aún no hay módulo de aldeanos: se apunta un voluntario
  return candidatos().length > 0
}

function reclutarAldeano (exp) {
  const libres = candidatos()
  if (!libres.length) return null
  const ocioso = libres.find(v => !v.job || v.job === 'libre' || v.job === 'ocioso' || v.job === 'vago')
  const elegido = ocioso || libres[0]
  // el aldeano deja la aldea: quien lleva su estado es sim/villagers.js
  events.emit(EV.VILLAGER_ASSIGNED, {
    villager: elegido,
    id: elegido.id,
    job: 'explorador',
    buildingId: campamento() ? campamento().id : null,
    fuera: true,
    expedicionId: exp.id
  })
  return elegido
}

function devolverAldeano (exp, { muerto = false, herido = false } = {}) {
  if (!exp.aldeanoId) return
  events.emit(EV.VILLAGER_ASSIGNED, {
    id: exp.aldeanoId,
    job: muerto ? 'perdido' : 'libre',
    buildingId: null,
    fuera: false,
    muerto,
    herido,
    expedicionId: exp.id
  })
}

// ------------------------------------------------------------ la vuelta a casa

function alTick () {
  const ahora = Date.now()
  const exps = lista()
  if (!exps.length) return

  const vencidas = exps.filter(e => e.estado === 'fuera' && e.vuelve <= ahora).sort((a, b) => a.vuelve - b.vuelve)
  for (const e of vencidas) resolver(e, ahora)

  for (const e of curandose()) {
    if (e.descansoHasta && e.descansoHasta <= ahora) e.estado = 'vuelta'
  }

  if (vencidas.length) {
    podar()
    // si han vuelto varias de golpe (el móvil estaba cerrado), un solo aviso
    if (vencidas.length > 1) {
      events.emit(EV.UI_TOAST, { texto: `📜 ${vencidas.length} expediciones han vuelto. Hay informes que leer.`, tipo: 'info' })
    }
  }
}

/** Resuelve una expedición: sucesos, botín, informe y evento. */
function resolver (exp, ahora = Date.now()) {
  const rng = makeRng(exp.semilla)
  // el riesgo es el que se le enseñó al jugador al salir, no el de ahora:
  // si mientras tanto mejoras el campamento, no se le cambian las reglas a medio viaje
  const riesgo = exp.riesgoProb
    ? { nivel: exp.riesgo, prob: exp.riesgoProb, probPerdida: exp.riesgoPerdida, distancia: distancia(exp.x, exp.y) }
    : riesgoDe(exp.x, exp.y, exp.mision)
  const tarde = ahora - exp.vuelve > 45000      // volvió mientras no mirabas
  const inf = {
    tipo: 'exito',
    titulo: '',
    texto: '',
    recursos: {},
    gemas: 0,
    tilesNuevos: 0,
    hallazgos: [],
    sucesos: [],
    cuando: ahora
  }

  // --- 1) lo muy malo y raro: no vuelve ---------------------------------
  if (rng.chance(riesgo.probPerdida)) {
    exp.estado = 'perdida'
    exp.leido = false
    inf.tipo = 'perdido'
    inf.titulo = `${exp.aldeanoNombre} no ha vuelto`
    inf.texto = rng.pick([
      `Se le esperó tres días en la empalizada. De ${exp.destinoNombre} solo ha vuelto su zurrón, colgado de una rama y vacío.`,
      `Nadie sabe qué pasó en ${exp.destinoNombre}. Un pastor dice que vio humo y prefirió no acercarse.`,
      `La última huella de ${exp.aldeanoNombre} se pierde camino de ${exp.destinoNombre}. La aldea le puso una vela y siguió trabajando, que es lo que se hace.`
    ])
    inf.sucesos.push({ clave: 'perdido', texto: 'El explorador no ha regresado.' })
    exp.resultado = inf
    devolverAldeano(exp, { muerto: true })
    events.emit(EV.SCOUT_RETURNED, { expedicion: exp, hallazgo: inf, informe: inf, radio: 0 })
    events.emit(EV.UI_TOAST, { texto: `🪦 ${inf.titulo}.`, tipo: 'mal' })
    events.emit(EV.SFX, { nombre: 'malo' })
    return inf
  }

  // --- 2) lo que iba a hacer -------------------------------------------
  const partes = []
  let radio = 0
  if (exp.mision === 'explorar') radio = hacerExplorar(exp, rng, inf, partes)
  else if (exp.mision === 'recolectar') hacerRecolectar(exp, rng, inf, partes)
  else if (exp.mision === 'espiar') hacerEspiar(exp, rng, inf, partes)
  else if (exp.mision === 'saquear') hacerSaquear(exp, rng, inf, partes)

  // --- 3) lo que le pasó por el camino ----------------------------------
  const malo = rng.chance(riesgo.prob) ? sucesoMalo(exp, rng, inf, riesgo) : null
  const probBuena = Math.min(0.38, 0.10 + 0.022 * riesgo.distancia + (exp.mision === 'explorar' ? 0.05 : 0))
  const bueno = rng.chance(probBuena) ? sucesoBueno(exp, rng, inf) : null
  if (malo) partes.push(malo)
  if (bueno) partes.push(bueno)

  // --- 4) el informe -----------------------------------------------------
  const traeAlgo = Object.keys(inf.recursos).length > 0 || inf.gemas > 0 || inf.tilesNuevos > 0 ||
    !!inf.espionaje || inf.sucesos.some(s => s.clave === 'aldeano')
  inf.tipo = !traeAlgo ? 'malo' : malo ? 'regular' : 'exito'
  inf.titulo = tituloInforme(exp, inf, rng)
  inf.texto = partes.filter(Boolean).join(' ')

  const herido = inf.sucesos.some(s => s.clave === 'herido')
  exp.estado = herido ? 'herido' : 'vuelta'
  if (herido) exp.descansoHasta = ahora + rng.int(6, 18) * MINUTO
  exp.leido = false
  exp.resultado = inf
  exp.volvioEn = ahora
  devolverAldeano(exp, { herido })

  events.emit(EV.SCOUT_RETURNED, { expedicion: exp, hallazgo: inf, informe: inf, radio })
  events.emit(EV.SFX, { nombre: inf.tipo === 'malo' ? 'malo' : 'bueno' })
  if (!tarde) {
    events.emit(EV.UI_TOAST, {
      texto: `${MISIONES[exp.mision].icono} ${inf.titulo}`,
      tipo: inf.tipo === 'malo' ? 'mal' : inf.tipo === 'exito' ? 'bien' : 'info'
    })
  }
  return inf
}

// ------------------------------------------------------------ cada misión

function hacerExplorar (exp, rng, inf, partes) {
  const radio = radioVista()
  const { tiles, nodos } = descubrir(exp.x, exp.y, radio)
  inf.tilesNuevos = tiles.length
  inf.hallazgos = nodos.map(n => n.nombre || n.tipo)

  const t = tileEn(exp.x, exp.y)
  const paisaje = frasePaisaje(t, rng)
  const sitio = nombreDe(exp.x, exp.y)

  if (!tiles.length) {
    partes.push(rng.pick([
      `Vuelve de ${sitio} con cara de pocos amigos: todo eso ya estaba dibujado en tu mapa.`,
      `En ${sitio} no había nada que tu mapa no supiera. El viaje ha servido para estirar las piernas.`
    ]))
    return radio
  }

  partes.push(`${rng.pick(['Tras el robledal', 'Pasado el vado', 'Al otro lado de la loma', 'Detrás de la cortina de niebla'])} se abre ${sitio}: ${paisaje}. ${tiles.length} casillas nuevas en el mapa.`)

  if (nodos.length) {
    const enum1 = enumerar(nodos.map(n => articulo(n) + ' ' + (n.nombre || '').toLowerCase()))
    partes.push(`Y no volvió de vacío de noticias: ha visto ${enum1}.`)
    const gordo = nodos.find(n => n.tipo === 'reliquia' || n.tipo === 'veta_oro')
    if (gordo) partes.push(rng.pick([
      'Dice que lo soñó dos noches seguidas.',
      'Lo ha marcado en el mapa con una cruz y el dedo manchado de tizne.'
    ]))
  } else {
    partes.push(rng.pick([
      'Ni un alma, ni un filón, ni una liebre. Pero ya sabes lo que hay.',
      'Nada aprovechable de momento, aunque el camino queda abierto.'
    ]))
  }
  return radio
}

function hacerRecolectar (exp, rng, inf, partes) {
  const n = nodoEn(exp.x, exp.y)
  const sitio = nombreDe(exp.x, exp.y)
  if (!n || n.agotado || n.restante <= 0) {
    partes.push(`Llegó a ${sitio} y se encontró la tierra exprimida: alguien se le adelantó o el filón se secó. Ha vuelto con el saco doblado bajo el brazo.`)
    inf.tipo = 'malo'
    return
  }

  const carga = Math.max(20, Math.round(capacidadCarga() * rng.float(0.85, 1.1)))
  const cogido = recolectarNodo(n.id, carga)
  const cuanto = cogido.dado || 0

  if (n.tipo === 'aldea_abandonada' && n.botin) {
    // en las aldeas vacías se rebusca de todo un poco
    const reparto = {}
    const total = ['madera', 'piedra', 'comida', 'oro'].reduce((a, k) => a + (n.botin[k] || 0), 0) || 1
    for (const k of ['madera', 'piedra', 'comida', 'oro']) {
      const parte = Math.round(cuanto * ((n.botin[k] || 0) / total))
      if (parte > 0) reparto[k] = parte
    }
    sumar(inf, ingresarVarios(reparto, { x: exp.x, z: exp.y }))
    partes.push(`En ${sitio} solo quedaban las paredes y un gato desconfiado. Rebuscando en los pajares ha sacado ${enumerarRecursos(inf.recursos)}.`)
  } else if (n.recurso === 'gemas' || n.tipo === 'reliquia') {
    const g = Math.max(1, Math.min(n.restante + cuanto, rng.int(2, 5)))
    moverGemas(g, 'reliquia')
    inf.gemas += g
    partes.push(`Bajo las losas de ${sitio} había un relicario con ${g} gemas engarzadas. Nadie pregunta de quién era.`)
  } else if (cuanto > 0 && n.recurso) {
    const entra = ingresar(n.recurso, cuanto, { x: exp.x, z: exp.y })
    if (entra > 0) inf.recursos[n.recurso] = (inf.recursos[n.recurso] || 0) + entra
    partes.push(`${rng.pick(['Dos viajes con el carro', 'Un día entero a destajo', 'Toda la mañana rascando'])} en ${sitio} y ha entrado ${entra} de ${n.recurso}${entra < cuanto ? ' (el almacén no daba para más)' : ''}.`)
    if (cogido.agotado) partes.push(rng.pick([
      'Ha dejado el sitio pelado: tardará unas horas en volver a dar.',
      'De ahí ya no sale nada más por hoy; hay que dejarlo descansar.'
    ]))
  } else {
    partes.push(`Se plantó en ${sitio} con el saco abierto y volvió con él igual de abierto.`)
    inf.tipo = 'malo'
  }

  if (n.gemas && rng.chance(0.22)) {
    const g = Math.max(1, Math.min(n.gemas, rng.int(1, 3)))
    moverGemas(g, 'expedición')
    inf.gemas += g
    partes.push(`Entre los cascotes apareció ${g === 1 ? 'una gema' : g + ' gemas'}.`)
  }
}

function hacerEspiar (exp, rng, inf, partes) {
  const e = enemigoEn(exp.x, exp.y) || enemigoCerca(exp.x, exp.y)
  const sitio = nombreDe(exp.x, exp.y)
  if (!e) {
    partes.push(`Pasó dos noches tumbado entre los helechos de ${sitio} mirando un campamento que ya no estaba. Se habían ido antes de que llegara.`)
    inf.tipo = 'malo'
    return
  }

  const parte = parteEnemigo(e, rng)
  inf.espionaje = parte
  inf.hallazgos.push(parte.nombre)
  partes.push(`Desde un altozano sobre ${sitio} ha contado lo que hay en el campo de ${parte.nombre}: ${parte.texto}`)
  partes.push(rng.pick([
    `Su recomendación, textual: "${parte.consejo}".`,
    `Dice, y lo dice bajito: "${parte.consejo}".`
  ]))
  // que lo sepa quien lleva a los enemigos, si es que hay alguien escuchando
  events.emit(EV.WORLD_EVENT, {
    tipo: 'espiado',
    x: exp.x,
    y: exp.y,
    enemigoId: e.id || null,
    texto: `Tienes el parte de ${parte.nombre}.`,
    caduca: Date.now() + 60 * MINUTO
  })
}

function hacerSaquear (exp, rng, inf, partes) {
  const sitio = nombreDe(exp.x, exp.y)
  const e = enemigoEn(exp.x, exp.y) || enemigoCerca(exp.x, exp.y)
  const n = nodoEn(exp.x, exp.y)

  if (rng.chance(0.28)) {                     // el encontronazo: nadie ha cobrado, pero por poco
    partes.push(rng.pick([
      `Le vieron entrar en ${sitio}. Salió corriendo con dos perros detrás y las manos vacías, pero salió.`,
      `En ${sitio} había más guardia de la esperada. Ha vuelto con el jubón roto y una lección aprendida.`,
      `El golpe en ${sitio} se torció: alguien tosió cuando no debía. Volvió sin nada y con mucha prisa.`
    ]))
    inf.tipo = 'malo'
    inf.sucesos.push({ clave: 'encontronazo', texto: 'Encontronazo: el golpe se torció.' })
    return
  }

  const nivel = e ? (e.nivel || 1) : 1
  const botin = {}
  if (e) {
    const escala = Math.round(30 * nivel * rng.float(0.8, 1.4))
    botin.comida = escala
    botin.madera = Math.round(escala * 0.7)
    if (rng.chance(0.6)) botin.oro = Math.round(escala * 0.25)
    sumar(inf, ingresarVarios(botin, { x: exp.x, z: exp.y }))
    partes.push(`Entró de noche en los graneros de ${e.nombre || 'el campamento'} en ${sitio} y se llevó ${enumerarRecursos(inf.recursos)}. Cuando se den cuenta, ya estará cenando en casa.`)
  } else if (n && n.recurso && !n.agotado && n.restante > 0) {
    const cogido = recolectarNodo(n.id, Math.round(capacidadCarga() * 0.45))
    const entra = cogido.dado ? ingresar(n.recurso, cogido.dado, { x: exp.x, z: exp.y }) : 0
    if (entra > 0) inf.recursos[n.recurso] = entra
    partes.push(`Un pellizco rápido en ${sitio}: ${entra} de ${n.recurso} y a correr sin mirar atrás.`)
  } else {
    const oro = rng.int(10, 40)
    const entra = ingresar('oro', oro, { x: exp.x, z: exp.y })
    if (entra > 0) inf.recursos.oro = entra
    partes.push(`En ${sitio} no había a quién robar, así que desvalijó un carro parado al borde del camino: ${entra} de oro y una bota de vino que no ha llegado a la aldea.`)
  }
}

// ------------------------------------------------------------------ sucesos

function sucesoBueno (exp, rng, inf) {
  const cual = rng.pick(['tesoro', 'gemas', 'aldeano', 'mapa', 'reliquia'])

  if (cual === 'tesoro') {
    const oro = rng.int(30, 60) + Math.round(distancia(exp.x, exp.y) * 12)
    const entra = ingresar('oro', oro, { x: exp.x, z: exp.y })
    inf.recursos.oro = (inf.recursos.oro || 0) + entra
    inf.sucesos.push({ clave: 'tesoro', texto: `Tesoro escondido: +${entra} de oro.` })
    return rng.pick([
      `Y hay más: al apoyarse en un muro cayó una piedra suelta y detrás había una olla con ${entra} monedas. Quien la escondió no volvió a por ella.`,
      `Además trae ${entra} de oro en una bolsa de cuero que encontró bajo las raíces de un tejo. No ha preguntado de quién era.`
    ])
  }

  if (cual === 'gemas') {
    const g = rng.int(1, 4)
    moverGemas(g, 'expedición')
    inf.gemas += g
    inf.sucesos.push({ clave: 'gemas', texto: `+${g} gemas.` })
    return `En el lecho de un arroyo vio algo brillar y se mojó hasta la cintura por ${g === 1 ? 'una gema' : g + ' gemas'}. Mereció la pena.`
  }

  if (cual === 'aldeano') {
    const nombre = nombreAldeano(rng)
    // si hay módulo de aldeanos, que lo dé de alta; si no, se queda en el cuento
    events.emit(EV.VILLAGER_SPAWNED, { nombre, origen: 'expedicion', x: exp.x, z: exp.y, gratis: true })
    inf.sucesos.push({ clave: 'aldeano', texto: `${nombre} se une a la aldea.` })
    return rng.pick([
      `Vuelve acompañado: ${nombre} llevaba semanas escondido en un pajar y ha preferido tu empalizada a seguir contando estrellas. Se queda.`,
      `Trae a ${nombre}, superviviente de una aldea quemada, con lo puesto y muchas ganas de trabajar.`
    ])
  }

  if (cual === 'mapa') {
    const { tiles } = descubrir(exp.x, exp.y, radioVista() + 3)
    inf.tilesNuevos += tiles.length
    inf.sucesos.push({ clave: 'mapa', texto: `Un mapa viejo descubre ${tiles.length} casillas.` })
    return tiles.length
      ? `Le cambió una hogaza a un buhonero por un mapa manoseado y medio comarca ha aparecido de golpe: ${tiles.length} casillas más.`
      : 'Compró un mapa a un buhonero por una hogaza. El mapa era de una comarca que ya conocías. El buhonero era listo.'
  }

  const g = rng.int(3, 7)
  moverGemas(g, 'reliquia')
  inf.gemas += g
  inf.sucesos.push({ clave: 'reliquia', texto: `Reliquia: +${g} gemas.` })
  return `Y trae envuelto en un paño el hueso de un santo que nadie sabe identificar. El cura dice que vale ${g} gemas y que no hagas preguntas.`
}

function sucesoMalo (exp, rng, inf, riesgo) {
  const opciones = ['bandidos', 'herido', 'tormenta']
  const cual = rng.pick(riesgo.nivel === 'peligroso' ? opciones : ['bandidos', 'tormenta', 'herido'])

  if (cual === 'bandidos') {
    let perdido = 0
    for (const k of Object.keys(inf.recursos)) {
      const quita = quitar(k, inf.recursos[k] * rng.float(0.3, 0.6))
      if (quita <= 0) continue
      inf.recursos[k] -= quita
      if (inf.recursos[k] <= 0) delete inf.recursos[k]
      perdido += quita
    }
    inf.sucesos.push({ clave: 'bandidos', texto: perdido ? `Bandidos: te quitan ${perdido} de carga.` : 'Bandidos en el camino.' })
    return perdido
      ? rng.pick([
        `En el vado le salieron cuatro bandidos con la cara tapada. Soltó ${perdido} de carga y siguió andando, que la vida vale más que un saco.`,
        `Los Lobos del Camino cobran peaje: ${perdido} menos en el saco y una advertencia para la próxima.`
      ])
      : 'Se cruzó con bandidos, pero como no llevaba nada encima lo dejaron pasar riéndose. Humillante y barato.'
  }

  if (cual === 'herido') {
    inf.sucesos.push({ clave: 'herido', texto: 'Vuelve herido: tardará en poder salir otra vez.' })
    return rng.pick([
      `Llegó cojeando y con un tajo en el muslo: un jabalí, dice él; una emboscada, dicen los que lo trajeron. Tardará un rato en poder salir otra vez.`,
      `Vuelve con el brazo en cabestrillo y sin ganas de contar por qué. De momento no sale de la aldea.`
    ])
  }

  for (const k of Object.keys(inf.recursos)) {
    quitar(k, inf.recursos[k])
    delete inf.recursos[k]
  }
  inf.sucesos.push({ clave: 'tormenta', texto: 'Tormenta: vuelve con las manos vacías.' })
  return rng.pick([
    'A la vuelta le pilló una tormenta que arrastró el carro río abajo. Vuelve calado, con las manos vacías y muy callado.',
    'Tres días de agua. El camino se hizo barro, el barro se hizo río y el río se quedó con todo lo que llevaba.'
  ])
}

// ------------------------------------------------------------ enemigos (leer)
// world/enemies.js es de otro módulo: aquí solo se lee lo que haya y con pinzas.

function enemigosMundo () {
  const w = game.state.world
  return w && Array.isArray(w.enemigos) ? w.enemigos : []
}

function enemigoEn (x, y) {
  return enemigosMundo().find(e => e && e.x === x && e.y === y) || null
}

function enemigoCerca (x, y, radio = 1.5) {
  return enemigosMundo().find(e => e && Math.hypot(e.x - x, e.y - y) <= radio) || null
}

/** Traduce una base enemiga a un parte que se entienda de un vistazo. */
function parteEnemigo (e, rng) {
  const nombre = e.nombre || 'una hueste sin estandarte'
  const nivel = e.nivel || 1
  const guarnicion = e.guarnicion || e.tropas || {}
  const piezas = Object.keys(guarnicion).filter(k => guarnicion[k] > 0)
  const total = piezas.reduce((a, k) => a + guarnicion[k], 0)

  const tropa = piezas.length
    ? enumerar(piezas.map(k => `${guarnicion[k]} ${k}${guarnicion[k] > 1 ? 's' : ''}`))
    : rng.pick(['cuatro gatos y un perro flaco', 'menos gente de la que aparenta el humo'])

  const defensas = e.defensas || e.torres || 0
  const muro = e.muralla ? 'muralla de piedra' : 'una empalizada de estacas'
  const botin = e.botin || e.recursos || null

  const texto = `${tropa}${defensas ? `, ${defensas} torre${defensas > 1 ? 's' : ''}` : ''} y ${muro}.` +
    (botin ? ` En los graneros: ${enumerarRecursos(botin)}.` : '')

  const fuerza = total + defensas * 3 + nivel * 2
  const consejo = fuerza > 26
    ? 'Ahí no vayas con lo que tienes, mi señor. Ahí se va con el doble.'
    : fuerza > 14
      ? 'Con una docena bien armada se les puede. Con menos, no.'
      : 'Están para caer. Mándalos ya, antes de que se refuercen.'

  return { nombre, nivel, tropa, total, defensas, texto, consejo, fuerza }
}

// ------------------------------------------------------------------ informes

function tituloInforme (exp, inf, rng) {
  const quien = exp.aldeanoNombre
  const aMedias = inf.tipo === 'regular'
  if (inf.tipo === 'malo') return `${quien} vuelve con las manos vacías`
  const carga = enumerarRecursos(inf.recursos)
  if (exp.mision === 'explorar') {
    if (!inf.tilesNuevos) return `${quien} vuelve de ${exp.destinoNombre}`
    return aMedias
      ? `${quien} trae ${inf.tilesNuevos} casillas nuevas y un susto`
      : `${quien} trae ${inf.tilesNuevos} casillas nuevas`
  }
  if (exp.mision === 'recolectar') {
    if (!carga && !inf.gemas) return `${quien} vuelve de ${exp.destinoNombre}`
    return aMedias ? `${quien} salva ${carga || inf.gemas + ' gemas'}` : `${quien} trae ${carga || inf.gemas + ' gemas'}`
  }
  if (exp.mision === 'espiar') return aMedias ? `Parte de ${exp.destinoNombre}, y a duras penas` : `Parte de ${exp.destinoNombre}`
  if (!carga) return `${quien} vuelve de ${exp.destinoNombre}`
  return aMedias ? `Botín a medias: ${carga}` : `Golpe limpio: ${carga}`
}

/** Quita carga por la API del banco sin pedir más de lo que hay: nada de avisos falsos. */
function quitar (tipo, cantidad) {
  const hay = (game.state.recursos && game.state.recursos[tipo]) || 0
  const q = Math.max(0, Math.min(Math.round(cantidad), hay))
  if (!q) return 0
  return pagar({ [tipo]: q }, 'expedición') ? q : 0
}

function sumar (inf, entrado) {
  for (const k of Object.keys(entrado || {})) inf.recursos[k] = (inf.recursos[k] || 0) + entrado[k]
}

const ICONO_RES = { madera: '🪵', piedra: '🪨', comida: '🌾', oro: '🪙' }

function enumerarRecursos (r) {
  const partes = Object.keys(r || {}).filter(k => r[k] > 0).map(k => `${r[k]} de ${k}`)
  return enumerar(partes)
}

function enumerar (arr) {
  const a = (arr || []).filter(Boolean)
  if (!a.length) return ''
  if (a.length === 1) return a[0]
  return a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1]
}

function articulo (n) {
  const femeninos = ['cantera', 'veta_oro', 'aldea_abandonada', 'reliquia', 'ruinas', 'pantano']
  if (n.tipo === 'ruinas') return 'unas'
  return femeninos.includes(n.tipo) ? 'una' : 'un'
}

const PAISAJE = {
  llanura: ['un llano abierto donde el viento no encuentra con qué entretenerse', 'pastos rasos y cuatro piedras puestas por alguien que ya no está'],
  bosque: ['un robledal tan cerrado que se hace de noche a mediodía', 'hayas viejas, musgo hasta las rodillas y un silencio que incomoda'],
  colinas: ['lomas peladas con la piedra asomando como costillas', 'cuestas y más cuestas, y desde arriba se ve medio valle'],
  montaña: ['peñascos, nieve sucia y un paso que se hace de rodillas', 'roca viva y un frío que muerde hasta con sol'],
  pantano: ['aguas quietas, juncos y un olor que se queda en la ropa', 'ciénaga, mosquitos y cosas que se mueven bajo el barro'],
  costa: ['arena, salitre y restos de un naufragio con más años que la aldea', 'una playa larga con gaviotas insolentes'],
  agua: ['agua y más agua, hasta donde se ve', 'un brazo de mar que no se cruza andando'],
  paramo: ['tierra parda, cardos y el esqueleto de un carro', 'un páramo donde hasta el eco se aburre']
}

function frasePaisaje (t, rng) {
  const lista = (t && PAISAJE[t.bioma]) || PAISAJE.llanura
  return rng.pick(lista)
}

function enTexto (seg) {
  if (seg < 90) return `${Math.round(seg)} s`
  const m = Math.round(seg / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h} h ${m % 60} min`
}

// ------------------------------------------------------- consultas para la UI

/**
 * Lo que hay fuera ahora mismo, con su cuenta atrás. Para pintar la lista.
 * @returns {Array} expediciones vivas con restante, pct y etiqueta ya escrita.
 */
export function enCurso () {
  const ahora = Date.now()
  return lista()
    .filter(e => e.estado === 'fuera' || e.estado === 'herido')
    .map(e => {
      if (e.estado === 'herido') {
        const resta = Math.max(0, Math.round(((e.descansoHasta || ahora) - ahora) / 1000))
        return { ...e, restante: resta, pct: 1, etiqueta: `Curándose · ${enTexto(resta)}`, curandose: true, costeAcelerar: 0 }
      }
      const resta = Math.max(0, Math.round((e.vuelve - ahora) / 1000))
      const pct = Math.min(1, Math.max(0, 1 - resta / Math.max(1, e.duracion)))
      const yendo = ahora < e.llega
      const etiqueta = resta <= 0
        ? 'Llegando a la empalizada…'
        : `${yendo ? 'De camino a' : 'Volviendo de'} ${e.destinoNombre} · ${enTexto(resta)}`
      return { ...e, restante: resta, pct, etiqueta, curandose: false, costeAcelerar: costeAcelerar(e.id) }
    })
}

/** Gemas para que vuelva ya. Enséñalo ANTES de cobrar. */
export function costeAcelerar (id) {
  const e = lista().find(x => x.id === id)
  if (!e) return 0
  const ahora = Date.now()
  const resta = e.estado === 'herido'
    ? Math.max(0, ((e.descansoHasta || ahora) - ahora) / 1000)
    : e.estado === 'fuera' ? Math.max(0, (e.vuelve - ahora) / 1000) : 0
  return Math.ceil(resta / CONFIG.SEG_POR_GEMA)
}

/** Que vuelva ya (o que se cure ya) pagando gemas. */
export function acelerar (id) {
  const e = lista().find(x => x.id === id)
  if (!e) return false
  const precio = costeAcelerar(id)
  if (precio > 0 && !moverGemas(-precio, 'acelerar expedición')) {
    events.emit(EV.UI_TOAST, { texto: `Te faltan gemas: cuesta ${precio} 💎`, tipo: 'mal' })
    return false
  }
  const ahora = Date.now()
  if (e.estado === 'herido') { e.descansoHasta = ahora; e.estado = 'vuelta'; return true }
  if (e.estado !== 'fuera') return false
  e.vuelve = ahora
  e.llega = Math.min(e.llega, ahora)
  resolver(e, ahora)
  podar()
  return true
}

/** Informes que el jugador aún no ha abierto. */
export const informesSinLeer = () => lista().filter(e => e.resultado && !e.leido)

/** Últimos informes, del más reciente al más viejo. Para el panel del mundo. */
export function informes (n = MAX_HISTORIAL) {
  return lista().filter(e => e.resultado).sort((a, b) => (b.volvioEn || b.vuelve) - (a.volvioEn || a.vuelve)).slice(0, n)
}

export function marcarLeido (id) {
  const e = lista().find(x => x.id === id)
  if (e) e.leido = true
  return !!e
}

/**
 * El aviso: si mientras juegas ha vuelto alguien, que no pase desapercibido.
 * Sin informes pendientes, dice cuánto falta para la próxima vuelta.
 */
export function recordarAlVolver () {
  const pendientes = informesSinLeer()
  const siguiente = fuera().sort((a, b) => a.vuelve - b.vuelve)[0] || null
  const resumen = {
    pendientes: pendientes.length,
    informes: pendientes,
    proxima: siguiente
      ? { id: siguiente.id, destino: siguiente.destinoNombre, restante: Math.max(0, Math.round((siguiente.vuelve - Date.now()) / 1000)) }
      : null,
    texto: ''
  }

  if (pendientes.length) {
    resumen.texto = pendientes.length === 1
      ? `📜 ${pendientes[0].resultado.titulo}. Toca para leer el informe.`
      : `📜 Tienes ${pendientes.length} informes de expedición sin leer.`
    events.emit(EV.UI_TOAST, { texto: resumen.texto, tipo: 'info' })
  } else if (siguiente) {
    resumen.texto = `${MISIONES[siguiente.mision].icono} ${siguiente.aldeanoNombre} vuelve de ${siguiente.destinoNombre} en ${enTexto(resumen.proxima.restante)}.`
  } else {
    resumen.texto = plazas() ? 'No tienes a nadie fuera. El mapa no se explora solo.' : 'Sin campamento de exploradores no hay expediciones.'
  }
  return resumen
}

/**
 * Tres destinos que merecen la pena AHORA, cada uno con su motivo en una frase:
 * el nodo rico más cercano, una zona a medio descubrir y un enemigo sin espiar.
 */
export function sugerencias () {
  const out = []
  const w = game.state.world
  if (!w || !nivelCampamento()) return out
  const alc = alcance()
  const yaFuera = (x, y) => fuera().some(e => e.x === x && e.y === y)

  // 1) el nodo descubierto más rentable que se pueda alcanzar
  const nodos = (w.nodos || []).filter(n => n.descubierto && !n.agotado && n.restante > 0 && n.recurso &&
    distancia(n.x, n.y) <= alc && !yaFuera(n.x, n.y))
  if (nodos.length) {
    const mejor = nodos.map(n => ({ n, p: (n.restante * (n.recurso === 'oro' ? 3 : n.recurso === 'gemas' ? 25 : 1)) / (1 + distancia(n.x, n.y) * 1.6) }))
      .sort((a, b) => b.p - a.p)[0].n
    out.push({
      x: mejor.x,
      y: mejor.y,
      mision: 'recolectar',
      titulo: `${mejor.nombre} en ${nombreDe(mejor.x, mejor.y)}`,
      motivo: `Quedan ${mejor.restante} de ${mejor.recurso} y está a ${enTexto(tiempoDe(mejor.x, mejor.y, 'recolectar'))} de casa.`,
      riesgo: riesgoDe(mejor.x, mejor.y, 'recolectar').nivel
    })
  }

  // 2) la frontera con más niebla alrededor: donde más mapa se gana de un viaje
  let frontera = null
  let mejorNiebla = 0
  for (const t of (w.tiles || [])) {
    if (!visible(t.x, t.y)) continue
    if (distancia(t.x, t.y) > alc) continue
    if (yaFuera(t.x, t.y)) continue
    let niebla = 0
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = t.x + dx
        const ny = t.y + dy
        if (!dentro(nx, ny) || visible(nx, ny)) continue
        if (distancia(nx, ny) > alc) continue
        niebla++
      }
    }
    if (niebla > mejorNiebla) { mejorNiebla = niebla; frontera = t }
  }
  if (frontera) {
    out.push({
      x: frontera.x,
      y: frontera.y,
      mision: 'explorar',
      titulo: `Más allá de ${frontera.nombre}`,
      motivo: `Ahí empieza la niebla: unas ${mejorNiebla} casillas sin ver a un paso.`,
      riesgo: riesgoDe(frontera.x, frontera.y, 'explorar').nivel
    })
  }

  // 3) un enemigo del que no tengas parte reciente
  const espiados = new Set(lista().filter(e => e.mision === 'espiar' && e.resultado && e.enemigoId).map(e => e.enemigoId))
  const enemigo = enemigosMundo()
    .filter(e => e && !espiados.has(e.id) && !e.espiado && distancia(e.x, e.y) <= alc && !yaFuera(e.x, e.y))
    .sort((a, b) => distancia(a.x, a.y) - distancia(b.x, b.y))[0]
  if (enemigo) {
    out.push({
      x: enemigo.x,
      y: enemigo.y,
      mision: 'espiar',
      titulo: enemigo.nombre || 'Campamento enemigo',
      motivo: 'Nadie ha contado cuántos son. Atacar a ciegas es como pagar dos veces.',
      riesgo: riesgoDe(enemigo.x, enemigo.y, 'espiar').nivel
    })
  } else {
    // sin enemigos a la vista, un saqueo rápido a la zona más gorda
    const gordo = (w.nodos || []).filter(n => n.descubierto && n.restante > 0 && distancia(n.x, n.y) <= alc && !yaFuera(n.x, n.y))
      .sort((a, b) => (b.dificultad || 0) - (a.dificultad || 0))[0]
    if (gordo) {
      out.push({
        x: gordo.x,
        y: gordo.y,
        mision: 'saquear',
        titulo: `Golpe rápido en ${nombreDe(gordo.x, gordo.y)}`,
        motivo: 'Un pellizco sin batalla. Arriesgado, pero se vuelve pronto.',
        riesgo: riesgoDe(gordo.x, gordo.y, 'saquear').nivel
      })
    }
  }

  return out.slice(0, 3)
}

/** El historial no crece sin fin: el estado tiene que seguir cabiendo en el móvil. */
function podar () {
  const exps = lista()
  const vivas = exps.filter(e => e.estado === 'fuera' || e.estado === 'herido')
  const viejas = exps.filter(e => e.estado !== 'fuera' && e.estado !== 'herido')
    .sort((a, b) => (b.volvioEn || b.vuelve) - (a.volvioEn || a.vuelve))
    .slice(0, MAX_HISTORIAL)
  game.state.expediciones = [...vivas, ...viejas]
}

// -------------------------------------------------------------------- arranque

export function init () {
  lista()
  events.on(EV.TICK, alTick)
  events.on(EV.STATE_LOADED, () => {
    lista()
    // al volver al juego se resuelve de golpe todo lo que venció con el móvil cerrado
    alTick()
    const pendientes = informesSinLeer()
    if (pendientes.length) recordarAlVolver()
  })
}
