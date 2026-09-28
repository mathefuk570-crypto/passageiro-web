import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  Loader2,
  MapPin,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import {
  useNativeActions,
  type NativePermissionState,
  type PassengerPermissionStatus,
} from '../lib/nativeActions';

type Props = { onContinue: () => void; nativeStatus: PassengerPermissionStatus | null };

const NOTIFICATION_SKIP_KEY = 'tum_passenger_notifications_skipped_v1';

const EMPTY_STATUS: PassengerPermissionStatus = {
  location: 'denied',
  microphone: 'denied',
  notifications: 'denied',
  camera: 'denied',
  allGranted: false,
};

function stateLabel(state: NativePermissionState) {
  if (state === 'granted') return 'LIBERADA';
  if (state === 'blocked') return 'BLOQUEADA';
  if (state === 'unavailable') return 'INDISPONÍVEL';
  return 'PENDENTE';
}

function notificationsWereSkipped() {
  try {
    return window.localStorage.getItem(NOTIFICATION_SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberNotificationsSkipped(skipped: boolean) {
  try {
    if (skipped) window.localStorage.setItem(NOTIFICATION_SKIP_KEY, '1');
    else window.localStorage.removeItem(NOTIFICATION_SKIP_KEY);
  } catch {
    // O app continua funcionando mesmo se o armazenamento local estiver indisponível.
  }
}

function validPermissionStatus(value: unknown): value is PassengerPermissionStatus {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PassengerPermissionStatus>;
  const states: NativePermissionState[] = ['granted', 'denied', 'blocked', 'unavailable'];
  return (
    states.includes(candidate.location as NativePermissionState) &&
    states.includes(candidate.notifications as NativePermissionState) &&
    states.includes(candidate.microphone as NativePermissionState) &&
    states.includes(candidate.camera as NativePermissionState) &&
    typeof candidate.allGranted === 'boolean'
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export default function NativePermissionsGate({ onContinue, nativeStatus }: Props) {
  const nativeActions = useNativeActions();
  const nativeActionsRef = useRef(nativeActions);
  const continueRef = useRef(onContinue);
  const mountedRef = useRef(true);
  const requestInFlightRef = useRef(false);
  const automaticRequestStartedRef = useRef(false);
  const nativeStatusRef = useRef<PassengerPermissionStatus | null>(nativeStatus);
  const [checking, setChecking] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [status, setStatus] = useState<PassengerPermissionStatus>(EMPTY_STATUS);
  const [message, setMessage] = useState<string | null>(null);

  nativeActionsRef.current = nativeActions;
  continueRef.current = onContinue;
  nativeStatusRef.current = nativeStatus;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function enterIfAllowed(next: PassengerPermissionStatus): boolean {
    if (next.location === 'granted' && next.notifications === 'granted') {
      rememberNotificationsSkipped(false);
      continueRef.current();
      return true;
    }

    if (
      next.location === 'granted' &&
      next.notifications !== 'granted' &&
      notificationsWereSkipped()
    ) {
      continueRef.current();
      return true;
    }

    return false;
  }

  async function waitForNativeActions() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const actions = nativeActionsRef.current;
      if (actions?.requestEssentialPermissions || actions?.getEssentialPermissionsStatus) {
        return actions;
      }
      await sleep(180);
    }
    return nativeActionsRef.current;
  }

  async function readNativeStatus(retries = 4): Promise<PassengerPermissionStatus | null> {
    const actions = await waitForNativeActions();
    if (!actions?.getEssentialPermissionsStatus) return null;

    let last: PassengerPermissionStatus | null = null;

    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const next = await actions.getEssentialPermissionsStatus();
        if (validPermissionStatus(next)) {
          last = next;
          if (next.allGranted) return next;
        }
      } catch (error) {
        console.warn(`[TUM] Leitura nativa de permissões falhou (${attempt + 1}/${retries}):`, error);
      }

      if (attempt + 1 < retries) {
        await sleep(260 + attempt * 220);
      }
    }

    return last;
  }

  async function openCorrectSettings(currentStatus: PassengerPermissionStatus = status) {
    const actions = nativeActionsRef.current;

    if (currentStatus.location === 'blocked') {
      await actions?.openAppSettings?.();
      return;
    }

    if (currentStatus.notifications === 'blocked') {
      if (actions?.openNotificationSettings) {
        await actions.openNotificationSettings();
      } else {
        await actions?.openAppSettings?.();
      }
    }
  }

  function applyPendingMessage(next: PassengerPermissionStatus) {
    if (!mountedRef.current) return;

    if (next.location === 'blocked') {
      setMessage(
        'A localização foi bloqueada pelo Android. Toque em “Abrir configurações” para liberar e voltar ao TUM.',
      );
      return;
    }

    if (next.notifications === 'blocked') {
      setMessage(
        'As notificações foram bloqueadas pelo Android. Você pode ativá-las nas configurações ou continuar usando o TUM sem notificações.',
      );
      return;
    }

    setMessage(
      'Ainda falta uma permissão. Toque em “Configurar permissões” para o Android abrir o pedido pendente.',
    );
  }

  async function requestAllAutomatically(
    currentStatus: PassengerPermissionStatus = status,
    automatic = false,
  ) {
    if (requestInFlightRef.current) return;

    const actions = await waitForNativeActions();

    if (!actions?.requestEssentialPermissions) {
      const confirmed = await readNativeStatus(5);
      if (confirmed && mountedRef.current) {
        setStatus(confirmed);
        if (enterIfAllowed(confirmed)) return;
      }
      if (mountedRef.current) {
        setChecking(false);
        setMessage('Não foi possível iniciar os pedidos de permissão agora. Tente novamente.');
      }
      return;
    }

    // Só abrimos Configurações automaticamente quando o Android já confirmou
    // que a permissão está realmente bloqueada. "denied" continua usando popup.
    if (
      !automatic &&
      (currentStatus.location === 'blocked' || currentStatus.notifications === 'blocked')
    ) {
      await openCorrectSettings(currentStatus);
      return;
    }

    requestInFlightRef.current = true;
    if (mountedRef.current) {
      setRequesting(true);
      setMessage(null);
    }

    try {
      // Chamar requestEssentialPermissions direto é intencional: no lado
      // nativo ela primeiro consulta o PackageManager. Se tudo já está
      // concedido, nenhum popup abre e o usuário entra; se faltar algo, os
      // popups são disparados automaticamente.
      let next: PassengerPermissionStatus | null = null;
      let lastError: unknown = null;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await actions.requestEssentialPermissions();
          if (validPermissionStatus(result)) {
            next = result;
            break;
          }
        } catch (error) {
          lastError = error;
          console.warn(
            `[TUM] Pedido nativo de permissões falhou (${attempt + 1}/3):`,
            error,
          );
        }

        await sleep(360 + attempt * 320);
      }

      // O retorno da Promise é só um atalho. A fonte de verdade visual é o
      // snapshot que chega como prop do React Native.
      if (!next?.allGranted) {
        await sleep(320);
        const snapshot = nativeStatusRef.current;
        if (snapshot && validPermissionStatus(snapshot)) next = snapshot;
      }

      if (!mountedRef.current) return;

      if (next) {
        setStatus(next);
        if (enterIfAllowed(next)) return;
        applyPendingMessage(next);
      } else {
        const snapshot = nativeStatusRef.current;
        if (snapshot && validPermissionStatus(snapshot)) {
          setStatus(snapshot);
          if (enterIfAllowed(snapshot)) return;
          applyPendingMessage(snapshot);
        } else {
          console.warn('[TUM] Sem snapshot nativo de permissões:', lastError);
          setChecking(true);
          setMessage(null);
        }
      }
    } finally {
      requestInFlightRef.current = false;
      if (mountedRef.current) {
        setRequesting(false);
        const snapshot = nativeStatusRef.current;
        setChecking(!snapshot || !validPermissionStatus(snapshot));
      }
    }
  }

  useEffect(() => {
    // O snapshot vindo do React Native continua sendo a fonte principal.
    // Em Development Build / retomada do app, porém, o primeiro snapshot pode
    // atrasar ou se perder no bridge do DOM. Nunca deixamos o passageiro preso
    // indefinidamente em "Preparando o TUM": após um curto atraso consultamos
    // o lado nativo diretamente e seguimos com o fluxo normal de permissões.
    if (!nativeStatus || !validPermissionStatus(nativeStatus)) {
      setChecking(true);

      let cancelled = false;
      const fallbackTimer = window.setTimeout(() => {
        void (async () => {
          const fallback = await readNativeStatus(4);
          if (cancelled || !mountedRef.current) return;

          if (!fallback) {
            setChecking(false);
            setMessage(
              'Não conseguimos ler as permissões do Android. Toque em “Configurar permissões” para tentar novamente.',
            );
            return;
          }

          setStatus(fallback);
          if (enterIfAllowed(fallback)) return;

          setChecking(false);
          applyPendingMessage(fallback);

          if (!automaticRequestStartedRef.current && !requestInFlightRef.current) {
            automaticRequestStartedRef.current = true;
            void requestAllAutomatically(fallback, true);
          }
        })();
      }, 650);

      return () => {
        cancelled = true;
        window.clearTimeout(fallbackTimer);
      };
    }

    setStatus(nativeStatus);

    if (enterIfAllowed(nativeStatus)) return;

    setChecking(false);

    if (!automaticRequestStartedRef.current && !requestInFlightRef.current) {
      automaticRequestStartedRef.current = true;
      void requestAllAutomatically(nativeStatus, true);
    }
  }, [
    nativeStatus?.location,
    nativeStatus?.notifications,
    nativeStatus?.microphone,
    nativeStatus?.camera,
    nativeStatus?.allGranted,
  ]);

  const items = useMemo(() => [
    {
      key: 'location' as const,
      icon: MapPin,
      title: 'Localização',
      description: 'Define seu embarque, mostra motoristas próximos e acompanha a rota.',
      state: status.location,
    },
    {
      key: 'notifications' as const,
      icon: BellRing,
      title: 'Notificações',
      description: 'Avisa quando o motorista aceita, chega, inicia a viagem e envia mensagens.',
      state: status.notifications,
    },
  ], [status]);

  const grantedCount = items.filter((item) => item.state === 'granted').length;
  const locationBlocked = status.location === 'blocked';
  const notificationBlocked = status.notifications === 'blocked';
  const hasBlocked = locationBlocked || notificationBlocked;
  const canContinueWithoutNotifications =
    status.location === 'granted' && status.notifications !== 'granted';

  if (checking) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center overflow-hidden bg-tum-dark px-6 text-center text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-tum-yellow text-black">
            <ShieldCheck size={28} />
          </div>
          <p className="text-lg font-black">Preparando o TUM</p>
          <Loader2 size={21} className="animate-spin text-tum-yellow" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center overflow-x-hidden overflow-y-auto bg-tum-dark px-3 py-6 text-white">
      <div className="my-auto w-full max-w-md rounded-[26px] border border-white/10 bg-tum-dark-2 p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-tum-yellow text-black">
            <ShieldCheck size={23} strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-tum-yellow">PERMISSÕES DO TUM</p>
            <h1 className="mt-0.5 text-lg font-black leading-tight">Deixe tudo pronto</h1>
          </div>
          <div className="shrink-0 rounded-xl bg-white/5 px-2.5 py-1.5 text-center">
            <p className="text-sm font-black text-tum-yellow">{grantedCount}/2</p>
            <p className="text-[7px] font-black uppercase text-white/35">liberadas</p>
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-4 text-white/50">
          Localização é necessária para usar as corridas. Notificações são recomendadas para você não perder atualizações quando o TUM estiver fora da tela.
        </p>

        <div className="mt-4 space-y-2.5">
          {items.map((item) => {
            const Icon = item.icon;
            const granted = item.state === 'granted';
            const blocked = item.state === 'blocked';
            return (
              <div key={item.key} className="flex w-full items-start gap-3 overflow-hidden rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${granted ? 'bg-emerald-400/10 text-emerald-300' : blocked ? 'bg-red-400/10 text-red-300' : 'bg-tum-yellow/10 text-tum-yellow'}`}>
                  {granted ? <CheckCircle2 size={20} /> : <Icon size={20} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="min-w-0 flex-1 text-sm font-black text-white">{item.title}</p>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-black ${granted ? 'bg-emerald-400/10 text-emerald-300' : blocked ? 'bg-red-400/10 text-red-300' : 'bg-yellow-400/10 text-yellow-300'}`}>
                      {stateLabel(item.state)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-normal break-words text-[10px] leading-4 text-white/45">{item.description}</p>
                </div>
              </div>
            );
          })}
        </div>

        {message && (
          <div className={`mt-3 rounded-xl border px-3 py-2.5 text-[10px] font-semibold leading-4 ${locationBlocked ? 'border-red-400/15 bg-red-400/10 text-red-200' : 'border-yellow-400/15 bg-yellow-400/10 text-yellow-100'}`}>
            {message}
          </div>
        )}

        <div className="mt-3 grid gap-2">
          {hasBlocked ? (
            <button
              type="button"
              onClick={() => void openCorrectSettings()}
              className="flex min-w-0 items-center justify-center gap-2 rounded-2xl bg-tum-yellow px-3 py-3 text-[11px] font-black text-black"
            >
              <Settings size={16} />
              {notificationBlocked && !locationBlocked ? 'ABRIR NOTIFICAÇÕES' : 'ABRIR CONFIGURAÇÕES'}
            </button>
          ) : (
            <button
              type="button"
              disabled={requesting}
              onClick={() => void requestAllAutomatically()}
              className="flex min-w-0 items-center justify-center gap-2 rounded-2xl bg-tum-yellow px-3 py-3 text-[11px] font-black text-black disabled:opacity-60"
            >
              {requesting ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              {requesting ? 'ABRINDO...' : 'CONFIGURAR PERMISSÕES'}
            </button>
          )}

          {canContinueWithoutNotifications && (
            <button
              type="button"
              onClick={() => {
                rememberNotificationsSkipped(true);
                continueRef.current();
              }}
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-[11px] font-black text-white"
            >
              CONTINUAR SEM NOTIFICAÇÕES
            </button>
          )}
        </div>

        <p className="mt-3 px-1 text-center text-[9px] leading-4 text-white/30">
          Câmera e microfone só são solicitados quando você usa REC, foto ou áudio. O Passageiro não pede localização em segundo plano.
        </p>
      </div>
    </div>
  );
}
