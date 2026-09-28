# TUM Passageiro — auditoria e correções 03/09/2026

## Tela cinza / mapa
- Corrigida a troca agressiva de `map.setStyle()` que ocorria 1–2 s após abrir e podia deixar o canvas cinza em Android WebView.
- Mudanças de provedor, chave ou estilo do Painel ADM agora recriam a instância do mapa de forma limpa.
- Configuração inicial usa os mesmos estilos padrão atuais do Painel ADM.
- `city_map_settings` é aplicado: centro, zoom e bias de busca da cidade.
- `city_id` do passageiro chega ao mapa, busca e overrides manuais.
- Google Maps só entra se estiver habilitado e com chave; se falhar, volta automaticamente ao Mapbox.
- Alterações de `map_settings` e `city_map_settings` continuam chegando por Realtime e `config_revision`.
- Pins, rota, animação, autocomplete, provedor de busca e provedor de rotas usam a configuração pública do painel.

## Permissões
- Pedidos são feitos pelos popups nativos do Android, não mandando o passageiro para Configurações sem necessidade.
- Corrigido o fluxo que podia fechar a tela de permissões logo após liberar localização e interromper os popups seguintes.
- Localização, notificações, microfone e câmera podem ser liberados em sequência.
- Configurações do Android aparecem apenas quando uma permissão foi bloqueada/“não perguntar novamente”.
- Passageiro precisa apenas de localização durante o uso; “Permitir o tempo todo” é exigência do Motorista, não do Passageiro.

## APK / release
- Plugin persistente sobrevive a `expo prebuild --clean`.
- R8/minify, shrinkResources e PNG crunch ativados no release.
- Apenas ARMv7 + ARM64 são mantidos; x86/x86_64 de emulador ficam fora.
- `assembleRelease` gera APK separado por ABI, evitando um APK universal de ~70 MB. Para celulares atuais, usar o `arm64-v8a`.
- O AAB do Play Store continua podendo atender as duas arquiteturas e a loja entrega só a ABI necessária ao aparelho.

## Gravação de segurança
- Mesma correção de rotação validada no Motorista: Activity visual captura display/rotação; o Service não consulta `display`.
- Android 14+ inicia câmera/microfone pela Activity transparente, sem abrir a interface principal do TUM.
- Camera2 + MediaRecorder usa `CamcorderProfile` compatível com Samsung e fallback seguro.
- Bitrate limitado: data saver ~650 kbps, balanceado ~1,2 Mbps, clear ~2,2 Mbps; áudio 48–64 kbps.
- Botão fica bloqueado durante inicialização, exige estado estável e mostra erro real se câmera/gravador falhar.
- WorkManager/retry offline, segmentos, auto-stop no fim/cancelamento e recuperação de uploads permanecem ativos.
