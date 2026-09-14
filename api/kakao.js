// POST /api/kakao — single proxy for Kakao REST endpoints. Body: { action, params }
// Requires KAKAO_REST_API_KEY. Never exposes the key to the client.
//
// IMPORTANT permission note (confirmed via Kakao Developers docs/devtalk):
// - /v2/local/search/address.json, /v2/local/search/keyword.json → available to any REST key.
// - /v1/directions (apis-navi.kakaomobility.com, car) → available to any REST key.
// - /v2/routing/walk, /v2/routing/publictraffic, /v2/routing/bicycle (dapi.kakao.com) use
//   start_x/start_y/end_x/end_y params. Kakao devtalk reports these can return a permission-
//   looking error ("API limit has been exceeded", code -10) on apps that don't have the
//   routing product explicitly enabled in Kakao Developers Console, independent of actual
//   quota usage. If you hit that, enable the "길찾기(Routing)" product for this app there.

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
        if (!r.ok) { console.error('kakao car route error', r.status, r.data); res.status(502).json({ error: '자동차 경로를 찾지 못했습니다.', detail: r.data }); return; }
        res.status(200).json(r.data);
        return;
      }
      case 'walk': {
        const r = await kakaoGet(`${LOCAL_BASE}/v2/routing/walk`, {
          start_x: params?.originX, start_y: params?.originY,
          end_x: params?.destX, end_y: params?.destY,
        });
        if (!r.ok) {
          console.error('kakao walk route error', r.status, r.data);
          res.status(502).json({ error: '도보 경로를 찾지 못했습니다. (앱에 길찾기 권한이 활성화되어 있는지 Kakao Developers 콘솔을 확인해주세요)', detail: r.data });
          return;
        }
        res.status(200).json(r.data);
        return;
      }
      case 'transit': {
        const r = await kakaoGet(`${LOCAL_BASE}/v2/routing/publictraffic`, {
          start_x: params?.originX, start_y: params?.originY,
          end_x: params?.destX, end_y: params?.destY,
        });
        if (!r.ok) {
          console.error('kakao transit route error', r.status, r.data);
          res.status(502).json({ error: '대중교통 경로를 찾지 못했습니다. (앱에 길찾기 권한이 활성화되어 있는지 Kakao Developers 콘솔을 확인해주세요)', detail: r.data });
          return;
        }
        res.status(200).json(r.data);
        return;
      }
      case 'bike': {
        const r = await kakaoGet(`${LOCAL_BASE}/v2/routing/bicycle`, {
          start_x: params?.originX, start_y: params?.originY,
          end_x: params?.destX, end_y: params?.destY,
        });
        if (!r.ok) {
          console.error('kakao bike route error', r.status, r.data);
          res.status(502).json({ error: '자전거 경로를 찾지 못했습니다. (앱에 길찾기 권한이 활성화되어 있는지 Kakao Developers 콘솔을 확인해주세요)', detail: r.data });
          return;
        }
        res.status(200).json(r.data);
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
