// G4 assertions: every number printed below comes from a real run of this file.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  parseGLB, writeGLB, readAccessor, bakeScene, sceneStats, sceneBounds,
  composeMatrix, normalMatrix, transformPoint, identity, multiply,
} from "../src/core.mjs";
import { makeSceneBytes, boxMesh } from "../tools/scene.mjs";

let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS ${name}: ${detail}`); }
  else { failures.push(name); console.log(`FAIL ${name}: ${detail}`); }
}
const sha = (b) => createHash("sha256").update(b).digest("hex");
const num = (v) => (Number.isInteger(v) ? v : Number(v.toPrecision(6)));

// --- independent row-major oracle (does not call core's multiply/transformPoint) ---
function m4mulRow(A, B) {
  const C = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += A[r * 4 + k] * B[k * 4 + c];
    C[r * 4 + c] = s;
  }
  return C;
}
function toRowMajor(col) {
  const R = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) R[r * 4 + c] = col[c * 4 + r];
  return R;
}
function oracleWorld(gltf, rootIndex = 0) {
  // Nodes here carry exact 0/+-1 `matrix` entries, so any association order is exact.
  const out = [];
  const walk = (i, parent) => {
    const node = gltf.nodes[i];
    const local = node.matrix ? toRowMajor(node.matrix) : [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    const world = m4mulRow(parent, local);
    if (node.mesh !== undefined) out.push({ node: i, mesh: node.mesh, world });
    for (const c of node.children || []) walk(c, world);
  };
  walk(rootIndex, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return out;
}
function oraclePoint(m, x, y, z) {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}
function oracleNormal(m, x, y, z) {
  // Gauss-Jordan inverse of the upper 3x3, then transpose, applied to the normal.
  const A = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
  const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [I[c], I[p]] = [I[p], I[c]];
    const d = A[c][c];
    for (let j = 0; j < 3; j++) { A[c][j] /= d; I[c][j] /= d; }
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = A[r][c];
      for (let j = 0; j < 3; j++) { A[r][j] -= f * A[c][j]; I[r][j] -= f * I[c][j]; }
    }
  }
  const inv = I; // inverse-transpose: (inv^T) * n means inv[col][row]
  const nx = inv[0][0] * x + inv[1][0] * y + inv[2][0] * z;
  const ny = inv[0][1] * x + inv[1][1] * y + inv[2][1] * z;
  const nz = inv[0][2] * x + inv[1][2] * y + inv[2][2] * z;
  const len = Math.hypot(nx, ny, nz);
  return [nx / len, ny / len, nz / len];
}

const srcBytes = readFileSync(new URL("../data/scene.glb", import.meta.url));
const bakedBytes = readFileSync(new URL("../data/baked.glb", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("../data/manifest.json", import.meta.url), "utf8"));
const src = parseGLB(srcBytes);
const baked = parseGLB(bakedBytes);

// A1 — structural promise: 24 nested instances / 24 draw calls collapse to 1.
const inStats = sceneStats(src.json, src.bin);
const outStats = sceneStats(baked.json, baked.bin);
check("A1 instances-baked", inStats.instances === 24, `source instances=${inStats.instances}`);
check("A2 draw-calls", inStats.drawCalls === 24 && outStats.drawCalls === 1,
  `drawCalls ${inStats.drawCalls} -> ${outStats.drawCalls}`);
check("A3 triangles-conserved", inStats.triangles === outStats.triangles && outStats.triangles === 288,
  `triangles ${inStats.triangles} -> ${outStats.triangles}`);

// A4/A5 — every baked POSITION/NORMAL against the independent row-major oracle.
const inst = oracleWorld(src.json);
const mesh = boxMesh(1.5);
const bp = readAccessor(baked.json, baked.bin, baked.json.meshes[0].primitives[0].attributes.POSITION);
const bn = readAccessor(baked.json, baked.bin, baked.json.meshes[0].primitives[0].attributes.NORMAL);
let maxPos = 0, maxNrm = 0;
let k = 0;
for (const { world } of inst) {
  for (let i = 0; i < mesh.pos.length / 3; i++) {
    const op = oraclePoint(world, mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]);
    for (let c = 0; c < 3; c++) maxPos = Math.max(maxPos, Math.abs(bp.values[k * 3 + c] - op[c]));
    const on = oracleNormal(world, mesh.nrm[i * 3], mesh.nrm[i * 3 + 1], mesh.nrm[i * 3 + 2]);
    for (let c = 0; c < 3; c++) maxNrm = Math.max(maxNrm, Math.abs(bn.values[k * 3 + c] - on[c]));
    k++;
  }
}
check("A4 positions-vs-oracle", maxPos === 0 && bp.count === 576 && k === 576,
  `vertices=${bp.count} max|baked-oracle|=${maxPos} (0 ULP on exact 90-degree scene)`);
check("A5 normals-vs-oracle", maxNrm <= 1e-7, `max|NORMAL_baked-NORMAL_oracle|=${num(maxNrm)}`);

// A6 — deterministic byte round trip (parse -> write is a fixed point).
const rtBaked = writeGLB(baked.json, baked.bin);
const rtSource = writeGLB(src.json, src.bin);
check("A6 roundtrip-baked", sha(rtBaked) === sha(bakedBytes),
  `sha256=${sha(rtBaked).slice(0, 16)} identical=${sha(rtBaked) === sha(bakedBytes)}`);
check("A7 roundtrip-source", sha(rtSource) === sha(srcBytes), `sha256=${sha(rtSource).slice(0, 16)}`);

// A8 — bounds exactly match the analytic union of transformed box corners.
const ob = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const { world } of inst) {
  for (const x of [-0.75, 0.75]) for (const y of [-0.75, 0.75]) for (const z of [-0.75, 0.75]) {
    const p = oraclePoint(world, x, y, z);
    for (let c = 0; c < 3; c++) { ob.min[c] = Math.min(ob.min[c], p[c]); ob.max[c] = Math.max(ob.max[c], p[c]); }
  }
}
const bb = sceneBounds(baked.json, baked.bin);
const boundsDiff = Math.max(...bb.min.map((v, i) => Math.abs(v - ob.min[i])), ...bb.max.map((v, i) => Math.abs(v - ob.max[i])));
check("A8 bounds-vs-corners", boundsDiff === 0, `max|bounds-oracle|=${boundsDiff} min=[${bb.min}] max=[${bb.max}]`);

// A9 — manifest on disk agrees with a fresh parse (no stale numbers).
check("A9 manifest-fresh", manifest.baked.sha256 === sha(bakedBytes) && manifest.input.drawCalls === inStats.drawCalls
  && manifest.output.triangles === outStats.triangles, `manifest sha matches file, output.triangles=${manifest.output.triangles}`);

// A10 — TRS path with a non-axis rotation and non-uniform scale: normals must be
// inverse-transpose, not the raw linear map (the classic baking bug).
const quad = {
  pos: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
  nrm: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  idx: Uint16Array.from([0, 1, 2, 0, 2, 3]),
};
const qbin = new Uint8Array(quad.pos.byteLength + quad.nrm.byteLength + quad.idx.byteLength);
qbin.set(new Uint8Array(quad.pos.buffer), 0);
qbin.set(new Uint8Array(quad.nrm.buffer), quad.pos.byteLength);
qbin.set(new Uint8Array(quad.idx.buffer), quad.pos.byteLength + quad.nrm.byteLength);
const s = Math.SQRT1_2;
const trs = {
  asset: { version: "2.0" },
  scene: 0, scenes: [{ nodes: [0] }],
  nodes: [{ rotation: [0, s, 0, s], scale: [2, 0.5, 3], translation: [10, -2, 0.5], mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
  materials: [{ name: "m" }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
    { bufferView: 1, componentType: 5126, count: 4, type: "VEC3" },
    { bufferView: 2, componentType: 5123, count: 6, type: "SCALAR" },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: quad.pos.byteLength },
    { buffer: 0, byteOffset: quad.pos.byteLength, byteLength: quad.nrm.byteLength },
    { buffer: 0, byteOffset: quad.pos.byteLength + quad.nrm.byteLength, byteLength: quad.idx.byteLength },
  ],
  buffers: [{ byteLength: qbin.byteLength }],
};
const trsBaked = bakeScene(trs, qbin);
const world = composeMatrix(trs.nodes[0]);
const nm = normalMatrix(world);
let maxTrsN = 0;
const tn = readAccessor(trsBaked.gltf, trsBaked.bin, trsBaked.gltf.meshes[0].primitives[0].attributes.NORMAL);
for (let i = 0; i < 4; i++) {
  const o = oracleNormal(toRowMajor(world), 0, 0, 1);
  for (let c = 0; c < 3; c++) maxTrsN = Math.max(maxTrsN, Math.abs(tn.values[i * 3 + c] - o[c]));
  const len = Math.hypot(tn.values[i * 3], tn.values[i * 3 + 1], tn.values[i * 3 + 2]);
  if (Math.abs(len - 1) > 1e-6) maxTrsN = 9;
}
check("A10 nonuniform-normal", maxTrsN <= 1e-6, `max|NORMAL_trs-gauss-jordan|=${num(maxTrsN)} unit-normal ok`);

// A11 — a zero-scale node must fail loudly rather than emit NaNs.
let threw = false;
try {
  bakeScene({ ...trs, nodes: [{ ...trs.nodes[0], scale: [0, 1, 1] }] }, qbin);
} catch (e) { threw = /non-invertible/.test(e.message); }
check("A11 zero-scale-throws", threw, "singular transform rejected with a named error");

// A12 — scale invariance: geometry scaled by 1e-6..1e6 keeps the same structure
// and the same bounds ratio (no absolute epsilon anywhere in the path).
const base = sceneBounds(src.json, src.bin);
const ratios = [];
for (const sc of [1e-6, 1e-3, 1, 1e3, 1e6]) {
  const g = JSON.parse(JSON.stringify(src.json));
  g.nodes.push({ name: "scale", matrix: [sc, 0, 0, 0, 0, sc, 0, 0, 0, 0, sc, 0, 0, 0, 0, 1], children: [0] });
  g.scenes[0].nodes = [g.nodes.length - 1];
  const b = bakeScene(g, src.bin);
  const bb2 = sceneBounds(b.gltf, b.bin);
  const r = bb2.max.map((v, i) => v / sc / base.max[i]);
  ratios.push(Math.max(...r.map((v) => Math.abs(v - 1))));
  if (b.stats.triangles !== 288) ratios.push(9);
}
const scaleErr = Math.max(...ratios);
check("A12 scale-invariance", scaleErr <= 1e-6, `scales 1e-6..1e6 max relative bounds drift=${scaleErr}`);

// A13 — two materials produce two output primitives (no silent material merge).
const twoMat = JSON.parse(JSON.stringify(src.json));
twoMat.meshes[0].primitives.push({ ...twoMat.meshes[0].primitives[0], material: 1 });
twoMat.materials.push({ name: "second" });
const tb = bakeScene(twoMat, src.bin);
check("A13 material-groups", tb.stats.outputDrawCalls === 2 && tb.stats.triangles === 576,
  `drawCalls=${tb.stats.inputDrawCalls}->${tb.stats.outputDrawCalls} triangles=${tb.stats.triangles}`);

// A14 — bake is deterministic and stateless across repeated calls.
const b1 = bakeScene(src.json, src.bin);
const b2 = bakeScene(src.json, src.bin);
check("A14 deterministic", sha(writeGLB(b1.gltf, b1.bin)) === sha(writeGLB(b2.gltf, b2.bin)),
  `two fresh bakes -> sha256=${sha(writeGLB(b1.gltf, b1.bin)).slice(0, 16)}`);

// A15 — no NORMAL input: output must not fabricate normals.
const noN = JSON.parse(JSON.stringify(trs));
delete noN.meshes[0].primitives[0].attributes.NORMAL;
const nb = bakeScene(noN, qbin);
check("A15 missing-normals", nb.gltf.meshes[0].primitives[0].attributes.NORMAL === undefined,
  `attributes=${Object.keys(nb.gltf.meshes[0].primitives[0].attributes)}`);

// A16 — GLB header/JSON integrity of the emitted file.
const dv = new DataView(bakedBytes.buffer, bakedBytes.byteOffset, bakedBytes.byteLength);
check("A16 glb-header", dv.getUint32(0, true) === 0x46546c67 && dv.getUint32(4, true) === 2
  && dv.getUint32(8, true) === bakedBytes.byteLength,
  `magic=glTF version=${dv.getUint32(4, true)} length=${dv.getUint32(8, true)} file=${bakedBytes.byteLength}`);

console.log(`\n${passed}/${passed + failures.length} assertions passed`);
if (failures.length) { console.log("FAILED: " + failures.join(", ")); process.exit(1); }
process.exit(0);