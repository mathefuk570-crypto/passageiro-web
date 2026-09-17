import React from 'react';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, X, type LucideIcon } from 'lucide-react';
import {
  newSearchSessionToken,
  retrieveAddressSuggestion,
  searchAddressSuggestions,
  type MapboxSearchSuggestion,
} from '../lib/mapbox';
import { useTumMapConfig } from '../lib/mapConfig';

type ResultsDirection = 'up' | 'down';

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
}: {
  placeholder: string;
  value: string;
  onChange: (placeName: string, coords: [number, number] | null) => void;
  proximity?: [number, number];
  icon: LucideIcon;
  resultsDirection?: ResultsDirection;
}) {
  const mapConfig = useTumMapConfig();
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<MapboxSearchSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
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
        const availableAbove = Math.max(96, rect.top - viewportPadding - gap);
        const availableBelow = Math.max(96, window.innerHeight - rect.bottom - viewportPadding - gap);
        const maxHeight = Math.min(240, resultsDirection === 'up' ? availableAbove : availableBelow);

        setResultsStyle({
          position: 'fixed',
          left: rect.left,
          width: rect.width,
          zIndex: 10000,
          maxHeight,
          ...(resultsDirection === 'up'
            ? { bottom: window.innerHeight - rect.top + gap }
            : { top: rect.bottom + gap }),
        });
      });
    }

    updateResultsPosition();
    window.addEventListener('resize', updateResultsPosition);
    window.addEventListener('scroll', updateResultsPosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateResultsPosition);
      window.removeEventListener('scroll', updateResultsPosition, true);
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
        setResults(suggestions);
        setOpen(suggestions.length > 0);
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
    } catch (error) {
      console.warn('Falha ao selecionar endereço/ponto de referência:', error);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }

  const Icon = icon;
  return (
    <div ref={boxRef} className={`relative ${open ? 'z-[80]' : 'z-0'}`}>
      <div className="flex items-center bg-tum-dark-2 dark:bg-tum-dark-2 rounded-xl border border-white/10 focus-within:border-tum-yellow/60 transition">
        <Icon size={18} className="ml-3 text-tum-yellow" />
        <input
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            const nextValue = e.target.value;
            setQuery(nextValue);
            onChange(nextValue, null);
            runSearch(nextValue);
          }}
          onFocus={() => results.length > 0 && setOpen(true)}
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
  );
}