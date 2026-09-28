-- TUM · Gravação de Segurança — snapshot reproduzível do backend
-- Estado compatível com produção em 2026-09-02.
-- Requer o schema-base do TUM (auth.users, public.rides, public.profiles,
-- public.drivers e public.is_admin()).

create table if not exists public.safety_recording_settings (
  id text primary key default 'global',
  retention_days integer not null default 7 check (retention_days between 1 and 90),
  driver_enabled boolean not null default true,
  passenger_enabled boolean not null default true,
  mobile_upload_enabled boolean not null default true,
  quality_preset text not null default 'balanced' check (quality_preset in ('data_saver','balanced','clear')),
  segment_target_mb integer not null default 8 check (segment_target_mb between 4 and 20),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.safety_recording_settings(id)
values ('global') on conflict (id) do nothing;

create table if not exists public.safety_recording_preferences (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  camera_facing text not null default 'front' check (camera_facing in ('front','back')),
  capture_mode text not null default 'video_audio' check (capture_mode in ('video_audio','audio_only')),
  intro_seen boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_recordings (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  ride_id uuid not null references public.rides(id) on delete cascade,
  user_type text not null check (user_type in ('driver','passenger')),
  display_name text,
  camera_facing text not null check (camera_facing in ('front','back')),
  capture_mode text not null check (capture_mode in ('video_audio','audio_only')),
  has_video boolean not null default true,
  has_audio boolean not null default true,
  status text not null default 'recording' check (status in ('recording','uploading','ready','partial','failed','deleted')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  total_bytes bigint not null default 0 check (total_bytes >= 0),
  segment_count integer not null default 0 check (segment_count >= 0),
  expires_at timestamptz,
  preserved_at timestamptz,
  preserved_by uuid,
  preserve_reason text,
  device_platform text,
  device_model text,
  app_version text,
  origin_address text,
  destination_address text,
  city_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists safety_recordings_owner_idx on public.safety_recordings(auth_user_id, started_at desc);
create index if not exists safety_recordings_ride_idx on public.safety_recordings(ride_id, started_at desc);
create index if not exists safety_recordings_expiry_idx on public.safety_recordings(expires_at) where preserved_at is null and status <> 'deleted';

create table if not exists public.safety_recording_segments (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.safety_recordings(id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('video/mp4','audio/mp4','audio/aac')),
  byte_size bigint not null default 0 check (byte_size >= 0),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  segment_started_at timestamptz,
  segment_ended_at timestamptz,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(recording_id, sequence)
);
create index if not exists safety_recording_segments_recording_idx on public.safety_recording_segments(recording_id, sequence);

create table if not exists public.safety_recording_audit (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid references public.safety_recordings(id) on delete set null,
  actor_auth_user_id uuid not null,
  actor_type text not null check (actor_type in ('admin','owner','system')),
  action text not null check (action in ('view','download','preserve','unpreserve','delete','settings_update','cleanup')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists safety_recording_audit_recording_idx on public.safety_recording_audit(recording_id, created_at desc);

alter table public.safety_recording_settings enable row level security;
alter table public.safety_recording_preferences enable row level security;
alter table public.safety_recordings enable row level security;
alter table public.safety_recording_segments enable row level security;
alter table public.safety_recording_audit enable row level security;

-- Recreate policies idempotently.
drop policy if exists safety_settings_read_authenticated_tum on public.safety_recording_settings;
create policy safety_settings_read_authenticated_tum on public.safety_recording_settings for select to authenticated using (true);
drop policy if exists safety_settings_admin_update_tum on public.safety_recording_settings;
create policy safety_settings_admin_update_tum on public.safety_recording_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists safety_preferences_own_select_tum on public.safety_recording_preferences;
create policy safety_preferences_own_select_tum on public.safety_recording_preferences for select to authenticated using ((select auth.uid()) = auth_user_id or public.is_admin());
drop policy if exists safety_preferences_own_insert_tum on public.safety_recording_preferences;
create policy safety_preferences_own_insert_tum on public.safety_recording_preferences for insert to authenticated with check ((select auth.uid()) = auth_user_id);
drop policy if exists safety_preferences_own_update_tum on public.safety_recording_preferences;
create policy safety_preferences_own_update_tum on public.safety_recording_preferences for update to authenticated using ((select auth.uid()) = auth_user_id) with check ((select auth.uid()) = auth_user_id);

drop policy if exists safety_recordings_owner_or_admin_select_tum on public.safety_recordings;
create policy safety_recordings_owner_or_admin_select_tum on public.safety_recordings for select to authenticated using ((select auth.uid()) = auth_user_id or public.is_admin());

drop policy if exists safety_segments_owner_or_admin_select_tum on public.safety_recording_segments;
create policy safety_segments_owner_or_admin_select_tum on public.safety_recording_segments for select to authenticated using (exists(select 1 from public.safety_recordings r where r.id=recording_id and (r.auth_user_id=(select auth.uid()) or public.is_admin())));

drop policy if exists safety_audit_admin_select_tum on public.safety_recording_audit;
create policy safety_audit_admin_select_tum on public.safety_recording_audit for select to authenticated using (public.is_admin());

grant select on public.safety_recording_settings, public.safety_recording_preferences, public.safety_recordings, public.safety_recording_segments, public.safety_recording_audit to authenticated;
grant insert,update on public.safety_recording_preferences to authenticated;
grant update on public.safety_recording_settings to authenticated;

create or replace function public.get_my_safety_recording_state_tum()
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_uid uuid:=auth.uid(); v_settings public.safety_recording_settings%rowtype; v_pref public.safety_recording_preferences%rowtype;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.'; end if;
  select * into v_settings from public.safety_recording_settings where id='global';
  select * into v_pref from public.safety_recording_preferences where auth_user_id=v_uid;
  return jsonb_build_object('enabled',coalesce(v_pref.enabled,false),'camera_facing',coalesce(v_pref.camera_facing,'front'),'capture_mode',coalesce(v_pref.capture_mode,'video_audio'),'intro_seen',coalesce(v_pref.intro_seen,false),'retention_days',coalesce(v_settings.retention_days,7),'driver_enabled',coalesce(v_settings.driver_enabled,true),'passenger_enabled',coalesce(v_settings.passenger_enabled,true),'mobile_upload_enabled',coalesce(v_settings.mobile_upload_enabled,true),'quality_preset',coalesce(v_settings.quality_preset,'balanced'),'segment_target_mb',coalesce(v_settings.segment_target_mb,8));
end;$function$;

create or replace function public.update_my_safety_recording_preferences_tum(p_enabled boolean default null,p_camera_facing text default null,p_capture_mode text default null,p_intro_seen boolean default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_uid uuid:=auth.uid(); v_camera text; v_mode text;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.'; end if;
  v_camera:=case when p_camera_facing is null then null else lower(trim(p_camera_facing)) end;
  v_mode:=case when p_capture_mode is null then null else lower(trim(p_capture_mode)) end;
  if v_camera is not null and v_camera not in ('front','back') then raise exception 'Câmera inválida.'; end if;
  if v_mode is not null and v_mode not in ('video_audio','audio_only') then raise exception 'Modo de captura inválido.'; end if;
  insert into public.safety_recording_preferences(auth_user_id,enabled,camera_facing,capture_mode,intro_seen,updated_at)
  values(v_uid,coalesce(p_enabled,false),coalesce(v_camera,'front'),coalesce(v_mode,'video_audio'),coalesce(p_intro_seen,false),now())
  on conflict(auth_user_id) do update set enabled=coalesce(p_enabled,public.safety_recording_preferences.enabled),camera_facing=coalesce(v_camera,public.safety_recording_preferences.camera_facing),capture_mode=coalesce(v_mode,public.safety_recording_preferences.capture_mode),intro_seen=coalesce(p_intro_seen,public.safety_recording_preferences.intro_seen),updated_at=now();
  return public.get_my_safety_recording_state_tum();
end;$function$;

create or replace function public.start_safety_recording_tum(p_ride_id uuid,p_camera_facing text default 'front',p_capture_mode text default 'video_audio',p_device_platform text default null,p_device_model text default null,p_app_version text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_uid uuid:=auth.uid(); v_ride public.rides%rowtype; v_profile public.profiles%rowtype; v_driver public.drivers%rowtype; v_settings public.safety_recording_settings%rowtype; v_type text; v_name text; v_recording public.safety_recordings%rowtype; v_camera text:=lower(trim(coalesce(p_camera_facing,'front'))); v_mode text:=lower(trim(coalesce(p_capture_mode,'video_audio')));
begin
  if v_uid is null then raise exception 'Usuário não autenticado.'; end if;
  if p_ride_id is null then raise exception 'Corrida inválida.'; end if;
  if v_camera not in ('front','back') then raise exception 'Câmera inválida.'; end if;
  if v_mode not in ('video_audio','audio_only') then raise exception 'Modo de captura inválido.'; end if;
  select * into v_ride from public.rides where id=p_ride_id limit 1;
  if not found then raise exception 'Corrida não encontrada.'; end if;
  if v_ride.status not in ('accepted','driver_arrived','arrived','waiting','started','in_progress') then raise exception 'A gravação de segurança só pode ser iniciada durante uma corrida ativa.'; end if;
  select * into v_profile from public.profiles where auth_user_id=v_uid order by created_at desc limit 1;
  if found and v_ride.passenger_id=v_profile.id then v_type:='passenger'; v_name:=coalesce(nullif(trim(v_profile.full_name),''),'Passageiro TUM');
  else
    select * into v_driver from public.drivers where id=v_uid limit 1;
    if found and v_driver.profile_id=v_ride.driver_id then v_type:='driver'; v_name:=coalesce(nullif(trim(v_driver.full_name),''),'Motorista TUM'); else raise exception 'Você não participa desta corrida.'; end if;
  end if;
  select * into v_settings from public.safety_recording_settings where id='global';
  if v_type='driver' and not coalesce(v_settings.driver_enabled,true) then raise exception 'Gravação de segurança indisponível para motoristas.'; end if;
  if v_type='passenger' and not coalesce(v_settings.passenger_enabled,true) then raise exception 'Gravação de segurança indisponível para passageiros.'; end if;
  if exists(select 1 from public.safety_recordings r where r.auth_user_id=v_uid and r.ride_id=p_ride_id and r.status='recording') then raise exception 'Já existe uma gravação em andamento nesta corrida.'; end if;
  insert into public.safety_recordings(auth_user_id,ride_id,user_type,display_name,camera_facing,capture_mode,has_video,has_audio,status,expires_at,device_platform,device_model,app_version,origin_address,destination_address,city_id)
  values(v_uid,p_ride_id,v_type,v_name,v_camera,v_mode,v_mode='video_audio',true,'recording',now()+make_interval(days=>coalesce(v_settings.retention_days,7)),nullif(trim(coalesce(p_device_platform,'')),''),nullif(trim(coalesce(p_device_model,'')),''),nullif(trim(coalesce(p_app_version,'')),''),v_ride.origin_address,v_ride.destination_address,v_ride.city_id) returning * into v_recording;
  return jsonb_build_object('id',v_recording.id,'ride_id',v_recording.ride_id,'user_type',v_recording.user_type,'camera_facing',v_recording.camera_facing,'capture_mode',v_recording.capture_mode,'started_at',v_recording.started_at,'expires_at',v_recording.expires_at,'segment_target_mb',coalesce(v_settings.segment_target_mb,8),'quality_preset',coalesce(v_settings.quality_preset,'balanced'),'mobile_upload_enabled',coalesce(v_settings.mobile_upload_enabled,true));
end;$function$;

create or replace function public.stop_safety_recording_tum(p_recording_id uuid,p_ended_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_uid uuid:=auth.uid(); v_row public.safety_recordings%rowtype;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.'; end if;
  update public.safety_recordings set ended_at=coalesce(ended_at,coalesce(p_ended_at,now())),duration_seconds=greatest(0,extract(epoch from (coalesce(ended_at,coalesce(p_ended_at,now()))-started_at))::integer),status=case when segment_count>0 then 'uploading' else 'partial' end,updated_at=now() where id=p_recording_id and auth_user_id=v_uid and status in ('recording','uploading','partial') returning * into v_row;
  if not found then raise exception 'Gravação não encontrada.'; end if; return to_jsonb(v_row);
end;$function$;

create or replace function public.register_safety_recording_segment_tum(p_recording_id uuid,p_sequence integer,p_storage_path text,p_mime_type text,p_byte_size bigint,p_duration_ms integer default 0,p_segment_started_at timestamptz default null,p_segment_ended_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path to 'public','storage','pg_temp' as $function$
declare v_uid uuid:=auth.uid(); v_recording public.safety_recordings%rowtype; v_path text:=trim(coalesce(p_storage_path,'')); v_mime text:=lower(trim(coalesce(p_mime_type,'')));
begin
  if v_uid is null then raise exception 'Usuário não autenticado.'; end if;
  select * into v_recording from public.safety_recordings where id=p_recording_id for update;
  if not found or v_recording.auth_user_id<>v_uid then raise exception 'Gravação não encontrada.'; end if;
  if p_sequence is null or p_sequence<0 then raise exception 'Sequência inválida.'; end if;
  if v_mime not in ('video/mp4','audio/mp4','audio/aac') then raise exception 'Formato inválido.'; end if;
  if p_byte_size is null or p_byte_size<1 then raise exception 'Arquivo vazio.'; end if;
  if v_path not like v_uid::text||'/'||p_recording_id::text||'/%' then raise exception 'Caminho de arquivo inválido.'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='safety-recordings' and o.name=v_path) then raise exception 'Arquivo ainda não foi enviado para a nuvem.'; end if;
  insert into public.safety_recording_segments(recording_id,sequence,storage_path,mime_type,byte_size,duration_ms,segment_started_at,segment_ended_at)
  values(p_recording_id,p_sequence,v_path,v_mime,p_byte_size,greatest(coalesce(p_duration_ms,0),0),p_segment_started_at,p_segment_ended_at)
  on conflict(recording_id,sequence) do update set storage_path=excluded.storage_path,mime_type=excluded.mime_type,byte_size=excluded.byte_size,duration_ms=excluded.duration_ms,segment_started_at=excluded.segment_started_at,segment_ended_at=excluded.segment_ended_at,uploaded_at=now();
  update public.safety_recordings r set status=case when r.ended_at is null then 'recording' else 'uploading' end,segment_count=(select count(*) from public.safety_recording_segments s where s.recording_id=r.id),total_bytes=(select coalesce(sum(s.byte_size),0) from public.safety_recording_segments s where s.recording_id=r.id),updated_at=now() where r.id=p_recording_id;
  return jsonb_build_object('success',true,'recording_id',p_recording_id,'sequence',p_sequence);
end;$function$;

create or replace function public.complete_safety_recording_tum(p_recording_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_uid uuid:=auth.uid(); v_row public.safety_recordings%rowtype;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.'; end if;
  update public.safety_recordings set status=case when segment_count>0 then 'ready' else 'failed' end,ended_at=coalesce(ended_at,now()),duration_seconds=greatest(0,extract(epoch from (coalesce(ended_at,now())-started_at))::integer),updated_at=now() where id=p_recording_id and auth_user_id=v_uid and status in ('recording','uploading','partial','failed') returning * into v_row;
  if not found then raise exception 'Gravação não encontrada.'; end if; return to_jsonb(v_row);
end;$function$;

create or replace function public.preserve_my_safety_recording_tum(p_recording_id uuid,p_preserve boolean default true,p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_uid uuid:=auth.uid(); v_row public.safety_recordings%rowtype;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.'; end if;
  update public.safety_recordings set preserved_at=case when p_preserve then coalesce(preserved_at,now()) else null end,preserved_by=case when p_preserve then v_uid else null end,preserve_reason=case when p_preserve then left(nullif(trim(coalesce(p_reason,'')),''),500) else null end,expires_at=case when p_preserve then null else now()+make_interval(days=>(select retention_days from public.safety_recording_settings where id='global')) end,updated_at=now() where id=p_recording_id and auth_user_id=v_uid and status<>'deleted' returning * into v_row;
  if not found then raise exception 'Gravação não encontrada.'; end if;
  insert into public.safety_recording_audit(recording_id,actor_auth_user_id,actor_type,action) values(p_recording_id,v_uid,'owner',case when p_preserve then 'preserve' else 'unpreserve' end); return to_jsonb(v_row);
end;$function$;

create or replace function public.mark_my_safety_recording_deleted_tum(p_recording_id uuid)
returns boolean language plpgsql security definer set search_path to 'public','storage','pg_temp' as $function$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then raise exception 'Usuário não autenticado.'; end if;
  if exists(select 1 from public.safety_recordings where id=p_recording_id and auth_user_id=v_uid and preserved_at is not null) then raise exception 'Gravação preservada não pode ser excluída.'; end if;
  if exists(select 1 from storage.objects where bucket_id='safety-recordings' and name like v_uid::text||'/'||p_recording_id::text||'/%') then raise exception 'Exclua primeiro os arquivos da gravação.'; end if;
  update public.safety_recordings set status='deleted',updated_at=now() where id=p_recording_id and auth_user_id=v_uid; if not found then return false; end if;
  insert into public.safety_recording_audit(recording_id,actor_auth_user_id,actor_type,action) values(p_recording_id,v_uid,'owner','delete'); return true;
end;$function$;

create or replace function public.admin_preserve_safety_recording_tum(p_recording_id uuid,p_preserve boolean default true,p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_uid uuid:=auth.uid(); v_row public.safety_recordings%rowtype;
begin
  if v_uid is null or not public.is_admin() then raise exception 'Acesso não autorizado.'; end if;
  update public.safety_recordings set preserved_at=case when p_preserve then coalesce(preserved_at,now()) else null end,preserved_by=case when p_preserve then v_uid else null end,preserve_reason=case when p_preserve then left(nullif(trim(coalesce(p_reason,'')),''),500) else null end,expires_at=case when p_preserve then null else now()+make_interval(days=>(select retention_days from public.safety_recording_settings where id='global')) end,updated_at=now() where id=p_recording_id and status<>'deleted' returning * into v_row;
  if not found then raise exception 'Gravação não encontrada.'; end if;
  insert into public.safety_recording_audit(recording_id,actor_auth_user_id,actor_type,action) values(p_recording_id,v_uid,'admin',case when p_preserve then 'preserve' else 'unpreserve' end); return to_jsonb(v_row);
end;$function$;

create or replace function public.admin_log_safety_recording_access_tum(p_recording_id uuid,p_action text)
returns boolean language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_uid uuid:=auth.uid(); v_action text:=lower(trim(coalesce(p_action,'')));
begin
  if v_uid is null or not public.is_admin() then raise exception 'Acesso não autorizado.'; end if;
  if v_action not in ('view','download') then raise exception 'Ação inválida.'; end if;
  if not exists(select 1 from public.safety_recordings where id=p_recording_id) then raise exception 'Gravação não encontrada.'; end if;
  insert into public.safety_recording_audit(recording_id,actor_auth_user_id,actor_type,action) values(p_recording_id,v_uid,'admin',v_action); return true;
end;$function$;

create or replace function public.admin_update_safety_recording_settings_tum(p_retention_days integer,p_driver_enabled boolean,p_passenger_enabled boolean,p_mobile_upload_enabled boolean,p_quality_preset text,p_segment_target_mb integer)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_uid uuid:=auth.uid(); v_row public.safety_recording_settings%rowtype; v_quality text:=lower(trim(coalesce(p_quality_preset,'')));
begin
  if v_uid is null or not public.is_admin() then raise exception 'Acesso não autorizado.'; end if;
  if p_retention_days not between 1 and 90 then raise exception 'Retenção deve ficar entre 1 e 90 dias.'; end if;
  if v_quality not in ('data_saver','balanced','clear') then raise exception 'Qualidade inválida.'; end if;
  if p_segment_target_mb not between 4 and 20 then raise exception 'Tamanho de segmento inválido (4 a 20 MB).'; end if;
  update public.safety_recording_settings set retention_days=p_retention_days,driver_enabled=p_driver_enabled,passenger_enabled=p_passenger_enabled,mobile_upload_enabled=p_mobile_upload_enabled,quality_preset=v_quality,segment_target_mb=p_segment_target_mb,updated_at=now(),updated_by=v_uid where id='global' returning * into v_row;
  insert into public.safety_recording_audit(recording_id,actor_auth_user_id,actor_type,action,metadata) values(null,v_uid,'admin','settings_update',jsonb_build_object('retention_days',p_retention_days,'quality_preset',v_quality,'segment_target_mb',p_segment_target_mb)); return to_jsonb(v_row);
end;$function$;

-- RPC exposure: authenticated/service_role only. Resolve full signatures so this remains safe if names become overloaded.
do $do$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('get_my_safety_recording_state_tum','update_my_safety_recording_preferences_tum','start_safety_recording_tum','stop_safety_recording_tum','register_safety_recording_segment_tum','complete_safety_recording_tum','preserve_my_safety_recording_tum','mark_my_safety_recording_deleted_tum','admin_preserve_safety_recording_tum','admin_log_safety_recording_access_tum','admin_update_safety_recording_settings_tum')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;$do$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('safety-recordings','safety-recordings',false,33554432,array['video/mp4','audio/mp4','audio/aac'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists safety_recordings_storage_insert_tum on storage.objects;
create policy safety_recordings_storage_insert_tum on storage.objects for insert to authenticated with check (bucket_id='safety-recordings' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.safety_recordings r where r.id::text=(storage.foldername(name))[2] and r.auth_user_id=(select auth.uid()) and r.status in ('recording','uploading','partial','failed')));
drop policy if exists safety_recordings_storage_select_tum on storage.objects;
create policy safety_recordings_storage_select_tum on storage.objects for select to authenticated using (bucket_id='safety-recordings' and ((storage.foldername(name))[1]=(select auth.uid())::text or public.is_admin()));
drop policy if exists safety_recordings_storage_delete_tum on storage.objects;
create policy safety_recordings_storage_delete_tum on storage.objects for delete to authenticated using (bucket_id='safety-recordings' and (public.is_admin() or ((storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.safety_recordings r where r.id::text=(storage.foldername(name))[2] and r.auth_user_id=(select auth.uid()) and r.preserved_at is null))));
