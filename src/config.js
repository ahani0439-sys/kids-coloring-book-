// Server-side configuration from environment variables.
// Secrets are read here and never sent to the browser: `publicConfig()` only exposes booleans and names.
const path = require('path');

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const int = (k, d) => { const n = parseInt(env(k), 10); return Number.isFinite(n) && n >= 0 ? n : d; };

const PROVIDERS = {
  replicate: { label: 'Replicate (FLUX)', keyVar: 'REPLICATE_API_TOKEN', modelVar: 'REPLICATE_MODEL', defaultModel: 'black-forest-labs/flux-schnell' },
  openai: { label: 'OpenAI GPT Image', keyVar: 'OPENAI_API_KEY', modelVar: 'OPENAI_IMAGE_MODEL', defaultModel: 'gpt-image-2' },
};

function load() {
  const provider = env('IMAGE_PROVIDER').toLowerCase();
  const p = PROVIDERS[provider];
  const storage = env('STORAGE_BACKEND', 'local').toLowerCase();
  const cfg = {
    production: env('NODE_ENV') === 'production',
    port: int('PORT', 3000),
    password: env('APP_PASSWORD'),
    dataDir: path.resolve(env('DATA_DIR') || path.join(__dirname, '..', 'data')),
    image: {
      provider: p ? provider : provider ? 'invalid' : 'none',
      label: p ? p.label : null,
      apiKey: p ? env(p.keyVar) : '',
      keyVar: p ? p.keyVar : null,
      model: p ? env(p.modelVar) || p.defaultModel : null,
      openaiQuality: env('OPENAI_IMAGE_QUALITY', 'medium'),
      maxPerDay: int('MAX_GENERATIONS_PER_DAY', 60),
      concurrency: Math.max(1, Math.min(4, int('GENERATION_CONCURRENCY', 2))),
      // Only for automated tests against a mock server; leave unset in production.
      replicateBase: env('REPLICATE_BASE_URL', 'https://api.replicate.com'),
      openaiBase: env('OPENAI_BASE_URL', 'https://api.openai.com'),
    },
    storage: {
      backend: storage, // 'local' (disk at DATA_DIR) or 's3' (Cloudflare R2 / any S3-compatible bucket)
      endpoint: env('S3_ENDPOINT'),
      region: env('S3_REGION', 'auto'),
      bucket: env('S3_BUCKET'),
      accessKeyId: env('S3_ACCESS_KEY_ID'),
      secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
      prefix: env('S3_PREFIX', 'dino-book/').replace(/^\/+/, ''),
      mirrorDir: env('STORAGE_MIRROR_DIR'), // test-only backend that mirrors to a second folder
    },
  };
  cfg.problems = problems(cfg);
  return cfg;
}

function problems(cfg) {
  const out = [];
  if (!cfg.password) out.push(cfg.production ? 'APP_PASSWORD is not set. The app refuses to start in production without it.' : 'APP_PASSWORD is not set (fine for local testing only).');
  if (cfg.image.provider === 'invalid') out.push(`IMAGE_PROVIDER must be "replicate" or "openai".`);
  else if (cfg.image.provider !== 'none' && !cfg.image.apiKey) out.push(`${cfg.image.keyVar} is missing for IMAGE_PROVIDER=${cfg.image.provider}.`);
  if (cfg.storage.backend === 's3') {
    for (const k of ['endpoint', 'bucket', 'accessKeyId', 'secretAccessKey']) if (!cfg.storage[k]) out.push(`S3 storage needs ${{ endpoint: 'S3_ENDPOINT', bucket: 'S3_BUCKET', accessKeyId: 'S3_ACCESS_KEY_ID', secretAccessKey: 'S3_SECRET_ACCESS_KEY' }[k]}.`);
  } else if (!['local', 'mirror'].includes(cfg.storage.backend)) out.push('STORAGE_BACKEND must be "local" or "s3".');
  return out;
}

const config = load();

// Safe to send to the browser: no secret values, only whether they are present.
function publicConfig() {
  const i = config.image;
  return {
    production: config.production,
    passwordSet: !!config.password,
    image: { provider: i.provider, label: i.label, model: i.model, configured: !!(i.label && i.apiKey), keyVar: i.keyVar, maxPerDay: i.maxPerDay },
    storageBackend: config.storage.backend,
    problems: config.problems,
  };
}

module.exports = { config, publicConfig, PROVIDERS };
