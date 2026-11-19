// Deterministic sample generator: writes data/scene.glb (nested source) and
// data/baked.glb (single-draw baked output) plus data/manifest.json.
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { writeGLB, parseGLB, bakeScene, sceneStats, sceneBounds } from "../src/core.mjs";
import { makeSceneBytes } from "./scene.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");

const source = makeSceneBytes(24);
const srcBytes = writeGLB(source.gltf, source.bin);
const parsed = parseGLB(srcBytes);
const baked = bakeScene(parsed.json, parsed.bin);
const bakedBytes = writeGLB(baked.gltf, baked.bin);

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../data/scene.glb", import.meta.url), srcBytes);
writeFileSync(new URL("../data/baked.glb", import.meta.url), bakedBytes);

const inStats = sceneStats(parsed.json, parsed.bin);
const inBounds = sceneBounds(parsed.json, parsed.bin);
const outStats = sceneStats(baked.gltf, baked.bin);
const outBounds = sceneBounds(baked.gltf, baked.bin);

const manifest = {
  generator: "tools/gen-sample.mjs",
  source: { bytes: srcBytes.byteLength, sha256: sha(srcBytes) },
  baked: { bytes: bakedBytes.byteLength, sha256: sha(bakedBytes) },
  input: inStats,
  output: outStats,
  bake: baked.stats,
  bounds: outBounds,
  boundsEqual: JSON.stringify(inBounds) === JSON.stringify(outBounds),
};
writeFileSync(new URL("../data/manifest.json", import.meta.url), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));