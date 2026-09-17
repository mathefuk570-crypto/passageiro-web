import { supabase } from './supabase';

export type AlertAudioMode = 'voice' | 'sound' | 'off';

export const DEFAULT_ALERT_AUDIO_MODE: AlertAudioMode = 'voice';

function storageKey(profileId: string): string {
  return `tum:passenger-alert-audio-mode:${profileId}`;
}

export function normalizeAlertAudioMode(value: unknown): AlertAudioMode {
  return value === 'voice' || value === 'sound' || value === 'off'
    ? value
    : DEFAULT_ALERT_AUDIO_MODE;
}

export function loadPassengerAlertAudioMode(
  profileId: string,
  serverValue?: unknown,
): AlertAudioMode {
  if (
    serverValue === 'voice' ||
    serverValue === 'sound' ||
    serverValue === 'off'
  ) {
    window.localStorage.setItem(storageKey(profileId), serverValue);
    return serverValue;
  }

  return normalizeAlertAudioMode(
    window.localStorage.getItem(storageKey(profileId)),
  );
}

export async function savePassengerAlertAudioMode(
  profileId: string,
  mode: AlertAudioMode,
): Promise<void> {
  window.localStorage.setItem(storageKey(profileId), mode);

  const { error } = await supabase
    .from('profiles')
    .update({ alert_audio_mode: mode })
    .eq('id', profileId);

  if (error) {
    console.warn(
      'Preferência de áudio salva no aparelho, mas não sincronizada no Supabase:',
      error.message,
    );
  }
}
