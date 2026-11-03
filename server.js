require('dotenv').config()
const express = require('express')
const mongoose = require('mongoose')
const crypto = require('crypto')
const { promisify } = require('util')
const path = require('path')
const scrypt = promisify(crypto.scrypt)

const app = express()
app.set('trust proxy', 1)
app.use(express.json())

const SECRET = process.env.SESSION_SECRET
const INVITE = process.env.INVITE_CODE || ''
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT) || 15
const DAY = 24 * 3600 * 1000

/* ---------- helpers ---------- */
function safeEqual(a, b) {
  const x = Buffer.from(String(a)),
    y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}
function getCookie(req, name) {
  const found = (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(name + '='))
  return found ? found.slice(name.length + 1) : ''
}
function limiter(max, windowMs, message) {
  const hits = new Map()
  return (req, res, next) => {
    const now = Date.now()
    const list = (hits.get(req.ip) || []).filter((t) => now - t < windowMs)
    if (list.length >= max) return res.status(429).json({ error: message })
    list.push(now)
    hits.set(req.ip, list)
    next()
  }
}
const safe = (fn) => (req, res) => fn(req, res).catch((err) => res.status(500).json({ error: err.message }))
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const clamp = (n, lo, hi, d) => (Number.isFinite(+n) ? Math.min(hi, Math.max(lo, +n)) : d)
const todayStr = () => new Date().toISOString().slice(0, 10)

/* ---------- login sessions (signed cookie, works on serverless too) ---------- */
const sign = (v) =>
  crypto
    .createHmac('sha256', SECRET || '')
    .update(v)
    .digest('hex')
function setSession(req, res, userId) {
  const body = `${userId}.${Date.now() + 30 * DAY}`
  res.cookie('session', `${body}.${sign(body)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: 30 * DAY,
  })
}
function userIdFromCookie(req) {
  const [id, exp, sig] = getCookie(req, 'session').split('.')
  if (!id || !exp || !sig) return null
  if (!safeEqual(sig, sign(`${id}.${exp}`))) return null
  if (Number(exp) < Date.now()) return null
  return id
}

/* ---------- database (connects lazily so it also works on serverless hosts) ---------- */
let connecting = null
function connectDb() {
  if (mongoose.connection.readyState === 1) return Promise.resolve()
  if (!connecting) {
    connecting = mongoose
      .connect(process.env.MONGO_URL, { dbName: 'ImgGen', serverSelectionTimeoutMS: 8000 })
      .catch((err) => {
        connecting = null
        throw err
      })
  }
  return connecting
}

const User =
  mongoose.models.User ||
  mongoose.model(
    'User',
    new mongoose.Schema(
      {
        username: { type: String, required: true, unique: true, lowercase: true, trim: true },
        salt: String,
        hash: String,
        genDay: String,
        genCount: { type: Number, default: 0 },
      },
      { timestamps: true },
    ),
  )

const Image =
  mongoose.models.Image ||
  mongoose.model(
    'Image',
    new mongoose.Schema(
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
        prompt: { type: String, required: true, trim: true, maxlength: 500 },
        style: String,
        ratio: String,
        seed: Number,
        url: { type: String, required: true },
        favorite: { type: Boolean, default: false },
        contentType: String,
        data: { type: Buffer, select: false },
      },
      { timestamps: true },
    ),
  )

/* ---------- public routes ---------- */
app.use('/api', (req, res, next) => {
  if (!SECRET) return res.status(500).json({ error: 'SESSION_SECRET is missing in the environment variables.' })
  next()
})

app.get('/api/config', (req, res) => res.json({ inviteRequired: !!INVITE }))

app.use('/api', async (req, res, next) => {
  try {
    await connectDb()
    next()
  } catch (err) {
    res.status(500).json({ error: 'Database connection failed: ' + err.message })
  }
})

const authLimit = limiter(10, 10 * 60 * 1000, 'Too many attempts. Try again in a few minutes.')

app.post(
  '/api/signup',
  authLimit,
  safe(async (req, res) => {
    const username = String(req.body.username || '')
      .trim()
      .toLowerCase()
    const password = String(req.body.password || '')
    if (!/^[a-z0-9_]{3,20}$/.test(username))
      return res.status(400).json({ error: 'Username must be 3–20 characters: letters, numbers or _' })
    if (password.length < 6 || password.length > 100)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' })
    if (INVITE && !safeEqual(req.body.invite || '', INVITE))
      return res.status(403).json({ error: 'Wrong invite code.' })
    if (await User.exists({ username })) return res.status(409).json({ error: 'That username is taken.' })

    const salt = crypto.randomBytes(16).toString('hex')
    const hash = (await scrypt(password, salt, 64)).toString('hex')
    let user
    try {
      user = await User.create({ username, salt, hash })
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: 'That username is taken.' })
      throw e
    }
    setSession(req, res, user._id)
    res.status(201).json({ ok: true })
  }),
)

app.post(
  '/api/login',
  authLimit,
  safe(async (req, res) => {
    const username = String(req.body.username || '')
      .trim()
      .toLowerCase()
    const password = String(req.body.password || '')
    const user = await User.findOne({ username })
    const hash = (await scrypt(password, user ? user.salt : '0'.repeat(32), 64)).toString('hex')
    if (!user || !safeEqual(hash, user.hash)) return res.status(401).json({ error: 'Wrong username or password.' })
    setSession(req, res, user._id)
    res.json({ ok: true })
  }),
)

app.post('/api/logout', (req, res) => {
  res.clearCookie('session', { httpOnly: true, sameSite: 'lax', secure: req.secure })
  res.json({ ok: true })
})

/* ---------- everything below needs a logged-in user ---------- */
app.use('/api', (req, res, next) => {
  const id = userIdFromCookie(req)
  if (!id) return res.status(401).json({ error: 'Login required' })
  req.userId = id
  next()
})

app.get(
  '/api/me',
  safe(async (req, res) => {
    const user = await User.findById(req.userId)
    if (!user) return res.status(401).json({ error: 'Please log in again.' })
    const used = user.genDay === todayStr() ? user.genCount : 0
    res.json({ username: user.username, remaining: Math.max(0, DAILY_LIMIT - used) })
  }),
)

app.post(
  '/api/generate',
  safe(async (req, res) => {
    const key = process.env.POLLINATIONS_API_KEY
    if (!key || key.includes('your_key'))
      return res.status(400).json({ error: 'POLLINATIONS_API_KEY is missing. Get a key at enter.pollinations.ai' })

    const user = await User.findById(req.userId)
    if (!user) return res.status(401).json({ error: 'Please log in again.' })
    const today = todayStr()
    const used = user.genDay === today ? user.genCount : 0
    if (used >= DAILY_LIMIT)
      return res.status(429).json({ error: `Daily limit reached (${DAILY_LIMIT} images). Come back tomorrow.` })

    const { prompt, fullPrompt, style, ratio } = req.body
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt is required' })
    const width = clamp(req.body.width, 256, 1536, 1024)
    const height = clamp(req.body.height, 256, 1536, 1024)
    const seed = clamp(req.body.seed, 0, 999999, Math.floor(Math.random() * 1e6))

    const apiUrl =
      `https://gen.pollinations.ai/image/${encodeURIComponent((fullPrompt || prompt).slice(0, 800))}` +
      `?width=${width}&height=${height}&seed=${seed}&nologo=true`

    const r = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(120000),
    })
    if (!r.ok) {
      const hint =
        r.status === 401 || r.status === 403
          ? 'API key is invalid or not allowed. Check POLLINATIONS_API_KEY.'
          : r.status === 402
            ? 'Not enough credits (Pollen) on the Pollinations account.'
            : r.status === 429
              ? 'Too many requests. Wait a minute and try again.'
              : 'Image service error.'
      return res.status(502).json({ error: `${hint} (status ${r.status})` })
    }
    const type = r.headers.get('content-type') || ''
    if (!type.startsWith('image/')) return res.status(502).json({ error: 'Image service did not return an image.' })

    const doc = await Image.create({
      user: req.userId,
      prompt: prompt.trim(),
      style,
      ratio,
      seed,
      url: 'pending',
      contentType: type,
      data: Buffer.from(await r.arrayBuffer()),
    })
    doc.url = `/api/images/${doc._id}/file`
    await doc.save()
    await User.updateOne({ _id: user._id }, { genDay: today, genCount: used + 1 })

    const out = doc.toObject()
    delete out.data
    out.remaining = Math.max(0, DAILY_LIMIT - (used + 1))
    res.status(201).json(out)
  }),
)

app.get(
  '/api/images/:id/file',
  safe(async (req, res) => {
    const img = await Image.findOne({ _id: req.params.id, user: req.userId }).select('+data contentType')
    if (!img || !img.data) return res.status(404).send('Not found')
    res.set('Content-Type', img.contentType || 'image/jpeg')
    res.set('Cache-Control', 'private, max-age=31536000, immutable')
    res.send(img.data)
  }),
)

app.get(
  '/api/images',
  safe(async (req, res) => {
    const filter = { user: req.userId }
    if (req.query.q) filter.prompt = new RegExp(escapeRegex(req.query.q), 'i')
    if (req.query.fav === '1') filter.favorite = true
    res.json(await Image.find(filter).sort({ createdAt: -1 }).limit(100))
  }),
)

app.patch(
  '/api/images/:id/favorite',
  safe(async (req, res) => {
    const img = await Image.findOne({ _id: req.params.id, user: req.userId })
    if (!img) return res.status(404).json({ error: 'Not found' })
    img.favorite = !img.favorite
    await img.save()
    res.json(img)
  }),
)

app.delete(
  '/api/images/:id',
  safe(async (req, res) => {
    await Image.findOneAndDelete({ _id: req.params.id, user: req.userId })
    res.json({ ok: true })
  }),
)

// local development only (Vercel serves public/ itself and calls the exported app)
app.use(express.static(path.join(__dirname, 'public')))

if (require.main === module) {
  const PORT = process.env.PORT || 5000
  connectDb()
    .then(() => {
      console.log('MongoDB connected')
      app.listen(PORT, () => console.log(`Open http://localhost:${PORT}`))
    })
    .catch((err) => {
      console.error('MongoDB connection failed:', err.message)
      console.error('Check: 1) MONGO_URL is set  2) Atlas Network Access allows 0.0.0.0/0  3) username/password')
      process.exit(1)
    })
}

module.exports = app
