import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BellRing,
  CheckCheck,
  ChevronLeft,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';

import {
  clearMyNotifications,
  loadMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type InboxNotification,
} from '../lib/notificationsInbox';

interface Props {
  open: boolean;
  onClose: () => void;
  onUnreadChange: (value: number) => void;
  onNavigate?: (url: string) => void;
}

function formatNotificationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  if (sameDay) {
    return `Hoje, ${date.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }

  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NotificationsPanel({
  open,
  onClose,
  onUnreadChange,
  onNavigate,
}: Props) {
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClearVisible, setConfirmClearVisible] = useState(false);

  const unreadCount = useMemo(
    () => items.filter((item) => !item.read_at).length,
    [items],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const result = await loadMyNotifications();
    setItems(result.data);
    setError(result.error);
    onUnreadChange(result.data.filter((item) => !item.read_at).length);
    setLoading(false);
  }, [onUnreadChange]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  async function markAll() {
    if (markingAll || clearing || unreadCount === 0) return;

    setMarkingAll(true);
    const result = await markAllNotificationsRead();
    if (result.error) setError(result.error);
    await load();
    setMarkingAll(false);
  }

  function requestClearAll() {
    if (items.length === 0 || clearing) return;
    setConfirmClearVisible(true);
  }

  async function confirmClearAll() {
    if (clearing) return;

    setClearing(true);
    setError(null);

    const result = await clearMyNotifications();

    if (result.error) {
      setError(result.error);
      setConfirmClearVisible(false);
      setClearing(false);
      return;
    }

    setItems([]);
    onUnreadChange(0);
    setConfirmClearVisible(false);
    setClearing(false);
  }

  async function openNotification(item: InboxNotification) {
    if (!item.read_at) {
      const result = await markNotificationRead(item.id);
      if (result.error) {
        setError(result.error);
      } else {
        await load();
      }
    }

    const url = typeof item.data?.url === 'string' ? item.data.url : '/';
    onNavigate?.(url);
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
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-tum-yellow/65">
              CENTRAL TUM
            </p>
            <h2 className="truncate text-base font-extrabold text-white">Notificações</h2>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void markAll()}
              disabled={markingAll || clearing || unreadCount === 0}
              className="tum-press flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/5 text-tum-yellow transition hover:bg-white/10 disabled:opacity-35"
              aria-label="Marcar todas como lidas"
              title="Marcar todas como lidas"
            >
              {markingAll ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <CheckCheck size={19} />
              )}
            </button>

            <button
              type="button"
              onClick={requestClearAll}
              disabled={clearing || items.length === 0}
              className="tum-press flex h-10 w-10 items-center justify-center rounded-xl border border-red-400/15 bg-red-500/[0.07] text-red-300 transition hover:bg-red-500/[0.12] disabled:opacity-30"
              aria-label="Limpar notificações"
              title="Limpar notificações"
            >
              {clearing ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Trash2 size={19} />
              )}
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.035] px-3.5 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-tum-yellow/10 text-tum-yellow">
              <BellRing size={17} />
            </div>
            <div>
              <p className="text-xs font-bold text-white">Avisos importantes do TUM</p>
              <p className="text-[11px] text-white/40">Corridas, suporte e comunicados</p>
            </div>
          </div>
          <div className="rounded-full border border-tum-yellow/20 bg-tum-yellow/10 px-2.5 py-1 text-[11px] font-extrabold text-tum-yellow">
            {unreadCount} nova{unreadCount === 1 ? '' : 's'}
          </div>
        </div>
      </header>

      <main className="scrollbar-hide flex-1 overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {loading && items.length === 0 && (
          <div className="space-y-2.5 pt-1">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="rounded-2xl border border-white/[0.08] bg-tum-dark-2 p-4">
                <div className="flex gap-3">
                  <div className="tum-skeleton h-10 w-10 shrink-0 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <div className="tum-skeleton h-3.5 w-2/3 rounded-full" />
                    <div className="tum-skeleton h-3 w-full rounded-full" />
                    <div className="tum-skeleton h-3 w-4/5 rounded-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && error && items.length === 0 && (
          <div className="flex min-h-[55vh] flex-col items-center justify-center px-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/10 text-red-300">
              <Bell size={24} />
            </div>
            <h3 className="mt-4 font-extrabold text-white">Não foi possível carregar</h3>
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

        {!loading && !error && items.length === 0 && (
          <div className="flex min-h-[58vh] flex-col items-center justify-center px-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-tum-yellow/20 bg-tum-yellow/10 text-tum-yellow">
              <CheckCheck size={27} />
            </div>
            <h3 className="mt-4 text-lg font-extrabold text-white">Tudo em dia</h3>
            <p className="mt-1 max-w-[280px] text-sm leading-5 text-white/42">
              Quando houver novidades sobre suas corridas ou atendimento, elas aparecem aqui.
            </p>
          </div>
        )}

        {error && items.length > 0 && (
          <div className="mb-3 rounded-2xl border border-red-400/15 bg-red-500/[0.08] px-4 py-3 text-xs font-semibold text-red-200">
            {error}
          </div>
        )}

        {items.map((item, index) => {
          const unread = !item.read_at;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => void openNotification(item)}
              className={`tum-card-enter tum-press mb-2.5 w-full rounded-2xl border p-4 text-left transition ${
                unread
                  ? 'border-tum-yellow/35 bg-tum-yellow/[0.075]'
                  : 'border-white/[0.08] bg-tum-dark-2 hover:bg-white/[0.035]'
              }`}
              style={{ animationDelay: `${Math.min(index * 35, 180)}ms` }}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    unread ? 'bg-tum-yellow text-black' : 'bg-white/5 text-white/40'
                  }`}
                >
                  <BellRing size={17} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 text-sm font-extrabold leading-5 text-white">{item.title}</p>
                    {unread && (
                      <span className="shrink-0 rounded-full bg-tum-yellow/[0.15] px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-tum-yellow">
                        Nova
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm leading-5 text-white/58">{item.message}</p>
                  <p className="mt-2 text-[10px] font-medium text-white/30">{formatNotificationTime(item.created_at)}</p>
                </div>
              </div>
            </button>
          );
        })}
      </main>

      {confirmClearVisible && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-5 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-notifications-title"
        >
          <div className="w-full max-w-[360px] rounded-3xl border border-white/10 bg-tum-dark-2 p-5 shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-red-400/15 bg-red-500/10 text-red-300">
              <Trash2 size={25} />
            </div>

            <h3
              id="clear-notifications-title"
              className="mt-4 text-center text-lg font-extrabold text-white"
            >
              Limpar notificações?
            </h3>

            <p className="mx-auto mt-2 max-w-[300px] text-center text-sm leading-5 text-white/48">
              Todas as notificações desta conta serão apagadas. Essa ação não pode ser desfeita.
            </p>

            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmClearVisible(false)}
                disabled={clearing}
                className="tum-press h-12 flex-1 rounded-2xl border border-white/10 bg-white/5 text-sm font-extrabold text-white/80 disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() => void confirmClearAll()}
                disabled={clearing}
                className="tum-press flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-red-500 text-sm font-extrabold text-white shadow-lg shadow-red-950/20 disabled:opacity-60"
              >
                {clearing ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : (
                  <Trash2 size={17} />
                )}
                Limpar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
