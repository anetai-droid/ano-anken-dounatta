import assert from "node:assert/strict";
import { buildCases, buildConnections, normalizeText, tokenize } from "./links.js";
import { renderCasePicker, renderGraph } from "./view.js";

const entries = [
  {
    id: "1",
    caseName: "A社サイト",
    memo: "田中さん 見積送付済み",
    imageDataUrl: null,
    imageName: null,
    createdAt: "2026-07-24T01:00:00.000Z",
    updatedAt: "2026-07-24T01:00:00.000Z",
  },
  {
    id: "2",
    caseName: "Ａ社サイト",
    memo: "先方確認中",
    imageDataUrl: null,
    imageName: null,
    createdAt: "2026-07-24T02:00:00.000Z",
    updatedAt: "2026-07-24T02:00:00.000Z",
  },
  {
    id: "3",
    caseName: "チラシ制作",
    memo: "田中さん 原稿待ち",
    imageDataUrl: null,
    imageName: null,
    createdAt: "2026-07-24T03:00:00.000Z",
    updatedAt: "2026-07-24T03:00:00.000Z",
  },
];

assert.equal(normalizeText(" Ａ社サイト "), "a社サイト");

const cases = buildCases(entries);
assert.equal(cases.length, 2, "全角・半角が違う同じ案件は1件にまとまる");

const aCase = cases.find((item) => item.key === "a社サイト");
assert.equal(aCase.entries.length, 2);
assert.equal(aCase.latest.memo, "先方確認中", "新しい記録が「いま」になる");
assert.deepEqual(
  aCase.history.map((entry) => entry.memo),
  ["田中さん 見積送付済み", "先方確認中"],
  "同じ案件の記録は古いものから新しいものへ並ぶ",
);

const connections = buildConnections(cases);
assert.equal(connections.length, 1, "共通する人名で別案件がつながる");
assert.ok(connections[0].words.includes("田中さん"));

const cleanWords = tokenize("スクリーンショット 2026-05-14 140716 png ああ");
assert.deepEqual(cleanWords, [], "日付・数字・拡張子・意味のない反復文字を表示しない");

const picker = { disabled: false, innerHTML: "", value: "" };
renderCasePicker(picker, cases, "Ａ社サイト");
assert.equal(picker.disabled, false);
assert.equal(picker.value, "Ａ社サイト", "以前のタイトルをプルダウンで選べる");
assert.match(picker.innerHTML, /チラシ制作/);

const graphTarget = {
  clientWidth: 400,
  innerHTML: "",
  querySelector() {
    return null;
  },
};
const legendTarget = {
  classList: {
    add() {},
    remove() {},
  },
  innerHTML: "",
};
renderGraph(graphTarget, legendTarget, [aCase], [], null);
assert.match(
  graphTarget.innerHTML,
  /data-edge-from="case:a社サイト"\s+data-edge-to="entry:1"/,
  "案件から最初の記録につながる",
);
assert.match(
  graphTarget.innerHTML,
  /data-edge-from="entry:1"\s+data-edge-to="entry:2"/,
  "古い記録から新しい記録へつながる",
);
assert.match(graphTarget.innerHTML, /marker-end="url\(#timeline-arrow\)"/);

console.log("自動接続と最新状況の試験: OK");
