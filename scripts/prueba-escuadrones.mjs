/** Prueba rápida de la API de escuadrones. Se borra sola. */
const almacen = new Map()
globalThis.localStorage = { getItem: k => almacen.has(k) ? almacen.get(k) : null, setItem: (k, v) => almacen.set(k, String(v)), removeItem: k => almacen.delete(k), clear: () => almacen.clear(), get length () { return almacen.size } }
globalThis.document = { addEventListener () {}, removeEventListener () {}, hidden: false, getElementById: () => null }
globalThis.window = { addEventListener () {}, removeEventListener () {} }
globalThis.performance = { now: () => Date.now() }

const { game } = await import('../src/core/state.js')
const A = await import('../src/sim/army.js')
const { def } = await import('../src/data/buildings.js')
const { events, EV } = await import('../src/core/events.js')

let toasts = 0
events.on(EV.UI_TOAST, () => toasts++)
let cambios = 0
events.on(EV.ESCUADRONES_CAMBIADOS, () => cambios++)

const C = 30
let n = 0
const poner = (tipo, x, z, nivel = 3) => {
  const d = def(tipo)
  game.state.buildings.push({ id: `b${++n}`, tipo, nivel, x, z, rot: 0, ancho: d.ancho || 1, alto: d.alto || 1, hp: d.hp(nivel), hpMax: d.hp(nivel), enObra: false, trabajadores: [] })
}
poner('ayuntamiento', C - 2, C - 2, 4)
poner('cuartel', C + 3, C, 3)

A.init()
game.state.ejercito.tropas = { lancero: 20, arquero: 10, espadachin: 6 }

const fallos = []
const comprobar = (que, ok, detalle = '') => { if (!ok) fallos.push(`${que} ${detalle}`); console.log(`${ok ? 'OK ' : 'MAL'}  ${que} ${detalle}`) }

// 1) partida vieja: un escuadrón con todo
let e = A.escuadrones()
comprobar('partida sin escuadrones -> se crea uno de defensa con toda la tropa',
  e.length === 1 && e[0].cometido === 'defensa' && e[0].total === 36, `(${e.length} escuadrón, ${e[0].total} hombres)`)

// 2) crear uno de ataque y repartir
const r1 = A.crearEscuadron('La Hueste del Norte', 'ataque')
comprobar('crearEscuadron', r1.ok, r1.motivo)
const ataque = r1.escuadron.id
const guardia = e[0].id
const r2 = A.moverTropas(guardia, ataque, { lancero: 12, espadachin: 6 })
comprobar('moverTropas', r2.ok, r2.motivo)

e = A.escuadrones()
const censo = e.reduce((a, q) => a + q.total, 0)
comprobar('el censo cuadra tras repartir', censo === 36, `(suman ${censo} de 36)`)
comprobar('tropasDeAsalto solo son los de ataque',
  JSON.stringify(A.tropasDeAsalto()) === JSON.stringify({ lancero: 12, espadachin: 6 }), JSON.stringify(A.tropasDeAsalto()))
comprobar('tropasDeDefensa solo son los de defensa',
  JSON.stringify(A.tropasDeDefensa()) === JSON.stringify({ lancero: 8, arquero: 10 }), JSON.stringify(A.tropasDeDefensa()))

// 3) mover más de lo que hay
const r3 = A.moverTropas(guardia, ataque, { lancero: 99 })
comprobar('no se puede mover tropa que no tienes', !r3.ok, r3.motivo)

// 4) puestos y flancos
A.fijarPuestoEscuadron(guardia, C - 1, C - 8)
A.fijarPuestoEscuadron(ataque, C - 1, C + 8)
e = A.escuadrones()
const g = e.find(q => q.id === guardia); const at = e.find(q => q.id === ataque)
comprobar('cada escuadrón guarda un flanco distinto', g.flanco !== at.flanco, `${g.nombre}=${g.flanco}, ${at.nombre}=${at.flanco}`)

// 5) la formación coloca a cada uno en SU puesto
const plan = A.formacionReunion()
const sitios = new Set(plan.puestos.map(p => p.escuadron))
comprobar('formacionReunion reparte las figuras por escuadrón', sitios.size === 2 && plan.puestos.length === 36, `(${plan.puestos.length} figuras en ${sitios.size} formaciones)`)
const zGuardia = plan.puestos.filter(p => p.escuadron === guardia).reduce((a, p) => a + p.z, 0) / 24
const zAtaque = plan.puestos.filter(p => p.escuadron === ataque).reduce((a, p) => a + p.z, 0) / 18
comprobar('las dos formaciones están separadas en el tablero', Math.abs(zGuardia - zAtaque) > 8, `(z medio ${zGuardia.toFixed(1)} contra ${zAtaque.toFixed(1)})`)

// 6) entrenar nueva tropa: entra en el de acogida y el censo sigue cuadrando
game.state.ejercito.tropas.jinete = 4
e = A.escuadrones()
comprobar('la tropa nueva entra sola en el escuadrón de acogida y el censo cuadra',
  e.reduce((a, q) => a + q.total, 0) === 40 && (e[0].tropas.jinete || 0) === 4, `(${e.reduce((a, q) => a + q.total, 0)} hombres)`)

// 7) perder tropa: el reparto se recorta solo, sin descuadres
game.state.ejercito.tropas.lancero = 3
e = A.escuadrones()
const lanceros = e.reduce((a, q) => a + (q.tropas.lancero || 0), 0)
comprobar('al perder tropa el reparto se recorta solo', lanceros === 3, `(quedan ${lanceros} lanceros repartidos)`)

// 8) borrar
const r4 = A.borrarEscuadron(ataque)
comprobar('borrarEscuadron devuelve la gente al principal', r4.ok, r4.motivo)
comprobar('no se puede quedar sin escuadrones', !A.borrarEscuadron(A.escuadrones()[0].id).ok)
comprobar('el censo cuadra al final', A.escuadrones().reduce((a, q) => a + q.total, 0) === Object.values(game.state.ejercito.tropas).reduce((a, b) => a + b, 0))

// 9) compatibilidad
comprobar('fijarReunion(x,z) de toda la vida sigue funcionando', A.fijarReunion(C + 2, C + 2).ok)
comprobar('formacionReunion(tropas) de toda la vida sigue funcionando', A.formacionReunion({ lancero: 5 }).puestos.length === 5)
comprobar('el estado sobrevive a JSON', JSON.parse(JSON.stringify(game.state)).ejercito.escuadrones.length === 1)

console.log(`\n${fallos.length ? 'FALLOS: ' + fallos.length : 'TODO CORRECTO'} · ${cambios} avisos de cambio de reparto`)
process.exit(fallos.length ? 1 : 0)
