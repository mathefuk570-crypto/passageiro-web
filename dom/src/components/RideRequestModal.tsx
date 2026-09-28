import React from 'react';
import { useEffect, useState } from 'react';
import { ArrowLeft, Tag, Loader2, Check, Zap, Route, ShieldCheck, Banknote, QrCode, Clock3, Navigation2, ChevronDown, ChevronUp } from 'lucide-react';
import type { Address, Category } from '../lib/types';
import {
  formatBRL,
  getPriceBreakdown,
  priceFor,
  type CategoryOption,
} from '../lib/categories';
import {
  getDirections,
  getDirectionsWithStops,
  getCityFromCoordinates,
  haversineKm,
} from '../lib/mapbox';
import { supabase } from '../lib/supabase';

export interface RideRequestPayload {
  cityId: string;
  category: Category;
  categoryId: string;
  amount: number;
  finalAmount: number;
  distanceKm: number;
  durationMinutes: number;
  directDistanceKm: number;
  directDurationMinutes: number;
  stops: Address[];
  paymentMethod: string;
  couponCode: string | null;
  discount: number;
  pricing: {
    basePrice: number;
    pricePerKm: number;
    pricePerMinute: number;
    minimumFare: number;
    waitingFeePerMinute: number;
    freeWaitingMinutes: number;
    multiplier: number;
    stopsEnabled: boolean;
    maxStops: number;
    stopPricingMode: 'route' | 'fixed';
    fixedStopFee: number;
  };
}

interface Props {
  origin: Address | null;
  destination: Address | null;
  stops: Address[];
  onClose: () => void;
  onConfirm: (payload: RideRequestPayload) => Promise<boolean>;
}

interface PricingCategory {
  id: string;
  name: string;
  icon_name: string | null;
  icon_url: string | null;
  display_order: number | string | null;
  active: boolean;
}

interface PricingRow {
  id: string;
  base_price: number | string | null;
  price_per_km: number | string | null;
  price_per_minute: number | string | null;
  minimum_fare: number | string | null;
  waiting_fee_per_minute: number | string | null;
  free_waiting_minutes: number | string | null;
  cancellation_fee: number | string | null;
  scheduled_ride_fee: number | string | null;
  dynamic_multiplier: number | string | null;
  stops_enabled: boolean | null;
  max_stops: number | string | null;
  stop_pricing_mode: string | null;
  fixed_stop_fee: number | string | null;
  active: boolean;
  categories: PricingCategory | PricingCategory[] | null;
}

interface SurgePricingRule {
  id: string;
  category_id: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  radius_km: number | string | null;
  multiplier: number | string;
  starts_at: string;
  ends_at: string;
  active: boolean;
}

function numberOrZero(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSurgeMultiplier(
  rules: SurgePricingRule[],
  categoryId: string,
  originCoordinates: [number, number] | undefined,
): number {
  const now = Date.now();

  const matchingRules = rules.filter((rule) => {
    if (!rule.active) return false;

    const startsAt = new Date(rule.starts_at).getTime();
    const endsAt = new Date(rule.ends_at).getTime();
    if (now < startsAt || now > endsAt) return false;

    if (rule.category_id && rule.category_id !== categoryId) {
      return false;
    }

    const latitude = rule.latitude === null ? null : Number(rule.latitude);
    const longitude = rule.longitude === null ? null : Number(rule.longitude);
    const radiusKm = rule.radius_km === null ? null : Number(rule.radius_km);

    const hasLocationRule =
      latitude !== null &&
      Number.isFinite(latitude) &&
      longitude !== null &&
      Number.isFinite(longitude) &&
      radiusKm !== null &&
      Number.isFinite(radiusKm) &&
      radiusKm > 0;

    if (!hasLocationRule) return true;
    if (!originCoordinates) return false;

    return (
      haversineKm(originCoordinates, [longitude, latitude]) <= radiusKm
    );
  });

  if (matchingRules.length === 0) return 1;

  return Math.max(
    1,
    ...matchingRules.map((rule) => numberOrZero(rule.multiplier)),
  );
}

export default function RideRequestModal({
  origin,
  destination,
  stops,
  onClose,
  onConfirm,
}: Props) {
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [directDistanceKm, setDirectDistanceKm] = useState<number | null>(null);
  const [directDurationMinutes, setDirectDurationMinutes] = useState<number | null>(null);
  const [cityId, setCityId] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [selectedCategory, setSelectedCategory] =
    useState<CategoryOption | null>(null);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('Dinheiro');
  const [couponInput, setCouponInput] = useState('');
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      if (!origin?.coordinates) {
        setCityId(null);
        setCategories([]);
        setSelectedCategory(null);
        setCategoriesError(null);
        setLoadingCategories(false);
        return;
      }

      setLoadingCategories(true);
      setCategoriesError(null);
      setCityId(null);
      setCategories([]);
      setSelectedCategory(null);

      try {
        const [lng, lat] = origin.coordinates;
        const detectedLocation = await getCityFromCoordinates(lng, lat);
        if (cancelled) return;

        if (!detectedLocation) {
          setCategoriesError(
            'Não foi possível identificar a cidade do endereço de origem.',
          );
          return;
        }

        const { data: matchingCity, error: cityError } = await supabase
          .from('cities')
          .select('id, name, state, active')
          .ilike('name', detectedLocation.city.trim())
          .eq('state', detectedLocation.state.trim().toUpperCase())
          .eq('active', true)
          .maybeSingle();

        if (cityError) throw cityError;
        if (cancelled) return;

        if (!matchingCity) {
          setCategoriesError(
            `A TUM ainda não está disponível em ${detectedLocation.city} - ${detectedLocation.state}.`,
          );
          return;
        }

        setCityId(matchingCity.id);

        const nowIso = new Date().toISOString();
        const [pricingResponse, surgeResponse] = await Promise.all([
          supabase
            .from('category_pricing')
            .select(`
              id,
              base_price,
              price_per_km,
              price_per_minute,
              minimum_fare,
              waiting_fee_per_minute,
              free_waiting_minutes,
              cancellation_fee,
              scheduled_ride_fee,
              dynamic_multiplier,
              stops_enabled,
              max_stops,
              stop_pricing_mode,
              fixed_stop_fee,
              active,
              categories!inner (
                id,
                name,
                icon_name,
                icon_url,
                display_order,
                active
              )
            `)
            .eq('city_id', matchingCity.id)
            .eq('active', true)
            .eq('categories.active', true),
          supabase
            .from('surge_pricing_rules')
            .select(`
              id,
              category_id,
              latitude,
              longitude,
              radius_km,
              multiplier,
              starts_at,
              ends_at,
              active
            `)
            .eq('city_id', matchingCity.id)
            .eq('active', true)
            .lte('starts_at', nowIso)
            .gte('ends_at', nowIso),
        ]);

        if (pricingResponse.error) throw pricingResponse.error;
        if (surgeResponse.error) {
          console.error('Erro ao carregar tarifa dinâmica:', surgeResponse.error);
        }
        if (cancelled) return;

        const pricingRows = (pricingResponse.data ?? []) as unknown as PricingRow[];
        const surgeRules = (surgeResponse.data ?? []) as SurgePricingRule[];

        const loadedCategories = pricingRows
          .map((item): CategoryOption | null => {
            const category = Array.isArray(item.categories)
              ? item.categories[0]
              : item.categories;

            if (!category) return null;

            return {
              id: category.id,
              name: category.name,
              icon_name: category.icon_name,
              icon_url: category.icon_url,
              display_order: Math.max(1, numberOrZero(category.display_order) || 999),
              base_price: numberOrZero(item.base_price),
              price_per_km: numberOrZero(item.price_per_km),
              price_per_minute: numberOrZero(item.price_per_minute),
              minimum_fare: numberOrZero(item.minimum_fare),
              waiting_fee_per_minute: numberOrZero(
                item.waiting_fee_per_minute,
              ),
              free_waiting_minutes: numberOrZero(item.free_waiting_minutes),
              cancellation_fee: numberOrZero(item.cancellation_fee),
              scheduled_ride_fee: numberOrZero(item.scheduled_ride_fee),
              stops_enabled: item.stops_enabled !== false,
              max_stops: Math.max(0, Math.floor(numberOrZero(item.max_stops))),
              stop_pricing_mode: item.stop_pricing_mode === 'fixed' ? 'fixed' : 'route',
              fixed_stop_fee: numberOrZero(item.fixed_stop_fee),
              dynamic_multiplier: Math.max(
                numberOrZero(item.dynamic_multiplier),
                1,
              ),
              surge_multiplier: getSurgeMultiplier(
                surgeRules,
                category.id,
                origin.coordinates,
              ),
              active: item.active && category.active,
            };
          })
          .filter((item): item is CategoryOption => item !== null)
          .sort((first, second) => {
            const orderDifference = first.display_order - second.display_order;

            if (orderDifference !== 0) {
              return orderDifference;
            }

            return first.name.localeCompare(second.name, 'pt-BR');
          });

        if (loadedCategories.length === 0) {
          setCategoriesError(
            'Nenhuma categoria ativa foi configurada para esta cidade.',
          );
          return;
        }

        setCategories(loadedCategories);
        const compatibleCategories = loadedCategories.filter(
          (item) =>
            stops.length === 0 ||
            (item.stops_enabled && stops.length <= item.max_stops),
        );
        // A ordem/prioridade vem do display_order configurado no painel ADM.
        // A primeira categoria compatível também é a seleção padrão.
        setSelectedCategory(compatibleCategories[0] ?? null);
      } catch (caughtError) {
        console.error('Erro ao carregar categorias:', caughtError);
        if (!cancelled) {
          setCategoriesError(
            'Não foi possível carregar as categorias desta cidade.',
          );
        }
      } finally {
        if (!cancelled) setLoadingCategories(false);
      }
    }

    void loadCategories();
    return () => {
      cancelled = true;
    };
  }, [origin, stops.length]);

  useEffect(() => {
    let cancelled = false;

    if (!origin?.coordinates || !destination?.coordinates) {
      setDistanceKm(null);
      setDurationMinutes(null);
      setDirectDistanceKm(null);
      setDirectDurationMinutes(null);
      return;
    }

    async function loadRoute() {
      const stopCoordinates = stops.map((stop) => stop.coordinates);
      const [result, directResult] = await Promise.all([
        getDirectionsWithStops(
          origin!.coordinates,
          stopCoordinates,
          destination!.coordinates,
        ),
        stops.length > 0
          ? getDirections(origin!.coordinates, destination!.coordinates)
          : Promise.resolve(null),
      ]);

      if (cancelled) return;

      setDistanceKm(result ? result.distance / 1000 : null);
      setDurationMinutes(result ? result.duration / 60 : null);
      setDirectDistanceKm(
        stops.length > 0
          ? directResult
            ? directResult.distance / 1000
            : null
          : result
            ? result.distance / 1000
            : null,
      );
      setDirectDurationMinutes(
        stops.length > 0
          ? directResult
            ? directResult.duration / 60
            : null
          : result
            ? result.duration / 60
            : null,
      );
    }

    void loadRoute();
    return () => {
      cancelled = true;
    };
  }, [origin, destination, stops]);

  const selectedCategorySupportsStops =
    !selectedCategory ||
    stops.length === 0 ||
    (selectedCategory.stops_enabled && stops.length <= selectedCategory.max_stops);

  const pricingDistanceKm =
    selectedCategory?.stop_pricing_mode === 'fixed' && stops.length > 0
      ? directDistanceKm
      : distanceKm;
  const pricingDurationMinutes =
    selectedCategory?.stop_pricing_mode === 'fixed' && stops.length > 0
      ? directDurationMinutes
      : durationMinutes;

  const priceBreakdown =
    pricingDistanceKm !== null &&
    pricingDurationMinutes !== null &&
    selectedCategory &&
    selectedCategorySupportsStops
      ? getPriceBreakdown(
          selectedCategory,
          pricingDistanceKm,
          pricingDurationMinutes,
        )
      : null;

  const fixedStopsFee =
    selectedCategory?.stop_pricing_mode === 'fixed' && stops.length > 0
      ? stops.length * selectedCategory.fixed_stop_fee
      : 0;

  const estimatedAmount = (priceBreakdown?.total ?? 0) + fixedStopsFee;
  const discount = (estimatedAmount * discountPercent) / 100;
  const finalPrice = Math.max(estimatedAmount - discount, 0);

  async function validateCoupon() {
    if (
      !couponInput.trim() ||
      !cityId ||
      !selectedCategory ||
      estimatedAmount <= 0
    ) {
      return;
    }

    setValidating(true);
    setCouponMsg(null);

    try {
      const { data, error } = await supabase.rpc(
        'validate_coupon_tum',
        {
          p_code: couponInput.trim().toUpperCase(),
          p_city_id: cityId,
          p_category_id: selectedCategory.id,
          p_amount: estimatedAmount,
        },
      );

      if (error) throw error;

      const result = data as {
        success?: boolean;
        code?: string;
        discount_amount?: number | string;
        message?: string;
      } | null;

      if (!result?.success || !result.code) {
        setCouponMsg(result?.message ?? 'Cupom inválido ou expirado.');
        setDiscountPercent(0);
        setCouponCode(null);
        return;
      }

      const discountAmount = Number(result.discount_amount ?? 0);
      const equivalentPercent =
        estimatedAmount > 0
          ? Math.min(100, Math.max(0, (discountAmount / estimatedAmount) * 100))
          : 0;

      setDiscountPercent(equivalentPercent);
      setCouponCode(result.code);
      setCouponMsg(result.message ?? 'Cupom aplicado com sucesso!');
    } catch (caughtError) {
      console.error('Erro ao validar cupom:', caughtError);
      setCouponMsg('Erro ao validar cupom.');
      setDiscountPercent(0);
      setCouponCode(null);
    } finally {
      setValidating(false);
    }
  }

  async function confirm() {
    if (
      distanceKm === null ||
      durationMinutes === null ||
      directDistanceKm === null ||
      directDurationMinutes === null ||
      !selectedCategory ||
      !selectedCategorySupportsStops ||
      !cityId
    ) {
      return;
    }

    if (submitting) return;
    setSubmitting(true);

    try {
      const ok = await onConfirm({
        cityId,
        category: selectedCategory.name as Category,
        categoryId: selectedCategory.id,
        amount: estimatedAmount,
        finalAmount: finalPrice,
        distanceKm,
        durationMinutes,
        directDistanceKm,
        directDurationMinutes,
        stops,
        paymentMethod,
        couponCode,
        discount,
        pricing: {
          basePrice: selectedCategory.base_price,
          pricePerKm: selectedCategory.price_per_km,
          pricePerMinute: selectedCategory.price_per_minute,
          minimumFare: selectedCategory.minimum_fare,
          waitingFeePerMinute: selectedCategory.waiting_fee_per_minute,
          freeWaitingMinutes: selectedCategory.free_waiting_minutes,
          multiplier:
            selectedCategory.dynamic_multiplier *
            selectedCategory.surge_multiplier,
          stopsEnabled: selectedCategory.stops_enabled,
          maxStops: selectedCategory.max_stops,
          stopPricingMode: selectedCategory.stop_pricing_mode,
          fixedStopFee: selectedCategory.fixed_stop_fee,
        },
      });

      if (!ok) setSubmitting(false);
    } catch (error) {
      console.error('Falha inesperada ao confirmar corrida:', error);
      setSubmitting(false);
    }
  }


  const primaryCategories = categories.slice(0, 2);
  const secondaryCategories = categories.slice(2);

  function categoryUi(item: CategoryOption) {
    const compatible =
      stops.length === 0 ||
      (item.stops_enabled && stops.length <= item.max_stops);
    const itemDistance =
      item.stop_pricing_mode === 'fixed' && stops.length > 0
        ? directDistanceKm
        : distanceKm;
    const itemDuration =
      item.stop_pricing_mode === 'fixed' && stops.length > 0
        ? directDurationMinutes
        : durationMinutes;
    const price =
      itemDistance !== null && itemDuration !== null && compatible
        ? priceFor(item, itemDistance, itemDuration) +
          (item.stop_pricing_mode === 'fixed'
            ? stops.length * item.fixed_stop_fee
            : 0)
        : 0;

    return {
      compatible,
      price,
      active: selectedCategory?.id === item.id,
    };
  }

  function categorySubtitle(name: string) {
    const normalized = name.toLowerCase();
    if (normalized.includes('black')) return 'Conforto premium';
    if (normalized.includes('moto')) return 'Mais ágil no trânsito';
    if (normalized.includes('dela')) return 'De mulher para mulher';
    return 'Boa escolha para o dia a dia';
  }

  return (
    <div className="tum-ride-options absolute inset-x-0 bottom-0 z-40 flex max-h-[88vh] flex-col overflow-hidden rounded-t-[30px] border-t border-white/10 bg-tum-dark-2/[0.98] shadow-[0_-24px_70px_rgba(0,0,0,.42)] backdrop-blur-xl">
      <div className="px-4 pb-2 pt-2">
        <div className="mx-auto mb-2 h-1 w-11 rounded-full bg-white/15" />
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="tum-press flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.045] transition hover:bg-white/[0.08]"
          >
            <ArrowLeft size={17} className="text-white" />
          </button>
          <div className="text-center">
            <p className="text-[9px] font-black uppercase tracking-[0.16em] text-tum-yellow/[0.75]">Sua viagem</p>
            <h2 className="text-[16px] font-black text-white">Opções de corrida</h2>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
            <ShieldCheck size={16} className="text-tum-yellow" />
          </div>
        </div>
      </div>

      <div className="scrollbar-hide overflow-y-auto px-4 pb-3">
        <div className="mb-2 rounded-2xl border border-white/[0.08] bg-black/15 px-3 py-2.5">
          <div className="flex gap-2.5">
            <div className="flex flex-col items-center pt-0.5">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-tum-yellow bg-tum-dark-2" />
              <span className="my-1 h-5 w-px bg-white/15" />
              <Navigation2 size={12} className="text-tum-yellow" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wide text-white/[0.35]">Embarque</p>
                <p className="truncate text-[11px] font-semibold text-white/[0.80]">{origin?.place_name || 'Origem'}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wide text-white/[0.35]">Destino</p>
                <p className="truncate text-[11px] font-semibold text-white/[0.80]">{destination?.place_name || 'Destino'}</p>
              </div>
              {stops.length > 0 && (
                <p className="text-[10px] font-semibold text-tum-yellow/[0.75]">+ {stops.length} parada{stops.length > 1 ? 's' : ''}</p>
              )}
            </div>
            {distanceKm !== null && durationMinutes !== null && (
              <div className="shrink-0 text-right">
                <p className="text-[11px] font-black text-white">{distanceKm.toFixed(1)} km</p>
                <div className="mt-0.5 flex items-center justify-end gap-1 text-[9px] font-semibold text-white/[0.40]"><Clock3 size={10} /> {Math.ceil(durationMinutes)} min</div>
              </div>
            )}
          </div>
        </div>

        {loadingCategories && (
          <div className="space-y-2 py-1">
            <div className="tum-skeleton h-[64px] rounded-2xl" />
            <div className="tum-skeleton h-[64px] rounded-2xl" />
            <div className="grid grid-cols-2 gap-2">
              <div className="tum-skeleton h-[58px] rounded-xl" />
              <div className="tum-skeleton h-[58px] rounded-xl" />
            </div>
            <div className="flex items-center justify-center gap-2 pt-1 text-xs text-white/[0.45]">
              <Loader2 size={14} className="animate-spin text-tum-yellow" />
              Preparando opções...
            </div>
          </div>
        )}

        {categoriesError && (
          <div className="rounded-2xl border border-red-400/25 bg-red-400/10 p-3 text-center">
            <p className="text-sm font-bold text-red-200">Não conseguimos carregar as opções</p>
            <p className="mt-1 text-xs leading-5 text-red-100/60">{categoriesError}</p>
          </div>
        )}

        {!loadingCategories && !categoriesError && categories.length > 0 && (
          <div>
            <div className="mb-1.5 px-0.5">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/[0.38]">Categorias</p>
            </div>

            <div className="space-y-1.5">
              {primaryCategories.map((item, index) => {
                const { compatible, price, active } = categoryUi(item);

                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => compatible && setSelectedCategory(item)}
                    disabled={!compatible}
                    className={`tum-option-enter tum-press relative w-full overflow-hidden rounded-2xl border px-3 py-2 text-left transition ${
                      active
                        ? 'border-tum-yellow/80 bg-tum-yellow/[0.09] shadow-[0_7px_20px_rgba(250,204,21,.07)]'
                        : 'border-white/[0.08] bg-white/[0.035] hover:border-white/15 hover:bg-white/[0.05]'
                    } ${!compatible ? 'cursor-not-allowed opacity-40' : ''}`}
                    style={{ animationDelay: `${Math.min(index * 45, 90)}ms` }}
                  >
                    {active && (
                      <div className="absolute right-2.5 top-2.5 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-tum-yellow text-black shadow-md">
                        <Check size={10} strokeWidth={3.4} />
                      </div>
                    )}
                    <div className="flex min-h-[54px] items-center gap-2.5">
                      <div className="flex h-[52px] w-[78px] shrink-0 items-center justify-center">
                        {item.icon_url ? (
                          <img src={item.icon_url} alt={`Ícone ${item.name}`} loading="lazy" draggable={false} className="h-full w-full select-none object-contain" />
                        ) : <div className="h-full w-full" aria-hidden="true" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2 pr-5">
                          <div className="min-w-0">
                            <span className="block truncate text-[14px] font-black leading-tight text-white">{item.name}</span>
                            <p className="mt-0.5 truncate text-[10px] font-medium text-white/[0.42]">{categorySubtitle(item.name)}</p>
                          </div>
                          <p className="whitespace-nowrap text-[14px] font-black text-tum-yellow">{distanceKm !== null && durationMinutes !== null ? formatBRL(price) : '...'}</p>
                        </div>
                        <div className="mt-1 flex min-h-[14px] items-center gap-1.5">
                          {item.surge_multiplier > 1 && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-orange-300/15 bg-orange-300/10 px-1.5 py-0.5 text-[9px] font-bold text-orange-200">
                              <Zap size={9} /> {item.surge_multiplier.toFixed(2)}x
                            </span>
                          )}
                          {stops.length > 0 && (
                            <span className={`truncate text-[9px] font-semibold ${compatible ? 'text-white/[0.35]' : 'text-red-300'}`}>
                              {compatible
                                ? item.stop_pricing_mode === 'fixed'
                                  ? `${stops.length} parada(s) · ${formatBRL(item.fixed_stop_fee)} cada`
                                  : `${stops.length} parada(s) na rota`
                                : item.stops_enabled ? `Limite: ${item.max_stops}` : 'Não aceita paradas'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {secondaryCategories.length > 0 && (
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {secondaryCategories.map((item, index) => {
                  const { compatible, price, active } = categoryUi(item);

                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => compatible && setSelectedCategory(item)}
                      disabled={!compatible}
                      className={`tum-option-enter tum-press relative min-w-0 overflow-hidden rounded-xl border px-2 py-1.5 text-left transition ${
                        active
                          ? 'border-tum-yellow/80 bg-tum-yellow/[0.09]'
                          : 'border-white/[0.08] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.05]'
                      } ${!compatible ? 'cursor-not-allowed opacity-40' : ''}`}
                      style={{ animationDelay: `${Math.min((index + 2) * 45, 180)}ms` }}
                    >
                      {active && (
                        <div className="absolute right-1.5 top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-tum-yellow text-black">
                          <Check size={9} strokeWidth={3.5} />
                        </div>
                      )}
                      <div className="flex min-h-[48px] items-center gap-1.5">
                        <div className="flex h-10 w-12 shrink-0 items-center justify-center">
                          {item.icon_url ? (
                            <img src={item.icon_url} alt={`Ícone ${item.name}`} loading="lazy" draggable={false} className="h-full w-full select-none object-contain" />
                          ) : <div className="h-full w-full" aria-hidden="true" />}
                        </div>
                        <div className="min-w-0 flex-1 pr-2">
                          <span className="block truncate text-[11px] font-black leading-tight text-white">{item.name}</span>
                          <span className="mt-0.5 block truncate text-[11px] font-black text-tum-yellow">{distanceKm !== null && durationMinutes !== null ? formatBRL(price) : '...'}</span>
                          {item.surge_multiplier > 1 && (
                            <span className="mt-0.5 inline-flex items-center gap-0.5 text-[8px] font-bold text-orange-200"><Zap size={8} />{item.surge_multiplier.toFixed(2)}x</span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="mt-2.5">
          <p className="mb-1.5 px-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-white/[0.38]">Forma de pagamento</p>
          <div className="grid grid-cols-2 gap-1.5">
            {[{ name: 'Dinheiro', icon: Banknote }, { name: 'Pix', icon: QrCode }].map(({ name, icon: Icon }) => (
              <button
                type="button"
                key={name}
                onClick={() => setPaymentMethod(name)}
                className={`tum-press flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[12px] font-black transition ${paymentMethod === name ? 'border-tum-yellow/70 bg-tum-yellow/10 text-tum-yellow' : 'border-white/[0.08] bg-white/[0.035] text-white/[0.60]'}`}
              >
                <Icon size={15} /> {name}
                {paymentMethod === name && <Check size={12} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowMoreDetails((current) => !current)}
          className="tum-press mt-2 flex w-full items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-left transition hover:bg-white/[0.045]"
        >
          <span>
            <span className="block text-[11px] font-black text-white/[0.72]">{showMoreDetails ? 'Ocultar detalhes' : 'Mais detalhes'}</span>
            <span className="block text-[9px] font-semibold text-white/[0.30]">Cupom, distância, tempo e resumo da tarifa</span>
          </span>
          {showMoreDetails ? <ChevronUp size={16} className="text-tum-yellow" /> : <ChevronDown size={16} className="text-tum-yellow" />}
        </button>

        {showMoreDetails && (
          <div className="pb-1">
            <div className="mt-2 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
              <div className="mb-2 flex items-center gap-2">
                <Tag size={15} className="text-tum-yellow" />
                <p className="text-xs font-bold text-white/[0.70]">Tem cupom?</p>
              </div>
              <div className="flex gap-2">
                <input
                  value={couponInput}
                  onChange={(event) => setCouponInput(event.target.value)}
                  placeholder="Digite o código"
                  className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-black/15 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/[0.25] focus:border-tum-yellow/40"
                />
                <button
                  type="button"
                  onClick={validateCoupon}
                  disabled={validating}
                  className="tum-press min-w-[82px] rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 py-2 text-xs font-black text-white/[0.75] transition disabled:opacity-50"
                >
                  {validating ? <Loader2 size={16} className="mx-auto animate-spin" /> : 'Aplicar'}
                </button>
              </div>
              {couponMsg && <p className={`mt-2 text-[11px] font-semibold ${couponCode ? 'text-emerald-400' : 'text-red-300'}`}>{couponMsg}</p>}
            </div>

            {priceBreakdown && (
              <div className="mt-2 rounded-2xl border border-white/[0.08] bg-black/15 p-3 text-sm">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-white/[0.40]">Resumo</p>
                  <Route size={15} className="text-tum-yellow/[0.70]" />
                </div>
                <div className="space-y-1.5 text-[12px]">
                  <div className="flex justify-between text-white/[0.55]"><span>Distância estimada</span><span className="font-semibold text-white/[0.75]">{distanceKm?.toFixed(1)} km</span></div>
                  <div className="flex justify-between text-white/[0.55]"><span>Tempo estimado</span><span className="font-semibold text-white/[0.75]">{Math.ceil(durationMinutes ?? 0)} min</span></div>
                  {stops.length > 0 && <div className="flex justify-between text-white/[0.55]"><span>{stops.length} parada{stops.length > 1 ? 's' : ''}</span><span className="font-semibold text-white/[0.75]">{selectedCategory?.stop_pricing_mode === 'fixed' ? `+ ${formatBRL(fixedStopsFee)}` : 'na rota'}</span></div>}
                  {discount > 0 && <div className="flex justify-between text-emerald-400"><span>Desconto</span><span className="font-bold">-{formatBRL(discount)}</span></div>}
                </div>
                <div className="mt-2 flex items-end justify-between border-t border-white/[0.08] pt-2">
                  <div><p className="text-xs text-white/[0.40]">Total estimado</p><p className="text-[10px] text-white/[0.28]">Pode variar com o trajeto real</p></div>
                  <span className="text-lg font-black text-tum-yellow">{formatBRL(finalPrice)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-white/[0.08] bg-tum-dark-2/[0.98] px-4 pb-3 pt-2.5">
        <button
          type="button"
          onClick={confirm}
          disabled={
            distanceKm === null || durationMinutes === null || directDistanceKm === null || directDurationMinutes === null || !selectedCategory || !selectedCategorySupportsStops || !cityId || loadingCategories || submitting
          }
          className="tum-primary-cta tum-press flex w-full items-center justify-between rounded-2xl bg-tum-yellow px-4 py-3 text-black shadow-[0_10px_28px_rgba(250,204,21,.16)] transition hover:bg-tum-yellow-dark disabled:shadow-none disabled:opacity-50"
        >
          <span className="text-left">
            <span className="block text-sm font-black leading-tight">{submitting ? 'Solicitando corrida...' : `Confirmar ${selectedCategory?.name ?? 'corrida'}`}</span>
            <span className="block text-[10px] font-semibold text-black/55">{paymentMethod}{couponCode ? ` · Cupom ${couponCode}` : ''}</span>
          </span>
          <span className="text-base font-black">{submitting ? <Loader2 size={18} className="animate-spin" /> : priceBreakdown ? formatBRL(finalPrice) : '...'}</span>
        </button>
      </div>
    </div>
  );
}
