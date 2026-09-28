# TUM Passageiro — Varredura de estabilidade e correções

Data: 25/09/2026

## Objetivo

Varredura focada em bugs drásticos do Passageiro: perda/ressurreição de corrida, duplicidade, travamentos por internet ruim, estado preso após fechar/reabrir o app, Promises/requisições concorrentes, chat, PIX, preço ao vivo, suporte, gravação de segurança, cadastro, logout e persistência.

O projeto analisado tem 53 arquivos TypeScript/TSX no cliente principal e aproximadamente 21 mil linhas de código nessas áreas.

## Correções aplicadas

### 1. Sincronização da corrida protegida contra respostas antigas

`HomeScreen.tsx`

A corrida podia ser atualizada simultaneamente por Realtime, polling, foco da janela e reconexão. Uma resposta antiga podia chegar por último e sobrescrever uma etapa mais nova.

Foi adicionado:
- single-flight por corrida para não disparar o mesmo RPC em paralelo;
- número de sequência para descartar respostas antigas;
- invalidação de requisições pendentes ao resetar/cancelar/trocar de corrida;
- proteção para uma corrida antiga nunca reaparecer sobre a corrida atual.

### 2. Recuperação de corrida mais resistente a app fechado / segundo plano / internet ruim

`HomeScreen.tsx`

O snapshot da corrida ativa já existia, mas agora o último estado conhecido também é descarregado imediatamente quando a página vai para segundo plano/`pagehide`, além do salvamento normal.

Também foi reforçada a recuperação pelo servidor ao voltar a conexão, foco ou visibilidade.

### 3. Proteção extra contra corrida duplicada

`HomeScreen.tsx`

Antes de criar uma corrida o app agora confirma no servidor se já existe outra ativa. Também existe trava local contra dois envios simultâneos.

O fluxo de criação continua compatível com o backend atual, mas ganhou rollback com tentativas para os casos em que:
- a corrida é criada e as paradas falham;
- as paradas são salvas e o início do dispatch falha;
- a conexão cai no meio do processo.

Se o rollback não puder ser confirmado, o app mantém a corrida visível e bloqueia nova criação em vez de fingir que nada aconteceu e permitir duplicidade.

### 4. Botão “Solicitando corrida...” não fica preso

`RideRequestModal.tsx`

Se `onConfirm` rejeitasse com exceção, `submitting` podia continuar `true` indefinidamente. Agora o fluxo usa `try/catch` e libera o botão corretamente.

### 5. Pollings críticos não se atropelam

`RideInProgress.tsx` e `HomeScreen.tsx`

Foram adicionadas travas para impedir requisições concorrentes desnecessárias em:
- PIX da corrida;
- preço ao vivo;
- status da gravação de segurança;
- timeout de ofertas;
- posição do motorista;
- detalhes da corrida.

Também há verificações de conexão/visibilidade onde apropriado.

### 6. Chat: gravador de áudio não continua após sair da tela

`ChatPanel.tsx`

Foi corrigida uma janela em que o usuário podia iniciar a gravação e sair/fechar o chat durante `getUserMedia` ou durante o atraso inicial. O gravador podia terminar de iniciar depois do componente desmontar e manter stream ou tentar enviar áudio.

Agora há:
- token de tentativa de gravação;
- verificação de componente montado;
- parada explícita das tracks;
- invalidação no unmount;
- limpeza correta dos listeners `play/pause` do áudio.

### 7. Cadastro interrompido pode ser retomado

`AuthScreen.tsx`

O Auth era criado antes do perfil. Se a conexão caísse entre essas etapas, o telefone podia ficar associado a um usuário sem perfil e uma nova tentativa encontrava “conta já existente”.

Agora, quando a conta Auth já existe e a senha confere, o app:
- entra na conta existente;
- reutiliza o mesmo `auth_user_id`;
- conclui o perfil se ele estiver faltando;
- entra normalmente se o perfil já tiver sido concluído;
- registra novamente o aceite legal ao retomar;
- trata foto de perfil como opcional: falha no Storage não abandona todo o cadastro.

O texto antigo “Tornado Urban Mobility” da tela de login também foi removido; a marca aparece como TUM.

### 8. Falha de push não bloqueia logout

`App.tsx` e `useAuth.ts`

Desativar/sincronizar push é uma operação auxiliar. Antes, uma rejeição nessa etapa podia impedir o logout. Agora a sessão ainda consegue encerrar mesmo se a limpeza de push falhar temporariamente.

### 9. Suporte não fica preso em carregamento/envio

`SupportPanel.tsx`

Foi adicionado single-flight no carregamento e `try/catch/finally` para:
- carregar atendimento;
- enviar texto;
- enviar foto;
- gerar URL assinada de imagem.

Isso evita botões presos e rejeições não tratadas quando a conexão cai.

### 10. Segurança e Favoritos mais resistentes a falhas de rede

`SafetyRecordingCard.tsx`, `SafetyRecordingGallery.tsx`, `SavedPlaces.tsx`, `PushNotificationPrompt.tsx`

Foram adicionados tratamentos de exceção e `finally` para impedir:
- configuração de segurança eternamente em “Preparando”;
- status da gravação sobreposto por polls;
- galeria quebrar ao falhar biometria/rede/URL assinada;
- Favoritos ficar eternamente em “salvando” ou “carregando”;
- ativação de notificações ficar presa.

## Verificação do backend conectado (somente leitura)

Foi conferido o projeto Supabase de produção associado ao app, sem alteração de schema/dados.

Pontos positivos confirmados:
- RLS está habilitada nas tabelas críticas conferidas (`rides`, `ride_stops`, `profiles`, `passenger_saved_places`, suporte, gravações de segurança, ratings e localização do motorista).
- Existe o índice único parcial `rides_one_active_per_passenger_tum`, que impede duas corridas ativas normais para o mesmo passageiro no banco.
- No momento da auditoria havia **0** passageiros com mais de uma corrida ativa.
- `cancel_passenger_ride`, `get_passenger_ride_details` e `start_ride_dispatch` verificam autenticação/propriedade da corrida internamente.
- `complete_passenger_profile` já é capaz de completar/atualizar um perfil associado ao usuário autenticado, o que torna a retomada do cadastro compatível com o backend atual.

## Pontos que não foram alterados de propósito

### Criação da corrida ainda não é uma única transação de banco

Hoje o cliente faz, em sequência:
1. `INSERT` em `rides`;
2. `set_ride_stops_tum`;
3. `start_ride_dispatch`.

A correção aplicada reduz fortemente o risco usando índice único, pré-checagem, retries, rollback e preservação do estado quando a confirmação é incerta. Porém, a garantia máxima seria um único RPC transacional no banco criando corrida + paradas + dispatch.

Não foi feita essa mudança de backend nesta rodada porque ela altera contrato de RPC e poderia afetar versões anteriores do Passageiro/Motorista. Deve ser feita como migração separada, com compatibilidade planejada.

### Alertas de hardening do Supabase

O Security Advisor do projeto possui avisos gerais, principalmente funções `SECURITY DEFINER` expostas para execução e algumas funções com `search_path` mutável. Os RPCs principais do Passageiro revisados possuem checagens internas de autenticação, mas a superfície completa merece uma auditoria de segurança separada antes de revogar permissões em produção, para não quebrar versões antigas, painel ou Motorista.

Também foi adicionada proteção no `.gitignore` para não versionar acidentalmente keystores/credenciais de assinatura. Os arquivos já existentes foram mantidos no ZIP para não quebrar o seu processo de build; **não compartilhe esse ZIP publicamente**.

## Validações executadas

- Parser/transpilação TypeScript em 53 arquivos `.ts/.tsx`: **0 erros de sintaxe**.
- Verificação de imports relativos: **0 imports locais inexistentes**.
- JSON válido em `package.json`, `app.json`, `eas.json` e `tsconfig.json`.
- Script `check:play`: não encontrou manifesto merged de release porque ele só é gerado durante o build; isso não indica erro do fonte.
- Comparação contra o ZIP original para garantir que somente os arquivos da correção e este relatório mudaram.

## Limitação desta validação

O ambiente da auditoria não conseguiu instalar integralmente as dependências do projeto, portanto não foi possível executar o `tsc --noEmit`, `expo lint` ou gerar um AAB/APK real aqui. A validação de sintaxe/imports passou, mas o passo final antes de produção continua sendo rodar o build normal do projeto e testar os fluxos abaixo em dois aparelhos/emuladores.

## Testes manuais prioritários antes da publicação

1. Pedir corrida e desligar/religar a internet em `searching`, `accepted`, `queued` e `in_progress`.
2. Fechar completamente o app com corrida ativa e reabrir.
3. Tocar rapidamente duas vezes para solicitar corrida e confirmar que só existe uma.
4. Simular falha entre criação da corrida e início do dispatch.
5. Abrir chat, iniciar áudio e fechar o chat imediatamente.
6. Finalizar corrida PIX e alternar app/segundo plano durante atualização do pagamento.
7. Interromper cadastro depois da criação do Auth e refazer com o mesmo telefone/senha.
8. Testar logout sem internet e com push indisponível.
9. Abrir Segurança/Favoritos/Suporte e derrubar a internet durante salvar/enviar.
10. Confirmar que uma versão antiga do Passageiro e o Motorista continuam consumindo os RPCs existentes normalmente.
