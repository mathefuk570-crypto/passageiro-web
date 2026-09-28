import React from 'react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useNativeActions } from '../lib/nativeActions';

type Theme = 'dark' | 'light';

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ theme: 'dark', toggle: () => {} });

function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem('tum-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}

  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function ensureMeta(name: string, content: string) {
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = name;
    document.head.prepend(meta);
  }
  meta.content = content;
  return meta;
}

function applyDocumentTheme(theme: Theme) {
  const root = document.documentElement;
  const ua = navigator.userAgent || '';

  root.classList.remove('dark', 'light');
  root.classList.add(theme);
  root.dataset.tumTheme = theme;
  root.dataset.tumBrowser = /SamsungBrowser/i.test(ua) ? 'samsung' : 'other';

  /*
    Trava o esquema ATIVO em vez de anunciar dark+light simultaneamente.
    `only light`/`only dark` e a forma suportada pelo Chromium para dizer que
    o site ja cuida das cores e nao precisa de Auto Dark/Force Dark adicional.
    Isso evita o segundo processamento de cor observado no Samsung Internet.
  */
  const scheme = `only ${theme}`;
  const background = theme === 'dark' ? '#050505' : '#F7F7F8';

  ensureMeta('color-scheme', scheme);
  // Compatibilidade com engines Samsung antigas que ainda consultam esta meta.
  ensureMeta('supported-color-schemes', theme);
  ensureMeta('theme-color', background);
  ensureMeta('darkreader-lock', '');

  root.style.setProperty('color-scheme', scheme, 'important');
  root.style.setProperty('background-color', background, 'important');

  if (document.body) {
    document.body.dataset.tumTheme = theme;
    document.body.style.setProperty('color-scheme', scheme, 'important');
    document.body.style.setProperty('background-color', background, 'important');
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const nativeActions = useNativeActions();
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    try { window.localStorage.setItem('tum-theme', theme); } catch {}

    const reapply = () => applyDocumentTheme(theme);
    reapply();

    /*
      Alguns navegadores Android reavaliam o modo escuro ao voltar de outra
      aba/app. Reaplicamos a escolha do TUM nesses eventos para não voltar com
      cores alteradas depois de minimizar o navegador.
    */
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reapply();
    };

    window.addEventListener('pageshow', reapply);
    window.addEventListener('focus', reapply);
    document.addEventListener('visibilitychange', onVisibility);

    void nativeActions?.setNativeTheme?.(theme);

    return () => {
      window.removeEventListener('pageshow', reapply);
      window.removeEventListener('focus', reapply);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [nativeActions, theme]);

  return (
    <Ctx.Provider value={{ theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
