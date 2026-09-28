import { supabase } from './supabase';

export interface SupportThread {
  id: string;
  subject: string;
  status: 'open' | 'waiting_user' | 'closed';
  unread_for_user: number;
  last_message_at: string;
}

export interface SupportMessage {
  id: string;
  thread_id: string;
  sender_type: 'user' | 'admin';
  message: string;
  message_type: 'text' | 'image';
  image_path: string | null;
  image_mime_type: string | null;
  read_at: string | null;
  created_at: string;
}

export async function loadMySupport() {
  const { data: threads, error } = await supabase
    .from('support_threads')
    .select('id,subject,status,unread_for_user,last_message_at')
    .neq('status', 'closed')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) return { thread: null, messages: [], error: error.message };
  const thread = (threads?.[0] as SupportThread | undefined) ?? null;
  if (!thread) return { thread: null, messages: [], error: null };

  const { data: messages, error: messageError } = await supabase
    .from('support_messages')
    .select('id,thread_id,sender_type,message,message_type,image_path,image_mime_type,read_at,created_at')
    .eq('thread_id', thread.id)
    .order('created_at');

  if (!messageError) {
    await supabase.rpc('mark_my_support_read_tum', { p_thread_id: thread.id });
  }

  return {
    thread,
    messages: (messages ?? []) as SupportMessage[],
    error: messageError?.message ?? null,
  };
}

export async function sendSupportMessage(message: string, subject = 'Atendimento') {
  const { data, error } = await supabase.rpc('send_my_support_message_v2_tum', {
    p_message: message,
    p_subject: subject,
    p_image_path: null,
    p_image_mime_type: null,
  });
  return {
    threadId: typeof data?.thread_id === 'string' ? data.thread_id : null,
    error: error?.message ?? null,
  };
}

function imageExtension(file: File): string {
  const mime = file.type.toLowerCase();
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/heic') return 'heic';
  if (mime === 'image/heif') return 'heif';
  return 'jpg';
}

export async function sendSupportImage(file: File, threadId: string | null, subject = 'Atendimento') {
  if (!file.type.startsWith('image/')) return { threadId: null, error: 'Selecione uma imagem válida.' };
  if (file.size > 10 * 1024 * 1024) return { threadId: null, error: 'A foto deve ter no máximo 10 MB.' };

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (userError || !userId) return { threadId: null, error: 'Usuário não autenticado.' };

  const mime = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.type.toLowerCase())
    ? file.type.toLowerCase()
    : 'image/jpeg';
  const path = `${userId}/${threadId ?? 'new'}/${Date.now()}-${Math.random().toString(36).slice(2)}.${imageExtension(file)}`;

  const { error: uploadError } = await supabase.storage.from('support-images').upload(path, file, {
    contentType: mime,
    upsert: false,
  });
  if (uploadError) return { threadId: null, error: uploadError.message };

  const { data, error } = await supabase.rpc('send_my_support_message_v2_tum', {
    p_message: '📷 Foto',
    p_subject: subject,
    p_image_path: path,
    p_image_mime_type: mime,
  });

  if (error) {
    await supabase.storage.from('support-images').remove([path]);
    return { threadId: null, error: error.message };
  }

  return { threadId: typeof data?.thread_id === 'string' ? data.thread_id : null, error: null };
}

export async function createSupportImageSignedUrl(imagePath: string) {
  const { data, error } = await supabase.storage.from('support-images').createSignedUrl(imagePath, 60 * 60);
  return { url: data?.signedUrl ?? null, error: error?.message ?? null };
}
