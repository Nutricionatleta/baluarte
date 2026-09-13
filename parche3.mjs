import fs from 'fs'
const p = 'src/sim/combat.js'
let s = fs.readFileSync(p, 'utf8')
let n = 0
const rep = (a, b) => { if (!s.includes(a)) { console.error('NO ENCONTRADO:\n' + a.slice(0, 80)); process.exitCode = 1; return } s = s.replace(a, b); n++ }

rep(`      valor, vivo: true, golpeado: false,`,
`      valor, vivo: true, golpeado: false,
      // Los muros NO cuentan en el porcentaje arrasado: si contaran, tirar cien
      // tramos de piedra daría estrellas sin haber tocado la aldea de verdad.
      cuenta: !MUROS.has(b.tipo),`)

rep(`    valorTotal += valor
    edificios.push(e)`,
`    if (e.cuenta) valorTotal += valor
    edificios.push(e)`)

rep(`            obj.vivo = false
            edificiosVivos--
            valorCaido += obj.valor`,
`            obj.vivo = false
            edificiosVivos--
            if (obj.cuenta) valorCaido += obj.valor`)

// el contador de "edificios que quedan en pie" tampoco debe hablar de muros
rep(`  let edificiosVivos = esc.edificios.length`, `  let edificiosVivos = esc.edificios.length
  let enPie = esc.edificios.filter(e => e.cuenta).length`)
rep(`            obj.vivo = false
            edificiosVivos--`, `            obj.vivo = false
            edificiosVivos--
            if (obj.cuenta) enPie--`)
rep(`añadir('inicio', \`La hueste entra por el \${ladoEntrada}: \${plural(vivas, 'unidad', 'unidades')} contra \${plural(edificiosVivos, 'edificio', 'edificios')}\``,
`añadir('inicio', \`La hueste entra por el \${ladoEntrada}: \${plural(vivas, 'unidad', 'unidades')} contra \${plural(enPie, 'edificio', 'edificios')}\``)
rep(`    añadir('tiempo', frase('aguanta', { n: plural(edificiosVivos, 'edificio', 'edificios') })`,
`    añadir('tiempo', frase('aguanta', { n: plural(enPie, 'edificio', 'edificios') })`)
rep(`    if (!vivas || !edificiosVivos) break`, `    if (!vivas || !enPie) break`)
rep(`  if (!vivas || !edificiosVivos) {`, `  if (!vivas || !enPie) {`)
rep(`  if (vivas > 0 && edificiosVivos > 0) {`, `  if (vivas > 0 && enPie > 0) {`)

fs.writeFileSync(p, s)
console.log('parches:', n)
