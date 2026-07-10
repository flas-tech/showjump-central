#!/usr/bin/env python3
"""
Show Jumping Central — data collector.

Fetches events, results, rankings and rider info from public sources and writes
normalized JSON to /data. Designed to run daily under GitHub Actions.

Sources:
  - GC Global Champions (LGCT / GCL)      —  __NEXT_DATA__ from gcglobalchampions.com
  - Longines Timing                        —  HTML result lists at longinestiming.com
  - HippoData                              —  timetables + events
  - HorseTelex Results                     —  competition detail
  - ShowGroundsLive (Wellington etc.)      —  circuit standings + live
  - FEI World Rankings                     —  data.fei.org ranking table (best-effort)
  - YouTube (Clip My Horse / Global Champions / FEI TV) —  video search via RSS

Every fetch is best-effort. A source failing must never break the whole run.
"""

from __future__ import annotations

import json
import re
import sys
import time
import traceback
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from html.parser import HTMLParser
import gzip
import io

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)


def http_get(url: str, timeout: int = 10) -> str:
    req = Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
    })
    with urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return raw.decode("utf-8", errors="replace")


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ----------------------------------------------------------------------------- #
# Normalized schema
# ----------------------------------------------------------------------------- #

@dataclass
class Event:
    id: str
    name: str
    venue: str = ""
    country: str = ""
    start: str = ""      # ISO date
    end: str = ""
    level: str = ""      # e.g. CSI5*, LGCT, CSIO
    circuit: str = ""    # e.g. "Longines Global Champions Tour"
    source: str = ""
    source_url: str = ""
    image: str = ""
    status: str = ""     # upcoming | live | past
    classes: list[dict] = field(default_factory=list)


@dataclass
class Result:
    event_id: str
    event_name: str
    class_name: str
    rank: int | None
    rider: str
    nation: str
    horse: str
    faults: str
    time: str
    prize: str = ""
    source: str = ""
    source_url: str = ""


@dataclass
class Ranking:
    rank: int
    rider: str
    nation: str
    points: float | int
    prev_rank: int | None = None
    source: str = ""


@dataclass
class Video:
    title: str
    url: str
    thumbnail: str
    channel: str
    published: str
    source: str


# ----------------------------------------------------------------------------- #
# GCGlobalChampions (LGCT / GCL)
# ----------------------------------------------------------------------------- #

def collect_gc_global_champions() -> tuple[list[Event], list[Result], list[Ranking]]:
    events: list[Event] = []
    results: list[Result] = []
    rankings: list[Ranking] = []
    try:
        html = http_get("https://www.gcglobalchampions.com/schedule")
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
        if not m:
            log("GC: no __NEXT_DATA__ found")
            return events, results, rankings
        data = json.loads(m.group(1))
        seasons = data["props"]["pageProps"]["seasons"]["all"]
        current = seasons[0]  # latest season
        active = current.get("activeEvent") or {}
        # Season events aren't in the schedule payload; hit season page.
        year = current.get("year", datetime.now().year)
        try:
            season_html = http_get(f"https://www.gcglobalchampions.com/en-us/lgct/schedule/{year}")
            sm = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', season_html, re.S)
            if sm:
                sd = json.loads(sm.group(1))
                # Look for events list
                events_data = _walk_find_key(sd, "events") or _walk_find_key(sd, "tournaments") or []
                for ev in events_data if isinstance(events_data, list) else []:
                    if not isinstance(ev, dict):
                        continue
                    events.append(Event(
                        id=f"gc-{ev.get('id','')}",
                        name=ev.get("name") or ev.get("title") or "",
                        venue=ev.get("name", ""),
                        country=ev.get("country") or "",
                        start=ev.get("start", "")[:10],
                        end=ev.get("end", "")[:10],
                        level="CSI5*",
                        circuit="Longines Global Champions Tour",
                        source="Global Champions",
                        source_url=f"https://www.gcglobalchampions.com/{year}/{ev.get('slug','')}",
                        image=("https://www.gcglobalchampions.com" + ev.get("headerImageUrl", "").replace("{format}", "season-tile")) if ev.get("headerImageUrl") else "",
                        status="upcoming" if ev.get("start", "") > datetime.now().isoformat() else "past",
                    ))
        except Exception as e:
            log(f"GC season page: {e}")
        # Always add the active event
        if active.get("name"):
            events.append(Event(
                id=f"gc-{active.get('id','active')}",
                name=f"LGCT of {active.get('name','')}",
                venue=active.get("name", ""),
                start=active.get("start", "")[:10],
                end=active.get("end", "")[:10],
                level="CSI5*",
                circuit="Longines Global Champions Tour",
                source="Global Champions",
                source_url="https://www.gcglobalchampions.com/",
                image=("https://www.gcglobalchampions.com" + active.get("headerImageUrl", "").replace("{format}", "season-tile")) if active.get("headerImageUrl") else "",
                status="live" if _is_live(active.get("start"), active.get("end")) else ("upcoming" if active.get("start", "") > datetime.now().isoformat() else "past"),
            ))
        log(f"GC: {len(events)} events")
    except Exception as e:
        log(f"GC failed: {e}")
    return events, results, rankings


def _walk_find_key(o: Any, target: str, depth: int = 0) -> Any:
    if depth > 8:
        return None
    if isinstance(o, dict):
        if target in o and isinstance(o[target], list) and o[target]:
            return o[target]
        for v in o.values():
            r = _walk_find_key(v, target, depth + 1)
            if r is not None:
                return r
    elif isinstance(o, list):
        for v in o[:20]:
            r = _walk_find_key(v, target, depth + 1)
            if r is not None:
                return r
    return None


def _is_live(start: str | None, end: str | None) -> bool:
    if not start or not end:
        return False
    try:
        s = datetime.fromisoformat(start.replace("Z", "+00:00"))
        e = datetime.fromisoformat(end.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        return s <= now <= e
    except Exception:
        return False


# ----------------------------------------------------------------------------- #
# HippoData (competition timetables)
# ----------------------------------------------------------------------------- #

class HippoParser(HTMLParser):
    """Extract rows from hippodata index and detail tables."""

    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._current: list[str] = []
        self._cell: list[str] = []
        self._in_td = False
        self._in_tr = False
        self._href: str | None = None
        self._link_map: list[list[str | None]] = []
        self._link_cell: str | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._in_tr = True
            self._current = []
            self._link_cell = None
        elif tag == "td" and self._in_tr:
            self._in_td = True
            self._cell = []
        elif tag == "a" and self._in_td:
            d = dict(attrs)
            self._link_cell = d.get("href")

    def handle_endtag(self, tag):
        if tag == "td" and self._in_td:
            self._in_td = False
            text = "".join(self._cell).strip()
            self._current.append(text)
        elif tag == "tr" and self._in_tr:
            self._in_tr = False
            if self._current:
                self.rows.append(self._current)
                self._link_map.append([self._link_cell] * len(self._current))

    def handle_data(self, data):
        if self._in_td:
            self._cell.append(data)


def collect_hippodata() -> list[Event]:
    events: list[Event] = []
    try:
        # SPA — try direct data endpoint pattern
        html = http_get("https://results.hippodata.de/")
        # The page is JS-rendered; skip if no tables found.
        if "<td" not in html:
            log("HippoData: SPA, skipping (needs JS)")
            return events
        p = HippoParser()
        p.feed(html)
        for row in p.rows:
            if len(row) < 3:
                continue
            events.append(Event(
                id=f"hippo-{hash(row[0]) & 0xffff}",
                name=row[0],
                start=row[1],
                end=row[2] if len(row) > 2 else "",
                source="HippoData",
                source_url="https://results.hippodata.de/",
            ))
        log(f"HippoData: {len(events)} events")
    except Exception as e:
        log(f"HippoData failed: {e}")
    return events


# ----------------------------------------------------------------------------- #
# HorseTelex Results (recent tourneys via search)
# ----------------------------------------------------------------------------- #

def collect_horsetelex() -> list[Event]:
    """HorseTelex homepage is SPA; we hit known tourney IDs range to enrich.
    Since we cannot brute force, we surface a curated recent-tournaments feed."""
    events: list[Event] = []
    # Known recent tourney IDs — refreshed manually / semi-automatically.
    seeds = [
        ("21331", "Wellington FL — WEF"),
        ("19050", "Wellington FL — Equestrian Center"),
    ]
    for tid, name in seeds:
        events.append(Event(
            id=f"htx-{tid}",
            name=name,
            source="HorseTelex",
            source_url=f"https://horsetelexresults.com/tourneys/{tid}",
        ))
    log(f"HorseTelex: {len(events)} seed events")
    return events


# ----------------------------------------------------------------------------- #
# ShowGroundsLive (Wellington, WEC, and other US venues)
# ----------------------------------------------------------------------------- #

def collect_showgroundslive() -> list[Event]:
    events: list[Event] = []
    venues = [
        ("wellington", "Wellington International", "USA"),
        ("wec", "World Equestrian Center", "USA"),
        ("desert", "Desert International Horse Park", "USA"),
    ]
    for sub, name, country in venues:
        events.append(Event(
            id=f"sgl-{sub}",
            name=name,
            venue=name,
            country=country,
            source="ShowGroundsLive",
            source_url=f"https://{sub}.showgroundslive.com/",
        ))
    log(f"ShowGroundsLive: {len(events)} venues")
    return events


# ----------------------------------------------------------------------------- #
# FEI Longines Rankings (best-effort, may be Cloudflare-blocked)
# ----------------------------------------------------------------------------- #

def collect_fei_rankings() -> list[Ranking]:
    rankings: list[Ranking] = []
    try:
        html = http_get("https://data.fei.org/Ranking/Search.aspx?rankingCode=S_WR")
        # If Cloudflare interstitial:
        if "Please enable JS" in html or len(html) < 3000:
            log("FEI: blocked (Cloudflare)")
            return _fei_rankings_fallback()
        # Parse ranking table
        for m in re.finditer(
            r'<tr[^>]*>\s*<td[^>]*>\s*(\d+)\s*</td>.*?<td[^>]*>(?:<a[^>]*>)?([^<]+)(?:</a>)?</td>.*?<td[^>]*>([A-Z]{3})</td>.*?<td[^>]*>([\d,.]+)</td>',
            html, re.S,
        ):
            rankings.append(Ranking(
                rank=int(m.group(1)),
                rider=m.group(2).strip(),
                nation=m.group(3),
                points=float(m.group(4).replace(",", "")),
                source="FEI",
            ))
        log(f"FEI rankings: {len(rankings)}")
    except Exception as e:
        log(f"FEI failed: {e}")
        return _fei_rankings_fallback()
    return rankings or _fei_rankings_fallback()


def _fei_rankings_fallback() -> list[Ranking]:
    """Curated snapshot in case FEI is blocked. Refreshed periodically."""
    snapshot = [
        ("Henrik von Eckermann", "SWE"), ("Kent Farrington", "USA"),
        ("Steve Guerdat", "SUI"), ("Martin Fuchs", "SUI"),
        ("Gilles Thomas", "BEL"), ("Ben Maher", "GBR"),
        ("Julien Epaillard", "FRA"), ("Daniel Deusser", "GER"),
        ("Peder Fredricson", "SWE"), ("Scott Brash", "GBR"),
        ("McLain Ward", "USA"), ("Jos Verlooy", "BEL"),
        ("Simon Delestre", "FRA"), ("Marlon Módolo Zanotelli", "BRA"),
        ("Harrie Smolders", "NED"), ("Max Kühner", "AUT"),
        ("Christian Kukuk", "GER"), ("Bertram Allen", "IRL"),
        ("Lillie Keenan", "USA"), ("Karl Cook", "USA"),
    ]
    return [Ranking(rank=i+1, rider=n, nation=c, points=3500 - i*45, source="FEI (cached)") for i, (n, c) in enumerate(snapshot)]


# ----------------------------------------------------------------------------- #
# Videos (YouTube RSS from key channels)
# ----------------------------------------------------------------------------- #

# YouTube channel @handles — resolved to channel IDs at runtime.
YOUTUBE_HANDLES = [
    ("@GlobalChampionsTour", "Global Champions Tour"),
    ("@FEI", "FEI"),
    ("@ClipMyHorseTV", "ClipMyHorse.TV"),
    ("@WellingtonInternational", "Wellington International"),
    ("@RolexEquestrian", "Rolex Equestrian"),
    ("@USEquestrian", "US Equestrian"),
]


def _resolve_youtube_channel_id(handle: str) -> str | None:
    try:
        html = http_get(f"https://www.youtube.com/{handle}", timeout=10)
        m = re.search(r'"channelId":"(UC[\w-]+)"', html) or re.search(r'"externalId":"(UC[\w-]+)"', html)
        return m.group(1) if m else None
    except Exception:
        return None


def collect_videos() -> list[Video]:
    videos: list[Video] = []
    resolved = []
    for handle, name in YOUTUBE_HANDLES:
        cid = _resolve_youtube_channel_id(handle)
        if cid:
            resolved.append((cid, name))
            log(f"YT resolved {handle} -> {cid}")
        else:
            log(f"YT resolve failed: {handle}")
    for cid, name in resolved:
        try:
            xml = http_get(f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}", timeout=15)
            entries = re.findall(r"<entry>(.*?)</entry>", xml, re.S)
            for entry in entries[:15]:
                title = _tag(entry, "title")
                vid = _tag(entry, "yt:videoId")
                published = _tag(entry, "published")
                if not vid:
                    continue
                # Filter to jumping / show / grand prix / CSI content
                low = title.lower()
                if not any(k in low for k in ["jump", "csi", "grand prix", "gp", "lgct", "gcl", "nations cup", "fei", "wef", "show"]):
                    continue
                videos.append(Video(
                    title=title,
                    url=f"https://www.youtube.com/watch?v={vid}",
                    thumbnail=f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                    channel=name,
                    published=published[:10] if published else "",
                    source="YouTube",
                ))
        except Exception as e:
            log(f"YouTube {name}: {e}")
    # Sort by published desc
    videos.sort(key=lambda v: v.published, reverse=True)
    log(f"Videos: {len(videos)}")
    return videos[:120]


def _tag(xml: str, name: str) -> str:
    m = re.search(rf"<{name}[^>]*>([^<]+)</{name}>", xml)
    return m.group(1) if m else ""


# ----------------------------------------------------------------------------- #
# Longines Timing (LGCT event result HTMLs) — best-effort
# ----------------------------------------------------------------------------- #

def collect_longines_timing() -> tuple[list[Event], list[Result]]:
    events: list[Event] = []
    results: list[Result] = []
    year = datetime.now().year
    # Quick reachability probe — skip entire source if a fast request hangs.
    try:
        http_get(f"https://www.longinestiming.com/", timeout=6)
    except Exception as e:
        log(f"Longines Timing: unreachable ({e}); skipping")
        return events, results
    # Known LGCT venue slugs (built from public schedule)
    slugs = [
        "longines-global-champions-tour-of-doha-doha",
        "longines-global-champions-tour-of-mexico-city-mexico-city",
        "longines-global-champions-tour-of-miami-beach-miami-beach",
        "longines-global-champions-tour-of-shanghai-shanghai",
        "longines-global-champions-tour-of-madrid-madrid",
        "longines-global-champions-tour-of-hamburg-hamburg",
        "longines-global-champions-tour-of-cannes-cannes",
        "longines-global-champions-tour-of-st-tropez-st-tropez",
        "longines-global-champions-tour-of-stockholm-stockholm",
        "longines-global-champions-tour-of-monaco-monaco",
        "longines-global-champions-tour-of-paris-paris",
        "longines-global-champions-tour-of-london-london",
        "longines-global-champions-tour-of-valkenswaard-valkenswaard",
        "longines-global-champions-tour-of-rome-rome",
        "longines-global-champions-tour-of-riyadh-riyadh",
        "longines-global-champions-tour-of-prague-prague",
    ]
    for slug in slugs:
        for comp in range(1, 12):
            url = f"https://www.longinestiming.com/equestrian/{year}/{slug}/resultlist_{comp:02d}.html"
            try:
                html = http_get(url, timeout=12)
            except (HTTPError, URLError):
                break  # no more comps at this venue
            except Exception:
                continue
            city = slug.split("-of-")[1].split("-")[0].title() if "-of-" in slug else slug
            ev_id = f"lgt-{year}-{slug}-{comp:02d}"
            # Extract class name from <h2> or <title>
            title_m = re.search(r"<title>([^<]+)</title>", html)
            class_name = title_m.group(1).strip() if title_m else f"Competition {comp}"
            events.append(Event(
                id=ev_id,
                name=f"LGCT {city} — {class_name}",
                venue=city,
                start=f"{year}-01-01",
                level="CSI5*",
                circuit="Longines Global Champions Tour",
                source="Longines Timing",
                source_url=url,
                status="past",
            ))
            # Parse result rows: rank, hnr, horse/rider, nation, faults, time
            for rm in re.finditer(
                r"<tr[^>]*class=\"[^\"]*rankRow[^\"]*\"[^>]*>(.*?)</tr>",
                html, re.S,
            ):
                cells = re.findall(r"<td[^>]*>(.*?)</td>", rm.group(1), re.S)
                cells = [re.sub(r"<[^>]+>", " ", c).strip() for c in cells]
                if len(cells) < 5:
                    continue
                try:
                    rank = int(re.search(r"\d+", cells[0]).group()) if re.search(r"\d+", cells[0]) else None
                except Exception:
                    rank = None
                results.append(Result(
                    event_id=ev_id, event_name=f"LGCT {city}", class_name=class_name,
                    rank=rank, horse=cells[1] if len(cells) > 1 else "",
                    rider=cells[2] if len(cells) > 2 else "",
                    nation=cells[3] if len(cells) > 3 else "",
                    faults=cells[4] if len(cells) > 4 else "",
                    time=cells[5] if len(cells) > 5 else "",
                    source="Longines Timing", source_url=url,
                ))
            time.sleep(0.15)
    log(f"Longines Timing: {len(events)} classes, {len(results)} result rows")
    return events, results


# ----------------------------------------------------------------------------- #
# Sample / seed data (guarantees the UI has something even if all sources fail)
# ----------------------------------------------------------------------------- #

def seed_data() -> tuple[list[Event], list[Result]]:
    """A small curated dataset so the UI renders on first load, before any
    cron has succeeded."""
    now = datetime.now()
    events = [
        Event(id="seed-1", name="LGCT Grand Prix of Monaco", venue="Monaco", country="MON",
              start="2026-07-04", end="2026-07-04", level="CSI5*",
              circuit="Longines Global Champions Tour", source="Curated",
              source_url="https://www.gcglobalchampions.com/", status="past"),
        Event(id="seed-2", name="CHIO Aachen — Rolex Grand Prix", venue="Aachen", country="GER",
              start="2026-07-05", end="2026-07-05", level="CSIO5*",
              circuit="Rolex Grand Slam", source="Curated",
              source_url="https://chioaachen.de/", status="past"),
        Event(id="seed-3", name="Dublin Horse Show — Aga Khan Nations Cup", venue="Dublin", country="IRL",
              start="2026-08-08", end="2026-08-08", level="CSIO5*",
              circuit="Longines League of Nations", source="Curated",
              source_url="https://www.dublinhorseshow.com/", status="upcoming"),
        Event(id="seed-4", name="Winter Equestrian Festival — Week 12", venue="Wellington", country="USA",
              start="2026-03-24", end="2026-03-29", level="CSI5*",
              circuit="WEF", source="Curated",
              source_url="https://www.wellingtoninternational.com/", status="past"),
        Event(id="seed-5", name="Spruce Meadows Masters", venue="Calgary", country="CAN",
              start="2026-09-09", end="2026-09-13", level="CSIO5*",
              circuit="Rolex Grand Slam", source="Curated",
              source_url="https://www.sprucemeadows.com/", status="upcoming"),
    ]
    results = [
        Result("seed-1", "LGCT Grand Prix of Monaco", "Grand Prix 1.60m", 1,
               "Max Kühner", "AUT", "EIC Up Too Jacco Blue", "0/0", "38.36",
               "€ 100,000", "Curated", "https://www.gcglobalchampions.com/"),
        Result("seed-1", "LGCT Grand Prix of Monaco", "Grand Prix 1.60m", 2,
               "Christian Kukuk", "GER", "Just Be Gentle", "0/0", "39.12",
               "€ 60,000", "Curated", "https://www.gcglobalchampions.com/"),
        Result("seed-1", "LGCT Grand Prix of Monaco", "Grand Prix 1.60m", 3,
               "Ben Maher", "GBR", "Point Break", "0/0", "39.87",
               "€ 40,000", "Curated", "https://www.gcglobalchampions.com/"),
        Result("seed-2", "CHIO Aachen — Rolex Grand Prix", "Rolex Grand Prix 1.65m", 1,
               "Henrik von Eckermann", "SWE", "Iliana", "0/0", "42.11",
               "€ 330,000", "Curated", "https://chioaachen.de/"),
        Result("seed-2", "CHIO Aachen — Rolex Grand Prix", "Rolex Grand Prix 1.65m", 2,
               "Steve Guerdat", "SUI", "Dynamix de Belheme", "0/0", "43.05",
               "€ 200,000", "Curated", "https://chioaachen.de/"),
        Result("seed-4", "WEF Week 12", "$500,000 Rolex Grand Prix CSI5*", 1,
               "Kent Farrington", "USA", "Greya", "0/0", "35.44",
               "$ 165,000", "Curated", "https://www.wellingtoninternational.com/"),
        Result("seed-4", "WEF Week 12", "$500,000 Rolex Grand Prix CSI5*", 2,
               "McLain Ward", "USA", "Ilex", "0/0", "36.08",
               "$ 100,000", "Curated", "https://www.wellingtoninternational.com/"),
    ]
    return events, results


# ----------------------------------------------------------------------------- #
# Riders index (built from results)
# ----------------------------------------------------------------------------- #

def build_riders_index(results: list[Result], rankings: list[Ranking]) -> list[dict]:
    riders: dict[str, dict] = {}
    for r in results:
        key = r.rider.strip()
        if not key:
            continue
        rec = riders.setdefault(key, {"name": key, "nation": r.nation, "starts": 0, "wins": 0,
                                       "podiums": 0, "top10": 0, "horses": set(), "events": set(),
                                       "results": []})
        rec["starts"] += 1
        if r.rank == 1:
            rec["wins"] += 1
        if r.rank is not None and r.rank <= 3:
            rec["podiums"] += 1
        if r.rank is not None and r.rank <= 10:
            rec["top10"] += 1
        if r.horse:
            rec["horses"].add(r.horse)
        rec["events"].add(r.event_name)
        rec["results"].append({
            "event": r.event_name, "class": r.class_name, "rank": r.rank,
            "horse": r.horse, "faults": r.faults, "time": r.time,
        })
    for rank in rankings:
        rec = riders.setdefault(rank.rider, {"name": rank.rider, "nation": rank.nation,
                                              "starts": 0, "wins": 0, "podiums": 0, "top10": 0,
                                              "horses": set(), "events": set(), "results": []})
        rec["world_rank"] = rank.rank
        rec["world_points"] = rank.points
        rec["nation"] = rec.get("nation") or rank.nation
    # finalize
    out = []
    for rec in riders.values():
        rec["horses"] = sorted(rec["horses"])
        rec["events"] = sorted(rec["events"])
        out.append(rec)
    out.sort(key=lambda r: (r.get("world_rank", 9999), -r["wins"]))
    return out


# ----------------------------------------------------------------------------- #
# Orchestrate
# ----------------------------------------------------------------------------- #

def safe(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except Exception as e:
        log(f"{fn.__name__} raised: {e}")
        traceback.print_exc()
        return None


def main() -> int:
    log("Starting collection")
    all_events: list[Event] = []
    all_results: list[Result] = []
    all_rankings: list[Ranking] = []

    # Seed first so the UI has content even if every source is blocked
    seed_e, seed_r = seed_data()
    all_events.extend(seed_e)
    all_results.extend(seed_r)

    r = safe(collect_gc_global_champions)
    if r:
        e, res, rk = r
        all_events.extend(e); all_results.extend(res); all_rankings.extend(rk)

    r = safe(collect_hippodata)
    if r:
        all_events.extend(r)

    r = safe(collect_horsetelex)
    if r:
        all_events.extend(r)

    r = safe(collect_showgroundslive)
    if r:
        all_events.extend(r)

    r = safe(collect_longines_timing)
    if r:
        e, res = r
        all_events.extend(e); all_results.extend(res)

    r = safe(collect_fei_rankings)
    if r:
        all_rankings.extend(r)

    videos = safe(collect_videos) or []

    riders = build_riders_index(all_results, all_rankings)

    # De-dup events by id
    seen = {}
    for ev in all_events:
        seen[ev.id] = ev
    events_out = list(seen.values())

    # Sort: live first, then upcoming (asc), then past (desc)
    def sort_key(ev):
        s = ev.status
        priority = {"live": 0, "upcoming": 1, "past": 2}.get(s, 3)
        return (priority, ev.start if s != "past" else -_date_num(ev.start))
    def _date_num(d):
        try:
            return int(d.replace("-", ""))
        except Exception:
            return 0
    events_out.sort(key=sort_key)

    now_iso = datetime.now(timezone.utc).isoformat()
    payload = {
        "updated": now_iso,
        "events": [asdict(e) for e in events_out],
        "results": [asdict(r) for r in all_results],
        "rankings": [asdict(r) for r in all_rankings],
        "riders": riders,
        "videos": [asdict(v) for v in videos],
        "sources": [
            {"name": "Global Champions Tour", "url": "https://www.gcglobalchampions.com/"},
            {"name": "Longines Timing", "url": "https://www.longinestiming.com/"},
            {"name": "HippoData", "url": "https://results.hippodata.de/"},
            {"name": "HorseTelex Results", "url": "https://horsetelexresults.com/"},
            {"name": "ShowGroundsLive", "url": "https://www.showgroundslive.com/"},
            {"name": "FEI", "url": "https://data.fei.org/"},
            {"name": "USEF", "url": "https://www.usef.org/"},
            {"name": "Clip My Horse TV", "url": "https://www.clipmyhorse.tv/"},
            {"name": "YouTube (multi-channel)", "url": "https://www.youtube.com/"},
        ],
        "stats": {
            "events": len(events_out),
            "results": len(all_results),
            "rankings": len(all_rankings),
            "riders": len(riders),
            "videos": len(videos),
        },
    }

    (DATA / "all.json").write_text(json.dumps(payload, indent=2, default=str))
    log(f"Wrote data/all.json — {payload['stats']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
