# TUM Passageiro — correções finais 03/09/2026

Esta versão consolida as correções do Passageiro já existentes e a rodada final de interface, permissões, desempenho, segurança, denúncias, preço ao vivo e mapas.

## 1. Permissões
- Tela de permissões ocupa a tela inteira e não precisa rolar.
- Ao entrar na conta, o app confere as permissões diretamente no Android.
- Se faltarem permissões, os popups são solicitados automaticamente em sequência: localização, notificações, microfone e câmera.
- A tela só é liberada quando todas as permissões necessárias estiverem concedidas.
- Permissões já concedidas são relidas pelo PackageManager para evitar falso “Pendente”.
- Configurações do Android são usadas apenas quando uma permissão estiver bloqueada.

## 2. Aviso inicial de gravação
- Modal de segurança fica bloqueado por 5 segundos.
- “Ativar agora” mostra contagem regressiva.
- “Agora não” também só fica disponível após os 5 segundos.

## 3. REC
- Botão REC inteiro vermelho.
- Ícone de câmera branco.
- Texto REC branco.

## 4. Denúncia e safe area
- Botão “Denunciar motorista” foi reposicionado acima das ações da corrida para não ficar atrás da barra de navegação do Android.
- Motivos agora usam seletor recolhível com seta visível.
- Gravação de segurança fica visível logo abaixo do seletor de motivo.
- Foto e vídeo continuam opcionais.

## 5. Desempenho
- Reduzida frequência de polls de fallback onde Realtime já é a fonte principal.
- Poll de motorista em corrida foi suavizado.
- Poll de gravação é suspenso quando o app não está visível.
- Poll de preço ao vivo só roda durante viagem em andamento e com a tela visível.
- Otimização de release continua persistente via plugin (R8, shrinkResources, PNG e APKs ARM separados).

## 6. Splash
- O fundo do splash Android agora usa #FDE103, o amarelo dominante da própria arte do ícone, eliminando o contraste com o antigo #FACC15.

## 7. Confirmações
- Removidos `window.confirm`, `window.alert` e `window.prompt` do Passenger DOM.
- Confirmações de gravação e galeria usam modal visual TUM com logo.

## 8. Denúncia compacta
- Motivos ficam fechados por padrão.
- Toque no seletor abre/fecha o leque.
- Vídeo de segurança permanece destacado e acessível sem atravessar a lista inteira.

## 9. Preço ao vivo do Passageiro
- Durante `started/in_progress`, o app consulta `get_passenger_live_ride_fare`.
- Usa a mesma fórmula real de km, tempo, espera, paradas, multiplicador, mínimo e desconto usada no encerramento.
- Mostra “Valor atual” no cartão principal e um quadro de preço em andamento nos detalhes.
- Distância e duração também acompanham os dados reais da corrida.

## 10. Rota ao trocar tema
- Mapbox restaura source/layers da rota após troca de estilo, move a linha para o topo e reenquadra os pontos.
- Google Maps redesenha a polyline quando o tema muda.

## Supabase
A migration `passenger_live_ride_fare` já foi aplicada uma única vez no projeto de produção e verificada. O arquivo equivalente fica em `supabase/migrations/20260903164000_passenger_live_ride_fare.sql` para manter o código sincronizado.
