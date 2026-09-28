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

  // O evento `beforeinstallprompt` só pode ser consumido uma vez.
  deferredInstallPrompt = null;

  if (choice.outcome === 'accepted' && typeof window !== 'undefined') {
    // Libera a aba atual imediatamente depois que o usuário aceitou a
    // instalação. O `appinstalled` continua sendo ouvido como confirmação.
    window.dispatchEvent(new CustomEvent('tum:pwa-install-accepted'));
  }

  return choice.outcome;
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const displayModeApp =
    window.matchMedia?.('(display-mode: fullscreen)').matches === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches === true;
  return displayModeApp || iosStandalone;
}


const HOMESCREEN_QUERY_PARAM = 'tum_home';
const HOMESCREEN_SESSION_KEY = 'tum:install-source-tab';

function createHomescreenToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Prepara a URL que o navegador vai salvar quando o usuário usar
 * "Adicionar à tela inicial" como ATALHO (sem instalar um PWA standalone).
 *
 * A aba atual recebe um marcador em sessionStorage para continuar bloqueada.
 * Ao abrir o atalho pela Tela Inicial, o navegador cria uma nova aba/janela,
 * que herda a URL com o token mas não o sessionStorage desta aba. Assim o TUM
 * consegue reconhecer que foi iniciado pelo ícone mesmo quando o Chrome opta
 * por abrir o atalho dentro do próprio navegador.
 */
export function prepareHomescreenShortcutTarget(): void {
  if (typeof window === 'undefined') return;

  try {
    const url = new URL(window.location.href);
    let token = url.searchParams.get(HOMESCREEN_QUERY_PARAM);

    if (!token) {
      token = createHomescreenToken();
      url.searchParams.set(HOMESCREEN_QUERY_PARAM, token);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }

    window.sessionStorage.setItem(HOMESCREEN_SESSION_KEY, token);
  } catch (error) {
    console.warn('[TUM][PWA] Não foi possível preparar o atalho da Tela Inicial:', error);
  }
}

export function isHomescreenShortcutLaunch(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const token = new URL(window.location.href).searchParams.get(HOMESCREEN_QUERY_PARAM);
    if (!token) return false;

    const sourceTabToken = window.sessionStorage.getItem(HOMESCREEN_SESSION_KEY);
    return sourceTabToken !== token;
  } catch {
    return false;
  }
}

export function isPwaAccessGranted(): boolean {
  return isStandalonePwa() || isHomescreenShortcutLaunch();
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
        'No Safari, toque no botão Compartilhar — o quadrado com uma seta apontando para cima.',
        'Na folha de compartilhamento, deslize as opções para cima até encontrar “Adicionar à Tela de Início”.',
        'Toque em “Adicionar à Tela de Início” e confira se o nome exibido é TUM.',
        'Toque em “Adicionar” no canto superior direito para criar o ícone.',
        'Saia do Safari, volte para a Tela Inicial e abra o TUM pelo novo ícone. É por esse ícone que o acesso ao aplicativo será liberado.',
      ];
    }

    const browserName = browser === 'chrome'
      ? 'Chrome'
      : browser === 'edge'
        ? 'Edge'
        : browser === 'firefox'
          ? 'Firefox'
          : 'navegador';

    return [
      `No ${browserName}, abra o menu de compartilhamento e procure “Adicionar à Tela de Início” ou uma opção para abrir a página no Safari.`,
      'Se “Adicionar à Tela de Início” não aparecer, escolha “Abrir no Safari”.',
      'No Safari, toque no botão Compartilhar — o quadrado com uma seta para cima.',
      'Toque em “Adicionar à Tela de Início”, confira o nome TUM e depois toque em “Adicionar”.',
      'Volte para a Tela Inicial do iPhone/iPad e abra o TUM pelo ícone criado. Não continue usando esta aba do navegador.',
    ];
  }

  if (os === 'android') {
    if (browser === 'samsung') {
      return [
        'No Samsung Internet, toque no menu ☰ na parte inferior do navegador.',
        'Toque em “Adicionar página a”. Se aparecer “Instalar aplicativo”, você também pode escolher essa opção.',
        'Escolha “Tela inicial” e confirme que o nome exibido é TUM.',
        'Toque em “Adicionar” para criar o ícone do TUM na Tela Inicial.',
        'Feche esta aba, volte para a Tela Inicial e abra o TUM pelo ícone criado. O acesso será liberado automaticamente, mesmo se o Samsung Internet tiver criado apenas um atalho.',
      ];
    }

    if (browser === 'firefox') {
      return [
        'Toque no menu ⋮ do Firefox.',
        'Procure “Instalar” ou “Adicionar à tela inicial”.',
        'Confirme a instalação/adição do TUM quando o Android perguntar.',
        'Volte para a Tela Inicial e encontre o novo ícone do TUM.',
        'Abra o TUM pelo ícone instalado/adicionado. Mesmo que o Firefox abra com a barra do navegador, o acesso será liberado por ter sido iniciado pelo ícone.',
      ];
    }

    if (browser === 'edge') {
      return [
        'Abra o menu do Edge no celular.',
        'Procure “Adicionar ao telefone”, “Adicionar à tela inicial” ou “Instalar aplicativo”.',
        'Toque na opção disponível e confirme a instalação do TUM.',
        'Volte para a Tela Inicial do Android e localize o ícone TUM.',
        'Abra pelo ícone instalado/adicionado. Se o Edge tiver criado só um atalho, ele pode manter a barra do navegador, mas o TUM será liberado normalmente.',
      ];
    }

    return [
      'Toque no menu ⋮ do Chrome/navegador, normalmente no canto superior direito.',
      'Procure “Instalar app”, “Instalar aplicativo” ou “Adicionar à tela inicial”.',
      'Toque na opção disponível e confirme “Instalar” ou “Adicionar” quando o Android perguntar.',
      'Volte para a Tela Inicial do celular e localize o novo ícone do TUM.',
      'Abra o TUM pelo ícone instalado/adicionado. Se o Chrome tiver criado apenas um atalho, ele pode abrir com a barra do navegador, mas o TUM será liberado normalmente. Esta aba original continua bloqueada.',
    ];
  }

  return [
    'Abra o menu do navegador.',
    'Procure “Instalar aplicativo” ou “Adicionar à tela inicial”.',
    'Confirme a instalação do TUM.',
    'Abra o TUM pelo ícone criado para concluir.',
  ];
}
