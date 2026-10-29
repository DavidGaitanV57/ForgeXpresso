const ICSEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
const ICX = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
const ICSND = (id: string, wave: string) =>
  `<button class="iconbtn on" id="${id}" type="button" title="Sonido" aria-label="Sonido"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path ${wave} d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg></button>`;

export const MARKUP = `
<section class="intro" id="intro">
  <div class="intro-in" id="introIn">
    <span class="mascot mark" aria-hidden="true"></span>
    <h1>¿Qué juego quieres <span>forjar</span> hoy?</h1>
    <p class="sub">Descríbelo con tus palabras. Un equipo de agentes diseña el juego, dibuja el arte, compone la música y escribe el código para que lo juegues en minutos.</p>
    <form class="ask" id="askForm" autocomplete="off">
      <div class="agent"><i id="agentDot"></i><span id="agentTxt">Director de juego · listo</span></div>
      <textarea id="askIn" rows="3" placeholder="Ej: un plataformero de un zorro ninja que cruza una ciudad neón saltando entre azoteas" aria-label="Describe tu juego"></textarea>
      <div class="ask-bar">
        <div class="dimsw" role="group" aria-label="Dimensión"><button type="button" data-d="2d" class="on">2D</button><button type="button" data-d="2.5d">2.5D</button><button type="button" data-d="3d">3D</button></div>
        <div class="dimsw prov" role="group" aria-label="Imágenes" id="provSw"><button type="button" data-p="openai">OpenAI</button><button type="button" data-p="minimax">MiniMax</button></div>
        <span class="sp"></span>
        <button class="send" id="askSend" type="submit" aria-label="Crear juego" disabled>${ICSEND}</button>
      </div>
    </form>
    <div class="keys-status" id="keysStatus"></div>
    <div class="sugs" id="sugs"></div>
    <div class="projects" id="projects" hidden>
      <div class="lbl">Tus juegos</div>
      <div class="proj-grid" id="projGrid"></div>
    </div>
  </div>
</section>

<section class="loader" id="loader" hidden aria-live="polite">
  <canvas id="embers" aria-hidden="true"></canvas>
  <div class="ld-in">
    <div class="ld-head" style="--d:0">
      <div class="ld-mark"><span class="ring"></span><span class="ring r2"></span><span class="mascot" aria-hidden="true"></span></div>
      <div style="min-width:0;flex:1"><div class="ld-eyebrow"><i></i><span id="ldEyebrow">Los agentes están forjando tu juego</span></div><h2 class="ld-title" id="ldTitle"></h2><p class="ld-idea" id="ldIdea"></p></div>
      <button class="btn small ghost" id="ldBack" type="button">← Inicio</button>
    </div>
    <div class="ld-grid" style="--d:.15">
      <div class="ld-preview"><div class="ld-gallery" id="ldGallery"></div><div class="ld-scan"></div><span class="ld-tag" id="ldTag"><i></i><span>Preparando</span></span></div>
      <ol class="ld-steps" id="ldSteps"></ol>
    </div>
    <div class="ld-error" id="ldError" hidden></div>
    <div class="ld-report" id="ldReport" style="--d:.25" hidden></div>
    <div class="ld-assets" id="ldAssets" style="--d:.3"></div>
    <div class="ld-prog" style="--d:.4"><div class="ld-bar"><i id="ldBar"></i></div><span class="mono" id="ldPct">0%</span></div>
    <div class="ld-tip" id="ldTip" style="--d:.5"></div>
  </div>
</section>

<div class="app" id="studio" hidden>
  <header class="top asm from-top" style="--asd:.6s">
    <button class="brand" id="homeBtn" type="button" title="Volver al inicio" aria-label="Volver al inicio">
      <span class="mascot" aria-hidden="true"></span>
      forge <span class="light">Light</span>
    </button>
    <span class="proj" id="projName"></span>
    <span class="spacer"></span>
    <button class="iconbtn help" id="helpBtn" type="button" title="Ver recorrido" aria-label="Ver recorrido de ayuda">?</button>
    <button class="btn ghost" id="proBtn" type="button">Abrir en Forge Pro</button>
    <span class="vsep" aria-hidden="true"></span>
    <button class="btn export" id="exportBtn" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>Exportar</button>
  </header>

  <section class="st-head asm from-top" aria-live="polite" style="--asd:.7s">
    <div class="ld-mark"><span class="ring"></span><span class="ring r2"></span><span class="mascot" aria-hidden="true"></span></div>
    <div class="st-ttl">
      <div class="ld-eyebrow"><i></i><span id="bnEyebrow"></span></div>
      <h1 class="st-title"><span class="hl" id="stHero"></span></h1>
      <p class="st-idea" id="stIdea"></p>
    </div>
    <button class="btn play-cta" id="playBtn" type="button"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>Jugar</button>
  </section>

  <div class="st-grid">
    <div class="st-left">
      <div class="st-preview">
        <div class="viewport" id="vp" aria-label="Vista previa jugable">
          <iframe id="game" title="Juego" sandbox="allow-scripts allow-pointer-lock" allow="autoplay; gamepad; fullscreen"></iframe>
          <div class="vp-busy" id="vpBusy" hidden><span class="mascot" aria-hidden="true"></span><b id="vpBusyT">Forge está aplicando tus cambios…</b><small id="vpBusyS"></small></div>
          <div class="vp-err" id="vpErr" hidden></div>
          <button type="button" class="vp-expand" id="vpExpand" title="Pantalla completa" aria-label="Jugar en pantalla completa"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
        </div>
      </div>
      <div class="st-tools asm from-under" style="--asd:0s">
        <span class="pill v" id="loopPill"></span>
        <span class="pill" id="verPill"></span>
        <div class="tools">
          <button class="iconbtn" id="cineBtn" type="button" title="Ver cinemática" aria-label="Ver cinemática"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="9" width="18" height="12" rx="2"/><path d="M3 9l2.5-5 3.5 1-2.5 5M10 6l3.5 1L11 12M16.5 7.5l3.5 1L18 12"/></svg></button>
          <button class="iconbtn" id="reloadBtn" type="button" title="Recargar juego" aria-label="Recargar juego"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>
          ${ICSND("sndBtn", 'id="sndWave"')}
        </div>
      </div>
      <section class="dock asm from-under" id="dock" style="--asd:.08s" aria-label="Chat con Forge">
        <div class="dock-logw"><div class="dock-log" id="dockLog"></div><div class="dock-rail" id="dockRail" hidden><i id="dockThumb"></i></div></div>
        <div class="dock-hint" id="dockHint" hidden></div>
        <form class="dock-in" id="dockForm" autocomplete="off"><span class="mascot" aria-hidden="true"></span><input id="dockIn" placeholder="Pide un cambio a Forge con tus palabras…" aria-label="Pide un cambio al juego"><button type="submit" aria-label="Enviar">${ICSEND}</button></form>
      </section>
      <section class="st-assets asm from-under" style="--asd:.3s">
        <div class="st-sec"><span class="ld-eyebrow"><i style="background:var(--violet);box-shadow:0 0 8px var(--violet)"></i>Recursos del juego</span><span class="muted-s">Marca lo que te gusta, regenéralo o sube el tuyo</span></div>
        <div class="assets" id="assets"></div>
      </section>
    </div>
    <aside class="flow asm from-left" id="flow" aria-label="Panel de creación" style="--asd:.45s"></aside>
  </div>
</div>

<section class="pro" id="pro" hidden aria-label="Forge Pro">
  <canvas id="proSky" aria-hidden="true"></canvas>
  <header class="pro-top">
    <button type="button" class="pro-brand" id="proHome" title="Volver a mi juego"><span class="mascot" aria-hidden="true"></span><span><b>Forge</b><small>AI GAME PIPELINE</small></span></button>
    <span class="sp"></span>
    <button type="button" class="pro-link" id="proWhat">Qué hace</button>
    <button type="button" class="btn small" id="proBack">← Volver a mi juego</button>
    <button type="button" class="btn small primary-s" id="proSign">Iniciar sesión</button>
  </header>
  <div class="pro-hero">
    <div class="pro-copy">
      <span class="pro-pill" style="--d:.05"><i></i>FORGE PRO · PRODUCCIÓN DE JUEGOS CON IA</span>
      <h1 style="--d:.12">Del concepto a un <span class="grad">vertical slice</span> jugable.</h1>
      <p style="--d:.2">Forge orquesta la IA en un lienzo visual: lleva una idea de juego más allá del prototipo hacia <b>documentos de diseño, arte y un vertical slice jugable</b> del juego real.</p>
      <div class="pro-cta" style="--d:.28"><button type="button" class="btn primary-s pro-big" id="proSign2">Iniciar sesión →</button><button type="button" class="btn pro-big" id="proWhat2">Ver qué hace Forge</button></div>
      <small class="pro-note mono" style="--d:.34">Para estudios autorizados · acceso por invitación</small>
      <div class="pro-import" style="--d:.42">
        <span class="mascot" aria-hidden="true"></span>
        <div><b>Tu prototipo <span id="proProj"></span> está listo para importar</b><span id="proMeta"></span></div>
        <button type="button" class="btn small" id="proImport">Importar</button>
      </div>
    </div>
    <div class="pro-win" id="proWin">
      <div class="pw-bar"><span class="mascot" aria-hidden="true"></span><span class="mono">forge · concept pipeline</span></div>
      <div class="pw-body">
        <svg class="pw-wires" viewBox="0 0 540 320" preserveAspectRatio="none" aria-hidden="true">
          <path d="M150 196 C 200 196, 205 120, 262 120"/>
          <path d="M150 196 C 240 196, 300 220, 395 222"/>
          <path d="M150 196 C 190 196, 200 262, 262 262"/>
        </svg>
        <div class="pw-stack"><div class="pc" style="--r:-14deg;--i:0"><div class="pc-img" data-pk="0"></div><span>concept_seeds #1</span></div><div class="pc" style="--r:-6deg;--i:1"><div class="pc-img" data-pk="1"></div><span>concept_seeds #2</span></div><div class="pc" style="--r:4deg;--i:2"><div class="pc-img" data-pk="2"></div><span>moodboard</span></div></div>
        <div class="node on" style="left:5%;top:52%;--i:0"><div class="nh"><span>1.1 Exploración de concepto</span><i></i></div><div class="nr"><em>3 imágenes generadas</em></div><div class="nf"><span>CREATIVO</span><b>✓ aprobado</b></div></div>
        <div class="node" style="left:49%;top:29%;--i:1"><div class="nh"><span>1.2 Mercado</span><i></i></div><div class="nf"><span>ANÁLISIS</span><b>2</b></div></div>
        <div class="node" style="left:49%;top:73%;--i:2"><div class="nh"><span>1.3 Audiencia</span><i></i></div><div class="nf"><span>ANÁLISIS</span><b>2</b></div></div>
        <div class="node" style="left:73%;top:62%;--i:3"><div class="nh"><span>1.4 Selección de concepto</span><i></i></div><div class="nf"><span>DECISIÓN</span><b>3</b></div></div>
        <div class="pw-ai">
          <div class="ah"><span class="mascot" aria-hidden="true"></span><b>Forge Assistant</b><em class="mono">1.1</em></div>
          <div class="ab you">Explora 3 direcciones de concepto para el pitch.</div>
          <div class="ab bot" id="proBot"></div>
          <div class="ai-in"><span>Pide o describe un ajuste…</span><i>→</i></div>
        </div>
      </div>
    </div>
  </div>
  <section class="pro-feat" id="proFeat">
    <h2>Todo para ir de la idea a un vertical slice</h2>
    <p>Un solo pipeline que lleva un concepto más allá del prototipo: hacia un resultado documentado, con recursos y jugable.</p>
    <div class="pf-grid">
      <article class="pf" style="--c:#8b5cf6;--i:0"><span class="pf-ic"><svg viewBox="0 0 24 24"><path d="M12 4l7 8-7 8-7-8z" fill="currentColor"/></svg></span><em>PIPELINE VISUAL</em><h3>Un lienzo de nodos de IA</h3><p>Conecta concepto → diseño → documentos → recursos y mira correr cada paso. Sin cajas negras: cada etapa se puede revisar y volver a ejecutar.</p></article>
      <article class="pf" style="--c:#ff7a1a;--i:1"><span class="pf-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/></svg></span><em>DOCUMENTACIÓN PRIMERO</em><h3>GDD y TDD que aceptan los ingenieros</h3><p>Forge arma documentos de diseño y técnicos consistentes desde la misma fuente, sin prosa vaga que se contradice entre documentos.</p></article>
      <article class="pf" style="--c:#60a5fa;--i:2"><span class="pf-ic"><svg viewBox="0 0 24 24"><path d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z" fill="currentColor"/></svg></span><em>IA MULTIMODELO</em><h3>El modelo correcto para cada tarea</h3><p>Orquesta varios proveedores (razonamiento, visión, imagen, 3D) y elige el mejor motor para cada trabajo en vez de uno solo para todo.</p></article>
      <article class="pf" style="--c:#2dd4bf;--i:3"><span class="pf-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16M15 4v16"/></svg></span><em>RECURSOS 2D Y 3D</em><h3>Arte que mantiene el estilo</h3><p>Sprites, fondos, audio y modelos 3D generados con la misma guía visual, listos para el motor de tu estudio.</p></article>
      <article class="pf" style="--c:#fbbf24;--i:4"><span class="pf-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12l8-8M4 20L20 4M12 20l8-8"/></svg></span><em>HECHO PARA ESTUDIOS</em><h3>Roles, revisiones y control</h3><p>Aprobaciones por etapa, historial de versiones y acceso por invitación para todo el equipo.</p></article>
      <article class="pf" style="--c:#4ade80;--i:5"><span class="pf-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="10" height="10" rx="2"/><rect x="10" y="10" width="10" height="10" rx="2"/></svg></span><em>PLANTILLAS REUTILIZABLES</em><h3>Blueprints que se repiten</h3><p>Guarda un pipeline que funcionó y úsalo en tu próximo juego con un clic.</p></article>
    </div>
  </section>
  <footer class="pro-foot mono">Forge Pro es una vista previa dentro de Forge Light · el acceso real es por invitación</footer>
</section>

<div class="tour" id="tour" hidden role="dialog" aria-modal="true" aria-labelledby="tourT">
  <div class="tour-spot" id="tourSpot"></div>
  <div class="tour-card" id="tourCard">
    <div class="tour-h"><span class="mascot" aria-hidden="true"></span><span class="mono" id="tourStep">1 de 8</span><button type="button" class="tour-skip" id="tourSkip">Saltar</button></div>
    <h3 id="tourT"></h3>
    <p id="tourD"></p>
    <div class="tour-f"><div class="tour-dots" id="tourDots"></div><button type="button" class="btn small ghost" id="tourBack">Atrás</button><button type="button" class="btn small primary-s" id="tourNext">Siguiente</button></div>
  </div>
</div>

<section class="play" id="play" hidden aria-label="Primera jugada">
  <header class="play-top">
    <span class="mascot" aria-hidden="true"></span>
    <div class="play-ttl"><small>PRIMERA JUGADA</small><b id="playTitle"></b></div>
    <span class="sp"></span>
    <div class="play-tools">
      ${ICSND("sndBtn2", 'class="sndWave2"')}
      <button class="iconbtn" id="dbgBtn" type="button" title="Modo depuración (colisiones)" aria-label="Modo depuración"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 12h16M12 4v16"/></svg></button>
      <button class="iconbtn" id="rstBtn" type="button" title="Reiniciar nivel" aria-label="Reiniciar nivel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>
    </div>
    <button class="btn small ghost" id="playExit" type="button">Salir</button>
  </header>
  <div class="play-stage"><div class="play-slot" id="playSlot"></div></div>
</section>

<div class="chat" id="chat">
  <div class="chat-tip" id="chatTip" hidden><span id="chatTipTxt"></span><button type="button" id="chatTipX" aria-label="Cerrar aviso">×</button></div>
  <section class="chat-win" id="chatWin" hidden aria-label="Chat con Forge">
    <header><span class="mascot" aria-hidden="true"></span><div><b>Forge</b><small>Director de juego</small></div><button class="iconbtn" id="chatClose" type="button" aria-label="Cerrar chat">${ICX}</button></header>
    <div class="chat-log" id="chatLog"></div>
    <div class="chat-ctx" id="chatCtx"></div>
    <form class="chat-in" id="chatForm" autocomplete="off"><input id="chatIn" placeholder="Pide un cambio con tus palabras…" aria-label="Pide un cambio al juego"><button type="submit" aria-label="Enviar">${ICSEND}</button></form>
  </section>
  <button class="chat-fab" id="chatFab" type="button" aria-label="Abrir chat con Forge" aria-expanded="false"><span class="mascot" aria-hidden="true"></span><i class="dot" id="chatDot" hidden></i></button>
</div>

<div class="av" id="av" hidden role="dialog" aria-modal="true" aria-labelledby="avName">
  <div class="av-card">
    <div class="av-stage" id="avStage">
      <img id="avImg" alt="" hidden>
      <canvas id="avWave" hidden></canvas>
      <canvas id="av3d" hidden></canvas>
      <div class="av-hint" id="avHint" hidden></div>
      <div class="av-load" id="avLoad" hidden><span class="mascot" aria-hidden="true"></span><span id="avLoadT">Cargando…</span></div>
      <div class="av-play" id="avPlay" hidden><button type="button" class="btn small primary-s" id="avPlayBtn"></button></div>
    </div>
    <aside class="av-info">
      <button class="iconbtn av-x" id="avClose" type="button" aria-label="Cerrar">${ICX}</button>
      <div class="eyebrow" id="avKind"></div>
      <h3 id="avName"></h3>
      <div class="tg av-tags" id="avTags"></div>
      <dl class="av-spec" id="avSpec"></dl>
      <div class="av-anim" id="avPromptBox">
        <div class="lbl">Descripción para el generador</div>
        <textarea id="avPrompt" rows="4"></textarea>
        <div class="av-animrow"><button type="button" class="btn small primary-s" id="avRegen">Regenerar con esta descripción</button></div>
        <div class="note" id="avNote"></div>
      </div>
      <div class="av-acts" id="avActs"></div>
    </aside>
  </div>
</div>

<div class="modal" id="modal" hidden role="dialog" aria-modal="true" aria-labelledby="mTitle">
  <div class="modal-card">
    <button class="iconbtn x" id="mClose" type="button" aria-label="Cerrar">${ICX}</button>
    <span class="mascot" style="height:44px;animation:bob 1.6s ease-in-out infinite" aria-hidden="true"></span><div><div class="eyebrow">Exportar</div><h3 id="mTitle">Empaquetando tu juego</h3></div>
    <div class="prog"><i id="mProg"></i></div>
    <div class="stages" id="mStages"></div>
    <div class="dl">
      <button id="dlSrc" type="button" disabled><b>Descargar ZIP</b><span>HTML5 jugable + recursos</span></button>
      <button id="dlWeb" type="button" disabled><b>Abrir en pestaña</b><span>Enlace jugable local</span></button>
      <button id="dlApk" type="button" disabled><b>APK Android</b><span>Próximamente</span></button>
    </div>
    <div class="note">El ZIP contiene el juego completo (motor, runtime, código y recursos). Sírvelo con cualquier servidor estático, por ejemplo <code>npx serve</code>.</div>
  </div>
</div>
<div class="toast" id="toast" role="status"></div>
<input type="file" id="upIn" hidden>
`;
