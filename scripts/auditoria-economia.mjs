/**
 * AUDITORÍA DE ECONOMÍA — Baluarte.
 *
 * Saca las CUENTAS de la economía con las fórmulas REALES del juego (importa
 * src/data y src/sim, no copia números): comida frente a todo lo que come,
 * los cuatro recursos edad por edad, lo que rebosa, lo que aporta el imperio,
 * los casos límite de negativos y la salida de la espiral de la muerte.
 *
 * No toca ningún fichero del juego. Uso: node scripts/auditoria-economia.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))

// --- apaño mínimo de entorno (igual que partida-automatica.mjs) ---
const mapa = new Map()
globalThis.localStorage = {
  getItem: (k) => (mapa.has(k) ? mapa.get(k) : null),
  setItem: (k, v) => { mapa.set(k, String(v)) },
  removeItem: (k) => { mapa.delete(k) },
  clear: () => mapa.clear(),
  get length () { return mapa.size }
}
globalThis.document = { addEventListener () {}, removeEventListener () {}, hidden: false, getElementById: () => null }
globalThis.window = { addEventListener () {}, removeEventListener () {} }
globalThis.performance = { now: () => Date.now() }
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)

const { CONFIG } = await import('../src/core/config.js')
const { game, nuevaPartida } = await import('../src/core/state.js')
const { def, ORDEN_EDADES } = await import('../src/data/buildings.js')
const { UNIDADES } = await import('../src/data/units.js')
const { TECNOLOGIAS } = await import('../src/data/techs.js')
const { events, EV } = await import('../src/core/events.js')
const EV_TICK = EV.TICK
const banco = await import('../src/sim/resources.js')
const ejercito = await import('../src/sim/army.js')

// El cobro offline y la manutención solo existen si los módulos están enganchados
// al bus: sin esto las pruebas de "8 horas fuera" no cobran nada y mienten.
banco.init()
ejercito.init()

const RECURSOS = CONFIG.RECURSOS
const r1 = (v) => Math.round(v * 10) / 10
const mil = (v) => Math.round(v).toLocaleString('es-ES')

// ───────────────────────────── la mesa de pruebas ─────────────────────────
/** Nivel máximo que puede tener un edificio con ese ayuntamiento. */
const nivelPosible = (tipo, ayto) => Math.min(def(tipo).maxNivel, ayto)

/**
 * Monta una aldea "al tope de lo que el juego deja" para una edad:
 * todos los edificios permitidos, al nivel del ayuntamiento, todas las plazas
 * llenas y todas las tecnologías de esa edad investigadas.
 */
function aldeaAlTope ({ age, ayto, puestos = 0, molinos = true, techs = true }) {
  const s = nuevaPartida(1)
  s.age = age
  s.buildings = []
  let id = 0
  const poner = (tipo, nivel, extra = {}) => {
    const d = def(tipo)
    const b = {
      id: 'b' + (++id), tipo, nivel, x: 2 + ((id * 5) % 45), z: 2 + ((id * 7) % 45),
      rot: 0, ancho: d.ancho, alto: d.alto, hp: 1000, hpMax: 1000, enObra: false, trabajadores: [], ...extra
    }
    s.buildings.push(b)
    return b
  }
  const iEdad = ORDEN_EDADES.indexOf(age)
  const disponible = (tipo) => ORDEN_EDADES.indexOf(def(tipo).age) <= iEdad

  poner('ayuntamiento', ayto)
  for (const tipo of ['serreria', 'cantera', 'granja', 'mina_oro']) {
    if (!disponible(tipo)) continue
    const n = nivelPosible(tipo, ayto)
    for (let i = 0; i < def(tipo).max; i++) poner(tipo, n)
  }
  // molinos: se colocan junto a las granjas para que el aura llegue a todas
  if (molinos && disponible('molino')) {
    const granjas = s.buildings.filter(b => b.tipo === 'granja')
    for (const g of granjas) { g.x = 20; g.z = 20 }
    for (let i = 0; i < def('molino').max; i++) poner('molino', nivelPosible('molino', ayto), { x: 20, z: 20 })
  }
  for (let i = 0; i < puestos; i++) poner('puesto_avanzado', nivelPosible('puesto_avanzado', ayto))
  for (const tipo of ['almacen', 'granero']) {
    for (let i = 0; i < def(tipo).max; i++) poner(tipo, nivelPosible(tipo, ayto))
  }
  for (const tipo of ['cuartel', 'arqueria', 'establo', 'taller_asedio']) {
    if (!disponible(tipo)) continue
    for (let i = 0; i < def(tipo).max; i++) poner(tipo, nivelPosible(tipo, ayto))
  }
  for (let i = 0; i < def('casa').max; i++) poner('casa', nivelPosible('casa', ayto))

  s.research = {}
  if (techs) for (const t in TECNOLOGIAS) if (ORDEN_EDADES.indexOf(TECNOLOGIAS[t].age) <= iEdad) s.research[t] = true

  // plazas llenas: un aldeano por plaza de trabajo
  s.villagers = []
  let vid = 0
  for (const b of s.buildings) {
    const d = def(b.tipo)
    const plazas = typeof d.plazas === 'function' ? d.plazas(b.nivel) : 0
    for (let i = 0; i < plazas; i++) {
      const v = { id: 'v' + (++vid), nombre: 'a', job: 'peon', buildingId: b.id, x: b.x, z: b.z, estado: 'trabaja', animo: 1 }
      s.villagers.push(v)
      b.trabajadores.push(v.id)
    }
  }
  s.animo = { valor: 1, hambre: 0, factor: 1 }
  s.ejercito = { tropas: {}, cola: [], fuera: {}, heridos: {}, hambre: false, ultimoConsumo: Date.now(), restoComida: 0 }
  game.state = s
  banco.recalcularAlmacen()
  return s
}

/** Llena el ejército hasta el hueco con la unidad MÁS cara de alimentar de esa edad. */
function ejercitoMasGloton (s) {
  const iEdad = ORDEN_EDADES.indexOf(s.age)
  let peor = null
  for (const tipo in UNIDADES) {
    const u = UNIDADES[tipo]
    if (!u.espacio) continue
    if (ORDEN_EDADES.indexOf(u.age) > iEdad) continue
    const puede = Object.entries(u.requiere || {}).every(([t, n]) =>
      s.buildings.some(b => b.tipo === t && b.nivel >= n))
    if (!puede) continue
    const racion = Math.max(0.05, ((u.coste.comida || 0) + (u.coste.oro || 0) * 1.5 +
      (u.coste.madera || 0) * 0.35 + (u.coste.piedra || 0) * 0.35) / 110)
    const porHueco = racion / u.espacio
    if (!peor || porHueco > peor.porHueco) peor = { tipo, u, racion, porHueco }
  }
  const huecos = ejercito.capacidad()
  if (!peor) return { tipo: null, n: 0, comida: 0, huecos }
  const n = Math.floor(huecos / peor.u.espacio)
  s.ejercito.tropas = { [peor.tipo]: n }
  return { tipo: peor.tipo, n, comida: ejercito.consumoComida(), huecos }
}

const SEP = (t) => console.log('\n' + '='.repeat(78) + '\n  ' + t + '\n' + '='.repeat(78))

// ═══════════════════════════ 1. LA COMIDA, POR EDAD ════════════════════════
SEP('1. EL TRIGO - produce frente a come, en el peor caso razonable')

const TRAMOS = [
  { age: 'oscura', ayto: 3, puestos: 0 },
  { age: 'feudal', ayto: 5, puestos: 1 },
  { age: 'feudal', ayto: 9, puestos: 2 },
  { age: 'castillos', ayto: 10, puestos: 2 },
  { age: 'imperial', ayto: 11, puestos: 2 },
  { age: 'imperial', ayto: 14, puestos: 2 },
  { age: 'imperial', ayto: 14, puestos: 8 }
]
const MANT = CONFIG.TERRITORIO.MANTENIMIENTO_MIN

console.log('\n  Edad        Ayto  Avanz. | Produce | Come (ejercito lleno + soldada)     |   NETO')
console.log('  ' + '-'.repeat(76))
const filasComida = []
for (const t of TRAMOS) {
  const s = aldeaAlTope(t)
  const pm = banco.produccionPorMinuto()
  const ej = ejercitoMasGloton(s)
  const soldada = (MANT.comida || 0) * t.puestos
  const neto = pm.comida - ej.comida - soldada
  filasComida.push({ ...t, produce: pm.comida, ejercito: ej, soldada, neto, oro: pm.oro, oroSoldada: (MANT.oro || 0) * t.puestos })
  console.log('  ' + String(t.age).padEnd(11) + String(t.ayto).padStart(4) + String(t.puestos).padStart(7) +
    '  |' + String(r1(pm.comida)).padStart(8) + ' |  ' +
    (ej.tipo ? `${ej.n}x${ej.tipo} = ${r1(ej.comida)}` : 'sin ejercito').padEnd(26) + ' + ' + String(soldada).padStart(2) +
    '  |' + String(r1(neto)).padStart(8))
}

console.log('\n  Detalle del peor caso de cada tramo:')
for (const f of filasComida) {
  console.log(`   . ${f.age} ayto ${f.ayto}: ${f.ejercito.huecos} huecos -> ${f.ejercito.n} ${f.ejercito.tipo || '-'}` +
    `, ${r1(f.ejercito.comida)} comida/min de tropa; soldada ${f.soldada} comida + ${f.oroSoldada} oro/min` +
    `; oro producido ${r1(f.oro)}/min -> neto oro ${r1(f.oro - f.oroSoldada)}`)
}

{
  const s = aldeaAlTope({ age: 'imperial', ayto: 14, puestos: 2 })
  const ej = ejercitoMasGloton(s)
  const sano = ejercito.consumoComida()
  const mitad = Math.floor(ej.n / 2)
  s.ejercito.tropas[ej.tipo] -= mitad
  s.ejercito.heridos = { [ej.tipo]: mitad }
  const conHeridos = ejercito.consumoComida()
  console.log(`\n  Heridos: el mismo ejercito con la mitad en la enfermeria come ${r1(conHeridos)}/min` +
    ` frente a ${r1(sano)}/min sano. El peor caso es la tropa SANA.`)
}

// ═══════════════════ 2. LOS CUATRO RECURSOS, EDAD POR EDAD ═════════════════
SEP('2. LOS CUATRO RECURSOS - entra por hora frente a lo que toca pagar')

const OBJETIVO = {
  oscura: { que: 'Edad Feudal', coste: { madera: 700, piedra: 350, comida: 550, oro: 60 } },
  feudal: { que: 'Edad de los Castillos', coste: { madera: 60000, piedra: 50000, comida: 18000, oro: 7000 } },
  castillos: { que: 'Edad Imperial', coste: { madera: 260000, piedra: 240000, comida: 90000, oro: 40000 } },
  imperial: { que: 'Ayuntamiento 14 (ultima mejora)', coste: null }
}

for (const t of TRAMOS.filter(x => x.puestos <= 2)) {
  const s = aldeaAlTope(t)
  const pm = banco.produccionPorMinuto()
  const ej = ejercitoMasGloton(s)
  const gastoComida = ej.comida + (MANT.comida || 0) * t.puestos
  const gastoOro = (MANT.oro || 0) * t.puestos
  const neto = { madera: pm.madera, piedra: pm.piedra, comida: pm.comida - gastoComida, oro: pm.oro - gastoOro }
  const obj = OBJETIVO[t.age]
  const coste = obj.coste || def('ayuntamiento').coste(14)
  console.log(`\n  ${t.age.toUpperCase()} . ayto ${t.ayto} . ${t.puestos} avanzadillas -> objetivo: ${obj.que}`)
  console.log('    recurso   neto/min   neto/hora   coste objetivo   horas de espera')
  let cuello = { r: null, h: -1 }
  for (const r of RECURSOS) {
    const h = neto[r] > 0 ? coste[r] / (neto[r] * 60) : (coste[r] > 0 ? Infinity : 0)
    if (coste[r] > 0 && h > cuello.h) cuello = { r, h }
    console.log('    ' + r.padEnd(9) + String(r1(neto[r])).padStart(9) + String(mil(neto[r] * 60)).padStart(12) +
      String(mil(coste[r])).padStart(17) + '   ' + (Number.isFinite(h) ? r1(h) + ' h' : 'INFINITO (neto negativo)'))
  }
  console.log(`    -> cuello de botella: ${cuello.r} (${r1(cuello.h)} h)`)
}

// ═══════════════════════════ 3. LO QUE SE PIERDE ═══════════════════════════
SEP('3. LO QUE SE PIERDE - rebose de almacen y vuelta tras 8 horas fuera')

for (const t of [{ age: 'feudal', ayto: 9, puestos: 2 }, { age: 'imperial', ayto: 14, puestos: 2 }]) {
  const s = aldeaAlTope(t)
  const pm = banco.produccionPorMinuto()
  const alm = { ...s.almacen }
  console.log(`\n  ${t.age} . ayto ${t.ayto}`)
  console.log('    recurso   tope almacen   produccion 8 h   horas hasta llenar desde vacio')
  for (const r of RECURSOS) {
    const h8 = pm[r] * 60 * CONFIG.MAX_OFFLINE_HORAS
    const llena = pm[r] > 0 ? alm[r] / (pm[r] * 60) : Infinity
    console.log('    ' + r.padEnd(9) + String(mil(alm[r])).padStart(13) + String(mil(h8)).padStart(17) +
      '   ' + (Number.isFinite(llena) ? r1(llena) + ' h' : '-') + (llena < CONFIG.MAX_OFFLINE_HORAS ? '  <- rebosa antes de las 8 h' : ''))
  }
}

{
  const s = aldeaAlTope({ age: 'imperial', ayto: 14, puestos: 2 })
  ejercitoMasGloton(s)
  for (const r of RECURSOS) s.recursos[r] = s.almacen[r]
  s.excedente = {}
  const antes = { ...s.recursos }
  s.ejercito.ultimoConsumo = Date.now() - 8 * 3600 * 1000
  events.emit('offline:report', { seconds: 8 * 3600 })
  console.log('\n  Cerrar la app 8 h con TODO el almacen lleno y el ejercito al maximo:')
  for (const r of RECURSOS) {
    console.log('    ' + r.padEnd(9) + mil(antes[r]).padStart(9) + ' -> ' + mil(s.recursos[r]).padStart(9) +
      '   (' + (s.recursos[r] - antes[r] >= 0 ? '+' : '') + mil(s.recursos[r] - antes[r]) + ')' +
      (s.recursos[r] < 0 ? '  NEGATIVO' : ''))
  }
  console.log('    excedente apartado fuera: ' + RECURSOS.map(r => r + ' ' + mil(banco.excedenteDe(r))).join(' . '))
}

// ═══════════════════════════ 4. EL IMPERIO ═════════════════════════════════
SEP('4. EL IMPERIO - lo que aportan las plazas frente a la aldea')
{
  const s = aldeaAlTope({ age: 'imperial', ayto: 14, puestos: 2 })
  const pm = banco.produccionPorMinuto()
  const sumaAldea = RECURSOS.reduce((a, r) => a + pm[r], 0)
  // constantes de world/imperio.js (solo lectura: ese modulo no es mio)
  const CUOTA = 0.035, MERMA = 0.055, TOPE = 0.6
  console.log(`\n  Produccion de la aldea al tope: ${r1(sumaAldea)}/min sumando los cuatro.`)
  console.log('    plazas   bruto/min   con merma   tope 60% aldea   entra de verdad   % sobre la aldea')
  for (const n of [1, 3, 5, 8, 12, 20]) {
    const bruto = sumaAldea * CUOTA * n
    const merma = bruto / (1 + MERMA * (n - 1))
    const entra = Math.min(merma, sumaAldea * TOPE)
    console.log('    ' + String(n).padStart(6) + String(r1(bruto)).padStart(12) + String(r1(merma)).padStart(12) +
      String(r1(sumaAldea * TOPE)).padStart(17) + String(r1(entra)).padStart(18) +
      String(r1(entra / sumaAldea * 100) + ' %').padStart(18))
  }
}

// ═════════════════ 5. NADA NEGATIVO NUNCA — pruebas a lo bestia ════════════
SEP('5. NADA PUEDE QUEDAR NEGATIVO - pruebas limite')
{
  const casos = []
  const prueba = (nombre, fn) => {
    const s = aldeaAlTope({ age: 'imperial', ayto: 14, puestos: 8 })
    ejercitoMasGloton(s)
    fn(s)
    const mal = RECURSOS.filter(r => !(s.recursos[r] >= 0)).map(r => r + '=' + s.recursos[r])
    casos.push({ nombre, ok: !mal.length, mal, caja: { ...s.recursos } })
  }
  prueba('caja a CERO + 8 h fuera + ejercito lleno + 8 avanzadillas', (s) => {
    for (const r of RECURSOS) s.recursos[r] = 0
    s.excedente = {}
    s.ejercito.ultimoConsumo = Date.now() - 8 * 3600 * 1000
    events.emit('offline:report', { seconds: 8 * 3600 })
  })
  prueba('caja a 1 de comida + 48 h fuera (tope de 8 h)', (s) => {
    for (const r of RECURSOS) s.recursos[r] = 0
    s.recursos.comida = 1
    s.ejercito.ultimoConsumo = Date.now() - 48 * 3600 * 1000
    events.emit('offline:report', { seconds: 48 * 3600 })
  })
  prueba('sin granjas (arrasadas) + ejercito lleno + 8 h fuera', (s) => {
    for (const b of s.buildings) if (b.tipo === 'granja' || b.tipo === 'puesto_avanzado') b.arruinado = true
    for (const r of RECURSOS) s.recursos[r] = 5
    s.ejercito.ultimoConsumo = Date.now() - 8 * 3600 * 1000
    events.emit('offline:report', { seconds: 8 * 3600 })
  })
  prueba('pagar mas de lo que hay (mejora imposible)', (s) => {
    for (const r of RECURSOS) s.recursos[r] = 10
    banco.pagar({ madera: 99999, piedra: 99999, comida: 99999, oro: 99999 }, 'prueba')
  })
  for (const c of casos) {
    console.log('  ' + (c.ok ? '[OK]' : '[MAL]') + ' ' + c.nombre + (c.mal.length ? '  -> ' + c.mal.join(', ') : '') +
      '   caja: ' + RECURSOS.map(r => r[0] + mil(c.caja[r])).join(' '))
  }
}

// ═════════════════════ 6. LA ESPIRAL DE LA MUERTE ══════════════════════════
SEP('6. LA ESPIRAL DE LA MUERTE - aldea arrasada y caja a cero')
{
  const s = aldeaAlTope({ age: 'feudal', ayto: 9, puestos: 0 })
  for (const b of s.buildings) { b.arruinado = true; b.trabajadores = [] }
  for (const r of RECURSOS) s.recursos[r] = 0
  const pmRuinas = banco.produccionPorMinuto()
  console.log('\n  Con TODO arruinado y la caja a cero, las ruinas rinden por minuto:')
  console.log('    ' + RECURSOS.map(r => r + ' ' + r1(pmRuinas[r])).join(' . '))

  const MIN_BASE = 3, MIN_POR_NIVEL = 1.5, MIN_MAX = 25
  const PRIORIDAD = { granja: 0, molino: 1, granero: 1, serreria: 2, cantera: 2, mina_oro: 2, almacen: 3, ayuntamiento: 4, casa: 5 }
  const cola = s.buildings.slice().sort((a, b) =>
    (PRIORIDAD[a.tipo] ?? 6) - (PRIORIDAD[b.tipo] ?? 6) || a.nivel - b.nivel)
  let acumulado = 0
  let primeraGranja = null, todasGranjas = null, total = 0, granjas = 0
  const totalGranjas = s.buildings.filter(b => b.tipo === 'granja').length
  for (const b of cola) {
    acumulado += Math.min(MIN_MAX, MIN_BASE + b.nivel * MIN_POR_NIVEL)
    if (b.tipo === 'granja') {
      granjas++
      if (primeraGranja === null) primeraGranja = acumulado
      if (granjas === totalGranjas) todasGranjas = acumulado
    }
    total = acumulado
  }
  console.log(`\n  Cuadrilla gratis (sim/reparacion.js), aldea de ${s.buildings.length} edificios arruinados:`)
  console.log(`    primera granja en pie:  ${r1(primeraGranja)} min`)
  console.log(`    las ${totalGranjas} granjas en pie:   ${r1(todasGranjas)} min (${r1(todasGranjas / 60)} h)`)
  console.log(`    aldea entera levantada: ${r1(total)} min (${r1(total / 60)} h)`)

  ejercitoMasGloton(s)
  const come = ejercito.consumoComida()
  console.log(`\n  Mientras dura: las ruinas dan ${r1(pmRuinas.comida)} comida/min y el ejercito al tope come ${r1(come)}/min` +
    ` -> ${r1(pmRuinas.comida - come)}/min.`)
  const g = s.buildings.find(b => b.tipo === 'granja')
  g.arruinado = false
  g.trabajadores = []
  console.log(`  Con la primera granja en pie (nivel ${g.nivel}, sin aldeanos = 25%): ` +
    r1(banco.produccionPorMinuto().comida) + ' comida/min')
  // coste de reparar a mano, para comparar con la cuadrilla gratis
  const dg = def('granja')
  const c = dg.coste(g.nivel)
  console.log('  Reparar esa granja pagando (1/3 del coste): ' +
    RECURSOS.map(r => r + ' ' + mil(Math.ceil((c[r] || 0) / 3))).join(' . '))
}

// ═════════ 7. EL CASO DEL DUEÑO: aldea PEQUEÑA con los campos arrasados ════
SEP('7. EL CASO REAL - aldea temprana, campos arrasados, caja a cero')

/** Aldea de verdad de principio de partida (no el tope teórico). */
function aldeaTemprana (ayto = 5) {
  const s = aldeaAlTope({ age: ayto >= 3 ? 'feudal' : 'oscura', ayto, puestos: 0, techs: false })
  // se queda con lo que un jugador tiene de verdad a esas alturas
  const quedarse = { serreria: 2, cantera: 2, granja: 3, mina_oro: 1, molino: 1, almacen: 1, granero: 1, casa: 4, cuartel: 1, arqueria: 0, establo: 0, taller_asedio: 0 }
  const cuenta = {}
  s.buildings = s.buildings.filter(b => {
    if (b.tipo === 'ayuntamiento') return true
    const tope = quedarse[b.tipo]
    if (tope === undefined) return false
    cuenta[b.tipo] = (cuenta[b.tipo] || 0) + 1
    return cuenta[b.tipo] <= tope
  })
  // los edificios de verdad no van al nivel del ayuntamiento: van dos por debajo
  for (const b of s.buildings) if (b.tipo !== 'ayuntamiento') b.nivel = Math.max(1, Math.min(b.nivel, ayto - 2))
  s.research = { hachas_afiladas: true, hoz_curva: true, picos_reforzados: true }
  // aldeanos: los que caben, repartidos por las plazas
  s.villagers = []
  let vid = 0
  for (const b of s.buildings) {
    b.trabajadores = []
    const d = def(b.tipo)
    const plazas = typeof d.plazas === 'function' ? d.plazas(b.nivel) : 0
    for (let i = 0; i < plazas; i++) {
      const v = { id: 'v' + (++vid), nombre: 'a', job: 'peon', buildingId: b.id, x: b.x, z: b.z, estado: 'trabaja', animo: 1 }
      s.villagers.push(v); b.trabajadores.push(v.id)
    }
  }
  banco.recalcularAlmacen()
  return s
}

{
  const s = aldeaTemprana(5)
  const sano = banco.produccionPorMinuto()
  // ejército realista: lo que cabe en un cuartel de nivel 3
  const huecos = ejercito.capacidad()
  s.ejercito.tropas = { lancero: Math.floor(huecos * 0.6), espadachin: Math.floor(huecos * 0.2) }
  const come = ejercito.consumoComida()
  console.log(`\n  Aldea de la Edad Feudal (ayto 5, ${s.buildings.length} edificios, ${s.villagers.length} aldeanos, ${huecos} huecos de tropa)`)
  console.log('    en pie:     ' + RECURSOS.map(r => r + ' ' + r1(sano[r])).join(' . ') + '  /min')
  console.log(`    ejercito:   ${JSON.stringify(s.ejercito.tropas)} come ${r1(come)} comida/min -> neto ${r1(sano.comida - come)}`)

  // LE ARRASAN LOS CAMPOS (granjas + molino), como le pasó al dueño
  for (const b of s.buildings) if (b.tipo === 'granja' || b.tipo === 'molino') b.arruinado = true
  for (const r of RECURSOS) s.recursos[r] = 0
  const ruinas = banco.produccionPorMinuto()
  console.log('\n  Le arrasan LAS GRANJAS Y EL MOLINO y se queda la caja a cero:')
  console.log('    en ruinas:  ' + RECURSOS.map(r => r + ' ' + r1(ruinas[r])).join(' . ') + '  /min')
  console.log(`    comida: entran ${r1(ruinas.comida)}/min y el ejercito come ${r1(come)}/min -> ` +
    (ruinas.comida - come >= 0 ? '+' : '') + r1(ruinas.comida - come) + '/min' +
    (ruinas.comida - come < 0 ? '   <<< LA DESPENSA NO LEVANTA CABEZA' : ''))

  const g = s.buildings.find(b => b.tipo === 'granja')
  const cr = def('granja').coste(g.nivel)
  const pagar = RECURSOS.map(r => r + ' ' + mil(Math.ceil((cr[r] || 0) / 3)))
  console.log(`    reparar UNA granja de nivel ${g.nivel} a mano cuesta: ${pagar.join(' . ')}`)
  const MIN_BASE = 3, MIN_POR_NIVEL = 1.5
  console.log(`    la cuadrilla gratis tarda ${MIN_BASE + g.nivel * MIN_POR_NIVEL} min por granja` +
    ` (${(MIN_BASE + g.nivel * MIN_POR_NIVEL) * 4} min las 3 granjas y el molino)`)

  // ¿y los aldeanos? esto es lo que de verdad dejaba la partida muerta
  const enRuinas = () => s.villagers.filter(v => {
    const b = s.buildings.find(x => x.id === v.buildingId)
    return b && b.arruinado
  })
  console.log(`\n  Aldeanos que se quedan dentro de los escombros: ${enRuinas().length} de ${s.villagers.length}` +
    ` (no producen nada, y su oficio NO es 'parado', asi que el boton "repartir solos" pasaba de ellos).`)

  // ...y lo que hace ahora sim/villagers.js en cuanto late el reloj
  const aldeanos = await import('../src/sim/villagers.js')
  aldeanos.init()
  for (let i = 0; i < 4; i++) events.emit(EV_TICK, { dt: 0.25 })
  const sitio = s.villagers.filter(v => {
    const b = s.buildings.find(x => x.id === v.buildingId)
    return b && !b.arruinado
  })
  console.log(`  Tras dos tics: quedan ${enRuinas().length} en las ruinas y ${sitio.length} de ${s.villagers.length}` +
    ` estan trabajando en un edificio en pie.`)
  console.log('  Produccion con la gente recolocada: ' +
    RECURSOS.map(r => r + ' ' + r1(banco.produccionPorMinuto()[r])).join(' . ') + '  /min')
}

// ═════════ 8. LA SOLDADA DE LAS AVANZADILLAS ═══════════════════════════════
SEP('8. LA SOLDADA DE LAS AVANZADILLAS - 4 comida + 1 oro por minuto cada una')
{
  console.log('\n  Se cobra en un solo golpe al volver (hasta 8 h de atraso, sim/buildings.js:cobrarMantenimiento)')
  console.log('    Ayto  avanz. | oro que entra/min | soldada oro/min | % del oro | golpe de 8 h | tope granero oro')
  for (const t of [{ age: 'oscura', ayto: 3 }, { age: 'feudal', ayto: 5 }, { age: 'feudal', ayto: 9 }, { age: 'imperial', ayto: 14 }]) {
    for (const n of [1, 2, 8]) {
      const s = aldeaAlTope({ ...t, puestos: n })
      const pm = banco.produccionPorMinuto()
      const soldada = (MANT.oro || 0) * n
      const golpe = soldada * 480
      console.log('    ' + String(t.ayto).padStart(4) + String(n).padStart(7) + '   |' +
        String(r1(pm.oro)).padStart(17) + ' |' + String(soldada).padStart(16) + ' |' +
        String(r1(soldada / (pm.oro || 1) * 100) + ' %').padStart(10) + ' |' + String(mil(golpe)).padStart(13) +
        ' |' + String(mil(s.almacen.oro)).padStart(17) +
        (golpe > s.almacen.oro ? '  <- NO CABE: se queda desabastecida' : ''))
    }
  }
}

console.log('\n')
