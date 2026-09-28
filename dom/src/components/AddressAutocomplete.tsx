import React from 'react';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, X, type LucideIcon } from 'lucide-react';
import {
  getCityFromCoordinates,
  newSearchSessionToken,
  retrieveAddressSuggestion,
  searchAddressSuggestions,
  type CityLocation,
  type MapboxSearchSuggestion,
} from '../lib/mapbox';
import { useTumMapConfig } from '../lib/mapConfig';

type ResultsDirection = 'up' | 'down';

const localityLookupCache = new Map<string, Promise<CityLocation | null>>();

function normalizedLocationText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function suggestionText(suggestion: MapboxSearchSuggestion): string {
  return normalizedLocationText([
    suggestion.name_preferred,
    suggestion.name,
    suggestion.full_address,
    suggestion.place_formatted,
    suggestion.address,
  ].filter(Boolean).join(' '));
}

function suggestionLocalityScore(
  suggestion: MapboxSearchSuggestion,
  locality: CityLocation | null,
): number {
  if (!locality) return 0;
  const haystack = suggestionText(suggestion);
  const city = normalizedLocationText(locality.city);
  const state = normalizedLocationText(locality.state);
  let score = 0;
  if (city && haystack.includes(city)) score += 4;
  if (state && haystack.includes(state)) score += 1;
  return score;
}

function rankSuggestions(
  suggestions: MapboxSearchSuggestion[],
  locality: CityLocation | null,
): MapboxSearchSuggestion[] {
  return suggestions
    .map((suggestion, index) => ({
      suggestion,
      index,
      localityScore: suggestionLocalityScore(suggestion, locality),
      distance: Number.isFinite(Number(suggestion.distance))
        ? Number(suggestion.distance)
        : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) =>
      b.localityScore - a.localityScore ||
      a.distance - b.distance ||
      a.index - b.index,
    )
    .map((entry) => entry.suggestion);
}

function localityFromProximity(
  proximity: [number, number],
): Promise<CityLocation | null> {
  // Aproximadamente 1 km por chave nessa latitude: suficiente para compartilhar
  // a mesma cidade entre origem, destino e paradas sem repetir reverse geocode.
  const key = `${proximity[0].toFixed(2)},${proximity[1].toFixed(2)}`;
  let pending = localityLookupCache.get(key);
  if (!pending) {
    pending = getCityFromCoordinates(proximity[0], proximity[1]).catch(() => null);
    localityLookupCache.set(key, pending);
  }
  return pending;
}

function resultTitle(suggestion: MapboxSearchSuggestion): string {
  return suggestion.name_preferred || suggestion.name;
}

function resultSubtitle(suggestion: MapboxSearchSuggestion): string {
  if (suggestion.full_address) {
    const title = resultTitle(suggestion).trim().toLowerCase();
    const full = suggestion.full_address.trim();
    if (!full.toLowerCase().startsWith(title)) return full;
  }

  return suggestion.place_formatted || suggestion.address || '';
}

export default function AddressAutocomplete({
  placeholder,
  value,
  onChange,
  proximity,
  icon,
  resultsDirection = 'down',
  fieldMarker,
  onInputFocus,
}: {
  placeholder: string;
  value: string;
  onChange: (placeName: string, coords: [number, number] | null) => void;
  proximity?: [number, number];
  icon: LucideIcon;
  resultsDirection?: ResultsDirection;
  fieldMarker?: 'origin' | 'destination' | `stop-${number}`;
  onInputFocus?: () => void;
}) {
  const mapConfig = useTumMapConfig();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<MapboxSearchSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localityBias, setLocalityBias] = useState<CityLocation | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const requestIdRef = useRef(0);
  const sessionTokenRef = useRef(newSearchSessionToken());
  const [resultsStyle, setResultsStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    let active = true;
    if (!proximity || !Number.isFinite(proximity[0]) || !Number.isFinite(proximity[1])) {
      setLocalityBias(null);
      return () => { active = false; };
    }

    void localityFromProximity(proximity).then((locality) => {
      if (active) setLocalityBias(locality);
    });

    return () => { active = false; };
  }, [proximity?.[0], proximity?.[1]]);

  useEffect(() => {
    if (!localityBias) return;
    setResults((current) => rankSuggestions(current, localityBias));
  }, [localityBias?.city, localityBias?.state]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      const clickedInput = boxRef.current?.contains(target);
      const clickedResults = resultsRef.current?.contains(target);

      if (!clickedInput && !clickedResults) setOpen(false);
    }

    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    if (!open) return;

    let frame = 0;

    function updateResultsPosition() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = boxRef.current?.getBoundingClientRect();
        if (!rect) return;

        const gap = 6;
        const viewportPadding = 8;
        const viewport = window.visualViewport;
        const visibleTop = viewport?.offsetTop ?? 0;
        const visibleHeight = viewport?.height ?? window.innerHeight;
        const visibleBottom = visibleTop + visibleHeight;
        const availableAbove = Math.max(0, rect.top - visibleTop - viewportPadding - gap);
        const availableBelow = Math.max(0, visibleBottom - rect.bottom - viewportPadding - gap);
        const available = resultsDirection === 'up' ? availableAbove : availableBelow;
        const maxHeight = Math.min(240, Math.max(48, available));

        setResultsStyle({
          position: 'fixed',
          left: rect.left,
          width: rect.width,
          zIndex: 10000,
          maxHeight,
          ...(resultsDirection === 'up'
            ? { top: Math.max(visibleTop + viewportPadding, rect.top - gap - maxHeight) }
            : { top: rect.bottom + gap }),
        });
      });
    }

    updateResultsPosition();
    window.addEventListener('resize', updateResultsPosition);
    window.addEventListener('scroll', updateResultsPosition, true);
    window.visualViewport?.addEventListener('resize', updateResultsPosition);
    window.visualViewport?.addEventListener('scroll', updateResultsPosition);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateResultsPosition);
      window.removeEventListener('scroll', updateResultsPosition, true);
      window.visualViewport?.removeEventListener('resize', updateResultsPosition);
      window.visualViewport?.removeEventListener('scroll', updateResultsPosition);
    };
  }, [open, resultsDirection]);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      requestIdRef.current += 1;
    };
  }, []);

  function resetSearchSession() {
    sessionTokenRef.current = newSearchSessionToken();
  }

  function runSearch(q: string) {
    if (timer.current) window.clearTimeout(timer.current);
    const clean = q.trim();

    if (!mapConfig.autocomplete_enabled || clean.length < mapConfig.search_min_chars) {
      requestIdRef.current += 1;
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    timer.current = window.setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      try {
        const suggestions = await searchAddressSuggestions(
          clean,
          sessionTokenRef.current,
          proximity,
        );

        if (requestId !== requestIdRef.current) return;
        const rankedSuggestions = rankSuggestions(suggestions, localityBias);
        setResults(rankedSuggestions);
        setOpen(rankedSuggestions.length > 0);
      } catch (error) {
        console.warn('Falha ao buscar endereço/ponto de referência:', error);
        if (requestId === requestIdRef.current) {
          setResults([]);
          setOpen(false);
        }
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, mapConfig.search_debounce_ms);
  }

  async function pick(suggestion: MapboxSearchSuggestion) {
    requestIdRef.current += 1;
    setLoading(true);

    try {
      const feature = await retrieveAddressSuggestion(
        suggestion,
        sessionTokenRef.current,
        proximity,
      );
      setQuery(feature.place_name);
      setResults([]);
      setOpen(false);
      onChange(feature.place_name, feature.center);
      resetSearchSession();
      window.requestAnimationFrame(() => {
        boxRef.current?.querySelector('input')?.blur();
      });
    } catch (error) {
      console.warn('Falha ao selecionar endereço/ponto de referência:', error);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }

  const Icon = icon;
  return (
    <div ref={anchorRef} className="relative">
      <div
        ref={boxRef}
        className={`relative ${open ? 'z-[80]' : 'z-0'}`}
      >
        <div className="flex items-center bg-tum-dark-2 dark:bg-tum-dark-2 rounded-xl border border-white/10 focus-within:border-tum-yellow/60 transition shadow-[0_10px_32px_rgba(0,0,0,.18)]">
        <Icon size={18} className="ml-3 text-tum-yellow" />
        <input
          data-tum-address-field={fieldMarker}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            const nextValue = e.target.value;
            setQuery(nextValue);
            onChange(nextValue, null);
            runSearch(nextValue);
          }}
          onFocus={() => {
            onInputFocus?.();
            if (results.length > 0) setOpen(true);
          }}
          className="flex-1 bg-transparent text-white placeholder-white/40 text-sm py-3 px-2 outline-none"
        />
        {loading && <Loader2 size={16} className="mr-3 text-white/40 animate-spin" />}
        {query && !loading && (
          <button
            type="button"
            onClick={() => {
              if (timer.current) window.clearTimeout(timer.current);
              requestIdRef.current += 1;
              setQuery('');
              onChange('', null);
              setResults([]);
              setOpen(false);
              resetSearchSession();
            }}
            className="mr-2 text-white/40 hover:text-white"
            aria-label="Limpar endereço"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {open && results.length > 0 && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={resultsRef}
            style={resultsStyle}
            className="overflow-hidden rounded-xl border border-white/10 bg-tum-dark-2 shadow-2xl"
          >
            <div className="h-full max-h-60 overflow-y-auto scrollbar-hide">
              {results.map((suggestion) => {
                const subtitle = resultSubtitle(suggestion);
                const isPoi = suggestion.feature_type === 'poi';

                return (
                  <button
                    type="button"
                    key={suggestion.mapbox_id}
                    onClick={() => void pick(suggestion)}
                    className="flex w-full items-start gap-2.5 border-b border-white/5 px-3 py-2.5 text-left transition last:border-0 hover:bg-tum-dark-3"
                  >
                    <MapPin size={16} className="mt-0.5 shrink-0 text-tum-yellow" />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-white/90">
                          {resultTitle(suggestion)}
                        </span>
                        {isPoi && (
                          <span className="shrink-0 rounded-md bg-tum-yellow/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-tum-yellow">
                            local
                          </span>
                        )}
                      </span>
                      {subtitle && (
                        <span className="mt-0.5 block truncate text-[11px] font-medium text-white/45">
                          {subtitle}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}