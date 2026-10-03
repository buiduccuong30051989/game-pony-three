// Người nhà + bạn bè trong thế giới 3D: pony (auto-rig 4 chân), công chúa bay (xương sẵn), Spike, mèo emoji.
// Một Actor tự lo: đi theo điểm đích có trễ, phi nước kiệu, nhảy, quay về camera, ngó nghiêng khi đứng chơi.
import * as THREE from 'three';
import { CAST, type CastDef, type CastId } from './data';
import type { World } from './world';
import { autoRigQuadruped, makeFlyer, type Walker, type WalkerPose } from './rig';
import { tween, easeOutQuad, easeInOutSine } from './tween';
import { paintEyes } from './eyes';
import { mergeByMaterial } from './merge';

const GRAVITY = 24;
const RAINBOW = [0xff4d5e, 0xff9a2e, 0xffe066, 0x5bd96b, 0x4fb3ff, 0x9b6bff];

type IdleAct = 'hop' | 'camera' | 'look' | 'tail' | 'loop';

// Bóng tròn mờ dưới chân (thay bóng đổ thật cho người đi theo → nhẹ cho iPad: mỗi pony 30–140k tam giác,
// đổ bóng thật là vẽ lại lần nữa vào shadow map).
let blobTex: THREE.CanvasTexture | null = null;
function blobShadow(radius: number): THREE.Mesh {
  if (!blobTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(40,30,70,0.55)');
    grad.addColorStop(0.6, 'rgba(40,30,70,0.25)');
    grad.addColorStop(1, 'rgba(40,30,70,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

/** Lưới thân (chạm đất, nhiều đỉnh nhất) — cùng cách chọn với autoRigQuadruped → để nguyên khi gộp. */
function bodyOf(model: THREE.Object3D): THREE.Mesh[] {
  model.updateMatrixWorld(true);
  const whole = new THREE.Box3().setFromObject(model, true);
  const H = whole.max.y - whole.min.y;
  const meshes: THREE.Mesh[] = [];
  model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry?.attributes.position) meshes.push(m); });
  const body = meshes
    .filter((m) => new THREE.Box3().setFromObject(m, true).min.y < whole.min.y + H * 0.05)
    .sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count)[0];
  return body ? [body] : [];
}

export class Actor {
  readonly root = new THREE.Group();   // vị trí thế giới + hướng
  readonly pivot = new THREE.Group();  // nhún, nghiêng, ép dẹt
  x = 0; z = 0; y = 0; vy = 0;
  yaw = 0;
  /** độ cao bay lơ lửng (công chúa) */
  hover = 0;
  /** đang diễn kịch bản (tween) → không tự đi, không tự đứng chơi */
  busy = false;
  /** cho phép tự đứng chơi (nhảy, quay về camera...) */
  idleOn = true;
  /** cho phép tự nhảy khi đứng chơi (trong bong bóng thì không) */
  allowHop = true;
  private speed = 0;
  private walkK = 0;
  private t = Math.random() * 10;
  private landSquash = 0;
  private idleT = 0;
  private nextIdle = 2 + Math.random() * 4;
  private yawGoal: number | null = null;
  private lookGoal = 0;
  private tailGoal = 0;
  private actT = 0;
  private flipX = 1;
  private constructor(
    private readonly world: World,
    readonly def: CastDef,
    private readonly walker: (Walker & { flap?: number }) | null,
    private readonly sprite: THREE.Sprite | null,
  ) {
    this.root.add(this.pivot);
    this.blob = blobShadow(def.kind === 'flyer' ? def.height * 0.4 : def.height * 0.45);
    this.root.add(this.blob);
  }
  private readonly blob: THREE.Mesh;
  /** Bỏ bóng tròn dưới chân (đám đông trận cuối: bớt draw call). */
  hideBlob(): void { this.blob.visible = false; }
  /** geometry gộp tạo riêng cho actor này (dispose khi bỏ) */
  merged: THREE.BufferGeometry[] = [];

  get id(): CastId { return this.def.id; }
  get flyer(): boolean { return this.def.kind === 'flyer'; }
  get grounded(): boolean { return this.y <= this.hover + 1e-3 && this.vy === 0; }

  static create(world: World, id: CastId): Promise<Actor> { return Actor.fromDef(world, CAST[id]); }

  static async fromDef(world: World, def: CastDef): Promise<Actor> {
    let actor: Actor;
    if (def.kind === 'cat' || !def.model) {
      const sp = world.emojiSprite(def.emoji, def.height * 1.25);
      sp.position.y = def.height * 0.55;
      actor = new Actor(world, def, null, sp);
      actor.pivot.add(sp);
    } else {
      const { obj } = await world.instance(def.model);
      world.fitHeight(obj, def.height);
      if (def.eyes) paintEyes(obj, def.eyes.mat, def.eyes.iris);
      let skinned = false;
      obj.traverse((o) => { o.castShadow = false; if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true; });
      // iPad: gộp mảnh lưới cùng vật liệu (công chúa bay giữ xương để vỗ cánh; thân pony giữ riêng để auto-rig)
      let merged: THREE.BufferGeometry[] = [];
      if (def.kind === 'flyer') merged = mergeByMaterial(obj, undefined, true);
      else merged = mergeByMaterial(obj, skinned ? undefined : new Set(bodyOf(obj)));
      let walker: (Walker & { flap?: number }) | null = null;
      // pony có xương sẵn (VV2006, G5...) thì không auto-rig được (đè xương) → nhún nhảy bằng pivot như Spike
      if (def.kind === 'pony' && !skinned) walker = autoRigQuadruped(obj);
      else if (def.kind === 'flyer') walker = makeFlyer(obj);
      actor = new Actor(world, def, walker, null);
      actor.merged = merged;
      actor.pivot.add(obj);
      if (def.kind === 'flyer') { actor.hover = 0.55; actor.y = actor.hover; }
    }
    actor.root.position.set(actor.x, actor.y, actor.z);
    return actor;
  }

  place(x: number, z: number, yaw = 0): void {
    this.x = x; this.z = z; this.yaw = yaw;
    this.y = this.hover; this.vy = 0; this.speed = 0;
    this.root.position.set(x, this.y, z);
    this.root.rotation.y = yaw;
  }

  faceTo(x: number, z: number): void {
    this.yaw = Math.atan2(x - this.x, z - this.z);
    this.yawGoal = null;
  }

  /** Quay mượt về một hướng (giữ tới khi bắt đầu đi). */
  turnTo(yaw: number): void { this.yawGoal = yaw; }

  /** Vỗ cánh mạnh/yếu (chỉ công chúa có xương cánh). */
  setFlap(f: number): void { if (this.walker && 'flap' in this.walker) this.walker.flap = f; }

  hop(v = 5): void {
    if (!this.grounded) return;
    this.vy = v;
  }

  /** Đi về phía (tx, tz); dừng khi cách < stop. Chạy nhanh hơn khi bị bỏ xa. */
  follow(dt: number, tx: number, tz: number, clamp?: (x: number, z: number) => [number, number], stop = 0.4): void {
    if (this.busy) { this.speed = 0; return; }
    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    const want = d > stop ? Math.min(8, 1.5 + d * 2.0) : 0;
    this.speed += (want - this.speed) * Math.min(1, dt * (want > this.speed ? 5 : 9));
    if (this.speed > 0.05 && d > 1e-3) {
      const step = Math.min(d, this.speed * dt);
      this.x += (dx / d) * step;
      this.z += (dz / d) * step;
      if (clamp) [this.x, this.z] = clamp(this.x, this.z);
      if (this.speed > 0.4) {
        this.turnToward(Math.atan2(dx, dz), dt, 8);
        this.yawGoal = null;
        this.idleT = 0;
        if (this.sprite && Math.abs(dx) > 0.05) this.flipX = dx > 0 ? -1 : 1;
      }
    }
  }

  private turnToward(target: number, dt: number, rate: number): void {
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * rate);
  }

  update(dt: number): void {
    this.t += dt;
    // nhảy
    if (!this.busy && (this.vy !== 0 || this.y > this.hover)) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= this.hover) { this.y = this.hover; this.vy = 0; this.landSquash = 1; }
    }
    if (this.yawGoal !== null && !this.busy) this.turnToward(this.yawGoal, dt, 3);

    // đứng chơi khi không đi
    const moving = this.speed > 0.3;
    this.walkK += ((moving && this.grounded ? Math.min(1, this.speed / 5) : 0) - this.walkK) * Math.min(1, dt * 8);
    if (!moving && !this.busy && this.idleOn) {
      this.idleT += dt;
      if (this.idleT > this.nextIdle) { this.idleT = 0; this.nextIdle = 3 + Math.random() * 5; this.idle(); }
    }
    if (this.actT > 0) { this.actT -= dt; if (this.actT <= 0) { this.lookGoal = 0; this.tailGoal = 0; } }
    if (this.walker?.look) {
      const L = this.walker.look;
      L.yaw += (this.lookGoal - L.yaw) * Math.min(1, dt * 4);
      L.tail += (this.tailGoal - L.tail) * Math.min(1, dt * 4);
    }

    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.y = this.yaw;
    // bóng luôn nằm trên mặt cỏ, nhỏ lại khi nhảy/bay cao
    this.blob.position.y = -this.y + 0.03;
    this.blob.scale.setScalar(Math.max(0.4, 1 - this.y * 0.18));
    const pose = (this.walker?.update(this.t, this.walkK, this.yaw) as WalkerPose | undefined) ?? null;
    this.animate(dt, pose);
  }

  private idle(): void {
    const acts: IdleAct[] = this.flyer || !this.allowHop ? ['camera', 'look', 'tail'] : ['hop', 'camera', 'look', 'tail', 'hop'];
    if (this.def.id === 'ba-cuong' && this.allowHop) acts.push('loop');
    const a = acts[Math.floor(Math.random() * acts.length)];
    if (a === 'hop') this.hop(4 + Math.random() * 1.5);
    else if (a === 'camera') this.turnTo(0);
    else if (a === 'look') { this.lookGoal = (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.25); this.actT = 1.4; }
    else if (a === 'tail') { this.tailGoal = 1; this.actT = 1.2; }
    else if (a === 'loop') void this.loopAround();
  }

  private animate(dt: number, pose: WalkerPose | null): void {
    const p = this.pivot;
    let bob = 0, pitch = 0, roll = 0, sy = 1, sx = 1;
    const airborne = this.y > this.hover + 0.01;
    if (pose) {
      bob = pose.bob; pitch = pose.pitch; roll = pose.roll;
    } else if (!this.flyer && this.walkK > 0.01) {
      // Spike / mèo: lạch bạch nhún nhảy
      const w = this.t * 12;
      bob = Math.abs(Math.sin(w)) * 0.16 * this.walkK;
      roll = Math.sin(w) * 0.1 * this.walkK;
    }
    if (this.flyer) {
      bob += Math.sin(this.t * 1.8) * 0.12;
      pitch += Math.sin(this.t * 0.9) * 0.03;
    } else if (!airborne && this.walkK < 0.2) {
      sy = 1 + Math.sin(this.t * 2.3) * 0.018;   // thở
    }
    if (airborne && !this.flyer) { pitch -= Math.min(0.25, this.vy * 0.03); sy *= 1.05; sx *= 0.96; }
    if (this.landSquash > 0) {
      this.landSquash = Math.max(0, this.landSquash - dt * 5);
      const k = Math.sin(this.landSquash * Math.PI);
      sy *= 1 - k * 0.15; sx *= 1 + k * 0.1;
    }
    p.position.y = bob;
    p.rotation.x = pitch;
    p.rotation.z = roll;
    p.scale.set(sx, sy, sx);
    if (this.sprite) {
      // mèo emoji luôn nhìn camera: lật theo hướng chạy, nghiêng theo bước
      const base = this.def.height * 1.25;
      this.sprite.scale.set(base * this.flipX, base, 1);
      this.sprite.material.rotation = roll * 0.8;
    }
  }

  /** Nhảy xoay ăn mừng. */
  async celebrate(spin = true): Promise<void> {
    const wasBusy = this.busy;
    this.busy = true;
    const yaw0 = this.yaw, y0 = this.y;
    await tween(750, (k) => {
      this.y = y0 + Math.sin(k * Math.PI) * (this.flyer ? 0.8 : 1.1);
      if (spin) this.yaw = yaw0 + k * Math.PI * 2;
    }, easeOutQuad);
    this.yaw = yaw0; this.y = y0;
    this.busy = wasBusy;
  }

  /** Bay/chạy theo đường cong tới (x, z) trong `ms`. */
  async travel(x: number, z: number, ms: number, arc = 1.2): Promise<void> {
    const wasBusy = this.busy;
    this.busy = true;
    const x0 = this.x, z0 = this.z, y0 = this.y;
    this.yaw = Math.atan2(x - x0, z - z0);
    await tween(ms, (k) => {
      this.x = x0 + (x - x0) * k;
      this.z = z0 + (z - z0) * k;
      this.y = y0 + (this.hover - y0) * k + Math.sin(k * Math.PI) * arc;
    }, easeInOutSine);
    this.y = this.hover;
    this.busy = wasBusy;
  }

  /** Rainbow Dash (ba Cường) — nhanh và mạnh: bay một vòng trên trời kéo theo vệt cầu vồng. */
  async loopAround(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const cx = this.x, cz = this.z, y0 = this.y, yaw0 = this.yaw;
    const R = 2.4;
    let last = 0;
    await tween(1700, (k) => {
      const a = k * Math.PI * 2;
      this.x = cx + Math.sin(a) * R;
      this.z = cz + (1 - Math.cos(a)) * R * 0.6;
      this.y = y0 + Math.sin(k * Math.PI) * 2.6;
      this.yaw = Math.atan2(Math.cos(a), Math.sin(a) * 0.6);
      if (k - last > 0.015) {
        last = k;
        const c = RAINBOW[Math.floor(k * 40) % RAINBOW.length];
        this.world.magic.emit({ x: this.x, y: this.y + 0.9, z: this.z, color: c, vy: -0.2, max: 0.9, size: 0.4 });
      }
    }, easeInOutSine);
    this.x = cx; this.z = cz; this.y = y0; this.yaw = yaw0;
    this.busy = false;
  }

  /** Rời màn: gỡ khỏi scene + trả texture xương (model dùng chung do World.release giải phóng). */
  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => { const sm = o as THREE.SkinnedMesh; if (sm.isSkinnedMesh) sm.skeleton.dispose(); });
    this.blob.geometry.dispose();
    for (const g of this.merged) g.dispose();
    (this.blob.material as THREE.Material).dispose();
  }

  /** Bạn pony "về nhà": nhảy lên, xoay, thu nhỏ trong bụi sao rồi biến mất. */
  async goHome(): Promise<void> {
    this.busy = true;
    const y0 = this.y, yaw0 = this.yaw;
    const c = this.center();
    this.world.magic.burst(c, 60, 0xffe08a, 2.2, 0.3, 0.9, -1);
    await tween(900, (k) => {
      this.y = y0 + Math.sin(k * Math.PI * 0.5) * 1.6;
      this.yaw = yaw0 + k * Math.PI * 3;
      this.root.scale.setScalar(Math.max(0.01, 1 - k * k));
      if (Math.random() < 0.5) this.world.magic.twinkle(this.center(), 0xff7ac8, 1, 0.5);
    }, easeOutQuad);
    this.world.magic.burst(this.center(), 50, 0xc084fc, 2.6, 0.32, 0.9, -1);
    this.dispose();
  }

  /** Điểm giữa người (để bắn phép, gắn hạt). */
  center(): THREE.Vector3 { return new THREE.Vector3(this.x, this.y + this.def.height * 0.55, this.z); }
}

// ------------------------------------------------------------------ hàng người đi theo

/** Vết chân của Twilight: người đi theo bám vào điểm cách sau lưng một khoảng. */
export class Trail {
  private pts: { x: number; z: number }[] = [];

  reset(x: number, z: number, yaw: number): void {
    // xếp sẵn hàng sau lưng
    this.pts = [];
    for (let i = 0; i < 60; i++) this.pts.push({ x: x - Math.sin(yaw) * i * 0.3, z: z - Math.cos(yaw) * i * 0.3 });
  }

  push(x: number, z: number): void {
    const h = this.pts[0];
    if (h && Math.hypot(h.x - x, h.z - z) < 0.3) return;
    this.pts.unshift({ x, z });
    if (this.pts.length > 260) this.pts.pop();
  }

  /** Điểm trên vết cách đầu `dist` mét. */
  at(dist: number): { x: number; z: number } {
    let acc = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      const seg = Math.hypot(a.x - b.x, a.z - b.z);
      if (acc + seg >= dist) {
        const k = (dist - acc) / Math.max(seg, 1e-4);
        return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
      }
      acc += seg;
    }
    return this.pts[this.pts.length - 1] ?? { x: 0, z: 0 };
  }
}
