// send-reminders.js — Send daily medication reminders via Web Push
// Triggered daily by a cron service (e.g. cron-job.org) hitting:
//   POST /.netlify/functions/send-reminders
//   Header: x-cron-secret: <CRON_SECRET env var>
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
//   VAPID_SUBJECT (e.g. mailto:hello@getafya.co)
//   CRON_SECRET

const webpush = require("web-push");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // Auth — only the cron caller (or admin) can trigger this
  const secret = event.headers["x-cron-secret"] || event.queryStringParameters?.secret;
  if (secret !== process.env.CRON_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:hello@getafya.co",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );

  const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  try {
    // Load all push subscriptions
    const subsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?select=id,user_id,endpoint,p256dh,auth`,
      { headers: sbHeaders }
    );
    const subscriptions = await subsRes.json();

    if (!subscriptions.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ sent: 0, message: "No subscribers" }) };
    }

    // Load today's med logs to know who has already taken all their meds
    const today = new Date().toISOString().slice(0, 10);
    const logsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/med_logs?logged_date=eq.${today}&taken=eq.true&select=user_id`,
      { headers: sbHeaders }
    );
    const todayLogs = await logsRes.json();
    const doneUserIds = new Set((todayLogs || []).map(l => l.user_id));

    // Load medications to know who has meds at all
    const medsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/medications?active=eq.true&select=user_id`,
      { headers: sbHeaders }
    );
    const allMeds = await medsRes.json();
    const usersWithMeds = new Set((allMeds || []).map(m => m.user_id));

    let sent = 0;
    let failed = 0;
    const expiredEndpoints = [];

    for (const sub of subscriptions) {
      // Only remind users who have meds and haven't taken any today
      if (!usersWithMeds.has(sub.user_id)) continue;
      if (doneUserIds.has(sub.user_id)) continue;

      const payload = JSON.stringify({
        title: "💊 Medication reminder",
        body:  "You haven't logged your meds today. Tap to check them off.",
        url:   "/app.html",
        icon:  "/icons/icon-192.png",
        badge: "/icons/icon-72.png",
      });

      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 3600 } // expire after 1 hour if undelivered
        );
        sent++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired — clean it up
          expiredEndpoints.push(sub.endpoint);
        }
        failed++;
      }
    }

    // Remove expired subscriptions
    for (const endpoint of expiredEndpoints) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,
        { method: "DELETE", headers: sbHeaders }
      );
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ sent, failed, expired: expiredEndpoints.length }),
    };
  } catch (err) {
    console.error("send-reminders error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
