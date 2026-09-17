import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clipboard, Loader2, RefreshCw, ReceiptText, X } from 'lucide-react';
import {
  createCancellationPayment,
  loadCancellationDebts,
  refreshCancellationPayment,
  type CancellationDebtSummary,
  type CancellationPayment,
} from '../lib/cancellation';

function brl(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function CancellationDebtPanel({
  open,
  onClose,
  onSettled,
}: {
  open: boolean;
  onClose?: () => void;
  onSettled?: () => void;
}) {
  const [summary, setSummary] = useState<CancellationDebtSummary | null>(null);
  const [payment, setPayment] = useState<CancellationPayment | null>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const firstCharge = summary?.charges[0] ?? null;

  async function refresh() {
    setLoading(true);
    setMessage('');
    try {
      const next = await loadCancellationDebts();
      setSummary(next);
      if (next.total_due <= 0) {
        setPayment(null);
        onSettled?.();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível carregar a taxa.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  async function generatePix() {
    if (!firstCharge) return;
    setPaying(true);
    setMessage('');
    try {
      setPayment(await createCancellationPayment(firstCharge.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível gerar o Pix.');
    } finally {
      setPaying(false);
    }
  }

  async function checkPix() {
    if (!payment) return;
    setChecking(true);
    setMessage('');
    try {
      const result = await refreshCancellationPayment(payment.id);
      setPayment(result.payment);
      if (result.debts) setSummary(result.debts);
      if (result.payment?.status === 'approved' || (result.debts?.total_due ?? 1) <= 0) {
        setMessage('Pagamento confirmado. Sua conta está liberada.');
        onSettled?.();
      } else {
        setMessage('O Pix ainda está aguardando confirmação.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível consultar o pagamento.');
    } finally {
      setChecking(false);
    }
  }

  const qr = useMemo(
    () => payment?.pix_qr_code_base64 ? `data:image/png;base64,${payment.pix_qr_code_base64}` : null,
    [payment?.pix_qr_code_base64],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[180] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-[30px] border border-white/10 bg-tum-dark-2 p-5 shadow-2xl sm:rounded-[30px]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-tum-yellow">TUM · Cancelamento</p>
            <h2 className="mt-1 text-xl font-black text-white">Taxa pendente</h2>
          </div>
          {onClose && !summary?.blocked && (
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-white/60">
              <X size={18} />
            </button>
          )}
        </div>

        {loading && !summary ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm font-semibold text-white/50">
            <Loader2 size={18} className="animate-spin text-tum-yellow" /> Carregando...
          </div>
        ) : summary && summary.total_due > 0 ? (
          <>
            <div className="rounded-2xl border border-tum-yellow/25 bg-tum-yellow/10 p-4">
              <p className="text-xs font-bold text-white/50">Total pendente</p>
              <p className="mt-1 text-3xl font-black text-tum-yellow">{brl(summary.total_due)}</p>
              {summary.blocked && (
                <p className="mt-2 text-xs leading-5 text-white/60">
                  Novas corridas ficam bloqueadas até a quitação da taxa pendente.
                </p>
              )}
            </div>

            {firstCharge && (
              <div className="mt-3 rounded-2xl border border-white/10 bg-tum-dark-3 p-3.5">
                <div className="flex items-start gap-3">
                  <ReceiptText size={18} className="mt-0.5 shrink-0 text-tum-yellow" />
                  <div className="min-w-0">
                    <p className="font-black text-white">{firstCharge.reason_label || 'Cancelamento de corrida'}</p>
                    <p className="mt-1 text-xs text-white/45">
                      {new Date(firstCharge.cancelled_at).toLocaleString('pt-BR')}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!payment ? (
              <button
                type="button"
                onClick={() => void generatePix()}
                disabled={paying || !firstCharge}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-tum-yellow py-3.5 font-black text-black disabled:opacity-50"
              >
                {paying ? <Loader2 size={18} className="animate-spin" /> : <ReceiptText size={18} />}
                {paying ? 'Gerando Pix...' : 'Pagar via Pix'}
              </button>
            ) : (
              <div className="mt-4">
                <div className="rounded-2xl border border-white/10 bg-white p-3">
                  {qr ? (
                    <img src={qr} alt="QR Code Pix" className="mx-auto h-52 w-52 object-contain" />
                  ) : (
                    <div className="flex h-52 items-center justify-center text-sm font-bold text-black/50">
                      Use o Pix copia e cola
                    </div>
                  )}
                </div>

                {payment.pix_qr_code && (
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(payment.pix_qr_code || '')}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-black text-white"
                  >
                    <Clipboard size={16} /> Copiar código Pix
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void checkPix()}
                  disabled={checking}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-tum-yellow py-3 text-sm font-black text-black disabled:opacity-50"
                >
                  {checking ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  {checking ? 'Consultando...' : 'Já paguei · verificar'}
                </button>
              </div>
            )}

            {message && <p className="mt-3 text-center text-xs font-semibold text-white/60">{message}</p>}
          </>
        ) : (
          <div className="py-8 text-center">
            <CheckCircle2 size={42} className="mx-auto text-emerald-400" />
            <p className="mt-3 font-black text-white">Nenhuma taxa pendente</p>
          </div>
        )}
      </div>
    </div>
  );
}
