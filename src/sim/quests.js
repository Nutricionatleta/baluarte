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
 * `consejo` es lo que el mayordomo suelta en grande cuando el jugador abre el
 * juego sin saber por dónde seguir; el `texto` es el sabor.
 */
const ENCARGOS = [
  {
    id: 'e01_serreria',
    titulo: 'Sin madera no hay aldea',
    texto: 'Mi señor, con buena voluntad no se levanta un tejado. Mandad alzar una serrería antes de que el invierno nos pille a la intemperie.',
    consejo: 'levantad una serrería: sin madera no hay aldea.',
    objetivo: { tipo: 'construir', que: 'serreria', total: 1 },
    recompensa: premio(rec(120, 60, 60), 5, 20),
    siguiente: 'e02_cantera'
  },
  {
    id: 'e02_cantera',
    titulo: 'Piedra para lo serio',
    texto: 'La madera arde, mi señor. La piedra no. Abrid una cantera y dormiremos todos más tranquilos.',
    consejo: 'abrid una cantera: la piedra es lo que siempre falta.',
    objetivo: { tipo: 'construir', que: 'cantera', total: 1 },
    recompensa: premio(rec(80, 120, 60), 5, 25),
    siguiente: 'e03_granja'
  },
  {
    id: 'e03_granja',
    titulo: 'Nabos, gloriosos nabos',
    texto: 'La tropa marcha con el estómago, no con el estandarte. Una granja, y que siembren de una vez.',
    consejo: 'sembrad una granja: la gente trabaja mejor comida.',
    objetivo: { tipo: 'construir', que: 'granja', total: 1 },
    recompensa: premio(rec(100, 40, 150), 5, 25),
    siguiente: 'e04_casa'
  },
  {
    id: 'e04_casa',
    titulo: 'Techo y jergón',
    texto: 'Duermen en el pajar, mi señor, y ya murmuran. Una casa de adobe y paja bastará… por ahora.',
    consejo: 'construid una casa: sin camas no llegan aldeanos nuevos.',
    objetivo: { tipo: 'construir', que: 'casa', total: 1 },
    recompensa: premio(rec(120, 40, 100), 4, 30),
    siguiente: 'e05_gente'
  },
  {
    id: 'e05_gente',
    titulo: 'Manos, que faltan manos',
    texto: 'Cinco almas en la aldea y tres oficios sin cubrir. Llamad a más gente del camino.',
    consejo: 'reclutad aldeanos hasta ser cinco: hacen falta manos.',
    objetivo: { tipo: 'aldeanos', total: 5 },
    recompensa: premio(rec(150, 80, 150), 6, 35),
    siguiente: 'e06_ayto2'
  },
  {
    id: 'e06_ayto2',
    titulo: 'La casa grande',
    texto: 'Si el ayuntamiento no crece, mi señor, la aldea tampoco. Ampliadlo y todo lo demás os seguirá.',
    consejo: 'subid el Ayuntamiento a nivel 2: manda sobre todo lo demás.',
    objetivo: { tipo: 'nivel', que: 'ayuntamiento', total: 2 },
    recompensa: premio(rec(200, 120, 100), 8, 50),
    siguiente: 'e07_almacen'
  },
  {
    id: 'e07_almacen',
    titulo: 'Lo que no cabe, se pudre',
    texto: 'Tenemos troncos apilados en la plaza y la lluvia no perdona. Un almacén, mi señor, y que sea hoy.',
    consejo: 'construid un almacén: lo que no cabe bajo techo se pierde.',
    objetivo: { tipo: 'construir', que: 'almacen', total: 1 },
    recompensa: premio(rec(150, 150, 80), 6, 40),
    siguiente: 'e08_serreria2'
  },
  {
    id: 'e08_serreria2',
    titulo: 'Más filo, más vigas',
    texto: 'Una serrería de nivel dos rinde lo que dos de nivel uno y ocupa la mitad de sitio. Números, mi señor.',
    consejo: 'mejorad la serrería a nivel 2: al principio la madera manda.',
    objetivo: { tipo: 'nivel', que: 'serreria', total: 2 },
    recompensa: premio(rec(180, 100, 100), 6, 45),
    siguiente: 'e09_hachas'
  },
  {
    id: 'e09_hachas',
    titulo: 'Tinta y limadura',
    texto: 'Los leñadores piden filo nuevo. Investigad las hachas afiladas: será la primera idea buena de vuestro reinado.',
    consejo: 'investigad «Hachas afiladas»: la primera tecnología cunde mucho.',
    objetivo: { tipo: 'tecnologia', que: 'hachas_afiladas', total: 1 },
    recompensa: premio(rec(200, 120, 120), 8, 60),
    siguiente: 'e10_campamento'
  },
  {
    id: 'e10_campamento',
    titulo: 'Qué habrá detrás del monte',
    texto: 'Nadie de aquí ha cruzado el río. Levantad un campamento de exploradores y salgamos de dudas.',
    consejo: 'levantad el campamento de exploradores: el mundo empieza ahí.',
    objetivo: { tipo: 'construir', que: 'campamento_explorador', total: 1 },
    recompensa: premio(rec(150, 80, 150), 8, 50),
    siguiente: 'e11_expedicion'
  },
  {
    id: 'e11_expedicion',
    titulo: 'El primer camino',
    texto: 'Mandad un explorador al valle. Volverá con los pies deshechos y con noticias; lo segundo nos interesa.',
    consejo: 'mandad una expedición al mapa del mundo.',
    objetivo: { tipo: 'expedicion', total: 1 },
    recompensa: premio(rec(120, 60, 120), 10, 55),
    siguiente: 'e12_explorar'
  },
  {
    id: 'e12_explorar',
    titulo: 'Dibujad el valle',
    texto: 'Un mapa en blanco no vale nada. Descubrid quince palmos de tierra y empezaremos a tener uno.',
    consejo: 'explorad 15 casillas del mundo: ahí fuera hay grano y enemigos.',
    objetivo: { tipo: 'explorar', total: 15 },
    recompensa: premio(rec(200, 100, 200), 10, 70),
    siguiente: 'e13_cuartel'
  },
  {
    id: 'e13_cuartel',
    titulo: 'Cuatro jergones y un sargento',
    texto: 'Corren bandidos por el camino, mi señor. Un cuartel, aunque sea pequeño, cambia mucho las conversaciones.',
    consejo: 'construid un cuartel: hace falta algo más que buenas palabras.',
    objetivo: { tipo: 'construir', que: 'cuartel', total: 1 },
    recompensa: premio(rec(200, 100, 200), 10, 70),
    siguiente: 'e14_lanceros'
  },
  {
    id: 'e14_lanceros',
    titulo: 'Lanzas al frente',
    texto: 'Cuatro lanceros. Baratos, abundantes y la pesadilla de cualquiera que venga a caballo.',
    consejo: 'entrenad cuatro lanceros en el cuartel.',
    objetivo: { tipo: 'tropas', que: 'lancero', total: 4 },
    recompensa: premio(rec(150, 100, 250), 10, 80),
    siguiente: 'e15_muralla'
  },
  {
    id: 'e15_muralla',
    titulo: 'Cerrad el flanco norte',
    texto: 'Los muros no se alzan solos, mi señor. Ocho tramos de piedra por donde entran los que no llaman a la puerta.',
    consejo: 'levantad ocho tramos de muralla y cerrad el flanco abierto.',
    objetivo: { tipo: 'construir', que: 'muralla', total: 8 },
    recompensa: premio(rec(150, 250, 100), 10, 80),
    siguiente: 'e16_puerta'
  },
  {
    id: 'e16_puerta',
    titulo: 'Por algún sitio hay que entrar',
    texto: 'Hemos amurallado hasta el pozo y ahora nadie puede salir a por agua. Una puerta, por caridad.',
    consejo: 'poned una puerta en la muralla, que por algún sitio hay que entrar.',
    objetivo: { tipo: 'construir', que: 'puerta', total: 1 },
    recompensa: premio(rec(120, 180, 100), 8, 70),
    siguiente: 'e17_torre'
  },
  {
    id: 'e17_torre',
    titulo: 'Ojos en lo alto',
    texto: 'Dos arqueros aburridos en una torre valen por veinte hombres corriendo. Alzad una torre vigía.',
    consejo: 'alzad una torre vigía: defenderse empieza por ver venir.',
    objetivo: { tipo: 'construir', que: 'torre_vigia', total: 1 },
    recompensa: premio(rec(150, 250, 100), 10, 90),
    siguiente: 'e18_donvela'
  },
  {
    id: 'e18_donvela',
    titulo: 'El grano de Don Vela',
    texto: 'Corre el rumor de que Don Vela guarda grano de sobra y guardias de menos. Sería una lástima desaprovecharlo.',
    consejo: 'asaltad una base enemiga del mapa y traed el botín a casa.',
    objetivo: { tipo: 'asalto', total: 1 },
    recompensa: premio(rec(250, 150, 350, 60), 15, 120),
    siguiente: 'e19_granero'
  },
  {
    id: 'e19_granero',
    titulo: 'Grano seco, monedas contadas',
    texto: 'El botín de Don Vela está en la plaza, a la vista de todo el mundo. Un granero, mi señor, y con cerrojo.',
    consejo: 'construid un granero: el grano y el oro necesitan cerrojo.',
    objetivo: { tipo: 'construir', que: 'granero', total: 1 },
    recompensa: premio(rec(180, 180, 150), 10, 90),
    siguiente: 'e20_feudal'
  },
  {
    id: 'e20_feudal',
    titulo: 'Se acaba la Edad Oscura',
    texto: 'Ya no somos cuatro chozas y un pozo. Avanzad a la Edad Feudal y que el valle se entere.',
    consejo: 'avanzad a la Edad Feudal desde el Ayuntamiento.',
    objetivo: { tipo: 'edad', que: 'feudal', total: 1 },
    recompensa: premio(rec(400, 300, 300, 100), 25, 200),
    siguiente: 'e21_oro'
  },
  {
    id: 'e21_oro',
    titulo: 'El metal que todo lo compra',
    texto: 'Sin oro no hay tropa decente ni ciencia ninguna, mi señor. Abrid una mina y que piquen.',
    consejo: 'abrid una mina de oro: sin oro no hay buena tropa ni ciencia.',
    objetivo: { tipo: 'construir', que: 'mina_oro', total: 1 },
    recompensa: premio(rec(250, 200, 200, 80), 12, 110),
    siguiente: 'e22_molino'
  },
  {
    id: 'e22_molino',
    titulo: 'Dos granjas y un molino',
    texto: 'Dos granjas juntas y un molino en medio: la aldea deja de pasar hambre para siempre.',
    consejo: 'tened dos granjas y poned un molino cerca de ellas.',
    objetivo: { tipo: 'construir', que: 'molino', total: 1 },
    recompensa: premio(rec(250, 150, 350), 12, 110),
    siguiente: 'e23_mercado'
  },
  {
    id: 'e23_mercado',
    titulo: 'Cambiad lo que sobra',
    texto: 'Nos sobra madera y nos falta piedra. Un mercado, y que el tendero se lleve lo suyo sin robar del todo.',
    consejo: 'levantad el mercado: cambiad lo que os sobra por lo que os falta.',
    objetivo: { tipo: 'construir', que: 'mercado', total: 1 },
    recompensa: premio(rec(300, 250, 200, 100), 14, 130),
    siguiente: 'e24_herreria'
  },
  {
    id: 'e24_herreria',
    titulo: 'Chispas y juramentos',
    texto: 'La herrería mejora a TODA la tropa a la vez, mi señor. Es el dinero mejor gastado del reino.',
    consejo: 'construid la herrería: mejora a todo el ejército de golpe.',
    objetivo: { tipo: 'construir', que: 'herreria', total: 1 },
    recompensa: premio(rec(300, 250, 200, 120), 15, 140),
    siguiente: 'e25_arqueria'
  },
  {
    id: 'e25_arqueria',
    titulo: 'Que vuelen rectas',
    texto: 'Dianas de paja y astillas en los dedos. Seis arqueros y el cuartel dejará de ir a pecho descubierto.',
    consejo: 'construid la arquería y entrenad seis arqueros.',
    objetivo: { tipo: 'tropas', que: 'arquero', total: 6 },
    recompensa: premio(rec(300, 200, 300, 120), 15, 150),
    siguiente: 'e26_defender'
  },
  {
    id: 'e26_defender',
    titulo: 'Vienen por el camino',
    texto: 'Alguien ha decidido que vuestro granero es suyo. Recibidles como merecen y que cuenten lo que han visto.',
    consejo: 'aguantad un asalto enemigo: reforzad torres y murallas antes.',
    objetivo: { tipo: 'defensa', total: 1 },
    recompensa: premio(rec(350, 350, 250, 100), 18, 160),
    siguiente: 'e27_ayto5'
  },
  {
    id: 'e27_ayto5',
    titulo: 'Corazón del baluarte',
    texto: 'Nivel cinco, mi señor. A partir de ahí se puede hablar de castillos sin que la gente se ría.',
    consejo: 'subid el Ayuntamiento a nivel 5: abre la Edad de los Castillos.',
    objetivo: { tipo: 'nivel', que: 'ayuntamiento', total: 5 },
    recompensa: premio(rec(500, 400, 400, 150), 20, 200),
    siguiente: 'e28_castillos'
  },
  {
    id: 'e28_castillos',
    titulo: 'La edad de la piedra grande',
    texto: 'Avanzad a la Edad de los Castillos. Empieza la guerra de verdad, y conviene llegar antes que los vecinos.',
    consejo: 'avanzad a la Edad de los Castillos.',
    objetivo: { tipo: 'edad', que: 'castillos', total: 1 },
    recompensa: premio(rec(800, 700, 600, 300), 35, 350),
    siguiente: 'e29_castillo'
  },
  {
    id: 'e29_castillo',
    titulo: 'Torreón y estandarte',
    texto: 'Quien tire el castillo se lleva la aldea, mi señor. Y quien lo levante, se lleva el respeto del valle.',
    consejo: 'construid el castillo: es el corazón de vuestra defensa.',
    objetivo: { tipo: 'construir', que: 'castillo', total: 1 },
    recompensa: premio(rec(700, 600, 500, 250), 30, 300),
    siguiente: 'e30_establo'
  },
  {
    id: 'e30_establo',
    titulo: 'Los que deciden las batallas',
    texto: 'Huele a lo que huele, pero de un establo salen los jinetes, y de los jinetes salen las victorias.',
    consejo: 'construid el establo y entrenad tres jinetes.',
    objetivo: { tipo: 'tropas', que: 'jinete', total: 3 },
    recompensa: premio(rec(600, 400, 700, 250), 25, 280),
    siguiente: 'e31_universidad'
  },
  {
    id: 'e31_universidad',
    titulo: 'Monjes discutiendo de arados',
    texto: 'De esas discusiones salen todas las ideas buenas. Levantad la universidad y aguantad el ruido.',
    consejo: 'levantad la universidad: de ahí salen las mejores tecnologías.',
    objetivo: { tipo: 'construir', que: 'universidad', total: 1 },
    recompensa: premio(rec(700, 600, 500, 300), 28, 300),
    siguiente: 'e32_ciencia'
  },
  {
    id: 'e32_ciencia',
    titulo: 'Ocho ideas buenas',
    texto: 'Ocho tecnologías en los libros, mi señor. Es lo que separa un baluarte de un montón de piedras.',
    consejo: 'investigad hasta tener ocho tecnologías: la ciencia no se pierde nunca.',
    objetivo: { tipo: 'tecnologias', total: 8 },
    recompensa: premio(rec(800, 700, 600, 400), 30, 350),
    siguiente: 'e33_imperial'
  },
  {
    id: 'e33_imperial',
    titulo: 'La corona',
    texto: 'Ayuntamiento siete, universidad tres y castillo dos. Después, la Edad Imperial. Y después, mi señor, ya solo quedan leyendas.',
    consejo: 'preparad Ayuntamiento, universidad y castillo: os espera la Edad Imperial.',
    objetivo: { tipo: 'edad', que: 'imperial', total: 1 },
    recompensa: premio(rec(2000, 1800, 1500, 900), 100, 1000),
    siguiente: null
  }
]

const PRIMER_ENCARGO = ENCARGOS[0].id
const POR_ID = new Map(ENCARGOS.map(e => [e.id, e]))

// ------------------------------------------------------------ TAREAS DIARIAS
/** Solo objetivos "de flujo": empiezan a cero cada día y se miden con eventos. */
const DIARIAS = [
  { id: 'd_madera', titulo: 'Leña para el día', texto: 'Quinientos troncos antes de que caiga el sol.', objetivo: { tipo: 'recolectar', que: 'madera', total: 500 }, gemas: 5 },
  { id: 'd_piedra', titulo: 'Polvo de cantera', texto: 'Trescientas piedras. Los canteros protestarán; es su oficio.', objetivo: { tipo: 'recolectar', que: 'piedra', total: 300 }, gemas: 5 },
  { id: 'd_comida', titulo: 'La despensa', texto: 'Cuatrocientas raciones de grano para la despensa.', objetivo: { tipo: 'recolectar', que: 'comida', total: 400 }, gemas: 5 },
  { id: 'd_oro', titulo: 'Las arcas', texto: 'Cien monedas. Contadas dos veces, que hay manos largas.', objetivo: { tipo: 'recolectar', que: 'oro', total: 100 }, gemas: 6 },
  { id: 'd_asalto', titulo: 'Una visita al vecino', texto: 'Ganad un asalto ahí fuera y volved con algo bajo el brazo.', objetivo: { tipo: 'asalto', total: 1 }, gemas: 8 },
  { id: 'd_expediciones', titulo: 'Dos caminos', texto: 'Mandad dos expediciones; el mapa no se dibuja solo.', objetivo: { tipo: 'expedicion', total: 2 }, gemas: 6 },
  { id: 'd_explorar', titulo: 'Diez palmos de tierra', texto: 'Descubrid diez casillas nuevas del mundo.', objetivo: { tipo: 'explorar', total: 10 }, gemas: 6 },
  { id: 'd_tropas', titulo: 'Filas nuevas', texto: 'Cinco soldados nuevos en el patio de armas.', objetivo: { tipo: 'entrenar', total: 5 }, gemas: 6 },
  { id: 'd_obra', titulo: 'Una obra más', texto: 'Terminad una construcción, la que sea. Hasta un pozo cuenta.', objetivo: { tipo: 'obras', total: 1 }, gemas: 5 },
  { id: 'd_mejora', titulo: 'Un peldaño más', texto: 'Mejorad un edificio cualquiera de la aldea.', objetivo: { tipo: 'mejoras', total: 1 }, gemas: 6 },
  { id: 'd_aldeano', titulo: 'Uno más a la mesa', texto: 'Que llegue un aldeano nuevo al baluarte.', objetivo: { tipo: 'nuevoAldeano', total: 1 }, gemas: 5 },
  { id: 'd_ciencia', titulo: 'Tinta fresca', texto: 'Terminad una investigación, por pequeña que sea.', objetivo: { tipo: 'investigar', total: 1 }, gemas: 8 },
  { id: 'd_defensa', titulo: 'Nadie pasa', texto: 'Rechazad un ataque sobre la aldea.', objetivo: { tipo: 'defensa', total: 1 }, gemas: 8 },
  { id: 'd_botin', titulo: 'El diezmo ajeno', texto: 'Traed trescientos de botín de cualquier saqueo.', objetivo: { tipo: 'botin', total: 300 }, gemas: 7 }
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
      events.emit(EV.UI_TOAST, { texto: `📜 Encargo cumplido: ${def.titulo}. Reclamad la recompensa.`, tipo: 'bien' })
      events.emit(EV.SFX, { nombre: 'encargo_listo' })
    }
  }
  for (const d of q.diarias) {
    const def = DIARIA_POR_ID.get(d.id)
    if (!def || d.listo) continue
    if (d.hecho >= def.objetivo.total) {
      d.listo = true
      d.hecho = def.objetivo.total
      events.emit(EV.UI_TOAST, { texto: `✅ Tarea del día lista: ${def.titulo}.`, tipo: 'bien' })
    }
  }
  cobrarLogros()
}

/** Los logros se pagan solos: son una palmada en la espalda, no un recado. */
function cobrarLogros () {
  const q = qs()
  for (const l of LOGROS) {
    const est = q.logros[l.id]
    while (est.escalon < l.escalones.length && est.valor >= l.escalones[est.escalon]) {
      const g = gemasEscalon(est.escalon)
      est.escalon++
      gemas(g, `logro ${l.nombre}`)
      darXp(g * 5)
      const grado = est.escalon > 3 ? `${est.escalon}` : 'I'.repeat(est.escalon)
      events.emit(EV.UI_TOAST, { texto: `🏅 ${l.nombre} ${grado} · +${g} ${ICONO.gemas}`, tipo: 'bien' })
      events.emit(EV.QUEST_COMPLETED, {
        quest: { id: l.id, clase: 'logro', titulo: l.nombre, escalon: est.escalon },
        recompensa: { recursos: {}, gemas: g, xp: g * 5 }
      })
    }
  }
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
  events.emit(EV.UI_TOAST, { texto: `📜 Nuevo encargo: ${def.titulo}`, tipo: 'info' })
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

  const cofre = { 3: 10, 7: 25, 14: 40, 30: 100 }[q.racha.dias]
  if (cofre) {
    gemas(cofre, `racha de ${q.racha.dias} días`)
    events.emit(EV.UI_TOAST, { texto: `🔥 ${q.racha.dias} días seguidos. Cofre del mayordomo: +${cofre} ${ICONO.gemas}`, tipo: 'bien' })
  }
  events.emit(EV.UI_TOAST, {
    texto: `🌅 Día nuevo en el baluarte: tres encargos frescos y racha de ${q.racha.dias} día${q.racha.dias === 1 ? '' : 's'}.`,
    tipo: 'info'
  })
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
      progreso: { hecho: Math.min(d.hecho, def.objetivo.total), total: def.objetivo.total },
      listo: !!d.listo,
      recompensa: premioDiaria(def)
    })
  }
  return lista
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
 * Qué debería hacer el jugador AHORA MISMO, en una frase.
 * Primero lo que ya se puede cobrar, luego el encargo en curso y, si todo está
 * al día, el agujero más gordo de la aldea (almacén, camas, brazos, defensa…).
 * @returns {string}
 */
export function siguienteConsejo () {
  const s = game.state
  const enCurso = activas()

  const listo = enCurso.find(x => x.listo)
  if (listo) return `Mi señor, ${listo.clase === 'diaria' ? 'la tarea' : 'el encargo'} «${listo.titulo}» está cumplido: reclamad la recompensa.`

  const encargo = enCurso.find(x => x.clase === 'encargo')
  if (encargo && encargo.progreso.hecho === 0) return `Mi señor, ${encargo.consejo}`

  // --- diagnóstico de la aldea: lo más urgente primero ---
  const lleno = CONFIG.RECURSOS.find(r => (s.almacen?.[r] || 0) > 0 && s.recursos[r] >= s.almacen[r] * 0.92)
  if (lleno) {
    const donde = (lleno === 'madera' || lleno === 'piedra') ? 'el almacén' : 'el granero'
    return `Se está desperdiciando ${ICONO[lleno]} ${lleno}: gastadla ya o ampliad ${donde}.`
  }

  if ((s.villagers || []).length >= topePoblacion()) {
    return 'No cabe un alma más en la aldea: levantad una casa o ampliad el Ayuntamiento.'
  }

  const ociosos = (s.villagers || []).filter(v => !v.buildingId && (!v.job || v.job === 'ocioso' || v.job === 'libre')).length
  if (ociosos > 0) return `Hay ${ociosos} aldeano${ociosos === 1 ? '' : 's'} de brazos cruzados: mandadlos a una serrería, cantera o granja.`

  if (!(s.obras || []).length) {
    if (terminados('casa').length < 3) return 'Ninguna obra en marcha: con otra casa entrará gente nueva.'
    return 'Ninguna obra en marcha, mi señor. Mejorad lo que más rinde: la serrería o la cantera.'
  }

  const torres = terminados('torre_vigia').length + terminados('torre_ballesta').length
  if (torres < 2 && terminados('ayuntamiento').some(b => (b.nivel || 1) >= 2)) {
    return 'La defensa está floja: alzad otra torre vigía antes de que os visiten.'
  }
  if (terminados('muralla').length < 12 && (s.buildings || []).length > 8) {
    return 'La aldea está abierta por los cuatro costados: cerradla con muralla.'
  }

  const tropas = Object.values(s.ejercito?.tropas || {}).reduce((a, n) => a + (n || 0), 0)
  if (tropas >= 6 && !(s.expediciones || []).length) return `Tenéis ${tropas} soldados sin estrenar: mandad un asalto y volved con botín.`
  if (tropas < 4 && terminados('cuartel').length) return 'El cuartel está vacío: entrenad unos lanceros, que son baratos.'

  if (terminados('campamento_explorador').length && !(s.expediciones || []).length) {
    return 'Los exploradores se aburren: mandad una expedición al mapa del mundo.'
  }

  const pendiente = enCurso.find(x => !x.listo)
  if (pendiente) return `Mi señor, ${pendiente.clase === 'encargo' ? pendiente.consejo : pendiente.texto}`

  const edad = ORDEN_EDADES.indexOf(s.age)
  if (edad < ORDEN_EDADES.length - 1) return `Todo está en orden: juntad recursos y avanzad a la ${AGE_NOMBRE[ORDEN_EDADES[edad + 1]]}.`
  return 'El baluarte va sobre ruedas, mi señor. Saquead a los vecinos y disfrutad del vino.'
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
