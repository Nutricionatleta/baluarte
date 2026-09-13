import fs from 'fs'
const p = 'src/sim/combat.js'
let s = fs.readFileSync(p, 'utf8')
let n = 0
const rep = (a, b) => { if (!s.includes(a)) { console.error('NO ENCONTRADO:\n' + a.slice(0, 70)); process.exitCode = 1; return } s = s.replace(a, b); n++ }

// plural de verdad: "Espadachíns" no lo dice nadie
rep(`const plural = (n, sing, pl) => \`\${n} \${n === 1 ? sing : pl}\``,
`const plural = (n, sing, pl) => \`\${n} \${n === 1 ? sing : pl}\`

/** Plural en condiciones: Lancero->Lanceros, Espadachín->Espadachines, Juez->Jueces. */
function pluralNombre (nombre) {
  const fin = nombre.slice(-1).toLowerCase()
  if ('aeiou'.includes(fin)) return nombre + 's'
  if (fin === 'z') return nombre.slice(0, -1) + 'ces'
  const tildes = 'áéíóú'; const llanas = 'aeiou'
  return nombre.replace(/[áéíóú]([^áéíóú]*)$/, (m, resto) => llanas[tildes.indexOf(m[0])] + resto) + 'es'
}`)

rep("          const detalle = tipos.map(k => plural(bajasVentana[k], defUnidad(k)?.nombre || k, `${defUnidad(k)?.nombre || k}s`)).join(' y ')",
  "          const detalle = tipos.map(k => { const nom = defUnidad(k)?.nombre || k; return plural(bajasVentana[k], nom, pluralNombre(nom)) }).join(' y ')")

// los hitos: sin reservar un array en cada uno de los 900 pasos
rep(`    // hitos de destrucción: es lo que le dice al jugador si va bien o mal
    const pct = (valorCaido / esc.valorTotal) * 100
    while (hitos < 3 && pct >= [25, 50, 75][hitos]) {
      const h = [25, 50, 75][hitos++]`,
`    // hitos de destrucción: es lo que le dice al jugador si va bien o mal
    const pct = (valorCaido / esc.valorTotal) * 100
    while (hitos < 3 && pct >= HITOS[hitos]) {
      const h = HITOS[hitos++]`)

rep(`const plural = (n, sing, pl)`, `const HITOS = [25, 50, 75]\n\nconst plural = (n, sing, pl)`)

// rematar no usa rng
rep(`function rematar ({ esc, sucesos, bajas, t, valorCaido, principalCaido, unidades, base, rng, ladoEntrada, semilla, añadir }) {`,
`function rematar ({ esc, sucesos, bajas, t, valorCaido, principalCaido, unidades, base, ladoEntrada, semilla, añadir }) {`)
s = s.split('unidades, base, rng, ladoEntrada, semilla: sem').join('unidades, base, ladoEntrada, semilla: sem')

fs.writeFileSync(p, s)
console.log('parches:', n)
