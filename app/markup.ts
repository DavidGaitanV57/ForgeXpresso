const ICSEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
const ICX = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
const ICSND = (id: string, wave: string) =>
  `<button class="iconbtn on" id="${id}" type="button" data-i18n-title="studio.sound" data-i18n-aria="studio.sound"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path ${wave} d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg></button>`;

export const MARKUP = `
<div class="langsw langsw-fixed" id="introLang" role="group" aria-label="Idioma">
  <button type="button" data-locale="es" class="on" title="Español">ES</button>
  <button type="button" data-locale="en" title="English">EN</button>
  <button type="button" data-locale="fr" title="Français">FR</button>
</div>
<section class="intro" id="intro">
  <div class="intro-in" id="introIn">
    <div class="intro-mascot" id="introMascot" aria-hidden="true">
      <span class="mascot mark" id="introMascot2d"></span>
      <canvas class="mascot-3d" id="introMascot3d" hidden></canvas>
    </div>
    <h1 data-i18n-html="intro.title">¿Qué juego quieres <span>forjar</span> hoy?</h1>
    <p class="sub" data-i18n="intro.sub">Descríbelo con tus palabras. Un equipo de agentes diseña el juego, dibuja el arte, compone la música y escribe el código para que lo juegues en minutos.</p>
    <form class="ask" id="askForm" autocomplete="off">
      <div class="agent"><i id="agentDot"></i><span id="agentTxt" data-i18n="intro.agentReady">Director de juego · listo</span></div>
      <textarea id="askIn" rows="3" data-i18n-placeholder="intro.placeholder" data-i18n-aria="intro.ariaDescribe" placeholder="Ej: un plataformero de un zorro ninja que cruza una ciudad neón saltando entre azoteas" aria-label="Describe tu juego"></textarea>
      <div class="ask-bar">
        <div class="dimsw" role="group" data-i18n-aria="intro.ariaDim" aria-label="Dimensión"><button type="button" data-d="2d" class="on">2D</button><button type="button" data-d="2.5d">2.5D</button><button type="button" data-d="3d">3D</button></div>
        <span class="sp"></span>
        <button class="send" id="askSend" type="submit" data-i18n-aria="intro.ariaCreate" aria-label="Crear juego" disabled>${ICSEND}</button>
      </div>
    </form>
    <div class="keys-status" id="keysStatus" hidden aria-hidden="true"></div>
    <div class="sugs" id="sugs"></div>
    <div class="projects" id="projects" hidden>
      <div class="lbl" data-i18n="intro.yourGames">Tus juegos</div>
      <div class="proj-grid" id="projGrid"></div>
    </div>
  </div>
</section>

<section class="loader" id="loader" hidden aria-live="polite">
  <canvas id="embers" aria-hidden="true"></canvas>
  <div class="ld-in">
    <div class="ld-head" style="--d:0">
      <div class="ld-mark"><span class="ring"></span><span class="ring r2"></span><span class="mascot" aria-hidden="true"></span></div>
      <div style="min-width:0;flex:1"><div class="ld-eyebrow"><i></i><span id="ldEyebrow" data-i18n="loader.eyebrow">Los agentes están forjando tu juego</span></div><h2 class="ld-title" id="ldTitle"></h2><p class="ld-idea" id="ldIdea"></p></div>
      <button class="btn small ghost" id="ldBack" type="button" data-i18n="loader.back">← Inicio</button>
    </div>
    <div class="ld-grid" style="--d:.15">
      <div class="ld-preview"><div class="ld-gallery" id="ldGallery"></div><div class="ld-scan"></div><span class="ld-tag" id="ldTag"><i></i><span data-i18n="loader.preparing">Preparando</span></span></div>
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
    <button class="brand" id="homeBtn" type="button" data-i18n-title="studio.home" data-i18n-aria="studio.home" title="Volver al inicio" aria-label="Volver al inicio">
      <span class="mascot" aria-hidden="true"></span>
      forge <span class="xpresso">Xpresso</span>
    </button>
    <span class="proj" id="projName"></span>
    <span class="spacer"></span>
    <div class="langsw" id="studioLang" role="group" aria-label="Idioma">
      <button type="button" data-locale="es" class="on" title="Español">ES</button>
      <button type="button" data-locale="en" title="English">EN</button>
      <button type="button" data-locale="fr" title="Français">FR</button>
    </div>
    <button class="iconbtn help" id="helpBtn" type="button" data-i18n-title="studio.help" data-i18n-aria="studio.help" title="Ver recorrido" aria-label="Ver recorrido de ayuda">?</button>
    <button class="btn ghost" id="usageBtn" type="button" data-i18n="guide.usage" hidden>Consumo de APIs</button>
    <button class="btn ghost" id="proBtn" type="button" data-i18n="studio.pro">Abrir en Forge Pro</button>
    <span class="vsep" aria-hidden="true"></span>
    <button class="btn export" id="exportBtn" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg><span data-i18n="studio.export">Exportar</span></button>
  </header>

  <section class="st-head asm from-top" aria-live="polite" style="--asd:.7s">
    <div class="ld-mark"><span class="ring"></span><span class="ring r2"></span><span class="mascot" aria-hidden="true"></span></div>
    <div class="st-ttl">
      <div class="ld-eyebrow"><i></i><span id="bnEyebrow"></span></div>
      <h1 class="st-title"><span class="hl" id="stHero"></span></h1>
      <p class="st-idea" id="stIdea"></p>
    </div>
    <button class="btn play-cta" id="playBtn" type="button"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span data-i18n="studio.play">Jugar</span></button>
  </section>

  <div class="st-grid">
    <div class="st-left">
      <div class="st-preview">
        <div class="viewport" id="vp" data-i18n-aria="studio.preview" aria-label="Vista previa jugable">
          <iframe id="game" title="Juego" sandbox="allow-scripts allow-pointer-lock" allow="autoplay; gamepad; fullscreen"></iframe>
          <div class="vp-err" id="vpErr" hidden></div>
          <button type="button" class="vp-expand" id="vpExpand" data-i18n-title="studio.fullscreen" data-i18n-aria="studio.fullscreen" title="Pantalla completa" aria-label="Jugar en pantalla completa"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
          <div class="studio-busy" id="studioBusy" hidden>
            <span class="mascot" aria-hidden="true"></span>
            <b id="studioBusyT" data-i18n="studio.busy">Forge está aplicando tus cambios…</b>
            <small id="studioBusyS"></small>
          </div>
        </div>
      </div>
      <div class="st-tools asm from-under" style="--asd:0s">
        <span class="pill v" id="loopPill"></span>
        <span class="pill" id="verPill"></span>
        <div class="tools">
          <button class="iconbtn" id="cineBtn" type="button" data-i18n-title="studio.cine" data-i18n-aria="studio.cine" title="Ver cinemática" aria-label="Ver cinemática"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="9" width="18" height="12" rx="2"/><path d="M3 9l2.5-5 3.5 1-2.5 5M10 6l3.5 1L11 12M16.5 7.5l3.5 1L18 12"/></svg></button>
          <button class="iconbtn" id="reloadBtn" type="button" data-i18n-title="studio.reload" data-i18n-aria="studio.reload" title="Recargar juego" aria-label="Recargar juego"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>
          <div class="vol" data-i18n-title="studio.volume" title="Volumen">${ICSND("sndBtn", 'id="sndWave"')}<input type="range" id="volSlider" min="0" max="1" step="0.05" value="0.9" data-i18n-aria="studio.volumeAria" aria-label="Volumen general"></div>
        </div>
      </div>
      <section class="dock asm from-under" id="dock" style="--asd:.08s" data-i18n-aria="studio.dock" aria-label="Chat con Forge">
        <div class="dock-logw"><div class="dock-log" id="dockLog"></div><div class="dock-rail" id="dockRail" hidden><i id="dockThumb"></i></div></div>
        <div class="dock-hint" id="dockHint" hidden></div>
        <form class="dock-in" id="dockForm" autocomplete="off"><span class="mascot" aria-hidden="true"></span><input id="dockIn" data-i18n-placeholder="studio.dockPh" data-i18n-aria="studio.dockAria" placeholder="Pide un cambio a Forge con tus palabras…" aria-label="Pide un cambio al juego"><button type="submit" data-i18n-aria="studio.send" aria-label="Enviar">${ICSEND}</button></form>
      </section>
      <section class="st-assets asm from-under" id="stAssets" style="--asd:.3s">
        <button type="button" class="st-sec" id="assetsToggle" aria-expanded="true" aria-controls="assets">
          <span class="ld-eyebrow"><i style="background:var(--violet);box-shadow:0 0 8px var(--violet)"></i><span data-i18n="studio.assetsTitle">Recursos del juego</span></span>
          <span class="muted-s" data-i18n="studio.assetsSub">Marca lo que te gusta, regenéralo o sube el tuyo</span>
          <svg class="chev-col" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="assets" id="assets"></div>
      </section>
    </div>
    <aside class="flow asm from-left" id="flow" data-i18n-aria="studio.flow" aria-label="Panel de creación" style="--asd:.45s"></aside>
  </div>
</div>

<div class="usage-pop" id="usagePop" hidden role="dialog" aria-modal="true" aria-labelledby="usagePopTitle">
  <div class="usage-pop-card">
    <button class="iconbtn x" id="usagePopX" type="button" data-i18n-aria="vp.close" aria-label="Cerrar">×</button>
    <div class="eyebrow" id="usagePopTitle" data-i18n="guide.usage">Consumo de APIs</div>
    <div id="usagePopBody"></div>
  </div>
</div>

<section class="pro" id="pro" hidden aria-label="Forge Pro">
  <canvas id="proSky" aria-hidden="true"></canvas>
  <header class="pro-top">
    <button type="button" class="pro-brand" id="proHome" data-i18n-title="pro.home" title="Volver a mi juego"><span class="mascot" aria-hidden="true"></span><span><b>Forge</b><small>AI GAME PIPELINE</small></span></button>
    <span class="sp"></span>
    <button type="button" class="pro-link" id="proWhat" data-i18n="pro.what">Qué hace</button>
    <button type="button" class="btn small" id="proBack" data-i18n="pro.back">← Volver a mi juego</button>
    <button type="button" class="btn small primary-s" id="proSign" data-i18n="pro.sign">Iniciar sesión</button>
  </header>
  <div class="pro-hero">
    <div class="pro-copy">
      <span class="pro-pill" style="--d:.05"><i></i><span data-i18n="pro.pill">FORGE PRO · PRODUCCIÓN DE JUEGOS CON IA</span></span>
      <h1 style="--d:.12" data-i18n-html="pro.h1">Del concepto a un <span class="grad">vertical slice</span> jugable.</h1>
      <p style="--d:.2" data-i18n-html="pro.p">Forge orquesta la IA en un lienzo visual: lleva una idea de juego más allá del prototipo hacia <b>documentos de diseño, arte y un vertical slice jugable</b> del juego real.</p>
      <div class="pro-cta" style="--d:.28"><button type="button" class="btn primary-s pro-big" id="proSign2" data-i18n="pro.sign2">Iniciar sesión →</button><button type="button" class="btn pro-big" id="proWhat2" data-i18n="pro.what2">Ver qué hace Forge</button></div>
      <small class="pro-note mono" style="--d:.34" data-i18n="pro.note">Para estudios autorizados · acceso por invitación</small>
      <div class="pro-import" style="--d:.42">
        <span class="mascot" aria-hidden="true"></span>
        <div><b><span data-i18n="pro.importLead">Tu juego</span> <span id="proProj"></span> <span data-i18n="pro.importTail">está listo para importar</span></b><span id="proMeta"></span></div>
        <button type="button" class="btn small" id="proImport" data-i18n="pro.import">Importar</button>
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
        <div class="node on" style="left:5%;top:52%;--i:0"><div class="nh"><span>1.1 <span data-i18n="pro.n1">Exploración de concepto</span></span><i></i></div><div class="nr"><em data-i18n="pro.n1r">3 imágenes generadas</em></div><div class="nf"><span>CREATIVE</span><b>✓</b></div></div>
        <div class="node" style="left:49%;top:29%;--i:1"><div class="nh"><span>1.2 <span data-i18n="pro.n2">Mercado</span></span><i></i></div><div class="nf"><span>ANALYSIS</span><b>2</b></div></div>
        <div class="node" style="left:49%;top:73%;--i:2"><div class="nh"><span>1.3 <span data-i18n="pro.n3">Audiencia</span></span><i></i></div><div class="nf"><span>ANALYSIS</span><b>2</b></div></div>
        <div class="node" style="left:73%;top:62%;--i:3"><div class="nh"><span>1.4 <span data-i18n="pro.n4">Selección de concepto</span></span><i></i></div><div class="nf"><span>DECISION</span><b>3</b></div></div>
        <div class="pw-ai">
          <div class="ah"><span class="mascot" aria-hidden="true"></span><b>Forge Assistant</b><em class="mono">1.1</em></div>
          <div class="ab you" data-i18n="pro.ask">Explora 3 direcciones de concepto para el pitch.</div>
          <div class="ab bot" id="proBot"></div>
          <div class="ai-in"><span>…</span><i>→</i></div>
        </div>
      </div>
    </div>
  </div>
  <section class="pro-feat" id="proFeat">
    <h2 data-i18n="pro.featH">Todo para ir de la idea a un vertical slice</h2>
    <p data-i18n="pro.featP">Un solo pipeline que lleva un concepto más allá del prototipo: hacia un resultado documentado, con recursos y jugable.</p>
    <div class="pf-grid">
      <article class="pf" style="--c:#8b5cf6;--i:0"><span class="pf-ic"><svg viewBox="0 0 24 24"><path d="M12 4l7 8-7 8-7-8z" fill="currentColor"/></svg></span><em>PIPELINE</em><h3>AI node canvas</h3><p>Concept → design → docs → assets — review and rerun every stage.</p></article>
      <article class="pf" style="--c:#ff7a1a;--i:1"><span class="pf-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/></svg></span><em>DOCS FIRST</em><h3>GDD &amp; TDD</h3><p>Consistent design and tech docs from the same source of truth.</p></article>
      <article class="pf" style="--c:#60a5fa;--i:2"><span class="pf-ic"><svg viewBox="0 0 24 24"><path d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z" fill="currentColor"/></svg></span><em>MULTI-MODEL</em><h3>Right model per job</h3><p>Orchestrate reasoning, vision, image, and 3D providers.</p></article>
      <article class="pf" style="--c:#2dd4bf;--i:3"><span class="pf-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16M15 4v16"/></svg></span><em>2D &amp; 3D</em><h3>On-style art</h3><p>Sprites, backgrounds, audio, and 3D models under one visual guide.</p></article>
      <article class="pf" style="--c:#fbbf24;--i:4"><span class="pf-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12l8-8M4 20L20 4M12 20l8-8"/></svg></span><em>STUDIOS</em><h3>Roles &amp; reviews</h3><p>Stage approvals, version history, invite-only access.</p></article>
      <article class="pf" style="--c:#4ade80;--i:5"><span class="pf-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="10" height="10" rx="2"/><rect x="10" y="10" width="10" height="10" rx="2"/></svg></span><em>TEMPLATES</em><h3>Reusable blueprints</h3><p>Save a pipeline that worked and reuse it on the next game.</p></article>
    </div>
  </section>
  <footer class="pro-foot mono" data-i18n="pro.foot">Forge Pro es una vista previa dentro de Forge Xpresso · el acceso real es por invitación</footer>
</section>

<div class="tour" id="tour" hidden role="dialog" aria-modal="true" aria-labelledby="tourT">
  <div class="tour-spot" id="tourSpot"></div>
  <div class="tour-card" id="tourCard">
    <div class="tour-h"><span class="mascot" aria-hidden="true"></span><span class="mono" id="tourStep">1 de 8</span><button type="button" class="tour-skip" id="tourSkip" data-i18n="tour.skip">Saltar</button></div>
    <h3 id="tourT"></h3>
    <p id="tourD"></p>
    <div class="tour-f"><div class="tour-dots" id="tourDots"></div><button type="button" class="btn small ghost" id="tourBack" data-i18n="tour.back">Atrás</button><button type="button" class="btn small primary-s" id="tourNext" data-i18n="tour.next">Siguiente</button></div>
  </div>
</div>

<section class="play" id="play" hidden data-i18n-aria="play.first" aria-label="Primera jugada">
  <header class="play-top">
    <span class="mascot" aria-hidden="true"></span>
    <div class="play-ttl"><small data-i18n="play.first">PRIMERA JUGADA</small><b id="playTitle"></b></div>
    <span class="sp"></span>
    <div class="play-tools">
      <div class="vol" data-i18n-title="studio.volume" title="Volumen">${ICSND("sndBtn2", 'class="sndWave2"')}<input type="range" id="volSlider2" min="0" max="1" step="0.05" value="0.9" data-i18n-aria="studio.volumeAria" aria-label="Volumen general"></div>
      <button class="iconbtn" id="dbgBtn" type="button" data-i18n-title="play.debug" data-i18n-aria="play.debug" title="Modo depuración (colisiones)" aria-label="Modo depuración"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 12h16M12 4v16"/></svg></button>
      <button class="iconbtn" id="rstBtn" type="button" data-i18n-title="play.restart" data-i18n-aria="play.restart" title="Reiniciar nivel" aria-label="Reiniciar nivel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>
    </div>
    <button class="btn small ghost" id="playExit" type="button" data-i18n="play.exit">Salir</button>
  </header>
  <div class="play-stage"><div class="play-slot" id="playSlot"></div></div>
</section>

<div class="chat" id="chat">
  <div class="chat-tip" id="chatTip" hidden><span id="chatTipTxt"></span><button type="button" id="chatTipX" data-i18n-aria="chat.closeTip" aria-label="Cerrar aviso">×</button></div>
  <section class="chat-win" id="chatWin" hidden data-i18n-aria="studio.dock" aria-label="Chat con Forge">
    <header><span class="mascot" aria-hidden="true"></span><div><b>Forge</b><small data-i18n="chat.director">Director de juego</small></div><button class="iconbtn" id="chatClose" type="button" data-i18n-aria="chat.close" aria-label="Cerrar chat">${ICX}</button></header>
    <div class="chat-log" id="chatLog"></div>
    <div class="chat-ctx" id="chatCtx"></div>
    <form class="chat-in" id="chatForm" autocomplete="off"><input id="chatIn" data-i18n-placeholder="chat.ph" data-i18n-aria="studio.dockAria" placeholder="Pide un cambio con tus palabras…" aria-label="Pide un cambio al juego"><button type="submit" data-i18n-aria="studio.send" aria-label="Enviar">${ICSEND}</button></form>
  </section>
  <button class="chat-fab" id="chatFab" type="button" data-i18n-aria="chat.open" aria-label="Abrir chat con Forge" aria-expanded="false"><span class="mascot" aria-hidden="true"></span><i class="dot" id="chatDot" hidden></i></button>
</div>

<div class="av" id="av" hidden role="dialog" aria-modal="true" aria-labelledby="avName">
  <div class="av-card">
    <div class="av-stage" id="avStage">
      <img id="avImg" alt="" hidden>
      <canvas id="avWave" hidden></canvas>
      <canvas id="av3d" hidden></canvas>
      <div class="av-hint" id="avHint" hidden></div>
      <div class="av-load" id="avLoad" hidden><span class="mascot" aria-hidden="true"></span><span id="avLoadT" data-i18n="asset.loading">Cargando…</span></div>
      <div class="av-play" id="avPlay" hidden><button type="button" class="btn small primary-s" id="avPlayBtn"></button></div>
    </div>
    <aside class="av-info">
      <button class="iconbtn av-x" id="avClose" type="button" data-i18n-aria="asset.close" aria-label="Cerrar">${ICX}</button>
      <div class="eyebrow" id="avKind"></div>
      <h3 id="avName"></h3>
      <div class="av-revs" id="avRevs" hidden></div>
      <div class="tg av-tags" id="avTags"></div>
      <dl class="av-spec" id="avSpec"></dl>
      <div class="av-anim" id="avPromptBox">
        <div class="lbl" data-i18n="asset.prompt">Descripción para el generador</div>
        <textarea id="avPrompt" rows="4"></textarea>
        <div class="av-animrow"><button type="button" class="btn small primary-s" id="avRegen" data-i18n="asset.regenPrompt">Regenerar con esta descripción</button></div>
        <div class="note" id="avNote"></div>
      </div>
      <div class="av-acts" id="avActs"></div>
    </aside>
  </div>
</div>

<div class="modal" id="modal" hidden role="dialog" aria-modal="true" aria-labelledby="mTitle">
  <div class="modal-card">
    <button class="iconbtn x" id="mClose" type="button" data-i18n-aria="asset.close" aria-label="Cerrar">${ICX}</button>
    <span class="mascot" style="height:44px;animation:bob 1.6s ease-in-out infinite" aria-hidden="true"></span><div><div class="eyebrow" data-i18n="export.eyebrow">Exportar</div><h3 id="mTitle" data-i18n="export.title">Empaquetando tu juego</h3></div>
    <div class="prog"><i id="mProg"></i></div>
    <div class="stages" id="mStages"></div>
    <div class="dl">
      <button id="dlSrc" type="button" disabled><b data-i18n="export.zip">Descargar ZIP</b><span data-i18n="export.zipSub">HTML5 jugable + recursos</span></button>
      <button id="dlWeb" type="button" disabled><b data-i18n="export.tab">Abrir en pestaña</b><span data-i18n="export.tabSub">Enlace jugable local</span></button>
      <button id="dlApk" type="button" disabled><b data-i18n="export.apk">APK Android</b><span data-i18n="export.apkSub">Próximamente</span></button>
    </div>
    <div class="note" data-i18n-html="export.note">El ZIP contiene el juego completo (runtime, código y recursos). Sírvelo con cualquier servidor estático, por ejemplo <code>npx serve</code>.</div>
  </div>
</div>
<div class="toast" id="toast" role="status"></div>
<input type="file" id="upIn" hidden>
`;
