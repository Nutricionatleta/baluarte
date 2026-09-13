/** Aleatoriedad CON SEMILLA: la misma semilla da siempre el mismo mundo. */
export function makeRng (seed = 1) {
  let s = seed >>> 0 || 1
  const next = () => {
    // mulberry32
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    /** entero en [min, max] ambos incluidos */
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    float: (min, max) => next() * (max - min) + min,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    /** baraja una copia */
    shuffle: (arr) => {
      const a = [...arr]
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[a[i], a[j]] = [a[j], a[i]]
      }
      return a
    }
  }
}

export const rng = makeRng(Date.now() & 0xffffffff)

let idCounter = 0
export const uid = (prefix = 'x') => `${prefix}_${(idCounter++).toString(36)}_${Math.random().toString(36).slice(2, 7)}`
