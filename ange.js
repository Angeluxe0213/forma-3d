import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import 'https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js';

const config = window.FORMA_CONFIG || {};
const supabase = config.supabaseUrl && config.supabaseAnonKey
  ? createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
const API_BASE = (config.apiBaseUrl || '').replace(/\/$/, '');
const $ = id => document.getElementById(id);
const prompt = $('angePrompt');
const imageInput = $('angeImageInput');
const imageField = $('angeImageField');
let mode = 'text';
let imageData = '';
let currentObjectUrl = '';

function message(text, error = false) {
  $('angeMessage').textContent = text;
  $('angeMessage').style.color = error ? '#9b3c2b' : '#536c21';
}
function loginMessage(text, error = false) {
  $('loginMessage').textContent = text;
  $('loginMessage').style.color = error ? '#9b3c2b' : '#536c21';
}

function setBusy(busy) {
  $('angeGenerate').disabled = busy;
  $('angeGenerate').querySelector('span:first-child').textContent = busy ? 'ANGELUXE está creando…' : 'Generar modelo';
  $('angeProgress').hidden = !busy;
  if (busy) $('angeResult').hidden = true;
}

document.querySelectorAll('[data-ange-mode]').forEach(button => {
  button.addEventListener('click', () => {
    mode = button.dataset.angeMode;
    document.querySelectorAll('[data-ange-mode]').forEach(tab => {
      const active = tab === button;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    imageField.hidden = mode !== 'image';
    prompt.placeholder = mode === 'image'
      ? 'Añade instrucciones para guiar la forma o los detalles del modelo…'
      : 'Ej. Un soporte minimalista para audífonos, con base circular y líneas suaves…';
  });
});

prompt.addEventListener('input', () => { $('angePromptCount').textContent = `${prompt.value.length} / 600`; });
$('angeChooseImage').addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', async () => {
  const file = imageInput.files?.[0];
  imageData = '';
  $('angeImagePreview').hidden = true;
  $('angeImagePreview').replaceChildren();
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return message('Elige una imagen PNG, JPG o WebP.', true);
  if (file.size > 2.5 * 1024 * 1024) return message('La imagen supera 2.5 MB. Elige una versión más liviana.', true);
  imageData = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  }).catch(error => { message(error.message, true); return ''; });
  if (!imageData) return;
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(file);
  const preview = document.createElement('img');
  preview.src = currentObjectUrl;
  preview.alt = 'Imagen de referencia para ANGELUXE';
  $('angeImagePreview').append(preview);
  $('angeImagePreview').hidden = false;
  message('Imagen lista. Añade una descripción si quieres orientar el resultado.');
});

async function getSession() {
  if (!supabase) throw new Error('El acceso a ANGELUXE necesita que Supabase esté configurado.');
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function apiRequest(path, session, options = {}) {
  if (!API_BASE) throw new Error('Falta configurar el backend de ANGELUXE en Vercel.');
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${session.access_token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'ANGELUXE no pudo completar la solicitud.');
  return payload;
}

function prettyTime(minutes) { const h=Math.floor(minutes/60),m=minutes%60; return h?`${h} h ${m} min`:`${m} min`; }

function showResult(task, generationId) {
  const urls = task.model_urls || {};
  $('angeViewer').src = urls.glb || '';
  $('angeDownloadStl').href = urls.stl || '#';
  $('angeDownloadGlb').href = urls.glb || '#';
  $('angeDownloadStl').hidden = !urls.stl;
  $('angeDownloadGlb').hidden = !urls.glb;
  $('angeResult').hidden = false;
  $('angeProgress').hidden = true;
  $('angeResult').dataset.generationId = generationId;
  const estimate = task.estimate;
  const quoteReady = estimate && Number.isFinite(Number(estimate.estimated_price));
  $('angePrintEstimate').hidden = !estimate;
  $('angeRequestPrint').hidden = !quoteReady;
  if (estimate) {
    $('angeFilament').textContent = `${Number(estimate.filament_m).toFixed(2)} m`;
    $('angePrintTime').textContent = prettyTime(Number(estimate.time_minutes));
    $('angePrice').textContent = quoteReady ? `S/ ${Number(estimate.estimated_price).toFixed(2)}` : 'Cotización pendiente';
    if (!quoteReady) message('Tu modelo está listo. El administrador debe configurar sus costos reales para confirmar el precio de impresión.');
  }
}

let profileAllowed = false;
async function refreshAccess(session) {
  profileAllowed = false;
  if (session?.user) {
    const { data: profile } = await supabase.from('profiles').select('first_name,last_name,phone,role').eq('id', session.user.id).maybeSingle();
    profileAllowed = profile?.role === 'admin' || Boolean(profile?.first_name?.trim() && profile?.last_name?.trim() && profile?.phone?.trim());
  }
  const controls = [prompt, ...document.querySelectorAll('[data-ange-mode]'), $('angeChooseImage')];
  controls.forEach(control => { control.disabled = !session || !profileAllowed; });
  $('angeGenerate').disabled = !session || !profileAllowed || !$('angeGenerate').dataset.serviceReady;
  if (!session) message('Regístrate con nombre, apellido, correo y teléfono, o inicia sesión para usar todas las opciones de ANGELUXE.', true);
  else if (!profileAllowed) message('Completa tu nombre, apellido y teléfono en tu perfil para activar ANGELUXE.', true);
}

async function checkAvailability() {
  if (!API_BASE) {
    $('angeGenerate').disabled = true;
    message('ANGELUXE se habilitará cuando se conecte el servicio de generación.', true);
    return;
  }
  try {
    const response = await fetch(`${API_BASE}/api/ange/status`, { cache: 'no-store' });
    const state = await response.json();
    if (!response.ok || !state.configured) {
      $('angeGenerate').disabled = true;
      message('ANGELUXE estará disponible en breve; el estudio todavía se está configurando.', true);
    } else {
      $('angeGenerate').dataset.serviceReady = 'true';
      const { data: { session } } = await supabase.auth.getSession();
      $('angeGenerate').disabled = !session || !profileAllowed;
    }
  } catch {
    $('angeGenerate').disabled = true;
    message('No pudimos conectar con el estudio de ANGELUXE. Vuelve a intentarlo más tarde.', true);
  }
}

async function waitForTask(id, session) {
  const started = Date.now();
  while (Date.now() - started < 18 * 60 * 1000) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const result = await apiRequest(`/api/ange/tasks?id=${encodeURIComponent(id)}`, session);
    const task = result.task;
    $('angeProgressTitle').textContent = task.status === 'IN_PROGRESS' ? 'Dando forma a tu modelo…' : 'Preparando tu modelo…';
    $('angeProgressPercent').textContent = task.progress != null ? `${task.progress}%` : '…';
    if (task.status === 'SUCCEEDED') {
      showResult(task, id);
      setBusy(false);
      message('¡Tu modelo está listo! Revisa la estimación de material y tiempo antes de solicitar la impresión.');
      return;
    }
    if (['FAILED', 'CANCELED', 'EXPIRED'].includes(task.status)) throw new Error(task.message || 'No se pudo generar el modelo. Prueba con otra descripción o imagen.');
  }
  throw new Error('La generación sigue en curso. Vuelve a intentarlo en unos minutos desde ANGELUXE.');
}

$('angeGenerate').addEventListener('click', async () => {
  message('');
  const text = prompt.value.trim();
  if (text.length < 8) return message('Describe tu idea con al menos 8 caracteres.', true);
  if (mode === 'image' && !imageData) return message('Sube una imagen de referencia para continuar.', true);
  setBusy(true);
  try {
    const session = await getSession();
    if (!session) {
      setBusy(false);
      message('Primero regístrate con tus datos o inicia sesión para usar ANGELUXE.', true);
      $('openLogin')?.click();
      return;
    }
    const created = await apiRequest('/api/ange/tasks', session, {
      method: 'POST',
      body: JSON.stringify({ mode, prompt: text, imageData: mode === 'image' ? imageData : undefined })
    });
    $('angeProgressTitle').textContent = 'ANGELUXE está creando tu modelo…';
    $('angeProgressHint').textContent = 'La generación puede tardar unos minutos. No cierres esta pestaña.';
    await waitForTask(created.id, session);
  } catch (error) {
    setBusy(false);
    message(error.message || 'Ocurrió un error al generar el modelo.', true);
  }
});

$('angeRequestPrint').addEventListener('click', async () => {
  const button = $('angeRequestPrint');
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Guardando solicitud…';
  try {
    const session = await getSession();
    if (!session) throw new Error('Inicia sesión para solicitar esta impresión.');
    const created = await apiRequest('/api/ange/orders', session, { method: 'POST', body: JSON.stringify({ id: $('angeResult').dataset.generationId }) });
    message(created.already_requested ? 'Este modelo ya está en la cola de impresión.' : `Solicitud agregada. Estimación: S/ ${Number(created.estimated_price).toFixed(2)}.`, false);
    button.textContent = 'Solicitud enviada ✓';
  } catch (error) { message(error.message || 'No se pudo solicitar la impresión.', true); button.innerHTML = original; button.disabled = false; }
});

if (supabase) {
  supabase.auth.getSession().then(({ data: { session } }) => refreshAccess(session));
  supabase.auth.onAuthStateChange((_event, session) => { setTimeout(() => refreshAccess(session), 0); });
  $('registerSubmit').addEventListener('click', async () => {
    const first = $('registerFirst').value.trim(), last = $('registerLast').value.trim(), phone = $('registerPhone').value.trim(), email = $('loginEmail').value.trim();
    if (!first || !last || !phone || !email) return loginMessage('Completa nombre, apellido, teléfono y correo para registrarte.', true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, data: { first_name: first, last_name: last, phone }, emailRedirectTo: location.origin } });
    loginMessage(error ? error.message : 'Te enviamos un enlace de confirmación. Ábrelo desde este dispositivo para activar tu cuenta.', !!error);
  });
}

checkAvailability();

