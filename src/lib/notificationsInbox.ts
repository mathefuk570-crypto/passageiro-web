import { supabase } from './supabase';

export interface InboxNotification {
  id: string;
  campaign_id: string | null;
  title: string;
  message: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export async function loadMyNotifications() {
  const { data, error } = await supabase
    .from('user_notifications')
    .select('id,campaign_id,title,message,data,read_at,created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  return {
    data: (data ?? []) as InboxNotification[],
    error: error?.message ?? null,
  };
}

export async function countUnreadNotifications() {
  const { count, error } = await supabase
    .from('user_notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);

  return {
    count: count ?? 0,
    error: error?.message ?? null,
  };
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase.rpc('mark_my_notification_read_tum', {
    p_notification_id: id,
  });

  return { error: error?.message ?? null };
}

export async function markAllNotificationsRead() {
  const { error } = await supabase.rpc('mark_all_my_notifications_read_tum');
  return { error: error?.message ?? null };
}

export async function clearMyNotifications() {
  const { data, error } = await supabase.rpc('clear_my_notifications_tum');

  return {
    count: typeof data === 'number' ? data : Number(data ?? 0),
    error: error?.message ?? null,
  };
}
