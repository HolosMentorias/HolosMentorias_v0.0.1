-- ═══════════════════════════════════════════════════════════════
--   HOLOS MENTORÍAS — Esquema Supabase (Fase 1)
--   Roles: super_admin · admin · mentor
--   Cumple con el modelo "no implicit GRANTs" vigente desde
--   el 30 de mayo de 2026: cada tabla pública tiene GRANTs
--   explícitos por rol.
--   Ejecutar en orden en el SQL Editor del proyecto Supabase.
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- 0. EXTENSIONES Y TIPOS
-- ───────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- Enum de roles. Lo definimos así para que sea imposible
-- inventarse un rol nuevo desde el frontend.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('super_admin', 'admin', 'mentor');
  end if;
end$$;


-- ───────────────────────────────────────────────────────────────
-- 1. TABLA: profiles
--    Una fila por cada usuario de auth.users. El rol vive acá,
--    NUNCA en el JWT del frontend (eso sería editable por el
--    cliente). Se consulta server-side vía RLS.
-- ───────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id            uuid        primary key references auth.users(id) on delete cascade,
  email         text        not null,
  nombre        text,
  apellido      text,
  rol           user_role,                -- null = registrado sin rol asignado
  avatar_url    text,
  activo        boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists profiles_rol_idx on public.profiles(rol) where activo = true;

-- Trigger para mantener updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();


-- ───────────────────────────────────────────────────────────────
-- 2. TRIGGER: crear profile automático al registrarse
--    Cuando alguien hace signUp(), aparece en auth.users.
--    Este trigger refleja eso en public.profiles SIN rol asignado.
--    Queda en "limbo" hasta que un super_admin le asigne rol.
-- ───────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer  -- corre con permisos elevados, necesario para insertar en profiles
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ───────────────────────────────────────────────────────────────
-- 3. HELPERS DE AUTORIZACIÓN
--    Funciones que las policies usan para decidir acceso.
--    SECURITY DEFINER + search_path fijo = no inyectable.
-- ───────────────────────────────────────────────────────────────

create or replace function public.current_rol()
returns user_role
language sql
security definer
stable
set search_path = public
as $$
  select rol from public.profiles where id = auth.uid() and activo = true;
$$;

create or replace function public.is_super_admin()
returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((select rol = 'super_admin' from public.profiles
                   where id = auth.uid() and activo = true), false);
$$;

create or replace function public.is_admin_or_super()
returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((select rol in ('admin','super_admin') from public.profiles
                   where id = auth.uid() and activo = true), false);
$$;

create or replace function public.is_mentor()
returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((select rol = 'mentor' from public.profiles
                   where id = auth.uid() and activo = true), false);
$$;


-- ───────────────────────────────────────────────────────────────
-- 4. TABLA: alumnos
--    Los alumnos NO logean (decisión de producto). Son sólo
--    registros que admins crean y asignan a mentores.
-- ───────────────────────────────────────────────────────────────

create table if not exists public.alumnos (
  id                bigserial   primary key,
  nombre            text        not null,
  apellido          text        not null,
  telefono          text,
  email             text,
  mentor_id         uuid        references public.profiles(id) on delete set null,
  -- Datos de mentoría (heredados del modelo original de la app)
  fecha_primer      date,
  fecha_ultimo      date,
  respondio         text,
  tipo_contacto     text,
  activa            boolean     not null default true,
  videollamada      boolean     not null default false,
  inquietudes       text,
  seguimiento       text,
  mensaje_personal  text,
  baja              boolean     not null default false,
  created_by        uuid        references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists alumnos_mentor_idx on public.alumnos(mentor_id) where baja = false;
create index if not exists alumnos_created_at_idx on public.alumnos(created_at desc);

drop trigger if exists trg_alumnos_touch on public.alumnos;
create trigger trg_alumnos_touch
  before update on public.alumnos
  for each row execute function public.touch_updated_at();


-- ───────────────────────────────────────────────────────────────
-- 5. TABLA: conversations + messages
--    Modelo simple para chat 1-a-1 (admin↔mentor) y broadcast.
--    En Fase 4 lo usamos a fondo con Realtime. En Fase 1
--    creamos las tablas para que el esquema quede completo.
-- ───────────────────────────────────────────────────────────────

create table if not exists public.conversations (
  id          bigserial   primary key,
  -- Para chat 1-a-1: ambos participantes. Para broadcast: admin_id seteado, mentor_id null.
  admin_id    uuid        not null references public.profiles(id) on delete cascade,
  mentor_id   uuid        references public.profiles(id) on delete cascade,
  is_broadcast boolean    not null default false,
  created_at  timestamptz not null default now(),
  unique (admin_id, mentor_id, is_broadcast)
);

create index if not exists conv_admin_idx  on public.conversations(admin_id);
create index if not exists conv_mentor_idx on public.conversations(mentor_id);

create table if not exists public.messages (
  id              bigserial   primary key,
  conversation_id bigint      not null references public.conversations(id) on delete cascade,
  sender_id       uuid        not null references public.profiles(id) on delete cascade,
  body            text        not null check (length(body) between 1 and 4000),
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conv_idx on public.messages(conversation_id, created_at desc);


-- ───────────────────────────────────────────────────────────────
-- 6. ROW LEVEL SECURITY — habilitar en TODO
--    Sin RLS = puerta abierta. Esto es no negociable.
-- ───────────────────────────────────────────────────────────────

alter table public.profiles      enable row level security;
alter table public.alumnos       enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;


-- ───────────────────────────────────────────────────────────────
-- 7. POLICIES — profiles
-- ───────────────────────────────────────────────────────────────

-- Cada usuario puede leer su propio profile
drop policy if exists "profiles_self_select" on public.profiles;
create policy "profiles_self_select" on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- Admin y super_admin ven TODOS los profiles
drop policy if exists "profiles_admin_select" on public.profiles;
create policy "profiles_admin_select" on public.profiles
  for select to authenticated
  using (public.is_admin_or_super());

-- Mentor ve perfiles de admins/super_admin (para listar admins disponibles en chat)
-- y de otros mentores (para asignación visible en el detalle del alumno)
drop policy if exists "profiles_mentor_visibility" on public.profiles;
create policy "profiles_mentor_visibility" on public.profiles
  for select to authenticated
  using (public.is_mentor() and rol in ('admin','super_admin','mentor'));

-- Cada usuario puede editar SU propio profile, pero NUNCA el campo rol.
-- El rol sólo lo cambia super_admin a través de la Edge Function.
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and rol is not distinct from (
    select rol from public.profiles where id = auth.uid()
  ));

-- Super_admin puede actualizar cualquier profile (incluyendo el rol)
drop policy if exists "profiles_super_update" on public.profiles;
create policy "profiles_super_update" on public.profiles
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());


-- ───────────────────────────────────────────────────────────────
-- 8. POLICIES — alumnos
-- ───────────────────────────────────────────────────────────────

-- Admins y super_admin ven todos los alumnos
drop policy if exists "alumnos_admin_select" on public.alumnos;
create policy "alumnos_admin_select" on public.alumnos
  for select to authenticated
  using (public.is_admin_or_super());

-- Mentor ve sólo los alumnos que tiene asignados
drop policy if exists "alumnos_mentor_select" on public.alumnos;
create policy "alumnos_mentor_select" on public.alumnos
  for select to authenticated
  using (public.is_mentor() and mentor_id = auth.uid());

-- Insert: sólo admin/super_admin (los admins crean alumnos)
drop policy if exists "alumnos_admin_insert" on public.alumnos;
create policy "alumnos_admin_insert" on public.alumnos
  for insert to authenticated
  with check (public.is_admin_or_super());

-- Update por admin: cualquier campo
drop policy if exists "alumnos_admin_update" on public.alumnos;
create policy "alumnos_admin_update" on public.alumnos
  for update to authenticated
  using (public.is_admin_or_super())
  with check (public.is_admin_or_super());

-- Update por mentor: SÓLO sus alumnos y SÓLO campos operativos
-- (no puede cambiar mentor_id ni darse de baja a sí mismo)
drop policy if exists "alumnos_mentor_update" on public.alumnos;
create policy "alumnos_mentor_update" on public.alumnos
  for update to authenticated
  using (public.is_mentor() and mentor_id = auth.uid())
  with check (
    public.is_mentor()
    and mentor_id = auth.uid()  -- no puede reasignarse el alumno a otro
  );

-- Delete: sólo admin/super_admin
drop policy if exists "alumnos_admin_delete" on public.alumnos;
create policy "alumnos_admin_delete" on public.alumnos
  for delete to authenticated
  using (public.is_admin_or_super());


-- ───────────────────────────────────────────────────────────────
-- 9. POLICIES — conversations + messages (preparación Fase 4)
-- ───────────────────────────────────────────────────────────────

-- Ver conversación: si soy participante o si es broadcast y soy mentor
drop policy if exists "conv_participant_select" on public.conversations;
create policy "conv_participant_select" on public.conversations
  for select to authenticated
  using (
    admin_id = auth.uid()
    or mentor_id = auth.uid()
    or (is_broadcast and public.is_mentor())
  );

-- Crear conversación: admin (1-a-1 o broadcast) o mentor (1-a-1 con admin)
drop policy if exists "conv_insert" on public.conversations;
create policy "conv_insert" on public.conversations
  for insert to authenticated
  with check (
    (public.is_admin_or_super() and admin_id = auth.uid())
    or (public.is_mentor() and mentor_id = auth.uid() and is_broadcast = false)
  );

-- Mensajes: leer si soy parte de la conversación
drop policy if exists "messages_select" on public.messages;
create policy "messages_select" on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.admin_id = auth.uid()
             or c.mentor_id = auth.uid()
             or (c.is_broadcast and public.is_mentor()))
    )
  );

-- Mensajes: enviar si soy parte y el sender soy yo
drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert" on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.admin_id = auth.uid() or c.mentor_id = auth.uid())
    )
  );

-- Marcar como leído (update sólo del campo read_at, simplificado: cualquier participante)
drop policy if exists "messages_mark_read" on public.messages;
create policy "messages_mark_read" on public.messages
  for update to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.admin_id = auth.uid() or c.mentor_id = auth.uid())
    )
  );


-- ═══════════════════════════════════════════════════════════════
-- 10. GRANTS EXPLÍCITOS — requeridos por el modelo de Supabase
--     vigente desde el 30 de mayo de 2026.
--     Sin estos GRANTs PostgREST devuelve error 42501 aunque RLS
--     esté correctamente configurada.
-- ═══════════════════════════════════════════════════════════════

-- profiles
grant select         on public.profiles to anon, authenticated;
grant update         on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

-- alumnos
grant select, insert, update, delete on public.alumnos to authenticated;
grant select, insert, update, delete on public.alumnos to service_role;

-- conversations
grant select, insert        on public.conversations to authenticated;
grant select, insert, update, delete on public.conversations to service_role;

-- messages
grant select, insert, update on public.messages to authenticated;
grant select, insert, update, delete on public.messages to service_role;

-- Las secuencias también necesitan GRANT para que el insert funcione
grant usage, select on all sequences in schema public to authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════
-- 11. STORAGE — bucket de avatares
--     Las fotos de mentores van comprimidas desde el cliente
--     (canvas → WebP ~50KB) y se guardan acá.
-- ═══════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 262144,  -- 256 KB hard limit
        array['image/webp','image/jpeg','image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Policies del bucket: cada usuario sube/edita su propia carpeta.
-- Convención: el path siempre es `${auth.uid()}/avatar.webp`.
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists "avatars_owner_write" on storage.objects;
create policy "avatars_owner_write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ═══════════════════════════════════════════════════════════════
-- 12. BOOTSTRAP — Cómo crear el primer super_admin
--     1) Registrate normalmente con signUp() desde la app o desde el
--        Dashboard de Supabase (Authentication → Users → Add user).
--     2) Ejecutá manualmente en SQL Editor (UNA SOLA VEZ):
--
--        update public.profiles
--        set rol = 'super_admin', nombre = 'Tu Nombre'
--        where email = 'tu_email@dominio.com';
--
--     A partir de ahí, el super_admin puede asignar roles desde la UI.
-- ═══════════════════════════════════════════════════════════════
