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

// Web Push implemented with Node.js built-in crypto — no npm required
const crypto = require("crypto");

const PKCS8_PREFIX = Buffer.from(
  "308141020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420",
  "hex"
);

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function b64dec(str) {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function vapidJWT(endpoint, subject, pubKey, privKey) {
  const { protocol, host } = new URL(endpoint);
  const header  = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = b64url(JSON.stringify({ aud: `${protocol}//${host}`, exp: Math.floor(Date.now() / 1000) + 43200, sub: subject }));
  const input   = `${header}.${payload}`;
  const key     = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, b64dec(privKey)]), format: "der", type: "pkcs8" });
  const sig     = crypto.createSign("SHA256").update(input).sign({ key, dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(sig)}`;
}

function hkdf(salt, ikm, info, len) {
  const prk = crypto.createHmac("sha256", salt).update(ikm).digest();
  let t = Buffer.alloc(0), okm = Buffer.alloc(0);
  for (let i = 1; okm.length < len; i++) {
    t = crypto.createHmac("sha256", prk).update(Buffer.concat([t, info, Buffer.from([i])])).digest();
    okm = Buffer.concat([okm, t]);
  }
  return okm.slice(0, len);
}

function encryptPayload(payload, p256dh, auth) {
  const clientKey = b64dec(p256dh);
  const authSecret = b64dec(auth);
  const salt = crypto.randomBytes(16);
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const serverPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(clientKey);
  const prk = hkdf(authSecret, shared, Buffer.concat([Buffer.from("WebPush: info\x00"), clientKey, serverPub]), 32);
  const cek   = hkdf(salt, prk, Buffer.from("Content-Encoding: aesgcm128\x00"), 16);
  const nonce = hkdf(salt, prk, Buffer.from("Content-Encoding: nonce\x00"), 12);
  const padded = Buffer.concat([Buffer.alloc(2), Buffer.from(payload)]);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);
  return { body, salt, serverPub };
}

async function sendPush(sub, data, vapidPublicKey, vapidPrivateKey, vapidSubject) {
  const jwt = vapidJWT(sub.endpoint, vapidSubject, vapidPublicKey, vapidPrivateKey);
  const { body, salt, serverPub } = encryptPayload(JSON.stringify(data), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Authorization":    `WebPush ${jwt}`,
      "Crypto-Key":       `dh=${b64url(serverPub)};p256ecdsa=${vapidPublicKey}`,
      "Content-Encoding": "aesgcm",
      "Encryption":       `salt=${b64url(salt)}`,
      "Content-Type":     "application/octet-stream",
      "TTL":              "3600",
    },
    body,
  });
  return res;
}

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

  const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
  const VAPID_SUBJECT     = process.env.VAPID_SUBJECT || "mailto:hello@getafya.co";

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
        const res = await sendPush(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          { title: "💊 Medication reminder", body: "You haven't logged your meds today. Tap to check them off.", url: "/app.html", icon: "/icons/icon-192.png" },
          VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
        );
        if (res.ok) { sent++; } else { failed++; }
        if (res.status === 410 || res.status === 404) {
          // Subscription expired — clean it up
          expiredEndpoints.push(sub.endpoint);
        }
      } catch (err) {
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
