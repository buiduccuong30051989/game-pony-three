// Bớt draw call cho model người nhà / bạn pony (iPad: ≤ 150 draw call / khung).
// Model rip từ game có 8–30 mảnh lưới; nhiều mảnh dùng chung 1 vật liệu → gộp lại thành 1 lưới / vật liệu.
//  - Lưới có xương mà game KHÔNG cử động bằng xương (bạn pony rip có xương: chỉ nhún bằng pivot) → "nướng" tư thế hiện tại
//    thành lưới tĩnh rồi gộp.
//  - `keepSkin`: lưới có xương mà game CÓ cử động (công chúa vỗ cánh, Twilight người) → gộp nhưng giữ xương (các mảnh
//    dùng chung 1 bộ xương: đưa về không gian lúc bind, bindMatrix = đơn vị).
//  - Vật liệu trơn (không texture, không trong suốt) → màu vật liệu chép vào màu đỉnh, mọi mảnh trơn dùng chung 1 vật liệu
//    (như "palette" của game 5 nhưng làm lúc tải): rip nhiều mảnh màu trơn còn 1 draw call.
//  - `keep`: lưới giữ nguyên (thân để auto-rig 4 chân dò khung xương như cũ).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KEEP_ATTRS = ['position', 'normal', 'uv', 'color'];

/** SkinnedMesh → geometry tĩnh theo tư thế hiện tại (toạ độ local của chính mesh). */
function bakeSkinned(sm: THREE.SkinnedMesh): THREE.BufferGeometry {
  sm.skeleton.update();
  const src = sm.geometry;
  const geo = new THREE.BufferGeometry();
  const pos = src.attributes.position, nor = src.attributes.normal;
  const n = pos.count;
  const p = new Float32Array(n * 3), q = nor ? new Float32Array(n * 3) : null;
  const v = new THREE.Vector3(), nm = new THREE.Vector3();
  const skin = new THREE.Matrix4(), tmp = new THREE.Matrix4(), full = new THREE.Matrix4(), nmat = new THREE.Matrix3();
  const si = src.attributes.skinIndex, sw = src.attributes.skinWeight;
  const bones = sm.skeleton.boneMatrices!;
  for (let i = 0; i < n; i++) {
    skin.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (!w) continue;
      tmp.fromArray(bones, si.getComponent(i, k) * 16);
      for (let e = 0; e < 16; e++) skin.elements[e] += tmp.elements[e] * w;
    }
    full.multiplyMatrices(sm.bindMatrixInverse, skin).multiply(sm.bindMatrix);
    v.fromBufferAttribute(pos, i).applyMatrix4(full);
    p.set([v.x, v.y, v.z], i * 3);
    if (q) {
      nmat.getNormalMatrix(full);
      nm.fromBufferAttribute(nor!, i).applyMatrix3(nmat).normalize();
      q.set([nm.x, nm.y, nm.z], i * 3);
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  if (q) geo.setAttribute('normal', new THREE.BufferAttribute(q, 3));
  for (const k of ['uv', 'color']) if (src.attributes[k]) geo.setAttribute(k, src.attributes[k].clone());
  if (src.index) geo.setIndex(src.index.clone());
  return geo;
}

/**
 * Gộp các lưới của `model` theo vật liệu. Trả về geometry mới tạo (để dispose khi bỏ actor).
 * Lưới nhiều vật liệu (groups) và lưới trong `keep` để nguyên.
 */
export function mergeByMaterial(model: THREE.Object3D, keep: Set<THREE.Object3D> = new Set(), keepSkin = false): THREE.BufferGeometry[] {
  model.updateMatrixWorld(true);
  const inv = model.matrixWorld.clone().invert();
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[]; skel: THREE.Skeleton | null }>();
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || keep.has(m) || Array.isArray(m.material) || !m.visible) return;
    const sm = m as THREE.SkinnedMesh;
    const skinKeep = keepSkin && !!sm.isSkinnedMesh;
    let geo = sm.isSkinnedMesh && !skinKeep ? bakeSkinned(sm) : m.geometry.clone();
    const attrs = skinKeep ? [...KEEP_ATTRS, 'skinIndex', 'skinWeight'] : KEEP_ATTRS;
    for (const k of Object.keys(geo.attributes)) if (!attrs.includes(k)) geo.deleteAttribute(k);
    geo.morphAttributes = {};
    for (const [k, a] of Object.entries(geo.attributes)) {
      if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) geo.setAttribute(k, (a as THREE.InterleavedBufferAttribute).clone());
    }
    if (!geo.index) {
      const idx = new Uint32Array(geo.attributes.position.count);
      for (let i = 0; i < idx.length; i++) idx[i] = i;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    // giữ xương: về không gian lúc bind (bindMatrix của mảnh) → mảnh gộp bind với bindMatrix đơn vị
    geo = geo.applyMatrix4(skinKeep ? sm.bindMatrix : new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    // vật liệu trơn → màu đỉnh, gom chung 1 vật liệu
    const mat = m.material as THREE.MeshStandardMaterial;
    const solid = !mat.map && !mat.transparent && !mat.alphaTest && (mat.type === 'MeshStandardMaterial' || mat.type === 'MeshPhysicalMaterial');
    let matKey = mat.uuid;
    if (solid) {
      const n = geo.attributes.position.count;
      const old = geo.attributes.color;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const r = old ? old.getX(i) : 1, g = old ? old.getY(i) : 1, bl = old ? old.getZ(i) : 1;
        col[i * 3] = r * mat.color.r; col[i * 3 + 1] = g * mat.color.g; col[i * 3 + 2] = bl * mat.color.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      matKey = `solid|${mat.side}|${mat.emissive?.getHexString()}|${mat.flatShading}`;
    }
    const bones = skinKeep ? sm.skeleton.bones : [];
    const skelKey = skinKeep ? `${bones.length}|${bones[0]?.uuid}|${bones[bones.length - 1]?.uuid}|${sm.bindMode}` : '';
    const sig = `${matKey}|${Object.keys(geo.attributes).sort().join(',')}|${skelKey}`;
    let b = buckets.get(sig);
    if (!b) {
      let bm: THREE.Material = mat;
      if (solid) {
        const sm2 = mat.clone();
        sm2.color.setRGB(1, 1, 1);
        sm2.vertexColors = true;
        sm2.name = 'merged-solid';
        bm = sm2;
      }
      b = { mat: bm, geos: [], meshes: [], skel: skinKeep ? sm.skeleton : null };
      buckets.set(sig, b);
    }
    b.geos.push(geo);
    b.meshes.push(m);
  });
  const made: THREE.BufferGeometry[] = [];
  const holder = new THREE.Group();
  for (const b of buckets.values()) {
    if (b.meshes.length === 1 && (b.skel || !(b.meshes[0] as THREE.SkinnedMesh).isSkinnedMesh)) { b.geos[0].dispose(); continue; }
    const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    if (b.geos.length > 1) for (const g of b.geos) g.dispose();
    if (!merged) continue;
    for (const m of b.meshes) m.removeFromParent();
    let mesh: THREE.Mesh;
    if (b.skel) {
      const sk = new THREE.SkinnedMesh(merged, b.mat);
      sk.frustumCulled = false;
      model.add(sk);
      sk.bind(b.skel, new THREE.Matrix4());
      mesh = sk;
    } else {
      mesh = new THREE.Mesh(merged, b.mat);
      holder.add(mesh);
    }
    mesh.castShadow = b.meshes[0].castShadow;
    made.push(merged);
  }
  // lưới gộp ở toạ độ local của model → con trực tiếp của model
  for (const c of [...holder.children]) model.add(c);
  return made;
}
