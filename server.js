const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.static(path.join(__dirname)));

app.get('/health', (req, res) => res.json({ status: 'ok', model: 'gemini-2.5-flash-lite' }));

app.post('/api/analyze', async (req, res) => {
  console.log('📸 Scan richiesto');

  const { base64, mimeType = 'image/jpeg' } = req.body;
  if (!base64) return res.status(400).json({ error: 'Nessuna immagine' });

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
    });

    const prompt = `Fashion expert italiano. Analizza l'outfit e identifica OGNI capo. Rispondi SOLO con JSON array:

[
  {
    "brand": "Nike|Zara|Gucci|Unknown",
    "modello": "nome modello",
    "tipo": "Sneakers|Jeans|...",
    "colore": "nero|bianco|...",
    "materiale": "Cotone 100%|Denim|...",
    "prezzo_stimato": 45,
    "confidence": 92,
    "emoji": "👟"
  }
]`;

    const result = await model.generateContent([prompt, { inlineData: { data: base64, mimeType } }]);
    let text = result.response.text().trim();
    if (text.startsWith('```')) text = text.replace(/```(json)?/g, '').trim();
    const items = JSON.parse(text);

    return res.json({ items: Array.isArray(items) ? items : [items] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Riprova tra 5 secondi.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 LariantAI Livello 1+2 | Porta ${PORT}`));
