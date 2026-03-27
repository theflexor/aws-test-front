const { dbGet, dbSet } = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.json(await dbGet('daily', {}));
  }
  if (req.method === 'POST') {
    await dbSet('daily', req.body);
    return res.json({ ok: true });
  }
  res.status(405).end();
};
