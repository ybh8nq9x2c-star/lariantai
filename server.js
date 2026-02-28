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
  console.log('📸 Scan richiesto - size:', req.headers['content-length']);

  const { base64, mimeType = 'image/jpeg' } = req.body;
  if (!base64) return res.status(400).json({ error: 'Nessuna immagine' });

  const maxRetries = 2; // meno retry = più veloce
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash-lite",   // ← IL PIÙ VELOCE
        generationConfig: { 
          responseMimeType: "application/json",
          temperature: 0.1 
        }
      });

      const prompt = `Fashion expert IT. Identifica OGNI capo. Rispondi SOLO JSON array:
[{"brand":"Nike|Zara|...","modello":"...","tipo":"Sneakers|Jeans|...","colore":"nero|bianco|...","emoji":"👟"}]`;

      const result = await model.generateContent([
        prompt,
        { inlineData: { data: base64, mimeType } }
      ]);

      let text = result.response.text().trim();
      if (text.startsWith('```')) text = text.replace(/```(json)?/g, '').trim();
      const items = JSON.parse(text);
      return res.json({ items: Array.isArray(items) ? items : [items] });

    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
    }
  }
  res.status(500).json({ error: 'Riprova.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 LariantAI ULTRA-FAST | gemini-2.5-flash-lite | 768px`));
