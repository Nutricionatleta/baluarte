/**
 * HUD — lo que el jugador ve SIEMPRE por encima del 3D.
 *
 * Filosofía: poco, grande y claro. En un móvil de 5 pulgadas el HUD ES el juego,
 * así que solo vive aquí lo que se mira cada diez segundos:
 *   arriba  → qué tengo y a qué RITMO entra (recursos con su +X/h, gente, gemas)
 *   derecha → qué está pasando (obras, tropa, ciencia) y cuánto falta
 *   abajo   → qué conviene hacer AHORA (consejo con su botón) y los cuatro paneles
 * El centro de la pantalla se deja libre: ahí está la aldea, que es lo bonito.
 * En un móvil de 390x844 quedan más de 600 px de 3D sin tapar; está medido.
 *
 * Reglas que se respetan a rajatabla:
 *   - No se toca `game.state` (única excepción documentada: `ajustes`, que son
 *     preferencias del jugador y nadie más las escribe).
 *   - No se repinta por frame: se reacciona a eventos y hay un refresco ligero
 *     cuatro veces por segundo, el mismo ritmo que el tick de la simulación.
 */
import { events, EV } from '../core/events.js'
import { CONFIG, ICONO } from '../core/config.js'
import { game } from '../core/state.js'
import { def as defEdificio, AGE_NOMBRE, efectosDe, paraQueSirve, GRUPOS_AYUDA } from '../data/buildings.js'
import { defUnidad, UNIDADES, PIEDRA_PAPEL } from '../data/units.js'
import { centroDe, dist } from '../core/grid.js'
import * as guardado from '../core/save.js'
import {
  el, vaciar, hoja, toast, confirmar, formatoNumero, formatoTiempo,
  costeHTML, barraProgreso, latir, pestañas
} from './styles.js'

/* ===========================================================================
   Acceso a la simulación
   Se cargan una vez y se guardan: si un módulo no está (o peta), el HUD sigue
   funcionando con lo que tenga. Nunca se cae la interfaz por una pieza que falte.
   =========================================================================== */

const M = { recursos: null, edificios: null, aldeanos: null, ejercito: null, ciencia: null, encargos: null }

const CARGADORES = {
  recursos: () => import('../sim/resources.js'),
  edificios: () => import('../sim/buildings.js'),
  aldeanos: () => import('../sim/villagers.js'),
  ejercito: () => import('../sim/army.js'),
  ciencia: () => import('../sim/research.js'),
  encargos: () => import('../sim/quests.js')
}

async function engancharSim () {
  await Promise.all(Object.entries(CARGADORES).map(async ([clave, cargar]) => {
    try { M[clave] = await cargar() } catch (err) { console.warn(`[hud] sin ${clave}:`, err?.message || err); M[clave] = null }
  }))
}

/** Llama a una función de sim/ solo si existe. Devuelve `porDefecto` si no. */
function pedir (modulo, funcion, porDefecto, ...args) {
  const f = M[modulo]?.[funcion]
  if (typeof f !== 'function') return porDefecto
  try { return f(...args) } catch (err) { console.warn(`[hud] ${modulo}.${funcion}()`, err); return porDefecto }
}

const NOMBRE_RECURSO = { madera: 'Madera', piedra: 'Piedra', comida: 'Comida', oro: 'Oro' }

/* ===========================================================================
   Estilos propios del HUD
   styles.js manda en el lenguaje visual (botones, paneles, hojas). Aquí solo se
   añade la COLOCACIÓN de las piezas fijas del HUD, que nadie más necesita.
   =========================================================================== */

const CSS = `
/* --alto-top = lo que ocupan las esquinas de arriba; lo miden y lo publican
   aquí para que nada (avisos, tira del mundo) se coloque encima. */
#hud { --alto-top: 58px; --alto-alarma: 0px; }
#hud.alarmado { --alto-alarma: 54px; }

/* ---------- UNA sola barra arriba ----------
   Todo lo que hay que mirar cabe en una línea de 48 px: los cuatro recursos a
   la izquierda y, a la derecha, gente, gemas, nivel y constructores. Es una
   ÚNICA cápsula con separadores finos: cuatro marcos y cuatro paddings se
   comían el ancho que hace falta para que las cifras quepan. El centro y los
   lados quedan libres: ahí está la aldea, que es a lo que se juega. */
.hud-barra {
  position: fixed; z-index: 20;
  top: calc(var(--seg-arriba) + var(--alto-alarma) + 5px);
  left: calc(var(--seg-izq) + 6px); right: calc(var(--seg-der) + 6px);
  display: flex; align-items: stretch; gap: 0;
  min-height: 48px; padding: 0 2px;
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 2px solid var(--madera); border-radius: var(--r-max);
  box-shadow: var(--sombra-suave), var(--brillo);
  transition: top var(--medio) var(--curva);
  overflow: hidden;
}
/* separador fino entre grupos: una raya, no un marco */
.hud-barra > * + * { border-left: 1px solid rgba(90, 58, 34, .25); }
.hud-sep { flex: 1 1 0; min-width: 0; border: none !important; }

/* Recursos: icono + cantidad, una barrita de llenado de 3 px y, debajo, la
   producción por hora en pequeño. El TOPE en cifras no cabe en una línea de
   390 px sin recortar algo peor, así que lo cuenta la barrita (roja al tope,
   con «¡LLENO!» en su sitio) y el número exacto está a un toque, en el panel
   de producción y en la etiqueta de accesibilidad. */
.res {
  flex: 1 1 0; min-width: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
  padding: 3px 2px;
  font-family: inherit; color: var(--tinta); text-align: center;
  background: none; border: none;
}
.res:active { background: rgba(90, 58, 34, .12); }
.res-cab { display: flex; align-items: baseline; justify-content: center; gap: 2px; min-width: 0; max-width: 100%; }
.res-cab > i { flex: none; font-style: normal; font-size: .92em; line-height: 1; }
.res-cab > b { flex: none; font-size: .76em; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.res-cab > small { display: none; }
.res-ritmo { font-size: .54em; line-height: 1.1; font-variant-numeric: tabular-nums; white-space: nowrap; }
.res .barra-progreso { width: 82%; height: 3px; border-width: 1px; }

/* al tope no se produce: se está tirando comida a la basura y se dice en rojo */
.res.lleno { background: rgba(179, 51, 43, .16); }
.res.lleno .res-cab > b { color: var(--rojo-oscuro); }
.res.casi .res-cab > b { color: var(--oro-oscuro); }
.res.abierto { background: rgba(212, 164, 55, .3); }

/* ---------- pastillas de la barra: gente, gemas, nivel, constructores ----------
   Sin marco propio (lo pone la barra) y «flex: none»: sin eso la fila encogía
   las pastillas y las cifras de dos dígitos (13/22, 216 gemas) se salían. */
.pastilla {
  position: relative; overflow: hidden; flex: none;
  display: inline-flex; align-items: center; justify-content: center; gap: 3px;
  min-height: 44px; padding: 2px 5px;
  font-family: inherit; font-size: .7em; font-weight: 800; line-height: 1.05;
  color: var(--tinta);
  background: none; border: none;
  white-space: nowrap;
}
.pastilla > i { flex: none; font-style: normal; font-size: 1.15em; }
.pastilla > b { flex: none; font-variant-numeric: tabular-nums; text-align: right; }
button.pastilla:active { background: rgba(90, 58, 34, .12); }
/* anchos mínimos en «ch»: la pastilla ya nace con sitio para el valor más
   largo que puede aparecer, así no se ensancha ni se estrecha al vuelo */
.pastilla-gemas > b { min-width: 3.2ch; }
.pastilla-nivel > b { min-width: 1.6ch; text-align: center; }
/* los parados van EN LÍNEA, nunca como globo encima de la cifra */
.parados {
  flex: none; font-style: normal; font-size: .82em; line-height: 1;
  min-width: 16px; padding: 2px 3px; text-align: center;
  color: #fff3ec; background-image: linear-gradient(180deg, var(--rojo-claro), var(--rojo));
  border: 1px solid var(--rojo-oscuro); border-radius: var(--r-max);
  font-variant-numeric: tabular-nums;
}
/* el nivel enseña la experiencia como relleno del propio botón: cero píxeles extra */
.pastilla-xp { position: absolute; inset: 0; width: 0; background: rgba(242, 200, 92, .42); transition: width var(--medio) var(--curva); }
.pastilla > span, .pastilla > b, .pastilla > i { position: relative; }
.hud-redondo { position: relative; flex: none; width: 48px; min-width: 48px; height: 48px; min-height: 48px; padding: 0; font-size: 1.2em; border-radius: var(--r-max); }

/* los avisos flotantes de styles.js nacen arriba del todo y a lo ancho, o sea
   justo encima de la barra: se bajan por debajo de ella y se pegan a la
   izquierda, estrechos, para no tapar ni las cifras ni los botones redondos de
   la derecha. Breves y arriba, como pidió el dueño, pero sin comerse el dato. */
#hud > .capa-toast {
  top: calc(var(--alto-top) + 6px);     /* --alto-top ya lleva dentro la alarma */
  left: calc(var(--seg-izq) + 6px); transform: none;
  width: min(72vw, 282px);
  align-items: flex-start;
}

/* ---------- lo que está en marcha, en pastillas (derecha) ----------
   Antes aquí había una columna de tarjetas de obra, una por edificio, y se
   comía media pantalla. Ahora es un botón de constructores (con los libres a
   la vista) y, como mucho, dos pastillas más: tropa y ciencia. El detalle de
   quién hace qué se abre al tocar, que es donde de verdad se mira. */
/* Constructores: una pastilla más de la barra (🔨 2/3). En verde cuando hay
   alguno sin faena, que es cuando hay que hacerle caso. */
.pastilla-obras.libre > b { color: var(--verde-oscuro); }
.pastilla-obras.libre > i { filter: drop-shadow(0 0 3px rgba(111, 184, 92, .9)); }
.pastilla-obras > small { display: none; }

/* ---------- botones de lo que está en marcha ----------
   Explorador, tropa y ciencia: botones REDONDOS pegados al borde derecho, justo
   debajo de la barra. Antes el explorador era una tira entera encima del menú
   (queja del dueño). Solo aparecen cuando hay algo que mirar. */
.hud-minis {
  position: fixed; z-index: 15;
  top: calc(var(--alto-top) + 6px);     /* --alto-top ya lleva dentro la alarma */
  right: calc(var(--seg-der) + 6px);
  display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
  pointer-events: none;
  transition: top var(--medio) var(--curva);
}
.hud-minis > * { pointer-events: auto; }
.mini {
  position: relative; flex: none;
  width: 48px; min-width: 48px; min-height: 48px; padding: 2px;
  display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 0;
  font-family: inherit; font-size: .8em; font-weight: 800; line-height: 1.1;
  color: var(--tinta); white-space: nowrap;
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 3px solid var(--madera); border-radius: var(--r-max);
  box-shadow: 0 4px 0 var(--madera-oscura), var(--brillo);
}
.mini:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--madera-oscura); }
.mini > i { flex: none; font-style: normal; font-size: 1.3em; line-height: 1; }
.mini > b { flex: none; font-size: .62em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.mini > small { display: none; }
.mini.sin-cuenta > i { font-size: 1.5em; }
/* el de las fugas, en rojo y con latido: es el único que pide que lo toques */
.mini-aviso {
  background-image: linear-gradient(180deg, var(--rojo-claro), var(--rojo));
  border-color: var(--rojo-oscuro); color: #fff3ec;
  box-shadow: 0 4px 0 var(--rojo-oscuro), var(--brillo);
}
/* late el icono, no el botón entero: un botón que se mueve se falla al tocarlo */
.mini-aviso > i { animation: latido 2.2s var(--curva) infinite; }
.mini-aviso > b { font-size: .72em; }
.mini-aviso:active { box-shadow: 0 1px 0 var(--rojo-oscuro); }
/* el de aldeanos es más ancho: «120/120» son siete caracteres y tienen que
   caber enteros dentro del botón, sin recortes ni globos encima */
.mini-ancho { width: 68px; min-width: 68px; padding: 2px 3px; border-radius: var(--r-g); }
.mini-ancho > b { font-size: .6em; letter-spacing: -.02em; }
/* los parados, globo rojo en la esquina del botón: nunca encima de la cifra */
.mini .parados { position: absolute; top: -6px; right: -4px; }

/* ---------- hoja de constructores ---------- */
.constructor-libre {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border: 2px dashed rgba(74, 143, 60, .7); border-radius: var(--r-m);
  background: rgba(111, 184, 92, .14);
}
.constructor-libre > i { font-style: normal; font-size: 1.6em; line-height: 1; }
.obra {
  padding: 6px 8px 8px;
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 2px solid var(--madera); border-radius: var(--r-m);
  box-shadow: var(--sombra-suave);
  animation: pop var(--medio) var(--curva) both;
}
.obra-cab { display: flex; align-items: center; gap: 5px; font-size: .76em; font-weight: 800; line-height: 1.1; }
.obra-cab span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.obra-cab em { margin-left: auto; font-style: normal; color: var(--madera); font-variant-numeric: tabular-nums; }
.obra-pie { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
.obra-pie .barra-progreso { flex: 1; height: 12px; }
.btn-gema { min-width: 48px; min-height: 48px; padding: 0 6px; font-size: .78em; line-height: 1.1; }


/* ---------- alarma de ataque ----------
   Una TIRA estrecha pegada al BORDE DE ARRIBA, nunca un cartel en medio de la
   pantalla (queja del dueño: tapaba la aldea). Cuando sale, las dos esquinas
   bajan un escalón (--alto-alarma) y no se solapa nada. Cuenta
   atrás en pequeño y, debajo, en una línea, qué se puede hacer: el jugador
   se quedaba mirando el aviso sin saber qué tocar. Toda la tira es botón. */
.hud-alarma {
  position: fixed; z-index: 40;
  top: calc(var(--seg-arriba) + 4px); left: calc(var(--seg-izq) + 8px); right: calc(var(--seg-der) + 8px);
  display: flex; align-items: center; gap: 9px;
  min-height: 46px; padding: 5px 10px;
  font-family: inherit; text-align: left;
  color: #fff3ec; font-weight: 800;
  background-image: linear-gradient(180deg, var(--rojo-claro), var(--rojo));
  border: 2px solid var(--rojo-oscuro); border-radius: var(--r-max);
  box-shadow: var(--sombra-suave);
  animation: pop var(--medio) var(--curva) both;
}
.hud-alarma > i { flex: none; font-style: normal; font-size: 1.35em; line-height: 1; animation: tiembla 1.6s ease-in-out infinite; }
.hud-alarma .alarma-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0; }
.hud-alarma .alarma-tit { font-size: .82em; line-height: 1.15; }
/* el consejo es lo que salva al jugador: una línea, sin partir palabras */
.hud-alarma .alarma-que { font-size: .72em; font-weight: 700; line-height: 1.2; opacity: .92; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hud-alarma b { flex: none; font-size: .92em; font-variant-numeric: tabular-nums; }
.hud-alarma em { flex: none; font-style: normal; font-size: 1.1em; opacity: .8; }
.hud-alarma:active { transform: translateY(1px); }

/* ---------- celebración ---------- */
.hud-fiesta { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; pointer-events: none; }
.fiesta-carta { width: min(84vw, 340px); text-align: center; padding: 22px 18px; animation: pop 320ms var(--curva) both; }
.fiesta-carta .icono-gr { font-size: 3.4em; display: block; animation: latido 900ms var(--curva) 2; }
.fiesta-carta h3 { margin: 8px 0 4px; font-size: 1.4em; }
.fiesta-carta p { margin: 0; color: var(--tinta-suave); font-weight: 700; }

/* ---------- botonera y consejo de abajo ---------- */
.hud-abajo {
  position: fixed; z-index: 20; left: 0; right: 0; bottom: 0;
  display: flex; flex-direction: column; gap: 4px;
  /* pegada al borde de abajo, como pidió el dueño, respetando el hueco del
     iPhone (env(safe-area-inset-bottom) llega aquí como --seg-abajo) */
  padding: 0 calc(var(--seg-der) + 8px) calc(var(--seg-abajo) + 2px) calc(var(--seg-izq) + 8px);
  pointer-events: none;
}
.hud-abajo > * { pointer-events: auto; }

/* El mayordomo: UNA línea y 52 px de alto. Antes eran dos líneas y una tarjeta
   gorda encima del menú, y se comía la aldea (queja del dueño). */
.hud-consejo {
  display: flex; align-items: center; gap: 8px;
  min-height: 52px; padding: 2px 2px 2px 10px;
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 3px solid var(--madera); border-radius: var(--r-max);
  box-shadow: var(--sombra-panel);
}
.hud-consejo > i { flex: none; font-style: normal; font-size: 1.3em; line-height: 1; }
.hud-consejo > span {
  flex: 1; min-width: 0;
  font-size: .74em; font-weight: 700; line-height: 1.2;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.consejo-ir { flex: none; min-height: 44px; padding: 0 12px; font-size: .8em; white-space: nowrap; }
.hud-consejo.urgente { border-color: var(--rojo); box-shadow: var(--sombra-panel), 0 0 0 3px rgba(179, 51, 43, .35); }
.hud-consejo.urgente > i { animation: latido 1.4s var(--curva) infinite; }

.hud-botonera { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.hud-boton {
  position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  min-height: 54px; padding: 4px 1px;
  font-family: inherit; font-weight: 800; color: var(--tinta);
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 3px solid var(--madera); border-radius: var(--r-m);
  box-shadow: 0 4px 0 var(--madera-oscura), var(--brillo);
}
.hud-boton:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--madera-oscura); }
.hud-boton i { font-style: normal; font-size: 1.35em; line-height: 1; }
.hud-boton small { font-size: .6em; letter-spacing: -.01em; }

/* ---------- panel de producción ---------- */
/* los cuatro recursos tienen que verse a la vez: nada de barrer de lado */
.eco-tabs { overflow: visible; }
.eco-tabs .pestaña { flex: 1 1 0; min-width: 0; padding: 6px 2px; font-size: .86em; gap: 3px; }
.eco-cab { display: flex; align-items: center; gap: 10px; }
.eco-cab > i { font-style: normal; font-size: 2.1em; line-height: 1; }
.eco-cab .eco-cifras { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.eco-cab .ritmo { font-size: 1.5em; line-height: 1.05; }
.eco-cab small { font-size: .78em; font-weight: 700; color: var(--tinta-suave); font-variant-numeric: tabular-nums; }
.eco-seccion { margin: 2px 0 -2px; font-size: .78em; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--tinta-suave); }
.eco-lista { border: 2px solid rgba(90, 58, 34, .28); border-radius: var(--r-m); background: rgba(255, 255, 255, .45); overflow: hidden; }
.eco-pie { display: flex; align-items: center; gap: 6px; }
.eco-pie .crece { font-size: .74em; font-weight: 800; line-height: 1.2; }
.eco-pie .btn { flex: none; padding: 0 10px; font-size: .9em; }
.eco-pie .btn .pequeño { margin-left: 4px; font-weight: 800; }

/* ---------- ficha de edificio ---------- */
.ficha-cab { display: flex; align-items: center; gap: 12px; }
.ficha-cab .icono-gr { font-size: 2.4em; }
/* la frase de «para qué sirve» es lo primero que se lee: tinta normal y
   cuerpo entero. La frase de sabor va debajo, pequeña y en cursiva. */
.ficha-paraque { font-size: .88em; font-weight: 700; line-height: 1.3; color: var(--tinta); }
.ficha-sabor { font-style: italic; line-height: 1.3; margin-top: -4px; }
/* «Qué hace»: una fila por efecto, con su número y el porqué debajo */
.que-hace { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.que-fila { display: flex; align-items: flex-start; gap: 9px; }
.que-fila > i { flex: none; font-style: normal; font-size: 1.3em; line-height: 1.15; width: 24px; text-align: center; }
.que-txt { min-width: 0; display: flex; flex-direction: column; gap: 1px; font-size: .86em; line-height: 1.3; }
.que-txt b { font-weight: 800; }
.que-txt small { font-size: .82em; font-weight: 600; color: var(--tinta-suave); line-height: 1.25; }
.ficha-gente { display: flex; align-items: center; gap: 10px; }
.ficha-gente .btn { min-width: 62px; font-size: 1.3em; }
.ficha-gente-num { flex: 1; text-align: center; font-size: 1.1em; font-weight: 800; line-height: 1.15; font-variant-numeric: tabular-nums; }
.ficha-gente-num small { display: block; font-size: .62em; font-weight: 700; color: var(--tinta-suave); }
.ficha-acciones { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ficha-acciones .ancho { grid-column: 1 / -1; }
/* una mejora que aún no se puede pagar TIENE que dejar leer su coste */
.ficha-acciones .btn[disabled] { filter: grayscale(.5); opacity: .7; }

/* ---------- gestionar el edificio desde su propia ficha ---------- */
.ficha-seccion { margin: 4px 0 -2px; font-size: .8em; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--tinta-suave); }
.tropa-fila {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 9px;
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 2px solid var(--madera); border-radius: var(--r-m);
}
.tropa-fila > i { flex: none; font-style: normal; font-size: 1.7em; line-height: 1; width: 30px; text-align: center; }
.tropa-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.tropa-txt b { font-size: .92em; }
.tropa-txt .coste { font-size: .78em; }
.tropa-txt small { font-size: .74em; font-weight: 700; color: var(--tinta-suave); line-height: 1.2; }
.tropa-botones { flex: none; display: flex; gap: 6px; }
.tropa-botones .btn { min-width: 48px; min-height: 48px; padding: 0 8px; font-size: .86em; font-variant-numeric: tabular-nums; }
.tropa-cola { display: flex; flex-wrap: wrap; gap: 6px; }
.tropa-cola .chip { font-variant-numeric: tabular-nums; }
.ficha-nota { font-size: .78em; font-weight: 700; color: var(--tinta-suave); line-height: 1.25; }

/* pantallas estrechas: lo primero que sobra es el adorno, nunca el dato */
@media (max-width: 365px) {
  .pastilla { padding: 2px 4px; font-size: .68em; }
  .res-cab > b { font-size: .72em; }
  .hud-boton small { font-size: .56em; }
}
/* pantallas muy cortas: el HUD se aprieta antes de tapar el juego */
@media (max-height: 680px) {
  .hud-boton { min-height: 52px; }
  .hud-consejo { min-height: 48px; }
  .hud-consejo > span { -webkit-line-clamp: 1; }
}
`

function inyectarEstilos () {
  if (document.getElementById('estilos-hud')) return
  const nodo = document.createElement('style')
  nodo.id = 'estilos-hud'
  nodo.textContent = CSS
  document.head.appendChild(nodo)
}

/* ===========================================================================
   Números que suben solos
   Un recurso que salta de 300 a 460 de golpe no se lee; subiendo, sí.
   =========================================================================== */

const animados = new Map()   // nodo -> { actual, objetivo }
let animando = false

function fijarNumero (nodo, objetivo, { instante = false, formato = formatoNumero } = {}) {
  if (!nodo) return
  let estado = animados.get(nodo)
  if (!estado) { estado = { actual: objetivo, objetivo, formato }; nodo.textContent = formato(objetivo) }
  estado.objetivo = objetivo
  estado.formato = formato
  // saltos absurdos (cargar otra partida) no se animan: se plantan
  if (instante || Math.abs(estado.objetivo - estado.actual) > 100000) {
    estado.actual = objetivo
    nodo.textContent = formato(objetivo)
  }
  animados.set(nodo, estado)
  if (!animando) { animando = true; requestAnimationFrame(pasoAnimacion) }
}

function pasoAnimacion () {
  let quedan = false
  for (const [nodo, e] of animados) {
    if (!nodo.isConnected) { animados.delete(nodo); continue }
    const fmt = e.formato || formatoNumero
    const dif = e.objetivo - e.actual
    if (Math.abs(dif) < 0.6) {
      if (e.actual !== e.objetivo) { e.actual = e.objetivo; nodo.textContent = fmt(e.objetivo) }
      continue
    }
    e.actual += dif * 0.22
    nodo.textContent = fmt(Math.round(e.actual))
    quedan = true
  }
  animando = quedan
  if (quedan) requestAnimationFrame(pasoAnimacion)
}

/**
 * Cifra larga pero legible: hasta 99.999 se escribe entera con el punto de los
 * miles (99.999 gemas caben de sobra en su pastilla); de ahí para arriba se
 * abrevia (120,4K). Sin esto, `formatoNumero` convertía 99.999 en «100,0K»,
 * que además de feo mentía.
 */
const MILES = new Intl.NumberFormat('es-ES')
function numeroLargo (n, limite = 100000) {
  const v = Math.floor(Number(n) || 0)
  return Math.abs(v) < limite ? MILES.format(v) : formatoNumero(v)
}

/** Texto corto y siempre con signo: "+720/h", "−90/h", "0/h". */
function porHora (v) {
  const n = Number(v) || 0
  const abs = Math.abs(n)
  const cifra = abs < 10 ? String(Math.round(abs * 10) / 10).replace('.', ',') : formatoNumero(Math.round(abs))
  if (n > 0) return `+${cifra}/h`
  if (n < 0) return `−${cifra}/h`
  return '0/h'
}

const tonoRitmo = (v) => v > 0 ? 'ritmo-bien' : v < 0 ? 'ritmo-mal' : 'ritmo-cero'

/* ===========================================================================
   La economía de un vistazo
   sim/resources.js no exporta el desglose edificio a edificio, así que aquí se
   calcula el PESO de cada uno (base × aldeanos × aura) y se reparte con él el
   total real que devuelve `produccionPorMinuto()`. Los multiplicadores globales
   (ciencia, edad, ánimo) son iguales para todos, así que se van en la división:
   lo que se enseña por edificio cuadra con lo que entra en la caja.
   =========================================================================== */

const MINIMO_SIN_ALDEANOS = 0.25   // mismo reparto por faena que sim/resources.js

function pesosProduccion () {
  const s = game.state
  const auras = []
  for (const b of s.buildings || []) {
    if (b.enObra) continue
    const d = defEdificio(b.tipo)
    if (!d?.aura) continue
    const c = centroDe(b)
    auras.push({ x: c.x, z: c.z, radio: d.aura.radio, afecta: d.aura.afecta, bonus: d.aura.bonus(b.nivel || 1) })
  }

  const filas = []
  const suma = { madera: 0, piedra: 0, comida: 0, oro: 0 }
  for (const b of s.buildings || []) {
    if (b.enObra) continue
    const d = defEdificio(b.tipo)
    if (!d?.produce || typeof d.porMinuto !== 'function') continue
    const nivel = b.nivel || 1
    const plazas = typeof d.plazas === 'function' ? Math.max(0, d.plazas(nivel)) : 0
    const dentro = Math.min(plazas, (b.trabajadores || []).length)
    const faena = plazas > 0 ? MINIMO_SIN_ALDEANOS + (1 - MINIMO_SIN_ALDEANOS) * (dentro / plazas) : 1

    let aura = 0
    if (auras.length) {
      const c = centroDe(b)
      for (const a of auras) if (a.afecta === b.tipo && dist(c.x, c.z, a.x, a.z) <= a.radio) aura += a.bonus
    }

    const peso = d.porMinuto(nivel) * faena * (1 + aura)
    suma[d.produce] = (suma[d.produce] || 0) + peso
    filas.push({
      id: b.id, tipo: b.tipo, nombre: d.nombre || 'Edificio', icono: d.icono || '🏚️',
      recurso: d.produce, nivel, peso, plazas, dentro, x: b.x, z: b.z
    })
  }
  return { filas, suma }
}

/**
 * Foto completa: por recurso, lo que entra, lo que come la tropa, el saldo,
 * cuánto falta para llenar el almacén y qué edificio aporta cada cosa.
 */
function economia () {
  const s = game.state
  const { filas, suma } = pesosProduccion()
  const pm = pedir('recursos', 'produccionPorMinuto', null) || suma
  const comeTropa = (Number(pedir('ejercito', 'consumoComida', 0)) || 0) * 60

  const out = {}
  for (const r of CONFIG.RECURSOS) {
    const entra = (pm[r] || 0) * 60
    const gasta = r === 'comida' ? comeTropa : 0
    const neto = entra - gasta
    const cantidad = Math.floor(s.recursos?.[r] || 0)
    const tope = Math.floor(s.almacen?.[r] || 0)
    const escala = suma[r] > 0 ? (pm[r] || 0) / suma[r] : 0

    const edificios = filas
      .filter(f => f.recurso === r)
      .map(f => ({ ...f, porHora: f.peso * escala * 60 }))
      .sort((a, b) => b.porHora - a.porHora)

    const lleno = tope > 0 && cantidad >= tope
    out[r] = {
      cantidad, tope, entra, gasta, neto, lleno, edificios,
      pct: tope > 0 ? Math.min(100, (cantidad / tope) * 100) : 0,
      // el ritmo que se ve en la barra: si está lleno, no entra nada aunque produzca
      ritmo: lleno ? 0 : neto,
      desperdicio: lleno ? Math.max(0, neto) : 0,
      llenaEn: (!lleno && neto > 0 && tope > cantidad) ? ((tope - cantidad) / neto) * 3600 : null,
      aldeanos: edificios.reduce((n, e) => n + e.dentro, 0),
      plazasLibres: edificios.reduce((n, e) => n + Math.max(0, e.plazas - e.dentro), 0)
    }
  }
  return out
}

/** Cuánta gente hay, cuánta cabe y cuánta está de brazos cruzados. */
function gente () {
  const s = game.state
  const p = pedir('aldeanos', 'poblacion', null) || { actual: (s.villagers || []).length, maxima: 0 }
  const trabajos = pedir('aldeanos', 'resumenTrabajos', null)
  const parados = trabajos
    ? (trabajos.parado || 0)
    : (s.villagers || []).filter(v => !v.buildingId).length
  return { actual: p.actual || 0, maxima: p.maxima || 0, parados, coste: pedir('aldeanos', 'costeContratar', 0) }
}

/** Producción real de un edificio concreto, por hora. */
function produccionDe (id) {
  const eco = economia()
  for (const r of CONFIG.RECURSOS) {
    const f = eco[r].edificios.find(e => e.id === id)
    if (f) return { recurso: r, porHora: f.porHora, dentro: f.dentro, plazas: f.plazas }
  }
  return null
}

/* ===========================================================================
   LO QUE TE ESTÁ HACIENDO DAÑO
   El jugador no puede arreglar lo que no ve. Aquí se buscan las cuatro fugas
   que más caras salen —almacén rebosando, puestos vacíos, sin camas y sin
   quien dispare— y se dicen con su número y su botón para arreglarlo. Salen en
   el botón ⚠️ del borde derecho, que es donde el jugador ya mira.
   =========================================================================== */

function problemas () {
  const s = game.state
  const eco = economia()
  const g = gente()
  const lista = []
  const mas = (o) => lista.push(o)

  // 1. almacén al tope: cada hora que pasa se tira producción de verdad
  for (const r of CONFIG.RECURSOS) {
    const e = eco[r]
    if (!e.lleno) continue
    const guarda = (r === 'comida' || r === 'oro') ? 'granero' : 'almacen'
    const nombre = (defEdificio(guarda)?.nombre || 'almacén').toLowerCase()
    mas({
      clave: `lleno-${r}`, icono: ICONO[r], peso: 100,
      titulo: `${NOMBRE_RECURSO[r]} al tope`,
      detalle: e.desperdicio > 0
        ? `Estás perdiendo ${formatoNumero(Math.round(e.desperdicio))} de ${r} por hora: no cabe más. Gástalo o levanta otro ${nombre}.`
        : `No cabe más ${r}: lo que produzcas de más se tira. Gástalo o levanta otro ${nombre}.`,
      boton: 'Ver', accion: () => abrirEconomia(r)
    })
  }

  // 2. se gasta más de lo que entra (la tropa come)
  for (const r of CONFIG.RECURSOS) {
    const e = eco[r]
    if (e.neto >= 0 || e.cantidad <= 0) continue
    mas({
      clave: `mengua-${r}`, icono: '📉', peso: 90,
      titulo: `Se te acaba ${NOMBRE_RECURSO[r].toLowerCase()}`,
      detalle: `Sale más de lo que entra: en ${formatoTiempo(e.cantidad / (-e.neto) * 3600)} te quedas a cero.`,
      boton: 'Ver', accion: () => abrirEconomia(r)
    })
  }

  // 3. puestos de trabajo vacíos: producción tirada sin que se note
  const vacios = []
  for (const r of CONFIG.RECURSOS) for (const e of eco[r].edificios) {
    if (e.plazas > e.dentro) vacios.push(e)
  }
  if (vacios.length) {
    const faltan = vacios.reduce((n, e) => n + (e.plazas - e.dentro), 0)
    mas({
      clave: 'puestos', icono: '🧑‍🌾', peso: 80,
      titulo: `${faltan} ${faltan === 1 ? 'puesto vacío' : 'puestos vacíos'}`,
      detalle: g.parados > 0
        ? `Tienes ${g.parados} ${g.parados === 1 ? 'aldeano' : 'aldeanos'} sin oficio y ${faltan} ${faltan === 1 ? 'puesto' : 'puestos'} sin cubrir. Un puesto vacío rinde la cuarta parte.`
        : `Te falta gente para llenarlos (${vacios[0].nombre} tiene ${vacios[0].dentro} de ${vacios[0].plazas}). Sube el tope con casas y contrata.`,
      boton: g.parados > 0 ? 'Repartir' : 'Ver',
      accion: g.parados > 0
        ? () => { pedir('aldeanos', 'asignarAutomatico', 0); pintarRecursos(); toast('Cada uno a su faena', 'bien') }
        : () => abrirEconomia(null)
    })
  }

  // 4. sin camas: la aldea deja de crecer y no se entiende por qué
  if (g.maxima > 0 && g.actual >= g.maxima) {
    mas({
      clave: 'camas', icono: '🛏️', peso: 70,
      titulo: 'No quedan camas',
      detalle: `${g.actual} de ${g.maxima} vecinos: no llegará gente nueva hasta que levantes casas o mejores el Ayuntamiento.`,
      boton: 'Construir', accion: () => events.emit(EV.UI_PANEL, { panel: 'construir', datos: { categoria: 'centro' } })
    })
  }

  // 5. un hueco en la defensa: que nadie cubra el Ayuntamiento es el peor
  const ayto = (s.buildings || []).find(b => b.tipo === 'ayuntamiento')
  if (ayto) {
    const torres = (s.buildings || []).filter(b => !b.enObra && typeof defEdificio(b.tipo)?.dano === 'function')
    const c = centroDe(ayto)
    const cubren = torres.filter(t => {
      const d = defEdificio(t.tipo)
      const ct = centroDe(t)
      return dist(c.x, c.z, ct.x, ct.z) <= (d.radio?.(t.nivel || 1) || 0) + 2
    }).length
    if (!cubren) {
      mas({
        clave: 'defensa', icono: '🗼', peso: 60,
        titulo: torres.length ? 'Tu Ayuntamiento está descubierto' : 'Nadie defiende la aldea',
        detalle: torres.length
          ? 'Ninguna torre llega hasta el Ayuntamiento: si el enemigo se planta ahí, no le dispara nadie.'
          : 'No tienes ni una torre. Los muros solo dan tiempo; quien mata al que entra son las torres.',
        boton: 'Poner torre', accion: () => events.emit(EV.UI_PANEL, { panel: 'construir', datos: { categoria: 'defensa' } })
      })
    }
  }

  return lista.sort((a, b) => b.peso - a.peso)
}

/** El botón ⚠️: cuántas fugas hay y, al tocarlo, cuáles y cómo se arreglan. */
function abrirProblemas () {
  const cuerpo = el('div', { clase: 'col' })
  const panel = hoja({
    titulo: '⚠️ Qué te está costando partida',
    contenido: cuerpo,
    alCerrar: () => refrescadores.delete(pintar)
  })

  // Se repinta solo cuando cambia la LISTA, no cuatro veces por segundo: si no,
  // el dedo del jugador se queda sin tarjeta a mitad de toque.
  let firma = null
  function pintar () {
    const lista = problemas()
    const nueva = lista.map(p => p.clave).join('|')
    if (nueva === firma) return
    firma = nueva
    vaciar(cuerpo)
    if (!lista.length) {
      cuerpo.appendChild(el('div', { clase: 'aviso aviso-bien' }, [
        el('i', { texto: '✅' }),
        el('span', { texto: 'La aldea va fina: no se pierde nada, todo el mundo trabaja y hay quien vigile.' })
      ]))
      return
    }
    cuerpo.appendChild(el('p', { clase: 'tenue pequeño', estilo: { margin: '0' }, texto: 'Ninguna de estas cosas te para el juego, pero todas te cuestan partida. De más grave a menos:' }))
    for (const p of lista) {
      cuerpo.appendChild(el('div', { clase: 'panel col', estilo: { padding: '10px 12px', gap: '6px' } }, [
        el('div', { clase: 'fila', estilo: { gap: '9px' } }, [
          el('span', { clase: 'icono-gr', texto: p.icono }),
          el('b', { clase: 'crece', texto: p.titulo })
        ]),
        el('div', { clase: 'pequeño', estilo: { lineHeight: '1.35' }, texto: p.detalle }),
        el('button', {
          clase: 'btn btn-oro btn-gordo', type: 'button', texto: p.boton,
          onclick: () => { panel.cerrar(); p.accion() }
        })
      ]))
    }
  }
  pintar()
  refrescadores.add(pintar)
  return panel
}

/* ===========================================================================
   Montaje
   =========================================================================== */

const raiz = () => document.getElementById('hud') || document.body

const nodos = {}                  // piezas fijas del HUD
const refrescadores = new Set()   // paneles abiertos que quieren latido de 4/s
let vistaActual = 'aldea'
let alarma = null

export async function init () {
  inyectarEstilos()
  await engancharSim()

  montarArriba()
  montarObras()
  montarAbajo()
  conectarEventos()

  pintarRecursos(true)
  pintarObras()
  pintarConsejo()
  pintarBadges()
  pintarAvisos()
  medirTop()

  // Un solo latido para todo lo que cuenta hacia atrás. Nada de rAF: el HUD no
  // necesita 60 fps, necesita ir al mismo paso que la simulación.
  setInterval(refrescoLigero, 250)
  addEventListener('resize', medirTop)
}

let vueltas = 0
function refrescoLigero () {
  if (document.hidden) return
  vueltas++
  pintarObras()
  pintarAlarma()
  if (vueltas % 4 === 0) { pintarRecursos(); pintarBadges(); pintarAvisos(); medirTop() }   // 1 vez/s
  if (vueltas % 12 === 0) pintarConsejo()                            // 1 vez cada 3 s
  for (const f of refrescadores) { try { f() } catch (err) { console.warn('[hud] refresco', err) } }
}

/** Lo que ocupan las dos esquinas de arriba manda sobre lo que cuelga debajo
 *  (la tira del mundo, por ejemplo): así nada se solapa con el HUD. */
function medirTop () {
  const alto = Math.round(nodos.barra?.getBoundingClientRect().bottom || 58)
  raiz().style.setProperty('--alto-top', `${alto}px`)
}

/* ---------------------------------------------------------------- arriba --- */

/**
 * UNA sola barra arriba con todo lo que se mira de reojo: los cuatro recursos
 * a la izquierda y, a la derecha, gente, gemas, nivel y constructores. Nada de
 * dos filas ni de pastillas gordas (orden del dueño): una línea de 48 px.
 *
 * Lo que NO cabe con dignidad en 390 px se ha ido a su sitio natural:
 *   - el botón ＋ de contratar aldeanos → dentro de la hoja de aldeanos, que se
 *     abre tocando la pastilla de gente (ahí se ve además cuánto cuesta);
 *   - los ajustes ⚙️ → a la botonera de abajo, con el mundo y los encargos,
 *     que es donde el dueño pidió que vivieran.
 */
function montarArriba () {
  nodos.recursos = {}
  const barra = el('div', { clase: 'hud-barra' })

  for (const tipo of CONFIG.RECURSOS) {
    const cifra = el('b', { clase: 'num', texto: '0' })
    const tope = el('small', { texto: '/0' })
    const barraLlenado = barraProgreso(0, { clase: 'fina quieta' })
    const ritmo = el('div', { clase: 'res-ritmo ritmo ritmo-cero', texto: '0/h' })
    const pastilla = el('button', {
      clase: 'res', type: 'button', 'aria-label': `${NOMBRE_RECURSO[tipo]}: ver producción`,
      onclick: () => abrirEconomia(tipo)
    }, [
      el('div', { clase: 'res-cab' }, [el('i', { texto: ICONO[tipo] }), cifra, tope]),
      barraLlenado.nodo,
      ritmo
    ])
    nodos.recursos[tipo] = { pastilla, cifra, tope, barra: barraLlenado, ritmo }
    barra.appendChild(pastilla)
  }

  nodos.gemas = el('b', { texto: '0' })
  nodos.nivel = el('b', { texto: '1' })
  nodos.xp = el('span', { clase: 'pastilla-xp' })
  nodos.poblacion = el('b', { texto: '0/0' })
  // los parados van EN LÍNEA, no como globo encima: un globo taparía la cifra
  nodos.parados = el('em', { clase: 'parados', texto: '0', estilo: { display: 'none' } })

  nodos.constructores = el('button', {
    clase: 'pastilla pastilla-obras', type: 'button', 'aria-label': 'Constructores',
    onclick: abrirConstructores
  }, [el('i', { texto: '🔨' }), el('b', { texto: '0/1' }), el('small')])
  nodos.constructores._cifra = nodos.constructores.querySelector('b')
  nodos.constructores._nota = nodos.constructores.querySelector('small')

  barra.append(
    el('button', {
      clase: 'pastilla pastilla-gemas', type: 'button', 'aria-label': 'Gemas: acelerar obras',
      onclick: abrirConstructores
    }, [el('i', { texto: ICONO.gemas }), nodos.gemas]),
    el('span', { clase: 'pastilla pastilla-nivel', 'aria-label': 'Nivel' }, [nodos.xp, el('i', { texto: '⭐' }), nodos.nivel]),
    nodos.constructores
  )

  nodos.barra = barra
  raiz().appendChild(barra)
}

function contratarAldeano () {
  const nuevo = pedir('aldeanos', 'contratar', null)
  if (nuevo) {
    toast('Un aldeano más en la aldea', 'bien')
    events.emit(EV.SFX, { nombre: 'toque' })
  }
  pintarRecursos()
}

function pintarRecursos (instante = false) {
  const eco = economia()

  for (const tipo of CONFIG.RECURSOS) {
    const n = nodos.recursos[tipo]
    if (!n) continue
    const e = eco[tipo]

    fijarNumero(n.cifra, e.cantidad, { instante })
    const textoTope = `/${formatoNumero(e.tope)}`
    if (n.tope.textContent !== textoTope) n.tope.textContent = textoTope
    n.barra.fijar(e.pct)

    const texto = e.lleno ? '¡LLENO!' : porHora(e.ritmo)
    if (n.ritmo.textContent !== texto) n.ritmo.textContent = texto
    const tono = e.lleno ? 'ritmo-mal' : tonoRitmo(e.ritmo)
    if (n.ritmo.dataset.tono !== tono) {
      n.ritmo.className = `res-ritmo ritmo ${tono}`
      n.ritmo.dataset.tono = tono
    }
    n.pastilla.classList.toggle('lleno', e.lleno)
    n.pastilla.classList.toggle('casi', !e.lleno && e.pct >= 90)
    n.barra.nodo.classList.toggle('mal', e.pct >= 90)
    // el tope ya no se escribe en la barra (no cabe): va aquí, donde además lo
    // lee el lector de pantalla, y en el panel que se abre al tocar
    n.pastilla.setAttribute('aria-label',
      `${NOMBRE_RECURSO[tipo]}: ${formatoNumero(e.cantidad)} de ${formatoNumero(e.tope)}, ${porHora(e.ritmo)}. Ver producción`)
  }

  const s = game.state
  fijarNumero(nodos.gemas, Math.floor(s.jugador?.gemas || 0), { instante, formato: numeroLargo })

  const nv = pedir('ciencia', 'nivelJugador', null)
  const nivel = nv?.nivel ?? s.jugador?.nivel ?? 1
  if (nodos.nivel.textContent !== String(nivel)) {
    nodos.nivel.textContent = String(nivel)
    latir(nodos.nivel)
  }
  nodos.xp.style.width = `${Math.round((nv?.pct ?? 0) * 100)}%`

  // población: siempre a la vista, con los parados en rojo
  const g = gente()
  const txt = `${g.actual}/${g.maxima}`
  if (nodos.poblacion.textContent !== txt) nodos.poblacion.textContent = txt
  pintarParados(g.parados)
  nodos.botonGente.setAttribute('aria-label',
    `${g.actual} de ${g.maxima} aldeanos${g.parados ? `, ${g.parados} sin faena` : ''}. Ver producción y contratar`)
}

/** Los aldeanos sin faena: en rojo y con su siesta, para que se entiendan solos. */
function pintarParados (n) {
  const nodo = nodos.parados
  if (!nodo) return
  if (!n) { nodo.style.display = 'none'; return }
  // hasta 99 va entero: un globo de dos cifras tiene que caber sin montarse
  const texto = n > 99 ? '99+' : String(n)   // sin emoji: 💤 se pinta enorme y rompe la cápsula
  if (nodo.style.display === 'none') { nodo.style.display = ''; latir(nodo) }
  if (nodo.textContent !== texto) { nodo.textContent = texto; latir(nodo) }
}

/**
 * Un único mando para el mundo: el botón 🗺️ de la botonera de abajo. Lleva la
 * cámara al valle y abre su panel; el 🏰 de arriba a la derecha (que solo
 * aparece estando fuera) trae de vuelta. Antes había dos botones de mundo.
 */
function irAlMundo (ir = true, abrirPanel = true) {
  const vista = ir ? 'mundo' : 'aldea'
  if (vista !== vistaActual) {
    vistaActual = vista
    events.emit(EV.VISTA_CAMBIADA, { vista })
  }
  pintarVista()
  if (ir && abrirPanel) events.emit(EV.UI_PANEL, { panel: 'mundo' })
}

function pintarVista () {
  if (nodos.botonVolver) nodos.botonVolver.style.display = vistaActual === 'mundo' ? '' : 'none'
}

/** Los exploradores: cuántos hay fuera, cuánto falta y si alguno ya ha vuelto. */
function exploracion () {
  const s = game.state
  const ahora = Date.now()
  const camp = (s.buildings || []).find(b => b && b.tipo === 'campamento_explorador' && !b.enObra)
  const fuera = (s.expediciones || []).filter(Boolean)
  const vueltos = fuera.filter(e => e.vuelve <= ahora).length
  const proxima = fuera.filter(e => e.vuelve > ahora).sort((a, b) => a.vuelve - b.vuelve)[0]
  const def = camp ? defEdificio('campamento_explorador') : null
  return {
    hayCampamento: !!camp,
    plazas: def?.exploradores ? def.exploradores(camp.nivel || 1) : 0,
    fuera: fuera.length,
    vueltos,
    restante: proxima ? Math.max(0, (proxima.vuelve - ahora) / 1000) : 0
  }
}

/** El botón del caballo abre el mundo, que es donde se mandan expediciones. */
function abrirExplorador () {
  irAlMundo(true)
}

/* ===========================================================================
   Panel de producción: la economía entera, para revisarlo todo bien
   =========================================================================== */

let hojaEco = null

/** @param {string|null} recurso pestaña que se abre (null = la que más chirríe) */
function abrirEconomia (recurso = null) {
  if (hojaEco) {
    const mismo = hojaEco.recurso === recurso
    hojaEco.panel.cerrar()
    if (mismo) return
  }

  const eco = economia()
  let activo = recurso
  if (!activo) {
    // sin recurso pedido, se abre por donde duele: primero lo que se desperdicia
    activo = CONFIG.RECURSOS.find(r => eco[r].lleno) ||
             CONFIG.RECURSOS.find(r => eco[r].neto < 0) ||
             CONFIG.RECURSOS[0]
  }

  const detalle = el('div', { clase: 'col' })
  const tabs = pestañas(   // eco-tabs: las cuatro caben sin barrer de lado

    CONFIG.RECURSOS.map(r => ({ id: r, texto: NOMBRE_RECURSO[r], icono: ICONO[r] })),
    (id) => { activo = id; firma = null; pintar() }
  )

  // pie fijo: la gente, contratar y repartir, desde cualquier pestaña. El botón
  // de contratar vive AQUÍ desde que la barra de arriba es una sola línea: aquí
  // además se lee lo que cuesta el siguiente aldeano, que antes no se veía.
  const pieTexto = el('div', { clase: 'crece' })
  const botonContratar = el('button', {
    clase: 'btn btn-oro', type: 'button',
    onclick: () => { contratarAldeano(); firma = null; pintar() }
  })
  const pie = el('div', { clase: 'eco-pie' }, [
    pieTexto,
    botonContratar,
    el('button', {
      clase: 'btn btn-piedra', type: 'button', texto: '🧭 Repartir',
      onclick: () => { pedir('aldeanos', 'asignarAutomatico', 0); firma = null; pintar(); pintarRecursos() }
    })
  ])

  tabs.nodo.classList.add('eco-tabs')

  const panel = hoja({
    titulo: '📊 Producción de la aldea',
    contenido: el('div', { clase: 'col' }, [tabs.nodo, detalle]),
    pie,
    alCerrar: () => {
      refrescadores.delete(pintar)
      for (const t of CONFIG.RECURSOS) nodos.recursos[t]?.pastilla.classList.remove('abierto')
      hojaEco = null
    }
  })

  // Reconstruir cuatro veces por segundo se comería el scroll y los toques:
  // la lista solo se rehace cuando cambia de verdad; el resto son cifras.
  let firma = null
  const pintar = () => {
    const e = economia()
    const g = gente()
    const nueva = firmaEconomia(activo, e, g)
    if (nueva !== firma) {
      firma = nueva
      vaciar(detalle)
      const nuevo = cuerpoEconomia(activo, e, g, panel)
      detalle._tic = nuevo._tic
      detalle.appendChild(nuevo)
    } else {
      detalle._tic?.(e)
    }
    botonContratar.innerHTML = `＋ Aldeano <span class="pequeño">${ICONO.comida} ${formatoNumero(g.coste || 0)}</span>`
    botonContratar.disabled = !(g.maxima > 0 && g.actual < g.maxima) ||
      (game.state.recursos?.comida || 0) < (g.coste || 0)
    pieTexto.innerHTML = ''
    pieTexto.append(
      el('div', { texto: `${ICONO.aldeano} ${g.actual} de ${g.maxima} aldeanos` }),
      el('div', {
        clase: g.parados ? 'ritmo-mal' : 'tenue',
        estilo: { fontSize: '.88em' },
        texto: g.parados ? `${g.parados} de brazos cruzados` : 'Todos con faena'
      })
    )
  }

  tabs.activar(activo, false)
  pintar()
  refrescadores.add(pintar)
  hojaEco = { panel, recurso }
  for (const t of CONFIG.RECURSOS) nodos.recursos[t]?.pastilla.classList.toggle('abierto', t === activo)
  return panel
}

function firmaEconomia (r, eco, g) {
  const e = eco[r]
  return [r, e.lleno, Math.round(e.entra), Math.round(e.gasta), e.tope, g.actual, g.parados,
    e.edificios.map(x => `${x.id}:${x.nivel}:${x.dentro}`).join(',')].join('|')
}

function cuerpoEconomia (r, eco, g, panel) {
  const e = eco[r]
  const caja = el('div', { clase: 'col' })

  // --- cabecera: el ritmo, gordo y en color ---
  const cifra = el('div', { clase: `ritmo ${e.lleno ? 'ritmo-mal' : tonoRitmo(e.ritmo)}`, texto: e.lleno ? '0/h' : porHora(e.ritmo) })
  const almacenTxt = el('small')
  const barra = barraProgreso(e.pct, { gorda: true, clase: 'quieta' })
  caja.appendChild(el('div', { clase: 'panel', estilo: { padding: '12px' } }, [
    el('div', { clase: 'eco-cab' }, [
      el('i', { texto: ICONO[r] }),
      el('div', { clase: 'eco-cifras' }, [cifra, almacenTxt])
    ]),
    el('div', { estilo: { marginTop: '8px' } }, barra.nodo)
  ]))

  // --- aviso de almacén: llenar es perder producción ---
  const aviso = el('div', { clase: 'aviso' })
  caja.appendChild(aviso)

  // --- de dónde sale ---
  caja.appendChild(el('div', { clase: 'eco-seccion', texto: 'De dónde sale' }))
  const lista = el('div', { clase: 'eco-lista' })
  if (!e.edificios.length) {
    lista.appendChild(el('div', { clase: 'dato tenue' }, [
      el('i', { texto: '🚧' }),
      el('div', { clase: 'dato-txt' }, el('span', { texto: `Nada produce ${NOMBRE_RECURSO[r].toLowerCase()} todavía` }))
    ]))
  }
  for (const f of e.edificios) {
    const libres = Math.max(0, f.plazas - f.dentro)
    lista.appendChild(el('button', {
      clase: 'dato', type: 'button',
      onclick: () => { panel.cerrar(); events.emit(EV.CAMERA_FOCUS, { x: f.x, z: f.z }); events.emit(EV.UI_SELECT, { kind: 'building', id: f.id }) }
    }, [
      el('i', { texto: f.icono }),
      el('div', { clase: 'dato-txt' }, [
        el('span', { texto: `${f.nombre} · nivel ${f.nivel}` }),
        el('small', {
          clase: libres ? 'ritmo-mal' : '',
          texto: f.plazas
            ? `${ICONO.aldeano} ${f.dentro}/${f.plazas}${libres ? ` · ${libres} plaza${libres === 1 ? '' : 's'} libre${libres === 1 ? '' : 's'}` : ' · al completo'}`
            : 'no necesita gente'
        })
      ]),
      el('b', { clase: `ritmo ${tonoRitmo(f.porHora)}`, texto: porHora(f.porHora) })
    ]))
  }
  caja.appendChild(lista)

  // --- el gasto: lo que come la tropa frente a lo que dan las granjas ---
  if (r === 'comida') {
    caja.appendChild(el('div', { clase: 'eco-seccion', texto: 'Las bocas que alimentas' }))
    caja.appendChild(el('div', { clase: 'eco-lista' }, [
      el('div', { clase: 'dato' }, [
        el('i', { texto: ICONO.comida }),
        el('div', { clase: 'dato-txt' }, el('span', { texto: 'Producen las granjas' })),
        el('b', { clase: 'ritmo ritmo-bien', texto: porHora(e.entra) })
      ]),
      el('div', { clase: 'dato' }, [
        el('i', { texto: '⚔️' }),
        el('div', { clase: 'dato-txt' }, [
          el('span', { texto: 'Come la tropa' }),
          el('small', { texto: pedir('ejercito', 'hayHambre', false) ? 'pasan hambre: pegan un 20 % menos' : 'manutención del ejército' })
        ]),
        el('b', { clase: `ritmo ${e.gasta ? 'ritmo-mal' : 'ritmo-cero'}`, texto: porHora(-e.gasta) })
      ]),
      el('div', { clase: 'dato' }, [
        el('i', { texto: '⚖️' }),
        el('div', { clase: 'dato-txt' }, el('span', { texto: 'Saldo real' })),
        el('b', { clase: `ritmo ${tonoRitmo(e.neto)}`, texto: porHora(e.neto) })
      ])
    ]))
  }

  // --- la faena: cuánta gente hay puesta y cuántas plazas quedan ---
  caja.appendChild(el('div', { clase: 'stats' }, [
    el('div', { clase: 'stat' }, [el('small', { texto: 'Aldeanos puestos' }), el('b', { texto: `${ICONO.aldeano} ${e.aldeanos}` })]),
    el('div', { clase: 'stat' }, [
      el('small', { texto: 'Plazas libres' }),
      el('b', { clase: e.plazasLibres ? 'ritmo-mal' : '', texto: String(e.plazasLibres) })
    ])
  ]))

  caja.appendChild(el('div', {
    clase: 'tenue pequeño', estilo: { textAlign: 'center' },
    texto: `Sigue entrando con el juego cerrado, hasta ${CONFIG.MAX_OFFLINE_HORAS} horas.`
  }))

  // refresco barato: solo las cifras que cambian solas con el reloj
  caja._tic = (nueva) => {
    const x = (nueva || economia())[r]
    almacenTxt.textContent = x.lleno
      ? `${formatoNumero(x.cantidad)} de ${formatoNumero(x.tope)} · no cabe nada más`
      : `${formatoNumero(x.cantidad)} de ${formatoNumero(x.tope)} en el almacén`
    barra.fijar(x.pct)
    barra.nodo.classList.toggle('mal', x.pct >= 90)
    cifra.textContent = x.lleno ? '0/h' : porHora(x.ritmo)
    cifra.className = `ritmo ${x.lleno ? 'ritmo-mal' : tonoRitmo(x.ritmo)}`
    pintarAvisoAlmacen(aviso, x, r)
  }
  caja._tic(eco)
  return caja
}

function pintarAvisoAlmacen (nodo, e, r) {
  let clase = 'aviso aviso-info'
  let icono = '⏳'
  let texto = ''
  if (e.lleno) {
    clase = 'aviso aviso-mal'; icono = '🚨'
    texto = e.desperdicio > 0
      ? `Almacén LLENO: se están tirando ${porHora(e.desperdicio).replace('+', '')}. Gástalo o amplía el almacén.`
      : 'Almacén lleno. Gasta o amplía el almacén.'
  } else if (e.neto < 0) {
    clase = 'aviso aviso-mal'; icono = '📉'
    texto = `Se gasta más de lo que entra: en ${formatoTiempo(e.cantidad / (-e.neto) * 3600)} te quedas a cero.`
  } else if (e.llenaEn != null) {
    clase = e.llenaEn < 1800 ? 'aviso aviso-info' : 'aviso aviso-bien'
    icono = e.llenaEn < 1800 ? '⏳' : '✅'
    texto = `Se llena en ${formatoTiempo(e.llenaEn)}.`
  } else {
    clase = 'aviso aviso-info'; icono = '💤'
    texto = 'No entra nada: pon aldeanos o levanta un edificio de producción.'
  }
  if (nodo.dataset.texto === texto) return
  nodo.dataset.texto = texto
  nodo.className = clase
  vaciar(nodo)
  nodo.append(el('i', { texto: icono }), el('span', { texto }))
}

/* ----------------------------------------------------------------- obras --- */

/**
 * Los constructores del Ayuntamiento: cuántos hay, en qué anda cada uno y
 * cuántos están de brazos cruzados. Una obra ocupa a un constructor; las
 * plazas las da `plazasDeObra()`.
 */
function constructores () {
  const plazas = Math.max(1, Number(pedir('edificios', 'plazasDeObra', 1)) || 1)
  const ahora = Date.now()
  const obras = []

  for (const o of game.state.obras || []) {
    const b = (game.state.buildings || []).find(x => x.id === o.buildingId)
    const d = b ? defEdificio(b.tipo) : null
    const total = Math.max(1, (o.fin - (o.inicio || o.fin)) / 1000)
    const restante = Math.max(0, (o.fin - ahora) / 1000)
    obras.push({
      clave: `obra-${o.id}`,
      buildingId: o.buildingId,
      icono: d?.icono || '🔨',
      nombre: `${d?.nombre || 'Obra'}${o.tipo === 'mejorar' ? ` → ${(b?.nivel || 0) + 1}` : ''}`,
      restante,
      pct: Math.min(100, (1 - restante / total) * 100),
      gemas: pedir('edificios', 'costeAcelerar', 0, o.buildingId),
      acelerar: () => pedir('edificios', 'acelerar', false, o.buildingId),
      alTocar: () => events.emit(EV.UI_SELECT, { kind: 'building', id: o.buildingId })
    })
  }
  obras.sort((a, b) => a.restante - b.restante)

  const ocupados = Math.min(plazas, obras.length)
  return {
    plazas,
    obras,
    ocupados,
    libres: Math.max(0, plazas - ocupados),
    espera: pedir('edificios', 'obrasEnEspera', [])
  }
}

/** Botón redondo del borde derecho. Devuelve el nodo con sus piezas. */
function pastillaMini (icono, alTocar, etiqueta) {
  const cifra = el('b', { texto: '' })
  const nota = el('small', { texto: '' })
  const globo = el('span', { clase: 'badge', texto: '0', estilo: { display: 'none' } })
  const nodo = el('button', {
    clase: 'mini', type: 'button', 'aria-label': etiqueta, onclick: alTocar
  }, [el('i', { texto: icono }), cifra, nota, globo])
  nodo._cifra = cifra
  nodo._nota = nota
  nodo._globo = globo
  return nodo
}

/**
 * Las pastillas de "qué está en marcha" viven en la MISMA esquina de arriba a
 * la derecha, debajo de gemas y nivel: constructores, ajustes y, en redondo,
 * el explorador, la tropa y la ciencia. Ninguna flota ya sobre la aldea.
 */
function montarObras () {
  // Los aldeanos: botón del borde derecho, debajo de la barra. No caben en la
  // línea de arriba con las cifras largas (128K de piedra + 99.999 gemas se la
  // comen entera), y aquí se ven siempre, con los parados en su globo rojo.
  nodos.botonGente = el('button', {
    clase: 'mini mini-ancho', type: 'button', 'aria-label': 'Aldeanos y producción',
    onclick: () => abrirEconomia(null)
  }, [el('i', { texto: ICONO.aldeano }), nodos.poblacion, nodos.parados])
  nodos.botonGente._globo = nodos.parados

  // ⚠️ EL BOTÓN DE LAS FUGAS. Solo aparece cuando de verdad se está perdiendo
  // algo (almacén rebosando, puestos vacíos, sin camas, sin torres) y dice
  // cuántas cosas hay. Antes todo esto estaba escondido y el jugador perdía
  // producción durante días sin enterarse.
  nodos.miniAvisos = pastillaMini('⚠️', abrirProblemas, 'Qué te está costando partida')
  nodos.miniAvisos.classList.add('mini-aviso')
  nodos.miniAvisos.style.display = 'none'

  nodos.miniExplorador = pastillaMini('🐎', abrirExplorador, 'Exploradores')
  nodos.miniTropa = pastillaMini('⚔️', () => events.emit(EV.UI_PANEL, { panel: 'ejercito' }), 'Tropa en entrenamiento')
  nodos.miniCiencia = pastillaMini('📜', () => events.emit(EV.UI_PANEL, { panel: 'investigar' }), 'Investigación en curso')
  nodos.miniExplorador.style.display = 'none'
  nodos.miniTropa.style.display = 'none'
  nodos.miniCiencia.style.display = 'none'

  // el botón de volver a la aldea solo existe mientras se mira el mundo: en la
  // aldea sobraba y era el «segundo botón de mundo» del que se quejó el dueño
  nodos.botonVolver = el('button', {
    clase: 'btn btn-oro hud-redondo', type: 'button', 'aria-label': 'Volver a la aldea',
    texto: '🏰', estilo: { display: 'none' }, onclick: () => irAlMundo(false)
  })

  nodos.minis = el('div', { clase: 'hud-minis' }, [
    nodos.botonGente, nodos.miniAvisos, nodos.botonVolver, nodos.miniExplorador, nodos.miniTropa, nodos.miniCiencia
  ])
  raiz().appendChild(nodos.minis)
}

/** Lo que entrena el cuartel ahora mismo, o null. */
function tropaEnCola () {
  const cola = game.state.ejercito?.cola || []
  if (!cola.length) return null
  const ahora = Date.now()
  const ultimo = cola[cola.length - 1]
  return { cuantos: cola.length, restante: Math.max(0, (ultimo.fin - ahora) / 1000) }
}

/** La investigación en curso, o null. Panel: 'investigar' (así lo llama build-panel). */
function cienciaEnCurso () {
  const inv = pedir('ciencia', 'progresoInvestigacion', null)
  if (!inv) return null
  return { nombre: inv.nombre, restante: inv.restante || 0 }
}

function tarjetaObra (t) {
  const barra = barraProgreso(t.pct)
  const tiempo = el('em', { texto: formatoTiempo(t.restante) })
  const caja = el('div', { clase: 'obra', datos: { clave: t.clave } }, [
    el('div', { clase: 'obra-cab', onclick: t.alTocar }, [
      el('i', { texto: t.icono, estilo: { fontStyle: 'normal' } }),
      el('span', { texto: t.nombre }),
      tiempo
    ]),
    el('div', { clase: 'obra-pie' }, [
      // Lo que espera turno no se acelera con gemas: todavía no ha empezado.
      // En su sitio va el motivo, que es lo que el jugador necesita saber.
      t.acelerar ? barra.nodo : el('span', { clase: 'tenue', texto: t.nota || 'Esperando turno' }),
      t.acelerar
        ? el('button', {
          clase: 'btn btn-oro btn-gema', type: 'button', 'aria-label': 'Acelerar con gemas',
          html: `${ICONO.gemas}<br>${t.gemas}`,
          onclick: () => { t.acelerar(); pintarObras(); pintarRecursos() }
        })
        : el('button', { clase: 'btn btn-piedra', type: 'button', texto: 'Ver', onclick: t.alTocar })
    ])
  ])
  caja._fijar = barra.fijar
  caja._tiempo = tiempo
  return caja
}

/** Refresca una tarjeta ya pintada. Nada de reconstruir: el dedo del jugador
 *  puede estar justo encima del botón y un DOM que se rehace se come el toque. */
function actualizarTarjeta (nodo, t) {
  nodo._fijar?.(t.pct)
  const txt = formatoTiempo(t.restante)
  if (nodo._tiempo && nodo._tiempo.textContent !== txt) nodo._tiempo.textContent = txt
  const boton = nodo.querySelector('.btn-gema')
  if (boton) {
    const html = `${ICONO.gemas}<br>${t.gemas}`
    if (boton.innerHTML !== html) boton.innerHTML = html
  } else {
    const nota = nodo.querySelector('.obra-pie .tenue')
    if (nota && t.nota && nota.textContent !== t.nota) nota.textContent = t.nota
  }
}

/** Deja el contenedor con estas tareas, reconstruyendo solo si la lista cambió. */
function sincronizarTareas (cont, tareas, extra = null) {
  const previas = new Map([...cont.children].filter(n => n.dataset.clave).map(n => [n.dataset.clave, n]))
  const mismas = tareas.length === previas.size && tareas.every(t => previas.has(t.clave))
  if (mismas) {
    for (const t of tareas) actualizarTarjeta(previas.get(t.clave), t)
    return
  }
  vaciar(cont)
  for (const t of tareas) cont.appendChild(tarjetaObra(t))
  if (extra) cont.appendChild(extra())
}

/** Refresca una pastilla mini sin reconstruirla (el dedo puede estar encima). */
function fijarMini (nodo, visible, cifra, nota, etiqueta, globo = 0) {
  if (!nodo) return
  nodo.style.display = visible ? '' : 'none'
  if (!visible) return
  if (nodo._cifra.textContent !== cifra) nodo._cifra.textContent = cifra
  if (nodo._nota.textContent !== nota) nodo._nota.textContent = nota
  if (etiqueta) nodo.setAttribute('aria-label', etiqueta)
  // sin cifra, el icono manda y se pinta más grande: el botón no queda cojo
  nodo.classList.toggle('sin-cuenta', !cifra)
  fijarBadgeNodo(nodo._globo, globo)
}

function pintarObras () {
  if (!nodos.constructores) return

  const c = constructores()
  const proxima = c.obras[0]
  const enCola = c.espera.length ? ` · ${c.espera.length} en cola` : ''
  // la cifra es siempre «ocupados/plazas»: es lo que pidió el dueño (🔨 2/3) y
  // así el ancho no cambia cuando un constructor se queda libre
  fijarMini(
    nodos.constructores, true,
    `${c.ocupados}/${c.plazas}`,
    proxima ? formatoTiempo(proxima.restante) : '',
    `Constructores: ${c.ocupados} de ${c.plazas} trabajando${enCola}. Ver en qué anda cada uno`,
    c.espera.length
  )
  nodos.constructores.classList.toggle('libre', c.libres > 0)

  const ex = exploracion()
  fijarMini(
    nodos.miniExplorador, ex.hayCampamento,
    ex.fuera && ex.restante > 0 ? formatoTiempo(ex.restante) : '',
    '',
    ex.vueltos
      ? `${ex.vueltos} explorador${ex.vueltos === 1 ? '' : 'es'} de vuelta. Ver el mundo`
      : (ex.fuera ? `${ex.fuera} explorando. Ver el mundo` : 'Mandar un explorador'),
    ex.vueltos
  )

  const t = tropaEnCola()
  fijarMini(nodos.miniTropa, !!t, t ? formatoTiempo(t.restante) : '', '',
    t ? `${t.cuantos} en el patio de armas. Ver el ejército` : '', t ? t.cuantos : 0)

  const ci = cienciaEnCurso()
  fijarMini(nodos.miniCiencia, !!ci, ci ? formatoTiempo(ci.restante) : '', '',
    ci ? `Investigando ${ci.nombre}. Ver la universidad` : '')
}

/**
 * Una fila de la cola de espera: su puesto, lo que dura, cuándo se calcula que
 * entrará y los dos botones que hacen falta — subirla del todo o retirarla.
 */
function filaEspera (e, repintar) {
  const cuando = e.aviso
    ? `⚠️ ${e.aviso}`
    : e.segundosParaEmpezar > 0 ? `Empieza en ${formatoTiempo(e.segundosParaEmpezar)}` : 'Entra ya'
  const nota = el('span', { clase: 'tenue', texto: cuando })
  const caja = el('div', { clase: 'obra', datos: { clave: 'esp-' + e.id } }, [
    el('div', {
      clase: 'obra-cab',
      onclick: () => events.emit(EV.UI_SELECT, { kind: 'building', id: e.buildingId })
    }, [
      el('i', { texto: e.icono, estilo: { fontStyle: 'normal' } }),
      el('span', { texto: `${e.posicion}. ${e.nombre}${e.tipo === 'mejorar' ? ` → ${e.nivel}` : ''}` }),
      el('em', { texto: formatoTiempo(e.duracion) })
    ]),
    el('div', { clase: 'obra-pie' }, [
      nota,
      el('button', {
        clase: 'btn btn-piedra', type: 'button', texto: '⬆', 'aria-label': 'Ponerla la primera',
        onclick: () => { pedir('edificios', 'moverEnCola', false, e.id, 0); repintar() }
      }),
      el('button', {
        clase: 'btn btn-piedra', type: 'button', texto: '✕', 'aria-label': 'Retirar el encargo',
        onclick: () => { pedir('edificios', 'cancelarEspera', false, e.id); repintar() }
      })
    ])
  ])
  caja._nota = nota
  return caja
}

/** Deja el contenedor con estas filas; solo reconstruye si cambió la lista. */
function sincronizarEspera (cont, lista, repintar) {
  const previas = new Map([...cont.children].filter(n => n.dataset.clave).map(n => [n.dataset.clave, n]))
  const mismas = lista.length === previas.size && lista.every(e => previas.has('esp-' + e.id))
  if (mismas) {
    for (const e of lista) {
      const nodo = previas.get('esp-' + e.id)
      const txt = e.aviso
        ? `⚠️ ${e.aviso}`
        : e.segundosParaEmpezar > 0 ? `Empieza en ${formatoTiempo(e.segundosParaEmpezar)}` : 'Entra ya'
      if (nodo._nota && nodo._nota.textContent !== txt) nodo._nota.textContent = txt
    }
    return
  }
  vaciar(cont)
  for (const e of lista) cont.appendChild(filaEspera(e, repintar))
}

/**
 * La hoja de constructores: en qué anda cada uno, cuánto le queda, el botón de
 * acelerar con gemas, los que están libres esperando encargo y la cola.
 * Es el sitio único donde se mira la duración de las obras: antes estaba
 * repartida en una tarjeta por edificio y se comía la aldea.
 */
let hojaConstructores = null

function abrirConstructores () {
  if (hojaConstructores) { hojaConstructores.cerrar(); return hojaConstructores }

  const resumen = el('div', { clase: 'aviso' })
  const enMarcha = el('div', { clase: 'col' })
  const libres = el('div', { clase: 'col' })
  const titEspera = el('div', { clase: 'titular', texto: '⏳ Esperando turno' })
  const enEspera = el('div', { clase: 'col' })
  const cuerpo = el('div', { clase: 'col' }, [resumen, enMarcha, libres, titEspera, enEspera])

  const panel = hoja({
    titulo: '🔨 Tus constructores',
    contenido: cuerpo,
    alCerrar: () => { refrescadores.delete(pintar); hojaConstructores = null }
  })

  const pintar = () => {
    const c = constructores()

    const clase = c.libres > 0 ? 'aviso aviso-bien' : 'aviso aviso-info'
    const texto = c.libres > 0
      ? (c.plazas === 1
          ? 'Tu constructor está sin faena. Dale una obra.'
          : `${c.libres} de ${c.plazas} constructores sin faena. Dales una obra.`)
      : (c.plazas === 1
          ? 'Tu único constructor está ocupado. Amplía el Ayuntamiento para tener más.'
          : `Los ${c.plazas} constructores están ocupados. Amplía el Ayuntamiento para tener más.`)
    if (resumen.dataset.texto !== texto) {
      resumen.dataset.texto = texto
      resumen.className = clase
      vaciar(resumen)
      resumen.append(el('i', { texto: c.libres > 0 ? '🙋' : '🔨' }), el('span', { texto }))
    }

    sincronizarTareas(enMarcha, c.obras)

    // los libres: uno por fila, con su botón para mandarles algo
    const quiero = c.libres
    if (libres.children.length !== quiero) {
      vaciar(libres)
      for (let i = 0; i < quiero; i++) {
        libres.appendChild(el('div', { clase: 'constructor-libre' }, [
          el('i', { texto: '🙋' }),
          el('div', { clase: 'crece' }, [
            el('b', { texto: 'Constructor libre' }),
            el('div', { clase: 'tenue pequeño', texto: 'Esperando encargo' })
          ]),
          el('button', {
            clase: 'btn btn-oro', type: 'button', texto: '🔨 Construir',
            onclick: () => { panel.cerrar(); events.emit(EV.UI_PANEL, { panel: 'construir' }) }
          })
        ]))
      }
    }

    titEspera.style.display = c.espera.length ? '' : 'none'
    sincronizarEspera(enEspera, c.espera, pintar)
  }

  pintar()
  refrescadores.add(pintar)
  hojaConstructores = panel
  return panel
}

/* ----------------------------------------------------------------- abajo --- */

const BOTONES = [
  { panel: 'construir', icono: '🔨', texto: 'Construir' },
  { panel: 'ejercito', icono: '⚔️', texto: 'Ejército' },
  { panel: 'mundo', icono: '🗺️', texto: 'Mundo' },
  { panel: 'encargos', icono: '📜', texto: 'Encargos' },
  // los ajustes bajan aquí: el dueño los quiso junto al mundo y el mapa, y
  // arriba no caben si todo tiene que ir en una sola línea
  { panel: 'ajustes', icono: '⚙️', texto: 'Ajustes' }
]

function montarAbajo () {
  nodos.consejo = el('span', { texto: '' })
  nodos.consejoIcono = el('i', { texto: '🎩' })
  nodos.consejoIr = el('button', { clase: 'btn btn-oro consejo-ir', type: 'button', texto: 'Ver' })
  nodos.consejoCaja = el('div', { clase: 'hud-consejo' }, [nodos.consejoIcono, nodos.consejo, nodos.consejoIr])

  nodos.badges = {}
  const botonera = el('div', { clase: 'hud-botonera' })
  for (const b of BOTONES) {
    const globo = el('span', { clase: 'badge', texto: '0', estilo: { display: 'none' } })
    nodos.badges[b.panel] = globo
    botonera.appendChild(el('button', {
      clase: 'hud-boton', type: 'button', 'aria-label': b.texto,
      // «Mundo» es el ÚNICO botón de mundo que queda: lleva la cámara al valle
      // y abre su panel de una vez (antes había otro redondo arriba)
      onclick: () => {
        if (b.panel === 'mundo') irAlMundo(true)
        else if (b.panel === 'ajustes') abrirAjustes()
        else events.emit(EV.UI_PANEL, { panel: b.panel })
      }
    }, [
      el('i', { texto: b.icono }),
      el('small', { texto: b.texto }),
      globo
    ]))
  }

  // La tira del mayordomo ya NO se monta: se comía una franja entera encima del
  // menú y el dueño la quitó. El consejo sigue vivo (se actualiza y se usa en
  // el panel de Encargos, que lo enseña arriba con su botón), pero no ocupa
  // sitio en la pantalla de juego.
  nodos.abajo = el('div', { clase: 'hud-abajo' }, [botonera])
  raiz().appendChild(nodos.abajo)
}

/**
 * Qué toca hacer ahora. El texto lo pone el mayordomo (sim/quests.js) y la
 * ACCIÓN se deduce del estado, no de la frase: así el botón nunca miente.
 */
function consejoAhora () {
  const s = game.state
  const ahora = Date.now()
  const texto = pedir('encargos', 'siguienteConsejo', null) || consejoDeReserva()

  const activas = pedir('encargos', 'activas', null)
  const cobrable = Array.isArray(activas)
    ? activas.find(q => q && (q.listo || q.completada) && !q.cobrada)
    : (s.quests?.activas || []).find(q => q && (q.listo || q.completada) && !q.cobrada)
  if (cobrable) {
    return { texto, icono: '🎁', urgente: true, boton: 'Cobrar', accion: () => events.emit(EV.UI_PANEL, { panel: 'encargos' }) }
  }

  if ((s.expediciones || []).some(e => e && e.vuelve <= ahora)) {
    return { texto, icono: '🐎', urgente: true, boton: 'Recibir', accion: () => events.emit(EV.UI_PANEL, { panel: 'mundo' }) }
  }

  const eco = economia()
  const lleno = CONFIG.RECURSOS.find(r => eco[r].lleno)
  if (lleno) {
    return { texto, icono: '🚨', urgente: true, boton: 'Revisar', accion: () => abrirEconomia(lleno) }
  }

  const g = gente()
  if (g.parados > 0) {
    return {
      texto,
      icono: ICONO.aldeano,
      urgente: false,
      boton: 'Repartir',
      accion: () => { pedir('aldeanos', 'asignarAutomatico', 0); pintarRecursos(); pintarConsejo() }
    }
  }

  const hambre = CONFIG.RECURSOS.find(r => eco[r].neto < 0)
  if (hambre) return { texto, icono: '📉', urgente: true, boton: 'Revisar', accion: () => abrirEconomia(hambre) }

  // Sin obras Y sin cola: ahí sí no hay nada en marcha. Con encargos esperando,
  // el mayordomo no manda construir más: manda mirar por qué no arrancan.
  if (!(s.obras || []).length) {
    const espera = pedir('edificios', 'obrasEnEspera', [])
    if (espera.length) {
      return { texto, icono: '⏳', urgente: !!espera.find(e => e.aviso), boton: 'Ver cola', accion: abrirConstructores }
    }
    return { texto, icono: '🔨', urgente: false, boton: 'Construir', accion: () => events.emit(EV.UI_PANEL, { panel: 'construir' }) }
  }

  const cuarteles = (s.buildings || []).some(b => !b.enObra && ['cuartel', 'arqueria', 'establo', 'taller_asedio'].includes(b.tipo))
  if (cuarteles && !(s.ejercito?.cola || []).length) {
    return { texto, icono: '⚔️', urgente: false, boton: 'Entrenar', accion: () => events.emit(EV.UI_PANEL, { panel: 'ejercito' }) }
  }

  return { texto, icono: '🎩', urgente: false, boton: 'Encargos', accion: () => events.emit(EV.UI_PANEL, { panel: 'encargos' }) }
}

function pintarConsejo () {
  const c = consejoAhora()
  if (nodos.consejo.textContent !== c.texto) nodos.consejo.textContent = c.texto
  if (nodos.consejoIcono.textContent !== c.icono) nodos.consejoIcono.textContent = c.icono
  if (nodos.consejoIr.textContent !== c.boton) nodos.consejoIr.textContent = c.boton
  nodos.consejoIr.onclick = c.accion
  nodos.consejoCaja.classList.toggle('urgente', !!c.urgente)
  nodos.consejoIr.classList.toggle('btn-peligro', !!c.urgente)
  nodos.consejoIr.classList.toggle('btn-oro', !c.urgente)
}

/** Si sim/quests.js no está, el mayordomo no se queda mudo. */
function consejoDeReserva () {
  const s = game.state
  if (!(s.buildings || []).length) return 'Toca 🔨 Construir y levanta tu Ayuntamiento.'
  const lleno = CONFIG.RECURSOS.find(r => (s.almacen?.[r] || 0) > 0 && (s.recursos?.[r] || 0) >= s.almacen[r])
  if (lleno) return `El ${lleno} se está desperdiciando: gástalo o amplía el almacén.`
  if (!(s.obras || []).length) return 'No hay ninguna obra en marcha. Toca 🔨 Construir.'
  return 'La aldea va sola. Buen momento para explorar el 🗺️ mundo.'
}

function pintarBadges () {
  const s = game.state

  // Construir: mejoras que puedes pagar YA. Es lo que hay que atender.
  let mejorables = 0
  if (M.edificios?.puedeMejorar) {
    for (const b of s.buildings || []) {
      if (b.enObra || b.mejorando) continue
      if (pedir('edificios', 'puedeMejorar', { ok: false }, b.id)?.ok) mejorables++
      if (mejorables >= 9) break
    }
  }
  fijarBadge('construir', mejorables)

  // Ejército: la cola vacía teniendo dónde entrenar es tiempo tirado.
  const cuarteles = (s.buildings || []).some(b => !b.enObra && ['cuartel', 'arqueria', 'establo', 'taller_asedio'].includes(b.tipo))
  fijarBadge('ejercito', cuarteles && !(s.ejercito?.cola || []).length ? 1 : 0)

  // Mundo: expediciones que ya han vuelto.
  const ahora = Date.now()
  fijarBadge('mundo', (s.expediciones || []).filter(e => e && e.vuelve <= ahora).length)

  // Encargos: recompensas por reclamar.
  const activas = pedir('encargos', 'activas', null)
  const porCobrar = Array.isArray(activas)
    ? activas.filter(q => q && (q.listo || q.completada) && !q.cobrada).length
    : ((s.quests?.activas || []).filter(q => q && (q.listo || q.completada) && !q.cobrada).length)
  fijarBadge('encargos', porCobrar)
}

/** El botón ⚠️ del borde: sale solo si hay fugas, y dice cuántas. */
function pintarAvisos () {
  const nodo = nodos.miniAvisos
  if (!nodo) return
  const lista = problemas()
  if (!lista.length) { nodo.style.display = 'none'; return }
  if (nodo.style.display === 'none') { nodo.style.display = ''; latir(nodo) }
  const texto = String(lista.length)
  if (nodo._cifra.textContent !== texto) { nodo._cifra.textContent = texto; latir(nodo) }
  nodo.setAttribute('aria-label', `${lista.length} ${lista.length === 1 ? 'cosa te está costando' : 'cosas te están costando'} partida. La peor: ${lista[0].titulo}`)
}

const fijarBadge = (panel, n) => fijarBadgeNodo(nodos.badges?.[panel], n)

function fijarBadgeNodo (globo, n) {
  if (!globo) return
  if (!n) { globo.style.display = 'none'; return }
  const texto = n > 99 ? '99+' : String(n)
  if (globo.style.display === 'none') { globo.style.display = ''; latir(globo) }
  if (globo.textContent !== texto) { globo.textContent = texto; latir(globo) }
}

/* ===========================================================================
   Ficha del edificio seleccionado
   Todo lo importante sin hacer scroll: nivel, lo que produce, los aldeanos con
   sus + y −, y los tres botones (Mejorar, Mover, Demoler).
   =========================================================================== */

let fichaAbierta = null

function abrirFicha (id) {
  const b = (game.state.buildings || []).find(x => x.id === id)
  if (!b) return
  if (fichaAbierta?.id === id) return
  fichaAbierta?.panel.cerrar()

  const d = defEdificio(b.tipo)
  const cuerpo = el('div', { clase: 'col' })
  const panel = hoja({
    titulo: d?.nombre || 'Edificio',
    contenido: cuerpo,
    alCerrar: () => {
      refrescadores.delete(pintar)
      // si entre medias se abrió la ficha de OTRO edificio, esta ya no manda:
      // avisar de "nada seleccionado" cerraría la hoja recién abierta
      if (fichaAbierta?.id !== id) return
      fichaAbierta = null
      events.emit(EV.UI_SELECT, { kind: null, id: null })
    }
  })

  // Rehacer la ficha 4 veces por segundo se comería los toques y el scroll:
  // solo se reconstruye cuando cambia algo de verdad; entre medias, el reloj.
  let firma = null
  const pintar = () => {
    const vivo = (game.state.buildings || []).find(x => x.id === id)
    if (!vivo) { panel.cerrar(); return }
    const nueva = firmaDe(vivo)
    if (nueva === firma) { cuerpo._tic?.(); return }
    firma = nueva
    vaciar(cuerpo)
    const caja = contenidoFicha(vivo, panel)
    cuerpo._tic = caja._tic
    cuerpo.appendChild(caja)
  }
  pintar()
  refrescadores.add(pintar)
  fichaAbierta = { id, panel }
  // NO se mueve la cámara al abrir la ficha: el jugador acaba de tocar ese
  // edificio, o sea que ya lo está mirando. Moverla daba la sensación de
  // "entrar" en el edificio y rompía la fluidez (queja del dueño). Solo se
  // enfoca cuando la ficha se abre desde una lista, y eso lo hace quien la abre.
}

/** Lo que obliga a repintar la ficha entera. El tiempo no está: ese va aparte. */
function firmaDe (b) {
  const puede = pedir('edificios', 'puedeMejorar', { ok: false, motivo: '' }, b.id)
  const d = defEdificio(b.tipo)
  const s = game.state
  // de lo que se gestiona aquí dentro solo entra lo que CAMBIA la ficha: si una
  // tropa se puede pagar o no (un booleano, no el montón, que baila cada tick),
  // cuántos hay en la cola y cuántos heridos. Así no se rehace sin parar.
  const gestion = []
  for (const tipo of d?.entrena || []) {
    gestion.push(pedir('ejercito', 'puedeEntrenar', { ok: false }, tipo, 1).ok ? 1 : 0)
  }
  if (b.tipo === 'universidad') {
    gestion.push(s.investigacion?.id || '-', (pedir('ciencia', 'disponibles', []) || []).filter(t => t.asequible).length)
  }
  if (b.tipo === 'monasterio') gestion.push(pedir('ejercito', 'tiempoRecuperacion', { heridos: 0 }).heridos)
  if (b.tipo === 'campamento_explorador') gestion.push((s.expediciones || []).length)
  // qué recursos están al tope: es lo que enciende y apaga el aviso de «estás
  // tirando madera» de la ficha del almacén y del granero
  const topes = CONFIG.RECURSOS.map(r => ((s.almacen?.[r] || 0) > 0 && (s.recursos?.[r] || 0) >= s.almacen[r]) ? 1 : 0).join('')
  return [
    b.nivel, !!b.enObra, !!b.mejorando, !!b.arruinado, Math.round(b.hp || 0), topes,
    (b.trabajadores || []).length, (game.state.villagers || []).filter(v => !v.buildingId).length,
    puede.ok, puede.motivo, (s.ejercito?.cola || []).length, gestion.join(',')
  ].join('|')
}

function contenidoFicha (b, panel) {
  const d = defEdificio(b.tipo)
  const nivel = Math.max(1, b.nivel || 1)
  const caja = el('div', { clase: 'col' })
  const enObra = !!(b.enObra || b.mejorando)

  // el nombre ya está en la cabecera de la hoja: aquí manda el nivel
  caja.appendChild(el('div', { clase: 'ficha-cab' }, [
    el('span', { clase: 'icono-gr', texto: d?.icono || '🏚️' }),
    el('div', { clase: 'col', estilo: { gap: '2px' } }, [
      el('div', { clase: 'titular', texto: b.nivel === 0 ? 'En construcción' : `Nivel ${nivel}${d?.maxNivel ? ` de ${d.maxNivel}` : ''}` }),
      // PARA QUÉ SIRVE, en cristiano y en tinta normal. La frase de sabor pasa a
      // segundo plano: es simpática, pero no contesta «¿y esto qué hace?».
      el('div', { clase: 'ficha-paraque', texto: paraQueSirve(b.tipo) })
    ])
  ]))
  if (d?.desc) caja.appendChild(el('div', { clase: 'tenue pequeño ficha-sabor', texto: d.desc }))

  // --- obra en curso: cuenta atrás y acelerar ---
  if (enObra) {
    const total = Math.max(1, (d?.tiempo?.(b.nivel === 0 ? 1 : nivel + 1) || 1))
    const reloj = el('b', { clase: 'num' })
    const barra = barraProgreso(0)
    const acelera = el('button', {
      clase: 'btn btn-oro btn-gordo', type: 'button', estilo: { marginTop: '10px' },
      onclick: () => { pedir('edificios', 'acelerar', false, b.id); pintarRecursos(); pintarObras() }
    })
    caja._tic = () => {
      const restante = pedir('edificios', 'segundosRestantes', 0, b.id)
      reloj.textContent = formatoTiempo(restante)
      barra.fijar(Math.min(100, (1 - restante / total) * 100))
      acelera.textContent = `${ICONO.gemas} Terminar ya · ${pedir('edificios', 'costeAcelerar', 0, b.id)}`
    }
    caja._tic()
    caja.appendChild(el('div', { clase: 'panel', estilo: { padding: '10px' } }, [
      el('div', { clase: 'fila fila-sep' }, [
        el('b', { texto: b.nivel === 0 ? 'Construyendo…' : `Mejorando a nivel ${nivel + 1}` }),
        reloj
      ]),
      barra.nodo,
      acelera
    ]))
  }

  // --- los datos, en baldosas: caben cuatro donde antes cabían dos filas ---
  const plazas = typeof d?.plazas === 'function' ? d.plazas(nivel) : 0
  const prod = !enObra ? produccionDe(b.id) : null
  const baldosas = []

  if (d?.produce && typeof d.porMinuto === 'function') {
    baldosas.push(el('div', { clase: 'stat' }, [
      // «ahora»: es lo que entra de verdad con la gente que hay dentro, no lo
      // que pone el catálogo (eso se explica abajo, en «Qué hace»)
      el('small', { texto: `Ahora produce ${ICONO[d.produce] || ''}` }),
      el('b', {
        clase: `ritmo ${tonoRitmo(prod ? prod.porHora : 0)}`,
        texto: enObra ? '—' : porHora(prod ? prod.porHora : d.porMinuto(nivel) * 60)
      })
    ]))
  }
  if (plazas > 0) {
    const dentroAhora = (b.trabajadores || []).length
    baldosas.push(el('div', { clase: 'stat' }, [
      el('small', { texto: 'Puestos' }),
      el('b', { clase: dentroAhora < plazas ? 'ritmo-mal' : '', texto: `${dentroAhora} de ${plazas}` })
    ]))
  }
  // Población, camas, daño, batidores y lo que guarda ya NO van en baldosas: son
  // números del catálogo y ahora se explican enteros, con sus unidades y su
  // porqué, en «Qué hace». Aquí arriba solo se queda lo que cambia solo: lo que
  // produce de verdad, quién está trabajando dentro y cómo anda de salud.
  if (b.hpMax) {
    const roto = b.hp < b.hpMax
    baldosas.push(el('div', { clase: 'stat' }, [
      el('small', { texto: 'Resistencia' }),
      el('b', { clase: roto ? 'ritmo-mal' : '', texto: `${formatoNumero(Math.round(b.hp || 0))} / ${formatoNumero(b.hpMax)}` })
    ]))
  }
  if (baldosas.length) caja.appendChild(el('div', { clase: 'stats' }, baldosas))

  // --- QUÉ HACE, con el número de ESTE edificio a ESTE nivel ---
  if (!enObra) caja.appendChild(bloqueQueHace(b.tipo, nivel))

  // --- POR QUÉ TE CONVIENE: lo que le está pasando ahora mismo ---
  if (!enObra) for (const av of avisosDeEdificio(b, d, nivel)) caja.appendChild(av)

  // --- aldeanos asignados: los + y − son lo que más se toca de la ficha ---
  if (plazas > 0) {
    const dentro = (b.trabajadores || []).length
    const libres = (game.state.villagers || []).filter(v => !v.buildingId).length
    caja.appendChild(el('div', { clase: 'ficha-gente' }, [
      el('button', {
        clase: 'btn btn-piedra', type: 'button', texto: '−', 'aria-label': 'Quitar aldeano',
        disabled: dentro <= 0,
        onclick: () => {
          const ultimo = (b.trabajadores || [])[dentro - 1]
          if (ultimo) pedir('aldeanos', 'desasignar', false, ultimo)
        }
      }),
      el('div', { clase: 'ficha-gente-num' }, [
        el('span', { texto: `${ICONO.aldeano} ${dentro} / ${plazas}` }),
        el('small', { texto: libres ? `${libres} sin oficio` : 'nadie libre' })
      ]),
      el('button', {
        clase: 'btn btn-oro', type: 'button', texto: '+', 'aria-label': 'Asignar aldeano',
        disabled: dentro >= plazas || libres <= 0,
        onclick: () => {
          const libre = (game.state.villagers || []).find(v => !v.buildingId)
          if (!libre) { toast('No hay aldeanos libres: construye una casa.', 'mal'); return }
          pedir('aldeanos', 'asignar', false, libre.id, b.id)
        }
      })
    ]))
  }

  // --- gestionar el edificio DESDE AQUÍ: entrenar, investigar, curar, cambiar,
  //     explorar. Lo que hace cada edificio se hace en su ficha, sin dar vueltas.
  if (!enObra) seccionesDeGestion(caja, b, d, nivel, panel)

  // --- acciones ---
  const acciones = el('div', { clase: 'ficha-acciones' })
  const puede = pedir('edificios', 'puedeMejorar', { ok: false, motivo: 'No se puede mejorar' }, b.id)
  const costeSig = pedir('edificios', 'costeMejorar', null, b.id)

  if (!enObra) {
    acciones.appendChild(el('button', {
      clase: 'btn btn-oro btn-gordo ancho', type: 'button',
      estilo: { flexDirection: 'column', gap: '2px' },
      disabled: !puede.ok,
      onclick: () => { if (pedir('edificios', 'mejorar', false, b.id)) { pintarRecursos(); pintarObras() } }
    }, [
      el('div', { texto: `⬆️ Mejorar a nivel ${nivel + 1}` }),
      costeSig ? el('div', { clase: 'pequeño', html: costeHTML({ ...costeSig, tiempo: d?.tiempo?.(nivel + 1) }) }) : null
    ]))
    if (!puede.ok && puede.motivo) {
      acciones.appendChild(el('div', { clase: 'tenue pequeño ancho', estilo: { textAlign: 'center' }, texto: puede.motivo }))
    }
  }

  acciones.appendChild(el('button', {
    clase: 'btn btn-piedra', type: 'button', texto: '✋ Mover',
    onclick: () => { panel.cerrar(); empezarMover(b.id) }
  }))

  acciones.appendChild(el('button', {
    clase: 'btn btn-peligro', type: 'button', texto: '💥 Demoler',
    disabled: b.tipo === 'ayuntamiento',
    onclick: async () => {
      const si = await confirmar({
        titulo: '¿Demoler?',
        texto: `${d?.nombre || 'El edificio'} desaparece y recuperas la mitad de lo invertido.`,
        si: 'Demoler', peligro: true
      })
      if (!si) return
      if (pedir('edificios', 'demoler', false, b.id)) panel.cerrar()
    }
  }))

  if (b.arruinado || (b.hpMax && b.hp < b.hpMax)) {
    acciones.appendChild(el('button', {
      clase: 'btn btn-oro ancho', type: 'button',
      html: `🛠️ Reparar ${costeHTML(pedir('edificios', 'costeReparar', null, b.id) || {})}`,
      onclick: () => pedir('edificios', 'reparar', false, b.id)
    }))
  }

  caja.appendChild(acciones)
  return caja
}

/**
 * QUÉ HACE ESTE EDIFICIO. Los números salen de `efectosDe()` (data/buildings),
 * o sea del MISMO sitio del que los saca la simulación: si mañana alguien
 * reequilibra el juego, esta ficha sigue diciendo la verdad sin tocarla.
 */
function bloqueQueHace (tipo, nivel) {
  const caja = el('div', { clase: 'panel que-hace' })
  caja.appendChild(el('div', { clase: 'ficha-seccion', texto: 'Qué hace, a este nivel' }))
  // la vida ya sale arriba en su baldosa de «Resistencia»: repetirla es ruido
  const lista = efectosDe(tipo, nivel).filter(e => e.clave !== 'vida')
  if (!lista.length) {
    caja.appendChild(el('div', { clase: 'ficha-nota', texto: 'Nada de nada: está aquí de adorno.' }))
    return caja
  }
  for (const e of lista) {
    caja.appendChild(el('div', { clase: 'que-fila' }, [
      el('i', { texto: e.icono }),
      el('div', { clase: 'crece que-txt' }, [
        el('div', {}, [el('b', { texto: `${e.etiqueta}: ` }), el('span', { texto: e.valor })]),
        e.nota ? el('small', { texto: e.nota }) : null
      ])
    ]))
  }
  return caja
}

/**
 * POR QUÉ TE CONVIENE (o por qué te está haciendo daño) ESTE edificio, con el
 * estado de la partida en la mano: el almacén que rebosa, el molino plantado
 * donde no llega a ninguna granja, el puesto de trabajo vacío. Es la diferencia
 * entre saber qué hace un edificio y saber qué hacer con él.
 */
function avisosDeEdificio (b, d, nivel) {
  const s = game.state
  const out = []
  const aviso = (tono, icono, texto) => out.push(
    el('div', { clase: `aviso aviso-${tono}` }, [el('i', { texto: icono }), el('span', { texto })])
  )
  if (!d) return out
  const eco = economia()

  // almacén y granero: ¿se está tirando algo por culpa de su tope?
  if (typeof d.capacidad === 'function') {
    const guarda = Object.keys(d.capacidad(nivel) || {})
    const tirando = guarda.filter(r => eco[r]?.lleno)
    if (tirando.length) {
      const txt = tirando.map(r => `${formatoNumero(Math.round(eco[r].desperdicio))} de ${r}`).join(' y ')
      aviso('mal', '🚨', `Estás perdiendo ${txt} por hora: ya no cabe más. Mejora este ${d.nombre.toLowerCase()} o levanta otro.`)
    } else {
      const pronto = guarda.map(r => eco[r]).filter(e => e && e.llenaEn != null).sort((a, c) => a.llenaEn - c.llenaEn)[0]
      if (pronto && pronto.llenaEn < 3600) {
        aviso('info', '⏳', `Se te llena en ${formatoTiempo(pronto.llenaEn)}. A partir de ahí, lo que produzcas de más se tira.`)
      }
    }
  }

  // molino: solo vale si de verdad llega a las granjas
  if (d.aura && typeof d.aura.bonus === 'function') {
    const c = centroDe(b)
    const vecina = defEdificio(d.aura.afecta)
    const nombre = (vecina?.nombre || 'edificio').toLowerCase()
    const tocadas = (s.buildings || []).filter(x => {
      if (x.tipo !== d.aura.afecta || x.enObra) return false
      const cc = centroDe(x)
      return dist(c.x, c.z, cc.x, cc.z) <= d.aura.radio
    }).length
    if (!tocadas) {
      aviso('mal', '⚠️', `Aquí no le llega a ninguna ${nombre}: así no sirve absolutamente de nada. Muévelo al centro de un grupo de ${nombre}s.`)
    } else {
      aviso('bien', '✅', `Ahora mismo mejora ${tocadas} ${nombre}${tocadas > 1 ? 's' : ''}: cada una produce un ${Math.round(d.aura.bonus(nivel) * 100)} % más.`)
    }
  }

  // herrería: a cuánta gente le está subiendo el ataque
  if (typeof d.bonusAtaque === 'function') {
    const tropas = Object.values(s.ejercito?.tropas || {}).reduce((a, n) => a + (Number(n) || 0), 0)
    const pct = Math.round(d.bonusAtaque(nivel) * 100)
    aviso(tropas ? 'bien' : 'info', '⚔️', tropas
      ? `Tus ${tropas} soldados están pegando un ${pct} % más por esto, y los que entrenes saldrán ya mejorados.`
      : `Todavía no tienes tropa, pero en cuanto entrenes saldrá con ese ${pct} % de más puesto.`)
  }

  // puestos vacíos: es la fuga de producción más tonta del juego
  const plazas = typeof d.plazas === 'function' ? d.plazas(nivel) : 0
  if (plazas > 0) {
    const dentro = (b.trabajadores || []).length
    if (dentro < plazas) {
      const libres = (s.villagers || []).filter(v => !v.buildingId).length
      aviso('mal', '🧑‍🌾', libres
        ? `Le faltan ${plazas - dentro} en el puesto y tienes ${libres} sin oficio: métel${libres > 1 ? 'os' : 'o'} con el + y producirá más.`
        : `Le faltan ${plazas - dentro} en el puesto y no hay nadie libre. Levanta una casa para que llegue gente nueva.`)
    }
  }

  // camas: si el tope está tocado, subirlo es lo que desatasca la aldea
  if (typeof d.poblacionMax === 'function' || typeof d.aloja === 'function') {
    const g = gente()
    if (g.maxima > 0 && g.actual >= g.maxima) {
      aviso('mal', '🛏️', `No queda ni una cama libre (${g.actual} de ${g.maxima}): no llegará gente nueva hasta que subas el tope.`)
    }
  }

  // monasterio: los heridos que tiene dentro
  if (typeof d.curacion === 'function') {
    const h = pedir('ejercito', 'tiempoRecuperacion', { heridos: 0 }).heridos || 0
    if (h) aviso('info', '⛪', `Tienes ${h} heridos remendándose aquí dentro: volverán a pelear solos.`)
  }

  // taller de asedio: la lección que el juego no contaba
  if (Array.isArray(d.entrena) && d.entrena.includes('ariete')) {
    aviso('info', '🧱', `Contra un tramo de muro, un lancero hace ${danoAMuro('lancero')} de daño y un ariete ${danoAMuro('ariete')}: es lo único que abre una muralla deprisa. Sin arietes, una plaza amurallada es un muro de verdad.`)
  }
  return out
}

/* ---------------------------------------------------------------------------
   Gestionar el edificio desde su propia ficha
   Un cuartel entrena, la universidad investiga, el monasterio cura, el mercado
   cambia y el campamento manda gente al valle. Todo eso se hace AQUÍ, no en
   otro panel: el jugador toca el edificio y hace lo suyo. Las APIs son las de
   sim/, cargadas con el `import()` tolerante de siempre.
   --------------------------------------------------------------------------- */

/** Reúne los relojes de las secciones de gestión en el `_tic` de la ficha. */
function añadirTic (caja, fn) {
  const previo = caja._tic
  caja._tic = () => { previo?.(); fn() }
  fn()
}

function seccionesDeGestion (caja, b, d, nivel, panel) {
  if (Array.isArray(d?.entrena) && d.entrena.length) seccionEntrenar(caja, b, d, nivel)
  if (b.tipo === 'universidad') seccionInvestigar(caja, panel)
  if (b.tipo === 'monasterio') seccionCurar(caja)
  if (b.tipo === 'mercado') seccionMercado(caja)
  if (b.tipo === 'campamento_explorador') seccionExplorar(caja, d, nivel)
}

/** Segundos reales por unidad en ESTE edificio (su nivel manda en la prisa). */
function segundosTropa (u, d, nivel) {
  const vel = typeof d?.velocidad === 'function' ? d.velocidad(nivel) : 1
  return Math.max(1, Math.round(u.tiempo / Math.max(0.1, vel)))
}

const costeTropa = (u, n = 1) => {
  const c = {}
  for (const r of CONFIG.RECURSOS) if (u.coste?.[r]) c[r] = u.coste[r] * n
  return c
}

/** Entrenar desde el cuartel, la arquería, el establo o el taller de asedio. */
function seccionEntrenar (caja, b, d, nivel) {
  caja.appendChild(el('div', { clase: 'ficha-seccion', texto: 'Entrenar aquí' }))

  const oc = pedir('ejercito', 'ocupacion', { usado: 0, total: 0 })
  caja.appendChild(el('div', {
    clase: 'ficha-nota',
    texto: `Hueste: ${formatoNumero(oc.usado)} de ${formatoNumero(oc.total)} huecos ocupados.`
  }))

  for (const tipo of d.entrena) {
    const u = defUnidad(tipo)
    if (!u) continue
    const permiso = pedir('ejercito', 'puedeEntrenar', { ok: false, motivo: '' }, tipo, 1)
    const segundos = segundosTropa(u, d, nivel)

    const boton = (cuantos) => el('button', {
      clase: ['btn', cuantos === 1 ? 'btn-oro' : 'btn-piedra'], type: 'button',
      texto: `+${cuantos}`,
      'aria-label': `Entrenar ${cuantos} ${u.nombre}`,
      disabled: !pedir('ejercito', 'puedeEntrenar', { ok: false }, tipo, cuantos).ok,
      onclick: () => {
        pedir('ejercito', 'entrenar', null, tipo, cuantos)
        pintarRecursos(); pintarObras(); pintarBadges()
      }
    })

    caja.appendChild(el('div', { clase: 'tropa-fila' }, [
      el('i', { texto: u.icono || '⚔️' }),
      el('div', { clase: 'tropa-txt' }, [
        el('b', { texto: u.nombre }),
        el('div', { clase: 'coste-linea', html: costeHTML({ ...costeTropa(u), tiempo: segundos }) }),
        permiso.ok ? null : el('small', { clase: 'ritmo-mal', texto: permiso.motivo })
      ]),
      el('div', { clase: 'tropa-botones' }, [boton(1), boton(5)])
    ]))
  }

  // --- la cola: qué se está horneando y cuánto falta ---
  const cola = game.state.ejercito?.cola || []
  if (!cola.length) return
  caja.appendChild(el('div', { clase: 'ficha-seccion', texto: 'En el patio de armas' }))
  const cuenta = {}
  for (const it of cola) cuenta[it.tipo] = (cuenta[it.tipo] || 0) + 1
  caja.appendChild(el('div', { clase: 'tropa-cola' },
    Object.entries(cuenta).map(([tipo, n]) =>
      el('span', { clase: 'chip chip-madera' }, [
        el('i', { texto: defUnidad(tipo)?.icono || '⚔️' }),
        el('span', { texto: `×${n}` })
      ]))))

  const reloj = el('b', { clase: 'num' })
  const acelera = el('button', {
    clase: 'btn btn-oro', type: 'button', estilo: { width: '100%', marginTop: '8px' },
    onclick: () => { pedir('ejercito', 'acelerarEntrenamiento', null); pintarRecursos(); pintarObras() }
  })
  const barra = barraProgreso(0)
  const fin = cola[cola.length - 1].fin
  const inicio = cola[0].inicio
  añadirTic(caja, () => {
    const restante = Math.max(0, (fin - Date.now()) / 1000)
    const total = Math.max(1, (fin - inicio) / 1000)
    reloj.textContent = formatoTiempo(restante)
    barra.fijar(Math.min(100, (1 - restante / total) * 100))
    acelera.textContent = `${ICONO.gemas} Terminar ya · ${Math.max(1, Math.ceil(restante / CONFIG.SEG_POR_GEMA))}`
  })
  caja.appendChild(el('div', { clase: 'panel', estilo: { padding: '10px' } }, [
    el('div', { clase: 'fila fila-sep' }, [el('b', { texto: `${cola.length} en camino` }), reloj]),
    barra.nodo,
    acelera
  ]))
}

/** La universidad investiga desde su ficha: lo que ya se puede pagar, arriba. */
function seccionInvestigar (caja, panel) {
  caja.appendChild(el('div', { clase: 'ficha-seccion', texto: 'Investigar' }))

  const enCurso = pedir('ciencia', 'progresoInvestigacion', null)
  if (enCurso) {
    const reloj = el('b', { clase: 'num' })
    const barra = barraProgreso(0)
    añadirTic(caja, () => {
      const ahora = pedir('ciencia', 'progresoInvestigacion', null) || enCurso
      reloj.textContent = formatoTiempo(Math.max(0, ahora.restante || 0))
      barra.fijar(Math.min(100, (ahora.pct || 0) * 100))
    })
    caja.appendChild(el('div', { clase: 'panel', estilo: { padding: '10px' } }, [
      el('div', { clase: 'fila fila-sep' }, [el('b', { texto: enCurso.nombre || 'Investigando…' }), reloj]),
      barra.nodo
    ]))
    return
  }

  const lista = (pedir('ciencia', 'disponibles', []) || []).slice(0, 3)
  if (!lista.length) {
    caja.appendChild(el('div', { clase: 'ficha-nota', texto: 'No queda nada por investigar en esta edad.' }))
    return
  }
  for (const t of lista) {
    caja.appendChild(el('div', { clase: 'tropa-fila' }, [
      el('i', { texto: t.icono || '📜' }),
      el('div', { clase: 'tropa-txt' }, [
        el('b', { texto: t.nombre }),
        el('div', { clase: 'coste-linea', html: costeHTML({ ...t.coste, tiempo: t.tiempoReal || t.tiempo }) })
      ]),
      el('div', { clase: 'tropa-botones' }, [
        el('button', {
          clase: 'btn btn-oro', type: 'button', texto: '📜', 'aria-label': `Investigar ${t.nombre}`,
          disabled: !t.asequible,
          onclick: () => {
            const r = pedir('ciencia', 'investigar', { ok: false, motivo: '' }, t.id)
            if (!r?.ok && r?.motivo) toast(r.motivo, 'mal')
            pintarRecursos(); pintarObras()
          }
        })
      ])
    ]))
  }
  caja.appendChild(el('button', {
    clase: 'btn btn-piedra btn-gordo', type: 'button', texto: '📚 Ver todas las tecnologías',
    onclick: () => { panel.cerrar(); events.emit(EV.UI_PANEL, { panel: 'investigar' }) }
  }))
}

/** El monasterio remienda: heridos, cuánto falta y cómo sacarlos ya. */
function seccionCurar (caja) {
  const info = pedir('ejercito', 'tiempoRecuperacion', { heridos: 0 })
  caja.appendChild(el('div', { clase: 'ficha-seccion', texto: 'Enfermería' }))
  if (!info.heridos) {
    caja.appendChild(el('div', { clase: 'ficha-nota', texto: 'No hay nadie herido. Los catres están hechos.' }))
    return
  }
  const reloj = el('b', { clase: 'num' })
  añadirTic(caja, () => { reloj.textContent = formatoTiempo(pedir('ejercito', 'tiempoRecuperacion', { restante: 0 }).restante) })
  caja.appendChild(el('div', { clase: 'panel', estilo: { padding: '10px' } }, [
    el('div', { clase: 'fila fila-sep' }, [el('b', { texto: `🩹 ${info.heridos} convaleciente${info.heridos === 1 ? '' : 's'}` }), reloj]),
    el('div', { clase: 'ficha-acciones', estilo: { marginTop: '8px' } }, [
      el('button', {
        clase: 'btn btn-piedra', type: 'button',
        html: `🩺 Pagar<br>${costeHTML(info.coste || {})}`,
        onclick: () => { pedir('ejercito', 'curarTodo', null, 'recursos'); pintarRecursos() }
      }),
      el('button', {
        clase: 'btn btn-oro', type: 'button', texto: `${ICONO.gemas} ${info.gemas}`,
        'aria-label': 'Curar a todos con gemas',
        onclick: () => { pedir('ejercito', 'curarTodo', null, 'gemas'); pintarRecursos() }
      })
    ])
  ]))
}

/** El mercado cambia lo que sobra por lo que falta, sin salir de la ficha. */
function seccionMercado (caja) {
  caja.appendChild(el('div', { clase: 'ficha-seccion', texto: 'Cambiar recursos' }))
  let de = CONFIG.RECURSOS[0]
  let a = CONFIG.RECURSOS[3] || CONFIG.RECURSOS[1]
  let cantidad = 100

  const filaDe = el('div', { clase: 'pestañas' })
  const filaA = el('div', { clase: 'pestañas' })
  const filaCantidad = el('div', { clase: 'pestañas' })
  const resumen = el('div', { clase: 'ficha-nota' })
  const hacer = el('button', { clase: 'btn btn-oro btn-gordo', type: 'button' })

  const pintar = () => {
    if (de === a) a = CONFIG.RECURSOS.find(r => r !== de)
    for (const [fila, valor, fijar] of [[filaDe, de, (r) => { de = r }], [filaA, a, (r) => { a = r }]]) {
      vaciar(fila)
      for (const r of CONFIG.RECURSOS) {
        fila.appendChild(el('button', {
          clase: ['pestaña', r === valor && 'activa'], type: 'button',
          texto: ICONO[r], 'aria-label': NOMBRE_RECURSO[r],
          disabled: fila === filaA && r === de,
          onclick: () => { fijar(r); pintar() }
        }))
      }
    }
    vaciar(filaCantidad)
    for (const n of [100, 500, 1000]) {
      filaCantidad.appendChild(el('button', {
        clase: ['pestaña', n === cantidad && 'activa'], type: 'button', texto: formatoNumero(n),
        onclick: () => { cantidad = n; pintar() }
      }))
    }
    const tengo = Math.floor(game.state.recursos?.[de] || 0)
    hacer.disabled = tengo < cantidad
    hacer.innerHTML = `${ICONO[de]} ${formatoNumero(cantidad)} → ${ICONO[a]}`
    resumen.textContent = tengo < cantidad
      ? `No te llega: tienes ${formatoNumero(tengo)} de ${NOMBRE_RECURSO[de].toLowerCase()}.`
      : `El tendero se queda su comisión; lo demás entra en el almacén.`
  }

  hacer.onclick = () => {
    const r = pedir('recursos', 'cambiar', null, de, a, cantidad)
    if (r?.ok) toast(`${ICONO[a]} +${formatoNumero(r.recibido)}`, 'bien')
    pintarRecursos(); pintar()
  }

  pintar()
  caja.append(
    el('div', { clase: 'ficha-nota', texto: 'Entregas…' }), filaDe,
    el('div', { clase: 'ficha-nota', texto: '…y recibes' }), filaA,
    filaCantidad, hacer, resumen
  )
}

/** El campamento manda gente al valle: cuántos hay fuera y el botón de salir. */
function seccionExplorar (caja, d, nivel) {
  const ex = exploracion()
  const plazas = typeof d?.exploradores === 'function' ? d.exploradores(nivel) : ex.plazas
  caja.appendChild(el('div', { clase: 'ficha-seccion', texto: 'Exploración' }))
  caja.appendChild(el('div', {
    clase: 'ficha-nota',
    texto: ex.fuera
      ? `${ex.fuera} de ${plazas} batidor${plazas === 1 ? '' : 'es'} fuera${ex.vueltos ? ` · ${ex.vueltos} ya de vuelta` : ''}.`
      : `Tienes ${plazas} batidor${plazas === 1 ? '' : 'es'} esperando orden.`
  }))
  caja.appendChild(el('button', {
    clase: 'btn btn-oro btn-gordo', type: 'button',
    texto: ex.vueltos ? '🐎 Recibir al explorador' : '🧭 Mandar una expedición',
    onclick: () => irAlMundo(true)
  }))
}

/** Modo traslado: lo arrastra render/, y el toque en el tablero también vale. */
let cancelarMover = null
function empezarMover (id) {
  cancelarMover?.()
  const b = (game.state.buildings || []).find(x => x.id === id)
  if (!b) return
  // `moviendoId` es lo que mira el render para dejar arrastrar la pieza;
  // `moviendo` se mantiene por compatibilidad con lo que ya escuchaba.
  events.emit(EV.BUILD_MODE, { activo: true, tipo: b.tipo, moviendoId: b.id, moviendo: b.id, ancho: b.ancho, alto: b.alto })
  const aviso = toast('Arrastra el edificio o toca dónde quieres ponerlo', 'info', 6000)

  const quitar = events.on(EV.GRID_TAP, ({ x, z }) => {
    const centrado = { x: Math.round(x - ((b.ancho || 2) - 1) / 2), z: Math.round(z - ((b.alto || 2) - 1) / 2) }
    if (pedir('edificios', 'mover', false, id, centrado.x, centrado.z)) cancelarMover?.()
  })

  cancelarMover = () => {
    quitar()
    aviso?.()
    events.emit(EV.BUILD_MODE, { activo: false })
    cancelarMover = null
  }
}

/* ===========================================================================
   Avisos: bienvenida, alarma y celebraciones
   =========================================================================== */

function carteDeBienvenida ({ segundos = 0, textos = [], recursos = {} } = {}) {
  const lista = (textos && textos.length)
    ? textos
    : Object.entries(recursos).filter(([, n]) => n > 0).map(([r, n]) => `${ICONO[r]} ${formatoNumero(n)}`)
  if (!lista.length) return

  const panel = hoja({
    titulo: 'Mientras no estabas',
    contenido: el('div', { clase: 'col', estilo: { textAlign: 'center' } }, [
      el('div', { clase: 'tenue', texto: `Has estado fuera ${formatoTiempo(segundos)}. Tu gente no ha parado:` }),
      el('div', { clase: 'fila', estilo: { flexWrap: 'wrap', justifyContent: 'center', gap: '10px', fontSize: '1.3em', fontWeight: '800', margin: '8px 0' } },
        lista.map(t => el('span', { clase: 'chip chip-oro', texto: t })))
    ]),
    pie: el('button', {
      clase: 'btn btn-oro btn-gordo', type: 'button', texto: '🤝 Recoger',
      onclick: () => { panel.cerrar(); toast('¡A seguir construyendo!', 'bien'); events.emit(EV.SFX, { nombre: 'monedas' }) }
    })
  })
}

function pintarAlarma () {
  if (!alarma) return
  const restante = Math.max(0, (alarma.cuando - Date.now()) / 1000)
  const txt = restante > 0 ? formatoTiempo(restante) : '¡ya!'
  if (alarma.reloj.textContent !== txt) alarma.reloj.textContent = txt
  if (restante <= 0 && Date.now() - alarma.cuando > 4000) quitarAlarma()
}

/**
 * Qué puede hacer el jugador AHORA con el aviso encima. Sin esta línea el
 * cartel solo asusta: se mira el reloj y no se sabe qué tocar.
 */
function queHacerConElAtaque () {
  const s = game.state
  const muros = (s.buildings || []).filter(b => b.tipo === 'muralla' && !b.enObra).length
  const torres = (s.buildings || []).filter(b => !b.enObra && (b.tipo === 'torre_vigia' || b.tipo === 'torre_ballesta')).length
  const tropas = Object.values(s.ejercito?.tropas || {}).reduce((a, n) => a + (n || 0), 0)
  const roto = (s.buildings || []).some(b => b.arruinado || (b.hpMax && b.hp < b.hpMax * 0.8))

  if (roto) return 'Repara lo dañado y entrena lanceros'
  if (tropas < 6) return 'Entrena lanceros en el cuartel, ya'
  if (muros < 12) return 'Refuerza la muralla o entrena lanceros'
  if (torres < 2) return 'Alza otra torre vigía antes de que lleguen'
  return 'Revisa tu defensa y reparte la tropa'
}

function mostrarAlarma ({ enemigo, llegaEn = 0 } = {}) {
  quitarAlarma()
  const reloj = el('b', { texto: formatoTiempo(llegaEn) })
  // toda la tira es un botón de 46 px: se toca sin apuntar
  const nodo = el('button', {
    clase: 'hud-alarma', type: 'button',
    'aria-label': `Te atacan. ${queHacerConElAtaque()}. Ver la defensa`,
    onclick: () => events.emit(EV.UI_PANEL, { panel: 'ejercito', datos: { solapa: 'defensa' } })
  }, [
    el('i', { texto: '⚔️' }),
    el('div', { clase: 'alarma-txt' }, [
      el('div', { clase: 'alarma-tit', texto: `Te atacan · ${enemigo?.nombre || 'bandidos'}` }),
      el('div', { clase: 'alarma-que', texto: queHacerConElAtaque() })
    ]),
    reloj,
    el('em', { texto: '›' })
  ])
  raiz().appendChild(nodo)
  raiz().classList.add('alarmado')
  alarma = { nodo, reloj, cuando: Date.now() + llegaEn * 1000 }
}

function quitarAlarma () {
  alarma?.nodo.remove()
  alarma = null
  raiz().classList.remove('alarmado')
}

let fiesta = null
function celebrar (icono, titulo, texto) {
  fiesta?.remove()
  const nodo = el('div', { clase: 'hud-fiesta' },
    el('div', { clase: 'panel fiesta-carta' }, [
      el('span', { clase: 'icono-gr', texto: icono }),
      el('h3', { texto: titulo }),
      texto ? el('p', { texto }) : null
    ]))
  raiz().appendChild(nodo)
  fiesta = nodo
  setTimeout(() => { if (fiesta === nodo) { nodo.remove(); fiesta = null } }, 2600)
}

/* ===========================================================================
   AYUDA: para qué sirve cada cosa
   Agrupada por PARA QUÉ SIRVE (no por pestaña del catálogo) y escrita para
   leerse de un tirón en dos minutos. Los grupos y las frases viven en
   data/buildings.js, y los números de cada edificio salen de `efectosDe()`:
   aquí no se escribe ni una cifra a mano.
   =========================================================================== */

/**
 * Las cuatro reglas que el juego nunca contaba y que explican casi todo lo que
 * le desespera a un jugador nuevo. La del muro y los arietes es la que más:
 * sin ella, las plazas amuralladas parecen un callejón sin salida.
 */
/** Daño que le hace a un tramo de muro un golpe de esa tropa (catálogo puro). */
const danoAMuro = (tipo) => Math.round((UNIDADES[tipo]?.ataque || 0) * (PIEDRA_PAPEL[tipo]?.muro ?? 1))

const LECCIONES = [
  {
    icono: '⏳',
    titulo: 'Todo produce solo, también con el móvil guardado',
    texto: 'Las serrerías, canteras, granjas y minas trabajan sin ti (hasta 8 horas guardadas). Tú decides qué se construye y cuánta gente trabaja en cada sitio.'
  },
  {
    icono: '📦',
    titulo: 'Si el almacén está lleno, estás tirando lo que produces',
    texto: 'Cada recurso tiene un tope. Al llegar al tope no se acumula nada más: se pierde. El almacén sube el tope de madera y piedra, el granero el de comida y oro. Cuando arriba veas «¡LLENO!», o gastas o amplías.'
  },
  {
    icono: '🧑‍🌾',
    titulo: 'Un edificio vacío rinde la cuarta parte',
    texto: 'Los aldeanos necesitan cama (casas y Ayuntamiento) y un puesto donde trabajar. Con los puestos llenos produces cuatro veces más que con ellos vacíos, y no cuesta nada: solo repartir.'
  },
  {
    icono: '🧱',
    titulo: 'Contra murallas, arietes. No hay otra',
    texto: `Un lancero le hace ${danoAMuro('lancero')} de daño a un tramo de muro; un ariete, ${danoAMuro('ariete')}. Si atacas una plaza amurallada sin llevar asedio, tu gente se queda picando piedra mientras las torres los siegan. Los arietes salen del taller de asedio, que pide Ayuntamiento de nivel 5, herrería de nivel 3 y la Edad de los Castillos.`
  },
  {
    icono: '♟️',
    titulo: 'Cada tropa se come a otra',
    texto: 'Los lanceros destrozan a la caballería; la caballería, a los arqueros; los arqueros, a la infantería a pie; los espadachines protegen a tus máquinas de asedio. Ir con un solo tipo de tropa es la forma más rápida de perder una hueste entera.'
  }
]

let hojaAyuda = null

function abrirAyuda () {
  if (hojaAyuda) return hojaAyuda
  const s = game.state
  const cuerpo = el('div', { clase: 'col' })

  cuerpo.appendChild(el('p', {
    clase: 'pequeño', estilo: { margin: '0', lineHeight: '1.4' },
    texto: 'Levantas una aldea, la llenas de gente que trabaja, la rodeas de muros y torres, y con lo que produces entrenas tropa para saquear a los vecinos. Esto es lo que hace cada cosa.'
  }))

  cuerpo.appendChild(el('div', { clase: 'ficha-seccion', texto: 'Las cinco reglas del juego' }))
  for (const l of LECCIONES) {
    cuerpo.appendChild(el('div', { clase: 'panel col', estilo: { padding: '10px 12px', gap: '4px' } }, [
      el('div', { clase: 'fila', estilo: { gap: '9px' } }, [
        el('span', { clase: 'icono-gr', texto: l.icono }),
        el('b', { clase: 'crece', texto: l.titulo })
      ]),
      el('div', { clase: 'pequeño', estilo: { lineHeight: '1.4' }, texto: l.texto })
    ]))
  }

  for (const g of GRUPOS_AYUDA) {
    cuerpo.appendChild(el('div', { clase: 'ficha-seccion', texto: `${g.icono} ${g.titulo}` }))
    cuerpo.appendChild(el('div', { clase: 'pequeño', estilo: { lineHeight: '1.4' }, texto: g.texto }))
    const lista = el('div', { clase: 'panel col', estilo: { padding: '8px 10px', gap: '10px' } })
    for (const tipo of g.tipos) {
      const d = defEdificio(tipo)
      if (!d) continue
      // el nivel que TIENE el jugador: así los números de la ayuda son los suyos
      const mio = (s.buildings || []).filter(b => b.tipo === tipo).reduce((n, b) => Math.max(n, b.nivel || 1), 0)
      const nivel = mio || 1
      const efectos = efectosDe(tipo, nivel).filter(e => e.clave !== 'vida').slice(0, 3)
      lista.appendChild(el('div', { clase: 'que-fila' }, [
        el('i', { texto: d.icono }),
        el('div', { clase: 'crece que-txt' }, [
          el('div', {}, [
            el('b', { texto: d.nombre }),
            // sin género: «el tuyo» chirría en la cantera y en la granja
            el('span', { clase: 'tenue', texto: mio ? ` · el que tienes: nivel ${nivel}` : ' · aún no tienes' })
          ]),
          el('div', { estilo: { lineHeight: '1.35' }, texto: paraQueSirve(tipo) }),
          efectos.length
            ? el('small', { estilo: { color: 'var(--verde-oscuro)', fontWeight: '800' }, texto: efectos.map(e => e.corto).join(' · ') })
            : null
        ])
      ]))
    }
    cuerpo.appendChild(lista)
  }

  hojaAyuda = hoja({
    titulo: '📖 Para qué sirve cada cosa',
    contenido: cuerpo,
    alCerrar: () => { hojaAyuda = null }
  })
  return hojaAyuda
}

/* ===========================================================================
   Ajustes
   =========================================================================== */

/**
 * Único punto donde el HUD escribe en `game.state`, y solo en `ajustes`:
 * son preferencias del jugador (sonido, calidad), no simulación, y ni audio.js
 * ni scene.js exponen otra manera de cambiarlas: las leen de aquí en cada tick.
 */
function ajustar (clave, valor) {
  const a = game.state.ajustes || (game.state.ajustes = {})
  a[clave] = valor
  events.emit(EV.SFX, { nombre: 'toque' })
}

function abrirAjustes () {
  const cuerpo = el('div', { clase: 'col' })
  const panel = hoja({ titulo: 'Ajustes', contenido: cuerpo })

  const pintar = () => {
    const a = game.state.ajustes || {}
    vaciar(cuerpo)

    const interruptor = (clave, icono, etiqueta) => el('div', { clase: 'fila fila-sep' }, [
      el('b', { texto: `${icono} ${etiqueta}` }),
      el('button', {
        clase: ['btn', a[clave] !== false ? 'btn-oro' : 'btn-piedra'], type: 'button',
        texto: a[clave] !== false ? 'Sí' : 'No',
        estilo: { minWidth: '84px' },
        onclick: () => { ajustar(clave, a[clave] === false); pintar() }
      })
    ])

    // la ayuda, lo primero de todo: es lo que busca quien abre los ajustes sin
    // saber muy bien para qué sirve el granero
    cuerpo.appendChild(el('button', {
      clase: 'btn btn-oro btn-gordo', type: 'button', texto: '📖 Para qué sirve cada cosa',
      onclick: () => abrirAyuda()
    }))
    cuerpo.appendChild(el('div', { clase: 'separador' }))
    cuerpo.appendChild(interruptor('sonido', '🔊', 'Sonido'))
    cuerpo.appendChild(interruptor('musica', '🎵', 'Música'))
    cuerpo.appendChild(el('div', { clase: 'separador' }))

    cuerpo.appendChild(el('b', { texto: '🎨 Calidad gráfica' }))
    cuerpo.appendChild(el('div', { clase: 'pestañas' },
      [['auto', 'Automática'], ['alto', 'Alta'], ['medio', 'Media'], ['bajo', 'Baja']].map(([id, texto]) =>
        el('button', {
          clase: ['pestaña', (a.calidad || 'auto') === id && 'activa'], type: 'button', texto,
          onclick: () => { ajustar('calidad', id); pintar(); toast('Calidad cambiada', 'info') }
        }))))

    cuerpo.appendChild(el('div', { clase: 'separador' }))
    cuerpo.appendChild(el('b', { texto: '💾 Tu partida' }))
    cuerpo.appendChild(el('div', { clase: 'col' }, [
      el('button', { clase: 'btn btn-piedra btn-gordo', type: 'button', texto: '📤 Exportar partida', onclick: exportarPartida }),
      el('button', { clase: 'btn btn-piedra btn-gordo', type: 'button', texto: '📥 Importar partida', onclick: () => importarPartida(panel) }),
      el('button', { clase: 'btn btn-peligro btn-gordo', type: 'button', texto: '🗑️ Borrar partida', onclick: () => borrarPartida(panel) })
    ]))

    cuerpo.appendChild(el('div', {
      clase: 'tenue pequeño', estilo: { marginTop: '10px', textAlign: 'center' },
      texto: `${CONFIG.NOMBRE} · ${AGE_NOMBRE[game.state.age] || ''} · v${CONFIG.VERSION}`
    }))
  }

  pintar()
}

function exportarPartida () {
  let codigo = ''
  try { codigo = guardado.exportar() } catch { toast('No se ha podido exportar', 'mal'); return }
  const campo = el('textarea', {
    readonly: true, valor: codigo,
    estilo: { width: '100%', minHeight: '120px', fontSize: '.75em', borderRadius: '12px', padding: '8px', border: '2px solid var(--madera)' }
  })
  campo.value = codigo
  const panel = hoja({
    titulo: 'Copia de tu partida',
    contenido: el('div', { clase: 'col' }, [
      el('p', { clase: 'tenue pequeño', texto: 'Guarda este texto donde quieras. Pegándolo en «Importar» recuperas la partida tal cual.' }),
      campo
    ]),
    pie: el('button', {
      clase: 'btn btn-oro btn-gordo', type: 'button', texto: '📋 Copiar',
      onclick: async () => {
        try { await navigator.clipboard.writeText(codigo); toast('Copiado', 'bien') }
        catch { campo.select(); toast('Selecciónalo y cópialo a mano', 'info') }
        panel.cerrar()
      }
    })
  })
}

function importarPartida (ajustes) {
  const campo = el('textarea', {
    placeholder: 'Pega aquí el código de tu partida',
    estilo: { width: '100%', minHeight: '120px', fontSize: '.75em', borderRadius: '12px', padding: '8px', border: '2px solid var(--madera)' }
  })
  const panel = hoja({
    titulo: 'Importar partida',
    contenido: el('div', { clase: 'col' }, [
      el('p', { clase: 'tenue pequeño', texto: 'Esto sustituye tu partida actual. No hay vuelta atrás.' }),
      campo
    ]),
    pie: el('button', {
      clase: 'btn btn-oro btn-gordo', type: 'button', texto: 'Importar',
      onclick: async () => {
        const texto = campo.value.trim()
        if (!texto) { toast('Pega antes el código', 'mal'); return }
        if (!await confirmar({ titulo: '¿Seguro?', texto: 'Tu partida actual se perderá.', si: 'Importar', peligro: true })) return
        try {
          guardado.importar(texto)
          events.emit(EV.STATE_LOADED, { state: game.state, offlineSeconds: 0 })
          panel.cerrar(); ajustes?.cerrar()
          pintarRecursos(true); pintarObras(); pintarBadges(); pintarConsejo()
          toast('Partida importada', 'bien')
        } catch { toast('Ese código no vale', 'mal') }
      }
    })
  })
}

async function borrarPartida (ajustes) {
  if (!await confirmar({ titulo: '¿Borrar la partida?', texto: 'Se pierde toda la aldea, el ejército y el progreso.', si: 'Borrar', peligro: true })) return
  if (!await confirmar({ titulo: 'De verdad, ¿seguro?', texto: 'Esto no tiene arreglo. Se empieza de cero.', si: 'Sí, borrar todo', peligro: true })) return
  try { guardado.borrarPartida() } catch { /* daba igual: se recarga de todas formas */ }
  ajustes?.cerrar()
  toast('Partida borrada. Empezamos de nuevo…', 'info')
  setTimeout(() => location.reload(), 900)
}

/* ===========================================================================
   Eventos
   =========================================================================== */

let pendienteRecursos = false

function conectarEventos () {
  // Como mucho 4 refrescos por segundo: en móvil, repintar de más se nota.
  events.on(EV.RESOURCES_CHANGED, () => {
    if (pendienteRecursos) return
    pendienteRecursos = true
    setTimeout(() => { pendienteRecursos = false; pintarRecursos() }, 250)
  })

  events.on(EV.OFFLINE_RESUMEN, carteDeBienvenida)
  events.on(EV.ATTACK_INCOMING, (p) => { if (!p?.resuelto) mostrarAlarma(p) })
  events.on(EV.DEFENSE_RESOLVED, quitarAlarma)
  events.on(EV.RAID_RESOLVED, ({ victoria, botin } = {}) => {
    if (!victoria) return
    const texto = botin ? Object.entries(botin).filter(([, n]) => n > 0).map(([r, n]) => `${ICONO[r]} ${formatoNumero(n)}`).join('  ') : ''
    celebrar('🏆', '¡Victoria!', texto)
  })

  events.on(EV.LEVEL_UP, ({ nivel, gemas } = {}) => {
    celebrar('⭐', `¡Nivel ${nivel}!`, gemas ? `+${gemas} ${ICONO.gemas}` : '')
    pintarRecursos()
  })
  events.on(EV.AGE_ADVANCED, ({ age } = {}) => celebrar('🏰', '¡Nueva edad!', AGE_NOMBRE[age] || ''))
  events.on(EV.QUEST_COMPLETED, ({ quest, recompensa } = {}) => {
    const premio = recompensa ? Object.entries(recompensa).filter(([k, v]) => v > 0 && k !== 'xp').map(([k, v]) => `${ICONO[k] || ''} ${v}`).join('  ') : ''
    celebrar('📜', quest?.titulo || 'Encargo cumplido', premio)
    pintarBadges(); pintarConsejo()
  })

  events.on(EV.UI_SELECT, (p) => {
    if (p?.kind === 'building' && p.id) abrirFicha(p.id)
    else if (!p?.kind) { fichaAbierta?.panel.cerrar(); fichaAbierta = null }
  })
  events.on(EV.UI_PANEL, (p) => {
    if (p?.panel === 'edificio' && p.datos?.id) abrirFicha(p.datos.id)
    else if (p?.panel === 'produccion' || p?.panel === 'economia') abrirEconomia(p.datos?.recurso || null)
    // la ayuda la pide el taller con su botón ❓: el HUD es quien la pinta
    else if (p?.panel === 'ayuda') abrirAyuda()
    else if (p?.panel === 'avisos') abrirProblemas()
  })

  events.on(EV.VISTA_CAMBIADA, (p) => { if (p?.vista) { vistaActual = p.vista; pintarVista() } })
  pintarVista()

  // si otro módulo apaga el modo construcción, el traslado se da por terminado
  events.on(EV.BUILD_MODE, (p) => { if (p && p.activo === false && cancelarMover) { const f = cancelarMover; cancelarMover = null; f() } })

  // cambios que alteran lo que enseña el HUD: se repinta ya, sin esperar al latido
  for (const ev of [EV.BUILD_PLACED, EV.BUILD_COMPLETED, EV.BUILD_UPGRADED, EV.BUILD_DEMOLISHED, EV.UNIT_TRAINED, EV.TECH_RESEARCHED, EV.SCOUT_RETURNED]) {
    events.on(ev, () => { pintarObras(); pintarBadges(); pintarConsejo() })
  }
  events.on(EV.VILLAGER_ASSIGNED, () => pintarRecursos())
  events.on(EV.VILLAGER_SPAWNED, () => pintarRecursos())
  events.on(EV.STATE_LOADED, () => { pintarRecursos(true); pintarObras(); pintarBadges(); pintarConsejo() })
}

export default { init }
