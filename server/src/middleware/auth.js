import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  if (process.env.DEV_AUTH_BYPASS === "true") {
    const configuredId = process.env.DEV_AUTH_USER_ID || "";
    const isObjectId = /^[a-f\d]{24}$/i.test(configuredId);
    req.user = {
      sub: isObjectId ? configuredId : "000000000000000000000001",
      email: process.env.DEV_AUTH_EMAIL || "dev@example.com",
      role: "dev",
    };
    return next();
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
