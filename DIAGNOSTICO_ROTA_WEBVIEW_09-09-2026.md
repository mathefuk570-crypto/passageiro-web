# Diagnóstico V2 — rota Mapbox dentro da WebView

## Evidência já obtida no aparelho

- A segunda chamada do Mapbox Directions respondeu `200 OK` e devolveu geometria real com vários pontos.
- No breakpoint do `HomeScreen`, `active=true`, `sequence=current` e a resposta tinha 28 pontos, então ela não era descartada antes de `setRouteCoords`.
- O breakpoint colocado dentro do `applyRoute` de `MapboxMapView.tsx`, depois da checagem de `map.isStyleLoaded()`, não foi atingido.

## Causa corrigida nesta versão

O renderer condicionava atualizações de rota e carros a `map.isStyleLoaded()`. Quando esse valor ficava temporariamente `false`, o código esperava um novo evento `style.load`. Depois do carregamento inicial do mapa, esse evento pode não ocorrer novamente para uma janela transitória de carregamento interno, deixando a atualização pendurada.

Isso combina com o comportamento observado: a primeira rota aparece; depois a UI muda, mas a geometria antiga permanece e a nova resposta de Directions não chega ao source visível.

## Alterações

- A source da rota principal, quando já existe, agora recebe `setData` imediatamente mesmo se `isStyleLoaded()` estiver temporariamente `false`.
- Limpar destino envia uma `FeatureCollection` vazia para a source existente, sem depender de novo `style.load`.
- Se a source ainda não existe, o código aguarda/retry de forma curta até o style permitir criá-la; não fica dependente de um único evento futuro.
- A mesma proteção foi aplicada às rotas de fila.
- A atualização dos carrinhos existentes também não é mais bloqueada por `isStyleLoaded()`; criação inicial da source continua aguardando o style estar pronto.
- Mantido WebView + Mapbox GL JS. Nenhuma migração para mapa nativo.
