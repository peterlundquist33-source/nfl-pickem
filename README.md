# Rizzlers Pick'ems

Season-long NFL pick'em against the spread for three people — Peter, Dalton and
Hunter. Built to `spec/NFL_Pickems_Tracker_Spec.pdf`.

Each week the commissioner sends a PDF of the point spreads. Everyone picks a
side on every game; the 2-1 or 3-0 majority becomes the group's official pick.
Once finals are in, every game is graded against the spread and the app keeps
both the group's record and each person's individual accuracy.

## Where it runs

**The app:** https://claude.ai/code/artifact/03fc058e-57ac-4d6d-92ed-26c46cd337c3 — published as
a Claude Artifact, which is what gives it a shared
database all three people write to from their own devices. Share it from the
page's share menu to let Dalton and Hunter in.

**This repo:** the source, the tests, and the tooling.

```
lib/parse-lines.js   the PDF parser + ATS grading math (pure, unit-tested)
src/index.html       the app
build.mjs            inlines the parser into src/ -> dist/index.html
dist/index.html      the single self-contained file that gets published
test/parse.test.js   14 tests
tools/fetch_scores.py  prints a week's finals to type in
tools/local-stub.mjs   fake database so the app can be driven on localhost
```

```sh
npm test      # run the tests
npm run build # regenerate dist/index.html
```

Publishing is a manual step: build, then publish `dist/index.html` to the
existing artifact URL so the link and its data stay put.

## The part that matters: which team is favored

The spread number on the sheet carries **no label**. The only thing that says who
is favored is *where the number sits horizontally* — it's printed directly above
the favored team's name.

Flatten the PDF to text and that is gone. `LA Rams at Jacksonville` with a `3`
over the Rams and a `3` over Jacksonville extract to identical strings and mean
opposite things. Anything that reads the PDF as a stream of text — PyPDF2,
`pdftotext`, most quick approaches — will silently get half the games backwards.

So `lib/parse-lines.js` works on positioned words (`{str, x, y, w}`), finds the
`at` token to locate the boundary between the two team names, and compares the
spread's x-position against it. In the browser those coordinates come from
pdf.js's `getTextContent()`. The test suite covers the real case the spec calls
out: the Rams favored *on the road* in London.

The parser is deliberately conservative — when it can't find a spread above a
matchup it records a warning and leaves the field blank rather than guessing.
Every parse lands in an editable review table and nothing is saved until a human
confirms it.

## Design

Steel blue on graphite — a trading terminal rather than a sports template. Three
rules hold it together:

- **One accent, spent sparingly.** Steel blue (`#5aa9f0`) marks only what needs
  marking — the active tab, the group's pick, the primary button. Green and red
  are semantic and mean results, nothing else; blue sits furthest in hue from
  both, so an accent is never mistaken for an outcome.
- **Hairlines, not boxes.** Related rows share one panel separated by 1px
  hairlines. A border per element is what made it read as a template.
- **Monospaced figures throughout.** Every spread, score and record is IBM Plex
  Mono with tabular numerals, so columns of numbers line up — that alignment is
  most of the "paid product" feel.

Type is Instrument Sans for UI and IBM Plex Mono for all data. Tokens live at the
top of the `<style>` block in `src/index.html`, named by role (`--accent`, not a
colour name), so the whole site reskins from `:root` alone.

Two constraints on any future palette: green and red are load-bearing (covered /
didn't cover), so an accent in either hue makes results ambiguous; and the "win"
green has to separate from the felt ground, which is why it's a bright mint.

## The Home tab

Opens on the most recently uploaded week and acts as the hub. One row per game,
two sides: each carries its spread and the initials of whoever took it. An amber
outline is the group's majority, green is the side that covered, and the box on
the right reads the group's result — check, cross, `=` for a push, or `n/3` while
picks are still coming in. A full slate fits on one screen. Above it sit this
week's records and shortcuts into Picks, Scores and Standings.

"Most recent" means most recently *uploaded* (by `savedAt`), not the highest
number, so uploading a catch-up week lands you on it. Choosing a week yourself
sticks; a new upload won't yank you off what you're looking at.

Near the top sits a ready-made message for the commissioner, listing the group's
majority pick per game, with a copy button. Games still short of all three picks
appear as `TBD (Away at Home)` and are counted in a warning above the box, so
nobody sends an incomplete slate without noticing. The commissioner's name is the
`COMMISSIONER` constant in `src/index.html`.

## Grading a week

Click whichever team **covered the spread** — one click per game, no typing. The
spread is printed on each button, and there's a Push option for the whole-number
lines that can land exactly. That result is what grades the week.

Exact final scores are still available under "Add exact scores", collapsed,
because they're worth recording and they show on the picks page. Typing a full
score settles that game's result too, if one isn't already set. Weeks graded the
old way keep working: a clicked result wins, a score-derived one is the fallback.

Weeks appear as buttons on the Picks, Scores and Lines tabs, each showing its
state (picks in, games graded), so moving between them is one click.

## Scores from ESPN

The app **cannot fetch scores itself**. It runs in a sandbox whose CSP blocks all
outbound requests, so finals are typed in — the fallback the spec allows. Grading
is identical either way.

`tools/fetch_scores.py 2025 7` prints a week's finals to copy from.

> **The spec's scoreboard endpoint does not work.** `site.api.espn.com` returns
> HTTP 403 "Access Denied" to non-browser clients, despite the spec recording it
> as tested live. `cdn.espn.com/core/nfl/scoreboard?xhr=1&week=N&year=YYYY` —
> the one espn.com itself calls — serves the same events one level deeper at
> `content.sbData.events[]`, with the same `homeAway` / `score` /
> `team.displayName` / `status.type.completed` fields, plus betting lines.

## Grading rules

`margin = (favorite's score − underdog's score) − spread`

Positive means the favorite covered, negative means the underdog did, exactly
zero is a **push** — void, no win or loss for anyone, counted separately and
excluded from win percentages. A game is graded only once both finals are in; a
game missing anyone's pick is left out of the group record until all three are in.

## Decisions taken

The spec left these open (§8); these are the calls made, all easy to revisit.

**Hosting.** The requirement that three people submit picks independently from
anywhere means shared server-side state, which a static host can't provide. The
artifact runtime's database was the shortest path to a real hosted app with no
accounts, servers or bills. Trade-off: the CSP that makes it safe is also what
blocks automatic score fetching.

**Duplicate upload.** Overwrite, behind a confirmation naming the week. Existing
picks survive, but a game whose teams were edited gets a new id and loses its
picks — the warning says so.

**Pick locking.** None. Picks stay editable, per the spec's own recommendation
for three trusted friends.

**Deleting a week.** The Lines tab has a delete for the selected week, behind a
two-step confirmation. It removes that week's lines, all three people's picks and
its scores together — leaving any of those behind would let a re-upload inherit
picks from games that no longer exist. Handy for clearing a test run.

Confirmations are inline rather than `confirm()` dialogs, which a sandboxed frame
can block outright — a blocked dialog would have made overwriting a week appear
to do nothing.

**Identity is the password.** You type your name — Peter, Dalton or Hunter — and
that both lets you in and says who you are, then drops you on your picks. One
field instead of a shared passcode plus a separate "who are you" menu, and picks
can't be filed under the wrong person by mistake. Matching ignores case and
whitespace, and `ALIASES` in `src/index.html` catches near-misses ("Daulton").
"Switch" in the header clears the session and returns to the gate.

This is a latch, not security: the names are in the page source, as any
client-side gate must be. It keeps strangers out of a link that gets passed
around; it is not a login, and it isn't meant to stop the three of you from
picking as each other if you set your mind to it.

## Known limits

- The parser has never seen a real weekly PDF — none was available when this was
  built. It's written to the spec's description and tested against a
  reconstruction of that layout. **Check the first real upload carefully**; if
  the sheet's geometry differs, the review table lets you fix it by hand and
  `test/parse.test.js` is where a corrected fixture should go.
- Team names aren't normalized against any external list, since scores are
  entered by hand. That mapping only becomes necessary if score fetching is ever
  automated.
- Regular season only (Weeks 1–18), no playoffs, no money tracking — all out of
  scope per the spec.
