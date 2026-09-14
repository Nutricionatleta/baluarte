import { events, EV } from '../core/events.js'
import { game, nuevoId } from '../core/state.js'
import { dentro, esTerritorio, gridAMundo } from '../core/grid.js'
import { makeRng } from '../core/rng.js'
import { def } from '../data/buildings.js'
// Única importación pactada fuera de core/ y data/: el banco. Lo que se saca de
// talar entra por aquí, con sus topes de almacén, como cualquier otro ingreso.
import { ingresar } from './resources.js'

/**
 * DESPEJAR EL VALLE. Los árboles, las rocas y los matorrales dejan de ser
 * decorado: el jugador pinta las casillas que quiere limpiar, una cuadrilla va
 * allí, tala, y la madera y la piedra entran en la caja. Y la casilla queda
 * libre para construir.
 *
 * DUEÑO de `game.state.despeje`. Nadie más lo toca.
 *
 * De dónde sale lo que hay en cada casilla: la vegetación la siembra
 * render/terrain.js con la semilla de la partida, así que la simulación no
 * puede deducirla sin copiar esa receta. En vez de eso, el terreno PUBLICA lo
 * que ha plantado con EV.DECO_INVENTARIO en cuanto siembra el valle, y este
 * módulo se queda con esa lista. Así se respeta la regla de que sim/ no importa
 * a render/, y si el terreno no llega a cargar aquí simplemente no hay nada que
 * despejar en lugar de un error.
 *
 * ────────────────────────── LOS NÚMEROS Y SU PORQUÉ ──────────────────────────
 * La referencia es la SERRERÍA DE NIVEL 1: 13,5 de madera por minuto con su
 * plaza llena (data/buildings.js). La cantera de nivel 1 da 9,5 de piedra.
 *
 *   · Un roble: 12 de madera en 25 s de cuadrilla  → 28,8/min ≈ 2,1 serrerías
 *   · Un pino:   8 de madera en 18 s               → 26,7/min ≈ 2,0 serrerías
 *   · Una roca:  6 de piedra en 20 s               → 18,0/min ≈ 1,9 canteras
 *
 * O sea: mientras dura, una cuadrilla despejando rinde como DOS edificios de
 * nivel 1 — bien pagado para lo que cuesta mandarla— pero:
 *   1. Ocupa una PLAZA DE OBRA, la misma que se usa para construir y mejorar.
 *      Despejar es dejar de levantar cosas: ese es el precio de verdad.
 *   2. Se agota. Todo el valle de 60x60 junto (unos 250 árboles, 180 matorrales
 *      y 125 piedras, y buena parte cae en parcelas que aún no son tuyas) suma
 *      del orden de 2.800 de madera y 800 de piedra. Eso son tres horas y media
 *      de UNA serrería de nivel 1, y media hora de una del 6. No es una fuente
 *      de producción: es un empujón para arrancar y un premio por ordenar.
 *   3. Solo se despeja en terreno TUYO, así que al empezar el bosque que puedes
 *      talar es el de las nueve parcelas del centro, no el valle entero.
 *
 * Con la aldea ya crecida, mandar una cuadrilla a talar es peor negocio que
 * dejarla construir: la serrería de nivel 6 sola da 81/min. Eso es exactamente
 * lo que se buscaba — que despejar merezca la pena por el SITIO y por el empujón
 * de las primeras horas, y que nunca compita con tener serrerías.
 */

// ── Catálogo de lo que hay en el valle ───────────────────────────────────
/**
 * Lo que da cada cosa y lo que cuesta quitarla, en segundos de cuadrilla.
 * `nombre` en singular, que es como lo lee el jugador en la barra.
 */
const PIEZA = {
  roble: { nombre: 'roble', icono: '🌳', madera: 12, piedra: 0, segundos: 25 },
  pino: { nombre: 'pino', icono: '🌲', madera: 8, piedra: 0, segundos: 18 },
  arbusto: { nombre: 'matorral', icono: '🌿', madera: 2, piedra: 0, segundos: 8 },
  zarza: { nombre: 'zarzal', icono: '🌿', madera: 2, piedra: 0, segundos: 6 },
  roca: { nombre: 'roca', icono: '🪨', madera: 0, piedra: 6, segundos: 20 },
  penasco: { nombre: 'peñasco', icono: '🪨', madera: 0, piedra: 10, segundos: 30 },
  ruina: { nombre: 'ruina', icono: '🧱', madera: 4, piedra: 8, segundos: 22 }
}

/** Ninguna casilla, por cargada que esté, tiene a la cuadrilla más de esto. */
const TOPE_SEGUNDOS = 45
/** Un trazo largo del dedo, no la tala del valle entero de una sentada. */
const MAX_COLA = 40

/**
 * EL HALLAZGO. Una de cada ocho casillas esconde algo: un tocón con un panal
 * dentro o una vetilla en la piedra. Sale del hash de la casilla y de la
 * semilla, así que es SIEMPRE el mismo sitio: ni se puede repetir ni depende de
 * cuándo se tale.
 */
const PROB_HALLAZGO = 0.125
const HALLAZGOS = {
  miel: { texto: '🍯 Un tocón con panal', recurso: 'comida', cantidad: 8 },
  veta: { texto: '💰 Una vetilla en la piedra', recurso: 'oro', cantidad: 6 }
}

// ── Estado del módulo (NO se guarda) ─────────────────────────────────────
/** 'x|z' -> ['roble','roca'] tal y como lo sembró el terreno. */
const inventario = new Map()
let hayInventario = false

const clave = (x, z) => `${x}|${z}`
const toast = (texto, tipo = 'info') => events.emit(EV.UI_TOAST, { texto, tipo })

// ── El bloque del estado ─────────────────────────────────────────────────
/**
 * `despeje` saneado, con sus tres listas. JSON puro: cadenas, números y objetos
 * planos, nada más. `hechas` es lo que hay que guardar sí o sí — la vegetación
 * se genera con la semilla, así que sin esta lista los árboles talados
 * reaparecerían al recargar la página.
 */
function bloque () {
  const s = game.state
  if (!s.despeje || typeof s.despeje !== 'object') s.despeje = {}
  const d = s.despeje
  if (!Array.isArray(d.hechas)) d.hechas = []
  if (!Array.isArray(d.faenas)) d.faenas = []
  if (!Array.isArray(d.cola)) d.cola = []
  return d
}

const hechas = () => new Set(bloque().hechas)

/** ¿Esa casilla ya está limpia (talada a propósito o pisada por un edificio)? */
export function yaDespejada (x, z) {
  return bloque().hechas.includes(clave(x, z))
}

function marcarHecha (x, z) {
  const d = bloque()
  const k = clave(x, z)
  if (!d.hechas.includes(k)) d.hechas.push(k)
  inventario.delete(k)
}

// ── Qué hay y qué vale ───────────────────────────────────────────────────

/** Lo talable que sigue en pie en esa casilla. Array vacío si no queda nada. */
export function piezasEn (x, z) {
  if (!dentro(x, z)) return []
  if (yaDespejada(x, z)) return []
  const lote = inventario.get(clave(x, z))
  return lote ? lote.slice() : []
}

/** Lo que cuesta y lo que da limpiar esa casilla. null si no hay nada. */
export function resumenDe (x, z) {
  const piezas = piezasEn(x, z)
  if (!piezas.length) return null
  let madera = 0; let piedra = 0; let segundos = 0
  const cuenta = new Map()
  for (const p of piezas) {
    const f = PIEZA[p]
    if (!f) continue
    madera += f.madera; piedra += f.piedra; segundos += f.segundos
    cuenta.set(f.nombre, (cuenta.get(f.nombre) || 0) + 1)
  }
  if (!cuenta.size) return null
  const texto = [...cuenta].map(([n, c]) => (c > 1 ? `${c} ${n}s` : `1 ${n}`)).join(' y ')
  return {
    x, z, piezas, madera, piedra,
    segundos: Math.min(TOPE_SEGUNDOS, Math.max(3, Math.round(segundos))),
    texto
  }
}

/** El hallazgo escondido en una casilla, o null. Siempre el mismo con la misma semilla. */
function hallazgoDe (x, z, piezas) {
  const semilla = (((game.state.seed || 1) >>> 0) ^ ((x * 73856093) ^ (z * 19349663))) >>> 0
  const r = makeRng(semilla || 1)
  if (!r.chance(PROB_HALLAZGO)) return null
  const hayPiedra = piezas.some(p => p === 'roca' || p === 'penasco' || p === 'ruina')
  const hayArbol = piezas.some(p => p === 'roble' || p === 'pino')
  if (hayArbol && (!hayPiedra || r.chance(0.5))) return { tipo: 'miel', ...HALLAZGOS.miel }
  if (hayPiedra) return { tipo: 'veta', ...HALLAZGOS.veta }
  return null
}

// ── Las plazas de obra: despejar es NO estar construyendo ────────────────
/**
 * Las mismas manos que levantan la aldea. No se importa sim/buildings.js (los
 * módulos no se hablan por import): la cuenta sale del catálogo, que es donde
 * vive la fórmula, así que si mañana cambia ahí, cambia aquí sola.
 */
export function plazasDeObra () {
  const ayto = (game.state.buildings || []).find(b => b.tipo === 'ayuntamiento')
  if (!ayto) return 1
  const d = def('ayuntamiento')
  if (!d || typeof d.obrasSimultaneas !== 'function') return 1
  return Math.max(1, d.obrasSimultaneas(Math.max(1, ayto.nivel || 1)))
}

/** Cuadrillas que pueden salir ahora mismo: las plazas que no están en una obra. */
function libres () {
  const d = bloque()
  const ocupadas = (game.state.obras || []).length + d.faenas.length
  return Math.max(0, plazasDeObra() - ocupadas)
}

// ── Encargar ─────────────────────────────────────────────────────────────

/**
 * El jugador manda limpiar una casilla. Si hay constructor libre sale ya; si no,
 * espera su turno en la cola, igual que las obras.
 * @returns {{ok:boolean, motivo:string, causa:string}}
 */
export function encargar (x, z) {
  const gx = x | 0; const gz = z | 0
  if (!dentro(gx, gz)) return { ok: false, motivo: 'Eso se sale del valle', causa: 'fuera' }
  if (!esTerritorio(game.state, gx, gz)) {
    return { ok: false, motivo: 'Ese terreno todavía no es tuyo', causa: 'territorio' }
  }
  const d = bloque()
  if (d.faenas.some(f => f.x === gx && f.z === gz) || d.cola.some(c => c.x === gx && c.z === gz)) {
    return { ok: false, motivo: 'Ya está encargada', causa: 'repetida' }
  }
  const r = resumenDe(gx, gz)
  if (!r) return { ok: false, motivo: 'Aquí no hay nada que talar', causa: 'vacia' }
  if (d.cola.length >= MAX_COLA) {
    return { ok: false, motivo: 'La cuadrilla ya tiene faena de sobra', causa: 'cola' }
  }

  const entrada = {
    id: nuevoId('dsp'), x: gx, z: gz,
    piezas: r.piezas, segundos: r.segundos,
    madera: r.madera, piedra: r.piedra
  }
  d.cola.push(entrada)
  events.emit(EV.DESPEJE_ENCARGADO, {
    id: entrada.id, x: gx, z: gz, piezas: r.piezas, segundos: r.segundos,
    recompensa: { madera: r.madera, piedra: r.piedra }
  })
  arrancarCola()
  return { ok: true, motivo: '', causa: '' }
}

/** Mete en faena lo que quepa en las plazas libres. */
function arrancarCola () {
  const d = bloque()
  let hueco = libres()
  while (hueco > 0 && d.cola.length) {
    const e = d.cola.shift()
    // pudo construirse algo encima mientras esperaba: entonces ya no hay faena
    if (!piezasEn(e.x, e.z).length) continue
    const ahora = Date.now()
    const f = { ...e, inicio: ahora, fin: ahora + e.segundos * 1000 }
    d.faenas.push(f)
    hueco--
    events.emit(EV.DESPEJE_EMPEZADO, {
      id: f.id, x: f.x, z: f.z, piezas: f.piezas, segundos: f.segundos, fin: f.fin
    })
    events.emit(EV.SFX, { nombre: 'construir' })
  }
}

// ── Terminar ─────────────────────────────────────────────────────────────

/**
 * Faenas con el reloj vencido. Se compara con Date.now() como las obras: así
 * lo que empezó anoche está talado cuando vuelves, sin trucos.
 */
function revisarFaenas () {
  const d = bloque()
  const ahora = Date.now()
  if (!d.faenas.some(f => f.fin <= ahora)) return 0

  const vencidas = d.faenas.filter(f => f.fin <= ahora)
  d.faenas = d.faenas.filter(f => f.fin > ahora)
  const total = { madera: 0, piedra: 0, comida: 0, oro: 0 }
  const avisos = []

  for (const f of vencidas) {
    marcarHecha(f.x, f.z)
    const origen = { x: f.x, z: f.z }
    const recompensa = { madera: 0, piedra: 0 }
    if (f.madera > 0) recompensa.madera = ingresar('madera', f.madera, origen)
    if (f.piedra > 0) recompensa.piedra = ingresar('piedra', f.piedra, origen)

    const hallazgo = hallazgoDe(f.x, f.z, f.piezas || [])
    if (hallazgo) {
      const entra = ingresar(hallazgo.recurso, hallazgo.cantidad, origen)
      if (entra > 0) total[hallazgo.recurso] += entra
      else hallazgo.perdido = true
    }

    total.madera += recompensa.madera
    total.piedra += recompensa.piedra
    avisos.push({ f, recompensa, hallazgo })

    events.emit(EV.DESPEJE_TERMINADO, {
      id: f.id, x: f.x, z: f.z, piezas: f.piezas, recompensa, hallazgo
    })
  }

  anunciar(avisos, total)
  arrancarCola()
  return vencidas.length
}

/** Un aviso por casilla si son pocas; uno solo con el saldo si vuelves a diez talados. */
function anunciar (avisos, total) {
  if (!avisos.length) return
  if (avisos.length === 1) {
    const { f, recompensa, hallazgo } = avisos[0]
    const trozos = []
    if (recompensa.madera) trozos.push(`+${recompensa.madera} 🪵`)
    if (recompensa.piedra) trozos.push(`+${recompensa.piedra} 🪨`)
    const que = (f.piezas || []).length > 1 ? 'Casilla despejada' : `${PIEZA[f.piezas[0]]?.nombre || 'Casilla'} abajo`
    toast(`🪓 ${que}: ${trozos.join(' ') || 'sin material aprovechable'}`, 'bien')
    if (hallazgo && !hallazgo.perdido) toast(`${hallazgo.texto}: +${hallazgo.cantidad}`, 'bien')
    events.emit(EV.SFX, { nombre: 'listo' })
    return
  }
  const trozos = []
  if (total.madera) trozos.push(`+${total.madera} 🪵`)
  if (total.piedra) trozos.push(`+${total.piedra} 🪨`)
  if (total.comida) trozos.push(`+${total.comida} 🌾`)
  if (total.oro) trozos.push(`+${total.oro} 🪙`)
  toast(`🪓 ${avisos.length} casillas despejadas: ${trozos.join(' ') || 'nada aprovechable'}`, 'bien')
  events.emit(EV.SFX, { nombre: 'listo' })
}

// ── Cancelar ─────────────────────────────────────────────────────────────

/** Quita una faena encargada. La que ya está en marcha también: se pierde el rato. */
export function cancelar (id) {
  const d = bloque()
  const enCola = d.cola.find(c => c.id === id)
  if (enCola) {
    d.cola = d.cola.filter(c => c.id !== id)
    events.emit(EV.DESPEJE_CANCELADO, { id, x: enCola.x, z: enCola.z, motivo: 'jugador' })
    return true
  }
  const enFaena = d.faenas.find(f => f.id === id)
  if (!enFaena) return false
  d.faenas = d.faenas.filter(f => f.id !== id)
  events.emit(EV.DESPEJE_CANCELADO, { id, x: enFaena.x, z: enFaena.z, motivo: 'jugador' })
  arrancarCola()
  return true
}

/** Todo lo encargado y sin empezar, fuera. Lo que ya está en marcha se respeta. */
export function cancelarEspera () {
  const d = bloque()
  const n = d.cola.length
  for (const c of d.cola) events.emit(EV.DESPEJE_CANCELADO, { id: c.id, x: c.x, z: c.z, motivo: 'jugador' })
  d.cola = []
  return n
}

// ── Lo que la interfaz necesita saber ────────────────────────────────────

/** Foto para la barra del taller: faenas vivas, cola, plazas y lo que va a entrar. */
export function resumen () {
  const d = bloque()
  const ahora = Date.now()
  const pendiente = { madera: 0, piedra: 0 }
  for (const f of [...d.faenas, ...d.cola]) { pendiente.madera += f.madera || 0; pendiente.piedra += f.piedra || 0 }
  return {
    hayInventario,
    plazas: plazasDeObra(),
    obras: (game.state.obras || []).length,
    libres: libres(),
    enMarcha: d.faenas.map(f => ({
      id: f.id, x: f.x, z: f.z, piezas: f.piezas,
      restan: Math.max(0, (f.fin - ahora) / 1000)
    })),
    esperando: d.cola.length,
    despejadas: d.hechas.length,
    pendiente
  }
}

/** Casillas con algo que talar, para que el render las marque al construir. */
export function casillasConVegetacion () {
  const fuera = hechas()
  const lista = []
  for (const k of inventario.keys()) {
    if (fuera.has(k)) continue
    const p = k.split('|')
    lista.push({ x: +p[0], z: +p[1] })
  }
  return lista
}

/** Dónde cae la casilla en el mundo 3D. La usa la interfaz para enfocar la cámara. */
export const mundoDeCasilla = (x, z) => gridAMundo(x, z)

// ── Arranque ─────────────────────────────────────────────────────────────

function recogerInventario (p) {
  inventario.clear()
  const casillas = p && p.casillas
  if (!casillas) { hayInventario = false; return }
  const fuera = hechas()
  for (const k in casillas) {
    if (fuera.has(k)) continue
    const lote = casillas[k]
    if (!Array.isArray(lote) || !lote.length) continue
    const utiles = lote.filter(t => PIEZA[t])
    if (utiles.length) inventario.set(k, utiles)
  }
  hayInventario = true
  // La partida pudo guardarse con faenas encargadas sobre casillas que el
  // terreno ya no tiene (otra semilla, un edificio encima): se limpian.
  const d = bloque()
  d.cola = d.cola.filter(c => piezasEn(c.x, c.z).length)
  arrancarCola()
}

export function init () {
  bloque()
  events.on(EV.DECO_INVENTARIO, recogerInventario)
  events.on(EV.TICK, revisarFaenas)

  // Construir encima sigue despejando gratis (lo hace render/terrain): aquí solo
  // se apunta para no ofrecer una tala donde ya no hay árbol.
  events.on(EV.BUILD_PLACED, ({ building } = {}) => {
    if (!building) return
    const an = building.ancho ?? 2; const al = building.alto ?? 2
    const d = bloque()
    for (let i = 0; i < an; i++) {
      for (let j = 0; j < al; j++) {
        const x = building.x + i; const z = building.z + j
        if (inventario.has(clave(x, z))) marcarHecha(x, z)
        for (const c of d.cola.filter(c => c.x === x && c.z === z)) {
          events.emit(EV.DESPEJE_CANCELADO, { id: c.id, x, z, motivo: 'construido' })
        }
        d.cola = d.cola.filter(c => !(c.x === x && c.z === z))
      }
    }
  })

  events.on(EV.STATE_LOADED, () => {
    inventario.clear()
    hayInventario = false
    bloque()
  })
}
