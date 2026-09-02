#!/usr/bin/env python3
"""Print a week's NFL final scores, ready to type into Rizzlers Pick'ems.

Why this exists: the published app runs inside the claude.ai artifact sandbox,
whose CSP blocks outbound fetch/XHR entirely. The page therefore cannot pull
scores itself — the spec's own fallback (manual entry) applies. Run this on your
machine and read the finals off it.

Endpoint note: the spec's `site.api.espn.com` scoreboard returns HTTP 403
"Access Denied" to non-browser clients. `cdn.espn.com/core/nfl/scoreboard`, the
one espn.com itself calls, serves the same events (plus betting lines) and works.

    python3 tools/fetch_scores.py 2025 7
"""
import json
import sys
import urllib.error
import urllib.request

URL = ("https://cdn.espn.com/core/nfl/scoreboard"
       "?xhr=1&seasontype=2&week={week}&year={season}")


def games(season, week):
    req = urllib.request.Request(
        URL.format(week=week, season=season),
        headers={"User-Agent": "Mozilla/5.0 (rizzlers-pickems)"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    return data["content"]["sbData"]["events"]


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: fetch_scores.py <season> <week>")
    season, week = int(sys.argv[1]), int(sys.argv[2])
    try:
        events = games(season, week)
    except (urllib.error.URLError, urllib.error.HTTPError, KeyError, ValueError) as e:
        sys.exit(f"could not load scoreboard: {e}")

    print(f"{season} week {week} — {len(events)} games\n")
    for ev in events:
        comp = ev["competitions"][0]
        home = next(c for c in comp["competitors"] if c["homeAway"] == "home")
        away = next(c for c in comp["competitors"] if c["homeAway"] == "away")
        st = ev["status"]["type"]
        done = st.get("completed")
        line = (f'{away["team"]["displayName"]:<24} {away.get("score",""):>3}   '
                f'at   {home["team"]["displayName"]:<24} {home.get("score",""):>3}')
        print(f'{line}   {"FINAL" if done else st.get("shortDetail","")}')

    pending = [e for e in events if not e["status"]["type"].get("completed")]
    if pending:
        print(f"\n{len(pending)} game(s) not final yet — don't enter those.")


if __name__ == "__main__":
    main()
