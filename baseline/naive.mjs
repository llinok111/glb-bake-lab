// Baseline: straightforward per-instance bake with object allocation, per-instance
// Gauss-Jordan inverse, and per-vertex array pushes. Same output as core.bakeScene.
import { readAccessor, composeMatrix } from "../src/core.mjs";

function invert4(m) {
  const a = m.slice();
  const inv = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r * 4 + c]) > Math.abs(a[p * 4 + c])) p = r;
    for (let j = 0; j < 4; j++) {
      let t = a[c * 4 + j]; a[c * 4 + j] = a[p * 4 + j]; a[p * 4 + j] = t;
      t = inv[c * 4 + j]; inv[c * 4 + j] = inv[p * 4 + j]; inv[p * 4 + j] = t;
    }
    const d = a[c * 4 + c];
    for (let j = 0; j < 4; j++) { a[c * 4 + j] /= d; inv[c * 4 + j] /= d; }
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = a[r * 4 + c];
      for (let j = 0; j < 4; j++) { a[r * 4 + j] -= f * a[c * 4 + j]; inv[r * 4 + j] -= f * inv[c * 4 + j]; }
    }
  }
  return inv;
}

function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
    o[r * 4 + c] = s;
  }
  return o;
}

const toRow = (m) => {
  const r = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) r[i * 4 + j] = m[j * 4 + i];
  return r;
};

export function naiveBake(gltf, bin) {
  const outPos = [], outNrm = [], outIdx = [], mats = [];
  const walk = (index, parent) => {
    const node = gltf.nodes[index];
    const local = toRow(composeMatrix(node));
    const world = mul(parent, local);
    if (node.mesh !== undefined) {
      const prim = gltf.meshes[node.mesh].primitives[0];
      const pos = readAccessor(gltf, bin, prim.attributes.POSITION);
      const nrm = prim.attributes.NORMAL !== undefined ? readAccessor(gltf, bin, prim.attributes.NORMAL) : null;
      const inv = invert4(world);
      const base = outPos.length / 3;
      for (let i = 0; i < pos.count; i++) {
        const v = { x: pos.values[i * 3], y: pos.values[i * 3 + 1], z: pos.values[i * 3 + 2] };
        outPos.push(world[0] * v.x + world[1] * v.y + world[2] * v.z + world[3],
          world[4] * v.x + world[5] * v.y + world[6] * v.z + world[7],
          world[8] * v.x + world[9] * v.y + world[10] * v.z + world[11]);
        if (nrm) {
          const n = { x: nrm.values[i * 3], y: nrm.values[i * 3 + 1], z: nrm.values[i * 3 + 2] };
          const nx = inv[0] * n.x + inv[4] * n.y + inv[8] * n.z;
          const ny = inv[1] * n.x + inv[5] * n.y + inv[9] * n.z;
          const nz = inv[2] * n.x + inv[6] * n.y + inv[10] * n.z;
          const l = Math.hypot(nx, ny, nz) || 1;
          outNrm.push(nx / l, ny / l, nz / l);
        }
      }
      const iv = prim.indices !== undefined ? readAccessor(gltf, bin, prim.indices).values : null;
      const icount = iv ? iv.length : pos.count;
      for (let i = 0; i < icount; i++) outIdx.push(base + (iv ? iv[i] : i));
    }
    for (const c of node.children || []) walk(c, world);
  };
  const roots = gltf.scenes[gltf.scene || 0].nodes;
  for (const r of roots) walk(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return { pos: outPos, nrm: outNrm, idx: outIdx, materials: mats };
}