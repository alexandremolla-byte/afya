// AFYA AI Chat — Netlify Serverless Function
// Proxies messages to Claude Haiku, keeping the API key server-side.

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // CORS headers so the browser app can call this function
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  try {
    const { messages, profile } = JSON.parse(event.body);

    if (!messages || !Array.isArray(messages)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body" }) };
    }

    // Build a context-aware system prompt from the user's health profile
    const conditionMap = {
      diabetes: "type 2 diabetes",
      hypertension: "hypertension (high blood pressure)",
      maternal: `pregnancy (currently ${profile?.weeks || "unknown"} weeks)`,
      general: "general health maintenance",
    };
    const conditionLabel = conditionMap[profile?.condition] || "general health";

    const systemPrompt = `You are AFYA, a warm and knowledgeable AI health companion built specifically for Nigerians and Africans. You help users manage chronic conditions and navigate everyday health questions.

USER PROFILE:
- Name: ${profile?.name || "the user"}
- Age: ${profile?.age || "unknown"}
- Primary health focus: ${conditionLabel}

YOUR ROLE:
- Provide clear, practical, evidence-based health guidance in simple, everyday English
- Be warm, encouraging, and culturally aware — you understand Nigerian food, healthcare access challenges, and local context
- Give actionable advice, not vague platitudes
- Keep responses concise: 2–4 short paragraphs unless more detail is genuinely needed
- Use occasional relevant emojis to keep the tone friendly (💚 💊 🩺)

CRITICAL RULES:
- ALWAYS recommend consulting a doctor for diagnosis, prescription changes, or anything requiring clinical judgement
- For emergency symptoms (chest pain, stroke signs, severe bleeding, loss of consciousness), tell the user to go to hospital immediately — do not attempt to manage these via chat
- Never claim to diagnose any condition
- Never suggest stopping or changing prescribed medications without medical supervision
- You are a companion and guide, not a replacement for a healthcare professional

If the user writes in Nigerian Pidgin, respond in Pidgin. Otherwise respond in clear, warm English.`;

    // Call Claude Haiku via the Anthropic Messages API directly (no SDK needed)
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map((m) => ({
          role: m.role === "ai" ? "assistant" : "user",
          content: m.text,
        })),
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error("Anthropic API error:", errText);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "AI service temporarily unavailable. Please try again in a moment." }),
      };
    }

    const data = await anthropicResponse.json();
    const replyText = data.content?.[0]?.text || "I'm sorry, I couldn't generate a response. Please try again.";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply: replyText }),
    };
  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Something went wrong. Please try again." }),
    };
  }
};
