create or replace function public.get_shared_ride_by_token_tum(p_token text)
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'ride_id', r.id,
    'status', r.status,
    'queue_position', case when r.status='queued' then (
      select count(*)::integer from public.rides q
      where q.driver_id=r.driver_id and q.status='queued'
        and (coalesce(q.queued_at,q.created_at),q.id) <= (coalesce(r.queued_at,r.created_at),r.id)
    ) else null end,
    'queue_after_current_estimated_minutes', case when r.status='queued' then public.estimate_queue_after_current_minutes_tum(r.id) else null end,
    'category', r.category,
    'created_at', r.created_at,
    'accepted_at', r.accepted_at,
    'started_at', r.started_at,
    'completed_at', r.completed_at,
    'origin_address', r.origin_address,
    'origin_lat', r.origin_lat,
    'origin_lng', r.origin_lng,
    'destination_address', r.destination_address,
    'destination_lat', r.destination_lat,
    'destination_lng', r.destination_lng,
    'queue_current_origin_lat', case when r.status='queued' then active_ride.origin_lat else null end,
    'queue_current_origin_lng', case when r.status='queued' then active_ride.origin_lng else null end,
    'queue_current_destination_lat', case when r.status='queued' then active_ride.destination_lat else null end,
    'queue_current_destination_lng', case when r.status='queued' then active_ride.destination_lng else null end,
    'queue_current_status', case when r.status='queued' then active_ride.status else null end,
    'driver_name', nullif(trim(d.full_name), ''),
    'driver_photo', coalesce(nullif(trim(d.profile_photo_url), ''), nullif(trim(d.avatar_url), '')),
    'vehicle_model', coalesce(nullif(trim(d.vehicle_model), ''), nullif(trim(d.vehicle_brand), '')),
    'vehicle_plate', nullif(trim(d.vehicle_plate), ''),
    'latitude', case when r.status in ('queued','accepted','driver_arrived','arrived','waiting','started','in_progress') then dl.latitude else null end,
    'longitude', case when r.status in ('queued','accepted','driver_arrived','arrived','waiting','started','in_progress') then dl.longitude else null end,
    'location_updated_at', case when r.status in ('queued','accepted','driver_arrived','arrived','waiting','started','in_progress') then dl.updated_at else null end,
    'expires_at', rst.expires_at
  )
  from public.ride_share_tokens rst
  join public.rides r on r.id=rst.ride_id
  left join public.drivers d on d.profile_id=r.driver_id
  left join lateral (
    select loc.latitude,loc.longitude,loc.updated_at
    from public.driver_locations loc
    where loc.driver_id=d.id
    order by coalesce(loc.location_sampled_at,loc.updated_at) desc limit 1
  ) dl on true
  left join lateral (
    select ar.origin_lat,ar.origin_lng,ar.destination_lat,ar.destination_lng,ar.status
    from public.rides ar
    where ar.driver_id=r.driver_id and ar.id<>r.id
      and ar.status in ('accepted','driver_arrived','arrived','waiting','started','in_progress')
    order by coalesce(ar.started_at,ar.accepted_at,ar.created_at) desc,ar.id desc limit 1
  ) active_ride on true
  where rst.token=p_token and rst.revoked_at is null and rst.expires_at>now()
  limit 1;
$function$;
