import { supabase } from './supabase';

export interface CancellationReason {
  code: string;
  label: string;
  description: string | null;
  fee_exempt: boolean;
  sort_order: number;
}

export interface CancellationCharge {
  id: string;
  ride_id: string;
  fee_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: string;
  reason_label: string | null;
  cancelled_at: string;
  due_at: string | null;
  driver_share_amount: number;
}

export interface CancellationDebtSummary {
  total_due: number;
  blocked: boolean;
  charges: CancellationCharge[];
}

export interface CancellationResult {
  success?: boolean;
  status?: string;
  message?: string;
  ride_id?: string;
  charged?: boolean;
  charge_id?: string | null;
  fee_amount?: number;
  driver_share_amount?: number;
  reason_label?: string;
}

export interface CancellationPayment {
  id: string;
  charge_id: string;
  amount: number;
  status: string;
  provider_payment_id: string | null;
  pix_qr_code: string | null;
  pix_qr_code_base64: string | null;
  ticket_url: string | null;
  expires_at: string | null;
  created_at: string;
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function loadCancellationReasons(): Promise<CancellationReason[]> {
  const { data, error } = await supabase.rpc('get_my_cancellation_reasons_tum');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    code: String(row.code ?? ''),
    label: String(row.label ?? ''),
    description: typeof row.description === 'string' ? row.description : null,
    fee_exempt: Boolean(row.fee_exempt),
    sort_order: num(row.sort_order),
  }));
}

export async function loadCancellationDebts(): Promise<CancellationDebtSummary> {
  const { data, error } = await supabase.rpc('get_my_cancellation_debts_tum');
  if (error) throw new Error(error.message);

  const raw = (data ?? {}) as Record<string, unknown>;
  const chargesRaw = Array.isArray(raw.charges) ? raw.charges : [];

  return {
    total_due: num(raw.total_due),
    blocked: Boolean(raw.blocked),
    charges: chargesRaw.map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        id: String(row.id ?? ''),
        ride_id: String(row.ride_id ?? ''),
        fee_amount: num(row.fee_amount),
        paid_amount: num(row.paid_amount),
        remaining_amount: num(row.remaining_amount),
        status: String(row.status ?? 'pending'),
        reason_label: typeof row.reason_label === 'string' ? row.reason_label : null,
        cancelled_at: String(row.cancelled_at ?? new Date().toISOString()),
        due_at: typeof row.due_at === 'string' ? row.due_at : null,
        driver_share_amount: num(row.driver_share_amount),
      };
    }),
  };
}

export async function cancelRideWithReason(
  rideId: string,
  reasonCode: string,
  reasonNote?: string,
): Promise<CancellationResult> {
  const { data, error } = await supabase.rpc('cancel_passenger_ride_with_reason_tum', {
    p_ride_id: rideId,
    p_reason_code: reasonCode,
    p_reason_note: reasonNote?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return (data ?? {}) as CancellationResult;
}

export async function createCancellationPayment(
  chargeId: string,
): Promise<CancellationPayment> {
  const { data, error } = await supabase.functions.invoke('create-cancellation-payment', {
    body: { charge_id: chargeId },
  });
  if (error) throw new Error(error.message || 'Não foi possível gerar o Pix.');
  if (!data?.payment) throw new Error(data?.error || 'O Mercado Pago não retornou o Pix.');
  return data.payment as CancellationPayment;
}

export async function refreshCancellationPayment(
  paymentId: string,
): Promise<{ payment: CancellationPayment | null; debts: CancellationDebtSummary | null }> {
  const { data, error } = await supabase.functions.invoke('refresh-cancellation-payment', {
    body: { payment_id: paymentId },
  });
  if (error) throw new Error(error.message || 'Não foi possível consultar o Pix.');
  return {
    payment: (data?.payment as CancellationPayment | null) ?? null,
    debts: (data?.debts as CancellationDebtSummary | null) ?? null,
  };
}
