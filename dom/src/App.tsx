import React from 'react';
import { ThemeProvider } from './hooks/useTheme';
import { useAuth } from './hooks/useAuth';
import AuthScreen from './components/AuthScreen';
import HomeScreen from './components/HomeScreen';
import PushNotificationPrompt from './components/PushNotificationPrompt';
import NativePermissionsGate from './components/NativePermissionsGate';
import { useNativeActions, type PassengerPermissionStatus } from './lib/nativeActions';
import { supabase } from './lib/supabase';
import SafetyRecordingIntro from './components/SafetyRecordingIntro';
import { loadSafetyRecordingState, saveSafetyRecordingState } from './lib/safetyRecording';
import AppErrorBoundary from './components/AppErrorBoundary';
import PwaInstallGuide from './components/PwaInstallGuide';
import { detectPwaEnvironment, getDeferredInstallPrompt, installMobileViewportGuards, isPwaAccessGranted, registerPwaServiceWorker } from './lib/pwaInstall';

type AppProps = {
  runtimePlatform?: string;
  nativeEssentialPermissionsStatus?: PassengerPermissionStatus | null;
  nativeKeyboardHeight?: number;
};

function AppInner({ nativeEssentialPermissionsStatus, nativeKeyboardHeight = 0 }: AppProps) {
  const { profile, setProfile, login, logout, loading } = useAuth();
  const nativeActions = useNativeActions();
  const [nativePermissionsReady, setNativePermissionsReady] = React.useState(false);
  const [safetyIntroOpen, setSafetyIntroOpen] = React.useState(false);
  const [safetyIntroBusy, setSafetyIntroBusy] = React.useState(false);

  React.useEffect(() => {
    if (!profile) {
      setNativePermissionsReady(false);
      return;
    }

    if (nativeEssentialPermissionsStatus?.allGranted) {
      setNativePermissionsReady(true);
      return;
    }

    setNativePermissionsReady(false);
  }, [profile?.id, nativeEssentialPermissionsStatus?.allGranted]);

  React.useEffect(() => {
    if (!profile || !nativePermissionsReady) return;
    void loadSafetyRecordingState().then(state => {
      if (state.passenger_enabled && !state.intro_seen) setSafetyIntroOpen(true);
    }).catch(() => {});
  }, [profile?.id, nativePermissionsReady]);

  React.useEffect(() => {
    if (!nativeActions || !profile || !nativePermissionsReady) return;

    const sync = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) {
          await nativeActions.registerNativePush(
            data.session.access_token,
            data.session.user.id,
          );
        }
      } catch (error) {
        // Push nunca deve impedir o passageiro de usar o app.
        console.warn('Não foi possível sincronizar push nativo:', error);
      }
    };

    void sync();
  }, [nativeActions, nativePermissionsReady, profile?.id]);

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-tum-dark flex items-center justify-center px-6 text-center">
        <div className="flex flex-col items-center justify-center gap-3">
          <div className="h-8 w-8 rounded-full border-[3px] border-white/15 border-t-tum-yellow animate-spin" />
          <p className="text-xs font-bold text-white/45">Preparando o TUM...</p>
        </div>
      </div>
    );
  }

  if (!profile) return <AuthScreen onAuth={login} />;

  if (!nativePermissionsReady) {
    return (
      <NativePermissionsGate
        nativeStatus={nativeEssentialPermissionsStatus ?? null}
        onContinue={() => setNativePermissionsReady(true)}
      />
    );
  }

  return (
    <>
      <HomeScreen
        profile={profile}
        nativeKeyboardHeight={nativeKeyboardHeight}
        setProfile={setProfile}
        onLogout={async () => {
          try {
            const { data } = await supabase.auth.getSession();
            if (nativeActions && data.session?.access_token) {
              await nativeActions.disableNativePush(
                data.session.access_token,
                data.session.user.id,
              );
            }
          } catch (error) {
            // Falha ao revogar o push não pode prender o usuário na conta.
            console.warn('Falha ao desativar push nativo durante logout:', error);
          }
          await logout();
        }}
      />
      <SafetyRecordingIntro
        open={safetyIntroOpen}
        busy={safetyIntroBusy}
        onActivate={() => {
          setSafetyIntroBusy(true);
          void saveSafetyRecordingState({ enabled: true, intro_seen: true })
            .then(() => { setSafetyIntroOpen(false); window.dispatchEvent(new CustomEvent('tum:open-safety')); })
            .catch((error) => console.warn('Falha ao salvar preferência de gravação:', error))
            .finally(() => setSafetyIntroBusy(false));
        }}
        onLater={() => {
          setSafetyIntroBusy(true);
          void saveSafetyRecordingState({ intro_seen: true })
            .then(() => setSafetyIntroOpen(false))
            .catch((error) => console.warn('Falha ao salvar preferência de gravação:', error))
            .finally(() => setSafetyIntroBusy(false));
        }}
      />
      <PushNotificationPrompt />
    </>
  );
}

export default function App({
  runtimePlatform = 'web',
  nativeEssentialPermissionsStatus = null,
  nativeKeyboardHeight = 0,
}: AppProps = {}) {
  const [pwaAccess, setPwaAccess] = React.useState<'checking' | 'allowed' | 'install-required'>(
    runtimePlatform === 'web' ? 'checking' : 'allowed',
  );

  React.useEffect(() => {
    if (runtimePlatform !== 'web') {
      setPwaAccess('allowed');
      return undefined;
    }

    let cancelled = false;
    let probeTimer: number | undefined;
    const removeViewportGuards = installMobileViewportGuards();

    const allowApp = () => {
      if (!cancelled) setPwaAccess('allowed');
    };

    const evaluateInstallGate = () => {
      if (cancelled) return;

      const environment = detectPwaEnvironment();

      // Desktop, PWA já instalado ou abertura por atalho: nunca bloquear.
      if (!environment.mobile || isPwaAccessGranted()) {
        setPwaAccess('allowed');
        return;
      }

      // Nova regra: só exigimos instalação quando o próprio navegador
      // disponibilizou o prompt nativo `beforeinstallprompt`.
      setPwaAccess(getDeferredInstallPrompt() ? 'install-required' : 'allowed');
    };

    const initializePwaGate = async () => {
      await registerPwaServiceWorker();
      if (cancelled) return;

      const environment = detectPwaEnvironment();
      if (!environment.mobile || isPwaAccessGranted()) {
        setPwaAccess('allowed');
        return;
      }

      if (getDeferredInstallPrompt()) {
        setPwaAccess('install-required');
        return;
      }

      // O Chromium pode disparar `beforeinstallprompt` alguns instantes depois
      // do carregamento. Fazemos uma verificação curta; se o navegador não
      // oferecer instalação, o TUM é liberado e o usuário pode usar o atalho.
      probeTimer = window.setTimeout(() => {
        evaluateInstallGate();
      }, 1400);
    };

    const onInstallReady = () => {
      if (cancelled) return;
      if (probeTimer !== undefined) {
        window.clearTimeout(probeTimer);
        probeTimer = undefined;
      }

      if (!isPwaAccessGranted()) setPwaAccess('install-required');
    };

    const onInstallCompleted = () => {
      if (probeTimer !== undefined) {
        window.clearTimeout(probeTimer);
        probeTimer = undefined;
      }
      allowApp();
    };

    void initializePwaGate();

    window.addEventListener('tum:pwa-install-ready', onInstallReady);
    window.addEventListener('tum:pwa-installed', onInstallCompleted);
    window.addEventListener('tum:pwa-install-accepted', onInstallCompleted);

    return () => {
      cancelled = true;
      if (probeTimer !== undefined) window.clearTimeout(probeTimer);
      removeViewportGuards();
      window.removeEventListener('tum:pwa-install-ready', onInstallReady);
      window.removeEventListener('tum:pwa-installed', onInstallCompleted);
      window.removeEventListener('tum:pwa-install-accepted', onInstallCompleted);
    };
  }, [runtimePlatform]);

  return (
    <ThemeProvider>
      {pwaAccess === 'checking' ? (
        <div className="flex min-h-[100dvh] w-full items-center justify-center bg-tum-dark px-6 text-center">
          <div className="flex flex-col items-center justify-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/15 border-t-tum-yellow" />
            <p className="text-xs font-bold text-white/45">Preparando o TUM...</p>
          </div>
        </div>
      ) : pwaAccess === 'install-required' ? (
        <PwaInstallGuide runtimePlatform={runtimePlatform} />
      ) : (
        <AppInner
          nativeEssentialPermissionsStatus={nativeEssentialPermissionsStatus}
          nativeKeyboardHeight={nativeKeyboardHeight}
        />
      )}
    </ThemeProvider>
  );
}
