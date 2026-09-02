# Cover Three

Season-long NFL pick'em against the spread for three people — Peter, Dalton and
Hunter. Built to `spec/NFL_Pickems_Tracker_Spec.pdf`.

Each week the commissioner sends a PDF of the point spreads. Everyone picks a
side on every game; the 2-1 or 3-0 majority becomes the group's official pick.
Once finals are in, every game is graded against the spread and the app keeps
both the group's record and each person's individual accuracy.

## Where it runs

**The app:** published as a Claude Artifact, which is what gives it a shared
database all three people write to from their own devices. The link lives with
Peter.

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

## Scores

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

**Identity.** Choose your name from a menu, remembered on that device. No
passwords — the shared passcode gates the site, as specified.

**Passcode.** Client-side, so treat it as a "keep strangers out" latch rather
than security. Real access control is the artifact's own sharing setting: only
people given the link and signed in to the right organization can open it at all.

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
