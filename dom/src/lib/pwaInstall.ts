export type PwaOS = 'ios' | 'android' | 'other';
export type PwaBrowser =
  | 'safari'
  | 'chrome'
  | 'samsung'
  | 'edge'
  | 'firefox'
  | 'opera'
  | 'other';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    window.dispatchEvent(new CustomEvent('tum:pwa-install-ready'));
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    window.dispatchEvent(new CustomEvent('tum:pwa-installed'));
  });
}

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredInstallPrompt;
}

export async function promptPwaInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = deferredInstallPrompt;
  if (!prompt) return 'unavailable';
  await prompt.prompt();
  const choice = await prompt.userChoice;
  if (choice.outcome === 'accepted') deferredInstallPrompt = null;
  return choice.outcome;
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return window.matchMedia?.('(display-mode: standalone)').matches === true || iosStandalone;
}

export function detectPwaEnvironment(): { os: PwaOS; browser: PwaBrowser; mobile: boolean } {
  if (typeof navigator === 'undefined') return { os: 'other', browser: 'other', mobile: false };

  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const iPadDesktopMode = /Mac/.test(platform) && navigator.maxTouchPoints > 1;
  const ios = /iPad|iPhone|iPod/i.test(ua) || iPadDesktopMode;
  const android = /Android/i.test(ua);

  let browser: PwaBrowser = 'other';
  if (/SamsungBrowser/i.test(ua)) browser = 'samsung';
  else if (/EdgiOS|EdgA|Edg\//i.test(ua)) browser = 'edge';
  else if (/FxiOS|Firefox/i.test(ua)) browser = 'firefox';
  else if (/OPiOS|OPR\//i.test(ua)) browser = 'opera';
  else if (/CriOS|Chrome\//i.test(ua)) browser = 'chrome';
  else if (/Safari/i.test(ua)) browser = 'safari';

  return {
    os: ios ? 'ios' : android ? 'android' : 'other',
    browser,
    mobile: ios || android || /Mobile/i.test(ua),
  };
}


export function installMobileViewportGuards(): () => void {
  if (typeof document === 'undefined') return () => {};

  // Bloqueia zoom da PÁGINA sem matar o pinch/duplo-toque do mapa.
  const isMapTarget = (target: EventTarget | null) =>
    target instanceof Element && Boolean(target.closest('.mapboxgl-map, .leaflet-container'));

  const preventGesture = (event: Event) => {
    if (!isMapTarget(event.target)) event.preventDefault();
  };
  const preventMultiTouch = (event: TouchEvent) => {
    if (event.touches.length > 1 && !isMapTarget(event.target)) event.preventDefault();
  };
  const preventCtrlWheel = (event: WheelEvent) => {
    if (event.ctrlKey && !isMapTarget(event.target)) event.preventDefault();
  };
  const preventDoubleClick = (event: MouseEvent) => {
    if (!isMapTarget(event.target)) event.preventDefault();
  };

  document.addEventListener('gesturestart', preventGesture, { passive: false });
  document.addEventListener('gesturechange', preventGesture, { passive: false });
  document.addEventListener('gestureend', preventGesture, { passive: false });
  document.addEventListener('touchmove', preventMultiTouch, { passive: false });
  document.addEventListener('wheel', preventCtrlWheel, { passive: false });
  document.addEventListener('dblclick', preventDoubleClick, { passive: false });

  return () => {
    document.removeEventListener('gesturestart', preventGesture);
    document.removeEventListener('gesturechange', preventGesture);
    document.removeEventListener('gestureend', preventGesture);
    document.removeEventListener('touchmove', preventMultiTouch);
    document.removeEventListener('wheel', preventCtrlWheel);
    document.removeEventListener('dblclick', preventDoubleClick);
  };
}

export async function registerPwaServiceWorker(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!window.isSecureContext && window.location.hostname !== 'localhost') return;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    void registration.update();
  } catch (error) {
    console.warn('[TUM][PWA] Não foi possível registrar o service worker:', error);
  }
}

export function installGuideSteps(os: PwaOS, browser: PwaBrowser): string[] {
  if (os === 'ios') {
    if (browser === 'safari') {
      return [
        'Toque no botão Compartilhar do Safari (quadrado com uma seta para cima).',
        'Role as opções e toque em “Adicionar à Tela de Início”.',
        'Confira o nome TUM e toque em “Adicionar” no canto superior.',
        'Depois, abra o TUM pelo novo ícone da sua Tela de Início para usar como aplicativo.',
      ];
    }

    const browserName = browser === 'chrome' ? 'Chrome' : browser === 'edge' ? 'Edge' : browser === 'firefox' ? 'Firefox' : 'navegador';
    return [
      `Abra o menu do ${browserName} e procure “Adicionar à Tela de Início” ou “Instalar”.`,
      'Confirme o nome TUM e conclua a instalação.',
      'Se essa opção não aparecer, toque em Compartilhar/Abrir no Safari.',
      'No Safari, toque em Compartilhar → “Adicionar à Tela de Início” → “Adicionar”.',
    ];
  }

  if (os === 'android') {
    if (browser === 'samsung') {
      return [
        'Toque no menu ☰ do Samsung Internet.',
        'Toque em “Adicionar página a” e depois em “Tela inicial”.',
        'Confirme o nome TUM e toque em “Adicionar”.',
        'Abra o TUM pelo ícone criado para usar em tela cheia.',
      ];
    }
    if (browser === 'firefox') {
      return [
        'Toque no menu ⋮ do Firefox.',
        'Toque em “Instalar” ou “Adicionar à tela inicial”.',
        'Confirme a instalação do TUM.',
        'Abra o TUM pelo ícone criado na sua tela inicial.',
      ];
    }
    if (browser === 'edge') {
      return [
        'Abra o menu do Edge.',
        'Procure “Adicionar ao telefone”, “Adicionar à tela inicial” ou “Instalar aplicativo”.',
        'Confirme a instalação do TUM.',
        'Abra o TUM pelo novo ícone da tela inicial.',
      ];
    }
    return [
      'Toque no menu ⋮ do navegador.',
      'Toque em “Instalar app” ou “Adicionar à tela inicial”.',
      'Confirme a instalação do TUM.',
      'Abra o TUM pelo novo ícone da sua tela inicial para usar como aplicativo.',
    ];
  }

  return [
    'Abra o menu do navegador.',
    'Procure “Instalar aplicativo” ou “Adicionar à tela inicial”.',
    'Confirme a instalação do TUM.',
  ];
}
