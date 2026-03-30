// AFYA Referral System — Netlify Function (Step 6)
// POST with { code, validate: true }  → check if code is valid (no side effects)
// POST with { code, newUserId, validate: false } → apply referral (grants 30 days Premium to both users)

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
    const { code, newUserId, validate } = JSON.parse(event.body);
    if (!code) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Code required" }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
    const clean        = code.trim().toUpperCase();

    // ── Look up the referrer by their referral_code ───────────────────────
    const refRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?referral_code=eq.${encodeURIComponent(clean)}&select=id,name,friends_referred,free_months_earned,is_premium,premium_expires_at`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const refs = await refRes.json();

    if (!refs || refs.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, error: "Code not found" }) };
    }

    const referrer = refs[0];

    // ── Validate-only mode (no side effects) ──────────────────────────────
    if (validate) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ valid: true, referrerName: referrer.name || "your friend" }),
      };
    }

    // ── Apply mode ────────────────────────────────────────────────────────
    if (!newUserId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "newUserId required to apply referral" }) };
    }

    // Prevent self-referral
    if (referrer.id === newUserId) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: "Cannot use your own code" }) };
    }

    const now       = new Date();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    // Give the NEW USER 30 days Premium
    const newUserExpiry = new Date(now.getTime() + thirtyDays);
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${newUserId}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json", Prefer: "return=minimal",
      },
      body: JSON.stringify({
        is_premium:          true,
        premium_since:       now.toISOString(),
        premium_expires_at:  newUserExpiry.toISOString(),
      }),
    });

    // Extend the REFERRER'S Premium by 30 days (stacks on top of existing time)
    const existingExpiry = referrer.premium_expires_at ? new Date(referrer.premium_expires_at) : now;
    const baseTime       = existingExpiry > now ? existingExpiry.getTime() : now.getTime();
    const referrerExpiry = new Date(baseTime + thirtyDays);

    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${referrer.id}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json", Prefer: "return=minimal",
      },
      body: JSON.stringify({
        is_premium:          true,
        premium_expires_at:  referrerExpiry.toISOString(),
        friends_referred:    (referrer.friends_referred  || 0) + 1,
        free_months_earned:  (referrer.free_months_earned || 0) + 1,
      }),
    });

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, referrerName: referrer.name || "your friend" }),
    };

  } catch (err) {
    console.error("apply-referral error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Something went wrong" }) };
  }
};
