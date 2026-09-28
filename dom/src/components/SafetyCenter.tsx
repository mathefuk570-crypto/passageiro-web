import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ContactRound,
  Edit3,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
  X,
} from 'lucide-react';

import type { DriverLocation, Profile, Ride, TrustedContact } from '../lib/types';
import {
  MAX_TRUSTED_CONTACTS,
  buildRideShareMessage,
  createRideShareLink,
  deleteTrustedContact,
  formatTrustedPhone,
  loadTrustedContacts,
  phoneForWhatsApp,
  saveTrustedContact,
} from '../lib/safety';
import { useNativeActions } from '../lib/nativeActions';
import AlertModal from './AlertModal';
import SafetyRecordingCard from './SafetyRecordingCard';

interface Props {
  open: boolean;
  onClose: () => void;
  profile: Profile;
  ride?: Ride | null;
  driver?: DriverLocation | null;
}

type FormState = {
  id: string | null;
  name: string;
  phone: string;
  relationship: string;
};

const emptyForm: FormState = {
  id: null,
  name: '',
  phone: '',
  relationship: '',
};

function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export default function SafetyCenter({
  open,
  onClose,
  profile,
  ride = null,
  driver = null,
}: Props) {
  const nativeActions = useNativeActions();
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [alert, setAlert] = useState<{ title: string; message: string; variant?: 'warning' | 'error' | 'success' | 'info' } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TrustedContact | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [sharePreparing, setSharePreparing] = useState(false);

  const rideMessage = useMemo(
    () => (ride ? buildRideShareMessage(ride, driver, shareUrl || null) : ''),
    [ride, driver, shareUrl],
  );

  async function refreshContacts() {
    setLoading(true);
    try {
      setContacts(await loadTrustedContacts(profile.id));
    } catch (error) {
      console.error('[TUM] Erro ao carregar contatos de confiança:', error);
      setAlert({
        title: 'Não conseguimos carregar',
        message: 'Tente novamente em alguns instantes.',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setFormOpen(false);
    setForm(emptyForm);
    void refreshContacts();
  }, [open, profile.id]);

  useEffect(() => {
    let active = true;

    if (!open || !ride?.id) {
      setShareUrl('');
      setSharePreparing(false);
      return () => {
        active = false;
      };
    }

    setShareUrl('');
    setSharePreparing(true);

    void createRideShareLink(ride.id)
      .then((url) => {
        if (active) setShareUrl(url);
      })
      .catch((error) => {
        console.warn('[TUM] Não foi possível preparar o link ao vivo:', error);
      })
      .finally(() => {
        if (active) setSharePreparing(false);
      });

    return () => {
      active = false;
    };
  }, [open, ride?.id]);

  if (!open) return null;

  function startCreate() {
    if (contacts.length >= MAX_TRUSTED_CONTACTS) {
      setAlert({
        title: 'Limite de contatos',
        message: `Você pode manter até ${MAX_TRUSTED_CONTACTS} contatos de confiança. Edite ou remova um deles para adicionar outro.`,
        variant: 'info',
      });
      return;
    }
    setForm(emptyForm);
    setFormOpen(true);
  }

  function startEdit(contact: TrustedContact) {
    setForm({
      id: contact.id,
      name: contact.name,
      phone: formatTrustedPhone(contact.phone),
      relationship: contact.relationship || '',
    });
    setFormOpen(true);
  }

  async function submitContact() {
    const digits = form.phone.replace(/\D/g, '');
    if (form.name.trim().length < 2 || digits.length < 10) {
      setAlert({
        title: 'Confira os dados',
        message: 'Informe um nome e um telefone válido com DDD.',
        variant: 'warning',
      });
      return;
    }

    setSaving(true);
    try {
      await saveTrustedContact({
        passengerId: profile.id,
        id: form.id,
        name: form.name,
        phone: digits,
        relationship: form.relationship,
      });
      await refreshContacts();
      setFormOpen(false);
      setForm(emptyForm);
    } catch (error) {
      console.error('[TUM] Erro ao salvar contato de confiança:', error);
      setAlert({
        title: 'Não foi possível salvar',
        message: 'Confira se esse telefone já não está salvo e tente novamente.',
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteTrustedContact(profile.id, deleteTarget.id);
      setDeleteTarget(null);
      await refreshContacts();
    } catch (error) {
      console.error('[TUM] Erro ao remover contato:', error);
      setDeleteTarget(null);
      setAlert({
        title: 'Não foi possível remover',
        message: 'Tente novamente em alguns instantes.',
        variant: 'error',
      });
    }
  }

  async function shareRide() {
    if (!rideMessage || sharePreparing) return;

    try {
      if (nativeActions?.shareText) {
        const opened = await nativeActions.shareText(
          'Minha corrida TUM',
          rideMessage,
        );
        if (opened) return;
      }

      if (navigator.share) {
        await navigator.share({ title: 'Minha corrida TUM', text: rideMessage });
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(rideMessage);
        setAlert({
          title: 'Dados copiados',
          message: 'Os detalhes da corrida foram copiados. Agora é só colar no aplicativo que preferir.',
          variant: 'success',
        });
        return;
      }

      setAlert({
        title: 'Compartilhamento indisponível',
        message: 'Não conseguimos abrir o compartilhamento neste aparelho agora.',
        variant: 'warning',
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'AbortError') return;

      console.warn('[TUM] Compartilhamento indisponível:', error);
      setAlert({
        title: 'Não foi possível compartilhar',
        message: 'Tente novamente em alguns instantes.',
        variant: 'error',
      });
    }
  }

  function shareWithContact(contact: TrustedContact) {
    if (!rideMessage || sharePreparing) return;
    const phone = phoneForWhatsApp(contact.phone);
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(rideMessage)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <>
      <div className="fixed inset-0 z-[100] flex flex-col bg-tum-dark tum-soft-enter">
        <div className="flex items-center gap-3 border-b border-white/10 bg-tum-dark-2 px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={formOpen ? () => setFormOpen(false) : onClose}
            className="tum-press flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-tum-dark-3 text-white"
            aria-label="Voltar"
          >
            <ArrowLeft size={19} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-tum-yellow">Segurança TUM</p>
            <h2 className="truncate text-lg font-black text-white">
              {formOpen ? (form.id ? 'Editar contato' : 'Novo contato') : 'Central de segurança'}
            </h2>
          </div>
          {!formOpen && (
            <button
              type="button"
              onClick={onClose}
              className="tum-press flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-white/60"
              aria-label="Fechar"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {formOpen ? (
          <div className="flex-1 overflow-y-auto px-4 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <div className="mb-5 rounded-[24px] border border-tum-yellow/20 bg-tum-yellow/[0.07] p-4">
              <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-tum-yellow/15 text-tum-yellow">
                <UserRoundCheck size={22} />
              </div>
              <h3 className="font-black text-white">Contato de confiança</h3>
              <p className="mt-1 text-sm leading-6 text-white/50">
                Cadastre alguém que você consiga avisar rapidamente durante uma corrida.
              </p>
            </div>

            <label className="mb-4 block">
              <span className="mb-2 block text-xs font-bold text-white/55">Nome</span>
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ex.: Mãe"
                maxLength={80}
                className="w-full rounded-2xl border border-white/10 bg-tum-dark-2 px-4 py-3.5 text-sm font-semibold text-white outline-none placeholder:text-white/25 focus:border-tum-yellow/50"
              />
            </label>

            <label className="mb-4 block">
              <span className="mb-2 block text-xs font-bold text-white/55">Telefone com DDD</span>
              <input
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: formatPhoneInput(event.target.value) }))}
                placeholder="(16) 99999-9999"
                inputMode="tel"
                className="w-full rounded-2xl border border-white/10 bg-tum-dark-2 px-4 py-3.5 text-sm font-semibold text-white outline-none placeholder:text-white/25 focus:border-tum-yellow/50"
              />
            </label>

            <label className="mb-6 block">
              <span className="mb-2 block text-xs font-bold text-white/55">Relação (opcional)</span>
              <input
                value={form.relationship}
                onChange={(event) => setForm((current) => ({ ...current, relationship: event.target.value }))}
                placeholder="Ex.: Família, amigo, parceira"
                maxLength={40}
                className="w-full rounded-2xl border border-white/10 bg-tum-dark-2 px-4 py-3.5 text-sm font-semibold text-white outline-none placeholder:text-white/25 focus:border-tum-yellow/50"
              />
            </label>

            <button
              type="button"
              onClick={() => void submitContact()}
              disabled={saving}
              className="tum-primary-cta flex w-full items-center justify-center gap-2 rounded-2xl bg-tum-yellow py-3.5 font-black text-black disabled:opacity-50"
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
              {saving ? 'Salvando...' : 'Salvar contato'}
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <SafetyRecordingCard />
            {ride && (
              <div className="mb-4 rounded-[26px] border border-tum-yellow/20 bg-gradient-to-br from-tum-yellow/[0.12] to-transparent p-4">
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tum-yellow text-black shadow-lg">
                    <ShieldCheck size={24} strokeWidth={2.2} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-tum-yellow">Corrida protegida</p>
                    <h3 className="font-black text-white">Compartilhe seus dados</h3>
                  </div>
                </div>
                <p className="mb-4 text-sm leading-6 text-white/55">
                  Envie nome do motorista, veículo, placa, embarque e destino para alguém de confiança.
                </p>
                <button
                  type="button"
                  onClick={() => void shareRide()}
                  disabled={sharePreparing}
                  className="tum-primary-cta flex w-full items-center justify-center gap-2 rounded-2xl bg-tum-yellow py-3.5 font-black text-black disabled:opacity-60"
                >
                  {sharePreparing ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Send size={18} />
                  )}
                  {sharePreparing ? 'Preparando link seguro...' : 'Compartilhar corrida'}
                </button>

                {!sharePreparing && shareUrl && (
                  <p className="mt-2 text-center text-[10px] font-semibold leading-4 text-white/35">
                    O link compartilhado acompanha o status e a posição da corrida enquanto ela estiver ativa.
                  </p>
                )}
              </div>
            )}

            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/35">Seus contatos</p>
                <h3 className="mt-1 font-black text-white">Contatos de confiança</h3>
              </div>
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-bold text-white/40">
                {contacts.length}/{MAX_TRUSTED_CONTACTS}
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-tum-dark-2 py-8 text-sm font-semibold text-white/45">
                <Loader2 size={18} className="animate-spin text-tum-yellow" />
                Carregando contatos...
              </div>
            ) : contacts.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-white/15 bg-tum-dark-2 p-5 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-white/40">
                  <ContactRound size={23} />
                </div>
                <p className="font-black text-white">Nenhum contato cadastrado</p>
                <p className="mx-auto mt-1 max-w-[260px] text-sm leading-6 text-white/45">
                  Adicione alguém para ter um atalho rápido durante suas viagens.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {contacts.map((contact) => (
                  <div key={contact.id} className="rounded-2xl border border-white/10 bg-tum-dark-2 p-3.5 tum-card-enter">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-tum-yellow/10 font-black text-tum-yellow">
                        {contact.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-black text-white">{contact.name}</p>
                        <p className="mt-0.5 text-xs text-white/45">
                          {formatTrustedPhone(contact.phone)}
                          {contact.relationship ? ` · ${contact.relationship}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => startEdit(contact)}
                        className="tum-press flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-white/55"
                        aria-label="Editar contato"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(contact)}
                        className="tum-press flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/10 text-red-300"
                        aria-label="Excluir contato"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {ride && (
                      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3">
                        <button
                          type="button"
                          onClick={() => { window.location.href = `tel:${contact.phone}`; }}
                          className="tum-press flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-tum-dark-3 py-2.5 text-xs font-bold text-white"
                        >
                          <Phone size={15} />
                          Ligar
                        </button>
                        <button
                          type="button"
                          onClick={() => shareWithContact(contact)}
                          disabled={sharePreparing}
                          className="tum-press flex items-center justify-center gap-2 rounded-xl bg-emerald-500/15 py-2.5 text-xs font-black text-emerald-300 disabled:opacity-45"
                        >
                          <MessageCircle size={15} />
                          WhatsApp
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={startCreate}
              disabled={contacts.length >= MAX_TRUSTED_CONTACTS}
              className="tum-press mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-tum-yellow/25 bg-tum-yellow/[0.07] py-3.5 text-sm font-black text-tum-yellow disabled:opacity-35"
            >
              <Plus size={18} />
              Adicionar contato de confiança
            </button>

            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-tum-yellow" />
              <p className="text-xs leading-5 text-white/45">
                O TUM mostra aqui apenas atalhos de segurança. Em uma situação de risco imediato, procure ajuda presencial ou os serviços de emergência da sua região.
              </p>
            </div>
          </div>
        )}
      </div>

      <AlertModal
        open={Boolean(alert)}
        title={alert?.title}
        message={alert?.message || ''}
        variant={alert?.variant}
        onClose={() => setAlert(null)}
      />

      <AlertModal
        open={Boolean(deleteTarget)}
        title="Remover contato?"
        message={deleteTarget ? `${deleteTarget.name} deixará de aparecer na sua Central de segurança.` : ''}
        variant="warning"
        secondaryLabel="Cancelar"
        actionLabel="Remover"
        onSecondary={() => setDeleteTarget(null)}
        onAction={() => void confirmDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}
