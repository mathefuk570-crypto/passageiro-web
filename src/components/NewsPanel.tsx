import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  MapPin,
  Megaphone,
  Newspaper,
  Pin,
  RefreshCw,
  Share2,
  Sparkles,
  Star,
  Trophy,
  X,
  type LucideIcon,
} from 'lucide-react';

import { useTheme } from '../hooks/useTheme';
import { useNativeActions } from '../lib/nativeActions';
import {
  buildNewsShareMessage,
  loadMyNewsPosts,
  registerNewsPostShare,
  type NewsCategory,
  type NewsPost,
} from '../lib/news';

type CategoryFilter = 'all' | NewsCategory;

type Props = {
  open: boolean;
  onClose: () => void;
  initialPostId?: string | null;
  onNavigate?: (url: string) => void;
};

type CategoryMeta = {
  label: string;
  shortLabel: string;
  Icon: LucideIcon;
  className: string;
  lightClassName: string;
};

const CATEGORIES: Record<NewsCategory, CategoryMeta> = {
  promotion: {
    label: 'Promoções',
    shortLabel: 'Promoção',
    Icon: Megaphone,
    className: 'border-tum-yellow/25 bg-tum-yellow/12 text-tum-yellow',
    lightClassName: 'border-amber-300 bg-amber-50 text-amber-800',
  },
  tum: {
    label: 'TUM',
    shortLabel: 'TUM',
    Icon: Sparkles,
    className: 'border-blue-400/20 bg-blue-400/10 text-blue-300',
    lightClassName: 'border-blue-200 bg-blue-50 text-blue-700',
  },
  community: {
    label: 'Comunidade',
    shortLabel: 'Comunidade',
    Icon: Star,
    className: 'border-violet-400/20 bg-violet-400/10 text-violet-300',
    lightClassName: 'border-violet-200 bg-violet-50 text-violet-700',
  },
  drivers: {
    label: 'Motoristas',
    shortLabel: 'Motoristas',
    Icon: Trophy,
    className: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
    lightClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
};

function formatPostDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function isNewPost(value: string): boolean {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= 72 * 60 * 60 * 1000;
}

function imageFilename(post: NewsPost, mimeType: string): string {
  const ext = mimeType.includes('png')
    ? 'png'
    : mimeType.includes('webp')
      ? 'webp'
      : 'jpg';
  return `tum-${post.id.slice(0, 8)}.${ext}`;
}

async function shareThroughBrowser(post: NewsPost, message: string): Promise<boolean> {
  const browser = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };

  if (!browser.share) return false;

  try {
    const response = await fetch(post.image_url);
    if (response.ok) {
      const blob = await response.blob();
      const file = new File([blob], imageFilename(post, blob.type || 'image/jpeg'), {
        type: blob.type || 'image/jpeg',
      });
      const data: ShareData = {
        title: post.title,
        text: message,
        files: [file],
      };

      if (!browser.canShare || browser.canShare(data)) {
        await browser.share(data);
        return true;
      }
    }
  } catch {
    // Se o navegador/WebView não permitir compartilhar o arquivo, tentamos texto.
  }

  try {
    await browser.share({ title: post.title, text: message });
    return true;
  } catch {
    return false;
  }
}

function CategoryPill({ post, theme }: { post: NewsPost; theme: 'light' | 'dark' }) {
  const meta = CATEGORIES[post.category];
  const Icon = meta.Icon;
  const colorClass = theme === 'light' ? meta.lightClassName : meta.className;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${colorClass}`}>
      <Icon size={12} />
      {meta.shortLabel}
    </span>
  );
}

export default function NewsPanel({
  open,
  onClose,
  initialPostId = null,
  onNavigate,
}: Props) {
  const { theme } = useTheme();
  const nativeActions = useNativeActions();
  const [posts, setPosts] = useState<NewsPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [selectedPost, setSelectedPost] = useState<NewsPost | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await loadMyNewsPosts();
    setPosts(result.data);
    setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) {
      setSelectedPost(null);
      setShareFeedback('');
      return;
    }
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open || !initialPostId || loading) return;
    const post = posts.find((item) => item.id === initialPostId);
    if (post) {
      setSelectedPost(post);
      return;
    }

    let active = true;
    void loadMyNewsPosts(initialPostId).then((result) => {
      if (!active) return;
      if (result.data[0]) setSelectedPost(result.data[0]);
    });
    return () => {
      active = false;
    };
  }, [initialPostId, loading, open, posts]);

  const filteredPosts = useMemo(
    () => (filter === 'all' ? posts : posts.filter((post) => post.category === filter)),
    [filter, posts],
  );

  const sharePost = useCallback(
    async (post: NewsPost) => {
      if (sharingId) return;
      setSharingId(post.id);
      setShareFeedback('');
      const message = buildNewsShareMessage(post);
      let shared = false;

      try {
        if (nativeActions?.shareNewsPost) {
          shared = await nativeActions.shareNewsPost(post.title, message, post.image_url);
        }

        if (!shared) {
          shared = await shareThroughBrowser(post, message);
        }

        if (!shared && nativeActions?.shareText) {
          shared = await nativeActions.shareText(post.title, message);
        }

        if (!shared && navigator.clipboard) {
          await navigator.clipboard.writeText(message);
          setShareFeedback('Texto copiado para compartilhar.');
          shared = true;
        }

        if (shared) {
          await registerNewsPostShare(post.id);
          setPosts((current) =>
            current.map((item) =>
              item.id === post.id
                ? { ...item, share_count: item.share_count + 1 }
                : item,
            ),
          );
        } else {
          setShareFeedback('Não foi possível abrir o compartilhamento agora.');
        }
      } catch (shareError) {
        console.warn('[TUM] Falha ao compartilhar publicação:', shareError);
        setShareFeedback('Não foi possível abrir o compartilhamento agora.');
      } finally {
        setSharingId(null);
      }
    },
    [nativeActions, sharingId],
  );

  const runCta = useCallback(
    (post: NewsPost) => {
      const url = post.cta_url?.trim();
      if (!url) return;

      if (url.startsWith('/')) {
        onNavigate?.(url);
        return;
      }

      window.open(url, '_blank', 'noopener,noreferrer');
    },
    [onNavigate],
  );

  if (!open) return null;

  const pageClass =
    theme === 'light'
      ? 'bg-[#F4F4F5] text-[#141518]'
      : 'bg-tum-dark text-white';
  const cardClass =
    theme === 'light'
      ? 'border-black/10 bg-white shadow-[0_8px_30px_rgba(0,0,0,.07)]'
      : 'border-white/10 bg-tum-dark-2 shadow-[0_12px_34px_rgba(0,0,0,.28)]';
  const subtleText = theme === 'light' ? 'text-black/50' : 'text-white/45';
  const mutedText = theme === 'light' ? 'text-black/60' : 'text-white/60';
  const faintText = theme === 'light' ? 'text-black/40' : 'text-white/40';
  const extraFaintText = theme === 'light' ? 'text-black/30' : 'text-white/30';
  const subtleControl = theme === 'light'
    ? 'border-black/10 bg-black/[0.035] text-black/70'
    : 'border-white/10 bg-white/5 text-white/70';
  const inactivePill = theme === 'light'
    ? 'border-black/10 bg-white text-black/55'
    : 'border-white/10 bg-white/5 text-white/55';
  const dividerClass = theme === 'light' ? 'border-black/10' : 'border-white/10';

  return (
    <div className={`fixed inset-0 z-[86] flex flex-col ${pageClass}`}>
      <header className={`shrink-0 border-b px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl ${theme === 'light' ? 'border-black/10 bg-white/95' : 'border-white/10 bg-tum-dark-2/95'}`}>
        <div className="flex items-center gap-3">
          {selectedPost ? (
            <button
              type="button"
              onClick={() => setSelectedPost(null)}
              className={`tum-press flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${subtleControl}`}
              aria-label="Voltar para novidades"
            >
              <ChevronLeft size={20} />
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className={`tum-press flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${subtleControl}`}
              aria-label="Fechar novidades"
            >
              <ArrowLeft size={20} />
            </button>
          )}

          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-tum-yellow">
              Fique por dentro
            </p>
            <h2 className="truncate text-lg font-black">{selectedPost ? selectedPost.title : 'Novidades TUM'}</h2>
            {!selectedPost && (
              <p className={`mt-0.5 truncate text-[11px] ${subtleText}`}>
                Promoções, campanhas e histórias da sua cidade
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className={`tum-press flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${subtleText}`}
            aria-label="Fechar"
          >
            <X size={19} />
          </button>
        </div>
      </header>

      {selectedPost ? (
        <main className="flex-1 overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 scrollbar-hide">
          <article className={`mx-auto max-w-xl overflow-hidden rounded-[26px] border ${cardClass}`}>
            <div className="relative bg-black/10">
              <img
                src={selectedPost.image_url}
                alt={selectedPost.title}
                className="block max-h-[58vh] w-full object-cover"
              />
              <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                <CategoryPill post={selectedPost} theme={theme} />
                {selectedPost.pinned && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/65 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white backdrop-blur-md">
                    <Pin size={11} /> Destaque
                  </span>
                )}
                {isNewPost(selectedPost.published_at) && (
                  <span className="rounded-full bg-tum-yellow px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-black">
                    Novo
                  </span>
                )}
              </div>
            </div>

            <div className="p-4">
              <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold ${subtleText}`}>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays size={13} /> {formatPostDate(selectedPost.published_at)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={13} /> {selectedPost.city_name || 'Todas as cidades'}
                </span>
              </div>

              <h3 className="mt-3 text-xl font-black leading-tight">{selectedPost.title}</h3>
              {selectedPost.description && (
                <p className={`mt-2 whitespace-pre-line text-sm leading-6 ${mutedText}`}>
                  {selectedPost.description}
                </p>
              )}

              {shareFeedback && (
                <div className="mt-3 rounded-xl border border-tum-yellow/20 bg-tum-yellow/10 px-3 py-2 text-xs font-bold text-tum-yellow">
                  {shareFeedback}
                </div>
              )}

              <div className={`mt-5 grid gap-2 ${selectedPost.cta_label && selectedPost.cta_url ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {selectedPost.cta_label && selectedPost.cta_url && (
                  <button
                    type="button"
                    onClick={() => runCta(selectedPost)}
                    className={`tum-press flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-3 text-sm font-extrabold ${subtleControl}`}
                  >
                    {selectedPost.cta_url.startsWith('/') ? <ChevronRight size={17} /> : <ExternalLink size={16} />}
                    {selectedPost.cta_label}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void sharePost(selectedPost)}
                  disabled={sharingId === selectedPost.id}
                  className="tum-press flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-tum-yellow px-3 text-sm font-black text-black shadow-[0_10px_30px_rgba(250,204,21,.18)] disabled:opacity-60"
                >
                  {sharingId === selectedPost.id ? <Loader2 size={18} className="animate-spin" /> : <Share2 size={18} />}
                  Compartilhar
                </button>
              </div>
            </div>
          </article>
        </main>
      ) : (
        <>
          <div className="shrink-0 overflow-x-auto px-4 py-3 scrollbar-hide">
            <div className="flex min-w-max gap-2">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={`tum-press rounded-full border px-3.5 py-2 text-xs font-black transition ${filter === 'all' ? 'border-tum-yellow bg-tum-yellow text-black' : inactivePill}`}
              >
                Todos
              </button>
              {(Object.keys(CATEGORIES) as NewsCategory[]).map((category) => {
                const active = filter === category;
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setFilter(category)}
                    className={`tum-press rounded-full border px-3.5 py-2 text-xs font-black transition ${active ? 'border-tum-yellow bg-tum-yellow text-black' : inactivePill}`}
                  >
                    {CATEGORIES[category].label}
                  </button>
                );
              })}
            </div>
          </div>

          <main className="flex-1 overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] scrollbar-hide">
            {loading ? (
              <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
                <Loader2 size={28} className="animate-spin text-tum-yellow" />
                <p className={`mt-3 text-sm font-bold ${subtleText}`}>Carregando novidades...</p>
              </div>
            ) : error ? (
              <div className="flex min-h-[55vh] flex-col items-center justify-center px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-400/10 text-red-300">
                  <Newspaper size={25} />
                </div>
                <h3 className="mt-4 font-black">Não conseguimos carregar agora</h3>
                <p className={`mt-1 text-sm leading-5 ${subtleText}`}>{error}</p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="tum-press mt-4 flex items-center gap-2 rounded-xl bg-tum-yellow px-4 py-2.5 text-sm font-black text-black"
                >
                  <RefreshCw size={16} /> Tentar novamente
                </button>
              </div>
            ) : filteredPosts.length === 0 ? (
              <div className="flex min-h-[55vh] flex-col items-center justify-center px-6 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-[22px] border border-tum-yellow/20 bg-tum-yellow/10 text-tum-yellow">
                  <Newspaper size={28} />
                </div>
                <h3 className="mt-4 font-black">Nada novo por aqui ainda</h3>
                <p className={`mt-1 max-w-xs text-sm leading-5 ${subtleText}`}>
                  Promoções, ações e novidades da sua cidade aparecerão aqui.
                </p>
              </div>
            ) : (
              <div className="mx-auto max-w-xl space-y-4 pb-3">
                {filteredPosts.map((post) => (
                  <article key={post.id} className={`overflow-hidden rounded-[24px] border ${cardClass}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedPost(post)}
                      className="block w-full text-left"
                    >
                      <div className="relative aspect-[4/4.6] max-h-[520px] overflow-hidden bg-black/10">
                        <img src={post.image_url} alt={post.title} className="h-full w-full object-cover" />
                        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                          <CategoryPill post={post} theme={theme} />
                          {post.pinned && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/65 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white backdrop-blur-md">
                              <Pin size={11} /> Destaque
                            </span>
                          )}
                          {isNewPost(post.published_at) && (
                            <span className="rounded-full bg-tum-yellow px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-black">
                              Novo
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="px-4 pb-2 pt-3.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="line-clamp-2 text-base font-black leading-5">{post.title}</h3>
                            <div className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold ${faintText}`}>
                              <span>{formatPostDate(post.published_at)}</span>
                              <span>•</span>
                              <span>{post.city_name || 'Todas as cidades'}</span>
                            </div>
                          </div>
                          <ChevronRight size={19} className={`shrink-0 ${extraFaintText}`} />
                        </div>
                        {post.description && (
                          <p className={`mt-2 line-clamp-2 text-xs leading-5 ${mutedText}`}>{post.description}</p>
                        )}
                      </div>
                    </button>

                    <div className={`flex items-center justify-between gap-3 border-t px-3 py-2.5 ${dividerClass}`}>
                      <span className={`px-1 text-[10px] font-bold uppercase tracking-[0.1em] ${extraFaintText}`}>#VaDeTUM</span>
                      <button
                        type="button"
                        onClick={() => void sharePost(post)}
                        disabled={sharingId === post.id}
                        className="tum-press flex items-center gap-2 rounded-xl bg-tum-yellow px-3.5 py-2.5 text-xs font-black text-black disabled:opacity-60"
                      >
                        {sharingId === post.id ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />}
                        Compartilhar
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </main>
        </>
      )}
    </div>
  );
}
