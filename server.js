require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const IMG_DIR = path.join(__dirname, "public", "images");
fs.mkdirSync(IMG_DIR, { recursive: true });

const Image = mongoose.model(
  "Image",
  new mongoose.Schema(
    {
      prompt: { type: String, required: true, trim: true, maxlength: 500 },
      style: String,
      ratio: String,
      seed: Number,
      url: { type: String, required: true }, // e.g. /images/abc.jpg
      favorite: { type: Boolean, default: false },
    },
    { timestamps: true }
  )
);

const safe = (fn) => (req, res) =>
  fn(req, res).catch((err) => res.status(500).json({ error: err.message }));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clamp = (n, lo, hi, d) => (Number.isFinite(+n) ? Math.min(hi, Math.max(lo, +n)) : d);

// Generate an image with Pollinations (API key stays on the server), save it, store in MongoDB
app.post(
  "/api/generate",
  safe(async (req, res) => {
    const key = process.env.POLLINATIONS_API_KEY;
    if (!key || key.includes("your_key"))
      return res.status(400).json({ error: "POLLINATIONS_API_KEY is missing in .env. Get a key at enter.pollinations.ai" });

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

    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    const file = `${Date.now()}-${seed}.${ext}`;
    fs.writeFileSync(path.join(IMG_DIR, file), Buffer.from(await r.arrayBuffer()));

    const doc = await Image.create({ prompt: prompt.trim(), style, ratio, seed, url: `/images/${file}` });
    res.status(201).json(doc);
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
    const img = await Image.findByIdAndDelete(req.params.id);
    if (img && img.url.startsWith("/images/")) {
      fs.unlink(path.join(IMG_DIR, path.basename(img.url)), () => {});
    }
    res.json({ ok: true });
  })
);

const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URL, { dbName: "ImgGen", serverSelectionTimeoutMS: 8000 })
  .then(() => {
    console.log("MongoDB connected");
    app.listen(PORT, () => console.log(`Open http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    console.error("Check: 1) .env has MONGO_URL  2) Atlas Network Access allows your IP (0.0.0.0/0)  3) username/password");
    process.exit(1);
  });
