/**
 * Genera los iconos de la app (PNG) sin descargar nada y sin librerías:
 * solo `zlib` y `fs` de Node. Escribimos el PNG a mano —cabeceras IHDR, IDAT e
 * IEND con su CRC— porque el proyecto no admite ni un archivo externo ni un paquete más.
 *
 *   node scripts/generar-iconos.mjs
 *
 * Dibuja un escudo heráldico: fondo azul oscuro, banda dorada en diagonal y
 * una torre almenada clara. Todo con formas geométricas, como el resto del juego.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const SALIDA = join(RAIZ, 'public')

// Colores de PALETA (src/core/config.js). Si cambia la paleta, cambian aquí.
const COLOR = {
  fondo:      [0x1a, 0x23, 0x40, 255],   // cieloNoche
  campo:      [0x35, 0x42, 0x6b, 255],   // azul del degradado de carga
  oro:        [0xff, 0xc1, 0x07, 255],   // oro
  piedra:     [0xf5, 0xee, 0xde, 255],   // yeso
  piedraOsc:  [0xb0, 0xbe, 0xc5, 255],   // piedra
  hueco:      [0x1a, 0x23, 0x40, 255]    // puerta y ventana
}

// ───────────────────────────────────────────── dibujo del escudo (coordenadas 0..1)

const ESCUDO = { cx: 0.5, cy: 0.115, rx: 0.345, alto: 0.775 }

/** ¿Está el punto dentro de la silueta del escudo? (u en ±1, v de 0 arriba a 1 abajo) */
function enEscudo (u, v) {
  if (v < 0 || v > 1) return false
  if (v <= 0.45) return Math.abs(u) <= 1
  const w = (v - 0.45) / 0.55            // 0..1 desde donde empieza la punta
  return u * u + w * w <= 1              // elipse: da la punta heráldica
}

/** Banda diagonal de esquina superior izquierda a inferior derecha. */
const enBanda = (u, v) => Math.abs(u - (2 * v - 1)) < 0.3

/** Torre con tres almenas, cuerpo, ventana y puerta de arco. */
function enTorre (u, v) {
  if (v >= 0.34 && v <= 0.86 && Math.abs(u) <= 0.33) return 'cuerpo'
  if (v >= 0.22 && v < 0.34) {                       // almenas
    if (u >= -0.33 && u <= -0.15) return 'cuerpo'
    if (u >= -0.09 && u <= 0.09) return 'cuerpo'
    if (u >= 0.15 && u <= 0.33) return 'cuerpo'
  }
  return null
}

const enVentana = (u, v) => Math.abs(u) <= 0.075 && v >= 0.44 && v <= 0.53

/** Puerta: rectángulo con arco de medio punto encima. */
function enPuerta (u, v) {
  if (Math.abs(u) > 0.125 || v > 0.86) return false
  if (v >= 0.66) return true
  const dv = (0.66 - v) / 0.13
  return (u * u) / (0.125 * 0.125) + dv * dv <= 1
}

/** Color de un punto del icono, en coordenadas normalizadas del lienzo (0..1). */
function pintar (px, py) {
  const u = (px - ESCUDO.cx) / ESCUDO.rx
  const v = (py - ESCUDO.cy) / ESCUDO.alto
  if (!enEscudo(u, v)) return COLOR.fondo

  // el interior es el mismo escudo encogido hacia su centro: lo que queda fuera es el marco
  const k = 0.88
  const ui = u / k
  const vi = (v - 0.45) / k + 0.45
  if (!enEscudo(ui, vi)) return COLOR.oro

  // la torre manda sobre la banda, y la banda sobre el campo
  if (enTorre(ui, vi)) {
    if (enPuerta(ui, vi) || enVentana(ui, vi)) return COLOR.hueco
    return ui > 0.16 ? COLOR.piedraOsc : COLOR.piedra   // sombra: da volumen
  }
  if (enBanda(ui, vi)) return COLOR.oro
  return COLOR.campo
}

// ───────────────────────────────────────────── mecánica del PNG

const TABLA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

function crc32 (buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Un trozo PNG: longitud + tipo + datos + CRC(tipo+datos). */
function trozo (tipo, datos) {
  const largo = Buffer.alloc(4)
  largo.writeUInt32BE(datos.length, 0)
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(cuerpo), 0)
  return Buffer.concat([largo, cuerpo, crc])
}

/** @param {number} lado @returns {Buffer} PNG RGBA de lado×lado */
function generarPNG (lado) {
  const M = 3                                  // muestreo 3×3 por píxel: bordes limpios
  // cada fila lleva delante su byte de filtro (0 = sin filtro)
  const crudo = Buffer.alloc(lado * (lado * 4 + 1))
  let p = 0
  for (let y = 0; y < lado; y++) {
    crudo[p++] = 0
    for (let x = 0; x < lado; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < M; sy++) {
        for (let sx = 0; sx < M; sx++) {
          const c = pintar((x + (sx + 0.5) / M) / lado, (y + (sy + 0.5) / M) / lado)
          r += c[0]; g += c[1]; b += c[2]; a += c[3]
        }
      }
      const n = M * M
      crudo[p++] = Math.round(r / n)
      crudo[p++] = Math.round(g / n)
      crudo[p++] = Math.round(b / n)
      crudo[p++] = Math.round(a / n)
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(lado, 0)
  ihdr.writeUInt32BE(lado, 4)
  ihdr[8] = 8     // 8 bits por canal
  ihdr[9] = 6     // color RGBA
  ihdr[10] = 0    // compresión deflate
  ihdr[11] = 0    // filtrado estándar
  ihdr[12] = 0    // sin entrelazado

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(crudo, { level: 9 })),
    trozo('IEND', Buffer.alloc(0))
  ])
}

// ───────────────────────────────────────────── a disco

mkdirSync(SALIDA, { recursive: true })
const icono192 = generarPNG(192)
for (const [archivo, datos] of [
  ['icon-192.png', icono192],
  ['icon-512.png', generarPNG(512)],
  ['favicon.png', icono192]
]) {
  writeFileSync(join(SALIDA, archivo), datos)
  console.log(`✔ public/${archivo} — ${(datos.length / 1024).toFixed(1)} KB`)
}
