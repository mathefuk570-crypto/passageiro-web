import React, { useEffect, useState } from 'react';
import { useTumMapConfig } from '../lib/mapConfig';
import { useTheme } from '../hooks/useTheme';
import MapboxMapView from './MapboxMapView';
import GoogleMapView from './GoogleMapView';
import type { MapViewProps } from './mapTypes';

export type { MapPoiSelection, MapController, MapViewProps } from './mapTypes';

export default function MapView(props: MapViewProps) {
  const config = useTumMapConfig(props.cityId ?? null);
  const { theme } = useTheme();
  const [googleFailed, setGoogleFailed] = useState(false);

  useEffect(() => {
    // Uma nova revisão salva no painel ganha uma nova tentativa. Se a chave ou
    // API do Google falhar, o passageiro não fica numa tela cinza: continua no
    // Mapbox e só tenta o Google novamente após uma configuração nova.
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

  // Mudança de provedor/chave/estilo do Painel ADM recria o mapa de forma limpa.
  // Evita trocar o style inteiro em cima de uma instância Mapbox já renderizada,
  // que em alguns Android WebViews deixava o canvas cinza após 1-2 segundos.
  const mapboxKey = [
    'mapbox',
    config.mapbox_public_token,
    config.passenger_map_style_light,
    config.passenger_map_style_dark,
    theme,
  ].join(':');

  return <MapboxMapView key={mapboxKey} {...props} />;
}
