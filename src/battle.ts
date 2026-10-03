// MÀN CUỐI: đấu Nightmare Moon bằng phép tình bạn.
// Nightmare Moon bay lơ lửng trước lâu đài trăng, quanh mình là lớp bóng tối. Cả nhà đã cứu đứng sau Nhím cổ vũ.
// 5 thử thách = 5 ngọc Hài Hoà sáng dần quanh Twilight; mỗi lần đúng bắn tia hài hoà làm nứt bóng tối.
// Ngọc thứ 5 → cầu vồng hài hoà → bóng tối vỡ tan, Nightmare Moon hoá lại Luna = bác Hanh, trời sáng, cả nhà ăn mừng.
// Sai: Nightmare Moon cười hô hô, không bao giờ phạt.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAST, HARMONY, type CastId, type LevelDef } from './data';
import type { World } from './world';
import type { Hero } from './hero';
import { Actor } from './actors';
import { Challenge } from './challenge';
import { play, sfx } from './audio';
import { say, cheer, cheerAll } from './family';
import { confetti, flash, setStars, showPanel, toast } from './ui';
import { tween, wait, easeOutBack, easeOutQuad } from './tween';

const RAINBOW = [0xff4d5e, 0xff9a2e, 0xffe066, 0x5bd96b, 0x4fb3ff, 0x9b6bff];
export const HERO_SPOT = new THREE.Vector3(0, 0, 2.5);
const BOSS_SPOT = new THREE.Vector3(0, 0, -6.5);
const BOSS_HOVER = 2.2;
const BOSS_H = 4.4;
export const BATTLE_CAM = { pos: new THREE.Vector3(0, 6.8, 17.5), look: new THREE.Vector3(0, 2.1, -1.5), fov: 48 };

/** Chỗ đứng của từng người sau lưng Nhím (x, z) — chừa giữa cho Twilight. */
const SPOTS: Partial<Record<CastId, [number, number]>> = {
  'me-yen': [-3.2, 4.0], 'ba-cuong': [3.2, 4.0], 'ong-cuong': [-5.9, 2.8], 'ba-tuyet': [6.3, 2.2],
  spike: [-1.7, 5.4], mun: [-4.3, 6.3], rom: [4.3, 6.3],
};

/**
 * Chỗ đứng cho n bạn pony: đám đông 2 cánh quanh người nhà, CHỈ ở chỗ camera trận cuối nhìn thấy (chiếu thử từng ô
 * bằng camera BATTLE_CAM theo tỉ lệ màn hiện tại → iPad ngang/dọc đều vừa), chừa lối giữa nhìn thẳng Twilight →
 * Nightmare Moon và chừa đáy màn cho bảng thử thách. Người nhà đứng trước; bạn pony lùi sau, toả 2 bên.
 */
function crowdSpots(n: number, taken: [number, number][]): [number, number][] {
  const cam = new THREE.PerspectiveCamera(BATTLE_CAM.fov, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 400);
  cam.position.copy(BATTLE_CAM.pos);
  cam.lookAt(BATTLE_CAM.look);
  cam.updateMatrixWorld();
  const cands: { x: number; z: number; s: number }[] = [];
  const v = new THREE.Vector3();
  for (let z = -0.6; z <= 9.5; z += 0.45) {
    for (let x = -14; x <= 14; x += 0.45) {
      if (Math.abs(x) < 2.6 && z < 9) continue;           // lối giữa: Twilight + tia phép
      v.set(x, 0.1, z).project(cam);
      if (Math.abs(v.x) > 0.9 || v.y < -0.55) continue;     // ngoài màn / dưới bảng thử thách
      v.set(x, 1.5, z).project(cam);
      if (Math.abs(v.x) > 0.9) continue;
      // người nhà đứng trước (gần camera) → bạn pony ưu tiên đứng lùi sau, toả rộng 2 bên
      cands.push({ x, z, s: Math.abs(z - 0.4) * 0.8 + Math.abs(Math.abs(x) - 7) * 0.45 });
    }
  }
  cands.sort((a, b) => a.s - b.s);
  const out: [number, number][] = [];
  const far = (x: number, z: number, list: [number, number][], d: number) => list.every(([px, pz]) => Math.hypot(px - x, pz - z) >= d);
  for (const minD of [1.45, 1.2, 1.0, 0.8]) {
    for (const c of cands) {
      if (out.length >= n) break;
      if (far(c.x, c.z, out, minD) && far(c.x, c.z, taken, minD + 0.5) && Math.hypot(c.x - HERO_SPOT.x, c.z - HERO_SPOT.z) > 2.4) out.push([c.x, c.z]);
    }
    if (out.length >= n) break;
  }
  while (out.length < n) out.push([(out.length % 2 ? 1 : -1) * 7, 6]);
  // trái/phải xen kẽ theo thứ tự cứu cho cân
  return out.sort((a, b) => a[1] - b[1]);
}

const TAUNTS: [string, string][] = [
  ['nmm_taunt_0', 'Hô hô! Ta thích màn đêm mãi mãi!'],
  ['nmm_taunt_1', 'Hừm, mới một viên ngọc thôi mà!'],
  ['nmm_taunt_2', 'Ối, phép gì mà sáng thế!'],
  ['nmm_taunt_3', 'Bóng tối của ta... mỏng dần rồi!'],
  ['nmm_taunt_4', 'Không thể nào! Còn một viên nữa thôi sao?'],
];
const LAUGHS: [string, string][] = [
  ['nmm_laugh_1', 'Hô hô hô! Thử lại đi nào!'],
  ['nmm_laugh_2', 'Hì hì! Ta biết Nhím làm được mà!'],
];

export interface BattleOptions {
  /** số ngọc đã sáng sẵn (debug ?battle=N) */
  startGems: number;
  /** nhảy thẳng tới cầu vồng + hoá Luna (debug ?win=1) */
  skipToWin: boolean;
}

export class FinalBattle {
  private boss!: Actor;
  private luna!: Actor;
  private aura!: THREE.Mesh;
  private auraCtx!: CanvasRenderingContext2D;
  private auraTex!: THREE.CanvasTexture;
  private gems: THREE.Mesh[] = [];
  private lit = 0;
  private rainbow: THREE.Group | null = null;
  private t = 0;
  private laughIdx = 0;
  private bossShake = 0;
  private gemSpin = 0.6;
  private glow: THREE.PointLight | null = null;
  /** pha để chụp màn hình / debug */
  phase: 'intro' | 'fight' | 'rainbow' | 'luna' | 'party' | 'done' = 'intro';

  constructor(
    private world: World,
    private hero: Hero,
    private level: LevelDef,
    /** người nhà + bạn đứng xem (đã tạo, chưa đặt chỗ) */
    private crowd: Actor[],
    /** tất cả bạn pony đã cứu (đứng sau người nhà) */
    private friends: Actor[],
    private group: THREE.Group,
  ) {}

  /** Tải Nightmare Moon + Luna, dựng sân đấu. */
  async setup(): Promise<void> {
    const [boss, luna] = await Promise.all([this.loadBoss(), Actor.create(this.world, 'bac-hanh')]);
    this.boss = boss;
    this.luna = luna;
    boss.hover = BOSS_HOVER;
    boss.place(BOSS_SPOT.x, BOSS_SPOT.z, 0);
    boss.idleOn = false;
    this.world.scene.add(boss.root);
    luna.hover = BOSS_HOVER;
    luna.place(BOSS_SPOT.x, BOSS_SPOT.z, 0);
    luna.root.visible = false;
    luna.idleOn = false;
    this.world.scene.add(luna.root);

    // lớp bóng tối quanh Nightmare Moon (nứt dần)
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    this.auraCtx = c.getContext('2d')!;
    this.auraTex = new THREE.CanvasTexture(c);
    this.auraTex.colorSpace = THREE.SRGBColorSpace;
    this.aura = new THREE.Mesh(
      new THREE.SphereGeometry(2.9, 40, 24),
      new THREE.MeshBasicMaterial({ map: this.auraTex, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.aura.renderOrder = 3;
    this.group.add(this.aura);
    this.drawAura(0);

    // 5 ngọc Hài Hoà quanh Twilight (mờ, chưa sáng)
    for (const h of HARMONY) {
      const m = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.26, 0),
        new THREE.MeshStandardMaterial({ color: h.color, emissive: h.color, emissiveIntensity: 0.05, roughness: 0.35, transparent: true, opacity: 0.45 }),
      );
      m.scale.set(1, 1.4, 1);
      this.group.add(m);
      this.gems.push(m);
    }

    // Twilight đứng giữa sân, nhìn Nightmare Moon
    this.hero.x = HERO_SPOT.x; this.hero.z = HERO_SPOT.z;
    this.hero.faceTo(BOSS_SPOT.x, BOSS_SPOT.z);
    this.hero.locked = true;
    for (const a of this.crowd) {
      const s = SPOTS[a.id] ?? [0, 9];
      a.place(s[0], s[1], 0);
      a.faceTo(BOSS_SPOT.x * 0.5 + s[0] * 0.5, BOSS_SPOT.z);
      a.idleOn = true;
      this.world.scene.add(a.root);
    }
    const spots = crowdSpots(this.friends.length, this.crowd.map((a) => SPOTS[a.id] ?? [0, 9]));
    this.friends.forEach((a, i) => {
      const [x, z] = spots[i];
      a.place(x, z, 0);
      a.faceTo(BOSS_SPOT.x, BOSS_SPOT.z + BOSS_HOVER);
      a.idleOn = true;
      a.hideBlob(); // iPad: bạn đứng xa không cần bóng tròn (bớt 1 draw call / bạn)
      this.world.scene.add(a.root);
    });
    this.world.setCamera(BATTLE_CAM.pos, BATTLE_CAM.look, true, BATTLE_CAM.fov);
    // iPad: trận cuối tắt bóng đổ thật (đỡ cả 1 lượt vẽ shadow map), ai cũng có bóng tròn mờ
    this.world.setShadows(false);
    // đèn tím dịu soi mặt Nightmare Moon (bộ lông đen) cho bé nhìn rõ
    this.glow = new THREE.PointLight(0xd9ccff, 30, 14, 1.5);
    this.glow.position.set(0, BOSS_HOVER + BOSS_H * 0.6, BOSS_SPOT.z + 4);
    this.group.add(this.glow);
  }

  private async loadBoss(): Promise<Actor> {
    // Nightmare Moon không có trong CAST (không phải người nhà) → tạo Actor từ bản sao def của Luna, đổi model
    const def = { ...CAST['bac-hanh'], model: 'models/ponies/nightmare.glb', height: BOSS_H };
    return Actor.fromDef(this.world, def);
  }

  private drawAura(cracks: number): void {
    const g = this.auraCtx, W = 512, H = 256;
    g.clearRect(0, 0, W, H);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(40,20,110,0.55)');
    grad.addColorStop(0.5, 'rgba(90,50,170,0.22)');
    grad.addColorStop(1, 'rgba(40,20,110,0.55)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // xoáy mây đêm + sao nhỏ
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(25,10,70,${0.08 + rnd() * 0.16})`;
      g.beginPath(); g.ellipse(rnd() * W, rnd() * H, 20 + rnd() * 50, 8 + rnd() * 18, rnd() * 3, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 50; i++) { g.beginPath(); g.arc(rnd() * W, rnd() * H, 0.8 + rnd() * 1.6, 0, Math.PI * 2); g.fill(); }
    // vết nứt sáng: mỗi viên ngọc thêm vài đường zíc zắc
    g.strokeStyle = 'rgba(255,250,220,0.95)';
    g.shadowColor = '#fff6c0';
    g.shadowBlur = 14;
    g.lineCap = 'round';
    seed = 97;
    for (let i = 0; i < cracks * 5; i++) {
      g.lineWidth = 3 + rnd() * 4;
      let x = rnd() * W, y = rnd() * H;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 90; y += (rnd() - 0.5) * 70; g.lineTo(x, y); }
      g.stroke();
    }
    g.shadowBlur = 0;
    this.auraTex.needsUpdate = true;
  }

  update(dt: number): void {
    this.t += dt;
    const b = this.boss;
    if (b?.root.visible) {
      b.update(dt);
      const shake = this.bossShake > 0 ? Math.sin(this.t * 40) * 0.12 * this.bossShake : 0;
      this.bossShake = Math.max(0, this.bossShake - dt * 1.5);
      b.root.position.x += shake;
      this.aura.position.set(b.x + shake, b.y + BOSS_H * 0.5, b.z);
      this.aura.rotation.y += dt * 0.25;
      const pulse = 1 + Math.sin(this.t * 2.2) * 0.03;
      this.aura.scale.setScalar(pulse * (1 - this.lit * 0.05));
      // hạt bóng tối toả ra (giảm dần theo ngọc)
      if (this.aura.visible && Math.random() < 0.5 - this.lit * 0.08) {
        const a = Math.random() * Math.PI * 2;
        this.world.magic.emit({ x: b.x + Math.cos(a) * 2.8, y: b.y + BOSS_H * 0.5 + (Math.random() - 0.5) * 3, z: b.z + Math.sin(a) * 2.8,
          color: Math.random() < 0.5 ? 0x6a4cff : 0x2a1a7a, vy: 0.3, max: 1.2, size: 0.3 });
      }
    }
    if (this.luna?.root.visible) this.luna.update(dt);
    for (const a of this.crowd) a.update(dt);
    for (const a of this.friends) a.update(dt);
    // ngọc xoay vòng quanh Twilight
    const hx = this.hero.x, hz = this.hero.z;
    this.gems.forEach((m, i) => {
      if (!m.visible) return;
      const ang = this.t * this.gemSpin + (i / this.gems.length) * Math.PI * 2;
      m.position.set(hx + Math.cos(ang) * 1.5, 2.5 + Math.sin(this.t * 2 + i) * 0.12, hz + Math.sin(ang) * 1.5);
      m.rotation.y += dt * 2;
      if (i < this.lit && Math.random() < 0.25) this.world.magic.twinkle(m.position, HARMONY[i].color, 1, 0.3);
    });
  }

  private crowdIds(): CastId[] { return [...this.crowd, ...this.friends].map((a) => a.id); }

  /** Cả đám bạn pony nhảy cẫng lần lượt như sóng, ai cũng ngó Nightmare Moon. */
  private friendsCheer(): void {
    this.friends.forEach((a, k) => setTimeout(() => {
      a.faceTo(this.boss.x, this.boss.z + 3);
      a.hop(4 + Math.random() * 1.5);
      if (k % 3 === 0) this.world.magic.twinkle(a.center().add(new THREE.Vector3(0, 0.6, 0)), 0xffd166, 3, 0.5);
    }, 200 + k * 70));
  }

  private async laugh(): Promise<void> {
    this.bossShake = 1;
    const [k, text] = LAUGHS[this.laughIdx++ % LAUGHS.length];
    void tween(600, (q) => { this.boss.pivot.rotation.z = Math.sin(q * Math.PI * 4) * 0.12 * (1 - q); });
    await say('nightmare', k, text, 900);
  }

  /** Thắp ngọc i: sáng lên, bắn tia hài hoà vào bóng tối. */
  private async lightGem(i: number, withBeam = true): Promise<void> {
    const m = this.gems[i];
    const mat = m.material as THREE.MeshStandardMaterial;
    const h = HARMONY[i];
    this.lit = Math.max(this.lit, i + 1);
    setStars(this.lit);
    sfx('sfx_win', 0.5);
    void tween(500, (k) => {
      mat.emissiveIntensity = 0.05 + k * 1.1;
      mat.opacity = 0.45 + k * 0.55;
      m.scale.set(1 + Math.sin(k * Math.PI) * 0.8, 1.4 + Math.sin(k * Math.PI) * 1.1, 1 + Math.sin(k * Math.PI) * 0.8);
    });
    this.world.magic.burst(m.position, 50, h.color, 2.2, 0.3, 0.8, -1);
    if (!withBeam) { this.drawAura(this.lit); return; }
    void this.hero.castPose(900);
    const target = this.aura.position.clone();
    await Promise.all([
      this.world.magic.beam(m.position.clone(), target, h.color, 0xffffff, 0.8),
      this.world.magic.beam(this.hero.hornWorld(), target, 0xc084fc, h.color, 0.9),
    ]);
    // trúng: bóng tối nứt, Nightmare Moon giật mình
    this.drawAura(this.lit);
    this.bossShake = 1;
    this.world.magic.burst(target, 90, h.color, 3.4, 0.34, 0.9, -1);
    this.world.magic.burst(target, 50, 0xffffff, 2.6, 0.26, 0.7, -1);
    const mat2 = this.aura.material as THREE.MeshBasicMaterial;
    void tween(400, (k) => { mat2.opacity = 0.8 - this.lit * 0.1 + Math.sin(k * Math.PI) * 0.2; });
    void tween(500, (k) => { this.boss.pivot.rotation.x = -Math.sin(k * Math.PI) * 0.25; });
    confetti(24);
  }

  /** Chạy cả trận. Resolve khi tới màn kết. */
  async run(opts: BattleOptions, onWrongGlobal?: () => void): Promise<void> {
    const ch = new Challenge(this.level, { onWrong: async () => { onWrongGlobal?.(); await this.laugh(); } });
    for (let i = 0; i < opts.startGems; i++) await this.lightGem(i, false);
    if (!opts.skipToWin) {
      this.phase = 'intro';
      if (opts.startGems === 0) {
        await play(this.level.introAudio);
        this.bossShake = 0.6;
        await say('nightmare', TAUNTS[0][0], TAUNTS[0][1]);
      }
      this.phase = 'fight';
      for (let i = opts.startGems; i < HARMONY.length; i++) {
        const h = HARMONY[i];
        await ch.run(h.kind, i === 0 ? 'final_challenge' : 'final_next', true);
        await this.lightGem(i);
        toast(`◆ ${h.name}`);
        await play(h.audio);
        for (const [k, a] of this.crowd.entries()) setTimeout(() => a.hop(4.5), k * 90);
        this.friendsCheer();
        if (i < HARMONY.length - 1) {
          await say('nightmare', TAUNTS[i + 1][0], TAUNTS[i + 1][1]);
          const owner = h.owner;
          await cheer(this.crowdIds().includes(owner) ? [owner] : this.crowdIds());
        }
      }
    } else {
      for (let i = opts.startGems; i < HARMONY.length; i++) await this.lightGem(i, false);
    }
    showPanel(false);
    await this.harmonyRainbow();
    await this.transform();
    await this.party();
  }

  /** Cầu vồng hài hoà: 5 ngọc bay vòng nhanh, 6 tia cầu vồng + cầu vồng vòm từ Twilight tới Nightmare Moon. */
  private async harmonyRainbow(): Promise<void> {
    this.phase = 'rainbow';
    this.gemSpin = 4;
    void play('rainbow_blast');
    void this.hero.castPose(2200);
    this.world.magic.ring(new THREE.Vector3(this.hero.x, 0.2, this.hero.z), 0xffffff, 120, 4);
    // cầu vồng vòm lớn vắt ngang trời sau lưng Nightmare Moon (camera nhìn thẳng vào), mọc dần từ hai chân
    // 6 dải gộp 1 lưới màu đỉnh (1 draw call thay vì 6)
    const g = new THREE.Group();
    const bands = RAINBOW.map((c, i) => {
      const geo = new THREE.TorusGeometry(10.5 - i * 0.42, 0.22, 8, 72, Math.PI);
      const col = new THREE.Color(c);
      const n = geo.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) arr.set([col.r, col.g, col.b], k * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return geo;
    });
    g.add(new THREE.Mesh(mergeGeometries(bands, false)!, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92, depthWrite: false })));
    for (const b of bands) b.dispose();
    g.position.set(0, 0, BOSS_SPOT.z - 1.5);
    g.scale.set(1, 0.01, 1);
    this.group.add(g);
    this.rainbow = g;
    const target = this.aura.position.clone();
    await Promise.all([
      tween(1100, (k) => g.scale.set(1, Math.max(0.01, k), 1), easeOutQuad),
      ...RAINBOW.map((c, i) => wait(i * 90).then(() => this.world.magic.beam(
        this.hero.hornWorld().add(new THREE.Vector3((i - 2.5) * 0.12, 0, 0)), target, c, 0xffffff, 1.0))),
    ]);
    for (let k = 0; k < 3; k++) {
      this.world.magic.burst(target, 120, RAINBOW[(k * 2) % 6], 4.5, 0.4, 1.2, -1.2);
      await wait(180);
    }
  }

  /** Bóng tối vỡ, Nightmare Moon hoá Luna (bác Hanh), trời sáng dần. */
  private async transform(): Promise<void> {
    this.phase = 'luna';
    flash(1300);
    sfx('sfx_win', 0.7);
    await wait(250);
    const c = this.aura.position.clone();
    this.aura.visible = false;
    for (const col of [0xffffff, 0x9b6bff, 0xffe066, 0xff6fc8]) this.world.magic.burst(c, 110, col, 5, 0.42, 1.3, -1);
    this.boss.root.visible = false;
    this.luna.place(this.boss.x, this.boss.z, 0);
    this.luna.root.visible = true;
    this.luna.root.scale.setScalar(0.01);
    void tween(1200, (k) => this.luna.root.scale.setScalar(Math.max(0.01, k)), easeOutBack);
    this.luna.setFlap(1);
    void this.world.tweenNight(0, 4200);
    this.world.tweenGround(0xc6e88e, 0xa2d276, 4200);
    if (this.rainbow) {
      const rb = this.rainbow;
      void tween(2600, (k) => rb.children.forEach((m) => { ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k); }))
        .then(() => { this.group.remove(rb); });
    }
    await play('luna_back');
    // Luna đáp xuống trước mặt Nhím
    this.luna.setFlap(0.6);
    this.luna.hover = 0.35;
    if (this.glow) this.glow.intensity = 0;
    await this.luna.travel(-2.2, HERO_SPOT.z - 1.0, 1600, 0.6);
    this.luna.faceTo(this.hero.x, this.hero.z);
    this.gemSpin = 0.8;
    await say('bac-hanh', 'luna_thanks', 'Cảm ơn Nhím đã cứu bác!');
  }

  /** Cả nhà ăn mừng, lần lượt khen Nhím. */
  private async party(): Promise<void> {
    this.phase = 'party';
    this.world.setCamera(new THREE.Vector3(0, 5.8, 15), new THREE.Vector3(0, 1.6, 0.5), false, 44);
    this.hero.faceTo(this.hero.x, this.hero.z + 5);
    this.luna.turnTo(0);
    for (const a of this.crowd) a.turnTo(0);
    for (const a of this.friends) a.turnTo(0);
    confetti(120);
    const all = [this.luna, ...this.crowd, ...this.friends];
    all.forEach((a, k) => setTimeout(() => (a.id === 'ba-cuong' ? void a.loopAround() : a.hop(5)), k * 120));
    await this.hero.celebrate();
    const fam = (['me-yen', 'ba-cuong', 'ong-cuong', 'ba-tuyet', 'bac-hanh'] as CastId[])
      .filter((id) => id === 'bac-hanh' || this.crowdIds().includes(id));
    await cheerAll(fam);
    confetti(80);
    this.phase = 'done';
  }

  dispose(): void {
    this.world.scene.remove(this.boss?.root, this.luna?.root);
    for (const a of this.crowd) this.world.scene.remove(a.root);
    for (const a of this.friends) this.world.scene.remove(a.root);
    this.world.setCamera(null);
    this.world.setShadows(true);
  }
}
