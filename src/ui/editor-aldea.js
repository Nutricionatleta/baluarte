/**
 * MODO REORGANIZAR — la aldea de verdad, movida a mano.
 *
 * El dueño lo pidió con estas palabras: «que a nivel de distribución sea igual
 * que el juego, que se vea cómo quedará en la realidad, como si lo moviera de
 * normal». Así que aquí NO hay maqueta ni plano esquemático: se reorganiza
 * sobre la aldea en 3D, con sus edificios tal cual, y lo único que se añade son
 * las ayudas del editor (la rejilla de construcción, el fantasma verde o rojo,
 * las guías de alineación y el aviso de huecos).
 *
 * Cómo encaja con módulos que no son míos, todo por eventos:
 *   · `EV.BUILD_MODE {activo:true}` hace tres cosas en render/scene.js que aquí
 *     son justo lo que hace falta: congela la cámara, enciende la rejilla y —lo
 *     importante— deja de emitir `EV.UI_SELECT`, que es lo que abre la ficha del
 *     edificio en ui/hud.js. Por eso, dentro del modo, TOCAR NO ABRE FUNCIONES:
 *     ni ficha, ni mejorar, ni entrenar. Un toque solo elige.
 *   · `EV.GRID_TAP` va diciendo por qué casilla pasa el dedo; el principio y el
 *     final del gesto los escucho yo en el `pointerdown`/`pointerup` del lienzo.
 *   · `EV.BUILD_GHOST` pinta el volumen verde o rojo donde va a caer la pieza.
 *   · Mover, meter en la caja y sacar de ella los hace sim/buildings.js. La
 *     interfaz pide; la simulación decide.
 *
 * LA CAJA es el almacén de diseño: arrastras algo ahí y sale del tablero para
 * dejarte sitio. Mientras esté dentro NO produce ni defiende, y por eso no se
 * puede guardar con la caja llena: o se planta todo, o no se guarda.
 */
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { CONFIG } from '../core/config.js'
import { dentro, territorioLibre, limitesDelTerritorio } from '../core/grid.js'
import { def } from '../data/buildings.js'
import { el, hoja, toast, confirmar, vaciar, formatoNumero } from './styles.js'

// Excepción pactada, la misma que usa el taller: la interfaz PIDE a la
// simulación y nunca escribe en game.state por su cuenta.
import * as OBRA from '../sim/buildings.js'

/** sim/combat.js es de otro: se lee si está, y si no el editor funciona igual. */
let calcularDefensa = null

const G = CONFIG.GRID
const RECURSOS = CONFIG.RECURSOS
const MUROS = new Set(['muralla', 'puerta'])
const PINTABLES = new Set(['muralla', 'foso'])
/** Lo que el borrador puede quitar de un barrido: cercas, nunca tu granja. */
const BORRABLE = new Set(['muralla', 'puerta', 'foso'])

/* ===========================================================================
   Estado del modo
   =========================================================================== */

let activo = false
let nodos = {}
let herramienta = 'mover'        // mover | muralla | foso | quitar
let trazo = 'libre'              // libre | linea | rect
const elegidos = new Set()

let llevando = null              // pieza en el dedo: { id, tipo, ancho, alto, rot, x, z, valido, desdeCaja, grupo, agarre }
let pintando = null              // { tipo, x0, z0, celdas }
let quitando = null              // { ids:Set }
let gesto = null                 // { casillas, movido }

const pila = []                  // fotos para deshacer/rehacer
let pilaPos = -1
const PILA_MAX = 40

let analisis = { brechas: [], puntuacion: null, nota: '', cerrada: false, hayMuro: false }
let pendienteAnalisis = 0
let huecoMirado = 0

const estado = () => game.state
const edificios = () => estado().buildings || []
const edificioEn = (x, z) => {
  for (const b of edificios()) {
    const an = b.ancho ?? 2; const al = b.alto ?? 2
    if (x >= b.x && x < b.x + an && z >= b.z && z < b.z + al) return b
  }
  return null
}

/* ===========================================================================
   Deshacer y rehacer: fotos del estado real de la aldea
   =========================================================================== */

function apuntar () {
  if (pilaPos < pila.length - 1) pila.length = pilaPos + 1
  pila.push(OBRA.fotoReorganizacion())
  if (pila.length > PILA_MAX) pila.shift()
  pilaPos = pila.length - 1
  tocado()
}

function deshacer () {
  if (pilaPos <= 0) { toast('No queda nada que deshacer', 'info', 1400); return }
  pilaPos--
  OBRA.aplicarFoto(pila[pilaPos])
  limpiarSeleccion()
  tocado()
}

function rehacer () {
  if (pilaPos >= pila.length - 1) { toast('Ya estás en el último cambio', 'info', 1400); return }
  pilaPos++
  OBRA.aplicarFoto(pila[pilaPos])
  limpiarSeleccion()
  tocado()
}

function limpiarSeleccion () {
  const vivos = new Set(edificios().map(b => b.id))
  for (const id of [...elegidos]) if (!vivos.has(id)) elegidos.delete(id)
}

/** Algo ha cambiado: refrescar barras y volver a medir los huecos en el latido. */
function tocado () {
  refrescar()
  pendienteAnalisis = 3
}

/* ===========================================================================
   ¿Cabe aquí? — la comprobación del fantasma
   =========================================================================== */

function mapaOcupado (ignorar) {
  const m = new Uint8Array(G * G)
  for (const b of edificios()) {
    if (ignorar && ignorar.has(b.id)) continue
    const an = b.ancho ?? 2; const al = b.alto ?? 2
    for (let dz = 0; dz < al; dz++) {
      for (let dx = 0; dx < an; dx++) if (dentro(b.x + dx, b.z + dz)) m[(b.z + dz) * G + b.x + dx] = 1
    }
  }
  return m
}

function cabeEn (m, x, z, ancho, alto) {
  if (!dentro(x, z) || !dentro(x + ancho - 1, z + alto - 1)) return false
  if (!territorioLibre(estado(), x, z, ancho, alto)) return false
  for (let dz = 0; dz < alto; dz++) {
    for (let dx = 0; dx < ancho; dx++) if (m[(z + dz) * G + x + dx]) return false
  }
  return true
}

/** ¿Cabe TODO el grupo desplazado (dx, dz)? Devuelve también el porqué. */
function cabeGrupo (dx, dz) {
  if (!llevando) return { ok: false, motivo: '' }
  if (llevando.desdeCaja) {
    const m = mapaOcupado(null)
    const ok = cabeEn(m, llevando.x, llevando.z, llevando.ancho, llevando.alto)
    return { ok, motivo: ok ? '' : 'Ahí no cabe' }
  }
  const ids = new Set(llevando.grupo)
  const m = mapaOcupado(ids)
  for (const id of ids) {
    const b = edificios().find(x => x.id === id)
    if (!b) continue
    const nx = b.x + dx; const nz = b.z + dz
    const an = b.ancho ?? 2; const al = b.alto ?? 2
    if (!cabeEn(m, nx, nz, an, al)) {
      return { ok: false, motivo: !dentro(nx, nz) || !dentro(nx + an - 1, nz + al - 1) ? 'Se sale del valle' : !territorioLibre(estado(), nx, nz, an, al) ? 'Esa tierra no es tuya' : 'Ahí no cabe' }
    }
    for (let z = 0; z < al; z++) for (let x = 0; x < an; x++) m[(nz + z) * G + nx + x] = 1
  }
  return { ok: true, motivo: '' }
}

/** ¿La pieza queda a escuadra con alguna vecina? Es la guía de alineación. */
function alineacion (x, z, ancho, alto) {
  let n = 0
  for (const b of edificios()) {
    if (llevando && llevando.grupo.includes(b.id)) continue
    const an = b.ancho ?? 2; const al = b.alto ?? 2
    if (b.x === x || b.x + an === x + ancho || b.x + an / 2 === x + ancho / 2) n++
    else if (b.z === z || b.z + al === z + alto || b.z + al / 2 === z + alto / 2) n++
  }
  return n
}

/* ===========================================================================
   Gestos: el dedo sobre la aldea
   =========================================================================== */

const sobreInterfaz = (e) => {
  const t = e.target
  return !!(t && typeof t.closest === 'function' && t.closest('#hud, .panel, .hoja, .capa-hoja, .capa-dialogo, button, input'))
}

/** Dedos puestos ahora mismo: con dos o más manda la cámara, no el editor. */
const dedos = new Set()

function alBajarDedo (e) {
  if (!activo) return
  if (sobreInterfaz(e)) return
  dedos.add(e.pointerId)
  if (dedos.size > 1) { gesto = null; return }     // pinza: la cámara, no la pieza
  gesto = { casillas: 0, movido: false, suelo: null, celda: null }
}

function alSubirDedo (e) {
  dedos.delete(e.pointerId)
  if (!activo || !gesto || dedos.size) return
  const g = gesto
  gesto = null

  if (herramienta === 'mover') {
    if (llevando) {
      // Un toque limpio sobre un edificio no lo mueve: lo ELIGE. Arrastrarlo sí
      // lo lleva, que es como se mueve de normal en el juego.
      if (!g.movido && !llevando.desdeCaja) { const id = llevando.id; cancelarLlevar(); alternarElegido(id) } else soltarPieza()
    } else if (g.suelo && !g.movido && elegidos.size) {
      elegidos.clear()
      events.emit(EV.BUILD_MODE, { activo: true, tipo: null })    // fuera el fantasma
      tocado()
    }
    return
  }
  if (pintando) { soltarPincel(); return }
  if (quitando) { soltarQuitar() }
}

function alTocarCasilla (p) {
  if (!activo || !p) return
  // Sin gesto vivo no se hace nada: render/scene.js vuelve a emitir la casilla
  // al levantar el dedo, y sin esta guarda el edificio que acabas de soltar se
  // quedaría otra vez pegado al dedo.
  if (!gesto) return
  const x = p.x | 0; const z = p.z | 0
  gesto.casillas++
  // «Movido» es haber cambiado de CASILLA, no haber recibido dos eventos: al
  // levantar el dedo, render/scene.js vuelve a emitir la misma casilla y un
  // toque limpio se contaba como arrastre (y entonces no seleccionaba nada).
  if (gesto.celda == null) gesto.celda = `${x},${z}`
  else if (gesto.celda !== `${x},${z}`) gesto.movido = true

  if (herramienta === 'muralla' || herramienta === 'foso') {
    if (!pintando) pintando = { tipo: herramienta, x0: x, z0: z, celdas: [] }
    pintando.celdas = celdasDelTrazo(pintando, x, z)
    const m = mapaOcupado(null)
    fantasma(pintando.tipo, x, z, 1, 1, 0, cabeEn(m, x, z, 1, 1))
    refrescar()
    return
  }
  if (herramienta === 'quitar') {
    if (!quitando) quitando = { ids: new Set() }
    const b = edificioEn(x, z)
    if (b && BORRABLE.has(b.tipo)) quitando.ids.add(b.id)
    refrescar()
    return
  }

  // --- herramienta mover ---
  if (llevando) { arrastrarPieza(x, z); return }
  const b = edificioEn(x, z)
  if (!b) { if (gesto) gesto.suelo = { x, z } ; return }
  recogerPieza(b, x, z)
}

/* ===========================================================================
   Llevar una pieza en el dedo
   =========================================================================== */

function fantasma (tipo, x, z, ancho, alto, rot, valido) {
  events.emit(EV.BUILD_GHOST, { tipo, x, z, rot: rot | 0, ancho, alto, valido, motivo: valido ? '' : 'Ahí no cabe' })
}

function recogerPieza (b, x, z) {
  const grupo = elegidos.has(b.id) && elegidos.size > 1 ? [...elegidos] : [b.id]
  llevando = {
    id: b.id, tipo: b.tipo, ancho: b.ancho ?? 2, alto: b.alto ?? 2, rot: b.rot | 0,
    x: b.x, z: b.z, desdeCaja: false, grupo,
    agarre: { dx: x - b.x, dz: z - b.z },
    valido: true, motivo: ''
  }
  arrastrarPieza(x, z)
}

/** Saca algo de la caja y lo pone en el dedo, listo para plantar. */
function llevarDeLaCaja (ficha) {
  llevando = {
    id: ficha.id, tipo: ficha.tipo, ancho: ficha.ancho, alto: ficha.alto, rot: 0,
    x: ficha.desde.x, z: ficha.desde.z, desdeCaja: true, grupo: [ficha.id],
    agarre: { dx: Math.floor((ficha.ancho - 1) / 2), dz: Math.floor((ficha.alto - 1) / 2) },
    valido: true, motivo: ''
  }
  arrastrarPieza(ficha.desde.x + llevando.agarre.dx, ficha.desde.z + llevando.agarre.dz)
  events.emit(EV.CAMERA_FOCUS, { x: llevando.x, z: llevando.z })
  toast(`Toca dónde va ${def(ficha.tipo)?.nombre || 'el edificio'}`, 'info', 2600)
}

function arrastrarPieza (x, z) {
  if (!llevando) return
  const nx = x - llevando.agarre.dx
  const nz = z - llevando.agarre.dz
  llevando.x = nx; llevando.z = nz
  const base = edificios().find(b => b.id === llevando.id)
  const dx = llevando.desdeCaja ? 0 : nx - (base ? base.x : nx)
  const dz = llevando.desdeCaja ? 0 : nz - (base ? base.z : nz)
  llevando.dx = dx; llevando.dz = dz
  const v = cabeGrupo(dx, dz)
  llevando.valido = v.ok
  llevando.motivo = v.motivo
  fantasma(llevando.tipo, nx, nz, llevando.ancho, llevando.alto, llevando.rot, v.ok)
  refrescar()
}

function cancelarLlevar () {
  llevando = null
  events.emit(EV.BUILD_GHOST, { tipo: null, x: 0, z: 0, valido: false })
  events.emit(EV.BUILD_MODE, { activo: true, tipo: null })   // apaga el fantasma
  refrescar()
}

/** Suelta la pieza (o el grupo) donde esté el fantasma. */
function soltarPieza () {
  if (!llevando) return
  const l = llevando
  if (!l.valido) { toast(l.motivo || 'Ahí no cabe', 'mal', 1800); cancelarLlevar(); return }

  if (l.desdeCaja) {
    const r = OBRA.deLaCaja(l.id, l.x, l.z, l.rot)
    if (!r.ok) { toast(r.motivo, 'mal'); return }
    cancelarLlevar()
    apuntar()
    toast(`${def(l.tipo)?.icono || ''} Plantado`, 'bien', 1400)
    return
  }

  const movs = []
  for (const id of l.grupo) {
    const b = edificios().find(x => x.id === id)
    if (b) movs.push({ id, x: b.x + l.dx, z: b.z + l.dz, rot: id === l.id ? l.rot : (b.rot | 0) })
  }
  if (!movs.length || (!l.dx && !l.dz && l.rot === (edificios().find(b => b.id === l.id)?.rot | 0))) { cancelarLlevar(); return }
  const r = OBRA.aplicarPlan({ mover: movs })
  cancelarLlevar()
  if (!r.ok) { toast(r.errores[0] || 'Ahí no cabe', 'mal', 2400); return }
  apuntar()
}

function alternarElegido (id) {
  const b = edificios().find(x => x.id === id)
  if (!b) return
  // un toque en un muro se lleva el TRAMO entero: es lo que uno quiere
  const grupo = MUROS.has(b.tipo) || b.tipo === 'foso' ? tramoDe(b) : [b]
  const todos = grupo.every(q => elegidos.has(q.id))
  for (const q of grupo) { if (todos) elegidos.delete(q.id); else elegidos.add(q.id) }
  tocado()
  // En 3D no hay contorno de selección, así que se marca lo elegido con el
  // fantasma verde encima (que el render ya sabe pintar) y se dice en palabras.
  if (elegidos.has(b.id)) fantasma(b.tipo, b.x, b.z, b.ancho ?? 2, b.alto ?? 2, b.rot | 0, true)
  else if (!elegidos.size) events.emit(EV.BUILD_MODE, { activo: true, tipo: null })
  const d = def(b.tipo)
  if (todos) toast(`Soltado ${d ? d.nombre : 'el edificio'}`, 'info', 1400)
  else toast(grupo.length > 1 ? `✋ Tramo de ${grupo.length} ${d ? d.nombre.toLowerCase() : 'piezas'} elegido` : `✋ ${d ? d.nombre : 'Edificio'} elegido`, 'info', 1800)
}

/** Resumen de lo elegido, por tipos: «2 Muralla · 1 Casa». */
function resumenElegidos () {
  const cuenta = {}
  for (const b of edificios()) if (elegidos.has(b.id)) cuenta[b.tipo] = (cuenta[b.tipo] || 0) + 1
  return Object.keys(cuenta).map(t => `${cuenta[t]} ${def(t) ? def(t).nombre : t}`).join(' · ')
}

/** Tramo de muro o foso pegado a otro, para cogerlo entero de un toque. */
function tramoDe (pieza) {
  const familia = pieza.tipo === 'foso' ? new Set(['foso']) : MUROS
  const porCelda = new Map()
  for (const b of edificios()) {
    if (!familia.has(b.tipo)) continue
    const an = b.ancho ?? 1; const al = b.alto ?? 1
    for (let dz = 0; dz < al; dz++) for (let dx = 0; dx < an; dx++) porCelda.set(`${b.x + dx},${b.z + dz}`, b)
  }
  const vistos = new Set([pieza.id]); const salida = [pieza]; const cola = [pieza]
  while (cola.length) {
    const p = cola.pop()
    const an = p.ancho ?? 1; const al = p.alto ?? 1
    for (let dz = -1; dz <= al; dz++) {
      for (let dx = -1; dx <= an; dx++) {
        const q = porCelda.get(`${p.x + dx},${p.z + dz}`)
        if (!q || vistos.has(q.id)) continue
        vistos.add(q.id); salida.push(q); cola.push(q)
      }
    }
  }
  return salida
}

/* ===========================================================================
   Pintar muralla y foso · quitar tramos
   =========================================================================== */

function celdasDelTrazo (a, x, z) {
  if (trazo === 'libre') {
    if (!a.celdas.some(c => c.x === x && c.z === z)) a.celdas.push({ x, z })
    return a.celdas
  }
  const lista = []
  if (trazo === 'linea') {
    if (Math.abs(x - a.x0) >= Math.abs(z - a.z0)) {
      const p = Math.sign(x - a.x0) || 1
      for (let i = a.x0; i !== x + p; i += p) lista.push({ x: i, z: a.z0 })
    } else {
      const p = Math.sign(z - a.z0) || 1
      for (let i = a.z0; i !== z + p; i += p) lista.push({ x: a.x0, z: i })
    }
  } else {
    const x0 = Math.min(a.x0, x); const x1 = Math.max(a.x0, x)
    const z0 = Math.min(a.z0, z); const z1 = Math.max(a.z0, z)
    for (let i = x0; i <= x1; i++) { lista.push({ x: i, z: z0 }); if (z1 !== z0) lista.push({ x: i, z: z1 }) }
    for (let j = z0 + 1; j < z1; j++) { lista.push({ x: x0, z: j }); if (x1 !== x0) lista.push({ x: x1, z: j }) }
  }
  return lista
}

function soltarPincel () {
  const p = pintando
  pintando = null
  events.emit(EV.BUILD_MODE, { activo: true, tipo: null })
  if (!p || !p.celdas.length) { refrescar(); return }

  const hueco = huecosEnCola()
  const m = mapaOcupado(null)
  let puestos = 0; let sinCola = 0; let sinSitio = 0
  for (const c of p.celdas) {
    if (!cabeEn(m, c.x, c.z, 1, 1)) { sinSitio++; continue }
    if (puestos >= hueco) { sinCola++; continue }
    const b = OBRA.colocar(p.tipo, c.x, c.z, 0)
    if (!b) { sinCola++; continue }
    m[c.z * G + c.x] = 1
    puestos++
  }
  if (puestos) toast(`${def(p.tipo).icono} ${puestos} encargado${puestos > 1 ? 's' : ''}`, 'bien', 1800)
  if (sinCola) toast(`${sinCola} tramos no caben hoy en la cola de obras. Vuelve cuando se vacíe.`, 'info', 4200)
  else if (!puestos && sinSitio) toast('Ahí no cabe ni un tramo', 'mal', 1800)
  apuntar()
}

async function soltarQuitar () {
  const q = quitando
  quitando = null
  if (!q || !q.ids.size) { toast('El borrador solo quita muros, puertas y fosos', 'info', 2200); refrescar(); return }
  const n = q.ids.size
  const si = await confirmar({
    titulo: '¿Quitar?',
    texto: `Se demolerán ${n} tramo${n > 1 ? 's' : ''}. Te devuelven la mitad de lo invertido. Esto no se puede deshacer.`,
    si: 'Quitar', peligro: true
  })
  if (!si) { refrescar(); return }
  let fuera = 0
  for (const id of q.ids) if (OBRA.demoler(id)) fuera++
  toast(`🧹 ${fuera} tramo${fuera > 1 ? 's' : ''} fuera`, 'bien', 1600)
  apuntar()
}

/* ===========================================================================
   Espejo, giro y centrado — sobre lo elegido, o sobre la aldea entera
   =========================================================================== */

function piezasObjetivo () {
  return elegidos.size ? edificios().filter(b => elegidos.has(b.id)) : edificios().slice()
}

function transformar (modo) {
  const objetivo = piezasObjetivo()
  if (!objetivo.length) return
  let x0 = G; let z0 = G; let x1 = 0; let z1 = 0
  for (const b of objetivo) {
    const an = b.ancho ?? 2; const al = b.alto ?? 2
    x0 = Math.min(x0, b.x); z0 = Math.min(z0, b.z)
    x1 = Math.max(x1, b.x + an - 1); z1 = Math.max(z1, b.z + al - 1)
  }
  const movs = objetivo.map(b => {
    const an = b.ancho ?? 2; const al = b.alto ?? 2
    if (modo === 'espejoX') return { id: b.id, x: x0 + x1 - b.x - an + 1, z: b.z, rot: b.rot | 0 }
    if (modo === 'espejoZ') return { id: b.id, x: b.x, z: z0 + z1 - b.z - al + 1, rot: b.rot | 0 }
    // giro de 90°: la casilla gira; la huella la manda el catálogo, así que un
    // 2x1 puede quedar mal encajado. Si pasa, la validación lo canta y no entra.
    return { id: b.id, x: x0 + (z1 - (b.z + al - 1)), z: z0 + (b.x - x0), rot: ((b.rot | 0) + 1) % 4 }
  })
  const r = OBRA.aplicarPlan({ mover: movs })
  if (!r.ok) { toast(r.errores[0] || 'Así no encaja', 'mal', 3000); return }
  apuntar()
  toast(modo === 'girar' ? '↻ Girado' : '⇄ Espejo hecho', 'bien', 1400)
}

function centrarAldea () {
  const lista = edificios()
  if (!lista.length) return
  let x0 = G; let z0 = G; let x1 = 0; let z1 = 0
  for (const b of lista) {
    x0 = Math.min(x0, b.x); z0 = Math.min(z0, b.z)
    x1 = Math.max(x1, b.x + (b.ancho ?? 2) - 1); z1 = Math.max(z1, b.z + (b.alto ?? 2) - 1)
  }
  const t = limitesDelTerritorio(estado())
  const dx = Math.round((t.x0 + t.x1) / 2 - (x0 + x1) / 2)
  const dz = Math.round((t.z0 + t.z1) / 2 - (z0 + z1) / 2)
  if (!dx && !dz) { toast('Ya está centrada', 'info', 1400); return }
  const r = OBRA.aplicarPlan({ mover: lista.map(b => ({ id: b.id, x: b.x + dx, z: b.z + dz, rot: b.rot | 0 })) })
  if (!r.ok) { toast(r.errores[0] || 'Centrarla dejaría algo fuera de tu tierra', 'mal', 3000); return }
  apuntar()
  events.emit(EV.CAMERA_FOCUS, { x: (t.x0 + t.x1) / 2, z: (t.z0 + t.z1) / 2 })
  toast('🎯 Aldea centrada en tu territorio', 'bien', 1600)
}

/* ===========================================================================
   Aviso de huecos: por dónde se cuela el enemigo
   =========================================================================== */

function analizar () {
  const lista = edificios()
  if (!lista.length) { analisis = { brechas: [], puntuacion: null, nota: '', cerrada: false, hayMuro: false }; return }
  let bx0 = G; let bz0 = G; let bx1 = 0; let bz1 = 0
  for (const b of lista) {
    bx0 = Math.min(bx0, b.x); bz0 = Math.min(bz0, b.z)
    bx1 = Math.max(bx1, b.x + (b.ancho ?? 2) - 1); bz1 = Math.max(bz1, b.z + (b.alto ?? 2) - 1)
  }
  const x0 = Math.max(0, bx0 - 2); const z0 = Math.max(0, bz0 - 2)
  const x1 = Math.min(G - 1, bx1 + 2); const z1 = Math.min(G - 1, bz1 + 2)
  const W = x1 - x0 + 1; const H = z1 - z0 + 1

  const muro = new Uint8Array(W * H)
  for (const b of lista) {
    if (!MUROS.has(b.tipo)) continue
    const an = b.ancho ?? 1; const al = b.alto ?? 1
    for (let dz = 0; dz < al; dz++) {
      for (let dx = 0; dx < an; dx++) {
        const x = b.x + dx; const z = b.z + dz
        if (x < x0 || z < z0 || x > x1 || z > z1) continue
        muro[(z - z0) * W + (x - x0)] = 1
      }
    }
  }
  const fuera = new Uint8Array(W * H)
  const cola = new Int32Array(W * H)
  let cab = 0; let fin = 0
  const sembrar = (i) => { if (!muro[i] && !fuera[i]) { fuera[i] = 1; cola[fin++] = i } }
  for (let x = 0; x < W; x++) { sembrar(x); sembrar((H - 1) * W + x) }
  for (let z = 0; z < H; z++) { sembrar(z * W); sembrar(z * W + W - 1) }
  while (cab < fin) {
    const i = cola[cab++]
    const x = i % W; const z = (i / W) | 0
    if (x > 0) sembrar(i - 1)
    if (x < W - 1) sembrar(i + 1)
    if (z > 0) sembrar(i - W)
    if (z < H - 1) sembrar(i + W)
  }

  // ¿queda algo DE VERDAD dentro? Si no, la muralla no cierra por ningún lado y
  // no hay "brecha" que marcar: está todo fuera.
  let hayDentro = false
  for (let i = 0; i < muro.length && !hayDentro; i++) if (!muro[i] && !fuera[i]) hayDentro = true

  const vecinos = (i, x, z) => [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, z > 0 ? i - W : -1, z < H - 1 ? i + W : -1]
  const brechas = []
  if (hayDentro) {
    for (let i = 0; i < muro.length; i++) {
      if (muro[i] || !fuera[i]) continue
      const x = i % W; const z = (i / W) | 0
      let tocaMuro = false; let tocaDentro = false
      for (const j of vecinos(i, x, z)) {
        if (j < 0) continue
        if (muro[j]) tocaMuro = true
        else if (!fuera[j]) tocaDentro = true
      }
      if (tocaMuro && tocaDentro && brechas.length < 200) brechas.push({ x: x + x0, z: z + z0 })
    }
  } else {
    // sin recinto, lo útil es enseñar las PUNTAS sueltas de muralla: ahí está el portillo
    for (let i = 0; i < muro.length; i++) {
      if (!muro[i]) continue
      const x = i % W; const z = (i / W) | 0
      let seguidos = 0
      for (const j of vecinos(i, x, z)) if (j >= 0 && muro[j]) seguidos++
      if (seguidos >= 2) continue
      for (const j of vecinos(i, x, z)) {
        if (j < 0 || muro[j] || !fuera[j]) continue
        const c = { x: (j % W) + x0, z: ((j / W) | 0) + z0 }
        if (brechas.length < 200 && !brechas.some(b => b.x === c.x && b.z === c.z)) brechas.push(c)
      }
    }
  }

  let puntuacion = null; let nota = ''
  if (typeof calcularDefensa === 'function') {
    try {
      const r = calcularDefensa(estado())
      puntuacion = r.puntuacion; nota = r.nota
    } catch { /* si no se puede medir, el editor sigue valiendo */ }
  }
  const hayMuro = lista.some(b => MUROS.has(b.tipo))
  analisis = { brechas, puntuacion, nota, cerrada: hayMuro && hayDentro && !brechas.length, hayMuro }
}

function mirarSiguienteHueco () {
  if (!analisis.brechas.length) { toast(analisis.cerrada ? '✅ No hay huecos: la muralla cierra' : 'Todavía no hay muralla que revisar', 'info', 2200); return }
  const c = analisis.brechas[huecoMirado % analisis.brechas.length]
  huecoMirado++
  events.emit(EV.CAMERA_FOCUS, { x: c.x, z: c.z, zoom: 16 })
  toast(`⚠️ Hueco ${((huecoMirado - 1) % analisis.brechas.length) + 1} de ${analisis.brechas.length}: por aquí se cuela el enemigo`, 'mal', 2600)
}

/* ===========================================================================
   La caja (almacén de diseño)
   =========================================================================== */

function abrirCaja () {
  const lista = OBRA.caja()
  const cuerpo = el('div', { clase: 'col', estilo: { gap: '10px' } })
  let h = null

  cuerpo.appendChild(el('div', {
    clase: 'panel',
    estilo: { padding: '10px 12px', background: 'linear-gradient(180deg,#fbe9cf,#f0d6a8)' }
  }, [
    el('div', { clase: 'fila', estilo: { gap: '8px', alignItems: 'flex-start' } }, [
      el('span', { estilo: { fontSize: '1.5em', lineHeight: '1' }, texto: '⚠️' }),
      el('div', { clase: 'pequeño crece' }, [
        el('div', { estilo: { fontWeight: '800' }, texto: 'Lo que está en la caja no produce ni defiende' }),
        el('div', { clase: 'tenue', texto: 'Está fuera del tablero mientras recolocas. Hasta que no lo plantes todo, no se puede guardar.' })
      ])
    ])
  ]))

  if (!lista.length) {
    cuerpo.appendChild(el('p', { clase: 'tenue', texto: 'La caja está vacía. Elige un edificio en la aldea y pulsa «📦 A la caja» para quitarlo de en medio mientras recolocas.' }))
  }

  for (const f of lista) {
    cuerpo.appendChild(el('div', { clase: 'panel', estilo: { padding: '10px 12px', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '10px', alignItems: 'center' } }, [
      el('span', { estilo: { fontSize: '1.8em', lineHeight: '1' }, texto: f.icono }),
      el('div', {}, [
        el('div', { estilo: { fontWeight: '800' }, texto: f.nombre }),
        el('div', { clase: 'pequeño tenue', texto: `Nivel ${f.nivel} · ${f.ancho}×${f.alto} casillas` })
      ]),
      el('button', {
        clase: 'btn btn-oro', type: 'button', texto: 'Plantar',
        estilo: { minHeight: '48px', minWidth: '86px' },
        onclick: () => { h?.cerrar(); herramienta = 'mover'; llevarDeLaCaja(f) }
      })
    ]))
  }

  h = hoja({ titulo: `📦 La caja (${lista.length})`, contenido: cuerpo })
}

function aLaCajaLoElegido () {
  const ids = elegidos.size ? [...elegidos] : (llevando ? [llevando.id] : [])
  if (!ids.length) { toast('Antes toca el edificio que quieras guardar', 'info', 2200); return }
  let n = 0; let fallo = ''
  for (const id of ids) {
    const r = OBRA.aLaCaja(id)
    if (r.ok) n++
    else fallo = r.motivo
  }
  elegidos.clear()
  cancelarLlevar()
  if (n) { apuntar(); toast(`📦 ${n} a la caja. No produce ni defiende mientras esté ahí.`, 'bien', 2800) }
  if (fallo) toast(fallo, 'mal', 2600)
}

/* ===========================================================================
   Diseños guardados
   =========================================================================== */

function abrirDisenos () {
  const lista = OBRA.disenosGuardados()
  const cuerpo = el('div', { clase: 'col', estilo: { gap: '10px' } })
  let h = null

  const nombre = el('input', {
    type: 'text', maxlength: '24', placeholder: 'El de siempre, el de guerra…',
    estilo: {
      width: '100%', minHeight: '48px', padding: '0 12px', boxSizing: 'border-box',
      border: '2px solid var(--madera)', borderRadius: 'var(--r-m)',
      background: 'var(--pergamino-claro)', color: 'var(--tinta)', font: 'inherit', fontWeight: '700'
    }
  })

  cuerpo.appendChild(el('div', { clase: 'panel', estilo: { padding: '10px 12px' } }, [
    el('div', { clase: 'pequeño tenue', estilo: { fontWeight: '800', marginBottom: '7px' }, texto: '💾 Guardar la distribución de ahora con un nombre' }),
    nombre,
    el('button', {
      clase: 'btn btn-oro', type: 'button', texto: 'Guardar este diseño',
      estilo: { minHeight: '48px', width: '100%', marginTop: '8px' },
      onclick: () => {
        if (OBRA.cuantoEnLaCaja()) { toast('Primero planta lo que queda en la caja', 'mal'); return }
        const r = OBRA.guardarDiseno(nombre.value || `Diseño ${lista.length + 1}`)
        if (!r.ok) { toast(r.motivo, 'mal'); return }
        toast('💾 Diseño guardado', 'bien')
        h?.cerrar(); refrescar()
      }
    })
  ]))

  if (!lista.length) {
    cuerpo.appendChild(el('p', { clase: 'tenue', texto: 'Todavía no tienes diseños guardados. Guarda este y luego prueba otro: cambiar de uno a otro es cosa de dos toques.' }))
  }

  for (const d of lista) {
    const fila = el('div', { clase: 'panel', estilo: { padding: '10px 12px', display: 'grid', gap: '8px' } })
    fila.appendChild(el('div', { clase: 'fila', estilo: { gap: '8px', alignItems: 'center' } }, [
      el('span', { estilo: { fontSize: '1.5em' }, texto: d.activo ? '📌' : '📐' }),
      el('div', { clase: 'crece' }, [
        el('div', { estilo: { fontWeight: '800' }, texto: d.nombre }),
        el('div', { clase: 'pequeño tenue', texto: `${d.piezas} piezas${d.activo ? ' · en uso' : ''}` })
      ])
    ]))
    fila.appendChild(el('div', { estilo: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px' } }, [
      el('button', {
        clase: 'btn btn-oro', type: 'button', texto: 'Cambiar a este',
        estilo: { minHeight: '48px' },
        onclick: () => {
          if (OBRA.cuantoEnLaCaja()) { toast('Primero planta lo que queda en la caja', 'mal'); return }
          const r = OBRA.cargarDiseno(d.id)
          if (!r) { toast('Ese diseño ya no está', 'mal'); return }
          const movs = r.piezas.map(p => ({ id: p.id, x: p.x, z: p.z, rot: p.rot }))
          const ap = OBRA.aplicarPlan({ mover: movs })
          if (!ap.ok) { toast(ap.errores[0] || 'Ese diseño no encaja con la aldea de hoy', 'mal', 3600); return }
          OBRA.marcarDisenoActivo(d.id)
          apuntar()
          h?.cerrar()
          toast(`📐 «${d.nombre}» puesto. Revísalo y dale a Guardar.`, 'bien', 3000)
          for (const a of r.avisos) toast(a, 'info', 4200)
        }
      }),
      el('button', {
        clase: 'btn btn-piedra', type: 'button', texto: '🗑️', 'aria-label': `Borrar ${d.nombre}`,
        estilo: { minWidth: '56px', minHeight: '48px' },
        onclick: async () => {
          const si = await confirmar({ titulo: '¿Borrar el diseño?', texto: `«${d.nombre}» se pierde. Tu aldea no se toca.`, si: 'Borrar', peligro: true })
          if (!si) return
          OBRA.borrarDiseno(d.id)
          h?.cerrar(); abrirDisenos(); refrescar()
        }
      })
    ]))
    cuerpo.appendChild(fila)
  }

  h = hoja({ titulo: '📐 Tus diseños', contenido: cuerpo })
}

/* ===========================================================================
   Guardar y descartar
   =========================================================================== */

const huecosEnCola = () => {
  try { return typeof OBRA.huecosEnCola === 'function' ? OBRA.huecosEnCola() : 24 } catch { return 24 }
}

function guardar () {
  const r = OBRA.guardarReorganizacion()
  if (!r.ok) {
    toast(r.errores[0] || 'Así no se puede guardar', 'mal', 4200)
    return
  }
  const activoId = OBRA.disenoActivo()
  if (activoId) OBRA.guardarDiseno(nombreDe(activoId), null, activoId)
  toast('✅ Aldea guardada tal y como la ves', 'bien', 2600)
  cerrar(true)
}

const nombreDe = (id) => (OBRA.disenosGuardados().find(d => d.id === id) || {}).nombre || 'Mi diseño'

async function descartar () {
  const si = await confirmar({
    titulo: '¿Descartar los cambios?',
    texto: 'La aldea vuelve exactamente a como estaba al entrar, incluido lo que hayas metido en la caja.',
    si: 'Descartar', peligro: true
  })
  if (!si) return
  OBRA.descartarReorganizacion()
  cerrar(false)
}

/* ===========================================================================
   Interfaz: una franja arriba y la botonera abajo, con la aldea entera en medio
   =========================================================================== */

const HERRAMIENTAS = [
  { id: 'mover', icono: '🖐️', texto: 'Mover', ayuda: 'Arrastra un edificio para moverlo. Un toque lo elige (y en un muro, coge el tramo entero).' },
  { id: 'muralla', icono: '🧱', texto: 'Muro', ayuda: 'Pinta muralla arrastrando el dedo.' },
  { id: 'foso', icono: '🕳️', texto: 'Foso', ayuda: 'Pinta foso: no cierra el paso, lo hace lento y deja al enemigo a tiro.' },
  { id: 'quitar', icono: '🧹', texto: 'Quitar', ayuda: 'Barre muros y fosos para demolerlos.' },
  { id: 'mas', icono: '⋯', texto: 'Más', ayuda: '' }
]

const TRAZOS = [
  { id: 'libre', texto: '✏️ Libre' },
  { id: 'linea', texto: '📏 Línea' },
  { id: 'rect', texto: '⬛ Recinto' }
]

function asegurarCss () {
  if (document.getElementById('css-editor-aldea')) return
  const s = document.createElement('style')
  s.id = 'css-editor-aldea'
  // Lo único que este módulo escribe en CSS, porque ui/styles.js no conoce el
  // editor: mientras se reorganiza, el HUD normal y el cartel de la guía (que
  // vive a z-index 70) se apartan para dejar ver la aldea.
  s.textContent = `
#hud.editando > .capa-guia, #hud.editando > .hud-barra,
#hud.editando > .hud-minis, #hud.editando > .hud-abajo { display: none !important; }
.editor-barra button:disabled { opacity: .5; }
`
  document.head.appendChild(s)
}

function botonHerramienta (h) {
  return el('button', {
    clase: 'btn btn-piedra', type: 'button', 'aria-label': h.texto, datos: { herr: h.id },
    estilo: { minHeight: '54px', padding: '4px 2px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px' },
    onclick: () => {
      if (h.id === 'mas') { abrirMas(); return }
      herramienta = h.id
      cancelarLlevar()
      if (h.id !== 'mover') elegidos.clear()
      events.emit(EV.BUILD_MODE, { activo: true, tipo: null })
      refrescar()
      if (h.ayuda) toast(h.ayuda, 'info', 2600)
    }
  }, [
    el('span', { estilo: { fontSize: '1.35em', lineHeight: '1' }, texto: h.icono }),
    el('span', { estilo: { fontSize: '.58em', fontWeight: '800', lineHeight: '1' }, texto: h.texto })
  ])
}

function abrirMas () {
  let h = null
  const boton = (icono, texto, fn) => el('button', {
    clase: 'btn btn-piedra', type: 'button',
    estilo: { minHeight: '56px', display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-start', padding: '0 12px' },
    onclick: () => { h?.cerrar(); fn() }
  }, [el('span', { estilo: { fontSize: '1.3em' }, texto: icono }), el('span', { estilo: { fontWeight: '800', textAlign: 'left' }, texto })])

  const sel = elegidos.size ? 'lo elegido' : 'toda la aldea'
  h = hoja({
    titulo: '🧰 Herramientas',
    contenido: el('div', { estilo: { display: 'grid', gap: '8px' } }, [
      boton('⚠️', analisis.brechas.length ? `Ver los ${analisis.brechas.length} huecos` : 'Revisar los huecos', mirarSiguienteHueco),
      boton('🎯', 'Centrar la aldea en tu territorio', centrarAldea),
      boton('⇄', `Espejo horizontal (${sel})`, () => transformar('espejoX')),
      boton('⇅', `Espejo vertical (${sel})`, () => transformar('espejoZ')),
      boton('↻', `Girar 90° (${sel})`, () => transformar('girar')),
      boton('📐', 'Tus diseños guardados', abrirDisenos),
      boton('⬜', 'Soltar la selección', () => { elegidos.clear(); tocado() })
    ])
  })
}

function montar () {
  asegurarCss()
  const raiz = document.getElementById('hud') || document.body
  raiz.classList.add('editando')

  // --- franja de arriba ---
  nodos.nota = el('div', { clase: 'pequeño', estilo: { fontWeight: '800', textAlign: 'right', lineHeight: '1.15', flex: 'none' } })
  nodos.arriba = el('div', {
    clase: 'panel editor-barra',
    estilo: {
      position: 'fixed', zIndex: '40',
      top: 'calc(var(--seg-arriba) + 6px)', left: 'calc(var(--seg-izq) + 6px)', right: 'calc(var(--seg-der) + 6px)',
      display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px'
    }
  }, [
    el('button', {
      clase: 'btn btn-piedra', type: 'button', texto: '✕', 'aria-label': 'Salir sin guardar',
      estilo: { minWidth: '48px', minHeight: '48px', flex: 'none' },
      onclick: () => descartar()
    }),
    el('div', { clase: 'crece', estilo: { minWidth: '0' } }, [
      el('div', { estilo: { fontWeight: '900', lineHeight: '1.1' }, texto: '🧭 Reorganizando' }),
      el('div', { clase: 'pequeño tenue', texto: 'Nada es definitivo hasta que guardes' })
    ]),
    nodos.nota
  ])

  // --- franja de abajo: aviso, herramientas y acciones ---
  nodos.aviso = el('div', { clase: 'pequeño', estilo: { fontWeight: '700', lineHeight: '1.25', minHeight: '18px' } })

  nodos.contexto = el('div', { estilo: { display: 'none', gap: '6px', alignItems: 'center', marginTop: '6px' } })

  const tira = el('div', { estilo: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '5px', marginTop: '6px' } })
  nodos.herramientas = {}
  for (const h of HERRAMIENTAS) {
    const b = botonHerramienta(h)
    if (h.id !== 'mas') nodos.herramientas[h.id] = b
    tira.appendChild(b)
  }

  nodos.deshacer = el('button', { clase: 'btn btn-piedra', type: 'button', texto: '↶', 'aria-label': 'Deshacer', estilo: { minWidth: '52px', minHeight: '52px', fontSize: '1.3em' }, onclick: deshacer })
  nodos.rehacer = el('button', { clase: 'btn btn-piedra', type: 'button', texto: '↷', 'aria-label': 'Rehacer', estilo: { minWidth: '52px', minHeight: '52px', fontSize: '1.3em' }, onclick: rehacer })
  nodos.caja = el('button', {
    clase: 'btn btn-piedra', type: 'button', 'aria-label': 'La caja',
    estilo: { minWidth: '58px', minHeight: '52px', padding: '2px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
    onclick: () => abrirCaja()
  }, [
    el('span', { estilo: { fontSize: '1.2em', lineHeight: '1' }, texto: '📦' }),
    el('span', { clase: 'caja-n', estilo: { fontSize: '.58em', fontWeight: '900', lineHeight: '1.1' }, texto: 'CAJA' })
  ])
  nodos.guardar = el('button', { clase: 'btn btn-oro', type: 'button', texto: 'Guardar', estilo: { minHeight: '52px', fontWeight: '900' }, onclick: () => guardar() })

  nodos.acciones = el('div', { estilo: { display: 'grid', gridTemplateColumns: 'auto auto auto 1fr', gap: '6px', marginTop: '6px' } },
    [nodos.deshacer, nodos.rehacer, nodos.caja, nodos.guardar])

  nodos.abajo = el('div', {
    clase: 'panel editor-barra',
    estilo: {
      position: 'fixed', zIndex: '40',
      left: 'calc(var(--seg-izq) + 6px)', right: 'calc(var(--seg-der) + 6px)', bottom: 'calc(var(--seg-abajo) + 6px)',
      padding: '8px 8px 10px'
    }
  }, [nodos.aviso, nodos.contexto, tira, nodos.acciones])

  raiz.append(nodos.arriba, nodos.abajo)
}

function refrescar () {
  if (!activo || !nodos.abajo) return

  for (const id in nodos.herramientas) {
    const b = nodos.herramientas[id]
    const on = herramienta === id
    b.style.background = on ? 'linear-gradient(180deg,var(--oro-claro),var(--oro))' : ''
    b.style.borderColor = on ? 'var(--oro-oscuro)' : ''
  }
  nodos.deshacer.disabled = pilaPos <= 0
  nodos.rehacer.disabled = pilaPos >= pila.length - 1

  const enCaja = OBRA.cuantoEnLaCaja()
  nodos.caja.querySelector('.caja-n').textContent = enCaja ? `CAJA ${enCaja}` : 'CAJA'
  nodos.caja.style.background = enCaja ? 'linear-gradient(180deg,#f0b3a8,#d4564a)' : ''
  nodos.caja.style.borderColor = enCaja ? 'var(--rojo-oscuro)' : ''

  // --- la tira contextual ---
  const ctx = nodos.contexto
  vaciar(ctx)
  const pintaMuro = PINTABLES.has(herramienta)
  if (pintaMuro) {
    ctx.style.display = 'flex'
    for (const t of TRAZOS) {
      const on = trazo === t.id
      ctx.appendChild(el('button', {
        clase: 'btn btn-piedra', type: 'button', texto: t.texto,
        estilo: { flex: '1', minHeight: '44px', fontSize: '.78em', background: on ? 'linear-gradient(180deg,var(--oro-claro),var(--oro))' : '', borderColor: on ? 'var(--oro-oscuro)' : '' },
        onclick: () => { trazo = t.id; refrescar() }
      }))
    }
  } else if (llevando && llevando.desdeCaja) {
    ctx.style.display = 'flex'
    ctx.appendChild(el('button', {
      clase: 'btn btn-oro', type: 'button', texto: '📍 Plantar aquí',
      estilo: { flex: '1', minHeight: '48px' },
      onclick: () => soltarPieza()
    }))
    ctx.appendChild(el('button', {
      clase: 'btn btn-piedra', type: 'button', texto: 'Luego',
      estilo: { minHeight: '48px', flex: 'none' },
      onclick: () => cancelarLlevar()
    }))
  } else if (elegidos.size) {
    ctx.style.display = 'flex'
    ctx.appendChild(el('span', {
      clase: 'pequeño',
      estilo: { fontWeight: '800', flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      texto: `✋ ${resumenElegidos()}`
    }))
    ctx.appendChild(el('button', { clase: 'btn btn-piedra', type: 'button', texto: '📦 A la caja', estilo: { minHeight: '44px', fontSize: '.8em' }, onclick: () => aLaCajaLoElegido() }))
    ctx.appendChild(el('button', { clase: 'btn btn-piedra', type: 'button', texto: '↻', 'aria-label': 'Girar', estilo: { minWidth: '48px', minHeight: '44px' }, onclick: () => transformar('girar') }))
    ctx.appendChild(el('button', { clase: 'btn btn-piedra', type: 'button', texto: 'Soltar', estilo: { minHeight: '44px', fontSize: '.8em' }, onclick: () => { elegidos.clear(); tocado() } }))
  } else {
    ctx.style.display = 'none'
  }

  // --- el aviso de abajo: lo que está pasando ahora mismo ---
  const falta = OBRA.faltaPorColocar()
  let txt = ''
  let color = ''
  if (falta) {
    txt = `📦 ${falta.texto} No se guarda hasta que esté todo plantado.`
    color = 'var(--rojo)'
  } else if (llevando) {
    const a = alineacion(llevando.x, llevando.z, llevando.ancho, llevando.alto)
    txt = llevando.valido
      ? `✅ Cabe aquí${a ? ` · a escuadra con ${a} vecino${a > 1 ? 's' : ''}` : ''}`
      : `⛔ ${llevando.motivo || 'Ahí no cabe'}`
    color = llevando.valido ? 'var(--verde-oscuro)' : 'var(--rojo)'
  } else if (pintando) {
    const n = pintando.celdas.length
    const c = def(pintando.tipo)?.coste(1)?.piedra || 0
    txt = `${def(pintando.tipo).icono} ${n} tramo${n > 1 ? 's' : ''} · 🪨 ${formatoNumero(n * c)}`
  } else if (quitando) {
    txt = `🧹 ${quitando.ids.size} tramo${quitando.ids.size === 1 ? '' : 's'} marcados`
  } else if (herramienta === 'mover') {
    txt = 'Arrastra un edificio para moverlo: gratis y sin esperas. Dos dedos mueven la cámara.'
  } else if (pintaMuro) {
    txt = `Arrastra para pintar ${def(herramienta).nombre.toLowerCase()}. Caben ${huecosEnCola()} encargos más.`
  } else {
    txt = 'Barre los muros o fosos que quieras quitar.'
  }
  if (nodos.aviso.textContent !== txt) nodos.aviso.textContent = txt
  nodos.aviso.style.color = color || 'var(--tinta-suave)'

  // --- guardar: apagado mientras quede algo en la caja ---
  nodos.guardar.disabled = !!falta
  nodos.guardar.textContent = falta ? `${falta.total === 1 ? 'Falta' : 'Faltan'} ${falta.total} 📦` : 'Guardar'

  // --- la nota de defensa ---
  const p = analisis.puntuacion
  const br = analisis.brechas.length
  nodos.nota.textContent = ''
  nodos.nota.append(
    el('div', { texto: p == null ? '' : `🛡️ ${p} · ${analisis.nota}` }),
    el('div', {
      estilo: { fontSize: '.85em', color: br ? 'var(--rojo)' : 'var(--tinta-suave)' },
      texto: br ? `⚠️ ${br} hueco${br > 1 ? 's' : ''}` : analisis.cerrada ? '✅ cerrada' : analisis.hayMuro ? '⚠️ no cierra' : 'sin cerco'
    })
  )
}

/* ===========================================================================
   Abrir y cerrar
   =========================================================================== */

let botonEntrar = null

function montarBoton () {
  const raiz = document.getElementById('hud') || document.body
  botonEntrar = el('button', {
    clase: 'btn btn-oro', type: 'button', 'aria-label': 'Reorganizar la aldea',
    estilo: {
      position: 'fixed', zIndex: '18',
      left: 'calc(var(--seg-izq) + 8px)', bottom: 'calc(var(--seg-abajo) + 74px)',
      width: '56px', minWidth: '56px', height: '56px', minHeight: '56px',
      padding: '0', borderRadius: 'var(--r-max)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0',
      boxShadow: 'var(--sombra-panel)'
    },
    onclick: () => abrir()
  }, [
    el('span', { estilo: { fontSize: '1.3em', lineHeight: '1' }, texto: '🧭' }),
    el('span', { estilo: { fontSize: '.5em', fontWeight: '900', lineHeight: '1.1' }, texto: 'ORDENAR' })
  ])
  raiz.appendChild(botonEntrar)
}

const verBoton = (v) => { if (botonEntrar) botonEntrar.style.display = v ? 'flex' : 'none' }

export function abrir () {
  if (activo) return
  if (!edificios().length) { toast('Todavía no hay nada que reorganizar', 'info'); return }

  activo = true
  herramienta = 'mover'
  trazo = 'libre'
  elegidos.clear()
  llevando = null; pintando = null; quitando = null; gesto = null
  huecoMirado = 0

  OBRA.iniciarReorganizacion()
  pila.length = 0
  pila.push(OBRA.fotoReorganizacion())
  pilaPos = 0

  // Esto es lo que congela la cámara, enciende la rejilla y, sobre todo, hace
  // que un toque NO abra la ficha del edificio (render/scene.js deja de emitir
  // EV.UI_SELECT en modo construcción). Es el «que cuando toque no me dé las
  // funciones» del dueño, resuelto sin tocar ui/hud.js.
  events.emit(EV.UI_SELECT, { kind: null, id: null })     // cierra la ficha que hubiera abierta
  events.emit(EV.UI_PANEL, { panel: null })
  events.emit(EV.BUILD_MODE, { activo: true, tipo: null })

  montar()
  verBoton(false)
  analizar()
  refrescar()
  toast('Mueve lo que quieras: aquí es gratis y sin esperas. Nada se aplica hasta Guardar.', 'info', 3600)
}

export function cerrar (guardado = false) {
  if (!activo) return
  activo = false
  llevando = null; pintando = null; quitando = null; gesto = null
  elegidos.clear()
  pila.length = 0
  pilaPos = -1
  events.emit(EV.BUILD_MODE, { activo: false, tipo: null })
  ;(document.getElementById('hud') || document.body).classList.remove('editando')
  nodos.arriba?.remove()
  nodos.abajo?.remove()
  nodos = {}
  verBoton(true)
  if (!guardado) toast('Todo se queda como estaba', 'info', 1600)
}

export const abierto = () => activo

/* ===========================================================================
   Enganches
   =========================================================================== */

export function init () {
  // sim/combat.js es de otro agente: se pide prestado y si no está, da igual
  import('../sim/combat.js')
    .then(m => { if (typeof m.calcularDefensa === 'function') calcularDefensa = m.calcularDefensa })
    .catch(() => {})

  montarBoton()
  events.on(EV.VISTA_CAMBIADA, (p) => verBoton(!activo && (!p || p.vista !== 'mundo')))

  events.on(EV.UI_PANEL, (p) => { if (p && (p.panel === 'reorganizar' || p.panel === 'editor')) abrir() })

  events.on(EV.GRID_TAP, alTocarCasilla)

  // El principio y el final del gesto no los cuenta nadie: se escuchan aquí, en
  // la ventana, sin tocar render/scene.js.
  window.addEventListener('pointerdown', alBajarDedo, true)
  window.addEventListener('pointerup', alSubirDedo, true)
  window.addEventListener('pointercancel', alSubirDedo, true)

  // el análisis de huecos es caro: se hace en el latido, no en cada dedo
  events.on(EV.TICK, () => {
    if (!activo || !pendienteAnalisis) return
    if (--pendienteAnalisis > 0) return
    analizar()
    refrescar()
  })

  document.addEventListener('keydown', (e) => {
    if (!activo) return
    if (e.key === 'Escape') { e.preventDefault(); descartar() } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) rehacer(); else deshacer() }
  })

  // atajo de pruebas: baluarte.editor.abrir()
  if (typeof window !== 'undefined') {
    window.editorAldea = {
      abrir,
      cerrar,
      get activo () { return activo },
      get llevando () { return llevando },
      get elegidos () { return [...elegidos] },
      get analisis () { return analisis },
      herramienta: (h) => { herramienta = h; refrescar() },
      trazo: (t) => { trazo = t; refrescar() }
    }
  }
}

export default { init, abrir, cerrar }
