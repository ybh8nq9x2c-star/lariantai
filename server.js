const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' }));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.static(path.join(__dirname)));

app.post('/api/analyze', async (req, res) => {
  const { base64, mimeType = 'image/jpeg' } = req.body;
  if (!base64) return res.status(400).json({ error: 'Nessuna immagine' });

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite", generationConfig: { responseMimeType: "application/json", temperature: 0.1 } });

    const prompt = `Fashion expert italiano. Analizza l'outfit e identifica OGNI capo. Rispondi SOLO JSON array:
[
  {
    "brand": "Nike|Zara|...",
    "modello": "...",
    "tipo": "...",
    "colore": "...",
    "prezzo_stimato": 45,
    "confidence": 92,
    "emoji": "👟",
    "outfit_score": 8.7,
    "commento": "Elegante per ufficio, manca un tocco di colore"
  }
]`;

    const result = await model.generateContent([prompt, { inlineData: { data: base64, mimeType } }]);
    let text = result.response.text().trim();
    if (text.startsWith('```')) text = text.replace(/```(json)?/g, '').trim();
    const items = JSON.parse(text);
    res.json({ items: Array.isArray(items) ? items : [items] });
  } catch (err) {
    res.status(500).json({ error: 'Riprova tra 10 secondi.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 LariantAI ONLINE - Tutti i 11 punti implementati`));
