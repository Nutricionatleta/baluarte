import * as THREE from 'three'
import { PALETA, CONFIG } from '../core/config.js'
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { gridAMundo, tamañoDe } from '../core/grid.js'
import { ctx, cuandoListo, onFrame, aEscena } from './ctx.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mat, G, pieza } from './mats.js'

/**
 * EFECTOS: lo que hace que la aldea parezca viva.
 *
 * Todo lo de aquí se dibuja en 3D o mueve luces; ni un texto de interfaz.
 * Dos reglas que no se saltan nunca:
 *   1. Todo sale de POOLS creados al arrancar. Dentro de onFrame no hay ni un `new`.
 *   2. Se reacciona a los eventos del bus; nadie tiene que llamarnos a mano.
 *
 * COORDENADAS: las funciones de partículas y `anillo()` van en coordenadas de
 * MUNDO (las de Three.js). Si tienes casillas, convierte con `mundoDe(gx, gz)`.
 * `marcarCasillas()` es la excepción evidente: recibe casillas.
 *
 * La API queda también en `ctx.fx` para que otros módulos de render la usen sin
 * importar este fichero (el contexto compartido es el canal legítimo).
 */

// ── ajustes ───────────────────────────────────────────────────────────────
const SEG_POR_DIA = 480          // 8 minutos de reloj real por día completo
const MOMENTO_INICIAL = 0.36     // empieza a media mañana: se ve bien la aldea
const RADIO_SOL = 42
const MAX_LUCES_NOCHE = 4        // cada PointLight cuesta en móvil: cuatro y no más

/** Momento del día 0..1 (0.25 amanece, 0.5 mediodía, 0.75 anochece). MÍO, no del estado. */
let momento = MOMENTO_INICIAL
let factorNoche = 0              // 0 de día, 1 de noche cerrada

let calidad = 'medio'
let escala = 1                   // multiplicador de partículas según calidad
let ambiente = true              // nubes, pájaros y mariposas

/** ¿Estamos en el campo de batalla? Cambia la luz, el cielo y quién puede emitir. */
let enBatalla = false
let tinteBatalla = 0             // 0 aldea, 1 batalla: se mezcla suave, sin corte
let emisoresAldea = null         // chimeneas de la aldea, aparcadas mientras hay batalla

// temporales: se reutilizan en cada frame para no generar basura
const _v3 = new THREE.Vector3()
const _desvioCam = new THREE.Vector3()
const _m4 = new THREE.Matrix4()
const _col = new THREE.Color()
const _colB = new THREE.Color()
const _colC = new THREE.Color()

const COLOR_RECURSO = {
  madera: PALETA.madera, piedra: PALETA.piedra,
  comida: PALETA.trigo, oro: PALETA.oro
}
const COLORES_CONFETI = [PALETA.tela, PALETA.oro, PALETA.estandarte, PALETA.hierbaClara, PALETA.tejado]

const azar = (a, b) => a + Math.random() * (b - a)
const mezcla = THREE.MathUtils.lerp

/** Casillas -> mundo. Para quien tenga coordenadas del estado. */
export function mundoDe (gx, gz) { return gridAMundo(gx, gz) }

/**
 * Cuelga de la ESCENA, no de la aldea. Lo que tiene que verse también durante
 * una batalla (partículas, aros de impacto, haces de luz) no puede colgar de
 * `ctx.raizAldea`, que se apaga entera mientras se pelea.
 */
const aLaEscena = (obj) => { if (ctx.scene) ctx.scene.add(obj); else aEscena(obj); return obj }

/** Centro en mundo de un edificio del estado (tiene en cuenta su tamaño). */
function centroMundo (b) {
  const s = tamañoDe(b)
  return gridAMundo(b.x + (s.ancho - 1) / 2, b.z + (s.alto - 1) / 2)
}

// ══ SISTEMA DE PARTÍCULAS ════════════════════════════════════════════════
// Un único Points por modo de mezcla, con lista de huecos libres. Las
// partículas muertas se reciclan; jamás se crea geometría en caliente.

const VERT = `
  attribute float tam;
  attribute float alfa;
  varying vec3 vColor;
  varying float vAlfa;
  void main () {
    vColor = color;
    vAlfa = alfa;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = tam * (300.0 / max(-mv.z, 0.1));
    gl_Position = projectionMatrix * mv;
  }
`

const FRAG = `
  varying vec3 vColor;
  varying float vAlfa;
  void main () {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    float borde = smoothstep(0.25, 0.05, r2);
    gl_FragColor = vec4(vColor, vAlfa * borde);
    #include <colorspace_fragment>
  }
`

/** Marca para subir solo los primeros `n` valores de un atributo. */
function subir (attr, n) {
  if (attr.clearUpdateRanges) { attr.clearUpdateRanges(); attr.addUpdateRange(0, n) }
  attr.needsUpdate = true
}

function crearSistema (max, aditivo) {
  const geom = new THREE.BufferGeometry()
  const pos = new Float32Array(max * 3)
  const col = new Float32Array(max * 3)
  const tam = new Float32Array(max)
  const alf = new Float32Array(max)
  const attr = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage)
  geom.setAttribute('position', attr(pos, 3))
  geom.setAttribute('color', attr(col, 3))
  geom.setAttribute('tam', attr(tam, 1))
  geom.setAttribute('alfa', attr(alf, 1))
  geom.setDrawRange(0, 0)
  // esfera a mano: recalcularla cada frame con partículas móviles sería tirar CPU
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), CONFIG.GRID * 1.5)

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    blending: aditivo ? THREE.AdditiveBlending : THREE.NormalBlending
  })

  const puntos = new THREE.Points(geom, material)
  puntos.frustumCulled = false
  puntos.renderOrder = aditivo ? 12 : 10

  const vx = new Float32Array(max)
  const vy = new Float32Array(max)
  const vz = new Float32Array(max)
  const vida = new Float32Array(max)
  const vidaMax = new Float32Array(max)
  const grav = new Float32Array(max)
  const roce = new Float32Array(max)
  const tam0 = new Float32Array(max)
  const tam1 = new Float32Array(max)
  const alfa0 = new Float32Array(max)

  const libres = new Int32Array(max)
  let nLibres = max
  for (let i = 0; i < max; i++) libres[i] = max - 1 - i
  let tope = 0   // índice máximo usado: evita recorrer el pool entero

  const sis = {
    puntos,
    /** Enciende una partícula. Si el pool está lleno, se ignora (nunca crece). */
    emitir (x, y, z, o) {
      if (nLibres === 0) return
      const i = libres[--nLibres]
      if (i + 1 > tope) tope = i + 1
      const i3 = i * 3
      pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z
      _col.setHex(o.color ?? 0xffffff)
      col[i3] = _col.r; col[i3 + 1] = _col.g; col[i3 + 2] = _col.b
      vx[i] = o.vx || 0; vy[i] = o.vy || 0; vz[i] = o.vz || 0
      vida[i] = vidaMax[i] = o.vida ?? 1
      grav[i] = o.grav ?? 0
      roce[i] = o.roce ?? 0.6
      tam0[i] = o.tam0 ?? 0.3
      tam1[i] = o.tam1 ?? 0
      alfa0[i] = o.alfa ?? 1
      tam[i] = tam0[i]
      alf[i] = alfa0[i]
    },
    actualizar (dt) {
      // con el pool vacío no se toca nada: antes se subían a la GPU los 700
      // huecos del pool en CADA frame aunque no hubiera ni una partícula viva
      if (tope === 0) {
        if (geom.drawRange.count !== 0) geom.setDrawRange(0, 0)
        return
      }
      let vivos = 0
      for (let i = 0; i < tope; i++) {
        if (vida[i] <= 0) continue
        vida[i] -= dt
        if (vida[i] <= 0) {
          alf[i] = 0; tam[i] = 0
          libres[nLibres++] = i
          continue
        }
        vivos++
        const f = 1 - Math.min(roce[i] * dt, 0.9)
        vy[i] += grav[i] * dt
        vx[i] *= f; vy[i] *= f; vz[i] *= f
        const i3 = i * 3
        pos[i3] += vx[i] * dt
        pos[i3 + 1] += vy[i] * dt
        pos[i3 + 2] += vz[i] * dt
        const k = vida[i] / vidaMax[i]
        alf[i] = alfa0[i] * (k > 0.75 ? (1 - k) * 4 : k / 0.75)   // entra y sale suave
        tam[i] = mezcla(tam1[i], tam0[i], k)
      }
      if (vivos === 0) tope = 0
      geom.setDrawRange(0, tope)
      // solo se sube el tramo del pool que está en uso, no el pool entero
      subir(geom.attributes.position, tope * 3)
      subir(geom.attributes.color, tope * 3)
      subir(geom.attributes.tam, tope)
      subir(geom.attributes.alfa, tope)
    }
  }
  return sis
}

/** @type {{emitir:Function, actualizar:Function, puntos:THREE.Points}|null} */
let humos = null    // mezcla normal: polvo, humo, hojas, confeti
let brillos = null  // mezcla aditiva: chispas, destellos, fuego

/** Redondea la cantidad según la calidad; en 'bajo' va la mitad. */
const cant = (n) => Math.max(1, Math.round(n * escala))

// ── partículas públicas ───────────────────────────────────────────────────

/** Polvo marrón que salta del suelo: al colocar o derribar algo. */
export function polvo (x, z, cantidad = 14) {
  if (!humos) return
  const n = cant(cantidad)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const v = azar(0.7, 2.1)
    humos.emitir(x + Math.cos(a) * 0.3, azar(0.05, 0.3), z + Math.sin(a) * 0.3, {
      color: Math.random() < 0.4 ? PALETA.camino : PALETA.tierra,
      vx: Math.cos(a) * v, vy: azar(0.4, 1.4), vz: Math.sin(a) * v,
      vida: azar(0.5, 1.1), grav: -0.8, roce: 1.6,
      tam0: azar(0.18, 0.34), tam1: azar(0.3, 0.6), alfa: 0.85
    })
  }
}

/** Una bocanada de humo. Para una columna constante usa `humoContinuo`. */
export function humo (x, z, altura = 1.4, color = 0xbfb8ae) {
  if (!humos) return
  const n = cant(2)
  for (let i = 0; i < n; i++) {
    humos.emitir(x + azar(-0.12, 0.12), altura, z + azar(-0.12, 0.12), {
      color,
      vx: azar(-0.12, 0.12), vy: azar(0.5, 0.85), vz: azar(-0.12, 0.12),
      vida: azar(2.2, 3.4), grav: 0.12, roce: 0.25,
      tam0: azar(0.22, 0.34), tam1: azar(0.7, 1.1), alfa: 0.5
    })
  }
}

/**
 * Columna de humo permanente (chimeneas, herrería, hogueras).
 * @returns {() => void} llámala para apagarla.
 */
export function humoContinuo (x, z, opciones = {}) {
  const e = {
    x, z,
    altura: opciones.altura ?? 1.4,
    color: opciones.color ?? 0xbfb8ae,
    periodo: (opciones.periodo ?? 0.45) / escala,
    fuego: !!opciones.fuego,
    fin: opciones.segundos ? opciones.segundos : Infinity,
    acum: Math.random() * 0.4
  }
  emisores.push(e)
  if (emisores.length > 16) emisores.shift()   // tope duro: móvil
  return () => {
    const i = emisores.indexOf(e)
    if (i >= 0) emisores.splice(i, 1)
  }
}

/** Fuego: humo negro + brasas. Se apaga solo pasados `segundos`. */
export function fuego (x, z, segundos = 12) {
  return humoContinuo(x, z, { altura: 0.5, color: 0x4a4038, periodo: 0.3, fuego: true, segundos })
}

/** Chispas: herrería, impactos, madera al partirse. */
export function chispas (x, z, color = PALETA.oro, y = 0.9) {
  if (!brillos) return
  const n = cant(10)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const v = azar(0.8, 2.4)
    brillos.emitir(x, y, z, {
      color,
      vx: Math.cos(a) * v, vy: azar(1.2, 3), vz: Math.sin(a) * v,
      vida: azar(0.35, 0.8), grav: -6, roce: 0.4,
      tam0: azar(0.09, 0.16), tam1: 0.02, alfa: 1
    })
  }
}

/** Destello alegre: recoger recursos, subir de nivel, obra terminada. */
export function destello (x, z, color = PALETA.oro, y = 0.8) {
  if (!brillos) return
  const n = cant(14)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const v = azar(0.4, 1.5)
    brillos.emitir(x, y, z, {
      color,
      vx: Math.cos(a) * v, vy: azar(1.1, 2.4), vz: Math.sin(a) * v,
      vida: azar(0.7, 1.3), grav: -0.6, roce: 1.1,
      tam0: azar(0.14, 0.26), tam1: 0.02, alfa: 1
    })
  }
}

/** Hojas que caen al talar un árbol. */
export function hojas (x, z, color = PALETA.copaRoble) {
  if (!humos) return
  const n = cant(12)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    humos.emitir(x + Math.cos(a) * azar(0, 0.6), azar(0.9, 2.1), z + Math.sin(a) * azar(0, 0.6), {
      color: Math.random() < 0.3 ? PALETA.copaPino : color,
      vx: Math.cos(a) * azar(0.2, 1), vy: azar(0.2, 0.9), vz: Math.sin(a) * azar(0.2, 1),
      vida: azar(1.4, 2.4), grav: -1.1, roce: 1.4,
      tam0: azar(0.14, 0.24), tam1: azar(0.1, 0.18), alfa: 0.95
    })
  }
}

/** Explosión: un edificio que cae. `fuerza` 0.5 pequeña, 2 desastre. */
export function explosion (x, z, fuerza = 1) {
  const f = THREE.MathUtils.clamp(fuerza, 0.3, 3)
  polvo(x, z, 16 * f)
  chispas(x, z, 0xff8a3d, 0.6)
  if (humos) {
    const n = cant(14 * f)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      humos.emitir(x, azar(0.2, 0.8), z, {
        color: Math.random() < 0.5 ? 0x5a5048 : PALETA.tierra,
        vx: Math.cos(a) * azar(0.5, 2.5) * f, vy: azar(1, 3.4) * f, vz: Math.sin(a) * azar(0.5, 2.5) * f,
        vida: azar(1.2, 2.4), grav: -0.4, roce: 0.9,
        tam0: azar(0.3, 0.5), tam1: azar(0.9, 1.5), alfa: 0.65
      })
    }
  }
  if (brillos) {
    const n = cant(10 * f)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      brillos.emitir(x, azar(0.3, 1), z, {
        color: Math.random() < 0.5 ? 0xffb347 : 0xff5722,
        vx: Math.cos(a) * azar(1, 4) * f, vy: azar(1.5, 4) * f, vz: Math.sin(a) * azar(1, 4) * f,
        vida: azar(0.4, 0.9), grav: -5, roce: 0.6,
        tam0: azar(0.14, 0.3), tam1: 0.02, alfa: 1
      })
    }
  }
  aro(x, z, 0.6 + 1.6 * f, 0xff8a3d, 0.7)
  temblor(0.12 * f)
}

// ── lo que hace falta para que una batalla se vea ─────────────────────────

/**
 * Astillas: el ariete contra la puerta, la viga que se parte. Salen disparadas
 * hacia el atacante (por eso lleva dirección) y caen pesadas: es madera.
 */
export function astillas (x, y, z, dx = 0, dz = 1, cantidad = 10) {
  if (!humos) return
  const largo = Math.hypot(dx, dz) || 1
  const ux = dx / largo; const uz = dz / largo
  const n = cant(cantidad)
  for (let i = 0; i < n; i++) {
    const abre = azar(-0.9, 0.9)
    const v = azar(1.2, 3.4)
    humos.emitir(x, y, z, {
      color: Math.random() < 0.35 ? PALETA.maderaClara : PALETA.madera,
      vx: (ux * Math.cos(abre) - uz * Math.sin(abre)) * v,
      vy: azar(1.2, 3.2),
      vz: (uz * Math.cos(abre) + ux * Math.sin(abre)) * v,
      vida: azar(0.5, 1.1), grav: -7, roce: 0.5,
      tam0: azar(0.08, 0.16), tam1: azar(0.05, 0.1), alfa: 1
    })
  }
}

/**
 * Un punto de estela para un proyectil en vuelo. Una flecha sin rastro es un
 * palo que aparece y desaparece; con rastro se ve DE DÓNDE salió el disparo,
 * que es lo que enseña qué torre está trabajando.
 */
export function estela (x, y, z, color = PALETA.brasa, gordo = 0.12) {
  if (!brillos) return
  brillos.emitir(x, y, z, {
    color, vx: 0, vy: 0.1, vz: 0,
    vida: azar(0.16, 0.3), grav: 0, roce: 2,
    tam0: gordo, tam1: 0.01, alfa: 0.85
  })
}

/** Chispazo de acero contra acero (o contra piedra) a la altura del golpe. */
export function impacto (x, y, z, color = PALETA.aceroClaro, fuerza = 1) {
  if (!brillos) return
  const n = cant(5 * fuerza)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const v = azar(0.6, 2) * fuerza
    brillos.emitir(x, y, z, {
      color: Math.random() < 0.3 ? PALETA.brasa : color,
      vx: Math.cos(a) * v, vy: azar(0.8, 2.4), vz: Math.sin(a) * v,
      vida: azar(0.2, 0.45), grav: -7, roce: 0.5,
      tam0: azar(0.07, 0.13), tam1: 0.01, alfa: 1
    })
  }
}

/** Chapoteo: el que cruza el foso con el agua por las rodillas. */
export function salpicadura (x, z, y = 0.1, cantidad = 5) {
  if (!humos) return
  const n = cant(cantidad)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const v = azar(0.3, 1.1)
    humos.emitir(x, y, z, {
      color: Math.random() < 0.35 ? PALETA.aguaProfunda : PALETA.agua,
      vx: Math.cos(a) * v, vy: azar(0.9, 2.1), vz: Math.sin(a) * v,
      vida: azar(0.3, 0.6), grav: -5, roce: 0.7,
      tam0: azar(0.08, 0.16), tam1: 0.03, alfa: 0.9
    })
  }
}

/** El puñado de polvo del que se desploma: sin él, la figura se cae en el vacío. */
export function caida (x, z, y = 0.1) {
  if (!humos) return
  const n = cant(5)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    humos.emitir(x, y, z, {
      color: Math.random() < 0.5 ? PALETA.camino : PALETA.tierra,
      vx: Math.cos(a) * azar(0.3, 0.9), vy: azar(0.2, 0.7), vz: Math.sin(a) * azar(0.3, 0.9),
      vida: azar(0.5, 0.9), grav: -1, roce: 2,
      tam0: azar(0.12, 0.22), tam1: azar(0.25, 0.4), alfa: 0.6
    })
  }
}

/** Confeti de celebración: cae con gravedad y da color al momento. */
function confeti (x, z, cantidad = 22) {
  if (!humos) return
  const n = cant(cantidad)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    humos.emitir(x, azar(1.2, 2.2), z, {
      color: COLORES_CONFETI[(Math.random() * COLORES_CONFETI.length) | 0],
      vx: Math.cos(a) * azar(0.6, 2.4), vy: azar(2, 4.2), vz: Math.sin(a) * azar(0.6, 2.4),
      vida: azar(1.6, 2.8), grav: -3.2, roce: 0.9,
      tam0: azar(0.12, 0.2), tam1: azar(0.1, 0.16), alfa: 1
    })
  }
}
export { confeti }

/** Motita de recurso que sale del edificio y sube: el "+5 madera" en 3D. */
export function motaRecurso (x, z, tipo) {
  if (!brillos) return
  const color = COLOR_RECURSO[tipo] ?? PALETA.oro
  brillos.emitir(x + azar(-0.2, 0.2), 0.9, z + azar(-0.2, 0.2), {
    color, vx: azar(-0.15, 0.15), vy: azar(1.4, 1.9), vz: azar(-0.15, 0.15),
    vida: 1.1, grav: 0.6, roce: 0.1, tam0: 0.3, tam1: 0.05, alfa: 1
  })
}

// emisores continuos (humo de chimenea, incendios)
const emisores = []

// ── qué entra en cámara ───────────────────────────────────────────────────
// El humo que sale fuera de pantalla se paga igual que el que se ve: ocupa
// hueco en el pool, se simula y se sube a la GPU. Aquí se comprueba antes.
const _frustum = new THREE.Frustum()
const _mVP = new THREE.Matrix4()
const _esfera = new THREE.Sphere(new THREE.Vector3(), 1.6)

function refrescarVista () {
  const cam = ctx.camera
  if (!cam) return
  _mVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
  _frustum.setFromProjectionMatrix(_mVP)
}

function seVe (x, y, z) {
  if (!ctx.camera) return true
  _esfera.center.set(x, y, z)
  return _frustum.intersectsSphere(_esfera)
}

// ══ CICLO DÍA / NOCHE ════════════════════════════════════════════════════
// Cada fase define color e intensidad del sol, ambiente y cielo. Se interpola
// entre las dos fases que rodean al momento actual.
const FASES = [
  { t: 0.00, sol: 0x2a3a66, int: 0.10, amb: 0.26, cielo: PALETA.cieloNoche, noche: 1.0 },
  { t: 0.18, sol: 0x2a3a66, int: 0.10, amb: 0.26, cielo: PALETA.cieloNoche, noche: 1.0 },
  { t: 0.26, sol: 0xff9a52, int: 0.60, amb: 0.46, cielo: PALETA.cieloAtardecer, noche: 0.35 },
  { t: 0.34, sol: 0xffe9c2, int: 1.00, amb: 0.70, cielo: PALETA.cielo, noche: 0.05 },
  { t: 0.50, sol: PALETA.sol, int: 1.20, amb: 0.80, cielo: PALETA.cielo, noche: 0.0 },
  { t: 0.68, sol: 0xffeccb, int: 1.00, amb: 0.70, cielo: PALETA.cielo, noche: 0.05 },
  { t: 0.76, sol: 0xff7a45, int: 0.62, amb: 0.48, cielo: PALETA.cieloAtardecer, noche: 0.35 },
  { t: 0.86, sol: 0x3d4d80, int: 0.16, amb: 0.30, cielo: PALETA.cieloNoche, noche: 0.9 },
  { t: 1.00, sol: 0x2a3a66, int: 0.10, amb: 0.26, cielo: PALETA.cieloNoche, noche: 1.0 }
]

let luzAmbiente = null
let intensidadAmbBase = 1
let luna = null
let estrellas = null
let matEstrellas = null
const lucesNoche = []
let ventanas = null
let ventanasSucias = true
let relojVentanas = 0

function faseActual (t) {
  let a = FASES[0]
  let b = FASES[FASES.length - 1]
  for (let i = 0; i < FASES.length - 1; i++) {
    if (t >= FASES[i].t && t <= FASES[i + 1].t) { a = FASES[i]; b = FASES[i + 1]; break }
  }
  const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
  return { a, b, k }
}

function montarCielo (scene) {
  // luna: una esfera low-poly que brilla por sí sola
  luna = pieza(G.esfera1, mat(PALETA.luna, { emisivo: 0x6d86c9 }), { sx: 3, sy: 3, sz: 3, sombra: false, recibe: false })
  luna.visible = false
  scene.add(luna)

  // estrellas: Points en una cúpula, con opacidad animada
  const n = calidad === 'bajo' ? 90 : 220
  const pos = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const el = azar(0.15, 1.45)
    const r = 90
    pos[i * 3] = Math.cos(a) * Math.cos(el) * r
    pos[i * 3 + 1] = Math.sin(el) * r
    pos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  matEstrellas = new THREE.PointsMaterial({
    color: 0xffffff, size: 1.1, sizeAttenuation: false,
    transparent: true, opacity: 0, depthWrite: false
  })
  estrellas = new THREE.Points(g, matEstrellas)
  estrellas.frustumCulled = false
  estrellas.renderOrder = -1
  scene.add(estrellas)
}

function montarLucesNoche (scene) {
  for (let i = 0; i < MAX_LUCES_NOCHE; i++) {
    const l = new THREE.PointLight(0xffb45c, 0, 8, 2)
    l.visible = false
    scene.add(l)
    lucesNoche.push(l)
  }
  // ventanas encendidas: mallas emisivas, mucho más baratas que una luz
  const max = calidad === 'bajo' ? 24 : 72
  ventanas = new THREE.InstancedMesh(G.caja, mat(0xffd089, { emisivo: 0xffa235 }), max)
  ventanas.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  ventanas.count = 0
  ventanas.visible = false
  ventanas.castShadow = false
  ventanas.receiveShadow = false
  aEscena(ventanas)
}

/** Recoloca las ventanas y las cuatro luces sobre los edificios que hay ahora. */
function refrescarVentanas () {
  ventanasSucias = false
  if (!ventanas) return
  const bs = game.state?.buildings || []
  const hechos = []
  for (const b of bs) if (!b.enObra) hechos.push(b)

  let n = 0
  for (const b of hechos) {
    if (n + 2 > ventanas.instanceMatrix.count) break
    const c = centroMundo(b)
    for (const lado of [-1, 1]) {
      _v3.set(c.x + lado * 0.34, 0.72, c.z + 0.5)
      _m4.makeScale(0.17, 0.21, 0.08)
      _m4.setPosition(_v3)
      ventanas.setMatrixAt(n++, _m4)
    }
  }
  ventanas.count = n
  ventanas.instanceMatrix.needsUpdate = true

  // las cuatro luces, repartidas entre los edificios para no amontonarlas
  const paso = Math.max(1, Math.floor(hechos.length / MAX_LUCES_NOCHE))
  for (let i = 0; i < lucesNoche.length; i++) {
    const b = hechos[i * paso]
    if (!b) { lucesNoche[i].userData.activa = false; continue }
    const c = centroMundo(b)
    lucesNoche[i].position.set(c.x, 1.5, c.z)
    lucesNoche[i].userData.activa = true
  }
}

function actualizarDia (dt) {
  momento = (momento + dt / SEG_POR_DIA) % 1
  const { a, b, k } = faseActual(momento)

  // el tinte de batalla entra y sale suave: un corte seco de luz canta muchísimo
  const destinoTinte = enBatalla ? 1 : 0
  if (tinteBatalla !== destinoTinte) {
    tinteBatalla += Math.sign(destinoTinte - tinteBatalla) * Math.min(dt * 1.6, Math.abs(destinoTinte - tinteBatalla))
  }
  const tb = tinteBatalla

  _col.setHex(a.sol); _colB.setHex(b.sol); _col.lerp(_colB, k)
  let intensidad = mezcla(a.int, b.int, k)
  factorNoche = mezcla(a.noche, b.noche, k)
  if (tb > 0) {
    _colB.setHex(PALETA.solBatalla)
    _col.lerp(_colB, tb * 0.7)
    // sol bajo y fuerte: sombras largas y contraluz. La aldea es plana y amable;
    // el campo de batalla tiene que tener relieve y bulto. Pero sin pasarse: si
    // los edificios se van a negro no se distingue cuál está cayendo.
    intensidad = mezcla(intensidad, 1.3, tb)
  }

  if (ctx.sol) {
    const ang = (momento - 0.25) * Math.PI * 2
    const sx = Math.cos(ang) * RADIO_SOL
    const sy = Math.max(Math.sin(ang) * RADIO_SOL, -12)
    // en batalla el sol se baja al horizonte del lado contrario: luz rasante
    ctx.sol.position.set(mezcla(sx, -28, tb), mezcla(sy, 17, tb), mezcla(16, 30, tb))
    ctx.sol.color.copy(_col)
    ctx.sol.intensity = intensidad
  }

  if (luzAmbiente) {
    // baja, pero no tanto que no se lea quién es quién: la legibilidad manda
    luzAmbiente.intensity = intensidadAmbBase * mezcla(mezcla(a.amb, b.amb, k), 0.74, tb)
  }

  // cielo y niebla: la niebla tira hacia PALETA.niebla de día para dar aire
  _colC.setHex(a.cielo); _colB.setHex(b.cielo); _colC.lerp(_colB, k)
  if (tb > 0) { _colB.setHex(PALETA.cieloBatalla); _colC.lerp(_colB, tb) }
  const scene = ctx.scene
  if (scene) {
    if (scene.background && scene.background.isColor) scene.background.copy(_colC)
    if (scene.fog) {
      _colB.setHex(tb > 0 ? PALETA.nieblaBatalla : PALETA.niebla)
      scene.fog.color.copy(_colC).lerp(_colB, (1 - factorNoche) * 0.5)
    }
  }

  // luna y estrellas
  if (luna) {
    const ang = (momento - 0.75) * Math.PI * 2
    const y = Math.sin(ang) * RADIO_SOL
    luna.position.set(Math.cos(ang) * RADIO_SOL, y, -18)
    luna.visible = factorNoche > 0.08 && y > -4
  }
  if (matEstrellas) {
    matEstrellas.opacity = Math.max(0, factorNoche - 0.15) * 1.1
    estrellas.visible = matEstrellas.opacity > 0.01
  }

  // ventanas y luces cálidas
  relojVentanas += dt
  if (ventanasSucias && relojVentanas > 1) { relojVentanas = 0; refrescarVentanas() }
  const encendido = factorNoche > 0.25
  if (ventanas) ventanas.visible = encendido && ventanas.count > 0
  for (const l of lucesNoche) {
    const on = encendido && l.userData.activa
    l.visible = on
    if (on) l.intensity = 1.6 * factorNoche + Math.sin(ctx.tiempo * 3 + l.position.x) * 0.08
  }
}

// ══ MARCADORES EN EL SUELO ═══════════════════════════════════════════════

let casillas = null            // InstancedMesh compartido
const gruposCasillas = []      // [{ celdas, color }]
const MAX_CASILLAS = 320

function montarCasillas () {
  const geo = G.plano.clone()
  geo.rotateX(-Math.PI / 2)
  const m = mat(0xffffff, { transparente: 0.42 }).clone()
  m.depthWrite = false
  m.polygonOffset = true
  m.polygonOffsetFactor = -2
  casillas = new THREE.InstancedMesh(geo, m, MAX_CASILLAS)
  casillas.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  casillas.count = 0
  casillas.castShadow = false
  casillas.receiveShadow = false
  casillas.renderOrder = 2
  aEscena(casillas)
}

function repintarCasillas () {
  if (!casillas) return
  let n = 0
  for (const g of gruposCasillas) {
    _col.setHex(g.color)
    for (const c of g.celdas) {
      if (n >= MAX_CASILLAS) break
      const w = gridAMundo(c.x, c.z)
      _m4.makeScale(0.92, 1, 0.92)
      _v3.set(w.x, 0.06, w.z)
      _m4.setPosition(_v3)
      casillas.setMatrixAt(n, _m4)
      casillas.setColorAt(n, _col)
      n++
    }
  }
  casillas.count = n
  casillas.instanceMatrix.needsUpdate = true
  if (casillas.instanceColor) casillas.instanceColor.needsUpdate = true
}

/**
 * Resalta casillas del tablero (radio de una torre, zona de un aura).
 * @param {{x:number,z:number}[]} lista casillas del GRID
 * @param {number} [color]
 * @returns {() => void} quitar el resaltado
 */
export function marcarCasillas (lista, color = PALETA.hierbaClara) {
  const g = { celdas: (lista || []).filter(Boolean), color }
  gruposCasillas.push(g)
  repintarCasillas()
  return () => {
    const i = gruposCasillas.indexOf(g)
    if (i >= 0) { gruposCasillas.splice(i, 1); repintarCasillas() }
  }
}

// ── anillos ───────────────────────────────────────────────────────────────
const anillos = []
const MAX_ANILLOS = 10

function montarAnillos () {
  const geo = new THREE.RingGeometry(0.84, 1, 44)
  geo.rotateX(-Math.PI / 2)
  for (let i = 0; i < MAX_ANILLOS; i++) {
    const m = mat(0xffffff, { transparente: 0.6 }).clone()
    m.depthWrite = false
    m.side = THREE.DoubleSide
    const malla = new THREE.Mesh(geo, m)
    malla.castShadow = false
    malla.receiveShadow = false
    malla.renderOrder = 3
    malla.visible = false
    malla.userData = { libre: true, modo: 'pulso', radio: 1, vida: 0, vidaMax: 1, base: 0.6 }
    aLaEscena(malla)
    anillos.push(malla)
  }
}

function pillarAnillo () {
  for (const a of anillos) if (a.userData.libre) return a
  return null
}

/**
 * Anillo animado en el suelo: radios de defensa, zonas de influencia.
 * @returns {() => void} quitarlo
 */
export function anillo (x, z, radio = 3, color = PALETA.estandarte) {
  const a = pillarAnillo()
  if (!a) return () => {}
  a.userData.libre = false
  a.userData.modo = 'pulso'
  a.userData.radio = radio
  a.userData.base = 0.55
  a.position.set(x, 0.08, z)
  a.scale.set(radio, 1, radio)
  a.material.color.setHex(color)
  a.material.opacity = a.userData.base
  a.visible = true
  return () => { a.visible = false; a.userData.libre = true }
}

/** Aro que se expande y se desvanece. Para impactos y colocaciones. */
function aro (x, z, radio = 2.4, color = PALETA.hierbaClara, duracion = 0.8) {
  const a = pillarAnillo()
  if (!a) return
  a.userData.libre = false
  a.userData.modo = 'expandir'
  a.userData.radio = radio
  a.userData.vida = a.userData.vidaMax = duracion
  a.position.set(x, 0.09, z)
  a.scale.set(0.2, 1, 0.2)
  a.material.color.setHex(color)
  a.material.opacity = 0.75
  a.visible = true
}
export { aro }

function actualizarAnillos (dt, t) {
  for (const a of anillos) {
    if (a.userData.libre || !a.visible) continue
    const u = a.userData
    if (u.modo === 'pulso') {
      const s = u.radio * (1 + Math.sin(t * 2 + a.position.x) * 0.03)
      a.scale.set(s, 1, s)
      a.material.opacity = u.base + Math.sin(t * 2.4 + a.position.z) * 0.12
    } else {
      u.vida -= dt
      if (u.vida <= 0) { a.visible = false; u.libre = true; continue }
      const k = 1 - u.vida / u.vidaMax
      const s = 0.2 + u.radio * k
      a.scale.set(s, 1, s)
      a.material.opacity = 0.75 * (1 - k)
    }
  }
}

// ── rayos de luz (obra terminada, celebración) ───────────────────────────
const rayos = []
const MAX_RAYOS = 4

function montarRayos () {
  const geo = new THREE.ConeGeometry(0.55, 1, 10, 1, true)
  geo.translate(0, 0.5, 0)
  for (let i = 0; i < MAX_RAYOS; i++) {
    const m = mat(PALETA.oro, { transparente: 0.35 }).clone()
    m.depthWrite = false
    m.side = THREE.DoubleSide
    m.blending = THREE.AdditiveBlending
    const malla = new THREE.Mesh(geo, m)
    malla.castShadow = false
    malla.receiveShadow = false
    malla.renderOrder = 4
    malla.visible = false
    malla.userData = { libre: true, vida: 0, vidaMax: 1 }
    aLaEscena(malla)
    rayos.push(malla)
  }
}

/** Haz de luz vertical: la obra terminada se ve desde toda la aldea. */
export function rayoDeLuz (x, z, color = PALETA.oro, duracion = 1.4) {
  for (const r of rayos) {
    if (!r.userData.libre) continue
    r.userData.libre = false
    r.userData.vida = r.userData.vidaMax = duracion
    r.position.set(x, 0.05, z)
    r.material.color.setHex(color)
    r.visible = true
    return
  }
}

function actualizarRayos (dt) {
  for (const r of rayos) {
    if (r.userData.libre) continue
    r.userData.vida -= dt
    const k = Math.max(0, r.userData.vida / r.userData.vidaMax)
    if (k <= 0) { r.visible = false; r.userData.libre = true; continue }
    r.scale.set(1 + (1 - k) * 0.8, 3 + (1 - k) * 3.5, 1 + (1 - k) * 0.8)
    r.material.opacity = 0.38 * k
    r.rotation.y += dt * 0.8
  }
}

// ── indicadores flotantes sobre edificios ────────────────────────────────
const indicadores = []
const MAX_INDICADORES = 12

function montarIndicadores () {
  // rombo y pie en UNA geometría compartida: doce indicadores, doce mallas
  const sinIndice = (g) => (g.index ? g.toNonIndexed() : g)
  const a = sinIndice(G.esfera.clone().scale(0.36, 0.5, 0.36))
  const b = sinIndice(G.cono.clone().rotateX(Math.PI).scale(0.26, 0.3, 0.26).translate(0, -0.3, 0))
  const geo = mergeGeometries([a, b], false) || a
  for (let i = 0; i < MAX_INDICADORES; i++) {
    const g = new THREE.Mesh(geo, mat(PALETA.oro, { emisivo: 0x553300 }))
    g.castShadow = false
    g.receiveShadow = false
    g.visible = false
    g.userData = { libre: true, base: 1.8, fase: Math.random() * 6, vida: Infinity }
    aEscena(g)
    indicadores.push(g)
  }
}

/**
 * Símbolo flotante sobre un edificio (obra lista, recursos por recoger).
 * @param {number} x @param {number} z coordenadas de MUNDO
 * @param {number} [color] @param {number} [segundos] Infinity = hasta que lo quites
 * @returns {() => void} quitarlo
 */
export function marcarEdificio (x, z, color = PALETA.oro, altura = 1.9, segundos = Infinity) {
  for (const g of indicadores) {
    if (!g.userData.libre) continue
    g.userData.libre = false
    g.userData.base = altura
    g.userData.vida = segundos
    g.position.set(x, altura, z)
    g.material = mat(color, { emisivo: 0x553300 })
    g.visible = true
    return () => { g.visible = false; g.userData.libre = true }
  }
  return () => {}
}

function actualizarIndicadores (dt, t) {
  for (const g of indicadores) {
    if (g.userData.libre) continue
    if (g.userData.vida !== Infinity) {
      g.userData.vida -= dt
      if (g.userData.vida <= 0) { g.visible = false; g.userData.libre = true; continue }
    }
    g.position.y = g.userData.base + Math.abs(Math.sin(t * 2.2 + g.userData.fase)) * 0.28
    g.rotation.y += dt * 1.6
  }
}

/** Sacude la cámara un pelín. Lo justo para que un derrumbe se sienta. */
let sacudida = 0
function temblor (fuerza = 0.15) { sacudida = Math.min(0.5, sacudida + fuerza) }
export { temblor }

/**
 * Entra (o sale) del modo batalla: luz rasante y anaranjada, cielo cargado,
 * niebla sucia, y la aldea callada — sus chimeneas y sus destellos de obra se
 * aparcan para que en el campo solo se vea lo que pasa en el campo.
 */
export function batalla (si) {
  const nuevo = !!si
  if (nuevo === enBatalla) return
  enBatalla = nuevo
  if (nuevo) {
    emisoresAldea = emisores.splice(0)          // las chimeneas de casa, a esperar
  } else {
    emisores.length = 0                          // el humo de las ruinas se va con la batalla
    if (emisoresAldea) { emisores.push(...emisoresAldea); emisoresAldea = null }
  }
}

// ══ AMBIENTE: nubes, pájaros y mariposas ════════════════════════════════
const nubes = []
const pajaros = []
const mariposas = []
let relojPajaros = 12

/**
 * Nubes, pájaros y mariposas son 37 mallas diminutas que están SIEMPRE en
 * pantalla (el cielo no se recorta). Cada una iba por su cuenta: 37 llamadas de
 * dibujo por el decorado. Ahora son tres InstancedMesh: tres llamadas.
 */
let mallaNubes = null, mallaPajaros = null, mallaMariposas = null
const _mI = new THREE.Matrix4()
const _pI = new THREE.Vector3()
const _qI = new THREE.Quaternion()
const _eI = new THREE.Euler()
const _sI = new THREE.Vector3()

/** Escribe la instancia `i` con posición, giro y escala. Sin `new` por frame. */
function instancia (malla, i, px, py, pz, sx, sy, sz, rx, ry, rz) {
  _pI.set(px, py, pz)
  _eI.set(rx || 0, ry || 0, rz || 0)
  _qI.setFromEuler(_eI)
  _sI.set(sx, sy, sz)
  _mI.compose(_pI, _qI, _sI)
  malla.setMatrixAt(i, _mI)
}

function montarNubes (scene) {
  mallaNubes = new THREE.InstancedMesh(G.esfera, mat(PALETA.nieve), 5 * 3)
  mallaNubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mallaNubes.castShadow = false
  mallaNubes.receiveShadow = false
  mallaNubes.frustumCulled = false
  for (let i = 0; i < 5; i++) {
    const bultos = []
    for (let j = 0; j < 3; j++) {
      bultos.push({
        dx: (j - 1) * azar(1.4, 2.2), dy: azar(-0.3, 0.3), dz: azar(-0.8, 0.8),
        sx: azar(3, 5), sy: azar(1.2, 1.8), sz: azar(2.4, 3.4)
      })
    }
    nubes.push({ x: azar(-30, 30), y: azar(11, 15), z: azar(-30, 30), v: azar(0.25, 0.6), bultos })
  }
  colocarNubes()
  scene.add(mallaNubes)
}

function colocarNubes () {
  if (!mallaNubes) return          // las nubes ya no se montan: ver montarNubes
  for (let i = 0; i < nubes.length; i++) {
    const n = nubes[i]
    for (let j = 0; j < 3; j++) {
      const b = n.bultos[j]
      instancia(mallaNubes, i * 3 + j, n.x + b.dx, n.y + b.dy, n.z + b.dz, b.sx, b.sy, b.sz, 0, 0, 0)
    }
  }
  mallaNubes.instanceMatrix.needsUpdate = true
}

function montarPajaros (scene) {
  const geoAla = new THREE.ConeGeometry(0.22, 0.7, 3)
  geoAla.rotateZ(Math.PI / 2)
  mallaPajaros = new THREE.InstancedMesh(geoAla, mat(PALETA.rocaOscura), 5 * 2)
  mallaPajaros.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mallaPajaros.castShadow = false
  mallaPajaros.receiveShadow = false
  mallaPajaros.frustumCulled = false
  mallaPajaros.count = 0
  for (let i = 0; i < 5; i++) {
    pajaros.push({ libre: true, x: 0, y: 0, z: 0, giro: 0, vx: 0, vz: 0, fase: Math.random() * 6 })
  }
  scene.add(mallaPajaros)
}

/** Reescribe las alas de los pájaros que vuelan; los libres se mandan al limbo. */
function colocarPajaros (t) {
  let usadas = 0
  for (let i = 0; i < pajaros.length; i++) {
    const p = pajaros[i]
    if (p.libre) continue
    const flap = Math.sin(t * 11 + p.fase) * 0.6
    instancia(mallaPajaros, usadas++, p.x - Math.cos(p.giro) * 0.3, p.y, p.z + Math.sin(p.giro) * 0.3, 1, 1, 1, 0, p.giro, flap)
    instancia(mallaPajaros, usadas++, p.x + Math.cos(p.giro) * 0.3, p.y, p.z - Math.sin(p.giro) * 0.3, 1, 1, 1, 0, p.giro + Math.PI, -flap)
  }
  mallaPajaros.count = usadas
  mallaPajaros.visible = usadas > 0
  if (usadas) mallaPajaros.instanceMatrix.needsUpdate = true
}

/** Suelta una bandada que cruza el cielo. */
function bandada () {
  const a = Math.random() * Math.PI * 2
  const vx = Math.cos(a) * 4.5
  const vz = Math.sin(a) * 4.5
  let n = 0
  for (const p of pajaros) {
    if (!p.libre || n >= 3) continue
    p.libre = false
    p.vx = vx; p.vz = vz
    p.x = -vx * 6 + azar(-3, 3); p.y = azar(8, 13); p.z = -vz * 6 + azar(-3, 3)
    p.giro = -a
    n++
  }
}

function montarMariposas (scene) {
  mallaMariposas = new THREE.InstancedMesh(G.plano, mat(PALETA.yeso, { transparente: 0.9 }), 6 * 2)
  mallaMariposas.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mallaMariposas.castShadow = false
  mallaMariposas.receiveShadow = false
  mallaMariposas.frustumCulled = false
  mallaMariposas.count = 0
  for (let i = 0; i < 6; i++) {
    mariposas.push({ viva: false, cx: 0, cz: 0, r: azar(0.8, 2), fase: Math.random() * 6, v: azar(0.6, 1.2) })
  }
  scene.add(mallaMariposas)
}

/** Las mariposas revolotean donde haya granjas; si no hay, no salen. */
function recolocarMariposas () {
  if (!mariposas.length) return
  const granjas = (game.state?.buildings || []).filter(b => !b.enObra && /granja|molino|huerto|campo/i.test(b.tipo || ''))
  for (let i = 0; i < mariposas.length; i++) {
    const b = granjas[i % (granjas.length || 1)]
    if (!b) { mariposas[i].viva = false; continue }
    const c = centroMundo(b)
    mariposas[i].cx = c.x
    mariposas[i].cz = c.z
    mariposas[i].viva = true
  }
}

function actualizarAmbiente (dt, t) {
  if (!ambiente) return
  // pájaros y mariposas son de la aldea en paz: en un asalto sobran, y de paso
  // se ahorran dos llamadas de dibujo justo cuando más falta hacen
  if (enBatalla) {
    if (mallaPajaros) mallaPajaros.visible = false
    if (mallaMariposas) mallaMariposas.visible = false
    return
  }
  if (mallaPajaros) mallaPajaros.visible = true
  if (mallaMariposas) mallaMariposas.visible = true
  let mueveNubes = false
  for (const n of nubes) {
    n.x += n.v * dt
    if (n.x > 36) n.x = -36
    mueveNubes = true
  }
  if (mueveNubes) colocarNubes()

  relojPajaros -= dt
  if (relojPajaros <= 0) { relojPajaros = azar(18, 40); if (factorNoche < 0.4) bandada() }
  for (const p of pajaros) {
    if (p.libre) continue
    p.x += p.vx * dt
    p.z += p.vz * dt
    if (Math.abs(p.x) > 45 || Math.abs(p.z) > 45) p.libre = true
  }
  if (mallaPajaros) colocarPajaros(t)

  if (mallaMariposas) {
    let usadas = 0
    for (const m of mariposas) {
      if (!m.viva) continue
      const f = t * m.v + m.fase
      const x = m.cx + Math.cos(f) * m.r
      const y = 0.9 + Math.sin(f * 2.3) * 0.35
      const z = m.cz + Math.sin(f * 1.3) * m.r
      const flap = Math.sin(t * 16 + m.fase) * 0.9
      instancia(mallaMariposas, usadas++, x - 0.022, y, z, 0.22, 0.22, 0.22, 0, -f + flap, 0)
      instancia(mallaMariposas, usadas++, x + 0.022, y, z, 0.22, 0.22, 0.22, 0, -f - flap, 0)
    }
    mallaMariposas.count = usadas
    mallaMariposas.visible = usadas > 0
    if (usadas) mallaMariposas.instanceMatrix.needsUpdate = true
  }
}

// ══ REACCIÓN A LOS EVENTOS ═══════════════════════════════════════════════

let ultimaMota = 0

/**
 * Los efectos de la ALDEA se apagan mientras se juega una batalla: el campo de
 * batalla está en la misma escena, y una mota de trigo o un destello de obra
 * terminada saliendo entre los soldados no se entiende ni se perdona.
 */
const on = (ev, fn) => events.on(ev, (p) => { if (!enBatalla) fn(p) })

function escucharEventos () {
  on(EV.BUILD_PLACED, (p) => {
    const b = p?.building
    if (!b) return
    const c = centroMundo(b)
    polvo(c.x, c.z, 18)
    aro(c.x, c.z, 2.6, PALETA.hierbaClara, 0.9)
    ventanasSucias = true
  })

  on(EV.BUILD_COMPLETED, (p) => {
    const b = p?.building
    if (!b) return
    const c = centroMundo(b)
    destello(c.x, c.z, PALETA.oro, 1)
    rayoDeLuz(c.x, c.z, PALETA.oro, 1.6)
    confeti(c.x, c.z, 20)
    aro(c.x, c.z, 3, PALETA.oro, 1)
    marcarEdificio(c.x, c.z, PALETA.oro, 2, 15)
    ventanasSucias = true
    recolocarMariposas()
  })

  on(EV.BUILD_UPGRADED, (p) => {
    const b = p?.building
    if (!b) return
    const c = centroMundo(b)
    destello(c.x, c.z, PALETA.oro, 1.2)
    chispas(c.x, c.z, PALETA.oro, 1.2)
    aro(c.x, c.z, 2.4, PALETA.oro, 0.8)
  })

  on(EV.BUILD_DEMOLISHED, (p) => {
    const b = (game.state?.buildings || []).find(x => x.id === p?.buildingId)
    if (b) { const c = centroMundo(b); explosion(c.x, c.z, 0.7) }
    ventanasSucias = true
  })

  on(EV.RESOURCE_GAINED, (p) => {
    if (!p || p.x == null || p.z == null) return
    if (ctx.tiempo - ultimaMota < 0.05) return    // llueven: no hace falta una por cada grano
    ultimaMota = ctx.tiempo
    const c = gridAMundo(p.x, p.z)
    motaRecurso(c.x, c.z, p.tipo)
  })

  const celebrar = () => {
    const bs = (game.state?.buildings || []).filter(b => !b.enObra)
    let n = 0
    for (const b of bs) {
      if (n >= 8) break
      const c = centroMundo(b)
      destello(c.x, c.z, PALETA.oro, 1.4)
      n++
    }
    confeti(0, 0, 40)
    rayoDeLuz(0, 0, PALETA.oro, 2.2)
    aro(0, 0, 9, PALETA.oro, 1.6)
    if (n === 0) destello(0, 0, PALETA.oro, 1.2)
  }
  on(EV.AGE_ADVANCED, celebrar)
  on(EV.LEVEL_UP, celebrar)
  on(EV.QUEST_COMPLETED, () => { destello(0, 0, PALETA.oro, 1.4); confeti(0, 0, 16) })

  const destrozos = (p) => {
    // si se perdió o hubo bajas, la aldea humea un rato
    const malo = p && (p.victoria === false || (p.perdidas && Object.keys(p.perdidas).length) || (p.bajas && Object.keys(p.bajas).length))
    if (!malo) return
    const bs = (game.state?.buildings || []).filter(b => !b.enObra)
    const cuantos = Math.min(3, bs.length || 1)
    for (let i = 0; i < cuantos; i++) {
      const b = bs[(Math.random() * bs.length) | 0]
      const c = b ? centroMundo(b) : { x: azar(-6, 6), z: azar(-6, 6) }
      explosion(c.x, c.z, 1.1)
      fuego(c.x, c.z, azar(10, 18))
    }
  }
  on(EV.DEFENSE_RESOLVED, destrozos)
  on(EV.RAID_RESOLVED, destrozos)

  on(EV.STATE_LOADED, () => { ventanasSucias = true; recolocarMariposas() })
  on(EV.VILLAGER_SPAWNED, (p) => {
    const v = p?.villager
    if (!v) return
    const c = gridAMundo(v.x ?? 0, v.z ?? 0)
    destello(c.x, c.z, PALETA.hierbaClara, 0.6)
  })
}

// ══ ARRANQUE ═════════════════════════════════════════════════════════════

/** API pública, también accesible en `ctx.fx`. */
const API = {
  polvo, humo, humoContinuo, fuego, chispas, destello, hojas, explosion,
  motaRecurso, marcarCasillas, anillo, aro, rayoDeLuz, marcarEdificio,
  temblor, mundoDe, astillas, estela, impacto, caida, confeti, batalla, salpicadura,
  get enBatalla () { return enBatalla },
  get momentoDelDia () { return momento },
  get esDeNoche () { return factorNoche > 0.5 },
  /** Salta a un momento del día (0..1). Útil para depurar. */
  fijarMomento (t) { momento = ((t % 1) + 1) % 1 }
}

export function init () {
  cuandoListo((c) => {
    calidad = c.calidad || 'medio'
    escala = calidad === 'bajo' ? 0.5 : calidad === 'alto' ? 1.3 : 1
    ambiente = calidad !== 'bajo'

    const max = calidad === 'bajo' ? 320 : calidad === 'alto' ? 1100 : 700
    humos = crearSistema(max, false)
    brillos = crearSistema(Math.round(max * 0.6), true)
    // A LA ESCENA, no a la aldea: durante una batalla la aldea entera se apaga
    // (`ctx.raizAldea.visible = false`) y con ella se apagaban el polvo, las
    // chispas y el humo. El campo de batalla se quedaba sin una sola partícula.
    const padre = c.scene || null
    if (padre) { padre.add(humos.puntos); padre.add(brillos.puntos) } else { aEscena(humos.puntos); aEscena(brillos.puntos) }

    montarCasillas()
    montarAnillos()
    montarRayos()
    montarIndicadores()

    const scene = c.scene
    if (scene) {
      // la luz ambiente ya la puso scene.js: la buscamos para atenuarla de noche
      scene.traverse((o) => {
        if (!luzAmbiente && (o.isAmbientLight || o.isHemisphereLight)) luzAmbiente = o
      })
      if (!luzAmbiente) {
        luzAmbiente = new THREE.AmbientLight(0xffffff, 0.7)
        scene.add(luzAmbiente)
      }
      intensidadAmbBase = luzAmbiente.intensity || 1
      if (!scene.background || !scene.background.isColor) scene.background = new THREE.Color(PALETA.cielo)
      montarCielo(scene)
      montarLucesNoche(scene)
      // Las nubes, FUERA. Volaban a 11-15 de altura y la cámara está a 27: se
      // cruzaban por delante de la aldea y, sin la niebla que antes las
      // disimulaba, tapaban media pantalla con una lámina blanca. Pájaros y
      // mariposas se quedan: vuelan bajos y no estorban.
      if (ambiente) { montarPajaros(scene); montarMariposas(scene) }
    }

    recolocarMariposas()
    refrescarVentanas()

    // El mapa de sombras es una escena entera dibujada otra vez. Se refresca en
    // frames alternos: la sombra va 16 ms por detrás, que no lo ve nadie, y se
    // ahorra media pasada de dibujado por frame.
    if (c.renderer) c.renderer.shadowMap.autoUpdate = false
    let frameSombra = 0

    onFrame((dt, t) => {
      if (dt > 0.25) dt = 0.25            // si el móvil se durmió, no dispares los efectos

      if (c.renderer && c.renderer.shadowMap.enabled) {
        frameSombra = (frameSombra + 1) & 1
        c.renderer.shadowMap.needsUpdate = frameSombra === 0
      }

      refrescarVista()

      // emisores continuos de humo y fuego
      for (let i = emisores.length - 1; i >= 0; i--) {
        const e = emisores[i]
        e.fin -= dt
        if (e.fin <= 0) { emisores.splice(i, 1); continue }
        e.acum += dt
        if (e.acum >= e.periodo) {
          e.acum = 0
          // una chimenea al otro lado del valle no pinta nada: ni se emite
          if (!seVe(e.x, e.altura, e.z)) continue
          humo(e.x, e.z, e.altura, e.color)
          if (e.fuego && brillos) {
            brillos.emitir(e.x + azar(-0.2, 0.2), 0.35, e.z + azar(-0.2, 0.2), {
              color: Math.random() < 0.5 ? 0xff9231 : 0xffd24a,
              vx: azar(-0.2, 0.2), vy: azar(1, 2), vz: azar(-0.2, 0.2),
              vida: azar(0.4, 0.9), grav: 0.4, roce: 0.5,
              tam0: azar(0.2, 0.34), tam1: 0.03, alfa: 1
            })
          }
        }
      }

      humos.actualizar(dt)
      brillos.actualizar(dt)
      actualizarDia(dt)
      actualizarAnillos(dt, t)
      actualizarRayos(dt)
      actualizarIndicadores(dt, t)
      actualizarAmbiente(dt, t)

      // temblor: se deshace el desvío del frame anterior para no desplazar la
      // cámara poco a poco; quien la controle sigue mandando sobre ella
      if (ctx.camera) {
        ctx.camera.position.sub(_desvioCam)
        if (sacudida > 0.001) {
          sacudida = Math.max(0, sacudida - dt * 0.9)
          _desvioCam.set(Math.sin(t * 60) * sacudida * 0.12, Math.cos(t * 71) * sacudida * 0.09, 0)
        } else {
          sacudida = 0
          _desvioCam.set(0, 0, 0)
        }
        ctx.camera.position.add(_desvioCam)
      }
    })

    ctx.fx = API
  })

  escucharEventos()
  return API
}

export default API
