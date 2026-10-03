// Kiểm tra hồi quy "không bao giờ đơ" trên máy tính bảng (port từ game 5): chơi như NGƯỜI THẬT — không ?auto, CÓ tiếng,
// màn hình cảm ứng (touchscreen.tap): chạm 🦄, chạm đất để Twilight chạy tới quái / bong bóng, bấm 🪽 bay + nhảy, trả lời
// SAI rồi ĐÚNG thật nhanh (đúng lúc quái đang cười), đếm ngọc chạm vội, bấm ✨ cứu người nhà, trận cuối tới màn kết.
// Đứng yên > 25 s ở 1 trạng thái = ĐƠ → exit 1 (kèm ảnh). Cuối cùng in tam giác / draw call lớn nhất đo được.
//
// Cần: `pnpm dev` (cổng 5181) + playwright-core + chrome-headless-shell (đường dẫn qua biến môi trường nếu khác máy Adam):
//   node scripts/test/play-human.mjs [màn=mun] [rộng=1180] [cao=820]
//   màn: mun rom me ba ong ba_tuyet final (final = trận Nightmare Moon tới màn kết)
//   SHOTS=/path/prefix  → lưu ảnh chụp các mốc (đi, bay, sai, cứu, trận cuối)
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const PW = process.env.PW ?? '/private/tmp/pw/node_modules/playwright-core';
const CHROME = process.env.CHROME ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const { chromium } = await import(pathToFileURL(`${PW}/index.mjs`).href);
const IDS = ['mun', 'rom', 'me', 'ba', 'ong', 'ba_tuyet', 'final'];
const [lv = 'mun', w = '1180', h = '820'] = process.argv.slice(2);
const W = Number(w), H = Number(h);
const PORT = process.env.PORT ?? '5181';
const SHOTS = process.env.SHOTS ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = lv === 'final' ? 'all' : IDS.slice(0, IDS.indexOf(lv)).join(',') || 'none';

const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: false, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/?level=${lv}&done=${done}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#start-btn.ready', { timeout: 90000 });
const tap = (x, y) => page.touchscreen.tap(Math.round(x), Math.round(y));
const tapEl = async (sel) => { const b = await page.$(sel); const r = b && await b.boundingBox(); if (r) await tap(r.x + r.width / 2, r.y + r.height / 2); return !!r; };
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}-${lv}-${W}x${H}-${name}.png` }); };
await tapEl('#start-btn');

const t0 = Date.now();
let lastKey = '', lastChange = Date.now(), ok = false;
let maxTris = 0, maxCalls = 0, challenges = 0, wrongs = 0, flew = false, jumped = false, moved = false, rescued = false;
const shotsTaken = new Set();
const once = async (name) => { if (!shotsTaken.has(name)) { shotsTaken.add(name); await shot(name); } };
while (Date.now() - t0 < 480000) {
  const st = await page.evaluate(() => {
    const g = window.__game; if (!g) return null;
    const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && !e.classList.contains('hide') && getComputedStyle(e).display !== 'none'; };
    const V = g.hero?.root.position.constructor;
    // chạm đất về phía mục tiêu, cách Twilight tối đa 6 m (như bé chạm chỗ nhìn thấy trên màn, không chạm ra ngoài)
    const scr = (x, z) => {
      const dx = x - g.hero.x, dz = z - g.hero.z, d = Math.hypot(dx, dz), k = Math.min(1, 6 / Math.max(d, 1e-3));
      return g.world.toScreen(new V(g.hero.x + dx * k, 0, g.hero.z + dz * k));
    };
    let target = null;
    if (g.hero && g.phase === 'play' && !g.inChallenge) {
      if (g.stars >= 3 && g.handles && !g.rescued) target = scr(g.handles.bubble.position.x, g.handles.bubble.position.z);
      else {
        const m = g.monsters.filter((m) => !m.defeated).sort((a, b) => Math.hypot(a.x - g.hero.x, a.z - g.hero.z) - Math.hypot(b.x - g.hero.x, b.z - g.hero.z))[0];
        if (m) target = scr(m.x, m.z);
      }
    }
    const p = g.perf();
    return { phase: g.phase, bp: g.battlePhase, stars: g.stars, inCh: g.inChallenge, answer: g.answer, target,
      hero: g.hero ? { x: +g.hero.x.toFixed(1), z: +g.hero.z.toFixed(1), flying: g.hero.flying, y: +g.hero.y.toFixed(2), locked: g.hero.locked } : null,
      panel: vis('panel'), cast: vis('cast'), gems: [...document.querySelectorAll('#gemrow .gem:not(.done)')].length,
      opts: [...document.querySelectorAll('#options .opt:not(.gone)')].map((b) => b.dataset.value),
      ending: vis('ending'), map: vis('map'), tris: p.tris, calls: p.calls, fam: document.querySelectorAll('.fam-card').length };
  });
  if (!st) { await sleep(300); continue; }
  if (process.env.DEBUG) console.log(JSON.stringify({ ...st, tris: undefined }));
  if (process.env.PEAK && st.calls > maxCalls) {
    const bd = await page.evaluate(() => {
      const g = window.__game, sc = g.world.scene, out = {};
      const tag = new Map([...(g.followers || []), ...(g.loose || [])].map((a) => [a.root, a.id]));
      if (g.hero) tag.set(g.hero.root, 'hero');
      sc.traverseVisible((o) => { if (!(o.isMesh || o.isSprite || o.isPoints)) return; let p = o; while (p.parent && p.parent !== sc && !tag.has(p)) p = p.parent;
        const k = tag.get(p) ?? `${p.type}:${p.children.length}`; out[k] = (out[k] || 0) + 1; });
      return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k}=${v}`).join(' ');
    });
    console.log(`peak ${st.calls} @ ${st.phase} inCh=${st.inCh} stars=${st.stars} cast=${st.cast}: ${bd}`);
  }
  maxTris = Math.max(maxTris, st.tris); maxCalls = Math.max(maxCalls, st.calls);
  const key = `${st.phase}|${st.bp}|${st.stars}|${st.inCh}|${st.answer}|${st.hero?.x},${st.hero?.z}|${st.opts.join()}|${st.gems}|${st.cast}|${st.fam}`;
  if (key !== lastKey) { lastKey = key; lastChange = Date.now(); }
  if (Date.now() - lastChange > 25000) {
    const f = join(tmpdir(), `pony2-STUCK-${lv}.png`);
    await page.screenshot({ path: f });
    console.error(`✗ ĐƠ ở màn ${lv}: ${key} (ảnh ${f})`);
    break;
  }
  if (lv === 'final' ? st.ending : (st.phase === 'map' && st.map)) { ok = true; await once('done'); break; }

  // ✨ cứu người nhà
  if (st.cast) { await once('rescue'); await tapEl('#cast'); rescued = true; await sleep(800); continue; }
  // đếm ngọc: chạm vội từng viên (có viên chạm 2 lần)
  if (st.panel && st.gems) {
    const b = await page.$('#gemrow .gem:not(.done)');
    const r = b && await b.boundingBox();
    if (r) { await tap(r.x + r.width / 2, r.y + r.height / 2); if (Math.random() < 0.4) await tap(r.x + r.width / 2, r.y + r.height / 2); }
    await sleep(250); continue;
  }
  // chọn đáp án: lần đầu mỗi câu chạm SAI rồi ĐÚNG ngay (lúc quái đang cười); câu thứ 2 sai 2 lần chờ gợi ý
  if (st.panel && st.answer && st.opts.length) {
    challenges++;
    const wrong = st.opts.filter((v) => v !== st.answer);
    const btn = (v) => `#options .opt[data-value="${v}"]`;
    if (wrong.length && challenges % 3 !== 0) {
      await tapEl(btn(wrong[0])); wrongs++;
      await once('wrong');
      if (challenges % 3 === 2 && wrong[1]) { await sleep(2500); await tapEl(btn(wrong[1])); wrongs++; await sleep(3000); await once('hint'); }
      else await sleep(150);
    }
    await tapEl(btn(st.answer));
    await sleep(600);
    await tapEl(btn(st.answer)); // chạm đúp
    await sleep(1200); continue;
  }
  // đi: chạm đất ngay chỗ quái / bong bóng; thỉnh thoảng bay / nhảy
  if (st.phase === 'play' && st.target && st.hero && !st.hero.locked) {
    if (!flew) {
      await tapEl('#fly-btn');
      await sleep(600);
      const f = await page.evaluate(() => window.__game.hero.flying);
      if (f) { flew = true; await once('fly'); }
    } else if (!jumped || Math.random() < 0.1) { await tapEl('#ctrl-jump'); jumped = true; }
    let x = Math.min(W - 60, Math.max(60, st.target.x)), y = Math.min(H - 60, Math.max(110, st.target.y));
    if (x > W - 400 && y > H - 200) y = H - 220; // không chạm nhầm nút nhảy / bay
    await tap(x, y);
    moved = true;
    await sleep(300);
    await once('walk');
    await sleep(900); continue;
  }
  if (st.phase === 'battle' && st.bp === 'fight') await once('battle');
  await sleep(400);
}
await shot('end');
await browser.close();
const errs = errors.filter((e) => !e.includes('Multiple instances') && !e.includes('favicon'));
if (errs.length) console.error('lỗi console:\n  ' + errs.slice(0, 10).join('\n  '));
const need = lv === 'final' ? challenges >= 5 : (moved && flew && rescued && challenges >= 3);
if (!ok || errs.length || !need) { console.error(`✗ màn ${lv}: ok=${ok} moved=${moved} flew=${flew} rescued=${rescued} challenges=${challenges}`); process.exit(1); }
console.log(`✓ màn ${lv} ${W}x${H} chơi kiểu người thật tới hết, không đơ (${((Date.now() - t0) / 1000).toFixed(0)} s; ${challenges} câu, ${wrongs} lần sai, bay=${flew}, nhảy=${jumped}, cứu=${rescued}); tối đa ${(maxTris / 1000).toFixed(0)}k tam giác, ${maxCalls} draw call`);
