// Vercel Serverless Function: POST /api/chat
// Proxies chat requests to the Gemini API without exposing the API key to the client.
// Requires the GEMINI_API_KEY environment variable to be set in Vercel Project Settings.

const GEMINI_MODEL = 'gemini-3.8-flash'; // Current stable GA Flash model
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing GEMINI_API_KEY' });
    return;
  }

  try {
    const { message, history, context } = req.body || {};
    const userMessage = String(message || '').slice(0, 500);
    if (!userMessage) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const contextText = context
      ? `현재 사용자가 계획 중인 여행 경로 정보:\n${JSON.stringify(context, null, 2)}`
      : '';

    const systemPreamble =
      '너는 여행 경로 플래너 서비스 p:nder의 AI 도우미야. 사용자가 만든 현재 경로(방문지, 이동수단, 이동 기준, 여행 날짜)를 ' +
      '참고해서 경로 설명, 개선 아이디어, 방문 순서 조언, 예상 시간/거리 설명, 주변 장소 추천, 사용법 안내를 해줘. ' +
      '사용자의 경로 설정을 네가 대신 바꾸지는 않아. 답변은 한국어로, 간결하고 친근하게 작성해.';

    const historyParts = Array.isArray(history)
      ? history.map((h) => ({
          role: h.role === 'ai' ? 'model' : 'user',
          parts: [{ text: String(h.text || '').slice(0, 1000) }],
        }))
      : [];

    const contents = [
      { role: 'user', parts: [{ text: systemPreamble + (contextText ? '\n\n' + contextText : '') }] },
      { role: 'model', parts: [{ text: '알겠어요, 현재 경로를 참고해서 도와드릴게요.' }] },
      ...historyParts,
      { role: 'user', parts: [{ text: userMessage }] },
    ];

    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 400 },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', geminiRes.status, errText);
      res.status(502).json({ error: 'Gemini API request failed' });
      return;
    }

    const data = await geminiRes.json();
    const reply =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ||
      '지금은 답변을 만들지 못했어요. 다시 시도해주세요.';

    res.status(200).json({ reply });
  } catch (err) {
    console.error('chat handler error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
