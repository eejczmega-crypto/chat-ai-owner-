import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "store.json");
const PORT = Number(process.env.PORT || 3000);
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
const OWNER_PASSWORD = String(process.env.OWNER_PASSWORD || "");
const SESSION_SECRET = String(process.env.SESSION_SECRET || "");

if (!OWNER_EMAIL || !OWNER_PASSWORD || SESSION_SECRET.length < 32) {
  console.warn("تحذير: عيّن OWNER_EMAIL وOWNER_PASSWORD وSESSION_SECRET (32 حرفاً على الأقل) في متغيرات البيئة.");
}

const defaults = {
  users: [],
  sessions: {},
  settings: { siteName: "Chat MeGa AI", maintenance: false, freeDailyLimit: 15 },
  usage: {}
};
let store = defaults;

async function saveStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = DB_FILE + ".tmp";
  await fs.writeFile(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
  await fs.rename(temp, DB_FILE);
}
async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { store = { ...defaults, ...JSON.parse(await fs.readFile(DB_FILE, "utf8")) }; }
  catch (e) { if (e.code !== "ENOENT") throw e; store = structuredClone(defaults); }
  if (!Array.isArray(store.users)) store.users = [];
  if (!store.sessions || typeof store.sessions !== "object") store.sessions = {};
  if (!store.settings) store.settings = structuredClone(defaults.settings);
  if (!store.usage) store.usage = {};
  if (OWNER_EMAIL && OWNER_PASSWORD && !store.users.some(u => u.email === OWNER_EMAIL)) {
    store.users.push({ id: crypto.randomUUID(), email: OWNER_EMAIL, name: "مالك الموقع", passwordHash: hashPassword(OWNER_PASSWORD), role: "owner", plan: "lifetime", blocked: false, createdAt: Date.now() });
    await saveStore();
  }
  const owner = store.users.find(u => u.email === OWNER_EMAIL);
  if (owner) { owner.role = "owner"; owner.plan = "lifetime"; owner.blocked = false; await saveStore(); }
}
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, saved) {
  try {
    const [salt, hash] = saved.split(":");
    const actual = crypto.scryptSync(String(password), salt, 64);
    return crypto.timingSafeEqual(actual, Buffer.from(hash, "hex"));
  } catch { return false; }
}
function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET || "development-only-secret").update(value).digest("hex");
}
function makeToken(userId) {
  const id = crypto.randomBytes(32).toString("hex");
  store.sessions[id] = { userId, expires: Date.now() + 7 * 86400000 };
  return `${id}.${sign(id)}`;
}
function readUser(req) {
  const token = req.headers.cookie?.split(";").map(x => x.trim()).find(x => x.startsWith("cm_session="))?.slice(11);
  if (!token) return null;
  const [id, signature] = token.split(".");
  if (!id || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(id)))) return null;
  const session = store.sessions[id];
  if (!session || session.expires < Date.now()) { delete store.sessions[id]; return null; }
  return store.users.find(u => u.id === session.userId && !u.blocked) || null;
}
function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, plan: u.plan, blocked: !!u.blocked, createdAt: u.createdAt };
}
function auth(req, res, next) {
  const user = readUser(req);
  if (!user) return res.status(401).json({ error: "سجّل الدخول أولاً." });
  req.user = user; next();
}
function ownerOnly(req, res, next) {
  if (req.user?.role !== "owner") return res.status(403).json({ error: "هذه الصلاحية للمالك فقط." });
  next();
}
function setSession(res, token) {
  res.setHeader("Set-Cookie", `cm_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
}
function cleanText(v, max = 100) { return String(v ?? "").trim().slice(0, max); }

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (_req, res) => res.json({ aiConfigured: !!process.env.OPENAI_API_KEY, siteName: store.settings.siteName }));
app.post("/api/register", async (req, res) => {
  const name = cleanText(req.body.name, 50), email = cleanText(req.body.email, 160).toLowerCase(), password = String(req.body.password || "");
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) return res.status(400).json({ error: "أدخل اسماً وبريداً صحيحاً وكلمة مرور من 10 أحرف على الأقل." });
  if (store.users.some(u => u.email === email)) return res.status(409).json({ error: "هذا البريد مسجل بالفعل." });
  const user = { id: crypto.randomUUID(), name, email, passwordHash: hashPassword(password), role: "user", plan: "free", blocked: false, createdAt: Date.now() };
  store.users.push(user); const token = makeToken(user.id); await saveStore(); setSession(res, token);
  res.json({ user: publicUser(user) });
});
app.post("/api/login", async (req, res) => {
  const email = cleanText(req.body.email, 160).toLowerCase(), password = String(req.body.password || "");
  const user = store.users.find(u => u.email === email);
  if (!user || user.blocked || !verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: "بيانات الدخول غير صحيحة أو الحساب موقوف." });
  if (user.email === OWNER_EMAIL) { user.role = "owner"; user.plan = "lifetime"; user.blocked = false; }
  const token = makeToken(user.id); await saveStore(); setSession(res, token);
  res.json({ user: publicUser(user) });
});
app.post("/api/logout", auth, async (_req, res) => {
  res.setHeader("Set-Cookie", "cm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/me", auth, (req, res) => res.json({ user: publicUser(req.user), settings: { siteName: store.settings.siteName, maintenance: store.settings.maintenance } }));

app.post("/api/chat", auth, async (req, res) => {
  try {
    if (store.settings.maintenance && req.user.role !== "owner") return res.status(503).json({ error: "الموقع في وضع الصيانة حالياً." });
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "خدمة الذكاء الاصطناعي غير مفعّلة. أضف OPENAI_API_KEY في متغيرات البيئة." });
    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
    if (!messages.length || messages.length > 30) return res.status(400).json({ error: "المحادثة غير صالحة." });
    const day = new Date().toISOString().slice(0, 10), key = `${req.user.id}:${day}`;
    const used = Number(store.usage[key] || 0);
    const unlimited = req.user.role === "owner" || req.user.plan === "lifetime";
    const premium = req.user.plan === "premium";
    const limit = premium ? 300 : Number(store.settings.freeDailyLimit || 15);
    if (!unlimited && used >= limit) return res.status(429).json({ error: "وصلت إلى الحد اليومي للرسائل." });
    const safeMessages = messages.slice(-20).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: cleanText(m.content, 8000) }));
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "system", content: `أنت ${store.settings.siteName}، مساعد ذكي مفيد. أجب بلغة المستخدم وبوضوح.` }, ...safeMessages],
      max_tokens: 1400
    });
    store.usage[key] = used + 1; await saveStore();
    res.json({ reply: completion.choices?.[0]?.message?.content || "لم أتمكن من إنشاء رد.", unlimited, remaining: unlimited ? null : Math.max(0, limit - used - 1) });
  } catch (err) {
    console.error("Chat API error:", err?.message || err);
    res.status(500).json({ error: "حدث خطأ أثناء الاتصال بخدمة الذكاء الاصطناعي." });
  }
});

app.get("/api/admin/overview", auth, ownerOnly, (_req, res) => {
  res.json({ users: store.users.map(publicUser), settings: store.settings, totalUsers: store.users.length });
});
app.patch("/api/admin/settings", auth, ownerOnly, async (req, res) => {
  const siteName = cleanText(req.body.siteName, 60);
  const freeDailyLimit = Math.max(1, Math.min(500, Number(req.body.freeDailyLimit) || 15));
  if (siteName) store.settings.siteName = siteName;
  store.settings.freeDailyLimit = freeDailyLimit;
  store.settings.maintenance = Boolean(req.body.maintenance);
  await saveStore(); res.json({ settings: store.settings });
});
app.patch("/api/admin/users/:id", auth, ownerOnly, async (req, res) => {
  const user = store.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "المستخدم غير موجود." });
  if (user.role === "owner") return res.status(400).json({ error: "لا يمكن تعديل حساب المالك من هذه الشاشة." });
  if (typeof req.body.blocked === "boolean") user.blocked = req.body.blocked;
  if (["free", "premium"].includes(req.body.plan)) user.plan = req.body.plan;
  await saveStore(); res.json({ user: publicUser(user) });
});
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

await loadStore();
app.listen(PORT, () => console.log(`Chat MeGa AI running on port ${PORT}`));
