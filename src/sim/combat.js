import { events, EV } from '../core/events.js'
import { CONFIG } from '../core/config.js'
import { game } from '../core/state.js'
import { makeRng } from '../core/rng.js'
import { limitesDelTerritorio } from '../core/grid.js'
import { def, valorEdificio } from '../data/buildings.js'
import { defUnidad, PIEDRA_PAPEL } from '../data/units.js'

/**
 * MOTOR DE BATALLA.
 *
 * El jugador NO mueve tropas con el dedo: elige a quién ataca, con qué y por
 * dónde entra. A partir de ahí esto simula la batalla entera, paso a paso y de
 * forma determinista, y devuelve una CRÓNICA que la interfaz va soltando en vivo.
 * Todo el azar sale de makeRng(semilla): misma semilla, misma batalla, siempre.
 *
 * Coste: pasos de 0,2 s hasta 3 min = 900 pasos. Para que quepa en 50 ms de móvil
 * no se hace pathfinding por unidad: se cachea un CAMPO DE FLUJO (BFS) por objetivo
 * y todas las unidades que van a ese edificio lo comparten.
 */

const G = CONFIG.GRID
const PASO = 0.2            // segundos por paso de simulación
const MAX_DURACION = 240    // 4 minutos y a casa (la interfaz lo reproduce acelerado)

/**
 * Casillas de respiro alrededor de lo edificado. El campo de batalla NO es el
 * valle entero: con 60x60 el BFS del campo de flujo recorría 3.600 casillas casi
 * todas vacías y una defensa costaba segundos en el móvil. Se pelea en la CAJA:
 * tu territorio conquistado (o la rejilla propia de la base enemiga), recortada
 * a lo que de verdad está en juego. Seis casillas bastan para formar y rodear.
 */
const MARGEN_CAMPO = 6

/** Cadencia de ataque por clase (golpes/segundo). El catálogo no la trae: la tropa
 *  pesada pega fuerte pero lento, y así el asedio no se come una muralla de un tirón. */
const CADENCIA = { infanteria: 1.0, distancia: 0.85, caballeria: 1.1, asedio: 0.5, civil: 1.0 }

/** A quién va cada clase. Es lo que hace que un ejército "se comporte" sin órdenes. */
const PRODUCTIVOS = new Set(['serreria', 'cantera', 'granja', 'mina_oro', 'almacen', 'granero', 'molino', 'mercado'])
const DEFENSIVOS = new Set(['torre_vigia', 'torre_ballesta', 'castillo'])
const MUROS = new Set(['muralla', 'puerta'])

// army.js y resources.js son la excepción pactada a la regla de no importarse.
// Se cargan si existen; si no, el motor tira de sus propios cálculos y la batalla
// sigue funcionando (así este módulo nunca tumba el arranque).
let MODULOS = {}
try { MODULOS = import.meta.glob('./{army,resources}.js') } catch { MODULOS = {} }
let modArmy = null
let modRes = null

async function cargarOpcional (ruta) {
  const carga = MODULOS[ruta]
  if (typeof carga !== 'function') return null
  try { return await carga() } catch { return null }
}

// ---------------------------------------------------------------- utilidades

const clamp = (v, a, b) => v < a ? a : v > b ? b : v
const sumaTropas = (t) => Object.values(t || {}).reduce((a, b) => a + (b || 0), 0)

/** Semilla estable a partir de un texto: dos asaltos a la misma base no se repiten
 *  por casualidad, pero repetir el mismo asalto sí da el mismo resultado. */
function hashCadena (txt = '') {
  let h = 2166136261
  for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** Nivel del edificio de un tipo en una lista (0 si no lo tiene). */
function nivelDe (edificios, tipo) {
  let n = 0
  for (const b of edificios) if (b.tipo === tipo && !b.enObra && b.nivel > n) n = b.nivel
  return n
}

/** Estadísticas de una unidad. Si army.js está cargado manda él (lleva tecnologías). */
function statsDe (tipo, conBonos = true) {
  const base = defUnidad(tipo)
  if (!base) return null
  if (conBonos && modArmy && typeof modArmy.estadisticasUnidad === 'function') {
    try {
      const s = modArmy.estadisticasUnidad(tipo)
      // army manda en ataque/armadura (herrería, tecnologías y hambre); el nombre
      // y el icono los pone el catálogo, que es de donde se narra la crónica.
      if (s && s.hp) return { ...base, ...s }
    } catch { /* si army.js cambia de forma, seguimos con el catálogo */ }
  }
  const u = base
  let ataque = u.ataque
  let armadura = u.armadura
  if (conBonos) {
    const herreria = nivelDe(game.state.buildings || [], 'herreria')
    if (herreria > 0) {
      const d = def('herreria')
      ataque = ataque * (1 + d.bonusAtaque(herreria))
      armadura = armadura + armadura * d.bonusArmadura(herreria) + d.bonusArmadura(herreria) * 4
    }
  }
  return { ...u, ataque, armadura }
}

// ------------------------------------------------- preparación del escenario

/**
 * EL CAMPO DE BATALLA, en casillas. No es el valle: es la rejilla propia de la
 * base enemiga (24x24) o TU territorio conquistado, recortado además a lo que de
 * verdad está en juego. Todo lo demás —entrada de la hueste, mapa de estorbos,
 * campos de flujo, recuento del recinto— vive dentro de esta caja.
 */
function cajaDeBatalla (base, edificios, estado) {
  let caja
  const rejilla = Number(base && base.grid)
  if (Number.isFinite(rejilla) && rejilla >= 8) {
    // Base enemiga: tiene su propia rejilla (24x24). Su borde es su campo.
    caja = { x0: 0, z0: 0, x1: Math.min(G, rejilla) - 1, z1: Math.min(G, rejilla) - 1 }
  } else if (base && (base.id === 'aldea' || base.mia)) {
    // Tu aldea: se entra por el borde de lo TUYO, no por el del valle.
    caja = { ...limitesDelTerritorio(estado || game.state) }
  } else {
    caja = { x0: 0, z0: 0, x1: G - 1, z1: G - 1 }
  }
  if (!edificios.length) return caja
  let bx0 = G; let bz0 = G; let bx1 = 0; let bz1 = 0
  for (const e of edificios) {
    if (e.x < bx0) bx0 = e.x
    if (e.z < bz0) bz0 = e.z
    if (e.x + e.ancho - 1 > bx1) bx1 = e.x + e.ancho - 1
    if (e.z + e.alto - 1 > bz1) bz1 = e.z + e.alto - 1
  }
  // Se recorta a lo que está en juego, pero sin dejar nunca un edificio pegado
  // al borde: hace falta al menos un anillo libre para rodearlo y para que el
  // recuento del recinto sepa qué queda fuera.
  const lo = (limite, borde) => clamp(Math.min(borde - 1, Math.max(limite, borde - MARGEN_CAMPO)), 0, G - 1)
  const hi = (limite, borde) => clamp(Math.max(borde + 1, Math.min(limite, borde + MARGEN_CAMPO)), 0, G - 1)
  return { x0: lo(caja.x0, bx0), z0: lo(caja.z0, bz0), x1: hi(caja.x1, bx1), z1: hi(caja.z1, bz1) }
}

/**
 * Convierte una base (enemiga o la tuya) en el campo de batalla: edificios vivos
 * con su vida, su valor y, los que disparan, su torreta ya resuelta por nivel.
 */
function prepararBase (base, estado) {
  const lista = (base.buildings || []).filter(b => !b.enObra && def(b.tipo))
  const edificios = []
  let valorTotal = 0
  for (const b of lista) {
    const d = def(b.tipo)
    const nivel = clamp(b.nivel || 1, 1, d.maxNivel || 1)
    const hpMax = d.hp(nivel)
    const valor = Math.max(1, valorEdificio(b.tipo, nivel))
    const e = {
      id: b.id, tipo: b.tipo, nombre: d.nombre, nivel,
      x: b.x | 0, z: b.z | 0, ancho: d.ancho || 1, alto: d.alto || 1,
      hp: clamp(b.hp ?? hpMax, 1, hpMax), hpMax,
      cx: (b.x | 0) + ((d.ancho || 1) - 1) / 2,
      cz: (b.z | 0) + ((d.alto || 1) - 1) / 2,
      bloquea: d.bloquea === true,
      esMuro: MUROS.has(b.tipo),
      valor, vivo: true, golpeado: false,
      // Los muros NO cuentan en el porcentaje arrasado: si contaran, tirar cien
      // tramos de piedra daría estrellas sin haber tocado la aldea de verdad.
      cuenta: !MUROS.has(b.tipo),
      // torreta: dano/radio salen del catálogo por nivel; cd es el reloj de recarga
      dano: typeof d.dano === 'function' ? d.dano(nivel) : 0,
      radio: typeof d.radio === 'function' ? d.radio(nivel) : 0,
      cadencia: d.cadencia || 0,
      cd: 0, siega: 0
    }
    // Los pesos de "a qué va cada clase" no cambian en toda la batalla: se
    // resuelven aquí una vez. Dentro de elegirObjetivo() eran tres consultas a
    // Set por edificio y por unidad, millones por asalto.
    e.pesos = {
      asedio: e.esMuro ? 0.55 : (valor > 400 || DEFENSIVOS.has(b.tipo)) ? 0.8 : 1.6,
      caballeria: PRODUCTIVOS.has(b.tipo) ? 0.5 : e.esMuro ? 2.6 : 1.2,
      distancia: DEFENSIVOS.has(b.tipo) ? 0.75 : e.esMuro ? 2.2 : 1,
      infanteria: e.esMuro ? 1.5 : 1                // lo que pilla, y el muro si estorba
    }
    if (e.cuenta) valorTotal += valor
    edificios.push(e)
  }
  // El principal: ayuntamiento, y si no hay, el castillo, y si no, el más valioso.
  let principal = edificios.find(e => e.tipo === 'ayuntamiento') ||
                  edificios.find(e => e.tipo === 'castillo') || null
  if (!principal && edificios.length) {
    principal = edificios.reduce((a, b) => b.valor > a.valor ? b : a, edificios[0])
  }
  const centro = edificios.length
    ? edificios.reduce((a, e) => ({ x: a.x + e.cx / edificios.length, z: a.z + e.cz / edificios.length }), { x: 0, z: 0 })
    : { x: G / 2, z: G / 2 }
  const caja = cajaDeBatalla(base, edificios, estado)
  return {
    edificios, valorTotal: valorTotal || 1, principal, centro,
    // el campo de batalla, en casillas, y el tamaño de la rejilla local que usan
    // el mapa de estorbos y los campos de flujo
    caja, ancho: caja.x1 - caja.x0 + 1, alto: caja.z1 - caja.z0 + 1,
    torres: edificios.filter(e => e.dano > 0),
    vivos: edificios.slice(),          // lista cacheada; se rehace solo cuando cae algo
    muros: edificios.filter(e => e.bloquea)
  }
}

/** Distancia de un punto al borde del rectángulo de un edificio (0 si está encima). */
function distAEdificio (x, z, e) {
  const dx = Math.max(e.x - x, 0, x - (e.x + e.ancho - 1))
  const dz = Math.max(e.z - z, 0, z - (e.z + e.alto - 1))
  // sqrt a pelo y no Math.hypot: esto se llama decenas de miles de veces por batalla
  return Math.sqrt(dx * dx + dz * dz)
}

/** La misma distancia SIN raíz. Para comparar "cuál está más cerca" sobra: ordena
 *  igual y se ahorra un sqrt en el bucle más caliente de la batalla. */
function distAEdificio2 (x, z, e) {
  const dx = Math.max(e.x - x, 0, x - (e.x + e.ancho - 1))
  const dz = Math.max(e.z - z, 0, z - (e.z + e.alto - 1))
  return dx * dx + dz * dz
}

const COLA_BFS = new Int32Array(G * G)

/**
 * Mapa de estorbos: 1 = casilla ocupada por edificio vivo (no se atraviesa).
 * Va en coordenadas LOCALES de la caja: i = (z - z0) * ancho + (x - x0).
 */
function mapaBloqueo (esc) {
  const c = esc.caja
  const W = esc.ancho
  const m = esc.mapa || new Uint8Array(W * esc.alto)
  m.fill(0)
  for (const e of esc.vivos) {
    const z1 = Math.min(e.z + e.alto - 1, c.z1)
    const x1 = Math.min(e.x + e.ancho - 1, c.x1)
    for (let z = Math.max(e.z, c.z0); z <= z1; z++) {
      for (let x = Math.max(e.x, c.x0); x <= x1; x++) m[(z - c.z0) * W + (x - c.x0)] = 1
    }
  }
  return m
}

/**
 * Campo de flujo hacia un edificio: BFS desde sus casillas por el terreno libre.
 * -1 = no se llega (hay muralla de por medio). Se cachea por objetivo y se tira a
 * la basura cuando cae algo que bloqueaba: así una muralla rota abre el paso de verdad.
 */
function campoHacia (esc, objetivo) {
  const cache = esc.campos
  const guardado = cache.get(objetivo.id)
  if (guardado && guardado.version === esc.versionMapa) return guardado.campo
  // Un campo caducado sigue valiendo: al caer un muro solo se ABREN caminos, así que
  // como mucho la tropa tarda un instante en enterarse de la brecha. Rehacerlo cada
  // vez costaría más de lo que arregla.
  if (guardado && esc.t - guardado.t < 1) return guardado.campo
  const c = esc.caja
  const W = esc.ancho; const H = esc.alto
  const campo = guardado ? guardado.campo : new Int16Array(W * H)
  campo.fill(-1)
  const cola = COLA_BFS
  let cabeza = 0; let cola_ = 0
  for (let z = objetivo.z - 1; z <= objetivo.z + objetivo.alto; z++) {
    for (let x = objetivo.x - 1; x <= objetivo.x + objetivo.ancho; x++) {
      if (x < c.x0 || z < c.z0 || x > c.x1 || z > c.z1) continue
      const i = (z - c.z0) * W + (x - c.x0)
      if (esc.mapa[i] && !(x >= objetivo.x && x < objetivo.x + objetivo.ancho && z >= objetivo.z && z < objetivo.z + objetivo.alto)) continue
      if (campo[i] !== -1) continue
      campo[i] = 0
      cola[cola_++] = i
    }
  }
  while (cabeza < cola_) {
    const i = cola[cabeza++]
    const x = i % W; const z = (i / W) | 0
    const d = campo[i] + 1
    if (x > 0) { const j = i - 1; if (campo[j] === -1 && !esc.mapa[j]) { campo[j] = d; cola[cola_++] = j } }
    if (x < W - 1) { const j = i + 1; if (campo[j] === -1 && !esc.mapa[j]) { campo[j] = d; cola[cola_++] = j } }
    if (z > 0) { const j = i - W; if (campo[j] === -1 && !esc.mapa[j]) { campo[j] = d; cola[cola_++] = j } }
    if (z < H - 1) { const j = i + W; if (campo[j] === -1 && !esc.mapa[j]) { campo[j] = d; cola[cola_++] = j } }
  }
  cache.set(objetivo.id, { version: esc.versionMapa, t: esc.t, campo })
  return campo
}

// -------------------------------------------------------------- las tropas

function crearTropas (tropas, ladoEntrada, esc, rng, propias) {
  const unidades = []
  const tipos = Object.keys(tropas || {}).filter(t => (tropas[t] | 0) > 0 && defUnidad(t))
  // Orden fijo por tipo: el determinismo depende de que el bucle no cambie nunca.
  tipos.sort()
  let i = 0
  const total = tipos.reduce((a, t) => a + (tropas[t] | 0), 0)
  const frente = Math.max(6, Math.min(Math.max(6, esc.ancho - 4), Math.ceil(Math.sqrt(total) * 2.2)))
  for (const tipo of tipos) {
    const u = statsDe(tipo, propias)
    if (!u || u.espacio === 0) continue   // aldeanos y exploradores no van al asalto
    for (let n = 0; n < (tropas[tipo] | 0); n++) {
      const carril = (i % frente) - frente / 2
      const fila = Math.floor(i / frente)
      const pos = puntoEntrada(ladoEntrada, esc, carril + rng.float(-0.3, 0.3), fila)
      unidades.push({
        id: `u${i}`, tipo, nombre: u.nombre, icono: u.icono, clase: u.clase,
        hp: u.hp, hpMax: u.hp, atk: u.ataque, arm: u.armadura,
        vel: u.velocidad, alcance: u.alcance || 0,
        x: pos.x, z: pos.z, cd: rng.float(0, 0.4), viva: true,
        objetivo: null, revisar: 0, rompiendo: false
      })
      i++
    }
  }
  return unidades
}

/**
 * LA GUARNICIÓN QUE DEFIENDE. Hasta ahora el asalto era contra ladrillos: la
 * gente de armas del rival (y la tuya, cuando te atacan a ti) no pisaba el
 * campo. Aquí se planta dentro del recinto, repartida por sus edificios, y
 * pelea de verdad: es lo que hace que `PIEDRA_PAPEL` y el `poder` del rival
 * signifiquen algo.
 */
function crearGuarnicion (tropas, esc, rng, propias) {
  const unidades = []
  const tipos = Object.keys(tropas || {}).filter(t => (tropas[t] | 0) > 0 && defUnidad(t))
  tipos.sort()                               // determinismo: el orden no cambia nunca
  if (!tipos.length) return unidades
  // se colocan alrededor de lo que tienen que proteger, no en un montón
  const puestos = esc.edificios.filter(e => !e.esMuro)
  let i = 0
  for (const tipo of tipos) {
    const u = statsDe(tipo, propias)
    if (!u || u.espacio === 0) continue
    for (let n = 0; n < (tropas[tipo] | 0); n++) {
      const casa = puestos.length ? puestos[i % puestos.length] : null
      const giro = (i / 7) * Math.PI * 2
      const radio = 1.2 + (i % 3) * 0.8
      const x = (casa ? casa.cx : esc.centro.x) + Math.cos(giro) * radio + rng.float(-0.3, 0.3)
      const z = (casa ? casa.cz : esc.centro.z) + Math.sin(giro) * radio + rng.float(-0.3, 0.3)
      unidades.push({
        id: `g${i}`, tipo, nombre: u.nombre, icono: u.icono, clase: u.clase,
        hp: u.hp, hpMax: u.hp, atk: u.ataque, arm: u.armadura,
        vel: u.velocidad, alcance: u.alcance || 0,
        x: clamp(x, esc.caja.x0 + 0.5, esc.caja.x1 - 0.5), z: clamp(z, esc.caja.z0 + 0.5, esc.caja.z1 - 0.5),
        cd: rng.float(0, 0.4), viva: true, defensor: true,
        casa: casa ? { x: casa.cx, z: casa.cz } : { x: esc.centro.x, z: esc.centro.z },
        objetivo: null, revisar: 0
      })
      i++
    }
  }
  return unidades
}

/**
 * El enemigo vivo más cercano. Se llama cada segundo y pico, no cada paso, pero
 * recorre la lista entera: con 100 atacantes contra 100 defensores son millones
 * de comparaciones por batalla, así que va con distancia al cuadrado (mismo
 * orden, sin raíz) y sin Math.hypot, que es lo más lento del módulo.
 */
function masCerca (u, lista) {
  let mejor = null; let mejorD = Infinity
  const ux = u.x; const uz = u.z
  for (const o of lista) {
    if (!o.viva) continue
    const dx = o.x - ux; const dz = o.z - uz
    const d = dx * dx + dz * dz
    if (d < mejorD) { mejorD = d; mejor = o }
  }
  return mejor
}

/** Un paso hacia un punto, en línea recta. Para el cuerpo a cuerpo entre tropas. */
function irHacia (u, x, z) {
  const vx = x - u.x; const vz = z - u.z
  const largo = Math.hypot(vx, vz)
  if (largo < 0.05) return
  const avance = Math.min(u.vel * PASO, largo)
  u.x += (vx / largo) * avance
  u.z += (vz / largo) * avance
}

/** Por dónde entra la hueste. El lado lo elige el jugador: es su única decisión táctica. */
function puntoEntrada (lado, esc, desvio, fila) {
  const c = esc.centro
  const k = esc.caja
  const m = 0.6 + fila * 0.9
  // Se entra por el borde del CAMPO, que es tu linde (o la rejilla del rival):
  // antes se entraba por el borde del valle y la hueste se pasaba media batalla
  // cruzando hierba de nadie.
  const ex = (v) => clamp(v, k.x0 + 1, k.x1 - 1)
  const ez = (v) => clamp(v, k.z0 + 1, k.z1 - 1)
  switch (lado) {
    case 'norte': return { x: ex(c.x + desvio), z: clamp(k.z0 + m, k.z0 + 0.5, k.z1 - 0.5) }
    case 'este': return { x: clamp(k.x1 - m, k.x0 + 0.5, k.x1 - 0.5), z: ez(c.z + desvio) }
    case 'oeste': return { x: clamp(k.x0 + m, k.x0 + 0.5, k.x1 - 0.5), z: ez(c.z + desvio) }
    default: return { x: ex(c.x + desvio), z: clamp(k.z1 - m, k.z0 + 0.5, k.z1 - 0.5) }
  }
}

/** Nombre del lado de la aldea donde está un punto: para narrar "la puerta norte". */
function ladoDe (x, z, centro) {
  const dx = x - centro.x; const dz = z - centro.z
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'este' : 'oeste'
  return dz > 0 ? 'sur' : 'norte'
}

/**
 * A qué va cada clase. Aquí está la personalidad del ejército:
 * la infantería pega a lo que pilla, el asedio busca muros y edificios gordos,
 * la caballería se cuela a por lo que produce y los arqueros hostigan lo cercano.
 */
function elegirObjetivo (u, esc) {
  let mejor = null; let mejorCoste = Infinity
  const clase = u.clase; const ux = u.x; const uz = u.z
  for (const e of esc.vivos) {
    const peso = e.pesos[clase] ?? 3              // los civiles no van a por edificios
    const dx = Math.max(e.x - ux, 0, ux - (e.x + e.ancho - 1))
    const dz = Math.max(e.z - uz, 0, uz - (e.z + e.alto - 1))
    const coste = (Math.sqrt(dx * dx + dz * dz) + 1) * peso
    if (coste < mejorCoste) { mejorCoste = coste; mejor = e }
  }
  return mejor
}

/** El muro vivo más cercano: al que se arrima quien se ha quedado fuera. */
function muroMasCerca (u, esc) {
  let mejor = null; let mejorD = Infinity
  for (const e of esc.muros) {
    if (!e.vivo) continue
    // un muro ya empezado tira más que uno intacto: así la hueste concentra los
    // golpes en un punto y abre brecha, en vez de arañar veinte tramos a la vez
    const d = distAEdificio(u.x, u.z, e) - (e.golpeado ? 7 : 0)
    if (d < mejorD) { mejorD = d; mejor = e }
  }
  return mejor
}

/** Daño de un golpe: ataque × ventaja de tipo × lo que deja pasar la armadura. */
function golpe (tipoAtacante, atk, claseObjetivo, armadura, rng) {
  const mult = (PIEDRA_PAPEL[tipoAtacante] || {})[claseObjetivo] || 1
  const paso = 1 - armadura / (armadura + 12)
  return Math.max(1, atk * mult * paso * (0.9 + rng.next() * 0.2))
}

// ------------------------------------------------------------- la crónica

const FRASES = {
  muro: [
    'arremete contra la muralla {lado}',
    'la emprende a golpes con el muro {lado}',
    'busca brecha en la piedra {lado}'
  ],
  puerta: [
    'revienta la puerta {lado}',
    'echa abajo la puerta {lado}',
    'astilla la puerta {lado}'
  ],
  caeMuro: ['La muralla {lado} se viene abajo', 'Cede el muro {lado}: hay brecha', 'Un tramo de piedra {lado} salta en pedazos'],
  caeDefensa: ['Cae {nombre}: ya no dispara nadie desde ahí', '{nombre} se derrumba entre astillas', 'Silencian {nombre}'],
  caeEdificio: ['Arde {nombre}', '{nombre} queda en escombros', 'Saquean {nombre} y le prenden fuego'],
  siega: ['{torre} siega a {n}', '{torre} se cobra {n}', 'Desde {torre} caen {n}'],
  aguanta: ['La defensa aguanta: {n} siguen en pie', 'No hay manera: {n} defienden el paso']
}

const HITOS = [25, 50, 75]

const plural = (n, sing, pl) => `${n} ${n === 1 ? sing : pl}`

/** Plural en condiciones: Lancero->Lanceros, Espadachín->Espadachines, Juez->Jueces. */
function pluralNombre (nombre) {
  const fin = nombre.slice(-1).toLowerCase()
  if ('aeiou'.includes(fin)) return nombre + 's'
  if (fin === 'z') return nombre.slice(0, -1) + 'ces'
  const tildes = 'áéíóú'; const llanas = 'aeiou'
  return nombre.replace(/[áéíóú]([^áéíóú]*)$/, (m, resto) => llanas[tildes.indexOf(m[0])] + resto) + 'es'
}

// ------------------------------------------------------------ SIMULACIÓN

/**
 * Simula un asalto completo. Determinista: misma semilla = mismo resultado.
 * @param {{base:any, tropas:Object, ladoEntrada?:string, semilla?:number, propias?:boolean}} opciones
 */
export function simularAsalto ({ base, tropas, ladoEntrada = 'sur', semilla, propias = true }) {
  const sem = (semilla ?? hashCadena(`${base?.id || base?.nombre || 'base'}|${ladoEntrada}|${JSON.stringify(tropas)}`)) >>> 0
  const rng = makeRng(sem || 1)
  const esc = prepararBase(base || {}, game.state)
  esc.campos = new Map()
  esc.versionMapa = 0
  esc.t = 0
  esc.mapa = mapaBloqueo(esc)

  const unidades = crearTropas(tropas, ladoEntrada, esc, rng, propias)
  // La guarnición usa las mejoras del OTRO bando: si el que ataca eres tú, la
  // herrería del rival no es la tuya, y al revés cuando defiendes tu aldea.
  const guarnicion = crearGuarnicion(base?.guarnicion, esc, rng, !propias)
  const sucesos = []
  const bajas = {}
  const bajasDefensa = {}
  let t = 0
  let valorCaido = 0
  let principalCaido = false
  let hitos = 0
  let vivas = unidades.length
  let edificiosVivos = esc.edificios.length
  let enPie = esc.edificios.filter(e => e.cuenta).length

  const añadir = (tipo, texto, x, z, extra) => {
    if (sucesos.length > 160) return   // la crónica se lee en el móvil, no es un log
    sucesos.push({ t: Math.round(t * 10) / 10, tipo, texto, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, ...extra })
  }
  const frase = (clave, datos) => {
    let f = rng.pick(FRASES[clave])
    for (const k in datos) f = f.replace(`{${k}}`, datos[k])
    return f
  }

  let vivosDefensa = guarnicion.length
  añadir('inicio', `La hueste entra por el ${ladoEntrada}: ${plural(vivas, 'unidad', 'unidades')} contra ${plural(enPie, 'edificio', 'edificios')}`, esc.centro.x, esc.centro.z, { lado: ladoEntrada })
  if (vivosDefensa) {
    añadir('guarnicion', `${plural(vivosDefensa, 'defensor sale', 'defensores salen')} a dar la cara`, esc.centro.x, esc.centro.z, { defensores: vivosDefensa })
  }

  if (!vivas || !enPie) {
    return rematar({ esc, sucesos, bajas, bajasDefensa, guarnicion, t, valorCaido, principalCaido, unidades, base, ladoEntrada, semilla: sem })
  }

  const bajasVentana = {}           // muertes agrupadas por segundo, para no spamear
  let ventana = 0
  let vivasLista = unidades         // se poda de muertos cada pocos pasos
  let defensaLista = guarnicion
  let caidosDefensa = 0             // los de la guarnición que van cayendo, para narrarlo
  let narradosDefensa = 0
  let ultimoMuro = -99              // para no narrar veinte veces el mismo muro

  /** Un golpe de tropa contra tropa. Devuelve true si la víctima cae. */
  const duelo = (atacante, victima) => {
    victima.hp -= golpe(atacante.tipo, atacante.atk, victima.clase, victima.arm, rng)
    if (victima.hp > 0) return false
    victima.viva = false
    if (victima.defensor) {
      bajasDefensa[victima.tipo] = (bajasDefensa[victima.tipo] || 0) + 1
      vivosDefensa--
      caidosDefensa++
    } else {
      bajas[victima.tipo] = (bajas[victima.tipo] || 0) + 1
      bajasVentana[victima.tipo] = (bajasVentana[victima.tipo] || 0) + 1
      vivas--
    }
    return true
  }

  for (let k = 0; k < MAX_DURACION / PASO; k++) {
    t = (k + 1) * PASO
    esc.t = t

    // --- las torres y el castillo disparan a lo que tengan más cerca ---
    for (const torre of esc.torres) {
      if (!torre.vivo || torre.cadencia <= 0) continue
      torre.cd -= PASO
      if (torre.cd > 0) continue
      let presa = null; let mejorD = torre.radio * torre.radio
      for (const u of vivasLista) {
        if (!u.viva) continue
        const d = distAEdificio2(u.x, u.z, torre)
        if (d <= mejorD) { mejorD = d; presa = u }
      }
      if (!presa) { torre.cd = 0.15; continue }
      torre.cd = 1 / torre.cadencia
      presa.hp -= golpe('arquero', torre.dano, presa.clase, presa.arm, rng)
      if (presa.hp <= 0) {
        presa.viva = false; vivas--
        bajas[presa.tipo] = (bajas[presa.tipo] || 0) + 1
        torre.siega++
        bajasVentana[presa.tipo] = (bajasVentana[presa.tipo] || 0) + 1
        if (torre.siega === 1 || torre.siega % 3 === 0) {
          const texto = torre.siega === 1
            ? `${torre.nombre} abate a ${presa.nombre.toLowerCase()}`
            : frase('siega', { torre: torre.nombre, n: plural(torre.siega, 'baja', 'bajas') })
          añadir('siega', texto, torre.cx, torre.cz, { torreId: torre.id, unidad: presa.tipo })
        }
      }
    }

    // --- la tropa avanza y pega ---
    for (const u of vivasLista) {
      if (!u.viva) continue
      u.cd -= PASO
      u.revisar -= PASO

      // objetivo caducado o muerto: se busca otro (no cada paso: costaría el triple)
      if (!u.objetivo || !u.objetivo.vivo || u.revisar <= 0) {
        const nuevo = elegirObjetivo(u, esc)
        if (nuevo !== u.objetivo) { u.rompiendo = false; u.objetivo = nuevo }
        u.revisar = 2.5
      }
      const obj = u.objetivo
      if (!obj) continue

      // --- ¿hay guarnición encima? Primero se pelea; la piedra puede esperar ---
      if (vivosDefensa > 0 && u.clase !== 'civil') {
        if (u.presa && !u.presa.viva) u.presa = null
        u.revisarPresa = (u.revisarPresa || 0) - PASO
        if (!u.presa || u.revisarPresa <= 0) { u.presa = masCerca(u, defensaLista); u.revisarPresa = 1.2 }
        const p = u.presa
        if (p && p.viva) {
          const dp = Math.hypot(p.x - u.x, p.z - u.z)
          // el cuerpo a cuerpo se engancha a tres casillas; el que dispara, desde su alcance
          if (dp <= u.alcance + 3) {
            if (dp <= u.alcance + 0.8) {
              if (u.cd <= 0) {
                u.cd = 1 / (CADENCIA[u.clase] || 1)
                duelo(u, p)
              }
            } else irHacia(u, p.x, p.z)
            continue
          }
        }
      }

      // monje: no pega a nadie, remienda al más tocado que tenga cerca
      if (u.clase === 'civil') {
        if (u.cd <= 0) {
          let herido = null; let peor = 0.95
          for (const a of unidades) {
            if (!a.viva || a === u) continue
            const frac = a.hp / a.hpMax
            if (frac < peor && Math.hypot(a.x - u.x, a.z - u.z) <= u.alcance) { peor = frac; herido = a }
          }
          if (herido) { herido.hp = Math.min(herido.hpMax, herido.hp + 10); u.cd = 1 }
        }
        seguirAlPelotón(u, unidades)
        continue
      }

      const d = distAEdificio(u.x, u.z, obj)
      if (d <= u.alcance + 0.7) {
        if (u.cd <= 0) {
          u.cd = 1 / (CADENCIA[u.clase] || 1)
          // muralla y puerta van por su propia clase: solo el asedio las tira rápido
          obj.hp -= golpe(u.tipo, u.atk, obj.esMuro ? 'muro' : 'edificio', 0, rng)
          if (!obj.golpeado) {
            obj.golpeado = true
            if (obj.esMuro && t - ultimoMuro >= 8) {
              ultimoMuro = t
              const clave = obj.tipo === 'puerta' ? 'puerta' : 'muro'
              añadir('muro', `${u.nombre} ${frase(clave, { lado: ladoDe(obj.cx, obj.cz, esc.centro) })}`, obj.cx, obj.cz, { edificioId: obj.id })
            }
          }
          if (obj.hp <= 0) {
            obj.vivo = false
            edificiosVivos--
            if (obj.cuenta) enPie--
            if (obj.cuenta) valorCaido += obj.valor
            esc.vivos = esc.vivos.filter(e => e.vivo)
            esc.versionMapa++                 // cae un estorbo: los caminos cambian
            esc.mapa = mapaBloqueo(esc)
            if (esc.principal && obj.id === esc.principal.id) principalCaido = true
            const texto = obj.esMuro
              ? frase('caeMuro', { lado: ladoDe(obj.cx, obj.cz, esc.centro) })
              : DEFENSIVOS.has(obj.tipo)
                ? frase('caeDefensa', { nombre: obj.nombre })
                : frase('caeEdificio', { nombre: obj.nombre })
            añadir('edificio_caido', texto, obj.cx, obj.cz, { edificioId: obj.id, tipoEdificio: obj.tipo, principal: principalCaido && obj.id === esc.principal?.id })
          }
        }
        continue
      }

      // --- moverse: por el campo de flujo, y si no hay camino, a golpes ---
      const campo = campoHacia(esc, obj)
      const K = esc.caja; const W = esc.ancho
      const cx = clamp(Math.round(u.x), K.x0, K.x1)
      const cz = clamp(Math.round(u.z), K.z0, K.z1)
      const aqui = campo[(cz - K.z0) * W + (cx - K.x0)]
      if (aqui < 0) {
        // Encerrado fuera: decide entre rodear (si el rodeo es corto) o romper el muro.
        const muro = muroMasCerca(u, esc)
        if (muro && muro !== obj) { u.objetivo = muro; u.rompiendo = true; u.revisar = 3 }
        continue
      }
      if (!u.rompiendo && aqui > d * 2.4 + 8) {
        // Hay camino, pero es un rodeo absurdo: le sale más a cuenta abrir brecha.
        const muro = muroMasCerca(u, esc)
        if (muro && muro !== obj) { u.objetivo = muro; u.rompiendo = true; u.revisar = 3; continue }
      }
      let mejorI = -1; let mejorV = aqui
      const i = (cz - K.z0) * W + (cx - K.x0)
      if (cx > K.x0 && campo[i - 1] >= 0 && campo[i - 1] < mejorV) { mejorV = campo[i - 1]; mejorI = i - 1 }
      if (cx < K.x1 && campo[i + 1] >= 0 && campo[i + 1] < mejorV) { mejorV = campo[i + 1]; mejorI = i + 1 }
      if (cz > K.z0 && campo[i - W] >= 0 && campo[i - W] < mejorV) { mejorV = campo[i - W]; mejorI = i - W }
      if (cz < K.z1 && campo[i + W] >= 0 && campo[i + W] < mejorV) { mejorV = campo[i + W]; mejorI = i + W }
      const destX = mejorI < 0 ? obj.cx : (mejorI % W) + K.x0
      const destZ = mejorI < 0 ? obj.cz : ((mejorI / W) | 0) + K.z0
      const vx = destX - u.x; const vz = destZ - u.z
      const largo = Math.hypot(vx, vz) || 1
      const avance = u.vel * PASO
      u.x += (vx / largo) * avance
      u.z += (vz / largo) * avance
    }

    // --- la guarnición responde: salen a por quien se les acerca ---
    for (const g of defensaLista) {
      if (!g.viva) continue
      g.cd -= PASO
      g.revisar -= PASO
      if (g.objetivo && !g.objetivo.viva) g.objetivo = null
      if (!g.objetivo || g.revisar <= 0) { g.objetivo = masCerca(g, vivasLista); g.revisar = 1.5 }
      const p = g.objetivo
      if (!p || !p.viva) continue
      const d = Math.hypot(p.x - g.x, p.z - g.z)
      if (d <= g.alcance + 0.8) {
        if (g.cd <= 0) { g.cd = 1 / (CADENCIA[g.clase] || 1); duelo(g, p) }
      } else if (d <= 9) {
        irHacia(g, p.x, p.z)                 // salen a recibirlos
      } else {
        irHacia(g, g.casa.x, g.casa.z)       // y si no, se quedan guardando lo suyo
      }
    }

    // se narra la sangría de la guarnición de tres en tres, sin llenar la crónica
    if (caidosDefensa - narradosDefensa >= 3 || (caidosDefensa && !vivosDefensa && narradosDefensa < caidosDefensa)) {
      narradosDefensa = caidosDefensa
      añadir('defensa_caida', vivosDefensa
        ? `Caen ${plural(caidosDefensa, 'defensor', 'defensores')}: la guarnición aguanta con ${vivosDefensa}`
        : 'La guarnición ha caído entera: ya no queda quien pare la hueste',
      esc.centro.x, esc.centro.z, { caidos: caidosDefensa, quedan: vivosDefensa })
    }

    if ((k & 7) === 7 && vivasLista.length > vivas) vivasLista = vivasLista.filter(u => u.viva)
    if ((k & 7) === 7 && defensaLista.length > vivosDefensa) defensaLista = defensaLista.filter(u => u.viva)

    // agrupar bajas del segundo para la crónica
    ventana += PASO
    if (ventana >= 1) {
      ventana = 0
      const tipos = Object.keys(bajasVentana)
      if (tipos.length) {
        const total = tipos.reduce((a, k) => a + bajasVentana[k], 0)
        if (total >= 2) {
          const detalle = tipos.map(k => { const nom = defUnidad(k)?.nombre || k; return plural(bajasVentana[k], nom, pluralNombre(nom)) }).join(' y ')
          añadir('bajas', `Caen ${detalle}`, esc.centro.x, esc.centro.z, { bajas: { ...bajasVentana } })
        }
        for (const k in bajasVentana) delete bajasVentana[k]
      }
    }

    // --- retirada: una hueste deshecha no se queda a morir entera ---
    // Sin esto, un asalto mal planteado se llevaba el ejército completo y atacar
    // salía a pérdidas siempre. Se retiran con lo puesto, y el que se retira no
    // cobra botín: la derrota sigue doliendo, pero no te borra del mapa.
    if (t > 20 && vivas > 0 && vivas <= unidades.length * 0.2 && (valorCaido / esc.valorTotal) < 0.5) {
      añadir('retirada', `Tocan retirada: solo quedan ${plural(vivas, 'hombre', 'hombres')} en pie`, esc.centro.x, esc.centro.z, { quedan: vivas })
      break
    }

    // hitos de destrucción: es lo que le dice al jugador si va bien o mal
    const pct = (valorCaido / esc.valorTotal) * 100
    let hito = 0
    while (hitos < 3 && pct >= HITOS[hitos]) hito = HITOS[hitos++]
    // Si un derrumbe se lleva dos hitos por delante, se canta solo el más alto.
    if (hito) añadir('hito', hito === 50 ? '¡Media aldea por los suelos: una estrella!' : `${hito} % de la aldea arrasada`, esc.centro.x, esc.centro.z, { porcentaje: hito })

    if (!vivas || !enPie) break
  }

  if (vivas > 0 && enPie > 0) {
    añadir('tiempo', frase('aguanta', { n: plural(enPie, 'edificio', 'edificios') }), esc.centro.x, esc.centro.z)
  }

  return rematar({ esc, sucesos, bajas, bajasDefensa, guarnicion, t, valorCaido, principalCaido, unidades, base, ladoEntrada, semilla: sem, añadir })
}

/** Un civil sin nada que hacer se pega al grueso de la tropa (el monje no va solo). */
function seguirAlPelotón (u, unidades) {
  let sx = 0; let sz = 0; let n = 0
  for (const a of unidades) {
    if (!a.viva || a.clase === 'civil') continue
    sx += a.x; sz += a.z; n++
  }
  if (!n) return
  const vx = sx / n - u.x; const vz = sz / n - u.z
  const largo = Math.hypot(vx, vz)
  if (largo < 2) return
  u.x += (vx / largo) * u.vel * PASO
  u.z += (vz / largo) * u.vel * PASO
}

/** Cierra la batalla: estrellas, botín y frase final. */
function rematar ({ esc, sucesos, bajas, bajasDefensa = {}, guarnicion = [], t, valorCaido, principalCaido, unidades, base, ladoEntrada, semilla, añadir }) {
  const porcentajeDestruido = Math.min(100, Math.round((valorCaido / esc.valorTotal) * 1000) / 10)
  let estrellas = 0
  if (porcentajeDestruido >= 50) estrellas++
  if (principalCaido) estrellas++
  if (porcentajeDestruido >= 99.5) estrellas++
  estrellas = Math.min(3, estrellas)
  const victoria = estrellas >= 1
  const botin = botinDe(base, porcentajeDestruido)
  const supervivientes = unidades.filter(u => u.viva).length

  const final = victoria
    ? `¡Victoria! ${estrellas === 3 ? 'No queda piedra sobre piedra' : `${porcentajeDestruido} % arrasado`} — vuelven ${plural(supervivientes, 'superviviente', 'supervivientes')}`
    : `Derrota: solo ${porcentajeDestruido} % de la aldea. ${supervivientes ? 'Los que quedan se retiran' : 'No vuelve nadie'}`
  if (añadir) añadir(victoria ? 'victoria' : 'derrota', final, esc.centro.x, esc.centro.z, { estrellas, porcentajeDestruido, botin })
  else sucesos.push({ t: Math.round(t * 10) / 10, tipo: victoria ? 'victoria' : 'derrota', texto: final, x: esc.centro.x, z: esc.centro.z, estrellas, porcentajeDestruido, botin })

  return {
    victoria, estrellas, porcentajeDestruido,
    duracion: Math.round(t * 10) / 10,
    bajas, botin, sucesos, semilla, ladoEntrada,
    supervivientes,
    // la guarnición: cuánta había, cuánta cayó y cuánta sigue en pie
    bajasDefensa,
    defensores: guarnicion.length,
    defensoresVivos: guarnicion.filter(g => g.viva).length,
    edificiosDestruidos: esc.edificios.filter(e => !e.vivo).map(e => e.id),
    // quién disparó y a cuántos se llevó: es lo que convierte "tengo torres"
    // en "mis torres sirvieron para esto" cuando se defiende la aldea
    torres: esc.torres.map(t => ({
      id: t.id, tipo: t.tipo, nombre: t.nombre, nivel: t.nivel,
      bajas: t.siega || 0, vivo: t.vivo, dano: t.dano
    })),
    // vida que queda en cada edificio: lo usa la defensa para dejar la aldea tocada
    restos: esc.edificios.map(e => ({ id: e.id, hp: Math.max(0, Math.round(e.hp)), vivo: e.vivo }))
  }
}

// ------------------------------------------------------------------ BOTÍN

/** Tope de saqueo por nivel: sin esto, un asalto afortunado rompe la economía. */
function topeBotin (nivel) {
  const f = Math.pow(1.55, Math.max(0, nivel - 1))
  return {
    madera: Math.round(350 * f), piedra: Math.round(300 * f),
    comida: Math.round(350 * f), oro: Math.round(110 * f)
  }
}

/**
 * Lo que te llevas: proporcional a lo destruido y a lo que el enemigo guardaba,
 * con tope duro por nivel. Determinista (la semilla sale de la propia base).
 * @returns {{madera:number,piedra:number,comida:number,oro:number,gemas:number}}
 */
export function botinDe (base, porcentajeDestruido) {
  const pct = clamp(porcentajeDestruido || 0, 0, 100) / 100
  const nivel = base?.nivel || nivelDe(base?.buildings || [], 'ayuntamiento') || 1
  const tope = topeBotin(nivel)
  const guarda = base?.recursos || {}
  const rng = makeRng(hashCadena(`${base?.id || base?.nombre || 'base'}:${Math.round(pct * 100)}`) || 7)
  // Se saquea como mucho la mitad del granero enemigo, y solo la parte arrasada.
  const fraccion = 0.5 * Math.pow(pct, 0.85)
  const botin = { madera: 0, piedra: 0, comida: 0, oro: 0, gemas: 0 }
  for (const r of CONFIG.RECURSOS) {
    const bruto = (guarda[r] || 0) * fraccion
    botin[r] = Math.max(0, Math.min(Math.round(bruto), tope[r]))
  }
  // Gemas: propina rara, y solo si la cosa ha ido bien. Nunca se compran con dinero.
  if (pct >= 0.5 && rng.chance(0.12 + pct * 0.18)) botin.gemas = rng.int(1, pct >= 0.99 ? 3 : 2)
  return botin
}

// ------------------------------------------------- ingresos, bajas y aldea

/** Mete el botín en el banco. Si resources.js está, manda él; si no, se apaña. */
function ingresar (botin) {
  if (!botin) return
  if (modRes && typeof modRes.ingresarVarios === 'function') {
    modRes.ingresarVarios({ madera: botin.madera, piedra: botin.piedra, comida: botin.comida, oro: botin.oro }, null)
    if (botin.gemas && typeof modRes.gemas === 'function') { modRes.gemas(botin.gemas, 'botín de guerra'); return }
  } else {
    const s = game.state
    for (const r of CONFIG.RECURSOS) {
      const tope = s.almacen?.[r] ?? Infinity
      s.recursos[r] = Math.min(tope, (s.recursos[r] || 0) + (botin[r] || 0))
    }
    events.emit(EV.RESOURCES_CHANGED, { resources: s.recursos })
  }
  if (botin.gemas) game.state.jugador.gemas = (game.state.jugador.gemas || 0) + botin.gemas
}

/** Cobra el saqueo que te han hecho. Si resources.js está, que lo apunte él. */
function saquear (perdidas) {
  if (modRes && typeof modRes.pagar === 'function' && modRes.pagar(perdidas, 'saqueo')) return
  const s = game.state
  for (const r of CONFIG.RECURSOS) s.recursos[r] = Math.max(0, (s.recursos[r] || 0) - (perdidas[r] || 0))
  events.emit(EV.RESOURCES_CHANGED, { resources: s.recursos })
}

/**
 * Reparte a los que cayeron en el campo. army.js manda si existe: él decide
 * cuántos salva el monasterio, cuántos vuelven MALHERIDOS a la enfermería del
 * cuartel y cuántos se quedan allí de verdad.
 * @param {Record<string,number>} bajas
 * @param {{victoria?:boolean}} [opciones] ganar permite recoger mejor el campo
 */
function aplicarBajas (bajas, opciones = {}) {
  if (!bajas || !Object.keys(bajas).length) return
  if (modArmy && typeof modArmy.perderTropas === 'function') {
    // Ojo: army.js ya devuelve a casa a los heridos del monasterio. Curar aquí
    // otra vez sería regalar tropa, así que este camino NO pasa por curarBajas().
    try { return modArmy.perderTropas(bajas, opciones) } catch { /* a mano */ }
  }
  const tropas = game.state.ejercito.tropas
  for (const tipo in bajas) tropas[tipo] = Math.max(0, (tropas[tipo] || 0) - bajas[tipo])
  return null
}

/** Red de seguridad si army.js no está: el monasterio devuelve a casa parte de los
 *  caídos. Suaviza la derrota, no la borra. Con army.js cargado NO se usa. */
function curarBajas (bajas, rng) {
  if (modArmy) return 0
  const nivel = nivelDe(game.state.buildings || [], 'monasterio')
  if (!nivel) return 0
  const frac = def('monasterio').curacion(nivel)
  let salvados = 0
  for (const tipo in bajas) {
    const s = Math.floor(bajas[tipo] * frac + (rng.chance(0.5) ? 0.5 : 0))
    if (s > 0) { bajas[tipo] -= s; salvados += s; if (!bajas[tipo]) delete bajas[tipo] }
  }
  return salvados
}

// ------------------------------------------------------------- REPRODUCIR

/**
 * Reproduce la crónica en tiempo real: llama a alSuceso(s) cuando toca cada uno.
 * En móvil poder saltarse la batalla no es opcional, así que devuelve `saltar`.
 * @returns {{parar:()=>void, saltar:()=>void}}
 */
export function reproducir (resultado, alSuceso, opciones = {}) {
  const { velocidad = 1, alFinal = null, emitirBus = true } = opciones
  const lista = (resultado?.sucesos || []).slice().sort((a, b) => a.t - b.t)
  let i = 0
  let parado = false
  const t0 = Date.now()
  let timer = null

  const soltar = (s) => {
    try { alSuceso?.(s) } catch (err) { console.error('[combat] fallo pintando suceso', err) }
    if (emitirBus) events.emit(EV.BATTLE_EVENT, { suceso: s, resultado })
  }
  const terminar = () => {
    if (timer) { clearInterval(timer); timer = null }
    if (!parado) { parado = true; try { alFinal?.(resultado) } catch { /* da igual */ } }
  }
  const latido = () => {
    if (parado) return
    const transcurrido = ((Date.now() - t0) / 1000) * velocidad
    while (i < lista.length && lista[i].t <= transcurrido) soltar(lista[i++])
    if (i >= lista.length) terminar()
  }

  timer = setInterval(latido, 60)
  latido()

  return {
    parar () { if (timer) clearInterval(timer); timer = null; parado = true },
    saltar () {
      if (parado) return
      while (i < lista.length) soltar(lista[i++])
      terminar()
    }
  }
}

// ------------------------------------------------------- ASALTO (jugador)

/** Lanza un asalto de verdad: simula, cobra el botín, apunta las bajas y avisa. */
export function lanzarAsalto ({ base, tropas, ladoEntrada = 'sur', semilla }) {
  const enviadas = tropas && sumaTropas(tropas) ? tropas : { ...(game.state.ejercito?.tropas || {}) }
  events.emit(EV.RAID_STARTED, { enemyBase: base, ejercito: { ...enviadas }, ladoEntrada })

  const resultado = simularAsalto({ base, tropas: enviadas, ladoEntrada, semilla, propias: true })

  // QUIÉN CAYÓ EN EL CAMPO Y QUIÉN NO VUELVE. No es lo mismo.
  // `caidos` es la crónica: los que se fueron al suelo durante la batalla.
  // De ahí, army.js separa a los que recoge el monasterio, a los MALHERIDOS
  // (vuelven a casa y se curan solos en el cuartel) y a los muertos de verdad,
  // que son los pocos que hay que volver a pagar. `resultado.bajas` pasa a ser
  // ESO último: lo que de verdad has perdido, que es lo que lee la interfaz.
  const caidos = { ...resultado.bajas }
  const cayeron = sumaTropas(caidos)
  let salvados = 0
  const parte = aplicarBajas(resultado.bajas, { victoria: resultado.victoria })
  if (parte) {
    salvados = sumaTropas(parte.curadas)
    const enCamilla = sumaTropas(parte.heridos)
    resultado.caidos = caidos
    resultado.bajas = parte.perdidas || {}
    resultado.heridosTropas = parte.heridos || {}
    resultado.heridos = enCamilla                   // número, como siempre lo leyó la interfaz
    resultado.curadas = parte.curadas || null
    // Volver herido es volver: cuentan como supervivientes del asalto.
    resultado.supervivientes += enCamilla + salvados
    if (enCamilla) {
      resultado.sucesos.push({ t: resultado.duracion + 0.2, tipo: 'heridos', x: 0, z: 0, heridos: enCamilla, texto: `Vuelven ${plural(enCamilla, 'herido', 'heridos')}: se recuperan en el cuartel` })
    }
  } else {
    // Sin army.js (arranque degradado): al menos el monasterio hace su trabajo.
    salvados = curarBajas(resultado.bajas, makeRng((resultado.semilla ^ 0x9e3779b9) >>> 0))
    resultado.caidos = caidos
    resultado.heridosTropas = {}
    resultado.heridos = 0
  }
  if (salvados) {
    resultado.sucesos.push({ t: resultado.duracion + 0.4, tipo: 'monjes', texto: `Los monjes devuelven al mundo a ${plural(salvados, 'herido', 'heridos')}`, x: 0, z: 0 })
  }
  resultado.muertos = sumaTropas(resultado.bajas)
  resultado.cayeron = cayeron
  ingresar(resultado.botin)

  const s = game.state
  s.stats = s.stats || {}
  if (resultado.victoria) s.stats.batallasGanadas = (s.stats.batallasGanadas || 0) + 1
  else s.stats.batallasPerdidas = (s.stats.batallasPerdidas || 0) + 1

  events.emit(EV.RAID_RESOLVED, {
    victoria: resultado.victoria, botin: resultado.botin, bajas: resultado.bajas,
    // `bajas` = muertos de verdad; `heridos` = los que vuelven a la enfermería.
    heridos: resultado.heridos, heridosTropas: resultado.heridosTropas, caidos: resultado.caidos,
    log: resultado.sucesos, estrellas: resultado.estrellas,
    porcentajeDestruido: resultado.porcentajeDestruido, duracion: resultado.duracion,
    base, resultado
  })
  return resultado
}

// ------------------------------------------------------ DEFENSA (tu aldea)

const HORAS_ESCUDO = 4

/**
 * Deja la aldea tocada. Se avisa por el bus (sim/buildings tiene su `dañar`) y,
 * si nadie lo ha recogido, se aplica aquí: perder un asalto TIENE que doler.
 */
function aplicarDaños (daños) {
  if (!daños.length) return
  events.emit(EV.BUILDINGS_DAMAGED, { daños })
  for (const d of daños) {
    const b = game.state.buildings.find(x => x.id === d.id)
    if (!b) continue
    if ((b.hp ?? Infinity) > d.hp) b.hp = d.hp        // idempotente: si ya bajó, no toca nada
    // Lo que cae, cae de verdad: un edificio arrasado deja de producir hasta que
    // lo reparas. Antes quedaba a 1 de vida y seguía trabajando al 100 %, así que
    // perder una defensa no dolía y no había ningún motivo para poner torres.
    if (d.destruido) b.arruinado = true
  }
}

/**
 * El mismo motor, pero al revés: TU aldea es el campo de batalla.
 * Al perder, los edificios quedan tocados (lo avisamos por evento para que
 * sim/buildings les baje la vida) y se llevan recursos. Después, escudo.
 */
export function simularDefensa ({ atacante = {}, tropasEnemigas = {}, semilla } = {}) {
  const s = game.state
  const escudoActivo = (s.escudo?.hasta || 0) > Date.now()
  if (escudoActivo) {
    events.emit(EV.UI_TOAST, { texto: 'El escudo de protección ha espantado al atacante', tipo: 'bien' })
    return null
  }
  // Tu ejército DEFIENDE tu aldea: la tropa que esté en casa sale a pelear.
  // Solo la que está en casa: la que anda de asalto o de expedición no puede
  // estar en dos sitios a la vez.
  let enCasa = { ...(s.ejercito?.tropas || {}) }
  if (modArmy && typeof modArmy.tropasDisponibles === 'function') {
    try { enCasa = modArmy.tropasDisponibles() } catch { /* nos quedamos con todas */ }
  }
  const base = {
    id: 'aldea',
    mia: true,
    nombre: s.jugador?.nombre || 'Tu aldea',
    nivel: nivelDe(s.buildings || [], 'ayuntamiento') || 1,
    buildings: s.buildings || [],
    guarnicion: enCasa,
    recursos: s.recursos
  }
  const lado = atacante.lado || ['norte', 'sur', 'este', 'oeste'][hashCadena(`${atacante.nombre || 'enemigo'}`) % 4]
  // El enemigo no lleva tus mejoras de herrería: propias = false.
  const r = simularAsalto({ base, tropas: tropasEnemigas, ladoEntrada: lado, semilla, propias: false })

  // Para ti "victoria" es que NO te arrasen: aguantar por debajo del 50 % y con el
  // ayuntamiento en pie. Si el atacante saca estrella, has perdido.
  const defendida = r.estrellas === 0
  // Las gemas no se saquean: se ganan jugando y punto.
  const perdidas = defendida
    ? { madera: 0, piedra: 0, comida: 0, oro: 0 }
    : { madera: r.botin.madera, piedra: r.botin.piedra, comida: r.botin.comida, oro: r.botin.oro }
  const porId = new Map(s.buildings.map(b => [b.id, b]))
  const daños = []
  for (const e of r.restos) {
    const b = porId.get(e.id)
    if (!b) continue
    // Un edificio arrasado NO desaparece de tu aldea: queda en los huesos y se repara.
    const hp = e.vivo ? Math.round(e.hp) : 1
    // Si el edificio aún no tiene vida apuntada (partida recién migrada), se toma la del catálogo.
    const antes = b.hp ?? (def(b.tipo)?.hp(Math.max(1, b.nivel || 1)) ?? hp)
    if (hp < antes) {
      daños.push({
        id: e.id, hp, dano: Math.round(antes - hp), destruido: !e.vivo,
        tipo: b.tipo, nombre: def(b.tipo)?.nombre || b.tipo, nivel: b.nivel || 1
      })
    }
  }

  // Tu tropa se ha dejado la piel en la muralla. Defendiendo en casa se recoge
  // a los caídos mejor que en campo ajeno (los tuyos están en su aldea), así que
  // aguantar el asalto se paga sobre todo en heridos, no en muertos.
  let parteBajas = null
  if (Object.keys(r.bajasDefensa || {}).length) parteBajas = aplicarBajas(r.bajasDefensa, { victoria: defendida })
  if (parteBajas) {
    r.heridosTropas = parteBajas.heridos || {}
    r.heridos = sumaTropas(parteBajas.heridos)
    r.muertos = sumaTropas(parteBajas.perdidas)
  }

  if (!defendida) {
    saquear(perdidas)
    aplicarDaños(daños)
    s.escudo = { hasta: Date.now() + HORAS_ESCUDO * 3600 * 1000, horas: HORAS_ESCUDO }
    events.emit(EV.SHIELD_STARTED, { hasta: s.escudo.hasta, horas: HORAS_ESCUDO })
    events.emit(EV.UI_TOAST, { texto: `Te han asaltado. Escudo de protección: ${HORAS_ESCUDO} h sin que puedan atacarte`, tipo: 'mal' })
    s.stats.batallasPerdidas = (s.stats.batallasPerdidas || 0) + 1
  } else {
    aplicarDaños(daños)
    events.emit(EV.UI_TOAST, { texto: '¡Tu defensa ha aguantado el asalto!', tipo: 'bien' })
    s.stats.batallasGanadas = (s.stats.batallasGanadas || 0) + 1
  }

  const parte = parteDefensa({ r, defendida, perdidas, daños, atacante, tropasEnemigas, parteBajas })

  events.emit(EV.DEFENSE_RESOLVED, {
    victoria: defendida, perdidas, log: r.sucesos, daños, parte,
    // Defender también deja heridos, no solo muertos: la enfermería se llena igual.
    heridos: r.heridos || 0, heridosTropas: r.heridosTropas || {}, muertos: r.muertos || 0,
    atacante, estrellas: r.estrellas, porcentajeDestruido: r.porcentajeDestruido, resultado: r
  })
  return { ...r, victoria: defendida, perdidas, daños, parte }
}

/**
 * EL PARTE DE LA DEFENSA. Lo que el jugador tiene que leer al volver: qué le
 * han roto, qué le han robado, qué torres trabajaron y por dónde se colaron.
 * Sin esto, defender era un número que bajaba sin explicación.
 * @returns {{titular:string, resumen:string, torres:Array, rotos:Array, robado:object,
 *            bajasEnemigas:number, atacantes:number, coste:object, agujeros:Array, escudoHasta:number}}
 */
function parteDefensa ({ r, defendida, perdidas, daños, atacante, tropasEnemigas, parteBajas }) {
  const s = game.state
  const atacantes = sumaTropas(tropasEnemigas)
  const bajasEnemigas = sumaTropas(r.bajas)
  const misBajas = parteBajas?.perdidas || r.bajasDefensa || {}
  const misCaidos = sumaTropas(misBajas)
  const torres = (r.torres || []).slice().sort((a, b) => b.bajas - a.bajas)
  const trabajaron = torres.filter(t => t.bajas > 0)
  const rotos = daños.slice().sort((a, b) => b.dano - a.dano)
  const robado = { ...perdidas }

  // Lo que cuesta dejarlo todo como estaba (un tercio del nivel, igual que sim/buildings).
  const coste = { madera: 0, piedra: 0, comida: 0, oro: 0 }
  for (const d of rotos) {
    const c = def(d.tipo)?.coste(Math.max(1, d.nivel || 1)) || {}
    for (const k of CONFIG.RECURSOS) coste[k] += Math.ceil((c[k] || 0) / 3)
  }

  const defensa = calcularDefensa(s)
  const agujeros = (defensa.consejos || []).slice(0, 3)

  const nombre = atacante?.nombre || 'La hueste'
  const hayMuro = (s.buildings || []).some(b => (b.tipo === 'muralla' || b.tipo === 'puerta') && !b.enObra)
  const titular = defendida
    ? (hayMuro ? `${nombre} se ha estrellado contra tus muros` : `${nombre} se ha dado media vuelta`)
    : `${nombre} ha entrado en la aldea`
  const partes = []
  partes.push(defendida
    ? `Aguantaste el asalto: ${bajasEnemigas} de los ${atacantes} atacantes se quedaron en el campo.`
    : `Arrasaron el ${r.porcentajeDestruido} % de la aldea y se llevaron lo que pudieron cargar.`)
  if (r.defensores) {
    partes.push(misCaidos
      ? `Tu guarnición de ${r.defensores} salió a pelear y perdiste ${plural(misCaidos, 'hombre', 'hombres')}.`
      : `Tus ${r.defensores} de guarnición salieron a pelear y volvieron todos.`)
  } else {
    partes.push('No tenías un solo soldado en casa: solo defendieron las piedras.')
  }
  if (trabajaron.length) {
    const mejor = trabajaron[0]
    partes.push(`${mejor.nombre} nivel ${mejor.nivel} se llevó por delante a ${plural(mejor.bajas, 'atacante', 'atacantes')}.`)
  } else if (torres.length) {
    partes.push('Tus torres dispararon sin abatir a nadie: están mal puestas o se les quedan cortas.')
  } else {
    partes.push('No tienes una sola torre: entraron andando y sin prisa.')
  }
  if (!defendida) partes.push(`Escudo de protección de ${HORAS_ESCUDO} h para rehacerte.`)

  return {
    titular,
    resumen: partes.join(' '),
    victoria: defendida,
    torres, trabajaron: trabajaron.length, rotos, robado,
    bajasEnemigas, atacantes, coste, agujeros,
    misBajas, misCaidos, defensores: r.defensores || 0, curadas: parteBajas?.curadas || null,
    nota: defensa.nota, puntuacion: defensa.puntuacion,
    escudoHasta: (s.escudo && s.escudo.hasta) || 0
  }
}

// ------------------------------------------ PUNTUACIÓN DE TU DEFENSA

/**
 * Cuánto aguanta tu aldea tal como está ahora. No es un número por presumir:
 * saca los boquetes de la muralla y lo que está fuera, que es lo que hace que
 * el jugador vuelva a reorganizar la aldea.
 */
export function calcularDefensa (estado = game.state) {
  // 'aldea': el recuento del recinto se hace dentro de TU linde, no del valle.
  const esc = prepararBase({ id: 'aldea', buildings: estado.buildings || [] }, estado)
  const vale = esc.edificios.filter(e => !e.esMuro && e.tipo !== 'pozo' && e.tipo !== 'estandarte')
  const resultado = {
    puntuacion: 0, nota: 'Indefensa', cobertura: 0, recinto: 0, resumen: '',
    cerrada: false, brechas: 0, desprotegidos: [], consejos: [], dps: 0, murosVivos: 0,
    torres: 0, dpsEsperado: 0
  }
  if (!vale.length) {
    resultado.resumen = 'Todavía no hay nada que defender.'
    resultado.consejos.push('Todavía no hay nada que defender.')
    return resultado
  }

  // 1) Cobertura de torres: valor cubierto por al menos una torre / valor total.
  let cubierto = 0; let total = 0; let dps = 0
  for (const t of esc.torres) dps += t.dano * (t.cadencia || 0)
  for (const e of vale) {
    total += e.valor
    let dentro = false
    for (const t of esc.torres) {
      if (t.id === e.id) { dentro = true; break }
      if (distAEdificio(e.cx, e.cz, t) <= t.radio) { dentro = true; break }
    }
    if (dentro) cubierto += e.valor
    e._cubierto = dentro
  }
  resultado.cobertura = Math.round((cubierto / total) * 100)
  resultado.dps = Math.round(dps)

  // 2) Recinto: se inunda el tablero desde el borde; lo que la inundación NO toca
  //    está de verdad dentro de la muralla. Es la prueba de fuego del cerco.
  // La puerta cuenta como cerco: `bloquea:false` es para que pasen los tuyos,
  // pero un asaltante tiene que echarla abajo igual que un tramo de muralla.
  const muros = esc.edificios.filter(e => e.esMuro)
  resultado.murosVivos = muros.length
  const K = esc.caja; const W = esc.ancho; const H = esc.alto
  const bloqueo = new Uint8Array(W * H)
  for (const m of muros) {
    const mz1 = Math.min(m.z + m.alto - 1, K.z1)
    const mx1 = Math.min(m.x + m.ancho - 1, K.x1)
    for (let z = Math.max(m.z, K.z0); z <= mz1; z++) {
      for (let x = Math.max(m.x, K.x0); x <= mx1; x++) bloqueo[(z - K.z0) * W + (x - K.x0)] = 1
    }
  }
  const fuera = new Uint8Array(W * H)
  const cola = new Int32Array(W * H)
  let cab = 0; let fin = 0
  for (let x = 0; x < W; x++) {
    for (const j of [x, (H - 1) * W + x]) {
      if (!bloqueo[j] && !fuera[j]) { fuera[j] = 1; cola[fin++] = j }
    }
  }
  for (let z = 0; z < H; z++) {
    for (const j of [z * W, z * W + W - 1]) {
      if (!bloqueo[j] && !fuera[j]) { fuera[j] = 1; cola[fin++] = j }
    }
  }
  while (cab < fin) {
    const i = cola[cab++]
    const x = i % W; const z = (i / W) | 0
    if (x > 0 && !bloqueo[i - 1] && !fuera[i - 1]) { fuera[i - 1] = 1; cola[fin++] = i - 1 }
    if (x < W - 1 && !bloqueo[i + 1] && !fuera[i + 1]) { fuera[i + 1] = 1; cola[fin++] = i + 1 }
    if (z > 0 && !bloqueo[i - W] && !fuera[i - W]) { fuera[i - W] = 1; cola[fin++] = i - W }
    if (z < H - 1 && !bloqueo[i + W] && !fuera[i + W]) { fuera[i + W] = 1; cola[fin++] = i + W }
  }

  let protegido = 0
  for (const e of vale) {
    let expuesto = false
    for (let z = e.z - 1; z <= e.z + e.alto && !expuesto; z++) {
      for (let x = e.x - 1; x <= e.x + e.ancho; x++) {
        if (x < K.x0 || z < K.z0 || x > K.x1 || z > K.z1) { expuesto = true; break }
        if (fuera[(z - K.z0) * W + (x - K.x0)]) { expuesto = true; break }
      }
    }
    e._dentro = !expuesto
    if (!expuesto) protegido += e.valor
    if (expuesto || !e._cubierto) {
      resultado.desprotegidos.push({
        id: e.id, tipo: e.tipo, nombre: e.nombre, x: e.x, z: e.z,
        motivo: expuesto && !e._cubierto ? 'fuera de la muralla y sin torre que lo cubra'
          : expuesto ? 'fuera de la muralla' : 'sin torre que lo cubra'
      })
    }
  }
  resultado.recinto = Math.round((protegido / total) * 100)

  // 3) Brechas: casillas por las que se cuela el enemigo pegando a un muro.
  //    Si hay muralla pero nada queda dentro, es que no cierra por ningún lado.
  let brechas = 0
  for (let i = 0; i < bloqueo.length; i++) {
    if (bloqueo[i] || !fuera[i]) continue
    const x = i % W; const z = (i / W) | 0
    let tocaMuro = false; let tocaDentro = false
    const vec = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, z > 0 ? i - W : -1, z < H - 1 ? i + W : -1]
    for (const j of vec) {
      if (j < 0) continue
      if (bloqueo[j]) tocaMuro = true
      else if (!fuera[j]) tocaDentro = true
    }
    if (tocaMuro && tocaDentro) brechas++
  }
  resultado.brechas = brechas
  resultado.cerrada = muros.length > 0 && protegido > 0 && brechas === 0

  // 4) La nota. Torres 45 %, recinto 35 %, pegada de las torres 20 % (comparada con
  //    lo que se espera a tu nivel de ayuntamiento: crecer sin defensas se nota).
  const nivel = nivelDe(estado.buildings || [], 'ayuntamiento') || 1
  const esperado = 18 * Math.pow(1.45, nivel - 1)
  resultado.torres = esc.torres.length
  resultado.dpsEsperado = Math.round(esperado)
  const pegada = clamp(dps / esperado, 0, 1.2)
  let p = resultado.cobertura * 0.45 + resultado.recinto * 0.35 + pegada * 100 * 0.20
  if (brechas > 0) p -= Math.min(15, brechas * 3)     // un boquete se paga
  resultado.puntuacion = clamp(Math.round(p), 0, 100)
  resultado.nota = resultado.puntuacion >= 80 ? 'Inexpugnable'
    : resultado.puntuacion >= 60 ? 'Bien defendida'
      : resultado.puntuacion >= 40 ? 'Se puede colar cualquiera'
        : resultado.puntuacion >= 20 ? 'Floja' : 'Indefensa'

  // 5) Los consejos, que es lo que de verdad lee el jugador. Concretos y con
  //    número: "pon una torre más" vale mil veces más que "mejora tu defensa".
  if (!esc.torres.length) resultado.consejos.push('No tienes ni una torre: cualquiera entra andando. Levanta una torre vigía junto al ayuntamiento.')
  else if (resultado.cobertura < 60) resultado.consejos.push(`Tus torres solo cubren el ${resultado.cobertura} % de la aldea. Muévelas hacia el centro, o pon otra.`)
  if (dps < esperado * 0.6 && esc.torres.length) {
    resultado.consejos.push(`Tus torres hacen ${Math.round(dps)} de daño por segundo y para tu ayuntamiento nivel ${nivel} harían falta unos ${Math.round(esperado)}: súbelas de nivel.`)
  }
  if (!muros.length) resultado.consejos.push('Sin muralla no hay aldea que aguante: cierra al menos el ayuntamiento.')
  else if (!resultado.cerrada) resultado.consejos.push(brechas ? `La muralla tiene ${plural(brechas, 'boquete', 'boquetes')}: se cuelan sin dar un golpe. Cierra el hueco con muralla o con una puerta.` : 'La muralla no cierra nada: no encierra ningún edificio.')
  const fueraValiosos = resultado.desprotegidos.filter(d => d.motivo !== 'sin torre que lo cubra').slice(0, 3)
  for (const d of fueraValiosos) resultado.consejos.push(`${d.nombre}: ${d.motivo}.`)
  if (!resultado.consejos.length) resultado.consejos.push('La aldea está bien atada. Sube de nivel las torres para que siga así.')

  // Una frase que resuma la nota, para que el jugador entienda QUÉ significa.
  resultado.resumen = resultado.puntuacion >= 80
    ? `Inexpugnable: ${resultado.cobertura} % cubierto por torres y la muralla cerrada. Quien venga, se deja los dientes.`
    : resultado.puntuacion >= 60
      ? `Bien defendida: ${resultado.cobertura} % bajo tus torres. Aguanta un asalto normal, no una campaña.`
      : resultado.puntuacion >= 40
        ? `Se puede colar cualquiera: solo el ${resultado.recinto} % de la aldea está dentro de la muralla.`
        : resultado.puntuacion >= 20
          ? 'Floja: hay más aldea fuera que dentro, y las torres no llegan.'
          : 'Indefensa: el primero que pase se lleva el granero entero.'

  events.emit(EV.DEFENSE_SCORED, { puntuacion: resultado.puntuacion, nota: resultado.nota, consejos: resultado.consejos, resumen: resultado.resumen })
  return resultado
}

// -------------------------------------------------------------------- init

/** Ataques anunciados que todavía no han llegado. No se guardan: son de esta sesión. */
const pendientes = []

export async function init () {
  modArmy = await cargarOpcional('./army.js')
  modRes = await cargarOpcional('./resources.js')

  events.on(EV.RAID_REQUESTED, (p = {}) => {
    if (!p.base) return
    lanzarAsalto(p)
  })

  // Alguien (world/enemies) anuncia una visita: la resolvemos cuando llegue.
  events.on(EV.ATTACK_INCOMING, (p = {}) => {
    if (!p || p.resuelto) return
    if (!sumaTropas(p.tropas || p.tropasEnemigas)) return   // aviso sin hueste: no hay asedio
    pendientes.push({
      atacante: p.enemigo || p.atacante || { nombre: 'Bandidos' },
      tropas: p.tropas || p.tropasEnemigas || {},
      cuando: Date.now() + Math.max(0, (p.llegaEn || 0)) * 1000
    })
  })

  events.on(EV.TICK, () => {
    if (!pendientes.length) return
    const ahora = Date.now()
    for (let i = pendientes.length - 1; i >= 0; i--) {
      if (pendientes[i].cuando > ahora) continue
      const a = pendientes.splice(i, 1)[0]
      simularDefensa({ atacante: a.atacante, tropasEnemigas: a.tropas })
    }
  })
}

export default { init, simularAsalto, reproducir, botinDe, simularDefensa, calcularDefensa, lanzarAsalto }
