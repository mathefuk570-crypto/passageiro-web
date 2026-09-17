import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  Clock3,
  Headphones,
  ImagePlus,
  Loader2,
  MessageCircleMore,
  RefreshCw,
  Send,
} from 'lucide-react';

import {
  createSupportImageSignedUrl,
  loadMySupport,
  sendSupportImage,
  sendSupportMessage,
  type SupportMessage,
  type SupportThread,
} from '../lib/support';
import { supabase } from '../lib/supabase';

function SupportImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void createSupportImageSignedUrl(path).then((result) => {
      if (active) setUrl(result.url);
    });
    return () => { active = false; };
  }, [path]);

  if (!url) {
    return <div className="flex h-32 w-52 items-center justify-center rounded-xl bg-black/10"><Loader2 size={18} className="animate-spin opacity-60" /></div>;
  }

  return <img src={url} alt="Foto enviada no suporte" className="max-h-64 w-full max-w-[260px] rounded-xl object-cover" />;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function supportStatus(thread: SupportThread | null) {
  if (!thread) {
    return {
      label: 'Novo atendimento',
      detail: 'Envie uma mensagem para começar',
      className: 'border-white/10 bg-white/5 text-white/55',
      Icon: MessageCircleMore,
    };
  }

  if (thread.status === 'waiting_user') {
    return {
      label: 'Aguardando você',
      detail: 'O suporte respondeu ao atendimento',
      className: 'border-tum-yellow/25 bg-tum-yellow/10 text-tum-yellow',
      Icon: Clock3,
    };
  }

  return {
    label: 'Em atendimento',
    detail: 'Nossa equipe acompanha esta conversa',
    className: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300',
    Icon: CheckCircle2,
  };
}

export default function SupportPanel({ open, onClose }: Props) {
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [photoSending, setPhotoSending] = useState(false);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const end = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const result = await loadMySupport();
    setThread(result.thread);
    setMessages(result.messages);
    setError(result.error);
    if (!quiet) setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;

    void load();
    const intervalId = window.setInterval(() => void load(true), 8000);
    return () => window.clearInterval(intervalId);
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const channel = supabase
      .channel('passenger-support-messages-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, () => {
        void load(true);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [open, load]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!open) return null;

  const status = supportStatus(thread);
  const StatusIcon = status.Icon;

  async function sendPhoto(file: File) {
    if (photoSending || sending) return;
    setPhotoSending(true);
    setError(null);
    const result = await sendSupportImage(file, thread?.id ?? null, thread?.subject ?? 'Atendimento');
    if (result.error) setError(result.error);
    await load(true);
    setPhotoSending(false);
    if (imageInput.current) imageInput.current.value = '';
  }

  async function send() {
    if (!text.trim() || sending) return;

    const value = text.trim();
    setSending(true);
    setText('');
    setError(null);

    const result = await sendSupportMessage(value, thread?.subject ?? 'Atendimento');
    if (result.error) {
      setError(result.error);
      setText(value);
    }

    await load(true);
    setSending(false);
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-tum-dark">
      <header className="border-b border-white/10 bg-tum-dark-2/96 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="tum-press flex h-10 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-white/80 transition hover:bg-white/5"
          >
            <ChevronLeft size={20} />
            Voltar
          </button>

          <div className="min-w-0 flex-1 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-tum-yellow/65">SUPORTE TUM</p>
            <h2 className="truncate text-base font-extrabold text-white">Fale conosco</h2>
          </div>

          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-tum-yellow/[0.15] bg-tum-yellow/10 text-tum-yellow">
            <Headphones size={19} />
          </div>
        </div>

        <div className={`mt-3 flex items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 ${status.className}`}>
          <StatusIcon size={17} className="shrink-0" />
          <div>
            <p className="text-xs font-extrabold">{status.label}</p>
            <p className="text-[10px] opacity-70">{status.detail}</p>
          </div>
        </div>
      </header>

      <main className="scrollbar-hide flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-4 rounded-2xl border border-tum-yellow/[0.15] bg-tum-yellow/[0.065] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tum-yellow text-black">
              <Headphones size={18} />
            </div>
            <div>
              <p className="text-sm font-extrabold text-white">Atendimento humanizado</p>
              <p className="mt-1 text-xs leading-5 text-white/50">
                Conte o que aconteceu com o máximo de detalhes. A resposta aparece aqui e também no sininho de notificações.
              </p>
            </div>
          </div>
        </div>

        {loading && messages.length === 0 && (
          <div className="flex min-h-[38vh] flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-tum-yellow/20 bg-tum-yellow/10">
              <Loader2 className="animate-spin text-tum-yellow" size={23} />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Abrindo atendimento</p>
              <p className="mt-1 text-xs text-white/40">Buscando suas mensagens com o TUM.</p>
            </div>
          </div>
        )}

        {!loading && error && messages.length === 0 && (
          <div className="flex min-h-[40vh] flex-col items-center justify-center px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/10 text-red-300">
              <Headphones size={23} />
            </div>
            <p className="mt-4 font-extrabold text-white">Não foi possível abrir o suporte</p>
            <p className="mt-1 max-w-[290px] text-sm leading-5 text-white/45">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="tum-press mt-4 inline-flex items-center gap-2 rounded-xl bg-tum-yellow px-4 py-2.5 text-sm font-extrabold text-black"
            >
              <RefreshCw size={15} />
              Tentar novamente
            </button>
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <div className="flex min-h-[34vh] flex-col items-center justify-center px-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/5 text-tum-yellow">
              <MessageCircleMore size={23} />
            </div>
            <p className="mt-3 font-extrabold text-white">Como podemos ajudar?</p>
            <p className="mt-1 max-w-[285px] text-sm leading-5 text-white/42">
              Escreva a primeira mensagem para iniciar seu atendimento com a equipe do TUM.
            </p>
          </div>
        )}

        {error && messages.length > 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-500/10 px-3 py-2.5 text-xs text-red-200">
            <div className="min-w-0 flex-1">
              <p className="font-bold">Não foi possível concluir a ação</p>
              <p className="mt-0.5 leading-4 text-red-200/70">{error}</p>
            </div>
            <button type="button" onClick={() => setError(null)} className="font-bold text-white/55">OK</button>
          </div>
        )}

        {messages.map((message, index) => {
          const mine = message.sender_type === 'user';
          return (
            <div
              key={message.id}
              className={`tum-card-enter mb-3 flex ${mine ? 'justify-end' : 'justify-start'}`}
              style={{ animationDelay: `${Math.min(index * 24, 140)}ms` }}
            >
              <div className="max-w-[84%]">
                {!mine && (
                  <p className="mb-1 pl-1 text-[10px] font-bold uppercase tracking-wide text-tum-yellow/70">Equipe TUM</p>
                )}
                <div
                  className={`rounded-2xl px-4 py-3 ${
                    mine
                      ? 'rounded-br-sm bg-tum-yellow text-black'
                      : 'rounded-bl-sm border border-white/10 bg-tum-dark-2 text-white'
                  }`}
                >
                  {message.message_type === 'image' && message.image_path ? (
                    <SupportImage path={message.image_path} />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-5">{message.message}</p>
                  )}
                  <p className={`mt-1.5 text-[10px] ${mine ? 'text-black/45' : 'text-white/30'}`}>
                    {new Date(message.created_at).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </main>

      <footer className="border-t border-white/10 bg-tum-dark-2/98 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
        <input
          ref={imageInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void sendPhoto(file);
          }}
        />
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => imageInput.current?.click()}
            disabled={sending || photoSending}
            className="tum-press mb-[15px] flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-tum-dark-3 text-tum-yellow transition disabled:opacity-40"
            aria-label="Enviar foto"
          >
            {photoSending ? <Loader2 size={19} className="animate-spin" /> : <ImagePlus size={20} />}
          </button>
          <div className="min-w-0 flex-1">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
              maxLength={2000}
              placeholder="Digite sua mensagem..."
              className="min-h-12 w-full resize-none rounded-2xl border border-white/10 bg-tum-dark-3 px-3.5 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-tum-yellow/45"
            />
            <div className="mt-1 flex justify-between px-1 text-[9px] text-white/25">
              <span>Enter envia • Shift + Enter quebra linha</span>
              <span>{text.length}/2000</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void send()}
            disabled={!text.trim() || sending}
            className="tum-press mb-[15px] flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-tum-yellow text-black transition disabled:opacity-40"
            aria-label="Enviar mensagem"
          >
            {sending ? <Loader2 size={19} className="animate-spin" /> : <Send size={19} />}
          </button>
        </div>
      </footer>
    </div>
  );
}
