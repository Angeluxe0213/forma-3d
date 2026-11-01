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

function setBusy(busy) {
  $('angeGenerate').disabled = busy;
  $('angeGenerate').querySelector('span:first-child').textContent = busy ? 'Ange está creando…' : 'Generar modelo';
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
  preview.alt = 'Imagen de referencia para Ange';
  $('angeImagePreview').append(preview);
  $('angeImagePreview').hidden = false;
  message('Imagen lista. Añade una descripción si quieres orientar el resultado.');
});

async function getSession() {
  if (!supabase) throw new Error('El acceso a Ange necesita que Supabase esté configurado.');
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function apiRequest(path, session, options = {}) {
  if (!API_BASE) throw new Error('Falta configurar el backend de Ange en Vercel.');
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${session.access_token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Ange no pudo completar la solicitud.');
  return payload;
}

function showResult(task) {
  const urls = task.model_urls || {};
  $('angeViewer').src = urls.glb || '';
  $('angeDownloadStl').href = urls.stl || '#';
  $('angeDownloadGlb').href = urls.glb || '#';
  $('angeDownloadStl').hidden = !urls.stl;
  $('angeDownloadGlb').hidden = !urls.glb;
  $('angeResult').hidden = false;
  $('angeProgress').hidden = true;
}

async function checkAvailability() {
  if (!API_BASE) {
    $('angeGenerate').disabled = true;
    message('Ange se habilitará cuando se conecte el servicio de generación.', true);
    return;
  }
  try {
    const response = await fetch(`${API_BASE}/api/ange/status`, { cache: 'no-store' });
    const state = await response.json();
    if (!response.ok || !state.configured) {
      $('angeGenerate').disabled = true;
      message('Ange estará disponible en breve; el estudio todavía se está configurando.', true);
    }
  } catch {
    $('angeGenerate').disabled = true;
    message('No pudimos conectar con el estudio de Ange. Vuelve a intentarlo más tarde.', true);
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
      showResult(task);
      message('¡Tu modelo está listo! Descarga el STL y revísalo en tu laminador antes de imprimir.');
      return;
    }
    if (['FAILED', 'CANCELED', 'EXPIRED'].includes(task.status)) throw new Error(task.message || 'No se pudo generar el modelo. Prueba con otra descripción o imagen.');
  }
  throw new Error('La generación sigue en curso. Vuelve a intentarlo en unos minutos desde Ange.');
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
      message('Inicia sesión en “Mi cuenta” para generar y guardar tus modelos.', true);
      $('openLogin')?.click();
      return;
    }
    const created = await apiRequest('/api/ange/tasks', session, {
      method: 'POST',
      body: JSON.stringify({ mode, prompt: text, imageData: mode === 'image' ? imageData : undefined })
    });
    $('angeProgressTitle').textContent = 'Ange está creando tu modelo…';
    $('angeProgressHint').textContent = 'La generación puede tardar unos minutos. No cierres esta pestaña.';
    await waitForTask(created.id, session);
  } catch (error) {
    setBusy(false);
    message(error.message || 'Ocurrió un error al generar el modelo.', true);
  }
});

checkAvailability();

