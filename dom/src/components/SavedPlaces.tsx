import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BriefcaseBusiness,
  Home,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Address, SavedPlace } from '../lib/types';
import AddressAutocomplete from './AddressAutocomplete';
import AlertModal from './AlertModal';

type PlaceType = SavedPlace['place_type'];

type EditorState = {
  placeType: PlaceType;
  place: SavedPlace | null;
};

interface Props {
  passengerId: string;
  proximity?: [number, number];
  onSelect: (address: Address) => void;
  onError?: (message: string) => void;
}

function labelForType(type: PlaceType): string {
  if (type === 'home') return 'Casa';
  if (type === 'work') return 'Trabalho';
  return 'Favorito';
}

function iconForType(type: PlaceType) {
  if (type === 'home') return Home;
  if (type === 'work') return BriefcaseBusiness;
  return Star;
}

export default function SavedPlaces({
  passengerId,
  proximity,
  onSelect,
  onError,
}: Props) {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftAddress, setDraftAddress] = useState<Address | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const loadPlaces = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('passenger_saved_places')
        .select('*')
        .eq('passenger_id', passengerId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setPlaces((data as SavedPlace[] | null) ?? []);
    } catch (error) {
      console.error('Erro ao carregar favoritos:', error);
      onErrorRef.current?.('Não foi possível carregar seus locais favoritos.');
    } finally {
      setLoading(false);
    }
  }, [passengerId]);

  useEffect(() => {
    void loadPlaces();
  }, [loadPlaces]);

  const home = useMemo(
    () => places.find((place) => place.place_type === 'home') ?? null,
    [places],
  );
  const work = useMemo(
    () => places.find((place) => place.place_type === 'work') ?? null,
    [places],
  );
  const favorites = useMemo(
    () => places.filter((place) => place.place_type === 'favorite'),
    [places],
  );

  function openEditor(placeType: PlaceType, place: SavedPlace | null) {
    setEditor({ placeType, place });
    setDraftName(
      place?.name ?? (placeType === 'home' ? 'Casa' : placeType === 'work' ? 'Trabalho' : ''),
    );
    setDraftAddress(
      place
        ? {
            place_name: place.address,
            coordinates: [Number(place.longitude), Number(place.latitude)],
          }
        : null,
    );
  }

  function closeEditor() {
    if (saving) return;
    setEditor(null);
    setDraftName('');
    setDraftAddress(null);
  }

  function choosePlace(place: SavedPlace | null, type: PlaceType) {
    if (!place) {
      openEditor(type, null);
      return;
    }

    onSelect({
      place_name: place.address,
      coordinates: [Number(place.longitude), Number(place.latitude)],
    });
  }

  async function savePlace() {
    if (!editor || !draftAddress?.coordinates || saving) return;

    const cleanName = draftName.trim();
    if (!cleanName) {
      onError?.('Digite um nome para o favorito.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        passenger_id: passengerId,
        place_type: editor.placeType,
        name: cleanName,
        address: draftAddress.place_name,
        latitude: draftAddress.coordinates[1],
        longitude: draftAddress.coordinates[0],
      };

      const result = editor.place
        ? await supabase
            .from('passenger_saved_places')
            .update(payload)
            .eq('id', editor.place.id)
            .eq('passenger_id', passengerId)
        : await supabase.from('passenger_saved_places').insert(payload);

      if (result.error) throw result.error;

      await loadPlaces();
      setEditor(null);
      setDraftName('');
      setDraftAddress(null);
    } catch (error) {
      console.error('Erro ao salvar favorito:', error);
      onError?.(error instanceof Error ? error.message : 'Não foi possível salvar o favorito.');
    } finally {
      setSaving(false);
    }
  }

  async function deletePlace() {
    if (!editor?.place || saving) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('passenger_saved_places')
        .delete()
        .eq('id', editor.place.id)
        .eq('passenger_id', passengerId);

      if (error) throw error;

      await loadPlaces();
      setDeleteConfirmOpen(false);
      setEditor(null);
      setDraftName('');
      setDraftAddress(null);
    } catch (error) {
      console.error('Erro ao remover favorito:', error);
      onError?.(error instanceof Error ? error.message : 'Não foi possível remover o favorito.');
      setDeleteConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const shortcutClass =
    'tum-press group flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-black/20 pl-2.5 pr-1.5 text-xs font-bold text-white transition hover:border-tum-yellow/50 hover:bg-white/5';

  return (
    <>
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-hide">
        {loading ? (
          <div className="flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 text-xs text-white/60">
            <Loader2 size={14} className="animate-spin text-tum-yellow" />
            Carregando favoritos...
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => choosePlace(home, 'home')}
              className={shortcutClass}
              title={home?.address ?? 'Adicionar endereço de Casa'}
            >
              <Home size={15} className="text-tum-yellow" />
              <span>{home ? 'Casa' : '+ Casa'}</span>
              {home && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Editar Casa"
                  onClick={(event) => {
                    event.stopPropagation();
                    openEditor('home', home);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      openEditor('home', home);
                    }
                  }}
                  className="ml-0.5 rounded-lg p-1 text-white/45 hover:bg-white/10 hover:text-white"
                >
                  <Pencil size={12} />
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => choosePlace(work, 'work')}
              className={shortcutClass}
              title={work?.address ?? 'Adicionar endereço de Trabalho'}
            >
              <BriefcaseBusiness size={15} className="text-tum-yellow" />
              <span>{work ? 'Trabalho' : '+ Trabalho'}</span>
              {work && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Editar Trabalho"
                  onClick={(event) => {
                    event.stopPropagation();
                    openEditor('work', work);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      openEditor('work', work);
                    }
                  }}
                  className="ml-0.5 rounded-lg p-1 text-white/45 hover:bg-white/10 hover:text-white"
                >
                  <Pencil size={12} />
                </span>
              )}
            </button>

            {favorites.map((place) => (
              <button
                key={place.id}
                type="button"
                onClick={() => choosePlace(place, 'favorite')}
                className={shortcutClass}
                title={place.address}
              >
                <Star size={15} className="text-tum-yellow" />
                <span className="max-w-24 truncate">{place.name}</span>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Editar ${place.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    openEditor('favorite', place);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      openEditor('favorite', place);
                    }
                  }}
                  className="ml-0.5 rounded-lg p-1 text-white/45 hover:bg-white/10 hover:text-white"
                >
                  <Pencil size={12} />
                </span>
              </button>
            ))}

            <button
              type="button"
              onClick={() => openEditor('favorite', null)}
              className="tum-press flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-tum-yellow/50 bg-tum-yellow/10 px-3 text-xs font-black text-tum-yellow transition hover:bg-tum-yellow/15"
            >
              <Plus size={14} strokeWidth={3} />
              Favorito
            </button>
          </>
        )}
      </div>

      {editor && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
          <div className="tum-favorite-sheet w-full max-w-md rounded-t-3xl border border-white/10 bg-tum-dark-2 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tum-yellow text-black">
                  {React.createElement(iconForType(editor.placeType), { size: 20 })}
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-black text-white">
                    {editor.place
                      ? `Editar ${editor.place.name}`
                      : editor.placeType === 'favorite'
                        ? 'Novo favorito'
                        : `Configurar ${labelForType(editor.placeType)}`}
                  </h3>
                  <p className="text-xs text-white/50">
                    Toque no atalho para usar como destino depois.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                className="tum-press flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              {editor.placeType === 'favorite' && (
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-white/70">
                    Nome do favorito
                  </label>
                  <div className="flex items-center rounded-xl border border-white/10 bg-black/20 focus-within:border-tum-yellow/60">
                    <Star size={17} className="ml-3 text-tum-yellow" />
                    <input
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      placeholder="Ex.: Academia, Faculdade, Casa da mãe"
                      maxLength={40}
                      className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm text-white outline-none placeholder:text-white/35"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-bold text-white/70">
                  Endereço
                </label>
                <AddressAutocomplete
                  placeholder="Digite e selecione o endereço"
                  value={draftAddress?.place_name ?? ''}
                  onChange={(name, coordinates) => {
                    setDraftAddress(
                      coordinates
                        ? { place_name: name, coordinates }
                        : null,
                    );
                  }}
                  proximity={proximity}
                  icon={MapPin}
                />
                <p className="mt-1.5 text-[11px] text-white/40">
                  Selecione uma sugestão para salvar a localização exata no mapa.
                </p>
              </div>

              <div className="flex gap-2 pt-1">
                {editor.place && (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmOpen(true)}
                    disabled={saving}
                    className="tum-press flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 disabled:opacity-50"
                    title="Excluir favorito"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void savePlace()}
                  disabled={
                    saving ||
                    !draftAddress?.coordinates ||
                    !draftName.trim()
                  }
                  className="tum-primary-cta flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-tum-yellow font-black text-black transition hover:bg-tum-yellow-dark disabled:opacity-40"
                >
                  {saving ? <Loader2 size={18} className="animate-spin" /> : <Star size={18} />}
                  {saving ? 'Salvando...' : 'Salvar local'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AlertModal
        open={deleteConfirmOpen}
        variant="warning"
        title="Remover local salvo?"
        message={
          editor?.place
            ? `${editor.place.name} será removido dos seus atalhos. Você poderá adicioná-lo novamente quando quiser.`
            : 'Este local será removido dos seus atalhos.'
        }
        secondaryLabel="Cancelar"
        actionLabel={saving ? 'Removendo...' : 'Remover'}
        onClose={() => {
          if (!saving) setDeleteConfirmOpen(false);
        }}
        onAction={() => void deletePlace()}
      />
    </>
  );
}