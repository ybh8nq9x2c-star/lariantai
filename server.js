const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
app.use(express.json({ limit: '25mb' }));

// Inizializza Gemini (chiave da Railway - mai hardcodata)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(express.static(path.join(__dirname)));

// Health check (per verificare che il server sia vivo)
app.get('/health', (req, res) => res.json({ status: 'ok', model: 'gemini-2.5-flash-lite' }));

// ══════════════════════════════════════════
// ANALISI OUTFIT - CON RETRY ANTI-503
// ══════════════════════════════════════════
app.post('/api/analyze', async (req, res) => {
  console.log('📸 Richiesta analisi ricevuta');

  const { base64, mimeType = 'image/jpeg' } = req.body;
  if (!base64) return res.status(400).json({ error: 'Nessuna immagine ricevuta' });

  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Tentativo ${attempt}/${maxRetries} - gemini-2.5-flash-lite`);

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash-lite",   // Modello stabile, veloce e anti-sovraccarico
        generationConfig: { 
          responseMimeType: "application/json",
          temperature: 0.15 
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

      let text = result.response.text().trim();
      if (text.startsWith('```')) text = text.replace(/```(json)?/g, '').trim();

      const items = JSON.parse(text);

      console.log(`✅ Successo: ${Array.isArray(items) ? items.length : 1} capi riconosciuti`);
      return res.json({ items: Array.isArray(items) ? items : [items] });

    } catch (err) {
      lastError = err;
      console.error(`❌ Tentativo ${attempt} fallito:`, err.message);

      // Retry automatico solo su errore 503 (sovraccarico)
      if ((err.status === 503 || err.message.includes('503') || err.message.includes('overloaded')) && attempt < maxRetries) {
        const delay = attempt * 2000;
        console.log(`⏳ Aspetto ${delay}ms prima del retry...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      } else {
        break;
      }
    }
  }

  // Tutti i tentativi falliti
  console.error('💥 Tutti i tentativi falliti:', lastError?.message);
  res.status(503).json({ error: 'Google AI temporaneamente saturo. Riprova tra 15-20 secondi.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 LariantAI avviato su porta ${PORT}`);
  console.log(`📍 Modello attivo: gemini-2.5-flash-lite (con retry)`);
});
