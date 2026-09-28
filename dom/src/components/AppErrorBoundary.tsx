import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

type State = { error: string | null };

export default class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[TUM PASSAGEIRO][UI ERROR]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-tum-dark px-5 text-center text-white">
        <div className="w-full max-w-sm rounded-[28px] border border-white/10 bg-tum-dark-2 p-6 shadow-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300">
            <AlertTriangle size={28} />
          </div>
          <p className="mt-4 text-[10px] font-black uppercase tracking-[.16em] text-tum-yellow">TUM PASSAGEIRO</p>
          <h1 className="mt-1 text-xl font-black">A tela não carregou corretamente</h1>
          <p className="mt-2 text-sm leading-5 text-white/50">
            O TUM preservou sua sessão. Toque abaixo para recarregar a interface.
          </p>
          <p className="mt-3 break-words rounded-xl bg-black/20 p-3 text-[10px] text-white/30">{this.state.error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-tum-yellow py-3.5 font-black text-black"
          >
            <RotateCcw size={18} />
            Recarregar TUM
          </button>
        </div>
      </div>
    );
  }
}
