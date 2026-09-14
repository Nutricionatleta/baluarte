const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./quests-BWBqy1mI.js","./index-C7hnj_QW.js","./buildings-CkOd47Gj.js","./resources-mpj7Qe2i.js"])))=>i.map(i=>d[i]);
import{_,e as x,E as v,b as z,I as E}from"./index-C7hnj_QW.js";import{E as T,U as D}from"./buildings-CkOd47Gj.js";import{p as O,e as o,h as L,v as P,b,f as d,t as k}from"./styles-Bz4tz78E.js";let y=null;function h(e,a,...l){const t=y?.[e];if(typeof t!="function")return a;try{return t(...l)}catch(p){return console.warn(`[encargos] ${e}()`,p),a}}const N=`
/* ---- el encargo de AHORA: lo único grande de la pantalla ---- */
.eh {
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px;
  background-image: linear-gradient(180deg, var(--pergamino-claro), var(--pergamino));
  border: 2px solid rgba(90, 58, 34, .55); border-radius: var(--r-m);
  box-shadow: var(--sombra-suave);
}
/* cumplido: borde de oro, para que el ojo vaya solo al botón de cobrar */
.eh.listo { border-color: var(--oro-oscuro); box-shadow: var(--sombra-suave), 0 0 0 3px rgba(212, 164, 55, .45); }
.eh-cab { display: flex; align-items: center; gap: 11px; }
.eh-cab > i { flex: none; font-style: normal; font-size: 2.1em; line-height: 1; }
.eh-titulo { font-weight: 800; font-size: 1.28em; line-height: 1.15; letter-spacing: -.01em; }
.eh-voz { margin-top: 3px; font-size: .78em; line-height: 1.3; color: var(--tinta-suave); font-style: italic; }
.eh-marca { font-size: 1.05em; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--madera-oscura); }
.eh-falta { font-size: .84em; font-weight: 700; color: var(--madera-oscura); }
.eh-premio { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.eh-premio > small { font-size: .74em; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--tinta-suave); }
/* el botón manda en la tarjeta: ancho entero y 58 px de alto */
.eh-btn { width: 100%; min-height: 58px; font-size: 1.05em; }
/* llama la atención con luz, NO moviéndose: un botón que baila se falla al tocarlo */
.eh-btn.pulsa { animation: brilla-cobrar 1.6s var(--curva) infinite; }
@keyframes brilla-cobrar {
  0%, 100% { box-shadow: var(--brillo), 0 4px 0 var(--oro-oscuro), 0 6px 12px rgba(26, 16, 8, .3); }
  50% { box-shadow: var(--brillo), 0 4px 0 var(--oro-oscuro), 0 0 0 5px rgba(242, 200, 92, .5); }
}
@media (prefers-reduced-motion: reduce) { .eh-btn.pulsa { animation: none; } }

/* lista de comprobación, solo si el encargo pide varias cosas */
.eh-pasos { display: flex; flex-direction: column; gap: 3px; }
.eh-paso { font-size: .84em; font-weight: 700; color: var(--tinta-suave); }
.eh-paso.ok { color: var(--verde-oscuro); }

/* ---- filas discretas: lo que viene después y las tareas del día ---- */
.eq { display: flex; align-items: center; gap: 10px; padding: 8px 10px; }
.eq + .eq { border-top: 1px dashed rgba(90, 58, 34, .3); }
.eq > i { flex: none; font-style: normal; font-size: 1.3em; line-height: 1; }
.eq .crece { display: flex; flex-direction: column; gap: 4px; }
.eq-nombre { font-weight: 800; font-size: .92em; line-height: 1.2; }
.eq-num { font-size: .76em; font-weight: 800; color: var(--tinta-suave); font-variant-numeric: tabular-nums; }
.eq .barra-progreso { height: 8px; }
.eq-btn { flex: none; min-width: var(--toque); min-height: var(--toque); padding: 8px 12px; font-size: .88em; }
.eq.hecha { opacity: .55; }
.eq.hecha .eq-nombre { text-decoration: line-through; }

/* la cola de la campaña: números grises, sin adornos */
.eq-cola { display: flex; align-items: center; gap: 9px; padding: 6px 10px; font-size: .84em; color: var(--tinta-suave); }
.eq-cola + .eq-cola { border-top: 1px dashed rgba(90, 58, 34, .25); }
.eq-cola > b { flex: none; font-variant-numeric: tabular-nums; opacity: .7; }

/* cabecera de la racha: una línea, no un bloque */
.racha-caja { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
.racha-caja > i { font-style: normal; font-size: 1.8em; line-height: 1; }
.racha-num { font-size: 1.05em; font-weight: 800; line-height: 1.15; }

/* logros: dos por fila no caben en móvil, así que van en lista apretada */
.logro { display: flex; align-items: center; gap: 9px; padding: 8px 10px; }
.logro + .logro { border-top: 1px dashed rgba(90, 58, 34, .3); }
.logro > i { flex: none; font-style: normal; font-size: 1.35em; line-height: 1; }
.logro .crece { display: flex; flex-direction: column; gap: 3px; }
.logro-nombre { font-weight: 800; font-size: .92em; line-height: 1.15; }
.logro-desc { font-size: .74em; font-weight: 700; color: var(--tinta-suave); }
.logro .barra-progreso { height: 8px; }
.logro-escalon {
  flex: none; min-width: 42px; text-align: center;
  font-size: .78em; font-weight: 800; font-variant-numeric: tabular-nums;
  color: var(--madera);
}
.logro.completo .logro-escalon { color: var(--verde-oscuro); }
`;function q(){if(document.getElementById("estilos-encargos"))return;const e=document.createElement("style");e.id="estilos-encargos",e.textContent=N,document.head.appendChild(e)}const M={aldeanos:"🧑‍🌾",explorar:"🗺️",expedicion:"🐎",asalto:"🗡️",defensa:"🛡️",edad:"🏰",tecnologia:"📜",tecnologias:"📜",investigar:"📜",obras:"🔨",mejoras:"⬆️",nuevoAldeano:"🧑‍🌾",entrenar:"⚔️",botin:"💰"};function A(e){if(e.listo)return"🎁";const a=e.objetivo||{};return a.tipo==="recolectar"?E[a.que]||"🪵":a.tipo==="construir"||a.tipo==="nivel"?T[a.que]?.icono||"🔨":a.tipo==="tropas"?D[a.que]?.icono||"⚔️":M[a.tipo]||(e.clase==="diaria"?"🗓️":"📜")}function U(e={}){const a=[];for(const[l,t]of Object.entries(e.recursos||{}))t>0&&a.push(`${E[l]||""} ${d(t)}`);return e.gemas>0&&a.push(`${E.gemas} ${e.gemas}`),e.xp>0&&a.push(`⭐ ${d(e.xp)} XP`),a}function V(e){const a=e.progreso||{hecho:0,total:1},l=e.objetivo||{},t=Math.max(0,a.total-a.hecho);return l.tipo==="nivel"?`Va por el nivel ${d(a.hecho)}. Hay que llegar al ${d(a.total)}.`:a.total<=1?"Todavía sin hacer.":`Te ${t===1?"falta":"faltan"} ${d(t)}${e.unidad?` ${e.unidad}`:""}.`}function H(){const e=z.state?.quests?.diarias;return Array.isArray(e)?{total:e.length,cobradas:e.filter(a=>a&&a.reclamada).length}:{total:0,cobradas:0}}function w(e){if(!e?.panel){s?.cerrar();return}s?.cerrar(),x.emit(v.UI_PANEL,{panel:e.panel,datos:e.datos||null})}let s=null,g=null,u=null,m="encargos",$=0;function F(e={}){return s?(e?.solapa&&(m=e.solapa,f()),s):(q(),m=e?.solapa||"encargos",g=O([{id:"encargos",texto:"Encargos",icono:"📜"},{id:"diarias",texto:"Diarias",icono:"🗓️"},{id:"logros",texto:"Logros",icono:"🏅"}],a=>{m=a,f()}),u=o("div",{clase:"col"}),s=L({titulo:"📜 El mayordomo",contenido:[g.nodo,u],alCerrar:()=>{clearInterval($),$=0,s=null,g=null,u=null}}),g.activar(m,!1),f(),$=setInterval(()=>{s&&m==="diarias"&&f()},1e3),s)}function f(){if(!(!s||!u)){if(g?.activar(m,!1),P(u),!y){u.appendChild(o("div",{clase:"aviso aviso-mal"},[o("i",{texto:"⚠️"}),o("span",{texto:"El mayordomo no responde: los encargos no están disponibles."})]));return}m==="encargos"?W(u):m==="diarias"?X(u):B(u)}}function I(e,a){if(!h("reclamar",!1,e)){k("Eso todavía no está cumplido","mal");return}a?.classList.remove("destello"),a?.offsetWidth,a?.classList.add("destello"),x.emit(v.SFX,{nombre:"monedas"}),setTimeout(f,240)}function Q(e){const a=e.progreso||{hecho:0,total:1},l=a.total>0?Math.min(100,a.hecho/a.total*100):0,t=o("div",{clase:["eh",e.listo&&"listo"]});t.appendChild(o("div",{clase:"eh-cab"},[o("i",{texto:A(e)}),o("div",{clase:"crece"},[o("div",{clase:"eh-titulo",texto:e.titulo||"Encargo"}),e.texto?o("div",{clase:"eh-voz",texto:e.texto}):null])])),Array.isArray(e.pasos)&&e.pasos.length&&t.appendChild(o("div",{clase:"eh-pasos"},e.pasos.map(n=>o("div",{clase:["eh-paso",n.hecho&&"ok"],texto:`${n.hecho?"✅":"⬜"} ${n.texto}`})))),a.total>1&&t.appendChild(o("div",{clase:"col",estilo:{gap:"5px"}},[o("div",{clase:"fila fila-sep"},[o("span",{clase:"eh-falta",texto:V(e)}),o("span",{clase:"eh-marca",texto:`${d(a.hecho)}/${d(a.total)}`})]),b(l,{gorda:!0,tono:e.listo?"bien":""}).nodo]));const p=U(e.recompensa);return p.length&&t.appendChild(o("div",{clase:"eh-premio"},[o("small",{texto:"Te dan"}),...p.map(n=>o("span",{clase:"chip chip-oro",texto:n}))])),e.listo?t.appendChild(o("button",{clase:"btn btn-oro eh-btn pulsa",type:"button",texto:"🎁 Cobrar recompensa",onclick:()=>I(e.id,t)})):e.ir?.panel&&t.appendChild(o("button",{clase:"btn btn-piedra eh-btn",type:"button",texto:e.ir.texto||"Ir a hacerlo",onclick:()=>w(e.ir)})),t}function R(){const e=h("siguienteAccion",null)||{texto:h("siguienteConsejo",""),ir:null},a=o("div",{clase:"eh"});return a.appendChild(o("div",{clase:"eh-cab"},[o("i",{texto:"🎩"}),o("div",{clase:"crece"},[o("div",{clase:"eh-titulo",texto:"Qué hago ahora"}),o("div",{clase:"eh-voz",estilo:{fontSize:".88em",fontStyle:"normal"},texto:e.texto||"Seguid construyendo, mi señor."})])])),e.ir?.panel&&a.appendChild(o("button",{clase:"btn btn-oro eh-btn",type:"button",texto:e.ir.texto||"Vamos allá",onclick:()=>w(e.ir)})),a}function W(e){const a=h("activas",[]).filter(n=>n.clase==="encargo"),l=a.find(n=>n.listo)||a[0];e.appendChild(l?Q(l):R()),l||e.appendChild(o("div",{clase:"panel col",estilo:{textAlign:"center"}},[o("span",{clase:"icono-gr",texto:"👑"}),o("b",{texto:"No queda nada por encargar"}),o("div",{clase:"tenue pequeño",texto:"Habéis terminado la cadena del mayordomo."})]));for(const n of a)n!==l&&e.appendChild(S(n));const t=h("proximos",[],3);t.length&&(e.appendChild(o("div",{clase:"tenue pequeño",estilo:{marginTop:"4px",fontWeight:"800"},texto:"Y después…"})),e.appendChild(o("div",{clase:"panel col",estilo:{gap:"0",padding:"4px 0"}},t.map((n,c)=>o("div",{clase:"eq-cola"},[o("b",{texto:`${c+1}.`}),o("span",{clase:"crece",texto:n.titulo})])))));const p=h("progreso",0);e.appendChild(o("div",{clase:"stats"},[o("div",{clase:"stat"},[o("small",{texto:"Partida"}),o("b",{texto:`${p} %`})]),o("div",{clase:"stat"},[o("small",{texto:"Encargos hechos"}),o("b",{texto:String((z.state?.quests?.completadas||[]).length)})])]))}function S(e){const a=e.progreso||{hecho:0,total:1},l=a.total>0?Math.min(100,a.hecho/a.total*100):0,t=o("div",{clase:"eq"});return t.append(o("i",{texto:A(e)}),o("div",{clase:"crece"},[o("div",{clase:"eq-nombre",texto:e.titulo}),a.total>1?b(l,{tono:e.listo?"bien":""}).nodo:null,o("div",{clase:"eq-num",texto:a.total>1?`${d(a.hecho)} de ${d(a.total)}`:e.listo?"Cumplida":"Sin empezar"})])),e.listo?t.appendChild(o("button",{clase:"btn btn-oro eq-btn",type:"button",texto:"🎁 Cobrar",onclick:()=>I(e.id,t)})):e.ir?.panel&&t.appendChild(o("button",{clase:"btn btn-fantasma eq-btn",type:"button","aria-label":`Ir a: ${e.titulo}`,texto:"▶",onclick:()=>w(e.ir)})),t}function X(e){const a=h("racha",{dias:0,mejor:0,multiplicador:1}),l=h("activas",[]).filter(c=>c.clase==="diaria"),t=H(),p=c=>String(Math.round(c*100)/100).replace(".",",");e.appendChild(o("div",{clase:"panel racha-caja"},[o("i",{texto:"🔥"}),o("div",{clase:"crece"},[o("div",{clase:"racha-num",texto:a.dias===1?"1 día seguido":`${a.dias} días seguidos`}),o("div",{clase:"tenue pequeño",texto:`Gemas de hoy ×${p(a.multiplicador)} · mejor racha ${a.mejor}`})])])),e.appendChild(o("div",{clase:"titular",texto:`Hoy · ${t.cobradas} de ${t.total||3} cobradas`}));const n=o("div",{clase:"panel col",estilo:{gap:"0",padding:"4px 0"}});for(const c of l)n.appendChild(S(c));for(let c=0;c<t.cobradas;c++)n.appendChild(o("div",{clase:"eq hecha"},[o("i",{texto:"✅"}),o("div",{clase:"crece"},[o("div",{clase:"eq-nombre",texto:"Tarea cobrada"})])]));n.children.length&&e.appendChild(n),l.length||e.appendChild(o("div",{clase:"aviso aviso-bien"},[o("i",{texto:"✅"}),o("span",{texto:"Las tres del día, hechas. Vuelve mañana: la racha sube y las gemas también."})]))}function B(e){const a=h("logros",[]),l=h("progreso",0),t=a.reduce((i,r)=>i+(r.escalon||0),0),p=a.reduce((i,r)=>i+(r.escalones||0),0),n=b(l,{gorda:!0,tono:"bien"});e.appendChild(o("div",{clase:"panel col"},[o("div",{clase:"fila fila-sep"},[o("b",{texto:"🏅 Partida completada"}),o("span",{clase:"num",texto:`${l} %`})]),n.nodo,o("div",{clase:"tenue pequeño",texto:`${t} de ${p} escalones. Se cobran solos.`})]));const c=[...a].sort((i,r)=>{if(i.completo!==r.completo)return i.completo?1:-1;const C=i.progreso.total?i.progreso.hecho/i.progreso.total:0;return(r.progreso.total?r.progreso.hecho/r.progreso.total:0)-C}),j=o("div",{clase:"panel col",estilo:{gap:"0",padding:"4px 0"}});for(const i of c){const r=i.progreso||{hecho:0,total:1},C=r.total>0?Math.min(100,r.hecho/r.total*100):100;j.appendChild(o("div",{clase:["logro",i.completo&&"completo"]},[o("i",{texto:i.completo?"🏆":i.escalon>0?"🏅":"🔓"}),o("div",{clase:"crece"},[o("div",{clase:"logro-nombre",texto:i.nombre}),o("div",{clase:"logro-desc",texto:i.completo?`${i.desc} · completo`:`${i.desc}: ${d(r.hecho)} de ${d(r.total)}`}),i.completo?null:b(C).nodo]),o("span",{clase:"logro-escalon",texto:`${i.escalon}/${i.escalones}`})]))}e.appendChild(j)}async function G(){q();try{y=await _(()=>import("./quests-BWBqy1mI.js"),__vite__mapDeps([0,1,2,3]),import.meta.url)}catch(e){console.warn("[encargos] sin sim/quests.js:",e?.message||e),y=null}x.on(v.UI_PANEL,(e={})=>{const a=e?.panel;a==="encargos"||a==="quests"||a==="misiones"?F(e.datos):s&&s.cerrar()}),x.on(v.QUEST_COMPLETED,()=>{s&&f()}),x.on(v.STATE_LOADED,()=>{s&&f()})}const ee={init:G};export{ee as default,G as init};
