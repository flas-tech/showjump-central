/* ============================================================
 * Show Jump Central — SPA
 * Routes: #/  #/live  #/events  #/rankings  #/riders  #/videos
 *         #/event/:id  #/rider/:name
 * ============================================================ */

const state = {
  data: null,
  route: parseRoute(),
  query: "",
};

const NATION_FLAGS = {
  USA: "🇺🇸", GBR: "🇬🇧", GER: "🇩🇪", FRA: "🇫🇷", SUI: "🇨🇭", NED: "🇳🇱",
  BEL: "🇧🇪", SWE: "🇸🇪", IRL: "🇮🇪", ESP: "🇪🇸", ITA: "🇮🇹", BRA: "🇧🇷",
  CAN: "🇨🇦", AUT: "🇦🇹", DEN: "🇩🇰", NOR: "🇳🇴", MEX: "🇲🇽", AUS: "🇦🇺",
  MON: "🇲🇨", QAT: "🇶🇦", KSA: "🇸🇦", ARG: "🇦🇷", COL: "🇨🇴", POR: "🇵🇹",
  POL: "🇵🇱", CZE: "🇨🇿", FIN: "🇫🇮", ISR: "🇮🇱", UAE: "🇦🇪", JPN: "🇯🇵",
  CHN: "🇨🇳", LUX: "🇱🇺", HUN: "🇭🇺", GRE: "🇬🇷",
};
const flag = (nation) => NATION_FLAGS[String(nation || "").toUpperCase()] || "🏳️";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

function parseRoute() {
  const h = location.hash.replace(/^#/, "") || "/";
  const parts = h.split("/").filter(Boolean);
  return { path: "/" + parts.join("/"), parts };
}

/* ---------- Data load ---------- */

async function loadData() {
  try {
    const res = await fetch(`data/all.json?v=${Date.now()}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    state.data = await res.json();
  } catch (e) {
    console.error("Data load failed:", e);
    state.data = {
      updated: new Date().toISOString(),
      events: [], results: [], rankings: [], riders: [], videos: [],
      sources: [], stats: { events: 0, results: 0, rankings: 0, riders: 0, videos: 0 },
    };
  }
  renderChrome();
  render();
}

/* ---------- Chrome (top bar, ticker, footer) ---------- */

function renderChrome() {
  // Tabs
  $$(".tab").forEach((t) => {
    const r = t.dataset.route;
    t.classList.toggle("active", (r === "/" && state.route.path === "/") || (r !== "/" && state.route.path.startsWith(r)));
    t.onclick = (e) => { e.preventDefault(); location.hash = "#" + r; };
  });

  // Search
  const search = $("#search");
  search.value = state.query;
  search.oninput = (e) => {
    state.query = e.target.value.trim().toLowerCase();
    if (state.query) location.hash = "#/search";
    else render();
  };

  $("#refresh").onclick = () => loadData();

  // Ticker: recent top-3 results
  const ticker = $("#ticker");
  const items = (state.data.results || [])
    .filter((r) => r.rank && r.rank <= 3)
    .slice(0, 40);
  const html = items.map((r) => `
    <span class="tick-item">
      <span class="flag">${flag(r.nation)}</span>
      <strong>${r.rider}</strong> ${r.horse ? `<em style="color:var(--dim)">/ ${r.horse}</em>` : ""}
      <span style="color:var(--dim); margin-left:6px">${escapeHtml(r.class_name || r.event_name)}</span>
      <span style="color:var(--accent); margin-left:6px">P${r.rank}</span>
      ${r.time ? `<span style="color:var(--muted); margin-left:6px">${r.time}s</span>` : ""}
    </span>
  `).join('<span class="sep">•</span>');
  if (items.length) {
    ticker.innerHTML = `<div class="ticker-inner">${html}${html}</div>`;
  } else {
    ticker.innerHTML = `<div style="padding:0 20px;color:var(--muted)">Waiting for live results…</div>`;
  }

  // Footer
  const upd = new Date(state.data.updated);
  $("#updated").textContent = isNaN(upd) ? "—" : upd.toLocaleString();
  $("#src-list").innerHTML = (state.data.sources || [])
    .map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`)
    .join(", ");
}

/* ---------- Router ---------- */

window.addEventListener("hashchange", () => {
  state.route = parseRoute();
  renderChrome();
  render();
  window.scrollTo(0, 0);
});

function render() {
  const p = state.route.path;
  const app = $("#app");
  if (state.query) return renderSearch(app);
  if (p === "/") return renderHome(app);
  if (p === "/live") return renderLive(app);
  if (p === "/events") return renderEvents(app);
  if (p === "/rankings") return renderRankings(app);
  if (p === "/riders") return renderRiders(app);
  if (p === "/videos") return renderVideos(app);
  if (p.startsWith("/event/")) return renderEventDetail(app, decodeURIComponent(state.route.parts[1]));
  if (p.startsWith("/rider/")) return renderRiderDetail(app, decodeURIComponent(state.route.parts[1]));
  app.innerHTML = `<div class="empty">Page not found</div>`;
}

/* ---------- Home ---------- */

function renderHome(app) {
  const d = state.data;
  const events = d.events || [];
  const upcoming = events.filter((e) => e.status === "upcoming").slice(0, 4);
  const past = events.filter((e) => e.status === "past").slice(0, 8);
  const live = events.filter((e) => e.status === "live");
  const featured = live[0] || events.find((e) => e.image) || events[0];
  const topRiders = (d.rankings || []).slice(0, 5);
  const topVideos = (d.videos || []).slice(0, 4);
  const recentResults = (d.results || []).slice(0, 10);

  app.innerHTML = `
    <div class="hero">
      <div class="hero-featured" style="background-image:${featured?.image ? `url('${featured.image}'),` : ''}url('${defaultCover(featured || {})}')">
        <div class="content">
          <span class="badge">${featured?.status === "live" ? "🔴 Live" : "Featured"}</span>
          <h2>${escapeHtml(featured?.name || "Show Jumping — Global Coverage")}</h2>
          <div class="meta">
            ${flag(featured?.country)} ${escapeHtml(featured?.venue || "")}
            ${featured?.start ? ` · ${featured.start}${featured.end && featured.end !== featured.start ? "–" + featured.end : ""}` : ""}
            ${featured?.level ? ` · <strong style="color:var(--accent-2)">${featured.level}</strong>` : ""}
          </div>
        </div>
        ${featured ? `<a class="event-link" href="#/event/${encodeURIComponent(featured.id)}" style="position:absolute;inset:0;z-index:3"></a>` : ""}
      </div>
      <div class="hero-side">
        <div class="hero-live">
          <h3><span class="livedot"></span> Live now</h3>
          ${live.length ? live.slice(0,3).map((e) => `
            <a href="#/event/${encodeURIComponent(e.id)}" style="display:block;padding:8px 0;border-bottom:1px solid var(--border)">
              <div style="font-weight:600">${escapeHtml(e.name)}</div>
              <div style="font-size:12px;color:var(--muted)">${flag(e.country)} ${escapeHtml(e.venue || "")}</div>
            </a>
          `).join("") : `<div class="empty" style="padding:20px">No live events right now.</div>`}
        </div>
        <div class="hero-live">
          <h3>World Rankings — Top 5</h3>
          ${topRiders.map((r) => `
            <a href="#/rider/${encodeURIComponent(r.rider)}" style="display:flex;gap:10px;padding:6px 0;align-items:center">
              <span class="rank-badge ${r.rank<=1?'top1':r.rank<=3?'top3':r.rank<=10?'top10':''}">${r.rank}</span>
              <span style="flex:1"><strong>${escapeHtml(r.rider)}</strong> <span style="color:var(--muted);margin-left:6px">${flag(r.nation)} ${r.nation}</span></span>
              <span style="font-family:var(--mono);color:var(--muted)">${formatPts(r.points)}</span>
            </a>
          `).join("")}
        </div>
      </div>
    </div>

    ${upcoming.length ? `
    <section class="section">
      <div class="section-head">
        <h2>Upcoming Events</h2>
        <a class="more" href="#/events">All events →</a>
      </div>
      <div class="grid-4">${upcoming.map(eventCard).join("")}</div>
    </section>` : ""}

    <section class="section">
      <div class="section-head">
        <h2>Recent Results</h2>
        <a class="more" href="#/rankings">Rankings →</a>
      </div>
      ${recentResults.length ? resultsTable(recentResults) : `<div class="empty">No results yet — the collector will run soon.</div>`}
    </section>

    ${topVideos.length ? `
    <section class="section">
      <div class="section-head">
        <h2>Featured Videos</h2>
        <a class="more" href="#/videos">All videos →</a>
      </div>
      <div class="grid-4">${topVideos.map(videoCard).join("")}</div>
    </section>` : ""}

    ${past.length ? `
    <section class="section">
      <div class="section-head">
        <h2>Past Events</h2>
        <a class="more" href="#/events">All →</a>
      </div>
      <div class="grid-4">${past.map(eventCard).join("")}</div>
    </section>` : ""}
  `;

  hookEvents();
}

/* ---------- Live ---------- */

function renderLive(app) {
  const live = (state.data.events || []).filter((e) => e.status === "live");
  const upcoming = (state.data.events || []).filter((e) => e.status === "upcoming").slice(0, 8);
  app.innerHTML = `
    <div class="page-title"><h1><span class="livedot"></span> Live</h1><span class="sub">Currently in progress worldwide</span></div>
    ${live.length ? `<div class="grid-3">${live.map(eventCard).join("")}</div>`
      : `<div class="empty">No live show jumping events right now.<br><br>Next up: check <a href="#/events" style="color:var(--accent)">upcoming events →</a></div>`}
    ${upcoming.length ? `
      <section class="section">
        <div class="section-head"><h2>Coming Up Next</h2></div>
        <div class="grid-4">${upcoming.map(eventCard).join("")}</div>
      </section>` : ""}
  `;
  hookEvents();
}

/* ---------- Events ---------- */

function renderEvents(app) {
  const events = state.data.events || [];
  const circuits = Array.from(new Set(events.map((e) => e.circuit).filter(Boolean))).sort();
  const levels = Array.from(new Set(events.map((e) => e.level).filter(Boolean))).sort();

  app.innerHTML = `
    <div class="page-title"><h1>Events</h1><span class="sub">${events.length} shows across all connected sources</span></div>
    <div class="filters" id="ev-filters">
      <button class="chip active" data-f="status:all">All</button>
      <button class="chip" data-f="status:live">🔴 Live</button>
      <button class="chip" data-f="status:upcoming">Upcoming</button>
      <button class="chip" data-f="status:past">Past</button>
      ${levels.map((l) => `<button class="chip" data-f="level:${escapeAttr(l)}">${escapeHtml(l)}</button>`).join("")}
      ${circuits.slice(0,5).map((c) => `<button class="chip" data-f="circuit:${escapeAttr(c)}">${escapeHtml(c)}</button>`).join("")}
    </div>
    <div id="ev-grid" class="grid-4">${events.map(eventCard).join("")}</div>
  `;
  hookEvents();
  const filters = new Set();
  $$("#ev-filters .chip").forEach((chip) => {
    chip.onclick = () => {
      const f = chip.dataset.f;
      if (f === "status:all") { filters.clear(); }
      else if (filters.has(f)) filters.delete(f);
      else filters.add(f);
      $$("#ev-filters .chip").forEach((c) => c.classList.remove("active"));
      if (filters.size === 0) $(`[data-f="status:all"]`).classList.add("active");
      else $$("#ev-filters .chip").forEach((c) => { if (filters.has(c.dataset.f)) c.classList.add("active"); });
      const filtered = events.filter((e) => {
        for (const f of filters) {
          const [k, v] = f.split(":");
          if (k === "status" && e.status !== v) return false;
          if (k === "level" && e.level !== v) return false;
          if (k === "circuit" && e.circuit !== v) return false;
        }
        return true;
      });
      $("#ev-grid").innerHTML = filtered.length ? filtered.map(eventCard).join("") : `<div class="empty" style="grid-column:1/-1">No events match those filters.</div>`;
      hookEvents();
    };
  });
}

/* ---------- Rankings ---------- */

function renderRankings(app) {
  const rk = state.data.rankings || [];
  app.innerHTML = `
    <div class="page-title"><h1>Longines World Rankings</h1><span class="sub">FEI Jumping · ${rk.length} riders</span></div>
    <div class="table-wrap">
      <table class="pretty">
        <thead><tr><th>#</th><th>Rider</th><th>Nation</th><th class="num">Points</th><th class="num">Prev</th></tr></thead>
        <tbody>
          ${rk.map((r) => `
            <tr class="row-link" data-link="#/rider/${encodeURIComponent(r.rider)}">
              <td class="rank ${r.rank<=1?'top1':r.rank<=3?'top3':''}">${r.rank}</td>
              <td class="rider">${escapeHtml(r.rider)}</td>
              <td class="nation">${flag(r.nation)} ${r.nation}</td>
              <td class="num">${formatPts(r.points)}</td>
              <td class="num" style="color:var(--muted)">${r.prev_rank || "—"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
  hookRows();
}

/* ---------- Riders ---------- */

function renderRiders(app) {
  const riders = state.data.riders || [];
  app.innerHTML = `
    <div class="page-title"><h1>Riders</h1><span class="sub">${riders.length} profiles</span></div>
    <div class="grid-3">${riders.map(riderCard).join("")}</div>
  `;
  $$(".rider-card").forEach((c) => c.onclick = () => location.hash = "#/rider/" + encodeURIComponent(c.dataset.rider));
}

/* ---------- Videos ---------- */

function renderVideos(app) {
  const vids = state.data.videos || [];
  const channels = Array.from(new Set(vids.map((v) => v.channel))).sort();
  app.innerHTML = `
    <div class="page-title"><h1>Videos</h1><span class="sub">${vids.length} recent clips</span></div>
    <div class="filters" id="v-filters">
      <button class="chip active" data-c="">All channels</button>
      ${channels.map((c) => `<button class="chip" data-c="${escapeAttr(c)}">${escapeHtml(c)}</button>`).join("")}
    </div>
    <div id="v-grid" class="grid-4">${vids.map(videoCard).join("")}</div>
  `;
  hookVideoCards();
  $$("#v-filters .chip").forEach((chip) => chip.onclick = () => {
    $$("#v-filters .chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    const c = chip.dataset.c;
    const filtered = c ? vids.filter((v) => v.channel === c) : vids;
    $("#v-grid").innerHTML = filtered.map(videoCard).join("");
    hookVideoCards();
  });
}

/* ---------- Event detail ---------- */

function renderEventDetail(app, id) {
  const ev = (state.data.events || []).find((e) => e.id === id);
  if (!ev) return app.innerHTML = `<div class="empty">Event not found. <a href="#/events" style="color:var(--accent)">Back to events</a></div>`;
  const results = (state.data.results || []).filter((r) => r.event_id === id);
  const classes = Array.from(new Set(results.map((r) => r.class_name)));

  app.innerHTML = `
    <a href="#/events" class="back-link">← All events</a>
    <div class="detail-header" style="background:linear-gradient(180deg,rgba(11,15,22,.75),rgba(11,15,22,.98)),url('${ev.image || defaultCover(ev)}') center/cover">
      <div class="eyebrow">${escapeHtml(ev.circuit || "Show Jumping")} · ${escapeHtml(ev.level || "")} · <span class="status ${ev.status}">${ev.status || ""}</span></div>
      <h1>${escapeHtml(ev.name)}</h1>
      <div style="color:var(--muted);margin-bottom:14px">
        ${flag(ev.country)} ${escapeHtml(ev.venue || "")}
        ${ev.start ? ` · ${ev.start}${ev.end && ev.end !== ev.start ? "–" + ev.end : ""}` : ""}
      </div>
      <div class="stats">
        <div class="stat"><div class="n">${classes.length || "—"}</div><div class="l">Classes</div></div>
        <div class="stat"><div class="n">${results.length}</div><div class="l">Result rows</div></div>
        <div class="stat"><div class="n">${new Set(results.map((r) => r.rider)).size}</div><div class="l">Athletes</div></div>
      </div>
      ${ev.source_url ? `<div style="margin-top:14px"><a href="${ev.source_url}" target="_blank" rel="noopener" style="color:var(--accent)">Open on ${escapeHtml(ev.source || "source")} ↗</a></div>` : ""}
    </div>

    ${results.length ? classes.map((cls) => `
      <section class="section">
        <div class="section-head"><h2>${escapeHtml(cls)}</h2></div>
        ${resultsTable(results.filter((r) => r.class_name === cls))}
      </section>
    `).join("") : `<div class="empty">Results for this event are not yet available. The collector will pull them once published.</div>`}
  `;
  hookRows();
}

/* ---------- Rider detail ---------- */

function renderRiderDetail(app, name) {
  const rider = (state.data.riders || []).find((r) => r.name === name);
  const rk = (state.data.rankings || []).find((r) => r.rider === name);
  const results = (state.data.results || []).filter((r) => r.rider === name);
  if (!rider && !rk) return app.innerHTML = `<div class="empty">Rider "${escapeHtml(name)}" not found.</div>`;

  const nation = rider?.nation || rk?.nation || "";
  app.innerHTML = `
    <a href="#/riders" class="back-link">← All riders</a>
    <div class="detail-header">
      <div class="eyebrow">Rider profile</div>
      <h1>${escapeHtml(name)}</h1>
      <div style="color:var(--muted);margin-bottom:14px">${flag(nation)} ${escapeHtml(nation)}</div>
      <div class="stats">
        ${rk ? `<div class="stat"><div class="n" style="color:var(--accent)">#${rk.rank}</div><div class="l">World rank</div></div>` : ""}
        ${rk ? `<div class="stat"><div class="n">${formatPts(rk.points)}</div><div class="l">LR points</div></div>` : ""}
        <div class="stat"><div class="n">${rider?.starts || 0}</div><div class="l">Starts (tracked)</div></div>
        <div class="stat"><div class="n">${rider?.wins || 0}</div><div class="l">Wins</div></div>
        <div class="stat"><div class="n">${rider?.podiums || 0}</div><div class="l">Podiums</div></div>
        <div class="stat"><div class="n">${(rider?.horses||[]).length}</div><div class="l">Horses</div></div>
      </div>
    </div>

    ${rider?.horses?.length ? `
    <section class="section">
      <div class="section-head"><h2>Horses</h2></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${rider.horses.map((h) => `<span class="chip active" style="cursor:default">${escapeHtml(h)}</span>`).join("")}</div>
    </section>` : ""}

    <section class="section">
      <div class="section-head"><h2>Recent Results</h2></div>
      ${results.length ? resultsTable(results) : `<div class="empty">No result rows recorded yet.</div>`}
    </section>
  `;
}

/* ---------- Search ---------- */

function renderSearch(app) {
  const q = state.query;
  const events = (state.data.events || []).filter((e) => `${e.name} ${e.venue} ${e.circuit}`.toLowerCase().includes(q));
  const riders = (state.data.riders || []).filter((r) => r.name.toLowerCase().includes(q));
  const videos = (state.data.videos || []).filter((v) => v.title.toLowerCase().includes(q));
  const results = (state.data.results || []).filter((r) => `${r.rider} ${r.horse} ${r.class_name}`.toLowerCase().includes(q)).slice(0, 30);

  app.innerHTML = `
    <div class="page-title"><h1>Search: <span style="color:var(--accent)">${escapeHtml(q)}</span></h1></div>
    ${riders.length ? `
      <section class="section">
        <div class="section-head"><h2>Riders (${riders.length})</h2></div>
        <div class="grid-3">${riders.slice(0, 12).map(riderCard).join("")}</div>
      </section>` : ""}
    ${events.length ? `
      <section class="section">
        <div class="section-head"><h2>Events (${events.length})</h2></div>
        <div class="grid-4">${events.slice(0, 12).map(eventCard).join("")}</div>
      </section>` : ""}
    ${results.length ? `
      <section class="section">
        <div class="section-head"><h2>Results (${results.length})</h2></div>
        ${resultsTable(results)}
      </section>` : ""}
    ${videos.length ? `
      <section class="section">
        <div class="section-head"><h2>Videos (${videos.length})</h2></div>
        <div class="grid-4">${videos.slice(0, 8).map(videoCard).join("")}</div>
      </section>` : ""}
    ${!riders.length && !events.length && !results.length && !videos.length ? `<div class="empty">No matches for "${escapeHtml(q)}".</div>` : ""}
  `;
  hookEvents(); hookRows(); hookVideoCards();
  $$(".rider-card").forEach((c) => c.onclick = () => location.hash = "#/rider/" + encodeURIComponent(c.dataset.rider));
}

/* ---------- Renderers ---------- */

function eventCard(e) {
  const img = e.image || defaultCover(e);
  return `
    <a class="event-card" href="#/event/${encodeURIComponent(e.id)}">
      <div class="cover" style="background-image:url('${img}')"></div>
      <div class="body">
        <div class="row1">
          <span class="level">${escapeHtml(e.level || e.source || "")}</span>
          <span class="status ${e.status || 'past'}">${e.status || 'archived'}</span>
        </div>
        <div class="name">${escapeHtml(e.name)}</div>
        <div class="meta">${flag(e.country)} ${escapeHtml(e.venue || "")}${e.start ? ` · ${e.start}` : ""}</div>
        <div class="circuit">${escapeHtml(e.circuit || e.source || "")}</div>
      </div>
    </a>`;
}

function resultsTable(rows) {
  return `<div class="table-wrap"><table class="pretty">
    <thead><tr><th>#</th><th>Rider</th><th>Horse</th><th>Nation</th><th class="num">Faults</th><th class="num">Time</th><th>Class / Event</th></tr></thead>
    <tbody>${rows.map((r) => `
      <tr class="row-link" data-link="#/event/${encodeURIComponent(r.event_id)}">
        <td class="rank ${r.rank===1?'top1':r.rank<=3?'top3':''}">${r.rank || "—"}</td>
        <td class="rider"><a href="#/rider/${encodeURIComponent(r.rider)}" style="color:inherit">${escapeHtml(r.rider)}</a></td>
        <td class="horse">${escapeHtml(r.horse || "")}</td>
        <td class="nation">${flag(r.nation)} ${escapeHtml(r.nation || "")}</td>
        <td class="num">${escapeHtml(r.faults || "")}</td>
        <td class="num">${escapeHtml(r.time || "")}</td>
        <td style="color:var(--muted)">${escapeHtml(r.class_name || "")} ${r.event_name && r.event_name !== r.class_name ? `· ${escapeHtml(r.event_name)}` : ""}</td>
      </tr>`).join("")}</tbody>
  </table></div>`;
}

function riderCard(r) {
  const initials = (r.name || "").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  return `
    <div class="rider-card" data-rider="${escapeAttr(r.name)}">
      <div class="rider-avatar">${initials}</div>
      <div class="rider-info">
        <div class="rider-name">${escapeHtml(r.name)}</div>
        <div class="rider-nation">${flag(r.nation)} ${escapeHtml(r.nation || "")} · ${r.starts || 0} starts · ${r.wins || 0} wins</div>
      </div>
      ${r.world_rank ? `<div class="rider-rank"><small>Rank</small>#${r.world_rank}</div>` : ""}
    </div>`;
}

function videoCard(v) {
  return `
    <div class="video-card" data-url="${escapeAttr(v.url)}" data-title="${escapeAttr(v.title)}">
      <div class="video-thumb" style="background-image:url('${v.thumbnail}')"></div>
      <div class="video-body">
        <div class="video-title">${escapeHtml(v.title)}</div>
        <div class="video-meta"><span class="channel">${escapeHtml(v.channel)}</span> <span>${escapeHtml(v.published || "")}</span></div>
      </div>
    </div>`;
}

/* ---------- Interactivity ---------- */

function hookEvents() {
  // event cards are anchors; nothing to do
}
function hookRows() {
  $$(".row-link").forEach((row) => {
    row.onclick = (e) => {
      // Avoid capturing anchor clicks inside cells
      if (e.target.closest("a")) return;
      location.hash = row.dataset.link;
    };
  });
}
function hookVideoCards() {
  $$(".video-card").forEach((c) => c.onclick = () => openVideo(c.dataset.url, c.dataset.title));
}

function openVideo(url, title) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (!m) return window.open(url, "_blank");
  const vid = m[1];
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <button class="modal-close" aria-label="Close">×</button>
    <div class="modal-video">
      <iframe src="https://www.youtube.com/embed/${vid}?autoplay=1" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>
    </div>`;
  const close = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal || e.target.classList.contains("modal-close")) close(); };
  document.addEventListener("keydown", function esc(e){ if (e.key === "Escape"){ close(); document.removeEventListener("keydown", esc); }});
  document.body.appendChild(modal);
}

/* ---------- Utilities ---------- */

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/`/g, "&#96;"); }
function formatPts(n) {
  if (n == null) return "—";
  n = Number(n);
  if (isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function defaultCover(e) {
  // Generate an SVG data URL with a themed gradient + venue text.
  // Deterministic per event for stable visuals.
  const seed = (e.name || e.id || "x").split("").reduce((a,c) => a + c.charCodeAt(0), 0);
  const palettes = [
    ["#0f2027", "#203a43", "#2c5364"], // steel blue
    ["#1e3c72", "#2a5298", "#0b3d91"], // royal
    ["#232526", "#414345", "#1a1a1a"], // graphite
    ["#3a1c71", "#d76d77", "#ffaf7b"], // sunset
    ["#134e5e", "#71b280", "#0a3d3d"], // pasture
    ["#8b0000", "#ff4500", "#4b0000"], // red-orange (accent)
    ["#141e30", "#243b55", "#0a1420"], // midnight
    ["#1f4037", "#99f2c8", "#0b3d3d"], // emerald
  ];
  const p = palettes[seed % palettes.length];
  const label = (e.venue || e.name || "").split("\u2014")[0].split("-")[0].trim().slice(0, 24) || "Show Jumping";
  const level = e.level || e.circuit || "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${p[0]}"/>
        <stop offset="55%" stop-color="${p[1]}"/>
        <stop offset="100%" stop-color="${p[2]}"/>
      </linearGradient>
      <radialGradient id="r" cx="75%" cy="30%" r="60%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.20)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
      </radialGradient>
    </defs>
    <rect width="800" height="450" fill="url(#g)"/>
    <rect width="800" height="450" fill="url(#r)"/>
    <g opacity="0.10" fill="none" stroke="#fff" stroke-width="1.5">
      <path d="M0 340 Q200 300 400 340 T800 340"/>
      <path d="M0 380 Q200 350 400 380 T800 380"/>
    </g>
    <text x="40" y="110" font-family="monospace" font-size="16" fill="rgba(255,255,255,0.55)" letter-spacing="4">${escapeXml(level.toUpperCase())}</text>
    <text x="40" y="180" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="800" fill="#ffffff">${escapeXml(label)}</text>
    <text x="720" y="390" font-size="120" text-anchor="middle" opacity="0.35">\ud83d\udc0e</text>
  </svg>`;
  // Base64-encode to avoid CSS url() parsing issues with commas/quotes
  const b64 = typeof btoa !== 'undefined' ? btoa(unescape(encodeURIComponent(svg))) : Buffer.from(svg).toString('base64');
  return "data:image/svg+xml;base64," + b64;
}

function escapeXml(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;", '"':"&quot;", "'":"&apos;" }[c]));
}

/* ---------- Boot ---------- */

loadData();
