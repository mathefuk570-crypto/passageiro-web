# Correção — movimento dos motoristas no mapa

Implementado em 01/09/2026.

- Mapbox: todos os carros usam uma única source/layer GPU.
- Suavização de todos os motoristas com um único requestAnimationFrame e um único setData por frame.
- FPS adaptativo conforme quantidade de carros, evitando custo linear de loops independentes.
- Filtragem de jitter de GPS e amostras com precisão muito ruim.
- Rejeição visual de amostras antigas e deslocamentos fisicamente impossíveis.
- Orientação usa heading do GPS quando o veículo está em movimento; fallback pelo bearing entre coordenadas.
- Google Maps: markers persistentes, sem destruir/recriar todos a cada pulso, e animação compartilhada com FPS adaptativo.
- DriverLocation passou a entender location_sampled_at, heading_degrees, speed_mps e accuracy_m.
- Corrida ativa recebe os mesmos metadados no RPC de localização ao vivo.
