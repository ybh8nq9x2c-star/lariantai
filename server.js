const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

if (!process.env.GEMINI_API_KEY) {
  console.error('❌  GEMINI_API_KEY mancante nel .env');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Rate limiting globale
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppe richieste. Riprova tra qualche minuto.' }
});

// Rate limiting specifico per /api/analyze (5 scan/min per IP)
const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Hai eseguito troppe scansioni. Aspetta 1 minuto.' },
  keyGenerator: (req) => req.ip
});

app.use(globalLimiter);
app.use(express.static(path.join(__dirname)));

app.get('/health', (req, res) => res.json({ status: 'ok', model: 'gemini-2.5-flash-lite' }));

app.post('/api/analyze', analyzeLimiter, async (req, res) => {
  console.log(`📸 Scan richiesto da ${req.ip} – ${new Date().toISOString()}`);

  const { base64, mimeType = 'image/jpeg' } = req.body;
  if (!base64) return res.status(400).json({ error: 'Nessuna immagine fornita.' });

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
    });

    const prompt = `Fashion expert italiano. Analizza l'outfit e identifica OGNI capo visibile. Rispondi SOLO con un JSON array:

[
  {
    "brand": "Nike|Zara|Gucci|Unknown",
    "modello": "nome modello specifico",
    "tipo": "Sneakers|Jeans|T-Shirt|Giacca|...",
    "colore": "nero|bianco|...",
    "materiale": "Cotone 100%|Denim|Pelle|...",
    "prezzo_st
