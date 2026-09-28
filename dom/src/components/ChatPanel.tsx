import React from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  CheckCheck,
  Flag,
  Loader2,
  Lock,
  MessageCircle,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Square,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useNativeActions } from '../lib/nativeActions';
import type { AlertAudioMode } from '../lib/audioPreferences';
import {
  playPassengerAudioEvent,
  vibratePassenger,
} from '../lib/appAudio';

const MAX_AUDIO_SECONDS = 60;

type RideChatMessageType = 'text' | 'audio' | 'quick';

type RideChatMessage = {
  id: string;
  ride_id: string;
  sender_id: string;
  message: string | null;
  audio_url: string | null;
  message_type: RideChatMessageType;
  audio_duration_seconds: number | null;
  quick_message_key: string | null;
  created_at: string;
};

type QuickMessage = {
  key: string;
  text: string;
};

const PASSENGER_QUICK_MESSAGES: QuickMessage[] = [
  {
    key: 'passenger_at_pickup',
    text: 'Estou no local de embarque.',
  },
  {
    key: 'passenger_coming',
    text: 'Já estou indo até você.',
  },
  {
    key: 'passenger_wait',
    text: 'Pode aguardar um momento, por favor?',
  },
  {
    key: 'passenger_cannot_find_vehicle',
    text: 'Não estou encontrando o veículo.',
  },
  {
    key: 'passenger_call_me',
    text: 'Pode me ligar?',
  },
];

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMessage(value: unknown): RideChatMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const item = value as Record<string, unknown>;

  if (
    typeof item.id !== 'string' ||
    typeof item.ride_id !== 'string' ||
    typeof item.sender_id !== 'string'
  ) {
    return null;
  }

  const rawType =
    typeof item.message_type === 'string'
      ? item.message_type
      : 'text';

  const messageType: RideChatMessageType =
    rawType === 'audio' || rawType === 'quick'
      ? rawType
      : 'text';

  return {
    id: item.id,
    ride_id: item.ride_id,
    sender_id: item.sender_id,
    message:
      typeof item.message === 'string'
        ? item.message
        : null,
    audio_url:
      typeof item.audio_url === 'string'
        ? item.audio_url
        : null,
    message_type: messageType,
    audio_duration_seconds: nullableNumber(
      item.audio_duration_seconds,
    ),
    quick_message_key:
      typeof item.quick_message_key === 'string'
        ? item.quick_message_key
        : null,
    created_at:
      typeof item.created_at === 'string'
        ? item.created_at
        : new Date().toISOString(),
  };
}

function mergeMessage(
  current: RideChatMessage[],
  message: RideChatMessage,
): RideChatMessage[] {
  if (current.some((item) => item.id === message.id)) {
    return current;
  }

  return [...current, message].sort(
    (first, second) =>
      new Date(first.created_at).getTime() -
      new Date(second.created_at).getTime(),
  );
}

function formatClock(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function preferredAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;

  const supported = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));

  return supported;
}

function audioExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

function AudioMessage({
  url,
  durationSeconds,
  mine,
}: {
  url: string;
  durationSeconds: number | null;
  mine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(
    durationSeconds ?? 0,
  );

  useEffect(() => {
    const audio = new Audio(url);
    audio.preload = 'metadata';
    audioRef.current = audio;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => {
      if (Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    const stopPlaying = () => {
      setPlaying(false);
      setCurrentTime(0);
    };

    const handlePause = () => setPlaying(false);
    const handlePlay = () => setPlaying(true);

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', stopPlaying);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('play', handlePlay);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('ended', stopPlaying);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('play', handlePlay);
      audioRef.current = null;
    };
  }, [url]);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;

    if (!audio.paused) {
      audio.pause();
      return;
    }

    if (
      Number.isFinite(audio.duration) &&
      audio.currentTime >= audio.duration - 0.2
    ) {
      audio.currentTime = 0;
    }

    try {
      await audio.play();
    } catch {
      setPlaying(false);
    }
  }

  const displayedTime = playing ? currentTime : duration;

  return (
    <button
      type="button"
      onClick={() => void togglePlayback()}
      className="flex min-w-[175px] items-center gap-3 text-left"
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          mine
            ? 'bg-black/15 text-black'
            : 'bg-tum-yellow/[0.15] text-tum-yellow'
        }`}
      >
        {playing ? (
          <Pause size={16} fill="currentColor" />
        ) : (
          <Play size={16} fill="currentColor" />
        )}
      </span>

      <span className="flex-1">
        <span className="flex h-6 items-center gap-1">
          {[8, 14, 10, 20, 12, 17, 9, 15, 11, 19, 8].map(
            (height, index) => (
              <span
                key={index}
                className={`w-1 rounded-full ${
                  mine ? 'bg-black/55' : 'bg-tum-yellow'
                }`}
                style={{ height }}
              />
            ),
          )}
        </span>
        <span
          className={`text-[11px] ${
            mine ? 'text-black/60' : 'text-white/50'
          }`}
        >
          {formatDuration(displayedTime)}
        </span>
      </span>
    </button>
  );
}

interface Props {
  rideId: string;
  driverName?: string | null;
  audioMode: AlertAudioMode;
}

export default function ChatPanel({
  rideId,
  driverName,
  audioMode,
}: Props) {
  const nativeActions = useNativeActions();
  const [messages, setMessages] = useState<RideChatMessage[]>([]);
  const [myProfileId, setMyProfileId] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [chatClosed, setChatClosed] = useState(false);
  const [rideStatus, setRideStatus] = useState('');
  const [reportConfirmVisible, setReportConfirmVisible] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportSent, setReportSent] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const recordingTimerRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const myProfileIdRef = useRef('');
  const chatClosedRef = useRef(false);
  const mountedRef = useRef(true);
  const recordingAttemptRef = useRef(0);

  const canRecord = useMemo(
    () =>
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== 'undefined',
    [],
  );

  const scrollToEnd = useCallback(() => {
    window.setTimeout(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }, 60);
  }, []);

  const loadChatState = useCallback(async () => {
    const { data, error: stateError } = await supabase.rpc(
      'get_ride_chat_state_tum',
      {
        p_ride_id: rideId,
      },
    );

    if (stateError) throw stateError;

    const item =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : null;

    const closed = item?.closed === true || item?.can_send === false;
    setChatClosed(closed);
    setRideStatus(
      typeof item?.status === 'string'
        ? item.status
        : '',
    );

    return closed;
  }, [rideId]);

  const loadMessages = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('ride_chats')
      .select(`
        id,
        ride_id,
        sender_id,
        message,
        audio_url,
        message_type,
        audio_duration_seconds,
        quick_message_key,
        created_at
      `)
      .eq('ride_id', rideId)
      .order('created_at', { ascending: true });

    if (loadError) throw loadError;

    setMessages(
      (data ?? [])
        .map(normalizeMessage)
        .filter(
          (message): message is RideChatMessage =>
            message !== null,
        ),
    );
  }, [rideId]);

  useEffect(() => {
    let active = true;

    async function initialize() {
      setLoading(true);

      try {
        const [{ data: profileId, error: profileError }] =
          await Promise.all([
            supabase.rpc('current_profile_id_tum'),
            loadMessages(),
            loadChatState(),
          ]);

        if (profileError) throw profileError;
        if (!active) return;

        if (typeof profileId !== 'string' || !profileId) {
          throw new Error('Perfil do passageiro não encontrado.');
        }

        setMyProfileId(profileId);
        setError(null);
      } catch (caughtError) {
        if (!active) return;

        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Não foi possível carregar o chat.',
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [loadChatState, loadMessages, refreshKey]);

  useEffect(() => {
    myProfileIdRef.current = myProfileId;
  }, [myProfileId]);

  useEffect(() => {
    chatClosedRef.current = chatClosed;

    if (
      chatClosed &&
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      chunksRef.current = [];
      mediaRecorderRef.current.stop();
    }
  }, [chatClosed]);

  useEffect(() => {
    const channel = supabase
      .channel(`passenger-ride-chat-${rideId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ride_chats',
          filter: `ride_id=eq.${rideId}`,
        },
        (payload) => {
          const message = normalizeMessage(payload.new);
          if (!message) return;

          if (
            !chatClosedRef.current &&
            myProfileIdRef.current &&
            message.sender_id !== myProfileIdRef.current
          ) {
            if (!nativeActions) {
              void playPassengerAudioEvent('message_received', audioMode);
            }
            vibratePassenger(120);
          }

          setMessages((current) => mergeMessage(current, message));
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rides',
          filter: `id=eq.${rideId}`,
        },
        () => {
          void loadChatState().catch(() => undefined);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [audioMode, loadChatState, rideId]);

  useEffect(() => {
    scrollToEnd();
  }, [messages.length, scrollToEnd]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      chatClosedRef.current = true;
      recordingAttemptRef.current += 1;
      chunksRef.current = [];

      if (recordingTimerRef.current !== null) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }

      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== 'inactive'
      ) {
        mediaRecorderRef.current.stop();
      }

      mediaStreamRef.current
        ?.getTracks()
        .forEach((track) => track.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
    };
  }, []);

  async function sendMessage(options: {
    message?: string | null;
    audioUrl?: string | null;
    audioDurationSeconds?: number | null;
    quickMessageKey?: string | null;
  }): Promise<void> {
    if (chatClosedRef.current) {
      throw new Error(
        'O chat desta corrida foi encerrado porque a corrida já terminou.',
      );
    }

    const { data, error: sendError } = await supabase.rpc(
      'send_ride_chat_message_tum',
      {
        p_ride_id: rideId,
        p_message: options.message ?? null,
        p_audio_url: options.audioUrl ?? null,
        p_audio_duration_seconds:
          options.audioDurationSeconds ?? null,
        p_quick_message_key:
          options.quickMessageKey ?? null,
      },
    );

    if (sendError) throw sendError;

    const message = normalizeMessage(data);
    if (message) {
      setMessages((current) => mergeMessage(current, message));
    }
  }

  async function sendText() {
    const normalized = text.trim();
    if (!normalized || sending || chatClosed) return;

    setSending(true);
    setText('');

    try {
      await sendMessage({ message: normalized });
      setError(null);
    } catch (caughtError) {
      setText(normalized);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Não foi possível enviar a mensagem.',
      );
    } finally {
      setSending(false);
    }
  }

  async function sendQuickMessage(quickMessage: QuickMessage) {
    if (sending || chatClosed) return;

    setSending(true);

    try {
      await sendMessage({
        message: quickMessage.text,
        quickMessageKey: quickMessage.key,
      });
      setError(null);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Não foi possível enviar a mensagem rápida.',
      );
    } finally {
      setSending(false);
    }
  }

  async function uploadAndSendAudio(
    blob: Blob,
    durationSeconds: number,
  ) {
    if (chatClosedRef.current) {
      return;
    }

    setSending(true);

    try {
      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      if (userError || !userData.user?.id) {
        throw new Error('Passageiro não autenticado.');
      }

      const mimeType = blob.type || 'audio/webm';
      const extension = audioExtension(mimeType);
      const path = `${userData.user.id}/${rideId}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from('chat-audios')
        .upload(path, blob, {
          contentType: mimeType,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const audioUrl = supabase.storage
        .from('chat-audios')
        .getPublicUrl(path).data.publicUrl;

      await sendMessage({
        audioUrl,
        audioDurationSeconds: Math.max(
          1,
          Math.round(durationSeconds),
        ),
      });

      setError(null);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Não foi possível enviar o áudio.',
      );
    } finally {
      setSending(false);
    }
  }

  function clearRecordingResources() {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    mediaStreamRef.current
      ?.getTracks()
      .forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    setRecording(false);
    setRecordingSeconds(0);
  }

  async function startRecording() {
    if (chatClosed || !canRecord || sending) {
      setError(
        chatClosed
          ? 'O chat desta corrida já foi encerrado.'
          : 'A gravação de áudio não está disponível neste navegador.',
      );
      return;
    }

    const attempt = ++recordingAttemptRef.current;

    try {
      const microphoneAllowed = nativeActions?.ensureMicrophonePermission
        ? await nativeActions.ensureMicrophonePermission()
        : true;

      if (!microphoneAllowed) {
        setError(
          'Permita o uso do microfone nas configurações do Android para enviar áudio.',
        );
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (!mountedRef.current || attempt !== recordingAttemptRef.current || chatClosedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const mimeType = preferredAudioMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener('stop', () => {
        const durationSeconds = Math.max(
          1,
          Math.min(
            MAX_AUDIO_SECONDS,
            (Date.now() - recordingStartedAtRef.current) / 1000,
          ),
        );
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || 'audio/webm',
        });

        clearRecordingResources();

        if (blob.size > 0 && !chatClosedRef.current) {
          void uploadAndSendAudio(blob, durationSeconds);
        }
      });

      const playedStartSound = await playPassengerAudioEvent(
        'recording_started',
        audioMode,
      );

      if (playedStartSound) {
        await new Promise((resolve) => window.setTimeout(resolve, 520));
      }

      if (!mountedRef.current || attempt !== recordingAttemptRef.current || chatClosedRef.current) {
        chunksRef.current = [];
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        return;
      }

      recorder.start(250);
      setRecording(true);
      setRecordingSeconds(0);
      setError(null);

      recordingTimerRef.current = window.setInterval(() => {
        const elapsed = Math.floor(
          (Date.now() - recordingStartedAtRef.current) / 1000,
        );
        setRecordingSeconds(elapsed);

        if (
          elapsed >= MAX_AUDIO_SECONDS &&
          recorder.state !== 'inactive'
        ) {
          recorder.stop();
        }
      }, 250);
    } catch (caughtError) {
      if (mountedRef.current) {
        clearRecordingResources();
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Permita o uso do microfone para gravar áudio.',
        );
      } else {
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
      }
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }

  async function reportConversation() {
    if (reporting) return;

    setReporting(true);
    setError(null);

    try {
      const { data, error: reportError } = await supabase.rpc(
        'create_ride_chat_report_tum',
        {
          p_ride_id: rideId,
          p_note: null,
        },
      );

      if (reportError) throw reportError;

      const item =
        data && typeof data === 'object' && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : null;

      if (typeof item?.report_id !== 'string') {
        throw new Error('A denúncia não foi confirmada pelo servidor.');
      }

      setReportConfirmVisible(false);
      setReportSent(true);
    } catch (caughtError) {
      setReportConfirmVisible(false);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Não foi possível enviar a denúncia.',
      );
    } finally {
      setReporting(false);
    }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-tum-dark">
      <div className="border-b border-white/10 bg-tum-dark-2/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-tum-yellow/20 bg-tum-yellow/10">
            <MessageCircle size={20} className="text-tum-yellow" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold text-white">
              {driverName || 'Motorista'}
            </p>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-white/45">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  chatClosed ? 'bg-white/30' : 'bg-emerald-400'
                }`}
              />
              {chatClosed ? 'Chat encerrado' : 'Conversa desta corrida'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setReportConfirmVisible(true)}
            className="tum-press flex h-9 items-center gap-1.5 rounded-full border border-red-400/20 bg-red-500/10 px-3 text-[10px] font-bold text-red-200"
          >
            <Flag size={13} />
            Denunciar
          </button>
        </div>
      </div>

      {chatClosed ? (
        <div className="flex items-start gap-3 border-b border-tum-yellow/15 bg-tum-yellow/[0.07] px-4 py-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tum-yellow/10 text-tum-yellow">
            <Lock size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-white">Chat encerrado</p>
            <p className="mt-0.5 text-xs leading-5 text-white/50">
              Esta corrida já terminou. O histórico continua disponível,
              mas o envio de novas mensagens foi bloqueado.
            </p>
          </div>
        </div>
      ) : (
      <div className="border-b border-white/10 px-3 py-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">Mensagens rápidas</p>
          <p className="text-[10px] text-white/30">Toque para enviar</p>
        </div>
        <div className="scrollbar-hide flex gap-2 overflow-x-auto pb-1">
          {PASSENGER_QUICK_MESSAGES.map((quickMessage) => (
            <button
              key={quickMessage.key}
              type="button"
              onClick={() => void sendQuickMessage(quickMessage)}
              disabled={sending || recording}
              className="tum-press shrink-0 rounded-full border border-tum-yellow/25 bg-tum-yellow/10 px-3 py-2 text-xs font-semibold text-tum-yellow transition hover:bg-tum-yellow/20 disabled:opacity-40"
            >
              {quickMessage.text}
            </button>
          ))}
        </div>
      </div>
      )}

      <div
        ref={scrollRef}
        className="scrollbar-hide flex-1 space-y-3 overflow-y-auto px-3 py-4"
      >
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-tum-yellow/20 bg-tum-yellow/10">
              <Loader2 className="animate-spin text-tum-yellow" size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Abrindo conversa</p>
              <p className="mt-1 text-xs text-white/40">Sincronizando as mensagens desta corrida.</p>
            </div>
          </div>
        ) : error && messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/10">
              <AlertCircle className="text-red-300" size={24} />
            </div>
            <p className="font-bold text-white">Não foi possível abrir o chat</p>
            <p className="mt-1 max-w-[280px] text-sm leading-5 text-white/45">{error}</p>
            <button
              type="button"
              onClick={() => setRefreshKey((value) => value + 1)}
              className="tum-press mt-4 inline-flex items-center gap-2 rounded-xl bg-tum-yellow px-4 py-2.5 text-sm font-extrabold text-black"
            >
              <RefreshCw size={15} />
              Tentar novamente
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-tum-yellow/20 bg-tum-yellow/10">
              <MessageCircle className="text-tum-yellow" size={24} />
            </div>
            <p className="font-bold text-white">Conversa pronta</p>
            <p className="mt-1 max-w-[280px] text-sm leading-5 text-white/45">
              {chatClosed
                ? 'As mensagens desta corrida ficam disponíveis somente para consulta.'
                : 'Fale com o motorista por texto, mensagem rápida ou áudio durante esta corrida.'}
            </p>
          </div>
        ) : (
          messages.map((message) => {
            const mine = message.sender_id === myProfileId;

            return (
              <div
                key={message.id}
                className={`flex ${
                  mine ? 'justify-end' : 'justify-start'
                }`}
              >
                <div className="max-w-[82%]">
                  {!mine && (
                    <p className="mb-1 pl-1 text-[11px] font-semibold text-tum-yellow">
                      {driverName || 'Motorista'}
                    </p>
                  )}

                  <div
                    className={`rounded-2xl px-3 py-2.5 shadow-lg ${
                      mine
                        ? 'rounded-br-sm bg-tum-yellow text-black'
                        : 'rounded-bl-sm border border-white/10 bg-tum-dark-3 text-white'
                    }`}
                  >
                    {message.message_type === 'audio' &&
                    message.audio_url ? (
                      <AudioMessage
                        url={message.audio_url}
                        durationSeconds={
                          message.audio_duration_seconds
                        }
                        mine={mine}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {message.message || ''}
                      </p>
                    )}

                    <div
                      className={`mt-1 flex items-center justify-end gap-1 ${
                        mine ? 'text-black/55' : 'text-white/40'
                      }`}
                    >
                      <span className="text-[10px]">
                        {formatClock(message.created_at)}
                      </span>
                      {mine && <CheckCheck size={12} />}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {reportSent && (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-100">
          <ShieldCheck size={15} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">Denúncia enviada</p>
            <p className="mt-0.5 leading-4 text-emerald-100/75">
              As mensagens da conversa foram copiadas para análise da equipe TUM.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReportSent(false)}
            className="text-[11px] font-bold text-white/55"
          >
            OK
          </button>
        </div>
      )}

      {error && messages.length > 0 && (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-500/10 px-3 py-2.5 text-xs text-red-200">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">Não foi possível concluir a ação</p>
            <p className="mt-0.5 leading-4 text-red-200/75">{error}</p>
          </div>
          <button type="button" onClick={() => setError(null)} className="text-[11px] font-bold text-white/55">OK</button>
        </div>
      )}

      {!chatClosed && recording && (
        <div className="mx-3 mb-2 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
            <span className="text-sm font-semibold text-red-300">
              Gravando {formatDuration(recordingSeconds)}
            </span>
          </div>
          <span className="text-xs text-white/40">
            máximo {MAX_AUDIO_SECONDS}s
          </span>
        </div>
      )}

      {!chatClosed ? (
      <div className="border-t border-white/10 bg-tum-dark-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={
              recording
                ? stopRecording
                : () => void startRecording()
            }
            disabled={sending || !canRecord}
            aria-label={
              recording ? 'Parar gravação' : 'Gravar áudio'
            }
            className={`tum-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition disabled:opacity-40 ${
              recording
                ? 'bg-red-500 text-white'
                : 'bg-tum-dark-3 text-white'
            }`}
          >
            {recording ? <Square size={18} fill="currentColor" /> : <Mic size={19} />}
          </button>

          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void sendText();
              }
            }}
            disabled={recording}
            placeholder={
              recording ? 'Gravando áudio...' : 'Digite uma mensagem'
            }
            rows={1}
            className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-white/10 bg-tum-dark-3 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-tum-yellow/50 disabled:opacity-50"
          />

          <button
            type="button"
            onClick={() => void sendText()}
            disabled={!text.trim() || sending || recording}
            aria-label="Enviar mensagem"
            className="tum-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tum-yellow text-black transition disabled:opacity-40"
          >
            {sending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
      </div>
      ) : (
        <div className="border-t border-white/10 bg-tum-dark-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-center">
            <p className="text-xs font-bold text-white/75">
              Conversa somente para consulta
            </p>
            <p className="mt-1 text-[11px] leading-4 text-white/40">
              Status da corrida: {rideStatus || 'encerrada'}
            </p>
            <button
              type="button"
              onClick={() => setReportConfirmVisible(true)}
              className="tum-press mt-3 inline-flex items-center gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-2.5 text-xs font-extrabold text-red-200"
            >
              <Flag size={14} />
              Denunciar conversa
            </button>
          </div>
        </div>
      )}

      {reportConfirmVisible && (
        <div className="absolute inset-0 z-[120] flex items-center justify-center bg-black/75 px-5">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-tum-dark-2 p-5 shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-red-400/20 bg-red-500/10 text-red-300">
              <Flag size={24} />
            </div>
            <h3 className="mt-4 text-center text-lg font-black text-white">
              Denunciar esta conversa?
            </h3>
            <p className="mt-2 text-center text-sm leading-5 text-white/50">
              As mensagens mais recentes desta corrida serão anexadas
              automaticamente para análise da equipe TUM.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={reporting}
                onClick={() => setReportConfirmVisible(false)}
                className="tum-press rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm font-bold text-white/70 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={reporting}
                onClick={() => void reportConversation()}
                className="tum-press flex items-center justify-center gap-2 rounded-xl bg-red-500 px-3 py-3 text-sm font-extrabold text-white disabled:opacity-50"
              >
                {reporting ? <Loader2 size={16} className="animate-spin" /> : <Flag size={16} />}
                Denunciar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
