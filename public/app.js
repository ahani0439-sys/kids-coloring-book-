// KDP Coloring Book Factory: mobile client. All keys stay on the server; this file only calls /api.
// Every book-specific request goes to /api/books/<id>/... for the book that is open.
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inch = (v, d = 3) => `${Number(v).toFixed(d)}"`;
const kb = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');
const STATUS = { empty: 'Needs art', generating: 'Generating', review: 'Review', approved: 'Approved', rejected: 'Rejected', failed: 'Failed' };

let S = null;
const TABS = ['books', 'overview', 'pages', 'book', 'export'];
let tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
let LIB = null;            // library: list of books
let bookId = null;         // the open book
let BP = '/api';           // API prefix for the open book
let showArchived = false;
let renaming = null;
let confirmArchive = null;
let newBook = { open: false, title: '', theme: '', count: 30, custom: '', trim: '8.5x11', paper: 'white', intro: true };
let preview = null;
let previewTimer = null;
let filter = 'all';
let lastReport = null;
let busy = false;
let pollTimer = null;
let confirmDelete = null;
let confirmAct = null;

// Full-size preview of one illustration, with the review actions underneath.
function openPreview(id) {
  const il = S.illustrations.find((i) => i.id === id);
  if (!il || !il.hasImage) return;
  let el = $('#preview');
  if (!el) { el = document.createElement('div'); el.id = 'preview'; el.className = 'lightbox'; document.body.appendChild(el); }
  const actions = il.status === 'review'
    ? `<button class="btn ok" data-act="approve" data-id="${il.id}">Approve</button><button class="btn bad" data-act="reject" data-id="${il.id}">Reject</button><button class="btn" data-act="regenerate" data-id="${il.id}" ${il.canGenerate ? '' : 'disabled'}>Regenerate</button>`
    : '';
  el.innerHTML = `<div class="lightbox-bar"><strong>${il.id}. ${esc(il.title)}</strong><button class="btn ghost" data-closepreview="1" aria-label="Close preview">Close</button></div>
    <div class="lightbox-img"><img src="${BP}/illustrations/${il.id}/image?v=${encodeURIComponent(il.image.file)}" alt="Full-size preview of illustration ${il.id}"></div>
    <div class="lightbox-bar"><span class="pill st-${il.status}">${STATUS[il.status]}</span><div class="btn-row">${actions}</div></div>`;
  el.hidden = false;
}
function closePreview() { const el = $('#preview'); if (el) el.hidden = true; }

async function api(path, opts = {}) {
  // Book-specific endpoints are sent to the open book.
  if (path.startsWith('/api/') && !/^\/api\/(books|kdp)(\/|\?|$)/.test(path)) path = BP + path.slice(4);
  const res = await fetch(path, { headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}, ...opts, body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200);
}
async function loadLibrary() { LIB = await api('/api/books'); return LIB; }
async function load() {
  await loadLibrary();
  const usable = (id) => LIB.books.some((b) => b.id === id && !b.archived && !b.missing);
  if (!bookId || !usable(bookId)) bookId = LIB.defaultBookId && usable(LIB.defaultBookId) ? LIB.defaultBookId : null;
  BP = bookId ? `/api/books/${encodeURIComponent(bookId)}` : '/api';
  const prevJob = S?.exportJob?.status;
  S = bookId ? await api(`${BP}/state`) : null;
  if (prevJob === 'running' && S?.exportJob && S.exportJob.status !== 'running') toast(S.exportJob.status === 'done' ? (S.exportJob.file ? 'PDF ready' : 'Blocked: see the checks') : 'The build stopped');
  if (!S) tab = 'books';
  render(); schedulePoll();
}
async function openBook(id) {
  await api(`/api/books/${encodeURIComponent(id)}/open`, { method: 'POST' });
  bookId = id; filter = 'all'; lastReport = null;
  await load();
}
function isBusy() { return busy || S?.exportJob?.status === 'running' || S?.autoExport?.status === 'running'; }
function setState(next) { S = next.state || next; render(); schedulePoll(); }
function schedulePoll() {
  clearTimeout(pollTimer);
  if (!S) return;
  if (S.illustrations.some((i) => i.status === 'generating')) pollTimer = setTimeout(load, 2000);
  else if (S.storage.pending || S.autoExport?.status === 'running' || S.exportJob?.status === 'running') pollTimer = setTimeout(load, 2500);
}

// ---------- Rendering ----------
function render() {
  if (!S && tab !== 'books') tab = 'books';
  document.querySelectorAll('.tab').forEach((b) => { b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'); if (b.dataset.tab !== 'books') b.disabled = !S; });
  const tag = $('.kdp-tag');
  if (tag) tag.textContent = S ? `${S.specs.interior.trim.label.split(' (')[0]} · ${S.illustrations.length} pictures` : 'KDP coloring books';
  const cur = $('#currentBook');
  if (cur) cur.textContent = S ? S.book.title : '';
  renderBanner();
  const v = $('#view');
  v.innerHTML = { books: viewBooks, overview: viewOverview, pages: viewPages, book: viewBook, export: viewExport }[tab]();
}

// ---------- Books dashboard ----------
const COUNT_CHOICES = [20, 30, 50, 75, 100, 150];
function newBookCount() { return newBook.custom !== '' ? Math.floor(Number(newBook.custom)) : newBook.count; }
function viewBooks() {
  const books = (LIB?.books || []);
  const active = books.filter((b) => !b.archived), archived = books.filter((b) => b.archived);
  const trimOpts = Object.entries(LIB?.trims || {}).map(([k, t]) => `<option value="${k}" ${newBook.trim === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
  const paperOpts = Object.entries(LIB?.papers || {}).map(([k, l]) => `<option value="${k}" ${newBook.paper === k ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const n = newBookCount();
  const pv = preview && preview.illustrations === n ? preview : null;
  const form = newBook.open ? `<section class="card" id="newBookCard">
      <div class="section-head"><h2>New book</h2><button class="btn ghost" data-newbook="close">Cancel</button></div>
      <label class="field">Title<input type="text" id="nb-title" value="${esc(newBook.title)}" placeholder="Ocean Friends Coloring Book"></label>
      <label class="field">Theme<span class="hint">Used for the subtitle, description and keywords. You can change them later.</span><input type="text" id="nb-theme" value="${esc(newBook.theme)}" placeholder="Cute ocean animals"></label>
      <label class="field">Author / pen name<span class="hint">Needed for the final PDFs</span><input type="text" id="nb-author" value="${esc(newBook.author || '')}"></label>
      <div class="field"><span>Number of coloring illustrations</span>
        <div class="chips" role="group" aria-label="Illustration count">${COUNT_CHOICES.map((c) => `<button class="chip" data-count="${c}" aria-pressed="${newBook.custom === '' && newBook.count === c}">${c}</button>`).join('')}</div>
        <label class="field"><span class="hint">Or type a custom number</span><input type="number" id="nb-custom" min="1" max="1000" inputmode="numeric" value="${esc(newBook.custom)}" placeholder="e.g. 42"></label>
      </div>
      <div class="grid2">
        <label class="field">Trim size<select id="nb-trim">${trimOpts}</select></label>
        <label class="field">Paper<select id="nb-paper">${paperOpts}</select></label>
      </div>
      <label class="toggle"><input type="checkbox" id="nb-intro" ${newBook.intro ? 'checked' : ''}> Include “This Book Belongs To” page</label>
      <div class="card calc" aria-live="polite">${pv ? `
        <p><strong>${pv.illustrations} illustrations → ${pv.pageCount} printed pages</strong></p>
        <p class="small muted num">${pv.frontMatterPages} front-matter pages (title, copyright${newBook.intro ? ', “belongs to” + blank' : ''}) + ${pv.illustrations} illustration pages + ${pv.blankBacks} blank backs. KDP allows ${pv.minPages}–${pv.maxPages} pages here, so at most ${pv.maxIllustrations} illustrations.</p>
        <p class="small num">Spine ${pv.spine.toFixed(4)}" · full cover ${pv.coverWidth.toFixed(3)}" × ${pv.coverHeight.toFixed(3)}" · inside margin ${pv.insideMargin}"${pv.insideRaised ? ' (raised to KDP minimum)' : ''} · spine text ${pv.spineTextAllowed ? 'allowed' : 'not allowed (under 80 pages)'}</p>
        ${pv.issues.map((x) => `<p class="err small">${esc(x)}</p>`).join('')}` : '<p class="small muted">Calculating…</p>'}</div>
      <button class="btn primary block" id="createBook" ${pv && !pv.issues.length ? '' : 'disabled'}>Create book with ${Number.isFinite(n) ? n : '?'} illustrations</button>
    </section>` : '';
  const card = (b) => {
    const c = b.counts || {}, total = b.illustrationCount || 0, ok = c.approved || 0;
    const isOpen = b.id === bookId;
    const title = renaming === b.id
      ? `<div class="kw"><input type="text" id="rename-${esc(b.id)}" value="${esc(b.title)}" aria-label="New title"><button class="btn primary" data-saverename="${esc(b.id)}">Save</button></div>`
      : `<h3>${esc(b.title)}</h3>`;
    return `<article class="card bookcard">
      <div class="section-head">${title}${isOpen ? '<span class="pill st-approved">Open</span>' : ''}${b.archived ? '<span class="pill st-empty">Archived</span>' : ''}</div>
      <p class="small muted">${esc(b.theme || '')}</p>
      <div class="progress" aria-label="Approved"><span style="width:${total ? (ok / total) * 100 : 0}%;background:var(--ok)"></span></div>
      <p class="small num">${ok} of ${total} illustrations approved · ${c.review || 0} in review · ${b.exports || 0} PDF file(s)</p>
      <div class="btn-row">
        ${b.archived ? `<button class="btn" data-restore="${esc(b.id)}">Restore</button>` : `<button class="btn primary" data-open="${esc(b.id)}">${isOpen ? 'Continue' : 'Open'}</button>
        <button class="btn ghost" data-rename="${esc(b.id)}">Rename</button>
        <button class="btn ghost" data-dup="${esc(b.id)}">Duplicate</button>
        <button class="btn bad" data-archive="${esc(b.id)}">${confirmArchive === b.id ? 'Tap again to archive' : 'Archive'}</button>`}
      </div>
    </article>`;
  };
  return `
  <div class="section-head"><h1>Your books</h1>${newBook.open ? '' : '<button class="btn primary" data-newbook="open">New book</button>'}</div>
  ${LIB?.migratedFrom ? `<p class="small muted">Your original book was moved into this library on ${new Date(LIB.migratedFrom.at).toLocaleDateString()}. Its original files are kept as a backup.</p>` : ''}
  ${form}
  ${active.length ? active.map(card).join('') : '<p class="muted">No books yet. Tap “New book” to start one.</p>'}
  ${archived.length ? `<button class="btn ghost block" data-toggle-archived="1">${showArchived ? 'Hide' : 'Show'} archived books (${archived.length})</button>${showArchived ? archived.map(card).join('') : ''}` : ''}
  <p class="small muted">Archiving hides a book; nothing is deleted. Duplicating copies its settings, prompts and artwork (not its PDFs).</p>`;
}
function refreshPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const n = newBookCount();
    if (!Number.isFinite(n) || n < 1) { preview = { illustrations: n, pageCount: 0, issues: ['Enter a number of illustrations (1 or more).'], frontMatterPages: 0, blankBacks: 0, minPages: 0, maxPages: 0, maxIllustrations: 0, spine: 0, coverWidth: 0, coverHeight: 0, insideMargin: 0 }; render(); return; }
    preview = await api(`/api/kdp/preview?count=${n}&trim=${encodeURIComponent(newBook.trim)}&paper=${encodeURIComponent(newBook.paper)}&intro=${newBook.intro ? 1 : 0}`).catch(() => null);
    if (tab === 'books') { const f = document.activeElement?.id; render(); if (f && $('#' + f)) { const el = $('#' + f); el.focus(); if (el.setSelectionRange && el.type === 'text') el.setSelectionRange(el.value.length, el.value.length); } }
  }, 250);
}

function renderBanner() {
  const c = S.config, out = [];
  if (tab !== 'overview') { $('#banner').innerHTML = ''; return; }
  if (!c.image.configured) out.push(`<div class="banner warn"><strong>Image generation is not set up yet</strong><span>Add <code>IMAGE_PROVIDER</code> and its API key in Render's Environment settings (see README). You can upload your own line art on the Pages tab right now.</span></div>`);
  if (!c.passwordSet) out.push(`<div class="banner warn"><strong>No app password</strong><span>Set <code>APP_PASSWORD</code> on the server. In production the app will not start without it.</span></div>`);
  const other = c.problems.filter((p) => !/APP_PASSWORD/.test(p) && !(c.image.provider === 'none'));
  if (other.length) out.push(`<div class="banner bad"><strong>Server settings need attention</strong>${other.map((p) => `<span>${esc(p)}</span>`).join('')}</div>`);
  $('#banner').innerHTML = out.join('');
}

function storageCard() {
  const st = S.storage, c = S.config;
  const remote = st.remote;
  const where = remote ? (st.backend === 's3' ? 'Cloud bucket (S3 / Cloudflare R2)' : 'Mirror folder (test mode)') : 'Server disk (DATA_DIR)';
  const synced = remote ? (st.pending ? `${st.pending} change(s) uploading…` : st.lastSyncAt ? `All changes saved · ${new Date(st.lastSyncAt).toLocaleTimeString()}` : 'Up to date') : 'Saved on the server disk';
  const pill = st.lastError ? '<span class="pill st-fail">Sync problem</span>' : st.pending ? '<span class="pill st-generating">Saving</span>' : '<span class="pill st-pass">Saved</span>';
  const risk = !remote && c.production ? `<p class="small err">Make sure this service has a persistent disk mounted at DATA_DIR. Without one, Render wipes uploads, approvals and PDFs on every restart or redeploy. The free plan has no disk, so use the bucket option in the README.</p>` : '';
  return `<section class="card">
    <div class="section-head"><h2>Storage</h2>${pill}</div>
    <table class="spec-table">
      <tr><td>Where your work is kept</td><td>${where}</td></tr>
      <tr><td>Status</td><td>${esc(synced)}</td></tr>
      <tr><td>Image generations today</td><td>${S.usage.today} of ${S.usage.maxPerDay}</td></tr>
    </table>
    ${st.lastError ? `<p class="small err">${esc(st.lastError)}. The app keeps retrying every minute.</p>` : ''}
    ${risk}
  </section>`;
}

function counts() {
  const c = { empty: 0, generating: 0, review: 0, approved: 0, rejected: 0, failed: 0 };
  for (const i of S.illustrations) c[i.status]++;
  return c;
}

function autoExportLine() {
  const a = S.autoExport;
  if (!a) return '';
  if (a.status === 'running') return `<p class="small"><strong>All ${S.illustrations.length} approved.</strong> Building the print-ready interior and cover now (a few minutes on a small server)…</p>`;
  if (a.status === 'failed') return `<p class="small err">Automatic assembly stopped: ${esc(a.error)}</p>`;
  const probs = [...(a.interior?.problems || []), ...(a.cover?.problems || [])];
  return `<p class="small">Final files ${a.interior?.ok && a.cover?.ok ? 'built' : 'checked'} ${new Date(a.at).toLocaleString()}: interior ${a.interior?.ok ? 'passed' : 'blocked'}, cover ${a.cover?.ok ? 'passed' : 'blocked'}. See Export.</p>${probs.length ? `<div class="banner warn"><strong>Fix these, then build from the Export tab</strong>${[...new Set(probs)].map((p) => `<span>${esc(p)}</span>`).join('')}</div>` : ''}`;
}

function viewOverview() {
  const c = counts(), n = S.illustrations.length, I = S.specs.interior, C = S.specs.cover;
  const seg = (k, color) => `<span style="width:${(c[k] / n) * 100}%;background:var(${color})"></span>`;
  const pages = I.plan.map((p) => {
    const il = p.illustration ? S.illustrations[p.illustration - 1] : null;
    const label = p.role === 'illustration' ? p.illustration : { title: 'T', copyright: '©', intro: 'i', blank: '' }[p.role];
    return `<div class="pg ${p.role === 'illustration' ? 'ill' : ''} ${il?.status === 'approved' ? 'approved' : ''}" title="Page ${p.n} (${p.side}) · ${p.role}">${label}</div>`;
  }).join('');
  return `
  <section class="card">
    <div class="section-head"><div><p class="eyebrow">Your book</p><h1>${esc(S.book.title)}</h1></div></div>
    <p class="muted">${esc(S.book.subtitle)}</p>
    <div class="progress" aria-label="Approval progress">${seg('approved', '--ok')}${seg('review', '--warn')}${seg('generating', '--info')}${seg('rejected', '--bad')}${seg('failed', '--bad')}</div>
    <div class="stats">
      <div class="stat"><b>${c.approved}/${n}</b><span>illustrations approved</span></div>
      <div class="stat"><b>${c.review}</b><span>waiting for review</span></div>
      <div class="stat"><b>${I.pageCount}</b><span>printed pages</span></div>
      <div class="stat"><b>${C.spine.toFixed(3)}"</b><span>spine width</span></div>
    </div>
    <p class="small muted num">${n} illustrations = ${I.pageCount} printed pages: ${I.frontMatterPages} front-matter pages + ${n} illustration pages + ${n} blank backs.</p>
    <button class="btn primary block" data-go="pages">${c.approved === n ? 'Review pages' : `Review pages (${n - c.approved} to go)`}</button>
    ${autoExportLine()}
  </section>
  ${storageCard()}
  <section class="card">
    <div class="section-head"><h2>Interior layout</h2><span class="pill ${I.issues.length ? 'st-fail' : 'st-pass'}">${I.issues.length ? 'Needs fixing' : 'Meets KDP rules'}</span></div>
    <p class="small muted">Each picture sits on a right-hand page with a blank page behind it. Scroll the strip to see all ${I.pageCount} pages.</p>
    <div class="strip" aria-label="Page order">${pages}</div>
    <table class="spec-table">
      <tr><td>Trim size</td><td>${esc(I.trim.label)} (no bleed)</td></tr>
      <tr><td>Interior</td><td>Black &amp; white, ${esc(I.paper)} paper</td></tr>
      <tr><td>Illustrations</td><td>${n}</td></tr>
      <tr><td>Printed pages</td><td>${I.pageCount} (KDP range ${I.minPages}–${I.maxPages})</td></tr>
      <tr><td>Inside margin (gutter)</td><td>${inch(I.margins.inside)} <span class="muted small">min ${inch(I.minGutter)}</span></td></tr>
      <tr><td>Outside / top / bottom</td><td>${inch(I.margins.outside)} / ${inch(I.margins.top)} / ${inch(I.margins.bottom)} <span class="muted small">min 0.250"</span></td></tr>
      <tr><td>Artwork area</td><td>${inch(I.artBox.w)} × ${inch(I.artBox.h)}</td></tr>
      <tr><td>Image size needed at 300 DPI</td><td>${I.requiredPx.w} × ${I.requiredPx.h} px</td></tr>
    </table>
    ${I.issues.map((x) => `<p class="err">${esc(x)}</p>`).join('')}
  </section>

  <section class="card">
    <div class="section-head"><h2>Full-wrap cover</h2><span class="pill st-pass">Calculated</span></div>
    <div class="diagram">${coverSvg(C)}</div>
    <table class="spec-table">
      <tr><td>Spine (${C.pageCount} pp × ${C.perPage}" ${esc(C.paper)} paper)</td><td>${C.spine.toFixed(4)}"</td></tr>
      <tr><td>Full cover with bleed</td><td>${C.width.toFixed(4)}" × ${C.height.toFixed(3)}"</td></tr>
      <tr><td>Bleed</td><td>0.125" each side</td></tr>
      <tr><td>Text safe zone</td><td>0.25" inside trim <span class="muted small">KDP min 0.125"</span></td></tr>
      <tr><td>Barcode area</td><td>2" × 1.2", back lower right</td></tr>
      <tr><td>Spine text</td><td>${C.spineTextAllowed ? 'Allowed' : `Off (needs ${C.spineTextMinPages}+ pages)`}</td></tr>
    </table>
    <p class="small muted">Double-check these numbers in the <a href="${C.calculatorUrl}" target="_blank" rel="noopener">official KDP cover calculator</a> (${C.trim.w} × ${C.trim.h}, paperback, black ink, ${esc(C.paper)} paper, ${C.pageCount} pages) before uploading.</p>
  </section>`;
}

function coverSvg(C) {
  const k = 40, W = C.width * k, H = C.height * k, b = C.bleed * k;
  const z = C.zones, X = (v) => (v * k).toFixed(1);
  const Y = (y, h) => (H - (y + h) * k).toFixed(1);
  const bc = C.barcode;
  return `<svg viewBox="-4 -4 ${W + 8} ${H + 8}" role="img" aria-label="Cover layout drawn to scale">
    <rect x="0" y="0" width="${W}" height="${H}" fill="var(--accent-soft)" stroke="var(--line)"/>
    <rect x="${b}" y="${b}" width="${W - 2 * b}" height="${H - 2 * b}" fill="none" stroke="var(--bad)" stroke-width="1.2"/>
    ${['back', 'front'].map((n) => `<rect x="${X(z[n].x + C.safe)}" y="${Y(z[n].y + C.safe, z[n].h - 2 * C.safe)}" width="${X(z[n].w - 2 * C.safe)}" height="${X(z[n].h - 2 * C.safe)}" fill="none" stroke="var(--info)" stroke-dasharray="5 4"/>
      <text x="${X(z[n].x + z[n].w / 2)}" y="${H / 2}" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="20" fill="var(--accent)">${n === 'back' ? 'BACK' : 'FRONT'}</text>`).join('')}
    <rect x="${X(z.spine.x)}" y="0" width="${Math.max(1, z.spine.w * k).toFixed(1)}" height="${H}" fill="var(--accent)" opacity=".55"/>
    <rect x="${X(bc.x)}" y="${Y(bc.y, bc.h)}" width="${X(bc.w)}" height="${X(bc.h)}" fill="var(--surface)" stroke="var(--warn)"/>
    <text x="${X(bc.x + bc.w / 2)}" y="${(H - (bc.y + bc.h / 2) * k + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--warn)" font-family="Nunito, sans-serif">barcode</text>
    <text x="${X(z.spine.x + z.spine.w / 2)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--ink)" font-family="Nunito, sans-serif">spine ${C.spine.toFixed(3)}"</text>
  </svg>
  <p class="small muted">Red: trim line. Outside it: 0.125" bleed. Blue dashed: text safe zone. Drawn to scale.</p>`;
}

function viewPages() {
  const c = counts();
  const filters = [['all', `All ${S.illustrations.length}`], ['todo', `Needs art ${c.empty + c.rejected + c.failed}`], ['review', `Review ${c.review}`], ['approved', `Approved ${c.approved}`], ['rejected', `Rejected ${c.rejected}`]];
  const list = S.illustrations.filter((il) => filter === 'all' || (filter === 'todo' ? ['empty', 'rejected', 'failed'].includes(il.status) : il.status === filter));
  const gen = S.config.image.configured;
  return `
  <div class="section-head"><h1>Coloring pages</h1><span class="muted small">${c.approved} of ${S.illustrations.length} approved</span></div>
  <div class="chips" role="group" aria-label="Filter">${filters.map(([k, l]) => `<button class="chip" data-filter="${k}" aria-pressed="${filter === k}">${l}</button>`).join('')}</div>
  ${gen ? draftsPanel(c) : `<p class="small muted">Generation is off until the server has an image provider. Upload works now.</p>`}
  <p class="small muted">Rejected images are moved out of the book folder and can never be placed in a PDF. Uploads and generated images are converted to pure black-and-white line art at 2250 × 3000 px.</p>
  <div class="gallery">${list.map((il) => card(il, gen)).join('') || '<p class="muted">Nothing here.</p>'}</div>`;
}

function draftsPanel(c) {
  const todo = S.illustrations.filter((il) => ['empty', 'rejected', 'failed'].includes(il.status));
  const drawable = todo.filter((il) => il.canGenerate).length;
  const b = S.batch;
  const img = S.config.image;
  const engineLine = img.free
    ? `${esc(img.label)} · ${esc(img.model)} · free, no API key`
    : `${esc(img.label)} · ${esc(img.model)} · ${S.usage.today} of ${S.usage.maxPerDay} generations used today`;
  const progress = b ? `<div class="card" style="gap:8px">
      <div class="section-head"><strong>${b.running ? 'Drawing drafts…' : 'Drafts finished'}</strong><span class="small num">${b.done} of ${b.total}${b.failed ? ` · ${b.failed} failed` : ''}</span></div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${b.total}" aria-valuenow="${b.done}"><span style="width:${(b.done / b.total) * 100}%;background:var(--ok)"></span></div>
      ${b.running ? '' : '<span class="small muted">Every draft now waits in Review. Nothing goes into the book until you approve it.</span>'}
    </div>` : '';
  return `<div class="btn-row"><button class="btn primary" data-genmissing="1" ${drawable && !(b && b.running) ? '' : 'disabled'}>Generate all drafts (${drawable})</button></div>
    ${progress}
    <p class="small muted num">${engineLine}${img.free && todo.length > drawable ? ` · ${todo.length - drawable} page(s) still need a drawing design` : ''}</p>`;
}

// Uploads print best as portrait 3:4 images of at least 2250 x 3000 px (7.5" x 10" at 300 DPI).
function uploadWarning(px) {
  const notes = [];
  if (px.w < 2250 || px.h < 3000) notes.push(`low resolution: enlarged ${Math.max(2250 / px.w, 3000 / px.h).toFixed(1)}×, so lines may look soft in print`);
  const ratio = px.w / px.h;
  if (Math.abs(ratio - 0.75) > 0.05) notes.push(`not portrait 3:4, so white bands are added ${ratio > 0.75 ? 'above and below' : 'at the sides'}`);
  return notes.length ? `<span class="small" style="color:var(--warn)">Check before approving: ${notes.join('; ')}.</span>` : '';
}

function card(il, gen) {
  const art = il.status === 'generating'
    ? `<div class="ph"><div class="spinner"></div>Generating…</div>`
    : il.hasImage
      ? `<img src="${BP}/illustrations/${il.id}/image?v=${encodeURIComponent(il.image.file)}" alt="Illustration ${il.id}: ${esc(il.title)}" loading="lazy">`
      : `<div class="ph"><b>${il.id}</b>No image yet<br>${il.history.length ? `${il.history.length} earlier image(s) rejected` : ''}</div>`;
  const upload = `<label class="btn ghost" for="up-${il.id}">Upload<input id="up-${il.id}" type="file" accept="image/*" data-upload="${il.id}" hidden></label>`;
  let actions = '';
  const preview = il.hasImage ? `<button class="btn ghost" data-preview="${il.id}">Preview</button>` : '';
  const canGen = gen && il.canGenerate;
  const confirmKey = (act) => `${act}:${il.id}`;
  const confirmLabel = (act, label) => (confirmAct === confirmKey(act) ? 'Tap again to confirm' : label);
  if (il.status === 'review') actions = `<button class="btn ok" data-act="approve" data-id="${il.id}">Approve</button><button class="btn bad" data-act="reject" data-id="${il.id}">Reject</button><button class="btn" data-act="regenerate" data-id="${il.id}" ${canGen ? '' : 'disabled'}>Regenerate</button>${preview}`;
  else if (il.status === 'approved') actions = `${preview}<button class="btn bad" data-act="reject" data-id="${il.id}" data-confirm="1">${confirmLabel('reject', 'Unapprove')}</button><button class="btn" data-act="regenerate" data-id="${il.id}" data-confirm="1" ${canGen ? '' : 'disabled'}>${confirmLabel('regenerate', 'Replace')}</button>`;
  else if (il.status !== 'generating') actions = `<button class="btn primary" data-gen="${il.id}" ${canGen ? '' : 'disabled'}>Generate</button>${upload}`;
  const src = il.image?.drawing
    ? `<span class="small muted num">Drawing: ${esc(il.image.drawing)} · seed ${il.image.seed} · ${il.image.quality ? `${il.image.quality.regions} coloring areas` : ''}</span>`
    : il.image?.sourcePx ? `<span class="small muted num">Source ${il.image.sourcePx.w} × ${il.image.sourcePx.h} px · ${esc(il.image.origin)}</span>${uploadWarning(il.image.sourcePx)}` : '';
  const noDesign = gen && !il.canGenerate && !il.hasImage && S.config.image.free ? '<span class="small muted">No drawing designed for this page yet. Upload works.</span>' : '';
  return `<article class="il" id="il-${il.id}">
    <div class="il-art">${art}</div>
    <div class="il-body">
      <div class="il-head"><h3>${il.id}. ${esc(il.title)}</h3><span class="pill st-${il.status}">${STATUS[il.status]}</span></div>
      ${il.regenerateRequested && il.status !== 'generating' ? '<span class="small muted">Regeneration requested</span>' : ''}
      ${src}${noDesign}
      ${il.error ? `<p class="err">${esc(il.error)}</p>` : ''}
      <div class="btn-row">${actions}</div>
      <details><summary>Prompt</summary>
        <label class="field"><span class="hint">Edit the prompt, then generate or regenerate.</span><textarea id="prompt-${il.id}" ${il.status === 'approved' ? 'readonly' : ''}>${esc(il.prompt)}</textarea></label>
        ${il.status === 'approved' ? '' : `<button class="btn ghost" data-saveprompt="${il.id}">Save prompt</button>`}
      </details>
    </div>
  </article>`;
}

function viewBook() {
  const b = S.book, I = S.specs.interior;
  const kws = Array.from({ length: 7 }, (_, i) => b.keywords[i] || '');
  return `
  <form id="bookForm" class="card" novalidate>
    <div class="section-head"><h1>Book details</h1></div>
    <label class="field">Title<input type="text" id="f-title" value="${esc(b.title)}"></label>
    <label class="field">Subtitle<input type="text" id="f-subtitle" value="${esc(b.subtitle)}"></label>
    <div class="grid2">
      <label class="field">Author name<span class="hint">Needed for the final files</span><input type="text" id="f-author" value="${esc(b.author)}" placeholder="Your pen name"></label>
      <label class="field">Year<span class="hint">For the copyright page</span><input type="number" id="f-year" value="${esc(b.year)}"></label>
    </div>
    <label class="field">ISBN<span class="hint">Optional. Leave empty if KDP assigns one later.</span><input type="text" id="f-isbn" value="${esc(b.isbn || '')}"></label>
    <label class="field">Back-cover description<textarea id="f-description" rows="9">${esc(b.description)}</textarea></label>
    <label class="field">Copyright notice<textarea id="f-publisherNote" rows="3">${esc(b.publisherNote)}</textarea></label>
  </form>

  <section class="card">
    <div class="section-head"><h2>KDP keywords</h2><span class="small muted">7 boxes, 50 characters each</span></div>
    ${kws.map((k, i) => `<div class="kw"><input type="text" id="f-kw-${i}" value="${esc(k)}" maxlength="50" aria-label="Keyword ${i + 1}"><small id="kwc-${i}" class="${k.length > 50 ? 'over' : ''}">${k.length}/50</small></div>`).join('')}
    <button class="btn ghost" id="copyKw" type="button">Copy all keywords</button>
  </section>

  <section class="card">
    <div class="section-head"><h2>Layout</h2><span class="small muted">${I.pageCount} pages</span></div>
    <div class="grid2">
      <label class="field">Illustrations<span class="hint">Removing only drops empty pages at the end</span><input type="number" min="1" max="1000" id="f-count" value="${S.illustrations.length}"></label>
      <label class="field">Trim size<select id="f-trim">${Object.entries(LIB?.trims || {}).map(([k, t]) => `<option value="${k}" ${(b.trim || '8.5x11') === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
      <label class="field">Paper<select id="f-paper">${Object.entries(LIB?.papers || {}).map(([k, l]) => `<option value="${k}" ${(b.paper || 'white') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label class="field">Theme<input type="text" id="f-theme" value="${esc(b.theme || '')}"></label>
    </div>
    <p class="small muted num">${S.illustrations.length} illustrations → ${I.pageCount} printed pages (${I.frontMatterPages} front matter + ${S.illustrations.length} pictures + ${S.illustrations.length} blank backs). Inside margin ${I.margins.inside}"${I.insideRaised ? ', raised automatically to the KDP minimum for this page count' : ''}.</p>
    <label class="toggle"><input type="checkbox" id="f-intro" ${b.includeIntro ? 'checked' : ''}> Include “This Book Belongs To” page (+2 pages)</label>
    <div class="grid2">
      <label class="field">Inside margin (in)<span class="hint">KDP min ${I.minGutter}" at ${I.pageCount} pp</span><input type="number" step="0.025" min="0" id="f-m-inside" value="${b.margins.inside}"></label>
      <label class="field">Outside margin (in)<span class="hint">KDP min 0.25"</span><input type="number" step="0.025" min="0" id="f-m-outside" value="${b.margins.outside}"></label>
      <label class="field">Top margin (in)<span class="hint">KDP min 0.25"</span><input type="number" step="0.025" min="0" id="f-m-top" value="${b.margins.top}"></label>
      <label class="field">Bottom margin (in)<span class="hint">KDP min 0.25"</span><input type="number" step="0.025" min="0" id="f-m-bottom" value="${b.margins.bottom}"></label>
    </div>
    ${I.issues.map((x) => `<p class="err">${esc(x)}</p>`).join('')}
  </section>

  <section class="card">
    <div class="section-head"><h2>Cover</h2></div>
    <div class="grid2">
      <label class="field">Background<input type="color" id="f-bg" value="${esc(b.cover.background)}"></label>
      <label class="field">Text color<input type="color" id="f-accent" value="${esc(b.cover.accent)}"></label>
    </div>
    <div class="grid2">
      ${S.coverArt ? `<img src="${BP}/cover-art?v=${encodeURIComponent(S.coverArt.file)}" alt="Uploaded cover art" style="border-radius:10px;border:1px solid var(--line)">` : '<p class="small muted">No cover art uploaded. The print cover uses your first approved illustration on a white panel.</p>'}
      <div style="display:grid;gap:8px;align-content:start">
        <label class="btn ghost" for="coverUp">${S.coverArt ? 'Replace cover art' : 'Upload cover art'}<input id="coverUp" type="file" accept="image/*" hidden></label>
        ${S.coverArt ? `<button class="btn bad" id="coverDel" type="button">Remove</button><span class="small muted num">${S.coverArt.px.w} × ${S.coverArt.px.h} px</span>` : '<span class="small muted">Color art for the front. Best at 2550 × 3300 px or more.</span>'}
      </div>
    </div>
  </section>
  <button class="btn primary block" id="saveBook" type="button">Save book details</button>`;
}

function reportHtml(rep) {
  if (!rep) return '';
  return `<ul class="checks">${rep.checks.map((c) => `<li><span class="pill st-${c.status}">${c.status}</span><div>${esc(c.label)}${c.detail ? `<div class="d">${esc(c.detail)}</div>` : ''}</div></li>`).join('')}</ul>`;
}

function viewExport() {
  const blockers = S.finalBlockers;
  const files = S.exports;
  return `
  <div class="section-head"><h1>Export</h1><span class="small muted">Nothing is uploaded to Amazon</span></div>
  <section class="card">
    <h2>Proofs and templates</h2>
    <p class="small muted">For checking layout. Placeholders fill pages that are not approved yet. Not for upload.</p>
    <div class="btn-row">
      <button class="btn" data-export="interior" data-mode="proof" data-guides="1" ${isBusy() ? 'disabled' : ''}>Interior proof with guides</button>
      <button class="btn" data-export="interior" data-mode="proof" ${isBusy() ? 'disabled' : ''}>Clean interior proof</button>
      <button class="btn" data-export="cover" data-mode="template" ${isBusy() ? 'disabled' : ''}>Cover template with guides</button>
    </div>
  </section>
  <section class="card">
    <h2>Print-ready files</h2>
    ${blockers.length ? `<div class="banner warn"><strong>Not ready yet</strong>${blockers.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '<p class="small">All 30 illustrations are approved. Files are only saved if every check passes.</p>'}
    <div class="btn-row">
      <button class="btn primary" data-export="interior" data-mode="final" ${blockers.length || isBusy() ? 'disabled' : ''}>Build print-ready interior</button>
      <button class="btn primary" data-export="cover" data-mode="print" ${isBusy() ? 'disabled' : ''}>Build print-ready cover</button>
    </div>
  </section>
  ${isBusy() ? `<section class="card"><div class="section-head"><h2>Building and validating…</h2><div class="spinner"></div></div><p class="small muted">Large books take several minutes on the free server (about 5 minutes for 100 illustrations). You can leave this page; the file appears below when it is ready.</p></section>` : ''}
  ${S.exportJob && S.exportJob.status !== 'running' ? `<section class="card"><div class="section-head"><h2>Last build: ${esc(S.exportJob.kind)} (${esc(S.exportJob.mode)})</h2><span class="pill st-${S.exportJob.ok ? 'pass' : 'fail'}">${S.exportJob.status === 'failed' ? 'Stopped' : S.exportJob.ok ? 'Passed' : 'Blocked'}</span></div>
    <p class="small">${S.exportJob.file ? `Saved <b>${esc(S.exportJob.file)}</b>.` : S.exportJob.error ? esc(S.exportJob.error) : 'No file was saved.'}</p>${reportHtml(S.exportJob.report)}</section>` : ''}
  ${lastReport ? `<section class="card"><div class="section-head"><h2>Last check: ${esc(lastReport.title)}</h2><span class="pill st-${lastReport.ok ? 'pass' : 'fail'}">${lastReport.ok ? 'Passed' : 'Blocked'}</span></div>
    <p class="small">${lastReport.file ? `Saved <b>${esc(lastReport.file)}</b>.` : 'No file was saved.'}</p>${reportHtml(lastReport.report)}</section>` : ''}
  <section class="card">
    <div class="section-head"><h2>Files on the server</h2><span class="small muted">${files.length} file(s)</span></div>
    ${files.length ? files.map((f) => `<div class="file">
      <div class="section-head"><span class="file-name">${esc(f.name)}</span><span class="pill st-${f.report?.ok ? 'pass' : 'warn'}">${f.report?.ok ? 'Checks passed' : 'Has warnings'}</span></div>
      <span class="small muted num">${kb(f.bytes)} · ${new Date(f.created).toLocaleString()}${f.report?.pageCount ? ` · ${f.report.pageCount} pages` : ''}${f.report?.widthIn ? ` · ${f.report.widthIn.toFixed(3)}" × ${f.report.heightIn.toFixed(3)}"` : ''}</span>
      <div class="btn-row">
        <a class="btn primary" href="${BP}/files/${encodeURIComponent(f.name)}">Download</a>
        <a class="btn ghost" href="${BP}/files/${encodeURIComponent(f.name)}?view=1" target="_blank" rel="noopener">Open</a>
        <button class="btn bad" data-del="${esc(f.name)}">${confirmDelete === f.name ? 'Tap again to delete' : 'Delete'}</button>
      </div></div>`).join('') : '<p class="muted small">No files yet. Build a proof above to create your first PDF.</p>'}
    <p class="small muted">On iPhone: tap Download, then open the Downloads arrow in Safari and save to Files.</p>
  </section>`;
}

// ---------- Events ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, [data-go]');
  if (!t) return;
  try {
    if (t.dataset.tab || t.dataset.go) {
      tab = t.dataset.tab || t.dataset.go; history.replaceState(null, '', '#' + tab);
      if (tab === 'books') await loadLibrary();
      render(); scrollTo(0, 0); return;
    }
    if (t.dataset.newbook) { newBook.open = t.dataset.newbook === 'open'; if (newBook.open) refreshPreview(); render(); return; }
    if (t.dataset.count) { newBook.count = Number(t.dataset.count); newBook.custom = ''; render(); refreshPreview(); return; }
    if (t.id === 'createBook') {
      t.disabled = true;
      const out = await api('/api/books', { method: 'POST', body: { title: newBook.title, theme: newBook.theme, author: newBook.author || '', illustrationCount: newBookCount(), trim: newBook.trim, paper: newBook.paper, includeIntro: newBook.intro } });
      newBook = { open: false, title: '', theme: '', count: 30, custom: '', trim: '8.5x11', paper: 'white', intro: true };
      bookId = out.bookId; tab = 'overview'; await load(); scrollTo(0, 0); toast('Book created'); return;
    }
    if (t.dataset.open) { await openBook(t.dataset.open); tab = 'overview'; render(); scrollTo(0, 0); return; }
    if (t.dataset.rename) { renaming = t.dataset.rename; render(); $('#rename-' + CSS.escape(renaming))?.focus(); return; }
    if (t.dataset.saverename) {
      const id = t.dataset.saverename;
      LIB = await api(`/api/books/${encodeURIComponent(id)}/title`, { method: 'PUT', body: { title: $('#rename-' + CSS.escape(id)).value } });
      renaming = null; if (id === bookId) S = await api(`${BP}/state`); render(); toast('Renamed'); return;
    }
    if (t.dataset.dup) { t.disabled = true; toast('Copying book…'); const out = await api(`/api/books/${encodeURIComponent(t.dataset.dup)}/duplicate`, { method: 'POST', body: {} }); LIB = out.library; render(); toast('Book duplicated'); return; }
    if (t.dataset.archive) {
      const id = t.dataset.archive;
      if (confirmArchive !== id) { confirmArchive = id; render(); return; }
      confirmArchive = null;
      LIB = await api(`/api/books/${encodeURIComponent(id)}/archive`, { method: 'POST', body: { archived: true } });
      if (id === bookId) { bookId = null; await load(); } else render();
      toast('Archived. Nothing was deleted.'); return;
    }
    if (t.dataset.restore) { LIB = await api(`/api/books/${encodeURIComponent(t.dataset.restore)}/archive`, { method: 'POST', body: { archived: false } }); render(); toast('Restored'); return; }
    if (t.dataset.toggleArchived) { showArchived = !showArchived; render(); return; }
    if (t.dataset.filter) { filter = t.dataset.filter; render(); return; }
    if (t.dataset.preview) { openPreview(Number(t.dataset.preview)); return; }
    if (t.dataset.closepreview) { closePreview(); return; }
    if (t.dataset.act) {
      // Approved pages need a second tap before anything replaces or removes them.
      const key = `${t.dataset.act}:${t.dataset.id}`;
      if (t.dataset.confirm && confirmAct !== key) { confirmAct = key; render(); return; }
      confirmAct = null;
      t.disabled = true;
      closePreview();
      const res = await api(`/api/illustrations/${t.dataset.id}/${t.dataset.act}`, { method: 'POST', body: t.dataset.confirm ? { confirm: true } : {} });
      setState(res);
      if (res.note) { toast(`Rejected. ${res.note}`); return; }
      toast({ approve: 'Approved', reject: 'Rejected and removed from the book', regenerate: S.config.image.configured ? 'Regenerating' : 'Rejected. Upload or generate a new image.' }[t.dataset.act]);
      if (t.dataset.act === 'approve' && S.autoExport && S.illustrations.every((i) => i.status === 'approved')) toast('All approved. Final files assembled; see Export.');
      return;
    }
    if (t.dataset.genmissing) {
      t.disabled = true;
      const out = await api('/api/generate-missing', { method: 'POST' });
      setState(out); toast(out.note ? `Drawing ${out.queued} draft(s). ${out.note}` : `Drawing ${out.queued} draft(s)`); return;
    }
    if (t.dataset.gen) { t.disabled = true; setState(await api(`/api/illustrations/${t.dataset.gen}/generate`, { method: 'POST' })); toast('Generation started'); return; }
    if (t.dataset.saveprompt) { setState(await api(`/api/illustrations/${t.dataset.saveprompt}/prompt`, { method: 'PUT', body: { prompt: $('#prompt-' + t.dataset.saveprompt).value } })); toast('Prompt saved'); return; }
    if (t.dataset.export) {
      const kind = t.dataset.export, mode = t.dataset.mode;
      busy = true; render();
      const out = await api(`/api/export/${kind}`, { method: 'POST', body: { mode, guides: !!t.dataset.guides, background: true } }).finally(() => (busy = false));
      lastReport = null; setState(out); toast('Building the PDF. You can keep using the app.'); return;
    }
    if (t.dataset.del) {
      if (confirmDelete !== t.dataset.del) { confirmDelete = t.dataset.del; render(); return; }
      confirmDelete = null; setState(await api(`/api/files/${encodeURIComponent(t.dataset.del)}`, { method: 'DELETE' })); toast('Deleted'); return;
    }
    if (t.id === 'saveBook') { setState(await api('/api/book', { method: 'PUT', body: readBookForm() })); toast('Saved'); return; }
    if (t.id === 'copyKw') {
      const text = Array.from({ length: 7 }, (_, i) => $('#f-kw-' + i).value).filter(Boolean).join('\n');
      try { await navigator.clipboard.writeText(text); toast('Keywords copied'); } catch { toast('Copy failed. Select the text manually.'); }
      return;
    }
    if (t.id === 'coverDel') { setState(await api('/api/cover-art', { method: 'DELETE' })); toast('Cover art removed'); return; }
  } catch (err) { busy = false; toast(err.message); render(); }
});

document.addEventListener('input', (e) => {
  const id = e.target.id;
  if (id === 'nb-title') { newBook.title = e.target.value; return; }
  if (id === 'nb-theme') { newBook.theme = e.target.value; return; }
  if (id === 'nb-author') { newBook.author = e.target.value; return; }
  if (id === 'nb-custom') { newBook.custom = e.target.value.trim(); refreshPreview(); return; }
  const m = e.target.id.match(/^f-kw-(\d)$/);
  if (m) { const c = $('#kwc-' + m[1]); c.textContent = `${e.target.value.length}/50`; c.classList.toggle('over', e.target.value.length > 50); }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.id === 'nb-trim') { newBook.trim = el.value; refreshPreview(); return; }
  if (el.id === 'nb-paper') { newBook.paper = el.value; refreshPreview(); return; }
  if (el.id === 'nb-intro') { newBook.intro = el.checked; refreshPreview(); return; }
  try {
    if (el.dataset.upload && el.files[0]) {
      const fd = new FormData(); fd.append('image', el.files[0]);
      toast('Uploading and converting to line art…');
      setState(await api(`/api/illustrations/${el.dataset.upload}/upload`, { method: 'POST', body: fd }));
      toast('Uploaded. Review it, then approve or reject.');
    } else if (el.id === 'coverUp' && el.files[0]) {
      const fd = new FormData(); fd.append('image', el.files[0]);
      toast('Uploading cover art…');
      setState(await api('/api/cover-art', { method: 'POST', body: fd }));
      toast('Cover art saved');
    }
  } catch (err) { toast(err.message); }
});

function readBookForm() {
  const v = (id) => $('#' + id).value;
  return {
    title: v('f-title'), subtitle: v('f-subtitle'), author: v('f-author'), year: v('f-year'), isbn: v('f-isbn'),
    description: v('f-description'), publisherNote: v('f-publisherNote'),
    keywords: Array.from({ length: 7 }, (_, i) => v('f-kw-' + i)),
    includeIntro: $('#f-intro').checked,
    illustrationCount: Number(v('f-count')), trim: v('f-trim'), paper: v('f-paper'), theme: v('f-theme'),
    margins: { inside: v('f-m-inside'), outside: v('f-m-outside'), top: v('f-m-top'), bottom: v('f-m-bottom') },
    cover: { background: v('f-bg'), accent: v('f-accent') },
  };
}

window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.includes(h)) { tab = h; render(); } });
load().catch((e) => ($('#view').innerHTML = `<div class="banner bad"><strong>Could not reach the server</strong><span>${esc(e.message)}</span></div>`));
