create or replace function public.get_passenger_live_ride_fare(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_passenger_profile_id uuid;
  v_ride public.rides%rowtype;
  v_actual_distance numeric := 0;
  v_actual_duration numeric := 0;
  v_travel_duration numeric := 0;
  v_base numeric := 0;
  v_per_km numeric := 0;
  v_per_minute numeric := 0;
  v_minimum numeric := 0;
  v_wait_per_minute numeric := 0;
  v_free_wait numeric := 0;
  v_multiplier numeric := 1;
  v_waiting_minutes numeric := 0;
  v_waiting_fee numeric := 0;
  v_stop_waiting_minutes numeric := 0;
  v_stop_waiting_fee numeric := 0;
  v_stops_fee numeric := 0;
  v_charge_distance numeric := 0;
  v_charge_duration numeric := 0;
  v_gross numeric := 0;
  v_discount_rate numeric := 0;
  v_current numeric := 0;
begin
  if auth.uid() is null then raise exception 'Usuário não autenticado.'; end if;

  select profile.id into v_passenger_profile_id
  from public.profiles profile
  where profile.auth_user_id=auth.uid() and profile.role='passenger'
  limit 1;
  if v_passenger_profile_id is null then raise exception 'Perfil do passageiro não encontrado.'; end if;

  select ride.* into v_ride
  from public.rides ride
  where ride.id=p_ride_id
    and ride.passenger_id=v_passenger_profile_id
    and ride.status in ('started','in_progress')
  limit 1;

  if not found then
    return jsonb_build_object('success',false,'message','A viagem ainda não está em andamento.');
  end if;

  with ordered_points as (
    select latitude, longitude,
      lag(latitude) over(order by recorded_at,id) previous_latitude,
      lag(longitude) over(order by recorded_at,id) previous_longitude
    from public.ride_location_points
    where ride_id=p_ride_id
  ), segments as (
    select 6371*2*asin(sqrt(least(1,greatest(0,
      power(sin(radians(latitude-previous_latitude)/2),2)
      + cos(radians(previous_latitude))*cos(radians(latitude))*power(sin(radians(longitude-previous_longitude)/2),2)
    )))) distance_km
    from ordered_points
    where previous_latitude is not null and previous_longitude is not null
  )
  select coalesce(sum(distance_km),0) into v_actual_distance from segments;

  v_actual_duration := greatest(0,extract(epoch from (now()-coalesce(v_ride.started_at,now())))/60);

  v_base := coalesce(v_ride.pricing_base_price,0);
  v_per_km := coalesce(v_ride.pricing_price_per_km,0);
  v_per_minute := coalesce(v_ride.pricing_price_per_minute,0);
  v_minimum := coalesce(v_ride.pricing_minimum_fare,0);
  v_wait_per_minute := coalesce(v_ride.pricing_waiting_fee_per_minute,0);
  v_free_wait := coalesce(v_ride.pricing_free_waiting_minutes,0);
  v_multiplier := greatest(coalesce(v_ride.pricing_multiplier,1),1);

  if v_base=0 and v_per_km=0 and v_per_minute=0 then
    select coalesce(pricing.base_price,0),coalesce(pricing.price_per_km,0),coalesce(pricing.price_per_minute,0),coalesce(pricing.minimum_fare,0),coalesce(pricing.waiting_fee_per_minute,0),coalesce(pricing.free_waiting_minutes,0),greatest(coalesce(pricing.dynamic_multiplier,1),1)
    into v_base,v_per_km,v_per_minute,v_minimum,v_wait_per_minute,v_free_wait,v_multiplier
    from public.category_pricing pricing
    join public.categories category on category.id=pricing.category_id
    where pricing.city_id=v_ride.city_id
      and category.name=v_ride.category
      and pricing.active=true
      and category.active=true
    limit 1;
  end if;

  v_waiting_minutes := coalesce(v_ride.waiting_minutes,0);
  v_waiting_fee := greatest(v_waiting_minutes-v_free_wait,0)*v_wait_per_minute;

  select
    coalesce(sum(case when s.status='waiting' and s.waiting_started_at is not null then greatest(0,extract(epoch from (now()-s.waiting_started_at))/60) else coalesce(s.waiting_minutes,0) end),0),
    coalesce(sum(case when s.status='waiting' and s.waiting_started_at is not null then greatest(greatest(0,extract(epoch from (now()-s.waiting_started_at))/60)-v_free_wait,0)*v_wait_per_minute else coalesce(s.waiting_fee,0) end),0),
    coalesce(sum(coalesce(s.fixed_fee,0)),0)
  into v_stop_waiting_minutes,v_stop_waiting_fee,v_stops_fee
  from public.ride_stops s
  where s.ride_id=p_ride_id;

  v_travel_duration := greatest(v_actual_duration-v_stop_waiting_minutes,0);

  if coalesce(v_ride.stop_count,0)>0 and v_ride.pricing_stop_pricing_mode='fixed' then
    v_charge_distance := coalesce(v_ride.direct_distance_km,v_ride.distance_km,v_actual_distance,0);
    v_charge_duration := coalesce(v_ride.direct_duration_minutes,v_ride.duration_minutes,v_travel_duration,0);
    v_stops_fee := coalesce(v_ride.stops_fee,v_stops_fee,0);
  else
    v_charge_distance := v_actual_distance;
    v_charge_duration := v_travel_duration;
    v_stops_fee := 0;
  end if;

  v_gross := greatest((v_base+v_charge_distance*v_per_km+v_charge_duration*v_per_minute)*v_multiplier,v_minimum)
    + v_waiting_fee + coalesce(v_stops_fee,0) + coalesce(v_stop_waiting_fee,0);

  v_discount_rate := case when coalesce(v_ride.amount,0)>0 then least(greatest(coalesce(v_ride.discount_amount,0)/v_ride.amount,0),1) else 0 end;
  v_current := greatest(v_gross*(1-v_discount_rate),0);

  return jsonb_build_object(
    'success',true,
    'ride_id',p_ride_id,
    'current_amount',round(v_current,2),
    'actual_distance_km',round(v_actual_distance,3),
    'actual_duration_minutes',round(v_actual_duration,2),
    'travel_duration_minutes',round(v_travel_duration,2),
    'waiting_fee',round(v_waiting_fee,2),
    'stop_waiting_fee',round(v_stop_waiting_fee,2)
  );
end;
$$;

revoke all on function public.get_passenger_live_ride_fare(uuid) from public, anon;
grant execute on function public.get_passenger_live_ride_fare(uuid) to authenticated;
