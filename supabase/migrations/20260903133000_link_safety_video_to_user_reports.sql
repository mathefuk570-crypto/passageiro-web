alter table public.user_reports
  add column if not exists safety_recording_id uuid null references public.safety_recordings(id) on delete set null;

create index if not exists idx_user_reports_safety_recording
  on public.user_reports(safety_recording_id)
  where safety_recording_id is not null;

create or replace function public.attach_user_report_safety_recording_tum(
  p_report_id uuid,
  p_recording_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_id uuid;
  v_report public.user_reports%rowtype;
  v_recording public.safety_recordings%rowtype;
begin
  if v_uid is null then raise exception 'Usuário não autenticado.'; end if;

  select id into v_profile_id
  from public.profiles
  where auth_user_id=v_uid
  limit 1;
  if v_profile_id is null then raise exception 'Perfil não encontrado.'; end if;

  select * into v_report
  from public.user_reports
  where id=p_report_id and reporter_profile_id=v_profile_id
  for update;
  if not found then raise exception 'Denúncia não encontrada.'; end if;

  select * into v_recording
  from public.safety_recordings
  where id=p_recording_id
    and auth_user_id=v_uid
    and ride_id=v_report.ride_id
    and has_video=true
    and status<>'deleted'
  limit 1;
  if not found then raise exception 'Vídeo de segurança não encontrado para esta corrida.'; end if;

  update public.user_reports
  set safety_recording_id=v_recording.id, updated_at=now()
  where id=v_report.id;

  update public.safety_recordings
  set preserved_at=coalesce(preserved_at,now()),
      preserved_by=coalesce(preserved_by,v_uid),
      preserve_reason=coalesce(nullif(preserve_reason,''),'Vinculada à denúncia '||v_report.id::text),
      expires_at=null,
      updated_at=now()
  where id=v_recording.id;

  insert into public.safety_recording_audit(recording_id,actor_auth_user_id,actor_type,action,metadata)
  values(v_recording.id,v_uid,'owner','report_linked',jsonb_build_object('report_id',v_report.id));

  return jsonb_build_object('success',true,'report_id',v_report.id,'safety_recording_id',v_recording.id,'preserved',true);
end;
$$;

revoke all on function public.attach_user_report_safety_recording_tum(uuid,uuid) from public, anon;
grant execute on function public.attach_user_report_safety_recording_tum(uuid,uuid) to authenticated;

create or replace function public.admin_list_user_reports_tum(
  p_status text default null,
  p_search text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Acesso administrativo necessário.'; end if;
  select coalesce(jsonb_agg(item order by created_at desc),'[]'::jsonb) into v_result from (
    select jsonb_build_object(
      'id',r.id,'ride_id',r.ride_id,'city_id',r.city_id,'city_name',c.name,
      'reporter_profile_id',r.reporter_profile_id,'reporter_name',coalesce(rp.full_name,'Usuário'),'reporter_phone',rp.phone,'reporter_role',r.reporter_role,
      'reported_profile_id',r.reported_profile_id,'reported_name',coalesce(dp.full_name,'Usuário'),'reported_phone',dp.phone,'reported_role',r.reported_role,
      'reported_moderation_status',dp.moderation_status,'reported_blocked_until',dp.moderation_blocked_until,'reported_warning_count',dp.moderation_warning_count,
      'reason',r.reason,'description',r.description,'status',r.status,'admin_action',r.admin_action,'admin_notes',r.admin_notes,
      'reviewed_by',r.reviewed_by,'reviewed_by_name',a.name,'reviewed_at',r.reviewed_at,'created_at',r.created_at,
      'origin_address',ride.origin_address,'destination_address',ride.destination_address,'category',ride.category,'payment_method',ride.payment_method,'final_amount',coalesce(ride.final_amount,ride.amount),
      'evidence',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'storage_path',e.storage_path,'file_name',e.file_name,'mime_type',e.mime_type,'created_at',e.created_at) order by e.created_at) from public.user_report_evidence e where e.report_id=r.id),'[]'::jsonb),
      'safety_recording',case when sr.id is null then null else jsonb_build_object(
        'id',sr.id,'user_type',sr.user_type,'capture_mode',sr.capture_mode,'camera_facing',sr.camera_facing,'status',sr.status,
        'segment_count',sr.segment_count,'duration_seconds',sr.duration_seconds,'total_bytes',sr.total_bytes,'started_at',sr.started_at,'ended_at',sr.ended_at,'preserved_at',sr.preserved_at
      ) end
    ) item,r.created_at
    from public.user_reports r
    join public.profiles rp on rp.id=r.reporter_profile_id
    join public.profiles dp on dp.id=r.reported_profile_id
    left join public.rides ride on ride.id=r.ride_id
    left join public.cities c on c.id=r.city_id
    left join public.admins a on a.id=r.reviewed_by
    left join public.safety_recordings sr on sr.id=r.safety_recording_id
    where (p_status is null or p_status='' or p_status='all' or r.status=p_status)
      and (p_search is null or trim(p_search)='' or coalesce(rp.full_name,'') ilike '%'||trim(p_search)||'%' or coalesce(dp.full_name,'') ilike '%'||trim(p_search)||'%' or coalesce(ride.origin_address,'') ilike '%'||trim(p_search)||'%' or coalesce(ride.destination_address,'') ilike '%'||trim(p_search)||'%')
  ) q;
  return v_result;
end;
$$;

revoke all on function public.admin_list_user_reports_tum(text,text) from public, anon;
grant execute on function public.admin_list_user_reports_tum(text,text) to authenticated;
