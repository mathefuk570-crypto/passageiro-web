import { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  Keyboard,
  Linking,
  PermissionsAndroid,
  Platform,
  Share as NativeShare,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import PassengerDomApp from '../dom/PassengerDomApp';
import type {
  NativePermissionState,
  PassengerPermissionStatus,
  SafetyCaptureMode,
  SafetyConfigureInput,
} from '../dom/src/lib/nativeActions';
import {
  authenticateSafetyGallery as authenticateSafetyGalleryNative,
  clearSafetyRideContext,
  configureSafetyRideContext,
  getSafetyCompatibility,
  getSafetyNativeStatus,
  requestSafetyPermissions as requestSafetyPermissionsModule,
  retrySafetyUploads,
  startSafetyRecording,
  stopSafetyRecording,
} from '../modules/tum-safety';

const SUPABASE_URL = 'https://wtfceelwjauydzilmfzy.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZmNlZWx3amF1eWR6aWxtZnp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzMzc4NjgsImV4cCI6MjA5OTkxMzg2OH0.80T5FnZWlYHSaIQqxnMk9Ug00DVxFMzQR9FEvtCv-CE';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        // No Android nativo, os avisos de corrida e chat usam o som do canal
        // do sistema. Assim o áudio não depende do WebView continuar ativo e
        // não é cortado quando o TUM vai para segundo plano.
        shouldPlaySound: true,
        shouldSetBadge: true,
      };
    },
  });
}

function addNativeTimestamp(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}native=${Date.now()}`;
}

function permissionResultState(
  result: string,
): NativePermissionState {
  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
  return 'denied';
}

const blockedAndroidPermissions = new Set<string>();

function rememberAndroidPermissionResult(permission: string, result: string) {
  if (result === PermissionsAndroid.RESULTS.GRANTED) {
    blockedAndroidPermissions.delete(permission);
  } else if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    blockedAndroidPermissions.add(permission);
  }
}


function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilAppIsActive(timeoutMs = 2500): Promise<void> {
  if (AppState.currentState === 'active') return;

  await new Promise<void>((resolve) => {
    let finished = false;
    let subscription: { remove: () => void } | null = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      subscription?.remove();
      resolve();
    };

    const timeout = setTimeout(finish, timeoutMs);
    subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') finish();
    });
  });
}

async function notificationPermissionState(): Promise<NativePermissionState> {
  if (Platform.OS === 'web') return 'unavailable';

  // No Android 13+, PermissionsAndroid consulta diretamente o PackageManager.
  // Essa é a mesma fonte de verdade que o sistema usa no dumpsys e evita o
  // falso "Pendente" que alguns aparelhos retornavam via expo-notifications.
  if (Platform.OS === 'android') {
    if (Number(Platform.Version) < 33) return 'granted';

    const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    const granted = await PermissionsAndroid.check(permission);
    if (granted) {
      blockedAndroidPermissions.delete(permission);
      return 'granted';
    }

    if (blockedAndroidPermissions.has(permission)) return 'blocked';

    // Só usamos o status do Expo para distinguir "negada" de
    // "não perguntar novamente" quando o PackageManager confirmou que a
    // permissão NÃO está concedida. Nunca usamos esse retorno para derrubar uma
    // permissão que o Android já marcou como granted.
    try {
      const expoPermission = await Notifications.getPermissionsAsync();
      if (expoPermission.status === 'denied' && expoPermission.canAskAgain === false) {
        return 'blocked';
      }
    } catch {
      // O botão de configurar continua disponível se a leitura auxiliar falhar.
    }

    return 'denied';
  }

  const permission = await Notifications.getPermissionsAsync();
  if (permission.status === 'granted') return 'granted';
  if (permission.status === 'denied' && permission.canAskAgain === false) return 'blocked';
  return 'denied';
}

async function nativeLocationState(): Promise<NativePermissionState> {
  if (Platform.OS === 'web') return 'unavailable';

  try {
    // No Android, o PackageManager é a fonte de verdade. O expo-location pode
    // demorar alguns milissegundos para refletir a permissão depois que o popup
    // fecha, o que fazia a tela marcar "Pendente" mesmo já estando liberada.
    if (Platform.OS === 'android') {
      const finePermission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
      const coarsePermission = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
      const [fineGranted, coarseGranted] = await Promise.all([
        PermissionsAndroid.check(finePermission),
        PermissionsAndroid.check(coarsePermission),
      ]);

      if (fineGranted || coarseGranted) {
        blockedAndroidPermissions.delete(finePermission);
        blockedAndroidPermissions.delete(coarsePermission);
        return 'granted';
      }

      if (
        blockedAndroidPermissions.has(finePermission) ||
        blockedAndroidPermissions.has(coarsePermission)
      ) {
        return 'blocked';
      }
    }

    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status === 'granted') return 'granted';
    if (permission.status === 'denied' && permission.canAskAgain === false) return 'blocked';
    return 'denied';
  } catch (error) {
    console.warn('Não foi possível ler a permissão de localização:', error);
    return 'denied';
  }
}

async function readStableEssentialPermissionStatus(): Promise<PassengerPermissionStatus> {
  if (Platform.OS === 'web') {
    return readEssentialPermissionStatus();
  }

  // Alguns Samsung retornam um snapshot transitório logo após o processo /
  // WebView subir, mesmo com a permissão já gravada no PackageManager. Em vez
  // de transformar a primeira leitura em "PENDENTE", confirmamos o estado
  // nativo algumas vezes. Assim a UI só recebe um "denied" depois de o
  // Android ter tido tempo de estabilizar.
  const delays = [0, 180, 320, 520, 760];
  let last = await readEssentialPermissionStatus();

  if (last.allGranted) {
    console.log(
      `[TUM][PERMS] status estável: location=${last.location} notifications=${last.notifications}`,
    );
    return last;
  }

  for (let index = 1; index < delays.length; index += 1) {
    await wait(delays[index]);
    last = await readEssentialPermissionStatus();

    if (last.allGranted) {
      console.log(
        `[TUM][PERMS] status confirmado na tentativa ${index + 1}: location=${last.location} notifications=${last.notifications}`,
      );
      return last;
    }
  }

  console.log(
    `[TUM][PERMS] status final: location=${last.location} notifications=${last.notifications} allGranted=${last.allGranted}`,
  );
  return last;
}

async function androidMicrophoneState(): Promise<NativePermissionState> {
  if (Platform.OS !== 'android') return 'granted';

  const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  const granted = await PermissionsAndroid.check(permission);
  if (granted) {
    blockedAndroidPermissions.delete(permission);
    return 'granted';
  }

  return blockedAndroidPermissions.has(permission) ? 'blocked' : 'denied';
}

async function androidCameraState(): Promise<NativePermissionState> {
  if (Platform.OS !== 'android') return 'granted';

  const permission = PermissionsAndroid.PERMISSIONS.CAMERA;
  const granted = await PermissionsAndroid.check(permission);
  if (granted) {
    blockedAndroidPermissions.delete(permission);
    return 'granted';
  }

  return blockedAndroidPermissions.has(permission) ? 'blocked' : 'denied';
}

async function readEssentialPermissionStatus(): Promise<PassengerPermissionStatus> {
  if (Platform.OS === 'web') {
    return {
      location: 'granted',
      microphone: 'granted',
      notifications: 'granted',
      camera: 'granted',
      allGranted: true,
    };
  }

  const [location, microphone, notifications, camera] = await Promise.all([
    nativeLocationState(),
    androidMicrophoneState(),
    notificationPermissionState(),
    androidCameraState(),
  ]);

  return {
    location,
    microphone,
    notifications,
    camera,
    // Entrada do Passageiro depende somente do que o app precisa para começar:
    // localização + notificações. Câmera/microfone são contextuais (REC, foto,
    // áudio) e nunca mais prendem o usuário na tela inicial.
    allGranted:
      location === 'granted' &&
      notifications === 'granted',
  };
}

async function configureAndroidNotificationChannel() {
  if (Platform.OS !== 'android') return;

  const baseChannel = {
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 180, 250],
    lightColor: '#FACC15',
    enableVibrate: true,
    showBadge: true,
  };

  await Notifications.setNotificationChannelAsync('tum-geral', {
    ...baseChannel,
    name: 'Avisos do TUM',
    description: 'Canal geral de compatibilidade do TUM.',
    sound: 'default',
  });

  await Notifications.setNotificationChannelAsync('tum-comunicados-v2', {
    ...baseChannel,
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 180],
    name: 'Comunicados do TUM',
    description: 'Novidades, campanhas, lembretes e avisos enviados pelo TUM.',
    sound: 'va_de_tum.wav',
  });

  await Notifications.setNotificationChannelAsync('tum-chat-messages-v2', {
    ...baseChannel,
    name: 'Mensagens do TUM',
    description: 'Mensagens da corrida e respostas do suporte TUM.',
    sound: 'mensagem_recebida.mp3',
  });

  const rideChannels: Array<{
    id: string;
    name: string;
    sound: string | null;
  }> = [
    {
      id: 'tum-ride-queued-v2',
      name: 'Motorista confirmado - em fila',
      sound: 'corrida_aceita_som.mp3',
    },
    {
      id: 'tum-ride-accepted-voice-v2',
      name: 'Corrida aceita - voz',
      sound: 'corrida_aceita_com_voz.mp3',
    },
    {
      id: 'tum-ride-accepted-sound-v2',
      name: 'Corrida aceita - som',
      sound: 'corrida_aceita_som.mp3',
    },
    {
      id: 'tum-driver-arrived-voice-v7',
      name: 'Motorista no local - voz',
      sound: 'chegou_voz.wav',
    },
    {
      id: 'tum-driver-arrived-sound-v7',
      name: 'Motorista no local - som',
      sound: 'chegou_som.wav',
    },
    {
      id: 'tum-ride-started-v2',
      name: 'Viagem iniciada',
      sound: 'viagem_iniciada_som.mp3',
    },
    {
      id: 'tum-ride-completed-v2',
      name: 'Corrida finalizada',
      sound: 'corrida_finalizada_som.mp3',
    },
    {
      id: 'tum-ride-cancelled-v2',
      name: 'Corrida cancelada',
      sound: 'corrida_cancelada.mp3',
    },
    {
      id: 'tum-ride-silent-v2',
      name: 'Avisos de corrida silenciosos',
      sound: null,
    },
  ];

  await Promise.all(
    rideChannels.map(({ id, name, sound }) =>
      Notifications.setNotificationChannelAsync(id, {
        ...baseChannel,
        name,
        description: 'Atualizações automáticas da sua corrida no TUM.',
        sound,
      }),
    ),
  );

  try {
    const arrivedVoiceChannel = await Notifications.getNotificationChannelAsync(
      'tum-driver-arrived-voice-v7',
    );
    console.log(
      `[TUM][ARRIVAL_AUDIO] v7 sound=${String(arrivedVoiceChannel?.sound ?? 'null')}`,
    );
  } catch (error) {
    console.warn('[TUM][ARRIVAL_AUDIO] não foi possível conferir o canal v7:', error);
  }
}

export default function Index() {
  const [openUrl, setOpenUrl] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [nativeKeyboardHeight, setNativeKeyboardHeight] = useState(0);
  const [essentialPermissionsStatus, setEssentialPermissionsStatus] =
    useState<PassengerPermissionStatus | null>(null);


  useEffect(() => {
    if (Platform.OS === 'web') return;

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      const height = Number(event.endCoordinates?.height ?? 0);
      setNativeKeyboardHeight(Number.isFinite(height) ? Math.max(0, height) : 0);
    });

    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setNativeKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') {
      setEssentialPermissionsStatus({
        location: 'granted',
        microphone: 'granted',
        notifications: 'granted',
        camera: 'granted',
        allGranted: true,
      });
      return undefined;
    }

    let cancelled = false;

    const refreshSnapshot = async (reason: string) => {
      try {
        await waitUntilAppIsActive();
        const result = await readStableEssentialPermissionStatus();
        if (cancelled) return;
        setEssentialPermissionsStatus(result);
        console.log(
          `[TUM][PERMS][SNAPSHOT] ${reason} -> location=${result.location} notifications=${result.notifications} allGranted=${result.allGranted}`,
        );
      } catch (error) {
        console.warn(`[TUM][PERMS][SNAPSHOT] falha em ${reason}:`, error);
      }
    };

    void refreshSnapshot('startup');

    const appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refreshSnapshot('app-active');
    });

    return () => {
      cancelled = true;
      appStateSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return undefined;
    }

    void configureAndroidNotificationChannel().catch(error => {
      console.warn('Não foi possível preparar o canal de notificações:', error);
    });

    const subscription =
      Notifications.addNotificationResponseReceivedListener(response => {
        const url = response.notification.request.content.data?.url;

        if (typeof url === 'string') {
          setOpenUrl(addNativeTimestamp(url));
        }
      });

    void Notifications.getLastNotificationResponseAsync()
      .then(response => {
        const url = response?.notification.request.content.data?.url;

        if (typeof url === 'string') {
          setOpenUrl(addNativeTimestamp(url));
        }
      })
      .catch(error => {
        console.warn('Não foi possível ler a última notificação:', error);
      });

    return () => {
      subscription.remove();
    };
  }, []);

  const getEssentialPermissionsStatus = useCallback(
    async (): Promise<PassengerPermissionStatus> => {
      await waitUntilAppIsActive();
      // O bridge do DOM pode chamar esta função no mesmo instante em que a
      // Activity volta ao foreground. Damos um pequeno intervalo antes de
      // consultar o PackageManager para evitar snapshot de inicialização.
      await wait(220);
      const result = await readStableEssentialPermissionStatus();
      setEssentialPermissionsStatus(result);
      console.log(
        `[TUM][PERMS] getEssentialPermissionsStatus -> location=${result.location} notifications=${result.notifications} allGranted=${result.allGranted}`,
      );
      return result;
    },
    [],
  );

  const ensureLocationPermission = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'web') return true;

    try {
      await waitUntilAppIsActive();

      if (Platform.OS === 'android') {
        const finePermission = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
        const coarsePermission = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
        const [fineGranted, coarseGranted] = await Promise.all([
          PermissionsAndroid.check(finePermission),
          PermissionsAndroid.check(coarsePermission),
        ]);
        if (fineGranted || coarseGranted) return true;

        const results = await PermissionsAndroid.requestMultiple([
          coarsePermission,
          finePermission,
        ]);
        rememberAndroidPermissionResult(
          coarsePermission,
          results[coarsePermission] ?? PermissionsAndroid.RESULTS.DENIED,
        );
        rememberAndroidPermissionResult(
          finePermission,
          results[finePermission] ?? PermissionsAndroid.RESULTS.DENIED,
        );

        // Android 12+ pode conceder apenas localização aproximada. Para o
        // Passageiro ela é válida para abrir o app; quando precisa de precisão,
        // o GPS/usuário pode elevar a permissão sem quebrar este fluxo.
        const [fineAfter, coarseAfter] = await Promise.all([
          PermissionsAndroid.check(finePermission),
          PermissionsAndroid.check(coarsePermission),
        ]);
        return fineAfter || coarseAfter;
      }

      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status === 'granted') return true;
      if (permission.canAskAgain === false) return false;
      permission = await Location.requestForegroundPermissionsAsync();
      return permission.status === 'granted';
    } catch (error) {
      console.warn('Não foi possível solicitar localização:', error);
      return false;
    }
  }, []);

  const getCurrentNativeLocation = useCallback(async () => {
    if (Platform.OS === 'web') return null;

    try {
      const allowed = await ensureLocationPermission();
      if (!allowed) return null;

      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) return null;

      const recent = await Location.getLastKnownPositionAsync({
        maxAge: 15000,
        requiredAccuracy: 250,
      }).catch(() => null);

      if (recent) {
        return {
          latitude: recent.coords.latitude,
          longitude: recent.coords.longitude,
          accuracy: recent.coords.accuracy ?? null,
          timestamp: recent.timestamp,
        };
      }

      // Nunca deixe o DOM esperando indefinidamente por um novo fix de GPS.
      // Se o aparelho demorar, devolvemos null e a Home abre no centro/cache;
      // uma atualização posterior recentraliza o mapa automaticamente.
      const current = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          mayShowUserSettingsDialog: true,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4500)),
      ]);

      if (!current) return null;

      return {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        accuracy: current.coords.accuracy ?? null,
        timestamp: current.timestamp,
      };
    } catch (error) {
      console.warn('Não foi possível obter a localização nativa:', error);

      try {
        const fallback = await Location.getLastKnownPositionAsync({ maxAge: 120000 });
        if (!fallback) return null;
        return {
          latitude: fallback.coords.latitude,
          longitude: fallback.coords.longitude,
          accuracy: fallback.coords.accuracy ?? null,
          timestamp: fallback.timestamp,
        };
      } catch {
        return null;
      }
    }
  }, [ensureLocationPermission]);

  const ensureMicrophonePermission = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;

    try {
      await waitUntilAppIsActive();

      const current = await androidMicrophoneState();
      if (current === 'granted') return true;

      const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
      const result = await PermissionsAndroid.request(permission);
      rememberAndroidPermissionResult(permission, result);

      return result === PermissionsAndroid.RESULTS.GRANTED;
    } catch (error) {
      console.warn('Não foi possível solicitar microfone:', error);
      return false;
    }
  }, []);

  const ensureNotificationPermission = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'web') return true;

    try {
      await waitUntilAppIsActive();

      if (Platform.OS === 'android') {
        if (Number(Platform.Version) < 33) return true;

        const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
        const alreadyGranted = await PermissionsAndroid.check(permission);
        if (alreadyGranted) {
          blockedAndroidPermissions.delete(permission);
          return true;
        }

        const result = await PermissionsAndroid.request(permission);
        rememberAndroidPermissionResult(permission, result);
        return result === PermissionsAndroid.RESULTS.GRANTED;
      }

      const current = await Notifications.getPermissionsAsync();
      if (current.status === 'granted') return true;
      if (current.canAskAgain === false) return false;
      const requested = await Notifications.requestPermissionsAsync();
      return requested.status === 'granted';
    } catch (error) {
      console.warn('Não foi possível solicitar notificações:', error);
      return false;
    }
  }, []);

  const ensureCameraPermission = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;

    try {
      await waitUntilAppIsActive();
      const current = await androidCameraState();
      if (current === 'granted') return true;
      const permission = PermissionsAndroid.PERMISSIONS.CAMERA;
      const result = await PermissionsAndroid.request(permission);
      rememberAndroidPermissionResult(permission, result);
      return result === PermissionsAndroid.RESULTS.GRANTED;
    } catch (error) {
      console.warn('Não foi possível solicitar câmera:', error);
      return false;
    }
  }, []);

  const requestEssentialPermissions = useCallback(
    async (): Promise<PassengerPermissionStatus> => {
      if (Platform.OS === 'web') {
        return readEssentialPermissionStatus();
      }

      // Esta função é idempotente de propósito: o gate pode chamá-la direto na
      // entrada. Se o Android já concedeu tudo, não abre popup nenhum; apenas
      // confirma e entra. Se estiver faltando algo, abre os pedidos sozinho.
      await waitUntilAppIsActive();
      await wait(520);

      const before = await readStableEssentialPermissionStatus();
      console.log(
        `[TUM][PERMS] request início -> location=${before.location} notifications=${before.notifications} allGranted=${before.allGranted}`,
      );

      setEssentialPermissionsStatus(before);

      if (before.allGranted) {
        return before;
      }

      if (before.location !== 'granted') {
        await ensureLocationPermission();
        await waitUntilAppIsActive();
        await wait(260);
      }

      const afterLocation = await readStableEssentialPermissionStatus();
      if (afterLocation.notifications !== 'granted') {
        await ensureNotificationPermission();
        await waitUntilAppIsActive();
        await wait(260);
      }

      try {
        const result = await readStableEssentialPermissionStatus();
        setEssentialPermissionsStatus(result);
        console.log(
          `[TUM][PERMS] request fim -> location=${result.location} notifications=${result.notifications} allGranted=${result.allGranted}`,
        );
        return result;
      } catch (error) {
        console.warn('Não foi possível reler as permissões:', error);
        const fallback: PassengerPermissionStatus = {
          location: 'denied',
          microphone: 'denied',
          notifications: 'denied',
          camera: 'denied',
          allGranted: false,
        };
        setEssentialPermissionsStatus(current => current ?? fallback);
        return fallback;
      }
    },
    [
      ensureLocationPermission,
      ensureNotificationPermission,
    ],
  );

  const registerNativePush = useCallback(
    async (accessToken: string, userId: string) => {
      if (Platform.OS === 'web' || !Device.isDevice) {
        return;
      }

      await configureAndroidNotificationChannel();

      const permission = await Notifications.getPermissionsAsync();

      // A solicitação da permissão é feita logo na entrada pelo fluxo TUM.
      // Aqui registramos o token assim que o Android confirmar a autorização.
      if (permission.status !== 'granted') {
        return;
      }

      const projectId =
        Constants.easConfig?.projectId ??
        Constants.expoConfig?.extra?.eas?.projectId;

      if (!projectId) {
        console.warn('Vincule o projeto com eas init antes do build.');
        return;
      }

      // Em alguns aparelhos a rede/FCM ainda está estabilizando nos primeiros
      // instantes da abertura. Fazemos até 3 tentativas sem bloquear o app.
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const token = (
            await Notifications.getExpoPushTokenAsync({ projectId })
          ).data;

          const response = await fetch(
            `${SUPABASE_URL}/rest/v1/rpc/register_my_push_token_tum`,
            {
              method: 'POST',
              headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                p_expo_push_token: token,
                p_platform: Platform.OS,
                p_device_id: `passenger-${userId}`,
              }),
            },
          );

          if (!response.ok) {
            throw new Error(await response.text());
          }

          return;
        } catch (error) {
          if (attempt === 3) {
            console.warn('Não foi possível registrar o push nativo:', error);
            return;
          }

          await new Promise((resolve) =>
            setTimeout(resolve, 1200 * attempt),
          );
        }
      }
    },
    [],
  );

  const setNativeTheme = useCallback(
    async (nextTheme: 'dark' | 'light') => {
      setTheme(nextTheme);
    },
    [],
  );

  const disableNativePush = useCallback(async (accessToken: string) => {
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/disable_my_push_tokens_tum`,
        {
          method: 'POST',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        },
      );
    } catch (error) {
      console.warn('Não foi possível desativar o push nativo:', error);
    }
  }, []);

  const shareText = useCallback(async (title: string, message: string) => {
    if (Platform.OS === 'web') {
      return false;
    }

    try {
      await NativeShare.share({ title, message });
      // Se o sistema conseguiu abrir a folha nativa de compartilhamento, a ação
      // já foi entregue ao usuário. Não acionamos um segundo fallback por cima.
      return true;
    } catch (error) {
      console.warn('Não foi possível abrir o compartilhamento nativo:', error);
      return false;
    }
  }, []);

  const shareNewsPost = useCallback(
    async (title: string, _message: string, imageUrl: string) => {
      if (Platform.OS === 'web' || !imageUrl) {
        return false;
      }

      try {
        const cleanUrl = imageUrl.split('?')[0]?.toLowerCase() ?? '';
        const extension = cleanUrl.endsWith('.png')
          ? 'png'
          : cleanUrl.endsWith('.webp')
            ? 'webp'
            : 'jpg';
        const mimeType =
          extension === 'png'
            ? 'image/png'
            : extension === 'webp'
              ? 'image/webp'
              : 'image/jpeg';
        const destination = new File(
          Paths.cache,
          `tum-novidade-${Date.now()}.${extension}`,
        );
        const downloaded = await File.downloadFileAsync(
          imageUrl,
          destination,
          { idempotent: true },
        );

        const sharingAvailable = await Sharing.isAvailableAsync();
        if (!sharingAvailable) {
          return false;
        }

        await Sharing.shareAsync(downloaded.uri, {
          dialogTitle: title,
          mimeType,
          UTI:
            extension === 'png'
              ? 'public.png'
              : extension === 'webp'
                ? 'public.webp'
                : 'public.jpeg',
        });

        return true;
      } catch (error) {
        console.warn(
          'Não foi possível compartilhar a imagem da novidade:',
          error,
        );
        return false;
      }
    },
    [],
  );

  const openAppSettings = useCallback(async () => {
    if (Platform.OS === 'web') return;
    await Linking.openSettings();
  }, []);

  const openNotificationSettings = useCallback(async () => {
    if (Platform.OS === 'web') return;

    if (Platform.OS === 'android') {
      const packageName =
        Constants.expoConfig?.android?.package ?? 'com.tornado.tum.passageiro';

      try {
        await Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
          {
            key: 'android.provider.extra.APP_PACKAGE',
            value: packageName,
          },
        ]);
        return;
      } catch (error) {
        console.warn('Não foi possível abrir as notificações diretamente:', error);
      }
    }

    await Linking.openSettings();
  }, []);

  const requestSafetyPermissions = useCallback(async (captureMode: SafetyCaptureMode) => {
    if (Platform.OS === 'web') return requestSafetyPermissionsModule(captureMode);
    if (Platform.OS !== 'android') return Platform.OS === 'ios';

    const microphoneAllowed = await ensureMicrophonePermission();
    if (!microphoneAllowed) return false;

    if (captureMode === 'audio_only') return true;
    return ensureCameraPermission();
  }, [ensureCameraPermission, ensureMicrophonePermission]);

  const configureSafetyRecordingContext = useCallback(async (input: SafetyConfigureInput) => {
    return configureSafetyRideContext({
      ...input,
      deviceModel: Device.modelName ?? Device.deviceName ?? null,
      appVersion: Constants.expoConfig?.version ?? '1.0.0',
    });
  }, []);

  const authenticateSafetyGallery = useCallback(async () => authenticateSafetyGalleryNative(), []);

  const backgroundColor = theme === 'dark' ? '#000000' : '#F4F4F5';

  return (
    <SafeAreaProvider>
      <View style={[styles.root, { backgroundColor }]}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

        <SafeAreaView
          style={[styles.safeArea, { backgroundColor }]}
          edges={['top', 'right', 'bottom', 'left']}
        >
          <PassengerDomApp
            runtimePlatform={Platform.OS}
            nativeKeyboardHeight={nativeKeyboardHeight}
            nativeEssentialPermissionsStatus={essentialPermissionsStatus}
            registerNativePush={registerNativePush}
            disableNativePush={disableNativePush}
            setNativeTheme={setNativeTheme}
            shareText={shareText}
            shareNewsPost={shareNewsPost}
            getEssentialPermissionsStatus={getEssentialPermissionsStatus}
            requestEssentialPermissions={requestEssentialPermissions}
            ensureLocationPermission={ensureLocationPermission}
            getCurrentNativeLocation={getCurrentNativeLocation}
            ensureMicrophonePermission={ensureMicrophonePermission}
            ensureNotificationPermission={ensureNotificationPermission}
            ensureCameraPermission={ensureCameraPermission}
            openAppSettings={openAppSettings}
            openNotificationSettings={openNotificationSettings}
            getSafetyCompatibility={getSafetyCompatibility}
            requestSafetyPermissions={requestSafetyPermissions}
            configureSafetyRecordingContext={configureSafetyRecordingContext}
            clearSafetyRecordingContext={clearSafetyRideContext}
            startSafetyRecording={startSafetyRecording}
            stopSafetyRecording={stopSafetyRecording}
            retrySafetyRecordingUploads={retrySafetyUploads}
            getSafetyRecordingStatus={getSafetyNativeStatus}
            authenticateSafetyGallery={authenticateSafetyGallery}
            nativeOpenUrl={openUrl}
            dom={{
              style: [styles.webview, { backgroundColor }],
              geolocationEnabled: true,
              mediaPlaybackRequiresUserAction: false,
              allowsInlineMediaPlayback: true,
              javaScriptEnabled: true,
              domStorageEnabled: true,
            }}
          />
        </SafeAreaView>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  safeArea: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: '#000000',
  },
});