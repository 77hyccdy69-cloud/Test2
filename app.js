'use strict';
/* ======================= Helfer ======================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const clean = h => {
  const s = String(h || '').replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ');
  const t = new DOMParser().parseFromString(s, 'text/html').body.textContent || '';
  return t.replace(/\s+/g, ' ').trim();
};
const safeUrl = u => (/^(https?:\/\/|data:image\/)/i.test(u || '') ? u : '');
const toast = (msg) => {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
};
async function getJSON(url, opt = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 10000);
  try {
    const r = await fetch(url, { ...opt, signal: c.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* ======================= Datenhaltung ======================= */
const KEY = 'rankly.v1';
const COLORS = ['#7c5cff', '#ff5c93', '#2dd4bf', '#f5a524', '#4ea1ff', '#7ed957', '#ff7a45', '#c084fc'];
const EMOJIS = ['🎬', '📺', '🌸', '🎮', '📚', '🎵', '🍕', '✈️', '⚽', '🍺', '🎲', '🌍', '🐶', '🚗', '💻', '⭐'];
const SOURCES = {
  movie: 'Filme',
  tv: 'Serien',
  anime: 'Anime',
  game: 'Spiele',
  book: 'Bücher',
  wiki: 'Alles andere (Wikipedia)',
};
const defaults = () => ({
  categories: [
    { id: uid(), name: 'Filme', emoji: '🎬', color: COLORS[0], source: 'movie', sort: 'manual', view: 'list' },
    { id: uid(), name: 'Serien', emoji: '📺', color: COLORS[1], source: 'tv', sort: 'manual', view: 'list' },
    { id: uid(), name: 'Anime', emoji: '🌸', color: COLORS[7], source: 'anime', sort: 'manual', view: 'list' },
    { id: uid(), name: 'Spiele', emoji: '🎮', color: COLORS[2], source: 'game', sort: 'manual', view: 'list' },
  ],
  items: [],
  settings: { tmdb: '', rawg: '' },
  last: 'home',
});
let S;
function load() {
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch { S = null; }
  if (!S || !Array.isArray(S.categories)) S = defaults();
  S.items = S.items || []; S.settings = S.settings || { tmdb: '', rawg: '' };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch { toast('⚠️ Speichern fehlgeschlagen (Speicher voll?)'); }
}
const cat = id => S.categories.find(c => c.id === id);
const manual = cid => S.items.filter(i => i.catId === cid).sort((a, b) => a.order - b.order);
function ranked(c) {
  const l = manual(c.id);
  if (c.sort !== 'score') return l;
  return l.map((i, n) => [i, n]).sort((a, b) => (b[0].score ?? -1) - (a[0].score ?? -1) || a[1] - b[1]).map(x => x[0]);
}
const setOrder = ids => ids.forEach((id, n) => { S.items.find(i => i.id === id).order = n; });

/* ======================= Datenquellen (Bilder + Beschreibung) ======================= */
const strip = t => t.replace(/\s*\([^)]*\)\s*$/, '').trim();

async function wikiLang(lang, q) {
  const p = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: q, gsrlimit: '6',
    prop: 'pageimages|extracts|info', inprop: 'url', piprop: 'thumbnail', pithumbsize: '500',
    exintro: '1', explaintext: '1', exsentences: '4',
  });
  const j = await getJSON(`https://${lang}.wikipedia.org/w/api.php?${p}`);
  return Object.values(j.query?.pages || {})
    .sort((a, b) => a.index - b.index)
    .filter(p => !/Begriffsklärung|disambiguation|^Liste |^List of /i.test(p.title))
    .map(p => ({
      title: strip(p.title), image: p.thumbnail?.source || '', desc: clean(p.extract),
      link: p.fullurl, src: 'Wikipedia ' + lang.toUpperCase(),
    }));
}
const wiki = (hintDe, hintEn) => async q => {
  const [de, en] = await Promise.allSettled([wikiLang('de', `${q} ${hintDe}`.trim()), wikiLang('en', `${q} ${hintEn}`.trim())]);
  const a = de.value || [], b = en.value || [];
  if (!a.length && !b.length && (de.status === 'rejected' && en.status === 'rejected')) throw new Error('wiki');
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]); }
  return out;
};

const srcTMDB = kind => async q => {
  const k = S.settings.tmdb; if (!k) return [];
  const j = await getJSON(`https://api.themoviedb.org/3/search/${kind}?api_key=${encodeURIComponent(k)}&language=de-DE&query=${encodeURIComponent(q)}`);
  return (j.results || []).slice(0, 8).map(r => ({
    title: r.title || r.name, year: (r.release_date || r.first_air_date || '').slice(0, 4),
    image: r.poster_path ? 'https://image.tmdb.org/t/p/w500' + r.poster_path : '',
    desc: r.overview || '', link: `https://www.themoviedb.org/${kind}/${r.id}`, src: 'TMDB',
  }));
};
async function srcItunesMovie(q) {
  const j = await getJSON(`https://itunes.apple.com/search?media=movie&entity=movie&country=de&lang=de_de&limit=8&term=${encodeURIComponent(q)}`);
  return (j.results || []).map(r => ({
    title: r.trackName, year: (r.releaseDate || '').slice(0, 4),
    image: (r.artworkUrl100 || '').replace('100x100bb', '600x900bb'),
    desc: r.longDescription || r.shortDescription || '', link: r.trackViewUrl, src: 'iTunes',
  }));
}
async function srcTVmaze(q) {
  const j = await getJSON(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`);
  return j.slice(0, 8).map(({ show: s }) => ({
    title: s.name, year: (s.premiered || '').slice(0, 4),
    image: s.image?.original || s.image?.medium || '', desc: clean(s.summary), link: s.url, src: 'TVmaze',
  }));
}
async function srcAniList(q) {
  const query = `query($s:String){Page(perPage:8){media(search:$s,type:ANIME,sort:SEARCH_MATCH){title{romaji english} startDate{year} format coverImage{large extraLarge} description(asHtml:false) siteUrl}}}`;
  try {
    const j = await getJSON('https://graphql.anilist.co', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables: { s: q } }),
    });
    return j.data.Page.media.map(m => ({
      title: m.title.english || m.title.romaji, year: m.startDate?.year || '',
      image: m.coverImage.extraLarge || m.coverImage.large, desc: clean(m.description),
      link: m.siteUrl, src: 'AniList', sub: m.format,
    }));
  } catch { // Fallback: Jikan (MyAnimeList)
    const j = await getJSON(`https://api.jikan.moe/v4/anime?limit=8&q=${encodeURIComponent(q)}`);
    return (j.data || []).map(m => ({
      title: m.title_english || m.title, year: m.year || '', image: m.images?.jpg?.large_image_url || '',
      desc: clean(m.synopsis), link: m.url, src: 'MyAnimeList', sub: m.type,
    }));
  }
}
async function srcRAWG(q) {
  const k = S.settings.rawg; if (!k) return [];
  const j = await getJSON(`https://api.rawg.io/api/games?key=${encodeURIComponent(k)}&page_size=8&search=${encodeURIComponent(q)}`);
  return (j.results || []).map(g => ({
    title: g.name, year: (g.released || '').slice(0, 4), image: g.background_image || '',
    link: `https://rawg.io/games/${g.slug}`, src: 'RAWG',
    lazyDesc: async () => clean((await getJSON(`https://api.rawg.io/api/games/${g.id}?key=${encodeURIComponent(k)}`)).description_raw || ''),
  }));
}
async function srcOpenLibrary(q) {
  const j = await getJSON(`https://openlibrary.org/search.json?limit=8&fields=key,title,author_name,first_publish_year,cover_i&q=${encodeURIComponent(q)}`);
  return (j.docs || []).map(d => ({
    title: d.title, year: d.first_publish_year || '', sub: (d.author_name || [])[0] || '',
    image: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : '',
    link: 'https://openlibrary.org' + d.key, src: 'Open Library',
    lazyDesc: async () => {
      const w = await getJSON(`https://openlibrary.org${d.key}.json`);
      return clean(typeof w.description === 'string' ? w.description : w.description?.value || '');
    },
  }));
}
const PIPELINE = {
  movie: [srcTMDB('movie'), srcItunesMovie, wiki('Film', 'film')],
  tv: [srcTMDB('tv'), srcTVmaze, wiki('Fernsehserie', 'TV series')],
  anime: [srcAniList, wiki('Anime', 'anime')],
  game: [srcRAWG, wiki('Videospiel', 'video game')],
  book: [srcOpenLibrary, wiki('Buch', 'book')],
  wiki: [wiki('', '')],
};
async function searchAll(source, q) {
  const fns = PIPELINE[source] || PIPELINE.wiki;
  const res = await Promise.allSettled(fns.map(f => f(q)));
  const seen = new Set(), out = [];
  res.forEach(r => (r.value || []).forEach(x => {
    if (!x.title) return;
    const k = x.title.toLowerCase() + '|' + x.year;
    if (seen.has(k)) return; seen.add(k); out.push(x);
  }));
  // Treffer mit Bild vor Treffern ohne Bild, Reihenfolge der Quellen bleibt sonst erhalten
  out.sort((a, b) => !!b.image - !!a.image);
  return { results: out.slice(0, 14), failed: res.every(r => r.status === 'rejected') };
}

/* ======================= UI-Bausteine ======================= */
const hue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
function poster(item, cls) {
  const img = safeUrl(item.image);
  if (img) return `<img class="${cls}" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=window.phHTML(this.dataset.t,'${cls}')" data-t="${esc(item.title)}">`;
  return phHTML(item.title, cls);
}
window.phHTML = (title, cls) => {
  const h = hue(title || '?');
  return `<div class="ph ${cls}" style="--c1:hsl(${h} 55% 45%);--c2:hsl(${(h + 50) % 360} 55% 30%)">${esc((title || '?').trim().charAt(0).toUpperCase())}</div>`;
};
const scoreCls = s => (s >= 8 ? 'hi' : s >= 5 ? 'mid' : 'lo');
const scoreHTML = it => it.score == null ? '<span class="score none">unbewertet</span>' : `<span class="score ${scoreCls(it.score)}">★ ${it.score.toFixed(1).replace('.', ',')}</span>`;
const metaOf = it => [it.year, it.sub].filter(Boolean).join(' · ');

/* ======================= Rendering ======================= */
let view = 'home';
function render() {
  if (view !== 'home' && !cat(view)) view = 'home';
  renderNav(); renderHead();
  $('#searchBox').hidden = view === 'home';
  $('#results').hidden = true;
  view === 'home' ? renderHome() : renderCat(cat(view));
}
function renderNav() {
  $('#nav').innerHTML =
    `<button class="nav-item ${view === 'home' ? 'active' : ''}" data-act="go" data-id="home"><span class="emo">🏠</span>Übersicht</button><div class="nav-sep"></div>` +
    S.categories.map(c => `<button class="nav-item ${view === c.id ? 'active' : ''}" style="--c:${c.color}" data-act="go" data-id="${c.id}"><span class="emo">${esc(c.emoji)}</span>${esc(c.name)}<span class="cnt">${S.items.filter(i => i.catId === c.id).length}</span></button>`).join('');
}
function renderHead() {
  const t = $('#viewTitle'), sub = $('#viewSub'), tools = $('#tools');
  if (view === 'home') {
    t.textContent = 'Deine Ranglisten';
    sub.textContent = `${S.categories.length} Kategorien · ${S.items.length} Einträge`;
    tools.innerHTML = '';
    return;
  }
  const c = cat(view);
  t.textContent = `${c.emoji} ${c.name}`;
  sub.textContent = `${S.items.filter(i => i.catId === c.id).length} Einträge · Quelle: ${SOURCES[c.source]}`;
  tools.innerHTML = `
    <div class="seg"><button data-act="sort" data-v="manual" class="${c.sort !== 'score' ? 'on' : ''}" title="Per Drag & Drop selbst sortieren">✋ Eigene Reihenfolge</button><button data-act="sort" data-v="score" class="${c.sort === 'score' ? 'on' : ''}" title="Automatisch nach Bewertung">★ Nach Bewertung</button></div>
    <div class="seg"><button data-act="vw" data-v="list" class="${c.view !== 'grid' ? 'on' : ''}">☰ Liste</button><button data-act="vw" data-v="grid" class="${c.view === 'grid' ? 'on' : ''}">▦ Galerie</button></div>
    <button class="icon-btn" data-act="editcat" title="Kategorie bearbeiten">✏️</button>`;
}
function renderHome() {
  const el = $('#content');
  if (!S.categories.length) { el.innerHTML = `<div class="empty"><div class="big">🗂️</div><p>Lege deine erste Kategorie an.</p></div>`; return; }
  el.innerHTML = S.categories.map(c => {
    const l = ranked(c).slice(0, 8);
    return `<div class="home-cat"><h2 data-act="go" data-id="${c.id}" style="color:${c.color}">${esc(c.emoji)} ${esc(c.name)} <span class="muted" style="font-size:13px">→</span></h2>` +
      (l.length ? `<div class="home-strip">${l.map((i, n) => `<div class="tile" data-act="open" data-id="${i.id}">${poster(i, 'im')}<span class="tn">${n + 1}</span><div class="ti">${esc(i.title)}</div></div>`).join('')}</div>`
        : `<p class="muted">Noch leer – <a href="#" data-act="go" data-id="${c.id}" style="color:var(--accent)">ersten Eintrag hinzufügen</a></p>`) + `</div>`;
  }).join('');
}
function renderCat(c) {
  const el = $('#content'), list = ranked(c);
  $('#searchInput').placeholder = `${c.name}: Titel suchen und zum Ranking hinzufügen …`;
  if (!list.length) {
    el.innerHTML = `<div class="empty"><div class="big">${esc(c.emoji)}</div><p><b>Noch nichts in „${esc(c.name)}“.</b><br>Suche oben nach einem Titel – Bild und Kurzbeschreibung werden automatisch geladen.</p></div>`;
    return;
  }
  const drag = c.sort !== 'score' ? 'draggable="true" data-drag="1"' : '';
  if (c.view === 'grid') {
    el.innerHTML = `<div class="grid">${list.map((i, n) => `<div class="tile" ${drag} data-act="open" data-id="${i.id}">${poster(i, 'im')}<span class="tn">${n + 1}</span><div class="ti">${esc(i.title)}</div></div>`).join('')}</div>`;
    return;
  }
  let html = '';
  let rest = list, offset = 0;
  if (list.length >= 3) {
    const top = list.slice(0, 3); rest = list.slice(3); offset = 3;
    html += `<div class="podium">${top.map((i, n) => `<div class="pod p${n + 1}" ${drag} data-act="open" data-id="${i.id}"><span class="medal">${n + 1}</span><span class="sc">${i.score != null ? scoreHTML(i) : ''}</span>${poster(i, 'pimg')}<div class="pinfo"><b>${esc(i.title)}</b><span class="muted">${esc(metaOf(i)) || '&nbsp;'}</span></div></div>`).join('')}</div>`;
  }
  html += `<div class="list">${rest.map((i, n) => {
    const r = n + offset + 1;
    return `<div class="row r${r}" ${drag} data-act="open" data-id="${i.id}"><div class="rank">${r}<small>Platz</small></div>${poster(i, 'pimg2')}<div class="info"><div class="t">${esc(i.title)}</div><div class="meta">${esc(metaOf(i))}</div><div class="d">${esc(i.desc)}</div></div>${scoreHTML(i)}</div>`;
  }).join('')}</div>`;
  el.innerHTML = html;
}

/* ======================= Modal ======================= */
function modal(html) { $('#modalCard').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; $('#modalCard').innerHTML = ''; }

function catModal(c) {
  const d = c ? { ...c } : { name: '', emoji: '⭐', color: COLORS[S.categories.length % COLORS.length], source: 'wiki' };
  modal(`<h2>${c ? 'Kategorie bearbeiten' : 'Neue Kategorie'}</h2>
    <label class="f">Name<input id="cName" value="${esc(d.name)}" placeholder="z. B. Bücher, Restaurants, Brettspiele …" maxlength="40"></label>
    <label class="f">Symbol (Emoji)<input id="cEmoji" value="${esc(d.emoji)}" maxlength="4"></label>
    <div class="emoji-pick">${EMOJIS.map(e => `<button type="button" data-emoji="${e}" class="${e === d.emoji ? 'on' : ''}">${e}</button>`).join('')}</div>
    <label class="f" style="margin-top:12px">Woher sollen Bilder & Beschreibungen kommen?
      <select id="cSource">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}" ${d.source === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <p class="hint">Filme: iTunes/TMDB · Serien: TVmaze/TMDB · Anime: AniList · Spiele: RAWG · Bücher: Open Library – jeweils plus Wikipedia (DE/EN) als Ergänzung. „Alles andere“ nutzt nur Wikipedia – ideal für eigene Kategorien wie Städte, Autos oder Restaurants.</p>
    <div class="btn-row">${c ? '<button class="btn danger" id="cDel" style="margin-right:auto">Löschen</button>' : ''}<button class="btn ghost" data-act="close">Abbrechen</button><button class="btn" id="cSave">Speichern</button></div>`);
  $('#cName').focus();
  $('#modalCard').onclick = e => {
    const b = e.target.closest('[data-emoji]'); if (!b) return;
    $('#cEmoji').value = b.dataset.emoji;
    document.querySelectorAll('[data-emoji]').forEach(x => x.classList.toggle('on', x === b));
  };
  $('#cSave').onclick = () => {
    const name = $('#cName').value.trim(); if (!name) return $('#cName').focus();
    const vals = { name, emoji: $('#cEmoji').value.trim() || '⭐', source: $('#cSource').value };
    if (c) Object.assign(c, vals);
    else { const n = { id: uid(), color: d.color, sort: 'manual', view: 'list', ...vals }; S.categories.push(n); view = n.id; }
    save(); closeModal(); render();
  };
  if (c) $('#cDel').onclick = () => {
    const n = S.items.filter(i => i.catId === c.id).length;
    if (!confirm(`Kategorie „${c.name}“ mit ${n} Einträgen wirklich löschen?`)) return;
    S.categories = S.categories.filter(x => x !== c); S.items = S.items.filter(i => i.catId !== c.id);
    view = 'home'; save(); closeModal(); render();
  };
}

function itemModal(item, isNew) {
  const c = cat(item.catId);
  const d = { ...item };
  const pos = manual(item.catId).findIndex(i => i.id === item.id) + 1 || manual(item.catId).length + 1;
  modal(`<h2>${isNew ? 'Neuer Eintrag' : 'Eintrag bearbeiten'}</h2>
    <div class="detail">
      <div><div id="dCover">${poster(d, 'cover')}</div>
        <label class="f" style="margin-top:10px">Bild-URL<input id="dImg" value="${esc(d.image?.startsWith('data:') ? '' : d.image)}" placeholder="https://…"></label>
        <label class="f">oder Bild hochladen<input id="dFile" type="file" accept="image/*"></label>
      </div>
      <div>
        <label class="f">Titel<input id="dTitle" value="${esc(d.title)}"></label>
        <label class="f">Jahr / Zusatz<input id="dYear" value="${esc(d.year || '')}" placeholder="z. B. 2019"></label>
        <div class="scorebar"><label class="f" style="margin:0"><input id="dNo" type="checkbox" ${d.score == null ? 'checked' : ''}> unbewertet</label>
          <input id="dScore" type="range" min="0" max="10" step="0.5" value="${d.score ?? 7}" ${d.score == null ? 'disabled' : ''}><output id="dOut">${d.score == null ? '–' : d.score.toFixed(1)}</output></div>
        <label class="f">Kurzbeschreibung<textarea id="dDesc">${esc(d.desc)}</textarea></label>
        <label class="f">Meine Notiz<textarea id="dNote" style="min-height:60px" placeholder="Warum gefällt es dir?">${esc(d.note || '')}</textarea></label>
        <div style="display:flex;gap:10px">
          <label class="f" style="flex:1">Kategorie<select id="dCat">${S.categories.map(x => `<option value="${x.id}" ${x.id === d.catId ? 'selected' : ''}>${esc(x.emoji + ' ' + x.name)}</option>`).join('')}</select></label>
          ${isNew ? '' : `<label class="f" style="width:110px">Platz<input id="dPos" type="number" min="1" max="${manual(item.catId).length}" value="${pos}" ${c.sort === 'score' ? 'disabled title="Automatische Sortierung nach Bewertung aktiv"' : ''}></label>`}
        </div>
        ${d.link ? `<p class="hint"><a href="${esc(d.link)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">Quelle öffnen ↗</a></p>` : ''}
      </div>
    </div>
    <details style="margin-top:6px"><summary class="muted" style="cursor:pointer">🔄 Bild & Beschreibung neu suchen</summary>
      <div class="search-input" style="margin-top:8px"><input id="rQ" value="${esc(d.title)}" type="search"><button class="btn small" id="rGo">Suchen</button></div>
      <div class="results" id="rRes" style="position:static;margin-top:8px;box-shadow:none" hidden></div></details>
    <div class="btn-row">${isNew ? '' : '<button class="btn danger" id="dDel" style="margin-right:auto">Löschen</button>'}<button class="btn ghost" data-act="close">Abbrechen</button><button class="btn" id="dSave">${isNew ? 'Hinzufügen' : 'Speichern'}</button></div>`);

  const refreshCover = () => { $('#dCover').innerHTML = poster({ ...d, title: $('#dTitle').value || '?' }, 'cover'); };
  $('#dImg').oninput = e => { d.image = e.target.value.trim(); refreshCover(); };
  $('#dFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    d.image = await shrink(f); $('#dImg').value = ''; refreshCover();
  };
  $('#dNo').onchange = e => { $('#dScore').disabled = e.target.checked; $('#dOut').textContent = e.target.checked ? '–' : (+$('#dScore').value).toFixed(1); };
  $('#dScore').oninput = e => { $('#dOut').textContent = (+e.target.value).toFixed(1); };
  const doRe = async () => {
    const box = $('#rRes'); box.hidden = false; box.innerHTML = '<div class="res-msg">Suche …</div>';
    const { results, failed } = await searchAll(cat($('#dCat').value).source, $('#rQ').value.trim());
    renderResults(box, results, failed, async r => {
      d.image = r.image || d.image; d.link = r.link || d.link;
      $('#dDesc').value = r.desc || (r.lazyDesc ? await r.lazyDesc().catch(() => '') : '') || $('#dDesc').value;
      if (r.year) $('#dYear').value = r.year;
      $('#dImg').value = d.image.startsWith('data:') ? '' : d.image; refreshCover(); box.hidden = true; toast('Bild & Beschreibung übernommen');
    });
  };
  $('#rGo').onclick = doRe;
  $('#rQ').onkeydown = e => { if (e.key === 'Enter') doRe(); };
  $('#dSave').onclick = () => {
    const title = $('#dTitle').value.trim(); if (!title) return $('#dTitle').focus();
    const catId = $('#dCat').value;
    Object.assign(item, {
      title, year: $('#dYear').value.trim(), image: d.image || '', link: d.link || '',
      desc: $('#dDesc').value.trim(), note: $('#dNote').value.trim(),
      score: $('#dNo').checked ? null : +$('#dScore').value,
    });
    if (isNew) { item.catId = catId; item.order = manual(catId).length; S.items.push(item); }
    else if (catId !== item.catId) { item.catId = catId; item.order = manual(catId).length; }
    else if ($('#dPos') && !$('#dPos').disabled) {
      const ids = manual(catId).map(i => i.id).filter(i => i !== item.id);
      ids.splice(Math.max(0, Math.min(ids.length, (+$('#dPos').value || 1) - 1)), 0, item.id); setOrder(ids);
    }
    save(); closeModal(); render();
  };
  if (!isNew) $('#dDel').onclick = () => {
    if (!confirm(`„${item.title}“ löschen?`)) return;
    S.items = S.items.filter(i => i !== item); setOrder(manual(item.catId).map(i => i.id)); save(); closeModal(); render();
  };
}
function shrink(file) {
  return new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => {
      const im = new Image();
      im.onload = () => {
        const w = Math.min(500, im.width), h = Math.round(im.height * w / im.width);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(im, 0, 0, w, h); res(cv.toDataURL('image/jpeg', .82));
      };
      im.onerror = () => res(''); im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

function settingsModal() {
  modal(`<h2>⚙️ Einstellungen</h2>
    <p class="hint">Ohne Schlüssel funktioniert alles bereits (iTunes, TVmaze, AniList, Open Library, Wikipedia). Mit eigenen kostenlosen API-Schlüsseln bekommst du bessere Treffer bei Filmen/Serien (deutsche Beschreibungen) und Spielen. Die Schlüssel bleiben nur in deinem Browser.</p>
    <label class="f">TMDB API-Key (Filme & Serien, themoviedb.org)<input id="sTmdb" value="${esc(S.settings.tmdb)}" autocomplete="off"></label>
    <label class="f">RAWG API-Key (Spiele, rawg.io)<input id="sRawg" value="${esc(S.settings.rawg)}" autocomplete="off"></label>
    <div class="btn-row" style="justify-content:flex-start">
      <button class="btn ghost" id="sExp">⬇️ Daten exportieren</button>
      <label class="btn ghost" style="cursor:pointer">⬆️ Importieren<input id="sImp" type="file" accept="application/json" hidden></label>
    </div>
    <div class="btn-row"><button class="btn ghost" data-act="close">Schließen</button><button class="btn" id="sSave">Speichern</button></div>`);
  $('#sSave').onclick = () => { S.settings.tmdb = $('#sTmdb').value.trim(); S.settings.rawg = $('#sRawg').value.trim(); save(); closeModal(); toast('Gespeichert'); };
  $('#sExp').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
    a.download = 'rankly-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#sImp').onchange = async e => {
    try {
      const j = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(j.categories) || !Array.isArray(j.items)) throw 0;
      if (!confirm('Aktuelle Daten durch den Import ersetzen?')) return;
      S = j; S.settings = S.settings || { tmdb: '', rawg: '' }; save(); closeModal(); view = 'home'; render(); toast('Import erfolgreich');
    } catch { toast('⚠️ Ungültige Datei'); }
  };
}

/* ======================= Suche ======================= */
function renderResults(box, results, failed, onPick) {
  if (!results.length) {
    box.innerHTML = `<div class="res-msg">${failed ? '⚠️ Keine Verbindung zu den Datenquellen. Du kannst den Eintrag manuell anlegen.' : 'Keine Treffer – probiere einen anderen Titel oder lege den Eintrag manuell an.'}</div>`;
    return;
  }
  box.innerHTML = results.map((r, n) => `<div class="res" data-n="${n}">${poster(r, 'rimg')}<div style="min-width:0"><b>${esc(r.title)} <span class="muted" style="font-weight:400">${esc([r.year, r.sub].filter(Boolean).join(' · '))}</span></b><div class="desc">${esc(r.desc) || '<i>keine Beschreibung</i>'}</div><span class="src">${esc(r.src)}</span></div></div>`).join('');
  box.onclick = e => { const el = e.target.closest('.res'); if (el) onPick(results[+el.dataset.n]); };
}
let lastRes = [], searchSeq = 0, timer;
function onSearch() {
  clearTimeout(timer);
  const q = $('#searchInput').value.trim(), box = $('#results');
  if (q.length < 2) { box.hidden = true; return; }
  box.hidden = false; box.innerHTML = '<div class="res-msg">Suche läuft …</div>';
  timer = setTimeout(async () => {
    const seq = ++searchSeq, c = cat(view); if (!c) return;
    const { results, failed } = await searchAll(c.source, q);
    if (seq !== searchSeq) return;
    lastRes = results;
    renderResults(box, results, failed, r => addFromResult(c, r));
  }, 350);
}
async function addFromResult(c, r) {
  if (S.items.some(i => i.catId === c.id && i.title.toLowerCase() === r.title.toLowerCase() && String(i.year) === String(r.year || ''))) {
    toast('Dieser Eintrag ist schon in der Liste'); return;
  }
  $('#results').hidden = true; $('#searchInput').value = '';
  let desc = r.desc;
  if (!desc && r.lazyDesc) { toast('Lade Beschreibung …'); desc = await r.lazyDesc().catch(() => ''); }
  const item = { id: uid(), catId: c.id, title: r.title, year: r.year || '', sub: r.sub || '', image: r.image || '', desc: desc || '', link: r.link || '', score: null, note: '', order: 0 };
  itemModal(item, true); // direkt Bewertung vergeben können
}

/* ======================= Events ======================= */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); const act = t?.dataset.act;
  if (!e.target.closest('#searchBox')) $('#results').hidden = true;
  if (e.target.id === 'modal') return closeModal();
  if (!act) return;
  const c = cat(view);
  if (act === 'go') { e.preventDefault(); view = t.dataset.id; S.last = view; save(); $('#sidebar').classList.remove('open'); render(); window.scrollTo(0, 0); }
  else if (act === 'open') { const it = S.items.find(i => i.id === t.dataset.id); if (it) itemModal(it, false); }
  else if (act === 'close') closeModal();
  else if (act === 'sort') { c.sort = t.dataset.v; save(); render(); }
  else if (act === 'vw') { c.view = t.dataset.v; save(); render(); }
  else if (act === 'editcat') catModal(c);
});
$('#addCatBtn').onclick = () => { $('#sidebar').classList.remove('open'); catModal(null); };
$('#settingsBtn').onclick = settingsModal;
$('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
$('#searchInput').addEventListener('input', onSearch);
$('#searchInput').addEventListener('focus', () => { if ($('#searchInput').value.trim().length >= 2 && lastRes.length) $('#results').hidden = false; });
$('#searchInput').addEventListener('keydown', e => {
  if (e.key === 'Escape') $('#results').hidden = true;
  if (e.key === 'Enter') { const f = $('#results .res'); if (f) f.click(); }
});
$('#manualBtn').onclick = () => {
  const c = cat(view); if (!c) return;
  itemModal({ id: uid(), catId: c.id, title: $('#searchInput').value.trim(), year: '', image: '', desc: '', link: '', score: null, note: '', order: 0 }, true);
};
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

/* Drag & Drop (Eigene Reihenfolge) */
let dragId = null;
document.addEventListener('dragstart', e => {
  const el = e.target.closest?.('[data-drag]'); if (!el) return;
  dragId = el.dataset.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
});
document.addEventListener('dragover', e => {
  const el = e.target.closest?.('[data-drag]'); if (!el || !dragId) return;
  e.preventDefault(); document.querySelectorAll('.over').forEach(x => x.classList.remove('over')); el.classList.add('over');
});
document.addEventListener('drop', e => {
  const el = e.target.closest?.('[data-drag]'); if (!el || !dragId) return;
  e.preventDefault();
  const c = cat(view), ids = manual(c.id).map(i => i.id), from = ids.indexOf(dragId), to = ids.indexOf(el.dataset.id);
  if (from >= 0 && to >= 0 && from !== to) { ids.splice(from, 1); ids.splice(to, 0, dragId); setOrder(ids); save(); }
  dragId = null; render();
});
document.addEventListener('dragend', () => { dragId = null; document.querySelectorAll('.dragging,.over').forEach(x => x.classList.remove('dragging', 'over')); });

/* ======================= Start ======================= */
load();
view = S.last || 'home';
render();
