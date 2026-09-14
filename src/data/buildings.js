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
 * PUESTOS DE TRABAJO frente a ALDEANOS — la cuenta que cuadra la aldea (sep-2026).
 *
 * Lo que arregla esto: se podían levantar 3 serrerías, 3 canteras y 3 granjas
 * (18 plazas con la fórmula vieja) teniendo camas para 7 aldeanos. Media aldea
 * trabajaba al 25 % y el jugador no se enteraba hasta mucho después.
 *
 * REGLA DURA: en CADA nivel de Ayuntamiento el tope de población tiene que
 * cubrir TODAS las plazas que el juego deja construir en ese momento, y sobrar
 * gente. La cuenta es cerrada porque ningún edificio pasa de nivel del
 * Ayuntamiento (sim/buildings.js) y los de recursos tienen tope de unidades
 * (`max`): 4 serrerías + 4 canteras + 5 granjas (13 desde la Edad Oscura) y
 * 3 minas de oro desde la Feudal (16 en total), más el campamento aparte.
 *
 *   Edad       Ayto    Edificios   Plazas de recursos   Batidores   TOTAL   Población   Sobran
 *   Oscura      1-3        13         13 x 1 = 13           2         15        24        +9
 *   Feudal      3-8        16         16 x 3 = 48           3         51        62       +11
 *   Castillos   9-10       16         16 x 3 = 48           3         51        66       +15
 *   Imperial   11-14       16         16 x 4 = 64           3         67        88       +21
 *
 * Los niveles intermedios también salen: ayto 4 → 34 plazas con 40 de tope;
 * ayto 7 → 35 con 46; ayto 11 → 51 con 68. Nunca falta gente.
 *
 * Y la gente que sobra no está de adorno: son los MARTILLOS. Las obras admiten
 * 3 constructores cada una y el Ayuntamiento del 9 en adelante abre 6 obras a
 * la vez, o sea hasta 18 aldeanos en andamios. Por eso el colchón crece con el
 * Ayuntamiento (+9 en la Oscura, +21 en la Imperial) en vez de quedarse fijo.
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
    // TOPE DE POBLACIÓN. Ya no es una geométrica que se dispara al final y deja
    // la Edad Oscura con 5 camas: sigue paso a paso a las plazas de trabajo
    // (ver la tabla de `plazasDeTrabajo`). El escalón gordo cae en los niveles
    // 4, 8 y 12, que es justo donde los edificios de recursos ganan una plaza,
    // así que el tope y la faena suben el MISMO día.
    //   1→20  2→22  3→24 | 4→40  5→42  6→44  7→46 | 8→62 ... 11→68 | 12→84 ... 14→88
    poblacionMax: (n = 1) => 20 + 14 * Math.floor(n / 4) + 2 * (Math.max(1, n) - 1),
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
