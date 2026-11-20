// Dino Book Factory: mobile client. All keys stay on the server; this file only calls /api.
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inch = (v, d = 3) => `${Number(v).toFixed(d)}"`;
const kb = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');
const STATUS = { empty: 'Needs art', generating: 'Generating', review: 'Review', approved: 'Approved', rejected: 'Rejected', failed: 'Failed' };

let S = null;
let tab = ['overview', 'pages', 'book', 'export'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
let filter = 'all';
let lastReport = null;
let busy = false;
let pollTimer = null;
let confirmDelete = null;

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}, ...opts, body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200);
}
async function load() { S = await api('/api/state'); render(); schedulePoll(); }
function setState(next) { S = next.state || next; render(); schedulePoll(); }
function schedulePoll() {
  clearTimeout(pollTimer);
  if (S.illustrations.some((i) => i.status === 'generating')) pollTimer = setTimeout(load, 4000);
  else if (S.storage.pending) pollTimer = setTimeout(load, 2500);
}

// ---------- Rendering ----------
function render() {
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  renderBanner();
  const v = $('#view');
  v.innerHTML = { overview: viewOverview, pages: viewPages, book: viewBook, export: viewExport }[tab]();
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
      <div class="stat"><b>${c.approved}/${n}</b><span>approved</span></div>
      <div class="stat"><b>${c.review}</b><span>waiting for review</span></div>
      <div class="stat"><b>${I.pageCount}</b><span>interior pages</span></div>
      <div class="stat"><b>${C.spine.toFixed(3)}"</b><span>spine width</span></div>
    </div>
    <button class="btn primary block" data-go="pages">${c.approved === n ? 'Review pages' : `Review pages (${n - c.approved} to go)`}</button>
    ${S.autoExport ? `<p class="small">Auto-assembly ran ${new Date(S.autoExport.at).toLocaleString()}: interior ${S.autoExport.interior.ok ? 'passed' : 'blocked'}, cover ${S.autoExport.cover.ok ? 'passed' : 'blocked'}. See Export.</p>` : ''}
  </section>
  ${storageCard()}
  <section class="card">
    <div class="section-head"><h2>Interior layout</h2><span class="pill ${I.issues.length ? 'st-fail' : 'st-pass'}">${I.issues.length ? 'Needs fixing' : 'Meets KDP rules'}</span></div>
    <p class="small muted">Each picture sits on a right-hand page with a blank page behind it. Scroll the strip to see all ${I.pageCount} pages.</p>
    <div class="strip" aria-label="Page order">${pages}</div>
    <table class="spec-table">
      <tr><td>Trim size</td><td>8.5" × 11" (no bleed)</td></tr>
      <tr><td>Interior</td><td>Black &amp; white, white paper</td></tr>
      <tr><td>Page count</td><td>${I.pageCount} (KDP range 24–828)</td></tr>
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
      <tr><td>Spine (${C.pageCount} pp × ${C.perPage}" white paper)</td><td>${C.spine.toFixed(4)}"</td></tr>
      <tr><td>Full cover with bleed</td><td>${C.width.toFixed(4)}" × ${C.height.toFixed(3)}"</td></tr>
      <tr><td>Bleed</td><td>0.125" each side</td></tr>
      <tr><td>Text safe zone</td><td>0.25" inside trim <span class="muted small">KDP min 0.125"</span></td></tr>
      <tr><td>Barcode area</td><td>2" × 1.2", back lower right</td></tr>
      <tr><td>Spine text</td><td>${C.spineTextAllowed ? 'Allowed' : `Off (needs ${C.spineTextMinPages}+ pages)`}</td></tr>
    </table>
    <p class="small muted">Double-check these numbers in the <a href="${C.calculatorUrl}" target="_blank" rel="noopener">official KDP cover calculator</a> (8.5 × 11, paperback, black ink, white paper, ${C.pageCount} pages) before uploading.</p>
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
  ${gen ? `<div class="btn-row"><button class="btn primary" data-genmissing="1" ${c.empty + c.rejected + c.failed ? '' : 'disabled'}>Generate all missing (${c.empty + c.rejected + c.failed})</button></div>
  <p class="small muted num">${esc(S.config.image.label)} · ${esc(S.config.image.model)} · ${S.usage.today} of ${S.usage.maxPerDay} generations used today</p>` : `<p class="small muted">Generation is off until the server has an image provider. Upload works now.</p>`}
  <p class="small muted">Rejected images are moved out of the book folder and can never be placed in a PDF. Uploads and generated images are converted to pure black-and-white line art at 2250 × 3000 px.</p>
  <div class="gallery">${list.map((il) => card(il, gen)).join('') || '<p class="muted">Nothing here.</p>'}</div>`;
}

function card(il, gen) {
  const art = il.status === 'generating'
    ? `<div class="ph"><div class="spinner"></div>Generating…</div>`
    : il.hasImage
      ? `<img src="/api/illustrations/${il.id}/image?v=${encodeURIComponent(il.image.file)}" alt="Illustration ${il.id}: ${esc(il.title)}" loading="lazy">`
      : `<div class="ph"><b>${il.id}</b>No image yet<br>${il.history.length ? `${il.history.length} earlier image(s) rejected` : ''}</div>`;
  const upload = `<label class="btn ghost" for="up-${il.id}">Upload<input id="up-${il.id}" type="file" accept="image/*" data-upload="${il.id}" hidden></label>`;
  let actions = '';
  if (il.status === 'review') actions = `<button class="btn ok" data-act="approve" data-id="${il.id}">Approve</button><button class="btn bad" data-act="reject" data-id="${il.id}">Reject</button><button class="btn" data-act="regenerate" data-id="${il.id}">${gen ? 'Regenerate' : 'Reject &amp; redo'}</button>`;
  else if (il.status === 'approved') actions = `<button class="btn bad" data-act="reject" data-id="${il.id}">Reject</button>`;
  else if (il.status !== 'generating') actions = `<button class="btn primary" data-gen="${il.id}" ${gen ? '' : 'disabled'}>Generate</button>${upload}`;
  const src = il.image?.sourcePx ? `<span class="small muted num">Source ${il.image.sourcePx.w} × ${il.image.sourcePx.h} px · ${esc(il.image.origin)}</span>` : '';
  return `<article class="il" id="il-${il.id}">
    <div class="il-art">${art}</div>
    <div class="il-body">
      <div class="il-head"><h3>${il.id}. ${esc(il.title)}</h3><span class="pill st-${il.status}">${STATUS[il.status]}</span></div>
      ${il.regenerateRequested && il.status !== 'generating' ? '<span class="small muted">Regeneration requested</span>' : ''}
      ${src}
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
      ${S.coverArt ? `<img src="/api/cover-art?v=${encodeURIComponent(S.coverArt.file)}" alt="Uploaded cover art" style="border-radius:10px;border:1px solid var(--line)">` : '<p class="small muted">No cover art uploaded. The print cover uses your first approved illustration on a white panel.</p>'}
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
      <button class="btn" data-export="interior" data-mode="proof" data-guides="1" ${busy ? 'disabled' : ''}>Interior proof with guides</button>
      <button class="btn" data-export="interior" data-mode="proof" ${busy ? 'disabled' : ''}>Clean interior proof</button>
      <button class="btn" data-export="cover" data-mode="template" ${busy ? 'disabled' : ''}>Cover template with guides</button>
    </div>
  </section>
  <section class="card">
    <h2>Print-ready files</h2>
    ${blockers.length ? `<div class="banner warn"><strong>Not ready yet</strong>${blockers.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '<p class="small">All 30 illustrations are approved. Files are only saved if every check passes.</p>'}
    <div class="btn-row">
      <button class="btn primary" data-export="interior" data-mode="final" ${blockers.length || busy ? 'disabled' : ''}>Build print-ready interior</button>
      <button class="btn primary" data-export="cover" data-mode="print" ${busy ? 'disabled' : ''}>Build print-ready cover</button>
    </div>
  </section>
  ${busy ? '<section class="card"><div class="section-head"><h2>Building and validating…</h2><div class="spinner"></div></div></section>' : ''}
  ${lastReport ? `<section class="card"><div class="section-head"><h2>Last check: ${esc(lastReport.title)}</h2><span class="pill st-${lastReport.ok ? 'pass' : 'fail'}">${lastReport.ok ? 'Passed' : 'Blocked'}</span></div>
    <p class="small">${lastReport.file ? `Saved <b>${esc(lastReport.file)}</b>.` : 'No file was saved.'}</p>${reportHtml(lastReport.report)}</section>` : ''}
  <section class="card">
    <div class="section-head"><h2>Files on the server</h2><span class="small muted">${files.length} file(s)</span></div>
    ${files.length ? files.map((f) => `<div class="file">
      <div class="section-head"><span class="file-name">${esc(f.name)}</span><span class="pill st-${f.report?.ok ? 'pass' : 'warn'}">${f.report?.ok ? 'Checks passed' : 'Has warnings'}</span></div>
      <span class="small muted num">${kb(f.bytes)} · ${new Date(f.created).toLocaleString()}${f.report?.pageCount ? ` · ${f.report.pageCount} pages` : ''}${f.report?.widthIn ? ` · ${f.report.widthIn.toFixed(3)}" × ${f.report.heightIn.toFixed(3)}"` : ''}</span>
      <div class="btn-row">
        <a class="btn primary" href="/api/files/${encodeURIComponent(f.name)}">Download</a>
        <a class="btn ghost" href="/api/files/${encodeURIComponent(f.name)}?view=1" target="_blank" rel="noopener">Open</a>
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
    if (t.dataset.tab || t.dataset.go) { tab = t.dataset.tab || t.dataset.go; history.replaceState(null, '', '#' + tab); render(); scrollTo(0, 0); return; }
    if (t.dataset.filter) { filter = t.dataset.filter; render(); return; }
    if (t.dataset.act) {
      t.disabled = true;
      const res = await api(`/api/illustrations/${t.dataset.id}/${t.dataset.act}`, { method: 'POST' });
      setState(res);
      if (res.note) { toast(`Rejected. ${res.note}`); return; }
      toast({ approve: 'Approved', reject: 'Rejected and removed from the book', regenerate: S.config.image.configured ? 'Regenerating' : 'Rejected. Upload or generate a new image.' }[t.dataset.act]);
      if (t.dataset.act === 'approve' && S.autoExport && S.illustrations.every((i) => i.status === 'approved')) toast('All approved. Final files assembled; see Export.');
      return;
    }
    if (t.dataset.genmissing) {
      t.disabled = true;
      const out = await api('/api/generate-missing', { method: 'POST' });
      setState(out); toast(out.note ? `Queued ${out.queued}. ${out.note}` : `Queued ${out.queued} page(s)`); return;
    }
    if (t.dataset.gen) { t.disabled = true; setState(await api(`/api/illustrations/${t.dataset.gen}/generate`, { method: 'POST' })); toast('Generation started'); return; }
    if (t.dataset.saveprompt) { setState(await api(`/api/illustrations/${t.dataset.saveprompt}/prompt`, { method: 'PUT', body: { prompt: $('#prompt-' + t.dataset.saveprompt).value } })); toast('Prompt saved'); return; }
    if (t.dataset.export) {
      busy = true; render();
      const kind = t.dataset.export, mode = t.dataset.mode;
      const out = await api(`/api/export/${kind}`, { method: 'POST', body: { mode, guides: !!t.dataset.guides } }).finally(() => (busy = false));
      lastReport = { title: `${kind} (${mode})`, ok: out.ok, file: out.file?.name, report: out.report };
      setState(out); toast(out.file ? 'PDF saved' : 'Blocked: see the checks'); return;
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
  const m = e.target.id.match(/^f-kw-(\d)$/);
  if (m) { const c = $('#kwc-' + m[1]); c.textContent = `${e.target.value.length}/50`; c.classList.toggle('over', e.target.value.length > 50); }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
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
    margins: { inside: v('f-m-inside'), outside: v('f-m-outside'), top: v('f-m-top'), bottom: v('f-m-bottom') },
    cover: { background: v('f-bg'), accent: v('f-accent') },
  };
}

window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (['overview', 'pages', 'book', 'export'].includes(h)) { tab = h; render(); } });
load().catch((e) => ($('#view').innerHTML = `<div class="banner bad"><strong>Could not reach the server</strong><span>${esc(e.message)}</span></div>`));
