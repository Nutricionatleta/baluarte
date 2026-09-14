/**
 * PANEL DE EJÉRCITO: la pata de "pelear".
 *
 * Cuatro pestañas: la tropa que tienes, dónde entrenar más, a quién atacar
 * (con su plano, su batalla en vivo y su parte) y cómo anda tu defensa.
 *
 * Este módulo NO toca game.state: todo pasa por sim/army.js, sim/combat.js y
 * world/enemies.js. Si alguno de esos módulos no está, el panel se abre igual
 * y dice lo que no puede hacer, en vez de tumbar el juego.
 */
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { ICONO } from '../core/config.js'
import { limitesDelTerritorio } from '../core/grid.js'
import { UNIDADES, PIEDRA_PAPEL } from '../data/units.js'
import { EDIFICIOS, valorEdificio } from '../data/buildings.js'
import * as UI from './styles.js'
import * as Ejercito from '../sim/army.js'
import * as Combate from '../sim/combat.js'
import * as Enemigos from '../world/enemies.js'
// solo de lectura (y `reparar`, que es lo que el parte de la defensa ofrece)
import * as Recursos from '../sim/resources.js'
import * as Edificios from '../sim/buildings.js'

const { el, hoja, toast, confirmar, formatoNumero, formatoTiempo, costeHTML, chip, barraProgreso, pestañas, tarjeta, badge, vaciar } = UI

/** Llama a la API de otro módulo sin que un fallo suyo se lleve el panel por delante. */
function pedir (mod, nombre, args = [], alt = null) {
  const f = mod && mod[nombre]
  if (typeof f !== 'function') return alt
  try { return f(...args) } catch (err) { console.warn(`[army-panel] ${nombre} falló`, err); return alt }
}

// ---------------------------------------------------------------- estado ---

let panel = null            // la hoja abierta, o null
let nav = null              // las pestañas, para mantenerlas en su sitio al saltar de una a otra
let solapa = 'tropas'
let relojes = []            // funciones que refrescan cuentas atrás mientras está abierto
let latido = 0
let avisoAtaque = null      // { enemigo, cuando } último ATTACK_INCOMING sin resolver
let parteDefensa = null     // el parte del último asedio recibido, hasta que lo cierras

// --- lo que dura un asalto: se limpia al cerrar ---
let rival = null            // { enemigo, etiqueta, ratio, recompensa, consejo }
let seleccion = {}          // { lancero: 6, ... }
let modoSeleccion = 'ataque' // 'ataque' = solo los escuadrones que salen; 'todo' = vaciar la aldea
let lado = 'sur'
let reproduccion = null     // handle de combat.reproducir
let animacion = 0           // setInterval del canvas

// --- escuadrones ---
let reparto = null          // { de, a, mueve:{lancero:2} } el traspaso que se está preparando
let plantando = null        // { id, nombre, x, z, barra, quitarTap } buscando sitio en la aldea

// ------------------------------------------------------------- utilidades ---

const tropasDe = () => pedir(Ejercito, 'tropasDisponibles', [], { ...(game.state.ejercito?.tropas || {}) }) || {}
const suma = (o) => Object.values(o || {}).reduce((a, b) => a + (b || 0), 0)
const statsDe = (tipo) => pedir(Ejercito, 'estadisticasUnidad', [tipo], null) || {
  tipo, clase: UNIDADES[tipo]?.clase, espacio: UNIDADES[tipo]?.espacio || 0,
  hp: UNIDADES[tipo]?.hp || 0, ataque: UNIDADES[tipo]?.ataque || 0,
  armadura: UNIDADES[tipo]?.armadura || 0
}

/** Unidades que algún edificio del catálogo sabe sacar (el aldeano y el explorador van por otro lado). */
const ENTRENABLES = Object.keys(UNIDADES).filter(t =>
  Object.values(EDIFICIOS).some(d => Array.isArray(d.entrena) && d.entrena.includes(t)))

const CLASE_LLANA = {
  infanteria: 'la infantería', distancia: 'los arqueros', caballeria: 'la caballería',
  asedio: 'las máquinas de asedio', civil: 'los civiles', edificio: 'las murallas y los edificios'
}
const CLASE_CORTA = {
  infanteria: 'Infantería', distancia: 'Distancia', caballeria: 'Caballería',
  asedio: 'Asedio', civil: 'Civil'
}

/** Plural en condiciones: espadachín -> espadachines, lancero -> lanceros. */
function enPlural (tipo) {
  const n = (UNIDADES[tipo]?.nombre || tipo).toLowerCase()
  if (/[aeiou]$/.test(n)) return `${n}s`
  return `${n.replace(/í(?=[a-zñ]*$)/, 'i').replace(/á(?=[a-zñ]*$)/, 'a').replace(/ó(?=[a-zñ]*$)/, 'o')}es`
}

/** "Los lanceros destrozan a la caballería" — las ventajas de tipo, en cristiano. */
function paraQueSirve (tipo) {
  const ventajas = Object.entries(PIEDRA_PAPEL[tipo] || {}).sort((a, b) => b[1] - a[1])
  const frases = []
  const ellos = /a$/.test(UNIDADES[tipo]?.nombre || '') ? `Las ${enPlural(tipo)}` : `Los ${enPlural(tipo)}`
  for (const [clase, mult] of ventajas.slice(0, 2)) {
    const verbo = mult >= 2 ? 'destrozan a' : mult >= 1.5 ? 'se comen a' : 'llevan ventaja contra'
    frases.push(`${frases.length ? 'Y' : ellos} ${verbo} ${CLASE_LLANA[clase] || clase}.`)
  }
  if (!ventajas.length && UNIDADES[tipo]?.desc) frases.push(UNIDADES[tipo].desc)
  // el reverso: quién se los come a ellos
  const mia = UNIDADES[tipo]?.clase
  const verdugos = Object.entries(PIEDRA_PAPEL)
    .filter(([otro, tabla]) => otro !== tipo && (tabla[mia] || 0) >= 1.5)
    .sort((a, b) => (b[1][mia] || 0) - (a[1][mia] || 0))
    .map(([otro]) => enPlural(otro))
  if (verdugos.length) frases.push(`Ojo: los ${verdugos.slice(0, 2).join(' y los ')} pueden con ellos.`)
  return frases.join(' ') || 'No tiene ventajas de tipo: vale para todo y para nada.'
}

/** Cuántas unidades caben con lo que hay en el granero y en los cuarteles. */
function cabenAhora (tipo) {
  const u = UNIDADES[tipo]
  if (!u) return 0
  const oc = pedir(Ejercito, 'ocupacion', [], { usado: 0, total: 0 }) || { usado: 0, total: 0 }
  const porHueco = u.espacio > 0 ? Math.floor((oc.total - oc.usado) / u.espacio) : 99
  let porDinero = 99
  for (const [r, c] of Object.entries(u.coste)) {
    if (!c) continue
    porDinero = Math.min(porDinero, Math.floor((game.state.recursos?.[r] || 0) / c))
  }
  return Math.max(0, Math.min(porHueco, porDinero, 99))
}

const costeUnidad = (tipo, n = 1) => {
  const c = {}
  for (const [r, v] of Object.entries(UNIDADES[tipo]?.coste || {})) if (v) c[r] = v * n
  return c
}

/** Registra un refresco periódico (cuentas atrás) mientras la hoja esté abierta. */
function reloj (fn) { relojes.push(fn); try { fn() } catch { /* da igual */ } }

// ================================================================ APERTURA ==

export function init () {
  events.on(EV.UI_PANEL, (p = {}) => {
    if (p.panel === 'ejercito' || p.panel === 'army') { salirDePlantar(true); quitarBarraHecho(); abrir(p.datos) }
    else if (p.panel === null && panel) panel.cerrar()
    else if (p.panel && p.panel !== 'ejercito' && p.panel !== 'army') { salirDePlantar(true); quitarBarraHecho() }
  })

  // Otro panel entra a colocar algo (una obra, un traslado): aquí se recoge la
  // mesa, que dos fantasmas a la vez no los entiende nadie.
  events.on(EV.BUILD_MODE, (p) => {
    if (!plantando) return
    if (p && p.activo && p.escuadron !== plantando.id) salirDePlantar(true)
  })

  // el reparto cambia por otros sitios (entrenas, curas, te matan gente)
  events.on(EV.ESCUADRONES_CAMBIADOS, () => { if (panel && solapa === 'escuadrones' && !reparto) pintar() })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && plantando) { e.preventDefault(); salirDePlantar() }
  })

  events.on(EV.ATTACK_INCOMING, (p = {}) => {
    if (!p || p.resuelto) return
    avisoAtaque = {
      enemigo: p.enemigo || p.atacante || { nombre: 'Una partida de bandidos' },
      cuando: p.cuando || (Date.now() + Math.max(0, (p.llegaEn || 0)) * 1000),
      poder: p.poder || 0,
      unidades: p.unidades || suma(p.tropas || p.hueste || {}),
      texto: p.texto || ''
    }
    if (panel && solapa === 'defensa') pintar()
  })

  events.on(EV.DEFENSE_RESOLVED, (p = {}) => {
    avisoAtaque = null
    parteDefensa = p.parte || null
    if (parteDefensa) {
      parteDefensa.victoria = p.victoria
      // El parte es lo primero que hay que ver al abrir: se salta a Defensa.
      if (panel) { solapa = 'defensa'; pintar() }
    }
  })

  // la cola de entrenamiento cambia sola: si estás mirándola, que se note
  events.on(EV.UNIT_TRAINED, () => { if (panel && (solapa === 'entrenar' || solapa === 'tropas')) pintar() })
}

function abrir (datos = {}) {
  if (panel) { if (datos && datos.solapa) { solapa = datos.solapa; pintar() } return }
  solapa = datos?.solapa || 'tropas'
  rival = null
  reparto = null
  seleccion = {}
  modoSeleccion = 'ataque'

  nav = pestañas([
    { id: 'tropas', texto: 'Tropa' },
    { id: 'escuadrones', texto: 'Escuadrones' },
    { id: 'entrenar', texto: 'Entrenar' },
    { id: 'atacar', texto: 'Atacar' },
    { id: 'defensa', texto: 'Defensa' }
  ], (id) => { solapa = id; reparto = null; pintar() })

  const cuerpo = el('div', { clase: 'col' })

  panel = hoja({
    titulo: '⚔️ Tu hueste',
    clase: 'hoja-ejercito',
    contenido: [nav.nodo, cuerpo],
    alCerrar: () => {
      pararBatalla()
      clearInterval(latido); latido = 0
      relojes = []; panel = null; nav = null; rival = null
    }
  })
  panel.zona = cuerpo
  nav.activar(solapa, false)

  latido = setInterval(() => { for (const f of relojes) { try { f() } catch { /* da igual */ } } }, 500)
  pintar()
}

/** Repinta la pestaña activa. Es la única forma de refrescar: nada de parches sueltos. */
function pintar () {
  if (!panel) return
  relojes = []
  nav?.activar(solapa, false)
  const zona = vaciar(panel.zona)
  if (solapa !== 'atacar') pararBatalla()

  if (solapa === 'tropas') vistaTropas(zona)
  else if (solapa === 'escuadrones') { if (reparto) vistaReparto(zona); else vistaEscuadrones(zona) }
  else if (solapa === 'entrenar') vistaEntrenar(zona)
  else if (solapa === 'atacar') vistaAtacar(zona)
  else vistaDefensa(zona)
}

// ============================================================== 1. TU TROPA ==

function vistaTropas (zona) {
  const tropas = game.state.ejercito?.tropas || {}
  const fuera = pedir(Ejercito, 'tropasFuera', [], {}) || {}
  const oc = pedir(Ejercito, 'ocupacion', [], { usado: 0, total: 0 }) || { usado: 0, total: 0 }
  const poder = pedir(Ejercito, 'poderMilitar', [], 0) || 0
  const comida = pedir(Ejercito, 'consumoComida', [], 0) || 0
  const hambre = pedir(Ejercito, 'hayHambre', [], false)

  // --- cabecera: hueco, poder y manutención ---
  const barra = barraProgreso(oc.total ? (oc.usado / oc.total) * 100 : 0, { gorda: true, tono: oc.usado >= oc.total ? 'mal' : '' })
  zona.appendChild(el('div', { clase: 'panel col' }, [
    el('div', { clase: 'fila fila-sep' }, [
      el('span', { clase: 'titular', texto: 'Hueco de la hueste' }),
      el('span', { clase: 'num', texto: `${oc.usado} / ${oc.total}` })
    ]),
    barra.nodo,
    el('div', { clase: 'fila', estilo: { flexWrap: 'wrap' } }, [
      chip('💪', formatoNumero(poder), { tono: 'oro' }),
      chip(ICONO.comida, `${comida.toFixed(1)}/min`, { tono: hambre ? 'mal' : '' }),
      chip('🍖', `${formatoNumero(Math.round(comida * 60 * 24))} al día`, { tono: hambre ? 'mal' : '' })
    ]),
    hambre ? el('div', { clase: 'no-alcanzable pequeño', texto: '⚠️ La tropa lleva días sin comer: pega un 20 % menos. Sube granjas.' }) : null
  ]))

  // --- veredicto honesto ---
  // El emparejamiento usa la vara de world/enemies (poderJugadorActual), que NO
  // es la escala de poderMilitar(): mezclarlas hacía que un 'igualado' fuese un muro.
  const rivales = pedir(Enemigos, 'emparejar', [pedir(Enemigos, 'poderJugadorActual', [], poder)], []) || []
  const facil = rivales.find(r => r.etiqueta === 'cómodo')
  zona.appendChild(el('div', {
    clase: 'panel',
    estilo: { borderStyle: 'dashed' },
    texto: !suma(tropas)
      ? 'No tienes ni un soldado. Con esto no se asalta nada: entrena lanceros, son baratos.'
      : poder < 200
        ? 'Hueste de andar por casa: vale para espantar bandidos, no para tomar una aldea.'
        : facil
          ? `Con esta tropa te llevas por delante ${facil.enemigo.nombre} (${facil.enemigo.titulo}). Mira la pestaña de Atacar.`
          : 'Tienes tropa suficiente para salir a buscar pelea.'
  }))

  // --- la tropa, una fila por tipo ---
  const lista = el('div', { clase: 'col' })
  const tipos = Object.keys(tropas).filter(t => tropas[t] > 0)
  if (!tipos.length) {
    lista.appendChild(el('div', { clase: 'panel tenue', texto: 'El patio de armas está vacío.' }))
  }
  for (const tipo of tipos.sort((a, b) => (UNIDADES[b]?.espacio || 0) - (UNIDADES[a]?.espacio || 0))) {
    const u = UNIDADES[tipo]; if (!u) continue
    const s = statsDe(tipo)
    const enviados = fuera[tipo] || 0
    lista.appendChild(el('div', { clase: 'tarjeta', estilo: { flexDirection: 'row', alignItems: 'center', gap: '10px' } }, [
      el('div', { clase: 'tarjeta-icono', texto: u.icono }),
      el('div', { clase: 'tarjeta-cuerpo col', estilo: { gap: '2px' } }, [
        el('div', { clase: 'fila fila-sep' }, [
          el('span', { clase: 'tarjeta-nombre', texto: u.nombre }),
          el('span', { clase: 'num', texto: `× ${tropas[tipo]}` })
        ]),
        el('div', { clase: 'tarjeta-detalle', texto: `${CLASE_CORTA[u.clase] || u.clase} · ⚔ ${s.ataque} · 🛡 ${s.armadura} · ❤ ${s.hp} · ocupa ${u.espacio}` }),
        enviados ? el('div', { clase: 'pequeño', texto: `🚩 ${enviados} están fuera de la aldea` }) : null
      ])
    ]))
  }
  zona.appendChild(lista)

  // el reparto en escuadrones es lo que decide la defensa: que se vea desde aquí
  const esc = listaEscuadrones()
  if (esc.length) {
    const sin = flancosDescubiertos(esc)
    zona.appendChild(el('button', {
      clase: sin.length ? 'btn btn-peligro btn-gordo' : 'btn btn-piedra btn-gordo', type: 'button',
      texto: sin.length ? `🚩 Nadie guarda el ${sin[0]}: reparte tu hueste` : `🚩 Tus ${esc.length} escuadrones`,
      onclick: () => { solapa = 'escuadrones'; reparto = null; pintar() }
    }))
  }

  zona.appendChild(el('button', {
    clase: 'btn btn-oro btn-gordo', type: 'button', texto: '⚒️ Entrenar más tropa',
    onclick: () => { solapa = 'entrenar'; pintar() }
  }))
}

/* ===========================================================================
   1 bis. ESCUADRONES — repartir la hueste y plantarla en los flancos
   ===========================================================================
   La hueste dejó de ser un montón: son varias formaciones con nombre, cometido
   y SITIO. Y el sitio es lo que decide la defensa, no el número: el mismo
   asedio por el norte con la tropa al norte se salda con el 12 % de la aldea
   arrasada; con esa misma tropa al sur, se pierde entera. Toda esta pestaña
   existe para que el jugador entienda eso ANTES de que se lo enseñe el humo.
   =========================================================================== */

/** Los mismos seis tonos que render/units.js le pone al paño de cada estandarte. */
const COLORES_ESCUADRON = ['#1e88e5', '#ffc107', '#3f9d6b', '#7e57c2', '#4f9e8b', '#c98a4b']
/** El color va pegado al ID, igual que en el render: disolver uno no repinta a los demás. */
function colorEscuadron (id, i = 0) {
  const m = /(\d+)/.exec(String(id || ''))
  const k = m ? Number(m[1]) - 1 : i
  const n = COLORES_ESCUADRON.length
  return COLORES_ESCUADRON[((k % n) + n) % n]
}

const FLANCOS = ['norte', 'este', 'sur', 'oeste']
const FLECHA = { norte: '⬆️', sur: '⬇️', este: '➡️', oeste: '⬅️', centro: '⭕' }
/** Lo que sim/combat da por "estaba ahí": más de esto es llegar con la pelea empezada. */
const SEG_A_TIEMPO = 6
/** Mismos números que sim/combat.js: 1,6 casillas por segundo y tope de 45 s. */
const AVISO_CASILLAS_SEG = 1.6
const REACCION_MAX = 45

const listaEscuadrones = () => pedir(Ejercito, 'escuadrones', [], []) || []
const flancoDe = (x, z) => pedir(Ejercito, 'flancoDe', [x, z], 'centro') || 'centro'

/** Por dónde entra una hueste que ataca por ese flanco (como en sim/combat.js). */
function puntoEntrada (flanco) {
  const l = limitesDelTerritorio(game.state)
  const cx = (l.x0 + l.x1) / 2
  const cz = (l.z0 + l.z1) / 2
  if (flanco === 'norte') return { x: cx, z: l.z0 + 1 }
  if (flanco === 'sur') return { x: cx, z: l.z1 - 1 }
  if (flanco === 'este') return { x: l.x1 - 1, z: cz }
  return { x: l.x0 + 1, z: cz }
}

/**
 * SEGUNDOS DE REACCIÓN: lo que tarda ese puesto en entrar en la pelea si la
 * hueste entra por ese flanco. Es la cuenta EXACTA que hace el motor de
 * combate, no una aproximación bonita: si aquí pone 14 s, en la batalla son 14.
 */
function segundosHasta (puesto, flanco) {
  const e = puntoEntrada(flanco)
  return Math.min(REACCION_MAX, Math.hypot((puesto?.x ?? 0) - e.x, (puesto?.z ?? 0) - e.z) / AVISO_CASILLAS_SEG)
}

/**
 * Quién guarda cada flanco: el escuadrón de DEFENSA con gente en casa que antes
 * llegaría. `guardado` es el que está ahí de verdad, no el que llega tarde.
 * @param {Array} [lista] para simular un puesto antes de confirmarlo
 */
function coberturaDeFlancos (lista = listaEscuadrones()) {
  const salida = {}
  for (const f of FLANCOS) {
    let mejor = null
    for (const q of lista) {
      if (q.cometido !== 'defensa' || !q.totalEnCasa) continue
      const s = segundosHasta(q.puesto, f)
      if (!mejor || s < mejor.segundos) mejor = { escuadron: q, segundos: s }
    }
    salida[f] = mejor ? { ...mejor, guardado: mejor.segundos <= SEG_A_TIEMPO } : null
  }
  return salida
}

/** La lista de escuadrones como quedaría si ESE se plantara en esa casilla. */
function listaSimulada (id, x, z) {
  return listaEscuadrones().map(q => q.id === id
    ? { ...q, puesto: { x, z }, flanco: flancoDe(x, z) }
    : q)
}

/** Los flancos que quedarían sin nadie que llegue a tiempo. */
const flancosDescubiertos = (lista) => FLANCOS.filter(f => !coberturaDeFlancos(lista)[f]?.guardado)

/** «el este, el sur y el oeste» — una lista que se lee, no un "y" detrás de otro. */
function enumerar (lista, articulo = 'el ') {
  const l = lista.map(x => `${articulo}${x}`)
  if (l.length <= 1) return l[0] || ''
  return `${l.slice(0, -1).join(', ')} y ${l[l.length - 1]}`
}

/** La tropa de un escuadrón en iconos: `🗡️ 6 · 🏹 3`. */
function tropaEnLinea (tropas) {
  const partes = []
  for (const [t, n] of Object.entries(tropas || {})) {
    if (!n) continue
    partes.push(`${UNIDADES[t]?.icono || '🧍'} ${n}`)
  }
  return partes.length ? partes.join('  ·  ') : 'sin nadie dentro'
}

/** Cuadrito de color del escuadrón: lo que lo empareja con su estandarte en la aldea. */
const marcaColor = (color, lado = 18) => el('i', {
  estilo: {
    width: `${lado}px`, height: `${lado}px`, borderRadius: '4px', flex: 'none',
    background: color, border: '2px solid rgba(40,25,15,.5)', display: 'inline-block'
  }
})

// ------------------------------------------------------------- la pestaña ---

function vistaEscuadrones (zona) {
  const lista = listaEscuadrones()
  if (!lista.length) {
    zona.appendChild(el('div', { clase: 'panel tenue', texto: 'La hueste no se puede repartir ahora mismo.' }))
    return
  }
  const cob = coberturaDeFlancos(lista)
  const enCasa = lista.reduce((a, q) => a + q.totalEnCasa, 0)
  const acogida = lista.find(q => q.acogida) || lista[0]
  const sinRepartir = acogida ? acogida.totalEnCasa : 0
  const descubiertos = FLANCOS.filter(f => !cob[f]?.guardado)

  // --- la brújula: por dónde estás guardado y por dónde no ---
  const brujula = el('div', { clase: 'panel col' }, [
    el('div', { clase: 'fila fila-sep' }, [
      el('span', { clase: 'titular', texto: '🧭 Tus flancos' }),
      chip('🛡️', `${4 - descubiertos.length}/4 guardados`, { tono: descubiertos.length ? (descubiertos.length >= 3 ? 'mal' : '') : 'bien' })
    ])
  ])
  for (const f of FLANCOS) {
    const c = cob[f]
    const texto = !c
      ? 'nadie: no tienes tropa de defensa en casa'
      : c.guardado
        ? `${c.escuadron.nombre} · está ahí mismo`
        : `${c.escuadron.nombre} tarda ${Math.round(c.segundos)} s en llegar`
    brujula.appendChild(el('div', { clase: 'fila fila-sep', estilo: { gap: '8px' } }, [
      el('span', { estilo: { fontWeight: '800', flex: 'none', minWidth: '92px' }, texto: `${FLECHA[f]} ${f[0].toUpperCase()}${f.slice(1)}` }),
      el('span', { clase: 'pequeño crece', estilo: { textAlign: 'right', color: c?.guardado ? '' : 'var(--rojo-oscuro)' }, texto })
    ]))
  }
  brujula.appendChild(el('div', {
    clase: 'pequeño',
    estilo: { lineHeight: '1.35', borderTop: '2px dashed rgba(90,58,34,.25)', paddingTop: '8px' },
    texto: descubiertos.length
      ? `⚠️ Si entran por ${enumerar(descubiertos)}, tu tropa llega con la batalla empezada. Plántala en ese lado.`
      : '✅ Entren por donde entren, tienes gente peleando desde el primer segundo.'
  }))
  zona.appendChild(brujula)

  // --- cuánta gente hay y cuánta sigue sin repartir ---
  zona.appendChild(el('div', { clase: 'fila', estilo: { flexWrap: 'wrap' } }, [
    chip('🧍', `${enCasa} en casa`, { tono: enCasa ? '' : 'mal' }),
    chip('🚩', `${lista.length} ${lista.length === 1 ? 'escuadrón' : 'escuadrones'}`, {}),
    chip('🏠', sinRepartir ? `${sinRepartir} sin repartir` : 'todo repartido', { tono: sinRepartir ? 'oro' : 'bien' })
  ]))
  if (sinRepartir && lista.length > 1) {
    zona.appendChild(el('div', {
      clase: 'pequeño tenue', estilo: { lineHeight: '1.35' },
      texto: `Los ${sinRepartir} de ${acogida.nombre} son los que todavía no has mandado a ningún flanco: ahí caen los reclutas nuevos.`
    }))
  }

  // --- plantillas: lo que le falta a cada uno y el botón de entrenarlo ---
  zona.appendChild(bloquePlantillas(lista))

  // --- una tarjeta por escuadrón ---
  for (const q of lista) zona.appendChild(tarjetaEscuadron(q, cob))

  // --- levantar uno nuevo ---
  const tope = lista.length >= 6
  zona.appendChild(el('div', { clase: 'panel col' }, [
    el('div', { clase: 'titular', texto: '➕ Levantar otro escuadrón' }),
    el('div', { clase: 'pequeño tenue', estilo: { lineHeight: '1.35' }, texto: tope ? 'Seis es el tope: más formaciones no se gobiernan con el dedo.' : 'Nace vacío y en un flanco libre. Luego le mandas tropa y lo plantas donde quieras.' }),
    el('div', { estilo: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } }, [
      el('button', {
        clase: 'btn btn-piedra', type: 'button', texto: '🛡️ De defensa', disabled: tope,
        estilo: { minHeight: '48px' },
        onclick: () => crear('defensa')
      }),
      el('button', {
        clase: 'btn btn-piedra', type: 'button', texto: '⚔️ De ataque', disabled: tope,
        estilo: { minHeight: '48px' },
        onclick: () => crear('ataque')
      })
    ])
  ]))

  function crear (cometido) {
    const r = pedir(Ejercito, 'crearEscuadron', ['', cometido], { ok: false, motivo: 'No se pudo' })
    if (!r || !r.ok) { toast(r?.motivo || 'No se pudo levantar', 'mal'); return }
    pintar()
  }
}

/** Una formación: quién es, qué lleva, dónde está y qué se puede hacer con ella. */
function tarjetaEscuadron (q, cob) {
  const color = colorEscuadron(q.id)
  const ataca = q.cometido === 'ataque'
  const caja = el('div', { clase: 'tarjeta col', estilo: { borderLeft: `6px solid ${color}`, gap: '8px' } })

  caja.appendChild(el('div', { clase: 'fila fila-sep', estilo: { gap: '8px' } }, [
    el('div', { clase: 'fila', estilo: { gap: '8px', alignItems: 'center', minWidth: '0' } }, [
      marcaColor(color),
      el('span', { clase: 'tarjeta-nombre', texto: q.nombre })
    ]),
    chip(ataca ? '⚔️' : '🛡️', ataca ? 'ataque' : 'defensa', { tono: ataca ? 'oro' : 'bien' })
  ]))

  // dónde está plantado y qué significa
  const sug = ataca
    ? 'Sale a los asaltos: no cuenta como guardia de la aldea.'
    : cob[q.flanco]?.escuadron?.id === q.id
      ? `Guarda el flanco ${q.flanco}: si entran por ahí, pelea desde el primer segundo.`
      : `Está en el ${q.flanco}. Si entran por otro lado, tarda en llegar.`
  caja.appendChild(el('div', { clase: 'col', estilo: { gap: '2px' } }, [
    el('div', { clase: 'tarjeta-detalle', texto: `${FLECHA[q.flanco] || '⭕'} casilla ${q.puesto.x},${q.puesto.z}${q.fijado ? '' : ' · puesto automático'}` }),
    el('div', { clase: 'pequeño', estilo: { lineHeight: '1.3' }, texto: sug })
  ]))

  caja.appendChild(el('div', { clase: 'panel col', estilo: { padding: '8px 10px', margin: '0', gap: '4px' } }, [
    el('div', { clase: 'pequeño', estilo: { fontWeight: '800' }, texto: tropaEnLinea(q.enCasa) }),
    el('div', { clase: 'fila fila-sep', estilo: { gap: '8px' } }, [
      el('span', {
        clase: 'pequeño tenue crece', estilo: { lineHeight: '1.3' },
        texto: q.plantilla
          ? `📋 pide ${tropaEnLinea(q.plantilla)}${q.auto === false ? ' · a mano' : ''}`
          : '📋 sin plantilla: lo repartes a mano'
      }),
      q.plantilla
        ? chip(q.completo ? '✅' : '⚠️', q.completo ? 'completo' : `faltan ${q.faltan}`, { tono: q.completo ? 'bien' : 'oro' })
        : null
    ])
  ]))

  caja.appendChild(el('div', { clase: 'fila', estilo: { flexWrap: 'wrap' } }, [
    chip('🧍', `${q.totalEnCasa} en casa`, { tono: q.totalEnCasa ? '' : 'mal' }),
    chip('💪', formatoNumero(q.poder), { tono: 'oro' }),
    q.total > q.totalEnCasa ? chip('🚩', `${q.total - q.totalEnCasa} fuera`, {}) : null,
    q.acogida ? chip('🏠', 'reserva', {}) : null
  ]))

  if (!ataca && !q.totalEnCasa) {
    caja.appendChild(el('div', { clase: 'pequeño no-alcanzable', texto: '⚠️ Está vacío: ese flanco no lo guarda nadie.' }))
  }

  caja.appendChild(el('button', {
    clase: 'btn btn-oro btn-gordo', type: 'button', texto: '🚩 Plantar aquí en el mapa',
    estilo: { minHeight: '52px' },
    onclick: () => plantarEnMapa(q.id)
  }))

  caja.appendChild(el('button', {
    clase: q.plantilla ? 'btn btn-piedra' : 'btn btn-oro', type: 'button',
    texto: q.plantilla ? `📋 Plantilla (${q.pideTotal}) · se sirve ${q.prioridad}º` : '📋 Fijar plantilla y olvidarte',
    estilo: { minHeight: '52px' },
    onclick: () => hojaPlantilla(q.id)
  }))

  caja.appendChild(el('div', { estilo: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } }, [
    el('button', {
      clase: 'btn btn-piedra', type: 'button', texto: '🔀 Repartir tropa',
      estilo: { minHeight: '48px' },
      onclick: () => { reparto = { de: q.id, a: null, mueve: {} }; pintar() }
    }),
    el('button', {
      clase: 'btn btn-piedra', type: 'button', texto: ataca ? '🛡️ Que se quede' : '⚔️ Que salga',
      estilo: { minHeight: '48px' },
      onclick: () => {
        const r = pedir(Ejercito, 'fijarCometido', [q.id, ataca ? 'defensa' : 'ataque'], { ok: false, motivo: 'No se pudo' })
        if (!r || !r.ok) { toast(r?.motivo || 'No se pudo', 'mal'); return }
        pintar()
      }
    })
  ]))

  caja.appendChild(el('div', { estilo: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' } }, [
    el('button', {
      clase: 'btn btn-fantasma', type: 'button', texto: '👁️ Ver',
      estilo: { minHeight: '48px' },
      onclick: () => {
        events.emit(EV.CAMERA_FOCUS, { x: q.puesto.x, z: q.puesto.z, zoom: 26 })
        panel?.cerrar()
      }
    }),
    el('button', {
      clase: 'btn btn-fantasma', type: 'button', texto: '✏️ Nombre',
      estilo: { minHeight: '48px' },
      onclick: () => pedirNombre(q)
    }),
    el('button', {
      clase: 'btn btn-fantasma', type: 'button', texto: '🗑️ Disolver',
      estilo: { minHeight: '48px' },
      onclick: async () => {
        if (!await confirmar({
          titulo: `Disolver ${q.nombre}`,
          texto: q.total ? `Sus ${q.total} soldados pasan al primer escuadrón. No se pierde a nadie.` : 'No lleva a nadie dentro.',
          si: 'Disolver', no: 'Dejarlo'
        })) return
        const r = pedir(Ejercito, 'borrarEscuadron', [q.id], { ok: false, motivo: 'No se pudo' })
        if (!r || !r.ok) { toast(r?.motivo || 'No se pudo', 'mal'); return }
        pintar()
      }
    })
  ]))

  return caja
}

/** Nombre nuevo, con cuatro sugerencias para no pelearse con el teclado. */
const NOMBRES_SUGERIDOS = ['La Guardia', 'Hueste del Norte', 'Los del Vado', 'Mesnada Vieja', 'Lobos del Sur', 'La Reserva']
function pedirNombre (q) {
  const campo = el('input', {
    type: 'text', valor: q.nombre, maxlength: '24',
    estilo: {
      width: '100%', minHeight: '52px', fontSize: '1.05em', padding: '0 12px',
      borderRadius: '12px', border: '2px solid rgba(90,58,34,.35)', font: 'inherit', boxSizing: 'border-box'
    }
  })
  const sugerencias = el('div', { clase: 'fila', estilo: { flexWrap: 'wrap', gap: '6px' } })
  for (const n of NOMBRES_SUGERIDOS) {
    sugerencias.appendChild(el('button', {
      clase: 'btn btn-fantasma', type: 'button', texto: n,
      estilo: { minHeight: '44px', padding: '0 12px', fontSize: '.85em' },
      onclick: () => { campo.value = n }
    }))
  }
  const guardar = () => {
    const r = pedir(Ejercito, 'renombrarEscuadron', [q.id, campo.value], { ok: false, motivo: 'Ponle un nombre' })
    if (!r || !r.ok) { toast(r?.motivo || 'Ponle un nombre', 'mal'); return }
    sub.cerrar()
    toast(`Ahora se llama ${r.nombre}`, 'bien', 1600)
    pintar()
  }
  const sub = hoja({
    titulo: '✏️ Nombre del escuadrón',
    contenido: [
      el('div', { clase: 'pequeño tenue', estilo: { lineHeight: '1.35' }, texto: 'Ponle uno que reconozcas de un vistazo: es el que sale en el parte de la batalla.' }),
      campo,
      sugerencias
    ],
    pie: [el('button', { clase: 'btn btn-oro btn-gordo', type: 'button', texto: 'Guardar', estilo: { minHeight: '52px', width: '100%' }, onclick: guardar })]
  })
  campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); guardar() } })
  setTimeout(() => { try { campo.focus(); campo.select() } catch { /* da igual */ } }, 80)
}

/* ---------------------------------------------------------- plantillas ---
   La plantilla es lo que el jugador quiere que tenga un escuadrón. Se fija una
   vez con los mismos −/+ de siempre y a partir de ahí la tropa nueva se coloca
   sola. Aquí solo se pinta y se pregunta: quien reparte es sim/army.js.
   ------------------------------------------------------------------------ */

/** Los tipos que tiene sentido meter en una plantilla: tropa de combate y nada más. */
function tiposDePlantilla (q) {
  const dentro = new Set([...Object.keys(q?.plantilla || {}), ...Object.keys(q?.tropas || {})])
  return ENTRENABLES.filter(t => {
    const u = UNIDADES[t]
    if (!u || !(u.espacio > 0)) return false
    if (dentro.has(t)) return true
    const permiso = pedir(Ejercito, 'puedeEntrenar', [t, 1], null)
    // Se enseña lo que hoy sabes sacar, aunque ahora mismo no te llegue el dinero.
    return !permiso || permiso.ok || /recursos|cabe/i.test(permiso.motivo || '')
  })
}

/**
 * EL RESUMEN DE ARRIBA: cuántos escuadrones están completos, qué falta en total
 * y el botón que encarga de una vez toda la tropa que hace falta.
 */
function bloquePlantillas (lista) {
  const info = pedir(Ejercito, 'faltaDePlantillas', [], null)
  const caja = el('div', { clase: 'panel col' })

  if (!info || !info.conPlantilla) {
    caja.append(
      el('div', { clase: 'titular', texto: '📋 Plantillas: repartir una vez y no volver' }),
      el('div', {
        clase: 'pequeño', estilo: { lineHeight: '1.4' },
        texto: 'Dile a un escuadrón qué quieres que lleve («6 lanceros, 4 arqueros») y la tropa nueva se coloca sola ahí: al salir del cuartel, al curarse un herido y al volver de un asalto. No tendrás que repartir a mano cada vez que renueves el ejército.'
      }),
      el('div', { clase: 'pequeño tenue', texto: 'Se fija abajo, en cada escuadrón: 📋 Plantilla.' })
    )
    return caja
  }

  const plan = pedir(Ejercito, 'planDeRelleno', [], null)
  const completos = info.completos === info.conPlantilla

  caja.appendChild(el('div', { clase: 'fila fila-sep' }, [
    el('span', { clase: 'titular', texto: '📋 Tus plantillas' }),
    chip(completos ? '✅' : '⚠️', `${info.completos}/${info.conPlantilla} completos`, { tono: completos ? 'bien' : 'oro' })
  ]))

  for (const f of info.porEscuadron) {
    caja.appendChild(el('div', { clase: 'fila fila-sep', estilo: { gap: '8px' } }, [
      el('div', { clase: 'fila', estilo: { gap: '6px', alignItems: 'center', minWidth: '0' } }, [
        marcaColor(colorEscuadron(f.id), 12),
        el('span', { clase: 'pequeño', estilo: { fontWeight: '800' }, texto: `${f.prioridad}. ${f.nombre}` })
      ]),
      el('span', {
        clase: 'pequeño crece',
        estilo: { textAlign: 'right', color: f.completo ? '' : 'var(--rojo-oscuro)' },
        texto: f.completo ? '✅ completo' : `le faltan ${tropaEnLinea(f.falta)}`
      })
    ]))
  }

  if (completos) {
    caja.appendChild(el('div', {
      clase: 'pequeño', estilo: { lineHeight: '1.35', borderTop: '2px dashed rgba(90,58,34,.25)', paddingTop: '8px' },
      texto: '✅ Todos tus escuadrones están como los pediste. La tropa que entrenes de más se queda en la reserva.'
    }))
  } else {
    const enCamino = suma(plan?.camino || {})
    const pie = []
    if (plan && plan.total) {
      pie.push(`Encarga ${plan.total} de una vez: ${tropaEnLinea(plan.tropas)}.`)
      if (suma(plan.recortes || {}) > 0) pie.push(`Para ${suma(plan.recortes)} más no hay hueco o no llegan los recursos.`)
    } else if (enCamino) {
      pie.push('Lo que falta ya está en la cola del cuartel o en la enfermería: llegará solo.')
    } else {
      pie.push('Ahora mismo no hay hueco ni recursos para encargar lo que falta.')
    }
    for (const b of Object.values(plan?.bloqueados || {})) pie.push(`🔒 ${b.motivo}.`)
    caja.appendChild(el('div', {
      clase: 'pequeño', estilo: { lineHeight: '1.35', borderTop: '2px dashed rgba(90,58,34,.25)', paddingTop: '8px' },
      texto: pie.join(' ')
    }))

    if (plan && plan.total) {
      caja.appendChild(el('div', { clase: 'tarjeta-coste', html: costeHTML({ ...plan.coste, tiempo: plan.segundos }) }))
      caja.appendChild(el('button', {
        clase: 'btn btn-oro btn-gordo', type: 'button',
        texto: `⚒️ Entrenar lo que falta (${plan.total})`,
        estilo: { minHeight: '54px' },
        onclick: () => {
          const r = pedir(Ejercito, 'entrenarLoQueFalta', [], { ok: false, motivo: 'No se pudo' })
          if (!r || !r.ok) { toast(r?.motivo || 'No se pudo encargar', 'mal'); return }
          pintar()
        }
      }))
    }
  }

  caja.appendChild(el('button', {
    clase: 'btn btn-fantasma', type: 'button', texto: '🔁 Recolocar la tropa ahora',
    estilo: { minHeight: '48px' },
    onclick: () => { pedir(Ejercito, 'repartirAhora', [], null); pintar() }
  }))
  return caja
}

/** La hoja donde se fija la plantilla: −/+ con el dedo y atajos para no teclear. */
function hojaPlantilla (id) {
  const q = listaEscuadrones().find(e => e.id === id)
  if (!q) return
  const borrador = { ...(q.plantilla || {}) }
  const tipos = tiposDePlantilla(q)
  const total = () => listaEscuadrones().length

  const resumen = el('div', { clase: 'panel col', estilo: { gap: '6px' } })
  const filas = el('div', { clase: 'col' })
  let sub = null

  const refrescarResumen = () => {
    vaciar(resumen)
    const pide = suma(borrador)
    const huecos = Object.entries(borrador).reduce((a, [t, n]) => a + (UNIDADES[t]?.espacio || 0) * n, 0)
    resumen.append(
      el('div', { clase: 'fila', estilo: { flexWrap: 'wrap' } }, [
        chip('📋', pide ? `${pide} soldados` : 'sin plantilla', { tono: pide ? 'bien' : '' }),
        chip('🪑', `${huecos} de hueco`, {}),
        chip('🧍', `${q.total} dentro ahora`, {})
      ]),
      el('div', {
        clase: 'pequeño tenue', estilo: { lineHeight: '1.35' },
        texto: pide
          ? 'Cada vez que entre tropa nueva, esto se llenará solo hasta aquí.'
          : 'Sin plantilla, este escuadrón lo repartes tú a mano, como hasta ahora.'
      })
    )
  }

  for (const t of tipos) {
    const u = UNIDADES[t]
    const num = el('span', {
      clase: 'num', estilo: { flex: 'none', minWidth: '44px', textAlign: 'center', fontSize: '1.15em' },
      texto: `${borrador[t] || 0}`
    })
    const cambiar = (d) => {
      const v = Math.max(0, Math.min(99, (borrador[t] || 0) + d))
      if (v) borrador[t] = v; else delete borrador[t]
      num.textContent = `${v}`
      refrescarResumen()
    }
    filas.appendChild(el('div', { clase: 'tarjeta', estilo: { flexDirection: 'row', alignItems: 'center', gap: '6px' } }, [
      el('div', { clase: 'tarjeta-icono', texto: u?.icono || '🧍' }),
      el('div', { clase: 'tarjeta-cuerpo col crece', estilo: { gap: '0' } }, [
        el('div', { clase: 'tarjeta-nombre', texto: u?.nombre || t }),
        el('div', { clase: 'tarjeta-detalle', texto: `lleva ${q.tropas[t] || 0} · ocupa ${u?.espacio || 0}` })
      ]),
      el('button', { clase: 'btn btn-piedra', type: 'button', texto: '−', estilo: { flex: 'none', width: '48px', minHeight: '48px', padding: '0', fontSize: '1.3em' }, onclick: () => cambiar(-1) }),
      num,
      el('button', { clase: 'btn btn-piedra', type: 'button', texto: '+', estilo: { flex: 'none', width: '48px', minHeight: '48px', padding: '0', fontSize: '1.3em' }, onclick: () => cambiar(1) })
    ]))
  }

  // --- atajos: copiar lo que lleva ahora y vaciar ---
  const atajos = el('div', { estilo: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } }, [
    el('button', {
      clase: 'btn btn-piedra', type: 'button', texto: '📥 Usar lo que tengo ahora',
      estilo: { minHeight: '52px', fontSize: '.9em' },
      disabled: !q.total,
      onclick: () => {
        for (const k of Object.keys(borrador)) delete borrador[k]
        for (const [t, n] of Object.entries(q.tropas)) if (n > 0 && (UNIDADES[t]?.espacio > 0)) borrador[t] = n
        sub?.cerrar()
        const r = pedir(Ejercito, 'fijarPlantilla', [q.id, borrador], { ok: false, motivo: 'No se pudo' })
        if (!r || !r.ok) toast(r?.motivo || 'No se pudo', 'mal')
        pintar()
      }
    }),
    el('button', {
      clase: 'btn btn-fantasma', type: 'button', texto: '↩️ Vaciar la cuenta',
      estilo: { minHeight: '52px', fontSize: '.9em' },
      onclick: () => {
        for (const k of Object.keys(borrador)) delete borrador[k]
        for (const n of filas.querySelectorAll('.num')) n.textContent = '0'
        refrescarResumen()
      }
    })
  ])

  // --- prioridad: a quién se sirve antes cuando no llega la tropa ---
  const prioridad = el('div', { clase: 'panel col', estilo: { gap: '6px' } })
  const pintarPrioridad = () => {
    const actual = listaEscuadrones().find(e => e.id === q.id)?.prioridad || 1
    vaciar(prioridad)
    prioridad.append(
      el('div', { clase: 'fila fila-sep' }, [
        el('span', { clase: 'titular', texto: '🥇 A quién se sirve antes' }),
        chip('#', `${actual} de ${total()}`, { tono: actual === 1 ? 'oro' : '' })
      ]),
      el('div', {
        clase: 'pequeño', estilo: { lineHeight: '1.35' },
        texto: actual === 1
          ? 'Es el primero: si no llega tropa para todos, este se completa entero y los demás esperan.'
          : `Hay ${actual - 1} por delante. Si la tropa no llega para todos, este se queda a medias.`
      }),
      el('div', { estilo: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } }, [
        el('button', {
          clase: 'btn btn-piedra', type: 'button', texto: '⬆️ Antes', estilo: { minHeight: '48px' },
          disabled: actual <= 1,
          onclick: () => { pedir(Ejercito, 'moverPrioridad', [q.id, -1], null); pintarPrioridad(); pintar() }
        }),
        el('button', {
          clase: 'btn btn-piedra', type: 'button', texto: '⬇️ Después', estilo: { minHeight: '48px' },
          disabled: actual >= total(),
          onclick: () => { pedir(Ejercito, 'moverPrioridad', [q.id, 1], null); pintarPrioridad(); pintar() }
        })
      ])
    )
  }
  pintarPrioridad()

  // --- el interruptor del automático ---
  const automatico = el('div', { clase: 'panel col', estilo: { gap: '6px' } })
  const pintarAuto = () => {
    const v = listaEscuadrones().find(e => e.id === q.id)
    const on = v ? v.auto !== false : true
    vaciar(automatico)
    automatico.append(
      el('div', { clase: 'fila fila-sep' }, [
        el('span', { clase: 'titular', texto: on ? '🔁 Se rellena solo' : '✋ Lo repartes tú' }),
        chip(on ? '✅' : '⛔', on ? 'automático' : 'a mano', { tono: on ? 'bien' : '' })
      ]),
      el('div', {
        clase: 'pequeño', estilo: { lineHeight: '1.35' },
        texto: on
          ? 'La tropa que entre se coloca aquí sola hasta cumplir la plantilla, y lo que le sobre se va a donde haga falta.'
          : 'Nadie le toca la tropa: ni le meten ni le quitan. Lo mueves tú con «Repartir tropa».'
      }),
      el('button', {
        clase: 'btn btn-fantasma', type: 'button', estilo: { minHeight: '48px' },
        texto: on ? '✋ Repartirlo yo a mano' : '🔁 Que se rellene solo',
        onclick: () => { pedir(Ejercito, 'fijarAutoReparto', [q.id, !on], null); pintarAuto(); pintar() }
      })
    )
  }
  pintarAuto()

  const guardar = () => {
    const r = suma(borrador)
      ? pedir(Ejercito, 'fijarPlantilla', [q.id, borrador], { ok: false, motivo: 'No se pudo' })
      : pedir(Ejercito, 'quitarPlantilla', [q.id], { ok: false, motivo: 'No se pudo' })
    if (!r || !r.ok) { toast(r?.motivo || 'No se pudo guardar', 'mal'); return }
    sub?.cerrar()
    pintar()
  }

  refrescarResumen()
  sub = hoja({
    titulo: `📋 Plantilla de ${q.nombre}`,
    contenido: [
      el('div', { clase: 'pequeño tenue', estilo: { lineHeight: '1.35' }, texto: 'Marca lo que quieres que lleve SIEMPRE. Se guarda y la tropa nueva se coloca aquí sola: al salir del cuartel, al curarse un herido y al volver de un asalto.' }),
      resumen,
      atajos,
      filas,
      prioridad,
      automatico,
      q.plantilla
        ? el('button', {
          clase: 'btn btn-fantasma', type: 'button', texto: '🗑️ Quitar la plantilla',
          estilo: { minHeight: '48px' },
          onclick: () => {
            pedir(Ejercito, 'quitarPlantilla', [q.id], null)
            sub?.cerrar()
            pintar()
          }
        })
        : null
    ],
    pie: [el('button', { clase: 'btn btn-oro btn-gordo', type: 'button', texto: 'Guardar plantilla', estilo: { minHeight: '52px', width: '100%' }, onclick: guardar })]
  })
}

// -------------------------------------------------------------- repartir ---

/**
 * Pasar gente de un escuadrón a otro. Se prepara entero aquí y se manda de UNA
 * llamada a `moverTropas()`: así el censo nunca se queda a medias y el render
 * no repinta la aldea en cada toquecito del dedo.
 */
function vistaReparto (zona) {
  const lista = listaEscuadrones()
  const de = lista.find(q => q.id === reparto.de)
  if (!de) { reparto = null; vistaEscuadrones(zona); return }
  const otros = lista.filter(q => q.id !== de.id)

  zona.appendChild(el('div', { clase: 'fila fila-sep' }, [
    el('button', { clase: 'btn btn-fantasma', type: 'button', texto: '‹ Escuadrones', estilo: { minHeight: '48px' }, onclick: () => { reparto = null; pintar() } }),
    el('span', { clase: 'titular', texto: 'Repartir tropa' })
  ]))

  if (!otros.length) {
    zona.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'titular', texto: 'Solo tienes un escuadrón' }),
      el('div', { clase: 'pequeño', estilo: { lineHeight: '1.4' }, texto: 'Para repartir hace falta otro al que mandar la gente. Levanta uno y vuelve.' }),
      el('button', {
        clase: 'btn btn-oro btn-gordo', type: 'button', texto: '➕ Levantar otro escuadrón',
        onclick: () => {
          const r = pedir(Ejercito, 'crearEscuadron', ['', 'defensa'], { ok: false, motivo: 'No se pudo' })
          if (!r || !r.ok) { toast(r?.motivo || 'No se pudo', 'mal'); return }
          reparto.a = r.escuadron?.id || null
          pintar()
        }
      })
    ]))
    return
  }

  if (!otros.some(q => q.id === reparto.a)) { reparto.a = otros[0].id; reparto.mueve = {} }
  const a = otros.find(q => q.id === reparto.a)

  // --- de quién a quién ---
  const cabecera = el('div', { clase: 'panel col' }, [
    el('div', { clase: 'fila', estilo: { gap: '8px', alignItems: 'center' } }, [
      marcaColor(colorEscuadron(de.id), 16),
      el('span', { estilo: { fontWeight: '800' }, texto: de.nombre }),
      el('span', { clase: 'tenue', texto: '→' }),
      marcaColor(colorEscuadron(a.id), 16),
      el('span', { estilo: { fontWeight: '800' }, texto: a.nombre })
    ]),
    el('div', { clase: 'pequeño tenue', texto: otros.length > 1 ? 'Elige a quién se la mandas:' : '' })
  ])
  if (otros.length > 1) {
    const fila = el('div', { clase: 'fila', estilo: { flexWrap: 'wrap', gap: '6px' } })
    for (const q of otros) {
      fila.appendChild(el('button', {
        clase: q.id === a.id ? 'btn btn-oro' : 'btn btn-piedra', type: 'button',
        estilo: { minHeight: '48px', padding: '0 12px', fontSize: '.9em' },
        texto: `${q.cometido === 'ataque' ? '⚔️' : '🛡️'} ${q.nombre}`,
        onclick: () => { reparto.a = q.id; reparto.mueve = {}; pintar() }
      }))
    }
    cabecera.appendChild(fila)
  }
  zona.appendChild(cabecera)

  // --- atajos ---
  const tipos = Object.keys(de.tropas || {}).filter(t => de.tropas[t] > 0)
  const aplicar = (f) => { for (const t of tipos) { const v = f(de.tropas[t]); if (v > 0) reparto.mueve[t] = v; else delete reparto.mueve[t] } pintar() }
  zona.appendChild(el('div', { estilo: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' } }, [
    el('button', { clase: 'btn btn-piedra', type: 'button', texto: '½ La mitad', estilo: { minHeight: '48px' }, disabled: !tipos.length, onclick: () => aplicar(n => Math.floor(n / 2)) }),
    el('button', { clase: 'btn btn-piedra', type: 'button', texto: '⬆️ Vaciar', estilo: { minHeight: '48px' }, disabled: !tipos.length, onclick: () => aplicar(n => n) }),
    el('button', { clase: 'btn btn-fantasma', type: 'button', texto: '↩️ Ninguno', estilo: { minHeight: '48px' }, disabled: !tipos.length, onclick: () => aplicar(() => 0) })
  ]))

  if (!tipos.length) {
    zona.appendChild(el('div', { clase: 'panel tenue', texto: `${de.nombre} no tiene a nadie dentro.` }))
    return
  }

  // --- una fila por tipo ---
  const resumen = el('div', { clase: 'fila', estilo: { flexWrap: 'wrap' } })
  const botonMandar = el('button', { clase: 'btn btn-oro btn-gordo', type: 'button', texto: '', estilo: { minHeight: '54px' } })

  function refrescar () {
    vaciar(resumen)
    const van = suma(reparto.mueve)
    const quedan = suma(de.tropas) - van
    resumen.append(
      chip('🏠', `${quedan} quedan en ${de.nombre}`, { tono: quedan ? '' : 'mal' }),
      chip('➡️', `${van} van a ${a.nombre}`, { tono: van ? 'bien' : '' })
    )
    botonMandar.textContent = van ? `Mandar ${van} ${van === 1 ? 'soldado' : 'soldados'} a ${a.nombre}` : 'Elige a cuántos mandas'
    botonMandar.disabled = !van
  }

  const filas = el('div', { clase: 'col' })
  for (const t of tipos) {
    const u = UNIDADES[t]
    const tope = de.tropas[t]
    const num = el('span', { clase: 'num', estilo: { flex: 'none', minWidth: '44px', textAlign: 'center', fontSize: '1.15em' }, texto: `${reparto.mueve[t] || 0}` })
    const cambiar = (d) => {
      const v = Math.max(0, Math.min(tope, (reparto.mueve[t] || 0) + d))
      if (v) reparto.mueve[t] = v; else delete reparto.mueve[t]
      num.textContent = `${v}`
      refrescar()
    }
    filas.appendChild(el('div', { clase: 'tarjeta', estilo: { flexDirection: 'row', alignItems: 'center', gap: '6px' } }, [
      el('div', { clase: 'tarjeta-icono', texto: u?.icono || '🧍' }),
      el('div', { clase: 'tarjeta-cuerpo col crece', estilo: { gap: '0' } }, [
        el('div', { clase: 'tarjeta-nombre', texto: u?.nombre || t }),
        el('div', { clase: 'tarjeta-detalle', texto: `${tope} en ${de.nombre}` })
      ]),
      el('button', { clase: 'btn btn-piedra', type: 'button', texto: '−', estilo: { flex: 'none', width: '48px', minHeight: '48px', padding: '0', fontSize: '1.3em' }, onclick: () => cambiar(-1) }),
      num,
      el('button', { clase: 'btn btn-piedra', type: 'button', texto: '+', estilo: { flex: 'none', width: '48px', minHeight: '48px', padding: '0', fontSize: '1.3em' }, onclick: () => cambiar(1) })
    ]))
  }
  zona.append(filas, el('div', { clase: 'panel col' }, [resumen, botonMandar]))

  botonMandar.addEventListener('click', () => {
    const van = suma(reparto.mueve)
    if (!van) return
    const r = pedir(Ejercito, 'moverTropas', [de.id, a.id, reparto.mueve], { ok: false, motivo: 'No se pudo' })
    if (!r || !r.ok) { toast(r?.motivo || 'No se pudo repartir', 'mal'); return }
    toast(`${van} ${van === 1 ? 'soldado pasa' : 'soldados pasan'} a ${a.nombre}`, 'bien')
    reparto = null
    pintar()
  })
  refrescar()
}

// ------------------------------------------ plantar un escuadrón en el mapa ---

/**
 * COLOCAR EN LA ALDEA. El panel se quita de en medio, la aldea se queda a la
 * vista y el dedo elige la casilla: es el mismo flujo que el fantasma de obra
 * (BUILD_MODE congela la cámara y enciende la rejilla, GRID_TAP va diciendo
 * dónde está el dedo) y se confirma con un botón, no con el toque, para que no
 * se plante la tropa de un roce.
 */
function plantarEnMapa (id) {
  const q = listaEscuadrones().find(e => e.id === id)
  if (!q) return
  salirDePlantar(true)
  quitarBarraHecho()
  plantando = { id, nombre: q.nombre, cometido: q.cometido, x: q.puesto.x, z: q.puesto.z, barra: null, hecho: false }
  panel?.cerrar()
  events.emit(EV.BUILD_MODE, { activo: true, tipo: null, escuadron: id, ancho: 1, alto: 1 })
  events.emit(EV.CAMERA_FOCUS, { x: q.puesto.x, z: q.puesto.z, zoom: 34 })
  plantando.quitarTap = events.on(EV.GRID_TAP, (p) => {
    if (!plantando || !p) return
    plantando.x = p.x | 0
    plantando.z = p.z | 0
    refrescarBarraPlantar()
  })
  crearBarraPlantar()
  toast(`Toca la casilla donde plantas a ${q.nombre}`, 'info', 2600)
}

function salirDePlantar (silencioso = false) {
  if (!plantando) return
  const p = plantando
  plantando = null
  p.quitarTap?.()
  p.barra?.caja.remove()
  events.emit(EV.BUILD_MODE, { activo: false, tipo: null, escuadron: null })
  if (!silencioso && !p.hecho) toast(`${p.nombre} se queda donde estaba`, 'info', 1600)
}

/** Cajón de fondo fijo para las dos barras flotantes: la del HUD, con sus márgenes. */
function cajaFlotante (color) {
  return el('div', {
    clase: 'panel',
    estilo: {
      position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '55',
      borderRadius: 'var(--r-g) var(--r-g) 0 0', borderBottom: 'none',
      borderTop: `5px solid ${color}`,
      padding: '10px 12px',
      paddingBottom: 'calc(10px + var(--seg-abajo))',
      paddingLeft: 'calc(12px + var(--seg-izq))', paddingRight: 'calc(12px + var(--seg-der))',
      boxShadow: 'var(--sombra-flotante)'
    }
  })
}

function crearBarraPlantar () {
  const color = colorEscuadron(plantando.id)
  const raiz = document.getElementById('hud') || document.body
  const caja = cajaFlotante(color)

  const flancoTxt = el('div', { estilo: { fontWeight: '800', fontSize: '1.05em' } })
  const casillaTxt = el('div', { clase: 'pequeño tenue' })
  const avisoTxt = el('div', { clase: 'pequeño', estilo: { lineHeight: '1.35', marginBottom: '8px' } })

  caja.appendChild(el('div', { clase: 'fila', estilo: { gap: '10px', marginBottom: '6px', alignItems: 'center' } }, [
    marcaColor(color, 22),
    el('div', { clase: 'crece col', estilo: { gap: '0' } }, [
      el('div', { estilo: { fontWeight: '800' }, texto: plantando.nombre }),
      flancoTxt, casillaTxt
    ])
  ]))
  caja.appendChild(avisoTxt)

  const confirmarBtn = el('button', {
    clase: 'btn btn-oro', type: 'button', texto: 'Plantar aquí',
    estilo: { minHeight: '56px', width: '100%', fontSize: '1.02em' },
    onclick: () => confirmarPlantar()
  })
  caja.appendChild(el('div', { estilo: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px' } }, [
    el('button', {
      clase: 'btn btn-piedra', type: 'button', texto: '✕', 'aria-label': 'Cancelar',
      estilo: { minWidth: '56px', minHeight: '56px', fontSize: '1.2em' },
      onclick: () => { salirDePlantar(); events.emit(EV.UI_PANEL, { panel: 'ejercito', datos: { solapa: 'escuadrones' } }) }
    }),
    confirmarBtn
  ]))

  raiz.appendChild(caja)
  plantando.barra = { caja, flancoTxt, casillaTxt, avisoTxt, confirmarBtn }
  refrescarBarraPlantar()
}

function refrescarBarraPlantar () {
  if (!plantando || !plantando.barra) return
  const b = plantando.barra
  const { id, x, z } = plantando
  const flanco = flancoDe(x, z)
  const esDefensa = plantando.cometido !== 'ataque'

  b.flancoTxt.textContent = `${FLECHA[flanco] || '⭕'} mirando al flanco ${flanco}`
  b.casillaTxt.textContent = `casilla ${x}, ${z}`

  const simulada = listaSimulada(id, x, z)
  const sin = flancosDescubiertos(simulada)
  const tardaAqui = Math.round(segundosHasta({ x, z }, flanco))

  if (!esDefensa) {
    b.avisoTxt.textContent = '⚔️ Es un escuadrón de ataque: saldrá a los asaltos y no guardará este flanco.'
    b.avisoTxt.style.color = ''
  } else if (sin.length) {
    // el precio exacto de mirar al lado que no es, en segundos
    const peor = sin.reduce((m, f) => {
      const s = Math.round(segundosHasta({ x, z }, f))
      return s > m.s ? { f, s } : m
    }, { f: sin[0], s: -1 })
    b.avisoTxt.textContent = `⚠️ Así te quedas sin guardia en ${enumerar(sin)}. Si entran por el ${peor.f}, desde aquí tardas ${peor.s} s en llegar: para entonces ya están dentro.`
    b.avisoTxt.style.color = 'var(--rojo-oscuro)'
  } else {
    b.avisoTxt.textContent = `✅ Aquí llega a tiempo por el ${flanco} (${tardaAqui} s) y ningún flanco se queda solo.`
    b.avisoTxt.style.color = ''
  }
}

function confirmarPlantar () {
  if (!plantando) return
  const { id, x, z, nombre } = plantando
  const r = pedir(Ejercito, 'fijarPuestoEscuadron', [id, x, z], { ok: false, motivo: 'No se pudo plantar ahí' })
  if (!r || !r.ok) { toast(r?.motivo || 'Ahí no se puede', 'mal'); return }
  plantando.hecho = true
  salirDePlantar(true)
  // sim/army.js ya ha cantado dónde se ha plantado; aquí solo se ofrece el
  // siguiente paso sin tapar la aldea, que es lo que el jugador quiere ver.
  barraHecho(`🚩 ${nombre} guarda el flanco ${flancoDe(r.x, r.z)}`)
}

let barraHechoNodo = null
function quitarBarraHecho () { barraHechoNodo?.remove(); barraHechoNodo = null }

function barraHecho (texto) {
  quitarBarraHecho()
  const raiz = document.getElementById('hud') || document.body
  const caja = cajaFlotante('var(--oro)')
  caja.appendChild(el('div', { estilo: { fontWeight: '800', marginBottom: '8px' }, texto }))
  caja.appendChild(el('div', { clase: 'pequeño tenue', estilo: { marginBottom: '8px' }, texto: 'Ya está formando ahí: mira la aldea.' }))
  caja.appendChild(el('div', { estilo: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } }, [
    el('button', {
      clase: 'btn btn-piedra', type: 'button', texto: '🚩 Plantar otro',
      estilo: { minHeight: '52px' },
      onclick: () => { quitarBarraHecho(); events.emit(EV.UI_PANEL, { panel: 'ejercito', datos: { solapa: 'escuadrones' } }) }
    }),
    el('button', {
      clase: 'btn btn-oro', type: 'button', texto: '✔️ Listo',
      estilo: { minHeight: '52px' },
      onclick: () => quitarBarraHecho()
    })
  ]))
  raiz.appendChild(caja)
  barraHechoNodo = caja
}

// ============================================================== 2. ENTRENAR ==

function vistaEntrenar (zona) {
  zona.appendChild(colaEntrenamiento())

  const oc = pedir(Ejercito, 'ocupacion', [], { usado: 0, total: 0 }) || { usado: 0, total: 0 }
  zona.appendChild(el('div', { clase: 'fila fila-sep pequeño' }, [
    el('span', { clase: 'tenue', texto: 'Hueco libre en la hueste' }),
    el('span', { clase: 'num', texto: `${Math.max(0, oc.total - oc.usado)}` })
  ]))

  const rejilla = el('div', { clase: 'col' })
  for (const tipo of ENTRENABLES) {
    const u = UNIDADES[tipo]
    const permiso = pedir(Ejercito, 'puedeEntrenar', [tipo, 1], { ok: false, motivo: 'No disponible' }) || { ok: false, motivo: '' }
    const s = statsDe(tipo)
    const tope = cabenAhora(tipo)
    const bloqueadaPorEdificio = !permiso.ok && !/recursos|cabe/i.test(permiso.motivo)

    const caja = el('div', { clase: ['tarjeta', bloqueadaPorEdificio && 'bloqueado'] })
    caja.appendChild(el('div', { clase: 'tarjeta-cabeza' }, [
      el('div', { clase: 'tarjeta-icono', texto: u.icono }),
      el('div', { clase: 'tarjeta-cuerpo col', estilo: { gap: '2px' } }, [
        el('div', { clase: 'fila fila-sep' }, [
          el('span', { clase: 'tarjeta-nombre', texto: u.nombre }),
          el('span', { clase: 'pequeño tenue', texto: `${ICONO.tiempo} ${formatoTiempo(u.tiempo)}` })
        ]),
        el('div', { clase: 'tarjeta-detalle', texto: `⚔ ${s.ataque} · 🛡 ${s.armadura} · ❤ ${s.hp} · ocupa ${u.espacio}` }),
        el('div', { clase: 'tarjeta-coste', html: costeHTML(costeUnidad(tipo, 1)) })
      ])
    ]))
    caja.appendChild(el('div', { clase: 'pequeño', estilo: { lineHeight: '1.35' }, texto: paraQueSirve(tipo) }))

    if (bloqueadaPorEdificio) {
      // en flujo normal, no con .bloqueado-motivo: ahí se monta encima del texto
      caja.appendChild(el('div', { estilo: { fontWeight: '800', textAlign: 'center' }, texto: `🔒 ${permiso.motivo}` }))
    } else {
      const botones = el('div', { clase: 'fila', estilo: { gap: '6px' } })
      const pedirTropa = (n) => {
        if (n < 1) { toast('No cabe ni una más, o no llegan los recursos', 'mal'); return }
        const r = pedir(Ejercito, 'entrenar', [tipo, n], { ok: false, motivo: 'No se pudo' })
        if (r && r.ok) pintar()
      }
      botones.appendChild(el('button', { clase: 'btn btn-oro crece', type: 'button', texto: '+1', disabled: !permiso.ok, onclick: () => pedirTropa(1) }))
      botones.appendChild(el('button', { clase: 'btn btn-piedra crece', type: 'button', texto: '+5', disabled: tope < 5, onclick: () => pedirTropa(5) }))
      botones.appendChild(el('button', {
        clase: 'btn btn-piedra crece', type: 'button', texto: tope > 0 ? `Llenar (${tope})` : 'Llenar',
        disabled: tope < 1, onclick: () => pedirTropa(tope)
      }))
      caja.appendChild(botones)
      if (!permiso.ok) caja.appendChild(el('div', { clase: 'pequeño no-alcanzable', texto: permiso.motivo }))
    }
    rejilla.appendChild(caja)
  }
  zona.appendChild(rejilla)
}

/** La cola: cuenta atrás por encargo, cancelar y acelerar con gemas. */
function colaEntrenamiento () {
  const caja = el('div', { clase: 'panel col' })
  const cola = game.state.ejercito?.cola || []
  if (!cola.length) {
    caja.appendChild(el('div', { clase: 'tenue', texto: 'No hay nadie entrenándose. El sargento se aburre.' }))
    return caja
  }

  caja.appendChild(el('div', { clase: 'fila fila-sep' }, [
    el('span', { clase: 'titular', texto: 'En el patio de armas' }),
    badge(cola.length, { suelto: true })
  ]))

  const primero = cola[0]
  const barra = barraProgreso(0, { gorda: true })
  const rotulo = el('div', { clase: 'fila fila-sep pequeño' }, [
    el('span', { texto: `${UNIDADES[primero.tipo]?.icono || ''} ${UNIDADES[primero.tipo]?.nombre || primero.tipo}` }),
    el('span', { clase: 'num', texto: '' })
  ])
  caja.append(rotulo, barra.nodo)
  reloj(() => {
    const c = game.state.ejercito?.cola || []
    if (!c.length) { if (panel && solapa === 'entrenar') pintar(); return }
    const it = c[0]
    const total = Math.max(1, it.fin - it.inicio)
    const resta = Math.max(0, it.fin - Date.now())
    barra.fijar(((total - resta) / total) * 100)
    rotulo.lastChild.textContent = formatoTiempo(resta / 1000)
  })

  // el resto de la cola, en fichas pequeñas que se pueden cancelar
  const resto = el('div', { clase: 'fila', estilo: { flexWrap: 'wrap', gap: '6px' } })
  cola.forEach((it, i) => {
    const u = UNIDADES[it.tipo]
    resto.appendChild(el('button', {
      clase: 'chip', type: 'button', title: `Cancelar ${u?.nombre || it.tipo}`,
      estilo: { minHeight: '40px' },
      onclick: async () => {
        if (!await confirmar({ titulo: 'Cancelar encargo', texto: `¿Sacar a ${u?.nombre || it.tipo} de la cola? Se devuelve lo que costó.`, si: 'Cancelar encargo', no: 'Dejarlo' })) return
        pedir(Ejercito, 'cancelar', [i], null)
        pintar()
      }
    }, [el('i', { texto: u?.icono || '⚔️' }), el('span', { clase: 'chip-valor', texto: '✕' })]))
  })
  caja.appendChild(resto)

  const total = cola[cola.length - 1].fin - Date.now()
  const gemas = Math.max(1, Math.ceil(total / 1000 / 60))
  caja.appendChild(el('button', {
    clase: 'btn btn-oro', type: 'button', texto: `💎 Acelerar la cola entera (${gemas})`,
    onclick: () => { pedir(Ejercito, 'acelerarEntrenamiento', [], null); pintar() }
  }))
  return caja
}

// ================================================================ 3. ATACAR ==

/** Cuántas horas de producción vale un botín. Es la única forma honrada de
 *  decirle al jugador si un asalto le compensa o no. */
function horasDeProduccion (recompensa) {
  const prod = pedir(Recursos, 'produccionPorMinuto', [], null)
  if (!prod) return 0
  let botin = 0
  let porMinuto = 0
  for (const r of ['madera', 'piedra', 'comida', 'oro']) {
    botin += recompensa?.[r] || 0
    porMinuto += prod[r] || 0
  }
  if (porMinuto <= 0 || botin <= 0) return 0
  return Math.round((botin / porMinuto / 60) * 10) / 10
}

/** La tropa más barata que hoy puedes encargar: qué es, qué cuesta y qué tarda. */
function queEntrenarYa () {
  const opciones = []
  for (const t of ENTRENABLES) {
    const u = UNIDADES[t]
    if (!u || u.espacio <= 0) continue
    const permiso = pedir(Ejercito, 'puedeEntrenar', [t, 1], null)
    if (!permiso || !permiso.ok) continue
    const valor = Object.values(u.coste || {}).reduce((a, b) => a + (b || 0), 0)
    opciones.push({ tipo: t, unidad: u, valor, caben: cabenAhora(t) })
  }
  if (!opciones.length) return null
  opciones.sort((a, b) => a.valor - b.valor)
  return opciones[0]
}

/** La cabecera de imperio: cuánto has sometido y cuánto renta. Que crecer se vea. */
function bloqueImperio () {
  const imp = pedir(Enemigos, 'imperio', [], null)
  if (!imp) return null
  const caja = el('div', { clase: 'panel col' }, [
    el('div', { clase: 'fila fila-sep' }, [
      el('span', { clase: 'titular', texto: '👑 Tu imperio' }),
      chip('🏳️', `${imp.vasallos} ${imp.vasallos === 1 ? 'vasallo' : 'vasallos'}`, { tono: imp.vasallos ? 'bien' : '' })
    ]),
    el('div', { clase: 'fila', estilo: { flexWrap: 'wrap' } }, [
      chip('🗺️', `${imp.comarcas} ${imp.comarcas === 1 ? 'comarca' : 'comarcas'}`, {}),
      chip('⚔️', `${imp.asaltosGanados} ${imp.asaltosGanados === 1 ? 'aldea doblegada' : 'aldeas doblegadas'}`, {}),
      imp.señores ? chip('🛡️', `${imp.señores} con castillo`, { tono: 'oro' }) : null,
      chip('📦', imp.tributoDiaTotal ? `${formatoNumero(imp.tributoDiaTotal)} de tributo al día` : 'sin tributo todavía', { tono: imp.tributoDiaTotal ? 'oro' : '' })
    ])
  ])
  if (!imp.vasallos) {
    caja.appendChild(el('div', { clase: 'pequeño tenue', estilo: { lineHeight: '1.35' }, texto: 'Derrota dos veces a un mismo rival y te jurará vasallaje: pagará tributo cada media hora, para siempre.' }))
  }
  return { caja, imp }
}

/** Los tuyos: cuánto pagan y cuándo toca la próxima entrega. */
function bloqueVasallos (imp) {
  if (!imp || !imp.lista.length) return null
  const caja = el('div', { clase: 'panel col' }, [
    el('div', { clase: 'titular', texto: '🏳️ Te pagan tributo' })
  ])
  for (const v of imp.lista) {
    const cuenta = el('span', { clase: 'num pequeño', texto: '' })
    reloj(() => {
      const resta = Math.max(0, (v.proximoTributo || 0) - Date.now()) / 1000
      cuenta.textContent = resta ? formatoTiempo(resta) : 'ya viene'
    })
    caja.appendChild(el('div', { clase: 'tarjeta', estilo: { flexDirection: 'row', alignItems: 'center', gap: '8px' } }, [
      el('div', { clase: 'tarjeta-icono', texto: v.icono || '🏳️' }),
      el('div', { clase: 'tarjeta-cuerpo col crece', estilo: { gap: '0' } }, [
        el('div', { clase: 'tarjeta-nombre', texto: v.nombre }),
        el('div', { clase: 'tarjeta-detalle', texto: `nivel ${v.nivel} · ${v.tributoTexto} · ${v.pagados} entregas` })
      ]),
      cuenta
    ]))
  }
  return caja
}

function vistaAtacar (zona) {
  pararBatalla()
  // La fuerza que cuenta aquí es la que usa el mundo para emparejarte: si la
  // tarjeta compara con otra escala, "igualado" deja de significar nada.
  const poder = pedir(Enemigos, 'poderJugadorActual', [], 0) || pedir(Ejercito, 'poderMilitar', [], 0) || 0
  const tropas = tropasDe()
  const sinTropa = !suma(tropas)

  const imperio = bloqueImperio()
  if (imperio) zona.appendChild(imperio.caja)

  // Sin tropa NO se esconden los rivales: se enseñan igual, con la receta de lo
  // que hay que entrenar. Que el juego parezca vacío es peor que perder una batalla.
  if (sinTropa) {
    const sug = queEntrenarYa()
    const cuerpo = [
      el('div', { clase: 'titular', texto: 'No tienes con qué atacar… todavía' })
    ]
    if (sug) {
      const u = sug.unidad
      cuerpo.push(el('div', { clase: 'pequeño', estilo: { lineHeight: '1.4' }, texto: `Entrena ${u.icono} ${u.nombre.toLowerCase()}s: cada uno tarda unos ${formatoTiempo(u.tiempo)} y ahora mismo te caben ${sug.caben}.` }))
      cuerpo.push(el('div', { html: costeHTML(costeUnidad(sug.tipo, 1), game.state.recursos) }))
      cuerpo.push(el('button', {
        clase: 'btn btn-oro btn-gordo', type: 'button', texto: `⚒️ Entrenar ${u.nombre.toLowerCase()}s`,
        onclick: () => { solapa = 'entrenar'; pintar() }
      }))
    } else {
      cuerpo.push(el('div', { clase: 'pequeño', texto: 'Todavía no puedes entrenar nada: te falta el cuartel o los recursos. Constrúyelo y vuelve.' }))
      cuerpo.push(el('button', {
        clase: 'btn btn-oro btn-gordo', type: 'button', texto: '🧱 Construir el cuartel',
        onclick: () => { panel?.cerrar(); events.emit(EV.UI_PANEL, { panel: 'construir', datos: { categoria: 'militar' } }) }
      }))
    }
    zona.appendChild(el('div', { clase: 'panel col' }, cuerpo))
  }

  // El emparejamiento usa la vara de world/enemies (poderJugadorActual), que NO
  // es la escala de poderMilitar(): mezclarlas hacía que un 'igualado' fuese un muro.
  const rivales = pedir(Enemigos, 'emparejar', [pedir(Enemigos, 'poderJugadorActual', [], poder)], []) || []
  if (!rivales.length) {
    zona.appendChild(el('div', { clase: 'panel col' }, [
      el('div', { clase: 'titular', texto: 'No hay a quién atacar todavía' }),
      el('div', { clase: 'tenue', texto: 'Nadie ha explorado lo suficiente. Manda una expedición y verás salir humo de chimeneas ajenas.' }),
      el('button', { clase: 'btn btn-piedra btn-gordo', type: 'button', texto: '🗺️ Abrir el mapa del valle', onclick: () => { panel?.cerrar(); events.emit(EV.UI_PANEL, { panel: 'mundo' }) } })
    ]))
  }

  if (rivales.length) {
    zona.appendChild(el('div', { clase: 'fila fila-sep' }, [
      el('span', { clase: 'tenue pequeño', texto: 'Tu fuerza' }),
      chip('💪', formatoNumero(poder), { tono: 'oro' })
    ]))
  }

  for (const r of rivales) {
    const e = r.enemigo
    const amenaza = pedir(Enemigos, 'amenazaPara', [e, poder], e.amenaza) || e.amenaza || ''
    const tono = r.etiqueta === 'cómodo' ? 'bien' : r.etiqueta === 'igualado' ? 'oro' : 'mal'
    const horas = horasDeProduccion(r.recompensa)
    const premio = r.recompensa || {}
    const caja = el('div', { clase: 'tarjeta col' }, [
      el('div', { clase: 'fila fila-sep' }, [
        el('div', { clase: 'tarjeta-nombre', texto: `${e.nombre}` }),
        chip('⚔️', r.etiqueta, { tono })
      ]),
      el('div', { clase: 'tarjeta-detalle', texto: `${e.titulo} · ${e.casa} · nivel ${e.nivel} · ${amenaza}` }),
      el('div', { clase: 'pequeño', estilo: { lineHeight: '1.35' }, texto: `🕵️ ${e.descripcion || pedir(Enemigos, 'describirBase', [e], '') || ''}` }),
      el('div', { html: costeHTML({ madera: premio.madera, piedra: premio.piedra, comida: premio.comida, oro: premio.oro }, { madera: 1e9, piedra: 1e9, comida: 1e9, oro: 1e9 }) }),
      el('div', { clase: 'fila', estilo: { flexWrap: 'wrap' } }, [
        premio.gemas ? chip('💎', `${premio.gemas}`, { tono: 'oro' }) : null,
        horas ? chip('⏳', `${horas} h de producción`, { tono: horas >= 2 ? 'bien' : '' }) : null,
        chip('💪', `${Math.round((r.ratio || 1) * 100)} % de tu fuerza`, { tono })
      ]),
      el('div', { clase: 'pequeño tenue', texto: r.consejo }),
      el('button', {
        clase: sinTropa ? 'btn btn-piedra btn-gordo' : 'btn btn-peligro btn-gordo',
        type: 'button',
        texto: sinTropa ? '🧍 Necesitas tropa para entrar' : `⚔️ Atacar a ${e.nombre.split(' ').slice(0, 2).join(' ')}`,
        onclick: () => {
          if (sinTropa) { solapa = 'entrenar'; pintar(); return }
          rival = r
          modoSeleccion = 'ataque'
          prepararAsalto()
        }
      })
    ])
    zona.appendChild(caja)
  }

  const misVasallos = bloqueVasallos(imperio?.imp)
  if (misVasallos) zona.appendChild(misVasallos)
}

// ---------------------------------------------------- plano de la base 2D ---

const COLOR_PLANO = {
  muralla: '#9a9284', puerta: '#c08a3e',
  torre_vigia: '#b3332b', torre_ballesta: '#8e1f19', castillo: '#7a1f19',
  ayuntamiento: '#d4a437',
  cuartel: '#6b503a', arqueria: '#6b503a', establo: '#6b503a', taller_asedio: '#6b503a',
  herreria: '#6b503a', universidad: '#6b503a', monasterio: '#8e7cc3', campamento_explorador: '#6b503a',
  serreria: '#4a8f3c', granja: '#9fbf3f', cantera: '#8d99a6', mina_oro: '#c9962a',
  almacen: '#a1662f', granero: '#a1662f', molino: '#a1662f', mercado: '#a1662f',
  casa: '#c98a4b', pozo: '#9aa0a6', estandarte: '#b3332b'
}

/**
 * Plano 2D de una base, visto desde arriba. Sin 3D y sin librerías: un canvas,
 * un rectángulo por edificio y ya. Devuelve el nodo y las manijas para animarlo.
 */
function crearPlano (base) {
  const edificios = (base.buildings || []).map((b, i) => ({
    id: b.id || `b${i}`, tipo: b.tipo, nivel: b.nivel || 1,
    x: b.x, z: b.z,
    ancho: (b.rot % 2) ? (EDIFICIOS[b.tipo]?.alto || 1) : (EDIFICIOS[b.tipo]?.ancho || 1),
    alto: (b.rot % 2) ? (EDIFICIOS[b.tipo]?.ancho || 1) : (EDIFICIOS[b.tipo]?.alto || 1),
    caido: false
  }))

  // encuadre: la base y dos casillas de margen, siempre cuadrado
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const e of edificios) {
    x0 = Math.min(x0, e.x); z0 = Math.min(z0, e.z)
    x1 = Math.max(x1, e.x + e.ancho); z1 = Math.max(z1, e.z + e.alto)
  }
  if (!edificios.length) { x0 = z0 = 0; x1 = z1 = base.grid || 24 }
  const margen = 2.5
  const ladoVista = Math.max(x1 - x0, z1 - z0) + margen * 2
  const ox = x0 - margen - (ladoVista - (x1 - x0) - margen * 2) / 2
  const oz = z0 - margen - (ladoVista - (z1 - z0) - margen * 2) / 2

  const lienzo = el('canvas', {
    estilo: {
      width: '100%', display: 'block', borderRadius: '14px',
      border: '2px solid #3a2415', background: '#cdbb93', touchAction: 'manipulation'
    }
  })
  const ctx = lienzo.getContext('2d')
  const vista = {
    lado: 'sur', tropas: [], destellos: [], objetivo: null, mostrarLados: true, pct: 0
  }

  const aPx = (x, z, escala) => ({ px: (x - ox) * escala, pz: (z - oz) * escala })

  function ajustar () {
    const ancho = Math.max(220, lienzo.clientWidth || 300)
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    lienzo.width = Math.round(ancho * dpr)
    lienzo.height = Math.round(ancho * dpr)
    lienzo.style.height = `${ancho}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    pintarPlano()
  }

  function pintarPlano () {
    const w = lienzo.width / (Math.min(2, window.devicePixelRatio || 1))
    const escala = w / ladoVista
    ctx.clearRect(0, 0, w, w)

    // suelo y rejilla tenue: da escala sin ensuciar
    ctx.fillStyle = '#cdbb93'
    ctx.fillRect(0, 0, w, w)
    ctx.strokeStyle = 'rgba(90,58,34,.10)'
    ctx.lineWidth = 1
    for (let i = 0; i <= ladoVista; i += 2) {
      const p = i * escala
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, w); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke()
    }

    // edificios
    for (const e of edificios) {
      const { px, pz } = aPx(e.x, e.z, escala)
      const aw = Math.max(3, e.ancho * escala - 1)
      const ah = Math.max(3, e.alto * escala - 1)
      if (e.caido) {
        ctx.fillStyle = 'rgba(60,45,30,.35)'
        ctx.fillRect(px, pz, aw, ah)
        ctx.strokeStyle = 'rgba(40,25,15,.55)'
        ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.moveTo(px, pz); ctx.lineTo(px + aw, pz + ah)
        ctx.moveTo(px + aw, pz); ctx.lineTo(px, pz + ah); ctx.stroke()
        continue
      }
      ctx.fillStyle = COLOR_PLANO[e.tipo] || '#b09a74'
      ctx.fillRect(px, pz, aw, ah)
      ctx.strokeStyle = 'rgba(40,25,15,.55)'
      ctx.lineWidth = 1
      ctx.strokeRect(px + .5, pz + .5, aw - 1, ah - 1)
      // las torres llevan punto: son lo que de verdad importa mirar
      if (e.tipo === 'torre_vigia' || e.tipo === 'torre_ballesta' || e.tipo === 'castillo') {
        ctx.fillStyle = '#fff3ec'
        ctx.beginPath(); ctx.arc(px + aw / 2, pz + ah / 2, Math.max(1.5, escala * 0.22), 0, 7); ctx.fill()
      }
      // el ayuntamiento, marcado: es el edificio que da la segunda estrella
      if (e.tipo === 'ayuntamiento' || e.tipo === 'castillo') {
        const cx = px + aw / 2; const cy = pz + ah / 2; const r = Math.max(3, escala * 0.55)
        ctx.strokeStyle = 'rgba(40,25,15,.85)'; ctx.lineWidth = 2.5
        ctx.strokeRect(px + 1.5, pz + 1.5, aw - 3, ah - 3)
        ctx.fillStyle = 'rgba(40,25,15,.85)'
        ctx.beginPath()
        ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy)
        ctx.closePath(); ctx.fill()
      }
    }

    // por dónde se entra
    if (vista.mostrarLados) {
      const flechas = {
        norte: [w / 2, 12, 0], sur: [w / 2, w - 12, 180],
        este: [w - 12, w / 2, 90], oeste: [12, w / 2, 270]
      }
      for (const [nombre, [fx, fy, giro]] of Object.entries(flechas)) {
        const activo = vista.lado === nombre
        ctx.save()
        ctx.translate(fx, fy); ctx.rotate((giro * Math.PI) / 180)
        ctx.fillStyle = activo ? '#1e88e5' : 'rgba(58,36,21,.35)'
        ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(8, 8); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill()
        ctx.restore()
      }
    }

    // tropas atacantes
    for (const t of vista.tropas) {
      const { px, pz } = aPx(t.x, t.z, escala)
      ctx.fillStyle = t.tono
      ctx.beginPath(); ctx.arc(px, pz, Math.max(2, escala * 0.30), 0, 7); ctx.fill()
      ctx.strokeStyle = 'rgba(20,12,6,.5)'; ctx.lineWidth = 1; ctx.stroke()
    }

    // golpes y fuego
    for (const d of vista.destellos) {
      const { px, pz } = aPx(d.x, d.z, escala)
      ctx.globalAlpha = Math.max(0, d.vida)
      ctx.fillStyle = d.tono
      ctx.beginPath(); ctx.arc(px, pz, escala * (1.6 - d.vida), 0, 7); ctx.fill()
      ctx.globalAlpha = 1
    }
  }

  return {
    nodo: lienzo, vista, edificios, ajustar, pintar: pintarPlano,
    centro: { x: (x0 + x1) / 2, z: (z0 + z1) / 2 },
    encuadre: { ox, oz, lado: ladoVista },
    /** Convierte un toque en el lado de entrada más cercano. */
    ladoDelToque (ev) {
      const r = lienzo.getBoundingClientRect()
      const dx = (ev.clientX - r.left) / r.width - 0.5
      const dy = (ev.clientY - r.top) / r.height - 0.5
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'este' : 'oeste') : (dy > 0 ? 'sur' : 'norte')
    },
    caer (id) {
      const e = edificios.find(x => x.id === id)
      if (e && !e.caido) { e.caido = true; return e }
      return null
    }
  }
}

/** Sin leyenda, un plano de rectángulos de colores no dice nada. */
function leyendaPlano () {
  const punto = (color, texto) => el('span', { clase: 'fila', estilo: { gap: '4px', fontSize: '.75em' } }, [
    el('i', { estilo: { width: '12px', height: '12px', borderRadius: '3px', background: color, border: '1px solid rgba(40,25,15,.55)', display: 'inline-block' } }),
    el('span', { texto })
  ])
  return el('div', { clase: 'fila', estilo: { flexWrap: 'wrap', gap: '4px 12px' } }, [
    punto(COLOR_PLANO.ayuntamiento, '◆ el corazón'),
    punto(COLOR_PLANO.torre_vigia, 'torres'),
    punto(COLOR_PLANO.muralla, 'muralla'),
    punto(COLOR_PLANO.casa, 'casas'),
    punto(COLOR_PLANO.serreria, 'producción'),
    punto(COLOR_PLANO.cuartel, 'militar')
  ])
}

/** La base del enemigo, lista para el motor de combate (ids, botín y nivel). */
function baseDeCombate (enemigo) {
  const premio = pedir(Enemigos, 'recompensaDe', [enemigo], null) || {}
  // las bases se levantan perezosamente: hay que pedirla antes de dibujar nada
  const suya = pedir(Enemigos, 'baseDe', [enemigo], null) || enemigo.base || { grid: 24, buildings: [] }
  // botinDe() se lleva como mucho la mitad de lo guardado: se dobla para que
  // arrasar del todo pague justo lo que la ficha prometía.
  const recursos = {}
  for (const r of ['madera', 'piedra', 'comida', 'oro']) recursos[r] = Math.round((premio[r] || 0) * 2)
  return {
    id: enemigo.id, nombre: enemigo.nombre, nivel: enemigo.nivel, grid: suya.grid || 24,
    buildings: (suya.buildings || []).map((b, i) => ({ ...b, id: b.id || `${enemigo.id}_b${i}` })),
    // su gente de armas: sin esto se asaltan ladrillos y nadie sale a recibirte
    guarnicion: { ...(enemigo.guarnicion || {}) },
    recursos
  }
}

/**
 * QUIÉN SALE Y QUIÉN SE QUEDA. Es la regla que más sorprende del juego: los
 * escuadrones de defensa NO van a los asaltos, se quedan en su puesto aunque tú
 * estés reventando el castillo del vecino. Si no se dice aquí, el jugador cuenta
 * soldados en la pestaña de Tropa y no entiende por qué salen la mitad.
 */
function bloqueQuienSale () {
  const lista = listaEscuadrones()
  const salen = lista.filter(q => q.cometido === 'ataque' && q.totalEnCasa)
  const quedan = lista.filter(q => q.cometido === 'defensa' && q.totalEnCasa)
  const caja = el('div', { clase: 'panel col' })

  if (!salen.length) {
    caja.append(
      el('div', { clase: 'titular', texto: '⚔️ No tienes escuadrones de ataque' }),
      el('div', { clase: 'pequeño', estilo: { lineHeight: '1.4' }, texto: 'Sin ninguno marcado como de ataque sale toda la tropa que haya en casa… y la aldea se queda sola. Marca uno para que sea SIEMPRE el que salga.' }),
      el('button', {
        clase: 'btn btn-piedra btn-gordo', type: 'button', texto: '🚩 Repartir en escuadrones',
        onclick: () => { rival = null; solapa = 'escuadrones'; reparto = null; pintar() }
      })
    )
    return caja
  }

  const linea = (titulo, grupo, tono) => {
    const fila = el('div', { clase: 'col', estilo: { gap: '2px' } })
    fila.appendChild(el('div', { clase: 'pequeño', estilo: { fontWeight: '800' }, texto: titulo }))
    for (const q of grupo) {
      fila.appendChild(el('div', { clase: 'fila', estilo: { gap: '8px', alignItems: 'center' } }, [
        marcaColor(colorEscuadron(q.id), 14),
        el('span', { clase: 'pequeño crece', texto: `${q.nombre} · ${q.totalEnCasa} ${q.totalEnCasa === 1 ? 'soldado' : 'soldados'}` }),
        el('span', { clase: 'pequeño tenue', texto: tono })
      ]))
    }
    if (!grupo.length) fila.appendChild(el('div', { clase: 'pequeño tenue', texto: '—' }))
    return fila
  }

  caja.append(
    el('div', { clase: 'titular', texto: 'Quién sale de la aldea' }),
    linea(`⚔️ Salen (${salen.reduce((a, q) => a + q.totalEnCasa, 0)})`, salen, 'al asalto'),
    el('div', { clase: 'separador' }),
    linea(`🛡️ Se quedan (${quedan.reduce((a, q) => a + q.totalEnCasa, 0)})`, quedan, 'guardando'),
    el('div', { clase: 'pequeño tenue', estilo: { lineHeight: '1.35' }, texto: 'Los de defensa no se mueven de su puesto ni aunque tú estés fuera: por eso la aldea aguanta mientras asaltas.' })
  )
  return caja
}

// ------------------------------------------------------ pantalla de preparar ---

function prepararAsalto () {
  if (!panel || !rival) return
  relojes = []
  const zona = vaciar(panel.zona)
  const e = rival.enemigo
  const base = baseDeCombate(e)
  const disponibles = tropasDe()

  // POR DEFECTO SALEN LOS DE ATAQUE Y NADIE MÁS. Antes se llevaba todo lo que
  // hubiera en casa y la aldea se quedaba desnuda sin que el jugador lo pidiera:
  // ahora el que se queda a guardar, se queda, y llevárselo hay que hacerlo a mano.
  const deAsalto = modoSeleccion === 'todo'
    ? disponibles
    : (pedir(Ejercito, 'tropasDeAsalto', [], null) || disponibles)
  seleccion = {}
  for (const [t, n] of Object.entries(deAsalto)) {
    if ((UNIDADES[t]?.espacio || 0) > 0 && n > 0) seleccion[t] = Math.min(n, disponibles[t] || 0)
    if (!seleccion[t]) delete seleccion[t]
  }

  zona.appendChild(el('div', { clase: 'fila fila-sep' }, [
    el('button', { clase: 'btn btn-fantasma', type: 'button', texto: '‹ Otro rival', onclick: () => { rival = null; pintar() } }),
    el('span', { clase: 'titular', texto: e.nombre })
  ]))

  // --- el plano ---
  const plano = crearPlano(base)
  plano.vista.lado = lado
  plano.nodo.addEventListener('pointerdown', (ev) => {
    lado = plano.ladoDelToque(ev)
    plano.vista.lado = lado
    plano.pintar()
    refrescarLados()
  })
  zona.appendChild(plano.nodo)
  zona.appendChild(leyendaPlano())
  requestAnimationFrame(() => plano.ajustar())

  const botonesLado = {}
  const filaLados = el('div', { clase: 'fila', estilo: { gap: '6px' } })
  for (const nombre of ['norte', 'sur', 'este', 'oeste']) {
    const b = el('button', {
      clase: 'btn btn-piedra crece', type: 'button', texto: nombre[0].toUpperCase() + nombre.slice(1),
      estilo: { padding: '10px 6px' },
      onclick: () => { lado = nombre; plano.vista.lado = nombre; plano.pintar(); refrescarLados() }
    })
    botonesLado[nombre] = b
    filaLados.appendChild(b)
  }
  function refrescarLados () {
    for (const [n, b] of Object.entries(botonesLado)) {
      b.className = `btn crece ${n === lado ? 'btn-oro' : 'btn-piedra'}`
    }
  }
  refrescarLados()
  zona.appendChild(el('div', { clase: 'col', estilo: { gap: '4px' } }, [
    el('div', { clase: 'pequeño tenue', texto: 'Toca el borde del plano para elegir por dónde entras.' }),
    filaLados
  ]))

  zona.appendChild(el('div', { clase: 'panel pequeño', estilo: { lineHeight: '1.35' }, texto: `🕵️ ${e.descripcion || ''}` }))

  // --- quién sale de casa y quién se queda guardándola ---
  zona.appendChild(bloqueQuienSale())

  // --- qué tropas llevo ---
  const resumen = el('div', { clase: 'fila', estilo: { flexWrap: 'wrap' } })
  const filas = el('div', { clase: 'col' })
  const tipos = Object.keys(disponibles).filter(t => (UNIDADES[t]?.espacio || 0) > 0 && disponibles[t] > 0)

  function actualizarResumen () {
    vaciar(resumen)
    const total = suma(seleccion)
    let poder = 0
    for (const [t, n] of Object.entries(seleccion)) {
      const s = statsDe(t)
      poder += (s.ataque * 2 + s.hp / 4) * (1 + s.armadura * 0.08) * n
    }
    resumen.append(
      chip('🧍', `${total} en la hueste`, { tono: total ? '' : 'mal' }),
      chip('💪', formatoNumero(Math.round(poder)), { tono: 'oro' }),
      chip('🏰', `rival ${formatoNumero(e.poder)}`, { tono: poder >= e.poder ? 'bien' : 'mal' })
    )
  }

  for (const t of tipos) {
    const u = UNIDADES[t]
    const num = el('span', { clase: 'num', estilo: { flex: 'none', minWidth: '40px', textAlign: 'center' }, texto: `${seleccion[t] || 0}` })
    const cambiar = (d) => {
      const v = Math.max(0, Math.min(disponibles[t], (seleccion[t] || 0) + d))
      if (v) seleccion[t] = v; else delete seleccion[t]
      num.textContent = `${v}`
      actualizarResumen()
    }
    filas.appendChild(el('div', { clase: 'tarjeta', estilo: { flexDirection: 'row', alignItems: 'center', gap: '6px' } }, [
      el('div', { clase: 'tarjeta-icono', texto: u.icono }),
      el('div', { clase: 'tarjeta-cuerpo col crece', estilo: { gap: '0' } }, [
        el('div', { clase: 'tarjeta-nombre', texto: u.nombre }),
        el('div', { clase: 'tarjeta-detalle', texto: `tienes ${disponibles[t]}` })
      ]),
      el('button', { clase: 'btn btn-piedra btn-icono', type: 'button', texto: '−', estilo: { flex: 'none', width: '46px', padding: '10px 0' }, onclick: () => cambiar(-1) }),
      num,
      el('button', { clase: 'btn btn-piedra btn-icono', type: 'button', texto: '+', estilo: { flex: 'none', width: '46px', padding: '10px 0' }, onclick: () => cambiar(1) })
    ]))
  }

  zona.appendChild(el('div', { clase: 'panel col' }, [
    el('div', { clase: 'titular', texto: 'Qué te llevas' }),
    el('div', { estilo: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } }, [
      el('button', {
        clase: modoSeleccion === 'ataque' ? 'btn btn-oro' : 'btn btn-piedra', type: 'button', texto: '⚔️ Solo los de ataque',
        estilo: { minHeight: '48px', fontSize: '.88em' },
        onclick: () => { modoSeleccion = 'ataque'; prepararAsalto() }
      }),
      el('button', {
        clase: modoSeleccion === 'todo' ? 'btn btn-oro' : 'btn btn-fantasma', type: 'button', texto: '😳 Todo, sin guardia',
        estilo: { minHeight: '48px', fontSize: '.88em' },
        onclick: () => {
          modoSeleccion = 'todo'
          toast('Cuidado: la aldea se queda sin quien la guarde', 'mal')
          prepararAsalto()
        }
      })
    ]),
    resumen, filas
  ]))
  actualizarResumen()

  zona.appendChild(el('button', {
    clase: 'btn btn-peligro btn-gordo', type: 'button', texto: '⚔️ ¡AL ASALTO!',
    onclick: () => {
      if (!suma(seleccion)) { toast('No has elegido ni un soldado', 'mal'); return }
      lanzar(base)
    }
  }))
}

// --------------------------------------------------------------- la batalla ---

/**
 * El campo de batalla en 3D (render/battle.js). Se carga la primera vez que se
 * ataca, no al arrancar: en móvil el arranque es sagrado. Si no estuviera, el
 * panel se queda con el plano 2D de toda la vida y nadie se entera del apaño.
 */
let Campo = null
async function cargarCampo () {
  if (Campo !== null) return Campo
  try { Campo = (await import('../render/battle.js')) } catch (err) {
    console.warn('[army-panel] sin campo de batalla 3D', err)
    Campo = false
  }
  return Campo
}

function pararBatalla () {
  if (reproduccion) { try { reproduccion.parar() } catch { /* da igual */ } reproduccion = null }
  if (animacion) { clearInterval(animacion); animacion = 0 }
}

async function lanzar (base) {
  if (!panel || !rival) return
  const tropas = { ...seleccion }
  const ladoElegido = lado
  const resultado = pedir(Combate, 'lanzarAsalto', [{ base, tropas, ladoEntrada: lado }], null)
  if (!resultado) { toast('El motor de batalla no responde', 'mal'); return }

  // --- lo normal: la batalla se ve en el terreno, en 3D ---
  const campo = await cargarCampo()
  if (campo && typeof campo.jugarBatalla === 'function') {
    const e = rival.enemigo
    const verla = () => campo.jugarBatalla({
      resultado,
      base,
      tropas,
      lado: ladoElegido,
      guarnicion: base.guarnicion,
      titulo: `La hueste entra por el ${ladoElegido} de ${e.nombre}`,
      repetir: verla,
      alSalir: () => events.emit(EV.UI_PANEL, { panel: 'ejercito', datos: { solapa: 'atacar' } })
    })
    panel?.cerrar()
    verla()
    return
  }

  // --- reserva: el plano 2D de siempre, si el 3D no está disponible ---
  relojes = []
  const zona = vaciar(panel.zona)
  const plano = crearPlano(base)
  plano.vista.lado = lado
  plano.vista.mostrarLados = false

  // --- valor total de la base: la barra de destrucción se calcula aquí ---
  let valorTotal = 0
  const valorDe = new Map()
  for (const e of plano.edificios) {
    const v = Math.max(1, valorEdificio(e.tipo, e.nivel))
    valorDe.set(e.id, v); valorTotal += v
  }
  let valorCaido = 0
  let principalCaido = false

  // --- cabecera: estrellas y barra ---
  const estrellasNodo = el('div', { estilo: { fontSize: '1.6em', letterSpacing: '4px' }, texto: '☆☆☆' })
  const pctNodo = el('span', { clase: 'num', texto: '0 %' })
  const barra = barraProgreso(0, { gorda: true, tono: 'mal' })
  zona.appendChild(el('div', { clase: 'panel col' }, [
    el('div', { clase: 'fila fila-sep' }, [estrellasNodo, pctNodo]),
    barra.nodo
  ]))
  zona.appendChild(plano.nodo)
  requestAnimationFrame(() => plano.ajustar())

  // --- la crónica ---
  const cronica = el('div', {
    clase: 'panel col',
    estilo: { maxHeight: '30vh', overflowY: 'auto', gap: '4px', fontSize: '.9em', lineHeight: '1.35' }
  })
  zona.appendChild(cronica)

  const pie = el('div', { clase: 'col' })
  zona.appendChild(pie)
  const botonSaltar = el('button', {
    clase: 'btn btn-piedra btn-gordo', type: 'button', texto: '⏩ Saltar la batalla',
    onclick: () => { try { reproduccion?.saltar() } catch { /* da igual */ } }
  })
  pie.appendChild(botonSaltar)

  // --- tropas de mentira sobre el plano: no se simula nada, se cuenta ---
  const TONO = { infanteria: '#1e88e5', distancia: '#43a047', caballeria: '#8e24aa', asedio: '#6d4c41', civil: '#f5eede' }
  const entrada = { norte: { x: plano.centro.x, z: plano.encuadre.oz + 1 }, sur: { x: plano.centro.x, z: plano.encuadre.oz + plano.encuadre.lado - 1 }, este: { x: plano.encuadre.ox + plano.encuadre.lado - 1, z: plano.centro.z }, oeste: { x: plano.encuadre.ox + 1, z: plano.centro.z } }[lado]
  const enviadas = suma(tropas)
  const muñecos = Math.min(36, Math.max(6, enviadas))
  for (let i = 0; i < muñecos; i++) {
    const t = Object.keys(tropas)[i % Object.keys(tropas).length]
    const giro = (i / muñecos) * Math.PI * 2
    plano.vista.tropas.push({
      x: entrada.x + (Math.random() - 0.5) * 6,
      z: entrada.z + (Math.random() - 0.5) * 6,
      // cada uno rodea el objetivo por su lado: si no, se amontonan en un solo punto
      ox: Math.cos(giro) * (1.2 + (i % 4) * 0.7),
      oz: Math.sin(giro) * (1.2 + (i % 4) * 0.7),
      tono: TONO[UNIDADES[t]?.clase] || '#1e88e5'
    })
  }
  plano.vista.objetivo = { x: plano.centro.x, z: plano.centro.z }

  // 15 fps bastan: es un plano, no un videojuego dentro del videojuego
  animacion = setInterval(() => {
    const o = plano.vista.objetivo
    for (const t of plano.vista.tropas) {
      const dx = o.x + t.ox - t.x, dz = o.z + t.oz - t.z
      const d = Math.hypot(dx, dz)
      if (d > 0.4) { t.x += (dx / d) * Math.min(0.34, d); t.z += (dz / d) * Math.min(0.34, d) }
      else { t.x += (Math.random() - 0.5) * 0.2; t.z += (Math.random() - 0.5) * 0.2 }
    }
    for (let i = plano.vista.destellos.length - 1; i >= 0; i--) {
      plano.vista.destellos[i].vida -= 0.12
      if (plano.vista.destellos[i].vida <= 0) plano.vista.destellos.splice(i, 1)
    }
    plano.pintar()
  }, 66)

  const linea = (texto, tono) => {
    cronica.appendChild(el('div', { clase: tono ? 'no-alcanzable' : '', texto }))
    while (cronica.children.length > 60) cronica.firstChild.remove()
    cronica.scrollTop = cronica.scrollHeight
  }

  const refrescarMarcador = () => {
    const pct = valorTotal ? (valorCaido / valorTotal) * 100 : 0
    let estrellas = 0
    if (pct >= 50) estrellas++
    if (principalCaido) estrellas++
    if (pct >= 99.5) estrellas++
    estrellas = Math.min(3, estrellas)
    estrellasNodo.textContent = '★★★☆☆☆'.slice(3 - estrellas, 6 - estrellas)
    pctNodo.textContent = `${Math.round(pct)} %`
    barra.fijar(pct)
  }

  const alSuceso = (s) => {
    if (!s) return
    if (s.tipo === 'edificio_caido') {
      const e = plano.caer(s.edificioId)
      if (e) { valorCaido += valorDe.get(e.id) || 0 }
      if (s.principal || (e && e.tipo === 'ayuntamiento')) principalCaido = true
      plano.vista.destellos.push({ x: s.x, z: s.z, tono: '#e25822', vida: 1 })
      plano.vista.objetivo = { x: s.x, z: s.z }
      refrescarMarcador()
    } else if (s.tipo === 'muro') {
      plano.vista.destellos.push({ x: s.x, z: s.z, tono: '#f2c85c', vida: .8 })
      plano.vista.objetivo = { x: s.x, z: s.z }
    } else if (s.tipo === 'bajas') {
      // solo aquí se quitan muñecos: 'siega' ya viene contado en estas bajas
      const caen = s.bajas ? suma(s.bajas) : 1
      for (let i = 0; i < caen && plano.vista.tropas.length > 1; i++) plano.vista.tropas.pop()
      plano.vista.destellos.push({ x: s.x, z: s.z, tono: '#b3332b', vida: .7 })
    } else if (s.tipo === 'siega') {
      plano.vista.destellos.push({ x: s.x, z: s.z, tono: '#b3332b', vida: .7 })
    }
    linea(s.texto, s.tipo === 'bajas' || s.tipo === 'siega' || s.tipo === 'derrota')
  }

  const alFinal = () => {
    if (animacion) { clearInterval(animacion); animacion = 0 }
    plano.vista.tropas.length = Math.min(plano.vista.tropas.length, Math.max(0, resultado.supervivientes))
    plano.pintar()
    botonSaltar.remove()
    parteFinal(pie, resultado, tropas, base)
  }

  // una batalla de tres minutos no se mira en el autobús: se acelera sin perder la gracia
  const velocidad = Math.max(1, Math.min(9, (resultado.duracion || 20) / 20))
  reproduccion = pedir(Combate, 'reproducir', [resultado, alSuceso, { velocidad, alFinal, emitirBus: false }], null)
  if (!reproduccion) { for (const s of resultado.sucesos || []) alSuceso(s); alFinal() }
}

/** El parte: estrellas, botín, bajas y por qué ha ido así. */
function parteFinal (pie, resultado, enviadas, base) {
  const estrellas = resultado.estrellas || 0
  const botin = resultado.botin || {}
  // `bajas` son los muertos de verdad; los malheridos vuelven y se curan solos.
  const bajas = resultado.bajas || {}
  const heridos = resultado.heridosTropas || {}
  const perdidas = suma(bajas)
  const malheridos = suma(heridos)
  const cayeron = suma(resultado.caidos) || perdidas + malheridos
  const total = suma(enviadas)

  const razones = []
  if (resultado.victoria) {
    razones.push(estrellas === 3
      ? 'No quedó piedra sobre piedra: la tropa entró por el hueco bueno y no encontró quien la parase.'
      : estrellas === 2
        ? 'Cayó el corazón de la aldea, que es lo que cuenta, aunque quedaron casas en pie.'
        : 'Se arrasó media aldea y poco más: llegó el tiempo justo para la primera estrella.')
  } else {
    razones.push('No llegó ni al 50 % ni cayó el edificio principal, así que no hay estrella que valga.')
  }
  if (perdidas >= total * 0.6) razones.push('Las bajas fueron brutales: las torres tuvieron tiempo de sobra para hacer puntería.')
  else if (!perdidas) razones.push('Y no se perdió ni un hombre: eso es que el rival te quedaba pequeño.')
  const llevabaAsedio = Object.keys(enviadas).some(t => UNIDADES[t]?.clase === 'asedio')
  const habiaMuro = (base.buildings || []).filter(b => b.tipo === 'muralla').length > 10
  if (habiaMuro && !llevabaAsedio) razones.push('Sin arietes hubo que romper piedra a mano: mucho tiempo perdido bajo las flechas.')
  if (!resultado.victoria) razones.push('Prueba a entrar por otro lado, o vuelve con más tropa: el plano ya te lo sabes.')

  const caja = el('div', { clase: 'panel col' }, [
    el('div', { estilo: { fontSize: '2em', textAlign: 'center', letterSpacing: '6px' }, texto: '★★★☆☆☆'.slice(3 - estrellas, 6 - estrellas) }),
    el('div', { clase: 'titular', estilo: { textAlign: 'center' }, texto: resultado.victoria ? '¡Victoria!' : 'Derrota' }),
    el('div', { clase: 'fila', estilo: { flexWrap: 'wrap', justifyContent: 'center' } }, [
      chip('💥', `${resultado.porcentajeDestruido} % arrasado`, {}),
      chip('🧍', `${resultado.supervivientes}/${total} vuelven`, { tono: perdidas ? 'mal' : 'bien' }),
      cayeron ? chip('🩸', `${cayeron} ${cayeron === 1 ? 'caído' : 'caídos'}`, { tono: 'mal' }) : null,
      resultado.defensores
        ? chip('🛡️', `guarnición ${resultado.defensores - resultado.defensoresVivos}/${resultado.defensores} abatida`, { tono: resultado.defensoresVivos ? 'mal' : 'bien' })
        : null
    ]),
    el('div', { clase: 'separador' }),
    el('div', { clase: 'fila fila-sep' }, [el('span', { clase: 'titular', texto: 'Botín' }), el('span', { clase: 'pequeño tenue', texto: 'ya está en el granero' })]),
    (botin.madera || botin.piedra || botin.comida || botin.oro)
      ? el('div', { html: costeHTML({ madera: botin.madera, piedra: botin.piedra, comida: botin.comida, oro: botin.oro }, { madera: 1e9, piedra: 1e9, comida: 1e9, oro: 1e9 }) })
      : el('div', { clase: 'tenue pequeño', texto: 'Nada aprovechable: no se llegó a los almacenes.' }),
    botin.gemas ? el('div', { clase: 'num', texto: `💎 ${botin.gemas}` }) : null,
    cayeron ? el('div', { clase: 'col', estilo: { gap: '2px' } }, [
      el('div', { clase: 'titular', texto: 'Tu tropa' }),
      el('div', { clase: 'pequeño', estilo: { lineHeight: '1.4' }, texto: malheridos
        ? `${cayeron} ${cayeron === 1 ? 'cayó' : 'cayeron'} en el campo: ${malheridos} ${malheridos === 1 ? 'vuelve malherido' : 'vuelven malheridos'} al cuartel y ${perdidas} no ${perdidas === 1 ? 'vuelve' : 'vuelven'}.`
        : `${cayeron} ${cayeron === 1 ? 'cayó' : 'cayeron'} en el campo y ${perdidas} no ${perdidas === 1 ? 'vuelve' : 'vuelven'}.` }),
      ...Object.entries(heridos).filter(([, n]) => n).map(([t, n]) => el('div', { clase: 'pequeño', texto: `⛑️ ${n} × ${UNIDADES[t]?.nombre || t} se recupera${n === 1 ? '' : 'n'}` })),
      ...Object.entries(bajas).filter(([, n]) => n).map(([t, n]) => el('div', { clase: 'pequeño', texto: `${UNIDADES[t]?.icono || ''} ${n} × ${UNIDADES[t]?.nombre || t}: no vuelve${n === 1 ? '' : 'n'}` }))
    ]) : el('div', { clase: 'pequeño', texto: 'No cayó ni un hombre.' }),
    el('div', { clase: 'separador' }),
    el('div', { clase: 'pequeño', estilo: { lineHeight: '1.4' }, texto: razones.join(' ') })
  ])
  pie.appendChild(caja)

  pie.appendChild(el('div', { clase: 'fila', estilo: { gap: '8px' } }, [
    el('button', {
      clase: 'btn btn-oro crece', type: 'button', texto: '⚔️ Volver a atacar',
      onclick: () => {
        const vivo = pedir(Enemigos, 'enemigoPorId', [rival?.enemigo?.id], null) || rival?.enemigo
        if (vivo && vivo.derrotado) { toast('Esa aldea ya está en cenizas: busca otra', 'info'); rival = null; pintar(); return }
        prepararAsalto()
      }
    }),
    el('button', { clase: 'btn btn-piedra crece', type: 'button', texto: '🔎 Otro rival', onclick: () => { rival = null; pintar() } })
  ]))
}

// =============================================================== 4. DEFENSA ==

/**
 * EL PARTE DEL ASEDIO. Lo que te han roto, lo que te han robado, qué torres
 * trabajaron y por dónde entraron. Con el botón de reparar, que es lo primero
 * que quiere pulsar cualquiera al volver y encontrarse la aldea en los huesos.
 */
function bloqueParteDefensa (p) {
  const caja = el('div', {
    clase: 'panel col',
    estilo: { borderColor: p.victoria ? 'var(--verde, #3f7d3a)' : 'var(--rojo-oscuro)' }
  })

  caja.append(
    el('div', { clase: 'fila fila-sep' }, [
      el('span', { clase: 'titular', texto: p.victoria ? '🛡️ Aguantaste' : '🔥 Te han asaltado' }),
      el('button', { clase: 'btn btn-fantasma', type: 'button', texto: '✕', onclick: () => { parteDefensa = null; pintar() } })
    ]),
    el('div', { clase: 'pequeño', estilo: { lineHeight: '1.4' }, texto: p.titular }),
    el('div', { clase: 'pequeño', estilo: { lineHeight: '1.4' }, texto: p.resumen }),
    el('button', {
      clase: 'btn btn-oro btn-gordo', type: 'button', texto: '🎬 Ver el asalto en tu aldea',
      onclick: async () => {
        const campo = await cargarCampo()
        if (!campo || !campo.verAsedio || !campo.verAsedio()) { toast('No se guardó la crónica de ese asalto', 'info'); return }
        panel?.cerrar()
      }
    }),
    el('div', { clase: 'fila', estilo: { flexWrap: 'wrap' } }, [
      chip('💀', `${p.bajasEnemigas}/${p.atacantes} atacantes caídos`, { tono: p.bajasEnemigas >= p.atacantes / 2 ? 'bien' : 'mal' }),
      p.defensores ? chip('🧍', `${p.misCaidos}/${p.defensores} de los tuyos caídos`, { tono: p.misCaidos ? 'mal' : 'bien' }) : null,
      chip('🏚️', `${(p.rotos || []).length} edificios tocados`, { tono: (p.rotos || []).length ? 'mal' : 'bien' }),
      chip('🗼', `${p.trabajaron} ${p.trabajaron === 1 ? 'torre útil' : 'torres útiles'}`, { tono: p.trabajaron ? 'bien' : 'mal' })
    ])
  )

  // --- qué se han llevado ---
  const robado = p.robado || {}
  const algoRobado = ['madera', 'piedra', 'comida', 'oro'].some(r => robado[r] > 0)
  caja.append(
    el('div', { clase: 'separador' }),
    el('div', { clase: 'titular', texto: 'Qué se han llevado' }),
    algoRobado
      ? el('div', { html: costeHTML({ madera: robado.madera, piedra: robado.piedra, comida: robado.comida, oro: robado.oro }, { madera: 1e9, piedra: 1e9, comida: 1e9, oro: 1e9 }) })
      : el('div', { clase: 'pequeño tenue', texto: 'Nada: no llegaron a los almacenes.' })
  )

  // --- qué torres funcionaron ---
  if ((p.torres || []).length) {
    const lista = el('div', { clase: 'col', estilo: { gap: '2px' } })
    for (const t of p.torres.slice(0, 6)) {
      lista.appendChild(el('div', {
        clase: 'pequeño',
        texto: `${EDIFICIOS[t.tipo]?.icono || '🗼'} ${t.nombre} nv.${t.nivel}: ${t.bajas ? `${t.bajas} ${t.bajas === 1 ? 'baja' : 'bajas'}` : 'ni un disparo certero'}${t.vivo ? '' : ' (derribada)'}`
      }))
    }
    caja.append(el('div', { clase: 'separador' }), el('div', { clase: 'titular', texto: 'Tus torres' }), lista)
  }

  // --- qué han roto y cuánto cuesta arreglarlo ---
  const rotos = p.rotos || []
  if (rotos.length) {
    const lista = el('div', { clase: 'col', estilo: { gap: '2px' } })
    for (const d of rotos.slice(0, 8)) {
      lista.appendChild(el('div', {
        clase: 'pequeño',
        texto: `${EDIFICIOS[d.tipo]?.icono || '🏚️'} ${d.nombre}: ${d.destruido ? 'en ruinas' : `−${formatoNumero(d.dano)} de vida`}`
      }))
    }
    caja.append(el('div', { clase: 'separador' }), el('div', { clase: 'titular', texto: 'Qué te han roto' }), lista)
    caja.append(el('div', { clase: 'pequeño tenue', texto: 'Repararlo todo cuesta:' }))
    caja.append(el('div', { html: costeHTML(p.coste || {}, game.state.recursos) }))
    caja.append(el('button', {
      clase: 'btn btn-oro btn-gordo', type: 'button', texto: '🔨 Reparar lo dañado',
      onclick: () => {
        let hechos = 0
        for (const d of rotos) { if (pedir(Edificios, 'reparar', [d.id], false)) hechos++ }
        if (hechos) toast(`${hechos} ${hechos === 1 ? 'edificio reparado' : 'edificios reparados'}`, 'bien')
        else toast('No te llega para reparar: junta recursos y vuelve', 'mal')
        parteDefensa = hechos >= rotos.length ? null : parteDefensa
        pintar()
      }
    }))
  }

  // --- por dónde se colaron ---
  if ((p.agujeros || []).length) {
    const lista = el('div', { clase: 'col', estilo: { gap: '2px' } })
    for (const c of p.agujeros) lista.appendChild(el('div', { clase: 'pequeño', texto: `• ${c}` }))
    caja.append(el('div', { clase: 'separador' }), el('div', { clase: 'titular', texto: 'Por dónde entraron' }), lista)
  }

  if (p.escudoHasta > Date.now()) {
    const escudo = el('div', { clase: 'pequeño tenue', texto: '' })
    reloj(() => {
      const resta = Math.max(0, (p.escudoHasta - Date.now()) / 1000)
      escudo.textContent = resta ? `🛡️ Escudo de protección: ${formatoTiempo(resta)} sin que nadie pueda atacarte.` : ''
    })
    caja.appendChild(escudo)
  }
  return caja
}

/**
 * POR DÓNDE ESTÁS PROTEGIDO Y POR DÓNDE NO. Este bloque es el que explica la
 * derrota antes de que ocurra. Está medido en partida: el MISMO asedio por el
 * norte con la tropa al norte se salda con el 12 % de la aldea arrasada y 17
 * bajas; con esa misma tropa al sur, la aldea se pierde ENTERA. No es que
 * faltara tropa: es que estaba mirando al lado que no era, y tardó en llegar.
 */
function bloqueFlancos () {
  const lista = listaEscuadrones()
  const cob = coberturaDeFlancos(lista)
  const sin = FLANCOS.filter(f => !cob[f]?.guardado)
  const caja = el('div', { clase: 'panel col', estilo: sin.length ? { borderColor: 'var(--rojo-oscuro)' } : {} })

  caja.appendChild(el('div', { clase: 'fila fila-sep' }, [
    el('span', { clase: 'titular', texto: '🧭 Por dónde te pueden entrar' }),
    chip('🛡️', `${4 - sin.length}/4`, { tono: sin.length ? (sin.length >= 3 ? 'mal' : '') : 'bien' })
  ]))

  for (const f of FLANCOS) {
    const c = cob[f]
    const texto = !c
      ? 'nadie de guardia'
      : c.guardado
        ? `${c.escuadron.nombre}: está ahí`
        : `${c.escuadron.nombre} tarda ${Math.round(c.segundos)} s en llegar`
    caja.appendChild(el('div', { clase: 'fila fila-sep', estilo: { gap: '8px' } }, [
      el('div', { clase: 'fila', estilo: { gap: '6px', alignItems: 'center', flex: 'none' } }, [
        c ? marcaColor(colorEscuadron(c.escuadron.id), 12) : el('i', { estilo: { width: '12px', height: '12px', display: 'inline-block' } }),
        el('span', { estilo: { fontWeight: '800' }, texto: `${FLECHA[f]} ${f[0].toUpperCase()}${f.slice(1)}` })
      ]),
      el('span', {
        clase: 'pequeño crece',
        estilo: { textAlign: 'right', color: c?.guardado ? '' : 'var(--rojo-oscuro)', fontWeight: c?.guardado ? '400' : '800' },
        texto
      })
    ]))
  }

  caja.appendChild(el('div', {
    clase: 'pequeño',
    estilo: { lineHeight: '1.4', borderTop: '2px dashed rgba(90,58,34,.25)', paddingTop: '8px' },
    texto: sin.length
      ? `Una batalla dura poco más de un minuto: un escuadrón que tarda 20 s en cruzar la aldea llega a las ruinas, no a la muralla. Con la tropa en el flanco bueno se pierde una décima parte de la aldea; con la tropa en la otra punta, se pierde entera.`
      : 'Entren por donde entren, tienes gente peleando desde el primer segundo. Eso es lo que salva la aldea, no el número de soldados.'
  }))

  caja.appendChild(el('button', {
    clase: sin.length ? 'btn btn-peligro btn-gordo' : 'btn btn-piedra btn-gordo', type: 'button',
    texto: sin.length ? `🚩 Plantar tropa en el ${sin[0]}` : '🚩 Mover mis escuadrones',
    onclick: () => { solapa = 'escuadrones'; reparto = null; pintar() }
  }))
  return caja
}

function vistaDefensa (zona) {
  const d = pedir(Combate, 'calcularDefensa', [], null)
  if (!d) {
    zona.appendChild(el('div', { clase: 'panel tenue', texto: 'No se puede evaluar la defensa ahora mismo.' }))
    return
  }

  if (parteDefensa) { zona.appendChild(bloqueParteDefensa(parteDefensa)) }

  if (avisoAtaque) {
    const aviso = el('div', { clase: 'panel col', estilo: { borderColor: 'var(--rojo-oscuro)' } })
    const cuenta = el('span', { clase: 'num', estilo: { fontSize: '1.3em' }, texto: '' })
    const fuerza = avisoAtaque.poder
      ? `Traen ${avisoAtaque.unidades || '?'} hombres (fuerza ${formatoNumero(avisoAtaque.poder)}) contra tus ${formatoNumero(d.dps)} de daño por segundo.`
      : ''
    aviso.append(
      el('div', { clase: 'fila fila-sep' }, [el('span', { clase: 'titular', texto: '🚨 Vienen a por ti' }), cuenta]),
      el('div', { clase: 'pequeño', estilo: { lineHeight: '1.4' }, texto: `${avisoAtaque.texto || `${avisoAtaque.enemigo.nombre || 'Una hueste'} marcha hacia la aldea.`} ${fuerza}` }),
      el('div', { clase: 'pequeño tenue', texto: 'Todavía te da tiempo: cierra los boquetes, sube una torre o saca tropa del cuartel.' }),
      el('div', { clase: 'fila', estilo: { gap: '8px' } }, [
        el('button', {
          clase: 'btn btn-oro crece', type: 'button', texto: '🧱 Reforzar muros',
          onclick: () => { panel?.cerrar(); events.emit(EV.UI_PANEL, { panel: 'construir', datos: { categoria: 'defensa' } }) }
        }),
        el('button', {
          clase: 'btn btn-piedra crece', type: 'button', texto: '⚒️ Sacar tropa',
          onclick: () => { solapa = 'entrenar'; pintar() }
        })
      ])
    )
    reloj(() => {
      const resta = Math.max(0, avisoAtaque ? (avisoAtaque.cuando - Date.now()) / 1000 : 0)
      cuenta.textContent = resta ? formatoTiempo(resta) : '¡ya están aquí!'
      if (!resta && avisoAtaque) avisoAtaque = null
    })
    zona.appendChild(aviso)
  }

  const tono = d.puntuacion >= 60 ? 'bien' : d.puntuacion >= 35 ? '' : 'mal'
  const barra = barraProgreso(d.puntuacion, { gorda: true, tono })
  zona.appendChild(el('div', { clase: 'panel col' }, [
    el('div', { clase: 'fila fila-sep' }, [
      el('span', { clase: 'titular', texto: d.nota }),
      el('span', { clase: 'num', texto: `${d.puntuacion}/100` })
    ]),
    barra.nodo,
    el('div', { clase: 'fila', estilo: { flexWrap: 'wrap' } }, [
      chip('🗼', `${d.cobertura} % cubierto`, { tono: d.cobertura >= 60 ? 'bien' : 'mal' }),
      chip('🧱', `${d.recinto} % dentro`, { tono: d.recinto >= 60 ? 'bien' : 'mal' }),
      chip('🏹', `${formatoNumero(d.dps)} daño/s`, {}),
      d.cerrada ? chip('🔒', 'muralla cerrada', { tono: 'bien' })
        : chip('🕳️', d.brechas ? `${d.brechas} boquetes` : d.murosVivos ? 'muralla abierta' : 'sin muralla', { tono: 'mal' })
    ]),
    el('div', { clase: 'pequeño', estilo: { lineHeight: '1.4' }, texto: d.resumen || '' }),
    // la tropa que está en casa SALE a defender: hay que decirlo, o nadie la deja
    (() => {
      const casa = suma(tropasDe())
      return el('div', {
        clase: 'pequeño tenue',
        estilo: { lineHeight: '1.4' },
        texto: casa
          ? `⚔️ Tienes ${casa} soldados en casa: saldrán a pelear si te asaltan (la tropa que esté fuera de asalto, no).`
          : '⚔️ No tienes tropa en casa: solo te defienden las piedras. Deja siempre una guarnición.'
      })
    })()
  ]))

  zona.appendChild(bloqueFlancos())

  const consejos = el('div', { clase: 'panel col' }, [el('div', { clase: 'titular', texto: 'Lo que hay que arreglar' })])
  for (const c of d.consejos || []) consejos.appendChild(el('div', { clase: 'pequeño', texto: `• ${c}` }))
  zona.appendChild(consejos)

  if ((d.desprotegidos || []).length) {
    const lista = el('div', { clase: 'col' })
    for (const x of d.desprotegidos.slice(0, 8)) {
      lista.appendChild(el('button', {
        clase: 'tarjeta', type: 'button',
        estilo: { flexDirection: 'row', alignItems: 'center', gap: '10px', textAlign: 'left', font: 'inherit', cursor: 'pointer' },
        onclick: () => { events.emit(EV.CAMERA_FOCUS, { x: x.x, z: x.z, zoom: 18 }); events.emit(EV.UI_SELECT, { kind: 'building', id: x.id }); panel?.cerrar() }
      }, [
        el('div', { clase: 'tarjeta-icono', texto: EDIFICIOS[x.tipo]?.icono || '🏚️' }),
        el('div', { clase: 'tarjeta-cuerpo col', estilo: { gap: '0' } }, [
          el('div', { clase: 'tarjeta-nombre', texto: x.nombre }),
          el('div', { clase: 'tarjeta-detalle', texto: x.motivo })
        ]),
        el('div', { clase: 'tenue', texto: '›' })
      ]))
    }
    zona.appendChild(el('div', { clase: 'col' }, [el('div', { clase: 'pequeño tenue', texto: 'Toca uno para ir a verlo en la aldea.' }), lista]))
  }

  zona.appendChild(el('button', {
    clase: 'btn btn-oro btn-gordo', type: 'button', texto: '🧱 Levantar muros y torres',
    onclick: () => { panel?.cerrar(); events.emit(EV.UI_PANEL, { panel: 'construir', datos: { categoria: 'defensa' } }) }
  }))
}

export default { init }
