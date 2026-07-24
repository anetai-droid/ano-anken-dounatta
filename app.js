import { BACKUP_VERSION, readEntries, removeEntry, resizeImage, saveEntry } from "./storage.js";
import { buildCases, buildConnections, normalizeText } from "./links.js";
import {
  renderCaseDetail,
  renderCaseList,
  renderGraph,
  renderSuggestions,
} from "./view.js";

const elements = {
  form: document.querySelector("#entry-form"),
  caseName: document.querySelector("#case-name"),
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
  suggestions: document.querySelector("#case-suggestions"),
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
  elements.photoLabel.textContent = "写真も入れる";
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

  renderSuggestions(elements.suggestions, cases);
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
