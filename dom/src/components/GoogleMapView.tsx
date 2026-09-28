import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DriverLocation } from '../lib/types';
import { useTheme } from '../hooks/useTheme';
import { ensureGoogleMapsLoaded } from '../lib/mapbox';
import { useTumMapConfig } from '../lib/mapConfig';
import type { MapController, MapPoiSelection, MapViewProps } from './mapTypes';
import { mapViewportPadding } from './mapViewport';

const ASSET_BASE = process.env.EXPO_BASE_URL ?? '/';

function publicAsset(path: string): string {
  const base = ASSET_BASE.endsWith('/') ? ASSET_BASE : `${ASSET_BASE}/`;
  return `${base}${path.replace(/^\/+/, '')}`;
}

function normalizeCategory(category: unknown) {
  const normalized = String(category ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized === 'blacktum') return 'black';
  if (normalized === 'delatum') return 'dela';
  if (normalized === 'motum') return 'moto';
  return 'pop';
}

function driverIcon(driver: DriverLocation) {
  return publicAsset(`map-markers/tum-marker-${normalizeCategory(driver.category)}.png`);
}

function svgPin(color: string, label = '') {
  const safeLabel = label.replace(/[^0-9A-Za-z]/g, '').slice(0, 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="44" viewBox="0 0 38 44"><path d="M19 1C9.06 1 1 9.06 1 19c0 12.1 18 24 18 24s18-11.9 18-24C37 9.06 28.94 1 19 1Z" fill="${color}" stroke="#111" stroke-width="2.5"/><circle cx="19" cy="19" r="7" fill="#fff" opacity=".95"/><text x="19" y="23" text-anchor="middle" font-family="Arial" font-size="11" font-weight="700" fill="#111">${safeLabel}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export default function GoogleMapView({
  cityId,
  origin,
  destination,
  stops = [],
  drivers,
  rideDriver,
  routeCoords,
  queuedCurrentRouteCoords = null,
  queuedNextRouteCoords = null,
  queuedCurrentDestination = null,
  onMapClick,
  onPoiSelect,
  onLocationDragSelect,
  registerMap,
  onProviderError,
}: MapViewProps & { onProviderError?: (error: unknown) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const googleRef = useRef<any>(null);
  const routeGlowRef = useRef<any>(null);
  const routeRef = useRef<any>(null);
  const outlineRef = useRef<any>(null);
  const routeHighlightRef = useRef<any>(null);
  const queuedCurrentRouteRef = useRef<any>(null);
  const queuedCurrentOutlineRef = useRef<any>(null);
  const queuedNextRouteRef = useRef<any>(null);
  const queuedNextOutlineRef = useRef<any>(null);
  const queuedDestinationMarkerRef = useRef<any>(null);
  const dragLocationMarkerRef = useRef<any>(null);
  const onLocationDragSelectRef = useRef(onLocationDragSelect);
  const fittedQueuedRouteRef = useRef<string | null>(null);
  const staticMarkersRef = useRef<any[]>([]);
  const driverMarkersRef = useRef<Map<string, { marker: any; lng: number; lat: number }>>(new Map());
  const driverAnimationFrameRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { theme } = useTheme();
  const config = useTumMapConfig(cityId ?? null);
  const visual = config.passenger_visual_config;

  useEffect(() => {
    onLocationDragSelectRef.current = onLocationDragSelect;
    if (!onLocationDragSelect && dragLocationMarkerRef.current) {
      dragLocationMarkerRef.current.setMap?.(null);
      dragLocationMarkerRef.current = null;
    }
  }, [onLocationDragSelect]);

  const googleStyles = useMemo(
    () => theme === 'dark' ? config.passenger_google_style_dark : config.passenger_google_style_light,
    [config.config_revision, theme],
  );

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!containerRef.current || mapRef.current) return;
      try {
        const google = await ensureGoogleMapsLoaded(config);
        if (cancelled || !containerRef.current) return;
        googleRef.current = google;
        const { Map } = await google.maps.importLibrary('maps');
        const center = origin
          ? { lat: origin[1], lng: origin[0] }
          : { lat: config.default_latitude, lng: config.default_longitude };
        const map = new Map(containerRef.current, {
          center,
          zoom: config.default_zoom,
          minZoom: config.min_zoom,
          maxZoom: config.max_zoom,
          styles: googleStyles,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: Boolean(config.show_pois),
        });
        mapRef.current = map;
        const controller: MapController = {
          flyTo(options) {
            map.panTo({ lat: options.center[1], lng: options.center[0] });
            if (typeof options.zoom === 'number') map.setZoom(options.zoom);
          },
        };
        registerMap?.(controller);

        const confirmDragLocationMarker = async (marker: any) => {
          const callback = onLocationDragSelectRef.current;
          if (!callback) return;

          const position = marker.getPosition?.();
          const lng = position?.lng?.();
          const lat = position?.lat?.();
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

          let address: string | null = null;
          try {
            const { Geocoder } = await google.maps.importLibrary('geocoding');
            const geocoder = new Geocoder();
            const { results = [] } = await geocoder.geocode({ location: { lat, lng } });
            address = results[0]?.formatted_address || null;
          } catch (error) {
            console.warn('[TUM][GOOGLE] reverse geocode do pin:', error);
          }

          marker.setMap?.(null);
          if (dragLocationMarkerRef.current === marker) {
            dragLocationMarkerRef.current = null;
          }

          callback({
            name: address || 'Local selecionado',
            address,
            category: null,
            openingHours: null,
            coordinates: [lng, lat],
          });
        };

        const ensureDragLocationMarker = (lng: number, lat: number) => {
          if (!onLocationDragSelectRef.current) return false;

          if (dragLocationMarkerRef.current) {
            dragLocationMarkerRef.current.setPosition?.({ lat, lng });
            return true;
          }

          const pinWidth = Math.round(Math.max(20, Math.min(28, Number(config.passenger_visual_config.pinSize || 24))));
          const pinHeight = Math.round(pinWidth * (595 / 419));
          const marker = new google.maps.Marker({
            map,
            position: { lat, lng },
            draggable: true,
            zIndex: 1600,
            icon: {
              url: publicAsset('map-markers/tum-location-pin.png'),
              scaledSize: new google.maps.Size(pinWidth, pinHeight),
              anchor: new google.maps.Point(Math.round(pinWidth / 2), pinHeight - 1),
            },
          });

          marker.addListener('dragend', () => {
            void confirmDragLocationMarker(marker);
          });
          marker.addListener('click', () => {
            void confirmDragLocationMarker(marker);
          });

          dragLocationMarkerRef.current = marker;
          return true;
        };

        map.addListener('click', async (event: any) => {
          const lng = event?.latLng?.lng?.();
          const lat = event?.latLng?.lat?.();
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

          if (ensureDragLocationMarker(lng, lat)) {
            return;
          }

          if (event.placeId && onPoiSelect) {
            try {
              const { Place } = await google.maps.importLibrary('places');
              const place = new Place({ id: event.placeId });
              await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location', 'primaryType', 'regularOpeningHours'] });
              const poi: MapPoiSelection = {
                name: place.displayName?.toString?.() || 'Local',
                address: place.formattedAddress || null,
                category: place.primaryType || null,
                openingHours: place.regularOpeningHours?.weekdayDescriptions?.join(' • ') || null,
                coordinates: [lng, lat],
              };
              onPoiSelect(poi);
              return;
            } catch (poiError) {
              console.warn('Google POI details:', poiError);
            }
          }
          onMapClick?.(lng, lat);
        });
        setError(null);
      } catch (loadError) {
        console.error(loadError);
        setError(loadError instanceof Error ? loadError.message : 'Google Maps indisponível.');
        window.setTimeout(() => onProviderError?.(loadError), 250);
      }
    }

    void init();
    return () => {
      cancelled = true;
      dragLocationMarkerRef.current?.setMap?.(null);
      dragLocationMarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setOptions({
      styles: googleStyles,
      minZoom: config.min_zoom,
      maxZoom: config.max_zoom,
      clickableIcons: Boolean(config.show_pois),
    });
  }, [config.config_revision, googleStyles]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map) return;

    staticMarkersRef.current.forEach((marker) => marker.setMap?.(null));
    staticMarkersRef.current = [];

    const addStaticMarker = (
      position: [number, number],
      icon: string,
      zIndex = 10,
      size?: { w: number; h: number },
    ) => {
      const marker = new google.maps.Marker({
        map,
        position: { lat: position[1], lng: position[0] },
        icon: {
          url: icon,
          scaledSize: size ? new google.maps.Size(size.w, size.h) : undefined,
          anchor: size ? new google.maps.Point(size.w / 2, size.h / 2) : undefined,
        },
        zIndex,
        optimized: true,
      });
      staticMarkersRef.current.push(marker);
    };

    const pinScale = Math.max(0.65, Math.min(1.85, Number(visual.pinSize || 24) / 24));
    if (origin) addStaticMarker(origin, svgPin(visual.originColor), 60, { w: Math.round(34 * pinScale), h: Math.round(40 * pinScale) });
    if (destination) addStaticMarker(destination, svgPin(visual.destinationColor), 60, { w: Math.round(34 * pinScale), h: Math.round(40 * pinScale) });
    stops.forEach((stop, index) => addStaticMarker(stop, svgPin(visual.stopColor, String(index + 1)), 55, { w: Math.round(31 * pinScale), h: Math.round(36 * pinScale) }));
  }, [origin, destination, stops, config.config_revision]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map) return;

    if (driverAnimationFrameRef.current !== null) {
      cancelAnimationFrame(driverAnimationFrameRef.current);
      driverAnimationFrameRef.current = null;
    }

    const assignedId = rideDriver ? String(rideDriver.driver_id ?? rideDriver.id) : null;
    const desired = new Map<string, DriverLocation>();
    (drivers ?? []).forEach((driver) => {
      const id = String(driver.driver_id ?? driver.id ?? '');
      if (!id || (assignedId && id === assignedId)) return;
      desired.set(id, driver);
    });
    if (rideDriver && assignedId) desired.set(assignedId, rideDriver);

    driverMarkersRef.current.forEach((entry, id) => {
      if (!desired.has(id)) {
        entry.marker.setMap?.(null);
        driverMarkersRef.current.delete(id);
      }
    });

    const plans: Array<{
      entry: { marker: any; lng: number; lat: number };
      startLng: number;
      startLat: number;
      targetLng: number;
      targetLat: number;
    }> = [];

    desired.forEach((driver, id) => {
      const targetLng = Number(driver.longitude);
      const targetLat = Number(driver.latitude);
      if (!Number.isFinite(targetLng) || !Number.isFinite(targetLat)) return;

      const assigned = assignedId === id;
      const scale = visual.driverMarkerScale * (assigned ? 1.22 : 1);
      const size = {
        w: Math.round((assigned ? 46 : 38) * scale),
        h: Math.round((assigned ? 60 : 50) * scale),
      };
      const icon = {
        url: driverIcon(driver),
        scaledSize: new google.maps.Size(size.w, size.h),
        anchor: new google.maps.Point(size.w / 2, size.h / 2),
      };

      let entry = driverMarkersRef.current.get(id);
      if (!entry) {
        const marker = new google.maps.Marker({
          map,
          position: { lat: targetLat, lng: targetLng },
          icon,
          zIndex: assigned ? 90 : 40,
          optimized: true,
        });
        entry = { marker, lng: targetLng, lat: targetLat };
        driverMarkersRef.current.set(id, entry);
        return;
      }

      entry.marker.setIcon?.(icon);
      entry.marker.setZIndex?.(assigned ? 90 : 40);

      const deltaLng = targetLng - entry.lng;
      const deltaLat = targetLat - entry.lat;
      if (Math.abs(deltaLng) < 0.00000008 && Math.abs(deltaLat) < 0.00000008) return;

      plans.push({
        entry,
        startLng: entry.lng,
        startLat: entry.lat,
        targetLng,
        targetLat,
      });
    });

    if (plans.length === 0 || document.visibilityState !== 'visible') return;

    const startedAt = performance.now();
    const duration = assignedId ? 1_800 : 3_800;
    const fps = plans.length <= 6 ? 20 : plans.length <= 12 ? 16 : 12;
    const minFrameMs = 1000 / fps;
    let lastFrameAt = 0;

    const frame = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      if (progress < 1 && now - lastFrameAt < minFrameMs) {
        driverAnimationFrameRef.current = requestAnimationFrame(frame);
        return;
      }
      lastFrameAt = now;

      plans.forEach((plan) => {
        const lng = plan.startLng + (plan.targetLng - plan.startLng) * progress;
        const lat = plan.startLat + (plan.targetLat - plan.startLat) * progress;
        plan.entry.lng = lng;
        plan.entry.lat = lat;
        plan.entry.marker.setPosition?.({ lat, lng });
      });

      if (progress < 1) {
        driverAnimationFrameRef.current = requestAnimationFrame(frame);
        return;
      }

      driverAnimationFrameRef.current = null;
    };

    driverAnimationFrameRef.current = requestAnimationFrame(frame);
  }, [drivers, rideDriver, config.config_revision]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map) return;

    routeGlowRef.current?.setMap?.(null);
    routeRef.current?.setMap?.(null);
    outlineRef.current?.setMap?.(null);
    routeHighlightRef.current?.setMap?.(null);
    routeGlowRef.current = null;
    routeRef.current = null;
    outlineRef.current = null;
    routeHighlightRef.current = null;

    const path = (routeCoords ?? []).map(([lng, lat]) => ({ lat, lng }));
    if (path.length < 2) return;

    const routeWidth = Math.max(1, Number(visual.routeWidth || 4));
    const routeColor = String(visual.routeColor || '#FACC15');
    const outlineColor = String(visual.routeOutlineColor || routeColor);
    const outlineExtra = Math.max(0, Number(visual.routeOutlineWidth || 0));

    outlineRef.current = new google.maps.Polyline({
      map,
      path,
      strokeColor: outlineColor,
      strokeOpacity: Math.max(0, Math.min(1, Number(visual.routeOutlineOpacity ?? 0.65))),
      strokeWeight: routeWidth + outlineExtra,
      geodesic: true,
      zIndex: 5,
    });
    routeRef.current = new google.maps.Polyline({
      map,
      path,
      strokeColor: routeColor,
      strokeOpacity: Math.max(0, Math.min(1, Number(visual.routeOpacity ?? 0.95))),
      strokeWeight: routeWidth,
      geodesic: true,
      zIndex: 6,
    });

    let animationFrame = 0;
    if (visual.routeAnimated) {
      // Copiado do MapVisualPreview do Painel ADM para o provider Google.
      const symbol = {
        path: google.maps.SymbolPath.CIRCLE,
        scale: Math.max(2, Number(visual.routeWidth || 5) * 0.42),
        fillColor: '#fff',
        fillOpacity: 0.95,
        strokeOpacity: 0,
      };
      routeRef.current.set('icons', [{ icon: symbol, offset: '0%' }]);
      const duration = Math.max(400, Number(visual.routeAnimationMs || 1200));
      const start = performance.now();
      const animate = (now: number) => {
        routeRef.current?.set?.('icons', [
          {
            icon: symbol,
            offset: `${((((now - start) % duration) / duration) * 100).toFixed(1)}%`,
          },
        ]);
        animationFrame = requestAnimationFrame(animate);
      };
      animationFrame = requestAnimationFrame(animate);
    }

    const bounds = new google.maps.LatLngBounds();
    path.forEach((point) => bounds.extend(point));

    const driverLng = Number(rideDriver?.longitude);
    const driverLat = Number(rideDriver?.latitude);
    if (rideDriver && Number.isFinite(driverLng) && Number.isFinite(driverLat)) {
      bounds.extend({ lat: driverLat, lng: driverLng });
    }
    if (rideDriver && origin && Number.isFinite(origin[0]) && Number.isFinite(origin[1])) {
      bounds.extend({ lat: origin[1], lng: origin[0] });
    }

    const fitRouteViewport = () => {
      const padding = mapViewportPadding(containerRef.current, Boolean(rideDriver));
      map.fitBounds(bounds, padding);
    };
    fitRouteViewport();
    const cameraFrame = requestAnimationFrame(fitRouteViewport);

    return () => {
      cancelAnimationFrame(cameraFrame);
      if (animationFrame) cancelAnimationFrame(animationFrame);
      routeGlowRef.current?.setMap?.(null);
      routeRef.current?.setMap?.(null);
      outlineRef.current?.setMap?.(null);
      routeHighlightRef.current?.setMap?.(null);
    };
  }, [routeCoords, rideDriver?.latitude, rideDriver?.longitude, origin, config.config_revision, theme]);

  useEffect(() => {
    const google = googleRef.current;
    const map = mapRef.current;
    if (!google || !map) return;

    queuedCurrentRouteRef.current?.setMap?.(null);
    queuedCurrentOutlineRef.current?.setMap?.(null);
    queuedNextRouteRef.current?.setMap?.(null);
    queuedNextOutlineRef.current?.setMap?.(null);
    queuedDestinationMarkerRef.current?.setMap?.(null);
    queuedCurrentRouteRef.current = null;
    queuedCurrentOutlineRef.current = null;
    queuedNextRouteRef.current = null;
    queuedNextOutlineRef.current = null;
    queuedDestinationMarkerRef.current = null;

    const currentPath = (queuedCurrentRouteCoords ?? []).map(([lng, lat]) => ({ lat, lng }));
    const nextPath = (queuedNextRouteCoords ?? []).map(([lng, lat]) => ({ lat, lng }));

    const addQueuedPolyline = (path: Array<{ lat: number; lng: number }>, color: string, zIndex: number) => {
      if (path.length < 2) return { outline: null, line: null };
      const outline = new google.maps.Polyline({
        map,
        path,
        strokeColor: '#111111',
        strokeOpacity: 0.88,
        strokeWeight: 8,
        geodesic: true,
        zIndex,
      });
      const line = new google.maps.Polyline({
        map,
        path,
        strokeColor: color,
        strokeOpacity: 0.98,
        strokeWeight: 5,
        geodesic: true,
        zIndex: zIndex + 1,
      });
      return { outline, line };
    };

    const currentLines = addQueuedPolyline(currentPath, '#EF4444', 20);
    queuedCurrentOutlineRef.current = currentLines.outline;
    queuedCurrentRouteRef.current = currentLines.line;

    const nextLines = addQueuedPolyline(nextPath, '#FACC15', 22);
    queuedNextOutlineRef.current = nextLines.outline;
    queuedNextRouteRef.current = nextLines.line;

    if (queuedCurrentDestination) {
      queuedDestinationMarkerRef.current = new google.maps.Marker({
        map,
        position: { lat: queuedCurrentDestination[1], lng: queuedCurrentDestination[0] },
        icon: {
          url: svgPin('#EF4444'),
          scaledSize: new google.maps.Size(34, 40),
          anchor: new google.maps.Point(17, 40),
        },
        zIndex: 80,
        clickable: false,
      });
    }

    const allPoints = [...currentPath, ...nextPath];
    if (queuedCurrentDestination) {
      allPoints.push({ lat: queuedCurrentDestination[1], lng: queuedCurrentDestination[0] });
    }

    if (allPoints.length >= 2) {
      const currentEnd = currentPath[currentPath.length - 1] ?? null;
      const nextEnd = nextPath[nextPath.length - 1] ?? null;
      const identity = [currentEnd, nextEnd]
        .filter((point): point is { lat: number; lng: number } => Boolean(point))
        .map((point) => `${point.lng.toFixed(4)},${point.lat.toFixed(4)}`)
        .join('|');

      if (identity && fittedQueuedRouteRef.current !== identity) {
        const bounds = new google.maps.LatLngBounds();
        allPoints.forEach((point) => bounds.extend(point));
        map.fitBounds(bounds, mapViewportPadding(containerRef.current, true));
        fittedQueuedRouteRef.current = identity;
      }
    } else {
      fittedQueuedRouteRef.current = null;
    }

    return () => {
      queuedCurrentRouteRef.current?.setMap?.(null);
      queuedCurrentOutlineRef.current?.setMap?.(null);
      queuedNextRouteRef.current?.setMap?.(null);
      queuedNextOutlineRef.current?.setMap?.(null);
      queuedDestinationMarkerRef.current?.setMap?.(null);
    };
  }, [
    queuedCurrentRouteCoords,
    queuedNextRouteCoords,
    queuedCurrentDestination,
    config.config_revision,
    theme,
  ]);

  useEffect(() => () => {
    routeRef.current?.setMap?.(null);
    outlineRef.current?.setMap?.(null);
    queuedCurrentRouteRef.current?.setMap?.(null);
    queuedCurrentOutlineRef.current?.setMap?.(null);
    queuedNextRouteRef.current?.setMap?.(null);
    queuedNextOutlineRef.current?.setMap?.(null);
    queuedDestinationMarkerRef.current?.setMap?.(null);
    fittedQueuedRouteRef.current = null;
    staticMarkersRef.current.forEach((marker) => marker.setMap?.(null));
    staticMarkersRef.current = [];
    driverMarkersRef.current.forEach((entry) => entry.marker.setMap?.(null));
    driverMarkersRef.current.clear();
    if (driverAnimationFrameRef.current !== null) cancelAnimationFrame(driverAnimationFrameRef.current);
    mapRef.current = null;
  }, []);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/85 px-6 text-center text-sm text-white">
          <div>
            <strong className="block text-base">Mapa Google indisponível</strong>
            <span className="mt-2 block text-neutral-300">{error}</span>
          </div>
        </div>
      )}
    </div>
  );
}
