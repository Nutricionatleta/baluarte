/**
 * Bus de eventos global. Es la ÚNICA forma en que los módulos se hablan entre sí.
 * Nadie importa a nadie directamente: se emite un evento y quien quiera, escucha.
 */
const listeners = new Map()

export const events = {
  /** @param {string} type @param {(payload:any)=>void} fn @returns {()=>void} función para desuscribirse */
  on (type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type).add(fn)
    return () => listeners.get(type)?.delete(fn)
  },

  once (type, fn) {
    const off = events.on(type, (p) => { off(); fn(p) })
    return off
  },

  /** @param {string} type @param {any} [payload] */
  emit (type, payload) {
    const set = listeners.get(type)
    if (!set) return
    for (const fn of [...set]) {
      try { fn(payload) } catch (err) { console.error(`[events] fallo en "${type}"`, err) }
    }
  }
}

/**
 * Catálogo de eventos. Añade aquí los tuyos con un comentario del payload.
 * Convención: 'dominio:hecho' siempre en pasado o presente simple.
 */
export const EV = {
  // --- ciclo de vida ---
  TICK: 'tick',                          // { dt } segundos simulados desde el tick anterior
  STATE_LOADED: 'state:loaded',          // { state, offlineSeconds }
  STATE_SAVED: 'state:saved',            // { state }

  // --- recursos ---
  RESOURCES_CHANGED: 'res:changed',      // { resources }
  RESOURCE_GAINED: 'res:gained',         // { tipo, cantidad, x, z } para el "+5 madera" flotante
  RESOURCE_DENIED: 'res:denied',         // { falta: { madera: 20 } } no hay suficiente
  OFFLINE_RESUMEN: 'res:offline',        // { segundos, recursos:{madera:340}, textos:['🪵 340'] } lo producido con la app cerrada

  // --- construcción ---
  BUILD_REQUESTED: 'build:requested',    // { tipo, x, z, rot }
  BUILD_PLACED: 'build:placed',          // { building } colocado, empieza obra
  BUILD_COMPLETED: 'build:completed',    // { building } obra terminada
  BUILD_UPGRADED: 'build:upgraded',      // { building, nivelAnterior }
  BUILD_DEMOLISHED: 'build:demolished',  // { buildingId }
  BUILD_MODE: 'build:mode',              // { activo, tipo } entrar/salir del modo colocar
  BUILD_GHOST: 'build:ghost',            // { tipo, x, z, rot, ancho, alto, valido, motivo } dónde va el fantasma
  // Mover un edificio no tiene evento propio: se reutiliza BUILD_PLACED con la
  // marca { movido:true, desde }, que el render ya sabe leer para recolocar.

  // --- aldeanos ---
  VILLAGER_SPAWNED: 'vil:spawned',       // { villager }
  VILLAGER_ASSIGNED: 'vil:assigned',     // { villager, job, buildingId }
  VILLAGER_MOVED: 'vil:moved',           // { id, x, z } el render interpola, no teletransporta
  VILLAGER_CONSTRUYENDO: 'vil:construyendo', // { id, x, z, buildingId } martillazo en la obra: chispas y polvo

  // --- ejército y combate ---
  UNIT_TRAINED: 'unit:trained',          // { tipo, cantidad }
  RAID_STARTED: 'raid:started',          // { enemyBase, ejercito }
  RAID_RESOLVED: 'raid:resolved',        // { victoria, botin, bajas (los MUERTOS), heridos (nº), heridosTropas, caidos, log }
  ATTACK_INCOMING: 'attack:incoming',    // { enemigo, llegaEn }
  DEFENSE_RESOLVED: 'defense:resolved',  // { victoria, perdidas, log, heridos, heridosTropas, muertos }
  RAID_REQUESTED: 'raid:requested',      // { base, tropas, ladoEntrada, semilla } la UI pide asalto
  BATTLE_EVENT: 'battle:event',          // { suceso, resultado } cada paso de la crónica, en vivo
  BUILDINGS_DAMAGED: 'build:damaged',    // { daños:[{ id, hp, destruido }] } tras defender tu aldea
  SHIELD_STARTED: 'shield:started',      // { hasta, horas } escudo de protección tras una derrota
  DEFENSE_SCORED: 'defense:scored',      // { puntuacion, nota, consejos } lo fuerte que es tu aldea
  TROPAS_HERIDAS: 'tropa:heridas',       // { tropas:{lancero:3}, total, fin } vuelven malheridos: están en la enfermería del cuartel
  TROPAS_CURADAS: 'tropa:curadas',       // { tropas, total, motivo:'tiempo'|'recursos'|'gemas' } salen de la enfermería y vuelven a filas
  REUNION_CAMBIADA: 'tropa:reunion',     // { x, z, ajustado } el estandarte de batalla se mueve: el render recoloca la formación

  // --- mundo y exploración ---
  SCOUT_SENT: 'scout:sent',              // { expedicion }
  SCOUT_RETURNED: 'scout:returned',      // { expedicion, hallazgo }
  WORLD_REVEALED: 'world:revealed',      // { tiles }
  WORLD_EVENT: 'world:event',            // { tipo, x, y, texto, caduca } pasa algo ahí fuera: caravana, bandidos, hallazgo…

  // --- imperio (el mapa del mundo se conquista a manchas) ---
  PLAZA_CONQUISTADA: 'imperio:plaza',      // { x, y, plaza, color, señorPrevio, eraDe, total, produccion, texto } esa comarca ya es tuya: el mapa 3D la pinta de tu color
  PLAZA_PERDIDA: 'imperio:perdida',        // { x, y, plaza, señor, nombreSeñor, color, total, texto } te la han quitado: vuelve a la bandera del otro
  IMPERIO_CAMBIADO: 'imperio:cambiado',    // { motivo, color, plazas:[{x,y,nivel,nombre,estado}], rivales:[{x,y,señor,color}], colores:{'x,y':color}, resumen } repinta las banderas del mapa

  // --- territorio (el tablero crece por parcelas) ---
  TERRITORIO_DESBLOQUEADO: 'territorio:desbloqueado', // { parcela, motivo:'conquista'|'exploracion'|'edad'|'inicio', origen, rect, centro } ya es tuyo: se abre la linde y la cámara lo enseña
  TERRITORIO_DISPONIBLE: 'territorio:disponible',     // { parcela, motivo, origen, coste, rect, centro } hay una parcela esperando a que plantes la bandera
  TERRITORIO_RECLAMAR: 'territorio:reclamar',         // { parcela } la interfaz pide quedarse con una parcela disponible

  // --- progresión ---
  AGE_ADVANCED: 'age:advanced',          // { age, anterior }
  EDAD_VISUAL: 'age:visual',             // { age, anterior, nivelVisual:0..3, multiplicadorHp } la aldea prospera: paja -> teja -> pizarra
  TECH_RESEARCHED: 'tech:researched',    // { techId }
  QUEST_COMPLETED: 'quest:completed',    // { quest, recompensa }
  LEVEL_UP: 'player:levelup',            // { nivel }

  // --- interfaz ---
  UI_PANEL: 'ui:panel',                  // { panel, datos } abrir un panel; panel=null lo cierra
  UI_TOAST: 'ui:toast',                  // { texto, tipo: 'info'|'bien'|'mal' }
  UI_SELECT: 'ui:select',                // { kind:'building'|'villager'|'tile'|null, id }
  SFX: 'sfx',                            // { nombre } sonido puntual
  CAMERA_FOCUS: 'camera:focus',          // { x, z, zoom }

  // --- cámara y tablero (los emite render/scene.js) ---
  GRID_TAP: 'grid:tap',                  // { x, z, mundo:{x,z} } casilla tocada o barrida con el dedo
  VISTA_CAMBIADA: 'vista:cambiada'       // { vista:'aldea'|'mundo' } qué mapa se está mirando
}
