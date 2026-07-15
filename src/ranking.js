// Global ranking (Firestore, falls back to localStorage when Firebase isn't
// configured) + local-only play history. Face photos are NEVER sent to the
// backend — they only ever live in this browser's localStorage history.
import { firebaseConfig } from "./firebaseConfig.js";

const LOCAL_RANKING_KEY = "faceRaidersWeb.localRanking";
const HISTORY_KEY = "faceRaidersWeb.history";
const HISTORY_MAX = 20;

function isFirebaseConfigured() {
  return !!(firebaseConfig.apiKey && firebaseConfig.projectId);
}

let firestoreApiPromise = null;
function getFirestoreApi() {
  if (!firestoreApiPromise) {
    firestoreApiPromise = Promise.all([
      import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"),
    ]).then(([{ initializeApp }, fs]) => {
      const app = initializeApp(firebaseConfig);
      const db = fs.getFirestore(app);
      return { db, ...fs };
    });
  }
  return firestoreApiPromise;
}

function readLocalRanking() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_RANKING_KEY) || "[]");
  } catch {
    return [];
  }
}
function writeLocalRanking(list) {
  localStorage.setItem(LOCAL_RANKING_KEY, JSON.stringify(list));
}

export const ranking = {
  isGlobal: isFirebaseConfigured(),

  async submitScore({ username, score, phase, kills }) {
    const entry = { username: (username || "名無し").slice(0, 12), score, phase, kills, ts: Date.now() };
    if (isFirebaseConfigured()) {
      try {
        const { db, collection, addDoc } = await getFirestoreApi();
        await addDoc(collection(db, "scores"), entry);
        return { mode: "global" };
      } catch (e) {
        console.error("Firestore submit failed, saving locally instead:", e);
      }
    }
    const list = readLocalRanking();
    list.push(entry);
    writeLocalRanking(list);
    return { mode: "local" };
  },

  async fetchTop(count = 50) {
    if (isFirebaseConfigured()) {
      try {
        const { db, collection, getDocs, query, orderBy, limit } = await getFirestoreApi();
        const q = query(collection(db, "scores"), orderBy("score", "desc"), limit(count));
        const snap = await getDocs(q);
        return { mode: "global", entries: snap.docs.map((d) => d.data()) };
      } catch (e) {
        console.error("Firestore fetch failed, showing local scores instead:", e);
      }
    }
    const entries = readLocalRanking()
      .sort((a, b) => b.score - a.score)
      .slice(0, count);
    return { mode: "local", entries };
  },
};

function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}
function writeHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    // likely quota exceeded from base64 photos — drop the oldest half and retry once
    const trimmed = list.slice(0, Math.ceil(list.length / 2));
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    } catch {
      /* give up silently, history is best-effort */
    }
  }
}

export const history = {
  save({ score, phase, kills, faceDataURL }) {
    const list = readHistory();
    list.unshift({ score, phase, kills, faceDataURL, ts: Date.now() });
    writeHistory(list.slice(0, HISTORY_MAX));
  },
  list() {
    return readHistory();
  },
};
