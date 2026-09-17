import React from 'react';
import { ThemeProvider } from './hooks/useTheme';
import { useAuth } from './hooks/useAuth';
import AuthScreen from './components/AuthScreen';
import HomeScreen from './components/HomeScreen';
import PushNotificationPrompt from './components/PushNotificationPrompt';
import WebPermissionsGate from './components/WebPermissionsGate';
import { useNativeActions, type PassengerPermissionStatus } from './lib/nativeActions';
import { supabase } from './lib/supabase';
import SafetyRecordingIntro from './components/SafetyRecordingIntro';
import { loadSafetyRecordingState, saveSafetyRecordingState } from './lib/safetyRecording';
import AppErrorBoundary from './components/AppErrorBoundary';

type AppProps = {
  nativeEssentialPermissionsStatus?: PassengerPermissionStatus | null;
};

function AppInner({ nativeEssentialPermissionsStatus }: AppProps) {
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
    if (!nativeActions || !profile || !nativePermissionsReady) return;
    void loadSafetyRecordingState().then(state => {
      if (state.passenger_enabled && !state.intro_seen) setSafetyIntroOpen(true);
    }).catch(() => {});
  }, [profile?.id, nativePermissionsReady]);

  React.useEffect(() => {
    if (!nativeActions || !profile || !nativePermissionsReady) return;

    const sync = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) {
        await nativeActions.registerNativePush(
          data.session.access_token,
          data.session.user.id,
        );
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
      <WebPermissionsGate
        onContinue={() => setNativePermissionsReady(true)}
      />
    );
  }

  return (
    <>
      <HomeScreen
        profile={profile}
        setProfile={setProfile}
        onLogout={async () => {
          const { data } = await supabase.auth.getSession();
          if (nativeActions && data.session?.access_token) {
            await nativeActions.disableNativePush(
              data.session.access_token,
              data.session.user.id,
            );
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
            .finally(() => setSafetyIntroBusy(false));
        }}
        onLater={() => {
          setSafetyIntroBusy(true);
          void saveSafetyRecordingState({ intro_seen: true })
            .then(() => setSafetyIntroOpen(false))
            .finally(() => setSafetyIntroBusy(false));
        }}
      />
      <PushNotificationPrompt />
    </>
  );
}

export default function App({
  nativeEssentialPermissionsStatus = null,
}: AppProps = {}) {
  return (
    <ThemeProvider>
      <AppErrorBoundary><AppInner nativeEssentialPermissionsStatus={nativeEssentialPermissionsStatus} /></AppErrorBoundary>
    </ThemeProvider>
  );
}