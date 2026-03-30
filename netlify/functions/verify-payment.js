// AFYA — Paystack Payment Verification
// Verifies a Paystack transaction and upgrades the user to Premium in Supabase.
// Required env vars:
//   PAYSTACK_SECRET_KEY  — from Paystack dashboard → Settings → API Keys
//   SUPABASE_URL         — from Supabase dashboard → Settings → API
//   SUPABASE_SERVICE_KEY — from Supabase dashboard → Settings → API → service_role key

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method Not Allowed" };

  try {
    const { reference, userId, plan } = JSON.parse(event.body);

    if (!reference || !userId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing reference or userId" }) };
    }

    // 1. Verify transaction with Paystack
    const psRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const psData = await psRes.json();

    if (!psData.status || psData.data?.status !== "success") {
      console.error("Paystack verify failed:", JSON.stringify(psData));
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: "Payment verification failed" }),
      };
    }

    // 2. Determine subscription length from amount paid (kobo)
    const amountKobo = psData.data.amount;
    const isAnnual   = amountKobo >= 2500000; // ₦25,000 = 2,500,000 kobo
    const days       = isAnnual ? 365 : 30;

    const now        = new Date();
    const expiresAt  = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    // 3. Update Supabase profile using service role key (bypasses RLS)
    const sbRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          is_premium:         true,
          premium_since:      now.toISOString(),
          premium_expires_at: expiresAt.toISOString(),
        }),
      }
    );

    if (!sbRes.ok) {
      const errText = await sbRes.text();
      console.error("Supabase update error:", errText);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: "Failed to upgrade account" }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success:    true,
        plan:       isAnnual ? "annual" : "monthly",
        expiresAt:  expiresAt.toISOString(),
      }),
    };
  } catch (err) {
    console.error("verify-payment error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Something went wrong. Please contact support." }),
    };
  }
};
