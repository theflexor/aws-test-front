// Shared storage helper for all serverless functions
let kv;
async function getKV() {
  if (kv) return kv;
  if (process.env.UPSTASH_REDIS_REST_URL) {
    const { Redis } = require('@upstash/redis');
    kv = Redis.fromEnv();
  }
  return kv;
}

const fs = require('fs');
const path = require('path');
const DATA_DIR = '/tmp/exam-data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const file = (name) => path.join(DATA_DIR, `${name}.json`);
const readFile = (name, def) => { try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return def; } };
const writeFile = (name, data) => fs.writeFileSync(file(name), JSON.stringify(data));

async function dbGet(key, def) {
  const store = await getKV();
  if (store) return (await store.get(key)) ?? def;
  return readFile(key, def);
}
async function dbSet(key, value) {
  const store = await getKV();
  if (store) return store.set(key, value);
  writeFile(key, value);
}

module.exports = { dbGet, dbSet };
