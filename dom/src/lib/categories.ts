export interface CategoryOption {
  id: string;
  name: string;
  icon_name: string | null;
  icon_url: string | null;
  display_order: number;

  base_price: number;
  price_per_km: number;
  price_per_minute: number;
  minimum_fare: number;

  waiting_fee_per_minute: number;
  free_waiting_minutes: number;
  cancellation_fee: number;
  scheduled_ride_fee: number;

  stops_enabled: boolean;
  max_stops: number;
  stop_pricing_mode: 'route' | 'fixed';
  fixed_stop_fee: number;

  dynamic_multiplier: number;
  surge_multiplier: number;

  active: boolean;
}

export interface PriceBreakdown {
  basePrice: number;
  distancePrice: number;
  timePrice: number;

  categoryMultiplier: number;
  surgeMultiplier: number;

  subtotal: number;
  priceBeforeMinimum: number;

  minimumFare: number;
  minimumApplied: boolean;

  total: number;
}

function safeNumber(
  value: number | string | null | undefined,
  fallback = 0,
): number {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getPriceBreakdown(
  category: CategoryOption,
  distanceKm: number,
  durationMinutes: number,
): PriceBreakdown {
  const basePrice = safeNumber(
    category.base_price,
  );

  const distancePrice =
    distanceKm *
    safeNumber(
      category.price_per_km,
    );

  const timePrice =
    durationMinutes *
    safeNumber(
      category.price_per_minute,
    );

  const categoryMultiplier =
    Math.max(
      safeNumber(
        category.dynamic_multiplier,
        1,
      ),
      1,
    );

  const surgeMultiplier =
    Math.max(
      safeNumber(
        category.surge_multiplier,
        1,
      ),
      1,
    );

  const minimumFare =
    Math.max(
      safeNumber(
        category.minimum_fare,
      ),
      0,
    );

  const subtotal =
    basePrice +
    distancePrice +
    timePrice;

  const priceBeforeMinimum =
    subtotal *
    categoryMultiplier *
    surgeMultiplier;

  const minimumApplied =
    priceBeforeMinimum <
    minimumFare;

  const total = Math.max(
    priceBeforeMinimum,
    minimumFare,
  );

  return {
    basePrice:
      roundMoney(basePrice),

    distancePrice:
      roundMoney(distancePrice),

    timePrice:
      roundMoney(timePrice),

    categoryMultiplier,
    surgeMultiplier,

    subtotal:
      roundMoney(subtotal),

    priceBeforeMinimum:
      roundMoney(
        priceBeforeMinimum,
      ),

    minimumFare:
      roundMoney(minimumFare),

    minimumApplied,

    total:
      roundMoney(total),
  };
}

export function priceFor(
  category: CategoryOption,
  distanceKm: number,
  durationMinutes: number,
): number {
  return getPriceBreakdown(
    category,
    distanceKm,
    durationMinutes,
  ).total;
}

export function formatBRL(
  value: number,
): string {
  return value.toLocaleString(
    'pt-BR',
    {
      style: 'currency',
      currency: 'BRL',
    },
  );
}