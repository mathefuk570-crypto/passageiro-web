# TUM Passageiro Nativo — Expo DOM

Este é o projeto recomendado para gerar o APK de teste hoje. Ele cria um aplicativo Expo nativo para Android e incorpora a interface completa atual do passageiro usando Expo DOM Components.

## O que é nativo agora

- APK e pacote Android próprios.
- Push notification e canal Android.
- Permissões do aplicativo.
- Abertura da tela correta ao tocar na notificação.
- Status bar e fundo acompanhando o tema.

A interface ainda é a versão React web dentro do componente DOM/WebView. Isso permite testar e publicar uma versão nativa rapidamente sem reescrever todas as telas agora. A migração completa para componentes React Native pode ser feita gradualmente depois.

## Primeira configuração

```bash
npm install
npx eas login
npx eas init
```

O `eas init` adicionará o `projectId` necessário para gerar o token de push.

## APK para testar sem o computador

```bash
npx eas build --profile preview --platform android
```

## Build de desenvolvimento

```bash
npx eas build --profile development --platform android
npx expo start --dev-client
```

Depois de instalar:

1. Entre na conta do passageiro.
2. Permita notificações e localização.
3. Confira no Painel Admin se o aparelho apareceu em **Notificações**.
4. Envie um teste particular para esse passageiro.
5. Teste o sininho e o Fale conosco.

Push remoto não deve ser validado pelo Expo Go; use o APK gerado pelo EAS.
