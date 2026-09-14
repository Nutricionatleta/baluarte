/**
 * PANEL DE ENCARGOS — la pantalla del mayordomo.
 *
 * El botón 📜 Encargos del HUD emitía `UI_PANEL {panel:'encargos'}` y no lo
 * escuchaba nadie: no había dónde cobrar las recompensas. Esto es ese sitio.
 *
 * Tres pestañas, porque son tres cosas distintas y mezclarlas confunde:
 *   Encargos → la cadena de la campaña, uno detrás de otro, con su Cobrar.
 *   Diarias  → las tres tareas del día y la racha de días seguidos.
 *   Logros   → las medallas con sus escalones y el avance de partida.
 *
 * Como el resto de la interfaz: no se toca `game.state`, todo se pide a
 * `sim/quests.js`. Si ese módulo no está, el panel lo dice y no se cae.
 */
import { events, EV } from '../core/events.js'
import { ICONO } from '../core/config.js'
import { game } from '../core/state.js'
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
/* una tarjeta por encargo: título, frase del mayordomo, progreso y premio */
.enc {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px;
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 2px solid rgba(90, 58, 34, .55); border-radius: var(--r-m);
  box-shadow: var(--sombra-suave);
}
/* lo cumplido salta a la vista: borde de oro y un pelín más de luz */
.enc.listo { border-color: var(--oro-oscuro); box-shadow: var(--sombra-suave), 0 0 0 3px rgba(212, 164, 55, .45); }
.enc.hecho { opacity: .62; filter: grayscale(.35); }
.enc-cab { display: flex; align-items: center; gap: 9px; }
.enc-cab > i { flex: none; font-style: normal; font-size: 1.6em; line-height: 1; }
.enc-cab .crece { display: flex; flex-direction: column; gap: 1px; }
.enc-titulo { font-weight: 800; font-size: 1em; line-height: 1.2; }
.enc-texto { font-size: .8em; line-height: 1.3; color: var(--tinta-suave); }
.enc-marca { flex: none; font-size: .74em; font-weight: 800; color: var(--madera); font-variant-numeric: tabular-nums; }
.enc-premio { display: flex; flex-wrap: wrap; gap: 5px; }
/* el botón de cobrar manda en la tarjeta: ancho entero y 58 px de alto */
.enc-cobrar { width: 100%; min-height: 58px; font-size: 1.05em; }
/* llama la atención con luz, NO moviéndose: un botón que baila se falla al tocarlo */
.enc-cobrar.pulsa { animation: brilla-cobrar 1.6s var(--curva) infinite; }
@keyframes brilla-cobrar {
  0%, 100% { box-shadow: var(--brillo), 0 4px 0 var(--oro-oscuro), 0 6px 12px rgba(26, 16, 8, .3); }
  50% { box-shadow: var(--brillo), 0 4px 0 var(--oro-oscuro), 0 0 0 5px rgba(242, 200, 92, .5); }
}
@media (prefers-reduced-motion: reduce) { .enc-cobrar.pulsa { animation: none; } }

/* cabecera de la racha: el número gordo y qué ganas si vuelves mañana */
.racha-caja { display: flex; align-items: center; gap: 12px; }
.racha-caja > i { font-style: normal; font-size: 2.4em; line-height: 1; }
.racha-num { font-size: 1.5em; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; }

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

/** Las chapas de lo que da una recompensa: recursos, gemas y experiencia. */
function premioChips (recompensa = {}) {
  const trozos = []
  for (const [r, n] of Object.entries(recompensa.recursos || {})) {
    if (n > 0) trozos.push(`${ICONO[r] || ''} ${formatoNumero(n)}`)
  }
  if (recompensa.gemas > 0) trozos.push(`${ICONO.gemas} ${recompensa.gemas}`)
  if (recompensa.xp > 0) trozos.push(`⭐ ${formatoNumero(recompensa.xp)} XP`)
  if (!trozos.length) return null
  return el('div', { clase: 'enc-premio' }, trozos.map(t => el('span', { clase: 'chip chip-oro', texto: t })))
}

/** Cuántas tareas del día hay y cuántas se han cobrado ya. Solo lectura. */
function diariasDelDia () {
  const lista = game.state?.quests?.diarias
  if (!Array.isArray(lista)) return { total: 0, cobradas: 0 }
  return { total: lista.length, cobradas: lista.filter(d => d && d.reclamada).length }
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
    toast('Ese encargo todavía no está cumplido', 'mal')
    return
  }
  // destello en la tarjeta que se acaba de cobrar, antes de que se vaya
  tarjeta?.classList.remove('destello')
  void tarjeta?.offsetWidth
  tarjeta?.classList.add('destello')
  events.emit(EV.SFX, { nombre: 'monedas' })
  // del «📜 Nuevo encargo: X» ya avisa sim/quests: dos avisos iguales tapan la aldea
  setTimeout(pintar, 240)
}

/** Tarjeta de un encargo o de una tarea: sirve para las dos pestañas. */
function tarjetaEncargo (q) {
  const p = q.progreso || { hecho: 0, total: 1 }
  const pct = p.total > 0 ? Math.min(100, (p.hecho / p.total) * 100) : 0
  const caja = el('div', { clase: ['enc', q.listo && 'listo'] })

  caja.appendChild(el('div', { clase: 'enc-cab' }, [
    el('i', { texto: q.listo ? '🎁' : (q.clase === 'diaria' ? '🗓️' : '📜') }),
    el('div', { clase: 'crece' }, [
      el('div', { clase: 'enc-titulo', texto: q.titulo || 'Encargo' }),
      q.texto ? el('div', { clase: 'enc-texto', texto: q.texto }) : null
    ]),
    el('span', { clase: 'enc-marca', texto: `${formatoNumero(p.hecho)}/${formatoNumero(p.total)}` })
  ]))

  caja.appendChild(barraProgreso(pct, { tono: q.listo ? 'bien' : '' }).nodo)

  const premio = premioChips(q.recompensa)
  if (premio) caja.appendChild(premio)

  if (q.listo) {
    caja.appendChild(el('button', {
      clase: 'btn btn-oro enc-cobrar pulsa', type: 'button',
      texto: '🎁 Cobrar recompensa',
      onclick: () => cobrar(q.id, caja)
    }))
  } else {
    caja.appendChild(el('div', {
      clase: 'tenue pequeño', estilo: { textAlign: 'center' },
      texto: `Faltan ${formatoNumero(Math.max(0, p.total - p.hecho))} para cobrarlo`
    }))
  }
  return caja
}

function vistaEncargos (zona) {
  const lista = pedir('activas', []).filter(q => q.clase === 'encargo')

  const porCobrar = lista.filter(q => q.listo).length
  zona.appendChild(el('div', { clase: porCobrar ? 'aviso aviso-bien' : 'aviso aviso-info' }, [
    el('i', { texto: porCobrar ? '🎁' : '🎩' }),
    el('span', {
      texto: porCobrar
        ? `Tenéis ${porCobrar} recompensa${porCobrar === 1 ? '' : 's'} sin cobrar, mi señor.`
        : 'Cumplid el encargo en curso y volved a por vuestra recompensa.'
    })
  ]))

  if (!lista.length) {
    zona.appendChild(el('div', { clase: 'panel col', estilo: { textAlign: 'center' } }, [
      el('span', { clase: 'icono-gr', texto: '👑' }),
      el('b', { texto: 'No queda nada por encargar' }),
      el('div', { clase: 'tenue pequeño', texto: 'Habéis terminado la cadena del mayordomo. El valle es vuestro.' })
    ]))
  }
  for (const q of lista) zona.appendChild(tarjetaEncargo(q))

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

function vistaDiarias (zona) {
  const r = pedir('racha', { dias: 0, mejor: 0, multiplicador: 1 })
  const lista = pedir('activas', []).filter(q => q.clase === 'diaria')
  const cuenta = diariasDelDia()

  // Lo que se gana MAÑANA si vuelve: es el único motivo de volver a abrir.
  const coma = (n) => String(Math.round(n * 100) / 100).replace('.', ',')
  const mañana = 1 + Math.min(10, r.dias) * 0.1
  zona.appendChild(el('div', { clase: 'panel racha-caja' }, [
    el('i', { texto: '🔥' }),
    el('div', { clase: 'crece' }, [
      el('div', { clase: 'racha-num', texto: r.dias === 1 ? '1 día seguido' : `${r.dias} días seguidos` }),
      el('div', { clase: 'tenue pequeño', texto: `Tu mejor racha: ${r.mejor} · gemas de hoy ×${coma(r.multiplicador)}` })
    ])
  ]))

  zona.appendChild(el('div', { clase: 'aviso aviso-info' }, [
    el('i', { texto: '🎁' }),
    el('span', { texto: `Si vuelves mañana: día ${r.dias + 1} y las gemas de las tareas valdrán ×${coma(mañana)}.` })
  ]))

  zona.appendChild(el('div', { clase: 'titular', texto: `Tareas de hoy · ${cuenta.cobradas} de ${cuenta.total || 3} cobradas` }))

  if (!lista.length) {
    zona.appendChild(el('div', { clase: 'panel col', estilo: { textAlign: 'center' } }, [
      el('span', { clase: 'icono-gr', texto: '✅' }),
      el('b', { texto: cuenta.total ? 'Las tres tareas, cumplidas' : 'Hoy no hay tareas' }),
      el('div', { clase: 'tenue pequeño', texto: 'Vuelve mañana: la racha sube y las gemas también.' })
    ]))
  }
  for (const q of lista) zona.appendChild(tarjetaEncargo(q))

  // las ya cobradas siguen contando: se enseñan apagadas para que se vea el 3/3
  for (let i = 0; i < cuenta.cobradas; i++) {
    zona.appendChild(el('div', { clase: 'enc hecho' }, [
      el('div', { clase: 'enc-cab' }, [
        el('i', { texto: '✅' }),
        el('div', { clase: 'crece' }, [
          el('div', { clase: 'enc-titulo', texto: 'Tarea cumplida y cobrada' }),
          el('div', { clase: 'enc-texto', texto: 'Una menos para el premio de las tres.' })
        ])
      ])
    ]))
  }

  zona.appendChild(el('div', {
    clase: 'tenue pequeño', estilo: { textAlign: 'center' },
    texto: 'Cumplir las tres del día da gemas extra, y cuantos más días seguidos, más.'
  }))
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
    el('div', { clase: 'tenue pequeño', texto: `${conseguidos} de ${totales} escalones conseguidos. Se cobran solos: las gemas caen al llegar.` })
  ]))

  // los que están a punto primero: es lo que engancha
  const orden = [...lista].sort((a, b) => {
    if (a.completo !== b.completo) return a.completo ? 1 : -1
    const pa = a.progreso.total ? a.progreso.hecho / a.progreso.total : 0
    const pb = b.progreso.total ? b.progreso.hecho / b.progreso.total : 0
    return pb - pa
  })

  const caja = el('div', { clase: 'eco-lista' })
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
