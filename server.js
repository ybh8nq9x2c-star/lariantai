const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const rateLimit = require('express-rate-limit');
const path = require('path');
const axios = require('axios');

const app = express();
app.set('trust proxy', 1); // importante dietro proxy (Railway)

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// 🔑 Controllo API Key
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY mancante! Aggiungila in Railway → Variables');
  process.exit(1);
}
if (!process.env.SERPAPI_KEY) {
  console.warn('⚠️ SERPAPI_KEY mancante. I link migliori offerte useranno la ricerca Google generica.');
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

// ──────────────────────────────────────────────────────────────
// Helper: normalizza stringhe
function norm(str) {
  return (str || '').toString().trim();
}

// Helper: costruisce query testuale per shopping partendo dal capo
function buildShoppingQuery(item) {
  const parts = [
    norm(item.brand),
    norm(item.modello),
    norm(item.tipo),
    norm(item.colore)
  ].filter(Boolean);
  return parts.join(' ').trim();
}

// Helper: trova migliore offerta con SerpAPI (Google Shopping)
async function findBestOffer(item) {
  if (!process.env.SERPAPI_KEY) return null;

  const query = buildShoppingQuery(item);
  if (!query) return null;

  try {
    const params = {
      api_key: process.env.SERPAPI_KEY,
      engine: 'google_shopping',
      q: query,
      gl: 'it',
      hl: 'it'
    };

    const resp = await axios.get('https://serpapi.com/search.json', { params });

    const results = resp.data.shopping_results || [];
    if (!results.length) return null;

    // Se possibile, filtra per colore nel titolo
    const color = norm(item.colore).toLowerCase();
    let filtered = results;

    if (color) {
      filtered = results.filter(r =>
        (r.title || '').toLowerCase().includes(color)
      );
      if (!filtered.length) {
        filtered = results;
      }
    }

    // Scegli il più economico
    let best = null;
    for (const r of filtered) {
      const priceStr = (r.price || '').replace(/[^\d,\.]/g, '').replace(',', '.');
      const price = parseFloat(priceStr);
      if (!isNaN(price)) {
        if (!best || price < best.price) {
          best = {
            price,
            seller: r.source || r.store || null,
            link: r.link || r.product_link || r.serpapi_product_api || null,
            title: r.title || null
          };
        }
      }
    }

    return best;
  } catch (err) {
    console.error('❌ Errore SerpAPI:', err.message);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// ✅ ANALYZE ENDPOINT
app.post('/api/analyze', analyzeLimiter, async (req, res) => {
  console.log(`📸 Analyze da ${req.ip}`);

  const { base64, mimeType = 'image/jpeg' } = req.body;

  if (!base64 || typeof base64 !== 'string') {
    return res.status(400).json({ error: 'Manca immagine (base64)' });
  }

  // Controllo lunghezza base64 (immagini troppo grandi)
  if (base64.length > 10 * 1024 * 1024) {
    return res.status(413).json({ error: 'Immagine troppo grande. Riducila e riprova.' });
  }

  const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedMime.includes(mimeType)) {
    return res.status(400).json({ error: `Formato non supportato (${mimeType}). Usa JPEG/PNG/WebP.` });
  }

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1
      }
    });

    const prompt = `Fashion expert italiano. Identifica OGNI capo nell'outfit. 
Rispondi SOLO come JSON array, senza testo extra, nello schema:

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

    let text = (result.response.text() || '').trim();
    if (text.startsWith('```')) {
      text = text.replace(/```(json)?/g, '').trim();
    }

    let items;
    try {
      items = JSON.parse(text);
    } catch (parseErr) {
      console.error('❌ JSON.parse Gemini fallito. Risposta grezza:', text.slice(0, 400));
      return res.status(502).json({ error: 'Risposta AI non valida. Riprova.' });
    }

    if (!Array.isArray(items)) {
      items = [items];
    }

    // Limita a massimo 10 capi per sicurezza
    items = items.slice(0, 10);

    // Arricchisci ogni item con la migliore offerta (fino a 5 per non saturare SerpAPI)
    const maxOffers = 5;
    const enriched = await Promise.all(
      items.map(async (item, index) => {
        if (index >= maxOffers) {
          return { ...item, best_offer_url: null, best_price: null, best_seller: null };
        }

        const offer = await findBestOffer(item);
        return {
          ...item,
          best_offer_url: offer?.link || null,
          best_price: offer?.price || null,
          best_seller: offer?.seller || null
        };
      })
    );

    res.json({ items: enriched });
  } catch (err) {
    console.error('❌ Gemini error:', err.message);

    if (err.status === 429 || err.message?.toLowerCase().includes('quota')) {
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
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 LariantAI su porta ${PORT}`);
  console.log(`🔗 Health: http://localhost:${PORT}/health`);
});
