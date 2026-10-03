// Thử thách phép thuật (mini-game DOM): A1 nghe – chọn hình, B1 đếm ngọc – chọn số.
// Không bao giờ đơ (bài học từ game 5): chạm ĐÚNG luôn được nhận ngay kể cả khi đang đọc câu "chưa đúng" (câu đó tự dừng),
// mọi câu chờ đều có hạn giờ, im lặng 15 s thì watchdog nhắc lại câu hỏi + hiện lại bảng / lựa chọn.
import { WORDS, NUMBER_AUDIO, type LevelDef, type WordDef, type ChallengeKind } from './data';
import { play, sfx, speakSequence, stopSpeech } from './audio';
import { els, showPanel, showWord, showOptions, showGemRow, setCounter, wobbleEl, hideWord } from './ui';
import { wait } from './tween';

export interface ChallengeHooks {
  /** quái cười / Nightmare Moon cười (không phạt); trả Promise thì chờ cười xong mới nhắc lại */
  onWrong: () => Promise<void> | void;
}

/** Chờ p nhưng không quá ms (audio treo / không giải mã được thì game vẫn chạy tiếp). */
export function withTimeout<T>(p: Promise<T> | T, ms: number): Promise<T | void> {
  return Promise.race([Promise.resolve(p), new Promise<void>((r) => setTimeout(r, ms))]);
}

/** Cho test tự động (scripts/test/play-human.mjs): đáp án đúng của câu đang hỏi. */
export const testHook: { answer: string | null } = { answer: null };

// 1 nút 🔊 dùng chung: chỉ thử thách đang chạy được nghe lại
let activeRepeat: (() => void) | null = null;
els.repeat.addEventListener('click', () => { activeRepeat?.(); });

export class Challenge {
  private used = new Set<string>();
  private set repeatFn(fn: (() => void) | null) { activeRepeat = fn; }
  /** lần cuối bé chạm (watchdog) */
  private quietAt = 0;

  constructor(private level: LevelDef, private hooks: ChallengeHooks) {}

  /** Chạy 1 thử thách, resolve khi bé trả lời đúng (luôn thành công, không kẹt). low = bảng sát đáy màn. */
  async run(kind: ChallengeKind, introKey = 'monster', low = false): Promise<void> {
    showPanel(true, low);
    this.quietAt = performance.now();
    // watchdog: im lặng 15 s (hoặc bảng bị ẩn mất) → hiện lại bảng, nhắc lại câu hỏi
    const dog = window.setInterval(() => {
      if (performance.now() - this.quietAt < 15000) return;
      this.quietAt = performance.now();
      if (els.panel.hidden) showPanel(true, low);
      activeRepeat?.();
    }, 1000);
    try {
      await withTimeout(play(introKey), 8000);
      if (kind === 'spell') await this.spell(); else await this.count();
      await wait(300);
    } finally {
      clearInterval(dog);
      showPanel(false);
      this.repeatFn = null;
    }
  }

  private poke(): void { this.quietAt = performance.now(); }

  private pickWord(): WordDef {
    const pool = this.level.wordPool.filter((id) => !this.used.has(id));
    const ids = pool.length ? pool : this.level.wordPool;
    const id = ids[Math.floor(Math.random() * ids.length)];
    this.used.add(id);
    return WORDS.find((w) => w.id === id)!;
  }

  private distractors(target: WordDef, n: number): WordDef[] {
    const others = WORDS.filter((w) => w.id !== target.id).sort(() => Math.random() - 0.5);
    return others.slice(0, n);
  }

  /**
   * 3 lựa chọn to, chờ chạm đúng. Sai lần 1: bỏ đáp án sai đó; sai lần 2: đáp án đúng nhấp nháy. Lời "chưa đúng" chạy nền
   * (không khoá): chạm đúng lúc đang nói thì câu đó dừng ngay và nhận luôn. Trả về nút đúng.
   */
  private choose(items: { label: string; value: string }[], correct: string, sayAgain: () => Promise<unknown>): Promise<HTMLButtonElement> {
    let wrong = 0, fb = 0, done = false;
    testHook.answer = correct;
    return new Promise<HTMLButtonElement>((resolve) => {
      const buttons = showOptions(items, (value, btn) => {
        this.poke();
        if (done) return;
        if (value !== correct) {
          wrong++;
          const my = ++fb;
          sfx('sfx_soft', 0.5);
          wobbleEl(btn);
          if (wrong === 1) btn.classList.add('gone');
          void (async () => {
            stopSpeech();
            await withTimeout(this.hooks.onWrong(), 6000);
            if (done || my !== fb) return;
            if (wrong === 1) {
              await withTimeout(play('retry'), 5000);
              if (done || my !== fb) return;
              await withTimeout(sayAgain(), 5000);
            } else {
              await withTimeout(play('hint_last'), 5000);
              if (done || my !== fb) return;
              buttons.find((b) => b.dataset.value === correct)?.classList.add('hint');
            }
          })();
          return;
        }
        done = true;
        testHook.answer = null;
        fb++;
        stopSpeech();
        buttons.forEach((b) => { b.classList.remove('hint'); if (b !== btn) b.classList.add('gone'); });
        btn.classList.add('correct');
        sfx('sfx_win', 0.5);
        resolve(btn);
      });
    });
  }

  /** A1: "Con nào là con mèo?" → 3 hình. Đúng thì đánh vần với thẻ chữ. */
  private async spell(): Promise<void> {
    const target = this.pickWord();
    const items = [target, ...this.distractors(target, 2)].sort(() => Math.random() - 0.5);
    this.repeatFn = () => void play(`ask_${target.id}`);
    const picked = this.choose(items.map((w) => ({ label: w.emoji, value: w.id })), target.id, () => play(`ask_${target.id}`));
    void play(`ask_${target.id}`);
    await picked;
    this.repeatFn = null;
    await withTimeout(play('right'), 5000);
    await withTimeout(this.spellOut(target), 20000);
  }

  /** con mèo → e – o – eo – mờ – eo – meo – huyền – mèo, tô cam chữ đang đọc, xong tô xanh. */
  private async spellOut(w: WordDef): Promise<void> {
    const all = Array.from(w.word).map((_, i) => i);
    showWord(w.word, all, true);
    this.repeatFn = () => void this.spellOut(w);
    const ok = await speakSequence([`name_${w.id}`, ...w.tokens.map((t) => t.audio)], (i) => {
      this.poke();
      if (i === 0) showWord(w.word, all, true);
      else showWord(w.word, w.tokens[i - 1].lit, false);
    });
    if (ok) showWord(w.word, all, true);
    await wait(500);
    hideWord();
  }

  /** B1: quái giữ N ngọc → chạm từng viên (một, hai, ba…) → chọn số đúng. */
  private async count(): Promise<void> {
    const [lo, hi] = this.level.countRange;
    const n = lo + Math.floor(Math.random() * (hi - lo + 1));
    let counted = 0;
    this.repeatFn = () => void play('ask_count');
    await new Promise<void>((resolve) => {
      let finished = false;
      showGemRow(n, (btn) => {
        this.poke();
        if (finished) return;
        if (btn.classList.contains('done')) { void play(NUMBER_AUDIO[Math.min(counted, 10)] || 'n1'); return; }
        btn.classList.add('done');
        counted++;
        sfx('sfx_pop', 0.5);
        setCounter(counted);
        const spoken = play(NUMBER_AUDIO[counted]);
        // đủ ngọc: sang bước chọn số ngay khi đọc xong số cuối (có hạn giờ: tiếng treo cũng không kẹt)
        if (counted === n) {
          finished = true;
          void withTimeout(spoken, 3000).then(() => wait(250)).then(() => resolve());
        }
      });
      void play('ask_count');
    });

    const opts = new Set<number>([n]);
    while (opts.size < 3) {
      const d = n + Math.floor(Math.random() * 5) - 2;
      if (d >= 1 && d <= 10) opts.add(d);
    }
    const list = [...opts].sort(() => Math.random() - 0.5);
    this.repeatFn = () => void play('ask_pick_number');
    const picked = this.choose(list.map((v) => ({ label: String(v), value: String(v) })), String(n), () => play(NUMBER_AUDIO[n]));
    void play('ask_pick_number');
    await picked;
    this.repeatFn = null;
    await withTimeout(play('right'), 5000);
    els.gemrow.hidden = true;
    setCounter(null);
  }
}
