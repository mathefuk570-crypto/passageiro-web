import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Database,
  FileCheck2,
  FileText,
  LockKeyhole,
  MapPinned,
  Scale,
  ShieldCheck,
  UserRoundCheck,
  X,
  type LucideIcon,
} from 'lucide-react';

export const TERMS_VERSION = '1.0-2026-08-08';
export const PRIVACY_VERSION = '1.0-2026-08-08';

export type LegalTab = 'terms' | 'privacy';

interface Props {
  open: boolean;
  onClose: () => void;
  initialTab?: LegalTab;
}

export default function LegalCenter({ open, onClose, initialTab = 'terms' }: Props) {
  const [tab, setTab] = useState<LegalTab>(initialTab);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [initialTab, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="mx-auto flex h-full w-full max-w-lg flex-col bg-tum-dark-2 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] shadow-2xl">
        <header className="flex items-center gap-3 border-b border-white/10 px-4 pb-3">
          <button
            type="button"
            onClick={onClose}
            className="tum-press flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-tum-dark-3 text-white"
            aria-label="Voltar"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-tum-yellow">TUM · Transparência</p>
            <h2 className="truncate text-lg font-black text-white">Termos e privacidade</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="tum-press flex h-10 w-10 items-center justify-center rounded-xl text-white/45"
            aria-label="Fechar"
          >
            <X size={19} />
          </button>
        </header>

        <div className="mx-4 mt-3 grid grid-cols-2 rounded-2xl border border-white/10 bg-black/20 p-1">
          <TabButton active={tab === 'terms'} label="Termos de uso" onClick={() => setTab('terms')} />
          <TabButton active={tab === 'privacy'} label="Privacidade" onClick={() => setTab('privacy')} />
        </div>

        <main key={tab} className="animate-fade-in flex-1 overflow-y-auto px-4 pb-5 pt-4 scrollbar-hide">
          {tab === 'terms' ? <TermsContent /> : <PrivacyContent />}
        </main>
      </div>
    </div>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tum-press rounded-xl px-3 py-2.5 text-xs font-black transition ${
        active ? 'bg-tum-yellow text-black' : 'text-white/45'
      }`}
    >
      {label}
    </button>
  );
}

function TermsContent() {
  return (
    <div className="space-y-3 text-sm leading-6 text-white/62">
      <Hero
        icon={FileCheck2}
        title="Termos de Uso do TUM"
        text="Regras essenciais para usar o TUM com clareza, segurança e respeito entre passageiros e motoristas."
        version={TERMS_VERSION}
      />

      <Section title="1. Sobre o serviço">
        O TUM – Tornado Urban Mobility é uma plataforma de mobilidade que aproxima passageiros e motoristas parceiros e oferece recursos de solicitação, acompanhamento e gerenciamento de corridas. A disponibilidade depende da cidade, categoria, motoristas online e condições operacionais.
      </Section>

      <Section title="2. Sua conta">
        Você deve informar dados verdadeiros e manter seu telefone e senha protegidos. A conta é pessoal. Atividades que indiquem fraude, uso indevido, tentativa de burlar preços, segurança ou sistemas do TUM podem resultar em bloqueio preventivo enquanto o caso é analisado.
      </Section>

      <Section title="3. Solicitação e preço da corrida">
        Antes da confirmação, o app apresenta uma estimativa ou valor calculado conforme as regras vigentes da categoria e da cidade. O valor final pode ser atualizado quando houver fatores previstos no próprio serviço, como distância ou tempo efetivamente percorridos, espera, paradas, tarifa dinâmica, descontos ou cancelamento, quando aplicáveis.
      </Section>

      <Section title="4. Pagamento">
        As formas disponíveis aparecem no app. Em pagamentos realizados diretamente ao motorista, como dinheiro ou Pix, passageiro e motorista devem conferir o valor final exibido no TUM antes de concluir a corrida.
      </Section>

      <Section title="5. Cancelamentos e conduta">
        Passageiros e motoristas devem agir com respeito e segurança. Não são permitidos assédio, discriminação, ameaça, fraude, dano, transporte de itens ilícitos ou qualquer uso que coloque pessoas ou o serviço em risco. Regras e eventuais cobranças de cancelamento devem ser mostradas pelo app quando aplicáveis.
      </Section>

      <Section title="6. Segurança">
        Os recursos de contato, chat, compartilhamento e contatos de confiança ajudam na experiência, mas não substituem serviços públicos de emergência. Em situação de risco imediato, procure os serviços públicos adequados da sua região.
      </Section>

      <Section title="7. Disponibilidade e tecnologia">
        GPS, internet, mapas, sistema operacional e serviços de terceiros podem sofrer instabilidades. O TUM trabalha para manter o serviço disponível, mas não garante funcionamento ininterrupto em situações fora de seu controle razoável.
      </Section>

      <Section title="8. Alterações e atendimento">
        Estes termos podem ser atualizados quando o serviço, a legislação ou os recursos do app mudarem. A versão vigente fica disponível nesta central. Dúvidas, solicitações e contestações podem ser enviadas pelo Fale Conosco do TUM.
      </Section>
    </div>
  );
}

function PrivacyContent() {
  return (
    <div className="space-y-3 text-sm leading-6 text-white/62">
      <Hero
        icon={ShieldCheck}
        title="Aviso de Privacidade"
        text="Como o TUM utiliza dados para criar sua conta, localizar corridas, prestar suporte e proteger a experiência."
        version={PRIVACY_VERSION}
      />

      <InfoGrid />

      <Section title="1. Dados que podemos tratar">
        Dados de cadastro e identificação, como nome, telefone, CPF, cidade, e-mail opcional e foto; dados de localização necessários ao uso do mapa e das corridas; origem, destino, paradas e histórico; mensagens de chat e suporte; avaliações; preferências do aplicativo; contatos de confiança cadastrados por você; dados técnicos necessários a notificações e segurança da sessão.
      </Section>

      <Section title="2. Para que usamos esses dados">
        Para criar e proteger sua conta, calcular e despachar corridas, mostrar sua localização e a do motorista, permitir comunicação e suporte, aplicar preços e descontos, registrar pagamentos informados no app, prevenir abuso e fraude, atender solicitações de segurança e melhorar a operação do TUM.
      </Section>

      <Section title="3. Localização">
        A localização é central para a mobilidade. O app pode utilizar sua posição para definir embarque, calcular rotas, estimar valores e acompanhar a corrida. As permissões são controladas pelo sistema do seu aparelho e podem ser alteradas nas configurações, embora negar uma permissão necessária possa limitar recursos do TUM.
      </Section>

      <Section title="4. Compartilhamento necessário">
        Informações relevantes da corrida podem ser compartilhadas com o motorista designado, como nome do passageiro, embarque, destino, paradas e dados necessários à execução da viagem. O TUM também utiliza fornecedores de infraestrutura, autenticação, armazenamento, mapas e notificações para operar o aplicativo, sempre de acordo com a finalidade do serviço.
      </Section>

      <Section title="5. Contatos de confiança">
        Quando você cadastra um contato de confiança, informa ao TUM o nome e o telefone dessa pessoa para usar os recursos de segurança escolhidos por você. Cadastre apenas pessoas com quem você tenha relação legítima para essa finalidade e mantenha as informações atualizadas.
      </Section>

      <Section title="6. Conservação e segurança">
        Os dados são mantidos pelo período necessário às finalidades do serviço e a obrigações legais, regulatórias, de prevenção a fraude ou exercício de direitos, quando aplicáveis. O TUM adota controles técnicos e organizacionais para reduzir riscos de acesso, alteração ou divulgação não autorizados, sem prometer segurança absoluta de qualquer sistema conectado à internet.
      </Section>

      <Section title="7. Seus direitos">
        Você pode solicitar informações sobre o tratamento, confirmação e acesso aos seus dados, correção, além de outras medidas previstas na legislação aplicável, como anonimização, bloqueio, eliminação, portabilidade ou revogação de consentimento quando cabíveis. Algumas solicitações podem exigir validação de identidade e determinados dados podem precisar ser conservados por obrigação legal ou para exercício de direitos.
      </Section>

      <Section title="8. Como falar com o TUM">
        Utilize o Fale Conosco dentro do aplicativo para dúvidas sobre privacidade, correção de dados, solicitações relacionadas à conta ou exercício de direitos. Guarde o protocolo ou histórico do atendimento quando a solicitação envolver seus dados pessoais.
      </Section>
    </div>
  );
}

function Hero({ icon: Icon, title, text, version }: { icon: LucideIcon; title: string; text: string; version: string }) {
  return (
    <div className="rounded-[24px] border border-tum-yellow/20 bg-tum-yellow/10 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-tum-yellow text-black">
          <Icon size={21} />
        </div>
        <div>
          <h3 className="font-black text-white">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-white/52">{text}</p>
          <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.09em] text-tum-yellow/80">Versão {version}</p>
        </div>
      </div>
    </div>
  );
}

function InfoGrid() {
  const items = [
    { icon: UserRoundCheck, label: 'Conta', text: 'Cadastro e identidade' },
    { icon: MapPinned, label: 'Corridas', text: 'Localização e rotas' },
    { icon: LockKeyhole, label: 'Proteção', text: 'Segurança da sessão' },
    { icon: Database, label: 'Controle', text: 'Direitos sobre seus dados' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(({ icon: Icon, label, text }) => (
        <div key={label} className="rounded-2xl border border-white/10 bg-tum-dark-3 p-3">
          <Icon size={17} className="text-tum-yellow" />
          <p className="mt-2 text-xs font-black text-white">{label}</p>
          <p className="mt-0.5 text-[10px] leading-4 text-white/38">{text}</p>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/8 bg-tum-dark-3 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Scale size={15} className="shrink-0 text-tum-yellow" />
        <h4 className="text-xs font-black text-white">{title}</h4>
      </div>
      <p className="text-xs leading-[1.65] text-white/52">{children}</p>
    </section>
  );
}
