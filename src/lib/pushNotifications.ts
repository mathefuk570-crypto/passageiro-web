import { supabase } from './supabase';

const VAPID_PUBLIC_KEY =
  'BCvfajsqhKgR-Ln3J1AaT-EZ7fCd_r_6yBj5sA62x0PyQKVx4kt8rNitNaM6ySUSQk0PzNxlvKuqNGdEox-0ztk';

const DEVICE_ID_STORAGE_KEY =
  'tum-passenger-push-device-id';

function urlBase64ToArrayBuffer(
  base64String: string,
): ArrayBuffer {
  const padding = '='.repeat(
    (4 - (base64String.length % 4)) % 4,
  );

  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);

  for (
    let index = 0;
    index < rawData.length;
    index += 1
  ) {
    outputArray[index] =
      rawData.charCodeAt(index);
  }

  return buffer;
}

function getDeviceId(): string {
  const saved = window.localStorage.getItem(
    DEVICE_ID_STORAGE_KEY,
  );

  if (saved) return saved;

  const generated =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `web-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`;

  window.localStorage.setItem(
    DEVICE_ID_STORAGE_KEY,
    generated,
  );

  return generated;
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function getWebPushPermission():
  | NotificationPermission
  | 'unsupported' {
  if (!isWebPushSupported()) {
    return 'unsupported';
  }

  return Notification.permission;
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  const registration =
    await navigator.serviceWorker.register(
      '/sw.js',
      {
        scope: '/',
      },
    );

  await navigator.serviceWorker.ready;
  return registration;
}

async function getOrCreateSubscription(
  registration: ServiceWorkerRegistration,
): Promise<PushSubscription> {
  const currentSubscription =
    await registration.pushManager.getSubscription();

  if (currentSubscription) {
    return currentSubscription;
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey:
      urlBase64ToArrayBuffer(VAPID_PUBLIC_KEY),
  });
}

export async function registerWebPushToken(): Promise<{
  registered: boolean;
  reason?: string;
}> {
  if (!isWebPushSupported()) {
    return {
      registered: false,
      reason: 'unsupported',
    };
  }

  if (Notification.permission !== 'granted') {
    return {
      registered: false,
      reason: Notification.permission,
    };
  }

  try {
    const registration =
      await getServiceWorkerRegistration();

    const subscription =
      await getOrCreateSubscription(registration);

    const serializedSubscription =
      JSON.stringify(subscription.toJSON());

    const { error } = await supabase.rpc(
      'register_my_push_token_tum',
      {
        p_expo_push_token:
          serializedSubscription,
        p_platform: 'web',
        p_device_id: getDeviceId(),
      },
    );

    if (error) throw error;

    return { registered: true };
  } catch (error) {
    console.error(
      'Erro ao registrar notificações do passageiro:',
      error,
    );

    return {
      registered: false,
      reason:
        error instanceof Error
          ? error.message
          : 'unknown-error',
    };
  }
}

export async function requestAndRegisterWebPush(): Promise<{
  registered: boolean;
  reason?: string;
}> {
  if (!isWebPushSupported()) {
    return {
      registered: false,
      reason: 'unsupported',
    };
  }

  const permission =
    await Notification.requestPermission();

  if (permission !== 'granted') {
    return {
      registered: false,
      reason: permission,
    };
  }

  return registerWebPushToken();
}

export async function disableCurrentPushTokens(): Promise<void> {
  try {
    const { error } = await supabase.rpc(
      'disable_my_push_tokens_tum',
    );

    if (error) throw error;
  } catch (error) {
    console.warn(
      'Não foi possível desativar o token de notificação:',
      error,
    );
  }
}