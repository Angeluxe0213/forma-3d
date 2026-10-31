import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = window.FORMA_CONFIG?.supabaseUrl || '';
const SUPABASE_ANON_KEY = window.FORMA_CONFIG?.supabaseAnonKey || '';
const API_BASE = (window.FORMA_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');
const sb = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = (id) => document.getElementById(id);
const input = $('fileInput');
const drop = $('dropzone');
let selectedFile = null;
let estimate = null;
const pendingKey='forma-pending-order';
function saveDraft(file, data){return new Promise((resolve,reject)=>{const req=indexedDB.open('forma-drafts',1);req.onupgradeneeded=()=>req.result.createObjectStore('files');req.onsuccess=()=>{const db=req.result,tx=db.transaction('files','readwrite');tx.objectStore('files').put(file,'pending');tx.oncomplete=()=>{localStorage.setItem(pendingKey,JSON.stringify(data));resolve();};tx.onerror=()=>reject(tx.error);};req.onerror=()=>reject(req.error);});}
function readDraft(){return new Promise((resolve,reject)=>{const req=indexedDB.open('forma-drafts',1);req.onupgradeneeded=()=>req.result.createObjectStore('files');req.onsuccess=()=>{const tx=req.result.transaction('files','readonly'),get=tx.objectStore('files').get('pending');get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error);};req.onerror=()=>reject(req.error);});}
async function finishPendingOrder(user){
  let data;try{data=JSON.parse(localStorage.getItem(pendingKey)||'null');}catch{return;}
  if(!data||data.email.toLowerCase()!==user.email.toLowerCase())return;
  const file=await readDraft(); if(!file)return;
  const path=`${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  const up=await sb.storage.from('stl-files').upload(path,file,{contentType:'model/stl',upsert:false});
  if(up.error){showMessage('formMessage',`No se pudo subir tu STL: ${up.error.message}`,true);return;}
  const order=await sb.from('orders').insert({user_id:user.id,file_path:path,file_name:file.name,file_bytes:file.size,...data.estimate,material:'PLA',status:'pending'});
  if(order.error){showMessage('formMessage',`El STL se subió, pero falló el registro: ${order.error.message}`,true);return;}
  localStorage.removeItem(pendingKey);const db=indexedDB.open('forma-drafts',1);db.onsuccess=()=>db.result.transaction('files','readwrite').objectStore('files').delete('pending');
  showMessage('formMessage','¡Listo! Recibimos tu archivo. Te contactaremos para confirmar la cotización.');
}

// STL volume -> approximate filament length (1.75 mm), then a deliberately
// conservative material/throughput estimate. Admin confirms all slicer settings.
async function stlVolume(file) {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  let triangles = [];
  if (buffer.byteLength >= 84) {
    const count = view.getUint32(80, true);
    if (84 + count * 50 === buffer.byteLength) {
      let offset = 84;
      for (let i=0;i<count;i++,offset+=50) {
        triangles.push([1,2,3].map(j=>[view.getFloat32(offset+12+j*12,true),view.getFloat32(offset+16+j*12,true),view.getFloat32(offset+20+j*12,true)]));
      }
    }
  }
  if (!triangles.length) {
    const text = new TextDecoder().decode(buffer);
    const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
    let m, verts=[];
    while ((m=re.exec(text))) { verts.push([+m[1],+m[2],+m[3]]); if(verts.length===3){triangles.push(verts);verts=[];} }
  }
  if (!triangles.length) throw new Error('No se pudieron leer los triángulos del STL.');
  let signed=0, points=[];
  for (const t of triangles) { const [a,b,c]=t; points.push(...t); signed += (a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6; }
  let volume=Math.abs(signed);
  if (volume < 0.01) {
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for(const [x,y,z] of points){minX=Math.min(minX,x);minY=Math.min(minY,y);minZ=Math.min(minZ,z);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);maxZ=Math.max(maxZ,z);}
    volume=(maxX-minX)*(maxY-minY)*(maxZ-minZ)*0.15;
  }
  return volume;
}
function showMessage(id, text, bad=false){ const el=$(id); el.textContent=text; el.style.color=bad?'#ae4934':''; }
function formatTime(min){ const h=Math.floor(min/60),m=Math.ceil(min%60); return h?`${h} h ${m} min`:`${m} min`; }
async function chooseFile(file){
  if(!file)return;
  if(!file.name.toLowerCase().endsWith('.stl')) return showMessage('formMessage','Por ahora solo aceptamos archivos .STL.',true);
  if(file.size>50*1024*1024) return showMessage('formMessage','El archivo supera el límite de 50 MB.',true);
  selectedFile=file; showMessage('formMessage','');
  $('fileInfo').hidden=false; $('fileInfo').textContent=`${file.name} · ${(file.size/1024/1024).toFixed(2)} MB`;
  $('estimate').hidden=false; $('filamentOut').textContent='Calculando…'; $('timeOut').textContent='…';
  try {
    const mm3=await stlVolume(file), cm3=mm3/1000, density=1.24, filamentMm=mm3*0.2/(Math.PI*Math.pow(1.75/2,2));
    const filamentM=filamentMm/1000, minutes=Math.max(8,Math.ceil(cm3*density*1.9)), price=filamentM*10+minutes*.2;
    estimate={filament_m:+filamentM.toFixed(2),time_minutes:minutes,estimated_price:+price.toFixed(2),volume_cm3:+cm3.toFixed(2)};
    $('filamentOut').textContent=`${estimate.filament_m} m`; $('timeOut').textContent=formatTime(minutes); $('priceOut').textContent=`S/ ${price.toFixed(2)}`;
  } catch(e){ $('filamentOut').textContent='—'; $('timeOut').textContent='—'; showMessage('formMessage',e.message,true); }
}
$('browseFile').addEventListener('click',()=>input.click()); drop.addEventListener('click',(e)=>{if(e.target.id!=='browseFile')input.click()});
input.addEventListener('change',()=>chooseFile(input.files[0]));
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover')}); drop.addEventListener('dragleave',()=>drop.classList.remove('dragover')); drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragover');chooseFile(e.dataTransfer.files[0])});
$('openLogin').addEventListener('click',()=> $('loginDialog').showModal());
$('loginSubmit').addEventListener('click',async e=>{e.preventDefault(); if(!sb)return showMessage('loginMessage','La aplicación necesita configuración de Supabase.',true); const email=$('loginEmail').value.trim(); if(!email)return; const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin}}); showMessage('loginMessage',error?error.message:'Revisa tu correo: te enviamos un enlace seguro para ingresar.',!!error);});
$('submitOrder').addEventListener('click',async()=>{
  const first=$('firstName').value.trim(),last=$('lastName').value.trim(),email=$('email').value.trim(),phone=$('phone').value.trim();
  if(!first||!last||!email||!phone||!selectedFile) return showMessage('formMessage','Completa tus datos y elige un archivo STL.',true);
  if(!estimate)return showMessage('formMessage','No pudimos calcular el STL. Prueba con otro archivo.',true);
  if(!sb)return showMessage('formMessage','Falta conectar el proyecto a Supabase. Revisa el archivo README.',true);
  await saveDraft(selectedFile,{email,first,last,phone,estimate});
  const {data,error}=await sb.auth.signUp({email,password:crypto.randomUUID()+'A!9',options:{data:{first_name:first,last_name:last,phone},emailRedirectTo:location.origin}});
  if(error)return showMessage('formMessage',error.message,true);
  if(data.session){await finishPendingOrder(data.user);await renderAdmin();}
  else showMessage('formMessage','Cuenta creada. Confirma tu correo desde el enlace enviado. Conservamos tu STL en este navegador y lo subiremos al volver con tu sesión iniciada.');
});

// Administrator panel: enabled only for a user whose profiles.role is admin.
async function renderAdmin(){
  if(!sb)return; const {data:{session}}=await sb.auth.getSession(); if(!session)return;
  const {data:profile}=await sb.from('profiles').select('role').eq('id',session.user.id).maybeSingle();
  if(profile?.role!=='admin')return;
  let panel=document.getElementById('adminPanel'); if(!panel){panel=document.createElement('section');panel.id='adminPanel';panel.className='admin-panel';document.querySelector('main').prepend(panel);}
  panel.innerHTML='<div><small>FORMA / ADMIN</small><h2>Cola de <em>impresión.</em></h2></div><div class="admin-orders">Cargando pedidos…</div><button id="adminRefresh" class="button button-dark">Actualizar cola ↻</button>';
  const load=async()=>{const wrap=panel.querySelector('.admin-orders');const {data:{session:current}}=await sb.auth.getSession();const response=await fetch(`${API_BASE}/api/admin/orders`,{headers:{Authorization:`Bearer ${current.access_token}`}});const payload=await response.json();if(!response.ok){wrap.textContent=payload.error||'No se pudo cargar la cola.';return;}const orders=payload.orders;wrap.innerHTML=orders.length?orders.map(o=>`<article class="admin-order"><div><small>${new Date(o.created_at).toLocaleString('es-PE')} · ${o.status.toUpperCase()}</small><h3>${escapeHtml(o.file_name)}</h3><p>${escapeHtml(o.profiles?.first_name||'')} ${escapeHtml(o.profiles?.last_name||'')} · ${escapeHtml(o.profiles?.email||'')} · ${escapeHtml(o.profiles?.phone||'')}</p></div><div class="admin-stats">${o.filament_m} m<br>${formatTime(o.time_minutes)}<br>S/ ${Number(o.estimated_price).toFixed(2)}</div><a class="admin-download" href="${o.download_url||'#'}" download="${escapeHtml(o.file_name)}" target="_blank" rel="noopener">Descargar ↓</a><select data-status="${o.id}"><option value="pending" ${o.status==='pending'?'selected':''}>pending</option><option value="approved" ${o.status==='approved'?'selected':''}>approved</option><option value="printing" ${o.status==='printing'?'selected':''}>printing</option><option value="done" ${o.status==='done'?'selected':''}>done</option></select></article>`).join(''):'Todavía no hay pedidos.';wrap.querySelectorAll('select').forEach(s=>s.onchange=async()=>{const {data:{session:active}}=await sb.auth.getSession();const changed=await fetch(`${API_BASE}/api/admin/orders`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${active.access_token}`},body:JSON.stringify({id:s.dataset.status,status:s.value})});if(!changed.ok){const msg=await changed.json();alert(msg.error||'No se pudo actualizar el pedido.');}});};
  await load(); panel.querySelector('#adminRefresh').onclick=load;
}
function escapeHtml(s=''){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
if(sb){sb.auth.onAuthStateChange((event,session)=>{if(session?.user){setTimeout(()=>{finishPendingOrder(session.user);renderAdmin();},0);}});renderAdmin();}
