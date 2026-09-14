import { game } from '../core/state.js'
import { events, EV } from '../core/events.js'
import { makeRng } from '../core/rng.js'
import { PALETA } from '../core/config.js'

/**
 * EL MAPA DEL MUNDO: todo lo que hay más allá de la empalizada.
 * Rejilla de 17x17 casillas con la aldea en el centro, tapada por la niebla.
 * Se genera CON SEMILLA: la misma partida enseña siempre el mismo valle, así que
 * el jugador puede recordar "al noreste había una veta de oro" y volver a por ella.
 *
 * CADA CASILLA ES UNA COMARCA, y cada comarca tiene su PLAZA: el sitio donde
 * vive su señor. Quien manda en cada una lo lleva world/imperio.js (tuyas,
 * de un señor rival o neutrales); aquí está el terreno, el nombre y lo que da.
 *
 * Este módulo solo escribe en game.state.world. Habla con el resto por eventos.
 */

export const MUNDO = { ANCHO: 17, ALTO: 17, CASA: { x: 8, y: 8 } }

/** Ficha de cada bioma: color para el mapa 3D y lo que cuesta cruzarlo. */
export const BIOMAS = {
  llanura: { nombre: 'Llanura', color: PALETA.hierba, altura: 0.15, coste: 1.0 },
  bosque: { nombre: 'Bosque', color: PALETA.copaRoble, altura: 0.25, coste: 1.15 },
  colinas: { nombre: 'Colinas', color: PALETA.hierbaOscura, altura: 0.5, coste: 1.3 },
  montaña: { nombre: 'Montaña', color: PALETA.roca, altura: 0.9, coste: 1.6 },
  pantano: { nombre: 'Pantano', color: PALETA.hierbaOscura, altura: 0.08, coste: 1.45 },
  costa: { nombre: 'Costa', color: PALETA.arena, altura: 0.06, coste: 1.1 },
  agua: { nombre: 'Aguas', color: PALETA.agua, altura: 0.0, coste: 1.9 },
  paramo: { nombre: 'Páramo', color: PALETA.tierra, altura: 0.2, coste: 1.05 }
}

/** Qué da cada clase de nodo. `base` es la cantidad a distancia cero. */
export const TIPOS_NODO = {
  bosque_viejo: { nombre: 'Bosque viejo', recurso: 'madera', base: 260, icono: '🌲' },
  cantera: { nombre: 'Cantera', recurso: 'piedra', base: 220, icono: '⛏️' },
  veta_oro: { nombre: 'Veta de oro', recurso: 'oro', base: 90, icono: '🪙' },
  campo_fertil: { nombre: 'Campo fértil', recurso: 'comida', base: 240, icono: '🌾' },
  ruinas: { nombre: 'Ruinas', recurso: 'oro', base: 120, icono: '🏛️' },
  aldea_abandonada: { nombre: 'Aldea abandonada', recurso: 'varios', base: 180, icono: '🏚️' },
  reliquia: { nombre: 'Reliquia', recurso: 'gemas', base: 6, icono: '📜' },
  pantano: { nombre: 'Ciénaga', recurso: null, base: 0, icono: '💀' }
}

/** Lo que vale cada recurso al puntuar una zona (el oro y las gemas pesan más). */
const VALOR = { madera: 1, piedra: 1.2, comida: 0.9, oro: 3, gemas: 25, varios: 1.5 }

const clave = (x, y) => `${x},${y}`
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v
const mundo = () => game.state && game.state.world ? game.state.world : null

// ---------------------------------------------------------------- arranque ---

export function init () {
  asegurarMundo()

  // al cargar otra partida (o empezar de cero) el mundo se rehace con SU semilla
  events.on(EV.STATE_LOADED, () => asegurarMundo())
  events.on(EV.TICK, alTick)

  // cuando vuelve un explorador, lo que vio deja de estar en la niebla
  events.on(EV.SCOUT_RETURNED, (p) => {
    const d = p && p.expedicion && p.expedicion.destino
    if (d && Number.isFinite(d.x) && Number.isFinite(d.y)) descubrir(d.x, d.y, p.radio ?? 1)
  })
}

/** Genera el mundo si no existe. Si ya hay tiles, es una partida guardada: se respeta. */
function asegurarMundo () {
  const s = game.state
  if (!s) return null
  if (!s.world) s.world = { descubierto: {}, nodos: [], enemigos: [] }
  const w = s.world

  if (Array.isArray(w.tiles) && w.tiles.length) {
    // relleno defensivo para partidas de versiones anteriores
    if (!w.descubierto) w.descubierto = { [clave(MUNDO.CASA.x, MUNDO.CASA.y)]: true }
    if (!Array.isArray(w.nodos)) w.nodos = []
    if (!Array.isArray(w.enemigos)) w.enemigos = []
    if (!Array.isArray(w.eventos)) w.eventos = []
    if (!w.proximoEvento) w.proximoEvento = Date.now() + 6 * 60000
    return w
  }

  const nuevo = generarMundo(s.seed)
  nuevo.enemigos = Array.isArray(w.enemigos) ? w.enemigos : []   // el hueco es de otro módulo
  s.world = nuevo
  events.emit(EV.WORLD_REVEALED, { tiles: tilesDescubiertos() })
  return s.world
}

// ------------------------------------------------------------- generación ---

/**
 * Mundo entero a partir de una semilla. Función pura: no toca el estado,
 * así se puede generar dos veces y comparar (o previsualizar una semilla).
 */
export function generarMundo (seed = 1) {
  const rng = makeRng((seed >>> 0) || 1)
  const { ANCHO, ALTO, CASA } = MUNDO

  const tiles = generarBiomas(rng, ANCHO, ALTO, CASA)
  const nodos = repartirNodos(rng, tiles, CASA)

  const w = {
    ancho: ANCHO,
    alto: ALTO,
    casa: { ...CASA },
    descubierto: {},
    tiles,
    nodos,
    enemigos: [],
    eventos: [],
    eventoSeq: 0,
    proximoEvento: Date.now() + 5 * 60000   // el primer suceso, a los pocos minutos
  }

  // el jugador nace viendo su casa y lo que alcanza la vista desde la torre
  for (const t of tiles) {
    if (Math.hypot(t.x - CASA.x, t.y - CASA.y) <= 1.5) {
      w.descubierto[clave(t.x, t.y)] = true
      for (const n of nodos) if (n.x === t.x && n.y === t.y) n.descubierto = true
    }
  }
  return w
}

/** Ruido de valor suavizado: manchas coherentes, no confeti. */
function crearRuido (rng, ancho, alto, escala) {
  const cols = Math.ceil(ancho / escala) + 3
  const filas = Math.ceil(alto / escala) + 3
  const v = new Array(cols * filas)
  for (let i = 0; i < v.length; i++) v[i] = rng.next()
  const suave = (t) => t * t * (3 - 2 * t)
  const en = (cx, cy) => v[Math.min(filas - 1, Math.max(0, cy)) * cols + Math.min(cols - 1, Math.max(0, cx))]
  return (x, y) => {
    const fx = x / escala + 1
    const fy = y / escala + 1
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = suave(fx - x0)
    const ty = suave(fy - y0)
    const a = en(x0, y0), b = en(x0 + 1, y0), c = en(x0, y0 + 1), d = en(x0 + 1, y0 + 1)
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty
  }
}

/**
 * Geografía con sentido: mar al oeste, sierra al este, bosques al norte y
 * marismas al sur. El ruido rompe las fronteras para que no parezcan rayas.
 */
function generarBiomas (rng, ancho, alto, casa) {
  const rElev = crearRuido(rng, ancho, alto, 4.5)
  const rHum = crearRuido(rng, ancho, alto, 6)
  const rDet = crearRuido(rng, ancho, alto, 2.2)
  const total = ancho * alto
  const campo = []

  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const nx = x / (ancho - 1)          // 0 = oeste, 1 = este
      const ny = y / (alto - 1)           // 0 = norte, 1 = sur
      const norte = 1 - ny
      // el mar queda al oeste y la sierra sube hacia el este
      const elev = 0.34 * rElev(x, y) + 0.10 * rDet(x, y) + 0.66 * nx
      // se moja por los dos extremos (bosque al norte, marisma al sur) y se seca hacia el este
      const hum = 0.40 * rHum(x, y) + 0.08 * rDet(x, y) + 0.34 * Math.pow(ny, 1.5) +
                  0.30 * Math.pow(norte, 1.5) - 0.18 * nx
      campo.push({ x, y, ny, elev, hum, bioma: null })
    }
  }

  // Se reparte por RANGO, no por umbrales fijos: así toda semilla tiene su mar,
  // su sierra y sus marismas, y no sale un mundo que es todo bosque.
  const porElev = [...campo].sort((a, b) => a.elev - b.elev)
  const cuota = (frac) => Math.max(1, Math.round(total * frac))
  let i = 0
  for (const n of [['agua', 0.08], ['costa', 0.08]]) {
    for (let k = 0; k < cuota(n[1]); k++, i++) porElev[i].bioma = n[0]
  }
  let j = porElev.length - 1
  for (const n of [['montaña', 0.07], ['colinas', 0.14]]) {
    for (let k = 0; k < cuota(n[1]); k++, j--) porElev[j].bioma = n[0]
  }

  const resto = campo.filter(c => !c.bioma).sort((a, b) => b.hum - a.hum)
  const mojadas = Math.round(resto.length * 0.40)
  const secas = Math.round(resto.length * 0.22)
  resto.forEach((c, k) => {
    if (k < mojadas) c.bioma = c.ny > 0.55 ? 'pantano' : 'bosque'
    else if (k >= resto.length - secas) c.bioma = 'paramo'
    else c.bioma = 'llanura'
  })

  const usados = new Set()
  const tiles = []
  for (const c of campo) {
    let bioma = c.bioma
    // el valle de casa es tierra firme y amable: los primeros minutos no se pelean
    const dCasa = Math.hypot(c.x - casa.x, c.y - casa.y)
    if (dCasa <= 1.5 && (bioma === 'agua' || bioma === 'montaña' || bioma === 'pantano')) bioma = 'llanura'
    if (dCasa <= 2.6 && bioma === 'agua') bioma = 'costa'

    const esCasa = c.x === casa.x && c.y === casa.y
    const altura = +(clamp01(BIOMAS[bioma].altura + (rDet(c.x, c.y) - 0.5) * 0.18)).toFixed(3)
    const nombre = esCasa ? 'Baluarte' : toponimo(rng, bioma, usados)
    tiles.push({ x: c.x, y: c.y, bioma, altura, nombre })
  }
  return tiles
}

// ------------------------------------------------------------- topónimos ---

/** Piezas de nombre. Se combinan en tres patrones distintos: da mucha variedad. */
const GENERICOS = {
  llanura: [['Campo', 'm'], ['Llano', 'm'], ['Ejido', 'm'], ['Prado', 'm'], ['Vega', 'f'], ['Majada', 'f']],
  bosque: [['Robledo', 'm'], ['Pinar', 'm'], ['Hayedo', 'm'], ['Encinar', 'm'], ['Soto', 'm'], ['Carrascal', 'm']],
  colinas: [['Otero', 'm'], ['Cerro', 'm'], ['Alcor', 'm'], ['Teso', 'm'], ['Loma', 'f'], ['Collado', 'm']],
  montaña: [['Peña', 'f'], ['Risco', 'm'], ['Peñón', 'm'], ['Tajo', 'm'], ['Cumbre', 'f'], ['Puerto', 'm']],
  pantano: [['Tremedal', 'm'], ['Ciénaga', 'f'], ['Marjal', 'm'], ['Lodazal', 'm'], ['Braña', 'f'], ['Charca', 'f']],
  costa: [['Cala', 'f'], ['Arenal', 'm'], ['Ribera', 'f'], ['Marisma', 'f'], ['Atalaya', 'f'], ['Duna', 'f']],
  agua: [['Vado', 'm'], ['Bajío', 'm'], ['Remanso', 'm'], ['Caño', 'm'], ['Laguna', 'f'], ['Estero', 'm']],
  paramo: [['Páramo', 'm'], ['Erial', 'm'], ['Yermo', 'm'], ['Raso', 'm'], ['Secano', 'm'], ['Calvero', 'm']]
}
const ADJETIVOS = [['Viejo', 'Vieja'], ['Negro', 'Negra'], ['Alto', 'Alta'], ['Hondo', 'Honda'],
  ['Quemado', 'Quemada'], ['Bravo', 'Brava'], ['Sombrío', 'Sombría'], ['Muerto', 'Muerta'],
  ['Blanco', 'Blanca'], ['Yerto', 'Yerta'], ['Roto', 'Rota'], ['Dorado', 'Dorada']]
const COMPLEMENTOS = ['de las Ánimas', 'del Cuervo', 'del Hierro', 'de los Lobos', 'del Rey Muerto',
  'de la Bruma', 'del Peregrino', 'de las Brujas', 'de la Sal', 'del Ahorcado', 'de los Godos',
  'de la Cruz', 'del Conde', 'de la Loba', 'de los Huesos', 'del Trueno', 'de la Nieve',
  'del Ciervo', 'de los Herreros', 'del Ermitaño']
const PREFIJOS = ['Valde', 'Villa', 'Castro', 'Monte', 'Torre', 'Fuente', 'Puente', 'Peña']
const RAICES = ['hierro', 'lobos', 'cuervo', 'sombra', 'peñas', 'oro', 'frío', 'negro',
  'viejo', 'rey', 'sal', 'nieve', 'yermo', 'roble', 'muerte', 'grajo']
const DESEMPATES = ['el Bajo', 'el Alto', 'de Arriba', 'de Abajo', 'el Menor', 'el Mayor']

function toponimo (rng, bioma, usados) {
  for (let intento = 0; intento < 12; intento++) {
    const nombre = unNombre(rng, bioma)
    if (!usados.has(nombre)) { usados.add(nombre); return nombre }
    // si choca, se distingue como se hacía de verdad: el Alto y el Bajo
    const variante = `${nombre} ${rng.pick(DESEMPATES)}`
    if (!usados.has(variante)) { usados.add(variante); return variante }
  }
  const ultimo = `${rng.pick(PREFIJOS)}${rng.pick(RAICES)} ${rng.int(2, 9)}`
  usados.add(ultimo)
  return ultimo
}

function unNombre (rng, bioma) {
  const [gen, genero] = rng.pick(GENERICOS[bioma] || GENERICOS.llanura)
  const patron = rng.next()
  if (patron < 0.38) {
    const adj = rng.pick(ADJETIVOS)
    return `${gen} ${genero === 'f' ? adj[1] : adj[0]}`
  }
  if (patron < 0.72) return `${gen} ${rng.pick(COMPLEMENTOS)}`
  return `${rng.pick(PREFIJOS)}${rng.pick(RAICES)}`
}

// ----------------------------------------------------------------- nodos ---

/** Qué nodos pegan en cada bioma (con peso: el primero sale más). */
const NODOS_POR_BIOMA = {
  llanura: ['campo_fertil', 'campo_fertil', 'aldea_abandonada', 'bosque_viejo', 'ruinas'],
  bosque: ['bosque_viejo', 'bosque_viejo', 'bosque_viejo', 'campo_fertil', 'ruinas'],
  colinas: ['cantera', 'cantera', 'veta_oro', 'bosque_viejo', 'aldea_abandonada'],
  montaña: ['cantera', 'veta_oro', 'veta_oro', 'ruinas', 'reliquia'],
  pantano: ['pantano', 'pantano', 'ruinas', 'reliquia'],
  costa: ['campo_fertil', 'aldea_abandonada', 'ruinas', 'cantera'],
  agua: [],
  paramo: ['ruinas', 'cantera', 'reliquia', 'aldea_abandonada', 'veta_oro']
}

/** Dificultad 1-5 según lo lejos que esté de casa. Lo lejano es rico y muerde. */
function dificultadPorDistancia (d) {
  if (d <= 2.2) return 1
  if (d <= 4.2) return 2
  if (d <= 6.2) return 3
  if (d <= 8.5) return 4
  return 5
}

function repartirNodos (rng, tiles, casa) {
  const nodos = []
  const ocupadas = new Set([clave(casa.x, casa.y)])

  const crear = (t, tipo) => {
    const d = Math.hypot(t.x - casa.x, t.y - casa.y)
    const dif = dificultadPorDistancia(d)
    const info = TIPOS_NODO[tipo]
    const riqueza = 1 + d * 0.38                       // lejos = más botín
    const cant = Math.max(0, Math.round(info.base * riqueza * rng.float(0.8, 1.25)))
    const n = {
      id: `n_${t.x}_${t.y}`,
      x: t.x,
      y: t.y,
      tipo,
      recurso: info.recurso,
      cantidad: cant,
      restante: cant,
      descubierto: false,
      agotado: false,
      dificultad: dif,
      nombre: info.nombre,
      ocupado: false,
      regeneraEn: 0
    }
    if (tipo === 'ruinas') n.gemas = rng.int(1, 1 + dif)
    if (tipo === 'reliquia') n.tecnologia = true
    if (tipo === 'aldea_abandonada') {
      n.botin = {
        madera: Math.round(cant * 0.5), piedra: Math.round(cant * 0.4),
        comida: Math.round(cant * 0.5), oro: Math.round(cant * 0.2)
      }
    }
    if (tipo === 'pantano') { n.cantidad = 0; n.restante = 0; n.peligro = true }
    ocupadas.add(clave(t.x, t.y))
    nodos.push(n)
    return n
  }

  // 1) el anillo de casa: cuatro nodos fáciles para los primeros minutos
  const cerca = tiles.filter(t => {
    const d = Math.hypot(t.x - casa.x, t.y - casa.y)
    return d >= 1 && d <= 2.3 && t.bioma !== 'agua'
  })
  const barajado = rng.shuffle(cerca)
  for (const tipo of ['bosque_viejo', 'campo_fertil', 'cantera', 'veta_oro']) {
    const t = barajado.find(t => !ocupadas.has(clave(t.x, t.y)))
    if (t) {
      const n = crear(t, tipo)
      n.dificultad = 1
      n.cantidad = n.restante = Math.round(n.cantidad * 0.7)   // pocos, pero a mano
    }
  }

  // 2) el resto del valle, con más densidad cuanto más lejos
  const objetivo = rng.int(30, 45)
  const candidatas = rng.shuffle(tiles.filter(t => t.bioma !== 'agua' && !ocupadas.has(clave(t.x, t.y))))
  for (const t of candidatas) {
    if (nodos.length >= objetivo) break
    const d = Math.hypot(t.x - casa.x, t.y - casa.y)
    const prob = 0.14 + Math.min(0.5, d * 0.055)
    if (!rng.chance(prob)) continue
    if (vecinoOcupado(ocupadas, t)) continue            // que no se apelmacen
    const opciones = NODOS_POR_BIOMA[t.bioma]
    if (!opciones || !opciones.length) continue
    crear(t, rng.pick(opciones))
  }

  // 3) si el azar fue tacaño, se completa hasta el mínimo
  for (const t of candidatas) {
    if (nodos.length >= 30) break
    if (ocupadas.has(clave(t.x, t.y))) continue
    const opciones = NODOS_POR_BIOMA[t.bioma]
    if (opciones && opciones.length) crear(t, rng.pick(opciones))
  }

  // una reliquia lejana siempre: el premio gordo del mapa, para dar rumbo
  if (!nodos.some(n => n.tipo === 'reliquia')) {
    const lejos = rng.shuffle(tiles.filter(t => t.bioma !== 'agua' &&
      !ocupadas.has(clave(t.x, t.y)) && Math.hypot(t.x - casa.x, t.y - casa.y) > 6))
    if (lejos[0]) crear(lejos[0], 'reliquia')
  }
  return nodos
}

function vecinoOcupado (ocupadas, t) {
  return ocupadas.has(clave(t.x + 1, t.y)) || ocupadas.has(clave(t.x - 1, t.y)) ||
         ocupadas.has(clave(t.x, t.y + 1)) || ocupadas.has(clave(t.x, t.y - 1))
}

// ------------------------------------------------------ niebla y consulta ---

export const dentroMundo = (x, y) => {
  const w = mundo()
  return !!w && x >= 0 && y >= 0 && x < w.ancho && y < w.alto
}

/** ¿Está ya fuera de la niebla? */
export function visible (x, y) {
  const w = mundo()
  return !!(w && w.descubierto && w.descubierto[clave(x, y)])
}

export function tileEn (x, y) {
  const w = mundo()
  if (!w || !w.tiles) return null
  return w.tiles[y * w.ancho + x] || w.tiles.find(t => t.x === x && t.y === y) || null
}

export function nodoEn (x, y) {
  const w = mundo()
  if (!w || !w.nodos) return null
  return w.nodos.find(n => n.x === x && n.y === y) || null
}

/**
 * La comarca de una casilla: terreno, nombre y lo que se saca de ella. Es la
 * ficha que leen el mapa del mundo y el imperio; el dueño lo pone imperio.js.
 * @returns {{x:number,y:number,nombre:string,bioma:string,altura:number,coste:number,nodo:any,visible:boolean,distancia:number}|null}
 */
export function comarcaEn (x, y) {
  const t = tileEn(x, y)
  if (!t) return null
  const b = BIOMAS[t.bioma] || BIOMAS.llanura
  return {
    x: t.x,
    y: t.y,
    nombre: t.nombre,
    bioma: t.bioma,
    altura: t.altura,
    coste: b.coste,
    nodo: nodoEn(x, y),
    visible: visible(x, y),
    distancia: distanciaACasa(x, y)
  }
}

/**
 * Las comarcas de alrededor (distancia de rey: el cuadrado, no la cruz). Es por
 * donde se extiende una mancha en el mapa, así que lo usa la conquista.
 * @returns {Array<any>} tiles vecinos dentro del valle
 */
export function comarcasVecinas (x, y, radio = 1) {
  const fuera = []
  const r = Math.max(1, Math.round(radio))
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (!dx && !dy) continue
      const t = dentroMundo(x + dx, y + dy) ? tileEn(x + dx, y + dy) : null
      if (t) fuera.push(t)
    }
  }
  return fuera
}

export function nodosDescubiertos () {
  const w = mundo()
  return w && w.nodos ? w.nodos.filter(n => n.descubierto) : []
}

export function tilesDescubiertos () {
  const w = mundo()
  if (!w || !w.tiles) return []
  return w.tiles.filter(t => w.descubierto[clave(t.x, t.y)])
}

export function eventosVivos () {
  const w = mundo()
  const ahora = Date.now()
  return w && w.eventos ? w.eventos.filter(e => e.caduca > ahora) : []
}

/**
 * Levanta la niebla alrededor de (x,y). Devuelve lo encontrado para que la
 * expedición pueda contarlo: "has visto tres casillas y una cantera".
 */
export function descubrir (x, y, radio = 1) {
  const w = mundo()
  if (!w || !w.tiles) return { tiles: [], nodos: [] }
  const nuevas = []
  const hallados = []
  const r = Math.max(0, radio)

  for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
    for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      const tx = x + dx
      const ty = y + dy
      if (!dentroMundo(tx, ty)) continue
      if (Math.hypot(dx, dy) > r + 0.25) continue
      const k = clave(tx, ty)
      if (w.descubierto[k]) continue
      w.descubierto[k] = true
      const t = tileEn(tx, ty)
      if (t) nuevas.push(t)
      const n = nodoEn(tx, ty)
      if (n && !n.descubierto) { n.descubierto = true; hallados.push(n) }
    }
  }

  if (nuevas.length) events.emit(EV.WORLD_REVEALED, { tiles: nuevas, nodos: hallados })
  return { tiles: nuevas, nodos: hallados }
}

// ------------------------------------------------------------- distancias ---

export function distanciaACasa (x, y) {
  const w = mundo()
  const casa = (w && w.casa) || MUNDO.CASA
  return Math.hypot(x - casa.x, y - casa.y)
}

/**
 * Segundos de ida hasta una casilla. Curva pensada para ratos muertos:
 * la casilla de al lado son ~30 s (se manda un explorador y se mira enseguida)
 * y el confín del mapa ronda los 25 minutos (se manda y se deja el móvil).
 * `velocidad` la suben las tecnologías o el tipo de explorador (1 = normal).
 */
export function tiempoViaje (x, y, velocidad = 1) {
  const d = distanciaACasa(x, y)
  if (d <= 0) return 0
  const t = tileEn(x, y)
  const coste = t && BIOMAS[t.bioma] ? BIOMAS[t.bioma].coste : 1
  const seg = 30 * Math.pow(d, 1.61) * coste / Math.max(0.2, velocidad)
  return Math.round(Math.min(1500, Math.max(25, seg)))   // tope duro: 25 minutos
}

// ------------------------------------------------------------ explotación ---

/** Horas que tarda un nodo agotado en volver a dar: lo rico se hace esperar. */
const HORAS_REGENERA = (n) => 3 + n.dificultad

/**
 * Una expedición saca recursos del nodo. Devuelve lo que realmente ha cogido
 * (puede ser menos de lo pedido si quedaba poco) y lo agota si lo vacía.
 */
export function recolectarNodo (id, cantidad) {
  const w = mundo()
  const n = w && w.nodos ? w.nodos.find(x => x.id === id) : null
  if (!n) return { ok: false, dado: 0, restante: 0, agotado: true, recurso: null }
  if (n.agotado || n.restante <= 0) return { ok: false, dado: 0, restante: 0, agotado: true, recurso: n.recurso }

  const dado = Math.max(0, Math.min(Math.round(cantidad) || 0, n.restante))
  n.restante -= dado
  if (n.restante <= 0) {
    n.restante = 0
    n.agotado = true
    n.regeneraEn = Date.now() + HORAS_REGENERA(n) * 3600000
  }
  return { ok: dado > 0, dado, restante: n.restante, agotado: n.agotado, recurso: n.recurso, nodo: n }
}

/** Los nodos vacíos vuelven a la vida pasadas unas horas: el mapa nunca muere. */
function regenerarNodos (ahora) {
  const w = mundo()
  if (!w || !w.nodos) return
  for (const n of w.nodos) {
    if (!n.agotado || !n.regeneraEn || n.regeneraEn > ahora) continue
    n.agotado = false
    n.regeneraEn = 0
    n.restante = Math.round(n.cantidad * 0.9)
    if (n.descubierto) {
      emitirEvento(w, {
        tipo: 'renace',
        x: n.x, y: n.y,
        texto: `${n.nombre} de ${nombreDe(n.x, n.y)} ha vuelto a dar de sí.`,
        minutos: 30,
        nodoId: n.id
      })
    }
  }
}

// ------------------------------------------------------- eventos del mundo ---

const nombreDe = (x, y) => { const t = tileEn(x, y); return t ? t.nombre : 'algún lugar' }

function alTick () {
  const w = mundo()
  if (!w || !w.tiles || !w.tiles.length) return
  const ahora = Date.now()

  regenerarNodos(ahora)

  // caduca lo vencido (los bandidos sueltan su nodo al marcharse)
  if (Array.isArray(w.eventos) && w.eventos.length) {
    const vivos = []
    for (const e of w.eventos) {
      if (e.caduca > ahora) { vivos.push(e); continue }
      if (e.tipo === 'bandidos' && e.nodoId) {
        const n = w.nodos.find(x => x.id === e.nodoId)
        if (n) { n.ocupado = false; n.dificultad = e.dificultadPrevia ?? n.dificultad }
      }
    }
    w.eventos = vivos
  }

  if (!w.proximoEvento) w.proximoEvento = ahora + 6 * 60000
  if (ahora < w.proximoEvento) return
  const rng = makeRng(((game.state.seed >>> 0) ^ ((w.eventoSeq = (w.eventoSeq || 0) + 1) * 2654435761)) >>> 0)
  w.proximoEvento = ahora + rng.int(8, 22) * 60000
  if ((w.eventos || []).length >= 4) return
  lanzarEvento(w, rng)
}

function lanzarEvento (w, rng) {
  const opciones = rng.shuffle(['caravana', 'bandidos', 'hallazgo', 'bonanza'])
  for (const tipo of opciones) {
    if (tipo === 'caravana' && caravana(w, rng)) return
    if (tipo === 'bandidos' && bandidos(w, rng)) return
    if (tipo === 'hallazgo' && hallazgo(w, rng)) return
    if (tipo === 'bonanza' && bonanza(w, rng)) return
  }
}

/** Mercaderes de paso: un trato temporal en una casilla ya explorada. */
function caravana (w, rng) {
  const vistos = tilesDescubiertos().filter(t => t.x !== w.casa.x || t.y !== w.casa.y)
  if (!vistos.length) return false
  const t = rng.pick(vistos)
  const pide = rng.pick(['madera', 'piedra', 'comida'])
  const ratio = rng.int(3, 6)
  emitirEvento(w, {
    tipo: 'caravana',
    x: t.x, y: t.y,
    texto: `Mercaderes acampan en ${t.nombre}: cambian ${ratio} de ${pide} por 1 de oro.`,
    minutos: rng.int(30, 70),
    trato: { pide, da: 'oro', ratio }
  })
  return true
}

/** Bandidos ocupan un nodo bueno: hay que echarlos o buscarse la vida en otro sitio. */
function bandidos (w, rng) {
  const libres = w.nodos.filter(n => n.descubierto && !n.agotado && !n.ocupado && n.tipo !== 'pantano')
  if (!libres.length) return false
  const n = rng.pick(libres)
  const previa = n.dificultad
  n.ocupado = true
  n.dificultad = Math.min(5, n.dificultad + 1)
  emitirEvento(w, {
    tipo: 'bandidos',
    x: n.x, y: n.y,
    texto: `Una partida de bandidos se ha hecho fuerte en ${nombreDe(n.x, n.y)}. Nadie recolecta ahí hasta echarlos.`,
    minutos: rng.int(45, 100),
    nodoId: n.id,
    dificultadPrevia: previa
  })
  return true
}

/** Un buhonero suelta la lengua y un nodo rico aparece solo en el mapa. */
function hallazgo (w, rng) {
  const ocultos = w.nodos.filter(n => !n.descubierto && n.dificultad >= 3 && n.tipo !== 'pantano')
  if (!ocultos.length) return false
  const n = rng.pick(ocultos)
  descubrir(n.x, n.y, 0)
  emitirEvento(w, {
    tipo: 'hallazgo',
    x: n.x, y: n.y,
    texto: `Un peregrino habla de ${n.nombre.toLowerCase()} en ${nombreDe(n.x, n.y)}. Ya está en tu mapa.`,
    minutos: rng.int(40, 90),
    nodoId: n.id
  })
  return true
}

/** Buena temporada: un nodo descubierto rinde más de lo normal una temporada. */
function bonanza (w, rng) {
  const buenos = w.nodos.filter(n => n.descubierto && !n.agotado && n.restante > 0 && !n.ocupado)
  if (!buenos.length) return false
  const n = rng.pick(buenos)
  const extra = Math.round(n.cantidad * 0.5)
  n.restante += extra
  emitirEvento(w, {
    tipo: 'bonanza',
    x: n.x, y: n.y,
    texto: `Buena temporada en ${nombreDe(n.x, n.y)}: ${n.nombre.toLowerCase()} rinde ${extra} de más.`,
    minutos: rng.int(45, 120),
    nodoId: n.id
  })
  return true
}

function emitirEvento (w, datos) {
  const ahora = Date.now()
  const ev = {
    id: `we_${ahora.toString(36)}_${(w.eventoSeq || 0)}`,
    tipo: datos.tipo,
    x: datos.x,
    y: datos.y,
    texto: datos.texto,
    caduca: ahora + (datos.minutos || 30) * 60000
  }
  if (datos.nodoId) ev.nodoId = datos.nodoId
  if (datos.trato) ev.trato = datos.trato
  if (datos.dificultadPrevia) ev.dificultadPrevia = datos.dificultadPrevia
  if (!Array.isArray(w.eventos)) w.eventos = []
  w.eventos.push(ev)
  events.emit(EV.WORLD_EVENT, ev)
  return ev
}

// ------------------------------------------------------------ puntuación ---

/**
 * Cuánto vale una zona (la casilla y su alrededor), para que la interfaz pueda
 * decir "aquí hay madera a mansalva" antes de mandar a nadie.
 * Solo cuenta lo que el jugador ya ha descubierto salvo que pidas lo contrario.
 */
export function riquezaZona (x, y, radio = 2, soloDescubierto = true) {
  const w = mundo()
  const res = { total: 0, nodos: 0, peligro: 0, madera: 0, piedra: 0, comida: 0, oro: 0, gemas: 0, mejor: null, texto: 'Nada a la vista' }
  if (!w || !w.nodos) return res

  let suma = 0
  for (const n of w.nodos) {
    if (Math.hypot(n.x - x, n.y - y) > radio + 0.25) continue
    if (soloDescubierto && !n.descubierto) continue
    res.nodos++
    res.peligro = Math.max(res.peligro, n.dificultad)
    if (n.agotado || !n.restante) continue
    if (n.tipo === 'aldea_abandonada' && n.botin) {
      for (const k of ['madera', 'piedra', 'comida', 'oro']) res[k] += n.botin[k] || 0
    } else if (n.recurso && res[n.recurso] !== undefined) {
      res[n.recurso] += n.restante
    }
    if (n.gemas) res.gemas += n.gemas
    suma += (n.restante || 0) * (VALOR[n.recurso] || 1) + (n.gemas || 0) * VALOR.gemas
  }

  res.total = Math.round(suma)
  const claves = ['madera', 'piedra', 'comida', 'oro', 'gemas']
  res.mejor = claves.reduce((a, b) => (res[b] * (VALOR[b] || 1)) > (res[a] * (VALOR[a] || 1)) ? b : a, 'madera')
  if (!res[res.mejor]) { res.mejor = null; res.texto = res.nodos ? 'Tierra exprimida' : 'Nada a la vista' }
  else {
    const cuanto = res[res.mejor] * (VALOR[res.mejor] || 1)
    const grado = cuanto > 700 ? 'a mansalva' : cuanto > 300 ? 'de sobra' : cuanto > 100 ? 'para un rato' : 'a puñados'
    res.texto = `${res.mejor} ${grado}`
  }
  return res
}
