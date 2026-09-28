import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Images, Mic, ShieldCheck, Video } from 'lucide-react';
import {
  loadSafetyRecordingState,
  saveSafetyRecordingState,
  type SafetyRecordingState,
} from '../lib/safetyRecording';
import { useNativeActions } from '../lib/nativeActions';
import SafetyRecordingGallery from './SafetyRecordingGallery';

export default function SafetyRecordingCard() {
  const native = useNativeActions();
  const [state, setState] = useState<SafetyRecordingState | null>(null);
  const [compat, setCompat] = useState<any>(null);
  const [gallery, setGallery] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const statusInFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const nextState = await loadSafetyRecordingState();
      setState(nextState);
      setCompat(await native?.getSafetyCompatibility?.());
      setStatus(await native?.getSafetyRecordingStatus?.());
      setLoadError(null);
    } catch (error) {
      console.warn('[TUM] Não foi possível carregar a gravação de segurança:', error);
      setLoadError('Não foi possível carregar as configurações de segurança agora.');
    }
  }, [native]);

  useEffect(() => {
    let active = true;
    void refresh();

    const updateStatus = async () => {
      if (!active || statusInFlightRef.current || document.visibilityState !== 'visible') return;
      statusInFlightRef.current = true;
      try {
        const nextStatus = await native?.getSafetyRecordingStatus?.();
        if (active && nextStatus) setStatus(nextStatus);
      } catch (error) {
        console.warn('[TUM] Status da gravação de segurança indisponível:', error);
      } finally {
        statusInFlightRef.current = false;
      }
    };

    const timer = window.setInterval(() => void updateStatus(), 1200);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [native, refresh]);

  async function save(patch: Partial<SafetyRecordingState>) {
    if (status?.recording || saving) return;
    setSaving(true);
    try {
      setState(await saveSafetyRecordingState(patch));
      setLoadError(null);
    } catch (error) {
      console.warn('[TUM] Não foi possível salvar a gravação de segurança:', error);
      setLoadError('Não foi possível salvar essa opção. Verifique a conexão e tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  if (!state) {
    return (
      <div className="mb-4 rounded-[24px] border border-white/10 bg-white/[.03] p-4 text-sm text-white/40">
        <p>{loadError ?? 'Preparando gravação de segurança...'}</p>
        {loadError && (
          <button type="button" onClick={() => void refresh()} className="mt-3 rounded-xl border border-tum-yellow/20 px-3 py-2 text-xs font-black text-tum-yellow">
            TENTAR NOVAMENTE
          </button>
        )}
      </div>
    );
  }

  const webLimited = compat?.platform === 'web';
  const unavailable = compat?.platform === 'ios' || (!compat?.videoSupported && !compat?.audioSupported);
  const locked = Boolean(status?.recording || saving);

  return (
    <>
      <div className="mb-4 rounded-[26px] border border-tum-yellow/20 bg-tum-yellow/[.06] p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-tum-yellow text-black"><ShieldCheck size={22} /></div>
          <div className="min-w-0 flex-1">
            <h3 className="font-black text-white">Gravação de segurança</h3>
            <p className="mt-1 text-xs leading-5 text-white/50">{unavailable ? 'Este aparelho/navegador não oferece uma captura compatível agora.' : webLimited ? 'No PWA, o REC grava em trechos enquanto o navegador mantiver câmera e microfone ativos.' : 'O REC grava em segundo plano sem abrir a câmera na tela. Você pode continuar usando o TUM e o celular normalmente.'}</p>
          </div>
          <button type="button" disabled={unavailable || locked} onClick={() => void save({ enabled: !state.enabled })} className={`h-7 w-12 rounded-full p-1 transition ${!unavailable && state.enabled ? 'bg-tum-yellow' : 'bg-white/15'} ${unavailable || locked ? 'opacity-40' : ''}`}>
            <span className={`block h-5 w-5 rounded-full bg-black transition ${!unavailable && state.enabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        {loadError && <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-100/80">{loadError}</p>}

        {unavailable ? (
          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100/80">No app nativo do iPhone a captura contínua em segundo plano permanece indisponível. No PWA, o TUM tenta usar os recursos permitidos pelo navegador quando eles existem.</div>
        ) : (
          <>
            {webLimited && (
              <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100/80">
                <b>Limite do PWA:</b> mantenha o TUM aberto durante o REC. O Android/iPhone pode pausar câmera ou microfone ao bloquear a tela, trocar de aplicativo ou encerrar o navegador. Os trechos já enviados continuam salvos.
              </div>
            )}
            <div className="mt-4 space-y-2">
              <Choice disabled={locked || !compat?.videoSupported} icon={<Camera size={17} />} active={state.capture_mode === 'video_audio' && state.camera_facing === 'front'} text="Frontal + áudio" onClick={() => void save({ capture_mode: 'video_audio', camera_facing: 'front' })} />
              <Choice disabled={locked || !compat?.videoSupported} icon={<Video size={17} />} active={state.capture_mode === 'video_audio' && state.camera_facing === 'back'} text="Traseira + áudio" onClick={() => void save({ capture_mode: 'video_audio', camera_facing: 'back' })} />
              <Choice disabled={locked || !compat?.audioSupported} icon={<Mic size={17} />} active={state.capture_mode === 'audio_only'} text="Somente áudio" onClick={() => void save({ capture_mode: 'audio_only' })} />
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-3">
              <p className="text-[10px] font-black uppercase tracking-[.14em] text-white/35">Compatibilidade</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-white/60">
                <Status ok={!!compat?.videoSupported} text="Vídeo" />
                <Status ok={!!compat?.audioSupported} text="Áudio" />
                <Status ok={!!compat?.backgroundRecording} text="Segundo plano" />
                <Status ok={state.mobile_upload_enabled} text="Dados móveis" />
              </div>
              <button
                type="button"
                onClick={() => {
                  void native?.requestSafetyPermissions?.(state.capture_mode)
                    .then(() => refresh())
                    .catch((error) => console.warn('[TUM] Permissões de segurança indisponíveis:', error));
                }}
                className="mt-3 w-full rounded-xl border border-tum-yellow/20 py-2.5 text-xs font-black text-tum-yellow"
              >
                VERIFICAR / AUTORIZAR
              </button>
            </div>
          </>
        )}

        {!!status?.lastError && !status?.recording && (
          <div className="mt-3 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-3">
            <p className="font-black text-amber-200">Última tentativa não iniciou</p>
            <p className="mt-1 break-words text-xs leading-5 text-amber-100/75">{status.lastError}</p>
          </div>
        )}

        {status?.recording && (
          <div className="mt-3 rounded-2xl border border-red-500/25 bg-red-500/10 p-3">
            <p className="font-black text-red-300">● REC ativo</p>
            <p className="mt-1 text-xs text-white/45">Para automaticamente ao finalizar/cancelar a corrida ou quando você tocar em parar.</p>
            <button type="button" onClick={() => void native?.stopSafetyRecording?.().catch((error) => console.warn('[TUM] Falha ao parar gravação:', error))} className="mt-3 w-full rounded-xl bg-red-500 py-2.5 text-xs font-black text-white">PARAR GRAVAÇÃO</button>
          </div>
        )}

        <p className="mt-4 text-xs leading-5 text-white/45">Os trechos enviados ficam protegidos na nuvem por <b className="text-white/70">{state.retention_days} dias</b>. Em caso de perda ou furto, o que já chegou à nuvem permanece disponível na sua conta.</p>
        <button type="button" onClick={() => setGallery(true)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 py-3 text-sm font-black text-white"><Images size={18} className="text-tum-yellow" />Minha galeria</button>
      </div>
      <SafetyRecordingGallery open={gallery} onClose={() => setGallery(false)} />
    </>
  );
}

function Choice({ active, text, icon, onClick, disabled }: any) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-bold ${active ? 'border-tum-yellow/40 bg-tum-yellow/10 text-white' : 'border-white/10 text-white/60'} ${disabled ? 'cursor-not-allowed opacity-45' : ''}`}><span className="text-tum-yellow">{icon}</span><span className="flex-1">{text}</span>{active && <CheckCircle2 size={17} className="text-tum-yellow" />}</button>;
}

function Status({ ok, text }: { ok: boolean; text: string }) {
  return <span className="flex items-center gap-1.5"><CheckCircle2 size={14} className={ok ? 'text-emerald-300' : 'text-white/25'} />{text}</span>;
}
