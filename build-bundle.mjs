import { readFileSync, writeFileSync } from "node:fs";

function read(name) {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

function stripExports(source) {
  return source.replace(/^export\s+/gm, "");
}

const storage = stripExports(read("./storage.js"));
const links = stripExports(read("./links.js"));
const view = stripExports(read("./view.js")).replace(
  /^import\s+\{[^}]+\}\s+from\s+"\.\/links\.js";\s*/m,
  "",
);
const app = read("./app.js").replace(
  /^import\s+\{[\s\S]*?\}\s+from\s+"\.\/(?:storage|links|view)\.js";\s*/gm,
  "",
);

const bundle = `"use strict";
(() => {
${storage}
${links}
${view}
${app}
})();
`;

writeFileSync(new URL("./app.bundle.js", import.meta.url), bundle, "utf8");
console.log("app.bundle.js を更新しました");
