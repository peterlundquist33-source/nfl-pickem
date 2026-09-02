/*
 * Tests for the lines parser.
 *
 * There was no real weekly PDF available when this was written, so the fixture
 * below reconstructs the layout the spec describes — including the case the
 * spec calls out as the one a naive text extractor gets wrong: "LA Rams at
 * Jacksonville" played in London, where the spread sits over the AWAY team.
 *
 * Coordinates are PDF text space: y increases upward, x rightward, letter width
 * 612pt, two game boxes per row.
 *
 * Run: node --test test/
 */
const test = require("node:test");
const assert = require("node:assert");
const P = require("../lib/parse-lines.js");

const PAGE_W = 612;

/** Build a word list: helper places a game box at (x, y). */
function box(words, { x, y, spread, spreadSide, away, home, note }) {
  if (note) words.push({ str: note, x: x + 10, y: y + 34, w: 60 });
  // matchup line sits at y; spread sits ~18pt above it
  const awayX = x + 8, atX = x + 92, homeX = x + 120;
  words.push({ str: away, x: awayX, y, w: 74 });
  words.push({ str: "at", x: atX, y, w: 12 });
  words.push({ str: home, x: homeX, y, w: 74 });
  // spread centered over whichever team it applies to
  const overX = spreadSide === "away" ? awayX + 30 : homeX + 30;
  const parts = String(spread).split(" ");
  let sx = overX;
  for (const p of parts) { words.push({ str: p, x: sx, y: y + 18, w: 10 }); sx += 14; }
}

function fixture() {
  const w = [];
  w.push({ str: "Week 7", x: 270, y: 720, w: 60 });

  w.push({ str: "Thursday", x: 40, y: 690, w: 60 });
  box(w, { x: 40,  y: 655, spread: "5 1/2", spreadSide: "home", away: "Pittsburgh", home: "Cincinnati" });

  w.push({ str: "Sunday", x: 40, y: 630, w: 50 });
  box(w, { x: 40,  y: 575, spread: "3",      spreadSide: "away", away: "LA Rams",  home: "Jacksonville",
           note: "London 8:30 AM" });
  box(w, { x: 330, y: 575, spread: "11 1/2", spreadSide: "away", away: "Green Bay", home: "Washington" });
  box(w, { x: 40,  y: 505, spread: "7",      spreadSide: "home", away: "NY Giants", home: "New Orleans" });
  box(w, { x: 330, y: 505, spread: "2 1/2",  spreadSide: "home", away: "LA Chargers", home: "Denver" });

  w.push({ str: "Monday", x: 40, y: 450, w: 50 });
  box(w, { x: 40,  y: 415, spread: "6",      spreadSide: "away", away: "Detroit",  home: "Chicago" });

  w.push({ str: "Teams on Bye: Buffalo, Miami", x: 40, y: 360, w: 200 });
  w.push({ str: "Name ______________", x: 40, y: 320, w: 140 });
  return w;
}

test("reads the week number", () => {
  assert.strictEqual(P.parseWords(fixture(), PAGE_W).week, 7);
});

test("finds every game exactly once", () => {
  const { games } = P.parseWords(fixture(), PAGE_W);
  assert.strictEqual(games.length, 6);
});

test("spread position decides who is favored, not home/away", () => {
  const { games } = P.parseWords(fixture(), PAGE_W);
  const by = (a) => games.find((g) => g.away === a);

  // the spec's headline case: away team favored, playing in London
  const rams = by("LA Rams");
  assert.strictEqual(rams.home, "Jacksonville");
  assert.strictEqual(rams.spread, 3);
  assert.strictEqual(rams.favored, "away", "Rams are favored despite being away");

  assert.strictEqual(by("Pittsburgh").favored, "home");   // Cincinnati -5.5
  assert.strictEqual(by("Pittsburgh").spread, 5.5);
  assert.strictEqual(by("Green Bay").favored, "away");
  assert.strictEqual(by("Green Bay").spread, 11.5);
  assert.strictEqual(by("NY Giants").favored, "home");
  assert.strictEqual(by("LA Chargers").spread, 2.5);
  assert.strictEqual(by("Detroit").favored, "away");
});

test("assigns games to the right day section", () => {
  const { games } = P.parseWords(fixture(), PAGE_W);
  const day = (a) => games.find((g) => g.away === a).day;
  assert.strictEqual(day("Pittsburgh"), "Thursday");
  assert.strictEqual(day("LA Rams"), "Sunday");
  assert.strictEqual(day("LA Chargers"), "Sunday");
  assert.strictEqual(day("Detroit"), "Monday");
});

test("collects bye teams and ignores the signature line", () => {
  const { games, byes } = P.parseWords(fixture(), PAGE_W);
  assert.deepStrictEqual(byes, ["Buffalo", "Miami"]);
  assert.ok(!games.some((g) => /name/i.test(g.away + g.home)));
});

test("handles a matchup that arrives as one combined text run", () => {
  // pdf.js often merges a whole line into a single item; the boundary then has
  // to be interpolated from where " at " falls inside the string.
  const w = [
    { str: "Week 3", x: 270, y: 720, w: 60 },
    { str: "Sunday", x: 40, y: 690, w: 50 },
    { str: "4", x: 60, y: 620, w: 10 },
    { str: "Buffalo        at        Miami", x: 40, y: 600, w: 200 },
  ];
  const { games } = P.parseWords(w, PAGE_W);
  assert.strictEqual(games.length, 1);
  assert.strictEqual(games[0].away, "Buffalo");
  assert.strictEqual(games[0].home, "Miami");
  assert.strictEqual(games[0].favored, "away");
});

test("warns instead of guessing when a spread is missing", () => {
  const w = [
    { str: "Week 1", x: 270, y: 720, w: 60 },
    { str: "Sunday", x: 40, y: 690, w: 50 },
    { str: "Buffalo", x: 40, y: 600, w: 74 },
    { str: "at", x: 132, y: 600, w: 12 },
    { str: "Miami", x: 160, y: 600, w: 74 },
  ];
  const r = P.parseWords(w, PAGE_W);
  assert.strictEqual(r.games[0].spread, null);
  assert.strictEqual(r.games[0].favored, null);
  assert.ok(r.warnings.some((x) => /No spread/.test(x)));
});

/* ------------------------------------------------------------ grading */

test("ATS: favorite covers", () => {
  const g = { spread: 5.5, favored: "home" };          // home -5.5
  assert.strictEqual(P.atsWinner(g, { awayScore: 10, homeScore: 20 }), "home");
});

test("ATS: favorite wins but does not cover", () => {
  const g = { spread: 5.5, favored: "home" };
  assert.strictEqual(P.atsWinner(g, { awayScore: 17, homeScore: 20 }), "away");
});

test("ATS: away favorite, the spec's Rams case", () => {
  const g = { spread: 3, favored: "away" };
  assert.strictEqual(P.atsWinner(g, { awayScore: 24, homeScore: 20 }), "away"); // won by 4 > 3
  assert.strictEqual(P.atsWinner(g, { awayScore: 22, homeScore: 20 }), "home"); // won by 2 < 3
});

test("ATS: exact push is void", () => {
  const g = { spread: 3, favored: "home" };
  assert.strictEqual(P.atsWinner(g, { awayScore: 20, homeScore: 23 }), "push");
});

test("ATS: not gradeable without a final score", () => {
  const g = { spread: 3, favored: "home" };
  assert.strictEqual(P.atsWinner(g, null), null);
  assert.strictEqual(P.atsWinner(g, { awayScore: 20, homeScore: "" }), null);
});

test("majority needs all three votes, then takes 2-1 or 3-0", () => {
  const people = ["Peter", "Dalton", "Hunter"];
  assert.strictEqual(P.majority({ Peter: "away", Dalton: "away" }, people), null);
  assert.strictEqual(P.majority({ Peter: "away", Dalton: "away", Hunter: "home" }, people), "away");
  assert.strictEqual(P.majority({ Peter: "home", Dalton: "home", Hunter: "home" }, people), "home");
});

test("tally counts pushes separately from wins and losses", () => {
  const games = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const side = { a: "away", b: "away", c: "home", d: "away" };
  const res = { a: "away", b: "home", c: "push", d: null };
  const rec = P.tally(games, (g) => side[g.id], (g) => res[g.id]);
  assert.deepStrictEqual(rec, { w: 1, l: 1, p: 1 });   // 'd' ungraded, excluded
});
