import { CONFIG, ICONO } from '../core/config.js'
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { centroDe, dist } from '../core/grid.js'
import { def, ORDEN_EDADES } from '../data/buildings.js'
import { TECNOLOGIAS } from '../data/techs.js'

/**
 * EL BANCO DEL JUEGO. Es el ÚNICO módulo que escribe en `game.state.recursos`,
 * `game.state.almacen` y `game.state.jugador.gemas`. Los demás módulos de sim/
 * importan estas funciones (la excepción pactada a "los módulos no se importan").
 *
 * Dos ideas sostienen todo lo de aquí abajo:
 *   1. O se cobra entero o no se cobra: `pagar` nunca deja al jugador a medias.
 *   2. El estado solo guarda ENTEROS. Los decimales del tick viven en `sobrantes`,
 *      una variable del módulo que NO se guarda: si se guardara, quien cierra y
 *      abre el juego cada diez segundos iría acumulando céntimos gratis.
 */

const RECURSOS = CONFIG.RECURSOS

/** Sin nadie trabajando el edificio rinde esto; a plazas llenas, el 100 %.
 *  Es lo que hace que asignar aldeanos importe de verdad y no sea un idle. */
const MINIMO_SIN_ALDEANOS = 0.25

/** Lo que se saca de un edificio en ruinas: un cuarto de lo que rendía a nivel 1. */
const RENDIMIENTO_RUINAS = 0.25

/** Bono de producción por edad: avanzar de edad se nota en la caja, no solo en el catálogo. */
const BONUS_POR_EDAD = 0.10

/** Fracciones pendientes por edificio (id -> decimales). NUNCA va al guardado. */
const sobrantes = new Map()

let ultimoAvisoLleno = 0
let silenciarAvisoLleno = false
let cambioPendiente = false

// ---------------------------------------------------------------- utilidades

const entero = (v) => Math.max(0, Math.floor((Number(v) || 0) + 1e-9))

/** Normaliza un coste suelto a los cuatro recursos, en enteros. */
function normalizar (coste) {
  const c = { madera: 0, piedra: 0, comida: 0, oro: 0 }
  if (!coste) return c
  for (const r of RECURSOS) {
    const v = Number(coste[r])
    if (Number.isFinite(v) && v > 0) c[r] = Math.ceil(v)
  }
  return c
}

/** Un solo aviso de cambio por tanda: el HUD no tiene que repintarse cuarenta veces por segundo. */
function notificarCambio () {
  if (cambioPendiente) return
  cambioPendiente = true
  queueMicrotask(() => {
    cambioPendiente = false
    events.emit(EV.RESOURCES_CHANGED, { resources: game.state.recursos, almacen: game.state.almacen })
  })
}

// ------------------------------------------------------------------- almacén

/** @returns {number} tope actual de ese recurso. */
export function capacidadDe (tipo) {
  return game.state.almacen?.[tipo] ?? 0
}

/**
 * Recalcula los topes: base + lo que aporten almacenes y graneros terminados.
 * Se llama al terminar, mejorar o derribar un edificio (y al cargar partida).
 */
export function recalcularAlmacen () {
  const tope = { ...CONFIG.ALMACEN_BASE }
  for (const b of game.state.buildings) {
    if (b.enObra) continue
    const d = def(b.tipo)
    if (!d || typeof d.capacidad !== 'function') continue
    const extra = d.capacidad(b.nivel || 1) || {}
    for (const r of RECURSOS) if (extra[r]) tope[r] += Math.round(extra[r])
  }
  game.state.almacen = tope
  // si un derribo baja el tope por debajo de lo guardado, se recorta:
  // el estado nunca puede tener más de lo que cabe.
  for (const r of RECURSOS) {
    if (game.state.recursos[r] > tope[r]) game.state.recursos[r] = tope[r]
  }
  notificarCambio()
  return tope
}

// -------------------------------------------------------------------- cobros

/** @param {any} coste @returns {boolean} */
export function puedePagar (coste) {
  const c = normalizar(coste)
  for (const r of RECURSOS) if (game.state.recursos[r] < c[r]) return false
  return true
}

/** Solo lo que falta, para pintarlo en rojo. @returns {{[r:string]:number}} */
export function faltaPara (coste) {
  const c = normalizar(coste)
  const falta = {}
  for (const r of RECURSOS) {
    const d = c[r] - game.state.recursos[r]
    if (d > 0) falta[r] = d
  }
  return falta
}

/**
 * Cobra un coste COMPLETO. Si no alcanza no descuenta nada, avisa y devuelve false.
 * @param {any} coste @param {string} [motivo] para el aviso ("mejorar serrería")
 * @returns {boolean}
 */
export function pagar (coste, motivo = '') {
  const falta = faltaPara(coste)
  if (Object.keys(falta).length) {
    events.emit(EV.RESOURCE_DENIED, { falta, motivo })
    return false
  }
  const c = normalizar(coste)
  for (const r of RECURSOS) game.state.recursos[r] -= c[r]
  notificarCambio()
  return true
}

// ------------------------------------------------------------------ ingresos

/**
 * Mete recursos en la caja, recortando por el tope del almacén.
 * @param {string} tipo @param {number} cantidad
 * @param {{x:number,z:number}} [origen] casilla de donde sale, para el "+5" flotante
 * @returns {number} lo que ha entrado DE VERDAD (0 si el almacén está lleno)
 */
export function ingresar (tipo, cantidad, origen = null) {
  if (!RECURSOS.includes(tipo)) return 0
  const pedido = entero(cantidad)
  if (pedido <= 0) return 0

  const hueco = Math.max(0, capacidadDe(tipo) - game.state.recursos[tipo])
  const entra = Math.min(pedido, hueco)
  if (entra > 0) {
    game.state.recursos[tipo] += entra
    game.state.stats.recolectado += entra
    events.emit(EV.RESOURCE_GAINED, { tipo, cantidad: entra, x: origen?.x, z: origen?.z })
    notificarCambio()
  }
  if (pedido > entra) {
    apartarExcedente(tipo, pedido - entra)
    avisarLleno(tipo)
  }
  return entra
}

// ------------------------------------------------------------------ excedente

/**
 * EL EXCEDENTE: la parte de lo que rebosa que los aldeanos consiguen apilar a la
 * intemperie. Con el almacén lleno ya no se pierde TODO (el 89-94 % de lo
 * producido en una noche se tiraba a la basura): una cuarta parte espera fuera y
 * entra sola en cuanto hay sitio. No es un segundo almacén infinito —tiene su
 * propio tope— pero convierte "volver de dormir" en un premio y no en un castigo.
 */
const FRACCION_EXCEDENTE = 0.25
/** El montón de fuera aguanta, como mucho, medio almacén de cada cosa. */
const TOPE_EXCEDENTE = 0.5

/** Bloque de excedente ya saneado (partidas antiguas incluidas). */
function monton () {
  const s = game.state
  if (!s.excedente || typeof s.excedente !== 'object') s.excedente = {}
  for (const r of RECURSOS) {
    const v = Number(s.excedente[r])
    s.excedente[r] = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
  }
  return s.excedente
}

export const excedenteDe = (tipo) => monton()[tipo] || 0

function apartarExcedente (tipo, sobra) {
  const guarda = Math.floor(sobra * FRACCION_EXCEDENTE)
  if (guarda <= 0) return
  const m = monton()
  const tope = Math.floor(capacidadDe(tipo) * TOPE_EXCEDENTE)
  m[tipo] = Math.min(tope, m[tipo] + guarda)
}

let recogiendo = false

/**
 * Mete en la caja lo que quepa del montón de fuera. Se llama en cada tick y al
 * volver a la partida: en cuanto gastas, el excedente rellena solo.
 * @returns {{[r:string]:number}} lo recogido de cada recurso
 */
export function recogerExcedente () {
  if (recogiendo) return {}
  const m = monton()
  const recogido = {}
  recogiendo = true
  for (const r of RECURSOS) {
    if (!m[r]) continue
    const hueco = Math.max(0, capacidadDe(r) - game.state.recursos[r])
    const pasa = Math.min(m[r], hueco)
    if (pasa <= 0) continue
    const entrado = ingresar(r, pasa)      // se descuenta solo lo que ha entrado de verdad
    m[r] = Math.max(0, m[r] - entrado)
    if (entrado > 0) recogido[r] = entrado
  }
  recogiendo = false
  return recogido
}

/** @returns {{[r:string]:number}} lo que ha entrado de cada uno. */
export function ingresarVarios (recursos, origen = null) {
  const entrado = {}
  if (!recursos) return entrado
  for (const r of RECURSOS) {
    if (!recursos[r]) continue
    const e = ingresar(r, recursos[r], origen)
    if (e > 0) entrado[r] = e
  }
  return entrado
}

/** Avisa del almacén lleno como mucho una vez por minuto: pesado no, útil sí. */
function avisarLleno (tipo) {
  if (silenciarAvisoLleno) return
  const ahora = Date.now()
  if (ahora - ultimoAvisoLleno < 60000) return
  ultimoAvisoLleno = ahora
  events.emit(EV.UI_TOAST, { texto: ICONO[tipo] + ' Almacén lleno: se está perdiendo ' + tipo, tipo: 'mal' })
}

// -------------------------------------------------------------------- gemas

/**
 * Suma o resta gemas. Restar más de las que hay NO deja el saldo en negativo:
 * no cobra nada, avisa con EV.RESOURCE_DENIED y devuelve false.
 * @param {number} cantidad positiva ingresa, negativa cobra
 * @returns {boolean} si la operación se ha hecho
 */
export function gemas (cantidad, motivo = '') {
  const n = Math.round(Number(cantidad) || 0)
  if (!n) return true
  const saldo = game.state.jugador.gemas || 0
  if (saldo + n < 0) {
    events.emit(EV.RESOURCE_DENIED, { falta: { gemas: -(saldo + n) }, motivo })
    return false
  }
  game.state.jugador.gemas = saldo + n
  notificarCambio()
  return true
}

// --------------------------------------------------------------- producción

/** Multiplicadores de tecnología por recurso, calculados una sola vez por consulta. */
function multiplicadoresTech () {
  const m = { madera: 1, piedra: 1, comida: 1, oro: 1 }
  const research = game.state.research || {}
  for (const id in research) {
    if (!research[id]) continue
    const e = TECNOLOGIAS[id]?.efecto
    if (!e || e.tipo !== 'produccion') continue
    if (e.objetivo === 'todas') { for (const r of RECURSOS) m[r] += e.valor }
    else if (m[e.objetivo] !== undefined) m[e.objetivo] += e.valor
  }
  return m
}

/** Bono acumulado del aura de los molinos sobre un edificio concreto. */
function auraSobre (b, auras) {
  let bonus = 0
  if (!auras.length) return bonus
  const c = centroDe(b)
  for (const a of auras) {
    if (a.afecta !== b.tipo) continue
    if (dist(c.x, c.z, a.x, a.z) <= a.radio) bonus += a.bonus
  }
  return bonus
}

/**
 * Desglose real de producción, edificio a edificio, en unidades por minuto.
 * Es la ÚNICA fuente de verdad: el tick y `produccionPorMinuto()` salen de aquí,
 * así que lo que enseña la interfaz es exactamente lo que entra en la caja.
 * @returns {Array<{id:string,tipo:string,recurso:string,porMinuto:number,x:number,z:number}>}
 */
function desglose () {
  const tech = multiplicadoresTech()
  const edad = 1 + BONUS_POR_EDAD * Math.max(0, ORDEN_EDADES.indexOf(game.state.age))

  // las auras se recogen una vez, no una por granja
  const auras = []
  for (const b of game.state.buildings) {
    if (b.enObra) continue
    const d = def(b.tipo)
    if (!d || !d.aura) continue
    const c = centroDe(b)
    auras.push({ x: c.x, z: c.z, radio: d.aura.radio, afecta: d.aura.afecta, bonus: d.aura.bonus(b.nivel || 1) })
  }

  const filas = []
  for (const b of game.state.buildings) {
    if (b.enObra) continue                       // en obra no se produce: la grúa no da madera
    const d = def(b.tipo)
    if (!d || !d.produce || typeof d.porMinuto !== 'function') continue

    const nivel = b.nivel || 1
    // En ruinas se rebusca entre los escombros: el rendimiento de un nivel 1
    // a un cuarto, y nada más. Es una pérdida del 95 % en los niveles altos, o
    // sea que perder una defensa duele igual... pero NO mata la partida.
    // Si las ruinas rindieran cero, una aldea arrasada con la caja vacía no
    // podría pagar ni una reparación y quedaría muerta para siempre.
    const base = b.arruinado ? d.porMinuto(1) * RENDIMIENTO_RUINAS : d.porMinuto(nivel)

    // reparto por aldeanos: del 25 % (nadie) al 100 % (todas las plazas llenas)
    const plazas = typeof d.plazas === 'function' ? Math.max(0, d.plazas(nivel)) : 0
    const trabajando = Math.min(plazas, (b.trabajadores || []).length)
    const faena = b.arruinado
      ? 1
      : (plazas > 0
          ? MINIMO_SIN_ALDEANOS + (1 - MINIMO_SIN_ALDEANOS) * (trabajando / plazas)
          : 1)

    // El ánimo lo calcula sim/villagers.js: con la despensa a cero los aldeanos
    // trabajan al 75 %. Se aplica aquí, que es el único sitio donde se decide
    // la producción, para que el número que ve el jugador sea el que entra.
    const animo = game.state.animo?.factor ?? 1
    const valor = base * faena * (1 + auraSobre(b, auras)) * tech[d.produce] * edad * animo
    const c = centroDe(b)
    filas.push({
      id: b.id,
      tipo: b.tipo,
      recurso: d.produce,
      porMinuto: Math.round(valor * 10) / 10,
      x: c.x,
      z: c.z
    })
  }
  return filas
}

/**
 * Lo que entra por minuto con TODO aplicado: nivel, aldeanos, aura del molino,
 * tecnologías y edad. @returns {{madera:number,piedra:number,comida:number,oro:number}}
 */
export function produccionPorMinuto () {
  const total = { madera: 0, piedra: 0, comida: 0, oro: 0 }
  for (const f of desglose()) total[f.recurso] += f.porMinuto
  for (const r of RECURSOS) total[r] = Math.round(total[r] * 10) / 10
  return total
}

/** Tick: acumula decimales por edificio y transfiere SOLO enteros al estado. */
function producir (dt) {
  const paso = Number(dt) || 0
  if (paso <= 0) return
  const vivos = new Set()

  for (const f of desglose()) {
    vivos.add(f.id)
    const acumulado = (sobrantes.get(f.id) || 0) + f.porMinuto * (paso / 60)
    const enteros = Math.floor(acumulado + 1e-9)
    if (enteros >= 1) {
      const entrado = ingresar(f.recurso, enteros, { x: f.x, z: f.z })
      // si el almacén no lo admitió, el sobrante se pierde: no se guarda deuda
      sobrantes.set(f.id, entrado >= enteros ? acumulado - enteros : 0)
    } else {
      sobrantes.set(f.id, acumulado)
    }
  }

  // edificios derribados: fuera del mapa de sobrantes, que no quede basura
  if (sobrantes.size > vivos.size) {
    for (const id of [...sobrantes.keys()]) if (!vivos.has(id)) sobrantes.delete(id)
  }

  recogerExcedente()   // en cuanto gastas algo, el montón de fuera rellena el hueco
}

// ----------------------------------------- producción con la app cerrada

/**
 * Quien coma recursos mientras la app está cerrada (hoy: la manutención del
 * ejército) se apunta aquí. El cobro offline los llama TRAMO A TRAMO, entre
 * ingreso e ingreso, para que producir y gastar ocurran a la vez y no uno
 * detrás del otro. Si se cobrasen las 8 h de golpe al final, con el granero
 * lleno entraría 0 y saldría todo: era el agujero de −27.416 de comida.
 * @param {(segundos:number)=>void} fn
 */
const consumidoresOffline = []
export function registrarConsumoOffline (fn) {
  if (typeof fn === 'function' && !consumidoresOffline.includes(fn)) consumidoresOffline.push(fn)
}

/** Tramos de 5 minutos: suficiente grano fino para que nadie se coma un almacén entero. */
const TRAMO_OFFLINE = 300

/**
 * Lo producido mientras el jugador no estaba (tope CONFIG.MAX_OFFLINE_HORAS),
 * intercalado con lo que se come el ejército en ese mismo rato. Se ingresa
 * respetando los topes de almacén y se anuncia con EV.OFFLINE_RESUMEN.
 */
function cobrarOffline (segundos) {
  const seg = Math.min(Math.max(0, Number(segundos) || 0), CONFIG.MAX_OFFLINE_HORAS * 3600)
  if (seg < 1) return

  const pm = produccionPorMinuto()
  const antes = { ...game.state.recursos }
  silenciarAvisoLleno = true    // el cartel ya dice lo que ha cabido; no hace falta regañar además

  const pasos = Math.max(1, Math.ceil(seg / TRAMO_OFFLINE))
  const dt = seg / pasos
  const resto = { madera: 0, piedra: 0, comida: 0, oro: 0 }
  for (let i = 0; i < pasos; i++) {
    for (const r of RECURSOS) {
      if (!pm[r]) continue
      resto[r] += pm[r] * (dt / 60)
      const enteros = Math.floor(resto[r] + 1e-9)
      if (enteros >= 1) { ingresar(r, enteros); resto[r] -= enteros }
    }
    for (const consumir of consumidoresOffline) consumir(dt)
    recogerExcedente()          // lo que comió la hueste deja sitio al montón de fuera
  }

  silenciarAvisoLleno = false

  // Se anuncia el SALDO real del rato fuera, no la producción bruta: si la
  // hueste se ha comido el grano que entró, el cartel no puede presumir de él.
  const recursos = {}
  const textos = []
  for (const r of RECURSOS) {
    const neto = game.state.recursos[r] - (antes[r] || 0)
    if (neto > 0) { recursos[r] = neto; textos.push(ICONO[r] + ' ' + neto) }
  }
  if (!textos.length) return

  events.emit(EV.OFFLINE_RESUMEN, { segundos: Math.round(seg), recursos, textos })
}

// -------------------------------------------------------------------- mercado

/**
 * Cambia un recurso por otro con la comisión del mercado construido.
 * @returns {{ok:boolean, entregado:number, recibido:number, comision:number, error?:string}}
 */
export function cambiar (de, a, cantidad) {
  const fallo = (error) => {
    events.emit(EV.UI_TOAST, { texto: error, tipo: 'mal' })
    return { ok: false, entregado: 0, recibido: 0, comision: 0, error }
  }
  if (!RECURSOS.includes(de) || !RECURSOS.includes(a) || de === a) return fallo('Ese cambio no tiene sentido')

  const cant = entero(cantidad)
  if (cant <= 0) return fallo('Indica cuánto quieres cambiar')

  const mercado = game.state.buildings.find(b => b.tipo === 'mercado' && !b.enObra)
  if (!mercado) return fallo('Necesitas un mercado para comerciar')

  const d = def('mercado')
  let comision = d.comision(mercado.nivel || 1)
  // las tecnologías de comercio traen valor negativo: abaratan la comisión
  const research = game.state.research || {}
  for (const id in research) {
    if (!research[id]) continue
    const e = TECNOLOGIAS[id]?.efecto
    if (e && e.tipo === 'comercio' && e.objetivo === 'comision') comision += e.valor
  }
  comision = Math.max(0.05, Math.round(comision * 100) / 100)

  const recibe = Math.floor(cant * (1 - comision))
  if (recibe <= 0) return fallo('Cambia una cantidad mayor: la comisión se lo come todo')
  if (!pagar({ [de]: cant }, 'mercado')) {
    return { ok: false, entregado: 0, recibido: 0, comision, error: 'Te falta ' + de }
  }

  const recibido = ingresar(a, recibe)
  return { ok: true, entregado: cant, recibido, comision }
}

// ----------------------------------------------------------------------- init

export function init () {
  monton()
  recalcularAlmacen()

  events.on(EV.TICK, (p) => producir(p && p.dt))

  // el tope del almacén cambia cuando termina o mejora un almacén/granero
  events.on(EV.BUILD_COMPLETED, recalcularAlmacen)
  events.on(EV.BUILD_UPGRADED, recalcularAlmacen)
  events.on(EV.BUILD_DEMOLISHED, recalcularAlmacen)
  events.on(EV.STATE_LOADED, () => { sobrantes.clear(); monton(); recalcularAlmacen(); recogerExcedente() })

  // lo emite src/main.js al arrancar, con los segundos que el jugador estuvo fuera
  events.on('offline:report', (p) => cobrarOffline(p && p.seconds))

  notificarCambio()
}
