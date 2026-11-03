require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.set("trust proxy", 1); // correct client IP / https behind Vercel, Render, etc.
app.use(express.json());

/* ---------- optional site password (set APP_PASSWORD) with cookie login ---------- */
const PASSWORD = process.env.APP_PASSWORD;
const TOKEN = PASSWORD
  ? crypto.createHmac("sha256", PASSWORD).update("aigenerateimage-auth").digest("hex")
  : null;

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function getCookie(req, name) {
  const found = (req.headers.cookie || "").split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="));
  return found ? found.slice(name.length + 1) : "";
}

function limiter(max, windowMs, message) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const list = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: message });
    list.push(now);
    hits.set(req.ip, list);
    next();
  };
}

app.post("/api/login", limiter(10, 10 * 60 * 1000, "Too many attempts. Try again in a few minutes."), (req, res) => {
  if (!PASSWORD) return res.json({ ok: true });
  if (!safeEqual(req.body.password || "", PASSWORD)) return res.status(401).json({ error: "Wrong password" });
  res.cookie("auth", TOKEN, { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ ok: true });
});

// everything else under /api needs the cookie when a password is set
app.use("/api", (req, res, next) => {
  if (!PASSWORD || safeEqual(getCookie(req, "auth"), TOKEN)) return next();
  res.status(401).json({ error: "Login required" });
});

/* ---------- database (connects lazily so it also works on serverless hosts) ---------- */
let connecting = null;
function connectDb() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (!connecting) {
    connecting = mongoose
      .connect(process.env.MONGO_URL, { dbName: "ImgGen", serverSelectionTimeoutMS: 8000 })
      .catch((err) => { connecting = null; throw err; });
  }
  return connecting;
}
app.use("/api", async (req, res, next) => {
  try { await connectDb(); next(); }
  catch (err) { res.status(500).json({ error: "Database connection failed: " + err.message }); }
});

const Image =
  mongoose.models.Image ||
  mongoose.model(
    "Image",
    new mongoose.Schema(
      {
        prompt: { type: String, required: true, trim: true, maxlength: 500 },
        style: String,
        ratio: String,
        seed: Number,
        url: { type: String, required: true },
        favorite: { type: Boolean, default: false },
        contentType: String,
        data: { type: Buffer, select: false }, // image bytes live in MongoDB
      },
      { timestamps: true }
    )
  );

const safe = (fn) => (req, res) =>
  fn(req, res).catch((err) => res.status(500).json({ error: err.message }));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clamp = (n, lo, hi, d) => (Number.isFinite(+n) ? Math.min(hi, Math.max(lo, +n)) : d);

app.post(
  "/api/generate",
  limiter(10, 10 * 60 * 1000, "Too many images in a short time. Please wait a few minutes."),
  safe(async (req, res) => {
    const key = process.env.POLLINATIONS_API_KEY;
    if (!key || key.includes("your_key"))
      return res.status(400).json({ error: "POLLINATIONS_API_KEY is missing. Get a key at enter.pollinations.ai" });

    const { prompt, fullPrompt, style, ratio } = req.body;
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: "Prompt is required" });
    const width = clamp(req.body.width, 256, 1536, 1024);
    const height = clamp(req.body.height, 256, 1536, 1024);
    const seed = clamp(req.body.seed, 0, 999999, Math.floor(Math.random() * 1e6));

    const apiUrl =
      `https://gen.pollinations.ai/image/${encodeURIComponent((fullPrompt || prompt).slice(0, 800))}` +
      `?width=${width}&height=${height}&seed=${seed}&nologo=true`;

    const r = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) {
      const hint =
        r.status === 401 || r.status === 403
          ? "API key is invalid or not allowed. Check POLLINATIONS_API_KEY."
          : r.status === 402
          ? "Not enough credits (Pollen) on your Pollinations account."
          : r.status === 429
          ? "Too many requests. Wait a minute and try again."
          : "Image service error.";
      return res.status(502).json({ error: `${hint} (status ${r.status})` });
    }
    const type = r.headers.get("content-type") || "";
    if (!type.startsWith("image/")) return res.status(502).json({ error: "Image service did not return an image." });

    const doc = await Image.create({
      prompt: prompt.trim(), style, ratio, seed,
      url: "pending", contentType: type,
      data: Buffer.from(await r.arrayBuffer()),
    });
    doc.url = `/api/images/${doc._id}/file`;
    await doc.save();

    const out = doc.toObject();
    delete out.data;
    res.status(201).json(out);
  })
);

app.get(
  "/api/images/:id/file",
  safe(async (req, res) => {
    const img = await Image.findById(req.params.id).select("+data contentType");
    if (!img || !img.data) return res.status(404).send("Not found");
    res.set("Content-Type", img.contentType || "image/jpeg");
    res.set("Cache-Control", "private, max-age=31536000, immutable");
    res.send(img.data);
  })
);

app.get(
  "/api/images",
  safe(async (req, res) => {
    const filter = {};
    if (req.query.q) filter.prompt = new RegExp(escapeRegex(req.query.q), "i");
    if (req.query.fav === "1") filter.favorite = true;
    res.json(await Image.find(filter).sort({ createdAt: -1 }).limit(100));
  })
);

app.patch(
  "/api/images/:id/favorite",
  safe(async (req, res) => {
    const img = await Image.findById(req.params.id);
    if (!img) return res.status(404).json({ error: "Not found" });
    img.favorite = !img.favorite;
    await img.save();
    res.json(img);
  })
);

app.delete(
  "/api/images/:id",
  safe(async (req, res) => {
    await Image.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  })
);

// local development only (Vercel serves public/ itself and calls the exported app)
app.use(express.static(path.join(__dirname, "public")));

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  connectDb()
    .then(() => {
      console.log("MongoDB connected");
      app.listen(PORT, () => console.log(`Open http://localhost:${PORT}`));
    })
    .catch((err) => {
      console.error("MongoDB connection failed:", err.message);
      console.error("Check: 1) MONGO_URL is set  2) Atlas Network Access allows 0.0.0.0/0  3) username/password");
      process.exit(1);
    });
}

module.exports = app;