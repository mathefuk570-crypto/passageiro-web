import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Ride = Record<string, unknown>;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const esc = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const isLive = (status: string) => ['queued','accepted','driver_arrived','arrived','waiting','started','in_progress'].includes(status);
const statusLabel = (status: string) => ({
  queued: 'Motorista confirmado · finalizando outra corrida',
  accepted: 'Motorista a caminho',
  driver_arrived: 'Motorista no embarque',
  arrived: 'Motorista no embarque',
  waiting: 'Aguardando passageiro',
  started: 'Viagem em andamento',
  in_progress: 'Viagem em andamento',
  completed: 'Viagem concluída',
  cancelled: 'Corrida cancelada',
}[status] ?? 'Corrida TUM');

function pageUnavailable(message: string, status = 404) {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>TUM · Compartilhamento</title><style>*{box-sizing:border-box}body{margin:0;background:#08090b;color:#fff;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;display:grid;min-height:100vh;place-items:center;padding:24px}.c{width:min(440px,100%);background:#141518;border:1px solid #ffffff18;border-radius:28px;padding:30px;text-align:center;box-shadow:0 24px 70px #0008}.l{width:62px;height:62px;margin:auto;background:#facc15;color:#111;border-radius:20px;display:grid;place-items:center;font-weight:1000;font-size:18px}.mut{color:#ffffff80;line-height:1.55}</style></head><body><main class="c"><div class="l">TUM</div><h2>Compartilhamento indisponível</h2><p class="mut">${esc(message)}</p></main></body></html>`, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const token = new URL(req.url).searchParams.get('token')?.trim() ?? '';
  if (!/^[a-f0-9]{64}$/i.test(token)) return pageUnavailable('O link está incompleto ou inválido.');

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_shared_ride_by_token_tum`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ p_token: token }),
    });
    if (!response.ok) return pageUnavailable('Não foi possível consultar esta corrida agora.', 503);

    const ride = (await response.json()) as Ride | null;
    if (!ride?.ride_id) return pageUnavailable('Este compartilhamento expirou ou foi encerrado.');

    const status = String(ride.status ?? '');
    const live = isLive(status);
    const queued = status === 'queued';
    const queuePosition = Math.max(1, Number(ride.queue_position ?? 1) || 1);
    const queueEta = Number(ride.queue_after_current_estimated_minutes ?? 0) || 0;
    const currentStatus = String(ride.queue_current_status ?? '');

    const driverLat = num(ride.latitude);
    const driverLng = num(ride.longitude);
    const originLat = num(ride.origin_lat);
    const originLng = num(ride.origin_lng);
    const destinationLat = num(ride.destination_lat);
    const destinationLng = num(ride.destination_lng);
    const currentOriginLat = num(ride.queue_current_origin_lat);
    const currentOriginLng = num(ride.queue_current_origin_lng);
    const currentDestinationLat = num(ride.queue_current_destination_lat);
    const currentDestinationLng = num(ride.queue_current_destination_lng);

    const points = {
      driver: driverLat !== null && driverLng !== null ? [driverLat, driverLng] : null,
      origin: originLat !== null && originLng !== null ? [originLat, originLng] : null,
      destination: destinationLat !== null && destinationLng !== null ? [destinationLat, destinationLng] : null,
      currentOrigin: currentOriginLat !== null && currentOriginLng !== null ? [currentOriginLat, currentOriginLng] : null,
      currentDestination: currentDestinationLat !== null && currentDestinationLng !== null ? [currentDestinationLat, currentDestinationLng] : null,
    };

    const mapData = JSON.stringify({ status, currentStatus, queued, queuePosition, points }).replaceAll('<', '\\u003c');
    const photo = typeof ride.driver_photo === 'string' && /^https:\/\//i.test(ride.driver_photo) ? ride.driver_photo : '';

    const fallbackCenter = points.driver ?? points.origin ?? points.destination ?? [-21.756, -48.829];
    const lat = Number(fallbackCenter[0]);
    const lng = Number(fallbackCenter[1]);
    const delta = 0.012;
    const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
    const fallbackMapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lng}`)}`;

    const queueInfo = queued ? `<div class="queue"><b>${queuePosition}ª posição na fila do motorista</b>${queueEta > 0 ? `<span>Previsão aproximada até o seu embarque: ${Math.max(1, Math.round(queueEta))} min</span>` : ''}<span>${queuePosition === 1 ? 'Vermelho: compromisso atual do motorista · Amarelo: próximo trajeto até você.' : 'A posição do motorista continua visível, sem revelar os endereços dos outros passageiros.'}</span></div>` : '';

    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Acompanhar corrida · TUM</title>${live ? '<meta http-equiv="refresh" content="8">' : ''}<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>*{box-sizing:border-box}body{margin:0;background:#08090b;color:#f8f8f8;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}.page{max-width:640px;margin:auto;padding:18px 14px 34px}.top{display:flex;gap:12px;align-items:center;margin-bottom:14px}.logo{width:50px;height:50px;border-radius:17px;background:#facc15;color:#111;display:grid;place-items:center;font-weight:1000}.top h1{margin:0;font-size:19px}.mut{color:#ffffff70;font-size:12px}.status,.card{background:#141518;border:1px solid #ffffff16;border-radius:22px;padding:15px;margin-top:10px}.status{border-color:#facc1555;background:#facc1512}.ey{font-size:9px;letter-spacing:.14em;text-transform:uppercase;font-weight:900;color:#facc15}.status h2{font-size:17px;margin:5px 0 0}.driver{display:flex;gap:12px;align-items:center}.avatar{width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid #facc15;background:#222}.fallback-avatar{width:56px;height:56px;border-radius:50%;border:2px solid #facc15;background:#222;display:grid;place-items:center;color:#facc15;font-weight:900}.name{font-weight:900;font-size:16px}.plate{display:inline-flex;margin-top:6px;padding:3px 7px;border:1px solid #ffffff22;border-radius:7px;font:800 11px monospace}.map-wrap{position:relative;height:365px;border-radius:18px;overflow:hidden;background:#17181b}.map-fallback,#map{position:absolute;inset:0;width:100%;height:100%;border:0}.map-fallback{z-index:1}.leaflet-ready #map{z-index:2}.leaflet-ready .map-fallback{display:none}.legend{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.tag{font-size:10px;font-weight:800;padding:6px 9px;border-radius:999px;background:#ffffff0c}.red{color:#ff5a5f}.yellow{color:#facc15}.queue{display:grid;gap:5px;margin-top:12px;padding:11px;border-radius:14px;background:#facc1512;border:1px solid #facc1533;font-size:11px}.queue b{color:#facc15;font-size:13px}.route{display:flex;gap:10px;margin-top:12px}.dot{width:11px;height:11px;margin-top:4px;border:3px solid #facc15;border-radius:50%}.dot.destination{background:#facc15}.addr{font-size:13px;font-weight:700;line-height:1.4}.lab{font-size:9px;color:#ffffff55;font-weight:900;text-transform:uppercase}.refresh{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:9px;font-size:10px;color:#ffffff50}.live{display:inline-flex;align-items:center;gap:5px}.pulse{width:7px;height:7px;border-radius:50%;background:#38d27a;box-shadow:0 0 0 4px #38d27a22}.notice{font-size:10px;line-height:1.6;color:#ffffff55;text-align:center;margin:16px 8px}.fallback-note{position:absolute;bottom:8px;left:8px;right:8px;z-index:3;padding:7px 9px;border-radius:10px;background:#08090bcc;color:#fff9;font-size:10px;text-align:center;pointer-events:none}.leaflet-ready .fallback-note{display:none}</style></head><body><main class="page"><div class="top"><div class="logo">TUM</div><div><h1>Acompanhar corrida</h1><div class="mut">Ligando caminhos, aproximando pessoas</div></div></div><section class="status"><div class="ey">Status da corrida</div><h2>${esc(statusLabel(status))}</h2><div class="mut">${ride.category ? esc(ride.category) : 'TUM'} · #${esc(String(ride.ride_id).slice(0,8).toUpperCase())}</div>${queueInfo}</section><section class="card"><div class="driver">${photo ? `<img class="avatar" src="${esc(photo)}" alt="Motorista">` : `<div class="fallback-avatar">${esc(String(ride.driver_name ?? 'M').slice(0,1).toUpperCase())}</div>`}<div><div class="ey">Motorista</div><div class="name">${esc(ride.driver_name || 'Motorista TUM')}</div><div class="mut">${esc(ride.vehicle_model || 'Veículo confirmado')}</div>${ride.vehicle_plate ? `<div class="plate">${esc(String(ride.vehicle_plate).toUpperCase())}</div>` : ''}</div></div></section><section class="card"><div id="mapShell" class="map-wrap"><iframe class="map-fallback" title="Mapa da corrida" src="${fallbackMapUrl}" loading="eager"></iframe><div id="map"></div><div class="fallback-note">Acompanhamento TUM · o mapa atualiza automaticamente</div></div><div class="legend">${queued ? '<span class="tag red">● Compromisso atual do motorista</span>' : ''}<span class="tag yellow">● Sua corrida</span></div><div class="refresh">${live ? '<span class="live"><i class="pulse"></i> Atualizando a cada 8 s</span>' : '<span>Corrida encerrada</span>'}<span>Mapa TUM</span></div></section><section class="card"><div class="route"><i class="dot"></i><div><div class="lab">Seu embarque</div><div class="addr">${esc(ride.origin_address || 'Local de embarque')}</div></div></div><div class="route"><i class="dot destination"></i><div><div class="lab">Seu destino</div><div class="addr">${esc(ride.destination_address || 'Destino da corrida')}</div></div></div></section><p class="notice">Este link não mostra telefone, CPF, forma de pagamento, chat nem endereços de outros passageiros. Compartilhe apenas com pessoas de confiança.</p></main><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>const D=${mapData};(async()=>{try{if(!window.L)return;const shell=document.getElementById('mapShell');const map=L.map('map',{zoomControl:true});L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);const bounds=[];const mk=(p,label,color)=>{if(!p)return null;const marker=L.circleMarker(p,{radius:8,color:'#111',weight:3,fillColor:color,fillOpacity:1}).addTo(map).bindTooltip(label);bounds.push(p);return marker};const line=(coords,color,dash)=>{if(!coords||coords.length<2)return;L.polyline(coords,{color,weight:6,opacity:.95,dashArray:dash||null,lineCap:'round'}).addTo(map);coords.forEach(p=>bounds.push(p))};async function route(a,b,color){if(!a||!b)return;try{const url='https://router.project-osrm.org/route/v1/driving/'+a[1]+','+a[0]+';'+b[1]+','+b[0]+'?overview=full&geometries=geojson';const res=await fetch(url);const json=await res.json();const coords=json?.routes?.[0]?.geometry?.coordinates?.map(p=>[p[1],p[0]]);if(coords?.length)line(coords,color);else line([a,b],color,'8 8')}catch{line([a,b],color,'8 8')}}const p=D.points;if(D.queued){mk(p.driver,'Motorista agora','#111');mk(p.currentOrigin,'Embarque da viagem atual','#ff5a5f');mk(p.currentDestination,'Fim da viagem atual','#ff5a5f');mk(p.origin,'Seu embarque','#facc15');const pickupStage=['accepted','driver_arrived','arrived','waiting'].includes(D.currentStatus);if(pickupStage&&p.currentOrigin){await route(p.driver,p.currentOrigin,'#ff5a5f');await route(p.currentOrigin,p.currentDestination,'#ff5a5f')}else{await route(p.driver,p.currentDestination,'#ff5a5f')}if(D.queuePosition===1)await route(p.currentDestination,p.origin,'#facc15')}else if(['accepted','driver_arrived','arrived','waiting'].includes(D.status)){mk(p.driver,'Motorista','#111');mk(p.origin,'Seu embarque','#facc15');await route(p.driver,p.origin,'#facc15')}else if(['started','in_progress'].includes(D.status)){mk(p.driver,'Motorista','#111');mk(p.destination,'Seu destino','#facc15');await route(p.driver,p.destination,'#facc15')}else{mk(p.origin,'Embarque','#facc15');mk(p.destination,'Destino','#facc15');if(p.origin&&p.destination)line([p.origin,p.destination],'#facc15','8 8')}if(bounds.length)map.fitBounds(L.latLngBounds(bounds),{padding:[35,35],maxZoom:16});else map.setView([-21.756,-48.829],13);shell.classList.add('leaflet-ready')}catch(error){console.warn('TUM tracking map fallback active',error)}})();</script></body></html>`;

    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, max-age=0',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; img-src https://*.tile.openstreetmap.org https: data:; style-src 'unsafe-inline' https://unpkg.com; script-src 'unsafe-inline' https://unpkg.com; connect-src https://router.project-osrm.org; frame-src https://www.openstreetmap.org; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  } catch (error) {
    console.error(error);
    return pageUnavailable('Não foi possível abrir esta corrida agora.', 500);
  }
});
