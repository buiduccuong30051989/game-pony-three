// Audio: WebAudio, mở khoá bằng click/touchend (iPad Safari), giọng m4a sinh sẵn + hiệu ứng tổng hợp bằng oscillator
// (không cần file: Safari iPad đời cũ không giải mã được Ogg). Port từ game 5 (05-pony-story/src/audio.ts).

const clips = new Map<string, AudioBuffer>();
/** ?mute=1 (debug): không phát tiếng, mỗi câu coi như dài 150 ms → chạy kịch bản nhanh khi chụp màn hình. */
const MUTE = new URLSearchParams(location.search).has('mute');
let ctx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    // iPadOS 16.4+: không bị nút gạt im lặng chặn
    const session = (navigator as any).audioSession;
    if (session && 'type' in session) session.type = 'playback';
  }
  return ctx;
}

/** Gọi ĐỒNG BỘ trong handler click/touchend đầu tiên. */
export function unlockAudio(): void {
  const c = getCtx();
  // iOS còn trạng thái 'interrupted' (khoá màn hình, chuyển app, có cuộc gọi): mọi trạng thái khác 'running' đều phải resume
  if (c.state !== 'running') void c.resume();
  if (!unlocked) {
    // phát 1 buffer câm để iOS chịu mở loa
    const buf = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
    unlocked = true;
    // quay lại tab / mở lại iPad: chạm kế tiếp sẽ resume, nhưng thử luôn khi trang hiện lại
    document.addEventListener('visibilitychange', () => { if (!document.hidden && c.state !== 'running') void c.resume(); });
  }
}

async function load(key: string, ext: string): Promise<AudioBuffer | null> {
  if (clips.has(key)) return clips.get(key)!;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}audio/${key}.${ext}`);
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.arrayBuffer();
    const buf = await getCtx().decodeAudioData(data);
    clips.set(key, buf);
    return buf;
  } catch (e) {
    console.warn('[audio] missing', key, e);
    return null;
  }
}

export function preload(keys: string[]): Promise<unknown> {
  if (MUTE) return Promise.resolve();
  return Promise.all(keys.filter((k) => !k.startsWith('sfx_')).map((k) => load(k, 'm4a')));
}

/** Hiệu ứng ngắn tổng hợp: chạm, bong bóng, chuông thắng, "bụp" nhẹ khi sai. */
const SFX: Record<string, [type: OscillatorType, notes: [f0: number, f1: number, at: number, dur: number][]]> = {
  sfx_tap: ['sine', [[880, 520, 0, 0.07]]],
  sfx_pop: ['sine', [[520, 1250, 0, 0.09]]],
  sfx_win: ['triangle', [[1047, 1047, 0, 0.16], [1319, 1319, 0.09, 0.16], [1568, 1568, 0.18, 0.28]]],
  sfx_soft: ['sine', [[330, 220, 0, 0.18]]],
};
function synth(key: string, volume: number): void {
  const def = SFX[key];
  if (!def) return;
  const c = getCtx();
  const t0 = c.currentTime + 0.01;
  for (const [f0, f1, at, dur] of def[1]) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = def[0];
    o.frequency.setValueAtTime(f0, t0 + at);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + at + dur);
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.exponentialRampToValueAtTime(0.35 * volume, t0 + at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    o.connect(g).connect(c.destination);
    o.start(t0 + at);
    o.stop(t0 + at + dur + 0.02);
  }
}

let current: AudioBufferSourceNode | null = null;
let seqToken = 0;

/** Phát 1 clip, resolve khi phát xong. Clip mới cắt clip giọng đang phát. */
export function play(key: string, opts: { volume?: number; cut?: boolean } = {}): Promise<void> {
  if (MUTE) return new Promise((r) => setTimeout(r, key.startsWith('sfx_') ? 0 : 150));
  if (key.startsWith('sfx_')) { synth(key, opts.volume ?? 0.6); return Promise.resolve(); }
  // lưới an toàn: tải / giải mã treo quá 6 s → coi như không có clip (game không bao giờ đứng chờ mãi)
  const loaded = Promise.race([load(key, 'm4a'), new Promise<null>((r) => setTimeout(() => r(null), 6000))]);
  return loaded.then((buf) => {
    if (!buf) return;
    const c = getCtx();
    if (opts.cut !== false && !key.startsWith('sfx_') && current) {
      try { current.stop(); } catch { /* đã dừng */ }
      current = null;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    gain.gain.value = opts.volume ?? 1;
    src.connect(gain).connect(c.destination);
    if (!key.startsWith('sfx_')) current = src;
    return new Promise<void>((resolve) => {
      // phòng hờ: AudioContext bị treo (iPad chưa mở khoá) thì onended không bao giờ tới → không để game kẹt
      const guard = setTimeout(resolve, buf.duration * 1000 + 1500);
      src.onended = () => {
        if (current === src) current = null;
        clearTimeout(guard);
        resolve();
      };
      src.start(0);
    });
  });
}

export function sfx(key: string, volume = 0.6): void {
  void play(key, { volume, cut: false });
}

/** Phát tuần tự, gọi onToken(i) trước mỗi clip. Sequence mới huỷ sequence cũ. */
export async function speakSequence(
  keys: string[],
  onToken?: (i: number) => void,
  gapMs = 220,
): Promise<boolean> {
  const my = ++seqToken;
  for (let i = 0; i < keys.length; i++) {
    if (my !== seqToken) return false;
    onToken?.(i);
    await play(keys[i]);
    if (my !== seqToken) return false;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return my === seqToken;
}

export function stopSpeech(): void {
  seqToken++;
  if (current) {
    try { current.stop(); } catch { /* đã dừng */ }
    current = null;
  }
}
