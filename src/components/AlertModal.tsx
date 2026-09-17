import React, { useEffect } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
} from 'lucide-react';

export type AlertModalVariant = 'warning' | 'error' | 'success' | 'info';

interface Props {
  open: boolean;
  title?: string;
  message: string;
  onClose: () => void;
  variant?: AlertModalVariant;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

const variantConfig = {
  warning: {
    Icon: AlertTriangle,
    ring: 'border-tum-yellow/30 bg-tum-yellow/[0.12]',
    icon: 'text-tum-yellow',
  },
  error: {
    Icon: AlertCircle,
    ring: 'border-red-400/25 bg-red-500/10',
    icon: 'text-red-300',
  },
  success: {
    Icon: CheckCircle2,
    ring: 'border-emerald-400/25 bg-emerald-500/10',
    icon: 'text-emerald-300',
  },
  info: {
    Icon: Info,
    ring: 'border-sky-400/25 bg-sky-500/10',
    icon: 'text-sky-300',
  },
} as const;

export default function AlertModal({
  open,
  title = 'Aviso',
  message,
  onClose,
  variant = 'warning',
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: Props) {
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const config = variantConfig[variant];
  const Icon = config.Icon;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/72 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tum-alert-title"
        className="tum-home-sheet relative w-full max-w-sm overflow-hidden rounded-[28px] border border-white/10 bg-tum-dark-2 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="h-1 w-full bg-gradient-to-r from-transparent via-tum-yellow to-transparent opacity-80" />

        <button
          type="button"
          onClick={onClose}
          className="tum-press absolute right-3 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/55 transition hover:bg-white/10 hover:text-white"
          aria-label="Fechar"
        >
          <X size={17} />
        </button>

        <div className="px-6 pb-6 pt-6 text-center">
          <img
            src={`${'/'}tum-logo-login.png`}
            alt="TUM"
            className="mx-auto mb-3 h-14 w-14 rounded-2xl object-cover"
          />
          <div
            className={`mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border ${config.ring}`}
          >
            <Icon size={21} className={config.icon} strokeWidth={2.1} />
          </div>

          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-tum-yellow/70">
            TUM
          </p>
          <h2 id="tum-alert-title" className="mt-1 text-lg font-extrabold text-white">
            {title}
          </h2>
          <p className="mx-auto mt-2 max-w-[290px] text-sm leading-6 text-white/58">
            {message}
          </p>

          <div className="mt-6 flex gap-2">
            {secondaryLabel && (
              <button
                type="button"
                onClick={() => {
                  onSecondary?.();
                  onClose();
                }}
                className="tum-press flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/10"
              >
                {secondaryLabel}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (onAction) {
                  void onAction();
                } else {
                  onClose();
                }
              }}
              className="tum-primary-cta flex-1 rounded-2xl bg-tum-yellow px-4 py-3 text-sm font-extrabold text-black transition hover:bg-tum-yellow-dark"
            >
              {actionLabel || 'Entendido'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
