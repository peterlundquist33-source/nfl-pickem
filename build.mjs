/*
 * Inline lib/parse-lines.js into src/index.html -> dist/index.html.
 *
 * The published page has to be a single self-contained file, but the parser is
 * the part worth unit-testing, so it lives on its own and gets stitched in here.
 * One source of truth, tests run against the same code that ships.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const parser = readFileSync(join(root, "lib/parse-lines.js"), "utf8");
const html = readFileSync(join(root, "src/index.html"), "utf8");

const MARKER = "/* __PARSER__ */";
if (!html.includes(MARKER)) {
  console.error(`src/index.html is missing the ${MARKER} marker`);
  process.exit(1);
}

// strip the CommonJS tail; the browser only needs the window global
const browserParser = parser.replace(
  /if \(typeof module[\s\S]*?module\.exports = API;\n/,
  "",
);

const out = html.replace(MARKER, browserParser);
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/index.html"), out);
console.log(`dist/index.html  ${(out.length / 1024).toFixed(1)} KB`);
