# 🐎 Show Jump Central

**One place for every horse show jumping event, result, rider profile, world ranking and video round — worldwide.**

Aggregated from FEI, Longines Global Champions Tour, Longines Timing, HippoData,
HorseTelex Results, ShowGroundsLive (Wellington, WEC, Desert), USEF, Clip My Horse TV,
and multiple official YouTube channels.

## Live site

Once GitHub Pages finishes deploying, this repository is hosted at
**https://<your-username>.github.io/showjump-central/**.

## Features

- **Home** — hero event, live ticker, world-ranking sidebar, recent results, featured videos.
- **Live** — currently in-progress classes across all connected venues.
- **Events** — all events with filters (status, level, circuit) — click for full class-by-class results.
- **Rankings** — Longines FEI World Rankings, top 20+.
- **Riders** — searchable directory. Rider profile shows FEI world rank, wins, podiums, horses, and result history.
- **Videos** — recent clips from Global Champions Tour, FEI, ClipMyHorse.TV, Wellington International.
- **Search** — global search across riders, horses, events, and videos.
- **Deep-linkable** — hash routes such as `#/rider/Henrik%20von%20Eckermann` share directly.

## How it works

```
                 ┌── FEI (data.fei.org) ─────────────┐
                 ├── Longines Timing HTML ───────────┤
                 ├── GC Global Champions ────────────┤
   scripts/      ├── HippoData / HorseTelex ─────────┤
   collect.py ── ├── ShowGroundsLive (Wellington) ───┤ ── data/all.json ── static site
                 ├── YouTube RSS (multi-channel) ────┤
                 └── Curated seed set ───────────────┘
```

`scripts/collect.py` is a plain-Python script — no dependencies beyond the standard
library — that fetches every source, normalizes it into one schema, and writes
`data/all.json`. Sources that fail (Cloudflare, network error, etc.) simply fall through
without breaking the run.

`index.html` + `src/app.js` + `src/styles.css` are a zero-build vanilla-JS SPA
(hash routing) that renders `data/all.json`.

## Refresh cadence

GitHub Actions runs the collector every **3 hours** (see
`.github/workflows/collect.yml`), commits the refreshed `data/all.json` to `main`,
and redeploys Pages.

You can trigger a manual refresh at any time from the **Actions → Collect data →
Run workflow** button.

## Local development

```bash
python3 scripts/collect.py        # writes data/all.json
python3 -m http.server 8000       # http://localhost:8000
```

No `npm install`, no bundler.

## Adding a source

1. Add a new `collect_<source>()` function in `scripts/collect.py`.
2. Return `list[Event]`, `list[Result]`, and/or `list[Ranking]` — using the dataclasses
   at the top of the file.
3. Call it from `main()` via the `safe(...)` helper.

Failures are always non-fatal — the safe wrapper logs them and moves on.

## Legal

Show Jump Central is not affiliated with FEI, USEF, Longines, LGCT, Clip My Horse TV,
or any equestrian federation or venue. All source data belongs to its respective
publisher; this project links back to the original page for every result and video.
