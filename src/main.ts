// Điều phối: bản đồ → đảo → chạm đất để đi / nhảy / bay 🪽 / nhặt ngọc → quái → thử thách → phép → bong bóng → cứu người nhà.
// Người nhà đã cứu (hoá pony) đi theo Twilight ở các màn sau; màn 7 đấu Nightmare Moon (src/battle.ts).
// Debug URL: xem README (?level=, &auto=1, &mute=1, &stars=3, &rescue=1, &battle=N, &win=1, &end=1, &unlock=all, &done=all).
import * as THREE from 'three';
import {
  LEVELS, WORDS, PALETTE, CAST, HARMONY, SPIKE_HINTS, FRIEND_IDS, MAX_PARADE, type LevelDef, type CastId, type FriendId,
} from './data';
import { World, type LevelHandles } from './world';
import { Hero } from './hero';
import { Monster } from './monster';
import { Challenge, testHook } from './challenge';
import { Actor, Trail } from './actors';
import { FinalBattle } from './battle';
import { unlockAudio, preload, play, sfx, stopSpeech } from './audio';
import { say, cheer, clearFamily } from './family';
import {
  els, showControls, showHud, setHudMode, setStars, setGems, toast, confetti, renderMap, hideMap, showPanel, showEnding,
  renderFriendsHome, type MapNode,
} from './ui';
import { tween, wait, easeOutBack } from './tween';

const Q = new URLSearchParams(location.search);
const DEBUG = {
  level: Q.get('level'),
  auto: Q.has('auto'),
  stars: Number(Q.get('stars') ?? 0),
  rescue: Q.has('rescue'),
  battle: Math.min(5, Math.max(0, Number(Q.get('battle') ?? 0))),
  win: Q.has('win'),
  end: Q.has('end'),
  unlock: Q.get('unlock') === 'all',
  done: Q.get('done'),
  /** bạn pony đã cứu: all | none | số N (N bạn đầu) | id,id… — không có thì suy từ &done (bạn của các màn đã xong) */
  friends: Q.get('friends'),
};
const IS_DEBUG = [...Q.keys()].length > 0;

const FAMILY_KEYS = Object.values(CAST).flatMap((c) => [...c.lines.map(([k]) => k), ...(c.ball ? [c.ball[0]] : [])]);
const AUDIO_KEYS = [
  'intro_story', 'hint_move', 'monster', 'ask_count', 'ask_pick_number', 'right', 'magic', 'retry', 'hint_last',
  'star', 'stars3', 'bubble', 'bigspell', 'meow', 'level_done', 'sun_rise',
  'final_challenge', 'final_next', 'rainbow_blast', 'luna_back', 'luna_thanks', 'fam_all', 'the_end',
  'help_me', 'help_ba', 'help_ong', 'help_ba_tuyet', 'spike_hint_bubble',
  'sfx_tap', 'sfx_pop', 'sfx_win', 'sfx_soft',
  ...['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10'],
  ...LEVELS.flatMap((l) => [l.introAudio, l.rescueAudio]),
  ...WORDS.flatMap((w) => [`ask_${w.id}`, `name_${w.id}`, ...w.tokens.map((t) => t.audio)]),
  ...FAMILY_KEYS, ...SPIKE_HINTS, ...HARMONY.map((h) => h.audio),
  ...FRIEND_IDS.map((f) => CAST[f].thanks![0]), 'friend_home', 'friends_gallery',
  ...[0, 1, 2, 3, 4].map((i) => `nmm_taunt_${i}`), 'nmm_laugh_1', 'nmm_laugh_2',
];

/** Lời cảm ơn khi được cứu (thẻ của người đó). */
const THANKS: Partial<Record<CastId, string>> = {
  mun: 'Meo meo! Cảm ơn Nhím!',
  rom: 'Meo meo! Cảm ơn Nhím!',
  'me-yen': 'Mẹ ôm Nhím thật chặt!',
  'ba-cuong': 'Ba bay nhanh như gió tới ôm Nhím!',
  'ong-cuong': 'Cảm ơn cháu yêu của ông!',
  'ba-tuyet': 'Bà kéo mặt trời lên cho Nhím nhé!',
};
/** Người trong bong bóng gọi Nhím lúc vào màn. */
const HELP: Partial<Record<CastId, [string, string]>> = {
  'me-yen': ['help_me', 'Nhím ơi, mẹ ở trong bong bóng nè!'],
  'ba-cuong': ['help_ba', 'Nhím ơi, ba ở đây nè!'],
  'ong-cuong': ['help_ong', 'Nhím ơi, ông ở vườn táo nè!'],
  'ba-tuyet': ['help_ba_tuyet', 'Nhím ơi, bà ở đồi pha lê nè!'],
};
const SPIKE_TEXT: Record<string, string> = {
  spike_hint_1: 'Đi theo đường sao lấp lánh nhé!',
  spike_hint_2: 'Bấm mũi tên để đi nào Nhím!',
  spike_hint_3: 'Quái vật ở đằng kia kìa!',
  spike_hint_bubble: 'Bong bóng ở đằng kia, đi tới đó nhé!',
};

/**
 * Bạn G5 / Equestria Girls rip nhiều mảnh trong suốt (10–15 draw call mỗi bạn): chỉ xuất hiện ở màn của mình (trong bong
 * bóng → được cứu → đi theo tới hết màn) + bộ sưu tập + màn kết, không đi hàng ở màn khác / đứng ở trận cuối (iPad).
 */
const HEAVY_FRIENDS: FriendId[] = ['sunny', 'sunset', 'starlight', 'pipp', 'zipp'];
/** Tổng draw call tối đa của các bạn pony đang đi trong hàng (ngoài người nhà). */
const PARADE_FRIEND_CALLS = 24;

interface Progress { unlocked: number; done: string[]; /** bạn pony đã cứu (theo thứ tự cứu) */ friends: FriendId[] }
function loadProgress(): Progress {
  try {
    const p = JSON.parse(localStorage.getItem('haan-progress') || '');
    if (p && typeof p.unlocked === 'number') {
      const friends = Array.isArray(p.friends) ? p.friends.filter((f: string) => (FRIEND_IDS as string[]).includes(f)) : [];
      return { unlocked: p.unlocked, done: Array.isArray(p.done) ? p.done : [], friends };
    }
  } catch { /* trống */ }
  return { unlocked: 1, done: [], friends: [] };
}
function saveProgress(p: Progress): void {
  if (IS_DEBUG) return; // chơi thử bằng URL debug không ghi đè tiến độ thật của bé
  try { localStorage.setItem('haan-progress', JSON.stringify(p)); } catch { /* bỏ qua */ }
}

type Phase = 'start' | 'map' | 'loading' | 'play' | 'battle' | 'end';

async function boot(): Promise<void> {
  const world = new World(document.getElementById('app')!);
  const progress = loadProgress();
  if (DEBUG.unlock) progress.unlocked = LEVELS.length;
  if (DEBUG.done) progress.done = DEBUG.done === 'all' ? LEVELS.map((l) => l.id) : DEBUG.done.split(',');
  if (DEBUG.friends !== null) {
    const f = DEBUG.friends;
    progress.friends = f === 'all' ? [...FRIEND_IDS] : f === 'none' ? []
      : /^\d+$/.test(f) ? FRIEND_IDS.slice(0, Number(f))
        : f.split(',').filter((x): x is FriendId => (FRIEND_IDS as string[]).includes(x));
  } else if (DEBUG.done) {
    progress.friends = LEVELS.filter((l) => progress.done.includes(l.id)).flatMap((l) => l.friends);
  }

  let phase: Phase = 'start';
  let hero: Hero | null = null;
  let level: LevelDef | null = null;
  let handles: LevelHandles | null = null;
  let monsters: Monster[] = [];
  let followers: Actor[] = [];
  /** bạn pony vừa ra khỏi bong bóng, đang cảm ơn (chưa vào hàng) */
  let loose: Actor[] = [];
  /** model bạn pony đã tải cho màn này → giải phóng khi rời màn */
  let friendModels = new Set<string>();
  /** đang thử thách: hàng đi theo túm lại sau lưng Nhím, tránh xa chỗ này (quái / bong bóng) */
  let huddleAt: { x: number; z: number } | null = null;
  let toldHome = false;
  let rescueActor: Actor | null = null;
  let battle: FinalBattle | null = null;
  const trail = new Trail();
  let stars = 0, gems = 0, t = 0;
  let inChallenge = false, rescued = false;
  let hornSparkle = 0, guideTimer = 0, hintT = 0, hintIdx = 0;
  let token = 0; // đổi màn → các kịch bản async cũ tự dừng
  let fpsT = 0, fpsN = 0, fps = 0;
  /** lần cuối hero bị khoá (để watchdog nhả khoá kẹt) */
  let lockedSince = 0;

  const ready = Promise.all([world.load('models/twilight_static/scene.gltf'), world.load('models/tree_default.glb')]);
  world.start((dt) => {
    t += dt;
    fpsT += dt; fpsN++;
    if (fpsT >= 1) { fps = fpsN / fpsT; fpsT = 0; fpsN = 0; }
    if (hero) {
      hero.update(dt, (x, z) => world.clampToIsland(x, z));
      // bay: vệt lấp lánh sau lưng + trạng thái nút 🪽
      if (hero.flying || (hero.airborne && hero.wings.visible)) {
        for (let i = 0; i < 2; i++) {
          world.magic.emit({ x: hero.x + (Math.random() - 0.5) * 0.6, y: hero.y + 0.9 + Math.random() * 0.6, z: hero.z + (Math.random() - 0.5) * 0.6,
            color: [0xff7ac8, 0xffd166, 0x7fd8ff, 0xc084fc][Math.floor(Math.random() * 4)], vy: -0.3, max: 0.9, size: 0.28 });
        }
      }
      els.flyBtn.classList.toggle('on', hero.flying);
      els.flyBtn.classList.toggle('cool', !hero.flying && !hero.canFly);
      world.follow(dt, hero.x, hero.z, t);
      tick(dt);
    } else {
      world.follow(dt, 0, 0, t);
    }
  });

  await ready;
  // iPad: mọi lần chạm đều thử mở / resume âm thanh (iOS có trạng thái 'interrupted' sau khoá màn hình, cuộc gọi...)
  document.addEventListener('touchend', () => unlockAudio(), { passive: true, capture: true });
  document.addEventListener('click', () => unlockAudio(), { capture: true });
  // Safari iPad: chặn zoom chụm 2 ngón / chạm đúp (touch-action: none đã chặn phần lớn, đây là lưới an toàn)
  for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  els.startBtn.classList.add('ready');
  const begin = async () => {
    unlockAudio();
    els.start.classList.add('hide');
    setTimeout(() => (els.start.hidden = true), 500);
    await preload(AUDIO_KEYS);
    if (DEBUG.end) { openEnding(); return; }
    const dl = DEBUG.level;
    const def = dl ? (LEVELS.find((l) => l.id === dl) ?? LEVELS[Number(dl) - 1]) : undefined;
    if (def) void startLevel(def.id); else openMap();
  };
  if (DEBUG.auto) void begin();
  else els.startBtn.addEventListener('click', () => void begin(), { once: true });

  // ---------- bản đồ ----------
  function mapNodes(): MapNode[] {
    return LEVELS.map((l, i) => {
      const c = CAST[l.rescue];
      const done = progress.done.includes(l.id);
      const isCat = c.kind === 'cat';
      return {
        id: l.id,
        label: l.final ? (done ? 'Bác Hanh' : 'Nightmare Moon') : c.name,
        sub: l.final ? (done ? 'Công chúa Luna' : 'trận cuối') : isCat ? undefined : c.pony,
        speaker: l.final ? (done ? 'bac-hanh' : 'nightmare') : isCat ? null : c.id,
        emoji: c.emoji,
        color: l.final ? '#4b3b9a' : c.color,
        enabled: i < progress.unlocked,
        done,
        final: l.final,
      };
    });
  }

  function openMap(): void {
    phase = 'map';
    showControls(false);
    showHud(false);
    renderMap(mapNodes(), (id) => void startLevel(id));
    renderFriendsHome(FRIEND_IDS, progress.friends, () => void play('friends_gallery'));
  }

  function openEnding(): void {
    phase = 'end';
    showControls(false);
    showHud(false);
    void play('the_end');
    showEnding(['twilight', 'bac-hanh', 'ba-tuyet', 'ong-cuong', 'ba-cuong', 'me-yen', 'mun', 'rom', 'spike'], () => openMap(), progress.friends);
  }

  /** Người nhà đã cứu ở các màn TRƯỚC màn đang chơi (theo thứ tự cứu). */
  function rescuedBefore(def: LevelDef): CastId[] {
    return LEVELS.filter((l) => l.id !== def.id && progress.done.includes(l.id)).map((l) => l.rescue);
  }

  function cleanup(): void {
    token++;
    stopSpeech();
    clearFamily();
    showPanel(false);
    inChallenge = false;
    if (hero) world.scene.remove(hero.root);
    for (const m of monsters) { m.friend?.dispose(); m.dispose(); }
    for (const a of followers) a.dispose();
    for (const a of loose) a.dispose();
    rescueActor?.root.removeFromParent();
    battle?.dispose();
    // bạn pony: trả bộ nhớ model (màn sau cần thì tải lại) — người nhà giữ cache vì màn nào cũng có
    for (const m of friendModels) void world.release(m);
    friendModels = new Set();
    hero = null; monsters = []; followers = []; loose = []; rescueActor = null; battle = null; handles = null;
    huddleAt = null; toldHome = false;
  }

  /** Thêm bạn vào danh sách đã cứu (không lặp) + lưu. */
  function markRescued(id: FriendId): void {
    if (!progress.friends.includes(id)) progress.friends.push(id);
    saveProgress(progress);
  }

  /**
   * Tạo Actor bạn pony (ghi lại model để giải phóng khi rời màn).
   * `lod`: bản giảm lưới models/friends/lod/<tên>.glb (~5–25k tam giác) cho đám đông trận cuối (18 bạn cùng lúc).
   */
  function friendActor(id: FriendId, lod = false): Promise<Actor> {
    const full = CAST[id].model!;
    const model = lod ? `models/friends/lod/${full.split('/').pop()}` : full;
    friendModels.add(model);
    return Actor.fromDef(world, { ...CAST[id], model });
  }

  /**
   * Bạn đứng cổ vũ ở trận cuối (iPad: ≤ 150 draw call / khung, như game 5 giới hạn đám đông): tối đa 10 bạn đã cứu, mới
   * nhất trước; bỏ 5 bạn G5 / Equestria Girls rip nhiều mảnh trong suốt (10–15 draw call mỗi bạn). Bộ sưu tập + màn kết
   * vẫn đủ mọi bạn đã cứu.
   */
  function finaleFriends(): FriendId[] {
    return progress.friends.filter((f) => !HEAVY_FRIENDS.includes(f)).slice(-10);
  }

  /** Số draw call 1 người trong hàng (số lưới đang hiện). */
  function drawCost(a: Actor): number {
    let n = 0;
    a.root.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) n++; });
    return n;
  }

  /** Bạn đi trong hàng ở màn `def`: bạn đã cứu ở màn khác, mới nhất trước, vừa đủ chỗ trống sau người nhà. */
  function paradeFriends(def: LevelDef, familyCount: number): FriendId[] {
    const slots = Math.max(0, MAX_PARADE - familyCount);
    if (!slots) return [];
    return progress.friends.filter((f) => !def.friends.includes(f) && !HEAVY_FRIENDS.includes(f)).slice(-slots);
  }

  // ---------- vào màn ----------
  async function startLevel(id: string): Promise<void> {
    const def = LEVELS.find((l) => l.id === id)!;
    hideMap();
    cleanup();
    const my = token;
    phase = 'loading';
    level = def; stars = 0; gems = 0; rescued = false; hintT = -6; // lời dẫn đầu màn đọc xong mới tính 10 s
    setStars(0); setGems(0);
    const rc = CAST[def.rescue];
    const bubbleScale = rc.kind === 'cat' ? 1 : rc.kind === 'flyer' ? 1.75 : 1.4;
    const before = rescuedBefore(def);
    // đi theo: Spike + mèo + pony đã cứu; màn cuối thêm Pinkie, Fluttershy
    // đi theo: Spike + mèo + người nhà đã cứu (đứng đầu hàng), rồi bạn pony đã cứu ở màn trước (tối đa MAX_PARADE)
    // trận cuối: cả nhà + TẤT CẢ bạn pony đã cứu đứng cổ vũ
    const crowdIds: CastId[] = def.final
      ? ['spike', ...before.filter((x) => x !== 'bac-hanh')]
      : ['spike', ...before.filter((x) => CAST[x].kind === 'cat'), ...before.filter((x) => CAST[x].kind !== 'cat')];
    const paradeIds: FriendId[] = def.final ? finaleFriends() : paradeFriends(def, crowdIds.length);
    const [h, hnd, crowd, paradeFr, held, inBubble] = await Promise.all([
      Hero.load(world, def.hero),
      world.buildLevel(def, bubbleScale, rc.kind === 'cat' ? rc.emoji : undefined),
      Promise.all(crowdIds.map((c) => Actor.create(world, c))),
      // bạn đi trong hàng / đứng cổ vũ: bản lod/ (camera xa, iPad nhẹ); bạn trong bong bóng: bản đủ
      Promise.all(paradeIds.map((f) => friendActor(f, true))),
      Promise.all(def.friends.map((f) => friendActor(f))),
      !def.final && rc.kind !== 'cat' ? Actor.create(world, def.rescue) : Promise.resolve(null),
    ]);
    if (my !== token) {
      world.scene.remove(h.root);
      for (const a of [...crowd, ...paradeFr, ...held]) a.dispose();
      return;
    }
    handles = hnd;
    hero = h;
    hero.x = def.start[0]; hero.z = def.start[1];

    if (inBubble) {
      // người nhà đứng trong bong bóng, quay ra phía Nhím đi tới
      rescueActor = inBubble;
      inBubble.allowHop = false;
      inBubble.hover = 0;
      inBubble.place(0, 0, Math.atan2(def.start[0] - def.bubble[0], def.start[1] - def.bubble[1]));
      handles.holder.add(inBubble.root);
    }

    if (def.final) {
      phase = 'battle';
      showControls(false);
      showHud(true);
      els.home.hidden = true;
      setHudMode('harmony', HARMONY.map((x) => '#' + x.color.toString(16).padStart(6, '0')));
      battle = new FinalBattle(world, hero, def, crowd, paradeFr, handles.group);
      followers = [...crowd, ...paradeFr]; // để cleanup() dọn
      await battle.setup();
      if (my !== token) return;
      try {
        await battle.run({ startGems: DEBUG.battle, skipToWin: DEBUG.win }, () => sfx('sfx_soft', 0.4));
      } catch (e) {
        console.error('[battle]', e); // lỗi giữa trận: vẫn sang màn kết, không kẹt
      }
      if (my !== token) return;
      if (!progress.done.includes(def.id)) progress.done.push(def.id);
      saveProgress(progress);
      await play('the_end');
      if (my !== token) return;
      openEnding();
      return;
    }

    monsters = def.monsters.map((m) => new Monster(world, m.x, m.z, m.kind, m.color));
    // mỗi quái giữ 1 bạn pony trong bong bóng nhỏ ngay cạnh
    monsters.forEach((m, i) => { if (held[i]) m.holdFriend(held[i], def.start[0], def.start[1], (x, z) => world.clampToIsland(x, z)); });
    hero.faceTo(def.monsters[0].x, def.monsters[0].z);
    followers = [...crowd, ...paradeFr];
    trail.reset(hero.x, hero.z, hero.yaw);
    let dist = 0;
    for (const a of followers) {
      dist += gapOf(a);
      const p = trail.at(dist);
      a.place(p.x, p.z, hero.yaw);
      world.scene.add(a.root);
    }
    setHudMode('stars');
    showControls(true);
    showHud(true);
    phase = 'play';

    if (DEBUG.stars >= 3 || DEBUG.rescue) {
      for (const m of monsters) { m.defeated = true; m.friend?.dispose(); m.dispose(); }
      stars = 3; setStars(3);
    }
    if (DEBUG.rescue) {
      hero.x = def.bubble[0] - 1.6 - handles.bubbleR; hero.z = def.bubble[1] + 0.5;
      hero.faceTo(def.bubble[0], def.bubble[1]);
      trail.reset(hero.x, hero.z, hero.yaw);
      let d2 = 0;
      for (const a of followers) { d2 += gapOf(a); const p = trail.at(d2); a.place(p.x, p.z, hero.yaw); }
      return; // tick() tự kích hoạt cứu khi đứng cạnh bong bóng
    }
    if (def.id === LEVELS[0].id && !progress.done.includes(def.id)) await play('intro_story');
    if (my !== token) return;
    await play(def.introAudio);
    if (my !== token) return;
    const help = HELP[def.rescue];
    if (help) await say(def.rescue, help[0], help[1]);
    if (my !== token) return;
    if (LEVELS.indexOf(def) < 2) await play('hint_move');
  }

  /** Khoảng cách tới người đứng trước trong hàng (~1.1 cho bạn nhỏ, rộng hơn chút cho pony to). */
  function gapOf(a: Actor): number {
    if (a.def.kind === 'cat') return 1.1;
    if (a.def.kind === 'dragon') return 1.2;
    if (a.def.kind === 'flyer') return 2.0;
    return Math.max(1.1, a.def.height * 0.85);
  }
  /** Bán kính "thân" để hàng không chen lấn nhau. */
  function radiusOf(a: Actor): number {
    return a.def.kind === 'cat' ? 0.4 : a.def.kind === 'flyer' ? 0.9 : Math.max(0.42, a.def.height * 0.36);
  }

  /** Chỗ túm tụm sau lưng Nhím (tránh xa `from`): hàng 3, so le. */
  function huddleSpot(i: number, from: { x: number; z: number }): { x: number; z: number } {
    if (!hero) return { x: 0, z: 0 };
    let bx = hero.x - from.x, bz = hero.z - from.z;
    const bl = Math.hypot(bx, bz) || 1;
    bx /= bl; bz /= bl;
    const lx = -bz, lz = bx;
    const row = Math.floor(i / 3), col = (i % 3) - 1;
    const back = 1.8 + row * 1.25, side = col * 1.3 + (row % 2) * 0.65;
    const [x, z] = world.clampToIsland(hero.x + bx * back + lx * side, hero.z + bz * back + lz * side);
    return { x, z };
  }

  /** Đẩy nhẹ những người đứng quá sát nhau / sát Nhím / sát quái + bong bóng (không chồng hình). */
  function separate(list: Actor[]): void {
    if (!hero) return;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.busy) continue;
      const ra = radiusOf(a);
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const min = ra + radiusOf(b);
        let dx = b.x - a.x, dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        if (d >= min) continue;
        if (d < 1e-4) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; d = Math.hypot(dx, dz); }
        const push = (min - d) * 0.5 / d;
        if (!b.busy) { b.x += dx * push; b.z += dz * push; }
        a.x -= dx * push; a.z -= dz * push;
      }
      const away = (x: number, z: number, min: number) => {
        const dx = a.x - x, dz = a.z - z, d = Math.hypot(dx, dz);
        if (d < min && d > 1e-4) { a.x = x + (dx / d) * min; a.z = z + (dz / d) * min; }
      };
      away(hero.x, hero.z, ra + 0.75);
      for (const m of monsters) {
        if (!m.defeated) away(m.x, m.z, ra + 1.0);
        const bp = m.bubblePos;
        if (bp) away(bp.x, bp.z, ra + 1.2);
      }
      [a.x, a.z] = world.clampToIsland(a.x, a.z);
    }
  }

  /** Mục tiêu hiện tại: quái gần nhất chưa bị phép, hoặc bong bóng khi đủ sao. */
  function currentTarget(): THREE.Vector3 | null {
    if (!hero || !handles) return null;
    if (stars >= 3) return handles.bubble.position.clone().setY(0.5);
    let best: Monster | null = null, bd = Infinity;
    for (const m of monsters) {
      if (m.defeated) continue;
      const d = Math.hypot(m.x - hero.x, m.z - hero.z);
      if (d < bd) { bd = d; best = m; }
    }
    return best ? new THREE.Vector3(best.x, 0.5, best.z) : null;
  }

  /** Ai khen khi đúng mà quái không giữ bạn nào: người nhà + Spike + bạn đang đi trong hàng. */
  function cheerPool(): CastId[] {
    if (!level) return ['spike'];
    const fam = rescuedBefore(level).filter((x) => x !== 'bac-hanh');
    const fr = followers.filter((a) => a.def.friend).map((a) => a.id);
    return ['spike', ...fam, ...fr];
  }

  // ---------- vòng lặp màn ----------
  function tick(dt: number): void {
    if (!hero || !level || !handles) return;
    if (battle) { battle.update(dt); return; }
    for (const m of monsters) m.update(dt);

    // hàng người đi theo vết chân Nhím (rắn), lúc thử thách thì túm tụm sau lưng
    trail.push(hero.x, hero.z);
    let dist = 0;
    const clamp = (x: number, z: number) => world.clampToIsland(x, z);
    followers.forEach((a, i) => {
      dist += gapOf(a);
      const p = huddleAt ? huddleSpot(i, huddleAt) : trail.at(dist);
      a.follow(dt, p.x, p.z, clamp, huddleAt ? 0.25 : 0.4);
      if (huddleAt && !a.busy && a.grounded && Math.hypot(p.x - a.x, p.z - a.z) < 0.5) a.turnTo(Math.atan2(huddleAt.x - a.x, huddleAt.z - a.z));
    });
    separate(followers);
    for (const a of followers) a.update(dt);
    for (const a of loose) a.update(dt);
    rescueActor?.update(dt);

    hornSparkle += dt;
    if (hornSparkle > 0.12) { hornSparkle = 0; world.magic.twinkle(hero.hornWorld(), PALETTE.magicPink, 1, 0.3); }

    // đường sao dẫn lối tới mục tiêu (khi không trong thử thách)
    guideTimer += dt;
    if (guideTimer > 0.35 && !inChallenge) {
      guideTimer = 0;
      const tg = currentTarget();
      if (tg) {
        const from = new THREE.Vector3(hero.x, 0.5, hero.z);
        const d = from.distanceTo(tg);
        if (d > 4) {
          const dir = tg.clone().sub(from).normalize();
          for (let i = 0; i < 4; i++) {
            const p = from.clone().add(dir.clone().multiplyScalar(2.5 + i * 1.4));
            world.magic.emit({ x: p.x, y: 0.4 + Math.random() * 0.4, z: p.z, color: PALETTE.star, vy: 0.6, max: 0.9, size: 0.26 });
          }
        }
      }
    }

    // nhặt ngọc
    for (const g of handles.gems) {
      if (!g.taken && Math.hypot(g.x - hero.x, g.z - hero.z) < 1.2 && hero.y < 2.8) {
        g.taken = true;
        g.mesh.visible = false;
        gems++; setGems(gems);
        sfx('sfx_pop', 0.5);
        world.magic.burst(g.mesh.position, 26, 0x7fd8ff, 1.8, 0.24, 0.6, -1);
      }
    }

    // Spike nhắc khi bé đứng yên 10 giây
    if (phase === 'play' && !inChallenge && !rescued && !hero.moving) {
      hintT += dt;
      if (hintT > 10) { hintT = -8; void spikeHint(); }
    } else if (hero.moving) hintT = 0;

    // đang bay tới chỗ quái / bong bóng → tự hạ cánh rồi mới bắt đầu (bài vẫn phải làm)
    if (hero.flying && !inChallenge) {
      const nearM = monsters.some((m) => !m.defeated && Math.hypot(m.x - hero!.x, m.z - hero!.z) < 3.4);
      const nearB = stars >= 3 && !rescued && Math.hypot(handles.bubble.position.x - hero.x, handles.bubble.position.z - hero.z) < 4 + handles.bubbleR - 1.5;
      if (nearM || nearB) { hero.land(); hero.stop(); }
    }

    // gặp quái
    if (!inChallenge && hero.grounded) {
      const hx = hero.x, hz = hero.z;
      const near = monsters.find((m) => !m.defeated && Math.hypot(m.x - hx, m.z - hz) < 2.8);
      if (near) void challengeAt(near);
    }

    // bong bóng cuối màn
    if (stars >= 3 && !rescued && !inChallenge && hero.grounded
      && Math.hypot(handles.bubble.position.x - hero.x, handles.bubble.position.z - hero.z) < 3.4 + handles.bubbleR - 1.5) {
      void rescue();
    }
  }

  async function spikeHint(): Promise<void> {
    const spike = followers.find((a) => a.id === 'spike');
    if (spike) { spike.turnTo(0); spike.hop(5); }
    const key = stars >= 3 ? 'spike_hint_bubble' : SPIKE_HINTS[hintIdx++ % SPIKE_HINTS.length];
    await say('spike', key, SPIKE_TEXT[key]);
  }

  async function challengeAt(m: Monster): Promise<void> {
    if (!hero || !level) return;
    const my = token;
    const h = hero;
    inChallenge = true;
    huddleAt = { x: m.x, z: m.z };
    h.locked = true; h.stop();
    showControls(false);
    try {
      await challengeBody(m, my);
    } catch (e) {
      console.error('[challenge]', e);
    } finally {
      // LUÔN nhả khoá (kể cả khi lỗi): không bao giờ để bé kẹt không đi được
      if (my === token) {
        huddleAt = null;
        h.locked = false;
        inChallenge = false;
        hintT = 0;
        showPanel(false);
        if (phase === 'play') showControls(true);
      }
    }
  }

  async function challengeBody(m: Monster, my: number): Promise<void> {
    if (!hero || !level) return;
    hero.faceTo(m.x, m.z);
    m.faceTo(hero.x, hero.z);
    stopSpeech();
    const ch = new Challenge(level, { onWrong: () => void m.giggle() });
    await ch.run(m.kind);
    if (my !== token) return;
    await play('magic');
    world.magic.ring(new THREE.Vector3(hero.x, 0.1, hero.z), PALETTE.magic, 70, 2.5);
    void hero.castPose(900);
    await world.magic.beam(hero.hornWorld(), m.center, PALETTE.magic, PALETTE.magicPink, 0.9);
    void m.defeat();
    // quái tan thành bướm + bong bóng bên cạnh vỡ → bạn pony nhảy ra
    const freed = m.popBubble();
    stars++; setStars(stars);
    toast('⭐ +1');
    confetti(30);
    followers.forEach((a, i) => setTimeout(() => a.hop(4.5 + Math.random()), 80 * i));
    const fr = await freed;
    if (fr) { m.friend = null; loose.push(fr); }
    await play(stars >= 3 ? 'stars3' : 'star');
    if (my !== token) return;
    if (fr) await friendJoins(fr, my);
    else await cheer(cheerPool());
    if (my !== token) return;
    huddleAt = null;
    if (stars >= 3) await hero.celebrate();
  }

  /** Bạn pony vừa được cứu: lấp lánh, quay sang Nhím cảm ơn, rồi chạy vào cuối hàng (đầy hàng thì bạn cũ nhất về nhà). */
  async function friendJoins(fr: Actor, my: number): Promise<void> {
    if (!hero) return;
    const id = fr.id as FriendId;
    markRescued(id);
    await wait(450);
    if (my !== token || !hero) return;
    fr.faceTo(hero.x, hero.z);
    world.magic.burst(fr.center(), 50, 0xffe08a, 2.0, 0.28, 0.8, -1);
    fr.hop(6);
    const sparkle = setInterval(() => world.magic.twinkle(fr.center(), 0xff7ac8, 2, 0.6), 120);
    const thanks = CAST[id].thanks!;
    try { await say(id, thanks[0], thanks[1]); } finally { clearInterval(sparkle); }
    if (my !== token) return;
    loose = loose.filter((a) => a !== fr);
    // hàng đầy → bạn đi theo lâu nhất về nhà Nhím trước (vẫn có trên bản đồ + trận cuối)
    // iPad: hàng bạn cũng không quá ~24 draw call (bạn rip nhiều mảnh tính nặng hơn) → bạn cũ về nhà sớm hơn
    const famCount = followers.filter((a) => !a.def.friend).length;
    let friendsInLine = followers.filter((a) => a.def.friend);
    const cost = (list: Actor[]) => list.reduce((n, a) => n + drawCost(a), 0);
    while (friendsInLine.length && (famCount + friendsInLine.length + 1 > MAX_PARADE || cost(friendsInLine) + drawCost(fr) > PARADE_FRIEND_CALLS)) {
      const old = friendsInLine[0];
      friendsInLine = friendsInLine.slice(1);
      followers = followers.filter((a) => a !== old);
      void old.goHome();
      if (!toldHome) { toldHome = true; void play('friend_home'); }
    }
    followers.push(fr);
  }

  async function rescue(): Promise<void> {
    if (!hero || !level || !handles) return;
    const my = token;
    const def = level;
    rescued = true;
    inChallenge = true;
    showControls(false);
    try {
      await rescueBody(my);
    } catch (e) {
      console.error('[rescue]', e);
    }
    if (my !== token) return;
    // xong (hoặc lỗi giữa chừng): vẫn ghi đã cứu + về bản đồ → không bao giờ kẹt ở bong bóng
    if (!progress.done.includes(def.id)) progress.done.push(def.id);
    const idx = LEVELS.findIndex((l) => l.id === def.id);
    progress.unlocked = Math.max(progress.unlocked, idx + 2);
    saveProgress(progress);
    cleanup();
    openMap();
  }

  /** Chờ bé bấm ✨; im lặng 15 s thì nhắc lại + hiện lại nút (watchdog: nút không bao giờ biến mất). */
  function waitCast(my: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let quiet = performance.now();
      const done = () => { clearInterval(dog); els.cast.removeEventListener('click', onClick); resolve(); };
      const onClick = () => done();
      const dog = window.setInterval(() => {
        if (my !== token) { done(); return; }
        if (performance.now() - quiet > 15000) {
          quiet = performance.now();
          showPanel(true);
          els.cast.hidden = false;
          void play('bubble');
        }
      }, 1000);
      els.cast.addEventListener('click', onClick);
    });
  }

  async function rescueBody(my: number): Promise<void> {
    if (!hero || !level || !handles) return;
    const def = level, hnd = handles, h = hero;
    huddleAt = { x: hnd.bubble.position.x, z: hnd.bubble.position.z };
    h.locked = true; h.stop();
    h.faceTo(hnd.bubble.position.x, hnd.bubble.position.z);
    await play('bubble');
    if (my !== token) return;
    showPanel(true);
    els.cast.hidden = false;
    if (DEBUG.rescue) await wait(600);
    else await waitCast(my);
    if (my !== token) return;
    showPanel(false);
    void play('bigspell');
    const target = hnd.bubble.position.clone();
    world.magic.ring(new THREE.Vector3(h.x, 0.1, h.z), PALETTE.star, 90, 3);
    void h.castPose(1200);
    await Promise.all([
      world.magic.beam(h.hornWorld(), target, PALETTE.magic, PALETTE.star, 1.1),
      world.magic.beam(h.hornWorld().add(new THREE.Vector3(0, 0.3, 0)), target, PALETTE.magicPink, 0xffffff, 1.2),
    ]);
    const bm = hnd.bubbleMesh;
    await tween(600, (k) => { bm.scale.setScalar(1 + Math.sin(k * Math.PI * 6) * 0.08 * (1 + k)); });
    world.magic.burst(target, 160, 0xffffff, 3.5, 0.34, 1.1, -1.5);
    world.magic.burst(target, 80, PALETTE.magicPink, 2.5, 0.3, 1.0, -1.5);
    bm.visible = false;
    hnd.bubble.children.forEach((c) => { if (c !== hnd.holder) c.visible = false; });
    confetti(80);
    const who = def.rescue;
    const dir = new THREE.Vector3(Math.sin(h.yaw), 0, Math.cos(h.yaw));

    if (hnd.rescueSprite) {
      // mèo emoji bay ra ôm Nhím rồi thành bạn đi theo
      const sp = hnd.rescueSprite;
      sp.visible = true;
      const start = sp.getWorldPosition(new THREE.Vector3());
      world.scene.add(sp);
      sp.position.copy(start);
      const end = new THREE.Vector3(h.x, 0.9, h.z).add(dir.clone().multiplyScalar(1.8));
      await tween(900, (k) => {
        sp.position.lerpVectors(start, end, k);
        sp.position.y += Math.sin(k * Math.PI) * 1.5;
        sp.scale.setScalar(1.7 - k * 0.6);
      }, easeOutBack);
      world.scene.remove(sp);
      const cat = await Actor.create(world, who);
      cat.place(end.x, end.z, 0);
      world.scene.add(cat.root);
      rescueActor = cat; // đứng cạnh Nhím tới hết màn (màn sau mới xếp hàng đi theo)
      void play('meow');
      cat.hop(6);
    } else if (rescueActor) {
      // pony rơi ra khỏi bong bóng, nhún tiếp đất, chạy tới Nhím
      const a = rescueActor;
      const wp = a.root.getWorldPosition(new THREE.Vector3());
      world.scene.add(a.root);
      a.allowHop = true;
      a.hover = a.flyer ? 0.55 : 0;
      a.place(wp.x, wp.z, a.yaw);
      a.y = wp.y;
      a.vy = 2;
      await wait(700);
      a.faceTo(h.x, h.z);
      if (who === 'ba-cuong') void a.loopAround();
      else a.hop(6);
    }
    await h.celebrate();
    if (my !== token) return;
    followers.forEach((a, i) => setTimeout(() => a.hop(5), i * 100));
    rescueActor?.turnTo(0);
    await say(who, def.rescueAudio, THANKS[who] ?? 'Cảm ơn Nhím!');
    if (my !== token) return;

    if (who === 'ba-tuyet') await raiseSun(rescueActor, my);
    if (my !== token) return;
    await play('level_done');
    await wait(400);
  }

  /** Bà Tuyết (Celestia) bay lên kéo mặt trời: tia vàng lên trời, trời sáng hẳn. */
  async function raiseSun(cel: Actor | null, my: number): Promise<void> {
    if (!hero) return;
    const h = hero;
    if (cel) {
      cel.busy = true;
      cel.setFlap(1);
      const y0 = cel.y;
      await tween(900, (k) => { cel.y = y0 + k * 2.2; });
      cel.faceTo(cel.x, cel.z + 5);
      const horn = cel.center().add(new THREE.Vector3(0, 1.4, 0.3));
      void world.magic.beam(horn, horn.clone().add(new THREE.Vector3(2, 14, -8)), 0xffd166, 0xffffff, 1.2);
      world.magic.burst(horn, 120, 0xffd166, 3.5, 0.4, 1.4, -0.5);
    }
    void play('sun_rise');
    await world.tweenNight(0.08, 3800);
    if (my !== token) return;
    world.magic.burst(new THREE.Vector3(h.x, 2, h.z), 80, 0xffe08a, 3, 0.3, 1, -1);
    if (cel) {
      const y1 = cel.y;
      await tween(700, (k) => { cel.y = y1 + (cel.hover - y1) * k; });
      cel.setFlap(0.4);
      cel.busy = false;
    }
  }

  // ---------- nút nhà: về bản đồ khi đang đi dạo (không cắt ngang thử thách / phép) ----------
  els.home.addEventListener('click', () => {
    if (phase !== 'play' || inChallenge) return;
    sfx('sfx_tap', 0.4);
    cleanup();
    openMap();
  });

  // ---------- điều khiển: chạm đất = Twilight chạy tới (giữ kéo thì đi theo ngón), nút nhảy + 🪽 bay to;
  // Mac: phím mũi tên + Space nhảy + F bay. Port từ game 5. ----------
  const canvas = world.renderer.domElement;
  let dragging = false;
  const canWalk = () => phase === 'play' && !!hero && !hero.locked && !inChallenge;
  canvas.addEventListener('pointerdown', (e) => {
    unlockAudio();
    if (!canWalk() || !hero) return;
    const g = world.groundAt(e.clientX, e.clientY);
    if (!g) return;
    const [x, z] = world.clampToIsland(g.x, g.z);
    hero.goTo(x, z);
    dragging = true;
    hintT = 0;
    spawnTapRing(x, z);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || !canWalk() || !hero) return;
    const g = world.groundAt(e.clientX, e.clientY);
    if (g) { const [x, z] = world.clampToIsland(g.x, g.z); hero.goTo(x, z); }
  });
  const endDrag = () => { dragging = false; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  function spawnTapRing(x: number, z: number): void {
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      world.magic.emit({ x, y: 0.15, z, color: 0xffd166, vx: Math.cos(a) * 1.6, vz: Math.sin(a) * 1.6, vy: 0.3, max: 0.5, size: 0.22, drag: 0.9 });
    }
  }
  const doJump = () => { if (canWalk() && hero?.jump()) sfx('sfx_tap', 0.4); };
  const doFly = () => { if (canWalk() && hero?.fly()) { sfx(hero.flying ? 'sfx_win' : 'sfx_soft', 0.4); hintT = 0; } };
  els.ctrlJump.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); unlockAudio(); doJump(); });
  els.flyBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); unlockAudio(); doFly(); });
  const held = { ArrowLeft: false, ArrowRight: false, ArrowUp: false, ArrowDown: false };
  const applyKeys = () => hero?.setMove((held.ArrowRight ? 1 : 0) - (held.ArrowLeft ? 1 : 0), (held.ArrowDown ? 1 : 0) - (held.ArrowUp ? 1 : 0));
  window.addEventListener('keydown', (e) => {
    if (e.key in held) { e.preventDefault(); if (e.repeat) return; held[e.key as keyof typeof held] = true; if (canWalk()) applyKeys(); }
    if (e.key === ' ') { e.preventDefault(); if (!e.repeat) doJump(); }
    if ((e.key === 'f' || e.key === 'F') && !e.repeat) doFly();
  });
  window.addEventListener('keyup', (e) => { if (e.key in held) { held[e.key as keyof typeof held] = false; if (canWalk()) applyKeys(); } });
  window.addEventListener('blur', () => { for (const k of Object.keys(held)) held[k as keyof typeof held] = false; applyKeys(); });

  // ---------- watchdog: khoá kẹt (không trong thử thách / cứu mà Twilight vẫn bị khoá > 15 s) → nhả ----------
  window.setInterval(() => {
    const now = performance.now();
    if (!hero || phase !== 'play' || !hero.locked || inChallenge) { lockedSince = now; return; }
    if (now - lockedSince > 15000) {
      console.warn('[watchdog] nhả khoá Twilight bị kẹt');
      hero.locked = false;
      showControls(true);
      lockedSince = now;
    }
  }, 1000);

  const perf = () => ({ fps: Math.round(fps), tris: world.renderer.info.render.triangles, calls: world.renderer.info.render.calls,
    geometries: world.renderer.info.memory.geometries, textures: world.renderer.info.memory.textures });
  if (Q.has('perf')) {
    const el = document.getElementById('perf')!;
    el.hidden = false;
    setInterval(() => { const p = perf(); el.textContent = `${p.fps} fps · ${(p.tris / 1000).toFixed(0)}k tam giác · ${p.calls} draw`; }, 500);
  }

  // trạng thái cho công cụ chụp màn hình / debug
  (window as unknown as { __game: unknown }).__game = {
    world,
    get phase() { return phase; },
    get battlePhase() { return battle?.phase ?? null; },
    get hero() { return hero; },
    get followers() { return followers; },
    get loose() { return loose; },
    get battle() { return battle; },
    get monsters() { return monsters; },
    get level() { return level; },
    get stars() { return stars; },
    get inChallenge() { return inChallenge; },
    get rescued() { return rescued; },
    get answer() { return testHook.answer; },
    get handles() { return handles; },
    perf, startLevel, progress,
  };
}

void boot();
