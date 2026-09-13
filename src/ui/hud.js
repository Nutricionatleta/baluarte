/**
 * HUD — lo que el jugador ve SIEMPRE por encima del 3D.
 *
 * Filosofía: poco, grande y claro. En un móvil de 5 pulgadas el HUD ES el juego,
 * así que solo vive aquí lo que se mira cada diez segundos:
 *   arriba  → qué tengo y a qué RITMO entra (recursos con su +X/h, gente, gemas)
 *   derecha → qué está pasando (obras, tropa, ciencia) y cuánto falta
 *   abajo   → qué conviene hacer AHORA (consejo con su botón) y los cuatro paneles
 * El centro de la pantalla se deja libre: ahí está la aldea, que es lo bonito.
 * En un móvil de 390x844 quedan más de 600 px de 3D sin tapar; está medido.
 *
 * Reglas que se respetan a rajatabla:
 *   - No se toca `game.state` (única excepción documentada: `ajustes`, que son
 *     preferencias del jugador y nadie más las escribe).
 *   - No se repinta por frame: se reacciona a eventos y hay un refresco ligero
 *     cuatro veces por segundo, el mismo ritmo que el tick de la simulación.
 */
import { events, EV } from '../core/events.js'
import { CONFIG, ICONO } from '../core/config.js'
import { game } from '../core/state.js'
import { def as defEdificio, AGE_NOMBRE } from '../data/buildings.js'
import { centroDe, dist } from '../core/grid.js'
import * as guardado from '../core/save.js'
import {
  el, vaciar, hoja, toast, confirmar, formatoNumero, formatoTiempo,
  costeHTML, barraProgreso, latir, pestañas
} from './styles.js'

/* ===========================================================================
   Acceso a la simulación
   Se cargan una vez y se guardan: si un módulo no está (o peta), el HUD sigue
   funcionando con lo que tenga. Nunca se cae la interfaz por una pieza que falte.
   =========================================================================== */

const M = { recursos: null, edificios: null, aldeanos: null, ejercito: null, ciencia: null, encargos: null }

const CARGADORES = {
  recursos: () => import('../sim/resources.js'),
  edificios: () => import('../sim/buildings.js'),
  aldeanos: () => import('../sim/villagers.js'),
  ejercito: () => import('../sim/army.js'),
  ciencia: () => import('../sim/research.js'),
  encargos: () => import('../sim/quests.js')
}

async function engancharSim () {
  await Promise.all(Object.entries(CARGADORES).map(async ([clave, cargar]) => {
    try { M[clave] = await cargar() } catch (err) { console.warn(`[hud] sin ${clave}:`, err?.message || err); M[clave] = null }
  }))
}

/** Llama a una función de sim/ solo si existe. Devuelve `porDefecto` si no. */
function pedir (modulo, funcion, porDefecto, ...args) {
  const f = M[modulo]?.[funcion]
  if (typeof f !== 'function') return porDefecto
  try { return f(...args) } catch (err) { console.warn(`[hud] ${modulo}.${funcion}()`, err); return porDefecto }
}

const NOMBRE_RECURSO = { madera: 'Madera', piedra: 'Piedra', comida: 'Comida', oro: 'Oro' }

/* ===========================================================================
   Estilos propios del HUD
   styles.js manda en el lenguaje visual (botones, paneles, hojas). Aquí solo se
   añade la COLOCACIÓN de las piezas fijas del HUD, que nadie más necesita.
   =========================================================================== */

const CSS = `
#hud { --alto-top: 112px; }

/* ---------- barra de arriba ---------- */
.hud-top {
  position: fixed; top: 0; left: 0; right: 0; z-index: 20;
  display: flex; flex-direction: column; gap: 5px;
  padding: calc(var(--seg-arriba) + 5px) calc(var(--seg-der) + 8px) 0 calc(var(--seg-izq) + 8px);
  pointer-events: none;
}
.hud-top > * { pointer-events: auto; }

/* Rejilla de recursos: cuatro columnas EXACTAMENTE iguales. Las cifras van a la
   derecha y con cifras de ancho fijo, así nada baila cuando cambian los números. */
.hud-res { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
.res {
  display: grid; gap: 3px; min-width: 0;
  padding: 4px 7px 5px;
  font-family: inherit; color: var(--tinta); text-align: left;
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 2px solid var(--madera); border-radius: var(--r-m);
  box-shadow: var(--sombra-suave), var(--brillo);
}
.res:active { transform: translateY(1px); box-shadow: var(--brillo); }
.res-cab { display: flex; align-items: baseline; gap: 3px; min-width: 0; }
.res-cab > i { flex: none; font-style: normal; font-size: 1.05em; line-height: 1; }
.res-cab > b { flex: 1; min-width: 0; text-align: right; font-size: 1em; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.res-cab > small { flex: none; font-size: .66em; font-weight: 800; color: var(--tinta-suave); font-variant-numeric: tabular-nums; }
.res-ritmo { font-size: .7em; line-height: 1.1; text-align: right; }
.res .barra-progreso { height: 6px; }

/* al tope no se produce: se está tirando comida a la basura y se dice en rojo */
.res.lleno { border-color: var(--rojo); background-image: linear-gradient(180deg, #fde8e4, #f6cfc8); }
.res.lleno .res-cab > b, .res.lleno .res-cab > small { color: var(--rojo-oscuro); }
.res.casi { border-color: var(--oro-oscuro); }
.res.abierto { box-shadow: 0 0 0 3px rgba(212, 164, 55, .55), var(--brillo); }

/* ---------- fila de estado: gente, gemas, nivel y los dos botones ---------- */
.hud-estado { display: flex; align-items: center; gap: 5px; min-width: 0; }
.pastilla {
  position: relative; overflow: hidden;
  display: inline-flex; align-items: center; gap: 5px;
  min-height: 48px; padding: 4px 11px;
  font-family: inherit; font-size: .84em; font-weight: 800; line-height: 1.05;
  color: var(--pergamino-claro);
  background-image: linear-gradient(180deg, var(--madera-clara), var(--madera));
  border: 2px solid var(--madera-oscura); border-radius: var(--r-max);
  box-shadow: var(--sombra-suave);
  white-space: nowrap;
}
.pastilla > i { font-style: normal; font-size: 1.15em; }
.pastilla > b { font-variant-numeric: tabular-nums; }
button.pastilla:active { transform: translateY(2px); box-shadow: none; }
.parados {
  font-style: normal; font-size: .9em; line-height: 1;
  min-width: 20px; padding: 3px 5px; text-align: center;
  color: #fff3ec; background-image: linear-gradient(180deg, var(--rojo-claro), var(--rojo));
  border: 1px solid var(--rojo-oscuro); border-radius: var(--r-max);
}
.hud-mas.flojo { filter: grayscale(.7); opacity: .6; }
/* el nivel enseña la experiencia como relleno del propio botón: cero píxeles extra */
.pastilla-xp { position: absolute; inset: 0; width: 0; background: rgba(242, 200, 92, .42); transition: width var(--medio) var(--curva); }
.pastilla > span, .pastilla > b, .pastilla > i { position: relative; }
.hud-redondo { min-width: 48px; min-height: 48px; padding: 0; font-size: 1.2em; border-radius: var(--r-max); }
.hud-mas { min-width: 48px; min-height: 48px; padding: 0; font-size: 1.3em; border-radius: var(--r-max); }

/* los avisos flotantes de styles.js nacen arriba del todo: ahí está la barra de
   recursos, así que se bajan justo por debajo para que no la tapen */
#hud > .capa-toast { top: calc(var(--seg-arriba) + var(--alto-top) + 6px); }

/* ---------- columna de obras (derecha) ---------- */
.hud-obras {
  position: fixed; z-index: 15;
  top: calc(var(--seg-arriba) + var(--alto-top) + 4px); right: calc(var(--seg-der) + 8px);
  width: 150px; max-height: 46vh;
  display: flex; flex-direction: column; gap: 6px;
  overflow: hidden;
}
/* con alarma en pantalla, las obras se apartan: nada debe tapar el aviso */
#hud.alarmado .hud-obras { top: calc(var(--seg-arriba) + var(--alto-top) + 82px); }
.obra {
  padding: 6px 8px 8px;
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 2px solid var(--madera); border-radius: var(--r-m);
  box-shadow: var(--sombra-suave);
  animation: pop var(--medio) var(--curva) both;
}
.obra-cab { display: flex; align-items: center; gap: 5px; font-size: .76em; font-weight: 800; line-height: 1.1; }
.obra-cab span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.obra-cab em { margin-left: auto; font-style: normal; color: var(--madera); font-variant-numeric: tabular-nums; }
.obra-pie { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
.obra-pie .barra-progreso { flex: 1; height: 12px; }
.btn-gema { min-width: 48px; min-height: 48px; padding: 0 6px; font-size: .78em; line-height: 1.1; }
.obra-mas { align-self: flex-end; }

/* ---------- alarma de ataque ---------- */
.hud-alarma {
  position: fixed; z-index: 40;
  top: calc(var(--seg-arriba) + var(--alto-top) + 4px); left: calc(var(--seg-izq) + 8px); right: calc(var(--seg-der) + 8px);
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px;
  color: #fff3ec; font-weight: 800;
  background-image: linear-gradient(180deg, var(--rojo-claro), var(--rojo));
  border: 3px solid var(--rojo-oscuro); border-radius: var(--r-g);
  box-shadow: var(--sombra-flotante);
  animation: pop var(--medio) var(--curva) both, latido 1.1s var(--curva) infinite;
}
.hud-alarma .icono-gr { animation: tiembla 1.1s ease-in-out infinite; }
.hud-alarma b { font-size: 1.25em; font-variant-numeric: tabular-nums; }

/* ---------- celebración ---------- */
.hud-fiesta { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; pointer-events: none; }
.fiesta-carta { width: min(84vw, 340px); text-align: center; padding: 22px 18px; animation: pop 320ms var(--curva) both; }
.fiesta-carta .icono-gr { font-size: 3.4em; display: block; animation: latido 900ms var(--curva) 2; }
.fiesta-carta h3 { margin: 8px 0 4px; font-size: 1.4em; }
.fiesta-carta p { margin: 0; color: var(--tinta-suave); font-weight: 700; }

/* ---------- botonera y consejo de abajo ---------- */
.hud-abajo {
  position: fixed; z-index: 20; left: 0; right: 0; bottom: 0;
  display: flex; flex-direction: column; gap: 5px;
  padding: 0 calc(var(--seg-der) + 8px) calc(var(--seg-abajo) + 7px) calc(var(--seg-izq) + 8px);
  pointer-events: none;
}
.hud-abajo > * { pointer-events: auto; }

/* El mayordomo no es una tira gris: es una tarjeta con su botón de "vamos". */
.hud-consejo {
  display: flex; align-items: center; gap: 9px;
  padding: 3px 3px 3px 11px;
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 3px solid var(--madera); border-radius: var(--r-g);
  box-shadow: var(--sombra-panel);
}
.hud-consejo > i { flex: none; font-style: normal; font-size: 1.5em; line-height: 1; }
.hud-consejo > span {
  flex: 1; min-width: 0;
  font-size: .78em; font-weight: 700; line-height: 1.22;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.consejo-ir { min-height: 48px; padding: 0 12px; font-size: .82em; white-space: nowrap; }
.hud-consejo.urgente { border-color: var(--rojo); box-shadow: var(--sombra-panel), 0 0 0 3px rgba(179, 51, 43, .35); }
.hud-consejo.urgente > i { animation: latido 1.4s var(--curva) infinite; }

.hud-botonera { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.hud-boton {
  position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  min-height: 54px; padding: 4px 2px;
  font-family: inherit; font-weight: 800; color: var(--tinta);
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 3px solid var(--madera); border-radius: var(--r-m);
  box-shadow: 0 4px 0 var(--madera-oscura), var(--brillo);
}
.hud-boton:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--madera-oscura); }
.hud-boton i { font-style: normal; font-size: 1.45em; line-height: 1; }
.hud-boton small { font-size: .66em; letter-spacing: .01em; }

/* ---------- panel de producción ---------- */
/* los cuatro recursos tienen que verse a la vez: nada de barrer de lado */
.eco-tabs { overflow: visible; }
.eco-tabs .pestaña { flex: 1 1 0; min-width: 0; padding: 6px 2px; font-size: .86em; gap: 3px; }
.eco-cab { display: flex; align-items: center; gap: 10px; }
.eco-cab > i { font-style: normal; font-size: 2.1em; line-height: 1; }
.eco-cab .eco-cifras { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.eco-cab .ritmo { font-size: 1.5em; line-height: 1.05; }
.eco-cab small { font-size: .78em; font-weight: 700; color: var(--tinta-suave); font-variant-numeric: tabular-nums; }
.eco-seccion { margin: 2px 0 -2px; font-size: .78em; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--tinta-suave); }
.eco-lista { border: 2px solid rgba(90, 58, 34, .28); border-radius: var(--r-m); background: rgba(255, 255, 255, .45); overflow: hidden; }
.eco-pie { display: flex; align-items: center; gap: 8px; }
.eco-pie .crece { font-size: .82em; font-weight: 800; line-height: 1.15; }
.eco-pie .btn { flex: none; }

/* ---------- ficha de edificio ---------- */
.ficha-cab { display: flex; align-items: center; gap: 12px; }
.ficha-cab .icono-gr { font-size: 2.4em; }
.ficha-gente { display: flex; align-items: center; gap: 10px; }
.ficha-gente .btn { min-width: 62px; font-size: 1.3em; }
.ficha-gente-num { flex: 1; text-align: center; font-size: 1.1em; font-weight: 800; line-height: 1.15; font-variant-numeric: tabular-nums; }
.ficha-gente-num small { display: block; font-size: .62em; font-weight: 700; color: var(--tinta-suave); }
.ficha-acciones { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ficha-acciones .ancho { grid-column: 1 / -1; }
/* una mejora que aún no se puede pagar TIENE que dejar leer su coste */
.ficha-acciones .btn[disabled] { filter: grayscale(.5); opacity: .7; }

/* pantallas estrechas: lo primero que sobra es el adorno, nunca el dato */
@media (max-width: 365px) {
  .pastilla { padding: 4px 8px; font-size: .78em; }
  .res { padding: 4px 5px 5px; }
}
/* pantallas muy cortas: el HUD se aprieta antes de tapar el juego */
@media (max-height: 680px) {
  .hud-boton { min-height: 52px; }
  .hud-obras { max-height: 38vh; }
  .hud-consejo > span { -webkit-line-clamp: 1; }
}
`

function inyectarEstilos () {
  if (document.getElementById('estilos-hud')) return
  const nodo = document.createElement('style')
  nodo.id = 'estilos-hud'
  nodo.textContent = CSS
  document.head.appendChild(nodo)
}

/* ===========================================================================
   Números que suben solos
   Un recurso que salta de 300 a 460 de golpe no se lee; subiendo, sí.
   =========================================================================== */

const animados = new Map()   // nodo -> { actual, objetivo }
let animando = false

function fijarNumero (nodo, objetivo, { instante = false } = {}) {
  if (!nodo) return
  let estado = animados.get(nodo)
  if (!estado) { estado = { actual: objetivo, objetivo }; nodo.textContent = formatoNumero(objetivo) }
  estado.objetivo = objetivo
  // saltos absurdos (cargar otra partida) no se animan: se plantan
  if (instante || Math.abs(estado.objetivo - estado.actual) > 100000) {
    estado.actual = objetivo
    nodo.textContent = formatoNumero(objetivo)
  }
  animados.set(nodo, estado)
  if (!animando) { animando = true; requestAnimationFrame(pasoAnimacion) }
}

function pasoAnimacion () {
  let quedan = false
  for (const [nodo, e] of animados) {
    if (!nodo.isConnected) { animados.delete(nodo); continue }
    const dif = e.objetivo - e.actual
    if (Math.abs(dif) < 0.6) {
      if (e.actual !== e.objetivo) { e.actual = e.objetivo; nodo.textContent = formatoNumero(e.objetivo) }
      continue
    }
    e.actual += dif * 0.22
    nodo.textContent = formatoNumero(Math.round(e.actual))
    quedan = true
  }
  animando = quedan
  if (quedan) requestAnimationFrame(pasoAnimacion)
}

/** Texto corto y siempre con signo: "+720/h", "−90/h", "0/h". */
function porHora (v) {
  const n = Number(v) || 0
  const abs = Math.abs(n)
  const cifra = abs < 10 ? String(Math.round(abs * 10) / 10).replace('.', ',') : formatoNumero(Math.round(abs))
  if (n > 0) return `+${cifra}/h`
  if (n < 0) return `−${cifra}/h`
  return '0/h'
}

const tonoRitmo = (v) => v > 0 ? 'ritmo-bien' : v < 0 ? 'ritmo-mal' : 'ritmo-cero'

/* ===========================================================================
   La economía de un vistazo
   sim/resources.js no exporta el desglose edificio a edificio, así que aquí se
   calcula el PESO de cada uno (base × aldeanos × aura) y se reparte con él el
   total real que devuelve `produccionPorMinuto()`. Los multiplicadores globales
   (ciencia, edad, ánimo) son iguales para todos, así que se van en la división:
   lo que se enseña por edificio cuadra con lo que entra en la caja.
   =========================================================================== */

const MINIMO_SIN_ALDEANOS = 0.25   // mismo reparto por faena que sim/resources.js

function pesosProduccion () {
  const s = game.state
  const auras = []
  for (const b of s.buildings || []) {
    if (b.enObra) continue
    const d = defEdificio(b.tipo)
    if (!d?.aura) continue
    const c = centroDe(b)
    auras.push({ x: c.x, z: c.z, radio: d.aura.radio, afecta: d.aura.afecta, bonus: d.aura.bonus(b.nivel || 1) })
  }

  const filas = []
  const suma = { madera: 0, piedra: 0, comida: 0, oro: 0 }
  for (const b of s.buildings || []) {
    if (b.enObra) continue
    const d = defEdificio(b.tipo)
    if (!d?.produce || typeof d.porMinuto !== 'function') continue
    const nivel = b.nivel || 1
    const plazas = typeof d.plazas === 'function' ? Math.max(0, d.plazas(nivel)) : 0
    const dentro = Math.min(plazas, (b.trabajadores || []).length)
    const faena = plazas > 0 ? MINIMO_SIN_ALDEANOS + (1 - MINIMO_SIN_ALDEANOS) * (dentro / plazas) : 1

    let aura = 0
    if (auras.length) {
      const c = centroDe(b)
      for (const a of auras) if (a.afecta === b.tipo && dist(c.x, c.z, a.x, a.z) <= a.radio) aura += a.bonus
    }

    const peso = d.porMinuto(nivel) * faena * (1 + aura)
    suma[d.produce] = (suma[d.produce] || 0) + peso
    filas.push({
      id: b.id, tipo: b.tipo, nombre: d.nombre || 'Edificio', icono: d.icono || '🏚️',
      recurso: d.produce, nivel, peso, plazas, dentro, x: b.x, z: b.z
    })
  }
  return { filas, suma }
}

/**
 * Foto completa: por recurso, lo que entra, lo que come la tropa, el saldo,
 * cuánto falta para llenar el almacén y qué edificio aporta cada cosa.
 */
function economia () {
  const s = game.state
  const { filas, suma } = pesosProduccion()
  const pm = pedir('recursos', 'produccionPorMinuto', null) || suma
  const comeTropa = (Number(pedir('ejercito', 'consumoComida', 0)) || 0) * 60

  const out = {}
  for (const r of CONFIG.RECURSOS) {
    const entra = (pm[r] || 0) * 60
    const gasta = r === 'comida' ? comeTropa : 0
    const neto = entra - gasta
    const cantidad = Math.floor(s.recursos?.[r] || 0)
    const tope = Math.floor(s.almacen?.[r] || 0)
    const escala = suma[r] > 0 ? (pm[r] || 0) / suma[r] : 0

    const edificios = filas
      .filter(f => f.recurso === r)
      .map(f => ({ ...f, porHora: f.peso * escala * 60 }))
      .sort((a, b) => b.porHora - a.porHora)

    const lleno = tope > 0 && cantidad >= tope
    out[r] = {
      cantidad, tope, entra, gasta, neto, lleno, edificios,
      pct: tope > 0 ? Math.min(100, (cantidad / tope) * 100) : 0,
      // el ritmo que se ve en la barra: si está lleno, no entra nada aunque produzca
      ritmo: lleno ? 0 : neto,
      desperdicio: lleno ? Math.max(0, neto) : 0,
      llenaEn: (!lleno && neto > 0 && tope > cantidad) ? ((tope - cantidad) / neto) * 3600 : null,
      aldeanos: edificios.reduce((n, e) => n + e.dentro, 0),
      plazasLibres: edificios.reduce((n, e) => n + Math.max(0, e.plazas - e.dentro), 0)
    }
  }
  return out
}

/** Cuánta gente hay, cuánta cabe y cuánta está de brazos cruzados. */
function gente () {
  const s = game.state
  const p = pedir('aldeanos', 'poblacion', null) || { actual: (s.villagers || []).length, maxima: 0 }
  const trabajos = pedir('aldeanos', 'resumenTrabajos', null)
  const parados = trabajos
    ? (trabajos.parado || 0)
    : (s.villagers || []).filter(v => !v.buildingId).length
  return { actual: p.actual || 0, maxima: p.maxima || 0, parados, coste: pedir('aldeanos', 'costeContratar', 0) }
}

/** Producción real de un edificio concreto, por hora. */
function produccionDe (id) {
  const eco = economia()
  for (const r of CONFIG.RECURSOS) {
    const f = eco[r].edificios.find(e => e.id === id)
    if (f) return { recurso: r, porHora: f.porHora, dentro: f.dentro, plazas: f.plazas }
  }
  return null
}

/* ===========================================================================
   Montaje
   =========================================================================== */

const raiz = () => document.getElementById('hud') || document.body

const nodos = {}                  // piezas fijas del HUD
const refrescadores = new Set()   // paneles abiertos que quieren latido de 4/s
let vistaActual = 'aldea'
let alarma = null

export async function init () {
  inyectarEstilos()
  await engancharSim()

  montarArriba()
  montarObras()
  montarAbajo()
  conectarEventos()

  pintarRecursos(true)
  pintarObras()
  pintarConsejo()
  pintarBadges()
  medirTop()

  // Un solo latido para todo lo que cuenta hacia atrás. Nada de rAF: el HUD no
  // necesita 60 fps, necesita ir al mismo paso que la simulación.
  setInterval(refrescoLigero, 250)
  addEventListener('resize', medirTop)
}

let vueltas = 0
function refrescoLigero () {
  if (document.hidden) return
  vueltas++
  pintarObras()
  pintarAlarma()
  if (vueltas % 4 === 0) { pintarRecursos(); pintarBadges() }        // 1 vez/s
  if (vueltas % 12 === 0) pintarConsejo()                            // 1 vez cada 3 s
  for (const f of refrescadores) { try { f() } catch (err) { console.warn('[hud] refresco', err) } }
}

/** La altura real de la barra de arriba manda sobre lo que cuelga debajo:
 *  así las obras y los avisos nunca se solapan con los recursos. */
function medirTop () {
  const alto = Math.round(nodos.top?.getBoundingClientRect().height || 112)
  raiz().style.setProperty('--alto-top', `${alto}px`)
}

/* ---------------------------------------------------------------- arriba --- */

function montarArriba () {
  const res = el('div', { clase: 'hud-res' })
  nodos.recursos = {}
  for (const tipo of CONFIG.RECURSOS) {
    const cifra = el('b', { clase: 'num', texto: '0' })
    const tope = el('small', { texto: '/0' })
    const barra = barraProgreso(0, { clase: 'fina quieta' })
    const ritmo = el('div', { clase: 'res-ritmo ritmo ritmo-cero', texto: '0/h' })
    const pastilla = el('button', {
      clase: 'res', type: 'button', 'aria-label': `${NOMBRE_RECURSO[tipo]}: ver producción`,
      onclick: () => abrirEconomia(tipo)
    }, [
      el('div', { clase: 'res-cab' }, [el('i', { texto: ICONO[tipo] }), cifra, tope]),
      barra.nodo,
      ritmo
    ])
    nodos.recursos[tipo] = { pastilla, cifra, tope, barra, ritmo }
    res.appendChild(pastilla)
  }

  nodos.gemas = el('b', { texto: '0' })
  nodos.nivel = el('b', { texto: '1' })
  nodos.xp = el('span', { clase: 'pastilla-xp' })
  nodos.poblacion = el('b', { texto: '0/0' })
  // los parados van EN LÍNEA, no como globo encima: un globo taparía la cifra
  nodos.parados = el('em', { clase: 'parados', texto: '0', estilo: { display: 'none' } })

  nodos.botonGente = el('button', {
    clase: 'pastilla', type: 'button', 'aria-label': 'Aldeanos y producción',
    onclick: () => abrirEconomia(null)
  }, [el('i', { texto: ICONO.aldeano }), nodos.poblacion, nodos.parados])

  nodos.botonContratar = el('button', {
    clase: 'btn btn-oro hud-mas', type: 'button', texto: '＋', 'aria-label': 'Contratar aldeano',
    onclick: contratarAldeano
  })

  nodos.botonVista = el('button', {
    clase: 'btn btn-piedra hud-redondo', type: 'button', 'aria-label': 'Cambiar de vista',
    texto: '🗺️', onclick: alternarVista
  })

  const estado = el('div', { clase: 'hud-estado' }, [
    nodos.botonGente,
    nodos.botonContratar,
    el('span', { clase: 'pastilla' }, [el('i', { texto: ICONO.gemas }), nodos.gemas]),
    el('span', { clase: 'pastilla', 'aria-label': 'Nivel' }, [nodos.xp, el('i', { texto: '⭐' }), nodos.nivel]),
    el('span', { clase: 'crece' }),
    nodos.botonVista,
    el('button', {
      clase: 'btn btn-piedra hud-redondo', type: 'button', 'aria-label': 'Ajustes',
      texto: '⚙️', onclick: abrirAjustes
    })
  ])

  nodos.top = el('div', { clase: 'hud-top' }, [res, estado])
  raiz().appendChild(nodos.top)
}

function contratarAldeano () {
  const nuevo = pedir('aldeanos', 'contratar', null)
  if (nuevo) {
    toast('Un aldeano más en la aldea', 'bien')
    events.emit(EV.SFX, { nombre: 'toque' })
  }
  pintarRecursos()
}

function pintarRecursos (instante = false) {
  const eco = economia()

  for (const tipo of CONFIG.RECURSOS) {
    const n = nodos.recursos[tipo]
    if (!n) continue
    const e = eco[tipo]

    fijarNumero(n.cifra, e.cantidad, { instante })
    const textoTope = `/${formatoNumero(e.tope)}`
    if (n.tope.textContent !== textoTope) n.tope.textContent = textoTope
    n.barra.fijar(e.pct)

    const texto = e.lleno ? '¡LLENO!' : porHora(e.ritmo)
    if (n.ritmo.textContent !== texto) n.ritmo.textContent = texto
    const tono = e.lleno ? 'ritmo-mal' : tonoRitmo(e.ritmo)
    if (n.ritmo.dataset.tono !== tono) {
      n.ritmo.className = `res-ritmo ritmo ${tono}`
      n.ritmo.dataset.tono = tono
    }
    n.pastilla.classList.toggle('lleno', e.lleno)
    n.pastilla.classList.toggle('casi', !e.lleno && e.pct >= 90)
    n.barra.nodo.classList.toggle('mal', e.pct >= 90)
  }

  const s = game.state
  fijarNumero(nodos.gemas, Math.floor(s.jugador?.gemas || 0), { instante })

  const nv = pedir('ciencia', 'nivelJugador', null)
  const nivel = nv?.nivel ?? s.jugador?.nivel ?? 1
  if (nodos.nivel.textContent !== String(nivel)) {
    nodos.nivel.textContent = String(nivel)
    latir(nodos.nivel)
  }
  nodos.xp.style.width = `${Math.round((nv?.pct ?? 0) * 100)}%`

  // población: siempre a la vista, con los parados en rojo
  const g = gente()
  const txt = `${g.actual}/${g.maxima}`
  if (nodos.poblacion.textContent !== txt) nodos.poblacion.textContent = txt
  pintarParados(g.parados)
  nodos.botonGente.setAttribute('aria-label',
    `${g.actual} de ${g.maxima} aldeanos${g.parados ? `, ${g.parados} sin faena` : ''}. Ver producción`)
  const sitio = g.maxima > 0 && g.actual < g.maxima
  const paga = (s.recursos?.comida || 0) >= (g.coste || 0)
  nodos.botonContratar.style.display = g.maxima > 0 ? '' : 'none'
  // no se desactiva del todo a propósito: tocarlo explica por qué no se puede
  nodos.botonContratar.classList.toggle('flojo', !(sitio && paga))
  nodos.botonContratar.setAttribute('aria-label', `Contratar aldeano · ${ICONO.comida} ${formatoNumero(g.coste || 0)}`)
}

/** Los aldeanos sin faena: en rojo y con su siesta, para que se entiendan solos. */
function pintarParados (n) {
  const nodo = nodos.parados
  if (!nodo) return
  if (!n) { nodo.style.display = 'none'; return }
  const texto = n > 9 ? '9+' : String(n)   // sin emoji: 💤 se pinta enorme y rompe la cápsula
  if (nodo.style.display === 'none') { nodo.style.display = ''; latir(nodo) }
  if (nodo.textContent !== texto) { nodo.textContent = texto; latir(nodo) }
}

function alternarVista () {
  vistaActual = vistaActual === 'aldea' ? 'mundo' : 'aldea'
  events.emit(EV.VISTA_CAMBIADA, { vista: vistaActual })
}

function pintarVista () {
  if (!nodos.botonVista) return
  nodos.botonVista.textContent = vistaActual === 'aldea' ? '🗺️' : '🏰'
  nodos.botonVista.setAttribute('aria-label', vistaActual === 'aldea' ? 'Ver el mundo' : 'Volver a la aldea')
}

/* ===========================================================================
   Panel de producción: la economía entera, para revisarlo todo bien
   =========================================================================== */

let hojaEco = null

/** @param {string|null} recurso pestaña que se abre (null = la que más chirríe) */
function abrirEconomia (recurso = null) {
  if (hojaEco) {
    const mismo = hojaEco.recurso === recurso
    hojaEco.panel.cerrar()
    if (mismo) return
  }

  const eco = economia()
  let activo = recurso
  if (!activo) {
    // sin recurso pedido, se abre por donde duele: primero lo que se desperdicia
    activo = CONFIG.RECURSOS.find(r => eco[r].lleno) ||
             CONFIG.RECURSOS.find(r => eco[r].neto < 0) ||
             CONFIG.RECURSOS[0]
  }

  const detalle = el('div', { clase: 'col' })
  const tabs = pestañas(   // eco-tabs: las cuatro caben sin barrer de lado

    CONFIG.RECURSOS.map(r => ({ id: r, texto: NOMBRE_RECURSO[r], icono: ICONO[r] })),
    (id) => { activo = id; firma = null; pintar() }
  )

  // pie fijo: la gente y el botón de repartir se ven desde cualquier pestaña
  const pieTexto = el('div', { clase: 'crece' })
  const pie = el('div', { clase: 'eco-pie' }, [
    pieTexto,
    el('button', {
      clase: 'btn btn-oro', type: 'button', texto: '🧭 Repartir solos',
      onclick: () => { pedir('aldeanos', 'asignarAutomatico', 0); firma = null; pintar(); pintarRecursos() }
    })
  ])

  tabs.nodo.classList.add('eco-tabs')

  const panel = hoja({
    titulo: '📊 Producción de la aldea',
    contenido: el('div', { clase: 'col' }, [tabs.nodo, detalle]),
    pie,
    alCerrar: () => {
      refrescadores.delete(pintar)
      for (const t of CONFIG.RECURSOS) nodos.recursos[t]?.pastilla.classList.remove('abierto')
      hojaEco = null
    }
  })

  // Reconstruir cuatro veces por segundo se comería el scroll y los toques:
  // la lista solo se rehace cuando cambia de verdad; el resto son cifras.
  let firma = null
  const pintar = () => {
    const e = economia()
    const g = gente()
    const nueva = firmaEconomia(activo, e, g)
    if (nueva !== firma) {
      firma = nueva
      vaciar(detalle)
      const nuevo = cuerpoEconomia(activo, e, g, panel)
      detalle._tic = nuevo._tic
      detalle.appendChild(nuevo)
    } else {
      detalle._tic?.(e)
    }
    pieTexto.innerHTML = ''
    pieTexto.append(
      el('div', { texto: `${ICONO.aldeano} ${g.actual} de ${g.maxima} aldeanos` }),
      el('div', {
        clase: g.parados ? 'ritmo-mal' : 'tenue',
        estilo: { fontSize: '.88em' },
        texto: g.parados ? `${g.parados} de brazos cruzados` : 'Todos con faena'
      })
    )
  }

  tabs.activar(activo, false)
  pintar()
  refrescadores.add(pintar)
  hojaEco = { panel, recurso }
  for (const t of CONFIG.RECURSOS) nodos.recursos[t]?.pastilla.classList.toggle('abierto', t === activo)
  return panel
}

function firmaEconomia (r, eco, g) {
  const e = eco[r]
  return [r, e.lleno, Math.round(e.entra), Math.round(e.gasta), e.tope, g.actual, g.parados,
    e.edificios.map(x => `${x.id}:${x.nivel}:${x.dentro}`).join(',')].join('|')
}

function cuerpoEconomia (r, eco, g, panel) {
  const e = eco[r]
  const caja = el('div', { clase: 'col' })

  // --- cabecera: el ritmo, gordo y en color ---
  const cifra = el('div', { clase: `ritmo ${e.lleno ? 'ritmo-mal' : tonoRitmo(e.ritmo)}`, texto: e.lleno ? '0/h' : porHora(e.ritmo) })
  const almacenTxt = el('small')
  const barra = barraProgreso(e.pct, { gorda: true, clase: 'quieta' })
  caja.appendChild(el('div', { clase: 'panel', estilo: { padding: '12px' } }, [
    el('div', { clase: 'eco-cab' }, [
      el('i', { texto: ICONO[r] }),
      el('div', { clase: 'eco-cifras' }, [cifra, almacenTxt])
    ]),
    el('div', { estilo: { marginTop: '8px' } }, barra.nodo)
  ]))

  // --- aviso de almacén: llenar es perder producción ---
  const aviso = el('div', { clase: 'aviso' })
  caja.appendChild(aviso)

  // --- de dónde sale ---
  caja.appendChild(el('div', { clase: 'eco-seccion', texto: 'De dónde sale' }))
  const lista = el('div', { clase: 'eco-lista' })
  if (!e.edificios.length) {
    lista.appendChild(el('div', { clase: 'dato tenue' }, [
      el('i', { texto: '🚧' }),
      el('div', { clase: 'dato-txt' }, el('span', { texto: `Nada produce ${NOMBRE_RECURSO[r].toLowerCase()} todavía` }))
    ]))
  }
  for (const f of e.edificios) {
    const libres = Math.max(0, f.plazas - f.dentro)
    lista.appendChild(el('button', {
      clase: 'dato', type: 'button',
      onclick: () => { panel.cerrar(); events.emit(EV.CAMERA_FOCUS, { x: f.x, z: f.z }); events.emit(EV.UI_SELECT, { kind: 'building', id: f.id }) }
    }, [
      el('i', { texto: f.icono }),
      el('div', { clase: 'dato-txt' }, [
        el('span', { texto: `${f.nombre} · nivel ${f.nivel}` }),
        el('small', {
          clase: libres ? 'ritmo-mal' : '',
          texto: f.plazas
            ? `${ICONO.aldeano} ${f.dentro}/${f.plazas}${libres ? ` · ${libres} plaza${libres === 1 ? '' : 's'} libre${libres === 1 ? '' : 's'}` : ' · al completo'}`
            : 'no necesita gente'
        })
      ]),
      el('b', { clase: `ritmo ${tonoRitmo(f.porHora)}`, texto: porHora(f.porHora) })
    ]))
  }
  caja.appendChild(lista)

  // --- el gasto: lo que come la tropa frente a lo que dan las granjas ---
  if (r === 'comida') {
    caja.appendChild(el('div', { clase: 'eco-seccion', texto: 'Las bocas que alimentas' }))
    caja.appendChild(el('div', { clase: 'eco-lista' }, [
      el('div', { clase: 'dato' }, [
        el('i', { texto: ICONO.comida }),
        el('div', { clase: 'dato-txt' }, el('span', { texto: 'Producen las granjas' })),
        el('b', { clase: 'ritmo ritmo-bien', texto: porHora(e.entra) })
      ]),
      el('div', { clase: 'dato' }, [
        el('i', { texto: '⚔️' }),
        el('div', { clase: 'dato-txt' }, [
          el('span', { texto: 'Come la tropa' }),
          el('small', { texto: pedir('ejercito', 'hayHambre', false) ? 'pasan hambre: pegan un 20 % menos' : 'manutención del ejército' })
        ]),
        el('b', { clase: `ritmo ${e.gasta ? 'ritmo-mal' : 'ritmo-cero'}`, texto: porHora(-e.gasta) })
      ]),
      el('div', { clase: 'dato' }, [
        el('i', { texto: '⚖️' }),
        el('div', { clase: 'dato-txt' }, el('span', { texto: 'Saldo real' })),
        el('b', { clase: `ritmo ${tonoRitmo(e.neto)}`, texto: porHora(e.neto) })
      ])
    ]))
  }

  // --- la faena: cuánta gente hay puesta y cuántas plazas quedan ---
  caja.appendChild(el('div', { clase: 'stats' }, [
    el('div', { clase: 'stat' }, [el('small', { texto: 'Aldeanos puestos' }), el('b', { texto: `${ICONO.aldeano} ${e.aldeanos}` })]),
    el('div', { clase: 'stat' }, [
      el('small', { texto: 'Plazas libres' }),
      el('b', { clase: e.plazasLibres ? 'ritmo-mal' : '', texto: String(e.plazasLibres) })
    ])
  ]))

  caja.appendChild(el('div', {
    clase: 'tenue pequeño', estilo: { textAlign: 'center' },
    texto: `Sigue entrando con el juego cerrado, hasta ${CONFIG.MAX_OFFLINE_HORAS} horas.`
  }))

  // refresco barato: solo las cifras que cambian solas con el reloj
  caja._tic = (nueva) => {
    const x = (nueva || economia())[r]
    almacenTxt.textContent = x.lleno
      ? `${formatoNumero(x.cantidad)} de ${formatoNumero(x.tope)} · no cabe nada más`
      : `${formatoNumero(x.cantidad)} de ${formatoNumero(x.tope)} en el almacén`
    barra.fijar(x.pct)
    barra.nodo.classList.toggle('mal', x.pct >= 90)
    cifra.textContent = x.lleno ? '0/h' : porHora(x.ritmo)
    cifra.className = `ritmo ${x.lleno ? 'ritmo-mal' : tonoRitmo(x.ritmo)}`
    pintarAvisoAlmacen(aviso, x, r)
  }
  caja._tic(eco)
  return caja
}

function pintarAvisoAlmacen (nodo, e, r) {
  let clase = 'aviso aviso-info'
  let icono = '⏳'
  let texto = ''
  if (e.lleno) {
    clase = 'aviso aviso-mal'; icono = '🚨'
    texto = e.desperdicio > 0
      ? `Almacén LLENO: se están tirando ${porHora(e.desperdicio).replace('+', '')}. Gástalo o amplía el almacén.`
      : 'Almacén lleno. Gasta o amplía el almacén.'
  } else if (e.neto < 0) {
    clase = 'aviso aviso-mal'; icono = '📉'
    texto = `Se gasta más de lo que entra: en ${formatoTiempo(e.cantidad / (-e.neto) * 3600)} te quedas a cero.`
  } else if (e.llenaEn != null) {
    clase = e.llenaEn < 1800 ? 'aviso aviso-info' : 'aviso aviso-bien'
    icono = e.llenaEn < 1800 ? '⏳' : '✅'
    texto = `Se llena en ${formatoTiempo(e.llenaEn)}.`
  } else {
    clase = 'aviso aviso-info'; icono = '💤'
    texto = 'No entra nada: pon aldeanos o levanta un edificio de producción.'
  }
  if (nodo.dataset.texto === texto) return
  nodo.dataset.texto = texto
  nodo.className = clase
  vaciar(nodo)
  nodo.append(el('i', { texto: icono }), el('span', { texto }))
}

/* ----------------------------------------------------------------- obras --- */

const MAX_TARJETAS = 3

function montarObras () {
  nodos.obras = el('div', { clase: 'hud-obras' })
  raiz().appendChild(nodos.obras)
}

/**
 * Todo lo que está corriendo con un reloj encima, en un formato único:
 * { clave, icono, nombre, restante, pct, gemas, acelerar }
 */
function tareasEnCurso () {
  const lista = []
  const ahora = Date.now()

  for (const o of game.state.obras || []) {
    const b = (game.state.buildings || []).find(x => x.id === o.buildingId)
    const d = b ? defEdificio(b.tipo) : null
    const total = Math.max(1, (o.fin - (o.inicio || o.fin)) / 1000)
    const restante = Math.max(0, (o.fin - ahora) / 1000)
    lista.push({
      clave: `obra-${o.id}`,
      icono: d?.icono || '🔨',
      nombre: `${d?.nombre || 'Obra'}${o.tipo === 'mejorar' ? ` ${(b?.nivel || 0) + 1}` : ''}`,
      restante,
      pct: Math.min(100, (1 - restante / total) * 100),
      gemas: pedir('edificios', 'costeAcelerar', 0, o.buildingId),
      acelerar: () => pedir('edificios', 'acelerar', false, o.buildingId),
      alTocar: () => events.emit(EV.UI_SELECT, { kind: 'building', id: o.buildingId })
    })
  }

  const cola = game.state.ejercito?.cola || []
  if (cola.length) {
    const ultimo = cola[cola.length - 1]
    const primero = cola[0]
    const total = Math.max(1, (primero.fin - (primero.inicio || primero.fin)) / 1000)
    const restante = Math.max(0, (primero.fin - ahora) / 1000)
    lista.push({
      clave: 'tropa',
      icono: '⚔️',
      nombre: `Tropa ×${cola.length}`,
      restante: Math.max(0, (ultimo.fin - ahora) / 1000),
      pct: Math.min(100, (1 - restante / total) * 100),
      gemas: Math.max(1, Math.ceil(((ultimo.fin - ahora) / 1000) / CONFIG.SEG_POR_GEMA)),
      acelerar: () => pedir('ejercito', 'acelerarEntrenamiento', null),
      alTocar: () => events.emit(EV.UI_PANEL, { panel: 'ejercito' })
    })
  }

  const inv = pedir('ciencia', 'progresoInvestigacion', null)
  if (inv) {
    lista.push({
      clave: 'ciencia',
      icono: inv.icono || '📜',
      nombre: inv.nombre,
      restante: inv.restante,
      pct: Math.min(100, (inv.pct || 0) * 100),
      gemas: inv.gemas,
      acelerar: () => pedir('ciencia', 'acelerar', null, 'investigacion'),
      alTocar: () => events.emit(EV.UI_PANEL, { panel: 'ciencia' })
    })
  }

  return lista
}

function tarjetaObra (t) {
  const barra = barraProgreso(t.pct)
  const tiempo = el('em', { texto: formatoTiempo(t.restante) })
  const caja = el('div', { clase: 'obra', datos: { clave: t.clave } }, [
    el('div', { clase: 'obra-cab', onclick: t.alTocar }, [
      el('i', { texto: t.icono, estilo: { fontStyle: 'normal' } }),
      el('span', { texto: t.nombre }),
      tiempo
    ]),
    el('div', { clase: 'obra-pie' }, [
      barra.nodo,
      el('button', {
        clase: 'btn btn-oro btn-gema', type: 'button', 'aria-label': 'Acelerar con gemas',
        html: `${ICONO.gemas}<br>${t.gemas}`,
        onclick: () => { t.acelerar(); pintarObras(); pintarRecursos() }
      })
    ])
  ])
  caja._fijar = barra.fijar
  caja._tiempo = tiempo
  return caja
}

/** Refresca una tarjeta ya pintada. Nada de reconstruir: el dedo del jugador
 *  puede estar justo encima del botón y un DOM que se rehace se come el toque. */
function actualizarTarjeta (nodo, t) {
  nodo._fijar?.(t.pct)
  const txt = formatoTiempo(t.restante)
  if (nodo._tiempo && nodo._tiempo.textContent !== txt) nodo._tiempo.textContent = txt
  const boton = nodo.querySelector('.btn-gema')
  const html = `${ICONO.gemas}<br>${t.gemas}`
  if (boton && boton.innerHTML !== html) boton.innerHTML = html
}

/** Deja el contenedor con estas tareas, reconstruyendo solo si la lista cambió. */
function sincronizarTareas (cont, tareas, extra = null) {
  const previas = new Map([...cont.children].filter(n => n.dataset.clave).map(n => [n.dataset.clave, n]))
  const mismas = tareas.length === previas.size && tareas.every(t => previas.has(t.clave))
  if (mismas) {
    for (const t of tareas) actualizarTarjeta(previas.get(t.clave), t)
    return
  }
  vaciar(cont)
  for (const t of tareas) cont.appendChild(tarjetaObra(t))
  if (extra) cont.appendChild(extra())
}

function pintarObras () {
  if (!nodos.obras) return
  const tareas = tareasEnCurso()
  const visibles = tareas.slice(0, MAX_TARJETAS)
  const sobran = tareas.length - visibles.length
  sincronizarTareas(nodos.obras, visibles, sobran > 0
    ? () => el('button', { clase: 'btn btn-piedra obra-mas', type: 'button', texto: `+${sobran} más`, onclick: abrirTodasLasTareas })
    : null)
}

function abrirTodasLasTareas () {
  const cuerpo = el('div', { clase: 'col' })
  const vacio = el('p', { clase: 'tenue', texto: 'No hay nada en marcha. Buen momento para empezar una obra.' })
  const panel = hoja({ titulo: 'En marcha', contenido: cuerpo, alCerrar: () => refrescadores.delete(pintar) })
  const pintar = () => {
    const tareas = tareasEnCurso()
    sincronizarTareas(cuerpo, tareas)
    if (!tareas.length && !cuerpo.contains(vacio)) cuerpo.appendChild(vacio)
  }
  pintar()
  refrescadores.add(pintar)
  return panel
}

/* ----------------------------------------------------------------- abajo --- */

const BOTONES = [
  { panel: 'construir', icono: '🔨', texto: 'Construir' },
  { panel: 'ejercito', icono: '⚔️', texto: 'Ejército' },
  { panel: 'mundo', icono: '🗺️', texto: 'Mundo' },
  { panel: 'encargos', icono: '📜', texto: 'Encargos' }
]

function montarAbajo () {
  nodos.consejo = el('span', { texto: '' })
  nodos.consejoIcono = el('i', { texto: '🎩' })
  nodos.consejoIr = el('button', { clase: 'btn btn-oro consejo-ir', type: 'button', texto: 'Ver' })
  nodos.consejoCaja = el('div', { clase: 'hud-consejo' }, [nodos.consejoIcono, nodos.consejo, nodos.consejoIr])

  nodos.badges = {}
  const botonera = el('div', { clase: 'hud-botonera' })
  for (const b of BOTONES) {
    const globo = el('span', { clase: 'badge', texto: '0', estilo: { display: 'none' } })
    nodos.badges[b.panel] = globo
    botonera.appendChild(el('button', {
      clase: 'hud-boton', type: 'button', 'aria-label': b.texto,
      onclick: () => events.emit(EV.UI_PANEL, { panel: b.panel })
    }, [
      el('i', { texto: b.icono }),
      el('small', { texto: b.texto }),
      globo
    ]))
  }

  nodos.abajo = el('div', { clase: 'hud-abajo' }, [nodos.consejoCaja, botonera])
  raiz().appendChild(nodos.abajo)
}

/**
 * Qué toca hacer ahora. El texto lo pone el mayordomo (sim/quests.js) y la
 * ACCIÓN se deduce del estado, no de la frase: así el botón nunca miente.
 */
function consejoAhora () {
  const s = game.state
  const ahora = Date.now()
  const texto = pedir('encargos', 'siguienteConsejo', null) || consejoDeReserva()

  const activas = pedir('encargos', 'activas', null)
  const cobrable = Array.isArray(activas)
    ? activas.find(q => q && (q.listo || q.completada) && !q.cobrada)
    : (s.quests?.activas || []).find(q => q && (q.listo || q.completada) && !q.cobrada)
  if (cobrable) {
    return { texto, icono: '🎁', urgente: true, boton: 'Cobrar', accion: () => events.emit(EV.UI_PANEL, { panel: 'encargos' }) }
  }

  if ((s.expediciones || []).some(e => e && e.vuelve <= ahora)) {
    return { texto, icono: '🐎', urgente: true, boton: 'Recibir', accion: () => events.emit(EV.UI_PANEL, { panel: 'mundo' }) }
  }

  const eco = economia()
  const lleno = CONFIG.RECURSOS.find(r => eco[r].lleno)
  if (lleno) {
    return { texto, icono: '🚨', urgente: true, boton: 'Revisar', accion: () => abrirEconomia(lleno) }
  }

  const g = gente()
  if (g.parados > 0) {
    return {
      texto,
      icono: ICONO.aldeano,
      urgente: false,
      boton: 'Repartir',
      accion: () => { pedir('aldeanos', 'asignarAutomatico', 0); pintarRecursos(); pintarConsejo() }
    }
  }

  const hambre = CONFIG.RECURSOS.find(r => eco[r].neto < 0)
  if (hambre) return { texto, icono: '📉', urgente: true, boton: 'Revisar', accion: () => abrirEconomia(hambre) }

  if (!(s.obras || []).length) {
    return { texto, icono: '🔨', urgente: false, boton: 'Construir', accion: () => events.emit(EV.UI_PANEL, { panel: 'construir' }) }
  }

  const cuarteles = (s.buildings || []).some(b => !b.enObra && ['cuartel', 'arqueria', 'establo', 'taller_asedio'].includes(b.tipo))
  if (cuarteles && !(s.ejercito?.cola || []).length) {
    return { texto, icono: '⚔️', urgente: false, boton: 'Entrenar', accion: () => events.emit(EV.UI_PANEL, { panel: 'ejercito' }) }
  }

  return { texto, icono: '🎩', urgente: false, boton: 'Encargos', accion: () => events.emit(EV.UI_PANEL, { panel: 'encargos' }) }
}

function pintarConsejo () {
  const c = consejoAhora()
  if (nodos.consejo.textContent !== c.texto) nodos.consejo.textContent = c.texto
  if (nodos.consejoIcono.textContent !== c.icono) nodos.consejoIcono.textContent = c.icono
  if (nodos.consejoIr.textContent !== c.boton) nodos.consejoIr.textContent = c.boton
  nodos.consejoIr.onclick = c.accion
  nodos.consejoCaja.classList.toggle('urgente', !!c.urgente)
  nodos.consejoIr.classList.toggle('btn-peligro', !!c.urgente)
  nodos.consejoIr.classList.toggle('btn-oro', !c.urgente)
}

/** Si sim/quests.js no está, el mayordomo no se queda mudo. */
function consejoDeReserva () {
  const s = game.state
  if (!(s.buildings || []).length) return 'Toca 🔨 Construir y levanta tu Ayuntamiento.'
  const lleno = CONFIG.RECURSOS.find(r => (s.almacen?.[r] || 0) > 0 && (s.recursos?.[r] || 0) >= s.almacen[r])
  if (lleno) return `El ${lleno} se está desperdiciando: gástalo o amplía el almacén.`
  if (!(s.obras || []).length) return 'No hay ninguna obra en marcha. Toca 🔨 Construir.'
  return 'La aldea va sola. Buen momento para explorar el 🗺️ mundo.'
}

function pintarBadges () {
  const s = game.state

  // Construir: mejoras que puedes pagar YA. Es lo que hay que atender.
  let mejorables = 0
  if (M.edificios?.puedeMejorar) {
    for (const b of s.buildings || []) {
      if (b.enObra || b.mejorando) continue
      if (pedir('edificios', 'puedeMejorar', { ok: false }, b.id)?.ok) mejorables++
      if (mejorables >= 9) break
    }
  }
  fijarBadge('construir', mejorables)

  // Ejército: la cola vacía teniendo dónde entrenar es tiempo tirado.
  const cuarteles = (s.buildings || []).some(b => !b.enObra && ['cuartel', 'arqueria', 'establo', 'taller_asedio'].includes(b.tipo))
  fijarBadge('ejercito', cuarteles && !(s.ejercito?.cola || []).length ? 1 : 0)

  // Mundo: expediciones que ya han vuelto.
  const ahora = Date.now()
  fijarBadge('mundo', (s.expediciones || []).filter(e => e && e.vuelve <= ahora).length)

  // Encargos: recompensas por reclamar.
  const activas = pedir('encargos', 'activas', null)
  const porCobrar = Array.isArray(activas)
    ? activas.filter(q => q && (q.listo || q.completada) && !q.cobrada).length
    : ((s.quests?.activas || []).filter(q => q && (q.listo || q.completada) && !q.cobrada).length)
  fijarBadge('encargos', porCobrar)
}

const fijarBadge = (panel, n) => fijarBadgeNodo(nodos.badges?.[panel], n)

function fijarBadgeNodo (globo, n) {
  if (!globo) return
  if (!n) { globo.style.display = 'none'; return }
  const texto = n > 9 ? '9+' : String(n)
  if (globo.style.display === 'none') { globo.style.display = ''; latir(globo) }
  if (globo.textContent !== texto) { globo.textContent = texto; latir(globo) }
}

/* ===========================================================================
   Ficha del edificio seleccionado
   Todo lo importante sin hacer scroll: nivel, lo que produce, los aldeanos con
   sus + y −, y los tres botones (Mejorar, Mover, Demoler).
   =========================================================================== */

let fichaAbierta = null

function abrirFicha (id) {
  const b = (game.state.buildings || []).find(x => x.id === id)
  if (!b) return
  if (fichaAbierta?.id === id) return
  fichaAbierta?.panel.cerrar()

  const d = defEdificio(b.tipo)
  const cuerpo = el('div', { clase: 'col' })
  const panel = hoja({
    titulo: d?.nombre || 'Edificio',
    contenido: cuerpo,
    alCerrar: () => {
      refrescadores.delete(pintar)
      // si entre medias se abrió la ficha de OTRO edificio, esta ya no manda:
      // avisar de "nada seleccionado" cerraría la hoja recién abierta
      if (fichaAbierta?.id !== id) return
      fichaAbierta = null
      events.emit(EV.UI_SELECT, { kind: null, id: null })
    }
  })

  // Rehacer la ficha 4 veces por segundo se comería los toques y el scroll:
  // solo se reconstruye cuando cambia algo de verdad; entre medias, el reloj.
  let firma = null
  const pintar = () => {
    const vivo = (game.state.buildings || []).find(x => x.id === id)
    if (!vivo) { panel.cerrar(); return }
    const nueva = firmaDe(vivo)
    if (nueva === firma) { cuerpo._tic?.(); return }
    firma = nueva
    vaciar(cuerpo)
    const caja = contenidoFicha(vivo, panel)
    cuerpo._tic = caja._tic
    cuerpo.appendChild(caja)
  }
  pintar()
  refrescadores.add(pintar)
  fichaAbierta = { id, panel }
  events.emit(EV.CAMERA_FOCUS, { x: b.x, z: b.z })
}

/** Lo que obliga a repintar la ficha entera. El tiempo no está: ese va aparte. */
function firmaDe (b) {
  const puede = pedir('edificios', 'puedeMejorar', { ok: false, motivo: '' }, b.id)
  return [
    b.nivel, !!b.enObra, !!b.mejorando, !!b.arruinado, Math.round(b.hp || 0),
    (b.trabajadores || []).length, (game.state.villagers || []).filter(v => !v.buildingId).length,
    puede.ok, puede.motivo
  ].join('|')
}

function contenidoFicha (b, panel) {
  const d = defEdificio(b.tipo)
  const nivel = Math.max(1, b.nivel || 1)
  const caja = el('div', { clase: 'col' })
  const enObra = !!(b.enObra || b.mejorando)

  // el nombre ya está en la cabecera de la hoja: aquí manda el nivel
  caja.appendChild(el('div', { clase: 'ficha-cab' }, [
    el('span', { clase: 'icono-gr', texto: d?.icono || '🏚️' }),
    el('div', { clase: 'col', estilo: { gap: '2px' } }, [
      el('div', { clase: 'titular', texto: b.nivel === 0 ? 'En construcción' : `Nivel ${nivel}${d?.maxNivel ? ` de ${d.maxNivel}` : ''}` }),
      d?.desc ? el('div', { clase: 'tenue pequeño', texto: d.desc }) : null
    ])
  ]))

  // --- obra en curso: cuenta atrás y acelerar ---
  if (enObra) {
    const total = Math.max(1, (d?.tiempo?.(b.nivel === 0 ? 1 : nivel + 1) || 1))
    const reloj = el('b', { clase: 'num' })
    const barra = barraProgreso(0)
    const acelera = el('button', {
      clase: 'btn btn-oro btn-gordo', type: 'button', estilo: { marginTop: '10px' },
      onclick: () => { pedir('edificios', 'acelerar', false, b.id); pintarRecursos(); pintarObras() }
    })
    caja._tic = () => {
      const restante = pedir('edificios', 'segundosRestantes', 0, b.id)
      reloj.textContent = formatoTiempo(restante)
      barra.fijar(Math.min(100, (1 - restante / total) * 100))
      acelera.textContent = `${ICONO.gemas} Terminar ya · ${pedir('edificios', 'costeAcelerar', 0, b.id)}`
    }
    caja._tic()
    caja.appendChild(el('div', { clase: 'panel', estilo: { padding: '10px' } }, [
      el('div', { clase: 'fila fila-sep' }, [
        el('b', { texto: b.nivel === 0 ? 'Construyendo…' : `Mejorando a nivel ${nivel + 1}` }),
        reloj
      ]),
      barra.nodo,
      acelera
    ]))
  }

  // --- los datos, en baldosas: caben cuatro donde antes cabían dos filas ---
  const plazas = typeof d?.plazas === 'function' ? d.plazas(nivel) : 0
  const prod = !enObra ? produccionDe(b.id) : null
  const baldosas = []

  if (d?.produce && typeof d.porMinuto === 'function') {
    baldosas.push(el('div', { clase: 'stat' }, [
      el('small', { texto: `Produce ${ICONO[d.produce] || ''}` }),
      el('b', {
        clase: `ritmo ${tonoRitmo(prod ? prod.porHora : 0)}`,
        texto: enObra ? '—' : porHora(prod ? prod.porHora : d.porMinuto(nivel) * 60)
      })
    ]))
  }
  if (plazas > 0) {
    const dentroAhora = (b.trabajadores || []).length
    baldosas.push(el('div', { clase: 'stat' }, [
      el('small', { texto: 'Puestos' }),
      el('b', { clase: dentroAhora < plazas ? 'ritmo-mal' : '', texto: `${dentroAhora} de ${plazas}` })
    ]))
  }
  if (typeof d?.poblacionMax === 'function') {
    baldosas.push(el('div', { clase: 'stat' }, [el('small', { texto: 'Población' }), el('b', { texto: `${ICONO.aldeano} ${d.poblacionMax(nivel)}` })]))
  }
  if (typeof d?.obrasSimultaneas === 'function') {
    baldosas.push(el('div', { clase: 'stat' }, [el('small', { texto: 'Obras a la vez' }), el('b', { texto: `🔨 ${d.obrasSimultaneas(nivel)}` })]))
  }
  if (typeof d?.dano === 'function') {
    baldosas.push(el('div', { clase: 'stat' }, [el('small', { texto: 'Daño' }), el('b', { texto: `⚔️ ${formatoNumero(d.dano(nivel))}` })]))
  }
  if (typeof d?.exploradores === 'function') {
    baldosas.push(el('div', { clase: 'stat' }, [el('small', { texto: 'Batidores' }), el('b', { texto: `🐎 ${d.exploradores(nivel)}` })]))
  }
  if (typeof d?.capacidad === 'function') {
    const extra = d.capacidad(nivel) || {}
    const partes = CONFIG.RECURSOS.filter(r => extra[r]).map(r => `${ICONO[r]}${formatoNumero(extra[r])}`)
    if (partes.length) baldosas.push(el('div', { clase: 'stat' }, [el('small', { texto: 'Guarda' }), el('b', { texto: partes.join(' ') })]))
  }
  if (typeof d?.aloja === 'function') {
    baldosas.push(el('div', { clase: 'stat' }, [el('small', { texto: 'Camas' }), el('b', { texto: `${ICONO.aldeano} ${d.aloja(nivel)}` })]))
  }
  if (b.hpMax) {
    const roto = b.hp < b.hpMax
    baldosas.push(el('div', { clase: 'stat' }, [
      el('small', { texto: 'Resistencia' }),
      el('b', { clase: roto ? 'ritmo-mal' : '', texto: `${formatoNumero(Math.round(b.hp || 0))} / ${formatoNumero(b.hpMax)}` })
    ]))
  }
  if (baldosas.length) caja.appendChild(el('div', { clase: 'stats' }, baldosas))

  // --- aldeanos asignados: los + y − son lo que más se toca de la ficha ---
  if (plazas > 0) {
    const dentro = (b.trabajadores || []).length
    const libres = (game.state.villagers || []).filter(v => !v.buildingId).length
    caja.appendChild(el('div', { clase: 'ficha-gente' }, [
      el('button', {
        clase: 'btn btn-piedra', type: 'button', texto: '−', 'aria-label': 'Quitar aldeano',
        disabled: dentro <= 0,
        onclick: () => {
          const ultimo = (b.trabajadores || [])[dentro - 1]
          if (ultimo) pedir('aldeanos', 'desasignar', false, ultimo)
        }
      }),
      el('div', { clase: 'ficha-gente-num' }, [
        el('span', { texto: `${ICONO.aldeano} ${dentro} / ${plazas}` }),
        el('small', { texto: libres ? `${libres} sin oficio` : 'nadie libre' })
      ]),
      el('button', {
        clase: 'btn btn-oro', type: 'button', texto: '+', 'aria-label': 'Asignar aldeano',
        disabled: dentro >= plazas || libres <= 0,
        onclick: () => {
          const libre = (game.state.villagers || []).find(v => !v.buildingId)
          if (!libre) { toast('No hay aldeanos libres: construye una casa.', 'mal'); return }
          pedir('aldeanos', 'asignar', false, libre.id, b.id)
        }
      })
    ]))
  }

  // --- acciones ---
  const acciones = el('div', { clase: 'ficha-acciones' })
  const puede = pedir('edificios', 'puedeMejorar', { ok: false, motivo: 'No se puede mejorar' }, b.id)
  const costeSig = pedir('edificios', 'costeMejorar', null, b.id)

  if (!enObra) {
    acciones.appendChild(el('button', {
      clase: 'btn btn-oro btn-gordo ancho', type: 'button',
      estilo: { flexDirection: 'column', gap: '2px' },
      disabled: !puede.ok,
      onclick: () => { if (pedir('edificios', 'mejorar', false, b.id)) { pintarRecursos(); pintarObras() } }
    }, [
      el('div', { texto: `⬆️ Mejorar a nivel ${nivel + 1}` }),
      costeSig ? el('div', { clase: 'pequeño', html: costeHTML({ ...costeSig, tiempo: d?.tiempo?.(nivel + 1) }) }) : null
    ]))
    if (!puede.ok && puede.motivo) {
      acciones.appendChild(el('div', { clase: 'tenue pequeño ancho', estilo: { textAlign: 'center' }, texto: puede.motivo }))
    }
  }

  acciones.appendChild(el('button', {
    clase: 'btn btn-piedra', type: 'button', texto: '✋ Mover',
    onclick: () => { panel.cerrar(); empezarMover(b.id) }
  }))

  acciones.appendChild(el('button', {
    clase: 'btn btn-peligro', type: 'button', texto: '💥 Demoler',
    disabled: b.tipo === 'ayuntamiento',
    onclick: async () => {
      const si = await confirmar({
        titulo: '¿Demoler?',
        texto: `${d?.nombre || 'El edificio'} desaparece y recuperas la mitad de lo invertido.`,
        si: 'Demoler', peligro: true
      })
      if (!si) return
      if (pedir('edificios', 'demoler', false, b.id)) panel.cerrar()
    }
  }))

  if (b.arruinado || (b.hpMax && b.hp < b.hpMax)) {
    acciones.appendChild(el('button', {
      clase: 'btn btn-oro ancho', type: 'button',
      html: `🛠️ Reparar ${costeHTML(pedir('edificios', 'costeReparar', null, b.id) || {})}`,
      onclick: () => pedir('edificios', 'reparar', false, b.id)
    }))
  }

  caja.appendChild(acciones)
  return caja
}

/** Modo traslado: lo arrastra render/, y el toque en el tablero también vale. */
let cancelarMover = null
function empezarMover (id) {
  cancelarMover?.()
  const b = (game.state.buildings || []).find(x => x.id === id)
  if (!b) return
  // `moviendoId` es lo que mira el render para dejar arrastrar la pieza;
  // `moviendo` se mantiene por compatibilidad con lo que ya escuchaba.
  events.emit(EV.BUILD_MODE, { activo: true, tipo: b.tipo, moviendoId: b.id, moviendo: b.id, ancho: b.ancho, alto: b.alto })
  const aviso = toast('Arrastra el edificio o toca dónde quieres ponerlo', 'info', 6000)

  const quitar = events.on(EV.GRID_TAP, ({ x, z }) => {
    const centrado = { x: Math.round(x - ((b.ancho || 2) - 1) / 2), z: Math.round(z - ((b.alto || 2) - 1) / 2) }
    if (pedir('edificios', 'mover', false, id, centrado.x, centrado.z)) cancelarMover?.()
  })

  cancelarMover = () => {
    quitar()
    aviso?.()
    events.emit(EV.BUILD_MODE, { activo: false })
    cancelarMover = null
  }
}

/* ===========================================================================
   Avisos: bienvenida, alarma y celebraciones
   =========================================================================== */

function carteDeBienvenida ({ segundos = 0, textos = [], recursos = {} } = {}) {
  const lista = (textos && textos.length)
    ? textos
    : Object.entries(recursos).filter(([, n]) => n > 0).map(([r, n]) => `${ICONO[r]} ${formatoNumero(n)}`)
  if (!lista.length) return

  const panel = hoja({
    titulo: 'Mientras no estabas',
    contenido: el('div', { clase: 'col', estilo: { textAlign: 'center' } }, [
      el('div', { clase: 'tenue', texto: `Has estado fuera ${formatoTiempo(segundos)}. Tu gente no ha parado:` }),
      el('div', { clase: 'fila', estilo: { flexWrap: 'wrap', justifyContent: 'center', gap: '10px', fontSize: '1.3em', fontWeight: '800', margin: '8px 0' } },
        lista.map(t => el('span', { clase: 'chip chip-oro', texto: t })))
    ]),
    pie: el('button', {
      clase: 'btn btn-oro btn-gordo', type: 'button', texto: '🤝 Recoger',
      onclick: () => { panel.cerrar(); toast('¡A seguir construyendo!', 'bien'); events.emit(EV.SFX, { nombre: 'monedas' }) }
    })
  })
}

function pintarAlarma () {
  if (!alarma) return
  const restante = Math.max(0, (alarma.cuando - Date.now()) / 1000)
  alarma.reloj.textContent = formatoTiempo(restante)
  if (restante <= 0 && Date.now() - alarma.cuando > 4000) quitarAlarma()
}

function mostrarAlarma ({ enemigo, llegaEn = 0 } = {}) {
  quitarAlarma()
  const reloj = el('b', { texto: formatoTiempo(llegaEn) })
  const nodo = el('div', { clase: 'hud-alarma', onclick: () => events.emit(EV.UI_PANEL, { panel: 'ejercito' }) }, [
    el('span', { clase: 'icono-gr', texto: '⚔️' }),
    el('div', { clase: 'col', estilo: { gap: '0' } }, [
      el('div', { texto: '¡TE ATACAN!' }),
      el('div', { clase: 'pequeño', texto: enemigo?.nombre || 'Fuerzas enemigas se acercan' })
    ]),
    el('span', { clase: 'crece' }),
    reloj
  ])
  raiz().appendChild(nodo)
  raiz().classList.add('alarmado')
  alarma = { nodo, reloj, cuando: Date.now() + llegaEn * 1000 }
}

function quitarAlarma () {
  alarma?.nodo.remove()
  alarma = null
  raiz().classList.remove('alarmado')
}

let fiesta = null
function celebrar (icono, titulo, texto) {
  fiesta?.remove()
  const nodo = el('div', { clase: 'hud-fiesta' },
    el('div', { clase: 'panel fiesta-carta' }, [
      el('span', { clase: 'icono-gr', texto: icono }),
      el('h3', { texto: titulo }),
      texto ? el('p', { texto }) : null
    ]))
  raiz().appendChild(nodo)
  fiesta = nodo
  setTimeout(() => { if (fiesta === nodo) { nodo.remove(); fiesta = null } }, 2600)
}

/* ===========================================================================
   Ajustes
   =========================================================================== */

/**
 * Único punto donde el HUD escribe en `game.state`, y solo en `ajustes`:
 * son preferencias del jugador (sonido, calidad), no simulación, y ni audio.js
 * ni scene.js exponen otra manera de cambiarlas: las leen de aquí en cada tick.
 */
function ajustar (clave, valor) {
  const a = game.state.ajustes || (game.state.ajustes = {})
  a[clave] = valor
  events.emit(EV.SFX, { nombre: 'toque' })
}

function abrirAjustes () {
  const cuerpo = el('div', { clase: 'col' })
  const panel = hoja({ titulo: 'Ajustes', contenido: cuerpo })

  const pintar = () => {
    const a = game.state.ajustes || {}
    vaciar(cuerpo)

    const interruptor = (clave, icono, etiqueta) => el('div', { clase: 'fila fila-sep' }, [
      el('b', { texto: `${icono} ${etiqueta}` }),
      el('button', {
        clase: ['btn', a[clave] !== false ? 'btn-oro' : 'btn-piedra'], type: 'button',
        texto: a[clave] !== false ? 'Sí' : 'No',
        estilo: { minWidth: '84px' },
        onclick: () => { ajustar(clave, a[clave] === false); pintar() }
      })
    ])

    cuerpo.appendChild(interruptor('sonido', '🔊', 'Sonido'))
    cuerpo.appendChild(interruptor('musica', '🎵', 'Música'))
    cuerpo.appendChild(el('div', { clase: 'separador' }))

    cuerpo.appendChild(el('b', { texto: '🎨 Calidad gráfica' }))
    cuerpo.appendChild(el('div', { clase: 'pestañas' },
      [['auto', 'Automática'], ['alto', 'Alta'], ['medio', 'Media'], ['bajo', 'Baja']].map(([id, texto]) =>
        el('button', {
          clase: ['pestaña', (a.calidad || 'auto') === id && 'activa'], type: 'button', texto,
          onclick: () => { ajustar('calidad', id); pintar(); toast('Calidad cambiada', 'info') }
        }))))

    cuerpo.appendChild(el('div', { clase: 'separador' }))
    cuerpo.appendChild(el('b', { texto: '💾 Tu partida' }))
    cuerpo.appendChild(el('div', { clase: 'col' }, [
      el('button', { clase: 'btn btn-piedra btn-gordo', type: 'button', texto: '📤 Exportar partida', onclick: exportarPartida }),
      el('button', { clase: 'btn btn-piedra btn-gordo', type: 'button', texto: '📥 Importar partida', onclick: () => importarPartida(panel) }),
      el('button', { clase: 'btn btn-peligro btn-gordo', type: 'button', texto: '🗑️ Borrar partida', onclick: () => borrarPartida(panel) })
    ]))

    cuerpo.appendChild(el('div', {
      clase: 'tenue pequeño', estilo: { marginTop: '10px', textAlign: 'center' },
      texto: `${CONFIG.NOMBRE} · ${AGE_NOMBRE[game.state.age] || ''} · v${CONFIG.VERSION}`
    }))
  }

  pintar()
}

function exportarPartida () {
  let codigo = ''
  try { codigo = guardado.exportar() } catch { toast('No se ha podido exportar', 'mal'); return }
  const campo = el('textarea', {
    readonly: true, valor: codigo,
    estilo: { width: '100%', minHeight: '120px', fontSize: '.75em', borderRadius: '12px', padding: '8px', border: '2px solid var(--madera)' }
  })
  campo.value = codigo
  const panel = hoja({
    titulo: 'Copia de tu partida',
    contenido: el('div', { clase: 'col' }, [
      el('p', { clase: 'tenue pequeño', texto: 'Guarda este texto donde quieras. Pegándolo en «Importar» recuperas la partida tal cual.' }),
      campo
    ]),
    pie: el('button', {
      clase: 'btn btn-oro btn-gordo', type: 'button', texto: '📋 Copiar',
      onclick: async () => {
        try { await navigator.clipboard.writeText(codigo); toast('Copiado', 'bien') }
        catch { campo.select(); toast('Selecciónalo y cópialo a mano', 'info') }
        panel.cerrar()
      }
    })
  })
}

function importarPartida (ajustes) {
  const campo = el('textarea', {
    placeholder: 'Pega aquí el código de tu partida',
    estilo: { width: '100%', minHeight: '120px', fontSize: '.75em', borderRadius: '12px', padding: '8px', border: '2px solid var(--madera)' }
  })
  const panel = hoja({
    titulo: 'Importar partida',
    contenido: el('div', { clase: 'col' }, [
      el('p', { clase: 'tenue pequeño', texto: 'Esto sustituye tu partida actual. No hay vuelta atrás.' }),
      campo
    ]),
    pie: el('button', {
      clase: 'btn btn-oro btn-gordo', type: 'button', texto: 'Importar',
      onclick: async () => {
        const texto = campo.value.trim()
        if (!texto) { toast('Pega antes el código', 'mal'); return }
        if (!await confirmar({ titulo: '¿Seguro?', texto: 'Tu partida actual se perderá.', si: 'Importar', peligro: true })) return
        try {
          guardado.importar(texto)
          events.emit(EV.STATE_LOADED, { state: game.state, offlineSeconds: 0 })
          panel.cerrar(); ajustes?.cerrar()
          pintarRecursos(true); pintarObras(); pintarBadges(); pintarConsejo()
          toast('Partida importada', 'bien')
        } catch { toast('Ese código no vale', 'mal') }
      }
    })
  })
}

async function borrarPartida (ajustes) {
  if (!await confirmar({ titulo: '¿Borrar la partida?', texto: 'Se pierde toda la aldea, el ejército y el progreso.', si: 'Borrar', peligro: true })) return
  if (!await confirmar({ titulo: 'De verdad, ¿seguro?', texto: 'Esto no tiene arreglo. Se empieza de cero.', si: 'Sí, borrar todo', peligro: true })) return
  try { guardado.borrarPartida() } catch { /* daba igual: se recarga de todas formas */ }
  ajustes?.cerrar()
  toast('Partida borrada. Empezamos de nuevo…', 'info')
  setTimeout(() => location.reload(), 900)
}

/* ===========================================================================
   Eventos
   =========================================================================== */

let pendienteRecursos = false

function conectarEventos () {
  // Como mucho 4 refrescos por segundo: en móvil, repintar de más se nota.
  events.on(EV.RESOURCES_CHANGED, () => {
    if (pendienteRecursos) return
    pendienteRecursos = true
    setTimeout(() => { pendienteRecursos = false; pintarRecursos() }, 250)
  })

  events.on(EV.OFFLINE_RESUMEN, carteDeBienvenida)
  events.on(EV.ATTACK_INCOMING, (p) => { if (!p?.resuelto) mostrarAlarma(p) })
  events.on(EV.DEFENSE_RESOLVED, quitarAlarma)
  events.on(EV.RAID_RESOLVED, ({ victoria, botin } = {}) => {
    if (!victoria) return
    const texto = botin ? Object.entries(botin).filter(([, n]) => n > 0).map(([r, n]) => `${ICONO[r]} ${formatoNumero(n)}`).join('  ') : ''
    celebrar('🏆', '¡Victoria!', texto)
  })

  events.on(EV.LEVEL_UP, ({ nivel, gemas } = {}) => {
    celebrar('⭐', `¡Nivel ${nivel}!`, gemas ? `+${gemas} ${ICONO.gemas}` : '')
    pintarRecursos()
  })
  events.on(EV.AGE_ADVANCED, ({ age } = {}) => celebrar('🏰', '¡Nueva edad!', AGE_NOMBRE[age] || ''))
  events.on(EV.QUEST_COMPLETED, ({ quest, recompensa } = {}) => {
    const premio = recompensa ? Object.entries(recompensa).filter(([k, v]) => v > 0 && k !== 'xp').map(([k, v]) => `${ICONO[k] || ''} ${v}`).join('  ') : ''
    celebrar('📜', quest?.titulo || 'Encargo cumplido', premio)
    pintarBadges(); pintarConsejo()
  })

  events.on(EV.UI_SELECT, (p) => {
    if (p?.kind === 'building' && p.id) abrirFicha(p.id)
    else if (!p?.kind) { fichaAbierta?.panel.cerrar(); fichaAbierta = null }
  })
  events.on(EV.UI_PANEL, (p) => {
    if (p?.panel === 'edificio' && p.datos?.id) abrirFicha(p.datos.id)
    else if (p?.panel === 'produccion' || p?.panel === 'economia') abrirEconomia(p.datos?.recurso || null)
  })

  events.on(EV.VISTA_CAMBIADA, (p) => { if (p?.vista) { vistaActual = p.vista; pintarVista() } })
  pintarVista()

  // si otro módulo apaga el modo construcción, el traslado se da por terminado
  events.on(EV.BUILD_MODE, (p) => { if (p && p.activo === false && cancelarMover) { const f = cancelarMover; cancelarMover = null; f() } })

  // cambios que alteran lo que enseña el HUD: se repinta ya, sin esperar al latido
  for (const ev of [EV.BUILD_PLACED, EV.BUILD_COMPLETED, EV.BUILD_UPGRADED, EV.BUILD_DEMOLISHED, EV.UNIT_TRAINED, EV.TECH_RESEARCHED, EV.SCOUT_RETURNED]) {
    events.on(ev, () => { pintarObras(); pintarBadges(); pintarConsejo() })
  }
  events.on(EV.VILLAGER_ASSIGNED, () => pintarRecursos())
  events.on(EV.VILLAGER_SPAWNED, () => pintarRecursos())
  events.on(EV.STATE_LOADED, () => { pintarRecursos(true); pintarObras(); pintarBadges(); pintarConsejo() })
}

export default { init }
