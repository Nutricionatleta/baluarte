/**
 * PANEL DEL MUNDO: la pata de "explorar".
 *
 * Lo que hay en una casilla del valle, a quién mandas y a qué, quién está fuera
 * ahora mismo y el informe que trae de vuelta (el pergamino: lo mejor del juego,
 * así que se abre solo y ocupa toda la pantalla).
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

// ---------------------------------------------------------------- estado ---

let panel = null
let nav = null              // las pestañas, para que la marcada sea la que se ve
let solapa = 'casilla'
let casilla = null         // { x, y } la que se está mirando
let mision = 'explorar'
let relojes = []
let latido = 0
let pergaminoAbierto = null

const reloj = (fn) => { relojes.push(fn); try { fn() } catch { /* da igual */ } }
/** Decimales como en español: 2.2 -> 2,2. */
const coma = (v) => String(v).replace('.', ',')
const hayCampamento = () => (pedir(Expediciones, 'nivelCampamento', [], 0) || 0) > 0
const casaMundo = () => game.state.world?.casa || Mapa.MUNDO?.CASA || { x: 8, y: 8 }

// ================================================================ APERTURA ==

export function init () {
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
    mision = eleccionPorDefecto(p.x, p.y)
    solapa = 'casilla'
    if (panel) pintar(); else abrir()
  })

  events.on(EV.SCOUT_RETURNED, (p = {}) => {
    if (panel) pintar()
    const inf = p.informe || p.hallazgo
    if (inf && !pergaminoAbierto) abrirPergamino(inf, p.expedicion)
  })

  events.on(EV.SCOUT_SENT, () => { if (panel) pintar() })
  events.on(EV.WORLD_REVEALED, () => { if (panel && solapa !== 'casilla') pintar() })
}

function abrir (datos = {}) {
  if (panel) { pintar(); return }
  solapa = datos?.solapa || (casilla ? 'casilla' : 'sugerencias')

  nav = pestañas([
    { id: 'casilla', texto: 'Casilla' },
    { id: 'curso', texto: 'Fuera' },
    { id: 'sugerencias', texto: 'A dónde ir' }
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
  const pestañaFuera = nav?.nodo?.children?.[1]
  if (pestañaFuera) pestañaFuera.textContent = cuantos ? `Fuera (${cuantos})` : 'Fuera'
  const zona = vaciar(panel.zona)
  if (solapa === 'casilla') vistaCasilla(zona)
  else if (solapa === 'curso') vistaEnCurso(zona)
  else vistaSugerencias(zona)
}

// ============================================================== 1. CASILLA ==

/** La misión que tiene sentido de entrada en esa casilla. */
function eleccionPorDefecto (x, y) {
  if (pedir(Enemigos, 'enemigoEn', [x, y], null)) return 'espiar'
  const n = pedir(Mapa, 'nodoEn', [x, y], null)
  if (n && n.recurso && !n.agotado && n.restante > 0) return 'recolectar'
  return 'explorar'
}

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

function vistaCasilla (zona) {
  if (!casilla) {
    zona.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'titular', texto: 'Ninguna casilla elegida' }),
      el('div', { clase: 'tenue', texto: 'Toca una casilla en el mapa del valle, o mira las recomendaciones del explorador.' }),
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
  const rumbo = (() => {
    const dx = x - casa.x, dy = y - casa.y
    if (!dx && !dy) return 'tu propia aldea'
    const v = Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? 'norte' : 'sur') : (dx > 0 ? 'este' : 'oeste')
    return `al ${v}`
  })()

  // --- ficha ---
  zona.appendChild(el('div', { clase: 'panel col' }, [
    el('div', { clase: 'fila fila-sep' }, [
      el('span', { clase: 'titular', texto: nombre }),
      el('span', { clase: 'pequeño tenue', texto: `${x},${y}` })
    ]),
    el('div', { clase: 'fila', estilo: { flexWrap: 'wrap' } }, [
      chip('🧭', rumbo, {}),
      chip('📏', `${coma(dist.toFixed(1))} casillas`, {}),
      nodo ? chip(Mapa.TIPOS_NODO?.[nodo.tipo]?.icono || '⛏️', nodo.nombre, { tono: nodo.agotado ? '' : 'bien' }) : null,
      enemigo ? chip('🏴', enemigo.derrotado ? 'en ruinas' : `nivel ${enemigo.nivel}`, { tono: enemigo.derrotado ? '' : 'mal' }) : null
    ]),
    el('div', { clase: 'pequeño', estilo: { lineHeight: '1.4' }, texto: `📜 ${narrar(x, y, tile, nodo, enemigo, riqueza, dist)}` }),
    ...eventos.map(ev => el('div', { clase: 'pequeño', texto: `⚡ ${ev.texto || 'Algo se mueve por aquí.'}` }))
  ]))

  if (x === casa.x && y === casa.y) {
    zona.appendChild(el('div', { clase: 'panel tenue', texto: 'Esta es tu aldea. No hace falta mandar a nadie a explorarla.' }))
    return
  }

  // --- sin campamento no hay expediciones ---
  if (!hayCampamento()) {
    zona.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'titular', texto: 'No tienes quien vaya' }),
      el('div', { clase: 'pequeño', texto: `Las expediciones salen del ${EDIFICIOS.campamento_explorador.nombre.toLowerCase()}: una hoguera, un mapa mal dibujado y gente con ganas. Sin él, el valle seguirá en la niebla.` }),
      el('button', {
        clase: 'btn btn-oro btn-gordo', type: 'button', texto: '🧭 Construir el campamento',
        onclick: () => { panel?.cerrar(); events.emit(EV.UI_PANEL, { panel: 'construir', datos: { tipo: 'campamento_explorador', categoria: 'militar' } }) }
      })
    ]))
    return
  }

  zona.appendChild(elegirMision(x, y, nodo, enemigo))
}

/** Las cuatro misiones, con lo que cuestan, lo que tardan y lo que se saca. */
function elegirMision (x, y, nodo, enemigo) {
  const caja = el('div', { clase: 'panel col' })
  caja.appendChild(el('div', { clase: 'titular', texto: 'Mandar expedición' }))

  const fila = el('div', { clase: 'fila', estilo: { flexWrap: 'wrap', gap: '6px' } })
  const detalle = el('div', { clase: 'col', estilo: { gap: '6px' } })
  const botones = {}

  const premio = (m) => {
    if (m === 'explorar') return 'Levanta la niebla de la zona y apunta en el mapa lo que encuentre.'
    if (m === 'recolectar') {
      if (!nodo || !nodo.recurso) return 'Aquí no hay yacimiento que recoger.'
      if (nodo.agotado || nodo.restante <= 0) return 'La tierra está exprimida: hay que esperar a que se rehaga.'
      const carga = pedir(Expediciones, 'capacidadCarga', [], 0) || 0
      return `Hasta ${formatoNumero(Math.min(nodo.restante, carga))} de ${nodo.recurso} a la espalda.`
    }
    if (m === 'espiar') return enemigo ? `El parte completo de ${enemigo.nombre}: muros, torres y guarnición.` : 'No hay base enemiga que espiar aquí.'
    return enemigo ? `Un pellizco de lo que guarde ${enemigo.nombre}, sin dar batalla.` : 'Un pellizco de lo que haya por el camino. Sale bien… casi siempre.'
  }

  function pintarDetalle () {
    vaciar(detalle)
    const m = MISIONES[mision]
    const seg = pedir(Expediciones, 'tiempoDe', [x, y, mision], 0) || 0
    const coste = pedir(Expediciones, 'costeDe', [x, y, mision], { comida: 0 }) || {}
    const riesgo = pedir(Expediciones, 'riesgoDe', [x, y, mision], null)
    const permiso = pedir(Expediciones, 'puedeEnviar', [{ x, y, mision }], { ok: false, motivo: 'No disponible' }) || {}
    const plazas = pedir(Expediciones, 'plazas', [], 0) || 0
    const libres = pedir(Expediciones, 'plazasLibres', [], 0) || 0

    detalle.appendChild(el('div', { clase: 'pequeño tenue', texto: m.desc }))
    detalle.appendChild(el('div', { clase: 'fila', estilo: { flexWrap: 'wrap' } }, [
      chip(ICONO.tiempo, `${formatoTiempo(seg)} ida y vuelta`, {}),
      chip(ICONO.comida, formatoNumero(coste.comida || 0), {}),
      riesgo ? chip(riesgo.nivel === 'seguro' ? '🙂' : riesgo.nivel === 'moderado' ? '😐' : '💀',
        `${riesgo.pct} % de sustos`, { tono: riesgo.nivel === 'seguro' ? 'bien' : riesgo.nivel === 'peligroso' ? 'mal' : '' }) : null,
      chip('🐾', `${libres}/${plazas} libres`, { tono: libres ? '' : 'mal' })
    ]))
    if (riesgo) detalle.appendChild(el('div', { clase: 'pequeño', texto: `⚠️ ${riesgo.texto} Riesgo de no volver: ${coma(riesgo.pctPerdida)} %.` }))
    detalle.appendChild(el('div', { clase: 'pequeño', estilo: { lineHeight: '1.35' }, texto: `🎁 ${premio(mision)}` }))

    detalle.appendChild(el('button', {
      clase: ['btn', permiso.ok ? 'btn-oro' : 'btn-piedra', 'btn-gordo'], type: 'button',
      texto: permiso.ok ? `${m.icono} Enviar expedición` : '🚫 No se puede',
      disabled: !permiso.ok,
      onclick: () => {
        const exp = pedir(Expediciones, 'enviar', [{ x, y, mision }], null)
        if (exp) { solapa = 'curso'; pintar() }
      }
    }))

    if (!permiso.ok) {
      detalle.appendChild(el('div', { clase: 'pequeño no-alcanzable', texto: permiso.motivo }))
      detalle.appendChild(solucionPara(permiso.motivo))
    }
  }

  for (const [id, m] of Object.entries(MISIONES)) {
    const b = el('button', {
      clase: 'btn crece', type: 'button', estilo: { minWidth: '44%', padding: '10px 8px' },
      texto: `${m.icono} ${m.nombre}`,
      onclick: () => { mision = id; refrescar() }
    })
    botones[id] = b
    fila.appendChild(b)
  }
  function refrescar () {
    for (const [id, b] of Object.entries(botones)) b.className = `btn crece ${id === mision ? 'btn-oro' : 'btn-piedra'}`
    pintarDetalle()
  }
  caja.append(fila, detalle)
  refrescar()
  return caja
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
  return el('span')
}

// ============================================================ 2. EN CURSO ==

function vistaEnCurso (zona) {
  const fuera = pedir(Expediciones, 'enCurso', [], []) || []
  const sinLeer = pedir(Expediciones, 'informesSinLeer', [], []) || []

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

  if (!fuera.length) {
    zona.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'titular', texto: 'No hay nadie fuera' }),
      el('div', { clase: 'tenue', texto: hayCampamento() ? 'Todos los exploradores están en la aldea, aburridos y comiéndose el grano.' : 'Sin campamento de exploradores no sale nadie de la empalizada.' }),
      el('button', { clase: 'btn btn-oro btn-gordo', type: 'button', texto: '✨ ¿A dónde los mando?', onclick: () => { solapa = 'sugerencias'; pintar() } })
    ]))
  }

  for (const e of fuera) {
    const m = MISIONES[e.mision] || { icono: '🧭', nombre: e.mision }
    const barra = barraProgreso((e.pct || 0) * 100, { gorda: true, tono: e.curandose ? 'mal' : '' })
    const etiqueta = el('div', { clase: 'pequeño', texto: e.etiqueta })
    const caja = el('div', { clase: 'tarjeta col' }, [
      el('div', { clase: 'fila fila-sep' }, [
        el('span', { clase: 'tarjeta-nombre', texto: `${m.icono} ${e.aldeanoNombre || 'Un explorador'}` }),
        chip('🎯', m.nombre, {})
      ]),
      etiqueta,
      barra.nodo
    ])

    if (!e.curandose) {
      const precio = el('button', {
        clase: 'btn btn-piedra', type: 'button', texto: `💎 Que vuelva ya (${e.costeAcelerar || 1})`,
        onclick: () => { if (pedir(Expediciones, 'acelerar', [e.id], false)) pintar() }
      })
      caja.appendChild(precio)
    }

    reloj(() => {
      const vivos = pedir(Expediciones, 'enCurso', [], []) || []
      const yo = vivos.find(v => v.id === e.id)
      if (!yo) { pintar(); return }
      barra.fijar((yo.pct || 0) * 100)
      etiqueta.textContent = yo.etiqueta
    })
    zona.appendChild(caja)
  }
}

// ========================================================= 3. SUGERENCIAS ==

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
        chip(s.riesgo === 'seguro' ? '🙂' : s.riesgo === 'moderado' ? '😐' : '💀', s.riesgo, { tono: s.riesgo === 'seguro' ? 'bien' : s.riesgo === 'peligroso' ? 'mal' : '' })
      ]),
      el('div', { clase: 'fila', estilo: { gap: '8px' } }, [
        el('button', {
          clase: 'btn btn-oro crece', type: 'button', texto: `${m.icono} Enviar`,
          onclick: () => { if (pedir(Expediciones, 'enviar', [{ x: s.x, y: s.y, mision: s.mision }], null)) { solapa = 'curso'; pintar() } }
        }),
        el('button', {
          clase: 'btn btn-piedra crece', type: 'button', texto: '🔎 Ver',
          onclick: () => { casilla = { x: s.x, y: s.y }; mision = s.mision; solapa = 'casilla'; pintar() }
        })
      ])
    ]))
  }
}

// ============================================================ EL PERGAMINO ==

const TONO_INFORME = {
  exito: { icono: '🌟', titulo: 'Buenas noticias' },
  regular: { icono: '📜', titulo: 'Ha vuelto' },
  malo: { icono: '🩸', titulo: 'Malas noticias' },
  perdido: { icono: '🪦', titulo: 'No ha vuelto' }
}

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

  cuerpo.appendChild(el('div', {
    clase: 'panel',
    estilo: { lineHeight: '1.55', fontSize: '1.02em', fontStyle: 'italic' },
    texto: informe.texto || 'Volvió sin nada que contar, que también es una forma de volver.'
  }))

  const recursos = informe.recursos || {}
  const algo = Object.values(recursos).some(v => v > 0) || informe.gemas > 0
  if (algo) {
    cuerpo.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'titular', texto: 'Lo que trae en el zurrón' }),
      el('div', { html: costeHTML(recursos, { madera: 1e9, piedra: 1e9, comida: 1e9, oro: 1e9 }) }),
      informe.gemas ? el('div', { clase: 'num', texto: `💎 ${informe.gemas}` }) : null
    ]))
  }

  if (informe.tilesNuevos || (informe.hallazgos || []).length) {
    cuerpo.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'titular', texto: 'Lo que apunta en el mapa' }),
      informe.tilesNuevos ? el('div', { clase: 'pequeño', texto: `🗺️ ${informe.tilesNuevos} casillas nuevas fuera de la niebla.` }) : null,
      ...(informe.hallazgos || []).map(h => el('div', { clase: 'pequeño', texto: `• ${typeof h === 'string' ? h : (h.texto || h.nombre || '')}` }))
    ]))
  }

  if ((informe.sucesos || []).length) {
    cuerpo.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'titular', texto: 'Por el camino' }),
      ...informe.sucesos.map(s => el('div', { clase: 'pequeño', texto: `• ${s.texto || s.clave}` }))
    ]))
  }

  pergaminoAbierto = hoja({
    titulo: '📜 Parte de expedición',
    clase: 'hoja-pergamino',
    contenido: cuerpo,
    alCerrar: () => { pergaminoAbierto = null; if (panel) pintar() },
    pie: el('button', {
      clase: 'btn btn-oro btn-gordo', type: 'button', texto: 'Guardar el informe',
      onclick: () => pergaminoAbierto?.cerrar()
    })
  })

  if (expedicion?.id) pedir(Expediciones, 'marcarLeido', [expedicion.id], null)
}

export default { init }
