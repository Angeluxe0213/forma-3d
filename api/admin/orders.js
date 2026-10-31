export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers.origin;
  const allowedOrigin = process.env.API_ALLOWED_ORIGIN;
  if (allowedOrigin && origin === allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (allowedOrigin && origin && origin !== allowedOrigin) return res.status(403).json({ error: 'Origen no permitido.' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return res.status(503).json({ error: 'Falta configurar Supabase en Vercel.' });
  const headers = { apikey: key, Authorization: `Bearer ${token}` };
  const authResponse = await fetch(`${url}/auth/v1/user`, { headers });
  if (!authResponse.ok) return res.status(401).json({ error: 'La sesión expiró.' });
  const auth = await authResponse.json();
  const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(auth.id)}&select=role`, { headers });
  const profiles = profileResponse.ok ? await profileResponse.json() : [];
  if (profiles[0]?.role !== 'admin') return res.status(403).json({ error: 'Acceso solo para administración.' });

  if (req.method === 'GET') {
    const orderResponse = await fetch(`${url}/rest/v1/orders?select=id,created_at,file_path,file_name,filament_m,time_minutes,estimated_price,status,profiles(first_name,last_name,email,phone)&order=created_at.asc`, { headers });
    if (!orderResponse.ok) return res.status(400).json({ error: await orderResponse.text() });
    const orders = await orderResponse.json();
    const result = await Promise.all(orders.map(async order => {
      const objectPath = order.file_path.split('/').map(encodeURIComponent).join('/');
      const signed = await fetch(`${url}/storage/v1/object/sign/stl-files/${objectPath}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }) });
      const payload = signed.ok ? await signed.json() : {};
      return { ...order, download_url: payload.signedURL ? `${url}/storage/v1${payload.signedURL}` : null };
    }));
    return res.status(200).json({ orders: result });
  }

  if (req.method === 'PATCH') {
    const { id, status } = req.body || {};
    if (!id || !['pending', 'approved', 'printing', 'done'].includes(status)) return res.status(400).json({ error: 'Pedido o estado inválido.' });
    const update = await fetch(`${url}/rest/v1/orders?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ status }) });
    if (!update.ok) return res.status(400).json({ error: await update.text() });
    return res.status(200).json({ ok: true });
  }
  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).json({ error: 'Método no permitido.' });
}
