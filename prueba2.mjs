import { simularDefensa, reproducir, calcularDefensa, lanzarAsalto, init } from './src/sim/combat.js'
import { events, EV } from './src/core/events.js'
import { game } from './src/core/state.js'

let n = 0
const bs = []
const add = (tipo, x, z, nivel = 1) => bs.push({ id: `b${n++}`, tipo, nivel, x, z, hp: undefined })
add('ayuntamiento', 15, 15, 3); add('serreria', 11, 11, 2); add('granja', 11, 20, 2)
add('torre_vigia', 13, 13, 2); add('mina_oro', 20, 11, 2)
for (let x = 9; x <= 24; x++) { add('muralla', x, 9); if (x < 16 || x > 17) add('muralla', x, 24) }
for (let z = 10; z <= 23; z++) { add('muralla', 9, z); add('muralla', 24, z) }
add('puerta', 16, 24)

game.state.buildings = bs
game.state.recursos = { madera: 800, piedra: 600, comida: 700, oro: 250 }
game.state.ejercito = { tropas: { lancero: 8, jinete: 2 }, cola: [] }

const vistos = []
for (const k of ['DEFENSE_RESOLVED', 'BUILDINGS_DAMAGED', 'SHIELD_STARTED', 'UI_TOAST', 'RESOURCES_CHANGED', 'RAID_STARTED', 'RAID_RESOLVED', 'DEFENSE_SCORED'])
  events.on(EV[k], (p) => vistos.push(k))

await init()

// --- DEFENSA: nos ataca una hueste seria
const d = simularDefensa({ atacante: { nombre: 'Los Cuervos', lado: 'norte' }, tropasEnemigas: { espadachin: 12, ariete: 4, jinete: 4 }, semilla: 99 })
console.log('DEFENSA:', d.victoria ? 'AGUANTA' : 'cae', d.estrellas + '★', d.porcentajeDestruido + '%', '| perdidas', JSON.stringify(d.perdidas), '| edificios tocados', d.daños.length)
console.log('escudo:', game.state.escudo ? new Date(game.state.escudo.hasta).toISOString().slice(11, 16) + ' (' + game.state.escudo.horas + ' h)' : 'sin escudo')
console.log('recursos tras el saqueo:', JSON.stringify(game.state.recursos))
// segundo ataque con escudo puesto: debe rebotar
console.log('con escudo:', simularDefensa({ atacante: { nombre: 'Otros' }, tropasEnemigas: { espadachin: 9 } }) === null ? 'rebotado OK' : '*** entró')

// --- ASALTO por el bus de eventos
game.state.escudo = null
const base = { id: 'enemiga', nombre: 'Villaparda', nivel: 2, buildings: bs.slice(0, 5), recursos: { madera: 500, piedra: 400, comida: 400, oro: 200 } }
events.emit(EV.RAID_REQUESTED, { base, tropas: { lancero: 8, jinete: 2 }, ladoEntrada: 'oeste', semilla: 3 })
console.log('tropas tras el asalto:', JSON.stringify(game.state.ejercito.tropas), '| madera', game.state.recursos.madera)
console.log('eventos emitidos:', [...new Set(vistos)].join(', '))

// --- REPRODUCIR en tiempo real
const r = { sucesos: [{ t: 0, tipo: 'inicio', texto: 'a' }, { t: 0.2, tipo: 'x', texto: 'b' }, { t: 90, tipo: 'fin', texto: 'c' }] }
let leidos = 0
const ctl = reproducir(r, () => leidos++, { velocidad: 4, emitirBus: false, alFinal: () => console.log('reproducción terminada, sucesos leídos:', leidos) })
setTimeout(() => { console.log('a los 300 ms van', leidos, 'de 3 -> saltamos'); ctl.saltar() }, 300)
