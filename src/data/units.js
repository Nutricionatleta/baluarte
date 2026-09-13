/**
 * CATÁLOGO DE UNIDADES. Datos puros.
 *
 * EQUILIBRIO: ninguna unidad gana sola. Cada clase tiene quien se la come
 * (ver PIEDRA_PAPEL) y el `espacio` impide llenar el ejército de caballeros:
 * una tropa fuerte ocupa el hueco de tres lanceros.
 * La `comida` paga la carne de cañón y el `oro` la tropa de élite, así que
 * sin mina de oro no hay ejército decente por mucha granja que tengas.
 */

export const UNIDADES = {
  aldeano: {
    nombre: 'Aldeano',
    icono: '🧑‍🌾',
    desc: 'Ni pega ni corre, pero sin él no entra un tronco en la aldea.',
    clase: 'civil',
    coste: { comida: 50, oro: 0, madera: 0, piedra: 0 },
    tiempo: 15,
    hp: 40,
    ataque: 3,
    armadura: 0,
    velocidad: 1.6,
    alcance: 0,
    espacio: 0, // no ocupa ejército: cuenta en población, no en la hueste
    age: 'oscura',
    requiere: { ayuntamiento: 1 }
  },

  lancero: {
    nombre: 'Lancero',
    icono: '🔱',
    desc: 'Barato, abundante y la pesadilla de cualquiera que venga a caballo.',
    clase: 'infanteria',
    coste: { comida: 40, madera: 20, oro: 0, piedra: 0 },
    tiempo: 12,
    hp: 55,
    ataque: 7,
    armadura: 1,
    velocidad: 1.2,
    alcance: 0,
    espacio: 1,
    age: 'oscura',
    requiere: { cuartel: 1 }
  },

  espadachin: {
    nombre: 'Espadachín',
    icono: '🗡️',
    desc: 'Cota de malla y mal genio. Aguanta lo que el lancero no.',
    clase: 'infanteria',
    coste: { comida: 60, oro: 20, madera: 0, piedra: 0 },
    tiempo: 25,
    hp: 90,
    ataque: 11,
    armadura: 3,
    velocidad: 1.1,
    alcance: 0,
    espacio: 1,
    age: 'feudal',
    requiere: { cuartel: 3 }
  },

  arquero: {
    nombre: 'Arquero',
    icono: '🏹',
    desc: 'Pega de lejos y muere de cerca. No lo mandes el primero.',
    clase: 'distancia',
    coste: { madera: 45, oro: 15, comida: 0, piedra: 0 },
    tiempo: 20,
    hp: 45,
    ataque: 9,
    armadura: 0,
    velocidad: 1.2,
    alcance: 4,
    espacio: 1,
    age: 'feudal',
    requiere: { arqueria: 1 }
  },

  ballestero: {
    nombre: 'Ballestero',
    icono: '🎯',
    desc: 'Tarda en recargar, pero lo que toca deja de moverse.',
    clase: 'distancia',
    coste: { madera: 60, oro: 35, comida: 0, piedra: 0 },
    tiempo: 35,
    hp: 60,
    ataque: 14,
    armadura: 1,
    velocidad: 1.0,
    alcance: 5,
    espacio: 1,
    age: 'castillos',
    requiere: { arqueria: 3 }
  },

  jinete: {
    nombre: 'Jinete',
    icono: '🐎',
    desc: 'Rápido y molesto: entra, revienta a los arqueros y sale.',
    clase: 'caballeria',
    coste: { comida: 80, oro: 25, madera: 0, piedra: 0 },
    tiempo: 30,
    hp: 110,
    ataque: 12,
    armadura: 2,
    velocidad: 2.4,
    alcance: 0,
    espacio: 2,
    age: 'castillos',
    requiere: { establo: 1 }
  },

  caballero: {
    nombre: 'Caballero',
    icono: '🛡️',
    desc: 'Hierro sobre hierro. Carísimo y ocupa por tres, pero abre brechas.',
    clase: 'caballeria',
    coste: { comida: 100, oro: 70, madera: 0, piedra: 0 },
    tiempo: 50,
    hp: 170,
    ataque: 18,
    armadura: 4,
    velocidad: 2.1,
    alcance: 0,
    espacio: 3,
    age: 'castillos',
    requiere: { establo: 3 }
  },

  ariete: {
    nombre: 'Ariete',
    icono: '🪵',
    desc: 'Un tronco con techo. Contra tropa da risa; contra murallas, no hay nada mejor.',
    clase: 'asedio',
    coste: { madera: 160, oro: 40, comida: 0, piedra: 0 },
    tiempo: 60,
    hp: 260,
    // Pega poquísimas veces (cadencia de asedio, 0,5/s) y ocupa cuatro huecos,
    // así que contra tropa sigue siendo el peor del catálogo. Lo suyo es la
    // piedra: con el ×12 contra muro es la única forma rápida de abrir brecha.
    ataque: 20,
    armadura: 6, // el techo lo protege de las flechas, no de la infantería
    velocidad: 0.8,
    alcance: 0,
    espacio: 4,
    age: 'castillos',
    requiere: { taller_asedio: 1 }
  },

  catapulta: {
    nombre: 'Catapulta',
    icono: '🪨',
    desc: 'Lanza piedras del tamaño de un cerdo. Tan lenta como cara.',
    clase: 'asedio',
    coste: { madera: 180, piedra: 80, oro: 90, comida: 0 },
    tiempo: 90,
    hp: 120,
    // Dispara desde 7 casillas, o sea desde fuera del alcance de casi toda torre:
    // es el asedio que derriba edificios sin comerse un solo flechazo.
    ataque: 35,
    armadura: 1,
    velocidad: 0.8,
    alcance: 7,
    espacio: 5,
    age: 'imperial',
    requiere: { taller_asedio: 3 }
  },

  monje: {
    nombre: 'Monje',
    icono: '⛪',
    desc: 'No mata a nadie: cura a los tuyos y les recuerda por qué luchan.',
    clase: 'civil',
    coste: { oro: 100, comida: 0, madera: 0, piedra: 0 },
    tiempo: 45,
    hp: 50,
    ataque: 0,
    armadura: 0,
    velocidad: 1.0,
    alcance: 3, // cura desde atrás; si llega al frente, ya has perdido
    espacio: 1,
    age: 'castillos',
    requiere: { monasterio: 1 }
  },

  explorador: {
    nombre: 'Explorador',
    icono: '🧭',
    desc: 'Corre más que nadie y pregunta menos. Descubre el mapa del mundo.',
    clase: 'civil',
    coste: { comida: 60, oro: 0, madera: 0, piedra: 0 },
    tiempo: 25,
    hp: 60,
    ataque: 4,
    armadura: 0,
    velocidad: 3.0,
    alcance: 0,
    espacio: 0, // va al mapa del mundo, no al asalto
    age: 'oscura',
    requiere: { campamento_explorador: 1 }
  }
}

export const TIPOS_UNIDAD = Object.keys(UNIDADES)

/** @returns {any|null} ficha de la unidad, o null si el tipo no existe. */
export function defUnidad (tipo) {
  return UNIDADES[tipo] || null
}

/**
 * Ventajas de tipo: multiplicador de daño del atacante según la CLASE del
 * defensor ('edificio' para todo lo que no se mueve).
 * Regla de diseño: todo lo que pega fuerte a algo, pega flojo a otra cosa.
 *   lancero     -> caballería  (y la caballería lo revienta si va sin apoyo)
 *   arquero     -> infantería  (y muere si le entra un jinete)
 *   jinete/cab. -> distancia   (y se estrellan contra los lanceros)
 *   ariete/cat. -> edificios y MUROS (inútiles contra tropa)
 *   espadachín  -> asedio      (el guardaespaldas del ejército)
 *
 * Hay dos clases que no son tropa: 'edificio' (todo lo que no se mueve) y
 * 'muro' (muralla y puerta). Se separan porque una muralla grande suma cientos
 * de miles de vida: picarla a mano se come la batalla entera, y por eso el
 * asedio tiene su multiplicador aparte. Quien no lleva arietes, rodea.
 */
export const PIEDRA_PAPEL = {
  lancero: { caballeria: 2.0, asedio: 1.2, muro: 0.9 },
  espadachin: { infanteria: 1.3, asedio: 2.0, muro: 1.0 },
  arquero: { infanteria: 1.5, civil: 1.5, muro: 0.6 },      // una flecha no tira piedra
  ballestero: { infanteria: 1.3, caballeria: 1.6, muro: 0.7 },
  jinete: { distancia: 1.6, civil: 2.0, muro: 0.5 },
  caballero: { distancia: 1.8, asedio: 1.5, muro: 0.8 },
  ariete: { edificio: 5.0, muro: 12.0 },
  catapulta: { edificio: 5.0, muro: 6.0, distancia: 1.5 },
  aldeano: { muro: 0.3 },
  monje: {},
  explorador: {}
}
