import * as THREE from 'three'
import { PALETA } from '../core/config.js'
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { makeRng } from '../core/rng.js'
import { EDIFICIOS } from '../data/buildings.js'
import { MUNDO, BIOMAS, TIPOS_NODO } from '../world/map.js'
import { ctx, cuandoListo, onFrame } from './ctx.js'
import { mat, M, G, pieza, grupo } from './mats.js'

/**
 * EL MAPA DEL MUNDO en 3D: la segunda vista del juego.
 *
 * La idea de partida es un TABLERO DE MESA medieval: 17x17 losetas de madera
 * pintada con su paisaje modelado encima en miniatura, el mar alrededor, y
 * nubarrones tapando lo que aún no has pisado. Todo lo que el jugador puede
 * hacer ahí fuera (recolectar, asaltar, explorar) se lee de un vistazo.
 *
 * Se construye la PRIMERA vez que se entra en la vista del mundo, nunca en el
 * arranque: en móvil el primer minuto de carga es lo que decide si se juega.
 *
 * Este módulo solo LEE game.state. Para actuar emite EV.UI_SELECT.
 */

// ── medidas del tablero ──────────────────────────────────────────────────
/** Todo se modela a 1 unidad = 1 casilla y al final se encoge el grupo entero:
 *  así el mapa completo cabe en la pantalla de un móvil sin tocar la cámara. */
const ESCALA_MESA = 0.62
const LADO_LOSETA = 0.92          // el hueco entre losetas es lo que las hace losetas
const SUELO_MAR = 0.20            // el mar asoma por fuera de la mesa, nunca por dentro
const ALTO_MESA = 0.30            // cara de la mesa: por debajo no hay nada que ver
const ALTO_MARCADOR = 0.7        // a cuánto flota la ficha sobre la loseta
const RADIO_MAR = 46              // media anchura del mar (en unidades de casilla)
const MAX_EXPEDICIONES = 6
const PUNTOS_CAMINO = 20
const SEG_ANILLO = 128            // trozos del anillo de alcance (se usan los que hagan falta)
const CORTE_NUBE = 11             // más cerca que esto de la cámara, la nube estorba
const SEG_SINCRONIZAR = 0.7       // cada cuánto se repasa el estado (nodos, eventos, expediciones)

// ── estado del módulo ────────────────────────────────────────────────────
let construido = false
let enVista = false
let raiz = null                   // todo cuelga de aquí, dentro de ctx.raizMundo

let losetas = []                  // InstancedMesh por bioma (también el blanco del raycast)
const porTile = new Map()         // 'x,y' -> { malla, i, h, tinte:Color, visto }
const decoPorTile = new Map()     // 'x,y' -> [ recuerdo de instancia de decoración ]
const nieblaPorTile = new Map()   // 'x,y' -> [ índices de nubarrón ]
let nubarrones = null

const marcadores = new Map()      // nodoId -> grupo
const basesEnemigas = new Map()   // enemigoId -> { grupo, clave }
const señales = new Map()         // eventoId -> grupo
const expediciones = new Map()    // expedicionId -> { figura, ranura, destino, sale, vuelve }

let mar = null, marBase = null, frameMar = 0
let nubes = null, sombrasNube = null, datosNube = []
let gaviotas = null, datosGaviota = []
let anillo = null, radioAnillo = 0
let marcoSel = null, marcoHover = null
let seleccion = null
let aldea = null, estandarte = null

const animaciones = []            // tweens vivos: { t, dur, paso(k), fin() }
const pendientesRevelar = new Set()// tiles descubiertos mientras mirabas la aldea
let relojSincronizar = 0

// temporales: ni un `new` dentro del bucle de render
const _m4 = new THREE.Matrix4()
const _pos = new THREE.Vector3()
const _rot = new THREE.Quaternion()
const _eul = new THREE.Euler()
const _esc = new THREE.Vector3()
const _col = new THREE.Color()
const _ndc = new THREE.Vector2()
const _rayo = new THREE.Raycaster()

const clave = (x, y) => `${x},${y}`
const casa = () => (game.state?.world?.casa) || MUNDO.CASA
const mundo = () => game.state?.world || null
const suave = (t) => t * t * (3 - 2 * t)

// ── geometrías propias, creadas una vez ──────────────────────────────────
const _geo = new Map()
const geo = (k, crear) => { if (!_geo.has(k)) _geo.set(k, crear()); return _geo.get(k) }

/** Loseta: prisma cuadrado con la base un pelín más estrecha, como una ficha. */
const geoLoseta = () => geo('loseta', () => {
  // un cilindro de 4 lados ES un prisma cuadrado; su lado mide radio * raíz de 2
  const k = LADO_LOSETA * Math.SQRT2
  return new THREE.CylinderGeometry(0.5, 0.44, 1, 4)
    .rotateY(Math.PI / 4).scale(k, 1, k).translate(0, 0.5, 0)
})
const geoCono = (lados) => geo(`cono${lados}`, () => new THREE.ConeGeometry(0.5, 1, lados).translate(0, 0.5, 0))
const geoCil = (lados) => geo(`cil${lados}`, () => new THREE.CylinderGeometry(0.5, 0.5, 1, lados).translate(0, 0.5, 0))
const geoPiedra = () => geo('piedra', () => new THREE.IcosahedronGeometry(0.5, 0).translate(0, 0.32, 0))
const geoBorrego = () => geo('borrego', () => new THREE.IcosahedronGeometry(0.5, 1).translate(0, 0.3, 0))
const geoCaja = () => geo('caja', () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0))
const geoAro = () => geo('aro', () => new THREE.TorusGeometry(0.5, 0.045, 3, 16).rotateX(-Math.PI / 2))
const geoOla = () => geo('ola', () => new THREE.TorusGeometry(0.5, 0.1, 3, 7, Math.PI).rotateX(-Math.PI / 2))
const geoMarco = () => geo('marco', () => {
  const k = LADO_LOSETA * Math.SQRT2
  return new THREE.TorusGeometry(0.5, 0.035, 3, 4)
    .rotateX(-Math.PI / 2).rotateY(Math.PI / 4).scale(k, 1, k)
})
/** Gaviota: dos alas planas, con las dos caras cosidas para que se vean desde arriba y desde abajo. */
const geoGaviota = () => geo('gaviota', () => {
  const v = [[0, 0, 0.3], [0, 0, -0.25], [0.55, 0.18, -0.05], [-0.55, 0.18, -0.05]]
  const tri = [[0, 2, 1], [0, 1, 2], [0, 1, 3], [0, 3, 1]]
  const pos = []
  for (const t of tri) for (const i of t) pos.push(...v[i])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
})

// ── arranque ─────────────────────────────────────────────────────────────
export function init () {
  events.on(EV.VISTA_CAMBIADA, (p) => {
    enVista = (p?.vista === 'mundo')
    if (enVista) cuandoListo(entrar)
    else { if (marcoHover) marcoHover.visible = false; congelar(true) }
  })

  events.on(EV.WORLD_REVEALED, (p) => {
    if (!construido) return
    for (const t of (p?.tiles || [])) {
      const k = clave(t.x, t.y)
      // si está mirando la aldea, la niebla espera: el momento bonito no se desperdicia
      if (enVista) abrirNiebla(k, 0)
      else pendientesRevelar.add(k)
    }
    sincronizar()
  })

  events.on(EV.SCOUT_SENT, () => { if (construido) sincronizar() })
  events.on(EV.SCOUT_RETURNED, (p) => {
    if (!construido) return
    const id = p?.expedicion?.id
    const ex = id ? expediciones.get(id) : null
    if (ex) celebrarVuelta(ex)
    sincronizar()
  })
  events.on(EV.WORLD_EVENT, () => { if (construido) sincronizar() })

  // otra partida = otro valle: se tira lo construido y se rehace al volver a entrar
  events.on(EV.STATE_LOADED, () => {
    if (!construido) return
    derribar()
    // el valle nuevo lo genera world/map.js con este mismo evento: se espera un turno
    if (enVista) setTimeout(() => { construir(); sincronizar() }, 0)
  })

  cuandoListo(() => {
    conectarTacto()
    // este módulo se carga en caliente al salir de la aldea, o sea que el evento
    // que lo ha traído YA ha pasado: si el mapa está delante, se monta ahora
    if (ctx.camara?.vista === 'mundo' || ctx.raizMundo?.visible) { enVista = true; entrar() }
  })
  onFrame(porFrame)
}

/**
 * La mesa del mundo son más de mil objetos. Aunque esté invisible, Three recorre
 * su rama entera para recalcular matrices en CADA frame de la aldea. Congelarla
 * la deja a coste CERO sin tirar la memoria: volver al mapa es instantáneo, y
 * eso vale más que los pocos MB que ocupa (medido: reconstruirla cuesta ~80 ms
 * en un móvil justito, y eso se nota al pulsar el botón).
 */
function congelar (si) {
  const raizM = ctx.raizMundo
  if (!raizM || !construido) return
  raizM.matrixWorldAutoUpdate = !si
  if (!si) raizM.updateMatrixWorld(true)
}

/** Entrar en la vista del mundo: montar lo que falte y abrir la niebla pendiente. */
function entrar () {
  construir()
  if (!construido) return
  congelar(false)
  if (pendientesRevelar.size) {
    const lista = [...pendientesRevelar]
    pendientesRevelar.clear()
    // en cascada, que se vea cómo se abre el valle
    lista.forEach((k, i) => abrirNiebla(k, i * 0.05))
  }
  if (seleccion) marcar(marcoSel, seleccion)   // se vuelve con la casilla aún elegida
  sincronizar()
}

// ══ CONSTRUCCIÓN ═════════════════════════════════════════════════════════
function construir () {
  if (construido) return
  const w = mundo()
  if (!w || !Array.isArray(w.tiles) || !w.tiles.length) return   // el mundo aún no está generado
  if (!ctx.raizMundo) return

  raiz = new THREE.Group()
  raiz.name = 'mesa-mundo'
  raiz.scale.setScalar(ESCALA_MESA)
  ctx.raizMundo.add(raiz)

  const rng = makeRng(((game.state.seed >>> 0) ^ 0x9e3779b9) >>> 0)
  construirMar()
  construirTablero(w)
  construirLosetas(w)
  construirPaisaje(w, rng)
  construirNiebla(w)
  construirAldea(w)
  construirCielo(rng)
  construirMarcas()
  construirCaminos()

  construido = true
  congelar(!enVista)
  sincronizar()
}

function derribar () {
  if (ctx.raizMundo) ctx.raizMundo.matrixWorldAutoUpdate = true
  if (raiz) {
    // los carteles comparten material y textura desde `_carteles`: no se tiran
    raiz.traverse((o) => { if (o.isMesh || o.isInstancedMesh) o.geometry?.dispose?.() })
    raiz.parent?.remove(raiz)
  }
  raiz = null
  losetas = []
  porTile.clear(); decoPorTile.clear(); nieblaPorTile.clear()
  marcadores.clear(); basesEnemigas.clear(); señales.clear(); expediciones.clear()
  animaciones.length = 0
  nubarrones = mar = marBase = nubes = sombrasNube = gaviotas = anillo = null
  marcoSel = marcoHover = aldea = estandarte = null
  seleccion = null
  radioAnillo = 0
  construido = false
}

/** Altura del tacón de cada loseta. Las de agua se hunden bajo el mar. */
function alturaDe (t) {
  // el agua del valle es la loseta más baja: el relieve ya cuenta que ahí no se anda
  if (t.bioma === 'agua') return ALTO_MESA + 0.04
  const a = Number.isFinite(t.altura) ? t.altura : (BIOMAS[t.bioma]?.altura ?? 0.2)
  return ALTO_MESA + 0.06 + a * 0.78
}

const local = (v) => v - 8      // el centro del mapa (8,8) cae en el (0,0) del mundo 3D

function construirLosetas (w) {
  const grupos = new Map()
  for (const t of w.tiles) {
    if (!grupos.has(t.bioma)) grupos.set(t.bioma, [])
    grupos.get(t.bioma).push(t)
  }
  const rng = makeRng(((game.state.seed >>> 0) ^ 0x5bf03635) >>> 0)

  for (const [bioma, lista] of grupos) {
    const color = BIOMAS[bioma]?.color ?? PALETA.hierba
    const malla = new THREE.InstancedMesh(geoLoseta(), mat(color), lista.length)
    malla.castShadow = true
    malla.receiveShadow = true
    malla.userData.tiles = lista
    lista.forEach((t, i) => {
      const h = alturaDe(t)
      ponerInstancia(malla, i, local(t.x), 0, local(t.y), 1, h, 1, 0)
      // un poco de variación de tono: si todas las llanuras son idénticas, canta
      const tinte = new THREE.Color().setScalar(1).multiplyScalar(rng.float(0.9, 1.1))
      const visto = descubierto(t.x, t.y)
      malla.setColorAt(i, visto ? tinte : penumbra(tinte, _col))
      porTile.set(clave(t.x, t.y), { malla, i, h, tinte, visto, x: t.x, y: t.y, bioma: t.bioma })
    })
    malla.instanceMatrix.needsUpdate = true
    if (malla.instanceColor) malla.instanceColor.needsUpdate = true
    raiz.add(malla)
    losetas.push(malla)
  }
}

/** Color de lo que aún no has pisado: el bioma se adivina, pero apagado y frío. */
function penumbra (tinte, salida) {
  return salida.setRGB(tinte.r * 0.20, tinte.g * 0.23, tinte.b * 0.32)
}

const descubierto = (x, y) => !!(mundo()?.descubierto?.[clave(x, y)])

/**
 * El paisaje en miniatura encima de cada loseta. Todo va en InstancedMesh por
 * tipo de pieza: 17x17 casillas con tres cachivaches cada una son ~700 objetos
 * y en un móvil eso solo sale gratis instanciado.
 */
function construirPaisaje (w, rng) {
  const lotes = new Map()   // clave -> { geo, mat, items: [] }
  const añadir = (id, geometria, material, t, o) => {
    if (!lotes.has(id)) lotes.set(id, { geo: geometria, mat: material, items: [] })
    lotes.get(id).items.push({ t, ...o })
  }

  for (const t of w.tiles) {
    const h = alturaDe(t)
    const r = () => rng.float(-0.26, 0.26)
    switch (t.bioma) {
      case 'bosque': {
        const n = rng.int(2, 3)
        for (let i = 0; i < n; i++) {
          const x = r(), z = r(), s = rng.float(0.22, 0.3)
          añadir('tronco', geoCil(5), mat(PALETA.tronco), t, { x, z, y: h, sx: s * 0.28, sy: s * 0.5, sz: s * 0.28 })
          añadir('pino', geoCono(5), mat(rng.chance(0.5) ? PALETA.copaPino : PALETA.copaRoble), t,
            { x, z, y: h + s * 0.38, sx: s * 1.35, sy: s * 3.1, sz: s * 1.35, ry: rng.float(0, 3.1) })
        }
        break
      }
      case 'colinas':
        añadir('loma', geoPiedra(), mat(PALETA.hierbaOscura), t,
          { x: r() * 0.5, z: r() * 0.5, y: h - 0.02, sx: 0.55, sy: 0.3, sz: 0.5, ry: rng.float(0, 3.1) })
        añadir('mata', geoCono(4), mat(PALETA.arbusto), t, { x: r(), z: r(), y: h, sx: 0.16, sy: 0.18, sz: 0.16 })
        break
      case 'montaña': {
        const alto = rng.float(0.42, 0.62)
        añadir('pico', geoCono(4), mat(PALETA.rocaOscura), t,
          { x: r() * 0.4, z: r() * 0.4, y: h, sx: 0.62, sy: alto, sz: 0.62, ry: rng.float(0, 3.1) })
        añadir('nieve', geoCono(4), mat(PALETA.nieve), t,
          { x: r() * 0.4, z: r() * 0.4, y: h + alto * 0.62, sx: 0.62 * 0.38, sy: alto * 0.38, sz: 0.62 * 0.38 })
        break
      }
      case 'pantano': {
        for (let i = 0; i < 3; i++) {
          añadir('junco', geoCaja(), mat(PALETA.hierbaOscura), t,
            { x: r(), z: r(), y: h, sx: 0.035, sy: rng.float(0.16, 0.26), sz: 0.035, ry: rng.float(0, 3.1) })
        }
        añadir('charca', geoCil(7), mat(PALETA.aguaProfunda), t,
          { x: r() * 0.5, z: r() * 0.5, y: h - 0.01, sx: 0.4, sy: 0.03, sz: 0.34, ry: rng.float(0, 3.1) })
        break
      }
      case 'costa':
        añadir('duna', geoPiedra(), mat(PALETA.arena), t,
          { x: r(), z: r(), y: h - 0.03, sx: 0.42, sy: 0.16, sz: 0.36, ry: rng.float(0, 3.1) })
        if (rng.chance(0.35)) {
          añadir('canto', geoPiedra(), mat(PALETA.roca), t, { x: r(), z: r(), y: h, sx: 0.14, sy: 0.1, sz: 0.14 })
        }
        break
      case 'agua':
        for (let i = 0; i < 2; i++) {
          añadir('ola', geoOla(), mat(PALETA.nieve), t,
            { x: r(), z: r(), y: h + 0.1, sx: 0.3, sy: 0.3, sz: 0.3, ry: rng.float(0, 3.1) })
        }
        break
      case 'paramo':
        añadir('canto', geoPiedra(), mat(PALETA.roca), t, { x: r(), z: r(), y: h, sx: 0.2, sy: 0.14, sz: 0.2 })
        añadir('seco', geoCono(4), mat(PALETA.tierra), t, { x: r(), z: r(), y: h, sx: 0.16, sy: 0.14, sz: 0.16 })
        break
      default: {   // llanura: mata de hierba y alguna flor
        for (let i = 0; i < 2; i++) {
          añadir('mata', geoCono(4), mat(PALETA.arbusto), t,
            { x: r(), z: r(), y: h, sx: 0.15, sy: rng.float(0.12, 0.2), sz: 0.15, ry: rng.float(0, 3.1) })
        }
        if (rng.chance(0.3)) {
          const c = rng.pick([PALETA.florAmarilla, PALETA.florBlanca, PALETA.florRoja])
          añadir('flor', geoCono(4), mat(c), t, { x: r(), z: r(), y: h + 0.04, sx: 0.07, sy: 0.08, sz: 0.07 })
        }
      }
    }
  }

  for (const lote of lotes.values()) {
    const malla = new THREE.InstancedMesh(lote.geo, lote.mat, lote.items.length)
    malla.castShadow = true
    malla.receiveShadow = false
    lote.items.forEach((o, i) => {
      const rec = { malla, i, x: local(o.t.x) + o.x, y: o.y, z: local(o.t.y) + o.z, sx: o.sx, sy: o.sy, sz: o.sz, ry: o.ry || 0 }
      const k = clave(o.t.x, o.t.y)
      if (!decoPorTile.has(k)) decoPorTile.set(k, [])
      decoPorTile.get(k).push(rec)
      colocarDeco(rec, descubierto(o.t.x, o.t.y) ? 1 : 0)
    })
    malla.instanceMatrix.needsUpdate = true
    raiz.add(malla)
  }
}

function colocarDeco (rec, k) {
  ponerInstancia(rec.malla, rec.i, rec.x, rec.y, rec.z, rec.sx * k, rec.sy * k, rec.sz * k, rec.ry)
  rec.malla.instanceMatrix.needsUpdate = true
}

/** Nubarrones bajos sobre lo desconocido: tres borregos por casilla sin pisar. */
function construirNiebla (w) {
  const ocultas = w.tiles.filter(t => !descubierto(t.x, t.y))
  if (!ocultas.length) return
  const rng = makeRng(((game.state.seed >>> 0) ^ 0x2545f491) >>> 0)
  const total = ocultas.length * 3
  nubarrones = new THREE.InstancedMesh(geoBorrego(), mat(PALETA.niebla, { transparente: 0.88 }), total)
  nubarrones.castShadow = false
  nubarrones.receiveShadow = false
  nubarrones.userData.ignorarPicking = true

  let i = 0
  for (const t of ocultas) {
    const idx = []
    for (let p = 0; p < 3; p++) {
      const s = rng.float(0.5, 0.68)
      const rec = {
        i, x: local(t.x) + rng.float(-0.2, 0.2), z: local(t.y) + rng.float(-0.2, 0.2),
        y: alturaDe(t) + rng.float(0.04, 0.16), s, giro: rng.float(0, 3.1)
      }
      ponerInstancia(nubarrones, i, rec.x, rec.y, rec.z, s, s * 0.38, s, rec.giro)
      // gris de tormenta: la misma malla blanca, teñida por instancia
      nubarrones.setColorAt(i, _col.setRGB(0.78, 0.83, 0.9).multiplyScalar(rng.float(0.88, 1.05)))
      idx.push(rec)
      i++
    }
    nieblaPorTile.set(clave(t.x, t.y), idx)
  }
  nubarrones.instanceMatrix.needsUpdate = true
  if (nubarrones.instanceColor) nubarrones.instanceColor.needsUpdate = true
  raiz.add(nubarrones)
}

/** La mesa de madera sobre la que se apoyan las losetas: sin ella, por las juntas
 *  se cuela el mar y el mapa parece una cuadrícula de neón. */
function construirTablero (w) {
  const lado = Math.max(w.ancho, w.alto) + 0.6
  const cx = local((w.ancho - 1) / 2)
  const cz = local((w.alto - 1) / 2)
  const tabla = pieza(geoCaja(), mat(PALETA.tronco), { sx: lado, sy: ALTO_MESA + 0.1, sz: lado })
  tabla.position.set(cx, -0.1, cz)
  tabla.userData.ignorarPicking = true
  const canto = pieza(geoCaja(), mat(PALETA.madera), { sx: lado + 0.5, sy: ALTO_MESA - 0.02, sz: lado + 0.5 })
  canto.position.set(cx, -0.2, cz)
  canto.userData.ignorarPicking = true
  raiz.add(tabla, canto)
}

/** El mar que rodea la maqueta. Sus vértices ondulan (lo único que se toca por frame). */
function construirMar () {
  const g = new THREE.PlaneGeometry(RADIO_MAR * 2, RADIO_MAR * 2, 26, 26).rotateX(-Math.PI / 2)
  mar = new THREE.Mesh(g, mat(PALETA.aguaProfunda))
  mar.position.y = SUELO_MAR
  mar.receiveShadow = true
  mar.userData.ignorarPicking = true
  marBase = Float32Array.from(g.attributes.position.array)
  raiz.add(mar)
}

/** Nubes que cruzan con su sombra, y gaviotas planeando sobre la costa. */
function construirCielo (rng) {
  const N = 6
  nubes = new THREE.InstancedMesh(geoBorrego(), mat(PALETA.nieve), N * 5)
  sombrasNube = new THREE.InstancedMesh(geoCil(10), mat(PALETA.rocaOscura, { transparente: 0.18 }), N)
  nubes.castShadow = false
  sombrasNube.castShadow = false
  sombrasNube.receiveShadow = false
  nubes.userData.ignorarPicking = true
  sombrasNube.userData.ignorarPicking = true
  datosNube = []
  for (let n = 0; n < N; n++) {
    datosNube.push({
      x: rng.float(-14, 14), z: rng.float(-13, 13), y: rng.float(7, 10),
      vel: rng.float(0.22, 0.45), tam: rng.float(1, 1.5),
      bultos: [0, 1, 2, 3, 4].map((k) => ({ dx: (k - 2) * 0.55 + rng.float(-0.2, 0.2), dz: rng.float(-0.3, 0.3), s: rng.float(0.55, 1) }))
    })
  }
  raiz.add(nubes, sombrasNube)

  gaviotas = new THREE.InstancedMesh(geoGaviota(), mat(PALETA.yeso), 9)
  gaviotas.castShadow = false
  gaviotas.userData.ignorarPicking = true
  datosGaviota = []
  for (let i = 0; i < 9; i++) {
    datosGaviota.push({
      cx: rng.float(-11, -6), cz: rng.float(-9, 9), r: rng.float(1.2, 3.0),
      vel: rng.float(0.5, 0.95), fase: rng.float(0, 6.2), y: rng.float(1.4, 2.6), s: rng.float(0.22, 0.34)
    })
  }
  raiz.add(gaviotas)
}

/** Tu aldea en el centro: empalizada, tres casas y el estandarte que ondea. */
function construirAldea (w) {
  const c = casa()
  const t = porTile.get(clave(c.x, c.y))
  const h = t ? t.h : 0.4
  aldea = grupo([
    pieza(geoCil(8), M.camino, { y: 0, sx: 0.78, sy: 0.02, sz: 0.78 }),
    // empalizada: cuatro tramos con el hueco de la puerta al sur
    pieza(geoCaja(), M.madera, { x: 0, z: -0.36, sx: 0.72, sy: 0.14, sz: 0.05 }),
    pieza(geoCaja(), M.madera, { x: -0.36, z: 0, sx: 0.05, sy: 0.14, sz: 0.72 }),
    pieza(geoCaja(), M.madera, { x: 0.36, z: 0, sx: 0.05, sy: 0.14, sz: 0.72 }),
    pieza(geoCaja(), M.madera, { x: -0.24, z: 0.36, sx: 0.25, sy: 0.14, sz: 0.05 }),
    pieza(geoCaja(), M.madera, { x: 0.24, z: 0.36, sx: 0.25, sy: 0.14, sz: 0.05 }),
    casita(-0.2, 0.14, 0.4),
    casita(0.2, 0.16, -0.9),
    casita(0.05, -0.22, 2.2),
    // torre del homenaje
    pieza(geoCil(6), M.piedra, { x: -0.05, z: -0.05, sx: 0.2, sy: 0.34, sz: 0.2 }),
    pieza(geoCono(6), mat(PALETA.tejadoAzul), { x: -0.05, y: 0.34, z: -0.05, sx: 0.26, sy: 0.18, sz: 0.26 })
  ])
  aldea.position.set(local(c.x), h, local(c.y))
  aldea.scale.setScalar(1.25)
  // aro dorado: en un mapa lleno de rivales, "aquí vives tú" no se discute
  const aro = pieza(geoAro(), mat(PALETA.oro, { emisivo: 0x443300 }), { y: 0.02, sx: 1.7, sy: 1, sz: 1.7 })
  aro.castShadow = false
  aldea.add(aro)

  // el estandarte se mueve solo: es lo que identifica "aquí vives tú"
  estandarte = grupo([
    pieza(geoCaja(), M.maderaClara, { sx: 0.022, sy: 0.34, sz: 0.022 }),
    pieza(geoCaja(), mat(PALETA.estandarte), { x: 0.1, y: 0.26, sx: 0.18, sy: 0.12, sz: 0.014 })
  ])
  estandarte.position.set(-0.05, 0.52, -0.05)
  aldea.add(estandarte)
  raiz.add(aldea)
}

function casita (x, z, ry) {
  return grupo([
    pieza(geoCaja(), M.yeso, { x, z, ry, sx: 0.2, sy: 0.13, sz: 0.17 }),
    pieza(geoCono(4), M.tejado, { x, y: 0.13, z, ry: ry + Math.PI / 4, sx: 0.3, sy: 0.13, sz: 0.27 })
  ])
}

/** Marco de selección, marco bajo el dedo y anillo de alcance. */
function construirMarcas () {
  marcoSel = new THREE.Mesh(geoMarco(), mat(PALETA.oro, { emisivo: 0x332200 }))
  marcoHover = new THREE.Mesh(geoMarco(), mat(PALETA.yeso, { transparente: 0.7 }))
  marcoSel.visible = marcoHover.visible = false
  marcoSel.castShadow = marcoHover.castShadow = false
  marcoSel.userData.ignorarPicking = marcoHover.userData.ignorarPicking = true
  marcoHover.scale.setScalar(0.94)
  raiz.add(marcoSel, marcoHover)

  // el alcance se dibuja a trocitos apoyados en el relieve: así se ve por dónde
  // pasa aunque cruce una sierra, en vez de flotar cortando montañas
  anillo = new THREE.InstancedMesh(geoCaja(), mat(PALETA.estandarte), SEG_ANILLO)
  anillo.castShadow = false
  anillo.userData.ignorarPicking = true
  raiz.add(anillo)
}

/** Caminos punteados de las expediciones (un solo lote para todas). */
function construirCaminos () {
  const malla = new THREE.InstancedMesh(geoCil(6), mat(PALETA.yeso, { transparente: 0.85 }),
    MAX_EXPEDICIONES * PUNTOS_CAMINO)
  malla.castShadow = false
  malla.userData.ignorarPicking = true
  for (let i = 0; i < malla.count; i++) ponerInstancia(malla, i, 0, -99, 0, 0, 0, 0, 0)
  malla.instanceMatrix.needsUpdate = true
  raiz.add(malla)
  raiz.userData.caminos = malla
}

// ══ NIEBLA ═══════════════════════════════════════════════════════════════
/**
 * Levantar la niebla es LA recompensa de explorar, así que se nota: los
 * nubarrones se hinchan, suben y se deshacen, la loseta recupera su color y
 * el paisaje brota de golpe.
 */
function abrirNiebla (k, retraso = 0, instantaneo = false) {
  const tile = porTile.get(k)
  if (!tile || tile.visto) return
  tile.visto = true
  const puffs = nieblaPorTile.get(k)
  const decos = decoPorTile.get(k) || []

  if (instantaneo) {
    tile.malla.setColorAt(tile.i, tile.tinte)
    if (tile.malla.instanceColor) tile.malla.instanceColor.needsUpdate = true
    if (puffs) for (const p of puffs) ponerInstancia(nubarrones, p.i, p.x, -99, p.z, 0, 0, 0, 0)
    if (nubarrones) nubarrones.instanceMatrix.needsUpdate = true
    for (const d of decos) colocarDeco(d, 1)
    return
  }

  animaciones.push({
    t: -retraso,
    dur: 0.95,
    paso (k2) {
      const s = suave(k2)
      penumbra(tile.tinte, _col).lerp(tile.tinte, s)
      tile.malla.setColorAt(tile.i, _col)
      if (tile.malla.instanceColor) tile.malla.instanceColor.needsUpdate = true

      if (puffs) {
        for (const p of puffs) {
          const g = p.s * (1 + s * 0.9) * (1 - s)          // se hincha y se deshace
          ponerInstancia(nubarrones, p.i, p.x, p.y + s * 0.9, p.z, g, g * 0.45, g, p.giro + s * 2)
        }
        nubarrones.instanceMatrix.needsUpdate = true
      }
      // el paisaje brota un poco después, con rebote
      const b = Math.max(0, (k2 - 0.35) / 0.65)
      const salto = b <= 0 ? 0 : Math.min(1.12, 1 - Math.pow(1 - b, 3) * (1 - Math.sin(b * 9) * 0.12))
      for (const d of decos) colocarDeco(d, salto)
    },
    fin () {
      for (const d of decos) colocarDeco(d, 1)
      if (puffs) {
        for (const p of puffs) ponerInstancia(nubarrones, p.i, p.x, -99, p.z, 0, 0, 0, 0)
        nubarrones.instanceMatrix.needsUpdate = true
      }
    }
  })
}

// ══ MARCADORES ═══════════════════════════════════════════════════════════
const COLOR_RECURSO = {
  madera: PALETA.madera, piedra: PALETA.piedra, comida: PALETA.trigo,
  oro: PALETA.oro, gemas: PALETA.estandarte, varios: PALETA.maderaClara
}

/** Ficha flotante: un disco del color del recurso (se lee desde lejos) con el icono encima. */
function fichaNodo (n) {
  const info = TIPOS_NODO[n.tipo] || {}
  const color = COLOR_RECURSO[info.recurso] || PALETA.rocaOscura
  const g = new THREE.Group()
  g.add(pieza(geoCil(12), mat(color), { sx: 0.62, sy: 0.08, sz: 0.62 }))
  g.add(pieza(geoCil(12), mat(PALETA.tronco), { y: -0.05, sx: 0.72, sy: 0.06, sz: 0.72 }))
  const icono = iconoNodo(n.tipo)
  icono.position.y = 0.08
  icono.scale.setScalar(1.35)
  g.add(icono)
  g.userData.icono = icono
  return g
}

function iconoNodo (tipo) {
  const g = new THREE.Group()
  const R = Math.PI / 2
  switch (tipo) {
    case 'bosque_viejo':   // pila de troncos
      g.add(pieza(G.cilindro6, M.madera, { z: -0.08, y: 0.07, rz: R, sx: 0.13, sy: 0.3, sz: 0.13 }))
      g.add(pieza(G.cilindro6, M.madera, { z: 0.08, y: 0.07, rz: R, sx: 0.13, sy: 0.3, sz: 0.13 }))
      g.add(pieza(G.cilindro6, M.maderaClara, { y: 0.19, rz: R, sx: 0.13, sy: 0.3, sz: 0.13 }))
      break
    case 'cantera':        // sillares escuadrados
      g.add(pieza(geoCaja(), M.piedra, { x: -0.09, sx: 0.16, sy: 0.14, sz: 0.16 }))
      g.add(pieza(geoCaja(), M.piedraOscura, { x: 0.09, sx: 0.16, sy: 0.12, sz: 0.16 }))
      g.add(pieza(geoCaja(), M.piedra, { y: 0.14, ry: 0.5, sx: 0.15, sy: 0.13, sz: 0.15 }))
      break
    case 'veta_oro':       // pepita
      g.add(pieza(geoPiedra(), M.oro, { y: 0.02, sx: 0.3, sy: 0.24, sz: 0.3 }))
      g.add(pieza(geoPiedra(), M.oro, { x: 0.12, y: 0.01, sx: 0.15, sy: 0.13, sz: 0.15 }))
      break
    case 'campo_fertil':   // tres espigas
      for (const dx of [-0.1, 0, 0.1]) {
        g.add(pieza(geoCaja(), mat(PALETA.hierbaOscura), { x: dx, sx: 0.02, sy: 0.22, sz: 0.02 }))
        g.add(pieza(geoCono(5), M.trigo, { x: dx, y: 0.18, sx: 0.11, sy: 0.17, sz: 0.11 }))
      }
      break
    case 'ruinas':         // dos columnas y un dintel caído
      g.add(pieza(geoCil(6), M.piedra, { x: -0.12, sx: 0.09, sy: 0.28, sz: 0.09 }))
      g.add(pieza(geoCil(6), M.piedra, { x: 0.12, sx: 0.09, sy: 0.2, sz: 0.09 }))
      g.add(pieza(geoCaja(), M.piedraOscura, { x: -0.02, y: 0.28, rz: 0.18, sx: 0.34, sy: 0.05, sz: 0.12 }))
      break
    case 'aldea_abandonada':
      g.add(pieza(geoCaja(), M.yeso, { sx: 0.24, sy: 0.16, sz: 0.2 }))
      g.add(pieza(geoCono(4), mat(PALETA.tejadoOscuro), { y: 0.16, rz: 0.22, ry: Math.PI / 4, sx: 0.34, sy: 0.16, sz: 0.3 }))
      break
    case 'reliquia':       // pergamino lacrado
      g.add(pieza(G.cilindro, M.yeso, { y: 0.14, rz: R, sx: 0.16, sy: 0.34, sz: 0.16 }))
      g.add(pieza(G.cilindro, M.oro, { x: -0.17, y: 0.14, rz: R, sx: 0.19, sy: 0.04, sz: 0.19 }))
      g.add(pieza(G.cilindro, M.oro, { x: 0.17, y: 0.14, rz: R, sx: 0.19, sy: 0.04, sz: 0.19 }))
      break
    default:               // ciénaga y demás: calavera, o sea "no vengas"
      g.add(pieza(geoPiedra(), mat(PALETA.nieve), { y: 0.06, sx: 0.26, sy: 0.24, sz: 0.24 }))
      g.add(pieza(geoCaja(), mat(PALETA.nieve), { y: 0.02, z: 0.06, sx: 0.14, sy: 0.06, sz: 0.1 }))
      g.add(pieza(geoCaja(), mat(PALETA.rocaOscura), { x: -0.05, y: 0.11, z: 0.1, sx: 0.05, sy: 0.05, sz: 0.03 }))
      g.add(pieza(geoCaja(), mat(PALETA.rocaOscura), { x: 0.05, y: 0.11, z: 0.1, sx: 0.05, sy: 0.05, sz: 0.03 }))
  }
  return g
}

/** Un nodo exprimido no debe tentar: se apaga entero y se hunde un poco. */
function apagar (obj, apagado) {
  obj.traverse((o) => {
    if (!o.isMesh) return
    if (!o.userData.matBase) o.userData.matBase = o.material
    o.material = apagado ? mat(PALETA.rocaOscura) : o.userData.matBase
  })
}

/** Castillito rival: torre, torretas y un cartel con nivel y calaveras. */
function baseEnemiga (e) {
  const g = new THREE.Group()
  const muro = mat(PALETA.enemigo)
  const teja = mat(PALETA.tejadoOscuro)
  // recinto cuadrado con almenas y torreón: de un vistazo es un castillo,
  // no un montón de conos rojos
  g.add(pieza(geoCaja(), M.piedraOscura, { sx: 0.6, sy: 0.05, sz: 0.6 }))
  g.add(pieza(geoCaja(), muro, { y: 0.05, sx: 0.46, sy: 0.16, sz: 0.46 }))
  for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
    g.add(pieza(geoCaja(), muro, { x, z, y: 0.21, sx: 0.09, sy: 0.07, sz: 0.09 }))
  }
  g.add(pieza(geoCaja(), muro, { x: -0.08, z: -0.08, y: 0.21, sx: 0.24, sy: 0.3, sz: 0.24 }))
  g.add(pieza(geoCono(4), teja, { x: -0.08, z: -0.08, y: 0.51, ry: Math.PI / 4, sx: 0.42, sy: 0.22, sz: 0.42 }))
  g.add(pieza(geoCaja(), M.maderaClara, { x: -0.08, z: -0.08, y: 0.73, sx: 0.02, sy: 0.16, sz: 0.02 }))
  g.add(pieza(geoCaja(), mat(PALETA.tela), { x: -0.01, z: -0.08, y: 0.82, sx: 0.14, sy: 0.09, sz: 0.012 }))
  return g
}

/** Señal de un suceso del mundo. Cada tipo con su forma, para leerlo sin texto. */
function señalEvento (tipo) {
  const g = new THREE.Group()
  if (tipo === 'caravana') {
    g.add(pieza(geoCaja(), M.madera, { y: 0.06, sx: 0.3, sy: 0.1, sz: 0.18 }))
    g.add(pieza(G.cilindro, M.yeso, { y: 0.16, rz: Math.PI / 2, sx: 0.2, sy: 0.28, sz: 0.2 }))
    g.add(pieza(G.cilindro6, M.tronco, { x: -0.13, y: 0.05, rz: Math.PI / 2, sx: 0.11, sy: 0.04, sz: 0.11 }))
    g.add(pieza(G.cilindro6, M.tronco, { x: 0.13, y: 0.05, rz: Math.PI / 2, sx: 0.11, sy: 0.04, sz: 0.11 }))
    g.add(pieza(geoPiedra(), M.oro, { y: 0.4, sx: 0.14, sy: 0.14, sz: 0.14 }))
  } else if (tipo === 'bandidos') {
    g.add(pieza(geoCaja(), M.maderaClara, { sx: 0.025, sy: 0.4, sz: 0.025 }))
    g.add(pieza(geoCaja(), mat(PALETA.enemigo), { x: 0.1, y: 0.34, sx: 0.18, sy: 0.13, sz: 0.014 }))
    g.add(pieza(geoCaja(), M.hierro, { y: 0.2, rz: 0.7, sx: 0.03, sy: 0.3, sz: 0.02 }))
    g.add(pieza(geoCaja(), M.hierro, { y: 0.2, rz: -0.7, sx: 0.03, sy: 0.3, sz: 0.02 }))
  } else if (tipo === 'bonanza') {
    for (const dx of [-0.1, 0.02, 0.12]) {
      g.add(pieza(geoCono(5), mat(PALETA.hierbaClara), { x: dx, sx: 0.14, sy: 0.26, sz: 0.14 }))
    }
    g.add(pieza(geoPiedra(), M.trigo, { y: 0.32, sx: 0.14, sy: 0.14, sz: 0.14 }))
  } else {   // hallazgo y cualquier otro: una admiración dorada
    g.add(pieza(geoCaja(), M.oro, { y: 0.14, sx: 0.07, sy: 0.26, sz: 0.07 }))
    g.add(pieza(geoCaja(), M.oro, { y: 0.03, sx: 0.07, sy: 0.07, sz: 0.07 }))
  }
  return g
}

/** Explorador: capa, capucha y un banderín para verlo cruzar el valle. */
function figuraExplorador () {
  return grupo([
    pieza(geoCono(6), mat(PALETA.ropaAldeano), { sx: 0.3, sy: 0.3, sz: 0.3 }),
    pieza(geoPiedra(), mat(PALETA.pielClara), { y: 0.29, sx: 0.17, sy: 0.17, sz: 0.17 }),
    pieza(geoCono(6), mat(PALETA.ropaAldeana), { y: 0.3, sx: 0.24, sy: 0.18, sz: 0.24 }),
    pieza(geoCaja(), M.maderaClara, { x: 0.13, sx: 0.02, sy: 0.52, sz: 0.02 }),
    pieza(geoCaja(), mat(PALETA.estandarte), { x: 0.2, y: 0.44, sx: 0.12, sy: 0.08, sz: 0.012 })
  ])
}

// ── carteles de texto (la única textura del juego, dibujada por código) ──
const _carteles = new Map()
/**
 * Un número de nivel en 3D con cubitos no se lee en un móvil; un cartel que
 * siempre mira a cámara, sí. Se dibuja en un canvas: cero archivos de arte.
 */
function cartel (texto) {
  if (!_carteles.has(texto)) _carteles.set(texto, materialCartel(texto))
  const s = new THREE.Sprite(_carteles.get(texto))
  s.userData.ignorarPicking = true
  return s
}

function materialCartel (texto) {
  const lienzo = document.createElement('canvas')
  lienzo.width = 256; lienzo.height = 88
  const c = lienzo.getContext('2d')
  c.font = 'bold 46px system-ui, sans-serif'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  const ancho = Math.min(248, c.measureText(texto).width + 34)
  c.fillStyle = 'rgba(26,35,64,0.86)'
  c.beginPath()
  if (c.roundRect) c.roundRect((256 - ancho) / 2, 10, ancho, 68, 18)
  else c.rect((256 - ancho) / 2, 10, ancho, 68)
  c.fill()
  c.strokeStyle = '#ffc107'; c.lineWidth = 4; c.stroke()
  c.fillStyle = '#f5eede'
  c.fillText(texto, 128, 45)
  const textura = new THREE.CanvasTexture(lienzo)
  textura.colorSpace = THREE.SRGBColorSpace
  // única excepción a "los materiales solo salen de mats.js": un sprite no puede
  // ser Lambert, y un número legible en un móvil vale más que la regla
  return new THREE.SpriteMaterial({ map: textura, transparent: true, depthWrite: false })
}

// ══ SINCRONIZACIÓN CON EL ESTADO ═════════════════════════════════════════
/**
 * Repasa nodos, enemigos, sucesos y expediciones y pone al día lo que se ve.
 * Se llama por eventos y, por si acaso, cada SEG_SINCRONIZAR mientras miras el
 * mapa: así también entran los cambios que nadie anuncia (un nodo que se agota).
 */
function sincronizar () {
  if (!construido) return
  const w = mundo()
  if (!w) return

  // --- nodos de recursos ---
  const vivos = new Set()
  for (const n of (w.nodos || [])) {
    if (!n.descubierto) continue
    vivos.add(n.id)
    let g = marcadores.get(n.id)
    if (!g) {
      g = fichaNodo(n)
      const t = porTile.get(clave(n.x, n.y))
      g.position.set(local(n.x), (t ? t.h : 0.4) + ALTO_MARCADOR, local(n.y))
      g.userData.base = g.position.y
      g.userData.fase = (n.x * 7 + n.y * 13) % 6
      raiz.add(g)
      marcadores.set(n.id, g)
      brotar(g)
    }
    const apagado = !!(n.agotado || n.restante <= 0)
    if (g.userData.apagado !== apagado) {
      g.userData.apagado = apagado
      apagar(g, apagado)
      g.position.y = g.userData.base - (apagado ? 0.18 : 0)
    }
  }
  for (const [id, g] of marcadores) {
    if (vivos.has(id)) continue
    raiz.remove(g); marcadores.delete(id)
  }

  // --- bases enemigas ---
  const enemigosVivos = new Set()
  for (const e of (w.enemigos || [])) {
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) continue
    if (!(e.descubierto ?? descubierto(e.x, e.y))) continue
    enemigosVivos.add(e.id)
    let reg = basesEnemigas.get(e.id)
    if (!reg) {
      const g = baseEnemiga(e)
      const t = porTile.get(clave(e.x, e.y))
      g.position.set(local(e.x), t ? t.h : 0.4, local(e.y))
      raiz.add(g)
      reg = { grupo: g, cartel: null }
      basesEnemigas.set(e.id, reg)
      brotar(g)
    }
    const nivel = Math.max(1, Math.round(e.nivel || 1))
    // e.amenaza es la etiqueta de texto del rival; las calaveras salen del nivel
    const calaveras = Math.max(1, Math.min(4, Math.ceil(nivel / 3.5)))
    const caido = !!e.derrotado
    const texto = caido ? 'En ruinas' : `Nv.${nivel} ${'💀'.repeat(calaveras)}`
    if (reg.texto !== texto) {
      reg.texto = texto
      if (reg.cartel) reg.grupo.remove(reg.cartel)
      reg.cartel = cartel(texto)
      reg.cartel.scale.set(0.72, 0.25, 1)
      reg.cartel.position.y = 1.12
      reg.grupo.add(reg.cartel)
    }
    if (reg.caido !== caido) {
      reg.caido = caido
      apagar(reg.grupo, caido)          // derrotada = piedra gris y desplomada
      reg.grupo.scale.set(1, caido ? 0.45 : 1, 1)
      reg.grupo.rotation.z = caido ? 0.12 : 0
    }
  }
  for (const [id, reg] of basesEnemigas) {
    if (enemigosVivos.has(id)) continue
    raiz.remove(reg.grupo); basesEnemigas.delete(id)
  }

  // --- sucesos del mundo ---
  const ahora = Date.now()
  const evVivos = new Set()
  for (const ev of (w.eventos || [])) {
    if (ev.caduca <= ahora) continue
    evVivos.add(ev.id)
    if (señales.has(ev.id)) continue
    const g = new THREE.Group()
    const s = señalEvento(ev.tipo)
    g.add(s)
    const aro = pieza(geoAro(), mat(PALETA.oro), { y: -0.5, sx: 0.8, sy: 0.7, sz: 0.8 })
    aro.castShadow = false
    g.add(aro)
    g.userData.aro = aro
    const t = porTile.get(clave(ev.x, ev.y))
    g.position.set(local(ev.x), (t ? t.h : 0.4) + 0.5, local(ev.y))
    g.userData.base = g.position.y
    raiz.add(g)
    señales.set(ev.id, g)
    brotar(g)
  }
  for (const [id, g] of señales) {
    if (evVivos.has(id)) continue
    raiz.remove(g); señales.delete(id)
  }

  sincronizarExpediciones()
  sincronizarAlcance()
}

/** Aparecer con rebote: nada surge de la nada de golpe, todo brota. */
function brotar (obj) {
  obj.scale.setScalar(0.01)
  animaciones.push({
    t: 0,
    dur: 0.5,
    paso: (k) => obj.scale.setScalar(k < 1 ? (1 - Math.pow(1 - k, 3)) * (1 + Math.sin(k * 7) * 0.12) : 1),
    fin: () => obj.scale.setScalar(1)
  })
}

function sincronizarExpediciones () {
  const lista = (game.state.expediciones || [])
    .filter(e => e && e.estado === 'fuera')       // las 'vuelta'/'herido' ya están en casa
    .slice(0, MAX_EXPEDICIONES)
  const vivas = new Set()
  const libres = new Set([...Array(MAX_EXPEDICIONES).keys()])
  for (const e of expediciones.values()) libres.delete(e.ranura)

  for (const ex of lista) {
    const d = ex.destino
    if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.y)) continue
    vivas.add(ex.id)
    if (expediciones.has(ex.id)) continue
    const ranura = libres.values().next().value
    if (ranura === undefined) continue
    libres.delete(ranura)
    const figura = figuraExplorador()
    raiz.add(figura)
    const reg = { figura, ranura, x: d.x, y: d.y, sale: ex.sale, vuelve: ex.vuelve }
    expediciones.set(ex.id, reg)
    pintarCamino(reg)
    brotar(figura)
  }
  for (const [id, reg] of expediciones) {
    if (vivas.has(id)) continue
    raiz.remove(reg.figura)
    borrarCamino(reg.ranura)
    expediciones.delete(id)
  }
}

/** Rastro punteado de la aldea al destino, apoyado en el relieve de cada loseta. */
function pintarCamino (reg) {
  const malla = raiz.userData.caminos
  if (!malla) return
  const c = casa()
  const base = reg.ranura * PUNTOS_CAMINO
  for (let i = 0; i < PUNTOS_CAMINO; i++) {
    const k = (i + 0.5) / PUNTOS_CAMINO
    const x = c.x + (reg.x - c.x) * k
    const y = c.y + (reg.y - c.y) * k
    const t = porTile.get(clave(Math.round(x), Math.round(y)))
    const s = 0.055 + Math.sin(k * Math.PI) * 0.02
    ponerInstancia(malla, base + i, local(x), (t ? t.h : 0.4) + 0.03, local(y), s, 0.03, s, 0)
  }
  malla.instanceMatrix.needsUpdate = true
}

function borrarCamino (ranura) {
  const malla = raiz.userData.caminos
  if (!malla) return
  const base = ranura * PUNTOS_CAMINO
  for (let i = 0; i < PUNTOS_CAMINO; i++) ponerInstancia(malla, base + i, 0, -99, 0, 0, 0, 0, 0)
  malla.instanceMatrix.needsUpdate = true
}

/** El explorador entra en la aldea dando un saltito: se ha ganado la vuelta. */
function celebrarVuelta (reg) {
  const c = casa()
  const t = porTile.get(clave(c.x, c.y))
  const h = (t ? t.h : 0.4)
  animaciones.push({
    t: 0,
    dur: 0.6,
    paso: (k) => { reg.figura.position.set(local(c.x), h + Math.sin(k * Math.PI) * 0.35, local(c.y)); reg.figura.scale.setScalar(1 - k * 0.8) },
    fin: () => { reg.figura.visible = false }
  })
}

/** Hasta dónde llegan hoy tus exploradores. Si ya alcanzas todo, sobra el anillo. */
function sincronizarAlcance () {
  if (!anillo) return
  const s = game.state
  // misma cuenta que world/expeditions.js: si no cuadran, el anillo miente
  const camp = (s.buildings || []).find(b => b && b.tipo === 'campamento_explorador' &&
    !b.enObra && !b.arruinado && b.nivel > 0)
  const def = EDIFICIOS.campamento_explorador
  const base = camp ? (typeof def?.alcance === 'function' ? def.alcance(camp.nivel || 1) : 6 + 3 * camp.nivel) : 0
  const r = camp ? Math.round(base * (1 + (s.research?.mapas_pergamino ? 0.2 : 0))) : 0
  if (Math.abs(r - radioAnillo) < 0.01) return
  radioAnillo = r

  const c = casa()
  const n = Math.min(SEG_ANILLO, Math.max(24, Math.round(2 * Math.PI * r / 0.34)))
  const visible = r > 0 && r < 12
  for (let i = 0; i < SEG_ANILLO; i++) {
    if (!visible || i >= n || i % 2 === 1) { ponerInstancia(anillo, i, 0, -99, 0, 0, 0, 0, 0); continue }
    const a = (i / n) * Math.PI * 2
    const x = c.x + Math.cos(a) * r
    const y = c.y + Math.sin(a) * r
    const t = porTile.get(clave(Math.round(x), Math.round(y)))
    // dentro del valle se apoya en el relieve; fuera, flota sobre el agua (si no,
    // con un campamento crecido el anillo se esconde bajo la mesa y no dice nada)
    const alto = t ? t.h + 0.04 : SUELO_MAR + 0.14
    ponerInstancia(anillo, i, local(x), alto, local(y), 0.22, 0.05, 0.06, -a)
  }
  anillo.instanceMatrix.needsUpdate = true
}

// ══ ANIMACIÓN POR FRAME ══════════════════════════════════════════════════
function porFrame (dt, t) {
  if (!construido || !ctx.raizMundo?.visible) return

  // los tweens corren siempre (aunque no estés mirando no llegan aquí, y al
  // volver se lanzan de nuevo desde pendientesRevelar)
  for (let i = animaciones.length - 1; i >= 0; i--) {
    const a = animaciones[i]
    a.t += dt
    if (a.t < 0) continue
    const k = Math.min(1, a.t / a.dur)
    a.paso(k)
    if (k >= 1) { a.fin?.(); animaciones.splice(i, 1) }
  }

  relojSincronizar += dt
  if (relojSincronizar > SEG_SINCRONIZAR) { relojSincronizar = 0; sincronizar() }

  animarMar(t)
  animarCielo(dt, t)
  animarMarcadores(t)
  animarExpediciones(t)

  if (estandarte) estandarte.rotation.y = Math.sin(t * 1.7) * 0.22
  if (marcoSel?.visible) marcoSel.scale.setScalar(1 + Math.sin(t * 4) * 0.035)
}

/** Oleaje suave. Se actualiza en frames alternos: en móvil se nota y no se ve. */
function animarMar (t) {
  if (!mar || !marBase) return
  if ((frameMar = (frameMar + 1) % 2) !== 0) return
  const pos = mar.geometry.attributes.position
  const arr = pos.array
  for (let i = 0; i < arr.length; i += 3) {
    const x = marBase[i], z = marBase[i + 2]
    arr[i + 1] = Math.sin(x * 0.42 + t * 1.1) * 0.04 + Math.cos(z * 0.33 - t * 0.85) * 0.04
  }
  pos.needsUpdate = true
}

function animarCielo (dt, t) {
  if (nubes) {
    for (let n = 0; n < datosNube.length; n++) {
      const d = datosNube[n]
      d.x += d.vel * dt
      if (d.x > 17) d.x = -17
      // una nube que pasa pegada a la cámara tapa media pantalla: se desvanece
      const cerca = distanciaACamara(d.x, d.y, d.z) < CORTE_NUBE
      for (let p = 0; p < 5; p++) {
        const b = d.bultos[p]
        const s = cerca ? 0 : d.tam * b.s
        ponerInstancia(nubes, n * 5 + p, d.x + b.dx * d.tam, d.y, d.z + b.dz * d.tam, s, s * 0.42, s * 0.7, 0)
      }
      // la sombra cae un poco desplazada, como si el sol viniera de un lado
      ponerInstancia(sombrasNube, n, d.x - 1.6, SUELO_MAR + 0.02, d.z + 0.9, d.tam * 3.4, 0.02, d.tam * 1.9, 0)
    }
    nubes.instanceMatrix.needsUpdate = true
    sombrasNube.instanceMatrix.needsUpdate = true
  }
  if (gaviotas) {
    for (let i = 0; i < datosGaviota.length; i++) {
      const g = datosGaviota[i]
      const a = t * g.vel + g.fase
      const aleteo = 1 + Math.sin(t * 7 + g.fase) * 0.25
      ponerInstancia(gaviotas, i,
        g.cx + Math.cos(a) * g.r, g.y + Math.sin(a * 2) * 0.12, g.cz + Math.sin(a) * g.r,
        g.s, g.s * aleteo, g.s, -a + Math.PI / 2)
    }
    gaviotas.instanceMatrix.needsUpdate = true
  }
}

/** Distancia de un punto del tablero (en casillas) a la cámara, en unidades de mundo. */
function distanciaACamara (x, y, z) {
  if (!ctx.camera) return 99
  _pos.set(x, y, z).multiplyScalar(ESCALA_MESA)
  return _pos.distanceTo(ctx.camera.position)
}

function animarMarcadores (t) {
  for (const g of marcadores.values()) {
    if (g.userData.apagado) continue
    g.position.y = g.userData.base + Math.sin(t * 1.6 + g.userData.fase) * 0.05
    g.rotation.y = Math.sin(t * 0.5 + g.userData.fase) * 0.3
  }
  for (const g of señales.values()) {
    g.position.y = g.userData.base + Math.sin(t * 2.4) * 0.07
    g.rotation.y += 0.004
    const aro = g.userData.aro
    if (aro) { const k = 1 + Math.sin(t * 2.4) * 0.18; aro.scale.set(k, 1, k) }
  }
}

/**
 * Cada explorador avanza según lo que le queda de viaje: sale de la aldea,
 * se planta un rato en el destino y vuelve. Así el mapa cuenta a qué juegas.
 */
function animarExpediciones (t) {
  const c = casa()
  const ahora = Date.now()
  for (const reg of expediciones.values()) {
    if (!reg.figura.visible) continue
    const vuelve = reg.vuelve || (ahora + 60000)
    const sale = reg.sale || (vuelve - 120000)
    const total = Math.max(1000, vuelve - sale)
    const k = Math.min(1, Math.max(0, (ahora - sale) / total))

    let px, py, avanzando = true
    if (k < 0.45) { const u = k / 0.45; px = c.x + (reg.x - c.x) * u; py = c.y + (reg.y - c.y) * u }
    else if (k < 0.55) { px = reg.x; py = reg.y; avanzando = false }
    else { const u = (k - 0.55) / 0.45; px = reg.x + (c.x - reg.x) * u; py = reg.y + (c.y - reg.y) * u }

    const tile = porTile.get(clave(Math.round(px), Math.round(py)))
    const h = (tile ? tile.h : 0.4) + (avanzando ? Math.abs(Math.sin(t * 6)) * 0.04 : 0)
    reg.figura.position.set(local(px), h, local(py))
    const dx = (k < 0.5 ? reg.x - c.x : c.x - reg.x)
    const dy = (k < 0.5 ? reg.y - c.y : c.y - reg.y)
    reg.figura.rotation.y = Math.atan2(dx, dy)
  }
}

// ══ INTERACCIÓN ══════════════════════════════════════════════════════════
const punteros = new Set()
let tap = null
let ultimoHover = 0

function conectarTacto () {
  const lienzo = ctx.renderer?.domElement
  if (!lienzo) return
  lienzo.addEventListener('pointerdown', (e) => {
    punteros.add(e.pointerId)
    tap = punteros.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null
  })
  window.addEventListener('pointermove', (e) => {
    if (!enVista || !construido) return
    if (tap && e.pointerId === tap.id && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 12) tap = null
    if (punteros.size > 1) return
    const ahora = performance.now()
    if (ahora - ultimoHover < 60) return       // el raycast por cada pixel movido no lo aguanta un móvil
    ultimoHover = ahora
    marcar(marcoHover, tileEnPantalla(e.clientX, e.clientY))
  })
  const soltar = (e) => {
    punteros.delete(e.pointerId)
    if (!tap || e.pointerId !== tap.id) { tap = null; return }
    const limpio = performance.now() - tap.t < 300 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 12
    tap = null
    if (!limpio || !enVista || !construido) return
    const t = tileEnPantalla(e.clientX, e.clientY)
    seleccion = t
    marcar(marcoSel, t)
    if (t) events.emit(EV.UI_SELECT, { kind: 'worldtile', x: t.x, y: t.y })
  }
  window.addEventListener('pointerup', soltar)
  window.addEventListener('pointercancel', (e) => { punteros.delete(e.pointerId); tap = null })
}

/** Qué casilla del mundo hay bajo un punto de la pantalla. */
function tileEnPantalla (px, py) {
  if (!losetas.length || !ctx.camera) return null
  const r = ctx.renderer.domElement.getBoundingClientRect()
  _ndc.set(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1)
  _rayo.setFromCamera(_ndc, ctx.camera)
  const choques = _rayo.intersectObjects(losetas, false)
  if (!choques.length) return null
  const c = choques[0]
  const t = c.object.userData.tiles?.[c.instanceId]
  return t ? { x: t.x, y: t.y } : null
}

function marcar (marco, t) {
  if (!marco) return
  if (!t) { marco.visible = false; return }
  const reg = porTile.get(clave(t.x, t.y))
  if (!reg) { marco.visible = false; return }
  marco.visible = true
  marco.position.set(local(t.x), reg.h + 0.03, local(t.y))
}

// ══ utilidades ═══════════════════════════════════════════════════════════
function ponerInstancia (malla, i, x, y, z, sx, sy, sz, ry) {
  _eul.set(0, ry || 0, 0)
  _rot.setFromEuler(_eul)
  _pos.set(x, y, z)
  _esc.set(sx, sy, sz)
  _m4.compose(_pos, _rot, _esc)
  malla.setMatrixAt(i, _m4)
}
