import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

const EARLY_THEME_SCRIPT = `
(function () {
  try {
    var root = document.documentElement;
    var stored = window.localStorage.getItem('tum-theme');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    var ua = navigator.userAgent || '';

    var isSamsung = /SamsungBrowser/i.test(ua);
    var scheme = 'only ' + theme;
    var bg = theme === 'dark' ? '#050505' : '#F7F7F8';

    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    root.dataset.tumTheme = theme;
    root.dataset.tumBrowser = isSamsung ? 'samsung' : 'other';

    /*
      Chromium/Samsung Auto Dark pode recolorir a pagina quando ela declara
      suporte generico a dark+light. "only" informa que a pagina ja fornece
      o esquema ativo e que o navegador nao deve fabricar outro por cima.
    */
    root.style.setProperty('color-scheme', scheme, 'important');
    root.style.setProperty('background-color', bg, 'important');

    var colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
    if (colorSchemeMeta) colorSchemeMeta.setAttribute('content', scheme);
    var supportedMeta = document.querySelector('meta[name="supported-color-schemes"]');
    if (supportedMeta) supportedMeta.setAttribute('content', theme);
    var themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', bg);
  } catch (_) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="application-name" content="TUM" />
        <meta name="apple-mobile-web-app-title" content="TUM" />
        <meta name="theme-color" content="#050505" />
        <meta name="darkreader-lock" />

        {/*
          Anti Auto-Dark: começamos travados no dark (tema padrão) e o script
          acima troca sincronamente para `only light` quando necessário.
          Declarar dark+light ao mesmo tempo permitia que algumas versões do
          Samsung Internet aplicassem uma segunda conversão de cores.
        */}
        <meta name="color-scheme" content="only dark" />
        <meta name="supported-color-schemes" content="dark" />

        <script dangerouslySetInnerHTML={{ __html: EARLY_THEME_SCRIPT }} />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="icon" href="/icon-192.png" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
