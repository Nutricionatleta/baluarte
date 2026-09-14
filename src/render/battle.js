import * as THREE from 'three'
import { PALETA, CONFIG } from '../core/config.js'
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { def, valorEdificio } from '../data/buildings.js'
import { UNIDADES } from '../data/units.js'
import { ctx, cuandoListo, onFrame } from './ctx.js'
import { mat, G, pieza } from './mats.js'
import { crearEdificio } from './buildings.js'
import { crearActor, limpiarActores } from './units.js'
import { reproducir } from '../sim/combat.js'

/**
 * EL CAMPO DE BATALLA EN 3D.
 *
 * Antes un asalto era una lista de frases y un plano de cajitas: se sabía el
 * resultado, pero no qué había pasado ni por qué. Aquí se levanta la base de
 * verdad —los mismos edificios, las mismas murallas, las mismas torres—, entran
 * las tropas por el lado elegido y la crónica de `sim/combat.js` se convierte en
 * lo que se ve: quién pega a qué, de dónde salen las flechas y por dónde se rompe.
 *
 * Tres reglas gobiernan el fichero:
 *   1. LA CRÓNICA MANDA. Este módulo no decide nada del combate: `simularAsalto`
 *      ya dijo qué cae, cuándo y con cuántas bajas. Aquí solo se coreografía. Si
 *      la crónica dice que la puerta norte cae en el segundo 20, la puerta norte
 *      cae en el segundo 20, pase lo que pase con los muñecos.
 *   2. NADA DE `game.state`. Es render: mira y dibuja. Lo único que escribe es su
 *      propio recuerdo del último asedio, en localStorage, para poder ofrecértelo
 *      al volver ("te asaltaron anoche").
 *   3. MÓVIL. Los modelos son los cacheados de buildings.js y units.js, las
 *      unidades a la vista tienen tope, los proyectiles y el humo van en piscinas
 *      y al salir se recoge todo.
 */

// ── cuántos muñecos caben a la vez según lo que aguante el móvil ────────────
const TOPE_ACTORES = { bajo: 16, medio: 28, alto: 40 }
const TOPE_DEFENSORES = { bajo: 6, medio: 10, alto: 14 }
const PASO_IA = 0.34          // cada cuántos segundos de batalla se repiensa el rumbo
const SEG_FINAL = 1.1         // respiro entre el último suceso y el parte

const OPUESTO = { norte: 'sur', sur: 'norte', este: 'oeste', oeste: 'este' }

let capa = null               // el div de la interfaz de batalla
let B = null                  // la batalla en marcha
let bajaFrame = null          // baja del onFrame
let recuerdo = null           // último asedio guardado, por si quieres verlo
let avisoHueste = null        // la hueste que anunció ATTACK_INCOMING, para pintarla
const CLAVE_RECUERDO = 'baluarte.asedio'

// ════════════════════════════════════════════════════════════════════════
//  ESTILO (propio: esta pantalla no es una hoja, es un HUD sobre el 3D)
// ════════════════════════════════════════════════════════════════════════

const CSS = `
.bat-capa { position: fixed; inset: 0; z-index: 70; pointer-events: none;
  font-family: var(--tipo, system-ui); color: var(--pergamino, #f3e6c8);
  display: flex; flex-direction: column; justify-content: space-between; }
.bat-capa > * { pointer-events: auto; }
.bat-marcador { margin: calc(var(--seg-arriba, 0px) + 8px) 8px 0; padding: 8px 10px;
  background: linear-gradient(180deg, rgba(26,16,8,.88), rgba(26,16,8,.72));
  border: 1px solid rgba(212,164,55,.5); border-radius: var(--r-m, 14px);
  box-shadow: 0 8px 22px rgba(0,0,0,.45); display: flex; flex-direction: column; gap: 6px; }
.bat-fila { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.bat-estrellas { font-size: 1.25em; letter-spacing: 3px; color: var(--oro-claro, #f2c85c); flex: none; }
.bat-pct { font-weight: 800; font-size: 1.3em; font-variant-numeric: tabular-nums; }
.bat-dato { font-size: .82em; opacity: .92; font-variant-numeric: tabular-nums; white-space: nowrap; }
.bat-barra { height: 9px; border-radius: 99px; background: rgba(255,255,255,.16); overflow: hidden; }
.bat-barra i { display: block; height: 100%; width: 0%; border-radius: 99px;
  background: linear-gradient(90deg, var(--oro, #d4a437), var(--rojo-claro, #d4564a)); transition: width .25s linear; }
.bat-linea { font-size: .86em; line-height: 1.3; min-height: 2.3em; opacity: .95; }
.bat-linea b { color: var(--oro-claro, #f2c85c); font-weight: 700; }
.bat-leyenda { display: flex; gap: 12px; font-size: .72em; opacity: .85; }
.bat-bando { display: flex; align-items: center; gap: 4px; }
.bat-bando::before { content: ''; width: 11px; height: 11px; border-radius: 99px; border: 1px solid rgba(255,255,255,.5); }
.bat-bando.nuestro::before { background: #1e88e5; }
.bat-bando.suyo::before { background: #8e2b2b; }
.bat-medio { flex: 1; position: relative; pointer-events: none; }
.bat-marca { position: absolute; transform: translate(-50%, -100%); pointer-events: none; z-index: 2;
  background: rgba(26,16,8,.86); border: 1px solid var(--rojo-claro, #d4564a); color: var(--pergamino, #f3e6c8);
  padding: 3px 7px; border-radius: 99px; font-size: .72em; font-weight: 700; white-space: nowrap;
  box-shadow: 0 4px 10px rgba(0,0,0,.4); }
.bat-marca.floja { border-color: var(--oro, #d4a437); }
.bat-mandos { display: flex; gap: 6px; padding: 8px; padding-bottom: calc(var(--seg-abajo, 0px) + 8px); }
.bat-btn { flex: 1; min-height: 48px; border-radius: var(--r-m, 14px); border: 1px solid rgba(212,164,55,.45);
  background: linear-gradient(180deg, rgba(58,36,21,.95), rgba(26,16,8,.95)); color: var(--pergamino, #f3e6c8);
  font-family: inherit; font-size: .8em; font-weight: 700; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 2px; cursor: pointer; }
.bat-btn b { font-size: 1.25em; font-weight: 400; }
.bat-btn.on { background: linear-gradient(180deg, var(--oro, #d4a437), var(--oro-oscuro, #9c7413)); color: #2d1b0e; }
.bat-btn:active { transform: translateY(1px); }
.bat-parte { margin: 0 8px 8px; padding: 12px; max-height: 62vh; overflow-y: auto;
  background: linear-gradient(180deg, var(--pergamino-claro, #fbf4e4), var(--pergamino, #f3e6c8));
  color: var(--tinta, #2d1b0e); border-radius: var(--r-g, 20px); border: 2px solid var(--madera, #5a3a22);
  box-shadow: 0 -10px 30px rgba(0,0,0,.5); display: flex; flex-direction: column; gap: 8px; }
.bat-parte h2 { margin: 0; text-align: center; font-size: 1.3em; }
.bat-parte .grandes { text-align: center; font-size: 2.1em; letter-spacing: 6px; color: var(--oro-oscuro, #9c7413); }
.bat-parte .sec { font-weight: 800; font-size: .92em; color: var(--madera, #5a3a22);
  border-bottom: 1px solid rgba(90,58,34,.25); padding-bottom: 2px; }
.bat-parte .txt { font-size: .88em; line-height: 1.45; }
.bat-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.bat-chip { background: rgba(90,58,34,.1); border: 1px solid rgba(90,58,34,.28); border-radius: 99px;
  padding: 3px 9px; font-size: .8em; font-weight: 700; }
.bat-chip.mal { background: rgba(179,51,43,.14); border-color: rgba(179,51,43,.45); color: var(--rojo-oscuro, #7a1f19); }
.bat-chip.bien { background: rgba(74,143,60,.14); border-color: rgba(74,143,60,.45); color: var(--verde-oscuro, #2f6125); }
.bat-flojo { display: flex; gap: 7px; align-items: flex-start; font-size: .85em; line-height: 1.35;
  background: rgba(179,51,43,.09); border-left: 3px solid var(--rojo, #b3332b);
  border-radius: 0 var(--r-s, 8px) var(--r-s, 8px) 0; padding: 6px 8px; }
.bat-flojo.aviso { background: rgba(212,164,55,.13); border-left-color: var(--oro, #d4a437); }
.bat-aviso { position: fixed; left: 8px; right: 8px; bottom: calc(var(--seg-abajo, 0px) + 78px); z-index: 55;
  background: linear-gradient(180deg, var(--rojo, #b3332b), var(--rojo-oscuro, #7a1f19));
  color: #fff5e8; border: 1px solid rgba(255,255,255,.25); border-radius: var(--r-m, 14px);
  padding: 10px 12px; display: flex; align-items: center; gap: 10px; box-shadow: 0 10px 26px rgba(0,0,0,.4);
  font-family: var(--tipo, system-ui); font-size: .88em; }
.bat-aviso button { min-height: 40px; border-radius: var(--r-s, 8px); border: 0; font-weight: 800;
  background: var(--oro, #d4a437); color: #2d1b0e; padding: 0 12px; font-family: inherit; cursor: pointer; }
.bat-aviso .cerrar { background: transparent; color: #fff5e8; padding: 0 6px; font-size: 1.1em; }
`

function ponerEstilo () {
  if (document.getElementById('css-batalla')) return
  const s = document.createElement('style')
  s.id = 'css-batalla'
  s.textContent = CSS
  document.head.appendChild(s)
}

const nodo = (tag, clase, texto) => {
  const n = document.createElement(tag)
  if (clase) n.className = clase
  if (texto != null) n.textContent = texto
  return n
}

const boton = (icono, texto, alPulsar) => {
  const b = nodo('button', 'bat-btn')
  b.type = 'button'
  b.appendChild(nodo('b', null, icono))
  b.appendChild(nodo('span', null, texto))
  b.addEventListener('click', alPulsar)
  return b
}

// ════════════════════════════════════════════════════════════════════════
//  GEOMETRÍAS Y MATERIALES PROPIOS (una sola vez, como manda mats.js)
// ════════════════════════════════════════════════════════════════════════

let geoAnillo = null
const anilloGeo = () => (geoAnillo ||= new THREE.TorusGeometry(0.5, 0.055, 3, 18))

const MB = {
  get suelo () { return mat(PALETA.hierba) },
  get bordeSuelo () { return mat(PALETA.hierbaOscura) },
  get barraFondo () { return mat(PALETA.carbon, { transparente: 0.85 }) },
  get barraAlta () { return mat(PALETA.hierbaClara) },
  get barraMedia () { return mat(PALETA.brasa) },
  get barraBaja () { return mat(PALETA.tela) },
  // dorado y luminoso: sobre hierba verde y piedra gris, lo único que se lee a 40 m
  get flecha () { return mat(PALETA.brasa, { emisivo: 0x996600 }) },
  get humo () { return mat(PALETA.ceniza, { transparente: 0.62 }) },
  get brecha () { return mat(PALETA.enemigo, { transparente: 0.42 }) },
  get descubierto () { return mat(PALETA.oro, { transparente: 0.34 }) },
  // el disco bajo los pies: desde arriba la cara no se ve, el color del suelo sí
  get peanaNuestra () { return mat(PALETA.estandarte, { transparente: 0.85 }) },
  get peanaSuya () { return mat(PALETA.enemigo, { transparente: 0.85 }) }
}

// ════════════════════════════════════════════════════════════════════════
//  EL ESCENARIO
// ════════════════════════════════════════════════════════════════════════

const DIRS = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]]
const ANCLAJES = new Set(['muralla', 'puerta', 'torre_vigia', 'torre_ballesta', 'castillo'])
const MUROS = new Set(['muralla', 'puerta'])
const TORRES = new Set(['torre_vigia', 'torre_ballesta', 'castillo'])

/** Recorta la lista de edificios a lo que el motor de combate considera vivo. */
function leerBase (base) {
  const lista = (base.buildings || []).filter(b => !b.enObra && def(b.tipo))
  const eds = []
  const ocupadas = new Map()
  for (const b of lista) {
    const d = def(b.tipo)
    const nivel = Math.max(1, Math.min(d.maxNivel || 1, b.nivel || 1))
    const ancho = d.ancho || 1
    const alto = d.alto || 1
    for (let i = 0; i < ancho; i++) {
      for (let j = 0; j < alto; j++) ocupadas.set(`${(b.x | 0) + i}|${(b.z | 0) + j}`, b.tipo)
    }
    eds.push({
      id: b.id, tipo: b.tipo, nombre: d.nombre, nivel, rot: b.rot | 0,
      x: b.x | 0, z: b.z | 0, ancho, alto,
      cx: (b.x | 0) + (ancho - 1) / 2,
      cz: (b.z | 0) + (alto - 1) / 2,
      hpMax: d.hp(nivel), hp: d.hp(nivel),
      valor: Math.max(1, valorEdificio(b.tipo, nivel)),
      esMuro: MUROS.has(b.tipo),
      cuenta: !MUROS.has(b.tipo),
      bloquea: d.bloquea === true,
      radio: typeof d.radio === 'function' ? d.radio(nivel) : 0,
      dano: typeof d.dano === 'function' ? d.dano(nivel) : 0,
      cadencia: d.cadencia || 0,
      vivo: true, g: null, barra: null, altura: 2, cd: Math.random(), cobrar: 0,
      wx: 0, wz: 0, tGolpe: null
    })
  }
  return { eds, ocupadas }
}

/** La muralla cambia de forma según con quién se traba: misma regla que la aldea. */
function mascaraEn (ocupadas, x, z) {
  let m = 0
  for (const [dx, dz, bit] of DIRS) if (ANCLAJES.has(ocupadas.get(`${x + dx}|${z + dz}`))) m |= bit
  return m
}

function giroDe (e) {
  const rot = e.rot % 4
  if (e.tipo === 'muralla') return 0
  if (e.ancho === e.alto || e.tipo === 'puerta') return -rot * Math.PI / 2
  return rot % 2 ? 0 : -rot * Math.PI / 2
}

/** Monta el terreno y los edificios. La base queda centrada en el origen del mundo. */
function montarEscenario (base) {
  const { eds, ocupadas } = leerBase(base)
  let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity
  for (const e of eds) {
    x0 = Math.min(x0, e.x); z0 = Math.min(z0, e.z)
    x1 = Math.max(x1, e.x + e.ancho); z1 = Math.max(z1, e.z + e.alto)
  }
  if (!eds.length) { x0 = z0 = 0; x1 = z1 = 16 }
  const cx = (x0 + x1 - 1) / 2
  const cz = (z0 + z1 - 1) / 2
  const anchoBase = Math.max(x1 - x0, z1 - z0)

  const raiz = new THREE.Group()
  raiz.name = 'campo-batalla'
  ctx.scene.add(raiz)

  const aMundo = (x, z) => ({ x: (x - cx) * CONFIG.CELDA, z: (z - cz) * CONFIG.CELDA })

  // --- el prado: una losa con canto, para que desde ras de suelo se vea el borde ---
  const ladoPrado = anchoBase + 18
  raiz.add(pieza(G.caja, MB.suelo, { y: -0.3, sx: ladoPrado, sy: 0.6, sz: ladoPrado, sombra: false }))
  raiz.add(pieza(G.caja, MB.bordeSuelo, { y: -0.64, sx: ladoPrado + 1.6, sy: 0.5, sz: ladoPrado + 1.6, sombra: false }))

  // --- los edificios de verdad ---
  const caja = new THREE.Box3()
  for (const e of eds) {
    const mask = e.tipo === 'muralla' ? mascaraEn(ocupadas, e.x, e.z) : 0
    const g = crearEdificio(e.tipo, e.nivel, { mask })
    const w = aMundo(e.cx, e.cz)
    g.position.set(w.x, 0, w.z)
    g.rotation.y = giroDe(e)
    raiz.add(g)
    caja.setFromObject(g)
    e.altura = Math.max(0.8, caja.max.y)
    e.g = g
    e.wx = w.x
    e.wz = w.z
  }

  return {
    raiz, eds, cx, cz, aMundo, anchoBase,
    porId: new Map(eds.map(e => [e.id, e])),
    torres: eds.filter(e => e.dano > 0 && e.cadencia > 0)
  }
}

// ── bloqueo y campo de flujo: por dónde puede pasar la tropa ────────────────

/** Rejilla local de estorbos. Se rehace cuando cae algo que tapaba el paso. */
function mapaBloqueo (esc) {
  const n = esc.gn
  const m = esc.bloqueo || new Uint8Array(n * n)
  m.fill(0)
  for (const e of esc.eds) {
    if (!e.vivo || !e.bloquea) continue
    for (let z = e.z; z < e.z + e.alto; z++) {
      for (let x = e.x; x < e.x + e.ancho; x++) {
        const lx = x - esc.gx0; const lz = z - esc.gz0
        if (lx < 0 || lz < 0 || lx >= n || lz >= n) continue
        m[lz * n + lx] = 1
      }
    }
  }
  return m
}

/**
 * Campo de flujo (BFS) hacia un edificio. Es lo que hace que la tropa entre por
 * la puerta o por la brecha en vez de caminar contra la piedra, que es justo lo
 * que el jugador tiene que VER para entender su defensa.
 */
function campoHacia (esc, obj) {
  const guardado = esc.campos.get(obj.id)
  if (guardado && guardado.version === esc.version) return guardado.campo
  const n = esc.gn
  const campo = guardado ? guardado.campo : new Int16Array(n * n)
  campo.fill(-1)
  const cola = esc.cola
  let cab = 0; let fin = 0
  for (let z = obj.z - 1; z <= obj.z + obj.alto; z++) {
    for (let x = obj.x - 1; x <= obj.x + obj.ancho; x++) {
      const lx = x - esc.gx0; const lz = z - esc.gz0
      if (lx < 0 || lz < 0 || lx >= n || lz >= n) continue
      const i = lz * n + lx
      const propio = x >= obj.x && x < obj.x + obj.ancho && z >= obj.z && z < obj.z + obj.alto
      if (esc.bloqueo[i] && !propio) continue
      if (campo[i] !== -1) continue
      campo[i] = 0
      cola[fin++] = i
    }
  }
  while (cab < fin) {
    const i = cola[cab++]
    const x = i % n; const z = (i / n) | 0
    const d = campo[i] + 1
    if (x > 0) { const j = i - 1; if (campo[j] === -1 && !esc.bloqueo[j]) { campo[j] = d; cola[fin++] = j } }
    if (x < n - 1) { const j = i + 1; if (campo[j] === -1 && !esc.bloqueo[j]) { campo[j] = d; cola[fin++] = j } }
    if (z > 0) { const j = i - n; if (campo[j] === -1 && !esc.bloqueo[j]) { campo[j] = d; cola[fin++] = j } }
    if (z < n - 1) { const j = i + n; if (campo[j] === -1 && !esc.bloqueo[j]) { campo[j] = d; cola[fin++] = j } }
  }
  esc.campos.set(obj.id, { version: esc.version, campo })
  return campo
}

// ════════════════════════════════════════════════════════════════════════
//  EFECTOS: barras de vida, disparos, humo y derrumbes
// ════════════════════════════════════════════════════════════════════════

function crearBarra (e) {
  const g = new THREE.Group()
  const fondo = pieza(G.caja, MB.barraFondo, { sx: 1.25, sy: 0.17, sz: 0.05, sombra: false, recibe: false })
  const relleno = pieza(G.caja, MB.barraAlta, { z: 0.04, sx: 1.18, sy: 0.11, sz: 0.05, sombra: false, recibe: false })
  relleno.name = 'relleno'
  g.add(fondo, relleno)
  g.position.set(e.wx, e.altura + 0.6, e.wz)
  g.renderOrder = 4
  return g
}

function refrescarBarra (esc, e) {
  const frac = Math.max(0, Math.min(1, e.hp / e.hpMax))
  if (frac >= 0.999 || !e.vivo) {
    if (e.barra) e.barra.visible = false
    return
  }
  if (!e.barra) { e.barra = crearBarra(e); esc.raiz.add(e.barra); B.conBarra.push(e) }
  e.barra.visible = true
  const r = e.barra.getObjectByName('relleno')
  r.scale.x = Math.max(0.02, frac * 1.18)
  r.position.x = -(1.18 - r.scale.x) / 2
  r.material = frac > 0.55 ? MB.barraAlta : frac > 0.25 ? MB.barraMedia : MB.barraBaja
}

/** Piscina de proyectiles: ni un `new` una vez arrancada la batalla. */
function piscinaDisparos (raiz, n) {
  const lista = []
  for (let i = 0; i < n; i++) {
    const m = pieza(G.caja, MB.flecha, { sx: 0.13, sy: 0.13, sz: 0.95, sombra: false, recibe: false })
    m.renderOrder = 5
    m.visible = false
    raiz.add(m)
    lista.push({ malla: m, vivo: false, k: 0, dur: 0.3, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 })
  }
  return lista
}

function piscinaHumo (raiz, n) {
  const lista = []
  for (let i = 0; i < n; i++) {
    const m = pieza(G.esfera, MB.humo, { sombra: false, recibe: false })
    m.visible = false
    raiz.add(m)
    lista.push({ malla: m, vivo: false, k: 0, dur: 1.4, x: 0, y: 0, z: 0, r: 0.5, sube: 1 })
  }
  return lista
}

function disparar (x0, y0, z0, x1, y1, z1) {
  const d = B.disparos.find(p => !p.vivo)
  if (!d) return
  d.vivo = true; d.k = 0
  // el vuelo se alarga a propósito: una flecha instantánea no la ve nadie
  d.dur = 0.28 + Math.hypot(x1 - x0, z1 - z0) * 0.05
  d.x0 = x0; d.y0 = y0; d.z0 = z0
  d.x1 = x1; d.y1 = y1; d.z1 = z1
  d.malla.visible = true
  d.malla.position.set(x0, y0, z0)
  d.malla.lookAt(x1, y1, z1)
}

function humear (x, y, z, radio = 0.6, cuantos = 4) {
  for (let i = 0; i < cuantos; i++) {
    const h = B.humo.find(p => !p.vivo)
    if (!h) return
    h.vivo = true; h.k = 0
    h.dur = 1.1 + Math.random() * 0.9
    h.x = x + (Math.random() - 0.5) * radio * 1.6
    h.z = z + (Math.random() - 0.5) * radio * 1.6
    h.y = y + Math.random() * 0.3
    h.r = radio * (0.5 + Math.random() * 0.7)
    h.sube = 0.6 + Math.random() * 0.9
    h.malla.visible = true
  }
}

/** Un edificio que cae: se hunde, se tuerce y suelta polvo. */
function derrumbar (esc, e, instantaneo) {
  if (!e.vivo) return
  e.vivo = false
  e.hp = 0
  if (e.barra) e.barra.visible = false
  esc.version++
  esc.bloqueo = mapaBloqueo(esc)
  if (instantaneo) {
    if (e.g) e.g.visible = false
    return
  }
  B.derrumbes.push({ g: e.g, k: 0, dur: 0.75 })
  humear(e.wx, 0.4, e.wz, 0.5 + Math.max(e.ancho, e.alto) * 0.32, e.esMuro ? 4 : 8)
}

// ════════════════════════════════════════════════════════════════════════
//  PUNTOS FLOJOS: lo que el dueño quiere ver
// ════════════════════════════════════════════════════════════════════════

const ladoDe = (x, z, cx, cz) => {
  const dx = x - cx; const dz = z - cz
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'este' : 'oeste'
  return dz > 0 ? 'sur' : 'norte'
}

/** ¿Está este edificio dentro del alcance de alguna torre? Devuelve cuál. */
function cubiertoPorTorre (e, torres) {
  for (const t of torres) {
    if (t.id === e.id) return t
    const dx = Math.max(t.x - (e.x + e.ancho - 1), 0, e.x - (t.x + t.ancho - 1))
    const dz = Math.max(t.z - (e.z + e.alto - 1), 0, e.z - (t.z + t.alto - 1))
    if (Math.sqrt(dx * dx + dz * dz) <= t.radio) return t
  }
  return null
}

/**
 * El análisis honesto: por dónde se rompió y qué estaba desnudo. Se calcula con
 * la base tal como empezó (torres incluidas) y la crónica ya cerrada.
 */
function analizarFlojos (esc, resultado) {
  const torres = esc.eds.filter(e => e.dano > 0)
  const caidos = new Map()
  for (const s of resultado.sucesos || []) {
    if (s.tipo === 'edificio_caido' && s.edificioId && !caidos.has(s.edificioId)) caidos.set(s.edificioId, s.t)
  }

  // 1) brechas: tramos de muro caídos, agrupados por lado
  const porLado = new Map()
  for (const [id, t] of caidos) {
    const e = esc.porId.get(id)
    if (!e || !e.esMuro) continue
    const lado = ladoDe(e.cx, e.cz, esc.cx, esc.cz)
    const clave = `${lado}|${e.tipo}`
    const g = porLado.get(clave)
    if (g) { g.n++; g.t = Math.min(g.t, t); g.sx += e.cx; g.sz += e.cz } else {
      porLado.set(clave, { lado, tipo: e.tipo, n: 1, t, sx: e.cx, sz: e.cz, x: 0, z: 0, cubierta: cubiertoPorTorre(e, torres) })
    }
  }
  const brechas = []
  for (const g of porLado.values()) { g.x = g.sx / g.n; g.z = g.sz / g.n; brechas.push(g) }
  brechas.sort((a, b) => a.t - b.t)

  // 2) lo que nadie cubría: edificios que valen algo fuera del alcance de toda torre
  const desnudos = []
  for (const e of esc.eds) {
    if (e.esMuro || e.dano > 0 || e.tipo === 'pozo' || e.tipo === 'estandarte') continue
    if (!cubiertoPorTorre(e, torres)) desnudos.push(e)
  }
  desnudos.sort((a, b) => b.valor - a.valor)

  return { brechas, desnudos, torres, caidos }
}

/** Marca en el suelo: aro de color y etiqueta flotante que sigue a la cámara. */
function marcar (esc, x, z, texto, tono) {
  const g = new THREE.Group()
  const aro = new THREE.Mesh(anilloGeo(), tono === 'brecha' ? MB.brecha : MB.descubierto)
  aro.rotation.x = Math.PI / 2
  aro.scale.set(2.6, 2.6, 2.6)
  aro.position.y = 0.06
  aro.castShadow = false
  aro.receiveShadow = false
  g.add(aro)
  g.add(pieza(G.cilindro, tono === 'brecha' ? MB.brecha : MB.descubierto,
    { y: 1.5, sx: 0.42, sy: 3, sz: 0.42, sombra: false, recibe: false }))
  const w = esc.aMundo(x, z)
  g.position.set(w.x, 0, w.z)
  esc.raiz.add(g)
  const etiqueta = nodo('div', `bat-marca${tono === 'brecha' ? '' : ' floja'}`, texto)
  B.medio.appendChild(etiqueta)
  B.marcas.push({ g, etiqueta, x: w.x, y: 3.2, z: w.z, aro, escalon: B.marcas.length % 3 })
}

function limpiarMarcas () {
  if (!B) return
  for (const m of B.marcas) {
    m.g.parent?.remove(m.g)
    m.etiqueta.remove()
  }
  B.marcas.length = 0
}

/** Enciende (o apaga) el repaso de puntos flojos. */
function verFlojos (encender) {
  if (!B) return
  B.flojos = encender
  limpiarMarcas()
  B.btnFlojos?.classList.toggle('on', encender)
  if (!encender) return
  const A = B.analisis
  for (const br of A.brechas.slice(0, 3)) {
    marcar(B.esc, br.x, br.z, `⚠ brecha ${br.lado} · ${Math.round(br.t)} s`, 'brecha')
  }
  for (const e of A.desnudos.slice(0, 4)) {
    marcar(B.esc, e.cx, e.cz, `🎯 ${e.nombre} sin torre`, 'floja')
  }
  if (!A.brechas.length && !A.desnudos.length) {
    marcar(B.esc, B.esc.cx, B.esc.cz, '✅ ni una brecha ni un hueco', 'floja')
  }
}

// ════════════════════════════════════════════════════════════════════════
//  LAS TROPAS EN EL CAMPO
// ════════════════════════════════════════════════════════════════════════

/** Convierte { lancero: 40, arquero: 12 } en una lista de tipos con tope. */
function repartir (tropas, tope) {
  const tipos = Object.keys(tropas || {}).filter(t => (tropas[t] | 0) > 0 && UNIDADES[t] && (UNIDADES[t].espacio || 0) > 0)
  const total = tipos.reduce((a, t) => a + (tropas[t] | 0), 0)
  if (!total) return []
  const lista = []
  for (const t of tipos) {
    const n = Math.max(1, Math.round((tropas[t] | 0) / total * Math.min(tope, total)))
    for (let i = 0; i < n && lista.length < tope; i++) lista.push(t)
  }
  // el asedio detrás: así se ve quién abre la brecha y quién entra después
  lista.sort((a, b) => (UNIDADES[a].clase === 'asedio' ? 1 : 0) - (UNIDADES[b].clase === 'asedio' ? 1 : 0))
  return lista
}

/**
 * El disco de color bajo los pies. Desde la cámara del juego no se distingue una
 * cota de malla de otra: lo que se lee de un vistazo es el color del suelo. Azul
 * los tuyos, rojo los suyos, y ya se sabe quién está ganando el patio.
 */
function ponerPeana (h, nuestro) {
  const d = pieza(G.cilindro, nuestro ? MB.peanaNuestra : MB.peanaSuya,
    { y: 0.035, sx: 0.66, sy: 0.06, sz: 0.66, sombra: false, recibe: false })
  h.raiz.add(d)
  return d
}

/** Cae uno: se apaga su peana (girada con el cuerpo parecía una bandera tirada). */
function abatir (a) {
  if (!a.viva) return
  a.viva = false
  if (a.peana) a.peana.visible = false
  a.h.caer()
}

/** Dónde aparece la hueste: fuera del recinto, del lado que eligió el jugador. */
function puntoEntrada (esc, lado, carril, fila) {
  const m = esc.anchoBase / 2 + 3.5 + fila * 1.1
  switch (lado) {
    case 'norte': return { x: esc.cx + carril, z: esc.cz - m }
    case 'este': return { x: esc.cx + m, z: esc.cz + carril }
    case 'oeste': return { x: esc.cx - m, z: esc.cz + carril }
    default: return { x: esc.cx + carril, z: esc.cz + m }
  }
}

function desplegarAtacantes (esc, tropas, lado, bando) {
  const tope = TOPE_ACTORES[ctx.calidad] || TOPE_ACTORES.medio
  const lista = repartir(tropas, tope)
  const frente = Math.max(4, Math.ceil(Math.sqrt(lista.length) * 1.7))
  const fuera = []
  for (let i = 0; i < lista.length; i++) {
    const tipo = lista[i]
    const u = UNIDADES[tipo]
    const carril = (i % frente) - (frente - 1) / 2
    const fila = Math.floor(i / frente)
    const p = puntoEntrada(esc, lado, carril * 1.05, fila)
    const h = crearActor(tipo, { bando, semilla: i * 37 + 13, padre: esc.raiz })
    const peana = ponerPeana(h, bando === 'jugador')
    const w = esc.aMundo(p.x, p.z)
    const hacia = esc.aMundo(esc.cx, esc.cz)
    h.plantar(w.x, 0, w.z, Math.atan2(hacia.x - w.x, hacia.z - w.z))
    h.estado('andando')
    fuera.push({
      h, peana, tipo, clase: u.clase, vel: u.velocidad || 1.2, alcance: u.alcance || 0,
      gx: p.x, gz: p.z, objetivo: null, revisar: 0, viva: true, pegando: false,
      desvio: (i % 5 - 2) * 0.18, desvioZ: (i % 3 - 1) * 0.18
    })
  }
  return fuera
}

function desplegarDefensores (esc, tropas, cuantos, bando) {
  const tope = Math.min(TOPE_DEFENSORES[ctx.calidad] || TOPE_DEFENSORES.medio, cuantos)
  if (tope <= 0) return []
  const lista = repartir(tropas, tope)
  while (!lista.length || lista.length < Math.min(3, tope)) lista.push('lancero')
  const puestos = esc.eds.filter(e => !e.esMuro)
  const fuera = []
  for (let i = 0; i < lista.length; i++) {
    const tipo = lista[i]
    const u = UNIDADES[tipo] || UNIDADES.lancero
    const casa = puestos.length ? puestos[i % puestos.length] : { cx: esc.cx, cz: esc.cz, ancho: 1, alto: 1 }
    const ang = (i / lista.length) * Math.PI * 2
    const gx = casa.cx + Math.cos(ang) * (casa.ancho / 2 + 1)
    const gz = casa.cz + Math.sin(ang) * (casa.alto / 2 + 1)
    const h = crearActor(tipo, { bando, semilla: i * 91 + 5, padre: esc.raiz })
    const peana = ponerPeana(h, bando === 'jugador')
    const w = esc.aMundo(gx, gz)
    h.plantar(w.x, 0, w.z, ang)
    fuera.push({
      h, peana, tipo, clase: u.clase, vel: u.velocidad || 1.2, alcance: u.alcance || 0,
      gx, gz, viva: true, defensor: true
    })
  }
  return fuera
}

const distAEdificio = (x, z, e) => {
  const dx = Math.max(e.x - x, 0, x - (e.x + e.ancho - 1))
  const dz = Math.max(e.z - z, 0, z - (e.z + e.alto - 1))
  return Math.sqrt(dx * dx + dz * dz)
}

/**
 * A quién va cada clase: la misma intención que sim/combat.js, más un tirón de
 * COHESIÓN. Sin él cada soldado se iba a su edificio más cercano y la batalla se
 * veía como quince peleas sueltas en una aldea vacía; con él la hueste empuja
 * por un sitio, que es lo que se entiende y lo que enseña dónde falla el muro.
 */
function elegirObjetivo (a, esc, foco, grupo) {
  let mejor = null; let mejorCoste = Infinity
  for (const e of esc.eds) {
    if (!e.vivo) continue
    const d = distAEdificio(a.gx, a.gz, e) + (grupo ? Math.hypot(e.cx - grupo.x, e.cz - grupo.z) * 0.55 : 0)
    let peso = 1
    if (a.clase === 'asedio') peso = e.esMuro ? 0.55 : TORRES.has(e.tipo) ? 0.8 : 1.6
    else if (a.clase === 'caballeria') peso = e.esMuro ? 2.4 : 0.8
    else if (a.clase === 'distancia') peso = TORRES.has(e.tipo) ? 0.75 : e.esMuro ? 2.2 : 1
    else peso = e.esMuro ? 1.4 : 1
    if (foco && e.id === foco.id) peso *= 0.45          // donde la crónica dice que se está pegando
    const coste = (d + 1) * peso
    if (coste < mejorCoste) { mejorCoste = coste; mejor = e }
  }
  return mejor
}

/** Un paso de la coreografía: cada actor decide y se le manda caminar. */
function pensarTropa (dtBat, real) {
  const esc = B.esc
  const n = esc.gn
  // dónde está el grueso de la hueste: manda la cohesión y manda la cámara
  let sx = 0; let sz = 0; let vivos = 0
  for (const a of B.atacantes) if (a.viva) { sx += a.gx; sz += a.gz; vivos++ }
  B.grupo = vivos ? { x: sx / vivos, z: sz / vivos } : null
  for (const a of B.atacantes) {
    if (!a.viva) continue
    a.revisar -= dtBat
    if (!a.objetivo || !a.objetivo.vivo || a.revisar <= 0) {
      a.objetivo = elegirObjetivo(a, esc, B.foco, B.grupo)
      a.revisar = 1.8 + (a.desvio + 0.5)
    }
    const obj = a.objetivo
    if (!obj) { a.h.estado('parado'); continue }

    // ¿hay defensor a tiro? primero se pelea; la piedra espera
    let presa = null; let mejorD = 3.4
    for (const d of B.defensores) {
      if (!d.viva) continue
      const dd = Math.hypot(d.gx - a.gx, d.gz - a.gz)
      if (dd < mejorD) { mejorD = dd; presa = d }
    }
    if (presa) {
      a.pegando = true
      a.h.estado('luchando')
      a.h.mirar(Math.atan2(presa.gx - a.gx, presa.gz - a.gz))
      if (mejorD > 1.2) {
        a.gx += (presa.gx - a.gx) / mejorD * Math.min(0.6, mejorD - 1)
        a.gz += (presa.gz - a.gz) / mejorD * Math.min(0.6, mejorD - 1)
        const w = esc.aMundo(a.gx, a.gz)
        a.h.ir(w.x, 0, w.z, real)
      }
      continue
    }

    const d = distAEdificio(a.gx, a.gz, obj)
    if (d <= a.alcance + 0.9) {
      a.pegando = true
      a.h.estado('luchando')
      a.h.mirar(Math.atan2(obj.cx - a.gx, obj.cz - a.gz))
      continue
    }
    a.pegando = false
    a.h.estado('andando')

    // rumbo por el campo de flujo: si la puerta está cerrada, se ve el rodeo
    const campo = campoHacia(esc, obj)
    const lx = Math.round(a.gx) - esc.gx0
    const lz = Math.round(a.gz) - esc.gz0
    let destX = obj.cx; let destZ = obj.cz
    if (lx >= 0 && lz >= 0 && lx < n && lz < n) {
      const i = lz * n + lx
      let mejorV = campo[i] < 0 ? Infinity : campo[i]
      let mejorI = -1
      if (lx > 0 && campo[i - 1] >= 0 && campo[i - 1] < mejorV) { mejorV = campo[i - 1]; mejorI = i - 1 }
      if (lx < n - 1 && campo[i + 1] >= 0 && campo[i + 1] < mejorV) { mejorV = campo[i + 1]; mejorI = i + 1 }
      if (lz > 0 && campo[i - n] >= 0 && campo[i - n] < mejorV) { mejorV = campo[i - n]; mejorI = i - n }
      if (lz < n - 1 && campo[i + n] >= 0 && campo[i + n] < mejorV) { mejorV = campo[i + n]; mejorI = i + n }
      if (mejorI >= 0) { destX = (mejorI % n) + esc.gx0; destZ = ((mejorI / n) | 0) + esc.gz0 }
    }
    const vx = destX + a.desvio * 0.5 - a.gx
    const vz = destZ + a.desvioZ * 0.5 - a.gz
    const largo = Math.hypot(vx, vz) || 1
    const avance = Math.min(largo, a.vel * dtBat)
    a.gx += (vx / largo) * avance
    a.gz += (vz / largo) * avance
    const w = esc.aMundo(a.gx, a.gz)
    a.h.ir(w.x, 0, w.z, real)
  }

  // los defensores salen a recibir a quien se acerca
  for (const d of B.defensores) {
    if (!d.viva) continue
    let presa = null; let mejorD = 9
    for (const a of B.atacantes) {
      if (!a.viva) continue
      const dd = Math.hypot(a.gx - d.gx, a.gz - d.gz)
      if (dd < mejorD) { mejorD = dd; presa = a }
    }
    if (!presa) { d.h.estado('parado'); continue }
    d.h.mirar(Math.atan2(presa.gx - d.gx, presa.gz - d.gz))
    if (mejorD <= 1.3) { d.h.estado('luchando'); continue }
    d.h.estado('andando')
    const avance = Math.min(mejorD - 1, d.vel * dtBat)
    d.gx += (presa.gx - d.gx) / mejorD * avance
    d.gz += (presa.gz - d.gz) / mejorD * avance
    const w = B.esc.aMundo(d.gx, d.gz)
    d.h.ir(w.x, 0, w.z, real)
  }
}

/** Las torres disparan a lo que tienen a tiro: es de donde viene el daño. */
function dispararTorres (dtBat) {
  const esc = B.esc
  for (const t of esc.torres) {
    if (!t.vivo) continue
    t.cd -= dtBat
    if (t.cd > 0) continue
    let presa = null; let mejorD = t.radio
    for (const a of B.atacantes) {
      if (!a.viva) continue
      const d = distAEdificio(a.gx, a.gz, t)
      if (d <= mejorD) { mejorD = d; presa = a }
    }
    if (!presa) { t.cd = 0.4; continue }
    t.cd = 1 / t.cadencia
    const w = esc.aMundo(presa.gx, presa.gz)
    disparar(t.wx, t.altura * 0.82, t.wz, w.x, 0.55, w.z)
    // la torre que la crónica señala se cobra la pieza de verdad
    if (t.cobrar > 0) { t.cobrar--; matarAtacantes(1, presa) }
  }
}

/** Tumba `n` atacantes; si se pasa uno concreto, ese primero. */
function matarAtacantes (n, preferido) {
  if (n <= 0) return
  const vivos = B.atacantes.filter(a => a.viva)
  if (!vivos.length) return
  // caen los que están más metidos: es donde duele la defensa
  vivos.sort((a, b) => Math.hypot(a.gx - B.esc.cx, a.gz - B.esc.cz) - Math.hypot(b.gx - B.esc.cx, b.gz - B.esc.cz))
  const cola = []
  if (preferido && preferido.viva) cola.push(preferido)
  for (const a of vivos) { if (cola.length >= n) break; if (!cola.includes(a)) cola.push(a) }
  for (const a of cola) abatir(a)
}

function matarDefensores (n) {
  const vivos = B.defensores.filter(d => d.viva)
  for (let i = 0; i < n && i < vivos.length; i++) abatir(vivos[i])
}

// ════════════════════════════════════════════════════════════════════════
//  LA CRÓNICA, SUCESO A SUCESO
// ════════════════════════════════════════════════════════════════════════

const ICONO_LINEA = {
  inicio: '⚔️', guarnicion: '🛡️', muro: '🧱', edificio_caido: '💥', siega: '🏹',
  bajas: '🩸', defensa_caida: '🛡️', hito: '📈', retirada: '🏳️', tiempo: '⏳',
  victoria: '🏆', derrota: '💀', heridos: '⛑️', monjes: '⛪'
}

function escribirLinea (s) {
  const icono = ICONO_LINEA[s.tipo] || '·'
  B.linea.textContent = ''
  const b = document.createElement('b')
  b.textContent = s.texto
  B.linea.append(`${icono} `, b)
  B.cronica.push(`${icono} ${s.texto}`)
  if (B.cronica.length > 90) B.cronica.shift()
}

function alSuceso (s, instantaneo) {
  if (!B || !s) return
  B.consumidos++
  const esc = B.esc

  if (s.tipo === 'edificio_caido' && s.edificioId) {
    const e = esc.porId.get(s.edificioId)
    if (e) {
      derrumbar(esc, e, instantaneo)
      if (e.cuenta) B.valorCaido += e.valor
      if (e.tipo === 'ayuntamiento' || e.tipo === 'castillo' || s.principal) B.principalCaido = true
      B.foco = null
      if (e.esMuro && B.flojos) verFlojos(true)   // la brecha se marca en caliente
    }
  } else if (s.tipo === 'muro') {
    const e = s.edificioId ? esc.porId.get(s.edificioId) : null
    if (e) {
      B.foco = e
      e.hp = Math.min(e.hp, e.hpMax * 0.7)
      refrescarBarra(esc, e)
      humear(e.wx, 0.5, e.wz, 0.4, 2)
    }
  } else if (s.tipo === 'siega') {
    const t = s.torreId ? esc.porId.get(s.torreId) : null
    if (t && t.vivo) { t.cobrar++; t.cd = Math.min(t.cd, 0.05) } else matarAtacantes(1)
  } else if (s.tipo === 'bajas') {
    const reales = s.bajas ? Object.values(s.bajas).reduce((a, b) => a + b, 0) : 1
    B.bajasReales += reales
    B.deudaBajas += reales * B.escala
    const cuantos = Math.floor(B.deudaBajas)
    if (cuantos > 0) { B.deudaBajas -= cuantos; matarAtacantes(cuantos) }
  } else if (s.tipo === 'defensa_caida') {
    const yaCaidos = B.defensores.filter(d => !d.viva).length
    matarDefensores(Math.max(0, Math.round((s.caidos || 0) * B.escalaDef) - yaCaidos))
  } else if (s.tipo === 'victoria') {
    for (const a of B.atacantes) if (a.viva) a.h.estado('celebrando')
  } else if (s.tipo === 'derrota') {
    for (const d of B.defensores) if (d.viva) d.h.estado('celebrando')
  }

  if (s.texto) escribirLinea(s)
  refrescarMarcador()
}

function refrescarMarcador () {
  if (!B) return
  const pct = B.valorTotal ? Math.min(100, (B.valorCaido / B.valorTotal) * 100) : 0
  let estrellas = 0
  if (pct >= 50) estrellas++
  if (B.principalCaido) estrellas++
  if (pct >= 99.5) estrellas++
  estrellas = Math.min(3, estrellas)
  B.estrellasNodo.textContent = '★★★☆☆☆'.slice(3 - estrellas, 6 - estrellas)
  B.pctNodo.textContent = `${Math.round(pct)} %`
  B.relleno.style.width = `${pct.toFixed(1)}%`
  const restan = Math.max(0, (B.resultado.duracion || 0) - B.t)
  const vivas = Math.max(0, B.tropasEnviadas - B.bajasReales)
  B.datoNodo.textContent = `⏱ ${Math.floor(restan / 60)}:${String(Math.floor(restan % 60)).padStart(2, '0')}  🧍 ${vivas}/${B.tropasEnviadas}`
}

// ════════════════════════════════════════════════════════════════════════
//  EL REPRODUCTOR: pausa, velocidad y salto
// ════════════════════════════════════════════════════════════════════════

function arrancarReproductor () {
  if (!B) return
  // se le pasa solo lo que queda, con los tiempos puestos a cero: así `reproducir`
  // sigue siendo quien reparte los sucesos aunque la batalla se pause o se acelere
  const resto = B.sucesos.slice(B.consumidos).map(s => ({ ...s, t: Math.max(0, s.t - B.t) }))
  B.mando = reproducir({ sucesos: resto }, (s) => alSuceso(s, B.saltando), {
    velocidad: B.velocidad, emitirBus: false, alFinal: programarParte
  })
}

function pararReproductor () {
  if (B?.mando) { try { B.mando.parar() } catch { /* da igual */ } B.mando = null }
}

function pausar (si) {
  if (!B || B.terminada) return
  B.pausa = si
  if (si) pararReproductor(); else arrancarReproductor()
  B.btnPausa.firstChild.textContent = si ? '▶' : '⏸'
  B.btnPausa.lastChild.textContent = si ? 'Seguir' : 'Pausa'
  B.btnPausa.classList.toggle('on', si)
}

function cambiarVelocidad () {
  if (!B || B.terminada) return
  B.velocidad = B.velocidad >= 3 ? 1 : B.velocidad + 1
  B.btnVel.lastChild.textContent = `x${B.velocidad}`
  B.btnVel.classList.toggle('on', B.velocidad > 1)
  if (!B.pausa) { pararReproductor(); arrancarReproductor() }
}

function saltarAlFinal () {
  if (!B || B.terminada) return
  B.saltando = true
  if (!B.mando) arrancarReproductor()
  try { B.mando.saltar() } catch { /* da igual */ }
  B.saltando = false
  // lo que la crónica no contó, se cuadra con los restos que devuelve el motor
  for (const r of B.resultado.restos || []) {
    const e = B.esc.porId.get(r.id)
    if (!e || !e.vivo) continue
    if (!r.vivo) derrumbar(B.esc, e, true)
    else { e.hp = r.hp; refrescarBarra(B.esc, e) }
  }
  cerrarBatalla()
}

function programarParte () {
  if (!B || B.terminada || B.saltando) return
  B.esperaFinal = SEG_FINAL
}

// ════════════════════════════════════════════════════════════════════════
//  BUCLE DE LA BATALLA
// ════════════════════════════════════════════════════════════════════════

const _v = new THREE.Vector3()

/**
 * La vida de los edificios baja sola hacia lo que dice la crónica: el que va a
 * caer en el segundo 40 llega al segundo 40 con la barra en rojo, no entero.
 */
function desgastar (dtBat) {
  const esc = B.esc
  // quién está recibiendo: una pasada por los soldados, no una por cada edificio
  const recibe = B.recibe
  recibe.clear()
  for (const a of B.atacantes) {
    if (!a.viva || !a.pegando || !a.objetivo) continue
    recibe.set(a.objetivo, (recibe.get(a.objetivo) || 0) + 1)
  }
  for (const e of recibe.keys()) if (e.tGolpe == null) e.tGolpe = B.t
  // solo se repasa lo que está tocado o lo que la crónica va a tumbar
  for (const e of B.enJuego) {
    if (!e.vivo) continue
    const pegan = recibe.get(e) || 0
    const cae = B.caidos.get(e.id)
    if (cae == null && !pegan) continue
    if (cae != null && e.tGolpe != null) {
      const margen = Math.max(0.6, cae - e.tGolpe)
      const frac = Math.max(0.02, Math.min(1, (cae - B.t) / margen))
      if (frac * e.hpMax < e.hp) { e.hp = frac * e.hpMax; refrescarBarra(esc, e) }
      if (pegan && Math.random() < dtBat * 1.4) humear(e.wx, 0.5, e.wz, 0.35, 1)
    } else if (pegan) {
      const fin = B.hpFinal.get(e.id)
      const suelo = fin != null ? Math.max(fin, e.hpMax * 0.06) : e.hpMax * 0.35
      if (e.hp > suelo) { e.hp = Math.max(suelo, e.hp - pegan * e.hpMax * 0.035 * dtBat); refrescarBarra(esc, e) }
    }
  }
}

function frameBatalla (dt) {
  if (!B) return
  const avanza = !B.pausa && !B.terminada
  if (avanza) {
    const dtBat = dt * B.velocidad
    B.t += dtBat
    B.relojIA -= dtBat
    if (B.relojIA <= 0) {
      B.relojIA = PASO_IA
      pensarTropa(PASO_IA, PASO_IA / B.velocidad)
    }
    dispararTorres(dtBat)
    desgastar(dtBat)
    B.relojHud -= dt
    if (B.relojHud <= 0) { B.relojHud = 0.12; refrescarMarcador() }
    B.relojCamara -= dtBat
    if (B.relojCamara <= 0) { B.relojCamara = 2.2; seguirLaAccion() }
    if (B.esperaFinal > 0) {
      B.esperaFinal -= dt
      if (B.esperaFinal <= 0) { cerrarBatalla(); return }
    }
  }

  // --- proyectiles ---
  for (const d of B.disparos) {
    if (!d.vivo) continue
    d.k += dt / d.dur
    if (d.k >= 1) {
      d.vivo = false
      d.malla.visible = false
      humear(d.x1, 0.4, d.z1, 0.22, 1)        // polvo donde cae: se ve a quién le ha dado
      continue
    }
    d.malla.position.set(
      d.x0 + (d.x1 - d.x0) * d.k,
      d.y0 + (d.y1 - d.y0) * d.k + Math.sin(d.k * Math.PI) * 1.1,
      d.z0 + (d.z1 - d.z0) * d.k
    )
  }

  // --- humo ---
  for (const h of B.humo) {
    if (!h.vivo) continue
    h.k += dt / h.dur
    if (h.k >= 1) { h.vivo = false; h.malla.visible = false; continue }
    const s = h.r * (0.35 + h.k * 1.5) * (1 - h.k * 0.55)
    h.malla.position.set(h.x, h.y + h.k * h.sube * 1.6, h.z)
    h.malla.scale.set(s, s, s)
  }

  // --- derrumbes ---
  for (let i = B.derrumbes.length - 1; i >= 0; i--) {
    const w = B.derrumbes[i]
    w.k += dt / w.dur
    const k = Math.min(1, w.k)
    if (w.g) {
      w.g.scale.set(1 - k * 0.3, Math.max(0.02, 1 - k * 0.94), 1 - k * 0.3)
      w.g.rotation.z = k * 0.3
      w.g.position.y = -k * 0.25
    }
    if (k >= 1) { if (w.g) w.g.visible = false; B.derrumbes.splice(i, 1) }
  }

  // --- barras y etiquetas siempre de cara a quien mira ---
  const cam = ctx.camera
  if (!cam) return
  for (const e of B.conBarra) if (e.barra && e.barra.visible) e.barra.lookAt(cam.position)
  if (!B.marcas.length) return
  const r = ctx.renderer.domElement.getBoundingClientRect()
  // Con el parte abierto solo queda una franja de campo a la vista: la etiqueta
  // que caiga fuera se apaga. Encima del pergamino no la lee nadie.
  const techo = 150
  const suelo = B.parteNodo ? B.parteNodo.getBoundingClientRect().top - 26 : r.height - 88
  for (const m of B.marcas) {
    m.aro.scale.setScalar(2.4 + Math.sin(ctx.tiempo * 3) * 0.28)
    _v.set(m.x, m.y, m.z).project(cam)
    const y = (-_v.y * 0.5 + 0.5) * r.height + m.escalon * 22
    const visible = _v.z > -1 && _v.z < 1 && y > techo - 60 && y < suelo
    m.etiqueta.style.display = visible ? '' : 'none'
    if (!visible) continue
    const ancho = m.etiqueta.offsetWidth || 90
    const x = Math.max(ancho / 2 + 6, Math.min(r.width - ancho / 2 - 6, (_v.x * 0.5 + 0.5) * r.width))
    m.etiqueta.style.left = `${x}px`
    m.etiqueta.style.top = `${Math.max(techo, y)}px`
  }
}

// ════════════════════════════════════════════════════════════════════════
//  MONTAJE Y DESMONTAJE
// ════════════════════════════════════════════════════════════════════════

function construirInterfaz (titulo) {
  ponerEstilo()
  capa = nodo('div', 'bat-capa')

  const marcador = nodo('div', 'bat-marcador')
  const fila1 = nodo('div', 'bat-fila')
  const estrellas = nodo('span', 'bat-estrellas', '☆☆☆')
  const pct = nodo('span', 'bat-pct', '0 %')
  const dato = nodo('span', 'bat-dato', '')
  fila1.append(estrellas, pct, dato)
  const barra = nodo('div', 'bat-barra')
  const relleno = nodo('i')
  barra.appendChild(relleno)
  const linea = nodo('div', 'bat-linea', titulo)
  const leyenda = nodo('div', 'bat-leyenda')
  leyenda.append(nodo('span', 'bat-bando nuestro', 'los tuyos'), nodo('span', 'bat-bando suyo', 'los suyos'))
  marcador.append(fila1, barra, leyenda, linea)

  const medio = nodo('div', 'bat-medio')
  const mandos = nodo('div', 'bat-mandos')
  capa.append(marcador, medio, mandos)
  document.body.appendChild(capa)
  return { estrellas, pct, dato, relleno, linea, medio, mandos }
}

/**
 * Esconde (o devuelve) la aldea y su interfaz. Durante la batalla se está en otro
 * sitio: dejar los contadores de madera y los botones de construir encima del
 * campo era justo lo que hacía que no se entendiera nada.
 */
let nieblaAldea = null
function esconderAldea (esconder) {
  if (ctx.raizAldea) ctx.raizAldea.visible = !esconder
  if (ctx.raizMundo && esconder) ctx.raizMundo.visible = false
  const hud = document.getElementById('hud')
  if (hud) hud.style.display = esconder ? 'none' : ''
  // la niebla de la aldea está calibrada para el zoom de jugar; en la batalla se
  // mira de más lejos y lo dejaba todo lavado de azul, sin colores que leer
  const fog = ctx.scene?.fog
  if (!fog) return
  if (esconder) { if (nieblaAldea == null) nieblaAldea = fog.density; fog.density = 0.0035 } else if (nieblaAldea != null) { fog.density = nieblaAldea; nieblaAldea = null }
}

/**
 * Arranca una batalla en 3D.
 * @param {{resultado:object, base:object, tropas:object, lado?:string,
 *          titulo?:string, esDefensa?:boolean, guarnicion?:object,
 *          alSalir?:Function, repetir?:Function}} o
 */
export function jugarBatalla (o = {}) {
  if (!ctx.listo) { cuandoListo(() => jugarBatalla(o)); return }
  if (B) salir(true)
  const resultado = o.resultado
  if (!resultado || !Array.isArray(resultado.sucesos)) return

  const esc = montarEscenario(o.base || {})
  // rejilla local con margen: la tropa tiene que poder rodear por fuera
  const margen = 7
  esc.gx0 = Math.floor(esc.cx - esc.anchoBase / 2 - margen)
  esc.gz0 = Math.floor(esc.cz - esc.anchoBase / 2 - margen)
  esc.gn = Math.ceil(esc.anchoBase + margen * 2) + 2
  esc.cola = new Int32Array(esc.gn * esc.gn)
  esc.campos = new Map()
  esc.version = 0
  esc.bloqueo = mapaBloqueo(esc)

  const ui = construirInterfaz(o.titulo || 'La hueste se pone en marcha…')

  const tropas = o.tropas || {}
  const enviadas = Object.values(tropas).reduce((a, b) => a + (b || 0), 0) || 1
  const tope = TOPE_ACTORES[ctx.calidad] || TOPE_ACTORES.medio

  B = {
    esc,
    resultado,
    sucesos: resultado.sucesos.slice().sort((a, b) => a.t - b.t),
    consumidos: 0,
    t: 0, relojIA: 0, esperaFinal: 0, relojCamara: 4, relojHud: 0, siguiendo: true, grupo: null,
    // una crónica de dos minutos no se mira a velocidad real en el móvil
    velocidad: (resultado.duracion || 0) > 75 ? 2 : 1,
    pausa: false, terminada: false, saltando: false, flojos: false,
    mando: null,
    valorTotal: esc.eds.reduce((a, e) => a + (e.cuenta ? e.valor : 0), 0) || 1,
    valorCaido: 0, principalCaido: false,
    tropasEnviadas: enviadas, bajasReales: 0, deudaBajas: 0,
    escala: Math.min(1, tope / enviadas),
    escalaDef: 1,
    foco: null,
    atacantes: [], defensores: [],
    disparos: piscinaDisparos(esc.raiz, 22),
    humo: piscinaHumo(esc.raiz, 26),
    derrumbes: [], marcas: [], cronica: [], conBarra: [], recibe: new Map(),
    caidos: new Map(), hpFinal: new Map(),
    esDefensa: !!o.esDefensa,
    lado: o.lado || resultado.ladoEntrada || 'sur',
    tropas,
    alSalir: o.alSalir || null,
    repetir: o.repetir || null,
    estrellasNodo: ui.estrellas, pctNodo: ui.pct, datoNodo: ui.dato,
    relleno: ui.relleno, linea: ui.linea, medio: ui.medio, mandos: ui.mandos
  }

  // lo que la crónica ya sabe: cuándo cae cada cosa y con cuánta vida acaba
  for (const s of B.sucesos) {
    if (s.tipo === 'edificio_caido' && s.edificioId && !B.caidos.has(s.edificioId)) B.caidos.set(s.edificioId, s.t)
  }
  for (const r of resultado.restos || []) if (r.vivo) B.hpFinal.set(r.id, r.hp)

  // solo se desgasta lo que puede recibir: lo que la crónica tumba y lo que acaba
  // tocado. El resto del catálogo no se mira ni un frame.
  const enJuego = new Set()
  for (const id of B.caidos.keys()) { const e = esc.porId.get(id); if (e) enJuego.add(e) }
  for (const r of resultado.restos || []) {
    const e = esc.porId.get(r.id)
    if (e && r.vivo && r.hp < e.hpMax) enJuego.add(e)
  }
  for (const e of esc.eds) if (e.esMuro || e.dano > 0) enJuego.add(e)
  B.enJuego = [...enJuego]

  B.analisis = analizarFlojos(esc, resultado)

  // --- las tropas al campo ---
  B.atacantes = desplegarAtacantes(esc, tropas, B.lado, o.esDefensa ? 'enemigo' : 'jugador')
  const defensores = resultado.defensores || 0
  if (defensores > 0) {
    B.defensores = desplegarDefensores(esc, o.guarnicion || o.base?.guarnicion || {}, defensores,
      o.esDefensa ? 'jugador' : 'enemigo')
    B.escalaDef = B.defensores.length / defensores
  }

  // --- mandos ---
  B.btnPausa = boton('⏸', 'Pausa', () => pausar(!B.pausa))
  B.btnVel = boton('⏩', `x${B.velocidad}`, cambiarVelocidad)
  B.btnVel.classList.toggle('on', B.velocidad > 1)
  B.btnFlojos = boton('🎯', 'Flojos', () => verFlojos(!B.flojos))
  ui.mandos.append(B.btnPausa, B.btnVel, B.btnFlojos, boton('⏭', 'Al resultado', saltarAlFinal))

  // --- cámara: la base entera Y el lado por el que entra la hueste ---
  // Si solo se encuadra el recinto, la tropa aparece fuera de pantalla y la
  // batalla empieza "sola": hay que ver llegar a los soldados.
  esconderAldea(true)
  const medioTablero = (CONFIG.GRID - 1) / 2
  const hacia = { norte: [0, -1], sur: [0, 1], este: [1, 0], oeste: [-1, 0] }[B.lado] || [0, 1]
  // En vertical el móvil ve poquísimo de ancho (28° de campo). Encuadrar la base
  // ENTERA deja a los soldados del tamaño de una mosca, así que se encuadra el
  // lado por el que entra la hueste: ahí es donde pasa todo. El dedo hace el resto.
  const sesgo = Math.min(7, esc.anchoBase * 0.22)
  events.emit(EV.CAMERA_FOCUS, {
    x: medioTablero + hacia[0] * sesgo,
    z: medioTablero + hacia[1] * sesgo,
    zoom: Math.max(26, Math.min(56, esc.anchoBase * 2.1 + 8))
  })

  const lienzo = ctx.renderer?.domElement
  B.soltarDedo = () => { if (B) B.siguiendo = false }
  lienzo?.addEventListener('pointerdown', B.soltarDedo)

  bajaFrame = onFrame(frameBatalla)
  refrescarMarcador()
  arrancarReproductor()
}

/**
 * La cámara va detrás de la hueste. Sin esto, la tropa se mete en la aldea y el
 * jugador se queda mirando un prado vacío: la batalla pasa fuera de cuadro.
 * En cuanto el dedo toca la pantalla, se deja de seguir y manda el jugador.
 */
function seguirLaAccion () {
  if (!B || !B.siguiendo || !B.grupo) return
  const esc = B.esc
  // a medio camino entre el grueso de la hueste y el corazón de la aldea
  const x = B.grupo.x * 0.62 + esc.cx * 0.38
  const z = B.grupo.z * 0.62 + esc.cz * 0.38
  const medio = (CONFIG.GRID - 1) / 2
  events.emit(EV.CAMERA_FOCUS, { x: medio + (x - esc.cx), z: medio + (z - esc.cz) })
}

/** Recoge el campo: las mallas compartidas solo se desenganchan, nunca se liberan. */
function desmontarEscenario () {
  if (!B) return
  limpiarMarcas()
  limpiarActores()
  if (B.soltarDedo) ctx.renderer?.domElement?.removeEventListener('pointerdown', B.soltarDedo)
  B.esc.raiz.parent?.remove(B.esc.raiz)
}

export function salir (silencioso) {
  if (!B) return
  pararReproductor()
  if (bajaFrame) { bajaFrame(); bajaFrame = null }
  const alSalir = B.alSalir
  desmontarEscenario()
  B = null
  capa?.remove()
  capa = null
  esconderAldea(false)
  const centro = game.state.buildings?.find(b => b.tipo === 'ayuntamiento') || game.state.buildings?.[0]
  events.emit(EV.CAMERA_FOCUS, {
    x: centro ? centro.x + ((centro.ancho ?? 2) - 1) / 2 : (CONFIG.GRID - 1) / 2,
    z: centro ? centro.z + ((centro.alto ?? 2) - 1) / 2 : (CONFIG.GRID - 1) / 2,
    zoom: CONFIG.ZOOM_INICIAL
  })
  if (!silencioso && alSalir) { try { alSalir() } catch (e) { console.warn('[battle]', e) } }
}

// ════════════════════════════════════════════════════════════════════════
//  EL PARTE FINAL
// ════════════════════════════════════════════════════════════════════════

const ICONO_REC = { madera: '🪵', piedra: '🪨', comida: '🌾', oro: '🪙' }

const chip = (texto, tono) => nodo('span', `bat-chip${tono ? ' ' + tono : ''}`, texto)
const suma = (o) => Object.values(o || {}).reduce((a, b) => a + (b || 0), 0)

/** La frase honesta: por qué ha pasado lo que ha pasado. */
function porQue (esDefensa) {
  const A = B.analisis
  const r = B.resultado
  const frases = []
  const primera = A.brechas[0]

  if (primera) {
    const que = primera.tipo === 'puerta' ? 'La puerta' : 'La muralla'
    const seg = Math.round(primera.t)
    frases.push(primera.cubierta
      ? `${que} ${primera.lado} cayó en ${seg} s aun teniendo ${primera.cubierta.nombre.toLowerCase()} al lado: un tramo solo no aguanta.`
      : `${que} ${primera.lado} cayó en ${seg} s: no tenía torre que la cubriera.`)
  } else if (!A.caidos.size) {
    frases.push('No cayó ni una piedra: la hueste no llegó a abrir nada.')
  }

  if (!A.torres.length) {
    frases.push(esDefensa
      ? 'No tienes una sola torre: entraron andando y sin prisa.'
      : 'Esa aldea no tiene una sola torre: se entra andando.')
  } else {
    const trabajaron = (r.torres || []).filter(t => t.bajas > 0).sort((a, b) => b.bajas - a.bajas)
    if (trabajaron.length) frases.push(`${trabajaron[0].nombre} nivel ${trabajaron[0].nivel} se llevó por delante a ${trabajaron[0].bajas}.`)
    else frases.push('Las torres dispararon sin abatir a nadie: donde están se les queda corto el alcance.')
  }

  if (A.desnudos.length) {
    const nombres = A.desnudos.slice(0, 2).map(e => e.nombre.toLowerCase()).join(' y ')
    frases.push(`${A.desnudos.length} ${A.desnudos.length === 1 ? 'edificio está' : 'edificios están'} fuera del alcance de toda torre (${nombres}): ahí no defiende nadie.`)
  }

  if (!esDefensa) {
    const llevabaAsedio = Object.keys(B.tropas).some(t => UNIDADES[t]?.clase === 'asedio')
    const muchoMuro = B.esc.eds.filter(e => e.esMuro).length > 10
    if (muchoMuro && !llevabaAsedio) frases.push('Sin arietes hubo que romper piedra a mano: mucho tiempo bajo las flechas.')
    if (!r.victoria) frases.push(`Prueba a entrar por el ${primera ? primera.lado : OPUESTO[B.lado]}, o vuelve con más tropa.`)
  }
  return frases.join(' ')
}

function cerrarBatalla () {
  if (!B || B.terminada) return
  B.terminada = true
  pararReproductor()
  const r = B.resultado
  const esDefensa = B.esDefensa

  // el marcador se cuadra con lo que dijo el motor, no con lo que se vio
  B.valorCaido = B.valorTotal * ((r.porcentajeDestruido || 0) / 100)
  B.principalCaido = (r.estrellas || 0) >= 2
  B.t = r.duracion || B.t
  B.bajasReales = suma(r.caidos) || B.bajasReales
  refrescarMarcador()
  verFlojos(true)
  B.siguiendo = false
  const medio = (CONFIG.GRID - 1) / 2
  events.emit(EV.CAMERA_FOCUS, { x: medio, z: medio, zoom: Math.max(30, Math.min(60, B.esc.anchoBase * 2.3 + 8)) })

  B.mandos.remove()
  const parte = nodo('div', 'bat-parte')
  const estrellas = r.estrellas || 0
  parte.appendChild(nodo('div', 'grandes', '★★★☆☆☆'.slice(3 - estrellas, 6 - estrellas)))

  const gano = esDefensa ? estrellas === 0 : r.victoria
  parte.appendChild(nodo('h2', null, esDefensa
    ? (gano ? '¡Tu defensa aguantó!' : 'Entraron en la aldea')
    : (r.victoria ? '¡Victoria!' : 'Derrota')))

  // Tres cosas distintas, y el jugador tiene que verlas separadas: los que se
  // fueron al suelo en el campo (caidos), los que vuelven malheridos y se curan
  // solos en el cuartel (heridosTropas) y los que no vuelven (bajas).
  const bajas = r.bajas || {}
  const heridos = r.heridosTropas || {}
  const caidosTropa = r.caidos || bajas
  const muertos = suma(bajas)
  const malheridos = suma(heridos)
  const cayeron = suma(caidosTropa) || muertos + malheridos
  const chips = nodo('div', 'bat-chips')
  chips.append(
    chip(`💥 ${r.porcentajeDestruido} % arrasado`, esDefensa ? (r.porcentajeDestruido >= 50 ? 'mal' : 'bien') : (r.porcentajeDestruido >= 50 ? 'bien' : 'mal')),
    esDefensa
      ? chip(`💀 ${muertos}/${B.tropasEnviadas} atacantes abatidos`, muertos >= B.tropasEnviadas / 2 ? 'bien' : 'mal')
      : chip(`🧍 ${r.supervivientes}/${B.tropasEnviadas} vuelven`, muertos ? 'mal' : 'bien'),
    chip(`⏱ ${Math.round(r.duracion || 0)} s`)
  )
  if (r.defensores) chips.append(chip(`🛡️ guarnición ${r.defensores - r.defensoresVivos}/${r.defensores} abatida`, r.defensoresVivos ? '' : 'mal'))
  parte.appendChild(chips)

  // --- qué cayó y qué aguantó ---
  const caidos = B.esc.eds.filter(e => !e.vivo && e.cuenta).sort((a, b) => b.valor - a.valor)
  const enPie = B.esc.eds.filter(e => e.vivo && e.cuenta).sort((a, b) => b.valor - a.valor)
  const nombres = (l) => l.slice(0, 4).map(e => e.nombre.toLowerCase()).join(', ') + (l.length > 4 ? '…' : '')
  parte.appendChild(nodo('div', 'sec', 'Qué cayó y qué aguantó'))
  parte.appendChild(nodo('div', 'txt', caidos.length ? `Cayeron ${caidos.length}: ${nombres(caidos)}.` : 'No cayó ni un edificio.'))
  parte.appendChild(nodo('div', 'txt', enPie.length ? `Aguantaron ${enPie.length}: ${nombres(enPie)}.` : 'No quedó nada en pie.'))

  // --- botín / lo robado ---
  const botin = r.botin || {}
  const hayBotin = ['madera', 'piedra', 'comida', 'oro'].some(k => botin[k] > 0)
  parte.appendChild(nodo('div', 'sec', esDefensa ? 'Lo que se llevaron' : 'Botín'))
  if (hayBotin && !(esDefensa && gano)) {
    const c = nodo('div', 'bat-chips')
    for (const k of ['madera', 'piedra', 'comida', 'oro']) if (botin[k] > 0) c.appendChild(chip(`${ICONO_REC[k]} ${botin[k]}`))
    if (botin.gemas) c.appendChild(chip(`💎 ${botin.gemas}`))
    parte.appendChild(c)
  } else {
    parte.appendChild(nodo('div', 'txt', esDefensa ? 'Nada: no llegaron a los almacenes.' : 'Nada aprovechable: no se llegó a los almacenes.'))
  }

  // --- caídos, malheridos y muertos ---
  // Ojo: defendiendo, `bajas` son los del OTRO y `heridosTropas` los tuyos.
  // Mezclarlos contaba una batalla que no pasó.
  if (esDefensa) {
    parte.appendChild(nodo('div', 'sec', 'Lo que le costó al atacante'))
    parte.appendChild(nodo('div', 'txt', muertos
      ? `De los ${B.tropasEnviadas} que vinieron, ${muertos} se quedaron en el campo.`
      : 'No perdieron a nadie: pasearon por la aldea.'))
    if (muertos) {
      const c = nodo('div', 'bat-chips')
      for (const [t, n] of Object.entries(bajas)) if (n) c.appendChild(chip(`${UNIDADES[t]?.icono || '·'} ${n} × ${UNIDADES[t]?.nombre || t}`, 'bien'))
      parte.appendChild(c)
    }
    const mias = r.bajasDefensa || {}
    const caidosMios = suma(mias)
    parte.appendChild(nodo('div', 'sec', 'Lo que te costó a ti'))
    if (!caidosMios) {
      parte.appendChild(nodo('div', 'txt', r.defensores ? 'Tu guarnición volvió entera al cuartel.' : 'No tenías un solo soldado en casa: solo defendieron las piedras.'))
    } else {
      parte.appendChild(nodo('div', 'txt', malheridos
        ? `Cayeron ${caidosMios} de los tuyos: ${malheridos} ${malheridos === 1 ? 'vuelve malherido' : 'vuelven malheridos'} al cuartel.`
        : `Cayeron ${caidosMios} de los tuyos.`))
      const c = nodo('div', 'bat-chips')
      for (const [t, n] of Object.entries(mias)) if (n) c.appendChild(chip(`${UNIDADES[t]?.icono || '·'} ${n} × ${UNIDADES[t]?.nombre || t}`, 'mal'))
      for (const [t, n] of Object.entries(heridos)) if (n) c.appendChild(chip(`⛑️ ${n} × ${UNIDADES[t]?.nombre || t} se recupera`, 'bien'))
      parte.appendChild(c)
    }
  } else if (!cayeron) {
    parte.appendChild(nodo('div', 'sec', 'Tu tropa'))
    parte.appendChild(nodo('div', 'txt', 'No cayó ni un hombre: volvieron todos de pie.'))
  } else {
    parte.appendChild(nodo('div', 'sec', 'Tu tropa'))
    parte.appendChild(nodo('div', 'txt', malheridos
      ? `${cayeron} ${cayeron === 1 ? 'cayó' : 'cayeron'} en el campo: ${malheridos} ${malheridos === 1 ? 'vuelve malherido' : 'vuelven malheridos'} y se ${malheridos === 1 ? 'recupera' : 'recuperan'} en el cuartel; ${muertos} no ${muertos === 1 ? 'vuelve' : 'vuelven'}.`
      : `${cayeron} ${cayeron === 1 ? 'cayó' : 'cayeron'} en el campo y ${muertos} no ${muertos === 1 ? 'vuelve' : 'vuelven'}.`))
    if (malheridos) {
      const c = nodo('div', 'bat-chips')
      for (const [t, n] of Object.entries(heridos)) if (n) c.appendChild(chip(`⛑️ ${n} × ${UNIDADES[t]?.nombre || t}`, 'bien'))
      parte.appendChild(c)
    }
    if (muertos) {
      const c = nodo('div', 'bat-chips')
      for (const [t, n] of Object.entries(bajas)) if (n) c.appendChild(chip(`${UNIDADES[t]?.icono || '·'} ${n} × ${UNIDADES[t]?.nombre || t}: no vuelve${n === 1 ? '' : 'n'}`, 'mal'))
      parte.appendChild(c)
    }
    if (r.curadas && suma(r.curadas)) parte.appendChild(nodo('div', 'txt', `⛪ Los monjes recuperaron a ${suma(r.curadas)} que se daban por perdidos.`))
  }

  // --- los puntos flojos, por escrito ---
  parte.appendChild(nodo('div', 'sec', esDefensa ? 'Qué falla en tu defensa' : 'Puntos flojos de esa aldea'))
  const A = B.analisis
  for (const br of A.brechas.slice(0, 3)) {
    const f = nodo('div', 'bat-flojo')
    f.append(nodo('span', null, '🧱'), nodo('span', null,
      `${br.tipo === 'puerta' ? 'Puerta' : 'Muralla'} ${br.lado}: ${br.n} ${br.n === 1 ? 'tramo cayó' : 'tramos cayeron'} a los ${Math.round(br.t)} s${br.cubierta ? '' : ', sin torre que lo cubriera'}.`))
    parte.appendChild(f)
  }
  for (const e of A.desnudos.slice(0, 3)) {
    const f = nodo('div', 'bat-flojo aviso')
    f.append(nodo('span', null, '🎯'), nodo('span', null, `${e.nombre} está fuera del alcance de toda torre.`))
    parte.appendChild(f)
  }
  if (!A.brechas.length && !A.desnudos.length) {
    parte.appendChild(nodo('div', 'txt', 'Ni una brecha ni un edificio descubierto: la defensa está bien montada.'))
  }

  parte.appendChild(nodo('div', 'sec', 'Por qué ha ido así'))
  parte.appendChild(nodo('div', 'txt', porQue(esDefensa)))

  // --- crónica entera, plegada ---
  const det = document.createElement('details')
  const res = document.createElement('summary')
  res.className = 'sec'
  res.textContent = 'Ver la crónica entera'
  det.appendChild(res)
  const log = nodo('div', 'txt')
  log.style.whiteSpace = 'pre-line'
  log.textContent = B.cronica.join('\n')
  det.appendChild(log)
  parte.appendChild(det)

  // --- botones ---
  const mandos = nodo('div', 'bat-mandos')
  mandos.style.padding = '8px 0 0'
  const repetir = B.repetir
  mandos.append(
    boton('🔁', 'Repetir', () => { salir(true); if (repetir) repetir() }),
    boton('✔', 'Cerrar', () => salir())
  )
  parte.appendChild(mandos)
  B.parteNodo = parte
  capa.appendChild(parte)
}

// ════════════════════════════════════════════════════════════════════════
//  "TE ASALTARON ANOCHE": guardar el asedio y ofrecerlo al volver
// ════════════════════════════════════════════════════════════════════════

function guardarRecuerdo (datos) {
  try { localStorage.setItem(CLAVE_RECUERDO, JSON.stringify(datos)) } catch { /* sin sitio: da igual */ }
  recuerdo = datos
}

function leerRecuerdo () {
  try {
    const txt = localStorage.getItem(CLAVE_RECUERDO)
    return txt ? JSON.parse(txt) : null
  } catch { return null }
}

function olvidarRecuerdo () {
  try { localStorage.removeItem(CLAVE_RECUERDO) } catch { /* da igual */ }
  recuerdo = null
}

/** El cartel de "te asaltaron anoche: ver qué pasó". */
function ofrecerRepeticion (datos) {
  ponerEstilo()
  document.querySelector('.bat-aviso')?.remove()
  const caja = nodo('div', 'bat-aviso')
  const horas = datos.cuando ? Math.round((Date.now() - datos.cuando) / 3600000) : 0
  const t = nodo('span', null, horas >= 1
    ? `⚔️ Te asaltaron hace ${horas} h. Mira qué pasó.`
    : '⚔️ Te acaban de asaltar. Mira qué pasó.')
  t.style.flex = '1'
  const ver = nodo('button', null, 'Verlo')
  ver.addEventListener('click', () => { caja.remove(); verAsedio(datos) })
  const no = nodo('button', 'cerrar', '✕')
  no.addEventListener('click', () => { caja.remove(); olvidarRecuerdo() })
  caja.append(t, ver, no)
  document.body.appendChild(caja)
}

/** Repite el último asedio recibido, con la aldea tal como estaba. */
export function verAsedio (datos) {
  const d = datos || recuerdo || leerRecuerdo()
  if (!d || !d.resultado) return false
  olvidarRecuerdo()
  jugarBatalla({
    resultado: d.resultado,
    base: { buildings: d.buildings || [] },
    tropas: d.tropas || {},
    guarnicion: d.guarnicion || {},
    lado: d.lado || 'sur',
    esDefensa: true,
    titulo: `${d.atacante || 'Una hueste'} cae sobre tu aldea`,
    repetir: () => verAsedio(d)
  })
  return true
}

export const hayAsedioPendiente = () => !!(recuerdo || leerRecuerdo())

// ════════════════════════════════════════════════════════════════════════

export function init () {
  ponerEstilo()
  recuerdo = leerRecuerdo()

  // El parte de la defensa no dice CON QUÉ te atacaron, solo cuánto. La
  // composición viene en el aviso previo, así que se guarda al vuelo: sin ella
  // el campo de batalla se quedaba sin atacantes que pintar.
  events.on(EV.ATTACK_INCOMING, (p = {}) => {
    const tropas = p.tropas || p.tropasEnemigas
    if (!tropas || !Object.keys(tropas).length) return
    avisoHueste = { tropas: { ...tropas }, nombre: (p.enemigo || p.atacante || {}).nombre || 'Una hueste' }
  })

  events.on(EV.DEFENSE_RESOLVED, (p = {}) => {
    const r = p.resultado
    if (!r || !Array.isArray(r.sucesos)) return
    // la foto de la aldea para poder rehacerla: los daños ya están aplicados al
    // estado, así que se guarda la planta (tipo, nivel y sitio), no la vida
    const planta = (game.state.buildings || []).map(b => ({
      id: b.id, tipo: b.tipo, nivel: b.nivel, x: b.x, z: b.z, rot: b.rot, enObra: b.enObra
    }))
    const datos = {
      cuando: Date.now(),
      atacante: p.atacante?.nombre || avisoHueste?.nombre || 'Una hueste',
      resultado: r,
      buildings: planta,
      tropas: p.tropasEnemigas || p.atacante?.tropas || avisoHueste?.tropas || {},
      guarnicion: { ...(game.state.ejercito?.tropas || {}) },
      lado: r.ladoEntrada || 'sur'
    }
    guardarRecuerdo(datos)
    // si está jugando, se le ofrece verlo ya; si no, el cartel le espera al volver
    if (document.visibilityState === 'visible') setTimeout(() => { if (!B) ofrecerRepeticion(datos) }, 900)
  })

  cuandoListo(() => {
    ctx.batalla = API
    window.baluarteBatalla = API
    // ¿quedó un asedio sin ver de la última vez? Ahí es donde se aprende a colocar torres.
    if (recuerdo && Date.now() - (recuerdo.cuando || 0) < 3 * 24 * 3600 * 1000) {
      setTimeout(() => { if (!B) ofrecerRepeticion(recuerdo) }, 3500)
    }
  })
}

const API = {
  jugarBatalla, salir, verAsedio, hayAsedioPendiente,
  get activa () { return !!B },
  /** Sonda para depurar y medir: cuántos hay en el campo y cómo va la cosa. */
  get info () {
    if (!B) return null
    return {
      t: Math.round(B.t * 10) / 10, velocidad: B.velocidad, terminada: B.terminada,
      atacantes: B.atacantes.length, atacantesVivos: B.atacantes.filter(a => a.viva).length,
      defensores: B.defensores.length, defensoresVivos: B.defensores.filter(d => d.viva).length,
      edificios: B.esc.eds.length, enPie: B.esc.eds.filter(e => e.vivo).length,
      pegando: B.atacantes.filter(a => a.viva && a.pegando).length,
      torres: B.esc.torres.length, enVuelo: B.disparos.filter(d => d.vivo).length,
      brechas: B.analisis.brechas.length, desnudos: B.analisis.desnudos.length
    }
  }
}
export default API
