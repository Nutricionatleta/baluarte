/**
 * EJÉRCITO. Dueño de `game.state.ejercito`:
 *   { tropas, cola, fuera, hambre, heridos, curacion, reunion }
 *
 * Aquí vive todo lo de la hueste: entrenar, la cola del cuartel, cuánto sitio
 * hay, cuánto come, qué tropa está fuera de casa, quién está convaleciente,
 * dónde forma y —lo más importante para el combate— las estadísticas REALES de
 * cada unidad, ya mejoradas con la herrería y las tecnologías investigadas.
 *
 * EQUILIBRIO (el porqué de los números):
 *   - El hueco del ejército sale de los edificios militares: si quieres más
 *     tropa, mejoras cuartel/arquería/establo/taller. No hay atajo.
 *   - La tropa COME. Un ejército grande se lleva varias granjas por delante y,
 *     si se acaba el grano, pierde moral y pega un 20 % menos. Eso impide
 *     acumular hueste infinita y dejarla criando polvo.
 *   - **Casi nadie muere del todo.** Perder una batalla ya no borra el ejército:
 *     la mayoría vuelve HERIDA y se recupera con el tiempo (ver la sección de
 *     heridos). El precio de atacar no es volver a pagar la hueste, es quedarte
 *     sin ella unas horas. Los heridos siguen ocupando hueco y comiendo a
 *     medias, así que tampoco puedes rellenar el ejército mientras convalecen.
 *   - `poderMilitar()` es el número con el que el mundo te empareja enemigos:
 *     si miente, el juego se vuelve un paseo o un muro. Los heridos NO cuentan,
 *     porque no pueden pelear.
 */

import { CONFIG } from '../core/config.js'
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { dentro, tamañoDe, centroDe, dist, esTerritorio } from '../core/grid.js'
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
  // Enfermería: quién está convaleciente y hasta cuándo (reloj real, también offline).
  if (!e.heridos || typeof e.heridos !== 'object') e.heridos = {}
  if (!e.curacion || typeof e.curacion !== 'object') e.curacion = { inicio: 0, fin: 0 }
  if (typeof e.curacion.inicio !== 'number') e.curacion.inicio = 0
  if (typeof e.curacion.fin !== 'number') e.curacion.fin = 0
  // Punto de reunión: `fijada` distingue el que puso el jugador del automático.
  if (e.reunion && typeof e.reunion === 'object') {
    if (!Number.isFinite(e.reunion.x) || !Number.isFinite(e.reunion.z)) e.reunion = null
    else {
      if (typeof e.reunion.fijada !== 'boolean') e.reunion.fijada = false
      if (typeof e.reunion.ancla !== 'string') e.reunion.ancla = null
    }
  } else e.reunion = null
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

/**
 * Lo ocupado. La cola CUENTA: si no, se encargaría tropa que luego no cabe.
 * Los HERIDOS también: siguen siendo tuyos y volverán, así que si no ocupasen
 * sitio podrías rellenar el ejército mientras convalecen y desbordar el cuartel
 * en cuanto se levantaran. Es, además, el verdadero precio de una batalla dura.
 */
export function ocupacion () {
  const e = ej()
  let usado = 0
  for (const [tipo, n] of Object.entries(e.tropas)) usado += (UNIDADES[tipo]?.espacio || 0) * n
  for (const [tipo, n] of Object.entries(e.heridos)) usado += (UNIDADES[tipo]?.espacio || 0) * n
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
 * Los heridos comen a MEDIAS: están en el catre, no de campaña, pero tampoco
 * salen gratis (por eso convalecer con el granero vacío escuece).
 * @returns {number} comida por minuto
 */
export function consumoComida () {
  const e = ej()
  let total = 0
  const racion = (tipo, n, factor) => {
    const u = UNIDADES[tipo]
    if (!u || u.espacio <= 0) return 0      // los aldeanos comen en villagers, no aquí
    let valor = 0
    for (const [r, peso] of Object.entries(PESO_MANUTENCION)) valor += (u.coste[r] || 0) * peso
    return Math.max(0.05, valor / DIVISOR_MANUTENCION) * n * factor
  }
  for (const [tipo, n] of Object.entries(e.tropas)) total += racion(tipo, n, 1)
  for (const [tipo, n] of Object.entries(e.heridos)) total += racion(tipo, n, 0.5)
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
 * Resta las bajas de una batalla. De cada soldado que cae en el campo salen
 * TRES caminos, y solo el último es definitivo:
 *
 *   1. El monasterio lo recoge y lo devuelve a filas en el acto (`curadas`),
 *      redondeando hacia arriba: que se note que pagaste por él.
 *   2. De lo que queda, la mayor parte vuelve MALHERIDA (`heridos`): sale del
 *      ejército útil, entra en la enfermería del cuartel y se recupera sola con
 *      el tiempo. Ganando se recoge mejor el campo (68 %) que perdiendo (52 %).
 *   3. Solo el resto muere de verdad (`perdidas`). Sin esa pizca de muerte real,
 *      atacar no tendría ningún riesgo y el juego se quedaría sin tensión.
 *
 * @param {Record<string,number>} bajas p.ej. { lancero: 3 }
 * @param {{victoria?:boolean, fraccionHeridos?:number}} [opciones]
 * @returns {{perdidas:object, curadas:object, heridos:object, muertos:number, enfermeria:number}}
 */
export function perderTropas (bajas = {}, opciones = {}) {
  const e = ej()
  const cura = curacionMonasterio()
  const fraccion = Math.max(0, Math.min(0.9, Number.isFinite(opciones.fraccionHeridos)
    ? opciones.fraccionHeridos
    : (opciones.victoria === false ? HERIDOS_DERROTA : HERIDOS_VICTORIA)))
  const perdidas = {}
  const curadas = {}
  const enfermeria = {}
  for (const [tipo, cant] of Object.entries(bajas)) {
    const pedidas = Math.max(0, Math.floor(cant || 0))
    if (!pedidas || !UNIDADES[tipo]) continue
    const caidas = Math.min(pedidas, e.tropas[tipo] || 0)
    if (!caidas) continue
    const salvadas = cura > 0 ? Math.min(caidas, Math.ceil(caidas * cura)) : 0
    const resto = caidas - salvadas
    const heridas = Math.round(resto * fraccion)
    const muertas = resto - heridas
    const fuera = muertas + heridas
    if (fuera > 0) {
      e.tropas[tipo] -= fuera
      if (e.tropas[tipo] <= 0) delete e.tropas[tipo]
      descontarDeFuera(tipo, fuera)
    }
    if (muertas > 0) perdidas[tipo] = muertas
    if (heridas > 0) enfermeria[tipo] = heridas
    if (salvadas > 0) curadas[tipo] = salvadas
  }
  if (Object.keys(curadas).length) {
    const n = Object.values(curadas).reduce((a, b) => a + b, 0)
    events.emit(EV.UI_TOAST, { texto: `⛪ El monasterio ha salvado a ${n} de los tuyos`, tipo: 'bien' })
  }
  const aCamilla = apuntarHeridos(enfermeria)
  return {
    perdidas,
    curadas,
    heridos: enfermeria,
    muertos: Object.values(perdidas).reduce((a, b) => a + b, 0),
    enfermeria: aCamilla
  }
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

// ------------------------------------------------------ heridos (enfermería)
/**
 * LOS HERIDOS. Antes, una baja era una tropa borrada: había que volver a pagarla
 * y a esperar la cola entera. Eso convertía cada asalto en un castigo y la gente
 * dejaba de atacar. Ahora la mayor parte de los que caen en el campo vuelven a
 * casa MALHERIDOS: siguen siendo tuyos, ocupan hueco de ejército y comen (a
 * medias), pero no pueden pelear hasta que se recuperan en el cuartel.
 *
 * El coste de atacar deja de ser recursos y pasa a ser TIEMPO: tu hueste está
 * fuera de combate un rato. Quien tenga prisa paga comida y oro (el cirujano) o
 * gemas (y salen al instante). El monasterio acorta la convalecencia.
 */

/** De cada baja, cuánta se salva como herida. Ganando se recoge el campo; perdiendo, no. */
const HERIDOS_VICTORIA = 0.68
const HERIDOS_DERROTA = 0.52

/**
 * Segundos de convalecencia = tiempo de entrenamiento × esto, más un suelo fijo.
 * Se cura EN PARALELO (todos a la vez), así que aun con el factor por encima de 1
 * levantar la hueste sigue siendo bastante más rápido que reentrenarla en la cola
 * del cuartel, que va de uno en uno. Ese es el trato: el asalto ya no te cuesta
 * recursos, te cuesta quedarte sin ejército un rato.
 */
const CURA_POR_SEGUNDO_ENTRENO = 1.1
const CURA_SUELO = 45
const CURA_TOPE = 4 * 3600            // por muy grande que sea la hueste, un día no
/** Lo que cobra el cirujano por sacarlos ya: fracción del coste de reentrenarlos. */
const FRACCION_COSTE_CURA = 0.45

const sumaDe = (obj) => Object.values(obj || {}).reduce((a, b) => a + (b || 0), 0)

/** Cuánto acortan la convalecencia el cuartel y el monasterio. */
function rapidezCuracion () {
  const cuartel = nivelDe('cuartel')
  const monasterio = curacionMonasterio()      // 0,15 … 0,40
  return 1 + cuartel * 0.06 + monasterio * 2.2
}

/** Segundos que tardan en levantarse esos heridos. */
function segundosDe (heridos) {
  let bruto = 0
  for (const [tipo, n] of Object.entries(heridos || {})) {
    const u = UNIDADES[tipo]
    if (!u || !n) continue
    bruto += u.tiempo * n * CURA_POR_SEGUNDO_ENTRENO
  }
  if (bruto <= 0) return 0
  return Math.min(CURA_TOPE, Math.round((CURA_SUELO + bruto) / rapidezCuracion()))
}

/**
 * Mete heridos en la enfermería. El reloj NO se reinicia: los nuevos ALARGAN la
 * convalecencia, así que atacar dos veces seguidas con la hueste tocada se paga
 * en espera, que es justo el castigo que queremos (y no más muertos).
 */
function apuntarHeridos (heridos) {
  const e = ej()
  const cuantos = sumaDe(heridos)
  if (!cuantos) return 0
  const ahora = Date.now()
  const suma = segundosDe(heridos) * 1000
  const habia = sumaDe(e.heridos) > 0
  for (const [tipo, n] of Object.entries(heridos)) {
    if (!n) continue
    e.heridos[tipo] = (e.heridos[tipo] || 0) + n
  }
  if (!habia || !(e.curacion.fin > ahora)) e.curacion = { inicio: ahora, fin: ahora + suma }
  else e.curacion.fin += suma
  events.emit(EV.TROPAS_HERIDAS, { tropas: { ...heridos }, total: cuantos, fin: e.curacion.fin })
  return cuantos
}

/** Los saca de la enfermería y los devuelve a filas. */
function levantarHeridos (motivo = 'tiempo') {
  const e = ej()
  const vueltos = { ...e.heridos }
  const total = sumaDe(vueltos)
  if (!total) return 0
  for (const [tipo, n] of Object.entries(vueltos)) e.tropas[tipo] = (e.tropas[tipo] || 0) + n
  e.heridos = {}
  e.curacion = { inicio: 0, fin: 0 }
  events.emit(EV.TROPAS_CURADAS, { tropas: vueltos, total, motivo })
  events.emit(EV.UI_TOAST, {
    texto: `🩹 ${total === 1 ? 'Un herido vuelve' : `${total} heridos vuelven`} a filas`, tipo: 'bien'
  })
  return total
}

/** Va por reloj real, así que la enfermería también avanza con la app cerrada. */
function recuperarHeridos () {
  const e = ej()
  if (!sumaDe(e.heridos)) return
  if (Date.now() >= (e.curacion.fin || 0)) levantarHeridos('tiempo')
}

/** @returns {Record<string,number>} copia de los heridos, para pintarlos. */
export function heridos () {
  return { ...ej().heridos }
}

/** Lo que cuesta al cirujano sacarlos ya: comida y oro, nunca madera ni piedra. */
function costeCuracion () {
  const e = ej()
  const coste = { comida: 0, oro: 0 }
  for (const [tipo, n] of Object.entries(e.heridos)) {
    const u = UNIDADES[tipo]
    if (!u || !n) continue
    coste.comida += Math.ceil((u.coste.comida || 0) * n * FRACCION_COSTE_CURA)
    coste.oro += Math.ceil((u.coste.oro || 0) * n * FRACCION_COSTE_CURA)
  }
  if (!coste.comida) delete coste.comida
  if (!coste.oro) delete coste.oro
  return coste
}

/**
 * Estado de la enfermería para la interfaz.
 * @returns {{heridos:number, restante:number, total:number, fin:number, gemas:number, coste:object, detalle:object}}
 */
export function tiempoRecuperacion () {
  const e = ej()
  const cuantos = sumaDe(e.heridos)
  if (!cuantos) return { heridos: 0, restante: 0, total: 0, fin: 0, gemas: 0, coste: {}, detalle: {} }
  const restante = Math.max(0, Math.ceil((e.curacion.fin - Date.now()) / 1000))
  const total = Math.max(restante, Math.ceil((e.curacion.fin - e.curacion.inicio) / 1000))
  return {
    heridos: cuantos,
    restante,
    total,
    fin: e.curacion.fin,
    gemas: Math.max(1, Math.ceil(restante / CONFIG.SEG_POR_GEMA)),
    coste: costeCuracion(),
    detalle: { ...e.heridos }
  }
}

/**
 * Saca a TODOS los heridos ya mismo.
 * @param {'gemas'|'recursos'} [coste] con qué se paga la prisa
 * @returns {{ok:boolean, motivo:string, curados?:number, gemas?:number, coste?:object}}
 */
export function curarTodo (coste = 'gemas') {
  const info = tiempoRecuperacion()
  if (!info.heridos) return { ok: false, motivo: 'No tienes heridos' }
  if (info.restante <= 0) return { ok: true, motivo: '', curados: levantarHeridos('tiempo') }

  if (coste === 'recursos' || coste === 'comida' || coste === 'oro') {
    const precio = info.coste
    if (!puedePagar(precio)) {
      events.emit(EV.UI_TOAST, { texto: 'El cirujano no trabaja gratis: te faltan recursos', tipo: 'mal' })
      events.emit(EV.RESOURCE_DENIED, { falta: faltaPara(precio), motivo: 'curar heridos' })
      return { ok: false, motivo: 'No tienes recursos', coste: precio }
    }
    pagar(precio, 'curar heridos')
    return { ok: true, motivo: '', curados: levantarHeridos('recursos'), coste: precio }
  }

  const precio = info.gemas
  if (!gemas(-precio, 'curar heridos')) {
    events.emit(EV.UI_TOAST, { texto: `Te faltan gemas: cuesta ${precio} 💎`, tipo: 'mal' })
    return { ok: false, motivo: `Necesitas ${precio} gemas`, gemas: precio }
  }
  events.emit(EV.SFX, { nombre: 'gema' })
  return { ok: true, motivo: '', curados: levantarHeridos('gemas'), gemas: precio }
}

// ------------------------------------------- punto de reunión (el estandarte)
/**
 * EL ESTANDARTE DE BATALLA. Hasta ahora la tropa la plantaba el render con un
 * salto a ojo desde el cuartel (`centro.z + alto/2 + 1,4`) sin mirar si allí
 * había algo: en cuanto tenías una casa o una granja pegada al cuartel, o no
 * tenías cuartel y caía sobre el ayuntamiento, la formación aparecía DENTRO del
 * edificio y encima de la puerta por la que salen los aldeanos. De ahí lo de
 * "se buguean delante del ayuntamiento".
 *
 * Ahora el punto de reunión es ESTADO (`ejercito.reunion`), lo valida la
 * simulación contra el tablero real y el jugador lo mueve con el dedo. El render
 * solo pinta lo que le digamos por `EV.REUNION_CAMBIADA` y `formacionReunion()`.
 */

/** Edificios que sí pisan suelo (la puerta se cruza y el pozo es adorno). */
function pisaSuelo (b) {
  const d = EDIFICIOS[b.tipo]
  if (!d) return true
  if (d.categoria === 'decoracion') return false
  return d.bloquea !== false
}

/**
 * MAPA DE SUELO, cacheado. Se consulta muchísimo (colocar el estandarte y toda
 * la formación), y recorrer los cientos de edificios de la aldea por cada
 * casilla se come el tick. Igual que hace sim/villagers.js, se guarda una
 * rejilla y solo se rehace cuando la aldea cambia:
 *   0 = libre · 1 = edificio · 2 = anillo pegado a un edificio (puerta de aldeanos)
 * El anillo del edificio ANCLA no se marca: ahí es justo donde debe acampar la
 * tropa, pegada a su cuartel.
 */
let suelo = null
let sueloSucio = true
let sueloEdificios = -1
let sueloAncla = null

function refrescarSuelo () {
  const G = CONFIG.GRID
  if (!suelo || suelo.length !== G * G) suelo = new Uint8Array(G * G)
  else suelo.fill(0)
  const bs = game.state.buildings || []
  sueloAncla = anclaDeReunion()?.id || null
  for (const b of bs) {
    if (!pisaSuelo(b)) continue
    const t = tamañoDe(b)
    for (let z = b.z; z < b.z + t.alto; z++) {
      for (let x = b.x; x < b.x + t.ancho; x++) if (dentro(x, z)) suelo[z * G + x] = 1
    }
  }
  for (const b of bs) {
    if (!pisaSuelo(b) || b.id === sueloAncla) continue
    const t = tamañoDe(b)
    for (let z = b.z - 1; z <= b.z + t.alto; z++) {
      for (let x = b.x - 1; x <= b.x + t.ancho; x++) {
        if (!dentro(x, z)) continue
        const i = z * G + x
        if (!suelo[i]) suelo[i] = 2
      }
    }
  }
  sueloEdificios = bs.length
  sueloSucio = false
}

/**
 * El mapa se rehace si alguien lo marcó sucio o si cambió el número de
 * edificios. Las dos comprobaciones son O(1) a propósito: esto se llama por
 * cada casilla que se mira, y ahí no cabe recorrer la aldea.
 */
function sueloAlDia () {
  if (sueloSucio || sueloEdificios !== (game.state.buildings || []).length) refrescarSuelo()
}
/** Cualquier cambio en la aldea (o de partida) invalida el mapa. */
function ensuciarSuelo () { sueloSucio = true }

/** ¿Hay un edificio en esa casilla? */
function casillaOcupada (x, z) {
  const cx = Math.round(x); const cz = Math.round(z)
  if (!dentro(cx, cz)) return true
  sueloAlDia()
  return suelo[cz * CONFIG.GRID + cx] === 1
}

/**
 * Casilla buena para plantar a un soldado. En modo estricto también deja libre
 * el anillo pegado a los edificios: es por donde entran y salen los aldeanos
 * (`puertaDe()` en sim/villagers.js elige justo esa casilla), y si la tropa se
 * planta ahí se quedan los dos amontonados en la misma baldosa.
 */
function casillaParaTropa (x, z, estricto = true) {
  const cx = Math.round(x); const cz = Math.round(z)
  if (!dentro(cx, cz)) return false
  // El valle es más grande que tu reino: la tropa no acampa en parcela ajena.
  if (!esTerritorio(game.state, cx, cz)) return false
  sueloAlDia()
  const v = suelo[cz * CONFIG.GRID + cx]
  if (v === 1) return false
  return !(estricto && v === 2)
}

/** La casilla libre más cercana a un punto, en anillos. Nunca devuelve nada fuera. */
function libreCerca (x, z, estricto = true) {
  const cx = Math.round(x); const cz = Math.round(z)
  if (casillaParaTropa(cx, cz, estricto)) return { x: cx, z: cz }
  for (let r = 1; r <= 8; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        if (casillaParaTropa(cx + dx, cz + dz, estricto)) return { x: cx + dx, z: cz + dz }
      }
    }
  }
  // Aldea tapiada: al menos que no sea un edificio ni esté fuera del tablero.
  if (estricto) return libreCerca(x, z, false)
  const medio = Math.floor((CONFIG.GRID - 1) / 2)
  return { x: Math.min(CONFIG.GRID - 2, Math.max(1, cx)), z: Math.min(CONFIG.GRID - 2, Math.max(1, cz)) }
}

/** El edificio al que se pega la tropa por defecto: cuartel, si no otro militar, si no el ayuntamiento. */
function anclaDeReunion () {
  const bs = game.state.buildings || []
  return bs.find(b => b.tipo === 'cuartel' && (b.nivel || 0) > 0) ||
    bs.find(b => EDIFICIOS_HUECO.includes(b.tipo) && (b.nivel || 0) > 0) ||
    bs.find(b => b.tipo === 'cuartel') ||
    bs.find(b => b.tipo === 'ayuntamiento') || null
}

/** Punto de reunión por defecto: a DOS casillas del edificio, fuera de su puerta. */
function reunionPorDefecto () {
  const medio = Math.floor((CONFIG.GRID - 1) / 2)
  const ancla = anclaDeReunion()
  if (!ancla) return libreCerca(medio, medio + 3)
  const t = tamañoDe(ancla)
  const c = centroDe(ancla)
  // Se prueban los cuatro costados y gana el que mire hacia fuera de la aldea:
  // así la formación no se planta en mitad de la plaza, por donde pasa todo el mundo.
  const lados = [
    { x: c.x, z: ancla.z + t.alto + 1 },
    { x: c.x, z: ancla.z - 2 },
    { x: ancla.x + t.ancho + 1, z: c.z },
    { x: ancla.x - 2, z: c.z }
  ]
  let mejor = null; let mejorD = -Infinity
  for (const p of lados) {
    const q = { x: Math.round(p.x), z: Math.round(p.z) }
    if (!casillaParaTropa(q.x, q.z, true)) continue
    const d = dist(q.x, q.z, medio, medio)
    if (d > mejorD) { mejorD = d; mejor = q }
  }
  // Aldea apretada: se busca el hueco bueno más cercano al costado de salida.
  return mejor || libreCerca(c.x, ancla.z + t.alto + 1)
}

/** @returns {{x:number, z:number}} dónde está hoy el estandarte (siempre válido). */
export function puntoReunion () {
  const e = ej()
  const r = e.reunion
  if (!r || !Number.isFinite(r.x) || !Number.isFinite(r.z) || !casillaParaTropa(r.x, r.z, false)) {
    const nuevo = r && Number.isFinite(r.x)
      ? libreCerca(r.x, r.z)
      : reunionPorDefecto()
    e.reunion = { x: nuevo.x, z: nuevo.z, fijada: !!(r && r.fijada), ancla: anclaDeReunion()?.id || null }
  }
  return { x: e.reunion.x, z: e.reunion.z }
}

/**
 * Mueve el estandarte. Si la casilla pedida no sirve (edificio, borde, puerta de
 * aldeanos), se planta en la más cercana que sí: el jugador no se queda sin
 * saber dónde ha caído su tropa.
 * @returns {{ok:boolean, motivo:string, x:number, z:number, ajustado:boolean}}
 */
export function fijarReunion (x, z) {
  const e = ej()
  const px = Math.round(Number(x)); const pz = Math.round(Number(z))
  if (!Number.isFinite(px) || !Number.isFinite(pz) || !dentro(px, pz)) {
    return { ok: false, motivo: 'Esa casilla no está en la aldea', x: e.reunion?.x ?? 0, z: e.reunion?.z ?? 0, ajustado: false }
  }
  const destino = casillaParaTropa(px, pz, true) ? { x: px, z: pz } : libreCerca(px, pz)
  const ajustado = destino.x !== px || destino.z !== pz
  const antes = e.reunion || {}
  // A partir de aquí manda el jugador: el estandarte deja de seguir al cuartel.
  e.reunion = { x: destino.x, z: destino.z, fijada: true, ancla: anclaDeReunion()?.id || null }
  if (antes.x !== destino.x || antes.z !== destino.z) {
    events.emit(EV.REUNION_CAMBIADA, { x: destino.x, z: destino.z, ajustado })
    events.emit(EV.SFX, { nombre: 'entrenar' })
  }
  events.emit(EV.UI_TOAST, {
    texto: ajustado ? '🚩 Ahí no cabe la tropa: el estandarte se planta al lado' : '🚩 La tropa forma en el nuevo estandarte',
    tipo: ajustado ? 'info' : 'bien'
  })
  return { ok: true, motivo: '', x: destino.x, z: destino.z, ajustado }
}

/** Orden de formación: infantería delante, asedio al fondo. */
const ORDEN_FORMACION = ['lancero', 'espadachin', 'arquero', 'ballestero', 'monje', 'explorador', 'jinete', 'caballero', 'ariete', 'catapulta']

/**
 * Dónde se pone cada soldado. Devuelve casillas ENTERAS y libres: filas
 * ordenadas detrás del estandarte y, si no caben, más filas a los lados. Nunca
 * mete a nadie dentro de un edificio ni fuera del tablero.
 *
 * @param {Record<string,number>} [tropas] por defecto, la tropa que está en casa
 * @param {{tope?:number}} [opciones] tope de figuras (el render pinta menos en móvil flojo)
 * @returns {{reunion:{x,z}, estandarte:{x,z}, porFila:number, filas:number,
 *            puestos:Array<{tipo:string,x:number,z:number,fila:number,col:number}>, sinSitio:number}}
 */
export function formacionReunion (tropas, opciones = {}) {
  const p = puntoReunion()
  const lista = tropas || tropasDisponibles()
  const tope = Math.max(1, opciones.tope || 200)

  const cola = []
  const tipos = [...ORDEN_FORMACION, ...Object.keys(lista).filter(t => !ORDEN_FORMACION.includes(t))]
  for (const tipo of tipos) {
    const u = UNIDADES[tipo]
    if (!u || u.espacio <= 0) continue            // los aldeanos no forman
    const n = Math.max(0, Math.floor(lista[tipo] || 0))
    for (let i = 0; i < n && cola.length < tope; i++) cola.push(tipo)
  }
  const vacio = { reunion: p, estandarte: { ...p }, porFila: 0, filas: 0, puestos: [], sinSitio: 0 }
  if (!cola.length) return vacio

  // la formación crece hacia donde hay tablero, no siempre al sur
  const medio = (CONFIG.GRID - 1) / 2
  const dir = p.z <= medio ? 1 : -1
  const porFila = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(cola.length * 1.4))))

  const puestos = []
  const usadas = new Set()
  const marcar = (x, z) => usadas.add(z * CONFIG.GRID + x)
  const librePara = (x, z, estricto) => !usadas.has(z * CONFIG.GRID + x) && casillaParaTropa(x, z, estricto)

  let i = 0
  // Dos pasadas: primero respetando el anillo de puertas de los aldeanos; si la
  // aldea está tan apretada que no caben, se relaja antes que dejarlos flotando.
  for (const estricto of [true, false]) {
    for (let fila = 0; fila < CONFIG.GRID && i < cola.length; fila++) {
      const z = p.z + dir * (fila + 1)
      if (!dentro(p.x, z)) continue
      for (let col = 0; col < porFila && i < cola.length; col++) {
        const x = Math.round(p.x + (col - (porFila - 1) / 2))
        if (!librePara(x, z, estricto)) continue
        marcar(x, z)
        puestos.push({ tipo: cola[i], x, z, fila, col })
        i++
      }
    }
    if (i >= cola.length) break
    // ¿sigue sobrando gente? se abre en anillos alrededor del estandarte
    for (let r = 1; r <= 16 && i < cola.length; r++) {
      for (let dz = -r; dz <= r && i < cola.length; dz++) {
        for (let dx = -r; dx <= r && i < cola.length; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
          const x = p.x + dx; const z = p.z + dz
          if (!dentro(x, z) || !librePara(x, z, estricto)) continue
          marcar(x, z)
          puestos.push({ tipo: cola[i], x, z, fila: r, col: puestos.length })
          i++
        }
      }
    }
    if (i >= cola.length) break
  }

  const filas = puestos.reduce((m, q) => Math.max(m, q.fila + 1), 0)
  return { reunion: p, estandarte: { ...p }, porFila, filas, puestos, sinSitio: cola.length - i }
}

// -------------------------------------------------------------------- init
/**
 * Recoloca el estandarte si hace falta y avisa al render. Se llama cuando la
 * aldea cambia: si te construyen encima del punto de reunión (o levantas por fin
 * el cuartel), la tropa no puede quedarse plantada dentro de un edificio.
 */
function revisarReunion () {
  const e = ej()
  const antes = e.reunion ? { x: e.reunion.x, z: e.reunion.z } : null
  const idAncla = anclaDeReunion()?.id || null
  // El automático sigue al cuartel, pero SOLO se recalcula cuando cambia el
  // edificio al que sigue (levantas el cuartel por fin, lo tiras…). Si no, el
  // estandarte se quedaría bailando cada vez que pones una casa, y no hay nada
  // peor que ir a buscar tu tropa y que haya cambiado de sitio sin avisar.
  // El que ha puesto el jugador no se mueve nunca: solo lo corrige
  // `puntoReunion()` si le construyen encima.
  if (e.reunion && !e.reunion.fijada && e.reunion.ancla !== idAncla) {
    const q = reunionPorDefecto()
    e.reunion = { x: q.x, z: q.z, fijada: false, ancla: idAncla }
  }
  const ahora = puntoReunion()
  if (!antes || antes.x !== ahora.x || antes.z !== ahora.z) {
    events.emit(EV.REUNION_CAMBIADA, { x: ahora.x, z: ahora.z, ajustado: true })
  }
}

export function init () {
  ej()
  puntoReunion()          // el estandarte existe desde el minuto uno y siempre en sitio válido
  // Al cargar partida, cola, enfermería y manutención se ponen al día solas: las
  // tres miran la diferencia real con Date.now(), con el tope offline de CONFIG.
  events.on(EV.STATE_LOADED, () => { ensuciarSuelo(); ej(); procesarCola(); recuperarHeridos(); revisarReunion() })
  events.on(EV.TICK, () => { procesarCola(); recuperarHeridos(); comer() })
  // Tocar la aldea invalida el mapa de suelo y puede mover el estandarte.
  for (const ev of [EV.BUILD_PLACED, EV.BUILD_COMPLETED, EV.BUILD_UPGRADED, EV.BUILD_DEMOLISHED, EV.TERRITORIO_DESBLOQUEADO]) {
    events.on(ev, () => { ensuciarSuelo(); revisarReunion() })
  }

  // El banco lleva la contabilidad del rato con la app cerrada y nos va cobrando
  // tramo a tramo, entre cosecha y cosecha. Marcamos el reloj en cada tramo para
  // que `comer()` no vuelva a cobrar lo mismo en el primer tick.
  registrarConsumoOffline((segundos) => {
    ej().ultimoConsumo = Date.now()
    cobrarManutencion(segundos)
  })

  procesarCola()
}
