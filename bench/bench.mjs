// G5 benchmark: cold start + 2 warmups + 7 timed samples.
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { bakeScene, sceneStats } from "../src/core.mjs";
import { makeSceneBytes } from "../tools/scene.mjs";
import { naiveBake } from "../baseline/naive.mjs";

const INSTANCES = 12000; // 12000 * 12 = 144,000 triangles
const scene = makeSceneBytes(INSTANCES);
const stats = sceneStats(scene.gltf, scene.bin);
const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };

const cold = time(() => bakeScene(scene.gltf, scene.bin)); // first run, JIT-cold
for (let i = 0; i < 2; i++) bakeScene(scene.gltf, scene.bin); // warmup
const samples = [];
for (let i = 0; i < 7; i++) samples.push(time(() => bakeScene(scene.gltf, scene.bin)));

// Baseline: 3 repetitions (same dataset, separate implementation).
const base = [];
for (let i = 0; i < 3; i++) base.push(time(() => naiveBake(scene.gltf, scene.bin)));
const naiveOut = naiveBake(scene.gltf, scene.bin);

const sorted = [...samples].sort((a, b) => a - b);
const med = sorted[Math.floor(sorted.length / 2)];
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);
const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
const baseSorted = [...base].sort((a, b) => a - b);
const baseMed = baseSorted[Math.floor(baseSorted.length / 2)];

const result = {
  dataset: {
    instances: stats.instances,
    triangles: stats.triangles,
    vertices: stats.vertices,
    sourceBinBytes: scene.bin.byteLength,
  },
  unit: "ms",
  coldStart: +cold.toFixed(2),
  samples: samples.map((v) => +v.toFixed(2)),
  warmup: 2,
  min: +sorted[0].toFixed(2),
  median: +med.toFixed(2),
  p95: +p95.toFixed(2),
  stddev: +sd.toFixed(2),
  rsdPercent: +((100 * sd) / mean).toFixed(2),
  baseline: {
    name: "baseline/naive.mjs (per-vertex objects + Gauss-Jordan per instance)",
    runs: base.map((v) => +v.toFixed(2)),
    median: +baseMed.toFixed(2),
    speedup: +(baseMed / med).toFixed(2),
  },
  normalConsistency: naiveOut.idx.length === stats.triangles * 3 && naiveOut.pos.length === stats.vertices * 3 ? "same triangle and vertex count" : "mismatch",
  generatedAt: new Date().toISOString(),
};
console.log(JSON.stringify(result, null, 2));
writeFileSync(new URL("./result.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");