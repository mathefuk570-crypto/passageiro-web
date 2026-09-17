import { useCallback, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';
import { disableCurrentPushTokens } from '../lib/pushNotifications';

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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function recoverSession() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!active) return;

        const user = data.session?.user ?? null;
        if (!user) {
          setProfile(null);
          return;
        }

        const recoveredProfile = await fetchProfile(user);
        if (active) setProfile(recoveredProfile);
      } catch (error) {
        console.error('Erro ao recuperar sessão:', error);
        if (active) setProfile(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    void recoverSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;

      if (!user) {
        if (active) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }

      void fetchProfile(user)
        .then((nextProfile) => {
          if (active) setProfile(nextProfile);
        })
        .catch(() => {
          if (active) setProfile(null);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const login = useCallback((nextProfile: Profile) => {
    setProfile(nextProfile);
  }, []);

  const logout = useCallback(async () => {
    await disableCurrentPushTokens();

    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setProfile(null);
  }, []);

  return {
    profile,
    setProfile,
    login,
    logout,
    loading,
  };
}
