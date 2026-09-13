import * as THREE from 'three'

/**
 * Contexto 3D compartido. `scene.js` lo rellena al arrancar y el resto de
 * módulos de render se cuelgan de aquí: es la única excepción a la regla de
 * "los módulos no se importan entre sí", porque todos necesitan la MISMA escena.
 */
export const ctx = {
  /** @type {THREE.Scene|null} */        scene: null,
  /** @type {THREE.PerspectiveCamera|null} */ camera: null,
  /** @type {THREE.WebGLRenderer|null} */ renderer: null,
  /** @type {THREE.Group|null} */        raizAldea: null,   // todo lo de la aldea cuelga de aquí
  /** @type {THREE.Group|null} */        raizMundo: null,   // la vista del mapa del mundo
  /** @type {THREE.DirectionalLight|null} */ sol: null,
  listo: false,
  /** Segundos desde que arrancó el juego, para animaciones continuas. */
  tiempo: 0,
  /** Nivel de detalle decidido según lo que aguante el móvil: 'bajo'|'medio'|'alto' */
  calidad: 'medio'
}

const esperando = []
const porFrame = new Set()

/** Llama a fn en cuanto la escena exista (o ya mismo si existe). */
export function cuandoListo (fn) {
  if (ctx.listo) { try { fn(ctx) } catch (e) { console.error('[ctx]', e) } }
  else esperando.push(fn)
}

/** Lo llama scene.js cuando la escena está montada. */
export function marcarListo () {
  ctx.listo = true
  for (const fn of esperando.splice(0)) {
    try { fn(ctx) } catch (e) { console.error('[ctx] al arrancar', e) }
  }
}

/**
 * Registra una función que se ejecuta en CADA frame: onFrame((dt, t) => {...}).
 * Para animaciones (humo, banderas, aldeanos caminando). Nunca para lógica de juego.
 * @returns {()=>void} para darse de baja
 */
export function onFrame (fn) {
  porFrame.add(fn)
  return () => porFrame.delete(fn)
}

/** Lo llama el bucle de render de scene.js. No lo llames desde otro sitio. */
export function pasarFrame (dt) {
  ctx.tiempo += dt
  for (const fn of porFrame) {
    try { fn(dt, ctx.tiempo) } catch (e) { console.error('[frame]', e) }
  }
}

/** Añade un objeto a la aldea (o a la escena si aún no hay raíz). */
export function aEscena (obj) {
  const padre = ctx.raizAldea || ctx.scene
  if (padre) padre.add(obj)
  else cuandoListo(() => (ctx.raizAldea || ctx.scene).add(obj))
  return obj
}

/** Quita un objeto y libera su memoria de la GPU. Importante en móvil. */
export function quitar (obj) {
  if (!obj) return
  obj.parent?.remove(obj)
  obj.traverse?.((o) => {
    if (o.geometry) o.geometry.dispose?.()
    // los materiales son compartidos (ver mats.js): NO se liberan aquí
  })
}
