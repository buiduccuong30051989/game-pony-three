// Giảm lưới model nặng + texture ≤ 1024 px cho iPad (ngân sách ≤ 300k tam giác / khung). Port từ game 5
// (05-pony-story/scripts/optimize-models.mjs). Chạy tay 1 lần, kết quả đã commit:
//   node scripts/optimize-models.mjs [file…]
// Ghi ĐÈ tại chỗ public/models/<file> (bản gốc còn trong lịch sử git). Chạy lại không giảm thêm: file đã ≤ đích thì chỉ
// thu texture. meshoptimizer simplify (giữ đường nối UV) rồi nếu chưa đủ thì simplifySloppy (bỏ qua đường nối) tới đích.
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, textureCompress, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** file trong public/models → [số tam giác đích, file ra (mặc định ghi đè), bỏ morph target] */
const TARGETS = {
  // Twilight Equestria Girls (màn 2): 339k tam giác + 25 morph target (không dùng) + texture 4096 → 1 file .glb nhẹ
  'twilight/scene.gltf': [40000, 'twilight_eg.glb', true],
  'twilight_static/scene.gltf': [30000],
  'ponies/celestia.glb': [24000],
  'ponies/nightmare.glb': [26000],
  'ponies/spike.glb': [8000],
  'ponies/rarity.glb': [19000],
  'ponies/rainbow.glb': [18000],
  'ponies/applejack.glb': [18000],
  'ponies/fluttershy.glb': [20000],
  'ponies/pinkie.glb': [20000],
  'friends/lod/sunburst.glb': [7000],
  'friends/lod/fluttershy.glb': [7000],
  'friends/lod/shining.glb': [6500],
  'friends/lod/sunset.glb': [9000],
  'friends/lod/izzy.glb': [9000],
  'friends/lod/starlight.glb': [9000],
};
const only = process.argv.slice(2);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const count = (doc) => {
  let t = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; }
  return Math.round(t);
};

/** Sloppy simplify từng primitive về tỉ lệ `ratio` (bỏ qua đường nối UV → giảm được lưới rip nhiều mảnh). */
function sloppy(doc, ratio) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      if (!idx || !pos) continue;
      const indices = new Uint32Array(idx.getArray());
      const positions = new Float32Array(pos.getArray());
      const target = Math.max(3, Math.floor((indices.length / 3) * ratio) * 3);
      if (indices.length <= 300) continue; // mảnh nhỏ (mắt, sừng) giữ nguyên
      const [out] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, target, 0.05);
      if (out.length >= 3) idx.setArray(pos.getCount() > 65535 ? out : new Uint16Array(out));
    }
  }
}

for (const [file, [goal, outName, dropMorphs]] of Object.entries(TARGETS)) {
  if (only.length && !only.includes(file)) continue;
  const src = join(root, 'public/models', file);
  if (!existsSync(src)) { console.log(`${file}: không có (đã chuyển?) → bỏ qua`); continue; }
  const dst = outName ? join(root, 'public/models', outName) : src;
  const doc = await io.read(src);
  const before = count(doc);
  if (dropMorphs) {
    for (const mesh of doc.getRoot().listMeshes()) {
      mesh.setWeights([]);
      for (const prim of mesh.listPrimitives()) for (const t of prim.listTargets()) prim.removeTarget(t);
    }
  }
  if (before > goal * 1.08) {
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, goal / before), error: 0.004, lockBorder: false }));
    const mid = count(doc);
    if (mid > goal * 1.08) sloppy(doc, goal / mid);
  }
  // bỏ đỉnh không còn tam giác nào dùng (simplify chỉ bớt chỉ số, file vẫn nặng)
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) if (prim.getIndices()) compactPrimitive(prim);
  // texture tối đa 1024 px (giữ định dạng gốc)
  await doc.transform(textureCompress({ encoder: sharp, resize: [1024, 1024] }));
  // không gộp vật liệu trùng: src/eyes.ts tìm nhãn cầu theo TÊN vật liệu
  await doc.transform(prune(), dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }));
  await io.write(dst, doc);
  if (outName) rmSync(dirname(src), { recursive: true });
  const tex = doc.getRoot().listTextures().map((t) => Math.max(...(t.getSize() ?? [0]))).reduce((a, b) => Math.max(a, b), 0);
  console.log(`${file}${outName ? ' → ' + outName : ''}: ${before} → ${count(doc)} tam giác, texture lớn nhất ${tex} px`);
}
