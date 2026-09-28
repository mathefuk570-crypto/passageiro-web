# Correções — Gravação de Segurança TUM — 02/09/2026

## Passageiro
- Encerramento seguro da gravação ao concluir/cancelar/limpar contexto da corrida.
- Proteção nativa para falhas/interrupções do serviço de câmera.
- Fila de upload offline com WorkManager e retry automático quando a rede volta.
- Recuperação de sessões partial/failed e finalização pendente.
- Tokens usados pelo módulo de gravação protegidos via Android Keystore.
- Cálculo de orientação da câmera melhorado conforme sensor/dispositivo.
- Limite de segmento alinhado para 4–20 MB, com backend preparado para margem maior no Storage.
- Migrations e snapshot de referência do backend de gravação incluídos.
- iOS não anuncia suporte de gravação contínua enquanto a implementação nativa completa não existir.
