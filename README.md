# Classic Touch Painting Site

Simple one-page Node.js + Express website for Classic Touch Painting.

## Requirements

- Node.js 18+ (or newer LTS)
- npm

## Local Development

1. Clone the repo:
   ```bash
   git clone https://github.com/mcnerthney/classic-touch-painting-site.git
   cd classic-touch-painting-site
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open:
   - http://localhost:3000

## Project Structure

```text
.
├── public/
│   ├── index.html
│   └── style.css
├── server.js
├── package.json
└── package-lock.json
```

## Deployment

This app serves static files using Express and reads `PORT` from environment variables.

### Option 1: Render (easy)

1. Create a new **Web Service** from this repo.
2. Configure:
   - Build command: `npm install`
   - Start command: `npm start`
3. Deploy.

### Option 2: Railway

1. Create a new project from this repo.
2. Railway will detect Node.js automatically.
3. Ensure start command is:
   - `npm start`
4. Deploy.

### Option 3: VPS (Ubuntu)

1. Install Node.js + npm.
2. Pull project and install deps:
   ```bash
   npm install
   ```
3. Run app with a process manager (PM2):
   ```bash
   npm install -g pm2
   pm2 start server.js --name classic-touch-painting-site
   pm2 save
   ```
4. (Recommended) Put Nginx in front as reverse proxy to port `3000`.

## Environment Variables

- `PORT` (optional): server port (default is `3000`)

## Contact Form Email Setup (Fastmail)

The contact form posts to `/api/contact` and sends email via SMTP.

Use a local `.env` file (not committed):

```bash
cp .env.example .env
```

Set these values:

- `SMTP_USER`: your full Fastmail email address (username is the email)
- `SMTP_PASS`: your Fastmail app password

Optional (defaults are already Fastmail-safe in `server.js`):

- `SMTP_HOST=smtp.fastmail.com`
- `SMTP_PORT=465`

Then start the app:

```bash
npm start
```

