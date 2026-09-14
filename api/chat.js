// Vercel Serverless Function: POST /api/chat
// Proxies chat requests to Gemini without exposing the API key to the client.
// Requires GEMINI_API_KEY in Vercel Project Settings.

const GEMINI_MODEL = 'gemini-3.8-flash';
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
    const userMessage = String(message || '').trim().slice(0, 500);

    if (!userMessage) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const contextText = context
      ? `\n\n현재 사용자가 계획 중인 여행 경로 정보:\n${JSON.stringify(context, null, 2)}`
      : '';

    const systemPreamble =
      '너는 여행 경로 플래너 서비스 p:nder의 AI 도우미야. ' +
      '사용자가 만든 현재 경로(방문지, 이동수단, 이동 기준, 여행 날짜)를 참고해서 ' +
      '경로 설명, 개선 아이디어, 방문 순서 조언, 예상 시간/거리 설명, 주변 장소 추천, 사용법 안내를 해줘. ' +
      '사용자의 경로 설정을 네가 직접 바꾸지는 않아. ' +
      '확인되지 않은 실제 영업시간, 거리, 소요시간 등은 사실처럼 단정하지 말고 필요하면 확인이 필요하다고 알려줘. ' +
      '답변은 한국어로, 간결하고 친근하게 작성해. ' +
      '사용자가 현재 경로에 대해 질문하면 제공된 경로 정보를 우선해서 답변해.';

    const historyParts = Array.isArray(history)
      ? history
          .filter(h => h && (h.role === 'user' || h.role === 'ai' || h.role === 'model'))
          .slice(-12)
          .map(h => ({
            role: h.role === 'ai' || h.role === 'model' ? 'model' : 'user',
            parts: [{ text: String(h.text || '').slice(0, 1000) }],
          }))
          .filter(h => h.parts[0].text.trim())
      : [];

    // Gemini 3.8 Flash에서는 미리 채운 model 응답을 사용하지 않고,
    // 안내문을 첫 user turn에 포함해 대화 컨텍스트를 구성합니다.
    const contents = [
      {
        role: 'user',
        parts: [{ text: systemPreamble + contextText }],
      },
      ...historyParts,
      {
        role: 'user',
        parts: [{ text: userMessage }],
      },
    ];

    const geminiRes = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          maxOutputTokens: 500,
          thinkingConfig: { thinkingLevel: 'low' },
        },
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
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part?.text || '')
        .join('')
        .trim() ||
      '지금은 답변을 만들지 못했어요. 다시 시도해주세요.';

    res.status(200).json({ reply });
  } catch (err) {
    console.error('chat handler error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
