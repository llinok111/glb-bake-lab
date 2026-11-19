// Deterministic synthetic scene builder shared by the generator, verifier and bench.
// One 12-triangle flat-shaded box, instanced 24 times through a root -> arm -> leaf graph.

export function boxMesh(size = 1.5) {
  const h = size / 2;
  const faces = [
    { n: [0, 0, 1], v: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]] },
    { n: [0, 0, -1], v: [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]] },
    { n: [1, 0, 0], v: [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]] },
    { n: [-1, 0, 0], v: [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]] },
    { n: [0, 1, 0], v: [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]] },
    { n: [0, -1, 0], v: [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]] },
  ];
  const pos = [], nrm = [], idx = [];
  for (const f of faces) {
    const base = pos.length / 3;
    for (const v of f.v) { pos.push(...v); nrm.push(...f.n); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), idx: Uint16Array.from(idx) };
}

export function buildScene(instanceCount = 24, size = 1.5) {
  const mesh = boxMesh(size);
  const arms = Math.max(1, Math.round(instanceCount / 4));
  const leavesPerArm = Math.ceil(instanceCount / arms);
  const nodes = [{ name: "root", children: [] }];
  // Exact 90-degree rotations as integer 0/+-1 matrices (column-major), so the
  // oracle can recompose the hierarchy in another order and stay bit-identical.
  const rotY = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0];
  const rotX = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0];
  for (let a = 0; a < arms; a++) {
    const ai = nodes.length;
    nodes.push({
      name: "arm" + a,
      matrix: [...rotY.slice(0, 12), 0, a * 0.25, 0, 1],
      children: [],
    });
    nodes[0].children.push(ai);
    for (let l = 0; l < leavesPerArm; l++) {
      const li = nodes.length;
      nodes.push({
        name: "leaf" + a + "_" + l,
        matrix: [...rotX.slice(0, 12), 1.5, 0.25 * l, -0.375 * l, 1],
        mesh: 0,
        children: [],
      });
      nodes[ai].children.push(li);
    }
  }
  return { mesh, nodes, instanceCount: arms * leavesPerArm };
}

function buildGLTF(scene, mesh, bin) {
  const idxBytes = mesh.idx.byteLength;
  const posBytes = mesh.pos.byteLength;
  const nrmBytes = mesh.nrm.byteLength;
  return {
    asset: { version: "2.0", generator: "glb-bake-lab 1.0" },
    scene: 0,
    scenes: [{ name: "source", nodes: [0] }],
    nodes: scene.nodes,
    meshes: [{
      name: "box",
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1 },
        indices: 2,
        material: 0,
        mode: 4,
      }],
    }],
    materials: [{
      name: "slate",
      pbrMetallicRoughness: { baseColorFactor: [0.62, 0.71, 0.83, 1], metallicFactor: 0.05, roughnessFactor: 0.62 },
      doubleSided: false,
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: mesh.pos.length / 3, type: "VEC3", min: [-0.75, -0.75, -0.75], max: [0.75, 0.75, 0.75] },
      { bufferView: 1, componentType: 5126, count: mesh.nrm.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: mesh.idx.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes, byteLength: nrmBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes + nrmBytes, byteLength: idxBytes, target: 34963 },
    ],
    buffers: [{ byteLength: bin.byteLength }],
  };
}

export function makeSceneBytes(instanceCount = 24) {
  const scene = buildScene(instanceCount);
  const mesh = scene.mesh;
  const bin = new Uint8Array(mesh.pos.byteLength + mesh.nrm.byteLength + mesh.idx.byteLength);
  bin.set(new Uint8Array(mesh.pos.buffer), 0);
  bin.set(new Uint8Array(mesh.nrm.buffer), mesh.pos.byteLength);
  bin.set(new Uint8Array(mesh.idx.buffer), mesh.pos.byteLength + mesh.nrm.byteLength);
  return { gltf: buildGLTF(scene, mesh, bin), bin, scene, mesh };
}