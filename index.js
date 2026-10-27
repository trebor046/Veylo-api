const express = require("express");
const cors = require("cors");
const youtubedl = require("youtube-dl-exec");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 8080;

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
      { key: "mp3", label: "MP3", type: "audio", quality: "Áudio MP3" },
      { key: "webm", label: "WEBM", type: "video", quality: "Disponível" },
      { key: "m4a", label: "M4A", type: "audio", quality: "Áudio M4A" },
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

    const host = req.get("host");
    const protocol = req.protocol;
    const baseUrl = `${protocol}://${host}`;

    const downloadUrl = `${baseUrl}/download?url=${encodeURIComponent(url)}&format=${encodeURIComponent(format || "mp4")}`;

    res.json({ downloadUrl });
  } catch (error) {
    console.error("convert error:", error.message);
    res.status(500).json({ error: "Não foi possível gerar o link de download" });
  }
});

app.get("/download", async (req, res) => {
  try {
    const { url, format } = req.query;

    if (!url) {
      return res.status(400).send("URL necessária");
    }

    const fmt = format || "mp4";

    let info;
    try {
      info = await youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCallHome: true,
      });
    } catch (e) {
      info = { title: "veylo-download" };
    }

    const safeTitle = (info.title || "veylo-download")
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "_")
      .substring(0, 80);

    if (fmt === "mp3") {
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.mp3"`);
      const args = ["-x", "--audio-format", "mp3", "-o", "-", url];
      const proc = spawn("yt-dlp", args);
      proc.stdout.pipe(res);
      proc.stderr.on("data", () => {});
      proc.on("error", () => res.end());
      return;
    }

    if (fmt === "m4a") {
      res.setHeader("Content-Type", "audio/mp4");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.m4a"`);
      const args = ["-f", "bestaudio[ext=m4a]/bestaudio", "-o", "-", url];
      const proc = spawn("yt-dlp", args);
      proc.stdout.pipe(res);
      proc.stderr.on("data", () => {});
      proc.on("error", () => res.end());
      return;
    }

    if (fmt === "webm") {
      res.setHeader("Content-Type", "video/webm");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.webm"`);
      const args = ["-f", "bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best", "-o", "-", url];
      const proc = spawn("yt-dlp", args);
      proc.stdout.pipe(res);
      proc.stderr.on("data", () => {});
      proc.on("error", () => res.end());
      return;
    }

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.mp4"`);
    const args = ["-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best", "-o", "-", url];
    const proc = spawn("yt-dlp", args);
    proc.stdout.pipe(res);
    proc.stderr.on("data", () => {});
    proc.on("error", () => res.end());
  } catch (error) {
    console.error("download error:", error.message);
    res.status(500).send("Não foi possível baixar este arquivo");
  }
});

app.listen(PORT, () => {
  console.log(`veylo-api rodando na porta ${PORT}`);
});
