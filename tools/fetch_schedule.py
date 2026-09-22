#!/usr/bin/env python3
"""Bake the full-season NFL schedule into lib/schedule-<season>.json.

Why this exists: the commissioner's PDF has no kickoff times, so within a day —
Sunday especially — the games come off the sheet in arbitrary order. The app
can't look the times up itself (the artifact sandbox blocks every outbound
request), so the schedule has to ship inside the page. This writes the file that
build.mjs inlines.

    python3 tools/fetch_schedule.py 2026

Re-runnable, and meant to be re-run: flex scheduling moves Sunday games into the
night slot late in the season. A second run rewrites only what actually changed
and prints the moves it found. A run that changes nothing leaves the file alone.

Endpoint notes, both learned the hard way:

  * `site.api.espn.com` — what the spec names — returns HTTP 403 to non-browser
    clients. Unusable. (Same finding as tools/fetch_scores.py.)
  * `cdn.espn.com/core/nfl/schedule?xhr=1&...` works, but it is a cold CDN cache:
    a week nobody has requested recently answers HTTP 202 with an empty body and
    populates asynchronously. Retrying rode that out for some weeks and never for
    others, so it cannot be the only source.
  * `cdn.espn.com/core/nfl/scoreboard?xhr=1&...` serves the same events one level
    deeper (`content.sbData.events[]`), always 200, and carries every field this
    needs. It is the fallback, and in practice it is what usually answers.

`timeValid: false` means ESPN is showing a placeholder, not a kickoff — all of
Week 18 and the late-season flex games look like "Saturday 11:00 PM". Those are
recorded with `"tbd": true` and no day/slot, and the app leaves them in the
order the PDF had them rather than trusting a fake time.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

# The league runs on Eastern time but Peter reads this in Minnesota, and the
# day a game belongs to has to match the day the commissioner's sheet prints.
# Central gets both right: a Sunday nighter kicks at 19:20 CT, still Sunday.
LOCAL = ZoneInfo("America/Chicago")
UTC = ZoneInfo("UTC")

SCHEDULE_URL = ("https://cdn.espn.com/core/nfl/schedule"
                "?xhr=1&year={season}&week={week}&seasontype=2")
SCOREBOARD_URL = ("https://cdn.espn.com/core/nfl/scoreboard"
                  "?xhr=1&seasontype=2&week={week}&year={season}")
# The User-Agent decides whether this works, and not the way you'd guess: a full
# Chrome UA string gets HTTP 202 and an empty body on nearly every week, while
# the plain one tools/fetch_scores.py has always used gets 200 and the data.
# Measured, not assumed — don't "improve" this to look more like a browser.
UA = "Mozilla/5.0 (rizzlers-pickems)"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Names the PDF uses that no ESPN field produces. Everything else is generated
# from the API's own location / displayName / nickname / abbreviation.
EXTRA_ALIASES = {
    "ARI": ["Arizona Cardinals", "ARZ"],
    "BAL": ["BLT"],
    "CLE": ["CLV"],
    "GB": ["GNB", "Green Bay Packers"],
    "HOU": ["HST"],
    "JAX": ["JAC", "Jacksonville Jaguars"],
    "KC": ["KAN", "Kansas City Chiefs"],
    "LAC": ["LA Chargers", "L.A. Chargers", "Los Angeles Chargers"],
    "LAR": ["LA Rams", "L.A. Rams", "Los Angeles Rams"],
    "LV": ["LVR", "Las Vegas Raiders"],
    "NE": ["NWE", "New England Patriots"],
    "NO": ["NOR", "New Orleans Saints"],
    "NYG": ["NY Giants", "N.Y. Giants", "New York Giants"],
    "NYJ": ["NY Jets", "N.Y. Jets", "New York Jets"],
    "SF": ["SFO", "San Francisco 49ers", "Niners"],
    "TB": ["TAM", "Tampa Bay Buccaneers", "Bucs"],
    "WSH": ["WAS", "Washington", "Washington Commanders",
            "Washington Football Team"],
}


def slug(s):
    """Byte-for-byte the slug() in lib/parse-lines.js — ids have to line up."""
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower())
    return re.sub(r"^-|-$", "", s)


def get(url, attempts=6):
    """GET with retries. An empty 202 is a cold CDN cache, not an error.

    The backoff is doing real work: ESPN's edge starts answering 202 to
    everything if you walk eighteen weeks back to back, and only a pause gets it
    talking again. Slow and finishing beats fast and half a season.
    """
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read()
            if body:
                return json.loads(body)
            last = f"HTTP {r.status} with an empty body"
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as e:
            last = str(e)
        time.sleep(2.0 * (i + 1))
    raise RuntimeError(last or "no response")


def week_events(season, week):
    """The week's raw ESPN events, from whichever endpoint answers."""
    try:
        data = get(SCHEDULE_URL.format(season=season, week=week), attempts=2)
        days = data["content"]["schedule"]
        events = []
        for key in sorted(days):
            events.extend(days[key].get("games", []))
        if events:
            return events, "schedule"
    except (RuntimeError, KeyError, TypeError):
        pass
    data = get(SCOREBOARD_URL.format(season=season, week=week))
    return data["content"]["sbData"]["events"], "scoreboard"


def slot_for(kick, international):
    """Which named slot a kickoff falls in, in Central time."""
    if international:
        return "International"
    day, hour = kick.strftime("%A"), kick.hour
    if day == "Sunday":
        if hour < 11:
            return "Sunday Morning"
        if hour < 14:
            return "Sunday Noon"
        if hour < 18:
            return "Sunday Afternoon"
        return "Sunday Night"
    if day in ("Thursday", "Friday", "Saturday", "Monday"):
        return f"{day} Night" if hour >= 17 else f"{day} Afternoon"
    return day


def parse_event(ev, week):
    comp = ev["competitions"][0]
    teams = {}
    for c in comp["competitors"]:
        teams[c["homeAway"]] = c["team"]
    if "home" not in teams or "away" not in teams:
        return None, None

    kick_utc = datetime.strptime(ev["date"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=UTC)
    kick = kick_utc.astimezone(LOCAL)
    # timeValid=False is a placeholder, not a kickoff. Week 18 is entirely this.
    tbd = comp.get("timeValid") is False
    country = (comp.get("venue") or {}).get("address", {}).get("country", "USA")
    international = country not in ("USA", "US", None)

    key = slug(teams["away"]["abbreviation"] + "-" + teams["home"]["abbreviation"])
    rec = {
        "week": week,
        "kickoff": kick_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "away": teams["away"]["abbreviation"],
        "home": teams["home"]["abbreviation"],
    }
    if tbd:
        # No day, no slot: anything derived from a placeholder time is a lie,
        # and the app is built to fall back to the PDF when those are missing.
        rec["tbd"] = True
    else:
        rec["day"] = kick.strftime("%A")
        rec["slot"] = slot_for(kick, international)
    return key, (rec, [teams["away"], teams["home"]])


def build_aliases(seen):
    """slug(name) -> abbreviation, dropping anything that names two teams.

    "Los Angeles" and "New York" each cover two clubs, so they are ambiguous by
    construction and get thrown out — the PDF writes "LA Rams" and "NY Jets"
    anyway. Letting either through would silently key half those games wrong.
    """
    candidates = {}
    for abbr, team in seen.items():
        names = [abbr, team.get("location"), team.get("displayName"),
                 team.get("shortDisplayName"), team.get("name")]
        names += EXTRA_ALIASES.get(abbr, [])
        for n in names:
            s = slug(n)
            if s:
                candidates.setdefault(s, set()).add(abbr)

    aliases, dropped = {}, []
    for s, owners in candidates.items():
        if len(owners) == 1:
            aliases[s] = next(iter(owners))
        else:
            dropped.append((s, sorted(owners)))
    return aliases, dropped


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: fetch_schedule.py <season>")
    season = int(sys.argv[1])
    out_path = os.path.join(ROOT, "lib", f"schedule-{season}.json")

    games, seen, sources = {}, {}, set()
    for week in range(1, 19):
        if week > 1:
            time.sleep(1.0)          # pace it, or the edge starts stonewalling
        try:
            events, src = week_events(season, week)
        except (RuntimeError, KeyError, TypeError) as e:
            sys.exit(f"week {week}: could not load the schedule: {e}")
        sources.add(src)
        for ev in events:
            key, parsed = parse_event(ev, week)
            if not key:
                continue
            rec, teams = parsed
            if key in games:
                print(f"  ! duplicate key {key} (week {week}) — keeping the first")
                continue
            games[key] = rec
            for t in teams:
                seen[t["abbreviation"]] = t
        print(f"  week {week:>2}: {len(events):>2} games  [{src}]", flush=True)

    if len(seen) != 32:
        print(f"  ! saw {len(seen)} teams, expected 32")

    aliases, dropped = build_aliases(seen)
    for s, owners in sorted(dropped):
        print(f"  ambiguous alias dropped: {s!r} -> {', '.join(owners)}")

    payload = {
        "season": season,
        "teams": dict(sorted(aliases.items())),
        "games": dict(sorted(games.items())),
    }

    # Re-runnable: say what moved, and don't churn the file when nothing did.
    old = None
    if os.path.exists(out_path):
        with open(out_path, encoding="utf-8") as f:
            old = json.load(f)
    if old:
        moves = []
        for key, rec in payload["games"].items():
            prev = old.get("games", {}).get(key)
            if prev and prev.get("kickoff") != rec["kickoff"]:
                moves.append(f"  moved {key}: {prev.get('kickoff')} -> {rec['kickoff']}")
        added = sorted(set(payload["games"]) - set(old.get("games", {})))
        gone = sorted(set(old.get("games", {})) - set(payload["games"]))
        for line in moves:
            print(line)
        for k in added:
            print(f"  new game {k}")
        for k in gone:
            print(f"  game gone {k}")
        if {k: v for k, v in old.items() if k != "generated"} == payload:
            print(f"\nno changes — {out_path} left alone")
            return

    payload["generated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=1, sort_keys=True)
        f.write("\n")

    tbd = sum(1 for g in payload["games"].values() if g.get("tbd"))
    print(f"\n{out_path}")
    print(f"{len(payload['games'])} games · {len(payload['teams'])} name aliases "
          f"· {tbd} with no confirmed kickoff yet · via {'+'.join(sorted(sources))}")
    print("run `npm run build` to bake it into dist/index.html")


if __name__ == "__main__":
    main()
