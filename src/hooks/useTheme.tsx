import React from 'react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useNativeActions } from '../lib/nativeActions';

type Theme = 'dark' | 'light';

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ theme: 'dark', toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const nativeActions = useNativeActions();
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('tum-theme');
    return stored === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    localStorage.setItem('tum-theme', theme);
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
    void nativeActions?.setNativeTheme?.(theme);
  }, [nativeActions, theme]);

  return (
    <Ctx.Provider value={{ theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
