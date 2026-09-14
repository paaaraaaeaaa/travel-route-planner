// GET /api/kakao-config — returns ONLY the JS SDK key (never REST/Gemini keys).
export default function handler(req, res) {
  const key = process.env.KAKAO_JS_KEY;
  if (!key) {
    res.status(500).json({ error: 'Server is missing KAKAO_JS_KEY' });
    return;
  }
  res.status(200).json({ javascriptKey: key });
}
