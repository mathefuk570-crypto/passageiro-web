-- Backend already applied in production on 08/09/2026.
-- Keeps repository aligned with the queued-route privacy fields and live/final fare consistency.

create or replace function public.get_passenger_ride_details(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_result jsonb;
begin
 if auth.uid() is null then raise exception 'Usuário não autenticado.'; end if;
 select jsonb_build_object(
  'ride',to_jsonb(ride)||jsonb_build_object(
    'queue_position',case when ride.status='queued' then (select count(*)::integer from public.rides q where q.driver_id=ride.driver_id and q.status='queued' and (coalesce(q.queued_at,q.created_at),q.id)<=(coalesce(ride.queued_at,ride.created_at),ride.id)) else null end,
    'queue_total',case when ride.status='queued' then (select count(*)::integer from public.rides q where q.driver_id=ride.driver_id and q.status='queued') else null end,
    'queue_current_origin_lat',case when ride.status='queued' then active_ride.origin_lat else null end,
    'queue_current_origin_lng',case when ride.status='queued' then active_ride.origin_lng else null end,
    'queue_current_destination_lat',case when ride.status='queued' then active_ride.destination_lat else null end,
    'queue_current_destination_lng',case when ride.status='queued' then active_ride.destination_lng else null end,
    'queue_current_status',case when ride.status='queued' then active_ride.status else null end,
    'queue_after_current_estimated_minutes',case when ride.status='queued' then public.estimate_queue_after_current_minutes_tum(ride.id) else null end
  ),
  'stops',coalesce((select jsonb_agg(to_jsonb(s) order by s.stop_order) from public.ride_stops s where s.ride_id=ride.id),'[]'::jsonb),
  'driver',case when driver_profile.id is null then null else jsonb_build_object(
    'id',coalesce(driver_location.id::text,driver_profile.id::text),'driver_id',driver_profile.auth_user_id,'driver_profile_id',driver_profile.id,
    'driver_name',coalesce(driver_account.full_name,driver_profile.full_name),'driver_phone',coalesce(driver_account.phone,driver_profile.phone),
    'category',coalesce(driver_location.category,ride.category),'vehicle_model',coalesce(driver_location.vehicle_model,driver_account.vehicle_model),'plate',coalesce(driver_location.plate,driver_account.vehicle_plate),
    'latitude',driver_location.latitude,'longitude',driver_location.longitude,'is_online',coalesce(driver_location.is_online,false),'updated_at',driver_location.updated_at,
    'location_sampled_at',driver_location.location_sampled_at,'heading_degrees',driver_location.heading_degrees,'speed_mps',driver_location.speed_mps,'accuracy_m',driver_location.accuracy_m,
    'profile_photo_url',coalesce(driver_account.profile_photo_url,driver_account.avatar_url,driver_profile.avatar_url),'pix_key',driver_account.pix_key) end
 ) into v_result
 from public.rides ride
 join public.profiles passenger on passenger.id=ride.passenger_id
 left join public.profiles driver_profile on driver_profile.id=ride.driver_id
 left join public.drivers driver_account on driver_account.id=driver_profile.auth_user_id
 left join lateral(select location.* from public.driver_locations location where location.driver_id=driver_profile.auth_user_id order by coalesce(location.location_sampled_at,location.updated_at) desc limit 1) driver_location on true
 left join lateral(
   select ar.origin_lat, ar.origin_lng, ar.destination_lat, ar.destination_lng, ar.status
   from public.rides ar
   where ar.driver_id=ride.driver_id and ar.id<>ride.id
     and ar.status in ('accepted','driver_arrived','arrived','waiting','started','in_progress')
   order by coalesce(ar.started_at,ar.accepted_at,ar.created_at) desc, ar.id desc limit 1
 ) active_ride on true
 where ride.id=p_ride_id and passenger.auth_user_id=auth.uid() limit 1;
 if v_result is null then raise exception 'Corrida não encontrada.'; end if; return v_result;
end;
$function$;

-- In update_driver_ride_stage(action='complete'), production now uses:
-- if coalesce(v_point_count,0) < 1 then v_actual_distance := coalesce(v_ride.distance_km,0); end if;
-- Previously it used < 2, which replaced a valid one-sample/zero-movement live fare with the estimated route distance.

do $migration$
declare
  v_oid oid;
  v_definition text;
  v_old text := 'if coalesce(v_point_count,0) < 2 then v_actual_distance := coalesce(v_ride.distance_km,0); end if;';
  v_new text := 'if coalesce(v_point_count,0) < 1 then v_actual_distance := coalesce(v_ride.distance_km,0); end if;';
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='update_driver_ride_stage'
  order by p.oid
  limit 1;

  if v_oid is null then
    raise exception 'Função update_driver_ride_stage não encontrada.';
  end if;

  select pg_get_functiondef(v_oid) into v_definition;
  if position(v_new in v_definition)>0 then
    return;
  end if;
  if position(v_old in v_definition)=0 then
    raise exception 'Trecho esperado da regra de fallback do preço não foi encontrado.';
  end if;

  execute replace(v_definition,v_old,v_new);
end;
$migration$;
