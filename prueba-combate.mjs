import { simularAsalto, botinDe, calcularDefensa, reproducir } from './src/sim/combat.js'
import { game } from './src/core/state.js'

// --- base de mentira: ayuntamiento + productivos, dos torres y un cerco de muralla con puerta
let n = 0
const id = () => `b${n++}`
const bs = []
const add = (tipo, x, z, nivel = 1) => bs.push({ id: id(), tipo, nivel, x, z })
add('ayuntamiento', 15, 15, 3)
add('serreria', 11, 11, 2); add('cantera', 20, 11, 2); add('granja', 11, 20, 2); add('granero', 20, 19, 2)
add('torre_vigia', 13, 13, 3); add('torre_vigia', 19, 19, 3)
// cerco 9..24 con hueco para la puerta en el sur
for (let x = 9; x <= 24; x++) {
  add('muralla', x, 9)
  if (x < 16 || x > 17) add('muralla', x, 24)
}
for (let z = 10; z <= 23; z++) { add('muralla', 9, z); add('muralla', 24, z) }
add('puerta', 16, 24)
const base = { id: 'base-prueba', nombre: 'Villaparda', nivel: 3, buildings: bs, recursos: { madera: 900, piedra: 700, comida: 800, oro: 300 } }

const tropas = { lancero: 10, ariete: 3 }
const a = simularAsalto({ base, tropas, ladoEntrada: 'sur', semilla: 1234 })
const b = simularAsalto({ base, tropas, ladoEntrada: 'sur', semilla: 1234 })
const c = simularAsalto({ base, tropas, ladoEntrada: 'norte', semilla: 1234 })
console.log('A:', a.victoria, a.estrellas + '★', a.porcentajeDestruido + '%', a.duracion + 's', 'bajas', JSON.stringify(a.bajas), 'botin', JSON.stringify(a.botin), 'sucesos', a.sucesos.length)
console.log('REPETIBLE:', JSON.stringify(a) === JSON.stringify(b) ? 'SÍ' : 'NO ***')
console.log('otro lado distinto:', c.porcentajeDestruido !== a.porcentajeDestruido || c.duracion !== a.duracion ? 'sí' : 'igual')

// ejército pequeño contra base fuerte
const fuerte = { ...base, buildings: bs.map(x => ({ ...x, nivel: x.tipo.startsWith('torre') || x.tipo === 'muralla' ? 6 : 5 })) }
const d = simularAsalto({ base: fuerte, tropas: { lancero: 3 }, ladoEntrada: 'sur', semilla: 77 })
console.log('PEQUEÑO vs FUERTE:', d.victoria ? 'GANA ***' : 'pierde', d.estrellas + '★', d.porcentajeDestruido + '%', 'bajas', JSON.stringify(d.bajas))
// ejército grande
const e = simularAsalto({ base, tropas: { lancero: 20, ariete: 6, arquero: 8 }, ladoEntrada: 'sur', semilla: 5 })
console.log('GRANDE vs base:', e.victoria ? 'gana' : 'pierde ***', e.estrellas + '★', e.porcentajeDestruido + '%', e.duracion + 's')
// sin muralla la misma base debe caer más
const sinMuro = { ...base, buildings: bs.filter(x => x.tipo !== 'muralla' && x.tipo !== 'puerta') }
const f = simularAsalto({ base: sinMuro, tropas, ladoEntrada: 'sur', semilla: 1234 })
console.log('MURALLAS importan:', a.porcentajeDestruido, 'vs sin muro', f.porcentajeDestruido, f.porcentajeDestruido > a.porcentajeDestruido ? 'OK' : '*** revisar')

// rendimiento
const t0 = performance.now()
for (let i = 0; i < 20; i++) simularAsalto({ base, tropas, ladoEntrada: 'sur', semilla: i })
console.log('ms/batalla:', ((performance.now() - t0) / 20).toFixed(1))

console.log('botin 0%/50%/100%:', JSON.stringify(botinDe(base, 0)), JSON.stringify(botinDe(base, 50)), JSON.stringify(botinDe(base, 100)))
console.log('muestra crónica:'); a.sucesos.slice(0, 6).forEach(s => console.log('  ', s.t + 's', s.tipo, '-', s.texto))
a.sucesos.slice(-2).forEach(s => console.log('  ', s.t + 's', s.tipo, '-', s.texto))

// defensa de tu aldea
game.state.buildings = bs.map(x => ({ ...x, hp: undefined }))
const def = calcularDefensa()
console.log('DEFENSA aldea:', def.puntuacion, def.nota, '| cobertura', def.cobertura, '| recinto', def.recinto, '| brechas', def.brechas, '| cerrada', def.cerrada)
console.log('consejos:', def.consejos)
