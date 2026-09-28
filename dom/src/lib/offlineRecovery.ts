import type { DriverLocation, Profile, Ride, RideStop } from './types';

const PROFILE_CACHE_KEY = 'tum-passenger-profile-cache:v1';
const PROFILE_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const ACTIVE_RIDE_CACHE_PREFIX = 'tum-passenger-active-ride:v1:';
const ACTIVE_RIDE_TTL_MS = 72 * 60 * 60 * 1000;
const COMPLETED_RIDE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ROUTE_POINTS_IN_CACHE = 220;

export interface CachedActiveRideSnapshot {
  ride: Ride;
  stops: RideStop[];
  driver: DriverLocation | null;
  routeCoords: [number, number][] | null;
  queuedCurrentRouteCoords: [number, number][] | null;
  queuedNextRouteCoords: [number, number][] | null;
  queuedCurrentDestination: [number, number] | null;
  etaMin: number | null;
  savedAt: number;
}

type CachedProfilePayload = {
  authUserId: string;
  profile: Profile;
  savedAt: number;
};

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function compactRoute(
  route: [number, number][] | null | undefined,
): [number, number][] | null {
  if (!Array.isArray(route) || route.length === 0) return null;
  if (route.length <= MAX_ROUTE_POINTS_IN_CACHE) return route;

  const step = Math.max(1, Math.ceil(route.length / MAX_ROUTE_POINTS_IN_CACHE));
  const compacted = route.filter((_, index) => index % step === 0);
  const last = route[route.length - 1];
  const compactedLast = compacted[compacted.length - 1];
  if (!compactedLast || compactedLast[0] !== last[0] || compactedLast[1] !== last[1]) {
    compacted.push(last);
  }
  return compacted;
}

export function saveCachedProfile(authUserId: string, profile: Profile): void {
  if (!canUseStorage() || !authUserId) return;

  try {
    const payload: CachedProfilePayload = {
      authUserId,
      profile,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Cache é apenas uma camada de resiliência. Falhar aqui nunca bloqueia o app.
  }
}

export function readCachedProfile(authUserId: string): Profile | null {
  if (!canUseStorage() || !authUserId) return null;

  try {
    const raw = window.localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;

    const payload = JSON.parse(raw) as Partial<CachedProfilePayload>;
    const savedAt = Number(payload.savedAt);

    if (
      payload.authUserId !== authUserId ||
      !payload.profile ||
      !Number.isFinite(savedAt) ||
      Date.now() - savedAt > PROFILE_CACHE_TTL_MS
    ) {
      return null;
    }

    return payload.profile as Profile;
  } catch {
    return null;
  }
}

export function clearCachedProfile(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {
    // Sem impacto funcional.
  }
}

function activeRideCacheKey(profileId: string): string {
  return `${ACTIVE_RIDE_CACHE_PREFIX}${profileId}`;
}

export function saveActiveRideSnapshot(
  profileId: string,
  snapshot: Omit<CachedActiveRideSnapshot, 'savedAt'>,
): void {
  if (!canUseStorage() || !profileId || !snapshot.ride?.id) return;

  try {
    const payload: CachedActiveRideSnapshot = {
      ...snapshot,
      routeCoords: compactRoute(snapshot.routeCoords),
      queuedCurrentRouteCoords: compactRoute(snapshot.queuedCurrentRouteCoords),
      queuedNextRouteCoords: compactRoute(snapshot.queuedNextRouteCoords),
      savedAt: Date.now(),
    };

    window.localStorage.setItem(
      activeRideCacheKey(profileId),
      JSON.stringify(payload),
    );
  } catch {
    // Se o WebView estiver sem espaço, seguimos com a corrida em memória/servidor.
  }
}

export function readActiveRideSnapshot(
  profileId: string,
): CachedActiveRideSnapshot | null {
  if (!canUseStorage() || !profileId) return null;

  try {
    const raw = window.localStorage.getItem(activeRideCacheKey(profileId));
    if (!raw) return null;

    const payload = JSON.parse(raw) as Partial<CachedActiveRideSnapshot>;
    const savedAt = Number(payload.savedAt);
    const ride = payload.ride as Ride | undefined;

    if (!ride?.id || !Number.isFinite(savedAt)) {
      clearActiveRideSnapshot(profileId);
      return null;
    }

    const ttl = ride.status === 'completed'
      ? COMPLETED_RIDE_TTL_MS
      : ACTIVE_RIDE_TTL_MS;

    if (Date.now() - savedAt > ttl) {
      clearActiveRideSnapshot(profileId);
      return null;
    }

    if (ride.status === 'cancelled' || ride.status === 'no_drivers') {
      clearActiveRideSnapshot(profileId);
      return null;
    }

    return {
      ride,
      stops: Array.isArray(payload.stops) ? payload.stops as RideStop[] : [],
      driver: (payload.driver as DriverLocation | null | undefined) ?? null,
      routeCoords: (payload.routeCoords as [number, number][] | null | undefined) ?? null,
      queuedCurrentRouteCoords:
        (payload.queuedCurrentRouteCoords as [number, number][] | null | undefined) ?? null,
      queuedNextRouteCoords:
        (payload.queuedNextRouteCoords as [number, number][] | null | undefined) ?? null,
      queuedCurrentDestination:
        (payload.queuedCurrentDestination as [number, number] | null | undefined) ?? null,
      etaMin: typeof payload.etaMin === 'number' ? payload.etaMin : null,
      savedAt,
    };
  } catch {
    return null;
  }
}

export function clearActiveRideSnapshot(profileId: string): void {
  if (!canUseStorage() || !profileId) return;
  try {
    window.localStorage.removeItem(activeRideCacheKey(profileId));
  } catch {
    // Sem impacto funcional.
  }
}
