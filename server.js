require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const RECIPIENT_EMAIL = 'reyman@fosterpaint.com';
const MIN_FORM_FILL_MS = 3000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_PER_IP = 5;
const requestsByIp = new Map();
const STAGING_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.STAGING_ENABLED || '').toLowerCase()
);
const STAGING_PASSWORD = process.env.STAGING_PASSWORD || '';
const STAGING_SESSION_SECRET = process.env.STAGING_SESSION_SECRET || STAGING_PASSWORD;
const STAGING_COOKIE_NAME = 'ctp_staging_auth';
const STAGING_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function renderStagingLoginPage(errorMessage = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Staging Access | Classic Touch Painting</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: Georgia, 'Times New Roman', serif;
      background: linear-gradient(160deg, #e9dcb8, #f6ebcf);
      color: #3b2a1a;
    }
    .card {
      width: min(92vw, 420px);
      background: #fff8e8;
      border: 1px solid #ddcda0;
      border-left: 6px solid #6f1f2b;
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 8px 24px rgba(59, 42, 26, 0.12);
    }
    h1 {
      margin: 0 0 10px;
      font-size: 1.5rem;
      color: #2f3b2a;
    }
    p {
      margin: 0 0 14px;
      line-height: 1.45;
      color: #6b5a45;
    }
    label {
      display: block;
      font-weight: bold;
      margin-bottom: 8px;
    }
    input[type="password"] {
      width: 100%;
      padding: 10px;
      border-radius: 6px;
      border: 1px solid #ddcda0;
      box-sizing: border-box;
      margin-top: 6px;
      font: inherit;
    }
    button {
      margin-top: 14px;
      width: 100%;
      border: 0;
      border-radius: 999px;
      background: #2f3b2a;
      color: #fff8e8;
      padding: 11px;
      font-weight: bold;
      cursor: pointer;
    }
    .error {
      margin-top: 10px;
      color: #6f1f2b;
      font-weight: bold;
      min-height: 1.2em;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>Staging Access</h1>
    <p>This staging site is restricted. Enter the access password.</p>
    <form method="post" action="/staging-login">
      <label>
        Password
        <input type="password" name="password" required autocomplete="current-password" />
      </label>
      <input type="hidden" name="next" value="/" />
      <button type="submit">Enter Staging</button>
      <p class="error">${errorMessage}</p>
    </form>
  </main>
</body>
</html>`;
}

function parseCookies(cookieHeader = '') {
  const cookiePairs = cookieHeader.split(';').map((part) => part.trim());
  const result = {};

  cookiePairs.forEach((pair) => {
    if (!pair) {
      return;
    }

    const separatorIndex = pair.indexOf('=');
    if (separatorIndex === -1) {
      return;
    }

    const key = pair.slice(0, separatorIndex);
    const value = pair.slice(separatorIndex + 1);
    result[key] = decodeURIComponent(value);
  });

  return result;
}

function getStagingToken() {
  if (!STAGING_PASSWORD || !STAGING_SESSION_SECRET) {
    return '';
  }

  return crypto
    .createHash('sha256')
    .update(`${STAGING_PASSWORD}:${STAGING_SESSION_SECRET}`)
    .digest('hex');
}

function safeEqualText(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));

  if (first.length !== second.length) {
    return false;
  }

  return crypto.timingSafeEqual(first, second);
}

function isStagingAuthenticated(req) {
  const expectedToken = getStagingToken();
  if (!expectedToken) {
    return false;
  }

  const cookies = parseCookies(req.headers.cookie || '');
  return safeEqualText(cookies[STAGING_COOKIE_NAME] || '', expectedToken);
}

function isSafeRedirectPath(nextPath) {
  return typeof nextPath === 'string' && nextPath.startsWith('/') && !nextPath.startsWith('//');
}

app.get('/staging-login', (req, res) => {
  if (!STAGING_ENABLED) {
    return res.redirect('/');
  }

  if (isStagingAuthenticated(req)) {
    const nextPath = isSafeRedirectPath(req.query.next) ? req.query.next : '/';
    return res.redirect(nextPath);
  }

  return res.status(200).send(renderStagingLoginPage(''));
});

app.post('/staging-login', (req, res) => {
  if (!STAGING_ENABLED) {
    return res.redirect('/');
  }

  if (!STAGING_PASSWORD) {
    return res.status(503).send(renderStagingLoginPage('Staging is misconfigured: password is missing.'));
  }

  const submittedPassword = String(req.body.password || '');
  const nextPath = isSafeRedirectPath(req.body.next) ? req.body.next : '/';

  if (!safeEqualText(submittedPassword, STAGING_PASSWORD)) {
    return res.status(401).send(renderStagingLoginPage('Incorrect password.'));
  }

  const authToken = getStagingToken();
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const secureAttribute = isSecure ? '; Secure' : '';

  res.setHeader(
    'Set-Cookie',
    `${STAGING_COOKIE_NAME}=${encodeURIComponent(authToken)}; Path=/; Max-Age=${STAGING_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secureAttribute}`
  );

  return res.redirect(nextPath);
});

app.post('/staging-logout', (req, res) => {
  res.setHeader(
    'Set-Cookie',
    `${STAGING_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
  );
  return res.redirect('/staging-login');
});

app.use((req, res, next) => {
  if (!STAGING_ENABLED) {
    return next();
  }

  if (!STAGING_PASSWORD) {
    return res
      .status(503)
      .send(renderStagingLoginPage('Staging is misconfigured: set STAGING_PASSWORD.'));
  }

  if (
    req.path === '/staging-login' ||
    req.path === '/staging-logout' ||
    req.path === '/favicon.ico'
  ) {
    return next();
  }

  if (isStagingAuthenticated(req)) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ ok: false, message: 'Staging authentication required.' });
  }

  const nextPath = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/staging-login?next=${nextPath}`);
});

app.use(express.static(path.join(__dirname, 'public')));

function isLikelySpam({ honeypot, formStartedAt, message, name }) {
  if (honeypot && honeypot.trim() !== '') {
    return true;
  }

  const startedAt = Number(formStartedAt);
  if (!Number.isFinite(startedAt) || Date.now() - startedAt < MIN_FORM_FILL_MS) {
    return true;
  }

  const longText = `${name || ''} ${message || ''}`;
  const urlMatches = longText.match(/https?:\/\//gi);
  if (urlMatches && urlMatches.length > 2) {
    return true;
  }

  return false;
}

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = requestsByIp.get(ip) || [];
  const recent = timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX_PER_IP) {
    requestsByIp.set(ip, recent);
    return true;
  }

  recent.push(now);
  requestsByIp.set(ip, recent);
  return false;
}

function createTransporter() {
  const {
    SMTP_HOST = 'smtp.fastmail.com',
    SMTP_PORT = '465',
    SMTP_USER,
    SMTP_PASSWORD
  } = process.env;

  if (!SMTP_USER || !SMTP_PASSWORD) {
    return null;
  }

  //const portNumber = Number(SMTP_PORT);
  //if (!Number.isFinite(portNumber) || portNumber <= 0) {
  // return null;
  //}
  return nodemailer.createTransport({
    host: 'smtp.fastmail.com',
    port: 587,
    secure: false, // Must be false for port 587; upgrading via STARTTLS is handled automatically
    auth: {
      user: process.env.SMTP_USER,     // Your full Fastmail address
      pass: process.env.SMTP_PASSWORD, // Your Fastmail App Password
    },
    requireTLS: true
  });
}


app.post('/api/contact', async (req, res) => {
  const { name, email, phone, message, honeypot, formStartedAt } = req.body;
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

  if (isRateLimited(clientIp)) {
    return res.status(429).json({
      ok: false,
      message: 'Too many requests. Please wait a few minutes and try again.'
    });
  }

  if (isLikelySpam({ honeypot, formStartedAt, message, name })) {
    return res.status(400).json({
      ok: false,
      message: 'Submission rejected by spam filter.'
    });
  }

  if (!name || !email || !message) {
    return res.status(400).json({
      ok: false,
      message: 'Name, email, and message are required.'
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      ok: false,
      message: 'Please provide a valid email address.'
    });
  }

  const transporter = createTransporter();
  await transporter.verify().catch((err) => {

    return res.status(503).json({
      ok: false,
      message: err.message || 'Email service is not configured properly.'
    });
  }
    

    const safeName = String(name).trim();
  const safeEmail = String(email).trim();
  const safePhone = String(phone || '').trim();
  const safeMessage = String(message).trim();

  try {
    await transporter.sendMail({
      from: `Classic Touch Site <${process.env.SMTP_USER}>`,
      replyTo: safeEmail,
      to: RECIPIENT_EMAIL,
      subject: `New Contact Form Message from ${safeName}`,
      text:
        `Name: ${safeName}\n` +
        `Email: ${safeEmail}\n` +
        `Phone: ${safePhone || 'Not provided'}\n\n` +
        `${safeMessage}`
    });

    return res.json({ ok: true, message: 'Thanks! Your message has been sent.' });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'Unable to send message right now. Please try again later.'
    });
  }
});

const requestedPort = Number.parseInt(process.env.PORT || '3000', 10);
const portToUse = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 3000;

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Classic Touch Painting site running at http://localhost:${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`Port ${port} is busy. Trying ${nextPort} instead.`);
      startServer(nextPort);
      return;
    }

    throw error;
  });
}

startServer(portToUse);
