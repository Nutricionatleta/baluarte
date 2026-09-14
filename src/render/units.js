import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETA, CONFIG } from '../core/config.js'
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { gridAMundo, centroDe } from '../core/grid.js'
import { ctx, cuandoListo, onFrame, aEscena } from './ctx.js'
import { mat, G, pieza } from './mats.js'

/**
 * LA GENTE: aldeanos trajinando y tropa formada.
 *
 * Tres ideas gobiernan este fichero:
 *   1. SILUETA. A vista de pájaro no se ve la cara: se ve el bulto. Cada unidad
 *      tiene un perfil distinto (la lanza larga, el arco en arco, la ballesta
 *      en cruz, el hábito sin piernas, el caballo ancho, la máquina con ruedas).
 *   2. PROTOTIPO + CLON. Cada tipo de figura se construye UNA vez y se clona.
 *      La variedad (piel, tinte de la túnica, pelo) sale de cambiar materiales
 *      YA compartidos en el clon, no de crear mallas nuevas.
 *   3. NI UN `new` DENTRO DEL FRAME. La animación solo toca rotaciones y
 *      posiciones de grupos que ya existen.
 *
 * Este módulo solo MIRA `game.state`; los cambios los pide la simulación.
 */

// ── medidas de la figura: un aldeano mide 0.9 casillas de alto por 0.37 de
// ancho. Esa proporción de muñeco (2,5 a 1) es lo que lo hace legible desde
// la cámara del juego; estilizarlo lo convierte en un palo.
const CADERA = 0.30
const TAU = Math.PI * 2

// Techo de figuras a la vez. Es una red de seguridad, no el recorte de verdad:
// ese lo hace la cámara (lo que no se ve no se dibuja ni se anima) y el nivel de
// detalle (lo lejano va en una sola malla). Antes había que esconder a 32 de 50
// aldeanos para llegar a 60 fps; ahora salen todos.
const TOPE_FIGURAS = { bajo: 60, medio: 120, alto: 200 }

// ── geometrías propias (las que no están en mats.G), creadas una sola vez ──
const geoCache = new Map()
const geoL = (clave, crear) => {
  if (!geoCache.has(clave)) geoCache.set(clave, crear())
  return geoCache.get(clave)
}
/**
 * Prisma de cantos verticales redondeados. Es el volumen con el que está hecha
 * toda la gente del juego: una caja pelada se ve tosca a cualquier tamaño y un
 * cilindro no tiene "frente". Con los cuatro cantos cortados la figura se ve
 * modelada y no pierde ni una cara plana.
 * Cuesta 28 triángulos en vez de 12, así que se reserva para los VOLÚMENES
 * grandes (cabeza, torso, muslos); los detallitos siguen con `G.caja`.
 */
function prismaR (chaflan) {
  const h = 0.5
  const c = Math.min(0.45, chaflan)
  const s = new THREE.Shape()
  s.moveTo(-h + c, -h); s.lineTo(h - c, -h); s.lineTo(h, -h + c); s.lineTo(h, h - c)
  s.lineTo(h - c, h); s.lineTo(-h + c, h); s.lineTo(-h, h - c); s.lineTo(-h, -h + c)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 1, steps: 1 })
  g.rotateX(-Math.PI / 2)      // la extrusión sale en Z; la altura la queremos en Y
  g.translate(0, -0.5, 0)      // centrado en el origen como el resto de geometrías
  g.computeVertexNormals()
  return g
}

const GL = {
  /** El volumen de siempre: caja con los cantos comidos. Torso, cabeza, muslos. */
  get cajaR () { return geoL('cajaR', () => prismaR(0.17)) },
  /** Chaflán exagerado: casi un tonel. Fardos, sacos y cabezas muy redondas. */
  /** Cabeza: el chaflán más marcado, que es lo que más se mira. */
  get cabezaR () { return geoL('cabezaR', () => prismaR(0.24)) },
  get bloqueR () { return geoL('bloqueR', () => prismaR(0.3)) },
  /** Tronco de cono suave: faldones pequeños, capuchas, capacetes. */
  get campana () { return geoL('campana', () => new THREE.CylinderGeometry(0.40, 0.5, 1, 6)) },
  /** El mismo faldón con ocho caras: el que se ve de cerca, ya redondo. */
  get campana8 () { return geoL('campana8', () => new THREE.CylinderGeometry(0.40, 0.5, 1, 8)) },
  /** Campana muy abierta: el hábito del monje y el ala de los sombreros. */
  get campanaAncha () { return geoL('campanaAncha', () => new THREE.CylinderGeometry(0.26, 0.5, 1, 8)) },
  /** Cúpula de ocho gajos: cascos, hombros y remates. Redonda y barata. */
  get cupula () { return geoL('cupula', () => new THREE.SphereGeometry(0.5, 8, 2, 0, TAU, 0, Math.PI / 2)) },
  /** Arco del arquero: un toro abierto, la silueta más reconocible que hay. */
  get arco () { return geoL('arco', () => new THREE.TorusGeometry(0.5, 0.075, 3, 8, Math.PI * 0.95)) },
  /** Aro fino: la corona de pelo del monje. */
  get aro () { return geoL('aro', () => new THREE.TorusGeometry(0.5, 0.09, 3, 8)) },
  /** Llanta de hierro: fina, o la rueda parece un neumático. */
  get llanta () { return geoL('llanta', () => new THREE.TorusGeometry(0.5, 0.045, 3, 8)) },
  /** Rueda de carro: cilindro tumbado con radios ya insinuados por las caras. */
  get rueda () { return geoL('rueda', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 8)) },
  /** Disco de ocho caras: escudos redondos. Tumbado con rz = PI/2. */
  get disco () { return geoL('disco', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 8)) }
}

// ── librea: los materiales que cambian de una figura a otra ────────────────
let libreas = null
function paletas () {
  if (libreas) return libreas
  libreas = {
    piel: [mat(PALETA.pielClara), mat(PALETA.pielMedia), mat(PALETA.pielTostada), mat(PALETA.pielOscura)],
    // OJO: esta variedad es SOLO para el aldeano sin oficio. Va toda en tonos
    // apagados y terrosos a propósito: los colores saturados están reservados a
    // los gremios (ver COLOR_OFICIO), y si un paisano se vistiera de morado
    // pasaría por minero desde la cámara del juego.
    ropa: [
      mat(PALETA.ropaCruda), mat(PALETA.ropaAldeano), mat(PALETA.cueroClaro),
      mat(PALETA.calzas), mat(PALETA.paja), mat(PALETA.adobe), mat(PALETA.tierra)
    ],
    ropaOsc: [
      mat(PALETA.cuero), mat(PALETA.calzas), mat(PALETA.copaPino),
      mat(PALETA.tierra), mat(PALETA.piedraOscura), mat(PALETA.tejadoOscuro), mat(PALETA.madera)
    ],
    pelo: [mat(PALETA.pelo), mat(PALETA.peloClaro), mat(PALETA.peloCano), mat(PALETA.tejadoOscuro)],
    bando: { jugador: mat(PALETA.estandarte), enemigo: mat(PALETA.enemigo) },
    bandoOsc: { jugador: mat(PALETA.tejadoAzul), enemigo: mat(PALETA.enemigoOscuro) }
  }
  return libreas
}

/**
 * CÓDIGO DE COLOR POR OFICIO. Lo primero que se lee desde la cámara del juego
 * no es la cara ni la herramienta: es la mancha de color de la túnica. Cada
 * oficio tiene la suya, siempre la misma, y ninguna es azul ni roja porque esos
 * dos son los bandos de la tropa. La variedad de cada aldeano se va a la piel,
 * al pelo y a las calzas, que no llevan información.
 */
const COLOR_OFICIO = {
  lenador: PALETA.oficioLena,        // verde bosque + hacha al hombro
  cantero: PALETA.oficioPiedra,      // gris cantera + pico en alto
  granjero: PALETA.oficioComida,     // amarillo mies + sombrero de paja
  minero: PALETA.oficioOro,          // marrón galería + casco y candil
  constructor: PALETA.oficioObra     // naranja de obra + escalera al hombro
}

/** Malla con "rol": el rol dice qué materiales se le cambian a cada clon. */
function trozo (geometria, material, o = {}, rol = null) {
  const m = pieza(geometria, material, o)
  if (rol) m.userData.rol = rol
  if (o.detalle) { m.userData.detalle = 1; m.castShadow = false; m.receiveShadow = false }
  return m
}

const hueso = (nombre, x, y, z) => {
  const g = new THREE.Group()
  g.name = nombre
  g.position.set(x || 0, y || 0, z || 0)
  return g
}

// ════════════════════════════════════════════════════════════════════════
//  CONSTRUCTORES DE FIGURAS
// ════════════════════════════════════════════════════════════════════════

/**
 * Esqueleto común de todo bípedo.
 *
 * PROPORCIÓN DE JUGUETE (Clash of Clans pasado por Stellar Settlers): cabezón,
 * de hombros redondos y anchos, sin cuello, con manos de bola y botas grandes.
 * No es capricho: a 35 píxeles de alto lo único que se lee de una figura es la
 * relación entre tres manchas —cabeza, tronco y lo que lleva en las manos—, y
 * cuanto más grandes son la cabeza y las manos, más se lee. Estilizarla la
 * convierte en un palo.
 */
function esqueleto (cfg = {}) {
  const raiz = new THREE.Group()
  const mCalza = cfg.calza || mat(PALETA.calzas)
  const mBota = cfg.bota || mat(PALETA.cuero)
  const mTorso = cfg.torso || mat(PALETA.ropaAldeano)
  const mPiel = cfg.piel || mat(PALETA.pielClara)
  const rolTorso = cfg.rolTorso === null ? null : (cfg.rolTorso || 'ropa')
  const rolBrazo = cfg.rolBrazo === null ? null : (cfg.rolBrazo || rolTorso)

  const piernaI = hueso('piernaI', -0.082, CADERA, 0)
  const piernaD = hueso('piernaD', 0.082, CADERA, 0)
  if (!cfg.sinPiernas) {
    for (const g of [piernaI, piernaD]) {
      g.add(trozo(G.caja, mCalza, { y: -0.115, sx: 0.105, sy: 0.23, sz: 0.11 }, cfg.rolCalza || null))
      // botaza: el pie marcado es lo que impide que el paso parezca un patín
      g.add(trozo(G.caja, mBota, { y: -0.258, z: 0.028, sx: 0.125, sy: 0.07, sz: 0.165 }))
    }
  }
  raiz.add(piernaI, piernaD)

  const cuerpo = hueso('cuerpo', 0, CADERA, 0)
  raiz.add(cuerpo)

  const torso = trozo(GL.cajaR, mTorso, { y: 0.165, sx: 0.315, sy: 0.22, sz: 0.215 }, rolTorso)
  torso.name = 'torso'
  cuerpo.add(torso)
  // hombros de cúpula: el remate redondo que convierte la caja en un muñeco.
  // Es además lo primero que se ve desde arriba, así que va del color de la ropa.
  if (cfg.hombros !== false) {
    cuerpo.add(trozo(GL.cupula, cfg.hombroMat || mTorso,
      { y: 0.275, sx: 0.365, sy: 0.105, sz: 0.245 }, cfg.rolHombro ?? rolTorso))
  }

  // faldón: lo que convierte un muñeco en un medieval con túnica
  if (cfg.faldon !== false) {
    const alto = cfg.faldonAlto ?? 0.2
    cuerpo.add(trozo(GL.campana, cfg.faldonMat || mTorso,
      { y: 0.07 - alto / 2, sx: 0.37, sy: alto, sz: 0.3 }, cfg.rolFaldon ?? rolTorso))
  }
  if (cfg.cinturon !== false) {
    cuerpo.add(trozo(G.caja, cfg.cinturonMat || mat(PALETA.cuero),
      { y: 0.068, sx: 0.36, sy: 0.042, sz: 0.25 }, cfg.rolCinturon || null))
  }

  // sin cuello a propósito: la cabeza descansa sobre los hombros redondos, que
  // es lo que hace la cara de juguete. Un cuello estiliza, y aquí no interesa.
  const cabeza = hueso('cabeza', 0, 0.325, 0)
  cuerpo.add(cabeza)
  // LA CABEZA ES UNA CARETA. El cráneo lleva el color del TOCADO (capucha, pelo,
  // almófar) y la cara es un panel de piel pegado delante. Se hace así porque la
  // cámara mira desde arriba: una capucha puesta encima de una cabeza de carne
  // tapa justo la coronilla y deja un ladrillo de piel del ancho del cuerpo, y
  // la figura se lee como un tótem. Con la careta se ve tocado Y cara, y encima
  // cuesta ochenta triángulos menos que modelar la capucha hueca.
  const craneo = trozo(GL.cabezaR, cfg.craneoMat || mPiel,
    { y: 0.125, sx: 0.295, sy: 0.275, sz: 0.28 }, cfg.rolCraneo === null ? null : (cfg.rolCraneo || 'piel'))
  craneo.name = 'craneo'
  cabeza.add(craneo)
  cabeza.add(trozo(G.caja, mPiel, { y: 0.09, z: 0.145, sx: 0.2, sy: 0.175, sz: 0.03 }, 'piel'))
  // dos ojos: desde la cámara del juego no se ven, pero de cerca son lo que hace
  // que el muñeco MIRE. Van como detalle: en calidad baja ni se generan.
  for (const x of [-0.052, 0.052]) {
    cabeza.add(trozo(G.caja, mat(PALETA.carbon), { x, y: 0.125, z: 0.162, sx: 0.034, sy: 0.05, sz: 0.016, detalle: true }))
  }

  const brazoI = hueso('brazoI', -0.2, 0.265, 0)
  const brazoD = hueso('brazoD', 0.2, 0.265, 0)
  for (const b of [brazoI, brazoD]) {
    b.add(trozo(G.caja, cfg.brazoMat || mTorso, { y: -0.095, sx: 0.088, sy: 0.19, sz: 0.098 }, rolBrazo))
    const mano = hueso(b === brazoI ? 'manoI' : 'manoD', 0, -0.215, 0)
    // manopla de bola: se ve a cualquier distancia y da el aire de juguete
    mano.add(trozo(G.esfera, mPiel, { sx: 0.125, sy: 0.115, sz: 0.125 }, 'piel'))
    b.add(mano)
  }
  cuerpo.add(brazoI, brazoD)

  return { raiz, cuerpo, torso, cabeza, piernaI, piernaD, brazoI, brazoD,
    manoI: brazoI.getObjectByName('manoI'), manoD: brazoD.getObjectByName('manoD') }
}

/** Caperuza puntiaguda: la firma del aldeano medieval. */
/**
 * El pico y la esclavina de la capucha. El casquete en sí es el propio cráneo
 * (ver esqueleto): aquí solo va lo que sobresale de la cabeza, que es lo que
 * de verdad dibuja la silueta.
 */
function caperuza (cabeza, material, rol = null) {
  const m = material || mat(PALETA.cuero)
  // el pico cae hacia atrás: si apunta al cielo, el aldeano parece un duende
  cabeza.add(trozo(G.cono6, m, { y: 0.26, z: -0.15, rx: 1.0, sx: 0.17, sy: 0.28, sz: 0.17 }, rol))
  // esclavina: la capita corta que cae sobre los hombros
  cabeza.add(trozo(GL.campana, m, { y: -0.045, sx: 0.35, sy: 0.08, sz: 0.32 }, rol))
}

/** Melena sencilla para los que van descubiertos. */
/** Melena que asoma por los lados: el cráneo ya va teñido de pelo. */
function pelambre (cabeza) {
  for (const x of [-0.14, 0.14]) {
    cabeza.add(trozo(G.caja, mat(PALETA.pelo), { x, y: 0.045, z: 0.01, sx: 0.045, sy: 0.13, sz: 0.2 }, 'pelo'))
  }
}

// ── herramientas de oficio ────────────────────────────────────────────────
// Desde arriba, la herramienta es la MITAD de la silueta: por eso van todas
// grandes, altas y asomando por fuera del contorno del cuerpo.

/** Hacha al hombro: mango largo caído hacia atrás y hoja ancha de hierro arriba. */
function hacha (mano) {
  mano.add(trozo(G.cilindro6, mat(PALETA.madera), { y: 0.2, z: -0.13, rx: -0.55, sx: 0.036, sy: 0.68, sz: 0.036 }))
  mano.add(trozo(G.caja, mat(PALETA.hierro), { y: 0.5, z: -0.33, rx: -0.55, sx: 0.05, sy: 0.23, sz: 0.15 }))
  mano.add(trozo(G.cono, mat(PALETA.aceroClaro),
    { y: 0.5, z: -0.42, rx: Math.PI / 2 - 0.55, rz: Math.PI / 4, sx: 0.2, sy: 0.09, sz: 0.2 }))
}

/** Pico de cantero, en alto: la cabeza cruza el aire por encima del hombro. */
function pico (mano) {
  mano.add(trozo(G.cilindro6, mat(PALETA.madera), { y: 0.18, z: -0.1, rx: -0.45, sx: 0.034, sy: 0.6, sz: 0.034 }))
  mano.add(trozo(G.caja, mat(PALETA.hierro), { y: 0.46, z: -0.24, rz: 0.28, sx: 0.44, sy: 0.045, sz: 0.05 }))
  mano.add(trozo(G.cono6, mat(PALETA.aceroClaro),
    { x: 0.21, y: 0.52, z: -0.24, rz: -1.28, sx: 0.055, sy: 0.12, sz: 0.055, detalle: true }))
}

/** Hoz: media luna de hierro bien ancha. Con el sombrero no hay confusión posible. */
function hoz (mano) {
  mano.add(trozo(G.caja, mat(PALETA.madera), { y: -0.07, sx: 0.038, sy: 0.18, sz: 0.04 }))
  mano.add(trozo(G.caja, mat(PALETA.aceroClaro), { y: 0.0, z: 0.11, rx: 0.95, sx: 0.035, sy: 0.24, sz: 0.03 }))
  mano.add(trozo(G.caja, mat(PALETA.aceroClaro), { y: 0.06, z: 0.25, rx: 1.75, sx: 0.035, sy: 0.2, sz: 0.03 }))
}

/** Candil del minero: la mancha amarilla que lo delata en la boca de la mina. */
function candil (mano) {
  mano.add(trozo(G.caja, mat(PALETA.hierro), { y: -0.08, sx: 0.022, sy: 0.12, sz: 0.022, detalle: true }))
  mano.add(trozo(G.caja, mat(PALETA.brasa), { y: -0.18, sx: 0.11, sy: 0.13, sz: 0.11 }))
}

/** Martillo de constructor: mazo gordo, que se vea el golpe. */
function martillo (mano) {
  mano.add(trozo(G.cilindro6, mat(PALETA.madera), { y: -0.1, sx: 0.032, sy: 0.24, sz: 0.032 }))
  mano.add(trozo(G.caja, mat(PALETA.hierro), { y: -0.23, sx: 0.075, sy: 0.085, sz: 0.17 }))
}

/**
 * Escalera al hombro. Es la silueta más clara que existe desde arriba: dos
 * largueros y tres peldaños cruzando por fuera del cuerpo. Va colgada del
 * torso, no de la mano, para que no baile con el braceo.
 */
function escalera (cuerpo) {
  const g = hueso('escalera', -0.2, 0.26, -0.02)
  g.rotation.z = 0.42
  g.rotation.x = -0.22
  const mMad = mat(PALETA.tronco)
  for (const x of [-0.11, 0.11]) g.add(trozo(G.caja, mMad, { x, sx: 0.05, sy: 0.92, sz: 0.05 }))
  for (const y of [-0.26, 0, 0.26]) g.add(trozo(G.caja, mMad, { y, sx: 0.24, sy: 0.04, sz: 0.04, detalle: true }))
  cuerpo.add(g)
}

/** Sombrero de paja de ala ancha: un disco que se ve desde arriba, que es lo que importa. */
function sombreroPaja (cabeza) {
  cabeza.add(trozo(GL.campanaAncha, mat(PALETA.paja), { y: 0.265, sx: 0.6, sy: 0.055, sz: 0.6 }))
  cabeza.add(trozo(G.cono8, mat(PALETA.paja), { y: 0.33, sx: 0.24, sy: 0.15, sz: 0.24 }))
}

/**
 * La carga, AL HOMBRO. Antes iba delante del pecho y desde la cámara la tapaba
 * la propia cabeza: el aldeano cargado se veía igual que el vacío. Encima del
 * hombro y cruzada, asoma por los dos costados y se lee de lejos.
 */
function fardo (cuerpo) {
  const g = hueso('fardo', 0.0, 0.4, -0.21)
  const saco = trozo(GL.campana8, mat(PALETA.paja), { x: -0.02, sx: 0.27, sy: 0.28, sz: 0.24 })
  saco.name = 'saco'
  const t1 = trozo(G.cilindro6, mat(PALETA.tronco), { y: 0.03, rz: Math.PI / 2, sx: 0.085, sy: 0.62, sz: 0.085 })
  t1.name = 'tronco1'
  const t2 = trozo(G.cilindro6, mat(PALETA.tronco), { y: -0.06, z: 0.04, rz: Math.PI / 2, rx: 0.2, sx: 0.085, sy: 0.54, sz: 0.085 })
  t2.name = 'tronco2'
  const roca = trozo(G.esfera, mat(PALETA.piedra), { sx: 0.32, sy: 0.27, sz: 0.29 })
  roca.name = 'roca'
  g.add(saco, t1, t2, roca)
  g.visible = false
  cuerpo.add(g)
  return g
}

// ── ALDEANO ───────────────────────────────────────────────────────────────
function crearAldeano (oficio) {
  const color = COLOR_OFICIO[oficio]
  // túnica, mangas y faldón del MISMO color: a 35 píxeles la figura tiene que
  // ser UNA mancha de color, no un arlequín. Lo que varía de un aldeano a otro
  // son las calzas, la piel y el pelo, que no dicen a qué se dedica.
  const mRopa = mat(color || PALETA.ropaCruda)
  const rolRopa = color ? null : 'ropa'
  // el tocado manda en el cráneo (ver esqueleto): capucha de cuero en casi
  // todos, melena bajo el sombrero de la granjera y cabeza al aire en el minero,
  // que ya lleva casco. El cuero oscuro despega la cabeza del cuerpo desde arriba.
  const capucha = oficio !== 'granjero' && oficio !== 'minero'
  const e = esqueleto({
    torso: mRopa, rolTorso: rolRopa, brazoMat: mRopa, rolBrazo: rolRopa,
    faldonAlto: 0.17, rolCalza: 'ropaOsc',
    craneoMat: oficio === 'granjero' ? mat(PALETA.pelo) : (capucha ? mat(PALETA.cuero) : null),
    rolCraneo: oficio === 'granjero' ? 'pelo' : (capucha ? null : 'piel')
  })
  const { cuerpo, cabeza, manoD, manoI } = e

  // delantal: el detalle que lo separa de un soldado de un vistazo
  cuerpo.add(trozo(G.caja, mat(PALETA.delantal), { y: -0.01, z: 0.125, sx: 0.19, sy: 0.26, sz: 0.02, detalle: true }))

  const meta = { familia: 'bipedo', cadera: CADERA, gesto: 'generico', ritmo: 7.2, amplitud: 0.62, poseD: 0, poseI: 0 }

  if (oficio === 'lenador') {
    caperuza(cabeza, mat(PALETA.cuero))
    hacha(manoD)
    meta.gesto = 'hachazo'; meta.poseD = -0.15; meta.poseI = -0.2; meta.ritmo = 5.4
  } else if (oficio === 'cantero') {
    // visera de cuero: gorro plano, ni capucha ni casco, para no confundirlo
    cabeza.add(trozo(G.caja, mat(PALETA.cuero), { y: 0.21, z: 0.11, sx: 0.28, sy: 0.035, sz: 0.11 }))
    pico(manoD)
    // sillar bajo el brazo: el minero también pica, y esto es lo que los separa
    // de silueta cuando el color no basta (a contraluz, o sobre piedra)
    manoI.add(trozo(GL.cajaR, mat(PALETA.piedra), { x: -0.07, y: -0.02, sx: 0.17, sy: 0.19, sz: 0.21 }))
    meta.gesto = 'picar'; meta.poseD = -0.2; meta.poseI = -0.55; meta.ritmo = 6.4
  } else if (oficio === 'granjero') {
    pelambre(cabeza)          // melena asomando bajo el ala del sombrero
    sombreroPaja(cabeza)
    hoz(manoD)
    meta.gesto = 'segar'; meta.poseD = -0.35; meta.poseI = -0.2; meta.ritmo = 5.0
  } else if (oficio === 'minero') {
    cabeza.add(trozo(GL.cupula, mat(PALETA.hierro), { y: 0.225, z: -0.01, sx: 0.3, sy: 0.2, sz: 0.3 }))
    pico(manoD); candil(manoI)
    meta.gesto = 'picar'; meta.poseD = -0.2; meta.poseI = -0.1; meta.ritmo = 6.8
  } else if (oficio === 'constructor') {
    // gorro con vuelta: el cráneo ya es el gorro, esto es el remate naranja
    cabeza.add(trozo(GL.campana, mat(PALETA.oficioObra), { y: 0.255, sx: 0.26, sy: 0.1, sz: 0.26 }))
    martillo(manoD)
    escalera(cuerpo)
    meta.gesto = 'martillar'; meta.poseD = -0.5; meta.poseI = -0.75; meta.ritmo = 8.4
  } else {
    caperuza(cabeza, mat(PALETA.cuero))
    meta.gesto = 'generico'
  }

  fardo(cuerpo)
  e.raiz.userData.meta = meta
  return e.raiz
}

// ── TROPA A PIE ───────────────────────────────────────────────────────────
/**
 * Escudo REDONDO con el tablero ENTERO del color del bando. Bajo la cámara del
 * juego un escudo es un disco de veinte píxeles: pintarlo todo del color de la
 * casa vale más que cualquier emblema, y encima cuesta menos.
 */
function escudo (mano, heraldico) {
  const g = hueso('escudo', -0.04, -0.06, 0.06)
  g.add(trozo(GL.disco, mat(PALETA.estandarte), { rz: Math.PI / 2, sx: 0.36, sy: 0.05, sz: 0.36 }, 'bando'))
  if (heraldico) {
    g.add(trozo(G.caja, mat(PALETA.oro), { x: 0.04, sx: 0.02, sy: 0.3, sz: 0.07, detalle: true }))
    g.add(trozo(G.caja, mat(PALETA.oro), { x: 0.04, sx: 0.02, sy: 0.07, sz: 0.26, detalle: true }))
  } else {
    g.add(trozo(G.esfera, mat(PALETA.aceroClaro), { x: 0.04, sx: 0.07, sy: 0.11, sz: 0.11 }))
  }
  g.rotation.z = -0.15
  mano.add(g)
}

/**
 * DISTINTIVO DE BANDO. El penacho es la marca que mejor funciona desde la
 * cámara del juego: va en lo alto del casco, o sea en el punto más alto de la
 * figura, y no lo tapa nada. Azul heráldico los tuyos, granate los suyos.
 */
function penacho (cabeza, y = 0.36) {
  cabeza.add(trozo(G.cono6, mat(PALETA.estandarte), { y, z: -0.02, rx: -0.35, sx: 0.11, sy: 0.19, sz: 0.11 }, 'bando'))
}

function crearLancero () {
  const e = esqueleto({
    torso: mat(PALETA.ropaOcre), rolTorso: null, rolBrazo: null, faldonAlto: 0.17,
    calza: mat(PALETA.calzas), bota: mat(PALETA.cuero)
  })
  const { cuerpo, cabeza, manoD, manoI } = e
  // sobreveste con el color del bando, por delante y por detrás
  cuerpo.add(trozo(G.caja, mat(PALETA.estandarte), { y: 0.175, z: 0.108, sx: 0.21, sy: 0.26, sz: 0.02 }, 'bando'))
  cuerpo.add(trozo(G.caja, mat(PALETA.estandarte), { y: 0.175, z: -0.108, sx: 0.21, sy: 0.26, sz: 0.02 }, 'bando'))
  // casco de cuenco con nasal, y penacho del bando encima
  cabeza.add(trozo(GL.cupula, mat(PALETA.metalTropa), { y: 0.22, sx: 0.315, sy: 0.19, sz: 0.315 }))
  penacho(cabeza, 0.37)
  // LANZA: una raya vertical que dobla la altura de la figura. Es la silueta.
  manoD.add(trozo(G.cilindro6, mat(PALETA.madera), { y: 0.24, sx: 0.028, sy: 1.2, sz: 0.028 }))
  manoD.add(trozo(G.cono6, mat(PALETA.aceroClaro), { y: 0.92, sx: 0.07, sy: 0.19, sz: 0.07 }))
  escudo(manoI, false)
  e.raiz.userData.meta = { familia: 'bipedo', cadera: CADERA, gesto: 'lanzazo', ritmo: 6.0, amplitud: 0.5, poseD: -0.2, poseI: -0.5 }
  return e.raiz
}

function crearEspadachin () {
  const e = esqueleto({
    torso: mat(PALETA.cotaMalla), rolTorso: null, rolBrazo: null, faldonAlto: 0.16,
    faldonMat: mat(PALETA.cotaMalla), brazoMat: mat(PALETA.cotaMalla), calza: mat(PALETA.calzas),
    hombroMat: mat(PALETA.acero), rolHombro: null,
    craneoMat: mat(PALETA.cotaMalla), rolCraneo: null
  })
  const { cuerpo, cabeza, manoD, manoI } = e
  // cota de malla asomando bajo un tabardo heráldico
  cuerpo.add(trozo(G.caja, mat(PALETA.estandarte), { y: 0.185, sx: 0.26, sy: 0.24, sz: 0.21 }, 'bando'))
  cuerpo.add(trozo(G.caja, mat(PALETA.oro), { y: 0.078, sx: 0.28, sy: 0.032, sz: 0.225, detalle: true }))
  // almófar (capucha de malla) y capacete encima
  cabeza.add(trozo(GL.cupula, mat(PALETA.acero), { y: 0.21, sx: 0.31, sy: 0.21, sz: 0.31 }))
  penacho(cabeza, 0.4)
  // espadón: hoja ancha, guarda y pomo
  manoD.add(trozo(G.caja, mat(PALETA.cuero), { y: -0.05, sx: 0.032, sy: 0.11, sz: 0.032 }))
  manoD.add(trozo(G.caja, mat(PALETA.acero), { y: 0.015, sx: 0.19, sy: 0.028, sz: 0.038 }))
  manoD.add(trozo(G.caja, mat(PALETA.aceroClaro), { y: 0.21, sx: 0.06, sy: 0.38, sz: 0.024 }))
  escudo(manoI, true)
  e.raiz.userData.meta = { familia: 'bipedo', cadera: CADERA, gesto: 'tajo', ritmo: 6.6, amplitud: 0.46, poseD: -0.75, poseI: -0.55 }
  return e.raiz
}

function crearArquero () {
  const e = esqueleto({
    torso: mat(PALETA.capuchaVerde), rolTorso: null, rolBrazo: null,
    brazoMat: mat(PALETA.capuchaVerde), faldonAlto: 0.15, faldonMat: mat(PALETA.capuchaVerde),
    calza: mat(PALETA.ropaOcre), craneoMat: mat(PALETA.capuchaVerde), rolCraneo: null
  })
  const { cuerpo, cabeza, manoI, manoD } = e
  caperuza(cabeza, mat(PALETA.capuchaVerde), null)
  // banda del bando cruzada al pecho: sin casco no hay penacho donde marcarlo
  cuerpo.add(trozo(G.caja, mat(PALETA.estandarte), { y: 0.17, rz: 0.62, sx: 0.4, sy: 0.07, sz: 0.235 }, 'bando'))
  // carcaj a la espalda con las plumas asomando
  cuerpo.add(trozo(G.cilindro6, mat(PALETA.cuero), { x: -0.11, y: 0.18, z: -0.14, rx: -0.3, rz: 0.35, sx: 0.11, sy: 0.32, sz: 0.11 }))
  for (let i = 0; i < 3; i++) {
    cuerpo.add(trozo(G.caja, mat(PALETA.florBlanca),
      { x: -0.15 + i * 0.03, y: 0.35, z: -0.17, rz: 0.35, sx: 0.018, sy: 0.11, sz: 0.018, detalle: true }))
  }
  // ARCO: el toro abierto, de canto y con la panza hacia delante. Grande, que
  // es lo único que separa a un arquero de un lancero desde la cámara.
  const arco = hueso('arco', -0.06, 0.06, 0.04)
  // el arco se lleva SESGADO, ni de frente ni de perfil: de perfil puro es una
  // raya igual que una lanza, y de frente parece que lleve un aro. A 50 grados
  // se ve la C desde casi cualquier posición de la cámara.
  arco.rotation.y = -0.9
  arco.add(trozo(GL.arco, mat(PALETA.madera), { rz: -Math.PI * 0.475, sx: 0.62, sy: 0.62, sz: 0.62 }))
  arco.add(trozo(G.caja, mat(PALETA.ropaCruda), { x: 0.025, sx: 0.012, sy: 0.6, sz: 0.012, detalle: true }))
  manoI.add(arco)
  // flecha en la diestra
  manoD.add(trozo(G.caja, mat(PALETA.madera), { rz: Math.PI / 2, sx: 0.014, sy: 0.36, sz: 0.014, detalle: true }))
  e.raiz.userData.meta = { familia: 'bipedo', cadera: CADERA, gesto: 'disparar', ritmo: 5.4, amplitud: 0.55, poseD: -0.4, poseI: -0.3 }
  return e.raiz
}

function crearBallestero () {
  const e = esqueleto({
    torso: mat(PALETA.cuero), rolTorso: null, rolBrazo: null,
    brazoMat: mat(PALETA.ropaAzulon), faldonAlto: 0.15, faldonMat: mat(PALETA.ropaAzulon),
    calza: mat(PALETA.calzas), hombroMat: mat(PALETA.acero), rolHombro: null
  })
  const { cuerpo, cabeza, manoD } = e
  // brigantina: cuero con placas remachadas
  for (let i = 0; i < 3; i++) {
    cuerpo.add(trozo(G.caja, mat(PALETA.acero),
      { x: -0.085 + i * 0.085, y: 0.18, z: 0.105, sx: 0.065, sy: 0.2, sz: 0.02, detalle: true }))
  }
  cuerpo.add(trozo(G.caja, mat(PALETA.estandarte), { y: 0.276, sx: 0.29, sy: 0.055, sz: 0.2 }, 'bando'))
  // capacete de ala ancha: el sombrero de hierro es SU silueta
  cabeza.add(trozo(GL.campanaAncha, mat(PALETA.acero), { y: 0.225, sx: 0.46, sy: 0.05, sz: 0.46 }))
  cabeza.add(trozo(GL.cupula, mat(PALETA.acero), { y: 0.245, sx: 0.32, sy: 0.18, sz: 0.32 }))
  // BALLESTA: una CRUZ horizontal. No se confunde con el arco ni queriendo.
  const bal = hueso('ballesta', -0.05, -0.06, 0.12)
  bal.add(trozo(G.caja, mat(PALETA.madera), { z: 0.06, sx: 0.055, sy: 0.05, sz: 0.44 }))
  bal.add(trozo(G.caja, mat(PALETA.hierro), { z: 0.22, sx: 0.5, sy: 0.034, sz: 0.04 }))
  bal.add(trozo(G.caja, mat(PALETA.ropaCruda), { z: 0.11, sx: 0.46, sy: 0.014, sz: 0.014, detalle: true }))
  manoD.add(bal)
  e.raiz.userData.meta = { familia: 'bipedo', cadera: CADERA, gesto: 'ballesta', ritmo: 4.6, amplitud: 0.44, poseD: -1.35, poseI: -1.2 }
  return e.raiz
}

function crearMonje () {
  const e = esqueleto({
    sinPiernas: true, torso: mat(PALETA.habito), rolTorso: null, rolBrazo: null,
    brazoMat: mat(PALETA.habito), cinturon: false, faldon: false, hombros: false
  })
  const { cuerpo, cabeza, brazoI, brazoD } = e
  // hábito hasta el suelo: sin piernas a la vista, silueta de campana
  cuerpo.add(trozo(GL.campanaAncha, mat(PALETA.habito), { y: -0.145, sx: 0.46, sy: 0.38, sz: 0.42 }))
  cuerpo.add(trozo(G.caja, mat(PALETA.habito), { y: 0.06, sx: 0.31, sy: 0.1, sz: 0.25 }))
  // cordón con los dos cabos colgando
  cuerpo.add(trozo(G.caja, mat(PALETA.paja), { y: 0.055, sx: 0.31, sy: 0.03, sz: 0.24 }))
  cuerpo.add(trozo(G.caja, mat(PALETA.paja), { x: 0.09, y: -0.05, z: 0.12, sx: 0.022, sy: 0.19, sz: 0.022, detalle: true }))
  // capucha caída sobre la espalda
  cuerpo.add(trozo(GL.campana, mat(PALETA.habito), { y: 0.28, z: -0.12, rx: -0.35, sx: 0.28, sy: 0.22, sz: 0.17 }))
  // tonsura: corona de pelo y coronilla al aire
  cabeza.add(trozo(GL.campana8, mat(PALETA.pelo), { y: 0.155, sx: 0.29, sy: 0.075, sz: 0.29 }, 'pelo'))
  // cruz de madera colgada al pecho
  cuerpo.add(trozo(G.caja, mat(PALETA.oro), { y: 0.14, z: 0.11, sx: 0.032, sy: 0.12, sz: 0.02 }))
  cuerpo.add(trozo(G.caja, mat(PALETA.oro), { y: 0.165, z: 0.11, sx: 0.085, sy: 0.032, sz: 0.02, detalle: true }))
  brazoI.rotation.x = -1.25; brazoI.rotation.z = -0.45
  brazoD.rotation.x = -1.25; brazoD.rotation.z = 0.45
  e.raiz.userData.meta = { familia: 'monje', cadera: CADERA, gesto: 'rezar', ritmo: 3.2, amplitud: 0, poseD: -1.25, poseI: -1.25 }
  return e.raiz
}

function crearExplorador () {
  const e = esqueleto({
    torso: mat(PALETA.ropaVerde), rolTorso: null, rolBrazo: null,
    brazoMat: mat(PALETA.ropaVerde), faldonAlto: 0.14, faldonMat: mat(PALETA.ropaVerde),
    calza: mat(PALETA.cuero), hombros: false,
    craneoMat: mat(PALETA.tejadoAzul), rolCraneo: 'bandoOsc'
  })
  const { cuerpo, cabeza, manoI } = e
  // capa larga: el bulto que lo distingue de un arquero desde arriba
  cuerpo.add(trozo(GL.campana8, mat(PALETA.tejadoAzul), { y: 0.0, z: -0.12, sx: 0.4, sy: 0.46, sz: 0.18 }, 'bandoOsc'))
  cuerpo.add(trozo(G.caja, mat(PALETA.oro), { y: 0.3, z: -0.07, sx: 0.07, sy: 0.055, sz: 0.07, detalle: true }))
  caperuza(cabeza, mat(PALETA.tejadoAzul), 'bandoOsc')
  // zurrón bien gordo al costado
  cuerpo.add(trozo(G.caja, mat(PALETA.cuero), { x: 0.18, y: 0.0, z: 0.02, sx: 0.14, sy: 0.16, sz: 0.14 }))
  // bastón nudoso, más alto que él y sin punta de hierro
  manoI.add(trozo(G.cilindro6, mat(PALETA.tronco), { y: 0.18, rz: 0.06, sx: 0.03, sy: 0.95, sz: 0.03 }))
  manoI.add(trozo(G.esfera, mat(PALETA.tronco), { y: 0.62, sx: 0.085, sy: 0.085, sz: 0.085, detalle: true }))
  e.raiz.userData.meta = { familia: 'bipedo', cadera: CADERA, gesto: 'otear', ritmo: 8.4, amplitud: 0.72, poseD: 0, poseI: -0.2 }
  return e.raiz
}

// ── CABALLERÍA ────────────────────────────────────────────────────────────
/** Caballo low-poly con las cuatro patas articuladas. */
function caballo (pelaje, gualdrapa) {
  const g = hueso('caballo', 0, 0, 0)
  const mPelo = mat(pelaje)
  const mCrin = mat(PALETA.caballoOscuro)
  g.add(trozo(GL.cajaR, mPelo, { y: 0.44, sx: 0.3, sy: 0.28, sz: 0.66 }))
  g.add(trozo(G.caja, mPelo, { y: 0.58, z: 0.31, rx: -0.55, sx: 0.2, sy: 0.32, sz: 0.19 }))
  g.add(trozo(G.caja, mPelo, { y: 0.71, z: 0.43, rx: 0.35, sx: 0.17, sy: 0.15, sz: 0.28 }))
  g.add(trozo(G.caja, mCrin, { y: 0.66, z: 0.27, rx: -0.55, sx: 0.08, sy: 0.28, sz: 0.15, detalle: true }))
  g.add(trozo(G.caja, mCrin, { y: 0.47, z: -0.35, rx: 0.5, sx: 0.07, sy: 0.28, sz: 0.08 }))
  const patas = []
  for (const [nombre, x, z] of [['pataFI', -0.11, 0.21], ['pataFD', 0.11, 0.21], ['pataTI', -0.11, -0.22], ['pataTD', 0.11, -0.22]]) {
    const p = hueso(nombre, x, 0.36, z)
    p.add(trozo(G.caja, mPelo, { y: -0.17, sx: 0.09, sy: 0.34, sz: 0.1 }))
    p.add(trozo(G.caja, mat(PALETA.caballoOscuro), { y: -0.345, sx: 0.1, sy: 0.055, sz: 0.125, detalle: true }))
    g.add(p); patas.push(p)
  }
  if (gualdrapa) {
    g.add(trozo(G.caja, mat(PALETA.estandarte), { y: 0.4, sx: 0.33, sy: 0.32, sz: 0.54 }, 'bando'))
    g.add(trozo(G.caja, mat(PALETA.oro), { y: 0.245, sx: 0.35, sy: 0.045, sz: 0.54, detalle: true }))
    g.add(trozo(GL.cupula, mat(PALETA.aceroClaro), { y: 0.73, z: 0.44, rx: 1.2, sx: 0.18, sy: 0.17, sz: 0.18 }))
  } else {
    g.add(trozo(G.caja, mat(PALETA.cuero), { y: 0.6, sx: 0.32, sy: 0.06, sz: 0.24 }))
  }
  return { grupo: g, patas }
}

function crearJinete (esCaballero) {
  const raiz = new THREE.Group()
  // el caballero monta caballo claro: a vista de pájaro se distingue del jinete
  const cab = caballo(esCaballero ? PALETA.caballoClaro : PALETA.caballoCastaño, esCaballero)
  raiz.add(cab.grupo)

  const jinete = hueso('cuerpo', 0, 0.64, -0.02)
  raiz.add(jinete)
  const mCuerpo = esCaballero ? mat(PALETA.aceroClaro) : mat(PALETA.cotaMalla)
  jinete.add(trozo(GL.cajaR, mCuerpo, { y: 0.1, sx: 0.28, sy: 0.26, sz: 0.2 }))
  jinete.add(trozo(G.caja, mat(PALETA.estandarte), { y: 0.1, z: 0.105, sx: 0.22, sy: 0.24, sz: 0.02 }, 'bando'))
  // piernas a horcajadas: fijas, el que se mueve es el caballo
  for (const lado of [-1, 1]) {
    jinete.add(trozo(G.caja, esCaballero ? mCuerpo : mat(PALETA.calzas),
      { x: lado * 0.14, y: -0.06, z: 0.02, rz: lado * 0.35, sx: 0.095, sy: 0.26, sz: 0.105 }))
    jinete.add(trozo(G.caja, mat(PALETA.cuero), { x: lado * 0.17, y: -0.19, z: 0.06, sx: 0.1, sy: 0.055, sz: 0.14, detalle: true }))
  }
  const cabeza = hueso('cabeza', 0, 0.28, 0)
  jinete.add(cabeza)
  cabeza.add(trozo(GL.cabezaR, mat(esCaballero ? PALETA.aceroClaro : PALETA.pielClara),
    { y: 0.1, sx: 0.245, sy: 0.225, sz: 0.235 }, esCaballero ? null : 'piel'))
  if (!esCaballero) cabeza.add(trozo(G.caja, mat(PALETA.pielClara), { y: 0.075, z: 0.125, sx: 0.16, sy: 0.14, sz: 0.03 }, 'piel'))
  if (esCaballero) {
    // yelmo cerrado con penacho: armadura clara, penacho al viento
    cabeza.add(trozo(G.caja, mat(PALETA.acero), { y: 0.1, z: 0.128, sx: 0.16, sy: 0.032, sz: 0.02, detalle: true }))
    const pen = hueso('penacho', 0, 0.22, -0.02)
    pen.add(trozo(G.cono6, mat(PALETA.estandarte), { y: 0.08, rx: -0.5, sx: 0.11, sy: 0.32, sz: 0.11 }, 'bando'))
    cabeza.add(pen)
  } else {
    cabeza.add(trozo(GL.cupula, mat(PALETA.metalTropa), { y: 0.205, sx: 0.28, sy: 0.17, sz: 0.28 }))
    cabeza.add(trozo(G.cono6, mat(PALETA.estandarte), { y: 0.33, z: -0.02, rx: -0.35, sx: 0.1, sy: 0.17, sz: 0.1 }, 'bando'))
  }
  // brazo de la lanza: el único articulado del jinete
  const brazoD = hueso('brazoD', 0.165, 0.2, 0)
  brazoD.add(trozo(G.caja, mCuerpo, { y: -0.09, sx: 0.08, sy: 0.2, sz: 0.085 }))
  const manoD = hueso('manoD', 0, -0.2, 0)
  manoD.add(trozo(G.esfera, mat(PALETA.pielClara), { sx: 0.11, sy: 0.1, sz: 0.11 }, 'piel'))
  manoD.add(trozo(G.cilindro6, mat(PALETA.madera), { y: 0.12, rx: 0.35, sx: 0.032, sy: 1.15, sz: 0.032 }))
  manoD.add(trozo(G.cono6, mat(PALETA.aceroClaro), { y: 0.67, z: 0.245, rx: 0.35, sx: 0.075, sy: 0.18, sz: 0.075 }))
  if (esCaballero) {
    // banderín en la lanza: remata la silueta y marca el bando de lejos
    manoD.add(trozo(G.caja, mat(PALETA.estandarte), { x: 0.1, y: 0.46, z: 0.17, sx: 0.18, sy: 0.14, sz: 0.02 }, 'bando'))
  }
  brazoD.add(manoD)
  jinete.add(brazoD)
  const brazoI = hueso('brazoI', -0.165, 0.2, 0)
  brazoI.add(trozo(G.caja, mCuerpo, { y: -0.09, sx: 0.08, sy: 0.2, sz: 0.085 }))
  const manoI = hueso('manoI', 0, -0.2, 0)
  manoI.add(trozo(G.esfera, mat(PALETA.pielClara), { sx: 0.11, sy: 0.1, sz: 0.11 }, 'piel'))
  escudo(manoI, esCaballero)
  brazoI.add(manoI)
  jinete.add(brazoI)
  brazoI.rotation.x = -0.45

  raiz.userData.meta = {
    familia: 'jinete', cadera: 0.64, gesto: 'lanzazo', ritmo: 6.4, amplitud: 0.55,
    poseD: -0.3, poseI: -0.45, patas: ['pataFI', 'pataFD', 'pataTI', 'pataTD']
  }
  return raiz
}

// ── MÁQUINAS DE ASEDIO ────────────────────────────────────────────────────
function ruedas (padre, lista, radio) {
  const grupos = []
  for (const [x, z] of lista) {
    const r = hueso('rueda', x, radio, z)
    r.add(trozo(GL.rueda, mat(PALETA.madera), { rz: Math.PI / 2, sx: radio * 2, sy: 0.085, sz: radio * 2 }))
    r.add(trozo(GL.llanta, mat(PALETA.hierro), { rz: Math.PI / 2, sx: radio * 2.02, sy: radio * 2.02, sz: radio * 2.02, detalle: true }))
    padre.add(r); grupos.push(r)
  }
  return grupos
}

function crearAriete () {
  const raiz = new THREE.Group()
  const cuerpo = hueso('cuerpo', 0, 0, 0)
  raiz.add(cuerpo)
  const mMad = mat(PALETA.madera)
  cuerpo.add(trozo(G.caja, mMad, { y: 0.24, sx: 0.5, sy: 0.08, sz: 1.0 }))
  for (const z of [-0.38, 0.38]) {
    cuerpo.add(trozo(G.caja, mat(PALETA.maderaClara), { x: -0.24, y: 0.52, z, sx: 0.07, sy: 0.5, sz: 0.07 }))
    cuerpo.add(trozo(G.caja, mat(PALETA.maderaClara), { x: 0.24, y: 0.52, z, sx: 0.07, sy: 0.5, sz: 0.07 }))
  }
  // tejadillo de paja: sin él parece un carro, con él es una máquina de guerra
  cuerpo.add(trozo(G.caja, mat(PALETA.madera), { x: -0.17, y: 0.82, rz: 0.95, sx: 0.06, sy: 0.42, sz: 0.86 }))
  cuerpo.add(trozo(G.caja, mat(PALETA.madera), { x: 0.17, y: 0.82, rz: -0.95, sx: 0.06, sy: 0.42, sz: 0.86 }))
  cuerpo.add(trozo(G.caja, mat(PALETA.estandarte), { y: 0.94, sx: 0.07, sy: 0.07, sz: 0.6 }, 'bando'))
  // el tronco: cuelga de dos cuerdas y asoma por delante. Es lo único que se mueve.
  const ariete = hueso('ariete', 0, 0.75, 0)
  ariete.add(trozo(G.cilindro6, mat(PALETA.tronco), { y: -0.22, z: 0.14, rx: Math.PI / 2, sx: 0.17, sy: 1.05, sz: 0.17 }))
  ariete.add(trozo(G.caja, mat(PALETA.hierro), { y: -0.22, z: 0.7, sx: 0.18, sy: 0.18, sz: 0.16 }))
  ariete.add(trozo(G.cono6, mat(PALETA.hierro), { x: -0.08, y: -0.14, z: 0.76, rx: 1.3, sx: 0.08, sy: 0.16, sz: 0.08, detalle: true }))
  ariete.add(trozo(G.cono6, mat(PALETA.hierro), { x: 0.08, y: -0.14, z: 0.76, rx: 1.3, sx: 0.08, sy: 0.16, sz: 0.08, detalle: true }))
  ariete.add(trozo(G.caja, mat(PALETA.cuero), { y: -0.11, z: 0.42, sx: 0.025, sy: 0.22, sz: 0.025, detalle: true }))
  ariete.add(trozo(G.caja, mat(PALETA.cuero), { y: -0.11, z: -0.16, sx: 0.025, sy: 0.22, sz: 0.025, detalle: true }))
  cuerpo.add(ariete)
  const rs = ruedas(cuerpo, [[-0.28, 0.34], [0.28, 0.34], [-0.28, -0.34], [0.28, -0.34]], 0.17)
  raiz.userData.meta = { familia: 'maquina', gesto: 'embestir', ritmo: 2.4, ruedas: rs.length, brazo: 'ariete' }
  return raiz
}

function crearCatapulta () {
  const raiz = new THREE.Group()
  const cuerpo = hueso('cuerpo', 0, 0, 0)
  raiz.add(cuerpo)
  const mMad = mat(PALETA.madera)
  cuerpo.add(trozo(G.caja, mMad, { y: 0.24, sx: 0.46, sy: 0.09, sz: 0.86 }))
  cuerpo.add(trozo(G.caja, mat(PALETA.maderaClara), { y: 0.3, z: -0.3, sx: 0.5, sy: 0.12, sz: 0.16 }))
  // dos montantes en A: la estampa clásica de la catapulta
  for (const x of [-0.19, 0.19]) {
    cuerpo.add(trozo(G.caja, mMad, { x, y: 0.5, z: 0.12, rx: 0.5, sx: 0.07, sy: 0.52, sz: 0.07 }))
    cuerpo.add(trozo(G.caja, mMad, { x, y: 0.5, z: -0.12, rx: -0.5, sx: 0.07, sy: 0.52, sz: 0.07 }))
  }
  cuerpo.add(trozo(G.cilindro6, mat(PALETA.hierro), { y: 0.72, rz: Math.PI / 2, sx: 0.06, sy: 0.46, sz: 0.06 }))
  const brazo = hueso('brazo', 0, 0.72, 0)
  brazo.add(trozo(G.caja, mMad, { y: 0.02, z: -0.34, sx: 0.08, sy: 0.08, sz: 0.72 }))
  brazo.add(trozo(GL.campana, mat(PALETA.maderaClara), { y: 0.1, z: -0.68, rx: -0.4, sx: 0.24, sy: 0.14, sz: 0.24 }))
  brazo.add(trozo(G.esfera, mat(PALETA.piedra), { y: 0.16, z: -0.68, sx: 0.2, sy: 0.2, sz: 0.2 }))
  brazo.add(trozo(G.caja, mat(PALETA.piedraOscura), { y: -0.02, z: 0.28, sx: 0.16, sy: 0.18, sz: 0.2 }))
  brazo.rotation.x = 0.85   // armada: el brazo espera echado hacia atrás y arriba
  cuerpo.add(brazo)
  cuerpo.add(trozo(G.caja, mat(PALETA.estandarte), { x: 0.24, y: 0.62, z: -0.34, sx: 0.02, sy: 0.2, sz: 0.16 }, 'bando'))
  const rs = ruedas(cuerpo, [[-0.26, 0.3], [0.26, 0.3], [-0.26, -0.3], [0.26, -0.3]], 0.19)
  raiz.userData.meta = { familia: 'maquina', gesto: 'lanzar', ritmo: 1.6, ruedas: rs.length, brazo: 'brazo' }
  return raiz
}

// ── fábrica con caché de prototipos ───────────────────────────────────────
const FABRICA = {
  aldeano: crearAldeano,
  lancero: crearLancero,
  espadachin: crearEspadachin,
  arquero: crearArquero,
  ballestero: crearBallestero,
  jinete: () => crearJinete(false),
  caballero: () => crearJinete(true),
  ariete: crearAriete,
  catapulta: crearCatapulta,
  monje: crearMonje,
  explorador: crearExplorador
}

const prototipos = new Map()
function prototipo (tipo, oficio) {
  const clave = `${tipo}|${oficio || '-'}`
  let p = prototipos.get(clave)
  if (!p) {
    const fn = FABRICA[tipo] || FABRICA.aldeano
    p = fn(oficio)
    p.name = `proto_${clave}`
    prototipos.set(clave, p)
  }
  return p
}

// ════════════════════════════════════════════════════════════════════════
//  FUSIÓN: de 27 mallas por figura a 7
// ════════════════════════════════════════════════════════════════════════
/**
 * Un aldeano montado pieza a pieza son ~27 mallas, o sea ~27 llamadas de
 * dibujo. Con 50 aldeanos eso solo ya se come el presupuesto del móvil.
 *
 * Aquí cada figura se cuece una vez: todo lo que NO se mueve por separado se
 * funde en una sola malla por hueso, con el color de cada pieza metido en los
 * vértices. Queda una malla por hueso (7 en un aldeano) y un único material
 * compartido por TODAS las figuras del juego.
 *
 * La variedad de vestuario no se pierde: los vértices guardan a qué "rol"
 * pertenecen (piel, ropa, pelo…) y al vestir un clon solo se reescribe el
 * buffer de color; las posiciones y las normales se comparten, así que a la
 * tarjeta se suben UNA vez por tipo de figura.
 */

/** Huesos que se mueven solos: nunca se funden con nadie. */
const HUESOS_VIVOS = new Set([
  'cuerpo', 'cabeza', 'torso', 'piernaI', 'piernaD', 'brazoI', 'brazoD',
  'arco', 'fardo', 'saco', 'tronco1', 'tronco2', 'roca', 'rueda', 'ariete', 'brazo', 'pano'
])

/** Orden de los roles en el código por vértice (0 = color fijo, ya horneado). */
const ROLES = ['piel', 'ropa', 'ropaOsc', 'pelo', 'bando', 'bandoOsc']

/** Material único de toda la gente del juego: color por vértice y caras planas. */
let matFigura = null
const materialFigura = () => {
  if (!matFigura) {
    // mats.js no expone materiales con color por vértice; se clona el suyo
    matFigura = mat(0xffffff).clone()
    matFigura.vertexColors = true
  }
  return matFigura
}

/** Una pieza no se funde si la mueven por su cuenta o si brilla (el candil). */
const seQuedaSuelta = (o) => HUESOS_VIVOS.has(o.name) ||
  (o.material && o.material.emissive && (o.material.emissive.r || o.material.emissive.g || o.material.emissive.b))

const _mId = new THREE.Matrix4()

/**
 * Copia el contenido de `viejo` dentro de `nuevo` fundiendo lo que no se anima.
 * @param {boolean} conDetalle en calidad baja los adornos ni se generan
 */
function fundirHueso (viejo, nuevo, conservar, conDetalle) {
  const lote = { geos: [], base: [], rol: [] }

  const bajar = (nodo, m) => {
    for (const h of nodo.children) {
      h.updateMatrix()
      const mm = new THREE.Matrix4().multiplyMatrices(m, h.matrix)
      const detalle = !!(h.userData && h.userData.detalle)
      if (detalle && !conDetalle) continue

      if (h.isMesh && seQuedaSuelta(h)) {
        const c = new THREE.Mesh(h.geometry, h.material)
        c.name = h.name
        c.userData = { ...h.userData }
        c.castShadow = h.castShadow; c.receiveShadow = h.receiveShadow
        c.visible = h.visible
        mm.decompose(c.position, c.quaternion, c.scale)
        nuevo.add(c)
        continue
      }
      if (h.isMesh) {
        const rol = (h.userData && h.userData.rol) || null
        const i = rol ? ROLES.indexOf(rol) + 1 : 0
        const g = h.geometry.index ? h.geometry.toNonIndexed() : h.geometry.clone()
        g.applyMatrix4(mm)
        g.deleteAttribute('uv')      // la gente no lleva textura: un buffer menos que subir
        lote.geos.push(g)
        lote.base.push(h.material.color)
        lote.rol.push(i)
        continue
      }
      if (h.isGroup && conservar.has(h.name)) {
        const g = new THREE.Group()
        g.name = h.name
        g.visible = h.visible
        mm.decompose(g.position, g.quaternion, g.scale)
        nuevo.add(g)
        fundirHueso(h, g, conservar, conDetalle)
        continue
      }
      if (h.isGroup) bajar(h, mm)    // grupo que no se anima: se disuelve aquí mismo
    }
  }
  bajar(viejo, _mId)

  if (!lote.geos.length) return
  const geo = lote.geos.length === 1 ? lote.geos[0] : mergeGeometries(lote.geos, false)
  if (!geo) return
  const n = geo.attributes.position.count
  const col = new Float32Array(n * 3)
  const roles = new Uint8Array(n)
  let v = 0
  for (let i = 0; i < lote.geos.length; i++) {
    const c = lote.base[i]
    const r = lote.rol[i]
    const cn = lote.geos[i].attributes.position.count
    for (let k = 0; k < cn; k++, v++) {
      col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b
      roles[v] = r
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.computeBoundingSphere()
  geo.userData.roles = roles
  const malla = new THREE.Mesh(geo, materialFigura())
  malla.castShadow = true
  malla.receiveShadow = false      // una figura no recibe su propia sombra: se ahorra y no se nota
  nuevo.add(malla)
}

const fundidos = new Map()
/** Esqueleto ya fundido de un tipo de figura. Se cuece UNA vez por calidad. */
function fundido (tipo, oficio) {
  const conDetalle = ctx.calidad !== 'bajo'
  const clave = `${tipo}|${oficio || '-'}|${conDetalle ? 'd' : 's'}`
  let f = fundidos.get(clave)
  if (f) return f
  const crudo = prototipo(tipo, oficio)
  const meta = crudo.userData.meta || {}
  const conservar = new Set(HUESOS_VIVOS)
  if (meta.brazo) conservar.add(meta.brazo)
  for (const n of meta.patas || []) conservar.add(n)
  try {
    f = new THREE.Group()
    f.name = `fundido_${clave}`
    f.userData.meta = meta
    fundirHueso(crudo, f, conservar, conDetalle)
  } catch (err) {
    console.warn('[units] no se pudo fundir la figura, se usa suelta', err)
    f = crudo
  }
  fundidos.set(clave, f)
  return f
}

// ── vestuario: solo cambia el buffer de color, nunca la geometría ─────────
const teñidas = new WeakMap()      // geometría base -> Map(clave de librea -> geometría teñida)

function geometriaTeñida (base, clave, colores) {
  const roles = base.userData.roles
  if (!roles) return base
  let m = teñidas.get(base)
  if (!m) teñidas.set(base, m = new Map())
  const hecha = m.get(clave)
  if (hecha) return hecha
  const col = Float32Array.from(base.attributes.color.array)
  for (let i = 0; i < roles.length; i++) {
    const r = roles[i]
    if (!r) continue
    const c = colores[r - 1]
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
  }
  // posiciones y normales COMPARTIDAS: a la GPU solo viaja el color
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', base.attributes.position)
  g.setAttribute('normal', base.attributes.normal)
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.boundingSphere = base.boundingSphere
  g.userData.roles = roles
  m.set(clave, g)
  return g
}

/** Colores de la librea de una figura (los mismos que elegía vestir()). */
function libreaDe (semilla, bando) {
  const L = paletas()
  const s = (semilla >>> 0) || 1
  const iPiel = (s * 7 + 3) % L.piel.length
  const iRopa = (s * 13 + 5) % L.ropa.length
  const iOsc = (s * 5 + 1) % L.ropaOsc.length
  const iPelo = (s * 3 + 2) % L.pelo.length
  const b = bando === 'enemigo' ? 'enemigo' : 'jugador'
  return {
    clave: `${iPiel}.${iRopa}.${iOsc}.${iPelo}.${b}`,
    colores: [
      L.piel[iPiel].color, L.ropa[iRopa].color, L.ropaOsc[iOsc].color,
      L.pelo[iPelo].color, L.bando[b].color, L.bandoOsc[b].color
    ]
  }
}

/**
 * VERSIÓN DE LEJOS: la figura entera fundida en UNA malla, en pose de reposo.
 * Un aldeano al otro lado de la aldea mide treinta píxeles: no hace falta que
 * mueva los brazos, hace falta que esté y que se mueva de sitio. Una llamada
 * de dibujo en vez de siete.
 */
const lejanos = new Map()
function fundidoLejano (tipo, oficio) {
  const clave = `${tipo}|${oficio || '-'}|${ctx.calidad}`
  let geo = lejanos.get(clave)
  if (geo !== undefined) return geo
  try {
    const base = fundido(tipo, oficio)
    base.updateMatrixWorld(true)
    const geos = []
    const roles = []
    base.traverse((o) => {
      if (!o.isMesh || !o.visible) return
      if (o.name === 'saco' || o.name === 'tronco1' || o.name === 'tronco2' || o.name === 'roca') return
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()
      g.applyMatrix4(o.matrixWorld)
      g.deleteAttribute('uv')
      const n = g.attributes.position.count
      if (!g.attributes.color) {
        const col = new Float32Array(n * 3)
        const c = o.material.color
        for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      }
      geos.push(g)
      roles.push(o.geometry.userData.roles || new Uint8Array(n))
    })
    geo = geos.length ? mergeGeometries(geos, false) : null
    if (geo) {
      let total = 0
      for (const r of roles) total += r.length
      const todos = new Uint8Array(total)
      let o = 0
      for (const r of roles) { todos.set(r, o); o += r.length }
      geo.userData.roles = todos
      geo.computeBoundingSphere()
    }
  } catch (err) {
    console.warn('[units] sin versión de lejos para', clave, err)
    geo = null
  }
  lejanos.set(clave, geo)
  return geo
}

const vestidos = new Map()
/**
 * Crea una figura lista para meter en la escena.
 * @param {string} tipo una de las 11 unidades (o 'aldeano')
 * @param {{bando?:'jugador'|'enemigo', oficio?:string, semilla?:number}} [opciones]
 * @returns {THREE.Group} de pie sobre el origen y mirando hacia +Z
 */
export function crearUnidad (tipo, opciones = {}) {
  const bando = opciones.bando === 'enemigo' ? 'enemigo' : 'jugador'
  const semilla = (opciones.semilla ?? Math.floor(Math.random() * 9973)) | 0
  // admite tanto 'granjero' como el tipo de edificio ('granja'): quien llame
  // no tiene por qué saberse mi vocabulario
  const oficio = opciones.oficio ? (OFICIOS[String(opciones.oficio).toLowerCase()] || opciones.oficio) : null
  const librea = libreaDe(semilla, bando)
  const claveVestido = `${tipo}|${oficio || '-'}|${ctx.calidad}|${librea.clave}`

  let vestido = vestidos.get(claveVestido)
  if (!vestido) {
    vestido = fundido(tipo, oficio).clone(true)
    vestido.traverse((o) => {
      if (!o.isMesh) return
      if (o.geometry.userData.roles) o.geometry = geometriaTeñida(o.geometry, librea.clave, librea.colores)
      else vestirSuelta(o, librea, bando)        // fardo, candil y demás piezas sueltas
    })
    const gLejos = fundidoLejano(tipo, oficio)
    if (gLejos) {
      const lejos = new THREE.Mesh(geometriaTeñida(gLejos, librea.clave, librea.colores), materialFigura())
      lejos.name = NOMBRE_LEJOS
      lejos.castShadow = true
      lejos.receiveShadow = false
      lejos.visible = false
      vestido.add(lejos)
    }
    vestidos.set(claveVestido, vestido)
  }
  // el clon comparte geometrías y materiales: crear un aldeano es casi gratis
  const fig = vestido.clone(true)
  fig.userData.tipo = tipo
  fig.userData.bando = bando
  return fig
}

/** Las pocas piezas que siguen sueltas se visten como siempre: cambiando material. */
function vestirSuelta (o, librea, bando) {
  const rol = o.userData && o.userData.rol
  if (!rol) return
  const L = paletas()
  const i = ROLES.indexOf(rol)
  if (i < 0) return
  const tabla = [L.piel, L.ropa, L.ropaOsc, L.pelo]
  if (i < 4) {
    const c = librea.colores[i]
    o.material = tabla[i].find(m => m.color === c) || o.material
  } else {
    o.material = (i === 4 ? L.bando : L.bandoOsc)[bando] || o.material
  }
}

// ════════════════════════════════════════════════════════════════════════
//  ANIMACIÓN
// ════════════════════════════════════════════════════════════════════════

/** Registro de todo lo que se anima. Array plano: se recorre 60 veces por segundo. */
const vivos = []

/** Envuelve una figura con su estado de animación. */
function animar (fig, opciones = {}) {
  const meta = fig.userData.meta || {}
  const f = {
    raiz: fig,
    tipo: fig.userData.tipo,
    familia: meta.familia || 'bipedo',
    cadera: meta.cadera ?? CADERA,
    gesto: meta.gesto || 'generico',
    ritmo: meta.ritmo || 7,
    amplitud: meta.amplitud ?? 0.6,
    poseD: meta.poseD || 0,
    poseI: meta.poseI || 0,
    fase: Math.random() * TAU,
    estado: opciones.estado || 'parado',
    simple: ctx.calidad === 'bajo',
    // nivel de detalle: `lejos` es la malla única; `cerca`, los huesos articulados
    lejos: fig.getObjectByName(NOMBRE_LEJOS) || null,
    cerca: fig.children.filter(h => h.name !== NOMBRE_LEJOS),
    lejano: false,
    oculto: false,
    pasaTope: true,
    // interpolación de posición: origen -> destino en `dur` segundos
    x: 0, y: 0, z: 0, salto: 0,
    ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0, dur: 0, tl: 1, vel: 0,
    ang: 0, angObj: 0,
    tEstado: 0,      // segundos que quedan de un estado temporal (celebrar, etc.)
    estadoBase: 'parado',
    cuerpo: fig.getObjectByName('cuerpo'),
    cabeza: fig.getObjectByName('cabeza'),
    torso: fig.getObjectByName('torso'),
    piernaI: fig.getObjectByName('piernaI'),
    piernaD: fig.getObjectByName('piernaD'),
    brazoI: fig.getObjectByName('brazoI'),
    brazoD: fig.getObjectByName('brazoD'),
    fardo: fig.getObjectByName('fardo'),
    arco: fig.getObjectByName('arco'),
    brazoMaq: meta.brazo ? fig.getObjectByName(meta.brazo) : null,
    patas: null,
    ruedas: null
  }
  if (meta.familia === 'maquina') {
    f.ruedas = []
    fig.traverse((o) => { if (o.isGroup && o.name === 'rueda') f.ruedas.push(o) })
  }
  if (meta.patas) {
    f.patas = []
    for (const n of meta.patas) { const p = fig.getObjectByName(n); if (p) f.patas.push(p) }
  }
  if (f.fardo) {
    f.fardoPartes = {
      saco: f.fardo.getObjectByName('saco'),
      tronco1: f.fardo.getObjectByName('tronco1'),
      tronco2: f.fardo.getObjectByName('tronco2'),
      roca: f.fardo.getObjectByName('roca')
    }
  }
  vivos.push(f)
  return f
}

function olvidar (f) {
  const i = vivos.indexOf(f)
  if (i >= 0) vivos.splice(i, 1)
  if (f.raiz.parent) f.raiz.parent.remove(f.raiz)
  // las geometrías y los materiales son COMPARTIDOS: aquí no se libera nada
}

/** Coloca la figura de golpe, sin interpolar (aparición, formación, batalla). */
function plantar (f, x, y, z, angulo = 0) {
  f.x = x; f.y = y; f.z = z
  f.ox = x; f.oy = y; f.oz = z
  f.dx = x; f.dy = y; f.dz = z
  f.tl = 1; f.dur = 0; f.vel = 0
  f.ang = angulo; f.angObj = angulo
  f.raiz.position.set(x, y, z)
  f.raiz.rotation.y = angulo
}

/** Manda la figura a un punto: llega en `dur` segundos, girando hacia allá. */
function caminarA (f, x, y, z, dur) {
  f.ox = f.x; f.oy = f.y; f.oz = f.z
  f.dx = x; f.dy = y; f.dz = z
  f.dur = Math.max(0.05, dur)
  f.tl = 0
  const ddx = x - f.ox
  const ddz = z - f.oz
  const d = Math.hypot(ddx, ddz)
  f.vel = d / f.dur
  if (d > 0.01) f.angObj = Math.atan2(ddx, ddz)
}

/** Golpe con peso: sube despacio, cae de golpe y descansa un instante. */
function cicloGolpe (ph) {
  const u = ph / TAU - Math.floor(ph / TAU)
  if (u < 0.62) return 1 - Math.cos((u / 0.62) * Math.PI * 0.5)
  if (u < 0.8) { const k = (u - 0.62) / 0.18; return 1 - k * k }
  return 0
}

const _lerpAng = (a, b, k) => {
  let d = b - a
  while (d > Math.PI) d -= TAU
  while (d < -Math.PI) d += TAU
  return a + d * k
}

function mover (f, dt) {
  if (f.tl < 1) {
    f.tl = Math.min(1, f.tl + dt / f.dur)
    // suavizado en la llegada: nadie frena en seco
    const k = f.tl
    f.x = f.ox + (f.dx - f.ox) * k
    f.y = f.oy + (f.dy - f.oy) * k
    f.z = f.oz + (f.dz - f.oz) * k
  } else if (f.vel > 0) {
    f.vel = 0
  }
  f.raiz.position.set(f.x, f.y + f.salto, f.z)
  if (f.ang !== f.angObj) {
    f.ang = _lerpAng(f.ang, f.angObj, Math.min(1, dt * 9))
    f.raiz.rotation.y = f.ang
  }
}

function animarBipedo (f, t) {
  const p = f
  const ph = f.fase + t * f.ritmo
  const s = f.estado
  f.salto = 0
  // el arco se lleva siempre de canto: se contrarresta el giro del brazo
  if (f.arco && p.brazoI) f.arco.rotation.x = -p.brazoI.rotation.x
  // al dormir se sienta: hay que bajar TAMBIÉN el pivote de las piernas, que
  // cuelga de la raíz y no del cuerpo, o el aldeano se queda flotando sentado
  const baja = s === 'durmiendo' ? -0.16 : 0
  if (p.piernaI) p.piernaI.position.y = f.cadera + baja
  if (p.piernaD) p.piernaD.position.y = f.cadera + baja

  if (s === 'andando' || s === 'cargando') {
    const carga = s === 'cargando'
    const paso = Math.sin(ph)
    const amp = f.amplitud * (carga ? 0.68 : 1)
    if (p.piernaI) p.piernaI.rotation.x = -paso * amp
    if (p.piernaD) p.piernaD.rotation.x = paso * amp
    if (p.cuerpo) {
      // el rebote va al DOBLE de ritmo que la zancada (sube en cada pisada) y
      // la figura entera sube con él: sin eso el paso parece de patinete
      p.cuerpo.position.y = f.cadera + Math.abs(Math.cos(ph)) * (carga ? 0.022 : 0.042)
      p.cuerpo.rotation.z = paso * (carga ? 0.03 : 0.07)
      // el que va cargado se dobla hacia delante y se contonea menos
      p.cuerpo.rotation.x = carga ? 0.26 : 0.05
      p.cuerpo.rotation.y = -paso * 0.12
      p.cuerpo.position.z = 0
    }
    f.salto = carga ? 0 : Math.max(0, Math.cos(ph)) * 0.012
    if (!f.simple) {
      // cargando: un brazo sujeta el fardo del hombro y el otro hace contrapeso
      if (p.brazoD) { p.brazoD.rotation.x = carga ? -2.25 : f.poseD + paso * 0.55; p.brazoD.rotation.z = carga ? -0.25 : 0; p.brazoD.rotation.y = 0 }
      if (p.brazoI) { p.brazoI.rotation.x = carga ? -0.9 : f.poseI - paso * 0.55; p.brazoI.rotation.z = carga ? 0.2 : 0; p.brazoI.rotation.y = 0 }
      if (p.cabeza) { p.cabeza.rotation.x = carga ? -0.18 : 0; p.cabeza.rotation.y = -paso * 0.07 }
    }
    return
  }

  if (s === 'trabajando') {
    const g = f.gesto
    if (g === 'segar') {
      const barrido = Math.sin(ph)
      if (p.cuerpo) {
        p.cuerpo.rotation.x = 0.38
        p.cuerpo.rotation.y = barrido * 0.3
        p.cuerpo.position.y = f.cadera - 0.02
        p.cuerpo.rotation.z = 0
      }
      if (p.brazoD) { p.brazoD.rotation.x = -0.85; p.brazoD.rotation.y = barrido * 0.9; p.brazoD.rotation.z = 0.3 }
      if (p.brazoI) { p.brazoI.rotation.x = -0.5; p.brazoI.rotation.y = barrido * 0.5 }
      if (p.piernaI) p.piernaI.rotation.x = -0.18
      if (p.piernaD) p.piernaD.rotation.x = 0.12
      if (p.cabeza) p.cabeza.rotation.x = -0.25
      return
    }
    if (g === 'generico' || g === 'otear' || g === 'rezar') {
      const r = Math.sin(t * 2.4 + f.fase)
      if (p.cuerpo) { p.cuerpo.rotation.x = 0.2; p.cuerpo.rotation.y = r * 0.18; p.cuerpo.position.y = f.cadera - 0.02 }
      if (p.brazoD) p.brazoD.rotation.x = -1.1 + r * 0.35
      if (p.brazoI) p.brazoI.rotation.x = -1.1 - r * 0.35
      return
    }
    // hachazo, picar, martillar: todo golpe, cambia el brío.
    // El alza sube despacio (anticipación), cae de golpe y descansa: eso es lo
    // que le da PESO. El tronco gira con el brazo y la cabeza mira al tajo.
    const alza = cicloGolpe(ph)
    const aDos = g !== 'martillar'
    if (p.cuerpo) {
      p.cuerpo.rotation.x = 0.18 + (1 - alza) * 0.26
      p.cuerpo.position.y = f.cadera - (1 - alza) * 0.03
      p.cuerpo.rotation.y = alza * (aDos ? 0.2 : 0.1)
      p.cuerpo.rotation.z = -alza * 0.1
      p.cuerpo.position.z = 0
    }
    if (p.brazoD) { p.brazoD.rotation.x = -0.15 - alza * 2.35; p.brazoD.rotation.y = 0; p.brazoD.rotation.z = 0 }
    if (p.brazoI) { p.brazoI.rotation.x = aDos ? -0.1 - alza * 2.0 : f.poseI; p.brazoI.rotation.y = 0; p.brazoI.rotation.z = 0 }
    // las piernas se afianzan: la de atrás se estira en el golpe
    if (p.piernaI) p.piernaI.rotation.x = -0.18 - alza * 0.1
    if (p.piernaD) p.piernaD.rotation.x = 0.18
    if (p.cabeza) p.cabeza.rotation.x = -0.28 - alza * 0.12
    return
  }

  if (s === 'luchando') {
    const golpe = cicloGolpe(ph * 1.5)
    const g = f.gesto
    if (p.cuerpo) {
      p.cuerpo.position.y = f.cadera + Math.abs(Math.sin(ph * 2)) * 0.012
      p.cuerpo.rotation.x = 0.1
      p.cuerpo.rotation.z = 0
    }
    if (g === 'lanzazo' || g === 'ballesta') {
      // estocada: el cuerpo entero se va hacia delante
      if (p.cuerpo) { p.cuerpo.rotation.y = golpe * 0.2; p.cuerpo.position.z = golpe * 0.07 }
      if (p.brazoD) { p.brazoD.rotation.x = -1.3 + golpe * 0.5; p.brazoD.rotation.y = 0; p.brazoD.rotation.z = 0 }
      if (p.brazoI) p.brazoI.rotation.x = -1.0
    } else if (g === 'disparar') {
      if (p.cuerpo) { p.cuerpo.rotation.y = -0.35; p.cuerpo.position.z = 0 }
      if (p.brazoI) { p.brazoI.rotation.x = -1.5; p.brazoI.rotation.z = 0 }
      if (p.brazoD) { p.brazoD.rotation.x = -1.2 - golpe * 0.35; p.brazoD.rotation.y = golpe * 0.5 }
    } else {
      if (p.cuerpo) { p.cuerpo.rotation.y = golpe * 0.4; p.cuerpo.position.z = golpe * 0.04 }
      if (p.brazoD) { p.brazoD.rotation.x = -0.25 - golpe * 2.0; p.brazoD.rotation.z = -golpe * 0.5 }
      if (p.brazoI) { p.brazoI.rotation.x = -1.05; p.brazoI.rotation.z = 0 }
    }
    if (p.piernaI) p.piernaI.rotation.x = -0.2 - golpe * 0.15
    if (p.piernaD) p.piernaD.rotation.x = 0.22
    return
  }

  if (s === 'celebrando') {
    const brinco = Math.abs(Math.sin(ph * 0.9))
    f.salto = brinco * 0.12
    if (p.cuerpo) {
      p.cuerpo.position.y = f.cadera + brinco * 0.015
      p.cuerpo.rotation.y = Math.sin(ph * 0.45) * 0.35
      p.cuerpo.rotation.x = -0.08
      p.cuerpo.rotation.z = 0
      p.cuerpo.position.z = 0
    }
    if (p.brazoI) { p.brazoI.rotation.x = -2.45 - brinco * 0.35; p.brazoI.rotation.z = 0.4 }
    if (p.brazoD) { p.brazoD.rotation.x = -2.45 - brinco * 0.35; p.brazoD.rotation.z = -0.4 }
    if (p.piernaI) p.piernaI.rotation.x = -brinco * 0.4
    if (p.piernaD) p.piernaD.rotation.x = -brinco * 0.3
    if (p.cabeza) p.cabeza.rotation.x = -0.2
    return
  }

  if (s === 'durmiendo') {
    const resp = Math.sin(t * 0.9 + f.fase)
    if (p.cuerpo) {
      p.cuerpo.position.y = f.cadera - 0.16 + resp * 0.012
      p.cuerpo.rotation.x = 0.4
      p.cuerpo.rotation.y = 0
      p.cuerpo.rotation.z = 0.1
      p.cuerpo.position.z = -0.06
    }
    if (p.piernaI) p.piernaI.rotation.x = -1.45
    if (p.piernaD) p.piernaD.rotation.x = -1.3
    if (p.brazoI) { p.brazoI.rotation.x = 0.25; p.brazoI.rotation.z = 0.2 }
    if (p.brazoD) { p.brazoD.rotation.x = 0.2; p.brazoD.rotation.z = -0.2 }
    if (p.cabeza) { p.cabeza.rotation.x = 0.5; p.cabeza.rotation.y = 0.2 }
    return
  }

  if (s === 'charlando') {
    // DOS QUE SE PARAN A HABLAR. Uno lleva la voz cantante y el otro asiente:
    // el desfase de la semilla hace que nunca gesticulen a la vez.
    const habla = Math.sin(ph * 0.55)
    const gesto = Math.max(0, habla)
    if (p.cuerpo) {
      p.cuerpo.position.y = f.cadera + Math.sin(t * 1.6 + f.fase) * 0.008
      p.cuerpo.rotation.y = habla * 0.12
      p.cuerpo.rotation.x = 0.04
      p.cuerpo.rotation.z = 0
      p.cuerpo.position.z = 0
    }
    if (p.piernaI) p.piernaI.rotation.x = 0.05
    if (p.piernaD) p.piernaD.rotation.x = -0.05
    if (!f.simple) {
      if (p.brazoD) { p.brazoD.rotation.x = f.poseD - 0.5 - gesto * 0.75; p.brazoD.rotation.z = -0.35 - gesto * 0.2 }
      if (p.brazoI) { p.brazoI.rotation.x = f.poseI - 0.15; p.brazoI.rotation.z = 0.2 }
      // asiente al ritmo de lo que dice el otro
      if (p.cabeza) { p.cabeza.rotation.x = Math.sin(ph * 1.1) * 0.12; p.cabeza.rotation.y = habla * 0.15 }
    }
    return
  }

  if (s === 'cayendo') return   // lo gobierna la batalla

  // parado: respira, echa un vistazo alrededor y de vez en cuando se despereza
  const resp = Math.sin(t * 1.7 + f.fase)
  // el descanso sale de la propia fase, sin estado ni temporizador: cada figura
  // se estira en un momento distinto y no cuesta ni una variable más
  const pausa = Math.sin(t * 0.21 + f.fase * 2.7)
  const estira = pausa > 0.965 ? (pausa - 0.965) / 0.035 : 0
  if (p.cuerpo) {
    p.cuerpo.position.y = f.cadera + resp * 0.007 + estira * 0.03
    p.cuerpo.position.z = 0
    p.cuerpo.rotation.set(-estira * 0.18, 0, 0)
  }
  if (p.piernaI) p.piernaI.rotation.x = 0
  if (p.piernaD) p.piernaD.rotation.x = 0
  if (!f.simple) {
    if (p.torso) p.torso.scale.y = 1 + resp * 0.02
    if (p.cabeza) {
      const giro = Math.sin(t * 0.37 + f.fase)
      // pausa-giro-pausa: un seno pelado parecería un ventilador
      p.cabeza.rotation.y = Math.sign(giro) * Math.pow(Math.abs(giro), 0.35) * 0.5
      p.cabeza.rotation.x = resp * 0.03 - estira * 0.3
    }
    if (p.brazoD) { p.brazoD.rotation.x = f.poseD + resp * 0.04 - estira * 2.3; p.brazoD.rotation.y = 0; p.brazoD.rotation.z = -estira * 0.3 }
    if (p.brazoI) { p.brazoI.rotation.x = f.poseI - resp * 0.04 - estira * 2.3; p.brazoI.rotation.y = 0; p.brazoI.rotation.z = estira * 0.3 }
  }
}

function animarMonje (f, t) {
  const ph = f.fase + t * f.ritmo
  f.salto = 0
  const p = f
  if (f.estado === 'andando' || f.estado === 'cargando') {
    // sin piernas a la vista: el hábito se mece y el cuerpo cabecea
    if (p.cuerpo) {
      p.cuerpo.position.y = f.cadera + Math.abs(Math.sin(ph * 1.6)) * 0.02
      p.cuerpo.rotation.z = Math.sin(ph * 1.6) * 0.05
      p.cuerpo.rotation.x = 0.06
    }
    return
  }
  if (f.estado === 'celebrando') {
    const brinco = Math.abs(Math.sin(ph * 0.8))
    f.salto = brinco * 0.06
    if (p.brazoI) p.brazoI.rotation.x = -2.3
    if (p.brazoD) p.brazoD.rotation.x = -2.3
    return
  }
  const resp = Math.sin(t * 1.2 + f.fase)
  if (p.cuerpo) {
    p.cuerpo.position.y = f.cadera + resp * 0.008
    p.cuerpo.rotation.z = 0
    p.cuerpo.rotation.x = 0.04 + resp * 0.02
  }
  if (p.cabeza) p.cabeza.rotation.x = 0.12 + resp * 0.04
  if (!f.simple) {
    if (p.brazoI) p.brazoI.rotation.x = -1.25 + resp * 0.05
    if (p.brazoD) p.brazoD.rotation.x = -1.25 + resp * 0.05
  }
}

function animarJinete (f, t) {
  const ph = f.fase + t * f.ritmo
  f.salto = 0
  const galope = f.estado === 'andando' || f.estado === 'cargando'
  if (f.patas) {
    if (galope) {
      const a = Math.sin(ph)
      const b = Math.sin(ph + 2.1)
      f.patas[0].rotation.x = a * 0.75
      f.patas[3].rotation.x = a * 0.75
      f.patas[1].rotation.x = b * 0.75
      f.patas[2].rotation.x = b * 0.75
      f.salto = Math.abs(Math.sin(ph * 2)) * 0.035
    } else {
      const q = Math.sin(t * 1.4 + f.fase) * 0.05
      f.patas[0].rotation.x = q
      f.patas[1].rotation.x = -q
      f.patas[2].rotation.x = 0
      f.patas[3].rotation.x = 0
    }
  }
  const p = f
  if (f.estado === 'luchando') {
    const golpe = cicloGolpe(ph * 1.3)
    if (p.brazoD) p.brazoD.rotation.x = -1.45 + golpe * 0.7
    if (p.cuerpo) { p.cuerpo.rotation.x = 0.12 - golpe * 0.1; p.cuerpo.rotation.y = golpe * 0.12 }
    return
  }
  if (f.estado === 'celebrando') {
    f.salto = Math.abs(Math.sin(ph * 0.8)) * 0.1
    if (p.brazoD) p.brazoD.rotation.x = -2.2
    if (f.patas) { f.patas[0].rotation.x = -0.8; f.patas[1].rotation.x = -0.8 }
    return
  }
  const resp = Math.sin(t * 1.5 + f.fase)
  if (p.cuerpo) { p.cuerpo.rotation.x = galope ? 0.12 : 0.02 + resp * 0.02; p.cuerpo.rotation.y = 0 }
  if (p.brazoD) p.brazoD.rotation.x = f.poseD + resp * 0.03
  if (p.cabeza) p.cabeza.rotation.y = f.simple ? 0 : Math.sin(t * 0.4 + f.fase) * 0.3
}

/**
 * Animación de la silueta lejana: no tiene huesos que mover, así que la vida se
 * la da el paso — un balanceo del bulto entero al ritmo de la zancada. A treinta
 * píxeles de alto es exactamente lo que se ve de un aldeano andando.
 */
function animarLejos (f, t) {
  const anda = f.estado === 'andando' || f.estado === 'cargando'
  if (!anda) {
    if (f.salto !== 0) { f.salto = 0; f.raiz.position.y = f.y }
    if (f.raiz.rotation.z !== 0) f.raiz.rotation.z = 0
    return
  }
  const ph = f.fase + t * f.ritmo
  f.salto = Math.abs(Math.cos(ph)) * 0.03
  f.raiz.position.y = f.y + f.salto
  f.raiz.rotation.z = Math.sin(ph) * 0.05
}

function animarMaquina (f, t, dt) {
  f.salto = 0
  const ph = f.fase + t * f.ritmo
  if (f.vel > 0 && f.ruedas) {
    // las ruedas giran con lo que avanza la máquina: si no, parece que patina
    const giro = f.vel * dt * 5.2
    for (let i = 0; i < f.ruedas.length; i++) f.ruedas[i].rotation.x += giro
    if (f.cuerpo) f.cuerpo.position.y = Math.abs(Math.sin(ph * 3)) * 0.012
  }
  if (!f.brazoMaq) return
  if (f.estado === 'luchando') {
    const golpe = cicloGolpe(ph)
    if (f.gesto === 'embestir') {
      f.brazoMaq.position.z = -golpe * 0.28
      f.brazoMaq.rotation.x = -golpe * 0.1
    } else {
      f.brazoMaq.rotation.x = 0.85 - golpe * 2.1
    }
  } else if (f.gesto === 'embestir') {
    f.brazoMaq.position.z = Math.sin(t * 1.1 + f.fase) * 0.02
  } else {
    f.brazoMaq.rotation.x = 0.85 + Math.sin(t * 0.8 + f.fase) * 0.03
  }
}

// ════════════════════════════════════════════════════════════════════════
//  ALDEANOS: enganche con la simulación
// ════════════════════════════════════════════════════════════════════════

const porAldeano = new Map()   // id del villager -> figura animada
let raizGente = null
let raizTropa = null
let raizBatalla = null
let alturaTerreno = null       // alturaEn(x,z) de terrain.js, si está disponible

const sueloEn = (gx, gz) => {
  if (!alturaTerreno) return 0
  try { return alturaTerreno(gx, gz) } catch (e) { return 0 }
}

/** Traduce el `job` del estado al oficio que sabe dibujar este módulo. */
const OFICIOS = {
  serreria: 'lenador', lenador: 'lenador', leñador: 'lenador', madera: 'lenador', talar: 'lenador',
  cantera: 'cantero', cantero: 'cantero', piedra: 'cantero',
  granja: 'granjero', granjero: 'granjero', comida: 'granjero', molino: 'granjero', molinero: 'granjero',
  mina_oro: 'minero', mina: 'minero', minero: 'minero', oro: 'minero',
  obra: 'constructor', constructor: 'constructor', construir: 'constructor', albanil: 'constructor'
}
const oficioDe = (v) => {
  if (!v) return null
  const j = (v.job || v.oficio || '').toString().toLowerCase()
  if (OFICIOS[j]) return OFICIOS[j]
  if (j.includes('mader') || j.includes('leñ') || j.includes('len')) return 'lenador'
  if (j.includes('piedra') || j.includes('cant')) return 'cantero'
  if (j.includes('comid') || j.includes('granj') || j.includes('trig')) return 'granjero'
  if (j.includes('oro') || j.includes('min')) return 'minero'
  if (j.includes('obra') || j.includes('constr')) return 'constructor'
  return null
}

/** Traduce el `estado` del villager al estado de animación. */
function estadoDe (v, f) {
  const e = (v.estado || '').toString().toLowerCase()
  const carga = v.portando && v.portando.cant > 0
  // ojo: en sim/villagers.js 'descansando' es estar de pie sin faena, NO dormir
  if (e.includes('descans') || e.includes('parado') || e.includes('espera')) return 'parado'
  if (e.includes('durm') || e.includes('duerm') || e.includes('dorm')) return 'durmiendo'
  if (e.includes('celebr') || e.includes('fiesta')) return 'celebrando'
  if (e.includes('lucha') || e.includes('combat') || e.includes('defend')) return 'luchando'
  if (e.includes('trabaj') || e.includes('tala') || e.includes('pica') || e.includes('sieg') ||
      e.includes('recolect') || e.includes('mina') || e.includes('constru') || e.includes('faena')) {
    return 'trabajando'
  }
  if (e.includes('camin') || e.includes('anda') || e.includes('yendo') || e.includes('vuelve') ||
      e.includes('volv') || e.includes('mueve') || e.includes('rumbo')) {
    return carga ? 'cargando' : 'andando'
  }
  // sin vocabulario reconocible, manda el movimiento real
  if (f && f.tl < 1 && f.vel > 0.05) return carga ? 'cargando' : 'andando'
  return 'parado'
}

/** Enseña (o esconde) el fardo según lo que lleve encima. */
function ponerFardo (f, portando) {
  if (!f.fardo) return
  const hay = !!(portando && portando.cant > 0)
  f.fardo.visible = hay
  f.fardo.matrixWorldAutoUpdate = hay   // sin carga, el fardo ni se recalcula
  if (!hay) return
  const tipo = portando.tipo
  const q = f.fardoPartes
  const madera = tipo === 'madera'
  const roca = tipo === 'piedra'
  if (q.saco) q.saco.visible = !madera && !roca
  if (q.tronco1) q.tronco1.visible = madera
  if (q.tronco2) q.tronco2.visible = madera
  if (q.roca) q.roca.visible = roca
  if (q.saco && q.saco.visible) {
    q.saco.material = tipo === 'oro' ? mat(PALETA.oro) : mat(PALETA.paja)
  }
}

function nacerAldeano (v) {
  if (!v || porAldeano.has(v.id)) return null
  const oficio = oficioDe(v)
  const semilla = semillaDe(v.id)
  const fig = crearUnidad('aldeano', { bando: 'jugador', oficio, semilla })
  const f = animar(fig)
  f.villagerId = v.id
  f.oficio = oficio
  const w = gridAMundo(v.x ?? 0, v.z ?? 0)
  plantar(f, w.x, sueloEn(v.x ?? 0, v.z ?? 0), w.z, Math.random() * TAU)
  f.estadoBase = 'parado'
  f.estado = estadoDe(v, f)
  ponerFardo(f, v.portando)
  ;(raizGente || ctx.raizAldea || ctx.scene).add(fig)
  porAldeano.set(v.id, f)
  aplicarTope()
  return f
}

/** Semilla estable a partir del id: el mismo aldeano viste siempre igual. */
function semillaDe (id) {
  let h = 2166136261
  const s = String(id)
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) % 99991
}

function morirAldeano (id) {
  const f = porAldeano.get(id)
  if (!f) return
  porAldeano.delete(id)
  olvidar(f)
}

/** Cambia de oficio: se rehace la figura para que cargue su herramienta. */
function revestirAldeano (v) {
  const f = porAldeano.get(v.id)
  const oficio = oficioDe(v)
  if (!f) { nacerAldeano(v); return }
  if (f.oficio === oficio) return
  const x = f.x, y = f.y, z = f.z, ang = f.ang
  morirAldeano(v.id)
  const nuevo = nacerAldeano(v)
  if (nuevo) plantar(nuevo, x, y, z, ang)
}

/** Techo de figuras: lo que pase del tope se esconde (y deja de animarse). */
function aplicarTope () {
  const tope = TOPE_FIGURAS[ctx.calidad] || TOPE_FIGURAS.medio
  let n = 0
  for (let i = 0; i < vivos.length; i++) {
    const f = vivos[i]
    if (f.siempreVisible) { f.pasaTope = true; continue }
    f.pasaTope = ++n <= tope
  }
  repasarVisibles(true)
}

// ── quién se ve y con cuánto detalle ──────────────────────────────────────
/**
 * Lo más caro de una aldea llena no es animar: es dibujar. Aquí se decide, unas
 * doce veces por segundo, qué figuras caen dentro de la cámara (las de fuera se
 * apagan enteras de un plumazo) y cuáles están tan lejos que les basta con su
 * versión de una sola malla.
 */
const NOMBRE_LEJOS = '__lejos'
const DIST_LEJOS = 24            // unidades de mundo: más allá, silueta simplificada
const SEG_REPASO = 0.08
const _frustum = new THREE.Frustum()
const _mVP = new THREE.Matrix4()
const _esferaFig = new THREE.Sphere(new THREE.Vector3(), 1.2)
let relojRepaso = 0

/**
 * Cambia entre la figura articulada y la silueta de una malla. La rama que no
 * toca se SACA del árbol, no se esconde: un hijo invisible sigue costando una
 * visita en cada recorrido de la escena, y con sesenta figuras eso son cientos
 * de visitas por frame para nada. Solo se toca al cruzar la frontera.
 */
function ponerDetalle (f, lejos) {
  if (f.lejano === lejos || !f.lejos) return
  f.lejano = lejos
  if (lejos) {
    for (let i = 0; i < f.cerca.length; i++) f.raiz.remove(f.cerca[i])
    f.lejos.visible = true
  } else {
    for (let i = 0; i < f.cerca.length; i++) f.raiz.add(f.cerca[i])
    f.lejos.visible = false
  }
}

function repasarVisibles (forzar = false) {
  const cam = ctx.camera
  if (!cam) return
  _mVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
  _frustum.setFromProjectionMatrix(_mVP)
  const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z
  const lod2 = DIST_LEJOS * DIST_LEJOS
  for (let i = 0; i < vivos.length; i++) {
    const f = vivos[i]
    _esferaFig.center.set(f.x, f.y + 0.5, f.z)
    const dentro = (f.pasaTope !== false) && _frustum.intersectsSphere(_esferaFig)
    if (dentro !== !f.oculto || forzar) {
      f.oculto = !dentro
      f.raiz.visible = dentro
      // fuera de cámara la figura entera deja de existir para el motor
      f.raiz.matrixWorldAutoUpdate = dentro
    }
    if (!dentro) continue
    const dx = f.x - cx, dy = f.y - cy, dz = f.z - cz
    ponerDetalle(f, dx * dx + dy * dy + dz * dz > lod2)
  }
}

// ════════════════════════════════════════════════════════════════════════
//  GUARNICIÓN: el ejército a la vista, junto al cuartel
// ════════════════════════════════════════════════════════════════════════

const guarnicion = []
const banderas = []
let estandarte = null                 // el primer estandarte, para lo que ya lo miraba
let reunion = { x: 0, z: 0 }          // casilla del estandarte, según sim/army.js
let moviendo = null                   // id del escuadrón al que se le está buscando sitio
let modArmy = null                    // sim/army.js, cargado de forma tolerante

/**
 * LOS ESCUADRONES A LA VISTA. Ya no hay UNA formación junto al cuartel: hay
 * varias, cada una plantada en su flanco. Desde la cámara del juego todas son
 * el mismo bulto con casco, así que lo único que las distingue es el PAÑO: el
 * estandarte de su puesto y las dos banderolas que enmarcan la formación.
 * Seis tonos bien separados y ninguno es el granate del enemigo.
 */
const COLORES_ESCUADRON = [
  PALETA.estandarte, PALETA.oro, PALETA.telaVerde,
  PALETA.ropaAldeana, PALETA.cobre, PALETA.maderaClara
]
/** El color va pegado al ID, no al orden: disolver uno no repinta a los demás. */
function colorEscuadron (id, i = 0) {
  const m = /(\d+)/.exec(String(id || ''))
  const k = m ? Number(m[1]) - 1 : i
  const n = COLORES_ESCUADRON.length
  return COLORES_ESCUADRON[((k % n) + n) % n]
}

const estandartes = new Map()         // id de escuadrón → su poste, para encenderlo
let puestosEscuadron = []             // [{ id, nombre, cometido, x, z, color }]
const ORDEN_FORMACION = ['lancero', 'espadachin', 'arquero', 'ballestero', 'monje', 'explorador', 'jinete', 'caballero', 'ariete', 'catapulta']
const TOPE_GUARNICION = { bajo: 18, medio: 34, alto: 48 }

/**
 * EL ESTANDARTE DE BATALLA. No es un adorno: es el mando con el que el jugador
 * mueve su ejército por la aldea, así que tiene que verse desde lejos y cantar
 * que se puede tocar. Debajo lleva su casilla marcada, como el fantasma de obra.
 */
function crearEstandarteBatalla (color = PALETA.estandarte, cometido = 'defensa') {
  const g = new THREE.Group()
  g.name = 'estandarte-batalla'
  const huella = pieza(G.caja, mat(color, { transparente: 0.5 }),
    { y: 0.03, sx: 0.94, sy: 0.05, sz: 0.94, sombra: false })
  huella.name = 'huella'
  g.add(huella)
  g.add(pieza(G.cilindro, mat(PALETA.piedraOscura), { y: 0.1, sx: 0.44, sy: 0.2, sz: 0.44 }))
  g.add(pieza(G.cilindro6, mat(PALETA.madera), { y: 0.95, sx: 0.075, sy: 1.7, sz: 0.075 }))
  g.add(pieza(G.cono8, mat(PALETA.oro), { y: 1.86, sx: 0.14, sy: 0.24, sz: 0.14 }))
  const pano = pieza(G.caja, mat(color), { x: 0.3, y: 1.42, sx: 0.6, sy: 0.62, sz: 0.03 })
  pano.name = 'pano'
  g.add(pano)
  g.add(pieza(G.caja, mat(PALETA.oro), { x: 0.3, y: 1.42, z: 0.022, sx: 0.2, sy: 0.34, sz: 0.012 }))
  // El cometido se lee sin abrir ningún panel: lanza cruzada el que sale a los
  // asaltos, escudo clavado el que no se mueve de la aldea.
  if (cometido === 'ataque') {
    g.add(pieza(G.cilindro6, mat(PALETA.hierro), { x: -0.3, y: 1.15, rz: 0.55, sx: 0.05, sy: 1.5, sz: 0.05 }))
    g.add(pieza(G.cono6, mat(PALETA.metalTropa), { x: -0.68, y: 1.75, rz: 0.55, sx: 0.12, sy: 0.26, sz: 0.12 }))
  } else {
    g.add(pieza(GL.disco, mat(PALETA.metalTropa), { x: -0.3, y: 0.95, rz: Math.PI / 2, sx: 0.5, sy: 0.07, sz: 0.5 }))
    g.add(pieza(GL.disco, mat(color), { x: -0.34, y: 0.95, rz: Math.PI / 2, sx: 0.3, sy: 0.05, sz: 0.3 }))
  }
  banderas.push({ malla: pano, fase: banderas.length * 1.1 })
  return g
}

/** Banderola de formación: palo, moharra y paño del escuadrón, que ondea. */
function banderola (color = PALETA.estandarte) {
  const g = new THREE.Group()
  g.add(pieza(G.cilindro6, mat(PALETA.madera), { y: 0.7, sx: 0.055, sy: 1.4, sz: 0.055 }))
  g.add(pieza(G.cono6, mat(PALETA.oro), { y: 1.48, sx: 0.1, sy: 0.18, sz: 0.1 }))
  const pano = pieza(G.caja, mat(color), { x: 0.19, y: 1.13, sx: 0.38, sy: 0.42, sz: 0.025 })
  pano.name = 'pano'
  g.add(pano)
  banderas.push({ malla: pano, fase: banderas.length * 1.7 })
  return g
}

function limpiarGuarnicion () {
  for (const f of guarnicion) olvidar(f)
  guarnicion.length = 0
  estandarte = null
  estandartes.clear()
  puestosEscuadron = []
  if (raizTropa) {
    for (let i = raizTropa.children.length - 1; i >= 0; i--) {
      const h = raizTropa.children[i]
      if (!h.userData.meta) raizTropa.remove(h)
    }
  }
  banderas.length = 0
}

/**
 * Coloca la tropa entrenada formando junto al cuartel, con estandarte.
 * @param {{[tipo:string]: number}} [tropas] por defecto, las del estado.
 */
export function mostrarGuarnicion (tropas) {
  if (!ctx.listo) { cuandoListo(() => mostrarGuarnicion(tropas)); return }
  limpiarGuarnicion()
  const tope = TOPE_GUARNICION[ctx.calidad] || TOPE_GUARNICION.medio

  // DÓNDE se planta cada soldado ya NO lo decide el render. sim/army.js lleva el
  // mapa del suelo (edificios y puertas de aldeanos) y devuelve casillas enteras
  // y libres: por decidirlo aquí a ojo, la tropa aparecía dentro del cuartel y
  // encima de la casilla por la que entran y salen los aldeanos.
  const plan = modArmy && typeof modArmy.formacionReunion === 'function'
    ? modArmy.formacionReunion(tropas, { tope })
    : null
  if (!plan) return
  reunion = { x: plan.reunion.x, z: plan.reunion.z }

  // CADA ESCUADRÓN, EN SU SITIO. sim/army.js devuelve un bloque por escuadrón
  // con su puesto y su gente ya colocada; aquí solo se pinta. Si alguien pide
  // una tropa suelta (la vista de siempre), se dibuja como un bloque más.
  const bloques = (plan.escuadrones && plan.escuadrones.length)
    ? plan.escuadrones
    : [{
        id: null, nombre: 'La hueste', cometido: 'defensa',
        reunion: plan.estandarte || plan.reunion, puestos: plan.puestos || []
      }]

  let i = 0
  for (const b of bloques) { dibujarEscuadron(b, i); i++ }
  aplicarTope()
}

/** Un escuadrón: su formación alineada, sus banderolas y su estandarte. */
function dibujarEscuadron (bloque, indice) {
  const color = colorEscuadron(bloque.id, indice)
  const p = bloque.reunion || { x: reunion.x, z: reunion.z }
  const lista = bloque.puestos || []

  // TODOS MIRANDO AL MISMO LADO. Antes cada uno se torcía un poco "para que no
  // pareciera de cartón" y el resultado era justo lo contrario: un corrillo. Una
  // tropa formada impone porque está alineada, así que se calcula UN rumbo —el
  // que va del centro de la formación a su estandarte— y lo copian todos.
  let mx = 0; let mz = 0
  for (const q of lista) { mx += q.x; mz += q.z }
  if (lista.length) { mx /= lista.length; mz /= lista.length }
  let rumbo = Math.atan2(p.x - mx, p.z - mz)
  if (!lista.length || (Math.abs(p.x - mx) < 0.2 && Math.abs(p.z - mz) < 0.2)) rumbo = 0

  for (let i = 0; i < lista.length; i++) {
    const q = lista[i]
    const fig = crearUnidad(q.tipo, { bando: 'jugador', semilla: i * 37 + 11 + indice * 13 })
    const f = animar(fig, { estado: 'parado' })
    f.siempreVisible = true
    const w = gridAMundo(q.x, q.z)
    plantar(f, w.x, sueloEn(q.x, q.z), w.z, rumbo)
    ;(raizTropa || ctx.raizAldea).add(fig)
    guarnicion.push(f)
  }

  // dos banderolas en los extremos de la primera fila: enmarcan la formación y
  // le dan el aire de desfile que no dan los soldados solos
  if (lista.length >= 3) {
    let minX = Infinity; let maxX = -Infinity; let zFrente = Infinity
    for (const q of lista) {
      if (q.x < minX) minX = q.x
      if (q.x > maxX) maxX = q.x
      if (q.z < zFrente) zFrente = q.z
    }
    for (const gx of [minX - 0.9, maxX + 0.9]) {
      const w = gridAMundo(gx, zFrente)
      const b = banderola(color)
      b.position.set(w.x, sueloEn(gx, zFrente), w.z)
      b.rotation.y = rumbo
      ;(raizTropa || ctx.raizAldea).add(b)
    }
  }

  // el estandarte va SIEMPRE, aunque el escuadrón esté vacío: es su puesto
  const wE = gridAMundo(p.x, p.z)
  const poste = crearEstandarteBatalla(color, bloque.cometido)
  poste.position.set(wE.x, sueloEn(p.x, p.z), wE.z)
  ;(raizTropa || ctx.raizAldea).add(poste)
  if (bloque.id) estandartes.set(bloque.id, poste)
  if (!estandarte) estandarte = poste
  puestosEscuadron.push({ id: bloque.id, nombre: bloque.nombre, cometido: bloque.cometido, x: p.x, z: p.z, color })
  if (bloque.id && moviendo === bloque.id) marcarPuesto(bloque.id, true)
}

/** El estandarte late en dorado mientras espera a que le digas dónde formar. */
function marcarPuesto (id, encendido) {
  const g = id ? estandartes.get(id) : estandarte
  const huella = g && g.getObjectByName('huella')
  if (!huella) return
  const suyo = puestosEscuadron.find(q => q.id === id)
  const base = suyo ? suyo.color : PALETA.estandarte
  huella.material = mat(encendido ? PALETA.oro : base, { transparente: encendido ? 0.75 : 0.5 })
  huella.scale.set(encendido ? 1.5 : 0.94, 0.05, encendido ? 1.5 : 0.94)
}

/** El escuadrón cuyo estandarte está a un paso de la casilla tocada. */
function puestoJuntoA (x, z) {
  for (const q of puestosEscuadron) {
    if (Math.max(Math.abs(q.x - x), Math.abs(q.z - z)) <= 1) return q
  }
  return null
}

// ── la marca de "aquí lo planto": el fantasma del panel de ejército ────────
/**
 * Mientras el jugador busca sitio para un escuadrón, el panel se aparta y deja
 * ver la aldea. Esta marca es lo único que queda en pantalla: la casilla que
 * está apuntando con el dedo, con el paño de ESE escuadrón para que no la
 * confunda con la de otro. La repinta el panel tocando la aldea (GRID_TAP).
 */
let raizMarcas = null
let plantando = null                  // { id, color } escuadrón al que se busca sitio
let marcaPuesto = null

function ponerMarca (color, x, z) {
  quitarMarca()
  if (!raizMarcas) return
  const g = new THREE.Group()
  g.name = 'marca-puesto'
  g.userData.ignorarPicking = true
  // el cerco dorado va DEBAJO y más ancho: se lee como un marco alrededor del
  // paño del escuadrón, que es lo que tiene que cantar de qué formación es
  g.add(pieza(G.caja, mat(PALETA.oro, { transparente: 0.55 }), { y: 0.04, sx: 2.2, sy: 0.04, sz: 2.2, sombra: false, recibe: false }))
  g.add(pieza(G.caja, mat(color, { transparente: 0.75 }), { y: 0.08, sx: 1.6, sy: 0.06, sz: 1.6, sombra: false, recibe: false }))
  g.add(pieza(G.cilindro6, mat(PALETA.madera, { transparente: 0.7 }), { y: 0.95, sx: 0.075, sy: 1.7, sz: 0.075, sombra: false }))
  g.add(pieza(G.caja, mat(color, { transparente: 0.7 }), { x: 0.3, y: 1.42, sx: 0.6, sy: 0.62, sz: 0.03, sombra: false }))
  marcaPuesto = g
  raizMarcas.add(g)
  moverMarca(x, z)
}

function moverMarca (x, z) {
  if (!marcaPuesto) return
  const w = gridAMundo(x, z)
  marcaPuesto.position.set(w.x, sueloEn(x, z) + 0.02, w.z)
}

function quitarMarca () {
  if (marcaPuesto && marcaPuesto.parent) marcaPuesto.parent.remove(marcaPuesto)
  marcaPuesto = null
}

/**
 * Repintar la guarnición entera cuesta lo suyo y el reparto cambia por seis
 * sitios distintos (entrenar, curar, mover tropa, plantar un puesto…). Se
 * agrupan todos los avisos de un mismo instante en un solo repintado.
 */
let repintePedido = 0
function pedirGuarnicion () {
  if (repintePedido) return
  repintePedido = setTimeout(() => { repintePedido = 0; mostrarGuarnicion() }, 60)
}

// ════════════════════════════════════════════════════════════════════════
//  BATALLA: la crónica de sim/combat.js, contada en 3D
// ════════════════════════════════════════════════════════════════════════

let batalla = null

const TROPA_POR_DEFECTO = { lancero: 4, arquero: 2, espadachin: 2 }

function limpiarBatalla () {
  if (!batalla) return
  for (const f of batalla.actores) olvidar(f)
  batalla = null
}

/** Reparte una lista de tipos a partir de un objeto { lancero: 4, ... }. */
function desplegarLista (tropas, tope) {
  const cola = []
  for (const tipo of ORDEN_FORMACION) {
    const n = Math.max(0, Math.floor((tropas && tropas[tipo]) || 0))
    for (let i = 0; i < n && cola.length < tope; i++) cola.push(tipo)
  }
  return cola
}

/**
 * Reproduce la crónica de un combate: avanzan, chocan y caen.
 * Aguanta que `sucesos` venga vacío o que sim/combat.js no exista todavía.
 * @param {Array<{t:number,tipo:string,texto?:string,x?:number,z?:number}>} sucesos
 * @param {{x?:number,z?:number,tropas?:object}} [base] dónde ocurre, en casillas
 * @returns {{parar:()=>void}}
 */
export function reproducirBatalla (sucesos, base) {
  if (!ctx.listo) { cuandoListo(() => reproducirBatalla(sucesos, base)); return { parar () {} } }
  limpiarBatalla()

  const b = base || {}
  const cx = typeof b.x === 'number' ? b.x : (CONFIG.GRID - 1) / 2
  const cz = typeof b.z === 'number' ? b.z : (CONFIG.GRID - 1) / 2
  const tope = ctx.calidad === 'bajo' ? 6 : ctx.calidad === 'alto' ? 14 : 10

  const nuestros = desplegarLista(game.state.ejercito && game.state.ejercito.tropas, tope)
  const suyos = desplegarLista(b.tropas || TROPA_POR_DEFECTO, tope)
  if (!nuestros.length) nuestros.push('lancero', 'lancero', 'arquero')
  if (!suyos.length) suyos.push('lancero', 'lancero')

  const actores = []
  const bando = (lista, esNuestro) => {
    const signo = esNuestro ? 1 : -1
    for (let i = 0; i < lista.length; i++) {
      const fila = Math.floor(i / 5)
      const col = i % 5
      const gx = cx + (col - 2) * 0.8
      const gz = cz + signo * (4.2 + fila * 0.8)
      const fig = crearUnidad(lista[i], { bando: esNuestro ? 'jugador' : 'enemigo', semilla: i * 53 + (esNuestro ? 7 : 91) })
      const f = animar(fig, { estado: 'parado' })
      f.siempreVisible = true
      f.nuestro = esNuestro
      f.gx = gx; f.gz = gz
      const w = gridAMundo(gx, gz)
      plantar(f, w.x, sueloEn(gx, gz), w.z, esNuestro ? Math.PI : 0)
      ;(raizBatalla || ctx.raizAldea).add(fig)
      actores.push(f)
    }
  }
  bando(nuestros, true)
  bando(suyos, false)

  const guion = (Array.isArray(sucesos) ? sucesos : [])
    .filter(s => s && typeof s === 'object')
    .map(s => ({ t: Number(s.t) || 0, tipo: String(s.tipo || s.clase || '').toLowerCase(), texto: s.texto, x: s.x, z: s.z }))
    .sort((a, b2) => a.t - b2.t)

  batalla = { t: 0, actores, guion, i: 0, cx, cz, fin: (guion.length ? guion[guion.length - 1].t : 9) + 4, improvisado: !guion.length }

  // todos avanzan hacia el centro: eso pasa sí o sí, haya crónica o no
  for (const f of actores) {
    const destinoZ = f.gz + (f.nuestro ? -3.0 : 3.0)
    const w = gridAMundo(f.gx, destinoZ)
    f.estado = 'andando'
    caminarA(f, w.x, sueloEn(f.gx, destinoZ), w.z, 2.6)
  }
  return { parar: limpiarBatalla }
}

/** Tumba a un actor del bando indicado (el que esté más cerca del centro). */
function abatir (nuestro) {
  if (!batalla) return
  let elegido = null
  let mejor = Infinity
  for (const f of batalla.actores) {
    if (f.nuestro !== nuestro || f.estado === 'cayendo') continue
    const d = Math.abs(f.z)
    if (d < mejor) { mejor = d; elegido = f }
  }
  if (!elegido) return
  elegido.estado = 'cayendo'
  elegido.tCaida = 0
}

function avanzarBatalla (dt, t) {
  if (!batalla) return
  batalla.t += dt
  const bt = batalla.t

  while (batalla.i < batalla.guion.length && batalla.guion[batalla.i].t <= bt) {
    const s = batalla.guion[batalla.i++]
    const k = s.tipo
    // el vocabulario es el de sim/combat.js: inicio, muro, edificio_caido,
    // bajas, siega, hito, tiempo, victoria, derrota, monjes
    if (k.includes('inicio') || k.includes('avanz') || k.includes('march')) {
      for (const f of batalla.actores) if (f.estado !== 'cayendo') f.estado = 'andando'
    } else if (k.includes('siega')) {
      for (const f of batalla.actores) if (f.estado !== 'cayendo') { f.estado = 'luchando'; f.tl = 1 }
      abatir(false)                                   // siega = caen los suyos
    } else if (k.includes('muro') || k.includes('edificio') || k.includes('hito') ||
               k.includes('choqu') || k.includes('ataq') || k.includes('golpe') || k.includes('combat')) {
      for (const f of batalla.actores) if (f.estado !== 'cayendo') { f.estado = 'luchando'; f.tl = 1 }
    } else if (k.includes('baja') || k.includes('cae') || k.includes('muer') || k.includes('herido')) {
      const texto = (s.texto || '').toLowerCase()
      abatir(!(texto.includes('enemig') || k.includes('enemig')))
    } else if (k.includes('victor') || k.includes('gana')) {
      for (const f of batalla.actores) if (f.estado !== 'cayendo' && f.nuestro) f.estado = 'celebrando'
    } else if (k.includes('derrot') || k.includes('pierd')) {
      for (const f of batalla.actores) if (f.estado !== 'cayendo' && !f.nuestro) f.estado = 'celebrando'
    }
  }

  if (batalla.improvisado) {
    // sin crónica que seguir, la escaramuza se cuenta sola
    if (bt > 2.6 && !batalla.chocaron) {
      batalla.chocaron = true
      for (const f of batalla.actores) { f.estado = 'luchando'; f.tl = 1 }
    }
    if (batalla.chocaron && bt - (batalla.ultimaBaja || 2.6) > 0.9 && bt < batalla.fin - 2) {
      batalla.ultimaBaja = bt
      abatir(Math.random() < 0.4)
    }
    if (bt > batalla.fin - 2 && !batalla.celebrado) {
      batalla.celebrado = true
      for (const f of batalla.actores) if (f.estado !== 'cayendo') f.estado = f.nuestro ? 'celebrando' : 'parado'
    }
  }

  if (bt > batalla.fin) limpiarBatalla()
}

// ════════════════════════════════════════════════════════════════════════
//  ACTORES: figuras que otro módulo dirige (el campo de batalla en 3D)
// ════════════════════════════════════════════════════════════════════════

/**
 * Una figura no la mueve siempre este módulo. En la batalla en 3D quien decide
 * a dónde va cada soldado es render/battle.js, que conoce la crónica; aquí solo
 * se presta el muñeco con sus animaciones y su desplome.
 *
 * @param {string} tipo unidad del catálogo
 * @param {{bando?:'jugador'|'enemigo', semilla?:number, oficio?:string, padre?:THREE.Object3D}} [o]
 * @returns {{raiz:THREE.Group, x:number, y:number, z:number, viva:boolean,
 *            plantar:Function, ir:Function, mirar:Function, estado:Function,
 *            caer:Function, quitar:Function}}
 */
export function crearActor (tipo, o = {}) {
  const fig = crearUnidad(tipo, { bando: o.bando, semilla: o.semilla, oficio: o.oficio })
  const f = animar(fig, { estado: 'parado' })
  f.siempreVisible = true          // el tope de figuras es para la aldea, no para la batalla
  f.esActor = true
  ;(o.padre || raizBatalla || ctx.raizAldea || ctx.scene).add(fig)
  actores.push(f)
  const mando = {
    raiz: fig,
    get x () { return f.x },
    get y () { return f.y },
    get z () { return f.z },
    get viva () { return f.estado !== 'cayendo' },
    get andando () { return f.tl < 1 },
    plantar: (x, y, z, ang = 0) => plantar(f, x, y, z, ang),
    ir: (x, y, z, dur) => { if (f.estado !== 'cayendo') caminarA(f, x, y, z, dur) },
    mirar: (ang) => { f.angObj = ang },
    estado: (e) => { if (f.estado !== 'cayendo') f.estado = e },
    caer: () => { if (f.estado === 'cayendo') return; f.estado = 'cayendo'; f.tCaida = 0; f.tl = 1 },
    quitar: () => {
      const i = actores.indexOf(f)
      if (i >= 0) actores.splice(i, 1)
      olvidar(f)
    }
  }
  return mando
}

const actores = []

/** Recoge el escenario: se llama al salir de la batalla. */
export function limpiarActores () {
  for (const f of actores.splice(0)) olvidar(f)
}

/** El desplome del caído: vale para la escaramuza vieja y para los actores. */
function desplomar (f, dt) {
  f.tCaida = (f.tCaida || 0) + dt
  const k = Math.min(1, f.tCaida / 0.7)
  f.raiz.rotation.z = k * 1.5
  f.raiz.rotation.y = f.ang
  f.salto = -k * 0.12
  f.raiz.position.y = f.y + f.salto
  // el cadáver se queda un rato en el campo: parte de entender la batalla es
  // ver dónde se amontonan los muertos
  if (f.tCaida > 6) f.raiz.visible = false
}

// ════════════════════════════════════════════════════════════════════════
//  BUCLE
// ════════════════════════════════════════════════════════════════════════

function frame (dt, t) {
  relojRepaso -= dt
  if (relojRepaso <= 0) { relojRepaso = SEG_REPASO; repasarVisibles() }

  for (let i = 0; i < vivos.length; i++) {
    const f = vivos[i]
    if (f.oculto) continue          // fuera de cámara: ni se anima ni se dibuja
    if (f.estado === 'cayendo') { desplomar(f, dt); continue }
    mover(f, dt)
    if (f.tEstado > 0) {
      f.tEstado -= dt
      if (f.tEstado <= 0) f.estado = f.estadoBase
    }
    if (f.lejano) { animarLejos(f, t); continue }
    if (f.familia === 'maquina') animarMaquina(f, t, dt)
    else if (f.familia === 'jinete') animarJinete(f, t)
    else if (f.familia === 'monje') animarMonje(f, t)
    else animarBipedo(f, t)
  }
  for (let i = 0; i < banderas.length; i++) {
    const b = banderas[i]
    b.malla.rotation.y = Math.sin(t * 2.1 + b.fase) * 0.28
    b.malla.rotation.z = Math.sin(t * 1.3 + b.fase) * 0.06
  }
  if (batalla) avanzarBatalla(dt, t)
}

// ════════════════════════════════════════════════════════════════════════
//  ENGANCHES
// ════════════════════════════════════════════════════════════════════════

let calidadVista = null

/** Cada tick reviso el estado: quién sobra, quién falta y qué está haciendo. */
function sincronizar () {
  // scene.js baja la calidad sola si el móvil no da más: hay que enterarse
  if (calidadVista !== ctx.calidad) {
    const primera = calidadVista === null
    calidadVista = ctx.calidad
    const simple = ctx.calidad === 'bajo'
    for (const f of vivos) f.simple = simple
    // los adornos van horneados en la malla fundida: para quitarlos hay que
    // rehacer las figuras. Pasa como mucho una vez por partida, al medir el móvil.
    if (!primera) {
      for (const id of [...porAldeano.keys()]) morirAldeano(id)
      for (const v of game.state.villagers || []) nacerAldeano(v)
      mostrarGuarnicion()
    }
    aplicarTope()
  }
  const lista = game.state.villagers || []
  const vistos = new Set()
  for (const v of lista) {
    vistos.add(v.id)
    let f = porAldeano.get(v.id)
    if (!f) { f = nacerAldeano(v); if (!f) continue }
    if (f.oficio !== oficioDe(v)) { revestirAldeano(v); f = porAldeano.get(v.id); if (!f) continue }
    ponerFardo(f, v.portando)
    if (f.tEstado > 0) continue           // está celebrando o dando martillazos: no le cortes
    const e = estadoDe(v, f)
    f.estadoBase = e
    if (f.estado !== 'cayendo') f.estado = e
  }
  for (const id of [...porAldeano.keys()]) if (!vistos.has(id)) morirAldeano(id)

  if (--relojCharla <= 0) { relojCharla = 8; repartirCharlas() }   // cada dos segundos
}

/**
 * DOS QUE SE PARAN A CHARLAR. Una aldea donde todo el mundo está firme parece
 * un belén; en cuanto dos vecinos se giran el uno hacia el otro y gesticulan,
 * parece un pueblo. Se busca pareja cada dos segundos y solo entre los que no
 * tienen faena, así que con sesenta aldeanos son cuatro cuentas.
 */
function repartirCharlas () {
  const libres = []
  for (const f of porAldeano.values()) {
    if (f.estadoBase === 'parado' && f.estado === 'parado' && f.tEstado <= 0 && !f.oculto) libres.push(f)
  }
  for (let i = 0; i < libres.length; i++) {
    const a = libres[i]
    if (a.tEstado > 0) continue
    for (let j = i + 1; j < libres.length; j++) {
      const b = libres[j]
      if (b.tEstado > 0) continue
      const dx = b.x - a.x
      const dz = b.z - a.z
      const d2 = dx * dx + dz * dz
      if (d2 > 3.2 || d2 < 0.05) continue
      const ang = Math.atan2(dx, dz)
      a.angObj = ang                    // se miran a la cara, que es de lo que va
      b.angObj = ang + Math.PI
      const dur = 4 + Math.random() * 5
      gestoPasajero(a, 'charlando', dur)
      gestoPasajero(b, 'charlando', dur)
      break
    }
  }
}

/** Cuenta atrás de ticks para la siguiente ronda de charlas. */
let relojCharla = 8

/** Estado temporal: dura `segundos` y luego vuelve a lo que tocara. */
function gestoPasajero (f, estado, segundos) {
  if (!f) return
  f.estado = estado
  f.tEstado = segundos
}

export function init () {
  cuandoListo(async () => {
    raizGente = new THREE.Group(); raizGente.name = 'gente'
    raizTropa = new THREE.Group(); raizTropa.name = 'tropa'
    raizBatalla = new THREE.Group(); raizBatalla.name = 'batalla'
    raizMarcas = new THREE.Group(); raizMarcas.name = 'marcas-tropa'
    aEscena(raizGente); aEscena(raizTropa); aEscena(raizBatalla); aEscena(raizMarcas)

    // el suelo lo pone terrain.js; si no está, todos a cota cero y tan contentos
    try {
      const terreno = await import('./terrain.js')
      if (typeof terreno.alturaEn === 'function') alturaTerreno = terreno.alturaEn
    } catch (e) { /* sin terreno: cota cero */ }

    // sim/army.js decide dónde forma la tropa. Se pide con import() tolerante
    // (los módulos se hablan por el bus): si no estuviera, no se pinta formación
    // y el juego sigue, que es mejor que plantar soldados dentro de una casa.
    try {
      const army = await import('../sim/army.js')
      if (typeof army.formacionReunion === 'function') modArmy = army
    } catch (e) { console.warn('[units] sin sim/army: la tropa no forma', e) }

    for (const v of game.state.villagers || []) nacerAldeano(v)
    mostrarGuarnicion()
    onFrame(frame)
    ctx.unidades = API
  })

  // el estandarte se ha movido (lo mueve el jugador o le construyen encima)
  events.on(EV.REUNION_CAMBIADA, () => pedirGuarnicion())
  // el reparto de la hueste ha cambiado: hay que repintar TODAS las formaciones
  events.on(EV.ESCUADRONES_CAMBIADOS, () => pedirGuarnicion())
  events.on(EV.ESCUADRON_MOVIDO, () => pedirGuarnicion())

  /**
   * El panel de ejército se aparta para dejar elegir la casilla y avisa por
   * BUILD_MODE con el id del escuadrón. Mientras dure, este módulo no mueve
   * nada por su cuenta: solo lleva la marca de dónde está apuntando el dedo.
   */
  events.on(EV.BUILD_MODE, (p) => {
    const id = (p && p.activo && p.escuadron) ? p.escuadron : null
    if (!id) { quitarMarca(); plantando = null; return }
    if (moviendo) { marcarPuesto(moviendo, false); moviendo = null }
    const q = puestosEscuadron.find(e => e.id === id)
    plantando = { id, color: q ? q.color : colorEscuadron(id) }
    ponerMarca(plantando.color, q ? q.x : reunion.x, q ? q.z : reunion.z)
  })

  // Mover un escuadrón: se toca su estandarte y luego la casilla de destino. Va
  // por GRID_TAP porque el dedo lo gestiona scene.js; aquí solo se escucha.
  events.on(EV.GRID_TAP, (p) => {
    if (!p) return
    if (plantando) { moverMarca(p.x, p.z); return }   // manda el panel de ejército
    if (!moviendo) {
      const q = puestoJuntoA(p.x, p.z)
      if (!q || !q.id) return
      moviendo = q.id
      marcarPuesto(q.id, true)
      events.emit(EV.UI_TOAST, { texto: `🚩 Toca dónde quieres que forme ${q.nombre}`, tipo: 'info' })
      return
    }
    const id = moviendo
    moviendo = null
    marcarPuesto(id, false)
    if (modArmy && typeof modArmy.fijarPuestoEscuadron === 'function') modArmy.fijarPuestoEscuadron(id, p.x, p.z)
    else if (modArmy && typeof modArmy.fijarReunion === 'function') modArmy.fijarReunion(p.x, p.z)
  })

  events.on(EV.VILLAGER_SPAWNED, (p) => {
    const v = p && (p.villager || p)
    if (v && v.id) {
      const f = nacerAldeano(v)
      if (f) gestoPasajero(f, 'celebrando', 1.6)   // el recién llegado saluda
    }
  })

  events.on(EV.VILLAGER_ASSIGNED, (p) => {
    const v = (p && p.villager) || (p && p.id ? game.state.villagers.find(x => x.id === p.id) : null)
    if (v) revestirAldeano(v)
  })

  events.on(EV.VILLAGER_MOVED, (p) => {
    if (!p || p.id == null) return
    const f = porAldeano.get(p.id)
    if (!f) return
    const w = gridAMundo(p.x, p.z)
    const d = Math.hypot(w.x - f.x, w.z - f.z)
    if (d < 0.004) return
    if (d > 3) {                                   // teletransporte: no lo disimules
      plantar(f, w.x, sueloEn(p.x, p.z), w.z, f.ang)
      return
    }
    // llega justo cuando toca el siguiente aviso, con un pelín de holgura
    caminarA(f, w.x, sueloEn(p.x, p.z), w.z, (CONFIG.TICK_MS / 1000) * 1.12)
    if (f.estado !== 'cayendo' && f.tEstado <= 0) {
      const v = game.state.villagers.find(x => x.id === p.id)
      f.estado = (v && v.portando && v.portando.cant > 0) ? 'cargando' : 'andando'
    }
  })

  events.on(EV.VILLAGER_CONSTRUYENDO, (p) => {
    if (!p || p.id == null) return
    const f = porAldeano.get(p.id)
    if (!f) return
    if (f.oficio !== 'constructor') {
      // durante la obra empuña el martillo aunque su oficio sea otro
      f.gesto = 'martillar'; f.ritmo = 8.4
    }
    gestoPasajero(f, 'trabajando', 1.2)
  })

  events.on(EV.TICK, sincronizar)

  events.on(EV.UNIT_TRAINED, () => pedirGuarnicion())
  events.on(EV.BUILD_COMPLETED, (p) => {
    mostrarGuarnicion()
    // la aldea celebra: los que estén cerca de la obra dan saltos
    const b = p && p.building
    if (!b) return
    const c = centroDe(b)
    const w = gridAMundo(c.x, c.z)
    for (const f of porAldeano.values()) {
      if (Math.hypot(f.x - w.x, f.z - w.z) < 5) gestoPasajero(f, 'celebrando', 2.4)
    }
  })
  events.on(EV.BUILD_DEMOLISHED, () => pedirGuarnicion())
  events.on(EV.STATE_LOADED, () => {
    for (const id of [...porAldeano.keys()]) morirAldeano(id)
    for (const v of game.state.villagers || []) nacerAldeano(v)
    mostrarGuarnicion()
  })

  // La batalla ya NO se cuenta aquí con muñecos de adorno: render/battle.js monta
  // la base de verdad y dirige a los actores con la crónica en la mano.
  // `reproducirBatalla` se queda como red de seguridad para quien la llame a mano.
}

/** API también en `ctx.unidades`, para que otros módulos de render la usen. */
const API = { crearUnidad, mostrarGuarnicion, reproducirBatalla, crearActor, limpiarActores }
export default API
