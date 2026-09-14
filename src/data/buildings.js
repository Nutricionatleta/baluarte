/**
 * CATÁLOGO DE EDIFICIOS. Datos puros: la simulación, la interfaz y el render 3D
 * leen de aquí y de ningún otro sitio.
 *
 * RITMO (híbrido, lo pactado en CONTRATOS.md):
 *   nivel 1 = 5-30 s (hay que enganchar en el primer minuto),
 *   niveles 2-3 = minutos, niveles altos = de 1 a 8 h y NUNCA más.
 * Por eso cada `tiempo(n)` es geométrico pero con tope duro: quien entra tres
 * veces al día en ratos muertos siempre encuentra una obra terminada.
 */

// Solo para poner el NOMBRE de la tropa que entrena cada cuartel en su ficha.
// data/ puede leer de data/: units.js no mira aquí, así que no hay pescadilla.
import { UNIDADES } from './units.js'

const HORA = 3600

export const ORDEN_EDADES = ['oscura', 'feudal', 'castillos', 'imperial']

export const AGE_NOMBRE = {
  oscura: 'Edad Oscura',
  feudal: 'Edad Feudal',
  castillos: 'Edad de los Castillos',
  imperial: 'Edad Imperial'
}

/** Números redondos: un coste de 1.847 se lee peor que 1.850. */
const bonito = (v) => v < 100 ? Math.round(v) : v < 1000 ? Math.round(v / 5) * 5 : Math.round(v / 10) * 10

/** Curva geométrica de coste. El factor 1.7-2.1 es lo que sostiene la progresión. */
export function escala (base, factor = 1.85) {
  return (n = 1) => base ? bonito(base * Math.pow(factor, Math.max(0, n - 1))) : 0
}

/**
 * Repecho de los niveles altos. La geométrica sola se quedaba corta: a partir de
 * media partida la producción crecía más deprisa que los costes y los almacenes
 * vivían clavados al 100 %. Del nivel 5 en adelante cada escalón pide un extra,
 * y así los últimos niveles son un proyecto de verdad y no calderilla.
 *
 * Los cuatro primeros niveles NO llevan repecho a propósito: la primera hora de
 * juego tiene que seguir siendo rápida y generosa. Lo que se alarga es el medio
 * y el final, donde el jugador ya sabe lo que hace y quiere un imperio, no un
 * tutorial (nivel 8 cuesta un 57 % más que antes; el 12, ocho veces el base).
 */
const REPECHO = 1.24
const repecho = (n) => Math.pow(REPECHO, Math.max(0, n - 4))

/** Coste completo. Siempre devuelve los cuatro recursos (0 si no cuesta). */
function coste (madera = 0, piedra = 0, comida = 0, oro = 0, factor = 1.85) {
  const em = escala(madera, factor); const ep = escala(piedra, factor)
  const ec = escala(comida, factor); const eo = escala(oro, factor)
  return (n = 1) => {
    const k = repecho(n)
    return { madera: bonito(em(n) * k), piedra: bonito(ep(n) * k), comida: bonito(ec(n) * k), oro: bonito(eo(n) * k) }
  }
}

/** Segundos redondos: al segundo si es corto, al minuto si es largo. */
const tiempoBonito = (s) => s < 60 ? Math.round(s) : s < HORA ? Math.round(s / 5) * 5 : Math.round(s / 60) * 60

/** Obra: geométrica y con tope. El tope es lo que impide esperas de un día. */
function obra (base, factor = 3.1, tope = 8 * HORA) {
  return (n = 1) => tiempoBonito(Math.min(tope, base * Math.pow(factor, Math.max(0, n - 1))))
}

/** Vida del edificio. Crece más lento que el coste: mejorar no te hace inmune. */
const vida = (base, factor = 1.32) => (n = 1) => Math.round(base * Math.pow(factor, Math.max(0, n - 1)))

/**
 * Producción por minuto. Factor ~1.5: ocho niveles multiplican por ~17, no por 100.
 *
 * Sep-2026, al cuadrar plazas y población: un edificio de nivel 1 pasó a tener
 * UNA plaza, así que ahora se llena con un aldeano y rinde el 100 % donde antes
 * se quedaba en el 40-60 %. Eso por sí solo casi duplicaba lo que entra por hora
 * y adelantaba la Edad Imperial cuatro días. Como el ritmo pausado es lo que
 * gusta del juego, las cuatro curvas de recursos se han bajado un punto (−10 %
 * en el nivel 1, −28 % en el 12): el jugador sigue ganando bastante —sus
 * edificios ya no trabajan a medias— pero la partida dura lo mismo.
 */
const porMin = (base, factor = 1.52) => (n = 1) => Math.round(base * Math.pow(factor, Math.max(0, n - 1)) * 10) / 10

/**
 * PUESTOS DE TRABAJO frente a ALDEANOS — la cuenta que cuadra la aldea.
 *
 * HISTORIA, porque el péndulo ya se ha ido a los dos lados:
 *   · Antes (ago-2026): 56 puestos y camas para 7. Media aldea rendía al 25 %.
 *   · Al arreglarlo (sep-2026) se dejó un colchón para que SOBRARA gente… y
 *     sobraba demasiada: en CADA nivel de Ayuntamiento quedaba entre el 15 % y
 *     el 36 % de la aldea sin dónde meterse. El dueño lo cazó jugando: «tengo
 *     22 aldeanos y 7 parados sin hacer nada». Contratar no significaba nada y
 *     el tope de población era decorativo.
 *
 * LA MEDIDA (14-sep-2026), con el catálogo en la mano y los topes de unidades
 * de verdad —4 serrerías + 4 canteras + 5 granjas desde la Oscura, 3 minas de
 * oro desde la Feudal, y el campamento aparte—, contando que ningún edificio
 * pasa del nivel del Ayuntamiento:
 *
 *   Ayto  Edad       Plazas   Tope VIEJO  sobraban   Tope NUEVO  sobran
 *     1   oscura       13         20        +7 (35%)     16       +3
 *     2   oscura       14         22        +8 (36%)     18       +4
 *     3   feudal       18         24        +6 (25%)     20       +2
 *     4   feudal       34         40        +6 (15%)     38       +4
 *     5   feudal       34         42        +8 (19%)     39       +5
 *     6   feudal       35         44        +9 (20%)     40       +5
 *     7   feudal       35         46       +11 (24%)     41       +6
 *     8   feudal       51         62       +11 (18%)     57       +6
 *     9   castillos    51         64       +13 (20%)     58       +7
 *    10   castillos    51         66       +15 (23%)     59       +8
 *    11   imperial     51         68       +17 (25%)     60       +9
 *    12   imperial     67         84       +17 (20%)     76       +9
 *    13   imperial     67         86       +19 (22%)     77      +10
 *    14   imperial     67         88       +21 (24%)     78      +11
 *
 * QUÉ PALANCA SE MUEVE Y POR QUÉ: **se baja la POBLACIÓN, no se suben las
 * plazas.** Subir plazas es subir la producción por hora, y el informe de
 * partida ya dice que la economía se desborda (los almacenes acaban clavados al
 * 100 % y se tira entre el 35 % y el 69 % de lo producido). El ritmo pausado es
 * lo que gusta del juego: no se toca. Lo que estaba mal era el tope, que
 * prometía camas para gente que no tenía dónde trabajar.
 *
 * REGLA DURA, la nueva: el tope de población = las plazas que el juego DEJA
 * construir a ese nivel + el colchón de obra (los martillos de las
 * `obrasSimultaneas` del Ayuntamiento, más dos de relevo). Ni una cama de
 * regalo por encima de eso. Así, mientras el jugador no tenga la aldea entera
 * levantada, CADA aldeano que contrata entra en un puesto vacío y la producción
 * sube el mismo minuto; y cuando ya la tiene entera, el colchón que queda es
 * exactamente la cuadrilla que cabe en los andamios y en el valle.
 *
 * Y ese colchón ya no es decorado: los que no tienen plantilla fija se buscan
 * la vida solos (sim/villagers.js → `apañarse`): se apuntan a las obras, salen
 * con la cuadrilla a talar y picar (sim/despeje.js, y SIN robarle plazas de
 * obra a la construcción) y acarrean al almacén lo que se amontona fuera.
 *
 * Un nivel 1 con UNA plaza no produce menos: la faena de sim/resources.js es
 * relativa (25 % sin nadie, 100 % a plazas llenas), así que llenarla con un solo
 * aldeano es exactamente lo que se pedía —más recursos por hora— sin tocar ni
 * un reloj de obra.
 */
const plazasDeTrabajo = (n = 1) => 1 + Math.floor(n / 4)

export const EDIFICIOS = {
  // ---------------------------------------------------------------- centro
  ayuntamiento: {
    nombre: 'Ayuntamiento',
    icono: '🏛️',
    categoria: 'centro',
    ancho: 4,
    alto: 4,
    maxNivel: 14,
    unico: true,
    age: 'oscura',
    desc: 'El corazón del baluarte. Si él no crece, aquí no crece nada.',
    paraQue: 'Manda en toda la aldea: sube el tope de vecinos, da constructores y ningún otro edificio puede subir por encima de su nivel. Encima recauda impuestos en oro.',
    // Piedra por encima de la madera: el primer cuello del juego es la cantera.
    // Catorce niveles: los cuatro primeros caen en la primera tarde, el 11 abre
    // la Edad Imperial y el 13 y el 14 son para después, ya en el imperio. Nada
    // de la aldea puede pasarle de nivel: es él quien marca cuánta partida queda.
    coste: coste(200, 215, 130, 45, 1.8),
    tiempo: obra(25, 3.05, 7 * HORA),
    hp: vida(1400, 1.34),
    // IMPUESTOS. Un hilillo de oro desde el primer minuto. Sin esto la Edad
    // Oscura no tiene NINGUNA fuente de oro (la mina es feudal) y basta con que
    // una tecnología se lleve las monedas de partida para dejar la partida
    // muerta: el ahorro para la Edad Feudal pide 50 de oro y no entran nunca.
    produce: 'oro',
    porMinuto: porMin(1.5, 1.32),
    // TOPE DE POBLACIÓN. Va PEGADO a las plazas de trabajo que existen a ese
    // nivel, con el colchón justo de los andamios (ver la tabla de
    // `plazasDeTrabajo`): antes regalaba entre 6 y 21 camas de más y un tercio
    // de la aldea se pasaba la partida de brazos cruzados. El escalón gordo
    // sigue cayendo en los niveles 4, 8 y 12, que es donde los edificios de
    // recursos ganan una plaza: el tope y la faena suben el MISMO día.
    //   1→16  2→18  3→20 | 4→38  5→39  6→40  7→41 | 8→57 … 11→60 | 12→76 … 14→78
    poblacionMax: (n = 1) => {
      const nivel = Math.max(1, n)
      return nivel < 4 ? 14 + 2 * nivel : nivel + 19 + 15 * Math.floor(nivel / 4)
    },
    // Plazas de obra: 1 al empezar y 6 en el imperio. Ya no son el cuello de
    // botella (lo que no cabe espera en la cola), pero cada plaza nueva sigue
    // siendo de las mejoras que más se notan: la aldea crece por varios sitios.
    obrasSimultaneas: (n = 1) => Math.min(6, 1 + Math.floor((n + 1) / 3) + (n >= 9 ? 1 : 0))
  },

  casa: {
    nombre: 'Casa',
    icono: '🏠',
    categoria: 'centro',
    ancho: 2,
    alto: 2,
    maxNivel: 10,
    max: 16,
    age: 'oscura',
    desc: 'Adobe, paja y sitio para dormir. Sin camas no hay quien trabaje.',
    paraQue: 'Sube el tope de vecinos. Sin camas libres no llega gente nueva, y sin gente los edificios rinden a medio gas.',
    coste: coste(35, 25, 20, 0, 1.8),
    tiempo: obra(8, 3.4, 2 * HORA),
    hp: vida(260),
    requiere: { ayuntamiento: 1 },
    // Una cama más por casa que antes (4 a nivel 1): con el tope de población
    // al día, la casa es el grifo que lo abre, y no apetece llenar la aldea de
    // chozas para llegar a fin de mes.
    aloja: (n = 1) => 3 + n
  },

  // -------------------------------------------------------------- recursos
  serreria: {
    nombre: 'Serrería',
    icono: '🪵',
    categoria: 'recursos',
    ancho: 3,
    alto: 3,
    maxNivel: 12,
    // 4 y no 5: con 4 serrerías + 4 canteras + 5 granjas + 3 minas la cuenta de
    // plazas frente a población cuadra en las cuatro edades (ver plazasDeTrabajo).
    max: 4,
    age: 'oscura',
    desc: 'Aquí el bosque se convierte en vigas. Y en ampollas.',
    paraQue: 'Fabrica madera ella sola, juegues o no. Cuanta más gente metas dentro, más madera entra por hora.',
    coste: coste(70, 55, 20, 0, 1.85),
    tiempo: obra(15, 3.1, 6 * HORA),
    hp: vida(420),
    produce: 'madera',
    porMinuto: porMin(13.5, 1.43),
    plazas: plazasDeTrabajo
  },

  cantera: {
    nombre: 'Cantera',
    icono: '🪨',
    categoria: 'recursos',
    ancho: 3,
    alto: 3,
    maxNivel: 12,
    max: 4,
    age: 'oscura',
    // La piedra es el cuello de botella del juego: rinde ~2/3 de la serrería.
    desc: 'Picar roca es lento y aburrido, pero las murallas no salen del huerto.',
    paraQue: 'Saca piedra ella sola. La piedra es lo que más se atasca: murallas, torres y Ayuntamiento salen de aquí.',
    coste: coste(95, 35, 20, 0, 1.9),
    tiempo: obra(18, 3.1, 6 * HORA),
    hp: vida(460),
    produce: 'piedra',
    porMinuto: porMin(9.5, 1.41),
    plazas: plazasDeTrabajo
  },

  granja: {
    nombre: 'Granja',
    icono: '🌾',
    categoria: 'recursos',
    ancho: 3,
    alto: 3,
    maxNivel: 12,
    // 5 granjas: una más que serrerías y canteras, porque la comida paga además
    // a los aldeanos nuevos y la manutención de la tropa.
    max: 5,
    age: 'oscura',
    desc: 'Trigo, nabos y un espantapájaros con más carisma que el alcalde.',
    paraQue: 'Da comida sin parar. La comida paga a los aldeanos nuevos y el plato diario de la tropa.',
    coste: coste(50, 20, 40, 0, 1.8),
    tiempo: obra(12, 3.0, 5 * HORA),
    hp: vida(340),
    produce: 'comida',
    porMinuto: porMin(10.8, 1.42),
    plazas: plazasDeTrabajo
  },

  mina_oro: {
    nombre: 'Mina de oro',
    icono: '🪙',
    categoria: 'recursos',
    ancho: 3,
    alto: 3,
    maxNivel: 12,
    max: 3,
    age: 'feudal',
    // El oro es el recurso de lujo: paga tropa cara y tecnología. Nunca sobra.
    desc: 'Un filón, tres picos y la certeza de que nunca tendrás suficiente.',
    paraQue: 'Saca oro, que es lo que paga la tropa cara, la investigación y las prisas.',
    coste: coste(110, 150, 60, 0, 1.9),
    tiempo: obra(28, 3.1, 8 * HORA),
    hp: vida(500),
    requiere: { ayuntamiento: 3 },
    produce: 'oro',
    porMinuto: porMin(2.35, 1.39),
    plazas: plazasDeTrabajo
  },

  molino: {
    nombre: 'Molino',
    icono: '🌬️',
    categoria: 'recursos',
    ancho: 2,
    alto: 2,
    maxNivel: 10,
    max: 3,
    age: 'feudal',
    desc: 'Muele el grano de las granjas de al lado. Colócalo con cabeza.',
    paraQue: 'Él no produce nada: sube la cosecha de las granjas que tenga alrededor. Va plantado en medio de un grupo de granjas, no en cualquier esquina.',
    coste: coste(110, 80, 80, 0, 1.85),
    tiempo: obra(20, 3.2, 3 * HORA),
    hp: vida(300),
    requiere: { granja: 2 },
    aura: {
      radio: 5,
      afecta: 'granja',
      bonus: (n = 1) => Math.round((0.10 + 0.05 * n) * 100) / 100,
      /**
       * TOPE DEL AURA, y es el número que cuadra la comida (sep-2026).
       *
       * `sim/resources.js` sumaba el aura de TODOS los molinos que alcanzaran a
       * una granja, y los molinos son tres. Tres del 10 multiplicaban la cosecha
       * por 2,8 —plantados los tres encima de las mismas granjas, que es lo que
       * hace cualquiera—, y ahí es donde la comida se salía del juego:
       *   5 granjas del 12 sin molino = 2.556/min · 4 serrerías del 12 = 2.761/min
       *   ...las mismas 5 granjas con tres molinos del 10 = 7.157/min (×2,8)
       * Medido en la partida de 30 días: la comida era lo ÚNICO que rebosaba
       * (2,7 millones tirados frente a 2.952 de madera y 0 de piedra) y no frenó
       * NI UNA obra en todo el mes.
       *
       * Con el tope, los tres molinos siguen valiendo —cada uno cubre un grupo de
       * granjas distinto, que es para lo que están— pero amontonarlos deja de ser
       * un truco: la comida se queda en ~1,6 veces la madera, que es justo lo que
       * pide el catálogo (5 granjas contra 4 serrerías, porque el grano paga
       * además a los aldeanos nuevos y la manutención de la tropa).
       */
      tope: 0.75
    }
  },

  almacen: {
    nombre: 'Almacén',
    icono: '📦',
    categoria: 'recursos',
    ancho: 3,
    alto: 3,
    maxNivel: 14,
    max: 4,
    age: 'oscura',
    // REGLA DURA: el almacén lleno tiene que pagar lo más caro de su momento y
    // que aún sobre. Si el tope se queda por debajo del siguiente Ayuntamiento,
    // la partida se atasca para siempre (pasó con la comida en el nivel 9).
    desc: 'Madera y piedra bajo techo. Lo que no cabe, se apila fuera... y se pudre.',
    paraQue: 'Guarda tu madera y tu piedra: sube el tope de las dos. Si llegas al tope, todo lo que produzcas de más se pierde.',
    coste: coste(80, 130, 0, 20, 1.85),
    tiempo: obra(14, 3.0, 4 * HORA),
    hp: vida(520),
    capacidad: (n = 1) => {
      const c = Math.round(escala(2400, 1.8)(n) * repecho(n))
      return { madera: c, piedra: c }
    }
  },

  granero: {
    nombre: 'Granero',
    icono: '🏚️',
    categoria: 'recursos',
    ancho: 3,
    alto: 3,
    maxNivel: 14,
    max: 3,
    age: 'oscura',
    desc: 'Grano seco y monedas bien contadas. Vigila a los ratones.',
    paraQue: 'Guarda tu comida y tu oro: sube el tope de los dos. Si llegas al tope, todo lo que produzcas de más se pierde.',
    coste: coste(70, 120, 0, 15, 1.85),
    tiempo: obra(14, 3.0, 4 * HORA),
    hp: vida(500),
    capacidad: (n = 1) => ({
      comida: Math.round(escala(2200, 1.8)(n) * repecho(n)),
      oro: Math.round(escala(950, 1.8)(n) * repecho(n))
    })
  },

  mercado: {
    nombre: 'Mercado',
    icono: '⚖️',
    categoria: 'recursos',
    ancho: 3,
    alto: 3,
    maxNivel: 10,
    unico: true,
    age: 'feudal',
    desc: 'Cambia lo que te sobra por lo que te falta. El tendero se lleva lo suyo.',
    paraQue: 'Cambia el recurso que te sobra por el que te falta. El tendero se queda una comisión, y esa comisión baja al mejorarlo.',
    coste: coste(170, 200, 120, 150, 1.9),
    tiempo: obra(30, 3.2, 4 * HORA),
    hp: vida(480),
    requiere: { ayuntamiento: 3 },
    // Comisión del cambio: del 30 % al 10 %. Nunca gratis, o la economía se rompe.
    comision: (n = 1) => Math.max(0.10, Math.round((0.35 - 0.05 * n) * 100) / 100)
  },

  // --------------------------------------------------------------- militar
  cuartel: {
    nombre: 'Cuartel',
    icono: '⚔️',
    categoria: 'militar',
    ancho: 3,
    alto: 3,
    maxNivel: 12,
    max: 2,
    age: 'oscura',
    desc: 'Cuatro jergones, un sargento con mal despertar y ganas de gresca.',
    paraQue: 'Entrena la infantería que va a pie: lanceros y espadachines. Cuanto más alto, antes sale cada soldado.',
    coste: coste(95, 70, 60, 0, 1.85),
    tiempo: obra(20, 3.1, 5 * HORA),
    hp: vida(600),
    requiere: { ayuntamiento: 2 },
    entrena: ['lancero', 'espadachin'],
    velocidad: (n = 1) => Math.round((1 + 0.15 * (n - 1)) * 100) / 100
  },

  arqueria: {
    nombre: 'Arquería',
    icono: '🏹',
    categoria: 'militar',
    ancho: 3,
    alto: 3,
    maxNivel: 12,
    max: 2,
    age: 'feudal',
    desc: 'Dianas de paja, astillas en los dedos y flechas que ya casi vuelan rectas.',
    paraQue: 'Entrena la tropa que pega de lejos: arqueros y ballesteros.',
    coste: coste(140, 90, 60, 90, 1.85),
    tiempo: obra(24, 3.1, 5 * HORA),
    hp: vida(560),
    requiere: { ayuntamiento: 3, cuartel: 2 },
    entrena: ['arquero', 'ballestero'],
    velocidad: (n = 1) => Math.round((1 + 0.15 * (n - 1)) * 100) / 100
  },

  establo: {
    nombre: 'Establo',
    icono: '🐎',
    categoria: 'militar',
    ancho: 4,
    alto: 3,
    maxNivel: 10,
    max: 1,
    age: 'castillos',
    desc: 'Huele a lo que huele, pero de aquí salen los que deciden las batallas.',
    paraQue: 'Entrena la caballería: la tropa rápida, la que entra, revienta a los arqueros y sale.',
    coste: coste(220, 170, 260, 350, 1.9),
    tiempo: obra(30, 3.2, 6 * HORA),
    hp: vida(700),
    requiere: { ayuntamiento: 5, cuartel: 3 },
    entrena: ['jinete', 'caballero'],
    velocidad: (n = 1) => Math.round((1 + 0.15 * (n - 1)) * 100) / 100
  },

  taller_asedio: {
    nombre: 'Taller de asedio',
    icono: '🛠️',
    categoria: 'militar',
    ancho: 4,
    alto: 4,
    maxNivel: 8,
    max: 1,
    age: 'castillos',
    desc: 'Máquinas grandes, lentas y con pésimas intenciones hacia las murallas ajenas.',
    paraQue: 'Fabrica arietes y catapultas, las únicas máquinas que abren una muralla deprisa. Sin él, atacar una plaza amurallada es regalar tropa.',
    coste: coste(300, 250, 120, 610, 1.95),
    tiempo: obra(30, 3.3, 6 * HORA),
    hp: vida(760),
    requiere: { ayuntamiento: 5, herreria: 3 },
    entrena: ['ariete', 'catapulta'],
    velocidad: (n = 1) => Math.round((1 + 0.12 * (n - 1)) * 100) / 100
  },

  herreria: {
    nombre: 'Herrería',
    icono: '🔨',
    categoria: 'militar',
    ancho: 3,
    alto: 3,
    maxNivel: 12,
    unico: true,
    age: 'feudal',
    desc: 'Chispas, yunque y un herrero que jura en arameo. Mejora a TODA la tropa.',
    paraQue: 'Mejora a TODA tu tropa a la vez, la que ya tienes y la que entrenes después: más ataque y más armadura, en casa y en los asaltos.',
    coste: coste(150, 190, 60, 210, 1.9),
    tiempo: obra(26, 3.1, 6 * HORA),
    hp: vida(640),
    requiere: { ayuntamiento: 3, cuartel: 2 },
    // Bonos globales y acumulativos: es la mejora militar más rentable del juego,
    // por eso sube de 5 en 5 y no de 10 en 10.
    bonusAtaque: (n = 1) => Math.round(0.05 * n * 100) / 100,
    bonusArmadura: (n = 1) => Math.round(0.04 * n * 100) / 100
  },

  universidad: {
    nombre: 'Universidad',
    icono: '📜',
    categoria: 'militar',
    ancho: 3,
    alto: 3,
    maxNivel: 8,
    unico: true,
    age: 'castillos',
    desc: 'Monjes copistas discutiendo de arados. De ahí salen todas las ideas buenas.',
    paraQue: 'Es donde se investiga y donde se cambia de edad. Cuanto más alta, antes termina cada investigación.',
    coste: coste(290, 380, 200, 790, 1.95),
    tiempo: obra(30, 3.3, 6 * HORA),
    hp: vida(600),
    requiere: { ayuntamiento: 5 },
    velocidadInvestigacion: (n = 1) => Math.round((1 + 0.2 * (n - 1)) * 100) / 100
  },

  monasterio: {
    nombre: 'Monasterio',
    icono: '⛪',
    categoria: 'militar',
    ancho: 3,
    alto: 3,
    maxNivel: 8,
    unico: true,
    age: 'castillos',
    desc: 'Rezan por tus tropas y, lo que importa, remiendan a las que vuelven rotas.',
    paraQue: 'Salva soldados: parte de los que caen en un asalto vuelven heridos en vez de morir, se curan solos en la aldea y vuelven a pelear. También entrena monjes.',
    coste: coste(240, 330, 160, 550, 1.9),
    tiempo: obra(28, 3.2, 6 * HORA),
    hp: vida(580),
    requiere: { ayuntamiento: 5 },
    entrena: ['monje'],
    velocidad: (n = 1) => Math.round((1 + 0.12 * (n - 1)) * 100) / 100,
    // Fracción de bajas que vuelve a casa tras un asalto: suaviza las derrotas
    // sin quitarles el escozor (tope duro del 40 %).
    curacion: (n = 1) => Math.min(0.4, Math.round((0.10 + 0.05 * n) * 100) / 100)
  },

  campamento_explorador: {
    nombre: 'Campamento de exploradores',
    icono: '🧭',
    categoria: 'militar',
    ancho: 3,
    alto: 3,
    maxNivel: 8,
    unico: true,
    age: 'oscura',
    desc: 'Una hoguera, un mapa mal dibujado y gente con ganas de ver qué hay detrás.',
    paraQue: 'Manda batidores al mapa del valle: descubren terreno, recursos y bases enemigas. Sin explorar no hay a quién atacar.',
    coste: coste(55, 35, 50, 0, 1.8),
    tiempo: obra(12, 3.2, 3 * HORA),
    hp: vida(300),
    requiere: { ayuntamiento: 2 },
    // De 1 a 3 batidores (antes 5): son plazas que compiten con la serrería por
    // los mismos aldeanos, y salir a explorar no puede dejar la aldea a medias.
    exploradores: (n = 1) => 1 + Math.floor(n / 3),
    alcance: (n = 1) => 6 + 3 * n
  },

  // --------------------------------------------------------------- defensa
  torre_vigia: {
    nombre: 'Torre vigía',
    icono: '🗼',
    categoria: 'defensa',
    ancho: 2,
    alto: 2,
    maxNivel: 12,
    max: 10,
    age: 'oscura',
    desc: 'Dos arqueros aburridos con muy buena puntería cuando hace falta.',
    paraQue: 'Dispara sola a todo el que entre en su alcance. Es la defensa barata: varias repartidas valen más que una sola muy alta.',
    coste: coste(45, 215, 0, 0, 1.85),
    tiempo: obra(15, 3.1, 5 * HORA),
    hp: vida(480),
    requiere: { ayuntamiento: 2 },
    dano: (n = 1) => Math.round(12 * Math.pow(1.35, n - 1)),
    radio: (n = 1) => Math.round((4 + 0.25 * n) * 10) / 10,
    cadencia: 0.8 // disparos por segundo
  },

  torre_ballesta: {
    nombre: 'Torre de ballestas',
    icono: '🎯',
    categoria: 'defensa',
    ancho: 2,
    alto: 2,
    maxNivel: 10,
    max: 6,
    age: 'castillos',
    // Pega más del doble que la vigía pero ve menos y dispara más lento:
    // hay que colocarla en el pasillo bueno, no repartirlas al tuntún.
    desc: 'Pega como una mula y ve poco. Guárdala para el pasillo bueno.',
    paraQue: 'Torre de pegada: hace más del doble de daño que la vigía, pero ve mucho menos. Va en el pasillo por donde entran de verdad.',
    coste: coste(90, 380, 0, 300, 1.9),
    tiempo: obra(25, 3.2, 6 * HORA),
    hp: vida(620),
    requiere: { ayuntamiento: 5, torre_vigia: 3 },
    dano: (n = 1) => Math.round(30 * Math.pow(1.35, n - 1)),
    radio: (n = 1) => Math.round((3.2 + 0.2 * n) * 10) / 10,
    cadencia: 0.5
  },

  castillo: {
    nombre: 'Castillo',
    icono: '🏰',
    categoria: 'defensa',
    ancho: 4,
    alto: 4,
    maxNivel: 8,
    unico: true,
    age: 'castillos',
    desc: 'Torreón, almenas y estandarte. Quien lo tire, se lleva la aldea.',
    paraQue: 'La defensa más dura que tienes: pega fuerte, ve lejos y aguanta lo que no aguanta nada. Si lo tiran, se llevan la aldea.',
    coste: coste(450, 1150, 300, 980, 2.0),
    tiempo: obra(30, 3.4, 6 * HORA),
    hp: vida(3000, 1.4),
    requiere: { ayuntamiento: 5 },
    dano: (n = 1) => Math.round(55 * Math.pow(1.4, n - 1)),
    radio: (n = 1) => Math.round((6 + 0.5 * n) * 10) / 10,
    cadencia: 0.6
  },

  muralla: {
    nombre: 'Muralla',
    icono: '🧱',
    categoria: 'defensa',
    ancho: 1,
    alto: 1,
    maxNivel: 12,
    max: 120,
    age: 'oscura',
    // Barata y dura a propósito: hay que poder levantar cien tramos sin arruinarse,
    // pero cada mejora se paga en piedra, el recurso escaso.
    desc: 'Un tramo de piedra. Solo no sirve de nada; cien, cambian la batalla.',
    paraQue: 'Corta el paso. El que quiera entrar tiene que echarla abajo a golpes mientras tus torres le disparan desde arriba.',
    coste: coste(0, 55, 0, 0, 1.72),
    tiempo: obra(5, 2.2, 30 * 60),
    hp: vida(550, 1.38),
    requiere: { ayuntamiento: 2 },
    bloquea: true
  },

  puerta: {
    nombre: 'Puerta',
    icono: '🚪',
    categoria: 'defensa',
    ancho: 2,
    alto: 1,
    maxNivel: 12,
    max: 6,
    age: 'oscura',
    desc: 'Por algún sitio hay que entrar. Que sea por donde a ti te conviene.',
    paraQue: 'El hueco por el que se entra y se sale. Puesta con cabeza, decide por dónde te va a atacar el enemigo.',
    coste: coste(30, 90, 0, 0, 1.75),
    tiempo: obra(8, 2.4, 45 * 60),
    hp: vida(700, 1.36),
    requiere: { muralla: 1 },
    bloquea: false
  },

  // ------------------------------------------------------------ decoración
  pozo: {
    nombre: 'Pozo',
    icono: '🪣',
    categoria: 'decoracion',
    ancho: 1,
    alto: 1,
    maxNivel: 1,
    max: 4,
    age: 'oscura',
    desc: 'No produce nada, pero una plaza sin pozo no es una plaza.',
    paraQue: 'No sirve para nada: es adorno para que la plaza tenga cara de plaza.',
    coste: coste(20, 25, 0, 0),
    tiempo: obra(6, 1, 60),
    hp: vida(120)
  },

  estandarte: {
    nombre: 'Estandarte',
    icono: '🚩',
    categoria: 'decoracion',
    ancho: 1,
    alto: 1,
    maxNivel: 1,
    max: 8,
    age: 'oscura',
    desc: 'Tela al viento con tus colores. Puro orgullo, cero utilidad.',
    paraQue: 'No sirve para nada: es adorno.',
    coste: coste(15, 0, 0, 5),
    tiempo: obra(5, 1, 60),
    hp: vida(80)
  },

  // --------------------------------------------------------- territorio
  /**
   * LA AVANZADILLA. Solo se levanta en tierra conquistada (fuera del núcleo) y
   * una por parcela: sim/buildings.js lo comprueba. Es un poblado pequeño con
   * su torre y su empalizada: labra su propio terreno, aloja a su gente,
   * dispara a quien entre por ahí y avisa antes de que lleguen. A cambio hay
   * que pagarle la soldada cada minuto (CONFIG.TERRITORIO.MANTENIMIENTO_MIN);
   * si no, se queda desabastecida y deja de valer.
   */
  puesto_avanzado: {
    nombre: 'Puesto avanzado',
    icono: '🏕️',
    categoria: 'defensa',
    ancho: 3,
    alto: 3,
    maxNivel: 8,
    // Tope global DURO: ocho. Uno por parcela conquistada y no más, porque cada
    // uno trae camas y plazas y la cuenta de la aldea tiene que seguir cuadrando
    // (ver `plazasDeTrabajo`): 8 puestos suman de +32 a +64 camas y solo de +8 a
    // +24 plazas, así que el colchón de gente crece, nunca se estrecha.
    max: 8,
    age: 'oscura',
    desc: 'Un poblado pequeño en tierra ganada: torre, empalizada y gente que avisa.',
    paraQue: 'Un pueblito en tierra conquistada: cultiva su comida, aloja a su gente, dispara al que entra por ahí y te avisa ANTES de que llegue un asedio. A cambio le pagas la soldada cada minuto.',
    coste: coste(140, 170, 90, 35, 1.8),
    tiempo: obra(40, 2.7, 3 * HORA),
    hp: vida(900, 1.34),
    requiere: { ayuntamiento: 3, torre_vigia: 1 },
    // Se cultiva lo suyo: poca comida, pero llega sola desde el otro lado del valle.
    produce: 'comida',
    porMinuto: porMin(2.4, 1.45),
    // Su gente vive allí: mismo campo `aloja` que la casa, para que el censo de
    // sim/villagers.js lo cuente igual (4 camas a nivel 1, 8 al 8).
    aloja: (n = 1) => 4 + Math.floor(n / 2),
    // …y tiene dónde trabajar: 1 plaza al principio, 3 en los niveles altos.
    // Siempre menos plazas que camas: el puesto se paga su propia gente.
    plazas: (n = 1) => 1 + Math.floor(n / 3),
    // Dispara como una torre floja: no sustituye a la muralla, pero al que entra
    // por la frontera se le hace notar.
    dano: (n = 1) => Math.round(28 * Math.pow(1.36, n - 1)),
    radio: (n = 1) => Math.round((5 + 0.4 * n) * 10) / 10,
    cadencia: 0.5
  },

  /**
   * EL FOSO — la otra manera de defenderse.
   *
   * La muralla PARA: el enemigo se queda fuera y tiene que echarla abajo.
   * El foso NO para: deja pasar, pero el que cruza lo hace a rastras, y mientras
   * chapotea está quieto delante de tus torres. Son estrategias distintas y esa
   * es la gracia: un anillo de muralla con dos o tres franjas de foso por fuera
   * multiplica el tiempo que el asaltante pasa a tiro, y encima la caballería
   * —que es la que revienta murallas— no puede entrar y se ve obligada a
   * rodear hasta la puerta, justo donde tú la esperas.
   *
   * Equilibrio: cuesta menos de la mitad que un tramo de muralla en piedra y se
   * levanta en segundos, pero tiene poca vida (cegarlo a golpes es posible) y no
   * cierra el recinto: sin torres que cubran el foso, el foso no vale nada.
   *
   * Los campos `bloquea:false`, `frena`, `costePaso` y `cuentaEnSaqueo` son el
   * CONTRATO con sim/combat.js; aquí solo están los números.
   */
  foso: {
    nombre: 'Foso',
    icono: '🕳️',
    categoria: 'defensa',
    ancho: 1,
    alto: 1,
    maxNivel: 8,
    max: 160,
    age: 'oscura',
    desc: 'Zanja de agua y estacas. No cierra el paso: lo hace lento. La infantería tarda el doble en cruzarlo, la caballería ni lo intenta y el asedio se atasca — y todos ellos, quietos a tiro de tus torres.',
    paraQue: 'No corta el paso: lo hace lento. El que lo cruza se queda quieto a tiro de tus torres, y la caballería ni lo intenta: rodea hasta la puerta.',
    coste: coste(0, 22, 0, 0, 1.66),
    tiempo: obra(4, 2.1, 20 * 60),
    // Poca vida a propósito: un foso se ciega con tierra, no se asalta. Lo que
    // aguanta es el TIEMPO que te regala, no los golpes.
    hp: vida(200, 1.26),
    requiere: { ayuntamiento: 2 },

    // --- contrato con el motor de combate ---
    /** NO corta el paso: el campo de flujo lo atraviesa. Lo contrario de la muralla. */
    bloquea: false,
    /** Marca para que el motor sepa que esta casilla frena en vez de detener. */
    foso: true,
    /**
     * Cuánto AVANZA quien lo está cruzando, por clase de tropa.
     * 1 = pasa como si nada · 0,5 = tarda el doble · 0 = no puede entrar (rodea).
     * Mejorarlo lo hace más hondo: del doble de tiempo al triple.
     */
    frena: (n = 1) => {
      const f = Math.max(0.30, 0.5 * Math.pow(0.945, Math.max(0, n - 1)))
      return {
        infanteria: Math.round(f * 100) / 100,
        distancia: Math.round(f * 100) / 100,
        asedio: Math.round(f * 0.66 * 100) / 100,
        caballeria: 0
      }
    },
    /**
     * Lo que "cuesta" esta casilla al buscar camino (una normal cuesta 1). Así el
     * enemigo prefiere rodear el foso e ir a la puerta, que es de lo que se trata.
     */
    costePaso: (n = 1) => Math.round(2 + n * 0.4),
    /** Arrasar fosos no da estrellas: no es arrasar la aldea, igual que los muros. */
    cuentaEnSaqueo: false
  }
}

export const TIPOS = Object.keys(EDIFICIOS)

/** @returns {any|null} ficha del edificio, o null si el tipo no existe. */
export function def (tipo) {
  return EDIFICIOS[tipo] || null
}

/** Escasez relativa de cada recurso: el oro vale cuatro maderas. */
const PESO_RECURSO = { madera: 1, piedra: 1.3, comida: 0.8, oro: 4 }

/**
 * Cuánto "vale" un edificio ya construido: todo lo invertido hasta su nivel,
 * pesado por escasez. Lo usan el botín de los asaltos y la puntuación de la
 * aldea, para que saquear una mina de oro rente más que tirar un pozo.
 */
export function valorEdificio (tipo, nivel = 1) {
  const d = def(tipo)
  if (!d) return 0
  const tope = Math.min(nivel, d.maxNivel || 1)
  let v = 0
  for (let n = 1; n <= tope; n++) {
    const c = d.coste(n)
    for (const r in PESO_RECURSO) v += (c[r] || 0) * PESO_RECURSO[r]
  }
  return Math.round(v)
}

/* ===========================================================================
   PARA QUÉ SIRVE CADA EDIFICIO — el texto que lee el jugador
   ---------------------------------------------------------------------------
   El juego tiene 27 edificios y hasta ahora la única pista era la frase de
   sabor del `desc`. El dueño lo dijo claro: «el granero y el almacén no sé
   para qué sirven». Esto lo arregla, y lo arregla DESDE EL CATÁLOGO: cada
   número sale de los mismos campos que usa la simulación (`capacidad`, `aura`,
   `bonusAtaque`…), así que cuando alguien reequilibre el juego los textos
   siguen cuadrando solos. Nadie escribe un número a mano en la interfaz.
   =========================================================================== */

const ES = new Intl.NumberFormat('es-ES')
/** Cifra a la española, con punto de los miles y como mucho un decimal. */
const cifra = (v) => {
  const n = Number(v) || 0
  const r = Math.round(n * 10) / 10
  return ES.format(r)
}
const porciento = (v) => `${Math.round((Number(v) || 0) * 100)} %`
const NOMBRE_RECURSO = { madera: 'madera', piedra: 'piedra', comida: 'comida', oro: 'oro' }
const ICONO_RECURSO = { madera: '🪵', piedra: '🪨', comida: '🌾', oro: '🪙' }

/** La frase de «qué hace esto», en cristiano. Nunca repite el nombre. */
export function paraQueSirve (tipo) {
  const d = def(tipo)
  return d?.paraQue || d?.desc || ''
}

/**
 * LO QUE HACE ESTE EDIFICIO A ESTE NIVEL, en números y con unidades.
 *
 * @param {string} tipo
 * @param {number} n nivel
 * @returns {Array<{clave:string, icono:string, etiqueta:string, valor:string, corto:string, nota:string}>}
 *   `valor` es la frase entera («madera +12.000 · piedra +12.000»), `corto` la
 *   versión de cintita y `nota` el porqué, para quien quiera entender la regla.
 */
export function efectosDe (tipo, n = 1) {
  const d = def(tipo)
  if (!d) return []
  const nivel = Math.max(1, Math.round(Number(n) || 1))
  const l = []
  const mas = (clave, icono, etiqueta, valor, corto, nota = '') =>
    l.push({ clave, icono, etiqueta, valor, corto: corto || valor, nota })

  if (typeof d.capacidad === 'function') {
    const c = d.capacidad(nivel) || {}
    const rec = Object.keys(c).filter(r => c[r])
    if (rec.length) {
      mas('capacidad', '📦', 'Sube el tope',
        rec.map(r => `${NOMBRE_RECURSO[r] || r} +${cifra(c[r])}`).join(' · '),
        rec.map(r => `${ICONO_RECURSO[r] || ''} +${cifra(c[r])}`).join(' '),
        'El tope es lo que te cabe guardado. Todo lo que produzcas por encima se tira.')
    }
  }

  if (d.produce && typeof d.porMinuto === 'function') {
    const min = d.porMinuto(nivel)
    mas('produce', ICONO_RECURSO[d.produce] || '⚙️', 'Produce',
      `${cifra(min * 60)} de ${NOMBRE_RECURSO[d.produce] || d.produce} por hora`,
      `${ICONO_RECURSO[d.produce] || ''} ${cifra(min * 60)}/hora`,
      'Con todos sus puestos llenos. Con los puestos vacíos rinde la cuarta parte.')
  }

  if (d.aura && typeof d.aura.bonus === 'function') {
    const afectado = def(d.aura.afecta)
    const quien = afectado ? `${afectado.nombre.toLowerCase()}s` : 'los de al lado'
    mas('aura', '🌬️', 'Mejora a los de al lado',
      `sube un ${porciento(d.aura.bonus(nivel))} lo que producen las ${quien} que tenga a ${cifra(d.aura.radio)} casillas`,
      `+${porciento(d.aura.bonus(nivel))} a las ${quien}`,
      `Juntando varios la mejora no pasa del ${porciento(d.aura.tope ?? 1)}: amontonarlos encima de las mismas ${quien} no sirve.`)
  }

  if (typeof d.bonusAtaque === 'function') {
    mas('ataque', '⚔️', 'Ataque de TODA tu tropa', `+${porciento(d.bonusAtaque(nivel))}`,
      `⚔️ +${porciento(d.bonusAtaque(nivel))} a toda la tropa`,
      'Vale para los soldados que ya tienes y para los que entrenes después, sin hacer nada más.')
  }
  if (typeof d.bonusArmadura === 'function') {
    mas('armadura', '🛡️', 'Armadura de TODA tu tropa', `+${porciento(d.bonusArmadura(nivel))}`,
      `🛡️ +${porciento(d.bonusArmadura(nivel))}`, 'Aguantan más golpes antes de caer.')
  }

  if (typeof d.aloja === 'function') {
    mas('aloja', '🛏️', 'Camas', `sitio para ${d.aloja(nivel)} vecinos más`, `🛏️ +${d.aloja(nivel)}`,
      'Sube el tope de gente de la aldea. Sin camas libres no llega nadie nuevo.')
  }
  if (typeof d.poblacionMax === 'function') {
    mas('poblacion', '👥', 'Tope de vecinos', `${d.poblacionMax(nivel)} en toda la aldea`, `👥 ${d.poblacionMax(nivel)}`,
      'Las casas suman camas por encima de este techo.')
  }
  if (typeof d.obrasSimultaneas === 'function') {
    const o = d.obrasSimultaneas(nivel)
    mas('constructores', '🔨', 'Constructores', `${o} ${o === 1 ? 'obra' : 'obras'} a la vez`, `🔨 ${o}`,
      'Lo que no cabe se queda en la cola y arranca solo cuando hay hueco.')
  }
  if (typeof d.plazas === 'function' && d.plazas(nivel) > 0) {
    const p = d.plazas(nivel)
    mas('plazas', '🧑‍🌾', 'Puestos de trabajo', `caben ${p} ${p === 1 ? 'aldeano' : 'aldeanos'} dentro`,
      `🧑‍🌾 ${p}`, 'Un puesto vacío es producción tirada: rinde la cuarta parte.')
  }

  if (Array.isArray(d.entrena) && d.entrena.length) {
    const nombres = d.entrena.map(t => UNIDADES[t]?.nombre || t).join(', ')
    mas('entrena', '⚒️', 'Entrena', nombres, `⚒️ ${nombres}`, '')
  }
  if (typeof d.velocidad === 'function' && d.velocidad(nivel) > 1) {
    mas('velocidad', '⏱️', 'Rapidez', `la tropa tarda un ${porciento(1 - 1 / d.velocidad(nivel))} menos`,
      `⏱️ −${porciento(1 - 1 / d.velocidad(nivel))} de espera`, 'Comparado con este mismo edificio a nivel 1.')
  }
  if (typeof d.velocidadInvestigacion === 'function' && d.velocidadInvestigacion(nivel) > 1) {
    mas('investiga', '📜', 'Rapidez', `investigar tarda un ${porciento(1 - 1 / d.velocidadInvestigacion(nivel))} menos`,
      `📜 −${porciento(1 - 1 / d.velocidadInvestigacion(nivel))}`, 'Comparado con esta misma universidad a nivel 1.')
  }
  if (typeof d.curacion === 'function') {
    mas('cura', '⛪', 'Salva heridos', `vuelve a casa el ${porciento(d.curacion(nivel))} de los que caen`,
      `⛪ salva el ${porciento(d.curacion(nivel))}`,
      'Los heridos se curan solos en la aldea y vuelven a pelear: cada asalto sale más barato.')
  }
  if (typeof d.comision === 'function') {
    mas('comision', '⚖️', 'Comisión del cambio', porciento(d.comision(nivel)), `⚖️ ${porciento(d.comision(nivel))}`,
      'Es lo que se queda el tendero en cada trueque. Cuanto más alto el mercado, menos se lleva.')
  }
  if (typeof d.exploradores === 'function') {
    const e = d.exploradores(nivel)
    const alc = typeof d.alcance === 'function' ? `, hasta ${d.alcance(nivel)} casillas` : ''
    mas('batidores', '🧭', 'Batidores', `${e} fuera a la vez${alc}`, `🧭 ${e} batidores`,
      'Descubren el valle: sin explorar no aparecen rivales a los que atacar.')
  }

  if (typeof d.dano === 'function') {
    const cad = d.cadencia || 0
    const alcance = typeof d.radio === 'function' ? d.radio(nivel) : 0
    mas('dispara', '🎯', 'Dispara sola',
      `${cifra(d.dano(nivel))} de daño por tiro, alcance ${cifra(alcance)} casillas`,
      `🎯 ${cifra(d.dano(nivel))} de daño`,
      cad ? `Tira ${cifra(cad)} veces por segundo: unos ${cifra(d.dano(nivel) * cad)} de daño por segundo a lo que tenga a tiro.` : '')
  }
  if (d.bloquea) {
    mas('bloquea', '🧱', 'Corta el paso', 'hay que derribarla para entrar', '🧱 Corta el paso',
      'Los arietes la tiran muchísimo más deprisa que la tropa normal: por eso los asaltos serios llevan asedio.')
  }
  if (typeof d.frena === 'function') {
    const f = d.frena(nivel) || {}
    const veces = cifra(1 / Math.max(0.01, f.infanteria || 1))
    mas('frena', '🕳️', 'Frena al que cruza',
      `a pie se cruza ${veces} veces más lento${f.caballeria === 0 ? ' y la caballería ni lo intenta' : ''}`,
      `🕳️ ${veces} veces más lento`,
      'No cierra el paso: deja al enemigo quieto delante de tus torres. Sin torres que lo cubran no vale nada.')
  }
  if (typeof d.hp === 'function') {
    mas('vida', '❤️', 'Aguanta', `${cifra(d.hp(nivel))} de daño antes de caer`, `❤️ ${cifra(d.hp(nivel))}`, '')
  }
  return l
}

/**
 * LA AYUDA, agrupada por PARA QUÉ SIRVE y no por pestaña del catálogo.
 * Se lee de arriba abajo en dos minutos y explica el juego entero.
 */
export const GRUPOS_AYUDA = [
  {
    id: 'produce',
    icono: '🪵',
    titulo: 'De dónde salen los recursos',
    texto: 'Estos trabajan solos, juegues o no (hasta 8 horas con el móvil guardado). Lo único que mandas tú es cuánta gente trabaja dentro: un edificio con los puestos vacíos rinde la cuarta parte. El molino es la excepción: él no produce nada, sube la cosecha de las granjas que tenga alrededor.',
    tipos: ['serreria', 'cantera', 'granja', 'mina_oro', 'molino']
  },
  {
    id: 'topes',
    icono: '📦',
    titulo: 'Dónde se guarda, y por qué se pierde',
    texto: 'Cada recurso tiene un TOPE. Cuando llegas al tope, todo lo que produzcas de más se tira: no se acumula en ninguna parte. El almacén sube el tope de madera y piedra; el granero, el de comida y oro. Si arriba ves «¡LLENO!» en rojo, estás perdiendo producción cada hora que pasa.',
    tipos: ['almacen', 'granero', 'mercado']
  },
  {
    id: 'gente',
    icono: '🛏️',
    titulo: 'La gente: camas y puestos de trabajo',
    texto: 'Los aldeanos son los que hacen producir a todo lo demás. Necesitan cama (el Ayuntamiento y las casas suben el tope) y un puesto donde trabajar. Si te sobran aldeanos sin faena están de brazos cruzados; si te faltan, tienes edificios a medio gas. Los que sobran se van solos a echar una mano en las obras.',
    tipos: ['ayuntamiento', 'casa']
  },
  {
    id: 'tropa',
    icono: '⚔️',
    titulo: 'Dónde se hace la tropa y cómo se mejora',
    texto: 'Cada cuartel saca su clase de soldado. La herrería es distinta: no entrena a nadie, mejora a TODA tu tropa a la vez, la de ahora y la de mañana, así que casi siempre renta más que otro cuartel. El monasterio te devuelve parte de los muertos de cada asalto y el taller de asedio fabrica lo único que abre murallas deprisa.',
    tipos: ['cuartel', 'arqueria', 'establo', 'taller_asedio', 'herreria', 'monasterio', 'universidad', 'campamento_explorador']
  },
  {
    id: 'defensa',
    icono: '🛡️',
    titulo: 'Cómo se defiende la aldea',
    texto: 'La muralla PARA: el que quiera entrar tiene que derribarla a golpes. El foso NO para, hace lento: el que lo cruza se queda quieto a tiro. Pero los que matan son las torres; los muros y los fosos solo les regalan tiempo, así que un muro sin torres detrás no sirve de nada. El puesto avanzado, además, avisa antes de que llegue un asedio.',
    tipos: ['muralla', 'puerta', 'foso', 'torre_vigia', 'torre_ballesta', 'castillo', 'puesto_avanzado']
  },
  {
    id: 'adorno',
    icono: '🚩',
    titulo: 'Adorno',
    texto: 'No hacen nada de nada. Están para que la aldea tenga cara de aldea.',
    tipos: ['pozo', 'estandarte']
  }
]
