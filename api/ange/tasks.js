import { applyCors, requireUser, userHeaders } from '../../lib/ange.js';

const MAX_DAILY_GENERATIONS = 3;
const MAX_IMAGE_DATA_CHARS = 3_600_000;

export default async function handler(req, res) {
  const methods = ['GET', 'POST', 'OPTIONS'];
  if (!applyCors(req, res, methods)) return res.status(403).json({ error: 'Origen no permitido.' });
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', methods.join(', '));
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const context = await requireUser(req, res);
  if (!context) return;

  if (req.method === 'GET') {
    const id = req.query?.id;
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Solicitud de modelo inválida.' });
    const rowResponse = await fetch(`${context.url}/rest/v1/ange_generations?id=eq.${encodeURIComponent(id)}&select=id,task_kind,provider_task_id`, {
      headers: userHeaders(context)
    });
    if (!rowResponse.ok) return res.status(502).json({ error: 'No se pudo consultar tu modelo.' });
    const rows = await rowResponse.json();
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'No encontramos ese modelo en tu cuenta.' });

    const endpoint = row.task_kind === 'image'
      ? `https://api.meshy.ai/openapi/v1/image-to-3d/${encodeURIComponent(row.provider_task_id)}`
      : `https://api.meshy.ai/openapi/v2/text-to-3d/${encodeURIComponent(row.provider_task_id)}`;
    const providerResponse = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${process.env.MESHY_API_KEY}` }
    });
    if (!providerResponse.ok) return res.status(502).json({ error: 'Ange no pudo consultar el estado en este momento.' });
    const task = await providerResponse.json();
    return res.status(200).json({
      task: {
        status: task.status || 'PENDING',
        progress: Number.isFinite(Number(task.progress)) ? Number(task.progress) : null,
        message: task.task_error?.message || task.message || '',
        model_urls: { stl: task.model_urls?.stl || '', glb: task.model_urls?.glb || '' }
      }
    });
  }

  const apiKey = process.env.MESHY_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Ange se está preparando. Aún falta conectar su servicio de generación.' });
  const { mode, prompt, imageData } = req.body || {};
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim().slice(0, 600) : '';
  if (!['text', 'image'].includes(mode)) return res.status(400).json({ error: 'Elige generar desde texto o desde imagen.' });
  if (cleanPrompt.length < 8) return res.status(400).json({ error: 'Describe tu idea con al menos 8 caracteres.' });
  if (mode === 'image' && (typeof imageData !== 'string' || imageData.length > MAX_IMAGE_DATA_CHARS || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(imageData))) {
    return res.status(400).json({ error: 'Sube una imagen JPG, PNG o WebP de hasta 2.5 MB.' });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const countResponse = await fetch(`${context.url}/rest/v1/ange_generations?select=id&created_at=gte.${encodeURIComponent(since)}`, {
    headers: userHeaders(context)
  });
  if (!countResponse.ok) return res.status(503).json({ error: 'No se pudo verificar el límite diario. Inténtalo más tarde.' });
  const recent = await countResponse.json();
  if (recent.length >= MAX_DAILY_GENERATIONS) return res.status(429).json({ error: 'Alcanzaste el límite de 3 generaciones en 24 horas para tu cuenta.' });

  const endpoint = mode === 'image'
    ? 'https://api.meshy.ai/openapi/v1/image-to-3d'
    : 'https://api.meshy.ai/openapi/v2/text-to-3d';
  const requestBody = mode === 'image'
    ? { image_url: imageData, ai_model: 'meshy-7.1', model_type: 'standard', should_texture: false, moderation: true, target_formats: ['stl', 'glb'] }
    : { mode: 'preview', prompt: cleanPrompt, ai_model: 'meshy-7.1', moderation: true, target_formats: ['stl', 'glb'] };
  const generated = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });
  const generatedBody = await generated.json().catch(() => ({}));
  if (!generated.ok || !generatedBody.result) {
    const status = generated.status === 429 ? 429 : 502;
    return res.status(status).json({ error: generated.status === 429 ? 'El servicio de modelos está ocupado o alcanzó su límite de créditos.' : 'Meshy no pudo iniciar esta generación. Revisa la descripción e inténtalo más tarde.' });
  }

  const recordResponse = await fetch(`${context.url}/rest/v1/ange_generations?select=id`, {
    method: 'POST',
    headers: userHeaders(context, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({
      user_id: context.user.id,
      task_kind: mode,
      prompt: cleanPrompt,
      provider_task_id: generatedBody.result
    })
  });
  if (!recordResponse.ok) return res.status(503).json({ error: 'La generación comenzó, pero no se pudo asociarla a tu cuenta. Contacta a Printex-3D antes de volver a intentarlo.' });
  const records = await recordResponse.json();
  if (!records[0]?.id) return res.status(503).json({ error: 'No se pudo guardar la generación en tu cuenta.' });
  return res.status(202).json({ id: records[0].id, status: 'PENDING' });
}

