# TUM WEB — Hotfix Samsung Internet / cores V2
Data: 28/09/2026

## Problema
No Samsung Internet, principalmente com o modo escuro do navegador ativo, o navegador podia aplicar uma segunda transformação de cores por cima do tema do TUM. O efeito era amarelo alterado/amarronzado, fundos e superfícies com tons diferentes e mapa/mídia visualmente "lavados", enquanto no Chrome do mesmo aparelho a interface aparecia correta.

## O que muda nesta V2
O patch anterior anunciava `dark light` como esquemas suportados. Em algumas versões Chromium/Samsung isso ainda permite Auto Dark.

Agora o TUM trava **somente o tema que está realmente ativo**:
- tema escuro -> `color-scheme: only dark`
- tema claro -> `color-scheme: only light`

A trava é aplicada:
- no `<head>` antes da primeira pintura;
- nas meta tags de `color-scheme`;
- no `html`, `body` e `#root`;
- novamente ao trocar tema, voltar ao app, trocar aba ou recuperar o navegador;
- em imagens, SVG, canvas e mapas no Samsung Internet para impedir filtros/blends extras.

O botão claro/escuro do TUM continua funcionando normalmente.

## Arquivos
- `app/+html.tsx`
- `dom/src/hooks/useTheme.tsx`
- `dom/src/index.css`

## Como aplicar
Extraia este ZIP por cima do projeto WEB/PWA e aceite substituir os arquivos.

Depois reinicie limpando o cache do Expo:

```bat
npx expo start --web --lan -c
```

Para testar o comportamento real no Samsung Internet, prefira a versão publicada em HTTPS.

## Depois de publicar
O Samsung Internet pode manter CSS/HTML antigo agressivamente. No aparelho:
1. feche todas as abas do TUM;
2. limpe os dados do site/cache do endereço do TUM no Samsung Internet;
3. abra novamente a URL publicada;
4. teste tema escuro e claro.

Se o navegador estiver com uma opção global de **forçar modo escuro em páginas da Web**, esta V2 pede explicitamente que o Chromium não faça essa conversão. Versões modificadas do navegador podem, em último caso, ignorar a preferência do site.
