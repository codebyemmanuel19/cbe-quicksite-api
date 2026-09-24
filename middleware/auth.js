const jwt = require("jsonwebtoken");

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

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Not allowed" });
    next();
  });
}

module.exports = { requireAuth, requireAdmin };