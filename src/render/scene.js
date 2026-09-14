import * as THREE from 'three'
import { CONFIG, PALETA } from '../core/config.js'
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { mundoAGrid, gridAMundo, huecoLibre } from '../core/grid.js'
import { ctx, marcarListo, pasarFrame } from './ctx.js'

/**
 * Cimiento visual del juego: escena, cámara isométrica, luces, controles
 * táctiles y bucle de render. Todo lo demás de render/ se cuelga de aquí.
 *
 * Los controles están escritos a mano a propósito: los de librería están
 * pensados para ratón y con el dedo se sienten pesados y con retardo.
 */

// ── ajustes de cámara y gestos ───────────────────────────────────────────
const FOV = 28                       // FOV bajo => perspectiva aplanada, aire de maqueta
const ELEV_MIN = THREE.MathUtils.degToRad(25)
const ELEV_MAX = THREE.MathUtils.degToRad(65)
const MEDIO_TABLERO = (CONFIG.GRID * CONFIG.CELDA) / 2   // 17 casillas desde el centro
const MS_TAP = 600                   // toque limpio: dedo quieto, aunque se demore al levantarlo
const PX_TAP = 12                    // margen de temblor del dedo, en píxeles
const PX_ARRASTRE = 10               // zona muerta: por debajo de esto el dedo NO mueve la cámara
const MS_MANTENER = 380              // mantener pulsado sobre un edificio => levantarlo para moverlo
const FRENO_INERCIA = 3.2            // cuanto mayor, antes para el deslizamiento
const VEL_MAX_INERCIA = 34           // tope del deslizamiento, en unidades de mundo por segundo
const MS_INERCIA = 120               // si el dedo se paró antes de soltar, no hay deslizamiento
const SUAVE_CAMARA = 9               // velocidad de las transiciones (focus, cambio de vista)
const BORDE_VEL = 520                // px/s que arrastra la cámara cuando el fantasma toca el borde
const ITER_SUELO = 3                 // pasadas del rayo para ajustarse al relieve del terreno

// ── estado interno del módulo ────────────────────────────────────────────
let contenedor, lienzo
let reloj = 0, rafId = 0, pausado = false
let modoConstruccion = false
let vistaActual = 'aldea'

/** Relieve del terreno. Lo rellena terrain.js si está; si no, todo a ras de suelo. */
let alturaEn = () => 0
/** sim/buildings.mover(), cargado con import() tolerante: el render no manda sobre el estado. */
let moverEdificio = null
/** Lo que se está colocando (lo dice EV.BUILD_MODE): hace falta para el fantasma y la vibración. */
const modo = { tipo: null, ancho: 2, alto: 2, rot: 0 }
/** Traslado en curso con el dedo: { id, tipo, ancho, alto, rot, x, z, valido }. */
let moviendo = null
/** Última posición del dedo que manda, para el arrastre de borde. */
let dedo = null

/** Órbita de la cámara alrededor de un punto del suelo. */
const cam = {
  objetivo: new THREE.Vector3(0, 0, 0),
  distancia: CONFIG.ZOOM_INICIAL,
  azimut: Math.PI * 0.25,            // giro horizontal
  elevacion: CONFIG.ANGULO_CAMARA    // isométrica suave del CONFIG
}
/** Destino de una transición suave (focus / cambio de vista). null = nada en marcha. */
let destino = null
/** Inercia del desplazamiento con el dedo, en unidades de mundo por segundo. */
const inercia = new THREE.Vector2(0, 0)
/** Velocidad medida del último tramo del arrastre (unidades/s). De aquí sale la inercia. */
const velPan = new THREE.Vector2(0, 0)
/** Poses guardadas de cada vista, para volver donde lo dejaste. */
const poses = { aldea: null, mundo: null }

// ── gestos ───────────────────────────────────────────────────────────────
const punteros = new Map()           // pointerId -> { x, y, x0, y0, t0, movido }
let gesto = 'nada'                   // 'nada'|'pan'|'fantasma'|'orbita'|'pinza'
let baseDist = 0, baseAngulo = 0, baseMedio = { x: 0, y: 0 }
let temporizadorMantener = 0, yaMantenido = false
let ultimaCasilla = ''               // evita inundar de eventos al arrastrar el fantasma

const rayo = new THREE.Raycaster()
const nds = new THREE.Vector2()
// plano horizontal reutilizado: se le cambia la altura para seguir el relieve
const planoSuelo = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const puntoSuelo = new THREE.Vector3()

export async function init () {
  contenedor = document.getElementById('escena')
  if (!contenedor) throw new Error('[scene] falta el contenedor #escena')

  const flojo = movilFlojo()

  // --- renderer ---
  const renderer = new THREE.WebGLRenderer({
    antialias: !flojo,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(contenedor.clientWidth, contenedor.clientHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setClearColor(PALETA.cielo, 1)
  lienzo = renderer.domElement
  lienzo.style.display = 'block'
  lienzo.style.touchAction = 'none'   // sin esto el navegador del móvil hace scroll y zoom de página
  contenedor.appendChild(lienzo)

  // --- escena ---
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(PALETA.cielo)
  // niebla suave: difumina el borde del tablero para que no se vea cortado
  // Sin niebla de distancia: emblanquecía el valle y tapaba la aldea al
  // alejarse. El borde del tablero ya lo cierran el acantilado y el mar, así
  // que no hace falta difuminar nada.
  scene.fog = null

  // --- cámara ---
  const camera = new THREE.PerspectiveCamera(FOV, aspecto(), 1, 400)

  // --- luces ---
  const sol = new THREE.DirectionalLight(PALETA.sol, 2.7)
  sol.position.set(28, 44, 18)
  sol.castShadow = true
  sol.target.position.set(0, 0, 0)
  scene.add(sol, sol.target)
  ajustarSombra(sol, flojo ? 1024 : 2048)

  const ambiente = new THREE.AmbientLight(0xfff0d8, 0.62)          // cálida, rellena lo oscuro
  const hemisferio = new THREE.HemisphereLight(PALETA.cielo, PALETA.hierbaOscura, 0.82)
  scene.add(ambiente, hemisferio)

  // --- raíces ---
  const raizAldea = new THREE.Group(); raizAldea.name = 'aldea'
  const raizMundo = new THREE.Group(); raizMundo.name = 'mundo'; raizMundo.visible = false
  scene.add(raizAldea, raizMundo)

  Object.assign(ctx, { scene, camera, renderer, sol, raizAldea, raizMundo })
  ctx.camara = api                                     // atajos para la interfaz (botones de girar/zoom)
  // enganche de consola y de pruebas. Va aparte de window.baluarte porque main.js
  // reescribe ese objeto entero DESPUÉS de arrancar la escena.
  window.baluarteCamara = api
  colocarCamara()

  aplicarCalidad(calidadPreferida() || (flojo ? 'bajo' : 'medio'))
  await cargarAyudas()
  conectarGestos()
  conectarEventos()
  window.addEventListener('resize', alRedimensionar)
  window.addEventListener('orientationchange', () => setTimeout(alRedimensionar, 250))
  document.addEventListener('visibilitychange', alCambiarVisibilidad)

  reloj = performance.now()
  rafId = requestAnimationFrame(bucle)
  marcarListo()
}

// ── ayudas de arranque ───────────────────────────────────────────────────
/**
 * Dos cosas de fuera que este módulo necesita pero NO puede importar en duro
 * (los módulos se hablan por el bus): el relieve del terreno para apuntar bien
 * y la API de simulación para mover un edificio. Con import() tolerante: si un
 * día no están, los gestos siguen funcionando en plano y sin traslados.
 */
async function cargarAyudas () {
  try {
    const terreno = await import('./terrain.js')
    if (typeof terreno.alturaEn === 'function') alturaEn = terreno.alturaEn
  } catch { /* sin terreno: el suelo es y=0 */ }
  try {
    const sim = await import('../sim/buildings.js')
    if (typeof sim.mover === 'function') moverEdificio = sim.mover
  } catch { /* sin simulación: no se podrá arrastrar un edificio ya construido */ }
}

const aspecto = () => Math.max(0.2, contenedor.clientWidth / Math.max(1, contenedor.clientHeight))

/** Olfateo barato de móvil justito: con esto decidimos el arranque, luego mandan los FPS. */
function movilFlojo () {
  const nucleos = navigator.hardwareConcurrency || 4
  const memoria = navigator.deviceMemory || 4
  const tactil = navigator.maxTouchPoints > 0
  return tactil && (nucleos <= 4 || memoria <= 3)
}

/** Cámara de sombras AJUSTADA al tablero: si abarca de más, la sombra sale pixelada. */
function ajustarSombra (sol, lado) {
  const r = MEDIO_TABLERO + 3
  const c = sol.shadow.camera
  c.left = -r; c.right = r; c.top = r; c.bottom = -r
  c.near = 1; c.far = 160
  c.updateProjectionMatrix()
  sol.shadow.mapSize.set(lado, lado)
  sol.shadow.bias = -0.0009
  sol.shadow.normalBias = 0.03
  sol.shadow.map?.dispose()
  sol.shadow.map = null
}

// ── cámara ───────────────────────────────────────────────────────────────
function colocarCamara () {
  const camera = ctx.camera
  if (!camera) return
  cam.elevacion = THREE.MathUtils.clamp(cam.elevacion, ELEV_MIN, ELEV_MAX)
  cam.distancia = THREE.MathUtils.clamp(cam.distancia, CONFIG.ZOOM_MIN, CONFIG.ZOOM_MAX)
  limitarObjetivo()
  const ce = Math.cos(cam.elevacion), se = Math.sin(cam.elevacion)
  camera.position.set(
    cam.objetivo.x + cam.distancia * ce * Math.sin(cam.azimut),
    cam.objetivo.y + cam.distancia * se,
    cam.objetivo.z + cam.distancia * ce * Math.cos(cam.azimut)
  )
  camera.lookAt(cam.objetivo)
  // La niebla se retira al alejarse (el dueño pidió que no tapara la aldea en
  // vista general). Lo lleva `ajustarNieblaDistancia()` de render/worldmap.js,
  // que además deja un velo en la vista del mundo: aquí solo se fija la
  // densidad de partida, arriba en la creación de la escena.
}

/** La cámara no puede irse a mirar el vacío: el objetivo vive dentro del tablero. */
function limitarObjetivo () {
  const r = MEDIO_TABLERO * (vistaActual === 'mundo' ? 2.2 : 1)
  cam.objetivo.x = THREE.MathUtils.clamp(cam.objetivo.x, -r, r)
  cam.objetivo.z = THREE.MathUtils.clamp(cam.objetivo.z, -r, r)
  cam.objetivo.y = 0
}

/** Vectores del suelo alineados con lo que ve el jugador (derecha y hacia dentro). */
const derechaSuelo = (v) => v.set(Math.cos(cam.azimut), 0, -Math.sin(cam.azimut))
const frenteSuelo = (v) => v.set(-Math.sin(cam.azimut), 0, -Math.cos(cam.azimut))
const vecA = new THREE.Vector3(), vecB = new THREE.Vector3()

/** Cuántas unidades de mundo mide un píxel a la altura del objetivo. */
function mundoPorPixel () {
  const alto = Math.max(1, contenedor.clientHeight)
  return (2 * cam.distancia * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)) / alto
}

/** Desplaza el mapa como si el dedo lo arrastrase (dx, dy en píxeles). */
function desplazar (dx, dy) {
  const k = mundoPorPixel()
  // el suelo está inclinado: en vertical hay escorzo, se compensa con 1/sin(elevación)
  const kz = k / Math.max(0.35, Math.sin(cam.elevacion))
  derechaSuelo(vecA).multiplyScalar(-dx * k)
  frenteSuelo(vecB).multiplyScalar(dy * kz)
  cam.objetivo.add(vecA).add(vecB)
  limitarObjetivo()
}

// ── calidad automática ───────────────────────────────────────────────────
const calidadPreferida = () => {
  const c = game.state?.ajustes?.calidad
  return (c && c !== 'auto') ? c : null
}

function aplicarCalidad (nivel) {
  const { renderer, sol } = ctx
  if (!renderer) return
  ctx.calidad = nivel
  const sombrasPermitidas = game.state?.ajustes?.sombras !== false && nivel !== 'bajo'
  renderer.shadowMap.enabled = sombrasPermitidas
  if (sol) {
    sol.castShadow = sombrasPermitidas
    if (sombrasPermitidas) ajustarSombra(sol, nivel === 'alto' ? 2048 : 1024)
  }
  const tope = nivel === 'bajo' ? 1 : 2
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tope))
  renderer.setSize(contenedor.clientWidth, contenedor.clientHeight)
}

/** Mide los primeros segundos reales de juego y ajusta el detalle al móvil que toque. */
const medida = { desde: 0, frames: 0, hecho: false }
function medirRendimiento (ahora) {
  if (medida.hecho) return
  if (calidadPreferida()) { medida.hecho = true; return }
  if (!medida.desde) { medida.desde = ahora + 1200; return }   // 1,2 s de gracia: la carga aún trastea
  if (ahora < medida.desde) return
  medida.frames++
  const transcurrido = (ahora - medida.desde) / 1000
  if (transcurrido < 3) return
  const fps = medida.frames / transcurrido
  medida.hecho = true
  if (fps < 34 && ctx.calidad !== 'bajo') aplicarCalidad('bajo')
  else if (fps > 54 && ctx.calidad !== 'alto') aplicarCalidad('alto')
  console.log(`[scene] ${fps.toFixed(0)} fps medidos -> calidad "${ctx.calidad}"`)
}

// ── bucle de render ──────────────────────────────────────────────────────
function bucle (ahora) {
  rafId = requestAnimationFrame(bucle)
  const dt = Math.min(0.1, (ahora - reloj) / 1000)   // tope: si vuelves de segundo plano, nada de saltos
  reloj = ahora

  aplicarInercia(dt)
  arrastreDeBorde(dt)
  avanzarTransicion(dt)
  colocarCamara()

  pasarFrame(dt)
  ctx.renderer.render(ctx.scene, ctx.camera)
  medirRendimiento(ahora)
}

/**
 * Si el fantasma llega al borde de la pantalla, la cámara le sigue sola: sin
 * esto no se puede construir fuera de lo que se ve sin soltar el dedo.
 */
function arrastreDeBorde (dt) {
  if (!dedo || punteros.size !== 1) return
  if (gesto !== 'fantasma' && gesto !== 'mover') return
  const r = lienzo.getBoundingClientRect()
  const x = dedo.x - r.left, y = dedo.y - r.top
  const margen = THREE.MathUtils.clamp(Math.min(r.width, r.height) * 0.14, 44, 90)
  let dx = 0, dy = 0
  if (x < margen) dx = (margen - x) / margen
  else if (x > r.width - margen) dx = -(margen - (r.width - x)) / margen
  if (y < margen) dy = (margen - y) / margen
  else if (y > r.height - margen) dy = -(margen - (r.height - y)) / margen
  if (!dx && !dy) return
  desplazar(dx * BORDE_VEL * dt, dy * BORDE_VEL * dt)
  // la cámara se ha movido: bajo el dedo hay otra casilla
  if (gesto === 'mover') pintarTraslado(dedo.x, dedo.y)
  else emitirCasilla(dedo.x, dedo.y, true)
}

function aplicarInercia (dt) {
  if (gesto === 'pan' || (inercia.x === 0 && inercia.y === 0)) return
  cam.objetivo.x += inercia.x * dt
  cam.objetivo.z += inercia.y * dt
  inercia.multiplyScalar(Math.exp(-FRENO_INERCIA * dt))   // frenada suave, no un corte seco
  if (inercia.lengthSq() < 0.0004) inercia.set(0, 0)
  limitarObjetivo()
}

function avanzarTransicion (dt) {
  if (!destino) return
  const k = 1 - Math.exp(-SUAVE_CAMARA * dt)         // suavizado independiente de los FPS
  cam.objetivo.lerp(destino.objetivo, k)
  cam.distancia += (destino.distancia - cam.distancia) * k
  cam.elevacion += (destino.elevacion - cam.elevacion) * k
  let giro = ((destino.azimut - cam.azimut + Math.PI) % (Math.PI * 2)) - Math.PI
  if (giro < -Math.PI) giro += Math.PI * 2
  cam.azimut += giro * k
  const cerca = cam.objetivo.distanceToSquared(destino.objetivo) < 0.004 &&
                Math.abs(destino.distancia - cam.distancia) < 0.05 && Math.abs(giro) < 0.01
  if (cerca) {
    cam.objetivo.copy(destino.objetivo)
    cam.distancia = destino.distancia
    cam.azimut = destino.azimut
    cam.elevacion = destino.elevacion
    destino = null
  }
}

function alCambiarVisibilidad () {
  if (document.hidden) {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0; pausado = true                        // pestaña oculta = batería que no se gasta
  } else if (pausado) {
    pausado = false
    reloj = performance.now()
    rafId = requestAnimationFrame(bucle)
  }
}

function alRedimensionar () {
  if (!contenedor || !ctx.renderer) return
  ctx.camera.aspect = aspecto()
  ctx.camera.updateProjectionMatrix()
  ctx.renderer.setSize(contenedor.clientWidth, contenedor.clientHeight)
}

// ── selección (picking) ──────────────────────────────────────────────────
/**
 * Qué hay bajo el dedo. Para saber a qué edificio pertenece una malla se sube
 * por `object.parent` hasta encontrar `userData.buildingId`: así los módulos de
 * render marcan SOLO el grupo raíz del edificio y no cada pieza suelta.
 * Marca con `userData.ignorarPicking = true` lo que no deba estorbar (fantasmas, efectos).
 */
function loQueHayEn (px, py) {
  apuntar(px, py)
  const raiz = vistaActual === 'mundo' ? ctx.raizMundo : ctx.raizAldea
  const choques = raiz ? rayo.intersectObjects(raiz.children, true) : []
  for (const ch of choques) {
    if (ignorado(ch.object)) continue
    const id = idDeEdificio(ch.object)
    if (id) return { tipo: 'edificio', id, punto: ch.point }
    break        // lo primero que hay delante no es edificio: manda el suelo
  }
  // La casilla NUNCA sale del punto donde chocó la malla: la copa de un árbol o
  // la ladera de una roca están a metros de su casilla vistas de lado.
  const p = rayoAlSuelo()
  return p ? { tipo: 'suelo', punto: p } : null
}

/** Solo el suelo: el fantasma tiene que poder pasar por encima de todo. */
function sueloEn (px, py) {
  apuntar(px, py)
  return rayoAlSuelo()
}

const OFF_GRID = (CONFIG.GRID - 1) / 2
const gridFinoX = (wx) => wx / CONFIG.CELDA + OFF_GRID
const gridFinoZ = (wz) => wz / CONFIG.CELDA + OFF_GRID

/**
 * Dónde toca el rayo el suelo DE VERDAD. Cortar contra el plano y=0 es lo fácil,
 * pero el terreno tiene relieve: en una loma el dedo señalaría una casilla que no
 * es la que se ve. Se corta, se pregunta la altura de esa casilla, y se vuelve a
 * cortar a esa altura; con dos o tres pasadas ya no se mueve (la pendiente es suave).
 * Devuelve un vector COMPARTIDO: úsalo en el momento, no lo guardes.
 */
function rayoAlSuelo () {
  let altura = 0
  for (let i = 0; i < ITER_SUELO; i++) {
    planoSuelo.constant = -altura
    if (!rayo.ray.intersectPlane(planoSuelo, puntoSuelo)) return null
    let h = 0
    try { h = alturaEn(gridFinoX(puntoSuelo.x), gridFinoZ(puntoSuelo.z)) || 0 } catch { h = 0 }
    if (Math.abs(h - altura) < 0.004) return puntoSuelo   // ya convergió
    altura = h
  }
  planoSuelo.constant = -altura
  return rayo.ray.intersectPlane(planoSuelo, puntoSuelo) ? puntoSuelo : null
}

function apuntar (px, py) {
  const r = lienzo.getBoundingClientRect()
  nds.set(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1)
  rayo.setFromCamera(nds, ctx.camera)
}

function idDeEdificio (obj) {
  let o = obj
  while (o) {
    if (o.userData?.buildingId) return o.userData.buildingId
    o = o.parent
  }
  return null
}

function ignorado (obj) {
  let o = obj
  while (o) {
    if (o.userData?.ignorarPicking) return true
    // OJO: el Raycaster de three.js NO salta lo invisible. La rejilla de
    // construcción del terreno está apagada, pero se comía TODOS los toques:
    // el dedo daba siempre en ella y jamás en el edificio que hay debajo.
    if (o.visible === false) return true
    o = o.parent
  }
  return false
}

/** Emite la casilla bajo el punto de pantalla. `soloSiCambia` para el arrastre del fantasma. */
function emitirCasilla (px, py, soloSiCambia = false) {
  const p = sueloEn(px, py)
  if (!p) return null
  const c = mundoAGrid(p.x, p.z)
  const clave = `${c.x},${c.z}`
  if (soloSiCambia && clave === ultimaCasilla) return c
  ultimaCasilla = clave
  events.emit(EV.GRID_TAP, { x: c.x, z: c.z, mundo: { x: p.x, z: p.z } })
  if (modoConstruccion && modo.tipo) tocarSiCabe(c.x, c.z, modo.ancho, modo.alto, null)
  return c
}

/** Toquecito en el dedo al posarse en una casilla donde SÍ cabe: se nota sin mirar. */
function tocarSiCabe (x, z, ancho, alto, ignorarId) {
  let cabe = false
  try { cabe = huecoLibre(game.state, x, z, ancho, alto, ignorarId) } catch { cabe = false }
  if (cabe) navigator.vibrate?.(8)
  return cabe
}

// ── gestos táctiles ──────────────────────────────────────────────────────
function conectarGestos () {
  lienzo.addEventListener('pointerdown', alBajar, { passive: false })
  window.addEventListener('pointermove', alMover, { passive: false })
  window.addEventListener('pointerup', alSubir, { passive: false })
  window.addEventListener('pointercancel', alSubir, { passive: false })
  lienzo.addEventListener('wheel', alRueda, { passive: false })
  lienzo.addEventListener('contextmenu', (e) => e.preventDefault())
}

const medioDe = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const distDe = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const anguloDe = (a, b) => Math.atan2(b.y - a.y, b.x - a.x)
const listaPunteros = () => [...punteros.values()]

/** El HUD va por encima del lienzo: si el dedo empieza ahí, la cámara ni se entera. */
function sobreInterfaz (e) {
  const t = e.target
  if (!t || t === lienzo) return false
  return typeof t.closest === 'function'
    ? !!t.closest('#hud, .panel, .hoja, button, input, select, textarea, a')
    : true
}

/** Deja la cámara clavada: ni deslizamiento pendiente ni transición a medias. */
function pararCamara () {
  inercia.set(0, 0)
  velPan.set(0, 0)
  destino = null
}

function alBajar (e) {
  if (sobreInterfaz(e)) return
  e.preventDefault()
  punteros.set(e.pointerId, {
    x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY,
    t0: performance.now(), tUltimo: performance.now(), movido: 0, arrastrando: false
  })
  pararCamara()

  if (punteros.size === 1) {
    yaMantenido = false
    dedo = { x: e.clientX, y: e.clientY }
    if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) {
      gesto = 'orbita'
    } else if (modoConstruccion) {
      // en modo construcción el dedo lleva el fantasma; el mapa se mueve con dos dedos
      gesto = moviendo ? 'mover' : 'fantasma'
      ultimaCasilla = ''
      if (moviendo) pintarTraslado(e.clientX, e.clientY)
      else emitirCasilla(e.clientX, e.clientY)
    } else {
      gesto = 'pan'
      armarMantener(e.clientX, e.clientY)
    }
  } else if (punteros.size === 2) {
    // dos dedos SIEMPRE mandan sobre la cámara, también colocando: si no, no se
    // puede construir fuera de lo que cabe en la pantalla
    cancelarMantener()
    const [a, b] = listaPunteros()
    gesto = 'pinza'
    baseDist = distDe(a, b)
    baseAngulo = anguloDe(a, b)
    baseMedio = medioDe(a, b)
  }
}

function alMover (e) {
  const p = punteros.get(e.pointerId)
  if (!p) {
    // en PC, con el modo construcción activo el fantasma sigue al ratón sin pulsar
    if (modoConstruccion && e.pointerType === 'mouse') emitirCasilla(e.clientX, e.clientY, true)
    return
  }
  e.preventDefault()
  const ahora = performance.now()
  const dx = e.clientX - p.x, dy = e.clientY - p.y
  p.x = e.clientX; p.y = e.clientY
  p.movido = Math.max(p.movido, Math.hypot(e.clientX - p.x0, e.clientY - p.y0))
  if (p.movido > PX_TAP) cancelarMantener()
  if (punteros.size === 1) dedo = { x: e.clientX, y: e.clientY }

  if (gesto === 'pan' && punteros.size === 1) {
    // Zona muerta: hasta que el dedo no recorre lo suyo la cámara no se mueve NI
    // UN PÍXEL. Sin esto, el temblor de un toque limpio ya la desplazaba.
    if (!p.arrastrando) {
      if (p.movido <= PX_ARRASTRE) return
      p.arrastrando = true
      p.tUltimo = ahora
      return                       // el tramo del umbral se descarta: si no, da un salto
    }
    desplazar(dx, dy)
    // velocidad REAL del último tramo (píxeles por segundo medidos con el reloj);
    // antes se multiplicaba por 60 a ciegas y un píxel de temblor salía disparado
    const seg = Math.max(0.008, (ahora - p.tUltimo) / 1000)
    p.tUltimo = ahora
    const k = mundoPorPixel(), kz = k / Math.max(0.35, Math.sin(cam.elevacion))
    derechaSuelo(vecA).multiplyScalar(-dx * k / seg)
    frenteSuelo(vecB).multiplyScalar(dy * kz / seg)
    // media con lo anterior: un último micro-tirón no decide el deslizamiento entero
    velPan.set(velPan.x * 0.35 + (vecA.x + vecB.x) * 0.65, velPan.y * 0.35 + (vecA.z + vecB.z) * 0.65)
  } else if (gesto === 'fantasma') {
    emitirCasilla(e.clientX, e.clientY, true)
  } else if (gesto === 'mover') {
    pintarTraslado(e.clientX, e.clientY)
  } else if (gesto === 'orbita') {
    cam.azimut -= dx * 0.006
    cam.elevacion = THREE.MathUtils.clamp(cam.elevacion + dy * 0.005, ELEV_MIN, ELEV_MAX)
  } else if (gesto === 'pinza' && punteros.size >= 2) {
    const [a, b] = listaPunteros()
    const d = distDe(a, b), ang = anguloDe(a, b), medio = medioDe(a, b)
    if (baseDist > 10 && d > 10) {
      cam.distancia = THREE.MathUtils.clamp(cam.distancia * (baseDist / d), CONFIG.ZOOM_MIN, CONFIG.ZOOM_MAX)
    }
    let giro = ang - baseAngulo
    if (giro > Math.PI) giro -= Math.PI * 2
    if (giro < -Math.PI) giro += Math.PI * 2
    cam.azimut += giro                                  // girar la muñeca gira la aldea
    desplazar(medio.x - baseMedio.x, medio.y - baseMedio.y)
    baseDist = d; baseAngulo = ang; baseMedio = medio
  }
}

function alSubir (e) {
  const p = punteros.get(e.pointerId)
  punteros.delete(e.pointerId)
  cancelarMantener()
  if (!p) return

  if (punteros.size === 0) {
    const ahora = performance.now()
    const duracion = ahora - p.t0
    const recorrido = Math.hypot(e.clientX - p.x0, e.clientY - p.y0)

    if (gesto === 'mover') {
      soltarTraslado(e.clientX, e.clientY)
    } else if (!yaMantenido && !p.arrastrando && duracion < MS_TAP &&
               recorrido < PX_TAP && p.movido <= PX_TAP && gesto !== 'pinza') {
      // p.movido guarda si ESE dedo llegó a arrastrar: evita el toque fantasma
      // al levantar el segundo dedo de una pinza
      seleccionarEn(e.clientX, e.clientY)
    }

    // El deslizamiento solo existe si hubo arrastre de verdad y el dedo aún iba
    // moviéndose al soltar: parar el dedo y levantarlo tiene que dejar la cámara clavada.
    const deslizar = gesto === 'pan' && p.arrastrando && (ahora - p.tUltimo) < MS_INERCIA
    if (deslizar) {
      inercia.copy(velPan)
      if (inercia.length() > VEL_MAX_INERCIA) inercia.setLength(VEL_MAX_INERCIA)
    } else {
      inercia.set(0, 0)
    }
    velPan.set(0, 0)
    gesto = 'nada'
    dedo = null
    ultimaCasilla = ''
  } else if (punteros.size === 1) {
    // se levantó un dedo de la pinza: el que queda sigue mandando sin dar un salto
    const [q] = listaPunteros()
    q.x0 = q.x; q.y0 = q.y; q.t0 = performance.now(); q.tUltimo = performance.now()
    q.movido = PX_TAP + 1; q.arrastrando = true
    dedo = { x: q.x, y: q.y }
    gesto = moviendo ? 'mover' : (modoConstruccion ? 'fantasma' : 'pan')
    pararCamara()
  }
}

function armarMantener (px, py) {
  cancelarMantener()
  temporizadorMantener = setTimeout(() => {
    temporizadorMantener = 0
    const hallado = loQueHayEn(px, py)
    // mantener pulsado un edificio lo LEVANTA: a partir de aquí el dedo lo lleva
    // a otra casilla. Su ficha se abre con un toque normal.
    if (hallado?.tipo === 'edificio') empezarTraslado(hallado.id, px, py)
  }, MS_MANTENER)
}

function cancelarMantener () {
  if (temporizadorMantener) { clearTimeout(temporizadorMantener); temporizadorMantener = 0 }
}

function seleccionarEn (px, py) {
  // colocando, un toque solo mueve el fantasma: nada de abrir fichas por debajo
  if (modoConstruccion) { emitirCasilla(px, py); return }
  const hallado = loQueHayEn(px, py)
  if (!hallado) { events.emit(EV.UI_SELECT, { kind: null, id: null }); return }
  if (hallado.tipo === 'edificio') {
    events.emit(EV.UI_SELECT, { kind: 'building', id: hallado.id })
    return
  }
  const c = mundoAGrid(hallado.punto.x, hallado.punto.z)
  events.emit(EV.UI_SELECT, { kind: 'tile', x: c.x, z: c.z })
  events.emit(EV.GRID_TAP, { x: c.x, z: c.z, mundo: { x: hallado.punto.x, z: hallado.punto.z } })
  ultimaCasilla = `${c.x},${c.z}`
}

// ── traslado de un edificio con el dedo ──────────────────────────────────
/**
 * Levantar y llevar. El render no toca `game.state`: al soltar se le pide el
 * cambio a sim/buildings.mover(), que es quien decide.
 */
function empezarTraslado (id, px, py) {
  const b = (game.state.buildings || []).find(x => x.id === id)
  if (!b) return false
  pararCamara()
  cancelarMantener()
  yaMantenido = true
  moviendo = {
    id, tipo: b.tipo, ancho: b.ancho ?? 2, alto: b.alto ?? 2, rot: b.rot | 0,
    x: b.x, z: b.z, valido: true, pintado: false
  }
  // la interfaz necesita saber que esto es un TRASLADO, no una obra nueva
  events.emit(EV.BUILD_MODE, {
    activo: true, tipo: b.tipo, moviendoId: id, moviendo: id,
    ancho: moviendo.ancho, alto: moviendo.alto, rot: moviendo.rot
  })
  gesto = 'mover'
  ultimaCasilla = ''
  navigator.vibrate?.(14)
  pintarTraslado(px, py)
  return true
}

/** Fantasma del edificio que va en volandas, centrado en el dedo y en verde o rojo. */
function pintarTraslado (px, py) {
  if (!moviendo) return
  const p = sueloEn(px, py)
  if (!p) return
  const c = mundoAGrid(p.x, p.z)
  // el edificio se cuelga del dedo por su centro, no por su esquina
  const x = Math.round(c.x - (moviendo.ancho - 1) / 2)
  const z = Math.round(c.z - (moviendo.alto - 1) / 2)
  if (moviendo.pintado && x === moviendo.x && z === moviendo.z) return
  moviendo.x = x; moviendo.z = z; moviendo.pintado = true
  moviendo.valido = tocarSiCabe(x, z, moviendo.ancho, moviendo.alto, moviendo.id)
  events.emit(EV.BUILD_GHOST, {
    tipo: moviendo.tipo, x, z, rot: moviendo.rot,
    ancho: moviendo.ancho, alto: moviendo.alto,
    valido: moviendo.valido, motivo: moviendo.valido ? '' : 'Ahí no cabe',
    moviendoId: moviendo.id
  })
}

function soltarTraslado (px, py) {
  if (!moviendo) return
  pintarTraslado(px, py)
  const m = moviendo
  moviendo = null
  events.emit(EV.BUILD_MODE, { activo: false, tipo: null })
  if (moverEdificio && moverEdificio(m.id, m.x, m.z)) {
    navigator.vibrate?.(10)
    events.emit(EV.SFX, { nombre: 'construir' })
  }
}

function alRueda (e) {
  e.preventDefault()
  const paso = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
  cam.distancia = THREE.MathUtils.clamp(cam.distancia * Math.exp(paso * 0.0012), CONFIG.ZOOM_MIN, CONFIG.ZOOM_MAX)
  destino = null
}

// ── eventos del juego ────────────────────────────────────────────────────
function conectarEventos () {
  events.on(EV.BUILD_MODE, (p) => {
    modoConstruccion = !!p?.activo
    modo.tipo = modoConstruccion ? (p?.tipo || null) : null
    modo.ancho = p?.ancho ?? 2
    modo.alto = p?.alto ?? 2
    modo.rot = p?.rot | 0
    ultimaCasilla = ''
    // al entrar a colocar la cámara se CONGELA: con el mapa deslizándose es
    // imposible acertar una casilla
    pararCamara()
    cancelarMantener()
    if (!modoConstruccion) { moviendo = null; dedo = null }
    if (gesto === 'pan' && modoConstruccion) gesto = 'fantasma'
    else if ((gesto === 'fantasma' || gesto === 'mover') && !modoConstruccion) gesto = 'pan'
  })

  events.on(EV.CAMERA_FOCUS, (p) => {
    if (!p) return
    const m = gridAMundo(p.x ?? 0, p.z ?? 0)
    destino = {
      objetivo: new THREE.Vector3(m.x, 0, m.z),
      distancia: THREE.MathUtils.clamp(p.zoom ?? cam.distancia, CONFIG.ZOOM_MIN, CONFIG.ZOOM_MAX),
      azimut: cam.azimut,
      elevacion: cam.elevacion
    }
    inercia.set(0, 0)
  })

  events.on(EV.VISTA_CAMBIADA, (p) => cambiarVista(p?.vista || 'aldea'))
}

function cambiarVista (vista) {
  if (vista !== 'aldea' && vista !== 'mundo') return
  if (vista === vistaActual) return
  poses[vistaActual] = { objetivo: cam.objetivo.clone(), distancia: cam.distancia, azimut: cam.azimut, elevacion: cam.elevacion }
  vistaActual = vista
  if (ctx.raizAldea) ctx.raizAldea.visible = vista === 'aldea'
  if (ctx.raizMundo) ctx.raizMundo.visible = vista === 'mundo'
  inercia.set(0, 0)
  const guardada = poses[vista]
  destino = guardada
    ? { objetivo: guardada.objetivo.clone(), distancia: guardada.distancia, azimut: guardada.azimut, elevacion: guardada.elevacion }
    : { objetivo: new THREE.Vector3(0, 0, 0), distancia: CONFIG.ZOOM_MAX, azimut: cam.azimut, elevacion: THREE.MathUtils.degToRad(55) }
  // el cambio de mapa se nota menos si la cámara arranca ya a medio camino
  cam.objetivo.lerp(destino.objetivo, 0.5)
}

// ── atajos para la interfaz (botones de zoom/giro), colgados en ctx.camara ──
const proyAux = new THREE.Vector3()

const api = {
  get vista () { return vistaActual },
  get objetivo () { return cam.objetivo.clone() },
  get distancia () { return cam.distancia },
  /** Dónde está la cámara ahora mismo, en unidades de mundo. Para medir que NO se mueve. */
  posicion: () => ctx.camera.position.toArray(),
  /**
   * Casilla -> píxeles de pantalla (centro de la casilla, a su altura real).
   * Es el camino inverso del picking: sirve para clavar carteles sobre el mapa
   * y para comprobar con números que el dedo acierta donde señala.
   */
  proyectar: (x, z) => {
    const w = gridAMundo(x, z)
    let h = 0
    try { h = alturaEn(x, z) || 0 } catch { h = 0 }
    proyAux.set(w.x, h, w.z).project(ctx.camera)
    const r = lienzo.getBoundingClientRect()
    const px = r.left + (proyAux.x * 0.5 + 0.5) * r.width
    const py = r.top + (-proyAux.y * 0.5 + 0.5) * r.height
    // detrás de la cámara la proyección miente (sale dada la vuelta): hay que avisar
    const visible = proyAux.z > -1 && proyAux.z < 1 &&
      px >= r.left && px <= r.right && py >= r.top && py <= r.bottom
    return { x: px, y: py, visible }
  },
  enfocar: (x, z, zoom) => events.emit(EV.CAMERA_FOCUS, { x, z, zoom }),
  zoom: (factor) => { cam.distancia = THREE.MathUtils.clamp(cam.distancia * factor, CONFIG.ZOOM_MIN, CONFIG.ZOOM_MAX) },
  girar: (rad) => { cam.azimut += rad },
  inclinar: (rad) => { cam.elevacion = THREE.MathUtils.clamp(cam.elevacion + rad, ELEV_MIN, ELEV_MAX) },
  calidad: (nivel) => aplicarCalidad(nivel)
}

