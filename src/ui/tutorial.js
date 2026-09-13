/**
 * LOS PRIMEROS MINUTOS — la guía del mayordomo.
 *
 * El dueño del juego lo resumió en una frase: «es un poco complicado todo». Esto
 * es la respuesta. Tres decisiones que explican el fichero entero:
 *   1. NO inventa una lista de objetivos: los encargos ya están en sim/quests.js.
 *      Cada paso enseña UN gesto y enseña, debajo, el encargo que toca ahora.
 *   2. Un paso cada vez, y se pasa al siguiente con el EVENTO DE VERDAD
 *      (BUILD_COMPLETED, VILLAGER_ASSIGNED…), nunca con un "siguiente" de mentira.
 *   3. Jamás bloquea. La capa no recibe toques salvo en el propio globo; si el
 *      jugador se va a lo suyo, la guía espera callada y sigue cuando vuelve.
 *
 * Se guarda en `game.state.tutorial` (JSON puro: pasos hechos y si se saltó).
 */
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { el, toast } from './styles.js'

// Excepción pactada (la misma que usa build-panel.js): la interfaz PREGUNTA a la
// simulación por los encargos, y jamás los toca.
import * as ENCARGOS from '../sim/quests.js'

/** Llama a sim/ sin caerse si ese módulo no ha cargado. */
function seguro (fn, repuesto, ...args) {
  if (typeof fn !== 'function') return repuesto
  try { return fn(...args) } catch (err) { console.warn('[tutorial]', err); return repuesto }
}

const estado = () => game.state
const terminados = (tipo) => (estado().buildings || []).filter(b => b.tipo === tipo && !b.enObra)
const tropas = () => Object.values(estado().ejercito?.tropas || {}).reduce((a, n) => a + (n || 0), 0)
const libres = () => (estado().villagers || []).filter(v => !v.buildingId).length

/** Busca la diana en pantalla; si no está (panel cerrado), no pasa nada. */
const q = (sel) => document.querySelector(sel)
const pestañaPorTexto = (txt) => [...document.querySelectorAll('.pestaña')].find(b => b.textContent.includes(txt)) || null

/* ===========================================================================
   Los pasos: mover la cámara, construir, trabajar, mejorar, explorar, asaltar
   =========================================================================== */

/**
 * `cuando` decide si el paso tiene sentido AHORA (sin campamento no se manda a
 * nadie a explorar). `diana` devuelve el nodo a señalar, y `listo` el evento real
 * que lo da por hecho.
 */
const PASOS = [
  {
    id: 'mirar',
    texto: 'Bienvenido a vuestro baluarte, mi señor. Arrastrad el dedo por el valle para pasear la mirada; con dos dedos, acercáis y alejáis.',
    gesto: true
  },
  {
    id: 'taller',
    texto: 'Todo se levanta desde el taller. Tocad 🔨 Construir, ahí abajo.',
    diana: () => q('.hud-boton[aria-label="Construir"]'),
    evento: EV.UI_PANEL,
    cumple: (p) => p?.panel === 'construir' || p?.panel === 'taller'
  },
  {
    id: 'elegir',
    // la aldea nace ya con una serrería: si la tiene, la lección es la segunda
    texto: () => terminados('serreria').length
      ? 'Una sola serrería no da abasto, mi señor. Levantad otra: tocad su tarjeta.'
      : 'Esa de ahí es la serrería: convierte el bosque en vigas. Tocad su tarjeta.',
    // si la tarjeta no está a la vista, se señala la pestaña donde vive
    diana: () => q('[data-tipo="serreria"]') || pestañaPorTexto('Recursos'),
    evento: EV.BUILD_MODE,
    cumple: (p) => p?.activo && p?.tipo === 'serreria'
  },
  {
    id: 'colocar',
    texto: 'Tocad un claro de la aldea para elegir el sitio y confirmad con «Construir aquí».',
    diana: () => q('[data-tutorial="confirmar"]'),
    evento: EV.BUILD_PLACED,
    cumple: (p) => p?.building?.tipo === 'serreria'
  },
  {
    id: 'obra',
    texto: 'Los carpinteros ya están en ello. No hace falta que miréis, mi señor: la obra sigue aunque cerréis el juego.',
    evento: EV.BUILD_COMPLETED,
    espera: 3
  },
  {
    id: 'aldeano',
    texto: () => libres() > 0
      ? 'Una serrería sin nadie dentro no sierra nada. Tocad la serrería en la aldea y pulsad ＋ para mandarle un aldeano.'
      : 'No os queda gente libre, mi señor: entrad en otro edificio, sacad a uno con − y mandadlo a la serrería nueva con ＋.',
    diana: () => q('[aria-label="Asignar aldeano"]'),
    evento: EV.VILLAGER_ASSIGNED
  },
  {
    id: 'produccion',
    texto: 'Mirad arriba: la madera sube sola mientras ese hombre trabaje, y sigue subiendo con el juego cerrado.',
    diana: () => q('.res[aria-label="madera"]') || q('[aria-label="madera"]'),
    evento: EV.RESOURCE_GAINED,
    cumple: (p) => p?.tipo === 'madera',
    espera: 6            // el primer tronco llega en un suspiro: que dé tiempo a leerlo
  },
  {
    id: 'mejorar',
    texto: 'Subir un edificio rinde más que amontonar diez. Abrid 🔨 Construir, pestaña ⬆️ Mejorar, y veréis lo que gana cada uno.',
    diana: () => pestañaPorTexto('Mejorar') || q('.hud-boton[aria-label="Construir"]'),
    evento: EV.BUILD_UPGRADED
  },
  {
    id: 'explorar',
    texto: 'El valle está sin dibujar. Abrid 🗺️ Mundo y mandad un explorador a ver qué hay detrás del monte.',
    cuando: () => terminados('campamento_explorador').length > 0,
    diana: () => q('.hud-boton[aria-label="Mundo"]'),
    evento: EV.SCOUT_SENT
  },
  {
    id: 'asalto',
    texto: 'Ya tenéis tropa de sobra. Buscad una base vecina en 🗺️ Mundo y lanzad vuestro primer asalto: se vuelve con botín.',
    cuando: () => tropas() >= 4,
    diana: () => q('.hud-boton[aria-label="Mundo"]'),
    evento: EV.RAID_RESOLVED
  }
]

/* ===========================================================================
   Lo que se recuerda entre partidas
   =========================================================================== */

/** Único sitio donde esta pieza escribe en el estado, y es JSON puro. */
function memoria () {
  const s = estado()
  if (!s.tutorial || typeof s.tutorial !== 'object') s.tutorial = { hechos: [], saltado: false, cerrado: false }
  if (!Array.isArray(s.tutorial.hechos)) s.tutorial.hechos = []
  return s.tutorial
}

const hecho = (id) => memoria().hechos.includes(id)
function marcar (id) {
  const m = memoria()
  if (!m.hechos.includes(id)) m.hechos.push(id)
}

/** El paso que toca: el primero sin hacer que además tenga sentido ahora. */
function pasoActual () {
  const m = memoria()
  if (m.saltado) return null
  for (const p of PASOS) {
    if (hecho(p.id)) continue
    if (p.cuando && !p.cuando()) return null      // todavía no toca: la guía calla
    return p
  }
  return null
}

/** Si ya no queda paso pendiente en toda la lista, la guía ha terminado. */
const todoHecho = () => PASOS.every(p => hecho(p.id))

/* ===========================================================================
   Lo que se ve: el globo del mayordomo y el halo sobre el botón
   =========================================================================== */

// El halo late y la mano señala: eso pide fotogramas, y los fotogramas piden CSS.
// Es la única hoja de estilos fuera de ui/styles.js y vive y muere con esta guía.
const CSS = `
/* el selector lleva #hud a propósito: index.html pone "#hud > * { pointer-events:auto }"
   y sin esa fuerza la capa se tragaba TODOS los toques del juego */
#hud > .capa-guia, .capa-guia { position: fixed; inset: 0; z-index: 70; pointer-events: none; }
.guia-halo {
  position: absolute; border-radius: var(--r-m);
  /* blanco, no dorado: sobre un botón de oro un aro dorado no se ve */
  border: 3px solid #fff8e6;
  box-shadow: 0 0 0 4px rgba(212,164,55,.55), 0 0 0 9999px rgba(26,16,8,.28);
  animation: guia-late 1.4s ease-in-out infinite;
  transition: top .18s var(--curva), left .18s var(--curva), width .18s, height .18s;
}
.guia-mano { position: absolute; font-size: 1.9em; line-height: 1; filter: drop-shadow(0 2px 3px rgba(0,0,0,.5)); animation: guia-toca 1.4s ease-in-out infinite; }
.guia-globo {
  position: absolute; left: 10px; right: 10px;
  margin-left: var(--seg-izq); margin-right: var(--seg-der);
  pointer-events: auto;
  display: flex; gap: 10px; align-items: flex-start;
  padding: 11px 12px;
  color: var(--pergamino-claro);
  background-image: linear-gradient(180deg, var(--madera-clara), var(--madera));
  border: 3px solid var(--madera-oscura); border-radius: var(--r-g);
  box-shadow: var(--sombra-flotante);
  animation: guia-entra .28s var(--curva) both;
}
.guia-globo b { display: block; font-size: .92em; line-height: 1.35; font-weight: 700; }
.guia-cara { font-size: 1.7em; line-height: 1; flex: none; }
.guia-pie { display: flex; align-items: center; gap: 8px; margin-top: 7px; }
.guia-encargo { flex: 1; min-width: 0; font-size: .72em; font-weight: 800; color: var(--oro-claro); line-height: 1.25; }
.guia-saltar {
  flex: none; min-height: 48px; padding: 8px 16px;
  font: inherit; font-size: .72em; font-weight: 800;
  color: rgba(251,244,228,.85); background: rgba(0,0,0,.22);
  border: 2px dashed rgba(251,244,228,.45); border-radius: var(--r-max); cursor: pointer;
}
.guia-saltar:active { transform: scale(.97); }
@keyframes guia-late { 0%,100% { box-shadow: 0 0 0 4px rgba(212,164,55,.55), 0 0 0 9999px rgba(26,16,8,.28); } 50% { box-shadow: 0 0 0 12px rgba(212,164,55,.18), 0 0 0 9999px rgba(26,16,8,.28); } }
@keyframes guia-toca { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-5px,-7px); } }
@keyframes guia-entra { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .guia-halo, .guia-mano, .guia-globo { animation: none; } }
`

let capa = null, halo = null, mano = null, globo = null, textoNodo = null, encargoNodo = null, saltarBtn = null
let visible = null          // id del paso pintado
let desde = 0               // cuándo apareció: algunos pasos piden tiempo de lectura
let alPulsarSaltar = saltar // cambia en la despedida: un botón, dos cometidos
let bucle = 0

function montar () {
  if (capa) return
  if (!document.getElementById('estilos-guia')) {
    const hoja = document.createElement('style')
    hoja.id = 'estilos-guia'
    hoja.textContent = CSS
    document.head.appendChild(hoja)
  }
  capa = el('div', { clase: 'capa-guia' })
  halo = el('div', { clase: 'guia-halo', estilo: { display: 'none' } })
  mano = el('div', { clase: 'guia-mano', texto: '👆', estilo: { display: 'none' } })
  textoNodo = el('b')
  encargoNodo = el('span', { clase: 'guia-encargo' })
  alPulsarSaltar = saltar
  saltarBtn = el('button', { clase: 'guia-saltar', type: 'button', texto: 'Saltar guía', onclick: () => alPulsarSaltar() })
  globo = el('div', { clase: 'guia-globo' }, [
    el('span', { clase: 'guia-cara', texto: '🎩' }),
    el('div', { clase: 'crece' }, [textoNodo, el('div', { clase: 'guia-pie' }, [encargoNodo, saltarBtn])])
  ])
  capa.append(halo, mano, globo)
  ;(document.getElementById('hud') || document.body).appendChild(capa)
}

function desmontar () {
  capa?.remove()
  capa = null; halo = null; mano = null; globo = null; textoNodo = null; encargoNodo = null; saltarBtn = null
  visible = null
  if (bucle) { cancelAnimationFrame(bucle); bucle = 0 }
}

/** El encargo de la campaña en curso, tal cual lo cuenta el mayordomo. */
function lineaEncargo () {
  const lista = seguro(ENCARGOS.activas, []) || []
  const e = lista.find(x => x.clase === 'encargo') || lista[0]
  if (!e) return ''
  const p = e.progreso || { hecho: 0, total: 1 }
  if (e.listo) return `✅ «${e.titulo}» · cobradlo en 📜 Encargos`
  return `📜 ${e.titulo} · ${Math.min(p.hecho, p.total)}/${p.total}`
}

function pintar (paso) {
  montar()
  if (visible !== paso.id) {
    visible = paso.id
    desde = Date.now()
    const n = PASOS.indexOf(paso) + 1
    textoNodo.textContent = typeof paso.texto === 'function' ? paso.texto() : paso.texto
    globo.style.animation = 'none'; void globo.offsetWidth; globo.style.animation = ''
    saltarBtn.textContent = n === 1 ? 'Saltar guía' : 'Saltar'
  }
  const linea = lineaEncargo()
  if (encargoNodo.textContent !== linea) encargoNodo.textContent = linea
  colocar(paso)
}

/**
 * Pone el halo sobre la diana y el globo en la mitad LIBRE de la pantalla: si lo
 * que hay que tocar está abajo, el mayordomo habla arriba, y al revés. Nada tapa
 * a nada.
 */
function colocar (paso) {
  const diana = paso.diana ? paso.diana() : null
  const alto = window.innerHeight
  let centroDiana = alto          // sin diana, se supone abajo (el HUD)

  // un aro sobre un botón apagado solo despista: primero hay que hacer otra cosa
  const usable = diana && diana.isConnected && !diana.disabled
  if (usable) {
    const r = diana.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      const m = 7
      halo.style.display = 'block'
      halo.style.left = `${r.left - m}px`
      halo.style.top = `${r.top - m}px`
      halo.style.width = `${r.width + m * 2}px`
      halo.style.height = `${r.height + m * 2}px`
      mano.style.display = 'block'
      mano.style.left = `${Math.min(window.innerWidth - 40, r.right - 12)}px`
      // pegado al borde de abajo la mano se saldría de la pantalla: va encima
      mano.style.top = r.bottom > alto - 56 ? `${r.top - 34}px` : `${r.bottom - 6}px`
      centroDiana = r.top + r.height / 2
    }
  } else {
    halo.style.display = 'none'
    mano.style.display = 'none'
  }

  const barraAbajo = document.querySelector('.hud-abajo')
  const altoAbajo = barraAbajo ? barraAbajo.offsetHeight : 92
  if (centroDiana > alto * 0.5) {
    globo.style.bottom = ''
    globo.style.top = 'calc(var(--seg-arriba) + 104px)'
  } else {
    globo.style.top = ''
    globo.style.bottom = `${altoAbajo + 12}px`
  }
}

/** Refresca la posición mientras haya paso a la vista (los paneles se mueven). */
function seguirDiana () {
  if (bucle) return
  let n = 0
  const tic = () => {
    bucle = requestAnimationFrame(tic)
    if (!capa || !visible) return
    if ((n++ & 3) !== 0) return                  // cada 4 fotogramas basta
    const paso = PASOS.find(p => p.id === visible)
    if (paso) colocar(paso)
  }
  bucle = requestAnimationFrame(tic)
}

/* ===========================================================================
   El hilo: pintar, esperar el evento de verdad y encadenar
   =========================================================================== */

function repasar () {
  const m = memoria()
  if (m.saltado) { desmontar(); return }

  const paso = pasoActual()
  if (!paso) {
    if (todoHecho() && !m.cerrado) { despedida(); return }
    desmontar()                                   // aún no toca nada: silencio
    return
  }
  pintar(paso)
  seguirDiana()
}

/** El último globo: a partir de aquí manda el mayordomo de la barra de abajo. */
function despedida () {
  montar()
  visible = 'fin'
  const consejo = seguro(ENCARGOS.siguienteConsejo, '') || ''
  textoNodo.textContent = `Ya sabéis lo importante, mi señor. Desde ahora os hablo desde la cinta de abajo: ${consejo}`
  encargoNodo.textContent = ''          // el consejo ya lleva el encargo dentro
  saltarBtn.textContent = 'Entendido'
  halo.style.display = 'none'
  mano.style.display = 'none'
  const barraAbajo = document.querySelector('.hud-abajo')
  globo.style.top = ''
  globo.style.bottom = `${(barraAbajo ? barraAbajo.offsetHeight : 92) + 12}px`
  alPulsarSaltar = () => { memoria().cerrado = true; desmontar() }
}

function saltar () {
  const m = memoria()
  m.saltado = true
  desmontar()
  toast('Guía cerrada. El mayordomo sigue aconsejando desde la cinta de abajo.', 'info', 3200)
}

/**
 * Un paso cumplido: se anota, se avisa y se encadena el siguiente. Si el paso
 * pedía unos segundos de lectura y el juego se ha adelantado (la primera madera
 * entra al instante), se espera a que dé tiempo a leerlo.
 */
function cumplir (paso) {
  if (hecho(paso.id)) return
  const falta = (paso.espera || 0) * 1000 - (Date.now() - desde)
  if (falta > 0) {
    if (paso.esperando) return
    paso.esperando = true
    setTimeout(() => { paso.esperando = false; cumplir(paso) }, falta)
    return
  }
  marcar(paso.id)
  events.emit(EV.SFX, { nombre: 'toque' })
  repasar()
}

/* ===========================================================================
   Enganches
   =========================================================================== */

export function init () {
  // Un solo oyente por evento: cada uno mira si el paso a la vista lo esperaba.
  const eventos = new Set(PASOS.map(p => p.evento).filter(Boolean))
  for (const ev of eventos) {
    events.on(ev, (p) => {
      const paso = pasoActual()
      if (!paso || paso.evento !== ev) return
      if (paso.cumple && !paso.cumple(p)) return
      cumplir(paso)
    })
  }

  // El primer paso se cumple con el dedo, no con un evento del juego: se da por
  // hecho en cuanto el jugador arrastra de verdad sobre la aldea.
  let x0 = 0, y0 = 0, abajo = false
  const sobreEscena = (t) => !!(t && (t.closest?.('#escena') || t.tagName === 'CANVAS'))
  addEventListener('pointerdown', (e) => {
    if (!sobreEscena(e.target)) { abajo = false; return }
    abajo = true; x0 = e.clientX; y0 = e.clientY
  }, { passive: true, capture: true })
  addEventListener('pointermove', (e) => {
    if (!abajo) return
    if (Math.hypot(e.clientX - x0, e.clientY - y0) < 45) return
    abajo = false
    const paso = pasoActual()
    if (paso?.gesto) cumplir(paso)
  }, { passive: true, capture: true })
  addEventListener('pointerup', () => { abajo = false }, { passive: true, capture: true })

  // Los pasos que esperan a que la aldea crezca (explorar, asaltar) despiertan
  // solos; y la línea del encargo se refresca sin repintar el globo.
  let cuenta = 0
  events.on(EV.TICK, () => { if ((cuenta++ % 8) === 0) repasar() })

  // abrir o cerrar un panel mueve la diana: hay que recolocar ya, no en 2 s
  for (const ev of [EV.UI_PANEL, EV.UI_SELECT, EV.BUILD_MODE, EV.QUEST_COMPLETED, EV.STATE_LOADED]) {
    events.on(ev, () => repasar())
  }
  addEventListener('resize', () => { if (visible) repasar() }, { passive: true })

  repasar()

  // atajo de pruebas: baluarte.guia.reiniciar()
  if (typeof window !== 'undefined') {
    window.guia = {
      reiniciar: () => { game.state.tutorial = { hechos: [], saltado: false, cerrado: false }; repasar() },
      saltar,
      get paso () { return pasoActual()?.id || null }
    }
  }
}
