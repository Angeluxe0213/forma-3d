import { applyCors } from '../../lib/ange.js';

export default function handler(req, res) {
  if (!applyCors(req, res, ['GET', 'OPTIONS'])) return res.status(403).json({ error: 'Origen no permitido.' });
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  return res.status(200).json({ configured: Boolean(process.env.MESHY_API_KEY) });
}

