export default async function handler(req, res) {
  try {
    const key = process.env.KAKAO_REST_API_KEY;
    if (!key) return res.status(500).json({ error: 'KAKAO_REST_API_KEY is not configured' });

    const { type, query, x, y, origin, destination, priority = 'RECOMMEND' } = req.query || {};
    let url;

    if (type === 'search') {
      url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
      url.searchParams.set('query', query || '');
      url.searchParams.set('size', '5');
    } else if (type === 'address') {
      url = new URL('https://dapi.kakao.com/v2/local/search/address.json');
      url.searchParams.set('query', query || '');
      url.searchParams.set('size', '5');
    } else if (type === 'walk') {
      url = new URL('https://dapi.kakao.com/v2/routing/walk');
      url.searchParams.set('origin', origin || '');
      url.searchParams.set('destination', destination || '');
    } else if (type === 'transit') {
      url = new URL('https://dapi.kakao.com/v2/routing/publictraffic');
      url.searchParams.set('origin', origin || '');
      url.searchParams.set('destination', destination || '');
    } else if (type === 'car') {
      url = new URL('https://apis-navi.kakaomobility.com/v1/directions');
      url.searchParams.set('origin', origin || '');
      url.searchParams.set('destination', destination || '');
      url.searchParams.set('priority', priority);
      url.searchParams.set('summary', 'false');
    } else {
      return res.status(400).json({ error: 'Unknown Kakao API type' });
    }

    const headers = { Authorization: `KakaoAK ${key}` };
    if (type === 'car') headers['Content-Type'] = 'application/json';
    const upstream = await fetch(url, { headers });
    const text = await upstream.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return res.status(upstream.status).json(body);
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Kakao API proxy error' });
  }
}
