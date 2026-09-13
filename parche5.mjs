import fs from 'fs'
const p = 'src/sim/combat.js'
let s = fs.readFileSync(p, 'utf8')
let n = 0
const rep = (a, b) => { if (!s.includes(a)) { console.error('NO ENCONTRADO:\n' + a.slice(0, 80)); process.exitCode = 1; return } s = s.replace(a, b); n++ }

rep(`  const defendida = r.estrellas === 0
  const perdidas = defendida ? { madera: 0, piedra: 0, comida: 0, oro: 0 } : r.botin
  const daños = r.restos.filter(e => e.hp < (s.buildings.find(b => b.id === e.id)?.hp ?? Infinity))
    .map(e => ({ id: e.id, hp: e.vivo ? e.hp : 1, destruido: !e.vivo }))`,
`  const defendida = r.estrellas === 0
  // Las gemas no se saquean: se ganan jugando y punto.
  const perdidas = defendida
    ? { madera: 0, piedra: 0, comida: 0, oro: 0 }
    : { madera: r.botin.madera, piedra: r.botin.piedra, comida: r.botin.comida, oro: r.botin.oro }
  const porId = new Map(s.buildings.map(b => [b.id, b]))
  const daños = []
  for (const e of r.restos) {
    const b = porId.get(e.id)
    if (!b) continue
    // Un edificio arrasado NO desaparece de tu aldea: queda en los huesos y se repara.
    const hp = e.vivo ? Math.round(e.hp) : 1
    const antes = b.hp ?? hp
    if (hp < antes) daños.push({ id: e.id, hp, dano: Math.round(antes - hp), destruido: !e.vivo })
  }`)

rep(`  if (!defendida) {
    saquear(perdidas)
    // Los edificios NUNCA quedan a cero en defensa: se quedan tocados y se reparan.
    events.emit(EV.BUILDINGS_DAMAGED, { daños })`,
`  if (!defendida) {
    saquear(perdidas)
    aplicarDaños(daños)`)

rep(`  } else {
    events.emit(EV.BUILDINGS_DAMAGED, { daños })
    events.emit(EV.UI_TOAST, { texto: '¡Tu defensa ha aguantado el asalto!', tipo: 'bien' })`,
`  } else {
    aplicarDaños(daños)
    events.emit(EV.UI_TOAST, { texto: '¡Tu defensa ha aguantado el asalto!', tipo: 'bien' })`)

rep(`const HORAS_ESCUDO = 4`,
`const HORAS_ESCUDO = 4

/**
 * Deja la aldea tocada. Se avisa por el bus (sim/buildings tiene su \`dañar\`) y,
 * si nadie lo ha recogido, se aplica aquí: perder un asalto TIENE que doler.
 */
function aplicarDaños (daños) {
  if (!daños.length) return
  events.emit(EV.BUILDINGS_DAMAGED, { daños })
  for (const d of daños) {
    const b = game.state.buildings.find(x => x.id === d.id)
    if (b && (b.hp ?? Infinity) > d.hp) b.hp = d.hp   // idempotente: si ya bajó, no toca nada
  }
}`)

fs.writeFileSync(p, s)
console.log('parches:', n)
