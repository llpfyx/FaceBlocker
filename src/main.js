import { FaceCapture } from "./camera.js";
import { Game } from "./game.js";
import { TitleScene } from "./titleScene.js";
import { ranking, history } from "./ranking.js";
import { sfx } from "./audio.js";

const $ = (id) => document.getElementById(id);

const screens = {
  title: $("screen-title"),
  capture: $("screen-capture"),
  ready: $("screen-ready"),
  gameover: $("screen-gameover"),
  ranking: $("screen-ranking"),
  history: $("screen-history"),
};

function hideAllScreens() {
  for (const el of Object.values(screens)) el.classList.add("hidden");
}

let titleScene = null;
function exitTitleScene() {
  if (titleScene) {
    titleScene.destroy();
    titleScene = null;
  }
}

function showScreen(name) {
  hideAllScreens();
  screens[name].classList.remove("hidden");
  if (name === "title") {
    if (!titleScene) titleScene = new TitleScene(gameCanvas);
  } else {
    exitTitleScene();
  }
}

function isTouchDevice() {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

const gameCanvas = $("game-canvas");
const crosshair = $("crosshair");
const hud = $("hud");

const dom = {
  hpBar: $("hp-bar"),
  phaseLabel: $("phase-label"),
  planetLabel: $("planet-label"),
  score: $("hud-score"),
  kills: $("hud-kills"),
  combo: $("hud-combo"),
  hitFlash: $("hit-flash"),
  enemyMarkers: $("enemy-markers"),
  scorePopups: $("score-popups"),
  mobileFireBtn: $("mobile-fire-btn"),
  orientationPrompt: $("orientation-permission"),
  gyroBtn: $("btn-enable-gyro"),
  gyroSkipBtn: $("btn-skip-gyro"),
};

const faceCapture = new FaceCapture({
  stageEl: $("capture-stage"),
  videoEl: $("capture-video"),
  canvasEl: $("capture-canvas"),
  imgEl: $("capture-img"),
  overlayEl: $("crop-overlay"),
  boxEl: $("crop-box"),
});

let faceDataURL = null;
let currentGame = null;
let rankingReturnTo = "title";
let lastResult = null;
let scoreSubmitted = false;
let currentFacingMode = "user";

// ---------- username persistence ----------
const usernameInput = $("username-input");
usernameInput.value = localStorage.getItem("faceRaidersWeb.username") || "";
usernameInput.addEventListener("input", () => {
  localStorage.setItem("faceRaidersWeb.username", usernameInput.value);
});

// ---------- title screen ----------
$("btn-start").addEventListener("click", () => {
  sfx.unlock();
  resetCaptureScreen();
  showScreen("capture");
});
$("btn-history").addEventListener("click", () => openHistory());
$("btn-ranking").addEventListener("click", () => {
  rankingReturnTo = "title";
  openRanking();
});

// ---------- capture screen ----------
function resetCaptureScreen() {
  faceCapture.stopCamera();
  $("capture-video").classList.add("hidden");
  $("capture-img").classList.add("hidden");
  $("crop-overlay").classList.add("hidden");
  $("capture-choice-buttons").classList.remove("hidden");
  $("capture-shoot-buttons").classList.add("hidden");
  $("crop-buttons").classList.add("hidden");
  $("capture-hint").textContent = "カメラで撮影するか、画像をアップロードしてください";
}

async function openCameraWith(facingMode) {
  try {
    await faceCapture.openCamera(facingMode);
    currentFacingMode = facingMode;
    $("capture-video").classList.remove("hidden");
    $("capture-choice-buttons").classList.add("hidden");
    $("capture-shoot-buttons").classList.remove("hidden");
    $("capture-hint").textContent = "顔がまるく収まったら撮影しよう";
  } catch (e) {
    alert("カメラを起動できませんでした。カメラの権限や、端末にそのカメラが搭載されているか確認してください。");
  }
}

$("btn-camera-user").addEventListener("click", () => openCameraWith("user"));
$("btn-camera-environment").addEventListener("click", () => openCameraWith("environment"));
$("btn-camera-switch").addEventListener("click", () => {
  openCameraWith(currentFacingMode === "user" ? "environment" : "user");
});

$("btn-upload-open").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await faceCapture.loadFile(file);
  $("capture-img").classList.remove("hidden");
  $("crop-overlay").classList.remove("hidden");
  $("capture-choice-buttons").classList.add("hidden");
  $("crop-buttons").classList.remove("hidden");
  $("capture-hint").textContent = "○の枠をドラッグして顔がぴったり収まるように選ぼう";
  requestAnimationFrame(() => faceCapture.resetCrop());
  e.target.value = "";
});

$("btn-take-photo").addEventListener("click", async () => {
  await faceCapture.takePhoto();
  $("capture-video").classList.add("hidden");
  $("capture-img").classList.remove("hidden");
  $("crop-overlay").classList.remove("hidden");
  $("capture-shoot-buttons").classList.add("hidden");
  $("crop-buttons").classList.remove("hidden");
  $("capture-hint").textContent = "○の枠をドラッグして顔がぴったり収まるように選ぼう";
  requestAnimationFrame(() => faceCapture.resetCrop());
});

$("btn-capture-cancel").addEventListener("click", () => resetCaptureScreen());
$("btn-crop-retry").addEventListener("click", () => faceCapture.resetCrop());

$("btn-crop-confirm").addEventListener("click", () => {
  faceDataURL = faceCapture.confirmCrop(256);
  $("ready-face-preview").src = faceDataURL;
  $("controls-desc").textContent = isTouchDevice()
    ? "画面をドラッグして狙う → FIREボタンで発射\n(準備完了後「傾きセンサーを有効にする」でジャイロ照準に切替可能)"
    : "画面をクリックしてマウスロック → マウスで狙ってクリックで発射";
  showScreen("ready");
});

// ---------- ready screen ----------
$("btn-ready-back").addEventListener("click", () => {
  resetCaptureScreen();
  showScreen("capture");
});

$("btn-go").addEventListener("click", async () => {
  await startGame();
});

async function startGame() {
  exitTitleScene(); // must free the canvas before Game creates its own renderer on it
  hideAllScreens();
  crosshair.classList.remove("hidden");
  hud.classList.remove("hidden");

  currentGame = new Game({
    canvas: gameCanvas,
    faceDataURL,
    dom,
    onGameOver: (result) => onGameOver(result),
  });
  currentGame.start();
}

function onGameOver(result) {
  lastResult = result;
  scoreSubmitted = false;
  crosshair.classList.add("hidden");
  hud.classList.add("hidden");
  if (currentGame) {
    currentGame.destroy();
    currentGame = null;
  }
  history.save({ ...result, faceDataURL });
  $("result-score").textContent = result.score.toLocaleString();
  $("result-phase").textContent = result.phase;
  $("result-kills").textContent = result.kills;
  $("btn-submit-score").disabled = false;
  $("btn-submit-score").textContent = "ランキングに送信";
  showScreen("gameover");
}

// ---------- game over screen ----------
$("btn-submit-score").addEventListener("click", async () => {
  if (scoreSubmitted || !lastResult) return;
  scoreSubmitted = true;
  $("btn-submit-score").disabled = true;
  $("btn-submit-score").textContent = "送信中...";
  await ranking.submitScore({
    username: usernameInput.value,
    score: lastResult.score,
    phase: lastResult.phase,
    kills: lastResult.kills,
  });
  rankingReturnTo = "gameover";
  openRanking();
});

$("btn-retry").addEventListener("click", async () => {
  await startGame();
});

$("btn-gameover-title").addEventListener("click", () => showScreen("title"));

// ---------- ranking screen ----------
async function openRanking() {
  showScreen("ranking");
  $("ranking-status").textContent = "読み込み中...";
  $("ranking-list").innerHTML = "";
  const { mode, entries } = await ranking.fetchTop(50);
  $("ranking-status").textContent =
    mode === "global" ? "世界中のプレイヤーとのランキングです" : "この端末に保存されたローカルランキングです（Firebase未設定）";
  if (entries.length === 0) {
    $("ranking-list").innerHTML = `<li>まだ記録がありません</li>`;
    return;
  }
  const fragHtml = entries
    .map((e, i) => {
      const mine = lastResult && e.score === lastResult.score && e.ts && Date.now() - e.ts < 60000;
      return `<li class="${mine ? "mine" : ""}">
        <span class="rank">${i + 1}</span>
        <span class="name">${escapeHtml(e.username || "名無し")}</span>
        <span class="phase-tag">P${e.phase ?? "-"}</span>
        <span class="score">${(e.score ?? 0).toLocaleString()}</span>
      </li>`;
    })
    .join("");
  $("ranking-list").innerHTML = fragHtml;
}

$("btn-ranking-back").addEventListener("click", () => showScreen(rankingReturnTo));

// ---------- history screen ----------
function openHistory() {
  showScreen("history");
  const entries = history.list();
  if (entries.length === 0) {
    $("history-list").innerHTML = `<li>まだプレイ記録がありません</li>`;
    return;
  }
  $("history-list").innerHTML = entries
    .map(
      (e) => `<li>
        <img src="${e.faceDataURL}" alt="" />
        <span class="meta">${new Date(e.ts).toLocaleString()} ・ PHASE ${e.phase} ・ 撃破${e.kills}</span>
        <span class="score">${e.score.toLocaleString()}</span>
      </li>`
    )
    .join("");
}
$("btn-history-back").addEventListener("click", () => showScreen("title"));

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

showScreen("title");
