import { supabase } from './supabase';

export type NewsCategory = 'promotion' | 'tum' | 'community' | 'drivers';

export type NewsPost = {
  id: string;
  title: string;
  description: string | null;
  image_url: string;
  category: NewsCategory;
  city_id: string | null;
  city_name: string | null;
  pinned: boolean;
  priority: number;
  published_at: string;
  starts_at: string | null;
  ends_at: string | null;
  share_text: string | null;
  share_link: string | null;
  cta_label: string | null;
  cta_url: string | null;
  share_count: number;
};

export type NewsResult = {
  data: NewsPost[];
  error: string | null;
};

function normalizePost(value: unknown): NewsPost | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  const imageUrl = typeof row.image_url === 'string' ? row.image_url.trim() : '';

  if (!id || !title || !imageUrl) return null;

  const categoryRaw = typeof row.category === 'string' ? row.category : 'tum';
  const category: NewsCategory =
    categoryRaw === 'promotion' ||
    categoryRaw === 'community' ||
    categoryRaw === 'drivers'
      ? categoryRaw
      : 'tum';

  return {
    id,
    title,
    description:
      typeof row.description === 'string' && row.description.trim()
        ? row.description.trim()
        : null,
    image_url: imageUrl,
    category,
    city_id: typeof row.city_id === 'string' ? row.city_id : null,
    city_name:
      typeof row.city_name === 'string' && row.city_name.trim()
        ? row.city_name.trim()
        : null,
    pinned: row.pinned === true,
    priority: Number(row.priority ?? 0) || 0,
    published_at:
      typeof row.published_at === 'string'
        ? row.published_at
        : new Date().toISOString(),
    starts_at: typeof row.starts_at === 'string' ? row.starts_at : null,
    ends_at: typeof row.ends_at === 'string' ? row.ends_at : null,
    share_text:
      typeof row.share_text === 'string' && row.share_text.trim()
        ? row.share_text.trim()
        : null,
    share_link:
      typeof row.share_link === 'string' && row.share_link.trim()
        ? row.share_link.trim()
        : null,
    cta_label:
      typeof row.cta_label === 'string' && row.cta_label.trim()
        ? row.cta_label.trim()
        : null,
    cta_url:
      typeof row.cta_url === 'string' && row.cta_url.trim()
        ? row.cta_url.trim()
        : null,
    share_count: Math.max(0, Number(row.share_count ?? 0) || 0),
  };
}

export async function loadMyNewsPosts(postId?: string | null): Promise<NewsResult> {
  try {
    const { data, error } = await supabase.rpc('get_my_news_posts_tum', {
      p_post_id: postId || null,
    });

    if (error) {
      return { data: [], error: error.message };
    }

    return {
      data: (Array.isArray(data) ? data : [])
        .map(normalizePost)
        .filter((post): post is NewsPost => post !== null),
      error: null,
    };
  } catch (error) {
    return {
      data: [],
      error:
        error instanceof Error
          ? error.message
          : 'Não foi possível carregar as novidades.',
    };
  }
}

export async function registerNewsPostShare(postId: string): Promise<void> {
  try {
    const { error } = await supabase.rpc('register_my_news_post_share_tum', {
      p_post_id: postId,
    });
    if (error) throw error;
  } catch (error) {
    console.warn('[TUM] Não foi possível registrar o compartilhamento:', error);
  }
}

export function buildNewsShareMessage(post: NewsPost): string {
  const defaultText = post.description
    ? `💛 ${post.title}\n\n${post.description}`
    : `💛 ${post.title}`;
  const text = post.share_text || defaultText;
  const link = post.share_link?.trim();

  return link ? `${text}\n\n${link}` : text;
}
