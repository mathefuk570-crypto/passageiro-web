import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DriverLocation } from '../lib/types';
import { useTheme } from '../hooks/useTheme';
import { useTumMapConfig } from '../lib/mapConfig';
import { supabase } from '../lib/supabase';
import type { Coordinate, MapController, MapPoiSelection, MapViewProps } from './mapTypes';

const ASSET_BASE = process.env.EXPO_BASE_URL ?? '/';

function publicAsset(path: string): string {
  const base = ASSET_BASE.endsWith('/') ? ASSET_BASE : `${ASSET_BASE}/`;
  return `${base}${path.replace(/^\/+/, '')}`;
}

function finiteCoordinate(value: Coordinate | null | undefined): Coordinate | null {
  if (!value || value.length < 2) return null;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

function normalizeCategory(category: unknown): 'poptum' | 'blacktum' | 'delatum' | 'motum' {
  const normalized = String(category ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (normalized === 'blacktum') return 'blacktum';
  if (normalized === 'delatum') return 'delatum';
  if (normalized === 'motum') return 'motum';
  return 'poptum';
}

function driverAsset(driver: DriverLocation): string {
  const category = normalizeCategory(driver.category);
  if (category === 'blacktum') return publicAsset('map-markers/tum-marker-black.png');
  if (category === 'delatum') return publicAsset('map-markers/tum-marker-dela.png');
  if (category === 'motum') return publicAsset('map-markers/tum-marker-moto.png');
  return publicAsset('map-markers/tum-marker-pop.png');
}

function parseStaticStyle(styleUrl: string, dark: boolean): { username: string; styleId: string } {
  const match = /^mapbox:\/\/styles\/([^/]+)\/([^/?#]+)/i.exec(styleUrl.trim());
  let username = match?.[1] || 'mapbox';
  let styleId = match?.[2] || (dark ? 'dark-v11' : 'streets-v12');

  // Static Tiles ainda não renderiza Mapbox Standard. No fallback raster usamos
  // um estilo clássico equivalente, que não depende de WebGL no aparelho.
  if (username === 'mapbox' && (styleId === 'standard' || styleId === 'standard-satellite')) {
    username = 'mapbox';
    styleId = dark ? 'dark-v11' : 'streets-v12';
  }

  return { username, styleId };
}

function originPinIcon(color: string, size: number): L.DivIcon {
  const sc = Math.max(0.65, Math.min(1.8, Number(size || 24) / 24));
  const box = Math.round(34 * sc);
  return L.divIcon({
    className: 'tum-raster-pin-wrapper',
    html: `<div style="position:relative;width:${box}px;height:${box}px;pointer-events:none">
      <span style="position:absolute;left:50%;top:50%;width:${32 * sc}px;height:${32 * sc}px;border-radius:9999px;background:rgba(59,130,246,.25);border:1px solid rgba(255,255,255,.9);transform:translate(-50%,-50%)"></span>
      <span style="position:absolute;left:50%;top:50%;width:${17 * sc}px;height:${17 * sc}px;border-radius:9999px;background:${color};border:${3 * sc}px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5);transform:translate(-50%,-50%);box-sizing:border-box"></span>
    </div>`,
    iconSize: [box, box],
    iconAnchor: [Math.round(box / 2), Math.round(box / 2)],
  });
}

function destinationPinIcon(color: string, size: number): L.DivIcon {
  const sc = Math.max(0.65, Math.min(1.8, Number(size || 24) / 24));
  const width = Math.round(34 * sc);
  const height = Math.round(42 * sc);
  return L.divIcon({
    className: 'tum-raster-pin-wrapper',
    html: `<div style="position:relative;width:${width}px;height:${height}px;pointer-events:none">
      <span style="position:absolute;left:50%;bottom:${4 * sc}px;width:${14 * sc}px;height:${14 * sc}px;background:${color};border-right:${3 * sc}px solid #111;border-bottom:${3 * sc}px solid #111;border-radius:2px;transform:translateX(-50%) rotate(45deg);box-sizing:border-box"></span>
      <span style="position:absolute;left:50%;top:${2 * sc}px;width:${30 * sc}px;height:${30 * sc}px;border-radius:9999px;background:${color};border:${3 * sc}px solid #111;box-shadow:0 3px 10px rgba(0,0,0,.5);transform:translateX(-50%);box-sizing:border-box">
        <span style="position:absolute;left:50%;top:50%;width:${8 * sc}px;height:${8 * sc}px;border-radius:9999px;background:#111;transform:translate(-50%,-50%)"></span>
      </span>
    </div>`,
    iconSize: [width, height],
    iconAnchor: [Math.round(width / 2), height - Math.round(3 * sc)],
  });
}

function stopPinIcon(color: string, size: number, label: string): L.DivIcon {
  const sc = Math.max(0.65, Math.min(1.8, Number(size || 24) / 24));
  const box = Math.round(30 * sc);
  return L.divIcon({
    className: 'tum-raster-pin-wrapper',
    html: `<div style="position:relative;width:${box}px;height:${box}px;pointer-events:none">
      <span style="position:absolute;left:50%;top:50%;width:${27 * sc}px;height:${27 * sc}px;border-radius:9999px;background:#111;border:${3 * sc}px solid ${color};box-shadow:0 3px 9px rgba(0,0,0,.45);transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;color:${color};font:${900} ${12 * sc}px system-ui,sans-serif;box-sizing:border-box">${label}</span>
    </div>`,
    iconSize: [box, box],
    iconAnchor: [Math.round(box / 2), Math.round(box / 2)],
  });
}

function queuedPinIcon(color: string, label: string): L.DivIcon {
  return stopPinIcon(color, 20, label);
}

function dragLocationPinIcon(pinSize: number): L.Icon {
  // O pin temporário segue a mesma escala visual configurada no Painel ADM.
  // O arquivo original é 419x595, então a proporção é preservada sem distorção.
  // Limitamos apenas os extremos para o marcador nunca dominar o mapa.
  const width = Math.round(
    Math.max(20, Math.min(28, Number(pinSize || 24))),
  );
  const height = Math.round(width * (595 / 419));

  return L.icon({
    iconUrl: publicAsset('map-markers/tum-location-pin.png'),
    iconSize: [width, height],
    iconAnchor: [Math.round(width / 2), height - 1],
    className: 'tum-map-drag-location-pin',
  });
}

function driverIcon(driver: DriverLocation, assigned: boolean, scale: number): L.DivIcon {
  const factor = Math.max(0.7, Math.min(1.5, Number(scale || 1))) * (assigned ? 1.08 : 1);

  // Os assets dos carrinhos são PNG 256x256. Antes nós forçávamos 38x50,
  // deformando a imagem e deixando o carro alto/estreito no Android.
  // Agora mantemos o canvas 1:1 e deixamos a própria arte definir a proporção.
  const size = Math.round(46 * factor);
  const imageUrl = driverAsset(driver);

  return L.divIcon({
    className: assigned
      ? 'tum-raster-driver-wrapper tum-raster-driver-assigned'
      : 'tum-raster-driver-wrapper',
    html: `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;pointer-events:none">
      <img
        src="${imageUrl}"
        draggable="false"
        style="display:block;width:100%;height:100%;object-fit:contain;object-position:center;max-width:none;max-height:none"
      />
    </div>`,
    iconSize: [size, size],
    iconAnchor: [Math.round(size / 2), Math.round(size / 2)],
  });
}



type RasterPoi = {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
  maki?: string | null;
  kind?: string | null;
  fullAddress?: string | null;
  manual?: boolean;
};

function poiGlyph(maki: string | null | undefined, kind: string | null | undefined): string {
  const value = `${maki ?? ''} ${kind ?? ''}`.toLowerCase();
  if (/restaurant|food|bar|beer|bakery|cafe/.test(value)) return '●';
  if (/grocery|market|shop|store|clothing|gift/.test(value)) return '■';
  if (/hospital|doctor|dentist|pharmacy|medical|veterinary/.test(value)) return '+';
  if (/fuel|charging/.test(value)) return '⛽';
  if (/school|college|university|library|education/.test(value)) return '◆';
  if (/bank|atm/.test(value)) return '$';
  if (/hotel|lodging/.test(value)) return 'H';
  if (/park|garden|playground/.test(value)) return '♣';
  if (/parking/.test(value)) return 'P';
  if (/bus|rail|airport|ferry|transport/.test(value)) return '↔';
  if (/police|fire|town-hall|courthouse|public/.test(value)) return '★';
  if (/church|worship|religious/.test(value)) return '✦';
  if (/car|automotive|repair/.test(value)) return '▰';
  return '•';
}

function poiIcon(poi: RasterPoi): L.DivIcon {
  const glyph = poiGlyph(poi.maki, poi.kind);
  return L.divIcon({
    className: 'tum-raster-poi-wrapper',
    html: `<div style="position:relative;width:28px;height:34px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));pointer-events:none">
      <div style="position:absolute;left:3px;top:1px;width:22px;height:22px;border-radius:50%;background:#FFC700;border:1.5px solid #151515;display:flex;align-items:center;justify-content:center;color:#111;font:900 11px system-ui,sans-serif;box-sizing:border-box">${glyph}</div>
      <div style="position:absolute;left:10px;top:18px;width:8px;height:8px;background:#FFC700;border-right:1.5px solid #151515;border-bottom:1.5px solid #151515;transform:rotate(45deg)"></div>
    </div>`,
    iconSize: [28, 34],
    iconAnchor: [14, 31],
  });
}

function poiLabelIcon(name: string): L.DivIcon {
  const safeName = name.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
  return L.divIcon({
    className: 'tum-raster-poi-label-wrapper',
    html: `<div style="white-space:nowrap;max-width:130px;overflow:hidden;text-overflow:ellipsis;color:#f5f5f5;text-shadow:0 1px 2px #000,0 0 3px #000;font:700 10px system-ui,sans-serif;pointer-events:none">${safeName}</div>`,
    iconSize: [130, 18],
    iconAnchor: [65, -1],
  });
}

async function fetchNearbyPois(center: L.LatLng, token: string, zoom: number): Promise<RasterPoi[]> {
  // Igual a um mapa comercial: em visão de cidade não despejamos dezenas de
  // estabelecimentos de uma vez. Os POIs começam a surgir quando o passageiro
  // realmente aproxima o mapa e a busca fica mais local conforme o zoom aumenta.
  if (!token || zoom < 14) return [];
  const radius = zoom >= 17 ? 500 : zoom >= 16 ? 850 : zoom >= 15 ? 1300 : 1900;
  const url = new URL(`https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${center.lng},${center.lat}.json`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('radius', String(radius));
  url.searchParams.set('limit', '50');
  url.searchParams.set('dedupe', 'true');
  url.searchParams.set('geometry', 'point');
  url.searchParams.set('layers', 'poi_label');
  const response = await fetch(url.toString());
  if (!response.ok) return [];
  const json = await response.json();
  const features = Array.isArray(json?.features) ? json.features : [];
  return features.flatMap((feature: any, index: number) => {
    const coordinates = feature?.geometry?.coordinates;
    const props = feature?.properties ?? {};
    const longitude = Number(coordinates?.[0]);
    const latitude = Number(coordinates?.[1]);
    const name = String(props.name_pt || props.name || '').trim();
    if (!name || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
    return [{
      id: `mapbox:${feature?.id ?? `${longitude}:${latitude}:${index}`}`,
      name,
      longitude,
      latitude,
      maki: props.maki || props.maki_beta || null,
      kind: props.class || props.type || null,
      fullAddress: props.address || null,
    } satisfies RasterPoi];
  });
}

async function fetchManualPois(cityId: string | null | undefined): Promise<RasterPoi[]> {
  try {
    let query = supabase
      .from('map_overrides')
      .select('id,name,full_address,latitude,longitude,kind,priority,city_id')
      .eq('active', true)
      .order('priority', { ascending: false })
      .limit(100);
    if (cityId) query = query.eq('city_id', cityId);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return [];
    return data.flatMap((item: any) => {
      const longitude = Number(item.longitude);
      const latitude = Number(item.latitude);
      const name = String(item.name || '').trim();
      if (!name || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
      return [{
        id: `manual:${String(item.id)}`,
        name,
        longitude,
        latitude,
        kind: item.kind || 'place',
        fullAddress: item.full_address || name,
        manual: true,
      } satisfies RasterPoi];
    });
  } catch {
    return [];
  }
}

async function reverseGeocode(
  lng: number,
  lat: number,
  token: string,
  baseUrl: string,
  language: string,
  country: string,
): Promise<MapPoiSelection | null> {
  try {
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/reverse`);
    url.searchParams.set('longitude', String(lng));
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('limit', '1');
    if (language) url.searchParams.set('language', language);
    if (country) url.searchParams.set('country', country);
    url.searchParams.set('access_token', token);

    const response = await fetch(url.toString());
    if (!response.ok) return null;
    const json = await response.json();
    const feature = Array.isArray(json?.features) ? json.features[0] : null;
    if (!feature) return null;

    const props = feature.properties ?? {};
    const coordinates = feature.geometry?.coordinates;
    const selectedLng = Number(coordinates?.[0] ?? lng);
    const selectedLat = Number(coordinates?.[1] ?? lat);

    return {
      name: String(props.name || props.name_preferred || feature.name || 'Local selecionado'),
      address: String(props.full_address || props.place_formatted || feature.place_name || props.name || 'Local selecionado'),
      category: String(props.feature_type || feature.type || '') || null,
      openingHours: null,
      coordinates: [selectedLng, selectedLat],
    };
  } catch {
    return null;
  }
}

export default function RasterMapView({
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
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const poiLayerRef = useRef<L.LayerGroup | null>(null);
  const dragPinRef = useRef<L.Marker | null>(null);
  const onLocationDragSelectRef = useRef(onLocationDragSelect);
  const poiRequestRef = useRef(0);
  const routeAnimationFrameRef = useRef<number | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const { theme } = useTheme();
  const config = useTumMapConfig(cityId ?? null);
  const configRef = useRef(config);
  const dark = theme === 'dark';

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    onLocationDragSelectRef.current = onLocationDragSelect;

    // Se a tela sair do modo "Nova viagem", qualquer pin temporário some.
    if (!onLocationDragSelect) {
      dragPinRef.current?.remove();
      dragPinRef.current = null;
    }
  }, [onLocationDragSelect]);

  const style = useMemo(
    () => parseStaticStyle(dark ? config.passenger_map_style_dark : config.passenger_map_style_light, dark),
    [config.config_revision, config.passenger_map_style_dark, config.passenger_map_style_light, dark],
  );

  useEffect(() => {
    console.info('[TUM][MAP] renderer=raster-background');
    if (!containerRef.current || mapRef.current) return;

    const initial = finiteCoordinate(origin) ?? [config.default_longitude, config.default_latitude];
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: false,
      // No Android/WebView o Leaflet amplia temporariamente todo o SVG durante
      // a animação de zoom. Isso fazia a rota parecer engrossar a cada aproximação.
      // Desativamos apenas essa animação visual; o zoom continua funcionando normal,
      // mas as linhas são redesenhadas já na escala final e mantêm a espessura fixa.
      zoomAnimation: false,
      markerZoomAnimation: false,
      fadeAnimation: false,
      minZoom: config.min_zoom,
      maxZoom: config.max_zoom,
    }).setView([initial[1], initial[0]], config.default_zoom);

    mapRef.current = map;
    markerLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    poiLayerRef.current = L.layerGroup().addTo(map);

    const controller: MapController = {
      flyTo(options) {
        map.flyTo([options.center[1], options.center[0]], options.zoom ?? map.getZoom(), {
          duration: Math.max(0.2, (options.duration ?? 700) / 1000),
        });
      },
    };
    registerMap?.(controller);

    const confirmDragPin = async (marker: L.Marker) => {
      const callback = onLocationDragSelectRef.current;
      if (!callback) return;

      const point = marker.getLatLng();
      const currentConfig = configRef.current;

      const selected = await reverseGeocode(
        point.lng,
        point.lat,
        currentConfig.mapbox_public_token,
        currentConfig.mapbox_geocoding_base_url,
        currentConfig.search_language,
        currentConfig.search_country,
      );

      // O pin é temporário: ao abrir a confirmação, ele some do mapa.
      marker.remove();
      if (dragPinRef.current === marker) {
        dragPinRef.current = null;
      }

      callback(
        selected ?? {
          name: 'Local selecionado',
          address: null,
          category: null,
          openingHours: null,
          coordinates: [point.lng, point.lat],
        },
      );
    };

    const handleClick = async (event: L.LeafletMouseEvent) => {
      const lng = event.latlng.lng;
      const lat = event.latlng.lat;
      const dragCallback = onLocationDragSelectRef.current;

      if (dragCallback) {
        // O pin NÃO fica permanente. Ele nasce somente quando o passageiro
        // toca no mapa. Um novo toque reposiciona o mesmo pin.
        if (!dragPinRef.current) {
          const marker = L.marker([lat, lng], {
            icon: dragLocationPinIcon(
              configRef.current.passenger_visual_config.pinSize,
            ),
            draggable: true,
            autoPan: true,
            autoPanPadding: [48, 96],
            keyboard: false,
            riseOnHover: true,
            zIndexOffset: 1600,
          }).addTo(map);

          marker.on('dragend', () => {
            void confirmDragPin(marker);
          });

          marker.on('click', (markerEvent: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(markerEvent.originalEvent);
            void confirmDragPin(marker);
          });

          dragPinRef.current = marker;
        } else {
          dragPinRef.current.setLatLng([lat, lng]);
        }

        return;
      }

      if (onPoiSelect) {
        const poi = await reverseGeocode(
          lng,
          lat,
          configRef.current.mapbox_public_token,
          configRef.current.mapbox_geocoding_base_url,
          configRef.current.search_language,
          configRef.current.search_country,
        );
        if (poi) {
          onPoiSelect(poi);
          return;
        }
      }

      onMapClick?.(lng, lat);
    };

    map.on('click', handleClick);
    const resizeTimers = [0, 80, 250, 600, 1200, 2200].map((delay) =>
      window.setTimeout(() => {
        if (mapRef.current === map) map.invalidateSize({ pan: false });
      }, delay),
    );

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          if (mapRef.current === map) map.invalidateSize({ pan: false });
        })
      : null;
    observer?.observe(containerRef.current);

    return () => {
      resizeTimers.forEach((timer) => window.clearTimeout(timer));
      observer?.disconnect();
      map.off('click', handleClick);
      if (routeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(routeAnimationFrameRef.current);
        routeAnimationFrameRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      markerLayerRef.current = null;
      routeLayerRef.current = null;
      poiLayerRef.current = null;
      dragPinRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    tileRef.current?.remove();
    setStartupError(null);

    const token = config.mapbox_public_token.trim();
    if (!token) {
      setStartupError('Token público do Mapbox não configurado.');
      return;
    }

    const tileUrl = `https://api.mapbox.com/styles/v1/${encodeURIComponent(style.username)}/${encodeURIComponent(style.styleId)}/tiles/256/{z}/{x}/{y}?access_token=${encodeURIComponent(token)}`;
    const tiles = L.tileLayer(tileUrl, {
      tileSize: 256,
      minZoom: config.min_zoom,
      maxZoom: config.max_zoom,
      maxNativeZoom: Math.min(22, config.max_zoom),
      attribution: '© Mapbox © OpenStreetMap',
      // Em telas Android de alta densidade o Leaflet passa a buscar um nível
      // extra de detalhe, evitando a aparência borrada/"PNG esticado".
      detectRetina: true,
      // Atualiza tiles enquanto o dedo move o mapa. Antes `updateWhenIdle: true`
      // fazia o usuário enxergar o quadro antigo sendo arrastado até soltar.
      updateWhenIdle: false,
      updateWhenZooming: true,
      updateInterval: 80,
      keepBuffer: 6,
      crossOrigin: true,
    });

    let loaded = false;
    let errorCount = 0;
    const timeout = window.setTimeout(() => {
      if (!loaded && tileRef.current === tiles) {
        setStartupError('O mapa não conseguiu baixar os blocos visuais. Verifique a internet e o token do Mapbox.');
      }
    }, 8_000);

    console.info('[TUM][MAP] raster-style', `${style.username}/${style.styleId}`);
    tiles.on('tileload', () => {
      loaded = true;
      window.clearTimeout(timeout);
      setStartupError(null);
    });
    tiles.on('tileerror', (event: any) => {
      errorCount += 1;
      console.warn('[TUM][MAP][TILE_ERROR]', event?.tile?.src || tileUrl);
      if (errorCount >= 4) {
        window.clearTimeout(timeout);
        setStartupError('Falha ao carregar o mapa do Mapbox.');
      }
    });

    tiles.addTo(map);
    tileRef.current = tiles;

    return () => {
      window.clearTimeout(timeout);
      tiles.remove();
      if (tileRef.current === tiles) tileRef.current = null;
    };
  }, [config.config_revision, config.mapbox_public_token, config.min_zoom, config.max_zoom, style.username, style.styleId]);

  // Os POIs de comércios/pontos de referência já vêm desenhados nos tiles do
  // próprio estilo Mapbox e obedecem naturalmente ao zoom. Não sobrepomos mais
  // uma segunda camada de pins amarelos, porque ela deixava o mapa poluído e
  // diferente da prévia fiel do Painel ADM.
  useEffect(() => {
    poiLayerRef.current?.clearLayers();
  }, [config.config_revision, config.show_pois, config.show_manual_overrides, cityId]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = markerLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const originCoord = finiteCoordinate(origin);
    if (originCoord) {
      L.marker([originCoord[1], originCoord[0]], { icon: originPinIcon(config.passenger_visual_config.originColor, config.passenger_visual_config.pinSize) }).addTo(layer);
    }

    const destinationCoord = finiteCoordinate(destination);
    if (destinationCoord) {
      L.marker([destinationCoord[1], destinationCoord[0]], { icon: destinationPinIcon(config.passenger_visual_config.destinationColor, config.passenger_visual_config.pinSize) }).addTo(layer);
    }

    stops.forEach((stop, index) => {
      const coord = finiteCoordinate(stop);
      if (!coord) return;
      L.marker([coord[1], coord[0]], { icon: stopPinIcon(config.passenger_visual_config.stopColor, config.passenger_visual_config.pinSize, String(index + 1)) }).addTo(layer);
    });

    const queuedDestination = finiteCoordinate(queuedCurrentDestination);
    if (queuedDestination) {
      L.marker([queuedDestination[1], queuedDestination[0]], { icon: queuedPinIcon('#FACC15', 'Q') }).addTo(layer);
    }

    const assignedId = rideDriver ? String(rideDriver.driver_id ?? rideDriver.id ?? '') : '';
    const allDrivers = new Map<string, DriverLocation>();
    (drivers ?? []).forEach((driver) => {
      const id = String(driver.driver_id ?? driver.id ?? '');
      if (id) allDrivers.set(id, driver);
    });
    if (rideDriver && assignedId) allDrivers.set(assignedId, rideDriver);

    allDrivers.forEach((driver, id) => {
      const lng = Number(driver.longitude);
      const lat = Number(driver.latitude);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      const assigned = Boolean(assignedId && id === assignedId);
      L.marker([lat, lng], {
        icon: driverIcon(driver, assigned, config.passenger_visual_config.driverMarkerScale),
        zIndexOffset: assigned ? 900 : 300,
        interactive: false,
      }).addTo(layer);
    });
  }, [origin, destination, stops, drivers, rideDriver, queuedCurrentDestination, config.config_revision]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = routeLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const visual = config.passenger_visual_config;
    const draw = (
      coords: Coordinate[] | null | undefined,
      color: string,
      weight: number,
      opacity: number,
      dashArray?: string,
      outlineColor = visual.routeOutlineColor,
    ) => {
      const points = (coords ?? [])
        .map(finiteCoordinate)
        .filter((coord): coord is Coordinate => Boolean(coord))
        .map(([lng, lat]) => [lat, lng] as L.LatLngTuple);
      if (points.length < 2) return points;

      const outlineExtra = Math.max(0, Number(visual.routeOutlineWidth || 0));
      const outlineLine = L.polyline(points, {
        color: outlineColor,
        weight: weight + outlineExtra,
        opacity: Math.max(0, Math.min(1, Number(visual.routeOutlineOpacity ?? 0.65))),
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layer);
      const mainLine = L.polyline(points, {
        color,
        weight,
        opacity,
        dashArray,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layer);

      const outlinePath = outlineLine.getElement() as SVGPathElement | null;
      const mainPath = mainLine.getElement() as SVGPathElement | null;
      if (outlinePath) outlinePath.style.vectorEffect = 'non-scaling-stroke';
      if (mainPath) mainPath.style.vectorEffect = 'non-scaling-stroke';

      return points;
    };

    if (routeAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(routeAnimationFrameRef.current);
      routeAnimationFrameRef.current = null;
    }

    const routeColor = String(visual.routeColor || '#FACC15');
    const outlineColor = String(visual.routeOutlineColor || routeColor);
    const routeWidth = Math.max(1, Number(visual.routeWidth || 4));
    const main = draw(
      routeCoords,
      routeColor,
      routeWidth,
      Math.max(0, Math.min(1, Number(visual.routeOpacity ?? 0.95))),
      undefined,
      outlineColor,
    );
    draw(queuedCurrentRouteCoords, '#FACC15', Math.max(3, routeWidth - 1), 0.85, '9 7');
    draw(queuedNextRouteCoords, '#FFFFFF', Math.max(2, routeWidth - 2), 0.72, '5 7');

    // O Painel ADM usa uma faixa branca suave com 16% do comprimento da
    // rota: transparente -> branco -> transparente. No Android o renderer é
    // Leaflet/SVG (não Mapbox GL), então reproduzimos a mesma curva de
    // line-progress com pequenos subtrechos contínuos de opacidade gradual.
    if (main.length >= 2 && visual.routeAnimated) {
      const flowWidth = Math.max(2, routeWidth * 0.48);
      const sampleCount = 18;
      const flowSegments: L.Polyline[] = [];

      const cumulative = [0];
      for (let index = 1; index < main.length; index += 1) {
        cumulative.push(
          cumulative[index - 1] +
            L.latLng(main[index - 1]).distanceTo(L.latLng(main[index])),
        );
      }
      const totalLength = cumulative[cumulative.length - 1];

      const pointAtProgress = (progress: number): L.LatLngTuple => {
        const clamped = Math.max(0, Math.min(1, progress));
        if (totalLength <= 0) return main[0];
        const target = clamped * totalLength;
        let index = 1;
        while (index < cumulative.length && cumulative[index] < target) index += 1;
        if (index >= cumulative.length) return main[main.length - 1];
        const previousDistance = cumulative[index - 1];
        const segmentDistance = Math.max(0.000001, cumulative[index] - previousDistance);
        const t = (target - previousDistance) / segmentDistance;
        const from = main[index - 1];
        const to = main[index];
        return [
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
        ];
      };

      for (let index = 0; index < sampleCount; index += 1) {
        const relativeCenter = (index + 0.5) / sampleCount;
        const opacity = 0.95 * Math.max(0, 1 - Math.abs(relativeCenter - 0.5) * 2);
        const segment = L.polyline([main[0], main[0]], {
          color: '#FFFFFF',
          weight: flowWidth,
          opacity,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(layer);
        const element = segment.getElement() as SVGPathElement | null;
        if (element) {
          element.style.vectorEffect = 'non-scaling-stroke';
          element.style.pointerEvents = 'none';
        }
        flowSegments.push(segment);
      }

      const duration = Math.max(400, Number(visual.routeAnimationMs || 1200));
      const animate = (now: number) => {
        if (!mapRef.current || mapRef.current !== map) return;
        if (!routeLayerRef.current) return;

        // Mesmas constantes do animateFlow() real do painel.
        const x = (now % duration) / duration;
        const c = 0.12 + 0.76 * x;
        const a = Math.max(0, c - 0.08);
        const b = Math.min(1, c + 0.08);
        const width = b - a;

        flowSegments.forEach((segment, index) => {
          if (!routeLayerRef.current?.hasLayer(segment)) return;
          const p0 = a + width * (index / sampleCount);
          const p1 = a + width * ((index + 1) / sampleCount);
          segment.setLatLngs([pointAtProgress(p0), pointAtProgress(p1)]);
        });

        routeAnimationFrameRef.current = window.requestAnimationFrame(animate);
      };

      routeAnimationFrameRef.current = window.requestAnimationFrame(animate);
    }

    if (main.length >= 2) {
      map.fitBounds(L.latLngBounds(main), {
        paddingTopLeft: [45, 95],
        paddingBottomRight: [45, 280],
        maxZoom: 16,
        animate: true,
      });
    }

    return () => {
      if (routeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(routeAnimationFrameRef.current);
        routeAnimationFrameRef.current = null;
      }
    };
  }, [routeCoords, queuedCurrentRouteCoords, queuedNextRouteCoords, config.config_revision]);

  useEffect(() => {
    const map = mapRef.current;
    const originCoord = finiteCoordinate(origin);
    if (!map || !originCoord || destination) return;
    map.flyTo([originCoord[1], originCoord[0]], 14, { duration: 0.7 });
  }, [origin, destination]);

  return (
    <div className="absolute inset-0 bg-neutral-900" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0, isolation: 'isolate', overflow: 'hidden' }}>
      <div ref={containerRef} className="absolute inset-0" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', minHeight: 240, zIndex: 0 }} />
      {startupError && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/90 px-6 text-center text-white">
          <div className="max-w-xs">
            <p className="font-black">Mapa temporariamente indisponível</p>
            <p className="mt-2 text-xs leading-5 text-white/55">{startupError}</p>
            <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-tum-yellow px-4 py-2.5 text-xs font-black text-black">TENTAR NOVAMENTE</button>
          </div>
        </div>
      )}
    </div>
  );
}
