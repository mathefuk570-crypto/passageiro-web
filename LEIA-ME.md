# TUM WEB — trava somente quando o navegador oferece instalação

## Regra nova
O TUM **não tenta mais obrigar instalação/standalone em todo navegador**.

No celular, o fluxo fica assim:

- Se o navegador disparar o prompt nativo de instalação (`beforeinstallprompt`), o TUM mostra a tela obrigatória de instalação e só libera depois que o usuário aceitar a instalação.
- Se o navegador **não** disponibilizar esse prompt, o TUM é liberado normalmente. Nesse caso o passageiro pode usar o navegador e/ou o recurso manual **Adicionar à tela inicial** sem ficar preso numa verificação de tela cheia/standalone.
- Se o TUM já estiver instalado ou tiver sido aberto por um atalho reconhecido, o acesso é liberado normalmente.

## Verificação inicial
O app aguarda cerca de **1,4 segundo** na abertura para dar tempo de navegadores Chromium disponibilizarem o prompt de instalação. Se o prompt não aparecer, o TUM continua normalmente.

## Depois de aceitar a instalação
Quando o passageiro aceita o prompt nativo, a aba atual é liberada imediatamente. O evento `appinstalled` continua sendo ouvido como confirmação adicional.

## Arquivos alterados
- `dom/src/App.tsx`
- `dom/src/lib/pwaInstall.ts`

## Como aplicar
Extraia o ZIP por cima da versão WEB/PWA atual e aceite substituir os arquivos.

Depois reinicie o servidor limpando o cache:

```bash
npx expo start --web --lan -c
```

Para testar o prompt real de instalação, prefira a versão publicada em HTTPS. Em IP local (`http://192.168...`) o navegador normalmente não disponibiliza instalação nativa, então o TUM será liberado sem travar — que é justamente a regra nova.
