// get-analytics.js — AFYA Admin Analytics
// Protected by ADMIN_SECRET env var. Returns aggregated KPIs.

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_SECRET    = process.env.ADMIN_SECRET || "afya-admin-2024";

exports.handler = async (event) => {
  // Auth check
  const auth = event.headers["x-admin-secret"] || event.queryStringParameters?.secret;
  if (auth !== ADMIN_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE);

  try {
    // ── 1. User metrics from profiles ──────────────────────────────────────
    const { data: profiles, error: pErr } = await sb
      .from("profiles")
      .select("id, created_at, is_premium, premium_expires_at, condition, friends_referred, free_months_earned");

    if (pErr) throw pErr;

    const totalUsers      = profiles.length;
    const premiumUsers    = profiles.filter(p => p.is_premium).length;
    const conversionRate  = totalUsers > 0 ? ((premiumUsers / totalUsers) * 100).toFixed(1) : "0.0";
    const totalReferrals  = profiles.reduce((s, p) => s + (p.friends_referred || 0), 0);
    const freeMonths      = profiles.reduce((s, p) => s + (p.free_months_earned || 0), 0);

    // Condition breakdown
    const conditionCounts = profiles.reduce((acc, p) => {
      const c = p.condition || "unknown";
      acc[c] = (acc[c] || 0) + 1;
      return acc;
    }, {});

    // Signups by day (last 14 days)
    const now     = new Date();
    const day14   = new Date(now); day14.setDate(day14.getDate() - 13);
    const signupsByDay = {};
    for (let d = 0; d < 14; d++) {
      const dd = new Date(day14); dd.setDate(dd.getDate() + d);
      signupsByDay[dd.toISOString().slice(0,10)] = 0;
    }
    profiles.forEach(p => {
      const day = (p.created_at || "").slice(0,10);
      if (day in signupsByDay) signupsByDay[day]++;
    });

    // ── 2. Event metrics from analytics_events ──────────────────────────────
    const { data: events, error: eErr } = await sb
      .from("analytics_events")
      .select("event_name, properties, created_at, user_id")
      .gte("created_at", day14.toISOString());

    const eventCounts = {};
    const eventsByDay = {};
    (events || []).forEach(ev => {
      eventCounts[ev.event_name] = (eventCounts[ev.event_name] || 0) + 1;
      const day = ev.created_at.slice(0,10);
      if (!eventsByDay[day]) eventsByDay[day] = {};
      eventsByDay[day][ev.event_name] = (eventsByDay[day][ev.event_name] || 0) + 1;
    });

    // DAU: unique users per day (app_open events)
    const dauByDay = {};
    (events || [])
      .filter(ev => ev.event_name === "app_open" && ev.user_id)
      .forEach(ev => {
        const day = ev.created_at.slice(0,10);
        if (!dauByDay[day]) dauByDay[day] = new Set();
        dauByDay[day].add(ev.user_id);
      });
    const dauSeries = Object.entries(dauByDay)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([date, set]) => ({ date, dau: set.size }));

    // Paystack funnel
    const initiated = eventCounts["payment_initiated"] || 0;
    const completed  = eventCounts["payment_complete"]  || 0;
    const paystackConversion = initiated > 0 ? ((completed / initiated) * 100).toFixed(1) : "0.0";

    // ── 3. Vitals logged ──────────────────────────────────────────────────
    const { count: vitalsCount } = await sb
      .from("health_logs")
      .select("id", { count: "exact", head: true });

    // ── 4. Recent signups ─────────────────────────────────────────────────
    const recentSignups = profiles
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 10)
      .map(p => ({ created_at: p.created_at, condition: p.condition, is_premium: p.is_premium }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        overview: {
          totalUsers, premiumUsers, conversionRate,
          totalReferrals, freeMonths, vitalsLogged: vitalsCount || 0,
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
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
