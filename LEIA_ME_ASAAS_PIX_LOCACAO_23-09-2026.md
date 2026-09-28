# TUM Passageiro — PIX Asaas para motoristas com veículo alugado

Data: 23/09/2026

## Fluxo implementado

- Passageiro continua escolhendo Dinheiro ou Pix ao solicitar a corrida.
- Se a corrida Pix for atendida por motorista com locação TUM ativa, ao finalizar a corrida o Passageiro chama a Edge Function `create-ride-pix-payment`.
- O backend cria/recupera a cobrança PIX no Asaas e devolve QR Code + Pix copia e cola.
- A tela final aguarda a confirmação do pagamento antes de liberar o envio da avaliação.
- A confirmação chega pelo webhook `asaas-rental-webhook`.
- O webhook registra o pagamento na carteira de locação e aplica a regra de divisão configurada no banco.
- Para motorista sem locação ativa, o app mantém o fluxo de Pix direto ao motorista.

## Troca Sandbox -> Produção

Não requer alteração no app. Alterar apenas os Secrets do Supabase:

- `ASAAS_API_KEY`
- `ASAAS_BASE_URL` (`https://api.asaas.com/v3` em produção)
- `ASAAS_WEBHOOK_TOKEN`

O webhook também deve estar cadastrado no ambiente de produção do Asaas apontando para:

`https://wtfceelwjauydzilmfzy.supabase.co/functions/v1/asaas-rental-webhook`

## Arquivos alterados

- `dom/src/components/RideInProgress.tsx`
- `dom/src/components/MenuDrawer.tsx`
- `dom/src/lib/ridePayments.ts` (novo)

## Backend já aplicado no projeto Supabase

- `asaas-rental-webhook`
- `create-ride-pix-payment`
- `request-rental-withdrawal`
- tabelas de pagamentos/eventos Asaas e integração com a carteira de locação

A carteira antiga de taxa do motorista continua separada.
