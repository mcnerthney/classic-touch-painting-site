const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const RECIPIENT_EMAIL = 'reyman@fosterpaint.com';
const MIN_FORM_FILL_MS = 3000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_PER_IP = 5;
const requestsByIp = new Map();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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
    SMTP_PASS
  } = process.env;

  if (!SMTP_USER || !SMTP_PASS) {
    return null;
  }

  const portNumber = Number(SMTP_PORT);
  if (!Number.isFinite(portNumber) || portNumber <= 0) {
    return null;
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: portNumber,
    secure: portNumber === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
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
  if (!transporter) {
    return res.status(503).json({
      ok: false,
      message: 'Email service is not configured yet. Please call or email directly.'
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

app.listen(PORT, () => {
  console.log(`Classic Touch Painting site running at http://localhost:${PORT}`);
});
