const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("../middleware/auth");
const { requireActive } = require("../middleware/locked");

const router = express.Router();

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads. Please try again later." },
});

// The phone uploads straight to Cloudinary, but only with a signature made here.
// The API secret never leaves the server.
router.get("/signature", requireAuth, requireActive, uploadLimiter, (req, res) => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: "Uploads are not set up yet" });
  }

  const params = {
    allowed_formats: "jpg,jpeg,png,webp", // no PDFs, no scripts, pictures only
    folder: `quicksite/${req.site.id}`, // each shop gets its own folder
    timestamp: Math.floor(Date.now() / 1000), // the signature dies after about an hour
    transformation: "c_limit,w_1600,h_1600,q_auto", // huge phone photos are shrunk on arrival
  };

  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  const signature = crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");

  res.json({
    ...params,
    cloudName,
    apiKey,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
  });
});

module.exports = router;