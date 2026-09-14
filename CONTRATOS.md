# BALUARTE — reglas para todo el que toque este código

Juego de estrategia medieval para móvil. Mezcla de **Clash of Clans** (construyes y
defiendes TU aldea, esperas cortas, asaltos) y **Age of Empires** (aldeanos que
trabajan, cuatro recursos, avance por edades, exploración del mapa).

**Corre en el navegador del móvil, sin servidor, sin cuenta y sin coste.**
Todo lo que necesite red está prohibido.

## Estética — esto no es negociable
Low-poly limpio y luminoso **tipo Stellar Settlers**: formas geométricas simples,
colores planos y saturados, nada de texturas ni de realismo…
**pero ambientado en la Edad Media a lo Age of Empires**: casas de adobe y paja,
murallas y torreones de piedra, tejados de teja roja, estandartes de tela,
aldeanos con túnica, capucha y delantal, soldados con casco, lanza, escudo y cota.
- **CERO archivos de arte.** Todas las mallas se generan por código con geometrías
  de Three.js (`BoxGeometry`, `ConeGeometry`, `CylinderGeometry`, `LatheGeometry`…).
  Ni .glb, ni .png, ni fuentes externas: así pesa poco, carga al instante y es gratis.
- Materiales: `MeshLambertMaterial` o `MeshToonMaterial` con color plano. Nunca PBR.
- **Todos los colores salen de `PALETA`** en `src/core/config.js`. Si necesitas un
  color nuevo, añádelo ahí; no escribas hexadecimales sueltos por el código.

## Reglas técnicas
1. **JavaScript moderno con módulos ES.** Sin TypeScript, sin frameworks, sin JSX.
   La única dependencia es `three`.
2. **Cada módulo exporta `init()`** (puede ser `async`). `src/main.js` lo llama solo.
3. **Los módulos NO se importan entre sí.** Se hablan por el bus: `events.emit(EV.X)`
   y `events.on(EV.X, fn)`. Sí puedes importar de `core/` y de `data/` (son la base común).
4. **`sim/` manda sobre los datos, `render/` y `ui/` solo miran.** Render y UI jamás
   modifican `game.state`: piden el cambio con un evento y la simulación decide.
5. **El estado es JSON puro.** Nada de objetos de Three.js ni funciones dentro de
   `game.state`: tiene que sobrevivir a `JSON.stringify`.
6. **La simulación va por `EV.TICK`** (`{ dt }`, 4 veces por segundo), nunca por
   `requestAnimationFrame`. Las animaciones del render sí van por frame.
7. **Móvil primero**: se juega con el dedo, en vertical, con una mano. Botones de
   **48 px mínimo**, texto legible, nada de `:hover` como única pista. Respeta las
   zonas seguras con `env(safe-area-inset-*)`.
8. **Rendimiento**: reutiliza geometrías y materiales (créalos UNA vez y compártelos),
   usa `InstancedMesh` para lo repetido (árboles, hierba, tropas), y ni un `new` dentro
   del bucle de render. Objetivo: 60 fps en un móvil normal, y que no queme batería.
9. **Todo en español**: nombres de variables, comentarios y textos de pantalla.
10. **Comenta el porqué, no el qué.** Poco comentario y que aporte.

## Mapa de ficheros — cada uno tiene dueño, no toques los ajenos
```
src/core/     events.js config.js state.js save.js clock.js grid.js rng.js   [YA HECHO, no tocar]
src/data/     buildings.js units.js techs.js quests.js names.js              [catálogos: solo datos]
src/sim/      resources.js buildings.js villagers.js army.js combat.js
              research.js quests.js progression.js
src/world/    map.js enemies.js expeditions.js
src/render/   scene.js terrain.js buildings.js units.js fx.js worldmap.js
src/ui/       hud.js build-panel.js army-panel.js world-panel.js audio.js styles.js
```

## Estado del juego (`game.state`) — campos ya fijados
```js
recursos: { madera, piedra, comida, oro }      // números enteros
almacen:  { madera, piedra, comida, oro }      // topes; si llenas, se desperdicia
jugador:  { nombre, nivel, xp, gemas }
age: 'oscura' | 'feudal' | 'castillos' | 'imperial'
buildings: [{ id, tipo, nivel, x, z, rot, ancho, alto, hp, enObra, finObra, trabajadores:[ids] }]
villagers: [{ id, nombre, job, buildingId, x, z, estado, portando:{tipo,cant} }]
ejercito:  { tropas: { lancero: 4, ... }, cola: [{ tipo, fin }],
             heridos: { lancero: 2, ... },           // convalecientes: no pelean, ocupan hueco
             curacion: { inicio, fin },              // reloj real de la enfermería
             reunion: { x, z, fijada, ancla } }      // el estandarte de batalla, en casillas
             escuadrones: [{ id, nombre, cometido:'ataque'|'defensa', tropas, puesto:{x,z,fijado} }] }  // el reparto de la hueste: quién sale y quién guarda qué flanco
obras:     [{ id, buildingId, tipo:'construir'|'mejorar', inicio, fin }]   // en marcha
colaObras: [{ id, buildingId, tipo:'construir'|'mejorar', encargada, aviso }] // esperando turno
expediciones: [{ id, destino, vuelve, explorador }]
asedios:   { jugado, total, ultimo }             // descanso entre asedios, medido en SEGUNDOS JUGADOS (no de reloj)
territorio: { parcelas: { '2,2': { estado:'mia'|'disponible', motivo, cuando } } }  // el tablero crece
world:     { descubierto: {}, nodos: [], enemigos: [] }
research:  { techId: true }
quests:    { activas: [], completadas: [] }
```
- Coordenadas de edificios y aldeanos **en casillas** (enteros para edificios,
  decimales para aldeanos que caminan). El render convierte con `gridAMundo()`.
- Valle de **60×60 casillas** repartido en **parcelas de 12×12** (`CONFIG.PARCELA`).
  El centro del tablero es el (0,0) del mundo 3D. **Solo se construye en las parcelas
  tuyas**: empiezas con las nueve del centro (36×36) y el resto se gana conquistando,
  explorando o cambiando de edad. `huecoLibre()` ya lo comprueba: no hace falta que
  nadie mire el territorio a mano.

## Eventos
Están todos en `EV` (`src/core/events.js`) con el payload comentado al lado.
Si necesitas uno nuevo, **añádelo a `EV`** con su comentario; no emitas cadenas sueltas.

## Equilibrio: el ritmo elegido
Híbrido. Construir/mejorar tarda **de 10 segundos a 2 horas** según el nivel
(las primeras mejoras, segundos: hay que enganchar en el primer minuto).
La producción **sigue acumulándose con la app cerrada**, con tope de 8 horas.
Se puede **acelerar con gemas** (1 gema = 60 s) y las gemas se ganan jugando,
con misiones y asaltos. **Nunca habrá pagos reales.**
