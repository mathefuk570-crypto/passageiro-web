TUM PASSAGEIRO — CORREÇÃO TYPECHECK V3 — 05/09/2026

Este patch corrige os 9 erros mostrados no `npm run typecheck` após a V2 de Corridas em viagem.

IMPORTANTE
- Extraia o conteúdo deste ZIP DIRETAMENTE na raiz: C:\TUMM\Passageiro
- Confirme a substituição dos arquivos.
- NÃO aplique novamente o patch Passageiro V2 antigo depois deste V3.

O que foi corrigido:
1. app/index.tsx voltou para a base mais nova do Passageiro, mantendo câmera, localização nativa,
   notificações e gravação de segurança, além do canal da corrida em fila.
2. HomeScreen: botão de cancelar não passa mais a função tipada diretamente para onClick.
3. DriverLocation voltou a ter location_sampled_at, accuracy_m, speed_mps e heading_degrees.
4. MapView voltou à arquitetura atual que alterna Google/Mapbox pelo Painel ADM; não importa MAPBOX_TOKEN antigo.
5. Corridas em viagem continuam presentes.
6. Durante a espera em fila, Mapbox e Google suportam rota atual em vermelho, ponto final vermelho
   e rota seguinte em amarelo.

Depois de substituir, rode:

npm run typecheck

Este patch foi validado por parser TypeScript nos arquivos alterados e por verificações específicas
para os 9 erros reportados. O ambiente de preparação não possui as dependências completas do projeto,
por isso o teste final `npm run typecheck` deve ser feito no seu C:\TUMM\Passageiro.
