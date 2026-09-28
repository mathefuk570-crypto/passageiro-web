# TUM Passageiro — prevenção dos erros encontrados no Motorista

Pacote revisado em 02/09/2026 depois dos testes reais do TUM Motorista.

## Correções trazidas dos testes reais do Motorista

- Removido acesso a `display` a partir do `SafetyRecordingService`. A rotação não é mais consultada por um Context de background.
- `SafetyRecordingActivity` transparente atualizada para Android recente e isolada em task própria.
- Vídeo + áudio usa primeiro `CamcorderProfile` anunciado pelo próprio aparelho, evitando combinações de câmera/MediaRecorder rejeitadas por Samsung e outros fabricantes.
- Fallback de vídeo usa H.264 + AAC, 30 fps e resolução compatível anunciada pela câmera.
- Bitrate limitado para não gerar arquivos gigantes: data saver ~650 kbps, balanced ~1.2 Mbps, clear ~2.2 Mbps; áudio 48–64 kbps.
- Erros de Camera2/MediaRecorder agora retornam motivo específico: câmera em uso, falha de sessão, falha de prepare/start, desconexão, serviço de câmera etc.
- Erro antigo é limpo ao configurar uma nova corrida.
- O botão REC do Passageiro fica bloqueado durante a tentativa de início e exige estado estável antes de liberar novos toques.
- Se a inicialização falhar, o Passageiro mostra a mensagem real na tela em vez de parecer que nada aconteceu.
- Configuração de câmera/modo fica bloqueada enquanto há gravação ativa, evitando alterar prefs no meio de um arquivo.
- Ao concluir/cancelar a corrida, a UI agora reflete o encerramento automático da gravação.

## Proteções que já existiam e foram mantidas

- encerramento automático ao finalizar/cancelar corrida;
- WorkManager para reenvio quando a internet voltar;
- fila de segmentos e finalização posterior da sessão;
- tokens de sessão protegidos via Android Keystore;
- upload de sessões parciais/falhadas;
- segmentos limitados para não encostar no limite do Storage;
- retenção e limpeza automática no backend;
- iOS não anuncia gravação contínua de câmera em segundo plano como se fosse compatível.

## Dependências Expo alinhadas

- expo ~54.0.37
- expo-constants ~18.0.14
- expo-file-system ~19.0.24
- expo-system-ui ~6.0.9

O `package-lock.json` antigo foi removido de propósito porque estava travado nas versões que deram aviso no `expo-doctor`. Rode `npm install` no projeto limpo para gerar um lock novo coerente.
