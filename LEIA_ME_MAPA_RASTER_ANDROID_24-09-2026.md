# TUM Passageiro — fallback raster Android

Correção para mapas cinza em Android WebView/Expo DOM.

- Android passa a usar raster tiles do próprio Mapbox via Leaflet, sem WebGL.
- Web/iOS mantêm o Mapbox GL JS atual.
- Preserva origem, destino, paradas, carros, rota principal e rotas de fila.
- Toque no mapa usa reverse geocoding do Mapbox para recuperar endereço/local.
- Se o estilo do painel for Mapbox Standard, o raster usa streets-v12 (claro) ou dark-v11 (escuro), pois Static Tiles não suporta Standard.

Antes de usar o patch, instalar no projeto:

npm install leaflet @types/leaflet

Não exige rebuild nativo; reinicie o Metro depois da instalação.
