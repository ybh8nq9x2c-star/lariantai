const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
app.use(express.json({ limit: '25mb' }));

// 🔥 La chiave arriva da Railway (mai nel codice)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.static(path.join(__dirname)));

app.post('/api/analyze', async (req, res) => {
  try {
    const { base64, mimeType = 'image/jpeg' } = req.body;
    if (!base64) return res.status(400).json({ error: 'Nessuna immagine' });

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: { 
        responseMimeType: "application/json",
        temperature: 0.1 
      }
    });

    const prompt = `Sei un fashion expert italiano. Analizza l'outfit nella foto e identifica OGNI capo separatamente.

Rispondi **SOLO** con un array JSON valido in questo formato esatto:

[
  {
    "brand": "Nike|Zara|Gucci|Unknown",
    "modello": "nome modello o descrizione precisa",
    "tipo": "Sneakers|Jeans|Felpa|Camicia",
    "emoji": "👟"
  }
]

Riconosci brand famosi quando possibile.`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64, mimeType } }
    ]);

    let text = (await result.response).text().trim();
    // Pulizia extra (a volte Gemini aggiunge ```json)
    if (text.startsWith('```')) text = text.replace(/```(json)?/g, '').trim();

    const items = JSON.parse(text);
    res.json({ items: Array.isArray(items) ? items : [items] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore analisi. Riprova con foto più chiara.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 LariantAI live su porta ${PORT}`));