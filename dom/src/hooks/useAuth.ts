import { useCallback, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';
import { disableCurrentPushTokens } from '../lib/pushNotifications';
import {
  clearCachedProfile,
  readCachedProfile,
  saveCachedProfile,
} from '../lib/offlineRecovery';

async function fetchProfile(user: User): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('Erro ao carregar perfil do passageiro:', error);
    throw error;
  }

  return (data as Profile | null) ?? null;
}

export function useAuth() {
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const setProfile = useCallback((nextProfile: Profile) => {
    setProfileState(nextProfile);
    if (nextProfile.auth_user_id) {
      saveCachedProfile(nextProfile.auth_user_id, nextProfile);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const applyUser = async (user: User) => {
      const cached = readCachedProfile(user.id);

      // Mostra o perfil salvo imediatamente. Se o aparelho acabou de ligar sem
      // internet, o passageiro continua dentro do app em vez de cair no login.
      if (active && cached) {
        setProfileState(cached);
        setLoading(false);
      }

      try {
        const recoveredProfile = await fetchProfile(user);
        if (!active) return;

        if (recoveredProfile) {
          setProfileState(recoveredProfile);
          saveCachedProfile(user.id, recoveredProfile);
        } else if (!cached) {
          setProfileState(null);
        }
      } catch (error) {
        // Erro de rede NÃO derruba uma sessão válida nem apaga o perfil em cache.
        console.warn('Perfil remoto indisponível; mantendo sessão local:', error);
        if (active && !cached) {
          // Sem cache não inventamos um perfil. A sessão continua no Supabase e
          // uma nova tentativa será feita quando a conexão voltar.
          setProfileState((current) => current);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    async function recoverSession() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!active) return;

        const user = data.session?.user ?? null;
        if (!user) {
          setProfileState(null);
          setLoading(false);
          return;
        }

        await applyUser(user);
      } catch (error) {
        console.error('Erro ao recuperar sessão:', error);
        if (active) setLoading(false);
      }
    }

    void recoverSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user ?? null;

      if (!user) {
        if (active) {
          // Uma falha de renovação de token sem internet não deve expulsar o
          // passageiro da corrida. Logout feito pelo usuário é tratado pela
          // função logout(), que limpa o cache explicitamente.
          if (event === 'SIGNED_OUT' && typeof navigator !== 'undefined' && navigator.onLine === false) {
            setLoading(false);
            return;
          }
          setProfileState(null);
          setLoading(false);
        }
        return;
      }

      void applyUser(user);
    });

    const refreshWhenOnline = () => {
      void supabase.auth.getSession().then(({ data }) => {
        const user = data.session?.user;
        if (user) void applyUser(user);
      });
    };

    window.addEventListener('online', refreshWhenOnline);

    return () => {
      active = false;
      subscription.unsubscribe();
      window.removeEventListener('online', refreshWhenOnline);
    };
  }, []);

  const login = useCallback((nextProfile: Profile) => {
    setProfile(nextProfile);
  }, [setProfile]);

  const logout = useCallback(async () => {
    try {
      await disableCurrentPushTokens();
    } catch (error) {
      // Não bloquear logout se a limpeza dos tokens de push falhar/offline.
      console.warn('Falha ao desativar tokens de push durante logout:', error);
    }

    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    clearCachedProfile();
    setProfileState(null);
  }, []);

  return {
    profile,
    setProfile,
    login,
    logout,
    loading,
  };
}
