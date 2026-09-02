/*
 * parse-lines.js — turn a weekly spreads PDF into structured games.
 *
 * THE WHOLE PROBLEM is that the spread number carries no label. Which team is
 * favored is encoded ONLY in where the number sits horizontally: it is printed
 * directly above the favored team's name. Flatten the PDF to plain text and that
 * information is gone — "LA Rams at Jacksonville" with a "3" over the Rams and a
 * "3" over Jacksonville produce identical text and opposite meanings.
 *
 * So this parser works on positioned words: {str, x, y, w}, where x/y are the
 * word's left edge and baseline in PDF text space (y increases UPWARD, so a
 * larger y is higher on the page) and w is its rendered width. Every consumer
 * has to supply that; pdf.js gives it via getTextContent().
 *
 * The layout, per the spec and confirmed against a real sheet:
 *   Week N
 *   <weekday>                     <- section header, days vary week to week
 *   [ box ] [ box ]               <- ~2 game boxes per row
 *      each box:  (optional note, e.g. "London 8:30 AM")
 *                 <spread>        <- positioned over the favored side
 *                 Away  at  Home
 *   Teams on Bye: A, B
 *   Name ______                   <- vestigial, ignored
 *
 * Everything here is pure and synchronous so it can be unit-tested against a
 * synthetic word list without a PDF or a browser.
 */

const DAYS = ["monday", "tuesday", "wednesday", "thursday",
              "friday", "saturday", "sunday"];

// A spread can arrive as "5 1/2" (two tokens), "5 1/2" (one), "5\u00bd" (one glyph),
// "\u00bd" on its own, "7", "3.5", or "PK". Real sheets use the vulgar-fraction
// characters far more often than "1/2", and missing them made whole games look
// like they had no spread at all.
// Written as \u escapes on purpose: this file gets inlined into the page, and if
// the document is ever served without a UTF-8 charset these keys decode to
// mojibake, stop matching what pdf.js hands back, and every half-point spread
// silently becomes NaN.
const VULGAR = {
  "\u00bd": 0.5, "\u00bc": 0.25, "\u00be": 0.75,
  "\u2153": 1 / 3, "\u2154": 2 / 3,
  "\u215b": 0.125, "\u215c": 0.375, "\u215d": 0.625, "\u215e": 0.875,
};
const VULGAR_CLASS = "\u00bd\u00bc\u00be\u2153\u2154\u215b\u215c\u215d\u215e";

const NUM_RE = new RegExp(`^\\d{1,2}(\\.\\d+)?[${VULGAR_CLASS}]?$`);
const VULGAR_ONLY_RE = new RegExp(`^[${VULGAR_CLASS}]$`);
const NUM_FRAC_RE = /^(\d{1,2})\s+(\d)\/(\d)$/;   // "5 1/2" as a single token
const FRAC_RE = /^(\d)\/(\d)$/;
const PK_RE = /^(pk|pick|pick'?em|even|ev)$/i;

function isNumberish(s) {
  const t = (s || "").trim();
  return NUM_RE.test(t) || VULGAR_ONLY_RE.test(t) || NUM_FRAC_RE.test(t)
      || FRAC_RE.test(t) || PK_RE.test(t);
}

function tokenValue(s) {
  const t = (s || "").trim();
  if (PK_RE.test(t)) return 0;
  const nf = t.match(NUM_FRAC_RE);
  if (nf) return Number(nf[1]) + Number(nf[2]) / Number(nf[3]);
  const f = t.match(FRAC_RE);
  if (f) return Number(f[1]) / Number(f[2]);
  if (VULGAR_ONLY_RE.test(t)) return VULGAR[t];
  const last = t.slice(-1);
  if (VULGAR[last]) return Number(t.slice(0, -1) || 0) + VULGAR[last];
  return Number(t);
}

/** Words on roughly the same baseline, left to right. */
function groupRows(words, tol = 3) {
  const rows = [];
  for (const w of [...words].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - w.y) <= tol);
    if (row) row.items.push(w);
    else rows.push({ y: w.y, items: [w] });
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

/**
 * Find every matchup on one row, anchored on the word "at".
 *
 * Do NOT try to do this by clustering words into boxes on a gap threshold: the
 * space between "Pittsburgh" and "at" on a real sheet is as wide as the gap
 * between two side-by-side boxes, so any single threshold either merges two
 * games or splits one in half. The "at" is unambiguous, so anchor on it and,
 * when two games share a row, cut between them at the widest gap.
 */
function matchupsInRow(row) {
  const items = row.items;
  const ats = [];
  items.forEach((it, i) => { if (/^at$/i.test(it.str.trim())) ats.push(i); });

  // A whole matchup can also arrive as one combined text run.
  if (!ats.length) {
    const out = [];
    for (const it of items) {
      const teams = splitTeams(it.str);
      if (teams) {
        out.push({ teams, x0: it.x, x1: it.x + it.w, y: row.y,
                   bx: boundaryInRun(it) });
      }
    }
    return out;
  }

  /** Index of the token just after the widest gap in [a,b]; b+1 if none. */
  function cutAfterWidestGap(a, b) {
    let best = b + 1, bestGap = -1;
    for (let i = a; i < b; i++) {
      const gap = items[i + 1].x - (items[i].x + items[i].w);
      if (gap > bestGap) { bestGap = gap; best = i + 1; }
    }
    return best;
  }

  const out = [];
  for (let k = 0; k < ats.length; k++) {
    const ai = ats[k];
    const prevAt = k > 0 ? ats[k - 1] : -1;
    const nextAt = k < ats.length - 1 ? ats[k + 1] : items.length;

    const awayStart = prevAt === -1 ? 0 : cutAfterWidestGap(prevAt + 1, ai - 1);
    const homeEnd = nextAt === items.length
      ? items.length - 1
      : cutAfterWidestGap(ai + 1, nextAt - 1) - 1;

    const away = items.slice(awayStart, ai).map((i) => i.str).join(" ").trim();
    const home = items.slice(ai + 1, homeEnd + 1).map((i) => i.str).join(" ").trim();
    if (!away || !home) continue;
    if (away.length > 24 || home.length > 24) continue;
    if (/\d/.test(away) || /\d/.test(home)) continue;

    out.push({
      teams: { away, home },
      x0: items[awayStart].x,
      x1: items[homeEnd].x + items[homeEnd].w,
      y: row.y,
      bx: items[ai].x + items[ai].w / 2,
    });
  }
  return out;
}

/** Boundary x inside a single combined run like "Buffalo    at    Miami". */
function boundaryInRun(it) {
  const idx = it.str.search(/\bat\b/i);
  if (idx < 0 || !it.str.length) return it.x + it.w / 2;
  return it.x + it.w * ((idx + 1) / it.str.length);
}

/** Split one row into clusters separated by wide horizontal gaps (= separate boxes). */
function splitCells(row, gap = 34) {
  const cells = [];
  let cur = null;
  for (const it of row.items) {
    if (cur && it.x - (cur.x1) <= gap) {
      cur.items.push(it);
      cur.x1 = Math.max(cur.x1, it.x + it.w);
    } else {
      cur = { items: [it], x0: it.x, x1: it.x + it.w, y: row.y };
      cells.push(cur);
    }
  }
  for (const c of cells) c.text = c.items.map((i) => i.str).join(" ")
    .replace(/\s+/g, " ").trim();
  return cells;
}

/**
 * Where does the away team's name end and the home team's begin, in x?
 * Prefer the actual "at" token; fall back to interpolating within a combined run.
 */
function boundaryX(cell) {
  const at = cell.items.find((i) => /^at$/i.test(i.str.trim()));
  if (at) return at.x + at.w / 2;
  for (const it of cell.items) {
    const idx = it.str.search(/\bat\b/i);
    if (idx >= 0 && it.str.length) {
      return it.x + it.w * ((idx + 1) / it.str.length);
    }
  }
  return (cell.x0 + cell.x1) / 2;
}

/** "LA Rams at Jacksonville" -> {away, home}; null when it isn't a matchup. */
function splitTeams(text) {
  const m = text.match(/^(.*?)\s+\bat\b\s+(.*)$/i);
  if (!m) return null;
  const away = m[1].replace(/\s+/g, " ").trim();
  const home = m[2].replace(/\s+/g, " ").trim();
  if (!away || !home) return null;
  // guard against prose lines that happen to contain " at "
  if (away.length > 24 || home.length > 24) return null;
  if (/\d/.test(away) || /\d/.test(home)) return null;
  return { away, home };
}

/**
 * Main entry. `words` = [{str, x, y, w}], `pageWidth` for the column split.
 * Returns {week, games, byes, warnings}.
 */
function parseWords(words, pageWidth) {
  const warnings = [];
  const rows = groupRows(words.filter((w) => (w.str || "").trim()));

  // --- week number ---
  let week = null;
  for (const r of rows) {
    const t = r.items.map((i) => i.str).join(" ").trim();
    const m = t.match(/\bweek\s+(\d{1,2})\b/i);
    if (m) { week = Number(m[1]); break; }
  }

  // --- day section headers, by vertical position ---
  const dayHeaders = [];
  for (const r of rows) {
    for (const c of splitCells(r)) {
      const t = c.text.replace(/[^A-Za-z]/g, "").toLowerCase();
      if (DAYS.includes(t)) dayHeaders.push({ day: cap(t), y: r.y });
    }
  }
  dayHeaders.sort((a, b) => b.y - a.y);

  // --- bye teams ---
  const byes = [];
  for (const r of rows) {
    const t = r.items.map((i) => i.str).join(" ");
    const m = t.match(/teams?\s+on\s+bye\s*:?\s*(.*)$/i);
    if (m && m[1].trim()) {
      for (const p of m[1].split(/,|•/)) {
        const v = p.trim();
        if (v && !/^name\b/i.test(v)) byes.push(v);
      }
    }
  }

  // --- candidate spread tokens and matchup cells ---
  const gameCells = [];
  const skipRow = new Set();
  for (const r of rows) {
    const rowText = r.items.map((i) => i.str).join(" ");
    // rows that are structure, not game data — their numbers are not spreads
    if (/teams?\s+on\s+bye/i.test(rowText) || /^\s*name\b/i.test(rowText.trim())
        || /\bweek\s+\d{1,2}\b/i.test(rowText)) {
      skipRow.add(r);
      continue;
    }
    const found = matchupsInRow(r);
    for (const m of found) gameCells.push(m);
    const rowLetters = rowText.replace(/[^A-Za-z]/g, "").toLowerCase();
    if (!found.length && DAYS.includes(rowLetters)) skipRow.add(r);
  }
  const matchupRows = new Set(gameCells.map((g) => g.y));

  // Collect spread candidates from INDIVIDUAL number-ish words rather than
  // requiring a whole cell to be numeric — a spread printed next to a note
  // ("London 8:30 AM") lands in the same cell and used to be discarded outright,
  // which is what made games report no spread when the sheet plainly had one.
  const spreads = [];
  for (const r of rows) {
    if (skipRow.has(r) || matchupRows.has(r.y)) continue;
    const nums = r.items.filter((i) => isNumberish(i.str));
    let group = null;
    for (const it of nums) {
      if (group && it.x - group.x1 <= 18) {
        group.parts.push(it);
        group.x1 = it.x + it.w;
      } else {
        group = { parts: [it], x0: it.x, x1: it.x + it.w, y: r.y };
        spreads.push(group);
      }
    }
  }
  for (const s of spreads) {
    s.value = s.parts.reduce((sum, i) => sum + tokenValue(i.str), 0);
    s.x = (s.x0 + s.x1) / 2;
    s.used = false;
  }

  // --- pair each matchup with the nearest spread ABOVE it, in its own box ---
  // Matching by which half of the page a token sits in was too crude: a box that
  // straddles the midpoint put the spread and its matchup in different "columns"
  // and they never paired. Overlap against the actual matchup's x-range instead.
  const games = [];
  gameCells.sort((a, b) => b.y - a.y || a.x0 - b.x0);
  for (const g of gameCells) {
    const bx = g.bx;
    const pad = 24;
    const cands = spreads
      .filter((s) => !s.used && s.y > g.y && s.y - g.y < 90
                     && s.x >= g.x0 - pad && s.x <= g.x1 + pad)
      .sort((a, b) => (a.y - g.y) - (b.y - g.y));
    const s = cands[0];
    let spread = null, favored = null;
    if (s) {
      s.used = true;
      spread = s.value;
      favored = s.x < bx ? "away" : "home";
    } else {
      warnings.push(`No spread found above "${g.teams.away} at ${g.teams.home}"`);
    }
    // the nearest header ABOVE the game, not merely the first one
    const above = dayHeaders.filter((d) => d.y > g.y);
    const day = above.length ? above[above.length - 1].day : "";
    games.push({
      id: slug(`${g.teams.away}-${g.teams.home}`),
      day,
      away: g.teams.away,
      home: g.teams.home,
      spread,
      favored,
      note: "",
    });
  }

  if (!games.length) warnings.push("No matchups found — is this the right PDF?");
  return { week, games, byes, warnings };
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/* ---------------------------------------------------------------- grading */

/**
 * Against-the-spread result for one game.
 * margin = (favorite score - underdog score) - spread
 *   > 0 favorite covered · < 0 underdog covered · 0 push (void)
 * Returns "away" | "home" | "push" | null (not gradeable yet).
 */
function atsWinner(game, score) {
  if (!score) return null;
  const { awayScore: a, homeScore: h } = score;
  if (a == null || h == null || a === "" || h === "") return null;
  if (game.spread == null || !game.favored) return null;
  const favIsAway = game.favored === "away";
  const favScore = favIsAway ? Number(a) : Number(h);
  const dogScore = favIsAway ? Number(h) : Number(a);
  if (Number.isNaN(favScore) || Number.isNaN(dogScore)) return null;
  const margin = (favScore - dogScore) - Number(game.spread);
  if (margin === 0) return "push";
  const favWon = margin > 0;
  if (favIsAway) return favWon ? "away" : "home";
  return favWon ? "home" : "away";
}

/** Majority of exactly three picks; null until all three are in. */
function majority(picksForGame, people) {
  const votes = people.map((p) => picksForGame[p]).filter(Boolean);
  if (votes.length < people.length) return null;
  const tally = {};
  for (const v of votes) tally[v] = (tally[v] || 0) + 1;
  let best = null;
  for (const k of Object.keys(tally)) {
    if (!best || tally[k] > tally[best]) best = k;
  }
  return best;
}

/** {w,l,p} for a set of side-picks against results. */
function tally(games, sideFor, resultFor) {
  const rec = { w: 0, l: 0, p: 0 };
  for (const g of games) {
    const side = sideFor(g);
    const res = resultFor(g);
    if (!side || !res) continue;
    if (res === "push") rec.p++;
    else if (side === res) rec.w++;
    else rec.l++;
  }
  return rec;
}

const API = {
  parseWords, atsWinner, majority, tally,
  // exported for tests
  _internals: { groupRows, splitCells, splitTeams, boundaryX, isNumberish, tokenValue },
};

if (typeof module !== "undefined" && module.exports) module.exports = API;
if (typeof window !== "undefined") window.PickemParser = API;
