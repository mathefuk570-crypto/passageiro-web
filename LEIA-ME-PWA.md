# TUM Passageiro — PWA atualizada

Esta versão foi preparada a partir do app Passageiro mais atualizado para substituir a PWA anterior.

## O que foi ajustado

- PWA com manifest próprio, ícones e modo standalone.
- Modal inteligente de instalação para iPhone/iPad e Android, com instruções específicas para Safari, Chrome, Samsung Internet, Edge e Firefox.
- No Android compatível, usa o prompt nativo de instalação quando o navegador disponibiliza.
- Bloqueio do zoom involuntário da página e do zoom automático ao focar campos de texto, sem bloquear o pinch/zoom do mapa.
- Tema claro/escuro controlado pelo próprio TUM, reduzindo interferência do tema forçado pelo navegador/aparelho.
- Service worker atualizado sem cache da interface e com limpeza de caches antigos, evitando que a versão PWA anterior continue aparecendo depois do deploy.
- Gravação de segurança mantida no Android nativo e adicionada ao PWA quando o navegador oferece MediaRecorder MP4 compatível.
- No PWA, a gravação é dividida em segmentos curtos e enviada ao mesmo backend de segurança do TUM.

## Limite importante da gravação no PWA

A versão Android nativa continua sendo a opção capaz de usar o gravador nativo em segundo plano. Navegadores de iPhone/Android podem suspender câmera ou microfone quando a tela é bloqueada, o navegador vai para segundo plano ou o sistema encerra a aba. Por isso, durante REC no PWA, o TUM orienta o passageiro a manter o app aberto. Segmentos que já chegaram à nuvem não dependem da aba continuar aberta.

## Gerar a versão para publicar

No Windows, dê dois cliques em `GERAR-PWA.bat` ou rode no terminal, dentro desta pasta:

```bash
npm ci
npm run build:web
```

A pasta pronta para publicar será `dist`.

Para câmera, microfone, service worker e instalação PWA funcionarem fora do localhost, publique o site em HTTPS.

## Observação sobre este ZIP

A pasta `dist` antiga foi removida de propósito para impedir que uma build velha seja publicada por engano. Gere uma `dist` nova com os comandos acima antes do deploy.
