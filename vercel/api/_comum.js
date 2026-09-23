import Anthropic from "@anthropic-ai/sdk";

// Arquivos com _ na frente não viram rota na Vercel: aqui fica o que as rotas dividem.

const SUPADATA = "https://api.supadata.ai/v1";

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export function extrairId(url) {
  const m = String(url || "").match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/
  );
  return m ? m[1] : null;
}

export function formatarDuracao(seg) {
  if (!seg || isNaN(seg)) return "";
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = Math.floor(seg % 60);
  return h ? `${h}h${String(m).padStart(2, "0")}min` : `${m}min${String(s).padStart(2, "0")}s`;
}

// O plano grátis do Supadata aceita cerca de 1 pedido por segundo e responde 429
// ("Limit Exceeded") acima disso, então os pedidos saem um de cada vez e o 429
// ganha até duas novas tentativas.
async function supadata(caminho, chave) {
  for (let tentativa = 0; ; tentativa++) {
    const resp = await fetch(SUPADATA + caminho, { headers: { "x-api-key": chave } });
    const corpo = await resp.json().catch(() => ({}));
    if (resp.status !== 429 || tentativa >= 2) return { status: resp.status, corpo };
    await esperar(1500 * (tentativa + 1));
  }
}

// Busca a transcrição pelo Supadata, que acessa o YouTube sem o bloqueio de bot
// que atinge os servidores da Vercel. Vídeos longos voltam como job assíncrono.
export async function buscarTranscricao(url, chave) {
  const q = new URLSearchParams({ url, text: "true", lang: "pt" });
  let { status, corpo } = await supadata("/transcript?" + q, chave);

  if (status === 202 && corpo.jobId) {
    const jobId = corpo.jobId;
    const limite = Date.now() + 60000;
    while (Date.now() < limite) {
      await esperar(2000);
      ({ status, corpo } = await supadata("/transcript/" + jobId, chave));
      if (corpo.status === "completed") break;
      if (corpo.status === "failed") {
        throw new Error(corpo.error?.message || corpo.error || "o serviço não conseguiu transcrever o vídeo");
      }
    }
    if (corpo.status !== "completed") throw new Error("a transcrição demorou demais");
  } else if (status !== 200) {
    if (status === 429) {
      throw new Error("o limite do plano do Supadata foi atingido (pedidos demais ou créditos do mês esgotados)");
    }
    throw new Error(corpo.message || corpo.error || `serviço de transcrição respondeu ${status}`);
  }

  const texto = typeof corpo.content === "string"
    ? corpo.content
    : Array.isArray(corpo.content) ? corpo.content.map((c) => c.text).join(" ") : "";
  if (!texto.trim()) throw new Error("o vídeo não tem legenda disponível");
  return { texto, idioma: corpo.lang };
}

export async function buscarMeta(id, chave) {
  try {
    const { status, corpo } = await supadata("/youtube/video?id=" + id, chave);
    if (status !== 200) return {};
    return {
      titulo: corpo.title,
      canal: corpo.channel?.name,
      duracao: formatarDuracao(corpo.duration),
    };
  } catch {
    return {};
  }
}

export function limparColada(texto) {
  // Remove as marcações de tempo que vêm junto quando se copia a transcrição do YouTube
  return texto
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^\d{1,2}(:\d{2}){1,2}$/.test(l) && !/^\d+\s+(segundos?|minutos?|horas?)(,\s*\d+\s+(segundos?|minutos?))*$/i.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function criarCliente() {
  // Chaves que não pertencem a um workspace exigem o id do workspace em cada pedido
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  return new Anthropic(
    workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}
  );
}

export const MODELO = "claude-opus-5";

// Liga o fallback do servidor: se o modelo recusar, a própria API tenta outro modelo
export const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
