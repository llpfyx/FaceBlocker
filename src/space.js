// Procedurally-generated deep-space backdrop: a starfield plus a single
// "current planet" that swaps as the enemy phase advances, journeying
// outward from Earth to Pluto. Everything is drawn on <canvas> at runtime —
// no external texture assets, so it works fully offline / buildless.
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

export const PLANETS = [
  { key: "earth", name: "EARTH / 地球", type: "earth", base: "#123a6b", radius: 9, ambient: 0x6688ff },
  { key: "mars", name: "MARS / 火星", type: "rocky", base: "#a1502b", accent: "#7a3a1e", radius: 7, ambient: 0xff8855 },
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
  { key: "pluto", name: "PLUTO / 冥王星", type: "rocky", base: "#b6a58f", accent: "#8c7c68", radius: 4, ambient: 0xccbbaa },
];

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

function makeEarthTexture(planet, rand) {
  const w = 512,
    h = 256;
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
  for (let i = 0; i < 9; i++) {
    const x = rand() * w;
    const y = h * 0.25 + rand() * h * 0.5;
    const r = 20 + rand() * 45;
    drawBlob(ctx, x, y, r, landColors[i % landColors.length], 0.9);
  }
  for (let i = 0; i < 18; i++) {
    const x = rand() * w;
    const y = h * 0.15 + rand() * h * 0.7;
    drawBlob(ctx, x, y, 6 + rand() * 10, "#ffffff", 0.35);
  }
  return canvas;
}

function makeRockyTexture(planet, rand) {
  const w = 512,
    h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = planet.base;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 260; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 2 + rand() * 8;
    const shade = rand() > 0.5 ? "#000000" : "#ffffff";
    drawBlob(ctx, x, y, r, shade, 0.06 + rand() * 0.08);
  }
  for (let i = 0; i < 10; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 8 + rand() * 22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, planet.accent);
    g.addColorStop(0.7, planet.accent);
    g.addColorStop(1, planet.base);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  return canvas;
}

function makeBandsTexture(planet, rand) {
  const w = 512,
    h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const colors = planet.bandColors;
  const bandCount = planet.subtle ? 10 : 18;
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
    const shift = Math.round(Math.sin(y * 0.09 + planet.radius) * (planet.subtle ? 4 : 12));
    for (let x = 0; x < w; x++) {
      const sx = ((x + shift) % w + w) % w;
      const srcI = (y * w + sx) * 4;
      const dstI = (y * w + x) * 4;
      imgData.data[dstI] = src[srcI];
      imgData.data[dstI + 1] = src[srcI + 1];
      imgData.data[dstI + 2] = src[srcI + 2];
      imgData.data[dstI + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  if (planet.spot) {
    const sx = w * (0.3 + rand() * 0.4);
    const sy = h * (0.45 + rand() * 0.15);
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 34);
    g.addColorStop(0, planet.spot);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 34, 20, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function makePlanetTexture(planet, seedIndex) {
  const rand = mulberry32(1000 + seedIndex * 97);
  let canvas;
  if (planet.type === "earth") canvas = makeEarthTexture(planet, rand);
  else if (planet.type === "rocky") canvas = makeRockyTexture(planet, rand);
  else canvas = makeBandsTexture(planet, rand);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeRingTexture() {
  const w = 4,
    h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  for (let y = 0; y < h; y++) {
    const band = Math.sin(y * 0.25) * 0.5 + 0.5;
    const gap = Math.sin(y * 0.07) > 0.85;
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

function makeStarfield() {
  const starCount = 1600;
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 85 + Math.random() * 10;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    const b = 0.55 + Math.random() * 0.45;
    const warm = Math.random() < 0.15;
    colors[i * 3] = b * (warm ? 1 : 0.85 + Math.random() * 0.15);
    colors[i * 3 + 1] = b * (0.85 + Math.random() * 0.15);
    colors[i * 3 + 2] = b * (warm ? 0.7 : 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ size: 0.55, vertexColors: true, sizeAttenuation: true });
  return new THREE.Points(geo, mat);
}

export class SpaceBackdrop {
  constructor(scene) {
    this.scene = scene;
    scene.background = new THREE.Color(0x02040c);

    this.stars = makeStarfield();
    scene.add(this.stars);

    this.sun = new THREE.DirectionalLight(0xffffff, 1.3);
    this.sun.position.set(30, 15, 20);
    scene.add(this.sun);
    this.ambient = new THREE.AmbientLight(0x334466, 0.55);
    scene.add(this.ambient);

    this.textures = PLANETS.map((p, i) => makePlanetTexture(p, i));
    this.ringTexture = makeRingTexture();

    this.planetGroup = new THREE.Group();
    this.planetGroup.position.set(0, 4, -60);
    scene.add(this.planetGroup);

    this.planetMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 32),
      new THREE.MeshStandardMaterial({ map: this.textures[0], roughness: 1, metalness: 0 })
    );
    this.planetGroup.add(this.planetMesh);

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
    this.ringMesh.visible = !!planet.ring;
    if (planet.ring) this.ringMesh.scale.setScalar(planet.radius);
    this.ambient.color.setHex(planet.ambient);
    this._pulseUntil = performance.now() + 500;
    return planet;
  }

  get currentPlanet() {
    return PLANETS[this.currentIndex];
  }

  update(now, dt) {
    this.planetMesh.rotation.y += dt * 0.00006;
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
    this.ringMesh.geometry.dispose();
    this.ringMesh.material.dispose();
    this.ringTexture.dispose();
    for (const t of this.textures) t.dispose();
  }
}
