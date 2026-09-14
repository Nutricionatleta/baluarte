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
 * Rendimiento: hasta 88 aldeanos a 4 ticks/s (el tope del Ayuntamiento al 14). Nada de recorrer `buildings` por
 * aldeano: todo lo que se consulta a menudo (rejilla de estorbos, puertas, casas,
 * obras, índice por id) vive en cachés que solo se rehacen cuando cambia la aldea.
 * Los temporizadores y las manías de cada uno van en `memoria`, fuera del guardado.
 */

// --------------------------------------------------------------- constantes
const VEL = UNIDADES.aldeano.velocidad          // casillas por segundo (1.6)
const COSTE_BASE = UNIDADES.aldeano.coste.comida
/**
 * COSTE DE CONTRATAR. Antes subía un 15 % por cabeza: el aldeano 30 costaba
 * 3.300 de comida y el 46 más que el granero entero, así que el tope de
 * población era decorativo y la aldea se quedaba a medias para siempre.
 * Ahora sube en línea recta y con techo: el freno del juego es el TOPE DE
 * POBLACIÓN (Ayuntamiento, camas y PUESTOS DE TRABAJO), nunca el precio.
 *   1.º 50 · 11.º 170 · 21.º 290 · del 38.º en adelante, 500 y ahí se queda.
 *
 * Se probó a subirlo (30 por cabeza, techo 700) al atar el tope a los puestos,
 * por si contratar gente de más era el sumidero de comida que marcaba el ritmo
 * de las primeras horas. NO LO ERA: el banco de pruebas da la misma partida con
 * un precio y con el otro. Ver la nota de `poblacion()` sobre lo que varía el
 * banco entre partidas idénticas. Se queda como estaba.
 */
const COSTE_POR_CABEZA = 12
const COSTE_TOPE = 500

const camasAyuntamiento = (n = 1) => 4 + Math.max(1, n)
const PLAZAS_OBRA = 3                           // martillos que caben en un andamio
const SEG_POR_DIA = 480                         // ciclo de 8 min, el mismo que usa render/fx
const MOMENTO_INICIAL = 0.36                    // arranca a media mañana, como el sol de fx
const NOCHE_DESDE = 0.80
const NOCHE_HASTA = 0.22
const HAMBRE_PARA_BAJON = 15                    // segundos con la despensa a 0
const PENALIZA_HAMBRE = 0.75                    // la comida deja de ser decorativa
const LLEGADA = 0.16                            // a esta distancia se da por llegado
/** Espejo de MINIMO_SIN_ALDEANOS en sim/resources.js: sin nadie, el edificio rinde el 25 %. */
const MINIMO_SIN_ALDEANOS = 0.25
/** Cada cuántos ticks se mira si hay edificios trabajando solos (4 ticks = 1 s). */
const REVISION_SIN_ATENDER = 240
/** Y como poco cuánto se tarda en volver a decirlo: un aviso útil, no una matraca. */
const ESPERA_AVISO_SIN_ATENDER = 4

/**
 * EL APAÑO — que un aldeano parado no exista (14-sep-2026).
 *
 * Lo que contó el dueño jugando: «los aldeanos están muy bien, pero no me
 * sirven de nada; tengo 22 y como 7 parados sin hacer nada». Tenía razón por
 * partida doble: el tope de población regalaba camas por encima de los puestos
 * que había (arreglado en data/buildings.js) y, sobre todo, el que no tenía
 * puesto fijo se dedicaba A PASEAR. Un tercio de la aldea, de adorno.
 *
 * Ahora el que no tiene plantilla se busca la vida SOLO, por este orden:
 *   1. CUADRILLA DE DESPEJE: sale al valle a talar y picar con los demás. Dos
 *      parados hacen el trabajo de un constructor (sim/despeje.js), la madera y
 *      la piedra entran en la caja de verdad, y —esto es lo gordo— NO le quitan
 *      plazas de obra a la construcción: tu gente limpia el valle mientras la
 *      cuadrilla oficial sigue levantando edificios.
 *   2. PEONADA EN LA OBRA: se arriman al andamio a dar martillazos. Se ve (son
 *      las chispas de EV.VILLAGER_CONSTRUYENDO) pero NO acorta el reloj de la
 *      obra: ese reloj es el ritmo de la partida y no se toca.
 *   3. Y si de verdad no queda nada, entonces sí, la vuelta por la plaza.
 *
 * El apaño vive en `v.apano` ({ tipo, id, x, z }: JSON puro, se guarda), no en
 * `v.job`, que sigue valiendo 'parado'. Así el jugador no pierde el mando: el
 * reparto de PUESTOS DE VERDAD se sigue haciendo a mano o con el botón de
 * "repartir", y nadie le mueve un leñador de sitio por su cuenta.
 */
const APANO_REVISION = 3        // segundos entre "a ver en qué echo una mano"
const PEONES_POR_FAENA = 2      // cuántos caben talando la misma casilla
const APANO_LLEGADA = 1.2       // a esta distancia del tajo ya se puede arrimar

const JOB_POR_TIPO = {
  serreria: 'leñador',
  cantera: 'cantero',
  granja: 'granjero',
  mina_oro: 'minero',
  campamento_explorador: 'explorador',
  // La avanzadilla cultiva lo suyo. Sin esta línea, el aldeano asignado se
  // quedaba 'parado' y el reparto automático lo reasignaba en bucle.
  puesto_avanzado: 'granjero'
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
let avisosSinAtender = 0
let ultimosVacios = 0

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
    avisosSinAtender = 0; ultimosVacios = 0
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
    // el apaño se guarda, pero una partida vieja llega sin él y hay que sanearlo:
    // si trae basura se tira y el aldeano se busca otro en el primer tick
    if (!v.apano || typeof v.apano !== 'object' || !v.apano.tipo) v.apano = null
  }
  sincronizarTrabajadores()
  // Partidas guardadas a medio asalto: nadie se queda encerrado en un solar.
  desalojarRuinas()
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
  // Orden estable: se reconstruye en el orden de `villagers`, que cambia al
  // recargar, y eso hacía que guardar y volver a cargar diera un estado
  // distinto (el banco de pruebas lo cazaba como diferencia intermitente).
  for (const b of s.buildings) if (b.trabajadores.length > 1) b.trabajadores.sort()
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
/**
 * EL CENSO. El tope sale de tres frenos y manda el más pequeño de los tres:
 *   1. el nivel del Ayuntamiento (`poblacionMax` del catálogo),
 *   2. las CAMAS que hay puestas (ayuntamiento + casas + avanzadillas),
 *   3. y —esto es lo nuevo, 14-sep-2026— los PUESTOS DE TRABAJO que existen
 *      hoy en la aldea, más el colchón de los andamios.
 *
 * Por qué el tercero: el dueño se encontró con 22 aldeanos y 7 parados, y el
 * banco de pruebas lo confirmó a lo bestia — entre el 33 % y el 68 % de la
 * aldea sin puesto en TODAS las edades. La razón es que los dos primeros frenos
 * miran el catálogo (lo que el juego DEJARÍA construir) y no la aldea que el
 * jugador tiene de verdad: en la Edad de los Castillos el catálogo permite 51
 * puestos, pero una aldea normal a esa altura tiene 28. Las camas de la
 * diferencia eran una promesa falsa: gente que se contrataba, comía y paseaba.
 *
 * Con el tercer freno, contratar SIEMPRE se nota: o entras en un puesto que
 * sube la producción ese mismo minuto, o entras en el colchón, que son los
 * martillos de los andamios y las cuadrillas del valle (ver `apañarse`). Y el
 * tope deja de ser decorativo: sube cuando levantas una serrería, una granja o
 * una cantera. Levantar sitios de trabajo es lo que te deja traer gente.
 *
 * El colchón son las `obrasSimultaneas` del Ayuntamiento más dos de relevo:
 * ayto 1 → 3 · ayto 4 → 4 · ayto 9 → 7 · ayto 14 → 8.
 *
 * ¿ESTO ACELERA LA PARTIDA? No. Se comprobó, porque bajar de 88 aldeanos a 75
 * quita comida gastada en contratar y eso podría adelantar las edades. El banco
 * de pruebas (30 días) dio Edad Imperial el día 11 con el arreglo… y el día 15
 * en una partida sin él. Parecía una aceleración de cuatro días, así que se
 * repitió la partida SIN el arreglo dos veces más: dio el día 10 y el día 11.
 * O sea que el banco varía cinco días entre partidas idénticas (manda la
 * piedra, y un nivel de cantera de más el tercer día lo cambia todo). Con el
 * arreglo: día 11 y día 10. El ritmo es el mismo; el día 15 era el raro.
 *
 * `Math.max(actual, …)` al final: si demueles media aldea el tope no puede
 * quedar por DEBAJO de la gente que ya vive ahí (nadie se evapora). Lo que hace
 * es congelar la contratación hasta que vuelva a haber sitio.
 *
 * @returns {{actual:number, maxima:number}}
 */
export function poblacion () {
  alDia()
  const actual = game.state.villagers.length
  // Basta con que TENGA nivel: mientras se mejora sigue en pie y las camas
  // siguen puestas. Antes, subir el Ayuntamiento dejaba el censo a 0 camas.
  const enPie = ayuntamiento && (ayuntamiento.nivel || 0) > 0
  if (!enPie) return { actual, maxima: 0 }
  const dAyto = def('ayuntamiento')
  const nivelAyto = ayuntamiento.nivel || 1
  const tope = dAyto.poblacionMax(nivelAyto)
  const dCasa = def('casa')
  let camas = camasAyuntamiento(nivelAyto)
  for (const c of casas) camas += dCasa.aloja(c.nivel || 1)

  // Las avanzadillas son poblados con su propia gente, así que suman camas
  // FUERA del tope del ayuntamiento: si contaran dentro, conquistar territorio
  // no serviría de nada. Traen también sus propias plazas de trabajo (menos que
  // camas), así que el colchón de gente libre se mantiene.
  const dPuesto = def('puesto_avanzado')
  let extra = 0
  if (dPuesto && typeof dPuesto.aloja === 'function') {
    for (const b of game.state.buildings) {
      if (b.tipo !== 'puesto_avanzado' || b.enObra || !(b.nivel > 0)) continue
      extra += dPuesto.aloja(b.nivel) || 0
    }
  }

  const colchon = (typeof dAyto.obrasSimultaneas === 'function' ? dAyto.obrasSimultaneas(nivelAyto) : 1) + 2
  const cabe = Math.min(tope, camas + extra, plazasDelCenso() + colchon)
  return { actual, maxima: Math.max(actual, cabe) }
}

/**
 * Puestos de trabajo para el CENSO. A diferencia de `plazasDeLaAldea()`, aquí
 * una serrería en obras o en ruinas SIGUE contando: son situaciones de un rato
 * y, si no contaran, mejorar un edificio bajaría el tope de población y el
 * jugador vería desaparecer camas cada vez que toca algo.
 */
function plazasDelCenso () {
  let n = 0
  for (const b of game.state.buildings || []) {
    const d = def(b.tipo)
    if (!d) continue
    const nivel = Math.max(1, b.nivel || 1)
    if (typeof d.plazas === 'function') n += Math.max(0, d.plazas(nivel))
    else if (typeof d.exploradores === 'function') n += Math.max(0, d.exploradores(nivel))
  }
  return n
}

/**
 * Plazas de trabajo que hay hoy en la aldea, para poder comparar de un vistazo
 * "cuánta gente cabe" con "cuánta gente hace falta". Las obras no cuentan: son
 * martillos de paso, no plantilla.
 * @returns {{plazas:number, ocupadas:number, libres:number, sinAtender:number}}
 */
export function plazasDeLaAldea () {
  alDia()
  let plazas = 0, ocupadas = 0, sinAtender = 0
  for (const b of game.state.buildings || []) {
    if (b.enObra) continue
    const n = plazasDe(b)
    if (n <= 0) continue
    const gente = cuantosEn(b)
    plazas += n
    ocupadas += Math.min(n, gente)
    if (gente === 0) sinAtender++
  }
  return { plazas, ocupadas, libres: Math.max(0, plazas - ocupadas), sinAtender }
}

/** Lo que cuesta el siguiente aldeano: recto y con techo (ver COSTE_POR_CABEZA). */
export const costeContratar = () =>
  Math.min(COSTE_TOPE, Math.round(COSTE_BASE + COSTE_POR_CABEZA * game.state.villagers.length))

/** Contrata un aldeano si hay cama y comida. @returns {any|null} el aldeano nuevo */
export function contratar () {
  alDia()
  const p = poblacion()
  if (!p.maxima) { avisar('Sin ayuntamiento no hay a quién llamar', 'mal'); return null }
  if (p.actual >= p.maxima) {
    // decir cuál de los dos frenos es el que aprieta: mandar a construir una
    // casa cuando lo que falta son PUESTOS es el consejo que más despistaba
    const pl = plazasDeLaAldea()
    avisar(pl.libres > 0
      ? 'No quedan camas: construye o mejora una casa'
      : 'No hay dónde meter a nadie más: levanta una granja, una serrería o una cantera', 'mal')
    return null
  }
  if (!cobrar({ comida: costeContratar() })) return null
  const v = crearAldeano()
  // Si hay un edificio SIN NADIE, el recién llegado va derecho: contratar para
  // dejarlo en la plaza mirando las nubes no arregla nada, y es justo el caso
  // que el jugador no ve hasta que lleva media hora produciendo al 25 %.
  const vacio = masVacioConHueco(v)
  if (vacio) asignar(v.id, vacio.id)
  return v
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
  // ORDEN ESTABLE. Al recargar, `sincronizarTrabajadores()` reconstruye esta
  // lista ordenada; si en vivo va en orden de llegada, guardar y volver a cargar
  // da un estado DISTINTO y el banco lo caza. Se ordena también aquí.
  if (b.trabajadores.length > 1) b.trabajadores.sort()
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

/**
 * Cuántos trabajan ahí. `b.trabajadores` lo mantiene al día este módulo, así que
 * contar no hace falta recorrer los aldeanos: la interfaz pregunta esto cuatro
 * veces por segundo y por edificio, y a 119 edificios eso eran 9.000 vueltas.
 */
const cuantosEn = (b) => (b && Array.isArray(b.trabajadores) ? b.trabajadores.length : 0)

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
 * LOS EDIFICIOS QUE ESTÁN TRABAJANDO SOLOS. Para que la interfaz lo enseñe en
 * vez de que el jugador lo descubra dos horas tarde: cada edificio productivo
 * con plazas libres y CUÁNTO se está perdiendo por minuto por tenerlo así.
 *
 * La pérdida es una estimación honrada del catálogo (nivel + ánimo): no lleva
 * el aura del molino, ni las tecnologías, ni el bono de edad, porque eso solo
 * lo sabe sim/resources.js y este módulo no lo importa. Va corta, nunca larga.
 *
 * @param {boolean} [soloVacios] true = solo los que no tienen a NADIE
 * @returns {Array<{id:string,tipo:string,nombre:string,icono:string,nivel:number,
 *   plazas:number,ocupadas:number,libres:number,vacio:boolean,recurso:string,
 *   perdidaPorMinuto:number,x:number,z:number}>} de más sangrante a menos
 */
export function edificiosSinAtender (soloVacios = false) {
  alDia()
  const animo = game.state.animo?.factor ?? 1
  const fuera = []
  for (const b of game.state.buildings || []) {
    if (b.enObra) continue
    const d = def(b.tipo)
    if (!d || !d.produce || typeof d.plazas !== 'function') continue
    if (b.arruinado) continue        // un edificio en ruinas no "trabaja solo": no trabaja
    const nivel = b.nivel || 1
    const plazas = Math.max(0, d.plazas(nivel))
    if (plazas <= 0) continue
    const ocupadas = Math.min(plazas, cuantosEn(b))
    const libres = plazas - ocupadas
    if (libres <= 0) continue
    if (soloVacios && ocupadas > 0) continue
    // la misma faena que aplica sim/resources.js: 25 % sin nadie, 100 % a tope
    const base = d.porMinuto(nivel) * animo
    const faena = MINIMO_SIN_ALDEANOS + (1 - MINIMO_SIN_ALDEANOS) * (ocupadas / plazas)
    const c = centroDe(b)
    fuera.push({
      id: b.id,
      tipo: b.tipo,
      nombre: d.nombre,
      icono: d.icono,
      nivel,
      plazas,
      ocupadas,
      libres,
      vacio: ocupadas === 0,
      recurso: d.produce,
      perdidaPorMinuto: Math.round(base * (1 - faena) * 10) / 10,
      x: c.x,
      z: c.z
    })
  }
  fuera.sort((a, b) => b.perdidaPorMinuto - a.perdidaPorMinuto)
  return fuera
}

/**
 * El botón de "repartir solos". Manda a los parados donde más duele, por este
 * orden: un martillo a cada obra parada, luego los edificios que están
 * trabajando SIN NADIE (que rinden al 25 %: es lo que más recursos cuesta) y,
 * cuando ya no queda ninguno vacío, al recurso más escaso (y si no hay comida,
 * a la granja antes que a nada, que sin pan no se pica piedra).
 */
export function asignarAutomatico () {
  alDia()
  let puestos = 0
  const parados = game.state.villagers.filter(v => v.job === 'parado')
  if (!parados.length) return 0
  for (const v of parados) {
    const b = obraNecesitada(v) || masVacioConHueco(v) || edificioMasNecesario(v)
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
  // En un montón de escombros no se trabaja: cero plazas hasta que se levante.
  // Sin esto el reparto automático seguía mandando gente a las ruinas.
  if (b.arruinado) return 0
  const d = def(b.tipo)
  if (!d) return 0
  if (d.plazas) return d.plazas(b.nivel || 1)
  if (d.exploradores) return d.exploradores(b.nivel || 1)   // el campamento cuenta sus batidores
  return 0
}

/**
 * DESALOJAR LAS RUINAS — el arreglo que destrabó la partida (sep-2026).
 *
 * Cuando un asalto arrasa un edificio, `sim/combat.js` le pone `arruinado` pero
 * NO vacía `trabajadores` (y el aviso EV.BUILDINGS_DAMAGED no lo escucha nadie,
 * así que `sim/buildings.js:dañar()`, que sí los soltaría, no llega a entrar).
 * Resultado medido con una aldea feudal normal: te tiran las tres granjas y
 * TRES de tus OCHO aldeanos se quedan plantados en los escombros sin producir
 * nada —y, como su oficio sigue siendo 'granjero' y no 'parado', el botón de
 * "repartir solos" pasa de ellos—. El jugador se queda sin comida, sin gente y
 * sin ninguna manera evidente de arreglarlo. Es exactamente lo que contó el
 * dueño: «al destruirme los campos de cultivo no tengo cómo avanzar».
 *
 * Aquí se les echa del solar y se les busca sitio en el acto: a la serrería que
 * está a medio gas, a la cantera, a donde haga falta. Cuando la cuadrilla
 * levante la granja volverán solos por el camino de siempre.
 */
function desalojarRuinas () {
  alDia()
  const s = game.state
  const echadas = []
  for (const v of s.villagers) {
    if (!v.buildingId) continue
    const b = edificio(v.buildingId) || getBuilding(v.buildingId)
    if (!b || !b.arruinado) continue
    desasignar(v.id)
    echadas.push(v)
  }
  const echados = echadas.length
  if (!echados) return 0
  // no se quedan mirando las nubes: se les recoloca en el sitio que más duele.
  // Solo a los recién echados: a quien el jugador dejó parado a propósito no se
  // le toca, que para eso está el botón de repartir.
  let recolocados = 0
  for (const v of echadas) {
    const destino = obraNecesitada(v) || masVacioConHueco(v) || edificioMasNecesario(v)
    if (destino && asignar(v.id, destino.id)) recolocados++
  }
  avisar(echados === 1
    ? 'Un aldeano se queda sin tajo: su edificio está en ruinas'
    : `${echados} aldeanos se quedan sin tajo: sus edificios están en ruinas`, 'mal')
  if (recolocados) {
    avisar(recolocados === echados
      ? 'Los has recolocado a todos mientras la cuadrilla levanta lo caído'
      : `${recolocados} vuelven al tajo en otro sitio; al resto no le queda puesto libre`, 'bien')
  }
  return echados
}

const jobDe = (b) => (b.enObra ? 'constructor' : (JOB_POR_TIPO[b.tipo] || 'parado'))

function soltar (v) {
  v.apano = null                      // con puesto fijo no se hacen apaños
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

/**
 * El edificio productivo que está SIN NADIE y más producción pierde por ello.
 * Un edificio vacío rinde el 25 %: llenar su primera plaza vale mucho más que
 * poner el cuarto leñador en la serrería que ya va llena.
 */
function masVacioConHueco (v) {
  let mejor = null, mejorNota = -1
  for (const f of edificiosSinAtender(true)) {
    const b = edificio(f.id) || getBuilding(f.id)
    if (!b) continue
    const c = centroDe(b)
    // a igualdad de sangría, el que pille más cerca: nadie cruza la aldea por gusto
    const nota = f.perdidaPorMinuto * 10 - dist(v.x, v.z, c.x, c.z)
    if (nota > mejorNota) { mejorNota = nota; mejor = b }
  }
  return mejor
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
    apano: null,
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

/**
 * Un edificio produciendo solo no se ve: no cambia de color, no hace ruido y se
 * lleva el 75 % de lo que debería entrar. Aquí se vigila cada minuto y se avisa
 * UNA vez por tanda (la lista fina la sirve `edificiosSinAtender()` a la
 * interfaz). Si hay gente parada, el aviso ofrece la solución en vez del susto.
 */
function vigilarSinAtender () {
  const vacios = edificiosSinAtender(true)
  if (!vacios.length) { avisosSinAtender = 0; ultimosVacios = 0; return }
  if (avisosSinAtender > 0 && vacios.length <= ultimosVacios) { avisosSinAtender--; return }
  ultimosVacios = vacios.length
  avisosSinAtender = ESPERA_AVISO_SIN_ATENDER
  const perdida = Math.round(vacios.reduce((a, f) => a + f.perdidaPorMinuto, 0) * 60)
  const parados = game.state.villagers.filter(v => v.job === 'parado').length
  const que = vacios.length === 1
    ? `${vacios[0].icono} La ${vacios[0].nombre.toLowerCase()} trabaja sin nadie`
    : `${vacios.length} edificios trabajan sin nadie`
  const cola = parados > 0
    ? ` (${parados} aldeano${parados > 1 ? 's' : ''} sin oficio: repártelos)`
    : ' (contrata aldeanos o quita gente de otro sitio)'
  avisar(`${que}: se pierden ${perdida}/h${cola}`, 'mal')
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
  // Dos veces por segundo basta para reaccionar a un asalto, y solo cuesta un
  // recorrido de la lista de aldeanos cuando de verdad hay algo en ruinas.
  if ((pulso & 1) === 0) desalojarRuinas()
  if ((pulso & 7) === 0) vigilarPoblacion()
  if (pulso % REVISION_SIN_ATENDER === 0) vigilarSinAtender()

  const noche = esDeNoche()
  const lista = game.state.villagers
  for (let i = 0; i < lista.length; i++) {
    const v = lista[i]
    const m = mem(v)
    if (noche && !m.antorcha) { aDormir(v, m, dt); continue }
    if (v.estado === 'durmiendo') despertar(v, m)
    switch (v.job) {
      case 'constructor': cicloObra(v, m, dt); break
      case 'parado': apañarse(v, m, dt); break
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
 * EL QUE NO TIENE PUESTO SE BUSCA LA VIDA. Ver el comentario de APANO_REVISION.
 * Cada pocos segundos mira si lo que estaba haciendo sigue en pie y, si no,
 * busca otro tajo. Solo pasea el que de verdad no tiene dónde arrimarse.
 */
function apañarse (v, m, dt) {
  if (v.apano && !apañoVivo(v.apano)) { v.apano = null; m.fase = null; v.estado = 'descansando' }
  if (!v.apano) {
    m.busca = (m.busca || 0) - dt
    if (m.busca <= 0) { m.busca = APANO_REVISION; buscarApaño(v, m) }
  }
  if (v.apano) { cicloApaño(v, m, dt); return }
  deambular(v, m, dt)
}

/** ¿El tajo que tenía sigue existiendo? La faena pudo terminar o la obra acabar. */
function apañoVivo (a) {
  if (a.tipo === 'talar') {
    const faenas = game.state.despeje?.faenas
    return Array.isArray(faenas) && faenas.some(f => f.id === a.id)
  }
  if (a.tipo === 'obra') {
    const b = edificio(a.id)
    return !!b && !!b.enObra
  }
  return false
}

/** Cuántos parados están ya arrimados a ese tajo (para que se repartan). */
function yaEn (tipo, id) {
  let n = 0
  for (const o of game.state.villagers) if (o.apano && o.apano.tipo === tipo && o.apano.id === id) n++
  return n
}

/**
 * Buscar tajo: primero el valle (que paga en madera y piedra), luego el andamio.
 * A igualdad, lo que pille más cerca: nadie cruza la aldea por gusto.
 */
function buscarApaño (v, m) {
  const faena = mejorFaena(v)
  if (faena) {
    v.apano = { tipo: 'talar', id: faena.id, x: faena.x, z: faena.z }
    m.fase = null; v.estado = 'descansando'
    return
  }
  const obra = obraConHueco(v)
  if (obra) {
    const q = puertaDe(obra)
    v.apano = { tipo: 'obra', id: obra.id, x: q.x, z: q.z }
    m.fase = null; v.estado = 'descansando'
  }
}

/** La casilla que está talando la cuadrilla y todavía admite otro par de manos. */
function mejorFaena (v) {
  const faenas = game.state.despeje?.faenas
  if (!Array.isArray(faenas) || !faenas.length) return null
  let mejor = null; let md = Infinity
  for (const f of faenas) {
    if (yaEn('talar', f.id) >= PEONES_POR_FAENA) continue
    const d = dist(v.x, v.z, f.x, f.z)
    if (d < md) { md = d; mejor = f }
  }
  return mejor
}

/**
 * Un andamio donde quepa otro martillo. Los peones NO acortan la obra (el reloj
 * de las obras es el ritmo de la partida): están para que se vea que la aldea
 * entera arrima el hombro, y para tener a la gente donde el jugador la busca.
 */
function obraConHueco (v) {
  let mejor = null; let md = Infinity
  for (const b of obras) {
    const gente = trabajadoresDe(b.id).length + yaEn('obra', b.id)
    if (gente >= PLAZAS_OBRA) continue
    const c = centroDe(b)
    const d = dist(v.x, v.z, c.x, c.z)
    if (d < md) { md = d; mejor = b }
  }
  return mejor
}

/** Ir al tajo y arrimarse: talar hace ruido de hacha, el andamio echa chispas. */
function cicloApaño (v, m, dt) {
  const a = v.apano
  if (v.estado === 'yendo' && m.fase === 'apaño') {
    if (mover(v, m, dt) || dist(v.x, v.z, a.x, a.z) <= APANO_LLEGADA) {
      v.estado = 'trabajando'; m.martillo = 0
    }
    return
  }
  if (v.estado === 'trabajando' && m.fase === 'apaño') {
    m.martillo -= dt
    if (m.martillo <= 0) {
      m.martillo = azar(0.5, 0.9)
      // el render ya sabe pintar esto: mismo aviso que un constructor de plantilla
      events.emit(EV.VILLAGER_CONSTRUYENDO, { id: v.id, x: v.x, z: v.z, buildingId: a.tipo === 'obra' ? a.id : null })
    }
    return
  }
  irA(v, m, a.x, a.z, 'apaño')
}

/**
 * LO QUE SE PUEDE HACER CON LA GENTE QUE SOBRA, para que el HUD lo cuente en vez
 * de enseñar un globo rojo con un número y ya. Devuelve las opciones de MÁS a
 * MENOS provecho, cada una con su número: puestos que rinden al 25 %, cuadrillas
 * en el valle, andamios… y, si de verdad no hay dónde meterlos, lo dice.
 *
 * @returns {{parados:number, apañados:number, sueltos:number, plazasLibres:number,
 *   opciones:Array<{clave:string,icono:string,texto:string,detalle:string,cuantos:number,boton:string}>}}
 */
export function faenaParaParados () {
  alDia()
  let parados = 0; let apañados = 0
  const cuenta = { talar: 0, obra: 0 }
  for (const v of game.state.villagers) {
    if (v.job !== 'parado') continue
    parados++
    if (v.apano) { apañados++; cuenta[v.apano.tipo] = (cuenta[v.apano.tipo] || 0) + 1 }
  }
  const pl = plazasDeLaAldea()
  const vacios = edificiosSinAtender(true)
  const perdida = Math.round(vacios.reduce((a, f) => a + f.perdidaPorMinuto, 0) * 60)
  const opciones = []

  if (vacios.length && parados) {
    opciones.push({
      clave: 'vacios', icono: '🏚️', cuantos: Math.min(parados, vacios.length),
      texto: vacios.length === 1
        ? `Meter a uno en ${vacios[0].icono} la ${vacios[0].nombre.toLowerCase()}`
        : `Cubrir ${vacios.length} edificios que trabajan sin nadie`,
      detalle: perdida > 0 ? `Ahora mismo se pierden ${perdida}/h por tenerlos vacíos` : 'Un edificio sin nadie rinde la cuarta parte',
      boton: 'Repartir'
    })
  }
  if (pl.libres > 0 && parados) {
    opciones.push({
      clave: 'plazas', icono: '🧑‍🌾', cuantos: Math.min(parados, pl.libres),
      texto: `Llenar ${pl.libres} ${pl.libres === 1 ? 'puesto libre' : 'puestos libres'}`,
      detalle: 'Cada puesto que cubres sube lo que entra por hora',
      boton: 'Repartir'
    })
  }
  if (cuenta.talar) {
    opciones.push({
      clave: 'talar', icono: '🪓', cuantos: cuenta.talar,
      texto: `${cuenta.talar} en la cuadrilla, talando y picando`,
      detalle: 'Madera y piedra del valle, sin quitarle plazas de obra a la construcción',
      boton: ''
    })
  }
  if (cuenta.obra) {
    opciones.push({
      clave: 'obra', icono: '🔨', cuantos: cuenta.obra,
      texto: `${cuenta.obra} arrimando el hombro en los andamios`,
      detalle: 'Echan una mano en las obras en marcha',
      boton: ''
    })
  }
  const sueltos = parados - apañados
  if (sueltos > 0 && !pl.libres && !vacios.length) {
    opciones.push({
      clave: 'sitio', icono: '🏗️', cuantos: sueltos,
      texto: `${sueltos} sin dónde meterse`,
      detalle: 'No queda ni un puesto en la aldea: levanta otra granja, serrería o cantera',
      boton: 'Construir'
    })
  }
  return { parados, apañados, sueltos, plazasLibres: pl.libres, opciones }
}

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
