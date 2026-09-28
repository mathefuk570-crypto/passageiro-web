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

    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    root.dataset.tumTheme = theme;
    root.dataset.tumBrowser = /SamsungBrowser/i.test(ua) ? 'samsung' : 'other';
    root.style.colorScheme = theme;
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

        {/*
          IMPORTANTE PARA SAMSUNG INTERNET:
          declaramos os dois esquemas aqui, antes de qualquer CSS. O Samsung
          Internet usa esta declaração para saber que o próprio site trata
          claro/escuro e, nas configurações compatíveis, evita aplicar a
          transformação automática de cores por cima do tema do TUM.
        */}
        <meta name="color-scheme" content="dark light" />
        <meta name="supported-color-schemes" content="dark light" />

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
