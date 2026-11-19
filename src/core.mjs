// glb-bake-lab core — pure ES module, no DOM, no three.js, no I/O.
// Converts a nested glTF scene graph into one baked mesh (world-space POSITION,
// inverse-transpose NORMAL) and emits a deterministic GLB byte stream.

export const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const COMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

export function parseGLB(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 20) throw new Error("GLB too short");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error("not a GLB: bad magic");
  if (dv.getUint32(4, true) !== 2) throw new Error("only glTF 2.0 GLB is supported");
  const total = dv.getUint32(8, true);
  if (total > bytes.byteLength) throw new Error("GLB truncated: header length exceeds file");
  let off = 12, json = null, bin = new Uint8Array(0);
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (start + len > total) throw new Error("GLB chunk overruns file");
    if (type === JSON_CHUNK) {
      const text = new TextDecoder().decode(bytes.subarray(start, start + len));
      json = JSON.parse(text.replace(/\u0000+$/, "").trimEnd());
    } else if (type === BIN_CHUNK) {
      bin = bytes.subarray(start, start + len);
    }
    off = start + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

function pad4(n) { return (4 - (n % 4)) % 4; }

export function writeGLB(json, bin) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = jsonBytes.byteLength + pad4(jsonBytes.byteLength);
  const binBytes = bin instanceof Uint8Array ? bin : new Uint8Array(bin);
  const binLen = binBytes.byteLength + pad4(binBytes.byteLength);
  const total = 12 + 8 + jsonLen + (binLen ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, JSON_CHUNK, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLen);
  if (binLen) {
    const o = 20 + jsonLen;
    dv.setUint32(o, binLen, true);
    dv.setUint32(o + 4, BIN_CHUNK, true);
    out.set(binBytes, o + 8);
  }
  return out;
}

export function readAccessor(gltf, bin, index) {
  const a = gltf.accessors[index];
  if (!a) throw new Error("missing accessor " + index);
  if (a.sparse) throw new Error("sparse accessors are not supported");
  if (a.bufferView === undefined) throw new Error("accessor without bufferView is not supported");
  const bv = gltf.bufferViews[a.bufferView];
  const n = NCOMP[a.type];
  const bpc = COMP[a.componentType];
  if (!n || !bpc) throw new Error("unsupported accessor layout");
  const stride = bv.byteStride || n * bpc;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const count = a.count;
  const Ctor = a.componentType === 5126 ? Float32Array
    : a.componentType === 5125 ? Uint32Array
    : a.componentType === 5123 ? Uint16Array
    : a.componentType === 5121 ? Uint8Array
    : a.componentType === 5122 ? Int16Array
    : Int8Array;
  const out = new Ctor(count * n);
  for (let i = 0; i < count; i++) {
    const o = base + i * stride;
    for (let c = 0; c < n; c++) {
      const p = o + c * bpc;
      let v;
      if (a.componentType === 5126) v = dv.getFloat32(p, true);
      else if (a.componentType === 5125) v = dv.getUint32(p, true);
      else if (a.componentType === 5123) v = dv.getUint16(p, true);
      else if (a.componentType === 5121) v = dv.getUint8(p);
      else if (a.componentType === 5122) v = dv.getInt16(p, true);
      else v = dv.getInt8(p);
      out[i * n + c] = v;
    }
  }
  return { values: out, count, itemSize: n, componentType: a.componentType };
}

// glTF matrices are column-major (same layout as THREE.Matrix4.elements).
export function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function multiply(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

export function quatToMatrix(q) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    0, 0, 0, 1,
  ];
}

export function composeMatrix(node) {
  if (node.matrix) {
    if (node.matrix.length !== 16) throw new Error("node.matrix must have 16 elements");
    return node.matrix.slice();
  }
  const t = node.translation || [0, 0, 0];
  const r = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  const m = quatToMatrix(r);
  return [
    m[0] * s[0], m[1] * s[0], m[2] * s[0], 0,
    m[4] * s[1], m[5] * s[1], m[6] * s[1], 0,
    m[8] * s[2], m[9] * s[2], m[10] * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

export function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

// Normal matrix = inverse-transpose of the upper-left 3x3, returned row-major 3x3.
export function normalMatrix(m) {
  const a = m[0], b = m[4], c = m[8];
  const d = m[1], e = m[5], f = m[9];
  const g = m[2], h = m[6], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) {
    throw new Error("non-invertible node transform (zero scale / singular matrix)");
  }
  // inverse = adj/det with adj = cofactor^T; inverse-transpose = cofactor/det
  return [
    A / det, B / det, C / det,
    -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det,
    (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det,
  ];
}

function applyNormal(nm, x, y, z) {
  const nx = nm[0] * x + nm[1] * y + nm[2] * z;
  const ny = nm[3] * x + nm[4] * y + nm[5] * z;
  const nz = nm[6] * x + nm[7] * y + nm[8] * z;
  const len = Math.hypot(nx, ny, nz);
  if (len === 0) return [0, 0, 0];
  return [nx / len, ny / len, nz / len];
}

function instanceList(gltf) {
  const roots = gltf.scenes && gltf.scenes[gltf.scene || 0] && gltf.scenes[gltf.scene || 0].nodes
    ? gltf.scenes[gltf.scene || 0].nodes
    : gltf.nodes.map((_, i) => i);
  const out = [];
  const stack = roots.map((i) => ({ index: i, world: identity() }));
  const seen = new Set();
  while (stack.length) {
    const { index, world } = stack.pop();
    const node = gltf.nodes[index];
    if (!node) throw new Error("dangling node index " + index);
    const w = multiply(world, composeMatrix(node));
    if (node.mesh !== undefined) out.push({ mesh: node.mesh, world: w, name: node.name || "node" + index });
    // Cycles are illegal in glTF; seen guards malformed input.
    if (seen.has(index)) throw new Error("node graph cycle at " + index);
    seen.add(index);
    const children = node.children || [];
    for (let i = children.length - 1; i >= 0; i--) stack.push({ index: children[i], world: w });
  }
  return out;
}

export function sceneStats(gltf, bin) {
  const inst = instanceList(gltf);
  let drawCalls = 0, triangles = 0, vertices = 0;
  for (const { mesh } of inst) {
    for (const prim of gltf.meshes[mesh].primitives) {
      drawCalls++;
      const pos = readAccessor(gltf, bin, prim.attributes.POSITION);
      vertices += pos.count;
      if (prim.indices !== undefined) triangles += readAccessor(gltf, bin, prim.indices).count / 3;
      else triangles += pos.count / 3;
    }
  }
  return { instances: inst.length, drawCalls, triangles, vertices };
}

export function sceneBounds(gltf, bin) {
  const inst = instanceList(gltf);
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { mesh, world } of inst) {
    for (const prim of gltf.meshes[mesh].primitives) {
      const pos = readAccessor(gltf, bin, prim.attributes.POSITION);
      for (let i = 0; i < pos.count; i++) {
        const p = transformPoint(world, pos.values[i * 3], pos.values[i * 3 + 1], pos.values[i * 3 + 2]);
        for (let k = 0; k < 3; k++) {
          if (p[k] < min[k]) min[k] = p[k];
          if (p[k] > max[k]) max[k] = p[k];
        }
      }
    }
  }
  return { min, max };
}

function align(len) { return len + pad4(len); }

// Bake every mesh instance into one primitive per material, in world space.
export function bakeScene(gltf, bin) {
  const inst = instanceList(gltf);
  if (!inst.length) throw new Error("scene has no mesh instances");
  const groups = new Map(); // materialIndex (or -1) -> {pos:[], nrm:[], idx:[], hasNormals}
  const input = { instances: 0, drawCalls: 0, triangles: 0 };
  for (const { mesh, world } of inst) {
    const nm = normalMatrix(world);
    const gmesh = gltf.meshes[mesh];
    input.instances++;
    for (const prim of gmesh.primitives) {
      if (prim.mode !== undefined && prim.mode !== 4) throw new Error("only TRIANGLES primitives are supported");
      input.drawCalls++;
      const mat = prim.material === undefined ? -1 : prim.material;
      let g = groups.get(mat);
      if (!g) { g = { pos: [], nrm: [], idx: [], hasNormals: prim.attributes.NORMAL !== undefined }; groups.set(mat, g); }
      const pos = readAccessor(gltf, bin, prim.attributes.POSITION);
      if (pos.componentType !== 5126 || pos.itemSize !== 3) throw new Error("POSITION must be FLOAT VEC3");
      let nrm = null;
      if (prim.attributes.NORMAL !== undefined) {
        nrm = readAccessor(gltf, bin, prim.attributes.NORMAL);
        if (nrm.itemSize !== 3 || nrm.count !== pos.count) throw new Error("NORMAL must be VEC3 matching POSITION count");
        g.hasNormals = true;
      }
      const base = g.pos.length / 3;
      for (let i = 0; i < pos.count; i++) {
        const p = transformPoint(world, pos.values[i * 3], pos.values[i * 3 + 1], pos.values[i * 3 + 2]);
        g.pos.push(p[0], p[1], p[2]);
        if (nrm) {
          const n = applyNormal(nm, nrm.values[i * 3], nrm.values[i * 3 + 1], nrm.values[i * 3 + 2]);
          g.nrm.push(n[0], n[1], n[2]);
        }
      }
      const count = prim.indices !== undefined
        ? readAccessor(gltf, bin, prim.indices).count
        : pos.count;
      if (count % 3 !== 0) throw new Error("triangle primitive with index count not divisible by 3");
      const idxVals = prim.indices !== undefined
        ? readAccessor(gltf, bin, prim.indices).values
        : null;
      for (let i = 0; i < count; i++) g.idx.push(base + (idxVals ? idxVals[i] : i));
      input.triangles += count / 3;
    }
  }

  // Deterministic material order: ascending source material index, unmaterialed last.
  const keys = [...groups.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const chunks = [];
  let cursor = 0;
  const bufferViews = [], accessors = [], primitives = [];
  const materials = [];
  const matRemap = new Map();
  let totalTris = 0, totalVerts = 0;

  for (const key of keys) {
    const g = groups.get(key);
    const posArr = Float32Array.from(g.pos);
    const posBytes = new Uint8Array(posArr.buffer.slice(0));
    const posOff = align(cursor);
    // Pad inside the bin stream to keep every bufferView 4-byte aligned.
    if (posOff > cursor) { chunks.push(new Uint8Array(posOff - cursor)); cursor = posOff; }
    chunks.push(posBytes);
    const posView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: cursor, byteLength: posBytes.byteLength, target: 34962 });
    cursor += posBytes.byteLength;

    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < posArr.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (posArr[i + k] < min[k]) min[k] = posArr[i + k];
        if (posArr[i + k] > max[k]) max[k] = posArr[i + k];
      }
    }
    accessors.push({ bufferView: posView, componentType: 5126, count: posArr.length / 3, type: "VEC3", min, max });
    const posAcc = accessors.length - 1;

    let nrmAcc = null;
    if (g.hasNormals) {
      const nrmArr = Float32Array.from(g.nrm);
      if (nrmArr.length !== posArr.length) throw new Error("internal: normal buffer mismatch");
      const nrmBytes = new Uint8Array(nrmArr.buffer.slice(0));
      const nrmOff = align(cursor);
      if (nrmOff > cursor) { chunks.push(new Uint8Array(nrmOff - cursor)); cursor = nrmOff; }
      chunks.push(nrmBytes);
      const v = bufferViews.length;
      bufferViews.push({ buffer: 0, byteOffset: cursor, byteLength: nrmBytes.byteLength, target: 34962 });
      cursor += nrmBytes.byteLength;
      accessors.push({ bufferView: v, componentType: 5126, count: nrmArr.length / 3, type: "VEC3" });
      nrmAcc = accessors.length - 1;
    }

    const idxArr = Uint32Array.from(g.idx);
    const idxBytes = new Uint8Array(idxArr.buffer.slice(0));
    const idxOff = align(cursor);
    if (idxOff > cursor) { chunks.push(new Uint8Array(idxOff - cursor)); cursor = idxOff; }
    chunks.push(idxBytes);
    const iv = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: cursor, byteLength: idxBytes.byteLength, target: 34963 });
    cursor += idxBytes.byteLength;
    accessors.push({ bufferView: iv, componentType: 5125, count: idxArr.length, type: "SCALAR" });
    const idxAcc = accessors.length - 1;

    const attributes = { POSITION: posAcc };
    if (nrmAcc !== null) attributes.NORMAL = nrmAcc;
    let material;
    if (key >= 0) {
      if (!matRemap.has(key)) { matRemap.set(key, materials.length); materials.push(gltf.materials[key]); }
      material = matRemap.get(key);
    }
    primitives.push({ attributes, indices: idxAcc, material, mode: 4 });
    totalTris += idxArr.length / 3;
    totalVerts += posArr.length / 3;
  }

  const binLen = align(cursor);
  if (binLen > cursor) chunks.push(new Uint8Array(binLen - cursor));
  const outBin = new Uint8Array(binLen);
  let o = 0;
  for (const c of chunks) { outBin.set(c, o); o += c.byteLength; }

  const outJson = {
    asset: { version: "2.0", generator: "glb-bake-lab 1.0" },
    scene: 0,
    scenes: [{ name: "baked", nodes: [0] }],
    nodes: [{ name: "baked", mesh: 0 }],
    meshes: [{ name: "baked", primitives }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLen }],
  };
  if (materials.length) outJson.materials = materials;
  return {
    gltf: outJson,
    bin: outBin,
    stats: {
      instances: input.instances,
      inputDrawCalls: input.drawCalls,
      outputDrawCalls: primitives.length,
      inputTriangles: input.triangles,
      triangles: totalTris,
      vertices: totalVerts,
      materials: materials.length,
    },
  };
}

export function bakeToGLB(gltf, bin) {
  const out = bakeScene(gltf, bin);
  return { bytes: writeGLB(out.gltf, out.bin), stats: out.stats, gltf: out.gltf, bin: out.bin };
}