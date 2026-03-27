const { dbSet } = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { stats } = req.body;
  if (!stats || typeof stats !== 'object')
    return res.status(400).json({ error: 'stats object required' });
  await dbSet('stats', stats);
  res.json({ ok: true });
};
