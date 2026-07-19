import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { sfx, battleMusic } from "./audio.js";
import { SpaceBackdrop, PLANETS } from "./space.js";
import { createHelmetTextures, helmetTierForPhase, loadTopHelmetModel } from "./helmets.js";

const PITCH_MIN = THREE.MathUtils.degToRad(-70);
const PITCH_MAX = THREE.MathUtils.degToRad(80);
const MOUSE_SENS = 0.0022;
const TOUCH_SENS = 0.006;
const GYRO_SENS = 2.6;
const GYRO_SMOOTHING = 18; // higher = snappier tracking of the gyro target

function isTouchDevice() {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

// The camera's *vertical* FOV is fixed, but the visible *horizontal* FOV
// depends on the viewport's aspect ratio — a tall phone screen in portrait
// sees a much narrower horizontal slice than a wide PC window at the same
// vertical FOV. "In front of the player" has to be measured against that
// actual visible width, or a cone tuned for a PC's wide view spawns enemies
// off the edge of a phone screen — the exact bug reported ("stage 1 enemies
// aren't really in front on my phone").
function horizontalHalfFovRad(camera) {
  const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
  return Math.atan(Math.tan(vHalf) * camera.aspect);
}

// Stage 1-2: enemies stay within (a fraction of) the player's actual visible
// width, so "in front" always means "on screen" regardless of device.
// Stage 3 onward: the cone widens *gradually* bar by bar, reaching the full
// surrounding sphere right as Pluto (the last planet) is reached — so the
// whole journey from Earth to Pluto is one smooth difficulty ramp, not a
// sudden jump. It stays fully open for the endless post-Pluto galaxy stage.
function spawnYawHalfRange(phase, camera) {
  const halfFov = horizontalHalfFovRad(camera);
  if (phase <= 1) return halfFov * 0.7;
  if (phase === 2) return halfFov * 1.0;
  const t = THREE.MathUtils.clamp((phase - 3) / 6, 0, 1); // phase 3 -> phase 9 (Pluto)
  return THREE.MathUtils.lerp(halfFov * 1.3, Math.PI, t);
}

function phaseTint(phase) {
  if (phase <= 2) return 0xffffff;
  if (phase <= 4) return 0xffc4c4;
  if (phase <= 6) return 0xff7a7a;
  return 0x9c2a2a;
}

function cssColor(hex) {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

// Soft radial ring (transparent center + edges, bright band in between) used
// as an expanding shockwave sprite on kill, for an actual "explosion" read
// instead of just scattering particles.
function makeShockwaveTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  const grad = ctx.createRadialGradient(cx, cy, size * 0.26, cx, cy, size * 0.5);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.78, "rgba(255,255,255,0.3)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------- device-orientation -> quaternion (full 360deg, any device tilt) ----------
// Same math as three.js's own DeviceOrientationControls reference implementation:
// naively treating `alpha` as yaw breaks down once the phone is tilted away from flat
// (the normal way you hold it to "look around"), so we build a proper rotation
// quaternion from alpha/beta/gamma + current screen angle instead.
const GYRO_ZEE = new THREE.Vector3(0, 0, 1);
const GYRO_Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90deg around X
const _gyroEuler = new THREE.Euler();
const _gyroQuat = new THREE.Quaternion();
const _gyroScreenQuat = new THREE.Quaternion();
const _gyroDeltaQuat = new THREE.Quaternion();
const _gyroOutEuler = new THREE.Euler();

function deviceOrientationToQuaternion(alpha, beta, gamma, screenAngleDeg, target) {
  _gyroEuler.set(
    THREE.MathUtils.degToRad(beta),
    THREE.MathUtils.degToRad(alpha),
    THREE.MathUtils.degToRad(-gamma),
    "YXZ"
  );
  target.setFromEuler(_gyroEuler);
  target.multiply(GYRO_Q1); // camera looks out the back of the device, not the top
  target.multiply(_gyroScreenQuat.setFromAxisAngle(GYRO_ZEE, -THREE.MathUtils.degToRad(screenAngleDeg)));
  return target;
}

function currentScreenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === "number") return screen.orientation.angle;
  if (typeof window.orientation === "number") return window.orientation;
  return 0;
}

export class Game {
  /**
   * @param {Object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {string} opts.faceDataURL
   * @param {Object} opts.dom - HUD/DOM refs: hpBar, phaseLabel, planetLabel, score, kills, combo, hitFlash, mobileFireBtn, orientationPrompt, gyroBtn, gyroSkipBtn
   * @param {(result:{score:number, phase:number, kills:number}) => void} opts.onGameOver
   */
  constructor({ canvas, faceDataURL, dom, onGameOver }) {
    this.canvas = canvas;
    this.dom = dom;
    this.onGameOver = onGameOver;

    // antialias is skipped: once post-processing renders to an intermediate
    // texture, the canvas context's own MSAA no longer does anything useful
    // for the final image, it just costs GPU time.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.rotation.order = "YXZ";

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Bloom is by far the most expensive part of the pipeline (multi-pass
    // blur), so it runs at a fraction of screen resolution — bloom is a soft
    // blurred glow anyway, so the lower internal res is barely noticeable.
    this._bloomScale = 0.5;
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth * this._bloomScale, window.innerHeight * this._bloomScale),
      0.5, // strength
      0.5, // radius
      0.3 // threshold
    );
    this.composer.addPass(this.bloomPass);
    this._perfCheckDone = false;
    this._perfFrameCount = 0;
    this._perfTimeTotal = 0;

    this.space = new SpaceBackdrop(this.scene);
    this.dom.planetLabel.textContent = this.space.currentPlanet.name;

    this.yaw = 0;
    this.pitch = 0;

    this.enemies = [];
    this.faceTexture = null;
    this.helmetTextures = createHelmetTextures();
    this.topHelmetModel = null;
    loadTopHelmetModel()
      .then((model) => {
        this.topHelmetModel = model;
      })
      .catch((err) => {
        console.warn("[Game] tier-3 helmet model failed to load, falling back to the flat sprite:", err);
      });
    this._markerEls = new Map();
    this._bursts = [];
    this._shockwaveTexture = makeShockwaveTexture();
    this._shockwaves = [];
    this._shakeUntil = 0;
    this._shakeMagnitude = 0;
    this._shakeDuration = 1;

    this.player = { hp: 100, maxHp: 100 };
    this.stats = { score: 0, kills: 0, combo: 0, phase: 1, nextPhaseAt: 5 };

    this.running = false;
    this.spawnTimer = 0;
    this.lastTime = 0;

    this._touchLook = null; // active look-drag touch id
    this._gyroActive = false;
    this._gyroPrevQuat = null;
    this._gyroTargetYaw = 0;
    this._gyroTargetPitch = 0;
    this._gyroUnwrappedYaw = 0;
    this._gyroAccumPitch = 0;
    this._pointerLocked = false;

    this._onResize = this._onResize.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onCanvasDown = this._onCanvasDown.bind(this);
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);
    this._onDeviceOrientation = this._onDeviceOrientation.bind(this);
    this._onFireBtn = this._onFireBtn.bind(this);
    this._loop = this._loop.bind(this);

    this._loadFaceTexture(faceDataURL);
    this._setupControls();

    // Warm up shader compilation (bloom's mip-chain shaders in particular
    // are expensive to compile) right now, synchronously, instead of during
    // the first real gameplay frames — otherwise that one-time stall gets
    // measured as "sustained slowness" by the perf check below and bloom
    // gets disabled even on hardware that runs it perfectly fine.
    this.composer.render();
  }

  _loadFaceTexture(dataURL) {
    const img = new Image();
    img.onload = () => {
      this.faceTexture = new THREE.Texture(img);
      this.faceTexture.needsUpdate = true;
      this.faceTexture.colorSpace = THREE.SRGBColorSpace;
    };
    img.src = dataURL;
  }

  _setupControls() {
    window.addEventListener("resize", this._onResize);

    if (isTouchDevice()) {
      this.dom.mobileFireBtn.classList.remove("hidden");
      this.dom.mobileFireBtn.addEventListener("pointerdown", this._onFireBtn);
      this.canvas.addEventListener("touchstart", this._onTouchStart, { passive: true });
      this.canvas.addEventListener("touchmove", this._onTouchMove, { passive: true });
      this.canvas.addEventListener("touchend", this._onTouchEnd, { passive: true });

      if (window.DeviceOrientationEvent) {
        this.dom.orientationPrompt.classList.remove("hidden");
        this.dom.gyroBtn.onclick = () => this._requestGyro();
        this.dom.gyroSkipBtn.onclick = () => this.dom.orientationPrompt.classList.add("hidden");
      }
    } else {
      this.canvas.addEventListener("mousedown", this._onCanvasDown);
      document.addEventListener("mousemove", this._onMouseMove);
      document.addEventListener("pointerlockchange", () => {
        this._pointerLocked = document.pointerLockElement === this.canvas;
      });
    }
  }

  async _requestGyro() {
    try {
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== "granted") return;
      }
      window.addEventListener("deviceorientation", this._onDeviceOrientation);
      this._gyroActive = true;
      this._gyroPrevQuat = null;
      this._gyroUnwrappedYaw = 0;
      this._gyroAccumPitch = 0;
      this.dom.orientationPrompt.classList.add("hidden");
    } catch (e) {
      // gyro unavailable — fall back silently to touch-drag look
    }
  }

  // Tracks orientation via the *incremental* rotation between consecutive
  // sensor readings (not a single large rotation relative to a fixed
  // calibration point). Decomposing a big relative rotation into Euler
  // angles is exactly what breaks down once the player has spun all the
  // way around — the decomposition can land on a different, equally valid
  // but "wrong-feeling" (yaw, pitch) combination. A frame-to-frame delta is
  // always a small rotation, which Euler decomposition handles reliably, so
  // accumulating many small deltas stays correct no matter how many times
  // the player turns around or which direction they move.
  _onDeviceOrientation(e) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const screenAngle = currentScreenAngle();
    deviceOrientationToQuaternion(e.alpha, e.beta, e.gamma, screenAngle, _gyroQuat);

    if (!this._gyroPrevQuat) {
      this._gyroPrevQuat = _gyroQuat.clone();
      return;
    }

    _gyroDeltaQuat.copy(this._gyroPrevQuat).invert().multiply(_gyroQuat);
    _gyroOutEuler.setFromQuaternion(_gyroDeltaQuat, "YXZ");
    this._gyroPrevQuat.copy(_gyroQuat);

    this._gyroUnwrappedYaw += _gyroOutEuler.y;
    // clamp the accumulator itself (not just the derived target) so looking
    // past the pitch limit doesn't make the view "stick" once you look back
    // — otherwise the accumulated value would have to unwind the overshoot
    // first.
    this._gyroAccumPitch = THREE.MathUtils.clamp(
      this._gyroAccumPitch + _gyroOutEuler.x,
      PITCH_MIN / GYRO_SENS,
      PITCH_MAX / GYRO_SENS
    );

    this._gyroTargetYaw = this._gyroUnwrappedYaw * GYRO_SENS;
    this._gyroTargetPitch = this._gyroAccumPitch * GYRO_SENS;
  }

  _onCanvasDown() {
    if (!this._pointerLocked) {
      this.canvas.requestPointerLock();
      return;
    }
    this._fire();
  }

  _onMouseMove(e) {
    if (!this._pointerLocked) return;
    this.yaw -= e.movementX * MOUSE_SENS;
    this.pitch -= e.movementY * MOUSE_SENS;
    this.pitch = THREE.MathUtils.clamp(this.pitch, PITCH_MIN, PITCH_MAX);
  }

  _onTouchStart(e) {
    if (this._gyroActive) return;
    const t = e.changedTouches[0];
    this._touchLook = { id: t.identifier, x: t.clientX, y: t.clientY };
  }

  _onTouchMove(e) {
    if (this._gyroActive || !this._touchLook) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== this._touchLook.id) continue;
      const dx = t.clientX - this._touchLook.x;
      const dy = t.clientY - this._touchLook.y;
      this.yaw -= dx * TOUCH_SENS;
      this.pitch -= dy * TOUCH_SENS;
      this.pitch = THREE.MathUtils.clamp(this.pitch, PITCH_MIN, PITCH_MAX);
      this._touchLook.x = t.clientX;
      this._touchLook.y = t.clientY;
    }
  }

  _onTouchEnd(e) {
    if (this._touchLook && [...e.changedTouches].some((t) => t.identifier === this._touchLook.id)) {
      this._touchLook = null;
    }
  }

  _onFireBtn(e) {
    e.preventDefault();
    this._fire();
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.bloomPass.resolution.set(window.innerWidth * this._bloomScale, window.innerHeight * this._bloomScale);
  }

  // Bloom (UnrealBloomPass) is by far the heaviest part of the render
  // pipeline. On weak/software-rendered GPUs it can tank the frame rate
  // enough to make the game feel sluggish (worse: it slows down gameplay
  // pacing too, since dt is capped at 64ms per frame). Playability matters
  // far more than the glow, so auto-disable bloom if the first couple
  // seconds are running well under 30fps.
  _trackPerf(rawDt) {
    if (this._perfCheckDone || rawDt <= 0) return;
    this._perfFrameCount++;
    this._perfTimeTotal += rawDt;
    // React based on elapsed wall-clock time, not frame count — on a slow
    // device frames arrive rarely, so waiting for a fixed frame count would
    // take far too long to kick in on exactly the devices that need it fast.
    if (this._perfTimeTotal < 1200) return;
    this._perfCheckDone = true;
    const avgFrameMs = this._perfTimeTotal / this._perfFrameCount;
    if (avgFrameMs > 33) {
      this.composer.passes = this.composer.passes.filter((p) => p !== this.bloomPass);
    }
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    this._updateHud();
    battleMusic.start();
    requestAnimationFrame(this._loop);
  }

  destroy() {
    this.running = false;
    battleMusic.stop();
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("deviceorientation", this._onDeviceOrientation);
    document.removeEventListener("mousemove", this._onMouseMove);
    this.canvas.removeEventListener("mousedown", this._onCanvasDown);
    this.canvas.removeEventListener("touchstart", this._onTouchStart);
    this.canvas.removeEventListener("touchmove", this._onTouchMove);
    this.canvas.removeEventListener("touchend", this._onTouchEnd);
    this.dom.mobileFireBtn.removeEventListener("pointerdown", this._onFireBtn);
    this.dom.mobileFireBtn.classList.add("hidden");
    this.dom.orientationPrompt.classList.add("hidden");
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    for (const en of this.enemies) this.scene.remove(en.group);
    this.enemies = [];
    for (const el of this._markerEls.values()) el.remove();
    this._markerEls.clear();
    for (const b of this._bursts) {
      this.scene.remove(b.points);
      b.points.geometry.dispose();
      b.points.material.dispose();
    }
    this._bursts = [];
    for (const s of this._shockwaves) {
      this.scene.remove(s.sprite);
      s.sprite.material.dispose();
    }
    this._shockwaves = [];
    this._shockwaveTexture.dispose();
    this.dom.scorePopups.innerHTML = "";
    for (const t of this.helmetTextures) t.dispose();
    if (this.topHelmetModel) {
      this.topHelmetModel.traverse((obj) => {
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
    }
    this.space.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ---------- enemy spawning / phase scaling ----------

  _phaseStats() {
    const phase = this._effectivePhase();
    return {
      maxHp: Math.ceil(phase / 2),
      attackDamage: 6 + phase * 2,
      spawnIntervalMs: Math.max(450, 1400 - phase * 80),
      maxConcurrent: Math.min(7, 2 + Math.floor(phase / 2)),
      lifespanMs: Math.max(1400, 3400 - phase * 120),
    };
  }

  _maybeSpawn(dt) {
    const ps = this._phaseStats();
    this.spawnTimer += dt;
    if (this.spawnTimer < ps.spawnIntervalMs) return;
    if (this.enemies.length >= ps.maxConcurrent) return;
    this.spawnTimer = 0;
    this._spawnEnemy(ps);
  }

  _spawnEnemy(ps) {
    if (!this.faceTexture) return;
    const effPhase = this._effectivePhase();
    const halfRange = spawnYawHalfRange(effPhase, this.camera);
    const yaw = this.yaw + (Math.random() * 2 - 1) * halfRange;
    const pitch = THREE.MathUtils.degToRad(-15 + Math.random() * 55);
    const startRadius = 8 + Math.random() * 5;
    const evasive = effPhase >= 3;

    const material = new THREE.SpriteMaterial({
      map: this.faceTexture,
      color: phaseTint(effPhase),
      transparent: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.01, 0.01, 1);

    const group = new THREE.Group();
    group.add(sprite);

    const helmetTier = helmetTierForPhase(effPhase);
    const useTopModel = helmetTier === 3 && !!this.topHelmetModel;
    let helmetSprite;
    let helmetBaseScale = 1;
    if (useTopModel) {
      helmetSprite = this.topHelmetModel.clone(true);
      helmetBaseScale = helmetSprite.scale.x; // preserve the baked-in model scale
    } else {
      helmetSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.helmetTextures[helmetTier], transparent: true, depthTest: false })
      );
      helmetSprite.renderOrder = 2; // always paint on top of the face sprite
    }
    helmetSprite.scale.set(0.01, 0.01, 0.01);
    group.add(helmetSprite);

    let hpBar = null;
    if (ps.maxHp > 1) {
      hpBar = this._makeHpBarSprite();
      hpBar.sprite.position.set(0, 0.85, 0);
      hpBar.sprite.renderOrder = 3;
      group.add(hpBar.sprite);
    }

    this.scene.add(group);

    const enemy = {
      group,
      sprite,
      helmetSprite,
      helmetIs3D: useTopModel,
      helmetBaseScale,
      hpBar,
      hp: ps.maxHp,
      maxHp: ps.maxHp,
      attackDamage: ps.attackDamage,
      yaw,
      pitch,
      evasive,
      startRadius,
      endRadius: 2.8,
      spawnAt: performance.now(),
      lifespan: ps.lifespanMs,
      seed: Math.random() * 1000,
      dead: false,
      hitFlashUntil: 0,
    };
    this.enemies.push(enemy);
    if (hpBar) this._redrawHpBar(enemy);
  }

  _makeHpBarSprite() {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 10;
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.5, 0.08, 1);
    return { sprite, canvas, tex };
  }

  _redrawHpBar(enemy) {
    if (!enemy.hpBar) return;
    const { canvas, tex } = enemy.hpBar;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const frac = Math.max(0, enemy.hp / enemy.maxHp);
    ctx.fillStyle = frac > 0.5 ? "#4ade80" : frac > 0.25 ? "#fbbf24" : "#ef4444";
    ctx.fillRect(2, 2, (canvas.width - 4) * frac, canvas.height - 4);
    tex.needsUpdate = true;
  }

  // ---------- shooting ----------

  _fire() {
    if (!this.running) return;
    sfx.shoot();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const sprites = this.enemies.filter((e) => !e.dead).map((e) => e.sprite);
    const hits = raycaster.intersectObjects(sprites, false);
    if (hits.length === 0) return;
    const hitSprite = hits[0].object;
    const enemy = this.enemies.find((e) => e.sprite === hitSprite);
    if (!enemy || enemy.dead) return;
    this._damageEnemy(enemy);
  }

  _damageEnemy(enemy) {
    enemy.hp -= 1;
    enemy.hitFlashUntil = performance.now() + 90;
    if (enemy.hp <= 0) {
      this._killEnemy(enemy);
    } else {
      sfx.hit();
      this._spawnHitSpark(enemy.group.position.clone(), phaseTint(this._effectivePhase()));
      this._redrawHpBar(enemy);
    }
  }

  _killEnemy(enemy) {
    enemy.dead = true;
    this.stats.kills += 1;
    this.stats.combo += 1;
    const comboMult = 1 + Math.min(this.stats.combo, 20) * 0.1;
    const gained = Math.round(100 * this._effectivePhase() * comboMult);
    this.stats.score += gained;

    const milestone = this.stats.combo > 0 && this.stats.combo % 5 === 0;
    sfx.kill(this.stats.combo);
    if (milestone) sfx.comboMilestone();

    const pos = enemy.group.position.clone();
    this._spawnKillBurst(pos, phaseTint(this._effectivePhase()), milestone);
    this._spawnShockwave(pos, phaseTint(this._effectivePhase()), milestone);
    this._spawnScorePopup(pos, `+${gained.toLocaleString()}`, milestone);
    this._triggerShake(milestone ? 0.075 : 0.04, milestone ? 280 : 170);

    this._maybeAdvancePhase();
    this.scene.remove(enemy.group);
    this.enemies = this.enemies.filter((e) => e !== enemy);
    this._updateHud();
  }

  // ---------- kill "juice": explosion particles/shockwave, hit sparks, floating score, screen shake ----------

  _spawnKillBurst(position, tintHex, big) {
    const count = big ? 70 : 40;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const tintColor = new THREE.Color(tintHex);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const speed = 3 + Math.random() * (big ? 7.5 : 5.5);
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      velocities[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
      velocities[i * 3 + 2] = Math.cos(phi) * speed;
      // white-hot core fading to the phase-tint embers, like a real explosion
      const hot = Math.random();
      if (hot < 0.35) {
        colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = 1;
      } else if (hot < 0.7) {
        colors[i * 3] = 1;
        colors[i * 3 + 1] = 0.7 + Math.random() * 0.3;
        colors[i * 3 + 2] = 0.25;
      } else {
        colors[i * 3] = tintColor.r;
        colors[i * 3 + 1] = tintColor.g;
        colors[i * 3 + 2] = tintColor.b;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: big ? 0.4 : 0.26,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.position.copy(position);
    this.scene.add(points);
    this._bursts.push({ points, velocities, spawnAt: performance.now(), duration: big ? 800 : 520 });
  }

  // A handful of quick sparks on a non-lethal hit — much smaller than a kill
  // explosion, just enough impact feedback that shots feel like they connect.
  _spawnHitSpark(position, tintHex) {
    const count = 8;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const tintColor = new THREE.Color(tintHex);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const speed = 1.2 + Math.random() * 1.8;
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      velocities[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
      velocities[i * 3 + 2] = Math.cos(phi) * speed;
      const white = Math.random() < 0.6;
      colors[i * 3] = white ? 1 : tintColor.r;
      colors[i * 3 + 1] = white ? 1 : tintColor.g;
      colors[i * 3 + 2] = white ? 1 : tintColor.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.14,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.position.copy(position);
    this.scene.add(points);
    this._bursts.push({ points, velocities, spawnAt: performance.now(), duration: 200 });
  }

  _spawnShockwave(position, tintHex, big) {
    const mat = new THREE.SpriteMaterial({
      map: this._shockwaveTexture,
      color: tintHex,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(position);
    sprite.scale.set(0.25, 0.25, 1);
    sprite.renderOrder = 4;
    this.scene.add(sprite);
    this._shockwaves.push({
      sprite,
      spawnAt: performance.now(),
      duration: big ? 520 : 400,
      maxScale: big ? 6.5 : 4.5,
    });
  }

  _updateShockwaves(now) {
    for (const s of [...this._shockwaves]) {
      const t = (now - s.spawnAt) / s.duration;
      if (t >= 1) {
        this.scene.remove(s.sprite);
        s.sprite.material.dispose();
        this._shockwaves = this._shockwaves.filter((x) => x !== s);
        continue;
      }
      const eased = 1 - Math.pow(1 - t, 3);
      const scale = THREE.MathUtils.lerp(0.25, s.maxScale, eased);
      s.sprite.scale.set(scale, scale, 1);
      s.sprite.material.opacity = 1 - t;
    }
  }

  _updateBursts(now) {
    for (const b of [...this._bursts]) {
      const elapsed = now - b.spawnAt;
      const t = elapsed / b.duration;
      if (t >= 1) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        b.points.material.dispose();
        this._bursts = this._bursts.filter((x) => x !== b);
        continue;
      }
      const elapsedSec = elapsed / 1000;
      const pos = b.points.geometry.attributes.position;
      for (let i = 0; i < b.velocities.length / 3; i++) {
        pos.array[i * 3] = b.velocities[i * 3] * elapsedSec;
        pos.array[i * 3 + 1] = b.velocities[i * 3 + 1] * elapsedSec - 1.6 * elapsedSec * elapsedSec;
        pos.array[i * 3 + 2] = b.velocities[i * 3 + 2] * elapsedSec;
      }
      pos.needsUpdate = true;
      b.points.material.opacity = 1 - t;
    }
  }

  _spawnScorePopup(worldPos, text, big) {
    const ndc = worldPos.clone().project(this.camera);
    if (ndc.z > 1) return; // kill point ended up behind the camera — skip, rare
    const x = (ndc.x * 0.5 + 0.5) * window.innerWidth;
    const y = (1 - (ndc.y * 0.5 + 0.5)) * window.innerHeight;
    const el = document.createElement("div");
    el.className = big ? "score-popup big" : "score-popup";
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.dom.scorePopups.appendChild(el);
    requestAnimationFrame(() => el.classList.add("rise"));
    setTimeout(() => el.remove(), 800);
  }

  _triggerShake(magnitude, durationMs) {
    this._shakeUntil = performance.now() + durationMs;
    this._shakeMagnitude = magnitude;
    this._shakeDuration = durationMs;
  }

  // Once Pluto (the 9th/last planet) is cleared, the phase counter stops
  // driving difficulty via kills — the galaxy stage is endless, so instead
  // difficulty creeps up gradually every 1000 score points (the user's
  // explicit spec), read by _effectivePhase().
  _maybeAdvancePhase() {
    if (this._galaxyModeActive) return;
    if (this.stats.kills < this.stats.nextPhaseAt) return;
    this.stats.phase += 1;
    this.stats.nextPhaseAt += 5 + (this.stats.phase - 1) * 2;
    sfx.phaseUp();
    if (this.stats.phase - 1 < PLANETS.length) {
      const planet = this.space.setPlanetIndex(this.stats.phase - 1);
      this.dom.planetLabel.textContent = planet.name;
    } else {
      this._galaxyModeActive = true;
      const galaxy = this.space.setGalaxyMode();
      this.dom.planetLabel.textContent = galaxy.name;
    }
  }

  // The difficulty-scaling "phase" used by combat tuning: identical to the
  // real kill-based phase while journeying through the planets, but once the
  // galaxy stage begins it keeps climbing with score instead (every 1000
  // points = +1 effective phase), since kills-to-next-phase no longer fires.
  _effectivePhase() {
    if (!this._galaxyModeActive) return this.stats.phase;
    return this.stats.phase + Math.floor(this.stats.score / 1000);
  }

  _enemyAttacks(enemy) {
    this.player.hp = Math.max(0, this.player.hp - enemy.attackDamage);
    this.stats.combo = 0;
    sfx.enemyAttack();
    this._flashHit();
    this.scene.remove(enemy.group);
    this.enemies = this.enemies.filter((e) => e !== enemy);
    this._updateHud();
    if (this.player.hp <= 0) this._gameOver();
  }

  _flashHit() {
    const el = this.dom.hitFlash;
    el.classList.remove("hidden");
    // restart CSS animation
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => el.classList.add("hidden"), 350);
  }

  _gameOver() {
    this.running = false;
    sfx.gameOver();
    this.onGameOver({ score: this.stats.score, phase: this.stats.phase, kills: this.stats.kills });
  }

  // ---------- update loop ----------

  _updateEnemies(now) {
    for (const enemy of [...this.enemies]) {
      const elapsed = now - enemy.spawnAt;
      const t = THREE.MathUtils.clamp(elapsed / enemy.lifespan, 0, 1);

      if (t >= 1) {
        this._enemyAttacks(enemy);
        continue;
      }

      const spawnScale = Math.min(1, elapsed / 150);
      const radius = THREE.MathUtils.lerp(enemy.startRadius, enemy.endRadius, t);
      const bob = Math.sin(now * 0.003 + enemy.seed) * 0.03;
      const pitch = enemy.pitch + bob;
      // From stage 3 on, enemies periodically drift side-to-side (and, combined
      // with the vertical bob above, diagonally) to make them harder to track.
      const yaw = enemy.evasive ? enemy.yaw + Math.sin(now * 0.0021 + enemy.seed * 1.6) * 0.09 : enemy.yaw;

      const x = radius * Math.cos(pitch) * Math.sin(yaw);
      const y = radius * Math.sin(pitch);
      const z = -radius * Math.cos(pitch) * Math.cos(yaw);
      enemy.group.position.set(x, y, z);
      enemy.group.lookAt(this.camera.position);

      const hitPulse = now < enemy.hitFlashUntil ? 1.3 : 1;
      const approachScale = THREE.MathUtils.lerp(1.0, 2.2, t);
      const scale = spawnScale * approachScale * hitPulse;
      enemy.sprite.scale.set(scale, scale, 1);
      if (enemy.helmetIs3D) {
        // the real model's own baked-in scale (from loadTopHelmetModel) is
        // preserved as a multiplier — only the grow-in animation is added here.
        enemy.helmetSprite.scale.setScalar(scale * enemy.helmetBaseScale);
        enemy.helmetSprite.position.set(0, scale * 0.42, scale * 0.05);
      } else {
        enemy.helmetSprite.scale.set(scale * 1.08, scale * 1.08, 1);
        enemy.helmetSprite.position.set(0, scale * 0.2, 0.001);
      }
      if (enemy.hpBar) enemy.hpBar.sprite.position.set(0, 0.75 * scale, 0);
    }
  }

  _updateEnemyMarkers() {
    const seen = new Set();
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const margin = 0.92;

    for (const enemy of this.enemies) {
      seen.add(enemy);
      const worldPos = enemy.group.position;
      const toPoint = worldPos.clone().sub(this.camera.position);
      const behind = toPoint.dot(camDir) < 0;

      const ndc = worldPos.clone().project(this.camera);
      if (behind) {
        ndc.x = -ndc.x;
        ndc.y = -ndc.y;
      }
      const onScreen = !behind && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;

      let el = this._markerEls.get(enemy);
      if (onScreen) {
        if (el) el.style.display = "none";
        continue;
      }
      if (!el) {
        el = document.createElement("div");
        el.className = "enemy-marker";
        this.dom.enemyMarkers.appendChild(el);
        this._markerEls.set(enemy, el);
      }
      el.style.display = "block";

      const maxAbs = Math.max(Math.abs(ndc.x), Math.abs(ndc.y)) || 1e-6;
      const scale = margin / maxAbs;
      const ex = ndc.x * scale;
      const ey = ndc.y * scale;
      const screenX = (ex * 0.5 + 0.5) * w;
      const screenY = (1 - (ey * 0.5 + 0.5)) * h;
      const angleDeg = (Math.atan2(-ey, ex) * 180) / Math.PI;

      el.style.left = `${screenX}px`;
      el.style.top = `${screenY}px`;
      el.style.transform = `translate(-30%, -50%) rotate(${angleDeg}deg)`;
      el.style.borderColor = `transparent transparent transparent ${cssColor(phaseTint(this._effectivePhase()))}`;
    }

    for (const [enemy, el] of this._markerEls) {
      if (!seen.has(enemy)) {
        el.remove();
        this._markerEls.delete(enemy);
      }
    }
  }

  _updateHud() {
    const { dom, player, stats } = this;
    const frac = Math.max(0, player.hp / player.maxHp);
    dom.hpBar.style.width = `${frac * 100}%`;
    dom.hpBar.style.background =
      frac > 0.5
        ? "linear-gradient(90deg,#4ade80,#a3e635)"
        : frac > 0.25
        ? "linear-gradient(90deg,#fbbf24,#f59e0b)"
        : "linear-gradient(90deg,#ef4444,#b91c1c)";
    dom.phaseLabel.textContent = `PHASE ${stats.phase}`;
    dom.score.textContent = stats.score.toLocaleString();
    dom.kills.textContent = stats.kills;
    dom.combo.textContent = stats.combo;
  }

  _loop(now) {
    if (!this.running) return;
    // Schedule the next frame first so a transient error below can never
    // permanently freeze the game (rAF wouldn't get re-armed otherwise).
    requestAnimationFrame(this._loop);

    try {
      const rawDt = now - this.lastTime;
      const dt = Math.min(64, rawDt);
      this.lastTime = now;
      this._trackPerf(rawDt);

      if (this._gyroActive) {
        const k = 1 - Math.exp(-GYRO_SMOOTHING * (dt / 1000));
        this.yaw += (this._gyroTargetYaw - this.yaw) * k;
        this.pitch += (this._gyroTargetPitch - this.pitch) * k;
      }
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
      if (now < this._shakeUntil) {
        const remaining = (this._shakeUntil - now) / this._shakeDuration;
        const mag = this._shakeMagnitude * remaining;
        this.camera.rotation.y += (Math.random() - 0.5) * mag;
        this.camera.rotation.x += (Math.random() - 0.5) * mag;
      }

      this._maybeSpawn(dt);
      this._updateEnemies(now);
      this._updateEnemyMarkers();
      this._updateBursts(now);
      this._updateShockwaves(now);
      this._updateHud();
      this.space.update(now, dt);

      this.composer.render();
    } catch (err) {
      console.error("[Game] frame error (recovered):", err);
    }
  }
}
