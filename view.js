import { normalizeText, tokenize } from "./links.js";

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

export function formatDate(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function renderSuggestions(target, cases) {
  target.innerHTML = cases
    .map((item) => `<option value="${escapeHtml(item.name)}"></option>`)
    .join("");
}

export function renderCaseList(target, cases, selectedKey) {
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

export function renderCaseDetail(
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
      line.setAttribute("x1", from.x);
      line.setAttribute("y1", from.y);
      line.setAttribute("x2", to.x);
      line.setAttribute("y2", to.y);
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

export function renderGraph(target, legendTarget, cases, connections, selectedKey) {
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
    nodes.push({
      ...node,
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

    item.entries.forEach((entry) => {
      const entryId = `entry:${entry.id}`;
      addNode({
        id: entryId,
        label: entry.memo || "写真",
        type: "entry",
        caseKey: item.key,
      });
      addEdge(caseId, entryId, "entry");
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
        `<line data-edge-index="${index}" class="web-edge ${edge.type}"></line>`,
    )
    .join("");

  const nodeMarkup = nodes
    .map((node) => {
      const radius = node.type === "case" ? 13 : node.type === "word" ? 9 : 6;
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
          class="web-node ${node.type} ${selectedKey && node.caseKey === selectedKey ? "is-selected" : ""}"
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
        <span><i class="entry-swatch"></i>記録</span>
        <span><i class="word-swatch"></i>共通の言葉</span>
      </div>
      <p class="network-help">ドラッグで移動・押すと確認／削除</p>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="案件・記録・共通する言葉のつながり">
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
