-- Applied to production on 2026-09-02.
-- Keeps MediaRecorder segment targets below the Storage hard ceiling, with headroom
-- for container finalization bytes, and increases the private bucket ceiling.
create or replace function public.admin_update_safety_recording_settings_tum(
  p_retention_days integer,
  p_driver_enabled boolean,
  p_passenger_enabled boolean,
  p_mobile_upload_enabled boolean,
  p_quality_preset text,
  p_segment_target_mb integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_row public.safety_recording_settings%rowtype;
  v_quality text := lower(trim(coalesce(p_quality_preset,'')));
begin
  if v_uid is null or not public.is_admin() then raise exception 'Acesso não autorizado.'; end if;
  if p_retention_days not between 1 and 90 then raise exception 'Retenção deve ficar entre 1 e 90 dias.'; end if;
  if v_quality not in ('data_saver','balanced','clear') then raise exception 'Qualidade inválida.'; end if;
  if p_segment_target_mb not between 4 and 20 then raise exception 'Tamanho de segmento inválido (4 a 20 MB).'; end if;

  update public.safety_recording_settings set
    retention_days=p_retention_days,
    driver_enabled=p_driver_enabled,
    passenger_enabled=p_passenger_enabled,
    mobile_upload_enabled=p_mobile_upload_enabled,
    quality_preset=v_quality,
    segment_target_mb=p_segment_target_mb,
    updated_at=now(),
    updated_by=v_uid
  where id='global' returning * into v_row;

  insert into public.safety_recording_audit(recording_id,actor_auth_user_id,actor_type,action,metadata)
  values (null,v_uid,'admin','settings_update',jsonb_build_object('retention_days',p_retention_days,'quality_preset',v_quality,'segment_target_mb',p_segment_target_mb));
  return to_jsonb(v_row);
end;
$function$;

update storage.buckets
set file_size_limit = 33554432
where id = 'safety-recordings';
