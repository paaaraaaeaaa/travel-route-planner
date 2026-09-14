// Vercel Serverless Function: POST /api/chat
// Gemini API key stays on the server in Vercel environment variables.

const GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is missing');
    return res.status(500).json({ error: 'Vercel에 GEMINI_API_KEY가 설정되어 있지 않습니다.' });
  }

  try {
    const body = req.body || {};
    const message = String(body.message || '').trim().slice(0, 1000);
    const history = Array.isArray(body.history) ? body.history : [];
    const context = body.context || {};

    if (!message) {
      return res.status(400).json({ error: '메시지가 비어 있습니다.' });
    }

    const systemInstruction = `
너는 여행 경로 플래너 서비스 p:nder의 AI 도우미야.
사용자가 만든 현재 여행 경로 정보를 참고해서 여행 경로, 방문 순서, 이동수단, 일정에 대해 답변해.
사용자의 경로를 직접 수정하지는 마.
확인되지 않은 실제 영업시간, 거리, 소요시간은 사실처럼 단정하지 마.
답변은 한국어로 간결하고 이해하기 쉽게 작성해.

현재 여행 경로 정보:
${JSON.stringify(context, null, 2)}
`.trim();

    // Gemini의 multi-turn 형식에 맞춰 과거 대화를 전달한다.
    const historyParts = history
      .filter(item => item && (item.role === 'user' || item.role === 'ai' || item.role === 'model'))
      .slice(-10)
      .map(item => ({
        role: item.role === 'ai' || item.role === 'model' ? 'model' : 'user',
        parts: [{ text: String(item.text || '').trim().slice(0, 1500) }],
      }))
      .filter(item => item.parts[0].text);

    // 항상 마지막은 실제 사용자의 user 메시지여야 한다.
    const contents = [
      ...historyParts,
      { role: 'user', parts: [{ text: message }] },
    ];

    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents,
        generationConfig: {
          maxOutputTokens: 500,
          thinkingConfig: {
            thinkingLevel: 'low',
          },
        },
      }),
    });

    const raw = await geminiRes.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      data = null;
    }

    if (!geminiRes.ok) {
      const googleMessage = data?.error?.message || raw || '알 수 없는 Gemini 오류';
      console.error('Gemini API error:', geminiRes.status, googleMessage);
      return res.status(502).json({
        error: `Gemini API 오류 (${geminiRes.status}): ${googleMessage}`,
      });
    }

    const reply = data?.candidates?.[0]?.content?.parts
      ?.filter(part => typeof part?.text === 'string')
      ?.map(part => part.text)
      ?.join('')
      ?.trim();

    if (!reply) {
      const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || '알 수 없는 이유';
      console.error('Gemini returned no text:', JSON.stringify(data));
      return res.status(502).json({ error: `Gemini가 텍스트 답변을 반환하지 않았습니다. (${reason})` });
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('chat handler error:', err);
    return res.status(500).json({
      error: `서버 오류: ${err?.message || '알 수 없는 오류'}`,
    });
  }
}
