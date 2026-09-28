import { getCurrentTumMapCityId, getTumMapConfigSync, loadTumMapConfig, type TumMapConfig } from './mapConfig';
import { supabase } from './supabase';

export interface MbFeature {
  id: string;
  place_name: string;
  text: string;
  center: [number, number];
  place_type: string[];
}

export interface MapboxSearchSuggestion {
  mapbox_id: string;
  name: string;
  name_preferred?: string;
  feature_type: string;
  address?: string;
  full_address?: string;
  place_formatted?: string;
  poi_category?: string[];
  distance?: number;
  provider?: 'mapbox' | 'google' | 'manual';
}

export interface CityLocation {
  city: string;
  state: string;
}

export interface DirectionsResult {
  distance: number;
  duration: number;
  geometry: {
    coordinates: [number, number][];
    type: string;
  };
}

type GoogleAny = any;

let googleLoader: Promise<GoogleAny> | null = null;
let googleLoaderKey = '';
const googleSessionTokens = new Map<string, GoogleAny>();
const googlePredictions = new Map<string, GoogleAny>();
const manualSuggestions = new Map<string, MbFeature>();

function createSearchSessionToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function newSearchSessionToken(): string {
  return createSearchSessionToken();
}

function normalizeGoogleLanguage(language: string) {
  return language.replace('_', '-');
}

export async function ensureGoogleMapsLoaded(config: TumMapConfig = getTumMapConfigSync()): Promise<GoogleAny> {
  const apiKey = config.google_maps_public_key.trim();
  if (!apiKey) throw new Error('Google Maps API Key não configurada no TUM Admin.');

  const existing = (window as any).google?.maps;
  if (existing && googleLoaderKey === apiKey) return (window as any).google;

  if (googleLoader && googleLoaderKey === apiKey) return googleLoader;

  googleLoaderKey = apiKey;
  googleLoader = new Promise((resolve, reject) => {
    const callbackName = `__tumGoogleMapsReady_${Date.now()}`;
    (window as any)[callbackName] = () => {
      delete (window as any)[callbackName];
      resolve((window as any).google);
    };

    const old = document.querySelector('script[data-tum-google-maps="1"]');
    if (old) old.remove();

    const url = new URL(config.google_maps_js_base_url || 'https://maps.googleapis.com/maps/api/js');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('v', 'weekly');
    url.searchParams.set('loading', 'async');
    url.searchParams.set('libraries', 'places,marker,geocoding,routes');
    url.searchParams.set('language', normalizeGoogleLanguage(config.google_maps_language));
    url.searchParams.set('region', config.google_maps_region || 'BR');
    url.searchParams.set('callback', callbackName);

    const script = document.createElement('script');
    script.src = url.toString();
    script.async = true;
    script.defer = true;
    script.dataset.tumGoogleMaps = '1';
    script.onerror = () => {
      delete (window as any)[callbackName];
      googleLoader = null;
      reject(new Error('Não foi possível carregar Google Maps JavaScript API.'));
    };
    document.head.appendChild(script);
  });

  return googleLoader;
}

async function currentConfig(): Promise<TumMapConfig> {
  return loadTumMapConfig();
}

async function searchManualOverrides(query: string, limit: number): Promise<MapboxSearchSuggestion[]> {
  try {
    const { data, error } = await supabase.rpc('search_tum_map_overrides', {
      p_query: query,
      p_city_id: getCurrentTumMapCityId(),
      p_limit: limit,
    });
    if (error || !Array.isArray(data)) return [];

    return data.map((item: any) => {
      const id = `manual:${String(item.id)}`;
      const feature: MbFeature = {
        id,
        place_name: item.full_address || item.name,
        text: item.name,
        center: [Number(item.longitude), Number(item.latitude)],
        place_type: [item.kind || 'address'],
      };
      manualSuggestions.set(id, feature);
      return {
        mapbox_id: id,
        name: item.name,
        feature_type: item.kind || 'address',
        full_address: item.full_address || item.name,
        place_formatted: item.full_address || '',
        provider: 'manual' as const,
      };
    });
  } catch {
    return [];
  }
}

async function searchMapbox(
  query: string,
  sessionToken: string,
  proximity: [number, number] | undefined,
  config: TumMapConfig,
): Promise<MapboxSearchSuggestion[]> {
  const url = new URL(`${config.mapbox_searchbox_base_url.replace(/\/$/, '')}/suggest`);
  url.searchParams.set('q', query);
  url.searchParams.set('access_token', config.mapbox_public_token);
  url.searchParams.set('session_token', sessionToken);
  url.searchParams.set('language', config.search_language);
  url.searchParams.set('country', config.search_country);
  url.searchParams.set('limit', String(config.search_limit));
  url.searchParams.set('types', config.search_types.join(','));
  if (proximity && config.search_use_proximity) url.searchParams.set('proximity', proximity.join(','));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Busca Mapbox falhou');
  const data = await res.json();
  return Array.isArray(data?.suggestions)
    ? data.suggestions.map((item: any) => ({ ...item, provider: 'mapbox' as const }))
    : [];
}

async function getGoogleSessionToken(sessionToken: string, google: GoogleAny) {
  let token = googleSessionTokens.get(sessionToken);
  if (!token) {
    const { AutocompleteSessionToken } = await google.maps.importLibrary('places');
    token = new AutocompleteSessionToken();
    googleSessionTokens.set(sessionToken, token);
  }
  return token;
}

async function searchGoogle(
  query: string,
  sessionToken: string,
  proximity: [number, number] | undefined,
  config: TumMapConfig,
): Promise<MapboxSearchSuggestion[]> {
  const google = await ensureGoogleMapsLoaded(config);
  const { AutocompleteSuggestion } = await google.maps.importLibrary('places');
  const token = await getGoogleSessionToken(sessionToken, google);

  const request: Record<string, any> = {
    input: query,
    sessionToken: token,
    includedRegionCodes: [String(config.search_country || 'BR').toLowerCase()],
    language: normalizeGoogleLanguage(config.search_language),
    region: config.google_maps_region || 'BR',
  };
  if (proximity && config.search_use_proximity) {
    request.origin = { lat: proximity[1], lng: proximity[0] };
    request.locationBias = { center: request.origin, radius: 50000 };
  }

  const { suggestions = [] } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
  return suggestions.slice(0, config.search_limit).flatMap((entry: any) => {
    const prediction = entry?.placePrediction;
    if (!prediction) return [];
    const placeId = String(prediction.placeId || '').trim();
    if (!placeId) return [];
    googlePredictions.set(`google:${placeId}`, prediction);
    const fullText = prediction.text?.toString?.() || '';
    const mainText = prediction.mainText?.toString?.() || fullText;
    const secondary = prediction.secondaryText?.toString?.() || '';
    return [{
      mapbox_id: `google:${placeId}`,
      name: mainText,
      name_preferred: mainText,
      feature_type: prediction.types?.[0] || 'place',
      full_address: fullText,
      place_formatted: secondary,
      distance: Number.isFinite(prediction.distanceMeters) ? prediction.distanceMeters : undefined,
      provider: 'google' as const,
    }];
  });
}

export async function searchAddressSuggestions(
  query: string,
  sessionToken: string,
  proximity?: [number, number],
): Promise<MapboxSearchSuggestion[]> {
  const config = await currentConfig();
  const cleanQuery = query.trim();
  if (!config.autocomplete_enabled || cleanQuery.length < config.search_min_chars) return [];

  const manual = config.show_manual_overrides
    ? await searchManualOverrides(cleanQuery, config.search_limit)
    : [];

  const provider = config.search_provider;
  let remote: MapboxSearchSuggestion[] = [];
  try {
    remote = provider === 'google'
      ? await searchGoogle(cleanQuery, sessionToken, proximity, config)
      : await searchMapbox(cleanQuery, sessionToken, proximity, config);
  } catch (error) {
    console.warn(`Busca ${provider} falhou.`, error);
    if (config.provider_fallback_enabled && config.fallback_provider !== 'none' && config.fallback_provider !== provider) {
      try {
        remote = config.fallback_provider === 'google'
          ? await searchGoogle(cleanQuery, sessionToken, proximity, config)
          : await searchMapbox(cleanQuery, sessionToken, proximity, config);
      } catch (fallbackError) {
        console.warn('Fallback de busca falhou.', fallbackError);
      }
    }
  }

  const merged = config.manual_results_first ? [...manual, ...remote] : [...remote, ...manual];
  const unique = new Map<string, MapboxSearchSuggestion>();
  merged.forEach((item) => unique.set(item.mapbox_id, item));
  return Array.from(unique.values()).slice(0, config.search_limit);
}

async function retrieveMapbox(
  suggestion: MapboxSearchSuggestion,
  sessionToken: string,
  proximity: [number, number] | undefined,
  config: TumMapConfig,
): Promise<MbFeature> {
  const url = new URL(`${config.mapbox_searchbox_base_url.replace(/\/$/, '')}/retrieve/${encodeURIComponent(suggestion.mapbox_id)}`);
  url.searchParams.set('access_token', config.mapbox_public_token);
  url.searchParams.set('session_token', sessionToken);
  url.searchParams.set('language', config.search_language);
  if (proximity && config.search_use_proximity) url.searchParams.set('proximity', proximity.join(','));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Não foi possível abrir o local selecionado');
  const data = await res.json();
  const feature = Array.isArray(data?.features) ? data.features[0] : null;
  const coordinates = feature?.geometry?.coordinates;
  const properties = feature?.properties ?? {};
  if (!feature || !Array.isArray(coordinates) || coordinates.length < 2) throw new Error('O local selecionado não possui coordenadas válidas');
  const placeName = properties.full_address || [properties.name_preferred || properties.name, properties.place_formatted].filter(Boolean).join(', ') || suggestion.full_address || suggestion.name;
  return {
    id: properties.mapbox_id || suggestion.mapbox_id,
    place_name: placeName,
    text: properties.name_preferred || properties.name || suggestion.name,
    center: [Number(coordinates[0]), Number(coordinates[1])],
    place_type: [properties.feature_type || suggestion.feature_type].filter(Boolean),
  };
}

async function retrieveGoogle(suggestion: MapboxSearchSuggestion, config: TumMapConfig): Promise<MbFeature> {
  const google = await ensureGoogleMapsLoaded(config);
  let prediction = googlePredictions.get(suggestion.mapbox_id);
  const placeId = suggestion.mapbox_id.replace(/^google:/, '');
  let place: any;
  if (prediction?.toPlace) {
    place = prediction.toPlace();
  } else {
    const { Place } = await google.maps.importLibrary('places');
    place = new Place({ id: placeId });
  }
  await place.fetchFields({ fields: ['id', 'displayName', 'formattedAddress', 'location', 'types'] });
  if (!place.location) throw new Error('O local selecionado não possui coordenadas válidas');
  return {
    id: `google:${place.id || placeId}`,
    place_name: place.formattedAddress || suggestion.full_address || suggestion.name,
    text: place.displayName?.toString?.() || suggestion.name,
    center: [Number(place.location.lng()), Number(place.location.lat())],
    place_type: Array.isArray(place.types) ? place.types : [suggestion.feature_type],
  };
}

export async function retrieveAddressSuggestion(
  suggestion: MapboxSearchSuggestion,
  sessionToken: string,
  proximity?: [number, number],
): Promise<MbFeature> {
  if (suggestion.provider === 'manual' || suggestion.mapbox_id.startsWith('manual:')) {
    const manual = manualSuggestions.get(suggestion.mapbox_id);
    if (manual) return manual;
  }

  const config = await currentConfig();
  if (suggestion.provider === 'google' || suggestion.mapbox_id.startsWith('google:')) {
    return retrieveGoogle(suggestion, config);
  }
  return retrieveMapbox(suggestion, sessionToken, proximity, config);
}

async function geocodeMapbox(query: string, proximity: [number, number] | undefined, config: TumMapConfig): Promise<MbFeature[]> {
  const base = config.mapbox_legacy_geocoding_base_url.replace(/\/$/, '');
  const url = new URL(`${base}/${encodeURIComponent(query)}.json`);
  url.searchParams.set('access_token', config.mapbox_public_token);
  url.searchParams.set('language', config.search_language);
  url.searchParams.set('limit', String(Math.min(config.search_limit, 10)));
  if (proximity && config.search_use_proximity) url.searchParams.set('proximity', proximity.join(','));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Geocoding Mapbox falhou');
  const data = await res.json();
  return Array.isArray(data.features) ? data.features : [];
}

async function geocodeGoogle(query: string, config: TumMapConfig): Promise<MbFeature[]> {
  const google = await ensureGoogleMapsLoaded(config);
  const { Geocoder } = await google.maps.importLibrary('geocoding');
  const geocoder = new Geocoder();
  const { results = [] } = await geocoder.geocode({ address: query, region: config.google_maps_region || 'BR' });
  return results.slice(0, config.search_limit).map((result: any) => ({
    id: `google:${result.place_id || createSearchSessionToken()}`,
    place_name: result.formatted_address || query,
    text: result.address_components?.[0]?.long_name || result.formatted_address || query,
    center: [Number(result.geometry.location.lng()), Number(result.geometry.location.lat())] as [number, number],
    place_type: Array.isArray(result.types) ? result.types : ['address'],
  }));
}

export async function geocode(query: string, proximity?: [number, number]): Promise<MbFeature[]> {
  if (!query.trim()) return [];
  const config = await currentConfig();
  try {
    return config.search_provider === 'google'
      ? await geocodeGoogle(query, config)
      : await geocodeMapbox(query, proximity, config);
  } catch (error) {
    if (config.provider_fallback_enabled && config.fallback_provider !== 'none' && config.fallback_provider !== config.search_provider) {
      return config.fallback_provider === 'google'
        ? geocodeGoogle(query, config)
        : geocodeMapbox(query, proximity, config);
    }
    throw error;
  }
}

async function reverseMapbox(lng: number, lat: number, config: TumMapConfig): Promise<string> {
  const base = config.mapbox_legacy_geocoding_base_url.replace(/\/$/, '');
  const url = new URL(`${base}/${lng},${lat}.json`);
  url.searchParams.set('access_token', config.mapbox_public_token);
  url.searchParams.set('language', config.search_language);
  url.searchParams.set('limit', '1');
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Reverse geocoding Mapbox falhou');
  const data = await res.json();
  return data.features?.[0]?.place_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

async function reverseGoogle(lng: number, lat: number, config: TumMapConfig): Promise<{ address: string; raw: any | null }> {
  const google = await ensureGoogleMapsLoaded(config);
  const { Geocoder } = await google.maps.importLibrary('geocoding');
  const geocoder = new Geocoder();
  const { results = [] } = await geocoder.geocode({ location: { lat, lng } });
  return { address: results[0]?.formatted_address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`, raw: results[0] || null };
}

export async function reverseGeocode(lng: number, lat: number): Promise<string> {
  const config = await currentConfig();
  try {
    return config.search_provider === 'google'
      ? (await reverseGoogle(lng, lat, config)).address
      : await reverseMapbox(lng, lat, config);
  } catch (error) {
    if (config.provider_fallback_enabled && config.fallback_provider !== 'none' && config.fallback_provider !== config.search_provider) {
      return config.fallback_provider === 'google'
        ? (await reverseGoogle(lng, lat, config)).address
        : reverseMapbox(lng, lat, config);
    }
    throw error;
  }
}

function parseGoogleCity(result: any): CityLocation | null {
  const components = Array.isArray(result?.address_components) ? result.address_components : [];
  const cityComponent = components.find((item: any) => item.types?.includes('administrative_area_level_2'))
    || components.find((item: any) => item.types?.includes('locality'));
  const stateComponent = components.find((item: any) => item.types?.includes('administrative_area_level_1'));
  const city = cityComponent?.long_name;
  const state = stateComponent?.short_name || stateComponent?.long_name;
  return city && state ? { city: String(city).trim(), state: String(state).trim().toUpperCase() } : null;
}

async function cityMapbox(lng: number, lat: number, config: TumMapConfig): Promise<CityLocation | null> {
  const base = config.mapbox_legacy_geocoding_base_url.replace(/\/$/, '');
  const url = new URL(`${base}/${lng},${lat}.json`);
  url.searchParams.set('access_token', config.mapbox_public_token);
  url.searchParams.set('language', config.search_language);
  url.searchParams.set('types', 'place');
  url.searchParams.set('limit', '1');
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Não foi possível identificar a cidade.');
  const feature = (await res.json()).features?.[0];
  if (!feature) return null;
  const region = feature.context?.find((item: any) => String(item.id).startsWith('region.'));
  const state = region?.short_code?.split('-').pop()?.toUpperCase() ?? region?.text;
  return feature.text && state ? { city: feature.text.trim(), state: String(state).trim().toUpperCase() } : null;
}

export async function getCityFromCoordinates(lng: number, lat: number): Promise<CityLocation | null> {
  const config = await currentConfig();

  const resolveWithProvider = async (provider: TumMapProvider): Promise<CityLocation | null> => {
    if (provider === 'google') {
      const result = await reverseGoogle(lng, lat, config);
      return parseGoogleCity(result.raw);
    }

    return cityMapbox(lng, lat, config);
  };

  try {
    const primary = await resolveWithProvider(config.search_provider);
    if (primary) return primary;

    // Alguns provedores podem responder sem componentes suficientes para
    // identificar cidade/UF. Nesse caso também tentamos o fallback.
    if (
      config.provider_fallback_enabled &&
      config.fallback_provider !== 'none' &&
      config.fallback_provider !== config.search_provider
    ) {
      return resolveWithProvider(config.fallback_provider);
    }

    return null;
  } catch (error) {
    if (
      config.provider_fallback_enabled &&
      config.fallback_provider !== 'none' &&
      config.fallback_provider !== config.search_provider
    ) {
      try {
        return await resolveWithProvider(config.fallback_provider);
      } catch (fallbackError) {
        console.warn('[TUM] Falha ao identificar cidade também no provedor de fallback.', fallbackError);
      }
    }

    console.warn('[TUM] Falha ao identificar cidade pelo provedor principal.', error);
    return null;
  }
}

async function directionsMapbox(points: [number, number][], config: TumMapConfig): Promise<DirectionsResult | null> {
  const coords = points.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const profile = config.directions_use_traffic ? 'driving-traffic' : (config.directions_profile || 'driving');
  const base = config.mapbox_directions_base_url.replace(/\/$/, '');
  const url = new URL(`${base}/${profile}/${coords}`);
  url.searchParams.set('access_token', config.mapbox_public_token);
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('overview', config.directions_overview || 'full');
  url.searchParams.set('alternatives', String(Boolean(config.directions_alternatives)));
  // `language` só é aceito pelo Directions v5 quando `steps=true`. O TUM
  // precisa apenas da geometria/tempo/distância; enviar language sem steps faz
  // a API responder 422 e deixava o app preso na linha reta de fallback.
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), config.directions_timeout_ms);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[TUM] Directions Mapbox respondeu HTTP ${res.status}.`);
      return null;
    }
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route?.geometry?.coordinates) return null;
    return { distance: Number(route.distance || 0), duration: Number(route.duration || 0), geometry: route.geometry };
  } finally {
    window.clearTimeout(timer);
  }
}

async function directionsGoogle(points: [number, number][], config: TumMapConfig): Promise<DirectionsResult | null> {
  const google = await ensureGoogleMapsLoaded(config);
  const { Route } = await google.maps.importLibrary('routes');
  const origin = { lat: points[0][1], lng: points[0][0] };
  const destinationPoint = points[points.length - 1];
  const destination = { lat: destinationPoint[1], lng: destinationPoint[0] };
  const intermediates = points.slice(1, -1).map(([lng, lat]) => ({ location: { lat, lng } }));
  const request: Record<string, any> = {
    origin,
    destination,
    travelMode: 'DRIVING',
    fields: ['path', 'distanceMeters', 'durationMillis'],
  };
  if (intermediates.length) request.intermediates = intermediates;
  if (config.directions_use_traffic) request.routingPreference = 'TRAFFIC_AWARE';
  const { routes = [] } = await Route.computeRoutes(request);
  const route = routes[0];
  if (!route?.path?.length) return null;
  const coordinates = route.path.map((point: any) => [Number(point.lng()), Number(point.lat())] as [number, number]);
  return {
    distance: Number(route.distanceMeters || 0),
    duration: Number(route.durationMillis || 0) / 1000,
    geometry: { type: 'LineString', coordinates },
  };
}

async function getDirectionsForPoints(points: [number, number][]): Promise<DirectionsResult | null> {
  const config = await currentConfig();
  const provider = config.directions_provider;

  const runProvider = async (selected: 'mapbox' | 'google') =>
    selected === 'google'
      ? directionsGoogle(points, config)
      : directionsMapbox(points, config);

  // Uma oscilação curta de rede não pode deixar a rota sem ruas. Tentamos o
  // provedor principal novamente uma vez antes de recorrer ao fallback.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await runProvider(provider);
      if (result?.geometry.coordinates?.length) return result;
    } catch (error) {
      console.warn(`Rotas ${provider} falharam (tentativa ${attempt + 1}).`, error);
    }

    if (attempt === 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 180));
    }
  }

  if (
    config.provider_fallback_enabled &&
    config.fallback_provider !== 'none' &&
    config.fallback_provider !== provider
  ) {
    try {
      return await runProvider(config.fallback_provider);
    } catch (error) {
      console.warn(`Fallback de rotas ${config.fallback_provider} falhou.`, error);
    }
  }

  return null;
}

export async function getDirections(origin: [number, number], destination: [number, number]): Promise<DirectionsResult | null> {
  return getDirectionsForPoints([origin, destination]);
}

export async function getDirectionsWithStops(
  origin: [number, number],
  stops: [number, number][],
  destination: [number, number],
): Promise<DirectionsResult | null> {
  const points = [origin, ...stops, destination];
  if (points.length < 2 || points.length > 27) return null;
  return getDirectionsForPoints(points);
}

export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}
