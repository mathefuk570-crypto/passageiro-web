import React, { useEffect, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  Phone,
  ShieldCheck,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';

interface Props {
  profile: Profile;
  onClose: () => void;
  onSaved: (p: Profile) => void;
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatCpf(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export default function EditProfileModal({ profile, onClose, onSaved }: Props) {
  const [fullName, setFullName] = useState(profile.full_name);
  const [email, setEmail] = useState(profile.email ?? '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(profile.avatar_url);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  function onPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (localPreview) URL.revokeObjectURL(localPreview);
    const preview = URL.createObjectURL(file);
    setLocalPreview(preview);
    setPhotoFile(file);
    setPhotoPreview(preview);
    setSuccess(null);
  }

  async function save() {
    setError(null);
    setSuccess(null);

    if (fullName.trim().length < 2) {
      setError('Informe seu nome completo.');
      return;
    }

    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Informe um e-mail válido ou deixe o campo vazio.');
      return;
    }

    if (newPassword) {
      if (newPassword.length < 6) {
        setError('A nova senha precisa ter pelo menos 6 caracteres.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('As duas senhas não são iguais.');
        return;
      }
    }

    setSaving(true);
    try {
      let avatarUrl = profile.avatar_url;

      if (photoFile) {
        const ext = photoFile.name.split('.').pop()?.toLowerCase() || 'jpg';
        const owner = profile.auth_user_id || profile.id;
        const path = `${owner}/avatar-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('profile-photos')
          .upload(path, photoFile, {
            upsert: true,
            contentType: photoFile.type || 'image/jpeg',
          });
        if (uploadError) throw uploadError;
        const { data: publicData } = supabase.storage.from('profile-photos').getPublicUrl(path);
        avatarUrl = publicData.publicUrl;
      }

      if (newPassword) {
        const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword });
        if (passwordError) throw passwordError;
      }

      const { data, error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          email: email.trim() || null,
          avatar_url: avatarUrl,
        })
        .eq('id', profile.id)
        .select('*')
        .maybeSingle();

      if (updateError) throw updateError;
      if (!data) throw new Error('Não foi possível carregar o perfil atualizado.');

      onSaved(data as Profile);
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('Perfil atualizado com sucesso.');
      setTimeout(onClose, 650);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível salvar seu perfil.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/72 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="tum-profile-sheet max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[30px] border border-white/10 bg-tum-dark-2 shadow-2xl sm:rounded-[30px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="h-1 w-full bg-gradient-to-r from-transparent via-tum-yellow to-transparent opacity-85" />
        <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-tum-yellow/70">MINHA CONTA</p>
              <h3 className="mt-1 text-xl font-black text-white">Editar perfil</h3>
              <p className="mt-1 text-xs leading-5 text-white/45">Mantenha seus dados atualizados para uma experiência mais segura.</p>
            </div>
            <button type="button" onClick={onClose} disabled={saving} className="tum-press flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-white/65 disabled:opacity-40">
              <X size={19} />
            </button>
          </div>

          <div className="mb-5 flex items-center gap-4 rounded-2xl border border-white/8 bg-black/15 p-3">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[22px] border-2 border-tum-yellow/25 bg-white/5">
              {photoPreview ? <img src={photoPreview} alt="Sua foto" className="h-full w-full object-cover" /> : <User size={28} className="text-white/30" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black text-white">{fullName || profile.full_name}</p>
              <p className="mt-0.5 text-xs text-white/42">Passageiro TUM</p>
              <label className="tum-press mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-tum-yellow/10 px-3 py-2 text-xs font-extrabold text-tum-yellow">
                <Camera size={14} /> Trocar foto
                <input type="file" accept="image/*" onChange={onPhoto} className="hidden" />
              </label>
            </div>
          </div>

          <div className="space-y-3">
            <EditableField icon={User} label="Nome completo" value={fullName} onChange={setFullName} placeholder="Seu nome" />
            <EditableField icon={Mail} label="E-mail" hint="opcional" value={email} onChange={setEmail} placeholder="seuemail@exemplo.com" type="email" />

            <ReadOnlyField icon={Phone} label="Telefone" value={formatPhone(profile.phone)} />
            <ReadOnlyField icon={CreditCard} label="CPF" value={formatCpf(profile.cpf)} />

            <div className="rounded-2xl border border-white/7 bg-white/[0.025] p-3">
              <div className="flex gap-2.5">
                <ShieldCheck size={18} className="mt-0.5 shrink-0 text-tum-yellow" />
                <p className="text-xs leading-5 text-white/48">
                  Telefone e CPF ficam protegidos porque identificam sua conta. Para alterar esses dados, use o Fale Conosco.
                </p>
              </div>
            </div>

            <div className="my-4 h-px bg-white/7" />

            <div>
              <div className="mb-2 flex items-center gap-2">
                <LockKeyhole size={17} className="text-tum-yellow" />
                <div>
                  <p className="text-sm font-black text-white">Alterar senha</p>
                  <p className="text-[11px] text-white/38">Deixe em branco se não quiser trocar agora.</p>
                </div>
              </div>
              <div className="space-y-2">
                <PasswordField label="Nova senha" value={newPassword} onChange={setNewPassword} show={showPassword} onToggle={() => setShowPassword((current) => !current)} />
                <PasswordField label="Confirmar nova senha" value={confirmPassword} onChange={setConfirmPassword} show={showPassword} />
              </div>
            </div>

            {error && <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
            {success && (
              <div className="flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm font-bold text-emerald-300">
                <CheckCircle2 size={17} /> {success}
              </div>
            )}

            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="tum-primary-cta mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-tum-yellow py-3.5 text-sm font-black text-black transition hover:bg-tum-yellow-dark disabled:opacity-50"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
              {saving ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditableField({ icon: Icon, label, hint, value, onChange, placeholder, type = 'text' }: { icon: LucideIcon; label: string; hint?: string; value: string; onChange: (value: string) => void; placeholder: string; type?: React.HTMLInputTypeAttribute }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 px-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-white/42">{label}{hint && <span className="normal-case tracking-normal text-white/25">· {hint}</span>}</span>
      <div className="flex items-center rounded-2xl border border-white/8 bg-black/18 focus-within:border-tum-yellow/50">
        <Icon size={17} className="ml-3 shrink-0 text-white/35" />
        <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent px-3 py-3.5 text-sm text-white outline-none placeholder:text-white/28" />
      </div>
    </label>
  );
}

function ReadOnlyField({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div>
      <span className="mb-1.5 block px-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-white/35">{label}</span>
      <div className="flex items-center rounded-2xl border border-white/6 bg-white/[0.025] px-3 py-3.5 text-sm text-white/50">
        <Icon size={17} className="mr-3 shrink-0 text-white/27" />
        <span className="min-w-0 flex-1 truncate">{value || 'Não informado'}</span>
        <LockKeyhole size={14} className="shrink-0 text-white/22" />
      </div>
    </div>
  );
}

function PasswordField({ label, value, onChange, show, onToggle }: { label: string; value: string; onChange: (value: string) => void; show: boolean; onToggle?: () => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold text-white/40">{label}</span>
      <div className="flex items-center rounded-2xl border border-white/8 bg-black/18 focus-within:border-tum-yellow/50">
        <LockKeyhole size={16} className="ml-3 shrink-0 text-white/32" />
        <input type={show ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} placeholder="••••••••" autoComplete="new-password" className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-white outline-none placeholder:text-white/25" />
        {onToggle && (
          <button type="button" onClick={onToggle} className="tum-press mr-2 p-1.5 text-white/40" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
            {show ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        )}
      </div>
    </label>
  );
}