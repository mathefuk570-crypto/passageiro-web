import type { AlertAudioMode } from './audioPreferences';

export type PassengerAudioEvent =
  | 'queue_waiting'
  | 'ride_accepted'
  | 'driver_arrived'
  | 'ride_started'
  | 'ride_completed'
  | 'ride_cancelled'
  | 'message_received'
  | 'recording_started';

type EventSources = {
  voice: string;
  sound: string;
};

const ASSET_BASE = process.env.EXPO_BASE_URL ?? '/';
const asset = (path: string) => `${ASSET_BASE}${path.replace(/^\//, '')}`;

const SOURCES: Record<PassengerAudioEvent, EventSources> = {
  queue_waiting: {
    // O TUM usa somente arquivos de áudio do próprio aplicativo.
    // Não há fallback para voz sintética do Android/WebView.
    voice: asset('/sounds/motorista-finalizando-corrida.mp3'),
    sound: asset('/sounds/corrida_aceita_som.mp3'),
  },
  ride_accepted: {
    voice: asset('/sounds/corrida_aceita_com_voz.mp3'),
    sound: asset('/sounds/corrida_aceita_som.mp3'),
  },
  driver_arrived: {
    voice: asset('/sounds/motorista_chegou_com_voz.mp3'),
    sound: asset('/sounds/motorista_chegou_som.mp3'),
  },
  ride_started: {
    voice: asset('/sounds/viagem_iniciada_som.mp3'),
    sound: asset('/sounds/viagem_iniciada_som.mp3'),
  },
  ride_completed: {
    voice: asset('/sounds/corrida_finalizada_som.mp3'),
    sound: asset('/sounds/corrida_finalizada_som.mp3'),
  },
  ride_cancelled: {
    voice: asset('/sounds/corrida_cancelada.mp3'),
    sound: asset('/sounds/corrida_cancelada.mp3'),
  },
  message_received: {
    voice: asset('/sounds/mensagem-recebida.mp3'),
    sound: asset('/sounds/mensagem-recebida.mp3'),
  },
  recording_started: {
    voice: asset('/sounds/iniciar-gravacao.mp3'),
    sound: asset('/sounds/iniciar-gravacao.mp3'),
  },
};

const cache = new Map<string, HTMLAudioElement>();
let activeAudio: HTMLAudioElement | null = null;
let primed = false;

function getAudio(source: string): HTMLAudioElement {
  const cached = cache.get(source);
  if (cached) return cached;

  const audio = new Audio(source);
  audio.preload = 'auto';
  audio.volume = 1;
  cache.set(source, audio);
  return audio;
}

export async function primePassengerAudio(): Promise<void> {
  if (primed || typeof Audio === 'undefined') return;
  primed = true;

  const audio = getAudio(asset('/sounds/mensagem-recebida.mp3'));
  const previousMuted = audio.muted;
  audio.muted = true;

  try {
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
  } catch {
    primed = false;
  } finally {
    audio.muted = previousMuted;
  }
}

export async function playPassengerAudioEvent(
  event: PassengerAudioEvent,
  mode: AlertAudioMode,
): Promise<boolean> {
  if (mode === 'off' || typeof Audio === 'undefined') return false;

  const sources = SOURCES[event];
  const source = mode === 'voice' ? sources.voice : sources.sound;
  const audio = getAudio(source);

  if (activeAudio && activeAudio !== audio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
  }

  activeAudio = audio;
  audio.pause();
  audio.currentTime = 0;

  try {
    await audio.play();
    return true;
  } catch (error) {
    // Sem Text-to-Speech/fala sintética: se o arquivo não puder ser tocado,
    // o TUM permanece silencioso em vez de inventar uma voz do sistema.
    console.warn('Não foi possível tocar o arquivo de áudio do TUM:', error);
    return false;
  }
}

export function vibratePassenger(pattern: number | number[]): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}
