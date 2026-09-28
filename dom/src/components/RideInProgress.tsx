import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Car,
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  CreditCard,
  ImagePlus,
  MapPin,
  MessageSquare,
  Navigation,
  QrCode,
  RefreshCw,
  Route,
  Search,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import type { DriverLocation, Profile, Ride, RideStop } from '../lib/types';
import { formatBRL } from '../lib/categories';
import ChatPanel from './ChatPanel';
import SafetyCenter from './SafetyCenter';
import AlertModal, { type AlertModalVariant } from './AlertModal';
import type { AlertAudioMode } from '../lib/audioPreferences';
import { loadCancellationReasons, type CancellationReason } from '../lib/cancellation';
import { useNativeActions } from '../lib/nativeActions';
import { finishPassengerSafetyRecording, listMySafetyRecordings, loadSafetyRecordingState, preparePassengerSafetyRecording, type SafetyRecordingRow } from '../lib/safetyRecording';
import { submitPassengerUserReport, USER_REPORT_REASONS, type UserReportReason } from '../lib/userReports';
import { supabase } from '../lib/supabase';
import { createOrLoadRidePixCheckout, loadRidePixPayment, type RidePixPayment } from '../lib/ridePayments';

interface Props {
  profile: Profile;
  ride: Ride;
  driver: DriverLocation | null;
  stops: RideStop[];
  etaMin: number | null;
  audioMode: AlertAudioMode;
  onCancel: (reasonCode: string, reasonNote?: string) => void | Promise<void>;
  onFindAnotherDriver: () => void | Promise<void>;
  onFinish: (stars: number, comment: string) => void | Promise<void>;
}

type ReportEvidenceSelection = { file: File; previewUrl: string };
type TumAlertState = { title: string; message: string; variant: AlertModalVariant };
type LiveFareState = { currentAmount: number; distanceKm: number; durationMinutes: number };

function isWaiting(status: Ride['status']): boolean {
  return ['driver_arrived', 'arrived', 'waiting'].includes(status);
}

function isInProgress(status: Ride['status']): boolean {
  return ['started', 'in_progress'].includes(status);
}

function statusTitle(status: Ride['status']): string {
  if (status === 'queued') return 'Motorista confirmado — você está na fila';
  if (status === 'accepted') return 'Seu motorista está a caminho';
  if (isWaiting(status)) return 'Seu motorista chegou';
  if (isInProgress(status)) return 'Viagem em andamento';
  if (status === 'completed') return 'Corrida finalizada';
  return 'Corrida ativa';
}

function statusDescription(status: Ride['status']): string {
  if (status === 'queued') {
    return 'Seu motorista está finalizando outra corrida. Você pode acompanhar a posição dele, o trecho restante em vermelho e o caminho até você em amarelo.';
  }

  if (status === 'accepted') {
    return 'Acompanhe a aproximação e confira o veículo antes de embarcar.';
  }

  if (isWaiting(status)) {
    return 'O motorista já está no ponto de embarque aguardando você.';
  }

  if (isInProgress(status)) {
    return 'Você está a caminho do destino. Acompanhe a rota pelo mapa.';
  }

  return 'Acompanhe abaixo os detalhes da sua corrida.';
}

function paymentMethodLabel(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (normalized.includes('pix')) return 'Pix';
  if (normalized.includes('dinheiro') || normalized.includes('cash')) {
    return 'Dinheiro';
  }
  if (
    normalized.includes('cart') ||
    normalized.includes('card') ||
    normalized.includes('credito') ||
    normalized.includes('crédito')
  ) {
    return 'Cartão';
  }

  return value || 'Não informado';
}

function safeAddress(value: string | null, fallback: string): string {
  const cleaned = value?.trim();
  return cleaned || fallback;
}

function formatWaitingClock(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function ratingLabel(stars: number): string {
  if (stars <= 1) return 'Muito ruim';
  if (stars === 2) return 'Ruim';
  if (stars === 3) return 'Regular';
  if (stars === 4) return 'Muito boa';
  return 'Excelente';
}

export default function RideInProgress({
  profile,
  ride,
  driver,
  stops,
  etaMin,
  audioMode,
  onCancel,
  onFindAnotherDriver,
  onFinish,
}: Props) {
  const nativeActions = useNativeActions();
  const [showChat, setShowChat] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [showRating, setShowRating] = useState(
    ride.status === 'completed',
  );
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [copied, setCopied] = useState(false);
  const [submittingRating, setSubmittingRating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [switchingDriver, setSwitchingDriver] = useState(false);
  const [queueInfoOpen, setQueueInfoOpen] = useState(false);
  const queueInfoShownRideRef = useRef<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReasons, setCancelReasons] = useState<CancellationReason[]>([]);
  const [cancelReasonCode, setCancelReasonCode] = useState('');
  const [cancelReasonNote, setCancelReasonNote] = useState('');
  const [cancelReasonsLoading, setCancelReasonsLoading] = useState(false);
  const [safetyEnabled, setSafetyEnabled] = useState(false);
  const [safetyStatus, setSafetyStatus] = useState<any>(null);
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<UserReportReason>('aggressive_behavior');
  const [reportDescription, setReportDescription] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [reportEvidence, setReportEvidence] = useState<ReportEvidenceSelection | null>(null);
  const [reportSafetyVideos, setReportSafetyVideos] = useState<SafetyRecordingRow[]>([]);
  const [reportSafetyLoading, setReportSafetyLoading] = useState(false);
  const [selectedSafetyRecordingId, setSelectedSafetyRecordingId] = useState('');
  const [reportReasonsOpen, setReportReasonsOpen] = useState(false);
  const [tumAlert, setTumAlert] = useState<TumAlertState | null>(null);
  const [stopRecordingConfirmOpen, setStopRecordingConfirmOpen] = useState(false);
  const [liveFare, setLiveFare] = useState<LiveFareState | null>(null);
  const [waitingElapsedSeconds, setWaitingElapsedSeconds] = useState(0);
  const [pixPaymentMode, setPixPaymentMode] = useState<'idle' | 'loading' | 'asaas' | 'direct' | 'error'>('idle');
  const [ridePixPayment, setRidePixPayment] = useState<RidePixPayment | null>(null);
  const [pixPaymentError, setPixPaymentError] = useState<string | null>(null);
  const [pixCodeCopied, setPixCodeCopied] = useState(false);
  const [pixRefreshing, setPixRefreshing] = useState(false);

  const reportCameraInputRef = useRef<HTMLInputElement | null>(null);
  const reportGalleryInputRef = useRef<HTMLInputElement | null>(null);
  const rideIdRef = useRef(ride.id);
  const safetyEffectSequenceRef = useRef(0);
  const paymentPollInFlightRef = useRef(false);
  const liveFareInFlightRef = useRef(false);
  rideIdRef.current = ride.id;

  useEffect(() => {
    if (ride.status === 'completed') {
      setShowRating(true);
    }
  }, [ride.status]);

  const isPixPayment = ride.payment_method.trim().toLowerCase().includes('pix');

  useEffect(() => {
    setPixPaymentMode('idle');
    setRidePixPayment(null);
    setPixPaymentError(null);
    setPixCodeCopied(false);

    if (ride.status === 'completed' && isPixPayment) {
      void prepareRidePixPayment();
    }
  }, [ride.id, ride.status, isPixPayment]);

  useEffect(() => {
    if (pixPaymentMode !== 'asaas' || !ridePixPayment?.id || ridePixPayment.paid_at) return;

    let active = true;
    const refresh = async () => {
      if (document.visibilityState !== 'visible' || paymentPollInFlightRef.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      paymentPollInFlightRef.current = true;
      try {
        const payment = await loadRidePixPayment(ridePixPayment.id);
        if (active && payment && rideIdRef.current === ride.id) setRidePixPayment(payment);
      } catch (error) {
        console.warn('[TUM] Não foi possível atualizar o pagamento PIX:', error);
      } finally {
        paymentPollInFlightRef.current = false;
      }
    };

    const timer = window.setInterval(() => void refresh(), 2500);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pixPaymentMode, ridePixPayment?.id, ridePixPayment?.paid_at]);

  useEffect(() => {
    setReportOpen(false);
    setReportReason('aggressive_behavior');
    setReportDescription('');
    setReportSubmitted(false);
    setReportSafetyVideos([]);
    setSelectedSafetyRecordingId('');
    setReportReasonsOpen(false);
    setReportEvidence((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  }, [ride.id]);

  useEffect(() => {
    return () => {
      if (reportEvidence?.previewUrl) URL.revokeObjectURL(reportEvidence.previewUrl);
    };
  }, [reportEvidence]);

  useEffect(() => {
    if (!reportOpen) return;
    let active = true;
    setReportSafetyLoading(true);
    void listMySafetyRecordings()
      .then((rows) => {
        if (!active) return;
        const videos = rows.filter((row) =>
          row.ride_id === ride.id &&
          row.user_type === 'passenger' &&
          row.capture_mode !== 'audio_only' &&
          row.status !== 'deleted' &&
          row.status !== 'failed'
        );
        setReportSafetyVideos(videos);
      })
      .catch((error) => console.warn('[TUM] Não foi possível listar vídeos de segurança da corrida:', error))
      .finally(() => { if (active) setReportSafetyLoading(false); });
    return () => { active = false; };
  }, [reportOpen, ride.id]);

  useEffect(() => {
    let active = true;
    const sequence = ++safetyEffectSequenceRef.current;

    void loadSafetyRecordingState().then(async state => {
      if (!active || sequence !== safetyEffectSequenceRef.current) return;
      const compat = await nativeActions?.getSafetyCompatibility?.();
      if (!active || sequence !== safetyEffectSequenceRef.current) return;

      const captureSupported = state.capture_mode === 'audio_only'
        ? !!compat?.audioSupported
        : !!compat?.videoSupported;
      const canRecord = captureSupported && (compat?.platform === 'web' || !!compat?.backgroundRecording);
      setSafetyEnabled(Boolean(state.enabled && state.passenger_enabled && canRecord));

      if (['completed', 'cancelled'].includes(ride.status) || !canRecord) {
        await finishPassengerSafetyRecording(nativeActions);
      } else {
        await preparePassengerSafetyRecording(ride.id, state, nativeActions);
        if (!active || sequence !== safetyEffectSequenceRef.current) return;
        await nativeActions?.retrySafetyRecordingUploads?.();
      }

      if (!active || sequence !== safetyEffectSequenceRef.current) return;
      const status = await nativeActions?.getSafetyRecordingStatus?.();
      if (active && sequence === safetyEffectSequenceRef.current) setSafetyStatus(status);
    }).catch(error => {
      if (active && sequence === safetyEffectSequenceRef.current) {
        console.warn('[TUM] Gravação de segurança indisponível:', error);
      }
    });

    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void nativeActions?.getSafetyRecordingStatus?.()
        .then(status => {
          if (active && sequence === safetyEffectSequenceRef.current && status) {
            setSafetyStatus(status);
          }
        })
        .catch(() => undefined);
    }, 1500);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [ride.id, ride.status, nativeActions]);

  async function toggleSafetyRecording() {
    if (safetyBusy) return;
    if (!safetyEnabled) { setShowSafety(true); return; }
    setSafetyBusy(true);
    try {
      const current = await nativeActions?.getSafetyRecordingStatus?.();
      if (current?.recording) {
        setSafetyBusy(false);
        setStopRecordingConfirmOpen(true);
        return;
      }

      const state = await loadSafetyRecordingState();
      const allowed = await nativeActions?.requestSafetyPermissions?.(state.capture_mode);
      if (!allowed) { setShowSafety(true); return; }

      await preparePassengerSafetyRecording(ride.id,state,nativeActions);
      const requested = await nativeActions?.startSafetyRecording?.();
      if (!requested) throw new Error('O aparelho ou navegador não aceitou o pedido para iniciar a gravação.');

      // Não libera o botão imediatamente. O serviço nativo cria a sessão no servidor
      // antes de a câmera terminar de abrir; foi exatamente nessa janela que os erros
      // encontrados no Motorista pareciam "não acontecer nada" e permitiam novos toques.
      // Mantemos o REC bloqueado e observamos o estado por alguns segundos.
      const deadline = Date.now() + 8_000;
      let activeSince = 0;
      let latest: any = null;
      while (Date.now() < deadline) {
        await new Promise(resolve => window.setTimeout(resolve, 250));
        latest = await nativeActions?.getSafetyRecordingStatus?.();
        if (latest) setSafetyStatus(latest);
        if (latest?.lastError) throw new Error(latest.lastError);
        if (latest?.recording) {
          if (!activeSince) activeSince = Date.now();
          // Exige 1 s de estado estável. Falhas de câmera/MediaRecorder costumam
          // acontecer logo após a sessão ser criada.
          if (Date.now() - activeSince >= 1_000) return;
        } else {
          activeSince = 0;
        }
      }

      throw new Error(latest?.lastError || 'A gravação demorou mais que o esperado para iniciar. Tente novamente.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível iniciar a gravação de segurança.';
      setTumAlert({ title: 'Gravação não iniciada', message, variant: 'error' });
      const latest = await nativeActions?.getSafetyRecordingStatus?.().catch(() => null);
      if (latest) setSafetyStatus(latest);
    } finally {
      setSafetyBusy(false);
    }
  }

  async function confirmStopSafetyRecording() {
    setStopRecordingConfirmOpen(false);
    setSafetyBusy(true);
    try {
      await nativeActions?.stopSafetyRecording?.();
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      const stopped = await nativeActions?.getSafetyRecordingStatus?.();
      if (stopped) setSafetyStatus(stopped);
    } catch (error) {
      setTumAlert({
        title: 'Não foi possível parar',
        message: error instanceof Error ? error.message : 'Tente novamente em alguns segundos.',
        variant: 'error',
      });
    } finally {
      setSafetyBusy(false);
    }
  }

  const estimatedAmount = Number(ride.final_amount ?? ride.amount ?? 0);
  const displayedAmount = liveFare?.currentAmount ?? estimatedAmount;

  const tripSummary = useMemo(() => {
    const distance = Number(
      liveFare?.distanceKm ?? ride.actual_distance_km ?? ride.distance_km ?? 0,
    );
    const duration = Number(
      liveFare?.durationMinutes ?? ride.actual_duration_minutes ?? ride.duration_minutes ?? 0,
    );

    return {
      distance: Number.isFinite(distance) ? distance : 0,
      duration: Number.isFinite(duration) ? duration : 0,
    };
  }, [
    liveFare?.distanceKm,
    liveFare?.durationMinutes,
    ride.actual_distance_km,
    ride.distance_km,
    ride.actual_duration_minutes,
    ride.duration_minutes,
  ]);

  const queued = ride.status === 'queued';
  const waiting = isWaiting(ride.status);
  const inProgress = isInProgress(ride.status);
  const driverName =
    driver?.driver_name?.trim() ||
    ride.driver_name?.trim() ||
    'Motorista confirmado';
  const vehicleModel =
    driver?.vehicle_model?.trim() ||
    ride.car_model?.trim() ||
    'Veículo confirmado';
  const vehiclePlate =
    driver?.plate?.trim() ||
    ride.plate?.trim() ||
    '';
  const driverPhoto =
    driver?.profile_photo_url ||
    ride.driver_photo ||
    null;
  const originAddress = safeAddress(
    ride.origin_address ?? ride.origin ?? null,
    'Local de embarque',
  );
  const destinationAddress = safeAddress(
    ride.destination_address ?? ride.destination ?? null,
    'Destino da corrida',
  );
  const paymentLabel = paymentMethodLabel(ride.payment_method);
  const orderedStops = [...stops].sort((a, b) => a.stop_order - b.stop_order);
  const currentStop = orderedStops.find((stop) => stop.status !== 'completed') ?? null;
  const statusAccent = waiting
    ? 'bg-emerald-500'
    : inProgress
      ? 'bg-blue-500'
      : 'bg-tum-yellow';
  const statusText = waiting
    ? 'text-emerald-400'
    : inProgress
      ? 'text-blue-400'
      : 'text-tum-yellow';
  const stageIndex = queued ? 0 : waiting ? 2 : inProgress ? 3 : 1;

  useEffect(() => {
    if (!waiting) {
      setWaitingElapsedSeconds(0);
      return;
    }

    const startedAtRaw = ride.waiting_started_at ?? ride.arrived_at;
    const startedAt = startedAtRaw ? new Date(startedAtRaw).getTime() : Date.now();

    const refresh = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      setWaitingElapsedSeconds(elapsed);
    };

    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [waiting, ride.waiting_started_at, ride.arrived_at, ride.id]);

  const journeyStages = [
    { label: 'Em fila', active: stageIndex >= 0 },
    { label: 'A caminho', active: stageIndex >= 1 },
    { label: 'Chegou', active: stageIndex >= 2 },
    { label: 'Em viagem', active: stageIndex >= 3 },
  ];

  useEffect(() => {
    if (!queued) {
      if (queueInfoShownRideRef.current === ride.id) {
        queueInfoShownRideRef.current = null;
      }
      setQueueInfoOpen(false);
      return;
    }

    if (queueInfoShownRideRef.current !== ride.id) {
      queueInfoShownRideRef.current = ride.id;
      setQueueInfoOpen(true);
    }
  }, [queued, ride.id]);

  useEffect(() => {
    if (!inProgress) {
      setLiveFare(null);
      return;
    }

    let active = true;
    const refreshLiveFare = async () => {
      if (document.visibilityState !== 'visible' || liveFareInFlightRef.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      liveFareInFlightRef.current = true;
      try {
        const requestedRideId = ride.id;
        const { data, error } = await supabase.rpc('get_passenger_live_ride_fare', {
          p_ride_id: requestedRideId,
        });
        if (error) throw error;
        if (!active || rideIdRef.current !== requestedRideId || !data?.success) return;
        setLiveFare({
          currentAmount: Number(data.current_amount ?? estimatedAmount),
          distanceKm: Number(data.actual_distance_km ?? 0),
          durationMinutes: Number(data.actual_duration_minutes ?? 0),
        });
      } catch (error) {
        console.warn('[TUM] Valor ao vivo temporariamente indisponível:', error);
      } finally {
        liveFareInFlightRef.current = false;
      }
    };

    void refreshLiveFare();
    const timer = window.setInterval(() => void refreshLiveFare(), 3000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshLiveFare();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [inProgress, ride.id, estimatedAmount]);

  async function prepareRidePixPayment() {
    if (!isPixPayment || ride.status !== 'completed') return;

    const requestedRideId = ride.id;
    setPixPaymentMode('loading');
    setPixPaymentError(null);

    try {
      const checkout = await createOrLoadRidePixCheckout(requestedRideId);
      if (rideIdRef.current !== requestedRideId) return;
      if (checkout.mode === 'direct_driver') {
        setRidePixPayment(null);
        setPixPaymentMode('direct');
        return;
      }

      setRidePixPayment(checkout.payment);
      setPixPaymentMode('asaas');
    } catch (error) {
      if (rideIdRef.current !== requestedRideId) return;
      setRidePixPayment(null);
      setPixPaymentMode('error');
      setPixPaymentError(error instanceof Error ? error.message : 'Não foi possível gerar o Pix da corrida.');
    }
  }

  async function refreshRidePixPayment() {
    if (!ridePixPayment?.id || pixRefreshing) return;
    setPixRefreshing(true);
    try {
      const payment = await loadRidePixPayment(ridePixPayment.id);
      if (payment) setRidePixPayment(payment);
    } catch (error) {
      setPixPaymentError(error instanceof Error ? error.message : 'Não foi possível atualizar o pagamento.');
    } finally {
      setPixRefreshing(false);
    }
  }

  function copyDriverPix() {
    const pixKey = driver?.pix_key ?? ride.driver_pix_key;
    if (!pixKey) return;

    void navigator.clipboard.writeText(pixKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function copyAsaasPix() {
    const payload = ridePixPayment?.pix_payload;
    if (!payload) return;

    void navigator.clipboard.writeText(payload);
    setPixCodeCopied(true);
    window.setTimeout(() => setPixCodeCopied(false), 2000);
  }


  async function submitRating() {
    if (isPixPayment && pixPaymentMode === 'asaas' && !ridePixPayment?.paid_at) {
      setTumAlert({
        title: 'Pagamento pendente',
        message: 'Confirme o Pix da corrida antes de finalizar a avaliação.',
        variant: 'warning',
      });
      return;
    }

    if (isPixPayment && (pixPaymentMode === 'loading' || pixPaymentMode === 'error' || pixPaymentMode === 'idle')) {
      setTumAlert({
        title: 'Pix ainda não preparado',
        message: 'Aguarde a geração do Pix ou tente novamente antes de concluir.',
        variant: 'warning',
      });
      return;
    }

    setSubmittingRating(true);

    try {
      await onFinish(stars, comment);
    } finally {
      setSubmittingRating(false);
    }
  }

  async function openCancelFlow() {
    setCancelOpen(true);
    if (cancelReasons.length > 0 || cancelReasonsLoading) return;
    setCancelReasonsLoading(true);
    try {
      const reasons = await loadCancellationReasons();
      setCancelReasons(reasons);
      setCancelReasonCode(reasons[0]?.code ?? '');
    } finally {
      setCancelReasonsLoading(false);
    }
  }

  async function cancelRide() {
    if (!cancelReasonCode) return;
    setCancelling(true);
    try {
      await onCancel(cancelReasonCode, cancelReasonNote);
      setCancelOpen(false);
    } finally {
      setCancelling(false);
    }
  }

  function openReportFlow() {
    if (!reportSubmitted) {
      setReportReasonsOpen(false);
      setReportOpen(true);
    }
  }

  function removeReportEvidence() {
    setReportEvidence((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    if (reportCameraInputRef.current) reportCameraInputRef.current.value = '';
    if (reportGalleryInputRef.current) reportGalleryInputRef.current.value = '';
  }

  function handleReportFile(file: File | null) {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setReportEvidence((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return { file, previewUrl };
    });
  }

  async function submitReport() {
    if (reportSubmitting || reportSubmitted) return;
    if (!reportReason) {
      setTumAlert({ title: 'Escolha um motivo', message: 'Selecione o motivo da denúncia antes de enviar.', variant: 'warning' });
      return;
    }

    setReportSubmitting(true);
    try {
      const result = await submitPassengerUserReport({
        rideId: ride.id,
        reason: reportReason,
        description: reportDescription,
        evidenceFile: reportEvidence?.file ?? null,
        safetyRecordingId: selectedSafetyRecordingId || null,
      });
      setReportSubmitted(true);
      setReportOpen(false);
      setTumAlert({
        title: 'Denúncia enviada',
        message: result.warnings.length > 0
          ? `A denúncia foi registrada. ${result.warnings.join(' ')}`
          : 'Nossa equipe recebeu a denúncia e vai analisar o caso.',
        variant: 'success',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível enviar a denúncia.';
      if (/já enviou uma denúncia/i.test(message)) {
        setReportSubmitted(true);
        setReportOpen(false);
      }
      setTumAlert({ title: 'Não foi possível enviar', message, variant: 'error' });
    } finally {
      setReportSubmitting(false);
    }
  }

  if (showRating) {
    const pixKey = driver?.pix_key ?? ride.driver_pix_key;
    const pixQrImage = ridePixPayment?.pix_qr_code_base64
      ? ridePixPayment.pix_qr_code_base64.startsWith('data:')
        ? ridePixPayment.pix_qr_code_base64
        : `data:image/png;base64,${ridePixPayment.pix_qr_code_base64}`
      : null;
    const pixPaid = Boolean(ridePixPayment?.paid_at);
    const ratingBlockedByPix = isPixPayment && (
      pixPaymentMode === 'loading' ||
      pixPaymentMode === 'error' ||
      pixPaymentMode === 'idle' ||
      (pixPaymentMode === 'asaas' && !pixPaid)
    );

    return (
      <div className="tum-rating-sheet absolute inset-0 z-40 overflow-y-auto bg-tum-dark-2 shadow-2xl">
        <div className="flex min-h-[100dvh] flex-col px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))]">
          <div className="mb-2 flex shrink-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15">
              <Check size={21} className="text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-black leading-tight text-white">Corrida finalizada</h3>
              <p className="truncate text-[11px] text-white/50">Valor confirmado · avalie sua experiência</p>
            </div>
          </div>

          <div className="mb-2 shrink-0 rounded-2xl border border-white/10 bg-tum-dark-3 px-3 py-2.5">
            <div className="flex items-center gap-2.5 tum-soft-enter">
              {driverPhoto ? (
                <img src={driverPhoto} alt={driverName} className="h-10 w-10 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tum-dark-2 text-base font-black text-tum-yellow">
                  {driverName.charAt(0).toUpperCase()}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">{driverName}</p>
                <p className="truncate text-[11px] text-white/50">{[vehicleModel, vehiclePlate].filter(Boolean).join(' · ')}</p>
              </div>

              <div className="shrink-0 text-right">
                <p className="text-[9px] font-bold uppercase tracking-wide text-white/35">Valor final</p>
                <p className="text-xl font-black leading-none text-tum-yellow">{formatBRL(displayedAmount)}</p>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-1.5 border-t border-white/10 pt-2 text-center">
              <div className="rounded-xl bg-white/[0.035] px-1 py-1.5">
                <p className="text-[9px] uppercase text-white/35">Distância</p>
                <p className="text-xs font-bold text-white">{tripSummary.distance.toFixed(1)} km</p>
              </div>
              <div className="rounded-xl bg-white/[0.035] px-1 py-1.5">
                <p className="text-[9px] uppercase text-white/35">Tempo</p>
                <p className="text-xs font-bold text-white">{Math.ceil(tripSummary.duration)} min</p>
              </div>
              <div className="rounded-xl bg-white/[0.035] px-1 py-1.5">
                <p className="text-[9px] uppercase text-white/35">Pagamento</p>
                <p className="truncate text-xs font-bold text-white">{paymentLabel}</p>
              </div>
            </div>

            {Number(ride.waiting_fee ?? 0) > 0 && (
              <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-white/50">
                <span>Taxa de espera</span>
                <span className="font-bold text-white">{formatBRL(Number(ride.waiting_fee ?? 0))}</span>
              </div>
            )}

            {isPixPayment && pixPaymentMode === 'loading' && (
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-tum-yellow/20 bg-tum-yellow/[0.06] px-3 py-2.5 text-[11px] font-semibold text-white/70">
                <RefreshCw size={15} className="shrink-0 animate-spin text-tum-yellow" />
                Preparando o Pix seguro da corrida...
              </div>
            )}

            {isPixPayment && pixPaymentMode === 'error' && (
              <div className="mt-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5">
                <p className="text-[11px] font-bold text-red-200">{pixPaymentError || 'Não foi possível gerar o Pix.'}</p>
                <button
                  type="button"
                  onClick={() => void prepareRidePixPayment()}
                  className="mt-2 rounded-lg bg-white/10 px-3 py-1.5 text-[10px] font-black text-white"
                >
                  Tentar novamente
                </button>
              </div>
            )}

            {isPixPayment && pixPaymentMode === 'direct' && (
              <div className="mt-2 rounded-xl border border-white/10 bg-tum-dark-2 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <QrCode size={16} className="shrink-0 text-tum-yellow" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-black uppercase text-white/40">Pix direto ao motorista</p>
                    <p className="truncate text-[11px] text-white/75">{pixKey || 'Chave Pix não informada'}</p>
                  </div>
                  {pixKey && (
                    <button
                      type="button"
                      onClick={copyDriverPix}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-tum-yellow/15 text-tum-yellow"
                      aria-label="Copiar chave Pix"
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-[9px] leading-4 text-white/40">Confirme o recebimento diretamente com o motorista.</p>
              </div>
            )}

            {isPixPayment && pixPaymentMode === 'asaas' && ridePixPayment && (
              <div className={`mt-2 rounded-2xl border px-3 py-3 ${pixPaid ? 'border-emerald-500/25 bg-emerald-500/10' : 'border-tum-yellow/25 bg-tum-yellow/[0.06]'}`}>
                {pixPaid ? (
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <Check size={19} strokeWidth={3} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black text-emerald-200">Pagamento confirmado</p>
                      <p className="text-[10px] text-emerald-100/65">O TUM já recebeu a confirmação do Pix.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      {pixQrImage ? (
                        <div className="shrink-0 rounded-xl bg-white p-1.5">
                          <img src={pixQrImage} alt="QR Code Pix da corrida" className="h-24 w-24 object-contain" />
                        </div>
                      ) : (
                        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-white/5 text-tum-yellow">
                          <QrCode size={44} />
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-black uppercase tracking-wide text-tum-yellow">Pague via Pix</p>
                        <p className="mt-0.5 text-lg font-black text-white">{formatBRL(Number(ridePixPayment.amount || displayedAmount))}</p>
                        <p className="mt-1 text-[10px] leading-4 text-white/45">Escaneie o QR Code ou use o Pix copia e cola. A confirmação é automática.</p>
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                      <button
                        type="button"
                        onClick={copyAsaasPix}
                        disabled={!ridePixPayment.pix_payload}
                        className="flex min-w-0 items-center justify-center gap-1.5 rounded-xl bg-tum-yellow px-3 py-2 text-[11px] font-black text-black disabled:opacity-40"
                      >
                        {pixCodeCopied ? <Check size={14} /> : <Copy size={14} />}
                        {pixCodeCopied ? 'Copiado' : 'Copiar Pix'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void refreshRidePixPayment()}
                        disabled={pixRefreshing}
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/70 disabled:opacity-40"
                        aria-label="Atualizar pagamento"
                      >
                        <RefreshCw size={15} className={pixRefreshing ? 'animate-spin' : ''} />
                      </button>
                    </div>

                    <div className="mt-2 flex items-center gap-2 rounded-xl bg-black/15 px-2.5 py-2">
                      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-tum-yellow" />
                      <p className="text-[9px] font-semibold text-white/50">Aguardando confirmação do pagamento...</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {safetyStatus?.recording && (
            <div className="mb-2 flex shrink-0 items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-[11px] font-bold text-red-200">● REC ativo · finalizando gravação</p>
              <button type="button" onClick={() => void toggleSafetyRecording()} className="shrink-0 rounded-lg border border-red-500/30 px-2 py-1 text-[10px] font-black text-red-200">PARAR</button>
            </div>
          )}

          <div className="mb-2 shrink-0 text-center">
            <p className="text-sm font-black text-white">Como foi sua experiência?</p>
            <p className="mt-0.5 text-[11px] font-bold text-tum-yellow">{ratingLabel(stars)}</p>
            <div className="mt-1 flex justify-center gap-1.5">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setStars(value)}
                  aria-label={`Avaliar com ${value} estrela${value > 1 ? 's' : ''}`}
                  className={`tum-rating-star rounded-full p-0.5 ${value <= stars ? 'is-active' : ''}`}
                >
                  <Star size={29} className={value <= stars ? 'fill-tum-yellow text-tum-yellow' : 'text-white/25'} />
                </button>
              ))}
            </div>
          </div>

          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Comentário sobre a corrida (opcional)"
            className="mb-2 min-h-0 w-full shrink rounded-xl border border-white/10 bg-tum-dark-3 px-3 py-2 text-xs text-white outline-none placeholder:text-white/35 focus:border-tum-yellow/50"
            rows={2}
            maxLength={500}
          />

          <div className="mt-auto shrink-0">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.07] px-2.5 py-2">
                <ShieldCheck size={16} className="shrink-0 text-emerald-400" />
                <p className="truncate text-[10px] font-semibold text-white/60">Viagem concluída e valor registrado no TUM</p>
              </div>
              <button
                type="button"
                onClick={openReportFlow}
                disabled={reportSubmitted}
                className={`flex h-9 shrink-0 items-center justify-center gap-1 rounded-xl border px-2.5 text-[10px] font-black transition ${reportSubmitted ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}
              >
                <ShieldAlert size={14} />
                {reportSubmitted ? 'Enviada' : 'Denunciar'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => void submitRating()}
              disabled={submittingRating || ratingBlockedByPix}
              className="tum-primary-cta w-full rounded-2xl bg-tum-yellow py-3 font-black text-black transition hover:bg-tum-yellow-dark disabled:opacity-50"
            >
              {submittingRating
                ? 'Enviando avaliação...'
                : ratingBlockedByPix
                  ? 'Aguardando pagamento Pix'
                  : 'Enviar avaliação'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <AlertModal
        open={queueInfoOpen}
        title="Motorista confirmado — ele está finalizando outra corrida"
        message={`Seu motorista já confirmou sua solicitação. Ele vai concluir a corrida atual e depois seguirá até você${etaMin !== null ? `; a estimativa é de aproximadamente ${etaMin} min` : ''}. O valor de ${formatBRL(displayedAmount)} é somente da sua corrida. Você pode esperar acompanhando o mapa e o chat ou pedir ao TUM para procurar outro motorista.`}
        variant="info"
        actionLabel="Vou esperar"
        secondaryLabel="Procurar outro"
        onClose={() => setQueueInfoOpen(false)}
        onSecondary={() => {
          if (switchingDriver) return;
          setSwitchingDriver(true);
          void Promise.resolve(onFindAnotherDriver()).finally(() => setSwitchingDriver(false));
        }}
      />

      <button
        type="button"
        onClick={() => void toggleSafetyRecording()}
        disabled={safetyBusy}
        aria-label={safetyStatus?.recording ? 'Parar gravação de segurança' : 'Iniciar gravação de segurança'}
        className={`absolute right-4 z-30 flex h-14 w-14 flex-col items-center justify-center rounded-full border-2 border-white/85 bg-red-600 text-white shadow-2xl shadow-red-950/40 transition ${safetyStatus?.recording ? 'ring-4 ring-red-500/25' : ''} ${safetyBusy ? 'cursor-wait opacity-80' : ''}`}
        style={{ bottom: 'calc(55vh + 14px)' }}
      >
        {safetyBusy ? (
          <span className="text-base font-black tracking-widest">...</span>
        ) : (
          <>
            <Camera size={18} className={safetyStatus?.recording ? 'animate-pulse' : ''} strokeWidth={2.5} />
            <span className="text-[9px] font-black tracking-wide">REC</span>
          </>
        )}
      </button>
      <div className="absolute left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1.5 text-center text-[9px] font-bold text-white/65" style={{ bottom: 'calc(55vh + 16px)' }}>🛡️ Corrida protegida — recursos de segurança podem estar ativos</div>

      <div
        className={`tum-ride-live-sheet absolute inset-x-0 bottom-0 z-40 overflow-hidden rounded-t-[28px] border-t border-white/10 bg-tum-dark-2 shadow-2xl transition-[max-height] duration-300 ${
          expanded ? 'max-h-[84vh]' : 'max-h-[55vh]'
        }`}
      >
        <div className="bg-tum-dark-2 px-4 pt-2.5">
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="mx-auto block w-full"
            aria-label={expanded ? 'Recolher detalhes' : 'Expandir detalhes'}
          >
            <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-white/20" />
          </button>
        </div>

        <div
          className={`px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] ${
            expanded ? 'max-h-[calc(84vh-28px)] overflow-y-auto' : ''
          }`}
        >
          <div className="mb-3 flex items-center gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                waiting
                  ? 'bg-emerald-500/15'
                  : inProgress
                    ? 'bg-blue-500/15'
                    : 'bg-tum-yellow/15'
              }`}
            >
              {inProgress ? (
                <Navigation size={20} className={statusText} />
              ) : (
                <Car size={20} className={statusText} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className={`text-[10px] font-black uppercase tracking-wide ${statusText}`}>
                {queued
                  ? 'Motorista finalizando outra corrida'
                  : waiting
                    ? 'Motorista no embarque'
                    : inProgress
                      ? 'Viagem em andamento'
                      : 'Motorista confirmado'}
              </p>
              <h2 className="text-sm font-black leading-snug text-white">
                {statusTitle(ride.status)}
              </h2>
            </div>

            {queued && (
              <div className="shrink-0 rounded-xl bg-tum-yellow px-3 py-2 text-center text-black">
                <p className="text-lg font-black leading-none">{Math.max(1, Number(ride.queue_position ?? 1) || 1)}ª</p>
                <p className="mt-0.5 text-[9px] font-black uppercase">na fila</p>
              </div>
            )}

            {(ride.status === 'accepted' || queued) && etaMin !== null && (
              <div className="shrink-0 rounded-xl bg-tum-yellow px-3 py-2 text-center text-black">
                <p className="text-lg font-black leading-none">{etaMin}</p>
                <p className="mt-0.5 text-[9px] font-black uppercase">{queued ? 'min estim.' : 'min'}</p>
              </div>
            )}

            {waiting && (
              <div className="shrink-0 rounded-xl bg-emerald-500 px-2.5 py-1.5 text-center text-white shadow-lg">
                <div className="flex items-center justify-center gap-1 text-[9px] font-black uppercase tracking-wide">
                  <Clock3 size={11} strokeWidth={2.8} />
                  Espera
                </div>
                <p className="mt-0.5 font-mono text-sm font-black leading-none">
                  {formatWaitingClock(waitingElapsedSeconds)}
                </p>
              </div>
            )}
          </div>

          <div className="mb-3 rounded-2xl border border-white/10 bg-tum-dark-3/80 px-3.5 py-3 tum-journey-progress">
            <div className="flex items-center">
              {journeyStages.map((stage, index) => (
                <React.Fragment key={stage.label}>
                  <div className="flex min-w-0 flex-1 flex-col items-center">
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-black transition-all duration-300 ${
                        stage.active
                          ? 'border-tum-yellow bg-tum-yellow text-black'
                          : 'border-white/15 bg-tum-dark-2 text-white/35'
                      }`}
                    >
                      {stage.active ? <Check size={12} strokeWidth={3} /> : index + 1}
                    </div>
                    <span
                      className={`mt-1.5 text-[9px] font-black uppercase tracking-wide ${
                        stage.active ? 'text-white/75' : 'text-white/30'
                      }`}
                    >
                      {stage.label}
                    </span>
                  </div>
                  {index < journeyStages.length - 1 && (
                    <div className="relative -mt-4 h-0.5 flex-[0.7] overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`absolute inset-y-0 left-0 rounded-full bg-tum-yellow transition-all duration-500 ${
                          stageIndex > index ? 'w-full' : 'w-0'
                        }`}
                      />
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="mb-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-tum-dark-3 p-3 tum-soft-enter">
            <div className="relative shrink-0">
              {driverPhoto ? (
                <img
                  src={driverPhoto}
                  alt={driverName}
                  className="h-12 w-12 rounded-full border-2 border-tum-yellow object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-tum-yellow bg-tum-dark-2 text-lg font-black text-tum-yellow">
                  {driverName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-tum-dark-3 bg-emerald-500">
                <Check size={10} className="text-white" strokeWidth={3} />
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate font-black text-white">{driverName}</p>
              <p className="truncate text-xs text-white/50">{vehicleModel}</p>

              <div className="mt-1.5 flex items-center gap-1.5">
                {vehiclePlate && (
                  <span className="rounded-md border border-white/15 bg-tum-dark-2 px-2 py-0.5 font-mono text-[10px] font-black tracking-wide text-white">
                    {vehiclePlate.toUpperCase()}
                  </span>
                )}
                <span className="rounded-md bg-tum-yellow/10 px-2 py-0.5 text-[10px] font-black text-tum-yellow">
                  {ride.category}
                </span>
              </div>
            </div>

            <div className="shrink-0 text-right">
              <p className="text-[9px] font-bold uppercase text-white/35">
                {inProgress ? 'Valor atual' : queued ? 'Valor desta corrida' : 'Valor estimado'}
              </p>
              <p className="text-base font-black text-tum-yellow">
                {formatBRL(displayedAmount)}
              </p>
              {inProgress ? (
                <p className="text-[8px] font-bold text-white/30">ao vivo</p>
              ) : queued ? (
                <p className="text-[8px] font-bold text-white/30">somente sua viagem</p>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={openReportFlow}
            disabled={reportSubmitted}
            className={`mb-2 flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-black transition ${reportSubmitted ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500/15'}`}
          >
            <ShieldAlert size={18} />
            {reportSubmitted ? 'Denúncia enviada' : 'Denunciar motorista'}
          </button>

          <div className="mb-2 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setShowChat(true)}
              className="tum-press flex flex-col items-center justify-center gap-1 rounded-xl bg-tum-yellow py-2.5 text-[10px] font-black text-black"
            >
              <MessageSquare size={17} />
              Chat
            </button>

            <button
              type="button"
              onClick={() => setShowSafety(true)}
              className="tum-press flex flex-col items-center justify-center gap-1 rounded-xl border border-tum-yellow/25 bg-tum-yellow/[0.08] py-2.5 text-[10px] font-black text-tum-yellow"
            >
              <ShieldCheck size={17} />
              Segurança
            </button>

            <button
              type="button"
              onClick={() => void openCancelFlow()}
              disabled={cancelling}
              className="tum-press flex flex-col items-center justify-center gap-1 rounded-xl border border-red-500/35 bg-red-500/15 py-2.5 text-[10px] font-bold text-red-400 disabled:opacity-50"
            >
              <X size={16} />
              {cancelling ? '...' : 'Cancelar'}
            </button>
          </div>

          {queued && (
            <div className="mb-2 space-y-2">
              <div className="rounded-xl border border-tum-yellow/20 bg-tum-yellow/[0.07] px-3 py-2 text-[11px] leading-relaxed text-white/65">
                <p className="font-semibold text-white/80">Seu motorista confirmou esta corrida e está finalizando outro atendimento antes de seguir até você.</p>
                <p className="mt-1.5">{etaMin !== null ? `Tempo estimado até chegar: aproximadamente ${etaMin} min. ` : ''}O valor de {formatBRL(displayedAmount)} é somente desta corrida — ele não soma a viagem anterior do motorista.</p>
                <p className="mt-1.5">Você pode acompanhar a posição dele e conversar pelo chat. Se não quiser esperar, toque em <strong className="text-white">Procurar outro motorista</strong>; sua solicitação volta para a busca.</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-bold text-white/70">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" />Vermelho: trajeto atual do motorista</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-tum-yellow" />{Math.max(1, Number(ride.queue_position ?? 1) || 1) === 1 ? 'Amarelo: caminho até o seu embarque' : 'Amarelo: aparece quando você for o próximo'}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (switchingDriver) return;
                  setSwitchingDriver(true);
                  try {
                    await onFindAnotherDriver();
                  } finally {
                    setSwitchingDriver(false);
                  }
                }}
                disabled={switchingDriver}
                className="tum-press flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3 text-xs font-black uppercase tracking-wide text-white disabled:opacity-50"
              >
                <Search size={16} />
                {switchingDriver ? 'Procurando...' : 'Procurar outro motorista'}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="flex w-full items-center justify-center gap-1 py-1.5 text-xs font-bold text-white/55"
          >
            {expanded ? (
              <>
                Menos detalhes
                <ChevronDown size={15} />
              </>
            ) : (
              <>
                Ver detalhes da corrida
                <ChevronUp size={15} />
              </>
            )}
          </button>

          {expanded && (
            <div className="animate-fade-in pt-2">
              <p className="mb-3 text-sm leading-snug text-white/50">
                {statusDescription(ride.status)}
              </p>

              <div className="mb-3 rounded-2xl border border-white/10 bg-tum-dark-3 p-4">
                <div className="relative">
                  <div className="absolute bottom-5 left-[7px] top-5 w-px bg-white/15" />

                  <div className="relative mb-4 flex gap-3">
                    <div className="mt-1 h-4 w-4 shrink-0 rounded-full border-[3px] border-tum-yellow bg-tum-dark-3" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-white/40">
                        Embarque
                      </p>
                      <p className="mt-0.5 text-sm font-semibold leading-snug text-white">
                        {originAddress}
                      </p>
                    </div>
                  </div>

                  {orderedStops.map((stop) => (
                    <div key={stop.id} className="relative mb-4 flex gap-3">
                      <div
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-black ${
                          stop.status === 'completed'
                            ? 'border-emerald-400 bg-emerald-400 text-black'
                            : stop.status === 'waiting'
                              ? 'border-tum-yellow bg-tum-yellow text-black'
                              : 'border-tum-yellow bg-tum-dark-3 text-tum-yellow'
                        }`}
                      >
                        {stop.stop_order}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-white/40">
                          Parada {stop.stop_order}
                          {stop.status === 'waiting' ? ' · aguardando' : stop.status === 'completed' ? ' · concluída' : ''}
                        </p>
                        <p className="mt-0.5 text-sm font-semibold leading-snug text-white">
                          {stop.address}
                        </p>
                      </div>
                    </div>
                  ))}

                  <div className="relative flex gap-3">
                    <MapPin
                      size={16}
                      className="mt-1 shrink-0 fill-tum-yellow text-tum-yellow"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-white/40">
                        Destino
                      </p>
                      <p className="mt-0.5 text-sm font-semibold leading-snug text-white">
                        {destinationAddress}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {inProgress && (
                <div className="mb-3 flex items-center justify-between rounded-2xl border border-tum-yellow/25 bg-tum-yellow/[0.08] p-3.5">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-wide text-tum-yellow/70">Preço da corrida em andamento</p>
                    <p className="mt-1 text-xs leading-4 text-white/45">Atualizado conforme km e tempo registrados.</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xl font-black text-tum-yellow">{formatBRL(displayedAmount)}</p>
                    <p className="text-[8px] font-black uppercase text-white/30">valor atual</p>
                  </div>
                </div>
              )}

              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-white/10 bg-tum-dark-3 p-3">
                  <Route size={16} className="mb-1.5 text-tum-yellow" />
                  <p className="text-[9px] font-bold uppercase text-white/35">
                    Distância
                  </p>
                  <p className="mt-1 text-xs font-black text-white">
                    {tripSummary.distance.toFixed(1)} km
                  </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-tum-dark-3 p-3">
                  <Clock3 size={16} className="mb-1.5 text-tum-yellow" />
                  <p className="text-[9px] font-bold uppercase text-white/35">
                    Duração
                  </p>
                  <p className="mt-1 text-xs font-black text-white">
                    {Math.ceil(tripSummary.duration)} min
                  </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-tum-dark-3 p-3">
                  <CreditCard size={16} className="mb-1.5 text-tum-yellow" />
                  <p className="text-[9px] font-bold uppercase text-white/35">Pagamento</p>
                  <p className="mt-1 truncate text-xs font-black text-white">{paymentLabel}</p>
                </div>
                <div className="rounded-xl border border-tum-yellow/20 bg-tum-yellow/[0.05] p-3">
                  <CreditCard size={16} className="mb-1.5 text-tum-yellow" />
                  <p className="text-[9px] font-bold uppercase text-white/35">{inProgress ? 'Valor atual' : 'Valor estimado'}</p>
                  <p className="mt-1 text-xs font-black text-tum-yellow">{formatBRL(displayedAmount)}</p>
                </div>
              </div>

              {orderedStops.length > 0 && (
                <div className="mb-3 rounded-xl border border-tum-yellow/20 bg-tum-yellow/5 p-3 text-xs text-white/65">
                  <div className="flex justify-between gap-3">
                    <span>{orderedStops.length} parada{orderedStops.length > 1 ? 's' : ''}</span>
                    <span className="font-bold text-tum-yellow">
                      {currentStop ? `Próxima: Parada ${currentStop.stop_order}` : 'Paradas concluídas'}
                    </span>
                  </div>
                  {Number(ride.stop_waiting_fee ?? 0) > 0 && (
                    <div className="mt-1.5 flex justify-between gap-3">
                      <span>Espera nas paradas</span>
                      <span>+ {formatBRL(Number(ride.stop_waiting_fee ?? 0))}</span>
                    </div>
                  )}
                </div>
              )}

              {Number(ride.discount_amount ?? 0) > 0 && (
                <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-400">
                  Desconto de {formatBRL(Number(ride.discount_amount ?? 0))} aplicado.
                </div>
              )}

              <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-tum-dark-3 p-3.5">
                <ShieldCheck
                  size={19}
                  className="mt-0.5 shrink-0 text-tum-yellow"
                />
                <p className="text-xs leading-relaxed text-white/55">
                  Antes de entrar, confira o nome do motorista, o modelo do veículo e a placa mostrados acima.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <input
        ref={reportCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => handleReportFile(event.target.files?.[0] ?? null)}
      />
      <input
        ref={reportGalleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => handleReportFile(event.target.files?.[0] ?? null)}
      />

      {reportOpen && (
        <div className="fixed inset-0 z-[180] flex items-end justify-center bg-black/80 px-3 pb-3 pt-6 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-lg rounded-[28px] border border-white/10 bg-tum-dark-2 p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-red-300">Segurança TUM</p>
                <h3 className="mt-1 text-lg font-black text-white">Denunciar motorista</h3>
                <p className="mt-1 text-xs leading-5 text-white/45">
                  Sua denúncia será analisada pela equipe do TUM e ficará vinculada a esta corrida.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !reportSubmitting && setReportOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-white/60"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[62vh] overflow-y-auto pr-1">
              <div className="rounded-2xl border border-red-500/15 bg-red-500/10 p-3 text-xs leading-5 text-white/55">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-300" />
                  <p>
                    Use esse recurso quando houver comportamento inadequado, risco, cobrança indevida ou divergência no cadastro.
                  </p>
                </div>
              </div>

              <p className="mb-2 mt-4 text-xs font-black uppercase tracking-wide text-white/40">O que aconteceu?</p>
              <button
                type="button"
                onClick={() => setReportReasonsOpen((current) => !current)}
                className="flex w-full items-center gap-3 rounded-2xl border border-red-400/25 bg-red-500/[0.07] p-3.5 text-left"
              >
                <ShieldAlert size={18} className="shrink-0 text-red-300" />
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-black uppercase tracking-wide text-white/35">Motivo selecionado</p>
                  <p className="mt-0.5 truncate text-sm font-black text-white">{USER_REPORT_REASONS.find((reason) => reason.key === reportReason)?.label ?? 'Selecionar motivo'}</p>
                </div>
                {reportReasonsOpen ? <ChevronUp size={20} className="shrink-0 text-red-300" /> : <ChevronDown size={20} className="shrink-0 text-red-300" />}
              </button>

              {reportReasonsOpen && (
                <div className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-black/15 p-2">
                  {USER_REPORT_REASONS.map((reason) => {
                    const selected = reportReason === reason.key;
                    return (
                      <button
                        key={reason.key}
                        type="button"
                        onClick={() => { setReportReason(reason.key); setReportReasonsOpen(false); }}
                        className={`w-full rounded-xl border p-3 text-left transition ${selected ? 'border-red-400/40 bg-red-500/10' : 'border-white/10 bg-white/[0.025]'}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-red-300' : 'border-white/20'}`}>
                            {selected && <div className="h-2 w-2 rounded-full bg-red-300" />}
                          </div>
                          <div>
                            <p className="text-sm font-black text-white">{reason.label}</p>
                            <p className="mt-1 text-xs leading-5 text-white/45">{reason.description}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="mb-2 mt-4 text-xs font-black uppercase tracking-wide text-white/40">Gravação de segurança (opcional)</p>
              {reportSafetyLoading ? (
                <div className="rounded-2xl border border-white/10 bg-tum-dark-3 p-3 text-xs text-white/45">Procurando vídeos desta corrida...</div>
              ) : reportSafetyVideos.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-white/45">
                  Nenhum vídeo de segurança do Passageiro foi encontrado para esta corrida. Se você estiver gravando agora, aguarde alguns segundos e abra a denúncia novamente.
                </div>
              ) : (
                <div className="space-y-2">
                  {reportSafetyVideos.map((recording) => {
                    const selected = selectedSafetyRecordingId === recording.id;
                    const sizeMb = Number(recording.total_bytes || 0) / 1024 / 1024;
                    return (
                      <button
                        key={recording.id}
                        type="button"
                        onClick={() => setSelectedSafetyRecordingId(selected ? '' : recording.id)}
                        className={`w-full rounded-2xl border p-3 text-left transition ${selected ? 'border-tum-yellow/45 bg-tum-yellow/10' : 'border-white/10 bg-tum-dark-3'}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${selected ? 'bg-tum-yellow text-black' : 'bg-red-500/10 text-red-300'}`}>
                            <Video size={19} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-black text-white">{selected ? 'Vídeo será anexado' : 'Anexar vídeo de segurança'}</p>
                            <p className="mt-1 text-xs leading-5 text-white/45">
                              {new Date(recording.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {recording.segment_count} trecho(s) · {sizeMb.toFixed(1)} MB
                              {recording.status === 'recording' ? ' · gravando agora' : ''}
                            </p>
                          </div>
                          <div className={`mt-1 h-5 w-5 rounded-full border-2 ${selected ? 'border-tum-yellow bg-tum-yellow' : 'border-white/20'}`}>
                            {selected && <Check size={14} className="text-black" strokeWidth={3} />}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {selectedSafetyRecordingId && (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs leading-5 text-emerald-200">
                      O vídeo será preservado automaticamente e não será apagado pela retenção normal enquanto estiver vinculado à denúncia.
                    </div>
                  )}
                </div>
              )}

              <p className="mb-2 mt-4 text-xs font-black uppercase tracking-wide text-white/40">Conte mais (opcional)</p>
              <textarea
                value={reportDescription}
                onChange={(event) => setReportDescription(event.target.value.slice(0, 1200))}
                placeholder="Descreva o que aconteceu para ajudar na análise."
                className="min-h-24 w-full resize-none rounded-2xl border border-white/10 bg-tum-dark-3 px-3.5 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-red-400/40"
              />
              <p className="mt-1 text-right text-[11px] text-white/35">{reportDescription.length}/1200</p>

              <p className="mb-2 mt-4 text-xs font-black uppercase tracking-wide text-white/40">Foto como evidência (opcional)</p>
              {reportEvidence ? (
                <div className="rounded-2xl border border-white/10 bg-tum-dark-3 p-3">
                  <img src={reportEvidence.previewUrl} alt="Evidência selecionada" className="h-44 w-full rounded-xl object-cover" />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-white">Foto pronta para envio</p>
                      <p className="text-xs text-white/40">Ela será enviada de forma privada para análise do TUM.</p>
                    </div>
                    <button type="button" onClick={removeReportEvidence} className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-300">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => reportCameraInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-tum-dark-3 px-4 py-3 text-sm font-bold text-white"
                  >
                    <Camera size={16} />
                    Tirar foto
                  </button>
                  <button
                    type="button"
                    onClick={() => reportGalleryInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-tum-dark-3 px-4 py-3 text-sm font-bold text-white"
                  >
                    <ImagePlus size={16} />
                    Galeria
                  </button>
                </div>
              )}

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-white/45">
                As evidências são privadas e usadas somente para análise interna do TUM.
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                disabled={reportSubmitting}
                className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-bold text-white/75 disabled:opacity-40"
              >
                Agora não
              </button>
              <button
                type="button"
                onClick={() => void submitReport()}
                disabled={reportSubmitting || !reportReason}
                className="rounded-2xl bg-red-500 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
              >
                {reportSubmitting ? 'Enviando...' : 'Enviar denúncia'}
              </button>
            </div>
          </div>
        </div>
      )}

      <AlertModal
        open={stopRecordingConfirmOpen}
        title="Parar gravação de segurança?"
        message="Os trechos já gravados continuarão protegidos. Você poderá iniciar uma nova gravação durante a corrida se precisar."
        variant="warning"
        secondaryLabel="Continuar gravando"
        actionLabel="Parar gravação"
        onSecondary={() => setStopRecordingConfirmOpen(false)}
        onAction={() => void confirmStopSafetyRecording()}
        onClose={() => setStopRecordingConfirmOpen(false)}
      />

      <AlertModal
        open={Boolean(tumAlert)}
        title={tumAlert?.title}
        message={tumAlert?.message ?? ''}
        variant={tumAlert?.variant ?? 'info'}
        onClose={() => setTumAlert(null)}
      />

      <SafetyCenter
        open={showSafety}
        onClose={() => setShowSafety(false)}
        profile={profile}
        ride={ride}
        driver={driver}
      />

      {showChat && (
        <div className="fixed inset-0 z-50 flex flex-col bg-tum-dark">
          <div className="flex items-center gap-3 border-b border-white/10 bg-tum-dark-2 px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))]">
            {driverPhoto ? (
              <img
                src={driverPhoto}
                alt={driverName}
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-tum-dark-3 font-black text-tum-yellow">
                {driverName.charAt(0).toUpperCase()}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <h3 className="truncate font-black text-white">
                {driverName}
              </h3>
              <p className="text-xs text-emerald-400">Chat da corrida</p>
            </div>

            <button
              type="button"
              onClick={() => setShowChat(false)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-tum-dark-3 text-white"
              aria-label="Fechar chat"
            >
              <X size={19} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            <ChatPanel
              rideId={ride.id}
              driverName={driverName}
              audioMode={audioMode}
            />
          </div>
        </div>
      )}
      {cancelOpen && (
        <div className="fixed inset-0 z-[170] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-md rounded-t-[28px] border border-white/10 bg-tum-dark-2 p-5 shadow-2xl sm:rounded-[28px]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-red-300">Cancelar corrida</p>
                <h3 className="mt-1 text-lg font-black text-white">Por que você quer cancelar?</h3>
                <p className="mt-1 text-xs leading-5 text-white/45">
                  Dependendo do momento e do motivo, uma taxa de cancelamento pode ser aplicada.
                </p>
              </div>
              <button type="button" onClick={() => !cancelling && setCancelOpen(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-white/60">
                <X size={18} />
              </button>
            </div>

            {cancelReasonsLoading ? (
              <div className="py-8 text-center text-sm font-semibold text-white/45">Carregando motivos...</div>
            ) : (
              <div className="max-h-[42vh] space-y-2 overflow-y-auto">
                {cancelReasons.map((reason) => (
                  <button
                    key={reason.code}
                    type="button"
                    onClick={() => setCancelReasonCode(reason.code)}
                    className={`w-full rounded-2xl border p-3.5 text-left transition ${
                      cancelReasonCode === reason.code
                        ? 'border-tum-yellow/50 bg-tum-yellow/10'
                        : 'border-white/10 bg-white/[0.035]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-black text-white">{reason.label}</p>
                      {reason.fee_exempt && (
                        <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[9px] font-black uppercase text-emerald-300">
                          Pode ser isento
                        </span>
                      )}
                    </div>
                    {reason.description && <p className="mt-1 text-xs leading-5 text-white/40">{reason.description}</p>}
                  </button>
                ))}
              </div>
            )}

            {cancelReasonCode === 'other' && (
              <textarea
                value={cancelReasonNote}
                onChange={(event) => setCancelReasonNote(event.target.value)}
                placeholder="Conte resumidamente o motivo"
                maxLength={240}
                className="mt-3 min-h-20 w-full resize-none rounded-2xl border border-white/10 bg-tum-dark-3 px-3.5 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-tum-yellow/40"
              />
            )}

            <button
              type="button"
              onClick={() => void cancelRide()}
              disabled={cancelling || !cancelReasonCode}
              className="mt-4 w-full rounded-2xl bg-red-500 py-3.5 text-sm font-black text-white disabled:opacity-50"
            >
              {cancelling ? 'Cancelando...' : 'Confirmar cancelamento'}
            </button>
          </div>
        </div>
      )}

    </>
  );
}