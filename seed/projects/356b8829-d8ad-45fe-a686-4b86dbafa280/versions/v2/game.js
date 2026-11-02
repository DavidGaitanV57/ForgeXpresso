export default async function createGame(forge, ctx) {
  const { THREE, scene, camera } = ctx;

  // ---------------------------------------------------------------- helpers
  const C = { night: "#0E1B2E", teal: "#1F4D4A", moss: "#3FA27A", gold: "#F4D35E", lime: "#B6F36B", violet: "#C85BD6", cream: "#F2EBD9" };
  const tune = (k, f) => { const v = Number(forge.tune(k, f)); return Number.isFinite(v) ? v : f; };
  const rnd = () => forge.rand();
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const disp = [];
  const YAW_HERO = 1.15, YAW_BRAMBLE = 1.1, YAW_MOTH = 1.0;

  const root = new THREE.Group();
  scene.add(root);
  const prevBg = scene.background;
  scene.background = new THREE.Color(C.night);
  camera.fov = 35; camera.near = 0.1; camera.far = 300; camera.updateProjectionMatrix();
  forge.three.fog(C.night, 26, 85);
  forge.three.bloom(0.75, 0.5, 0.75);
  const L = forge.three.lights({ sun: "#a9c2ff", sky: "#4f74a8", ground: C.teal, intensity: 0.85, shadowSize: 34 }) || {};
  const sun = L.sun || null;
  if (sun && sun.target && !sun.target.parent) scene.add(sun.target);

  // radial glow texture
  const glowTex = (() => {
    const s = 64, d = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = ((x + 0.5) / s) * 2 - 1, dy = ((y + 0.5) / s) * 2 - 1;
      const a = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy)) ** 2, i = (y * s + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(a * 255);
    }
    const t = new THREE.DataTexture(d, s, s, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    return t;
  })();
  disp.push(glowTex);

  function glow(color, scale, opacity) {
    const m = new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity });
    disp.push(m);
    const s = new THREE.Sprite(m); s.scale.setScalar(scale); return s;
  }

  const G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    stem: new THREE.CylinderGeometry(1, 1.25, 1, 12),
    disc: new THREE.CircleGeometry(1, 24),
    ball: new THREE.SphereGeometry(1, 10, 8),
    fern: new THREE.ConeGeometry(0.09, 1.1, 4).translate(0, 0.55, 0),
    trunk: new THREE.CylinderGeometry(1, 1.3, 1, 10, 1, true),
    plane: new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), // base-anchored cutout quad
    planeC: new THREE.PlaneGeometry(1, 1),                     // centered cutout quad
  };
  const std = (o) => { const m = new THREE.MeshStandardMaterial(o); disp.push(m); return m; };
  const M = {
    stem: std({ color: C.cream, roughness: 0.8 }),
    fern: std({ color: "#123631", roughness: 1 }),
    tiny: std({ color: C.lime, emissive: C.lime, emissiveIntensity: 1.3 }),
  };
  const matCache = new Map();
  function texMat(id, rx, ry, color) {
    const r = (v) => Math.max(0.5, Math.round(v * 2) / 2);
    const key = id + r(rx) + "_" + r(ry) + (color || "");
    if (!matCache.has(key)) {
      const o = { repeat: [r(rx), r(ry)], roughness: 0.95 };
      if (color) o.color = color;
      matCache.set(key, forge.three.material(id, o));
    }
    return matCache.get(key);
  }

  // ---------------------------------------------------------------- cutout images (props / collectibles / hazards / goal)
  const texCache = new Map();
  function tex(id) {
    if (!texCache.has(id)) texCache.set(id, forge.three.texture(id));
    return texCache.get(id);
  }
  function aspectOf(id) {
    const im = forge.assets.image(id);
    if (im) {
      if (im.width > 0 && im.height > 0) return im.width / im.height;
      if (typeof im.aspect === "number" && im.aspect > 0) return im.aspect;
      if (typeof im.aspect === "string") {
        const [a, b] = im.aspect.split(":").map(Number);
        if (a > 0 && b > 0) return a / b;
      }
    }
    return 1;
  }
  function cutMat(id, o = {}) {
    const map = tex(id);
    const m = new THREE.MeshStandardMaterial({
      map, transparent: true, alphaTest: 0.5, depthWrite: true, side: THREE.DoubleSide,
      roughness: 0.85, metalness: 0, color: o.color || "#ffffff",
      emissive: o.emissive || "#000000", emissiveMap: o.emissive ? map : null, emissiveIntensity: o.emissiveIntensity ?? 0,
    });
    disp.push(m);
    return m;
  }

  // ---------------------------------------------------------------- 3D characters
  function makeCharacter(id, h, opts) {
    let obj = null;
    try { obj = forge.three.character(id, h, opts); } catch (e) { obj = null; }
    if (!obj) { try { obj = forge.three.model(id + "_3d", { height: h }); } catch (e) { obj = null; } }
    if (!obj) {
      const geo = new THREE.CapsuleGeometry(h * 0.28, h * 0.44, 6, 12); disp.push(geo);
      const m = new THREE.Mesh(geo, forge.three.material(id, {}));
      m.position.y = h / 2; obj = new THREE.Group(); obj.add(m);
    }
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return obj;
  }
  function ownMaterials(obj) {
    const list = [];
    obj.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const conv = (m) => { const c = m.clone(); disp.push(c); if (c.color) list.push({ m: c, base: c.color.clone() }); return c; };
      o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    });
    return list;
  }
  function tintList(list, color) {
    for (const e of list) { e.m.color.copy(e.base); if (color) e.m.color.multiply(color); }
  }
  const stunColor = new THREE.Color("#6f6a80");

  const MAT = {
    bounce: cutMat("bounce_mushroom", { emissive: "#ffffff", emissiveIntensity: 0.25 }),
    toxic: cutMat("toxic_mushroom", { emissive: "#ffffff", emissiveIntensity: 0.35 }),
    thorn: cutMat("thorn_spikes", { emissive: "#ffffff", emissiveIntensity: 0.12 }),
    thornBack: cutMat("thorn_spikes", { color: "#8a7aa0" }),
    deco: cutMat("bounce_mushroom", { color: "#93a9c2" }),
  };

  // ---------------------------------------------------------------- level
  const solids = [], mushrooms = [], hazards = [], brambles = [], moths = [], cps = [];
  const dummy = new THREE.Object3D();

  function ground(x0, x1, top, o = {}) {
    const y0 = o.y0 ?? -14, w = x1 - x0, h = top - y0, dep = o.depth || 6, z = o.depth ? 0 : -1.4;
    solids.push({ x0, x1, y0, y1: top, oneWay: false, kind: o.kind || "ground" });
    const body = new THREE.Mesh(G.box, texMat(o.stone ? "tex_mossy_stone" : "tex_bark", w / 2.5, h / 2.5, o.stone ? "#c6d4dc" : "#b9c4cc"));
    body.scale.set(w, h, dep); body.position.set((x0 + x1) / 2, top - h / 2, z);
    body.castShadow = body.receiveShadow = true; root.add(body);
    const lip = new THREE.Mesh(G.box, texMat("tex_moss_ground", w / 2, dep / 2));
    lip.scale.set(w + 0.16, 0.32, dep + 0.16); lip.position.set((x0 + x1) / 2, top - 0.14, z);
    lip.receiveShadow = true; root.add(lip);
  }
  function branch(x0, x1, y, ledge = false) {
    solids.push({ x0, x1, y0: y - 0.4, y1: y, oneWay: true, kind: "branch" });
    const w = x1 - x0;
    const log = new THREE.Mesh(G.box, texMat(ledge ? "tex_mossy_stone" : "tex_bark", w / 2, 1));
    log.scale.set(w, ledge ? 0.55 : 0.4, 1.5); log.position.set((x0 + x1) / 2, y - (ledge ? 0.27 : 0.2), 0);
    log.castShadow = log.receiveShadow = true; root.add(log);
    const moss = new THREE.Mesh(G.box, texMat("tex_moss_ground", w / 2, 1));
    moss.scale.set(w + 0.12, 0.12, 1.6); moss.position.set((x0 + x1) / 2, y - 0.04, 0);
    moss.receiveShadow = true; root.add(moss);
    if (!ledge) {
      const tr = new THREE.Mesh(G.trunk, texMat("tex_bark", 1, 6, "#8d9bb0"));
      tr.scale.set(0.6, y + 22, 0.6); tr.position.set(x0 + 0.6, (y - 14 + 8) / 2, -2.3);
      tr.castShadow = true; root.add(tr);
    }
  }
  function mushroom(x, base, capTop, r, toxic = false) {
    const id = toxic ? "toxic_mushroom" : "bounce_mushroom";
    // how deep the image may sink below its support before showing through
    let found = false, sink = 3;
    for (const s of solids) {
      if (Math.abs(s.y1 - base) < 0.01 && x >= s.x0 && x <= s.x1) { found = true; if (s.oneWay) sink = Math.min(sink, 0.35); }
    }
    if (!found) sink = 1e3;
    const aspect = aspectOf(id), pad = 0.06;
    const want = 2 * r * (toxic ? 1.35 : 1.25);
    const S = Math.max(0.4, Math.min(want, (capTop - base + sink) / (1 - pad)));
    const top = capTop + pad * S, bottom = top - S;
    const W = S * aspect * clamp(want / S, 1, 1.3);
    const pivot = Math.max(base, bottom);
    const g = new THREE.Group(); g.position.set(x, pivot, -0.45); root.add(g);
    const sq = new THREE.Group(); g.add(sq);
    const plane = new THREE.Mesh(G.plane, toxic ? MAT.toxic : MAT.bounce);
    plane.scale.set(W, S, 1); plane.position.y = bottom - pivot; plane.castShadow = true; sq.add(plane);
    if (base < bottom - 0.05) {
      const sh = bottom + 0.3 * S - base;
      const stem = new THREE.Mesh(G.stem, M.stem);
      stem.scale.set(r * 0.24, sh, r * 0.24); stem.position.set(x, base + sh / 2, -0.65);
      stem.castShadow = stem.receiveShadow = true; root.add(stem);
    }
    if (toxic) {
      const capH = r * 0.62;
      const gl = glow(C.violet, r * 3.2, 0.35); gl.position.set(0, capTop - pivot - capH * 0.4, 0.6); g.add(gl);
      hazards.push({ x0: x - r * 0.8, x1: x + r * 0.8, y0: capTop - capH - 0.1, y1: capTop + 0.02, toxic: true, cx: x });
    }
    mushrooms.push({ x, capTop, r, toxic, sq, s: 1, sv: 0 });
  }
  function thorns(x0, x1, y) {
    hazards.push({ x0: x0 + 0.05, x1: x1 - 0.05, y0: y - 0.1, y1: y + 0.5, toxic: false, cx: (x0 + x1) / 2 });
    const w = x1 - x0, a = aspectOf("thorn_spikes");
    const n = Math.max(1, Math.round(w / 1.1)), tw = (w / n) * 1.08, th = Math.min(0.95, tw / a);
    const rows = [[-0.9, MAT.thornBack], [0.0, MAT.thorn], [0.9, MAT.thorn]];
    for (const [z, mat] of rows) {
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(G.plane, mat);
        m.scale.set(tw * (rnd() < 0.5 ? -1 : 1), th * (0.9 + rnd() * 0.2), 1);
        m.position.set(x0 + (i + 0.5) * (w / n) + (rnd() - 0.5) * 0.1, y - 0.06, z + (rnd() - 0.5) * 0.1);
        m.castShadow = true; root.add(m);
      }
    }
  }
  function bramble(x0, x1, y, mul) {
    const g = new THREE.Group(), face = new THREE.Group();
    g.add(face);
    face.add(makeCharacter("enemy_bramble", 1.0, { shape: "creature" }));
    const x = (x0 + x1) / 2; g.position.set(x, y, 0); root.add(g);
    brambles.push({ x, y, x0, x1, mul, dir: 1, flip: 1, dead: false, dt: 0, g, face, ph: rnd() * 6 });
  }
  function moth(cx, cy, rx, amp) {
    const g = new THREE.Group(), face = new THREE.Group(); g.add(face);
    const body = makeCharacter("enemy_moth", 0.85, { shape: "creature" });
    body.position.y = -0.42; face.add(body);
    const tint = ownMaterials(body);
    const gl = glow(C.violet, 1.6, 0.4); gl.position.z = -0.3; g.add(gl);
    g.position.set(cx, cy, 0); root.add(g);
    moths.push({ cx, cy, rx, amp, t: rnd() * 6, x: cx, y: cy, stun: 0, scored: false, dy: 0, flip: 1, g, face, gl, tint });
  }
  function checkpoint(x, y) {
    const g = new THREE.Group(); g.position.set(x, y, -1.0); root.add(g);
    const mat = cutMat("checkpoint_stone", { emissive: C.lime, emissiveIntensity: 0.04 });
    const h = 1.8, w = h * aspectOf("checkpoint_stone");
    const st = new THREE.Mesh(G.plane, mat); st.scale.set(w, h, 1); st.position.y = -0.05; st.castShadow = true; g.add(st);
    const gl = glow(C.lime, 1.3, 0.15); gl.position.set(0, h * 0.62, 0.2); g.add(gl);
    cps.push({ x, y, g, st, w, h, mat, gl, active: false, pulse: 0 });
  }

  // Zone 1 — Le Sentier
  ground(-9, -5.5, 26, { stone: true });
  ground(-5.5, 46.5, 0);
  ground(9, 10.5, 0.9, { stone: true, y0: 0, depth: 2.4 });
  mushroom(16, 0, 1.0, 0.8);
  bramble(21, 28, 0, 0.6);
  // Zone 2 — Les Chapeaux
  mushroom(34, 0, 1.0, 0.8);
  branch(36.5, 40.5, 3.6);
  mushroom(40, 3.6, 4.4, 0.65);
  branch(42.5, 46.5, 7.0);
  mushroom(46, 7.0, 7.8, 0.7);
  branch(48, 53, 10.5, true);
  ground(46.5, 49.5, -1.2, { kind: "pit" }); thorns(46.5, 49.5, -1.2);
  ground(49.5, 60, 0);
  bramble(51, 57, 0, 1.0);
  mushroom(58.3, 0, 1.0, 0.8);
  ground(60, 63, 3.2, { stone: true });
  ground(63, 72, 0);
  bramble(64, 71, 0, 1.1);
  // Zone 3 — Le Marais Toxique
  ground(75, 80, 0);
  mushroom(77.5, 0, 0.95, 0.55, true);
  mushroom(81.8, -14, 0.3, 0.9);
  ground(84, 87.5, 2.5, { stone: true });
  moth(89, 3.4, 1.2, 0.7);
  ground(90, 100, 0.5);
  mushroom(94, 0.5, 1.45, 0.55, true);
  mushroom(97.3, 0.5, 1.5, 0.8);
  mushroom(99.4, 0.5, 1.45, 0.55, true);
  ground(101.5, 104.5, 3.0, { stone: true });
  moth(105.6, 4.4, 1.0, 0.8);
  ground(107, 113, 0.5);
  bramble(107.6, 112.6, 0.5, 1.25);
  ground(113, 115.5, -0.7, { kind: "pit" }); thorns(113, 115.5, -0.7);
  // Zone 4 — L'Arbre-Cœur
  ground(115.5, 128, 0.5);
  mushroom(119.2, 0.5, 1.5, 0.8);
  branch(120.6, 124.4, 4.2);
  mushroom(123.6, 4.2, 5.0, 0.65);
  branch(119.4, 122.6, 7.6);
  mushroom(120.2, 7.6, 8.4, 0.65);
  branch(122.2, 128, 11.0);
  bramble(122.8, 127.6, 11.0, 1.45);
  moth(125.2, 13.8, 1.4, 0.6);
  ground(128, 145.5, 10.5);
  bramble(130, 136, 10.5, 1.6);
  moth(134, 12.9, 2.2, 0.7);
  ground(145.5, 149, 24, { stone: true });

  [[1.5, 0], [33, 0], [65.5, 0], [91.5, 0.5], [117.5, 0.5], [129.5, 10.5]].forEach(([x, y]) => checkpoint(x, y));

  // fireflies (cutout quads, unlit so they glow)
  const ffMat = new THREE.MeshBasicMaterial({ map: tex("firefly"), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, color: "#ffffff" });
  disp.push(ffMat);
  const ffH = 0.55, ffW = ffH * aspectOf("firefly");
  const FF = [
    [4, 1.0], [6.5, 1.0], [9.75, 2.3], [16, 3.3], [16, 5.6], [24.5, 1.4],
    [38.3, 4.6], [44, 8.0], [48.8, 11.4], [50, 11.4], [51.2, 11.4], [52.4, 11.4], [50.6, 12.7], [48, 1.6], [61.5, 4.3],
    [77.5, 2.4], [81.8, 3.6], [85.8, 3.4], [92.5, 1.6], [99.4, 5.6], [103, 4.0], [110, 1.6],
    [119.2, 3.4], [122.6, 5.1], [121, 8.6], [124.5, 12.0], [126.6, 13.4], [131, 11.6], [134.5, 12.4], [137.5, 11.6],
  ];
  const fireflies = FF.map(([x, y], i) => {
    const g = new THREE.Group(); g.position.set(x, y, 0.15);
    const q = new THREE.Mesh(G.planeC, ffMat); q.scale.set(ffW, ffH, 1); g.add(q);
    const gl = glow(C.lime, 1.4, 0.7); gl.position.z = 0.05; g.add(gl); root.add(g);
    return { x, y, g, gl, ph: i * 1.7, state: 0, t: 0, sx: x, sy: y, lit: -1 };
  });
  const TOTAL = fireflies.length;

  // Heart tree
  const TREE_X = 140, TREE_Y = 10.5, TREE_H = 9.5;
  const treeMat = cutMat("heart_tree", { color: "#46506a", emissive: C.gold, emissiveIntensity: 0 });
  const treeDark = new THREE.Color("#46506a"), treeLit = new THREE.Color("#ffffff");
  const treeGroup = new THREE.Group();
  const treeMesh = new THREE.Mesh(G.plane, treeMat); treeMesh.scale.set(TREE_H * aspectOf("heart_tree"), TREE_H, 1);
  treeGroup.add(treeMesh);
  treeGroup.position.set(TREE_X, TREE_Y - 0.05, -1.4); root.add(treeGroup);
  const treeGlow = glow(C.gold, 12, 0.06); treeGlow.position.set(TREE_X, TREE_Y + 4.5, -1.7); root.add(treeGlow);
  const treeLight = new THREE.PointLight(C.gold, 0, 30, 1.6); treeLight.position.set(TREE_X, TREE_Y + 4.5, 2); root.add(treeLight);

  function groundTopAt(x) {
    let best = null;
    for (const s of solids) if (s.kind === "ground" && s.y0 < -5 && x > s.x0 + 0.3 && x < s.x1 - 0.3 && (best === null || s.y1 > best)) best = s.y1;
    return best;
  }

  // ---------------------------------------------------------------- backdrop & parallax
  const farGeo = new THREE.PlaneGeometry(140, 78.75);
  const farMat = new THREE.MeshBasicMaterial({ map: tex("bg_forest_night"), fog: false, depthWrite: false, color: "#b8c6e0" });
  disp.push(farGeo, farMat);
  const far = new THREE.Mesh(farGeo, farMat); far.position.z = -60; far.renderOrder = -10; root.add(far);
  const FAR_F = 0.1;

  const trunkTex = tex("parallax_trunks");
  function layer(z, f, tw, tint, baseY, opacity, order) {
    const mat = new THREE.MeshBasicMaterial({ map: trunkTex, transparent: true, alphaTest: 0.02, depthWrite: false, fog: false, color: tint, opacity });
    const th = tw * 9 / 16, geo = new THREE.PlaneGeometry(tw, th); disp.push(mat, geo);
    const g = new THREE.Group(); g.position.z = z; g.renderOrder = order;
    let i = 0;
    for (let x = -80; x < 150 * f + 80; x += tw * 0.98, i++) {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, baseY + th / 2, 0); m.scale.x = i % 2 ? -1 : 1; m.renderOrder = order; g.add(m);
    }
    root.add(g); return { g, f };
  }
  const layers = [
    layer(-40, 0.2, 56, "#3e5788", -9, 0.55, -9),
    layer(-26, 0.3, 44, "#5a77a8", -6, 0.75, -8),
    layer(-13, 0.6, 30, "#7f9fb8", -5, 0.92, -7),
  ];

  const bgBark = texMat("tex_bark", 1, 8, "#5d6f8c");
  for (let x = -12; x < 158; x += 5 + rnd() * 4) {
    const t = new THREE.Mesh(G.trunk, bgBark), r = 0.6 + rnd() * 0.9;
    t.scale.set(r, 60, r); t.position.set(x, 14, -6.5 - rnd() * 6); t.rotation.z = (rnd() - 0.5) * 0.08; root.add(t);
  }
  {
    const da = aspectOf("bounce_mushroom");
    for (let i = 0; i < 18; i++) {
      const x = rnd() * 150 - 3, top = groundTopAt(x);
      if (top === null) continue;
      const h = 0.8 + rnd() * 1.6;
      const m = new THREE.Mesh(G.plane, MAT.deco);
      m.scale.set(h * da * (rnd() < 0.5 ? -1 : 1), h, 1);
      m.position.set(x, top - 0.02, -3.0 - rnd() * 1.2);
      root.add(m);
    }
  }
  {
    const spots = [];
    for (let x = -4; x < 146; x += 3.5 + rnd() * 3) { const t = groundTopAt(x); if (t !== null) spots.push([x, t]); }
    const fern = new THREE.InstancedMesh(G.fern, M.fern, Math.max(1, spots.length * 5));
    let k = 0;
    for (const [x, top] of spots) {
      const z = 0.9 + rnd() * 0.6;
      for (let j = 0; j < 5; j++) {
        dummy.position.set(x + (rnd() - 0.5) * 0.6, top - 0.1, z + (rnd() - 0.5) * 0.3);
        dummy.rotation.set((rnd() - 0.5) * 0.5, 0, (j - 2) * 0.32 + (rnd() - 0.5) * 0.2);
        dummy.scale.set(1, 0.6 + rnd() * 0.8, 1); dummy.updateMatrix(); fern.setMatrixAt(k++, dummy.matrix);
      }
    }
    fern.count = k; root.add(fern);
    const tiny = new THREE.InstancedMesh(G.ball, M.tiny, 44);
    let c = 0;
    for (let i = 0; i < 90 && c < 44; i++) {
      const x = rnd() * 150 - 4, top = groundTopAt(x);
      if (top === null) continue;
      dummy.position.set(x, top + 0.04, rnd() < 0.5 ? 1.0 + rnd() * 0.5 : -2 - rnd() * 2.2);
      dummy.rotation.set(0, 0, 0);
      const sc = 0.06 + rnd() * 0.08; dummy.scale.set(sc, sc * 0.6, sc); dummy.updateMatrix(); tiny.setMatrixAt(c++, dummy.matrix);
    }
    tiny.count = c; root.add(tiny);
  }
  const NP = 140, pPos = new Float32Array(NP * 3), pSeed = new Float32Array(NP);
  for (let i = 0; i < NP; i++) {
    pPos[i * 3] = rnd() * 44 - 20; pPos[i * 3 + 1] = rnd() * 16 - 4; pPos[i * 3 + 2] = rnd() * 11 - 6; pSeed[i] = rnd() * 6.28;
  }
  const pollenGeo = new THREE.BufferGeometry();
  pollenGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  const pollenMat = new THREE.PointsMaterial({ size: 0.14, map: glowTex, color: C.lime, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 });
  disp.push(pollenGeo, pollenMat);
  const pollen = new THREE.Points(pollenGeo, pollenMat); pollen.frustumCulled = false; root.add(pollen);

  const ffLights = [];
  for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(C.lime, 0, 5, 2); root.add(l); ffLights.push(l); }

  // ---------------------------------------------------------------- hero (3D character)
  const hero = new THREE.Group(); root.add(hero);
  const heroPup = new THREE.Group(); hero.add(heroPup);
  const heroFace = new THREE.Group(); heroPup.add(heroFace);
  heroFace.add(makeCharacter("lumi_hero", 1.15, { shape: "creature" }));
  const jarMat = std({ color: C.gold, emissive: C.gold, emissiveIntensity: 0.6, roughness: 0.2, transparent: true, opacity: 0.85 });
  const jar = new THREE.Mesh(G.ball, jarMat); jar.scale.setScalar(0.11); jar.position.set(0, 0.62, -0.32); heroFace.add(jar);
  const lanternGlow = glow(C.gold, 0.5, 0.5); lanternGlow.position.set(0, 0.62, -0.32); heroFace.add(lanternGlow);
  const lanternLight = new THREE.PointLight(C.gold, 2, 7, 2); root.add(lanternLight);
  const warmKey = new THREE.PointLight("#ffc98a", 10, 18, 1.5); root.add(warmKey);
  const puppet = forge.three.puppet(heroPup);
  const blobMat = new THREE.MeshBasicMaterial({ color: "#000000", map: glowTex, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  disp.push(blobMat);
  const blob = new THREE.Mesh(G.disc, blobMat); blob.rotation.x = -Math.PI / 2; root.add(blob);

  const HW = 0.3, PH = 0.9;
  const P = { x: 2.5, y: 0, vx: 0, vy: 0, prevY: 0, grounded: true, coyote: 0, buffer: 0, jumping: false, facing: 1, invuln: 0, lock: 0, crouch: false, flip: 1, squashY: 1, fallV: 0, lanternPop: 0 };

  // ---------------------------------------------------------------- state & HUD
  let lives = Math.max(1, Math.round(tune("startLives", 3)));
  let score = 0, count = 0, elapsed = 0, animT = 0, frame = 0;
  let state = "play", stateT = 0, ended = false, cpIndex = 0, goalAnnounced = false, treeMsgCD = 0, combo = 0, comboT = 0, burstT = 0;
  let lookX = P.x + 1.6, camY = 1.4;
  cps[0].active = true;

  const TRIG = [
    [12.5, "Champignon ! Maintiens Saut à l'impact pour rebondir plus haut"],
    [19, "Un Ronceux ! Saute-lui dessus pour l'écraser"],
    [30, "Zone 2 — Les Chapeaux"],
    [55.5, "Trop haut ? Maintiens Saut en touchant le champignon !"],
    [73, "Zone 3 — Le Marais Toxique : évite les champignons violets"],
    [86.5, "Phalène d'ombre : étourdis-la d'un rebond"],
    [110, "Zone 4 — L'Arbre-Cœur"],
  ].map(([x, msg]) => ({ x, msg, done: false }));

  const goalNow = () => clamp(Math.round(tune("fireflyGoal", 20)), 1, TOTAL);
  const hc = {};
  function hud() {
    const goal = goalNow(), f = `${count} / ${goal}`, bar = Math.round(clamp(count / goal, 0, 1) * 100) / 100, cp = `${cpIndex + 1}/${cps.length}`;
    if (hc.f !== f) { forge.hud.set("fireflies", f, { label: "Lucioles", icon: "✨" }); hc.f = f; }
    if (hc.l !== lives) { forge.hud.set("lives", lives, { label: "Vies", icon: "❤️" }); hc.l = lives; }
    if (hc.b !== bar) { forge.hud.bar("lantern", bar, { label: "Lanterne", color: C.gold }); hc.b = bar; }
    if (hc.s !== score) { forge.hud.set("score", score, { label: "Score", icon: "⭐" }); hc.s = score; }
    if (hc.c !== cp) { forge.hud.set("checkpoint", cp, { label: "Étape", icon: "🔆" }); hc.c = cp; }
  }
  hud();
  forge.audio.music("music_forest", { volume: 0.55 });
  forge.hud.message("← → courir · Espace sauter (maintenir = plus haut) · ↓ viser", 3200);

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const stats = () => ({ "Lucioles": `${count}/${TOTAL}`, "Score": score, "Temps": fmt(elapsed), "Meilleur": saveBest() });
  function saveBest() {
    const best = Number(forge.load("lumi_best_score", 0)) || 0;
    if (score > best) forge.save("lumi_best_score", score);
    return Math.max(best, score);
  }

  // ---------------------------------------------------------------- player physics
  function moveX(h) {
    P.x += P.vx * h;
    for (const s of solids) {
      if (s.oneWay) continue;
      if (P.x + HW > s.x0 && P.x - HW < s.x1 && P.y + PH > s.y0 + 0.001 && P.y < s.y1 - 0.001) {
        if (P.vx > 0) P.x = s.x0 - HW; else if (P.vx < 0) P.x = s.x1 + HW;
        else P.x = P.x < (s.x0 + s.x1) / 2 ? s.x0 - HW : s.x1 + HW;
        P.vx = 0;
      }
    }
  }
  function bounce(m, held) {
    const B = tune("mushroomBounce", 15), strong = held || P.buffer > 0;
    P.y = m.capTop; P.vy = strong ? B : B * 0.68; P.jumping = false; P.buffer = 0; P.coyote = 0;
    m.s = strong ? 0.5 : 0.7; m.sv = 0;
    forge.audio.play("sfx_bounce", { volume: 0.8, rate: strong ? 1.15 : 0.95 });
    forge.three.burst(V3(m.x, m.capTop, 0.2), { color: C.lime, count: strong ? 22 : 12, speed: 3, life: 0.7, size: 0.12 });
    forge.shake(strong ? 0.12 : 0.05);
  }
  function moveY(h, held) {
    const py0 = P.y;
    P.y += P.vy * h;
    if (P.vy <= 0) {
      for (const m of mushrooms) {
        if (!m.toxic && py0 >= m.capTop - 0.02 && P.y <= m.capTop && Math.abs(P.x - m.x) < m.r * 0.9 + 0.12) { bounce(m, held); return; }
      }
      for (const s of solids) {
        if (P.x + HW > s.x0 && P.x - HW < s.x1 && py0 >= s.y1 - 0.02 && P.y <= s.y1) { P.y = s.y1; P.vy = 0; P.grounded = true; }
      }
    } else {
      for (const s of solids) {
        if (!s.oneWay && P.x + HW > s.x0 && P.x - HW < s.x1 && py0 + PH <= s.y0 + 0.02 && P.y + PH > s.y0) { P.y = s.y0 - PH; P.vy = 0; }
      }
    }
  }

  function hurt(dir, up = 6) {
    if (P.invuln > 0 || state !== "play") return;
    lives--; P.invuln = 1.6; P.vx = dir * 6; P.vy = up; P.lock = 0.3; P.jumping = false; combo = 0;
    forge.audio.play("sfx_hit", { volume: 0.9 });
    forge.shake(0.5);
    forge.three.burst(V3(P.x, P.y + 0.5, 0.3), { color: "#ff6b6b", count: 18, speed: 4, life: 0.6, size: 0.12 });
    hud();
    if (lives <= 0) die();
  }
  function die() {
    state = "dying"; stateT = 0;
    forge.audio.play("sfx_lose", { volume: 0.9 });
    forge.shake(0.7);
  }
  function fellInVoid() {
    lives--; hud();
    forge.shake(0.6);
    if (lives <= 0) { die(); return; }
    forge.audio.play("sfx_lose", { volume: 0.6, rate: 1.3 });
    const cp = cps[cpIndex];
    P.x = cp.x + 0.8; P.y = cp.y + 0.05; P.vx = P.vy = 0; P.invuln = 1.5; P.jumping = false; P.buffer = 0;
    forge.hud.message("Ouille ! Retour à la pierre lumineuse", 1600);
    forge.three.burst(V3(P.x, P.y + 0.6, 0.3), { color: C.gold, count: 24, speed: 3, life: 0.8, size: 0.12 });
  }
  function stomp(x, y, pts) {
    const held = forge.input.down("jump") || forge.input.down("up");
    P.vy = tune("jumpForce", 9.5) * (held ? 1.05 : 0.75); P.jumping = false;
    combo++; comboT = 1.5;
    const gain = pts * Math.min(combo, 4);
    score += gain; hud();
    forge.audio.play("sfx_stomp", { volume: 0.9, rate: 0.9 + combo * 0.08 });
    forge.shake(0.25);
    forge.three.burst(V3(x, y, 0.3), { color: C.violet, count: 20, speed: 4, life: 0.6, size: 0.14 });
    if (gain > 0) forge.three.floatText(V3(x, y + 0.6, 0.4), `+${gain}`, { color: C.gold });
  }

  function updatePlayer(dt) {
    const I = forge.input;
    const spd = tune("playerSpeed", 5.5), g = tune("gravity", 26), jf = tune("jumpForce", 9.5), coy = tune("coyoteTime", 0.12);
    const ax = I.axis().x;
    let ix = Math.abs(ax) > 0.2 ? ax : 0;
    if (I.down("left")) ix = -1; else if (I.down("right")) ix = 1;
    const held = I.down("jump") || I.down("up");
    P.crouch = I.down("down");
    P.prevY = P.y;
    P.lock -= dt; P.invuln -= dt;
    if (P.lock > 0) { P.vx = approach(P.vx, 0, 8 * dt); }
    else {
      const target = ix * spd * (P.crouch ? (P.grounded ? 0.35 : 0.6) : 1);
      const a = ix !== 0 ? (P.grounded ? 45 : 28) : (P.grounded ? 50 : 12);
      P.vx = approach(P.vx, target, a * dt);
      if (ix !== 0) P.facing = ix > 0 ? 1 : -1;
    }
    if (I.pressed("jump") || I.pressed("up")) P.buffer = 0.13;
    P.coyote = P.grounded ? coy : P.coyote - dt;
    if (P.buffer > 0 && P.coyote > 0 && P.lock <= 0) {
      P.vy = jf; P.jumping = true; P.buffer = 0; P.coyote = 0; P.grounded = false;
      forge.audio.play("sfx_jump", { volume: 0.6, rate: 0.95 + rnd() * 0.1 });
      forge.three.burst(V3(P.x, P.y + 0.05, 0.2), { color: C.cream, count: 6, speed: 1.5, life: 0.35, size: 0.08 });
    }
    if (P.jumping && !held && P.vy > 0) { P.vy *= 0.5; P.jumping = false; }
    if (P.vy <= 0) P.jumping = false;
    P.vy -= g * (P.vy < 0 ? 1.15 : 1) * (P.crouch && P.vy < 0 ? 1.4 : 1) * dt;
    P.vy = Math.max(P.vy, -22);
    P.buffer -= dt;

    const was = P.grounded, vyBefore = P.vy;
    P.grounded = false;
    const h = dt / 2;
    for (let i = 0; i < 2; i++) { moveX(h); moveY(h, held); }
    if (!Number.isFinite(P.x) || !Number.isFinite(P.y)) { P.x = cps[cpIndex].x; P.y = cps[cpIndex].y; P.vx = P.vy = 0; }
    if (P.grounded && !was && vyBefore < -7) {
      forge.three.burst(V3(P.x, P.y + 0.05, 0.2), { color: C.cream, count: 10, speed: 2, life: 0.4, size: 0.09 });
      forge.audio.play("step", { volume: 0.35 });
      P.squashY = 0.75;
    }
    if (P.grounded) combo = 0;

    // hazards
    for (const z of hazards) {
      if (P.x + HW * 0.8 > z.x0 && P.x - HW * 0.8 < z.x1 && P.y + PH * 0.8 > z.y0 && P.y < z.y1) {
        const dir = P.x < z.cx ? -1 : 1;
        if (!z.toxic && P.invuln > 0 && P.vy <= 0) { P.vy = 11; P.vx = dir * 4; }
        else hurt(z.toxic ? dir : dir * 0.7, z.toxic ? 7 : 11);
      }
    }
    if (P.y < -9 && state === "play") fellInVoid();

    // checkpoints
    for (let i = cpIndex + 1; i < cps.length; i++) {
      const cp = cps[i];
      if (P.x >= cp.x - 0.3 && Math.abs(P.y - cp.y) < 4) {
        for (let j = cpIndex + 1; j <= i; j++) cps[j].active = true;
        cpIndex = i; cp.pulse = 1; hud();
        forge.audio.play("powerup", { volume: 0.6 });
        forge.three.burst(V3(cp.x, cp.y + 1.2, -0.8), { color: C.lime, count: 26, speed: 3, life: 0.9, size: 0.12 });
        forge.hud.message("Pierre lumineuse allumée !", 1400);
      }
    }
    for (const t of TRIG) if (!t.done && P.x > t.x) { t.done = true; forge.hud.message(t.msg, 2600); }

    // heart tree
    treeMsgCD -= dt;
    if (Math.abs(P.x - TREE_X) < 2.5 && Math.abs(P.y - TREE_Y) < 2.5) {
      if (count >= goalNow()) {
        state = "win"; stateT = 0;
        forge.audio.play("sfx_win", { volume: 1 });
        forge.audio.stopMusic();
        forge.shake(0.6);
        forge.hud.message("L'Arbre-Cœur se rallume !", 2600);
      } else if (treeMsgCD <= 0) {
        treeMsgCD = 4;
        forge.hud.message(`L'arbre reste sombre… il manque ${goalNow() - count} lucioles. Retourne en chercher !`, 3000);
      }
    }
  }

  // ---------------------------------------------------------------- world update
  const overlap = (a0, a1, b0, b1, c0, c1, d0, d1) => a0 < c1 && a1 > c0 && b0 < d1 && b1 > d0;

  function updateWorld(dt) {
    const es = tune("enemySpeed", 1.8), play = state === "play";
    const px0 = P.x - HW, px1 = P.x + HW, py0 = P.y, py1 = P.y + PH;

    for (const m of mushrooms) {
      m.sv += (1 - m.s) * 180 * dt - m.sv * 10 * dt; m.s += m.sv * dt;
      const s = clamp(m.s, 0.4, 1.6);
      m.sq.scale.set(1 + (1 - s) * 0.6, s, 1);
    }

    for (const b of brambles) {
      if (b.dead) {
        b.dt += dt;
        b.face.scale.y = Math.max(0.15, 1 - b.dt * 4);
        b.g.position.y = b.y - b.dt * b.dt * 4;
        if (b.dt > 0.8) b.g.visible = false;
        continue;
      }
      b.ph += dt;
      if (play || state === "dying") {
        b.x += b.dir * es * b.mul * dt;
        if (b.x > b.x1) { b.x = b.x1; b.dir = -1; } else if (b.x < b.x0) { b.x = b.x0; b.dir = 1; }
      }
      b.g.position.set(b.x, b.y + Math.abs(Math.sin(b.ph * 8)) * 0.06, 0);
      b.g.rotation.z = Math.sin(b.ph * 8) * 0.08;
      b.flip = damp(b.flip, b.dir, 10, dt);
      b.face.rotation.y = b.flip * YAW_BRAMBLE;
      if (play && overlap(px0, px1, py0, py1, b.x - 0.4, b.x + 0.4, b.y, b.y + 0.8)) {
        if (P.vy < 0 && P.prevY >= b.y + 0.35) { b.dead = true; b.dt = 0; stomp(b.x, b.y + 0.5, 250); }
        else hurt(P.x < b.x ? -1 : 1);
      }
    }

    for (const m of moths) {
      if (m.stun > 0) {
        m.stun -= dt; m.dy = Math.max(m.dy - dt * 0.8, -0.6);
        m.g.rotation.z += dt * 6;
        if (m.stun <= 0) { m.g.rotation.z = 0; tintList(m.tint, null); }
      } else {
        m.t += dt * (0.6 + es * 0.25); m.dy = damp(m.dy, 0, 2, dt);
      }
      m.x = m.cx + Math.sin(m.t * 0.9) * m.rx;
      m.y = m.cy + Math.sin(m.t * 2.6) * m.amp + m.dy;
      m.g.position.set(m.x, m.y, 0);
      const dir = Math.cos(m.t * 0.9) >= 0 ? 1 : -1, flap = m.stun > 0 ? 0.9 : 0.75 + 0.25 * Math.abs(Math.sin(animT * 14));
      m.flip = damp(m.flip, dir, 8, dt);
      m.face.rotation.y = m.flip * YAW_MOTH;
      m.face.scale.set(flap, 1, 1);
      m.gl.material.opacity = m.stun > 0 ? 0.1 : 0.35 + Math.sin(animT * 5) * 0.08;
      if (play && m.stun <= 0 && overlap(px0, px1, py0, py1, m.x - 0.4, m.x + 0.4, m.y - 0.35, m.y + 0.35)) {
        if (P.vy < 0 && P.prevY >= m.y - 0.05) {
          m.stun = 3; tintList(m.tint, stunColor);
          stomp(m.x, m.y, m.scored ? 0 : 250); m.scored = true;
        } else hurt(P.x < m.x ? -1 : 1);
      }
    }

    // fireflies
    const goal = goalNow(), cx = P.x, cy = P.y + 0.45;
    for (const f of fireflies) {
      if (f.state === 2) continue;
      if (f.state === 0) {
        f.g.position.set(f.x + Math.sin(animT * 1.3 + f.ph) * 0.12, f.y + Math.sin(animT * 2 + f.ph) * 0.15, 0.15);
        f.gl.material.opacity = 0.5 + Math.sin(animT * 4 + f.ph) * 0.2;
        f.g.rotation.z = Math.sin(animT * 3 + f.ph) * 0.15;
        const dx = f.g.position.x - cx, dy = f.g.position.y - cy;
        if (play && dx * dx + dy * dy < 0.56) {
          f.state = 1; f.t = 0; f.sx = f.g.position.x; f.sy = f.g.position.y;
          count++; score += 100; comboT = 1.2; hud();
          forge.audio.play("sfx_firefly", { volume: 0.8, rate: 0.95 + Math.min(count, 30) * 0.012 });
          forge.three.burst(f.g.position.clone(), { color: C.lime, count: 14, speed: 2.5, life: 0.6, size: 0.1 });
          forge.three.floatText(V3(f.sx, f.sy + 0.5, 0.4), "+100", { color: C.lime });
          if (count >= goal && !goalAnnounced) {
            goalAnnounced = true;
            forge.hud.message("La lanterne brille assez ! Rejoins l'Arbre-Cœur", 2800);
            forge.audio.play("powerup", { volume: 0.7 });
          }
        }
      } else {
        f.t += dt * 3;
        const k = Math.min(f.t, 1);
        f.g.position.set(f.sx + (P.x - P.facing * 0.24 - f.sx) * k, f.sy + (P.y + 0.6 - f.sy) * k + Math.sin(k * Math.PI) * 0.6, 0.2);
        f.g.scale.setScalar(1 - k * 0.8);
        if (k >= 1) { f.state = 2; f.g.visible = false; P.lanternPop = 1; }
      }
    }
    frame++;
    for (const l of ffLights) {
      let bi = -1, bd = 144;
      for (let i = 0; i < TOTAL; i++) {
        const f = fireflies[i];
        if (f.state || f.lit === frame) continue;
        const dx = f.g.position.x - P.x, dy = f.g.position.y - P.y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; bi = i; }
      }
      if (bi >= 0) { fireflies[bi].lit = frame; l.position.copy(fireflies[bi].g.position); l.intensity = 1.6 + Math.sin(animT * 4 + bi) * 0.4; }
      else l.intensity = 0;
    }

    for (const cp of cps) {
      cp.pulse = Math.max(0, cp.pulse - dt * 1.2);
      cp.mat.emissiveIntensity = cp.active ? 0.55 + cp.pulse * 0.9 + Math.sin(animT * 2 + cp.x) * 0.08 : 0.04;
      cp.gl.position.y = cp.h * 0.62 + (cp.active ? Math.sin(animT * 2 + cp.x) * 0.08 : 0);
      cp.gl.material.opacity = cp.active ? 0.55 + cp.pulse * 0.4 : 0.1;
      cp.gl.scale.setScalar(1.3 + cp.pulse * 2);
      const sp = 1 + cp.pulse * 0.1;
      cp.st.scale.set(cp.w * (2 - sp), cp.h * sp, 1);
    }

    comboT -= dt;
    const ratio = clamp(count / goal, 0, 1);
    treeGlow.material.opacity = state === "win" ? treeGlow.material.opacity : 0.05 + ratio * 0.1 + Math.sin(animT * 1.5) * 0.02;

    // pollen
    for (let i = 0; i < NP; i++) {
      const j = i * 3;
      pPos[j] += Math.sin(animT * 0.7 + pSeed[i]) * 0.3 * dt;
      pPos[j + 1] += (0.1 + (pSeed[i] % 1) * 0.2) * dt;
      if (pPos[j] < lookX - 22) pPos[j] += 44; else if (pPos[j] > lookX + 22) pPos[j] -= 44;
      if (pPos[j + 1] > camY + 10) pPos[j + 1] -= 16; else if (pPos[j + 1] < camY - 6) pPos[j + 1] += 16;
    }
    pollenGeo.attributes.position.needsUpdate = true;
  }

  // ---------------------------------------------------------------- visuals & camera
  function updateVisuals(dt) {
    hero.position.set(P.x, P.y, 0);
    P.flip = damp(P.flip, P.facing, 14, dt);
    P.squashY = damp(P.squashY, P.crouch ? 0.72 : 1, 14, dt);
    const wide = (2 - P.squashY) ** 0.5;
    heroFace.scale.set(wide, P.squashY, wide);
    heroFace.rotation.y = P.flip * YAW_HERO;
    if (state !== "dying") puppet.update({ vx: P.vx, vz: 0, vy: P.vy, grounded: P.grounded, speed: Math.abs(P.vx) }, dt);
    hero.visible = state !== "play" || P.invuln <= 0 || Math.floor(animT * 16) % 2 === 0;

    const goal = goalNow(), ratio = clamp(count / goal, 0, 1);
    P.lanternPop = Math.max(0, (P.lanternPop || 0) - dt * 3);
    lanternLight.intensity = 1.6 + ratio * 7 + P.lanternPop * 4 + Math.sin(animT * 6) * 0.2;
    lanternLight.distance = 6 + ratio * 7;
    lanternLight.position.set(P.x - P.facing * 0.25, P.y + 0.8, 0.8);
    lanternGlow.material.opacity = 0.3 + ratio * 0.6;
    lanternGlow.scale.setScalar(0.4 + ratio * 0.9 + P.lanternPop * 0.4);
    jarMat.emissiveIntensity = 0.5 + ratio * 3 + P.lanternPop * 2;
    warmKey.position.set(P.x - 1.5, P.y + 3, 4.5);

    let top = -1e9;
    for (const s of solids) if (P.x > s.x0 && P.x < s.x1 && s.y1 <= P.y + 0.05 && s.y1 > top) top = s.y1;
    if (top > -1e8 && state !== "dying") {
      const d = P.y - top;
      blob.visible = true; blob.position.set(P.x, top + 0.02, 0);
      blob.scale.setScalar(clamp(0.45 - d * 0.04, 0.15, 0.45));
      blobMat.opacity = clamp(0.45 - d * 0.05, 0.08, 0.45);
    } else blob.visible = false;

    lookX = damp(lookX, clamp(P.x + P.facing * 1.6, -1, 142), 4, dt);
    camY = damp(camY, P.y + 1.4, 3, dt);
    camera.position.set(lookX, camY + 1.3, 15);
    camera.lookAt(lookX, camY, 0);
    far.position.set(lookX * (1 - FAR_F), camY * (1 - FAR_F) + 4, -60);
    for (const l of layers) l.g.position.set(lookX * (1 - l.f), camY * (1 - l.f) * 0.5, l.g.position.z);
    if (sun) {
      sun.position.set(P.x + 8, P.y + 20, 12);
      if (sun.target) { sun.target.position.set(P.x, P.y, 0); sun.target.updateMatrixWorld(); }
    }
  }

  // ---------------------------------------------------------------- loop
  return {
    update(dt) {
      dt = Math.min(Math.max(Number(dt) || 0, 0), 1 / 30);
      animT += dt;
      if (state === "play") { elapsed += dt; updatePlayer(dt); }
      else if (state === "dying") {
        stateT += dt;
        heroPup.rotation.z += dt * 10;
        hero.position.y += (1.5 - stateT * 3) * dt;
        P.y = hero.position.y;
        heroPup.scale.setScalar(Math.max(0.01, 1 - stateT * 0.6));
        if (stateT > 1.4 && !ended) {
          ended = true;
          forge.lose({ title: "La lanterne s'est éteinte…", subtitle: "Les ronces d'ombre gardent la forêt. Réessaie, Lumi !", stats: stats() });
        }
      } else if (state === "win") {
        stateT += dt;
        P.vx = approach(P.vx, 0, 20 * dt);
        const k = clamp(stateT / 2.5, 0, 1);
        treeMat.color.copy(treeDark).lerp(treeLit, k);
        treeMat.emissiveIntensity = k * 0.4;
        treeLight.intensity = k * 60;
        treeGlow.material.opacity = 0.15 + k * 0.6;
        treeGlow.scale.setScalar(12 + k * 8);
        burstT -= dt;
        if (burstT <= 0 && stateT < 3) {
          burstT = 0.18;
          forge.three.burst(V3(TREE_X + (rnd() - 0.5) * 6, TREE_Y + 2 + rnd() * 6, -0.5), { color: rnd() < 0.5 ? C.gold : C.lime, count: 24, speed: 5, life: 1.2, size: 0.16 });
          if (rnd() < 0.3) forge.shake(0.15);
        }
        if (stateT > 3.4 && !ended) {
          ended = true;
          score += lives * 500 + Math.max(0, count - goalNow()) * 200;
          hud();
          forge.win({ title: "L'Arbre-Cœur brille à nouveau !", subtitle: "Grâce à Lumi, la Forêt des Murmures retrouve sa lumière.", stats: stats() });
        }
      }
      updateWorld(dt);
      updateVisuals(dt);
      if (state === "dying") { hero.position.set(P.x, P.y, 0); hero.visible = true; }
    },
    dispose() {
      scene.remove(root);
      if (sun && sun.target && sun.target.parent === scene) scene.remove(sun.target);
      scene.background = prevBg;
      for (const k in G) G[k].dispose();
      for (const d of disp) if (d && d.dispose) d.dispose();
    },
  };
}