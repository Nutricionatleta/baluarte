/**
 * PANEL DE ENCARGOS — la pantalla del mayordomo.
 *
 * UNA COSA CADA VEZ. Al abrir, lo primero y más grande es el encargo en curso:
 * qué hay que hacer, cuánto llevas, qué te dan y un botón que te lleva a hacerlo.
 * Todo lo demás (los que vienen después, las diarias, los logros) va debajo o
 * en su pestaña, y en pequeño. Si el jugador tiene que leer, cierra el juego.
 *
 * Tres pestañas, porque son tres cosas distintas y mezclarlas confunde:
 *   Encargos → la cadena de la campaña, de uno en uno, con su Cobrar.
 *   Diarias  → las tres tareas del día y la racha.
 *   Logros   → las medallas y el avance de partida.
 *
 * Como el resto de la interfaz: no se toca `game.state`, todo se pide a
 * `sim/quests.js`. Si ese módulo no está, el panel lo dice y no se cae.
 */
import { events, EV } from '../core/events.js'
import { ICONO } from '../core/config.js'
import { game } from '../core/state.js'
import { EDIFICIOS } from '../data/buildings.js'
import { UNIDADES } from '../data/units.js'
import {
  el, vaciar, hoja, toast, formatoNumero, barraProgreso, pestañas
} from './styles.js'

let Encargos = null

/** Llama a sim/quests.js solo si está. Nunca revienta el panel. */
function pedir (funcion, porDefecto, ...args) {
  const f = Encargos?.[funcion]
  if (typeof f !== 'function') return porDefecto
  try { return f(...args) } catch (err) { console.warn(`[encargos] ${funcion}()`, err); return porDefecto }
}

/* ---------------------------------------------------------------- estilos --- */

const CSS = `
/* ---- el encargo de AHORA: lo único grande de la pantalla ---- */
.eh {
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px;
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 2px solid rgba(90, 58, 34, .55); border-radius: var(--r-m);
  box-shadow: var(--sombra-suave);
}
/* cumplido: borde de oro, para que el ojo vaya solo al botón de cobrar */
.eh.listo { border-color: var(--oro-oscuro); box-shadow: var(--sombra-suave), 0 0 0 3px rgba(212, 164, 55, .45); }
.eh-cab { display: flex; align-items: center; gap: 11px; }
.eh-cab > i { flex: none; font-style: normal; font-size: 2.1em; line-height: 1; }
.eh-titulo { font-weight: 800; font-size: 1.28em; line-height: 1.15; letter-spacing: -.01em; }
.eh-voz { margin-top: 3px; font-size: .78em; line-height: 1.3; color: var(--tinta-suave); font-style: italic; }
.eh-marca { font-size: 1.05em; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--madera-oscura); }
.eh-falta { font-size: .84em; font-weight: 700; color: var(--madera-oscura); }
.eh-premio { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.eh-premio > small { font-size: .74em; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--tinta-suave); }
/* el botón manda en la tarjeta: ancho entero y 58 px de alto */
.eh-btn { width: 100%; min-height: 58px; font-size: 1.05em; }
/* llama la atención con luz, NO moviéndose: un botón que baila se falla al tocarlo */
.eh-btn.pulsa { animation: brilla-cobrar 1.6s var(--curva) infinite; }
@keyframes brilla-cobrar {
  0%, 100% { box-shadow: var(--brillo), 0 4px 0 var(--oro-oscuro), 0 6px 12px rgba(26, 16, 8, .3); }
  50% { box-shadow: var(--brillo), 0 4px 0 var(--oro-oscuro), 0 0 0 5px rgba(242, 200, 92, .5); }
}
@media (prefers-reduced-motion: reduce) { .eh-btn.pulsa { animation: none; } }

/* lista de comprobación, solo si el encargo pide varias cosas */
.eh-pasos { display: flex; flex-direction: column; gap: 3px; }
.eh-paso { font-size: .84em; font-weight: 700; color: var(--tinta-suave); }
.eh-paso.ok { color: var(--verde-oscuro); }

/* ---- filas discretas: lo que viene después y las tareas del día ---- */
.eq { display: flex; align-items: center; gap: 10px; padding: 8px 10px; }
.eq + .eq { border-top: 1px dashed rgba(90, 58, 34, .3); }
.eq > i { flex: none; font-style: normal; font-size: 1.3em; line-height: 1; }
.eq .crece { display: flex; flex-direction: column; gap: 4px; }
.eq-nombre { font-weight: 800; font-size: .92em; line-height: 1.2; }
.eq-num { font-size: .76em; font-weight: 800; color: var(--tinta-suave); font-variant-numeric: tabular-nums; }
.eq .barra-progreso { height: 8px; }
.eq-btn { flex: none; min-width: var(--toque); min-height: var(--toque); padding: 8px 12px; font-size: .88em; }
.eq.hecha { opacity: .55; }
.eq.hecha .eq-nombre { text-decoration: line-through; }

/* la cola de la campaña: números grises, sin adornos */
.eq-cola { display: flex; align-items: center; gap: 9px; padding: 6px 10px; font-size: .84em; color: var(--tinta-suave); }
.eq-cola + .eq-cola { border-top: 1px dashed rgba(90, 58, 34, .25); }
.eq-cola > b { flex: none; font-variant-numeric: tabular-nums; opacity: .7; }

/* cabecera de la racha: una línea, no un bloque */
.racha-caja { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
.racha-caja > i { font-style: normal; font-size: 1.8em; line-height: 1; }
.racha-num { font-size: 1.05em; font-weight: 800; line-height: 1.15; }

/* logros: dos por fila no caben en móvil, así que van en lista apretada */
.logro { display: flex; align-items: center; gap: 9px; padding: 8px 10px; }
.logro + .logro { border-top: 1px dashed rgba(90, 58, 34, .3); }
.logro > i { flex: none; font-style: normal; font-size: 1.35em; line-height: 1; }
.logro .crece { display: flex; flex-direction: column; gap: 3px; }
.logro-nombre { font-weight: 800; font-size: .92em; line-height: 1.15; }
.logro-desc { font-size: .74em; font-weight: 700; color: var(--tinta-suave); }
.logro .barra-progreso { height: 8px; }
.logro-escalon {
  flex: none; min-width: 42px; text-align: center;
  font-size: .78em; font-weight: 800; font-variant-numeric: tabular-nums;
  color: var(--madera);
}
.logro.completo .logro-escalon { color: var(--verde-oscuro); }
`

function inyectarEstilos () {
  if (document.getElementById('estilos-encargos')) return
  const nodo = document.createElement('style')
  nodo.id = 'estilos-encargos'
  nodo.textContent = CSS
  document.head.appendChild(nodo)
}

/* ------------------------------------------------------------- utilidades --- */

/** Iconos de las metas que no son un edificio ni una unidad. */
const ICONO_META = {
  aldeanos: '🧑‍🌾', explorar: '🗺️', expedicion: '🐎', asalto: '🗡️', defensa: '🛡️',
  edad: '🏰', tecnologia: '📜', tecnologias: '📜', investigar: '📜',
  obras: '🔨', mejoras: '⬆️', nuevoAldeano: '🧑‍🌾', entrenar: '⚔️', botin: '💰'
}

/** El icono del encargo es la COSA que se pide: se reconoce sin leer. */
function iconoDe (q) {
  if (q.listo) return '🎁'
  const o = q.objetivo || {}
  if (o.tipo === 'recolectar') return ICONO[o.que] || '🪵'
  if (o.tipo === 'construir' || o.tipo === 'nivel') return EDIFICIOS[o.que]?.icono || '🔨'
  if (o.tipo === 'tropas') return UNIDADES[o.que]?.icono || '⚔️'
  return ICONO_META[o.tipo] || (q.clase === 'diaria' ? '🗓️' : '📜')
}

/** Las chapas de lo que da una recompensa: recursos, gemas y experiencia. */
function premioChips (recompensa = {}) {
  const trozos = []
  for (const [r, n] of Object.entries(recompensa.recursos || {})) {
    if (n > 0) trozos.push(`${ICONO[r] || ''} ${formatoNumero(n)}`)
  }
  if (recompensa.gemas > 0) trozos.push(`${ICONO.gemas} ${recompensa.gemas}`)
  if (recompensa.xp > 0) trozos.push(`⭐ ${formatoNumero(recompensa.xp)} XP`)
  return trozos
}

/** Qué falta EXACTAMENTE, en una línea. Nunca «faltan 1 para cobrarlo». */
function loQueFalta (q) {
  const p = q.progreso || { hecho: 0, total: 1 }
  const o = q.objetivo || {}
  const restan = Math.max(0, p.total - p.hecho)
  if (o.tipo === 'nivel') return `Va por el nivel ${formatoNumero(p.hecho)}. Hay que llegar al ${formatoNumero(p.total)}.`
  if (p.total <= 1) return 'Todavía sin hacer.'
  return `Te ${restan === 1 ? 'falta' : 'faltan'} ${formatoNumero(restan)}${q.unidad ? ` ${q.unidad}` : ''}.`
}

/** Cuántas tareas del día hay y cuántas se han cobrado ya. Solo lectura. */
function diariasDelDia () {
  const lista = game.state?.quests?.diarias
  if (!Array.isArray(lista)) return { total: 0, cobradas: 0 }
  return { total: lista.length, cobradas: lista.filter(d => d && d.reclamada).length }
}

/** Cierra el panel y abre donde toque hacer la cosa. Sin esto, saber no sirve. */
function irA (destino) {
  if (!destino?.panel) { panel?.cerrar(); return }
  panel?.cerrar()
  events.emit(EV.UI_PANEL, { panel: destino.panel, datos: destino.datos || null })
}

/* ---------------------------------------------------------------- montaje --- */

let panel = null
let nav = null
let zona = null
let solapa = 'encargos'
let latido = 0

function abrir (datos = {}) {
  if (panel) {
    if (datos?.solapa) { solapa = datos.solapa; pintar() }
    return panel
  }
  inyectarEstilos()
  solapa = datos?.solapa || 'encargos'

  nav = pestañas([
    { id: 'encargos', texto: 'Encargos', icono: '📜' },
    { id: 'diarias', texto: 'Diarias', icono: '🗓️' },
    { id: 'logros', texto: 'Logros', icono: '🏅' }
  ], (id) => { solapa = id; pintar() })

  zona = el('div', { clase: 'col' })

  panel = hoja({
    titulo: '📜 El mayordomo',
    contenido: [nav.nodo, zona],
    alCerrar: () => { clearInterval(latido); latido = 0; panel = null; nav = null; zona = null }
  })

  nav.activar(solapa, false)
  pintar()

  // las diarias avanzan solas mientras miras (recolectar, entrenar…):
  // un repintado por segundo basta y no se come los toques
  latido = setInterval(() => { if (panel && solapa === 'diarias') pintar() }, 1000)
  return panel
}

function pintar () {
  if (!panel || !zona) return
  nav?.activar(solapa, false)
  vaciar(zona)
  if (!Encargos) {
    zona.appendChild(el('div', { clase: 'aviso aviso-mal' }, [
      el('i', { texto: '⚠️' }),
      el('span', { texto: 'El mayordomo no responde: los encargos no están disponibles.' })
    ]))
    return
  }
  if (solapa === 'encargos') vistaEncargos(zona)
  else if (solapa === 'diarias') vistaDiarias(zona)
  else vistaLogros(zona)
}

/* ------------------------------------------------------------- 1. ENCARGOS --- */

/**
 * Cobra de verdad y enseña lo que ha pasado. La cadena la encadena sim/quests
 * dentro de `reclamar()`: aquí solo se repinta para que el siguiente aparezca.
 */
function cobrar (id, tarjeta) {
  if (!pedir('reclamar', false, id)) {
    toast('Eso todavía no está cumplido', 'mal')
    return
  }
  // destello en la tarjeta que se acaba de cobrar, antes de que se vaya
  tarjeta?.classList.remove('destello')
  void tarjeta?.offsetWidth
  tarjeta?.classList.add('destello')
  events.emit(EV.SFX, { nombre: 'monedas' })
  // del aviso ya se encarga sim/quests: dos avisos iguales tapan la aldea
  setTimeout(pintar, 240)
}

/**
 * LA TARJETA GRANDE: icono, orden, progreso, premio y botón. Nada más.
 * El detalle largo (la frase del mayordomo) va debajo del título y en pequeño.
 */
function heroe (q) {
  const p = q.progreso || { hecho: 0, total: 1 }
  const pct = p.total > 0 ? Math.min(100, (p.hecho / p.total) * 100) : 0
  const caja = el('div', { clase: ['eh', q.listo && 'listo'] })

  caja.appendChild(el('div', { clase: 'eh-cab' }, [
    el('i', { texto: iconoDe(q) }),
    el('div', { clase: 'crece' }, [
      el('div', { clase: 'eh-titulo', texto: q.titulo || 'Encargo' }),
      q.texto ? el('div', { clase: 'eh-voz', texto: q.texto }) : null
    ])
  ]))

  // lista de comprobación solo cuando el encargo pide varias cosas a la vez
  if (Array.isArray(q.pasos) && q.pasos.length) {
    caja.appendChild(el('div', { clase: 'eh-pasos' }, q.pasos.map(s => el('div', {
      clase: ['eh-paso', s.hecho && 'ok'], texto: `${s.hecho ? '✅' : '⬜'} ${s.texto}`
    }))))
  }

  if (p.total > 1) {
    caja.appendChild(el('div', { clase: 'col', estilo: { gap: '5px' } }, [
      el('div', { clase: 'fila fila-sep' }, [
        el('span', { clase: 'eh-falta', texto: loQueFalta(q) }),
        el('span', { clase: 'eh-marca', texto: `${formatoNumero(p.hecho)}/${formatoNumero(p.total)}` })
      ]),
      barraProgreso(pct, { gorda: true, tono: q.listo ? 'bien' : '' }).nodo
    ]))
  }

  const chips = premioChips(q.recompensa)
  if (chips.length) {
    caja.appendChild(el('div', { clase: 'eh-premio' }, [
      el('small', { texto: 'Te dan' }),
      ...chips.map(t => el('span', { clase: 'chip chip-oro', texto: t }))
    ]))
  }

  if (q.listo) {
    caja.appendChild(el('button', {
      clase: 'btn btn-oro eh-btn pulsa', type: 'button',
      texto: '🎁 Cobrar recompensa',
      onclick: () => cobrar(q.id, caja)
    }))
  } else if (q.ir?.panel) {
    caja.appendChild(el('button', {
      clase: 'btn btn-piedra eh-btn', type: 'button',
      texto: q.ir.texto || 'Ir a hacerlo',
      onclick: () => irA(q.ir)
    }))
  }
  return caja
}

/** Cuando no hay encargo que enseñar, manda el consejo del mayordomo. */
function heroeConsejo () {
  const c = pedir('siguienteAccion', null) || { texto: pedir('siguienteConsejo', ''), ir: null }
  const caja = el('div', { clase: 'eh' })
  caja.appendChild(el('div', { clase: 'eh-cab' }, [
    el('i', { texto: '🎩' }),
    el('div', { clase: 'crece' }, [
      el('div', { clase: 'eh-titulo', texto: 'Qué hago ahora' }),
      el('div', { clase: 'eh-voz', estilo: { fontSize: '.88em', fontStyle: 'normal' }, texto: c.texto || 'Seguid construyendo, mi señor.' })
    ])
  ]))
  if (c.ir?.panel) {
    caja.appendChild(el('button', {
      clase: 'btn btn-oro eh-btn', type: 'button',
      texto: c.ir.texto || 'Vamos allá',
      onclick: () => irA(c.ir)
    }))
  }
  return caja
}

function vistaEncargos (zona) {
  const lista = pedir('activas', []).filter(q => q.clase === 'encargo')
  // el cobrable primero: si hay premio esperando, es LO único que importa
  const enCurso = lista.find(q => q.listo) || lista[0]

  zona.appendChild(enCurso ? heroe(enCurso) : heroeConsejo())

  if (!enCurso) {
    zona.appendChild(el('div', { clase: 'panel col', estilo: { textAlign: 'center' } }, [
      el('span', { clase: 'icono-gr', texto: '👑' }),
      el('b', { texto: 'No queda nada por encargar' }),
      el('div', { clase: 'tenue pequeño', texto: 'Habéis terminado la cadena del mayordomo.' })
    ]))
  }

  // los demás encargos activos (raro, pero puede pasar): en fila y discretos
  for (const q of lista) {
    if (q === enCurso) continue
    zona.appendChild(filaTarea(q))
  }

  // y luego… solo los títulos, en gris: se ve que la cosa sigue y no distrae
  const cola = pedir('proximos', [], 3)
  if (cola.length) {
    zona.appendChild(el('div', { clase: 'tenue pequeño', estilo: { marginTop: '4px', fontWeight: '800' }, texto: 'Y después…' }))
    zona.appendChild(el('div', { clase: 'panel col', estilo: { gap: '0', padding: '4px 0' } },
      cola.map((c, i) => el('div', { clase: 'eq-cola' }, [
        el('b', { texto: `${i + 1}.` }),
        el('span', { clase: 'crece', texto: c.titulo })
      ]))))
  }

  const pct = pedir('progreso', 0)
  zona.appendChild(el('div', { clase: 'stats' }, [
    el('div', { clase: 'stat' }, [el('small', { texto: 'Partida' }), el('b', { texto: `${pct} %` })]),
    el('div', { clase: 'stat' }, [
      el('small', { texto: 'Encargos hechos' }),
      el('b', { texto: String((game.state?.quests?.completadas || []).length) })
    ])
  ]))
}

/* -------------------------------------------------------------- 2. DIARIAS --- */

/** Fila compacta: icono, nombre, barra, y UN botón. Ni un párrafo. */
function filaTarea (q) {
  const p = q.progreso || { hecho: 0, total: 1 }
  const pct = p.total > 0 ? Math.min(100, (p.hecho / p.total) * 100) : 0
  const fila = el('div', { clase: 'eq' })

  fila.append(
    el('i', { texto: iconoDe(q) }),
    el('div', { clase: 'crece' }, [
      el('div', { clase: 'eq-nombre', texto: q.titulo }),
      p.total > 1 ? barraProgreso(pct, { tono: q.listo ? 'bien' : '' }).nodo : null,
      el('div', { clase: 'eq-num', texto: p.total > 1 ? `${formatoNumero(p.hecho)} de ${formatoNumero(p.total)}` : (q.listo ? 'Cumplida' : 'Sin empezar') })
    ])
  )

  if (q.listo) {
    fila.appendChild(el('button', {
      clase: 'btn btn-oro eq-btn', type: 'button', texto: '🎁 Cobrar',
      onclick: () => cobrar(q.id, fila)
    }))
  } else if (q.ir?.panel) {
    fila.appendChild(el('button', {
      clase: 'btn btn-fantasma eq-btn', type: 'button', 'aria-label': `Ir a: ${q.titulo}`, texto: '▶',
      onclick: () => irA(q.ir)
    }))
  }
  return fila
}

function vistaDiarias (zona) {
  const r = pedir('racha', { dias: 0, mejor: 0, multiplicador: 1 })
  const lista = pedir('activas', []).filter(q => q.clase === 'diaria')
  const cuenta = diariasDelDia()
  const coma = (n) => String(Math.round(n * 100) / 100).replace('.', ',')

  // la racha, en UNA línea: el número y lo que vale hoy
  zona.appendChild(el('div', { clase: 'panel racha-caja' }, [
    el('i', { texto: '🔥' }),
    el('div', { clase: 'crece' }, [
      el('div', { clase: 'racha-num', texto: r.dias === 1 ? '1 día seguido' : `${r.dias} días seguidos` }),
      el('div', { clase: 'tenue pequeño', texto: `Gemas de hoy ×${coma(r.multiplicador)} · mejor racha ${r.mejor}` })
    ])
  ]))

  zona.appendChild(el('div', { clase: 'titular', texto: `Hoy · ${cuenta.cobradas} de ${cuenta.total || 3} cobradas` }))

  const caja = el('div', { clase: 'panel col', estilo: { gap: '0', padding: '4px 0' } })
  for (const q of lista) caja.appendChild(filaTarea(q))
  // las ya cobradas siguen contando: se enseñan tachadas para que se vea el 3/3
  for (let i = 0; i < cuenta.cobradas; i++) {
    caja.appendChild(el('div', { clase: 'eq hecha' }, [
      el('i', { texto: '✅' }),
      el('div', { clase: 'crece' }, [el('div', { clase: 'eq-nombre', texto: 'Tarea cobrada' })])
    ]))
  }
  if (caja.children.length) zona.appendChild(caja)

  if (!lista.length) {
    zona.appendChild(el('div', { clase: 'aviso aviso-bien' }, [
      el('i', { texto: '✅' }),
      el('span', { texto: 'Las tres del día, hechas. Vuelve mañana: la racha sube y las gemas también.' })
    ]))
  }
}

/* --------------------------------------------------------------- 3. LOGROS --- */

function vistaLogros (zona) {
  const lista = pedir('logros', [])
  const pct = pedir('progreso', 0)
  const conseguidos = lista.reduce((n, l) => n + (l.escalon || 0), 0)
  const totales = lista.reduce((n, l) => n + (l.escalones || 0), 0)

  const barra = barraProgreso(pct, { gorda: true, tono: 'bien' })
  zona.appendChild(el('div', { clase: 'panel col' }, [
    el('div', { clase: 'fila fila-sep' }, [
      el('b', { texto: '🏅 Partida completada' }),
      el('span', { clase: 'num', texto: `${pct} %` })
    ]),
    barra.nodo,
    el('div', { clase: 'tenue pequeño', texto: `${conseguidos} de ${totales} escalones. Se cobran solos.` })
  ]))

  // los que están a punto primero: es lo que engancha
  const orden = [...lista].sort((a, b) => {
    if (a.completo !== b.completo) return a.completo ? 1 : -1
    const pa = a.progreso.total ? a.progreso.hecho / a.progreso.total : 0
    const pb = b.progreso.total ? b.progreso.hecho / b.progreso.total : 0
    return pb - pa
  })

  const caja = el('div', { clase: 'panel col', estilo: { gap: '0', padding: '4px 0' } })
  for (const l of orden) {
    const p = l.progreso || { hecho: 0, total: 1 }
    const pc = p.total > 0 ? Math.min(100, (p.hecho / p.total) * 100) : 100
    caja.appendChild(el('div', { clase: ['logro', l.completo && 'completo'] }, [
      el('i', { texto: l.completo ? '🏆' : (l.escalon > 0 ? '🏅' : '🔓') }),
      el('div', { clase: 'crece' }, [
        el('div', { clase: 'logro-nombre', texto: l.nombre }),
        el('div', { clase: 'logro-desc', texto: l.completo ? `${l.desc} · completo` : `${l.desc}: ${formatoNumero(p.hecho)} de ${formatoNumero(p.total)}` }),
        l.completo ? null : barraProgreso(pc).nodo
      ]),
      el('span', { clase: 'logro-escalon', texto: `${l.escalon}/${l.escalones}` })
    ]))
  }
  zona.appendChild(caja)
}

/* ----------------------------------------------------------------- arranque --- */

export async function init () {
  inyectarEstilos()
  try { Encargos = await import('../sim/quests.js') } catch (err) {
    console.warn('[encargos] sin sim/quests.js:', err?.message || err)
    Encargos = null
  }

  events.on(EV.UI_PANEL, (p = {}) => {
    const cual = p?.panel
    if (cual === 'encargos' || cual === 'quests' || cual === 'misiones') abrir(p.datos)
    else if (panel) panel.cerrar()      // manda otro panel: quítate de en medio
  })

  // cobrar desde fuera (la tira del mayordomo) tiene que verse aquí al momento
  events.on(EV.QUEST_COMPLETED, () => { if (panel) pintar() })
  events.on(EV.STATE_LOADED, () => { if (panel) pintar() })
}

export default { init }
