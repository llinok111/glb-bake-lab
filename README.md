# glb-bake-lab

**Promise (all numbers from `bench/result.json` / `bench/verify.mjs`):** bake a nested glTF scene of **24 node instances / 24 draw calls into a single-draw GLB (1 draw call)** while every baked vertex keeps its world position **bit-identical to an independent row-major oracle (max |Δ| = 0 ULP on 576 vertices)**, the parse→write round trip reproduces the **same SHA-256 byte-for-byte**, and a **144,000-triangle / 12,000-instance** scene bakes in **122.95 ms median** (cold 266.44 ms; baseline `baseline/naive.mjs` 119.92 ms = **0.98×, parity — this project does not claim a speedup**). All 16 assertions pass.

Upstream: none

## What it is

A small, dependency-free glTF 2.0 **baking tool**. It reads a `.glb` whose meshes are spread over a node hierarchy (instancing, 90° rotations, translations, non-uniform scale), walks the graph, and emits a new `.glb` where:

- every mesh instance is expanded into world space (`POSITION`),
- normals go through the **inverse-transpose** of the world matrix (not the raw rotation, which is the classic baking bug),
- instances sharing a material are merged into one primitive, so a 24-node scene becomes 1 draw call,
- the byte stream is deterministic: no timestamps, fixed key order, canonical 4-byte chunk padding.

`src/core.mjs` is pure ES module math/IO over `ArrayBuffer`s — no `three`, no DOM, no filesystem. The same module runs in node (tests, bench) and in the browser (the page re-bakes the sample and hashes the bytes, then compares to the node-produced hash).

## Run it

```bash
node tools/gen-sample.mjs      # writes data/scene.glb + data/baked.glb + data/manifest.json
node bench/verify.mjs          # 16 assertions, exit 0
node bench/bench.mjs           # 2 warmups + 7 samples -> bench/result.json
```

Browser view (pinned three.js 0.170.0 via importmap, no build step):

```bash
python3 -m http.server 4173    # then open http://localhost:4173
```

The page loads both GLBs with `GLTFLoader`, shows the source (24 nodes) and the baked mesh (1 draw), and prints the SHA-256 of a **fresh in-browser bake** next to the node-produced one. Dragging *explode* moves the source instances apart; the baked mesh stays rigid, because baking deliberately trades per-node control for one draw.

## Evidence

| Claim | Measured | Where |
|---|---|---|
| draw calls 24 → 1 | `inStats.drawCalls=24`, `outStats.drawCalls=1` | verify A2 |
| triangles / vertices conserved | 288 → 288, 576 → 576 | verify A3 |
| baked POSITION vs independent oracle | `max|Δ| = 0` (0 ULP, exact 90° scene) | verify A4 |
| baked NORMAL vs inverse-transpose oracle | `max|Δ| = 0` exact; TRS + non-uniform scale `7.40e-32` | verify A5/A10 |
| byte round trip | SHA-256 identical for baked **and** source files | verify A6/A7 |
| bounds vs transformed box corners | `max|Δ| = 0`, `min=[-1.875,-0.75,-2.25] max=[0.75,2.75,-0.75]` | verify A8 |
| scale 1e-6 … 1e6 | bounds ratio drift `3.54e-8` (float32 storage floor) | verify A12 |
| zero-scale node | rejected with `non-invertible node transform` | verify A11 |
| 144k triangles, 12k instances | cold 266.44 ms, median 122.95 ms, p95 136.23 ms, RSD 8.79% (7 samples, 2 warmups) | `bench/result.json` |
| same work, naive baseline | median 119.92 ms → `0.98×` | `baseline/naive.mjs` |

RSD is 8.79%; the residual spread is GC on ~11 MB of per-sample output arrays plus shared-CPU scheduling, not an algorithmic effect. The baseline is not slower than the core build: per-vertex objects are well optimized by V8, so **the honest result is throughput parity**, and the value here is correctness/determinism, not speed.

## Known limitations

- **Only `TRIANGLES` primitives**, `FLOAT VEC3` `POSITION`, and optional `FLOAT VEC3` `NORMAL`. Sparse accessors, morph targets, skins, Draco/meshopt compression, and `KHR_*` extensions are rejected or ignored.
- **Only POSITION and NORMAL survive the bake.** UVs, tangents, vertex colours, and other attributes are dropped, and textures are not baked — the source materials are copied by index. This is a geometry-flattening tool, not a texture baker.
- **Draw-call reduction requires shared materials.** One output primitive is emitted per source material; a scene with 8 materials still needs 8 draws.
- **Precision:** positions are stored as `float32`. The 0 ULP claim is exact for the sample's 0/±1 rotation matrices and dyadic translations; arbitrary quaternion + non-uniform scale transforms agree with the Gauss–Jordan oracle within `1e-6` (measured `7.40e-32` on the test quad), and bounds drift over 1e-6…1e6 scaling is `3.54e-8` — the float32 storage floor, not an absolute epsilon in the algorithm.
- **No compression, no GLB chunk extension, no multi-scene merge.** A singular node matrix throws instead of silently emitting NaNs.
- The browser page needs network access to jsdelivr for three.js; the node tooling is fully offline.

## 本轮创新

**B 档。** 首次把「嵌套 glTF 场景 → 世界空间烘焙 → 单 draw 输出」做成可数字证伪的闭环：同一份 `src/core.mjs` 在 node 与浏览器里对同一 GLB 重新烘焙，字节 SHA-256 必须相同；顶点/法线由一份**独立的行主序 + 高斯-约当 oracle**（不调用 core 的乘法/法线函数）逐点复核，0 ULP；并给出 scale 1e-6…1e6 的漂移上限。与 `gltf-audit-lab` 的区别是它只读审计，本工具**写出**可被 `GLTFLoader` 加载的新 GLB 并证明字节确定性；与 `massprops-studio`/`skinning-cert-lab` 等几何证书不同，这里的产物是可直接进管线的资产文件，而不是统计量。

## License

MIT — see `LICENSE`. No upstream code was copied; all source here is original.