import React, { useEffect, useState } from 'react';
import { useTumMapConfig } from '../lib/mapConfig';
import { useTheme } from '../hooks/useTheme';
import GoogleMapView from './GoogleMapView';
import RasterMapView from './RasterMapView';
import MapboxMapView from './MapboxMapView';
import type { MapViewProps } from './mapTypes';

export type { MapPoiSelection, MapController, MapViewProps } from './mapTypes';

export default function MapView(props: MapViewProps) {
  const config = useTumMapConfig(props.cityId ?? null);
  const { theme } = useTheme();
  const [googleFailed, setGoogleFailed] = useState(false);

  useEffect(() => {
    setGoogleFailed(false);
  }, [config.config_revision]);

  const googleReady =
    !googleFailed &&
    config.passenger_map_provider === 'google' &&
    config.google_maps_enabled &&
    Boolean(config.google_maps_public_key.trim());

  if (googleReady) {
    const googleKey = [
      'google',
      config.google_maps_public_key,
      config.google_maps_language,
      config.google_maps_region,
      config.google_maps_js_base_url,
    ].join(':');

    return (
      <GoogleMapView
        key={googleKey}
        {...props}
        onProviderError={() => setGoogleFailed(true)}
      />
    );
  }

  const mapboxReady =
    config.passenger_map_provider === 'mapbox' &&
    config.mapbox_enabled &&
    Boolean(config.mapbox_public_token.trim());

  if (mapboxReady) {
    // O Mapbox GL continua sendo o melhor renderer no navegador/iOS. Porém, em
    // Android o app roda dentro de Expo DOM/WebView e alguns aparelhos/emuladores
    // entregam um canvas WebGL permanentemente cinza mesmo quando `supported()`
    // retorna true. Nesse ambiente usamos o renderer raster otimizado: ele não
    // depende de WebGL, usa tiles em alta densidade, POIs progressivos por zoom e
    // também respeita a animação da rota configurada no Painel ADM.
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isAndroid = /Android/i.test(userAgent);

    if (isAndroid) {
      const rasterAndroidKey = [
        'mapbox-raster-android-hidpi',
        config.mapbox_public_token,
        config.passenger_map_style_light,
        config.passenger_map_style_dark,
        theme,
      ].join(':');

      console.info('[TUM][MAP] renderer=raster-android-hidpi');
      return <RasterMapView key={rasterAndroidKey} {...props} />;
    }

    const mapboxKey = [
      'mapbox-gl',
      config.mapbox_public_token,
      config.passenger_map_style_light,
      config.passenger_map_style_dark,
      theme,
    ].join(':');

    console.info('[TUM][MAP] renderer=mapbox-gl');
    return <MapboxMapView key={mapboxKey} {...props} />;
  }

  // Último recurso somente quando nenhum provider vetorial configurado puder ser
  // iniciado. Não é mais o renderer normal do passageiro.
  const rasterKey = [
    'mapbox-raster-emergency',
    config.mapbox_public_token,
    config.passenger_map_style_light,
    config.passenger_map_style_dark,
    theme,
  ].join(':');

  console.warn('[TUM][MAP] renderer=raster-emergency');
  return <RasterMapView key={rasterKey} {...props} />;
}
