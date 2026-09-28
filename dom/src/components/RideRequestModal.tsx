import React from 'react';
import { useEffect, useState } from 'react';
import { ArrowLeft, Tag, Loader2, Check, Zap, Route, ShieldCheck, Banknote, QrCode, Clock3, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';
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
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [panelStep, setPanelStep] = useState<'category' | 'payment'>('category');
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
        setPaymentMethod(null);
        setPanelStep('category');
        setCategoriesError(null);
        setLoadingCategories(false);
        return;
      }

      setLoadingCategories(true);
      setCategoriesError(null);
      setCityId(null);
      setCategories([]);
      setSelectedCategory(null);
      setPaymentMethod(null);
      setPanelStep('category');

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
        // A ordem/prioridade continua vindo do display_order configurado no painel ADM,
        // mas a categoria não fica mais pré-selecionada para o passageiro escolher de forma explícita.
        setSelectedCategory(null);
        setPaymentMethod(null);
        setPanelStep('category');
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
      !cityId ||
      !paymentMethod
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

  function compactAddress(value: string | undefined, fallback: string): string {
    const clean = String(value || '').trim();
    if (!clean) return fallback;
    const firstPart = clean.split(',')[0]?.trim();
    return firstPart || clean;
  }

  function getCategorySubtitle(name: string): string {
    const normalized = name.toLowerCase();

    if (normalized.includes('pop')) return 'Boa escolha para o dia a dia';
    if (normalized.includes('mo')) return 'Mais agilidade pra você';
    if (normalized.includes('dela')) return 'Viagens feitas para elas';
    if (normalized.includes('black')) return 'Mais conforto em cada viagem';

    return 'Escolha uma opção para continuar';
  }

  const paymentOptions = [
    {
      name: 'Dinheiro',
      icon: Banknote,
      description: 'Pague ao motorista quando a corrida terminar',
    },
    {
      name: 'Pix',
      icon: QrCode,
      description: 'O Pix é disponibilizado ao final da corrida',
    },
  ] as const;


  return (
    <div className="tum-ride-options absolute inset-x-0 bottom-0 z-40 flex max-h-[88vh] flex-col overflow-hidden rounded-t-[30px] border-t border-white/10 bg-tum-dark-2/[0.98] shadow-[0_-24px_70px_rgba(0,0,0,.42)] backdrop-blur-xl">
      <div className="px-4 pb-2 pt-2">
        <div className="mx-auto mb-2 h-1 w-11 rounded-full bg-white/15" />
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              if (panelStep === 'payment') {
                setPanelStep('category');
                return;
              }
              onClose();
            }}
            className="tum-press flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition hover:bg-white/10"
          >
            <ArrowLeft size={17} className="text-white" />
          </button>

          <div className="text-center">
            <p className="text-[9px] font-black uppercase tracking-[0.16em] text-tum-yellow/80">Sua viagem</p>
            <h2 className="text-[16px] font-black text-white">
              {panelStep === 'payment' ? 'Forma de pagamento' : 'Opções de corrida'}
            </h2>
          </div>

          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5">
            <ShieldCheck size={16} className="text-tum-yellow" />
          </div>
        </div>
      </div>

      <div className="scrollbar-hide overflow-y-auto px-4 pb-3">
        {panelStep === 'category' ? (
          <>
            <div className="mb-2.5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tum-yellow/10 text-tum-yellow">
                <Route size={17} strokeWidth={2.5} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-white/80">
                  <span className="truncate">{compactAddress(origin?.place_name, 'Origem')}</span>
                  <span className="shrink-0 text-tum-yellow">→</span>
                  <span className="truncate">{compactAddress(destination?.place_name, 'Destino')}</span>
                </div>
                <p className="mt-1 text-[10px] font-semibold text-white/40">
                  {stops.length > 0 ? `${stops.length} parada${stops.length > 1 ? 's' : ''} · ` : ''}
                  Tempo e distância estimados
                </p>
              </div>
              {distanceKm !== null && durationMinutes !== null && (
                <div className="shrink-0 text-right">
                  <div className="flex items-center justify-end gap-1 text-[14px] font-black text-white">
                    <Clock3 size={13} className="text-tum-yellow" />
                    {Math.ceil(durationMinutes)} min
                  </div>
                  <p className="mt-0.5 text-[10px] font-bold text-white/40">{distanceKm.toFixed(1)} km</p>
                </div>
              )}
            </div>

            {loadingCategories && (
              <div className="space-y-2 py-1">
                <div className="tum-skeleton h-[88px] rounded-[24px]" />
                <div className="tum-skeleton h-[88px] rounded-[24px]" />
                <div className="tum-skeleton h-[88px] rounded-[24px]" />
                <div className="flex items-center justify-center gap-2 pt-1 text-xs text-white/45">
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
                <div className="mb-2 flex items-center justify-between px-0.5">
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/40">Escolha sua categoria</p>
                  <span className="text-[9px] font-semibold text-white/35">Preço estimado</span>
                </div>

                <div className="space-y-2">
                  {categories.map((item, index) => {
                    const { compatible, price, active } = categoryUi(item);

                    return (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => {
                          if (!compatible) return;
                          const changingCategory = selectedCategory?.id !== item.id;
                          setSelectedCategory(item);
                          if (changingCategory) {
                            setPaymentMethod(null);
                            setPanelStep('category');
                          }
                        }}
                        disabled={!compatible}
                        className={`tum-option-enter tum-press relative w-full overflow-hidden rounded-[24px] border px-3.5 py-3 text-left transition ${
                          active
                            ? 'border-tum-yellow/80 bg-tum-yellow/[0.08] shadow-[0_10px_28px_rgba(250,204,21,.09)]'
                            : 'border-white/10 bg-white/[0.04] hover:border-white/15 hover:bg-white/[0.08]'
                        } ${!compatible ? 'cursor-not-allowed opacity-45' : ''}`}
                        style={{ animationDelay: `${Math.min(index * 45, 180)}ms` }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-[62px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-black/10">
                            {item.icon_url ? (
                              <img
                                src={item.icon_url}
                                alt={`Ícone ${item.name}`}
                                loading="lazy"
                                draggable={false}
                                className="h-full w-full select-none object-contain"
                              />
                            ) : (
                              <div className="h-full w-full" aria-hidden="true" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-[17px] font-black leading-tight text-white">{item.name}</p>
                                <p className="mt-1 text-[12px] font-medium leading-4 text-white/55">
                                  {getCategorySubtitle(item.name)}
                                </p>
                                {!compatible ? (
                                  <span className="mt-1.5 block text-[10px] font-bold text-red-300">Não aceita estas paradas</span>
                                ) : item.surge_multiplier > 1 ? (
                                  <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-orange-300/20 bg-orange-300/10 px-2 py-1 text-[9px] font-bold text-orange-100">
                                    <Zap size={10} /> tarifa dinâmica {item.surge_multiplier.toFixed(2)}x
                                  </span>
                                ) : null}
                              </div>

                              <div className="shrink-0 text-right">
                                <p className={`text-[16px] font-black leading-none ${active ? 'text-tum-yellow' : 'text-white'}`}>
                                  {distanceKm !== null && durationMinutes !== null ? formatBRL(price) : '...'}
                                </p>
                                <div className={`ml-auto mt-3 flex h-7 w-7 items-center justify-center rounded-full border transition ${
                                  active
                                    ? 'border-tum-yellow bg-tum-yellow text-black'
                                    : 'border-white/15 bg-white/[0.04] text-white/55'
                                }`}>
                                  {active ? <Check size={14} strokeWidth={3.2} /> : <ChevronRight size={14} strokeWidth={2.7} />}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowMoreDetails((current) => !current)}
              className="tum-press mt-2 flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left transition hover:bg-white/10"
            >
              <span>
                <span className="block text-[11px] font-black text-white/70">{showMoreDetails ? 'Ocultar detalhes' : 'Mais detalhes'}</span>
                <span className="block text-[9px] font-semibold text-white/35">Cupom, distância, tempo e resumo da tarifa</span>
              </span>
              {showMoreDetails ? <ChevronUp size={16} className="text-tum-yellow" /> : <ChevronDown size={16} className="text-tum-yellow" />}
            </button>

            {showMoreDetails && (
              <div className="pb-1">
                <div className="mt-2 rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Tag size={15} className="text-tum-yellow" />
                    <p className="text-xs font-bold text-white/70">Tem cupom?</p>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={couponInput}
                      onChange={(event) => setCouponInput(event.target.value)}
                      placeholder="Digite o código"
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/10 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/25 focus:border-tum-yellow/40"
                    />
                    <button
                      type="button"
                      onClick={validateCoupon}
                      disabled={validating}
                      className="tum-press min-w-[82px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-white/75 transition disabled:opacity-50"
                    >
                      {validating ? <Loader2 size={16} className="mx-auto animate-spin" /> : 'Aplicar'}
                    </button>
                  </div>
                  {couponMsg && <p className={`mt-2 text-[11px] font-semibold ${couponCode ? 'text-emerald-400' : 'text-red-300'}`}>{couponMsg}</p>}
                </div>

                {priceBreakdown && (
                  <div className="mt-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-black uppercase tracking-[0.12em] text-white/40">Resumo</p>
                      <Route size={15} className="text-tum-yellow/70" />
                    </div>
                    <div className="space-y-1.5 text-[12px]">
                      <div className="flex justify-between text-white/55"><span>Distância estimada</span><span className="font-semibold text-white/75">{distanceKm?.toFixed(1)} km</span></div>
                      <div className="flex justify-between text-white/55"><span>Tempo estimado</span><span className="font-semibold text-white/75">{Math.ceil(durationMinutes ?? 0)} min</span></div>
                      {stops.length > 0 && <div className="flex justify-between text-white/55"><span>{stops.length} parada{stops.length > 1 ? 's' : ''}</span><span className="font-semibold text-white/75">{selectedCategory?.stop_pricing_mode === 'fixed' ? `+ ${formatBRL(fixedStopsFee)}` : 'na rota'}</span></div>}
                      {discount > 0 && <div className="flex justify-between text-emerald-400"><span>Desconto</span><span className="font-bold">-{formatBRL(discount)}</span></div>}
                    </div>
                    <div className="mt-2 flex items-end justify-between border-t border-white/10 pt-2">
                      <div><p className="text-xs text-white/40">Total estimado</p><p className="text-[10px] text-white/30">Pode variar com o trajeto real</p></div>
                      <span className="text-lg font-black text-tum-yellow">{formatBRL(finalPrice)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {selectedCategory && (
              <div className="mb-4 overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.04]">
                <div className="flex items-center gap-3 p-4">
                  <div className="flex h-[82px] w-[112px] shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-black/10">
                    {selectedCategory.icon_url ? (
                      <img
                        src={selectedCategory.icon_url}
                        alt={`Ícone ${selectedCategory.name}`}
                        draggable={false}
                        className="h-full w-full select-none object-contain"
                      />
                    ) : (
                      <div className="h-full w-full" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/38">Preço estimado</p>
                    <p className="mt-1 text-[28px] font-black leading-none text-tum-yellow">{formatBRL(finalPrice)}</p>
                    <p className="mt-2 text-[11px] font-semibold text-white/45">{selectedCategory.name} · sujeito a variação</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 border-t border-white/10">
                  <div className="flex items-center justify-center gap-2 border-r border-white/10 px-3 py-3">
                    <Route size={16} className="text-tum-yellow" />
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-white/35">Distância</p>
                      <p className="text-[13px] font-black text-white">{distanceKm?.toFixed(1) ?? '--'} km</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-2 px-3 py-3">
                    <Clock3 size={16} className="text-tum-yellow" />
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-white/35">Tempo estimado</p>
                      <p className="text-[13px] font-black text-white">{durationMinutes !== null ? `${Math.ceil(durationMinutes)} min` : '--'}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="mb-2 px-0.5">
              <p className="text-[18px] font-black text-white">Como você prefere pagar?</p>
              <p className="mt-1 text-[11px] font-medium text-white/45">Escolha agora. O pagamento acontece somente no final da corrida.</p>
            </div>

            <div className="space-y-2">
              {paymentOptions.map(({ name, icon: Icon, description }) => {
                const active = paymentMethod === name;
                return (
                  <button
                    type="button"
                    key={name}
                    onClick={() => setPaymentMethod(name)}
                    className={`tum-press flex w-full items-center gap-3 rounded-[22px] border px-3.5 py-3 text-left transition ${
                      active
                        ? 'border-tum-yellow/80 bg-tum-yellow/[0.08] shadow-[0_10px_28px_rgba(250,204,21,.08)]'
                        : 'border-white/10 bg-white/[0.04] hover:border-white/15 hover:bg-white/[0.08]'
                    }`}
                  >
                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${active ? 'bg-tum-yellow text-black' : 'bg-white/[0.06] text-white/65'}`}>
                      <Icon size={20} strokeWidth={2.3} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[15px] font-black ${active ? 'text-tum-yellow' : 'text-white'}`}>{name}</p>
                      <p className="mt-0.5 text-[11px] font-medium leading-4 text-white/45">{description}</p>
                    </div>
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition ${
                      active
                        ? 'border-tum-yellow bg-tum-yellow text-black'
                        : 'border-white/15 bg-white/[0.04] text-white/45'
                    }`}>
                      {active ? <Check size={14} strokeWidth={3.2} /> : <ChevronRight size={14} strokeWidth={2.7} />}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.035] px-3.5 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.1em] text-white/35">Pagamento no final</p>
              <p className="mt-1 text-[11px] font-medium leading-4 text-white/50">
                A forma escolhida fica vinculada a esta corrida. Nenhuma cobrança é feita antes da viagem terminar.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="border-t border-white/10 bg-tum-dark-2/[0.98] px-4 pb-3 pt-2.5">
        {panelStep === 'category' ? (
          <button
            type="button"
            onClick={() => {
              if (!selectedCategory) return;
              setPanelStep('payment');
            }}
            disabled={
              distanceKm === null || durationMinutes === null || directDistanceKm === null || directDurationMinutes === null || !selectedCategory || !selectedCategorySupportsStops || !cityId || loadingCategories
            }
            className="tum-primary-cta tum-press flex w-full items-center justify-between rounded-2xl bg-tum-yellow px-4 py-3 text-black shadow-[0_10px_28px_rgba(250,204,21,.16)] transition hover:bg-tum-yellow-dark disabled:shadow-none disabled:opacity-50"
          >
            <span className="text-left">
              <span className="block text-sm font-black leading-tight">
                {selectedCategory ? 'Selecionar método de pagamento' : 'Escolha uma categoria'}
              </span>
              <span className="block text-[10px] font-semibold text-black/60">
                {selectedCategory ? `${selectedCategory.name} selecionado` : 'Selecione uma categoria para continuar'}
              </span>
            </span>
            <span className="flex items-center gap-2 text-base font-black">
              {priceBreakdown ? formatBRL(finalPrice) : '...'}
              <ChevronRight size={18} strokeWidth={3} />
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!paymentMethod || submitting}
            className="tum-primary-cta tum-press flex w-full items-center justify-between rounded-2xl bg-tum-yellow px-4 py-3 text-black shadow-[0_10px_28px_rgba(250,204,21,.16)] transition hover:bg-tum-yellow-dark disabled:shadow-none disabled:opacity-50"
          >
            <span className="text-left">
              <span className="block text-sm font-black leading-tight">
                {submitting
                  ? 'Solicitando corrida...'
                  : paymentMethod
                    ? `Chamar ${selectedCategory?.name ?? 'carro'}`
                    : 'Escolha um método de pagamento'}
              </span>
              <span className="block text-[10px] font-semibold text-black/60">
                {paymentMethod ? `Pagamento ao final: ${paymentMethod}` : 'Nenhuma forma selecionada'}
              </span>
            </span>
            <span className="flex items-center gap-2 text-base font-black">
              {submitting ? <Loader2 size={18} className="animate-spin" /> : formatBRL(finalPrice)}
              {!submitting && <ChevronRight size={18} strokeWidth={3} />}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
