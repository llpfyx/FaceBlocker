// Procedurally-drawn helmet overlays for the enemy "target", plus a real
// glTF-modeled helmet for the top tier. No image-generation tool is
// available in this environment, so tiers 0-2 are hand-drawn with Canvas 2D
// paths/gradients instead of generated bitmaps. Helmets get more elaborate
// as the phase tier rises:
//   tier 0: simple yellow hard-hat (procedural)
//   tier 1: baseball helmet (procedural)
//   tier 2: horned (viking-style) helmet (procedural)
//   tier 3: "DamagedHelmet" — a real 3D model (CC BY 4.0, Khronos Group's
//           official glTF sample assets — see assets/models/LICENSE.txt)
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const SIZE = 256;
const CX = SIZE / 2;
// Head-top anchor: where the dome's base sits, roughly the top of the face oval.
const BASE_Y = 168;

function makeCanvas() {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  return c;
}

function toTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function drawDome(ctx, colorTop, colorBottom, ry = 92, rx = 96) {
  const grad = ctx.createLinearGradient(0, BASE_Y - ry, 0, BASE_Y);
  grad.addColorStop(0, colorTop);
  grad.addColorStop(1, colorBottom);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(CX, BASE_Y, rx, ry, 0, Math.PI, 0, false);
  ctx.closePath();
  ctx.fill();
  // glossy highlight
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(CX - rx * 0.35, BASE_Y - ry * 0.55, rx * 0.22, ry * 0.32, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function tier0_simpleYellow() {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  drawDome(ctx, "#ffe066", "#f2b705", 84, 92);
  // brim
  ctx.fillStyle = "#d69e00";
  ctx.beginPath();
  ctx.ellipse(CX, BASE_Y, 100, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  // center ridge
  ctx.strokeStyle = "rgba(150,100,0,0.5)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(CX, BASE_Y - 82);
  ctx.lineTo(CX, BASE_Y - 4);
  ctx.stroke();
  return toTexture(canvas);
}

function tier1_baseball() {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  drawDome(ctx, "#5b7fd6", "#25407a", 88, 94);
  // ear flap
  ctx.fillStyle = "#1c3260";
  ctx.beginPath();
  ctx.ellipse(CX + 78, BASE_Y - 18, 22, 30, 0.2, 0, Math.PI * 2);
  ctx.fill();
  // brim/bill at the front
  ctx.fillStyle = "#16264d";
  ctx.beginPath();
  ctx.ellipse(CX - 10, BASE_Y + 6, 62, 20, -0.05, 0, Math.PI);
  ctx.fill();
  // small logo dot
  ctx.fillStyle = "#ffd23f";
  ctx.beginPath();
  ctx.arc(CX, BASE_Y - 60, 10, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(canvas);
}

function hornPath(ctx, x, baseY, dir) {
  // dir: -1 left horn, +1 right horn — curved taper from base to tip
  const tipX = x + dir * 70;
  const tipY = baseY - 96;
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.quadraticCurveTo(x + dir * 46, baseY - 40, tipX, tipY);
  ctx.quadraticCurveTo(x + dir * 18, baseY - 30, x + dir * 16, baseY + 4);
  ctx.closePath();
}

function tier2_horned() {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  drawDome(ctx, "#8b95a0", "#454d57", 86, 92);
  // metal band around the base
  ctx.fillStyle = "#2c323a";
  ctx.beginPath();
  ctx.ellipse(CX, BASE_Y - 2, 96, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  // horns
  const hornGrad = ctx.createLinearGradient(0, BASE_Y - 96, 0, BASE_Y);
  hornGrad.addColorStop(0, "#f2e8d0");
  hornGrad.addColorStop(1, "#c9b98f");
  ctx.fillStyle = hornGrad;
  hornPath(ctx, CX - 82, BASE_Y - 20, -1);
  ctx.fill();
  hornPath(ctx, CX + 82, BASE_Y - 20, 1);
  ctx.fill();
  // horn shading ridges
  ctx.strokeStyle = "rgba(120,100,60,0.4)";
  ctx.lineWidth = 2;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(CX + dir * 82, BASE_Y - 20);
    ctx.quadraticCurveTo(CX + dir * 128, BASE_Y - 60, CX + dir * 152, BASE_Y - 116);
    ctx.stroke();
  }
  return toTexture(canvas);
}

function tier3_kabuto() {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  drawDome(ctx, "#5a1418", "#1a0507", 88, 96);
  // neck-guard plates (shikoro) flaring out on both sides
  const plateColors = ["#7a1e22", "#661a1d", "#521418"];
  plateColors.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(CX, BASE_Y + 4 + i * 10, 100 + i * 10, 16, 0, 0, Math.PI);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,210,63,0.35)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
  // gold trim band at the dome base
  ctx.strokeStyle = "#ffd23f";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(CX, BASE_Y, 96, 88, 0, Math.PI, 0, false);
  ctx.stroke();
  // crescent maegatate crest on the front
  ctx.save();
  ctx.fillStyle = "#ffd23f";
  ctx.beginPath();
  ctx.arc(CX, BASE_Y - 78, 46, Math.PI * 1.15, Math.PI * 1.85, false);
  ctx.arc(CX, BASE_Y - 66, 34, Math.PI * 1.85, Math.PI * 1.15, true);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#a8790a";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  // small center jewel
  ctx.fillStyle = "#ff4d4d";
  ctx.beginPath();
  ctx.arc(CX, BASE_Y - 92, 7, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(canvas);
}

export function createHelmetTextures() {
  return [tier0_simpleYellow(), tier1_baseball(), tier2_horned(), tier3_kabuto()];
}

export function helmetTierForPhase(phase) {
  if (phase <= 2) return 0;
  if (phase <= 4) return 1;
  if (phase <= 6) return 2;
  return 3;
}

const TOP_HELMET_URL = "assets/models/DamagedHelmet.glb";

// Loads the real tier-3 helmet model once. Scale/rotation/position are
// baked into the returned group (tuned empirically against the flat face
// sprite it sits on top of) so callers can just clone() it as-is.
export function loadTopHelmetModel() {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      TOP_HELMET_URL,
      (gltf) => {
        const model = gltf.scene;
        // Native bounding box is ~1.89 x 1.80 x 2.0 units and it already
        // faces the camera at the identity rotation — measured empirically
        // via THREE.Box3 against a live clone rather than guessed. Scaled
        // down so it reads as a helmet worn on the head, not the whole head.
        model.scale.setScalar(0.35);
        resolve(model);
      },
      undefined,
      (err) => reject(err)
    );
  });
}
