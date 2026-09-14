export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = process.env.KAKAO_JS_KEY;
  if (!key) return res.status(500).json({ error: 'KAKAO_JS_KEY is not configured' });
  return res.status(200).json({ javascriptKey: key });
}
