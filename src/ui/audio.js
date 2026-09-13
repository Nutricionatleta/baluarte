/**
 * SONIDO DE BALUARTE — todo sintetizado con la Web Audio API.
 *
 * Ni un solo .mp3 ni .wav: osciladores, ruido, filtros y envolventes. Así el juego
 * no pesa más, no hay licencias que pagar y funciona sin red (requisito del proyecto).
 *
 * Este módulo NO se importa desde ningún sitio: escucha el bus de eventos y suena solo.
 * Fuera de eso expone `sfx()`, `setVolumen()` y `setAmbiente()` por comodidad de depuración.
 */
import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'

// ───────────────────────────────────────────────────────────── contexto de audio

let ctx = null
let maestro = null      // volumen global
let busSfx = null       // efectos
let busMusica = null    // música ambiente
let ruidoBuf = null     // ruido blanco reutilizado por todos los efectos

/** Volúmenes 0..1. Música baja por defecto: acompaña, no protagoniza. */
const VOL = { maestro: 0.9, sonido: 0.75, musica: 0.3 }

/** Tope de sonidos a la vez. Diez aldeanos recolectando no pueden sonar diez veces. */
const MAX_VOCES = 12
const REPE_MS = 60      // dos veces el mismo sonido en menos de esto = una sola
let voces = 0
const ultimaVez = new Map()

/**
 * El contexto se crea en el primer toque: los móviles bloquean el audio hasta que
 * hay una interacción real del usuario, y crearlo antes lo deja mudo para siempre.
 */
function crearContexto () {
  if (ctx) return ctx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  ctx = new AC({ latencyHint: 'interactive' })

  maestro = ctx.createGain()
  maestro.gain.value = VOL.maestro
  maestro.connect(ctx.destination)

  busSfx = ctx.createGain()
  busSfx.gain.value = VOL.sonido
  busSfx.connect(maestro)

  busMusica = ctx.createGain()
  busMusica.gain.value = 0            // entra siempre con fundido
  busMusica.connect(maestro)

  // Eco corto en vez de reverb: da aire de plaza de aldea por una milésima del coste.
  const eco = ctx.createDelay(0.6)
  eco.delayTime.value = 0.26
  const realim = ctx.createGain(); realim.gain.value = 0.24
  const suave = ctx.createBiquadFilter(); suave.type = 'lowpass'; suave.frequency.value = 1800
  const salidaEco = ctx.createGain(); salidaEco.gain.value = 0.3
  busMusica.connect(eco); eco.connect(suave); suave.connect(realim); realim.connect(eco)
  suave.connect(salidaEco); salidaEco.connect(maestro)

  // 2 s de ruido blanco en bucle: sirve para golpes, silbidos y derrumbes.
  const n = Math.floor(ctx.sampleRate * 2)
  ruidoBuf = ctx.createBuffer(1, n, ctx.sampleRate)
  const datos = ruidoBuf.getChannelData(0)
  for (let i = 0; i < n; i++) datos[i] = Math.random() * 2 - 1

  return ctx
}

function despertar () {
  const c = crearContexto()
  if (!c) return
  if (c.state !== 'running') c.resume().then(aplicarMusica).catch(() => {})
  else aplicarMusica()
}

// ───────────────────────────────────────────────────────────── ladrillos de síntesis

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

/** Envolvente: ataque lineal y caída exponencial, que es como se apaga el mundo real. */
function env (dest, t0, pico, ataque, caida) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.linearRampToValueAtTime(pico, t0 + ataque)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + ataque + caida)
  g.connect(dest)
  return g
}

/** Un oscilador con envolvente y, si se pide, barrido de tono y filtro propio. */
function tono (o) {
  const {
    tipo = 'sine', f, f2 = 0, t0, ataque = 0.006, caida = 0.25, pico = 0.2,
    dest = busSfx, detune = 0, filtroTipo = null, filtroF = 1200, filtroF2 = 0, q = 1
  } = o
  const osc = ctx.createOscillator()
  osc.type = tipo
  osc.frequency.setValueAtTime(Math.max(20, f), t0)
  if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + ataque + caida)
  if (detune) osc.detune.value = detune

  const g = env(dest, t0, pico, ataque, caida)
  if (filtroTipo) {
    const bq = ctx.createBiquadFilter()
    bq.type = filtroTipo
    bq.Q.value = q
    bq.frequency.setValueAtTime(Math.max(40, filtroF), t0)
    if (filtroF2) bq.frequency.exponentialRampToValueAtTime(Math.max(40, filtroF2), t0 + ataque + caida)
    osc.connect(bq); bq.connect(g)
  } else {
    osc.connect(g)
  }
  osc.start(t0)
  osc.stop(t0 + ataque + caida + 0.03)
  return osc
}

/** Ruido filtrado: golpes, roces, silbidos y derrumbes salen todos de aquí. */
function ruido (o) {
  const {
    t0, dur = 0.2, pico = 0.2, tipo = 'lowpass', f = 1000, f2 = 0, q = 1,
    dest = busSfx, ataque = 0.002
  } = o
  const s = ctx.createBufferSource()
  s.buffer = ruidoBuf
  s.loop = true
  s.playbackRate.value = 0.8 + Math.random() * 0.4   // que dos golpes nunca sean idénticos

  const bq = ctx.createBiquadFilter()
  bq.type = tipo
  bq.Q.value = q
  bq.frequency.setValueAtTime(Math.max(40, f), t0)
  if (f2) bq.frequency.exponentialRampToValueAtTime(Math.max(40, f2), t0 + dur)

  const g = env(dest, t0, pico, ataque, dur)
  s.connect(bq); bq.connect(g)
  s.start(t0, Math.random() * 1.5)    // entra por un punto cualquiera del buffer
  s.stop(t0 + dur + 0.05)
  return s
}

/** Cuerda pulsada: dos osciladores desafinados y un filtro que se cierra = laúd. */
function laud (f, t0, dur, pico, dest) {
  tono({ tipo: 'triangle', f, t0, ataque: 0.004, caida: dur, pico, dest, filtroTipo: 'lowpass', filtroF: f * 7 + 600, filtroF2: f * 2 + 200 })
  tono({ tipo: 'sawtooth', f, t0, ataque: 0.004, caida: dur * 0.6, pico: pico * 0.35, dest, detune: 7, filtroTipo: 'lowpass', filtroF: f * 5, filtroF2: f * 1.5 })
}

// ───────────────────────────────────────────────────────────── recetas de efectos

/**
 * Cada receta dibuja el sonido a partir del instante t0 y devuelve su duración
 * aproximada en segundos (la usamos para contar voces ocupadas).
 */
const RECETAS = {
  // clic de interfaz: corto, seco, con un punto de madera
  toque (t0) {
    tono({ tipo: 'square', f: 880, f2: 620, t0, ataque: 0.002, caida: 0.045, pico: 0.1, filtroTipo: 'lowpass', filtroF: 3000 })
    ruido({ t0, dur: 0.02, pico: 0.05, tipo: 'highpass', f: 2500 })
    return 0.08
  },

  // golpe de construcción: percusión de madera con cuerpo
  martillo (t0) {
    ruido({ t0, dur: 0.07, pico: 0.28, tipo: 'lowpass', f: 2200, f2: 500, q: 0.7 })
    tono({ tipo: 'triangle', f: 190, f2: 70, t0, ataque: 0.002, caida: 0.16, pico: 0.24 })
    tono({ tipo: 'sine', f: 420, f2: 150, t0, ataque: 0.001, caida: 0.08, pico: 0.12 })
    return 0.22
  },

  // obra terminada: campanita alegre de tres golpes
  obra_lista (t0) {
    const notas = [659.25, 830.61, 987.77]   // Mi5 · Sol#5 · Si5
    notas.forEach((f, i) => {
      const t = t0 + i * 0.11
      tono({ tipo: 'sine', f, t0: t, ataque: 0.004, caida: 0.55, pico: 0.16 })
      tono({ tipo: 'sine', f: f * 2.76, t0: t, ataque: 0.003, caida: 0.22, pico: 0.05 })  // parcial de campana
    })
    return 0.9
  },

  // oro recogido: tintineo de monedas cayendo
  monedas (t0) {
    for (let i = 0; i < 5; i++) {
      const f = 1700 + Math.random() * 1600
      tono({ tipo: 'triangle', f, f2: f * 0.85, t0: t0 + i * 0.035 + Math.random() * 0.02, ataque: 0.002, caida: 0.16, pico: 0.075 })
    }
    tono({ tipo: 'sine', f: 520, t0, ataque: 0.004, caida: 0.2, pico: 0.05 })
    return 0.4
  },

  // hacha en el tronco
  madera (t0) {
    ruido({ t0, dur: 0.05, pico: 0.2, tipo: 'bandpass', f: 1600, f2: 700, q: 1.4 })
    tono({ tipo: 'triangle', f: 300, f2: 130, t0, ataque: 0.002, caida: 0.13, pico: 0.2 })
    return 0.2
  },

  // pico contra la roca: agudo áspero y un golpe sordo
  piedra (t0) {
    ruido({ t0, dur: 0.09, pico: 0.22, tipo: 'highpass', f: 1800, q: 0.8 })
    ruido({ t0: t0 + 0.01, dur: 0.14, pico: 0.16, tipo: 'lowpass', f: 700, f2: 200 })
    tono({ tipo: 'square', f: 150, f2: 60, t0, ataque: 0.001, caida: 0.1, pico: 0.1, filtroTipo: 'lowpass', filtroF: 600 })
    return 0.25
  },

  // hoz entre el trigo: un roce suave, nada metálico
  comida (t0) {
    ruido({ t0, dur: 0.16, pico: 0.17, tipo: 'bandpass', f: 2600, f2: 1200, q: 0.9, ataque: 0.012 })
    tono({ tipo: 'sine', f: 340, f2: 220, t0, ataque: 0.01, caida: 0.14, pico: 0.06 })
    return 0.25
  },

  // ¡al ataque! cuerno grave, largo y con vibrato
  cuerno (t0) {
    const f = 116.54   // Si♭2
    // el vibrato del soplador: un LFO que mueve el afinado de todos los parciales
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2
    const prof = ctx.createGain(); prof.gain.value = 9
    lfo.connect(prof); lfo.start(t0); lfo.stop(t0 + 1.7)
    for (const [mult, pico, det] of [[1, 0.2, 0], [1.5, 0.1, 5], [2, 0.07, -6], [3, 0.035, 8]]) {
      const osc = tono({ tipo: 'sawtooth', f: f * mult, t0, ataque: 0.13, caida: 1.5, pico, detune: det, filtroTipo: 'lowpass', filtroF: 700, filtroF2: 1500, q: 0.7 })
      prof.connect(osc.detune)
    }
    return 1.7
  },

  // choque de metal: parciales inarmónicos, que es lo que hace que suene a acero
  espadas (t0) {
    for (const [f, pico] of [[2180, 0.1], [3310, 0.07], [4720, 0.05], [6130, 0.03]]) {
      tono({ tipo: 'square', f: f * (0.94 + Math.random() * 0.12), t0, ataque: 0.001, caida: 0.28 + Math.random() * 0.2, pico, filtroTipo: 'bandpass', filtroF: f, q: 9 })
    }
    ruido({ t0, dur: 0.1, pico: 0.16, tipo: 'highpass', f: 3200 })
    tono({ tipo: 'triangle', f: 260, f2: 120, t0, ataque: 0.001, caida: 0.09, pico: 0.09 })
    return 0.5
  },

  // flecha: silbido que pasa de largo
  flecha (t0) {
    ruido({ t0, dur: 0.3, pico: 0.16, tipo: 'bandpass', f: 1100, f2: 4200, q: 5, ataque: 0.05 })
    return 0.35
  },

  // derrumbe: ruido que cae de agudo a grave y se apaga
  derrumbe (t0) {
    ruido({ t0, dur: 0.9, pico: 0.3, tipo: 'lowpass', f: 2600, f2: 110, q: 1.2, ataque: 0.03 })
    tono({ tipo: 'sawtooth', f: 140, f2: 38, t0, ataque: 0.02, caida: 0.85, pico: 0.14, filtroTipo: 'lowpass', filtroF: 400 })
    return 1.0
  },

  // victoria: fanfarria corta de tres notas y acorde final
  victoria (t0) {
    const notas = [440, 554.37, 659.25]    // La4 · Do#5 · Mi5
    notas.forEach((f, i) => {
      const t = t0 + i * 0.14
      tono({ tipo: 'sawtooth', f, t0: t, ataque: 0.02, caida: 0.26, pico: 0.13, filtroTipo: 'lowpass', filtroF: 2400, filtroF2: 1400 })
      tono({ tipo: 'square', f: f * 2, t0: t, ataque: 0.02, caida: 0.2, pico: 0.04, filtroTipo: 'lowpass', filtroF: 3000 })
    })
    const tf = t0 + 0.45
    for (const f of [440, 659.25, 880]) {
      tono({ tipo: 'sawtooth', f, t0: tf, ataque: 0.03, caida: 0.9, pico: 0.1, filtroTipo: 'lowpass', filtroF: 2200, filtroF2: 900 })
    }
    return 1.45
  },

  // derrota: tres notas que caen, en menor y desafinándose
  derrota (t0) {
    const notas = [392, 349.23, 261.63]    // Sol4 · Fa4 · Do4
    notas.forEach((f, i) => {
      const t = t0 + i * 0.22
      tono({ tipo: 'sawtooth', f, f2: f * 0.97, t0: t, ataque: 0.03, caida: 0.5, pico: 0.13, filtroTipo: 'lowpass', filtroF: 1300, filtroF2: 500 })
    })
    tono({ tipo: 'triangle', f: 130.81, f2: 98, t0: t0 + 0.6, ataque: 0.05, caida: 1.1, pico: 0.12 })
    return 1.8
  },

  // subir de nivel: arpegio brillante que sube
  subir_nivel (t0) {
    const notas = [523.25, 659.25, 783.99, 1046.5, 1318.5]
    notas.forEach((f, i) => {
      const t = t0 + i * 0.075
      tono({ tipo: 'triangle', f, t0: t, ataque: 0.004, caida: 0.35, pico: 0.13 })
      tono({ tipo: 'sine', f: f * 2, t0: t, ataque: 0.004, caida: 0.15, pico: 0.04 })
    })
    return 0.8
  },

  // no puedes: zumbido corto y feo, pero sin agredir
  error (t0) {
    tono({ tipo: 'square', f: 150, f2: 96, t0, ataque: 0.004, caida: 0.16, pico: 0.13, filtroTipo: 'lowpass', filtroF: 900 })
    tono({ tipo: 'square', f: 75, t0: t0 + 0.02, ataque: 0.004, caida: 0.12, pico: 0.08, filtroTipo: 'lowpass', filtroF: 700 })
    return 0.25
  },

  // panel que entra
  abrir (t0) {
    ruido({ t0, dur: 0.18, pico: 0.1, tipo: 'bandpass', f: 700, f2: 2400, q: 1.2, ataque: 0.02 })
    tono({ tipo: 'sine', f: 330, f2: 660, t0, ataque: 0.01, caida: 0.14, pico: 0.09 })
    return 0.25
  },

  // panel que se va
  cerrar (t0) {
    ruido({ t0, dur: 0.16, pico: 0.09, tipo: 'bandpass', f: 2200, f2: 600, q: 1.2, ataque: 0.01 })
    tono({ tipo: 'sine', f: 620, f2: 300, t0, ataque: 0.008, caida: 0.13, pico: 0.08 })
    return 0.24
  },

  // el cerdo de la aldea: dos gruñidos con su punto de guasa
  cerdo (t0) {
    for (let i = 0; i < 2; i++) {
      const t = t0 + i * 0.17
      const f = 150 + Math.random() * 30
      tono({ tipo: 'sawtooth', f, f2: f * 0.55, t0: t, ataque: 0.01, caida: 0.13, pico: 0.11, filtroTipo: 'lowpass', filtroF: 1100, filtroF2: 400, q: 4 })
      ruido({ t0: t, dur: 0.12, pico: 0.06, tipo: 'bandpass', f: 900, f2: 500, q: 2 })
    }
    return 0.45
  },

  // la gallina: dos cloqueos rápidos y uno final más largo
  gallina (t0) {
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.13
      const f = 950 + Math.random() * 250
      tono({ tipo: 'triangle', f, f2: f * 1.5, t0: t, ataque: 0.006, caida: 0.05, pico: 0.09, filtroTipo: 'bandpass', filtroF: f * 1.4, q: 3 })
      tono({ tipo: 'square', f: f * 0.7, f2: f * 0.45, t0: t + 0.03, ataque: 0.004, caida: 0.07, pico: 0.05, filtroTipo: 'lowpass', filtroF: 2200 })
    }
    return 0.5
  }
}

// ───────────────────────────────────────────────────────────── API de efectos

/**
 * Suena un efecto. Ignora repeticiones muy seguidas del mismo sonido y respeta
 * el tope de voces, para que veinte aldeanos no revienten los altavoces.
 * @param {string} nombre clave de RECETAS
 * @param {{forzar?:boolean, retraso?:number}} [opciones]
 */
export function sfx (nombre, opciones = {}) {
  const receta = RECETAS[nombre]
  if (!receta) return
  if (!game.state?.ajustes?.sonido) return
  if (!ctx || ctx.state !== 'running') return   // aún no ha habido primer toque

  const ahora = performance.now()
  if (!opciones.forzar && ahora - (ultimaVez.get(nombre) || -1e9) < REPE_MS) return
  ultimaVez.set(nombre, ahora)
  if (voces >= MAX_VOCES) return

  try {
    const dur = receta(ctx.currentTime + 0.01 + (opciones.retraso || 0), opciones) || 0.4
    voces++
    setTimeout(() => { voces = Math.max(0, voces - 1) }, dur * 1000 + 40)
  } catch (err) {
    console.warn('[audio] no pude sonar', nombre, err)
  }
}

/** Efecto con retardo real (para encadenar: choque y luego el resultado). */
function sfxTras (ms, nombre) { setTimeout(() => sfx(nombre, { forzar: true }), ms) }

// ───────────────────────────────────────────────────────────── música ambiente

const ESCALAS = {
  dorico: [0, 2, 3, 5, 7, 9, 10],   // menor con sexta mayor: el sabor medieval de verdad
  eolico: [0, 2, 3, 5, 7, 8, 10]    // menor natural: más oscuro, para la noche
}

const AMBIENTES = {
  aldea:   { raiz: 146.83, escala: 'dorico', bpm: 92,  vol: 1.00, silencio: 0.30, percusion: false, animales: true },
  noche:   { raiz: 110.00, escala: 'eolico', bpm: 60,  vol: 0.75, silencio: 0.52, percusion: false, animales: false },
  batalla: { raiz: 146.83, escala: 'dorico', bpm: 134, vol: 1.15, silencio: 0.14, percusion: true,  animales: false }
}

let ambiente = 'aldea'
let sonando = false
let reloj = 0          // id del setInterval del secuenciador
let proximoPaso = 0    // instante (en tiempo de audio) de la siguiente corchea
let paso = 0
let motivo = []        // frase de 8 corcheas que se repite y se va variando

const PASO_LOOK = 0.25 // adelanto del planificador, en segundos

/** Frecuencia de un grado de la escala; `oct` en octavas enteras. */
function nota (grado, oct = 0) {
  const esc = ESCALAS[AMBIENTES[ambiente].escala]
  const i = ((grado % esc.length) + esc.length) % esc.length
  const salto = Math.floor(grado / esc.length) + oct
  return AMBIENTES[ambiente].raiz * Math.pow(2, esc[i] / 12 + salto)
}

/**
 * Genera la frase. La clave para que no canse en veinte minutos: paso corto
 * (casi siempre de un grado), silencios y reposo en grados estables.
 */
function nuevoMotivo (anterior) {
  const cfg = AMBIENTES[ambiente]
  if (anterior && anterior.length && Math.random() < 0.6) {
    // variación: la oreja reconoce la frase pero no es la misma
    const m = anterior.slice()
    for (let k = 0; k < 2; k++) {
      const i = 1 + Math.floor(Math.random() * (m.length - 1))
      m[i] = m[i] === null
        ? 2 + Math.floor(Math.random() * 4)
        : (Math.random() < 0.3 ? null : clamp(m[i] + (Math.random() < 0.5 ? -1 : 1), -2, 9))
    }
    return m
  }
  const m = []
  let g = [0, 2, 4][Math.floor(Math.random() * 3)]
  for (let i = 0; i < 8; i++) {
    if (i > 0 && Math.random() < cfg.silencio) { m.push(null); continue }
    m.push(g)
    const salto = Math.random() < 0.75 ? (Math.random() < 0.5 ? 1 : -1) : (Math.random() < 0.5 ? 2 : -2)
    g = clamp(g + salto, -2, 9)
  }
  m[m.length - 1] = [0, 2, 4][Math.floor(Math.random() * 3)]   // cierre en grado estable
  return m
}

/** Planifica una corchea. Todo va con tiempos de audio, nunca con setTimeout. */
function tocarPaso (t) {
  const cfg = AMBIENTES[ambiente]
  const compas = Math.floor(paso / 8)

  // cada 4 compases: frase nueva y acorde de fondo sostenido
  if (paso % 32 === 0) {
    motivo = nuevoMotivo(motivo)
    const bordon = compas % 8 < 4 ? 0 : 3        // tónica y subdominante, sin más
    const dur = (8 * 4 * 30) / cfg.bpm
    tono({ tipo: 'triangle', f: nota(bordon, -1), t0: t, ataque: 0.8, caida: dur, pico: 0.055, dest: busMusica, filtroTipo: 'lowpass', filtroF: 500 })
    tono({ tipo: 'sine', f: nota(bordon + 4, -1), t0: t, ataque: 1.2, caida: dur, pico: 0.03, dest: busMusica })
  }

  // bajo de laúd en los tiempos fuertes
  if (paso % 4 === 0) {
    const g = (compas % 8 < 4) ? 0 : 3
    laud(nota(paso % 8 === 0 ? g : g + 4, -1), t, 0.9, 0.09, busMusica)
  }

  // melodía
  const grado = motivo[paso % 8]
  if (grado !== null && grado !== undefined) {
    const dur = 30 / cfg.bpm * (Math.random() < 0.25 ? 3.5 : 1.8)
    laud(nota(grado, 0), t, dur, 0.085, busMusica)
    if (ambiente === 'batalla' && Math.random() < 0.4) laud(nota(grado + 4, 0), t, dur * 0.6, 0.04, busMusica)
  }

  // percusión solo en batalla: bombo y tambor, sin florituras
  if (cfg.percusion) {
    if (paso % 4 === 0) tono({ tipo: 'sine', f: 120, f2: 45, t0: t, ataque: 0.002, caida: 0.18, pico: 0.18, dest: busMusica })
    if (paso % 8 === 4) ruido({ t0: t, dur: 0.14, pico: 0.1, tipo: 'bandpass', f: 420, q: 1.5, dest: busMusica })
  }

  // vida de aldea: de vez en cuando, un bicho
  if (cfg.animales && paso % 8 === 0 && Math.random() < 0.1) {
    sfx(Math.random() < 0.5 ? 'gallina' : 'cerdo', { forzar: true })
  }

  paso++
}

function planificar () {
  if (!ctx || ctx.state !== 'running') return
  const dur = 30 / AMBIENTES[ambiente].bpm      // una corchea
  while (proximoPaso < ctx.currentTime + PASO_LOOK) {
    tocarPaso(Math.max(proximoPaso, ctx.currentTime + 0.02))
    proximoPaso += dur
  }
}

function arrancarMusica () {
  if (sonando || !ctx) return
  sonando = true
  paso = 0
  motivo = nuevoMotivo(null)
  proximoPaso = ctx.currentTime + 0.1
  fundirMusica(VOL.musica * AMBIENTES[ambiente].vol, 2.5)
  reloj = setInterval(planificar, 120)
  planificar()
}

function pararMusica () {
  if (!sonando) return
  sonando = false
  clearInterval(reloj); reloj = 0
  fundirMusica(0, 1.2)
}

function fundirMusica (destino, seg) {
  if (!busMusica || !ctx) return
  const g = busMusica.gain
  g.cancelScheduledValues(ctx.currentTime)
  g.setValueAtTime(Math.max(0.0001, g.value), ctx.currentTime)
  g.linearRampToValueAtTime(clamp(destino, 0, 1), ctx.currentTime + seg)
}

/** Enciende o apaga la música según los ajustes del jugador. */
function aplicarMusica () {
  const quiere = !!game.state?.ajustes?.musica && ctx && ctx.state === 'running'
  if (quiere && !sonando) arrancarMusica()
  else if (!quiere && sonando) pararMusica()
}

/**
 * Cambia el color de la música sin cortarla.
 * @param {'aldea'|'noche'|'batalla'} nombre
 */
export function setAmbiente (nombre) {
  if (!AMBIENTES[nombre] || nombre === ambiente) return
  ambiente = nombre
  if (!sonando) return
  // baja, cambia de frase y vuelve a subir: la transición no se nota fea
  fundirMusica(VOL.musica * AMBIENTES[ambiente].vol * 0.25, 0.4)
  setTimeout(() => {
    motivo = nuevoMotivo(null)
    paso = 0
    if (sonando) fundirMusica(VOL.musica * AMBIENTES[ambiente].vol, 1.6)
  }, 450)
}

/**
 * Volumen de cada bus, 0..1.
 * @param {'maestro'|'sonido'|'musica'} tipo
 * @param {number} valor
 */
export function setVolumen (tipo, valor) {
  const v = clamp(Number(valor) || 0, 0, 1)
  if (!(tipo in VOL)) return
  VOL[tipo] = v
  if (!ctx) return
  if (tipo === 'maestro') maestro.gain.setTargetAtTime(v, ctx.currentTime, 0.05)
  if (tipo === 'sonido') busSfx.gain.setTargetAtTime(v, ctx.currentTime, 0.05)
  if (tipo === 'musica' && sonando) fundirMusica(v * AMBIENTES[ambiente].vol, 0.3)
}

// ───────────────────────────────────────────────────────────── arranque y escucha

const SFX_RECURSO = { oro: 'monedas', madera: 'madera', piedra: 'piedra', comida: 'comida' }

export function init () {
  // El audio solo puede nacer de un gesto del usuario; y en iOS hay que reanimarlo a menudo.
  for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) {
    window.addEventListener(ev, despertar, { capture: true, passive: true })
  }

  // En segundo plano se suspende: ni gasta batería ni suena encima de otra app.
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return
    if (document.hidden) ctx.suspend().catch(() => {})
    else ctx.resume().then(aplicarMusica).catch(() => {})
  })
  window.addEventListener('pagehide', () => { if (ctx) ctx.suspend().catch(() => {}) })

  // --- efectos pedidos a mano ---
  events.on(EV.SFX, (p) => p && sfx(p.nombre, p))

  // --- construcción ---
  events.on(EV.BUILD_PLACED, () => sfx('martillo'))
  events.on(EV.BUILD_COMPLETED, () => sfx('obra_lista'))
  events.on(EV.BUILD_UPGRADED, () => sfx('obra_lista'))
  events.on(EV.BUILD_DEMOLISHED, () => sfx('derrumbe'))

  // --- recursos ---
  events.on(EV.RESOURCE_GAINED, (p) => sfx(SFX_RECURSO[p?.tipo] || 'monedas'))
  events.on(EV.RESOURCE_DENIED, () => sfx('error'))

  // --- guerra ---
  events.on(EV.RAID_STARTED, () => { sfx('cuerno'); setAmbiente('batalla') })
  events.on(EV.ATTACK_INCOMING, () => { sfx('cuerno'); setAmbiente('batalla') })
  events.on(EV.RAID_RESOLVED, (p) => {
    sfx('espadas', { forzar: true })
    sfxTras(400, p?.victoria ? 'victoria' : 'derrota')
    setTimeout(() => setAmbiente('aldea'), 2200)
  })
  events.on(EV.DEFENSE_RESOLVED, (p) => {
    sfx('espadas', { forzar: true })
    sfxTras(350, p?.victoria ? 'victoria' : 'derrota')
    setTimeout(() => setAmbiente('aldea'), 2200)
  })

  // --- progresión ---
  events.on(EV.LEVEL_UP, () => sfx('subir_nivel'))
  events.on(EV.AGE_ADVANCED, () => { sfx('victoria'); sfxTras(900, 'subir_nivel') })
  events.on(EV.QUEST_COMPLETED, () => { sfx('obra_lista'); sfxTras(300, 'monedas') })
  events.on(EV.TECH_RESEARCHED, () => sfx('subir_nivel'))

  // --- interfaz ---
  events.on(EV.UI_PANEL, (p) => sfx(p && p.panel ? 'abrir' : 'cerrar'))
  events.on(EV.UI_SELECT, (p) => { if (p && p.kind) sfx('toque') })

  // Los ajustes se pueden cambiar en cualquier momento: se comprueban en el tick
  // (4 veces por segundo, coste ridículo) en vez de inventar un evento nuevo.
  events.on(EV.TICK, aplicarMusica)

  // Si algún día el ciclo día/noche avisa, la música se adapta sola.
  events.on('ciclo:momento', (p) => { if (p && ambiente !== 'batalla') setAmbiente(p.noche ? 'noche' : 'aldea') })

  return { sfx, setVolumen, setAmbiente }
}

export default { init, sfx, setVolumen, setAmbiente }
