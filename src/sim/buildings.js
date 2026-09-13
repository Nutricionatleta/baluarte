import { events, EV } from '../core/events.js'
import { CONFIG } from '../core/config.js'
import { game, getBuilding, nuevoId } from '../core/state.js'
import { huecoLibre, dentro } from '../core/grid.js'
import { def, ORDEN_EDADES, AGE_NOMBRE } from '../data/buildings.js'
import { TECNOLOGIAS } from '../data/techs.js'
// Única importación pactada fuera de core/ y data/: el banco. Los recursos no se
// tocan a mano en este fichero, se pagan y se cobran siempre por aquí.
import { pagar, puedePagar, faltaPara, ingresarVarios, gemas as moverGemas } from './resources.js'

/**
 * DUEÑO de game.state.buildings y game.state.obras. Nadie más los toca.
 *
 * Lo que hace este módulo: colocar, mejorar, mover, demoler, acelerar con gemas,
 * reparar, llevar la COLA DE OBRAS EN ESPERA, y terminar las obras cuyo reloj
 * haya vencido (también las que vencieron con la app cerrada). Habla con el
 * resto del juego solo por eventos.
 *
 * Los recursos NO se tocan aquí: se paga y se cobra por sim/resources.js.
 */

// --- textos ------------------------------------------------------------------

const RECURSOS = CONFIG.RECURSOS

/** Tipos de género femenino, para que los avisos suenen a español y no a robot. */
const FEMENINO = new Set([
  'casa', 'serreria', 'cantera', 'granja', 'mina_oro', 'arqueria', 'herreria',
  'universidad', 'torre_vigia', 'torre_ballesta', 'muralla', 'puerta'
])
const conArticulo = (tipo) => {
  const d = def(tipo)
  if (!d) return 'ese edificio'
  return `${FEMENINO.has(tipo) ? 'la' : 'el'} ${d.nombre}`
}
const NOMBRE_RECURSO = { madera: 'madera', piedra: 'piedra', comida: 'comida', oro: 'oro' }
const listaFalta = (falta) => Object.keys(falta).map(r => `${falta[r]} de ${NOMBRE_RECURSO[r]}`).join(' y ') || 'recursos'
/** Solo los nombres, sin cantidades: para avisos que no deben cambiar cada tick. */
const nombresFalta = (coste) => Object.keys(faltaPara(coste)).map(r => NOMBRE_RECURSO[r]).join(' y ') || 'material'

const toast = (texto, tipo = 'info') => events.emit(EV.UI_TOAST, { texto, tipo })
/** Aviso con lo que falta exactamente, que "no tienes recursos" no ayuda a nadie. */
const avisoFalta = (coste) => toast(`Te falta ${listaFalta(faltaPara(coste))}`, 'mal')
const ok = () => ({ ok: true, motivo: '', causa: '' })
/** `causa` la usa la interfaz para decidir si ofrece encargarlo para más tarde. */
const no = (motivo, causa = 'otro') => ({ ok: false, motivo, causa })

// --- lo que la ciencia cambia en las obras -----------------------------------

/**
 * Suma de los efectos de las tecnologías YA investigadas de un tipo. Se lee del
 * catálogo de data/ igual que hacen resources.js y army.js: los módulos de sim/
 * no se importan entre sí, así que cada uno aplica los efectos que le tocan.
 */
function bonoTech (tipo, objetivo = 'todas') {
  const r = game.state.research || {}
  let suma = 0
  for (const id in r) {
    if (!r[id]) continue
    const e = TECNOLOGIAS[id]?.efecto
    if (!e || e.tipo !== tipo) continue
    if (e.objetivo === objetivo || e.objetivo === 'todas') suma += e.valor
  }
  return suma
}

/**
 * Segundos REALES de una obra: lo que dice el catálogo, dividido por lo que
 * corren los andamios, las poleas y los maestros de obra. Nadie debe llamar a
 * `def(tipo).tiempo(n)` a pelo para encargar una obra: se usa esto.
 */
export function segundosDeObra (tipo, nivel = 1) {
  const d = def(tipo)
  if (!d) return 0
  return Math.max(1, Math.round(d.tiempo(Math.max(1, nivel)) / (1 + bonoTech('velocidadObra'))))
}

/** Qué tecnologías de defensa engordan cada edificio defensivo. */
const OBJETIVO_DEFENSA = {
  torre_vigia: 'torres', torre_ballesta: 'torres', castillo: 'torres',
  muralla: 'muralla', puerta: 'puerta'
}

/** Vida tope con las tecnologías de defensa ya aplicadas. */
export function vidaMaxima (tipo, nivel = 1) {
  const d = def(tipo)
  if (!d) return 1
  const objetivo = OBJETIVO_DEFENSA[tipo]
  const extra = objetivo ? bonoTech('defensa', objetivo) : 0
  return Math.max(1, Math.round(d.hp(Math.max(1, nivel)) * (1 + extra)))
}

/** Al investigar una defensa, la piedra ya levantada también engorda. */
function recalcularDefensas () {
  for (const b of game.state.buildings) {
    if (!OBJETIVO_DEFENSA[b.tipo] || !b.nivel) continue
    const nuevo = vidaMaxima(b.tipo, b.nivel)
    if (nuevo === b.hpMax) continue
    const parte = b.hpMax > 0 ? Math.min(1, (b.hp ?? b.hpMax) / b.hpMax) : 1
    b.hpMax = nuevo
    b.hp = Math.min(nuevo, Math.round(nuevo * parte))
  }
}

// --- lecturas del estado -----------------------------------------------------

/**
 * Nivel del edificio de ese tipo (el más alto YA conseguido). 0 si no hay ninguno.
 *
 * Mirar `b.nivel` y no `b.enObra` es lo que impide que la aldea se congele: una
 * construcción nueva vale 0 hasta que termina (su nivel es 0), pero un edificio
 * que se está MEJORANDO conserva el nivel que ya tenía. Estar en andamios quita
 * producción y entrenamiento, nunca requisitos ni camas.
 */
export function nivelDe (tipo) {
  let n = 0
  for (const b of game.state.buildings) {
    if (b.tipo !== tipo) continue
    const nivel = b.nivel || 0
    if (nivel > n) n = nivel
  }
  return n
}

/** Edificio que ocupa esa casilla, o null. */
export function edificioEn (x, z) {
  for (const b of game.state.buildings) {
    const an = b.ancho ?? 2; const al = b.alto ?? 2
    if (x >= b.x && x < b.x + an && z >= b.z && z < b.z + al) return b
  }
  return null
}

export const obrasActivas = () => game.state.obras

/** Cuántas obras a la vez: las que da el Ayuntamiento por su nivel. */
export function plazasDeObra () {
  const ayto = game.state.buildings.find(b => b.tipo === 'ayuntamiento')
  if (!ayto) return 1
  const d = def('ayuntamiento')
  return Math.max(1, d.obrasSimultaneas(Math.max(1, ayto.nivel)))
}

/** ¿Este edificio está funcionando? Ni en obra inicial, ni en ruinas. */
export const operativo = (b) => !!b && !b.enObra && !b.arruinado && b.nivel > 0
export const edificiosOperativos = (tipo) =>
  game.state.buildings.filter(b => b.tipo === tipo && operativo(b))

export const costeConstruir = (tipo) => def(tipo) ? def(tipo).coste(1) : null
export const costeMejorar = (id) => {
  const b = getBuilding(id); const d = b && def(b.tipo)
  return d ? d.coste(b.nivel + 1) : null
}
/** Un tercio del coste del nivel actual: reparar duele, pero menos que rehacer. */
export function costeReparar (id) {
  const b = getBuilding(id); const d = b && def(b.tipo)
  if (!d) return null
  const c = d.coste(Math.max(1, b.nivel))
  const r = {}
  for (const k of RECURSOS) r[k] = Math.ceil((c[k] || 0) / 3)
  return r
}

/** Todo lo invertido hasta el nivel n, recurso a recurso (para el 50 % de la demolición). */
function invertido (tipo, nivel) {
  const d = def(tipo)
  const total = { madera: 0, piedra: 0, comida: 0, oro: 0 }
  if (!d) return total
  for (let n = 1; n <= Math.max(1, nivel); n++) {
    const c = d.coste(n)
    for (const r of RECURSOS) total[r] += c[r] || 0
  }
  return total
}

// --- ¿puedo construir esto? --------------------------------------------------

/**
 * Lo que NO se arregla esperando: edad, requisitos y tope de unidades. Si esto
 * pasa, el encargo se puede dejar en la cola aunque hoy falten manos o dinero.
 * @returns {{ok:boolean, motivo:string, causa:string}}
 */
export function puedeEncargar (tipo) {
  const d = def(tipo)
  if (!d) return no('Ese edificio no existe.', 'inexistente')

  const iEdad = ORDEN_EDADES.indexOf(d.age)
  if (iEdad > ORDEN_EDADES.indexOf(game.state.age)) return no(`Solo se construye en la ${AGE_NOMBRE[d.age]}`, 'edad')

  const fallo = requisitosQueFaltan(d)
  if (fallo) return no(fallo, 'requisito')

  const tope = d.unico ? 1 : (d.max ?? Infinity)
  const tengo = game.state.buildings.filter(b => b.tipo === tipo).length
  if (tengo >= tope) {
    return no(d.unico ? `Solo puedes tener ${conArticulo(tipo)}` : `Ya tienes ${tope} (el máximo por ahora)`, 'tope')
  }
  return ok()
}

/** ¿Se puede EMPEZAR ya mismo? @returns {{ok:boolean, motivo:string, causa:string}} */
export function puedeConstruir (tipo) {
  const base = puedeEncargar(tipo)
  if (!base.ok) return base

  if (game.state.obras.length >= plazasDeObra()) {
    return no('No hay constructores libres: entra en la cola de espera.', 'obras')
  }

  const d = def(tipo)
  if (!puedePagar(d.coste(1))) return no(`Te falta ${listaFalta(faltaPara(d.coste(1)))}`, 'recursos')

  return ok()
}

/** Requisitos de otros edificios sin cumplir. Devuelve el motivo o null. */
function requisitosQueFaltan (d) {
  if (!d.requiere) return null
  for (const req in d.requiere) {
    const n = d.requiere[req]
    if (nivelDe(req) < n) return `Necesitas ${conArticulo(req)} a nivel ${n}`
  }
  return null
}

/**
 * Para el fantasma 3D: verde si el sitio vale y el edificio está desbloqueado.
 * Ni el dinero ni los constructores pintan aquí: si faltan, el encargo entra en
 * la cola de espera, así que la casilla es buena igual.
 */
export function validarColocacion (tipo, x, z) {
  const d = def(tipo)
  if (!d) return no('Ese edificio no existe.', 'inexistente')
  const base = puedeEncargar(tipo)
  if (!base.ok) return base
  if (!dentro(x, z) || !dentro(x + d.ancho - 1, z + d.alto - 1)) return no('Se sale del terreno', 'sitio')
  if (!huecoLibre(game.state, x, z, d.ancho, d.alto)) return no('Aquí ya hay algo', 'sitio')
  return ok()
}

// --- colocar, mejorar, mover, demoler ---------------------------------------

/**
 * Encarga una construcción. Si hay constructor libre y con qué pagar, empieza
 * en el acto; si no, la parcela queda reservada y el encargo espera su turno.
 * @returns {any|null} el edificio (en obra o reservado), o null si no se pudo.
 */
export function colocar (tipo, x, z, rot = 0) {
  x = Math.round(x); z = Math.round(z)
  const d = def(tipo)
  const v = validarColocacion(tipo, x, z)
  if (!v.ok) { toast(v.motivo, 'mal'); return null }
  if (cola().length >= MAX_COLA) { toast(`La cola está llena (${MAX_COLA} encargos)`, 'mal'); return null }

  const b = {
    id: nuevoId('b'),
    tipo,
    nivel: 0,                       // 0 = todavía en andamios; pasa a 1 al terminar
    x,
    z,
    rot: ((rot | 0) % 4 + 4) % 4,
    ancho: d.ancho,
    alto: d.alto,
    hp: vidaMaxima(tipo, 1),
    hpMax: vidaMaxima(tipo, 1),
    arruinado: false,
    enObra: true,
    enEspera: true,                 // reservado: todavía no se ha pagado ni empezado
    finObra: 0,
    trabajadores: []
  }
  game.state.buildings.push(b)
  const entrada = meterEnCola(b.id, 'construir')
  events.emit(EV.BUILD_PLACED, { building: b })
  arrancarCola(false)
  avisarEspera(entrada)                 // no avisa si ya ha arrancado
  return b
}

/** Encarga una mejora: empieza ya o se pone a la cola. @returns {boolean} */
export function mejorar (id) {
  const b = getBuilding(id)
  if (!b) return false
  const v = puedeEncargarMejora(id)
  if (!v.ok) { toast(v.motivo, 'mal'); return false }
  if (cola().length >= MAX_COLA) { toast(`La cola está llena (${MAX_COLA} encargos)`, 'mal'); return false }

  const entrada = meterEnCola(b.id, 'mejorar')
  arrancarCola(false)
  avisarEspera(entrada)
  return true
}

/**
 * Pone en marcha DE VERDAD una obra ya pagada: reloj, andamios y aviso al render.
 * Es el único sitio donde nace una entrada de `state.obras`.
 */
function empezarObra (b, esMejora) {
  const nivel = esMejora ? (b.nivel || 0) + 1 : 1
  const ahora = Date.now()
  const segundos = segundosDeObra(b.tipo, nivel)
  b.enEspera = false
  b.finObra = ahora + segundos * 1000
  if (esMejora) {
    b.mejorando = true
    // El Ayuntamiento se marca también `enObra` (deja de producir y de entrenar, y el
    // render le pone andamios), pero NO pierde su nivel: los requisitos, las camas y
    // las plazas de obra siguen contando. Antes congelaba la aldea hasta 8 horas.
    if (b.tipo === 'ayuntamiento') b.enObra = true
  } else {
    b.enObra = true
  }
  game.state.obras.push({
    id: nuevoId('o'), buildingId: b.id, tipo: esMejora ? 'mejorar' : 'construir',
    inicio: ahora, fin: b.finObra
  })
  events.emit(EV.BUILD_PLACED, { building: b, mejora: esMejora })
  events.emit(EV.SFX, { nombre: 'construir' })
}

// --- COLA DE OBRAS EN ESPERA -------------------------------------------------

/**
 * El jugador encarga lo que quiera; lo que no cabe en una plaza libre espera
 * aquí, en orden, y entra solo en cuanto un constructor termina.
 *
 * Dos reglas que no se negocian:
 *   1. El coste se cobra al EMPEZAR la obra de verdad, nunca al encargarla. Así
 *      se puede dejar encargada la semana sin quedarse sin caja para nada más.
 *   2. Si al llegarle el turno no hay con qué pagarla, la obra NO se cancela:
 *      se queda en la cola con su aviso y deja pasar a la siguiente que sí se
 *      pueda pagar, para que ningún constructor se quede de brazos cruzados.
 */
const MAX_COLA = 24

function cola () {
  const s = game.state
  if (!Array.isArray(s.colaObras)) s.colaObras = []
  return s.colaObras
}

const estaEnCola = (buildingId) => cola().some(e => e.buildingId === buildingId)

function meterEnCola (buildingId, tipo) {
  const entrada = { id: nuevoId('e'), buildingId, tipo, encargada: Date.now(), aviso: '' }
  cola().push(entrada)
  return entrada
}

function quitarDeCola (id) {
  game.state.colaObras = cola().filter(e => e.id !== id)
}

/** Nivel al que apunta un encargo (el que tendrá el edificio cuando acabe). */
function nivelDeEncargo (e, b) {
  return e.tipo === 'mejorar' ? (b.nivel || 0) + 1 : 1
}

function costeDeEncargo (e) {
  const b = getBuilding(e.buildingId)
  const d = b && def(b.tipo)
  return d ? d.coste(nivelDeEncargo(e, b)) : null
}

/**
 * Cuándo entrará cada encargo, encadenando los relojes de las plazas de obra.
 * Es una estimación honrada: no sabe si faltará material, pero sí cuánto durará
 * lo que hay por delante. @returns {Map<string, number>} id -> marca de tiempo
 */
function estimarInicios () {
  const ahora = Date.now()
  const plazas = plazasDeObra()
  const relojes = game.state.obras.map(o => Math.max(ahora, o.fin))
  while (relojes.length < plazas) relojes.push(ahora)
  const salida = new Map()
  for (const e of cola()) {
    const b = getBuilding(e.buildingId)
    if (!b) continue
    let i = 0
    for (let k = 1; k < relojes.length; k++) if (relojes[k] < relojes[i]) i = k
    salida.set(e.id, relojes[i])
    relojes[i] += segundosDeObra(b.tipo, nivelDeEncargo(e, b)) * 1000
  }
  return salida
}

/**
 * La cola tal y como hay que enseñarla: en orden, con su coste, lo que dura y
 * cuándo se calcula que entrará. Son copias: la cola solo la toca este módulo.
 * @returns {any[]}
 */
export function obrasEnEspera () {
  const ahora = Date.now()
  const inicios = estimarInicios()
  const salida = []
  cola().forEach((e, i) => {
    const b = getBuilding(e.buildingId)
    const d = b && def(b.tipo)
    if (!d) return
    const nivel = nivelDeEncargo(e, b)
    const inicio = inicios.get(e.id) || ahora
    const coste = d.coste(nivel)
    salida.push({
      id: e.id,
      buildingId: e.buildingId,
      tipo: e.tipo,
      posicion: i + 1,
      edificio: b.tipo,
      nombre: d.nombre,
      icono: d.icono,
      nivel,
      coste,
      pagable: puedePagar(coste),
      duracion: segundosDeObra(b.tipo, nivel),
      inicioEstimado: inicio,
      segundosParaEmpezar: Math.max(0, Math.round((inicio - ahora) / 1000)),
      aviso: e.aviso || ''
    })
  })
  return salida
}

/** Cuántos encargos esperan turno (rápido, sin estimaciones). */
export const obrasEnEsperaCuenta = () => cola().length

/**
 * Encarga algo para más tarde SIN mirar el bolsillo ni las manos libres.
 * `encolar('casa', x, z)` construye; `encolar('b12')` mejora ese edificio.
 * @returns {any|null} la entrada de la cola, o null si no se pudo encargar.
 */
export function encolar (tipoOId, x, z, rot = 0) {
  if (cola().length >= MAX_COLA) { toast(`La cola está llena (${MAX_COLA} encargos)`, 'mal'); return null }

  const existente = getBuilding(tipoOId)
  if (existente) {
    const v = puedeEncargarMejora(existente.id)
    if (!v.ok) { toast(v.motivo, 'mal'); return null }
    const entrada = meterEnCola(existente.id, 'mejorar')
    arrancarCola(false)
    avisarEspera(entrada)
    return entrada
  }

  const b = colocar(tipoOId, x, z, rot)
  if (!b) return null
  return cola().find(e => e.buildingId === b.id) || null
}

/** Cancela un encargo que todavía no ha empezado (nada que devolver: no se pagó). */
export function cancelarEspera (id) {
  const e = cola().find(x => x.id === id)
  if (!e) return false
  const b = getBuilding(e.buildingId)
  quitarDeCola(id)
  if (b && e.tipo === 'construir' && b.enEspera) {
    game.state.buildings = game.state.buildings.filter(x => x.id !== b.id)
    events.emit(EV.BUILD_DEMOLISHED, { buildingId: b.id })
  }
  toast('Encargo retirado de la cola', 'info')
  return true
}

/** Cambia un encargo de sitio en la cola. `pos` es 0 = el primero en entrar. */
export function moverEnCola (id, pos) {
  const lista = cola()
  const i = lista.findIndex(e => e.id === id)
  if (i < 0) return false
  const destino = Math.max(0, Math.min(lista.length - 1, Math.round(pos)))
  if (destino === i) return true
  const [e] = lista.splice(i, 1)
  lista.splice(destino, 0, e)
  arrancarCola(false)
  return true
}

/** Aviso de "esto se queda esperando", con el motivo escrito. */
function avisarEspera (entrada) {
  if (!entrada || !cola().includes(entrada)) return
  const b = getBuilding(entrada.buildingId)
  const d = b && def(b.tipo)
  if (!d) return
  const puesto = cola().indexOf(entrada) + 1
  const coste = costeDeEncargo(entrada)
  const sinMaterial = coste && !puedePagar(coste)
  entrada.aviso = sinMaterial ? `Faltan ${listaFalta(faltaPara(coste))}` : ''
  toast(sinMaterial
    ? `⏳ ${d.nombre} encargado: falta ${listaFalta(faltaPara(coste))}, entra en cuanto lo haya`
    : `⏳ ${d.nombre} en espera, puesto ${puesto} de la cola`, 'info')
}

/** Motivo por el que un encargo no puede arrancar hoy, o null si puede. */
function bloqueoDeEncargo (e, b) {
  const d = def(b.tipo)
  if (!d) return 'Ese edificio ya no existe'
  if (e.tipo === 'mejorar') {
    if (b.enObra || b.mejorando) return 'Ya está en obras'
    if (b.arruinado) return 'Está en ruinas: repáralo primero'
    if (b.nivel >= (d.maxNivel || 1)) return 'Ya está al máximo nivel'
    if (b.tipo !== 'ayuntamiento' && b.nivel + 1 > nivelDe('ayuntamiento')) {
      return `Necesita el Ayuntamiento a nivel ${b.nivel + 1}`
    }
  }
  return requisitosQueFaltan(d)
}

/**
 * Mete en las plazas libres todo lo que la cola permita. Se llama en cada tick,
 * al volver a la partida y cada vez que se toca la cola.
 * @returns {number} obras arrancadas
 */
function arrancarCola (avisar = true) {
  const lista = cola()
  if (!lista.length) return 0
  let libres = plazasDeObra() - game.state.obras.length
  if (libres <= 0) return 0

  let arrancadas = 0
  for (const e of [...lista]) {
    if (libres <= 0) break
    const b = getBuilding(e.buildingId)
    if (!b) { quitarDeCola(e.id); continue }
    const d = def(b.tipo)

    const bloqueo = bloqueoDeEncargo(e, b)
    if (bloqueo) { marcarAviso(e, bloqueo, avisar); continue }

    const esMejora = e.tipo === 'mejorar'
    const coste = d.coste(nivelDeEncargo(e, b))
    // El aviso va SIN cantidades a propósito: si no, cambiaría cada tick y el
    // jugador se comería un toast por segundo mientras junta la piedra.
    if (!puedePagar(coste)) { marcarAviso(e, `Falta ${nombresFalta(coste)}`, avisar); continue }
    if (!pagar(coste, `${esMejora ? 'mejorar' : 'construir'} ${d.nombre.toLowerCase()}`)) continue

    quitarDeCola(e.id)
    empezarObra(b, esMejora)
    if (avisar) toast(`${d.icono} Empieza ${d.nombre.toLowerCase()}${esMejora ? ` nivel ${b.nivel + 1}` : ''}`, 'info')
    libres--
    arrancadas++
  }
  return arrancadas
}

/** Un aviso por motivo y no uno por tick: el jugador no necesita que le griten. */
function marcarAviso (e, texto, avisar) {
  if (e.aviso === texto) return
  e.aviso = texto
  const b = getBuilding(e.buildingId)
  const d = b && def(b.tipo)
  if (avisar && d) toast(`⏳ ${d.nombre} espera: ${texto.toLowerCase()}`, 'info')
}

/** Lo que impide mejorar y NO se arregla esperando. @returns {{ok:boolean, motivo:string, causa:string}} */
export function puedeEncargarMejora (id) {
  const b = getBuilding(id)
  if (!b) return no('Ese edificio ya no está.', 'inexistente')
  const d = def(b.tipo)
  if (!d) return no('Ese edificio no existe.', 'inexistente')
  if (b.enObra || b.mejorando) return no('Ya está en obras', 'obras')
  if (estaEnCola(b.id)) return no('Ya está encargado y esperando turno', 'cola')
  if (b.arruinado) return no('Está en ruinas: repáralo primero', 'ruinas')
  if (b.nivel >= (d.maxNivel || 1)) return no('Ya está al máximo nivel', 'tope')

  // Nada puede pasar del Ayuntamiento: es la columna vertebral de la progresión.
  if (b.tipo !== 'ayuntamiento') {
    const ayto = nivelDe('ayuntamiento')
    if (b.nivel + 1 > ayto) return no(`Necesitas el Ayuntamiento a nivel ${b.nivel + 1}`, 'requisito')
  }
  const fallo = requisitosQueFaltan(d)
  if (fallo) return no(fallo, 'requisito')
  return ok()
}

/** ¿Se puede empezar la mejora AHORA? @returns {{ok:boolean, motivo:string, causa:string}} */
export function puedeMejorar (id) {
  const base = puedeEncargarMejora(id)
  if (!base.ok) return base
  const b = getBuilding(id)
  const d = def(b.tipo)
  if (game.state.obras.length >= plazasDeObra()) {
    return no('No hay constructores libres: entra en la cola de espera.', 'obras')
  }
  const c = d.coste(b.nivel + 1)
  if (!puedePagar(c)) return no(`Te falta ${listaFalta(faltaPara(c))}`, 'recursos')
  return ok()
}

/** Recolocar gratis: reorganizar la defensa es media diversión del juego. */
export function mover (id, x, z) {
  const b = getBuilding(id)
  if (!b) return false
  x = Math.round(x); z = Math.round(z)
  if (x === b.x && z === b.z) return true
  if (!huecoLibre(game.state, x, z, b.ancho ?? 2, b.alto ?? 2, b.id)) {
    toast('Ahí no cabe', 'mal')
    return false
  }
  const desde = { x: b.x, z: b.z }
  b.x = x; b.z = z
  // No hay evento de "movido" en EV todavía: se reutiliza BUILD_PLACED con la marca
  // `movido`, que el render debe leer para recolocar la malla en vez de crear otra.
  events.emit(EV.BUILD_PLACED, { building: b, movido: true, desde })
  return true
}

/** Demoler: devuelve la mitad de lo invertido. La confirmación la pide la interfaz. */
export function demoler (id) {
  const b = getBuilding(id)
  if (!b) return false
  if (b.tipo === 'ayuntamiento') { toast('El Ayuntamiento no se demuele', 'mal'); return false }

  // Una parcela reservada no se ha pagado todavía: devolverle la mitad de nada
  // sería imprimir recursos. Se retira el encargo y en paz.
  if (b.enEspera) return cancelarEspera(cola().find(e => e.buildingId === b.id)?.id)

  const total = invertido(b.tipo, Math.max(1, b.nivel))
  const mitad = {}
  for (const r of RECURSOS) mitad[r] = Math.floor((total[r] || 0) / 2)

  game.state.buildings = game.state.buildings.filter(x => x.id !== b.id)
  game.state.obras = game.state.obras.filter(o => o.buildingId !== b.id)
  game.state.colaObras = cola().filter(e => e.buildingId !== b.id)
  ingresarVarios(mitad, { x: b.x, z: b.z })

  events.emit(EV.BUILD_DEMOLISHED, { buildingId: b.id })
  events.emit(EV.SFX, { nombre: 'demoler' })
  toast(`${def(b.tipo).nombre} demolido. Recuperas la mitad.`, 'info')
  return true
}

// --- acelerar con gemas ------------------------------------------------------

/** Segundos que faltan para que termine la obra de ese edificio. */
export function segundosRestantes (id) {
  const b = getBuilding(id)
  if (!b || b.enEspera || !b.finObra) return 0
  return Math.max(0, (b.finObra - Date.now()) / 1000)
}

/** Precio en gemas de terminar ya. Enséñalo ANTES de cobrar. */
export function costeAcelerar (id) {
  const s = segundosRestantes(id)
  if (s <= 0) return 0
  return Math.ceil(s / CONFIG.SEG_POR_GEMA)
}

export function acelerar (id) {
  const b = getBuilding(id)
  // Lo que espera turno no se acelera con gemas: todavía no se ha pagado ni ha
  // empezado. Primero entra en una plaza (o se sube en la cola), luego corre.
  if (!b || b.enEspera || (!b.enObra && !b.mejorando)) return false
  const gemas = costeAcelerar(id)
  if (gemas <= 0) { terminarObraDe(b.id); return true }
  if ((game.state.jugador.gemas || 0) < gemas) {
    toast(`Te faltan gemas: cuesta ${gemas} 💎`, 'mal')
    return false
  }
  if (!moverGemas(-gemas, 'acelerar la obra')) return false
  b.finObra = Date.now()
  const o = game.state.obras.find(o => o.buildingId === b.id)
  if (o) o.fin = b.finObra
  terminarObraDe(b.id)
  return true
}

// --- vida y daños ------------------------------------------------------------

/** Lo llama el combate cuando te asaltan. @returns {any|null} el edificio */
export function dañar (id, cantidad) {
  const b = getBuilding(id)
  if (!b || b.arruinado) return null
  b.hp = Math.max(0, (b.hp ?? 0) - Math.max(0, cantidad))
  if (b.hp === 0) {
    b.arruinado = true
    b.trabajadores = []
    toast(`¡${def(b.tipo)?.nombre || 'Un edificio'} en ruinas!`, 'mal')
    events.emit(EV.SFX, { nombre: 'derrumbe' })
  }
  return b
}

/** Reparar: un tercio del coste del nivel y vuelve entero. */
export function reparar (id) {
  const b = getBuilding(id)
  if (!b) return false
  if (b.hp >= b.hpMax && !b.arruinado) return true
  const c = costeReparar(id)
  if (!pagar(c, `reparar ${def(b.tipo).nombre.toLowerCase()}`)) { avisoFalta(c); return false }
  b.hp = b.hpMax
  b.arruinado = false
  toast(`${def(b.tipo).nombre} reparado`, 'bien')
  events.emit(EV.SFX, { nombre: 'reparar' })
  return true
}

// --- terminar obras ----------------------------------------------------------

/** XP por obra: paga el tiempo de espera, no el nivel, así nada es "gratis". */
const xpPorObra = (segundos) => Math.max(3, Math.round(Math.sqrt(Math.max(1, segundos)) * 1.6))

function darXp (cantidad) {
  game.state.jugador.xp = (game.state.jugador.xp || 0) + cantidad
}

/**
 * Cierra la obra de un edificio. `avisar` a false cuando se completan muchas
 * de golpe al volver a la partida (un solo toast resumen y no veinte).
 */
function terminarObraDe (buildingId, avisar = true) {
  const b = getBuilding(buildingId)
  const obra = game.state.obras.find(o => o.buildingId === buildingId)
  game.state.obras = game.state.obras.filter(o => o.buildingId !== buildingId)
  if (!b) return null
  const d = def(b.tipo)
  const esMejora = obra ? obra.tipo === 'mejorar' : b.nivel > 0
  const nivelAnterior = b.nivel

  b.enObra = false
  b.mejorando = false
  b.finObra = 0
  b.nivel = esMejora ? b.nivel + 1 : 1

  // La mejora no cura: sube el tope y regala la diferencia, los daños se quedan.
  const nuevoMax = vidaMaxima(b.tipo, b.nivel)
  b.hp = Math.min(nuevoMax, (b.hp ?? nuevoMax) + Math.max(0, nuevoMax - (b.hpMax ?? nuevoMax)))
  b.hpMax = nuevoMax
  if (!esMejora) b.hp = nuevoMax

  const xp = xpPorObra(segundosDeObra(b.tipo, b.nivel))
  darXp(xp)
  game.state.stats.construidos = (game.state.stats.construidos || 0) + (esMejora ? 0 : 1)

  if (esMejora) events.emit(EV.BUILD_UPGRADED, { building: b, nivelAnterior })
  else events.emit(EV.BUILD_COMPLETED, { building: b })

  if (avisar) {
    events.emit(EV.SFX, { nombre: 'listo' })
    toast(esMejora
      ? `${d.icono} ${d.nombre} al nivel ${b.nivel} (+${xp} XP)`
      : `${d.icono} ${d.nombre} terminado (+${xp} XP)`, 'bien')
  }
  return b
}

/**
 * Obras vencidas. Compara siempre con Date.now(): así funciona igual con la app
 * abierta que si vuelves al día siguiente y te esperan cinco obras hechas.
 */
function revisarObras (avisar = true) {
  const ahora = Date.now()
  const vencidas = game.state.obras.filter(o => o.fin <= ahora)
  let n = 0
  for (const o of vencidas) {
    if (!getBuilding(o.buildingId)) {                       // huérfana: el edificio ya no está
      game.state.obras = game.state.obras.filter(x => x.id !== o.id)
      continue
    }
    terminarObraDe(o.buildingId, avisar)
    n++
  }
  // En cuanto se libera una plaza entra lo siguiente de la cola. También hay que
  // mirarla aunque no haya terminado nada: puede estar esperando por material.
  arrancarCola(avisar)
  return n
}

// --- partida nueva: la aldea inicial ----------------------------------------

/**
 * Plaza cuadrada: Ayuntamiento al norte, dos casas flanqueando, pozo y estandartes
 * en el centro, serrería y granja en las esquinas de atrás. Nada en fila india:
 * el primer minuto de juego tiene que entrar por los ojos.
 */
const ALDEA_INICIAL = [
  { tipo: 'ayuntamiento', x: 15, z: 13 },
  { tipo: 'casa', x: 12, z: 17 },
  { tipo: 'casa', x: 20, z: 17 },
  { tipo: 'serreria', x: 11, z: 12 },
  { tipo: 'granja', x: 20, z: 12 },
  { tipo: 'pozo', x: 16, z: 18 },
  { tipo: 'estandarte', x: 14, z: 17 },
  { tipo: 'estandarte', x: 19, z: 17 }
]

function montarAldeaInicial () {
  for (const p of ALDEA_INICIAL) {
    const d = def(p.tipo)
    if (!d || !huecoLibre(game.state, p.x, p.z, d.ancho, d.alto)) continue
    const b = {
      id: nuevoId('b'),
      tipo: p.tipo,
      nivel: 1,
      x: p.x,
      z: p.z,
      rot: 0,
      ancho: d.ancho,
      alto: d.alto,
      hp: d.hp(1),
      hpMax: d.hp(1),
      arruinado: false,
      enObra: false,      // la aldea de bienvenida viene terminada: cero esperas
      finObra: 0,
      trabajadores: []
    }
    game.state.buildings.push(b)
    // Doble aviso a propósito: el render puede escuchar cualquiera de los dos.
    events.emit(EV.BUILD_PLACED, { building: b, inicial: true })
    events.emit(EV.BUILD_COMPLETED, { building: b, inicial: true })
  }
  game.state.stats.construidos = ALDEA_INICIAL.length
  toast('Bienvenido a tu baluarte. Esta plaza es tuya: hazla grande.', 'bien')
}

// --- arranque ----------------------------------------------------------------

/** Rellena campos que falten en partidas viejas y tira obras huérfanas. */
function normalizar () {
  const s = game.state
  if (!Array.isArray(s.buildings)) s.buildings = []
  if (!Array.isArray(s.obras)) s.obras = []
  if (!Array.isArray(s.colaObras)) s.colaObras = []
  for (const b of s.buildings) {
    const d = def(b.tipo)
    if (!d) continue
    b.ancho = b.ancho ?? d.ancho
    b.alto = b.alto ?? d.alto
    b.rot = b.rot ?? 0
    b.hpMax = b.hpMax ?? vidaMaxima(b.tipo, Math.max(1, b.nivel))
    b.hp = b.hp ?? b.hpMax
    b.arruinado = !!b.arruinado
    b.enEspera = !!b.enEspera
    if (!Array.isArray(b.trabajadores)) b.trabajadores = []
  }
  s.buildings = s.buildings.filter(b => def(b.tipo))
  s.obras = s.obras.filter(o => s.buildings.some(b => b.id === o.buildingId))
  // La cola solo vale si lo que encarga sigue existiendo y no está ya en obras.
  s.colaObras = s.colaObras.filter(e =>
    e && e.id && s.buildings.some(b => b.id === e.buildingId) &&
    !s.obras.some(o => o.buildingId === e.buildingId))
  // Parcela reservada que se quedó sin su encargo (partida a medio guardar):
  // se retira el fantasma, que si no ocuparía sitio para siempre.
  s.buildings = s.buildings.filter(b => !b.enEspera || s.colaObras.some(e => e.buildingId === b.id))
}

let arrancado = false

function arranque () {
  normalizar()
  if (!game.state.buildings.length) {
    montarAldeaInicial()
    return
  }
  // Obras que vencieron con la app cerrada: se completan de golpe, con un solo
  // aviso. Detrás entra lo que estuviera esperando turno en la cola.
  const hechas = revisarObras(false)
  if (hechas === 1) toast('Mientras no estabas terminó una obra.', 'bien')
  else if (hechas > 1) toast(`Mientras no estabas terminaron ${hechas} obras.`, 'bien')
  const esperando = cola().length
  if (esperando) toast(`Quedan ${esperando} encargo${esperando > 1 ? 's' : ''} en la cola de obras.`, 'info')
}

export function init () {
  events.on(EV.TICK, () => revisarObras(true))
  // Una defensa recién investigada engorda también la piedra ya levantada.
  events.on(EV.TECH_RESEARCHED, () => recalcularDefensas())
  events.on(EV.BUILD_REQUESTED, ({ tipo, x, z, rot }) => colocar(tipo, x, z, rot))
  // Si se carga otra partida (importar, borrar y empezar), se vuelve a montar todo.
  events.on(EV.STATE_LOADED, () => { arrancado = true; arranque() })

  if (!arrancado) { arrancado = true; arranque() }   // main.js carga la partida antes que a mí
}
