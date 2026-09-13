/**
 * NOMBRES. Datos puros: no hay Math.random aquí dentro, todo entra por el `rng`
 * con semilla de core/rng.js (rng.pick, rng.int, rng.chance) para que la misma
 * partida genere siempre los mismos aldeanos y los mismos rivales.
 */

/** Nombres de pila medievales castellanos, del siglo X al XIII. */
const HOMBRES = [
  'Sancho', 'Rodrigo', 'Íñigo', 'Mendo', 'Fruela', 'Vela', 'Nuño', 'Gonzalo',
  'Ramiro', 'Bermudo', 'Ordoño', 'Álvar', 'Munio', 'Lope', 'Diego', 'Tello',
  'Fernán', 'García', 'Suero', 'Gutier', 'Pelayo', 'Ansúrez', 'Bernardo', 'Martín'
]

const MUJERES = [
  'Urraca', 'Ximena', 'Berenguela', 'Elvira', 'Toda', 'Sancha', 'Mayor',
  'Aldonza', 'Teresa', 'Oneca', 'Estefanía', 'Mencía', 'Godo', 'Leodegundia',
  'Constanza', 'Blasquita', 'Justa', 'Velasquita', 'Guiomar', 'Aurembiaix'
]

/** Apodos: oficio, rasgo o procedencia. Es lo que les da cara sin gastar un polígono. */
const APODOS_H = [
  'el Herrero', 'el Tuerto', 'el Cojo', 'el Carpintero', 'el Cantero', 'el Zurdo',
  'el Molinero', 'el Barbudo', 'el Viejo', 'el Mozo', 'el Callado', 'el Panadero',
  'el Pastor', 'el Leñador', 'el Rojo', 'el Descalzo', 'el Tozudo', 'el Manco'
]

const APODOS_M = [
  'la Cantera', 'la Herrera', 'la Tejedora', 'la Partera', 'la Molinera',
  'la Roja', 'la Sabia', 'la Moza', 'la Callada', 'la Hilandera', 'la Tuerta',
  'la Panadera', 'la Pastora', 'la Descalza', 'la Tozuda', 'la Menuda'
]

/** Lugares de procedencia, para el "de ..." de los apodos y para los enemigos. */
const LUGARES = [
  'Nájera', 'Simancas', 'Carrión', 'Zamora', 'Osma', 'Berlanga', 'Amaya',
  'Lara', 'Saldaña', 'Clunia', 'Atienza', 'Sepúlveda', 'Gormaz', 'Peñafiel',
  'Coruña del Conde', 'Medinaceli', 'Ágreda', 'Calahorra', 'Monzón', 'Tordesillas'
]

/**
 * Nombre de un aldeano. Uno de cada tres lleva apodo: si lo llevaran todos,
 * la lista de aldeanos se vuelve un chiste largo e ilegible en el móvil.
 * @param {{pick:Function,int:Function,chance:Function}} rng
 */
export function nombreAldeano (rng) {
  const mujer = rng.chance(0.5)
  const pila = rng.pick(mujer ? MUJERES : HOMBRES)
  if (!rng.chance(0.34)) return pila
  return rng.chance(0.75)
    ? `${pila} ${rng.pick(mujer ? APODOS_M : APODOS_H)}`
    : `${pila} de ${rng.pick(LUGARES)}`
}

const TITULOS_H = ['Don', 'El conde', 'El infanzón', 'El señor', 'El alcaide']
const TITULOS_M = ['Doña', 'La condesa', 'La infanta', 'La señora']

const EPITETOS_H = [
  'el Negro', 'el Cruel', 'el Calvo', 'el Fiero', 'el Cuervo', 'el Lobo',
  'el Traidor', 'el Soberbio', 'el Gordo', 'el Sin Tierra', 'el Malcasado',
  'el de las Cicatrices', 'Mano de Hierro', 'Cara de Piedra'
]

const EPITETOS_M = [
  'la Negra', 'la Cruel', 'la Fiera', 'la Loba', 'la Soberbia',
  'la Implacable', 'la de Hierro', 'la Sin Perdón'
]

/** Bandas y huestes: enemigos que no tienen cara, solo mala fama. */
const HUESTES = ['la Hueste de', 'la Mesnada de', 'los Jinetes de', 'la Cabalgada de']
const BANDIDOS = [
  'los Bandidos del Vado', 'los Lobos del Robledal', 'la Cuadrilla del Puerto',
  'los Salteadores del Páramo', 'los Cuervos del Río', 'la Gente del Cerro',
  'los Hijos de la Niebla', 'los Desterrados de Lara'
]

/**
 * Nombre de un señor rival o de una banda. Reparto: la mitad son señores con
 * título (dan miedo y se recuerdan), un tercio huestes de un lugar (suenan a
 * ejército) y el resto bandidos (los rivales de andar por casa).
 * @param {{pick:Function,int:Function,chance:Function}} rng
 */
export function nombreEnemigo (rng) {
  const d = rng.int(1, 100)
  if (d <= 50) {
    const mujer = rng.chance(0.3)
    const titulo = rng.pick(mujer ? TITULOS_M : TITULOS_H)
    const pila = rng.pick(mujer ? MUJERES : HOMBRES)
    const epiteto = rng.pick(mujer ? EPITETOS_M : EPITETOS_H)
    return `${titulo} ${pila} ${epiteto}`
  }
  if (d <= 80) return `${rng.pick(HUESTES)} ${rng.pick(LUGARES)}`
  return rng.pick(BANDIDOS)
}

/**
 * Nombres para la aldea del jugador. Es una LISTA: la interfaz la usa para
 * proponer nombres al empezar y `nombreAldea(rng)` saca uno al azar.
 */
export const NOMBRE_ALDEA = [
  'Baluarte', 'Villaseca', 'Peñalta', 'Fuenterrobre', 'Torrevieja del Soto',
  'Valdehonda', 'Castroviejo', 'Montealegre', 'Ribafrecha', 'Otero de Abajo',
  'Pozoamargo', 'Cerro del Cuervo', 'Fuente Espada', 'Villamuriel',
  'Robledal', 'Peñarroya', 'Aldealseñor', 'Vadoancho', 'Sotobravo', 'Castrillo'
]

/** @param {{pick:Function}} rng */
export function nombreAldea (rng) {
  return rng.pick(NOMBRE_ALDEA)
}
