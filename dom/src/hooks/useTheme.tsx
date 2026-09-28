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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const nativeActions = useNativeActions();
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    try { window.localStorage.setItem('tum-theme', theme); } catch {}

    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
    root.dataset.tumTheme = theme;
    root.style.colorScheme = `only ${theme}`;

    // Evita que Chrome/Samsung/Safari "reinterpretem" as cores quando o
    // aparelho está forçando modo claro/escuro diferente do tema escolhido no TUM.
    const colorSchemeMeta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
    if (colorSchemeMeta) colorSchemeMeta.content = theme;

    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = theme === 'dark' ? '#050505' : '#F4F4F5';

    document.body.style.backgroundColor = theme === 'dark' ? '#050505' : '#F4F4F5';
    void nativeActions?.setNativeTheme?.(theme);
  }, [nativeActions, theme]);

  return (
    <Ctx.Provider value={{ theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
