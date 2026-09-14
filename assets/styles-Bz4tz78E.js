import{b as O,I as S,e as U,E as F}from"./index-C7hnj_QW.js";const H=`
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
`;let j=!1,f=null;function k(){if(!j){if(j=!0,!document.getElementById("estilos-baluarte")){const a=document.createElement("style");a.id="estilos-baluarte",a.textContent=H,document.head.appendChild(a)}U.on(F.UI_TOAST,a=>{a&&X(a.texto??String(a),a.tipo)}),document.addEventListener("keydown",a=>{if(a.key!=="Escape")return;const e=g[g.length-1];e&&(a.preventDefault(),e())})}}function z(){j||k()}function C(){return document.getElementById("hud")||document.body}function i(a,e,n){const r=document.createElement(a);e!=null&&(Array.isArray(e)||typeof e=="string"||typeof e=="number"||e instanceof Node)&&(n=e,e=null);for(const[o,t]of Object.entries(e||{}))t==null||t===!1||(o==="clase"||o==="class"?r.className=Array.isArray(t)?t.filter(Boolean).join(" "):String(t):o==="texto"?r.textContent=String(t):o==="html"?r.innerHTML=String(t):o==="estilo"||o==="style"?typeof t=="string"?r.style.cssText=t:Object.assign(r.style,t):o==="datos"?Object.assign(r.dataset,t):o==="hijos"?n=n??t:o==="valor"?r.value=t:o.startsWith("on")&&typeof t=="function"?r.addEventListener(o.slice(2).toLowerCase(),t):t===!0?r.setAttribute(o,""):r.setAttribute(o,String(t)));return L(r,n),r}function L(a,e){if(e==null||e===!1)return a;if(Array.isArray(e)){for(const n of e)L(a,n);return a}return a.appendChild(e instanceof Node?e:document.createTextNode(String(e))),a}function W(a){if(a)for(;a.firstChild;)a.removeChild(a.firstChild);return a}function T(a){const e=Number(a);if(!isFinite(e))return"0";const n=e<0?"-":"";let r=Math.abs(e);const o=["","K","M","MM"];let t=0;for(;r>=1e3&&t<o.length-1;)r/=1e3,t++;let s=t===0?0:r<100?1:0,l=r.toFixed(s);return parseFloat(l)>=1e3&&t<o.length-1&&(r/=1e3,t++,s=1,l=r.toFixed(s)),s>0&&l.endsWith(".0")&&(l=l.slice(0,-2)),n+l.replace(".",",")+o[t]}function A(a){let e=Math.max(0,Math.round(Number(a)||0));const n=Math.floor(e/86400);e-=n*86400;const r=Math.floor(e/3600);e-=r*3600;const o=Math.floor(e/60);return e-=o*60,n>0?r>0?`${n}d ${r}h`:`${n}d`:r>0?o>0?`${r}h ${o}m`:`${r}h`:o>0?e>0?`${o}m ${e}s`:`${o}m`:`${e}s`}const E=a=>String(a).replace(/[&<>"]/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[e]);function Y(a,e){if(!a)return"";const n=e||O.state?.recursos||{},r=[];for(const[o,t]of Object.entries(a)){if(!t)continue;const s=S[o]||(o==="tiempo"?S.tiempo:"•"),l=o==="tiempo"?A(t):T(t),d=o!=="tiempo"&&Number(n[o]||0)<Number(t);r.push(`<span class="coste-item${d?" no-alcanzable":""}" title="${E(o)}"><i>${s}</i>${E(l)}</span>`)}return`<span class="coste">${r.join("")}</span>`}function I(a,e){const n=e||O.state?.recursos||{};for(const[r,o]of Object.entries(a||{}))if(!(r==="tiempo"||!o)&&Number(n[r]||0)<Number(o))return!1;return!0}function D(a,e="latido"){a&&(a.classList.remove(e),a.offsetWidth,a.classList.add(e),setTimeout(()=>a.classList.remove(e),420))}function R(a,e,n={}){const{tono:r="",clase:o="",...t}=n,s=i("span",{clase:["chip",r&&`chip-${r}`,o],...t});a&&s.appendChild(i("i",{texto:a}));const l=i("span",{clase:"chip-valor",texto:e==null?"":String(e)});return s.appendChild(l),s.valor=l,s}function B(a,e={}){const{suelto:n=!1,clase:r=""}=e;return i("span",{clase:["badge",n&&"badge-suelto",r],texto:T(a)})}function K(a=0,e={}){const{tono:n="",gorda:r=!1,clase:o=""}=e,t=i("i"),s=i("div",{clase:["barra-progreso",n,r&&"gorda",o],role:"progressbar"},t),l=d=>{const p=Math.max(0,Math.min(100,Number(d)||0));t.style.width=`${p}%`,s.setAttribute("aria-valuenow",Math.round(p))};return l(a),{nodo:s,fijar:l}}function V(a={}){const e=a.coste?I(a.coste,a.recursos):!0,n=i("div",{clase:["tarjeta",a.fila&&"tarjeta-fila",!e&&!a.bloqueado&&"no-alcanzable",a.bloqueado&&"bloqueado",a.clase]}),r=i("div",{clase:"tarjeta-cuerpo col",estilo:{gap:"4px"}},[i("div",{clase:"tarjeta-nombre",texto:a.nombre||""}),a.detalle?i("div",{clase:"tarjeta-detalle",texto:a.detalle}):null,a.coste?i("div",{clase:"tarjeta-coste",html:Y(a.coste,a.recursos)}):null]);return n.appendChild(i("div",{clase:"tarjeta-cabeza"},[a.icono?i("div",{clase:"tarjeta-icono",texto:a.icono}):null,r])),a.textoBoton&&n.appendChild(i("button",{clase:["btn",a.tonoBoton?`btn-${a.tonoBoton}`:"btn-oro"],texto:a.textoBoton,disabled:!e||a.bloqueado||a.desactivado,onclick:o=>{o.currentTarget.classList.remove("pop"),o.currentTarget.offsetWidth,o.currentTarget.classList.add("pop"),a.alPulsar?.(o)}})),a.aviso!=null&&n.appendChild(B(a.aviso)),a.bloqueado&&a.motivo&&n.appendChild(i("div",{clase:"bloqueado-motivo",texto:a.motivo})),n}function G(a=[],e){let n=a[0]?.id;const r=new Map,o=i("div",{clase:"pestañas",role:"tablist"}),t=(s,l=!0)=>{if(r.has(s)){n=s;for(const[d,p]of r)p.classList.toggle("activa",d===s);l&&e?.(s)}};for(const s of a){const l=i("button",{clase:"pestaña",role:"tab",type:"button",texto:s.icono?`${s.icono} ${s.texto}`:s.texto,onclick:()=>t(s.id)});r.set(s.id,l),o.appendChild(l)}return t(n,!1),{nodo:o,activar:t,activa:()=>n}}const g=[];function b(a){b.n=Math.max(0,(b.n||0)+a),document.body.classList.toggle("capa-abierta",b.n>0)}function J(a={}){z();const{titulo:e="",contenido:n=null,alCerrar:r=null,clase:o="",pie:t=null}=a,s=i("div",{clase:"capa-hoja"}),l=i("section",{clase:["hoja",o],role:"dialog","aria-modal":"true"}),d=i("div",{clase:"hoja-asa"},i("i")),p=i("h2",{clase:"hoja-titulo",texto:e}),h=i("button",{clase:"btn btn-fantasma btn-icono",type:"button","aria-label":"Cerrar",texto:"✕",onclick:()=>m()}),u=i("header",{clase:"hoja-cabecera"},[p,a.sinCerrar?null:h]),y=i("div",{clase:"hoja-cuerpo"},n);l.append(d,u,y),t&&l.appendChild(i("footer",{clase:"hoja-pie"},t)),s.appendChild(l),C().appendChild(s),b(1);let v=!1;function m(){if(v)return;v=!0;const c=g.indexOf(m);c>=0&&g.splice(c,1),b(-1),s.classList.add("cerrando"),l.style.transform="",setTimeout(()=>{s.remove(),r?.()},200)}g.push(m),s.addEventListener("pointerdown",c=>{c.target===s&&m()});let q=0,x=0,w=!1,$=0;const _=c=>{c.button!=null&&c.button!==0||c.target.closest&&c.target.closest("button")||(w=!0,q=c.clientY,x=0,$=performance.now(),l.classList.add("arrastrando"),l.classList.remove("soltando"),c.currentTarget.setPointerCapture?.(c.pointerId))},P=c=>{w&&(x=Math.max(0,c.clientY-q),l.style.transform=`translateY(${x}px)`)},M=()=>{if(!w)return;w=!1,l.classList.remove("arrastrando");const c=x>40&&performance.now()-$<300;if(x>l.offsetHeight*.28||x>120||c){m();return}l.classList.add("soltando"),l.style.transform="translateY(0)",setTimeout(()=>l.classList.remove("soltando"),240)};for(const c of[d,u])c.addEventListener("pointerdown",_),c.addEventListener("pointermove",P),c.addEventListener("pointerup",M),c.addEventListener("pointercancel",M);return{cerrar:m,cuerpo:y,panel:l,titulo:c=>{p.textContent=c}}}const N={info:"📜",bien:"✅",mal:"⚠️"};function X(a,e="info",n=2600){z(),(!f||!f.isConnected)&&(f=i("div",{clase:"capa-toast","aria-live":"polite"}),C().appendChild(f));const r=i("div",{clase:["toast",`toast-${e}`]},[i("i",{texto:N[e]||N.info}),i("span",{texto:String(a??"")})]),o=()=>{r.classList.contains("cerrando")||(r.classList.add("cerrando"),setTimeout(()=>r.remove(),200))};for(r.addEventListener("click",o),f.appendChild(r);f.children.length>2;)f.firstChild.remove();return setTimeout(o,n),o}function Q(a,e={}){z();const n=typeof a=="object"&&a!==null?a:{texto:a,...e},{titulo:r="¿Seguro?",si:o="Sí",no:t="Cancelar",peligro:s=!1}=n;return new Promise(l=>{const d=i("div",{clase:"capa-dialogo"});let p=!1;const h=v=>{if(p)return;p=!0;const m=g.indexOf(u);m>=0&&g.splice(m,1),b(-1),d.classList.add("cerrando"),setTimeout(()=>{d.remove(),l(v)},160)},u=()=>h(!1),y=i("div",{clase:"panel dialogo",role:"alertdialog","aria-modal":"true"},[i("div",{clase:"panel-cabecera"},r),i("p",{clase:"dialogo-texto",texto:n.texto||""}),i("div",{clase:"dialogo-botones"},[i("button",{clase:"btn btn-piedra",type:"button",texto:t,onclick:u}),i("button",{clase:["btn",s?"btn-peligro":"btn-oro"],type:"button",texto:o,onclick:()=>h(!0)})])]);d.appendChild(y),d.addEventListener("pointerdown",v=>{v.target===d&&u()}),C().appendChild(d),b(1),g.push(u)})}typeof document<"u"&&k();const aa=Object.freeze(Object.defineProperty({__proto__:null,alcanza:I,añadir:L,badge:B,barraProgreso:K,chip:R,confirmar:Q,costeHTML:Y,el:i,formatoNumero:T,formatoTiempo:A,hoja:J,init:k,latir:D,pestañas:G,tarjeta:V,toast:X,vaciar:W},Symbol.toStringTag,{value:"Module"}));export{aa as U,A as a,K as b,Y as c,Q as d,i as e,T as f,R as g,J as h,I as i,D as l,G as p,X as t,W as v};
