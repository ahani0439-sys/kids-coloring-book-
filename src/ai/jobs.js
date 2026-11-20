// "Generate Full Book": plan -> illustrations -> cover -> PDF assembly, per book.
// Saved after every page, so it can be stopped at once, resumed after a restart, and failed pages retried.
// Paid requests happen only with an approved budget; every paid request is checked against the
// book's remaining budget and the monthly limit BEFORE it is sent.
const crypto = require('crypto');
const path = require('path');
const sharp = require('sharp');
const storage = require('../storage');
const settings = require('./settings');
const text = require('./text');
const image = require('./image');
const cost = require('./cost');
const images = require('../images');
const engine = require('../engine');
const { assembleIfComplete } = require('../exporter');

const TEXT = ['manual', 'openai', 'local'];
const PICTURES = ['manual', 'builtin', 'openai', 'local'];
const COVERS = ['manual', 'openai', 'local'];
const running = new Map(); // bookId -> AbortController

const fail = (status, msg, extra = {}) => Object.assign(new Error(msg), { status, ...extra });

function specFrom(st, b = {}) {
  const prev = st.genJob?.spec || st.ai?.spec || {};
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  return {
    textProvider: pick(b.textProvider, TEXT, prev.textProvider || 'manual'),
    imageProvider: pick(b.imageProvider, PICTURES, prev.imageProvider || 'manual'),
    coverProvider: pick(b.coverProvider, COVERS, prev.coverProvider || 'manual'),
    autoApprove: b.autoApprove === true,
    replan: b.replan === true,
  };
}

function pagesToGenerate(st, spec) {
  if (!['openai', 'local', 'builtin'].includes(spec.imageProvider)) return 0;
  return st.illustrations.filter((il) => !['approved', 'review'].includes(il.status)).length;
}

function estimateFor(bs, b = {}) {
  const st = bs.load();
  const spec = specFrom(st, b);
  const est = cost.estimate({ ...spec, count: st.illustrations.length, type: st.book.type || 'coloring', pagesToGenerate: pagesToGenerate(st, spec), planNeeded: !st.ai?.plan || spec.replan, coverProvider: st.coverArt ? 'manual' : spec.coverProvider });
  return { spec, estimate: est, paidBlocker: est.paid ? settings.paidBlocker() : null, monthlyRoom: settings.monthlyRoom(), perBookDefaultUsd: settings.load().limits.perBookDefaultUsd };
}

function log(job, msg) {
  job.log.push({ at: new Date().toISOString(), msg });
  if (job.log.length > 300) job.log = job.log.slice(-300);
}

// Returns a reason string if a paid request of `usd` must not be sent now.
function paidGuard(job, usd) {
  const blocker = settings.paidBlocker();
  if (blocker) return blocker;
  if (job.spentUsd + usd > job.approvedBudgetUsd + 1e-9) return `The approved budget for this book ($${job.approvedBudgetUsd.toFixed(2)}) would be exceeded. Approve more budget to continue.`;
  if (usd > settings.monthlyRoom() + 1e-9) return `The monthly spending limit ($${settings.load().limits.monthlyUsd.toFixed(2)}) would be exceeded.`;
  return null;
}
function charge(bs, job, provider, kind, model, usd) {
  if (!usd) return;
  job.spentUsd = +(job.spentUsd + usd).toFixed(5);
  settings.record({ bookId: bs.id, provider, kind, model, usd });
}

function approveBudget(job, est, b) {
  if (!est.paid) { job.approvedBudgetUsd = job.approvedBudgetUsd || 0; return; }
  const blocker = settings.paidBlocker();
  if (blocker) throw fail(403, blocker);
  const add = Number(b.approvedBudgetUsd);
  if (b.approve !== true || !(add > 0)) throw fail(409, 'This plan uses the paid OpenAI API. Review the cost estimate and approve a budget first.', { needsApproval: true, estimate: est });
  if (add > settings.monthlyRoom() + 1e-9) throw fail(409, `The budget ($${add.toFixed(2)}) is more than what is left of this month's limit ($${settings.monthlyRoom().toFixed(2)}).`);
  job.approvedBudgetUsd = +(job.spentUsd + add).toFixed(5); // the new approval covers what is left to do
  job.approvals = [...(job.approvals || []), { at: new Date().toISOString(), usd: add, estimateUsd: est.totalUsd }];
}

function start(bs, b = {}) {
  if (running.has(bs.id)) throw fail(409, 'Generation is already running for this book.');
  const st = bs.load();
  const { spec, estimate } = estimateFor(bs, b);
  const job = { id: crypto.randomBytes(4).toString('hex'), status: 'running', phase: 'plan', spec, spentUsd: 0, approvedBudgetUsd: 0, estimate, log: [], startedAt: new Date().toISOString(), progress: { total: st.illustrations.length } };
  approveBudget(job, estimate, b);
  st.genJob = job;
  st.ai = { ...(st.ai || {}), spec };
  log(job, `Started: plan by ${spec.textProvider}, pictures by ${spec.imageProvider}, cover by ${spec.coverProvider}${estimate.paid ? `, approved budget $${job.approvedBudgetUsd.toFixed(2)}` : ' (no paid requests)'}.`);
  bs.save();
  launch(bs);
  return job;
}

function resume(bs, b = {}) {
  const st = bs.load();
  const job = st.genJob;
  if (!job) return start(bs, b);
  if (running.has(bs.id)) throw fail(409, 'Generation is already running for this book.');
  const { estimate } = estimateFor(bs, job.spec);
  job.estimate = estimate;
  const remaining = job.approvedBudgetUsd - job.spentUsd;
  if (estimate.paid && (b.approve === true || remaining <= 0)) approveBudget(job, estimate, b);
  job.status = 'running'; job.error = null; job.message = null;
  log(job, 'Resumed.');
  bs.save();
  launch(bs);
  return job;
}

function retryFailed(bs, b = {}) {
  const st = bs.load();
  let n = 0;
  for (const il of st.illustrations) if (il.status === 'failed') { il.status = 'empty'; il.error = null; n++; }
  bs.save();
  const job = resume(bs, b);
  log(job, `Retrying ${n} failed page(s).`);
  return job;
}

function stop(bs) {
  const st = bs.load();
  const c = running.get(bs.id);
  if (st.genJob && (c || st.genJob.status === 'running')) {
    st.genJob.status = 'stopped';
    st.genJob.message = 'Stopped by you. Nothing else will be sent. Resume any time.';
    log(st.genJob, 'Stop requested: in-flight request cancelled.');
  }
  if (c) c.abort();
  for (const il of st.illustrations) if (il.status === 'generating') { il.status = il.image ? 'review' : 'empty'; il.error = null; }
  bs.save();
  return st.genJob;
}

async function launch(bs) {
  const controller = new AbortController();
  running.set(bs.id, controller);
  const st = bs.load();
  const job = st.genJob;
  try {
    await runJob(bs, st, job, controller.signal);
  } catch (e) {
    if (controller.signal.aborted || job.status === 'stopped') job.status = 'stopped';
    else { job.status = 'failed'; job.error = e.message; log(job, `Failed: ${e.message}`); }
  } finally {
    running.delete(bs.id);
    job.finishedAt = new Date().toISOString();
    for (const il of st.illustrations) if (il.status === 'generating') il.status = il.image ? 'review' : 'empty';
    bs.save();
  }
}

async function inkOk(buf) {
  const { data } = await sharp(buf).resize(300, 400, { fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true });
  let ink = 0; for (const v of data) if (v < 128) ink++;
  return ink / data.length;
}

async function runJob(bs, st, job, signal) {
  const spec = job.spec;
  const stopped = () => signal.aborted || job.status === 'stopped';

  // 1. Plan
  job.phase = 'plan';
  if (!st.ai?.plan || spec.replan) {
    if (spec.textProvider === 'openai') {
      const line = job.estimate.lines.find((l) => l.item.startsWith('Book plan'));
      const why = paidGuard(job, line ? line.usd : 0.05);
      if (why) { job.status = 'paused'; job.message = why; log(job, why); return; }
    }
    log(job, `Planning ${st.illustrations.length} pages with the ${spec.textProvider} planner…`);
    const res = await text.plan({ idea: st.book.idea || st.book.theme, theme: st.book.theme, count: st.illustrations.length, type: st.book.type || 'coloring', title: st.book.titleFromUser ? st.book.title : '' }, spec.textProvider, signal);
    charge(bs, job, spec.textProvider, 'plan', res.plan.model || spec.textProvider, res.usd);
    applyPlan(st, res.plan);
    log(job, `Plan ready (${res.plan.source}${res.plan.filledFromManual ? `, ${res.plan.filledFromManual} page(s) filled by the manual planner` : ''}).`);
    bs.save();
  }
  if (stopped()) return;

  // 2. Illustrations
  job.phase = 'pictures';
  const prov = spec.imageProvider;
  job.progress = { total: st.illustrations.length, done: 0, failed: 0 };
  if (prov === 'manual') {
    log(job, 'Pictures: manual mode. Upload each illustration on the Pages tab (for example images you made in ChatGPT).');
  } else {
    for (const il of st.illustrations) {
      if (stopped()) return;
      if (['approved', 'review'].includes(il.status)) { job.progress.done++; continue; }
      if (job.onlyPage && il.id !== job.onlyPage) continue; // single-page regeneration
      if (prov === 'builtin' && !images.canGenerate(bs, il)) { continue; }
      if (prov === 'openai') {
        const each = settings.load().openai.prices.image[settings.load().openai.imageQuality];
        const why = paidGuard(job, each);
        if (why) { job.status = 'paused'; job.message = why; log(job, why); bs.save(); return; }
      }
      il.status = 'generating'; il.error = null; bs.save();
      try {
        let prepared, origin;
        if (prov === 'builtin') {
          const g = await engine.generate(il.id);
          const png = await engine.render(g.svg);
          prepared = { buffer: png, sourcePx: { w: 2250, h: 3000 }, px: { w: 2250, h: 3000 } };
          origin = 'svg-engine';
        } else {
          const res = await image.generate(prov, il.prompt, { kind: 'page', seed: (job.seed ||= Math.floor(Math.random() * 2 ** 31)), signal });
          charge(bs, job, prov, 'page', res.model, res.usd);
          prepared = await images.prepareLineArt(res.buffer, images.targetFor(bs));
          origin = `${prov}:${res.model}`;
        }
        const ink = await inkOk(prepared.buffer);
        if (ink < 0.02 || ink > 0.45) throw new Error(`The picture failed the line-art check (${(ink * 100).toFixed(1)}% ink). Regenerate it.`);
        images.saveCandidate(bs, il, prepared, origin);
        bs.logDecision(il, 'generated', { by: origin });
        if (spec.autoApprove) { il.status = 'approved'; il.approvedAt = new Date().toISOString(); bs.logDecision(il, 'approved', { auto: true }); }
        job.progress.done++;
      } catch (e) {
        if (stopped()) { il.status = il.image ? 'review' : 'empty'; return; }
        il.status = il.image ? 'review' : 'failed';
        il.error = e.message;
        job.progress.failed++;
        log(job, `Page ${il.id} failed: ${e.message}`);
      }
      bs.save();
    }
  }
  if (stopped()) return;

  if (job.onlyPage) {
    const il = st.illustrations.find((i) => i.id === job.onlyPage);
    job.onlyPage = null;
    job.status = 'needs-review';
    job.message = il?.status === 'review' ? `Page ${il.id} redrawn: review it on the Pages tab.` : `Page ${il?.id} could not be redrawn: ${il?.error || 'unknown error'}`;
    log(job, job.message);
    return;
  }

  // 3. Cover artwork (if none was uploaded)
  job.phase = 'cover';
  if (!st.coverArt && ['openai', 'local'].includes(spec.coverProvider)) {
    const each = settings.load().openai.prices.image[settings.load().openai.imageQuality];
    const why = spec.coverProvider === 'openai' ? paidGuard(job, each) : null;
    if (why) { job.status = 'paused'; job.message = why; log(job, why); return; }
    try {
      const res = await image.generate(spec.coverProvider, image.coverPrompt(st.ai.plan), { kind: 'cover', signal });
      charge(bs, job, spec.coverProvider, 'cover', res.model, res.usd);
      const buf = await images.prepareCoverArt(res.buffer);
      const file = `cover-${Date.now()}.jpg`;
      storage.writeFile(path.join(bs.DIRS.cover, file), buf);
      const meta = await sharp(buf).metadata();
      st.coverArt = { file, px: { w: meta.width, h: meta.height }, sourcePx: buf.sourcePx, at: new Date().toISOString(), origin: spec.coverProvider };
      log(job, 'Cover artwork ready.');
    } catch (e) {
      if (stopped()) return;
      log(job, `Cover artwork failed: ${e.message}. The cover will use your first approved illustration instead.`);
    }
    bs.save();
  }
  if (stopped()) return;

  // 4. PDFs (only when every illustration is approved)
  job.phase = 'assemble';
  const counts = st.illustrations.reduce((m, il) => ((m[il.status] = (m[il.status] || 0) + 1), m), {});
  if (st.illustrations.every((il) => bs.approvedImageFile(il))) {
    log(job, 'All illustrations approved: building the print-ready PDFs…');
    bs.save();
    const out = await assembleIfComplete(bs);
    job.status = out?.status === 'done' && out.interior.ok && out.cover.ok ? 'done' : 'needs-attention';
    job.message = job.status === 'done' ? 'Finished: the print-ready interior and cover are on the Export tab.' : 'The PDFs were blocked by a check; see Overview.';
  } else {
    job.status = 'needs-review';
    job.message = prov === 'manual'
      ? `Plan applied. Upload ${counts.empty || 0} illustration(s) on the Pages tab; PDFs are built when every page is approved.`
      : `Pictures done: ${counts.review || 0} waiting for your review, ${counts.failed || 0} failed, ${counts.empty || 0} still empty. The PDFs are built when every page is approved.`;
  }
  log(job, job.message);
}

function applyPlan(st, plan) {
  st.ai = { ...(st.ai || {}), plan, characterBible: plan.characterBible, styleGuide: plan.styleGuide, plannedAt: new Date().toISOString() };
  if (!st.book.titleFromUser && plan.title) st.book.title = plan.title;
  st.book.subtitle = plan.subtitle;
  st.book.description = plan.description;
  st.book.keywords = plan.keywords;
  st.illustrations.forEach((il, i) => {
    const p = plan.pages[i];
    if (!p || il.status === 'approved') return; // approved artwork keeps its title and prompt
    il.title = p.title;
    il.prompt = image.pagePrompt(plan, p);
    il.caption = p.caption || '';
  });
}

// Regenerate one page with the book's picture provider (uses the remaining approved budget if paid).
function regeneratePage(bs, il) {
  const st = bs.load();
  const job = st.genJob;
  const prov = job?.spec?.imageProvider;
  if (!job || !['openai', 'local'].includes(prov)) return null; // not an AI book: the caller uses the older path
  if (running.has(bs.id)) throw fail(409, 'Generation is running for this book. Wait or stop it first.');
  if (prov === 'openai') {
    const why = paidGuard(job, settings.load().openai.prices.image[settings.load().openai.imageQuality]);
    if (why) throw fail(409, why);
  }
  il.status = 'empty';
  bs.save();
  job.status = 'running'; job.phase = 'pictures'; job.onlyPage = il.id;
  log(job, `Regenerating page ${il.id}.`);
  launch(bs); // the runner skips approved/review pages, so only this (and other empty/failed) pages are drawn
  return job;
}

function isRunning(bookId) { return running.has(bookId); }

module.exports = { start, resume, retryFailed, stop, estimateFor, regeneratePage, isRunning, specFrom, applyPlan, TEXT, PICTURES, COVERS };
