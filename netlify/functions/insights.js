// AFYA Weekly AI Digest — Netlify Serverless Function (Step 5)
// Generates a personalised weekly health summary using Claude Sonnet.
// Premium-only endpoint — called from the app when user taps "Refresh".

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
    const { profile, vitals = [], meds = [] } = JSON.parse(event.body);

    if (!profile) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Profile required" }) };
    }

    // ── Condition label ───────────────────────────────────────────────────
    const conditionMap = {
      diabetes:    "type 2 diabetes",
      hypertension:"hypertension (high blood pressure)",
      maternal:    `pregnancy (${profile.weeks || "?"} weeks)`,
      wellness:    "general wellness",
      general:     "general wellness",
    };
    const conditionLabel = conditionMap[profile.condition] || "general health";

    // ── Format vitals for the prompt ──────────────────────────────────────
    const formatVitals = () => {
      if (!vitals || vitals.length === 0) return "No vitals logged this week.";
      const byType = {};
      vitals.forEach(v => {
        if (!byType[v.type]) byType[v.type] = [];
        byType[v.type].push(v);
      });

      const lines = [];

      if (byType.blood_sugar) {
        const readings = byType.blood_sugar.slice(0, 14);
        const avg = Math.round(readings.reduce((s, r) => s + Number(r.value), 0) / readings.length);
        const min = Math.min(...readings.map(r => Number(r.value)));
        const max = Math.max(...readings.map(r => Number(r.value)));
        const fasting = readings.filter(r => r.context === "fasting");
        const postMeal = readings.filter(r => r.context === "after_meal");
        lines.push(`Blood Sugar (${readings.length} readings): avg ${avg} mg/dL, range ${min}–${max} mg/dL`);
        if (fasting.length) lines.push(`  Fasting avg: ${Math.round(fasting.reduce((s,r)=>s+Number(r.value),0)/fasting.length)} mg/dL (target: 80–130)`);
        if (postMeal.length) lines.push(`  Post-meal avg: ${Math.round(postMeal.reduce((s,r)=>s+Number(r.value),0)/postMeal.length)} mg/dL (target: <180)`);
      }

      if (byType.bp) {
        const readings = byType.bp.slice(0, 10);
        const avgSys = Math.round(readings.reduce((s, r) => s + Number(r.value), 0) / readings.length);
        const avgDia = readings[0].value2
          ? Math.round(readings.reduce((s, r) => s + Number(r.value2 || 0), 0) / readings.length)
          : null;
        lines.push(`Blood Pressure (${readings.length} readings): avg ${avgSys}${avgDia ? "/" + avgDia : ""} mmHg (target: <130/80)`);
      }

      if (byType.weight) {
        const readings = byType.weight.slice(0, 5);
        const last = readings[0];
        const first = readings[readings.length - 1];
        const trend = readings.length > 1
          ? Number(last.value) > Number(first.value) ? "↑ gaining" : Number(last.value) < Number(first.value) ? "↓ losing" : "stable"
          : "stable";
        lines.push(`Weight: ${last.value} ${last.unit || "kg"} (${trend})`);
      }

      return lines.length > 0 ? lines.join("\n") : "Vitals data available but no recognised measurements found.";
    };

    // ── Format medication adherence ───────────────────────────────────────
    const formatMeds = () => {
      if (!meds || meds.length === 0) return "No medication data available.";
      const taken = meds.filter(m => m.taken).length;
      const rate = Math.round((taken / meds.length) * 100);
      const pending = meds.filter(m => !m.taken).map(m => m.name);
      let str = `Today's adherence: ${rate}% (${taken}/${meds.length} taken).`;
      if (pending.length > 0) str += ` Not yet taken: ${pending.join(", ")}.`;
      return str;
    };

    // ── System prompt (Claude Sonnet — better synthesis quality) ──────────
    const systemPrompt = `You are AFYA's health analytics engine. Write a warm, personalised weekly health digest.

USER: ${profile.name || "User"}, ${profile.age || "?"} years old, managing ${conditionLabel}.

VITALS DATA (past 1–2 weeks):
${formatVitals()}

MEDICATION DATA:
${formatMeds()}

INSTRUCTIONS:
Write a health digest in exactly 4 short paragraphs (2–3 sentences each):

Paragraph 1 — TREND SUMMARY: Start with "This week, [name]..." Summarise the main health trend using actual numbers from the data. Be specific — mention the actual readings, not generic statements.

Paragraph 2 — WHAT'S GOING WELL: Acknowledge something positive. If numbers are improving, celebrate it. If medication adherence is good, affirm it. Be genuine and specific.

Paragraph 3 — FOCUS AREA: Identify one specific thing to work on this coming week. Be actionable (e.g. "Try to log your blood sugar before breakfast every day" or "Aim to take your evening medication before 9pm"). Tie it to their actual data.

Paragraph 4 — CLOSE: A warm, encouraging closing sentence. Reference something culturally relevant to Nigeria if natural. End with a short, memorable health tip.

TONE: Warm, personal, and encouraging — like a knowledgeable friend who genuinely cares. Not clinical. Not generic.
LENGTH: Under 200 words. No bullet points. No markdown. Plain text only.`;

    // ── Call Claude Sonnet ────────────────────────────────────────────────
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":       "application/json",
        "x-api-key":          process.env.ANTHROPIC_API_KEY,
        "anthropic-version":  "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-6",
        max_tokens: 512,
        system:     systemPrompt,
        messages:   [{ role: "user", content: "Generate my weekly health digest." }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error("Anthropic API error:", errText);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Could not generate digest. Please try again." }) };
    }

    const data = await anthropicResponse.json();
    const insight = data.content?.[0]?.text || "";

    return { statusCode: 200, headers, body: JSON.stringify({ insight }) };

  } catch (err) {
    console.error("Insights function error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Something went wrong generating your digest." }) };
  }
};
