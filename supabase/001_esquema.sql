-- Esquema de "Gastos de casa" en Supabase.
--
-- * Todo lo que se guarda (registros y PDF) está cifrado en el navegador con la clave de datos
--   (frontend/src/vault/crypto.ts). Aquí solo hay bloques "v1.…" ilegibles.
-- * Solo los MIEMBROS de la casa con el segundo factor activo (sesión aal2) pueden leer o escribir.
--   La clave publicable no da acceso a nada.
-- * La actividad la escriben triggers (solo metadatos: quién, cuándo, qué fila); nadie la puede editar ni borrar.
--
-- Se puede ejecutar varias veces (python supabase/admin.py aplicar).

begin;

-- ---------- funciones internas (fuera de la API) ----------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ---------- miembros de la casa (alta a mano: python supabase/admin.py miembro <nombre>) ----------
create table if not exists public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null unique check (name ~ '^[a-z0-9_-]{2,32}$' and name <> 'recuperacion'),
  created_at timestamptz not null default now()
);

create or replace function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.members m where m.user_id = auth.uid());
$$;
revoke all on function private.is_member() from public, anon;
grant execute on function private.is_member() to authenticated;

-- ---------- copias envueltas de la clave de datos (una por miembro + la del código de recuperación) ----------
create table if not exists public.vault_slots (
  name text primary key check (name ~ '^[a-z0-9_-]{2,32}$'),
  user_id uuid unique references public.members (user_id) on delete cascade,
  slot jsonb not null check (slot ? 'wrapped' and slot ? 'salt' and slot ? 'iv'),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check ((name = 'recuperacion') = (user_id is null))
);

-- ---------- datos cifrados: gastos, ingresos, categorías, etiquetas, documentos, ajustes… ----------
create table if not exists public.records (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind ~ '^[a-z_]{2,32}$'),
  data text not null check (data like 'v1.%'),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index if not exists records_kind_idx on public.records (kind);

-- ---------- actividad (solo metadatos) ----------
create table if not exists public.activity (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  op text not null,
  tbl text not null,
  kind text,
  row_id text
);
create index if not exists activity_at_idx on public.activity (at desc);

-- ---------- triggers ----------
-- Sellos que el cliente no puede falsear: quién y cuándo, versión para detectar ediciones simultáneas
create or replace function private.stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_table_name = 'records' then
    if tg_op = 'INSERT' then
      new.version := 1;
    else
      if new.id <> old.id or new.kind <> old.kind then
        raise exception 'No se puede cambiar el id ni el tipo de un registro';
      end if;
      new.version := old.version + 1;
    end if;
  end if;
  return new;
end $$;

create or replace function private.log_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r_kind text;
  r_id text;
begin
  if tg_table_name = 'records' then
    if tg_op = 'DELETE' then r_kind := old.kind; r_id := old.id::text;
    else r_kind := new.kind; r_id := new.id::text; end if;
  elsif tg_op = 'DELETE' then r_id := old.name;
  else r_id := new.name;
  end if;
  insert into public.activity (user_id, op, tbl, kind, row_id)
  values (auth.uid(), case tg_op when 'INSERT' then 'alta' when 'UPDATE' then 'cambio' else 'borrado' end,
          tg_table_name, r_kind, r_id);
  return null;
end $$;
revoke all on function private.log_activity() from public, anon, authenticated;

drop trigger if exists records_stamp on public.records;
create trigger records_stamp before insert or update on public.records
  for each row execute function private.stamp();
drop trigger if exists vault_slots_stamp on public.vault_slots;
create trigger vault_slots_stamp before insert or update on public.vault_slots
  for each row execute function private.stamp();
drop trigger if exists records_log on public.records;
create trigger records_log after insert or update or delete on public.records
  for each row execute function private.log_activity();
drop trigger if exists vault_slots_log on public.vault_slots;
create trigger vault_slots_log after insert or update or delete on public.vault_slots
  for each row execute function private.log_activity();

-- ---------- permisos: nada para anon; lo justo para authenticated ----------
revoke all on public.members, public.vault_slots, public.records, public.activity from anon, authenticated;
grant select on public.members to authenticated;
grant select, insert, update on public.vault_slots to authenticated;
grant select, insert, update, delete on public.records to authenticated;
grant select on public.activity to authenticated;

alter table public.members enable row level security;
alter table public.vault_slots enable row level security;
alter table public.records enable row level security;
alter table public.activity enable row level security;

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated using (private.is_member());

-- Cada miembro ve su copia y la de recuperación; un miembro puede crear la copia de otro (al invitarle)
drop policy if exists slots_read on public.vault_slots;
create policy slots_read on public.vault_slots for select to authenticated
  using (private.is_member() and (user_id = auth.uid() or user_id is null));
drop policy if exists slots_create on public.vault_slots;
create policy slots_create on public.vault_slots for insert to authenticated
  with check (private.is_member());
drop policy if exists slots_change on public.vault_slots;
create policy slots_change on public.vault_slots for update to authenticated
  using (private.is_member() and (user_id = auth.uid() or user_id is null))
  with check (private.is_member() and (user_id = auth.uid() or user_id is null));

drop policy if exists records_all on public.records;
create policy records_all on public.records for all to authenticated
  using (private.is_member()) with check (private.is_member());

drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select to authenticated using (private.is_member());

-- ---------- PDF cifrados: almacén privado ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 26214400, array['application/octet-stream'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists documentos_read on storage.objects;
create policy documentos_read on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and private.is_member());
drop policy if exists documentos_create on storage.objects;
create policy documentos_create on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and private.is_member()
              and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
drop policy if exists documentos_change on storage.objects;
create policy documentos_change on storage.objects for update to authenticated
  using (bucket_id = 'documentos' and private.is_member())
  with check (bucket_id = 'documentos' and private.is_member());
drop policy if exists documentos_delete on storage.objects;
create policy documentos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and private.is_member());

commit;
