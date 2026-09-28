import type {
  SafetyCaptureMode,
  SafetyCompatibility,
  SafetyConfigureInput,
  SafetyRecordingNativeStatus,
} from './index';

type PendingSegment = {
  sequence: number;
  blob: Blob;
  mimeType: 'video/mp4' | 'audio/mp4' | 'audio/aac';
  storageContentType: string;
  extension: 'mp4' | 'aac';
  startedAt: string;
  endedAt: string;
  durationMs: number;
};

type StartResponse = {
  id: string;
  started_at?: string;
};

let context: SafetyConfigureInput | null = null;
let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let desiredRecording = false;
let recordingId: string | null = null;
let startedAt: number | null = null;
let sequence = 0;
let segmentStartedAt = 0;
let segmentTimer: number | null = null;
let segmentChunks: BlobPart[] = [];
let pendingSegments: PendingSegment[] = [];
let flushPromise: Promise<void> | null = null;
let stopPromise: Promise<void> | null = null;
let stopResolve: (() => void) | null = null;
let lastError: string | null = null;

const SEGMENT_MS = 8_000;

function available(): boolean {
  return typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined';
}

function baseMime(value: string): 'video/mp4' | 'audio/mp4' | 'audio/aac' | null {
  const normalized = value.split(';')[0]?.trim().toLowerCase();
  if (normalized === 'video/mp4' || normalized === 'audio/mp4' || normalized === 'audio/aac') return normalized;
  return null;
}

function pickMime(mode: SafetyCaptureMode): string | null {
  if (!available()) return null;
  const candidates = mode === 'audio_only'
    ? [
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/aac',
      ]
    : [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=avc1.424028,mp4a.40.2',
        'video/mp4',
      ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null;
}

async function permissionGranted(name: 'camera' | 'microphone'): Promise<boolean> {
  try {
    if (!navigator.permissions?.query) return false;
    const result = await navigator.permissions.query({ name: name as PermissionName });
    return result.state === 'granted';
  } catch {
    return false;
  }
}

export async function getWebSafetyCompatibility(): Promise<SafetyCompatibility> {
  const supported = available();
  const videoMime = supported ? pickMime('video_audio') : null;
  const audioMime = supported ? pickMime('audio_only') : null;
  const [cameraPermission, microphonePermission] = supported
    ? await Promise.all([permissionGranted('camera'), permissionGranted('microphone')])
    : [false, false];

  return {
    platform: 'web',
    cameraPermission,
    microphonePermission,
    videoSupported: Boolean(videoMime),
    audioSupported: Boolean(audioMime),
    frontCamera: Boolean(videoMime),
    backCamera: Boolean(videoMime),
    // Navegadores móveis podem suspender câmera/microfone ao bloquear a tela,
    // trocar de app ou encerrar o processo. Nunca prometemos segundo plano real.
    backgroundRecording: false,
    continuousSegments: Boolean(videoMime || audioMime),
  };
}

function mediaConstraints(mode: SafetyCaptureMode): MediaStreamConstraints {
  if (!context) throw new Error('Contexto da corrida não preparado.');
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  if (mode === 'audio_only') return { audio, video: false };

  const quality = context.qualityPreset;
  const dimensions = quality === 'clear'
    ? { width: 1280, height: 720, frameRate: 30 }
    : quality === 'data_saver'
      ? { width: 480, height: 360, frameRate: 20 }
      : { width: 640, height: 480, frameRate: 24 };

  return {
    audio,
    video: {
      facingMode: { ideal: context.cameraFacing === 'back' ? 'environment' : 'user' },
      width: { ideal: dimensions.width },
      height: { ideal: dimensions.height },
      frameRate: { ideal: dimensions.frameRate, max: 30 },
    },
  };
}

function recorderOptions(mode: SafetyCaptureMode, mimeType: string): MediaRecorderOptions {
  if (!context) return { mimeType };
  if (mode === 'audio_only') {
    return {
      mimeType,
      audioBitsPerSecond: context.qualityPreset === 'clear' ? 128_000 : context.qualityPreset === 'data_saver' ? 48_000 : 80_000,
    };
  }

  return {
    mimeType,
    audioBitsPerSecond: context.qualityPreset === 'clear' ? 128_000 : 80_000,
    videoBitsPerSecond: context.qualityPreset === 'clear' ? 2_400_000 : context.qualityPreset === 'data_saver' ? 700_000 : 1_350_000,
  };
}

function stopTracks() {
  stream?.getTracks().forEach((track) => {
    try { track.stop(); } catch {}
  });
  stream = null;
}

async function refreshAccessToken(): Promise<boolean> {
  if (!context?.refreshToken) return false;
  try {
    const response = await fetch(`${context.supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: context.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: context.refreshToken }),
    });
    if (!response.ok) return false;
    const data = await response.json();
    if (!data?.access_token) return false;
    context = {
      ...context,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || context.refreshToken,
    };
    return true;
  } catch {
    return false;
  }
}

async function apiFetch(path: string, init: RequestInit, retry = true): Promise<Response> {
  if (!context) throw new Error('Sessão do TUM indisponível.');
  const response = await fetch(`${context.supabaseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      apikey: context.anonKey,
      Authorization: `Bearer ${context.accessToken}`,
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 401 && retry && await refreshAccessToken()) {
    return apiFetch(path, init, false);
  }
  return response;
}

async function rpc<T = any>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await apiFetch(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Falha no servidor (${response.status}).`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

function encodedStoragePath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function uploadSegment(segment: PendingSegment): Promise<void> {
  if (!context || !recordingId) throw new Error('Gravação não preparada.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Sem internet. O trecho será reenviado enquanto esta sessão continuar aberta.');
  }

  const path = `${context.authUserId}/${recordingId}/${String(segment.sequence).padStart(5, '0')}.${segment.extension}`;
  const upload = await apiFetch(`/storage/v1/object/safety-recordings/${encodedStoragePath(path)}`, {
    method: 'POST',
    headers: {
      'Content-Type': segment.storageContentType,
      'x-upsert': 'false',
    },
    body: segment.blob,
  });

  // 409 significa que o mesmo trecho já chegou ao Storage numa tentativa anterior.
  if (!upload.ok && upload.status !== 409) {
    const text = await upload.text();
    throw new Error(text || `Falha no upload (${upload.status}).`);
  }

  await rpc('register_safety_recording_segment_tum', {
    p_recording_id: recordingId,
    p_sequence: segment.sequence,
    p_storage_path: path,
    p_mime_type: segment.mimeType,
    p_byte_size: segment.blob.size,
    p_duration_ms: segment.durationMs,
    p_segment_started_at: segment.startedAt,
    p_segment_ended_at: segment.endedAt,
  });
}

async function flushPendingSegments(): Promise<void> {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    while (pendingSegments.length) {
      const segment = pendingSegments[0]!;
      try {
        await uploadSegment(segment);
        pendingSegments.shift();
        lastError = null;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Falha ao enviar trecho de segurança.';
        break;
      }
    }
  })().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

function scheduleNextSegment() {
  if (segmentTimer !== null) window.clearTimeout(segmentTimer);
  segmentTimer = window.setTimeout(() => {
    segmentTimer = null;
    if (recorder?.state === 'recording') recorder.stop();
  }, SEGMENT_MS);
}

function beginSegment() {
  if (!desiredRecording || !stream || !context) return;
  const mimeType = pickMime(context.captureMode);
  if (!mimeType) throw new Error('Este navegador não oferece gravação MP4 compatível com o TUM.');

  segmentChunks = [];
  segmentStartedAt = Date.now();
  const nextRecorder = new MediaRecorder(stream, recorderOptions(context.captureMode, mimeType));
  recorder = nextRecorder;

  nextRecorder.ondataavailable = (event) => {
    if (event.data?.size) segmentChunks.push(event.data);
  };

  nextRecorder.onerror = (event) => {
    const mediaError = (event as Event & { error?: DOMException }).error;
    lastError = mediaError?.message || 'O navegador interrompeu a gravação.';
  };

  nextRecorder.onstop = () => {
    const endedAtMs = Date.now();
    if (segmentTimer !== null) {
      window.clearTimeout(segmentTimer);
      segmentTimer = null;
    }

    const actualMime = nextRecorder.mimeType || mimeType;
    const rpcMime = baseMime(actualMime);
    const parts = segmentChunks;
    segmentChunks = [];

    if (parts.length && rpcMime) {
      const blob = new Blob(parts, { type: actualMime });
      if (blob.size > 0) {
        pendingSegments.push({
          sequence: sequence++,
          blob,
          mimeType: rpcMime,
          storageContentType: actualMime,
          extension: rpcMime === 'audio/aac' ? 'aac' : 'mp4',
          startedAt: new Date(segmentStartedAt).toISOString(),
          endedAt: new Date(endedAtMs).toISOString(),
          durationMs: Math.max(0, endedAtMs - segmentStartedAt),
        });
        void flushPendingSegments();
      }
    }

    recorder = null;

    // Começa o próximo arquivo antes de esperar a rede, reduzindo a lacuna entre segmentos.
    if (desiredRecording && stream?.active) {
      try {
        beginSegment();
      } catch (error) {
        desiredRecording = false;
        lastError = error instanceof Error ? error.message : 'Não foi possível continuar a gravação.';
        stopTracks();
      }
    } else {
      stopResolve?.();
      stopResolve = null;
      stopPromise = null;
    }
  };

  nextRecorder.start();
  scheduleNextSegment();
}

export async function requestWebSafetyPermissions(mode: SafetyCaptureMode): Promise<boolean> {
  if (!available() || !pickMime(mode)) return false;
  if (!context) {
    // A tela de configurações pode pedir a autorização antes de existir uma corrida.
    const constraints: MediaStreamConstraints = mode === 'audio_only'
      ? { audio: true, video: false }
      : { audio: true, video: { facingMode: 'user' } };
    try {
      const test = await navigator.mediaDevices.getUserMedia(constraints);
      test.getTracks().forEach((track) => track.stop());
      return true;
    } catch {
      return false;
    }
  }

  try {
    const test = await navigator.mediaDevices.getUserMedia(mediaConstraints(mode));
    test.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}

export async function configureWebSafetyRideContext(input: SafetyConfigureInput): Promise<boolean> {
  context = { ...input };
  return true;
}

export async function clearWebSafetyRideContext(): Promise<boolean> {
  if (desiredRecording || recorder?.state === 'recording') await stopWebSafetyRecording();
  context = null;
  return true;
}

export async function startWebSafetyRecording(): Promise<boolean> {
  if (!context?.featureEnabled) {
    lastError = 'A gravação de segurança não está habilitada.';
    return false;
  }
  if (desiredRecording || recorder?.state === 'recording') return true;
  if (!available()) {
    lastError = 'Este navegador não oferece MediaRecorder/câmera compatível.';
    return false;
  }

  const mime = pickMime(context.captureMode);
  if (!mime) {
    lastError = 'Este navegador não oferece gravação MP4 compatível com o TUM.';
    return false;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia(mediaConstraints(context.captureMode));
    const start = await rpc<StartResponse>('start_safety_recording_tum', {
      p_ride_id: context.rideId,
      p_camera_facing: context.cameraFacing,
      p_capture_mode: context.captureMode,
      p_device_platform: 'web-pwa',
      p_device_model: navigator.userAgent.slice(0, 180),
      p_app_version: context.appVersion || '1.0.0',
    });

    recordingId = start.id;
    startedAt = start.started_at ? new Date(start.started_at).getTime() : Date.now();
    sequence = 0;
    pendingSegments = [];
    lastError = null;
    desiredRecording = true;

    stream.getTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        if (!desiredRecording) return;
        desiredRecording = false;
        lastError = 'O navegador interrompeu a câmera ou o microfone. Abra o TUM e inicie o REC novamente.';
        if (recorder?.state === 'recording') recorder.stop();
      });
    });

    beginSegment();
    return true;
  } catch (error) {
    desiredRecording = false;
    stopTracks();
    lastError = error instanceof Error ? error.message : 'Não foi possível iniciar a gravação no navegador.';
    if (recordingId) {
      try { await rpc('stop_safety_recording_tum', { p_recording_id: recordingId, p_ended_at: new Date().toISOString() }); } catch {}
      try { await rpc('complete_safety_recording_tum', { p_recording_id: recordingId }); } catch {}
    }
    recordingId = null;
    startedAt = null;
    return false;
  }
}

export async function stopWebSafetyRecording(): Promise<boolean> {
  if (!recordingId && !desiredRecording && recorder?.state !== 'recording') {
    stopTracks();
    return true;
  }

  desiredRecording = false;
  if (segmentTimer !== null) {
    window.clearTimeout(segmentTimer);
    segmentTimer = null;
  }

  if (recorder && recorder.state !== 'inactive') {
    stopPromise = new Promise<void>((resolve) => { stopResolve = resolve; });
    recorder.stop();
    await stopPromise;
  }
  stopTracks();

  const id = recordingId;
  if (!id) return true;

  try {
    await rpc('stop_safety_recording_tum', {
      p_recording_id: id,
      p_ended_at: new Date().toISOString(),
    });
    await flushPendingSegments();
    if (pendingSegments.length === 0) {
      await rpc('complete_safety_recording_tum', { p_recording_id: id });
      recordingId = null;
      startedAt = null;
      lastError = null;
    } else {
      lastError = lastError || 'Existem trechos aguardando internet para envio.';
    }
    return true;
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'Falha ao finalizar a gravação.';
    return false;
  }
}

export async function retryWebSafetyUploads(): Promise<boolean> {
  if (!recordingId) return true;
  await flushPendingSegments();
  if (!desiredRecording && pendingSegments.length === 0) {
    try {
      await rpc('complete_safety_recording_tum', { p_recording_id: recordingId });
      recordingId = null;
      startedAt = null;
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Não foi possível concluir a gravação.';
      return false;
    }
  }
  return pendingSegments.length === 0;
}

export async function getWebSafetyStatus(): Promise<SafetyRecordingNativeStatus> {
  return {
    featureEnabled: Boolean(context?.featureEnabled),
    rideId: context?.rideId ?? null,
    recording: Boolean(desiredRecording && recorder?.state === 'recording'),
    recordingId,
    startedAt,
    pendingSegments: pendingSegments.length,
    lastError,
    cameraFacing: context?.cameraFacing ?? 'front',
    captureMode: context?.captureMode ?? 'video_audio',
  };
}
