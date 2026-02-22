// app.js (type="module")
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc,
  serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getStorage, ref as sRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

/** 1) 여기에 네 firebaseConfig 붙여넣기 */
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
const storage = getStorage(app);

const $ = (id) => document.getElementById(id);

const canvas = $("canvas");
const blockList = $("blockList");
const buildList = $("buildList");

let blocks = [];      // {id, ...data}
let builds = [];      // {id, ...data}

let currentBuildId = null;
let currentItems = []; // items on canvas

// ---------- utils ----------
const parseTags = (s) =>
  (s || "")
    .split(",")
    .map(t => t.trim())
    .filter(Boolean);

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (m) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[m]));
}

// SHA-256 (비번 해시)
async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Canvas item rendering ----------
function makeCanvasItemElement(item, blockData) {
  const el = document.createElement("div");
  el.className = "canvasItem";
  el.dataset.itemId = item.id;
  el.style.left = `${item.x}px`;
  el.style.top = `${item.y}px`;
  el.style.width = `${item.w}px`;
  el.style.height = `${item.h}px`;
  el.style.zIndex = `${item.z || 1}`;

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = item.kind === "ref"
    ? (blockData?.title ?? "블록")
    : "로컬 텍스트";

  const content = document.createElement("div");
  content.className = "content";

  if (item.kind === "ref") {
    if (blockData?.type === "image") {
      const img = document.createElement("img");
      img.src = blockData.imageUrl;
      img.alt = blockData.title || "image";
      content.appendChild(img);
    } else {
      content.innerHTML = escapeHtml(blockData?.content || "");
    }
  } else {
    content.innerHTML = escapeHtml(item.content || "");
    content.title = "더블클릭해서 편집";
    content.ondblclick = () => {
      const next = prompt("텍스트 편집", item.content || "");
      if (next !== null) {
        item.content = next;
        renderCanvas(); // 로컬은 즉시 반영
      }
    };
  }

  const controls = document.createElement("div");
  controls.className = "controls";

  const btnFront = document.createElement("button");
  btnFront.textContent = "앞";
  btnFront.onclick = () => { item.z = (item.z||1) + 1; renderCanvas(); };

  const btnBack = document.createElement("button");
  btnBack.textContent = "뒤";
  btnBack.onclick = () => { item.z = Math.max(1, (item.z||1) - 1); renderCanvas(); };

  const btnDetach = document.createElement("button");
  btnDetach.textContent = "복사";
  btnDetach.title = "참조 블록을 로컬로 복사(분리)";
  btnDetach.onclick = () => {
    if (item.kind !== "ref") return;
    const b = blocks.find(x => x.id === item.blockId);
    item.kind = "local";
    item.content = (b?.type === "image")
      ? `[이미지 블록: ${b?.title ?? ""}]`
      : (b?.content ?? "");
    delete item.blockId;
    renderCanvas();
  };

  const btnDel = document.createElement("button");
  btnDel.textContent = "삭제";
  btnDel.onclick = () => {
    currentItems = currentItems.filter(x => x.id !== item.id);
    renderCanvas();
  };

  controls.append(btnFront, btnBack, btnDetach, btnDel);

  const handle = document.createElement("div");
  handle.className = "resize-handle";

  el.append(controls, title, content, handle);
  return el;
}

function enableInteractFor(el, item) {
  // 이동
  interact(el).draggable({
    listeners: {
      move (event) {
        item.x += event.dx;
        item.y += event.dy;
        el.style.left = `${item.x}px`;
        el.style.top = `${item.y}px`;
      }
    }
  });

  // 리사이즈 (handle 기준)
  interact(el).resizable({
    edges: { right: true, bottom: true },
    listeners: {
      move (event) {
        item.w = Math.max(120, item.w + event.deltaRect.width);
        item.h = Math.max(60, item.h + event.deltaRect.height);
        el.style.width = `${item.w}px`;
        el.style.height = `${item.h}px`;
      }
    }
  });
}

function renderCanvas() {
  canvas.innerHTML = "";
  // z 정렬
  const sorted = [...currentItems].sort((a,b)=> (a.z||1)-(b.z||1));
  for (const item of sorted) {
    const blockData = item.kind === "ref" ? blocks.find(b=>b.id===item.blockId) : null;
    const el = makeCanvasItemElement(item, blockData);
    canvas.appendChild(el);
    enableInteractFor(el, item);
  }
}

// ---------- Blocks UI ----------
function renderBlocks() {
  const q = ($("blockSearch").value || "").trim().toLowerCase();
  blockList.innerHTML = "";

  const filtered = blocks.filter(b => {
    const hay = `${b.title||""} ${(b.tags||[]).join(" ")}`.toLowerCase();
    return !q || hay.includes(q);
  });

  for (const b of filtered) {
    const card = document.createElement("div");
    card.className = "itemCard";
    card.draggable = true;

    const title = document.createElement("div");
    title.textContent = `${b.type === "image" ? "🖼️" : "🧩"} ${b.title || "(제목 없음)"}`;

    const meta = document.createElement("div");
    meta.className = "meta";
    (b.tags || []).slice(0,6).forEach(t => {
      const s = document.createElement("span");
      s.className = "tag";
      s.textContent = t;
      meta.appendChild(s);
    });

    const preview = document.createElement("div");
    preview.className = "muted";
    preview.style.marginTop = "6px";
    preview.textContent = b.type === "image"
      ? (b.imageUrl ? "이미지 블록" : "이미지 없음")
      : (b.content || "").slice(0,60);

    // drag to canvas
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/blockId", b.id);
    });

    // edit
    card.ondblclick = async () => {
      if (b.type === "text") {
        const next = prompt("블록 내용 수정", b.content || "");
        if (next !== null) {
          await updateDoc(doc(db, "blocks", b.id), { content: next, updatedAt: serverTimestamp() });
          await loadAll();
        }
      } else {
        alert("이미지 블록 수정은 새로 업로드하거나 URL을 바꾸는 방식으로 확장 가능해. (MVP에서는 생략)");
      }
    };

    // delete block
    const btnDel = document.createElement("button");
    btnDel.textContent = "블록 삭제";
    btnDel.style.marginTop = "8px";
    btnDel.onclick = async () => {
      if (!confirm("이 블록을 삭제할까? (참조 중인 신청서는 깨질 수 있어)")) return;
      await deleteDoc(doc(db, "blocks", b.id));
      await loadAll();
      renderCanvas();
    };

    card.append(title, meta, preview, btnDel);
    blockList.appendChild(card);
  }
}

// ---------- Builds UI ----------
function renderBuilds() {
  const qText = ($("buildSearch").value || "").trim().toLowerCase();
  const vis = $("filterVisibility").value;

  buildList.innerHTML = "";

  const filtered = builds.filter(b => {
    if (vis !== "all" && b.visibility !== vis) return false;
    const hay = `${b.title||""} ${(b.tags||[]).join(" ")} ${(b.auTags||[]).join(" ")} ${(b.character||"")}`.toLowerCase();
    return !qText || hay.includes(qText);
  });

  for (const b of filtered) {
    const card = document.createElement("div");
    card.className = "itemCard";

    const title = document.createElement("div");
    title.textContent = `${b.visibility === "public" ? "🌐" : "🙈"} ${b.title || "(제목 없음)"}`;

    const meta = document.createElement("div");
    meta.className = "meta";
    [b.character, ...(b.auTags||[]), ...(b.tags||[])].filter(Boolean).slice(0,8).forEach(t=>{
      const s = document.createElement("span");
      s.className = "tag";
      s.textContent = t;
      meta.appendChild(s);
    });

    const row = document.createElement("div");
    row.className = "row";
    row.style.marginTop = "8px";

    const btnEdit = document.createElement("button");
    btnEdit.textContent = "수정";
    btnEdit.onclick = async () => {
      await openBuild(b.id);
    };

    const btnToggle = document.createElement("button");
    btnToggle.textContent = (b.visibility === "public") ? "숨기기" : "공개";
    btnToggle.onclick = async () => {
      await updateDoc(doc(db, "builds", b.id), {
        visibility: b.visibility === "public" ? "hidden" : "public",
        updatedAt: serverTimestamp()
      });
      await loadBuilds();
      renderBuilds();
    };

    const btnPw = document.createElement("button");
    btnPw.textContent = "비번";
    btnPw.onclick = async () => {
      const pw = prompt("비밀번호 설정/변경 (비우면 해제)");
      if (pw === null) return;
      const hash = pw.trim() ? `sha256:${await sha256Hex(pw.trim())}` : null;
      await updateDoc(doc(db, "builds", b.id), { passwordHash: hash, updatedAt: serverTimestamp() });
      await loadBuilds();
      renderBuilds();
    };

    const btnLink = document.createElement("button");
    btnLink.textContent = "링크";
    btnLink.onclick = () => {
      const url = new URL(location.href);
      url.pathname = url.pathname.replace(/index\.html?$/, "view.html");
      url.search = `?id=${encodeURIComponent(b.id)}`;
      navigator.clipboard.writeText(url.toString());
      alert("공유 링크를 복사했어!");
    };

    const btnDel = document.createElement("button");
    btnDel.textContent = "삭제";
    btnDel.onclick = async () => {
      if (!confirm("이 신청서를 삭제할까?")) return;
      await deleteDoc(doc(db, "builds", b.id));
      if (currentBuildId === b.id) newBuild();
      await loadBuilds();
      renderBuilds();
    };

    row.append(btnEdit, btnToggle, btnPw, btnLink, btnDel);
    card.append(title, meta, row);
    buildList.appendChild(card);
  }
}

// ---------- Drag drop from blocks to canvas ----------
canvas.addEventListener("dragover", (e) => e.preventDefault());
canvas.addEventListener("drop", (e) => {
  e.preventDefault();
  const blockId = e.dataTransfer.getData("text/blockId");
  if (!blockId) return;

  const rect = canvas.getBoundingClientRect();
  const x = Math.round(e.clientX - rect.left);
  const y = Math.round(e.clientY - rect.top);

  const item = {
    id: `it_${Math.random().toString(36).slice(2,9)}`,
    kind: "ref",
    blockId,
    x, y,
    w: 320,
    h: 140,
    z: (currentItems.reduce((m,i)=>Math.max(m,i.z||1),1) + 1)
  };

  currentItems.push(item);
  renderCanvas();
});

// ---------- Create blocks ----------
$("btnNewTextBlock").onclick = async () => {
  const title = prompt("블록 제목");
  if (!title) return;
  const content = prompt("블록 내용(텍스트)");
  if (content === null) return;
  const tags = parseTags(prompt("태그(쉼표): 예) 아델,원작,주의사항") || "");
  await addDoc(collection(db, "blocks"), {
    type: "text",
    title,
    content,
    tags,
    updatedAt: serverTimestamp()
  });
  await loadAll();
};

$("btnNewImageBlock").onclick = async () => {
  const title = prompt("이미지 블록 제목");
  if (!title) return;

  // 파일 선택
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    // Storage 업로드
    const path = `uploads/${Date.now()}_${file.name}`.replace(/\s+/g, "_");
    const r = sRef(storage, path);
    await uploadBytes(r, file);
    const url = await getDownloadURL(r);

    const tags = parseTags(prompt("태그(쉼표): 예) 아델,원작,의상") || "");
    await addDoc(collection(db, "blocks"), {
      type: "image",
      title,
      imageUrl: url,
      tags,
      updatedAt: serverTimestamp()
    });
    await loadAll();
  };
  input.click();
};

// ---------- Builds actions ----------
function newBuild() {
  currentBuildId = null;
  currentItems = [];
  $("buildTitle").value = "";
  $("buildCharacter").value = "";
  $("buildAuTags").value = "";
  $("buildTags").value = "";
  renderCanvas();
}

$("btnNewBuild").onclick = newBuild;

$("btnSaveBuild").onclick = async () => {
  const title = $("buildTitle").value.trim() || "제목 없음";
  const character = $("buildCharacter").value.trim();
  const auTags = parseTags($("buildAuTags").value);
  const tags = parseTags($("buildTags").value);

  const payload = {
    title, character, auTags, tags,
    visibility: "hidden",
    passwordHash: null,
    items: currentItems,
    updatedAt: serverTimestamp()
  };

  if (!currentBuildId) {
    payload.createdAt = serverTimestamp();
    const ref = await addDoc(collection(db, "builds"), payload);
    currentBuildId = ref.id;
  } else {
    await updateDoc(doc(db, "builds", currentBuildId), payload);
  }

  await loadBuilds();
  renderBuilds();
  alert("저장 완료!");
};

async function openBuild(id) {
  const snap = await getDoc(doc(db, "builds", id));
  if (!snap.exists()) return;

  const b = { id: snap.id, ...snap.data() };
  currentBuildId = b.id;
  currentItems = b.items || [];

  $("buildTitle").value = b.title || "";
  $("buildCharacter").value = b.character || "";
  $("buildAuTags").value = (b.auTags || []).join(", ");
  $("buildTags").value = (b.tags || []).join(", ");

  renderCanvas();
}

$("btnExportText").onclick = () => {
  // 캔버스에 올라간 텍스트를 z 순으로 합치기 (이미지는 제목만)
  const sorted = [...currentItems].sort((a,b)=> (a.z||1)-(b.z||1));
  const lines = [];
  for (const it of sorted) {
    if (it.kind === "ref") {
      const b = blocks.find(x=>x.id===it.blockId);
      if (!b) continue;
      if (b.type === "text") {
        lines.push(`■ ${b.title}\n${b.content}\n`);
      } else {
        lines.push(`■ ${b.title}\n(이미지 블록)\n`);
      }
    } else {
      lines.push(`■ (로컬)\n${it.content}\n`);
    }
  }
  const out = lines.join("\n");
  navigator.clipboard.writeText(out);
  alert("문서 텍스트를 클립보드에 복사했어!");
};

// ---------- Loaders ----------
async function loadBlocks() {
  blocks = [];
  const qs = await getDocs(query(collection(db, "blocks"), orderBy("updatedAt", "desc")));
  qs.forEach(d => blocks.push({ id: d.id, ...d.data() }));
}

async function loadBuilds() {
  builds = [];
  const qs = await getDocs(query(collection(db, "builds"), orderBy("updatedAt", "desc")));
  qs.forEach(d => builds.push({ id: d.id, ...d.data() }));
}

async function loadAll() {
  await loadBlocks();
  await loadBuilds();
  renderBlocks();
  renderBuilds();
  renderCanvas(); // 블록 갱신 시, 참조 내용 반영
}

// 검색/필터 이벤트
$("blockSearch").addEventListener("input", renderBlocks);
$("buildSearch").addEventListener("input", renderBuilds);
$("filterVisibility").addEventListener("change", renderBuilds);

// start
newBuild();
await loadAll();
