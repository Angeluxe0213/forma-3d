import { applyCors, requireUser, userHeaders } from '../../lib/ange.js';
import { estimateFromStlBuffer } from '../../lib/stl-estimate.js';

export default async function handler(req, res) {
  const methods = ['POST', 'OPTIONS'];
  if (!applyCors(req, res, methods)) return res.status(403).json({ error: 'Origen no permitido.' });
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') { res.setHeader('Allow', methods.join(', ')); return res.status(405).end(); }
  const context = await requireUser(req, res);
  if (!context) return;
  if (!process.env.MESHY_API_KEY) return res.status(503).json({ error: 'ANGELUXE todavía necesita su conexión privada con Meshy.' });

  const id = req.body?.id;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Modelo inválido.' });
  const generationResponse = await fetch(`${context.url}/rest/v1/ange_generations?id=eq.${encodeURIComponent(id)}&select=id,task_kind,provider_task_id,prompt,stl_path`, { headers: userHeaders(context) });
  if (!generationResponse.ok) return res.status(502).json({ error: 'No se pudo verificar el modelo.' });
  const generation = (await generationResponse.json())[0];
  if (!generation) return res.status(404).json({ error: 'No se encontró este modelo en tu cuenta.' });

  const existingResponse = await fetch(`${context.url}/rest/v1/orders?source_generation_id=eq.${encodeURIComponent(id)}&select=id,estimated_price`, { headers: userHeaders(context) });
  if (!existingResponse.ok) return res.status(502).json({ error: 'No se pudo verificar tu solicitud.' });
  const existing = (await existingResponse.json())[0];
  if (existing) return res.status(200).json({ ok: true, order_id: existing.id, estimated_price: Number(existing.estimated_price), already_requested: true });

  let stlResponse;
  if (generation.stl_path) {
    stlResponse = await fetch(`${context.url}/storage/v1/object/stl-files/${generation.stl_path.split('/').map(encodeURIComponent).join('/')}`, { headers: userHeaders(context) });
  } else {
    const providerPath = generation.task_kind === 'image' ? 'image-to-3d' : 'text-to-3d';
    const taskResponse = await fetch(`https://api.meshy.ai/openapi/${generation.task_kind === 'image' ? 'v1' : 'v2'}/${providerPath}/${encodeURIComponent(generation.provider_task_id)}`, { headers: { Authorization: `Bearer ${process.env.MESHY_API_KEY}` } });
    if (!taskResponse.ok) return res.status(502).json({ error: 'ANGELUXE no pudo recuperar el STL. Genera el modelo de nuevo e inténtalo.' });
    const task = await taskResponse.json();
    if (task.status !== 'SUCCEEDED' || !task.model_urls?.stl) return res.status(409).json({ error: 'El modelo todavía no está listo para solicitar impresión.' });
    stlResponse = await fetch(task.model_urls.stl);
  }
  if (!stlResponse.ok) return res.status(502).json({ error: 'No se pudo descargar el STL generado.' });
  const stl = Buffer.from(await stlResponse.arrayBuffer());
  if (!stl.length || stl.length > 50 * 1024 * 1024) return res.status(413).json({ error: 'El STL supera el límite de 50 MB.' });
  let estimate;
  try { estimate = estimateFromStlBuffer(stl); }
  catch { return res.status(422).json({ error: 'No se pudo medir el modelo para calcular la impresión.' }); }

  const quoteResponse = await fetch(`${context.url}/rest/v1/rpc/quote_printing`, { method: 'POST', headers: userHeaders(context, { 'Content-Type': 'application/json' }), body: JSON.stringify({ p_filament_m: estimate.filament_m, p_time_minutes: estimate.time_minutes }) });
  if (!quoteResponse.ok) return res.status(503).json({ error: 'No se pudo calcular la cotización. Vuelve a intentarlo.' });
  estimate.estimated_price = Number(await quoteResponse.json());
  const fileName = `ANGELUXE-${id.slice(0, 8)}.stl`;
  const path = `${context.user.id}/${crypto.randomUUID()}-${fileName}`;
  const uploadResponse = await fetch(`${context.url}/storage/v1/object/stl-files/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: userHeaders(context, { 'Content-Type': 'model/stl', 'x-upsert': 'false' }), body: stl });
  if (!uploadResponse.ok) return res.status(502).json({ error: 'No se pudo guardar el STL en tu cuenta. Revisa los permisos del almacenamiento.' });

  const orderResponse = await fetch(`${context.url}/rest/v1/orders?select=id,estimated_price`, { method: 'POST', headers: userHeaders(context, { 'Content-Type': 'application/json', Prefer: 'return=representation' }), body: JSON.stringify({ user_id: context.user.id, file_path: path, file_name: fileName, file_bytes: stl.length, ...estimate, material: 'PLA', status: 'pending', source_generation_id: id }) });
  if (!orderResponse.ok) return res.status(502).json({ error: 'El STL se guardó, pero no se pudo agregar a la cola. Contacta a Printex-3D y menciona ANGELUXE.' });
  const order = (await orderResponse.json())[0];
  return res.status(201).json({ ok: true, order_id: order.id, estimated_price: Number(order.estimated_price), filament_m: estimate.filament_m, time_minutes: estimate.time_minutes });
}

