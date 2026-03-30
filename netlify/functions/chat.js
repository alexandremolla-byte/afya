// AFYA AI Chat — Netlify Serverless Function (Step 5: AI Health Engine)
// Proxies messages to Claude Haiku with rich health context.

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  try {
    const { messages, profile, vitals = [], meds = [] } = JSON.parse(event.body);

    if (!messages || !Array.isArray(messages)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body" }) };
    }

    // ── Condition label ───────────────────────────────────────────────────
    const conditionMap = {
      diabetes:    "type 2 diabetes",
      hypertension:"hypertension (high blood pressure)",
      maternal:    `pregnancy (currently ${profile?.weeks || "unknown"} weeks)`,
      wellness:    "general health and wellness",
      general:     "general health and wellness",
    };
    const conditionLabel = conditionMap[profile?.condition] || "general health";

    // ── Build vitals summary ──────────────────────────────────────────────
    let vitalsSummary = "No vitals logged yet.";
    if (vitals && vitals.length > 0) {
      const lines = [];
      const byType = {};
      vitals.forEach(v => {
        if (!byType[v.type]) byType[v.type] = [];
        byType[v.type].push(v);
      });

      // Blood sugar (diabetes)
      if (byType.blood_sugar && byType.blood_sugar.length > 0) {
        const readings = byType.blood_sugar.slice(0, 7);
        const avg = Math.round(readings.reduce((s, r) => s + Number(r.value), 0) / readings.length);
        const last = readings[0];
        const lastDate = new Date(last.logged_at).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" });
        lines.push(`Blood Sugar: Last reading ${last.value} mg/dL (${last.context || "unspecified"}) on ${lastDate}. ${readings.length}-reading average: ${avg} mg/dL.${avg > 180 ? " TREND: Above target — needs attention." : avg < 70 ? " TREND: Low — hypoglycaemia risk." : " TREND: Within acceptable range."}`);
      }

      // Blood pressure (hypertension)
      if (byType.bp && byType.bp.length > 0) {
        const readings = byType.bp.slice(0, 5);
        const last = readings[0];
        const avgSys = Math.round(readings.reduce((s, r) => s + Number(r.value), 0) / readings.length);
        const avgDia = readings[0].value2
          ? Math.round(readings.reduce((s, r) => s + Number(r.value2 || 0), 0) / readings.length)
          : null;
        const lastDate = new Date(last.logged_at).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" });
        const bpStr = avgDia ? `${avgSys}/${avgDia}` : `${avgSys} systolic`;
        lines.push(`Blood Pressure: Last reading ${last.value}${last.value2 ? "/" + last.value2 : ""} mmHg on ${lastDate}. Recent average: ${bpStr} mmHg.${avgSys >= 140 ? " TREND: Elevated — discuss with doctor." : " TREND: Within target range."}`);
      }

      // Weight (maternal / general)
      if (byType.weight && byType.weight.length > 0) {
        const last = byType.weight[0];
        const lastDate = new Date(last.logged_at).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short" });
        lines.push(`Weight: Last recorded ${last.value} ${last.unit || "kg"} on ${lastDate}.`);
      }

      if (lines.length > 0) vitalsSummary = lines.join("\n");
    }

    // ── Medication adherence ──────────────────────────────────────────────
    let medsContext = "Medication data unavailable.";
    if (meds && meds.length > 0) {
      const taken = meds.filter(m => m.taken);
      const pending = meds.filter(m => !m.taken);
      const rate = Math.round((taken.length / meds.length) * 100);
      medsContext = `Medication Adherence Today: ${rate}% (${taken.length}/${meds.length} taken).`;
      if (pending.length > 0) {
        medsContext += ` Pending: ${pending.map(m => m.name).join(", ")}.`;
      }
    }

    // ── System prompt ─────────────────────────────────────────────────────
    const systemPrompt = `You are AFYA, a warm and knowledgeable AI health companion built specifically for Nigerians and Africans. You help users manage chronic conditions and navigate everyday health questions.

USER PROFILE:
- Name: ${profile?.name || "the user"}
- Age: ${profile?.age || "unknown"}
- Primary health focus: ${conditionLabel}

REAL-TIME HEALTH DATA:
${vitalsSummary}
${medsContext}

CONDITION-SPECIFIC TARGETS:
${profile?.condition === "diabetes" ? "- Fasting blood sugar target: 80–130 mg/dL\n- Post-meal target: <180 mg/dL\n- HbA1c goal: <7%" : ""}
${profile?.condition === "hypertension" ? "- Blood pressure target: <130/80 mmHg\n- Home monitoring: log BP twice daily (morning and evening)" : ""}
${profile?.condition === "maternal" ? `- Currently ${profile?.weeks || "unknown"} weeks pregnant\n- Weekly weight check recommended\n- Watch for: swelling, headaches, reduced fetal movement` : ""}

YOUR ROLE:
- Provide clear, practical, evidence-based health guidance in simple, everyday English
- Be warm, encouraging, and culturally aware — you understand Nigerian food, healthcare access challenges, and local context
- ACTIVELY USE the real-time health data above — reference the user's actual numbers when relevant (e.g. "I can see your blood sugar was 280 mg/dL this morning — that's above target…")
- Give actionable advice, not vague platitudes
- Keep responses concise: 2–4 short paragraphs unless more detail is genuinely needed
- Use occasional relevant emojis to keep the tone friendly (💚 💊 🩺 🩸)

CRITICAL RULES:
- ALWAYS recommend consulting a doctor for diagnosis, prescription changes, or anything requiring clinical judgement
- For emergency symptoms (chest pain, stroke signs, severe bleeding, loss of consciousness), tell the user to go to hospital immediately
- Never claim to diagnose any condition
- Never suggest stopping or changing prescribed medications without medical supervision
- You are a companion and guide, not a replacement for a healthcare professional

If the user writes in Nigerian Pidgin, respond in Pidgin. Otherwise respond in clear, warm English.`;

    // ── Call Claude Haiku ─────────────────────────────────────────────────
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":       "application/json",
        "x-api-key":          process.env.ANTHROPIC_API_KEY,
        "anthropic-version":  "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system:     systemPrompt,
        messages:   messages.map((m) => ({
          role:    m.role === "ai" ? "assistant" : "user",
          content: m.text,
        })),
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error("Anthropic API error:", errText);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "AI service temporarily unavailable. Please try again in a moment." }) };
    }

    const data = await anthropicResponse.json();
    const replyText = data.content?.[0]?.text || "I'm sorry, I couldn't generate a response. Please try again.";

    return { statusCode: 200, headers, body: JSON.stringify({ reply: replyText }) };

  } catch (err) {
    console.error("Function error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Something went wrong. Please try again." }) };
  }
};
