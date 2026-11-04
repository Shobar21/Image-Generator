# AIGenerateImage

A text-to-image web app. Describe a scene, pick a style and shape, and the app generates an image, saves it to your personal gallery, and lets you favorite, download, reuse or delete it.

Built with Node.js, Express and MongoDB Atlas. Images are generated through the [Pollinations](https://pollinations.ai) API.

## Features

- **Text to image** with 8 styles (Photo, Anime, Oil paint, Watercolor, Pixel art, 3D render, Cyberpunk, or none)
- **3 shapes:** Square, Portrait, Landscape
- **Seed control:** reuse a seed with the same prompt to get the same image
- **"Give me an idea"** button for random prompts
- **My images** page with search, favorites filter, download, reuse and delete
- **Full-size viewer:** click any image to open it, with previous/next arrows and keyboard support
- **User accounts:** sign up and log in, and every user sees only their own images
- **Invite code** to control who can create an account
- **Daily limit** per user to protect your API credits
- Images are stored in MongoDB, so they survive restarts and work on serverless hosting
- Responsive dark UI with an initials avatar menu

## Tech stack

| Part | Tools |
|---|---|
| Server | Node.js 18+, Express |
| Database | MongoDB Atlas, Mongoose |
| Image generation | Pollinations API |
| Frontend | HTML, CSS, vanilla JavaScript (no build step) |
| Auth | Signed cookie sessions, passwords hashed with scrypt |
| Hosting | Vercel (also works on Render or any Node host) |

## Project structure

```
AIGenerateImage/
├── api/
│   └── index.js        # entry point for Vercel
├── public/
│   ├── index.html      # Create page
│   ├── images.html     # My images page
│   ├── login.html      # Login / sign up page
│   ├── style.css
│   └── app.js
├── server.js           # Express app and API routes
├── vercel.json
├── package.json
└── .env                # your secrets (never commit this)
```

## Getting started

### 1. Requirements

- [Node.js](https://nodejs.org) 18 or newer
- A free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster
- A Pollinations API key from [enter.pollinations.ai](https://enter.pollinations.ai)

### 2. Install

```bash
git clone https://github.com/Shobar21/Image-Generator.git
cd Image-Generator
npm install
```

### 3. Configure

Create a file named `.env` in the project root:

```
MONGO_URL=mongodb+srv://USERNAME:PASSWORD@cluster0.xxxxx.mongodb.net/
POLLINATIONS_API_KEY=your_pollinations_key
SESSION_SECRET=a_long_random_string
INVITE_CODE=choose_a_secret_code
DAILY_LIMIT=15
PORT=5000
```

| Variable | Required | Description |
|---|---|---|
| `MONGO_URL` | Yes | MongoDB Atlas connection string (database name is set in code) |
| `POLLINATIONS_API_KEY` | Yes | API key used to generate images |
| `SESSION_SECRET` | Yes | Secret used to sign login cookies |
| `INVITE_CODE` | No | If set, sign up requires this code |
| `DAILY_LIMIT` | No | Images per user per day (default 15) |
| `PORT` | No | Local port (default 5000) |

Generate a good `SESSION_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

In MongoDB Atlas, open **Network Access** and allow `0.0.0.0/0` so the app can connect.

### 4. Run

```bash
npm start
```

Open http://localhost:5000, choose **Create an account**, and start generating.

## Deploying to Vercel

1. Push the project to GitHub (make sure `.env` is in `.gitignore`).
2. On [vercel.com](https://vercel.com), choose **Add New → Project** and import the repository.
3. Add the same environment variables as in your `.env` (except `PORT`).
4. Click **Deploy**.

`vercel.json` routes `/api/*` to the Express app and allows long-running requests, because image generation can take 10–40 seconds. Files in `public/` are served directly by Vercel.

## API overview

| Method | Route | Description |
|---|---|---|
| POST | `/api/signup` | Create an account |
| POST | `/api/login` | Log in |
| POST | `/api/logout` | Log out |
| GET | `/api/me` | Current user and images left today |
| POST | `/api/generate` | Generate and save an image |
| GET | `/api/images` | List your images (`?q=` search, `?fav=1` favorites) |
| GET | `/api/images/:id/file` | The image itself |
| PATCH | `/api/images/:id/favorite` | Toggle favorite |
| DELETE | `/api/images/:id` | Delete an image |

## Security notes

- Never commit your `.env` file or share your API keys.
- Passwords are stored as salted scrypt hashes, never as plain text.
- Login cookies are `HttpOnly` and signed.
- Set an `INVITE_CODE` and a sensible `DAILY_LIMIT`, otherwise anyone who finds the site can use your API credits.
- There is no password reset. If a user forgets their password, remove that user from the `users` collection in Atlas.

## Limitations

- Image generation depends on the Pollinations service and your credits there.
- The rate limiter on login and generation is in memory, so on serverless hosting it is approximate. The daily limit per user is stored in the database and is the real safeguard.
- Atlas free tier has 512 MB of storage, which is plenty for a personal project but not unlimited.

