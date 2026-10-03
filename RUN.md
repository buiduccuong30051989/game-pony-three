# Cách chạy: Twilight cứu cả nhà

Game web 3D (Vite + TypeScript + Three.js) cho Nhím học đánh vần và toán. Chạy trên Mac, mở được trên iPad cùng Wi-Fi.

## Cần có

- Node.js 20 trở lên (`node -v`)
- pnpm 9 trở lên: `corepack enable` hoặc `npm i -g pnpm`
- (Chỉ khi muốn sinh lại giọng đọc) macOS có giọng tiếng Việt **Linh**: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices → Vietnamese → Linh

## Chạy lần đầu

```bash
git clone https://github.com/buiduccuong30051989/game-pony-three.git
cd game-pony-three
pnpm install
pnpm dev
```

Mở **http://localhost:5181**, chạm nút to giữa màn hình để bắt đầu (lần chạm đầu cũng mở khoá âm thanh).

## Chơi trên iPad

1. Mac và iPad cùng Wi-Fi.
2. `pnpm dev` (cổng **5181**) sẽ in dòng `Network: http://192.168.x.x:5181` (máy Adam: **http://192.168.1.6:5181**). Mở bằng Safari trên iPad.
3. Cầm iPad **ngang** (dọc thì game nhắc "xoay ngang máy nhé").
4. Safari → Chia sẻ → **Thêm vào MH chính** để chạy toàn màn hình như app (có icon Twilight).
5. Nếu không có tiếng: tăng âm lượng rồi chạm vào màn hình 1 lần (game tự mở lại tiếng sau khi khoá màn hình / có cuộc gọi;
   iPadOS 16.4+ không bị nút gạt im lặng chặn).

## Cách chơi

- Điều khiển Twilight: **chạm xuống đất** → Twilight chạy tới đó (giữ ngón kéo thì đi theo ngón). Nút tím ⬆ to góc phải
  dưới = nhảy, nút 🪽 cạnh đó = bay ~4 s (bấm lại để hạ cánh sớm). Mac: phím mũi tên, Space nhảy, F bay.
- Bay tới gần quái / bong bóng thì Twilight tự hạ cánh, vẫn phải trả lời đúng mới qua.
- Gặp quái: trả lời câu đánh vần / đếm để làm phép, cứu 1 bạn pony đi theo sau.
- Đủ 3 sao thì tới bong bóng cứu người nhà. 7 màn, màn cuối đánh Nightmare Moon.

## Lệnh khác

| Lệnh | Làm gì |
|---|---|
| `pnpm dev` | chạy bản dev, tự tải lại khi sửa code |
| `pnpm build` | kiểm kiểu (tsc) + build bản chạy thật ra thư mục `dist/` |
| `pnpm preview` | chạy thử bản `dist/` (http://localhost:5181, tắt `pnpm dev` trước) |
| `pnpm test:human mun` | chơi thử 1 màn như người thật bằng chạm, có tiếng (cần `pnpm dev`); `final` = trận cuối. Báo ĐƠ nếu đứng yên > 25 s |
| `pnpm optimize-models` | giảm lưới + texture ≤ 1024 px cho iPad (đã chạy, chỉ cần khi thêm model mới) |
| `pnpm audio` | sinh giọng đọc còn thiếu từ `scripts/audio-manifest.txt` (chỉ macOS). Đổi câu thì xoá file `public/audio/<key>.m4a` cũ rồi chạy lại |

Bản `dist/` là web tĩnh: chép lên bất kỳ host tĩnh nào (Netlify, Vercel, GitHub Pages…) là chạy.

## Ảnh và giọng gia đình

- Ảnh thật: thả ảnh vuông vào `public/family/` tên `ba-cuong.jpg`, `me-yen.jpg`, `ba-tuyet.jpg`, `ong-cuong.jpg`, `bac-hanh.jpg`. Thiếu ảnh nào thì người đó hiện emoji.
- Giọng thật: ghi âm rồi lưu đè file `.m4a` cùng tên trong `public/audio/`.

## Link nhảy nhanh (dành cho ba mẹ / soát lỗi)

- `/?unlock=all`: mở hết màn
- `/?level=final&done=all`: vào thẳng trận Nightmare Moon
- `/?level=mun&auto=1&mute=1`: tự chơi màn 1 (xem thử)
- `/?level=final&done=all&perf=1`: hiện fps · tam giác · draw call
- Đầy đủ: mục debug trong `README.md`

Chi tiết cấu trúc code xem `README.md`.

## Lưu ý

Nhân vật Disney / My Little Pony trong game là model 3D do fan làm (xem `CREDITS.md`), chỉ để chơi trong nhà, không dùng thương mại.

## Hiệu năng đo được (03/10/2026)

Chrome headless trên Mac, 1180×820, có cảm ứng + tiếng, `pnpm test:human <màn>` chơi hết màn, lấy số LỚN NHẤT trong cả màn
(`renderer.info`, gồm lượt vẽ bóng đổ). Ngân sách iPad: ≤ 300k tam giác, ≤ 150 draw call.

| Màn | Tam giác tối đa | Draw call tối đa |
|---|---|---|
| 1 Mèo Mun | 171k | 64 |
| 2 Mèo Rơm (Twilight người) | 216k | 103 |
| 3 Mẹ Yến | 227k | 112 |
| 4 Ba Cường | 229k | 107 |
| 5 Ông Cương | 252k | 120 |
| 6 Bà Tuyết | 247k | 94 |
| 7 Trận cuối (10 bạn + cả nhà + Nightmare Moon → Luna) | 237k | 134 |

Trước khi sửa: trận cuối ~681k tam giác / 642 draw call, màn 2 ~915k / 400, màn 1 ~384k / 349.
