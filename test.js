require("dotenv").config();
const db = require("./db");

const BASE = "http://localhost:5000";
const creds = { email: "test@test.com", password: "password123" };
const SLUG = "kemisboutique";

let pass = 0, fail = 0;
function check(name, ok, extra) {
  console.log(ok ? `PASS  ${name}` : `FAIL  ${name}`, extra === undefined ? "" : extra);
  ok ? pass++ : fail++;
}
const J = { "Content-Type": "application/json" };

(async () => {
  const login = await fetch(BASE + "/auth/login", { method: "POST", headers: J, body: JSON.stringify(creds) });
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const head = { ...J, cookie };
  check("signed in", login.status === 200, login.status);

  // Upload signature
  const sig = await fetch(BASE + "/uploads/signature", { headers: { cookie } });
  const sigBody = await sig.json();
  const cloudSetUp = sig.status === 200;

  if (cloudSetUp) {
    check("signature created", !!sigBody.signature, sigBody.signature && sigBody.signature.slice(0, 12) + "...");
    check("each shop has its own folder", String(sigBody.folder || "").startsWith("quicksite/"), sigBody.folder);
    check("pictures only", sigBody.allowed_formats === "jpg,jpeg,png,webp", sigBody.allowed_formats);
    check("big photos get shrunk", String(sigBody.transformation || "").includes("w_1600"), sigBody.transformation);
    check("api secret never sent", !JSON.stringify(sigBody).includes(process.env.CLOUDINARY_API_SECRET || "NOTHING"));
  } else {
    console.log("NOTE  cloudinary not set up yet:", sigBody.error || sig.status);
  }

  const strangerSig = await fetch(BASE + "/uploads/signature");
  check("stranger cannot get a signature", strangerSig.status === 401, strangerSig.status);

  // Photos from anywhere else must be thrown away
  const outside = await fetch(BASE + "/products", {
    method: "POST",
    headers: head,
    body: JSON.stringify({ name: "Photo Test Gown", price: 12000, photos: ["https://random-site.com/photo.jpg"] }),
  });
  const outsideBody = await outside.json();

  if (cloudSetUp) {
    check("photo from another site blocked", outside.status === 201 && outsideBody.product.photos.length === 0, outsideBody.product && outsideBody.product.photos);
  } else {
    check("product still saves before cloudinary is set up", outside.status === 201, outside.status);
  }

  // A real Cloudinary link of yours must be kept
  if (cloudSetUp) {
    const mine = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/v1/quicksite/test.jpg`;
    const ok = await fetch(`${BASE}/products/${outsideBody.product.id}`, {
      method: "PUT",
      headers: head,
      body: JSON.stringify({ name: "Photo Test Gown", price: 12000, photos: [mine] }),
    });
    const okBody = await ok.json();
    check("your own cloudinary photo kept", ok.status === 200 && okBody.product.photos.length === 1, okBody.product && okBody.product.photos.length);

    const badLogo = await fetch(BASE + "/sites/business", {
      method: "PUT",
      headers: head,
      body: JSON.stringify({ businessName: "Kemi's Boutique", whatsapp: "08031234567", logo: "https://random-site.com/logo.png" }),
    });
    const badLogoBody = await badLogo.json();
    check("outside logo blocked", badLogo.status === 200 && badLogoBody.site.business.logo === "", badLogoBody.site && badLogoBody.site.business.logo);
  }

  // Tidy up
  await fetch(`${BASE}/products/${outsideBody.product.id}`, { method: "DELETE", headers: head });

  // Quick pass over the rest
  const health = await fetch(BASE + "/health").then((r) => r.json());
  check("database connected", health.database === "connected");

  const shop = await fetch(`${BASE}/public/shop/${SLUG}`);
  check("storefront loads", shop.status === 200, shop.status);

  const plans = await fetch(BASE + "/billing/plans").then((r) => r.json());
  check("plans load", plans.plans.length === 4, plans.plans.length);

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.pool.end();
})();