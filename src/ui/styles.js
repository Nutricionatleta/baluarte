/**
 * LENGUAJE VISUAL DE BALUARTE.
 * Pergamino y madera noble: medieval pero limpio, legible al sol y pensado para el dedo.
 * Aquí vive la hoja de estilos entera y las ayudas que usan los demás paneles de ui/.
 *
 * Nadie más debería escribir CSS: si falta un componente, se añade AQUÍ para que
 * toda la interfaz siga pareciendo del mismo juego.
 */
import { events, EV } from '../core/events.js'
import { ICONO } from '../core/config.js'
import { game } from '../core/state.js'

const CSS = `
:root {
  /* --- paleta --- */
  --pergamino: #f3e6c8;
  --pergamino-claro: #fbf4e4;
  --pergamino-oscuro: #e0cba3;
  --madera: #5a3a22;
  --madera-clara: #7d5533;
  --madera-oscura: #3a2415;
  --oro: #d4a437;
  --oro-claro: #f2c85c;
  --oro-oscuro: #9c7413;
  --rojo: #b3332b;
  --rojo-claro: #d4564a;
  --rojo-oscuro: #7a1f19;
  --verde: #4a8f3c;
  --verde-claro: #6fb85c;
  --verde-oscuro: #2f6125;
  --piedra: #b8b1a4;
  --piedra-clara: #d6cfc2;
  --piedra-oscura: #7e786c;
  --tinta: #2d1b0e;
  --tinta-suave: #6b503a;
  --bien: var(--verde);
  --mal: var(--rojo);
  --velo: rgba(26, 16, 8, .55);

  /* --- forma --- */
  --r-s: 8px;
  --r-m: 14px;
  --r-g: 20px;
  --r-xl: 26px;
  --r-max: 999px;
  --toque: 48px;

  /* --- sombras y luces --- */
  --brillo: inset 0 2px 0 rgba(255, 255, 255, .55);
  --sombra-panel: 0 10px 24px rgba(26, 16, 8, .35);
  --sombra-flotante: 0 16px 34px rgba(26, 16, 8, .45);
  --sombra-suave: 0 3px 0 rgba(58, 36, 21, .35);

  /* --- tipografía: la del sistema, con números gordos --- */
  --tipo: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  --tam: clamp(14px, 3.5vw, 17px);

  /* --- movimiento --- */
  --rapido: 150ms;
  --medio: 220ms;
  --curva: cubic-bezier(.2, .8, .3, 1);

  /* --- zonas seguras del móvil (notch y barra de gestos) --- */
  --seg-arriba: env(safe-area-inset-top, 0px);
  --seg-abajo: env(safe-area-inset-bottom, 0px);
  --seg-izq: env(safe-area-inset-left, 0px);
  --seg-der: env(safe-area-inset-right, 0px);

  /* --- capas --- */
  --z-hoja: 60;
  --z-dialogo: 80;
  --z-toast: 90;
}

/* ---------- base ---------- */
#hud, .capa-hoja, .capa-dialogo, .capa-toast {
  font-family: var(--tipo);
  font-size: var(--tam);
  color: var(--tinta);
  -webkit-user-select: none; user-select: none;
  -webkit-tap-highlight-color: transparent;
}
#hud * , .capa-hoja * , .capa-dialogo * , .capa-toast * { box-sizing: border-box; }
.btn, .chip, .pestaña, .tarjeta, .hoja, .panel, .toast { touch-action: manipulation; }
.num { font-variant-numeric: tabular-nums; font-weight: 800; letter-spacing: -.01em; }
.tenue { color: var(--tinta-suave); }
.pequeño { font-size: .8em; }
.titular { margin: 0; font-weight: 800; font-size: 1.1em; letter-spacing: .01em; }
.fila { display: flex; align-items: center; gap: 8px; }
.fila-sep { justify-content: space-between; }
.col { display: flex; flex-direction: column; gap: 8px; }
.crece { flex: 1; min-width: 0; }
.rejilla { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
/* sin esto, un nombre largo agranda la columna y la rejilla se sale de la pantalla */
.rejilla > * { min-width: 0; }
.separador { height: 2px; margin: 10px 0; background: repeating-linear-gradient(90deg, rgba(90,58,34,.35) 0 8px, transparent 8px 14px); border-radius: 2px; }
.icono-gr { font-size: 1.8em; line-height: 1; }

/* ---------- botones ---------- */
.btn {
  --relieve: var(--madera);
  -webkit-appearance: none; appearance: none;
  font: inherit; font-weight: 800; font-size: 1em;
  color: var(--madera-oscura);
  min-height: var(--toque);
  padding: 10px 18px;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  border: 2px solid var(--madera-oscura);
  border-radius: var(--r-m);
  cursor: pointer;
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino-oscuro));
  box-shadow: var(--brillo), 0 4px 0 var(--relieve), 0 6px 12px rgba(26, 16, 8, .3);
  transition: transform var(--rapido) var(--curva), box-shadow var(--rapido) var(--curva), filter var(--rapido);
}
.btn:active {
  transform: translateY(4px);
  box-shadow: var(--brillo), 0 0 0 var(--relieve), 0 2px 6px rgba(26, 16, 8, .3);
}
.btn:focus-visible { outline: 3px solid var(--oro); outline-offset: 2px; }
.btn-oro { --relieve: var(--oro-oscuro); background-image: linear-gradient(180deg, var(--oro-claro), var(--oro)); border-color: var(--oro-oscuro); }
.btn-piedra { --relieve: var(--piedra-oscura); background-image: linear-gradient(180deg, var(--piedra-clara), var(--piedra)); border-color: var(--piedra-oscura); color: var(--tinta); }
.btn-peligro { --relieve: var(--rojo-oscuro); background-image: linear-gradient(180deg, var(--rojo-claro), var(--rojo)); border-color: var(--rojo-oscuro); color: #fff3ec; }
.btn-fantasma {
  background-image: none; background-color: transparent;
  border: 2px dashed rgba(90, 58, 34, .5);
  box-shadow: none; color: var(--tinta-suave);
}
.btn-fantasma:active { transform: scale(.97); box-shadow: none; background-color: rgba(90, 58, 34, .1); }
.btn-gordo { min-height: 58px; font-size: 1.08em; width: 100%; }
.btn-icono { min-width: var(--toque); padding: 10px; font-size: 1.2em; }
.btn[disabled], .btn.desactivado {
  filter: grayscale(.75); opacity: .48;
  box-shadow: none; transform: none;
  border-color: rgba(58, 36, 21, .55);
  pointer-events: none;
}
.btn.pop { animation: pop 220ms var(--curva); }

/* ---------- panel de pergamino ---------- */
.panel {
  position: relative;
  padding: 14px;
  color: var(--tinta);
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 3px solid var(--madera);
  border-radius: var(--r-g);
  box-shadow: var(--sombra-panel), inset 0 0 0 2px rgba(255, 255, 255, .3);
}
.panel-cabecera {
  margin: -14px -14px 12px;
  padding: 10px 14px;
  display: flex; align-items: center; gap: 8px;
  font-weight: 800;
  color: var(--pergamino-claro);
  background-image: linear-gradient(180deg, var(--madera-clara), var(--madera));
  border-bottom: 3px solid var(--madera-oscura);
  border-radius: 17px 17px 0 0;
  text-shadow: 0 1px 0 rgba(0, 0, 0, .35);
}
.panel-madera { background-image: linear-gradient(180deg, var(--madera-clara), var(--madera)); color: var(--pergamino-claro); border-color: var(--madera-oscura); }
.panel-madera .tenue { color: rgba(251, 244, 228, .7); }

/* ---------- hoja (bottom sheet): el patrón principal en móvil ---------- */
#hud > .capa-hoja, .capa-hoja {
  position: fixed; inset: 0; z-index: var(--z-hoja);
  display: flex; align-items: flex-end; justify-content: center;
  background: var(--velo);
  animation: aparece var(--medio) var(--curva) both;
}
.capa-hoja.cerrando { animation: desaparece 180ms ease-in both; }
.hoja {
  width: min(100%, 620px);
  max-height: min(86vh, 800px);
  display: flex; flex-direction: column;
  padding-bottom: calc(10px + var(--seg-abajo));
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 3px solid var(--madera); border-bottom: none;
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  box-shadow: var(--sombra-flotante);
  animation: sube 260ms var(--curva) both;
  will-change: transform;
}
.capa-hoja.cerrando .hoja { animation: baja 180ms ease-in both; }
.hoja.arrastrando { animation: none; transition: none; }
.hoja.soltando { animation: none; transition: transform var(--medio) var(--curva); }
.hoja-asa { padding: 10px 0 6px; display: flex; justify-content: center; touch-action: none; }
.hoja-asa i { width: 54px; height: 6px; border-radius: var(--r-max); background: var(--madera); opacity: .4; }
.hoja-cabecera {
  display: flex; align-items: center; gap: 10px;
  padding: 2px 14px 10px;
  border-bottom: 2px dashed rgba(90, 58, 34, .35);
  touch-action: none;
}
.hoja-titulo {
  flex: 1; min-width: 0; margin: 0;
  font-size: 1.15em; font-weight: 800;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.hoja-cuerpo {
  flex: 1; min-height: 0;
  padding: 12px 14px;
  padding-left: calc(14px + var(--seg-izq)); padding-right: calc(14px + var(--seg-der));
  overflow-y: auto; overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch; touch-action: pan-y;
}
.hoja-pie { padding: 10px 14px 0; border-top: 2px dashed rgba(90, 58, 34, .35); }
/* el body del juego lleva touch-action:none (para la cámara 3D) y eso impediría
   desplazar el contenido de la hoja: mientras hay una capa abierta, se afloja */
body.capa-abierta { touch-action: pan-y; }

/* ---------- diálogo de confirmar ---------- */
#hud > .capa-dialogo, .capa-dialogo {
  position: fixed; inset: 0; z-index: var(--z-dialogo);
  display: flex; align-items: center; justify-content: center;
  padding: calc(16px + var(--seg-arriba)) calc(16px + var(--seg-der)) calc(16px + var(--seg-abajo)) calc(16px + var(--seg-izq));
  background: var(--velo);
  animation: aparece var(--medio) var(--curva) both;
}
.capa-dialogo.cerrando { animation: desaparece 150ms ease-in both; }
.dialogo { width: min(100%, 420px); animation: pop var(--medio) var(--curva) both; }
.dialogo-texto { margin: 4px 0 16px; font-size: 1.05em; line-height: 1.4; }
.dialogo-botones { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

/* ---------- chip (recursos y contadores) ---------- */
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 32px; padding: 4px 10px;
  font-weight: 800; font-size: .92em;
  font-variant-numeric: tabular-nums;
  color: var(--tinta);
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino-oscuro));
  border: 2px solid rgba(58, 36, 21, .55);
  border-radius: var(--r-max);
  box-shadow: var(--brillo), 0 2px 0 rgba(58, 36, 21, .3);
  white-space: nowrap;
}
.chip-oro { background-image: linear-gradient(180deg, var(--oro-claro), var(--oro)); border-color: var(--oro-oscuro); }
.chip-madera { background-image: linear-gradient(180deg, var(--madera-clara), var(--madera)); border-color: var(--madera-oscura); color: var(--pergamino-claro); }
.chip-bien { background-image: linear-gradient(180deg, var(--verde-claro), var(--verde)); border-color: var(--verde-oscuro); color: #f2ffe9; }
.chip-mal { background-image: linear-gradient(180deg, var(--rojo-claro), var(--rojo)); border-color: var(--rojo-oscuro); color: #fff3ec; }
.chip i { font-style: normal; font-size: 1.1em; }

/* ---------- barra de progreso (obras) ---------- */
.barra-progreso {
  position: relative; height: 14px;
  border: 2px solid var(--madera-oscura); border-radius: var(--r-max);
  background: rgba(58, 36, 21, .35);
  box-shadow: inset 0 2px 3px rgba(0, 0, 0, .35);
  overflow: hidden;
}
.barra-progreso > i {
  display: block; height: 100%; width: 0; border-radius: var(--r-max);
  background-image:
    repeating-linear-gradient(115deg, rgba(255,255,255,.32) 0 9px, transparent 9px 18px),
    linear-gradient(180deg, var(--oro-claro), var(--oro));
  background-size: 22px 100%, auto;
  animation: rayado 800ms linear infinite;
  transition: width .3s var(--curva);
  will-change: background-position, width;
}
.barra-progreso.bien > i { background-image: repeating-linear-gradient(115deg, rgba(255,255,255,.3) 0 9px, transparent 9px 18px), linear-gradient(180deg, var(--verde-claro), var(--verde)); }
.barra-progreso.mal > i { background-image: repeating-linear-gradient(115deg, rgba(255,255,255,.3) 0 9px, transparent 9px 18px), linear-gradient(180deg, var(--rojo-claro), var(--rojo)); }
.barra-progreso.quieta > i { animation: none; }
.barra-progreso.gorda { height: 22px; }
/* fina: la de llenado del almacén en la barra de recursos, que no debe pesar */
.barra-progreso.fina { height: 6px; border-width: 1px; box-shadow: inset 0 1px 2px rgba(0, 0, 0, .3); }
.barra-progreso.fina > i { animation: none; transition: width var(--medio) var(--curva); }
.barra-texto { display: flex; justify-content: space-between; gap: 8px; margin-top: 4px; font-size: .78em; font-weight: 700; color: var(--tinta-suave); }

/* ---------- tarjeta de edificio / unidad ---------- */
.tarjeta {
  position: relative; min-width: 0;
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px; text-align: left;
  overflow-wrap: break-word;
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 2px solid rgba(90, 58, 34, .55);
  border-radius: var(--r-m);
  box-shadow: var(--sombra-suave);
}
/* icono arriba y texto debajo: en una columna estrecha de móvil es lo único
   que deja el nombre entero sin partir palabras */
.tarjeta-cabeza { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; min-width: 0; }
.tarjeta-cabeza > .tarjeta-cuerpo { width: 100%; min-width: 0; align-items: center; }
.tarjeta-cabeza .coste { justify-content: center; }
.tarjeta-icono {
  flex: none; width: 54px; height: 54px;
  display: grid; place-items: center; font-size: 1.9em; line-height: 1;
  background-image: radial-gradient(circle at 50% 32%, #fffaea, var(--pergamino-oscuro));
  border: 2px solid rgba(90, 58, 34, .45);
  border-radius: var(--r-m);
}
.tarjeta-nombre { font-weight: 800; font-size: 1em; }
.tarjeta-detalle { font-size: .8em; color: var(--tinta-suave); line-height: 1.3; }
.tarjeta .btn { width: 100%; padding-left: 10px; padding-right: 10px; }
/* variante ancha: icono a la izquierda, texto a la derecha (listas de una columna) */
.tarjeta-fila .tarjeta-cabeza { flex-direction: row; align-items: center; text-align: left; gap: 10px; }
.tarjeta-fila .tarjeta-cuerpo { flex: 1; align-items: stretch; }
.tarjeta-fila .coste { justify-content: flex-start; }

/* ---------- coste ---------- */
.coste { display: flex; flex-wrap: wrap; gap: 4px 10px; font-weight: 800; font-size: .88em; font-variant-numeric: tabular-nums; }
.coste-item { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.coste-item i { font-style: normal; font-size: 1.05em; }

/* ---------- ritmo: lo que ENTRA por hora ----------
   Un número de producción se lee por el color antes que por la cifra:
   verde entra, gris parado, rojo se pierde o se va. */
.ritmo { font-variant-numeric: tabular-nums; font-weight: 800; white-space: nowrap; }
.ritmo-bien { color: var(--verde-oscuro); }
.ritmo-mal { color: var(--rojo-oscuro); }
.ritmo-cero { color: var(--tinta-suave); }

/* ---------- baldosa de dato (rejilla de dos columnas) ---------- */
.stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.stat {
  display: flex; flex-direction: column; gap: 1px; min-width: 0;
  padding: 7px 10px;
  background: rgba(255, 255, 255, .5);
  border: 2px solid rgba(90, 58, 34, .3); border-radius: var(--r-m);
}
.stat small { font-size: .68em; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--tinta-suave); }
.stat b { font-size: 1.02em; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ---------- fila de dato: icono · texto · cifra a la derecha ---------- */
.dato {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 7px 10px; min-height: 44px;
  font: inherit; font-weight: 700; color: var(--tinta); text-align: left;
  background: transparent; border: none; border-radius: var(--r-s);
}
button.dato { min-height: var(--toque); cursor: pointer; }
button.dato:active { background: rgba(212, 164, 55, .28); }
.dato + .dato { border-top: 1px dashed rgba(90, 58, 34, .3); }
.dato > i { flex: none; font-style: normal; font-size: 1.25em; line-height: 1; }
.dato > b { margin-left: auto; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dato-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.dato-txt span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dato-txt small { font-size: .74em; font-weight: 700; color: var(--tinta-suave); }

/* ---------- aviso en línea (lo urgente, sin tapar el juego) ---------- */
.aviso {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  font-size: .85em; font-weight: 800; line-height: 1.25;
  border: 2px solid; border-radius: var(--r-m);
}
.aviso i { font-style: normal; font-size: 1.2em; }
.aviso-mal { color: var(--rojo-oscuro); background: #fbe4e0; border-color: var(--rojo); }
.aviso-bien { color: var(--verde-oscuro); background: #eaf8e2; border-color: var(--verde); }
.aviso-info { color: var(--madera-oscura); background: rgba(212, 164, 55, .22); border-color: var(--oro-oscuro); }

/* ---------- estados ---------- */
.no-alcanzable { color: var(--rojo); }
.tarjeta.no-alcanzable { border-color: rgba(179, 51, 43, .55); box-shadow: 0 3px 0 rgba(122, 31, 25, .3); }
.tarjeta.no-alcanzable .tarjeta-icono { filter: saturate(.6); }
.bloqueado { position: relative; filter: grayscale(.8); opacity: .62; pointer-events: none; }
.bloqueado::after {
  content: '🔒'; position: absolute; inset: 0;
  display: grid; place-items: start center; padding-top: 22px;
  font-size: 2em; filter: none; opacity: .95;
  text-shadow: 0 2px 6px rgba(0, 0, 0, .5);
}
.bloqueado-motivo { position: absolute; left: 0; right: 0; bottom: 6px; text-align: center; font-size: .72em; font-weight: 800; color: var(--madera-oscura); }

/* ---------- badge ---------- */
.badge {
  position: absolute; top: -7px; right: -7px;
  min-width: 22px; height: 22px; padding: 0 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: .72em; font-weight: 800; color: #fff;
  background-image: linear-gradient(180deg, var(--rojo-claro), var(--rojo));
  border: 2px solid var(--pergamino-claro);
  border-radius: var(--r-max);
  box-shadow: 0 2px 5px rgba(0, 0, 0, .4);
  animation: pop 260ms var(--curva);
}
.badge-suelto { position: static; }

/* ---------- pestañas ---------- */
.pestañas {
  display: flex; gap: 6px; padding: 4px;
  background: rgba(90, 58, 34, .12);
  border: 2px solid rgba(90, 58, 34, .25);
  border-radius: var(--r-max);
  overflow-x: auto; overscroll-behavior-x: contain;
  scrollbar-width: none;
}
.pestañas::-webkit-scrollbar { display: none; }
.pestaña {
  flex: 1 0 auto; min-height: 40px; padding: 6px 14px;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font: inherit; font-weight: 800; color: var(--tinta-suave);
  background: transparent; border: none; border-radius: var(--r-max);
  cursor: pointer; white-space: nowrap;
  transition: background var(--rapido), color var(--rapido), box-shadow var(--rapido);
}
.pestaña.activa {
  color: var(--madera-oscura);
  background-image: linear-gradient(180deg, var(--oro-claro), var(--oro));
  box-shadow: var(--brillo), 0 2px 0 var(--oro-oscuro);
}
.pestaña:active { transform: scale(.97); }

/* ---------- toast ---------- */
#hud > .capa-toast, .capa-toast {
  position: fixed; z-index: var(--z-toast);
  top: calc(var(--seg-arriba) + 10px); left: 50%;
  width: min(92vw, 440px);
  transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  max-width: 100%;
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px;
  font-weight: 800; font-size: .95em; line-height: 1.25;
  color: var(--tinta);
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 2px solid var(--madera);
  border-radius: var(--r-max);
  box-shadow: var(--sombra-flotante);
  animation: entraToast var(--medio) var(--curva) both;
}
.toast.cerrando { animation: saleToast 180ms ease-in both; }
.toast-bien { border-color: var(--verde-oscuro); background-image: linear-gradient(180deg, #eaf8e2, #cfeec2); }
.toast-mal { border-color: var(--rojo-oscuro); background-image: linear-gradient(180deg, #fbe4e0, #f3c6c0); }
.toast i { font-style: normal; font-size: 1.15em; }

/* ---------- animaciones ---------- */
@keyframes aparece { from { opacity: 0 } to { opacity: 1 } }
@keyframes desaparece { from { opacity: 1 } to { opacity: 0 } }
@keyframes sube { from { transform: translateY(100%) } to { transform: translateY(0) } }
@keyframes baja { from { transform: translateY(0) } to { transform: translateY(100%) } }
@keyframes pop { 0% { transform: scale(.82); opacity: .4 } 60% { transform: scale(1.04) } 100% { transform: scale(1); opacity: 1 } }
@keyframes latido { 0% { transform: scale(1) } 40% { transform: scale(1.18) } 100% { transform: scale(1) } }
@keyframes rayado { to { background-position: 22px 0, 0 0 } }
@keyframes entraToast { from { opacity: 0; transform: translateY(-22px) scale(.94) } to { opacity: 1; transform: none } }
@keyframes saleToast { from { opacity: 1 } to { opacity: 0; transform: translateY(-16px) scale(.96) } }
@keyframes tiembla { 0%, 100% { transform: translateX(0) } 20% { transform: translateX(-6px) } 40% { transform: translateX(5px) } 60% { transform: translateX(-3px) } 80% { transform: translateX(2px) } }
@keyframes destello { 0% { filter: brightness(1) } 50% { filter: brightness(1.35) } 100% { filter: brightness(1) } }
.latido { animation: latido 260ms var(--curva); }
.tiembla { animation: tiembla 300ms ease-in-out; }
.destello { animation: destello 400ms ease-in-out; }

/* ---------- adaptación ---------- */
@media (max-height: 520px) {
  .hoja { max-height: 94vh; width: min(100%, 760px); }
  .hoja-asa { padding: 6px 0 2px; }
  .hoja-cuerpo { padding-top: 8px; }
}
@media (min-width: 760px) {
  .rejilla { grid-template-columns: repeat(auto-fill, minmax(178px, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .btn, .hoja, .capa-hoja, .capa-dialogo, .dialogo, .toast, .badge, .latido, .tiembla, .destello, .barra-progreso > i {
    animation: none !important;
    transition-duration: 1ms !important;
  }
}
`

/* ===========================================================================
   Arranque
   =========================================================================== */

let listo = false
let capaToast = null

/** Inyecta la hoja de estilos y engancha los avisos. Idempotente. */
export function init () {
  if (listo) return
  listo = true

  if (!document.getElementById('estilos-baluarte')) {
    const hoja = document.createElement('style')
    hoja.id = 'estilos-baluarte'
    hoja.textContent = CSS
    document.head.appendChild(hoja)
  }

  // los avisos los pinta esta capa: nadie más necesita saber cómo se ven
  events.on(EV.UI_TOAST, (p) => {
    if (!p) return
    toast(p.texto ?? String(p), p.tipo)
  })

  // Escape cierra lo último abierto (cómodo al probar en el portátil)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    const ultimo = abiertos[abiertos.length - 1]
    if (ultimo) { e.preventDefault(); ultimo() }
  })
}

/** Todo lo demás llama aquí: las ayudas funcionan aunque nadie haya hecho init(). */
function asegurar () { if (!listo) init() }

/** Dónde cuelga la interfaz flotante: dentro del HUD si existe. */
function raiz () {
  return document.getElementById('hud') || document.body
}

/* ===========================================================================
   el() — crear elementos sin escribir HTML a mano
   =========================================================================== */

/**
 * @param {string} tag
 * @param {object|Array|string|Node} [props] propiedades, o directamente los hijos
 * @param {Array|string|Node} [hijos]
 * @returns {HTMLElement}
 */
export function el (tag, props, hijos) {
  const nodo = document.createElement(tag)

  // permite el('div', [hijo1, hijo2]) y el('b', 'texto')
  if (props != null && (Array.isArray(props) || typeof props === 'string' || typeof props === 'number' || props instanceof Node)) {
    hijos = props
    props = null
  }

  for (const [clave, valor] of Object.entries(props || {})) {
    if (valor == null || valor === false) continue
    if (clave === 'clase' || clave === 'class') {
      nodo.className = Array.isArray(valor) ? valor.filter(Boolean).join(' ') : String(valor)
    } else if (clave === 'texto') {
      nodo.textContent = String(valor)
    } else if (clave === 'html') {
      nodo.innerHTML = String(valor)
    } else if (clave === 'estilo' || clave === 'style') {
      if (typeof valor === 'string') nodo.style.cssText = valor
      else Object.assign(nodo.style, valor)
    } else if (clave === 'datos') {
      Object.assign(nodo.dataset, valor)
    } else if (clave === 'hijos') {
      hijos = hijos ?? valor
    } else if (clave === 'valor') {
      nodo.value = valor
    } else if (clave.startsWith('on') && typeof valor === 'function') {
      nodo.addEventListener(clave.slice(2).toLowerCase(), valor)
    } else if (valor === true) {
      nodo.setAttribute(clave, '')
    } else {
      nodo.setAttribute(clave, String(valor))
    }
  }

  añadir(nodo, hijos)
  return nodo
}

/** Mete hijos de cualquier forma (nodo, texto, array anidado, null). */
export function añadir (padre, hijos) {
  if (hijos == null || hijos === false) return padre
  if (Array.isArray(hijos)) { for (const h of hijos) añadir(padre, h); return padre }
  padre.appendChild(hijos instanceof Node ? hijos : document.createTextNode(String(hijos)))
  return padre
}

/** Deja un contenedor vacío (más rápido y limpio que innerHTML = ''). */
export function vaciar (nodo) {
  if (nodo) while (nodo.firstChild) nodo.removeChild(nodo.firstChild)
  return nodo
}

/* ===========================================================================
   Números, tiempos y costes
   =========================================================================== */

/** 1200 → "1,2K" · 3400000 → "3,4M" (coma decimal, como en español). */
export function formatoNumero (n) {
  const num = Number(n)
  if (!isFinite(num)) return '0'
  const signo = num < 0 ? '-' : ''
  let v = Math.abs(num)
  const sufijos = ['', 'K', 'M', 'MM']
  let i = 0
  while (v >= 1000 && i < sufijos.length - 1) { v /= 1000; i++ }
  let dec = i === 0 ? 0 : (v < 100 ? 1 : 0)
  let s = v.toFixed(dec)
  // 999.96K redondea a 1000K: sube de unidad en vez de quedar feo
  if (parseFloat(s) >= 1000 && i < sufijos.length - 1) { v /= 1000; i++; dec = 1; s = v.toFixed(dec) }
  if (dec > 0 && s.endsWith('.0')) s = s.slice(0, -2)
  return signo + s.replace('.', ',') + sufijos[i]
}

/** Segundos → "2h 15m" · "3m 20s" · "45s". Para obras y colas. */
export function formatoTiempo (segundos) {
  let s = Math.max(0, Math.round(Number(segundos) || 0))
  const d = Math.floor(s / 86400); s -= d * 86400
  const h = Math.floor(s / 3600); s -= h * 3600
  const m = Math.floor(s / 60); s -= m * 60
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`
  return `${s}s`
}

const escapar = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/**
 * Pinta "🪵 120  🪨 80" y marca en rojo lo que no alcanza.
 * @param {object} coste { madera: 120, piedra: 80, tiempo: 45 }
 * @param {object} [recursos] con qué se compara; por defecto, los del jugador
 * @returns {string} HTML listo para `html:` o innerHTML
 */
export function costeHTML (coste, recursos) {
  if (!coste) return ''
  const tengo = recursos || game.state?.recursos || {}
  const partes = []
  for (const [tipo, cantidad] of Object.entries(coste)) {
    if (!cantidad) continue
    const icono = ICONO[tipo] || (tipo === 'tiempo' ? ICONO.tiempo : '•')
    const texto = tipo === 'tiempo' ? formatoTiempo(cantidad) : formatoNumero(cantidad)
    const falta = tipo !== 'tiempo' && Number(tengo[tipo] || 0) < Number(cantidad)
    partes.push(
      `<span class="coste-item${falta ? ' no-alcanzable' : ''}" title="${escapar(tipo)}">` +
      `<i>${icono}</i>${escapar(texto)}</span>`
    )
  }
  return `<span class="coste">${partes.join('')}</span>`
}

/** ¿Alcanza para pagar este coste? Lo usan los paneles para apagar el botón. */
export function alcanza (coste, recursos) {
  const tengo = recursos || game.state?.recursos || {}
  for (const [tipo, cantidad] of Object.entries(coste || {})) {
    if (tipo === 'tiempo' || !cantidad) continue
    if (Number(tengo[tipo] || 0) < Number(cantidad)) return false
  }
  return true
}

/** Latido corto sobre un número que acaba de cambiar. */
export function latir (nodo, clase = 'latido') {
  if (!nodo) return
  nodo.classList.remove(clase)
  void nodo.offsetWidth   // reinicia la animación aunque se repita seguido
  nodo.classList.add(clase)
  setTimeout(() => nodo.classList.remove(clase), 420)
}

/* ===========================================================================
   Componentes listos para usar
   =========================================================================== */

/** Cápsula de recurso o contador: chip('🪵', 320, { tono:'oro' }). */
export function chip (icono, texto, opciones = {}) {
  const { tono = '', clase = '', ...resto } = opciones
  const nodo = el('span', { clase: ['chip', tono && `chip-${tono}`, clase], ...resto })
  if (icono) nodo.appendChild(el('i', { texto: icono }))
  const valor = el('span', { clase: 'chip-valor', texto: texto == null ? '' : String(texto) })
  nodo.appendChild(valor)
  nodo.valor = valor          // para refrescar el número sin volver a construir
  return nodo
}

/** Globito rojo de avisos. */
export function badge (n, opciones = {}) {
  const { suelto = false, clase = '' } = opciones
  return el('span', { clase: ['badge', suelto && 'badge-suelto', clase], texto: formatoNumero(n) })
}

/**
 * Barra de obra con rayado animado.
 * @returns {{nodo:HTMLElement, fijar:(pct:number)=>void}}
 */
export function barraProgreso (pct = 0, opciones = {}) {
  const { tono = '', gorda = false, clase = '' } = opciones
  const relleno = el('i')
  const nodo = el('div', { clase: ['barra-progreso', tono, gorda && 'gorda', clase], role: 'progressbar' }, relleno)
  const fijar = (p) => {
    const v = Math.max(0, Math.min(100, Number(p) || 0))
    relleno.style.width = `${v}%`
    nodo.setAttribute('aria-valuenow', Math.round(v))
  }
  fijar(pct)
  return { nodo, fijar }
}

/**
 * Tarjeta de edificio o unidad.
 * @param {object} o { icono, nombre, detalle, coste, recursos, textoBoton, alPulsar,
 *                     bloqueado, motivo, aviso, tonoBoton, fila }
 */
export function tarjeta (o = {}) {
  const puede = o.coste ? alcanza(o.coste, o.recursos) : true
  const caja = el('div', {
    clase: ['tarjeta', o.fila && 'tarjeta-fila', !puede && !o.bloqueado && 'no-alcanzable', o.bloqueado && 'bloqueado', o.clase]
  })

  const cuerpo = el('div', { clase: 'tarjeta-cuerpo col', estilo: { gap: '4px' } }, [
    el('div', { clase: 'tarjeta-nombre', texto: o.nombre || '' }),
    o.detalle ? el('div', { clase: 'tarjeta-detalle', texto: o.detalle }) : null,
    o.coste ? el('div', { clase: 'tarjeta-coste', html: costeHTML(o.coste, o.recursos) }) : null
  ])

  caja.appendChild(el('div', { clase: 'tarjeta-cabeza' }, [
    o.icono ? el('div', { clase: 'tarjeta-icono', texto: o.icono }) : null,
    cuerpo
  ]))

  if (o.textoBoton) {
    caja.appendChild(el('button', {
      clase: ['btn', o.tonoBoton ? `btn-${o.tonoBoton}` : 'btn-oro'],
      texto: o.textoBoton,
      disabled: !puede || o.bloqueado || o.desactivado,
      onclick: (e) => {
        e.currentTarget.classList.remove('pop'); void e.currentTarget.offsetWidth
        e.currentTarget.classList.add('pop')
        o.alPulsar?.(e)
      }
    }))
  }

  if (o.aviso != null) caja.appendChild(badge(o.aviso))
  if (o.bloqueado && o.motivo) caja.appendChild(el('div', { clase: 'bloqueado-motivo', texto: o.motivo }))
  return caja
}

/**
 * Pestañas de categoría.
 * @param {Array<{id:string,texto:string,icono?:string}>} lista
 * @param {(id:string)=>void} alCambiar
 * @returns {{nodo:HTMLElement, activar:(id:string)=>void, activa:()=>string}}
 */
export function pestañas (lista = [], alCambiar) {
  let actual = lista[0]?.id
  const botones = new Map()
  const nodo = el('div', { clase: 'pestañas', role: 'tablist' })

  const activar = (id, avisar = true) => {
    if (!botones.has(id)) return
    actual = id
    for (const [k, b] of botones) b.classList.toggle('activa', k === id)
    if (avisar) alCambiar?.(id)
  }

  for (const p of lista) {
    const b = el('button', {
      clase: 'pestaña', role: 'tab', type: 'button',
      texto: p.icono ? `${p.icono} ${p.texto}` : p.texto,
      onclick: () => activar(p.id)
    })
    botones.set(p.id, b)
    nodo.appendChild(b)
  }
  activar(actual, false)
  return { nodo, activar, activa: () => actual }
}

/* ===========================================================================
   Hoja (bottom sheet)
   =========================================================================== */

/** Pila de cierres abiertos: Escape y el botón atrás cierran el último. */
const abiertos = []

/** Apunta cuántas capas modales hay encima para soltar/volver a fijar el gesto del body. */
function marcarCapa (delta) {
  marcarCapa.n = Math.max(0, (marcarCapa.n || 0) + delta)
  document.body.classList.toggle('capa-abierta', marcarCapa.n > 0)
}

/**
 * Abre un panel que sube desde abajo. Se cierra arrastrando o tocando fuera.
 * @param {object} o { titulo, contenido, alCerrar, clase, pie, sinCerrar }
 * @returns {{cerrar:()=>void, cuerpo:HTMLElement, panel:HTMLElement, titulo:(t:string)=>void}}
 */
export function hoja (o = {}) {
  asegurar()
  const { titulo = '', contenido = null, alCerrar = null, clase = '', pie = null } = o

  const capa = el('div', { clase: 'capa-hoja' })
  const panel = el('section', { clase: ['hoja', clase], role: 'dialog', 'aria-modal': 'true' })
  const asa = el('div', { clase: 'hoja-asa' }, el('i'))
  const tituloNodo = el('h2', { clase: 'hoja-titulo', texto: titulo })
  const cerrarBtn = el('button', {
    clase: 'btn btn-fantasma btn-icono', type: 'button', 'aria-label': 'Cerrar', texto: '✕',
    onclick: () => cerrar()
  })
  const cabecera = el('header', { clase: 'hoja-cabecera' }, [tituloNodo, o.sinCerrar ? null : cerrarBtn])
  const cuerpo = el('div', { clase: 'hoja-cuerpo' }, contenido)

  panel.append(asa, cabecera, cuerpo)
  if (pie) panel.appendChild(el('footer', { clase: 'hoja-pie' }, pie))
  capa.appendChild(panel)
  raiz().appendChild(capa)
  marcarCapa(1)

  let cerrada = false
  function cerrar () {
    if (cerrada) return
    cerrada = true
    const i = abiertos.indexOf(cerrar); if (i >= 0) abiertos.splice(i, 1)
    marcarCapa(-1)
    capa.classList.add('cerrando')
    panel.style.transform = ''
    setTimeout(() => { capa.remove(); alCerrar?.() }, 200)
  }
  abiertos.push(cerrar)

  // tocar fuera del panel cierra
  capa.addEventListener('pointerdown', (e) => { if (e.target === capa) cerrar() })

  // arrastrar hacia abajo cierra
  let y0 = 0, dy = 0, arrastrando = false, t0 = 0
  const empezar = (e) => {
    if (e.button != null && e.button !== 0) return
    // capturar el puntero desde la cabecera se comería el clic del botón de cerrar
    if (e.target.closest && e.target.closest('button')) return
    arrastrando = true; y0 = e.clientY; dy = 0; t0 = performance.now()
    panel.classList.add('arrastrando'); panel.classList.remove('soltando')
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const mover = (e) => {
    if (!arrastrando) return
    dy = Math.max(0, e.clientY - y0)
    panel.style.transform = `translateY(${dy}px)`
  }
  const soltar = () => {
    if (!arrastrando) return
    arrastrando = false
    panel.classList.remove('arrastrando')
    const rapido = dy > 40 && (performance.now() - t0) < 300
    if (dy > panel.offsetHeight * 0.28 || dy > 120 || rapido) { cerrar(); return }
    panel.classList.add('soltando')
    panel.style.transform = 'translateY(0)'
    setTimeout(() => panel.classList.remove('soltando'), 240)
  }
  for (const zona of [asa, cabecera]) {
    zona.addEventListener('pointerdown', empezar)
    zona.addEventListener('pointermove', mover)
    zona.addEventListener('pointerup', soltar)
    zona.addEventListener('pointercancel', soltar)
  }

  return {
    cerrar,
    cuerpo,
    panel,
    titulo: (t) => { tituloNodo.textContent = t }
  }
}

/* ===========================================================================
   Toast y confirmar
   =========================================================================== */

const ICONO_TOAST = { info: '📜', bien: '✅', mal: '⚠️' }

/** Aviso flotante que se va solo. tipo: 'info' | 'bien' | 'mal'. */
export function toast (texto, tipo = 'info', ms = 2600) {
  asegurar()
  if (!capaToast || !capaToast.isConnected) {
    capaToast = el('div', { clase: 'capa-toast', 'aria-live': 'polite' })
    raiz().appendChild(capaToast)
  }
  const nodo = el('div', { clase: ['toast', `toast-${tipo}`] }, [
    el('i', { texto: ICONO_TOAST[tipo] || ICONO_TOAST.info }),
    el('span', { texto: String(texto ?? '') })
  ])
  const quitar = () => {
    if (nodo.classList.contains('cerrando')) return
    nodo.classList.add('cerrando')
    setTimeout(() => nodo.remove(), 200)
  }
  nodo.addEventListener('click', quitar)
  capaToast.appendChild(nodo)

  // más de tres apilados tapan el juego
  while (capaToast.children.length > 3) capaToast.firstChild.remove()

  setTimeout(quitar, ms)
  return quitar
}

/**
 * Pregunta de sí o no con dos botones grandes.
 * @param {string|object} texto o { titulo, texto, si, no, peligro }
 * @returns {Promise<boolean>}
 */
export function confirmar (texto, opciones = {}) {
  asegurar()
  const o = typeof texto === 'object' && texto !== null ? texto : { texto, ...opciones }
  const { titulo = '¿Seguro?', si = 'Sí', no = 'Cancelar', peligro = false } = o

  return new Promise((resolver) => {
    const capa = el('div', { clase: 'capa-dialogo' })
    let hecho = false
    const cerrar = (respuesta) => {
      if (hecho) return
      hecho = true
      const i = abiertos.indexOf(cancelar); if (i >= 0) abiertos.splice(i, 1)
      marcarCapa(-1)
      capa.classList.add('cerrando')
      setTimeout(() => { capa.remove(); resolver(respuesta) }, 160)
    }
    const cancelar = () => cerrar(false)

    const panel = el('div', { clase: 'panel dialogo', role: 'alertdialog', 'aria-modal': 'true' }, [
      el('div', { clase: 'panel-cabecera' }, titulo),
      el('p', { clase: 'dialogo-texto', texto: o.texto || '' }),
      el('div', { clase: 'dialogo-botones' }, [
        el('button', { clase: 'btn btn-piedra', type: 'button', texto: no, onclick: cancelar }),
        el('button', { clase: ['btn', peligro ? 'btn-peligro' : 'btn-oro'], type: 'button', texto: si, onclick: () => cerrar(true) })
      ])
    ])

    capa.appendChild(panel)
    capa.addEventListener('pointerdown', (e) => { if (e.target === capa) cancelar() })
    raiz().appendChild(capa)
    marcarCapa(1)
    abiertos.push(cancelar)
  })
}

// Los estilos deben existir aunque main.js no llame a este módulo:
// cualquier panel que importe una ayuda ya se encuentra la interfaz vestida.
if (typeof document !== 'undefined') init()
