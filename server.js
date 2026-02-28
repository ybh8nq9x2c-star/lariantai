const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
app.use(express.json({ limit: '25mb' }));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.static(path.join(__dirname)));

app.get('/health', (req, res) => res.json({ status: 'ok', model: 'gemini-2.5-flash' }));

app.post('/api/analyze', async (req, res) => {
  console.log('📸 Analisi richiesta');

  const { base64, mimeType = 'image/jpeg' } = req.body;
  if (!base64) return res.status(400).json({ error: 'Nessuna immagine' });

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",   // ← Cambiato: +30-40% precisione rispetto al lite
        generationConfig: { 
          responseMimeType: "application/json",
          temperature: 0.1          // Bassa = risposte più precise e stabili
        }
      });

      const prompt = `Sei un fashion expert italiano di alto livello. Analizza l'outfit nella foto e identifica OGNI capo separatamente con massima precisione.

Rispondi **SOLO** con un array JSON valido in questo formato esatto:

[
  {
    "brand": "Nike|Zara|Gucci|Adidas|Unknown",
    "modello": "nome modello esatto o descrizione precisa",
    "tipo": "Sneakers|Jeans|Felpa|Camicia|Giacca",
    "colore": "nero|blu navy|rosso",
    "emoji": "👟",
    "confidence": 95
  }
]

Esempi reali:
[
  {"brand":"Nike","modello":"Air Force 1 '07","tipo":"Sneakers","colore":"bianco","emoji":"👟","confidence":92},
  {"brand":"Zara","modello":"Jeans skinny vita alta","tipo":"Jeans","colore":"blu scuro","emoji":"👖","confidence":88}
]

Riconosci brand, modello e colore quando possibile.`;

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
      if ((err.status === 503 || err.message.includes('503')) && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, attempt * 2000));
        continue;
      }
      console.error(err);
      break;
    }
  }

  res.status(503).json({ error: 'Google AI saturo. Riprova tra 15 secondi.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 LariantAI su gemini-2.5-flash | Porta ${PORT}`));
