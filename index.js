const express = require("express");
const cors = require("cors");
const youtubedl = require("youtube-dl-exec");

const app = express();
const PORT = process.process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "veylo-api" });
});

app.post("/extract", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL necessária" });
    }

    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      preferFreeFormats: true,
    });

    const formats = [
      { key: "mp4", label: "MP4", type: "video", quality: "Melhor disponível" },
      { key: "mp3", label: "MP3", type: "audio", quality: "Áudio" },
      { key: "webm", label: "WEBM", type: "video", quality: "Disponível" },
      { key: "m4a", label: "M4A", type: "audio", quality: "M4A" },
    ];

    res.json({ formats, title: info.title });
  } catch (error) {
    console.error("extract error:", error.message);
    res.status(500).json({ error: "Não foi possível extrair os formatos deste link" });
  }
});

app.post("/convert", async (req, res) => {
  try {
    const { url, format } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL necessária" });
    }

    if (format === "mp3") {
      const output = await youtubedl(url, {
        extractAudio: true,
        audioFormat: "mp3",
        audioQuality: 0,
        noWarnings: true,
        noCallHome: true,
        dumpSingleJson: true,
      });
      // Para MVP simplificado, retorna URL direta via yt-dlp
      // Na prática vamos melhorar com streaming
      const info = await youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCallHome: true,
      });
      return res.json({ downloadUrl: info.webpage_url });
    }

    // Para outros formatos, retorna página web como fallback temporário
    res.json({ downloadUrl: url });
  } catch (error) {
    console.error("convert error:", error.message);
    res.status(500).json({ error: "Não foi possível gerar o link de download" });
  }
});

app.listen(PORT, () => {
  console.log(`veylo-api rodando na porta ${PORT}`);
});
