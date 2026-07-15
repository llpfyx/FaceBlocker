import * as THREE from "three";
import { sfx } from "./audio.js";

const PITCH_MIN = THREE.MathUtils.degToRad(-70);
const PITCH_MAX = THREE.MathUtils.degToRad(80);
const MOUSE_SENS = 0.0022;
const TOUCH_SENS = 0.006;
const GYRO_SENS = 1.0;

function isTouchDevice() {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

function phaseTint(phase) {
  if (phase <= 2) return 0xffffff;
  if (phase <= 4) return 0xffc4c4;
  if (phase <= 6) return 0xff7a7a;
  return 0x9c2a2a;
}

function normalizeAngleDeltaDeg(a) {
  return ((a + 540) % 360) - 180;
}

export class Game {
  /**
   * @param {Object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {string} opts.faceDataURL
   * @param {Object} opts.dom - HUD/DOM refs: hpBar, phaseLabel, score, kills, combo, hitFlash, crosshair, mobileFireBtn, orientationPrompt, gyroBtn
   * @param {(result:{score:number, phase:number, kills:number}) => void} opts.onGameOver
   */
  constructor({ canvas, faceDataURL, dom, onGameOver }) {
    this.canvas = canvas;
    this.dom = dom;
    this.onGameOver = onGameOver;

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.rotation.order = "YXZ";

    this.yaw = 0;
    this.pitch = 0;

    this.enemies = [];
    this.faceTexture = null;

    this.player = { hp: 100, maxHp: 100 };
    this.stats = { score: 0, kills: 0, combo: 0, phase: 1, nextPhaseAt: 5 };

    this.running = false;
    this.spawnTimer = 0;
    this.lastTime = 0;

    this._touchLook = null; // active look-drag touch id
    this._gyroActive = false;
    this._gyroBase = null;
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
      this._gyroBase = null;
      this.dom.orientationPrompt.classList.add("hidden");
    } catch (e) {
      // gyro unavailable — fall back silently to touch-drag look
    }
  }

  _onDeviceOrientation(e) {
    if (e.alpha == null || e.beta == null) return;
    if (!this._gyroBase) {
      this._gyroBase = { alpha: e.alpha, beta: e.beta };
      return;
    }
    const dYaw = normalizeAngleDeltaDeg(e.alpha - this._gyroBase.alpha);
    const dPitch = e.beta - this._gyroBase.beta;
    this.yaw = THREE.MathUtils.degToRad(-dYaw) * GYRO_SENS;
    this.pitch = THREE.MathUtils.clamp(THREE.MathUtils.degToRad(dPitch) * GYRO_SENS, PITCH_MIN, PITCH_MAX);
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
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    this._updateHud();
    requestAnimationFrame(this._loop);
  }

  destroy() {
    this.running = false;
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

    let hpBar = null;
    if (ps.maxHp > 1) {
      hpBar = this._makeHpBarSprite();
      hpBar.position.set(0, 0.85, 0);
      group.add(hpBar.sprite);
    }

    this.scene.add(group);

    const enemy = {
      group,
      sprite,
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
    sfx.kill();
    this.stats.kills += 1;
    this.stats.combo += 1;
    const comboMult = 1 + Math.min(this.stats.combo, 20) * 0.1;
    this.stats.score += Math.round(100 * this.stats.phase * comboMult);
    this._maybeAdvancePhase();
    this.scene.remove(enemy.group);
    this.enemies = this.enemies.filter((e) => e !== enemy);
    this._updateHud();
  }

  _maybeAdvancePhase() {
    if (this.stats.kills < this.stats.nextPhaseAt) return;
    this.stats.phase += 1;
    this.stats.nextPhaseAt += 5 + (this.stats.phase - 1) * 2;
    sfx.phaseUp();
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
      if (enemy.hpBar) enemy.hpBar.sprite.position.set(0, 0.75 * scale, 0);
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
    const dt = Math.min(64, now - this.lastTime);
    this.lastTime = now;

    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    this._maybeSpawn(dt);
    this._updateEnemies(now);
    this._updateHud();

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._loop);
  }
}
