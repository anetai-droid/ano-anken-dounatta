"use strict";
(() => {
const BACKUP_VERSION = 1;

const DB_NAME = "anoken-local";
const STORE_NAME = "entries";
const DB_VERSION = 1;
const MAX_IMAGE_EDGE = 1600;
const IMAGE_QUALITY = 0.82;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readEntries() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function saveEntry(entry) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(entry);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

async function removeEntry(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");

      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("image-context"));
        return;
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/webp", IMAGE_QUALITY);
      URL.revokeObjectURL(objectUrl);
      resolve(dataUrl);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("image-load"));
    };

    image.src = objectUrl;
  });
}

const stopWords = new Set([
  "です",
  "ます",
  "した",
  "して",
  "する",
  "いる",
  "ある",
  "こと",
  "もの",
  "ため",
  "から",
  "まで",
  "これ",
  "それ",
  "あれ",
  "この",
  "その",
  "あの",
  "ところ",
  "なってる",
  "どうなってる",
  "スクリーンショット",
  "画像",
  "写真",
  "ファイル",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "heic",
]);

function isUsefulWord(word) {
  if (word.length < 2 || stopWords.has(word)) return false;
  if (/^\d+$/u.test(word)) return false;
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/u.test(word)) return false;
  if (/^(.)\1+$/u.test(word)) return false;
  return true;
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ja");
}

function tokenize(value) {
  const chunks = normalizeText(value)
    .split(/[\s、。,.，．・/／()（）「」『』【】［\]\[:：;；!?！？]+/)
    .map((word) => word.trim())
    .filter(isUsefulWord);

  const expanded = chunks.flatMap((chunk) => {
    if (chunk.length < 7) return [chunk];
    const parts = chunk
      .split(/(?:について|による|から|まで|ので|のに|の|を|が|は|で|に|と|へ)+/)
      .map((word) => word.trim())
      .filter(isUsefulWord);
    return parts.length > 1 ? parts : [chunk];
  });

  return [...new Set(expanded)];
}

function buildCases(entries) {
  const grouped = new Map();

  for (const entry of entries) {
    const key = normalizeText(entry.caseName);
    const current = grouped.get(key) ?? [];
    current.push(entry);
    grouped.set(key, current);
  }

  return [...grouped.entries()]
    .map(([key, caseEntries]) => {
      const sorted = [...caseEntries].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return {
        key,
        name: sorted[0].caseName,
        entries: sorted,
        history: [...sorted].reverse(),
        latest: sorted[0],
        searchText: normalizeText(
          sorted.map((entry) => `${entry.caseName} ${entry.memo}`).join(" "),
        ),
      };
    })
    .sort(
      (a, b) =>
        new Date(b.latest.createdAt).getTime() - new Date(a.latest.createdAt).getTime(),
    );
}

function buildConnections(cases) {
  const connections = [];

  for (let index = 0; index < cases.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < cases.length; otherIndex += 1) {
      const left = cases[index];
      const right = cases[otherIndex];
      const leftWords = new Set(
        left.entries.flatMap((entry) =>
          tokenize(`${entry.caseName} ${entry.memo}`),
        ),
      );
      const rightWords = new Set(
        right.entries.flatMap((entry) =>
          tokenize(`${entry.caseName} ${entry.memo}`),
        ),
      );
      const shared = [...leftWords].filter((word) => rightWords.has(word));

      const leftName = normalizeText(left.name);
      const rightName = normalizeText(right.name);
      if (left.searchText.includes(rightName)) shared.push(right.name);
      if (right.searchText.includes(leftName)) shared.push(left.name);

      const words = [...new Set(shared)].slice(0, 3);
      if (words.length > 0) {
        connections.push({ from: left.key, to: right.key, words });
      }
    }
  }

  return connections;
}

const graphRuns = new WeakMap();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeImage(value) {
  return typeof value === "string" && value.startsWith("data:image/") ? value : "";
}

function hashNumber(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function renderCasePicker(target, cases, currentName = "") {
  const currentKey = normalizeText(currentName);
  const selectedCase = cases.find((item) => item.key === currentKey);

  if (cases.length === 0) {
    target.innerHTML = '<option value="">まだタイトルがありません</option>';
    target.disabled = true;
    return;
  }

  target.disabled = false;
  target.innerHTML = `
    <option value="">以前のタイトルから選ぶ</option>
    ${cases
      .map(
        (item) =>
          `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`,
      )
      .join("")}
  `;
  target.value = selectedCase?.name ?? "";
}

function renderCaseList(target, cases, selectedKey) {
  if (cases.length === 0) {
    target.className = "current-empty";
    target.innerHTML = `
      <span>まだ記録がありません。</span>
      <p>上の「新しい記録」から、最初の案件を追加してください。</p>
    `;
    return;
  }

  target.className = "case-list";
  target.innerHTML = cases
    .map((item) => {
      const image = safeImage(item.latest.imageDataUrl);
      return `
        <button
          type="button"
          class="case-card ${selectedKey === item.key ? "is-selected" : ""}"
          data-case-key="${escapeHtml(item.key)}"
        >
          <span class="case-card-topline">
            <strong>${escapeHtml(item.name)}</strong>
            <time>${formatDate(item.latest.createdAt)}</time>
          </span>
          <span class="case-card-body">
            ${image ? `<img src="${image}" alt="" />` : ""}
            <span>
              ${escapeHtml(item.latest.memo || "写真を追加")}
              <small>${item.entries.length}件の記録</small>
            </span>
          </span>
          <span class="case-card-action">確認・削除</span>
        </button>
      `;
    })
    .join("");
}

function renderCaseDetail(
  target,
  selectedCase,
  selectedConnections,
  cases,
  confirmingDelete = false,
) {
  if (!selectedCase) {
    target.innerHTML = "";
    return;
  }

  const timeline = selectedCase.entries
    .map((entry, index) => {
      const image = safeImage(entry.imageDataUrl);
      return `
        <div class="timeline-item ${index === 0 ? "is-latest" : ""}">
          <div class="timeline-marker" aria-hidden="true"></div>
          <div class="timeline-content">
            <div class="timeline-meta">
              <time>${formatDate(entry.createdAt)}</time>
              ${index === 0 ? "<span>最新</span>" : ""}
            </div>
            ${entry.memo ? `<p>${escapeHtml(entry.memo)}</p>` : ""}
            ${image ? `<img src="${image}" alt="${escapeHtml(entry.imageName ?? "追加した写真")}" />` : ""}
            <button class="delete-link" type="button" data-delete-id="${escapeHtml(entry.id)}">
              この記録を削除
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  const related = selectedConnections.length
    ? `
      <div class="related-box">
        <p>共通する言葉</p>
        ${selectedConnections
          .map((connection) => {
            const otherKey =
              connection.from === selectedCase.key ? connection.to : connection.from;
            const other = cases.find((item) => item.key === otherKey);
            return `
              <button type="button" data-case-key="${escapeHtml(otherKey)}">
                <span>${escapeHtml(other?.name ?? "")}</span>
                <small>${escapeHtml(connection.words.join("・"))}</small>
              </button>
            `;
          })
          .join("")}
      </div>
    `
    : "";

  const deleteConfirmation = confirmingDelete
    ? `
      <div class="delete-confirmation" role="alert">
        <strong>本当に削除しますか？</strong>
        <p>
          「${escapeHtml(selectedCase.name)}」の記録
          ${selectedCase.entries.length}件をすべて削除します。元には戻せません。
        </p>
        <div class="delete-confirmation-actions">
          <button class="cancel-delete-button" type="button" data-cancel-delete-case>
            やめる
          </button>
          <button
            class="confirm-delete-button"
            type="button"
            data-confirm-delete-case="${escapeHtml(selectedCase.key)}"
          >
            削除する
          </button>
        </div>
      </div>
    `
    : `
      <button
        class="delete-case-button"
        type="button"
        data-request-delete-case="${escapeHtml(selectedCase.key)}"
      >
        この案件を削除
      </button>
    `;

  target.innerHTML = `
    <div class="case-dialog-shell">
      <div class="detail-heading">
        <div>
          <p>内容の確認・削除</p>
          <h3 id="case-dialog-title">${escapeHtml(selectedCase.name)}</h3>
        </div>
        <button type="button" data-close-detail aria-label="確認画面を閉じる">×</button>
      </div>
      <p class="detail-guidance">記録を確認したり、この案件を削除したりできます。</p>
      <div class="timeline">${timeline}</div>
      ${related}
      <div class="case-dialog-actions">
        ${deleteConfirmation}
        <button class="close-detail-button" type="button" data-close-detail>閉じる</button>
      </div>
    </div>
  `;
}

function startGraph(target, model) {
  graphRuns.get(target)?.cancel();

  const svg = target.querySelector("svg");
  if (!svg) return;

  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const nodeElements = new Map(
    [...svg.querySelectorAll("[data-node-id]")].map((element) => [
      element.dataset.nodeId,
      element,
    ]),
  );
  const edgeElements = [...svg.querySelectorAll("[data-edge-index]")];
  let frame = 0;
  let alpha = 1;
  let drag = null;
  let cancelled = false;

  const updateDisplay = () => {
    model.nodes.forEach((node) => {
      nodeElements.get(node.id)?.setAttribute("transform", `translate(${node.x} ${node.y})`);
    });
    model.edges.forEach((edge, index) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      const line = edgeElements[index];
      if (!from || !to || !line) return;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const startPadding = Math.min((from.radius ?? 0) + 2, distance / 3);
      const endPadding = Math.min(
        (to.radius ?? 0) + (edge.type === "timeline" ? 7 : 2),
        distance / 3,
      );
      line.setAttribute("x1", from.x + (dx / distance) * startPadding);
      line.setAttribute("y1", from.y + (dy / distance) * startPadding);
      line.setAttribute("x2", to.x - (dx / distance) * endPadding);
      line.setAttribute("y2", to.y - (dy / distance) * endPadding);
    });
  };

  const step = () => {
    if (cancelled) return;

    for (let leftIndex = 0; leftIndex < model.nodes.length; leftIndex += 1) {
      const left = model.nodes[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < model.nodes.length; rightIndex += 1) {
        const right = model.nodes[rightIndex];
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < 25) {
          dx += 5;
          dy += 4;
          distanceSquared = dx * dx + dy * dy;
        }
        const distance = Math.sqrt(distanceSquared);
        const force = Math.min(2.5, 1800 / distanceSquared) * alpha;
        left.vx -= (dx / distance) * force;
        left.vy -= (dy / distance) * force;
        right.vx += (dx / distance) * force;
        right.vy += (dy / distance) * force;
      }
    }

    model.edges.forEach((edge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) return;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const ideal = edge.type === "shared" ? model.sharedDistance : model.entryDistance;
      const force = (distance - ideal) * 0.012 * alpha;
      from.vx += (dx / distance) * force;
      from.vy += (dy / distance) * force;
      to.vx -= (dx / distance) * force;
      to.vy -= (dy / distance) * force;
    });

    model.nodes.forEach((node) => {
      if (drag?.node === node) return;
      node.vx += (model.width / 2 - node.x) * 0.0007 * alpha;
      node.vy += (model.height / 2 - node.y) * 0.0007 * alpha;
      node.vx *= 0.84;
      node.vy *= 0.84;
      node.x = Math.max(34, Math.min(model.width - 34, node.x + node.vx));
      node.y = Math.max(42, Math.min(model.height - 34, node.y + node.vy));
    });

    updateDisplay();
    alpha = drag ? Math.max(alpha * 0.985, 0.35) : alpha * 0.975;
    if (alpha > 0.018 || drag) frame = requestAnimationFrame(step);
  };

  const pointFromEvent = (event) => {
    const rect = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * model.width,
      y: ((event.clientY - rect.top) / rect.height) * model.height,
    };
  };

  svg.addEventListener("pointerdown", (event) => {
    const element = event.target.closest("[data-node-id]");
    if (!element) return;
    const node = nodeById.get(element.dataset.nodeId);
    if (!node) return;
    const point = pointFromEvent(event);
    drag = {
      node,
      element,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: node.x - point.x,
      offsetY: node.y - point.y,
      moved: false,
    };
    node.vx = 0;
    node.vy = 0;
    alpha = Math.max(alpha, 0.45);
    svg.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  svg.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const point = pointFromEvent(event);
    drag.node.x = Math.max(34, Math.min(model.width - 34, point.x + drag.offsetX));
    drag.node.y = Math.max(42, Math.min(model.height - 34, point.y + drag.offsetY));
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) {
      drag.moved = true;
      drag.element.dataset.dragged = "true";
    }
    updateDisplay();
    event.preventDefault();
  });

  const endDrag = (event) => {
    if (!drag) return;
    const draggedElement = drag.element;
    const moved = drag.moved;
    drag = null;
    alpha = Math.max(alpha, 0.28);
    if (!frame) frame = requestAnimationFrame(step);
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (moved) {
      setTimeout(() => delete draggedElement.dataset.dragged, 80);
    }
  };

  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  updateDisplay();
  frame = requestAnimationFrame(step);
  graphRuns.set(target, {
    cancel() {
      cancelled = true;
      cancelAnimationFrame(frame);
    },
  });
}

function renderGraph(target, legendTarget, cases, connections, selectedKey) {
  graphRuns.get(target)?.cancel();

  if (cases.length === 0) {
    target.innerHTML = `
      <div class="network-empty">
        <div class="empty-line"></div>
        <div class="empty-dot"></div>
        <p>最初の記録を追加すると、ここにつながりが現れます。</p>
      </div>
    `;
    legendTarget.classList.add("is-hidden");
    legendTarget.innerHTML = "";
    return;
  }

  const compact = target.clientWidth < 520;
  const width = compact ? 460 : 900;
  const height = compact ? 500 : 560;
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const edgeIds = new Set();

  const addNode = (node) => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    const angle = ((hashNumber(node.id) % 360) * Math.PI) / 180;
    const radius = compact
      ? 95 + (hashNumber(`${node.id}:radius`) % 75)
      : 135 + (hashNumber(`${node.id}:radius`) % 120);
    const nodeRadius = node.type === "case" ? 13 : node.type === "word" ? 9 : 6;
    nodes.push({
      ...node,
      radius: nodeRadius,
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    });
  };

  const addEdge = (from, to, type) => {
    const id = [from, to].sort().join("|");
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({ from, to, type });
  };

  cases.forEach((item) => {
    const caseId = `case:${item.key}`;
    addNode({
      id: caseId,
      label: item.name,
      type: "case",
      caseKey: item.key,
    });

    let previousId = caseId;
    item.history.forEach((entry, index) => {
      const entryId = `entry:${entry.id}`;
      addNode({
        id: entryId,
        label: entry.memo || "写真",
        type: "entry",
        caseKey: item.key,
        isLatest: index === item.history.length - 1,
      });
      addEdge(previousId, entryId, "timeline");
      previousId = entryId;
    });
  });

  connections.forEach((connection) => {
    const words = tokenize(connection.words.join(" ")).slice(0, 2);
    words.forEach((word) => {
      const wordId = `word:${normalizeText(word)}`;
      addNode({
        id: wordId,
        label: word,
        type: "word",
        caseKey: null,
      });
      addEdge(`case:${connection.from}`, wordId, "shared");
      addEdge(wordId, `case:${connection.to}`, "shared");
    });
  });

  const edgeMarkup = edges
    .map(
      (edge, index) =>
        `<line
          data-edge-index="${index}"
          data-edge-from="${escapeHtml(edge.from)}"
          data-edge-to="${escapeHtml(edge.to)}"
          class="web-edge ${edge.type}"
          ${edge.type === "timeline" ? 'marker-end="url(#timeline-arrow)"' : ""}
        ></line>`,
    )
    .join("");

  const nodeMarkup = nodes
    .map((node) => {
      const radius = node.radius;
      const labelLimit = node.type === "entry" ? (compact ? 14 : 22) : 16;
      const label =
        node.label.length > labelLimit ? `${node.label.slice(0, labelLimit)}…` : node.label;
      const caseAttribute = node.caseKey
        ? `data-case-key="${escapeHtml(node.caseKey)}"`
        : "";
      return `
        <g
          data-node-id="${escapeHtml(node.id)}"
          ${caseAttribute}
          ${node.caseKey ? 'role="button" tabindex="0"' : ""}
          class="web-node ${node.type} ${node.isLatest ? "is-latest" : ""} ${selectedKey && node.caseKey === selectedKey ? "is-selected" : ""}"
        >
          <circle r="${radius}"></circle>
          <text x="${radius + 6}" y="5">${escapeHtml(label)}</text>
          <title>${escapeHtml(node.label)}</title>
        </g>
      `;
    })
    .join("");

  target.innerHTML = `
    <div class="network-canvas obsidian-network" aria-label="案件のつながり">
      <div class="network-caption">
        <span><i class="case-swatch"></i>案件</span>
        <span><i class="entry-swatch"></i>記録の流れ</span>
        <span><i class="word-swatch"></i>共通の言葉</span>
      </div>
      <p class="network-help">ドラッグで移動・押すと確認／削除</p>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="案件から古い記録、新しい記録へ続く流れと、共通する言葉のつながり">
        <defs>
          <marker
            id="timeline-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,6 L7,3 z" class="timeline-arrowhead"></path>
          </marker>
        </defs>
        <g class="web-edges">${edgeMarkup}</g>
        <g class="web-nodes">${nodeMarkup}</g>
      </svg>
    </div>
  `;

  if (connections.length === 0) {
    legendTarget.classList.add("is-hidden");
    legendTarget.innerHTML = "";
  } else {
    legendTarget.classList.remove("is-hidden");
    legendTarget.innerHTML = connections
      .slice(0, 4)
      .map((connection) => {
        const from = cases.find((item) => item.key === connection.from);
        const to = cases.find((item) => item.key === connection.to);
        return `
          <button type="button" data-case-key="${escapeHtml(connection.from)}">
            <span>${escapeHtml(from?.name ?? "")} ↔ ${escapeHtml(to?.name ?? "")}</span>
            <small>${escapeHtml(connection.words.join("・"))}</small>
          </button>
        `;
      })
      .join("");
  }

  startGraph(target, {
    nodes,
    edges,
    width,
    height,
    entryDistance: compact ? 94 : 120,
    sharedDistance: compact ? 118 : 155,
  });
}

const elements = {
  form: document.querySelector("#entry-form"),
  caseName: document.querySelector("#case-name"),
  casePicker: document.querySelector("#case-picker"),
  memo: document.querySelector("#case-memo"),
  photoInput: document.querySelector("#photo-input"),
  photoLabel: document.querySelector("#photo-label"),
  photoPreview: document.querySelector("#photo-preview"),
  photoPreviewImage: document.querySelector("#photo-preview-image"),
  removePhoto: document.querySelector("#remove-photo"),
  error: document.querySelector("#error-message"),
  submit: document.querySelector("#entry-form .primary-button"),
  submitLabel: document.querySelector("#entry-form .button-label"),
  notice: document.querySelector("#notice"),
  noticeText: document.querySelector("#notice-text"),
  undo: document.querySelector("#undo-button"),
  search: document.querySelector("#case-search"),
  clearSearch: document.querySelector("#clear-search"),
  loading: document.querySelector("#loading-state"),
  caseList: document.querySelector("#case-list"),
  detail: document.querySelector("#case-detail"),
  network: document.querySelector("#network-view"),
  legend: document.querySelector("#connection-legend"),
  saveData: document.querySelector("#save-data"),
  restoreData: document.querySelector("#restore-data"),
  restoreInput: document.querySelector("#restore-input"),
};

let entries = [];
let selectedKey = null;
let deleteConfirmKey = null;
let imageFile = null;
let imagePreviewUrl = null;
let lastAddedId = null;

function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function setError(message = "") {
  elements.error.textContent = message;
  elements.error.classList.toggle("is-hidden", !message);
}

function setNotice(message = "", canUndo = false) {
  elements.noticeText.textContent = message;
  elements.notice.classList.toggle("is-hidden", !message);
  elements.undo.classList.toggle("is-hidden", !canUndo);
}

function clearPhoto() {
  if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  imageFile = null;
  imagePreviewUrl = null;
  elements.photoInput.value = "";
  elements.photoPreviewImage.src = "";
  elements.photoPreview.classList.add("is-hidden");
  elements.photoLabel.textContent = "写真フォルダから選ぶ";
}

function currentData() {
  const cases = buildCases(entries);
  const connections = buildConnections(cases);
  return { cases, connections };
}

function render() {
  const { cases, connections } = currentData();
  const searchKey = normalizeText(elements.search.value);
  const filtered = searchKey
    ? cases.filter((item) => item.searchText.includes(searchKey))
    : cases;
  const selectedCase = cases.find((item) => item.key === selectedKey) ?? null;
  const selectedConnections = selectedCase
    ? connections.filter(
        (connection) =>
          connection.from === selectedCase.key || connection.to === selectedCase.key,
      )
    : [];

  renderCasePicker(elements.casePicker, cases, elements.caseName.value);
  renderCaseList(elements.caseList, filtered, selectedKey);
  renderCaseDetail(
    elements.detail,
    selectedCase,
    selectedConnections,
    cases,
    deleteConfirmKey === selectedKey,
  );
  renderGraph(elements.network, elements.legend, cases, connections, selectedKey);
  elements.saveData.disabled = entries.length === 0;

  if (selectedCase && !elements.detail.open) {
    elements.detail.showModal();
  } else if (!selectedCase && elements.detail.open) {
    elements.detail.close();
  }
}

async function addEntry(event) {
  event.preventDefault();
  const caseName = elements.caseName.value.trim();
  const memo = elements.memo.value.trim();

  if (!caseName) {
    setError("まず「何の件？」を入れてください。");
    return;
  }
  if (!memo && !imageFile) {
    setError("今の状況を書くか、写真を1枚選んでください。");
    return;
  }

  elements.submit.disabled = true;
  elements.submitLabel.textContent = "追加しています…";
  setError();
  setNotice();

  try {
    const imageDataUrl = imageFile ? await resizeImage(imageFile) : null;
    const now = new Date().toISOString();
    const entry = {
      id: makeId(),
      caseName,
      memo,
      imageDataUrl,
      imageName: imageFile?.name ?? null,
      createdAt: now,
      updatedAt: now,
    };

    await saveEntry(entry);
    entries = [entry, ...entries];
    selectedKey = normalizeText(caseName);
    lastAddedId = entry.id;
    elements.form.reset();
    clearPhoto();
    setNotice("追加しました。案件一覧とつながりを更新しました。", true);
    render();
  } catch {
    setError("うまく保存できませんでした。写真を小さくして、もう一度お試しください。");
  } finally {
    elements.submit.disabled = false;
    elements.submitLabel.textContent = "追加する";
  }
}

async function undoLastAdd() {
  if (!lastAddedId) return;
  await removeEntry(lastAddedId);
  entries = entries.filter((entry) => entry.id !== lastAddedId);
  lastAddedId = null;
  setNotice("取り消しました。");
  render();
}

async function deleteEntry(id) {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return;
  const detail = entry.memo || "写真";
  if (!window.confirm(`「${detail.slice(0, 24)}」を削除しますか？`)) return;

  try {
    await removeEntry(entry.id);
    entries = entries.filter((item) => item.id !== entry.id);
    if (!entries.some((item) => normalizeText(item.caseName) === selectedKey)) {
      selectedKey = null;
    }
    setNotice("削除しました。");
    render();
  } catch {
    setError("削除できませんでした。もう一度お試しください。");
  }
}

async function deleteCase(key) {
  const caseEntries = entries.filter((entry) => normalizeText(entry.caseName) === key);
  if (caseEntries.length === 0) return;

  try {
    await Promise.all(caseEntries.map((entry) => removeEntry(entry.id)));
    const deletedIds = new Set(caseEntries.map((entry) => entry.id));
    entries = entries.filter((entry) => !deletedIds.has(entry.id));
    selectedKey = null;
    deleteConfirmKey = null;
    setNotice(`「${caseEntries[0].caseName}」を削除しました。`);
    render();
  } catch {
    deleteConfirmKey = null;
    setError("削除できませんでした。もう一度お試しください。");
    render();
  }
}

function selectCase(key) {
  selectedKey = key;
  deleteConfirmKey = null;
  render();
}

function closeCaseDetail() {
  selectedKey = null;
  deleteConfirmKey = null;
  render();
}

function saveData() {
  const payload = {
    version: BACKUP_VERSION,
    savedAt: new Date().toISOString(),
    entries,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `あの案件どうなった-${new Date().toISOString().slice(0, 10)}.anoken`;
  anchor.click();
  URL.revokeObjectURL(url);
  setNotice("データを1つのファイルに保存しました。");
}

function isValidEntry(entry) {
  const imageIsSafe =
    entry.imageDataUrl === null ||
    (typeof entry.imageDataUrl === "string" && entry.imageDataUrl.startsWith("data:image/"));
  return (
    typeof entry.id === "string" &&
    typeof entry.caseName === "string" &&
    typeof entry.memo === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.updatedAt === "string" &&
    imageIsSafe
  );
}

async function restoreData(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());
    if (payload.version !== BACKUP_VERSION || !Array.isArray(payload.entries)) {
      throw new Error("invalid");
    }
    const valid = payload.entries.filter(isValidEntry);
    const merged = new Map(entries.map((entry) => [entry.id, entry]));

    valid.forEach((entry) => {
      const current = merged.get(entry.id);
      if (!current || new Date(entry.updatedAt).getTime() >= new Date(current.updatedAt).getTime()) {
        merged.set(entry.id, entry);
      }
    });

    for (const entry of merged.values()) {
      await saveEntry(entry);
    }
    entries = [...merged.values()];
    setNotice(`${valid.length}件のデータを戻しました。`);
    render();
  } catch {
    setError("このファイルからは戻せませんでした。今のデータは変更していません。");
  }
}

elements.form.addEventListener("submit", addEntry);
elements.undo.addEventListener("click", undoLastAdd);
elements.removePhoto.addEventListener("click", clearPhoto);

elements.casePicker.addEventListener("change", () => {
  if (!elements.casePicker.value) return;
  elements.caseName.value = elements.casePicker.value;
  setError();
  elements.memo.focus();
});

elements.caseName.addEventListener("input", () => {
  const { cases } = currentData();
  const currentKey = normalizeText(elements.caseName.value);
  const existing = cases.find((item) => item.key === currentKey);
  elements.casePicker.value = existing?.name ?? "";
});

elements.photoInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0] ?? null;
  setError();
  clearPhoto();
  if (!file) return;
  imageFile = file;
  imagePreviewUrl = URL.createObjectURL(file);
  elements.photoPreviewImage.src = imagePreviewUrl;
  elements.photoPreview.classList.remove("is-hidden");
  elements.photoLabel.textContent = "写真を選び直す";
});

elements.search.addEventListener("input", () => {
  elements.clearSearch.classList.toggle("is-hidden", !elements.search.value);
  render();
});

elements.clearSearch.addEventListener("click", () => {
  elements.search.value = "";
  elements.clearSearch.classList.add("is-hidden");
  elements.search.focus();
  render();
});

elements.caseList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-case-key]");
  if (button) selectCase(button.dataset.caseKey);
});

elements.detail.addEventListener("click", (event) => {
  const close = event.target.closest("[data-close-detail]");
  if (close) {
    closeCaseDetail();
    return;
  }
  const requestDelete = event.target.closest("[data-request-delete-case]");
  if (requestDelete) {
    deleteConfirmKey = requestDelete.dataset.requestDeleteCase;
    render();
    return;
  }
  const cancelDelete = event.target.closest("[data-cancel-delete-case]");
  if (cancelDelete) {
    deleteConfirmKey = null;
    render();
    return;
  }
  const confirmDelete = event.target.closest("[data-confirm-delete-case]");
  if (confirmDelete) {
    deleteCase(confirmDelete.dataset.confirmDeleteCase);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-id]");
  if (deleteButton) {
    deleteEntry(deleteButton.dataset.deleteId);
    return;
  }
  const caseButton = event.target.closest("[data-case-key]");
  if (caseButton) selectCase(caseButton.dataset.caseKey);
});

elements.detail.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeCaseDetail();
});

elements.detail.addEventListener("click", (event) => {
  if (event.target === elements.detail) closeCaseDetail();
});

function handleNetworkSelection(event) {
  const node = event.target.closest("[data-case-key]");
  if (node?.dataset.dragged === "true") {
    delete node.dataset.dragged;
    return;
  }
  if (node) selectCase(node.dataset.caseKey);
}

elements.network.addEventListener("click", handleNetworkSelection);
elements.legend.addEventListener("click", handleNetworkSelection);
elements.network.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const node = event.target.closest("[data-case-key]");
  if (!node) return;
  event.preventDefault();
  selectCase(node.dataset.caseKey);
});

elements.saveData.addEventListener("click", saveData);
elements.restoreData.addEventListener("click", () => elements.restoreInput.click());
elements.restoreInput.addEventListener("change", restoreData);

readEntries()
  .then((stored) => {
    entries = stored;
    render();
  })
  .catch(() => setError("保存していた内容を開けませんでした。もう一度読み込んでください。"))
  .finally(() => {
    elements.loading.classList.add("is-hidden");
    elements.caseList.classList.remove("is-hidden");
  });

if ("serviceWorker" in navigator) {
  try {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Direct-file use remains available if the browser does not allow registration.
    });
  } catch {
    // Direct-file use remains available if the browser does not allow registration.
  }
}

})();
