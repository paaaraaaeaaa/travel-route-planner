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
  };
}

// Kakao 대중교통: route.properties.{totalDistance(m), totalTime(s), transferCount?}, path.points per step.
// transitSteps는 각 step의 실제 API 필드만 사용해서 만든다 — 응답에 없는 값은 null로 두고 지어내지 않는다.
function parseTransitRoute(data) {
  const route = data?.routes?.[0] || data?.route || data;
  const props = route?.properties;
  if (!props) return null;
  const pathPoints = [];
  const transitSteps = [];
  // 실제 Kakao publictraffic 응답은 steps가 route 바로 아래(legs 없이)에 있는 경우가 많다.
  // route.steps가 있으면 그것을 쓰고, 없을 때만 legs/sections 등 다른 컨테이너를 시도한다.
  let stepLists;
  if (Array.isArray(route.steps) && route.steps.length > 0) {
    stepLists = [route.steps];
  } else {
    const legs = route.legs || route.sections || route.paths || route.legList || [];
    stepLists = legs.map(leg => leg.steps || leg.roads || leg.details || leg.stepList || []);
  }
  stepLists.forEach((stepList, li) => stepList.forEach((step, si) => {
    if (li === 0 && si === 0) console.log('[route] transit first raw step keys:', JSON.stringify(step));
    (step.path?.points || step.points || step.vertexes || step.linePassStopList?.map?.(p => [p.x, p.y]) || []).forEach(pt => {
      if (Array.isArray(pt)) pathPoints.push({ x: pt[0], y: pt[1] });
    });
    const rawType = step.trafficType ?? step.type ?? step.mode ?? step.stepType ?? step.transportType ?? (step.lane ? 'BUS' : (step.name || step.roadName ? 'WALKING' : null));
    const type = /walk|foot/i.test(String(rawType)) ? 'WALKING' : (/subway|rail|metro|train/i.test(String(rawType)) ? 'SUBWAY' : (/bus/i.test(String(rawType)) ? 'BUS' : (rawType ? String(rawType).toUpperCase() : 'WALKING')));
    const minutes = step.sectionTime != null ? Math.round(step.sectionTime / 60)
      : step.time != null ? Math.round(step.time / 60)
      : step.duration != null ? Math.round(step.duration / 60)
      : step.stayTime != null ? Math.round(step.stayTime / 60)
      : null;
    const distanceKm = step.distance != null ? step.distance / 1000
      : step.sectionDistance != null ? step.sectionDistance / 1000
      : step.length != null ? step.length / 1000
      : null;
    const lane = step.lane || (Array.isArray(step.lanes) ? step.lanes[0] : null);
    transitSteps.push({
      type,
      minutes,
      distanceKm,
      fromName: step.start?.name ?? step.startName ?? step.startStop?.name ?? step.start_name ?? null,
      toName: step.end?.name ?? step.endName ?? step.endStop?.name ?? step.end_name ?? null,
      vehicleName: lane?.name ?? lane?.busNo ?? lane?.busNumber ?? step.routeName ?? step.name ?? step.lineName ?? null,
      stopCount: step.passStopList?.length ?? step.stationCount ?? step.passStopCnt ?? step.passStopCount ?? null,
    });
  }));
  console.log('[route] transit parse', { stepListCount: stepLists.length, transitStepsLength: transitSteps.length, types: transitSteps.map(s => s.type) });
  if (transitSteps.length === 0) {
    console.error('kakao transit parse: no steps found in response, route keys:', Object.keys(route || {}));
  }
  return {
    distanceKm: props.totalDistance / 1000,
    minutes: Math.round(props.totalTime / 60),
    transfers: props.transferCount ?? props.transferCnt ?? null,
    pathPoints,
    transitSteps,
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
        const parsed = parseTransitRoute(r.data);
        if (!parsed) { res.status(502).json({ error: '대중교통 경로 응답을 해석하지 못했습니다.', detail: r.data }); return; }
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
