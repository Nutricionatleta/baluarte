import { events, EV } from '../core/events.js'
import { game, getBuilding, getVillager, nuevoId } from '../core/state.js'
import { CONFIG } from '../core/config.js'
import { dentro, centroDe, tamañoDe, dist } from '../core/grid.js'
import { makeRng } from '../core/rng.js'
import { def } from '../data/buildings.js'
import { nombreAldeano } from '../data/names.js'
import { UNIDADES } from '../data/units.js'

/**
 * ALDEANOS. Dueño único de `game.state.villagers`.
 *
 * Aquí no se produce nada: la producción por minuto es cosa de sim/resources.js,
 * que lee `building.trabajadores` (esta casa lo mantiene al día) y debe multiplicar
 * por `factorProduccion()` — o por `game.state.animo.factor`, que es el mismo número
 * publicado en el estado para quien no pueda importar este módulo.
 * Lo que sí manda este fichero es la VIDA: quién nace, dónde trabaja, por dónde
 * camina, cuándo se va a dormir y cuánto le baja el ánimo cuando no hay qué comer.
 *
 * Rendimiento: hasta 67 aldeanos a 4 ticks/s. Nada de recorrer `buildings` por
 * aldeano: todo lo que se consulta a menudo (rejilla de estorbos, puertas, casas,
 * obras, índice por id) vive en cachés que solo se rehacen cuando cambia la aldea.
 * Los temporizadores y las manías de cada uno van en `memoria`, fuera del guardado.
 */

// --------------------------------------------------------------- constantes
const VEL = UNIDADES.aldeano.velocidad          // casillas por segundo (1.6)
const COSTE_BASE = UNIDADES.aldeano.coste.comida
const SUBIDA_COSTE = 1.15                       // cada aldeano nuevo cuesta un 15 % más
const CAMAS_AYUNTAMIENTO = 3                    // los fundadores duermen en el propio ayuntamiento
const PLAZAS_OBRA = 3                           // martillos que caben en un andamio
const SEG_POR_DIA = 480                         // ciclo de 8 min, el mismo que usa render/fx
const MOMENTO_INICIAL = 0.36                    // arranca a media mañana, como el sol de fx
const NOCHE_DESDE = 0.80
const NOCHE_HASTA = 0.22
const HAMBRE_PARA_BAJON = 15                    // segundos con la despensa a 0
const PENALIZA_HAMBRE = 0.75                    // la comida deja de ser decorativa
const LLEGADA = 0.16                            // a esta distancia se da por llegado

const JOB_POR_TIPO = {
  serreria: 'leñador',
  cantera: 'cantero',
  granja: 'granjero',
  mina_oro: 'minero',
  campamento_explorador: 'explorador'
}
const RECURSO_POR_JOB = { leñador: 'madera', cantero: 'piedra', granjero: 'comida', minero: 'oro' }
const TIPO_POR_RECURSO = { madera: 'serreria', piedra: 'cantera', comida: 'granja', oro: 'mina_oro' }

// ------------------------------------------------------------------ cachés
let sucio = true
let ocupacion = null            // Uint8Array GRID*GRID: 1 = por ahí no se pasa
let porId = new Map()           // buildingId -> edificio
let puertas = new Map()         // buildingId -> casilla libre pegada al edificio
let ayuntamiento = null
let casas = []
let pozos = []
let obras = []
let conteoEdificios = -1
let yacimientos = null
let semillaYac = null

const memoria = new Map()       // villagerId -> { t, fase, rodeo, lado… } NO se guarda
let momento = MOMENTO_INICIAL
let hambre = 0
let factor = 1
let ultimaMaxima = -1
let sembrado = false
let pulso = 0

// ----------------------------------------------------------------- arranque
export function init () {
  events.on(EV.TICK, alTick)
  const ensuciar = () => { sucio = true }
  events.on(EV.BUILD_PLACED, ensuciar)
  events.on(EV.BUILD_COMPLETED, ensuciar)
  events.on(EV.BUILD_UPGRADED, ensuciar)
  events.on(EV.BUILD_DEMOLISHED, ensuciar)
  events.on(EV.STATE_LOADED, () => {
    sucio = true; yacimientos = null; memoria.clear()
    sembrado = false; ultimaMaxima = -1; hambre = 0
    sanear()
  })
  sanear()
}

/** Deja el estado en un sitio conocido: campos completos y `trabajadores` al día. */
function sanear () {
  const s = game.state
  if (!Array.isArray(s.villagers)) s.villagers = []
  for (const v of s.villagers) {
    if (v.x == null) { v.x = 0; v.z = 0 }
    if (v.destinoX == null) { v.destinoX = v.x; v.destinoZ = v.z }
    if (!v.job) v.job = 'parado'
    if (!v.estado) v.estado = 'descansando'
    if (v.portando === undefined) v.portando = null
    if (typeof v.animo !== 'number') v.animo = 1
  }
  sincronizarTrabajadores()
}

/** `buildings[].trabajadores` es del contrato; la verdad son los `buildingId`. */
function sincronizarTrabajadores () {
  const s = game.state
  if (!Array.isArray(s.buildings)) return
  for (const b of s.buildings) b.trabajadores = []
  for (const v of s.villagers) {
    if (!v.buildingId) continue
    const b = s.buildings.find(x => x.id === v.buildingId)
    if (b) b.trabajadores.push(v.id)
    else { v.buildingId = null; v.job = 'parado' }
  }
}

// -------------------------------------------------------- cachés de la aldea
function refrescar () {
  const s = game.state
  const G = CONFIG.GRID
  if (!ocupacion) ocupacion = new Uint8Array(G * G)
  else ocupacion.fill(0)
  porId.clear(); puertas.clear()
  ayuntamiento = null; casas = []; pozos = []; obras = []

  for (const b of s.buildings || []) {
    porId.set(b.id, b)
    if (b.tipo === 'ayuntamiento') ayuntamiento = b
    else if (b.tipo === 'casa' && !b.enObra) casas.push(b)
    else if (b.tipo === 'pozo') pozos.push(b)
    if (b.enObra) obras.push(b)

    const d = def(b.tipo)
    if (d && d.categoria === 'decoracion') continue   // el pozo y el estandarte no estorban
    if (d && d.bloquea === false) continue            // la puerta está para cruzarla
    const t = tamañoDe(b)
    for (let z = b.z; z < b.z + t.alto; z++) {
      for (let x = b.x; x < b.x + t.ancho; x++) if (dentro(x, z)) ocupacion[z * G + x] = 1
    }
  }
  conteoEdificios = (s.buildings || []).length
  sucio = false
}

const alDia = () => { if (sucio || conteoEdificios !== (game.state.buildings || []).length) refrescar() }
const edificio = (id) => (id ? porId.get(id) || null : null)

function bloqueada (x, z) {
  const cx = Math.round(x), cz = Math.round(z)
  if (!dentro(cx, cz)) return true
  if (!ocupacion) return false
  return ocupacion[cz * CONFIG.GRID + cx] === 1
}

/** Casilla libre pegada al edificio: allí es donde se planta el aldeano. */
function puertaDe (b) {
  const previa = puertas.get(b.id)
  if (previa) return previa
  const t = tamañoDe(b)
  const c = centroDe(b)
  const medio = (CONFIG.GRID - 1) / 2
  const cand = []
  for (let x = b.x - 1; x <= b.x + t.ancho; x++) cand.push({ x, z: b.z - 1 }, { x, z: b.z + t.alto })
  for (let z = b.z; z < b.z + t.alto; z++) cand.push({ x: b.x - 1, z }, { x: b.x + t.ancho, z })
  let mejor = null, md = Infinity
  for (const q of cand) {
    if (bloqueada(q.x, q.z)) continue
    // la que mira a la plaza: así la gente se cruza por el centro y no por detrás
    const d = dist(q.x, q.z, medio, medio)
    if (d < md) { md = d; mejor = q }
  }
  if (!mejor) mejor = { x: c.x, z: c.z }   // tapiado por murallas: que entre igual
  puertas.set(b.id, mejor)
  return mejor
}

/** Casilla libre cerca de un punto (espiral corta). Evita mandar a nadie contra un muro. */
function libreCerca (x, z) {
  const cx = Math.round(x), cz = Math.round(z)
  if (!bloqueada(cx, cz)) return { x: cx, z: cz }
  for (let r = 1; r <= 5; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        if (!bloqueada(cx + dx, cz + dz)) return { x: cx + dx, z: cz + dz }
      }
    }
  }
  return { x: cx, z: cz }
}

// ------------------------------------------------------------- yacimientos
/**
 * Dónde hay bosque, roca y vetas. Se deducen de la semilla con la misma receta
 * que usa render/terrain para sembrar bosquecillos y afloramientos (anillos a
 * 11-18 casillas del centro), así que los aldeanos salen a talar donde se ven
 * árboles y no en mitad de un prado pelado.
 */
function recursosMapa () {
  const s = game.state
  if (yacimientos && semillaYac === s.seed) return yacimientos
  const r = makeRng(((s.seed || 1) ^ 0x9e3779b9) >>> 0)
  const medio = (CONFIG.GRID - 1) / 2
  const punto = (ang, rad) => {
    const p = libreCerca(medio + Math.cos(ang) * rad, medio + Math.sin(ang) * rad)
    return { x: Math.min(CONFIG.GRID - 2, Math.max(1, p.x)), z: Math.min(CONFIG.GRID - 2, Math.max(1, p.z)) }
  }
  const anillo = r.shuffle([0, 1, 2, 3, 4, 5])
  const madera = [], piedra = [], oro = [], comida = []
  for (let k = 0; k < 4; k++) madera.push(punto((anillo[k] / 6) * Math.PI * 2 + r.float(-0.25, 0.25), r.float(11, 16)))
  for (let k = 0; k < 3; k++) piedra.push(punto(((anillo[(k + 3) % 6] + 0.5) / 6) * Math.PI * 2 + r.float(-0.3, 0.3), r.float(12, 16)))
  for (let k = 0; k < 2; k++) oro.push(punto(((anillo[k] + 0.25) / 6) * Math.PI * 2, r.float(13, 16)))
  for (let k = 0; k < 3; k++) comida.push(punto(((anillo[(k + 2) % 6] + 0.7) / 6) * Math.PI * 2, r.float(8, 12)))
  yacimientos = { madera, piedra, oro, comida }
  semillaYac = s.seed
  return yacimientos
}

function yacimientoCerca (recurso, x, z) {
  const lista = recursosMapa()[recurso]
  if (!lista || !lista.length) return null
  let mejor = null, md = Infinity
  for (const p of lista) { const d = dist(x, z, p.x, p.z); if (d < md) { md = d; mejor = p } }
  return mejor
}

// -------------------------------------------------------------- día y noche
/** Momento del día 0..1 (0.25 amanece, 0.5 mediodía, 0.75 anochece). */
export const horaDelDia = () => momento
export const esDeNoche = () => momento >= NOCHE_DESDE || momento < NOCHE_HASTA

// ------------------------------------------------------------------- ánimo
/** Lo que rinde hoy la aldea: 1 normal, 0.75 con la despensa vacía. */
export const factorProduccion = () => factor

function actualizarAnimo (dt) {
  const s = game.state
  if ((s.recursos?.comida || 0) <= 0) hambre += dt
  else hambre = Math.max(0, hambre - dt * 3)

  const malo = hambre >= HAMBRE_PARA_BAJON
  const nuevo = malo ? PENALIZA_HAMBRE : 1
  if (nuevo !== factor) {
    factor = nuevo
    avisar(malo
      ? 'La despensa está vacía: la gente trabaja con desgana'
      : 'Hay pan otra vez: la aldea recupera el ánimo', malo ? 'mal' : 'bien')
  }
  if ((pulso & 3) === 0) {             // suavizar el ánimo una vez por segundo basta
    const meta = malo ? 0.3 : 1
    for (const v of s.villagers) v.animo = Math.round((v.animo + (meta - v.animo) * 0.12) * 100) / 100
  }
  s.animo = { valor: malo ? 0.3 : 1, hambre: Math.round(hambre), factor }
}

// -------------------------------------------------------------------- API
/** @returns {{actual:number, maxima:number}} el tope sale del ayuntamiento, limitado por camas. */
export function poblacion () {
  alDia()
  const actual = game.state.villagers.length
  // Basta con que TENGA nivel: mientras se mejora sigue en pie y las camas
  // siguen puestas. Antes, subir el Ayuntamiento dejaba el censo a 0 camas.
  const enPie = ayuntamiento && (ayuntamiento.nivel || 0) > 0
  if (!enPie) return { actual, maxima: 0 }
  const tope = def('ayuntamiento').poblacionMax(ayuntamiento.nivel || 1)
  const dCasa = def('casa')
  let camas = CAMAS_AYUNTAMIENTO
  for (const c of casas) camas += dCasa.aloja(c.nivel || 1)
  return { actual, maxima: Math.min(tope, camas) }
}

/** Lo que cuesta el siguiente aldeano: 50 de comida el primero, +15 % cada uno. */
export const costeContratar = () => Math.round(COSTE_BASE * Math.pow(SUBIDA_COSTE, game.state.villagers.length))

/** Contrata un aldeano si hay cama y comida. @returns {any|null} el aldeano nuevo */
export function contratar () {
  alDia()
  const p = poblacion()
  if (!p.maxima) { avisar('Sin ayuntamiento no hay a quién llamar', 'mal'); return null }
  if (p.actual >= p.maxima) { avisar('No quedan camas: construye o mejora una casa', 'mal'); return null }
  if (!cobrar({ comida: costeContratar() })) return null
  return crearAldeano()
}

/** Pone a un aldeano a trabajar en un edificio con plazas libres. */
export function asignar (villagerId, buildingId) {
  alDia()
  const v = getVillager(villagerId)
  if (!v) return false
  if (!buildingId) return desasignar(villagerId)
  if (v.buildingId === buildingId) return true
  const b = edificio(buildingId) || getBuilding(buildingId)
  if (!b) return false
  if (librePara(buildingId) <= 0) {
    avisar(`${def(b.tipo)?.nombre || 'Ese edificio'} no tiene más puestos`, 'mal')
    return false
  }
  soltar(v)
  v.buildingId = b.id
  v.job = jobDe(b)
  if (!Array.isArray(b.trabajadores)) b.trabajadores = []
  b.trabajadores.push(v.id)
  const m = mem(v)
  m.fase = null; m.t = 0; m.atasco = 0
  v.estado = 'descansando'
  events.emit(EV.VILLAGER_ASSIGNED, { villager: v, job: v.job, buildingId: b.id })
  return true
}

/** Lo devuelve a la plaza con las manos en los bolsillos. */
export function desasignar (villagerId) {
  const v = getVillager(villagerId)
  if (!v) return false
  soltar(v)
  v.job = 'parado'
  v.buildingId = null
  v.portando = null
  v.estado = 'descansando'
  const m = mem(v)
  m.fase = null; m.t = 0
  events.emit(EV.VILLAGER_ASSIGNED, { villager: v, job: 'parado', buildingId: null })
  return true
}

/** Plazas libres de un edificio (las obras admiten martillos aunque no produzcan). */
export function librePara (buildingId) {
  alDia()
  const b = edificio(buildingId) || getBuilding(buildingId)
  if (!b) return 0
  return Math.max(0, plazasDe(b) - trabajadoresDe(buildingId).length)
}

/** @returns {any[]} los aldeanos de ese edificio (objetos, con su id dentro). */
export function trabajadoresDe (buildingId) {
  const out = []
  for (const v of game.state.villagers) if (v.buildingId === buildingId) out.push(v)
  return out
}

/** @returns {Object<string,number>} { leñador: 3, cantero: 2, parado: 1 } para la interfaz. */
export function resumenTrabajos () {
  const r = Object.create(null)   // sin prototipo: hay un oficio que se llama `constructor`
  for (const v of game.state.villagers) r[v.job] = (r[v.job] || 0) + 1
  return r
}

/**
 * El botón de "repartir solos". Manda a los parados donde más duele: primero un
 * martillo a cada obra parada, después al recurso más escaso (y si no hay comida,
 * a la granja antes que a nada, que sin pan no se pica piedra).
 */
export function asignarAutomatico () {
  alDia()
  let puestos = 0
  const parados = game.state.villagers.filter(v => v.job === 'parado')
  if (!parados.length) return 0
  for (const v of parados) {
    const b = obraNecesitada(v) || edificioMasNecesario(v)
    if (!b) break
    if (asignar(v.id, b.id)) puestos++
  }
  if (puestos) avisar(puestos === 1 ? 'Un aldeano vuelve al tajo' : `${puestos} aldeanos vuelven al tajo`, 'bien')
  else avisar('No queda ni un puesto libre: hacen falta más edificios', 'info')
  return puestos
}

// ------------------------------------------------------- reparto automático
function plazasDe (b) {
  if (b.enObra) return PLAZAS_OBRA
  const d = def(b.tipo)
  if (!d) return 0
  if (d.plazas) return d.plazas(b.nivel || 1)
  if (d.exploradores) return d.exploradores(b.nivel || 1)   // el campamento cuenta sus batidores
  return 0
}

const jobDe = (b) => (b.enObra ? 'constructor' : (JOB_POR_TIPO[b.tipo] || 'parado'))

function soltar (v) {
  const b = edificio(v.buildingId)
  if (b && Array.isArray(b.trabajadores)) {
    const i = b.trabajadores.indexOf(v.id)
    if (i >= 0) b.trabajadores.splice(i, 1)
  }
  v.buildingId = null
}

/** Una obra sin nadie encima es lo que más retrasa la aldea. */
function obraNecesitada (v) {
  let mejor = null, md = Infinity
  for (const b of obras) {
    if (trabajadoresDe(b.id).length) continue   // un martillo por obra: el resto, a producir
    const c = centroDe(b)
    const d = dist(v.x, v.z, c.x, c.z)
    if (d < md) { md = d; mejor = b }
  }
  return mejor
}

function edificioMasNecesario (v) {
  const s = game.state
  const conteo = resumenTrabajos()
  let mejor = null, mejorNota = Infinity
  for (const recurso of CONFIG.RECURSOS) {
    const tipo = TIPO_POR_RECURSO[recurso]
    const b = masCercaConHueco(tipo, v)
    if (!b) continue
    const tope = Math.max(1, s.almacen?.[recurso] || 1)
    const lleno = Math.min(1, (s.recursos?.[recurso] || 0) / tope)
    const yaPuestos = conteo[JOB_POR_TIPO[tipo]] || 0
    // cuanto más lleno el almacén y más gente ya puesta, menos falta hace
    let nota = lleno + yaPuestos * 0.12
    if (recurso === 'comida' && ((s.recursos?.comida || 0) <= 0 || hambre > 0)) nota -= 2
    if (nota < mejorNota) { mejorNota = nota; mejor = b }
  }
  if (mejor) return mejor
  for (const b of game.state.buildings) if (!b.enObra && librePara(b.id) > 0) return b   // lo que sea, pero que curre
  return null
}

function masCercaConHueco (tipo, v) {
  let mejor = null, md = Infinity
  for (const b of game.state.buildings) {
    if (b.tipo !== tipo || b.enObra) continue
    if (librePara(b.id) <= 0) continue
    const c = centroDe(b)
    const d = dist(v.x, v.z, c.x, c.z)
    if (d < md) { md = d; mejor = b }
  }
  return mejor
}

// ------------------------------------------------------------- nacimientos
function crearAldeano () {
  const s = game.state
  const r = makeRng(((s.seed || 1) + s.villagers.length * 7919) >>> 0)
  const p = puntoDeAparicion()
  const v = {
    id: nuevoId('ald'),
    nombre: nombreAldeano(r),
    job: 'parado',
    buildingId: null,
    x: p.x, z: p.z,
    destinoX: p.x, destinoZ: p.z,
    estado: 'descansando',
    portando: null,
    animo: factor === 1 ? 1 : 0.4
  }
  s.villagers.push(v)
  events.emit(EV.VILLAGER_SPAWNED, { villager: v })
  return v
}

function puntoDeAparicion () {
  const medio = (CONFIG.GRID - 1) / 2
  if (!ayuntamiento) return libreCerca(medio, medio)
  const q = puertaDe(ayuntamiento)
  return { x: q.x + azar(-0.6, 0.6), z: q.z + azar(-0.6, 0.6) }
}

/** Partida recién cargada y sin nadie: los tres fundadores, gratis y con faena. */
function sembrarPrimeros () {
  if (sembrado) return
  if (game.state.villagers.length) { sembrado = true; return }
  if (!ayuntamiento || (ayuntamiento.nivel || 0) <= 0) return
  for (let i = 0; i < 3; i++) crearAldeano()
  sembrado = true
  asignarAutomatico()
}

/** Cuando sube el tope (casa nueva o ayuntamiento mejorado), se avisa. */
function vigilarPoblacion () {
  const p = poblacion()
  if (ultimaMaxima < 0) { ultimaMaxima = p.maxima; return }
  if (p.maxima > ultimaMaxima) {
    const sitio = p.maxima - p.actual
    if (sitio > 0) avisar(`Hay sitio para ${sitio} aldeano${sitio > 1 ? 's' : ''} más`, 'bien')
  }
  ultimaMaxima = p.maxima
}

// --------------------------------------------------------------- el latido
function alTick ({ dt }) {
  alDia()
  pulso++
  momento = (momento + dt / SEG_POR_DIA) % 1
  actualizarAnimo(dt)
  sembrarPrimeros()
  if ((pulso & 7) === 0) vigilarPoblacion()

  const noche = esDeNoche()
  const lista = game.state.villagers
  for (let i = 0; i < lista.length; i++) {
    const v = lista[i]
    const m = mem(v)
    if (noche && !m.antorcha) { aDormir(v, m, dt); continue }
    if (v.estado === 'durmiendo') despertar(v, m)
    switch (v.job) {
      case 'constructor': cicloObra(v, m, dt); break
      case 'parado': deambular(v, m, dt); break
      case 'explorador': rondar(v, m, dt); break
      default: cicloRecoleccion(v, m, dt)
    }
  }
}

/**
 * Los datos de vida de un aldeano. Las manías (por qué lado rodea, si es de los
 * que se quedan con la antorcha) salen del hash de su id, no del orden de la
 * lista: así no cambian según quién le pregunte primero.
 */
function mem (v) {
  let m = memoria.get(v.id)
  if (!m) {
    const h = hash(v.id)
    m = { t: 0, fase: null, rodeo: 0, d0: 0, lado: (h & 1) ? 1 : -1, atasco: 0, perdido: 0, antorcha: (h % 6) === 0, martillo: 0 }
    memoria.set(v.id, m)
  }
  return m
}

function hash (id) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  h ^= h >>> 13; h = Math.imul(h, 0x85eb) ; h ^= h >>> 11   // mezcla: los ids se parecen mucho entre sí
  return h >>> 0
}

// ------------------------------------------------------------ movimiento
const ABANICO = [0.6, 1.1, 1.6, 2.1, 2.6]   // cuánto se gira para buscar hueco (radianes)
const MIRADA = 0.62                          // se mira un poco más allá del paso: no roza esquinas
const RODEO_MAX = 10                         // segundos bordeando antes de probar por el otro lado

/**
 * Línea recta al destino y, si hay un edificio delante, se bordea.
 * La clave es COMPROMETERSE con un lado: al topar, el aldeano elige por dónde
 * rodear (el giro libre más pequeño) y sigue la pared por ahí hasta que vuelve a
 * ver el destino de frente Y ha ganado terreno. Sin ese compromiso rebota entre
 * los dos lados y se queda bailando delante del muro. No hace falta A*.
 * @returns {boolean} true si ha llegado
 */
function mover (v, m, dt) {
  if (bloqueada(v.x, v.z)) {                    // le han levantado un muro encima: que salga
    const q = libreCerca(v.x, v.z)
    const ax = q.x - v.x, az = q.z - v.z
    const ad = Math.hypot(ax, az) || 1
    const p = Math.min(ad, VEL * dt)
    v.x = Math.round((v.x + (ax / ad) * p) * 1000) / 1000
    v.z = Math.round((v.z + (az / ad) * p) * 1000) / 1000
    events.emit(EV.VILLAGER_MOVED, { id: v.id, x: v.x, z: v.z })
    return false
  }
  const dx = v.destinoX - v.x, dz = v.destinoZ - v.z
  const d = Math.hypot(dx, dz)
  if (d < LLEGADA) {
    v.x = v.destinoX; v.z = v.destinoZ
    m.rodeo = 0; m.atasco = 0; m.perdido = 0
    events.emit(EV.VILLAGER_MOVED, { id: v.id, x: v.x, z: v.z })
    return true
  }
  const paso = Math.min(d, VEL * (v.animo < 0.6 ? 0.8 : 1) * dt)
  const ux0 = dx / d, uz0 = dz / d
  const mirada = Math.max(paso, MIRADA)
  const rectoLibre = !bloqueada(v.x + ux0 * mirada, v.z + uz0 * mirada)

  if (m.rodeo > 0) {
    m.rodeo -= dt
    if (rectoLibre && d < m.d0 - 0.3) m.rodeo = 0            // ya se ve el destino y hemos avanzado
    else if (m.rodeo <= 0) {                                  // ese lado no era: se prueba el otro
      m.lado = -m.lado; m.rodeo = RODEO_MAX; m.d0 = d; m.perdido++
    }
  } else if (!rectoLibre) {
    m.lado = ladoBueno(v, ux0, uz0, mirada, m.lado)
    m.rodeo = RODEO_MAX
    m.d0 = d
  }

  let ux = ux0, uz = uz0
  if (!rectoLibre) {
    const g = bordear(v, ux0, uz0, mirada, m.lado)
    if (!g) {                                                 // callejón sin salida
      m.atasco += dt
      if (m.atasco > 1.5) { m.lado = -m.lado; m.atasco = 0; m.perdido++ }
      if (m.perdido > 3) { m.perdido = 0; m.rodeo = 0; m.fase = null; v.estado = 'descansando'; m.t = 0.5 }
      return false
    }
    ux = g.x; uz = g.z
  }

  v.x = Math.round((v.x + ux * paso) * 1000) / 1000
  v.z = Math.round((v.z + uz * paso) * 1000) / 1000
  m.atasco = 0
  events.emit(EV.VILLAGER_MOVED, { id: v.id, x: v.x, z: v.z })
  return false
}

/** Primer giro libre hacia `lado` (o null si por ahí está todo tapiado). */
function bordear (v, ux, uz, mirada, lado) {
  for (const base of ABANICO) {
    const a = base * lado
    const c = Math.cos(a), s = Math.sin(a)
    const rx = ux * c - uz * s, rz = ux * s + uz * c
    if (!bloqueada(v.x + rx * mirada, v.z + rz * mirada)) return { x: rx, z: rz }
  }
  return null
}

/** Por dónde rodear: el lado que se libera con el giro más pequeño. */
function ladoBueno (v, ux, uz, mirada, previo) {
  const coste = (lado) => {
    for (let i = 0; i < ABANICO.length; i++) {
      const a = ABANICO[i] * lado
      const c = Math.cos(a), s = Math.sin(a)
      if (!bloqueada(v.x + (ux * c - uz * s) * mirada, v.z + (ux * s + uz * c) * mirada)) return i
    }
    return 99
  }
  const izq = coste(-1), der = coste(1)
  if (izq === der) return previo
  return izq < der ? -1 : 1
}

function irA (v, m, x, z, fase, estado = 'yendo') {
  const p = libreCerca(x, z)
  // el meneo evita que media aldea se amontone en la misma baldosa
  v.destinoX = enTablero(p.x + azar(-0.45, 0.45))
  v.destinoZ = enTablero(p.z + azar(-0.45, 0.45))
  v.estado = estado
  m.fase = fase
  m.rodeo = 0; m.atasco = 0; m.perdido = 0
}

// ---------------------------------------------------------- ciclo de faena
/**
 * Recolector: va a su edificio, curra unos segundos, sale al recurso más cercano
 * y vuelve cargado. Y vuelta a empezar. Eso es la aldea viva.
 */
function cicloRecoleccion (v, m, dt) {
  const b = edificio(v.buildingId)
  if (!b) { desasignar(v.id); return }
  if (b.enObra) { v.job = 'constructor'; m.fase = null; return }

  switch (v.estado) {
    case 'yendo':
      if (mover(v, m, dt)) {
        v.estado = 'trabajando'
        m.t = m.fase === 'recurso' ? azar(2.5, 4.5) : azar(1.5, 3)
      }
      break

    case 'trabajando': {
      m.t -= dt
      if (m.t > 0) break
      const recurso = RECURSO_POR_JOB[v.job]
      if (m.fase === 'edificio' && recurso) {
        const p = yacimientoCerca(recurso, v.x, v.z) || centroDe(b)
        irA(v, m, p.x, p.z, 'recurso')
      } else if (m.fase === 'recurso') {
        v.portando = { tipo: recurso, cant: 5 }
        const q = puertaDe(b)
        irA(v, m, q.x, q.z, 'edificio', 'volviendo')
      } else {
        m.t = azar(2, 3.5)              // sin recurso que buscar: sigue a lo suyo en el edificio
        m.fase = 'edificio'
      }
      break
    }

    case 'volviendo':
      if (mover(v, m, dt)) {
        v.portando = null               // lo descargado lo cuenta sim/resources.js
        v.estado = 'trabajando'
        m.fase = 'edificio'
        m.t = azar(1.5, 3)
      }
      break

    default: {
      const q = puertaDe(b)
      irA(v, m, q.x, q.z, 'edificio')
    }
  }
}

/** Constructor: al andamio y a martillear. Cada martillazo son chispas y polvo. */
function cicloObra (v, m, dt) {
  let b = edificio(v.buildingId)
  if (b && !b.enObra) {                 // la obra terminó: se queda de plantilla si cabe
    const job = JOB_POR_TIPO[b.tipo]
    if (job && trabajadoresDe(b.id).length <= plazasDe(b)) {
      v.job = job; m.fase = null; v.estado = 'descansando'
      events.emit(EV.VILLAGER_ASSIGNED, { villager: v, job, buildingId: b.id })
      return
    }
    desasignar(v.id); return
  }
  if (!b) {
    b = obras.length ? obras[0] : null
    if (!b) { desasignar(v.id); return }
    asignar(v.id, b.id)
    return
  }
  if (v.estado === 'trabajando' && m.fase === 'obra') {
    m.martillo -= dt
    if (m.martillo <= 0) {
      m.martillo = azar(0.5, 0.9)
      events.emit(EV.VILLAGER_CONSTRUYENDO, { id: v.id, x: v.x, z: v.z, buildingId: b.id })
    }
    return
  }
  if (v.estado === 'yendo' && m.fase === 'obra') {
    if (mover(v, m, dt)) { v.estado = 'trabajando'; m.martillo = 0 }
    return
  }
  const q = puertaDe(b)
  irA(v, m, q.x, q.z, 'obra')
}

/** Explorador: patrulla alrededor de su campamento mientras no hay expedición. */
function rondar (v, m, dt) {
  const b = edificio(v.buildingId)
  if (!b) { desasignar(v.id); return }
  if (v.estado === 'descansando') { m.t -= dt; if (m.t <= 0) m.fase = null; else return }
  if (v.estado === 'yendo' && m.fase === 'ronda') {
    if (mover(v, m, dt)) { v.estado = 'descansando'; m.t = azar(1, 3) }
    return
  }
  const c = centroDe(b)
  const a = azar(0, Math.PI * 2), r = azar(2.5, 6)
  irA(v, m, c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 'ronda')
}

// ----------------------------------------------------------- los que sobran
/**
 * Los parados no se quedan de estatuas: dan vueltas por la plaza, se paran en el
 * pozo y se juntan de dos en dos a charlar. Cuesta cuatro líneas y es lo que hace
 * que la aldea parezca habitada.
 */
function deambular (v, m, dt) {
  if (v.estado === 'descansando' || v.estado === 'trabajando') {
    m.t -= dt
    if (m.t <= 0) nuevoPaseo(v, m)
    return
  }
  if (v.estado === 'yendo' && m.fase === 'paseo') {
    if (mover(v, m, dt)) {
      v.estado = m.charla ? 'trabajando' : 'descansando'   // 'trabajando' de pie = charlando
      m.t = m.charla ? azar(4, 8) : azar(2, 5)
      m.charla = false
    }
    return
  }
  nuevoPaseo(v, m)
}

function nuevoPaseo (v, m) {
  const medio = (CONFIG.GRID - 1) / 2
  const centro = ayuntamiento ? centroDe(ayuntamiento) : { x: medio, z: medio }
  const d = Math.random()
  m.charla = false
  if (d < 0.22 && pozos.length) {                       // un trago en el pozo
    const p = centroDe(pozos[(Math.random() * pozos.length) | 0])
    irA(v, m, p.x + azar(-1, 1), p.z + azar(-1, 1), 'paseo')
    return
  }
  if (d < 0.42) {                                       // acercarse a otro parado a cotillear
    const otro = otroParado(v)
    if (otro) {
      m.charla = true
      irA(v, m, otro.x + azar(-1.2, 1.2), otro.z + azar(-1.2, 1.2), 'paseo')
      return
    }
  }
  const a = azar(0, Math.PI * 2), r = azar(2.5, 6.5)    // vuelta por la plaza
  irA(v, m, centro.x + Math.cos(a) * r, centro.z + Math.sin(a) * r, 'paseo')
}

function otroParado (v) {
  const lista = game.state.villagers
  let mejor = null, md = 9
  for (const o of lista) {
    if (o === v || o.job !== 'parado' || o.estado === 'durmiendo') continue
    const d = dist(v.x, v.z, o.x, o.z)
    if (d < md && d > 1) { md = d; mejor = o }
  }
  return mejor
}

// ------------------------------------------------------------------ noche
function aDormir (v, m, dt) {
  if (v.estado === 'durmiendo') return
  const casa = casaDe(v, m)
  if (!casa) {                                  // sin casa: se acurruca donde le pilla
    v.estado = 'durmiendo'; v.portando = null
    return
  }
  if (m.fase !== 'cama') {
    const q = puertaDe(casa)
    irA(v, m, q.x, q.z, 'cama')
    v.portando = null
  }
  if (mover(v, m, dt)) { v.estado = 'durmiendo'; m.fase = 'cama' }
}

function casaDe (v, m) {
  if (!casas.length) return null
  if (m.casa && porId.has(m.casa)) return porId.get(m.casa)
  const casa = casas[hash(v.id) % casas.length]
  m.casa = casa.id
  return casa
}

function despertar (v, m) {
  v.estado = 'descansando'
  m.fase = null; m.t = azar(0, 1.2); m.casa = null
}

// ---------------------------------------------------------------- utilería
const azar = (a, b) => a + Math.random() * (b - a)
const enTablero = (v) => Math.round(Math.min(CONFIG.GRID - 1, Math.max(0, v)) * 1000) / 1000
const avisar = (texto, tipo = 'info') => events.emit(EV.UI_TOAST, { texto, tipo })

/** Cobro directo sobre el estado: gastar es una resta y un aviso, no hace falta más. */
function cobrar (coste) {
  const r = game.state.recursos
  const falta = {}
  let pobre = false
  for (const k in coste) {
    if ((r[k] || 0) < coste[k]) { falta[k] = coste[k] - (r[k] || 0); pobre = true }
  }
  if (pobre) { events.emit(EV.RESOURCE_DENIED, { falta }); return false }
  for (const k in coste) r[k] -= coste[k]
  events.emit(EV.RESOURCES_CHANGED, { resources: r })
  return true
}
