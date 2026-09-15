// POST /api/kakao — single proxy for Kakao REST endpoints. Body: { action, params }
// Requires KAKAO_REST_API_KEY. Never exposes the key to the client.
// car/walk/transit responses are normalized server-side to { distanceKm, minutes, transfers, pathPoints }
// so the frontend never has to special-case each Kakao response shape.

const LOCAL_BASE = 'https://dapi.kakao.com';
const MOBILITY_BASE = 'https://apis-navi.kakaomobility.com';

async function kakaoGet(url, params) {
  const u = new URL(url);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  });
  const r = await fetch(u, { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` } });
  const data = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, data };
}

// Kakao Navi(자동차): routes[0].summary.{distance(m), duration(s)}, routes[0].sections[].roads[].vertexes ([x,y,x,y,...])
function parseCarRoute(data) {
  const route = data?.routes?.[0];
  if (!route || !route.summary) return null;
  const pathPoints = [];
  (route.sections || []).forEach(sec => (sec.roads || []).forEach(road => {
    const v = road.vertexes || [];
    for (let i = 0; i < v.length; i += 2) pathPoints.push({ x: v[i], y: v[i + 1] });
  }));
  return {
    distanceKm: route.summary.distance / 1000,
    minutes: Math.round(route.summary.duration / 60),
    transfers: null,
    pathPoints,
    landingURL: data?.landingUrl ?? data?.landingURL ?? route?.landingUrl ?? route?.landingURL ?? null,
  };
}

// Kakao 도보: route.properties.{totalDistance(m), totalTime(s)}, route.legs[].steps[].path.points ([x,y] pairs)
function parseWalkRoute(data) {
  const route = data?.routes?.[0] || data?.route || data;
  const props = route?.properties;
  if (!props) return null;
  const pathPoints = [];
  (route.legs || []).forEach(leg => (leg.steps || []).forEach(step => {
    (step.path?.points || []).forEach(pt => pathPoints.push({ x: pt[0], y: pt[1] }));
  }));
  return {
    distanceKm: props.totalDistance / 1000,
    minutes: Math.round(props.totalTime / 60),
    transfers: null,
    pathPoints,
    landingURL: data?.landingUrl ?? data?.landingURL ?? route?.landingUrl ?? route?.landingURL ?? null,
  };
}

// Kakao 자전거: route.properties.{totalDistance(m), totalTime(s)}, route.legs[].steps[].path.points ([x,y] pairs)
function parseBikeRoute(data) {
  const route = data?.routes?.[0] || data?.route || data;
  const props = route?.properties;
  if (!props) return null;
  const pathPoints = [];
  (route.legs || []).forEach(leg => (leg.steps || []).forEach(step => {
    (step.path?.points || []).forEach(pt => pathPoints.push({ x: pt[0], y: pt[1] }));
  }));
  return {
    distanceKm: props.totalDistance / 1000,
    minutes: Math.round(props.totalTime / 60),
    transfers: null,
    pathPoints,
    landingURL: data?.landingUrl ?? data?.landingURL ?? route?.landingUrl ?? route?.landingURL ?? null,
  };
}

// Kakao 대중교통: route.properties.{totalDistance(m), totalTime(s), transferCount?}, path.points per step.
// transitSteps는 각 step의 실제 API 필드만 사용해서 만든다 — 응답에 없는 값은 null로 두고 지어내지 않는다.
function parseTransitRoute(data, criteria) {
  const routes = Array.isArray(data?.routes) ? data.routes : (data?.route ? [data.route] : (data ? [data] : []));
  if (routes.length === 0) { console.error('kakao transit parse: no routes in response'); return null; }
  // 후보가 여러 개면 criteria(최단시간/최단거리) 기준으로 실제 totalTime/totalDistance를 비교해 선택.
  let route = routes[0];
  if (routes.length > 1) {
    const withTotals = routes
      .map(rt => ({ rt, t: rt?.properties?.totalTime, d: rt?.properties?.totalDistance }))
      .filter(x => x.t != null && x.d != null);
    if (withTotals.length > 0) {
      route = criteria === 'distance'
        ? withTotals.reduce((best, cur) => cur.d < best.d ? cur : best).rt
        : withTotals.reduce((best, cur) => cur.t < best.t ? cur : best).rt;
    }
    console.log('[route] transit candidates', { count: routes.length, criteria, totals: routes.map(rt => ({ t: rt?.properties?.totalTime, d: rt?.properties?.totalDistance })) });
  }
  const props = route?.properties;
  if (!props) { console.error('kakao transit parse: no properties in route, route keys:', Object.keys(route || {})); return null; }
  console.log('[route] transit props raw:', JSON.stringify(props));
  const pathPoints = [];
  const transitSteps = [];
  const steps = Array.isArray(route.steps) ? route.steps : [];
  steps.forEach((step, si) => {
    const p = step.properties || {};
    (step.path?.points || []).forEach(pt => {
      if (Array.isArray(pt)) pathPoints.push({ x: pt[0], y: pt[1] });
    });
    const rawType = p.type;
    const type = rawType != null
      ? (/walk|foot/i.test(String(rawType)) ? 'WALKING' : (/subway|rail|metro|train/i.test(String(rawType)) ? 'SUBWAY' : (/bus/i.test(String(rawType)) ? 'BUS' : String(rawType).toUpperCase())))
      : null;
    if (type == null) console.error(`kakao transit parse: step[${si}] has no properties.type, keys:`, Object.keys(p || {}));
    const minutes = p.time != null ? Math.round(p.time / 60) : null;
    if (minutes == null) console.error(`kakao transit parse: step[${si}] has no properties.time, keys:`, Object.keys(p || {}));
    const distanceKm = p.distance != null ? p.distance / 1000 : null;
    if (distanceKm == null) console.error(`kakao transit parse: step[${si}] has no properties.distance, keys:`, Object.keys(p || {}));
    const stops = Array.isArray(p.stops) ? p.stops : [];
    const vehicle = Array.isArray(p.vehicles) && p.vehicles.length > 0 ? p.vehicles[0] : null;
    transitSteps.push({
      type,
      minutes,
      distanceKm,
      fromName: stops[0]?.name ?? p.start?.name ?? null,
      toName: stops[stops.length - 1]?.name ?? p.end?.name ?? null,
      vehicleName: vehicle?.name ?? vehicle?.no ?? p.guidance ?? null,
      stopCount: stops.length > 0 ? stops.length : null,
    });
  });
  console.log('[route] transit parse', { stepsLength: steps.length, transitStepsLength: transitSteps.length, types: transitSteps.map(s => s.type) });
  if (transitSteps.length === 0) {
    console.error('kakao transit parse: no steps found in response, route keys:', Object.keys(route || {}));
  }
  const totalDistanceRaw = props.totalDistance ?? props.distance ?? props.total_distance ?? route.distance ?? null;
  const totalTimeRaw = props.totalTime ?? props.time ?? props.total_time ?? route.duration ?? null;
  if (totalDistanceRaw == null) console.error('kakao transit parse: no total distance field, properties keys:', Object.keys(props || {}));
  if (totalTimeRaw == null) console.error('kakao transit parse: no total time field, properties keys:', Object.keys(props || {}));
  return {
    distanceKm: totalDistanceRaw != null ? totalDistanceRaw / 1000 : 0,
    minutes: totalTimeRaw != null ? Math.round(totalTimeRaw / 60) : 0,
    transfers: props.transferCount ?? props.transferCnt ?? null,
    pathPoints,
    transitSteps,
    landingURL: data?.landingUrl ?? data?.landingURL ?? route?.landingUrl ?? route?.landingURL ?? null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!process.env.KAKAO_REST_API_KEY) { res.status(500).json({ error: 'Kakao API 키가 설정되지 않았습니다.' }); return; }

  const { action, params } = req.body || {};
  try {
    switch (action) {
      case 'geocode': {
        const r = await kakaoGet(`${LOCAL_BASE}/v2/local/search/address.json`, { query: params?.query });
        if (!r.ok) { console.error('kakao geocode error', r.status, r.data); res.status(502).json({ error: '주소를 찾지 못했습니다.', detail: r.data }); return; }
        res.status(200).json(r.data);
        return;
      }
      case 'keyword': {
        const r = await kakaoGet(`${LOCAL_BASE}/v2/local/search/keyword.json`, { query: params?.query, x: params?.x, y: params?.y, radius: params?.radius });
        if (!r.ok) { console.error('kakao keyword error', r.status, r.data); res.status(502).json({ error: '장소를 찾지 못했습니다.', detail: r.data }); return; }
        res.status(200).json(r.data);
        return;
      }
      case 'car': {
        const r = await kakaoGet(`${MOBILITY_BASE}/v1/directions`, {
          origin: `${params?.originX},${params?.originY}`,
          destination: `${params?.destX},${params?.destY}`,
          priority: params?.priority === 'distance' ? 'SHORTEST' : 'RECOMMEND',
        });
        if (!r.ok) {
          console.error('kakao car route error', r.status, r.data, r.status === 429 ? '(무료 쿼터 초과 가능성)' : '');
          res.status(502).json({ error: '자동차 경로를 찾지 못했습니다.', detail: r.data }); return;
        }
        const parsed = parseCarRoute(r.data);
        if (!parsed) { res.status(502).json({ error: '자동차 경로 응답을 해석하지 못했습니다.' }); return; }
        res.status(200).json(parsed);
        return;
      }
      case 'walk': {
        const r = await kakaoGet(`${LOCAL_BASE}/v2/routing/walk`, {
          start_x: params?.originX, start_y: params?.originY,
          end_x: params?.destX, end_y: params?.destY,
        });
        if (!r.ok) {
          console.error('kakao walk route error', r.status, r.data, r.status === 429 ? '(무료 쿼터 초과 가능성)' : '');
          res.status(502).json({ error: '도보 경로를 불러오지 못했습니다.', detail: r.data }); return;
        }
        const parsed = parseWalkRoute(r.data);
        if (!parsed) { res.status(502).json({ error: '도보 경로 응답을 해석하지 못했습니다.', detail: r.data }); return; }
        res.status(200).json(parsed);
        return;
      }
      case 'transit': {
        const r = await kakaoGet(`${LOCAL_BASE}/v2/routing/publictraffic`, {
          start_x: params?.originX, start_y: params?.originY,
          end_x: params?.destX, end_y: params?.destY,
        });
        if (!r.ok) {
          console.error('kakao transit route error', r.status, r.data, r.status === 429 ? '(무료 쿼터 초과 가능성)' : '');
          res.status(502).json({ error: '대중교통 경로를 불러오지 못했습니다.', detail: r.data }); return;
        }
        const parsed = parseTransitRoute(r.data, params?.priority);
        if (!parsed) { res.status(502).json({ error: '대중교통 경로 응답을 해석하지 못했습니다.', detail: r.data }); return; }
        res.status(200).json(parsed);
        return;
      }
      case 'bike': {
        const r = await kakaoGet(`${LOCAL_BASE}/v2/routing/bicycle`, {
          start_x: params?.originX, start_y: params?.originY,
          end_x: params?.destX, end_y: params?.destY,
        });
        if (!r.ok) {
          console.error('kakao bike route error', r.status, r.data, r.status === 429 ? '(무료 쿼터 초과 가능성)' : '');
          res.status(502).json({ error: '자전거 경로를 불러오지 못했습니다.', detail: r.data }); return;
        }
        const parsed = parseBikeRoute(r.data);
        if (!parsed) { res.status(502).json({ error: '자전거 경로 응답을 해석하지 못했습니다.', detail: r.data }); return; }
        res.status(200).json(parsed);
        return;
      }
      default:
        res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('kakao handler error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
