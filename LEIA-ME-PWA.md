# TUM Passageiro — PWA atualizado

Conversão do projeto Passageiroo.zip enviado em 17/09/2026. Projeto web independente: não substitua sua pasta Android por este pacote.

## Publicar a versão já compilada

A pasta `dist` contém o site pronto. Publique o CONTEÚDO dessa pasta em uma hospedagem com HTTPS, na raiz de um domínio ou subdomínio. Não envie o projeto inteiro como arquivos públicos.

Netlify: use a pasta dist em uma publicação manual. Para build por repositório, comando `npm run build`, saída `dist`.
Cloudflare Pages: envie a pasta dist como arquivos estáticos. Para build por repositório: `npm ci` e `npm run build`, saída `dist`. É um projeto Pages, não um Worker com comando de deploy.

Para manter tum-passageiro.expo.app, é necessário publicar no mesmo projeto EAS Hosting da sua conta. Este pacote não efetua publicação nem altera o endereço antigo. A saída estática está em dist; o acesso à conta e o fluxo de publicação precisam ser configurados no ambiente que já publica nesse endereço.

## Rodar e editar

Use Node.js 22 LTS ou superior.

```sh
npm ci
npm run dev
```

Para gerar novamente a versão publicável:

```sh
npm run build
npm run preview
```

O comando build verifica TypeScript, gera os arquivos e monta o service worker com a versão correspondente. Não copie public/sw.js manualmente: a versão completa é gerada em dist/sw.js.

## O que foi adaptado

- Interface atual do ZIP: login/cadastro, categorias e mapas, solicitação e acompanhamento de corrida, fila, paradas, chat com imagem/áudio, denúncias, suporte, novidades, perfil, locais salvos e galeria de segurança.
- Entrada web sem esperar a ponte nativa de permissões Android. Localização por permissão do navegador; entrada manual disponível se negada.
- Central de permissões com ações web; câmera e microfone apenas por ação do usuário.
- Instalação no Android quando oferecida pelo navegador e instruções para adicionar à Tela de Início no iPhone.
- Manifest, ícones, tela sem conexão e aviso de atualização. Uma nova versão não força recarga durante uma corrida.
- Service worker guarda apenas arquivos estáticos locais; não armazena respostas do banco, chat, localização ou gravações.
- Links internos de novidades e notificações abrem a tela correspondente.
- Projeto independente sem certificados, senhas de assinatura ou arquivos de build Android.

## Limites e dependências

REC contínuo em segundo plano: desativado na web, tanto no Android quanto no iPhone. Use o app Android para esse recurso. A galeria de gravações já enviadas continua integrada ao mesmo backend. A preferência de gravação da conta Android não é alterada ao abrir o PWA.

Notificações: reaproveitam o registro Web Push e a chave pública existentes no projeto. É preciso que o servidor envie Web Push para as inscrições salvas pelo RPC register_my_push_token_tum. Não foi possível validar esse envio na conta. No iPhone, Web Push exige iOS 16.4 ou superior, instalação na Tela de Início e permissão solicitada por um toque do usuário. Áudios personalizados podem tocar com a página aberta após interação; não equivalem aos canais nativos do Android com a tela fechada.

Internet: necessária para pedir/acompanhar corridas, mapas, chat e uploads. A tela offline não representa funcionamento de corridas sem internet.

Mapas: as chaves e configurações existentes são mantidas. Se as chaves tiverem restrição de domínio, autorize o domínio final no provedor de mapas. Mantenha também os URLs de redirecionamento de autenticação compatíveis com o domínio final se usar esses fluxos.

O cliente mantém a URL e a chave pública anon já presentes no ZIP. Nenhum banco, política, função ou bucket foi alterado. Os controles de acesso existentes no servidor continuam necessários.

## Antes de liberar para passageiros

Teste com sua conta e um motorista de teste: login, endereço/rota, pedido e aceite, fila, chegada, chat com texto/foto/áudio, cancelamento, finalização, denúncia e galeria. Confirme o recebimento de push com o PWA fechado. Teste no Safari do seu iPhone instalado e no Chrome Android. Esses testes reais não foram executados neste ambiente.

## Referências técnicas

- https://vite.dev/guide/build
- https://vite.dev/guide/assets
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
