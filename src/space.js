// Procedurally-generated deep-space backdrop: a starfield plus a single
// "current planet" that swaps as the enemy phase advances, journeying the
// full classic order Mercury -> Venus -> Earth -> Mars -> Jupiter -> Saturn
// -> Uranus -> Neptune -> Pluto (水金地火木土天海冥). Everything is drawn on
// <canvas> at runtime — no external texture assets, so it works fully
// offline / buildless.
import * as THREE from "three";

// mulberry32 — small deterministic PRNG so each planet's surface noise is
// reproducible (same look every run) instead of re-randomizing per game.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export const PLANETS = [
  { key: "mercury", name: "MERCURY / 水星", type: "rocky", base: "#9c9088", accent: "#5f564e", radius: 4, ambient: 0xbbb0a0, craterHeavy: true },
  { key: "venus", name: "VENUS / 金星", type: "clouded", base: "#e8cf8a", accent: "#d1a94f", radius: 8, ambient: 0xffdd99 },
  { key: "earth", name: "EARTH / 地球", type: "earth", base: "#123a6b", radius: 9, ambient: 0x6688ff, clouds: true },
  { key: "mars", name: "MARS / 火星", type: "rocky", base: "#a1502b", accent: "#7a3a1e", radius: 7, ambient: 0xff8855, ice: true },
  {
    key: "jupiter",
    name: "JUPITER / 木星",
    type: "bands",
    bandColors: ["#d9b38c", "#c79768", "#e8cba3", "#b5794f", "#eeddb8"],
    spot: "#b5482f",
    radius: 15,
    ambient: 0xffcc99,
  },
  {
    key: "saturn",
    name: "SATURN / 土星",
    type: "bands",
    bandColors: ["#e8d3a0", "#dcc48a", "#f0e3c0", "#cbb47a"],
    radius: 12,
    ring: true,
    ambient: 0xffe0aa,
  },
  {
    key: "uranus",
    name: "URANUS / 天王星",
    type: "bands",
    bandColors: ["#a9e0e0", "#8fd0d6", "#bdeaea"],
    radius: 9,
    ambient: 0x88eeee,
    subtle: true,
  },
  {
    key: "neptune",
    name: "NEPTUNE / 海王星",
    type: "bands",
    bandColors: ["#3a5fcc", "#2f4fb0", "#4a72e0"],
    spot: "#1a2a66",
    radius: 9,
    ambient: 0x5577ff,
    subtle: true,
  },
  { key: "pluto", name: "PLUTO / 冥王星", type: "rocky", base: "#b6a58f", accent: "#8c7c68", radius: 4, ambient: 0xccbbaa, craterHeavy: true },
];

const TEX_W = 1024;
const TEX_H = 512;

function drawBlob(ctx, x, y, r, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  const pts = 8;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const rr = r * (0.7 + 0.3 * Math.sin(a * 3 + x));
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr * 0.6;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPolarCaps(ctx, w, h, size = 0.12) {
  const capH = h * size;
  let g = ctx.createLinearGradient(0, 0, 0, capH);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, capH);
  g = ctx.createLinearGradient(0, h - capH, 0, h);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(255,255,255,0.95)");
  ctx.fillStyle = g;
  ctx.fillRect(0, h - capH, w, capH);
}

function makeEarthTexture(planet, rand) {
  const w = TEX_W,
    h = TEX_H;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#dfeffb");
  grad.addColorStop(0.12, "#1f5f9b");
  grad.addColorStop(0.5, "#123a6b");
  grad.addColorStop(0.88, "#1f5f9b");
  grad.addColorStop(1, "#dfeffb");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const landColors = ["#3f8f4a", "#2f6b3a", "#7a6a3a"];
  for (let i = 0; i < 16; i++) {
    const x = rand() * w;
    const y = h * 0.25 + rand() * h * 0.5;
    const r = 35 + rand() * 85;
    drawBlob(ctx, x, y, r, landColors[i % landColors.length], 0.92);
  }
  for (let i = 0; i < 26; i++) {
    const x = rand() * w;
    const y = h * 0.2 + rand() * h * 0.6;
    drawBlob(ctx, x, y, 8 + rand() * 20, landColors[(i + 1) % landColors.length], 0.5);
  }
  return canvas;
}

function makeCloudTexture(rand) {
  const w = TEX_W,
    h = TEX_H;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 34; i++) {
    const x = rand() * w;
    const y = h * 0.1 + rand() * h * 0.8;
    const r = 30 + rand() * 70;
    drawBlob(ctx, x, y, r, "#ffffff", 0.22 + rand() * 0.22);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeCloudedTexture(planet, rand) {
  // thick, fully-covering swirled atmosphere (Venus-style)
  const w = TEX_W,
    h = TEX_H;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = planet.base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 60 + rand() * 140;
    drawBlob(ctx, x, y, r, planet.accent, 0.12 + rand() * 0.16);
  }
  // horizontal swirl distortion for a "thick atmosphere" feel
  const imgData = ctx.getImageData(0, 0, w, h);
  const src = new Uint8ClampedArray(imgData.data);
  for (let y = 0; y < h; y++) {
    const shift = Math.round(Math.sin(y * 0.05) * 22);
    for (let x = 0; x < w; x++) {
      const sx = (((x + shift) % w) + w) % w;
      const srcI = (y * w + sx) * 4;
      const dstI = (y * w + x) * 4;
      imgData.data[dstI] = src[srcI];
      imgData.data[dstI + 1] = src[srcI + 1];
      imgData.data[dstI + 2] = src[srcI + 2];
      imgData.data[dstI + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function makeRockyTexture(planet, rand) {
  const w = TEX_W,
    h = TEX_H;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = planet.base;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 520; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 3 + rand() * 12;
    const shade = rand() > 0.5 ? "#000000" : "#ffffff";
    drawBlob(ctx, x, y, r, shade, 0.05 + rand() * 0.08);
  }
  const craterCount = planet.craterHeavy ? 46 : 16;
  for (let i = 0; i < craterCount; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 6 + rand() * (planet.craterHeavy ? 26 : 34);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, planet.accent);
    g.addColorStop(0.7, planet.accent);
    g.addColorStop(1, planet.base);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // bright rim highlight for a raised-crater look
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (planet.ice) drawPolarCaps(ctx, w, h, 0.08);
  return canvas;
}

function makeBandsTexture(planet, rand) {
  const w = TEX_W,
    h = TEX_H;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const colors = planet.bandColors;
  const bandCount = planet.subtle ? 12 : 22;
  for (let by = 0; by < h; by++) {
    const bandF = (by / h) * bandCount;
    const c0 = colors[Math.floor(bandF) % colors.length];
    ctx.fillStyle = c0;
    ctx.fillRect(0, by, w, 1);
  }
  // horizontal swirl distortion for a gas-giant feel
  const imgData = ctx.getImageData(0, 0, w, h);
  const src = new Uint8ClampedArray(imgData.data);
  for (let y = 0; y < h; y++) {
    const shift = Math.round(Math.sin(y * 0.09 + planet.radius) * (planet.subtle ? 6 : 20));
    for (let x = 0; x < w; x++) {
      const sx = (((x + shift) % w) + w) % w;
      const srcI = (y * w + sx) * 4;
      const dstI = (y * w + x) * 4;
      imgData.data[dstI] = src[srcI];
      imgData.data[dstI + 1] = src[srcI + 1];
      imgData.data[dstI + 2] = src[srcI + 2];
      imgData.data[dstI + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // faint turbulence speckle for extra surface detail
  for (let i = 0; i < 240; i++) {
    const x = rand() * w;
    const y = rand() * h;
    drawBlob(ctx, x, y, 4 + rand() * 14, rand() > 0.5 ? "#ffffff" : "#000000", 0.04 + rand() * 0.05);
  }

  if (planet.spot) {
    const sx = w * (0.3 + rand() * 0.4);
    const sy = h * (0.45 + rand() * 0.15);
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 68);
    g.addColorStop(0, planet.spot);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 68, 40, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function makePlanetTexture(planet, seedIndex) {
  const rand = mulberry32(1000 + seedIndex * 97);
  let canvas;
  if (planet.type === "earth") canvas = makeEarthTexture(planet, rand);
  else if (planet.type === "rocky") canvas = makeRockyTexture(planet, rand);
  else if (planet.type === "clouded") canvas = makeCloudedTexture(planet, rand);
  else canvas = makeBandsTexture(planet, rand);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeRingTexture() {
  const w = 4,
    h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  for (let y = 0; y < h; y++) {
    const band = Math.sin(y * 0.14) * 0.5 + 0.5;
    const gap = Math.sin(y * 0.035) > 0.85;
    const alpha = gap ? 0.05 : 0.35 + band * 0.5;
    const shade = 200 + Math.floor(band * 40);
    ctx.fillStyle = `rgba(${shade},${shade - 20},${shade - 60},${alpha})`;
    ctx.fillRect(0, y, w, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeGlowTexture(hex) {
  const [r, g, b] = hexToRgb(hex);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.22, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
  grad.addColorStop(0.6, `rgba(${r},${g},${b},0.16)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeStarfield() {
  const starCount = 2200;
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 85 + Math.random() * 10;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    const bright = Math.random() < 0.08;
    const b = bright ? 1 : 0.5 + Math.random() * 0.4;
    const warm = Math.random() < 0.15;
    colors[i * 3] = b * (warm ? 1 : 0.85 + Math.random() * 0.15);
    colors[i * 3 + 1] = b * (0.85 + Math.random() * 0.15);
    colors[i * 3 + 2] = b * (warm ? 0.7 : 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ size: 0.7, vertexColors: true, sizeAttenuation: true });
  return new THREE.Points(geo, mat);
}

export class SpaceBackdrop {
  constructor(scene) {
    this.scene = scene;
    scene.background = new THREE.Color(0x02040c);

    this.stars = makeStarfield();
    scene.add(this.stars);

    this.sun = new THREE.DirectionalLight(0xffffff, 1.4);
    this.sun.position.set(30, 15, 20);
    scene.add(this.sun);
    this.ambient = new THREE.AmbientLight(0x334466, 0.55);
    scene.add(this.ambient);

    this.textures = PLANETS.map((p, i) => makePlanetTexture(p, i));
    this.cloudTexture = makeCloudTexture(mulberry32(4242));
    this.ringTexture = makeRingTexture();
    this.glowTextures = PLANETS.map((p) => makeGlowTexture(p.ambient));

    this.planetGroup = new THREE.Group();
    this.planetGroup.position.set(0, 4, -60);
    scene.add(this.planetGroup);

    this.glowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glowTextures[0], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    );
    this.planetGroup.add(this.glowSprite);

    this.planetMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 48),
      new THREE.MeshStandardMaterial({ map: this.textures[0], roughness: 0.9, metalness: 0.05 })
    );
    this.planetGroup.add(this.planetMesh);

    this.cloudMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.02, 48, 36),
      new THREE.MeshStandardMaterial({ map: this.cloudTexture, transparent: true, opacity: 0.85, depthWrite: false, roughness: 1 })
    );
    this.cloudMesh.visible = false;
    this.planetGroup.add(this.cloudMesh);

    this.ringMesh = new THREE.Mesh(
      new THREE.RingGeometry(1.3, 2.1, 64),
      new THREE.MeshBasicMaterial({ map: this.ringTexture, transparent: true, side: THREE.DoubleSide })
    );
    this.ringMesh.rotation.x = Math.PI / 2.4;
    this.ringMesh.visible = false;
    this.planetGroup.add(this.ringMesh);

    this.currentIndex = -1;
    this._pulseUntil = 0;
    this.setPlanetIndex(0);
  }

  setPlanetIndex(index) {
    index = Math.min(index, PLANETS.length - 1);
    if (index === this.currentIndex) return PLANETS[index];
    this.currentIndex = index;
    const planet = PLANETS[index];
    this.planetMesh.material.map = this.textures[index];
    this.planetMesh.material.needsUpdate = true;
    this.planetMesh.scale.setScalar(planet.radius);

    this.cloudMesh.visible = !!planet.clouds;
    this.cloudMesh.scale.setScalar(planet.radius);

    this.ringMesh.visible = !!planet.ring;
    if (planet.ring) this.ringMesh.scale.setScalar(planet.radius);

    this.glowSprite.material.map = this.glowTextures[index];
    this.glowSprite.material.needsUpdate = true;
    this.glowSprite.scale.setScalar(planet.radius * 2.7);

    this.ambient.color.setHex(planet.ambient);
    this._pulseUntil = performance.now() + 500;
    return planet;
  }

  get currentPlanet() {
    return PLANETS[this.currentIndex];
  }

  update(now, dt) {
    this.planetMesh.rotation.y += dt * 0.00006;
    if (this.cloudMesh.visible) this.cloudMesh.rotation.y += dt * 0.00011;
    this.stars.rotation.y += dt * 0.0000015;
    if (now < this._pulseUntil) {
      const t = 1 - (this._pulseUntil - now) / 500;
      const pulse = 1 + 0.08 * Math.sin(t * Math.PI);
      this.planetGroup.scale.setScalar(pulse);
    } else {
      this.planetGroup.scale.setScalar(1);
    }
  }

  dispose() {
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.planetMesh.geometry.dispose();
    this.planetMesh.material.dispose();
    this.cloudMesh.geometry.dispose();
    this.cloudMesh.material.dispose();
    this.cloudTexture.dispose();
    this.ringMesh.geometry.dispose();
    this.ringMesh.material.dispose();
    this.ringTexture.dispose();
    this.glowSprite.material.dispose();
    for (const t of this.textures) t.dispose();
    for (const t of this.glowTextures) t.dispose();
  }
}
