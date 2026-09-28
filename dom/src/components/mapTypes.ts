import type { DriverLocation } from '../lib/types';

export type Coordinate = [number, number];

export type MapPoiSelection = {
  name: string;
  address: string | null;
  category: string | null;
  openingHours: string | null;
  coordinates: Coordinate;
};

export type MapController = {
  flyTo(options: {
    center: Coordinate;
    zoom?: number;
    duration?: number;
  }): void;
};

export interface MapViewProps {
  cityId?: string | null;
  origin: Coordinate | null;
  destination: Coordinate | null;
  stops?: Coordinate[];
  drivers: DriverLocation[];
  rideDriver: DriverLocation | null;
  routeCoords: Coordinate[] | null;
  queuedCurrentRouteCoords?: Coordinate[] | null;
  queuedNextRouteCoords?: Coordinate[] | null;
  queuedCurrentDestination?: Coordinate | null;
  onMapClick?: (lng: number, lat: number) => void;
  onPoiSelect?: (poi: MapPoiSelection) => void;
  onLocationDragSelect?: (poi: MapPoiSelection) => void;
  registerMap?: (map: MapController) => void;
}
