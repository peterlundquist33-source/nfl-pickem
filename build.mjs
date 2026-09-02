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

// NOTE: the replacement MUST go through a function. Passing the parser source as
// a plain string lets String.replace interpret $-sequences inside it — and the
// parser contains "?$`" (a regex end-anchor before a closing backtick), which is
// the "insert everything before the match" pattern. That silently duplicated the
// whole document and dropped the parser, so the published page had no parser at
// all and every upload failed. A function replacer disables that entirely.
const out = html.replace(MARKER, () => browserParser);

// Guards, because the failure above was invisible in the output.
const parserCount = (out.match(/window\.PickemParser\s*=/g) || []).length;
if (parserCount !== 1) {
  console.error(`expected exactly 1 parser definition, found ${parserCount}`);
  process.exit(1);
}
if (out.includes(MARKER)) {
  console.error("marker survived the replace — parser was not inlined");
  process.exit(1);
}
const bodyCount = (out.match(/<title>/g) || []).length;
if (bodyCount !== 1) {
  console.error(`document looks duplicated: ${bodyCount} <title> tags`);
  process.exit(1);
}
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/index.html"), out);

// docs/ is what GitHub Pages serves, so it has to stay in step with dist/.
// .nojekyll stops Pages from running Jekyll over it.
mkdirSync(join(root, "docs"), { recursive: true });
writeFileSync(join(root, "docs/index.html"), out);
writeFileSync(join(root, "docs/.nojekyll"), "");

// the tab icon ships next to the page
const icon = readFileSync(join(root, "src/favicon.svg"), "utf8");
writeFileSync(join(root, "dist/favicon.svg"), icon);
writeFileSync(join(root, "docs/favicon.svg"), icon);

console.log(`dist/index.html + docs/index.html  ${(out.length / 1024).toFixed(1)} KB`);
