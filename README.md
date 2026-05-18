# Holos Mentorías — Fase 1

Plataforma de gestión de mentorías con roles **super_admin · admin · mentor**.
Stack: HTML/CSS/JS vanilla · Supabase (Auth + Postgres + Storage + Edge Functions) · Cloudflare Pages.

## Estructura

```
holos/
├── index.html              ← UI (login, pending, app con vistas por rol)
├── styles.css              ← estética HOLOS (paleta original + extensiones)
├── app.js                  ← lógica cliente, router por rol, RLS-aware
├── README.md               ← este archivo
└── supabase/
    ├── schema.sql          ← ejecutar en SQL Editor (todo el esquema + RLS + GRANTs)
    └── functions/
        └── admin-operations/
            └── index.ts    ← Edge Function (única que toca service_role)
```

## Modelo de seguridad — lo que tenés que entender antes de tocar nada

1. **`SUPABASE_URL` y `SUPABASE_ANON_KEY` son públicas y van en el frontend.**
   Lo que las protege no es ocultarlas, sino las **policies RLS** en Postgres.
2. **`SUPABASE_SERVICE_ROLE_KEY` NUNCA va al frontend.**
   Sólo vive como variable de entorno de la Edge Function `admin-operations`.
3. El **rol** del usuario (`super_admin/admin/mentor`) vive en `public.profiles.rol`.
   El frontend lo lee para mostrar la UI correcta, pero **no decide nada de seguridad**:
   cada query se valida server-side contra RLS.
4. Las operaciones privilegiadas (asignar rol, desactivar usuario, borrar usuario)
   no se hacen con queries directas — pasan por la Edge Function que **verifica el JWT
   del que llama y comprueba que sea super_admin** antes de actuar.

## Despliegue paso a paso

### 1) Crear proyecto Supabase

1. https://supabase.com/dashboard → New Project. Anotá la región más cercana a tus usuarios.
2. Una vez creado, andá a **Settings → API** y anotá:
   - `Project URL` → será `SUPABASE_URL`
   - `anon public` → será `SUPABASE_ANON_KEY` (pública, OK que vaya al front)
   - `service_role` → **NUNCA al front**. Sólo para la Edge Function.

### 2) Aplicar el schema

1. En el dashboard de Supabase, abrí **SQL Editor → New query**.
2. Pegá el contenido de `supabase/schema.sql` y ejecutá.
3. Verificá que no haya errores. Vas a tener:
   - Tablas: `profiles`, `alumnos`, `conversations`, `messages`
   - Funciones: `is_super_admin()`, `is_admin_or_super()`, `is_mentor()`, `current_rol()`
   - Trigger automático que crea un profile por cada signup
   - Bucket `avatars` con policies de storage
   - GRANTs explícitos (cumple el modelo Supabase del 30/may/2026)

### 3) Crear el primer super_admin

1. Registrate desde la app (o desde **Authentication → Users → Add user** del dashboard).
2. Volvé al **SQL Editor** y ejecutá UNA VEZ:
   ```sql
   update public.profiles
   set rol = 'super_admin', nombre = 'Tu Nombre'
   where email = 'tu_email@dominio.com';
   ```
3. Iniciá sesión: ya entrás como super_admin y podés asignar roles desde la UI.

### 4) Desplegar la Edge Function

Necesitás el [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF      # el ref está en Settings → General
supabase functions deploy admin-operations
```

La función queda en `https://TU_PROJECT_REF.supabase.co/functions/v1/admin-operations`.
**No necesita variables adicionales**: Supabase inyecta automáticamente `SUPABASE_URL`,
`SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` en su entorno.

Importante: en `supabase/config.toml` (o en el dashboard → Edge Functions → admin-operations
→ Details), **dejá `verify_jwt = true`**. La función hace su propia verificación pero
el doble check de Supabase no molesta.

### 5) Conectar GitHub

```bash
cd holos
git init
git add .
git commit -m "Holos Mentorías — Fase 1"
git remote add origin git@github.com:tu-usuario/holos-mentorias.git
git push -u origin main
```

**No commitees credenciales reales**: el `index.html` que se subió tiene un placeholder
`REEMPLAZAR_EN_BUILD`. Las variables reales se inyectan en Cloudflare (paso siguiente).

### 6) Desplegar en Cloudflare Pages

1. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → elegí el repo.
2. Build settings:
   - **Framework preset**: None
   - **Build command**:
     ```sh
     sed -i "s|REEMPLAZAR_EN_BUILD|$SUPABASE_ANON_KEY|g" index.html
     sed -i "s|https://qhawykutieqkxcexlrco.supabase.co|$SUPABASE_URL|g" index.html
     ```
   - **Build output directory**: `/` (la raíz del repo)
3. Environment variables (Production y Preview):
   - `SUPABASE_URL` → tu Project URL
   - `SUPABASE_ANON_KEY` → tu anon public key
4. Deploy. Cloudflare te da un dominio `*.pages.dev`. Después podés agregar el dominio
   propio en Custom domains.

### 7) Ajustar CORS de la Edge Function al dominio real

Una vez tengas el dominio definitivo, editá `supabase/functions/admin-operations/index.ts`
y reemplazá `"Access-Control-Allow-Origin": "*"` por tu dominio (`https://holos.tu-dominio.com`).
Redesplegá la función. Esto cierra el agujero de que cualquier sitio del mundo pueda
intentar hablar con la función (RLS y verificación de JWT igual la protegerían, pero
defensa en profundidad).

## Verificación rápida (smoke test)

Una vez desplegado:
1. Registrate como nuevo usuario → debería mostrar pantalla "cuenta pendiente".
2. Con el super_admin, asignale rol **admin** → al recargar entra al dashboard admin.
3. Como admin, creá un alumno y asignalo a un mentor.
4. Logueate como ese mentor → ve sólo a ese alumno.
5. Como admin, abrí la pestaña Mentores → "Informe PDF" → se descarga el PDF.
6. Tratá de hacer `curl` directo a la REST API con la anon key intentando leer alumnos
   sin estar autenticado → debería devolver array vacío (RLS te filtra todo). Si
   devuelve datos, hay un problema.

## Qué viene en las próximas fases

- **Fase 2**: pulir UX de asignación de alumnos (reasignación rápida masiva), historial de cambios.
- **Fase 3**: el informe PDF ya está hecho. Falta agregar firma del admin viéndolo.
- **Fase 4**: centro de mensajes (broadcast + chat 1-a-1) con Supabase Realtime.
- **Fase 5**: testing E2E, ajustes de responsive en notebook.

## Problemas comunes

- **"42501" en alguna query** → falta el `GRANT` en `schema.sql`. El error te dice
  exactamente qué grant ejecutar.
- **"permission denied for table"** → RLS está negando. Revisá la policy
  correspondiente.
- **El trigger no creó el profile** → puede ser que el trigger no se haya creado
  porque ya existía. Ejecutá `drop trigger if exists trg_on_auth_user_created on auth.users;`
  y volvé a correr el bloque del trigger.
- **La Edge Function devuelve 401** → falta el header `Authorization: Bearer ...`
  con el JWT del usuario. Lo manda `app.js` automáticamente; si falla, revisá
  que la sesión esté activa.
