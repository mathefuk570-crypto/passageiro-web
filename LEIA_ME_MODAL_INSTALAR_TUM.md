# PATCH TUM — Modal "Adicionar à tela inicial"

Aplicar na raiz do projeto Passageiro/PWA, mantendo a estrutura de pastas.

## Alterado

- Modal de instalação mais compacto, com menos margens e cards menores.
- Mantidas todas as instruções específicas por aparelho/navegador.
- Botão **INSTALAR TUM** maior, com alto contraste, ícone destacado e sombra.
- Ao tocar em instalar, o modal troca imediatamente para uma tela de carregamento.
- Depois que o usuário aceita o prompt do navegador, o loading permanece até o evento real `appinstalled`.
- Ao concluir, mostra **TUM instalado!** antes de fechar.
- Se o usuário cancelar o prompt, volta normalmente ao modal de instruções.
- A chave de exibição foi atualizada para `tum-pwa-install-guide-v4`, então quem já viu a versão antiga poderá ver o novo guia uma vez.

## Arquivo substituído

`dom/src/components/PwaInstallGuide.tsx`

## Observação iPhone/iPad

No iOS a instalação continua sendo manual pelo menu Compartilhar / Adicionar à Tela de Início, pois o sistema não expõe o prompt programático usado no Android.
