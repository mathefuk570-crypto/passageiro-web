import React, {
  useEffect,
  useState,
} from 'react';
import {
  Bell,
  BellRing,
  X,
} from 'lucide-react';

import {
  getWebPushPermission,
  registerWebPushToken,
  requestAndRegisterWebPush,
} from '../lib/pushNotifications';

export default function PushNotificationPrompt() {
  if (false) return null;

  const [permission, setPermission] =
    useState(getWebPushPermission());

  const [dismissed, setDismissed] =
    useState(false);

  const [registering, setRegistering] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    if (permission !== 'granted') return;

    void registerWebPushToken().then(
      (result) => {
        if (!result.registered) {
          console.warn(
            'Push do passageiro não registrado:',
            result.reason,
          );
        }
      },
    );
  }, [permission]);

  if (
    permission === 'unsupported' ||
    permission === 'denied' ||
    permission === 'granted' ||
    dismissed
  ) {
    return null;
  }

  const activate = async () => {
    setRegistering(true);
    setError(null);

    const result =
      await requestAndRegisterWebPush();

    const nextPermission =
      getWebPushPermission();

    setPermission(nextPermission);

    if (!result.registered) {
      setError(
        result.reason === 'denied'
          ? 'As notificações foram bloqueadas no navegador.'
          : 'Não foi possível ativar agora. Tente novamente.',
      );
    }

    setRegistering(false);
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-md rounded-2xl border border-yellow-300 bg-black p-4 text-white shadow-2xl">
      <button
        type="button"
        aria-label="Fechar aviso"
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-3 rounded-full p-1 text-neutral-400 transition hover:bg-white/10 hover:text-white"
      >
        <X size={17} />
      </button>

      <div className="flex gap-3 pr-7">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-yellow-400 text-black">
          <BellRing size={23} />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="font-bold">
            Ative os avisos do TUM
          </h3>

          <p className="mt-1 text-sm leading-5 text-neutral-300">
            Receba comunicados e atualizações mesmo com esta tela fechada.
          </p>

          {error && (
            <p className="mt-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={registering}
            onClick={() => void activate()}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-yellow-400 px-4 py-2 text-sm font-bold text-black transition hover:bg-yellow-300 disabled:cursor-wait disabled:opacity-60"
          >
            <Bell size={16} />
            {registering
              ? 'Ativando...'
              : 'Ativar notificações'}
          </button>
        </div>
      </div>
    </div>
  );
}
