const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();

// 🔥 LIMITE AUMENTATO A 50MB (risolve l'errore aborted)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.static(path.join(__dirname)));

app.get('/health', (req, res) => res.json({ status: 'ok', model: 'gemini-2.5-flash' }));

app.post('/api/analyze', async (req, res) => {
  console.log('📸 Richiesta analisi - body size:', req.headers['content-length']);

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

      const prompt = `Sei un fashion expert italiano. Analizza l'outfit e identifica OGNI capo.

Rispondi **SOLO** con un array JSON in questo formato:

[
  {
    "brand": "Nike|Zara|Gucci|Unknown",
    "modello": "nome modello",
    "tipo": "Sneakers|Jeans|...",
    "colore": "nero|bianco|...",
    "emoji": "👟"
  }
]`;

      const result = await model.generateContent([
        prompt,
        { inlineData: { data: base64, mimeType } }
      ]);

      let text = result.response.text().trim();
      if (text.startsWith('```')) text = text.replace(/```(json)?/g, '').trim();

      const items = JSON.parse(text);
      return res.json({ items: Array.isArray(items) ? items : [items] });

    } catch (err) {
      if ((err.status === 503 || err.message.includes('503')) && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, attempt * 2000));
        continue;
      }
      console.error(err);
      break;
    }
  }

  res.status(500).json({ error: 'Errore analisi. Riprova.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 LariantAI LIVE | Limite body 50MB | Porta ${PORT}`));
