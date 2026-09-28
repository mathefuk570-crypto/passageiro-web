import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type TumMapProvider = 'mapbox' | 'google';

export type PassengerVisualConfig = {
  routeColor: string;
  routeOutlineColor: string;
  routeWidth: number;
  routeOutlineWidth: number;
  routeOpacity: number;
  routeOutlineOpacity: number;
  routeAnimated: boolean;
  routeAnimationMs: number;
  originColor: string;
  destinationColor: string;
  stopColor: string;
  pinSize: number;
  driverMarkerScale: number;
  driverAnimationFps: number;
};

export type TumMapConfig = {
  map_provider: TumMapProvider;
  passenger_map_provider: TumMapProvider;
  driver_map_provider: TumMapProvider;
  search_provider: TumMapProvider;
  directions_provider: TumMapProvider;
  fallback_provider: TumMapProvider | 'none';
  provider_fallback_enabled: boolean;
  mapbox_enabled: boolean;
  google_maps_enabled: boolean;
  mapbox_public_token: string;
  google_maps_public_key: string;
  google_maps_js_base_url: string;
  google_maps_region: string;
  google_maps_language: string;
  passenger_map_style_light: string;
  passenger_map_style_dark: string;
  passenger_google_style_light: unknown[];
  passenger_google_style_dark: unknown[];
  passenger_visual_config: PassengerVisualConfig;
  mapbox_searchbox_base_url: string;
  mapbox_geocoding_base_url: string;
  mapbox_legacy_geocoding_base_url: string;
  mapbox_directions_base_url: string;
  search_api_mode: 'searchbox' | 'geocoding_v6';
  search_fallback_geocoding_v6: boolean;
  search_country: string;
  search_language: string;
  search_limit: number;
  search_min_chars: number;
  search_debounce_ms: number;
  search_types: string[];
  search_use_proximity: boolean;
  manual_results_first: boolean;
  autocomplete_enabled: boolean;
  default_latitude: number;
  default_longitude: number;
  default_zoom: number;
  min_zoom: number;
  max_zoom: number;
  default_pitch: number;
  default_bearing: number;
  show_street_labels: boolean;
  show_pois: boolean;
  show_buildings: boolean;
  show_manual_overrides: boolean;
  directions_profile: string;
  directions_use_traffic: boolean;
  directions_alternatives: boolean;
  directions_overview: string;
  directions_timeout_ms: number;
  nearby_driver_radius_km: number;
  driver_stale_minutes: number;
  config_cache_seconds: number;
  config_revision: number;
  city_id: string | null;
  city_center_latitude: number | null;
  city_center_longitude: number | null;
  search_bias_latitude: number | null;
  search_bias_longitude: number | null;
};

const FALLBACK_MAPBOX_TOKEN =
  'pk.eyJ1IjoibGlsbWlndXN0YSIsImEiOiJjbXJxNGtwMXUwcml6MnpvanJnMzd6em9wIn0.OyiieU0AYhW6ShFzXwvF0A';

// Estes estilos são os mesmos defaults atualmente usados pelo Painel ADM.
// Assim o mapa não nasce em "standard" para trocar de estilo 1-2 s depois,
// que era justamente a janela em que alguns WebViews ficavam cinza.
export const DEFAULT_TUM_MAP_CONFIG: TumMapConfig = {
  map_provider: 'mapbox',
  passenger_map_provider: 'mapbox',
  driver_map_provider: 'mapbox',
  search_provider: 'mapbox',
  directions_provider: 'mapbox',
  fallback_provider: 'mapbox',
  provider_fallback_enabled: true,
  mapbox_enabled: true,
  google_maps_enabled: false,
  mapbox_public_token: FALLBACK_MAPBOX_TOKEN,
  google_maps_public_key: '',
  google_maps_js_base_url: 'https://maps.googleapis.com/maps/api/js',
  google_maps_region: 'BR',
  google_maps_language: 'pt-BR',
  passenger_map_style_light: 'mapbox://styles/mapbox/streets-v12',
  passenger_map_style_dark: 'mapbox://styles/mapbox/dark-v11',
  passenger_google_style_light: [],
  passenger_google_style_dark: [],
  passenger_visual_config: {
    routeColor: '#FACC15',
    routeOutlineColor: '#111111',
    routeWidth: 4,
    routeOutlineWidth: 6,
    routeOpacity: 0.95,
    routeOutlineOpacity: 0.65,
    routeAnimated: true,
    routeAnimationMs: 800,
    originColor: '#00BFFF',
    destinationColor: '#FFDD00',
    stopColor: '#FACC15',
    pinSize: 24,
    driverMarkerScale: 0.9,
    driverAnimationFps: 30,
  },
  mapbox_searchbox_base_url: 'https://api.mapbox.com/search/searchbox/v1',
  mapbox_geocoding_base_url: 'https://api.mapbox.com/search/geocode/v6',
  mapbox_legacy_geocoding_base_url: 'https://api.mapbox.com/geocoding/v5/mapbox.places',
  mapbox_directions_base_url: 'https://api.mapbox.com/directions/v5/mapbox',
  search_api_mode: 'searchbox',
  search_fallback_geocoding_v6: true,
  search_country: 'BR',
  search_language: 'pt-BR',
  search_limit: 8,
  search_min_chars: 2,
  search_debounce_ms: 230,
  search_types: ['poi', 'address', 'street', 'place', 'city', 'locality', 'neighborhood', 'district'],
  search_use_proximity: true,
  manual_results_first: true,
  autocomplete_enabled: true,
  default_latitude: -21.7561,
  default_longitude: -48.831,
  default_zoom: 13,
  min_zoom: 3,
  max_zoom: 20,
  default_pitch: 0,
  default_bearing: 0,
  show_street_labels: true,
  show_pois: true,
  show_buildings: true,
  show_manual_overrides: true,
  directions_profile: 'driving',
  directions_use_traffic: false,
  directions_alternatives: false,
  directions_overview: 'full',
  directions_timeout_ms: 8000,
  nearby_driver_radius_km: 15,
  driver_stale_minutes: 2,
  config_cache_seconds: 300,
  config_revision: 1,
  city_id: null,
  city_center_latitude: null,
  city_center_longitude: null,
  search_bias_latitude: null,
  search_bias_longitude: null,
};

const CACHE_PREFIX = 'tum.map-config.v3';
let currentConfig = DEFAULT_TUM_MAP_CONFIG;
let currentCityId: string | null = null;
const inFlight = new Map<string, Promise<TumMapConfig>>();
const listeners = new Set<(config: TumMapConfig) => void>();

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeMapboxStyle(value: unknown, fallback: string): string {
  const style = String(value ?? '').trim();
  return style.startsWith('mapbox://styles/') ? style : fallback;
}

function providerUsable(provider: TumMapProvider, row: Record<string, any>): boolean {
  if (provider === 'google') {
    return Boolean(row.google_maps_enabled && String(row.google_maps_public_key ?? '').trim());
  }
  return Boolean(row.mapbox_enabled && String(row.mapbox_public_token ?? FALLBACK_MAPBOX_TOKEN).trim());
}

function safeProvider(
  requested: unknown,
  row: Record<string, any>,
  fallback: TumMapProvider = 'mapbox',
): TumMapProvider {
  const provider: TumMapProvider = requested === 'google' ? 'google' : 'mapbox';
  if (providerUsable(provider, row)) return provider;
  if (providerUsable(fallback, row)) return fallback;
  return 'mapbox';
}

function mergeConfig(
  globalRow: Record<string, any> | null | undefined,
  cityRow?: Record<string, any> | null,
): TumMapConfig {
  const row = { ...DEFAULT_TUM_MAP_CONFIG, ...(globalRow ?? {}) } as Record<string, any>;
  const city = cityRow ?? null;
  const visual = {
    ...DEFAULT_TUM_MAP_CONFIG.passenger_visual_config,
    ...(row.passenger_visual_config ?? {}),
  };

  const cityCenterLat = nullableNumber(city?.center_latitude);
  const cityCenterLng = nullableNumber(city?.center_longitude);
  const cityZoom = nullableNumber(city?.default_zoom);
  const fallbackProvider: TumMapProvider = row.fallback_provider === 'google' ? 'google' : 'mapbox';

  const passengerProvider = safeProvider(row.passenger_map_provider ?? row.map_provider, row, fallbackProvider);
  const searchProvider = safeProvider(row.search_provider, row, fallbackProvider);
  const directionsProvider = safeProvider(row.directions_provider, row, fallbackProvider);

  return {
    ...DEFAULT_TUM_MAP_CONFIG,
    ...row,
    map_provider: safeProvider(row.map_provider, row, fallbackProvider),
    passenger_map_provider: passengerProvider,
    driver_map_provider: safeProvider(row.driver_map_provider, row, fallbackProvider),
    search_provider: searchProvider,
    directions_provider: directionsProvider,
    passenger_map_style_light: safeMapboxStyle(
      row.passenger_map_style_light ?? row.map_style_light,
      DEFAULT_TUM_MAP_CONFIG.passenger_map_style_light,
    ),
    passenger_map_style_dark: safeMapboxStyle(
      row.passenger_map_style_dark ?? row.map_style_dark,
      DEFAULT_TUM_MAP_CONFIG.passenger_map_style_dark,
    ),
    default_latitude: cityCenterLat ?? numberValue(row.default_latitude, DEFAULT_TUM_MAP_CONFIG.default_latitude),
    default_longitude: cityCenterLng ?? numberValue(row.default_longitude, DEFAULT_TUM_MAP_CONFIG.default_longitude),
    default_zoom: cityZoom ?? numberValue(row.default_zoom, DEFAULT_TUM_MAP_CONFIG.default_zoom),
    min_zoom: numberValue(row.min_zoom, DEFAULT_TUM_MAP_CONFIG.min_zoom),
    max_zoom: numberValue(row.max_zoom, DEFAULT_TUM_MAP_CONFIG.max_zoom),
    default_pitch: numberValue(row.default_pitch, DEFAULT_TUM_MAP_CONFIG.default_pitch),
    default_bearing: numberValue(row.default_bearing, DEFAULT_TUM_MAP_CONFIG.default_bearing),
    search_limit: numberValue(row.search_limit, DEFAULT_TUM_MAP_CONFIG.search_limit),
    search_min_chars: numberValue(row.search_min_chars, DEFAULT_TUM_MAP_CONFIG.search_min_chars),
    search_debounce_ms: numberValue(row.search_debounce_ms, DEFAULT_TUM_MAP_CONFIG.search_debounce_ms),
    directions_timeout_ms: numberValue(row.directions_timeout_ms, DEFAULT_TUM_MAP_CONFIG.directions_timeout_ms),
    nearby_driver_radius_km: numberValue(row.nearby_driver_radius_km, DEFAULT_TUM_MAP_CONFIG.nearby_driver_radius_km),
    driver_stale_minutes: numberValue(row.driver_stale_minutes, 2),
    config_cache_seconds: numberValue(row.config_cache_seconds, DEFAULT_TUM_MAP_CONFIG.config_cache_seconds),
    config_revision: numberValue(row.config_revision, DEFAULT_TUM_MAP_CONFIG.config_revision),
    passenger_visual_config: {
      ...visual,
      routeWidth: numberValue(visual.routeWidth, 4),
      routeOutlineWidth: numberValue(visual.routeOutlineWidth, 6),
      routeOpacity: numberValue(visual.routeOpacity, 0.95),
      routeOutlineOpacity: numberValue(visual.routeOutlineOpacity, 0.65),
      routeAnimationMs: numberValue(visual.routeAnimationMs, 800),
      pinSize: numberValue(visual.pinSize, 24),
      driverMarkerScale: numberValue(visual.driverMarkerScale, 0.9),
      driverAnimationFps: Math.max(1, numberValue(visual.driverAnimationFps, 30)),
      routeAnimated: Boolean(visual.routeAnimated),
    },
    city_id: typeof city?.city_id === 'string' ? city.city_id : null,
    city_center_latitude: cityCenterLat,
    city_center_longitude: cityCenterLng,
    search_bias_latitude: nullableNumber(city?.search_bias_latitude) ?? cityCenterLat,
    search_bias_longitude: nullableNumber(city?.search_bias_longitude) ?? cityCenterLng,
  } as TumMapConfig;
}

function emit(config: TumMapConfig) {
  currentConfig = config;
  listeners.forEach((listener) => listener(config));
}

function cacheKey(cityId: string | null) {
  return `${CACHE_PREFIX}.${cityId ?? 'global'}`;
}

function readCache(cityId: string | null): TumMapConfig | null {
  try {
    const raw = localStorage.getItem(cacheKey(cityId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; config?: TumMapConfig };
    if (!parsed.config) return null;
    return parsed.config;
  } catch {
    return null;
  }
}

function writeCache(cityId: string | null, config: TumMapConfig) {
  try {
    localStorage.setItem(cacheKey(cityId), JSON.stringify({ savedAt: Date.now(), config }));
  } catch {
    // Falha de storage no WebView nunca pode impedir o mapa de abrir.
  }
}

export function getTumMapConfigSync(): TumMapConfig {
  return currentConfig;
}

export function getCurrentTumMapCityId(): string | null {
  return currentCityId;
}

export async function loadTumMapConfig(
  cityId: string | null = currentCityId,
  force = false,
): Promise<TumMapConfig> {
  currentCityId = cityId;
  const flightKey = cityId ?? 'global';

  if (!force) {
    const running = inFlight.get(flightKey);
    if (running) return running;

    const cached = typeof window !== 'undefined' ? readCache(cityId) : null;
    if (cached && currentConfig.city_id !== cityId) {
      emit(cached);
    }
  }

  const promise = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_tum_map_public_config', {
        p_city_id: cityId,
      });
      if (error) throw error;

      const payload = (data ?? {}) as {
        global?: Record<string, any>;
        city?: Record<string, any> | null;
      };
      const merged = mergeConfig(payload.global, payload.city);
      emit(merged);
      writeCache(cityId, merged);
      return merged;
    } catch (error) {
      console.warn('TUM map config: mantendo a última configuração válida.', error);
      return currentConfig;
    } finally {
      inFlight.delete(flightKey);
    }
  })();

  inFlight.set(flightKey, promise);
  return promise;
}

export function subscribeTumMapConfig(listener: (config: TumMapConfig) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let realtimeConsumers = 0;

export function startTumMapConfigRealtime() {
  realtimeConsumers += 1;

  if (!realtimeChannel) {
    realtimeChannel = supabase
      .channel('tum-map-config-runtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'map_settings' }, () => {
        void loadTumMapConfig(currentCityId, true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'city_map_settings' }, (payload) => {
        const changedCityId = String((payload.new as any)?.city_id ?? (payload.old as any)?.city_id ?? '');
        if (!currentCityId || !changedCityId || changedCityId === currentCityId) {
          void loadTumMapConfig(currentCityId, true);
        }
      })
      .subscribe();
  }

  return () => {
    realtimeConsumers = Math.max(0, realtimeConsumers - 1);
    if (realtimeConsumers === 0 && realtimeChannel) {
      const channel = realtimeChannel;
      realtimeChannel = null;
      void supabase.removeChannel(channel);
    }
  };
}

export function useTumMapConfig(cityId?: string | null): TumMapConfig {
  const resolvedCityId = cityId === undefined ? currentCityId : cityId;
  const [config, setConfig] = useState<TumMapConfig>(() => {
    if (typeof window !== 'undefined') {
      return readCache(resolvedCityId) ?? currentConfig;
    }
    return currentConfig;
  });

  useEffect(() => {
    const unsubscribe = subscribeTumMapConfig(setConfig);
    const stopRealtime = startTumMapConfigRealtime();

    // Componentes auxiliares (ex.: autocomplete) apenas acompanham a
    // configuração corrente. Quem conhece a cidade (MapView) é que faz a
    // carga com city_id. Assim um autocomplete não volta o app para config
    // global enquanto o mapa está usando overrides da cidade.
    if (cityId !== undefined) {
      void loadTumMapConfig(cityId);
    }

    return () => {
      unsubscribe();
      stopRealtime();
    };
  }, [cityId]);

  return config;
}
