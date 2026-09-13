/**
 * EL TALLER: catálogo de obra, mejoras, investigación y el modo colocación.
 *
 * Construir es LA acción del juego: este panel se abre cien veces al día, así que
 * manda la rapidez. Tres decisiones que explican casi todo el fichero:
 *   1. Se pinta entero solo cuando cambia algo estructural (una obra, una mejora,
 *      una tecnología). Con el tick solo se refrescan los textos que se mueven.
 *   2. El modo colocación NO es una hoja: es una barra fina, para que se vea la
 *      aldea, que es donde se coloca de verdad.
 *   3. Las murallas se pintan arrastrando el dedo y lo que no cabe en las plazas
 *      de obra se queda en una cola local que va entrando sola. Encadenar muros
 *      de uno en uno era el peor rato del juego.
 */
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { CONFIG, ICONO } from '../core/config.js'
import { dentro, huecoLibre } from '../core/grid.js'
import { EDIFICIOS, def, AGE_NOMBRE, ORDEN_EDADES } from '../data/buildings.js'
import {
  el, hoja, toast, confirmar, vaciar, formatoNumero, formatoTiempo,
  costeHTML, alcanza, chip, barraProgreso, pestañas
} from './styles.js'

// Excepción pactada: la interfaz PIDE a la simulación, nunca toca game.state.
import * as OBRA from '../sim/buildings.js'
import * as CIENCIA from '../sim/research.js'

/* ===========================================================================
   Defensas: si un módulo de sim aún no está escrito, el panel no se cae
   =========================================================================== */

/** Llama a una función de sim si existe; si no, devuelve el repuesto. */
function seguro (fn, repuesto, ...args) {
  if (typeof fn !== 'function') return repuesto
  try { return fn(...args) } catch (err) { console.warn('[build-panel]', err); return repuesto }
}

const simPuedeConstruir = (t) => seguro(OBRA.puedeConstruir, null, t)
const simValidar = (t, x, z) => seguro(OBRA.validarColocacion, null, t, x, z)
const simColocar = (t, x, z, r) => seguro(OBRA.colocar, null, t, x, z, r)
const simMejorar = (id) => seguro(OBRA.mejorar, false, id)
const simPuedeMejorar = (id) => seguro(OBRA.puedeMejorar, null, id)
const simAcelerar = (id) => seguro(OBRA.acelerar, false, id)
const simCosteAcelerar = (id) => seguro(OBRA.costeAcelerar, 0, id)
const simNivelDe = (t) => seguro(OBRA.nivelDe, nivelDeRespaldo(t), t)
const simPlazasObra = () => seguro(OBRA.plazasDeObra, CONFIG.MAX_OBRAS_SIMULTANEAS)
const simSegRestantes = (id) => seguro(OBRA.segundosRestantes, 0, id)

function nivelDeRespaldo (tipo) {
  // Un edificio EN OBRAS conserva su nivel para los requisitos: solo deja de
  // producir. Mirar `enObra` aquí congelaba la aldea entera durante las 8 horas
  // que tarda la última mejora del ayuntamiento (fallo cazado por el banco de
  // pruebas). El nivel 0 lo tienen ya las construcciones nuevas sin terminar.
  let n = 0
  for (const b of estado().buildings) if (b.tipo === tipo && b.nivel > n) n = b.nivel
  return n
}

const estado = () => game.state
const recursos = () => estado().recursos || {}
const gemas = () => estado().jugador?.gemas || 0

/* ===========================================================================
   Catálogo: categorías y pesos
   =========================================================================== */

const CATEGORIAS = [
  { id: 'centro', texto: 'Centro', icono: '🏛️' },
  { id: 'recursos', texto: 'Recursos', icono: '🪵' },
  { id: 'militar', texto: 'Militar', icono: '⚔️' },
  { id: 'defensa', texto: 'Defensa', icono: '🛡️' },
  { id: 'decoracion', texto: 'Adornos', icono: '🚩' }
]

const SECCIONES = [
  { id: 'construir', texto: 'Construir', icono: '🔨' },
  { id: 'mejorar', texto: 'Mejorar', icono: '⬆️' },
  { id: 'investigar', texto: 'Investigar', icono: '📜' }
]

/** Lo que cuesta de verdad conseguir cada recurso. El oro vale cuatro maderas. */
const PESO = { madera: 1, piedra: 1.3, comida: 0.8, oro: 4 }
const RECURSOS = CONFIG.RECURSOS

const pesar = (c) => RECURSOS.reduce((s, r) => s + (c?.[r] || 0) * PESO[r], 0)
const soloCoste = (c) => {
  const o = {}
  for (const r of RECURSOS) if (c?.[r]) o[r] = c[r]
  return o
}
const faltaDe = (c) => {
  const o = {}
  for (const r of RECURSOS) {
    const d = (c?.[r] || 0) - (recursos()[r] || 0)
    if (d > 0) o[r] = Math.ceil(d)
  }
  return o
}
const textoFalta = (c) => Object.entries(faltaDe(c)).map(([r, n]) => `${ICONO[r]} ${formatoNumero(n)}`).join('  ')

/** Decimales a la española: 12,5/min se lee mejor que 12.5. */
const num = (v) => {
  const n = Math.round((Number(v) || 0) * 10) / 10
  return (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','))
}

/* ===========================================================================
   ¿Puedo construir esto? — clasificación propia para poder ORDENAR
   =========================================================================== */

const MOTIVO_ORDEN = { libre: 0, recursos: 1, obras: 2, requisito: 3, tope: 4, edad: 5 }

/**
 * Estado de un tipo de edificio para la tarjeta: si se puede, y si no, por qué
 * en un español que el jugador entienda del tirón.
 * @returns {{ok:boolean, causa:string, motivo:string, orden:number}}
 */
function evaluar (tipo) {
  const d = def(tipo)
  if (!d) return { ok: false, causa: 'edad', motivo: 'No existe', orden: 9 }
  const s = estado()

  if (ORDEN_EDADES.indexOf(d.age) > ORDEN_EDADES.indexOf(s.age)) {
    return dictamen('edad', `Requiere ${AGE_NOMBRE[d.age]}`)
  }
  for (const req in (d.requiere || {})) {
    const pide = d.requiere[req]
    if (simNivelDe(req) < pide) {
      return dictamen('requisito', `${def(req)?.nombre || req} nivel ${pide}`)
    }
  }
  const tope = d.unico ? 1 : (d.max ?? Infinity)
  const tengo = s.buildings.filter(b => b.tipo === tipo).length
  if (tengo >= tope) {
    return dictamen('tope', d.unico ? 'Ya tienes el tuyo' : `Ya tienes el máximo: ${tope}`)
  }
  if ((s.obras?.length || 0) >= simPlazasObra()) {
    return dictamen('obras', 'Constructores ocupados')
  }
  const c = soloCoste(d.coste(1))
  if (!alcanza(c)) return dictamen('recursos', `Te falta ${textoFalta(c)}`)

  // La simulación tiene la última palabra (puede saber algo que aquí no miramos).
  const v = simPuedeConstruir(tipo)
  if (v && v.ok === false) return dictamen('requisito', v.motivo || 'Todavía no')
  return { ok: true, causa: 'libre', motivo: '', orden: 0 }
}

const dictamen = (causa, motivo) => ({ ok: false, causa, motivo, orden: MOTIVO_ORDEN[causa] ?? 9 })

/* ===========================================================================
   ¿Qué le falta a la aldea? — sirve para ordenar y para los consejos
   =========================================================================== */

/** Camas disponibles: el Ayuntamiento da un techo base y cada casa suma. */
function poblacion () {
  const s = estado()
  let sitio = 0
  for (const b of s.buildings) {
    if (b.enObra) continue
    const d = def(b.tipo)
    if (!d) continue
    if (typeof d.poblacionMax === 'function') sitio += d.poblacionMax(Math.max(1, b.nivel))
    if (typeof d.aloja === 'function') sitio += d.aloja(Math.max(1, b.nivel))
  }
  return { gente: s.villagers?.length || 0, sitio }
}

/** Recursos que rozan el tope del almacén: lo que se produce de más se tira. */
function almacenLleno () {
  const s = estado()
  const llenos = []
  for (const r of RECURSOS) {
    const tope = s.almacen?.[r] || 0
    if (tope > 0 && (s.recursos?.[r] || 0) >= tope * 0.9) llenos.push(r)
  }
  return llenos
}

/** Edificios de producción con plazas de trabajo vacías. */
function sinTrabajadores () {
  const s = estado()
  if (!(s.villagers?.length > 0)) return []      // sin aldeanos no hay nada que reprochar
  const flojos = []
  for (const b of s.buildings) {
    if (b.enObra) continue
    const d = def(b.tipo)
    if (!d?.produce || typeof d.plazas !== 'function') continue
    const plazas = d.plazas(Math.max(1, b.nivel))
    const hay = (b.trabajadores || []).length
    if (plazas > 0 && hay < plazas) flojos.push({ b, d, plazas, hay })
  }
  return flojos.sort((a, b) => (a.hay / a.plazas) - (b.hay / b.plazas))
}

/**
 * Cuánta falta hace cada tipo AHORA MISMO. Solo mueve el orden del catálogo,
 * no bloquea nada: arriba lo que el jugador necesita, no lo que sale antes.
 */
function utilidad (tipo) {
  const d = def(tipo)
  if (!d) return 0
  let p = 0
  const s = estado()
  const hay = s.buildings.filter(b => b.tipo === tipo).length
  if (hay === 0) p += 30                                   // lo que nunca ha tenido, primero

  const pob = poblacion()
  if (typeof d.aloja === 'function' && pob.gente >= pob.sitio - 1) p += 45
  if (d.capacidad && almacenLleno().length) p += 40

  if (d.produce) {
    const tengo = s.recursos?.[d.produce] || 0
    const tope = s.almacen?.[d.produce] || 1
    p += Math.round(24 * (1 - Math.min(1, tengo / tope)))   // falta de ese recurso
    p += Math.max(0, 14 - hay * 4)                          // diversificar antes que amontonar
  }
  if (d.categoria === 'defensa' && hay < 3) p += 12
  if (d.categoria === 'decoracion') p -= 25                 // bonito, pero no urgente
  return p
}

/**
 * Qué tienes de este tipo y cuánto te dejan tener. Va en la propia tarjeta:
 * "Tienes 2 de 4" contesta de un vistazo la pregunta que más se repite.
 */
function inventario (tipo) {
  const d = def(tipo)
  const s = estado()
  const todos = s.buildings.filter(b => b.tipo === tipo)
  return {
    tengo: todos.length,
    enObra: todos.filter(b => b.enObra).length,
    tope: d?.unico ? 1 : (d?.max ?? 0)
  }
}

/** "Tienes 2 de 4 · 1 en obras" — o nada si nunca ha puesto ninguno. */
function textoInventario (tipo) {
  const { tengo, enObra, tope } = inventario(tipo)
  if (!tengo) return tope ? `Ninguno todavía · máximo ${tope}` : 'Ninguno todavía'
  const base = tope ? `Tienes ${tengo} de ${tope}` : `Tienes ${tengo}`
  return enObra ? `${base} · ${enObra} en obras` : base
}

/* ===========================================================================
   Qué hace este edificio, en números
   =========================================================================== */

/**
 * Lo que da el edificio a ese nivel, sacado del catálogo. La frase de sabor está
 * muy bien, pero el jugador compra números: produce tanto, aloja a tantos.
 * @returns {Array<{etiqueta:string, valor:string}>}
 */
function efectos (tipo, n = 1) {
  const d = def(tipo)
  if (!d) return []
  const l = []
  const mas = (etiqueta, valor) => l.push({ etiqueta, valor })

  if (typeof d.porMinuto === 'function') mas('Produce', `${ICONO[d.produce] || ''} ${num(d.porMinuto(n))}/min`)
  if (typeof d.plazas === 'function' && d.plazas(n) > 0) mas('Puestos', `🧑‍🌾 ${d.plazas(n)}`)
  if (typeof d.aloja === 'function') mas('Aloja', `🛏️ ${d.aloja(n)}`)
  if (typeof d.poblacionMax === 'function') mas('Población', `👥 ${d.poblacionMax(n)}`)
  if (typeof d.obrasSimultaneas === 'function') mas('Constructores', `🔨 ${d.obrasSimultaneas(n)}`)
  if (typeof d.capacidad === 'function') {
    const c = d.capacidad(n) || {}
    const txt = Object.keys(c).map(r => `${ICONO[r]} ${formatoNumero(c[r])}`).join(' ')
    if (txt) mas('Guarda', txt)
  }
  if (typeof d.dano === 'function') mas('Dispara', `💥 ${d.dano(n)}`)
  if (typeof d.radio === 'function') mas('Alcance', `🎯 ${num(d.radio(n))}`)
  if (typeof d.velocidad === 'function') mas('Entrena', `⏱️ ×${num(d.velocidad(n))}`)
  if (typeof d.bonusAtaque === 'function') mas('Ataque', `⚔️ +${Math.round(d.bonusAtaque(n) * 100)} %`)
  if (typeof d.bonusArmadura === 'function') mas('Armadura', `🛡️ +${Math.round(d.bonusArmadura(n) * 100)} %`)
  if (d.aura && typeof d.aura.bonus === 'function') mas('Granjas cerca', `🌬️ +${Math.round(d.aura.bonus(n) * 100)} %`)
  if (typeof d.curacion === 'function') mas('Cura heridos', `⛪ ${Math.round(d.curacion(n) * 100)} %`)
  if (typeof d.exploradores === 'function') mas('Exploradores', `🧭 ${d.exploradores(n)}`)
  if (typeof d.velocidadInvestigacion === 'function') mas('Investiga', `📜 ×${num(d.velocidadInvestigacion(n))}`)
  if (typeof d.hp === 'function') mas('Aguanta', `❤️ ${formatoNumero(d.hp(n))}`)
  return l
}

/** Los efectos como cintas verdes: se leen de un vistazo sin abrir nada. */
function cintasEfecto (tipo, n = 1, cuantas = 2) {
  const caja = el('div', { estilo: { display: 'flex', flexWrap: 'wrap', gap: '6px' } })
  for (const e of efectos(tipo, n).slice(0, cuantas)) {
    caja.appendChild(el('span', {
      estilo: {
        display: 'inline-flex', gap: '5px', alignItems: 'baseline',
        padding: '3px 9px', borderRadius: 'var(--r-max)',
        background: 'rgba(74,143,60,.16)', border: '1px solid rgba(47,97,37,.35)',
        color: 'var(--verde-oscuro)', fontSize: '.78em', fontWeight: '800', lineHeight: '1.3'
      }
    }, [
      el('span', { estilo: { fontWeight: '600', opacity: '.85' }, texto: e.etiqueta }),
      el('span', { texto: e.valor })
    ]))
  }
  return caja
}

/* ===========================================================================
   Antes → después: qué gano de verdad al subir un nivel
   =========================================================================== */

/**
 * Las mejoras solo enganchan si se ve el salto. Se lee del catálogo, así que
 * cualquier edificio nuevo aparece aquí sin tocar nada.
 * @returns {Array<{etiqueta:string, antes:string, despues:string}>}
 */
function ganancias (tipo, nivel) {
  const d = def(tipo)
  if (!d) return []
  const a = Math.max(1, nivel); const b = nivel + 1
  const g = []
  const par = (etiqueta, antes, despues) => { if (String(antes) !== String(despues)) g.push({ etiqueta, antes, despues }) }

  if (typeof d.porMinuto === 'function') {
    par(`${ICONO[d.produce] || ''} Produce`, `${num(d.porMinuto(a))}/min`, `${num(d.porMinuto(b))}/min`)
  }
  if (typeof d.aloja === 'function') par('🛏️ Aloja', d.aloja(a), d.aloja(b))
  if (typeof d.poblacionMax === 'function') par('👥 Población', d.poblacionMax(a), d.poblacionMax(b))
  if (typeof d.obrasSimultaneas === 'function') par('🔨 Obras a la vez', d.obrasSimultaneas(a), d.obrasSimultaneas(b))
  if (typeof d.capacidad === 'function') {
    const ca = d.capacidad(a); const cb = d.capacidad(b)
    for (const r in cb) par(`${ICONO[r]} Almacén`, formatoNumero(ca[r]), formatoNumero(cb[r]))
  }
  if (typeof d.dano === 'function') par('💥 Daño', d.dano(a), d.dano(b))
  if (typeof d.radio === 'function') par('🎯 Alcance', num(d.radio(a)), num(d.radio(b)))
  if (typeof d.plazas === 'function') par('🧑‍🌾 Puestos', d.plazas(a), d.plazas(b))
  if (typeof d.velocidad === 'function') par('⏱️ Entrena', `×${num(d.velocidad(a))}`, `×${num(d.velocidad(b))}`)
  if (typeof d.bonusAtaque === 'function') par('⚔️ Ataque tropa', `+${Math.round(d.bonusAtaque(a) * 100)} %`, `+${Math.round(d.bonusAtaque(b) * 100)} %`)
  if (typeof d.bonusArmadura === 'function') par('🛡️ Armadura', `+${Math.round(d.bonusArmadura(a) * 100)} %`, `+${Math.round(d.bonusArmadura(b) * 100)} %`)
  if (d.aura && typeof d.aura.bonus === 'function') par('🌬️ Granjas cerca', `+${Math.round(d.aura.bonus(a) * 100)} %`, `+${Math.round(d.aura.bonus(b) * 100)} %`)
  if (typeof d.comision === 'function') par('⚖️ Comisión', `${Math.round(d.comision(a) * 100)} %`, `${Math.round(d.comision(b) * 100)} %`)
  if (typeof d.curacion === 'function') par('⛪ Heridos que vuelven', `${Math.round(d.curacion(a) * 100)} %`, `${Math.round(d.curacion(b) * 100)} %`)
  if (typeof d.exploradores === 'function') par('🧭 Exploradores', d.exploradores(a), d.exploradores(b))
  if (typeof d.alcance === 'function') par('🗺️ Alcance', d.alcance(a), d.alcance(b))
  if (typeof d.velocidadInvestigacion === 'function') par('📜 Investigación', `×${num(d.velocidadInvestigacion(a))}`, `×${num(d.velocidadInvestigacion(b))}`)
  if (typeof d.hp === 'function') par('❤️ Vida', formatoNumero(d.hp(a)), formatoNumero(d.hp(b)))
  return g
}

/**
 * Rentabilidad de una mejora: lo que ganas partido por lo que cuesta.
 * No se enseña el número (aburre), solo ordena la lista: arriba lo que más renta.
 */
function rentabilidad (b) {
  const d = def(b.tipo)
  if (!d) return 0
  const n = Math.max(1, b.nivel)
  const coste = pesar(d.coste(n + 1)) || 1
  let valor = 0
  if (typeof d.porMinuto === 'function') {
    valor += (d.porMinuto(n + 1) - d.porMinuto(n)) * (PESO[d.produce] || 1) * 60   // por hora
  }
  if (typeof d.capacidad === 'function') {
    const ca = d.capacidad(n); const cb = d.capacidad(n + 1)
    for (const r in cb) valor += ((cb[r] || 0) - (ca[r] || 0)) * (PESO[r] || 1) * 0.06
  }
  if (typeof d.aloja === 'function') valor += (d.aloja(n + 1) - d.aloja(n)) * 60
  if (typeof d.poblacionMax === 'function') valor += (d.poblacionMax(n + 1) - d.poblacionMax(n)) * 55
  if (typeof d.obrasSimultaneas === 'function') valor += (d.obrasSimultaneas(n + 1) - d.obrasSimultaneas(n)) * 400
  if (typeof d.dano === 'function') valor += (d.dano(n + 1) - d.dano(n)) * 5
  if (typeof d.bonusAtaque === 'function') valor += (d.bonusAtaque(n + 1) - d.bonusAtaque(n)) * 1200
  if (d.aura && typeof d.aura.bonus === 'function') valor += (d.aura.bonus(n + 1) - d.aura.bonus(n)) * 900
  if (typeof d.hp === 'function') valor += (d.hp(n + 1) - d.hp(n)) * 0.25
  return valor / coste
}

/** Minutos que tarda una mejora de producción en pagarse sola (o 0). */
function amortizacion (b) {
  const d = def(b.tipo)
  if (!d || typeof d.porMinuto !== 'function') return 0
  const n = Math.max(1, b.nivel)
  const extra = (d.porMinuto(n + 1) - d.porMinuto(n)) * (PESO[d.produce] || 1)
  if (extra <= 0) return 0
  return pesar(d.coste(n + 1)) / extra
}

/* ===========================================================================
   Estado del panel
   =========================================================================== */

let laHoja = null            // hoja abierta (o null)
let seccion = 'construir'
let categoria = 'centro'
let cuerpo = null            // nodo donde se pinta la sección
let refrescos = []           // pequeños refrescos por tick, sin repintar nada
let reconstruirPedido = false
let ultimoLigero = 0

/** Repinta la sección entera. Se agrupa en un frame: varios eventos, un pintado. */
function reconstruir () {
  if (!laHoja || reconstruirPedido) return
  reconstruirPedido = true
  requestAnimationFrame(() => {
    reconstruirPedido = false
    if (!laHoja || !cuerpo) return
    pintarSeccion()
  })
}

/**
 * Coste que se repinta solo cuando cambia lo que alcanzas: así el rojo del
 * "no te llega" se apaga en cuanto entra la madera, sin repintar la ficha.
 */
function costeVivo (coste) {
  const nodo = el('div', { html: costeHTML(coste) })
  let ultimo = null
  const refrescar = () => {
    const firma = RECURSOS.map(r => (recursos()[r] || 0) >= (coste[r] || 0) ? 1 : 0).join('')
    if (firma === ultimo) return
    ultimo = firma
    nodo.innerHTML = costeHTML(coste)
  }
  refrescar()
  refrescos.push(refrescar)
  return nodo
}

/** La pestaña recién tocada, entera a la vista: media pestaña cortada se lee mal. */
function centrarPestaña (tira) {
  const activa = tira?.querySelector('.pestaña.activa')
  if (!activa) return
  const centro = activa.offsetLeft - (tira.clientWidth - activa.offsetWidth) / 2
  tira.scrollTo({ left: Math.max(0, centro), behavior: 'smooth' })
}

/** Vuelve al principio de la hoja: cambiar de pestaña y caer a media lista despista. */
function arriba () {
  const c = laHoja?.cuerpo
  if (c) c.scrollTop = 0
}

/** Lo que cambia con el tiempo (cuentas atrás, botones que se encienden). */
function refrescarLigero () {
  const ahora = performance.now()
  if (ahora - ultimoLigero < 450) return       // 2 veces por segundo basta y sobra
  ultimoLigero = ahora
  for (const f of refrescos) { try { f() } catch (err) { console.warn('[build-panel]', err) } }
  refrescarBarra()
}

/* ===========================================================================
   La hoja
   =========================================================================== */

export function abrir (cual = 'construir') {
  if (SECCIONES.some(s => s.id === cual)) seccion = cual
  if (laHoja) { pintarSeccion(); return laHoja }

  const nav = pestañas(SECCIONES, (id) => { seccion = id; pintarSeccion(); centrarPestaña(nav.nodo) })
  nav.activar(seccion, false)

  // Los recursos NO se repiten aquí: ya están arriba en el HUD, y cada píxel de
  // alto de la hoja es un píxel menos de aldea visible.
  cuerpo = el('div', { clase: 'col', estilo: { gap: '10px', marginTop: '10px' } })

  laHoja = hoja({
    titulo: '🔨 El taller',
    clase: 'hoja-taller',
    contenido: [nav.nodo, cuerpo],
    alCerrar: () => { laHoja = null; cuerpo = null; refrescos = [] }
  })
  // Media pantalla libre: la aldea se ve detrás, que es donde se construye.
  laHoja.panel.style.maxHeight = 'min(72vh, 680px)'
  laHoja.navegar = (id) => { nav.activar(id) }

  pintarSeccion()
  return laHoja
}

export function cerrar () {
  laHoja?.cerrar()
  laHoja = null
}

function pintarSeccion () {
  if (!cuerpo) return
  refrescos = []
  vaciar(cuerpo)
  arriba()
  laHoja?.titulo(seccion === 'mejorar' ? '⬆️ Mejorar la aldea' : seccion === 'investigar' ? '📜 Universidad' : '🔨 El taller')
  if (seccion === 'construir') pintarCatalogo(cuerpo)
  else if (seccion === 'mejorar') pintarMejoras(cuerpo)
  else pintarInvestigacion(cuerpo)
}

/* ===========================================================================
   1. CATÁLOGO
   =========================================================================== */

function pintarCatalogo (destino) {
  // aviso de constructores: afecta a TODO, mejor arriba que repetido en 20 fichas
  const obras = estado().obras?.length || 0
  const plazas = simPlazasObra()
  if (obras >= plazas) {
    const aviso = el('div', {
      clase: 'panel',
      estilo: { padding: '10px 12px', borderWidth: '2px', background: 'linear-gradient(180deg,#fbe9cf,#f0d6a8)' }
    })
    const txt = el('div', { clase: 'pequeño' })
    aviso.append(el('div', { clase: 'fila' }, [el('span', { clase: 'icono-gr', texto: '🔨' }), el('div', { clase: 'crece' }, [
      el('div', { estilo: { fontWeight: '800' }, texto: `Tus ${plazas} constructores están ocupados` }), txt
    ])]))
    const pintarTxt = () => {
      const o = estado().obras || []
      const falta = o.length ? Math.min(...o.map(x => Math.max(0, (x.fin - Date.now()) / 1000))) : 0
      const t = o.length ? `El primero queda libre en ${formatoTiempo(falta)}` : 'Ya hay hueco'
      if (txt.textContent !== t) txt.textContent = t
    }
    pintarTxt(); refrescos.push(pintarTxt)
    destino.appendChild(aviso)
  }

  // lo que se pone una y otra vez, antes que nada: a un toque, no a tres
  const rapidos = accesosRapidos()
  if (rapidos.length >= 2) destino.appendChild(filaAccesos(rapidos))

  const consejos = maestroDeObras()
  if (consejos.length) destino.appendChild(panelConsejos(consejos))

  // al cambiar de categoría, la lista empieza arriba: nadie quiere aterrizar a medias
  const nav = pestañas(CATEGORIAS, (id) => { categoria = id; pintarRejilla(true); centrarPestaña(nav.nodo) })
  nav.activar(categoria, false)
  destino.appendChild(nav.nodo)

  // Una sola columna: a 390 px, dos tarjetas por fila dejaban el nombre partido y
  // la frase de "para qué sirve" en cuatro líneas apretadas. Se lee mejor así.
  const rejilla = el('div', { clase: 'col', estilo: { gap: '10px' } })
  destino.appendChild(rejilla)
  const baseRefrescos = refrescos.length   // lo de aquí abajo se tira al cambiar de categoría

  function pintarRejilla (mover = false) {
    refrescos.length = baseRefrescos
    vaciar(rejilla)
    if (mover) rejilla.scrollIntoView({ block: 'start', behavior: 'smooth' })
    const lista = Object.keys(EDIFICIOS)
      .filter(t => EDIFICIOS[t].categoria === categoria)
      .map(t => ({ tipo: t, ev: evaluar(t), util: utilidad(t) }))
      .sort((a, b) => a.ev.orden - b.ev.orden || b.util - a.util || pesar(def(a.tipo).coste(1)) - pesar(def(b.tipo).coste(1)))

    for (const it of lista) rejilla.appendChild(tarjetaEdificio(it.tipo))
    if (!lista.length) rejilla.appendChild(el('p', { clase: 'tenue', texto: 'Aquí todavía no hay nada.' }))
  }
  pintarRejilla()
}

/**
 * Tarjeta del catálogo, una por fila: icono, nombre, cuántos tienes, qué hace en
 * una frase, qué da en números, cuánto cuesta y cuánto tarda. Nada escondido.
 */
function tarjetaEdificio (tipo) {
  const d = def(tipo)
  const nunca = !estado().buildings.some(b => b.tipo === tipo)
  const coste = { ...soloCoste(d.coste(1)), tiempo: d.tiempo(1) }

  const caja = el('button', {
    clase: 'tarjeta tarjeta-fila',
    type: 'button',
    // la guía de los primeros minutos señala la tarjeta por su tipo
    datos: { tipo },
    estilo: { font: 'inherit', color: 'inherit', textAlign: 'left', width: '100%', cursor: 'pointer', gap: '9px' }
  })

  const icono = el('div', { clase: 'tarjeta-icono', texto: d.icono })
  const nombre = el('span', { texto: d.nombre })
  // La novedad va EN LA LÍNEA, no flotando sobre el borde: un globo absoluto se
  // montaba encima de la tarjeta de arriba en cuanto la lista se apretaba.
  const novedad = el('span', {
    estilo: {
      display: nunca ? 'inline-flex' : 'none', padding: '2px 8px', borderRadius: 'var(--r-max)',
      background: 'linear-gradient(180deg,#6fb85c,#4a8f3c)', color: '#f2ffe9',
      fontSize: '.62em', fontWeight: '800', letterSpacing: '.02em'
    },
    texto: '✨ NUEVO'
  })
  const titulo = el('div', {
    clase: 'tarjeta-nombre',
    estilo: { display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap', lineHeight: '1.25', color: 'var(--tinta)' }
  }, [nombre, novedad])

  const cuenta = el('div', { clase: 'tarjeta-detalle', texto: `${textoInventario(tipo)} · ${d.ancho}×${d.alto}` })
  const frase = el('div', {
    clase: 'tarjeta-detalle',
    estilo: { fontSize: '.86em', color: 'var(--tinta)', lineHeight: '1.35' },
    texto: d.desc
  })
  const cintas = cintasEfecto(tipo, 1, 2)
  const costeNodo = costeVivo(coste)
  const pie = el('div', {
    clase: 'pequeño',
    estilo: { fontWeight: '800', display: 'flex', alignItems: 'center', gap: '5px', lineHeight: '1.25' }
  })

  caja.append(
    el('div', { clase: 'tarjeta-cabeza' }, [icono, el('div', { clase: 'tarjeta-cuerpo' }, [titulo, cuenta])]),
    frase, cintas, costeNodo, pie
  )

  caja.addEventListener('click', () => {
    const ev = evaluar(tipo)
    if (!ev.ok) { toast(ev.motivo, 'mal'); return }
    entrarEnColocacion(tipo)
  })

  let ultimo = ''
  const refrescar = () => {
    const ev = evaluar(tipo)
    const inv = textoInventario(tipo)
    const clave = `${ev.causa}|${ev.motivo}|${inv}`
    if (clave === ultimo) return
    ultimo = clave
    cuenta.textContent = `${inv} · ${d.ancho}×${d.alto}`
    caja.classList.toggle('no-alcanzable', ev.causa === 'recursos')
    const apagado = !ev.ok && ev.causa !== 'recursos'
    caja.style.filter = apagado ? 'grayscale(.7)' : ''
    caja.style.opacity = ev.ok ? '1' : apagado ? '.68' : '.92'
    pie.className = `pequeño ${ev.ok ? '' : ev.causa === 'recursos' ? 'no-alcanzable' : 'tenue'}`
    pie.textContent = ev.ok
      ? '👆 Toca y elige el sitio en la aldea'
      : `${ev.causa === 'recursos' ? '💰' : ev.causa === 'tope' ? '✔️' : ev.causa === 'obras' ? '⏳' : '🔒'} ${ev.motivo}`
    if (ev.ok) pie.style.color = 'var(--verde-oscuro)'
    else pie.style.color = ''
    if (nunca) novedad.style.display = (ev.ok || ev.causa === 'recursos' || ev.causa === 'obras') ? 'inline-flex' : 'none'
  }
  refrescar()
  refrescos.push(refrescar)
  return caja
}

/* ===========================================================================
   Accesos rápidos: lo que se pone una y otra vez
   =========================================================================== */

/**
 * Muralla, casa, torre y granja se levantan cien veces por partida; buscarlas
 * cada vez entre pestañas es el peaje más tonto del juego. Aquí salen a un toque,
 * y se suma cualquier tipo del que el jugador ya tenga varios (sus favoritos).
 */
function accesosRapidos () {
  const s = estado()
  const suyos = [...new Set(s.buildings.map(b => b.tipo))]
    .filter(t => def(t) && def(t).categoria !== 'decoracion' && s.buildings.filter(b => b.tipo === t).length >= 2)
    .sort((a, b) => s.buildings.filter(x => x.tipo === b).length - s.buildings.filter(x => x.tipo === a).length)

  const lista = []
  // al principio muchos están todavía bajo llave: se rellena con los de siempre
  for (const t of ['muralla', 'casa', 'torre_vigia', 'granja', ...suyos, 'serreria', 'cantera', 'almacen']) {
    if (lista.includes(t) || !def(t)) continue
    const ev = evaluar(t)
    // lo bloqueado por edad, requisito o tope aquí no pinta nada: solo haría ruido
    if (!ev.ok && (ev.causa === 'edad' || ev.causa === 'requisito' || ev.causa === 'tope')) continue
    lista.push(t)
    if (lista.length >= 5) break
  }
  return lista
}

function filaAccesos (tipos) {
  const caja = el('div', { clase: 'panel', estilo: { padding: '9px 10px' } })
  caja.appendChild(el('div', {
    clase: 'pequeño tenue',
    estilo: { fontWeight: '800', marginBottom: '7px' },
    texto: '🖐️ Lo de siempre, a un toque'
  }))
  const tira = el('div', { estilo: { display: 'grid', gridTemplateColumns: `repeat(${tipos.length}, 1fr)`, gap: '7px' } })

  for (const t of tipos) {
    const d = def(t)
    const boton = el('button', {
      clase: 'btn btn-piedra', type: 'button', 'aria-label': `Construir ${d.nombre}`,
      datos: { tipo: t },
      estilo: {
        minHeight: '66px', padding: '6px 2px', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '3px'
      }
    }, [
      el('span', { estilo: { fontSize: '1.5em', lineHeight: '1' }, texto: d.icono }),
      el('span', { estilo: { fontSize: '.6em', fontWeight: '800', lineHeight: '1.05', textAlign: 'center' }, texto: d.nombre.split(' ')[0] })
    ])
    boton.addEventListener('click', () => {
      const ev = evaluar(t)
      if (!ev.ok) { toast(ev.motivo, 'mal'); return }
      entrarEnColocacion(t)
    })
    let ultimo = null
    const refrescar = () => {
      const ev = evaluar(t)
      if (ev.ok === ultimo) return
      ultimo = ev.ok
      boton.style.opacity = ev.ok ? '1' : '.55'
      boton.classList.toggle('no-alcanzable', !ev.ok)
    }
    refrescar()
    refrescos.push(refrescar)
    tira.appendChild(boton)
  }
  caja.appendChild(tira)
  return caja
}

/* ===========================================================================
   2. EL MAESTRO DE OBRAS (consejos)
   =========================================================================== */

/** Tres consejos como mucho, y cada uno con su botón para hacerlo ya. */
function maestroDeObras () {
  const s = estado()
  const lista = []
  const puedo = (t) => evaluar(t).ok

  const pob = poblacion()
  if (pob.sitio > 0 && pob.gente >= pob.sitio) {
    lista.push({
      prioridad: 95, icono: '🛏️', texto: `No quedan camas (${pob.gente}/${pob.sitio}). Sin sitio no llega gente nueva.`,
      boton: 'Levantar casa', accion: () => irA('casa')
    })
  }

  const llenos = almacenLleno()
  if (llenos.length) {
    const r = llenos[0]
    const guarda = r === 'comida' || r === 'oro' ? 'granero' : 'almacen'
    lista.push({
      prioridad: 90, icono: ICONO[r], texto: `Tu ${r} rebosa: lo que se produce de más se pierde.`,
      boton: puedo(guarda) ? `Construir ${def(guarda).nombre.toLowerCase()}` : 'Ampliar almacén',
      accion: () => puedo(guarda) ? irA(guarda) : irASeccion('mejorar')
    })
  }

  const flojos = sinTrabajadores()
  if (flojos.length) {
    const f = flojos[0]
    lista.push({
      prioridad: 80, icono: f.d.icono,
      texto: `${f.d.nombre} con ${f.hay} de ${f.plazas} puestos: produce a medio gas.`,
      boton: 'Ir allí', accion: () => { cerrar(); events.emit(EV.CAMERA_FOCUS, { x: f.b.x, z: f.b.z }); events.emit(EV.UI_SELECT, { kind: 'building', id: f.b.id }) }
    })
  }

  const edad = seguro(CIENCIA.resumenEdad, null)
  if (edad?.ok && !edad.enCurso) {
    lista.push({
      prioridad: 99, icono: edad.siguiente?.icono || '👑',
      texto: `Ya puedes avanzar a la ${edad.siguiente?.nombre}. Es el mayor salto de la partida.`,
      boton: 'Ver el avance', accion: () => irASeccion('investigar')
    })
  }

  const torres = s.buildings.filter(b => b.tipo === 'torre_vigia' || b.tipo === 'torre_ballesta').length
  if (torres < 2 && simNivelDe('ayuntamiento') >= 2) {
    lista.push({
      prioridad: 70, icono: '🗼', texto: torres ? 'Una sola torre deja media aldea sin cubrir.' : 'Tu aldea no tiene quien la vigile.',
      boton: 'Poner torre', accion: () => irA('torre_vigia')
    })
  }

  if (!s.buildings.some(b => b.tipo === 'muralla') && simNivelDe('ayuntamiento') >= 2) {
    lista.push({
      prioridad: 55, icono: '🧱', texto: 'Sin un tramo de muralla, el enemigo entra directo al Ayuntamiento.',
      boton: 'Levantar muros', accion: () => irA('muralla')
    })
  }

  if ((s.obras?.length || 0) === 0 && simPlazasObra() > 0) {
    const pm = s.buildings.filter(b => !b.enObra && !b.mejorando && def(b.tipo) && b.nivel < (def(b.tipo).maxNivel || 1))
      .filter(b => simPuedeMejorar(b.id)?.ok)
    if (pm.length) {
      lista.push({
        prioridad: 60, icono: '🔨', texto: 'Tus constructores están de brazos cruzados.',
        boton: 'Ver mejoras', accion: () => irASeccion('mejorar')
      })
    }
  }

  const comida = s.recursos?.comida || 0
  if (comida < 60 && s.buildings.filter(b => b.tipo === 'granja').length < 3) {
    lista.push({
      prioridad: 85, icono: '🌾', texto: 'Queda poca comida en el granero.',
      boton: 'Sembrar granja', accion: () => irA('granja')
    })
  }

  // dos y no tres: con los accesos rápidos arriba, un tercer consejo empujaba el
  // catálogo fuera de la pantalla del móvil
  return lista.sort((a, b) => b.prioridad - a.prioridad).slice(0, 2)
}

function panelConsejos (consejos) {
  const caja = el('div', { clase: 'panel panel-madera', estilo: { padding: '10px 12px' } }, [
    el('div', { clase: 'fila', estilo: { gap: '8px', marginBottom: '6px' } }, [
      el('span', { texto: '🧔' }),
      el('strong', { texto: 'El maestro de obras recomienda' })
    ])
  ])
  for (const c of consejos) {
    caja.appendChild(el('div', {
      clase: 'fila',
      estilo: { gap: '8px', padding: '6px 0', borderTop: '1px dashed rgba(251,244,228,.25)' }
    }, [
      el('span', { estilo: { fontSize: '1.3em' }, texto: c.icono }),
      el('span', { clase: 'crece pequeño', estilo: { lineHeight: '1.25' }, texto: c.texto }),
      el('button', {
        clase: 'btn btn-oro', type: 'button', texto: c.boton,
        estilo: { minHeight: '44px', padding: '8px 12px', fontSize: '.82em', flex: 'none', maxWidth: '42%' },
        onclick: () => c.accion()
      })
    ]))
  }
  return caja
}

/** Salta a la categoría del edificio y entra a colocarlo si se puede. */
function irA (tipo) {
  const ev = evaluar(tipo)
  if (ev.ok) { entrarEnColocacion(tipo); return }
  categoria = def(tipo)?.categoria || categoria
  seccion = 'construir'
  laHoja?.navegar?.('construir')
  pintarSeccion()
  toast(ev.motivo, 'mal')
}

function irASeccion (id) {
  seccion = id
  if (laHoja?.navegar) laHoja.navegar(id)
  else pintarSeccion()
}

/* ===========================================================================
   3. MEJORAS
   =========================================================================== */

function pintarMejoras (destino) {
  const s = estado()
  const enObra = s.buildings.filter(b => b.enObra || b.mejorando)
  if (enObra.length) {
    destino.appendChild(el('div', { clase: 'titular', texto: '🔨 En obras' }))
    for (const b of enObra) destino.appendChild(tarjetaObra(b))
    destino.appendChild(el('div', { clase: 'separador' }))
  }

  const mejorables = s.buildings
    .filter(b => !b.enObra && !b.mejorando && def(b.tipo))
    .filter(b => b.nivel < (def(b.tipo).maxNivel || 1))
    .map(b => ({ b, ev: simPuedeMejorar(b.id), rent: rentabilidad(b) }))

  // Media lista decía "necesitas el Ayuntamiento a nivel 2" y el Ayuntamiento
  // estaba el cuarto: la llave va primero, y con su cartel.
  const trabadas = mejorables.filter(m => !m.ev?.ok && /ayuntamiento/i.test(m.ev?.motivo || '')).length
  const llave = (m) => (trabadas > 0 && m.b.tipo === 'ayuntamiento') ? 1 : 0
  mejorables.sort((a, b) => llave(b) - llave(a) || (b.ev?.ok ? 1 : 0) - (a.ev?.ok ? 1 : 0) || b.rent - a.rent)

  if (!mejorables.length) {
    destino.appendChild(el('p', { clase: 'tenue', texto: enObra.length ? 'No queda nada más que mejorar ahora mismo.' : 'Todavía no has construido nada. Empieza por el taller.' }))
    return
  }

  const pagables = mejorables.filter(m => m.ev?.ok).length
  destino.appendChild(el('div', { clase: 'fila fila-sep' }, [
    el('span', { clase: 'titular', texto: '⬆️ Dónde invertir' }),
    el('span', { clase: 'pequeño tenue', texto: `${pagables} de ${mejorables.length} al alcance` })
  ]))
  if (!pagables) {
    destino.appendChild(el('div', {
      clase: 'pequeño tenue', estilo: { marginTop: '-2px' },
      texto: trabadas
        ? 'Casi todo espera al Ayuntamiento: subidlo y se abre la aldea entera.'
        : 'Ninguna al alcance todavía: dejad que entren recursos y volved.'
    }))
  }
  for (const m of mejorables) destino.appendChild(tarjetaMejora(m.b, trabadas && m.b.tipo === 'ayuntamiento' ? trabadas : 0))
}

function tarjetaMejora (b, desbloquea = 0) {
  const d = def(b.tipo)
  const siguiente = b.nivel + 1
  const coste = { ...soloCoste(d.coste(siguiente)), tiempo: d.tiempo(siguiente) }

  const caja = el('div', { clase: 'tarjeta tarjeta-fila', estilo: { gap: '9px' } })
  const titulo = el('div', {
    clase: 'tarjeta-nombre',
    // el nombre nunca en rojo: la tarjeta se tiñe cuando no alcanza, pero el rojo
    // tiene que decir "te falta piedra", no "este edificio está mal"
    estilo: { display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap', color: 'var(--tinta)' }
  }, [
    el('span', { texto: d.nombre }),
    el('span', {
      estilo: {
        padding: '2px 9px', borderRadius: 'var(--r-max)', background: 'rgba(90,58,34,.12)',
        border: '1px solid rgba(90,58,34,.3)', fontSize: '.68em', fontWeight: '800'
      },
      texto: `nivel ${b.nivel} → ${siguiente}${d.maxNivel ? ` de ${d.maxNivel}` : ''}`
    }),
    desbloquea
      ? el('span', {
          estilo: {
            padding: '2px 9px', borderRadius: 'var(--r-max)', fontSize: '.66em', fontWeight: '800',
            background: 'linear-gradient(180deg,var(--oro-claro),var(--oro))',
            border: '1px solid var(--oro-oscuro)', color: 'var(--madera-oscura)'
          },
          texto: `🔑 Abre ${desbloquea} mejora${desbloquea === 1 ? '' : 's'}`
        })
      : null
  ])

  // El antes → después en su propia caja: es LO que se compra, no un detalle
  const listaGan = el('div', {
    clase: 'col',
    estilo: {
      gap: '4px', padding: '8px 10px', borderRadius: 'var(--r-s)',
      background: 'rgba(74,143,60,.12)', border: '1px solid rgba(47,97,37,.25)'
    }
  })
  const ganas = ganancias(b.tipo, b.nivel).slice(0, 3)
  for (const g of ganas) {
    listaGan.appendChild(el('div', { clase: 'pequeño', estilo: { display: 'flex', gap: '6px', alignItems: 'baseline' } }, [
      el('span', { clase: 'tenue crece', texto: g.etiqueta }),
      el('span', { clase: 'tenue', texto: String(g.antes) }),
      el('span', { estilo: { fontWeight: '800' }, texto: '→' }),
      el('strong', { estilo: { color: 'var(--verde-oscuro)' }, texto: String(g.despues) })
    ]))
  }
  if (!ganas.length) listaGan.appendChild(el('div', { clase: 'pequeño tenue', texto: 'Más vida y más aguante contra los asaltos.' }))

  const amort = amortizacion(b)
  const pie = el('div', {
    clase: 'pequeño',
    estilo: { fontWeight: '800', color: amort ? 'var(--verde-oscuro)' : 'var(--tinta-suave)' },
    texto: amort ? `💰 Se paga sola en ${formatoTiempo(amort * 60)}` : ''
  })

  const costeNodo = costeVivo(coste)
  const boton = el('button', { clase: 'btn btn-oro', type: 'button', texto: `Mejorar a nivel ${siguiente}`, estilo: { minHeight: '52px' } })
  const aviso = el('div', { clase: 'pequeño no-alcanzable', estilo: { display: 'none', fontWeight: '800' } })

  boton.addEventListener('click', async () => {
    if (simMejorar(b.id)) {
      toast(`${d.icono} ${d.nombre} sube a nivel ${siguiente}`, 'bien')
      reconstruir()
    }
  })

  // Demoler no vive aquí: esta lista es para invertir, y tirar un edificio ya se
  // hace desde su ficha (toque largo en la aldea). Dos sitios para lo irreversible
  // son uno de más.
  caja.append(
    el('div', { clase: 'tarjeta-cabeza' }, [
      el('div', { clase: 'tarjeta-icono', texto: d.icono }),
      el('div', { clase: 'tarjeta-cuerpo' }, [titulo, listaGan])
    ]),
    costeNodo, pie, aviso, boton
  )

  let ultimo = ''
  const refrescar = () => {
    const ev = simPuedeMejorar(b.id) || { ok: alcanza(coste), motivo: '' }
    const clave = `${ev.ok}|${ev.motivo}`
    if (clave === ultimo) return
    ultimo = clave
    boton.disabled = !ev.ok
    caja.classList.toggle('no-alcanzable', !ev.ok && !alcanza(coste))
    aviso.style.display = ev.ok ? 'none' : 'block'
    aviso.textContent = ev.ok ? '' : ev.motivo
  }
  refrescar()
  refrescos.push(refrescar)
  return caja
}

/** Obra en marcha: barra, cuenta atrás y terminar con gemas. */
function tarjetaObra (b) {
  const d = def(b.tipo)
  const caja = el('div', { clase: 'tarjeta tarjeta-fila' })
  const barra = barraProgreso(0, { gorda: true })
  const etiqueta = el('span', { clase: 'pequeño' })
  const queda = el('span', { clase: 'pequeño num' })
  const boton = el('button', { clase: 'btn btn-piedra', type: 'button', texto: 'Terminar ya' })

  boton.addEventListener('click', () => {
    const precio = simCosteAcelerar(b.id)
    if (precio > gemas()) { toast(`Te faltan gemas: cuesta ${precio} 💎`, 'mal'); return }
    if (simAcelerar(b.id)) { toast('¡Obra terminada!', 'bien'); reconstruir() }
  })

  caja.append(
    el('div', { clase: 'tarjeta-cabeza' }, [
      el('div', { clase: 'tarjeta-icono', texto: d?.icono || '🏗️' }),
      el('div', { clase: 'tarjeta-cuerpo' }, [
        el('div', { clase: 'tarjeta-nombre', texto: `${d?.nombre || b.tipo} ${b.mejorando ? `a nivel ${b.nivel + 1}` : ''}` }),
        barra.nodo,
        el('div', { clase: 'barra-texto' }, [etiqueta, queda])
      ])
    ]),
    boton
  )

  const inicio = (estado().obras || []).find(o => o.buildingId === b.id)?.inicio || Date.now()
  const refrescar = () => {
    const restan = simSegRestantes(b.id)
    const total = Math.max(1, (b.finObra - inicio) / 1000)
    barra.fijar(100 * Math.max(0, Math.min(1, 1 - restan / total)))
    const t = formatoTiempo(restan)
    if (queda.textContent !== t) queda.textContent = t
    const precio = simCosteAcelerar(b.id)
    const txt = precio > 0 ? `Terminar ya · ${precio} 💎` : 'Terminar ya'
    if (boton.textContent !== txt) boton.textContent = txt
    boton.disabled = precio > gemas()
    etiqueta.textContent = b.mejorando ? 'Mejorando' : 'Construyendo'
  }
  refrescar()
  refrescos.push(refrescar)
  return caja
}

/* ===========================================================================
   4. INVESTIGACIÓN Y EDAD
   =========================================================================== */

function pintarInvestigacion (destino) {
  destino.appendChild(bloqueEdad())

  const enCurso = seguro(CIENCIA.progresoInvestigacion, null)
  if (enCurso) destino.appendChild(bloqueEnCurso(enCurso))

  const libres = seguro(CIENCIA.disponibles, []) || []
  const cerradas = seguro(CIENCIA.bloqueadas, []) || []

  if (libres.length) {
    destino.appendChild(el('div', { clase: 'titular', estilo: { marginTop: '6px' }, texto: '📖 Se puede investigar ya' }))
    const r = el('div', { clase: 'col', estilo: { gap: '10px' } })
    for (const t of libres) r.appendChild(tarjetaTech(t, true, !!enCurso))
    destino.appendChild(r)
  } else if (!enCurso) {
    destino.appendChild(el('p', { clase: 'tenue', texto: 'Nada que investigar todavía: sube edificios y volverán los sabios.' }))
  }

  if (cerradas.length) {
    destino.appendChild(el('div', { clase: 'titular', estilo: { marginTop: '6px' }, texto: '🔒 Lo que vendrá' }))
    const r = el('div', { clase: 'col', estilo: { gap: '10px' } })
    for (const t of cerradas.slice(0, 8)) r.appendChild(tarjetaTech(t, false, false))
    destino.appendChild(r)
  }
}

/** El hito de la partida: que se vea venir de lejos y con lo que trae puesto. */
function bloqueEdad () {
  const res = seguro(CIENCIA.resumenEdad, null)
  const caja = el('div', { clase: 'panel', estilo: { padding: '12px' } })
  if (!res) { caja.appendChild(el('p', { clase: 'tenue', texto: 'La universidad todavía no abre.' })); return caja }

  if (res.enCurso) {
    const b = barraProgreso(res.enCurso.pct * 100, { gorda: true })
    const queda = el('span', { clase: 'pequeño num' })
    const boton = el('button', { clase: 'btn btn-oro btn-gordo', type: 'button', texto: 'Acelerar' })
    boton.addEventListener('click', () => {
      const r = seguro(CIENCIA.acelerar, { ok: false, motivo: 'No se puede' }, 'edad')
      if (!r.ok) toast(r.motivo, 'mal'); else reconstruir()
    })
    caja.append(
      el('div', { clase: 'titular', texto: `${res.enCurso.icono} Camino a la ${res.enCurso.nombre}` }),
      el('p', { clase: 'pequeño tenue', estilo: { margin: '4px 0 8px' }, texto: 'La aldea entera se prepara. Cuando termine, todo cambia.' }),
      b.nodo, el('div', { clase: 'barra-texto' }, [el('span', { texto: 'Ceremonia en marcha' }), queda]), boton
    )
    const refrescar = () => {
      const p = seguro(CIENCIA.progresoEdad, null)
      if (!p) { reconstruir(); return }
      b.fijar(p.pct * 100)
      const t = formatoTiempo(p.restante)
      if (queda.textContent !== t) queda.textContent = t
      const txt = `Acelerar · ${p.gemas} 💎`
      if (boton.textContent !== txt) boton.textContent = txt
      boton.disabled = p.gemas > gemas()
    }
    refrescar(); refrescos.push(refrescar)
    return caja
  }

  if (!res.siguiente) {
    caja.append(
      el('div', { clase: 'titular', texto: `👑 ${res.titular}` }),
      el('p', { clase: 'pequeño tenue', texto: res.texto })
    )
    return caja
  }

  const coste = { ...soloCoste(res.coste), tiempo: res.tiempo }
  const desbloquea = [...(res.edificios || []), ...(res.unidades || []), ...(res.tecnologias || [])]

  caja.append(
    el('div', { clase: 'fila', estilo: { gap: '10px' } }, [
      el('span', { estilo: { fontSize: '2.4em', lineHeight: '1' }, texto: res.siguiente.icono }),
      el('div', { clase: 'crece' }, [
        el('div', { clase: 'pequeño tenue', texto: `Ahora estás en la ${res.actual.nombre}` }),
        el('div', { clase: 'titular', texto: `Avanzar a la ${res.siguiente.nombre}` })
      ])
    ]),
    el('p', { clase: 'pequeño', estilo: { margin: '8px 0 6px', lineHeight: '1.35' }, texto: res.texto })
  )

  if (desbloquea.length) {
    caja.appendChild(el('div', { clase: 'fila', estilo: { flexWrap: 'wrap', gap: '6px', margin: '4px 0 8px' } },
      desbloquea.slice(0, 6).map(x => chip(x.icono, x.nombre))))
  }

  const reqs = el('div', { clase: 'col', estilo: { gap: '2px', margin: '4px 0 8px' } })
  const pintarReqs = (lista) => {
    vaciar(reqs)
    for (const r of (lista || [])) {
      reqs.appendChild(el('div', {
        clase: 'pequeño', estilo: { color: r.ok ? 'var(--verde-oscuro)' : 'var(--tinta-suave)' },
        texto: `${r.ok ? '✅' : '⬜'} ${r.texto}`
      }))
    }
  }
  pintarReqs(res.requisitos)
  caja.appendChild(reqs)
  caja.appendChild(costeVivo(coste))

  const boton = el('button', {
    clase: 'btn btn-oro btn-gordo', type: 'button',
    estilo: { marginTop: '10px', minHeight: '62px', fontSize: '1.05em' },
    texto: `${res.siguiente.icono} AVANZAR DE EDAD`
  })
  const motivo = el('div', { clase: 'pequeño tenue', estilo: { marginTop: '6px', textAlign: 'center' } })
  boton.addEventListener('click', async () => {
    const si = await confirmar({
      titulo: `${res.siguiente.icono} ${res.siguiente.nombre}`,
      texto: `${res.texto}\n\nLa ceremonia dura ${formatoTiempo(res.tiempo)}.`,
      si: 'Avanzar'
    })
    if (!si) return
    const r = seguro(CIENCIA.avanzarEdad, { ok: false, motivo: 'Todavía no' })
    if (!r.ok) toast(r.motivo, 'mal'); else reconstruir()
  })
  caja.append(boton, motivo)

  let ultimo = ''
  const refrescar = () => {
    const e = seguro(CIENCIA.puedeAvanzar, { ok: false, motivo: '' })
    const clave = `${e.ok}|${e.motivo}|${(e.requisitos || []).map(r => r.ok).join('')}`
    if (clave === ultimo) return
    ultimo = clave
    boton.disabled = !e.ok
    if (e.requisitos) pintarReqs(e.requisitos)      // los ✅ se encienden solos al ir cumpliendo
    // si el motivo ya está en la lista de requisitos de arriba, no se repite
    const repetido = (e.requisitos || res.requisitos || []).some(r => !r.ok && r.texto === e.motivo)
    motivo.textContent = e.ok ? 'Todo listo. Este es el gran salto.' : repetido ? '' : e.motivo
    motivo.className = e.ok ? 'pequeño' : 'pequeño no-alcanzable'
  }
  refrescar(); refrescos.push(refrescar)
  return caja
}

function bloqueEnCurso (p) {
  const caja = el('div', { clase: 'tarjeta' })
  const b = barraProgreso(p.pct * 100, { gorda: true })
  const queda = el('span', { clase: 'pequeño num' })
  const boton = el('button', { clase: 'btn btn-piedra', type: 'button', texto: 'Acelerar' })
  boton.addEventListener('click', () => {
    const r = seguro(CIENCIA.acelerar, { ok: false, motivo: 'No se puede' }, 'investigacion')
    if (!r.ok) toast(r.motivo, 'mal'); else reconstruir()
  })
  caja.append(
    el('div', { clase: 'tarjeta-cabeza' }, [
      el('div', { clase: 'tarjeta-icono', texto: p.icono }),
      el('div', { clase: 'tarjeta-cuerpo' }, [
        el('div', { clase: 'tarjeta-nombre', texto: p.nombre }),
        el('div', { clase: 'tarjeta-detalle', texto: 'Tus sabios están con esto' }),
        b.nodo, el('div', { clase: 'barra-texto' }, [el('span', { texto: 'Investigando' }), queda])
      ])
    ]),
    boton
  )
  const refrescar = () => {
    const q = seguro(CIENCIA.progresoInvestigacion, null)
    if (!q) { reconstruir(); return }
    b.fijar(q.pct * 100)
    const t = formatoTiempo(q.restante)
    if (queda.textContent !== t) queda.textContent = t
    const txt = `Acelerar · ${q.gemas} 💎`
    if (boton.textContent !== txt) boton.textContent = txt
    boton.disabled = q.gemas > gemas()
  }
  refrescar(); refrescos.push(refrescar)
  return caja
}

function tarjetaTech (t, libre, ocupado) {
  const coste = { ...soloCoste(t.coste), tiempo: t.tiempoReal || t.tiempo }
  const caja = el('div', { clase: 'tarjeta' })
  caja.append(
    el('div', { clase: 'tarjeta-cabeza' }, [
      el('div', { clase: 'tarjeta-icono', texto: t.icono }),
      el('div', { clase: 'tarjeta-cuerpo' }, [
        el('div', { clase: 'tarjeta-nombre', texto: t.nombre }),
        el('div', { clase: 'tarjeta-detalle', estilo: { color: 'var(--verde-oscuro)', fontWeight: '800' }, texto: t.resumenEfecto })
      ])
    ]),
    el('div', { clase: 'tarjeta-detalle', texto: t.desc }),
    costeVivo(coste)
  )

  if (libre) {
    const boton = el('button', { clase: 'btn btn-oro', type: 'button', texto: ocupado ? 'Sabios ocupados' : 'Investigar' })
    boton.disabled = ocupado || !alcanza(coste)
    boton.addEventListener('click', () => {
      const r = seguro(CIENCIA.investigar, { ok: false, motivo: 'No se puede' }, t.id)
      if (!r.ok) toast(r.motivo, 'mal'); else reconstruir()
    })
    caja.appendChild(boton)
    const refrescar = () => {
      const puede = !ocupado && alcanza(coste)
      if (boton.disabled === puede) boton.disabled = !puede
      caja.classList.toggle('no-alcanzable', !alcanza(coste))
    }
    refrescos.push(refrescar)
  } else {
    caja.style.filter = 'grayscale(.7)'
    caja.style.opacity = '.7'
    caja.appendChild(el('div', { clase: 'pequeño tenue', estilo: { fontWeight: '800' }, texto: `🔒 ${t.motivo}` }))
  }
  return caja
}

/* ===========================================================================
   5. MODO COLOCACIÓN — lo que más se toca del juego
   =========================================================================== */

let puesta = null        // { tipo, x, z, rot, valido, motivo, cola, puestos, encadena }
let barra = null         // nodos de la barra de abajo
let emitiendo = false    // para no escucharme a mí mismo el BUILD_MODE

const ENCADENA = new Set(['muralla', 'puerta'])
const ANIMOS = [
  'Los canteros ya están en ello',
  '¡Buen sitio! Empieza la obra',
  'El maestro de obras asiente',
  'Anotado en el libro de obras',
  'Las carretillas van de camino'
]

function entrarEnColocacion (tipo) {
  const d = def(tipo)
  if (!d) return
  salirDeColocacion(true)
  cerrar()

  puesta = {
    tipo, rot: 0, x: null, z: null, valido: false,
    motivo: 'Toca la aldea para elegir el sitio',
    cola: [], puestos: 0, encadena: ENCADENA.has(tipo),
    // solo la muralla se pinta arrastrando: una puerta a cada casilla que roza el
    // dedo sería una ruina, y solo caben seis
    pintando: tipo === 'muralla'
  }
  emitirModo(true)
  crearBarra()
  toast(`Elige dónde va: ${d.nombre}`, 'info', 1800)
}

function salirDeColocacion (silencioso = false) {
  if (!puesta) return
  const pendientes = puesta.cola.length
  const puestos = puesta.puestos
  puesta = null
  quitarBarra()
  emitirModo(false)
  if (silencioso) return
  if (pendientes) toast(`Quedaron ${pendientes} tramos sin levantar`, 'info')
  else if (puestos > 1) toast(`${puestos} obras en marcha`, 'bien')
}

function emitirModo (activo) {
  emitiendo = true
  events.emit(EV.BUILD_MODE, activo
    ? { activo: true, tipo: puesta.tipo, rot: puesta.rot, ancho: def(puesta.tipo).ancho, alto: def(puesta.tipo).alto }
    : { activo: false, tipo: null })
  emitiendo = false
}

/**
 * Posición del fantasma. Se emite también como 'build:ghost' para que el render
 * pinte el volumen en verde o rojo sin tener que revalidar por su cuenta.
 * (Payload: { tipo, x, z, rot, ancho, alto, valido, motivo }.)
 */
function moverFantasma (x, z) {
  if (!puesta) return
  const v = sitioLibre(puesta.tipo, x, z)
  puesta.x = x; puesta.z = z
  puesta.valido = v.ok
  puesta.motivo = v.motivo
  const d = def(puesta.tipo)
  events.emit(EV.BUILD_GHOST, {
    tipo: puesta.tipo, x, z, rot: puesta.rot, ancho: d.ancho, alto: d.alto,
    valido: puesta.valido, motivo: puesta.motivo
  })
  refrescarBarra()

  // pintar muros: cada casilla nueva que pisa el dedo entra en la cola
  if (puesta.pintando && puesta.valido) encolar(x, z)
}

/**
 * ¿Cabe AQUÍ? Solo el sitio, sin mirar el bolsillo ni los constructores.
 * validarColocacion mezcla las dos cosas y, con las obras llenas, pintaba de
 * rojo casillas perfectamente buenas: por eso el fantasma se decide aparte.
 */
function sitioLibre (tipo, x, z) {
  const d = def(tipo)
  if (!d) return { ok: false, motivo: 'Aquí no' }
  const v = simValidar(tipo, x, z)
  if (v?.ok) return { ok: true, motivo: '' }
  if (!dentro(x, z) || !dentro(x + d.ancho - 1, z + d.alto - 1)) return { ok: false, motivo: 'Se sale del terreno' }
  if (!huecoLibre(estado(), x, z, d.ancho, d.alto)) return { ok: false, motivo: 'Aquí ya hay algo' }
  return { ok: true, motivo: '' }
}

const COLA_MAX = 30      // un trazo largo, no la muralla china de una sentada

function encolar (x, z) {
  if (!puesta) return
  if (puesta.cola.some(c => c.x === x && c.z === z)) return
  if (puesta.cola.length >= COLA_MAX) {
    if (!puesta.avisoCola) { puesta.avisoCola = true; toast('La cola está llena: deja que levanten estos', 'info') }
    return
  }
  puesta.cola.push({ x, z, rot: puesta.rot })
  vaciarCola()
}

/**
 * Va metiendo la cola en cuanto hay constructor libre. Es la clave de que
 * encadenar murallas no sea un suplicio: el jugador pinta la línea de un
 * trazo y la aldea la levanta sola al ritmo que le dejan las plazas de obra.
 */
function vaciarCola () {
  if (!puesta || !puesta.cola.length) return
  let seguro100 = 0
  while (puesta.cola.length && seguro100++ < 200) {
    const ev = evaluar(puesta.tipo)
    if (!ev.ok) {
      if (ev.causa === 'recursos' && !puesta.avisoSinRecursos) {
        puesta.avisoSinRecursos = true
        toast(`Sin material: quedan ${puesta.cola.length} tramos esperando`, 'mal')
      }
      if (ev.causa === 'tope' || ev.causa === 'edad' || ev.causa === 'requisito') {
        toast(ev.motivo, 'mal')
        puesta.cola.length = 0
      }
      break
    }
    const c = puesta.cola[0]
    if (!sitioLibre(puesta.tipo, c.x, c.z).ok) { puesta.cola.shift(); continue }   // se ocupó mientras esperaba
    const b = simColocar(puesta.tipo, c.x, c.z, c.rot)
    puesta.cola.shift()
    if (!b) break
    puesta.puestos++
    puesta.avisoSinRecursos = false
  }
  refrescarBarra()
}

function construirAqui () {
  if (!puesta) return
  if (puesta.x == null) { toast('Primero toca dónde quieres ponerlo', 'mal'); return }
  if (!puesta.valido) { toast(puesta.motivo || 'Ahí no cabe', 'mal'); return }
  if (puesta.encadena) { encolar(puesta.x, puesta.z); return }   // los muros van por cola

  const ev = evaluar(puesta.tipo)
  if (!ev.ok) { toast(ev.motivo, 'mal'); return }

  const b = simColocar(puesta.tipo, puesta.x, puesta.z, puesta.rot)
  if (!b) return
  puesta.puestos++
  toast(`${def(puesta.tipo).icono} ${ANIMOS[Math.floor(Math.random() * ANIMOS.length)]}`, 'bien')
  salirDeColocacion(true)
}

/* --- la barra de abajo --------------------------------------------------- */

function crearBarra () {
  quitarBarra()
  const d = def(puesta.tipo)
  const raiz = document.getElementById('hud') || document.body

  const caja = el('div', {
    clase: 'panel',
    estilo: {
      position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '55',
      borderRadius: 'var(--r-g) var(--r-g) 0 0', borderBottom: 'none',
      padding: '10px 12px',
      paddingBottom: 'calc(10px + var(--seg-abajo))',
      paddingLeft: 'calc(12px + var(--seg-izq))', paddingRight: 'calc(12px + var(--seg-der))',
      boxShadow: 'var(--sombra-flotante)'
    }
  })

  const estadoTxt = el('div', { clase: 'pequeño', estilo: { fontWeight: '800', lineHeight: '1.25' } })
  const casillaTxt = el('div', { clase: 'pequeño tenue' })
  const costeUno = { ...soloCoste(d.coste(1)), tiempo: d.tiempo(1) }
  const costeTxt = el('div', { html: costeHTML(costeUno) })

  caja.appendChild(el('div', { clase: 'fila', estilo: { gap: '10px', marginBottom: '8px' } }, [
    el('span', { estilo: { fontSize: '1.9em', lineHeight: '1' }, texto: d.icono }),
    el('div', { clase: 'crece' }, [
      el('div', { estilo: { fontWeight: '800' }, texto: d.nombre }),
      estadoTxt, casillaTxt
    ]),
    costeTxt
  ]))

  const girable = d.ancho !== d.alto
  const fila = el('div', { estilo: { display: 'grid', gridTemplateColumns: girable ? 'auto auto 1fr' : 'auto 1fr', gap: '8px' } })

  if (girable) {
    fila.appendChild(el('button', {
      clase: 'btn btn-piedra', type: 'button', texto: '↻', 'aria-label': 'Girar',
      estilo: { minWidth: '56px', minHeight: '56px', fontSize: '1.3em' },
      onclick: () => {
        puesta.rot = (puesta.rot + 1) % 4
        emitirModo(true)
        if (puesta.x != null) moverFantasma(puesta.x, puesta.z)
        refrescarBarra()
      }
    }))
  }
  fila.appendChild(el('button', {
    clase: 'btn btn-piedra', type: 'button', texto: '✕', 'aria-label': 'Cancelar',
    estilo: { minWidth: '56px', minHeight: '56px', fontSize: '1.2em' },
    onclick: () => salirDeColocacion()
  }))
  const confirmarBtn = el('button', {
    clase: 'btn btn-oro', type: 'button', texto: 'Construir aquí',
    datos: { tutorial: 'confirmar' },          // la guía pone aquí la mano
    estilo: { minHeight: '56px', width: '100%', fontSize: '1.02em' },
    onclick: () => construirAqui()
  })
  fila.appendChild(confirmarBtn)
  caja.appendChild(fila)

  // pista y contador para el pintado de muros
  const pista = el('div', { clase: 'pequeño tenue', estilo: { marginTop: '8px', display: puesta.encadena ? 'flex' : 'none', gap: '8px', alignItems: 'center' } })
  const pistaTxt = el('span', { clase: 'crece' })
  const listo = el('button', {
    clase: 'btn btn-fantasma', type: 'button', texto: 'Listo',
    estilo: { minHeight: '44px', flex: 'none' },
    onclick: () => salirDeColocacion()
  })
  pista.append(pistaTxt, listo)
  caja.appendChild(pista)

  raiz.appendChild(caja)
  barra = { caja, estadoTxt, casillaTxt, confirmarBtn, pistaTxt, costeTxt, costeUno, firmaCoste: null }
  refrescarBarra()
}

function quitarBarra () {
  barra?.caja?.remove()
  barra = null
}

function refrescarBarra () {
  if (!barra || !puesta) return
  const sinSitio = puesta.x == null
  const ev = evaluar(puesta.tipo)
  const enEspera = ev.causa === 'obras' && puesta.encadena     // los muros esperan en cola; lo demás, no
  const puedeYa = puesta.valido && (ev.ok || enEspera)

  const texto = sinSitio
    ? '👆 Toca la aldea para colocarlo'
    : !puesta.valido
        ? `⛔ ${puesta.motivo}`
        : ev.ok
          ? '✅ Aquí cabe'
          : ev.causa === 'obras'
            ? (enEspera ? '⏳ Entra en cola: los constructores están liados' : '⏳ Constructores ocupados: termina o acelera una obra')
            : `⛔ ${ev.motivo}`
  if (barra.estadoTxt.textContent !== texto) barra.estadoTxt.textContent = texto
  barra.estadoTxt.style.color = sinSitio ? '' : (puesta.valido && ev.ok) ? 'var(--verde-oscuro)' : puedeYa ? 'var(--madera)' : 'var(--rojo)'

  // el rojo del coste se enciende y se apaga mientras pintas muros
  const firma = RECURSOS.map(r => (recursos()[r] || 0) >= (barra.costeUno[r] || 0) ? 1 : 0).join('')
  if (firma !== barra.firmaCoste) { barra.firmaCoste = firma; barra.costeTxt.innerHTML = costeHTML(barra.costeUno) }

  const casilla = sinSitio ? '' : `Casilla ${puesta.x}, ${puesta.z}${puesta.rot ? ` · girado ${puesta.rot * 90}°` : ''}`
  if (barra.casillaTxt.textContent !== casilla) barra.casillaTxt.textContent = casilla

  barra.confirmarBtn.disabled = !puedeYa
  const txtBoton = puesta.encadena ? (puesta.cola.length ? 'Añadir tramo' : 'Poner tramo') : 'Construir aquí'
  if (barra.confirmarBtn.textContent !== txtBoton) barra.confirmarBtn.textContent = txtBoton

  if (puesta.encadena && barra.pistaTxt) {
    const seguir = puesta.pintando ? 'sigue arrastrando el dedo' : 'pon la siguiente o pulsa Listo'
    const t = puesta.cola.length
      ? `${def(puesta.tipo).icono} ${puesta.puestos} levantados · ${puesta.cola.length} en cola (entran solos)`
      : puesta.puestos
        ? `${def(puesta.tipo).icono} ${puesta.puestos} levantados · ${seguir}`
        : puesta.pintando
          ? '✏️ Arrastra el dedo para encadenar muros de un trazo'
          : '➕ Se colocan de una en una: no hay que volver a abrir el taller'
    if (barra.pistaTxt.textContent !== t) barra.pistaTxt.textContent = t
  }
}

/* ===========================================================================
   Enganches
   =========================================================================== */

export function init () {
  events.on(EV.UI_PANEL, (p) => {
    const cual = p?.panel
    if (!cual) { cerrar(); return }
    if (cual === 'construir' || cual === 'taller') { salirDeColocacion(true); abrir(p?.datos?.vista || 'construir') }
    else if (cual === 'mejorar' || cual === 'mejoras') { salirDeColocacion(true); abrir('mejorar') }
    else if (cual === 'investigar' || cual === 'investigacion') { salirDeColocacion(true); abrir('investigar') }
    else cerrar()                             // manda otro panel: quítate de en medio
  })

  events.on(EV.GRID_TAP, (p) => {
    if (!puesta || !p) return
    moverFantasma(p.x | 0, p.z | 0)
  })

  // si otro módulo apaga el modo construcción, aquí se recoge la mesa
  events.on(EV.BUILD_MODE, (p) => {
    if (emitiendo || !puesta) return
    if (p && p.activo === false) salirDeColocacion(true)
  })

  events.on(EV.TICK, () => {
    if (puesta?.cola.length) vaciarCola()
    if (laHoja || barra) refrescarLigero()
  })

  // gastar o cobrar enciende y apaga botones: el refresco ligero ya viene limitado
  events.on(EV.RESOURCES_CHANGED, () => { if (laHoja || barra) refrescarLigero() })

  // cambios de fondo: aquí sí hay que repintar la lista entera
  for (const ev of [EV.BUILD_COMPLETED, EV.BUILD_UPGRADED, EV.BUILD_DEMOLISHED, EV.BUILD_PLACED,
    EV.TECH_RESEARCHED, EV.AGE_ADVANCED, EV.LEVEL_UP]) {
    events.on(ev, () => reconstruir())
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && puesta) { e.preventDefault(); salirDeColocacion() }
  })

  // atajo de pruebas en el navegador: baluarte.taller.abrir('mejorar')
  if (typeof window !== 'undefined') window.taller = { abrir, cerrar, colocar: entrarEnColocacion, get modo () { return puesta } }
}
