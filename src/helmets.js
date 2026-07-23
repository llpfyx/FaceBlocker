// Procedurally-drawn helmet overlays for the enemy "target", plus a real
// glTF-modeled helmet for the top tier. No image-generation tool is
// available in this environment, so tiers 0-2 are hand-drawn with Canvas 2D
// paths/gradients instead of generated bitmaps. Helmets get more elaborate
// as the phase tier rises, all sharing an anime-mecha-hero visual language
// (angular glowing visors, blade crests, cel-shaded metal) rather than
// plain toy shapes:
//   tier 0: "cyber visor" — silver rookie helmet, single glowing cyan visor
//           stripe, small forehead fin blade.
//   tier 1: "blade crest" — indigo helmet, twin glowing magenta eye-slits,
//           a swept-back mohawk-style blade crest, angular jaw plates.
//   tier 2: "dual horn" — dark helmet, twin glowing red eye-slits, sharp
//           blade-horns with a glowing leading edge.
//   tier 3: "DamagedHelmet" — a real 3D model (CC BY 4.0, Khronos Group's
//           official glTF sample assets — see assets/models/LICENSE.txt),
//           with a kabuto-style procedural fallback if it fails to load.
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

// Angular glowing visor shared by all tiers — the main "anime mecha" signal.
// `split` draws two separate glowing eye-slits (aggressive mecha-face look)
// instead of one continuous stripe (cleaner rookie/visor look).
function drawVisor(ctx, glowHex, { y = BASE_Y - 34, halfWidth = 64, height = 17, split = false } = {}) {
  ctx.fillStyle = "#0d0f14";
  ctx.beginPath();
  ctx.moveTo(CX - halfWidth, y - height * 0.6);
  ctx.lineTo(CX + halfWidth, y - height * 0.6);
  ctx.lineTo(CX + halfWidth * 0.82, y + height);
  ctx.lineTo(CX - halfWidth * 0.82, y + height);
  ctx.closePath();
  ctx.fill();

  const drawGlow = (gx, gw) => {
    const grad = ctx.createLinearGradient(gx - gw, y, gx + gw, y);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.5, glowHex);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(gx, y + height * 0.15, gw, height * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  if (split) {
    drawGlow(CX - halfWidth * 0.42, halfWidth * 0.34);
    drawGlow(CX + halfWidth * 0.42, halfWidth * 0.34);
  } else {
    drawGlow(CX, halfWidth * 0.7);
  }

  // bright rim-light along the visor's top edge
  ctx.save();
  ctx.strokeStyle = glowHex;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.moveTo(CX - halfWidth, y - height * 0.6);
  ctx.lineTo(CX + halfWidth, y - height * 0.6);
  ctx.stroke();
  ctx.restore();
}

function tier0_cyberVisor() {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  drawDome(ctx, "#f2f5fa", "#aab4c4", 84, 90);

  // chin trim
  ctx.fillStyle = "#7d8797";
  ctx.beginPath();
  ctx.ellipse(CX, BASE_Y, 96, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  drawVisor(ctx, "#38e0ff", { y: BASE_Y - 36, halfWidth: 60, height: 16 });

  // small forehead fin blade
  ctx.fillStyle = "#c3ccd8";
  ctx.beginPath();
  ctx.moveTo(CX - 10, BASE_Y - 78);
  ctx.lineTo(CX + 10, BASE_Y - 78);
  ctx.lineTo(CX + 4, BASE_Y - 122);
  ctx.lineTo(CX - 4, BASE_Y - 122);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#38e0ff";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // side vents
  ctx.strokeStyle = "#5c6b7d";
  ctx.lineWidth = 2;
  for (const dir of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(CX + dir * (68 + i * 6), BASE_Y - 8);
      ctx.lineTo(CX + dir * (78 + i * 6), BASE_Y - 26);
      ctx.stroke();
    }
  }
  return toTexture(canvas);
}

function tier1_bladeCrest() {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  drawDome(ctx, "#5f7fe0", "#1f3570", 88, 94);

  // angular jaw plates
  ctx.fillStyle = "#132250";
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(CX + dir * 62, BASE_Y - 6);
    ctx.lineTo(CX + dir * 92, BASE_Y + 6);
    ctx.lineTo(CX + dir * 80, BASE_Y + 30);
    ctx.lineTo(CX + dir * 54, BASE_Y + 14);
    ctx.closePath();
    ctx.fill();
  }

  drawVisor(ctx, "#ff49c8", { y: BASE_Y - 34, halfWidth: 64, height: 17, split: true });

  // swept-back mohawk-style blade crest
  const crestGrad = ctx.createLinearGradient(0, BASE_Y - 140, 0, BASE_Y - 70);
  crestGrad.addColorStop(0, "#8fa4ff");
  crestGrad.addColorStop(1, "#2a3f8f");
  ctx.fillStyle = crestGrad;
  ctx.beginPath();
  ctx.moveTo(CX - 8, BASE_Y - 72);
  ctx.lineTo(CX + 14, BASE_Y - 96);
  ctx.lineTo(CX + 6, BASE_Y - 140);
  ctx.lineTo(CX - 16, BASE_Y - 108);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#ff49c8";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  return toTexture(canvas);
}

function tier2_horned() {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  drawDome(ctx, "#3c3f47", "#131519", 86, 92);

  ctx.fillStyle = "#0d0e11";
  ctx.beginPath();
  ctx.ellipse(CX, BASE_Y - 2, 96, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  drawVisor(ctx, "#ff3b3b", { y: BASE_Y - 34, halfWidth: 62, height: 17, split: true });

  const hornGrad = ctx.createLinearGradient(0, BASE_Y - 130, 0, BASE_Y);
  hornGrad.addColorStop(0, "#5a1414");
  hornGrad.addColorStop(1, "#1a0505");

  // sharp blade-horns (replacing the old curved viking horns) with a
  // glowing leading edge to match the visor
  for (const dir of [-1, 1]) {
    const baseX = CX + dir * 78;
    const baseY = BASE_Y - 22;
    const tipX = baseX + dir * 56;
    const tipY = baseY - 108;
    ctx.fillStyle = hornGrad;
    ctx.beginPath();
    ctx.moveTo(baseX - dir * 8, baseY + 4);
    ctx.lineTo(baseX + dir * 14, baseY - 30);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(baseX + dir * 2, baseY - 22);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#ff3b3b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(baseX + dir * 14, baseY - 30);
    ctx.lineTo(tipX, tipY);
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

  // glowing red visor slit beneath the face guard, for a dramatic
  // final-boss anime read instead of a flat empty face
  drawVisor(ctx, "#ff2222", { y: BASE_Y - 30, halfWidth: 50, height: 14 });

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
  return [tier0_cyberVisor(), tier1_bladeCrest(), tier2_horned(), tier3_kabuto()];
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
