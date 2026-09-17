import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Banknote,
  CarFront,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  History,
  LogOut,
  FileText,
  MapPin,
  MessageCircle,
  Newspaper,
  Pencil,
  ReceiptText,
  RefreshCw,
  Route,
  Settings,
  ShieldCheck,
  Smartphone,
  UserRound,
  Sparkles,
  Volume2,
  WalletCards,
  X,
  type LucideIcon,
} from 'lucide-react';

import { supabase } from '../lib/supabase';
import type { Profile, Ride } from '../lib/types';
import { formatBRL } from '../lib/categories';
import type { AlertAudioMode } from '../lib/audioPreferences';
import SafetyCenter from './SafetyCenter';
import LegalCenter, { type LegalTab } from './LegalCenter';
import PermissionsCenter from './PermissionsCenter';

interface Props {
  open: boolean;
  onClose: () => void;
  profile: Profile;
  audioMode: AlertAudioMode;
  onAudioModeChange: (mode: AlertAudioMode) => void | Promise<void>;
  onEditProfile: () => void;
  onOpenNotifications: () => void;
  onOpenNews: () => void;
  onOpenSupport: () => void;
  onLogout: () => void | Promise<void>;
  unreadCount: number;
}

type Tab = 'menu' | 'trips' | 'payments' | 'settings';
type PayTab = 'cash' | 'pix';


type RideDriverSummary = {
  ride_id: string;
  driver_id: string | null;
  driver_name: string | null;
  driver_photo: string | null;
  vehicle_model: string | null;
  vehicle_plate: string | null;
};

const options = [
  {
    value: 'voice' as const,
    title: 'Som e avisos por voz',
    description: 'Efeitos e orientações faladas durante a corrida.',
  },
  {
    value: 'sound' as const,
    title: 'Apenas sons',
    description: 'Somente efeitos curtos, sem as falas.',
  },
  {
    value: 'off' as const,
    title: 'Desativado',
    description: 'Não toca sons. A vibração continua ativa.',
  },
];

const rideStatusLabel: Record<string, string> = {
  searching: 'Procurando motorista',
  queued: 'Na fila do motorista',
  accepted: 'Motorista a caminho',
  driver_arrived: 'Motorista chegou',
  arrived: 'Motorista chegou',
  waiting: 'Aguardando',
  started: 'Em andamento',
  in_progress: 'Em andamento',
  completed: 'Concluída',
  cancelled: 'Cancelada',
  no_drivers: 'Sem motoristas',
};

const rideStatusClass: Record<string, string> = {
  completed: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
  cancelled: 'border-red-400/20 bg-red-400/10 text-red-300',
  no_drivers: 'border-white/10 bg-white/5 text-white/50',
  queued: 'border-tum-yellow/25 bg-tum-yellow/10 text-tum-yellow',
  accepted: 'border-tum-yellow/25 bg-tum-yellow/10 text-tum-yellow',
  driver_arrived: 'border-tum-yellow/25 bg-tum-yellow/10 text-tum-yellow',
  arrived: 'border-tum-yellow/25 bg-tum-yellow/10 text-tum-yellow',
  waiting: 'border-tum-yellow/25 bg-tum-yellow/10 text-tum-yellow',
  started: 'border-blue-400/20 bg-blue-400/10 text-blue-300',
  in_progress: 'border-blue-400/20 bg-blue-400/10 text-blue-300',
  searching: 'border-blue-400/20 bg-blue-400/10 text-blue-300',
};

export default function MenuDrawer({
  open,
  onClose,
  profile,
  audioMode,
  onAudioModeChange,
  onEditProfile,
  onOpenNotifications,
  onOpenNews,
  onOpenSupport,
  onLogout,
  unreadCount,
}: Props) {
  const [tab, setTab] = useState<Tab>('menu');
  const [trips, setTrips] = useState<Ride[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<Ride | null>(null);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [tripsError, setTripsError] = useState('');
  const [payTab, setPayTab] = useState<PayTab>('cash');
  const [saving, setSaving] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [showLegal, setShowLegal] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const [legalTab, setLegalTab] = useState<LegalTab>('terms');

  const loadTrips = async () => {
    setTripsLoading(true);
    setTripsError('');

    const [ridesResult, driverSummariesResult] = await Promise.all([
      supabase
        .from('rides')
        .select('*')
        .eq('passenger_id', profile.id)
        .order('created_at', { ascending: false }),
      supabase.rpc('get_my_passenger_ride_driver_summaries_tum'),
    ]);

    if (ridesResult.error) {
      console.error('[TUM] Erro ao carregar viagens:', ridesResult.error);
      setTripsError('Não foi possível carregar suas viagens agora.');
      setTripsLoading(false);
      return;
    }

    const rideRows = (ridesResult.data as Ride[]) || [];
    const summaries = (driverSummariesResult.data as RideDriverSummary[] | null) ?? [];

    if (driverSummariesResult.error) {
      console.warn(
        '[TUM] Não foi possível carregar os dados resumidos dos motoristas:',
        driverSummariesResult.error,
      );
    }

    const summariesByRide = new Map(
      summaries.map((summary) => [summary.ride_id, summary]),
    );

    setTrips(
      rideRows.map((ride) => {
        const summary = summariesByRide.get(ride.id);

        return {
          ...ride,
          driver_name: ride.driver_name || summary?.driver_name || null,
          driver_photo: ride.driver_photo || summary?.driver_photo || null,
          car_model: ride.car_model || summary?.vehicle_model || null,
          plate: ride.plate || summary?.vehicle_plate || null,
        };
      }),
    );
    setTripsLoading(false);
  };

  useEffect(() => {
    const openSafety = () => setShowSafety(true);
    window.addEventListener('tum:open-safety', openSafety);
    return () => window.removeEventListener('tum:open-safety', openSafety);
  }, []);

  useEffect(() => {
    if (!open) return;

    setTab('menu');
    setSelectedTrip(null);
    void loadTrips();
  }, [open, profile.id]);

  const tripStats = useMemo(() => {
    const completed = trips.filter((ride) => ride.status === 'completed');
    const totalSpent = completed.reduce(
      (sum, ride) => sum + Number(ride.final_amount ?? ride.amount ?? 0),
      0,
    );

    return {
      completed: completed.length,
      totalSpent,
    };
  }, [trips]);

  if (!open) return null;

  const goToTab = (nextTab: Tab) => {
    setSelectedTrip(null);
    setTab(nextTab);
  };

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
      />

      <div className="tum-drawer-enter absolute bottom-0 left-0 top-0 flex w-[88%] max-w-sm flex-col border-r border-white/10 bg-tum-dark-2 shadow-2xl">
        <div className="border-b border-white/10 px-4 pb-4 pt-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  className="h-14 w-14 shrink-0 rounded-2xl border-2 border-tum-yellow object-cover shadow-lg"
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-tum-yellow/30 bg-tum-yellow/10 text-xl font-black text-tum-yellow">
                  {profile.full_name.charAt(0)}
                </div>
              )}

              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded-full border border-tum-yellow/20 bg-tum-yellow/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-tum-yellow">
                    Passageiro TUM
                  </span>
                </div>
                <p className="truncate font-bold text-white">{profile.full_name}</p>
                <p className="truncate text-xs text-white/40">{profile.phone}</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-tum-dark-3 text-white transition active:scale-95"
              aria-label="Fechar menu"
            >
              <X size={18} />
            </button>
          </div>

          <button
            onClick={onEditProfile}
            className="flex items-center gap-2 rounded-lg text-sm font-bold text-tum-yellow transition active:scale-[0.98]"
          >
            <Pencil size={14} />
            Editar perfil
          </button>
        </div>

        {tab === 'menu' && (
          <div className="animate-fade-in flex-1 space-y-1 overflow-y-auto p-3">
            <div className="mb-2 px-2 pt-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/30">
              Sua conta
            </div>
            <MenuItem
              icon={History}
              label="Minhas viagens"
              helper={tripsLoading ? 'Atualizando histórico...' : `${trips.length} registro${trips.length === 1 ? '' : 's'}`}
              onClick={() => goToTab('trips')}
            />
            <MenuItem
              icon={CreditCard}
              label="Pagamentos"
              helper="Dinheiro e Pix"
              onClick={() => goToTab('payments')}
            />
            <MenuItem
              icon={ShieldCheck}
              label="Segurança"
              helper="Contatos de confiança"
              onClick={() => setShowSafety(true)}
            />
            <MenuItem
              icon={Bell}
              label="Notificações"
              helper={unreadCount > 0 ? `${unreadCount} não lida${unreadCount === 1 ? '' : 's'}` : 'Tudo em dia'}
              badge={unreadCount}
              onClick={onOpenNotifications}
            />
            <MenuItem
              icon={Newspaper}
              label="Novidades"
              helper="Promoções, campanhas e histórias TUM"
              onClick={onOpenNews}
            />
            <MenuItem
              icon={MessageCircle}
              label="Fale conosco"
              helper="Suporte e sugestões"
              onClick={onOpenSupport}
            />

            <div className="mb-2 mt-4 px-2 pt-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/30">
              Aplicativo
            </div>
            <MenuItem
              icon={Settings}
              label="Configurações"
              helper="Sons e avisos"
              onClick={() => goToTab('settings')}
            />
            <MenuItem
              icon={Smartphone}
              label="Privacidade e permissões"
              helper="Revise os acessos do TUM"
              onClick={() => setShowPermissions(true)}
            />
            <MenuItem
              icon={FileText}
              label="Termos e privacidade"
              helper="Regras do serviço e seus dados"
              onClick={() => {
                setLegalTab('terms');
                setShowLegal(true);
              }}
            />

            <div className="my-3 border-t border-white/10" />
            <MenuItem
              icon={LogOut}
              label="Sair da conta"
              helper="Encerrar sessão neste aparelho"
              danger
              showChevron={false}
              onClick={() => void onLogout()}
            />
          </div>
        )}

        {tab === 'trips' && !selectedTrip && (
          <Pane
            title="Minhas viagens"
            subtitle="Seu histórico de corridas no TUM"
            back={() => goToTab('menu')}
          >
            {!tripsLoading && !tripsError && trips.length > 0 && (
              <div className="mb-4 grid grid-cols-2 gap-2 animate-fade-in">
                <SummaryCard
                  icon={Route}
                  label="Concluídas"
                  value={String(tripStats.completed)}
                />
                <SummaryCard
                  icon={WalletCards}
                  label="Total em corridas"
                  value={formatBRL(tripStats.totalSpent)}
                />
              </div>
            )}

            {tripsLoading && <TripsLoading />}

            {!tripsLoading && tripsError && (
              <EmptyState
                icon={RefreshCw}
                title="Não conseguimos carregar"
                message={tripsError}
                actionLabel="Tentar novamente"
                onAction={() => void loadTrips()}
              />
            )}

            {!tripsLoading && !tripsError && trips.length === 0 && (
              <EmptyState
                icon={History}
                title="Sua primeira viagem aparecerá aqui"
                message="Depois de concluir uma corrida, você poderá consultar os detalhes e o valor por aqui."
              />
            )}

            {!tripsLoading && !tripsError && trips.length > 0 && (
              <div className="space-y-2.5">
                {trips.map((ride, index) => (
                  <button
                    key={ride.id}
                    onClick={() => setSelectedTrip(ride)}
                    className="tum-card-enter w-full rounded-2xl border border-white/10 bg-tum-dark-3 p-3.5 text-left shadow-sm transition active:scale-[0.985]"
                    style={{ animationDelay: `${Math.min(index * 35, 210)}ms` }}
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-white">{ride.category}</p>
                        <p className="mt-0.5 text-[11px] text-white/40">
                          {formatRideDate(ride.created_at)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-black text-tum-yellow">
                          {formatBRL(Number(ride.final_amount ?? ride.amount ?? 0))}
                        </p>
                        <span
                          className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${rideStatusClass[ride.status] ?? 'border-white/10 bg-white/5 text-white/50'}`}
                        >
                          {rideStatusLabel[ride.status] ?? ride.status}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <RouteRow
                        tone="origin"
                        text={ride.origin_address || ride.origin || 'Origem não informada'}
                      />
                      <RouteRow
                        tone="destination"
                        text={ride.destination_address || ride.destination || 'Destino não informado'}
                      />
                    </div>

                    <div className="mt-3 border-t border-white/10 pt-3">
                      {ride.driver_name && (
                        <div className="mb-2.5 flex items-center gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-tum-yellow/35 bg-tum-yellow/10 text-tum-yellow">
                            {ride.driver_photo ? (
                              <img
                                src={ride.driver_photo}
                                alt={ride.driver_name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <UserRound size={14} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[10px] font-bold uppercase tracking-[0.08em] text-white/30">
                              Motorista
                            </p>
                            <p className="truncate text-xs font-black text-white/80">
                              {ride.driver_name}
                            </p>
                          </div>
                          {ride.plate && (
                            <span className="rounded-md border border-white/10 bg-black/20 px-1.5 py-0.5 font-mono text-[9px] font-black tracking-wide text-white/55">
                              {ride.plate.toUpperCase()}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-white/35">
                          Toque para ver detalhes
                        </span>
                        <ChevronRight size={16} className="text-white/35" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Pane>
        )}

        {tab === 'trips' && selectedTrip && (
          <TripDetails
            ride={selectedTrip}
            onBack={() => setSelectedTrip(null)}
          />
        )}

        {tab === 'payments' && (
          <Pane
            title="Pagamentos"
            subtitle="Escolha como prefere pagar suas corridas"
            back={() => goToTab('menu')}
          >
            <div className="mb-4 rounded-2xl border border-tum-yellow/20 bg-tum-yellow/10 p-3.5 animate-fade-in">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tum-yellow text-black">
                  <Sparkles size={19} />
                </div>
                <div>
                  <p className="text-sm font-black text-white">Pagamento simples</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/50">
                    O valor mostrado antes de solicitar a corrida é a sua referência. No final, confira o valor atualizado no app.
                  </p>
                </div>
              </div>
            </div>

            <div className="mb-4 flex rounded-2xl border border-white/10 bg-tum-dark-3 p-1">
              <PaymentTabButton
                active={payTab === 'cash'}
                icon={Banknote}
                label="Dinheiro"
                onClick={() => setPayTab('cash')}
              />
              <PaymentTabButton
                active={payTab === 'pix'}
                icon={Smartphone}
                label="Pix"
                onClick={() => setPayTab('pix')}
              />
            </div>

            <div key={payTab} className="animate-fade-in">
              {payTab === 'cash' ? (
                <PaymentInfo
                  icon={Banknote}
                  title="Pagamento em dinheiro"
                  description="Pague diretamente ao motorista quando a corrida terminar."
                  steps={[
                    'Confira o valor final exibido no TUM.',
                    'Entregue o valor diretamente ao motorista.',
                    'Se precisar de troco, combine com o motorista antes de finalizar.',
                  ]}
                />
              ) : (
                <PaymentInfo
                  icon={Smartphone}
                  title="Pagamento por Pix"
                  description="A chave Pix do motorista fica disponível na etapa final da corrida."
                  steps={[
                    'Abra os dados de pagamento ao finalizar a corrida.',
                    'Faça o Pix pelo aplicativo do seu banco.',
                    'Confirme com o motorista que o pagamento foi recebido.',
                  ]}
                />
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-tum-dark-3 p-3.5">
              <div className="flex gap-3">
                <ReceiptText size={18} className="mt-0.5 shrink-0 text-tum-yellow" />
                <div>
                  <p className="text-xs font-black text-white">Sem cobrança escondida</p>
                  <p className="mt-1 text-xs leading-relaxed text-white/45">
                    O TUM mostra o valor da corrida no aplicativo. Qualquer alteração válida durante a viagem deve aparecer no próprio resumo da corrida.
                  </p>
                </div>
              </div>
            </div>
          </Pane>
        )}

        {tab === 'settings' && (
          <Pane
            title="Sons e avisos"
            subtitle="Escolha como o TUM deve falar com você"
            back={() => goToTab('menu')}
          >
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-tum-yellow/20 bg-tum-yellow/10 p-3.5 text-tum-yellow animate-fade-in">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-tum-yellow text-black">
                <Volume2 size={20} />
              </div>
              <div>
                <p className="text-sm font-black text-white">Avisos do TUM</p>
                <p className="mt-0.5 text-xs text-white/45">Você pode alterar essa opção quando quiser.</p>
              </div>
            </div>

            <div className="space-y-2">
              {options.map((option) => {
                const selected = audioMode === option.value;
                return (
                  <button
                    key={option.value}
                    disabled={saving}
                    onClick={async () => {
                      if (selected) return;
                      setSaving(true);
                      await onAudioModeChange(option.value);
                      setSaving(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-[0.985] ${
                      selected
                        ? 'border-tum-yellow bg-tum-yellow/10'
                        : 'border-white/10 bg-tum-dark-3'
                    }`}
                  >
                    <div className="flex-1">
                      <p className={`text-sm font-black ${selected ? 'text-tum-yellow' : 'text-white'}`}>
                        {option.title}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-white/45">
                        {option.description}
                      </p>
                    </div>
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                        selected
                          ? 'border-tum-yellow bg-tum-yellow text-black'
                          : 'border-white/20 text-transparent'
                      }`}
                    >
                      <Check size={16} />
                    </div>
                  </button>
                );
              })}
            </div>
          </Pane>
        )}
      </div>

      <SafetyCenter
        open={showSafety}
        onClose={() => setShowSafety(false)}
        profile={profile}
      />
      <PermissionsCenter open={showPermissions} onClose={() => setShowPermissions(false)} />
      <LegalCenter
        open={showLegal}
        onClose={() => setShowLegal(false)}
        initialTab={legalTab}
      />
    </div>
  );
}

function Pane({
  title,
  subtitle,
  back,
  children,
}: {
  title: string;
  subtitle?: string;
  back: () => void;
  children: ReactNode;
}) {
  return (
    <div className="animate-fade-in flex-1 overflow-y-auto p-3 scrollbar-hide">
      <div className="sticky top-0 z-10 -mx-1 mb-3 flex items-center gap-3 border-b border-white/10 bg-tum-dark-2/95 px-1 pb-3 pt-1 backdrop-blur">
        <button
          onClick={back}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-tum-dark-3 text-white transition active:scale-95"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <h3 className="truncate text-base font-black text-white">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-[11px] text-white/40">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  helper,
  onClick,
  badge = 0,
  danger = false,
  showChevron = true,
}: {
  icon: LucideIcon;
  label: string;
  helper?: string;
  onClick: () => void;
  badge?: number;
  danger?: boolean;
  showChevron?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-3 rounded-2xl p-3 text-left transition active:scale-[0.985] ${
        danger ? 'tum-menu-danger text-red-400 active:bg-red-400/5' : 'text-white active:bg-tum-dark-3'
      }`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
          danger
            ? 'tum-menu-danger-icon border-red-400/15 bg-red-400/10 text-red-400'
            : 'border-white/10 bg-tum-dark-3 text-tum-yellow'
        }`}
      >
        <Icon size={19} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{label}</p>
        {helper && (
          <p className={`mt-0.5 truncate text-[11px] ${danger ? 'tum-menu-danger-helper text-red-400/70' : 'text-white/35'}`}>
            {helper}
          </p>
        )}
      </div>
      {badge > 0 && (
        <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {showChevron && <ChevronRight size={16} className="shrink-0 text-white/25" />}
    </button>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-tum-dark-3 p-3.5">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-tum-yellow/10 text-tum-yellow">
        <Icon size={16} />
      </div>
      <p className="truncate text-lg font-black text-white">{value}</p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/35">{label}</p>
    </div>
  );
}

function RouteRow({ tone, text }: { tone: 'origin' | 'destination'; text: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <div
        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 ${
          tone === 'origin'
            ? 'border-blue-300 bg-blue-500'
            : 'border-tum-yellow/50 bg-tum-yellow'
        }`}
      />
      <p className="line-clamp-2 text-xs leading-relaxed text-white/55">{text}</p>
    </div>
  );
}

function TripsLoading() {
  return (
    <div className="space-y-2.5" aria-label="Carregando viagens">
      {[0, 1, 2].map((item) => (
        <div key={item} className="rounded-2xl border border-white/10 bg-tum-dark-3 p-3.5">
          <div className="tum-skeleton h-4 w-28 rounded-md" />
          <div className="mt-3 space-y-2">
            <div className="tum-skeleton h-3 w-full rounded-md" />
            <div className="tum-skeleton h-3 w-4/5 rounded-md" />
          </div>
          <div className="mt-4 border-t border-white/10 pt-3">
            <div className="tum-skeleton h-3 w-24 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center px-6 text-center animate-fade-in">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-tum-yellow/20 bg-tum-yellow/10 text-tum-yellow">
        <Icon size={28} />
      </div>
      <h4 className="text-base font-black text-white">{title}</h4>
      <p className="mt-2 max-w-[260px] text-xs leading-relaxed text-white/45">{message}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-5 rounded-xl bg-tum-yellow px-5 py-3 text-xs font-black text-black transition active:scale-95"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function TripDetails({ ride, onBack }: { ride: Ride; onBack: () => void }) {
  const total = Number(ride.final_amount ?? ride.amount ?? 0);
  const distance = Number(ride.actual_distance_km ?? ride.distance_km ?? 0);
  const duration = Number(ride.actual_duration_minutes ?? ride.duration_minutes ?? 0);
  const payment = paymentLabel(ride.payment_method);

  return (
    <Pane
      title="Detalhes da viagem"
      subtitle={formatRideDate(ride.completed_at || ride.created_at)}
      back={onBack}
    >
      <div className="mb-3 rounded-2xl border border-white/10 bg-tum-dark-3 p-4 animate-fade-in">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black ${
                rideStatusClass[ride.status] ?? 'border-white/10 bg-white/5 text-white/50'
              }`}
            >
              {rideStatusLabel[ride.status] ?? ride.status}
            </span>
            <p className="mt-2 text-lg font-black text-white">{ride.category}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-white/30">Valor</p>
            <p className="mt-1 text-xl font-black text-tum-yellow">{formatBRL(total)}</p>
          </div>
        </div>

        <div className="relative space-y-4 pl-1">
          <div className="absolute bottom-3 left-[5px] top-3 w-px bg-white/10" />
          <RouteRow
            tone="origin"
            text={ride.origin_address || ride.origin || 'Origem não informada'}
          />
          <RouteRow
            tone="destination"
            text={ride.destination_address || ride.destination || 'Destino não informado'}
          />
        </div>
      </div>

      {(ride.driver_name || ride.car_model || ride.plate) && (
        <div className="mb-3 rounded-2xl border border-tum-yellow/20 bg-tum-yellow/[0.06] p-3.5 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-tum-yellow bg-tum-dark-3 text-tum-yellow">
              {ride.driver_photo ? (
                <img
                  src={ride.driver_photo}
                  alt={ride.driver_name || 'Motorista TUM'}
                  className="h-full w-full object-cover"
                />
              ) : (
                <UserRound size={21} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.1em] text-tum-yellow/75">
                Motorista desta viagem
              </p>
              <p className="mt-0.5 truncate text-sm font-black text-white">
                {ride.driver_name || 'Motorista TUM'}
              </p>

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {ride.car_model && (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[10px] font-bold text-white/55">
                    <CarFront size={12} />
                    {ride.car_model}
                  </span>
                )}
                {ride.plate && (
                  <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 font-mono text-[10px] font-black tracking-wide text-white">
                    {ride.plate.toUpperCase()}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-2 border-t border-white/10 pt-3">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-tum-yellow" />
            <p className="text-[11px] leading-5 text-white/40">
              O telefone do motorista fica disponível apenas durante a corrida ativa. No histórico, o TUM mantém nome, veículo e placa para sua segurança sem expor contato pessoal depois da viagem.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <DetailCard
          icon={CalendarDays}
          label="Data"
          value={new Date(ride.created_at).toLocaleDateString('pt-BR')}
        />
        <DetailCard icon={CircleDollarSign} label="Pagamento" value={payment} />
        <DetailCard
          icon={Route}
          label="Distância"
          value={distance > 0 ? `${distance.toFixed(1)} km` : '—'}
        />
        <DetailCard
          icon={Clock3}
          label="Duração"
          value={duration > 0 ? `${Math.round(duration)} min` : '—'}
        />
      </div>

      {Number(ride.discount_amount ?? 0) > 0 && (
        <div className="mt-3 rounded-2xl border border-emerald-400/15 bg-emerald-400/10 p-3.5">
          <p className="text-xs font-black text-emerald-300">Você economizou</p>
          <p className="mt-1 text-lg font-black text-white">
            {formatBRL(Number(ride.discount_amount ?? 0))}
          </p>
          {ride.coupon_code && (
            <p className="mt-1 text-[11px] text-white/45">Cupom usado: {ride.coupon_code}</p>
          )}
        </div>
      )}

      <div className="mt-3 rounded-2xl border border-white/10 bg-tum-dark-3 p-3.5">
        <div className="flex items-start gap-3">
          <MapPin size={18} className="mt-0.5 shrink-0 text-tum-yellow" />
          <div>
            <p className="text-xs font-black text-white">Registro da corrida</p>
            <p className="mt-1 text-xs leading-relaxed text-white/45">
              Esses dados são o resumo salvo pelo TUM para esta viagem.
            </p>
          </div>
        </div>
      </div>
    </Pane>
  );
}

function DetailCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-tum-dark-3 p-3.5">
      <Icon size={17} className="mb-2 text-tum-yellow" />
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-white/30">{label}</p>
      <p className="mt-1 truncate text-sm font-black text-white">{value}</p>
    </div>
  );
}

function PaymentTabButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-black transition active:scale-[0.98] ${
        active ? 'bg-tum-yellow text-black shadow-sm' : 'text-white/50'
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

function PaymentInfo({
  icon: Icon,
  title,
  description,
  steps,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  steps: string[];
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-tum-dark-3 p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-tum-yellow/10 text-tum-yellow">
          <Icon size={21} />
        </div>
        <div>
          <h4 className="text-sm font-black text-white">{title}</h4>
          <p className="mt-1 text-xs leading-relaxed text-white/45">{description}</p>
        </div>
      </div>

      <div className="space-y-3 border-t border-white/10 pt-4">
        {steps.map((step, index) => (
          <div key={step} className="flex items-start gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-tum-yellow text-[10px] font-black text-black">
              {index + 1}
            </div>
            <p className="pt-0.5 text-xs leading-relaxed text-white/55">{step}</p>
          </div>
        ))}
      </div>

    </div>
  );
}

function formatRideDate(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function paymentLabel(value: string | null | undefined) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('pix')) return 'Pix';
  if (normalized.includes('cash') || normalized.includes('dinheiro')) return 'Dinheiro';
  return value || 'Não informado';
}
