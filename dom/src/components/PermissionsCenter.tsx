import { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  Camera,
  CheckCircle2,
  MapPin,
  Mic,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  useNativeActions,
  type NativePermissionState,
  type PassengerPermissionStatus,
} from '../lib/nativeActions';

type Props = { open: boolean; onClose: () => void };

const EMPTY: PassengerPermissionStatus = {
  location: 'denied', notifications: 'denied', camera: 'denied', microphone: 'denied', allGranted: false,
};

function label(state: NativePermissionState) {
  if (state === 'granted') return 'PERMITIDO';
  if (state === 'blocked') return 'BLOQUEADO';
  if (state === 'unavailable') return 'INDISPONÍVEL';
  return 'CONFIGURAR';
}

export default function PermissionsCenter({ open, onClose }: Props) {
  const nativeActions = useNativeActions();
  const [status, setStatus] = useState<PassengerPermissionStatus>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  const refresh = async () => {
    if (!nativeActions?.getEssentialPermissionsStatus) return;
    setLoading(true);
    try { setStatus(await nativeActions.getEssentialPermissionsStatus()); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!open) return;
    void refresh();
    const onFocus = () => setTimeout(() => void refresh(), 240);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [open, nativeActions]);

  const items = useMemo(() => [
    { key: 'location', icon: MapPin, title: 'Localização', state: status.location, description: 'Usada para escolher o embarque, encontrar motoristas próximos e acompanhar sua corrida.', action: nativeActions?.ensureLocationPermission },
    { key: 'notifications', icon: BellRing, title: 'Notificações', state: status.notifications, description: 'Avisa quando o motorista aceita, chega, inicia a viagem e envia mensagens.', action: nativeActions?.ensureNotificationPermission },
    { key: 'camera', icon: Camera, title: 'Câmera — opcional', state: status.camera, description: 'Pedida somente quando você usa gravação de segurança, preview ou escolhe tirar uma foto.', action: nativeActions?.ensureCameraPermission },
    { key: 'microphone', icon: Mic, title: 'Microfone — opcional', state: status.microphone, description: 'Pedido somente para REC com áudio ou mensagem de voz. O TUM não grava sozinho.', action: nativeActions?.ensureMicrophonePermission },
  ], [nativeActions, status]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-5">
      <div className="max-h-[94dvh] w-full max-w-lg overflow-x-hidden overflow-y-auto rounded-t-[30px] border border-white/10 bg-tum-dark-2 p-4 text-white shadow-2xl sm:rounded-[30px]">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-tum-yellow text-black"><ShieldCheck size={25} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[.14em] text-tum-yellow">PRIVACIDADE E PERMISSÕES</p>
            <h2 className="mt-1 text-xl font-black">Você controla os acessos</h2>
            <p className="mt-1 text-xs leading-5 text-white/45">Localização é usada para a corrida. Notificações são recomendadas, mas podem ser ativadas depois. Câmera e microfone continuam opcionais até você usar REC, foto ou áudio.</p>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5"><X size={19} /></button>
        </div>

        <div className="mt-4 rounded-2xl border border-tum-yellow/20 bg-tum-yellow/10 p-3.5">
          <p className="text-xs font-black text-tum-yellow">Permissões do Passageiro</p>
          <p className="mt-1 text-xs leading-5 text-white/60">O TUM não usa localização em segundo plano no Passageiro e não solicita acesso amplo à sua galeria.</p>
        </div>

        <div className="mt-3 space-y-2">
          {items.map((item) => {
            const Icon = item.icon;
            const granted = item.state === 'granted';
            const blocked = item.state === 'blocked';
            return (
              <button
                key={item.key}
                disabled={Boolean(working)}
                onClick={async () => {
                  if (granted) return;

                  if (blocked) {
                    if (item.key === 'notifications' && nativeActions?.openNotificationSettings) {
                      await nativeActions.openNotificationSettings();
                    } else {
                      await nativeActions?.openAppSettings?.();
                    }
                    return;
                  }

                  if (!item.action) return;
                  setWorking(item.key);
                  try { await item.action(); await refresh(); }
                  finally { setWorking(null); }
                }}
                className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-tum-dark-3 p-3.5 text-left transition active:scale-[.99]"
              >
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${granted ? 'bg-emerald-400/10 text-emerald-300' : blocked ? 'bg-red-400/10 text-red-300' : 'bg-tum-yellow/10 text-tum-yellow'}`}>
                  {granted ? <CheckCircle2 size={21} /> : <Icon size={21} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="min-w-0 flex-1 text-sm font-black">{item.title}</p>
                    <span className={`shrink-0 text-[9px] font-black ${granted ? 'text-emerald-300' : blocked ? 'text-red-300' : 'text-tum-yellow'}`}>{working === item.key ? 'AGUARDE…' : label(item.state)}</span>
                  </div>
                  <p className="mt-1 whitespace-normal break-words text-[11px] leading-4 text-white/45">{item.description}</p>
                  {blocked && <p className="mt-1 text-[9px] font-bold text-red-300">Toque para abrir a configuração correta do Android.</p>}
                </div>
              </button>
            );
          })}
        </div>

        <button onClick={() => void nativeActions?.openAppSettings?.()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-3.5 text-xs font-black text-white"><Settings size={16} /> ABRIR CONFIGURAÇÕES DO TUM</button>
        {loading && <p className="mt-3 text-center text-[10px] text-white/35">Atualizando permissões…</p>}
      </div>
    </div>
  );
}
