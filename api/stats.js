const { dbGet, dbSet } = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.json(await dbGet('stats', {}));
  }
  if (req.method === 'DELETE') {
    await dbSet('stats', {});
    await dbSet('bookmarks', []);
    await dbSet('daily', {});
    return res.json({ ok: true });
  }
  res.status(405).end();
};
