/**
 * PANEL DEL MUNDO: la pata de "explorar", contada para que se entienda.
 *
 * El problema que resuelve este fichero: mandabas a un explorador y no sabías
 * qué estabas haciendo. Ahora hay cuatro momentos, y cada uno dice lo suyo:
 *
 *   1. ANTES  — la ficha de la casilla ("qué es esto") y el PLAN del explorador
 *               ("Sancho irá a Peña Cuervo, tarda 12 min y puede traer piedra").
 *   2. FUERA  — una tira fija en pantalla, siempre visible, con quién está fuera,
 *               de dónde vuelve y cuánto le queda; y el muñeco andando por el mapa.
 *   3. VUELTA — el pergamino narrado, con LO QUE TRAE y LO QUE DESCUBRE destacados.
 *   4. DE UN VISTAZO — la pestaña "Fuera" con todo lo que hay en marcha y el
 *               historial de informes, más una leyenda del mapa.
 *
 * No escribe en game.state: todo pasa por world/map.js, world/expeditions.js y
 * world/enemies.js. Si alguno falta, el panel lo dice y no se rompe.
 */
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { ICONO } from '../core/config.js'
import { EDIFICIOS } from '../data/buildings.js'
import * as UI from './styles.js'
import * as Mapa from '../world/map.js'
import * as Expediciones from '../world/expeditions.js'
import * as Enemigos from '../world/enemies.js'
import * as Imperio from '../world/imperio.js'

const { el, hoja, formatoNumero, formatoTiempo, costeHTML, chip, barraProgreso, pestañas, badge, vaciar } = UI

/** Llama a otro módulo sin que un fallo suyo se lleve el panel por delante. */
function pedir (mod, nombre, args = [], alt = null) {
  const f = mod && mod[nombre]
  if (typeof f !== 'function') return alt
  try { return f(...args) } catch (err) { console.warn(`[world-panel] ${nombre} falló`, err); return alt }
}

const MISIONES = Expediciones.MISIONES || {
  explorar: { nombre: 'Explorar', icono: '🧭', desc: 'Levantar la niebla.' },
  recolectar: { nombre: 'Recolectar', icono: '🎒', desc: 'Traerse lo que dé.' },
  espiar: { nombre: 'Espiar', icono: '👁️', desc: 'Contar cuántos son.' },
  saquear: { nombre: 'Saquear', icono: '🗡️', desc: 'Un pellizco rápido.' }
}

/** En una frase y sin jerga: qué hace exactamente cada misión. */
const QUE_HACE = {
  explorar: 'Va, mira y vuelve con el mapa. Quita la niebla de esa zona y apunta lo que encuentre.',
  recolectar: 'Va al yacimiento, carga todo lo que pueda a la espalda y te lo trae a la aldea.',
  espiar: 'Se acerca sin que le vean y vuelve con el plano del rival: muros, torres y cuánta gente tiene.',
  saquear: 'Le roba un pellizco al rival sin dar batalla. Rápido, pero es lo que más sustos da.'
}

const ORDEN_MISIONES = ['explorar', 'recolectar', 'espiar', 'saquear']

// ---------------------------------------------------------------- estado ---

let panel = null
let nav = null              // las pestañas, para que la marcada sea la que se ve
let solapa = 'casilla'
let casilla = null         // { x, y } la que se está mirando
let relojes = []
let latido = 0
let pergaminoAbierto = null
let planAbierto = null
let enMundo = false

const reloj = (fn) => { relojes.push(fn); try { fn() } catch { /* da igual */ } }
/** Decimales como en español: 2.2 -> 2,2. */
const coma = (v) => String(v).replace('.', ',')
const hayCampamento = () => (pedir(Expediciones, 'nivelCampamento', [], 0) || 0) > 0
const casaMundo = () => game.state.world?.casa || Mapa.MUNDO?.CASA || { x: 8, y: 8 }

/** Recuerdos de la interfaz (no son partida: van al navegador, no a game.state). */
function recordado (clave) { try { return localStorage.getItem(`baluarte.${clave}`) } catch { return null } }
function recordar (clave, valor = '1') { try { localStorage.setItem(`baluarte.${clave}`, valor) } catch { /* modo incógnito */ } }

// ================================================================ ESTILOS ==
/**
 * styles.js manda en el lenguaje visual; aquí solo se coloca lo que es exclusivo
 * del mundo: la tira fija de expediciones y los botones de acción de la ficha.
 * Se inyecta aparte (como hace el HUD con los suyos) para no pisar a nadie.
 */
const CSS = `
/* ---------- tira fija: quién está fuera, siempre a la vista ---------- */
.mundo-tira {
  position: fixed; z-index: 16;
  top: calc(var(--seg-arriba) + var(--alto-top, 112px) + 4px);
  left: calc(var(--seg-izq) + 8px);
  width: min(56vw, 216px);
  display: flex; flex-direction: column; gap: 6px;
  pointer-events: none;
}
.mundo-tira > * { pointer-events: auto; }
.mundo-fila {
  display: flex; align-items: center; gap: 7px;
  width: 100%; min-height: 48px; padding: 5px 8px;
  font: inherit; text-align: left; color: var(--tinta);
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 2px solid var(--madera); border-radius: var(--r-m);
  box-shadow: var(--sombra-suave);
  animation: pop var(--medio) var(--curva) both;
}
.mundo-fila:active { transform: translateY(2px); box-shadow: none; }
.mundo-fila > i { flex: none; font-style: normal; font-size: 1.25em; line-height: 1; }
.mundo-fila-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.mundo-fila-cab { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.mundo-fila-txt b { font-size: .82em; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* la cuenta atrás no se recorta nunca: es el dato por el que se mira la tira */
.mundo-fila-txt u { flex: none; font-size: .78em; font-weight: 800; text-decoration: none; color: var(--oro-oscuro); font-variant-numeric: tabular-nums; white-space: nowrap; }
.mundo-fila-txt small { font-size: .72em; font-weight: 700; color: var(--tinta-suave); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mundo-fila .barra-progreso { height: 9px; margin-top: 4px; }
.mundo-fila.aviso-informe { background-image: linear-gradient(180deg, var(--oro-claro), var(--oro)); border-color: var(--oro-oscuro); }
/* La chuleta del mapa: un botón REDONDO y pequeño en la esquina de arriba a la
   izquierda, debajo del marcador. Antes era una barra de texto ancha que se
   plantaba sobre el valle; ahora es solo el icono, y lo que hace lo dice su
   etiqueta accesible. */
.mundo-ayuda {
  align-self: flex-start;
  width: 40px; height: 40px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.2em; line-height: 1; border-radius: 50%;
  opacity: .8;
}
.mundo-ayuda:active { opacity: 1; }

/* ---------- botón de acción de la ficha de casilla ---------- */
.acciones { display: flex; flex-direction: column; gap: 8px; }
.accion {
  display: flex; align-items: center; gap: 10px;
  width: 100%; min-height: 64px; padding: 9px 12px;
  font: inherit; text-align: left; color: var(--tinta); cursor: pointer;
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 3px solid var(--madera); border-radius: var(--r-m);
  box-shadow: var(--sombra-suave), var(--brillo);
}
.accion:active { transform: translateY(3px); box-shadow: none; }
.accion > i { flex: none; font-style: normal; font-size: 1.7em; line-height: 1; width: 34px; text-align: center; }
.accion-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.accion-txt b { font-size: 1em; font-weight: 800; }
.accion-txt small { font-size: .76em; font-weight: 700; color: var(--tinta-suave); line-height: 1.25; }
.accion-datos { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: .74em; font-weight: 800; font-variant-numeric: tabular-nums; }
.accion-datos span { white-space: nowrap; }
.accion > em { flex: none; font-style: normal; font-size: 1.3em; color: var(--madera); }
.accion.lista { border-color: var(--oro-oscuro); background-image: linear-gradient(180deg, #fff6de, var(--pergamino)); }
.accion.no { filter: grayscale(.7); opacity: .62; cursor: default; }
.accion.no:active { transform: none; box-shadow: var(--sombra-suave); }
.accion-motivo { margin: -2px 0 0 44px; font-size: .76em; font-weight: 800; color: var(--rojo-oscuro); line-height: 1.25; }

/* ---------- el plan: lo que va a pasar, antes de que pase ---------- */
.plan-frase { font-size: 1.02em; line-height: 1.5; margin: 0; }
.plan-linea { display: flex; align-items: flex-start; gap: 9px; padding: 7px 0; }
.plan-linea + .plan-linea { border-top: 1px dashed rgba(90, 58, 34, .3); }
.plan-linea > i { flex: none; font-style: normal; font-size: 1.3em; line-height: 1.2; }
.plan-linea > div { flex: 1; min-width: 0; }
.plan-linea b { display: block; font-size: .72em; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--tinta-suave); }
.plan-linea span { font-size: .95em; font-weight: 700; line-height: 1.35; }

/* ---------- pergamino: el botín y los hallazgos, bien gordos ---------- */
.botin { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.botin-item {
  display: flex; flex-direction: column; align-items: center; gap: 1px;
  min-width: 74px; padding: 8px 10px;
  background-image: linear-gradient(180deg, #fff6de, var(--pergamino-oscuro));
  border: 2px solid var(--oro-oscuro); border-radius: var(--r-m);
  box-shadow: var(--sombra-suave);
}
.botin-item i { font-style: normal; font-size: 1.5em; line-height: 1; }
.botin-item b { font-size: 1.15em; font-weight: 800; font-variant-numeric: tabular-nums; }
.botin-item small { font-size: .68em; font-weight: 800; text-transform: uppercase; color: var(--tinta-suave); }
.hallazgo { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; font-size: .88em; line-height: 1.35; font-weight: 700; }
.hallazgo + .hallazgo { border-top: 1px dashed rgba(90, 58, 34, .3); }
.hallazgo > i { flex: none; font-style: normal; font-size: 1.15em; }

/* ---------- leyenda ---------- */
.leyenda { display: flex; flex-direction: column; gap: 2px; }
.leyenda-fila { display: flex; align-items: center; gap: 10px; padding: 8px 0; }
.leyenda-fila + .leyenda-fila { border-top: 1px dashed rgba(90, 58, 34, .3); }
.leyenda-fila > i { flex: none; font-style: normal; font-size: 1.5em; width: 34px; text-align: center; }
.leyenda-fila > div { flex: 1; min-width: 0; font-size: .84em; line-height: 1.3; }
.leyenda-fila b { display: block; font-weight: 800; }
.leyenda-fila small { color: var(--tinta-suave); font-weight: 700; }
`

function inyectarEstilos () {
  if (document.getElementById('estilos-mundo')) return
  const nodo = document.createElement('style')
  nodo.id = 'estilos-mundo'
  nodo.textContent = CSS
  document.head.appendChild(nodo)
}

const raizHud = () => document.getElementById('hud') || document.body

// ================================================================ APERTURA ==

export function init () {
  inyectarEstilos()
  montarTira()

  events.on(EV.UI_PANEL, (p = {}) => {
    if (p.panel === 'mundo' || p.panel === 'world') {
      if (p.datos && Number.isFinite(p.datos.x)) casilla = { x: p.datos.x, y: p.datos.y }
      abrir(p.datos)
    } else if (p.panel === null && panel) panel.cerrar()
  })

  // tocar una casilla del mapa 3D abre su ficha directamente
  events.on(EV.UI_SELECT, (p = {}) => {
    if (!p || (p.kind !== 'worldtile' && p.kind !== 'tile')) return
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return
    casilla = { x: p.x, y: p.y }
    solapa = 'casilla'
    if (panel) pintar(); else abrir()
  })

  events.on(EV.SCOUT_RETURNED, (p = {}) => {
    if (panel) pintar()
    refrescarTira()
    const inf = p.informe || p.hallazgo
    if (inf && !pergaminoAbierto) abrirPergamino(inf, p.expedicion)
  })

  events.on(EV.SCOUT_SENT, () => { if (panel) pintar(); refrescarTira() })
  events.on(EV.WORLD_REVEALED, () => { if (panel && solapa !== 'casilla') pintar() })

  // la tira se refresca al ritmo de la simulación, sin temporizador propio
  let acumulado = 0
  events.on(EV.TICK, (p = {}) => {
    acumulado += p.dt || 0.25
    if (acumulado < 1) return
    acumulado = 0
    refrescarTira()
  })

  // la primera vez que se asoma al valle, dos frases explicando para qué sirve
  events.on(EV.VISTA_CAMBIADA, (p = {}) => {
    enMundo = p?.vista === 'mundo'
    refrescarTira()
    if (enMundo && !recordado('mundo.bienvenida')) setTimeout(abrirBienvenida, 400)
  })
}

function abrir (datos = {}) {
  if (panel) { if (datos?.solapa) { solapa = datos.solapa; pintar() } return }
  solapa = datos?.solapa || (casilla ? 'casilla' : 'sugerencias')

  nav = pestañas([
    { id: 'casilla', texto: 'Aquí' },
    { id: 'curso', texto: 'Fuera' },
    { id: 'sugerencias', texto: 'A dónde ir' },
    { id: 'leyenda', texto: 'Leyenda' }
  ], (id) => { solapa = id; pintar() })

  const cuerpo = el('div', { clase: 'col' })
  panel = hoja({
    titulo: '🗺️ El valle',
    clase: 'hoja-mundo',
    contenido: [nav.nodo, cuerpo],
    alCerrar: () => { clearInterval(latido); latido = 0; relojes = []; panel = null; nav = null }
  })
  panel.zona = cuerpo
  nav.activar(solapa, false)
  latido = setInterval(() => { for (const f of relojes) { try { f() } catch { /* da igual */ } } }, 500)
  pintar()
}

function pintar () {
  if (!panel) return
  relojes = []
  nav?.activar(solapa, false)
  // la pestaña de "Fuera" lleva la cuenta de quién está de camino
  const cuantos = (pedir(Expediciones, 'enCurso', [], []) || []).length
  const sinLeer = (pedir(Expediciones, 'informesSinLeer', [], []) || []).length
  const pestañaFuera = nav?.nodo?.children?.[1]
  if (pestañaFuera) {
    pestañaFuera.textContent = sinLeer ? `Fuera 📜${sinLeer}` : cuantos ? `Fuera (${cuantos})` : 'Fuera'
  }
  const zona = vaciar(panel.zona)
  if (solapa === 'casilla') vistaCasilla(zona)
  else if (solapa === 'curso') vistaEnCurso(zona)
  else if (solapa === 'leyenda') vistaLeyenda(zona)
  else vistaSugerencias(zona)
}

// ======================================================= LA PRIMERA VEZ ====

/** Dos frases. Ni una más: si hace falta un tutorial, el mapa está mal hecho. */
function abrirBienvenida () {
  if (recordado('mundo.bienvenida')) return
  recordar('mundo.bienvenida')
  const h = hoja({
    titulo: '🗺️ El valle, en dos frases',
    contenido: el('div', { clase: 'col' }, [
      el('div', { clase: 'panel col' }, [
        el('div', { clase: 'titular', texto: 'Esto es lo que hay ahí fuera' }),
        el('div', { estilo: { lineHeight: '1.5' }, texto: 'Más allá de tu empalizada hay un valle tapado por la niebla, con yacimientos que puedes vaciar y señores rivales a los que puedes espiar o atacar.' }),
        el('div', { estilo: { lineHeight: '1.5' }, texto: 'Tú no vas: mandas exploradores desde el campamento. Tocas una casilla, eliges qué quieren que hagan allí, y cuando vuelven te traen carga y un informe de lo que han visto.' })
      ]),
      el('div', { clase: 'panel col' }, [
        el('div', { clase: 'pequeño', texto: '☁️ Lo tapado por nubes aún no lo ha pisado nadie.' }),
        el('div', { clase: 'pequeño', texto: '⛳ La cerca verde marca hasta dónde llegan hoy tus exploradores.' }),
        el('div', { clase: 'pequeño', texto: '🏴 Los castillos rojos son rivales; el cartel dice su nivel.' })
      ])
    ]),
    pie: el('button', {
      clase: 'btn btn-oro btn-gordo', type: 'button', texto: '👍 Entendido, a explorar',
      onclick: () => h.cerrar()
    })
  })
}

// =============================================== LA TIRA FIJA EN PANTALLA ==
/**
 * Lo que más dolía: mandabas a alguien y desaparecía. Esta tira no se va de la
 * pantalla mientras haya gente fuera, y dice de dónde vuelve cada uno y cuánto
 * le queda, sin abrir nada.
 */
let tira = null
const filasTira = new Map()   // id -> { nodo, nombre, detalle, barra }

function montarTira () {
  if (tira) return
  tira = el('div', { clase: 'mundo-tira' })
  raizHud().appendChild(tira)
  refrescarTira()
}

function refrescarTira () {
  if (!tira) return
  const fuera = pedir(Expediciones, 'enCurso', [], []) || []
  const sinLeer = pedir(Expediciones, 'informesSinLeer', [], []) || []

  // --- aviso de informes sin leer, siempre el primero ---
  let avisoNodo = tira.querySelector('.aviso-informe')
  if (sinLeer.length) {
    if (!avisoNodo) {
      avisoNodo = el('button', {
        clase: 'mundo-fila aviso-informe', type: 'button',
        onclick: () => {
          const e = (pedir(Expediciones, 'informesSinLeer', [], []) || [])[0]
          if (e) abrirPergamino(e.resultado, e)
        }
      }, [el('i', { texto: '📜' }), el('div', { clase: 'mundo-fila-txt' }, [
        el('b', { texto: 'Informe sin leer' }), el('small', { texto: 'toca para abrirlo' })
      ])])
      tira.insertBefore(avisoNodo, tira.firstChild)
    }
    const b = avisoNodo.querySelector('b')
    if (b) b.textContent = sinLeer.length === 1 ? 'Informe sin leer' : `${sinLeer.length} informes sin leer`
  } else if (avisoNodo) {
    avisoNodo.remove()
  }

  // --- una fila por explorador fuera ---
  const vivos = new Set(fuera.map(e => e.id))
  for (const [id, f] of filasTira) {
    if (vivos.has(id)) continue
    f.nodo.remove(); filasTira.delete(id)
  }
  for (const e of fuera) {
    let f = filasTira.get(e.id)
    if (!f) {
      const nombre = el('b', { clase: 'crece', texto: e.aldeanoNombre || 'Un explorador' })
      const cuanto = el('u', {})                 // el tiempo NUNCA se recorta: es el dato
      const detalle = el('small', {})
      const barra = barraProgreso(0, { clase: 'quieta' })
      const nodo = el('button', {
        clase: 'mundo-fila', type: 'button',
        onclick: () => { solapa = 'curso'; if (panel) pintar(); else abrir({ solapa: 'curso' }) }
      }, [
        el('i', { texto: (MISIONES[e.mision] || {}).icono || '🧭' }),
        el('div', { clase: 'mundo-fila-txt' }, [
          el('div', { clase: 'mundo-fila-cab' }, [nombre, cuanto]),
          detalle,
          barra.nodo
        ])
      ])
      tira.appendChild(nodo)
      f = { nodo, nombre, cuanto, detalle, barra }
      filasTira.set(e.id, f)
    }
    f.nombre.textContent = e.aldeanoNombre || 'Un explorador'
    f.cuanto.textContent = e.restante > 0 ? formatoTiempo(e.restante) : 'ya'
    f.detalle.textContent = frasePequeña(e)
    f.barra.fijar((e.pct || 0) * 100)
  }

  // --- la chuleta del mapa, solo cuando se está mirando el valle ---
  let ayuda = tira.querySelector('.mundo-ayuda')
  if (enMundo) {
    if (!ayuda) {
      ayuda = el('button', {
        clase: 'btn btn-piedra mundo-ayuda', type: 'button', texto: '🗺️',
        onclick: () => { solapa = 'leyenda'; if (panel) pintar(); else abrir({ solapa: 'leyenda' }) }
      })
      ayuda.setAttribute('aria-label', '¿Qué es cada cosa? Abrir la leyenda del mapa')
      ayuda.title = '¿Qué es cada cosa?'
      tira.appendChild(ayuda)
    } else {
      tira.appendChild(ayuda)      // siempre la última
    }
  } else if (ayuda) {
    ayuda.remove()
  }
}

/** "vuelve de Peña Cuervo", que es lo otro que el jugador quiere saber. */
function frasePequeña (e) {
  if (e.curandose) return 'curándose en casa'
  if (e.restante <= 0) return 'llegando a la empalizada'
  return `${Date.now() < e.llega ? 'va a' : 'vuelve de'} ${e.destinoNombre}`
}

// ============================================================== 1. CASILLA ==

/** El parte del explorador: lo que se ve desde el camino, contado con gracia. */
function narrar (x, y, tile, nodo, enemigo, riqueza, dist) {
  const visto = pedir(Mapa, 'visible', [x, y], true)
  const frases = []
  if (!visto) {
    frases.push('Nadie de la aldea ha llegado nunca tan lejos. En el mapa hay un borrón de tinta y la palabra "niebla".')
    return frases.join(' ')
  }
  const bioma = Mapa.BIOMAS?.[tile?.bioma]?.nombre || 'tierra rara'
  const lejos = dist < 2 ? 'a un paso de la empalizada' : dist < 4.5 ? 'a media mañana de camino' : dist < 7 ? 'lejos, ya fuera de lo conocido' : 'en el confín del valle'
  frases.push(`${bioma} ${lejos}.`)
  if (nodo) {
    if (nodo.agotado || nodo.restante <= 0) frases.push(`Hubo aquí ${nodo.nombre.toLowerCase()}, pero está exprimido: hay que dejar que se rehaga.`)
    else frases.push(`${nodo.nombre}: quedan unos ${formatoNumero(nodo.restante)} de ${nodo.recurso || 'algo que no sabemos nombrar'}.`)
  }
  if (enemigo) {
    frases.push(enemigo.derrotado
      ? `Aquí estaba ${enemigo.nombre}. Lo que queda son cenizas y perros. Volverán a levantarlo.`
      : `Cuidado: aquí acampa ${enemigo.nombre} (${enemigo.titulo}). ${enemigo.amenaza || ''}`)
  }
  if (!nodo && !enemigo) {
    frases.push(riqueza && riqueza.nodos
      ? `Aquí no hay nada que coger, pero alrededor sí: ${riqueza.texto}.`
      : 'Ni un alma, ni un filón, ni una piedra que merezca el viaje. Buen sitio para pasar la noche.')
  } else if (riqueza && riqueza.total > 0) {
    frases.push(`En la comarca hay ${riqueza.texto}.`)
  }
  return frases.join(' ')
}

function rumboDe (x, y) {
  const casa = casaMundo()
  const dx = x - casa.x, dy = y - casa.y
  if (!dx && !dy) return 'tu propia aldea'
  const v = Math.abs(dy) > Math.abs(dx) * 1.8 ? (dy < 0 ? 'norte' : 'sur')
    : Math.abs(dx) > Math.abs(dy) * 1.8 ? (dx < 0 ? 'oeste' : 'este')
      : (dy < 0 ? (dx < 0 ? 'noroeste' : 'noreste') : (dx < 0 ? 'suroeste' : 'sureste'))
  return `al ${v}`
}

/**
 * DE QUIÉN ES Y SI LA ALCANZAS. En el mapa eso se ve por el color de la mancha
 * y por el marco dorado; aquí se dice con palabras, que es lo que se lee bien.
 */
function chipsDeBandera (x, y) {
  const fuera = []
  const casa = casaMundo()
  const dueño = pedir(Imperio, 'dueñoDe', [x, y], null)
  const propia = x === casa.x && y === casa.y

  if (propia) fuera.push(chip('🏰', 'tu aldea', { tono: 'bien' }))
  else if (dueño === 'jugador') {
    const plaza = pedir(Imperio, 'plazaEn', [x, y], null)
    fuera.push(chip('🚩', plaza ? `plaza tuya · nivel ${plaza.nivel || 1}` : 'tuya', { tono: 'bien' }))
  } else if (dueño) fuera.push(chip('🏴', 'de un señor rival', { tono: 'mal' }))
  else fuera.push(chip('⚪', 'tierra de nadie', {}))

  if (!propia && dueño !== 'jugador') {
    const a = pedir(Imperio, 'alcanzable', [x, y], null)
    if (a) fuera.push(chip(a.ok ? '⚔️' : '🚫', a.ok ? 'la alcanzas ya' : 'fuera de tu alcance',
      { tono: a.ok ? 'bien' : '' }))
  }
  return fuera
}

function vistaCasilla (zona) {
  if (!casilla) {
    zona.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'titular', texto: 'No has elegido ninguna casilla' }),
      el('div', { clase: 'tenue', estilo: { lineHeight: '1.4' }, texto: 'Toca cualquier casilla del mapa del valle y aquí te digo qué hay y qué puedes hacer allí.' }),
      el('button', { clase: 'btn btn-oro btn-gordo', type: 'button', texto: '✨ ¿A dónde voy?', onclick: () => { solapa = 'sugerencias'; pintar() } })
    ]))
    return
  }

  const { x, y } = casilla
  const tile = pedir(Mapa, 'tileEn', [x, y], null)
  const nodo = pedir(Mapa, 'nodoEn', [x, y], null)
  const enemigo = pedir(Enemigos, 'enemigoEn', [x, y], null)
  const riqueza = pedir(Mapa, 'riquezaZona', [x, y, 2], null)
  const dist = pedir(Mapa, 'distanciaACasa', [x, y], 0) || 0
  const visto = pedir(Mapa, 'visible', [x, y], true)
  const casa = casaMundo()
  const eventos = (pedir(Mapa, 'eventosVivos', [], []) || []).filter(e => e.x === x && e.y === y)

  const nombre = visto ? (tile?.nombre || 'Tierra sin nombre') : 'La niebla'

  // --- ficha ---
  zona.appendChild(el('div', { clase: 'panel col' }, [
    el('div', { clase: 'fila fila-sep' }, [
      el('span', { clase: 'titular', texto: nombre }),
      el('span', { clase: 'pequeño tenue', texto: `${x},${y}` })
    ]),
    el('div', { clase: 'fila', estilo: { flexWrap: 'wrap' } }, [
      chip('🧭', rumboDe(x, y), {}),
      chip('📏', `${coma(dist.toFixed(1))} casillas`, {}),
      visto ? chip('🌍', Mapa.BIOMAS?.[tile?.bioma]?.nombre || 'tierra rara', {}) : chip('☁️', 'sin explorar', {}),
      nodo ? chip(Mapa.TIPOS_NODO?.[nodo.tipo]?.icono || '⛏️', nodo.nombre, { tono: nodo.agotado ? '' : 'bien' }) : null,
      enemigo ? chip('🏴', enemigo.derrotado ? 'en ruinas' : enemigo.vasallo ? 'vasallo tuyo' : `nivel ${enemigo.nivel}`, { tono: enemigo.derrotado || enemigo.vasallo ? '' : 'mal' }) : null,
      // lo que antes flotaba en carteles encima del mapa vive aquí: de quién es
      // la comarca y si la tienes a tiro
      ...(visto ? chipsDeBandera(x, y) : [])
    ]),
    el('div', { clase: 'pequeño', estilo: { lineHeight: '1.4' }, texto: `📜 ${narrar(x, y, tile, nodo, enemigo, riqueza, dist)}` }),
    ...eventos.map(ev => el('div', { clase: 'pequeño', texto: `⚡ ${ev.texto || 'Algo se mueve por aquí.'}` }))
  ]))

  if (x === casa.x && y === casa.y) {
    zona.appendChild(el('div', { clase: 'panel tenue', texto: 'Esta es tu aldea. De aquí salen los exploradores y aquí vuelven: no hace falta mandar a nadie a explorarla.' }))
    return
  }

  // --- sin campamento no hay expediciones ---
  if (!hayCampamento()) {
    zona.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'titular', texto: 'No tienes quien vaya' }),
      el('div', { clase: 'pequeño', estilo: { lineHeight: '1.4' }, texto: `Las expediciones salen del ${EDIFICIOS.campamento_explorador.nombre.toLowerCase()}: una hoguera, un mapa mal dibujado y gente con ganas. Sin él, el valle seguirá en la niebla.` }),
      el('button', {
        clase: 'btn btn-oro btn-gordo', type: 'button', texto: '🧭 Construir el campamento',
        onclick: () => { panel?.cerrar(); events.emit(EV.UI_PANEL, { panel: 'construir', datos: { tipo: 'campamento_explorador', categoria: 'militar' } }) }
      })
    ]))
    return
  }

  zona.appendChild(bloqueAcciones(x, y, nodo, enemigo))
}

// ------------------------------------------ qué puedo hacer aquí (botones) ---

/** Lo que se puede sacar de esa casilla con esa misión, en una frase. */
function premioDe (mision, nodo, enemigo) {
  if (mision === 'explorar') return 'Quita la niebla de esta zona y apunta en el mapa lo que haya.'
  if (mision === 'recolectar') {
    if (!nodo || !nodo.recurso) return 'Aquí no hay yacimiento que recoger.'
    if (nodo.agotado || nodo.restante <= 0) return 'La tierra está exprimida: hay que esperar a que se rehaga.'
    const carga = pedir(Expediciones, 'capacidadCarga', [], 0) || 0
    return `Hasta ${formatoNumero(Math.min(nodo.restante, carga))} de ${nodo.recurso} a la espalda.`
  }
  if (mision === 'espiar') return enemigo ? `El parte completo de ${enemigo.nombre}: muros, torres y guarnición.` : 'No hay base enemiga que espiar aquí.'
  return enemigo ? `Un pellizco de lo que guarde ${enemigo.nombre}, sin dar batalla.` : 'Un pellizco de lo que haya por el camino. Sale bien… casi siempre.'
}

const CARA_RIESGO = { seguro: '🙂', moderado: '😐', peligroso: '💀' }

function bloqueAcciones (x, y, nodo, enemigo) {
  const caja = el('div', { clase: 'panel col' })
  caja.appendChild(el('div', { clase: 'titular', texto: '¿Qué hago aquí?' }))
  caja.appendChild(el('div', { clase: 'pequeño tenue', texto: 'Toca lo que quieras que hagan y te enseño el plan antes de que salga nadie.' }))

  const lista = el('div', { clase: 'acciones' })
  for (const id of ORDEN_MISIONES) {
    const m = MISIONES[id]
    if (!m) continue
    lista.appendChild(botonAccion(id, m, x, y, nodo, enemigo))
  }

  // atacar no es cosa del explorador: es el ejército, pero se ofrece aquí igual
  lista.appendChild(botonAtacar(enemigo))
  caja.appendChild(lista)
  return caja
}

function botonAccion (id, m, x, y, nodo, enemigo) {
  const seg = pedir(Expediciones, 'tiempoDe', [x, y, id], 0) || 0
  const coste = pedir(Expediciones, 'costeDe', [x, y, id], { comida: 0 }) || {}
  const riesgo = pedir(Expediciones, 'riesgoDe', [x, y, id], null)
  const permiso = pedir(Expediciones, 'puedeEnviar', [{ x, y, mision: id }], { ok: false, motivo: 'No disponible' }) || {}

  const datos = el('div', { clase: 'accion-datos' }, [
    el('span', { texto: `${ICONO.tiempo} ${formatoTiempo(seg)} ida y vuelta` }),
    el('span', { texto: `${ICONO.comida} ${formatoNumero(coste.comida || 0)}` }),
    riesgo ? el('span', { texto: `${CARA_RIESGO[riesgo.nivel] || '😐'} ${riesgo.nivel}` }) : null
  ])

  const boton = el('button', {
    clase: ['accion', permiso.ok ? 'lista' : 'no'], type: 'button',
    disabled: !permiso.ok,
    onclick: () => { if (permiso.ok) abrirPlan(x, y, id) }
  }, [
    el('i', { texto: m.icono }),
    el('div', { clase: 'accion-txt' }, [
      el('b', { texto: m.nombre }),
      el('small', { texto: premioDe(id, nodo, enemigo) }),
      datos
    ]),
    permiso.ok ? el('em', { texto: '›' }) : null
  ])

  if (permiso.ok) return boton
  // sin poder, lo importante es POR QUÉ no y qué hacer para arreglarlo
  const envoltorio = el('div', { clase: 'col', estilo: { gap: '4px' } }, [
    boton,
    el('div', { clase: 'accion-motivo', texto: `🚫 ${permiso.motivo}` })
  ])
  const arreglo = solucionPara(permiso.motivo)
  if (arreglo) envoltorio.appendChild(arreglo)
  return envoltorio
}

function botonAtacar (enemigo) {
  const puede = !!enemigo && !enemigo.derrotado && !enemigo.vasallo
  const boton = el('button', {
    clase: ['accion', puede ? 'lista' : 'no'], type: 'button',
    disabled: !puede,
    onclick: () => {
      if (!puede) return
      panel?.cerrar()
      events.emit(EV.UI_PANEL, { panel: 'ejercito', datos: { solapa: 'atacar' } })
    }
  }, [
    el('i', { texto: '⚔️' }),
    el('div', { clase: 'accion-txt' }, [
      el('b', { texto: 'Atacar' }),
      el('small', {
        texto: puede
          ? `Asaltar a ${enemigo.nombre} con tu ejército y quedarte con lo que guarda.`
          : 'Los asaltos son con tropa, no con exploradores.'
      }),
      puede ? el('div', { clase: 'accion-datos' }, [el('span', { texto: `${ICONO.ejercito} abre el panel del ejército` })]) : null
    ]),
    puede ? el('em', { texto: '›' }) : null
  ])
  if (puede) return boton
  return el('div', { clase: 'col', estilo: { gap: '4px' } }, [
    boton,
    el('div', { clase: 'accion-motivo', texto: enemigo ? '🚫 Esa base ya no da guerra.' : '🚫 Aquí no hay ninguna base rival.' })
  ])
}

/** Cuando no se puede enviar, ofrecer la salida en vez de dejar al jugador colgado. */
function solucionPara (motivo = '') {
  const m = motivo.toLowerCase()
  if (m.includes('campamento')) {
    return el('button', {
      clase: 'btn btn-oro', type: 'button', texto: '🧭 Construir campamento',
      onclick: () => { panel?.cerrar(); events.emit(EV.UI_PANEL, { panel: 'construir', datos: { tipo: 'campamento_explorador' } }) }
    })
  }
  if (m.includes('exploradores libres') || m.includes('curando')) {
    return el('button', {
      clase: 'btn btn-piedra', type: 'button', texto: '🐾 Ver quién está fuera',
      onclick: () => { solapa = 'curso'; pintar() }
    })
  }
  if (m.includes('lejos')) {
    return el('div', { clase: 'pequeño tenue', texto: 'Sube el campamento de nivel: cada nivel alarga el alcance tres casillas.' })
  }
  if (m.includes('comida')) {
    return el('button', {
      clase: 'btn btn-piedra', type: 'button', texto: '🌾 Levantar una granja',
      onclick: () => { panel?.cerrar(); events.emit(EV.UI_PANEL, { panel: 'construir', datos: { tipo: 'granja', categoria: 'recursos' } }) }
    })
  }
  if (m.includes('aldeano')) {
    return el('div', { clase: 'pequeño tenue', texto: 'Todos tus aldeanos están ocupados. Libera a uno de su puesto o construye una casa más.' })
  }
  return null
}

// ==================================================== 2. EL PLAN DEL VIAJE ==
/**
 * La pantalla que faltaba: antes de que salga nadie, se cuenta con palabras
 * normales qué va a hacer, a dónde, cuánto tarda, qué se lleva, qué puede traer
 * y qué riesgo corre. Sin datos sueltos: frases.
 */
function abrirPlan (x, y, mision) {
  if (planAbierto) return
  const m = MISIONES[mision] || MISIONES.explorar
  const tile = pedir(Mapa, 'tileEn', [x, y], null)
  const nodo = pedir(Mapa, 'nodoEn', [x, y], null)
  const enemigo = pedir(Enemigos, 'enemigoEn', [x, y], null)
  const visto = pedir(Mapa, 'visible', [x, y], true)
  const dist = pedir(Mapa, 'distanciaACasa', [x, y], 0) || 0
  const seg = pedir(Expediciones, 'tiempoDe', [x, y, mision], 0) || 0
  const coste = pedir(Expediciones, 'costeDe', [x, y, mision], { comida: 0 }) || {}
  const riesgo = pedir(Expediciones, 'riesgoDe', [x, y, mision], null)
  const libres = pedir(Expediciones, 'plazasLibres', [], 0) || 0
  const plazas = pedir(Expediciones, 'plazas', [], 0) || 0

  const destino = visto ? (tile?.nombre || 'una tierra sin nombre') : `la niebla ${rumboDe(x, y).replace('al ', 'del ')}`
  const casillas = coma(dist.toFixed(1))
  const ida = formatoTiempo(Math.round(seg * 0.45))
  const total = formatoTiempo(seg)

  const cuerpo = el('div', { clase: 'col' })

  cuerpo.appendChild(el('div', { clase: 'panel col', estilo: { textAlign: 'center' } }, [
    el('div', { estilo: { fontSize: '2.4em', lineHeight: '1' }, texto: m.icono }),
    el('div', { clase: 'titular', texto: `${m.nombre} ${destino}` }),
    el('div', { clase: 'pequeño tenue', texto: `a ${casillas} casillas ${rumboDe(x, y)} de tu aldea` })
  ]))

  cuerpo.appendChild(el('div', { clase: 'panel' }, [
    el('p', { clase: 'plan-frase', texto: `Uno de tus exploradores sale de la empalizada hacia ${destino}. ${QUE_HACE[mision] || m.desc}` })
  ]))

  const lineas = el('div', { clase: 'panel' })
  lineas.appendChild(linea('⏱️', 'Cuánto tarda', `Unos ${ida} en llegar y otro tanto en volver: ${total} en total. Puedes cerrar el juego mientras tanto.`))
  lineas.appendChild(linea(ICONO.comida, 'Qué se lleva', `${formatoNumero(coste.comida || 0)} de comida para el camino. Se descuenta al salir.`))
  lineas.appendChild(linea('🎁', 'Qué puede traer', premioDe(mision, nodo, enemigo)))
  if (riesgo) {
    lineas.appendChild(linea(CARA_RIESGO[riesgo.nivel] || '😐', 'Qué riesgo corre',
      `${riesgo.texto} ${riesgo.pct} de cada 100 viajes dan algún susto, y ${coma(riesgo.pctPerdida)} de cada 100 acaban sin que vuelva.`))
  }
  const quedan = Math.max(0, libres - 1)
  lineas.appendChild(linea('🐾', 'Quién queda en casa',
    quedan === 0 ? `Es tu último explorador libre de ${plazas}: mientras esté fuera no podrás mandar a nadie más.`
      : quedan === 1 ? `Te quedará 1 explorador libre de ${plazas}.`
        : `Te quedarán ${quedan} exploradores libres de ${plazas}.`))
  cuerpo.appendChild(lineas)

  planAbierto = hoja({
    titulo: '🧭 El plan del explorador',
    clase: 'hoja-plan',
    contenido: cuerpo,
    alCerrar: () => { planAbierto = null },
    pie: el('div', { clase: 'col' }, [
      el('button', {
        clase: 'btn btn-oro btn-gordo', type: 'button', texto: `${m.icono} Sí, que salga`,
        onclick: () => {
          const exp = pedir(Expediciones, 'enviar', [{ x, y, mision }], null)
          planAbierto?.cerrar()
          if (!exp) return
          refrescarTira()
          solapa = 'curso'
          if (panel) pintar()
        }
      }),
      el('button', { clase: 'btn btn-piedra', type: 'button', texto: 'Mejor no', onclick: () => planAbierto?.cerrar() })
    ])
  })
}

function linea (icono, titulo, texto) {
  return el('div', { clase: 'plan-linea' }, [
    el('i', { texto: icono }),
    el('div', {}, [el('b', { texto: titulo }), el('span', { texto })])
  ])
}

// ============================================================ 3. EN CURSO ==

function vistaEnCurso (zona) {
  const fuera = pedir(Expediciones, 'enCurso', [], []) || []
  const sinLeer = pedir(Expediciones, 'informesSinLeer', [], []) || []
  const plazas = pedir(Expediciones, 'plazas', [], 0) || 0
  const libres = pedir(Expediciones, 'plazasLibres', [], 0) || 0

  if (sinLeer.length) {
    zona.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'fila fila-sep' }, [
        el('span', { clase: 'titular', texto: '📜 Informes sin leer' }),
        badge(sinLeer.length, { suelto: true })
      ]),
      ...sinLeer.map(e => el('button', {
        clase: 'btn btn-oro btn-gordo', type: 'button', texto: `Leer: ${e.resultado?.titulo || e.destinoNombre}`,
        onclick: () => abrirPergamino(e.resultado, e)
      }))
    ]))
  }

  if (hayCampamento()) {
    zona.appendChild(el('div', { clase: 'panel fila fila-sep' }, [
      el('span', {
        clase: 'pequeño',
        texto: !fuera.length ? 'Todos tus exploradores están en casa'
          : fuera.length === 1 ? 'Tienes un explorador fuera'
            : `Tienes ${fuera.length} exploradores fuera`
      }),
      chip('🐾', `${libres}/${plazas} libres`, { tono: libres ? 'bien' : 'mal' })
    ]))
  }

  if (!fuera.length) {
    zona.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'titular', texto: 'No hay nadie fuera' }),
      el('div', { clase: 'tenue', estilo: { lineHeight: '1.4' }, texto: hayCampamento() ? 'Todos los exploradores están en la aldea, aburridos y comiéndose el grano.' : 'Sin campamento de exploradores no sale nadie de la empalizada.' }),
      el('button', { clase: 'btn btn-oro btn-gordo', type: 'button', texto: '✨ ¿A dónde los mando?', onclick: () => { solapa = 'sugerencias'; pintar() } })
    ]))
  }

  for (const e of fuera) {
    const m = MISIONES[e.mision] || { icono: '🧭', nombre: e.mision }
    const barra = barraProgreso((e.pct || 0) * 100, { gorda: true, tono: e.curandose ? 'mal' : '' })
    const etiqueta = el('div', { clase: 'pequeño', estilo: { fontWeight: '800' }, texto: fraseGrande(e) })
    const caja = el('div', { clase: 'tarjeta col' }, [
      el('div', { clase: 'fila fila-sep' }, [
        el('span', { clase: 'tarjeta-nombre', texto: `${m.icono} ${e.aldeanoNombre || 'Un explorador'}` }),
        chip('🎯', m.nombre, {})
      ]),
      el('div', { clase: 'tarjeta-detalle', texto: `${QUE_HACE[e.mision] || ''}` }),
      etiqueta,
      barra.nodo
    ])

    if (!e.curandose) {
      caja.appendChild(el('button', {
        clase: 'btn btn-piedra', type: 'button', texto: `💎 Que vuelva ya (${e.costeAcelerar || 1})`,
        onclick: () => { if (pedir(Expediciones, 'acelerar', [e.id], false)) { pintar(); refrescarTira() } }
      }))
    }

    reloj(() => {
      const vivos = pedir(Expediciones, 'enCurso', [], []) || []
      const yo = vivos.find(v => v.id === e.id)
      if (!yo) { pintar(); return }
      barra.fijar((yo.pct || 0) * 100)
      etiqueta.textContent = fraseGrande(yo)
    })
    zona.appendChild(caja)
  }

  // --- lo que ya volvió: releer un informe viejo es media diversión ---
  const viejos = (pedir(Expediciones, 'informes', [], []) || []).filter(e => e.leido)
  if (viejos.length) {
    zona.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'titular', texto: '📚 Informes de antes' }),
      ...viejos.slice(0, 6).map(e => el('button', {
        clase: 'dato', type: 'button',
        onclick: () => abrirPergamino(e.resultado, e)
      }, [
        el('i', { texto: (MISIONES[e.mision] || {}).icono || '🧭' }),
        el('div', { clase: 'dato-txt' }, [
          el('span', { texto: e.resultado?.titulo || e.destinoNombre }),
          el('small', { texto: `${e.aldeanoNombre || 'un explorador'} · ${e.destinoNombre}` })
        ]),
        el('b', { texto: '›' })
      ]))
    ]))
  }
}

/** La frase de dentro del panel, con sujeto y verbo: "Sancho vuelve de X en 12 min". */
function fraseGrande (e) {
  const quien = e.aldeanoNombre || 'Tu explorador'
  if (e.curandose) return `${quien} está curándose en casa. Vuelve a estar listo en ${formatoTiempo(e.restante)}.`
  if (e.restante <= 0) return `${quien} está entrando por la puerta.`
  const yendo = Date.now() < e.llega
  return yendo
    ? `${quien} va de camino a ${e.destinoNombre}. Llega en ${formatoTiempo(Math.max(0, Math.round((e.llega - Date.now()) / 1000)))} y vuelve en ${formatoTiempo(e.restante)}.`
    : `${quien} vuelve de ${e.destinoNombre} en ${formatoTiempo(e.restante)}.`
}

// ========================================================= 4. SUGERENCIAS ==

function vistaSugerencias (zona) {
  if (!hayCampamento()) {
    zona.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'titular', texto: 'Primero, el campamento' }),
      el('div', { clase: 'pequeño', texto: 'Sin campamento de exploradores no hay a quién mandar ni mapa que levantar.' }),
      el('button', {
        clase: 'btn btn-oro btn-gordo', type: 'button', texto: '🧭 Construir el campamento',
        onclick: () => { panel?.cerrar(); events.emit(EV.UI_PANEL, { panel: 'construir', datos: { tipo: 'campamento_explorador' } }) }
      })
    ]))
    return
  }

  const lista = pedir(Expediciones, 'sugerencias', [], []) || []
  if (!lista.length) {
    zona.appendChild(el('div', { clase: 'panel tenue', texto: 'El explorador se encoge de hombros: por ahora no hay nada que merezca el viaje. Vuelve cuando descubras más valle.' }))
    return
  }

  zona.appendChild(el('div', { clase: 'pequeño tenue', texto: 'Lo que haría el viejo explorador si mandase él:' }))
  for (const s of lista) {
    const m = MISIONES[s.mision] || { icono: '🧭', nombre: s.mision }
    const seg = pedir(Expediciones, 'tiempoDe', [s.x, s.y, s.mision], 0) || 0
    const coste = pedir(Expediciones, 'costeDe', [s.x, s.y, s.mision], {}) || {}
    zona.appendChild(el('div', { clase: 'tarjeta col' }, [
      el('div', { clase: 'fila fila-sep' }, [
        el('span', { clase: 'tarjeta-nombre', texto: s.titulo }),
        chip(m.icono, m.nombre, {})
      ]),
      el('div', { clase: 'tarjeta-detalle', estilo: { lineHeight: '1.35' }, texto: s.motivo }),
      el('div', { clase: 'fila', estilo: { flexWrap: 'wrap' } }, [
        chip(ICONO.tiempo, formatoTiempo(seg), {}),
        chip(ICONO.comida, formatoNumero(coste.comida || 0), {}),
        chip(CARA_RIESGO[s.riesgo] || '😐', s.riesgo, { tono: s.riesgo === 'seguro' ? 'bien' : s.riesgo === 'peligroso' ? 'mal' : '' })
      ]),
      el('div', { clase: 'fila', estilo: { gap: '8px' } }, [
        el('button', {
          clase: 'btn btn-oro crece', type: 'button', texto: `${m.icono} Ver el plan`,
          onclick: () => abrirPlan(s.x, s.y, s.mision)
        }),
        el('button', {
          clase: 'btn btn-piedra crece', type: 'button', texto: '🔎 Qué hay',
          onclick: () => { casilla = { x: s.x, y: s.y }; solapa = 'casilla'; pintar() }
        })
      ])
    ]))
  }
}

// ============================================================= 5. LEYENDA ==

const LEYENDA = [
  ['🎨', 'Comarcas pintadas', 'El color de la casilla es la bandera que ondea en ella: el tuyo en lo que has tomado, el de cada señor rival en lo suyo. Lo que no lleva color no es de nadie todavía.'],
  ['⚔️', 'Marco dorado', 'Esa comarca la alcanzas AHORA: toca tu frontera. Sin marco, primero hay que acercar la frontera tomando algo por el camino.'],
  ['🚩', 'Torreones con aro de oro', 'Plazas tuyas. Producen para ti cada minuto y te sirven de trampolín para llegar a la siguiente comarca.'],
  ['🏰', 'Tu aldea', 'El centro del valle, con su aro de oro. De aquí sale y aquí vuelve cada expedición.'],
  ['☁️', 'Nubarrones', 'Ahí no ha pisado nadie. Manda a alguien a explorar y la niebla se levanta.'],
  ['⛳', 'La cerca verde', 'Hasta ahí llegan hoy tus exploradores. Más lejos, ni con comida de sobra: sube el campamento de nivel.'],
  ['🌲', 'Fichas de colores', 'Yacimientos: madera, piedra, grano, oro o reliquias. El dibujo de la ficha dice de qué es; toca la casilla y abajo te cuento cuánto queda.'],
  ['⚫', 'Fichas grises y hundidas', 'Yacimiento exprimido. Con el tiempo se rehace solo.'],
  ['🏴', 'Castillos', 'Señores rivales. El tejado lleva el color de su casa, para saber de quién es cada mancha del mapa.'],
  ['🤝', 'Castillos con rótulo verde', 'Rivales que ya han hincado la rodilla: son vasallos tuyos y te pagan tributo.'],
  ['🚶', 'Muñeco andando', 'Un explorador tuyo yendo o volviendo por su camino punteado.'],
  ['⚡', 'Señales doradas', 'Algo pasa ahí ahora mismo: una caravana, bandidos o un hallazgo. No dura para siempre.']
]

function vistaLeyenda (zona) {
  zona.appendChild(el('div', { clase: 'panel col' }, [
    el('div', { clase: 'titular', texto: 'Para qué sirve el mapa' }),
    el('div', { clase: 'pequeño', estilo: { lineHeight: '1.45' }, texto: 'El valle es de donde sacas lo que tu aldea no produce y donde están tus rivales. Tocas una casilla, eliges qué hacer allí y mandas a un explorador: él va, hace lo suyo y vuelve con carga y con un informe.' }),
    el('div', { clase: 'pequeño', estilo: { lineHeight: '1.45' }, texto: 'En el tablero solo hay cuatro rótulos como mucho, y siempre los de lo que te importa. Todo lo demás se cuenta aquí abajo: toca una casilla y su ficha te dice qué hay, de quién es y qué puedes hacer.' })
  ]))
  zona.appendChild(el('div', { clase: 'panel leyenda' },
    LEYENDA.map(([ico, nombre, texto]) => el('div', { clase: 'leyenda-fila' }, [
      el('i', { texto: ico }),
      el('div', {}, [el('b', { texto: nombre }), el('small', { texto })])
    ]))
  ))
}

// ============================================================ EL PERGAMINO ==

const TONO_INFORME = {
  exito: { icono: '🌟', titulo: 'Buenas noticias' },
  regular: { icono: '📜', titulo: 'Ha vuelto' },
  malo: { icono: '🩸', titulo: 'Malas noticias' },
  perdido: { icono: '🪦', titulo: 'No ha vuelto' }
}

const NOMBRE_RECURSO = { madera: 'Madera', piedra: 'Piedra', comida: 'Comida', oro: 'Oro', gemas: 'Gemas' }

/** El informe narrado. Es la recompensa de mandar gente fuera: se le da su sitio. */
function abrirPergamino (informe, expedicion) {
  if (!informe) return
  const t = TONO_INFORME[informe.tipo] || TONO_INFORME.regular
  const m = MISIONES[expedicion?.mision] || { icono: '🧭', nombre: 'Expedición' }

  const cuerpo = el('div', { clase: 'col' })

  cuerpo.appendChild(el('div', {
    clase: 'panel col',
    estilo: { textAlign: 'center', borderStyle: 'double', borderWidth: '4px' }
  }, [
    el('div', { estilo: { fontSize: '2.2em' }, texto: t.icono }),
    el('div', { clase: 'titular', texto: informe.titulo || t.titulo }),
    el('div', { clase: 'pequeño tenue', texto: `${m.icono} ${m.nombre} · ${expedicion?.destinoNombre || 'algún lugar'} · ${expedicion?.aldeanoNombre || 'un explorador'}` })
  ]))

  // --- LO QUE TRAE: lo primero después del titular, y bien gordo ---
  const recursos = informe.recursos || {}
  const trae = ['madera', 'piedra', 'comida', 'oro'].filter(r => (recursos[r] || 0) > 0)
  if (trae.length || informe.gemas > 0) {
    cuerpo.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'titular', texto: '🎒 Lo que trae en el zurrón' }),
      el('div', { clase: 'botin' }, [
        ...trae.map(r => el('div', { clase: 'botin-item' }, [
          el('i', { texto: ICONO[r] }),
          el('b', { texto: formatoNumero(recursos[r]) }),
          el('small', { texto: NOMBRE_RECURSO[r] })
        ])),
        informe.gemas > 0
          ? el('div', { clase: 'botin-item' }, [el('i', { texto: ICONO.gemas }), el('b', { texto: formatoNumero(informe.gemas) }), el('small', { texto: 'Gemas' })])
          : null
      ]),
      el('div', { clase: 'pequeño tenue', estilo: { textAlign: 'center' }, texto: 'Ya está descargado en tus almacenes.' })
    ]))
  } else {
    cuerpo.appendChild(el('div', { clase: 'panel', estilo: { textAlign: 'center' } }, [
      el('div', { clase: 'pequeño tenue', texto: '🎒 Vuelve con el zurrón vacío.' })
    ]))
  }

  // --- LO QUE DESCUBRE ---
  const hallazgos = informe.hallazgos || []
  if (informe.tilesNuevos || hallazgos.length) {
    cuerpo.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'titular', texto: '🗺️ Lo que apunta en el mapa' }),
      el('div', {},
        [
          informe.tilesNuevos
            ? el('div', { clase: 'hallazgo' }, [el('i', { texto: '☀️' }), el('div', { texto: `${informe.tilesNuevos} casillas nuevas fuera de la niebla. Ya se ven en el mapa del valle.` })])
            : null,
          ...hallazgos.map(h => el('div', { clase: 'hallazgo' }, [
            el('i', { texto: '📍' }),
            el('div', { texto: typeof h === 'string' ? h : (h.texto || h.nombre || '') })
          ]))
        ].filter(Boolean)
      )
    ]))
  }

  // --- lo que cuenta él, con sus palabras ---
  cuerpo.appendChild(el('div', {
    clase: 'panel',
    estilo: { lineHeight: '1.55', fontSize: '1.02em', fontStyle: 'italic' },
    texto: informe.texto || 'Volvió sin nada que contar, que también es una forma de volver.'
  }))

  if ((informe.sucesos || []).length) {
    cuerpo.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'titular', texto: 'Por el camino' }),
      ...informe.sucesos.map(s => el('div', { clase: 'hallazgo' }, [
        el('i', { texto: '•' }),
        el('div', { texto: s.texto || s.clave })
      ]))
    ]))
  }

  pergaminoAbierto = hoja({
    titulo: '📜 Parte de expedición',
    clase: 'hoja-pergamino',
    contenido: cuerpo,
    alCerrar: () => { pergaminoAbierto = null; refrescarTira(); if (panel) pintar() },
    pie: el('button', {
      clase: 'btn btn-oro btn-gordo', type: 'button', texto: 'Guardar el informe',
      onclick: () => pergaminoAbierto?.cerrar()
    })
  })

  if (expedicion?.id) pedir(Expediciones, 'marcarLeido', [expedicion.id], null)
  refrescarTira()
}

export default { init }
