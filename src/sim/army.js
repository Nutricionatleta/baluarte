/**
 * EJÉRCITO. Dueño de `game.state.ejercito` = { tropas, cola, fuera, hambre }.
 *
 * Aquí vive todo lo de la hueste: entrenar, la cola del cuartel, cuánto sitio
 * hay, cuánto come, qué tropa está fuera de casa y —lo más importante para el
 * combate— las estadísticas REALES de cada unidad, ya mejoradas con la
 * herrería y las tecnologías investigadas.
 *
 * EQUILIBRIO (el porqué de los números):
 *   - El hueco del ejército sale de los edificios militares: si quieres más
 *     tropa, mejoras cuartel/arquería/establo/taller. No hay atajo.
 *   - La tropa COME. Un ejército grande se lleva varias granjas por delante y,
 *     si se acaba el grano, pierde moral y pega un 20 % menos. Eso impide
 *     acumular hueste infinita y dejarla criando polvo.
 *   - `poderMilitar()` es el número con el que el mundo te empareja enemigos:
 *     si miente, el juego se vuelve un paseo o un muro.
 */

import { CONFIG } from '../core/config.js'
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { EDIFICIOS, ORDEN_EDADES, AGE_NOMBRE } from '../data/buildings.js'
import { UNIDADES, defUnidad } from '../data/units.js'
import { TECNOLOGIAS } from '../data/techs.js'
// El banco es el único que toca los recursos; aquí solo se le pide.
import { puedePagar, faltaPara, pagar, ingresarVarios, gemas, registrarConsumoOffline } from './resources.js'

// --------------------------------------------------------------- equilibrio
/** Huecos de ejército: los dan los edificios militares, por eso mejorar tiene premio. */
const HUECOS_BASE = 4
const HUECOS_POR_NIVEL = 6
const EDIFICIOS_HUECO = ['cuartel', 'arqueria', 'establo', 'taller_asedio']

/**
 * Comida por minuto de cada unidad = su coste / este divisor.
 * Calibrado contra la granja (14 comida/min a nivel 1): veinte lanceros se
 * comen media granja y diez caballeros, una entera. Mantener hueste cuesta.
 */
const DIVISOR_MANUTENCION = 110
const PESO_MANUTENCION = { comida: 1, oro: 1.5, madera: 0.35, piedra: 0.35 }
const PENALIZACION_HAMBRE = 0.8   // sin grano, la tropa pega un 20 % menos

/**
 * Cuánto vale cada clase para el emparejamiento. El ariete tiene vida de sobra
 * pero contra tropa da risa, y el monje no mata a nadie: si contasen enteros,
 * inflarían tu poder y el mundo te mandaría enemigos que no puedes ganar.
 */
const PESO_CLASE = { infanteria: 1, distancia: 1, caballeria: 1, asedio: 0.6, civil: 0.25 }

// ----------------------------------------------------------- estado propio
/** Devuelve el bloque de ejército ya saneado (partidas viejas incluidas). */
function ej () {
  const s = game.state
  if (!s.ejercito || typeof s.ejercito !== 'object') s.ejercito = { tropas: {}, cola: [] }
  const e = s.ejercito
  if (!e.tropas || typeof e.tropas !== 'object') e.tropas = {}
  if (!Array.isArray(e.cola)) e.cola = []
  if (!e.fuera || typeof e.fuera !== 'object') e.fuera = {}
  if (typeof e.hambre !== 'boolean') e.hambre = false
  if (typeof e.ultimoConsumo !== 'number') e.ultimoConsumo = Date.now()
  if (typeof e.restoComida !== 'number') e.restoComida = 0
  return e
}

// Cuenta por NIVEL, no por andamios: una construcción nueva vale 0 hasta que
// termina, pero un edificio que se mejora conserva lo que ya te daba.
const activos = (tipo) => game.state.buildings.filter(b => b.tipo === tipo && (b.nivel || 0) > 0)
/** Nivel del mejor edificio terminado de ese tipo (0 = no lo tienes). */
const nivelDe = (tipo) => activos(tipo).reduce((m, b) => Math.max(m, b.nivel || 1), 0)
/** Suma de niveles: dos cuarteles del 3 dan el mismo hueco que uno del 6. */
const sumaNiveles = (tipo) => activos(tipo).reduce((m, b) => m + (b.nivel || 1), 0)

/** Edificio terminado que entrena esa unidad; el de mayor nivel, que va más rápido. */
function entrenadorDe (tipoUnidad) {
  let mejor = null
  for (const [tipo, def] of Object.entries(EDIFICIOS)) {
    if (!def.entrena || !def.entrena.includes(tipoUnidad)) continue
    const nivel = nivelDe(tipo)
    if (nivel > 0 && (!mejor || nivel > mejor.nivel)) mejor = { tipo, nivel, def }
  }
  return mejor
}

/** Coste completo de N unidades, con los cuatro recursos siempre presentes. */
function costeDe (tipo, cantidad = 1) {
  const u = UNIDADES[tipo]
  const c = {}
  for (const r of CONFIG.RECURSOS) c[r] = (u.coste[r] || 0) * cantidad
  return c
}

// ------------------------------------------------------------ estadísticas
/**
 * Bonos militares acumulados: herrería (afecta a TODA la tropa) + tecnologías.
 * Los efectos SUMAN entre sí en vez de multiplicarse: cuatro mejoras del 20 %
 * deben ser un +80 %, no un ×2,07, o el combate se descontrola a las cuatro horas.
 */
function bonos (clase) {
  const nivel = nivelDe('herreria')
  let ataque = nivel > 0 ? EDIFICIOS.herreria.bonusAtaque(nivel) : 0
  let armadura = nivel > 0 ? EDIFICIOS.herreria.bonusArmadura(nivel) : 0
  for (const [id, hecha] of Object.entries(game.state.research || {})) {
    if (!hecha) continue
    const ef = TECNOLOGIAS[id]?.efecto
    if (!ef || (ef.objetivo !== 'todas' && ef.objetivo !== clase)) continue
    if (ef.tipo === 'ataque') ataque += ef.valor
    else if (ef.tipo === 'armadura') armadura += ef.valor
  }
  return { ataque, armadura }
}

const redondear = (v) => Math.round(v * 10) / 10

/**
 * Estadísticas REALES de una unidad: base + herrería + tecnologías (+ hambre).
 * Es lo que debe usar el módulo de combate, nunca `UNIDADES[tipo]` a pelo.
 * @param {string} tipo
 * @param {boolean} [conMoral] false para el poder militar, que no debe bailar por un bache de comida
 * @returns {{tipo:string, clase:string, espacio:number, hp:number, ataque:number, armadura:number, velocidad:number, alcance:number}|null}
 */
export function estadisticasUnidad (tipo, conMoral = true) {
  const u = defUnidad(tipo)
  if (!u) return null
  const b = bonos(u.clase)
  const moral = conMoral && ej().hambre ? PENALIZACION_HAMBRE : 1
  return {
    tipo,
    clase: u.clase,
    espacio: u.espacio,
    hp: Math.round(u.hp),
    ataque: redondear(u.ataque * (1 + b.ataque) * moral),
    armadura: redondear(u.armadura * (1 + b.armadura)),
    velocidad: u.velocidad,
    alcance: u.alcance
  }
}

// --------------------------------------------------------------- capacidad
/** Hueco total de la hueste. Sale de los edificios militares y de nada más. */
export function capacidad () {
  const niveles = EDIFICIOS_HUECO.reduce((t, tipo) => t + sumaNiveles(tipo), 0)
  return HUECOS_BASE + niveles * HUECOS_POR_NIVEL
}

/** Lo ocupado. La cola CUENTA: si no, se encargaría tropa que luego no cabe. */
export function ocupacion () {
  const e = ej()
  let usado = 0
  for (const [tipo, n] of Object.entries(e.tropas)) usado += (UNIDADES[tipo]?.espacio || 0) * n
  for (const item of e.cola) usado += (UNIDADES[item.tipo]?.espacio || 0)
  return { usado, total: capacidad() }
}

/**
 * Fuerza del ejército en un número, para que el mundo te empareje con enemigos
 * de tu tamaño. Por unidad:
 *
 *   valor = (ataque×2 + vida/4) × (1 + armadura×0,08) × peso de clase
 *
 *   - el ataque manda (×2): un ejército que no mata no gana batallas;
 *   - la vida entra dividida entre 4 para que un ariete de 260 hp no valga
 *     por diez lanceros solo por ser gordo;
 *   - la armadura sube suave: cada punto quita daño, no lo anula;
 *   - el peso de clase corrige a los tramposos (asedio 0,6 y civiles 0,25).
 *
 * El resultado da un valor por HUECO muy parecido en toda la tropa de combate
 * (~30 por espacio), así que llenar el ejército de lanceros o de caballeros da
 * un poder comparable: el emparejamiento no se rompe al cambiar de composición,
 * solo al hacerse de verdad más fuerte. Cuenta con las mejoras de la herrería y
 * las tecnologías, pero NO con el hambre: eso es un bache, no tu nivel real.
 */
export function poderMilitar () {
  const e = ej()
  let total = 0
  for (const [tipo, n] of Object.entries(e.tropas)) {
    const u = UNIDADES[tipo]
    if (!u || u.espacio <= 0) continue        // aldeanos y exploradores no son hueste
    const s = estadisticasUnidad(tipo, false)
    const valor = (s.ataque * 2 + s.hp / 4) * (1 + s.armadura * 0.08) * (PESO_CLASE[u.clase] ?? 1)
    total += valor * n
  }
  return Math.round(total)
}

// ---------------------------------------------------------------- entrenar
/**
 * ¿Se puede encargar esta tropa? Comprueba edificio, edad, sitio y dinero.
 * @returns {{ok:boolean, motivo:string, falta?:object}}
 */
export function puedeEntrenar (tipo, cantidad = 1) {
  const u = defUnidad(tipo)
  if (!u) return { ok: false, motivo: 'Esa unidad no existe' }
  const n = Math.floor(cantidad)
  if (!(n > 0)) return { ok: false, motivo: 'Cantidad no válida' }

  if (ORDEN_EDADES.indexOf(game.state.age) < ORDEN_EDADES.indexOf(u.age)) {
    return { ok: false, motivo: `Necesitas llegar a la ${AGE_NOMBRE[u.age]}` }
  }

  for (const [tipoEd, nivelMin] of Object.entries(u.requiere || {})) {
    const nivel = nivelDe(tipoEd)
    const nombre = EDIFICIOS[tipoEd]?.nombre || tipoEd
    if (nivel <= 0) return { ok: false, motivo: `Te falta ${nombre}` }
    if (nivel < nivelMin) return { ok: false, motivo: `${nombre} nivel ${nivelMin}` }
  }
  if (!entrenadorDe(tipo)) return { ok: false, motivo: 'Ningún edificio tuyo entrena eso' }

  const oc = ocupacion()
  if (oc.usado + u.espacio * n > oc.total) {
    return { ok: false, motivo: 'No cabe más tropa: mejora tus edificios militares' }
  }

  const coste = costeDe(tipo, n)
  if (!puedePagar(coste)) return { ok: false, motivo: 'No tienes recursos', falta: faltaPara(coste) }

  return { ok: true, motivo: '' }
}

/** Segundos por unidad, acelerados por la velocidad del edificio que la saca. */
function duracion (tipo) {
  const ent = entrenadorDe(tipo)
  const vel = ent?.def.velocidad ? ent.def.velocidad(ent.nivel) : 1
  return Math.max(1, Math.round(UNIDADES[tipo].tiempo / Math.max(0.1, vel)))
}

/**
 * Cobra por adelantado y mete en la cola. La cola es secuencial: una unidad
 * detrás de otra, con `fin` en hora real para que avance con la app cerrada.
 * @returns {{ok:boolean, motivo:string}}
 */
export function entrenar (tipo, cantidad = 1) {
  const n = Math.floor(cantidad)
  const permiso = puedeEntrenar(tipo, n)
  if (!permiso.ok) {
    events.emit(EV.UI_TOAST, { texto: permiso.motivo, tipo: 'mal' })
    if (permiso.falta) events.emit(EV.RESOURCE_DENIED, { falta: permiso.falta, motivo: 'entrenar' })
    return permiso
  }

  const u = UNIDADES[tipo]
  if (!pagar(costeDe(tipo, n), `entrenar ${u.nombre}`)) {
    return { ok: false, motivo: 'No tienes recursos' }
  }

  const e = ej()
  const dur = duracion(tipo) * 1000
  const ahora = Date.now()
  let reloj = Math.max(ahora, e.cola.length ? e.cola[e.cola.length - 1].fin : ahora)
  for (let i = 0; i < n; i++) {
    const inicio = reloj
    reloj += dur
    e.cola.push({ tipo, inicio, fin: reloj })
  }
  events.emit(EV.SFX, { nombre: 'entrenar' })
  events.emit(EV.UI_TOAST, { texto: `${u.icono} ${n} × ${u.nombre} en camino`, tipo: 'info' })
  return { ok: true, motivo: '' }
}

/** Recoloca los tiempos de la cola: nadie espera por un hueco que ya no existe. */
function recolocarCola () {
  const e = ej()
  let reloj = Date.now()
  for (const item of e.cola) {
    const dur = item.fin - item.inicio
    item.inicio = reloj
    item.fin = reloj + dur
    reloj = item.fin
  }
}

/**
 * Cancela un encargo de la cola y devuelve su coste ENTERO: esa unidad no ha
 * salido, así que no se queda nada por el camino.
 */
export function cancelar (indice) {
  const e = ej()
  const item = e.cola[indice]
  if (!item) return { ok: false, motivo: 'Ese encargo ya no está en la cola' }
  e.cola.splice(indice, 1)
  ingresarVarios(costeDe(item.tipo, 1))
  recolocarCola()
  events.emit(EV.UI_TOAST, { texto: `${UNIDADES[item.tipo].nombre} cancelado`, tipo: 'info' })
  return { ok: true, motivo: '' }
}

/** Termina la cola entera con gemas, al mismo precio que las obras. */
export function acelerarEntrenamiento () {
  const e = ej()
  if (!e.cola.length) return { ok: false, motivo: 'No hay nada entrenándose' }
  const restante = Math.max(0, e.cola[e.cola.length - 1].fin - Date.now())
  const precio = Math.max(1, Math.ceil(restante / 1000 / CONFIG.SEG_POR_GEMA))
  if (!gemas(-precio, 'acelerar entrenamiento')) {
    events.emit(EV.UI_TOAST, { texto: `Te faltan gemas: cuesta ${precio} 💎`, tipo: 'mal' })
    return { ok: false, motivo: `Necesitas ${precio} gemas`, gemas: precio }
  }
  const ahora = Date.now()
  for (const item of e.cola) { item.inicio = ahora; item.fin = ahora }
  procesarCola()
  events.emit(EV.SFX, { nombre: 'gema' })
  return { ok: true, motivo: '', gemas: precio }
}

/** Saca de la cola todo lo que ya cumplió su tiempo. Va por reloj real: también offline. */
function procesarCola () {
  const e = ej()
  const ahora = Date.now()
  let salidas = 0
  while (e.cola.length && e.cola[0].fin <= ahora) {
    const item = e.cola.shift()
    e.tropas[item.tipo] = (e.tropas[item.tipo] || 0) + 1
    salidas++
    events.emit(EV.UNIT_TRAINED, { tipo: item.tipo, cantidad: 1 })
  }
  if (salidas && !e.cola.length) {
    events.emit(EV.UI_TOAST, { texto: '⚔️ Tropa lista: no queda nada en la cola', tipo: 'bien' })
  }
}

// ------------------------------------------------------------------ comida
/**
 * Lo que come la hueste por minuto, proporcional al coste de cada unidad:
 * la carne de cañón casi se alimenta sola y el caballero se come una granja.
 * @returns {number} comida por minuto
 */
export function consumoComida () {
  const e = ej()
  let total = 0
  for (const [tipo, n] of Object.entries(e.tropas)) {
    const u = UNIDADES[tipo]
    if (!u || u.espacio <= 0) continue      // los aldeanos comen en villagers, no aquí
    let valor = 0
    for (const [r, peso] of Object.entries(PESO_MANUTENCION)) valor += (u.coste[r] || 0) * peso
    total += Math.max(0.05, valor / DIVISOR_MANUTENCION) * n
  }
  return Math.round(total * 100) / 100
}

/** @returns {boolean} ¿la tropa está sin comer? (entonces pega un 20 % menos) */
export const hayHambre = () => ej().hambre

/**
 * Cobra la manutención de un rato concreto. NUNCA deja la despensa en negativo:
 * si no llega, se come lo que haya y la tropa pasa hambre (−20 % de ataque).
 * La comida que falta NO queda a deber: el hambre ya es el castigo.
 * @param {number} segundos
 */
function cobrarManutencion (segundos) {
  const e = ej()
  const dt = Math.max(0, Number(segundos) || 0)
  if (dt <= 0) return

  const porMinuto = consumoComida()
  if (porMinuto <= 0) { e.restoComida = 0; cambiarHambre(false); return }

  // La fracción sobrante se guarda: si no, un ejército pequeño no comería nunca.
  const bruto = porMinuto * (dt / 60) + e.restoComida
  const entero = Math.floor(bruto)
  e.restoComida = Math.round((bruto - entero) * 1000) / 1000
  if (entero <= 0) return

  if (pagar({ comida: entero }, 'manutención del ejército')) {
    cambiarHambre(false)
    return
  }
  // No llega: se come lo que quede en el granero y la tropa pierde moral.
  const queda = Math.floor(game.state.recursos.comida || 0)
  if (queda > 0) pagar({ comida: queda }, 'manutención del ejército')
  e.restoComida = 0
  cambiarHambre(true)
}

/**
 * Manutención con la app abierta. Se mide con el reloj real y con el mismo tope
 * offline que la producción. El rato con la app CERRADA no llega por aquí: lo
 * cobra `sim/resources.js` tramo a tramo mientras ingresa la producción.
 */
function comer () {
  const e = ej()
  const ahora = Date.now()
  const dt = Math.min((ahora - e.ultimoConsumo) / 1000, CONFIG.MAX_OFFLINE_HORAS * 3600)
  if (dt < 5) return                        // no vale la pena cobrar cuatro veces por segundo
  e.ultimoConsumo = ahora
  cobrarManutencion(dt)
}

function cambiarHambre (valor) {
  const e = ej()
  if (e.hambre === valor) return
  e.hambre = valor
  events.emit(EV.UI_TOAST, valor
    ? { texto: '🥖 Sin grano: tus tropas pierden moral y pegan un 20 % menos', tipo: 'mal' }
    : { texto: '🍲 La tropa vuelve a comer caliente', tipo: 'bien' })
}

// -------------------------------------------------------- bajas y bloqueos
/** Fracción de bajas que el monasterio devuelve a casa (0 si no lo tienes). */
function curacionMonasterio () {
  const nivel = nivelDe('monasterio')
  return nivel > 0 ? EDIFICIOS.monasterio.curacion(nivel) : 0
}

/** Descuenta bajas de lo que estaba fuera, para que `fuera` no mienta al volver. */
function descontarDeFuera (tipo, cantidad) {
  const e = ej()
  let resto = cantidad
  for (const motivo of Object.keys(e.fuera)) {
    if (resto <= 0) break
    const bloque = e.fuera[motivo]
    const tiene = bloque[tipo] || 0
    if (!tiene) continue
    const quita = Math.min(tiene, resto)
    bloque[tipo] = tiene - quita
    resto -= quita
    if (!bloque[tipo]) delete bloque[tipo]
    if (!Object.keys(bloque).length) delete e.fuera[motivo]
  }
}

/**
 * Resta las bajas de una batalla. Con monasterio, parte vuelve a casa
 * REDONDEANDO HACIA ARRIBA: que se note que pagaste por él.
 * @param {Record<string,number>} bajas p.ej. { lancero: 3 }
 * @returns {{perdidas:object, curadas:object}}
 */
export function perderTropas (bajas = {}) {
  const e = ej()
  const cura = curacionMonasterio()
  const perdidas = {}
  const curadas = {}
  for (const [tipo, cant] of Object.entries(bajas)) {
    const pedidas = Math.max(0, Math.floor(cant || 0))
    if (!pedidas || !UNIDADES[tipo]) continue
    const caidas = Math.min(pedidas, e.tropas[tipo] || 0)
    if (!caidas) continue
    const salvadas = cura > 0 ? Math.min(caidas, Math.ceil(caidas * cura)) : 0
    const muertas = caidas - salvadas
    if (muertas > 0) {
      e.tropas[tipo] -= muertas
      if (e.tropas[tipo] <= 0) delete e.tropas[tipo]
      descontarDeFuera(tipo, muertas)
      perdidas[tipo] = muertas
    }
    if (salvadas > 0) curadas[tipo] = salvadas
  }
  if (Object.keys(curadas).length) {
    const n = Object.values(curadas).reduce((a, b) => a + b, 0)
    events.emit(EV.UI_TOAST, { texto: `⛪ El monasterio ha salvado a ${n} de los tuyos`, tipo: 'bien' })
  }
  return { perdidas, curadas }
}

/** Copia de la tropa que está en casa: la que salió no puede pelear en dos sitios. */
export function tropasDisponibles () {
  const e = ej()
  const libre = { ...e.tropas }
  for (const bloque of Object.values(e.fuera)) {
    for (const [tipo, n] of Object.entries(bloque)) {
      libre[tipo] = Math.max(0, (libre[tipo] || 0) - n)
      if (!libre[tipo]) delete libre[tipo]
    }
  }
  return libre
}

/**
 * Saca tropa de la aldea (asalto, expedición…) y la deja apartada en `fuera`.
 * @param {Record<string,number>} tropas @param {string} motivo clave de la salida
 */
export function bloquear (tropas = {}, motivo = 'asalto') {
  const e = ej()
  if (e.fuera[motivo]) return { ok: false, motivo: `Ya tienes tropa fuera en "${motivo}"` }
  const libre = tropasDisponibles()
  const bloque = {}
  for (const [tipo, cant] of Object.entries(tropas)) {
    const n = Math.max(0, Math.floor(cant || 0))
    if (!n) continue
    if ((libre[tipo] || 0) < n) {
      return { ok: false, motivo: `No tienes ${n} × ${UNIDADES[tipo]?.nombre || tipo} en casa` }
    }
    bloque[tipo] = n
  }
  if (!Object.keys(bloque).length) return { ok: false, motivo: 'No has elegido tropa' }
  e.fuera[motivo] = bloque
  return { ok: true, motivo: '' }
}

/**
 * Devuelve a casa lo que quedase de esa salida. Sin motivo, libera todo.
 * @returns {Record<string,number>} lo que vuelve
 */
export function liberar (motivo) {
  const e = ej()
  if (motivo == null) {
    const todo = e.fuera
    e.fuera = {}
    return todo
  }
  const bloque = e.fuera[motivo] || {}
  delete e.fuera[motivo]
  return bloque
}

/** Toda la tropa fuera de casa, agrupada por tipo (para pintarla en la interfaz). */
export function tropasFuera () {
  const total = {}
  for (const bloque of Object.values(ej().fuera)) {
    for (const [tipo, n] of Object.entries(bloque)) total[tipo] = (total[tipo] || 0) + n
  }
  return total
}

// -------------------------------------------------------------------- init
export function init () {
  ej()
  // Al cargar partida, cola y manutención se ponen al día solas: las dos miran
  // la diferencia real con Date.now(), con el tope offline de CONFIG.
  events.on(EV.STATE_LOADED, () => { ej(); procesarCola() })
  events.on(EV.TICK, () => { procesarCola(); comer() })

  // El banco lleva la contabilidad del rato con la app cerrada y nos va cobrando
  // tramo a tramo, entre cosecha y cosecha. Marcamos el reloj en cada tramo para
  // que `comer()` no vuelva a cobrar lo mismo en el primer tick.
  registrarConsumoOffline((segundos) => {
    ej().ultimoConsumo = Date.now()
    cobrarManutencion(segundos)
  })

  procesarCola()
}
