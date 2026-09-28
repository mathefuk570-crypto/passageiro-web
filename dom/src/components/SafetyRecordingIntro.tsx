import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

export default function SafetyRecordingIntro({
  open,
  busy,
  onActivate,
  onLater,
}: {
  open: boolean;
  busy: boolean;
  onActivate: () => void;
  onLater: () => void;
}) {
  const [seconds, setSeconds] = useState(10);

  useEffect(() => {
    if (!open) return;
    setSeconds(10);
    const timer = window.setInterval(() => {
      setSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  if (!open) return null;
  const locked = busy || seconds > 0;

  return (
    <div className="fixed inset-0 z-[220] flex items-end justify-center bg-black/85 p-4 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-white/10 bg-tum-dark-2 shadow-2xl">
        <div className="h-1 w-full bg-gradient-to-r from-transparent via-tum-yellow to-transparent" />
        <div className="p-5">
          <img
            src={`${process.env.EXPO_BASE_URL ?? '/'}tum-logo-login.png`}
            alt="TUM"
            className="mx-auto mb-4 h-16 w-16 rounded-2xl object-cover"
          />
          <p className="text-center text-[10px] font-black uppercase tracking-[0.16em] text-tum-yellow">Segurança TUM</p>
          <h2 className="mt-1 text-center text-xl font-black text-white">Proteção durante suas viagens</h2>
          <p className="mt-3 text-sm leading-6 text-white/60">
            Motoristas podem utilizar recursos de gravação por segurança durante uma corrida. Você também pode ativar esse recurso e iniciar uma gravação quando quiser.
          </p>
          <div className="mt-4 rounded-2xl border border-tum-yellow/20 bg-tum-yellow/[0.07] p-3 text-xs leading-5 text-white/60">
            <b className="text-white">No app Android, a gravação pode continuar em segundo plano.</b> Na versão instalada pelo navegador (PWA), a captura depende das permissões e dos limites do próprio navegador; por segurança, mantenha o TUM aberto durante o REC.
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <ShieldCheck size={17} className="mt-0.5 shrink-0 text-tum-yellow" />
            <p className="text-[11px] leading-5 text-white/45">Leia este aviso antes de escolher. Os botões serão liberados após 10 segundos.</p>
          </div>

          <button
            type="button"
            disabled={locked}
            onClick={onActivate}
            className="mt-5 w-full rounded-2xl bg-tum-yellow py-3.5 font-black text-black disabled:cursor-not-allowed disabled:opacity-45"
          >
            {seconds > 0 ? `Ativar agora (${seconds})` : busy ? 'Salvando...' : 'Ativar agora'}
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={onLater}
            className="mt-2 w-full py-3 text-sm font-bold text-white/45 disabled:cursor-not-allowed disabled:opacity-25"
          >
            {seconds > 0 ? `Agora não · aguarde ${seconds}s` : 'Agora não'}
          </button>
        </div>
      </div>
    </div>
  );
}
