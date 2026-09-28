import { supabase } from './supabase';

export type RidePixPayment = {
  id: string;
  ride_id: string;
  amount: number;
  status: string;
  provider_payment_id: string | null;
  pix_payload: string | null;
  pix_qr_code_base64: string | null;
  expiration_date: string | null;
  paid_at: string | null;
};

export type RidePixCheckoutResult =
  | { mode: 'direct_driver' }
  | {
      mode: 'asaas';
      environment: 'sandbox' | 'production';
      payment: RidePixPayment;
    };

async function getFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : 'Não foi possível gerar o Pix da corrida.';
  const context = (error as { context?: unknown } | null)?.context as
    | { clone?: () => Response; json?: () => Promise<unknown> }
    | undefined;

  try {
    const response = typeof context?.clone === 'function' ? context.clone() : context;
    if (response && typeof response.json === 'function') {
      const body = (await response.json()) as { error?: string } | null;
      if (body?.error) return body.error;
    }
  } catch {
    // Mantém a mensagem original do cliente Supabase quando a resposta não puder ser lida.
  }

  return fallback;
}

export async function createOrLoadRidePixCheckout(
  rideId: string,
): Promise<RidePixCheckoutResult> {
  const { data, error } = await supabase.functions.invoke('create-ride-pix-payment', {
    body: { ride_id: rideId },
  });

  if (error) {
    throw new Error(await getFunctionErrorMessage(error));
  }

  if (data?.mode === 'direct_driver') {
    return { mode: 'direct_driver' };
  }

  if (data?.mode !== 'asaas' || !data?.payment?.id) {
    throw new Error(data?.error || 'O Asaas não retornou o Pix da corrida.');
  }

  return {
    mode: 'asaas',
    environment: data.environment === 'production' ? 'production' : 'sandbox',
    payment: data.payment as RidePixPayment,
  };
}

export async function loadRidePixPayment(paymentId: string): Promise<RidePixPayment | null> {
  const { data, error } = await supabase
    .from('ride_pix_payments')
    .select(
      'id,ride_id,amount,status,provider_payment_id,pix_payload,pix_qr_code_base64,expiration_date,paid_at',
    )
    .eq('id', paymentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as RidePixPayment | null) ?? null;
}
