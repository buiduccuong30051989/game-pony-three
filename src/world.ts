// Thế giới 3D: đảo ellipse giữa biển, camera bám sau lưng nhân vật (lùi xa như game 5: offset 14 / 18.4), props Kenney
// (props tĩnh GỘP theo vật liệu → ít draw call cho iPad), ngọc, bong bóng,
// ngày/đêm (Nightmare Moon phủ đêm, cứu bà Tuyết thì mặt trời lên), bướm, chim, đom đóm, cỏ hoa đung đưa,
// lâu đài mặt trăng cho màn cuối.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, type LevelDef } from './data';
import { Magic } from './magic';
import { tween, updateTweens, easeInOutSine } from './tween';

export interface Gem { x: number; z: number; mesh: THREE.Mesh; taken: boolean }
export interface LevelHandles {
  gems: Gem[];
  bubble: THREE.Group;
  bubbleMesh: THREE.Mesh;
  /** mèo emoji trong bong bóng (màn 1–2) */
  rescueSprite: THREE.Sprite | null;
  /** chỗ gắn pony vào trong bong bóng (đáy bong bóng, toạ độ local) */
  holder: THREE.Group;
  /** bán kính bong bóng sau khi phóng to */
  bubbleR: number;
  group: THREE.Group;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Camera bám nhân vật: lùi xa như game 5 (game cũ 9.5 / 12.5) để thấy cả hàng bạn + quái + bong bóng phía trước. */
export const CAM_OFFSET = new THREE.Vector3(0, 14.0, 18.4);
const lerpHex = (a: number, b: number, k: number, out = new THREE.Color()) => out.setHex(a).lerp(new THREE.Color(b), k);

interface Swayer { obj: THREE.Object3D; phase: number; amp: number }
interface Flier { sp: THREE.Sprite; ax: number; az: number; phase: number; r: number; speed: number; h: number; size: number }
interface Bird { g: THREE.Group; wings: THREE.Mesh[]; vx: number; phase: number }

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly magic: Magic;
  private readonly timer = new THREE.Timer();
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<GLTF>>();
  private readonly recolored = new Map<THREE.Material, THREE.Material>();
  private readonly clouds: THREE.Group[] = [];
  private level: LevelHandles | null = null;
  private levelDef: LevelDef | null = null;
  private readonly camTarget = new THREE.Vector3();
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private readonly recolorMap: Record<string, number> = {
    leafsGreen: PALETTE.leaf, grass: PALETTE.grassProp, woodBark: PALETTE.bark, dirt: PALETTE.bark,
  };
  // trời
  private skyColors!: THREE.BufferAttribute;
  private skyUpperMat!: THREE.MeshBasicMaterial;
  private waterMat!: THREE.MeshStandardMaterial;
  private readonly hillMats: { mat: THREE.MeshStandardMaterial; far: boolean }[] = [];
  private moon!: THREE.Sprite;
  private sunDisc!: THREE.Sprite;
  private stars!: THREE.Points;
  private readonly cloudMat = new THREE.MeshStandardMaterial({ color: PALETTE.cloud, roughness: 1 });
  private cloudMesh!: THREE.InstancedMesh;
  private readonly ray = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** 0 = ngày, 1 = đêm */
  night = 0;
  // sinh vật / cây cỏ của màn hiện tại
  private swayers: Swayer[] = [];
  private fliers: Flier[] = [];
  private birds: Bird[] = [];
  private fireflyT = 0;
  // camera
  private camOverride: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private readonly camLook = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // iPad: DPR 2 → giới hạn 1.5 cho nhẹ (vẫn nét nhờ antialias)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.info.autoReset = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(PALETTE.sky);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.buildLights();
    this.buildBackdrop();
    this.magic = new Magic(this.scene);
    this.setNight(0);
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private buildLights(): void {
    this.hemi = new THREE.HemisphereLight(0xfff9ec, 0xbfe09c, 1.25);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff5e2, 2.4);
    sun.position.set(8, 16, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -18; sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 60;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    sun.shadow.intensity = 0.45;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  private glowTexture(inner: string, outer: string, craters = false): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    grad.addColorStop(0, outer);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = inner;
    g.beginPath(); g.arc(128, 128, 56, 0, Math.PI * 2); g.fill();
    if (craters) {
      g.fillStyle = 'rgba(190,190,230,0.45)';
      for (const [x, y, r] of [[110, 110, 12], [150, 140, 9], [125, 160, 7], [146, 104, 6]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Trời gradient, biển, đồi xa phía sau, mây, trăng, mặt trời, sao. Giữ qua các màn. */
  private buildBackdrop(): void {
    const geo = new THREE.PlaneGeometry(900, 60, 1, 1);
    this.skyColors = new THREE.BufferAttribute(new Float32Array(4 * 3), 3);
    geo.setAttribute('color', this.skyColors);
    const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
    sky.position.set(0, 14, -140);
    this.scene.add(sky);
    this.skyUpperMat = new THREE.MeshBasicMaterial({ color: PALETTE.skyTop });
    const skyUpper = new THREE.Mesh(new THREE.PlaneGeometry(900, 300), this.skyUpperMat);
    skyUpper.position.set(0, 190, -140.5);
    this.scene.add(skyUpper);

    this.waterMat = new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.9 });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(900, 500), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -1.4, -60);
    water.receiveShadow = true;
    this.scene.add(water);

    const rnd = mulberry32(7);
    // đồi xa: 2 InstancedMesh (gần / xa) → 2 draw call thay vì 22
    const hillGeo = new THREE.SphereGeometry(1, 20, 10);
    for (const far of [false, true]) {
      const mat = new THREE.MeshStandardMaterial({ color: far ? PALETTE.hillFar : PALETTE.hill, roughness: 1 });
      this.hillMats.push({ mat, far });
      const im = new THREE.InstancedMesh(hillGeo, mat, 11);
      const m4 = new THREE.Matrix4();
      for (let k = 0; k < 11; k++) {
        const i = k * 2 + (far ? 0 : 1);
        const r = far ? 22 + rnd() * 12 : 12 + rnd() * 8;
        m4.compose(new THREE.Vector3(-120 + i * 12 + rnd() * 6, -4, far ? -110 - rnd() * 20 : -75 - rnd() * 12), new THREE.Quaternion(), new THREE.Vector3(r, r * 0.4, r));
        im.setMatrixAt(k, m4);
      }
      im.frustumCulled = false;
      this.scene.add(im);
    }
    // mây: 1 InstancedMesh (14 cụm × 4 cục) trôi ngang → 1 draw call
    this.cloudMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), this.cloudMat, 56);
    this.cloudMesh.frustumCulled = false;
    for (let i = 0; i < 14; i++) {
      const g = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const s = new THREE.Object3D();
        s.scale.setScalar(1.6 + rnd() * 1.4);
        s.position.set(k * 2 - 3, rnd() * 0.8, 0);
        g.add(s);
      }
      g.position.set(-90 + i * 14 + rnd() * 8, 16 + rnd() * 8, -50 - rnd() * 40);
      g.userData.speed = 0.3 + rnd() * 0.4;
      this.clouds.push(g);
    }
    this.scene.add(this.cloudMesh);
    this.updateClouds();

    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture('#f4f2ff', 'rgba(200,205,255,0.55)', true), transparent: true, depthWrite: false }));
    this.moon.scale.setScalar(34);
    this.moon.position.set(-34, 23, -128);
    this.scene.add(this.moon);
    this.sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture('#fff3b0', 'rgba(255,214,102,0.6)'), transparent: true, depthWrite: false }));
    this.sunDisc.scale.setScalar(30);
    this.sunDisc.position.set(40, 28, -128);
    this.scene.add(this.sunDisc);

    const n = 260;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() * 2 - 1) * 220;
      pos[i * 3 + 1] = 10 + rnd() * 70;
      pos[i * 3 + 2] = -132;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xfff6d0, size: 1.4, transparent: true, opacity: 0, depthWrite: false }));
    this.scene.add(this.stars);
  }

  // ---------- ngày / đêm ----------
  /** 0 = ngày trong vắt, 1 = đêm của Nightmare Moon (tím, vẫn đủ sáng cho bé nhìn rõ). */
  setNight(n: number): void {
    this.night = n;
    const top = lerpHex(PALETTE.skyTop, PALETTE.nightSkyTop, n);
    const bot = lerpHex(PALETTE.sky, PALETTE.nightSky, n);
    [top, top, bot, bot].forEach((c, i) => this.skyColors.setXYZ(i, c.r, c.g, c.b));
    this.skyColors.needsUpdate = true;
    this.skyUpperMat.color.copy(top);
    (this.scene.background as THREE.Color).copy(bot);
    lerpHex(PALETTE.water, PALETTE.nightWater, n, this.waterMat.color);
    for (const h of this.hillMats) lerpHex(h.far ? PALETTE.hillFar : PALETTE.hill, h.far ? PALETTE.nightHillFar : PALETTE.nightHill, n, h.mat.color);
    lerpHex(0xfff9ec, 0xc9c2ff, n, this.hemi.color);
    lerpHex(0xbfe09c, 0x6c6aa8, n, this.hemi.groundColor);
    this.hemi.intensity = 1.25 - 0.3 * n;
    lerpHex(0xfff5e2, 0xcdd4ff, n, this.sun.color);
    this.sun.intensity = 2.4 - 1.05 * n;
    lerpHex(0x000000, 0x6c62b8, n, this.cloudMat.emissive);   // mây đêm tím nhạt, không xám xịt
    const moonK = THREE.MathUtils.smoothstep(n, 0.25, 0.7);
    this.moon.material.opacity = moonK;
    this.moon.visible = moonK > 0.01;
    (this.stars.material as THREE.PointsMaterial).opacity = THREE.MathUtils.smoothstep(n, 0.3, 0.8);
    this.stars.visible = n > 0.3;
    this.sunDisc.material.opacity = 1 - THREE.MathUtils.smoothstep(n, 0.3, 0.75);
    this.sunDisc.visible = n < 0.75;
    this.sunDisc.position.y = 30 - 26 * n;   // mặt trời nhô lên khi đêm lui
    this.magic.setAdditive(n > 0.4);
    document.documentElement.style.setProperty('--night', n.toFixed(3));
  }

  private groundMats: THREE.MeshStandardMaterial[] = [];
  /** Đổi màu cỏ đảo (màn cuối: cỏ tím đêm → xanh khi trời sáng lại). */
  tweenGround(grass: number, rim: number, ms: number): void {
    const [g, r] = this.groundMats;
    if (!g || !r) return;
    const g0 = g.color.clone(), r0 = r.color.clone(), g1 = new THREE.Color(grass), r1 = new THREE.Color(rim);
    void tween(ms, (k) => { g.color.lerpColors(g0, g1, k); r.color.lerpColors(r0, r1, k); }, easeInOutSine);
  }

  async tweenNight(to: number, ms: number): Promise<void> {
    const from = this.night;
    await tween(ms, (k) => this.setNight(from + (to - from) * k), easeInOutSine);
  }

  // ---------- GLB ----------
  load(name: string): Promise<GLTF> {
    let p = this.cache.get(name);
    if (!p) { p = this.loader.loadAsync(`${import.meta.env.BASE_URL}${name}`); this.cache.set(name, p); }
    return p;
  }

  async instance(name: string): Promise<{ obj: THREE.Object3D; clips: THREE.AnimationClip[] }> {
    const gltf = await this.load(name);
    const obj = SkeletonUtils.clone(gltf.scene);
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        mesh.material = this.recolor(mesh.material);
      }
    });
    return { obj, clips: gltf.animations };
  }

  private recolor(mat: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
    if (Array.isArray(mat)) return mat.map((m) => this.recolor(m) as THREE.Material);
    let out = this.recolored.get(mat);
    if (!out) {
      const m = (mat as THREE.MeshStandardMaterial).clone();
      if ('metalness' in m) { m.metalness = 0; m.roughness = 0.95; }
      const target = this.recolorMap[mat.name];
      if (target !== undefined) m.color.setHex(target);
      out = m;
      this.recolored.set(mat, out);
    }
    return out;
  }

  fitHeight(obj: THREE.Object3D, height: number): number {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => { const sm = o as THREE.SkinnedMesh; if (sm.isSkinnedMesh) sm.computeBoundingBox(); });
    const box = new THREE.Box3().setFromObject(obj, true);
    const size = box.getSize(new THREE.Vector3());
    const s = height / Math.max(size.y, 1e-4);
    obj.scale.multiplyScalar(s);
    obj.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(obj, true);
    const c = box2.getCenter(new THREE.Vector3());
    obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= box2.min.y;
    return s;
  }

  private readonly emojiTex = new Map<string, THREE.CanvasTexture>();
  emojiSprite(emoji: string, size = 1): THREE.Sprite {
    let tex = this.emojiTex.get(emoji);
    if (!tex) {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d')!;
      ctx.font = '200px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(emoji, 128, 140);
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.emojiTex.set(emoji, tex);
    }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.setScalar(size);
    return sp;
  }

  // ---------- đảo ----------
  /** Kéo (x,z) vào trong đảo nếu lọt ra ngoài mép. */
  clampToIsland(x: number, z: number): [number, number] {
    if (!this.levelDef) return [x, z];
    const { rx, rz } = this.levelDef.island;
    const k = Math.hypot(x / (rx - 1.2), z / (rz - 1.2));
    if (k <= 1) return [x, z];
    return [x / k, z / k];
  }

  /** bubbleScale: 1 = mèo (emoji `rescueEmoji` trong bong bóng), ~1.35 = pony, ~1.75 = công chúa (gắn model vào holder). */
  async buildLevel(def: LevelDef, bubbleScale = 1, rescueEmoji?: string): Promise<LevelHandles> {
    if (this.level) this.scene.remove(this.level.group);
    for (const b of this.birds) this.scene.remove(b.g);
    this.swayers = []; this.fliers = []; this.birds = [];
    this.camOverride = null;
    this.levelDef = def;
    const group = new THREE.Group();
    this.scene.add(group);
    const rnd = mulberry32(def.id.length * 977 + def.island.rx * 13 + def.id.charCodeAt(0));
    const { rx, rz } = def.island;
    const th = def.theme;

    // đảo: trụ ellipse, mặt cỏ, vách cát; viền cỏ đậm
    const grass = new THREE.MeshStandardMaterial({ color: th.grass, roughness: 1 });
    this.groundMats = [grass];
    const sand = new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 1 });
    const island = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.07, 2.2, 128), [sand, grass, sand]);
    island.scale.set(rx, 1, rz);
    island.position.y = -1.1;
    island.receiveShadow = true;
    group.add(island);
    const rimMat = new THREE.MeshStandardMaterial({ color: th.grassDark, roughness: 1 });
    this.groundMats.push(rimMat);
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.955, 1.0, 128), rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.01;
    rim.scale.set(rx, rz, 1);
    group.add(rim);
    const shade = new THREE.Mesh(new THREE.CircleGeometry(1.12, 96), new THREE.MeshBasicMaterial({ color: 0x84cfe6, transparent: true, opacity: 0.5 }));
    shade.rotation.x = -Math.PI / 2;
    shade.position.y = -1.39;
    shade.scale.set(rx, rz, 1);
    group.add(shade);

    // chỗ cần trống: quái, ngọc, bong bóng, xuất phát (màn cuối: cả sân đấu + lâu đài)
    const keep: [number, number, number][] = [
      ...def.monsters.map((m) => [m.x, m.z, 3.2] as [number, number, number]),
      ...def.gems.map(([x, z]) => [x, z, 1.6] as [number, number, number]),
      [def.bubble[0], def.bubble[1], 3.5 * bubbleScale], [def.start[0], def.start[1], 3],
    ];
    if (def.final) keep.push([0, 1, 11], [0, -15, 8.5]);
    const free = (x: number, z: number) => keep.every(([kx, kz, r]) => Math.hypot(x - kx, z - kz) > r);
    const inside = (x: number, z: number, margin: number) => Math.hypot(x / (rx - margin), z / (rz - margin)) < 1;

    const jobs: Promise<unknown>[] = [];
    // props tĩnh vào `statics` → gộp theo vật liệu sau khi tải (vài draw call thay vì vài trăm)
    const statics = new THREE.Group();
    group.add(statics);
    const trees = ['tree_default', 'tree_fat', 'tree_oak', 'tree_small'];
    const plants = ['plant_bush', 'plant_bushSmall', 'rock_smallA', 'mushroom_red', 'grass', 'grass_large'];
    const flowers = ['flower_yellowA', 'flower_redA', 'flower_purpleA'];
    const apples = !!th.deco?.some((d) => d === '🍎' || d === '🍏');
    let placed = 0, tries = 0;
    const treeCount = def.final ? 10 : 26;
    while (placed < treeCount && tries++ < 400) {
      const x = (rnd() * 2 - 1) * rx, z = (rnd() * 2 - 1) * rz;
      if (!inside(x, z, 2.5) || !free(x, z)) continue;
      // cây ưu tiên gần mép và phía sau (z âm) để không che nhân vật
      const edge = Math.hypot(x / rx, z / rz);
      if (edge < 0.55 && rnd() < 0.7) continue;
      const s = 1.4 + rnd() * 0.7;
      const picks = apples ? [0, 1, 2].map(() => [rnd(), rnd(), rnd()]) : [];
      jobs.push(this.addProp(statics, trees[Math.floor(rnd() * trees.length)] + '.glb', x, z, s, rnd()).then((tree) => {
        if (!picks.length) return;
        // vườn táo của ông Cương (Applejack): táo bám quanh tán lá thật của cây
        const box = new THREE.Box3().setFromObject(tree);
        const h = box.max.y, w = (box.max.x - box.min.x) * 0.42;
        for (const [a, b, c] of picks) {
          const ang = a * Math.PI * 2;
          const sp = this.emojiSprite(c < 0.7 ? '🍎' : '🍏', 0.5);
          sp.position.set(x + Math.cos(ang) * w, h * (0.6 + b * 0.25), z + Math.sin(ang) * w);
          group.add(sp);
        }
      }));
      keep.push([x, z, 2.2]);
      placed++;
    }
    placed = 0; tries = 0;
    const flowerK = th.flowers ?? 0.3;
    while (placed < 95 && tries++ < 900) {
      const x = (rnd() * 2 - 1) * rx, z = (rnd() * 2 - 1) * rz;
      if (!inside(x, z, 1.5) || !free(x, z)) continue;
      const isFlower = rnd() < flowerK;
      const name = isFlower ? flowers[Math.floor(rnd() * flowers.length)] : plants[Math.floor(rnd() * plants.length)];
      // chỉ 1/8 số cỏ hoa đung đưa (mỗi cây đung đưa = 1 draw call riêng), còn lại gộp tĩnh
      const sway = placed % 8 ? 0 : isFlower ? 0.12 : name.startsWith('grass') || name.startsWith('plant') ? 0.07 : 0;
      jobs.push(this.addProp(sway ? group : statics, name + '.glb', x, z, 0.8 + rnd() * 0.6, undefined, sway, false));
      placed++;
    }
    await Promise.all(jobs);
    if (def.final) this.buildCastle(statics);
    this.mergeStatic(statics);

    // emoji trang trí theo chủ đề màn
    const deco = (th.deco ?? []).filter((d) => d !== '🍎' && d !== '🍏');
    placed = 0; tries = 0;
    while (deco.length && placed < 16 && tries++ < 300) {
      const x = (rnd() * 2 - 1) * rx, z = (rnd() * 2 - 1) * rz;
      if (!inside(x, z, 2) || !free(x, z)) continue;
      const e = deco[placed % deco.length];
      const cloud = e === '☁️';
      const size = cloud ? 2.2 + rnd() : 0.7 + rnd() * 0.4;
      const sp = this.emojiSprite(e, size);
      const h = cloud ? 4.5 + rnd() * 2 : 0.45;
      sp.position.set(x, h, z);
      group.add(sp);
      this.fliers.push({ sp, ax: x, az: z, phase: rnd() * 6, r: 0, speed: 0, h, size });
      placed++;
    }

    // bướm (ban đêm vẫn bay — Equestria mà), màn cuối là đốm sao
    const flyEmoji = def.final ? '✨' : '🦋';
    for (let i = 0; i < 9; i++) {
      let x = 0, z = 0, k = 0;
      do { x = (rnd() * 2 - 1) * rx * 0.8; z = (rnd() * 2 - 1) * rz * 0.8; } while (!inside(x, z, 3) && k++ < 20);
      const sp = this.emojiSprite(flyEmoji, 0.5);
      group.add(sp);
      this.fliers.push({ sp, ax: x, az: z, phase: rnd() * 6, r: 1.2 + rnd() * 1.6, speed: 0.5 + rnd() * 0.6, h: 1.2 + rnd() * 0.9, size: 0.5 });
    }

    // chim bay ngang (V cánh vỗ), chỉ hiện khi trời đủ sáng
    const birdMat = new THREE.MeshBasicMaterial({ color: 0x4a4a6a, side: THREE.DoubleSide });
    const wingGeo = new THREE.PlaneGeometry(0.7, 0.18).translate(0.35, 0, 0);
    for (let i = 0; i < 5; i++) {
      const g = new THREE.Group();
      const wings: THREE.Mesh[] = [];
      for (const s of [1, -1]) {
        const w = new THREE.Mesh(wingGeo, birdMat);
        w.scale.x = s;
        g.add(w);
        wings.push(w);
      }
      g.position.set(-rx - 10 - rnd() * 30, 6 + rnd() * 3, -rz * 0.6 + rnd() * rz);
      this.scene.add(g);
      this.birds.push({ g, wings, vx: 2.5 + rnd() * 1.5, phase: rnd() * 6 });
    }


    // ngọc
    const gemGeo = new THREE.OctahedronGeometry(0.32, 0);
    const gemMat = new THREE.MeshStandardMaterial({ color: 0x7fd8ff, emissive: 0x2a8fd8, emissiveIntensity: 0.6, roughness: 0.3 });
    const gems: Gem[] = def.gems.map(([x, z]) => {
      const mesh = new THREE.Mesh(gemGeo, gemMat);
      mesh.position.set(x, 1.0, z);
      mesh.castShadow = true;
      group.add(mesh);
      return { x, z, mesh, taken: false };
    });

    // bong bóng pha lê mặt trăng nhốt người thân
    const R = 1.5 * bubbleScale;
    const { group: bubble, mesh: bubbleMesh, holder } = this.makeBubble(R);
    let rescueSprite: THREE.Sprite | null = null;
    bubble.position.set(def.bubble[0], R + 0.4, def.bubble[1]);
    bubble.userData.baseY = R + 0.4;
    if (rescueEmoji) {
      rescueSprite = this.emojiSprite(rescueEmoji, 1.7);
      rescueSprite.position.y = -0.1;
      bubble.add(rescueSprite);
    }
    if (!def.final) group.add(bubble);

    this.level = { gems, bubble, bubbleMesh, rescueSprite, holder, bubbleR: R, group };
    this.camTarget.set(def.start[0], 0, def.start[1]);
    this.setNight(th.night);
    return this.level;
  }

  private bubbleMat: THREE.MeshPhysicalMaterial | null = null;
  /**
   * Bong bóng pha lê mặt trăng bán kính R: vỏ trong suốt + 🌙 + ✨, `holder` ở đáy để gắn người/pony bị nhốt.
   * Dùng cho bong bóng người nhà cuối màn và bong bóng nhỏ cạnh mỗi quái (giữ bạn pony).
   */
  makeBubble(R: number): { group: THREE.Group; mesh: THREE.Mesh; holder: THREE.Group } {
    if (!this.bubbleMat) {
      this.bubbleMat = new THREE.MeshPhysicalMaterial({ color: 0xe4dcff, transparent: true, opacity: 0.34, roughness: 0.1, metalness: 0, clearcoat: 1, depthWrite: false });
    }
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 24), this.bubbleMat);
    mesh.renderOrder = 2;
    group.add(mesh);
    const holder = new THREE.Group();
    holder.position.y = -R * 0.8;
    group.add(holder);
    const k = Math.sqrt(R / 1.5);
    const moonBadge = this.emojiSprite('🌙', 0.8 * k);
    moonBadge.position.set(R * 0.62, R * 0.62, R * 0.4);
    group.add(moonBadge);
    const shine = this.emojiSprite('✨', 0.7 * k);
    shine.position.set(-R * 0.5, R * 0.55, R * 0.5);
    group.add(shine);
    return { group, mesh, holder };
  }

  /**
   * Giải phóng 1 model đã tải (hình học, vật liệu đã đổi màu, texture) khỏi bộ nhớ GPU + cache.
   * Gọi khi rời màn cho model bạn pony màn sau không dùng (iPad ít RAM). Lần sau cần thì tải lại.
   */
  async release(name: string): Promise<void> {
    const p = this.cache.get(name);
    if (!p) return;
    this.cache.delete(name);
    let gltf: GLTF;
    try { gltf = await p; } catch { return; }
    const textures = new Set<THREE.Texture>();
    const disposeMat = (m: THREE.Material) => {
      for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture) textures.add(v as THREE.Texture);
      m.dispose();
    };
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const r = this.recolored.get(m);
        if (r) { disposeMat(r); this.recolored.delete(m); }
        disposeMat(m);
      }
    });
    for (const t of textures) t.dispose();
  }

  /** Lâu đài mặt trăng (màn cuối): khối tím mềm, mái nhọn, cửa sổ vàng ấm — đẹp, không đáng sợ. */
  private buildCastle(group: THREE.Group): void {
    const wall = new THREE.MeshStandardMaterial({ color: 0x5a4aa6, roughness: 0.9 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x8a63d2, roughness: 0.8 });
    const win = new THREE.MeshBasicMaterial({ color: 0xffe58a });
    const castle = new THREE.Group();
    const keep = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 7.5, 24), wall);
    keep.position.y = 3.75;
    castle.add(keep);
    const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 4, 24), roof);
    keepRoof.position.y = 9.5;
    castle.add(keepRoof);
    for (const [x, z, h] of [[-5.5, 1, 6], [5.5, 1, 6], [-3.2, -2.5, 8.5], [3.2, -2.5, 8.5]] as const) {
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, h, 16), wall);
      tw.position.set(x, h / 2, z);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.8, 16), roof);
      cap.position.set(x, h + 1.4, z);
      const flag = this.emojiSprite('🌙', 1.1);
      flag.position.set(x, h + 3.4, z);
      castle.add(tw, cap, flag);
      for (let k = 0; k < 2; k++) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.7), win);
        w.position.set(x, h * (0.45 + k * 0.3), z + 1.26);
        castle.add(w);
      }
    }
    const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(11, 3.4, 1), wall);
    wallMesh.position.set(0, 1.7, 1.2);
    castle.add(wallMesh);
    const door = new THREE.Mesh(new THREE.CircleGeometry(1.1, 20, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x2e2560 }));
    door.position.set(0, 0.01, 1.71);
    castle.add(door);
    for (let k = 0; k < 3; k++) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.8), win);
      w.position.set(-1 + k, 5.2, 2.66);
      castle.add(w);
    }
    castle.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.material !== win) { m.castShadow = true; m.receiveShadow = true; } });
    castle.position.set(0, 0, -15.5);
    group.add(castle);
  }

  private async addProp(group: THREE.Group, name: string, x: number, z: number, scale: number, tint?: number, sway = 0, cast = true): Promise<THREE.Object3D> {
    const { obj } = await this.instance('models/' + name);
    // cỏ hoa nhỏ không đổ bóng thật (đỡ 1 lượt vẽ vào shadow map / mỗi draw call)
    if (!cast) obj.traverse((o) => { o.castShadow = false; });
    obj.position.set(x, 0, z);
    obj.rotation.y = Math.random() * Math.PI * 2;
    obj.scale.setScalar(scale);
    if (tint !== undefined) {
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && !Array.isArray(mesh.material) && mesh.material.name === 'leafsGreen') {
          const m = (mesh.material as THREE.MeshStandardMaterial).clone();
          m.color.offsetHSL((tint - 0.5) * 0.06, 0, (tint - 0.5) * 0.12);
          mesh.material = m;
        }
      });
    }
    if (sway > 0) {
      // bọc 1 lớp để lắc quanh gốc mà không đụng hướng xoay ngẫu nhiên
      const pivot = new THREE.Group();
      pivot.position.copy(obj.position);
      obj.position.set(0, 0, 0);
      pivot.add(obj);
      group.add(pivot);
      this.swayers.push({ obj: pivot, phase: x * 0.35 + z * 0.2, amp: sway });
      return obj;
    }
    group.add(obj);
    return obj;
  }

  /** Gộp mọi mesh tĩnh trong `g` theo vật liệu → vài draw call thay vì vài trăm (port từ game 5). */
  private mergeStatic(g: THREE.Group): void {
    g.updateMatrixWorld(true);
    const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean }>();
    const remove: THREE.Mesh[] = [];
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material) || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
      const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      geo.applyMatrix4(m.matrixWorld);
      // gộp theo THUỘC TÍNH vật liệu (Kenney: mỗi file GLB có vật liệu riêng dù cùng màu) → ít nhóm hơn
      const mm = m.material as THREE.MeshStandardMaterial;
      const key = mm.map ? mm.uuid : `${mm.type}|${mm.color?.getHexString()}|${mm.emissive?.getHexString()}|${mm.transparent}|${mm.side}`;
      const sig = `${key}|${Object.keys(geo.attributes).sort().join(',')}|${m.castShadow}`;
      let b = buckets.get(sig);
      if (!b) { b = { mat: m.material, geos: [], cast: m.castShadow }; buckets.set(sig, b); }
      b.geos.push(geo);
      remove.push(m);
    });
    for (const m of remove) m.removeFromParent();
    for (const b of buckets.values()) {
      const merged = mergeGeometries(b.geos, false);
      for (const geo of b.geos) geo.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
  }

  private updateClouds(): void {
    let i = 0;
    for (const g of this.clouds) {
      g.updateMatrixWorld(true);
      for (const s of g.children) this.cloudMesh.setMatrixAt(i++, s.matrixWorld);
    }
    this.cloudMesh.instanceMatrix.needsUpdate = true;
  }

  /** Bật / tắt bóng đổ thật (trận cuối tắt để giữ ngân sách draw call). */
  setShadows(on: boolean): void { this.sun.castShadow = on; }

  // ---------- chạm ----------
  private setRay(px: number, py: number): void {
    const v = new THREE.Vector2((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
  }
  /** Điểm trên mặt đất (y = 0) dưới ngón tay. */
  groundAt(px: number, py: number): THREE.Vector3 | null {
    this.setRay(px, py);
    return this.ray.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
  }
  /** Chiếu điểm thế giới ra px màn hình (test / debug). */
  toScreen(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.camera);
    return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
  }

  start(update: (dt: number) => void): void {
    this.renderer.setAnimationLoop(() => {
      this.timer.update();
      const dt = Math.min(this.timer.getDelta(), 0.05);
      updateTweens(dt);
      update(dt);
      this.magic.update(dt);
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** Camera cố định cho cảnh đặc biệt (trận cuối); null = bám nhân vật như thường. snap = nhảy ngay không trượt. */
  setCamera(pos: THREE.Vector3 | null, look?: THREE.Vector3, snap = false, fov = 38): void {
    this.camOverride = pos ? { pos: pos.clone(), look: (look ?? new THREE.Vector3()).clone() } : null;
    if (pos && snap) { this.camera.position.copy(pos); this.camLook.copy(look ?? new THREE.Vector3()); }
    this.fovGoal = pos ? fov : 38;
    if (snap || !pos) { this.camera.fov = this.fovGoal; this.camera.updateProjectionMatrix(); }
  }
  private fovGoal = 38;

  /** Camera bám sau lưng nhân vật (góc cố định), mây trôi, ngọc xoay, bong bóng nhún, bướm/chim/cỏ/đom đóm. */
  follow(dt: number, hx: number, hz: number, t: number): void {
    this.camTarget.x += (hx - this.camTarget.x) * Math.min(1, dt * 4);
    this.camTarget.z += (hz - this.camTarget.z) * Math.min(1, dt * 4);
    if (this.camOverride) {
      const r = Math.min(1, dt * 2.5);
      this.camera.position.lerp(this.camOverride.pos, r);
      this.camLook.lerp(this.camOverride.look, r);
      this.camera.lookAt(this.camLook);
      if (Math.abs(this.camera.fov - this.fovGoal) > 0.05) { this.camera.fov += (this.fovGoal - this.camera.fov) * r; this.camera.updateProjectionMatrix(); }
      this.sun.position.set(8, 16, 14);
      this.sun.target.position.set(0, 0, 0);
    } else {
      this.camera.position.copy(this.camTarget).add(CAM_OFFSET);
      this.camLook.set(this.camTarget.x, 1.0, this.camTarget.z - 1.2);
      this.camera.lookAt(this.camLook);
      this.sun.position.set(this.camTarget.x + 8, 16, this.camTarget.z + 10);
      this.sun.target.position.set(this.camTarget.x, 0, this.camTarget.z);
    }
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 110) c.position.x -= 220;
    }
    this.updateClouds();
    if (!this.level) return;
    for (const g of this.level.gems) {
      if (g.taken) continue;
      g.mesh.rotation.y += dt * 2;
      g.mesh.position.y = 1.0 + Math.sin(t * 3 + g.x) * 0.12;
    }
    const b = this.level.bubble;
    b.position.y = (b.userData.baseY ?? 1.9) + Math.sin(t * 1.6) * 0.18;
    // cỏ hoa đung đưa theo gió
    for (const s of this.swayers) {
      s.obj.rotation.z = Math.sin(t * 1.8 + s.phase) * s.amp;
      s.obj.rotation.x = Math.sin(t * 1.3 + s.phase * 1.7) * s.amp * 0.5;
    }
    // bướm bay lượn quanh 1 điểm, vỗ cánh (co giãn bề ngang); deco nhún nhẹ
    for (const f of this.fliers) {
      if (f.r === 0) { f.sp.position.y = f.h + Math.sin(t * 2 + f.phase) * 0.08; continue; }
      const a = t * f.speed + f.phase;
      f.sp.position.set(f.ax + Math.sin(a) * f.r, f.h + Math.sin(a * 2.3) * 0.35, f.az + Math.sin(a * 0.7) * Math.cos(a) * f.r);
      const flap = 0.55 + 0.45 * Math.abs(Math.sin(t * 14 + f.phase));
      f.sp.scale.set(f.size * flap, f.size, 1);
    }
    // chim: chỉ khi trời đã đủ sáng
    const showBirds = this.night < 0.6;
    const edge = (this.levelDef?.island.rx ?? 30) + 25;
    for (const bd of this.birds) {
      bd.g.visible = showBirds;
      bd.g.position.x += bd.vx * dt;
      bd.g.position.y += Math.sin(t * 1.2 + bd.phase) * 0.004;
      if (bd.g.position.x > edge) bd.g.position.x = -edge;
      const a = Math.sin(t * 9 + bd.phase) * 0.6;
      bd.wings[0].rotation.z = a; bd.wings[1].rotation.z = -a;
    }
    // đom đóm ban đêm quanh chỗ nhân vật
    if (this.night > 0.35) {
      this.fireflyT += dt * this.night;
      while (this.fireflyT > 0.09) {
        this.fireflyT -= 0.09;
        const [cx, cz] = this.clampToIsland(this.camTarget.x + (Math.random() * 2 - 1) * 14, this.camTarget.z + (Math.random() * 2 - 1) * 9);
        this.magic.emit({ x: cx, y: 0.4 + Math.random() * 2.2, z: cz, color: Math.random() < 0.7 ? 0xfff2a0 : 0xc5ffb0,
          vx: (Math.random() - 0.5) * 0.4, vy: 0.15, vz: (Math.random() - 0.5) * 0.4, max: 2.2, size: 0.18 });
      }
    }
  }
}
