import { supabase } from './supabase';
import type { DriverLocation, Ride, TrustedContact } from './types';

export const MAX_TRUSTED_CONTACTS = 3;

const RIDE_SHARE_FUNCTION_URL =
  'https://tum-acompanhar.pages.dev';

type RideShareTokenRow = {
  token: string;
  expires_at: string;
};

export async function createRideShareLink(rideId: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_my_ride_share_tum', {
    p_ride_id: rideId,
  });

  if (error) throw error;

  const row = (Array.isArray(data) ? data[0] : data) as RideShareTokenRow | null;
  if (!row?.token) {
    throw new Error('Não foi possível criar o link seguro da corrida.');
  }

  return `${RIDE_SHARE_FUNCTION_URL}?token=${encodeURIComponent(row.token)}`;
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

export function formatTrustedPhone(value: string): string {
  const digits = normalizePhone(value);
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;

  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }

  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }

  return value;
}

export function phoneForWhatsApp(value: string): string {
  const digits = normalizePhone(value);
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  return `55${digits}`;
}

export async function loadTrustedContacts(passengerId: string): Promise<TrustedContact[]> {
  const { data, error } = await supabase
    .from('passenger_trusted_contacts')
    .select('*')
    .eq('passenger_id', passengerId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data as TrustedContact[]) ?? [];
}

export async function saveTrustedContact(input: {
  passengerId: string;
  id?: string | null;
  name: string;
  phone: string;
  relationship?: string | null;
}): Promise<TrustedContact> {
  const payload = {
    passenger_id: input.passengerId,
    name: input.name.trim(),
    phone: normalizePhone(input.phone),
    relationship: input.relationship?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data, error } = await supabase
      .from('passenger_trusted_contacts')
      .update(payload)
      .eq('id', input.id)
      .eq('passenger_id', input.passengerId)
      .select('*')
      .single();

    if (error) throw error;
    return data as TrustedContact;
  }

  const { data, error } = await supabase
    .from('passenger_trusted_contacts')
    .insert(payload)
    .select('*')
    .single();

  if (error) throw error;
  return data as TrustedContact;
}

export async function deleteTrustedContact(passengerId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('passenger_trusted_contacts')
    .delete()
    .eq('id', id)
    .eq('passenger_id', passengerId);

  if (error) throw error;
}

function rideStatusForShare(status: Ride['status']): string {
  if (status === 'queued') return 'motorista confirmado, finalizando outra corrida';
  if (status === 'accepted') return 'motorista a caminho';
  if (['driver_arrived', 'arrived', 'waiting'].includes(status)) return 'motorista no embarque';
  if (['started', 'in_progress'].includes(status)) return 'viagem em andamento';
  if (status === 'completed') return 'viagem concluída';
  return 'corrida ativa';
}

export function buildRideShareMessage(
  ride: Ride,
  driver: DriverLocation | null,
  shareUrl?: string | null,
): string {
  const driverName = driver?.driver_name?.trim() || ride.driver_name?.trim() || 'Motorista confirmado';
  const vehicle = driver?.vehicle_model?.trim() || ride.car_model?.trim() || 'Veículo confirmado';
  const plate = driver?.plate?.trim() || ride.plate?.trim() || 'placa não informada';
  const origin = ride.origin_address || ride.origin || 'Embarque não informado';
  const destination = ride.destination_address || ride.destination || 'Destino não informado';

  const lines = [
    'Estou em uma corrida pelo TUM 🌪️',
    `Status: ${rideStatusForShare(ride.status)}.`,
    `Motorista: ${driverName}.`,
    `Veículo: ${vehicle} · ${plate.toUpperCase()}.`,
    `Embarque: ${origin}.`,
    `Destino: ${destination}.`,
    `Corrida: ${ride.id.slice(0, 8).toUpperCase()}.`,
  ];

  if (shareUrl) {
    lines.push(
      '',
      'Acompanhe a corrida em tempo real:',
      shareUrl,
      'O link abre o mapa TUM em tempo real. Se o motorista estiver finalizando outra corrida, você verá a posição atual e a rota sem expor o endereço do outro passageiro.',
    );
  } else {
    lines.push('Confira esses dados comigo durante a viagem.');
  }

  return lines.join('\n');
}
