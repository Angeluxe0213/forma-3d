# Forma — servicio de impresión 3D

Sitio estático para publicar en Render y API serverless de Vercel. Las cuentas, archivos privados, pedidos y permisos viven en Supabase.

## Antes de publicar

1. El proyecto Supabase `forma-3d` ya está creado en `sa-east-1` y el esquema ya está aplicado. Su clave pública está configurada en `config.js`; nunca se coloca `service_role` en el navegador.
2. En Supabase > **Authentication > URL Configuration**, añade la URL de Render/Vercel a Site URL y Redirect URLs (incluye `https://tu-dominio/*`). Deja habilitada la verificación de correo para proteger las cuentas.
3. Publica el repositorio GitHub en Render como **Static Site**, usando `render.yaml`; la raíz del repositorio es el directorio publicado.
4. Conecta también el repo en Vercel para desplegar la API. Configura `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `API_ALLOWED_ORIGIN=https://<nombre>.onrender.com` en Vercel. En `config.js` añade `apiBaseUrl: 'https://<proyecto>.vercel.app'`. `/api/health` debe responder JSON con `status: ok`.
5. Registra tu cuenta de administrador desde la web como cliente. Confirma el correo. En Supabase SQL Editor ejecuta `update public.profiles set role='admin' where email='tu-correo@gmail.com';`. Cierra sesión y vuelve a entrar usando **Mi cuenta** (enlace mágico). La cola aparece al iniciar sesión.

## Flujo y permisos

- El registro pide nombre, apellido, Gmail/correo y teléfono. Supabase Auth envía verificación por email. El STL elegido se conserva temporalmente en IndexedDB del mismo navegador hasta que el usuario confirme el email; al volver con sesión se carga y asocia al pedido.
- Los STL viven en un bucket privado de Supabase Storage con límite de 50 MB. Los pedidos guardan su ruta, propietario, nombre de archivo, tamaño, estimación y estado. La política RLS impide a un cliente leer pedidos ajenos. Admin puede ver la cola, cambiar estado y generar una descarga temporal firmada.
- No compartas ni publiques la clave `service_role`. La clave `anon` sí está diseñada para estar en el frontend, junto con RLS.

## Estimación

El analizador lee STL ASCII o binario y calcula volumen de malla cerrada con el teorema del volumen firmado. Si la malla está abierta, usa una aproximación conservadora basada en su caja envolvente. Convierte volumen a longitud de filamento de 1.75 mm con 20% de relleno supuesto; estima tiempo con PLA de 1.24 g/cm³ y un factor promedio de 1.9 min/g. Precio: S/ 10 por metro + S/ 0.20 por minuto. Es una referencia para cotizar, no un cálculo de slicer: perímetros, soportes, orientación, relleno, altura de capa, perfil real de la Creality K2 Combo y calibración pueden cambiar material y tiempo.

## Despliegue y dominios

Render alojará la interfaz en `https://<nombre>.onrender.com`. Vercel alojará la API en `https://<proyecto>.vercel.app`. El esquema Supabase y su clave pública ya están listos; faltan los despliegues y configurar sus dominios de Auth. Render necesita un repositorio GitHub conectado como fuente.

## Ange AI

Ange usa la API oficial de Meshy para generar modelos 3D desde texto o una imagen y solicita archivos STL y GLB. La clave de Meshy se configura únicamente como variable secreta `MESHY_API_KEY` en Vercel; nunca debe incluirse en `config.js`, el navegador o GitHub. La API requiere que el visitante inicie sesión con Supabase y limita cada cuenta a 3 generaciones por cada 24 horas. Los modelos estándar cuestan actualmente alrededor de 20 créditos por generación según la tarifa de Meshy; consulta la tarifa vigente antes de activar la clave.

La tabla protegida `public.ange_generations` conserva el propietario y el identificador de cada tarea. El archivo `supabase/ange.sql` contiene su esquema y políticas RLS. Las URLs de los modelos se entregan por Meshy y pueden caducar, por lo que el usuario debe descargar su STL cuando termine. El STL requiere revisión en Creality Print o Cura antes de imprimir.

## Límites

El pedido queda pendiente de revisión manual; no sustituye el laminador/slicer, no determina si el objeto cabe en la máquina, no detecta geometrías no imprimibles ni calcula entrega/envío. Para cobrar de verdad, añade una aceptación explícita del precio y una pasarela de pago antes de iniciar producción.

