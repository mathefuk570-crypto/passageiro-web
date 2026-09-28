import React, { useEffect, useMemo, useState } from 'react';
import {
  Camera,
  Check,
  CreditCard,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Lock,
  KeyRound,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  User,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { City, Profile } from '../lib/types';
import AccessRecovery from './AccessRecovery';
import LegalCenter, { PRIVACY_VERSION, TERMS_VERSION, type LegalTab } from './LegalCenter';

interface Props {
  onAuth: (profile: Profile) => void;
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '').slice(0, 11);
}

function normalizeCpf(value: string): string {
  return value.replace(/\D/g, '').slice(0, 11);
}

function formatPhone(value: string): string {
  const digits = normalizePhone(value);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatCpf(value: string): string {
  const digits = normalizeCpf(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function technicalEmail(phone: string): string {
  return `${normalizePhone(phone)}@tum-passenger.app`;
}

async function loadOwnProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Perfil do passageiro não encontrado.');
  return data as Profile;
}

async function loadActiveCities(): Promise<City[]> {
  const { data, error } = await supabase
    .from('cities')
    .select('id, name, state, active')
    .eq('active', true)
    .order('name', { ascending: true });

  if (error) throw error;
  return (data ?? []) as City[];
}

export default function AuthScreen({ onAuth }: Props) {
  const [screen, setScreen] = useState<'choice' | 'login' | 'register'>('choice');
  const mode: 'login' | 'register' = screen === 'register' ? 'register' : 'login';
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [cityId, setCityId] = useState('');
  const [cities, setCities] = useState<City[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [citiesError, setCitiesError] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);
  const [legalTab, setLegalTab] = useState<LegalTab>('terms');
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  const passwordChecks = useMemo(
    () => ({
      length: password.length >= 6,
      number: /\d/.test(password),
    }),
    [password],
  );

  useEffect(() => {
    let active = true;

    async function fetchCities() {
      setCitiesLoading(true);
      setCitiesError(null);
      try {
        const activeCities = await loadActiveCities();
        if (!active) return;
        setCities(activeCities);
        setCityId((current) => {
          if (current && activeCities.some((city) => city.id === current)) return current;
          return activeCities.length === 1 ? activeCities[0].id : '';
        });
      } catch (caughtError) {
        if (!active) return;
        console.error('Erro ao carregar cidades ativas:', caughtError);
        setCities([]);
        setCityId('');
        setCitiesError('Não foi possível carregar as cidades disponíveis.');
      } finally {
        if (active) setCitiesLoading(false);
      }
    }

    void fetchCities();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  function switchMode(nextMode: 'login' | 'register') {
    setScreen(nextMode);
    setError(null);
    setPassword('');
    setShowPassword(false);
    if (nextMode === 'register') setAcceptedLegal(false);
  }

  function backToChoice() {
    setScreen('choice');
    setError(null);
    setLoading(false);
    setShowPassword(false);
  }

  function onPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleRegister() {
    setError(null);
    const normalizedPhone = normalizePhone(phone);
    const normalizedCpf = normalizeCpf(cpf);
    const authEmail = technicalEmail(normalizedPhone);

    if (fullName.trim().length < 2) return setError('Informe o nome completo.');
    if (normalizedCpf.length !== 11) return setError('Informe um CPF com 11 números.');
    if (normalizedPhone.length < 10) return setError('Informe um telefone válido.');
    if (!cityId || !cities.some((city) => city.id === cityId)) {
      return setError('Selecione uma cidade disponível.');
    }
    if (password.length < 6) return setError('A senha precisa ter pelo menos 6 caracteres.');
    if (!acceptedLegal) return setError('Leia e aceite os Termos de Uso e o Aviso de Privacidade para criar sua conta.');

    setLoading(true);
    try {
      let userId = '';

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: authEmail,
        password,
      });

      if (signUpError) {
        const normalizedMessage = signUpError.message.toLowerCase();
        const looksExisting =
          normalizedMessage.includes('already') ||
          normalizedMessage.includes('registered') ||
          normalizedMessage.includes('exists');

        if (!looksExisting) throw signUpError;

        // Cadastro anterior pode ter parado depois de criar o Auth e antes de
        // criar o perfil. Com a mesma senha, retomamos o cadastro em vez de
        // deixar telefone/CPF presos em um usuário invisível no painel.
        const { data: resumedSession, error: resumeError } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password,
        });
        if (resumeError || !resumedSession.user) {
          throw new Error('Este telefone já possui uma conta. Entre com sua senha ou use a recuperação de acesso.');
        }

        userId = resumedSession.user.id;
        try {
          const existingProfile = await loadOwnProfile(userId);
          const { error: resumedLegalError } = await supabase.rpc('record_passenger_legal_acceptance_tum', {
            p_terms_version: TERMS_VERSION,
            p_privacy_version: PRIVACY_VERSION,
          });
          if (resumedLegalError) {
            console.warn('[TUM] Não foi possível registrar o aceite legal ao retomar cadastro:', resumedLegalError);
          }
          onAuth(existingProfile);
          return;
        } catch (profileError) {
          const message = profileError instanceof Error ? profileError.message : '';
          if (!message.includes('Perfil do passageiro não encontrado')) throw profileError;
          // Sem perfil: continua abaixo e finaliza o cadastro interrompido.
        }
      } else {
        const user = signUpData.user;
        if (!user) throw new Error('Não foi possível criar o usuário.');
        userId = user.id;

        if (!signUpData.session) {
          const { data: resumedSession, error: resumeError } = await supabase.auth.signInWithPassword({
            email: authEmail,
            password,
          });
          if (resumeError || !resumedSession.user) {
            throw new Error('A conta foi criada, mas a sessão não pôde ser iniciada. Tente entrar com o mesmo telefone e senha.');
          }
          userId = resumedSession.user.id;
        }
      }

      let avatarUrl: string | null = null;
      if (photoFile) {
        try {
          const extension = photoFile.name.split('.').pop()?.toLowerCase() || 'jpg';
          const path = `${userId}/avatar-${Date.now()}.${extension}`;
          const { error: uploadError } = await supabase.storage
            .from('profile-photos')
            .upload(path, photoFile, {
              upsert: true,
              contentType: photoFile.type || 'image/jpeg',
            });
          if (uploadError) throw uploadError;
          const { data: publicData } = supabase.storage.from('profile-photos').getPublicUrl(path);
          avatarUrl = publicData.publicUrl;
        } catch (avatarError) {
          // Foto é opcional: uma falha no Storage nunca deve deixar o cadastro
          // preso depois que o usuário do Auth já foi criado.
          console.warn('[TUM] Foto de perfil não enviada; continuando cadastro:', avatarError);
        }
      }

      const { data: profileData, error: profileError } = await supabase.rpc(
        'complete_passenger_profile',
        {
          p_full_name: fullName.trim(),
          p_phone: normalizedPhone,
          p_cpf: normalizedCpf,
          p_email: email.trim() || null,
          p_avatar_url: avatarUrl,
          p_city_id: cityId,
        },
      );
      if (profileError) throw profileError;

      const newProfile = profileData as Profile | null;
      if (!newProfile) throw new Error('A conta foi criada, mas o perfil não foi carregado. Tente entrar novamente.');

      const { error: legalError } = await supabase.rpc('record_passenger_legal_acceptance_tum', {
        p_terms_version: TERMS_VERSION,
        p_privacy_version: PRIVACY_VERSION,
      });
      if (legalError) {
        console.warn('[TUM] Não foi possível registrar o aceite legal:', legalError);
      }

      onAuth(newProfile);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Não foi possível criar a conta.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin() {
    setError(null);
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone.length < 10 || !password) {
      setError('Informe telefone e senha.');
      return;
    }

    setLoading(true);
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: technicalEmail(normalizedPhone),
        password,
      });

      if (signInError) {
        if (signInError.message.toLowerCase().includes('invalid login')) {
          throw new Error('Telefone ou senha incorretos.');
        }
        throw signInError;
      }
      if (!data.user) throw new Error('Não foi possível iniciar a sessão.');
      onAuth(await loadOwnProfile(data.user.id));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Erro no login.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
    <div className="tum-auth-page h-[100dvh] overflow-y-auto overscroll-contain bg-tum-dark px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <div className={`mx-auto flex min-h-full w-full max-w-md justify-center py-4 ${screen === 'register' ? 'items-start' : 'items-center'}`}>
        <div className="tum-auth-card w-full overflow-hidden rounded-[30px] border border-white/10 bg-tum-dark-2 shadow-2xl">
          <div className="h-1 w-full bg-gradient-to-r from-transparent via-tum-yellow to-transparent opacity-90" />

          <div className="p-5 sm:p-7">
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="mb-3 h-24 w-24 overflow-hidden rounded-[26px]">
                <img
                  src={`${process.env.EXPO_BASE_URL ?? '/'}tum-logo-login.png`}
                  alt="Logo do TUM"
                  className="h-full w-full object-contain"
                />
              </div>
              <p className="text-[10px] font-black uppercase tracking-[0.26em] text-tum-yellow/75">TUM</p>
              <h1 className="mt-1 text-2xl font-black text-white">TUM Passageiro</h1>
              <p className="mt-1 text-sm text-white/48">Sua corrida começa de um jeito simples.</p>
            </div>

            {screen === 'choice' ? (
              <div className="tum-soft-enter">
                <div className="mb-5 rounded-2xl border border-white/8 bg-black/20 p-4 text-center">
                  <p className="text-lg font-black text-white">Como você quer continuar?</p>
                  <p className="mt-2 text-sm leading-6 text-white/50">Escolha uma opção abaixo para entrar na sua conta ou fazer um novo cadastro.</p>
                </div>

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="tum-primary-cta flex w-full items-center justify-center gap-2 rounded-2xl bg-tum-yellow px-4 py-4 text-sm font-black text-black shadow-lg shadow-black/20 transition hover:bg-tum-yellow-dark"
                  >
                    <ShieldCheck size={18} />
                    Já tenho uma conta
                  </button>

                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className="tum-press flex w-full items-center justify-center gap-2 rounded-2xl border border-white/8 bg-white/[0.035] px-4 py-4 text-sm font-black text-white transition hover:bg-white/[0.055]"
                  >
                    <User size={18} />
                    Quero criar minha conta
                  </button>
                </div>

                <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.025] p-4 text-left">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-tum-yellow/80">Importante</p>
                  <p className="mt-2 text-sm leading-6 text-white/55">
                    Se você já fez cadastro no TUM, toque em <span className="font-black text-white">Já tenho uma conta</span> para entrar.
                    <br />
                    Se ainda não tem cadastro, toque em <span className="font-black text-white">Quero criar minha conta</span> e preencha seus dados para começar a pedir corridas.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-black/20 p-1.5 pl-3">
                  <div>
                    <p className="text-sm font-black text-white">{mode === 'login' ? 'Entrar na minha conta' : 'Criar nova conta'}</p>
                    <p className="text-[11px] text-white/40">{mode === 'login' ? 'Use seu telefone e senha para continuar.' : 'Preencha seus dados para começar a usar o TUM.'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={backToChoice}
                    className="tum-press rounded-xl border border-white/8 bg-white/[0.035] px-3 py-2 text-xs font-black text-white/80"
                  >
                    Voltar
                  </button>
                </div>

            {mode === 'register' && (
              <div className="tum-soft-enter mb-4 space-y-3">
                <div className="rounded-2xl border border-white/8 bg-black/15 p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-tum-yellow/25 bg-white/5">
                      {photoPreview ? (
                        <img src={photoPreview} alt="Prévia da foto" className="h-full w-full object-cover" />
                      ) : (
                        <User size={24} className="text-white/35" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-extrabold text-white">Foto de perfil <span className="font-semibold text-white/35">(opcional)</span></p>
                      <p className="mt-0.5 text-xs leading-5 text-white/45">Você pode adicionar agora ou completar depois.</p>
                      <label className="tum-press mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-white/7 px-3 py-2 text-xs font-bold text-tum-yellow">
                        {photoPreview ? <Camera size={14} /> : <ImagePlus size={14} />}
                        {photoPreview ? 'Trocar foto' : 'Adicionar foto'}
                        <input type="file" accept="image/*" onChange={onPhoto} className="hidden" />
                      </label>
                    </div>
                  </div>
                </div>

                <Field label="Nome completo" icon={User} placeholder="Como podemos chamar você?" value={fullName} onChange={setFullName} autoComplete="name" />
                <Field label="CPF" icon={CreditCard} placeholder="000.000.000-00" value={cpf} onChange={(value) => setCpf(formatCpf(value))} inputMode="numeric" autoComplete="off" />
                <Field label="Telefone" icon={Phone} placeholder="(16) 99999-9999" value={phone} onChange={(value) => setPhone(formatPhone(value))} inputMode="tel" autoComplete="tel" />

                <SelectField icon={MapPin} label="Cidade" value={cityId} onChange={setCityId} disabled={citiesLoading || cities.length === 0}>
                  <option value="" className="bg-white text-black">
                    {citiesLoading ? 'Carregando cidades...' : cities.length === 0 ? 'Nenhuma cidade disponível' : 'Selecione sua cidade'}
                  </option>
                  {cities.map((city) => (
                    <option key={city.id} value={city.id} className="bg-white text-black">
                      {city.name}{city.state ? ` - ${city.state.toUpperCase()}` : ''}
                    </option>
                  ))}
                </SelectField>

                {citiesError && <Notice tone="error">{citiesError}</Notice>}

                <Field label="E-mail" hint="Opcional" icon={Mail} placeholder="seuemail@exemplo.com" value={email} onChange={setEmail} type="email" inputMode="email" autoComplete="email" />
                <Field
                  label="Crie sua senha"
                  icon={Lock}
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={setPassword}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  trailing={
                    <button type="button" onClick={() => setShowPassword((current) => !current)} className="tum-press p-1 text-white/45" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  }
                />

                <div className="grid grid-cols-2 gap-2 px-1 text-[11px]">
                  <PasswordCheck ok={passwordChecks.length}>6 ou mais caracteres</PasswordCheck>
                  <PasswordCheck ok={passwordChecks.number}>Inclua um número</PasswordCheck>
                </div>

                <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.025] p-3">
                  <button
                    type="button"
                    aria-label={acceptedLegal ? 'Desmarcar aceite legal' : 'Aceitar termos e privacidade'}
                    onClick={() => setAcceptedLegal((current) => !current)}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                      acceptedLegal ? 'border-tum-yellow bg-tum-yellow text-black' : 'border-white/20 bg-black/15 text-transparent'
                    }`}
                  >
                    <Check size={13} strokeWidth={3} />
                  </button>
                  <span className="text-[11px] leading-5 text-white/45">
                    Li e concordo com os{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setLegalTab('terms');
                        setLegalOpen(true);
                      }}
                      className="font-black text-tum-yellow"
                    >
                      Termos de Uso
                    </button>{' '}
                    e o{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setLegalTab('privacy');
                        setLegalOpen(true);
                      }}
                      className="font-black text-tum-yellow"
                    >
                      Aviso de Privacidade
                    </button>.
                  </span>
                </div>
              </div>
            )}

            {mode === 'login' && (
              <div className="tum-soft-enter mb-5 space-y-3">
                <Field label="Telefone" icon={Phone} placeholder="(16) 99999-9999" value={phone} onChange={(value) => setPhone(formatPhone(value))} inputMode="tel" autoComplete="tel" />
                <Field
                  label="Senha"
                  icon={Lock}
                  placeholder="Sua senha"
                  value={password}
                  onChange={setPassword}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  trailing={
                    <button type="button" onClick={() => setShowPassword((current) => !current)} className="tum-press p-1 text-white/45" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  }
                />
                <button
                  type="button"
                  onClick={() => setRecoveryOpen(true)}
                  className="tum-press flex w-full items-center gap-3 rounded-2xl border border-white/7 bg-white/[0.025] px-3 py-3 text-left"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tum-yellow/10 text-tum-yellow">
                    <KeyRound size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black text-white">Esqueceu a senha?</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-white/40">Solicite recuperação sem expor sua conta.</p>
                  </div>
                  <span className="text-white/25">›</span>
                </button>
              </div>
            )}

              </>
            )}

            {screen !== 'choice' && (
              <>
                {error && <Notice tone="error">{error}</Notice>}

                <button
                  type="button"
                  onClick={mode === 'login' ? handleLogin : handleRegister}
                  disabled={loading || (mode === 'register' && (citiesLoading || cities.length === 0 || Boolean(citiesError)))}
                  className="tum-primary-cta mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-tum-yellow py-3.5 text-sm font-black text-black shadow-lg shadow-black/20 transition hover:bg-tum-yellow-dark disabled:opacity-50"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                  {loading ? (mode === 'login' ? 'Entrando...' : 'Criando conta...') : mode === 'login' ? 'Entrar no TUM' : 'Criar minha conta'}
                </button>

                <div className="mt-4 text-center text-[11px] leading-5 text-white/35">
                  <p>Sua sessão permanece protegida neste aparelho até você sair da conta.</p>
                  <div className="mt-1.5 flex items-center justify-center gap-2">
                    <button type="button" onClick={() => { setLegalTab('terms'); setLegalOpen(true); }} className="font-bold text-white/50">Termos</button>
                    <span className="text-white/15">•</span>
                    <button type="button" onClick={() => { setLegalTab('privacy'); setLegalOpen(true); }} className="font-bold text-white/50">Privacidade</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
    <LegalCenter open={legalOpen} onClose={() => setLegalOpen(false)} initialTab={legalTab} />
    <AccessRecovery open={recoveryOpen} onClose={() => setRecoveryOpen(false)} initialPhone={phone} />
    </>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone: 'error' | 'info' }) {
  return (
    <div className={`mb-3 rounded-2xl border p-3 text-sm leading-5 ${tone === 'error' ? 'border-red-400/20 bg-red-500/10 text-red-300' : 'border-sky-400/20 bg-sky-500/10 text-sky-200'}`}>
      {children}
    </div>
  );
}

function PasswordCheck({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-1.5 ${ok ? 'text-emerald-300' : 'text-white/35'}`}>
      <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${ok ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-white/10'}`}>
        {ok && <Check size={10} strokeWidth={3} />}
      </span>
      {children}
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  hint,
  placeholder,
  value,
  onChange,
  type = 'text',
  inputMode,
  autoComplete,
  trailing,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  type?: React.HTMLInputTypeAttribute;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-white/45">
        {label}{hint && <span className="normal-case tracking-normal text-white/28">· {hint}</span>}
      </span>
      <div className="flex items-center rounded-2xl border border-white/8 bg-black/20 transition focus-within:border-tum-yellow/55 focus-within:bg-black/25">
        <Icon size={18} className="ml-3 shrink-0 text-white/38" />
        <input
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-3 py-3.5 text-sm text-white outline-none placeholder:text-white/28"
        />
        {trailing && <div className="mr-2 shrink-0">{trailing}</div>}
      </div>
    </label>
  );
}

function SelectField({
  icon: Icon,
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block px-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-white/45">{label}</span>
      <div className="relative flex items-center rounded-2xl border border-white/8 bg-black/20 transition focus-within:border-tum-yellow/55">
        <Icon size={18} className="ml-3 shrink-0 text-white/38" />
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="tum-city-select min-w-0 flex-1 appearance-none bg-transparent px-3 py-3.5 pr-9 text-sm text-white outline-none disabled:opacity-50"
        >
          {children}
        </select>
        <span className="pointer-events-none absolute right-3 text-white/35">▾</span>
      </div>
    </label>
  );
}