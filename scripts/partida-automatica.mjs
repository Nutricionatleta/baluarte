/**
 * PARTIDA AUTOMÁTICA — control de calidad de Baluarte.
 *
 * Juega una partida completa de 30 días (3 sesiones al día) sin navegador,
 * midiendo ritmo, economía, combate, guardado y rendimiento, y anotando
 * TODO lo que huela a fallo (excepciones, NaN, negativos, desbordes,
 * invariantes rotos, colas atascadas).
 *
 * NO toca ni un fichero del juego. Todos los apaños viven aquí.
 *
 * ────────────────────────────── EL APAÑO ──────────────────────────────
 * 1) `localStorage`: el juego guarda en localStorage (core/save.js). Aquí es
 *    un Map en memoria.
 * 2) `performance`, `document`, `window`, `navigator`: existen vacíos porque
 *    core/clock.js y core/save.js los tocan al arrancar. No se usa el reloj
 *    real: la simulación emite EV.TICK a mano.
 * 3) **`Date.now()` sustituido por un reloj virtual.** Todo el juego mide las
 *    obras, la cola de tropas, las expediciones y la investigación con marcas
 *    absolutas (`fin = Date.now() + ms`), así que adelantando `Date.now()` se
 *    puede vivir un mes en unos segundos. `VT` es el reloj virtual en ms;
 *    `avanzar(ms)` lo mueve. Se guarda `Date.now` original para medir tiempos
 *    reales de CPU (rendimiento).
 * 4) `src/sim/combat.js` usa `import.meta.glob` (extensión de Vite) para cargar
 *    army.js y resources.js. En Node eso lanza y el módulo cae en su modo
 *    "degradado" (sin tecnologías de ataque). Para medir el combate REAL se
 *    genera aquí al vuelo una copia de combat.js con ese glob sustituido por
 *    imports normales, se importa y se borra al terminar. La copia comparte
 *    las MISMAS instancias de core/ y sim/ (mismo fichero resuelto), así que
 *    no hay estado duplicado.
 *
 * Uso:  node scripts/partida-automatica.mjs [--dias 30] [--json salida.json]
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(AQUI, '..')

// ───────────────────────────── argumentos ─────────────────────────────
const ARG = process.argv.slice(2)
const opt = (n, d) => { const i = ARG.indexOf(n); return i >= 0 && ARG[i + 1] ? ARG[i + 1] : d }
const DIAS = Number(opt('--dias', 30))
const SALIDA_JSON = opt('--json', path.join(AQUI, 'partida-automatica.salida.json'))

// ───────────────────────── 1. apaños del entorno ─────────────────────────
const almacenLocal = new Map()
globalThis.localStorage = {
  getItem: (k) => (almacenLocal.has(k) ? almacenLocal.get(k) : null),
  setItem: (k, v) => { almacenLocal.set(k, String(v)) },
  removeItem: (k) => { almacenLocal.delete(k) },
  clear: () => almacenLocal.clear(),
  get length () { return almacenLocal.size }
}
globalThis.document = { addEventListener () {}, removeEventListener () {}, hidden: false, getElementById: () => null }
globalThis.window = { addEventListener () {}, removeEventListener () {} }
// `navigator` ya existe en Node 24 y es de solo lectura: se deja como está.
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(RELOJ_REAL()), 0)

const RELOJ_REAL = Date.now.bind(Date)
const ahoraReal = () => Number(process.hrtime.bigint() / 1000n) / 1000   // ms con decimales

let VT = RELOJ_REAL()
Date.now = () => Math.floor(VT)
globalThis.performance = { now: () => VT }
const avanzar = (ms) => { VT += ms }

// ───────────────────── 2. recogida de fallos y avisos ─────────────────────
const FALLOS = []      // { grav, clave, texto, ctx }
const vistos = new Map()
function fallo (grav, clave, texto, ctx) {
  const n = (vistos.get(clave) || 0) + 1
  vistos.set(clave, n)
  if (n <= 3) FALLOS.push({ grav, clave, texto, ctx, cuando: etiquetaMomento() })
}
const contarFallo = (clave) => vistos.get(clave) || 0

const consolaErrOriginal = console.error
console.error = (...a) => {
  const txt = a.map(x => (x instanceof Error ? `${x.message}\n${x.stack}` : String(x))).join(' ')
  fallo('alta', 'excepcion:' + txt.slice(0, 90), 'Excepción tragada por el bus de eventos: ' + txt.slice(0, 400))
}
process.on('uncaughtException', (e) => { consolaErrOriginal('FATAL', e); process.exit(1) })

// ───────────────────────── 3. carga de los módulos ─────────────────────────
const COMBATE_PARCHE = path.join(AQUI, '_combat-node.generado.mjs')
function prepararCombateParcheado () {
  const src = readFileSync(path.join(RAIZ, 'src/sim/combat.js'), 'utf8')
  const parcheado = src
    .replace(/from '\.\.\/core\//g, "from '../src/core/")
    .replace(/from '\.\.\/data\//g, "from '../src/data/")
    .replace(
      /MODULOS = import\.meta\.glob\('\.\/\{army,resources\}\.js'\)/,
      "MODULOS = { './army.js': () => import('../src/sim/army.js'), './resources.js': () => import('../src/sim/resources.js') }"
    )
  if (parcheado === src) throw new Error('El apaño de combat.js no ha encajado: revisa import.meta.glob')
  writeFileSync(COMBATE_PARCHE, '// GENERADO por scripts/partida-automatica.mjs — se borra solo.\n' + parcheado)
  return pathToFileURL(COMBATE_PARCHE).href
}

const urlCombate = prepararCombateParcheado()

const { events, EV } = await import('../src/core/events.js')

// Instrumentación del bus ANTES de cargar nada: así se sabe qué eventos escucha
// alguien de verdad y cuáles se emiten al vacío.
const ESCUCHADOS = new Map()   // tipo -> nº de suscriptores
const EMITIDOS = new Map()     // tipo -> nº de emisiones
const onOriginal = events.on.bind(events)
events.on = (tipo, fn) => { ESCUCHADOS.set(tipo, (ESCUCHADOS.get(tipo) || 0) + 1); return onOriginal(tipo, fn) }
const emitOriginal = events.emit.bind(events)
events.emit = (tipo, payload) => { EMITIDOS.set(tipo, (EMITIDOS.get(tipo) || 0) + 1); return emitOriginal(tipo, payload) }
const { CONFIG } = await import('../src/core/config.js')
const estado = await import('../src/core/state.js')
const { game } = estado
const save = await import('../src/core/save.js')
const { def, EDIFICIOS, ORDEN_EDADES, valorEdificio } = await import('../src/data/buildings.js')
const { UNIDADES } = await import('../src/data/units.js')
const { EDADES, TECNOLOGIAS } = await import('../src/data/techs.js')

const Recursos = await import('../src/sim/resources.js')
const Edificios = await import('../src/sim/buildings.js')
const Aldeanos = await import('../src/sim/villagers.js')
const Ejercito = await import('../src/sim/army.js')
const Ciencia = await import('../src/sim/research.js')
const Combate = await import(urlCombate)
const Mapa = await import('../src/world/map.js')
const Enemigos = await import('../src/world/enemies.js')
const Imperio = await import('../src/world/imperio.js')
const Expediciones = await import('../src/world/expeditions.js')
const Encargos = await import('../src/sim/quests.js')

// ───────────────────────────── 4. métricas ─────────────────────────────
const M = {
  inicio: 0,
  hitos: [],            // { que, diaJuego, horasJuego, detalle }
  sesiones: [],         // resumen por sesión
  desperdicio: { madera: 0, piedra: 0, comida: 0, oro: 0 },
  gastado: { madera: 0, piedra: 0, comida: 0, oro: 0 },
  producido: { madera: 0, piedra: 0, comida: 0, oro: 0 },
  segundosObra: 0,      // segundos de obra encargados
  segundosBloqueado: 0, // con algo en marcha pero sin nada que decidir
  segundosMuerto: 0,    // sin NADA en marcha y sin nada que hacer: el parón malo
  segundosJugados: 0,
  segundosAytoEnObra: 0,
  asaltos: [],
  conquistas: [],       // { cuando, dia, plaza, total }
  perdidas: [],         // plazas que te han quitado
  imperio: [],          // foto del imperio al cerrar cada sesión
  defensas: [],
  toasts: 0,
  rendimiento: { ticks: 0, ms: 0, picoMs: 0, ticksLlenos: 0, msLlenos: 0 },
  ticksLentos: [],
  laboratorio: null,
  saveLoad: null,
  offline: []
}

const HORA_MS = 3600000
let T0 = 0                 // VT al empezar la partida
const horasJuego = () => (VT - T0) / HORA_MS
const diaJuego = () => Math.floor(horasJuego() / 24) + 1
const etiquetaMomento = () => `d${diaJuego()} ${(horasJuego() % 24).toFixed(1)}h`

function hito (que, detalle = '') {
  M.hitos.push({ que, dia: diaJuego(), horas: +horasJuego().toFixed(2), detalle, estado: foto() })
  console.log(`   ▸ [${etiquetaMomento()}] ${que} ${detalle}`)
}

function foto () {
  const s = game.state
  const pm = Recursos.produccionPorMinuto()
  return {
    edad: s.age,
    ayto: Edificios.nivelDe('ayuntamiento'),
    nivel: s.jugador.nivel,
    gemas: s.jugador.gemas,
    edificios: s.buildings.length,
    aldeanos: s.villagers.length,
    recursos: { ...s.recursos },
    almacen: { ...s.almacen },
    pm,
    tropas: { ...(s.ejercito.tropas || {}) },
    poder: Ejercito.poderMilitar(),
    techs: Object.keys(s.research || {}).length
  }
}

// ───────────────────────── 5. invariantes por tick ─────────────────────────
const RECURSOS = CONFIG.RECURSOS
const finito = (v) => typeof v === 'number' && Number.isFinite(v)

function invariantes () {
  const s = game.state
  for (const r of RECURSOS) {
    const v = s.recursos[r]
    if (!finito(v)) fallo('critica', 'res-nan-' + r, `recursos.${r} no es un número finito: ${v}`)
    else if (v < 0) fallo('critica', 'res-neg-' + r, `recursos.${r} en negativo: ${v}`)
    else if (v > (s.almacen[r] || 0) + 0.001) {
      fallo('alta', 'res-desborde-' + r, `recursos.${r}=${v} por encima del tope ${s.almacen[r]}`)
    }
    if (!finito(s.almacen[r]) || s.almacen[r] <= 0) fallo('alta', 'alm-mal-' + r, `almacen.${r} inválido: ${s.almacen[r]}`)
  }
  const j = s.jugador
  if (!finito(j.gemas) || j.gemas < 0) fallo('critica', 'gemas', `gemas inválidas: ${j.gemas}`)
  if (!finito(j.xp) || j.xp < 0) fallo('alta', 'xp', `xp inválida: ${j.xp}`)

  for (const [t, n] of Object.entries(s.ejercito.tropas || {})) {
    if (!finito(n) || n < 0 || n !== Math.floor(n)) fallo('critica', 'tropa-' + t, `tropas.${t} inválido: ${n}`)
    if (!UNIDADES[t]) fallo('alta', 'tropa-tipo-' + t, `tipo de tropa desconocido en el estado: ${t}`)
  }
}

function invariantesLentos () {
  const s = game.state
  const ids = new Set()
  for (const b of s.buildings) {
    const d = def(b.tipo)
    if (!d) { fallo('alta', 'edif-tipo-' + b.tipo, `edificio de tipo desconocido: ${b.tipo}`); continue }
    if (ids.has(b.id)) fallo('critica', 'edif-id-dup', `dos edificios con el mismo id: ${b.id}`)
    ids.add(b.id)
    if (!finito(b.nivel) || b.nivel < 0 || b.nivel > (d.maxNivel || 1)) {
      fallo('alta', 'edif-nivel-' + b.tipo, `${b.tipo} con nivel fuera de rango: ${b.nivel} (max ${d.maxNivel})`)
    }
    if (!finito(b.hp) || b.hp < 0 || b.hp > (b.hpMax || 0) + 0.5) {
      fallo('alta', 'edif-hp-' + b.tipo, `${b.tipo} con hp=${b.hp} y hpMax=${b.hpMax}`)
    }
    if (b.x < 0 || b.z < 0 || b.x + (b.ancho ?? 2) > CONFIG.GRID || b.z + (b.alto ?? 2) > CONFIG.GRID) {
      fallo('alta', 'edif-fuera', `${b.tipo} fuera del tablero en ${b.x},${b.z}`)
    }
    for (const vid of (b.trabajadores || [])) {
      if (!s.villagers.some(v => v.id === vid)) fallo('alta', 'trab-fantasma', `${b.tipo} tiene un trabajador inexistente: ${vid}`)
    }
    const tope = d.unico ? 1 : (d.max ?? Infinity)
    if (s.buildings.filter(x => x.tipo === b.tipo).length > tope) {
      fallo('alta', 'edif-tope-' + b.tipo, `hay más ${b.tipo} de los permitidos (${tope})`)
    }
  }
  // solapes
  for (let i = 0; i < s.buildings.length; i++) {
    const a = s.buildings[i]
    for (let k = i + 1; k < s.buildings.length; k++) {
      const b = s.buildings[k]
      if (a.x < b.x + (b.ancho ?? 2) && a.x + (a.ancho ?? 2) > b.x &&
          a.z < b.z + (b.alto ?? 2) && a.z + (a.alto ?? 2) > b.z) {
        fallo('critica', 'edif-solape', `${a.tipo}(${a.x},${a.z}) solapa con ${b.tipo}(${b.x},${b.z})`)
      }
    }
  }
  const vids = new Set()
  for (const v of s.villagers) {
    if (vids.has(v.id)) fallo('critica', 'ald-id-dup', `dos aldeanos con el mismo id: ${v.id}`)
    vids.add(v.id)
    if (v.buildingId && !s.buildings.some(b => b.id === v.buildingId)) {
      fallo('alta', 'ald-edif-fantasma', `aldeano ${v.id} asignado a un edificio que no existe`)
    }
    if (!finito(v.x) || !finito(v.z) || v.x < -0.01 || v.z < -0.01 || v.x > CONFIG.GRID || v.z > CONFIG.GRID) {
      fallo('alta', 'ald-fuera', `aldeano fuera del tablero: ${v.x},${v.z}`)
    }
  }
  const ayto = s.buildings.find(b => b.tipo === 'ayuntamiento')
  const p = Aldeanos.poblacion()
  if (ayto && ayto.enObra && p.maxima === 0 && p.actual > 0) {
    fallo('media', 'poblacion-cero-en-obra', `mientras el Ayuntamiento se mejora, poblacion().maxima cae a 0 (hay ${p.actual} aldeanos): el HUD marca 0 camas y contratar() responde "Sin ayuntamiento no hay a quién llamar"`)
  } else if (p.actual > p.maxima) {
    fallo('media', 'poblacion-exceso', `hay ${p.actual} aldeanos y solo caben ${p.maxima}`)
  }
  const oc = Ejercito.ocupacion()
  if (oc.usado > oc.total) fallo('media', 'ejercito-exceso', `ejército ocupa ${oc.usado} de ${oc.total} huecos`)
  for (const o of s.obras) {
    if (!s.buildings.some(b => b.id === o.buildingId)) fallo('alta', 'obra-huerfana', `obra sin edificio: ${o.id}`)
    if (!finito(o.fin) || o.fin < o.inicio) fallo('alta', 'obra-reloj', `obra con reloj imposible: ${JSON.stringify(o)}`)
  }
  if (s.obras.length > Edificios.plazasDeObra()) {
    fallo('media', 'obras-exceso', `${s.obras.length} obras con solo ${Edificios.plazasDeObra()} plazas`)
  }
}

/** Barrido profundo buscando NaN, Infinity, funciones o ciclos en el estado. */
function auditarEstado (etiqueta) {
  const problemas = []
  const visto = new WeakSet()
  const anda = (o, ruta, prof) => {
    if (prof > 12 || problemas.length > 25) return
    if (o === null) return
    const t = typeof o
    if (t === 'number') { if (!Number.isFinite(o)) problemas.push(`${ruta} = ${o}`); return }
    if (t === 'function') { problemas.push(`${ruta} es una FUNCIÓN (no sobrevive a JSON)`); return }
    if (t !== 'object') return
    if (visto.has(o)) { problemas.push(`${ruta} es una referencia circular`); return }
    visto.add(o)
    if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) anda(o[i], `${ruta}[${i}]`, prof + 1) }
    else for (const k of Object.keys(o)) anda(o[k], `${ruta}.${k}`, prof + 1)
  }
  anda(game.state, 'state', 0)
  let json = null
  try { json = JSON.stringify(game.state) } catch (e) { problemas.push('JSON.stringify revienta: ' + e.message) }
  if (json) {
    try {
      const vuelta = JSON.parse(json)
      if (JSON.stringify(vuelta) !== json) problemas.push('el estado no es estable al ida y vuelta de JSON')
    } catch (e) { problemas.push('JSON.parse revienta: ' + e.message) }
  }
  for (const p of problemas) fallo('alta', 'estado:' + p.slice(0, 60), `[${etiqueta}] ${p}`)
  return { bytes: json ? json.length : -1, problemas }
}

// ─────────────────────────── 6. escuchas de medida ───────────────────────────
events.on(EV.UI_TOAST, () => { M.toasts++ })
events.on(EV.AGE_ADVANCED, ({ age }) => hito('EDAD ' + age.toUpperCase()))
events.on(EV.TECH_RESEARCHED, ({ techId }) => hito('tech', techId))
events.on(EV.BUILD_COMPLETED, ({ building }) => {
  if (building?.tipo === 'ayuntamiento') hito('ayuntamiento nivel ' + building.nivel)
})
events.on(EV.BUILD_UPGRADED, ({ building }) => {
  if (building?.tipo === 'ayuntamiento') hito('ayuntamiento nivel ' + building.nivel)
})
events.on(EV.BUILD_PLACED, ({ building, mejora }) => {
  const d = def(building.tipo)
  if (d) M.segundosObra += d.tiempo(mejora ? building.nivel + 1 : 1)
})
events.on(EV.RESOURCE_GAINED, ({ tipo, cantidad }) => { M.producido[tipo] = (M.producido[tipo] || 0) + cantidad })
events.on(EV.OFFLINE_RESUMEN, (p) => M.offline.push({ cuando: etiquetaMomento(), segundos: p.segundos, recursos: p.recursos }))

// ───────────────────────── 7. arranque de la partida ─────────────────────────
// combat.init es async: se hace a mano en orden
async function arrancar () {
  const off = save.cargar()
  const secuencia = [
    ['sim/resources', Recursos], ['sim/buildings', Edificios], ['sim/villagers', Aldeanos],
    ['sim/army', Ejercito], ['sim/research', Ciencia], ['sim/combat', Combate],
    ['world/map', Mapa], ['world/enemies', Enemigos], ['world/imperio', Imperio],
    ['world/expeditions', Expediciones],
    ['sim/quests', Encargos]
  ]
  for (const [nombre, mod] of secuencia) {
    try { await mod.init() } catch (e) { fallo('critica', 'init-' + nombre, `init() de ${nombre} revienta: ${e.message}\n${e.stack}`) }
  }
  if (off > 60) events.emit('offline:report', { seconds: off })
  return off
}

// ─────────────────────────── 8. el reloj de la simulación ───────────────────────────
let tickN = 0
const PASO = CONFIG.TICK_MS / 1000

function tick (n = 1, medirRendimiento = false) {
  for (let i = 0; i < n; i++) {
    avanzar(CONFIG.TICK_MS)
    game.state.stats.tiempoJugado += PASO
    M.segundosJugados += PASO
    const t0 = medirRendimiento ? ahoraReal() : 0
    const antesEmit = medirRendimiento ? new Map(EMITIDOS) : null
    events.emit(EV.TICK, { dt: PASO })
    if (medirRendimiento) {
      const ms = ahoraReal() - t0
      if (ms > 25) {
        const delta = {}
        for (const [k, v] of EMITIDOS) { const d = v - (antesEmit.get(k) || 0); if (d > 0 && k !== 'tick' && k !== 'vil:moved' && k !== 'res:gained') delta[k] = d }
        M.ticksLentos.push({ cuando: etiquetaMomento(), ms: +ms.toFixed(1), eventos: delta, edificios: game.state.buildings.length })
      }
      M.rendimiento.ticks++; M.rendimiento.ms += ms
      if (ms > M.rendimiento.picoMs) M.rendimiento.picoMs = ms
      if (game.state.buildings.length >= 50 && game.state.villagers.length >= 20) {
        M.rendimiento.ticksLlenos++; M.rendimiento.msLlenos += ms
      }
    }
    tickN++
    // desperdicio: lo que se produce con el almacén tope
    if ((tickN & 3) === 0) {
      const pm = Recursos.produccionPorMinuto()
      for (const r of RECURSOS) {
        if (game.state.recursos[r] >= game.state.almacen[r]) M.desperdicio[r] += pm[r] / 60
      }
    }
    // La aldea se congela mientras el Ayuntamiento está en andamios: se mide.
    const ayto = game.state.buildings.find(b => b.tipo === 'ayuntamiento')
    if (ayto && ayto.enObra) M.segundosAytoEnObra += PASO
    if ((tickN & 3) === 0) invariantes()
    if ((tickN % 400) === 0) invariantesLentos()
  }
}

// ─────────────────────────── 9. EL JUGADOR AUTOMÁTICO ───────────────────────────
const cuenta = (tipo) => game.state.buildings.filter(b => b.tipo === tipo).length
const terminados = (tipo) => game.state.buildings.filter(b => b.tipo === tipo && !b.enObra)
const nivelDe = (tipo) => Edificios.nivelDe(tipo)
const aytoNivel = () => nivelDe('ayuntamiento')
const iEdad = () => ORDEN_EDADES.indexOf(game.state.age)

/** Lista de deseos en orden de prioridad para la edad y el momento actuales. */
function deseos () {
  const a = aytoNivel()
  const e = iEdad()
  const L = (tipo, extra = 0) => Math.min(def(tipo).maxNivel, Math.max(1, a + extra))
  const d = []

  // 1) puertas de edad: lo que hace falta para el siguiente escalón
  const sig = ORDEN_EDADES[e + 1]
  if (sig) {
    for (const [tipo, nivel] of Object.entries(EDADES[sig].requiere)) {
      d.push({ tipo, cantidad: 1, nivel, puerta: true })
    }
  }
  // 2) el ayuntamiento manda sobre todo lo demás
  d.push({ tipo: 'ayuntamiento', cantidad: 1, nivel: def('ayuntamiento').maxNivel })
  // 3) almacenaje: sin sitio no se junta para la edad
  d.push({ tipo: 'almacen', cantidad: e >= 1 ? 3 : 1, nivel: L('almacen') })
  d.push({ tipo: 'granero', cantidad: e >= 1 ? 2 : 1, nivel: L('granero') })
  // 4) camas
  d.push({ tipo: 'casa', cantidad: Math.min(12, 3 + e * 3), nivel: L('casa') })
  // 5) economía
  d.push({ tipo: 'serreria', cantidad: Math.min(4, 1 + e), nivel: L('serreria') })
  d.push({ tipo: 'cantera', cantidad: Math.min(4, 1 + e), nivel: L('cantera') })
  d.push({ tipo: 'granja', cantidad: Math.min(6, 2 + e), nivel: L('granja') })
  if (e >= 1) d.push({ tipo: 'mina_oro', cantidad: 3, nivel: L('mina_oro') })
  if (e >= 1) d.push({ tipo: 'molino', cantidad: 2, nivel: L('molino') })
  if (e >= 1) d.push({ tipo: 'mercado', cantidad: 1, nivel: L('mercado') })
  // 6) exploración y milicia
  d.push({ tipo: 'campamento_explorador', cantidad: 1, nivel: L('campamento_explorador') })
  d.push({ tipo: 'cuartel', cantidad: e >= 1 ? 2 : 1, nivel: L('cuartel') })
  if (e >= 1) d.push({ tipo: 'herreria', cantidad: 1, nivel: L('herreria') })
  if (e >= 1) d.push({ tipo: 'arqueria', cantidad: 2, nivel: L('arqueria') })
  if (e >= 2) d.push({ tipo: 'universidad', cantidad: 1, nivel: L('universidad') })
  if (e >= 2) d.push({ tipo: 'castillo', cantidad: 1, nivel: L('castillo') })
  if (e >= 2) d.push({ tipo: 'establo', cantidad: 1, nivel: L('establo') })
  if (e >= 2) d.push({ tipo: 'monasterio', cantidad: 1, nivel: L('monasterio') })
  if (e >= 2) d.push({ tipo: 'taller_asedio', cantidad: 1, nivel: L('taller_asedio') })
  // 7) defensa
  d.push({ tipo: 'torre_vigia', cantidad: Math.min(6, 2 + e * 2), nivel: L('torre_vigia') })
  if (e >= 2) d.push({ tipo: 'torre_ballesta', cantidad: 4, nivel: L('torre_ballesta') })
  if (MURALLA_ON) {
    d.push({ tipo: 'muralla', cantidad: 56, nivel: Math.min(def('muralla').maxNivel, a) })
    d.push({ tipo: 'puerta', cantidad: 2, nivel: Math.min(def('puerta').maxNivel, a) })
  }
  return d
}

let MURALLA_ON = true

/** Hueco libre para un edificio: primero pegado al centro, en espiral. */
function buscarHueco (tipo) {
  const d = def(tipo)
  const c = Math.floor((CONFIG.GRID - d.ancho) / 2)
  const cz = Math.floor((CONFIG.GRID - d.alto) / 2)
  for (let r = 0; r < CONFIG.GRID; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        const x = c + dx; const z = cz + dz
        if (Edificios.validarColocacion(tipo, x, z).ok) return { x, z }
      }
    }
  }
  return null
}

/** La muralla se coloca en anillo, que es como la pondría una persona. */
let anilloMuro = null
function huecoMuralla (tipo) {
  if (!anilloMuro) {
    anilloMuro = []
    const r = 9
    const c = Math.floor(CONFIG.GRID / 2)
    for (let i = -r; i <= r; i++) {
      anilloMuro.push({ x: c + i, z: c - r }, { x: c + i, z: c + r })
      anilloMuro.push({ x: c - r, z: c + i }, { x: c + r, z: c + i })
    }
  }
  for (const p of anilloMuro) if (Edificios.validarColocacion(tipo, p.x, p.z).ok) return p
  return buscarHueco(tipo)
}

/** ¿Estamos ahorrando para el salto de edad? Devuelve el coste pendiente o null. */
function ahorroEdad () {
  const est = Ciencia.puedeAvanzar()
  if (!est.siguiente || game.state.avanceEdad) return null
  const faltaEdificio = est.requisitos.some(r => r.tipo !== 'coste' && !r.ok)
  if (faltaEdificio) return null
  return est.coste
}

function permiteGasto (coste, reserva) {
  if (!reserva) return true
  for (const r of RECURSOS) {
    if ((game.state.recursos[r] - (coste[r] || 0)) < (reserva[r] || 0)) return false
  }
  return true
}

let accionesEstaVuelta = 0
const actuo = () => { accionesEstaVuelta++ }

/** Cuántas veces cada recurso ha sido el que impedía la siguiente obra. */
const bloqueosPorRecurso = { madera: 0, piedra: 0, comida: 0, oro: 0 }
let vecesSinSlot = 0
let cursorDeseo = 0

// Un jugador con cola de espera no se queda de brazos cruzados: cuando los
// constructores están liados deja encargado lo siguiente y se va. Se le permiten
// hasta CUPO_COLA encargos esperando, que es lo que cabe en una cabeza.
// Si la versión del juego no tiene cola (medición "antes"), esto no hace nada.
const CUPO_COLA = 18
const hayCola = typeof Edificios.encolar === 'function'
const enEspera = () => (hayCola ? Edificios.obrasEnEspera().length : 0)
// Con cola se encarga también lo que hoy no se puede pagar: el coste se cobra al
// empezar la obra, así que dejarlo apuntado es justo lo que haría el jugador.
const aceptable = (chk) => chk.ok || (hayCola && (chk.causa === 'obras' || chk.causa === 'recursos'))

function fasesConstruccion () {
  const reserva = ahorroEdad()
  const libres = Edificios.plazasDeObra() - game.state.obras.length
  if (libres <= 0) vecesSinSlot++
  let slots = Math.max(0, libres) + Math.max(0, CUPO_COLA - enEspera())
  if (slots <= 0) return
  // Una obra por tipo a la vez: así la aldea crece a lo ancho, como haría una persona.
  const enMarcha = new Set(game.state.obras.map(o => estado.getBuilding(o.buildingId)?.tipo))
  const faltas = {}

  // Las puertas de edad y el ayuntamiento van siempre primero; el resto rota, que
  // si no, mejorar casas y serrerías se come todas las plazas y nunca hay cuartel.
  const lista = deseos()
  const cabeza = lista.filter(w => w.puerta || w.tipo === 'ayuntamiento')
  const cola = lista.filter(w => !(w.puerta || w.tipo === 'ayuntamiento'))
  cursorDeseo = (cursorDeseo + 1) % Math.max(1, cola.length)
  const rotada = [...cabeza, ...cola.slice(cursorDeseo), ...cola.slice(0, cursorDeseo)]

  for (const w of rotada) {
    if (slots <= 0) break
    const d = def(w.tipo)
    if (!d) continue
    if (enMarcha.has(w.tipo) && w.tipo !== 'muralla') continue
    let hecho = false

    if (cuenta(w.tipo) < w.cantidad) {
      const coste = d.coste(1)
      const chk = Edificios.puedeConstruir(w.tipo)
      // el recurso que faltaba se anota igual, aunque el encargo entre en cola
      if (chk.causa === 'recursos') for (const r of Object.keys(Recursos.faltaPara(coste))) faltas[r] = (faltas[r] || 0) + 1
      if (aceptable(chk) && permiteGasto(coste, reserva)) {
        const p = (w.tipo === 'muralla' || w.tipo === 'puerta') ? huecoMuralla(w.tipo) : buscarHueco(w.tipo)
        if (p && Edificios.colocar(w.tipo, p.x, p.z)) hecho = true
      }
    }
    if (!hecho) {
      const candidatos = game.state.buildings
        .filter(b => b.tipo === w.tipo && !b.enObra && !b.mejorando && (b.nivel || 0) < w.nivel)
        .sort((a, b) => a.nivel - b.nivel)
      for (const b of candidatos) {
        const coste = d.coste(b.nivel + 1)
        const chk = Edificios.puedeMejorar(b.id)
        if (chk.causa === 'recursos') for (const r of Object.keys(Recursos.faltaPara(coste))) faltas[r] = (faltas[r] || 0) + 1
        if (!aceptable(chk)) continue
        if (!permiteGasto(coste, reserva)) continue
        if (Edificios.mejorar(b.id)) { hecho = true; break }
      }
    }
    if (hecho) { slots--; enMarcha.add(w.tipo); actuo() }
  }
  // el recurso que más veces ha dicho que no es el cuello de botella real
  const peor = Object.keys(faltas).sort((a, b) => faltas[b] - faltas[a])[0]
  if (peor) bloqueosPorRecurso[peor]++
}

function fasePoblacion () {
  const s = game.state
  const parados = s.villagers.filter(v => v.job === 'parado')
  if (parados.length) { Aldeanos.asignarAutomatico(); actuo() }
  // contratar mientras haya camas, puestos y comida de sobra
  let guardia = 0
  while (guardia++ < 4) {
    const p = Aldeanos.poblacion()
    if (p.actual >= p.maxima) break
    const coste = Aldeanos.costeContratar()
    if (s.recursos.comida < coste + 150) break
    const reserva = ahorroEdad()
    if (reserva && !permiteGasto({ comida: coste }, reserva)) break
    if (!Aldeanos.contratar()) break
    actuo()
    Aldeanos.asignarAutomatico()
  }
}

function faseCiencia () {
  const s = game.state
  // la edad va antes que la ciencia: comparten sabios
  const av = Ciencia.puedeAvanzar()
  if (av.ok) { Ciencia.avanzarEdad(); actuo(); return }
  if (s.investigacion || s.avanceEdad) return
  if (ahorroEdad()) return                       // se está juntando para la ceremonia
  const libres = Ciencia.disponibles().filter(t => t.asequible)
  if (!libres.length) return
  Ciencia.investigar(libres[0].id)
  actuo()
}

const COMPOSICION = {
  oscura: ['lancero'],
  feudal: ['lancero', 'arquero', 'espadachin'],
  castillos: ['espadachin', 'ballestero', 'jinete', 'lancero'],
  imperial: ['espadachin', 'ballestero', 'caballero', 'lancero', 'ariete']
}

function faseEjercito () {
  const oc = Ejercito.ocupacion()
  if (oc.usado >= oc.total * 0.92) return
  const reserva = ahorroEdad()
  const lista = COMPOSICION[game.state.age] || ['lancero']
  let guardia = 0
  while (guardia++ < 6) {
    const o = Ejercito.ocupacion()
    if (o.usado >= o.total * 0.92) break
    let alguno = false
    for (const t of lista) {
      const u = UNIDADES[t]
      const coste = {}
      for (const r of RECURSOS) coste[r] = u.coste[r] || 0
      if (reserva && !permiteGasto(coste, reserva)) continue
      if (!Ejercito.puedeEntrenar(t, 1).ok) continue
      if (Ejercito.entrenar(t, 1).ok) { alguno = true; actuo() }
    }
    if (!alguno) break
  }
}

function faseExpedicion () {
  if (!Expediciones.plazas()) return
  let guardia = 0
  while (Expediciones.plazasLibres() > 0 && guardia++ < 3) {
    const sug = Expediciones.sugerencias()
    let destino = sug.find(x => x.mision === 'explorar') || sug[0]
    if (!destino) destino = frontera()
    if (!destino) break
    if (!Expediciones.puedeEnviar(destino).ok) {
      // probar el resto de sugerencias antes de rendirse
      const alt = sug.find(x => Expediciones.puedeEnviar(x).ok)
      if (!alt) break
      destino = alt
    }
    if (!Expediciones.enviar(destino)) break
    actuo()
  }
}

function frontera () {
  const w = game.state.world
  if (!w || !w.tiles) return null
  const alc = Expediciones.alcance()
  let mejor = null; let mejorN = 0
  for (const t of w.tiles) {
    if (t.bioma === 'agua') continue
    if (Mapa.visible(t.x, t.y)) continue
    const d = Mapa.distanciaACasa(t.x, t.y)
    if (d > alc || d < 1) continue
    let n = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (Mapa.visible(t.x + dx, t.y + dy)) n++
    if (n > mejorN) { mejorN = n; mejor = t }
  }
  return mejor ? { x: mejor.x, y: mejor.y, mision: 'explorar' } : null
}

/** Copia de la base enemiga tal y como la prepara la interfaz (ui/army-panel.js). */
function baseDeCombate (enemigo) {
  const premio = Enemigos.recompensaDe(enemigo) || {}
  const suya = Enemigos.baseDe(enemigo) || { grid: 24, buildings: [] }
  const recursos = {}
  for (const r of RECURSOS) recursos[r] = Math.round((premio[r] || 0) * 2)
  return {
    id: enemigo.id, nombre: enemigo.nombre, nivel: enemigo.nivel, grid: suya.grid || 24,
    buildings: (suya.buildings || []).map((b, i) => ({ ...b, id: b.id || `${enemigo.id}_b${i}` })),
    guarnicion: { ...(enemigo.guarnicion || {}) },
    recursos
  }
}

events.on(EV.PLAZA_CONQUISTADA, (p) => {
  M.conquistas.push({ cuando: etiquetaMomento(), dia: diaJuego(), plaza: p.plaza.nombre, x: p.x, y: p.y, total: p.total })
})
events.on(EV.PLAZA_PERDIDA, (p) => {
  M.perdidas.push({ cuando: etiquetaMomento(), dia: diaJuego(), plaza: p.plaza.nombre, señor: p.nombreSeñor })
})

/**
 * Lo que haría un jugador con su imperio: reinvertir en las plazas (mejorarlas)
 * y dejar tropa de guarnición en la que peor pinta tenga.
 */
let ultimoImperio = 0
function faseImperio () {
  if (VT - ultimoImperio < 15 * 60000) return
  ultimoImperio = VT
  const mias = Imperio.plazas()
  if (!mias.length) return

  // 1) mejorar la plaza más barata que se pueda pagar: es la reinversión obvia
  const mejorables = mias
    .map(p => ({ p, coste: Imperio.costeMejora(p.x, p.y) }))
    .filter(m => m.coste && Recursos.puedePagar(m.coste))
    .sort((a, b) => (a.p.nivel - b.p.nivel))
  if (mejorables.length) {
    const r = Imperio.mejorarPlaza(mejorables[0].p.x, mejorables[0].p.y)
    if (r.ok) actuo()
  }

  // 2) guarnecer la plaza más floja con la tropa que sobra en casa
  const tropas = Ejercito.tropasDisponibles()
  const total = Object.values(tropas).reduce((a, b) => a + b, 0)
  if (total >= 10) {
    const floja = mias.slice().sort((a, b) => Imperio.poderPlaza(a) - Imperio.poderPlaza(b))[0]
    const envio = {}
    for (const [t, n] of Object.entries(tropas)) {
      const cede = Math.floor(n * 0.10)
      if (cede > 0) envio[t] = cede
    }
    if (Object.keys(envio).length && Imperio.reforzarPlaza(floja.x, floja.y, envio).ok) actuo()
  }
}

let ultimoAsalto = 0
function faseAsalto () {
  if (VT - ultimoAsalto < 25 * 60000) return        // no se asalta cada dos minutos
  const tropas = Ejercito.tropasDisponibles()
  const total = Object.entries(tropas).reduce((a, [t, n]) => a + ((UNIDADES[t]?.espacio || 0) > 0 ? n : 0), 0)
  if (total < 4) return
  const poder = Ejercito.poderMilitar()
  const opciones = Enemigos.emparejar(Enemigos.poderJugadorActual())
  if (!opciones.length) return
  // como un jugador: primero se remata al vasallo (su plaza pasa a ser tuya),
  // y si no hay ninguno a tiro, el igualado o lo que haya.
  const elegido = opciones.find(o => o.paso === 'conquistar' && o.ratio <= 1.15) ||
    opciones.find(o => o.etiqueta === 'igualado') || opciones[0]
  const base = baseDeCombate(elegido.enemigo)
  if (!base.buildings.length) return
  const antes = { ...game.state.recursos }
  const tropasEnviadas = {}
  for (const [t, n] of Object.entries(tropas)) if ((UNIDADES[t]?.espacio || 0) > 0 && n > 0) tropasEnviadas[t] = n
  const r = Combate.lanzarAsalto({ base, tropas: tropasEnviadas, ladoEntrada: 'sur' })
  ultimoAsalto = VT
  actuo()
  const bajas = Object.values(r.bajas || {}).reduce((a, b) => a + b, 0)
  M.asaltos.push({
    cuando: etiquetaMomento(), dia: diaJuego(), edad: game.state.age,
    rival: elegido.enemigo.nombre, etiqueta: elegido.etiqueta, nivelRival: elegido.enemigo.nivel,
    poderJugador: poder, poderRival: elegido.enemigo.poder,
    enviadas: total, victoria: r.victoria, estrellas: r.estrellas,
    pct: r.porcentajeDestruido, bajas, supervivientes: r.supervivientes,
    // `bajas` son ya los MUERTOS de verdad; el resto de los que cayeron en el
    // campo vuelven heridos y se curan solos en el cuartel (ver sim/army.js).
    cayeron: r.cayeron || bajas, heridos: r.heridos || 0,
    enfermeria: Object.values(game.state.ejercito?.heridos || {}).reduce((a, b) => a + b, 0),
    segundosCuracion: Math.max(0, Math.round(((game.state.ejercito?.curacion?.fin || 0) - VT) / 1000)),
    botin: { ...r.botin }, duracion: r.duracion,
    ganancia: RECURSOS.reduce((a, k) => a + (game.state.recursos[k] - antes[k]), 0),
    costeReentreno: costeDeTropas(r.bajas),
    // ¿pelea la guarnición? cuántos había, cuántos quedaron en pie y qué me costó
    defensores: r.defensores || 0,
    defensoresAbatidos: (r.defensores || 0) - (r.defensoresVivos || 0),
    netoReal: RECURSOS.reduce((a, k) => a + (r.botin[k] || 0), 0) -
      RECURSOS.reduce((a, k) => a + (costeDeTropas(r.bajas)[k] || 0), 0)
  })
}

function costeDeTropas (tropas) {
  const c = { madera: 0, piedra: 0, comida: 0, oro: 0, segundos: 0 }
  for (const [t, n] of Object.entries(tropas || {})) {
    const u = UNIDADES[t]; if (!u) continue
    for (const r of RECURSOS) c[r] += (u.coste[r] || 0) * n
    c.segundos += u.tiempo * n
  }
  return c
}

function reparar () {
  for (const b of game.state.buildings) {
    if (b.arruinado || (b.hp ?? 1) < (b.hpMax ?? 1) * 0.5) { Edificios.reparar(b.id); actuo() }
  }
}

/** Una vuelta de decisiones del "jugador". */
function decidir () {
  accionesEstaVuelta = 0
  try {
    reparar()
    fasePoblacion()
    fasesConstruccion()
    faseCiencia()
    faseEjercito()
    faseExpedicion()
    faseAsalto()
    faseImperio()
    // reclamar encargos cumplidos (es lo primero que hace cualquiera)
    for (const q of Encargos.activas()) if (q.listo) { Encargos.reclamar(q.id); actuo() }
  } catch (e) {
    fallo('critica', 'ia-' + e.message.slice(0, 50), `El jugador automático ha reventado: ${e.message}\n${e.stack}`)
  }
  return accionesEstaVuelta
}

function hayAlgoEnMarcha () {
  const s = game.state
  return s.obras.length > 0 || (s.ejercito.cola || []).length > 0 || !!s.investigacion || !!s.avanceEdad ||
    (s.expediciones || []).some(e => e.estado === 'fuera')
}

// ────────────────────────────── 10. LA PARTIDA ──────────────────────────────
const SESIONES = [
  { hora: 8, minutos: 20 },
  { hora: 14, minutos: 20 },
  { hora: 21, minutos: 25 }
]

async function jugarPartida () {
  console.log('\n=== PARTIDA AUTOMÁTICA DE BALUARTE ===')
  await arrancar()
  T0 = VT
  M.inicio = VT
  hito('partida nueva')

  let horaActual = 8
  for (let dia = 1; dia <= DIAS; dia++) {
    for (let s = 0; s < SESIONES.length; s++) {
      const ses = SESIONES[s]
      // --- salto de tiempo: la app estaba cerrada ---
      const saltoH = s === 0 ? (dia === 1 ? 0 : 24 - horaActual + ses.hora) : ses.hora - horaActual
      if (saltoH > 0) {
        avanzar(saltoH * HORA_MS)
        const off = save.cargar()             // así es como vuelve el jugador: abre la app
        if (off > 60) events.emit('offline:report', { seconds: off })
      }
      horaActual = ses.hora

      const resumenIni = foto()
      let bloqueado = 0; let muerto = 0
      const ticksSesion = Math.round((ses.minutos * 60) / PASO)
      const cadaDecision = Math.round(20 / PASO)     // decide cada 20 s de juego
      for (let t = 0; t < ticksSesion; t += cadaDecision) {
        tick(cadaDecision, true)
        const acciones = decidir()
        if (acciones === 0) {
          if (hayAlgoEnMarcha()) bloqueado += 20
          else muerto += 20
        }
      }
      M.segundosBloqueado += bloqueado
      M.segundosMuerto += muerto
      horaActual += ses.minutos / 60
      save.guardar()

      const resImp = Imperio.resumenImperio()
      M.imperio.push({
        dia, sesion: s + 1, plazas: resImp.plazas, nivelMedio: resImp.nivelMedio,
        produccionImperio: resImp.produccionTotal, produccionAldea: resImp.produccionAldea,
        pctSobreAldea: resImp.porcentajeSobreAldea, vasallos: resImp.vasallos,
        alAlcance: resImp.alAlcance, fueraDeAlcance: resImp.fueraDeAlcance, puesto: resImp.puesto
      })
      M.sesiones.push({
        dia, sesion: s + 1, horas: +horasJuego().toFixed(2),
        edad: game.state.age, ayto: aytoNivel(),
        recursos: { ...game.state.recursos }, almacen: { ...game.state.almacen },
        pm: Recursos.produccionPorMinuto(),
        edificios: game.state.buildings.length, aldeanos: game.state.villagers.length,
        obras: game.state.obras.length, espera: enEspera(), cola: (game.state.ejercito.cola || []).length,
        esperaDetalle: hayCola ? Edificios.obrasEnEspera().map(e => `${e.icono}${e.nombre} n${e.nivel} ${e.aviso || (e.pagable ? 'lista' : 'sin material')}`) : [],
        poder: Ejercito.poderMilitar(), nivel: game.state.jugador.nivel,
        gemas: game.state.jugador.gemas,
        bloqueadoSeg: bloqueado, muertoSeg: muerto,
        cuelloBotella: cuelloDeBotella(resumenIni),
        censo: censoEdificios()
      })

      if (dia === 5 && s === 1) pruebaGuardarCargar()
    }
    if (dia % 5 === 0) {
      console.log(`   · día ${dia}: ${game.state.age}, ayto ${aytoNivel()}, ` +
        `${game.state.buildings.length} edificios, ${game.state.villagers.length} aldeanos, ` +
        `poder ${Ejercito.poderMilitar()}, nivel ${game.state.jugador.nivel}`)
    }
  }
}

/** Censo de la aldea: tipo -> "cantidad×nivelMedio". */
function censoEdificios () {
  const c = {}
  for (const b of game.state.buildings) {
    if (!c[b.tipo]) c[b.tipo] = { n: 0, niveles: [] }
    c[b.tipo].n++
    c[b.tipo].niveles.push(b.nivel)
  }
  const out = {}
  for (const [t, v] of Object.entries(c)) out[t] = `${v.n}×n${Math.max(...v.niveles)}`
  return out
}

/** Qué recurso frena de verdad: el que más veces impide la siguiente compra. */
const frenos = { madera: 0, piedra: 0, comida: 0, oro: 0 }
function cuelloDeBotella () {
  // se mira lo que falta para el siguiente deseo caro
  const a = aytoNivel()
  const ayto = terminados('ayuntamiento')[0]
  const objetivo = ayto && ayto.nivel < 8 ? def('ayuntamiento').coste(ayto.nivel + 1) : (EDADES[ORDEN_EDADES[iEdad() + 1]]?.coste || null)
  if (!objetivo) return null
  const falta = Recursos.faltaPara(objetivo)
  const k = Object.keys(falta)
  if (!k.length) return null
  const peor = k.sort((x, y) => (falta[y] / (game.state.almacen[y] || 1)) - (falta[x] / (game.state.almacen[x] || 1)))[0]
  frenos[peor]++
  return peor
}

// ───────────────────── 11. prueba de guardado y de offline ─────────────────────
function pruebaGuardarCargar () {
  const aud = auditarEstado('mitad de partida')
  save.guardar()
  const antes = JSON.parse(JSON.stringify(game.state))
  const off = save.cargar()
  const despues = game.state
  const dif = []
  const comparar = (a, b, ruta, prof = 0) => {
    if (prof > 8 || dif.length > 20) return
    if (a === b) return
    if (typeof a !== typeof b) { dif.push(`${ruta}: ${typeof a} -> ${typeof b}`); return }
    if (a && b && typeof a === 'object') {
      const ks = new Set([...Object.keys(a), ...Object.keys(b)])
      for (const k of ks) comparar(a[k], b[k], `${ruta}.${k}`, prof + 1)
      return
    }
    if (a !== b) dif.push(`${ruta}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`)
  }
  comparar(antes, despues, 'state')
  M.saveLoad = { bytes: aud.bytes, offlineSeg: off, diferencias: dif.slice(0, 20), problemas: aud.problemas }
  if (dif.length) {
    fallo('media', 'save-dif', `Guardar y cargar cambia ${dif.length} campos del estado: ${dif.slice(0, 6).join(' | ')}`)
  }
  hito('prueba de guardar/cargar', `${aud.bytes} bytes, ${dif.length} diferencias`)
}

function pruebaOffline10h () {
  const antes = { ...game.state.recursos }
  const pm = Recursos.produccionPorMinuto()
  save.guardar()
  avanzar(10 * HORA_MS)
  const off = save.cargar()
  events.emit('offline:report', { seconds: off })
  tick(4)
  const ganado = {}
  for (const r of RECURSOS) ganado[r] = game.state.recursos[r] - antes[r]
  const esperado8h = {}
  for (const r of RECURSOS) esperado8h[r] = Math.round(pm[r] * 480)
  const res = { offlineSegundos: off, tope: CONFIG.MAX_OFFLINE_HORAS * 3600, ganado, esperado8h, pm, antes, despues: { ...game.state.recursos } }
  if (off > CONFIG.MAX_OFFLINE_HORAS * 3600 + 1) fallo('alta', 'offline-tope', `cargar() devuelve ${off}s, por encima del tope de ${CONFIG.MAX_OFFLINE_HORAS}h`)
  return res
}

// ─────────────────────────── 12. LABORATORIO DE COMBATE ───────────────────────────
function copiaBase (b) { return JSON.parse(JSON.stringify(b)) }

async function laboratorio () {
  const lab = { composiciones: [], murallas: null, rentabilidad: [], defensa: null, rendimiento: {} }
  const vivos = Enemigos.enemigosVivos()
  if (!vivos.length) { lab.error = 'no hay rivales descubiertos'; return lab }

  const pj = Enemigos.poderJugadorActual()
  const parejas = Enemigos.emparejar(pj)
  const rival = (parejas.find(p => p.etiqueta === 'igualado') || parejas[0])?.enemigo
  if (!rival) { lab.error = 'emparejar() no devuelve rivales'; return lab }
  const base = baseDeCombate(rival)

  // --- A) composiciones con el MISMO presupuesto de huecos ---
  const huecos = Math.max(20, Ejercito.ocupacion().total)
  const recetas = {
    'solo lanceros': { lancero: huecos },
    'solo espadachines': { espadachin: huecos },
    'solo arqueros': { arquero: huecos },
    'solo ballesteros': { ballestero: huecos },
    'solo caballeros': { caballero: Math.floor(huecos / 3) },
    'solo jinetes': { jinete: Math.floor(huecos / 2) },
    'mixta inf+dist': { espadachin: Math.floor(huecos / 2), ballestero: Math.floor(huecos / 2) },
    'con asedio': { ariete: 2, espadachin: Math.floor((huecos - 8) / 2), ballestero: Math.floor((huecos - 8) / 2) },
    'con monjes': { espadachin: Math.floor(huecos / 2) - 2, ballestero: Math.floor(huecos / 2) - 2, monje: 4 }
  }
  for (const [nombre, tropas] of Object.entries(recetas)) {
    const limpias = {}
    for (const [t, n] of Object.entries(tropas)) if (n > 0) limpias[t] = n
    if (!Object.keys(limpias).length) continue
    const t0 = ahoraReal()
    const r = Combate.simularAsalto({ base: copiaBase(base), tropas: limpias, ladoEntrada: 'sur', semilla: 12345, propias: true })
    const ms = ahoraReal() - t0
    const coste = costeDeTropas(limpias)
    const bajas = costeDeTropas(r.bajas)
    lab.composiciones.push({
      nombre, tropas: limpias, huecosUsados: Object.entries(limpias).reduce((a, [t, n]) => a + UNIDADES[t].espacio * n, 0),
      victoria: r.victoria, estrellas: r.estrellas, pct: r.porcentajeDestruido,
      bajas: Object.values(r.bajas || {}).reduce((a, b) => a + b, 0),
      supervivientes: r.supervivientes, duracion: r.duracion,
      botin: r.botin,
      costeEntrenar: coste, costeBajas: bajas,
      balance: RECURSOS.reduce((a, k) => a + (r.botin[k] || 0) - bajas[k], 0),
      msSimulacion: +ms.toFixed(1)
    })
  }

  // --- B) misma base, con y sin murallas ---
  const conMuro = copiaBase(base)
  const sinMuro = copiaBase(base)
  sinMuro.buildings = sinMuro.buildings.filter(b => b.tipo !== 'muralla' && b.tipo !== 'puerta')
  const tropasPrueba = { espadachin: Math.floor(huecos / 2), ballestero: Math.floor(huecos / 2) }
  const a1 = Combate.simularAsalto({ base: conMuro, tropas: tropasPrueba, ladoEntrada: 'sur', semilla: 777, propias: true })
  const a2 = Combate.simularAsalto({ base: sinMuro, tropas: tropasPrueba, ladoEntrada: 'sur', semilla: 777, propias: true })
  lab.murallas = {
    tramos: base.buildings.filter(b => b.tipo === 'muralla' || b.tipo === 'puerta').length,
    con: { victoria: a1.victoria, estrellas: a1.estrellas, pct: a1.porcentajeDestruido, bajas: Object.values(a1.bajas).reduce((x, y) => x + y, 0), duracion: a1.duracion },
    sin: { victoria: a2.victoria, estrellas: a2.estrellas, pct: a2.porcentajeDestruido, bajas: Object.values(a2.bajas).reduce((x, y) => x + y, 0), duracion: a2.duracion }
  }

  // --- C) mi propia aldea: con y sin muralla, contra la hueste del rival ---
  const miBase = { id: 'aldea', nombre: 'mía', nivel: aytoNivel(), buildings: game.state.buildings, recursos: game.state.recursos }
  const miSinMuro = { ...miBase, buildings: game.state.buildings.filter(b => b.tipo !== 'muralla' && b.tipo !== 'puerta') }
  const hueste = {}
  for (const [t, n] of Object.entries(rival.guarnicion || {})) hueste[t] = Math.max(1, Math.round(n * 0.75))
  const d1 = Combate.simularAsalto({ base: copiaBase(miBase), tropas: hueste, ladoEntrada: 'sur', semilla: 999, propias: false })
  const d2 = Combate.simularAsalto({ base: copiaBase(miSinMuro), tropas: hueste, ladoEntrada: 'sur', semilla: 999, propias: false })
  lab.defensa = {
    puntuacion: Combate.calcularDefensa(),
    huesteEnemiga: hueste,
    conMuralla: { estrellasEnemigo: d1.estrellas, pct: d1.porcentajeDestruido, bajasEnemigo: Object.values(d1.bajas).reduce((x, y) => x + y, 0) },
    sinMuralla: { estrellasEnemigo: d2.estrellas, pct: d2.porcentajeDestruido, bajasEnemigo: Object.values(d2.bajas).reduce((x, y) => x + y, 0) }
  }

  // --- D) rentabilidad frente a cada etiqueta de emparejamiento ---
  for (const p of parejas) {
    const b = baseDeCombate(p.enemigo)
    const mias = Ejercito.tropasDisponibles()
    const envio = {}
    for (const [t, n] of Object.entries(mias)) if ((UNIDADES[t]?.espacio || 0) > 0 && n > 0) envio[t] = n
    if (!Object.keys(envio).length) continue
    const r = Combate.simularAsalto({ base: b, tropas: envio, ladoEntrada: 'sur', semilla: 4242, propias: true })
    const perdido = costeDeTropas(r.bajas)
    lab.rentabilidad.push({
      etiqueta: p.etiqueta, ratio: p.ratio, rival: p.enemigo.nombre, nivel: p.enemigo.nivel,
      victoria: r.victoria, estrellas: r.estrellas, pct: r.porcentajeDestruido,
      botin: r.botin, bajas: Object.values(r.bajas).reduce((x, y) => x + y, 0),
      costeBajas: perdido,
      neto: RECURSOS.reduce((a, k) => a + (r.botin[k] || 0) - perdido[k], 0),
      minutosReentreno: +(perdido.segundos / 60).toFixed(1)
    })
  }

  // --- E) batalla grande: coste en ms ---
  const grande = { lancero: 60, espadachin: 40, ballestero: 40, caballero: 15, ariete: 4 }
  const t0 = ahoraReal()
  const rg = Combate.simularAsalto({ base: copiaBase(base), tropas: grande, ladoEntrada: 'sur', semilla: 31337, propias: true })
  lab.rendimiento.batallaGrande = { unidades: 159, ms: +(ahoraReal() - t0).toFixed(1), duracion: rg.duracion, sucesos: rg.sucesos.length }

  // --- F) los cuellos de CPU que se cuelan dentro de un tick ---
  const cronometrar = (nombre, veces, fn) => {
    const t = ahoraReal()
    for (let i = 0; i < veces; i++) fn(i)
    return { nombre, veces, msTotal: +(ahoraReal() - t).toFixed(1), msPorVez: +((ahoraReal() - t) / veces).toFixed(2) }
  }
  const { makeRng } = await import('../src/core/rng.js')
  lab.rendimiento.generarBase = cronometrar('generarBase(nivel 12)', 20, (i) => Enemigos.generarBase(12, 'señor', makeRng(1000 + i)))
  lab.rendimiento.defensaDeMiAldea = cronometrar('simular una defensa de mi aldea', 5, () =>
    Combate.simularAsalto({ base: copiaBase(miBase), tropas: hueste, ladoEntrada: 'norte', semilla: 55, propias: false }))
  lab.rendimiento.calcularDefensa = cronometrar('calcularDefensa()', 20, () => Combate.calcularDefensa())
  lab.rendimiento.guardar = cronometrar('JSON.stringify del estado (autoguardado cada 10 s)', 10, () => JSON.stringify(game.state))
  lab.rendimiento.bytesGuardado = JSON.stringify(game.state).length
  lab.rendimiento.produccionPorMinuto = cronometrar('produccionPorMinuto()', 50, () => Recursos.produccionPorMinuto())
  return lab
}

// ─────────────────────── 12b. cobertura del bus de eventos ───────────────────────
/** Eventos del catálogo EV que nadie escucha, y emisiones al vacío. */
const MIS_ESCUCHAS = ['ui:toast', 'age:advanced', 'tech:researched', 'build:completed', 'build:upgraded', 'build:placed', 'res:gained', 'res:offline']
function informeEventos () {
  const oyentes = (t) => (ESCUCHADOS.get(t) || 0) - (MIS_ESCUCHAS.includes(t) ? 1 : 0)
  const sinOyentes = []
  const nuncaEmitidos = []
  for (const [nombre, tipo] of Object.entries(EV)) {
    const o = oyentes(tipo)
    const e = EMITIDOS.get(tipo) || 0
    if (o <= 0) sinOyentes.push({ EV: nombre, tipo, emisiones: e })
    if (e === 0) nuncaEmitidos.push({ EV: nombre, tipo, oyentes: o })
  }
  // eventos emitidos como cadena suelta, fuera del catálogo EV
  const delCatalogo = new Set(Object.values(EV))
  const fueraDelCatalogo = [...EMITIDOS.keys()].filter(t => !delCatalogo.has(t))
  return { sinOyentes, nuncaEmitidos, fueraDelCatalogo, emisiones: Object.fromEntries([...EMITIDOS.entries()].sort((a, b) => b[1] - a[1])) }
}

// ─────────────────────────────── 13. informe ───────────────────────────────
function resumenFinal () {
  const s = game.state
  const mediaTick = M.rendimiento.ms / Math.max(1, M.rendimiento.ticks)
  const mediaLleno = M.rendimiento.msLlenos / Math.max(1, M.rendimiento.ticksLlenos)
  const hitosEdad = {}
  for (const h of M.hitos) if (h.que.startsWith('EDAD ')) hitosEdad[h.que.slice(5).toLowerCase()] = h
  return {
    terminada: s.age === 'imperial',
    edadFinal: s.age,
    diasSimulados: DIAS,
    horasReloj: +horasJuego().toFixed(1),
    horasJugadas: +(M.segundosJugados / 3600).toFixed(2),
    hitosEdad: Object.fromEntries(Object.entries(hitosEdad).map(([k, v]) => [k, { dia: v.dia, horas: v.horas }])),
    aytoFinal: aytoNivel(),
    nivelJugador: s.jugador.nivel,
    gemas: s.jugador.gemas,
    edificios: s.buildings.length,
    aldeanos: s.villagers.length,
    poblacion: Aldeanos.poblacion(),
    techs: Object.keys(s.research || {}).filter(k => s.research[k]).length,
    techsTotales: Object.keys(TECNOLOGIAS).length,
    encargosCompletados: (s.quests?.completadas || []).length,
    recursos: { ...s.recursos },
    almacen: { ...s.almacen },
    produccionMin: Recursos.produccionPorMinuto(),
    ejercito: { ...s.ejercito.tropas }, poder: Ejercito.poderMilitar(),
    capacidadEjercito: Ejercito.ocupacion(),
    consumoComidaMin: Ejercito.consumoComida(),
    horasDeObraEncargadas: +(M.segundosObra / 3600).toFixed(1),
    producido: Object.fromEntries(Object.entries(M.producido).map(([k, v]) => [k, Math.round(v)])),
    desperdiciado: Object.fromEntries(Object.entries(M.desperdicio).map(([k, v]) => [k, Math.round(v)])),
    frenos,
    bloqueosPorRecurso,
    vecesSinSlotDeObra: vecesSinSlot,
    colaDeEspera: {
      hayCola,
      maxima: M.sesiones.reduce((a, s) => Math.max(a, s.espera || 0), 0),
      mediaAlCerrarSesion: +(M.sesiones.reduce((a, s) => a + (s.espera || 0), 0) / Math.max(1, M.sesiones.length)).toFixed(2),
      pendientesAlFinal: hayCola ? Edificios.obrasEnEspera().length : 0
    },
    paron: {
      minutosBloqueado: +(M.segundosBloqueado / 60).toFixed(1),
      minutosMuerto: +(M.segundosMuerto / 60).toFixed(1),
      pctDelTiempo: +((M.segundosBloqueado + M.segundosMuerto) / Math.max(1, M.segundosJugados) * 100).toFixed(1)
    },
    rendimiento: {
      msPorTickMedia: +mediaTick.toFixed(3),
      msPorTickAldeaLlena: +mediaLleno.toFixed(3),
      picoMs: +M.rendimiento.picoMs.toFixed(2),
      ticks: M.rendimiento.ticks
    },
    asaltos: {
      total: M.asaltos.length,
      ganados: M.asaltos.filter(a => a.victoria).length,
      mediaEstrellas: +(M.asaltos.reduce((a, b) => a + b.estrellas, 0) / Math.max(1, M.asaltos.length)).toFixed(2),
      netoMedio: Math.round(M.asaltos.reduce((a, b) => a + b.ganancia, 0) / Math.max(1, M.asaltos.length))
    },
    aytoEnObra: {
      minutosJugandoConElAytoEnAndamios: +(M.segundosAytoEnObra / 60).toFixed(1),
      pctDelTiempoJugado: +(M.segundosAytoEnObra / Math.max(1, M.segundosJugados) * 100).toFixed(1)
    },
    imperio: (() => {
      const r = Imperio.resumenImperio()
      const comarcas = Enemigos.todosLosRivales().length
      return {
        plazasConquistadas: r.plazas,
        conquistasTotales: r.conquistadas,
        plazasPerdidas: r.perdidas,
        nivelMedioPlazas: r.nivelMedio,
        vasallosQuePagan: r.vasallos,
        produccionImperioMin: r.produccion,
        produccionImperioTotal: r.produccionTotal,
        produccionAldeaTotal: r.produccionAldea,
        pctImperioSobreAldea: r.porcentajeSobreAldea,
        tributoDiaTotal: r.tributoDiaTotal,
        guarnicionTotal: r.guarnicion,
        objetivosAlAlcance: r.alAlcance,
        objetivosFueraDeAlcance: r.fueraDeAlcance,
        // ¿se agota el mapa? comarcas con señor frente a las que ya son tuyas
        comarcasDelValle: comarcas,
        pctDelValleConquistado: comarcas ? Math.round((r.plazas / comarcas) * 100) : 0,
        puestoEnLaTablaDePoder: r.puesto,
        tablaDePoder: r.señores.map(t => `${t.eresTu ? '★ ' : ''}${t.nombre}: ${t.plazas} plazas, poder ${t.poder}`),
        porSesion: M.imperio.filter((_, i) => i % 9 === 0),
        conquistasPorDia: M.conquistas.map(c => `d${c.dia} ${c.plaza}`),
        quitadas: M.perdidas.map(c => `d${c.dia} ${c.plaza} (${c.señor || 'nadie'})`)
      }
    })(),
    eventos: informeEventos(),
    toasts: M.toasts,
    fallos: FALLOS.length,
    repeticiones: Object.fromEntries([...vistos.entries()].filter(([, n]) => n > 1))
  }
}

// ──────────────────────────────── ejecución ────────────────────────────────
const tArranque = ahoraReal()
try {
  await jugarPartida()

  hito('fin de los 30 días')
  M.laboratorio = await laboratorio()
  M.offline10h = pruebaOffline10h()
  M.auditoriaFinal = auditarEstado('final')
  invariantesLentos()

  const resumen = resumenFinal()
  const salida = { resumen, ticksLentos: M.ticksLentos.sort((a,b)=>b.ms-a.ms).slice(0,15), hitos: M.hitos, sesiones: M.sesiones, asaltos: M.asaltos, imperio: M.imperio, conquistas: M.conquistas, perdidas: M.perdidas, laboratorio: M.laboratorio, saveLoad: M.saveLoad, offline: M.offline, offline10h: M.offline10h, fallos: FALLOS, auditoria: M.auditoriaFinal }
  writeFileSync(SALIDA_JSON, JSON.stringify(salida, null, 1))

  console.log('\n───────────────────── RESUMEN ─────────────────────')
  console.log(JSON.stringify(resumen, null, 1))
  console.log('\n───────────────────── FALLOS (' + FALLOS.length + ') ─────────────────────')
  for (const f of FALLOS) console.log(`[${f.grav}] (${f.cuando}) ${f.texto}`)
  console.log('\nJSON completo en ' + SALIDA_JSON)
  console.log('Tiempo real de la simulación: ' + ((ahoraReal() - tArranque) / 1000).toFixed(1) + ' s')
} finally {
  if (existsSync(COMBATE_PARCHE)) { try { unlinkSync(COMBATE_PARCHE) } catch { /* da igual */ } }
}
