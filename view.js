// view.js (type="module")
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBlXmVM0HD-RDou08DUycUI5DccRPXQnbI",
  authDomain: "commtool-8cf22.firebaseapp.com",
  projectId: "commtool-8cf22",
  storageBucket: "commtool-8cf22.firebasestorage.app",
  messagingSenderId: "713054555413",
  appId: "1:713054555413:web:0c7c114e474e9dfc886d1c",
  measurementId: "G-37STXT7VET"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const id = params.get("id");

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (m) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[m]));
}

function renderCanvas(build, blocksMap) {
  const canvas = $("viewCanvas");
  canvas.innerHTML = "";

  const sorted = [...(build.items || [])].sort((a,b)=> (a.z||1)-(b.z||1));
  for (const item of sorted) {
    const el = document.createElement("div");
    el.className = "canvasItem";
    el.style.left = `${item.x}px`;
    el.style.top = `${item.y}px`;
    el.style.width = `${item.w}px`;
    el.style.height = `${item.h}px`;
    el.style.zIndex = `${item.z || 1}`;

    const title = document.createElement("div");
    title.className = "title";

    const content = document.createElement("div");
    content.className = "content";

    if (item.kind === "ref") {
      const b = blocksMap.get(item.blockId);
      title.textContent = b?.title ?? "블록";
      if (b?.type === "image") {
        const img = document.createElement("img");
        img.src = b.imageUrl;
        img.alt = b.title || "image";
        content.appendChild(img);
      } else {
        content.innerHTML = escapeHtml(b?.content || "");
      }
    } else {
      title.textContent = "로컬";
      content.innerHTML = escapeHtml(item.content || "");
    }

    el.append(title, content);
    canvas.appendChild(el);
  }
}

async function loadBuild() {
  if (!id) {
    $("viewTitle").textContent = "잘못된 링크";
    return;
  }

  const snap = await getDoc(doc(db, "builds", id));
  if (!snap.exists()) {
    $("viewTitle").textContent = "없는 신청서";
    return;
  }
  const build = { id: snap.id, ...snap.data() };

  // 숨김인데 링크로 접근은 허용(목록에만 안 뜨는 용도) — 원하면 여기서 차단 가능
  $("viewTitle").textContent = build.title || "신청서 보기";

  // 블록 로딩: 신청서가 참조하는 blockId만 로드
  const blocksMap = new Map();
  const refIds = (build.items || []).filter(i=>i.kind==="ref").map(i=>i.blockId);
  for (const bid of new Set(refIds)) {
    const bSnap = await getDoc(doc(db, "blocks", bid));
    if (bSnap.exists()) blocksMap.set(bid, bSnap.data());
  }

  // 비번 체크
  if (build.passwordHash) {
    $("lockPanel").classList.remove("hidden");
    $("viewCanvas").classList.add("hidden");

    $("btnUnlock").onclick = async () => {
      const pw = $("pwInput").value.trim();
      const hash = `sha256:${await sha256Hex(pw)}`;
      if (hash !== build.passwordHash) {
        $("pwMsg").textContent = "비밀번호가 틀렸어.";
        return;
      }
      $("lockPanel").classList.add("hidden");
      $("viewCanvas").classList.remove("hidden");
      renderCanvas(build, blocksMap);
    };
  } else {
    renderCanvas(build, blocksMap);
  }
}

await loadBuild();
