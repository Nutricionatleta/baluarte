import { events, EV } from './core/events.js'
import { cargar, autoguardado } from './core/save.js'
import { arrancarReloj } from './core/clock.js'
import { game } from './core/state.js'

/**
 * Arranque. Carga los módulos en orden y con tolerancia a fallos: si una pieza
 * concreta peta, el resto del juego sigue funcionando y el fallo sale por consola.
 */
const txt = document.getElementById('carga-txt')
const barra = document.getElementById('carga-barra')
const paso = (n, total, etiqueta) => {
  if (txt) txt.textContent = etiqueta
  if (barra) barra.style.width = `${Math.round((n / total) * 100)}%`
}

/**
 * Importa un módulo y ejecuta su init(). Nunca tira abajo el arranque.
 * `cargador` puede ser una función o una promesa ya en marcha: los módulos se
 * descargan y parsean TODOS a la vez (ahí se iba la mitad del tiempo de carga),
 * pero se inicializan en orden, que es lo que de verdad importa.
 */
async function usar (etiqueta, cargador, ...args) {
  try {
    const mod = await (typeof cargador === 'function' ? cargador() : cargador)
    if (typeof mod.init === 'function') await mod.init(...args)
    return mod
  } catch (err) {
    console.error(`[main] módulo "${etiqueta}" no disponible:`, err)
    return null
  }
}

/**
 * Arranca la descarga de todos los módulos de golpe. El navegador los va
 * trayendo en paralelo mientras nosotros los vamos inicializando uno a uno.
 */
function precargar () {
  const p = {
    resources: import('./sim/resources.js'),
    buildings: import('./sim/buildings.js'),
    villagers: import('./sim/villagers.js'),
    reparacion: import('./sim/reparacion.js'),
    army: import('./sim/army.js'),
    research: import('./sim/research.js'),
    combat: import('./sim/combat.js'),
    map: import('./world/map.js'),
    enemies: import('./world/enemies.js'),
    imperio: import('./world/imperio.js'),
    expeditions: import('./world/expeditions.js'),
    scene: import('./render/scene.js'),
    terrain: import('./render/terrain.js'),
    rbuildings: import('./render/buildings.js'),
    units: import('./render/units.js'),
    fx: import('./render/fx.js'),
    styles: import('./ui/styles.js'),
    quests: import('./sim/quests.js'),
    hud: import('./ui/hud.js'),
    buildPanel: import('./ui/build-panel.js'),
    editorAldea: import('./ui/editor-aldea.js'),
    armyPanel: import('./ui/army-panel.js'),
    worldPanel: import('./ui/world-panel.js'),
    questPanel: import('./ui/quest-panel.js'),
    audio: import('./ui/audio.js'),
    tutorial: import('./ui/tutorial.js')
  }
  // Un fallo de descarga no puede tumbar el arranque: cada módulo se gestiona
  // en su turno dentro de usar(), así que aquí solo silenciamos el rechazo suelto.
  for (const k of Object.keys(p)) p[k].catch(() => {})
  return p
}

async function arrancar () {
  // El orden importa: primero el mundo de datos, luego lo que se ve, y al final
  // la interfaz (que se apoya en todo lo anterior).
  const m = precargar()          // todas las descargas, ya en marcha

  const tareas = [
    ['Recordando tu partida…', async () => { const off = cargar(); return off }],

    // --- simulación: las reglas del juego ---
    ['Contando el grano…',     () => usar('sim/resources',    m.resources)],
    ['Repartiendo faena…',     () => usar('sim/buildings',    m.buildings)],
    ['Llamando a la gente…',   () => usar('sim/villagers',    m.villagers)],
    ['Levantando ruinas…',     () => usar('sim/reparacion',   m.reparacion)],
    ['Afilando espadas…',      () => usar('sim/army',         m.army)],
    ['Estudiando el arte…',    () => usar('sim/research',     m.research)],
    ['Preparando la batalla…', () => usar('sim/combat',       m.combat)],

    // --- el mundo de ahí fuera ---
    ['Trazando el mapa…',      () => usar('world/map',        m.map)],
    ['Avistando enemigos…',    () => usar('world/enemies',    m.enemies)],
    ['Contando comarcas…',     () => usar('world/imperio',    m.imperio)],
    ['Ensillando monturas…',   () => usar('world/expeditions',m.expeditions)],

    // --- lo que se ve ---
    ['Dibujando el valle…',    () => usar('render/scene',     m.scene)],
    ['Sembrando el terreno…',  () => usar('render/terrain',   m.terrain)],
    ['Levantando muros…',      () => usar('render/buildings', m.rbuildings)],
    ['Despertando aldeanos…',  () => usar('render/units',     m.units)],
    ['Encendiendo el sol…',    () => usar('render/fx',        m.fx)],
    ['Trazando el campo…',     () => usar('render/battle',    () => import('./render/battle.js'))],

    // --- interfaz: styles.js va primero, los paneles usan sus componentes ---
    ['Cortando pergamino…',    () => usar('ui/styles',        m.styles)],
    ['Escribiendo encargos…',  () => usar('sim/quests',       m.quests)],
    ['Colgando estandartes…',  () => usar('ui/hud',           m.hud)],
    ['Abriendo el taller…',    () => usar('ui/build-panel',   m.buildPanel)],
    ['Desplegando el plano…',  () => usar('ui/editor-aldea',  m.editorAldea)],
    ['Formando la tropa…',     () => usar('ui/army-panel',    m.armyPanel)],
    ['Desplegando el mapa…',   () => usar('ui/world-panel',   m.worldPanel)],
    ['Sellando encargos…',     () => usar('ui/quest-panel',   m.questPanel)],
    ['Templando instrumentos…',() => usar('ui/audio',         m.audio)],
    ['Llamando al mayordomo…', () => usar('ui/tutorial',      m.tutorial)]
  ]

  // El mapa del mundo en 3D se carga solo cuando el jugador sale de la aldea:
  // en móvil, cada milisegundo del arranque cuenta.
  let mapaMundoCargado = false
  events.on(EV.VISTA_CAMBIADA ?? 'vista:cambiada', async ({ vista } = {}) => {
    if (vista !== 'mundo' || mapaMundoCargado) return
    mapaMundoCargado = true
    await usar('render/worldmap', () => import('./render/worldmap.js'))
  })

  let offlineSeconds = 0
  for (let i = 0; i < tareas.length; i++) {
    const [etiqueta, fn] = tareas[i]
    paso(i, tareas.length, etiqueta)
    const r = await fn()
    if (i === 0) offlineSeconds = r || 0
    await new Promise(requestAnimationFrame)   // deja respirar al móvil entre pasos
  }

  paso(tareas.length, tareas.length, '¡A jugar!')
  arrancarReloj()
  autoguardado()

  // La cámara arranca mirando al centro del tablero, pero la aldea no está ahí:
  // se enfoca el ayuntamiento para que lo primero que veas sea tu pueblo.
  const centro = game.state.buildings.find(b => b.tipo === 'ayuntamiento') || game.state.buildings[0]
  if (centro) {
    events.emit(EV.CAMERA_FOCUS, {
      x: centro.x + ((centro.ancho ?? 2) - 1) / 2,
      z: centro.z + ((centro.alto ?? 2) - 1) / 2
    })
  }

  // avisa a quien quiera del tiempo que el jugador estuvo fuera (producción acumulada)
  if (offlineSeconds > 60) events.emit('offline:report', { seconds: offlineSeconds })

  const carga = document.getElementById('carga')
  if (carga) { carga.style.transition = 'opacity .5s'; carga.style.opacity = '0'; setTimeout(() => carga.remove(), 550) }

  window.baluarte = { game, events, EV }   // consola de depuración
  console.log('%cBaluarte listo', 'color:#ffc107;font-weight:bold')
}

arrancar()

// Registra la app instalable (PWA) sin romper nada si falla
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      // `updateViaCache: 'none'` obliga al navegador a comprobar el sw.js de
      // verdad en vez de usar su copia (que puede tener hasta 24 h).
      const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      reg.update().catch(() => {})

      // Cuando entra una versión nueva, se recarga UNA vez sola: si no, el
      // jugador se queda con la de ayer sin saber por qué.
      let recargando = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (recargando) return
        recargando = true
        location.reload()
      })
      // Y si ya hay una esperando su turno, que pase ya.
      if (reg.waiting) reg.waiting.postMessage('actualizar')
      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing
        if (!nuevo) return
        nuevo.addEventListener('statechange', () => {
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) nuevo.postMessage('actualizar')
        })
      })
    } catch { /* sin service worker el juego funciona igual, solo que sin offline */ }
  })
}
