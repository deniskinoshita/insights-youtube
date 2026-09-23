import { esperar } from "./_comum.js";

// Transcreve um pedaço de áudio gravado na página (aulas fora do YouTube, como as de
// plataformas de curso com login). A página grava a aba da aula em pedaços de poucos
// minutos e manda um de cada vez, porque a Vercel recusa pedidos acima de 4,5 MB.

const GROQ = "https://api.groq.com/openai/v1/audio/transcriptions";
const LIMITE_BASE64 = 4_000_000;

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ groq: Boolean(process.env.GROQ_API_KEY) });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Use POST." });
  }

  const chave = process.env.GROQ_API_KEY;
  if (!chave) {
    return res.status(503).json({
      erro: "A transcrição de aulas gravadas ainda não está configurada.",
      detalhe: "Falta a variável GROQ_API_KEY na Vercel.",
    });
  }

  const { audio, tipo } = req.body || {};
  if (!audio || typeof audio !== "string") {
    return res.status(400).json({ erro: "Nenhum áudio recebido." });
  }
  if (audio.length > LIMITE_BASE64) {
    return res.status(413).json({ erro: "Esse pedaço de áudio ficou grande demais." });
  }

  const mime = String(tipo || "audio/webm").split(";")[0];
  const extensao = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";

  for (let tentativa = 0; ; tentativa++) {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(audio, "base64")], { type: mime }), `trecho.${extensao}`);
    form.append("model", "whisper-large-v3");
    form.append("language", "pt");
    form.append("response_format", "json");
    form.append("temperature", "0");

    const resp = await fetch(GROQ, { method: "POST", headers: { Authorization: `Bearer ${chave}` }, body: form });
    const corpo = await resp.json().catch(() => ({}));

    if (resp.ok) return res.status(200).json({ texto: (corpo.text || "").trim() });

    // O plano grátis da Groq limita minutos de áudio por hora; espera um pouco e tenta de novo
    if (resp.status === 429 && tentativa < 2) {
      const segundos = Math.min(Number(resp.headers.get("retry-after")) || 5 * (tentativa + 1), 20);
      await esperar(segundos * 1000);
      continue;
    }

    const msg = corpo.error?.message || `o serviço de transcrição respondeu ${resp.status}`;
    return res.status(502).json({
      erro: resp.status === 429
        ? "O limite do plano da Groq foi atingido. Espere alguns minutos e grave de novo."
        : "Não consegui transcrever esse trecho: " + msg,
    });
  }
}
