/**
 * CIENCIA Y PROGRESIÓN — tecnologías, avance de edad y nivel del jugador.
 *
 * Es la espina dorsal del juego: lo que hace que la aldea de la hora tres no se
 * parezca en nada a la de la hora uno. Tres cosas viven aquí:
 *
 *   1. TECNOLOGÍAS  → mejoras permanentes, una cada vez, cobradas por adelantado.
 *   2. AVANCE DE EDAD → la pared dura de cada tramo: cuesta caro, tarda, y al
 *      caer abre de golpe edificios, unidades y tecnologías. Además cambia la
 *      CARA de la aldea (EV.EDAD_VISUAL): paja, luego teja, luego pizarra.
 *   3. NIVEL DEL JUGADOR → XP repartida sola escuchando lo que pasa en la partida.
 *
 * Los dos relojes (investigación y avance) se guardan como marca de tiempo
 * absoluta `fin`, nunca como "segundos restantes": así siguen corriendo con la
 * app cerrada y el jugador vuelve a algo terminado.
 *
 * Este módulo solo escribe en: state.research, state.investigacion, state.age,
 * state.avanceEdad y state.jugador.{nivel,xp,gemas}. Nada más es suyo.
 */

import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { CONFIG } from '../core/config.js'
import { TECNOLOGIAS, EDADES, defTech } from '../data/techs.js'
import { EDIFICIOS, def, ORDEN_EDADES, AGE_NOMBRE } from '../data/buildings.js'
import { UNIDADES } from '../data/units.js'
// El banco es de sim/resources.js: aquí no se toca un recurso ni una gema a mano.
import * as banco from './resources.js'

/** Lo que falta para pagar un coste, o null si da de sobra. */
function loQueFalta (coste) {
  const falta = banco.faltaPara(coste)
  return Object.keys(falta).length ? falta : null
}

const puedePagar = (coste) => banco.puedePagar(coste)
const cobrar = (coste, motivo) => banco.pagar(coste, motivo)
const cobrarGemas = (cantidad) => banco.gemas(-cantidad, 'acelerar')
const regalarGemas = (cantidad) => banco.gemas(cantidad, 'nivel')

// ---------------------------------------------------------------------------
// Lectura del estado de la aldea (solo lectura: los edificios son de otro)
// ---------------------------------------------------------------------------

/**
 * Nivel del mejor edificio de ese tipo YA conseguido. Una construcción nueva
 * vale 0 (su nivel es 0 hasta que termina), pero una MEJORA en marcha conserva
 * el nivel de antes: nadie pierde requisitos por tener andamios puestos.
 */
function nivelEdificio (tipo) {
  let mejor = 0
  for (const b of game.state.buildings || []) {
    if (b.tipo === tipo && (b.nivel || 0) > mejor) mejor = b.nivel || 0
  }
  return mejor
}

const nombreEdificio = (tipo) => def(tipo)?.nombre || tipo
const indiceEdad = (age) => Math.max(0, ORDEN_EDADES.indexOf(age))
const edadActual = () => game.state.age || 'oscura'
/** ¿La edad `necesaria` ya se alcanzó? */
const edadAlcanzada = (necesaria) => indiceEdad(edadActual()) >= indiceEdad(necesaria)

/** Velocidad de investigación: la Universidad es lo único que la acelera. */
function velocidadInvestigacion () {
  const n = nivelEdificio('universidad')
  if (!n) return 1
  return EDIFICIOS.universidad.velocidadInvestigacion(n)
}

/** Segundos reales que tardará una tecnología aquí y ahora. */
function tiempoReal (ficha) {
  return Math.max(1, Math.round(ficha.tiempo / velocidadInvestigacion()))
}

// ---------------------------------------------------------------------------
// Requisitos, en español y con el motivo escrito para enseñarlo tal cual
// ---------------------------------------------------------------------------

/**
 * Desglosa los requisitos de una tecnología.
 * @returns {{ok:boolean, texto:string}[]} uno por requisito, en orden de lectura.
 */
function requisitosTech (id) {
  const ficha = defTech(id)
  if (!ficha) return []
  const lista = []

  if (!edadAlcanzada(ficha.age)) {
    lista.push({ ok: false, texto: `Necesitas llegar a la ${AGE_NOMBRE[ficha.age]}` })
  } else {
    lista.push({ ok: true, texto: `${AGE_NOMBRE[ficha.age]}` })
  }

  for (const clave in (ficha.requiere || {})) {
    const valor = ficha.requiere[clave]
    if (clave === 'tech') {
      for (const t of [].concat(valor)) {
        const hecha = !!game.state.research?.[t]
        lista.push({ ok: hecha, texto: `${hecha ? '' : 'Necesitas investigar '}${defTech(t)?.nombre || t}` })
      }
    } else {
      const actual = nivelEdificio(clave)
      const ok = actual >= valor
      lista.push({
        ok,
        texto: ok
          ? `${nombreEdificio(clave)} nivel ${valor}`
          : `Necesitas ${elLa(clave)} ${nombreEdificio(clave)} nivel ${valor}`
      })
    }
  }
  return lista
}

/**
 * Artículo correcto para que el motivo se lea como lo diría una persona
 * ("Necesitas la Universidad", "Necesitas el Ayuntamiento"). Regla corta que
 * acierta con todos los nombres del catálogo; 'torre' es la única excepción.
 */
function elLa (tipo) {
  const primera = nombreEdificio(tipo).split(' ')[0].toLowerCase()
  const femenina = primera.endsWith('a') || primera.endsWith('dad') ||
                   primera.endsWith('ción') || primera === 'torre'
  return femenina ? 'la' : 'el'
}

// ---------------------------------------------------------------------------
// 1. TECNOLOGÍAS
// ---------------------------------------------------------------------------

/** Ficha de tecnología tal y como la quiere la interfaz. */
function tarjeta (id) {
  const f = TECNOLOGIAS[id]
  return {
    id,
    nombre: f.nombre,
    icono: f.icono,
    desc: f.desc,
    age: f.age,
    edadNombre: AGE_NOMBRE[f.age],
    coste: { ...f.coste },
    tiempo: f.tiempo,
    tiempoReal: tiempoReal(f),
    efecto: { ...f.efecto },
    resumenEfecto: textoEfecto(f.efecto)
  }
}

const NOMBRE_TIPO_EFECTO = {
  produccion: 'Producción',
  ataque: 'Ataque',
  armadura: 'Armadura',
  velocidadObra: 'Velocidad de obra',
  defensa: 'Defensa',
  exploracion: 'Exploración',
  comercio: 'Comisión de mercado'
}

const NOMBRE_OBJETIVO = {
  todas: 'general', madera: 'de madera', piedra: 'de piedra', comida: 'de comida', oro: 'de oro',
  distancia: 'a distancia', caballeria: 'de caballería', torres: 'de las torres',
  muralla: 'de la muralla', puerta: 'de la puerta', alcance: 'alcance', velocidad: 'velocidad',
  comision: ''
}

/** "Producción de madera +15 %", para enseñar de un vistazo qué compras. */
function textoEfecto (e) {
  if (!e) return ''
  const signo = e.valor >= 0 ? '+' : '−'
  const pct = Math.round(Math.abs(e.valor) * 100)
  const obj = NOMBRE_OBJETIVO[e.objetivo] ?? e.objetivo
  return `${NOMBRE_TIPO_EFECTO[e.tipo] || e.tipo}${obj ? ' ' + obj : ''} ${signo}${pct} %`.replace('  ', ' ')
}

/**
 * Tecnologías que se pueden investigar YA MISMO: edad alcanzada, edificios al
 * nivel pedido y tecnologías previas hechas.
 * @returns {any[]} tarjetas con coste, tiempo real y si el bolsillo llega.
 */
export function disponibles () {
  const salida = []
  for (const id in TECNOLOGIAS) {
    if (game.state.research?.[id]) continue
    if (requisitosTech(id).some(r => !r.ok)) continue
    const t = tarjeta(id)
    t.asequible = puedePagar(t.coste)
    t.falta = loQueFalta(t.coste)
    salida.push(t)
  }
  // primero lo barato: la lista se lee como un camino, no como un muro
  return salida.sort((a, b) => a.tiempo - b.tiempo)
}

/**
 * Las que aún no. Cada una con el motivo escrito en español ("Necesitas la
 * Universidad nivel 2"): enseñar lo que viene motiva tanto como lo de hoy.
 */
export function bloqueadas () {
  const salida = []
  for (const id in TECNOLOGIAS) {
    if (game.state.research?.[id]) continue
    const reqs = requisitosTech(id)
    const fallo = reqs.find(r => !r.ok)
    if (!fallo) continue
    const t = tarjeta(id)
    t.motivo = fallo.texto
    t.requisitos = reqs
    salida.push(t)
  }
  return salida.sort((a, b) => indiceEdad(a.age) - indiceEdad(b.age) || a.tiempo - b.tiempo)
}

/** Las ya investigadas, para la pestaña de "logros" de la universidad. */
export function investigadas () {
  return Object.keys(game.state.research || {})
    .filter(id => game.state.research[id] && TECNOLOGIAS[id])
    .map(id => tarjeta(id))
}

/**
 * Arranca una investigación: cobra por adelantado y la mete en cola.
 * Solo una a la vez — elegir duele, y por eso importa.
 * @returns {{ok:boolean, motivo?:string, fin?:number}}
 */
export function investigar (id) {
  const ficha = defTech(id)
  if (!ficha) return { ok: false, motivo: 'Esa tecnología no existe' }
  if (game.state.research?.[id]) return { ok: false, motivo: 'Ya la tienes investigada' }
  if (game.state.investigacion) {
    const enCurso = defTech(game.state.investigacion.id)?.nombre || 'otra cosa'
    return { ok: false, motivo: `Tus sabios ya andan con ${enCurso}` }
  }
  const fallo = requisitosTech(id).find(r => !r.ok)
  if (fallo) return { ok: false, motivo: fallo.texto }
  if (!cobrar(ficha.coste, `tech:${id}`)) return { ok: false, motivo: 'No te llegan los recursos' }

  const ahora = Date.now()
  const dura = tiempoReal(ficha) * 1000
  game.state.investigacion = { id, inicio: ahora, fin: ahora + dura }
  events.emit(EV.UI_TOAST, { texto: `${ficha.icono} Los sabios se ponen con ${ficha.nombre}`, tipo: 'info' })
  events.emit(EV.SFX, { nombre: 'investigar' })
  return { ok: true, fin: game.state.investigacion.fin }
}

function terminarInvestigacion () {
  const enCurso = game.state.investigacion
  if (!enCurso) return
  const ficha = defTech(enCurso.id)
  game.state.research[enCurso.id] = true
  game.state.investigacion = null
  invalidarBonus()
  events.emit(EV.TECH_RESEARCHED, { techId: enCurso.id })
  if (ficha) {
    events.emit(EV.UI_TOAST, { texto: `${ficha.icono} ${ficha.nombre}: ${textoEfecto(ficha.efecto)}`, tipo: 'bien' })
  }
}

/** Progreso de la investigación en curso (o null), listo para pintar una barra. */
export function progresoInvestigacion () {
  const inv = game.state.investigacion
  if (!inv) return null
  const ahora = Date.now()
  const total = Math.max(1, inv.fin - (inv.inicio || inv.fin))
  const restante = Math.max(0, inv.fin - ahora)
  const ficha = defTech(inv.id)
  return {
    id: inv.id,
    nombre: ficha?.nombre || inv.id,
    icono: ficha?.icono || '📜',
    restante: Math.ceil(restante / 1000),
    total: Math.round(total / 1000),
    pct: Math.min(1, 1 - restante / total),
    gemas: gemasPara(restante)
  }
}

const gemasPara = (msRestantes) => Math.max(1, Math.ceil((msRestantes / 1000) / CONFIG.SEG_POR_GEMA))

/**
 * Acelera con gemas lo que esté corriendo, igual que las obras (1 gema = 60 s).
 * @param {'investigacion'|'edad'} [que] por defecto, lo que haya en curso.
 */
export function acelerar (que) {
  const ahora = Date.now()
  const objetivo = que || (game.state.investigacion ? 'investigacion' : game.state.avanceEdad ? 'edad' : null)
  const tarea = objetivo === 'edad' ? game.state.avanceEdad : objetivo === 'investigacion' ? game.state.investigacion : null
  if (!tarea) return { ok: false, motivo: 'No hay nada que acelerar' }

  const restante = Math.max(0, tarea.fin - ahora)
  if (restante <= 0) { tick(); return { ok: true, gemas: 0 } }
  const precio = gemasPara(restante)
  if (!cobrarGemas(precio)) return { ok: false, motivo: `Te faltan gemas (cuesta ${precio} 💎)` }

  tarea.fin = ahora
  events.emit(EV.SFX, { nombre: 'gema' })
  tick()
  return { ok: true, gemas: precio }
}

// ---------------------------------------------------------------------------
// bonus(): LA función de este módulo. La llaman recursos, ejército y combate.
// ---------------------------------------------------------------------------

/**
 * Suma de los efectos de TODAS las tecnologías investigadas de un tipo.
 *
 * Los efectos son fracciones que se suman (no se multiplican): dos techs de
 * +15 % dan +30 %, que es lo que el jugador espera al leer los números.
 * Un efecto con objetivo 'todas' cuenta siempre, además del específico.
 *
 *   bonus('produccion', 'madera')  → 0.35   (hachas 0.15 + carretillas 0.12 + sierra 0.20…)
 *   bonus('ataque', 'caballeria')  → 0.45
 *   bonus('velocidadObra')         → 0.10
 *
 * Quien la llame la usa así:  produccion * (1 + bonus('produccion','madera')).
 *
 * COSTE: cero. El resultado se guarda en caché y solo se recalcula cuando se
 * termina una investigación, se cambia de edad o se carga una partida, así que
 * se puede llamar dentro del bucle de producción sin pensárselo.
 *
 * @param {string} tipo uno de TIPOS_EFECTO
 * @param {string} [objetivo] 'madera', 'caballeria', 'torres'… (vacío = solo los globales)
 * @returns {number} fracción acumulada (0 si no hay nada investigado)
 */
export function bonus (tipo, objetivo = 'todas') {
  const clave = tipo + '|' + objetivo
  const guardado = cacheBonus.get(clave)
  if (guardado !== undefined) return guardado

  let suma = 0
  for (const id in game.state.research || {}) {
    if (!game.state.research[id]) continue
    const e = TECNOLOGIAS[id]?.efecto
    if (!e || e.tipo !== tipo) continue
    if (e.objetivo === objetivo || e.objetivo === 'todas') suma += e.valor
  }
  suma = Math.round(suma * 1000) / 1000
  cacheBonus.set(clave, suma)
  return suma
}

const cacheBonus = new Map()
function invalidarBonus () { cacheBonus.clear() }

/** Todos los bonos de un tipo de una tacada, para paneles de detalle. */
export function bonusDe (tipo) {
  const salida = {}
  for (const id in game.state.research || {}) {
    if (!game.state.research[id]) continue
    const e = TECNOLOGIAS[id]?.efecto
    if (e?.tipo === tipo) salida[e.objetivo] = (salida[e.objetivo] || 0) + e.valor
  }
  return salida
}

// ---------------------------------------------------------------------------
// 2. AVANCE DE EDAD
// ---------------------------------------------------------------------------

/** La edad siguiente a la actual, o null si ya se gobierna en la Imperial. */
export function siguienteEdad () {
  return ORDEN_EDADES[indiceEdad(edadActual()) + 1] || null
}

/**
 * ¿Se puede subir de edad?
 * @returns {{ok:boolean, motivo:string, requisitos:any[], siguiente:string|null, coste?:any, tiempo?:number}}
 */
export function puedeAvanzar () {
  const sig = siguienteEdad()
  if (!sig) return { ok: false, motivo: 'Ya gobiernas en la Edad Imperial: no hay más allá', requisitos: [], siguiente: null }
  const ficha = EDADES[sig]
  const requisitos = []

  for (const tipo in ficha.requiere) {
    const necesario = ficha.requiere[tipo]
    // `tech` no es un edificio: son las investigaciones que hay que traer hechas.
    // Es lo que convierte el salto de edad en un camino y no en una hucha.
    if (tipo === 'tech') {
      for (const t of [].concat(necesario)) {
        const hecha = !!game.state.research?.[t]
        const nombre = defTech(t)?.nombre || t
        requisitos.push({
          tipo: 'tech',
          id: t,
          nombre,
          icono: defTech(t)?.icono || '📜',
          actual: hecha ? 1 : 0,
          necesario: 1,
          ok: hecha,
          texto: hecha ? `${nombre} investigada` : `Necesitas investigar ${nombre}`
        })
      }
      continue
    }
    const actual = nivelEdificio(tipo)
    requisitos.push({
      tipo,
      nombre: nombreEdificio(tipo),
      icono: def(tipo)?.icono || '🏗️',
      actual,
      necesario,
      ok: actual >= necesario,
      texto: actual >= necesario
        ? `${nombreEdificio(tipo)} nivel ${necesario}`
        : `Necesitas ${elLa(tipo)} ${nombreEdificio(tipo)} nivel ${necesario} (tienes ${actual || 'ninguna'})`
    })
  }

  const falta = loQueFalta(ficha.coste)
  requisitos.push({
    tipo: 'coste',
    nombre: 'Tesoro',
    icono: '🪙',
    ok: !falta,
    falta,
    texto: falta ? 'No te llegan los recursos para la ceremonia' : 'Recursos listos'
  })

  if (game.state.avanceEdad) {
    return { ok: false, motivo: 'La aldea ya está preparando la ceremonia', requisitos, siguiente: sig, coste: { ...ficha.coste }, tiempo: ficha.tiempo }
  }
  if (game.state.investigacion) {
    // No es un bloqueo caprichoso: el avance ocupa a los mismos sabios.
    return { ok: false, motivo: 'Tus sabios están investigando; espera o acelera', requisitos, siguiente: sig, coste: { ...ficha.coste }, tiempo: ficha.tiempo }
  }

  const fallo = requisitos.find(r => !r.ok)
  return {
    ok: !fallo,
    motivo: fallo ? fallo.texto : `Todo listo para la ${ficha.nombre}`,
    requisitos,
    siguiente: sig,
    coste: { ...ficha.coste },
    tiempo: ficha.tiempo
  }
}

/**
 * Arranca la ceremonia de avance: cobra y pone la cuenta atrás larga.
 * Es el hito gordo del tramo, así que no se resuelve en el acto ni se disimula.
 */
export function avanzarEdad () {
  const estado = puedeAvanzar()
  if (!estado.ok) return { ok: false, motivo: estado.motivo }
  const sig = estado.siguiente
  const ficha = EDADES[sig]
  if (!cobrar(ficha.coste, `edad:${sig}`)) return { ok: false, motivo: 'No te llegan los recursos' }

  const ahora = Date.now()
  game.state.avanceEdad = { a: sig, inicio: ahora, fin: ahora + ficha.tiempo * 1000 }
  events.emit(EV.UI_TOAST, { texto: `${ficha.icono} Comienza el paso a la ${ficha.nombre}`, tipo: 'bien' })
  events.emit(EV.SFX, { nombre: 'edad' })
  return { ok: true, fin: game.state.avanceEdad.fin, edad: sig }
}

function terminarAvance () {
  const av = game.state.avanceEdad
  if (!av) return
  const anterior = edadActual()
  const nueva = av.a
  game.state.age = nueva
  game.state.avanceEdad = null
  invalidarBonus()

  const ficha = EDADES[nueva]
  events.emit(EV.AGE_ADVANCED, { age: nueva, anterior })
  // La aldea entera sube de categoría: más vida y otro aspecto. El render cambia
  // los tejados; sim/buildings aplica el multiplicador a los hp (los edificios
  // no son nuestros, aquí solo se anuncia cuánto suben).
  events.emit(EV.EDAD_VISUAL, {
    age: nueva,
    anterior,
    nivelVisual: indiceEdad(nueva),
    multiplicadorHp: MULTIPLICADOR_HP_EDAD
  })
  events.emit(EV.UI_TOAST, { texto: `${ficha.icono} ¡${ficha.nombre}! ${ficha.desbloquea}`, tipo: 'bien' })
  darXP(300 * indiceEdad(nueva), `edad:${nueva}`)
}

/** Cada edad endurece la piedra un 15 %: la aldea vieja aguanta más. */
const MULTIPLICADOR_HP_EDAD = 1.15

/** Progreso de la ceremonia (o null). */
export function progresoEdad () {
  const av = game.state.avanceEdad
  if (!av) return null
  const total = Math.max(1, av.fin - (av.inicio || av.fin))
  const restante = Math.max(0, av.fin - Date.now())
  return {
    edad: av.a,
    nombre: EDADES[av.a]?.nombre || av.a,
    icono: EDADES[av.a]?.icono || '⏳',
    restante: Math.ceil(restante / 1000),
    total: Math.round(total / 1000),
    pct: Math.min(1, 1 - restante / total),
    gemas: gemasPara(restante)
  }
}

/**
 * La zanahoria: qué te llevas si subes de edad, en español y apetecible.
 * La interfaz lo enseña tal cual, sin tener que saber nada del catálogo.
 */
export function resumenEdad () {
  const sig = siguienteEdad()
  const actual = { id: edadActual(), nombre: AGE_NOMBRE[edadActual()] }
  if (!sig) {
    return {
      actual,
      siguiente: null,
      titular: 'Has llegado a lo más alto',
      texto: 'La Edad Imperial es la última: de aquí en adelante, lo que crezca lo haces crecer tú.',
      edificios: [], unidades: [], tecnologias: [], requisitos: [], ok: false, enCurso: null
    }
  }
  const ficha = EDADES[sig]
  const estado = puedeAvanzar()
  const nombres = (obj) => Object.keys(obj).filter(k => obj[k].age === sig)
    .map(k => ({ id: k, nombre: obj[k].nombre, icono: obj[k].icono }))

  return {
    actual,
    siguiente: { id: sig, nombre: ficha.nombre, icono: ficha.icono },
    titular: `${ficha.icono} ${ficha.nombre}`,
    texto: ficha.desbloquea,
    coste: { ...ficha.coste },
    tiempo: ficha.tiempo,
    edificios: nombres(EDIFICIOS),
    unidades: nombres(UNIDADES),
    tecnologias: nombres(TECNOLOGIAS),
    requisitos: estado.requisitos,
    ok: estado.ok,
    motivo: estado.motivo,
    enCurso: progresoEdad()
  }
}

// ---------------------------------------------------------------------------
// 3. NIVEL DEL JUGADOR Y XP
// ---------------------------------------------------------------------------

const NIVEL_MAX = 50

/**
 * XP para pasar del nivel n al n+1. Curva suave al principio (los tres primeros
 * niveles caen en la primera sesión) y cuesta arriba después.
 */
export function xpParaNivel (n) {
  return Math.round((80 * Math.pow(n, 1.6)) / 10) * 10
}

/** Gemas de regalo al subir: pequeñas pero constantes, nunca se compran. */
const gemasDeNivel = (n) => Math.min(25, 3 + Math.floor(n / 2))

/**
 * Reparte experiencia y sube de nivel si toca (puede subir varios de golpe).
 * @param {number} cantidad
 * @param {string} [motivo] para el registro y para el aviso en pantalla
 */
export function darXP (cantidad, motivo = '') {
  const xp = Math.round(cantidad)
  if (!xp || xp < 0) return
  const j = game.state.jugador
  if (j.nivel >= NIVEL_MAX) return
  j.xp = (j.xp || 0) + xp

  let subidas = 0
  while (j.nivel < NIVEL_MAX && j.xp >= xpParaNivel(j.nivel)) {
    j.xp -= xpParaNivel(j.nivel)
    j.nivel++
    subidas++
    const premio = gemasDeNivel(j.nivel)
    regalarGemas(premio)
    events.emit(EV.LEVEL_UP, { nivel: j.nivel, gemas: premio, motivo })
    events.emit(EV.UI_TOAST, { texto: `⭐ ¡Nivel ${j.nivel}! +${premio} 💎`, tipo: 'bien' })
  }
  if (subidas) events.emit(EV.SFX, { nombre: 'nivel' })
}

/** Estado del nivel para la barra del HUD. */
export function nivelJugador () {
  const j = game.state.jugador
  const falta = xpParaNivel(j.nivel)
  return { nivel: j.nivel, xp: j.xp || 0, siguiente: falta, pct: Math.min(1, (j.xp || 0) / falta), max: j.nivel >= NIVEL_MAX }
}

/**
 * La XP se reparte sola: nadie tiene que acordarse de llamarnos. Se escucha lo
 * que ya pasa en la partida y se premia el avance real, no el tiempo sentado.
 */
function escucharXP () {
  events.on(EV.BUILD_COMPLETED, ({ building }) => darXP(15 + (building?.nivel || 1) * 5, 'construir'))
  events.on(EV.BUILD_UPGRADED, ({ building }) => darXP(10 + (building?.nivel || 2) * 8, 'mejorar'))
  events.on(EV.TECH_RESEARCHED, ({ techId }) => {
    const f = defTech(techId)
    darXP(20 + Math.round((f?.tiempo || 0) / 60), 'investigar')   // techs largas, más XP
  })
  events.on(EV.RAID_RESOLVED, ({ victoria }) => darXP(victoria ? 60 : 20, 'asalto'))
  events.on(EV.QUEST_COMPLETED, ({ recompensa }) => darXP(recompensa?.xp ?? 40, 'encargo'))
}

// ---------------------------------------------------------------------------
// Reloj: investigación y avance corren con la app cerrada (fin absoluto)
// ---------------------------------------------------------------------------

function tick () {
  const ahora = Date.now()
  const inv = game.state.investigacion
  if (inv && inv.fin && ahora >= inv.fin) terminarInvestigacion()
  const av = game.state.avanceEdad
  if (av && av.fin && ahora >= av.fin) terminarAvance()
}

/** Rellena los campos que una partida vieja no tenía. JSON puro, siempre. */
function normalizar () {
  const s = game.state
  if (!s.research || typeof s.research !== 'object') s.research = {}
  if (s.investigacion === undefined) s.investigacion = null
  if (s.avanceEdad === undefined) s.avanceEdad = null
  if (!ORDEN_EDADES.includes(s.age)) s.age = 'oscura'
  const j = s.jugador
  if (typeof j.nivel !== 'number' || j.nivel < 1) j.nivel = 1
  if (typeof j.xp !== 'number' || j.xp < 0) j.xp = 0
  if (typeof j.gemas !== 'number' || j.gemas < 0) j.gemas = 0
  invalidarBonus()
}

export function init () {
  normalizar()
  escucharXP()
  events.on(EV.TICK, tick)
  events.on(EV.STATE_LOADED, () => { normalizar(); tick() })
  // Una construcción nueva puede desbloquear tecnologías: la caché de bonus no
  // depende de los edificios, pero sí el listado, así que no hay nada que tirar.
  tick()   // al abrir: lo que terminó estando fuera, se resuelve ya
}
