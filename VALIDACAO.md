# Validação desta entrega

- Compilação de produção: aprovada (Vite 6.4.1).
- TypeScript: aprovado, sem erros.
- Testes do service worker: aprovados para existência de todos os arquivos do cache, exclusão apenas de caches próprios antigos, fallback offline, não interceptação do backend, payload de push e bloqueio de navegação externa ao clicar em notificações.
- Build contém manifest, ícones, sons, marcadores, página offline e regras de hospedagem.
- Aviso de compilação: bundle principal acima de 500 kB (aproximadamente 720 kB gzip), incluindo mapas e telas existentes. Não impede publicação; é oportunidade futura de otimização.
- Teste visual automatizado: não concluído. Chromium falhou na inicialização gráfica deste ambiente.
- Login autenticado, banco, mapas reais, envio/aceite de corridas, uploads e entrega de Web Push: não testados em produção.
- Android original: não alterado; a entrega é um projeto PWA separado.
- Publicação: não executada. O endereço anterior continua como estava.
