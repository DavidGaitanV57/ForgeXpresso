// Three.js + Rapier host for 2.5D and 3D games. Exposes forge.three and forge.physics helpers.
import * as THREE from "three";
import RAPIER from "rapier";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export async function createHost(createGame, ctx) {
  const { forge, stage, manifest, input, onProgress } = ctx;
  await RAPIER.init();

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.tabIndex = 0;
  stage.appendChild(renderer.domElement);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  /* ---------- preload ---------- */
  const textures = {};
  const models = {};
  const texLoader = new THREE.TextureLoader();
  texLoader.setCrossOrigin("anonymous");
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  await Promise.all(
    manifest.images.map(async (img) => {
      let tex;
      try {
        if (!img.url) throw new Error("missing");
        tex = await texLoader.loadAsync(img.url);
        img.ready = true;
      } catch {
        tex = new THREE.CanvasTexture(forge._placeholder(img));
        img.ready = false;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAniso;
      img.width = tex.image.width;
      img.height = tex.image.height;
      textures[img.id] = tex;
      onProgress();
    }),
  );
  const gltfLoader = new GLTFLoader();
  gltfLoader.setCrossOrigin("anonymous");
  await Promise.all(
    manifest.models.map(async (m) => {
      try {
        if (m.url) models[m.id] = await gltfLoader.loadAsync(m.url);
      } catch (e) {
        console.warn("[forge] model failed", m.id, e);
      }
      onProgress();
    }),
  );
  const dotTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,.8)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  /* ---------- per-run state ---------- */
  let R = null; // { scene, camera, world, composer, bloom, game, links, billboards, domes, particles, floats, debugLines }
  let running = false;
  let debug = false;
  let raf = 0;
  let last = performance.now();
  let time = 0;

  function size() {
    const w = stage.clientWidth || innerWidth, h = stage.clientHeight || innerHeight;
    return { w, h };
  }
  function onResize() {
    if (!R) return;
    const { w, h } = size();
    renderer.setSize(w, h);
    R.composer.setSize(w, h);
    R.camera.aspect = w / h;
    R.camera.updateProjectionMatrix();
    if (!running) render();
  }
  new ResizeObserver(onResize).observe(stage);

  function render() {
    if (R) R.composer.render();
  }

  /* ---------- helpers ---------- */
  forge.three = {
    lights(o = {}) {
      const hemi = new THREE.HemisphereLight(o.sky ?? "#bcd4ff", o.ground ?? "#40302a", (o.intensity ?? 1) * 0.9);
      const sun = new THREE.DirectionalLight(o.sun ?? "#fff2dd", (o.intensity ?? 1) * 2.2);
      sun.position.set(8, 14, 6);
      sun.castShadow = true;
      const s = (o.shadowSize ?? 40) / 2;
      Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.5, far: 120 });
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
      R.scene.add(hemi, sun, sun.target);
      return { sun, hemi };
    },
    texture(id, o = {}) {
      const base = textures[id];
      if (!base) throw new Error(`Imagen desconocida: ${id}`);
      const t = base.clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1] ?? o.repeat[0]);
      t.needsUpdate = true;
      return t;
    },
    material(id, o = {}) {
      const img = id ? manifest.images.find((i) => i.id === id) : null;
      const m = new THREE.MeshStandardMaterial({
        map: id ? forge.three.texture(id, o) : null,
        color: o.color ?? "#ffffff",
        roughness: o.roughness ?? 0.85,
        metalness: o.metalness ?? 0,
        emissive: o.emissive ?? "#000000",
        emissiveIntensity: o.emissiveIntensity ?? 1,
        flatShading: !!o.flatShading,
      });
      if (img && img.transparent) m.alphaTest = 0.5;
      return m;
    },
    sprite(id, height = 1.7, o = {}) {
      const tex = textures[id];
      if (!tex) throw new Error(`Imagen desconocida: ${id}`);
      const aspect = (tex.image.width || 1) / (tex.image.height || 1);
      const geo = new THREE.PlaneGeometry(height * aspect, height);
      geo.translate(0, height / 2, 0);
      const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 0.22 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 });
      mesh.userData.billboard = o.billboard ?? "y";
      if (mesh.userData.billboard) R.billboards.add(mesh);
      return mesh;
    },
    model(id, o = {}) {
      const gltf = models[id];
      if (!gltf) return null;
      const inner = SkeletonUtils.clone(gltf.scene);
      inner.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
      const box = new THREE.Box3().setFromObject(inner);
      const sz = box.getSize(new THREE.Vector3());
      const s = (o.height ?? 1.7) / Math.max(0.001, sz.y);
      inner.scale.setScalar(s);
      const box2 = new THREE.Box3().setFromObject(inner);
      const c = box2.getCenter(new THREE.Vector3());
      inner.position.set(-c.x, -box2.min.y, -c.z);
      const g = new THREE.Group();
      g.add(inner);
      g.userData.animations = gltf.animations || [];
      return g;
    },
    puppet(obj) {
      const pivot = new THREE.Group();
      while (obj.children.length) pivot.add(obj.children[0]);
      obj.add(pivot);
      let t = 0, wasG = true, land = 0;
      return {
        pivot,
        update(s = {}, dt = 1 / 60) {
          t += dt;
          const sp = s.speed ?? Math.hypot(s.vx || 0, s.vz || 0);
          const g = s.grounded ?? true;
          if (g && !wasG) land = 0.14;
          wasG = g;
          land = Math.max(0, land - dt);
          let sx = 1, sy = 1, y = 0, lean = 0;
          if (!g) {
            const k = clamp(Math.abs(s.vy || 0) / 18, 0, 0.15);
            sy += k;
            sx -= k * 0.5;
          } else if (sp > 0.3) {
            const ph = t * (7 + sp * 1.4);
            y = Math.abs(Math.sin(ph)) * 0.06;
            lean = clamp(sp / 10, 0, 0.18);
          } else {
            const b = Math.sin(t * 2.4) * 0.02;
            sy += b;
            sx -= b * 0.5;
          }
          if (land > 0) {
            const k = land / 0.14;
            sx += 0.18 * k;
            sy -= 0.18 * k;
          }
          pivot.scale.set(sx, sy, sx);
          pivot.position.y = y;
          pivot.rotation.x = lean;
        },
      };
    },
    backdrop(id) {
      const t = textures[id];
      if (t) R.scene.background = t;
      return t;
    },
    skydome(id, radius = 400) {
      const mat = new THREE.MeshBasicMaterial({ map: textures[id], side: THREE.BackSide, fog: false, depthWrite: false });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
      dome.renderOrder = -1;
      R.scene.add(dome);
      R.domes.add(dome);
      return dome;
    },
    fog(color, near = 20, far = 120) {
      R.scene.fog = new THREE.Fog(color, near, far);
      return R.scene.fog;
    },
    follow(camera, target, o = {}) {
      const off = new THREE.Vector3(...(o.offset ?? [0, 3, 8]));
      const look = new THREE.Vector3(...(o.lookAhead ?? [0, 1, 0]));
      const k = o.smooth ?? 6;
      const want = new THREE.Vector3(), aim = new THREE.Vector3(), cur = new THREE.Vector3();
      let first = true;
      return {
        offset: off,
        lookAhead: look,
        update(dt) {
          want.copy(target.position).add(off);
          aim.copy(target.position).add(look);
          if (first) {
            camera.position.copy(want);
            cur.copy(aim);
            first = false;
          }
          const a = 1 - Math.exp(-k * dt);
          camera.position.lerp(want, a);
          cur.lerp(aim, a);
          camera.lookAt(cur);
        },
      };
    },
    bloom(strength = 0.35, radius = 0.4, threshold = 0.85) {
      R.bloom.strength = strength;
      R.bloom.radius = radius;
      R.bloom.threshold = threshold;
      R.bloom.enabled = strength > 0;
    },
    burst(position, o = {}) {
      R.particles.burst(position, o);
    },
    floatText(position, text, o = {}) {
      const el = document.createElement("div");
      el.className = "fx-float";
      el.textContent = text;
      el.style.color = o.color ?? "#fff";
      document.getElementById("fxFloats").appendChild(el);
      R.floats.push({ el, pos: new THREE.Vector3().copy(position), t: 0 });
    },
  };

  forge.physics = {
    addStatic(mesh, o = {}) {
      const W = R.world;
      mesh.updateWorldMatrix(true, true);
      if (o.shape === "trimesh") {
        const verts = [], idx = [];
        mesh.traverse((c) => {
          if (!c.isMesh || !c.geometry) return;
          const g = c.geometry.index ? c.geometry : c.geometry;
          const pos = g.attributes.position;
          const base = verts.length / 3;
          const v = new THREE.Vector3();
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(c.matrixWorld);
            verts.push(v.x, v.y, v.z);
          }
          if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
          else for (let i = 0; i < pos.count; i++) idx.push(base + i);
        });
        const body = W.createRigidBody(RAPIER.RigidBodyDesc.fixed());
        const col = W.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx)).setFriction(o.friction ?? 0.8), body);
        R.bodies.set(mesh, body);
        return col;
      }
      const { half, center, quat } = boxOf(mesh);
      const body = W.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z).setRotation(quat));
      const col = W.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(o.friction ?? 0.8), body);
      R.bodies.set(mesh, body);
      return col;
    },
    addDynamic(mesh, o = {}) {
      const W = R.world;
      const { half, center, quat } = boxOf(mesh);
      const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(center.x, center.y, center.z).setRotation(quat);
      if (o.lockRotations) desc.lockRotations();
      const body = W.createRigidBody(desc);
      let cd;
      if (o.shape === "ball") cd = RAPIER.ColliderDesc.ball(Math.max(half.x, half.y, half.z));
      else if (o.shape === "capsule") cd = RAPIER.ColliderDesc.capsule(Math.max(0.01, half.y - Math.max(half.x, half.z)), Math.max(half.x, half.z));
      else cd = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z);
      cd.setRestitution(o.restitution ?? 0.1).setFriction(o.friction ?? 0.6).setMass(o.mass ?? 1);
      const collider = W.createCollider(cd, body);
      // Keep the mesh's pivot where it was relative to the body center.
      const offset = new THREE.Vector3().copy(mesh.getWorldPosition(new THREE.Vector3())).sub(center);
      R.links.push({ mesh, body, offset });
      R.bodies.set(mesh, body);
      return { body, collider };
    },
    character(o = {}) {
      const W = R.world;
      const radius = o.radius ?? 0.35;
      const height = o.height ?? 1.7;
      const half = Math.max(0.01, height / 2 - radius);
      const lift = half + radius;
      const p = o.position ?? [0, 2, 0];
      const body = W.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p[0], p[1] + lift, p[2]));
      const collider = W.createCollider(RAPIER.ColliderDesc.capsule(half, radius), body);
      const ctrl = W.createCharacterController(0.02);
      ctrl.enableAutostep(o.stepHeight ?? 0.35, 0.2, true);
      ctrl.setMaxSlopeClimbAngle(((o.maxSlopeDeg ?? 50) * Math.PI) / 180);
      ctrl.setMinSlopeSlideAngle(((o.maxSlopeDeg ?? 50) * Math.PI) / 180);
      if (o.snapToGround !== false) ctrl.enableSnapToGround(o.snapToGround ?? 0.3);
      ctrl.setApplyImpulsesToDynamicBodies(true);
      const pos = new THREE.Vector3(p[0], p[1], p[2]);
      const api = {
        body,
        collider,
        grounded: false,
        get position() {
          return pos.clone();
        },
        move(d) {
          ctrl.computeColliderMovement(collider, { x: d.x, y: d.y, z: d.z });
          const m = ctrl.computedMovement();
          const t = body.translation();
          const nx = t.x + m.x, ny = t.y + m.y, nz = t.z + m.z;
          body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
          api.grounded = ctrl.computedGrounded();
          pos.set(nx, ny - lift, nz);
          return api;
        },
        teleport(q) {
          const v = { x: q[0], y: q[1] + lift, z: q[2] };
          body.setTranslation(v, true);
          body.setNextKinematicTranslation(v);
          pos.set(q[0], q[1], q[2]);
        },
      };
      R.controllers.push(ctrl);
      return api;
    },
    raycast(origin, dir, maxDist = 100, o = {}) {
      const d = new THREE.Vector3().copy(dir).normalize();
      const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: d.x, y: d.y, z: d.z });
      const hit = R.world.castRay(ray, maxDist, true, undefined, undefined, o.exclude, undefined);
      if (!hit) return null;
      const toi = hit.timeOfImpact ?? hit.toi;
      const pt = ray.pointAt(toi);
      return { point: new THREE.Vector3(pt.x, pt.y, pt.z), distance: toi, collider: hit.collider };
    },
    remove(x) {
      const body = x && x.isObject3D ? R.bodies.get(x) : x;
      if (!body) return;
      R.links = R.links.filter((l) => l.body !== body);
      if (x && x.isObject3D) R.bodies.delete(x);
      try {
        R.world.removeRigidBody(body);
      } catch {}
    },
  };

  function boxOf(mesh) {
    mesh.updateWorldMatrix(true, true);
    const quat = mesh.getWorldQuaternion(new THREE.Quaternion());
    const scale = mesh.getWorldScale(new THREE.Vector3());
    if (mesh.isMesh && mesh.geometry) {
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      const half = bb.getSize(new THREE.Vector3()).multiply(scale).multiplyScalar(0.5);
      const center = bb.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
      return { half: absVec(half), center, quat };
    }
    const bb = new THREE.Box3().setFromObject(mesh);
    return { half: bb.getSize(new THREE.Vector3()).multiplyScalar(0.5), center: bb.getCenter(new THREE.Vector3()), quat: new THREE.Quaternion() };
  }
  const absVec = (v) => v.set(Math.max(0.005, Math.abs(v.x)), Math.max(0.005, Math.abs(v.y)), Math.max(0.005, Math.abs(v.z)));

  function makeParticles(scene) {
    const N = 2400;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), base = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3), life = new Float32Array(N), max = new Float32Array(N), grav = new Float32Array(N);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({ size: 0.22, map: dotTex, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    for (let i = 0; i < N; i++) pos[i * 3 + 1] = -9999;
    let head = 0;
    const c = new THREE.Color();
    return {
      burst(p, o) {
        c.set(o.color ?? "#ffffff");
        const n = Math.min(400, o.count ?? 24), sp = o.speed ?? 4, lf = o.life ?? 0.7;
        if (o.size) mat.size = 0.22 * o.size;
        for (let k = 0; k < n; k++) {
          const i = head;
          head = (head + 1) % N;
          const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), s = sp * (0.3 + Math.random() * 0.7);
          pos.set([p.x, p.y, p.z], i * 3);
          vel.set([Math.sin(ph) * Math.cos(th) * s, Math.abs(Math.cos(ph)) * s * 0.9 + sp * 0.2, Math.sin(ph) * Math.sin(th) * s], i * 3);
          base.set([c.r, c.g, c.b], i * 3);
          life[i] = max[i] = lf * (0.6 + Math.random() * 0.4);
          grav[i] = o.gravity ?? 6;
        }
      },
      update(dt) {
        for (let i = 0; i < N; i++) {
          if (life[i] <= 0) continue;
          life[i] -= dt;
          const j = i * 3;
          vel[j + 1] -= grav[i] * dt;
          pos[j] += vel[j] * dt;
          pos[j + 1] += vel[j + 1] * dt;
          pos[j + 2] += vel[j + 2] * dt;
          const k = Math.max(0, life[i] / max[i]);
          col[j] = base[j] * k;
          col[j + 1] = base[j + 1] * k;
          col[j + 2] = base[j + 2] * k;
          if (life[i] <= 0) pos[j + 1] = -9999;
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
      },
    };
  }

  /* ---------- lifecycle ---------- */
  async function build() {
    const scene = new THREE.Scene();
    scene.environment = envMap;
    scene.environmentIntensity = 0.55;
    scene.background = new THREE.Color(forge.design?.palette?.[0] || "#0b0e17");
    const { w, h } = size();
    const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 2000);
    camera.position.set(0, 4, 10);
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.4, 0.85);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    R = { scene, camera, world, composer, bloom, game: null, links: [], bodies: new Map(), billboards: new Set(), domes: new Set(), floats: [], controllers: [], debugLines: null };
    R.particles = makeParticles(scene);
    renderer.setSize(w, h);
    composer.setSize(w, h);
    const g = await createGame(forge, { THREE, RAPIER, scene, camera, renderer, world });
    R.game = g || {};
    if (typeof R.game.update !== "function") throw new Error("createGame debe devolver { update(dt) }");
  }

  const tmpV = new THREE.Vector3();
  function step(dt) {
    input._begin();
    R.game.update(dt, time);
    R.world.timestep = clamp(dt, 1 / 240, 1 / 30);
    R.world.step();
    for (const l of R.links) {
      const t = l.body.translation(), q = l.body.rotation();
      l.mesh.position.set(t.x + l.offset.x, t.y + l.offset.y, t.z + l.offset.z);
      l.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
    R.particles.update(dt);
    input._end();
  }
  function post(dt) {
    const cam = R.camera;
    for (const b of R.billboards) {
      if (!b.parent) {
        R.billboards.delete(b);
        continue;
      }
      if (b.userData.billboard === true) b.quaternion.copy(cam.quaternion);
      else if (b.userData.billboard) {
        b.getWorldPosition(tmpV);
        b.rotation.y = Math.atan2(cam.position.x - tmpV.x, cam.position.z - tmpV.z);
      }
    }
    for (const d of R.domes) d.position.copy(cam.position);
    const { w, h } = size();
    R.floats = R.floats.filter((f) => {
      f.t += dt;
      f.pos.y += dt * 1.2;
      tmpV.copy(f.pos).project(cam);
      f.el.style.left = `${((tmpV.x + 1) / 2) * w}px`;
      f.el.style.top = `${((1 - tmpV.y) / 2) * h}px`;
      f.el.style.opacity = String(Math.max(0, 1 - f.t / 1));
      if (f.t > 1 || tmpV.z > 1) {
        f.el.remove();
        return false;
      }
      return true;
    });
    if (debug) {
      const { vertices, colors } = R.world.debugRender();
      if (!R.debugLines) {
        R.debugLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }));
        R.debugLines.renderOrder = 999;
        R.scene.add(R.debugLines);
      }
      R.debugLines.geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
      R.debugLines.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
      R.debugLines.visible = true;
    } else if (R.debugLines) R.debugLines.visible = false;
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    if (!R || !running) return;
    time += dt;
    try {
      step(dt);
      post(dt);
      render();
    } catch (e) {
      running = false;
      ctx.reportError(e, "runtime");
    }
  }

  function teardown() {
    if (!R) return;
    try {
      R.game && R.game.dispose && R.game.dispose();
    } catch (e) {
      console.warn(e);
    }
    for (const f of R.floats) f.el.remove();
    R.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.dispose();
    });
    try {
      R.world.free();
    } catch {}
    R.composer.dispose && R.composer.dispose();
    R = null;
  }

  return {
    async start() {
      await build();
      last = performance.now();
      running = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    },
    pause() {
      running = false;
    },
    resume() {
      last = performance.now();
      running = true;
    },
    async restart() {
      running = false;
      teardown();
      time = 0;
      await build();
      render();
    },
    setDebug(on) {
      debug = on;
      if (R && !running) {
        post(0);
        render();
      }
    },
  };
}
