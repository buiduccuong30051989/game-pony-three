# Nhím và phép thuật tình bạn (dự án 2: Three.js, đảo 3D)

Nhím (Hà An, 5 tuổi) là **Twilight Sparkle**. Nightmare Moon phủ màn đêm và nhốt cả nhà (đã hoá pony) vào bong bóng
pha lê mặt trăng trên 7 hòn đảo Equestria. Bé chạm đất để đi (iPad ngang), gặp quái bóng đêm thì đánh vần hoặc đếm đúng để làm phép,
đủ 3 sao thì tới bong bóng làm Đại phép cứu người nhà. Người đã cứu đi theo Nhím ở các màn sau. Màn 7: đấu Nightmare Moon
bằng 5 ngọc Hài Hoà → cầu vồng → Nightmare Moon hoá lại công chúa Luna = bác Hanh, trời sáng, cả nhà ăn mừng.
Không có thua, sai chỉ bị quái/Nightmare Moon cười rồi gợi ý.

## Dàn nhân vật

| Người nhà | Vai | Ở đâu trong game |
|---|---|---|
| Nhím (Hà An) | Twilight Sparkle | nhân vật chính (màn 2: Twilight Equestria Girls) |
| Mèo Mun, mèo Rơm | mèo (emoji) | màn 1, 2 |
| Mẹ Yến | Rarity | màn 3 (rừng hoa) |
| Ba Cường | Rainbow Dash, nhanh và mạnh (hay bay vòng kéo cầu vồng) | màn 4 (đảo mây) |
| Ông Cương | Applejack | màn 5 (vườn táo) |
| Bà Tuyết | Công chúa Celestia: được cứu thì bay lên kéo mặt trời, trời sáng hẳn | màn 6 (đồi pha lê) |
| Bác Hanh | Công chúa Luna, bị bóng tối biến thành **Nightmare Moon** (trùm cuối, được cứu chứ không bị đánh) | màn 7 (lâu đài mặt trăng) |
| bạn bè | Spike (đi theo từ đầu, đứng yên 10 s thì nhắc đường) | |
| 18 bạn pony | mỗi quái giữ 1 bạn trong bong bóng nhỏ cạnh nó; trả lời đúng → bong bóng vỡ, bạn nhảy ra cảm ơn rồi vào hàng | màn 1–6, 3 bạn/màn |

**Bạn pony theo màn** (không bạn nào lặp lại; `LEVELS[].friends` trong `src/data.ts`): 1 Pinkie Pie, Fluttershy, Derpy ·
2 Minty, Babs Seed, Bạc Hà · 3 Starlight Glimmer, Sunset Shimmer, Cầu Vồng · 4 Zipp Storm, Pipp Petals, Surprise ·
5 Big Mac, Sunny, Izzy · 6 Công chúa Cadance, Shining Armor, Sunburst. Trận cuối không cứu thêm: tối đa 10 bạn đã cứu gần nhất (trừ 5 bạn nặng, xem Hiệu năng) đứng
sau người nhà cổ vũ (nhảy theo sóng mỗi viên ngọc, ngó Nightmare Moon).

**Hàng đi theo**: rắn bám vết chân Twilight (cách ~1.1–1.4), người nhà đứng đầu rồi tới bạn pony; tối đa 8 người (iPad),
bạn mới vào thì bạn đi lâu nhất "về nhà" (xoay, bụi sao). Lúc làm thử thách / cứu người cả hàng túm lại sau lưng Nhím;
không ai chồng lên nhau hay lên quái / bong bóng (đẩy tách mỗi khung). Bạn đã cứu lưu trong `haan-progress.friends`;
bản đồ có dải "🏡 Bạn pony đã cứu N/18" → chạm mở bộ sưu tập (ô chưa cứu là "?"), màn kết hiện mặt tất cả bạn.

Thẻ cổ vũ (mặt pony + tên + câu khen, có giọng đọc) hiện sau mỗi câu đúng và khi cứu được người. Ảnh thật người nhà
(tuỳ chọn): thả `public/family/<id>.jpg` (xem `public/family/README.txt`) → hiện thành huy hiệu tròn cạnh mặt pony.

## Chạy

```bash
pnpm install
pnpm dev        # http://localhost:5181 (đã --host: iPad cùng Wi-Fi mở http://<IP Mac>:5181, vd http://192.168.1.6:5181)
pnpm build      # tsc + ra dist/
pnpm test:human [màn] [rộng] [cao]   # chơi thử như người thật bằng chạm (cần pnpm dev), xem dưới
pnpm optimize-models                 # giảm lưới + texture ≤ 1024 px (đã chạy, kết quả đã commit)
pnpm audio      # sinh lại audio từ scripts/audio-manifest.txt (macOS, giọng Linh; đổi câu thì xoá m4a cũ không còn key)
pnpm exec tsc --noEmit
```

## Điều khiển

- iPad (ngang): **chạm đất → Twilight chạy tới đó** (giữ ngón kéo thì đi theo ngón), không còn D-pad. Nút tím ⬆ to = nhảy,
  nút 🪽 cạnh đó = bay ~4 s (cao 2.2, vẫn kẹp trong đảo, bấm lại để hạ sớm, nghỉ 1.2 s mới bay lại; bay tới gần quái /
  bong bóng thì tự hạ cánh rồi mới làm bài — vẫn phải trả lời đúng). 🏠 về bản đồ (khi không đang làm thử thách).
  Mac: phím mũi tên, Space nhảy, F bay.
- Màn dọc: lớp phủ "xoay ngang máy nhé". Safari → Chia sẻ → Thêm vào MH chính = chạy toàn màn hình (có manifest + icon).
- Đi tới gần quái là tự dừng. Bảng thử thách: 🔊 nghe lại, 3 lựa chọn to. Sai lần 1 bỏ 1 đáp án sai; sai lần 2 đáp án đúng nhấp nháy.
- Đủ 3 ⭐ và tới bong bóng: bấm ✨ để làm Đại phép.
- Trận cuối không cần đi: chỉ trả lời 5 câu (bảng nằm sát đáy để thấy Nightmare Moon).

## Debug URL (chơi thử / chụp màn hình; có tham số debug thì KHÔNG ghi đè tiến độ thật trong localStorage)

| Tham số | Tác dụng |
|---|---|
| `?level=ong` hoặc `?level=5` | vào thẳng màn (id: `mun rom me ba ong ba_tuyet final`, hoặc số 1–7) sau khi chạm 🦄 |
| `&auto=1` | bỏ qua màn chạm 🦄 (trình duyệt phải cho phát tiếng không cần chạm, hoặc dùng kèm `mute`) |
| `&mute=1` | tắt tiếng, mỗi câu thoại coi như 150 ms → kịch bản chạy nhanh |
| `&done=all` hoặc `&done=mun,rom,me` | coi như đã cứu những màn đó (người đi theo, mặt trên bản đồ) |
| `&unlock=all` | mở hết nút bản đồ |
| `&stars=3` | vào màn với 3 sao sẵn (quái đã biến mất), đi tới bong bóng |
| `&rescue=1` | đặt Nhím cạnh bong bóng và tự làm Đại phép cứu (vd `?level=ba_tuyet&rescue=1&done=mun,rom,me,ba,ong&auto=1&mute=1` xem bà Tuyết kéo mặt trời) |
| `&battle=N` | màn cuối, N ngọc Hài Hoà đã sáng sẵn (0–5) |
| `&win=1` | màn cuối, nhảy thẳng tới cầu vồng + Nightmare Moon hoá Luna + ăn mừng |
| `&end=1` | mở thẳng màn kết "Nhím đã cứu cả nhà!" |
| `&friends=all` / `none` / `N` / `pinkie,derpy` | bạn pony đã cứu (không có thì suy từ `&done`: bạn của các màn đã xong) |
| `&perf=1` | dải đo fps · tam giác · draw call ở đáy màn (`window.__game.perf()` cho công cụ test) |

Ví dụ: `/?level=mun&friends=none&auto=1&mute=1` (màn 1 cứu 3 bạn), `/?level=ba&done=mun,rom,me&auto=1&mute=1` (8 người đi theo),
`/?unlock=all&done=mun,rom,me,ba&auto=1` (bản đồ + bộ sưu tập), `/?level=final&done=all&battle=2&auto=1&mute=1`, `/?level=final&done=all&win=1&auto=1`, `/?unlock=all&done=mun,rom,me,ba&auto=1`.
`window.__game` (phase, battlePhase, hero, followers, loose, monsters, stars, answer, perf(), progress, startLevel...) để công cụ test đọc trạng thái.

**Kiểm "không bao giờ đơ"** (`scripts/test/play-human.mjs`, port từ game 5): chơi 1 màn như người thật — không `?auto`, có
tiếng, màn hình cảm ứng: chạm 🦄, chạm đất đi tới quái, bấm 🪽 bay + nhảy, chọn SAI rồi ĐÚNG ngay lúc quái đang cười (câu
thứ 2 sai 2 lần chờ gợi ý), chạm đúp, đếm ngọc vội, bấm ✨ cứu; `final` chơi trận Nightmare Moon tới màn kết. Đứng yên > 25 s
= ĐƠ → exit 1 + ảnh. In tam giác / draw call lớn nhất. `SHOTS=/đường/dẫn/tiền-tố` lưu ảnh các mốc.

Trang dev khác: `/viewer.html?model=models/ponies/rarity.glb&yaw=0.7[&rig=1][&eyes=material_3,3f9a3a]` xem model (`rig=1` thử auto-rig + phi tại chỗ, ghi số tam giác); `/portrait.html?model=...&yaw=-0.2[&f=fx,fy,fz&r=0.2]`
chụp mặt pony (dataURL ở `window.__png`, `&eyes=` như viewer, `&zoom=0.75` lùi xa) → lưu thành `public/img/portraits/<tên>.png` (người nhà + 18 bạn).

## Cấu trúc

```
index.html        UI DOM đè lên canvas: HUD sao / 5 ngọc Hài Hoà, nút nhảy + 🪽 bay, 🏠, lớp "xoay ngang", bảng thử thách, thẻ cổ vũ, bản đồ, màn kết, chớp sáng
src/main.ts       điều phối: bản đồ → màn → đi/nhặt ngọc → quái → thử thách → phép → bong bóng → cứu; hàng người đi theo; Spike nhắc; debug URL; lưu tiến độ
src/battle.ts     màn cuối: Nightmare Moon + lớp bóng tối nứt dần (canvas), 5 ngọc Hài Hoà, tia hài hoà, cầu vồng, hoá Luna, trời sáng, ăn mừng
src/actors.ts     Actor cho người nhà/bạn: pony auto-rig, công chúa bay (vỗ cánh), Spike, mèo emoji; đi theo vết chân có trễ, nhảy, quay ra camera, ngó nghiêng, ba Cường bay vòng cầu vồng; bóng tròn mờ dưới chân
src/family.ts     thẻ lời nói / cổ vũ (mặt pony chụp sẵn + huy hiệu ảnh thật), cheer ngẫu nhiên, cả nhà lần lượt khen
src/world.ts      đảo + props theo chủ đề màn (hoa, táo, mây, pha lê), ngày/đêm (setNight 0..1: trời, nước, đèn, trăng, sao, mặt trời, mây), bướm, chim, đom đóm, cỏ hoa đung đưa, lâu đài trăng, bong bóng pha lê, camera
src/hero.ts       Twilight: chạm đất để đi (goTo), nhảy, bay 🪽 (cánh ánh sáng), nhún; đứng yên thì thở, ngó quanh, phẩy đuôi, cúi ngửi, quay ra camera, nhảy cẫng
src/rig.ts        auto-rig ngựa không xương (11 xương: thân, 4 chân × 2, đầu, đuôi) + điều khiển nhìn/đuôi; người (dò xương); công chúa bay (xương sẵn: vỗ cánh, đung chân, vẫy đuôi)
src/monster.ts    quái tròn, cười khi sai, tan thành bươm bướm; giữ 1 bạn pony trong bong bóng nhỏ cạnh mình (vỡ khi đúng)
src/eyes.ts       vẽ mống mắt + con ngươi (vertex color) cho model rip từ Source có nhãn cầu trắng trơn
src/magic.ts      hạt 1 Points + shader; đêm cộng màu, ngày trộn thường (không loá trên nền sáng)
src/challenge.ts  A1 nghe – chọn hình (đánh vần GDPT 2018 với thẻ chữ), B1 đếm ngọc – chọn số; chạm đúng luôn được nhận
                  (kể cả lúc đang đọc "chưa đúng"), mọi câu chờ có hạn giờ, im 15 s → watchdog nhắc lại + hiện lại bảng
src/merge.ts      gộp mảnh lưới cùng vật liệu lúc tải (màu trơn → màu đỉnh; có xương: nướng tư thế / giữ xương)
src/data.ts       palette, 16 từ + token đánh vần, CAST (cả nhà + bạn), 7 màn, 5 ngọc Hài Hoà
src/audio.ts      WebAudio (port game 5): mở khoá ở lần chạm đầu (touchend/click), audioSession 'playback', resume khi
                  'interrupted' / quay lại tab, mỗi clip có hạn giờ, sfx tổng hợp bằng oscillator (không còn file .ogg)
src/ui.ts, src/tween.ts
vite.config.ts    plugin quét public/family/ → module ảo 'virtual:family-photos'
scripts/          gen-audio.sh + audio-manifest.txt (~180 clip), optimize-models.mjs, test/play-human.mjs
public/models/    twilight_static, twilight (EG), ponies/*.glb, friends/*.glb (+ friends/lod/ cho trận cuối) — xem CREDITS.md, props Kenney CC0
```

## Hiệu năng (iPad)

Ngân sách: ≤ 300k tam giác và ≤ 150 draw call mỗi cảnh (game cũ: trận cuối ~680k tam giác, ~640 draw call). Đã làm (port từ game 5):
- `scripts/optimize-models.mjs`: giảm lưới Celestia 98k→26k, Nightmare Moon 143k→26k, Twilight Equestria Girls 339k→53k
  (bỏ 25 morph target, 4096 px → 1024, 30 MB → 2 MB), Twilight pony 44k→30k, Rarity / Rainbow / Applejack / Pinkie /
  Fluttershy ~18–20k, Spike 8k, bạn lod nặng (Sunset, Izzy, Starlight, Sunburst...) 7–9k; texture ≤ 1024 px.
- Props tĩnh gộp (màu trơn → màu đỉnh, cả đảo còn vài draw call), ngọc là InstancedMesh, táo / đồ trang trí emoji gom
  thành Points (1 draw call / loại), 1/16 cỏ hoa đung đưa, cỏ hoa không đổ bóng thật; đồi + mây là InstancedMesh; bóng đổ 1024 px,
  tắt hẳn ở trận cuối. Pixel ratio tối đa 1.5.
- `src/merge.ts` gộp mảnh lưới mỗi người / bạn / quái (vd Izzy 29 → 6, Celestia 17 → 11).
- Bạn đi trong hàng / trận cuối dùng bản `lod/`. 5 bạn G5 / Equestria Girls nhiều mảnh trong suốt (Sunny, Sunset, Starlight,
  Pipp, Zipp) chỉ có mặt ở màn của mình + bộ sưu tập + màn kết. Trận cuối: tối đa 10 bạn đứng cổ vũ (như game 5 giới hạn đám
  đông), không bóng tròn. Hàng bạn đi theo còn giới hạn ~24 draw call (bạn rip nặng làm bạn cũ "về nhà" sớm hơn).

Đo headless khi chơi hết từng màn (Chrome trên Mac, 1180×820, `renderer.info`, gồm cả lượt vẽ shadow map): mọi màn
≤ 252k tam giác, ≤ 120 draw call; trận cuối ≤ 237k tam giác, ≤ 134 draw call (game cũ 681k / 642). Bảng đủ trong `RUN.md`.

## Assets và giấy phép

Xem `CREDITS.md`. Nhân vật là IP Hasbro: **chỉ chơi trong nhà, không publish, không bán**.

## Đã biết / chưa làm

- Chân ngựa vung bằng heuristic (`src/rig.ts`), không có xương tai nên chưa vẫy tai; Luna có tên xương hỏng (mã hoá Nhật) nên chỉ bay nhún, không vỗ cánh.
- Chưa có ảnh thật người nhà, giọng ba mẹ (thay file m4a cùng tên là xong). Chưa test trên iPad thật (mới test headless có cảm ứng ở 1024×768, 1180×820, 1366×1024).
- Câu Spike "Bấm mũi tên để đi nào Nhím!" và lời hướng dẫn `hint_move` vẫn nói "mũi tên" (task này không đổi lời thoại) — giờ đi bằng chạm đất.
