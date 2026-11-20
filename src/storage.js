// Persistent storage.
//
// The app always works on files in DATA_DIR. What makes them survive restarts and redeploys:
//   STORAGE_BACKEND=local  DATA_DIR sits on a persistent disk (Render paid disk, or your own machine).
//   STORAGE_BACKEND=s3     Every write is copied to an S3-compatible bucket (Cloudflare R2, Backblaze B2, AWS S3).
//                          On boot the bucket is downloaded into DATA_DIR before the server accepts requests.
//   STORAGE_BACKEND=mirror Test-only: same as s3 but the "bucket" is another local folder.
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

const ROOT = config.dataDir;
const SUBDIRS = ['images', 'rejected', 'exports', 'cover'];

function ensureDirs() {
  for (const d of ['', ...SUBDIRS]) fs.mkdirSync(path.join(ROOT, d), { recursive: true });
}

// ---------- Remote adapters ----------
function s3Adapter(c) {
  const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: c.region || 'auto', endpoint: c.endpoint, forcePathStyle: true,
    // Compatibility with Backblaze B2 and Cloudflare R2: only send checksums when the API requires them.
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
  });
  const key = (rel) => c.prefix + rel;
  return {
    name: 's3',
    async list() {
      const out = [];
      let token;
      do {
        const r = await client.send(new ListObjectsV2Command({ Bucket: c.bucket, Prefix: c.prefix, ContinuationToken: token }));
        for (const o of r.Contents || []) out.push({ rel: o.Key.slice(c.prefix.length), size: o.Size });
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
      return out.filter((o) => o.rel && !o.rel.endsWith('/'));
    },
    async get(rel) {
      const r = await client.send(new GetObjectCommand({ Bucket: c.bucket, Key: key(rel) }));
      return Buffer.from(await r.Body.transformToByteArray());
    },
    async put(rel, buf) {
      await client.send(new PutObjectCommand({ Bucket: c.bucket, Key: key(rel), Body: buf }));
    },
    async del(rel) {
      await client.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: key(rel) }));
    },
  };
}

function mirrorAdapter(dir, delayMs = 0) {
  const abs = (rel) => path.join(dir, rel);
  const walk = (d, base = '') => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name), base + e.name + '/') : [{ rel: base + e.name, size: fs.statSync(path.join(d, e.name)).size }]) : [];
  return {
    name: 'mirror',
    async list() { return walk(dir); },
    async get(rel) { return fs.readFileSync(abs(rel)); },
    async put(rel, buf) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); // simulates a slow network in tests
      fs.mkdirSync(path.dirname(abs(rel)), { recursive: true }); fs.writeFileSync(abs(rel), buf);
    },
    async del(rel) { fs.rmSync(abs(rel), { force: true }); },
  };
}

const remote = config.storage.backend === 's3' ? s3Adapter(config.storage)
  : config.storage.backend === 'mirror' && config.storage.mirrorDir ? mirrorAdapter(config.storage.mirrorDir, Number(process.env.STORAGE_MIRROR_DELAY_MS) || 0) : null;

// ---------- Write-through queue ----------
const queue = new Map(); // rel -> { op: 'put' | 'del', seq } (latest change wins)
let seqCounter = 0;
const status = { backend: config.storage.backend, remote: !!remote, pending: 0, lastSyncAt: null, lastError: null, restored: null };
let running = null;
let retryTimer = null;

function enqueue(rel, op) {
  if (!remote) return;
  queue.delete(rel); // re-insert so ordering follows the latest change
  queue.set(rel, { op, seq: ++seqCounter });
  status.pending = queue.size;
  kick();
}

function kick() {
  if (running || !queue.size) return running;
  running = (async () => {
    let failures = 0;
    while (queue.size) {
      const [rel, { op, seq }] = queue.entries().next().value;
      try {
        if (op === 'put') {
          const file = path.join(ROOT, rel);
          if (fs.existsSync(file)) await remote.put(rel, fs.readFileSync(file));
          else await remote.del(rel);
        } else await remote.del(rel);
        if (queue.get(rel)?.seq === seq) queue.delete(rel); // keep it queued if it changed while uploading
        status.lastSyncAt = new Date().toISOString();
        status.lastError = null;
        failures = 0;
      } catch (e) {
        failures++;
        status.lastError = `${rel}: ${e.message}`;
        console.error('[storage] sync failed', status.lastError);
        if (failures >= 5) break; // stop hammering; retry on a timer
        await new Promise((r) => setTimeout(r, 500 * 2 ** failures));
      }
      status.pending = queue.size;
    }
    running = null;
    if (queue.size && !retryTimer) retryTimer = setTimeout(() => { retryTimer = null; kick(); }, 60000);
  })();
  return running;
}

async function flush(timeoutMs = 20000) {
  if (!remote) return true;
  const deadline = Date.now() + timeoutMs;
  while ((pendingMoves.length || movingNow) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  while (queue.size && Date.now() < deadline) {
    await (kick() || new Promise((r) => setTimeout(r, 200)));
    if (queue.size) await new Promise((r) => setTimeout(r, 300));
  }
  return queue.size === 0;
}

// ---------- File operations used by the rest of the app ----------
const relOf = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

function writeFile(abs, data) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, abs); // atomic on the same filesystem
  enqueue(relOf(abs), 'put');
  trackWrite(relOf(abs));
}
function moveFile(fromAbs, toAbs) {
  if (!fs.existsSync(fromAbs)) {
    // Not downloaded yet: the bucket copy is moved later by the queue (put needs a local file),
    // so keep the old object and just record the new name as pending.
    if (remote && remoteIndex.has(relOf(fromAbs))) pendingMoves.push([relOf(fromAbs), relOf(toAbs)]), kickMoves();
    return;
  }
  fs.mkdirSync(path.dirname(toAbs), { recursive: true });
  fs.renameSync(fromAbs, toAbs);
  enqueue(relOf(toAbs), 'put');
  enqueue(relOf(fromAbs), 'del');
  trackWrite(relOf(toAbs)); trackDelete(relOf(fromAbs));
}
// Moves of files that only exist in the bucket: download, re-upload under the new name, delete old.
const pendingMoves = [];
let movingNow = false;
async function kickMoves() {
  if (movingNow) return; movingNow = true;
  while (pendingMoves.length) {
    const [from, to] = pendingMoves.shift();
    try {
      const buf = await remote.get(from);
      const abs = path.join(ROOT, to);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, buf);
      enqueue(to, 'put'); trackWrite(to);
      enqueue(from, 'del'); trackDelete(from);
    } catch (e) { status.lastError = `move ${from}: ${e.message}`; }
  }
  movingNow = false;
}
function removeFile(abs) {
  fs.rmSync(abs, { force: true });
  enqueue(relOf(abs), 'del');
  trackDelete(relOf(abs));
}

// ---------- Remote index and lazy loading ----------
// The bucket's object list is kept in memory. On boot only the small JSON files (library and each
// book's state) are downloaded; images and PDFs are fetched the first time they are needed.
// This keeps cold starts fast and inside free-tier download limits, however many books exist.
const remoteIndex = new Map(); // rel -> size
const isEager = (rel) => rel.endsWith('.json');

function trackWrite(rel) { if (remote) remoteIndex.set(rel, -1); }
function trackDelete(rel) { remoteIndex.delete(rel); }

// True if the file exists locally or in the bucket.
function has(abs) {
  if (fs.existsSync(abs)) return true;
  return remote ? remoteIndex.has(relOf(abs)) : false;
}
// Make sure a file is on local disk before reading it (downloads it from the bucket if needed).
async function ensureLocal(abs) {
  if (fs.existsSync(abs)) return true;
  if (!remote) return false;
  const rel = relOf(abs);
  if (!remoteIndex.has(rel)) return false;
  const buf = await remote.get(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + '.dl';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, abs);
  status.lazyDownloads = (status.lazyDownloads || 0) + 1;
  return true;
}
async function ensureAllLocal(absList) {
  for (const a of absList) await ensureLocal(a);
}
// Files under a folder, local or in the bucket (relative names).
function listDir(absDir) {
  const out = new Set();
  if (fs.existsSync(absDir)) for (const f of fs.readdirSync(absDir)) if (!f.endsWith('.tmp') && !f.endsWith('.dl')) out.add(f);
  if (remote) {
    const prefix = relOf(absDir) + '/';
    for (const rel of remoteIndex.keys()) if (rel.startsWith(prefix) && !rel.slice(prefix.length).includes('/')) out.add(rel.slice(prefix.length));
  }
  return [...out];
}

// Boot: bring DATA_DIR in line with the bucket. Never deletes local files; if the bucket is empty
// but DATA_DIR already has work (for example after switching from a disk), that work is uploaded.
async function restore() {
  ensureDirs();
  if (!remote) { status.restored = { files: 0, note: 'local disk' }; return status.restored; }
  const objects = await remote.list();
  remoteIndex.clear();
  for (const o of objects) remoteIndex.set(o.rel, o.size);
  if (!objects.length) {
    const local = mirrorAdapter(ROOT);
    const files = (await local.list()).filter((f) => !f.rel.endsWith('.tmp'));
    for (const f of files) { enqueue(f.rel, 'put'); remoteIndex.set(f.rel, f.size); }
    await flush(120000);
    status.restored = { files: 0, uploadedExisting: files.length };
    return status.restored;
  }
  let n = 0;
  for (const o of objects) {
    if (!isEager(o.rel)) continue; // images, PDFs, SVG sources: fetched on demand
    const abs = path.join(ROOT, o.rel);
    const buf = await remote.get(o.rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    n++;
  }
  status.restored = { files: n, objects: objects.length, lazy: objects.length - n };
  return status.restored;
}

function sizeOf(abs) {
  if (fs.existsSync(abs)) return fs.statSync(abs).size;
  const v = remoteIndex.get(relOf(abs));
  return v > 0 ? v : null;
}

module.exports = { ROOT, ensureDirs, restore, flush, writeFile, moveFile, removeFile, has, ensureLocal, ensureAllLocal, listDir, sizeOf, relOf: (a) => relOf(a), status: () => ({ ...status, pending: queue.size }) };
