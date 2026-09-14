import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { def } from '../data/buildings.js'

/**
 * LA CUADRILLA DE REPARACIÓN.
 *
 * Por qué existe: si te arrasan la aldea y te quedan las granjas en ruinas, te
 * quedas sin comida; sin comida no puedes reparar (reparar cuesta un tercio del
 * edificio) y sin reparar no vuelve la comida. Partida muerta sin salida, y le
 * pasó al dueño jugando: «al destruirme los campos de cultivo no tengo cómo
 * avanzar y no puedo hacer mucho más».
 *
 * La solución no es quitar el castigo, es ponerle un plazo: los edificios en
 * ruinas **se levantan solos, gratis**, uno detrás de otro. Duele (pierdes horas
 * de producción y te deja a los pies de los caballos mientras dura), pero
 * siempre se sale. Quien tenga prisa, que pague la reparación al instante con
 * `reparar()` de sim/buildings.js, que sigue estando.
 *
 * Orden de prioridad: primero lo que da de comer, porque es lo que te saca del
 * agujero; después lo que produce; al final lo demás.
 */

/** Minutos que tarda la cuadrilla en levantar un edificio, según su nivel. */
const MIN_BASE = 3
const MIN_POR_NIVEL = 1.5
/** Tope: por muy alto que sea, nadie se queda una tarde entera sin su granja. */
const MIN_MAX = 25

/** Lo primero, el pan. Cuanto más bajo el número, antes le toca. */
const PRIORIDAD = {
  granja: 0, molino: 1, granero: 1,
  serreria: 2, cantera: 2, mina_oro: 2, almacen: 3,
  ayuntamiento: 4, casa: 5
}
const prioridadDe = (b) => PRIORIDAD[b.tipo] ?? 6

const MIN = 60 * 1000

function enRuinas () {
  return game.state.buildings.filter(b => b.arruinado && !b.enObra)
}

/** El edificio que toca levantar ahora: el más urgente y, a igualdad, el más barato. */
function siguiente () {
  const lista = enRuinas()
  if (!lista.length) return null
  lista.sort((a, b) => prioridadDe(a) - prioridadDe(b) || (a.nivel || 1) - (b.nivel || 1))
  return lista[0]
}

function minutosDe (b) {
  return Math.min(MIN_MAX, MIN_BASE + (b.nivel || 1) * MIN_POR_NIVEL)
}

/** Estado de la cuadrilla, en el guardado: sobrevive a cerrar la app. */
function faena () {
  const s = game.state
  if (!s.reparacion || typeof s.reparacion !== 'object') s.reparacion = { id: null, fin: 0 }
  return s.reparacion
}

function empezar (b) {
  const f = faena()
  f.id = b.id
  f.fin = Date.now() + minutosDe(b) * MIN
  events.emit(EV.UI_TOAST, {
    texto: `La cuadrilla levanta ${def(b.tipo)?.nombre || 'un edificio'}: ${minutosDe(b)} min`,
    tipo: 'info'
  })
}

function terminar (b) {
  b.arruinado = false
  b.hp = b.hpMax || b.hp || 1
  const f = faena()
  f.id = null
  f.fin = 0
  events.emit(EV.BUILD_COMPLETED, { building: b, reparado: true })
  events.emit(EV.UI_TOAST, { texto: `${def(b.tipo)?.nombre || 'Edificio'} reparado y en pie`, tipo: 'bien' })
  events.emit(EV.SFX, { nombre: 'obra_lista' })
}

/** Cuánto le queda a la cuadrilla, para que la interfaz lo pueda enseñar. */
export function faenaActual () {
  const f = faena()
  if (!f.id) return null
  const b = game.state.buildings.find(x => x.id === f.id)
  if (!b) return null
  return { edificio: b, restante: Math.max(0, (f.fin - Date.now()) / 1000), enRuinas: enRuinas().length }
}

export function init () {
  const paso = () => {
    const f = faena()
    const ahora = Date.now()

    if (f.id) {
      const b = game.state.buildings.find(x => x.id === f.id)
      // el edificio ya no existe o lo repararon pagando: la cuadrilla pasa al siguiente
      if (!b || !b.arruinado) { f.id = null; f.fin = 0 }
      else if (ahora >= f.fin) terminar(b)
      return
    }

    const b = siguiente()
    if (b) empezar(b)
  }

  // Se compara con el reloj, no se acumula `dt`: así la cuadrilla también
  // trabaja mientras la app está cerrada, como las obras y el entrenamiento.
  events.on(EV.TICK, paso)
  events.on(EV.STATE_LOADED, paso)
  events.on(EV.DEFENSE_RESOLVED, paso)
  paso()
}
