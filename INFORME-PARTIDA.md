# INFORME DE PARTIDA — Baluarte

Control de calidad: **dos partidas completas de 30 días, jugadas de principio a fin automáticamente.**
Script: `scripts/partida-automatica.mjs` (`node scripts/partida-automatica.mjs`). No se ha tocado ni un fichero del juego.

---

## 0. Veredicto en cinco líneas

1. **Sí se puede terminar.** Se llega a la Edad Imperial el **día 11-12** jugando tres ratos al día (~65 min diarios). Lo confirman dos partidas completas independientes. Nada se atasca de forma definitiva.
2. **El problema no es que no se acabe, es que se acaba demasiado pronto y de la peor manera**: 19 de los 30 días son relleno, y entre el 54 % y el 72 % del tiempo de juego no hay nada que decidir porque las plazas de obra están ocupadas.
3. **El combate está roto de raíz: la guarnición enemiga nunca pisa el campo de batalla** — solo peleas contra edificios y torres. Y lo que sí decide las batallas (llevar tropa a distancia, y el reloj de 3 minutos contra murallas de 700.000 hp) no se explica en ninguna parte.
4. **La economía se desborda**: los almacenes de madera, piedra y oro acaban clavados al 100 % del tope en las dos partidas, y cerrar la app 8 horas tira entre el 89 % y el 94 % de lo producido.
5. **La piedra no es el cuello de botella y el oro nunca falta** — justo al revés de lo que dice el diseño. El cuello real es la **madera**, y solo hasta la Edad de los Castillos.

---

## 1. Cómo se ha jugado (para que los números se puedan reproducir)

- **Dos partidas completas de 30 días**, cada una de 30 días × 3 sesiones (20 / 20 / 25 min) = **32,5 horas de juego real** y **719 horas de reloj** por partida (las obras, la cola y las expediciones corren con la app cerrada). 936.000 ticks en total.
- Entre sesión y sesión la app se **cierra de verdad**: `guardar()` al salir y `cargar()` al volver, con el informe de producción offline. 90 ciclos de guardar/cargar por partida (180 en total).
- El "jugador" no llama funciones al azar: repara, asigna aldeanos, contrata, construye y mejora por una lista de prioridades, ahorra para el salto de edad, investiga, entrena tropa, manda expediciones y asalta al rival "igualado" que le ofrece el propio juego (`emparejar()`), usando exactamente la misma preparación de base que hace `ui/army-panel.js`.
- **Invariantes comprobados 1 vez por segundo de juego** (nada negativo, nada por encima del tope, nada NaN) y comprobación pesada cada 100 s (solapes, ids duplicados, obras huérfanas, trabajadores fantasma, población, huecos de ejército).
- El apaño de entorno (localStorage falso, `Date.now()` virtual, copia de `combat.js` sin `import.meta.glob`) está documentado en la cabecera del script.

---

## 2. ¿Se puede terminar? Ritmo real

| Edad | Se alcanza | Reloj | Jugado hasta ahí | Sesiones en esa edad |
|---|---|---|---|---|
| Oscura | inicio | 0 h | 0 | **1** |
| Feudal | **día 1**, 3.ª sesión | 6,3 h | ~40 min | 6 |
| Castillos | **día 3** | 54 h | ~2,5 h | 23 |
| **Imperial** | **día 11-12** | 240-300 h | ~11 h | **60 (el resto de la partida)** |

- **19 días (63 % de la partida) transcurren en la Imperial sin nada nuevo que desbloquear.** Las 19 tecnologías están investigadas el día 13. Los 33 encargos de la campaña, completados. El Ayuntamiento llega al 8 (máximo) el día 15.
- **La Edad Oscura dura una sola sesión.** El tutorial se termina en 20 minutos; nunca llegas a "vivir" en ella.
- **El agujero está entre el día 5 y el día 12**: siete días en la Edad de los Castillos en los que solo caen una tecnología y un nivel de Ayuntamiento. Es el único tramo que se hace largo, y es el tramo donde atacar sale a pérdidas (ver §5).

### Parones: el dato que más duele

| Medida | Partida A | Partida B |
|---|---|---|
| Tiempo jugado con **algo en marcha pero nada que decidir** | **1.395 min de 1.950 (71,8 %)** | **1.056 min (54,4 %)** |
| Tiempo jugado con **nada en marcha y nada que hacer** | 4,3 min (0,2 %) | 4,3 min (0,2 %) |
| Veces que las plazas de obra estaban **todas ocupadas** al ir a construir | 4.152 de ~5.850 decisiones (**71 %**) | — |
| Horas de obra encargadas en la partida | 452,8 h | — |
| Parón por edad (min bloqueado, partida A) | Oscura 6 · Feudal 74 · Castillos 300 · **Imperial 1.015** | |

Traducción: **abres el juego, cobras lo acumulado, y no hay nada que tocar porque las 2-4 plazas de obra ya están ocupadas.** No es que falte contenido: es que el cuello son las plazas de obra del Ayuntamiento, no los recursos.

---

## 3. Fallos, ordenados por gravedad

### 🔴 CRÍTICOS

**F1 — La guarnición enemiga no pelea. Solo peleas contra ladrillos.**
`src/sim/combat.js:213` (`crearTropas`) se llama **una sola vez**, en `src/sim/combat.js:355`, y solo con las tropas del atacante. `prepararBase()` (`src/sim/combat.js:100`) lee únicamente `base.buildings`. La guarnición que genera `world/enemies.js:552` (`generarGuarnicion`) **nunca se coloca en el campo de batalla**.
Consecuencias medidas:
- `enemigo.poder = poderTropas(guarnicion) + poderDefensas(base)` (`world/enemies.js:688`). Entre el 70 y el 90 % de ese número corresponde a tropas que no existen en la batalla, así que **el emparejamiento miente**.
- Contra un rival al que `ajustarPoder` le ha quitado los muros (F2), **todas** las composiciones probadas ganan 3 estrellas, arrasan el 100 % y sufren **0 bajas**, incluida "solo arqueros" (§5.2).
- Lo mismo pasa al defender: cuando te atacan (`simularDefensa`), **tu ejército tampoco defiende**. Solo tus torres y tus muros. Puedes tener 262 huecos de tropa en casa y no aportan nada.
- El `poder` que enseña la ficha del rival, por tanto, **no predice el resultado**: en la partida B los rivales de ratio 1,23-1,38 (“igualados”) fueron derrotas del 100 % de las veces, y el de ratio 1,45 (“exigente”) se ganó con 3★ y 0 bajas.

**F2 — `ajustarPoder()` derriba las defensas del rival para cuadrar el número: cuanto más "difícil", más fácil.**
`world/enemies.js:1041` (`ajustarPoder`). Cuando el rival criado supera el poder pedido por defensas, se le quitan muralla, puertas y torres hasta bajar del techo (`objetivo * 0.45`) y se compensa con **más tropa**… que por F1 no pelea. Medido en el laboratorio con el mismo ejército:

| Rival que ofrece el juego | Ratio de poder | Resultado | Bajas | Neto de recursos |
|---|---|---|---|---|
| **cómodo** (base real, con torres) | 0,48 | 3★, 100 % | **99** | **−1.605** |
| **igualado** (criado, muros derribados) | 0,92 | 3★, 100 % | **0** | +15.702 |
| **exigente** (criado, muros derribados) | 1,45 | 3★, 100 % | **0** | +15.651 |

El rival que el juego te vende como "un paseo" es el único que te hace daño.

**F3 — Perder una defensa casi no duele: los edificios arrasados siguen produciendo.**
`src/sim/combat.js:771` (`aplicarDaños`) baja `b.hp` pero **no pone `b.arruinado = true` ni vacía `b.trabajadores`**. Además emite `EV.BUILDINGS_DAMAGED` **y nadie lo escucha** (`grep -rn "events.on(EV.BUILDINGS_DAMAGED" src/` → 0 resultados), así que `sim/buildings.js:dañar()` nunca entra en juego. Un edificio "destruido" en tu aldea queda a **1 hp, no arruinado y produciendo al 100 %**. Solo pierdes recursos saqueados y ganas 4 h de escudo.

**F4 — Con el Ayuntamiento en obras, la aldea entera se congela.**
`sim/buildings.js:208` pone `b.enObra = true` al mejorar el Ayuntamiento, y `nivelDe()` (`sim/buildings.js:46`) **ignora los edificios en obra**, así que devuelve **0**. Con el Ayuntamiento a 0:
- `puedeMejorar()` bloquea **cualquier** mejora ("Necesitas el Ayuntamiento a nivel N").
- `puedeConstruir()` bloquea todo lo que tenga `requiere: { ayuntamiento: n }`: casa, cuartel, muralla, torres, mercado, mina de oro, campamento…
- `sim/villagers.js:260` devuelve `poblacion().maxima = 0` → el HUD marca **0 camas** y `contratar()` responde *"Sin ayuntamiento no hay a quién llamar"*.
- `sim/research.js:46` (`nivelEdificio`) hace lo mismo: se caen los requisitos de las tecnologías.

Medido: **101,6 min de los 1.950 jugados (5,2 %) con la aldea congelada**, y el salto 7→8 son **8 horas seguidas** en las que no puedes hacer prácticamente nada. Se detectó 61 veces en la partida.

### 🟠 ALTOS

**F5 — Volver tras una noche fuera es una pérdida neta de comida.**
`sim/resources.js:320` (`cobrarOffline`) ingresa la producción **recortada por el hueco que quede en el almacén**; `sim/army.js:343` (`comer`) cobra la manutención de las mismas 8 h **sin ese recorte**. Cuando el granero está lleno —que es casi siempre a partir de media partida— entra 0 y sale todo. Prueba de "cerrar la app 10 horas" al final de la partida:

```
antes:   madera 49.130  piedra 49.130  comida 27.440  oro 13.820   (almacenes al 100 %)
después: madera 49.130  piedra 49.130  comida     24  oro 13.820
ganado:  0 / 0 / −27.416 / 0
```
Producción de 8 h que debería haber entrado: 464.400 madera, 309.600 piedra, 933.792 comida, 136.080 oro. **Entró 0 y salieron 27.416.** El jugador vuelve con el granero vacío y la tropa con hambre (−20 % de ataque, `army.js:41`).

**F6 — El tope de 8 h offline es irrelevante: el almacén se llena en minutos.**
Al final de la partida la producción de **50 minutos** llena el almacén de madera. De la producción offline se pierde entre el 89 % y el 94 %. El `MAX_OFFLINE_HORAS: 8` de `core/config.js` no aporta nada frente al tope de almacén.

**F7 — `ui/audio.js:598` escucha `'ciclo:momento'`, una cadena suelta que NADIE emite.**
Viola la regla de CONTRATOS.md ("no emitas cadenas sueltas, añádelas a `EV`") y además deja muerto el ambiente de noche: `setAmbiente('noche')` no se llama jamás.

**F8 — El "+15 % de vida por edad" no existe.**
`sim/research.js:453` emite `EV.EDAD_VISUAL` con `multiplicadorHp: MULTIPLICADOR_HP_EDAD` (=1.15) y el propio comentario dice *"sim/buildings aplica el multiplicador a los hp"*. El único oyente en todo `src/` es `render/buildings.js:1494`, que solo cambia tejados. **La aldea nunca gana vida al subir de edad.**

**F9 — El contrato expediciones ↔ aldeanos está roto por un lado.**
`world/expeditions.js:376` (`reclutarAldeano`) y `:389` (`devolverAldeano`) emiten `EV.VILLAGER_ASSIGNED` con `{ fuera: true }` / `{ muerto: true }`, pero **`sim/villagers.js` no escucha `VILLAGER_ASSIGNED`** (solo lo emite; sus `events.on` están en las líneas 73-79). Resultado:
- **El aldeano nunca sale de la aldea ni deja su puesto**: sigue talando en la serrería mientras el informe cuenta que está cruzando el valle. La producción no baja ni un punto.
- `v.fuera` nunca se pone (lo único que evita mandar al mismo dos veces a la vez es `enExpedicion()`, dentro del propio módulo).
- Un explorador "perdido" (`inf.tipo = 'perdido'`, texto incluido: *"la aldea le puso una vela"*) **no muere**: el censo no baja.
En 30 días se mandaron **1.021 expediciones y el número de aldeanos nunca bajó** (7 → 46, monótono creciente). La expedición solo cuesta comida y no tiene ningún riesgo real.

**F10 — El banco no es el único que toca los recursos.**
`sim/villagers.js:820` (`cobrar`) resta directamente de `game.state.recursos` y emite `RESOURCES_CHANGED` a mano, saltándose `sim/resources.js` (que se declara "el ÚNICO módulo que escribe en `game.state.recursos`"). `sim/combat.js` hace lo mismo en sus caminos de respaldo (`ingresar`/`saquear`). Efecto colateral real: el gasto de contratar aldeanos **no cuenta en `stats`** ni pasa por la normalización a enteros.

**F11 — Eventos del catálogo `EV` que nadie escucha en todo el proyecto:**
`STATE_SAVED`, `BATTLE_EVENT`, `BUILDINGS_DAMAGED` (ver F3), `DEFENSE_SCORED`. El `'offline:report'` que emite `main.js` es además otra cadena fuera de `EV`.

**F12 — El guardado pesa 216 KB (217.631 bytes) y se escribe dos veces cada 10 segundos.**
`core/save.js` copia el guardado anterior a `baluarte.save.backup` antes de escribir el nuevo: **432 KB de `localStorage` cada 10 s**, más un `JSON.stringify` de 216 KB. Casi todo el peso son las bases enemigas (`world.enemigos[].base.buildings`: ~80 edificios por rival × 30 rivales descubiertos). En un móvil de gama baja eso es un tirón periódico garantizado.

### 🟡 MEDIOS

**F13 — El tope de población es inalcanzable.** `sim/villagers.js:269`: `costeContratar = 50 × 1,15^N`, sin tope. Con 46 aldeanos el siguiente cuesta **30.975 de comida** y el granero máximo son **27.440**. La partida terminó con **46 aldeanos y un tope teórico de 67**: los 21 restantes no se pueden contratar nunca.

**F14 — El avance de edad se bloquea por una investigación en curso** (`sim/research.js:401`). Con tecnologías de 4 h, el hito más importante del juego puede quedar aparcado horas por haber pulsado antes "investigar". El motivo que se enseña ("Tus sabios están investigando") no explica que basta con esperar o gastar gemas.

**F15 — `calcularDefensa()` puede decir "Bien defendida" con la muralla encerrando 0 %.** Resultado medido en las dos partidas: **62/100 y 64/100, nota "Bien defendida"**, con `recinto: 0 %` y `cerrada: false` (56 tramos de muralla que no encierran nada). La fórmula (`sim/combat.js`, sección 4 de `calcularDefensa`) da 45 % del peso a la cobertura de torres y 20 % a la pegada, así que se puede aprobar sin cerrar nada.

**F16 — Guardar y cargar pierde 1-2 campos.** En las 180 recargas de las dos partidas, las únicas diferencias detectadas fueron 1-2 campos `world.enemigos[N].proximoAtaque`, que vuelven al valor de generación. Sin impacto visible, pero el estado **no** es idempotente al ciclo guardar/cargar.

**F16b — `emparejar()` no aprende de tus derrotas.** En la partida B los **cinco últimos asaltos fueron idénticos**: mismo rival "igualado", 121 unidades enviadas, 121 bajas, 0 estrellas, 16,5 % arrasado, y la lista se lo volvía a ofrecer como objetivo recomendado. `world/enemies.js:emparejar()` solo mira `poder` y `derrotado`; no tiene memoria de "a este ya lo has intentado y te ha barrido".

**F17 — Ruido de interfaz.** 6.361 toasts en 32,5 h jugadas = **3,3 avisos por minuto**. Y `EV.RESOURCE_GAINED` se emite **1.012.095 veces** (2,2 por tick, ~8,6 por segundo): cada uno dispara un "+N" flotante en el render y un `sumar()` de encargos.

### ✅ Lo que NO ha fallado

En **936.000 ticks** (dos partidas) y 180 ciclos de guardar/cargar: **ni una excepción**, ni un `NaN`, ni un número negativo, ni un recurso por encima del tope, ni un edificio duplicado o solapado, ni una obra huérfana, ni un trabajador fantasma, ni una cola atascada. `JSON.stringify` del estado funciona siempre y no hay funciones ni referencias circulares dentro de `game.state`. El motor es **muy sólido**; lo que falla es el diseño de lo que hace.

---

## 4. Equilibrio de recursos, con números

### Lo que entra y lo que se tira (30 días)

| Recurso | Producido (A / B) | **Desperdiciado por almacén lleno** (A / B) | % perdido (A / B) |
|---|---|---|---|
| Madera | 783.637 / 2.135.032 | **703.024** / 60.326 | **47 %** / 3 % |
| Piedra | 706.309 / 1.453.680 | 386.993 / 61.256 | 35 % / 4 % |
| Comida | 1.175.345 / 2.114.405 | **1.307.629** / 362.003 | **53 %** / 15 % |
| Oro | 119.438 / 415.209 | **265.065** / 47.606 | **69 %** / 10 % |

La diferencia entre las dos partidas es que en la B el ejército se perdía entero cada asalto y había que reponerlo, o sea que **el único sumidero de recursos que existe de verdad en el juego es perder tropas**. En cuanto dejas de perderlas (partida A), la caja se desborda.

En las dos partidas el estado final es el mismo: madera **49.130/49.130**, piedra **49.130/49.130**, oro **13.820/13.820** — los tres clavados en el tope. Solo la comida baja, y porque la manutención del ejército la vacía.

### Cuál es el cuello de botella real, por edad

Veces que cada recurso fue lo que impidió la siguiente obra (partida A):

| Edad | Cuello dominante |
|---|---|
| Oscura | madera |
| Feudal | madera (4) · comida (2) |
| Castillos | **madera (14)** · comida (6) · piedra (3) |
| Imperial | **ninguno en 56 de 60 sesiones** |

Recuento global de bloqueos: partida A **madera 273 · comida 145 · piedra 117 · oro 14**; partida B **madera 418 · piedra 76 · comida 78 · oro 0**. En las dos manda la madera y en las dos el oro es lo que menos molesta (14 y **0** bloqueos en 30 días).

**El diseño dice una cosa y los números dicen otra:**
- `data/buildings.js:119` — *"La piedra es el cuello de botella del juego"*. **No lo es.** La piedra bloqueó 117 veces frente a 273 de la madera, porque lo único que come piedra en serio son murallas y torres, y salen baratísimas (un tramo de muralla: **15 de piedra y 5 segundos**; cerrar la aldea entera con 120 tramos cuesta 1.800 de piedra y se hace en la primera hora).
- `data/buildings.js:157` — *"El oro… nunca tendrás suficiente"*. **Siempre sobra.** Con 3 minas al máximo entran ~283 de oro/min y el granero tope son 13.820: **se llena en 49 minutos**. El oro bloqueó una obra 14 veces en la partida A y **ninguna** en la B.
- Producción final: **madera 967/min, piedra 645/min, comida 1.945/min, oro 283/min.** La comida triplica a todo lo demás y no tiene en qué gastarse más que en la manutención (124/min) y en contratar aldeanos (que se acaba, ver F13).

### Gemas: una moneda que sobra desde el principio

Las dos partidas terminaron con **2.826 y 2.712 gemas sin gastar** (rachas diarias, subidas de nivel, encargos y botín), sin haber gastado ni una. A 60 s por gema son **~47 horas de obra instantánea**. Para comparar: subir el Ayuntamiento del 1 al 7 son 7,6 h de obra y las tres ceremonias de edad suman 5,25 h; **el camino crítico entero de la partida cabe cuatro veces en las gemas que se regalan solas**. Quien las use se pasa el juego sin esperar ni una vez, y no hay ningún sumidero que las absorba.

---

## 5. Combate

La partida se jugó **dos veces enteras**. Salió exactamente el mismo ritmo (Feudal día 1, Castillos día 3, Imperial día 11-12) pero **resultados de combate opuestos**, y ahí está lo interesante: la diferencia fue **con qué tropa se atacaba**, y el juego no te da ninguna pista de que eso importe.

- **Partida A** — ejército de cuerpos baratos (37 lanceros, 47 espadachines, 48 ballesteros, 14 caballeros, 8 jinetes, 14 arietes): **72 victorias de 86**.
- **Partida B** — mismo número de huecos pero repartidos en unidades caras (24 caballeros, 24 arietes, 24 ballesteros, 24 espadachines, 24 lanceros): **16 victorias de 89**.

### 5.1 ¿Sale rentable atacar?

Neto real por asalto = botín − coste de reponer las bajas:

| Edad | Partida A (asaltos · ganados · neto real) | Partida B (asaltos · ganados · neto real) |
|---|---|---|
| Feudal | 3 · 2 · **+651** | 5 · 5 · **+1.539** |
| **Castillos** | 23 · **10 (43 %)** · **−988** | 28 · **10 (36 %)** · **−2.606** |
| Imperial | 60 · 60 (100 %) · +9.628 | 55 · **1 (2 %)** · **−12.068** |

- **En la Edad de los Castillos atacar sale a pérdidas en las dos partidas.** 57-91 bajas por asalto, 24 minutos de cola para reponerlas, y el botín no las cubre. Es justo el tramo más largo del juego.
- **Perder un asalto también da botín.** `botinDe()` reparte proporcionalmente al porcentaje destruido, sin exigir victoria: las derrotas dieron entre **+956 y +3.364** de recursos. Y `derrotar()` (con su desgaste `saqueos`) solo se aplica **si ganas**, así que **la misma base se puede farmear perdiendo, siempre al 100 % de botín**.
- **El juego te ofrece una y otra vez el rival que no puedes ganar.** En la partida B los cinco últimos asaltos fueron **idénticos**: mismo rival "igualado", 121 unidades enviadas, 121 bajas, 0 estrellas, 16,5 % arrasado. `emparejar()` no aprende nada de que acabes de perder contra él.

### 5.2 La composición SÍ importa muchísimo… contra un rival que aún tenga muros

Mismo presupuesto (262 huecos), mismo rival, misma semilla.

**Contra un rival al que `ajustarPoder()` le ha derribado el muro (solo 10 tramos):** da exactamente igual qué lleves. Las nueve composiciones probadas —incluida "solo arqueros"— ganan **3★, 100 % arrasado y 0 bajas**; lo único que cambia son los segundos de animación (28-54 s).

**Contra un rival de verdad (133 tramos de muralla + torres):** el resultado se parte en dos.

| Composición | Resultado | Bajas de 262 | Duración |
|---|---|---|---|
| **Solo ballesteros** (alcance 5) | **3★ · 100 %** | **58** | 179,6 s |
| Solo arqueros (alcance 4) | 2★ · 97,8 % | 109 | 180 s (tope) |
| Con asedio (2 arietes + resto) | 2★ · 97,8 % | 94 | 180 s (tope) |
| Con monjes | 2★ · 95,6 % | 89 | 180 s (tope) |
| Mixta infantería + distancia | 2★ · 97,8 % | 135 | 180 s (tope) |
| Solo espadachines | **0★ · 38,3 %** | **262 (todos)** | 165,8 s |
| Solo lanceros | **0★ · 15,5 %** | **262 (todos)** | 135,2 s |
| Solo jinetes | **0★ · 8,0 %** | 131 (todos) | 81,0 s |
| Solo caballeros | **0★ · 9,8 %** | 87 (todos) | 74,4 s |

**La regla real del combate, que el juego no explica en ningún sitio: el que dispara de lejos gana, el que va de frente muere entero.** Un ballestero se planta a 5,7 casillas del muro y pega desde ahí; una torre vigía de nivel 8 llega a 6,0 y una torre de ballestas de nivel 6 solo a 4,4, así que a la tropa a distancia casi no le llegan. El cuerpo a cuerpo tiene que cruzar por debajo de las torres.

Y luego está el **daño por hueco de ejército contra edificios**, que es lo que decide de verdad un asalto (`CADENCIA` de `sim/combat.js:27` × ataque × multiplicador de `PIEDRA_PAPEL`):

| Unidad | Daño/s por hueco | Coste por hueco |
|---|---|---|
| **Ballestero** | **11,9** | 60 madera + 35 oro |
| **Espadachín** | **11,0** | 60 comida + 20 oro |
| Catapulta | 8,8 | 36 mad + 16 pie + 18 oro |
| Arquero | 7,6 | 45 madera + 15 oro |
| Lancero | 7,0 | 40 comida + 20 madera |
| Jinete | 6,6 | 40 comida + 12,5 oro |
| Caballero | 6,6 | 33 comida + 23 oro |
| **Ariete** | **6,0 (el peor)** | 40 madera + 10 oro |

**El ariete —la máquina de tirar murallas, con su `edificio: 6.0`— es la peor unidad del juego por hueco contra edificios**, incluso contra muros. Y el caballero, que cuesta 70 de oro y ocupa por tres, rinde la mitad que un ballestero. La tabla `PIEDRA_PAPEL` (`data/units.js:217`) **solo evalúa dos entradas en toda la partida**: la de las torres disparando (×1,5 contra infantería y civiles) y la de ariete/catapulta contra edificios. Las otras veinte —lancero ×2 contra caballería, jinete ×1,6 contra distancia…— **nunca se evalúan**, porque no hay tropa enemiga (F1).

### 5.3 El reloj decide más que el ejército

`MAX_DURACION = 180` (`sim/combat.js:23`): la batalla se corta a los 3 minutos. Y los muros **no cuentan** para el porcentaje arrasado (`sim/combat.js:120`, `cuenta: !MUROS.has(tipo)`).

Las cuentas: un tramo de muralla de nivel 8 tiene **5.242 hp**; los 133 tramos del rival de la prueba suman **~697.000 hp**. Con la mejor unidad por hueco (ballestero, 11,9 dps) y el ejército al máximo (262 huecos) se hacen **3.118 de daño por segundo**: **224 segundos solo para el muro**, y el motor corta a 180. Por eso las composiciones buenas terminan todas clavadas en "180 s (tope)".

**Consecuencia:** a partir de cierto tamaño de muralla enemiga el resultado deja de depender de lo que lleves y pasa a depender del cronómetro. Y todo ese tiempo picando piedra suma **0 %** al porcentaje que da estrellas.

### 5.4 ¿Sirve la muralla?

**Atacando** (misma base, con y sin sus muros):

| Base rival | Resultado del asalto | Bajas | Duración |
|---|---|---|---|
| 10 tramos (rival "ajustado" por `ajustarPoder`) | 3★ · 100 % | 0 | 42,6 s |
| Los mismos 10 tramos, quitados | 3★ · 100 % | 0 | 34,2 s |
| **133 tramos (rival real)** | **2★ · 97,8 %** | **131** | 180 s (tope) |
| **Los mismos 133 tramos, quitados** | **3★ · 100 %** | **81** | **73 s** |

Con 133 tramos la muralla le cuesta al atacante **50 bajas más, una estrella y 107 segundos**. Funciona. Con 10 tramos no sirve de nada.

**Defendiendo** (mi aldea contra la hueste del rival):

| Mi aldea | Estrellas del enemigo | % arrasado |
|---|---|---|
| Con muralla | **0** (aguanta) | 39,7 % (A) / 15,5 % (B) |
| Sin muralla | **2** (te arrasan, A) / 0 (B) | 57,2 % (A) / 31,9 % (B) |

Defenderse **sí sirve**: es lo único del sistema de combate que se comporta como debería. Pero por **F3** (los edificios arrasados siguen produciendo al 100 %) el castigo de perder una defensa es casi simbólico, así que tampoco hay una razón fuerte para invertir en ella.

---

## 6. Guardar, cargar y offline

| Prueba | Resultado |
|---|---|
| 180 ciclos guardar → cargar (90 por partida) | ✅ sin pérdidas salvo 1-2 campos `enemigos[].proximoAtaque` (F16) |
| `JSON.stringify` / `parse` del estado | ✅ sin funciones, sin ciclos, sin NaN |
|  Tamaño del guardado a mitad de partida | ⚠️ **216 KB** (432 KB contando la copia de seguridad, cada 10 s) |
| Obras vencidas con la app cerrada | ✅ se completan de golpe con un solo aviso |
| Cola de tropas e investigación offline | ✅ avanzan por reloj absoluto |
| Cerrar la app **10 horas** | ⚠️ se recorta bien a 8 h… pero ver **F5/F6**: entra 0 y se pierden 27.416 de comida |

---

## 7. Rendimiento

Medido en Node (sin render 3D), Node 24, portátil.

| Medida | Valor | Presupuesto |
|---|---|---|
| **ms por tick, media (468.000 ticks)** | **0,267 ms** | 250 ms |
| ms por tick con la aldea llena (119 edificios, 46 aldeanos) | 0,262 ms | 250 ms |
| **Pico de un tick** | **436 ms** ⚠️ | 250 ms |
| Batalla completa defendiendo tu aldea (84 edificios, 167 atacantes) | **59,7 ms** | dentro de un tick |
| Batalla grande atacando (159 unidades) | **59,9 ms** | dentro de un tick |
| `generarBase()` de un rival | **10-12 ms** (4,8 ms a nivel 3) | dentro de un tick |
| `calcularDefensa()` | 3,0 ms | por consulta |
| `produccionPorMinuto()` | 0,06 ms | por consulta |
| `JSON.stringify` del guardado (216 KB) | **~8,5 ms** | cada 10 s, **×2** por la copia de seguridad |

**El tick en sí va sobradísimo** (0,27 ms de 250). El problema son cuatro cosas gordas que se hacen **síncronas dentro de `EV.TICK`** y clavan el frame:

1. **`world/enemies.js` genera bases enteras dentro del tick.** `generarBase()` cuesta 10-12 ms porque, por cada uno de los ~80 edificios, construye y **ordena** una lista de hasta 576 casillas candidatas (`world/enemies.js:233`, `colocar()`). Y hay dos caminos que hacen muchas seguidas: `poblarMundo()` (30 rivales de golpe ≈ **0,3-0,4 s**, disparado por `EV.WORLD_REVEALED` cuando vuelve la primera expedición) y `alTick → reconstruir()` para cada rival cuyo reloj de reconstrucción venza en la misma ventana de 5 s. Ahí está el pico de 436 ms.
2. **La batalla de defensa se resuelve dentro del tick** (`sim/combat.js:init` → `EV.TICK` → `simularDefensa()`): **60 ms** de golpe con la aldea llena.
3. **El autoguardado**: `JSON.stringify` de 216 KB (~8,5 ms) más **dos escrituras síncronas de `localStorage`** (`core/save.js` copia el guardado anterior al backup antes de escribir el nuevo), cada 10 segundos. En un móvil normal eso es un tirón perceptible cada diez segundos.
4. **Volumen de eventos**: `EV.VILLAGER_MOVED` se emite **8.050.109 veces** (17 por tick, uno por aldeano que camina) y `EV.RESOURCE_GAINED` **1.012.095** (2,2 por tick). En Node no cuestan nada; con `render/units.js` y los "+N" flotantes enganchados, sí.

> Nota: las cifras de esta tabla se han vuelto a medir aisladas. Una segunda pasada de la partida con la máquina cargada dio picos de 1,5 s: el margen es más estrecho de lo que parece.

---

## 8. Lo que más mejoraría el juego (por orden)

1. **Meter la guarnición enemiga en la batalla** (F1). Es el arreglo que más cambia el juego de golpe: convierte `PIEDRA_PAPEL`, el espacio por unidad, la herrería, las tecnologías de ataque y el emparejamiento en decisiones reales. Ahora mismo todo ese sistema está escrito y no se ejecuta. Lo mismo al defender: que tu tropa defienda tu aldea.
2. **Dejar de congelar la aldea cuando el Ayuntamiento está en obras** (F4). Que `nivelDe()` devuelva el nivel ya terminado aunque haya una mejora en marcha (o que el Ayuntamiento use `mejorando` como todos los demás). Es un cambio de dos líneas y elimina hasta 8 horas seguidas de pantalla muerta.
3. **Que el asalto sea legible.** Hoy el número que decide es invisible: el daño por hueco contra edificios (ballestero 11,9 · espadachín 11,0 · **ariete 6,0**) y el alcance frente al radio de las torres. Dos arreglos concretos: subir el ariete y la catapulta para que compensen sus 4-5 huecos (son las peores unidades del juego contra edificios, que es literalmente su oficio), y **enseñar en la pantalla de preparar el asalto el daño por segundo estimado contra esa base y los segundos que hacen falta**, en vez del `poder` actual, que no predice nada.
4. **Quitar el corte a los 3 minutos o hacer que los muros cuenten.** Un rival con 133 tramos de nivel 8 tiene 697.000 hp solo en muralla; el ejército al máximo hace 3.118 dps, o sea 224 s. Con `MAX_DURACION = 180` la batalla la gana el cronómetro, y encima esos 180 segundos picando muro suman 0 % al porcentaje que da estrellas.
5. **Más plazas de obra, o colas por edificio.** El 71 % de las veces que el jugador quiere construir, no hay hueco. Cuatro plazas al nivel 8 son pocas para 119 edificios. Alternativa barata: una cola de obras en espera que arranque sola al liberarse una plaza.
6. **Arreglar el bucle offline** (F5/F6): cobrar la manutención con el mismo recorte que la producción, y subir los topes de almacén (o bajar la producción) para que 8 horas fuera no se pierdan al 90 %. Hoy dejar el móvil una noche **te perjudica**.
7. **Reequilibrar los cuatro recursos.** Que la piedra sea de verdad el cuello (murallas y torres mucho más caras o con más usos) y que el oro deje de sobrar (más coste en tropa de élite y tecnología, o menos minas). En 30 días el oro no bloqueó **ni una sola obra** en una de las dos partidas.
8. **Que perder una defensa duela** (F3): marcar `arruinado`, parar la producción del edificio y obligar a repararlo. Si no, la muralla y las torres no tienen para qué estar.
9. **Rellenar la Edad Imperial o acortar el camino hasta ella.** 19 de 30 días sin nada nuevo. O se alarga el tramo Castillos → Imperial con contenido (no con esperas), o se abre algo después: niveles de tecnología repetibles, rivales de nivel 15+, temporadas.
10. **Dar un sumidero a las gemas** (2.800 sin gastar) y un tope al coste de contratar aldeanos (F13), que hoy hace inalcanzable el tope de población.
11. **Sacar `simularDefensa()` y `generarBase()` del tick** (pico de 436 ms) y bajar el ruido: 3,3 toasts por minuto y 8,6 "+N" flotantes por segundo.
12. **Limpiar el bus**: `BUILDINGS_DAMAGED`, `DEFENSE_SCORED`, `BATTLE_EVENT` y `STATE_SAVED` no los escucha nadie; `'ciclo:momento'` y `'offline:report'` son cadenas fuera de `EV`; y `sim/villagers.js:cobrar()` se salta el banco.

---

## 9. Notas para quien vaya a arreglar esto

- Los datos crudos de las dos partidas (hitos, sesión a sesión, los 86 y 89 asaltos, el laboratorio de combate, los ticks lentos y las pruebas de guardado) están en `scripts/partida-automatica.salida.json` (partida A) y `scripts/partida-v2.json` (partida B).
- Para repetirlo: `node scripts/partida-automatica.mjs` (30 días, ~3 min) o `--dias 12` para llegar a la Imperial en ~1 min.
- Las referencias a fichero:línea son de la versión del código del día del análisis. `src/sim/combat.js` y `src/world/enemies.js` se estaban editando a la vez, así que si un número no cuadra, busca por el nombre de la función, que sí está.
- Una pega del propio banco de pruebas: `src/sim/combat.js` carga `army.js` y `resources.js` con `import.meta.glob`, que es una extensión de Vite. Fuera de Vite lanza, se traga la excepción y el módulo se queda en su camino de respaldo —que usa **otra fórmula de armadura** (`armadura + armadura*bonus + bonus*4`) distinta de la de `army.js` (`armadura*(1+bonus)`)—. En el juego real no pasa, pero conviene unificar las dos fórmulas.

---

*Generado por `scripts/partida-automatica.mjs`.*
