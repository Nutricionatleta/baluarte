/**
 * PRUEBA DE FLANCOS — ¿importa de verdad dónde plantas tus escuadrones?
 *
 * Monta la MISMA aldea, la MISMA tropa y el MISMO asedio (misma semilla, mismo
 * lado de entrada) y solo cambia una cosa: si la hueste está plantada al NORTE
 * (por donde entran) o al SUR (en la otra punta). Se borra solo.
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const AQUI = 'D:/APLICACIONES/juego-baluarte/scripts'
const RAIZ = path.resolve(AQUI, '..')

const almacen = new Map()
globalThis.localStorage = {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => { almacen.set(k, String(v)) },
  removeItem: (k) => { almacen.delete(k) }, clear: () => almacen.clear(), get length () { return almacen.size }
}
globalThis.document = { addEventListener () {}, removeEventListener () {}, hidden: false, getElementById: () => null }
globalThis.window = { addEventListener () {}, removeEventListener () {} }
globalThis.performance = { now: () => Date.now() }

const PARCHE = path.join(AQUI, '_combat-flancos.generado.mjs')
const src = readFileSync(path.join(RAIZ, 'src/sim/combat.js'), 'utf8')
writeFileSync(PARCHE, src
  .replace(/from '\.\.\/core\//g, "from '../src/core/")
  .replace(/from '\.\.\/data\//g, "from '../src/data/")
  .replace(/MODULOS = import\.meta\.glob\('\.\/\{army,resources\}\.js'\)/,
    "MODULOS = { './army.js': () => import('../src/sim/army.js'), './resources.js': () => import('../src/sim/resources.js') }"))

try {
  const { game } = await import('../src/core/state.js')
  const { nuevaPartida } = await import('../src/core/state.js')
  const Ejercito = await import('../src/sim/army.js')
  const Combate = await import(pathToFileURL(PARCHE).href)
  const { def } = await import('../src/data/buildings.js')

  await Combate.init()
  Ejercito.init()

  // --- una aldea de verdad: ayuntamiento, casas, granero y un par de torres ---
  const C = 30
  let n = 0
  const poner = (tipo, x, z, nivel = 3) => {
    const d = def(tipo)
    game.state.buildings.push({
      id: `b${++n}`, tipo, nivel, x, z, rot: 0,
      ancho: d.ancho || 1, alto: d.alto || 1, hp: d.hp(nivel), hpMax: d.hp(nivel), enObra: false, trabajadores: []
    })
  }

  function montarAldea () {
    game.state.buildings.length = 0
    n = 0
    poner('ayuntamiento', C - 2, C - 2, 4)
    poner('cuartel', C + 3, C, 3)
    poner('granero', C - 5, C, 3)
    poner('almacen', C + 4, C - 5, 3)
    poner('casa', C - 6, C - 6, 3)
    poner('casa', C + 5, C + 4, 3)
    poner('granja', C - 7, C + 4, 2)
    poner('serreria', C + 6, C - 8, 2)
    poner('torre_vigia', C - 1, C - 8, 3)     // una torre al norte
    poner('torre_vigia', C - 1, C + 7, 3)     // otra al sur
  }

  const TROPA = { lancero: 14, espadachin: 8, arquero: 8 }
  const ATACAN = { lancero: 24, espadachin: 13, arquero: 11 }
  const SEMILLA = 424242

  /** Planta TODA la hueste en un flanco y resuelve el mismo asedio. */
  function probar (flanco) {
    montarAldea()
    game.state.escudo = null
    game.state.recursos = { madera: 4000, piedra: 4000, comida: 4000, oro: 1500 }
    game.state.ejercito = { tropas: { ...TROPA }, cola: [], fuera: {}, heridos: {}, curacion: { inicio: 0, fin: 0 }, reunion: null, escuadrones: [] }

    // un único escuadrón de defensa, plantado en el flanco que toca
    const destino = flanco === 'norte' ? { x: C - 1, z: C - 6 } : { x: C - 1, z: C + 5 }
    const lista = Ejercito.escuadrones()
    const id = lista[0].id
    Ejercito.renombrarEscuadron(id, flanco === 'norte' ? 'La Hueste del Norte' : 'La Guardia del Sur')
    Ejercito.fijarPuestoEscuadron(id, destino.x, destino.z)
    const puesto = Ejercito.escuadrones()[0]

    const r = Combate.simularDefensa({
      atacante: { nombre: 'Don Vela el Negro', lado: 'norte' },   // SIEMPRE entran por el norte
      tropasEnemigas: { ...ATACAN },
      semilla: SEMILLA
    })
    const esc = (r.escuadrones || [])[0] || {}
    return {
      flanco,
      puesto: `${puesto.puesto.x},${puesto.puesto.z} (${puesto.flanco})`,
      aguantó: r.victoria,
      pctArrasado: r.porcentajeDestruido,
      estrellas: r.estrellas,
      reaccionSeg: esc.reaccion,
      pelearon: esc.pelearon,
      misBajas: Object.values(r.bajasDefensa || {}).reduce((a, b) => a + b, 0),
      bajasEnemigas: Object.values(r.bajas || {}).reduce((a, b) => a + b, 0),
      parte: (r.parte && r.parte.resumen) || ''
    }
  }

  const norte = probar('norte')
  const sur = probar('sur')

  console.log('\n===== MISMO ASEDIO (entran por el NORTE), MISMA TROPA, MISMA SEMILLA =====')
  for (const x of [norte, sur]) {
    console.log(`\n--- tropa plantada al ${x.flanco.toUpperCase()} (${x.puesto}) ---`)
    console.log(`  aguantó la aldea : ${x.aguantó ? 'SÍ' : 'NO'}   (${x.estrellas} estrellas para el atacante)`)
    console.log(`  aldea arrasada   : ${x.pctArrasado} %`)
    console.log(`  tardaron en llegar: ${x.reaccionSeg} s   ·  entraron en combate: ${x.pelearon} de los tuyos`)
    console.log(`  bajas: tuyas ${x.misBajas} · enemigas ${x.bajasEnemigas}`)
    console.log(`  parte: ${x.parte}`)
  }
  console.log('\n>>> DIFERENCIA por colocar la tropa en un flanco u otro: ' +
    `${(sur.pctArrasado - norte.pctArrasado).toFixed(1)} puntos de aldea arrasada, ` +
    `${sur.misBajas - norte.misBajas} bajas propias de más, ` +
    `${norte.bajasEnemigas - sur.bajasEnemigas} enemigos menos abatidos.`)
} finally {
  if (existsSync(PARCHE)) { try { unlinkSync(PARCHE) } catch { /* da igual */ } }
}
