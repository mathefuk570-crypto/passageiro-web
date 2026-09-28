# Passageiro — Denúncias (03/09/2026)

## O que foi adicionado
- Botão **Denunciar motorista** durante a corrida.
- Botão **Denunciar motorista** também após a corrida finalizada.
- Modal completo com:
  - seleção do motivo;
  - descrição opcional;
  - foto opcional como evidência;
  - envio privado para análise.

## Backend / Supabase
Nenhuma nova alteração no Supabase foi necessária nesta rodada.
O Passageiro passou a usar a mesma estrutura já criada anteriormente:
- tabela `user_reports`;
- tabela `user_report_evidence`;
- bucket privado `report-evidence`;
- RPC `create_user_report_tum`;
- RPC `add_user_report_evidence_tum`.

## Arquivos principais alterados
- `dom/src/components/RideInProgress.tsx`
- `dom/src/lib/userReports.ts`

## Observação
A denúncia fica vinculada à corrida atual e cai na mesma aba **Denúncias** do Painel ADM.
