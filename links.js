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

export function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ja");
}

export function tokenize(value) {
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

export function buildCases(entries) {
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

export function buildConnections(cases) {
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
