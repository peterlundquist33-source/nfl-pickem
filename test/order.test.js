/*
 * Tests for the kickoff-order helper.
 *
 * The schedule fixture below is a hand-written stand-in for a slice of
 * lib/schedule-2026.json — same shape, same alias table, enough games to build
 * a scrambled Sunday out of. Using a fixture rather than the real file keeps
 * these tests from rotting the first time the NFL flexes something.
 *
 * Run: node --test test/
 */
const test = require("node:test");
const assert = require("node:assert");
const S = require("../lib/order-games.js");

const SCHEDULE = {
  season: 2026,
  teams: {
    "pittsburgh": "PIT", "cincinnati": "CIN",
    "green-bay": "GB", "washington": "WSH",
    "la-rams": "LAR", "los-angeles-rams": "LAR", "rams": "LAR",
    "jacksonville": "JAX",
    "ny-giants": "NYG", "new-orleans": "NO",
    "la-chargers": "LAC", "denver": "DEN",
    "detroit": "DET", "chicago": "CHI",
    "buffalo": "BUF", "miami": "MIA",
    "dallas": "DAL",
  },
  games: {
    // Thursday night
    "pit-cin": { week: 7, kickoff: "2026-10-16T00:15:00Z", day: "Thursday",
                 slot: "Thursday Night", away: "PIT", home: "CIN" },
    // Sunday, London — earliest of the day
    "lar-jax": { week: 7, kickoff: "2026-10-18T13:30:00Z", day: "Sunday",
                 slot: "International", away: "LAR", home: "JAX" },
    // Sunday noon
    "gb-wsh": { week: 7, kickoff: "2026-10-18T17:00:00Z", day: "Sunday",
                slot: "Sunday Noon", away: "GB", home: "WSH" },
    "buf-mia": { week: 7, kickoff: "2026-10-18T17:00:00Z", day: "Sunday",
                 slot: "Sunday Noon", away: "BUF", home: "MIA" },
    // Sunday afternoon
    "nyg-no": { week: 7, kickoff: "2026-10-18T20:25:00Z", day: "Sunday",
                slot: "Sunday Afternoon", away: "NYG", home: "NO" },
    // Sunday night
    "lac-den": { week: 7, kickoff: "2026-10-19T00:20:00Z", day: "Sunday",
                 slot: "Sunday Night", away: "LAC", home: "DEN" },
    // Monday night
    "det-chi": { week: 7, kickoff: "2026-10-20T00:15:00Z", day: "Monday",
                 slot: "Monday Night", away: "DET", home: "CHI" },
    // In the schedule, but ESPN hasn't fixed a kickoff yet
    "dal-buf": { week: 18, tbd: true, away: "DAL", home: "BUF" },
  },
};

/** A game as the parser hands it over. */
function g(away, home, day) {
  return { id: (away + "-" + home).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
           day: day || "", away: away, home: home, spread: 3, favored: "home" };
}

const names = (gs) => gs.map((x) => x.away + " at " + x.home);

test("a scrambled Sunday comes out in kickoff order", () => {
  const week = [
    g("LA Chargers", "Denver", "Sunday"),     // 7:20pm SNF
    g("Green Bay", "Washington", "Sunday"),   // noon
    g("NY Giants", "New Orleans", "Sunday"),  // 3:25
    g("LA Rams", "Jacksonville", "Sunday"),   // 8:30am London
  ];
  assert.deepStrictEqual(names(S.orderGames(week, SCHEDULE)), [
    "LA Rams at Jacksonville",
    "Green Bay at Washington",
    "NY Giants at New Orleans",
    "LA Chargers at Denver",
  ]);
});

test("Thursday and Monday bookend the week", () => {
  const week = [
    g("NY Giants", "New Orleans", "Sunday"),
    g("Detroit", "Chicago", "Monday"),
    g("Green Bay", "Washington", "Sunday"),
    g("Pittsburgh", "Cincinnati", "Thursday"),
  ];
  const out = names(S.orderGames(week, SCHEDULE));
  assert.strictEqual(out[0], "Pittsburgh at Cincinnati");
  assert.strictEqual(out[out.length - 1], "Detroit at Chicago");
});

test("games kicking at the same time keep the order the PDF had them", () => {
  // Buffalo and Green Bay both kick at noon. Nothing says which comes first, so
  // the sheet decides — and it has to decide the same way every render.
  const week = [g("Buffalo", "Miami", "Sunday"), g("Green Bay", "Washington", "Sunday")];
  const flipped = [g("Green Bay", "Washington", "Sunday"), g("Buffalo", "Miami", "Sunday")];
  assert.deepStrictEqual(names(S.orderGames(week, SCHEDULE)),
    ["Buffalo at Miami", "Green Bay at Washington"]);
  assert.deepStrictEqual(names(S.orderGames(flipped, SCHEDULE)),
    ["Green Bay at Washington", "Buffalo at Miami"]);
});

test("a game missing from the schedule keeps its relative position", () => {
  const week = [
    g("Green Bay", "Washington", "Sunday"),   // noon
    g("Atlantis", "Xanadu", "Sunday"),        // nobody has ever heard of this
    g("LA Chargers", "Denver", "Sunday"),     // SNF
  ];
  assert.deepStrictEqual(names(S.orderGames(week, SCHEDULE)), [
    "Green Bay at Washington",
    "Atlantis at Xanadu",
    "LA Chargers at Denver",
  ]);
});

test("an unknown game before any timed game stays in front of it", () => {
  const week = [
    g("Atlantis", "Xanadu", "Sunday"),
    g("Green Bay", "Washington", "Sunday"),
  ];
  assert.deepStrictEqual(names(S.orderGames(week, SCHEDULE)),
    ["Atlantis at Xanadu", "Green Bay at Washington"]);
});

test("an unknown game never escapes its own day", () => {
  const week = [
    g("Pittsburgh", "Cincinnati", "Thursday"),
    g("Atlantis", "Xanadu", "Monday"),
    g("LA Rams", "Jacksonville", "Sunday"),
  ];
  assert.deepStrictEqual(names(S.orderGames(week, SCHEDULE)), [
    "Pittsburgh at Cincinnati",
    "LA Rams at Jacksonville",
    "Atlantis at Xanadu",
  ]);
});

test("a placeholder kickoff is not treated as a kickoff", () => {
  // Week 18 ships as "Saturday 11pm" for every game until the league sets the
  // times. Sorting on that would move the whole week to Saturday.
  const week = [g("Dallas", "Buffalo", "Sunday"), g("Green Bay", "Washington", "Sunday")];
  assert.strictEqual(S.effectiveDay(week[0], SCHEDULE), "Sunday");
  assert.deepStrictEqual(names(S.orderGames(week, SCHEDULE)),
    ["Dallas at Buffalo", "Green Bay at Washington"]);
});

test("the day heading follows the schedule when the PDF is out of date", () => {
  // Flexed out of the Sunday window: the sheet still says Sunday, the game is
  // on Monday, and it has to be listed under Monday.
  const moved = g("Detroit", "Chicago", "Sunday");
  assert.strictEqual(S.effectiveDay(moved, SCHEDULE), "Monday");
  const out = names(S.orderGames([moved, g("LA Chargers", "Denver", "Sunday")], SCHEDULE));
  assert.deepStrictEqual(out, ["LA Chargers at Denver", "Detroit at Chicago"]);
});

test("team names the PDF uses resolve to the right game", () => {
  const rec = S.scheduleFor(g("LA Rams", "Jacksonville"), SCHEDULE);
  assert.strictEqual(rec.kickoff, "2026-10-18T13:30:00Z");
  assert.strictEqual(S.scheduleFor(g("Los Angeles Rams", "Jacksonville"), SCHEDULE), rec);
  assert.strictEqual(S.scheduleFor(g("Rams", "Jacksonville"), SCHEDULE), rec);
  assert.strictEqual(S.slotOf(g("LA Rams", "Jacksonville"), SCHEDULE), "International");
});

test("unscheduled() names exactly the games that could not be matched", () => {
  const week = [g("Green Bay", "Washington"), g("Atlantis", "Xanadu"),
                g("Dallas", "Buffalo")];
  assert.deepStrictEqual(names(S.unscheduled(week, SCHEDULE)), ["Atlantis at Xanadu"]);
});

test("ordering does not mutate or lose the input", () => {
  const week = [g("LA Chargers", "Denver", "Sunday"), g("Green Bay", "Washington", "Sunday"),
                g("Atlantis", "Xanadu", "Sunday")];
  const before = week.slice();
  const out = S.orderGames(week, SCHEDULE);
  assert.deepStrictEqual(week, before, "input array reordered in place");
  assert.strictEqual(out.length, week.length);
  week.forEach(function (x) { assert.ok(out.indexOf(x) >= 0, x.away + " went missing"); });
});

test("no schedule at all leaves the week exactly as the PDF had it", () => {
  const week = [g("LA Chargers", "Denver", "Sunday"), g("Green Bay", "Washington", "Sunday")];
  assert.deepStrictEqual(names(S.orderGames(week, null)),
    ["LA Chargers at Denver", "Green Bay at Washington"]);
  assert.deepStrictEqual(S.unscheduled(week, null), []);
});

test("Wednesday opens a week rather than closing it", () => {
  // The 2026 opener and the Thanksgiving-eve game both kick on a Wednesday.
  const r = S._internals.dayRank;
  assert.ok(r("Wednesday") < r("Thursday"));
  assert.ok(r("Thursday") < r("Sunday"));
  assert.ok(r("Sunday") < r("Monday"));
  assert.strictEqual(r("nonsense"), null);
});
