const { dbGet, dbSet } = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { questionNum, bookmarked } = req.body;
  if (!questionNum || typeof bookmarked !== 'boolean')
    return res.status(400).json({ error: 'questionNum and bookmarked required' });

  let bm = await dbGet('bookmarks', []);
  if (bookmarked) { if (!bm.includes(questionNum)) bm.push(questionNum); }
  else            { bm = bm.filter(n => n !== questionNum); }
  await dbSet('bookmarks', bm);
  res.json({ ok: true, count: bm.length });
};
