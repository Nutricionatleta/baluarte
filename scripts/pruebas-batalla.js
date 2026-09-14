/* Banco de pruebas de la batalla (solo desarrollo). Se carga desde la consola:
   await import('/scripts/pruebas-batalla.js')  */
import { ctx } from '/src/render/ctx.js'
import { simularAsalto } from '/src/sim/combat.js'

const base = () => {
  const bs = []
  let id = 1
  const add = (tipo, x, z, nivel = 3, rot = 0) => bs.push({ id: 'e' + (id++), tipo, nivel, x, z, rot, enObra: false })
  const x0 = 22; const x1 = 38; const z0 = 22; const z1 = 38
  for (let x = x0; x <= x1; x++) {
    for (const z of [z0, z1]) {
      if (x === 30) add('puerta', x, z, 3, z === z0 ? 0 : 2)
      else if (x !== 31) add('muralla', x, z, 4)
    }
  }
  for (let z = z0 + 1; z < z1; z++) {
    for (const x of [x0, x1]) {
      if (z === 30) add('puerta', x, z, 3, x === x0 ? 3 : 1)
      else if (z !== 31) add('muralla', x, z, 4)
    }
  }
  add('torre_vigia', x0 + 1, z0 + 1, 4); add('torre_vigia', x1 - 2, z0 + 1, 4)
  add('torre_ballesta', x0 + 1, z1 - 2, 3); add('torre_ballesta', x1 - 2, z1 - 2, 3)
  add('castillo', 29, 29, 3); add('ayuntamiento', 25, 26, 6)
  add('casa', 33, 25, 5); add('casa', 35, 25, 4); add('casa', 33, 28, 5)
  add('almacen', 25, 33, 5); add('granero', 28, 34, 4)
  add('cuartel', 34, 33, 4); add('herreria', 25, 30, 3)
  add('granja', 31, 34, 3); add('serreria', 35, 29, 3)
  add('pozo', 30, 27, 2); add('estandarte', 27, 32, 1)
  return bs
}

const TROPAS = { lancero: 30, espadachin: 18, arquero: 14, ballestero: 8, jinete: 10, ariete: 4, catapulta: 3 }
const POCAS = { lancero: 8, arquero: 4 }

function lanzar (o = {}) {
  if (o.calidad) window.baluarteCamara?.calidad(o.calidad)
  const b = { id: 'pruebas', nombre: 'Fuerte de pruebas', buildings: base(), guarnicion: { lancero: 8, arquero: 5 } }
  const tropas = o.tropas || (o.flojo ? POCAS : TROPAS)
  const r = simularAsalto({ base: b, tropas, ladoEntrada: o.lado || 'sur', semilla: o.semilla ?? 12345, propias: !o.defensa })
  window.baluarteBatalla.jugarBatalla({
    resultado: r, base: b, tropas, lado: o.lado || 'sur', guarnicion: b.guarnicion,
    esDefensa: !!o.defensa,
    titulo: o.defensa ? 'Los Lobos de Ceniza caen sobre tu aldea' : 'La hueste se pone en marcha…'
  })
  if (o.pausaEn != null) setTimeout(() => window.baluarteBatalla.pausar(true), o.pausaEn)
  return { duracion: r.duracion, estrellas: r.estrellas, pct: r.porcentajeDestruido, victoria: r.victoria }
}

function medir (seg = 5) {
  return new Promise(resolver => {
    window.__msAcum = 0; window.__msN = 0; window.__msMax = 0
    let frames = 0; let maxCalls = 0; let maxTris = 0
    const t0 = performance.now()
    const paso = () => {
      frames++
      const i = ctx.renderer.info.render
      if (i.calls > maxCalls) maxCalls = i.calls
      if (i.triangles > maxTris) maxTris = i.triangles
      if (performance.now() - t0 < seg * 1000) requestAnimationFrame(paso)
      else {
        resolver({
          fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1),
          calls: maxCalls, triangulos: maxTris,
          msJS: +(window.__msAcum / Math.max(1, window.__msN)).toFixed(2),
          msMax: +window.__msMax.toFixed(2)
        })
      }
    }
    requestAnimationFrame(paso)
  })
}

if (!window.__rafPatched) {
  window.__rafPatched = true
  const orig = window.requestAnimationFrame.bind(window)
  window.__msAcum = 0; window.__msN = 0; window.__msMax = 0
  window.requestAnimationFrame = function (cb) {
    return orig(function (t) {
      const a = performance.now()
      cb(t)
      const d = performance.now() - a
      window.__msAcum += d; window.__msN++
      if (d > window.__msMax) window.__msMax = d
    })
  }
}

window.P = { lanzar, medir, ctx, base, TROPAS }
export default window.P
