const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type":                 "application/json",
};

const sbFetch = (path) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE, Authorization: `Bearer ${SUPABASE_SERVICE}` },
  }).then(r => r.json());

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  const token = event.queryStringParameters?.t || "";

  // Basic UUID validation
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid token" }) };
  }

  // 1. Fetch profile by report_token
  const profiles = await sbFetch(
    `profiles?report_token=eq.${token}&select=id,name,condition,age,weeks,created_at&limit=1`
  );
  if (!profiles?.length) {
    return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Report not found" }) };
  }
  const profile = profiles[0];
  const uid = profile.id;

  // 2. Fetch active medications
  const medications = await sbFetch(
    `medications?user_id=eq.${uid}&active=eq.true&select=id,name,time&order=time.asc`
  ) || [];

  // 3. Fetch last 30 days of logs
  const thirtyDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const logs = await sbFetch(
    `med_logs?user_id=eq.${uid}&logged_date=gte.${thirtyDaysAgo}&select=medication_id,taken,logged_date&order=logged_date.desc`
  ) || [];

  // 4. Compute streak (consecutive days ending today with ≥1 taken)
  let streak = 0;
  for (let i = 0; i < 30; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    if (logs.some(l => l.logged_date === d && l.taken)) streak++;
    else break;
  }

  // 5. 30-day adherence = % of last 30 days where ≥1 med was taken
  let activeDays = 0;
  for (let i = 0; i < 30; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    if (logs.some(l => l.logged_date === d && l.taken)) activeDays++;
  }
  const adherence30 = Math.round((activeDays / 30) * 100);

  // 6. Today's status
  const today = new Date().toISOString().slice(0, 10);
  const todayTaken = logs.filter(l => l.logged_date === today && l.taken).length;

  // 7. Build 30-day chart data (one entry per day)
  const chartDays = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10);
    return { date: d, taken: logs.some(l => l.logged_date === d && l.taken) };
  });

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      patient: {
        name:        profile.name,
        condition:   profile.condition,
        age:         profile.age,
        weeks:       profile.weeks,
        memberSince: profile.created_at,
      },
      medications,
      stats: { streak, adherence30, totalMeds: medications.length, todayTaken },
      chartDays,
      generatedAt: new Date().toISOString(),
    }),
  };
};
