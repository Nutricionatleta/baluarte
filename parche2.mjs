import fs from 'fs'
const p = 'src/sim/combat.js'
let s = fs.readFileSync(p, 'utf8')
let n = 0
const rep = (a, b) => { if (!s.includes(a)) { console.error('NO ENCONTRADO:\n' + a.slice(0, 80)); process.exitCode = 1; return } s = s.replace(a, b); n++ }

// Búferes compartidos: reservar un Int16Array por cada muerte de edificio era lo
// que se comía el presupuesto de 50 ms. Se reservan una vez y se reutilizan.
rep(`/** Mapa de estorbos: 1 = casilla ocupada por edificio vivo (no se atraviesa). */
function mapaBloqueo (esc) {
  const m = new Uint8Array(G * G)`,
`const COLA_BFS = new Int32Array(G * G)

/** Mapa de estorbos: 1 = casilla ocupada por edificio vivo (no se atraviesa). */
function mapaBloqueo (esc) {
  const m = esc.mapa || new Uint8Array(G * G)
  m.fill(0)`)

rep(`  const cache = esc.campos
  const guardado = cache.get(objetivo.id)
  if (guardado && guardado.version === esc.versionMapa) return guardado.campo
  const campo = new Int16Array(G * G).fill(-1)
  const cola = new Int32Array(G * G)
  let cabeza = 0; let cola_ = 0`,
`  const cache = esc.campos
  const guardado = cache.get(objetivo.id)
  if (guardado && guardado.version === esc.versionMapa) return guardado.campo
  // Un campo caducado sigue valiendo: al caer un muro solo se ABREN caminos, así que
  // como mucho la tropa tarda un instante en enterarse de la brecha. Rehacerlo cada
  // vez costaría más de lo que arregla.
  if (guardado && esc.t - guardado.t < 1) return guardado.campo
  const campo = guardado ? guardado.campo : new Int16Array(G * G)
  campo.fill(-1)
  const cola = COLA_BFS
  let cabeza = 0; let cola_ = 0`)

rep(`  cache.set(objetivo.id, { version: esc.versionMapa, campo })
  return campo`,
`  cache.set(objetivo.id, { version: esc.versionMapa, t: esc.t, campo })
  return campo`)

rep(`  esc.campos = new Map()
  esc.versionMapa = 0
  esc.mapa = mapaBloqueo(esc)`,
`  esc.campos = new Map()
  esc.versionMapa = 0
  esc.t = 0
  esc.mapa = mapaBloqueo(esc)`)

rep(`  for (let k = 0; k < MAX_DURACION / PASO; k++) {
    t = (k + 1) * PASO`,
`  for (let k = 0; k < MAX_DURACION / PASO; k++) {
    t = (k + 1) * PASO
    esc.t = t`)

fs.writeFileSync(p, s)
console.log('parches:', n)
