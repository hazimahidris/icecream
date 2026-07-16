import crypto from "crypto";

export const SESSION_COOKIE_NAME = "admin_session";
export const SESSION_MAX_AGE = 8 * 60 * 60; // 8 hours, in seconds

function getSecret(): string | null {
  return process.env.ADMIN_PASSWORD || null;
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

// Session token = "<expiryTimestamp>.<hmac>". Stateless — no session store
// needed — and the HMAC means the cookie can't be forged even though
// httpOnly only blocks JS access, not someone manually setting a cookie
// value via devtools or a raw request.
export function createSessionToken(): string | null {
  const secret = getSecret();
  if (!secret) return null;

  const expires = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = String(expires);
  return `${payload}.${sign(payload, secret)}`;
}

export function isValidSessionToken(token: string | undefined): boolean {
  const secret = getSecret();
  if (!secret || !token) return false;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expires = Number(payload);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;

  const expected = sign(payload, secret);
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");

  // Buffers of different length would make timingSafeEqual throw — treat
  // that as a mismatch instead of letting it crash the request.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Hashes both sides to fixed-length digests first so the comparison is
// timing-safe regardless of the submitted password's length.
export function verifyPassword(submitted: string): boolean {
  const secret = getSecret();
  if (!secret) return false;

  const a = crypto.createHash("sha256").update(submitted).digest();
  const b = crypto.createHash("sha256").update(secret).digest();

  return crypto.timingSafeEqual(a, b);
}
