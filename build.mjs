/*
 * Inline lib/parse-lines.js and the baked season schedule into src/index.html
 * -> dist/index.html.
 *
 * The published page has to be a single self-contained file, but the parser is
 * the part worth unit-testing, so it lives on its own and gets stitched in here.
 * One source of truth, tests run against the same code that ships.
 *
 * The schedule goes in for a different reason: the page runs in a sandbox that
 * blocks every outbound request, so kickoff times cannot be fetched at runtime.
 * They are here or the games cannot be put in order at all.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SEASON = 2026;

const root = dirname(fileURLToPath(import.meta.url));
const parser = readFileSync(join(root, "lib/parse-lines.js"), "utf8");
const order = readFileSync(join(root, "lib/order-games.js"), "utf8");
const html = readFileSync(join(root, "src/index.html"), "utf8");

const MARKER = "/* __PARSER__ */";
const SCHED_MARKER = "/* __SCHEDULE__ */";
for (const m of [MARKER, SCHED_MARKER]) {
  if (!html.includes(m)) {
    console.error(`src/index.html is missing the ${m} marker`);
    process.exit(1);
  }
}

// strip the CommonJS tail; the browser only needs the window global
const stripTail = (src) => src.replace(
  /if \(typeof module[\s\S]*?module\.exports = API;\n/,
  "",
);

// Each module goes in wrapped. Separate <script> blocks still share one global
// scope, and both lib files end with `const API = {...}` — inlined side by side
// that is "Identifier 'API' has already been declared", which kills the second
// block outright and takes window.SCHEDULE with it. They also both define
// slug(), where the collision is worse: no error, the later one just silently
// wins. The IIFE makes each file's internals its own, and the window.* line at
// the bottom of each is still what publishes it.
const wrap = (src) => "(function () {\n" + stripTail(src) + "\n})();\n";
const browserParser = wrap(parser);

/* ---------------------------------------------------------------- schedule */

const schedPath = join(root, `lib/schedule-${SEASON}.json`);
if (!existsSync(schedPath)) {
  console.error(`missing ${schedPath} — run: python3 tools/fetch_schedule.py ${SEASON}`);
  process.exit(1);
}
const schedule = JSON.parse(readFileSync(schedPath, "utf8"));

// Checks, because a schedule that is quietly wrong just puts the games in a
// confidently wrong order and nothing on screen says so.
{
  const games = Object.keys(schedule.games || {});
  const teams = schedule.teams || {};
  if (schedule.season !== SEASON) {
    console.error(`schedule is for ${schedule.season}, expected ${SEASON}`);
    process.exit(1);
  }
  if (games.length < 250) {
    console.error(`schedule has only ${games.length} games — a full season is 272`);
    process.exit(1);
  }
  const codes = new Set(Object.values(teams));
  if (codes.size !== 32) {
    console.warn(`  ! ${codes.size} teams in the alias table, expected 32`);
  }
  // Every game key has to be reachable through the alias table, or the game is
  // in the schedule and still unfindable from the page.
  const unreachable = games.filter((k) => {
    const rec = schedule.games[k];
    return !codes.has(rec.away) || !codes.has(rec.home);
  });
  if (unreachable.length) {
    console.warn(`  ! ${unreachable.length} game(s) name a team with no alias: ` +
      unreachable.slice(0, 5).join(", "));
  }
  // The names the commissioner's PDF actually uses. If one of these stops
  // resolving, every game involving that team silently loses its kickoff.
  const mustResolve = ["la-rams", "la-chargers", "ny-giants", "ny-jets",
                       "washington", "green-bay", "kansas-city", "new-england",
                       "tampa-bay", "san-francisco", "new-orleans", "las-vegas"];
  const missing = mustResolve.filter((s) => !teams[s]);
  if (missing.length) {
    console.error(`alias table is missing PDF-style names: ${missing.join(", ")}`);
    process.exit(1);
  }
  const tbd = games.filter((k) => schedule.games[k].tbd).length;
  console.log(`schedule ${SEASON}: ${games.length} games · ${tbd} kickoff TBD · ` +
    `${Object.keys(teams).length} aliases · pulled ${schedule.generated || "?"}`);
}

// Minified into the bundle. The on-disk file stays indented so that re-running
// fetch_schedule.py after a flex change produces a diff a human can read.
const scheduleBlock =
  "window.SCHEDULE = " + JSON.stringify(schedule) + ";\n" + stripTail(order);

// NOTE: the replacement MUST go through a function. Passing the parser source as
// a plain string lets String.replace interpret $-sequences inside it — and the
// parser contains "?$`" (a regex end-anchor before a closing backtick), which is
// the "insert everything before the match" pattern. That silently duplicated the
// whole document and dropped the parser, so the published page had no parser at
// all and every upload failed. A function replacer disables that entirely.
const out = html
  .replace(MARKER, () => browserParser)
  .replace(SCHED_MARKER, () => scheduleBlock);

// Guards, because the failure above was invisible in the output.
const parserCount = (out.match(/window\.PickemParser\s*=/g) || []).length;
if (parserCount !== 1) {
  console.error(`expected exactly 1 parser definition, found ${parserCount}`);
  process.exit(1);
}
const schedCount = (out.match(/window\.PickemSchedule\s*=/g) || []).length;
if (schedCount !== 1) {
  console.error(`expected exactly 1 schedule helper, found ${schedCount}`);
  process.exit(1);
}
if ((out.match(/window\.SCHEDULE\s*=/g) || []).length !== 1) {
  console.error("schedule data was not inlined exactly once");
  process.exit(1);
}
if (out.includes(MARKER) || out.includes(SCHED_MARKER)) {
  console.error("a marker survived the replace — something was not inlined");
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
