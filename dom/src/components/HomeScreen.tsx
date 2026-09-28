import React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MoreVertical,
  LocateFixed,
  Sun,
  Moon,
  X,
  Loader2,
  Car,
  Bell,
  Plus,
  MapPin,
  Route,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search,
  WifiOff,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type {
  Address,
  Banner,
  DriverLocation,
  PassengerRideDetails,
  Profile,
  Ride,
  RideStop,
  RideStatus,
} from '../lib/types';
import { getDirections, getDirectionsWithStops, reverseGeocode, haversineKm } from '../lib/mapbox';
import { useTheme } from '../hooks/useTheme';
import MapView, { type MapController, type MapPoiSelection } from './MapView';
import AddressAutocomplete from './AddressAutocomplete';
import RideRequestModal, {
  type RideRequestPayload,
} from './RideRequestModal';
import RideInProgress from './RideInProgress';
import MenuDrawer from './MenuDrawer';
import EditProfileModal from './EditProfileModal';
import AlertModal from './AlertModal';
import NotificationsPanel from './NotificationsPanel';
import SupportPanel from './SupportPanel';
import NewsPanel from './NewsPanel';
import SavedPlaces from './SavedPlaces';
import CancellationDebtPanel from './CancellationDebtPanel';
import { countUnreadNotifications } from '../lib/notificationsInbox';
import { cancelRideWithReason, loadCancellationDebts } from '../lib/cancellation';
import { useNativeActions, useNativeOpenUrl } from '../lib/nativeActions';
import {
  loadPassengerAlertAudioMode,
  savePassengerAlertAudioMode,
  type AlertAudioMode,
} from '../lib/audioPreferences';
import {
  playPassengerAudioEvent,
  primePassengerAudio,
  vibratePassenger,
} from '../lib/appAudio';
import {
  clearActiveRideSnapshot,
  readActiveRideSnapshot,
  saveActiveRideSnapshot,
} from '../lib/offlineRecovery';

type StopDraft = {
  id: string;
  place_name: string;
  coordinates: [number, number] | null;
};

const MAX_STOPS_UI = 5;
const NEARBY_DRIVERS_POLL_MS = 2000;
const NEARBY_DRIVER_RETENTION_MS = 30000;
const LOCATION_CACHE_TTL_MS = 10 * 60 * 1000;
const LOCATION_NATIVE_RETRY_DELAYS_MS = [0, 180, 420] as const;
const ACTIVE_RIDE_FALLBACK_POLL_MS = 12000;
const RIDE_DRIVER_POLL_MS = 2500;
const HIDDEN_RIDE_DRIVER_POLL_MS = 9000;

function newsPostIdFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const path = value.split('?')[0]?.replace(/\/+$/, '') ?? '';
  const match = path.match(/^\/news\/([0-9a-f-]{36})$/i);
  return match?.[1] ?? null;
}

interface Props {
  profile: Profile;
  nativeKeyboardHeight?: number;
  setProfile: (profile: Profile) => void;
  onLogout: () => void | Promise<void>;
}

type Phase =
  | 'idle'
  | 'searching'
  | 'queued'
  | 'accepted'
  | 'waiting'
  | 'in_progress'
  | 'finished';

type RideAudioStage =
  | 'searching'
  | 'queued'
  | 'accepted'
  | 'arrived'
  | 'started'
  | 'completed'
  | 'cancelled'
  | 'other';

function audioStageForStatus(status: RideStatus): RideAudioStage {
  if (status === 'searching') return 'searching';
  if (status === 'queued') return 'queued';
  if (status === 'accepted') return 'accepted';
  if (['driver_arrived', 'arrived', 'waiting'].includes(status)) {
    return 'arrived';
  }
  if (['started', 'in_progress'].includes(status)) return 'started';
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  return 'other';
}

function phaseForStatus(status: RideStatus): Phase {
  if (status === 'searching') return 'searching';
  if (status === 'queued') return 'queued';
  if (status === 'accepted') return 'accepted';
  if (['driver_arrived', 'arrived', 'waiting'].includes(status)) {
    return 'waiting';
  }
  if (['started', 'in_progress'].includes(status)) {
    return 'in_progress';
  }
  if (status === 'completed') return 'finished';
  return 'idle';
}

function isActiveStatus(status: RideStatus): boolean {
  return [
    'searching',
    'queued',
    'accepted',
    'driver_arrived',
    'arrived',
    'waiting',
    'started',
    'in_progress',
    'completed',
  ].includes(status);
}

function formatPoiCategory(category: string | null): string | null {
  if (!category) return null;

  const normalized = category.trim().toLowerCase();
  const labels: Record<string, string> = {
    grocery: 'Mercado',
    supermarket: 'Supermercado',
    convenience: 'Conveniência',
    pharmacy: 'Farmácia',
    hospital: 'Hospital',
    clinic: 'Clínica',
    doctor: 'Saúde',
    school: 'Escola',
    college: 'Faculdade',
    university: 'Universidade',
    restaurant: 'Restaurante',
    cafe: 'Café',
    fast_food: 'Alimentação',
    fastfood: 'Alimentação',
    fuel: 'Posto de combustível',
    gas_station: 'Posto de combustível',
    bank: 'Banco',
    atm: 'Caixa eletrônico',
    shop: 'Comércio',
    store: 'Comércio',
    hotel: 'Hotel',
    lodging: 'Hospedagem',
    park: 'Parque',
  };

  if (labels[normalized]) return labels[normalized];

  return category
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function driverListSignature(drivers: DriverLocation[]): string {
  return drivers
    .map((driver) => [
      driver.id ?? driver.driver_id ?? '',
      Number(driver.latitude ?? 0).toFixed(5),
      Number(driver.longitude ?? 0).toFixed(5),
      driver.category ?? '',
    ].join(':'))
    .join('|');
}

type LocationResolution = {
  coordinates: [number, number] | null;
  permissionDenied: boolean;
};

function isValidCoordinates(value: unknown): value is [number, number] {
  if (!Array.isArray(value) || value.length < 2) return false;
  const longitude = Number(value[0]);
  const latitude = Number(value[1]);
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
}

function sameCoordinates(
  first: [number, number] | null | undefined,
  second: [number, number],
): boolean {
  return Boolean(
    first &&
      Math.abs(first[0] - second[0]) < 0.000001 &&
      Math.abs(first[1] - second[1]) < 0.000001,
  );
}

function passengerLocationCacheKey(profileId: string): string {
  return `tum-passenger-location:${profileId}`;
}

function readCachedPassengerLocation(profileId: string): Address | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(passengerLocationCacheKey(profileId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      coordinates?: unknown;
      savedAt?: unknown;
    };
    const savedAt = Number(parsed.savedAt);

    if (
      !isValidCoordinates(parsed.coordinates) ||
      !Number.isFinite(savedAt) ||
      Date.now() - savedAt > LOCATION_CACHE_TTL_MS
    ) {
      return null;
    }

    return {
      place_name: 'Localização atual',
      coordinates: [Number(parsed.coordinates[0]), Number(parsed.coordinates[1])],
    };
  } catch {
    return null;
  }
}

function savePassengerLocation(
  profileId: string,
  coordinates: [number, number],
): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      passengerLocationCacheKey(profileId),
      JSON.stringify({ coordinates, savedAt: Date.now() }),
    );
  } catch {
    // Cache é apenas otimização: falha nele nunca bloqueia o GPS.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getBrowserCoordinates(): Promise<[number, number] | null> {
  if (!navigator.geolocation) return Promise.resolve(null);

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinates: [number, number] = [
          position.coords.longitude,
          position.coords.latitude,
        ];
        resolve(isValidCoordinates(coordinates) ? coordinates : null);
      },
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: 6500,
        maximumAge: 30000,
      },
    );
  });
}

export default function HomeScreen({
  profile,
  nativeKeyboardHeight = 0,
  setProfile,
  onLogout,
}: Props) {
  const { theme, toggle } = useTheme();
  const nativeOpenUrl = useNativeOpenUrl();
  const nativeActions = useNativeActions();
  const [origin, setOrigin] = useState<Address | null>(() =>
    readCachedPassengerLocation(profile.id),
  );
  // O mapa só é liberado depois de dispararmos a primeira consulta de
  // motoristas. Assim ele não nasce vazio e preenche os carrinhos segundos
  // depois. Quando há localização em cache, essa preparação acontece em
  // paralelo com a atualização do GPS real.
  // O mapa deve aparecer imediatamente. GPS lento/desligado nunca pode prender
  // a Home numa tela de carregamento: começamos pelo centro/cidade/cache e
  // recentralizamos assim que a localização real chegar.
  const [locationReady, setLocationReady] = useState(true);
  const [destination, setDestination] = useState<Address | null>(null);
  const [stops, setStops] = useState<StopDraft[]>([]);
  const [activeStops, setActiveStops] = useState<RideStop[]>([]);
  const [drivers, setDrivers] = useState<DriverLocation[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [bannerIdx, setBannerIdx] = useState(0);
  const [dismissedBannerIds, setDismissedBannerIds] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const openSafety = () => setMenuOpen(true);
    window.addEventListener('tum:open-safety', openSafety);
    return () => window.removeEventListener('tum:open-safety', openSafety);
  }, []);
  const [editOpen, setEditOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const [newsPostId, setNewsPostId] = useState<string | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [showRequest, setShowRequest] = useState(false);
  const [tripSheetExpanded, setTripSheetExpanded] = useState(false);
  const [focusedTripAddressField, setFocusedTripAddressField] = useState<'origin' | 'destination' | null>(null);
  const [tripSheetKeyboardLift, setTripSheetKeyboardLift] = useState(0);
  const tripSheetKeyboardLiftRef = useRef(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [rideDriver, setRideDriver] = useState<DriverLocation | null>(null);
  const [routeCoords, setRouteCoords] = useState<[number, number][] | null>(null);
  const [queuedCurrentRouteCoords, setQueuedCurrentRouteCoords] = useState<[number, number][] | null>(null);
  const [queuedNextRouteCoords, setQueuedNextRouteCoords] = useState<[number, number][] | null>(null);
  const [queuedCurrentDestination, setQueuedCurrentDestination] = useState<[number, number] | null>(null);
  const [etaMin, setEtaMin] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [networkOnline, setNetworkOnline] = useState(() =>
    typeof navigator === 'undefined' || navigator.onLine !== false,
  );
  const [rideSyncProblem, setRideSyncProblem] = useState(false);
  const [cancellationDebtOpen, setCancellationDebtOpen] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState<MapPoiSelection | null>(null);
  const [audioMode, setAudioMode] = useState<AlertAudioMode>(() =>
    loadPassengerAlertAudioMode(profile.id, profile.alert_audio_mode),
  );
  const mapRef = useRef<MapController | null>(null);
  const activeRideRef = useRef<Ride | null>(null);
  const latestActiveRideSnapshotRef = useRef<Parameters<typeof saveActiveRideSnapshot>[1] | null>(null);
  const requestRideInFlightRef = useRef(false);
  // Depois que o passageiro começa a editar o embarque manualmente, não
  // permitimos que uma resposta atrasada do GPS recoloque a localização atual
  // por cima do que ele está digitando. Isso também permite pedir uma corrida
  // para outra pessoa em outro endereço. O botão de localizar reativa o GPS.
  const originManualEditRef = useRef(false);
  const originRef = useRef<Address | null>(null);
  const destinationRef = useRef<Address | null>(null);
  const activeStopsRef = useRef<RideStop[]>([]);
  const lastDriverRouteRequestRef = useRef<{
    status: RideStatus;
    coordinates: [number, number];
    target: [number, number];
    requestedAt: number;
  } | null>(null);
  const driverRouteSequenceRef = useRef(0);
  const rideAudioStateRef = useRef<{
    rideId: string;
    stage: RideAudioStage;
  } | null>(null);
  const nearbyDriversSignatureRef = useRef('');
  const nearbyDriversLoadInFlightRef = useRef(false);
  const rideDetailsRequestSequenceRef = useRef(0);
  const rideDetailsInFlightRef = useRef<{
    rideId: string;
    promise: Promise<PassengerRideDetails | null>;
  } | null>(null);
  const recoverRideInFlightRef = useRef(false);
  const idleRouteSequenceRef = useRef(0);
  const nearbyDriverCacheRef = useRef<
    Map<string, { driver: DriverLocation; lastSeenAt: number }>
  >(new Map());

  useEffect(() => {
    if (phase !== 'idle' || !focusedTripAddressField || typeof window === 'undefined') {
      tripSheetKeyboardLiftRef.current = 0;
      setTripSheetKeyboardLift(0);
      return;
    }

    const viewport = window.visualViewport;
    let frame = 0;
    let settleTimer = 0;
    let settleTimer2 = 0;

    const updateKeyboardLift = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const nativeInset = Number.isFinite(nativeKeyboardHeight)
          ? Math.max(0, nativeKeyboardHeight)
          : 0;

        // No app nativo, o Android informa a altura REAL do teclado via
        // React Native. O WebView do Expo DOM nem sempre reduz visualViewport,
        // então essa medida nativa é a fonte principal. No PWA/web, mantemos
        // visualViewport como fallback.
        const viewportVisibleBottom = viewport
          ? viewport.offsetTop + viewport.height
          : window.innerHeight;
        const visualViewportOverlap = Math.max(0, window.innerHeight - viewportVisibleBottom);
        const keyboardOverlap = nativeInset >= 90 ? nativeInset : visualViewportOverlap;
        const visibleBottom = nativeInset >= 90
          ? Math.max(120, window.innerHeight - nativeInset)
          : viewportVisibleBottom;

        if (keyboardOverlap < 90) {
          if (tripSheetKeyboardLiftRef.current !== 0) {
            tripSheetKeyboardLiftRef.current = 0;
            setTripSheetKeyboardLift(0);
          }
          return;
        }

        const input = document.querySelector<HTMLInputElement>(
          `[data-tum-address-field="${focusedTripAddressField}"]`,
        );
        if (!input) return;

        const rect = input.getBoundingClientRect();
        const currentLift = tripSheetKeyboardLiftRef.current;
        const safeGap = 10;

        // Sobe SOMENTE o necessário para o campo focado ficar acima do teclado.
        // Ao digitar o Embarque, o Destino continua atrás do teclado em vez de
        // empurrar o painel inteiro para o alto.
        const overflow = rect.bottom + safeGap - visibleBottom;
        const maximumUsefulLift = Math.max(0, keyboardOverlap - 12);
        const nextLift = Math.max(
          0,
          Math.min(maximumUsefulLift, Math.round(currentLift + overflow)),
        );

        if (Math.abs(nextLift - currentLift) >= 2) {
          tripSheetKeyboardLiftRef.current = nextLift;
          setTripSheetKeyboardLift(nextLift);
        }
      });
    };

    updateKeyboardLift();
    settleTimer = window.setTimeout(updateKeyboardLift, 100);
    settleTimer2 = window.setTimeout(updateKeyboardLift, 280);

    viewport?.addEventListener('resize', updateKeyboardLift);
    viewport?.addEventListener('scroll', updateKeyboardLift);
    window.addEventListener('resize', updateKeyboardLift);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.clearTimeout(settleTimer2);
      viewport?.removeEventListener('resize', updateKeyboardLift);
      viewport?.removeEventListener('scroll', updateKeyboardLift);
      window.removeEventListener('resize', updateKeyboardLift);
    };
  }, [focusedTripAddressField, nativeKeyboardHeight, phase]);

  const invalidateIdleRoute = useCallback(() => {
    idleRouteSequenceRef.current += 1;
    setRouteCoords(null);
  }, []);

  const applyPassengerLocation = useCallback(
    (coordinates: [number, number], flyToLocation = false, force = false) => {
      // Se o passageiro apagou/editou o embarque, uma resposta atrasada do GPS
      // não pode sobrescrever o texto dele. Só o botão "minha localização"
      // usa force=true para voltar explicitamente ao GPS do aparelho.
      if (originManualEditRef.current && !force) return;

      // Publica as coordenadas ANTES do reverse geocode. Assim mapa e busca de
      // motoristas começam imediatamente, sem esperar uma chamada de endereço.
      setOrigin((current) => ({
        place_name: sameCoordinates(current?.coordinates, coordinates)
          ? current?.place_name || 'Localização atual'
          : 'Localização atual',
        coordinates,
      }));
      savePassengerLocation(profile.id, coordinates);

      if (flyToLocation) {
        mapRef.current?.flyTo({ center: coordinates, zoom: 15, duration: 420 });
      }

      void reverseGeocode(coordinates[0], coordinates[1])
        .then((name) => {
          setOrigin((current) =>
            sameCoordinates(current?.coordinates, coordinates)
              ? { ...current!, place_name: name || 'Localização atual' }
              : current,
          );
        })
        .catch(() => undefined);
    },
    [profile.id],
  );

  const resolveCurrentCoordinates = useCallback(async (): Promise<LocationResolution> => {
    let permissionDenied = false;

    if (nativeActions?.ensureLocationPermission) {
      try {
        const allowed = await nativeActions.ensureLocationPermission();
        if (!allowed) {
          // Não confiamos apenas neste booleano: já houve aparelho em que a
          // permissão estava concedida no Android, mas a ponte respondeu false.
          // Marcamos a suspeita e ainda tentamos ler a localização de verdade.
          permissionDenied = true;
        }
      } catch (error) {
        // Algumas WebViews lançam erro transitório mesmo com a permissão já
        // concedida. Não paramos aqui: tentamos o GPS nativo e o fallback web.
        console.warn('Validação de permissão de localização falhou temporariamente:', error);
      }
    }

    if (nativeActions?.getCurrentNativeLocation) {
      for (const delayMs of LOCATION_NATIVE_RETRY_DELAYS_MS) {
        if (delayMs > 0) await sleep(delayMs);

        try {
          // O bridge nativo pode ficar aguardando um fix de GPS por vários
          // segundos. Isso não pode impedir o mapa de existir. Limitamos cada
          // tentativa e seguimos com cache/centro da cidade/fallback web.
          const position = await Promise.race([
            nativeActions.getCurrentNativeLocation(),
            new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 2800)),
          ]);
          const coordinates: [number, number] | null = position
            ? [Number(position.longitude), Number(position.latitude)]
            : null;

          if (coordinates && isValidCoordinates(coordinates)) {
            return { coordinates, permissionDenied: false };
          }
        } catch (error) {
          console.warn('Leitura nativa de localização ainda não ficou pronta:', error);
        }
      }
    }

    const browserCoordinates = await getBrowserCoordinates();
    if (browserCoordinates) {
      return { coordinates: browserCoordinates, permissionDenied: false };
    }

    return { coordinates: null, permissionDenied };
  }, [nativeActions]);


  const primeNearbyDrivers = useCallback(
    async (coordinates: [number, number]): Promise<void> => {
      if (nearbyDriversLoadInFlightRef.current) return;

      nearbyDriversLoadInFlightRef.current = true;
      try {
        const { data, error } = await supabase.rpc(
          'get_nearby_driver_markers_tum',
          {
            p_latitude: coordinates[1],
            p_longitude: coordinates[0],
            p_radius_km: 15,
          },
        );

        if (error) {
          console.warn('Falha ao preparar motoristas próximos:', error.message);
          return;
        }

        const now = Date.now();
        const cache = nearbyDriverCacheRef.current;
        const freshDrivers = ((data as DriverLocation[]) || []).filter(
          (driver) => driver && driver.is_online !== false,
        );
        const freshIds = new Set<string>();

        freshDrivers.forEach((driver) => {
          const key = String(driver.driver_id ?? driver.id ?? '').trim();
          if (!key) return;
          freshIds.add(key);
          cache.set(key, { driver, lastSeenAt: now });
        });

        cache.forEach((entry, key) => {
          if (freshIds.has(key)) return;
          if (now - entry.lastSeenAt >= NEARBY_DRIVER_RETENTION_MS) {
            cache.delete(key);
          }
        });

        const nextDrivers = Array.from(cache.values(), (entry) => entry.driver);
        nearbyDriversSignatureRef.current = driverListSignature(nextDrivers);
        setDrivers(nextDrivers);
      } catch (error) {
        console.warn('Não foi possível preparar os carrinhos antes do mapa:', error);
      } finally {
        nearbyDriversLoadInFlightRef.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    if (phase !== 'idle') {
      setTripSheetExpanded(false);
      setSelectedPoi(null);
    }
  }, [phase]);

  const handleAppNavigation = useCallback((rawUrl: string) => {
    const path = rawUrl.split('?')[0] || '/';
    const postId = newsPostIdFromUrl(path);

    if (postId) {
      setMenuOpen(false);
      setNotificationsOpen(false);
      setSupportOpen(false);
      setNewsPostId(postId);
      setNewsOpen(true);
      return;
    }

    if (path === '/news' || path === '/novidades') {
      setMenuOpen(false);
      setNotificationsOpen(false);
      setSupportOpen(false);
      setNewsPostId(null);
      setNewsOpen(true);
      return;
    }

    if (path === '/notifications') {
      setNewsOpen(false);
      setSupportOpen(false);
      setNotificationsOpen(true);
      return;
    }

    if (path === '/support') {
      setNewsOpen(false);
      setNotificationsOpen(false);
      setSupportOpen(true);
      return;
    }

    if (path === '/') {
      setNewsOpen(false);
      setNewsPostId(null);
      setNotificationsOpen(false);
      setSupportOpen(false);
      setMenuOpen(false);
    }
  }, []);

  useEffect(() => {
    if (nativeOpenUrl) handleAppNavigation(nativeOpenUrl);
  }, [handleAppNavigation, nativeOpenUrl]);

  useEffect(() => {
    let active = true;
    const checkDebt = async () => {
      try {
        const summary = await loadCancellationDebts();
        if (active && summary.blocked && summary.total_due > 0) {
          setCancellationDebtOpen(true);
        }
      } catch (error) {
        console.warn('[TUM] Não foi possível consultar taxas de cancelamento:', error);
      }
    };
    void checkDebt();
    return () => {
      active = false;
    };
  }, [profile.id]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const result = await countUnreadNotifications();
      if (active) setUnreadNotifications(result.count);
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 20000);
    const openFromNative = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail;
      if (detail?.url) handleAppNavigation(detail.url);
    };
    window.addEventListener('tum-native-open', openFromNative);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('tum-native-open', openFromNative); };
  }, [handleAppNavigation]);

  useEffect(() => {
    activeRideRef.current = activeRide;
  }, [activeRide]);

  useEffect(() => {
    originRef.current = origin;
  }, [origin]);

  useEffect(() => {
    destinationRef.current = destination;
  }, [destination]);

  useEffect(() => {
    activeStopsRef.current = activeStops;
  }, [activeStops]);

  useEffect(() => {
    if (!activeRide || !isActiveStatus(activeRide.status)) {
      latestActiveRideSnapshotRef.current = null;
      return;
    }

    const snapshot: Parameters<typeof saveActiveRideSnapshot>[1] = {
      ride: activeRide,
      stops: activeStops,
      driver: rideDriver,
      routeCoords,
      queuedCurrentRouteCoords,
      queuedNextRouteCoords,
      queuedCurrentDestination,
      etaMin,
    };
    latestActiveRideSnapshotRef.current = snapshot;

    const timer = window.setTimeout(() => {
      saveActiveRideSnapshot(profile.id, snapshot);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [
    profile.id,
    activeRide,
    activeStops,
    rideDriver,
    routeCoords,
    queuedCurrentRouteCoords,
    queuedNextRouteCoords,
    queuedCurrentDestination,
    etaMin,
  ]);

  useEffect(() => {
    const flushRideSnapshot = () => {
      const snapshot = latestActiveRideSnapshotRef.current;
      if (snapshot) saveActiveRideSnapshot(profile.id, snapshot);
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushRideSnapshot();
    };

    window.addEventListener('pagehide', flushRideSnapshot);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flushRideSnapshot);
      document.removeEventListener('visibilitychange', flushWhenHidden);
    };
  }, [profile.id]);

  useEffect(() => {
    setAudioMode(
      loadPassengerAlertAudioMode(
        profile.id,
        profile.alert_audio_mode,
      ),
    );
  }, [profile.alert_audio_mode, profile.id]);

  useEffect(() => {
    const unlock = () => {
      void primePassengerAudio();
    };

    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  const handleAudioModeChange = useCallback(
    async (mode: AlertAudioMode) => {
      setAudioMode(mode);
      setProfile({ ...profile, alert_audio_mode: mode });
      await savePassengerAlertAudioMode(profile.id, mode);
    },
    [profile, setProfile],
  );

  useEffect(() => {
    let active = true;

    const loadBanners = async () => {
      const nowIso = new Date().toISOString();
      let query = supabase
        .from('banners')
        .select('id, campaign_name, image_url, redirect_link, display_time_seconds, active, city_id, starts_at, ends_at, priority')
        .eq('active', true)
        .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
        .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      query = profile.city_id
        ? query.or(`city_id.is.null,city_id.eq.${profile.city_id}`)
        : query.is('city_id', null);

      const { data, error } = await query;
      if (!active || error) return;

      const loadedBanners = (data as Banner[]) || [];
      setBanners(loadedBanners);
      setBannerIdx(0);
    };

    void loadBanners();

    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadBanners();
      }
    };

    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, [profile.city_id]);

  const dismissedBannerIdSet = useMemo(
    () => new Set(dismissedBannerIds),
    [dismissedBannerIds],
  );
  const visibleBanners = useMemo(
    () => banners.filter((banner) => !dismissedBannerIdSet.has(banner.id)),
    [banners, dismissedBannerIdSet],
  );
  const currentBanner = visibleBanners.length > 0
    ? visibleBanners[bannerIdx % visibleBanners.length]
    : undefined;

  useEffect(() => {
    if (!currentBanner || visibleBanners.length <= 1 || phase !== 'idle') return;

    const seconds = Math.max(2, Math.min(120, Number(currentBanner.display_time_seconds ?? 6)));
    const timer = window.setTimeout(() => {
      setBannerIdx((current) => (current + 1) % visibleBanners.length);
    }, seconds * 1000);

    return () => window.clearTimeout(timer);
  }, [currentBanner?.id, currentBanner?.display_time_seconds, visibleBanners.length, phase]);

  useEffect(() => {
    let active = true;

    void (async () => {
      const cached = readCachedPassengerLocation(profile.id)?.coordinates ?? null;

      if (cached && isValidCoordinates(cached)) {
        // Caminho mais rápido em reaberturas: usa a posição recente para buscar
        // os carros antes de criar o Mapbox. O GPS real atualiza em paralelo.
        applyPassengerLocation(cached);
        await Promise.race([
          primeNearbyDrivers(cached),
          sleep(1000),
        ]);

        if (!active) return;
        setLocationReady(true);

        void resolveCurrentCoordinates()
          .then((result) => {
            if (!active || !result.coordinates) return;
            applyPassengerLocation(result.coordinates);
            void primeNearbyDrivers(result.coordinates);
          })
          .catch((error) => {
            console.warn('Atualização do GPS após abrir o mapa falhou:', error);
          });
        return;
      }

      const result = await resolveCurrentCoordinates();
      if (!active) return;

      if (result.coordinates) {
        applyPassengerLocation(result.coordinates);
        await Promise.race([
          primeNearbyDrivers(result.coordinates),
          sleep(1200),
        ]);
      }

      if (active) setLocationReady(true);
    })().catch((error) => {
      console.warn('Não foi possível preparar a localização:', error);
      if (active) setLocationReady(true);
    });

    return () => {
      active = false;
    };
  }, [applyPassengerLocation, primeNearbyDrivers, profile.id, resolveCurrentCoordinates]);

  useEffect(() => {
    let active = true;

    const loadDrivers = async () => {
      if (nearbyDriversLoadInFlightRef.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

      const longitude = origin?.coordinates?.[0];
      const latitude = origin?.coordinates?.[1];

      // Não apagamos os carros já conhecidos enquanto a localização do
      // passageiro está sendo recuperada. Um atraso momentâneo do GPS não pode
      // fazer todos os motoristas piscarem/sumirem do mapa.
      if (longitude === undefined || latitude === undefined) {
        return;
      }

      nearbyDriversLoadInFlightRef.current = true;

      try {
        const { data, error } = await supabase.rpc(
          'get_nearby_driver_markers_tum',
          {
            p_latitude: latitude,
            p_longitude: longitude,
            p_radius_km: 15,
          },
        );

        // Falha de rede/RPC é transitória. Mantemos a última lista válida no
        // mapa e tentamos novamente no próximo pulso, em vez de zerar os carros.
        if (error) {
          console.warn('Falha ao carregar motoristas próximos:', error.message);
          return;
        }

        if (!active) return;

        const now = Date.now();
        const cache = nearbyDriverCacheRef.current;
        const freshDrivers = ((data as DriverLocation[]) || []).filter(
          (driver) => driver && driver.is_online !== false,
        );
        const freshIds = new Set<string>();

        freshDrivers.forEach((driver) => {
          const key = String(driver.driver_id ?? driver.id ?? '').trim();
          if (!key) return;

          freshIds.add(key);
          cache.set(key, { driver, lastSeenAt: now });
        });

        // Um motorista não some por causa de um único retorno vazio/intermitente.
        // Só o retiramos depois de vários polls bem-sucedidos sem ele. Se o
        // backend continuar informando is_online=true, ele é renovado aqui a
        // cada 3 s mesmo que esteja parado e o updated_at seja antigo.
        cache.forEach((entry, key) => {
          if (freshIds.has(key)) return;
          if (now - entry.lastSeenAt >= NEARBY_DRIVER_RETENTION_MS) {
            cache.delete(key);
          }
        });

        const nextDrivers = Array.from(cache.values(), (entry) => entry.driver);
        const nextSignature = driverListSignature(nextDrivers);

        if (nextSignature !== nearbyDriversSignatureRef.current) {
          nearbyDriversSignatureRef.current = nextSignature;
          setDrivers(nextDrivers);
        }
      } catch (caughtError) {
        // Mesmo princípio do erro de RPC: conexão ruim não apaga os carros.
        console.warn('Motoristas próximos indisponíveis:', caughtError);
      } finally {
        nearbyDriversLoadInFlightRef.current = false;
      }
    };

    void loadDrivers();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadDrivers();
      }
    }, NEARBY_DRIVERS_POLL_MS);

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadDrivers();
      }
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [origin?.coordinates?.[0], origin?.coordinates?.[1], activeRide?.id, activeRide?.status]);

  const loadRideDetails = useCallback(
    async (rideId: string): Promise<PassengerRideDetails | null> => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setNetworkOnline(false);
        setRideSyncProblem(true);
        return null;
      }

      // Realtime, polling, foco da janela e reconexão podem pedir a mesma
      // corrida quase no mesmo instante. Coalescer a chamada evita rajadas de
      // RPC e, junto com a sequência abaixo, impede uma resposta antiga de
      // sobrescrever um estágio mais novo da corrida.
      const existing = rideDetailsInFlightRef.current;
      if (existing?.rideId === rideId) return existing.promise;

      const requestSequence = ++rideDetailsRequestSequenceRef.current;
      const promise = (async (): Promise<PassengerRideDetails | null> => {
        try {
          const { data, error } = await supabase.rpc(
            'get_passenger_ride_details',
            { p_ride_id: rideId },
          );

          if (requestSequence !== rideDetailsRequestSequenceRef.current) {
            return null;
          }

          if (error) {
            console.error('Erro ao carregar detalhes da corrida:', error);
            setRideSyncProblem(true);
            return null;
          }

          const details = data as PassengerRideDetails | null;
          if (!details?.ride) return null;

          // Uma resposta de uma corrida antiga nunca pode reaparecer por cima
          // da corrida atual depois de cancelamento/reset/nova solicitação.
          const currentRideId = activeRideRef.current?.id;
          if (currentRideId && currentRideId !== rideId) return null;

          setNetworkOnline(true);
          setRideSyncProblem(false);

      const nextStage = audioStageForStatus(details.ride.status);
      const previousAudioState = rideAudioStateRef.current;

      if (
        previousAudioState?.rideId === details.ride.id &&
        previousAudioState.stage !== nextStage
      ) {
        // Ao mudar o trecho da viagem, remove imediatamente a rota anterior.
        // Assim a rota passageiro→destino nunca fica visível depois do aceite,
        // e a nova rota motorista→passageiro (ou motorista→próxima parada)
        // entra assim que o GPS do motorista estiver disponível.
        if (nextStage === 'queued' || nextStage === 'accepted' || nextStage === 'started') {
          // Invalida o cálculo, mas preserva a última geometria válida até a
          // nova rota chegar. Isso elimina o "pisca/some" na troca de etapa.
          lastDriverRouteRequestRef.current = null;
        }
        // Com o Passageiro em segundo plano/fechado, o aviso é responsabilidade
        // da notificação nativa (inclusive os canais com voz). O player HTML só
        // toca quando o TUM está visível, evitando áudio duplicado. O estágio é
        // atualizado logo abaixo mesmo quando oculto, então não repete ao voltar.
        if (document.visibilityState === 'visible') {
          if (nextStage === 'queued') {
            if (!nativeActions) void playPassengerAudioEvent('queue_waiting', audioMode);
            vibratePassenger([120, 80, 120]);
          } else if (nextStage === 'accepted') {
            if (!nativeActions) void playPassengerAudioEvent('ride_accepted', audioMode);
            vibratePassenger([120, 80, 120]);
          } else if (nextStage === 'arrived') {
            if (!nativeActions) void playPassengerAudioEvent('driver_arrived', audioMode);
            vibratePassenger([180, 100, 180]);
          } else if (nextStage === 'started') {
            if (!nativeActions) void playPassengerAudioEvent('ride_started', audioMode);
            vibratePassenger(180);
          } else if (nextStage === 'completed') {
            if (!nativeActions) void playPassengerAudioEvent('ride_completed', audioMode);
            vibratePassenger([180, 100, 300]);
          } else if (nextStage === 'cancelled') {
            if (!nativeActions) void playPassengerAudioEvent('ride_cancelled', audioMode);
            vibratePassenger([220, 120, 220]);
          }
        }
      }

      rideAudioStateRef.current = {
        rideId: details.ride.id,
        stage: nextStage,
      };

      setActiveRide(details.ride);
      setActiveStops(Array.isArray(details.stops) ? details.stops : []);
      setPhase(phaseForStatus(details.ride.status));
      setRideDriver((current) => {
        const incoming = details.driver;

        // Mesmo enquanto a corrida está na fila, o passageiro pode acompanhar
        // a posição atual do motorista. O backend não expõe o endereço da corrida
        // anterior; apenas coordenadas para o desenho do mapa.
        if (details.ride.status === 'queued') {
          return incoming ?? current ?? null;
        }

        if (!incoming) {
          return current;
        }

        const incomingLng = Number(incoming.longitude);
        const incomingLat = Number(incoming.latitude);
        const incomingHasPosition =
          Number.isFinite(incomingLng) && Number.isFinite(incomingLat);

        const currentLng = Number(current?.longitude);
        const currentLat = Number(current?.latitude);
        const currentHasPosition =
          Number.isFinite(currentLng) && Number.isFinite(currentLat);

        // Nunca apaga o carrinho por causa de um pulso temporariamente sem GPS.
        // Mantém a última posição válida até chegar uma coordenada nova.
        if (!incomingHasPosition && current && currentHasPosition) {
          return {
            ...current,
            ...incoming,
            latitude: current.latitude,
            longitude: current.longitude,
            updated_at: current.updated_at ?? incoming.updated_at,
          };
        }

        if (
          current?.driver_id === incoming.driver_id &&
          current.updated_at &&
          incoming.updated_at &&
          new Date(current.updated_at).getTime() >
            new Date(incoming.updated_at).getTime()
        ) {
          return current;
        }

        return incoming;
      });

      if (details.ride.status === 'cancelled') {
        clearActiveRideSnapshot(profile.id);
        setAlertMsg('A corrida foi cancelada.');
        setActiveRide(null);
        setRideDriver(null);
        setActiveStops([]);
        setRouteCoords(null);
        setQueuedCurrentRouteCoords(null);
        setQueuedNextRouteCoords(null);
        setQueuedCurrentDestination(null);
        setEtaMin(null);
        setPhase('idle');
      }

      if (details.ride.status === 'no_drivers') {
        clearActiveRideSnapshot(profile.id);
        setAlertMsg(
          'Nenhum motorista aceitou a corrida. Tente novamente em instantes.',
        );
        setActiveRide(null);
        setRideDriver(null);
        setActiveStops([]);
        setRouteCoords(null);
        setQueuedCurrentRouteCoords(null);
        setQueuedNextRouteCoords(null);
        setQueuedCurrentDestination(null);
        setEtaMin(null);
        setPhase('idle');
      }

          return details;
        } catch (caughtError) {
          if (requestSequence === rideDetailsRequestSequenceRef.current) {
            console.warn('Sincronização da corrida indisponível temporariamente:', caughtError);
            setRideSyncProblem(true);
            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
              setNetworkOnline(false);
            }
          }
          return null;
        }
      })();

      rideDetailsInFlightRef.current = { rideId, promise };
      try {
        return await promise;
      } finally {
        if (rideDetailsInFlightRef.current?.promise === promise) {
          rideDetailsInFlightRef.current = null;
        }
      }
    },
    [audioMode, nativeActions, profile.id],
  );

  const updateDriverRoute = useCallback(
    async (
      ride: Ride,
      driver: DriverLocation | null,
      force = false,
    ) => {
      if (!driver) {
        // Pulso de GPS ausente é transitório. Não apaga a rota/carrinho que já
        // estava correto; o próximo realtime/poll recupera a posição.
        return;
      }

      const longitude = Number(driver.longitude);
      const latitude = Number(driver.latitude);

      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return;
      }

      const driverCoordinates: [number, number] = [longitude, latitude];

      if (ride.status === 'queued') {
        setRouteCoords(null);

        const currentOriginLatRaw = ride.queue_current_origin_lat;
        const currentOriginLngRaw = ride.queue_current_origin_lng;
        const currentDestinationLatRaw = ride.queue_current_destination_lat;
        const currentDestinationLngRaw = ride.queue_current_destination_lng;
        const currentRideStatus = ride.queue_current_status ?? null;
        const pickupLatRaw = ride.origin_lat;
        const pickupLngRaw = ride.origin_lng;
        const currentOriginLat = Number(currentOriginLatRaw);
        const currentOriginLng = Number(currentOriginLngRaw);
        const currentDestinationLat = Number(currentDestinationLatRaw);
        const currentDestinationLng = Number(currentDestinationLngRaw);
        const pickupLat = Number(pickupLatRaw);
        const pickupLng = Number(pickupLngRaw);

        const hasCurrentOrigin =
          currentOriginLatRaw !== null &&
          currentOriginLatRaw !== undefined &&
          currentOriginLngRaw !== null &&
          currentOriginLngRaw !== undefined &&
          Number.isFinite(currentOriginLat) &&
          Number.isFinite(currentOriginLng);
        const hasCurrentDestination =
          currentDestinationLatRaw !== null &&
          currentDestinationLatRaw !== undefined &&
          currentDestinationLngRaw !== null &&
          currentDestinationLngRaw !== undefined &&
          Number.isFinite(currentDestinationLat) &&
          Number.isFinite(currentDestinationLng);
        const hasPickup =
          pickupLatRaw !== null &&
          pickupLatRaw !== undefined &&
          pickupLngRaw !== null &&
          pickupLngRaw !== undefined &&
          Number.isFinite(pickupLat) &&
          Number.isFinite(pickupLng);

        if (!hasPickup) {
          setQueuedCurrentRouteCoords(null);
          setQueuedNextRouteCoords(null);
          setQueuedCurrentDestination(null);
          setEtaMin(null);
          return;
        }

        const pickup: [number, number] = [pickupLng, pickupLat];
        const queuePosition = Math.max(1, Number(ride.queue_position ?? 1) || 1);
        const afterCurrentEstimatedMinutes = Math.max(
          0,
          Number(ride.queue_after_current_estimated_minutes ?? 0) || 0,
        );

        if (!hasCurrentDestination) {
          setQueuedCurrentRouteCoords(null);
          setQueuedCurrentDestination(null);
          setQueuedNextRouteCoords((current) => current?.length ? current : [driverCoordinates, pickup]);

          try {
            const direct = await getDirections(driverCoordinates, pickup);
            if (direct?.geometry.coordinates?.length) {
              setQueuedNextRouteCoords(direct.geometry.coordinates);
              setEtaMin(Math.max(1, Math.round(direct.duration / 60)));
            }
          } catch {
            const straightDistanceKm = haversineKm(driverCoordinates, pickup);
            setEtaMin(Math.max(1, Math.round((straightDistanceKm / 25) * 60)));
          }
          return;
        }

        const currentOrigin: [number, number] | null = hasCurrentOrigin
          ? [currentOriginLng, currentOriginLat]
          : null;
        const currentDestination: [number, number] = [currentDestinationLng, currentDestinationLat];
        const currentRideHasStarted = ['started', 'in_progress'].includes(String(currentRideStatus ?? ''));

        setQueuedCurrentDestination(currentDestination);
        setQueuedCurrentRouteCoords((current) => {
          if (current?.length) return current;
          if (!currentRideHasStarted && currentOrigin) {
            return [driverCoordinates, currentOrigin, currentDestination];
          }
          return [driverCoordinates, currentDestination];
        });
        if (queuePosition === 1) {
          setQueuedNextRouteCoords((current) => current?.length ? current : [currentDestination, pickup]);
        } else {
          setQueuedNextRouteCoords(null);
        }

        const now = Date.now();
        const lastRequest = lastDriverRouteRequestRef.current;
        const movedKm = lastRequest
          ? haversineKm(lastRequest.coordinates, driverCoordinates)
          : Number.POSITIVE_INFINITY;
        const routeTarget = !currentRideHasStarted && currentOrigin
          ? currentOrigin
          : currentDestination;
        const sameTarget = lastRequest &&
          Math.abs(lastRequest.target[0] - routeTarget[0]) < 0.000001 &&
          Math.abs(lastRequest.target[1] - routeTarget[1]) < 0.000001;

        if (
          !force &&
          lastRequest?.status === 'queued' &&
          sameTarget &&
          movedKm < 0.012 &&
          now - lastRequest.requestedAt < 8000
        ) {
          return;
        }

        lastDriverRouteRequestRef.current = {
          status: ride.status,
          coordinates: driverCoordinates,
          target: routeTarget,
          requestedAt: now,
        };

        const sequence = ++driverRouteSequenceRef.current;

        try {
          const currentDirectionsPromise = !currentRideHasStarted && currentOrigin
            ? getDirectionsWithStops(driverCoordinates, [currentOrigin], currentDestination)
            : getDirections(driverCoordinates, currentDestination);
          const nextDirectionsPromise = queuePosition === 1
            ? getDirections(currentDestination, pickup)
            : Promise.resolve(null);
          const [currentDirections, nextDirections] = await Promise.all([
            currentDirectionsPromise,
            nextDirectionsPromise,
          ]);

          if (sequence !== driverRouteSequenceRef.current) return;

          if (currentDirections?.geometry.coordinates?.length) {
            setQueuedCurrentRouteCoords(currentDirections.geometry.coordinates);
          }
          if (queuePosition === 1 && nextDirections?.geometry.coordinates?.length) {
            setQueuedNextRouteCoords(nextDirections.geometry.coordinates);
          } else if (queuePosition > 1) {
            setQueuedNextRouteCoords(null);
          }

          const totalSeconds = queuePosition === 1
            ? Number(currentDirections?.duration ?? 0) + Number(nextDirections?.duration ?? 0)
            : Number(currentDirections?.duration ?? 0) + afterCurrentEstimatedMinutes * 60;
          if (Number.isFinite(totalSeconds) && totalSeconds > 0) {
            setEtaMin(Math.max(1, Math.round(totalSeconds / 60)));
          }
        } catch (error) {
          console.warn('Não foi possível calcular a espera da próxima corrida:', error);
          const currentKm = !currentRideHasStarted && currentOrigin
            ? haversineKm(driverCoordinates, currentOrigin) + haversineKm(currentOrigin, currentDestination)
            : haversineKm(driverCoordinates, currentDestination);
          const fallbackMinutes = queuePosition === 1
            ? ((currentKm + haversineKm(currentDestination, pickup)) / 25) * 60
            : (currentKm / 25) * 60 + afterCurrentEstimatedMinutes;
          setEtaMin(Math.max(1, Math.round(fallbackMinutes)));
        }

        return;
      }

      setQueuedCurrentRouteCoords(null);
      setQueuedNextRouteCoords(null);
      setQueuedCurrentDestination(null);

      const nextStop = activeStopsRef.current
        .filter((stop) => stop.status !== 'completed')
        .sort((a, b) => a.stop_order - b.stop_order)[0];

      const target: [number, number] | null =
        ['started', 'in_progress'].includes(ride.status)
          ? nextStop
            ? [Number(nextStop.longitude), Number(nextStop.latitude)]
            : ride.destination_lng !== null && ride.destination_lat !== null
              ? [Number(ride.destination_lng), Number(ride.destination_lat)]
              : destinationRef.current?.coordinates ?? null
          : ride.origin_lng !== null && ride.origin_lat !== null
            ? [Number(ride.origin_lng), Number(ride.origin_lat)]
            : originRef.current?.coordinates ?? null;

      if (!target) {
        return;
      }

      const now = Date.now();
      const lastRequest = lastDriverRouteRequestRef.current;
      const movedKm = lastRequest
        ? haversineKm(lastRequest.coordinates, driverCoordinates)
        : Number.POSITIVE_INFINITY;

      const sameTarget =
        lastRequest &&
        Math.abs(lastRequest.target[0] - target[0]) < 0.000001 &&
        Math.abs(lastRequest.target[1] - target[1]) < 0.000001;

      const sameRouteContext =
        lastRequest?.status === ride.status && Boolean(sameTarget);

      // Mudou de fase/alvo: a rota anterior deixa de representar o trecho
      // atual. Removemos a geometria velha e aguardamos a rota real das ruas;
      // linha reta nunca é apresentada ao passageiro como navegação.
      if (!sameRouteContext) {
        setRouteCoords(null);
      }

      if (
        !force &&
        lastRequest?.status === ride.status &&
        sameTarget &&
        movedKm < 0.005 &&
        now - lastRequest.requestedAt < 3000
      ) {
        return;
      }

      lastDriverRouteRequestRef.current = {
        status: ride.status,
        coordinates: driverCoordinates,
        target,
        requestedAt: now,
      };

      const sequence = ++driverRouteSequenceRef.current;

      try {
        const rideStarted = ['started', 'in_progress'].includes(ride.status);
        const finalDestination: [number, number] | null =
          ride.destination_lng !== null && ride.destination_lat !== null
            ? [Number(ride.destination_lng), Number(ride.destination_lat)]
            : destinationRef.current?.coordinates ?? null;

        const remainingStopCoordinates = activeStopsRef.current
          .filter((stop) => stop.status !== 'completed')
          .sort((a, b) => a.stop_order - b.stop_order)
          .map((stop) => [Number(stop.longitude), Number(stop.latitude)] as [number, number])
          .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));

        // Fluxo visual do Passageiro:
        // 1) antes do embarque: APENAS motorista → passageiro;
        // 2) depois de iniciar: motorista → paradas restantes → destino.
        // Assim o enquadramento fecha naturalmente conforme o motorista chega.
        const directions =
          rideStarted && finalDestination
            ? await getDirectionsWithStops(
                driverCoordinates,
                remainingStopCoordinates,
                finalDestination,
              )
            : await getDirections(driverCoordinates, target);

        if (
          sequence !== driverRouteSequenceRef.current ||
          !directions?.geometry.coordinates?.length
        ) {
          return;
        }

        setRouteCoords(directions.geometry.coordinates);

        // A rota desta fase já termina no alvo correto, então o ETA pode usar
        // diretamente a duração real calculada pelo Mapbox.
        setEtaMin(Math.max(1, Math.round(directions.duration / 60)));
      } catch (error) {
        console.warn('Não foi possível atualizar a rota do motorista:', error);

        const straightDistanceKm = haversineKm(driverCoordinates, target);
        setEtaMin(Math.max(1, Math.round((straightDistanceKm / 25) * 60)));
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeRide || !rideDriver) return;
    void updateDriverRoute(activeRide, rideDriver);
  }, [
    activeRide?.id,
    activeRide?.status,
    rideDriver?.latitude,
    rideDriver?.longitude,
    activeStops,
    updateDriverRoute,
  ]);

  useEffect(() => {
    const cached = readActiveRideSnapshot(profile.id);
    if (!cached || !isActiveStatus(cached.ride.status)) return;

    rideAudioStateRef.current = {
      rideId: cached.ride.id,
      stage: audioStageForStatus(cached.ride.status),
    };

    setActiveRide(cached.ride);
    setActiveStops(cached.stops);
    setRideDriver(cached.driver);
    setRouteCoords(cached.routeCoords);
    setQueuedCurrentRouteCoords(cached.queuedCurrentRouteCoords);
    setQueuedNextRouteCoords(cached.queuedNextRouteCoords);
    setQueuedCurrentDestination(cached.queuedCurrentDestination);
    setEtaMin(cached.etaMin);
    setPhase(phaseForStatus(cached.ride.status));

    const pickup: [number, number] | null =
      cached.ride.origin_lng !== null && cached.ride.origin_lat !== null
        ? [Number(cached.ride.origin_lng), Number(cached.ride.origin_lat)]
        : null;
    const dropoff: [number, number] | null =
      cached.ride.destination_lng !== null && cached.ride.destination_lat !== null
        ? [Number(cached.ride.destination_lng), Number(cached.ride.destination_lat)]
        : null;

    if (pickup && isValidCoordinates(pickup)) {
      setOrigin({
        place_name: cached.ride.origin_address || 'Embarque',
        coordinates: pickup,
      });
    }
    if (dropoff && isValidCoordinates(dropoff)) {
      setDestination({
        place_name: cached.ride.destination_address || 'Destino',
        coordinates: dropoff,
      });
    }
  }, [profile.id]);

  const recoverRideFromServer = useCallback(async () => {
    if (recoverRideInFlightRef.current) return;
    recoverRideInFlightRef.current = true;

    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setNetworkOnline(false);
        if (activeRideRef.current) setRideSyncProblem(true);
        return;
      }

      setNetworkOnline(true);
      const cached = readActiveRideSnapshot(profile.id);

      if (cached?.ride?.id) {
        const refreshed = await loadRideDetails(cached.ride.id);
        if (refreshed?.ride) return;
      }

      const { data, error } = await supabase
        .from('rides')
        .select('*')
        .eq('passenger_id', profile.id)
        .in('status', [
          'searching',
          'queued',
          'accepted',
          'driver_arrived',
          'arrived',
          'waiting',
          'started',
          'in_progress',
        ])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        setRideSyncProblem(Boolean(activeRideRef.current || cached));
        return;
      }

      setRideSyncProblem(false);

      if (data) {
        const ride = data as Ride;
        if (isActiveStatus(ride.status)) {
          await loadRideDetails(ride.id);
          return;
        }
      }

      // Se o servidor respondeu normalmente e não existe mais corrida ativa,
      // ele é a fonte oficial. Remove apenas snapshot não concluído que ficou velho.
      if (cached && cached.ride.status !== 'completed') {
        clearActiveRideSnapshot(profile.id);
        if (activeRideRef.current?.id === cached.ride.id) {
          rideDetailsRequestSequenceRef.current += 1;
          rideAudioStateRef.current = null;
          setActiveRide(null);
          setRideDriver(null);
          setActiveStops([]);
          setRouteCoords(null);
          setQueuedCurrentRouteCoords(null);
          setQueuedNextRouteCoords(null);
          setQueuedCurrentDestination(null);
          setEtaMin(null);
          setPhase('idle');
        }
      }
    } catch (caughtError) {
      console.warn('Não foi possível recuperar a corrida ativa:', caughtError);
      setRideSyncProblem(Boolean(activeRideRef.current || readActiveRideSnapshot(profile.id)));
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setNetworkOnline(false);
      }
    } finally {
      recoverRideInFlightRef.current = false;
    }
  }, [profile.id, loadRideDetails]);

  useEffect(() => {
    void recoverRideFromServer();
  }, [recoverRideFromServer]);

  useEffect(() => {
    const handleOnline = () => {
      setNetworkOnline(true);
      void recoverRideFromServer();
    };
    const handleOffline = () => {
      setNetworkOnline(false);
      if (activeRideRef.current) setRideSyncProblem(true);
    };
    const handleVisible = () => {
      if (document.visibilityState === 'visible') {
        void recoverRideFromServer();
      }
    };
    const handleFocus = () => {
      void recoverRideFromServer();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisible);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, [recoverRideFromServer]);

  useEffect(() => {
    if (!activeRide?.id) return;

    const rideId = activeRide.id;

    const channel = supabase
      .channel(`passenger-ride-${rideId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rides',
          filter: `id=eq.${rideId}`,
        },
        () => {
          void loadRideDetails(rideId);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ride_stops',
          filter: `ride_id=eq.${rideId}`,
        },
        () => {
          void loadRideDetails(rideId);
        },
      )
      .subscribe();

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadRideDetails(rideId);
      }
    }, ACTIVE_RIDE_FALLBACK_POLL_MS);

    return () => {
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [activeRide?.id, loadRideDetails]);

  useEffect(() => {
    if (
      !activeRide?.id ||
      !rideDriver?.driver_id ||
      !['queued', 'accepted', 'driver_arrived', 'arrived', 'waiting', 'started', 'in_progress'].includes(
        activeRide.status,
      )
    ) {
      return;
    }

    const rideId = activeRide.id;
    let cancelled = false;
    let timer: number | null = null;

    const scheduleNext = (delay = RIDE_DRIVER_POLL_MS) => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        void pollDriverLocation();
      }, delay);
    };

    const pollDriverLocation = async () => {
      if (cancelled) return;

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        scheduleNext(HIDDEN_RIDE_DRIVER_POLL_MS);
        return;
      }

      if (document.visibilityState !== 'visible') {
        scheduleNext(HIDDEN_RIDE_DRIVER_POLL_MS);
        return;
      }

      try {
        const { data, error } = await supabase.rpc(
          'get_passenger_ride_driver_location_tum',
          { p_ride_id: rideId },
        );

        if (!cancelled && !error && data && typeof data === 'object') {
          const pulse = data as Partial<DriverLocation>;
          const latitude = Number(pulse.latitude);
          const longitude = Number(pulse.longitude);

          if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            setRideDriver((current) => {
              if (!current) return current;

              const currentUpdatedAt = current.location_sampled_at
                ? new Date(current.location_sampled_at).getTime()
                : current.updated_at
                  ? new Date(current.updated_at).getTime()
                  : 0;
              const incomingUpdatedAt = pulse.location_sampled_at
                ? new Date(pulse.location_sampled_at).getTime()
                : pulse.updated_at
                  ? new Date(pulse.updated_at).getTime()
                  : Date.now();

              if (
                Number.isFinite(currentUpdatedAt) &&
                Number.isFinite(incomingUpdatedAt) &&
                incomingUpdatedAt < currentUpdatedAt
              ) {
                return current;
              }

              if (
                Math.abs(Number(current.latitude) - latitude) < 0.0000001 &&
                Math.abs(Number(current.longitude) - longitude) < 0.0000001 &&
                currentUpdatedAt === incomingUpdatedAt
              ) {
                return current;
              }

              return {
                ...current,
                latitude,
                longitude,
                updated_at:
                  typeof pulse.updated_at === 'string'
                    ? pulse.updated_at
                    : current.updated_at,
                location_sampled_at:
                  typeof pulse.location_sampled_at === 'string'
                    ? pulse.location_sampled_at
                    : current.location_sampled_at,
                heading_degrees:
                  typeof pulse.heading_degrees === 'number'
                    ? pulse.heading_degrees
                    : current.heading_degrees,
                speed_mps:
                  typeof pulse.speed_mps === 'number'
                    ? pulse.speed_mps
                    : current.speed_mps,
                accuracy_m:
                  typeof pulse.accuracy_m === 'number'
                    ? pulse.accuracy_m
                    : current.accuracy_m,
              };
            });
          }
        }
      } catch (error) {
        console.warn('Não foi possível suavizar a posição do motorista:', error);
      } finally {
        scheduleNext();
      }
    };

    void pollDriverLocation();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [activeRide?.id, activeRide?.status, rideDriver?.driver_id]);

  useEffect(() => {
    if (!activeRide?.id || phase !== 'searching') return;

    let cancelled = false;
    let inFlight = false;
    const rideId = activeRide.id;

    const processTimeout = async () => {
      if (cancelled || inFlight) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      inFlight = true;
      try {
        const { error } = await supabase.rpc('process_ride_offer_timeout', {
          p_ride_id: rideId,
        });
        if (error) {
          console.warn('Erro ao processar tempo da oferta:', error.message);
        }
      } catch (error) {
        console.warn('Não foi possível processar o tempo da oferta:', error);
      } finally {
        inFlight = false;
      }
    };

    const interval = window.setInterval(() => void processTimeout(), 2000);
    void processTimeout();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeRide?.id, phase]);

  useEffect(() => {
    if (phase !== 'idle') return;

    if (!origin?.coordinates || !destination?.coordinates) {
      invalidateIdleRoute();
      return;
    }

    const stopCoordinates = stops
      .map((stop) => stop.coordinates)
      .filter((coordinates): coordinates is [number, number] => coordinates !== null);

    if (stopCoordinates.length !== stops.length) {
      invalidateIdleRoute();
      return;
    }

    let active = true;
    const sequence = ++idleRouteSequenceRef.current;
    const routeOrigin = origin.coordinates;
    const routeDestination = destination.coordinates;

    // Nunca mostramos linha reta como se fosse rota. Ao trocar origem/destino,
    // removemos imediatamente a geometria anterior e só desenhamos a resposta
    // real do serviço de Directions.
    setRouteCoords(null);

    void (async () => {
      try {
        const directions = await getDirectionsWithStops(
          routeOrigin,
          stopCoordinates,
          routeDestination,
        );

        if (!active || sequence !== idleRouteSequenceRef.current) return;

        if (directions?.geometry.coordinates?.length) {
          setRouteCoords(directions.geometry.coordinates);
        } else {
          setRouteCoords(null);
          console.warn('O serviço de rotas não devolveu geometria para o destino selecionado.');
        }
      } catch (error) {
        if (active && sequence === idleRouteSequenceRef.current) {
          setRouteCoords(null);
        }
        console.warn('Não foi possível atualizar a rota selecionada:', error);
      }
    })();

    return () => {
      active = false;
    };
  }, [phase, origin?.coordinates, destination?.coordinates, stops, invalidateIdleRoute]);

  // O RPC já limita os motoristas online a um raio de 15 km e remove
  // localizações antigas. No passageiro mostramos todos os retornados,
  // como nos apps de mobilidade, sem cortar novamente em 6 km.
  const nearbyDrivers = drivers;

  async function rollbackCreatedRide(rideId: string): Promise<boolean> {
    const retryDelays = [0, 350, 850];
    for (const delay of retryDelays) {
      if (delay) await sleep(delay);
      try {
        const { error } = await supabase.rpc('cancel_passenger_ride', {
          p_ride_id: rideId,
        });
        if (!error) return true;
        console.warn('Falha ao desfazer corrida incompleta:', error.message);
      } catch (error) {
        console.warn('Falha de rede ao desfazer corrida incompleta:', error);
      }
    }
    return false;
  }

  async function requestRide(payload: RideRequestPayload): Promise<boolean> {
    if (!origin?.coordinates || !destination?.coordinates) return false;
    if (requestRideInFlightRef.current) return false;

    requestRideInFlightRef.current = true;
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setNetworkOnline(false);
        setAlertMsg('Sem internet para solicitar a corrida. Assim que a conexão voltar, tente novamente.');
        return false;
      }

      // Proteção contra corrida duplicada: mesmo que a interface tenha sido
      // recarregada no meio de uma falha, nunca criamos uma segunda corrida
      // antes de confirmar no servidor que não existe outra em andamento.
      const localRide = activeRideRef.current;
      if (localRide && isActiveStatus(localRide.status) && localRide.status !== 'completed') {
        setShowRequest(false);
        await loadRideDetails(localRide.id);
        setAlertMsg('Você já possui uma corrida em andamento.');
        return true;
      }

      const { data: existingRideData, error: existingRideError } = await supabase
        .from('rides')
        .select('*')
        .eq('passenger_id', profile.id)
        .in('status', [
          'searching',
          'queued',
          'accepted',
          'driver_arrived',
          'arrived',
          'waiting',
          'started',
          'in_progress',
        ])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingRideError) {
        setRideSyncProblem(true);
        setAlertMsg('Não foi possível confirmar o estado das suas corridas. Verifique a conexão e tente novamente.');
        return false;
      }

      if (existingRideData) {
        const existingRide = existingRideData as Ride;
        setShowRequest(false);
        await loadRideDetails(existingRide.id);
        setAlertMsg('Encontramos uma corrida sua já em andamento e restauramos ela.');
        return true;
      }

      const { data, error } = await supabase
        .from('rides')
        .insert({
          passenger_id: profile.id,
          city_id: payload.cityId,
          category: payload.category,
          payment_method: payload.paymentMethod,
          amount: payload.amount,
          discount_amount: payload.discount,
          final_amount: payload.finalAmount,
          coupon_code: payload.couponCode,
          status: 'searching',
          origin_address: origin.place_name,
          origin_lat: origin.coordinates[1],
          origin_lng: origin.coordinates[0],
          destination_address: destination.place_name,
          destination_lat: destination.coordinates[1],
          destination_lng: destination.coordinates[0],
          distance_km: payload.distanceKm,
          duration_minutes: payload.durationMinutes,
          direct_distance_km: payload.directDistanceKm,
          direct_duration_minutes: payload.directDurationMinutes,
          stop_count: payload.stops.length,
          pricing_base_price: payload.pricing.basePrice,
          pricing_price_per_km: payload.pricing.pricePerKm,
          pricing_price_per_minute: payload.pricing.pricePerMinute,
          pricing_minimum_fare: payload.pricing.minimumFare,
          pricing_waiting_fee_per_minute: payload.pricing.waitingFeePerMinute,
          pricing_free_waiting_minutes: payload.pricing.freeWaitingMinutes,
          pricing_multiplier: payload.pricing.multiplier,
          pricing_stops_enabled: payload.pricing.stopsEnabled,
          pricing_max_stops: payload.pricing.maxStops,
          pricing_stop_pricing_mode: payload.pricing.stopPricingMode,
          pricing_fixed_stop_fee: payload.pricing.fixedStopFee,
        })
        .select('*')
        .maybeSingle();

      if (error || !data) {
        console.error('Erro ao criar corrida:', error);
        setAlertMsg(error?.message ?? 'Não foi possível criar a corrida. Tente novamente.');
        return false;
      }

      const ride = data as Ride;
      rideDetailsRequestSequenceRef.current += 1;

      const saveStops = () => supabase.rpc('set_ride_stops_tum', {
        p_ride_id: ride.id,
        p_stops: payload.stops.map((stop) => ({
          address: stop.place_name,
          latitude: stop.coordinates[1],
          longitude: stop.coordinates[0],
        })),
      });

      let stopsResult = await saveStops();
      if (stopsResult.error) {
        await sleep(350);
        stopsResult = await saveStops();
      }

      if (stopsResult.error) {
        console.error('Erro ao salvar paradas:', stopsResult.error);
        const rolledBack = await rollbackCreatedRide(ride.id);
        if (!rolledBack) {
          // Não escondemos uma corrida que talvez ainda exista no servidor.
          // Isso impede que o passageiro crie outra e fique com duas corridas.
          setActiveRide(ride);
          setPhase('searching');
          setRideSyncProblem(true);
          latestActiveRideSnapshotRef.current = {
            ride,
            stops: [],
            driver: null,
            routeCoords,
            queuedCurrentRouteCoords: null,
            queuedNextRouteCoords: null,
            queuedCurrentDestination: null,
            etaMin: null,
          };
          saveActiveRideSnapshot(profile.id, latestActiveRideSnapshotRef.current);
        }
        setAlertMsg(
          rolledBack
            ? stopsResult.error.message
            : 'A conexão caiu durante a criação da corrida. O TUM preservou o estado para evitar uma corrida duplicada. Reconecte a internet antes de tentar novamente.',
        );
        return false;
      }

      const optimisticStops: RideStop[] = payload.stops.map((stop, index) => ({
        id: `${ride.id}-stop-${index + 1}`,
        ride_id: ride.id,
        stop_order: index + 1,
        address: stop.place_name,
        latitude: stop.coordinates[1],
        longitude: stop.coordinates[0],
        status: 'pending',
        arrived_at: null,
        waiting_started_at: null,
        departed_at: null,
        waiting_minutes: 0,
        billable_waiting_minutes: 0,
        waiting_fee: 0,
        fixed_fee:
          payload.pricing.stopPricingMode === 'fixed'
            ? payload.pricing.fixedStopFee
            : 0,
      }));
      setActiveStops(optimisticStops);

      rideAudioStateRef.current = {
        rideId: ride.id,
        stage: audioStageForStatus(ride.status),
      };
      setActiveRide(ride);
      setEtaMin(null);
      lastDriverRouteRequestRef.current = null;
      setPhase('searching');
      setShowRequest(false);

      const startDispatch = () => supabase.rpc('start_ride_dispatch', {
        p_ride_id: ride.id,
      });
      let dispatchResult = await startDispatch();
      if (dispatchResult.error) {
        await sleep(500);
        dispatchResult = await startDispatch();
      }

      if (dispatchResult.error) {
        console.error('Erro ao iniciar busca por motorista:', dispatchResult.error);
        const rolledBack = await rollbackCreatedRide(ride.id);
        if (rolledBack) {
          clearActiveRideSnapshot(profile.id);
          rideDetailsRequestSequenceRef.current += 1;
          setActiveRide(null);
          setRideDriver(null);
          setActiveStops([]);
          setPhase('idle');
        } else {
          setRideSyncProblem(true);
          saveActiveRideSnapshot(profile.id, {
            ride,
            stops: optimisticStops,
            driver: null,
            routeCoords,
            queuedCurrentRouteCoords: null,
            queuedNextRouteCoords: null,
            queuedCurrentDestination: null,
            etaMin: null,
          });
        }
        setAlertMsg(
          rolledBack
            ? dispatchResult.error.message
            : 'A conexão caiu ao iniciar a busca. O TUM manteve a corrida visível para impedir duplicidade. Reconecte a internet para sincronizar.',
        );
        return false;
      }

      await loadRideDetails(ride.id);
      return true;
    } catch (caughtError) {
      console.error('Falha inesperada ao solicitar corrida:', caughtError);
      if (activeRideRef.current) setRideSyncProblem(true);
      setAlertMsg(
        caughtError instanceof Error
          ? caughtError.message
          : 'Não foi possível solicitar a corrida agora. Tente novamente.',
      );
      return false;
    } finally {
      requestRideInFlightRef.current = false;
    }
  }

  function resetRide() {
    clearActiveRideSnapshot(profile.id);
    rideDetailsRequestSequenceRef.current += 1;
    rideDetailsInFlightRef.current = null;
    rideAudioStateRef.current = null;
    setActiveRide(null);
    setRideDriver(null);
    setActiveStops([]);
    setStops([]);
    setRouteCoords(null);
    setQueuedCurrentRouteCoords(null);
    setQueuedNextRouteCoords(null);
    setQueuedCurrentDestination(null);
    setEtaMin(null);
    setPhase('idle');
  }

  async function cancelRide(reasonCode?: string, reasonNote?: string) {
    const ride = activeRideRef.current;
    if (!ride) return;

    const previousAudioState = rideAudioStateRef.current;
    rideAudioStateRef.current = {
      rideId: ride.id,
      stage: 'cancelled',
    };

    const hasAcceptedDriver =
      ride.driver_id != null &&
      ['accepted', 'driver_arrived', 'arrived', 'waiting'].includes(ride.status);

    try {
      let result: { success?: boolean; message?: string; charged?: boolean; fee_amount?: number } | null = null;

      if (hasAcceptedDriver) {
        if (!reasonCode) {
          rideAudioStateRef.current = previousAudioState;
          setAlertMsg('Selecione o motivo do cancelamento.');
          return;
        }

        result = await cancelRideWithReason(ride.id, reasonCode, reasonNote);
      } else {
        const response = await supabase.rpc('cancel_passenger_ride', {
          p_ride_id: ride.id,
        });

        if (response.error) throw response.error;
        result = response.data as { success?: boolean; message?: string } | null;
      }

      if (result?.success === false) {
        rideAudioStateRef.current = previousAudioState;
        setAlertMsg(result.message ?? 'Não foi possível cancelar a corrida.');
        return;
      }

      void playPassengerAudioEvent('ride_cancelled', audioMode);
      vibratePassenger([220, 120, 220]);
      resetRide();

      if (result?.charged && Number(result.fee_amount ?? 0) > 0) {
        const fee = Number(result.fee_amount ?? 0).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        });
        setAlertMsg(`Corrida cancelada. Foi gerada uma taxa de cancelamento de ${fee}.`);
        setCancellationDebtOpen(true);
      }
    } catch (error) {
      rideAudioStateRef.current = previousAudioState;
      setAlertMsg(error instanceof Error ? error.message : 'Não foi possível cancelar a corrida.');
    }
  }

  async function findAnotherDriver() {
    const ride = activeRideRef.current;
    if (!ride || ride.status !== 'queued') return;

    try {
      const { data, error } = await supabase.rpc('passenger_find_another_driver_tum', {
        p_ride_id: ride.id,
      });
      if (error) throw error;

      const result = data as { success?: boolean; message?: string } | null;
      if (result?.success === false) {
        setAlertMsg(result.message ?? 'Não foi possível procurar outro motorista.');
        await loadRideDetails(ride.id);
        return;
      }

      setRideDriver(null);
      setRouteCoords(null);
      setQueuedCurrentRouteCoords(null);
      setQueuedNextRouteCoords(null);
      setQueuedCurrentDestination(null);
      setEtaMin(null);
      setPhase('searching');
      rideAudioStateRef.current = { rideId: ride.id, stage: 'searching' };
      await loadRideDetails(ride.id);
    } catch (error) {
      setAlertMsg(error instanceof Error ? error.message : 'Não foi possível procurar outro motorista.');
    }
  }

  async function finishRating(stars: number, comment: string) {
    const ride = activeRideRef.current;
    if (!ride) return;

    const { error } = await supabase.rpc('submit_passenger_rating', {
      p_ride_id: ride.id,
      p_stars: stars,
      p_comment: comment || null,
    });

    if (error) {
      setAlertMsg(error.message);
      return;
    }

    resetRide();
  }

  const locateMe = useCallback(async () => {
    setLocating(true);

    try {
      const result = await resolveCurrentCoordinates();

      if (!result.coordinates) {
        setAlertMsg(
          result.permissionDenied
            ? 'Permita o acesso à localização para o TUM encontrar seu embarque.'
            : 'Não foi possível obter sua localização agora. Verifique se a Localização do aparelho está ligada.',
        );
        return;
      }

      originManualEditRef.current = false;
      applyPassengerLocation(result.coordinates, true, true);
    } catch (error) {
      console.warn('Falha ao solicitar localização:', error);
      setAlertMsg(
        'Não foi possível obter sua localização agora. Verifique se a Localização do aparelho está ligada.',
      );
    } finally {
      setLocating(false);
    }
  }, [applyPassengerLocation, resolveCurrentCoordinates]);

  const definePoiAsDestination = useCallback(() => {
    if (!selectedPoi || phase !== 'idle') return;

    const placeName = selectedPoi.address
      ? `${selectedPoi.name} — ${selectedPoi.address}`
      : selectedPoi.name;

    invalidateIdleRoute();
    setDestination({
      place_name: placeName,
      coordinates: selectedPoi.coordinates,
    });
    setSelectedPoi(null);
    setTripSheetExpanded(false);

    mapRef.current?.flyTo({
      center: selectedPoi.coordinates,
      zoom: 16,
      duration: 650,
    });
  }, [invalidateIdleRoute, phase, selectedPoi]);

  const definePoiAsOrigin = useCallback(() => {
    if (!selectedPoi || phase !== 'idle') return;

    const placeName = selectedPoi.address
      ? `${selectedPoi.name} — ${selectedPoi.address}`
      : selectedPoi.name;

    invalidateIdleRoute();
    originManualEditRef.current = true;
    setOrigin({
      place_name: placeName,
      coordinates: selectedPoi.coordinates,
    });
    setSelectedPoi(null);
    setTripSheetExpanded(false);

    mapRef.current?.flyTo({
      center: selectedPoi.coordinates,
      zoom: 16,
      duration: 650,
    });
  }, [invalidateIdleRoute, phase, selectedPoi]);

  const rideVisible =
    activeRide &&
    ['queued', 'accepted', 'waiting', 'in_progress', 'finished'].includes(phase);

  const mapStops = useMemo<[number, number][]>(() => {
    if (phase === 'idle') {
      return stops
        .map((stop) => stop.coordinates)
        .filter((coordinates): coordinates is [number, number] => coordinates !== null);
    }

    return activeStops
      .filter((stop) => stop.status !== 'completed')
      .slice()
      .sort((a, b) => a.stop_order - b.stop_order)
      .map((stop) => [Number(stop.longitude), Number(stop.latitude)] as [number, number]);
  }, [activeStops, phase, stops]);

  const activeRidePickup = useMemo<[number, number] | null>(() => {
    if (!activeRide || activeRide.origin_lng === null || activeRide.origin_lat === null) return null;
    const coordinates: [number, number] = [Number(activeRide.origin_lng), Number(activeRide.origin_lat)];
    return isValidCoordinates(coordinates) ? coordinates : null;
  }, [activeRide?.id, activeRide?.origin_lng, activeRide?.origin_lat]);

  const activeRideDestination = useMemo<[number, number] | null>(() => {
    if (!activeRide || activeRide.destination_lng === null || activeRide.destination_lat === null) return null;
    const coordinates: [number, number] = [Number(activeRide.destination_lng), Number(activeRide.destination_lat)];
    return isValidCoordinates(coordinates) ? coordinates : null;
  }, [activeRide?.id, activeRide?.destination_lng, activeRide?.destination_lat]);

  const mapOrigin =
    phase === 'accepted' || phase === 'waiting' || phase === 'queued'
      ? activeRidePickup ?? origin?.coordinates ?? null
      : phase === 'in_progress'
        ? null
        : origin?.coordinates ?? null;

  const mapDestination =
    phase === 'in_progress'
      ? activeRideDestination ?? destination?.coordinates ?? null
      : phase === 'accepted' || phase === 'waiting' || phase === 'queued'
        ? null
        : destination?.coordinates ?? null;

  // Mantém os motoristas online visíveis também durante uma corrida. O
  // motorista atribuído recebe destaque próprio no MapView, sem apagar os
  // demais carros disponíveis do mapa.
  const mapDrivers = nearbyDrivers;

  const registerMapInstance = useCallback((map: MapController) => {
    mapRef.current = map;
  }, []);

  const plannedRouteReady = Boolean(
    destination?.coordinates || activeRide?.id,
  );

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-tum-dark dark:bg-tum-dark">
      {locationReady ? (
        <MapView
          cityId={profile.city_id ?? null}
          origin={mapOrigin}
          destination={mapDestination}
          stops={mapStops}
          drivers={mapDrivers}
          rideDriver={rideDriver}
          routeCoords={routeCoords}
          queuedCurrentRouteCoords={queuedCurrentRouteCoords}
          queuedNextRouteCoords={queuedNextRouteCoords}
          queuedCurrentDestination={queuedCurrentDestination}
          onPoiSelect={phase === 'idle' ? setSelectedPoi : undefined}
          onLocationDragSelect={phase === 'idle' ? setSelectedPoi : undefined}
          registerMap={registerMapInstance}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-950">
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 size={28} className="animate-spin text-tum-yellow" />
            <p className="text-xs font-bold text-white/70">Preparando sua localização…</p>
          </div>
        </div>
      )}

      {activeRide && (!networkOnline || rideSyncProblem) && (
        <div className="pointer-events-none absolute left-1/2 top-[82px] z-[45] w-[min(92vw,390px)] -translate-x-1/2 px-2">
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-300/20 bg-neutral-950/95 px-3.5 py-3 shadow-2xl backdrop-blur-xl">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-tum-yellow/15 text-tum-yellow">
              <WifiOff size={17} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black text-white">
                {networkOnline ? 'Conexão instável' : 'Sem internet'}
              </p>
              <p className="mt-0.5 text-[11px] font-medium leading-4 text-white/55">
                O último estado da sua corrida está preservado. O TUM sincroniza automaticamente quando a conexão voltar.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="absolute top-0 left-0 right-0 z-20 p-3 pointer-events-none">
        <div className="flex items-center justify-between pointer-events-auto">
          <div
            className={`tum-profile-pill tum-soft-enter flex items-center border border-white/10 bg-tum-dark-2/[0.92] shadow-xl backdrop-blur-xl transition-all duration-500 ease-out ${
              plannedRouteReady
                ? 'gap-2 rounded-xl py-1 pl-1.5 pr-3'
                : 'gap-2.5 rounded-2xl py-1.5 pl-2 pr-4'
            }`}
          >
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.full_name}
                className={`${plannedRouteReady ? 'h-8 w-8' : 'h-9 w-9'} rounded-full border border-white/10 object-cover transition-all duration-500`}
              />
            ) : (
              <div className={`${plannedRouteReady ? 'h-8 w-8 text-sm' : 'h-9 w-9'} flex items-center justify-center rounded-full bg-tum-yellow font-black text-black transition-all duration-500`}>
                {profile.full_name.charAt(0)}
              </div>
            )}
            <p className={`${plannedRouteReady ? 'text-xs' : 'text-sm'} whitespace-nowrap font-extrabold leading-tight text-white transition-all duration-500`}>
              Olá, <span className="text-tum-yellow">{profile.full_name.split(' ')[0]}</span>
            </p>
          </div>
        </div>
      </div>

      {currentBanner && phase === 'idle' && (
        <div className="absolute left-3 right-20 top-20 z-20 aspect-[16/5] overflow-hidden rounded-2xl border border-white/10 bg-black/20 shadow-xl">
          {currentBanner.redirect_link ? (
            currentBanner.redirect_link.startsWith('/') ? (
              <button
                type="button"
                onClick={() => handleAppNavigation(currentBanner.redirect_link!)}
                className="block h-full w-full"
                aria-label={`Abrir ${currentBanner.campaign_name || 'novidade'}`}
              >
                <img src={currentBanner.image_url} alt={currentBanner.campaign_name || 'Banner TUM'} className="h-full w-full object-cover" />
              </button>
            ) : (
              <a
                href={currentBanner.redirect_link}
                target="_blank"
                rel="noreferrer"
                className="block h-full w-full"
                aria-label={`Abrir ${currentBanner.campaign_name || 'anúncio'}`}
              >
                <img src={currentBanner.image_url} alt={currentBanner.campaign_name || 'Banner patrocinado'} className="h-full w-full object-cover" />
              </a>
            )
          ) : (
            <img src={currentBanner.image_url} alt={currentBanner.campaign_name || 'Banner patrocinado'} className="h-full w-full object-cover" />
          )}
          <button
            type="button"
            onClick={() => {
              setDismissedBannerIds((current) => [...current, currentBanner.id]);
              setBannerIdx(0);
            }}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/65 shadow-lg"
            aria-label="Fechar banner"
          >
            <X size={14} className="text-white" />
          </button>
        </div>
      )}

      {phase === 'idle' && (
        <div
          className={`tum-home-sheet ${
            tripSheetExpanded
              ? 'tum-home-sheet--expanded'
              : 'tum-home-sheet--compact'
          } absolute bottom-0 left-0 right-0 z-20 flex flex-col overflow-hidden rounded-t-[28px] border-t border-white/10 bg-tum-dark-2/[0.97] px-4 pb-0.5 pt-1.5 shadow-[0_-18px_55px_rgba(0,0,0,.24)] backdrop-blur-xl`}
          style={{
            bottom: tripSheetKeyboardLift,
            maxHeight: tripSheetExpanded
              ? 'min(72dvh, 720px)'
              : 'min(43dvh, 360px)',
          }}
        >
          <div className="mx-auto mb-2 h-1 w-11 shrink-0 rounded-full bg-white/15" />

          <div className={`min-h-0 flex-1 pr-0.5 scrollbar-hide ${tripSheetExpanded ? 'overflow-y-auto' : 'overflow-hidden'}`}> 
            <div className={`${tripSheetExpanded ? 'mb-3' : 'mb-2'} flex items-start justify-between gap-3`}>
              <div className="min-w-0">
                <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-tum-yellow/[0.80]">
                  <Route size={12} strokeWidth={2.7} />
                  Nova viagem
                </div>
                <h2 className={`${tripSheetExpanded ? 'text-[19px]' : 'text-[18px]'} font-black leading-tight text-white`}>
                  Para onde vamos?
                </h2>
                {tripSheetExpanded && (
                  <p className="mt-0.5 text-xs text-white/[0.45]">
                    Informe o destino e veja as opções antes de pedir.
                  </p>
                )}
              </div>

              {tripSheetExpanded && (
                <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.035] px-2.5 py-2 text-[10px] font-semibold text-white/[0.55]">
                  <ShieldCheck size={14} className="text-tum-yellow" />
                  Preço antes
                </div>
              )}
            </div>

            <div className="tum-trip-addresses space-y-2 rounded-[20px] border border-white/[0.08] bg-black/15 p-2.5">
              <AddressAutocomplete
                placeholder="Onde você está?"
                value={origin?.place_name ?? ''}
                onChange={(name, coordinates) => {
                  invalidateIdleRoute();
                  // Qualquer edição no campo de embarque passa a ser uma escolha
                  // manual. A localização automática deixa de interferir até o
                  // passageiro tocar novamente no botão de localizar.
                  originManualEditRef.current = true;
                  if (coordinates) {
                    setOrigin({ place_name: name, coordinates });
                  } else {
                    setOrigin(null);
                  }
                }}
                proximity={origin?.coordinates}
                icon={LocateFixed}
                resultsDirection="up"
                fieldMarker="origin"
                onInputFocus={() => setFocusedTripAddressField('origin')}
              />

              {stops.map((stop, index) => (
                <div key={stop.id} className="tum-stop-enter flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <AddressAutocomplete
                      placeholder={`Parada ${index + 1}`}
                      value={stop.place_name}
                      onChange={(name, coordinates) => {
                        invalidateIdleRoute();
                        setStops((current) =>
                          current.map((item) =>
                            item.id === stop.id
                              ? { ...item, place_name: name, coordinates }
                              : item,
                          ),
                        );
                      }}
                      proximity={origin?.coordinates}
                      icon={MapPin}
                      resultsDirection="up"
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={`Remover parada ${index + 1}`}
                    onClick={() => {
                      invalidateIdleRoute();
                      setStops((current) => current.filter((item) => item.id !== stop.id));
                    }}
                    className="tum-press flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10 text-red-300 transition"
                  >
                    <X size={17} />
                  </button>
                </div>
              ))}

              <AddressAutocomplete
                placeholder="Para onde você vai? (Digite aqui)"
                value={destination?.place_name ?? ''}
                resultsDirection="up"
                onChange={(name, coordinates) => {
                  invalidateIdleRoute();
                  if (coordinates) {
                    setDestination({ place_name: name, coordinates });
                    // Ao concluir o destino, recolhe o painel para a rota
                    // aparecer inteira no mapa. O passageiro pode expandir de
                    // novo quando quiser adicionar detalhes/paradas.
                    setTripSheetExpanded(false);
                  } else {
                    setDestination(null);
                  }
                }}
                proximity={origin?.coordinates}
                icon={Car}
                fieldMarker="destination"
                onInputFocus={() => setFocusedTripAddressField('destination')}
              />
            </div>

            {tripSheetExpanded && (
              <div className="mt-2">
                <SavedPlaces
                  passengerId={profile.id}
                  proximity={origin?.coordinates}
                  onError={(message) => setAlertMsg(message)}
                  onSelect={(savedAddress) => {
                    invalidateIdleRoute();
                    setDestination(savedAddress);
                    setTripSheetExpanded(false);
                  }}
                />
              </div>
            )}
          </div>

          <div className="tum-home-sheet-actions relative z-10 shrink-0 pt-2">
            <button
              type="button"
              onClick={() => {
                if (stops.length >= MAX_STOPS_UI) return;
                setTripSheetExpanded(true);
                setStops((current) => [
                  ...current,
                  {
                    id: `stop-${Date.now()}-${current.length + 1}`,
                    place_name: '',
                    coordinates: null,
                  },
                ]);
              }}
              disabled={stops.length >= MAX_STOPS_UI}
              className="tum-press flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-[13px] font-bold text-white/75 transition hover:bg-white/[0.075] disabled:opacity-40"
            >
              <Plus size={15} className="text-tum-yellow" strokeWidth={2.8} />
              {stops.length >= MAX_STOPS_UI ? 'Limite de paradas atingido' : 'Adicionar parada'}
            </button>

            <button
              type="button"
              onClick={() => setShowRequest(true)}
              disabled={
                !origin?.coordinates ||
                !destination?.coordinates ||
                stops.some((stop) => !stop.coordinates)
              }
              className="tum-primary-cta tum-press mt-2 flex w-full items-center justify-between rounded-2xl bg-tum-yellow px-4 py-3 text-black shadow-[0_10px_28px_rgba(254,198,15,.20)] transition hover:bg-tum-yellow-dark disabled:shadow-none disabled:opacity-40"
            >
              <span className="flex items-center gap-2.5">
                <span className="tum-cta-search-icon flex h-8 w-8 items-center justify-center rounded-xl bg-tum-yellow text-black">
                  <Search size={17} strokeWidth={2.8} />
                </span>
                <span className="text-left">
                  <span className="block text-sm font-black leading-tight">Ver opções de corrida</span>
                  <span className="block text-[10px] font-semibold text-black/55">Categorias, preço e pagamento</span>
                </span>
              </span>
              <ChevronRight size={20} strokeWidth={2.8} />
            </button>

            <button
              type="button"
              onClick={() => setTripSheetExpanded((current) => !current)}
              className="tum-sheet-details-toggle tum-press mt-1.5 flex w-full items-center justify-center gap-1.5 py-1 text-[11px] font-extrabold text-white/55 transition hover:text-tum-yellow"
              aria-expanded={tripSheetExpanded}
            >
              {tripSheetExpanded ? (
                <>
                  Mostrar menos detalhes
                  <ChevronDown size={14} strokeWidth={2.6} />
                </>
              ) : (
                <>
                  Mostrar mais detalhes
                  <ChevronUp size={14} strokeWidth={2.6} />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {phase === 'searching' && (
        <div className="tum-home-sheet absolute bottom-0 left-0 right-0 z-30 rounded-t-[28px] border-t border-white/10 bg-tum-dark-2/[0.98] p-5 shadow-[0_-18px_55px_rgba(0,0,0,.34)] backdrop-blur-xl">
          <div className="mx-auto mb-4 h-1 w-11 rounded-full bg-white/15" />
          <div className="flex flex-col items-center text-center">
            <div className="tum-search-orbit mb-3 flex h-16 w-16 items-center justify-center rounded-full border border-tum-yellow/20 bg-tum-yellow/10">
              <Loader2 size={28} className="animate-spin text-tum-yellow" />
            </div>
            <span className="mb-1.5 rounded-full border border-tum-yellow/20 bg-tum-yellow/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-tum-yellow">Buscando motorista</span>
            <p className="text-lg font-black text-white">Procurando a melhor opção perto de você</p>
            <p className="mt-1 max-w-[310px] text-sm leading-5 text-white/[0.48]">A chamada passa pelos motoristas disponíveis da sua região. Você acompanha tudo por aqui.</p>
            <div className="mt-3 flex gap-2 text-[10px] font-semibold text-white/[0.45]">
              <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2.5 py-1.5">Busca automática</span>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2.5 py-1.5">Atualização em tempo real</span>
            </div>
            <button
              type="button"
              onClick={() => { void cancelRide(); }}
              className="tum-press mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-6 py-2.5 text-sm font-bold text-red-300 transition hover:bg-red-500/15"
            >
              Cancelar busca
            </button>
          </div>
        </div>
      )}

      {rideVisible && activeRide && (
        <RideInProgress
          profile={profile}
          ride={activeRide}
          driver={rideDriver}
          stops={activeStops}
          etaMin={etaMin}
          audioMode={audioMode}
          onCancel={cancelRide}
          onFindAnotherDriver={findAnotherDriver}
          onFinish={finishRating}
        />
      )}

      {showRequest && (
        <RideRequestModal
          origin={origin}
          destination={destination}
          stops={stops
            .filter((stop) => stop.coordinates !== null)
            .map((stop) => ({
              place_name: stop.place_name,
              coordinates: stop.coordinates as [number, number],
            }))}
          onClose={() => setShowRequest(false)}
          onConfirm={requestRide}
        />
      )}

      <div className="absolute top-3 right-3 z-30 flex flex-col gap-3">
        {phase === 'idle' && (
          <button type="button" onClick={() => setNotificationsOpen(true)} className="tum-press relative flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-tum-dark-2 shadow-xl transition hover:bg-tum-dark-3">
            <Bell size={20} className="text-white" />
            {unreadNotifications > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}
          </button>
        )}
        {phase === 'idle' && (
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="tum-press flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-tum-dark-2 shadow-xl transition hover:bg-tum-dark-3"
          >
            <MoreVertical size={20} className="text-white" />
          </button>
        )}

        <button
          type="button"
          onClick={locateMe}
          className="tum-press flex h-12 w-12 items-center justify-center rounded-full bg-tum-yellow shadow-xl transition"
        >
          {locating ? (
            <Loader2 size={20} className="text-black animate-spin" />
          ) : (
            <LocateFixed size={20} className="text-black" />
          )}
        </button>

        <button
          type="button"
          onClick={toggle}
          className="tum-press flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-tum-dark-2 shadow-xl transition hover:bg-tum-dark-3"
        >
          {theme === 'dark' ? (
            <Sun size={20} className="text-tum-yellow" />
          ) : (
            <Moon size={20} className="text-white" />
          )}
        </button>
      </div>

      {selectedPoi && phase === 'idle' && (
        <div
          className="absolute inset-0 z-[80] flex items-end justify-center bg-black/35 p-3 pb-[calc(env(safe-area-inset-bottom)+14px)] backdrop-blur-[2px]"
          onClick={() => setSelectedPoi(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Detalhes de ${selectedPoi.name}`}
            onClick={(event) => event.stopPropagation()}
            className={`w-full max-w-md rounded-[26px] border p-4 shadow-[0_20px_65px_rgba(0,0,0,.35)] ${
              theme === 'light'
                ? 'border-black/[0.08] bg-white text-[#141518]'
                : 'border-white/10 bg-tum-dark-2 text-white'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-tum-yellow text-black shadow-[0_8px_22px_rgba(254,198,15,.22)]">
                <MapPin size={21} strokeWidth={2.7} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[17px] font-black leading-tight">
                      {selectedPoi.name}
                    </p>
                    {formatPoiCategory(selectedPoi.category) && (
                      <p className={`mt-1 text-[11px] font-extrabold uppercase tracking-[0.08em] ${
                        theme === 'light' ? 'text-black/45' : 'text-white/45'
                      }`}>
                        {formatPoiCategory(selectedPoi.category)}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    aria-label="Fechar detalhes do local"
                    onClick={() => setSelectedPoi(null)}
                    className={`tum-press flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
                      theme === 'light'
                        ? 'border-black/10 bg-black/[0.035] text-black/60 hover:bg-black/[0.06]'
                        : 'border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/[0.08]'
                    }`}
                  >
                    <X size={17} />
                  </button>
                </div>

                {selectedPoi.address && (
                  <p className={`mt-2 text-[13px] leading-[18px] ${
                    theme === 'light' ? 'text-black/55' : 'text-white/55'
                  }`}>
                    {selectedPoi.address}
                  </p>
                )}

                {selectedPoi.openingHours && (
                  <div className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    theme === 'light'
                      ? 'bg-black/[0.045] text-black/60'
                      : 'bg-white/[0.055] text-white/60'
                  }`}>
                    Horário: {selectedPoi.openingHours}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={definePoiAsOrigin}
                className={`tum-press rounded-2xl border px-3 py-3 text-sm font-black transition ${
                  theme === 'light'
                    ? 'border-black/10 bg-black/[0.045] text-black hover:bg-black/[0.07]'
                    : 'border-white/10 bg-white/[0.055] text-white hover:bg-white/[0.09]'
                }`}
              >
                Definir como embarque
              </button>

              <button
                type="button"
                onClick={definePoiAsDestination}
                className="tum-press rounded-2xl bg-tum-yellow px-3 py-3 text-sm font-black text-black shadow-[0_10px_28px_rgba(254,198,15,.24)] transition hover:bg-tum-yellow-dark"
              >
                Definir como destino
              </button>

              <button
                type="button"
                onClick={() => setSelectedPoi(null)}
                className={`tum-press col-span-2 rounded-2xl border px-3 py-2.5 text-xs font-extrabold transition ${
                  theme === 'light'
                    ? 'border-black/10 bg-black/[0.025] text-black/55 hover:bg-black/[0.05]'
                    : 'border-white/10 bg-white/[0.025] text-white/55 hover:bg-white/[0.06]'
                }`}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <MenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        profile={profile}
        audioMode={audioMode}
        onAudioModeChange={handleAudioModeChange}
        onEditProfile={() => { setMenuOpen(false); setEditOpen(true); }}
        onOpenNotifications={() => { setMenuOpen(false); setNotificationsOpen(true); }}
        onOpenNews={() => { setMenuOpen(false); setNewsPostId(null); setNewsOpen(true); }}
        onOpenSupport={() => { setMenuOpen(false); setSupportOpen(true); }}
        onLogout={onLogout}
        unreadCount={unreadNotifications}
      />

      {editOpen && (
        <EditProfileModal
          profile={profile}
          onClose={() => setEditOpen(false)}
          onSaved={setProfile}
        />
      )}

      <CancellationDebtPanel
        open={cancellationDebtOpen}
        onClose={() => setCancellationDebtOpen(false)}
        onSettled={() => setCancellationDebtOpen(false)}
      />

      <AlertModal
        open={alertMsg !== null}
        message={alertMsg ?? ''}
        onClose={() => setAlertMsg(null)}
      />

      <NotificationsPanel
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        onUnreadChange={setUnreadNotifications}
        onNavigate={(url) => {
          setNotificationsOpen(false);
          handleAppNavigation(url);
        }}
      />
      <NewsPanel
        open={newsOpen}
        onClose={() => { setNewsOpen(false); setNewsPostId(null); }}
        initialPostId={newsPostId}
        onNavigate={(url) => {
          setNewsOpen(false);
          setNewsPostId(null);
          handleAppNavigation(url);
        }}
      />
      <SupportPanel open={supportOpen} onClose={() => setSupportOpen(false)} />
    </div>
  );
}
