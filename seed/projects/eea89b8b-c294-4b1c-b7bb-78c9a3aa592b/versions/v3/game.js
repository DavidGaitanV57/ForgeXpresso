export default async function createGame(forge, ctx) {
  const { THREE, scene, camera, renderer } = ctx;
  const TOTAL = 12, TAU = Math.PI * 2, PH = 1.7, PR = 0.35;
  const inp = forge.input;

  // ---------------------------------------------------------------- helpers
  const tune = (k, f) => { const v = Number(forge.tune(k, f)); return Number.isFinite(v) ? v : f; };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapA = (d) => Math.atan2(Math.sin(d), Math.cos(d));
  const hsh = (a, b, c) => { const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453; return s - Math.floor(s); };
  const fmt = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  function setting(k, fb) {
    try {
      const s = forge.settings;
      if (s) { const v = typeof s.get === "function" ? s.get(k) : s[k]; if (v !== undefined && v !== null) return v; }
    } catch (e) { /* ignore */ }
    return fb;
  }
  function diffMul() {
    const d = String(setting("difficulty", "Normal")).toLowerCase();
    if (d.startsWith("relax")) return { s: 0.7, c: 1.4 };
    if (d.startsWith("hard")) return { s: 1.3, c: 0.75 };
    return { s: 1, c: 1 };
  }
  const sfx = (id, o) => forge.audio.play(id, o || {});
  const cineActive = () => !!(forge.cinematic && forge.cinematic.active);

  const roots = [], owned = [];
  const add = (o) => { scene.add(o); roots.push(o); return o; };
  const own = (o) => { owned.push(o); return o; };

  let gateOpen = false;

  function wuv(g, s = 0.35) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    if (!uv || !n) return g;
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      const x = p.getX(i) * s, y = p.getY(i) * s, z = p.getZ(i) * s;
      if (ay >= ax && ay >= az) uv.setXY(i, x, z); else if (ax >= az) uv.setXY(i, z, y); else uv.setXY(i, x, y);
    }
    uv.needsUpdate = true;
    return g;
  }

  const halo = (() => {
    const S = 64, d = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = ((x + 0.5) / S) * 2 - 1, dy = ((y + 0.5) / S) * 2 - 1;
      let a = Math.max(0, 1 - Math.hypot(dx, dy)); a = a * a * (3 - 2 * a);
      const i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = (a * 255) | 0;
    }
    const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
    return own(t);
  })();
  function haloSprite(color, s, op = 0.7) {
    const sp = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: halo, color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false })));
    sp.scale.set(s, s, 1);
    return sp;
  }

  // ---------------------------------------------------------------- look & light
  forge.three.skydome("bg_sky_sea", 450);
  forge.three.fog("#b8aec8", 55, 260);
  // Bloom was blowing out the sky + emissive crystals (strength 0.65 / low threshold).
  forge.three.bloom(0.14, 0.28, 0.92);
  let bloomCur = 0.14;
  function setBloom(s, force) {
    if (force || Math.abs(s - bloomCur) > 0.02) { bloomCur = s; try { forge.three.bloom(s, 0.28, 0.92); } catch (e) { /* ignore */ } }
  }
  const lights = forge.three.lights({ sun: "#ffd6a0", sky: "#a9c8ff", ground: "#4A3F55", intensity: 0.55, shadowSize: 44 }) || {};
  if (renderer && renderer.toneMappingExposure != null) renderer.toneMappingExposure = 0.82;
  const sun = lights.sun;
  if (sun && sun.target && !sun.target.parent) add(sun.target);

  // ---------------------------------------------------------------- materials
  const mStone = forge.three.material("tex_ruin_stone", { roughness: 0.92 });
  const mMoss = forge.three.material("tex_moss_turf", { roughness: 0.95 });
  const mCrack = forge.three.material("tex_cracked_slab", { roughness: 0.9 });
  const mRock = forge.three.material("tex_ruin_stone", { color: "#a596b3", roughness: 1 });
  mRock.flatShading = true; mRock.needsUpdate = true;
  function runeMat(i, c = "#7FD1E8") {
    const m = forge.three.material("tex_rune_glow", { roughness: 0.5, emissive: c, emissiveIntensity: i });
    if (m.map) m.emissiveMap = m.map;
    m.needsUpdate = true;
    return m;
  }
  const mRune = runeMat(0.28);
  const mGlow = own(new THREE.MeshStandardMaterial({ color: "#c6f3ff", emissive: "#7FD1E8", emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.55, flatShading: true }));
  const octa = own(new THREE.OctahedronGeometry(1, 0));

  // ---------------------------------------------------------------- 3D character models (with placeholder fallback)
  const modelList = (() => { try { return forge.assets.list("model") || []; } catch (e) { return []; } })();
  const hasGlb = (id) => modelList.some((m) => m && m.id === id + "_3d" && (m.available === true || (m.available == null && !!m.url)));
  const pendingModels = [];
  const _box = new THREE.Box3(), _bv = V();

  function cloneMats(obj, cb) {
    const out = [];
    obj.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const conv = (m) => { const c = own(m.clone()); out.push(c); return c; };
      o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    });
    if (cb) for (const m of out) cb(m);
    return out;
  }
  function finalizeModel(rec) {
    const m = rec.model;
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    try {
      m.updateWorldMatrix(true, true);
      _box.setFromObject(m);
      if (!_box.isEmpty()) {
        _box.getCenter(_bv); _bv.y = _box.min.y;
        rec.root.worldToLocal(_bv);
        if (Number.isFinite(_bv.y) && Math.abs(_bv.y) > 0.01 && Math.abs(_bv.y) < rec.h) m.position.y -= _bv.y;
      }
    } catch (e) { /* keep base as provided */ }
  }
  function checkReady(rec) {
    if (rec.ready || !rec.model) return rec.ready;
    let n = 0;
    rec.model.traverse((o) => { if (o.isMesh) n++; });
    if (!n) return false;
    rec.ready = true;
    finalizeModel(rec);
    rec.model.visible = true; rec.ph.visible = false;
    if (rec.onReady) { try { rec.onReady(rec.model, rec); } catch (e) { /* ignore */ } }
    return true;
  }
  function charModel(imageId, h, opts, buildPh, onReady) {
    const root = new THREE.Group();
    const ph = buildPh();
    ph.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    root.add(ph);
    const rec = { root, ph, model: null, h, ready: false, poll: 0, tries: 0, mats: [], onReady };
    let m = null;
    try {
      // Tripo text→3D faces +X; third-person aims +Z via atan2(vx,vz) — yaw -PI/2 aligns nose to move dir.
      m = forge.three.character(imageId, h, { ...(opts || {}), yaw: (opts && opts.yaw !== undefined) ? opts.yaw : -Math.PI / 2 });
    } catch (e) { m = null; }
    if (m && m.isObject3D) {
      m.visible = false; root.add(m); rec.model = m;
      if (!checkReady(rec)) pendingModels.push(rec);
    }
    return rec;
  }
  function pollModels(dt) {
    for (let i = pendingModels.length - 1; i >= 0; i--) {
      const r = pendingModels[i];
      r.poll -= dt; if (r.poll > 0) continue;
      r.poll = 0.25; r.tries++;
      if (checkReady(r) || r.tries > 240) pendingModels.splice(i, 1); // give up after ~60 s, placeholder stays
    }
  }

  // ---------------------------------------------------------------- builders
  function mesh(geo, mat, x, y, z, cast = true) {
    const m = new THREE.Mesh(own(geo), mat);
    m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true;
    add(m); m.updateMatrixWorld(true);
    return m;
  }
  let seedN = 1;
  function rockGeo(r, h, seed) {
    const g = new THREE.ConeGeometry(r, h, 8, 3);
    g.rotateX(Math.PI);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y > h / 2 - 1e-3) continue;
      const kx = Math.round(x * 50), ky = Math.round(y * 50), kz = Math.round(z * 50);
      const s = 0.8 + hsh(kx, ky + seed, kz) * 0.4;
      p.setXYZ(i, x * s, y + (hsh(kz, kx, ky + seed) - 0.5) * h * 0.1, z * s);
    }
    g.computeVertexNormals();
    return wuv(g, 0.3);
  }
  function rockBase(x, yTop, z, r, h, glow) {
    mesh(rockGeo(r, h, seedN++ * 7), mRock, x, yTop - h / 2, z, false);
    if (glow) {
      const s = clamp(r / 4, 0.3, 1.2);
      const t = new THREE.Mesh(octa, mGlow);
      t.scale.set(0.4 * s, 1.3 * s, 0.4 * s);
      t.position.set(x, yTop - h - 0.7 * s, z);
      add(t);
      const hs = haloSprite("#7FD1E8", 2.2 * s, 0.28);
      hs.position.copy(t.position); add(hs);
    }
  }
  function island(x, top, z, r) {
    const m = mesh(wuv(new THREE.CylinderGeometry(r, r * 0.95, 1.4, 8)), [mStone, mMoss, mStone], x, top - 0.7, z);
    forge.physics.addStatic(m, { shape: "trimesh", friction: 0.9 });
    rockBase(x, top - 1.4, z, r * 0.95, r * 1.6, true);
    return m;
  }
  function block(x, top, z, w, h, d, o = {}) {
    const s = o.side || mStone;
    const m = mesh(wuv(new THREE.BoxGeometry(w, h, d), 0.4), o.top ? [s, s, o.top, s, s, s] : s, x, top - h / 2, z);
    forge.physics.addStatic(m, { shape: "box", friction: 0.9 });
    if (o.rock) rockBase(x, top - h, z, Math.min(w, d) * 0.5, Math.min(w, d) * 1.4, o.rock > 1);
    return m;
  }
  function pillar(x, b, z, h, broken) {
    const m = mesh(wuv(new THREE.CylinderGeometry(0.4, 0.46, h, 7), 0.5), mStone, x, b + h / 2, z);
    forge.physics.addStatic(m, { shape: "box", friction: 0.8 });
    if (!broken) {
      const c = mesh(wuv(new THREE.BoxGeometry(1.2, 0.3, 1.2), 0.5), mStone, x, b + h + 0.15, z);
      forge.physics.addStatic(c, { shape: "box", friction: 0.8 });
    }
  }
  function arch(x, b, z, w, h, alongZ = false) {
    const ox = alongZ ? 0 : w / 2, oz = alongZ ? w / 2 : 0;
    block(x - ox, b + h, z - oz, 0.7, h, 0.7);
    block(x + ox, b + h, z + oz, 0.7, h, 0.7);
    block(x, b + h + 0.5, z, alongZ ? 0.9 : w + 0.9, 0.5, alongZ ? w + 0.9 : 0.9, { side: mRune });
  }

  // crumbling tiles
  const crumbles = [];
  const hiddenMat = own(new THREE.MeshBasicMaterial({ visible: false }));
  function crumble(x, top, z, s = 2.6) {
    const proxy = new THREE.Mesh(own(new THREE.BoxGeometry(s, 0.6, s)), hiddenMat);
    proxy.visible = false; proxy.position.set(x, top - 0.3, z);
    add(proxy); proxy.updateMatrixWorld(true);
    const col = forge.physics.addStatic(proxy, { shape: "box", friction: 0.9 });
    const vis = new THREE.Group(); vis.position.copy(proxy.position); add(vis);
    const tile = new THREE.Mesh(own(wuv(new THREE.BoxGeometry(s, 0.6, s), 0.45)), [mStone, mStone, mCrack, mStone, mStone, mStone]);
    tile.castShadow = true; tile.receiveShadow = true; vis.add(tile);
    const rk = new THREE.Mesh(own(rockGeo(s * 0.4, s * 0.7, seedN++ * 13)), mRock);
    rk.position.y = -0.3 - s * 0.35; vis.add(rk);
    crumbles.push({ proxy, col, vis, x, z, top, half: s / 2, state: 0, t: 0, vy: 0 });
  }
  function setCol(c, on) {
    if (c.col && typeof c.col.setEnabled === "function") c.col.setEnabled(on);
    else if (!on) forge.physics.remove(c.proxy);
    else c.col = forge.physics.addStatic(c.proxy, { shape: "box", friction: 0.9 });
  }

  // crystals (3D model + glow halo + beam + motes)
  const crystals = [];
  const beamGeo = own(new THREE.CylinderGeometry(0.06, 0.3, 10, 6, 1, true));
  const beamMat = own(new THREE.MeshBasicMaterial({ color: "#7FD1E8", transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  function buildCrystalPh() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(octa, mGlow); m.scale.set(0.3, 0.45, 0.3); m.position.y = 0.45; g.add(m);
    return g;
  }
  function crystalReady(model, rec) {
    rec.mats = cloneMats(model, (mm) => {
      if (mm.emissive) {
        mm.emissive.set("#7FD1E8"); mm.emissiveIntensity = 0.4;
        if (mm.map) mm.emissiveMap = mm.map;
        mm.needsUpdate = true;
      }
    });
  }
  function crystal(x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const rec = charModel("aether_crystal", 0.9, { shape: "sphere", flatShading: true, color: "#bff0ff" }, buildCrystalPh, crystalReady);
    rec.root.position.y = -0.45; g.add(rec.root);
    const h = haloSprite("#7FD1E8", 1.6, 0.35); g.add(h);
    const b = new THREE.Mesh(beamGeo, beamMat); b.position.y = 5.3; g.add(b);
    add(g);
    crystals.push({ g, rec, h, b, x, y, z, ph: crystals.length * 1.7, taken: false, t: 0, pulse: 0, cinePulsed: false, motes: null });
  }

  // checkpoints
  const cps = [];
  const diskGeo = own(new THREE.CylinderGeometry(1.15, 1.25, 0.14, 16));
  const ringGeo = own(new THREE.TorusGeometry(0.55, 0.06, 6, 20));
  function checkpoint(x, top, z) {
    const mat = runeMat(0.2, "#B8A9C9");
    const disk = new THREE.Mesh(diskGeo, mat); disk.position.set(x, top + 0.07, z); disk.receiveShadow = true; add(disk);
    const rm = own(new THREE.MeshStandardMaterial({ color: "#B8A9C9", emissive: "#B8A9C9", emissiveIntensity: 0.5, roughness: 0.4 }));
    const ring = new THREE.Mesh(ringGeo, rm); ring.position.set(x, top + 1.3, z); add(ring);
    const h = haloSprite("#B8A9C9", 1.6, 0.3); h.position.copy(ring.position); add(h);
    const c = { x, z, top, mat, rm, ring, h, active: false };
    cps.push(c);
    return c;
  }

  // updraft vents
  const vents = [];
  const ventMat = own(new THREE.MeshBasicMaterial({ color: "#E8F7FF", transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const ptsMat = own(new THREE.PointsMaterial({ map: halo, size: 0.3, color: "#E8F7FF", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  function vent(x, top, z, height) {
    const R = 1.4;
    mesh(new THREE.CylinderGeometry(R, R + 0.15, 0.12, 16), runeMat(1.3), x, top + 0.06, z, false);
    const tor = mesh(new THREE.TorusGeometry(R, 0.13, 6, 24), mStone, x, top + 0.1, z);
    tor.rotation.x = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(R * 0.85, R, height, 14, 1, true), ventMat, x, top + height / 2, z, false);
    const N = 36, arr = new Float32Array(N * 3), ps = [];
    for (let i = 0; i < N; i++) ps.push({ a: forge.rand() * TAU, r: forge.rand() * R * 0.9, y: forge.rand() * height, s: 3 + forge.rand() * 4 });
    const geo = own(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const pts = new THREE.Points(geo, ptsMat); pts.frustumCulled = false; add(pts);
    vents.push({ x, z, top, height, R, arr, geo, ps });
  }

  // sentinels (3D golem model + glowing eye)
  const sentinels = [];
  function buildSentinelPh() {
    const g = new THREE.Group();
    const bx = (w, h, d, x, y, z, mat = mStone) => { const m = new THREE.Mesh(own(wuv(new THREE.BoxGeometry(w, h, d), 0.5)), mat); m.position.set(x, y, z); g.add(m); return m; };
    bx(0.38, 0.55, 0.42, -0.25, 0.28, 0); bx(0.38, 0.55, 0.42, 0.25, 0.28, 0);
    bx(1.1, 1.0, 0.75, 0, 1.05, 0);
    bx(0.32, 0.9, 0.36, -0.75, 1.0, 0); bx(0.32, 0.9, 0.36, 0.75, 1.0, 0);
    bx(0.6, 0.55, 0.55, 0, 1.85, 0);
    bx(0.4, 0.08, 0.05, 0, 1.88, 0.29, mRune);
    return g;
  }
  function sentinel(path) {
    const g = new THREE.Group();
    const rec = charModel("stone_sentinel", 2.2, { shape: "humanoid", flatShading: true, color: "#9a8f86" }, buildSentinelPh);
    g.add(rec.root);
    const eye = haloSprite("#F6C177", 1.2, 0.3); eye.position.set(0, 1.8, 0.35); g.add(eye);
    add(g);
    const anim = forge.three.animator ? forge.three.animator(rec.model || rec.root) : null;
    const s = { g, rec, eye, path, s: 0, dir: 1, a: path.a || 0, step: forge.rand() * 3, x: 0, z: 0, face: 0, anim };
    if (path.type === "line") {
      s.x = path.ax; s.z = path.az; s.face = Math.atan2(path.bx - path.ax, path.bz - path.az);
    } else {
      s.x = path.cx + Math.sin(s.a) * path.r; s.z = path.cz + Math.cos(s.a) * path.r;
      s.face = Math.atan2(Math.cos(s.a) * path.dir, -Math.sin(s.a) * path.dir);
    }
    g.position.set(s.x, path.top, s.z); g.rotation.y = s.face;
    sentinels.push(s);
  }

  // ================================================================ LEVEL
  // 1) Landing Isle
  island(0, 0, 0, 8);
  block(3.2, 1.2, -1.8, 2, 1.2, 2, { top: mMoss });
  block(4.6, 2.6, -4.4, 1.8, 2.6, 1.8, { top: mMoss });
  pillar(5.5, 0, 3, 2.2); pillar(-6, 0, -3.5, 1.6, true);
  arch(-4.5, 0, 3.5, 3, 3, true);
  const cp1 = checkpoint(0, 0, 5);
  crystal(-4, 4.2, -2);
  crystal(4.6, 3.6, -4.4);
  block(0, 0.5, -11, 2.4, 1.4, 2.4, { top: mMoss, rock: 1 });

  // 2) Mossy Terraces
  island(0, 1, -24, 10);
  block(-4.5, 2.2, -25, 4, 1.2, 4, { top: mMoss });
  block(-4, 3.4, -29, 3.5, 2.4, 3.5, { top: mMoss });
  arch(0, 1, -31.5, 3.6, 3.4);
  pillar(6.5, 1, -19, 2.8); pillar(-7, 1, -19, 2); pillar(7, 1, -31, 1.5, true);
  vent(5, 1, -27, 10);
  sentinel({ type: "line", ax: -3.5, az: -20, bx: 4, bz: -20, top: 1, f: 0.6 });
  crystal(-4, 4.4, -29); crystal(1, 2, -20); crystal(5, 9, -27);

  // 3) Cracked Causeway
  block(0, 1.5, -37.5, 4.2, 1.2, 4.2, { top: mMoss, rock: 2 });
  checkpoint(0, 1.5, -37.5);
  crumble(0, 1.8, -43); crumble(2.2, 2.2, -48); crumble(0, 2.6, -53);
  block(-4.8, 2.6, -53, 7, 0.4, 0.7, { side: mRune });
  block(-9.3, 2.6, -53, 2, 0.8, 2, { top: mMoss, rock: 2 });
  crumble(-1.5, 3.0, -58); crumble(1, 3.4, -63); crumble(-0.5, 3.8, -68);
  crystal(2.2, 3.2, -48); crystal(-9.3, 3.6, -53); crystal(0.2, 5.0, -65.5);

  // 4) Hollow Court
  {
    const shape = new THREE.Shape(); shape.absarc(0, 0, 11, 0, TAU, false);
    const hole = new THREE.Path(); hole.absarc(0, 0, 4, 0, TAU, true); shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.4, bevelEnabled: false, curveSegments: 28 });
    geo.rotateX(-Math.PI / 2);
    const ring = mesh(wuv(geo, 0.3), [mMoss, mStone], 0, 2.8, -82);
    forge.physics.addStatic(ring, { shape: "trimesh", friction: 0.9 });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; rockBase(Math.sin(a) * 7.5, 2.8, -82 + Math.cos(a) * 7.5, 3.2, 5.5, i % 2 === 0); }
    [60, 100, 165, 200, 245, 290].forEach((deg, i) => { const a = (deg * Math.PI) / 180; pillar(Math.sin(a) * 10, 4.2, -82 + Math.cos(a) * 10, i % 2 ? 2.2 : 3.6, i % 2 === 1); });
  }
  const heart = new THREE.Mesh(octa, mGlow); heart.scale.set(0.9, 1.6, 0.9); heart.position.set(0, 2.2, -82); add(heart);
  const heartHalo = haloSprite("#7FD1E8", 4, 0.28); heartHalo.position.copy(heart.position); add(heartHalo);
  checkpoint(0, 4.2, -72.6);
  sentinel({ type: "circle", cx: 0, cz: -82, r: 6.8, a: Math.PI * 0.6, dir: 1, top: 4.2, f: 1 });
  sentinel({ type: "circle", cx: 0, cz: -82, r: 6.8, a: -Math.PI * 0.6, dir: -1, top: 4.2, f: 1 });
  block(8, 5.6, -89, 3, 1.4, 3, { top: mMoss });
  block(10, 7.0, -93.5, 2.6, 1.2, 2.6, { top: mMoss, rock: 1 });
  block(7, 8.4, -97, 2.6, 1.2, 2.6, { top: mMoss, rock: 2 });
  block(3, 9.8, -99, 3, 1.2, 3, { top: mMoss, rock: 1 });
  crystal(-6.8, 5.2, -82); crystal(6.8, 5.2, -82); crystal(7, 9.4, -97);

  // 5) Beacon Spire
  island(0, 9, -113, 5.5);
  checkpoint(-2.5, 9, -112);
  vent(3, 9, -115, 10);
  block(5.5, 16.5, -118, 3, 1, 3, { top: mMoss, rock: 2 });
  block(5.5, 16.5, -123.625, 0.8, 0.4, 8.25, { side: mRune });
  block(5.5, 16.8, -129, 2.5, 1, 2.5, { top: mMoss, rock: 1 });
  block(0.5, 16.8, -129, 7.5, 0.4, 0.8, { side: mRune });
  block(-4.75, 17.0, -129, 3, 1, 3, { top: mMoss, rock: 2 });
  vent(-4.75, 17.0, -129, 12);
  crystal(5.5, 17.5, -123.6);
  island(-1, 24, -139, 5.5);

  // beacon gate (3D model), spire, orb
  const GX = -1, GZ = -141, GT = 24;
  pillar(GX - 2.6, GT, GZ, 3.8); pillar(GX + 2.6, GT, GZ, 3.8);
  const mGatePh = runeMat(0.15, "#F6C177");
  function buildGatePh() {
    const g = new THREE.Group();
    const door = new THREE.Mesh(own(wuv(new THREE.BoxGeometry(3.6, 5.3, 0.35), 0.4)), mGatePh); door.position.y = 2.65; g.add(door);
    const lintel = new THREE.Mesh(own(wuv(new THREE.BoxGeometry(4.4, 0.6, 0.7), 0.4)), mStone); lintel.position.y = 5.6; g.add(lintel);
    return g;
  }
  function applyGate(mats) {
    for (const m of mats) {
      if (m.color) m.color.set(gateOpen ? "#ffffff" : "#9d93ad");
      if (m.emissive) m.emissiveIntensity = gateOpen ? 0.4 : 0.02;
    }
    mGatePh.emissiveIntensity = gateOpen ? 0.55 : 0.08;
  }
  let gateRec = null;
  gateRec = charModel("beacon_gate", 6, { shape: "box", color: "#e8dcc8" }, buildGatePh, (model, r) => {
    r.mats = cloneMats(model, (mm) => {
      if (mm.emissive) { mm.emissive.set("#F6C177"); if (mm.map) mm.emissiveMap = mm.map; mm.needsUpdate = true; }
    });
    applyGate(r.mats);
  });
  gateRec.root.position.set(GX, GT, GZ);
  add(gateRec.root);
  applyGate(gateRec.mats);
  const gateHalo = haloSprite("#F6C177", 6.5, 0.12); gateHalo.position.set(GX, GT + 3, GZ - 1.2); add(gateHalo);
  const spire = mesh(wuv(new THREE.CylinderGeometry(0.6, 1.3, 9, 6), 0.35), runeMat(0.35), GX, GT + 4.5, GZ - 2.5);
  forge.physics.addStatic(spire, { shape: "box", friction: 0.8 });
  const orbMat = own(new THREE.MeshStandardMaterial({ color: "#fff4dc", emissive: "#F6C177", emissiveIntensity: 0.3, roughness: 0.2, flatShading: true }));
  const orb = new THREE.Mesh(own(new THREE.IcosahedronGeometry(0.9, 0)), orbMat);
  orb.position.set(GX, GT + 9.9, GZ - 2.5); add(orb);
  const orbHalo = haloSprite("#F6C177", 5, 0.15); orbHalo.position.copy(orb.position); add(orbHalo);
  const bBeamMat = own(new THREE.MeshBasicMaterial({ color: "#F6C177", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const bBeam = new THREE.Mesh(own(new THREE.CylinderGeometry(0.5, 1.2, 120, 12, 1, true)), bBeamMat);
  bBeam.position.set(GX, GT + 70, GZ - 2.5); add(bBeam);

  // crystal motes (orbiting sparkles around every crystal)
  const CM = 6, cmArr = new Float32Array(crystals.length * CM * 3);
  for (const c of crystals) {
    c.motes = [];
    for (let k = 0; k < CM; k++) c.motes.push({ a: forge.rand() * TAU, r: 0.45 + forge.rand() * 0.4, s: 0.8 + forge.rand() * 1.2, h: forge.rand() });
  }
  const cmGeo = own(new THREE.BufferGeometry()); cmGeo.setAttribute("position", new THREE.BufferAttribute(cmArr, 3));
  const cmPts = new THREE.Points(cmGeo, own(new THREE.PointsMaterial({ map: halo, size: 0.14, color: "#bff0ff", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  cmPts.frustumCulled = false; add(cmPts);
  const crystalOrder = crystals.slice().sort((a, b) => b.z - a.z);

  // decor: distant islands, cloud sea, motes
  for (let i = 0; i < 14; i++) {
    const a = forge.rand() * TAU, r = 75 + forge.rand() * 90;
    const x = Math.sin(a) * r, z = -70 + Math.cos(a) * r, y = -10 + forge.rand() * 45, s = 3 + forge.rand() * 7;
    mesh(new THREE.CylinderGeometry(s, s * 0.95, 1, 7), [mStone, mMoss, mStone], x, y, z, false);
    rockBase(x, y - 0.5, z, s * 0.95, s * 1.8, i % 3 === 0);
  }
  const cloudMat = own(new THREE.MeshStandardMaterial({ color: "#d4c8e0", emissive: "#c8bdd8", emissiveIntensity: 0.03, metalness: 0.02, roughness: 0.95, flatShading: true }));
  const cloudGeo = own(new THREE.IcosahedronGeometry(1, 1));
  for (let i = 0; i < 30; i++) {
    const c = new THREE.Mesh(cloudGeo, cloudMat);
    c.position.set((forge.rand() - 0.5) * 320, -32 + forge.rand() * 4, -70 + (forge.rand() - 0.5) * 320);
    c.scale.set(10 + forge.rand() * 15, 3 + forge.rand() * 3, 10 + forge.rand() * 15);
    add(c);
  }
  const MN = 220, mArr = new Float32Array(MN * 3);
  for (let i = 0; i < MN; i++) { mArr[i * 3] = -25 + forge.rand() * 50; mArr[i * 3 + 1] = -3 + forge.rand() * 35; mArr[i * 3 + 2] = -150 + forge.rand() * 165; }
  const moteGeo = own(new THREE.BufferGeometry()); moteGeo.setAttribute("position", new THREE.BufferAttribute(mArr, 3));
  const motes = new THREE.Points(moteGeo, own(new THREE.PointsMaterial({ map: halo, size: 0.2, color: "#F6C177", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  motes.frustumCulled = false; add(motes);

  // ================================================================ HERO
  const hero = add(new THREE.Group());
  const body = new THREE.Group(); hero.add(body);
  const M = (c, o = {}) => own(new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, flatShading: true, ...o }));
  const mCloak = M("#2f8f9c", { side: THREE.DoubleSide }), mSkin = M("#f1cfae"), mDark = M("#4A3F55"), mTunic = M("#E8F7FF");
  const mScarf = M("#F6C177"), mLeather = M("#8a5a3a"), mHair = M("#5b3a2e");
  const mAmber = M("#F6C177", { emissive: "#F6C177", emissiveIntensity: 0.18, metalness: 0.25 });
  const mCharm = M("#bff0ff", { emissive: "#7FD1E8", emissiveIntensity: 0.28 });
  let heroScarf = null;
  function buildHeroPh() {
    const g = new THREE.Group();
    const part = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(own(geo), mat); m.position.set(x, y, z); parent.add(m); return m; };
    part(new THREE.CapsuleGeometry(0.09, 0.4, 3, 6), mDark, -0.11, 0.3, 0);
    part(new THREE.CapsuleGeometry(0.09, 0.4, 3, 6), mDark, 0.11, 0.3, 0);
    part(new THREE.CapsuleGeometry(0.22, 0.38, 4, 8), mTunic, 0, 0.9, 0);
    part(new THREE.ConeGeometry(0.38, 0.8, 8, 1, true), mCloak, 0, 0.9, -0.02);
    part(new THREE.CapsuleGeometry(0.065, 0.38, 3, 6), mTunic, -0.3, 0.95, 0.02).rotation.z = -0.15;
    part(new THREE.CapsuleGeometry(0.065, 0.38, 3, 6), mTunic, 0.3, 0.95, 0.02).rotation.z = 0.15;
    part(new THREE.SphereGeometry(0.06, 6, 5), mCharm, -0.34, 0.72, 0.05);
    part(new THREE.BoxGeometry(0.1, 0.24, 0.24), mLeather, 0.27, 0.78, 0.05);
    part(new THREE.SphereGeometry(0.21, 10, 8), mSkin, 0, 1.5, 0);
    part(new THREE.SphereGeometry(0.225, 10, 6, 0, TAU, 0, Math.PI * 0.55), mHair, 0, 1.52, -0.02);
    part(new THREE.TorusGeometry(0.07, 0.025, 5, 10), mAmber, -0.08, 1.63, 0.16);
    part(new THREE.TorusGeometry(0.07, 0.025, 5, 10), mAmber, 0.08, 1.63, 0.16);
    part(new THREE.TorusGeometry(0.2, 0.07, 5, 12), mScarf, 0, 1.3, 0).rotation.x = Math.PI / 2;
    const sp = new THREE.Group(); sp.position.set(0.05, 1.3, -0.15); g.add(sp);
    part(new THREE.BoxGeometry(0.12, 0.04, 0.5), mScarf, 0, 0, -0.25, sp);
    heroScarf = sp;
    return g;
  }
  const heroRec = charModel("hero_ila", 1.7, { shape: "humanoid", color: "#2f8f9c" }, buildHeroPh);
  body.add(heroRec.root);
  const charmGlow = haloSprite("#7FD1E8", 0.35, 0.4); charmGlow.position.set(-0.34, 0.74, 0.1); body.add(charmGlow);
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.35); wingShape.lineTo(1.1, -0.25); wingShape.lineTo(0, -0.05); wingShape.lineTo(-1.1, -0.25); wingShape.closePath();
  const wingMat = own(new THREE.MeshBasicMaterial({ color: "#7FD1E8", transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  const wing = new THREE.Mesh(own(new THREE.ShapeGeometry(wingShape)), wingMat);
  wing.rotation.x = Math.PI / 2; wing.position.set(0, 1.95, 0); wing.scale.setScalar(0.01); body.add(wing);
  // Prefer skeletal clips (Tripo rig+retarget) over procedural puppet bob.
  const heroAnim = forge.three.animator ? forge.three.animator(heroRec.model || heroRec.root) : null;
  const pup = (!heroAnim && forge.three.puppet) ? forge.three.puppet(body) : null;

  const blob = new THREE.Mesh(own(new THREE.PlaneGeometry(1, 1)), own(new THREE.MeshBasicMaterial({ map: halo, color: "#000000", transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })));
  blob.rotation.x = -Math.PI / 2; blob.position.set(0, 0.04, 5); add(blob);

  // ================================================================ CHARACTER
  const ctrl = forge.physics.character({ radius: PR, height: PH, position: [0, PH / 2 + 0.05, 5], stepHeight: 0.35, maxSlopeDeg: 50, snapToGround: 0.3 });
  let posToCenter = 0;
  try {
    const t = ctrl.collider && ctrl.collider.translation(), p = ctrl.position;
    if (t && p && Number.isFinite(t.y - p.y)) posToCenter = t.y - p.y;
  } catch (e) { posToCenter = 0; }

  // ================================================================ STATE
  let lives = Math.max(1, Math.round(tune("startLives", 3)));
  let score = 0, got = 0, stam = 1, vx = 0, vz = 0, vy = 0, coyote = 0, buffer = 0, airJumps = 1;
  let prevJump = false, gliding = false, inv = 0, stun = 0, grace = 0, wasGround = true, prevVy = 0;
  let elapsed = 0, clock = 0, ended = false, reported = false, winT = -1, lockMsgT = 0, trailT = 0;
  let px = 0, pz = 5, feet = 0, face = Math.PI, yaw = 0, pitch = 0.32, camDist = 5.5, mouseIdle = 10, axisSignY = -1;
  let resp = cp1;
  let hudOn = false, controlsHintShown = false, orbBoost = 0;
  cp1.active = true; cp1.rm.emissiveIntensity = 0.4; cp1.mat.emissiveIntensity = 0.2;
  const pivot = V(0, 1.45, 5), camDir = V(), tmpO = V(), tmpD = V(), moveV = V();
  const tmpCam = V(), tmpLook = V(), wantLook = V();
  const UPV = V(0, 1, 0), DOWNV = V(0, -1, 0);
  hero.position.set(px, feet, pz); hero.rotation.y = face;

  const hints = [
    { z: -6, msg: "Press Space again in mid-air to double jump", done: false },
    { z: -15, msg: "Hold Space in the air to glide — ride the updraft for the high crystal!", done: false },
    { z: -35.5, msg: "Cracked tiles crumble under your feet — keep moving!", done: false },
    { z: -71.5, msg: "Sentinels patrol the court. Jump over them or slip past!", done: false },
    { z: -101, msg: "Jump, then hold Space to glide to the Beacon Spire", done: false },
    { z: -134, msg: "The Beacon Gate awaits at the summit", done: false },
  ];

  function hudAll() {
    forge.hud.set("crystals", `${got} / ${TOTAL}`, { label: "Crystals", icon: "💎" });
    forge.hud.set("lives", lives > 0 ? "❤".repeat(lives) : "—", { label: "Lives", icon: "❤" });
    forge.hud.set("score", score, { label: "Score", icon: "★" });
    forge.hud.set("beacon", gateOpen ? "Awake" : "Dormant", { label: "Beacon", icon: gateOpen ? "🔆" : "🔅" });
  }
  function showHud() {
    hudOn = true;
    hudAll();
    forge.hud.bar("glide", stam, { label: "Glide", color: stam < 0.25 ? "#F6C177" : "#7FD1E8" });
    if (!controlsHintShown) {
      controlsHintShown = true;
      forge.hud.message("WASD move · Mouse look · Space jump · Shift sprint", 4000);
    }
  }
  function hideHud() {
    hudOn = false;
    for (const k of ["crystals", "lives", "score", "beacon", "glide"]) { try { forge.hud.remove(k); } catch (e) { /* ignore */ } }
  }
  forge.audio.music("music_main", { volume: 0.6 });

  // ---------------------------------------------------------------- cinematic state
  let cineWas = false, cineHits = 0, cineLocalT = 0, skipReq = false, handoff = 0;
  const HANDOFF = 0.8;
  const cineCam = V(0, 3.2, 10), cineLook = V(0, 1.5, 5);
  function requestSkip() {
    if (skipReq) return;
    skipReq = true;
    try {
      const c = forge.cinematic;
      if (c && typeof c.skip === "function") c.skip();
      else if (typeof forge.skipCinematic === "function") forge.skipCinematic();
      else if (c && typeof c.end === "function") c.end();
    } catch (e) { /* runtime owns its own skip control */ }
  }

  // ---------------------------------------------------------------- pointer look
  const canvas = renderer.domElement;
  let dragging = false, lx = 0, ly = 0, lookDX = 0, lookDY = 0;
  const isLocked = () => { try { return !!canvas.ownerDocument && canvas.ownerDocument.pointerLockElement === canvas; } catch (e) { return false; } };
  const onDown = (e) => {
    if (cineActive()) { if (cineLocalT > 0.6) requestSkip(); return; }
    dragging = true; lx = e.clientX; ly = e.clientY;
    if (e.pointerType === "mouse" && !isLocked() && !forge.paused && !ended && canvas.requestPointerLock) {
      try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* ignore */ }
    }
  };
  const onUp = () => { dragging = false; };
  const onMove = (e) => {
    if (forge.paused || cineActive()) return;
    if (isLocked()) { lookDX += e.movementX || 0; lookDY += e.movementY || 0; }
    else if (dragging) { lookDX += e.clientX - lx; lookDY += e.clientY - ly; lx = e.clientX; ly = e.clientY; }
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointerleave", onUp);
  canvas.addEventListener("pointermove", onMove);

  // ---------------------------------------------------------------- events
  function burst(x, y, z, o) { forge.three.burst(V(x, y, z), o); }

  function collect(c) {
    c.taken = true; c.t = 0; got++; score += 100;
    sfx("sfx_crystal", { volume: 0.8, rate: 1 + got * 0.02 });
    burst(c.g.position.x, c.g.position.y, c.g.position.z, { color: "#7FD1E8", count: 26, speed: 4, life: 0.8, size: 0.16 });
    forge.three.floatText(c.g.position.clone(), "+100", { color: "#E8F7FF" });
    forge.shake(0.12);
    if (got >= TOTAL) {
      gateOpen = true; applyGate(gateRec.mats);
      sfx("powerup", { volume: 0.7 });
      forge.hud.message("All 12 crystals! The Beacon Gate is open — climb to the summit!", 3500);
    } else forge.hud.message(`Aether crystal ${got} / ${TOTAL}`, 1200);
    hudAll();
  }

  function loseLife(isVoid) {
    if (ended) return true;
    lives--; sfx("sfx_hit", { volume: 0.8 }); forge.shake(isVoid ? 0.35 : 0.55); hudAll();
    if (lives <= 0) {
      ended = true; hero.visible = true;
      sfx("sfx_lose", { volume: 0.9 });
      if (!reported) {
        reported = true;
        forge.lose({ title: "The Sky Falls Silent", subtitle: "Ila's light faded among the drifting ruins.", stats: { Crystals: `${got} / ${TOTAL}`, Score: score, Time: fmt(elapsed) } });
      }
      return true;
    }
    return false;
  }

  function respawn() {
    ctrl.teleport([resp.x, resp.top + PH / 2 - posToCenter + 0.1, resp.z]);
    vx = vz = vy = 0; inv = 1.2; stun = 0; grace = 0.3; gliding = false; stam = 1;
    px = resp.x; pz = resp.z; feet = resp.top + 0.1;
    pivot.set(px, feet + 1.45, pz);
    burst(px, feet + 0.8, pz, { color: "#B8A9C9", count: 24, speed: 3, life: 0.7, size: 0.15 });
  }

  function startWin() {
    ended = true; winT = 0;
    sfx("sfx_win", { volume: 1 });
    forge.shake(0.3);
    burst(GX, GT + 2, GZ, { color: "#F6C177", count: 60, speed: 7, life: 1.4, size: 0.22 });
    forge.hud.message("The beacon awakens!", 2500);
  }

  // ================================================================ UPDATE
  function updateWorld(dt) {
    const t = clock;
    for (let ci = 0; ci < crystals.length; ci++) {
      const c = crystals[ci];
      c.pulse = Math.max(0, c.pulse - dt * 1.2);
      if (!c.taken) {
        c.g.position.y = c.y + Math.sin(t * 2 + c.ph) * 0.18;
        c.rec.root.rotation.y += dt * (1.1 + c.pulse * 4);
        const s = 1.5 + Math.sin(t * 3 + c.ph) * 0.15 + c.pulse * 0.8; c.h.scale.set(s, s, 1);
        const ei = 0.2 + Math.sin(t * 3 + c.ph) * 0.06 + c.pulse * 0.35;
        for (const m of c.rec.mats) if (m.emissive) m.emissiveIntensity = ei;
      } else if (c.g.visible) {
        c.t += dt;
        c.g.scale.setScalar(1 + c.t * 4);
        c.h.material.opacity = Math.max(0, 0.7 - c.t * 2);
        c.g.position.y += dt * 2;
        if (c.t > 0.35) c.g.visible = false;
      }
      const base = ci * CM * 3;
      for (let k = 0; k < CM; k++) {
        const o = base + k * 3;
        if (!c.g.visible) { cmArr[o] = c.x; cmArr[o + 1] = -9999; cmArr[o + 2] = c.z; continue; }
        const m = c.motes[k];
        m.h += dt * m.s * 0.35; if (m.h > 1) m.h -= 1;
        m.a += dt * m.s * (1 + c.pulse * 2);
        const rr = m.r * (1 - m.h * 0.4) * (1 + c.pulse * 0.6);
        cmArr[o] = c.g.position.x + Math.cos(m.a) * rr;
        cmArr[o + 1] = c.g.position.y - 0.5 + m.h * 1.2;
        cmArr[o + 2] = c.g.position.z + Math.sin(m.a) * rr;
      }
    }
    cmGeo.attributes.position.needsUpdate = true;
    for (const c of cps) {
      c.ring.rotation.y += dt * (c.active ? 2.5 : 0.6);
      c.ring.position.y = c.top + 1.3 + Math.sin(t * 2 + c.x) * 0.08;
      c.h.position.y = c.ring.position.y;
    }
    for (const v of vents) {
      for (let i = 0; i < v.ps.length; i++) {
        const p = v.ps[i];
        p.y += p.s * dt; if (p.y > v.height) p.y -= v.height;
        p.a += dt * 1.8;
        v.arr[i * 3] = v.x + Math.cos(p.a) * p.r; v.arr[i * 3 + 1] = v.top + p.y; v.arr[i * 3 + 2] = v.z + Math.sin(p.a) * p.r;
      }
      v.geo.attributes.position.needsUpdate = true;
    }
    for (let i = 0; i < MN; i++) {
      mArr[i * 3] += Math.cos(t * 0.4 + i) * dt * 0.15;
      mArr[i * 3 + 1] += Math.sin(t * 0.6 + i * 1.3) * dt * 0.2;
    }
    moteGeo.attributes.position.needsUpdate = true;
    heart.rotation.y += dt * 0.6; heart.position.y = 2.2 + Math.sin(t) * 0.3; heartHalo.position.y = heart.position.y;

    const charge = got / TOTAL;
    orb.rotation.y += dt * (0.4 + charge * 2);
    orbMat.emissiveIntensity = damp(orbMat.emissiveIntensity, 0.15 + charge * 0.9 + (winT >= 0 ? 1.2 : 0) + orbBoost * 0.4, 3 + orbBoost * 4, dt);
    orbHalo.material.opacity = 0.15 + charge * 0.5 + (winT >= 0 ? 0.3 : 0) + orbBoost * 0.25;
    gateHalo.material.opacity = damp(gateHalo.material.opacity, gateOpen ? 0.55 + Math.sin(t * 3) * 0.12 : 0.12, 3, dt);
    if (gateOpen) {
      const gi = 0.4 + Math.sin(t * 3) * 0.12 + (winT >= 0 ? 0.6 : 0);
      for (const m of gateRec.mats) if (m.emissive) m.emissiveIntensity = gi;
      mGatePh.emissiveIntensity = 0.45 + Math.sin(t * 3) * 0.1 + (winT >= 0 ? 0.35 : 0);
    }
    bBeamMat.opacity = damp(bBeamMat.opacity, winT >= 0 ? 0.6 : gateOpen ? 0.12 : 0, 2, dt);
    bBeam.visible = bBeamMat.opacity > 0.01;
  }

  function updateCrumbles(dt, standing) {
    const delay = Math.max(0.1, tune("crumbleDelay", 0.8) * diffMul().c);
    for (const c of crumbles) {
      if (c.state === 0) {
        if (standing && Math.abs(px - c.x) < c.half + 0.2 && Math.abs(pz - c.z) < c.half + 0.2 && Math.abs(feet - c.top) < 0.4) { c.state = 1; c.t = 0; }
      } else if (c.state === 1) {
        c.t += dt;
        const k = 0.03 + (c.t / delay) * 0.08;
        c.vis.position.set(c.x + (forge.rand() - 0.5) * k, c.top - 0.3 + (forge.rand() - 0.5) * k, c.z + (forge.rand() - 0.5) * k);
        if (c.t >= delay) {
          c.state = 2; c.t = 0; c.vy = 0; setCol(c, false);
          sfx("sfx_crumble", { volume: 0.7 }); forge.shake(0.1);
          burst(c.x, c.top, c.z, { color: "#b8a99a", count: 20, speed: 3, life: 0.8, size: 0.18 });
        }
      } else if (c.state === 2) {
        c.t += dt; c.vy -= 18 * dt;
        c.vis.position.y += c.vy * dt; c.vis.rotation.x += dt * 0.7; c.vis.rotation.z += dt * 0.4;
        if (c.t > 2) c.vis.visible = false;
        if (c.t > 4) {
          const over = Math.abs(px - c.x) < c.half + PR && Math.abs(pz - c.z) < c.half + PR && feet < c.top + 0.6 && feet > c.top - 1.8;
          if (!over) {
            c.state = 3; c.t = 0; setCol(c, true);
            c.vis.position.set(c.x, c.top - 0.3, c.z); c.vis.rotation.set(0, 0, 0); c.vis.scale.setScalar(0.01); c.vis.visible = true;
          }
        }
      } else {
        c.t += dt;
        const s = Math.min(1, c.t / 0.5); c.vis.scale.setScalar(Math.max(0.01, s * (1 + Math.sin(s * Math.PI) * 0.15)));
        if (s >= 1) { c.vis.scale.setScalar(1); c.state = 0; }
      }
    }
  }

  function updateSentinels(dt) {
    const sp = tune("sentinelSpeed", 2.5) * diffMul().s;
    for (const s of sentinels) {
      const P = s.path, spd = sp * P.f;
      const ox = s.x, oz = s.z;
      if (P.type === "line") {
        const len = Math.max(0.1, Math.hypot(P.bx - P.ax, P.bz - P.az));
        s.s += (s.dir * spd * dt) / len;
        if (s.s > 1) { s.s = 1; s.dir = -1; } else if (s.s < 0) { s.s = 0; s.dir = 1; }
        s.x = P.ax + (P.bx - P.ax) * s.s; s.z = P.az + (P.bz - P.az) * s.s;
      } else {
        s.a += (P.dir * spd * dt) / P.r;
        s.x = P.cx + Math.sin(s.a) * P.r; s.z = P.cz + Math.cos(s.a) * P.r;
      }
      s.step += dt * spd * 2.2;
      const mdx = s.x - ox, mdz = s.z - oz;
      const moving = mdx * mdx + mdz * mdz > 1e-10;
      if (s.anim) {
        s.g.position.set(s.x, P.top, s.z);
        s.anim.setLocomotion({ speed: moving ? Math.max(spd, 1.2) : 0, grounded: true, vx: mdx, vz: mdz });
      } else {
        s.g.position.set(s.x, P.top + Math.abs(Math.sin(s.step)) * 0.15, s.z);
        s.rec.root.rotation.z = Math.sin(s.step) * 0.06;
      }
      s.eye.material.opacity = 0.25 + Math.abs(Math.sin(s.step * 0.5)) * 0.2;
      if (moving) s.face += wrapA(Math.atan2(mdx, mdz) - s.face) * (1 - Math.exp(-10 * dt));
      s.g.rotation.y = s.face;
      if (!ended && inv <= 0) {
        const dx = px - s.x, dz = pz - s.z, d = Math.hypot(dx, dz);
        if (d < 1.05 && feet < P.top + 1.75 && feet > P.top - 1.2) {
          burst(px, feet + 1, pz, { color: "#F6C177", count: 18, speed: 4, life: 0.6, size: 0.15 });
          if (!loseLife(false)) {
            const nx = d > 0.01 ? dx / d : Math.sin(face + Math.PI), nz = d > 0.01 ? dz / d : Math.cos(face + Math.PI);
            vx = nx * 6.5; vz = nz * 6.5; vy = 6; inv = 1.6; stun = 0.35; gliding = false;
            forge.hud.message("Struck by a Sentinel!", 1200);
          }
        }
      }
    }
  }

  function updatePlayer(dt) {
    const base = tune("playerSpeed", 6), jf = tune("jumpForce", 8.5), g = tune("gravity", 22);
    const gfs = tune("glideFallSpeed", 2.2), gst = Math.max(0.2, tune("glideStamina", 3));
    const grounded = !!ctrl.grounded;

    // input relative to camera
    let mx = (inp.down("right") ? 1 : 0) - (inp.down("left") ? 1 : 0);
    let mf = (inp.down("up") ? 1 : 0) - (inp.down("down") ? 1 : 0);
    const ax = inp.axis() || { x: 0, y: 0 };
    const axx = Number(ax.x) || 0, axy = Number(ax.y) || 0;
    if (inp.down("up") && Math.abs(axy) > 0.5) axisSignY = axy > 0 ? 1 : -1;
    if (Math.abs(axx) > Math.abs(mx)) mx = axx;
    if (Math.abs(axy * axisSignY) > Math.abs(mf)) mf = axy * axisSignY;
    let mag = Math.hypot(mx, mf);
    if (mag > 1) { mx /= mag; mf /= mag; mag = 1; }
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const dx = mx * cy - mf * sy, dz = -mx * sy - mf * cy;

    // vents
    let inVent = null;
    for (const v of vents) if (Math.hypot(px - v.x, pz - v.z) < v.R && feet > v.top - 0.5 && feet < v.top + v.height + 1.5) inVent = v;

    // jump / double jump
    if (grounded) { coyote = 0.12; airJumps = 1; } else coyote -= dt;
    if (inp.pressed("jump")) buffer = 0.13; else buffer -= dt;
    const jumpDown = inp.down("jump");
    if (buffer > 0 && stun <= 0) {
      if (coyote > 0) {
        vy = jf; coyote = 0; buffer = 0;
        sfx("sfx_jump", { volume: 0.6 });
        burst(px, feet + 0.1, pz, { color: "#d9cbb8", count: 8, speed: 2, life: 0.4, size: 0.12 });
      } else if (!grounded && airJumps > 0) {
        vy = jf * 0.92; airJumps--; buffer = 0; gliding = false;
        sfx("sfx_jump", { volume: 0.6, rate: 1.25 });
        burst(px, feet + 0.3, pz, { color: "#7FD1E8", count: 14, speed: 3, life: 0.5, size: 0.14 });
      }
    }
    if (!jumpDown && prevJump && vy > 0) vy *= 0.55;
    prevJump = jumpDown;

    // glide
    const wantGlide = !grounded && jumpDown && vy <= 0.5 && stun <= 0 && (stam > 0 || !!inVent);
    if (wantGlide && !gliding) sfx("sfx_glide", { volume: 0.5 });
    gliding = wantGlide;
    if (gliding && !inVent) stam = Math.max(0, stam - dt / gst);
    if (grounded) stam = Math.min(1, stam + dt * 1.2);

    // horizontal
    const speed = base * (inp.down("action2") ? 1.45 : 1) * (gliding ? 1.15 : 1);
    if (stun <= 0) {
      const acc = grounded ? (mag > 0.05 ? 45 : 55) : gliding ? 14 : 20;
      const ddx = dx * speed - vx, ddz = dz * speed - vz, dl = Math.hypot(ddx, ddz), st = acc * dt;
      if (dl > st) { vx += (ddx / dl) * st; vz += (ddz / dl) * st; } else { vx += ddx; vz += ddz; }
    }

    // vertical
    prevVy = vy;
    if (grounded && vy <= 0) vy = -1;
    else {
      vy -= g * dt * (gliding ? 0.3 : 1);
      if (gliding && vy < -gfs) vy = damp(vy, -gfs, 10, dt);
      vy = Math.max(vy, -30);
    }
    if (inVent && !grounded) {
      const fade = clamp((inVent.top + inVent.height + 1.5 - feet) / 2.5, 0, 1);
      if (gliding) vy = damp(vy, 9 * fade, 6, dt);
      else vy += 12 * fade * dt;
    }
    if (vy > 0) {
      const h = forge.physics.raycast(tmpO.set(px, feet + PH + 0.03, pz), UPV, vy * dt + 0.08);
      if (h && h.collider !== ctrl.collider) vy = 0;
    }
    if (!Number.isFinite(vx)) vx = 0; if (!Number.isFinite(vz)) vz = 0; if (!Number.isFinite(vy)) vy = 0;

    moveV.set(vx * dt, vy * dt, vz * dt);
    ctrl.move(moveV);
    const p = ctrl.position;
    if (p && Number.isFinite(p.x)) { px = p.x; pz = p.z; feet = p.y + posToCenter - PH / 2; }
    const nowGround = !!ctrl.grounded;

    // landing
    if (nowGround && !wasGround && prevVy < -6) {
      burst(px, feet + 0.05, pz, { color: "#d9cbb8", count: 12, speed: 2.5, life: 0.5, size: 0.14 });
      sfx("step", { volume: 0.4 });
      if (prevVy < -14) forge.shake(0.12);
    }
    wasGround = nowGround;

    // glide trail
    if (gliding) {
      trailT -= dt;
      if (trailT <= 0) { trailT = 0.08; burst(px, feet + 1.9, pz, { color: "#7FD1E8", count: 2, speed: 0.6, life: 0.5, size: 0.1 }); }
    }

    // model: face movement direction
    const hs = Math.hypot(vx, vz);
    if (hs > 0.4 && stun <= 0) face = face + wrapA(Math.atan2(vx, vz) - face) * (1 - Math.exp(-12 * dt));
    hero.position.set(px, feet, pz);
    hero.rotation.y = face;
    if (heroAnim) heroAnim.setLocomotion({ vx, vz, vy, grounded: nowGround, speed: hs });
    else if (pup) pup.update({ vx, vz, vy, grounded: nowGround, speed: hs }, dt);
    wing.scale.setScalar(Math.max(0.01, damp(wing.scale.x, gliding ? 1 : 0.01, 10, dt)));
    wingMat.opacity = 0.4 + Math.sin(clock * 8) * 0.15;
    charmGlow.material.opacity = 0.35 + Math.sin(clock * 4) * 0.1 + (gliding ? 0.15 : 0);
    if (heroScarf) heroScarf.rotation.x = -0.25 - Math.min(hs, 10) * 0.08 + Math.sin(clock * 14) * 0.15 + (vy < 0 ? 0.3 : 0);
    hero.visible = inv > 0 ? Math.floor(inv * 12) % 2 === 0 : true;

    // shadow blob
    const gh = forge.physics.raycast(tmpO.set(px, feet - 0.02, pz), DOWNV, 30);
    if (gh && gh.point) {
      blob.visible = true;
      const dist = Math.max(0, feet - gh.point.y);
      blob.position.set(px, gh.point.y + 0.04, pz);
      const s = 0.9 + Math.min(dist, 8) * 0.05; blob.scale.set(s, s, 1);
      blob.material.opacity = 0.35 * clamp(1 - dist / 12, 0.1, 1);
    } else blob.visible = false;

    // crystals
    for (const c of crystals) {
      if (c.taken) continue;
      const ddx = px - c.x, ddy = feet + 0.9 - c.g.position.y, ddz = pz - c.z;
      if (ddx * ddx + ddy * ddy + ddz * ddz < 2.25) collect(c);
    }

    // checkpoints
    for (const c of cps) {
      if (c.active) continue;
      if (Math.hypot(px - c.x, pz - c.z) < 1.4 && Math.abs(feet - c.top) < 1.5) {
        for (const o of cps) { o.active = false; o.rm.emissiveIntensity = 0.5; o.mat.emissiveIntensity = 0.2; }
        c.active = true; c.rm.emissiveIntensity = 0.7; c.mat.emissiveIntensity = 0.35; resp = c;
        score += 50; hudAll();
        sfx("powerup", { volume: 0.5 });
        burst(c.x, c.top + 1.3, c.z, { color: "#B8A9C9", count: 30, speed: 3.5, life: 0.9, size: 0.16 });
        forge.three.floatText(V(c.x, c.top + 2, c.z), "Checkpoint", { color: "#B8A9C9" });
        forge.hud.message("Checkpoint rune awakened", 1400);
      }
    }

    // hints
    for (const h of hints) if (!h.done && pz < h.z) { h.done = true; forge.hud.message(h.msg, 3200); }

    // gate
    const gd = Math.hypot(px - GX, pz - GZ);
    lockMsgT -= dt;
    if (gd < 2 && feet > GT - 1) {
      if (gateOpen) startWin();
      else if (lockMsgT <= 0) { lockMsgT = 3; forge.hud.message(`The gate is sealed — ${TOTAL - got} crystal${TOTAL - got === 1 ? "" : "s"} missing`, 2500); }
    }

    // void
    grace -= dt;
    if (!ended && grace <= 0 && feet < -18) {
      forge.hud.message("Lost in the clouds…", 1400);
      if (!loseLife(true)) respawn();
    }

    forge.hud.bar("glide", stam, { label: "Glide", color: stam < 0.25 ? "#F6C177" : "#7FD1E8" });
    return { grounded: nowGround, mag };
  }

  function updateCamera(dt, moving) {
    const sens = Number(setting("cameraSensitivity", 1)) || 1;
    const iv = setting("invertY", false);
    const invY = iv === true || iv === "true" || iv === 1 ? -1 : 1;
    if (lookDX !== 0 || lookDY !== 0) mouseIdle = 0; else mouseIdle += dt;
    yaw -= lookDX * 0.0032 * sens;
    pitch = clamp(pitch + lookDY * 0.0028 * sens * invY, -0.35, 1.2);
    lookDX = lookDY = 0;
    if (mouseIdle > 1.5 && moving > 0.1 && !ended) yaw += wrapA(face + Math.PI - yaw) * (1 - Math.exp(-0.9 * moving * dt));
    yaw = wrapA(yaw);

    pivot.x = damp(pivot.x, px, 18, dt); pivot.z = damp(pivot.z, pz, 18, dt); pivot.y = damp(pivot.y, feet + 1.45, 10, dt);
    camDir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const want = 5.2 + (gliding ? 0.8 : 0);
    let d = want;
    tmpO.copy(pivot).addScaledVector(camDir, 0.55);
    const hit = forge.physics.raycast(tmpO, tmpD.copy(camDir), want);
    if (hit && hit.collider !== ctrl.collider && Number.isFinite(hit.distance)) d = Math.max(0.9, 0.55 + hit.distance - 0.35);
    camDist = d < camDist ? d : damp(camDist, d, 4, dt);
    tmpCam.copy(pivot).addScaledVector(camDir, camDist);
    wantLook.set(pivot.x, pivot.y + 0.25, pivot.z);
    if (handoff > 0) {
      handoff = Math.max(0, handoff - dt);
      const k = 1 - handoff / HANDOFF, e = k * k * (3 - 2 * k);
      camera.position.lerpVectors(cineCam, tmpCam, e);
      tmpLook.lerpVectors(cineLook, wantLook, e);
      camera.lookAt(tmpLook);
    } else {
      camera.position.copy(tmpCam);
      camera.lookAt(wantLook);
    }
    const fov = damp(camera.fov, gliding ? 63 : 55, 4, dt);
    if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

    if (sun) {
      sun.position.set(px + 25, feet + 40, pz + 18);
      if (sun.target) { sun.target.position.set(px, feet, pz); sun.target.updateMatrixWorld(); }
    }
  }

  // ================================================================ CINEMATIC (live camera tour)
  const CSHOTS = [
    // 0: wide establishing crane-up over the cloud sea, golden-hour haze
    { from: [-58, -8, 46], to: [-40, 24, 8], lf: [0, 6, -55], lt: [0, 16, -95], fov: [48, 50], ease: "smooth", bloom: [0.12, 0.16], sway: 4 },
    // 1: dolly along the island chain past the crystals toward the beacon gate
    { from: [24, 13, -28], to: [-12, 27, -104], lf: [0, 4, -48], lt: [GX, GT + 3, GZ], fov: [55, 52], ease: "smooth", bloom: [0.18, 0.24], sway: 7 },
    // 2: swooping arc onto Ila, settling behind her at the gameplay camera
    { orbit: true, fov: [42, 55], ease: "easeOut", bloom: [0.24, 0.2] },
  ];
  const CDEF = [5, 5, 5.5];
  const dirShots = (() => {
    const d = forge.design && forge.design.cinematic && forge.design.cinematic.direction;
    return d && Array.isArray(d.shots) && d.shots.length === CSHOTS.length ? d.shots : null;
  })();
  const CDURS = CSHOTS.map((_, i) => { const v = dirShots ? Number(dirShots[i] && dirShots[i].durationSec) : NaN; return Number.isFinite(v) && v > 0 ? v : CDEF[i]; });
  const CTOTAL = CDURS.reduce((a, b) => a + b, 0);
  const CSTART = [0];
  for (let i = 0; i < CDURS.length; i++) CSTART.push(CSTART[i] + CDURS[i] / CTOTAL);
  CSTART[CSTART.length - 1] = 1;
  const SKIP_ACTIONS = ["jump", "action", "action2", "left", "right", "up", "down"];
  const idleState = { vx: 0, vz: 0, vy: 0, grounded: true, speed: 0 };

  function startCinematic() {
    cineWas = true; cineLocalT = 0; skipReq = false; handoff = 0;
    for (const c of crystals) c.cinePulsed = false;
    hero.visible = true;
    lookDX = lookDY = 0;
  }
  function endCinematic() {
    cineWas = false;
    handoff = HANDOFF;
    setBloom(0.18, true);
    mRune.emissiveIntensity = 0.28;
    orbBoost = 0;
    buffer = 0; prevJump = true; lookDX = lookDY = 0; mouseIdle = 10;
  }
  function runCinematic(dt, cine) {
    cine = cine || forge.cinematic || {};
    if (!cineWas) startCinematic();
    cineLocalT += dt;
    clock += dt;
    if (hudOn) hideHud();
    pollModels(dt);

    const ctRaw = Number(cine.t);
    const ct = Number.isFinite(ctRaw) ? ctRaw : cineLocalT;
    if (ct > 0.6 && !skipReq) { for (const a of SKIP_ACTIONS) if (inp.pressed(a)) { requestSkip(); break; } }
    lookDX = lookDY = 0;

    const durRaw = Number(cine.duration);
    const dur = Number.isFinite(durRaw) && durRaw > 0 ? durRaw : CTOTAL;
    const u = clamp(ct / dur, 0, 1);
    let idx = -1;
    const si = Number(cine.shotIndex);
    if (dirShots && Number.isInteger(si) && si >= 0 && si < CSHOTS.length) idx = si;
    if (idx < 0) { idx = CSHOTS.length - 1; for (let i = 0; i < CSHOTS.length; i++) if (u < CSTART[i + 1]) { idx = i; break; } }
    const lp = clamp((u - CSTART[idx]) / Math.max(1e-4, CSTART[idx + 1] - CSTART[idx]), 0, 1);
    const S = CSHOTS[idx];
    const e = S.ease === "easeOut" ? 1 - Math.pow(1 - lp, 3) : lp * lp * lp * (lp * (lp * 6 - 15) + 10);

    if (S.orbit) {
      const a0 = face - 0.84, a1 = yaw;
      const a = a0 + wrapA(a1 - a0) * e;
      const r = lerp(4.4, 5.2 * Math.cos(pitch), e);
      const h = lerp(1.9, 1.45 + 5.2 * Math.sin(pitch), e);
      cineCam.set(px + Math.sin(a) * r, feet + h, pz + Math.cos(a) * r);
      cineLook.set(px, feet + lerp(1.25, 1.7, e), pz);
    } else {
      const sw = Math.sin(e * Math.PI) * S.sway;
      cineCam.set(lerp(S.from[0], S.to[0], e) + sw, lerp(S.from[1], S.to[1], e) + Math.sin(ct * 0.7) * 0.3, lerp(S.from[2], S.to[2], e) + sw * 0.4);
      cineLook.set(lerp(S.lf[0], S.lt[0], e), lerp(S.lf[1], S.lt[1], e), lerp(S.lf[2], S.lt[2], e));
    }
    if (!Number.isFinite(cineCam.x + cineCam.y + cineCam.z)) cineCam.set(0, 3.2, 10);
    camera.position.copy(cineCam);
    camera.lookAt(cineLook);
    const fov = lerp(S.fov[0], S.fov[1], e);
    if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

    // fx
    setBloom(lerp(S.bloom[0], S.bloom[1], e));
    mRune.emissiveIntensity = idx === 0 ? 0.05 : idx === 1 ? 0.05 + 0.22 * e : 0.28;
    if (idx >= 1) {
      const N = crystalOrder.length;
      for (let i = 0; i < N; i++) {
        const c = crystalOrder[i];
        if (c.cinePulsed || c.taken) continue;
        if (idx > 1 || lp >= 0.05 + (i / N) * 0.85) {
          c.cinePulsed = true; c.pulse = 1;
          burst(c.x, c.g.position.y, c.z, { color: "#7FD1E8", count: 10, speed: 1.6, life: 0.9, size: 0.14 });
        }
      }
    }
    orbBoost = idx === 2 ? Math.max(0, 0.7 + Math.sin(clock * 11) * Math.sin(clock * 3.7) * 0.9) : 0;

    // dormant sentinels
    for (const s of sentinels) s.eye.material.opacity = 0.03;

    // idle Ila
    hero.visible = true;
    hero.position.set(px, feet, pz);
    hero.rotation.y = face;
    if (pup) pup.update(idleState, dt);
    wing.scale.setScalar(Math.max(0.01, damp(wing.scale.x, 0.01, 8, dt)));
    charmGlow.material.opacity = (idx === 2 ? 0.45 : 0.3) + Math.sin(clock * 3) * 0.1;
    if (heroScarf) heroScarf.rotation.x = -0.6 + Math.sin(clock * 9) * 0.25;
    blob.visible = true; blob.position.set(px, feet + 0.04, pz); blob.scale.set(0.9, 0.9, 1); blob.material.opacity = 0.35;

    if (sun) {
      sun.position.set(cineLook.x + 25, cineLook.y + 40, cineLook.z + 18);
      if (sun.target) { sun.target.position.copy(cineLook); sun.target.updateMatrixWorld(); }
    }
    updateWorld(dt);
  }

  camera.position.set(0, 3.2, 10);
  camera.lookAt(0, 1.5, 5);

  return {
    update(dt) {
      dt = Math.min(Number.isFinite(dt) && dt > 0 ? dt : 0.016, 0.05);
      if (cineActive()) {
        // onCinematic drives the intro; fall back to driving it here if the runtime doesn't call it
        if (cineHits > 0) cineHits--;
        else runCinematic(dt, forge.cinematic);
        return;
      }
      if (cineWas) endCinematic();
      if (!hudOn) showHud();
      pollModels(dt);
      clock += dt;
      if (!ended) elapsed += dt;
      inv = Math.max(0, inv - dt); stun = Math.max(0, stun - dt);
      updateWorld(dt);
      let moving = 0, standing = false;
      if (!ended) { const r = updatePlayer(dt); moving = r.mag; standing = r.grounded; }
      else { hero.visible = true; wing.scale.setScalar(Math.max(0.01, damp(wing.scale.x, 0.01, 6, dt))); }
      updateCrumbles(dt, standing);
      updateSentinels(dt);
      updateCamera(dt, moving);

      if (winT >= 0) {
        winT += dt;
        if (forge.rand() < dt * 8) burst(GX + (forge.rand() - 0.5) * 3, GT + 1 + forge.rand() * 6, GZ - 2.5, { color: "#F6C177", count: 6, speed: 3, life: 1, size: 0.18 });
        if (winT > 2.4 && !reported) {
          reported = true;
          const bonus = Math.max(0, Math.round((600 - elapsed) * 5)) + lives * 250;
          score += bonus; hudAll();
          const best = Math.max(Number(forge.load("bestScore", 0)) || 0, score);
          forge.save("bestScore", best);
          forge.win({
            title: "The Beacon Awakens",
            subtitle: "Light returns to the broken sky.",
            stats: { Crystals: `${got} / ${TOTAL}`, Time: fmt(elapsed), "Lives left": lives, "Time bonus": bonus, Score: score, Best: best },
          });
        }
      }
    },
    onCinematic(dt, cine) {
      dt = Math.min(Number.isFinite(dt) && dt > 0 ? dt : 0.016, 0.05);
      cineHits = 2;
      runCinematic(dt, cine);
    },
    dispose() {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onUp);
      canvas.removeEventListener("pointermove", onMove);
      try { if (isLocked() && canvas.ownerDocument.exitPointerLock) canvas.ownerDocument.exitPointerLock(); } catch (e) { /* ignore */ }
      for (const r of roots) if (r.parent) r.parent.remove(r);
      for (const o of owned) { try { if (o && typeof o.dispose === "function") o.dispose(); } catch (e) { /* ignore */ } }
      roots.length = 0; owned.length = 0; pendingModels.length = 0;
    },
  };
}