import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, MoreVertical, Share2, Smartphone, X } from 'lucide-react';
import {
  detectPwaEnvironment,
  getDeferredInstallPrompt,
  installGuideSteps,
  isStandalonePwa,
  promptPwaInstall,
} from '../lib/pwaInstall';

const SEEN_KEY = 'tum-pwa-install-guide-v3';

function browserLabel(browser: ReturnType<typeof detectPwaEnvironment>['browser']) {
  return browser === 'safari' ? 'Safari'
    : browser === 'chrome' ? 'Chrome'
      : browser === 'samsung' ? 'Samsung Internet'
        : browser === 'edge' ? 'Edge'
          : browser === 'firefox' ? 'Firefox'
            : browser === 'opera' ? 'Opera'
              : 'Navegador';
}

export default function PwaInstallGuide({ runtimePlatform }: { runtimePlatform: string }) {
  const environment = useMemo(() => detectPwaEnvironment(), []);
  const [open, setOpen] = useState(false);
  const [canPrompt, setCanPrompt] = useState(() => Boolean(getDeferredInstallPrompt()));
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (runtimePlatform !== 'web' || !environment.mobile || isStandalonePwa()) return;

    const onReady = () => setCanPrompt(true);
    const onInstalled = () => {
      localStorage.setItem(SEEN_KEY, 'installed');
      setOpen(false);
    };

    window.addEventListener('tum:pwa-install-ready', onReady);
    window.addEventListener('tum:pwa-installed', onInstalled);

    const seen = localStorage.getItem(SEEN_KEY);
    const timer = window.setTimeout(() => {
      if (!seen && !isStandalonePwa()) setOpen(true);
    }, 1400);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('tum:pwa-install-ready', onReady);
      window.removeEventListener('tum:pwa-installed', onInstalled);
    };
  }, [environment.mobile, runtimePlatform]);

  if (runtimePlatform !== 'web' || !environment.mobile || isStandalonePwa() || !open) return null;

  const steps = installGuideSteps(environment.os, environment.browser);
  const deviceLabel = environment.os === 'ios' ? 'iPhone / iPad' : environment.os === 'android' ? 'Android' : 'Celular';

  const dismiss = () => {
    localStorage.setItem(SEEN_KEY, 'seen');
    setOpen(false);
  };

  const installNow = async () => {
    setInstalling(true);
    try {
      const result = await promptPwaInstall();
      if (result === 'accepted') {
        localStorage.setItem(SEEN_KEY, 'installed');
        setOpen(false);
      } else if (result === 'unavailable') {
        setCanPrompt(false);
      }
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/70 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-8 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md overflow-hidden rounded-[30px] border border-white/10 bg-tum-dark-2 shadow-2xl">
        <div className="relative overflow-hidden border-b border-white/10 bg-tum-yellow px-5 pb-5 pt-6 text-black">
          <button
            type="button"
            onClick={dismiss}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/10 transition active:scale-95"
            aria-label="Fechar instruções de instalação"
          >
            <X size={18} />
          </button>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black text-tum-yellow shadow-lg">
            <Smartphone size={24} />
          </div>
          <h2 className="mt-4 pr-10 text-xl font-black">Coloque o TUM na sua tela inicial</h2>
          <p className="mt-1 text-sm font-semibold text-black/65">
            Detectamos {deviceLabel} · {browserLabel(environment.browser)}. Instalado, ele abre como um app e aproveita melhor a tela do celular.
          </p>
        </div>

        <div className="p-5">
          {canPrompt && environment.os === 'android' && (
            <button
              type="button"
              disabled={installing}
              onClick={() => void installNow()}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-tum-yellow px-4 py-3.5 text-sm font-black text-black transition active:scale-[0.99] disabled:opacity-60"
            >
              <Download size={19} />
              {installing ? 'ABRINDO INSTALAÇÃO...' : 'INSTALAR TUM AGORA'}
            </button>
          )}

          <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[.14em] text-white/35">
            {environment.os === 'ios' ? <Share2 size={15} /> : <MoreVertical size={15} />}
            Passo a passo
          </div>
          <div className="space-y-3">
            {steps.map((step, index) => (
              <div key={step} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[.035] p-3.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tum-yellow text-xs font-black text-black">
                  {index + 1}
                </div>
                <p className="pt-0.5 text-sm font-semibold leading-5 text-white/75">{step}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-emerald-400/15 bg-emerald-400/[.07] p-3 text-xs leading-5 text-emerald-100/75">
            <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-300" />
            Depois de instalar, sempre abra pelo ícone do TUM. Assim o navegador não fica ocupando espaço com barra de endereço e controles.
          </div>

          <button
            type="button"
            onClick={dismiss}
            className="mt-4 w-full rounded-2xl border border-white/10 py-3 text-sm font-black text-white"
          >
            ENTENDI
          </button>
        </div>
      </div>
    </div>
  );
}
