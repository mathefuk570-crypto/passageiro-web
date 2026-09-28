import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Home,
  LoaderCircle,
  MoreVertical,
  Share2,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import {
  detectPwaEnvironment,
  getDeferredInstallPrompt,
  installGuideSteps,
  isPwaAccessGranted,
  isStandalonePwa,
  prepareHomescreenShortcutTarget,
  promptPwaInstall,
} from '../lib/pwaInstall';

type InstallPhase = 'idle' | 'installing' | 'installed';

function browserLabel(browser: ReturnType<typeof detectPwaEnvironment>['browser']) {
  return browser === 'safari' ? 'Safari'
    : browser === 'chrome' ? 'Chrome'
      : browser === 'samsung' ? 'Samsung Internet'
        : browser === 'edge' ? 'Edge'
          : browser === 'firefox' ? 'Firefox'
            : browser === 'opera' ? 'Opera'
              : 'Navegador';
}

function isInstallSecureContext() {
  if (typeof window === 'undefined') return true;
  return window.isSecureContext || window.location.hostname === 'localhost';
}

export default function PwaInstallGuide({ runtimePlatform }: { runtimePlatform: string }) {
  const environment = useMemo(() => detectPwaEnvironment(), []);
  const steps = useMemo(
    () => installGuideSteps(environment.os, environment.browser),
    [environment.browser, environment.os],
  );
  const manualSectionRef = useRef<HTMLDivElement | null>(null);
  const [canPrompt, setCanPrompt] = useState(() => Boolean(getDeferredInstallPrompt()));
  const [phase, setPhase] = useState<InstallPhase>('idle');
  const [manualInstallNotice, setManualInstallNotice] = useState(false);

  useEffect(() => {
    if (runtimePlatform === 'web' && environment.mobile && !isPwaAccessGranted()) {
      prepareHomescreenShortcutTarget();
    }
  }, [environment.mobile, runtimePlatform]);

  useEffect(() => {
    if (runtimePlatform !== 'web' || !environment.mobile || isPwaAccessGranted()) return undefined;

    const onReady = () => setCanPrompt(true);
    const onInstalled = () => {
      // A instalação terminou, mas o TUM continua bloqueado nesta aba do navegador.
      // O acesso é liberado somente quando o usuário abrir o ícone instalado,
      // quando o navegador inicia o app em display-mode: standalone.
      setCanPrompt(false);
      setPhase('installed');
    };

    window.addEventListener('tum:pwa-install-ready', onReady);
    window.addEventListener('tum:pwa-installed', onInstalled);

    return () => {
      window.removeEventListener('tum:pwa-install-ready', onReady);
      window.removeEventListener('tum:pwa-installed', onInstalled);
    };
  }, [environment.mobile, runtimePlatform]);

  useEffect(() => {
    if (runtimePlatform !== 'web' || isPwaAccessGranted()) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [runtimePlatform]);

  if (runtimePlatform !== 'web' || !environment.mobile || isPwaAccessGranted()) return null;

  const deviceLabel = environment.os === 'ios'
    ? 'iPhone / iPad'
    : environment.os === 'android'
      ? 'Android'
      : 'Celular';
  const secureContext = isInstallSecureContext();
  const automaticInstallAvailable = canPrompt && environment.os === 'android' && secureContext;

  const revealManualSteps = () => {
    setManualInstallNotice(true);
    window.setTimeout(() => {
      manualSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const installNow = async () => {
    if (phase === 'installing' || phase === 'installed') return;

    if (!automaticInstallAvailable) {
      revealManualSteps();
      return;
    }

    setPhase('installing');
    setManualInstallNotice(false);

    try {
      const result = await promptPwaInstall();

      if (result === 'dismissed') {
        setPhase('idle');
        revealManualSteps();
        return;
      }

      if (result === 'unavailable') {
        setCanPrompt(false);
        setPhase('idle');
        revealManualSteps();
        return;
      }

      // Alguns navegadores demoram ou não disparam appinstalled de forma confiável.
      // Depois da aceitação, mostramos o estado final sem liberar esta aba.
      window.setTimeout(() => {
        if (!isStandalonePwa()) setPhase('installed');
      }, 2200);
    } catch {
      setPhase('idle');
      revealManualSteps();
    }
  };

  if (phase === 'installed') {
    return (
      <div className="fixed inset-0 z-[2000] overflow-y-auto bg-tum-dark px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-[460px] flex-col items-center justify-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-[26px] bg-tum-yellow text-black shadow-[0_16px_40px_rgba(250,204,21,.20)]">
            <CheckCircle2 size={42} strokeWidth={2.5} />
          </div>

          <p className="mt-6 text-[10px] font-black uppercase tracking-[0.18em] text-tum-yellow">Instalação concluída</p>
          <h1 className="mt-2 text-[28px] font-black leading-[32px] text-white">Agora abra o TUM pelo ícone</h1>
          <p className="mt-3 max-w-[360px] text-sm font-semibold leading-6 text-white/60">
            Esta aba continua bloqueada de propósito. Feche o navegador e toque no ícone do TUM criado na sua Tela Inicial. O TUM vai reconhecer a abertura pelo ícone, inclusive quando o Chrome tiver criado apenas um atalho.
          </p>

          <div className="mt-7 w-full rounded-[24px] border border-white/10 bg-white/[0.035] p-4 text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-tum-yellow text-black">
                <Home size={20} strokeWidth={2.6} />
              </div>
              <div>
                <p className="text-sm font-black text-white">Último passo</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-white/55">
                  Vá para a Tela Inicial do celular, encontre o ícone TUM e abra por ele. O acesso será liberado automaticamente, com ou sem modo standalone.
                </p>
              </div>
            </div>
          </div>

          <p className="mt-5 text-[11px] font-semibold text-white/35">Já abriu pelo ícone e ainda vê esta tela? Feche o TUM completamente e abra novamente.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[2000] overflow-y-auto bg-tum-dark pb-[max(2rem,env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]">
      <div className="mx-auto min-h-[100dvh] w-full max-w-[520px] px-5 pb-8 pt-5">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/icon-192.png"
              alt="TUM"
              className="h-11 w-11 rounded-[14px] object-cover shadow-lg"
              draggable={false}
            />
            <div>
              <p className="text-sm font-black leading-4 text-white">TUM</p>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.13em] text-white/35">Aplicativo do passageiro</p>
            </div>
          </div>

          <div className="rounded-full border border-tum-yellow/25 bg-tum-yellow/[0.08] px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.1em] text-tum-yellow">
            Instalação necessária
          </div>
        </header>

        <main className="pt-9">
          <div className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-tum-yellow text-black shadow-[0_14px_36px_rgba(250,204,21,.18)]">
            <Smartphone size={31} strokeWidth={2.4} />
          </div>

          <h1 className="mt-5 max-w-[390px] text-[29px] font-black leading-[33px] text-white">
            Instale o TUM para continuar
          </h1>
          <p className="mt-3 max-w-[430px] text-[13px] font-semibold leading-5 text-white/58">
            Para solicitar corridas, o TUM precisa estar instalado ou adicionado à Tela Inicial. Depois disso, abra sempre pelo ícone do TUM. Se o navegador instalar o PWA, ele abre como aplicativo; se criar apenas um atalho, o acesso também será liberado pelo ícone.
          </p>

          <div className="mt-5 grid grid-cols-3 gap-2">
            {[
              ['Como aplicativo', 'Tela própria quando o navegador permitir'],
              ['Acesso rápido', 'Direto pela Tela Inicial'],
              ['Sempre atualizado', 'Sem baixar atualizações'],
            ].map(([title, description]) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-3">
                <CheckCircle2 size={15} className="text-tum-yellow" strokeWidth={2.6} />
                <p className="mt-2 text-[11px] font-black leading-4 text-white">{title}</p>
                <p className="mt-0.5 text-[9px] font-semibold leading-[13px] text-white/38">{description}</p>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void installNow()}
            disabled={phase === 'installing'}
            className="tum-primary-cta tum-press mt-6 flex w-full items-center justify-between rounded-[20px] bg-tum-yellow px-4 py-4 text-black transition active:scale-[0.985] disabled:opacity-75"
          >
            <span className="flex items-center gap-3 text-left">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-black text-tum-yellow">
                {phase === 'installing'
                  ? <LoaderCircle size={21} className="animate-spin" strokeWidth={2.8} />
                  : <Download size={21} strokeWidth={2.8} />}
              </span>
              <span>
                <span className="block text-[15px] font-black leading-5">
                  {phase === 'installing'
                    ? 'Instalando o TUM…'
                    : automaticInstallAvailable
                      ? 'INSTALAR TUM AGORA'
                      : 'INSTALAR / ADICIONAR À TELA INICIAL'}
                </span>
                <span className="mt-0.5 block text-[10px] font-bold text-black/55">
                  {automaticInstallAvailable
                    ? 'Toque e confirme a instalação do aplicativo'
                    : `Ver instruções para ${browserLabel(environment.browser)}`}
                </span>
              </span>
            </span>
          </button>

          {!secureContext && (
            <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] px-3.5 py-3">
              <p className="text-[11px] font-black text-amber-200">Instalação automática indisponível neste endereço</p>
              <p className="mt-1 text-[10px] font-semibold leading-4 text-white/48">
                Você está em um endereço de teste sem HTTPS. Para a instalação automática funcionar, abra a versão publicada do TUM em HTTPS. Ainda assim, confira abaixo se o navegador oferece “Adicionar à tela inicial”.
              </p>
            </div>
          )}

          <div ref={manualSectionRef} id="tum-manual-install" className="scroll-mt-4 pt-8">
            <div className="flex items-center gap-2">
              {environment.os === 'ios'
                ? <Share2 size={17} className="text-tum-yellow" />
                : <MoreVertical size={17} className="text-tum-yellow" />}
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-white/42">
                {manualInstallNotice ? 'Instalação manual' : 'Se o botão acima não funcionar'}
              </p>
            </div>

            <h2 className="mt-2 text-[21px] font-black leading-6 text-white">
              Passo a passo — {deviceLabel} · {browserLabel(environment.browser)}
            </h2>
            <p className="mt-2 text-[11px] font-semibold leading-5 text-white/48">
              Faça exatamente os passos abaixo. No final, volte para a Tela Inicial do celular e abra o TUM pelo ícone criado.
            </p>

            <div className="mt-4 space-y-2.5">
              {steps.map((step, index) => (
                <div key={step} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-3.5 py-3.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tum-yellow text-[11px] font-black text-black">
                    {index + 1}
                  </div>
                  <p className="pt-0.5 text-[12px] font-semibold leading-5 text-white/72">{step}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 rounded-[22px] border border-white/10 bg-tum-dark-2 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck size={20} className="mt-0.5 shrink-0 text-tum-yellow" strokeWidth={2.4} />
              <div>
                <p className="text-[12px] font-black text-white">Não apareceu “Instalar” ou “Adicionar à tela inicial”?</p>
                <div className="mt-2 space-y-1.5 text-[10px] font-semibold leading-4 text-white/48">
                  <p>• Atualize a página uma vez e abra novamente o menu do navegador.</p>
                  <p>• No Android, prefira Chrome ou Samsung Internet.</p>
                  <p>• No iPhone, abra o endereço no Safari e use Compartilhar → Adicionar à Tela de Início.</p>
                  <p>• Confirme que está usando a versão oficial publicada em HTTPS, não um endereço local de teste.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-[22px] border border-tum-yellow/20 bg-tum-yellow/[0.06] px-4 py-4 text-center">
            <Home size={18} className="mx-auto text-tum-yellow" strokeWidth={2.5} />
            <p className="mt-2 text-[12px] font-black text-white">Já instalou o TUM?</p>
            <p className="mt-1 text-[10px] font-semibold leading-4 text-white/48">
              Feche esta aba e abra pelo ícone TUM da sua Tela Inicial. Mesmo quando o Chrome cria apenas um atalho e mantém a barra do navegador, o TUM reconhece a abertura pelo ícone e libera o aplicativo.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
