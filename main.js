// Render + interaction only. Every number shown is recomputed by src/core.mjs
// in this browser tab; nothing is hard-coded from the node run.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { parseGLB, bakeScene, writeGLB, sceneStats } from "./src/core.mjs";

const $ = (id) => document.getElementById(id);
const view = $("view");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(view.clientWidth, view.clientHeight);
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a2430, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(4, 7, 6);
scene.add(key);

const camera = new THREE.PerspectiveCamera(42, view.clientWidth / view.clientHeight, 0.1, 200);
camera.position.set(6.2, 5.4, 7.4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.4, -1.2);
controls.update();
scene.add(new THREE.GridHelper(14, 14, 0x243447, 0x17212c));

const loader = new GLTFLoader();
const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + " -> " + r.status);
  return new Uint8Array(await r.arrayBuffer());
}
const sha256 = async (bytes) => {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

async function boot() {
  const [srcBytes, bakedBytes, manifest] = await Promise.all([
    fetchBytes("./data/scene.glb"),
    fetchBytes("./data/baked.glb"),
    fetch("./data/manifest.json").then((r) => r.json()),
  ]);
  const src = parseGLB(srcBytes);
  const baked = parseGLB(bakedBytes);
  const inStats = sceneStats(src.json, src.bin);
  const outStats = sceneStats(baked.json, baked.bin);

  // Re-bake in the browser with the same core used by node, then hash the bytes.
  const rebaked = bakeScene(src.json, src.bin);
  const reBytes = writeGLB(rebaked.gltf, rebaked.bin);
  const reSha = await sha256(reBytes);

  $("d-in").textContent = String(inStats.drawCalls);
  $("d-out").textContent = String(outStats.drawCalls);
  $("tris").textContent = String(outStats.triangles);
  $("verts").textContent = String(outStats.vertices);
  $("sha-node").textContent = manifest.baked.sha256.slice(0, 24) + "…";
  $("sha-browser").textContent = reSha.slice(0, 24) + "…";
  const same = reSha === manifest.baked.sha256;
  $("sha-ok").textContent = same ? "yes (byte-identical)" : "NO";
  $("sha-ok").className = same ? "ok" : "bad";

  const [bakedScene, sourceScene] = await Promise.all([load("./data/baked.glb"), load("./data/scene.glb")]);
  const bakedGroup = bakedScene.scene;
  const sourceGroup = sourceScene.scene;
  const mat = new THREE.MeshStandardMaterial({ color: 0x9fb6cd, metalness: 0.05, roughness: 0.62 });
  bakedGroup.traverse((o) => { if (o.isMesh) o.material = mat; });
  sourceGroup.traverse((o) => { if (o.isMesh) o.material = mat.clone(); });
  bakedGroup.position.set(-0.2, 0, 0);
  sourceGroup.position.set(0.2, 0, 0);
  scene.add(bakedGroup, sourceGroup);

  // Source instances are separate nodes; collect them for the explode slider.
  const parts = [];
  const seen = new Set();
  sourceGroup.traverse((o) => {
    if (o.isMesh && o.parent && !seen.has(o.parent)) { seen.add(o.parent); parts.push(o.parent); }
  });

  const setMode = (mode) => {
    const isBaked = mode === "baked";
    bakedGroup.visible = isBaked;
    sourceGroup.visible = !isBaked;
    $("show-baked").classList.toggle("on", isBaked);
    $("show-source").classList.toggle("on", !isBaked);
  };
  $("show-baked").onclick = () => setMode("baked");
  $("show-source").onclick = () => setMode("source");

  const explode = $("explode");
  explode.oninput = () => {
    const t = parseFloat(explode.value);
    $("ex-val").textContent = t.toFixed(2);
    parts.forEach((p, i) => {
      const a = (i / Math.max(1, parts.length)) * Math.PI * 2;
      p.position.set(Math.cos(a) * 2.6 * t, Math.sin(a * 1.7) * 0.9 * t, Math.sin(a) * 2.6 * t);
    });
    if (t > 0) setMode("source");
  };
  setMode("baked");
}

boot().catch((e) => {
  console.error(e);
  $("sha-ok").textContent = "error: " + e.message;
  $("sha-ok").className = "bad";
});

addEventListener("resize", () => {
  camera.aspect = view.clientWidth / view.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(view.clientWidth, view.clientHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});