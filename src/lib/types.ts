export type Category = string;

export interface Profile {
  id: string;
  auth_user_id: string | null;
  full_name: string;
  phone: string;
  phone_normalized: string | null;
  cpf: string;
  email: string | null;
  password_hash?: string | null;
  avatar_url: string | null;
  role: string;
  created_at: string;
  city_id: string | null;
  alert_audio_mode?: 'voice' | 'sound' | 'off' | null;
}


export interface SavedPlace {
  id: string;
  passenger_id: string;
  place_type: 'home' | 'work' | 'favorite';
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  created_at: string;
  updated_at: string;
}


export interface TrustedContact {
  id: string;
  passenger_id: string;
  name: string;
  phone: string;
  relationship: string | null;
  created_at: string;
  updated_at: string;
}

export interface City {
  id: string;
  name: string;
  state: string | null;
  active: boolean;
}

export interface DriverLocation {
  id: string;
  driver_id: string;
  driver_profile_id?: string | null;
  driver_name: string | null;
  driver_phone?: string | null;
  category: Category;
  vehicle_model: string | null;
  plate: string | null;
  latitude: number;
  longitude: number;
  is_online: boolean;
  updated_at: string;
  location_sampled_at?: string | null;
  heading_degrees?: number | null;
  speed_mps?: number | null;
  accuracy_m?: number | null;
  profile_photo_url?: string | null;
  pix_key?: string | null;
}

export interface Banner {
  id: string;
  campaign_name: string | null;
  image_url: string;
  redirect_link: string | null;
  display_time_seconds: number | null;
  active: boolean;
  city_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  priority: number | null;
}

export interface Coupon {
  id: string;
  code: string;
  discount_percent: number;
  active: boolean;
  expires_at: string | null;
}

export type RideStatus =
  | 'searching'
  | 'accepted'
  | 'queued'
  | 'driver_arrived'
  | 'arrived'
  | 'waiting'
  | 'started'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_drivers';

export interface RideStop {
  id: string;
  ride_id: string;
  stop_order: number;
  address: string;
  latitude: number;
  longitude: number;
  status: 'pending' | 'waiting' | 'completed';
  arrived_at: string | null;
  waiting_started_at: string | null;
  departed_at: string | null;
  waiting_minutes: number;
  billable_waiting_minutes: number;
  waiting_fee: number;
  fixed_fee: number;
  created_at?: string;
  updated_at?: string;
}

export interface Ride {
  id: string;
  passenger_id: string;
  driver_id: string | null;
  city_id: string | null;
  category: Category;
  status: RideStatus;

  origin_address: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  destination_address: string | null;
  destination_lat: number | null;
  destination_lng: number | null;

  distance_km: number | null;
  duration_minutes: number | null;
  actual_distance_km?: number | null;
  actual_duration_minutes?: number | null;

  amount: number | null;
  discount_amount: number | null;
  final_amount: number | null;
  coupon_code: string | null;
  payment_method: string;

  pricing_base_price?: number | null;
  pricing_price_per_km?: number | null;
  pricing_price_per_minute?: number | null;
  pricing_minimum_fare?: number | null;
  pricing_waiting_fee_per_minute?: number | null;
  pricing_free_waiting_minutes?: number | null;
  pricing_multiplier?: number | null;
  stop_count?: number | null;
  direct_distance_km?: number | null;
  direct_duration_minutes?: number | null;
  pricing_stops_enabled?: boolean | null;
  pricing_max_stops?: number | null;
  pricing_stop_pricing_mode?: 'route' | 'fixed' | null;
  pricing_fixed_stop_fee?: number | null;
  stops_fee?: number | null;
  stop_waiting_minutes?: number | null;
  stop_waiting_fee?: number | null;

  waiting_minutes?: number | null;
  waiting_fee?: number | null;

  created_at: string;
  dispatch_started_at?: string | null;
  dispatch_finished_at?: string | null;
  accepted_at: string | null;
  arrived_at: string | null;
  waiting_started_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  queued_at?: string | null;
  queue_activated_at?: string | null;
  queue_position?: number | null;
  queue_total?: number | null;
  queue_current_origin_lat?: number | null;
  queue_current_origin_lng?: number | null;
  queue_current_destination_lat?: number | null;
  queue_current_destination_lng?: number | null;
  queue_current_status?: RideStatus | null;
  queue_after_current_estimated_minutes?: number | null;

  // Compatibilidade temporária com componentes e registros antigos.
  driver_name?: string | null;
  driver_photo?: string | null;
  car_model?: string | null;
  plate?: string | null;
  driver_pix_key?: string | null;
  rating?: number | null;
  rating_comment?: string | null;
  origin?: string | null;
  destination?: string | null;
  price?: number | null;
  discount?: number | null;
  final_price?: number | null;
  finished_at?: string | null;
}

export interface PassengerRideDetails {
  ride: Ride;
  driver: DriverLocation | null;
  stops: RideStop[];
}

export interface ChatMessage {
  id: string;
  ride_id: string;
  sender_type: 'passenger' | 'driver';
  sender_id: string | null;
  text: string | null;
  audio_url: string | null;
  created_at: string;
}

export interface PaymentMethod {
  id: string;
  passenger_id: string;
  holder_name: string;
  cpf: string;
  brand: string | null;
  last4: string | null;
  valid_until: string | null;
  security_code: string | null;
  address: string | null;
  mp_token: string | null;
  created_at: string;
}

export interface Address {
  place_name: string;
  coordinates: [number, number];
}