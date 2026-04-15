// get-analytics.js — AFYA Admin Analytics
// Protected by ADMIN_SECRET env var. Uses plain fetch (no npm deps).

exports.handler = async (event) => {
  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
  const ADMIN_SECRET  = process.env.ADMIN_SECRET || "afya-admin-2024";

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-secret",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // ── Auth check ─────────────────────────────────────────────────────────
  const auth = (event.headers && event.headers["x-admin-secret"])
    || (event.queryStringParameters && event.queryStringParameters.secret);
  if (auth !== ADMIN_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  try {
    // ── 1. Profiles ───────────────────────────────────────────────────────
    const profRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=id,created_at,is_premium,premium_expires_at,condition,friends_referred,free_months_earned`,
      { headers: sbHeaders }
    );
    const profiles = await profRes.json();

    const totalUsers     = profiles.length;
    const premiumUsers   = profiles.filter(p => p.is_premium).length;
    const conversionRate = totalUsers > 0 ? ((premiumUsers / totalUsers) * 100).toFixed(1) : "0.0";
    const totalReferrals = profiles.reduce((s, p) => s + (p.friends_referred || 0), 0);
    const freeMonths     = profiles.reduce((s, p) => s + (p.free_months_earned || 0), 0);

    const conditionCounts = profiles.reduce((acc, p) => {
      const c = p.condition || "unknown";
      acc[c] = (acc[c] || 0) + 1;
      return acc;
    }, {});

    // Signups by day — last 14 days
    const now   = new Date();
    const day14 = new Date(now); day14.setDate(day14.getDate() - 13);
    const signupsByDay = {};
    for (let d = 0; d < 14; d++) {
      const dd = new Date(day14); dd.setDate(dd.getDate() + d);
      signupsByDay[dd.toISOString().slice(0, 10)] = 0;
    }
    profiles.forEach(p => {
      const day = (p.created_at || "").slice(0, 10);
      if (day in signupsByDay) signupsByDay[day]++;
    });

    // Recent signups
    const recentSignups = profiles
      .filter(p => p.created_at)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 10)
      .map(p => ({ created_at: p.created_at, condition: p.condition, is_premium: p.is_premium }));

    // ── 2. Analytics events (last 14 days) ───────────────────────────────
    const evRes = await fetch(
      `${SUPABASE_URL}/rest/v1/analytics_events?select=event_name,properties,created_at,user_id&created_at=gte.${day14.toISOString()}&order=created_at.desc&limit=5000`,
      { headers: sbHeaders }
    );
    const events = await evRes.json();

    const eventCounts = {};
    const dauByDay    = {};
    (Array.isArray(events) ? events : []).forEach(ev => {
      eventCounts[ev.event_name] = (eventCounts[ev.event_name] || 0) + 1;
      if (ev.event_name === "app_open" && ev.user_id) {
        const day = ev.created_at.slice(0, 10);
        if (!dauByDay[day]) dauByDay[day] = new Set();
        dauByDay[day].add(ev.user_id);
      }
    });

    const dauSeries = Object.entries(dauByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, set]) => ({ date, dau: set.size }));

    // ── 3. Paystack funnel ────────────────────────────────────────────────
    const initiated          = eventCounts["payment_initiated"] || 0;
    const completed          = eventCounts["payment_complete"]  || 0;
    const paystackConversion = initiated > 0 ? ((completed / initiated) * 100).toFixed(1) : "0.0";

    // ── 4. Vitals count ───────────────────────────────────────────────────
    const vitRes = await fetch(
      `${SUPABASE_URL}/rest/v1/health_logs?select=id`,
      { headers: { ...sbHeaders, Prefer: "count=exact", "Range-Unit": "items", Range: "0-0" } }
    );
    const vitalsCount = parseInt(vitRes.headers.get("content-range")?.split("/")[1] || "0", 10);

    // ── 5. Email leads ────────────────────────────────────────────────────
    const leadsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/email_leads?select=id,created_at&unsubscribed=eq.false`,
      { headers: { ...sbHeaders, Prefer: "count=exact", "Range-Unit": "items", Range: "0-0" } }
    );
    const emailLeads = parseInt(leadsRes.headers.get("content-range")?.split("/")[1] || "0", 10);

    // ── 6. Medications count (active) ─────────────────────────────────────
    const medsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/medications?select=id&active=eq.true`,
      { headers: { ...sbHeaders, Prefer: "count=exact", "Range-Unit": "items", Range: "0-0" } }
    );
    const activeMeds = parseInt(medsRes.headers.get("content-range")?.split("/")[1] || "0", 10);

    // ── 7. Onboarding funnel ──────────────────────────────────────────────
    const onboardings  = eventCounts["onboarding_complete"] || 0;
    const onboardRate  = totalUsers > 0 ? ((onboardings / totalUsers) * 100).toFixed(1) : "0.0";

    // ── 8. Sharing metrics ────────────────────────────────────────────────
    const reportShares = eventCounts["report_shared"] || 0;
    const streakShares = eventCounts["streak_shared"]  || 0;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        overview: {
          totalUsers, premiumUsers, conversionRate,
          totalReferrals, freeMonths, vitalsLogged: vitalsCount,
          emailLeads, activeMeds, reportShares, streakShares,
          onboardings, onboardRate,
        },
        conditionBreakdown: conditionCounts,
        signupsByDay,
        eventCounts,
        dauSeries,
        paystackFunnel: { initiated, completed, paystackConversion },
        recentSignups,
        generatedAt: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error("Analytics error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
