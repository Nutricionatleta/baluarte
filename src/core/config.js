/** Constantes del juego. Un solo sitio para tocar el equilibrio. */

export const CONFIG = {
  VERSION: 1,
  NOMBRE: 'Baluarte',

  // --- tablero ---
  GRID: 34,          // aldea de 34x34 casillas
  CELDA: 1,          // 1 casilla = 1 unidad de Three.js
  ALTURA_MAX: 0.6,   // relieve suave, nada de montañas

  // --- ritmo (híbrido: esperas cortas + acelerar) ---
  TICK_MS: 250,              // la simulación avanza 4 veces por segundo
  MAX_OFFLINE_HORAS: 8,      // tope de producción acumulada mientras no juegas
  SEG_POR_GEMA: 60,          // 1 gema acelera 60 s de obra
  MAX_OBRAS_SIMULTANEAS: 2,  // sube con el Ayuntamiento

  // --- economía ---
  RECURSOS: ['madera', 'piedra', 'comida', 'oro'],
  ALMACEN_BASE: { madera: 800, piedra: 800, comida: 600, oro: 400 },

  // --- cámara móvil ---
  ZOOM_MIN: 14,
  ZOOM_MAX: 70,      // hay que poder ver la aldea entera de un vistazo
  ZOOM_INICIAL: 42,  // de lejos se ve el pueblo; de cerca, solo tejados
  ANGULO_CAMARA: Math.PI / 5   // isométrica suave, tipo Stellar Settlers
}

/**
 * Paleta low-poly medieval. TODO el render debe usar estos colores:
 * es lo que hace que el juego parezca de una sola mano y no un collage.
 */
export const PALETA = {
  // terreno
  hierba: 0x7cb342,
  hierbaOscura: 0x558b2f,
  hierbaClara: 0x9ccc65,
  tierra: 0x8d6e63,
  camino: 0xbcaaa4,
  arena: 0xe8d8a0,
  agua: 0x4fc3d9,
  aguaProfunda: 0x2e94b0,
  roca: 0x90a4ae,
  rocaOscura: 0x607d8b,
  nieve: 0xeceff1,
  rejilla: 0xf3fbff,      // líneas de la rejilla de construcción

  // construcciones
  madera: 0xa1662f,
  maderaClara: 0xc98a4b,
  piedra: 0xb0bec5,
  piedraOscura: 0x78909c,
  tejado: 0xc94f3d,
  tejadoOscuro: 0x9c3b2c,
  tejadoAzul: 0x4a6fa5,
  paja: 0xd9b36c,
  yeso: 0xf5eede,
  hierro: 0x546e7a,
  oro: 0xffc107,
  tela: 0xd94f4f,
  telaVerde: 0x3f9d6b,     // toldos del mercado y tiendas de campaña
  telaAzul: 0x3f6fb5,
  telaCruda: 0xe8dcc0,
  adobe: 0xdcc3a0,         // muro de adobe sin encalar (niveles bajos)
  entramado: 0x6b4a33,     // vigas oscuras del entramado medieval
  pizarra: 0x59697a,       // tejado de pizarra de los niveles altos
  pizarraClara: 0x7b8b9c,
  carbon: 0x3b3f42,        // madera quemada: ruinas y chimeneas
  ceniza: 0x6b7176,
  fuego: 0xff7043,         // llama de fragua y hoguera
  brasa: 0xffca28,
  caballo: 0x7a5230,

  // vegetación
  copaPino: 0x2e7d32,
  copaPinoClara: 0x43a047,   // punta del pino, para que la copa no sea una mancha
  copaRoble: 0x66bb6a,
  tronco: 0x6d4c41,
  arbusto: 0x81c784,
  trigo: 0xe6c35c,
  florBlanca: 0xfff3e0,
  florRoja: 0xe57373,
  florAmarilla: 0xffd54f,
  florAzul: 0x9fa8da,

  // personajes
  pielClara: 0xf1c9a0,
  pielMedia: 0xc68863,
  pielOscura: 0x8d5524,
  pielTostada: 0xd9a066,
  ropaAldeano: 0x8d6e63,
  ropaAldeana: 0x7e57c2,
  metalTropa: 0x9e9e9e,
  estandarte: 0x1e88e5,
  enemigo: 0x8e2b2b,
  // ropa de aldeano teñida: la variedad es lo que evita el ejército de clones
  ropaVerde: 0x6a8f4f,
  ropaOcre: 0xc08a3e,
  ropaAzulon: 0x5b7c99,
  ropaGranate: 0x8f4a4a,
  ropaCruda: 0xd9cbb0,
  delantal: 0xe4dac2,
  calzas: 0x6d5a49,
  cuero: 0x6b4a2f,
  cueroClaro: 0xa97b52,
  pelo: 0x4b3621,
  peloClaro: 0xb08050,
  peloCano: 0xcfc6bb,
  // tropa
  cotaMalla: 0x8a95a0,
  aceroClaro: 0xd6dde3,
  acero: 0x7e8b96,
  capuchaVerde: 0x3f6b3a,
  habito: 0x5d4433,
  penacho: 0xe0483c,
  caballoCastaño: 0x8b5a2b,
  caballoOscuro: 0x4e342e,
  caballoClaro: 0xc9a882,

  // ambiente
  cielo: 0x87ceeb,
  cieloAtardecer: 0xf5a05a,
  cieloNoche: 0x1a2340,
  niebla: 0xcfe8f5,
  sol: 0xfff4d6,
  luna: 0xaec6ff
}

/** Iconos de recurso para la interfaz (emoji: cero archivos que cargar). */
export const ICONO = {
  madera: '🪵', piedra: '🪨', comida: '🌾', oro: '🪙', gemas: '💎',
  aldeano: '🧑‍🌾', ejercito: '⚔️', tiempo: '⏱️'
}
