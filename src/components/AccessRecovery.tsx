import { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, KeyRound, Loader2, Phone, ShieldCheck, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Props {
  open: boolean;
  onClose: () => void;
  initialPhone?: string;
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, '').slice(0, 11);
}

function formatPhone(value: string) {
  const digits = normalizePhone(value);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export default function AccessRecovery({ open, onClose, initialPhone = '' }: Props) {
  const [phone, setPhone] = useState(() => formatPhone(initialPhone));
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const normalized = useMemo(() => normalizePhone(phone), [phone]);

  if (!open) return null;

  async function submit() {
    setError('');
    if (normalized.length < 10) {
      setError('Informe o telefone usado no cadastro.');
      return;
    }

    setLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('request_passenger_access_recovery_tum', {
        p_phone: normalized,
      });
      if (rpcError) throw rpcError;
      if (data && typeof data === 'object' && 'success' in data && data.success === false) {
        throw new Error('Não foi possível registrar a solicitação.');
      }
      setDone(true);
    } catch (caughtError) {
      console.error('[TUM] Erro ao solicitar recuperação:', caughtError);
      setError('Não foi possível enviar sua solicitação agora. Tente novamente em instantes.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center animate-fade-in">
      <div className="tum-soft-enter w-full max-w-md rounded-t-[30px] border border-white/10 bg-tum-dark-2 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl sm:rounded-[30px]">
        <div className="mb-4 flex items-center gap-3">
          <button type="button" onClick={onClose} className="tum-press flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-tum-dark-3 text-white">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-tum-yellow">Conta TUM</p>
            <h2 className="truncate text-lg font-black text-white">Recuperar acesso</h2>
          </div>
          <button type="button" onClick={onClose} className="tum-press p-2 text-white/40" aria-label="Fechar"><X size={19} /></button>
        </div>

        {!done ? (
          <>
            <div className="mb-4 rounded-2xl border border-tum-yellow/20 bg-tum-yellow/10 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tum-yellow text-black"><KeyRound size={19} /></div>
                <div>
                  <p className="text-sm font-black text-white">Sem redefinição insegura</p>
                  <p className="mt-1 text-xs leading-5 text-white/50">O TUM registra a solicitação para que a recuperação seja tratada com validação de identidade. Informar um telefone não altera a senha automaticamente.</p>
                </div>
              </div>
            </div>

            <label className="block">
              <span className="mb-1.5 block px-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-white/45">Telefone do cadastro</span>
              <div className="flex items-center rounded-2xl border border-white/10 bg-black/20 focus-within:border-tum-yellow/55">
                <Phone size={18} className="ml-3 text-white/38" />
                <input
                  value={phone}
                  onChange={(event) => setPhone(formatPhone(event.target.value))}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(16) 99999-9999"
                  className="min-w-0 flex-1 bg-transparent px-3 py-3.5 text-sm text-white outline-none placeholder:text-white/28"
                />
              </div>
            </label>

            {error && <div className="mt-3 rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-300">{error}</div>}

            <button
              type="button"
              disabled={loading}
              onClick={() => void submit()}
              className="tum-primary-cta mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-tum-yellow py-3.5 text-sm font-black text-black disabled:opacity-50"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
              {loading ? 'Enviando...' : 'Solicitar recuperação'}
            </button>

            <p className="mt-3 text-center text-[10px] leading-4 text-white/30">Por privacidade, a resposta é a mesma mesmo quando o número informado não estiver cadastrado.</p>
          </>
        ) : (
          <div className="py-5 text-center animate-fade-in">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"><CheckCircle2 size={30} /></div>
            <h3 className="mt-4 text-lg font-black text-white">Solicitação registrada</h3>
            <p className="mx-auto mt-2 max-w-[300px] text-xs leading-5 text-white/48">Se houver uma conta correspondente, o pedido ficará disponível para o atendimento responsável pela recuperação de acesso.</p>
            <button type="button" onClick={onClose} className="tum-press mt-5 rounded-2xl bg-white/8 px-6 py-3 text-xs font-black text-white">Voltar ao login</button>
          </div>
        )}
      </div>
    </div>
  );
}
