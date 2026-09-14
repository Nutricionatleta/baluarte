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
let lado = 'sur'
let reproduccion = null     // handle de combat.reproducir
let animacion = 0           // setInterval del canvas

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
    if (p.panel === 'ejercito' || p.panel === 'army') abrir(p.datos)
    else if (p.panel === null && panel) panel.cerrar()
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
  seleccion = {}

  nav = pestañas([
    { id: 'tropas', texto: 'Tropa' },
    { id: 'entrenar', texto: 'Entrenar' },
    { id: 'atacar', texto: 'Atacar' },
    { id: 'defensa', texto: 'Defensa' }
  ], (id) => { solapa = id; pintar() })

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

  zona.appendChild(el('button', {
    clase: 'btn btn-oro btn-gordo', type: 'button', texto: '⚒️ Entrenar más tropa',
    onclick: () => { solapa = 'entrenar'; pintar() }
  }))
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

// ------------------------------------------------------ pantalla de preparar ---

function prepararAsalto () {
  if (!panel || !rival) return
  relojes = []
  const zona = vaciar(panel.zona)
  const e = rival.enemigo
  const base = baseDeCombate(e)
  const disponibles = tropasDe()

  // por defecto se lleva todo lo que hay en casa: es lo que el jugador quiere
  seleccion = {}
  for (const [t, n] of Object.entries(disponibles)) if ((UNIDADES[t]?.espacio || 0) > 0 && n > 0) seleccion[t] = n

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
    el('div', { clase: 'fila fila-sep' }, [
      el('span', { clase: 'titular', texto: 'Qué te llevas' }),
      el('button', {
        clase: 'btn btn-fantasma', type: 'button', texto: 'Todo',
        onclick: () => {
          for (const t of tipos) seleccion[t] = disponibles[t]
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
