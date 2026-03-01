const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 🔑 Controllo API Key
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY mancante! Aggiungila in Railway → Variables');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Rate limiting globale (200 req/15min)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppe richieste. Riprova tra 15 minuti.' }
});

// Rate limiting ANALYZE (5 scan/min per IP)
const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Max 5 scansioni/minuto. Aspetta 1 minuto.' },
  keyGenerator: (req) => req.ip
});

app.use(globalLimiter);
app.use(express.static(path.join(__dirname)));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    model: 'gemini-2.5-flash-lite',
    rate_limit_remaining: req.rateLimitInfo?.remaining || 'N/A'
  });
});

// ✅ ANALYZE ENDPOINT
app.post('/api/analyze', analyzeLimiter, async (req, res) => {
  console.log(`📸 Analyze da ${req.ip}`);
  
  const { base64, mimeType = 'image/jpeg' } = req.body;
  if (!base64) {
    return res.status(400).json({ error: 'Manca immagine' });
  }

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      generationConfig: { 
        responseMimeType: 'application/json', 
        temperature: 0.1 
      }
    });

    const prompt = `Fashion expert italiano. Identifica OGNI capo nell'outfit. SOLO JSON array:

[
  {
    "brand": "Nike|Zara|Gucci|Unknown",
    "modello": "Air Force 1|...",
    "tipo": "Sneakers|Jeans|...",
    "colore": "nero|bianco|...",
    "materiale": "Cotone|Denim|...",
    "prezzo_stimato": 45,
    "confidence": 92,
    "emoji": "👟"
  }
]`;

    const result = await model.generateContent([
      prompt, 
      { inlineData: { data: base64, mimeType } }
    ]);

    let text = result.response.text().trim();
    if (text.startsWith('```')) {
      text = text.replace(/```(json)?/g, '').trim();
    }

    const items = JSON.parse(text);
    res.json({ items: Array.isArray(items) ? items : [items] });

  } catch (err) {
    console.error('❌ Gemini error:', err.message);
    
    if (err.status === 429 || err.message?.includes('quota')) {
      return res.status(429).json({ error: 'Quota Gemini esaurita. Riprova tra 5 min.' });
    }
    if (err.message?.includes('SAFETY')) {
      return res.status(400).json({ error: 'Immagine bloccata dal modello AI.' });
    }
    if (err instanceof SyntaxError) {
      return res.status(502).json({ error: 'Risposta AI non valida. Riprova.' });
    }
    res.status(500).json({ error: 'Servizio temporaneamente indisponibile.' });
  }
});  // ← CHIUSURA TRY-CATCH ✅

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 LariantAI su porta ${PORT}`);
  console.log(`🔗 Health: http://localhost:${PORT}/health`);
});
