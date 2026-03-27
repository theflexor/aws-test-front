const { dbGet, dbSet } = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).end();

  const { questionNum, isCorrect } = req.body;
  if (!questionNum || typeof isCorrect !== 'boolean')
    return res.status(400).json({ error: 'questionNum and isCorrect required' });

  const stats = await dbGet('stats', {});
  if (!stats[questionNum]) stats[questionNum] = { attempts: 0, correct: 0 };
  stats[questionNum].attempts++;
  if (isCorrect) stats[questionNum].correct++;
  stats[questionNum].last = Date.now();
  await dbSet('stats', stats);

  res.json({ ok: true, stat: stats[questionNum] });
};
