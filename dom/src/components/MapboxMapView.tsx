import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { DriverLocation } from '../lib/types';
import { useTheme } from '../hooks/useTheme';
import { useTumMapConfig } from '../lib/mapConfig';
import { reverseGeocode as reverseGeocodeAddress } from '../lib/mapbox';
import type { Coordinate, MapController, MapPoiSelection, MapViewProps as Props } from './mapTypes';
import { mapViewportPadding } from './mapViewport';

type DriverFeatureProperties = {
  markerId: string;
  categoryKey: string;
  heading: number;
  assigned: boolean;
};


const ASSET_BASE = process.env.EXPO_BASE_URL ?? '/';

const DRIVER_SOURCE_ID = 'tum-driver-vehicles-source';
const DRIVER_LAYER_ID = 'tum-driver-vehicles-layer';
const ASSIGNED_DRIVER_LAYER_ID = 'tum-assigned-driver-vehicle-layer';

const MAIN_ROUTE_SOURCE_ID = 'tum-main-route-source';
const MAIN_ROUTE_SHADOW_LAYER_ID = 'tum-main-route-shadow';
const MAIN_ROUTE_OUTLINE_LAYER_ID = 'tum-main-route-outline';
const MAIN_ROUTE_LAYER_ID = 'tum-main-route';
const MAIN_ROUTE_FLOW_LAYER_ID = 'tum-main-route-flow';

const QUEUED_CURRENT_ROUTE_SOURCE_ID = 'tum-queued-current-route-source';
const QUEUED_CURRENT_ROUTE_OUTLINE_LAYER_ID = 'tum-queued-current-route-outline';
const QUEUED_CURRENT_ROUTE_LAYER_ID = 'tum-queued-current-route';
const QUEUED_NEXT_ROUTE_SOURCE_ID = 'tum-queued-next-route-source';
const QUEUED_NEXT_ROUTE_OUTLINE_LAYER_ID = 'tum-queued-next-route-outline';
const QUEUED_NEXT_ROUTE_LAYER_ID = 'tum-queued-next-route';

const DARK_POI_SOURCE_ID = 'tum-dark-poi-source';
const DARK_POI_PIN_LAYER_ID = 'tum-dark-poi-pins';
const DARK_POI_LABEL_LAYER_ID = 'tum-dark-poi-labels';

const DARK_POI_ICON_IDS = {
  food: 'tum-poi-food-pin',
  cafe: 'tum-poi-cafe-pin',
  market: 'tum-poi-market-pin',
  medical: 'tum-poi-medical-pin',
  fuel: 'tum-poi-fuel-pin',
  education: 'tum-poi-education-pin',
  bank: 'tum-poi-bank-pin',
  hotel: 'tum-poi-hotel-pin',
  park: 'tum-poi-park-pin',
  shop: 'tum-poi-shop-pin',
  sport: 'tum-poi-sport-pin',
  attraction: 'tum-poi-attraction-pin',
  parking: 'tum-poi-parking-pin',
  transport: 'tum-poi-transport-pin',
  religious: 'tum-poi-religious-pin',
  publicService: 'tum-poi-public-pin',
  beauty: 'tum-poi-beauty-pin',
  automotive: 'tum-poi-automotive-pin',
  generic: 'tum-poi-generic-pin',
} as const;

type DarkPoiIconKey = keyof typeof DARK_POI_ICON_IDS;

const DRIVER_IMAGE_IDS = {
  poptum: 'tum-driver-pop',
  blacktum: 'tum-driver-black',
  delatum: 'tum-driver-dela',
  motum: 'tum-driver-moto',
} as const;

const DRIVER_MARKER_ASSETS: Record<keyof typeof DRIVER_IMAGE_IDS, string> = {
  poptum: 'map-markers/tum-marker-pop.png',
  blacktum: 'map-markers/tum-marker-black.png',
  delatum: 'map-markers/tum-marker-dela.png',
  motum: 'map-markers/tum-marker-moto.png',
};

interface DriverPositionState {
  coordinate: Coordinate;
  heading: number;
  sampledAtMs?: number;
}

function publicAsset(path: string): string {
  const base = ASSET_BASE.endsWith('/') ? ASSET_BASE : `${ASSET_BASE}/`;
  return `${base}${path.replace(/^\/+/, '')}`;
}

function normalizeCategoryKey(category: unknown): keyof typeof DRIVER_IMAGE_IDS {
  const normalized = String(category ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  if (normalized === 'blacktum') return 'blacktum';
  if (normalized === 'delatum') return 'delatum';
  if (normalized === 'motum') return 'motum';
  return 'poptum';
}

function calculateBearing(
  from: Coordinate,
  to: Coordinate,
  fallback = 0,
): number {
  const deltaLng = to[0] - from[0];
  const deltaLat = to[1] - from[1];

  if (Math.abs(deltaLng) < 0.000001 && Math.abs(deltaLat) < 0.000001) {
    return fallback;
  }

  const lat1 = (from[1] * Math.PI) / 180;
  const lat2 = (to[1] * Math.PI) / 180;
  const dLng = ((to[0] - from[0]) * Math.PI) / 180;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function interpolateHeading(from: number, to: number, progress: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * progress + 360) % 360;
}

function coordinateDistanceMeters(from: Coordinate, to: Coordinate): number {
  const earthRadiusM = 6_371_000;
  const lat1 = (from[1] * Math.PI) / 180;
  const lat2 = (to[1] * Math.PI) / 180;
  const deltaLat = ((to[1] - from[1]) * Math.PI) / 180;
  const deltaLng = ((to[0] - from[0]) * Math.PI) / 180;
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sampledAtMs(driver: DriverLocation): number | undefined {
  const value = driver.location_sampled_at ?? driver.updated_at;
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function markerBaseStyle(element: HTMLElement): void {
  element.style.position = 'absolute';
  element.style.left = '0';
  element.style.top = '0';
  element.style.willChange = 'transform';
  element.style.pointerEvents = 'none';
  element.style.userSelect = 'none';
}

function createOriginMarkerElement(color = '#22C55E', pinSize = 24): HTMLDivElement {
  const scale = Math.max(0.65, Math.min(1.85, Number(pinSize || 24) / 24));
  const px = (value: number) => `${value * scale}px`;
  const element = document.createElement('div');
  element.className = 'tum-origin-marker';
  markerBaseStyle(element);
  element.style.width = px(34);
  element.style.height = px(34);

  const ring = document.createElement('span');
  ring.className = 'tum-origin-marker-ring';
  ring.style.position = 'absolute';
  ring.style.left = '50%';
  ring.style.top = '50%';
  ring.style.width = px(32);
  ring.style.height = px(32);
  ring.style.borderRadius = '9999px';
  ring.style.background = 'rgba(59,130,246,.25)';
  ring.style.border = '1px solid rgba(255,255,255,.9)';
  ring.style.transform = 'translate(-50%, -50%)';

  const dot = document.createElement('span');
  dot.className = 'tum-origin-marker-dot';
  dot.style.position = 'absolute';
  dot.style.left = '50%';
  dot.style.top = '50%';
  dot.style.width = px(17);
  dot.style.height = px(17);
  dot.style.borderRadius = '9999px';
  dot.style.background = color;
  dot.style.border = `${3 * scale}px solid #FFFFFF`;
  dot.style.boxSizing = 'border-box';
  dot.style.boxShadow = '0 2px 8px rgba(0,0,0,.5)';
  dot.style.transform = 'translate(-50%, -50%)';

  element.appendChild(ring);
  element.appendChild(dot);
  return element;
}

function createDestinationMarkerElement(color = '#FACC15', pinSize = 24): HTMLDivElement {
  const scale = Math.max(0.65, Math.min(1.85, Number(pinSize || 24) / 24));
  const px = (value: number) => `${value * scale}px`;
  const element = document.createElement('div');
  element.className = 'tum-destination-marker';
  markerBaseStyle(element);
  element.style.width = px(34);
  element.style.height = px(42);

  const core = document.createElement('span');
  core.className = 'tum-destination-marker-core';
  core.style.position = 'absolute';
  core.style.left = '50%';
  core.style.top = px(2);
  core.style.width = px(30);
  core.style.height = px(30);
  core.style.borderRadius = '9999px';
  core.style.background = color;
  core.style.border = `${3 * scale}px solid #111111`;
  core.style.boxSizing = 'border-box';
  core.style.boxShadow = '0 3px 10px rgba(0,0,0,.5)';
  core.style.transform = 'translateX(-50%)';

  const center = document.createElement('span');
  center.style.position = 'absolute';
  center.style.left = '50%';
  center.style.top = '50%';
  center.style.width = px(8);
  center.style.height = px(8);
  center.style.borderRadius = '9999px';
  center.style.background = '#111111';
  center.style.transform = 'translate(-50%, -50%)';
  core.appendChild(center);

  const tip = document.createElement('span');
  tip.style.position = 'absolute';
  tip.style.left = '50%';
  tip.style.bottom = px(4);
  tip.style.width = px(14);
  tip.style.height = px(14);
  tip.style.background = color;
  tip.style.borderRight = `${3 * scale}px solid #111111`;
  tip.style.borderBottom = `${3 * scale}px solid #111111`;
  tip.style.boxSizing = 'border-box';
  tip.style.borderRadius = '2px';
  tip.style.transform = 'translateX(-50%) rotate(45deg)';

  element.appendChild(tip);
  element.appendChild(core);
  return element;
}

function createStopMarkerElement(index: number, color = '#FACC15', pinSize = 24): HTMLDivElement {
  const scale = Math.max(0.65, Math.min(1.85, Number(pinSize || 24) / 24));
  const px = (value: number) => `${value * scale}px`;
  const element = document.createElement('div');
  element.className = 'tum-stop-marker';
  markerBaseStyle(element);
  element.style.width = px(30);
  element.style.height = px(30);

  const core = document.createElement('span');
  core.style.position = 'absolute';
  core.style.left = '50%';
  core.style.top = '50%';
  core.style.width = px(27);
  core.style.height = px(27);
  core.style.borderRadius = '9999px';
  core.style.background = '#111111';
  core.style.border = `${3 * scale}px solid ${color}`;
  core.style.boxSizing = 'border-box';
  core.style.boxShadow = '0 3px 9px rgba(0,0,0,.45)';
  core.style.transform = 'translate(-50%, -50%)';
  core.style.display = 'flex';
  core.style.alignItems = 'center';
  core.style.justifyContent = 'center';
  core.style.color = color;
  core.style.fontSize = px(12);
  core.style.fontWeight = '900';
  core.style.fontFamily = 'system-ui, sans-serif';
  core.textContent = String(index + 1);

  element.appendChild(core);
  return element;
}

type StyleLayerLike = {
  id: string;
  type?: string;
  minzoom?: number;
  maxzoom?: number;
  'source-layer'?: string;
};

function isPoiStyleLayer(layer: StyleLayerLike): boolean {
  if (layer.type !== 'symbol') return false;

  const id = String(layer.id ?? '').toLowerCase();
  const sourceLayer = String(layer['source-layer'] ?? '').toLowerCase();

  return id.includes('poi') || sourceLayer.includes('poi');
}

function getPoiLayerIds(map: mapboxgl.Map): string[] {
  return (map.getStyle().layers ?? [])
    .filter(isPoiStyleLayer)
    .map((layer) => layer.id);
}

function drawPoiGlyph(
  context: CanvasRenderingContext2D,
  kind: DarkPoiIconKey,
  centerX: number,
  centerY: number,
): void {
  const ctx = context;
  ctx.save();
  ctx.strokeStyle = '#161616';
  ctx.fillStyle = '#161616';
  ctx.lineWidth = 2.25;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (kind === 'food') {
    ctx.beginPath();
    ctx.moveTo(centerX - 6, centerY - 8);
    ctx.lineTo(centerX - 6, centerY + 8);
    ctx.moveTo(centerX - 9, centerY - 8);
    ctx.lineTo(centerX - 9, centerY - 2);
    ctx.quadraticCurveTo(centerX - 9, centerY + 1, centerX - 6, centerY + 1);
    ctx.quadraticCurveTo(centerX - 3, centerY + 1, centerX - 3, centerY - 2);
    ctx.lineTo(centerX - 3, centerY - 8);
    ctx.moveTo(centerX + 5, centerY - 8);
    ctx.lineTo(centerX + 5, centerY + 8);
    ctx.moveTo(centerX + 5, centerY - 8);
    ctx.quadraticCurveTo(centerX + 10, centerY - 4, centerX + 7, centerY + 1);
    ctx.stroke();
  } else if (kind === 'cafe') {
    ctx.strokeRect(centerX - 8, centerY - 4, 13, 9);
    ctx.beginPath();
    ctx.arc(centerX + 6, centerY, 4, -Math.PI / 2, Math.PI / 2);
    ctx.moveTo(centerX - 7, centerY + 8);
    ctx.lineTo(centerX + 8, centerY + 8);
    ctx.moveTo(centerX - 4, centerY - 8);
    ctx.quadraticCurveTo(centerX - 7, centerY - 11, centerX - 4, centerY - 13);
    ctx.moveTo(centerX + 1, centerY - 8);
    ctx.quadraticCurveTo(centerX - 2, centerY - 11, centerX + 1, centerY - 13);
    ctx.stroke();
  } else if (kind === 'market') {
    ctx.beginPath();
    ctx.moveTo(centerX - 10, centerY - 7);
    ctx.lineTo(centerX - 7, centerY - 7);
    ctx.lineTo(centerX - 4, centerY + 3);
    ctx.lineTo(centerX + 8, centerY + 3);
    ctx.lineTo(centerX + 10, centerY - 4);
    ctx.lineTo(centerX - 5, centerY - 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX - 1, centerY + 8, 2, 0, Math.PI * 2);
    ctx.arc(centerX + 7, centerY + 8, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'medical') {
    ctx.fillRect(centerX - 3, centerY - 9, 6, 18);
    ctx.fillRect(centerX - 9, centerY - 3, 18, 6);
  } else if (kind === 'fuel') {
    ctx.strokeRect(centerX - 8, centerY - 9, 11, 18);
    ctx.strokeRect(centerX - 6, centerY - 6, 7, 5);
    ctx.beginPath();
    ctx.moveTo(centerX + 3, centerY - 5);
    ctx.quadraticCurveTo(centerX + 9, centerY - 4, centerX + 8, centerY + 2);
    ctx.lineTo(centerX + 8, centerY + 6);
    ctx.stroke();
  } else if (kind === 'education') {
    ctx.beginPath();
    ctx.moveTo(centerX - 10, centerY - 4);
    ctx.lineTo(centerX, centerY - 9);
    ctx.lineTo(centerX + 10, centerY - 4);
    ctx.lineTo(centerX, centerY + 1);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(centerX - 6, centerY + 2);
    ctx.lineTo(centerX - 6, centerY + 7);
    ctx.quadraticCurveTo(centerX, centerY + 10, centerX + 6, centerY + 7);
    ctx.lineTo(centerX + 6, centerY + 2);
    ctx.stroke();
  } else if (kind === 'bank' || kind === 'publicService') {
    ctx.beginPath();
    ctx.moveTo(centerX - 10, centerY - 5);
    ctx.lineTo(centerX, centerY - 10);
    ctx.lineTo(centerX + 10, centerY - 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(centerX - 10, centerY + 7, 20, 3);
    [-6, 0, 6].forEach((offset) => {
      ctx.fillRect(centerX + offset - 1, centerY - 4, 2, 10);
    });
  } else if (kind === 'hotel') {
    ctx.fillRect(centerX - 10, centerY + 1, 20, 7);
    ctx.fillRect(centerX - 10, centerY - 7, 3, 17);
    ctx.fillRect(centerX - 6, centerY - 3, 7, 4);
    ctx.beginPath();
    ctx.moveTo(centerX - 7, centerY);
    ctx.lineTo(centerX + 9, centerY);
    ctx.stroke();
  } else if (kind === 'park') {
    ctx.beginPath();
    ctx.arc(centerX, centerY - 4, 7, 0, Math.PI * 2);
    ctx.arc(centerX - 6, centerY + 1, 5, 0, Math.PI * 2);
    ctx.arc(centerX + 6, centerY + 1, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(centerX - 2, centerY + 4, 4, 7);
  } else if (kind === 'shop') {
    ctx.strokeRect(centerX - 8, centerY - 3, 16, 12);
    ctx.beginPath();
    ctx.moveTo(centerX - 10, centerY - 3);
    ctx.lineTo(centerX - 7, centerY - 9);
    ctx.lineTo(centerX + 7, centerY - 9);
    ctx.lineTo(centerX + 10, centerY - 3);
    ctx.stroke();
  } else if (kind === 'sport') {
    ctx.beginPath();
    ctx.arc(centerX, centerY, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX, centerY, 2.5, 0, Math.PI * 2);
    ctx.fill();
    for (let index = 0; index < 5; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / 5;
      ctx.moveTo(centerX + Math.cos(angle) * 3, centerY + Math.sin(angle) * 3);
      ctx.lineTo(centerX + Math.cos(angle) * 8, centerY + Math.sin(angle) * 8);
    }
    ctx.stroke();
  } else if (kind === 'parking') {
    ctx.font = '900 19px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', centerX, centerY + 1);
  } else if (kind === 'transport') {
    ctx.strokeRect(centerX - 8, centerY - 8, 16, 14);
    ctx.beginPath();
    ctx.moveTo(centerX - 5, centerY - 4);
    ctx.lineTo(centerX + 5, centerY - 4);
    ctx.moveTo(centerX - 8, centerY + 2);
    ctx.lineTo(centerX + 8, centerY + 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX - 5, centerY + 8, 2, 0, Math.PI * 2);
    ctx.arc(centerX + 5, centerY + 8, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'religious') {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - 10);
    ctx.lineTo(centerX, centerY + 9);
    ctx.moveTo(centerX - 6, centerY - 3);
    ctx.lineTo(centerX + 6, centerY - 3);
    ctx.stroke();
  } else if (kind === 'beauty') {
    ctx.beginPath();
    ctx.arc(centerX - 4, centerY - 5, 3, 0, Math.PI * 2);
    ctx.arc(centerX - 4, centerY + 5, 3, 0, Math.PI * 2);
    ctx.moveTo(centerX - 1, centerY - 3);
    ctx.lineTo(centerX + 9, centerY + 7);
    ctx.moveTo(centerX - 1, centerY + 3);
    ctx.lineTo(centerX + 9, centerY - 7);
    ctx.stroke();
  } else if (kind === 'automotive') {
    ctx.beginPath();
    ctx.moveTo(centerX - 9, centerY + 4);
    ctx.lineTo(centerX - 6, centerY - 4);
    ctx.lineTo(centerX + 6, centerY - 4);
    ctx.lineTo(centerX + 9, centerY + 4);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX - 5, centerY + 6, 2, 0, Math.PI * 2);
    ctx.arc(centerX + 5, centerY + 6, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'attraction') {
    const outer = 9;
    const inner = 4;
    ctx.beginPath();
    for (let index = 0; index < 10; index += 1) {
      const radius = index % 2 === 0 ? outer : inner;
      const angle = -Math.PI / 2 + (index * Math.PI) / 5;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(centerX, centerY, 3.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function createPoiPinImage(kind: DarkPoiIconKey): ImageData {
  // O desenho é propositalmente mais compacto que a versão anterior. Com
  // pixelRatio 2 o pin fica em torno de 28x34 px na tela e não domina o mapa.
  const width = 56;
  const height = 68;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas indisponível para criar os pins de POI.');
  }

  const centerX = width / 2;
  const centerY = 25;

  context.clearRect(0, 0, width, height);

  // Sombra discreta para separar o pin do mapa escuro sem aparência pesada.
  context.save();
  context.shadowColor = 'rgba(0,0,0,.42)';
  context.shadowBlur = 5;
  context.shadowOffsetY = 2;
  context.fillStyle = '#FFC700';
  context.beginPath();
  context.arc(centerX, centerY, 18, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.fillStyle = '#FFC700';
  context.strokeStyle = 'rgba(17,17,17,.95)';
  context.lineWidth = 2.5;
  context.lineJoin = 'round';

  context.beginPath();
  context.arc(centerX, centerY, 18, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  context.beginPath();
  context.moveTo(centerX - 7, centerY + 14);
  context.lineTo(centerX, 59);
  context.lineTo(centerX + 7, centerY + 14);
  context.closePath();
  context.fill();
  context.stroke();

  // Apaga a emenda visual do triângulo com o círculo.
  context.fillStyle = '#FFC700';
  context.fillRect(centerX - 8, centerY + 11, 16, 9);

  drawPoiGlyph(context, kind, centerX, centerY);
  return context.getImageData(0, 0, width, height);
}

function ensureDarkPoiImages(map: mapboxgl.Map): void {
  (Object.entries(DARK_POI_ICON_IDS) as Array<[DarkPoiIconKey, string]>).forEach(
    ([kind, imageId]) => {
      if (map.hasImage(imageId)) return;
      map.addImage(imageId, createPoiPinImage(kind), { pixelRatio: 2 });
    },
  );
}

function darkPoiIconExpression(): mapboxgl.Expression {
  const byClass: mapboxgl.Expression = [
    'match',
    ['get', 'class'],
    'food_and_drink', DARK_POI_ICON_IDS.food,
    'food_and_drink_stores', DARK_POI_ICON_IDS.market,
    'medical', DARK_POI_ICON_IDS.medical,
    'education', DARK_POI_ICON_IDS.education,
    'lodging', DARK_POI_ICON_IDS.hotel,
    'park_like', DARK_POI_ICON_IDS.park,
    'store_like', DARK_POI_ICON_IDS.shop,
    'commercial_services', DARK_POI_ICON_IDS.shop,
    'sport_and_leisure', DARK_POI_ICON_IDS.sport,
    'arts_and_entertainment', DARK_POI_ICON_IDS.attraction,
    'historic', DARK_POI_ICON_IDS.attraction,
    'landmark', DARK_POI_ICON_IDS.attraction,
    'visitor_amenities', DARK_POI_ICON_IDS.attraction,
    'public_services', DARK_POI_ICON_IDS.publicService,
    'religion', DARK_POI_ICON_IDS.religious,
    'transportation', DARK_POI_ICON_IDS.transport,
    DARK_POI_ICON_IDS.generic,
  ];

  return [
    'match',
    ['get', 'maki'],
    ['restaurant', 'fast-food', 'bar', 'beer', 'alcohol-shop'], DARK_POI_ICON_IDS.food,
    ['cafe', 'bakery'], DARK_POI_ICON_IDS.cafe,
    ['grocery', 'convenience', 'supermarket'], DARK_POI_ICON_IDS.market,
    ['pharmacy', 'hospital', 'doctor', 'dentist', 'veterinary'], DARK_POI_ICON_IDS.medical,
    ['fuel', 'charging-station'], DARK_POI_ICON_IDS.fuel,
    ['school', 'college', 'university', 'library'], DARK_POI_ICON_IDS.education,
    ['bank', 'bank-JP', 'atm'], DARK_POI_ICON_IDS.bank,
    ['lodging', 'hotel'], DARK_POI_ICON_IDS.hotel,
    ['park', 'garden', 'picnic-site', 'playground'], DARK_POI_ICON_IDS.park,
    ['clothing-store', 'gift', 'hardware', 'mobile-phone', 'shop', 'laundry'], DARK_POI_ICON_IDS.shop,
    ['soccer', 'stadium', 'fitness-centre', 'swimming'], DARK_POI_ICON_IDS.sport,
    ['parking', 'parking-garage'], DARK_POI_ICON_IDS.parking,
    ['bus', 'rail', 'airport', 'ferry', 'bicycle', 'car-rental'], DARK_POI_ICON_IDS.transport,
    ['place-of-worship', 'religious-christian', 'religious-jewish', 'religious-muslim'], DARK_POI_ICON_IDS.religious,
    ['town-hall', 'police', 'fire-station', 'post', 'courthouse', 'embassy'], DARK_POI_ICON_IDS.publicService,
    ['hairdresser', 'beauty'], DARK_POI_ICON_IDS.beauty,
    ['car', 'car-repair'], DARK_POI_ICON_IDS.automotive,
    ['museum', 'art-gallery', 'attraction', 'monument', 'theatre', 'cinema', 'zoo'], DARK_POI_ICON_IDS.attraction,
    byClass,
  ];
}

function ensureDarkPoiLayers(map: mapboxgl.Map, theme: string): void {
  if (theme !== 'dark' || !map.isStyleLoaded()) return;

  ensureDarkPoiImages(map);

  if (!map.getSource(DARK_POI_SOURCE_ID)) {
    map.addSource(DARK_POI_SOURCE_ID, {
      type: 'vector',
      url: 'mapbox://mapbox.mapbox-streets-v8',
    });
  }

  // Não exigimos mais `maki`: qualquer POI que tenha nome recebe um pin. Quando
  // o Mapbox não traz uma categoria conhecida usamos o pin genérico.
  const poiFilter: mapboxgl.FilterSpecification = ['has', 'name'];

  if (!map.getLayer(DARK_POI_PIN_LAYER_ID)) {
    map.addLayer({
      id: DARK_POI_PIN_LAYER_ID,
      type: 'symbol',
      source: DARK_POI_SOURCE_ID,
      'source-layer': 'poi_label',
      // POIs entram progressivamente conforme o passageiro aproxima o mapa,
      // igual a um mapa comercial. Em zoom de cidade não mostramos uma parede
      // de pins; a colisão do próprio Mapbox escolhe os pontos mais relevantes.
      minzoom: 14,
      filter: poiFilter,
      layout: {
        'icon-image': darkPoiIconExpression(),
        'icon-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14,
          0.68,
          15.5,
          0.80,
          18,
          0.92,
        ],
        'icon-anchor': 'bottom',
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
        'icon-padding': 8,
        'symbol-z-order': 'auto',
        'symbol-sort-key': ['coalesce', ['get', 'filterrank'], 20],
      },
    });
  }

  if (!map.getLayer(DARK_POI_LABEL_LAYER_ID)) {
    map.addLayer({
      id: DARK_POI_LABEL_LAYER_ID,
      type: 'symbol',
      source: DARK_POI_SOURCE_ID,
      'source-layer': 'poi_label',
      minzoom: 14.6,
      filter: poiFilter,
      layout: {
        'text-field': ['coalesce', ['get', 'name_pt'], ['get', 'name']],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14.6,
          12.4,
          15,
          13.6,
          17,
          14.8,
          19,
          15.8,
        ],
        'text-offset': [0, 0.45],
        'text-anchor': 'top',
        'text-max-width': 12,
        // Mantemos colisão somente nos nomes para não virar uma parede de texto.
        // Os pins, porém, permanecem todos visíveis o tempo inteiro.
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-padding': 2,
        'symbol-sort-key': ['coalesce', ['get', 'filterrank'], 20],
      },
      paint: {
        'text-color': '#F7F7F7',
        'text-halo-color': 'rgba(7,8,10,0.97)',
        'text-halo-width': 2.15,
        'text-halo-blur': 0.35,
      },
    });
  }
}

function enhancePoiLayers(map: mapboxgl.Map): void {
  const layers = (map.getStyle().layers ?? []).filter(isPoiStyleLayer);

  layers.forEach((layer) => {
    try {
      map.setLayoutProperty(layer.id, 'visibility', 'visible');

      // Preserva o min/max zoom definidos pelo estilo oficial. Antes o app
      // reduzia artificialmente o minZoom para 13, fazendo POIs aparecerem cedo
      // demais e todos ao mesmo tempo. O Mapbox volta a decidir a densidade por
      // nível de zoom e colisão, como em um mapa normal.

      // Mantém o estilo original, mas garante que os POIs visíveis não fiquem
      // translúcidos demais no mapa do TUM.
      map.setPaintProperty(layer.id, 'text-opacity', 1);
      map.setPaintProperty(layer.id, 'icon-opacity', 1);
    } catch {
      // Alguns sublayers do estilo podem não expor todas as propriedades.
      // Nesses casos preservamos o estilo original sem interromper o mapa.
    }
  });
}

function textProperty(properties: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function poiFromFeature(
  feature: mapboxgl.GeoJSONFeature,
  fallback: Coordinate,
): MapPoiSelection | null {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const name = textProperty(properties, ['name', 'name_pt', 'name_en']);
  if (!name) return null;

  let coordinates = fallback;
  if (feature.geometry?.type === 'Point') {
    const point = feature.geometry.coordinates;
    const normalized = normalizeCoordinate(point[0], point[1]);
    if (normalized) coordinates = normalized;
  }

  const address = textProperty(properties, [
    'full_address',
    'address',
    'addr:full',
    'addr:street',
  ]);
  const category = textProperty(properties, [
    'category',
    'class',
    'type',
    'maki',
  ]);
  const openingHours = textProperty(properties, [
    'opening_hours',
    'openingHours',
    'hours',
    'operating_hours',
  ]);

  return { name, address, category, openingHours, coordinates };
}

function getMapStyle(theme: string, config: ReturnType<typeof useTumMapConfig>) {
  return theme === 'dark'
    ? config.passenger_map_style_dark
    : config.passenger_map_style_light;
}

function applyStandardBasemapConfig(
  map: mapboxgl.Map,
  theme: string,
  config: ReturnType<typeof useTumMapConfig>,
): void {
  const styleUrl = getMapStyle(theme, config);
  if (!styleUrl.includes('mapbox/standard')) return;

  const setConfigProperty = (map as mapboxgl.Map & {
    setConfigProperty?: (importId: string, name: string, value: unknown) => void;
  }).setConfigProperty;

  if (typeof setConfigProperty !== 'function') return;

  const apply = (name: string, value: unknown) => {
    try {
      setConfigProperty.call(map, 'basemap', name, value);
    } catch {
      // Mantém compatibilidade caso uma versão antiga do renderer ignore a opção.
    }
  };

  apply('lightPreset', theme === 'dark' ? 'night' : 'day');
  apply('showRoadLabels', true);
  apply('showPedestrianRoads', true);
  apply('showPlaceLabels', true);
  apply('showPointOfInterestLabels', true);
  apply('showTransitLabels', true);
  apply('densityPointOfInterestLabels', 4);
  apply('show3dBuildings', true);
}

function routeFeatureCollection(
  coordinates: Coordinate[] | null | undefined,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const normalized = normalizeRouteCoordinates(coordinates);

  if (normalized.length < 2) {
    return {
      type: 'FeatureCollection',
      features: [],
    };
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'tum-main-route-feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: normalized,
        },
      },
    ],
  };
}

function setMainRouteSource(map: mapboxgl.Map, coordinates: Coordinate[]): void {
  const source = map.getSource(MAIN_ROUTE_SOURCE_ID) as
    | mapboxgl.GeoJSONSource
    | undefined;

  source?.setData(routeFeatureCollection(coordinates));
  map.triggerRepaint();
}

function ensureRouteLayer(map: mapboxgl.Map, config: ReturnType<typeof useTumMapConfig>) {
  const visual = config.passenger_visual_config;
  if (!map.isStyleLoaded()) {
    return;
  }

  if (!map.getSource(MAIN_ROUTE_SOURCE_ID)) {
    map.addSource(MAIN_ROUTE_SOURCE_ID, {
      type: 'geojson',
      lineMetrics: true,
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });
  }

  const routeWidth = Math.max(1, Number(visual.routeWidth || 4));
  const routeColor = String(visual.routeColor || '#FACC15');
  const outlineColor = String(visual.routeOutlineColor || routeColor);
  const outlineExtra = Math.max(0, Number(visual.routeOutlineWidth || 0));
  const outlineWidth = routeWidth + outlineExtra;
  const flowWidth = Math.max(2, routeWidth * 0.48);

  // Animação copiada do MapVisualPreview do Painel ADM: uma faixa branca
  // suave percorre a rota usando line-progress/line-gradient. Sem pontos,
  // tracejados, glow extra ou pulsação inventada no app.
  if (map.getLayer(MAIN_ROUTE_SHADOW_LAYER_ID)) {
    map.removeLayer(MAIN_ROUTE_SHADOW_LAYER_ID);
  }

  if (!map.getLayer(MAIN_ROUTE_OUTLINE_LAYER_ID)) {
    map.addLayer({
      id: MAIN_ROUTE_OUTLINE_LAYER_ID,
      type: 'line',
      source: MAIN_ROUTE_SOURCE_ID,
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': outlineColor,
        'line-width': outlineWidth,
        'line-opacity': Math.max(0, Math.min(1, Number(visual.routeOutlineOpacity ?? 0.65))),
      },
    });
  }

  if (!map.getLayer(MAIN_ROUTE_LAYER_ID)) {
    map.addLayer({
      id: MAIN_ROUTE_LAYER_ID,
      type: 'line',
      source: MAIN_ROUTE_SOURCE_ID,
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': routeColor,
        'line-width': routeWidth,
        'line-opacity': Math.max(0, Math.min(1, Number(visual.routeOpacity ?? 0.95))),
      },
    });
  }

  if (!map.getLayer(MAIN_ROUTE_FLOW_LAYER_ID)) {
    map.addLayer({
      id: MAIN_ROUTE_FLOW_LAYER_ID,
      type: 'line',
      source: MAIN_ROUTE_SOURCE_ID,
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
        visibility: visual.routeAnimated ? 'visible' : 'none',
      },
      paint: {
        'line-width': flowWidth,
        'line-opacity': 0.95,
        'line-gradient': [
          'interpolate',
          ['linear'],
          ['line-progress'],
          0,
          'rgba(255,255,255,0)',
          0.45,
          'rgba(255,255,255,0)',
          0.5,
          'rgba(255,255,255,.95)',
          0.55,
          'rgba(255,255,255,0)',
          1,
          'rgba(255,255,255,0)',
        ],
      },
    });
  }

  if (map.getLayer(MAIN_ROUTE_OUTLINE_LAYER_ID)) {
    map.setLayoutProperty(MAIN_ROUTE_OUTLINE_LAYER_ID, 'visibility', 'visible');
    map.setPaintProperty(MAIN_ROUTE_OUTLINE_LAYER_ID, 'line-color', outlineColor);
    map.setPaintProperty(MAIN_ROUTE_OUTLINE_LAYER_ID, 'line-width', outlineWidth);
    map.setPaintProperty(
      MAIN_ROUTE_OUTLINE_LAYER_ID,
      'line-opacity',
      Math.max(0, Math.min(1, Number(visual.routeOutlineOpacity ?? 0.65))),
    );
  }
  if (map.getLayer(MAIN_ROUTE_LAYER_ID)) {
    map.setLayoutProperty(MAIN_ROUTE_LAYER_ID, 'visibility', 'visible');
    map.setPaintProperty(MAIN_ROUTE_LAYER_ID, 'line-color', routeColor);
    map.setPaintProperty(MAIN_ROUTE_LAYER_ID, 'line-width', routeWidth);
    map.setPaintProperty(
      MAIN_ROUTE_LAYER_ID,
      'line-opacity',
      Math.max(0, Math.min(1, Number(visual.routeOpacity ?? 0.95))),
    );
  }

  const animationMap = map as mapboxgl.Map & { __tumRouteAnimationFrame?: number };
  if (animationMap.__tumRouteAnimationFrame) {
    cancelAnimationFrame(animationMap.__tumRouteAnimationFrame);
    animationMap.__tumRouteAnimationFrame = undefined;
  }

  if (!map.getLayer(MAIN_ROUTE_FLOW_LAYER_ID)) return;

  map.setLayoutProperty(
    MAIN_ROUTE_FLOW_LAYER_ID,
    'visibility',
    visual.routeAnimated ? 'visible' : 'none',
  );
  map.setPaintProperty(MAIN_ROUTE_FLOW_LAYER_ID, 'line-width', flowWidth);
  map.setPaintProperty(MAIN_ROUTE_FLOW_LAYER_ID, 'line-opacity', 0.95);

  const setPanelFlow = (x: number) => {
    // Trecho literalmente equivalente ao animateFlow() do Painel ADM.
    const c = 0.12 + 0.76 * x;
    const a = Math.max(0, c - 0.08);
    const b = Math.min(1, c + 0.08);
    map.setPaintProperty(MAIN_ROUTE_FLOW_LAYER_ID, 'line-gradient', [
      'interpolate',
      ['linear'],
      ['line-progress'],
      0,
      'rgba(255,255,255,0)',
      a,
      'rgba(255,255,255,0)',
      c,
      'rgba(255,255,255,.95)',
      b,
      'rgba(255,255,255,0)',
      1,
      'rgba(255,255,255,0)',
    ]);
  };

  if (visual.routeAnimated) {
    const duration = Math.max(400, Number(visual.routeAnimationMs || 1200));
    const tick = (now: number) => {
      if (!map.getLayer(MAIN_ROUTE_FLOW_LAYER_ID)) return;
      const x = (now % duration) / duration;
      try {
        setPanelFlow(x);
      } catch {}
      animationMap.__tumRouteAnimationFrame = requestAnimationFrame(tick);
    };
    animationMap.__tumRouteAnimationFrame = requestAnimationFrame(tick);
  } else {
    try {
      setPanelFlow(0.5);
    } catch {}
  }
}

function ensureQueuedRouteLayers(map: mapboxgl.Map): void {
  if (!map.isStyleLoaded()) return;

  const ensureLine = (
    sourceId: string,
    outlineLayerId: string,
    layerId: string,
    color: string,
  ) => {
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
    }

    if (!map.getLayer(outlineLayerId)) {
      map.addLayer({
        id: outlineLayerId,
        type: 'line',
        source: sourceId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#111111',
          'line-width': 8,
          'line-opacity': 0.88,
        },
      });
    }

    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': color,
          'line-width': 5,
          'line-opacity': 0.98,
        },
      });
    }
  };

  ensureLine(
    QUEUED_CURRENT_ROUTE_SOURCE_ID,
    QUEUED_CURRENT_ROUTE_OUTLINE_LAYER_ID,
    QUEUED_CURRENT_ROUTE_LAYER_ID,
    '#EF4444',
  );
  ensureLine(
    QUEUED_NEXT_ROUTE_SOURCE_ID,
    QUEUED_NEXT_ROUTE_OUTLINE_LAYER_ID,
    QUEUED_NEXT_ROUTE_LAYER_ID,
    '#FACC15',
  );

  [
    QUEUED_CURRENT_ROUTE_OUTLINE_LAYER_ID,
    QUEUED_CURRENT_ROUTE_LAYER_ID,
    QUEUED_NEXT_ROUTE_OUTLINE_LAYER_ID,
    QUEUED_NEXT_ROUTE_LAYER_ID,
  ].forEach((layerId) => {
    if (!map.getLayer(layerId)) return;
    try { map.moveLayer(layerId); } catch {}
  });
}

function setQueuedRouteSource(
  map: mapboxgl.Map,
  sourceId: string,
  coordinates: Coordinate[],
): void {
  const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
  const normalized = normalizeRouteCoordinates(coordinates);
  source?.setData(
    normalized.length >= 2
      ? {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: normalized },
            },
          ],
        }
      : { type: 'FeatureCollection', features: [] },
  );
  map.triggerRepaint();
}

function loadDriverImage(
  map: mapboxgl.Map,
  imageId: string,
  assetPath: string,
): Promise<void> {
  if (map.hasImage(imageId)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    map.loadImage(publicAsset(assetPath), (error, image) => {
      if (error || !image) {
        reject(error ?? new Error(`Não foi possível carregar ${assetPath}.`));
        return;
      }

      if (!map.hasImage(imageId)) {
        map.addImage(imageId, image);
      }

      resolve();
    });
  });
}

async function ensureDriverVehicleLayers(map: mapboxgl.Map, config: ReturnType<typeof useTumMapConfig>): Promise<void> {
  const markerScale = Math.max(0.25, Number(config.passenger_visual_config.driverMarkerScale || 1));
  if (!map.isStyleLoaded()) {
    return;
  }

  const imageEntries = Object.entries(DRIVER_MARKER_ASSETS) as Array<
    [keyof typeof DRIVER_IMAGE_IDS, string]
  >;

  await Promise.all(
    imageEntries.map(([categoryKey, assetPath]) =>
      loadDriverImage(map, DRIVER_IMAGE_IDS[categoryKey], assetPath),
    ),
  );

  if (!map.getSource(DRIVER_SOURCE_ID)) {
    map.addSource(DRIVER_SOURCE_ID, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });
  }

  const iconImageExpression: mapboxgl.Expression = [
    'match',
    ['get', 'categoryKey'],
    'blacktum',
    DRIVER_IMAGE_IDS.blacktum,
    'delatum',
    DRIVER_IMAGE_IDS.delatum,
    'motum',
    DRIVER_IMAGE_IDS.motum,
    DRIVER_IMAGE_IDS.poptum,
  ];

  if (!map.getLayer(DRIVER_LAYER_ID)) {
    map.addLayer({
      id: DRIVER_LAYER_ID,
      type: 'symbol',
      source: DRIVER_SOURCE_ID,
      filter: ['!=', ['get', 'assigned'], true],
      layout: {
        'icon-image': iconImageExpression,
        'icon-anchor': 'center',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-rotate': ['get', 'heading'],
        'icon-size': [
          'interpolate',
          ['exponential', 1.6],
          ['zoom'],
          10,
          0.072 * markerScale,
          12,
          0.099 * markerScale,
          14,
          0.139 * markerScale,
          15,
          0.185 * markerScale,
          16,
          0.252 * markerScale,
          17,
          0.344 * markerScale,
          18,
          0.476 * markerScale,
          19,
          0.649 * markerScale,
          20,
          0.873 * markerScale,
        ],
      },
    });
  }

  if (!map.getLayer(ASSIGNED_DRIVER_LAYER_ID)) {
    map.addLayer({
      id: ASSIGNED_DRIVER_LAYER_ID,
      type: 'symbol',
      source: DRIVER_SOURCE_ID,
      filter: ['==', ['get', 'assigned'], true],
      layout: {
        'icon-image': iconImageExpression,
        'icon-anchor': 'center',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-rotate': ['get', 'heading'],
        'icon-size': [
          'interpolate',
          ['exponential', 1.6],
          ['zoom'],
          10,
          0.086 * markerScale,
          12,
          0.120 * markerScale,
          14,
          0.166 * markerScale,
          15,
          0.218 * markerScale,
          16,
          0.291 * markerScale,
          17,
          0.397 * markerScale,
          18,
          0.543 * markerScale,
          19,
          0.741 * markerScale,
          20,
          0.979 * markerScale,
        ],
      },
    });
  }
}

function normalizeCoordinate(
  longitude: unknown,
  latitude: unknown,
): Coordinate | null {
  if (
    longitude === null ||
    longitude === undefined ||
    latitude === null ||
    latitude === undefined
  ) {
    return null;
  }

  if (
    (typeof longitude === 'string' && longitude.trim() === '') ||
    (typeof latitude === 'string' && latitude.trim() === '')
  ) {
    return null;
  }

  const lng = Number(longitude);
  const lat = Number(latitude);

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    return null;
  }

  return [lng, lat];
}

function normalizeCoordinateTuple(value: unknown): Coordinate | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  return normalizeCoordinate(value[0], value[1]);
}

function normalizeRouteCoordinates(
  coordinates: Coordinate[] | null | undefined,
): Coordinate[] {
  if (!Array.isArray(coordinates)) {
    return [];
  }

  return coordinates
    .map((coordinate) => normalizeCoordinateTuple(coordinate))
    .filter((coordinate): coordinate is Coordinate => coordinate !== null);
}

function raiseDriverVehicleLayers(map: mapboxgl.Map): void {
  // A rota é recolocada no topo após setData/style.load. Logo depois trazemos
  // os veículos para frente para que o carrinho atribuído nunca fique coberto
  // pela linha da rota ou por layers recriadas pelo Mapbox Standard.
  for (const layerId of [DRIVER_LAYER_ID, ASSIGNED_DRIVER_LAYER_ID]) {
    if (!map.getLayer(layerId)) continue;
    try { map.moveLayer(layerId); } catch {}
  }
}

function markerIdForDriver(driver: DriverLocation): string | null {
  const rawMarkerId = driver.driver_id ?? driver.id;

  if (
    rawMarkerId === null ||
    rawMarkerId === undefined ||
    String(rawMarkerId).trim() === ''
  ) {
    return null;
  }

  return String(rawMarkerId);
}

export default function MapView({
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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);

  const originMarker = useRef<mapboxgl.Marker | null>(null);
  const destinationMarker = useRef<mapboxgl.Marker | null>(null);
  const queuedDestinationMarker = useRef<mapboxgl.Marker | null>(null);
  const dragLocationMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const fittedQueuedRouteRef = useRef<string | null>(null);
  const stopMarkers = useRef<mapboxgl.Marker[]>([]);
  const driverPositionStateRef = useRef<Map<string, DriverPositionState>>(
    new Map(),
  );
  const displayedDriverPositionRef = useRef<Map<string, DriverPositionState>>(
    new Map(),
  );
  const driverPulseReceivedAtRef = useRef<Map<string, number>>(new Map());
  const driverAnimationFrameRef = useRef<number | null>(null);
  const restoreStyleLayersRef = useRef<(() => Promise<void>) | null>(null);

  const latestDriverFeaturesRef = useRef<
    GeoJSON.FeatureCollection<GeoJSON.Point, DriverFeatureProperties>
  >({
    type: 'FeatureCollection',
    features: [],
  });

  const latestRouteRef = useRef<Coordinate[]>(
    normalizeRouteCoordinates(routeCoords),
  );

  const fittedRouteRef = useRef<string | null>(null);
  const onMapClickRef = useRef(onMapClick);
  const onPoiSelectRef = useRef(onPoiSelect);
  const onLocationDragSelectRef = useRef(onLocationDragSelect);

  const { theme } = useTheme();
  const mapConfig = useTumMapConfig(cityId ?? null);
  const currentThemeRef = useRef(theme);
  const currentMapConfigRef = useRef(mapConfig);
  currentMapConfigRef.current = mapConfig;

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    onPoiSelectRef.current = onPoiSelect;
  }, [onPoiSelect]);

  useEffect(() => {
    onLocationDragSelectRef.current = onLocationDragSelect;
    if (!onLocationDragSelect) {
      dragLocationMarkerRef.current?.remove();
      dragLocationMarkerRef.current = null;
    }
  }, [onLocationDragSelect]);

  useEffect(() => {
    latestRouteRef.current = normalizeRouteCoordinates(routeCoords);
  }, [routeCoords]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    mapboxgl.accessToken = mapConfig.mapbox_public_token;

    const supported = typeof mapboxgl.supported === 'function'
      ? mapboxgl.supported({ failIfMajorPerformanceCaveat: false })
      : true;

    const styleUrl = getMapStyle(currentThemeRef.current, currentMapConfigRef.current);
    console.log(
      `[TUM][MAPBOX] init supported=${supported} style=${styleUrl} size=${containerRef.current.clientWidth}x${containerRef.current.clientHeight}`,
    );

    if (!supported) {
      setStartupError('A aceleração gráfica/WebGL do Android não está disponível para o mapa.');
      return;
    }

    const initialCenter =
      normalizeCoordinateTuple(origin) ?? [mapConfig.default_longitude, mapConfig.default_latitude] as Coordinate;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: initialCenter,
      zoom: mapConfig.default_zoom,
      attributionControl: false,
    });

    mapRef.current = map;
    registerMap?.(map as unknown as MapController);
    setStartupError(null);

    // Expo DOM/WebView pode montar o canvas no mesmo frame em que a tela de
    // permissões é removida. Forçamos resize após o layout estabilizar para
    // evitar canvas preto/cinza mesmo com o style já carregado.
    const resizeTimers = [
      window.setTimeout(() => { if (mapRef.current === map) map.resize(); }, 80),
      window.setTimeout(() => { if (mapRef.current === map) map.resize(); }, 420),
      window.setTimeout(() => { if (mapRef.current === map) map.resize(); }, 1200),
    ];

    const startupTimer = window.setTimeout(() => {
      if (mapRef.current === map && !map.loaded()) {
        setStartupError('O mapa demorou mais que o esperado para carregar.');
      }
    }, 9_000);

    const handleMapLoaded = () => {
      window.clearTimeout(startupTimer);
      setStartupError(null);
    };

    const restoreMapLayers = async () => {
      if (mapRef.current !== map) {
        return;
      }

      // Durante uma troca de tema o Mapbox remove todas as sources, layers e
      // imagens adicionadas em runtime. Em alguns aparelhos o callback de
      // `style.load` pode chegar antes de `isStyleLoaded()` estabilizar. Em vez
      // de desistir da restauração, aguardamos o próximo style.load.
      if (!map.isStyleLoaded()) {
        map.once('style.load', restoreMapLayers);
        return;
      }

      map.resize();
      applyStandardBasemapConfig(map, currentThemeRef.current, currentMapConfigRef.current);
      ensureDarkPoiLayers(map, currentThemeRef.current);
      if (currentThemeRef.current !== 'dark') {
        enhancePoiLayers(map);
      }
      const restoredRoute = latestRouteRef.current;
      if (restoredRoute.length >= 2) {
        ensureRouteLayer(map, currentMapConfigRef.current);
        setMainRouteSource(map, restoredRoute);

      // Ao trocar tema o Mapbox recria o style inteiro. Além de restaurar a
      // source, recolocamos a rota no topo e reenquadramos os pontos para que a
      // linha não "desapareça" visualmente após o novo mapa terminar de abrir.
        [MAIN_ROUTE_SHADOW_LAYER_ID, MAIN_ROUTE_OUTLINE_LAYER_ID, MAIN_ROUTE_LAYER_ID, MAIN_ROUTE_FLOW_LAYER_ID].forEach((layerId) => {
          if (!map.getLayer(layerId)) return;
          try { map.moveLayer(layerId); } catch {}
        });

        const first = restoredRoute[0];
        if (first) {
          const bounds = new mapboxgl.LngLatBounds(first, first);
          restoredRoute.slice(1).forEach((coordinate) => bounds.extend(coordinate));
          map.fitBounds(bounds, {
            padding: { top: 90, right: 60, bottom: 280, left: 60 },
            duration: 320,
            maxZoom: 16,
          });
        }

        window.requestAnimationFrame(() => {
          if (mapRef.current !== map || !map.isStyleLoaded()) return;
          setMainRouteSource(map, latestRouteRef.current);
        });
      }

      try {
        await ensureDriverVehicleLayers(map, currentMapConfigRef.current);

        if (mapRef.current !== map || !map.isStyleLoaded()) {
          return;
        }

        const driverSource = map.getSource(DRIVER_SOURCE_ID) as
          | mapboxgl.GeoJSONSource
          | undefined;

        driverSource?.setData(latestDriverFeaturesRef.current);
      } catch (error) {
        console.warn('Não foi possível carregar as imagens dos carros no mapa:', error);
      }
    };

    // Permite que o efeito de troca de tema peça uma restauração explícita
    // depois que o novo estilo terminar de carregar.
    restoreStyleLayersRef.current = restoreMapLayers;

    const queryPoiAroundPoint = (
      event: mapboxgl.MapMouseEvent,
      radius: number,
    ): mapboxgl.GeoJSONFeature[] => {
      const poiLayerIds = getPoiLayerIds(map);
      if (!poiLayerIds.length) return [];

      const hitBox: [[number, number], [number, number]] = [
        [event.point.x - radius, event.point.y - radius],
        [event.point.x + radius, event.point.y + radius],
      ];

      return map.queryRenderedFeatures(hitBox, { layers: poiLayerIds });
    };

    const confirmDragLocationMarker = async (marker: mapboxgl.Marker) => {
      const callback = onLocationDragSelectRef.current;
      if (!callback) return;

      const point = marker.getLngLat();
      let address: string | null = null;
      try {
        address = await reverseGeocodeAddress(point.lng, point.lat);
      } catch (error) {
        console.warn('[TUM][MAPBOX] reverse geocode do pin:', error);
      }

      marker.remove();
      if (dragLocationMarkerRef.current === marker) {
        dragLocationMarkerRef.current = null;
      }

      callback({
        name: address || 'Local selecionado',
        address,
        category: null,
        openingHours: null,
        coordinates: [point.lng, point.lat],
      });
    };

    const ensureDragLocationMarker = (lng: number, lat: number) => {
      const callback = onLocationDragSelectRef.current;
      if (!callback) return false;

      if (dragLocationMarkerRef.current) {
        dragLocationMarkerRef.current.setLngLat([lng, lat]);
        return true;
      }

      const pinSize = Math.round(
        Math.max(20, Math.min(28, Number(currentMapConfigRef.current.passenger_visual_config.pinSize || 24))),
      );
      const pinHeight = Math.round(pinSize * (595 / 419));
      const element = document.createElement('button');
      element.type = 'button';
      element.setAttribute('aria-label', 'Confirmar local selecionado');
      element.style.width = `${pinSize}px`;
      element.style.height = `${pinHeight}px`;
      element.style.padding = '0';
      element.style.margin = '0';
      element.style.border = '0';
      element.style.background = 'transparent';
      element.style.cursor = 'grab';
      element.style.touchAction = 'none';
      element.style.filter = 'drop-shadow(0 4px 7px rgba(0,0,0,.42))';

      const image = document.createElement('img');
      image.src = publicAsset('map-markers/tum-location-pin.png');
      image.alt = '';
      image.draggable = false;
      image.style.display = 'block';
      image.style.width = '100%';
      image.style.height = '100%';
      image.style.objectFit = 'contain';
      image.style.pointerEvents = 'none';
      element.appendChild(image);

      const marker = new mapboxgl.Marker({
        element,
        anchor: 'bottom',
        draggable: true,
      })
        .setLngLat([lng, lat])
        .addTo(map);

      marker.on('dragstart', () => { element.style.cursor = 'grabbing'; });
      marker.on('dragend', () => {
        element.style.cursor = 'grab';
        void confirmDragLocationMarker(marker);
      });
      element.addEventListener('click', (clickEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        void confirmDragLocationMarker(marker);
      });

      dragLocationMarkerRef.current = marker;
      return true;
    };

    const handleMapClick = (event: mapboxgl.MapMouseEvent) => {
      if (ensureDragLocationMarker(event.lngLat.lng, event.lngLat.lat)) {
        return;
      }

      if (onPoiSelectRef.current) {
        // Área de toque maior que o desenho do pin. Assim o passageiro pode tocar
        // tanto no ícone quanto no nome do estabelecimento sem precisar acertar
        // um pixel específico.
        const features = queryPoiAroundPoint(event, 26);
        const fallback: Coordinate = [event.lngLat.lng, event.lngLat.lat];

        for (const feature of features) {
          const poi = poiFromFeature(feature, fallback);
          if (poi) {
            onPoiSelectRef.current(poi);
            return;
          }
        }
      }

      onMapClickRef.current?.(event.lngLat.lng, event.lngLat.lat);
    };

    const handleMouseMove = (event: mapboxgl.MapMouseEvent) => {
      if (!onPoiSelectRef.current) {
        map.getCanvas().style.cursor = '';
        return;
      }

      const hasPoi = queryPoiAroundPoint(event, 16).some((feature) => {
        const properties = (feature.properties ?? {}) as Record<string, unknown>;
        return Boolean(textProperty(properties, ['name', 'name_pt', 'name_en']));
      });
      map.getCanvas().style.cursor = hasPoi ? 'pointer' : '';
    };

    const handleMapError = (event: any) => {
      const message = event?.error?.message ?? event?.message ?? String(event?.error ?? event ?? 'Erro desconhecido');
      console.error(`[TUM][MAPBOX][ERROR] ${message}`);
    };

    const canvas = map.getCanvas();
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      console.error('[TUM][MAPBOX][WEBGL] contexto gráfico perdido');
      setStartupError('O Android perdeu a aceleração gráfica do mapa. Feche e abra o app para recuperar.');
    };
    const handleContextRestored = () => {
      console.log('[TUM][MAPBOX][WEBGL] contexto gráfico restaurado');
      setStartupError(null);
      window.setTimeout(() => {
        if (mapRef.current === map) map.resize();
      }, 80);
    };

    canvas.addEventListener('webglcontextlost', handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    map.on('error', handleMapError);
    map.on('load', () => {
      console.log(`[TUM][MAPBOX] load styleLoaded=${map.isStyleLoaded()} size=${map.getContainer().clientWidth}x${map.getContainer().clientHeight}`);
    });
    map.on('load', handleMapLoaded);
    map.on('load', restoreMapLayers);
    map.on('style.load', restoreMapLayers);
    map.on('click', handleMapClick);
    map.on('mousemove', handleMouseMove);

    return () => {
      window.clearTimeout(startupTimer);
      resizeTimers.forEach((timer) => window.clearTimeout(timer));
      map.off('error', handleMapError);
      canvas.removeEventListener('webglcontextlost', handleContextLost, false);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored, false);
      map.off('load', handleMapLoaded);
      map.off('load', restoreMapLayers);
      map.off('style.load', restoreMapLayers);
      map.off('click', handleMapClick);
      map.off('mousemove', handleMouseMove);
      map.getCanvas().style.cursor = '';

      originMarker.current?.remove();
      originMarker.current = null;

      destinationMarker.current?.remove();
      destinationMarker.current = null;

      queuedDestinationMarker.current?.remove();
      queuedDestinationMarker.current = null;
      dragLocationMarkerRef.current?.remove();
      dragLocationMarkerRef.current = null;
      fittedQueuedRouteRef.current = null;

      stopMarkers.current.forEach((marker) => marker.remove());
      stopMarkers.current = [];

      if (driverAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(driverAnimationFrameRef.current);
        driverAnimationFrameRef.current = null;
      }

      const animationMap = map as mapboxgl.Map & { __tumRouteAnimationFrame?: number };
      if (animationMap.__tumRouteAnimationFrame) {
        window.cancelAnimationFrame(animationMap.__tumRouteAnimationFrame);
        animationMap.__tumRouteAnimationFrame = undefined;
      }

      driverPositionStateRef.current.clear();
      displayedDriverPositionRef.current.clear();
      driverPulseReceivedAtRef.current.clear();

      if (restoreStyleLayersRef.current === restoreMapLayers) {
        restoreStyleLayersRef.current = null;
      }

      if (mapRef.current === map) {
        mapRef.current = null;
      }

      map.remove();
    };
  }, []);

  useEffect(() => {
    currentThemeRef.current = theme;
  }, [theme]);


  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // A troca de style/chave/provedor é feita pelo `key` em MapView, recriando
    // a instância inteira. Aqui atualizamos somente elementos visuais do TUM.
    // Fazer `map.setStyle()` ao chegar a config do painel era a principal causa
    // do mapa aparecer por 1-2 s e depois virar um canvas cinza no Android.
    mapboxgl.accessToken = mapConfig.mapbox_public_token;

    const applyVisualConfig = () => {
      if (mapRef.current !== map || !map.isStyleLoaded()) return;
      applyStandardBasemapConfig(map, theme, mapConfig);
      ensureDarkPoiLayers(map, theme);
      if (theme !== 'dark') enhancePoiLayers(map);
      if (latestRouteRef.current.length >= 2) {
        ensureRouteLayer(map, mapConfig);
        setMainRouteSource(map, latestRouteRef.current);
      }

      const routeVisual = mapConfig.passenger_visual_config;
      const routeWidth = Math.max(1, Number(routeVisual.routeWidth || 4));
      const routeColor = String(routeVisual.routeColor || '#FACC15');
      const outlineColor = String(routeVisual.routeOutlineColor || routeColor);
      const outlineWidth = routeWidth + Math.max(0, Number(routeVisual.routeOutlineWidth || 0));

      if (map.getLayer(MAIN_ROUTE_OUTLINE_LAYER_ID)) {
        map.setPaintProperty(MAIN_ROUTE_OUTLINE_LAYER_ID, 'line-color', outlineColor);
        map.setPaintProperty(MAIN_ROUTE_OUTLINE_LAYER_ID, 'line-width', outlineWidth);
        map.setPaintProperty(MAIN_ROUTE_OUTLINE_LAYER_ID, 'line-opacity', Math.max(0, Math.min(1, Number(routeVisual.routeOutlineOpacity ?? 0.65))));
      }
      if (map.getLayer(MAIN_ROUTE_LAYER_ID)) {
        map.setPaintProperty(MAIN_ROUTE_LAYER_ID, 'line-color', routeColor);
        map.setPaintProperty(MAIN_ROUTE_LAYER_ID, 'line-width', routeWidth);
        map.setPaintProperty(MAIN_ROUTE_LAYER_ID, 'line-opacity', Math.max(0, Math.min(1, Number(routeVisual.routeOpacity ?? 0.95))));
      }
    };

    if (map.isStyleLoaded()) applyVisualConfig();
    else map.once('style.load', applyVisualConfig);

    return () => {
      map.off('style.load', applyVisualConfig);
    };
  }, [
    mapConfig.config_revision,
    mapConfig.passenger_visual_config.routeAnimated,
    mapConfig.passenger_visual_config.routeAnimationMs,
    mapConfig.passenger_visual_config.routeColor,
    mapConfig.passenger_visual_config.routeOutlineColor,
    mapConfig.passenger_visual_config.routeWidth,
    mapConfig.passenger_visual_config.routeOutlineWidth,
    mapConfig.passenger_visual_config.routeOpacity,
    mapConfig.passenger_visual_config.routeOutlineOpacity,
    theme,
  ]);



  useEffect(() => {
    const map = mapRef.current;
    const originCoordinate = normalizeCoordinateTuple(origin);

    if (!map || !originCoordinate || destination) {
      return;
    }

    map.flyTo({
      center: originCoordinate,
      zoom: 14,
      duration: 800,
    });
  }, [origin, destination]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    originMarker.current?.remove();
    originMarker.current = null;

    const originCoordinate = normalizeCoordinateTuple(origin);

    if (!originCoordinate) {
      return;
    }

    const element = createOriginMarkerElement(currentMapConfigRef.current.passenger_visual_config.originColor, currentMapConfigRef.current.passenger_visual_config.pinSize);

    originMarker.current = new mapboxgl.Marker({
      element,
      anchor: 'center',
    })
      .setLngLat(originCoordinate)
      .addTo(map);
  }, [origin, mapConfig.config_revision]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    destinationMarker.current?.remove();
    destinationMarker.current = null;

    const destinationCoordinate = normalizeCoordinateTuple(destination);

    if (!destinationCoordinate) {
      return;
    }

    const element = createDestinationMarkerElement(currentMapConfigRef.current.passenger_visual_config.destinationColor, currentMapConfigRef.current.passenger_visual_config.pinSize);

    destinationMarker.current = new mapboxgl.Marker({
      element,
      anchor: 'bottom',
      offset: [0, -2],
    })
      .setLngLat(destinationCoordinate)
      .addTo(map);
  }, [destination, mapConfig.config_revision]);

  useEffect(() => {
    const map = mapRef.current;

    stopMarkers.current.forEach((marker) => marker.remove());
    stopMarkers.current = [];

    if (!map || !Array.isArray(stops)) {
      return;
    }

    stops.forEach((coordinate, index) => {
      const normalized = normalizeCoordinateTuple(coordinate);
      if (!normalized) return;

      const marker = new mapboxgl.Marker({
        element: createStopMarkerElement(index, currentMapConfigRef.current.passenger_visual_config.stopColor, currentMapConfigRef.current.passenger_visual_config.pinSize),
        anchor: 'center',
      })
        .setLngLat(normalized)
        .addTo(map);

      stopMarkers.current.push(marker);
    });
  }, [stops, mapConfig.config_revision]);

  useEffect(() => {
    const map = mapRef.current;
    const previousPositions = driverPositionStateRef.current;
    const nextPositions = new Map<string, DriverPositionState>();

    const features: Array<
      GeoJSON.Feature<GeoJSON.Point, DriverFeatureProperties>
    > = [];

    const appendDriver = (driver: DriverLocation, assigned: boolean) => {
      const markerId = markerIdForDriver(driver);
      const rawCoordinate = normalizeCoordinate(driver.longitude, driver.latitude);

      if (!markerId || !rawCoordinate) {
        return;
      }

      const previous = previousPositions.get(markerId);
      const sampleMs = sampledAtMs(driver);
      const accuracy = finiteNumber(driver.accuracy_m);
      const speed = finiteNumber(driver.speed_mps);
      const deviceHeading = finiteNumber(driver.heading_degrees);

      let coordinate: Coordinate = rawCoordinate;
      let heading = previous?.heading ?? 0;

      if (previous) {
        // Proteção cliente contra amostras fora de ordem. O banco também faz
        // essa validação, mas manter a regra aqui evita um "vai e volta" mesmo
        // durante uma troca de versão ou reconexão.
        const isOlderSample =
          sampleMs !== undefined &&
          previous.sampledAtMs !== undefined &&
          sampleMs < previous.sampledAtMs;

        if (isOlderSample) {
          coordinate = previous.coordinate;
        }

        let movementM = coordinateDistanceMeters(previous.coordinate, coordinate);

        // GPS ruim parado costuma passear alguns metros entre ruas. Não usamos
        // esses pequenos saltos para mover/virar o carrinho.
        const jitterThresholdM = assigned
          ? Math.max(2.5, Math.min(7, (accuracy ?? 8) * 0.28))
          : Math.max(5, Math.min(14, (accuracy ?? 12) * 0.35));

        const stationaryThresholdM = Math.max(
          8,
          Math.min(18, (accuracy ?? 10) * 0.6),
        );
        const clearlyStopped =
          speed !== null && speed >= 0 && speed < 0.8;

        if (
          (accuracy ?? 0) > 65 ||
          movementM < jitterThresholdM ||
          (clearlyStopped && movementM < stationaryThresholdM)
        ) {
          coordinate = previous.coordinate;
          movementM = 0;
        }

        // Descarta um ponto fisicamente impossível recebido poucos segundos
        // depois do anterior. Isso evita GPS espirrando para outra rua e voltando.
        if (
          movementM > 0 &&
          sampleMs !== undefined &&
          previous.sampledAtMs !== undefined
        ) {
          const elapsedSeconds = Math.max(0.25, (sampleMs - previous.sampledAtMs) / 1000);
          const impliedSpeedMps = movementM / elapsedSeconds;
          if (elapsedSeconds < 30 && impliedSpeedMps > 75) {
            coordinate = previous.coordinate;
            movementM = 0;
          }
        }

        if (movementM >= 3.5) {
          const derivedHeading = calculateBearing(
            previous.coordinate,
            coordinate,
            previous.heading,
          );

          // Nunca recalcula a orientação só por jitter enquanto o aparelho diz
          // que o carro está parado. Heading só muda com movimento real.
          if (
            deviceHeading !== null &&
            deviceHeading >= 0 &&
            deviceHeading < 360 &&
            (speed ?? 0) >= 1.2
          ) {
            heading = deviceHeading;
          } else if (speed === null ? movementM >= 8 : speed >= 0.8) {
            heading = derivedHeading;
          }
        }
      } else if (
        deviceHeading !== null &&
        deviceHeading >= 0 &&
        deviceHeading < 360 &&
        (speed ?? 0) >= 1.2
      ) {
        heading = deviceHeading;
      }

      const acceptedState: DriverPositionState = {
        coordinate,
        heading,
        sampledAtMs: sampleMs ?? previous?.sampledAtMs,
      };

      nextPositions.set(markerId, acceptedState);

      features.push({
        type: 'Feature',
        id: markerId,
        properties: {
          markerId,
          categoryKey: normalizeCategoryKey(driver.category),
          heading,
          assigned,
        },
        geometry: {
          type: 'Point',
          coordinates: coordinate,
        },
      });
    };

    const driverList = Array.isArray(drivers) ? drivers : [];
    const assignedMarkerId = rideDriver ? markerIdForDriver(rideDriver) : null;

    driverList.forEach((driver) => {
      if (!driver) return;
      if (assignedMarkerId && markerIdForDriver(driver) === assignedMarkerId) {
        return;
      }
      appendDriver(driver, false);
    });

    if (rideDriver) {
      appendDriver(rideDriver, true);
    }

    driverPositionStateRef.current = nextPositions;

    // Limpa estados de veículos que realmente saíram da coleção atual.
    displayedDriverPositionRef.current.forEach((_value, markerId) => {
      if (!nextPositions.has(markerId)) {
        displayedDriverPositionRef.current.delete(markerId);
        driverPulseReceivedAtRef.current.delete(markerId);
      }
    });

    const featureCollection: GeoJSON.FeatureCollection<
      GeoJSON.Point,
      DriverFeatureProperties
    > = {
      type: 'FeatureCollection',
      features,
    };

    latestDriverFeaturesRef.current = featureCollection;

    if (!map) {
      return;
    }

    let driverCancelled = false;
    let driverRetryTimer: number | null = null;

    const applyDrivers = async () => {
      if (driverCancelled || mapRef.current !== map) {
        return;
      }

      const existingSource = map.getSource(DRIVER_SOURCE_ID) as
        | mapboxgl.GeoJSONSource
        | undefined;

      const setSourceWithLightweightSmoothing = (
        source: mapboxgl.GeoJSONSource,
      ) => {
        if (driverAnimationFrameRef.current !== null) {
          window.cancelAnimationFrame(driverAnimationFrameRef.current);
          driverAnimationFrameRef.current = null;
        }

        if (featureCollection.features.length === 0) {
          displayedDriverPositionRef.current.clear();
          source.setData(featureCollection);
          return;
        }

        const receivedAt = performance.now();
        const plans: Array<{
          markerId: string;
          feature: GeoJSON.Feature<GeoJSON.Point, DriverFeatureProperties>;
          start: DriverPositionState;
          target: DriverPositionState;
          duration: number;
        }> = [];

        const animatedFeatures = featureCollection.features.map((feature) => ({
          ...feature,
          properties: { ...feature.properties },
          geometry: {
            ...feature.geometry,
            coordinates: [...feature.geometry.coordinates],
          },
        })) as Array<GeoJSON.Feature<GeoJSON.Point, DriverFeatureProperties>>;

        const animatedById = new Map(
          animatedFeatures.map((feature) => [feature.properties.markerId, feature]),
        );

        featureCollection.features.forEach((feature) => {
          const markerId = feature.properties.markerId;
          const targetState = nextPositions.get(markerId);
          if (!targetState) return;

          const displayed = displayedDriverPositionRef.current.get(markerId);
          const previousRaw = previousPositions.get(markerId);
          const startState = displayed ?? previousRaw ?? targetState;
          const distanceM = coordinateDistanceMeters(
            startState.coordinate,
            targetState.coordinate,
          );

          const previousPulseAt = driverPulseReceivedAtRef.current.get(markerId);
          const pulseGap = previousPulseAt
            ? Math.max(300, receivedAt - previousPulseAt)
            : feature.properties.assigned
              ? 1_800
              : 4_800;
          driverPulseReceivedAtRef.current.set(markerId, receivedAt);

          // Primeiro frame ou recuperação muito distante: aplica diretamente.
          // Não fazemos um carro atravessar quilômetros pelo mapa em animação.
          if (!displayed && !previousRaw || distanceM > 1_000) {
            displayedDriverPositionRef.current.set(markerId, targetState);
            return;
          }

          if (distanceM < 0.8) {
            displayedDriverPositionRef.current.set(markerId, targetState);
            return;
          }

          const duration = feature.properties.assigned
            ? Math.min(2_600, Math.max(650, pulseGap * 0.9))
            : Math.min(5_200, Math.max(900, pulseGap * 0.92));

          const animatedFeature = animatedById.get(markerId);
          if (!animatedFeature) return;

          animatedFeature.geometry.coordinates = [...startState.coordinate];
          animatedFeature.properties.heading = startState.heading;

          plans.push({
            markerId,
            feature: animatedFeature,
            start: startState,
            target: targetState,
            duration,
          });
        });

        if (plans.length === 0 || document.visibilityState !== 'visible') {
          featureCollection.features.forEach((feature) => {
            const state = nextPositions.get(feature.properties.markerId);
            if (state) displayedDriverPositionRef.current.set(feature.properties.markerId, state);
          });
          source.setData(featureCollection);
          return;
        }

        const animatedCollection: GeoJSON.FeatureCollection<
          GeoJSON.Point,
          DriverFeatureProperties
        > = {
          type: 'FeatureCollection',
          features: animatedFeatures,
        };

        const startedAt = performance.now();
        let lastRenderedAt = 0;

        // Um único RAF e um único setData para TODOS os carros. Isso é muito
        // mais leve do que criar timers/markers independentes por motorista.
        const configuredFps = Math.max(
          12,
          Math.min(
            30,
            Number(
              currentMapConfigRef.current.passenger_visual_config
                .driverAnimationFps || 24,
            ),
          ),
        );
        const adaptiveCap = plans.length <= 6 ? 24 : plans.length <= 12 ? 18 : 14;
        const fps = Math.min(configuredFps, adaptiveCap);
        const minFrameMs = 1000 / fps;

        const frame = (now: number) => {
          let allFinished = true;

          if (now - lastRenderedAt < minFrameMs) {
            driverAnimationFrameRef.current = window.requestAnimationFrame(frame);
            return;
          }
          lastRenderedAt = now;

          plans.forEach((plan) => {
            const progress = Math.min(1, (now - startedAt) / plan.duration);
            if (progress < 1) allFinished = false;

            const lng =
              plan.start.coordinate[0] +
              (plan.target.coordinate[0] - plan.start.coordinate[0]) * progress;
            const lat =
              plan.start.coordinate[1] +
              (plan.target.coordinate[1] - plan.start.coordinate[1]) * progress;
            const heading = interpolateHeading(
              plan.start.heading,
              plan.target.heading,
              progress,
            );

            const state: DriverPositionState = {
              coordinate: [lng, lat],
              heading,
              sampledAtMs: plan.target.sampledAtMs,
            };
            displayedDriverPositionRef.current.set(plan.markerId, state);
            plan.feature.geometry.coordinates = [lng, lat];
            plan.feature.properties.heading = heading;
          });

          source.setData(animatedCollection);

          if (!allFinished) {
            driverAnimationFrameRef.current = window.requestAnimationFrame(frame);
            return;
          }

          driverAnimationFrameRef.current = null;
          featureCollection.features.forEach((feature) => {
            const state = nextPositions.get(feature.properties.markerId);
            if (state) displayedDriverPositionRef.current.set(feature.properties.markerId, state);
          });
          source.setData(featureCollection);
        };

        driverAnimationFrameRef.current = window.requestAnimationFrame(frame);
      };

      if (existingSource) {
        // Source já criada: não bloqueamos a atualização só porque o Mapbox
        // está carregando tiles/style internamente naquele instante.
        setSourceWithLightweightSmoothing(existingSource);
        return;
      }

      if (!map.isStyleLoaded()) {
        driverRetryTimer = window.setTimeout(() => {
          void applyDrivers();
        }, 100);
        return;
      }

      try {
        await ensureDriverVehicleLayers(map, currentMapConfigRef.current);

        if (mapRef.current !== map) {
          return;
        }

        const source = map.getSource(DRIVER_SOURCE_ID) as
          | mapboxgl.GeoJSONSource
          | undefined;

        if (source) {
          setSourceWithLightweightSmoothing(source);
        } else {
          driverRetryTimer = window.setTimeout(() => {
            void applyDrivers();
          }, 100);
        }
      } catch (error) {
        console.warn('Não foi possível atualizar os carros no mapa:', error);
      }
    };

    void applyDrivers();
    map.on('style.load', applyDrivers);

    return () => {
      driverCancelled = true;
      if (driverRetryTimer !== null) window.clearTimeout(driverRetryTimer);
      map.off('style.load', applyDrivers);
    };
  }, [drivers, rideDriver, mapConfig.config_revision]);


  // Rede de segurança: se o WebView/Mapbox perder a source durante uma troca de
  // estilo/contexto, restaura os carros da última lista válida sem depender de
  // uma nova coordenada chegar para disparar um render React.
  useEffect(() => {
    const repairDrivers = async () => {
      const map = mapRef.current;
      if (!map || !map.isStyleLoaded()) return;
      if (latestDriverFeaturesRef.current.features.length === 0) return;
      if (driverAnimationFrameRef.current !== null) return;

      try {
        await ensureDriverVehicleLayers(map, currentMapConfigRef.current);
        if (mapRef.current !== map || !map.isStyleLoaded()) return;

        const source = map.getSource(DRIVER_SOURCE_ID) as
          | mapboxgl.GeoJSONSource
          | undefined;
        source?.setData(latestDriverFeaturesRef.current);
      } catch (error) {
        console.warn('Não foi possível restaurar os carros no mapa:', error);
      }
    };

    const interval = window.setInterval(() => {
      void repairDrivers();
    }, 6000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentRoute = normalizeRouteCoordinates(queuedCurrentRouteCoords);
    const nextRoute = normalizeRouteCoordinates(queuedNextRouteCoords);
    const queueDestination = normalizeCoordinateTuple(queuedCurrentDestination);
    let cancelled = false;
    let retryTimer: number | null = null;

    const applyQueuedRoutes = () => {
      if (cancelled || mapRef.current !== map) return;

      const hasAnyRoute = currentRoute.length >= 2 || nextRoute.length >= 2;
      const currentSource = map.getSource(QUEUED_CURRENT_ROUTE_SOURCE_ID) as
        | mapboxgl.GeoJSONSource
        | undefined;
      const nextSource = map.getSource(QUEUED_NEXT_ROUTE_SOURCE_ID) as
        | mapboxgl.GeoJSONSource
        | undefined;

      // Depois que as sources existem, setData funciona mesmo enquanto o Mapbox
      // ainda reporta isStyleLoaded()=false por carregamentos internos. Esperar
      // outro style.load aqui fazia a segunda rota ficar presa para sempre.
      if (!currentSource || !nextSource) {
        if (hasAnyRoute && map.isStyleLoaded()) {
          ensureQueuedRouteLayers(map);
        } else if (hasAnyRoute) {
          retryTimer = window.setTimeout(applyQueuedRoutes, 80);
          return;
        }
      }

      setQueuedRouteSource(map, QUEUED_CURRENT_ROUTE_SOURCE_ID, currentRoute);
      setQueuedRouteSource(map, QUEUED_NEXT_ROUTE_SOURCE_ID, nextRoute);

      queuedDestinationMarker.current?.remove();
      queuedDestinationMarker.current = null;

      if (queueDestination) {
        queuedDestinationMarker.current = new mapboxgl.Marker({
          element: createDestinationMarkerElement(
            '#EF4444',
            currentMapConfigRef.current.passenger_visual_config.pinSize,
          ),
          anchor: 'bottom',
          offset: [0, -2],
        })
          .setLngLat(queueDestination)
          .addTo(map);
      }

      const allCoordinates = [...currentRoute, ...nextRoute];
      if (queueDestination) allCoordinates.push(queueDestination);

      if (allCoordinates.length < 2) {
        fittedQueuedRouteRef.current = null;
        return;
      }

      const currentEnd = currentRoute[currentRoute.length - 1] ?? queueDestination;
      const nextEnd = nextRoute[nextRoute.length - 1] ?? queueDestination;
      const identity = [currentEnd, nextEnd]
        .filter((coordinate): coordinate is Coordinate => Boolean(coordinate))
        .map((coordinate) => `${coordinate[0].toFixed(4)},${coordinate[1].toFixed(4)}`)
        .join('|');

      if (!identity || fittedQueuedRouteRef.current === identity) return;

      const first = allCoordinates[0];
      if (!first) return;
      const bounds = new mapboxgl.LngLatBounds(first, first);
      allCoordinates.slice(1).forEach((coordinate) => bounds.extend(coordinate));
      map.fitBounds(bounds, {
        padding: mapViewportPadding(map.getContainer(), true),
        duration: 550,
        maxZoom: 16,
      });
      fittedQueuedRouteRef.current = identity;
    };

    applyQueuedRoutes();
    map.on('style.load', applyQueuedRoutes);

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      map.off('style.load', applyQueuedRoutes);
    };
  }, [
    queuedCurrentRouteCoords,
    queuedNextRouteCoords,
    queuedCurrentDestination,
    mapConfig.config_revision,
  ]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    const coordinates = normalizeRouteCoordinates(routeCoords);
    latestRouteRef.current = coordinates;
    let cancelled = false;
    let retryTimer: number | null = null;

    const applyRoute = () => {
      if (cancelled || mapRef.current !== map) {
        return;
      }

      const existingSource = map.getSource(MAIN_ROUTE_SOURCE_ID) as
        | mapboxgl.GeoJSONSource
        | undefined;

      // Limpar a rota não depende de o style estar 100% "loaded". O source já
      // existente aceita setData normalmente; esperar um novo style.load deixava
      // a geometria anterior congelada no Android WebView.
      if (coordinates.length < 2) {
        existingSource?.setData(routeFeatureCollection([]));
        fittedRouteRef.current = null;
        map.triggerRepaint();
        return;
      }

      let source = existingSource;
      if (!source) {
        if (!map.isStyleLoaded()) {
          retryTimer = window.setTimeout(applyRoute, 80);
          return;
        }

        ensureRouteLayer(map, currentMapConfigRef.current);
        source = map.getSource(MAIN_ROUTE_SOURCE_ID) as
          | mapboxgl.GeoJSONSource
          | undefined;
      }

      if (!source) {
        retryTimer = window.setTimeout(applyRoute, 80);
        return;
      }

      source.setData(routeFeatureCollection(coordinates));
      map.triggerRepaint();

      // O Mapbox Standard pode reorganizar slots/layers depois do style.load.
      // Mantemos a rota do TUM acima do basemap sem recriar a source.
      for (const layerId of [
        MAIN_ROUTE_SHADOW_LAYER_ID,
        MAIN_ROUTE_OUTLINE_LAYER_ID,
        MAIN_ROUTE_LAYER_ID,
        MAIN_ROUTE_FLOW_LAYER_ID,
      ]) {
        if (!map.getLayer(layerId)) continue;
        try { map.moveLayer(layerId); } catch {}
      }

      window.requestAnimationFrame(() => {
        if (cancelled || mapRef.current !== map) return;
        if (latestRouteRef.current !== coordinates) return;
        const liveSource = map.getSource(MAIN_ROUTE_SOURCE_ID) as
          | mapboxgl.GeoJSONSource
          | undefined;
        liveSource?.setData(routeFeatureCollection(coordinates));
        map.triggerRepaint();
      });

      const first = coordinates[0];
      const last = coordinates[coordinates.length - 1];

      if (!first || !last) {
        fittedRouteRef.current = null;
        return;
      }

      const assignedDriverCoordinate = rideDriver
        ? normalizeCoordinate(rideDriver.longitude, rideDriver.latitude)
        : null;
      const pickupCoordinate = rideDriver ? normalizeCoordinateTuple(origin) : null;

      const routeIdentity =
        `${first[0].toFixed(5)},${first[1].toFixed(5)}-` +
        `${last[0].toFixed(5)},${last[1].toFixed(5)}-` +
        `${coordinates.length}-` +
        `${assignedDriverCoordinate ? `${assignedDriverCoordinate[0].toFixed(5)},${assignedDriverCoordinate[1].toFixed(5)}` : 'no-driver'}-` +
        `${rideDriver ? 'active' : 'idle'}`;

      if (fittedRouteRef.current === routeIdentity) {
        return;
      }

      const bounds = new mapboxgl.LngLatBounds(first, first);

      coordinates.slice(1).forEach((coordinate) => {
        bounds.extend(coordinate);
      });

      // Directions pode "snapar" o começo da geometria para o centro da rua.
      // Incluímos também as coordenadas exatas dos marcadores para garantir que
      // motorista e embarque permaneçam dentro da área útil do mapa.
      if (assignedDriverCoordinate) bounds.extend(assignedDriverCoordinate);
      if (pickupCoordinate) bounds.extend(pickupCoordinate);

      raiseDriverVehicleLayers(map);

      const padding = mapViewportPadding(map.getContainer(), Boolean(rideDriver));

      map.fitBounds(bounds, {
        padding,
        duration: 520,
        maxZoom: 16.5,
      });

      fittedRouteRef.current = routeIdentity;
    };

    // Tenta imediatamente. Se o style estiver em uma janela transitória de
    // carregamento e a source ainda não existir, o próprio applyRoute agenda
    // nova tentativa; não dependemos de um style.load que pode nunca repetir.
    applyRoute();
    map.on('style.load', applyRoute);

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      map.off('style.load', applyRoute);
    };
  }, [routeCoords, rideDriver, origin]);

  return (
    <div className="absolute inset-0 bg-neutral-900">
      <div ref={containerRef} className="absolute inset-0" />
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
