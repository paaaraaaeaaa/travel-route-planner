// Vercel Serverless Function: POST /api/chat
// Gemini 3.8 Flash (GA) proxy. The API key stays server-side in Vercel.

const GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server is missing GEMINI_API_KEY' });

  try {
    const { message, history, context } = req.body || {};
    const userMessage = String(message || '').trim().slice(0, 1000);
    if (!userMessage) return res.status(400).json({ error: 'message is required' });

    const systemInstruction = {
      parts: [{ text:
        '너는 여행 경로 플래너 서비스 p:nder의 AI 도우미야. ' +
        '사용자가 입력한 현재 여행 경로와 이동수단 정보를 바탕으로 질문에 답해. ' +
        '경로의 거리·시간·장소 정보가 실제 API 데이터로 제공되지 않은 경우 숫자를 지어내지 말고, 현재 제공된 정보만으로 판단해. ' +
        '경로 순서가 더 좋은지 물으면 가능한 개선 방향을 설명하고, 주변 추천을 요청하면 여행 동선과 목적을 고려한 추천 기준을 제시해. ' +
        '사용자의 경로를 직접 변경했다고 말하지 말고, 답변은 한국어로 간결하고 자연스럽게 작성해.'
      }]
    };

    const contextText = context
      ? `현재 경로 데이터:\n${JSON.stringify(context, null, 2)}`
      : '현재 경로 데이터가 없습니다.';

    const sourceHistory = Array.isArray(history) ? history : [];
    const historyParts = sourceHistory
      .map(h => ({
        role: h?.role === 'ai' || h?.role === 'model' ? 'model' : 'user',
        parts: [{ text: String(h?.text || '').slice(0, 1500) }],
      }))
      .filter(h => h.parts[0].text.trim());

    // The current user message is sent separately, so do not duplicate a final identical user turn.
    const trimmedHistory = historyParts.slice(-10);
    if (trimmedHistory.length && trimmedHistory[trimmedHistory.length - 1].role === 'user' &&
        trimmedHistory[trimmedHistory.length - 1].parts[0].text === userMessage) {
      trimmedHistory.pop();
    }

    const contents = [
      ...trimmedHistory,
      { role: 'user', parts: [{ text: `${contextText}\n\n사용자 질문: ${userMessage}` }] },
    ];

    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction,
        contents,
        generationConfig: {
          maxOutputTokens: 500,
          thinkingConfig: { thinkingLevel: 'low' },
        },
      }),
    });

    const raw = await geminiRes.text();
    let data = {};
    try { data = JSON.parse(raw); } catch (_) {}

    if (!geminiRes.ok) {
      const detail = data?.error?.message || raw || 'Unknown Gemini API error';
      console.error('Gemini API error:', geminiRes.status, detail);
      return res.status(502).json({ error: `Gemini API 오류 (${geminiRes.status}): ${detail}` });
    }

    const reply = data?.candidates?.[0]?.content?.parts
      ?.map(p => p?.text || '')
      .join('')
      .trim();

    if (!reply) return res.status(502).json({ error: 'Gemini가 빈 답변을 반환했습니다.' });
    return res.status(200).json({ reply });
  } catch (err) {
    console.error('chat handler error:', err);
    return res.status(500).json({ error: err?.message || 'Internal server error' });
  }
}
