const express = require("express");
const cors = require("cors");
const youtubedl = require("youtube-dl-exec");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// yt-dlp deve estar no PATH (o Dockerfile instala via pip) ou definido em YTDLP_BIN
const YTDLP_BIN = process.env.YTDLP_BIN || "yt-dlp";

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
    });
  } catch (e) {
    info = { title: "veylo-download" };
  }

  const safeTitle = (info.title || "veylo-download")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 80);

  // MP3 exige pós-processamento com ffmpeg (extrair/convert áudio) e o yt-dlp
  // não suporta pós-processamento escrevendo direto no stdout. Estratégia:
  // baixar e converter em pasta temporária e então enviar o arquivo.
  if (fmt === "mp3") {
    let tmpDir;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "veylo-mp3-"));

      await youtubedl(url, {
        extractAudio: true,
        audioFormat: "mp3",
        output: path.join(tmpDir, "audio.%(ext)s"),
        noWarnings: true,
      });

      const produced = fs.readdirSync(tmpDir);
      const file = produced.find((f) => f.endsWith(".mp3")) || produced[0];

      if (!file) {
        throw new Error("a conversão não produziu nenhum arquivo de áudio");
      }

      res.status(200);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.mp3"`);
      const readStream = fs.createReadStream(path.join(tmpDir, file));

      res.on("close", () => {
        readStream.destroy();
        fs.rm(tmpDir, { recursive: true, force: true }, () => {});
      });

      readStream.on("error", (err) => {
        console.error("mp3 stream error:", err.message);
        if (!res.headersSent) {
          res.status(500).send("Falha ao enviar o áudio convertido");
        } else {
          res.end();
        }
      });

      readStream.pipe(res);
      return;
    } catch (error) {
      console.error("mp3 convert error:", error.message);
      if (tmpDir) fs.rm(tmpDir, { recursive: true, force: true }, () => {});
      if (!res.headersSent) {
        res.status(500).send("Não foi possível converter para MP3");
      } else {
        res.end();
      }
      return;
    }
  }

  // Streaming direto com UM único formato: o yt-dlp não suporta mesclar
  // vídeo+áudio escrevendo no stdout. Formatos compostos (bestvideo+bestaudio)
  // no stdout produzem erro e resultavam em download vazio.
  const presets = {
    mp4: {
      contentType: "video/mp4",
      args: ["-f", "best[ext=mp4][vcodec^=avc1][height<=1080]/best[ext=mp4][height<=1080]/best[ext=mp4]/best"],
    },
    webm: {
      contentType: "video/webm",
      args: ["-f", "best[ext=webm][height<=1080]/best[ext=webm]/best"],
    },
    m4a: {
      contentType: "audio/mp4",
      args: ["-f", "bestaudio[ext=m4a]/bestaudio"],
    },
  };

  const preset = presets[fmt];
  if (!preset) {
    return res.status(400).send("Formato não suportado");
  }

  const args = [...preset.args, "--no-warnings", "-o", "-", url];
  const proc = spawn(YTDLP_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });

  let headersSent = false;
  let sentBytes = 0;

  const fail = (message) => {
    console.error("download fail:", message);
    proc.kill();
    if (!res.headersSent) {
      res.status(500).send(message);
    } else {
      res.end();
    }
  };

  proc.stdout.on("data", (chunk) => {
    if (!headersSent) {
      headersSent = true;
      res.status(200);
      res.setHeader("Content-Type", preset.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.${fmt}"`);
    }
    sentBytes += chunk.length;
    if (!res.write(chunk)) {
      // backpressure: pausar o yt-dlp até a resposta drenar
      proc.stdout.pause();
      res.once("drain", () => proc.stdout.resume());
    }
  });

  proc.stderr.on("data", (chunk) => {
    console.error("[yt-dlp stderr]", String(chunk).trim());
  });

  proc.on("error", (err) => {
    // típico: binário yt-dlp ausente no PATH
    fail(`não foi possível iniciar o yt-dlp: ${err.message}`);
  });

  proc.on("close", (code) => {
    if (sentBytes === 0) {
      // nunca devolve mais 200 vazio: informa o erro de verdade
      fail(`yt-dlp encerrou (código ${code}) sem enviar dados — verifique binário e URL`);
      return;
    }
    if (code !== 0) {
      console.error("download warning: encerrou com código", code, "após", sentBytes, "bytes");
    }
    res.end();
  });
});

app.listen(PORT, () => {
  console.log(`veylo-api rodando na porta ${PORT}`);
});
