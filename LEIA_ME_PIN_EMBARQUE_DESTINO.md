# TUM Passageiro — correção do PIN de embarque/destino

## Problema encontrado
O `HomeScreen` envia `onLocationDragSelect`, mas apenas `RasterMapView` implementava esse callback.
`MapboxMapView` e `GoogleMapView` ignoravam a prop. Como o `HomeScreen` também não envia `onMapClick` como fallback, tocar em uma área vazia do mapa nesses renderizadores não fazia nada.

## Correção
- Mapbox: toque no mapa cria o PIN temporário; novo toque reposiciona; arrastar e soltar confirma; tocar no PIN confirma.
- Google Maps: mesmo comportamento.
- Raster/Leaflet: já tinha o comportamento e foi preservado.
- Ao confirmar, faz reverse geocode e abre o modal existente com:
  - Definir como embarque
  - Definir como destino
- O PIN desaparece ao sair da fase de nova viagem.

## Aplicação
Extraia este patch na raiz do projeto Passageiro, aceitando substituir os arquivos.

Arquivos alterados:
- `dom/src/components/MapboxMapView.tsx`
- `dom/src/components/GoogleMapView.tsx`

Asset incluído por segurança:
- `public/map-markers/tum-location-pin.png`
