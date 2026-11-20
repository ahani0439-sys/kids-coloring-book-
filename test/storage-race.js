// Regression test: a file changed while its previous version is uploading must be uploaded again.
const fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kdp-race-'));
Object.assign(process.env, { DATA_DIR: path.join(tmp, 'data'), STORAGE_BACKEND: 'mirror', STORAGE_MIRROR_DIR: path.join(tmp, 'bucket'), STORAGE_MIRROR_DELAY_MS: '200' });
const storage = require('../src/storage');
(async () => {
  storage.ensureDirs();
  const file = path.join(storage.ROOT, 'state.json');
  storage.writeFile(file, 'version 1');
  await new Promise((r) => setTimeout(r, 50)); // first upload is now in flight
  storage.writeFile(file, 'version 2');
  const synced = await storage.flush(5000);
  const remote = fs.readFileSync(path.join(tmp, 'bucket', 'state.json'), 'utf8');
  const pass = synced && remote === 'version 2';
  console.log(`  ${pass ? 'PASS' : 'FAIL'} bucket has the latest version after a change during upload (got "${remote}")`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(pass ? 0 : 1);
})();
