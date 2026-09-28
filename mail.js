// One place for every email we send. If Resend is not set up,
// nothing crashes: the email is skipped and the app keeps working.
const FROM = process.env.MAIL_FROM || "onboarding@resend.dev";

async function send({ to, subject, html }) {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  if (!key) {
    console.warn("No RESEND_API_KEY, email not sent:", subject);
    return { ok: false, error: "Email is not set up" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: `CBE QuickSite <${FROM}>`, to, subject, html }),
    });

    const body = await res.json();
    if (!res.ok) {
      console.error("Resend refused:", res.status, body);
      return { ok: false, error: body.message || "Email failed" };
    }

    return { ok: true, id: body.id };
  } catch (err) {
    console.error("Could not reach Resend:", err.message);
    return { ok: false, error: "Email failed" };
  }
}

// Plain, short and mobile-friendly. Long HTML emails land in spam.
function resetEmail(link) {
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <h1 style="font-size:20px;margin:0 0 16px">Reset your password</h1>
      <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 24px">
        Tap the button below to choose a new password. This link works once and expires in 1 hour.
      </p>
      <a href="${link}"
         style="display:inline-block;padding:14px 28px;background:#1d4ed8;color:#fff;
                text-decoration:none;border-radius:8px;font-size:15px;font-weight:600">
        Reset password
      </a>
      <p style="font-size:13px;line-height:1.6;color:#777;margin:24px 0 0">
        If you did not ask for this, you can ignore this email. Your password stays the same.
      </p>
      <p style="font-size:12px;color:#999;margin:24px 0 0">CBE QuickSite</p>
    </div>
  `;
}

// Sent the moment someone signs up
function verifyEmail(link) {
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <h1 style="font-size:20px;margin:0 0 16px">Confirm your email</h1>
      <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 24px">
        Welcome to CBE QuickSite. Tap the button below so we know this email is really yours.
        That way you can always get back into your account.
      </p>
      <a href="${link}"
         style="display:inline-block;padding:14px 28px;background:#1d4ed8;color:#fff;
                text-decoration:none;border-radius:8px;font-size:15px;font-weight:600">
        Confirm my email
      </a>
      <p style="font-size:13px;line-height:1.6;color:#777;margin:24px 0 0">
        This link expires in 24 hours. If you did not create an account, you can ignore this email.
      </p>
      <p style="font-size:12px;color:#999;margin:24px 0 0">CBE QuickSite</p>
    </div>
  `;
}

module.exports = { send, resetEmail, verifyEmail };