# TUM Passageiro — Gravação de segurança

Esta versão inclui o módulo Android nativo de gravação de segurança.

Principais pontos:
- apresentação no primeiro uso do recurso;
- início e fim manuais pelo botão REC durante a corrida;
- vídeo + áudio, câmera frontal/traseira ou somente áudio;
- gravação em segundo plano;
- upload progressivo para Storage privado, inclusive por dados móveis;
- fila local se ficar sem internet;
- Galeria protegida pelo bloqueio/biometria do aparelho;
- retenção e preservação controladas pelo backend/ADM.

## Build Android
Como há código nativo novo, execute `npx expo prebuild --platform android --clean` antes do build do APK/AAB.
