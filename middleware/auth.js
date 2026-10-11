const jwt = require("jsonwebtoken");
const db = require("../db");

// Blocks anyone who is not signed in, and tells us who they are
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) return res.status(401).json({ error: "Not signed in" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    req.user = { id: payload.id, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

// Signed in AND email confirmed. Used on everything that builds or changes a shop.
function requireVerified(req, res, next) {
  requireAuth(req, res, async () => {
    try {
      if (req.user.role === "admin") return next();

      const { rows } = await db.query("SELECT email_verified_at FROM users WHERE id = $1", [req.user.id]);
      if (!rows.length) return res.status(401).json({ error: "Not signed in" });
      if (!rows[0].email_verified_at) {
        return res.status(403).json({ error: "Please confirm your email first.", needsConfirm: true });
      }
      next();
    } catch (err) {
      next(err);
    }
  });
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Not allowed" });
    next();
  });
}

module.exports = { requireAuth, requireVerified, requireAdmin };