/*
 * order-games.js — put a week's games in real kickoff order.
 *
 * THE PROBLEM: the commissioner's PDF carries no kickoff times. Games come off
 * the sheet in whatever order they were typed, so a Sunday slate lands with the
 * night game third and the noon games scattered around it. Every tab then shows
 * that order, and so does the message Peter pastes back to the commissioner.
 *
 * The times themselves are baked in at build time (lib/schedule-<season>.json,
 * from tools/fetch_schedule.py) because the published page runs in a sandbox
 * that blocks every outbound request — it cannot ask ESPN anything at runtime.
 *
 * Matching the two up is the fiddly part. The PDF writes "LA Rams", "NY Jets",
 * "Washington"; ESPN writes "Los Angeles Rams", "New York Jets", "Washington
 * Commanders". So the schedule ships an alias table, slug -> abbreviation, and
 * both sides of a matchup go through it before the lookup.
 *
 * Everything below degrades rather than breaks. A game the schedule has never
 * heard of — a team renamed, a typo in the review table, a kickoff ESPN hasn't
 * set yet — keeps the position the PDF gave it instead of being dropped or flung
 * to the end. Ordering a slate is worth doing; it is not worth losing a game
 * over.
 */

// The NFL week runs Wednesday through Monday, not Monday through Sunday: both
// the 2026 opener and the Thanksgiving-eve game kick on a Wednesday, and they
// open their week rather than closing it. Only used for games the schedule
// doesn't cover — a real kickoff outranks this every time.
var DAY_ORDER = {
  wednesday: -1, thursday: 0, friday: 1, saturday: 2,
  sunday: 3, monday: 4, tuesday: 5,
};

/** Byte-for-byte the slug() in parse-lines.js — the two have to agree. */
function slug(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** A PDF team name -> the abbreviation the schedule is keyed by. */
function teamCode(name, teams) {
  var s = slug(name);
  return (teams && teams[s]) || s;
}

/**
 * The schedule record for a parsed game, or null.
 * Records with `tbd` are returned: ESPN knows about the game, it just hasn't
 * fixed a kickoff. Callers check `.tbd` before trusting the time.
 */
function scheduleFor(game, schedule) {
  if (!game || !schedule || !schedule.games) return null;
  // slug() over the joined pair, exactly as fetch_schedule.py builds the key —
  // the alias table answers in upper case ("GB") and the keys are lower ("gb-wsh").
  var key = slug(teamCode(game.away, schedule.teams) + "-" +
                 teamCode(game.home, schedule.teams));
  return schedule.games[key] || null;
}

/** Whether a record carries a kickoff worth sorting on. */
function isTimed(rec) {
  return !!(rec && !rec.tbd && rec.kickoff);
}

/**
 * Which day a game belongs to on screen.
 *
 * The schedule wins when it has a confirmed kickoff — that is what makes a game
 * flexed out of the Sunday afternoon window show up under Monday instead of
 * sitting in the wrong section. Otherwise the PDF's own day stands.
 */
function effectiveDay(game, schedule) {
  var rec = scheduleFor(game, schedule);
  if (isTimed(rec) && rec.day) return rec.day;
  return (game && game.day) || "";
}

/** The Sunday Noon / Sunday Night style label, or "" when it isn't known. */
function slotOf(game, schedule) {
  var rec = scheduleFor(game, schedule);
  return isTimed(rec) && rec.slot ? rec.slot : "";
}

function dayRank(day) {
  var k = String(day || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(DAY_ORDER, k) ? DAY_ORDER[k] : null;
}

/**
 * A week's games in kickoff order. Returns a new array; the input is untouched.
 *
 * Three keys, in order:
 *   1. day — so the day headings stay contiguous and come out Thu -> Mon even
 *      when a game's own kickoff is unknown;
 *   2. kickoff;
 *   3. the order the PDF had, which breaks every remaining tie.
 */
function orderGames(games, schedule) {
  var list = (games || []).map(function (g, i) {
    var rec = scheduleFor(g, schedule);
    var timed = isTimed(rec);
    return {
      g: g,
      i: i,
      dayRank: dayRank((timed && rec.day) || (g && g.day) || ""),
      t: timed ? Date.parse(rec.kickoff) : null,
      // -1 / 0 / +1: sorts a borrowed time just before or just after the game it
      // was borrowed from, instead of colliding with it and falling back to
      // index order across the whole day.
      phase: 0,
    };
  });
  var i, j;

  // A game with no recognisable day sits under whichever heading it was printed
  // beneath — the same carry-forward the day headings on the page already do.
  for (i = 0; i < list.length; i++) {
    if (list[i].dayRank !== null) continue;
    for (j = i - 1; j >= 0; j--) {
      if (list[j].dayRank !== null) { list[i].dayRank = list[j].dayRank; break; }
    }
  }
  for (i = list.length - 1; i >= 0; i--) {
    if (list[i].dayRank !== null) continue;
    for (j = i + 1; j < list.length; j++) {
      if (list[j].dayRank !== null) { list[i].dayRank = list[j].dayRank; break; }
    }
  }
  for (i = 0; i < list.length; i++) {
    if (list[i].dayRank === null) list[i].dayRank = 0;   // no days anywhere
  }

  // Games the schedule can't time borrow the kickoff of the nearest game beside
  // them on the sheet, within their own day. That is what keeps an unmatched
  // game in its relative position rather than herding every unknown to one end.
  for (i = 0; i < list.length; i++) {
    if (list[i].t !== null) continue;
    var src = null, phase = 0;
    for (j = i - 1; j >= 0; j--) {
      if (list[j].t !== null && list[j].dayRank === list[i].dayRank) {
        src = list[j].t; phase = 1; break;
      }
    }
    if (src === null) {
      for (j = i + 1; j < list.length; j++) {
        if (list[j].t !== null && list[j].dayRank === list[i].dayRank) {
          src = list[j].t; phase = -1; break;
        }
      }
    }
    // Still null means nothing in this day has a kickoff at all; the whole group
    // then falls through to PDF order, which is the best answer available.
    list[i].t = src;
    list[i].phase = src === null ? 0 : phase;
  }

  list.sort(function (a, b) {
    if (a.dayRank !== b.dayRank) return a.dayRank - b.dayRank;
    var at = a.t === null ? 0 : a.t;
    var bt = b.t === null ? 0 : b.t;
    if (at !== bt) return at - bt;
    if (a.phase !== b.phase) return a.phase - b.phase;
    return a.i - b.i;
  });
  return list.map(function (e) { return e.g; });
}

/**
 * Games the schedule has never heard of, for the review table to flag.
 *
 * This is the only signal that a team name has drifted — the ordering itself
 * fails quietly by design, so without this a misspelt "Jaguars" would just sit
 * in the wrong place forever and nobody would know why.
 */
function unscheduled(games, schedule) {
  if (!schedule || !schedule.games) return [];
  return (games || []).filter(function (g) { return !scheduleFor(g, schedule); });
}

var API = {
  orderGames, scheduleFor, effectiveDay, slotOf, unscheduled,
  _internals: { slug, teamCode, dayRank, DAY_ORDER },
};

if (typeof module !== "undefined" && module.exports) module.exports = API;
if (typeof window !== "undefined") window.PickemSchedule = API;
