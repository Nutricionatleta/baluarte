import fs from 'fs'
const p = 'src/sim/combat.js'
let s = fs.readFileSync(p, 'utf8')
let n = 0
const rep = (a, b) => { if (!s.includes(a)) { console.error('NO ENCONTRADO:\n' + a.slice(0, 90)); process.exitCode = 1; return } s = s.replace(a, b); n++ }

rep(`  const dz = Math.max(e.z - z, 0, z - (e.z + e.alto - 1))
  return Math.hypot(dx, dz)`,
`  const dz = Math.max(e.z - z, 0, z - (e.z + e.alto - 1))
  // sqrt a pelo y no Math.hypot: esto se llama decenas de miles de veces por batalla
  return Math.sqrt(dx * dx + dz * dz)`)

rep(`  return { edificios, valorTotal: valorTotal || 1, principal, centro, torres: edificios.filter(e => e.dano > 0) }`,
`  return {
    edificios, valorTotal: valorTotal || 1, principal, centro,
    torres: edificios.filter(e => e.dano > 0),
    vivos: edificios.slice(),          // lista cacheada; se rehace solo cuando cae algo
    muros: edificios.filter(e => e.bloquea)
  }`)

rep(`  for (const e of esc.edificios) {
    if (!e.vivo) continue
    for (let z = e.z; z < e.z + e.alto; z++) {`,
`  for (const e of esc.vivos) {
    for (let z = e.z; z < e.z + e.alto; z++) {`)

rep(`  for (const e of esc.edificios) {
    if (!e.vivo) continue
    const d = distAEdificio(u.x, u.z, e)
    let peso = 1`,
`  for (const e of esc.vivos) {
    const d = distAEdificio(u.x, u.z, e)
    let peso = 1`)

rep(`  for (const e of esc.edificios) {
    if (!e.vivo || !e.bloquea) continue
    const d = distAEdificio(u.x, u.z, e)
    if (d < mejorD) { mejorD = d; mejor = e }`,
`  for (const e of esc.muros) {
    if (!e.vivo) continue
    // un muro ya empezado tira más que uno intacto: así la hueste concentra los
    // golpes en un punto y abre brecha, en vez de arañar veinte tramos a la vez
    const d = distAEdificio(u.x, u.z, e) - (e.golpeado ? 3 : 0)
    if (d < mejorD) { mejorD = d; mejor = e }`)

rep(`      for (const u of unidades) {
        if (!u.viva) continue
        const d = distAEdificio(u.x, u.z, torre)`,
`      for (const u of vivasLista) {
        if (!u.viva) continue
        const d = distAEdificio(u.x, u.z, torre)`)

rep(`    // --- la tropa avanza y pega ---
    for (const u of unidades) {`,
`    // --- la tropa avanza y pega ---
    for (const u of vivasLista) {`)

rep(`  const bajasVentana = {}           // muertes agrupadas por segundo, para no spamear
  let ventana = 0`,
`  const bajasVentana = {}           // muertes agrupadas por segundo, para no spamear
  let ventana = 0
  let vivasLista = unidades         // se poda de muertos cada pocos pasos
  let ultimoMuro = -99              // para no narrar veinte veces el mismo muro`)

rep(`      u.revisar = 1.5`, `      u.revisar = 2.5`)

rep(`    // agrupar bajas del segundo para la crónica
    ventana += PASO`,
`    if ((k & 7) === 7 && vivasLista.length > vivas) vivasLista = vivasLista.filter(u => u.viva)

    // agrupar bajas del segundo para la crónica
    ventana += PASO`)

rep(`            valorCaido += obj.valor
            esc.versionMapa++`,
`            valorCaido += obj.valor
            esc.vivos = esc.vivos.filter(e => e.vivo)
            esc.versionMapa++`)

rep(`          if (!obj.golpeado) {
            obj.golpeado = true
            if (obj.tipo === 'puerta') añadir('muro', \`\${u.nombre} \${frase('puerta', { lado: ladoDe(obj.cx, obj.cz, esc.centro) })}\`, obj.cx, obj.cz, { edificioId: obj.id })
            else if (obj.esMuro) añadir('muro', \`\${u.nombre} \${frase('muro', { lado: ladoDe(obj.cx, obj.cz, esc.centro) })}\`, obj.cx, obj.cz, { edificioId: obj.id })
          }`,
`          if (!obj.golpeado) {
            obj.golpeado = true
            if (obj.esMuro && t - ultimoMuro >= 8) {
              ultimoMuro = t
              const clave = obj.tipo === 'puerta' ? 'puerta' : 'muro'
              añadir('muro', \`\${u.nombre} \${frase(clave, { lado: ladoDe(obj.cx, obj.cz, esc.centro) })}\`, obj.cx, obj.cz, { edificioId: obj.id })
            }
          }`)

rep(`        if (torre.siega === 1 || torre.siega % 3 === 0) {
          añadir('siega', frase('siega', { torre: torre.nombre, n: plural(torre.siega, 'baja', 'bajas') }), torre.cx, torre.cz, { torreId: torre.id, unidad: presa.tipo })
        }`,
`        if (torre.siega === 1 || torre.siega % 3 === 0) {
          const texto = torre.siega === 1
            ? \`\${torre.nombre} abate a \${presa.nombre.toLowerCase()}\`
            : frase('siega', { torre: torre.nombre, n: plural(torre.siega, 'baja', 'bajas') })
          añadir('siega', texto, torre.cx, torre.cz, { torreId: torre.id, unidad: presa.tipo })
        }`)

rep(`  const muros = esc.edificios.filter(e => e.bloquea)`,
`  // La puerta cuenta como cerco: \`bloquea:false\` es para que pasen los tuyos,
  // pero un asaltante tiene que echarla abajo igual que un tramo de muralla.
  const muros = esc.edificios.filter(e => e.esMuro)`)

rep("  for (const d of fueraValiosos) resultado.consejos.push(`Tienes ${d.nombre.toLowerCase()} ${d.motivo}.`)",
  "  for (const d of fueraValiosos) resultado.consejos.push(`${d.nombre}: ${d.motivo}.`)")

fs.writeFileSync(p, s)
console.log('parches aplicados:', n)
