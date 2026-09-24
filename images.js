// Photos must live in your own Cloudinary account, so nobody can point a product
// at a file on someone else's server. Before Cloudinary is set up, any https link passes.
function isOurImage(url) {
  const v = String(url || "").trim();
  if (!v.startsWith("https://") || v.length > 500) return false;

  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloud) return true;

  return v.startsWith(`https://res.cloudinary.com/${cloud}/`);
}

module.exports = { isOurImage };