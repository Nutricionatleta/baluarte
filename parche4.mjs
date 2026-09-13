import fs from 'fs'
const p = 'src/sim/combat.js'
let s = fs.readFileSync(p, 'utf8')
let n = 0
const rep = (a, b) => { if (!s.includes(a)) { console.error('NO ENCONTRADO:\n' + a.slice(0, 80)); process.exitCode = 1; return } s = s.replace(a, b); n++ }

// 1) army.estadisticasUnidad no trae nombre ni icono: se completan con el catálogo
rep(`  if (conBonos && modArmy && typeof modArmy.estadisticasUnidad === 'function') {
    try {
      const s = modArmy.estadisticasUnidad(tipo)
      if (s && s.hp) return s
    } catch { /* si army.js cambia de forma, seguimos con el catálogo */ }
  }
  const u = defUnidad(tipo)
  if (!u) return null`,
`  const base = defUnidad(tipo)
  if (!base) return null
  if (conBonos && modArmy && typeof modArmy.estadisticasUnidad === 'function') {
    try {
      const s = modArmy.estadisticasUnidad(tipo)
      // army manda en ataque/armadura (herrería, tecnologías y hambre); el nombre
      // y el icono los pone el catálogo, que es de donde se narra la crónica.
      if (s && s.hp) return { ...base, ...s }
    } catch { /* si army.js cambia de forma, seguimos con el catálogo */ }
  }
  const u = base`)

// 2) el banco: resources.ingresar es (tipo, cantidad); lo que vale es ingresarVarios
rep(`function ingresar (botin) {
  if (!botin) return
  const api = modRes && (modRes.ingresar || modRes.añadir || modRes.anadir || modRes.ganar || modRes.depositar)
  if (typeof api === 'function') {
    try { api({ madera: botin.madera, piedra: botin.piedra, comida: botin.comida, oro: botin.oro }, 'botin') } catch { /* seguimos a mano */ }
  } else {`,
`function ingresar (botin) {
  if (!botin) return
  if (modRes && typeof modRes.ingresarVarios === 'function') {
    modRes.ingresarVarios({ madera: botin.madera, piedra: botin.piedra, comida: botin.comida, oro: botin.oro }, null)
    if (botin.gemas && typeof modRes.gemas === 'function') { modRes.gemas(botin.gemas, 'botín de guerra'); return }
  } else {`)

rep(`    events.emit(EV.RESOURCES_CHANGED, { resources: s.recursos })
  }
  if (botin.gemas) game.state.jugador.gemas = (game.state.jugador.gemas || 0) + botin.gemas
}`,
`    events.emit(EV.RESOURCES_CHANGED, { resources: s.recursos })
  }
  if (botin.gemas) game.state.jugador.gemas = (game.state.jugador.gemas || 0) + botin.gemas
}

/** Cobra el saqueo que te han hecho. Si resources.js está, que lo apunte él. */
function saquear (perdidas) {
  if (modRes && typeof modRes.pagar === 'function' && modRes.pagar(perdidas, 'saqueo')) return
  const s = game.state
  for (const r of CONFIG.RECURSOS) s.recursos[r] = Math.max(0, (s.recursos[r] || 0) - (perdidas[r] || 0))
  events.emit(EV.RESOURCES_CHANGED, { resources: s.recursos })
}`)

// 3) army.perderTropas YA cura con el monasterio: no curar dos veces
rep(`  if (modArmy && typeof modArmy.perderTropas === 'function') {
    try { modArmy.perderTropas(bajas); return } catch { /* a mano */ }
  }
  const tropas = game.state.ejercito.tropas
  for (const tipo in bajas) tropas[tipo] = Math.max(0, (tropas[tipo] || 0) - bajas[tipo])
}`,
`  if (modArmy && typeof modArmy.perderTropas === 'function') {
    // Ojo: army.js ya devuelve a casa a los heridos del monasterio. Curar aquí
    // otra vez sería regalar tropa, así que este camino NO pasa por curarBajas().
    try { return modArmy.perderTropas(bajas) } catch { /* a mano */ }
  }
  const tropas = game.state.ejercito.tropas
  for (const tipo in bajas) tropas[tipo] = Math.max(0, (tropas[tipo] || 0) - bajas[tipo])
  return null
}`)

rep(`  const resultado = simularAsalto({ base, tropas: enviadas, ladoEntrada, semilla, propias: true })
  const rng = makeRng((resultado.semilla ^ 0x9e3779b9) >>> 0)
  const salvados = curarBajas(resultado.bajas, rng)
  if (salvados) {
    resultado.sucesos.push({ t: resultado.duracion + 0.4, tipo: 'monjes', texto: \`Los monjes devuelven al mundo a \${plural(salvados, 'herido', 'heridos')}\`, x: 0, z: 0 })
  }
  aplicarBajas(resultado.bajas)
  ingresar(resultado.botin)`,
`  const resultado = simularAsalto({ base, tropas: enviadas, ladoEntrada, semilla, propias: true })
  // Las bajas de la crónica son las que caen en el campo; cuántas vuelven a casa
  // lo decide el monasterio (army.js si está, y si no, aquí mismo).
  let salvados = 0
  const parte = aplicarBajas(resultado.bajas)
  if (parte && parte.curadas) salvados = Object.values(parte.curadas).reduce((a, b) => a + b, 0)
  else salvados = curarBajas(resultado.bajas, makeRng((resultado.semilla ^ 0x9e3779b9) >>> 0))
  if (salvados) {
    resultado.sucesos.push({ t: resultado.duracion + 0.4, tipo: 'monjes', texto: \`Los monjes devuelven al mundo a \${plural(salvados, 'herido', 'heridos')}\`, x: 0, z: 0 })
    resultado.curadas = parte?.curadas || null
  }
  ingresar(resultado.botin)`)

// curarBajas solo vale ya como red de seguridad sin army.js
rep(`/** El monasterio devuelve a casa parte de los caídos. Suaviza la derrota, no la borra. */`,
`/** Red de seguridad si army.js no está: el monasterio devuelve a casa parte de los
 *  caídos. Suaviza la derrota, no la borra. Con army.js cargado NO se usa. */`)
rep(`function curarBajas (bajas, rng) {
  const nivel = nivelDe(game.state.buildings || [], 'monasterio')`,
`function curarBajas (bajas, rng) {
  if (modArmy) return 0
  const nivel = nivelDe(game.state.buildings || [], 'monasterio')`)

// 4) el saqueo de la defensa, por el banco
rep(`    for (const rec of CONFIG.RECURSOS) s.recursos[rec] = Math.max(0, (s.recursos[rec] || 0) - (perdidas[rec] || 0))
    events.emit(EV.RESOURCES_CHANGED, { resources: s.recursos })`,
`    saquear(perdidas)`)

fs.writeFileSync(p, s)
console.log('parches:', n)
