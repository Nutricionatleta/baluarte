/**
 * PRUEBA DE PLANTILLAS Y REPARTO AUTOMÁTICO.
 *
 * Lo que demuestra, que es justo lo que pidió el dueño: se fijan plantillas en
 * dos escuadrones, se entrena tropa, se mata a parte del ejército y la reposición
 * se coloca SOLA donde toca, sin tocar nada a mano. También comprueba que todo
 * sobrevive a guardar y cargar, y que un escuadrón vacío no se borra.
 *
 * Uso: node scripts/prueba-plantillas.mjs
 */
const almacen = new Map()
globalThis.localStorage = {
  getItem: k => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
  removeItem: k => almacen.delete(k),
  clear: () => almacen.clear(),
  get length () { return almacen.size }
}
globalThis.document = { addEventListener () {}, removeEventListener () {}, hidden: false, getElementById: () => null }
globalThis.window = { addEventListener () {}, removeEventListener () {} }
globalThis.performance = { now: () => Date.now() }

// Reloj virtual: la cola del cuartel va por Date.now(), así que adelantándolo
// se puede ver salir la tropa sin esperar de verdad.
const RELOJ = Date.now.bind(Date)
let VT = RELOJ()
Date.now = () => Math.floor(VT)
const avanzar = (seg) => { VT += seg * 1000 }

const { game } = await import('../src/core/state.js')
const A = await import('../src/sim/army.js')
const { def } = await import('../src/data/buildings.js')
const { events, EV } = await import('../src/core/events.js')

const avisos = []
events.on(EV.UI_TOAST, (p) => avisos.push(p?.texto || ''))

const C = 30
let nb = 0
const poner = (tipo, x, z, nivel = 3) => {
  const d = def(tipo)
  game.state.buildings.push({
    id: `b${++nb}`, tipo, nivel, x, z, rot: 0, ancho: d.ancho || 1, alto: d.alto || 1,
    hp: d.hp(nivel), hpMax: d.hp(nivel), enObra: false, trabajadores: []
  })
}
poner('ayuntamiento', C - 2, C - 2, 5)
poner('cuartel', C + 4, C, 6)
poner('arqueria', C - 6, C, 6)
poner('granero', C, C + 5, 4)
poner('almacen', C + 6, C + 5, 4)

A.init()
game.state.age = 'castillos'              // para poder entrenar arqueros
game.state.recursos = { madera: 9000, piedra: 9000, comida: 9000, oro: 9000 }
game.state.almacen = { madera: 99000, piedra: 99000, comida: 99000, oro: 99000 }

const fallos = []
const comprobar = (que, ok, detalle = '') => {
  if (!ok) fallos.push(`${que} ${detalle}`)
  console.log(`${ok ? 'OK ' : 'MAL'}  ${que}${detalle ? `  ${detalle}` : ''}`)
}
const linea = (t) => console.log(`\n─── ${t}`)
const ver = (id) => A.escuadrones().find(q => q.id === id)
const censo = () => ({ ...game.state.ejercito.tropas })
const suma = (o) => Object.values(o || {}).reduce((a, b) => a + (b || 0), 0)
const pintar = () => A.escuadrones().map(q =>
  `${q.nombre} [p${q.prioridad}] ${JSON.stringify(q.tropas)}${q.plantilla ? ` / plantilla ${JSON.stringify(q.plantilla)}` : ' / sin plantilla'}${q.completo ? ' ✔' : ` (faltan ${q.faltan})`}`
).join('\n   ')

// ═════════════════ 1. dos escuadrones con plantilla ═════════════════
linea('1. Se levantan dos escuadrones y se les fija plantilla')
const reserva = A.escuadrones()[0].id          // el de acogida, donde caen los reclutas
A.renombrarEscuadron(reserva, 'La Reserva')
const vado = A.crearEscuadron('Los del Vado', 'defensa').escuadron.id
const norte = A.crearEscuadron('Hueste del Norte', 'defensa').escuadron.id

const r1 = A.fijarPlantilla(vado, { lancero: 6, arquero: 4 })
const r2 = A.fijarPlantilla(norte, { lancero: 4, arquero: 2 })
comprobar('fijarPlantilla en Los del Vado', r1.ok, JSON.stringify(r1.plantilla))
comprobar('fijarPlantilla en Hueste del Norte', r2.ok, JSON.stringify(r2.plantilla))
A.fijarPrioridad(vado, 1)                      // el Vado se sirve primero
A.fijarPrioridad(norte, 2)
comprobar('la plantilla es JSON puro en el estado',
  JSON.stringify(game.state.ejercito.escuadrones.find(q => q.id === vado).plantilla) === '{"lancero":6,"arquero":4}')
console.log('   ' + pintar())

// ═════════════════ 2. entrenar y que se coloque sola ═════════════════
linea('2. Se entrena tropa: tiene que colocarse sola')
A.entrenar('lancero', 10)
A.entrenar('arquero', 6)
avanzar(60 * 30)                               // media hora: sale toda la cola
events.emit(EV.TICK, { dt: 1 })
console.log('   censo:', JSON.stringify(censo()))
console.log('   ' + pintar())
comprobar('Los del Vado se llena solo (6 lanceros, 4 arqueros)',
  JSON.stringify(ver(vado).tropas) === '{"lancero":6,"arquero":4}', JSON.stringify(ver(vado).tropas))
comprobar('Hueste del Norte se llena sola (4 lanceros, 2 arqueros)',
  JSON.stringify(ver(norte).tropas) === '{"lancero":4,"arquero":2}', JSON.stringify(ver(norte).tropas))
comprobar('la reserva se queda vacía: todo repartido', !ver(reserva).total, `${ver(reserva).total} sueltos`)
comprobar('el censo cuadra con la suma de escuadrones',
  A.escuadrones().reduce((a, q) => a + q.total, 0) === suma(censo()), `${suma(censo())} soldados`)
comprobar('hubo aviso de escuadrón completo', avisos.some(t => /al completo/.test(t)),
  avisos.filter(t => /al completo/.test(t)).slice(-1)[0] || '')

// ═════════════════ 3. si no llega para todos, manda la prioridad ═════════════════
linea('3. Con tropa escasa manda la prioridad (el 1 se llena entero)')
const tercero = A.crearEscuadron('Los Lobos', 'defensa').escuadron.id
A.fijarPlantilla(tercero, { lancero: 8 })
A.fijarPrioridad(tercero, 3)
A.entrenar('lancero', 3)                       // solo 3 para un hueco de 8
avanzar(60 * 20)
events.emit(EV.TICK, { dt: 1 })
console.log('   ' + pintar())
comprobar('los 3 nuevos van al de prioridad 3 (los de arriba están completos)',
  ver(tercero).tropas.lancero === 3, JSON.stringify(ver(tercero).tropas))
comprobar('los de prioridad 1 y 2 siguen completos', ver(vado).completo && ver(norte).completo)

// ═════════════════ 4. matar tropa y reponerla ═════════════════
linea('4. Les matan gente y se repone: tiene que recolocarse sola')
const antesVado = { ...ver(vado).tropas }
const bajas = A.perderTropas({ lancero: 5, arquero: 3 }, { victoria: false })
console.log('   muertos:', bajas.muertos, '· a la enfermería:', bajas.enfermeria)
console.log('   censo tras la batalla:', JSON.stringify(censo()))
console.log('   ' + pintar())
const faltaAhora = A.faltaDePlantillas()
comprobar('tras las bajas, los escuadrones acusan la falta', faltaAhora.faltan > 0, `faltan ${faltaAhora.faltan}: ${JSON.stringify(faltaAhora.total)}`)
comprobar('el censo sigue cuadrando tras las bajas',
  A.escuadrones().reduce((a, q) => a + q.total, 0) === suma(censo()))
comprobar('el de prioridad 1 es el que queda mejor servido',
  suma(ver(vado).tropas) >= suma(ver(tercero).tropas),
  `Vado ${suma(ver(vado).tropas)} vs Lobos ${suma(ver(tercero).tropas)}`)

linea('4b. Los heridos se curan y vuelven a SU puesto, sin tocar nada')
const heridosAntes = suma(A.heridos())
avanzar(6 * 3600)                              // la enfermería va por reloj real
events.emit(EV.TICK, { dt: 1 })
console.log('   heridos que vuelven:', heridosAntes)
console.log('   ' + pintar())
comprobar('la enfermería queda vacía', !suma(A.heridos()))
comprobar('los curados vuelven al escuadrón que los pedía, no al montón',
  ver(reserva).total === 0 || ver(vado).faltan === 0,
  `reserva ${ver(reserva).total}, faltan al Vado ${ver(vado).faltan}`)

// ═════════════════ 5. entrenar lo que falta de una vez ═════════════════
linea('5. Botón «entrenar lo que falta»')
const plan = A.planDeRelleno()
console.log('   plan:', JSON.stringify(plan.tropas), '· coste', JSON.stringify(plan.coste), `· ${plan.segundos}s`)
const relleno = A.entrenarLoQueFalta()
comprobar('entrenarLoQueFalta encarga tropa', relleno.ok, `${relleno.total || 0} encargados`)
comprobar('encarga exactamente lo que falta (ni uno más)',
  suma(relleno.encargadas || {}) === suma(plan.tropas), JSON.stringify(relleno.encargadas))
const plan2 = A.planDeRelleno()
comprobar('pulsarlo dos veces no duplica el encargo', plan2.total === 0, `pediría ${plan2.total} más`)
avanzar(60 * 60)
events.emit(EV.TICK, { dt: 1 })
console.log('   ' + pintar())
const falta5 = A.faltaDePlantillas()
comprobar('tras entrenar, todas las plantillas quedan completas', falta5.faltan === 0, `faltan ${falta5.faltan}`)

// ═════════════════ 6. guardar y cargar ═════════════════
linea('6. Guardar y cargar: plantillas, puestos y prioridades aguantan')
A.fijarPuestoEscuadron(vado, C - 1, C + 9)
const antes = JSON.parse(JSON.stringify(game.state.ejercito.escuadrones))
const copia = JSON.parse(JSON.stringify(game.state))
for (const k of Object.keys(game.state)) delete game.state[k]
Object.assign(game.state, copia)
events.emit(EV.STATE_LOADED, { state: game.state, offlineSeconds: 0 })
const despues = game.state.ejercito.escuadrones
comprobar('las plantillas sobreviven al guardado',
  JSON.stringify(despues.map(q => q.plantilla || null)) === JSON.stringify(antes.map(q => q.plantilla || null)),
  JSON.stringify(despues.map(q => q.plantilla || null)))
comprobar('los puestos sobreviven al guardado',
  JSON.stringify(despues.map(q => q.puesto)) === JSON.stringify(antes.map(q => q.puesto)))
comprobar('las prioridades sobreviven al guardado',
  JSON.stringify(despues.map(q => q.prioridad)) === JSON.stringify(antes.map(q => q.prioridad)),
  JSON.stringify(despues.map(q => q.prioridad)))
comprobar('el estado sigue siendo JSON puro', (() => {
  try { JSON.parse(JSON.stringify(game.state.ejercito)); return true } catch { return false }
})())

// ═════════════════ 7. un escuadrón vacío no se borra ═════════════════
linea('7. Un escuadrón que se queda a cero NO se borra')
const todos = { ...censo() }
A.perderTropas(todos, { victoria: false, fraccionHeridos: 0 })   // mueren todos
console.log('   censo tras el desastre:', JSON.stringify(censo()))
console.log('   ' + pintar())
const vivos = A.escuadrones()
comprobar('siguen existiendo los 4 escuadrones', vivos.length === 4, `${vivos.length}`)
comprobar('el vacío conserva nombre, puesto y plantilla',
  ver(vado) && ver(vado).nombre === 'Los del Vado' && ver(vado).plantilla &&
  ver(vado).puesto.x === C - 1 && ver(vado).puesto.z === C + 9,
  JSON.stringify(ver(vado)?.plantilla))
A.entrenar('lancero', 6)
avanzar(60 * 30)
events.emit(EV.TICK, { dt: 1 })
console.log('   ' + pintar())
comprobar('al entrar tropa nueva, el vacío se vuelve a llenar solo',
  ver(vado).tropas.lancero === 6, JSON.stringify(ver(vado).tropas))

// ═════════════════ 8. se puede desactivar y repartir a mano ═════════════════
linea('8. Se puede apagar el automático de un escuadrón')
A.fijarAutoReparto(vado, false)
A.entrenar('arquero', 4)
avanzar(60 * 30)
events.emit(EV.TICK, { dt: 1 })
console.log('   ' + pintar())
comprobar('con el automático apagado, al Vado no le entra tropa sola',
  !(ver(vado).tropas.arquero > 0), JSON.stringify(ver(vado).tropas))
comprobar('y tampoco le quitan la suya', ver(vado).tropas.lancero === 6, JSON.stringify(ver(vado).tropas))
A.fijarAutoReparto(vado, true)
events.emit(EV.TICK, { dt: 1 })
comprobar('al volver a encenderlo, se rellena', ver(vado).tropas.arquero > 0, JSON.stringify(ver(vado).tropas))

// ═════════════════ 9. sin plantilla, todo como antes ═════════════════
linea('9. Partida vieja: sin plantillas no cambia nada')
for (const q of game.state.ejercito.escuadrones) delete q.plantilla
const antesSin = JSON.stringify(A.escuadrones().map(q => q.tropas))
A.entrenar('lancero', 3)
avanzar(60 * 20)
events.emit(EV.TICK, { dt: 1 })
const lista9 = A.escuadrones()
comprobar('sin plantillas, los reclutas caen en la reserva como siempre',
  lista9[0].tropas.lancero >= 3, JSON.stringify(lista9[0].tropas))
comprobar('y nadie le toca la tropa a los demás',
  JSON.stringify(lista9.slice(1).map(q => q.tropas)) === JSON.stringify(JSON.parse(antesSin).slice(1)))

// ═════════════════ resultado ═════════════════
console.log(`\n${'═'.repeat(60)}`)
console.log(fallos.length ? `❌ ${fallos.length} FALLOS:\n - ${fallos.join('\n - ')}` : '✅ TODO BIEN: 0 fallos')
Date.now = RELOJ
process.exit(fallos.length ? 1 : 0)
