// AFYA AI Chat - Netlify Serverless Function
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
  try {
    const { messages, profile } = JSON.parse(event.body);
    if (!messages || !Array.isArray(messages)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
    const conditionMap = { diabetes: 'type 2 diabetes', hypertension: 'hypertension (high blood pressure)', maternal: 'pregnancy (' + (profile?.weeks || 'unknown') + ' weeks)', general: 'general health maintenance' };
    const conditionLabel = conditionMap[profile?.condition] || 'general health';
    const systemPrompt = 'You are AFYA, a warm and knowledgeable AI health companion built for Nigerians and Africans.\n\nUSER PROFILE:\n- Name: ' + (profile?.name || 'the user') + '\n- Age: ' + (profile?.age || 'unknown') + '\n- Primary health focus: ' + conditionLabel + '\n\nYOUR ROLE:\n- Provide clear, practical, evidence-based health guidance in simple English\n- Be warm, encouraging, and culturally aware of Nigerian context\n- Keep responses concise: 2-4 short paragraphs\n- Use occasional emojis to keep tone friendly\n\nCRITICAL RULES:\n- ALWAYS recommend consulting a doctor for diagnosis or prescription changes\n- For emergency symptoms (chest pain, stroke signs), tell user to go to hospital immediately\n- Never claim to diagnose any condition\n- Never suggest stopping prescribed medications without medical supervision\n- If user writes in Nigerian Pidgin, respond in Pidgin. Otherwise use clear warm English.';
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: systemPrompt, messages: messages.map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text })) }) });
    if (!anthropicResponse.ok) return { statusCode: 502, headers, body: JSON.stringify({ error: 'AI service temporarily unavailable.' }) };
    const data = await anthropicResponse.json();
    const replyText = data.content?.[0]?.text || 'I could not generate a response. Please try again.';
    return { statusCode: 200, headers, body: JSON.stringify({ reply: replyText }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Something went wrong.' }) };
  }
};
