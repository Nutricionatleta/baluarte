/**
 * CATÁLOGO DE TECNOLOGÍAS Y AVANCE DE EDAD. Datos puros.
 *
 * EQUILIBRIO: las tecnologías son mejoras PERMANENTES y no se pueden perder,
 * así que cada una es pequeña (10-30 %) y se investiga de una en una. Lo que
 * de verdad cuesta es el oro: obliga a elegir entre tropa y ciencia.
 * Los tiempos siguen el ritmo híbrido de las obras: las primeras de cada edad
 * se resuelven en un rato muerto (3-10 min) y ninguna pasa de 8 h.
 *
 * EL ÁRBOL, no la lista. Cada edad recoge lo de la anterior: las hachas llevan
 * a la cuadrilla de leñadores, que lleva a las talas programadas. Así ninguna
 * edad se queda sin nada que investigar y la Imperial tiene un techo de verdad
 * (la Corona Imperial pide medio árbol hecho y el Ayuntamiento al máximo).
 *
 *   Edad Oscura      6 tecnologías   minutos
 *   Edad Feudal      8               20-60 min
 *   Castillos        9               1,5-3 h
 *   Imperial        12               3-8 h
 */

const MIN = 60
const HORA = 3600

/** Tipos de efecto que la simulación debe saber aplicar. */
export const TIPOS_EFECTO = [
  'produccion',      // objetivo: 'madera'|'piedra'|'comida'|'oro'|'todas'   → sim/resources.js
  'ataque',          // objetivo: clase de unidad o 'todas'                  → sim/army.js
  'armadura',        // idem                                                 → sim/army.js
  'velocidadObra',   // objetivo: 'todas'                                    → sim/buildings.js
  'defensa',         // objetivo: 'torres'|'muralla'|'puerta'|'todas'        → sim/buildings.js (vida)
  'exploracion',     // objetivo: 'alcance'|'velocidad'                      → world/expeditions.js
  'comercio'         // objetivo: 'comision' (valor negativo = más barato)   → sim/resources.js
]

export const TECNOLOGIAS = {
  // ------------------------------------------------------------ Edad Oscura
  // Baratas y de minutos: son el tutorial de la ciencia, no una pared.
  hachas_afiladas: {
    nombre: 'Hachas afiladas',
    icono: '🪓',
    desc: 'Filo nuevo, mismo brazo: el doble de astillas por golpe.',
    age: 'oscura',
    coste: { madera: 120, piedra: 0, comida: 80, oro: 0 },
    tiempo: 3 * MIN,
    requiere: { serreria: 2 },
    efecto: { tipo: 'produccion', valor: 0.15, objetivo: 'madera' }
  },

  picos_reforzados: {
    nombre: 'Picos reforzados',
    icono: '⛏️',
    desc: 'Punta de hierro para la piedra, que es la que siempre falta.',
    age: 'oscura',
    coste: { madera: 80, piedra: 120, comida: 60, oro: 0 },
    tiempo: 5 * MIN,
    requiere: { cantera: 2 },
    efecto: { tipo: 'produccion', valor: 0.15, objetivo: 'piedra' }
  },

  hoz_curva: {
    nombre: 'Hoz curva',
    icono: '🌾',
    desc: 'Se siega el doble agachándose la mitad. Los lomos lo agradecen.',
    age: 'oscura',
    coste: { madera: 100, piedra: 0, comida: 60, oro: 0 },
    tiempo: 3 * MIN,
    requiere: { granja: 2 },
    efecto: { tipo: 'produccion', valor: 0.15, objetivo: 'comida' }
  },

  andamios: {
    nombre: 'Andamios',
    icono: '🪜',
    desc: 'Cuatro palos bien atados y las obras dejan de eternizarse.',
    age: 'oscura',
    coste: { madera: 150, piedra: 50, comida: 0, oro: 0 },
    tiempo: 8 * MIN,
    requiere: { ayuntamiento: 2 },
    efecto: { tipo: 'velocidadObra', valor: 0.10, objetivo: 'todas' }
  },

  mapas_pergamino: {
    nombre: 'Mapas de pergamino',
    icono: '🗺️',
    desc: 'Dibujar dónde estuviste evita volver a perderse. En teoría.',
    age: 'oscura',
    coste: { madera: 60, piedra: 0, comida: 120, oro: 20 },
    tiempo: 10 * MIN,
    requiere: { campamento_explorador: 2 },
    efecto: { tipo: 'exploracion', valor: 0.20, objetivo: 'alcance' }
  },

  cuadrilla_lenadores: {
    nombre: 'Cuadrilla de leñadores',
    icono: '🌲',
    desc: 'Tres hachas a la vez sobre el mismo tronco. Cae antes y cae entero.',
    age: 'oscura',
    coste: { madera: 260, piedra: 60, comida: 140, oro: 10 },
    tiempo: 15 * MIN,
    requiere: { serreria: 3, tech: 'hachas_afiladas' },
    efecto: { tipo: 'produccion', valor: 0.12, objetivo: 'madera' }
  },

  // ------------------------------------------------------------ Edad Feudal
  trueque: {
    nombre: 'Trueque',
    icono: '⚖️',
    desc: 'Regatear también es un oficio. El tendero se queda con menos.',
    age: 'feudal',
    coste: { madera: 200, piedra: 100, comida: 200, oro: 120 },
    tiempo: 20 * MIN,
    requiere: { mercado: 1 },
    efecto: { tipo: 'comercio', valor: -0.08, objetivo: 'comision' }
  },

  carretillas: {
    nombre: 'Carretillas',
    icono: '🛒',
    desc: 'Una rueda, dos brazos y se acabó cargar a hombros.',
    age: 'feudal',
    coste: { madera: 400, piedra: 150, comida: 200, oro: 60 },
    tiempo: 25 * MIN,
    requiere: { almacen: 3, tech: 'hachas_afiladas' },
    efecto: { tipo: 'produccion', valor: 0.12, objetivo: 'todas' }
  },

  armadura_escamada: {
    nombre: 'Armadura escamada',
    icono: '🛡️',
    desc: 'Escamas de hierro cosidas al cuero: pesa, pero se vuelve a casa.',
    age: 'feudal',
    coste: { madera: 100, piedra: 0, comida: 150, oro: 180 },
    tiempo: 30 * MIN,
    requiere: { herreria: 1 },
    efecto: { tipo: 'armadura', valor: 0.15, objetivo: 'todas' }
  },

  cantero_mayor: {
    nombre: 'Cantero mayor',
    icono: '🪚',
    desc: 'Un viejo que mira la roca, da dos golpes y la parte por donde quiere.',
    age: 'feudal',
    coste: { madera: 300, piedra: 450, comida: 200, oro: 90 },
    tiempo: 35 * MIN,
    requiere: { cantera: 4, tech: 'picos_reforzados' },
    efecto: { tipo: 'produccion', valor: 0.20, objetivo: 'piedra' }
  },

  arado_pesado: {
    nombre: 'Arado pesado',
    icono: '🐂',
    desc: 'Con bueyes se abre la tierra dura. Y la aldea deja de pasar hambre.',
    age: 'feudal',
    coste: { madera: 300, piedra: 100, comida: 350, oro: 40 },
    tiempo: 40 * MIN,
    requiere: { molino: 1, tech: 'hoz_curva' },
    efecto: { tipo: 'produccion', valor: 0.25, objetivo: 'comida' }
  },

  punta_perforante: {
    nombre: 'Punta perforante',
    icono: '🏹',
    desc: 'Punta estrecha que se cuela entre las escamas del vecino.',
    age: 'feudal',
    coste: { madera: 250, piedra: 0, comida: 100, oro: 200 },
    tiempo: 45 * MIN,
    requiere: { herreria: 2, arqueria: 2 },
    efecto: { tipo: 'ataque', valor: 0.20, objetivo: 'distancia' }
  },

  polea_grua: {
    nombre: 'Polea y grúa',
    icono: '🏗️',
    desc: 'Subir sillares a pulso era de tontos. Ahora tira la cuerda un burro.',
    age: 'feudal',
    coste: { madera: 550, piedra: 350, comida: 150, oro: 120 },
    tiempo: 45 * MIN,
    requiere: { ayuntamiento: 4, tech: 'andamios' },
    efecto: { tipo: 'velocidadObra', valor: 0.12, objetivo: 'todas' }
  },

  almenas: {
    nombre: 'Almenas',
    icono: '🧱',
    desc: 'Dientes de piedra para asomarse sin comerse una flecha.',
    age: 'feudal',
    coste: { madera: 150, piedra: 400, comida: 0, oro: 80 },
    tiempo: 50 * MIN,
    requiere: { torre_vigia: 3 },
    efecto: { tipo: 'defensa', valor: 0.20, objetivo: 'torres' }
  },

  // ------------------------------------------------- Edad de los Castillos
  herradura: {
    nombre: 'Herradura',
    icono: '🐴',
    desc: 'Cascos protegidos: la carga llega entera y llega antes.',
    age: 'castillos',
    coste: { madera: 280, piedra: 0, comida: 700, oro: 490 },
    tiempo: 1 * HORA,
    requiere: { establo: 2 },
    efecto: { tipo: 'ataque', valor: 0.20, objetivo: 'caballeria' }
  },

  caballo_refresco: {
    nombre: 'Caballo de refresco',
    icono: '🐎',
    desc: 'Cambiar de montura a mitad de camino: se llega al doble de lejos.',
    age: 'castillos',
    coste: { madera: 350, piedra: 0, comida: 840, oro: 350 },
    tiempo: 1 * HORA,
    requiere: { campamento_explorador: 3, tech: 'mapas_pergamino' },
    efecto: { tipo: 'exploracion', valor: 0.30, objetivo: 'velocidad' }
  },

  banca: {
    nombre: 'Banca',
    icono: '🏦',
    desc: 'Prestar con interés. Poco caballeresco, muy rentable.',
    age: 'castillos',
    coste: { madera: 700, piedra: 420, comida: 560, oro: 560 },
    tiempo: 1.5 * HORA,
    requiere: { mercado: 3, tech: 'trueque' },
    efecto: { tipo: 'produccion', valor: 0.20, objetivo: 'oro' }
  },

  puerta_reforzada: {
    nombre: 'Puerta reforzada',
    icono: '🚪',
    desc: 'Roble, hierro y rencor. El ariete se lo va a pensar dos veces.',
    age: 'castillos',
    coste: { madera: 630, piedra: 490, comida: 0, oro: 280 },
    tiempo: 1.5 * HORA,
    requiere: { muralla: 4, herreria: 4 },
    efecto: { tipo: 'defensa', valor: 0.35, objetivo: 'puerta' }
  },

  rotacion_trienal: {
    nombre: 'Rotación trienal',
    icono: '🌱',
    desc: 'Un año trigo, otro legumbre, otro descanso. La tierra no se agota.',
    age: 'castillos',
    coste: { madera: 980, piedra: 420, comida: 1540, oro: 420 },
    tiempo: 2 * HORA,
    requiere: { molino: 2, tech: 'arado_pesado' },
    efecto: { tipo: 'produccion', valor: 0.25, objetivo: 'comida' }
  },

  hornos_cal: {
    nombre: 'Hornos de cal',
    icono: '🔥',
    desc: 'Piedra cocida y mortero: se levanta el doble con lo mismo.',
    age: 'castillos',
    coste: { madera: 1260, piedra: 1680, comida: 560, oro: 490 },
    tiempo: 2 * HORA,
    requiere: { cantera: 6, tech: 'cantero_mayor' },
    efecto: { tipo: 'produccion', valor: 0.25, objetivo: 'piedra' }
  },

  foso: {
    nombre: 'Foso',
    icono: '🌊',
    desc: 'Agua, barro y muy malas palabras para quien traiga escaleras.',
    age: 'castillos',
    coste: { madera: 420, piedra: 980, comida: 280, oro: 210 },
    tiempo: 2 * HORA,
    requiere: { castillo: 1 },
    efecto: { tipo: 'defensa', valor: 0.25, objetivo: 'muralla' }
  },

  ingenieria_civil: {
    nombre: 'Ingeniería civil',
    icono: '📐',
    desc: 'Planos antes de picar. Se tarda una tarde y se ahorran tres semanas.',
    age: 'castillos',
    coste: { madera: 1540, piedra: 1260, comida: 700, oro: 840 },
    tiempo: 2 * HORA,
    requiere: { universidad: 2, tech: 'polea_grua' },
    efecto: { tipo: 'velocidadObra', valor: 0.15, objetivo: 'todas' }
  },

  gremios: {
    nombre: 'Gremios',
    icono: '🧑‍🏭',
    desc: 'Cada oficio con su maestro, su norma y su orgullo. Rinde el doble.',
    age: 'castillos',
    coste: { madera: 1960, piedra: 1400, comida: 1680, oro: 1260 },
    tiempo: 2.5 * HORA,
    requiere: { universidad: 2, tech: 'carretillas' },
    efecto: { tipo: 'produccion', valor: 0.15, objetivo: 'todas' }
  },

  // ---------------------------------------------------------- Edad Imperial
  // Aquí ya no se investiga «la siguiente»: se elige en qué imperio te conviertes.
  sierra_hidraulica: {
    nombre: 'Sierra hidráulica',
    icono: '⚙️',
    desc: 'Que trabaje el río. Los aldeanos ya han trabajado bastante.',
    age: 'imperial',
    coste: { madera: 5600, piedra: 4200, comida: 2800, oro: 3080 },
    tiempo: 3 * HORA,
    requiere: { universidad: 4, tech: 'gremios' },
    efecto: { tipo: 'produccion', valor: 0.20, objetivo: 'todas' }
  },

  casa_moneda: {
    nombre: 'Casa de la moneda',
    icono: '🪙',
    desc: 'Acuñar tu propia cara en plata. Medio imperio es propaganda.',
    age: 'imperial',
    coste: { madera: 3500, piedra: 4900, comida: 2100, oro: 3500 },
    tiempo: 3 * HORA,
    requiere: { mercado: 5, tech: 'banca' },
    efecto: { tipo: 'produccion', valor: 0.25, objetivo: 'oro' }
  },

  talas_programadas: {
    nombre: 'Talas programadas',
    icono: '🪵',
    desc: 'Se corta por cuarteles y se replanta detrás. El bosque no se acaba.',
    age: 'imperial',
    coste: { madera: 7000, piedra: 2800, comida: 3500, oro: 2100 },
    tiempo: 4 * HORA,
    requiere: { serreria: 8, tech: 'cuadrilla_lenadores' },
    efecto: { tipo: 'produccion', valor: 0.30, objetivo: 'madera' }
  },

  canteras_profundas: {
    nombre: 'Canteras profundas',
    icono: '🕳️',
    desc: 'Bajar donde la roca es buena. Se sube con poleas y con cuidado.',
    age: 'imperial',
    coste: { madera: 4900, piedra: 7000, comida: 2800, oro: 2520 },
    tiempo: 4 * HORA,
    requiere: { cantera: 8, tech: 'hornos_cal' },
    efecto: { tipo: 'produccion', valor: 0.30, objetivo: 'piedra' }
  },

  graneros_imperiales: {
    nombre: 'Graneros imperiales',
    icono: '🏛️',
    desc: 'Grano del Estado para el año malo. Un imperio no pasa hambre dos veces.',
    age: 'imperial',
    coste: { madera: 4200, piedra: 4900, comida: 5600, oro: 2240 },
    tiempo: 4 * HORA,
    requiere: { granero: 8, tech: 'rotacion_trienal' },
    efecto: { tipo: 'produccion', valor: 0.30, objetivo: 'comida' }
  },

  acero_templado: {
    nombre: 'Acero templado',
    icono: '⚔️',
    desc: 'Filo que no se mella. La última palabra de la herrería.',
    age: 'imperial',
    coste: { madera: 2800, piedra: 2100, comida: 3500, oro: 4900 },
    tiempo: 4 * HORA,
    requiere: { herreria: 6, tech: 'armadura_escamada' },
    efecto: { tipo: 'ataque', valor: 0.25, objetivo: 'todas' }
  },

  torres_bombardas: {
    nombre: 'Torres bombardas',
    icono: '💣',
    desc: 'Pólvora en lo alto de la torre. Lo que salga mal, saldrá muy mal.',
    age: 'imperial',
    coste: { madera: 3500, piedra: 5600, comida: 1680, oro: 4200 },
    tiempo: 4 * HORA,
    requiere: { torre_ballesta: 4, tech: 'almenas' },
    efecto: { tipo: 'defensa', valor: 0.35, objetivo: 'torres' }
  },

  liga_comercial: {
    nombre: 'Liga comercial',
    icono: '🚢',
    desc: 'Cinco puertos, un solo precio y nadie que te tosa en la lonja.',
    age: 'imperial',
    coste: { madera: 4200, piedra: 2800, comida: 3500, oro: 5600 },
    tiempo: 4 * HORA,
    requiere: { mercado: 6, tech: 'casa_moneda' },
    efecto: { tipo: 'comercio', valor: -0.10, objetivo: 'comision' }
  },

  murallas_ciclopeas: {
    nombre: 'Murallas ciclópeas',
    icono: '🗿',
    desc: 'Bloques que no levantaría un hombre. Cuentan que los puso un gigante.',
    age: 'imperial',
    coste: { madera: 4200, piedra: 9800, comida: 2100, oro: 3500 },
    tiempo: 5 * HORA,
    requiere: { muralla: 8, tech: 'foso' },
    efecto: { tipo: 'defensa', valor: 0.30, objetivo: 'todas' }
  },

  maestros_obra: {
    nombre: 'Maestros de obra',
    icono: '👷',
    desc: 'Gente que ha levantado tres catedrales y no necesita que le expliquen.',
    age: 'imperial',
    coste: { madera: 7000, piedra: 7000, comida: 4200, oro: 6300 },
    tiempo: 5 * HORA,
    requiere: { ayuntamiento: 10, tech: 'ingenieria_civil' },
    efecto: { tipo: 'velocidadObra', valor: 0.20, objetivo: 'todas' }
  },

  tributo_real: {
    nombre: 'Tributo real',
    icono: '📜',
    desc: 'Cada aldea del contorno manda lo suyo. Nadie discute con un recaudador.',
    age: 'imperial',
    coste: { madera: 5600, piedra: 5600, comida: 7000, oro: 8400 },
    tiempo: 5 * HORA,
    requiere: { ayuntamiento: 11, tech: 'casa_moneda' },
    efecto: { tipo: 'produccion', valor: 0.30, objetivo: 'oro' }
  },

  corona_imperial: {
    nombre: 'Corona imperial',
    icono: '👑',
    desc: 'El último sello. A partir de aquí, lo que crezca lo has hecho crecer tú.',
    age: 'imperial',
    coste: { madera: 16800, piedra: 16800, comida: 14000, oro: 12600 },
    tiempo: 8 * HORA,
    requiere: { ayuntamiento: 12, universidad: 6, tech: ['sierra_hidraulica', 'tributo_real'] },
    efecto: { tipo: 'produccion', valor: 0.25, objetivo: 'todas' }
  }
}

export const IDS_TECH = Object.keys(TECNOLOGIAS)

/** @returns {any|null} ficha de la tecnología, o null si el id no existe. */
export function defTech (id) {
  return TECNOLOGIAS[id] || null
}

/**
 * Avance de edad. Es la única pared dura del juego: cuesta caro y tarda,
 * pero a cambio abre de golpe media pantalla de contenido nuevo.
 * La edad oscura no aparece porque es donde se empieza.
 *
 * RITMO (medido en el banco de pruebas, jugando 2-3 ratos al día):
 *   Feudal     día 1-2    la primera tarde. Aquí se engancha o no se engancha.
 *   Castillos  día 7-9    una semana de aldea: ya hay oficio, tropa y muralla.
 *   Imperial   día 20-22  tres semanas. Es el final del principio, no el final.
 *
 * Cada salto pide TRES cosas y no solo dinero: edificios a un nivel, unas
 * tecnologías concretas hechas (`tech`) y el tesoro de la ceremonia. Lo que
 * alarga la partida es el árbol, no el reloj: siempre hay algo que investigar
 * o que levantar mientras se junta el oro.
 */
export const EDADES = {
  feudal: {
    nombre: 'Edad Feudal',
    icono: '🏘️',
    requiere: { ayuntamiento: 3, serreria: 2, granja: 2, casa: 3 },
    coste: { madera: 700, piedra: 350, comida: 550, oro: 60 },
    tiempo: 20 * MIN,
    desbloquea: 'Mina de oro, molino, mercado, arquería y herrería. Y con ella, los arqueros y el espadachín.'
  },

  castillos: {
    nombre: 'Edad de los Castillos',
    icono: '🏰',
    requiere: {
      ayuntamiento: 9, mercado: 5, herreria: 5, mina_oro: 4, almacen: 6, cuartel: 5, arqueria: 3, torre_vigia: 4,
      tech: ['carretillas', 'arado_pesado', 'cantero_mayor', 'polea_grua', 'armadura_escamada']
    },
    coste: { madera: 60000, piedra: 50000, comida: 18000, oro: 7000 },
    tiempo: 3 * HORA,
    desbloquea: 'Castillo, establo, taller de asedio, universidad, monasterio y torres de ballestas. Empieza la guerra de verdad.'
  },

  imperial: {
    nombre: 'Edad Imperial',
    icono: '👑',
    requiere: {
      ayuntamiento: 11, universidad: 6, castillo: 4, taller_asedio: 3, monasterio: 3, torre_ballesta: 4, establo: 4,
      tech: ['gremios', 'ingenieria_civil', 'banca', 'hornos_cal', 'rotacion_trienal', 'herradura']
    },
    coste: { madera: 260000, piedra: 240000, comida: 90000, oro: 40000 },
    tiempo: 8 * HORA,
    desbloquea: 'Catapultas y las doce tecnologías del imperio: sierras hidráulicas, canteras profundas, casa de la moneda, murallas ciclópeas y, al final del todo, la Corona Imperial.'
  }
}
