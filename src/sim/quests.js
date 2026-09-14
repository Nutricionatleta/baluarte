import { events, EV } from '../core/events.js'
import { game } from '../core/state.js'
import { CONFIG, ICONO } from '../core/config.js'
import { EDIFICIOS, ORDEN_EDADES, AGE_NOMBRE } from '../data/buildings.js'
import { ingresarVarios, gemas } from './resources.js'

/**
 * ENCARGOS, TAREAS DIARIAS Y LOGROS — el mayordomo del baluarte.
 *
 * Su único trabajo es que el jugador NUNCA se quede mirando la pantalla sin
 * saber qué hacer, y que al abrir el juego haya algo esperándole.
 *
 * Todo se mide ESCUCHANDO EVENTOS, nunca sondeando el estado en cada tick.
 * Los objetivos "de estado" (tener tal edificio, tal nivel, tantos aldeanos)
 * se recalculan solo cuando llega un evento que puede haberlos cambiado, y se
 * siembran una vez al activarse el encargo: así lo que ya está hecho cuenta.
 *
 * Las gemas de este juego salen de aquí y de los asaltos. Nunca de dinero real.
 */

// ---------------------------------------------------------------- utilidades

const rec = (madera = 0, piedra = 0, comida = 0, oro = 0) => ({ madera, piedra, comida, oro })

/** Recompensa completa. Generosa al principio, espaciada después. */
const premio = (recursos, gem = 0, xp = 0) => ({ recursos: recursos || {}, gemas: gem, xp })

/** Objetivos que se pueden LEER del estado (se resiembran al llegar su evento). */
const DE_ESTADO = new Set([
  'construir', 'nivel', 'aldeanos', 'tropas', 'edad', 'edificios',
  'tecnologia', 'tecnologias', 'adorno', 'edadIndice', 'racha', 'encargos'
])

// --------------------------------------------------------------- LA CAMPAÑA
/**
 * Cadena de encargos: del primer tronco a la Edad Imperial.
 *
 * REGLA DE ESCRITURA (el dueño no sabía qué tenía que hacer):
 *   `titulo`  = LA ORDEN, en imperativo y de un vistazo. «Levanta una serrería».
 *   `texto`   = el adorno del mayordomo: UNA frase corta, y en pequeño.
 *   `consejo` = la misma orden en boca del mayordomo, para la tira del HUD.
 *   `ir`      = a qué pantalla lleva el botón. Saber qué hacer sin poder ir, no sirve.
 *   `unidad`  = qué se cuenta, para el «Te faltan 5 tramos».
 *   `pasos`   = si el encargo pide varias cosas, se ven como lista de comprobación.
 * Nada de párrafos: en un juego de ratos muertos, si hay que leer, se cierra.
 */

// A dónde manda el botón grande. Los nombres de panel son los que ya escucha la UI.
const IR_TALLER = { texto: '🔨 Ir al taller', panel: 'construir' }
const IR_MEJORAS = { texto: '⬆️ Ir a mejoras', panel: 'mejorar' }
const IR_CIENCIA = { texto: '📜 Ir a investigar', panel: 'investigar' }
const IR_EDAD = { texto: '🏰 Ir a avanzar de edad', panel: 'investigar' }
const IR_ENTRENAR = { texto: '⚔️ Ir a entrenar', panel: 'ejercito', datos: { solapa: 'entrenar' } }
const IR_ATACAR = { texto: '🗡️ Ir a atacar', panel: 'ejercito', datos: { solapa: 'atacar' } }
const IR_DEFENSA = { texto: '🛡️ Ver la defensa', panel: 'ejercito', datos: { solapa: 'defensa' } }
const IR_MAPA = { texto: '🗺️ Abrir el mapa', panel: 'mundo' }

const ENCARGOS = [
  {
    id: 'e01_serreria',
    titulo: 'Levanta una serrería',
    texto: 'Mi señor, sin madera no hay aldea.',
    consejo: 'levantad una serrería: sin madera no hay aldea.',
    ir: IR_TALLER,
    objetivo: { tipo: 'construir', que: 'serreria', total: 1 },
    recompensa: premio(rec(120, 60, 60), 5, 20),
    siguiente: 'e02_cantera'
  },
  {
    id: 'e02_cantera',
    titulo: 'Abre una cantera',
    texto: 'La madera arde. La piedra no.',
    consejo: 'abrid una cantera: la piedra es lo que siempre falta.',
    ir: IR_TALLER,
    objetivo: { tipo: 'construir', que: 'cantera', total: 1 },
    recompensa: premio(rec(80, 120, 60), 5, 25),
    siguiente: 'e03_granja'
  },
  {
    id: 'e03_granja',
    titulo: 'Siembra una granja',
    texto: 'La tropa marcha con el estómago.',
    consejo: 'sembrad una granja: la gente trabaja mejor comida.',
    ir: IR_TALLER,
    objetivo: { tipo: 'construir', que: 'granja', total: 1 },
    recompensa: premio(rec(100, 40, 150), 5, 25),
    siguiente: 'e04_casa'
  },
  {
    id: 'e04_casa',
    titulo: 'Construye una casa',
    texto: 'Duermen en el pajar y ya murmuran.',
    consejo: 'construid una casa: sin camas no llegan aldeanos nuevos.',
    ir: IR_TALLER,
    objetivo: { tipo: 'construir', que: 'casa', total: 1 },
    recompensa: premio(rec(120, 40, 100), 4, 30),
    siguiente: 'e05_gente'
  },
  {
    id: 'e05_gente',
    titulo: 'Ten 5 aldeanos',
    texto: 'Tres oficios sin cubrir, mi señor.',
    consejo: 'construid casas hasta llegar a cinco aldeanos.',
    ir: IR_TALLER,
    unidad: 'aldeanos',
    objetivo: { tipo: 'aldeanos', total: 5 },
    recompensa: premio(rec(150, 80, 150), 6, 35),
    siguiente: 'e06_ayto2'
  },
  {
    id: 'e06_ayto2',
    titulo: 'Sube el Ayuntamiento a nivel 2',
    texto: 'Si él no crece, la aldea tampoco.',
    consejo: 'subid el Ayuntamiento a nivel 2: manda sobre todo lo demás.',
    ir: IR_MEJORAS,
    objetivo: { tipo: 'nivel', que: 'ayuntamiento', total: 2 },
    recompensa: premio(rec(200, 120, 100), 8, 50),
    siguiente: 'e07_almacen'
  },
  {
    id: 'e07_almacen',
    titulo: 'Construye un almacén',
    texto: 'Lo que no cabe bajo techo, se pudre.',
    consejo: 'construid un almacén: lo que no cabe bajo techo se pierde.',
    ir: IR_TALLER,
    objetivo: { tipo: 'construir', que: 'almacen', total: 1 },
    recompensa: premio(rec(150, 150, 80), 6, 40),
    siguiente: 'e08_serreria2'
  },
  {
    id: 'e08_serreria2',
    titulo: 'Mejora la serrería a nivel 2',
    texto: 'Rinde el doble y ocupa lo mismo.',
    consejo: 'mejorad la serrería a nivel 2: al principio la madera manda.',
    ir: IR_MEJORAS,
    objetivo: { tipo: 'nivel', que: 'serreria', total: 2 },
    recompensa: premio(rec(180, 100, 100), 6, 45),
    siguiente: 'e09_hachas'
  },
  {
    id: 'e09_hachas',
    titulo: 'Investiga «Hachas afiladas»',
    texto: 'Los leñadores piden filo nuevo.',
    consejo: 'investigad «Hachas afiladas»: la primera tecnología cunde mucho.',
    ir: IR_CIENCIA,
    objetivo: { tipo: 'tecnologia', que: 'hachas_afiladas', total: 1 },
    recompensa: premio(rec(200, 120, 120), 8, 60),
    siguiente: 'e10_campamento'
  },
  {
    id: 'e10_campamento',
    titulo: 'Construye el campamento explorador',
    texto: 'Nadie de aquí ha cruzado el río.',
    consejo: 'levantad el campamento de exploradores: el mundo empieza ahí.',
    ir: IR_TALLER,
    objetivo: { tipo: 'construir', que: 'campamento_explorador', total: 1 },
    recompensa: premio(rec(150, 80, 150), 8, 50),
    siguiente: 'e11_expedicion'
  },
  {
    id: 'e11_expedicion',
    titulo: 'Manda una expedición',
    texto: 'Volverá con noticias. Eso interesa.',
    consejo: 'mandad una expedición desde el mapa del mundo.',
    ir: IR_MAPA,
    objetivo: { tipo: 'expedicion', total: 1 },
    recompensa: premio(rec(120, 60, 120), 10, 55),
    siguiente: 'e12_explorar'
  },
  {
    id: 'e12_explorar',
    titulo: 'Descubre 15 casillas del mapa',
    texto: 'Un mapa en blanco no vale nada.',
    consejo: 'explorad 15 casillas del mundo: ahí fuera hay grano y enemigos.',
    ir: IR_MAPA,
    unidad: 'casillas',
    objetivo: { tipo: 'explorar', total: 15 },
    recompensa: premio(rec(200, 100, 200), 10, 70),
    siguiente: 'e13_cuartel'
  },
  {
    id: 'e13_cuartel',
    titulo: 'Construye un cuartel',
    texto: 'Corren bandidos por el camino.',
    consejo: 'construid un cuartel: hace falta algo más que buenas palabras.',
    ir: IR_TALLER,
    objetivo: { tipo: 'construir', que: 'cuartel', total: 1 },
    recompensa: premio(rec(200, 100, 200), 10, 70),
    siguiente: 'e14_lanceros'
  },
  {
    id: 'e14_lanceros',
    titulo: 'Entrena 4 lanceros',
    texto: 'Baratos, y pesadilla de la caballería.',
    consejo: 'entrenad cuatro lanceros en el cuartel.',
    ir: IR_ENTRENAR,
    unidad: 'lanceros',
    objetivo: { tipo: 'tropas', que: 'lancero', total: 4 },
    recompensa: premio(rec(150, 100, 250), 10, 80),
    siguiente: 'e15_muralla'
  },
  {
    id: 'e15_muralla',
    titulo: 'Levanta 8 tramos de muralla',
    texto: 'Por ahí entran los que no llaman.',
    consejo: 'levantad ocho tramos de muralla y cerrad el flanco abierto.',
    ir: IR_TALLER,
    unidad: 'tramos',
    objetivo: { tipo: 'construir', que: 'muralla', total: 8 },
    recompensa: premio(rec(150, 250, 100), 10, 80),
    siguiente: 'e16_puerta'
  },
  {
    id: 'e16_puerta',
    titulo: 'Pon una puerta en la muralla',
    texto: 'Ahora nadie puede salir a por agua.',
    consejo: 'poned una puerta en la muralla, que por algún sitio hay que entrar.',
    ir: IR_TALLER,
    objetivo: { tipo: 'construir', que: 'puerta', total: 1 },
    recompensa: premio(rec(120, 180, 100), 8, 70),
    siguiente: 'e17_torre'
  },
  {
    id: 'e17_torre',
    titulo: 'Alza una torre vigía',
    texto: 'Defenderse empieza por ver venir.',
    consejo: 'alzad una torre vigía: defenderse empieza por ver venir.',
    ir: IR_TALLER,
    objetivo: { tipo: 'construir', que: 'torre_vigia', total: 1 },
    recompensa: premio(rec(150, 250, 100), 10, 90),
    siguiente: 'e18_donvela'
  },
  {
    id: 'e18_donvela',
    titulo: 'Gana un asalto a Don Vela',
    texto: 'Grano de sobra y guardias de menos.',
    consejo: 'asaltad una base enemiga del mapa y traed el botín a casa.',
    ir: IR_ATACAR,
    objetivo: { tipo: 'asalto', total: 1 },
    recompensa: premio(rec(250, 150, 350, 60), 15, 120),
    siguiente: 'e19_granero'
  },
  {
    id: 'e19_granero',
    titulo: 'Construye un granero',
    texto: 'El grano y el oro necesitan cerrojo.',
    consejo: 'construid un granero: el grano y el oro necesitan cerrojo.',
    ir: IR_TALLER,
    objetivo: { tipo: 'construir', que: 'granero', total: 1 },
    recompensa: premio(rec(180, 180, 150), 10, 90),
    siguiente: 'e20_feudal'
  },
  {
    id: 'e20_feudal',
    titulo: 'Avanza a la Edad Feudal',
    texto: 'Ya no somos cuatro chozas y un pozo.',
    consejo: 'avanzad a la Edad Feudal desde el Ayuntamiento.',
    ir: IR_EDAD,
    objetivo: { tipo: 'edad', que: 'feudal', total: 1 },
    recompensa: premio(rec(400, 300, 300, 100), 25, 200),
    siguiente: 'e21_oro'
  },
  {
    id: 'e21_oro',
    titulo: 'Abre una mina de oro',
    texto: 'Sin oro no hay tropa ni ciencia.',
    consejo: 'abrid una mina de oro: sin oro no hay buena tropa ni ciencia.',
    ir: IR_TALLER,
    objetivo: { tipo: 'construir', que: 'mina_oro', total: 1 },
    recompensa: premio(rec(250, 200, 200, 80), 12, 110),
    siguiente: 'e22_molino'
  },
  {
    id: 'e22_molino',
    titulo: 'Construye un molino',
    texto: 'Con dos granjas al lado, se acaba el hambre.',
    consejo: 'tened dos granjas y poned un molino cerca de ellas.',
    ir: IR_TALLER,
    pasos: [
      { texto: 'Dos granjas en pie', objetivo: { tipo: 'construir', que: 'granja', total: 2 } },
      { texto: 'Un molino cerca de ellas', objetivo: { tipo: 'construir', que: 'molino', total: 1 } }
    ],
    objetivo: { tipo: 'construir', que: 'molino', total: 1 },
    recompensa: premio(rec(250, 150, 350), 12, 110),
    siguiente: 'e23_mercado'
  },
  {
    id: 'e23_mercado',
    titulo: 'Levanta el mercado',
    texto: 'Cambia lo que sobra por lo que falta.',
    consejo: 'levantad el mercado: cambiad lo que os sobra por lo que os falta.',
    ir: IR_TALLER,
    objetivo: { tipo: 'construir', que: 'mercado', total: 1 },
    recompensa: premio(rec(300, 250, 200, 100), 14, 130),
    siguiente: 'e24_herreria'
  },
  {
    id: 'e24_herreria',
    titulo: 'Construye la herrería',
    texto: 'Mejora a todo el ejército de golpe.',
    consejo: 'construid la herrería: mejora a todo el ejército de golpe.',
    ir: IR_TALLER,
    objetivo: { tipo: 'construir', que: 'herreria', total: 1 },
    recompensa: premio(rec(300, 250, 200, 120), 15, 140),
    siguiente: 'e25_arqueria'
  },
  {
    id: 'e25_arqueria',
    titulo: 'Entrena 6 arqueros',
    texto: 'Antes hará falta una arquería.',
    consejo: 'construid la arquería y entrenad seis arqueros.',
    ir: IR_ENTRENAR,
    unidad: 'arqueros',
    pasos: [
      { texto: 'La arquería, construida', objetivo: { tipo: 'construir', que: 'arqueria', total: 1 } },
      { texto: 'Seis arqueros entrenados', objetivo: { tipo: 'tropas', que: 'arquero', total: 6 } }
    ],
    objetivo: { tipo: 'tropas', que: 'arquero', total: 6 },
    recompensa: premio(rec(300, 200, 300, 120), 15, 150),
    siguiente: 'e26_defender'
  },
  {
    id: 'e26_defender',
    titulo: 'Aguanta un asalto enemigo',
    texto: 'Alguien cree que tu granero es suyo.',
    consejo: 'aguantad un asalto enemigo: reforzad torres y murallas antes.',
    ir: IR_DEFENSA,
    objetivo: { tipo: 'defensa', total: 1 },
    recompensa: premio(rec(350, 350, 250, 100), 18, 160),
    siguiente: 'e27_ayto5'
  },
  {
    id: 'e27_ayto5',
    titulo: 'Sube el Ayuntamiento a nivel 5',
    texto: 'Desde ahí se puede hablar de castillos.',
    consejo: 'subid el Ayuntamiento a nivel 5: abre la Edad de los Castillos.',
    ir: IR_MEJORAS,
    objetivo: { tipo: 'nivel', que: 'ayuntamiento', total: 5 },
    recompensa: premio(rec(500, 400, 400, 150), 20, 200),
    siguiente: 'e28_castillos'
  },
  {
    id: 'e28_castillos',
    titulo: 'Avanza a la Edad de los Castillos',
    texto: 'Empieza la guerra de verdad.',
    consejo: 'avanzad a la Edad de los Castillos.',
    ir: IR_EDAD,
    objetivo: { tipo: 'edad', que: 'castillos', total: 1 },
    recompensa: premio(rec(800, 700, 600, 300), 35, 350),
    siguiente: 'e29_castillo'
  },
  {
    id: 'e29_castillo',
    titulo: 'Construye el castillo',
    texto: 'Quien lo tira, se lleva la aldea.',
    consejo: 'construid el castillo: es el corazón de vuestra defensa.',
    ir: IR_TALLER,
    objetivo: { tipo: 'construir', que: 'castillo', total: 1 },
    recompensa: premio(rec(700, 600, 500, 250), 30, 300),
    siguiente: 'e30_establo'
  },
  {
    id: 'e30_establo',
    titulo: 'Entrena 3 jinetes',
    texto: 'Del establo salen las victorias.',
    consejo: 'construid el establo y entrenad tres jinetes.',
    ir: IR_ENTRENAR,
    unidad: 'jinetes',
    pasos: [
      { texto: 'El establo, construido', objetivo: { tipo: 'construir', que: 'establo', total: 1 } },
      { texto: 'Tres jinetes entrenados', objetivo: { tipo: 'tropas', que: 'jinete', total: 3 } }
    ],
    objetivo: { tipo: 'tropas', que: 'jinete', total: 3 },
    recompensa: premio(rec(600, 400, 700, 250), 25, 280),
    siguiente: 'e31_universidad'
  },
  {
    id: 'e31_universidad',
    titulo: 'Levanta la universidad',
    texto: 'De ahí salen las mejores ideas.',
    consejo: 'levantad la universidad: de ahí salen las mejores tecnologías.',
    ir: IR_TALLER,
    objetivo: { tipo: 'construir', que: 'universidad', total: 1 },
    recompensa: premio(rec(700, 600, 500, 300), 28, 300),
    siguiente: 'e32_ciencia'
  },
  {
    id: 'e32_ciencia',
    titulo: 'Investiga 8 tecnologías',
    texto: 'La ciencia no se pierde nunca.',
    consejo: 'investigad hasta tener ocho tecnologías: la ciencia no se pierde nunca.',
    ir: IR_CIENCIA,
    unidad: 'tecnologías',
    objetivo: { tipo: 'tecnologias', total: 8 },
    recompensa: premio(rec(800, 700, 600, 400), 30, 350),
    siguiente: 'e33_imperial'
  },
  {
    id: 'e33_imperial',
    titulo: 'Avanza a la Edad Imperial',
    texto: 'Después ya solo quedan leyendas.',
    consejo: 'preparad Ayuntamiento, universidad y castillo: os espera la Edad Imperial.',
    ir: IR_EDAD,
    pasos: [
      { texto: 'Ayuntamiento a nivel 7', objetivo: { tipo: 'nivel', que: 'ayuntamiento', total: 7 } },
      { texto: 'Universidad a nivel 3', objetivo: { tipo: 'nivel', que: 'universidad', total: 3 } },
      { texto: 'Castillo a nivel 2', objetivo: { tipo: 'nivel', que: 'castillo', total: 2 } }
    ],
    objetivo: { tipo: 'edad', que: 'imperial', total: 1 },
    recompensa: premio(rec(2000, 1800, 1500, 900), 100, 1000),
    siguiente: null
  }
]

const PRIMER_ENCARGO = ENCARGOS[0].id
const POR_ID = new Map(ENCARGOS.map(e => [e.id, e]))

// ------------------------------------------------------------ TAREAS DIARIAS
/**
 * Solo objetivos "de flujo": empiezan a cero cada día y se miden con eventos.
 * Mismo criterio que los encargos: el título ES la orden, el texto es el adorno.
 */
const DIARIAS = [
  { id: 'd_madera', titulo: 'Recoge 500 de madera', texto: 'Leña para el día.', ir: IR_TALLER, unidad: 'de madera', objetivo: { tipo: 'recolectar', que: 'madera', total: 500 }, gemas: 5 },
  { id: 'd_piedra', titulo: 'Recoge 300 de piedra', texto: 'Los canteros protestarán; es su oficio.', ir: IR_TALLER, unidad: 'de piedra', objetivo: { tipo: 'recolectar', que: 'piedra', total: 300 }, gemas: 5 },
  { id: 'd_comida', titulo: 'Recoge 400 de comida', texto: 'Para llenar la despensa.', ir: IR_TALLER, unidad: 'de comida', objetivo: { tipo: 'recolectar', que: 'comida', total: 400 }, gemas: 5 },
  { id: 'd_oro', titulo: 'Recoge 100 de oro', texto: 'Contadlo dos veces, que hay manos largas.', ir: IR_TALLER, unidad: 'de oro', objetivo: { tipo: 'recolectar', que: 'oro', total: 100 }, gemas: 6 },
  { id: 'd_asalto', titulo: 'Gana un asalto', texto: 'Y vuelve con algo bajo el brazo.', ir: IR_ATACAR, objetivo: { tipo: 'asalto', total: 1 }, gemas: 8 },
  { id: 'd_expediciones', titulo: 'Manda 2 expediciones', texto: 'El mapa no se dibuja solo.', ir: IR_MAPA, unidad: 'expediciones', objetivo: { tipo: 'expedicion', total: 2 }, gemas: 6 },
  { id: 'd_explorar', titulo: 'Descubre 10 casillas', texto: 'Diez palmos de tierra nueva.', ir: IR_MAPA, unidad: 'casillas', objetivo: { tipo: 'explorar', total: 10 }, gemas: 6 },
  { id: 'd_tropas', titulo: 'Entrena 5 soldados', texto: 'Filas nuevas en el patio de armas.', ir: IR_ENTRENAR, unidad: 'soldados', objetivo: { tipo: 'entrenar', total: 5 }, gemas: 6 },
  { id: 'd_obra', titulo: 'Termina una construcción', texto: 'La que sea. Hasta un pozo cuenta.', ir: IR_TALLER, objetivo: { tipo: 'obras', total: 1 }, gemas: 5 },
  { id: 'd_mejora', titulo: 'Mejora un edificio', texto: 'Un peldaño más, el que quieras.', ir: IR_MEJORAS, objetivo: { tipo: 'mejoras', total: 1 }, gemas: 6 },
  { id: 'd_aldeano', titulo: 'Consigue un aldeano nuevo', texto: 'Uno más a la mesa.', ir: IR_TALLER, objetivo: { tipo: 'nuevoAldeano', total: 1 }, gemas: 5 },
  { id: 'd_ciencia', titulo: 'Termina una investigación', texto: 'Por pequeña que sea.', ir: IR_CIENCIA, objetivo: { tipo: 'investigar', total: 1 }, gemas: 8 },
  { id: 'd_defensa', titulo: 'Rechaza un ataque', texto: 'Que no pase nadie.', ir: IR_DEFENSA, objetivo: { tipo: 'defensa', total: 1 }, gemas: 8 },
  { id: 'd_botin', titulo: 'Trae 300 de botín', texto: 'De cualquier saqueo.', ir: IR_ATACAR, unidad: 'de botín', objetivo: { tipo: 'botin', total: 300 }, gemas: 7 }
]

const DIARIA_POR_ID = new Map(DIARIAS.map(d => [d.id, d]))

// ------------------------------------------------------------------- LOGROS
/** Permanentes, con escalones. Se cobran solos: son una palmada en la espalda. */
const LOGROS = [
  { id: 'l_constructor', nombre: 'Constructor', desc: 'Obras terminadas', metrica: { tipo: 'obras' }, escalones: [1, 5, 15, 30, 60] },
  { id: 'l_arquitecto', nombre: 'Nunca Está Acabado', desc: 'Mejoras de edificios', metrica: { tipo: 'mejoras' }, escalones: [1, 10, 25, 50] },
  { id: 'l_piedra', nombre: 'Señor de la Piedra', desc: 'Piedra recolectada', metrica: { tipo: 'recolectar', que: 'piedra' }, escalones: [1000, 10000, 50000, 200000] },
  { id: 'l_bosque', nombre: 'El Bosque lo Recuerda', desc: 'Madera recolectada', metrica: { tipo: 'recolectar', que: 'madera' }, escalones: [2000, 20000, 100000, 400000] },
  { id: 'l_pan', nombre: 'Pan para el Invierno', desc: 'Comida recolectada', metrica: { tipo: 'recolectar', que: 'comida' }, escalones: [2000, 20000, 100000] },
  { id: 'l_arcas', nombre: 'Las Arcas del Señor', desc: 'Oro recolectado', metrica: { tipo: 'recolectar', que: 'oro' }, escalones: [500, 5000, 25000] },
  { id: 'l_pueblo', nombre: 'Mucha Boca que Alimentar', desc: 'Aldeanos en la aldea', metrica: { tipo: 'aldeanos' }, escalones: [5, 10, 20, 35] },
  { id: 'l_reclutador', nombre: 'Filas Cerradas', desc: 'Soldados entrenados', metrica: { tipo: 'entrenar' }, escalones: [10, 50, 200, 500] },
  { id: 'l_guerrero', nombre: 'El que No Duerme', desc: 'Asaltos ganados', metrica: { tipo: 'asalto' }, escalones: [1, 10, 50, 150] },
  { id: 'l_baluarte', nombre: 'Nadie Pasa', desc: 'Ataques rechazados', metrica: { tipo: 'defensa' }, escalones: [1, 5, 25] },
  { id: 'l_explorador', nombre: 'Más Allá del Valle', desc: 'Casillas descubiertas', metrica: { tipo: 'explorar' }, escalones: [20, 100, 400, 1000] },
  { id: 'l_caminante', nombre: 'Polvo de Camino', desc: 'Expediciones enviadas', metrica: { tipo: 'expedicion' }, escalones: [1, 10, 50] },
  { id: 'l_sabio', nombre: 'Tinta y Pergamino', desc: 'Tecnologías investigadas', metrica: { tipo: 'tecnologias' }, escalones: [1, 5, 10, 18] },
  { id: 'l_siglos', nombre: 'El Paso de los Siglos', desc: 'Edades alcanzadas', metrica: { tipo: 'edadIndice' }, escalones: [1, 2, 3] },
  { id: 'l_vigias', nombre: 'Ojos en lo Alto', desc: 'Torres vigía en pie', metrica: { tipo: 'construir', que: 'torre_vigia' }, escalones: [1, 3, 6] },
  { id: 'l_murallero', nombre: 'Piedra sobre Piedra', desc: 'Tramos de muralla', metrica: { tipo: 'construir', que: 'muralla' }, escalones: [10, 40, 100] },
  { id: 'l_corazon', nombre: 'Corazón del Baluarte', desc: 'Nivel del Ayuntamiento', metrica: { tipo: 'nivel', que: 'ayuntamiento' }, escalones: [3, 5, 7, 8] },
  { id: 'l_serrador', nombre: 'El Serrador Mayor', desc: 'Nivel de la serrería', metrica: { tipo: 'nivel', que: 'serreria' }, escalones: [3, 5, 8] },
  { id: 'l_cantero', nombre: 'Manos de Cantero', desc: 'Nivel de la cantera', metrica: { tipo: 'nivel', que: 'cantera' }, escalones: [3, 5, 8] },
  { id: 'l_labrador', nombre: 'Buen Labrador', desc: 'Nivel de la granja', metrica: { tipo: 'nivel', que: 'granja' }, escalones: [3, 5, 8] },
  { id: 'l_mecenas', nombre: 'Mecenas del Valle', desc: 'Pozos y estandartes', metrica: { tipo: 'adorno' }, escalones: [1, 4, 8] },
  { id: 'l_botin', nombre: 'El Diezmo Ajeno', desc: 'Botín traído a casa', metrica: { tipo: 'botin' }, escalones: [500, 5000, 25000] },
  { id: 'l_hueste', nombre: 'La Hueste', desc: 'Soldados en pie a la vez', metrica: { tipo: 'tropas' }, escalones: [10, 30, 60] },
  { id: 'l_fiel', nombre: 'Fiel a la Torre', desc: 'Días seguidos de visita', metrica: { tipo: 'racha' }, escalones: [3, 7, 14, 30] },
  { id: 'l_diligente', nombre: 'Tarea Cumplida', desc: 'Tareas diarias completadas', metrica: { tipo: 'diarias' }, escalones: [3, 15, 50, 150] },
  { id: 'l_ordenes', nombre: 'A las Órdenes', desc: 'Encargos del mayordomo', metrica: { tipo: 'encargos' }, escalones: [5, 15, 30] }
]

const ESCALONES_TOTALES = LOGROS.reduce((n, l) => n + l.escalones.length, 0)

/** Gemas del escalón: el primero regala, el último se suda. */
const gemasEscalon = (i) => 5 + i * 8

// ------------------------------------------------------------------- estado

/** Devuelve `game.state.quests` con toda su forma garantizada. JSON puro. */
function qs () {
  const s = game.state
  if (!s.quests || typeof s.quests !== 'object') s.quests = {}
  const q = s.quests
  if (!Array.isArray(q.activas)) q.activas = []
  if (!Array.isArray(q.completadas)) q.completadas = []
  if (!Array.isArray(q.diarias)) q.diarias = []
  if (!q.racha || typeof q.racha !== 'object') q.racha = { dias: 0, mejor: 0, ultimoDia: null }
  if (typeof q.ultimaVisita !== 'string') q.ultimaVisita = null
  if (!q.logros || typeof q.logros !== 'object') q.logros = {}
  for (const l of LOGROS) if (!q.logros[l.id]) q.logros[l.id] = { valor: 0, escalon: 0 }
  return q
}

const claveDia = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Días enteros entre dos claves de fecha. null si alguna no vale. */
function diasEntre (a, b) {
  if (!a || !b) return null
  const pa = a.split('-').map(Number); const pb = b.split('-').map(Number)
  const ta = Date.UTC(pa[0], pa[1] - 1, pa[2]); const tb = Date.UTC(pb[0], pb[1] - 1, pb[2])
  return Math.round((tb - ta) / 86400000)
}

// ------------------------------------------------------- medir sobre estado

// Por NIVEL, no por andamios: una mejora en marcha no borra un edificio del censo.
const terminados = (tipo) => game.state.buildings.filter(b => b.tipo === tipo && (b.nivel || 0) > 0)

/**
 * Lee del estado los objetivos que se pueden leer. Solo se llama al activar un
 * encargo y cuando llega un evento que ha podido cambiarlos: nunca en bucle.
 * @returns {number|null} null si el objetivo es de flujo (solo eventos).
 */
function medir (obj) {
  const s = game.state
  switch (obj.tipo) {
    case 'construir': return terminados(obj.que).length
    case 'nivel': return terminados(obj.que).reduce((m, b) => Math.max(m, b.nivel || 1), 0)
    case 'aldeanos': return (s.villagers || []).length
    case 'tropas': {
      const t = s.ejercito?.tropas || {}
      if (!obj.que || obj.que === 'cualquiera') return Object.values(t).reduce((a, n) => a + (n || 0), 0)
      return t[obj.que] || 0
    }
    case 'edificios': return (s.buildings || []).filter(b => (b.nivel || 0) > 0).length
    case 'adorno': return terminados('estandarte').length + terminados('pozo').length
    case 'edad': return ORDEN_EDADES.indexOf(s.age) >= ORDEN_EDADES.indexOf(obj.que) ? 1 : 0
    case 'edadIndice': return Math.max(0, ORDEN_EDADES.indexOf(s.age))
    case 'tecnologia': return s.research?.[obj.que] ? 1 : 0
    case 'tecnologias': return Object.keys(s.research || {}).length
    case 'racha': return qs().racha.dias || 0
    case 'encargos': return qs().completadas.length
    default: return null
  }
}

const esDeEstado = (obj) => DE_ESTADO.has(obj.tipo)

// ---------------------------------------------------------- motor de avance

function encaja (obj, tipo, que) {
  if (obj.tipo !== tipo) return false
  if (!obj.que || obj.que === 'cualquiera') return true
  return obj.que === que
}

/** Suma progreso de flujo a todo lo que esté escuchando ese tipo de hecho. */
function sumar (tipo, que, cantidad = 1) {
  if (!(cantidad > 0)) return
  const q = qs()
  let cambio = false

  for (const a of q.activas) {
    const def = POR_ID.get(a.id)
    if (!def || a.listo || esDeEstado(def.objetivo)) continue
    if (encaja(def.objetivo, tipo, que)) { a.hecho += cantidad; cambio = true }
  }
  for (const d of q.diarias) {
    const def = DIARIA_POR_ID.get(d.id)
    if (!def || d.listo) continue
    if (encaja(def.objetivo, tipo, que)) { d.hecho += cantidad; cambio = true }
  }
  for (const l of LOGROS) {
    if (esDeEstado(l.metrica)) continue
    if (!encaja(l.metrica, tipo, que)) continue
    q.logros[l.id].valor += cantidad
    cambio = true
  }
  if (cambio) revisar()
}

/** Recalcula lo que se lee del estado. Solo se llama desde manejadores de evento. */
function refrescarEstado () {
  const q = qs()
  for (const a of q.activas) {
    const def = POR_ID.get(a.id)
    if (!def || a.listo) continue
    const v = medir(def.objetivo)
    if (v !== null) a.hecho = v
  }
  for (const l of LOGROS) {
    if (!esDeEstado(l.metrica)) continue
    const v = medir(l.metrica)
    // los logros de estado no bajan aunque se demuela: lo ganado, ganado está
    if (v !== null) q.logros[l.id].valor = Math.max(q.logros[l.id].valor, v)
  }
  revisar()
}

/** Marca lo cumplido, avisa una sola vez y cobra los logros (esos van solos). */
function revisar () {
  const q = qs()
  for (const a of q.activas) {
    const def = POR_ID.get(a.id)
    if (!def || a.listo) continue
    if (a.hecho >= def.objetivo.total) {
      a.listo = true
      a.hecho = def.objetivo.total
      events.emit(EV.UI_TOAST, { texto: `📜 Cumplido: ${def.titulo}`, tipo: 'bien' })
      events.emit(EV.SFX, { nombre: 'encargo_listo' })
    }
  }
  for (const d of q.diarias) {
    const def = DIARIA_POR_ID.get(d.id)
    if (!def || d.listo) continue
    if (d.hecho >= def.objetivo.total) {
      d.listo = true
      d.hecho = def.objetivo.total
      events.emit(EV.UI_TOAST, { texto: `✅ Tarea del día: ${def.titulo}`, tipo: 'bien' })
    }
  }
  cobrarLogros()
}

/**
 * Los logros se pagan solos: son una palmada en la espalda, no un recado.
 * Y avisan UNA vez por tanda: al empezar caen varios escalones de golpe y
 * encadenar cinco toasts tapa la aldea entera.
 */
function cobrarLogros () {
  const q = qs()
  const nuevos = []
  let gemasTanda = 0
  for (const l of LOGROS) {
    const est = q.logros[l.id]
    while (est.escalon < l.escalones.length && est.valor >= l.escalones[est.escalon]) {
      const g = gemasEscalon(est.escalon)
      est.escalon++
      gemas(g, `logro ${l.nombre}`)
      darXp(g * 5)
      gemasTanda += g
      const grado = est.escalon > 3 ? `${est.escalon}` : 'I'.repeat(est.escalon)
      nuevos.push(`${l.nombre} ${grado}`)
      events.emit(EV.QUEST_COMPLETED, {
        quest: { id: l.id, clase: 'logro', titulo: l.nombre, escalon: est.escalon },
        recompensa: { recursos: {}, gemas: g, xp: g * 5 }
      })
    }
  }
  if (!nuevos.length) return
  events.emit(EV.UI_TOAST, {
    texto: nuevos.length === 1
      ? `🏅 ${nuevos[0]} · +${gemasTanda} ${ICONO.gemas}`
      : `🏅 ${nuevos.length} medallas nuevas · +${gemasTanda} ${ICONO.gemas}`,
    tipo: 'bien'
  })
}

/** La XP vive en jugador.xp; el nivel lo lleva la progresión, aquí solo se suma. */
function darXp (xp) {
  if (!xp) return
  game.state.jugador.xp = (game.state.jugador.xp || 0) + xp
}

// ------------------------------------------------------- cadena de encargos

function activar (id) {
  if (!id) return
  const def = POR_ID.get(id)
  const q = qs()
  if (!def || q.completadas.includes(id) || q.activas.some(a => a.id === id)) return
  const inicial = medir(def.objetivo)
  q.activas.push({
    id,
    clase: 'encargo',
    hecho: inicial === null ? 0 : Math.min(inicial, def.objetivo.total),
    listo: false
  })
  // sin toast de «nuevo encargo»: ya se ve en la tira del mayordomo y en el panel
  revisar()
}

/** Si no hay ningún encargo en curso, engancha el primero que quede pendiente. */
function asegurarCadena () {
  const q = qs()
  if (q.activas.length) return
  let id = PRIMER_ENCARGO
  while (id && q.completadas.includes(id)) id = POR_ID.get(id)?.siguiente || null
  if (id) activar(id)
}

// -------------------------------------------------------- día nuevo y racha

/** Tres tareas por día: el mismo día siempre saca las mismas, se recargue o no. */
function elegirDiarias (dia) {
  let semilla = 0
  for (let i = 0; i < dia.length; i++) semilla = (semilla * 31 + dia.charCodeAt(i)) >>> 0
  const bolsa = DIARIAS.slice()
  const elegidas = []
  for (let i = 0; i < 3 && bolsa.length; i++) {
    semilla = (semilla * 1664525 + 1013904223) >>> 0
    elegidas.push(bolsa.splice(semilla % bolsa.length, 1)[0])
  }
  return elegidas.map(d => ({ id: d.id, clase: 'diaria', hecho: 0, listo: false, reclamada: false }))
}

/**
 * ¿Ha cambiado el día? Renueva las tareas y mueve la racha.
 * La racha es la razón número uno para volver mañana: sube la recompensa de
 * todo lo diario y suelta cofre en los días redondos.
 * @returns {boolean} si ha habido día nuevo
 */
function comprobarDia () {
  const q = qs()
  const hoy = claveDia()
  if (q.ultimaVisita === hoy && q.diarias.length) return false

  const salto = diasEntre(q.ultimaVisita, hoy)
  if (q.ultimaVisita === null) q.racha.dias = 1
  else if (salto === 1) q.racha.dias = (q.racha.dias || 0) + 1
  else if (salto === 0) q.racha.dias = Math.max(1, q.racha.dias || 1)
  else q.racha.dias = 1                      // se saltó un día: la racha se rompe

  q.racha.mejor = Math.max(q.racha.mejor || 0, q.racha.dias)
  q.racha.ultimoDia = hoy
  q.ultimaVisita = hoy
  q.diarias = elegirDiarias(hoy)

  // un solo aviso por día: el cofre de racha y el «día nuevo» van juntos
  const cofre = { 3: 10, 7: 25, 14: 40, 30: 100 }[q.racha.dias]
  if (cofre) gemas(cofre, `racha de ${q.racha.dias} días`)
  const primera = salto === null                    // partida recién empezada
  if (!primera) {
    events.emit(EV.UI_TOAST, {
      texto: cofre
        ? `🔥 ${q.racha.dias} días seguidos · cofre +${cofre} ${ICONO.gemas}`
        : `🌅 Día nuevo: tres tareas frescas y ${q.racha.dias} día${q.racha.dias === 1 ? '' : 's'} de racha`,
      tipo: 'bien'
    })
  }
  refrescarEstado()
  return true
}

/** Multiplicador de la racha sobre las gemas diarias: del x1 al x2. */
const multiplicadorRacha = () => 1 + Math.min(10, Math.max(0, (qs().racha.dias || 1) - 1)) * 0.1

const premioDiaria = (def) => ({ recursos: {}, gemas: Math.round(def.gemas * multiplicadorRacha()), xp: def.gemas * 4 })

// --------------------------------------------------------------- API pública

/**
 * Encargos y tareas del día en curso, con su progreso.
 * @returns {Array<{id:string,clase:string,titulo:string,texto:string,consejo:string,progreso:{hecho:number,total:number},listo:boolean,recompensa:any}>}
 */
export function activas () {
  const q = qs()
  const lista = []
  for (const a of q.activas) {
    const def = POR_ID.get(a.id)
    if (!def) continue
    lista.push({
      id: def.id,
      clase: 'encargo',
      titulo: def.titulo,
      texto: def.texto,
      consejo: def.consejo,
      ir: def.ir || null,
      unidad: def.unidad || '',
      objetivo: { ...def.objetivo },
      pasos: listaPasos(def),
      progreso: { hecho: Math.min(a.hecho, def.objetivo.total), total: def.objetivo.total },
      listo: !!a.listo,
      recompensa: def.recompensa
    })
  }
  for (const d of q.diarias) {
    const def = DIARIA_POR_ID.get(d.id)
    if (!def || d.reclamada) continue
    lista.push({
      id: def.id,
      clase: 'diaria',
      titulo: def.titulo,
      texto: def.texto,
      consejo: def.texto,
      ir: def.ir || null,
      unidad: def.unidad || '',
      objetivo: { ...def.objetivo },
      pasos: [],
      progreso: { hecho: Math.min(d.hecho, def.objetivo.total), total: def.objetivo.total },
      listo: !!d.listo,
      recompensa: premioDiaria(def)
    })
  }
  return lista
}

/**
 * Lista de comprobación de un encargo que pide varias cosas a la vez. Se calcula
 * al vuelo (no se guarda: el estado sigue siendo JSON puro y pequeño).
 * @returns {Array<{texto:string,hecho:boolean}>} vacía si el encargo pide una sola cosa
 */
function listaPasos (def) {
  if (!Array.isArray(def.pasos) || !def.pasos.length) return []
  return def.pasos.map(p => {
    const v = medir(p.objetivo)
    return { texto: p.texto, hecho: v !== null && v >= p.objetivo.total }
  })
}

/**
 * Los encargos que vienen DESPUÉS del que está en curso, solo el título.
 * Sirve para el «y luego…» discreto del panel: se ve que la cosa sigue,
 * sin robarle la atención al encargo de ahora.
 * @param {number} n cuántos
 * @returns {Array<{id:string,titulo:string}>}
 */
export function proximos (n = 3) {
  const q = qs()
  const enCurso = q.activas.find(a => POR_ID.has(a.id))
  let id = enCurso ? POR_ID.get(enCurso.id)?.siguiente : PRIMER_ENCARGO
  const fuera = []
  while (id && fuera.length < n) {
    const def = POR_ID.get(id)
    if (!def) break
    if (!q.completadas.includes(id)) fuera.push({ id: def.id, titulo: def.titulo })
    id = def.siguiente
  }
  return fuera
}

/** Los 26 logros con su escalón actual, para la pantalla de perfil. */
export function logros () {
  const q = qs()
  return LOGROS.map(l => {
    const est = q.logros[l.id]
    const meta = l.escalones[Math.min(est.escalon, l.escalones.length - 1)]
    return {
      id: l.id,
      nombre: l.nombre,
      desc: l.desc,
      escalon: est.escalon,
      escalones: l.escalones.length,
      completo: est.escalon >= l.escalones.length,
      progreso: { hecho: Math.min(est.valor, meta), total: meta }
    }
  })
}

/** Estado de la racha, para el cartel de "llevas N días seguidos". */
export function racha () {
  const q = qs()
  return {
    dias: q.racha.dias || 0,
    mejor: q.racha.mejor || 0,
    multiplicador: Math.round(multiplicadorRacha() * 100) / 100
  }
}

/**
 * Paga la recompensa, avisa al resto del juego y encadena el siguiente encargo.
 * @param {string} id de encargo o de tarea diaria
 * @returns {boolean} si se ha cobrado algo
 */
export function reclamar (id) {
  const q = qs()

  // --- encargo de la campaña ---
  const i = q.activas.findIndex(a => a.id === id)
  if (i >= 0) {
    const a = q.activas[i]
    const def = POR_ID.get(a.id)
    if (!def || !a.listo) return false
    q.activas.splice(i, 1)
    q.completadas.push(def.id)
    pagar(def.recompensa, def.titulo)
    events.emit(EV.QUEST_COMPLETED, {
      quest: { id: def.id, clase: 'encargo', titulo: def.titulo },
      recompensa: def.recompensa
    })
    activar(def.siguiente)
    refrescarEstado()        // el encargo nuevo nace contando lo que ya esté hecho
    if (!def.siguiente) {
      events.emit(EV.UI_TOAST, { texto: '👑 Mi señor, ya no tengo nada que enseñaros. El valle es vuestro.', tipo: 'bien' })
    }
    return true
  }

  // --- tarea diaria ---
  const d = q.diarias.find(x => x.id === id)
  if (d) {
    const def = DIARIA_POR_ID.get(d.id)
    if (!def || !d.listo || d.reclamada) return false
    d.reclamada = true
    const recompensa = premioDiaria(def)
    pagar(recompensa, def.titulo)
    q.logros.l_diligente.valor++
    events.emit(EV.QUEST_COMPLETED, {
      quest: { id: def.id, clase: 'diaria', titulo: def.titulo },
      recompensa
    })
    if (q.diarias.every(x => x.reclamada)) {
      const extra = 5 + Math.min(15, q.racha.dias || 1)
      gemas(extra, 'las tres tareas del día')
      events.emit(EV.UI_TOAST, { texto: `🎁 Las tres tareas del día, cumplidas: +${extra} ${ICONO.gemas}`, tipo: 'bien' })
    }
    cobrarLogros()
    return true
  }
  return false
}

/**
 * Los recursos de una recompensa entran por la misma puerta que los recolectados
 * y emiten RESOURCE_GAINED: esta bandera evita que una tarea de "recolecta 500
 * de madera" se pague a sí misma con su propio premio.
 */
let pagandoPremio = false

function pagar (recompensa, motivo = '') {
  if (!recompensa) return
  pagandoPremio = true
  try {
    if (recompensa.recursos) ingresarVarios(recompensa.recursos)
    if (recompensa.gemas) gemas(recompensa.gemas, motivo)
  } finally {
    pagandoPremio = false
  }
  darXp(recompensa.xp || 0)
}

/**
 * Qué hay que hacer AHORA MISMO: la frase y a qué pantalla lleva.
 * Primero lo que ya se puede cobrar, luego el encargo en curso y, si todo está
 * al día, el agujero más gordo de la aldea (almacén, camas, brazos, defensa…).
 * Siempre devuelve algo: el jugador nunca se queda mirando la pantalla.
 * @returns {{texto:string, ir:{texto:string,panel:string,datos?:object}|null}}
 */
function diagnostico () {
  const s = game.state
  const enCurso = activas()

  const listo = enCurso.find(x => x.listo)
  if (listo) {
    return {
      texto: `Mi señor, ${listo.clase === 'diaria' ? 'la tarea' : 'el encargo'} «${listo.titulo}» está cumplido: reclamad la recompensa.`,
      ir: { texto: '🎁 Cobrar recompensa', panel: 'encargos' }
    }
  }

  const encargo = enCurso.find(x => x.clase === 'encargo')
  if (encargo && encargo.progreso.hecho === 0) {
    return { texto: `Mi señor, ${encargo.consejo}`, ir: encargo.ir }
  }

  // --- diagnóstico de la aldea: lo más urgente primero ---
  const lleno = CONFIG.RECURSOS.find(r => (s.almacen?.[r] || 0) > 0 && s.recursos[r] >= s.almacen[r] * 0.92)
  if (lleno) {
    const donde = (lleno === 'madera' || lleno === 'piedra') ? 'el almacén' : 'el granero'
    return { texto: `Se está desperdiciando ${ICONO[lleno]} ${lleno}: gastadla ya o ampliad ${donde}.`, ir: IR_MEJORAS }
  }

  if ((s.villagers || []).length >= topePoblacion()) {
    return { texto: 'No cabe un alma más en la aldea: levantad una casa o ampliad el Ayuntamiento.', ir: IR_TALLER }
  }

  const ociosos = (s.villagers || []).filter(v => !v.buildingId && (!v.job || v.job === 'ocioso' || v.job === 'libre')).length
  if (ociosos > 0) {
    return { texto: `Hay ${ociosos} aldeano${ociosos === 1 ? '' : 's'} de brazos cruzados: mandadlos a una serrería, cantera o granja.`, ir: null }
  }

  if (!(s.obras || []).length) {
    if (terminados('casa').length < 3) return { texto: 'Ninguna obra en marcha: con otra casa entrará gente nueva.', ir: IR_TALLER }
    return { texto: 'Ninguna obra en marcha, mi señor. Mejorad lo que más rinde: la serrería o la cantera.', ir: IR_MEJORAS }
  }

  const torres = terminados('torre_vigia').length + terminados('torre_ballesta').length
  if (torres < 2 && terminados('ayuntamiento').some(b => (b.nivel || 1) >= 2)) {
    return { texto: 'La defensa está floja: alzad otra torre vigía antes de que os visiten.', ir: IR_TALLER }
  }
  if (terminados('muralla').length < 12 && (s.buildings || []).length > 8) {
    return { texto: 'La aldea está abierta por los cuatro costados: cerradla con muralla.', ir: IR_TALLER }
  }

  const tropas = Object.values(s.ejercito?.tropas || {}).reduce((a, n) => a + (n || 0), 0)
  if (tropas >= 6 && !(s.expediciones || []).length) {
    return { texto: `Tenéis ${tropas} soldados sin estrenar: mandad un asalto y volved con botín.`, ir: IR_ATACAR }
  }
  if (tropas < 4 && terminados('cuartel').length) {
    return { texto: 'El cuartel está vacío: entrenad unos lanceros, que son baratos.', ir: IR_ENTRENAR }
  }

  if (terminados('campamento_explorador').length && !(s.expediciones || []).length) {
    return { texto: 'Los exploradores se aburren: mandad una expedición al mapa del mundo.', ir: IR_MAPA }
  }

  const pendiente = enCurso.find(x => !x.listo)
  if (pendiente) {
    return { texto: `Mi señor, ${pendiente.clase === 'encargo' ? pendiente.consejo : pendiente.texto}`, ir: pendiente.ir }
  }

  const edad = ORDEN_EDADES.indexOf(s.age)
  if (edad < ORDEN_EDADES.length - 1) {
    return { texto: `Todo está en orden: juntad recursos y avanzad a la ${AGE_NOMBRE[ORDEN_EDADES[edad + 1]]}.`, ir: IR_EDAD }
  }
  return { texto: 'El baluarte va sobre ruedas, mi señor. Saquead a los vecinos y disfrutad del vino.', ir: IR_ATACAR }
}

/**
 * Qué debería hacer el jugador AHORA MISMO, en una frase. (La usa el HUD.)
 * @returns {string}
 */
export function siguienteConsejo () {
  return diagnostico().texto
}

/**
 * Lo mismo, pero con el destino: el panel puede poner un botón que lleve allí.
 * @returns {{texto:string, ir:{texto:string,panel:string,datos?:object}|null}}
 */
export function siguienteAccion () {
  return diagnostico()
}

/** Tope de población que aguanta la aldea ahora mismo (casas + ayuntamiento). */
function topePoblacion () {
  let tope = 0
  for (const b of game.state.buildings || []) {
    if ((b.nivel || 0) <= 0) continue
    const d = EDIFICIOS[b.tipo]
    if (!d) continue
    if (d.aloja) tope += d.aloja(b.nivel || 1)
    if (d.poblacionMax) tope += d.poblacionMax(b.nivel || 1)
  }
  return tope || 5
}

/** @returns {number} porcentaje de partida completada, para el perfil. */
export function progreso () {
  const q = qs()
  const campana = q.completadas.filter(id => POR_ID.has(id)).length / ENCARGOS.length
  const medallas = LOGROS.reduce((n, l) => n + q.logros[l.id].escalon, 0) / ESCALONES_TOTALES
  const edad = Math.max(0, ORDEN_EDADES.indexOf(game.state.age)) / (ORDEN_EDADES.length - 1)
  return Math.round((campana * 0.55 + medallas * 0.30 + edad * 0.15) * 100)
}

// ------------------------------------------------------------------ arranque

let segundosDesdeRevision = 0

export function init () {
  qs()
  comprobarDia()
  refrescarEstado()
  asegurarCadena()

  // partida recargada o importada: rehacer la foto entera
  events.on(EV.STATE_LOADED, () => {
    qs(); comprobarDia(); refrescarEstado(); asegurarCadena()
  })

  // --- construcción ---
  events.on(EV.BUILD_COMPLETED, ({ building } = {}) => { sumar('obras', building?.tipo, 1); refrescarEstado() })
  events.on(EV.BUILD_UPGRADED, ({ building } = {}) => { sumar('mejoras', building?.tipo, 1); refrescarEstado() })
  events.on(EV.BUILD_DEMOLISHED, () => refrescarEstado())

  // --- aldeanos ---
  events.on(EV.VILLAGER_SPAWNED, () => { sumar('nuevoAldeano', null, 1); refrescarEstado() })
  events.on(EV.VILLAGER_ASSIGNED, () => refrescarEstado())

  // --- recursos: solo cuenta lo que entra de verdad en la caja ---
  events.on(EV.RESOURCE_GAINED, ({ tipo, cantidad } = {}) => {
    if (pagandoPremio) return
    if (tipo && cantidad > 0) sumar('recolectar', tipo, cantidad)
  })

  // --- ejército y guerra ---
  events.on(EV.UNIT_TRAINED, ({ tipo, cantidad } = {}) => { sumar('entrenar', tipo, cantidad || 1); refrescarEstado() })
  events.on(EV.RAID_RESOLVED, ({ victoria, botin } = {}) => {
    if (victoria) sumar('asalto', null, 1)
    const total = botin ? Object.values(botin).reduce((a, n) => a + (Number(n) || 0), 0) : 0
    if (total > 0) sumar('botin', null, Math.round(total))
    refrescarEstado()
  })
  events.on(EV.DEFENSE_RESOLVED, ({ victoria } = {}) => {
    if (victoria) sumar('defensa', null, 1)
    refrescarEstado()
  })

  // --- mundo ---
  events.on(EV.SCOUT_SENT, () => sumar('expedicion', null, 1))
  events.on(EV.SCOUT_RETURNED, () => refrescarEstado())
  events.on(EV.WORLD_REVEALED, ({ tiles } = {}) => {
    const n = Array.isArray(tiles) ? tiles.length : (Number(tiles) || 0)
    if (n > 0) sumar('explorar', null, n)
  })

  // --- progresión ---
  events.on(EV.TECH_RESEARCHED, () => { sumar('investigar', null, 1); refrescarEstado() })
  events.on(EV.AGE_ADVANCED, () => refrescarEstado())
  events.on(EV.LEVEL_UP, () => refrescarEstado())

  // El cambio de día se mira una vez por minuto, no en cada tick.
  events.on(EV.TICK, ({ dt } = {}) => {
    segundosDesdeRevision += dt || 0
    if (segundosDesdeRevision < 60) return
    segundosDesdeRevision = 0
    if (comprobarDia()) asegurarCadena()
  })
}
