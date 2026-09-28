# Passageiro — vídeo de segurança em denúncias (03/09/2026)

- A denúncia pode anexar uma gravação de segurança em vídeo da mesma corrida.
- O app só lista gravações do próprio Passageiro e da corrida atual.
- O vídeo não é reenviado nem duplicado: a denúncia guarda uma referência à gravação já existente.
- Ao ser anexado, o vídeo é preservado automaticamente (`expires_at = null`) para não ser removido pela retenção normal enquanto serve como evidência.
- O Painel ADM mostra o vídeo vinculado e permite navegar por todos os trechos.

## Status do recurso no backend
- `passenger_enabled = true`
- `quality_preset = balanced`
- `retention_days = 7`
- `mobile_upload_enabled = true`

A configuração global habilita o recurso, mas a preferência individual `enabled` continua opt-in: o Passageiro precisa ativar a gravação no próprio app.
