-- MILA: partituras e imágenes de cada persona, sincronizadas entre dispositivos.
-- Cada fila es una partitura completa (el mismo JSON que guarda el iPad). Solo su dueña puede leerla o cambiarla.

create table if not exists public.scores (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at bigint not null,
  updated_at bigint not null,
  -- Borrada en otro dispositivo: se conserva la marca para que los demás también la borren.
  deleted boolean not null default false,
  primary key (user_id, id)
);

create index if not exists scores_user_updated on public.scores (user_id, updated_at desc);

alter table public.scores enable row level security;

drop policy if exists "scores: leer las propias" on public.scores;
create policy "scores: leer las propias" on public.scores
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "scores: crear las propias" on public.scores;
create policy "scores: crear las propias" on public.scores
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "scores: cambiar las propias" on public.scores;
create policy "scores: cambiar las propias" on public.scores
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "scores: borrar las propias" on public.scores;
create policy "scores: borrar las propias" on public.scores
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Imágenes de las partituras escaneadas: bucket privado, una carpeta por persona (<user_id>/<imageId>).
insert into storage.buckets (id, name, public, file_size_limit)
values ('mila-images', 'mila-images', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "mila-images: leer las propias" on storage.objects;
create policy "mila-images: leer las propias" on storage.objects
  for select to authenticated
  using (bucket_id = 'mila-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "mila-images: subir las propias" on storage.objects;
create policy "mila-images: subir las propias" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mila-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "mila-images: cambiar las propias" on storage.objects;
create policy "mila-images: cambiar las propias" on storage.objects
  for update to authenticated
  using (bucket_id = 'mila-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "mila-images: borrar las propias" on storage.objects;
create policy "mila-images: borrar las propias" on storage.objects
  for delete to authenticated
  using (bucket_id = 'mila-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
