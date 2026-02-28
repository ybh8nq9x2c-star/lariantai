const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();

// 🔥 Limiti alti + protezione SIGTERM / aborted
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.static(path.join(__dirname)));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', model: 'gemini-2.5-flash' }));

// ══════════════════════════════════════════
// ANALISI OUTFIT (con retry anti-503)
app.post('/api/analyze', async (req, res) => {
  console.log('📸 Richiesta ricevuta - size:', req.headers['content-length']);

  const { base64, mimeType = 'image/jpeg' } = req.body;
  if (!base64) return res.status(400).json({ error: 'Nessuna immagine' });

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: { 
          responseMimeType: "application/json",
          temperature: 0.1 
        }
      });

      const prompt = `Sei un fashion expert italiano. Analizza l'outfit nella foto e identifica OGNI capo separatamente.

Rispondi **SOLO** con un array JSON valido in questo formato esatto:

[
  {
    "brand": "Nike|Zara|Gucci|Adidas|Unknown",
    "modello": "nome modello esatto",
    "tipo": "Sneakers|Jeans|Felpa|Camicia",
    "colore": "nero|bianco|rosso|blu navy|grigio",
    "emoji": "👟"
  }
]

Riconosci sempre il colore quando visibile.`;

      const result = await model.generateContent([
        prompt,
        { inlineData: { data: base64, mimeType } }
      ]);

      let text = result.response.text().trim();
      if (text.startsWith('```')) text = text.replace(/```(json)?/g, '').trim();

      const items = JSON.parse(text);
      console.log(`✅ ${Array.isArray(items) ? items.length : 1} capi riconosciuti`);
      return res.json({ items: Array.isArray(items) ? items : [items] });

    } catch (err) {
      console.error(`Tentativo ${attempt} fallito:`, err.message);
      if ((err.status === 503 || err.message.includes('503') || err.message.includes('overloaded')) && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, attempt * 2000));
        continue;
      }
      break;
    }
  }

  res.status(500).json({ error: 'Google AI temporaneamente saturo. Riprova tra 10 secondi.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 LariantAI LIVE su porta ${PORT}`);
  console.log(`📍 Modello: gemini-2.5-flash | Resize client-side attivo`);
});
