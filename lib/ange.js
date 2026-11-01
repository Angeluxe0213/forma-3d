const DEFAULT_ORIGINS = [
  'https://printex-3d.com',
  'https://www.printex-3d.com',
  'https://forma-3d-nor0.onrender.com'
];

export function applyCors(req, res, methods) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  const configured = (process.env.API_ALLOWED_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
  const allowed = new Set([...DEFAULT_ORIGINS, ...configured]);
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!allowed.has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
  return true;
}

export async function requireUser(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
  if (!url || !key) {
    res.status(503).json({ error: 'El backend todavía no está conectado a Supabase.' });
    return null;
  }
  if (!token) {
    res.status(401).json({ error: 'Inicia sesión para usar Ange.' });
    return null;
  }
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    res.status(401).json({ error: 'Tu sesión venció. Vuelve a iniciar sesión.' });
    return null;
  }
  const user = await response.json();
  return { url, key, token, user };
}

export function userHeaders(context, extra = {}) {
  return {
    apikey: context.key,
    Authorization: `Bearer ${context.token}`,
    ...extra
  };
}

