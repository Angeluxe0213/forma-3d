export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers.origin;
  const allowedOrigins = (process.env.API_ALLOWED_ORIGIN || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const originAllowed = !allowedOrigins.length || allowedOrigins.includes(origin);
  if (origin && originAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (origin && !originAllowed) return res.status(403).json({ error: 'Origen no permitido.' });
  const token = (req.headers.authorization || '').replace(/^Bearer\\s+/i, '');
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
    const settingsResponse = await fetch(`${url}/rest/v1/admin_settings?select=filament_cost_per_meter,machine_cost_per_minute,minimum_gross_margin,costs_configured&id=eq.true`, { headers });
    const settings = settingsResponse.ok ? (await settingsResponse.json())[0] : null;
    const orderResponse = await fetch(`${url}/rest/v1/orders?select=id,created_at,file_path,file_name,filament_m,time_minutes,estimated_price,status,profiles(first_name,last_name,email,phone)&order=created_at.asc`, { headers });
    if (!orderResponse.ok) return res.status(400).json({ error: await orderResponse.text() });
    const orders = await orderResponse.json();
    const result = await Promise.all(orders.map(async order => {
      const objectPath = order.file_path.split('/').map(encodeURIComponent).join('/');
      const signed = await fetch(`${url}/storage/v1/object/sign/stl-files/${objectPath}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }) });
      const payload = signed.ok ? await signed.json() : {};
      const directCost = settings?.costs_configured ? Number(order.filament_m) * Number(settings.filament_cost_per_meter) + Number(order.time_minutes) * Number(settings.machine_cost_per_minute) : null;
      const revenue = Number(order.estimated_price);
      return { ...order, download_url: payload.signedURL ? `${url}/storage/v1${payload.signedURL}` : null, direct_cost: directCost, estimated_gain: directCost == null ? null : revenue - directCost, gross_margin: directCost == null || !revenue ? null : (revenue - directCost) / revenue };
    }));
    const generationsResponse = await fetch(`${url}/rest/v1/ange_generations?select=id,user_id,prompt,task_kind,created_at,filament_m,time_minutes,estimated_price,volume_cm3,provider_task_id,stl_path&order=created_at.desc&limit=50`, { headers });
    const generations = generationsResponse.ok ? await generationsResponse.json() : [];
    let profileById = {};
    if (generations.length) {
      const ids = [...new Set(generations.map(item => item.user_id))];
      const profilesResponse = await fetch(`${url}/rest/v1/profiles?select=id,first_name,last_name,email,phone&id=in.(${ids.join(',')})`, { headers });
      if (profilesResponse.ok) profileById = Object.fromEntries((await profilesResponse.json()).map(profile => [profile.id, profile]));
    }
    const aiModels = await Promise.all(generations.map(async item => {
      let model_urls = {};
      let model_status = 'UNKNOWN';
      if (item.stl_path) {
        const signed = await fetch(`${url}/storage/v1/object/sign/stl-files/${item.stl_path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) });
        const signedBody = signed.ok ? await signed.json() : {};
        if (signedBody.signedURL) model_urls.stl = `${url}/storage/v1${signedBody.signedURL}`;
        model_status = 'ARCHIVED';
      } else if (process.env.MESHY_API_KEY) {
        const version = item.task_kind === 'image' ? 'v1' : 'v2';
        const response = await fetch(`https://api.meshy.ai/openapi/${version}/${item.task_kind === 'image' ? 'image-to-3d' : 'text-to-3d'}/${encodeURIComponent(item.provider_task_id)}`, { headers: { Authorization: `Bearer ${process.env.MESHY_API_KEY}` } });
        if (response.ok) { const task = await response.json(); model_urls = task.model_urls || {}; model_status = task.status || model_status; }
      }
      const revenue = Number(item.estimated_price || 0);
      const directCost = settings?.costs_configured && item.filament_m != null && item.time_minutes != null ? Number(item.filament_m) * Number(settings.filament_cost_per_meter) + Number(item.time_minutes) * Number(settings.machine_cost_per_minute) : null;
      return { ...item, customer: profileById[item.user_id] || {}, model_urls, model_status, direct_cost: directCost, estimated_gain: directCost == null ? null : revenue - directCost, gross_margin: directCost == null || !revenue ? null : (revenue - directCost) / revenue };
    }));
    return res.status(200).json({ orders: result, ai_models: aiModels, pricing: settings || { costs_configured: false, filament_cost_per_meter: 0, machine_cost_per_minute: 0, minimum_gross_margin: 0.4 } });
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
