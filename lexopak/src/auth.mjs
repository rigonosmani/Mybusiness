import crypto from "node:crypto";
import { config } from "./config.mjs";

const COOKIE = "lx_admin";
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

const sign = (value) => crypto.createHmac("sha256", config.sessionSecret).update(value).digest("hex");

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export const adminConfigured = () => !!config.adminPassword && config.sessionSecret.length >= 32;

export function isLoggedIn(req) {
  const token = readCookie(req, COOKIE);
  if (!token || !adminConfigured()) return false;
  const [expires, sig] = token.split(".");
  return !!sig && safeEqual(sig, sign(expires)) && Number(expires) > Date.now();
}

export function checkPassword(password) {
  return adminConfigured() && safeEqual(sign(String(password)), sign(config.adminPassword));
}

export function setLoginCookie(res, secure) {
  const expires = String(Date.now() + MAX_AGE_MS);
  res.cookie(COOKIE, `${expires}.${sign(expires)}`, { httpOnly: true, sameSite: "strict", secure, maxAge: MAX_AGE_MS, path: "/" });
}

export const clearLoginCookie = (res) => res.clearCookie(COOKIE, { path: "/" });

export function requireAdmin(req, res, next) {
  if (isLoggedIn(req)) return next();
  res.redirect("/admin/login");
}

// SameSite=Strict already blocks cross-site form posts; this also rejects posts from other origins.
export function sameOrigin(req, res, next) {
  const origin = req.headers.origin;
  if (req.method === "POST" && origin && new URL(origin).host !== req.headers.host) return res.status(403).send("Forbidden");
  next();
}

// Slows down password guessing: max 10 failed attempts per IP per 15 minutes.
const failures = new Map();
export function loginAllowed(ip) {
  const f = failures.get(ip);
  if (!f || f.until < Date.now()) return true;
  return f.count < 10;
}
export function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || f.until < Date.now()) failures.set(ip, { count: 1, until: Date.now() + 15 * 60_000 });
  else f.count++;
}
