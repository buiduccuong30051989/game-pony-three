// Quái vật tròn dễ thương: thân cầu + mắt to + chân nhỏ. Bị phép thì tan thành bươm bướm.
import * as THREE from 'three';
import { mergeByMaterial } from './merge';
import type { ChallengeKind } from './data';
import type { World } from './world';
import type { Actor } from './actors';
import { tween, easeOutQuad } from './tween';

/** Bong bóng nhỏ giữ bạn pony đứng cạnh quái (lệch phải-sau so với camera để luôn nhìn thấy khi đi tới). */
const BUBBLE_R = 1.15;

export class Monster {
  readonly group = new THREE.Group();
  defeated = false;
  /** bạn pony bị nhốt trong bong bóng cạnh quái (null nếu không có) */
  friend: Actor | null = null;
  private bubble: THREE.Group | null = null;
  private bubbleMesh: THREE.Mesh | null = null;
  private bubbleBaseY = 0;
  private t = Math.random() * 10;
  private readonly body: THREE.Mesh;

  constructor(private world: World, readonly x: number, readonly z: number, readonly kind: ChallengeKind, color: number) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    this.body = new THREE.Mesh(new THREE.SphereGeometry(0.8, 28, 20), mat);
    this.body.position.y = 0.85;
    this.body.castShadow = true;
    this.group.add(this.body);

    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const black = new THREE.MeshStandardMaterial({ color: 0x2b2330, roughness: 0.6 });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), white);
      eye.position.set(s * 0.3, 1.0, 0.62);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), black);
      pupil.position.set(s * 0.3, 1.0, 0.82);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), white);
      glint.position.set(s * 0.3 + 0.04, 1.05, 0.9);
      this.group.add(eye, pupil, glint);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), mat);
      foot.position.set(s * 0.35, 0.12, 0.15);
      foot.scale.y = 0.6;
      foot.castShadow = true;
      this.group.add(foot);
    }
    // má hồng + miệng cười
    const blush = new THREE.MeshStandardMaterial({ color: 0xff9ec4, roughness: 1 });
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), blush);
      b.position.set(s * 0.5, 0.78, 0.66);
      this.group.add(b);
    }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 8, 16, Math.PI), black);
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, 0.72, 0.78);
    this.group.add(mouth);
    // sừng nhỏ để biết là "quái"
    const hornMat = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 1 });
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 8), hornMat);
      h.position.set(s * 0.4, 1.62, 0);
      h.rotation.z = -s * 0.4;
      this.group.add(h);
    }

    // iPad: gộp mặt / chân / sừng theo vật liệu (16 → 6 draw call), thân giữ riêng vì nhún
    mergeByMaterial(this.group, new Set([this.body]));
    this.group.position.set(x, 0, z);
    world.scene.add(this.group);
  }

  get center(): THREE.Vector3 { return new THREE.Vector3(this.x, 0.9, this.z); }

  /** Quay mặt về phía nhân vật. */
  faceTo(x: number, z: number): void { this.group.rotation.y = Math.atan2(x - this.x, z - this.z); }

  /**
   * Nhốt `actor` vào bong bóng pha lê nhỏ cạnh quái. `place(x, z)` kéo chỗ đặt vào trong đảo.
   * Bạn pony đứng ở đáy bong bóng, quay ra phía Nhím đi tới, không tự nhảy.
   */
  holdFriend(actor: Actor, fromX: number, fromZ: number, clamp: (x: number, z: number) => [number, number]): void {
    const { group, mesh, holder } = this.world.makeBubble(BUBBLE_R);
    // lệch sang phải-sau (hướng camera nhìn từ +z) để quái không che bong bóng
    const [bx, bz] = clamp(this.x + 2.0, this.z - 1.1);
    this.bubbleBaseY = BUBBLE_R + 0.25;
    group.position.set(bx, this.bubbleBaseY, bz);
    this.world.scene.add(group);
    actor.allowHop = false;
    actor.hover = 0;
    actor.place(0, 0, Math.atan2(fromX - bx, fromZ - bz));
    holder.add(actor.root);
    this.friend = actor;
    this.bubble = group;
    this.bubbleMesh = mesh;
  }

  /** Vị trí thế giới của bong bóng (null nếu đã vỡ / không có). */
  get bubblePos(): THREE.Vector3 | null { return this.bubble ? this.bubble.position.clone() : null; }

  /**
   * Bong bóng rung rồi vỡ tung lấp lánh; bạn pony rơi xuống cỏ (đã ra scene, toạ độ thế giới) và nhảy cẫng.
   * Trả về Actor đã tự do (null nếu quái không giữ ai).
   */
  async popBubble(): Promise<Actor | null> {
    const b = this.bubble, mesh = this.bubbleMesh, a = this.friend;
    if (!b || !mesh || !a) return null;
    await tween(380, (k) => { mesh.scale.setScalar(1 + Math.sin(k * Math.PI * 6) * 0.1 * (1 + k)); });
    const c = b.position.clone();
    this.world.magic.burst(c, 110, 0xffffff, 3.0, 0.32, 1.0, -1.5);
    this.world.magic.burst(c, 60, 0xff7ac8, 2.2, 0.28, 0.9, -1.5);
    this.world.magic.ring(new THREE.Vector3(c.x, 0.1, c.z), 0xffd166, 50, 1.8);
    const wp = a.root.getWorldPosition(new THREE.Vector3());
    this.world.scene.add(a.root);
    a.root.scale.setScalar(1);
    a.allowHop = true;
    a.place(wp.x, wp.z, a.yaw);
    a.y = wp.y;
    a.vy = 3.5;
    this.disposeBubble();
    return a;
  }

  private disposeBubble(): void {
    if (!this.bubble) return;
    this.bubble.removeFromParent();
    this.bubbleMesh?.geometry.dispose();
    this.bubble = null;
    this.bubbleMesh = null;
  }

  /** Rời màn: gỡ quái + bong bóng (bạn pony còn trong bong bóng do main dispose). */
  dispose(): void {
    this.group.removeFromParent();
    this.disposeBubble();
  }

  update(dt: number): void {
    if (this.bubble) {
      this.bubble.position.y = this.bubbleBaseY + Math.sin((this.t + dt) * 1.7) * 0.14;
      this.friend?.update(dt);
    }
    if (this.defeated) return;
    this.t += dt;
    const s = Math.sin(this.t * 3);
    this.body.scale.set(1 + s * 0.04, 1 - s * 0.05, 1 + s * 0.04);
    this.group.position.y = Math.max(0, Math.sin(this.t * 3) * 0.05);
  }

  /** Nhún cười khi bé trả lời sai (không phạt). */
  async giggle(): Promise<void> {
    await tween(500, (k) => { this.group.rotation.z = Math.sin(k * Math.PI * 4) * 0.12 * (1 - k); });
    this.group.rotation.z = 0;
  }

  /** Tan thành bươm bướm bay lên. */
  async defeat(): Promise<void> {
    this.defeated = true;
    const c = this.center;
    this.world.magic.burst(c, 120, 0xc084fc, 3.2, 0.36, 1.0);
    this.world.magic.burst(c, 60, 0xffe08a, 2.2, 0.28, 0.9);
    await tween(450, (k) => {
      this.group.scale.setScalar(1 - k * 0.9);
      this.group.rotation.y += 0.25;
    }, easeOutQuad);
    this.world.scene.remove(this.group);
    const flies: THREE.Sprite[] = [];
    for (let i = 0; i < 9; i++) {
      const sp = this.world.emojiSprite(i % 3 === 0 ? '🌸' : '🦋', 0.55);
      sp.position.copy(c).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 0.8, (Math.random() - 0.5) * 0.6));
      sp.userData.phase = Math.random() * 6;
      this.world.scene.add(sp);
      flies.push(sp);
    }
    await tween(2200, (k) => {
      for (const f of flies) {
        f.position.y += 0.012 + Math.sin(k * 20 + f.userData.phase) * 0.004;
        f.position.x += Math.sin(k * 6 + f.userData.phase) * 0.012;
        f.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      }
    });
    for (const f of flies) this.world.scene.remove(f);
  }
}
