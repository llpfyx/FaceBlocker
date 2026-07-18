// Lightweight Three.js background for the title screen: a starfield plus a
// slowly rotating, bobbing silhouette "target" wearing the fanciest (tier 3
// kabuto) helmet, to preview what the player will eventually be fighting and
// give the title screen some real motion instead of a flat static image.
import * as THREE from "three";
import { makeStarfield } from "./space.js";
import { createHelmetTextures, loadTopHelmetModel } from "./helmets.js";

function makeSilhouetteTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, size * 0.42, size * 0.48, 0, 0, Math.PI * 2);
  ctx.clip();
  const grad = ctx.createRadialGradient(cx, cy - 20, 10, cx, cy, size * 0.55);
  grad.addColorStop(0, "#2b3350");
  grad.addColorStop(1, "#0a0d18");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
  // glowing eyes for a bit of character/mystery
  ctx.fillStyle = "#ffd23f";
  ctx.shadowColor = "#ffd23f";
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.ellipse(cx - 28, cy + 6, 9, 5, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 28, cy + 6, 9, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class TitleScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02040c);
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 0, 6.2);

    this.stars = makeStarfield();
    this.scene.add(this.stars);

    this.sun = new THREE.DirectionalLight(0xffffff, 1.2);
    this.sun.position.set(4, 3, 6);
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight(0x334466, 0.6));

    this.silhouetteTex = makeSilhouetteTexture();
    this.helmetTextures = createHelmetTextures();

    this.targetGroup = new THREE.Group();
    this.targetGroup.position.set(0, 0.35, 0);
    this.scene.add(this.targetGroup);

    const faceSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.silhouetteTex, transparent: true }));
    faceSprite.scale.set(1.3, 1.3, 1);
    this.targetGroup.add(faceSprite);

    this.helmetSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.helmetTextures[3], transparent: true, depthTest: false })
    );
    this.helmetSprite.scale.set(1.42, 1.42, 1);
    this.helmetSprite.position.set(0, 0.28, 0.01);
    this.helmetSprite.renderOrder = 2;
    this.targetGroup.add(this.helmetSprite);

    // Upgrade to the real 3D helmet model once it's loaded, swapping out the
    // flat placeholder sprite so the title screen doesn't wait on the network.
    this.topHelmetModel = null;
    loadTopHelmetModel()
      .then((model) => {
        if (!this._running) return; // screen was already left
        this.topHelmetModel = model;
        model.scale.setScalar(0.455);
        model.position.set(0, 0.546, 0.06);
        this.targetGroup.remove(this.helmetSprite);
        this.helmetSprite.material.dispose();
        this.targetGroup.add(model);
      })
      .catch(() => {
        // flat sprite placeholder stays — no hard dependency on the model
      });

    this._running = true;
    this._loop = this._loop.bind(this);
    this._onResize = this._onResize.bind(this);
    window.addEventListener("resize", this._onResize);
    requestAnimationFrame(this._loop);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _loop(now) {
    if (!this._running) return;
    requestAnimationFrame(this._loop);
    try {
      this.targetGroup.rotation.y = now * 0.00025;
      this.targetGroup.position.y = 0.35 + Math.sin(now * 0.0009) * 0.1;
      this.stars.rotation.y += 0.00003;
      this.renderer.render(this.scene, this.camera);
    } catch (err) {
      console.error("[TitleScene] frame error (recovered):", err);
    }
  }

  destroy() {
    this._running = false;
    window.removeEventListener("resize", this._onResize);
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.silhouetteTex.dispose();
    for (const t of this.helmetTextures) t.dispose();
    this.targetGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap"]) {
            if (m[key]) m[key].dispose();
          }
          m.dispose();
        }
      }
    });
    this.renderer.dispose();
  }
}
