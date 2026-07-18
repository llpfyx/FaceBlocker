import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { sfx, battleMusic } from "./audio.js";
import { SpaceBackdrop } from "./space.js";
import { createHelmetTextures, helmetTierForPhase } from "./helmets.js";

const PITCH_MIN = THREE.MathUtils.degToRad(-70);
const PITCH_MAX = THREE.MathUtils.degToRad(80);
const MOUSE_SENS = 0.0022;
const TOUCH_SENS = 0.006;
const GYRO_SENS = 2.6;
const GYRO_SMOOTHING = 18; // higher = snappier tracking of the gyro target

function isTouchDevice() {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
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
const _gyroRelQuat = new THREE.Quaternion();
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
    this._markerEls = new Map();
    this._bursts = [];
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
    this._gyroBaseQuatInverse = null;
    this._gyroTargetYaw = 0;
    this._gyroTargetPitch = 0;
    this._gyroUnwrappedYaw = 0;
    this._gyroLastRawYawRad = null;
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
      this._gyroBaseQuatInverse = null;
      this._gyroUnwrappedYaw = 0;
      this._gyroLastRawYawRad = null;
      this.dom.orientationPrompt.classList.add("hidden");
    } catch (e) {
      // gyro unavailable — fall back silently to touch-drag look
    }
  }

  _onDeviceOrientation(e) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const screenAngle = currentScreenAngle();
    deviceOrientationToQuaternion(e.alpha, e.beta, e.gamma, screenAngle, _gyroQuat);

    if (!this._gyroBaseQuatInverse) {
      this._gyroBaseQuatInverse = _gyroQuat.clone().invert();
      return;
    }
    _gyroRelQuat.copy(this._gyroBaseQuatInverse).multiply(_gyroQuat);
    _gyroOutEuler.setFromQuaternion(_gyroRelQuat, "YXZ");

    // euler.y wraps at +-PI; unwrap it into a continuous angle so a full
    // physical spin (or several) tracks smoothly instead of snapping back
    // partway through — this is the actual fix for "not 360deg-capable".
    const rawYawRad = _gyroOutEuler.y;
    if (this._gyroLastRawYawRad != null) {
      let delta = rawYawRad - this._gyroLastRawYawRad;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this._gyroUnwrappedYaw += delta;
    } else {
      this._gyroUnwrappedYaw = rawYawRad;
    }
    this._gyroLastRawYawRad = rawYawRad;

    this._gyroTargetYaw = this._gyroUnwrappedYaw * GYRO_SENS;
    this._gyroTargetPitch = THREE.MathUtils.clamp(_gyroOutEuler.x * GYRO_SENS, PITCH_MIN, PITCH_MAX);
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
    this.dom.scorePopups.innerHTML = "";
    for (const t of this.helmetTextures) t.dispose();
    this.space.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ---------- enemy spawning / phase scaling ----------

  _phaseStats() {
    const phase = this.stats.phase;
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
    const yaw = Math.random() * Math.PI * 2;
    const pitch = THREE.MathUtils.degToRad(-15 + Math.random() * 55);
    const startRadius = 8 + Math.random() * 5;

    const material = new THREE.SpriteMaterial({
      map: this.faceTexture,
      color: phaseTint(this.stats.phase),
      transparent: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.01, 0.01, 1);

    const group = new THREE.Group();
    group.add(sprite);

    const helmetTex = this.helmetTextures[helmetTierForPhase(this.stats.phase)];
    const helmetSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: helmetTex, transparent: true, depthTest: false })
    );
    helmetSprite.scale.set(0.01, 0.01, 1);
    helmetSprite.renderOrder = 2; // always paint on top of the face sprite
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
      hpBar,
      hp: ps.maxHp,
      maxHp: ps.maxHp,
      attackDamage: ps.attackDamage,
      yaw,
      pitch,
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
      this._redrawHpBar(enemy);
    }
  }

  _killEnemy(enemy) {
    enemy.dead = true;
    this.stats.kills += 1;
    this.stats.combo += 1;
    const comboMult = 1 + Math.min(this.stats.combo, 20) * 0.1;
    const gained = Math.round(100 * this.stats.phase * comboMult);
    this.stats.score += gained;

    const milestone = this.stats.combo > 0 && this.stats.combo % 5 === 0;
    sfx.kill(this.stats.combo);
    if (milestone) sfx.comboMilestone();

    const pos = enemy.group.position.clone();
    this._spawnKillBurst(pos, phaseTint(this.stats.phase), milestone);
    this._spawnScorePopup(pos, `+${gained.toLocaleString()}`, milestone);
    this._triggerShake(milestone ? 0.05 : 0.022, milestone ? 260 : 140);

    this._maybeAdvancePhase();
    this.scene.remove(enemy.group);
    this.enemies = this.enemies.filter((e) => e !== enemy);
    this._updateHud();
  }

  // ---------- kill "juice": particles, floating score, screen shake ----------

  _spawnKillBurst(position, tintHex, big) {
    const count = big ? 46 : 24;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const tintColor = new THREE.Color(tintHex);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const speed = 2.2 + Math.random() * (big ? 5.5 : 3.8);
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      velocities[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
      velocities[i * 3 + 2] = Math.cos(phi) * speed;
      const sparkle = Math.random() < 0.4;
      colors[i * 3] = sparkle ? 1 : tintColor.r;
      colors[i * 3 + 1] = sparkle ? 1 : tintColor.g;
      colors[i * 3 + 2] = sparkle ? 1 : tintColor.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: big ? 0.32 : 0.2,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.position.copy(position);
    this.scene.add(points);
    this._bursts.push({ points, velocities, spawnAt: performance.now(), duration: big ? 750 : 480 });
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

  _maybeAdvancePhase() {
    if (this.stats.kills < this.stats.nextPhaseAt) return;
    this.stats.phase += 1;
    this.stats.nextPhaseAt += 5 + (this.stats.phase - 1) * 2;
    sfx.phaseUp();
    const planet = this.space.setPlanetIndex(this.stats.phase - 1);
    this.dom.planetLabel.textContent = planet.name;
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

      const x = radius * Math.cos(pitch) * Math.sin(enemy.yaw);
      const y = radius * Math.sin(pitch);
      const z = -radius * Math.cos(pitch) * Math.cos(enemy.yaw);
      enemy.group.position.set(x, y, z);
      enemy.group.lookAt(this.camera.position);

      const hitPulse = now < enemy.hitFlashUntil ? 1.3 : 1;
      const approachScale = THREE.MathUtils.lerp(1.0, 2.2, t);
      const scale = spawnScale * approachScale * hitPulse;
      enemy.sprite.scale.set(scale, scale, 1);
      enemy.helmetSprite.scale.set(scale * 1.08, scale * 1.08, 1);
      enemy.helmetSprite.position.set(0, scale * 0.2, 0.001);
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
      el.style.borderColor = `transparent transparent transparent ${cssColor(phaseTint(this.stats.phase))}`;
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
      this._updateHud();
      this.space.update(now, dt);

      this.composer.render();
    } catch (err) {
      console.error("[Game] frame error (recovered):", err);
    }
  }
}
