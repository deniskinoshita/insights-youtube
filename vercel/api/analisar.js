import Anthropic from "@anthropic-ai/sdk";

const PROMPT_ANALISE = `# Relatório de vídeo do YouTube, padrão Braúna

Quem usa isto é assessor de investimentos da Braúna. O material vai para reunião
com cliente, palestra de prospecção, aula de educação financeira e conteúdo de rede
social. Número sem lastro é pior que número nenhum, então a rastreabilidade das
fontes é a parte mais importante do relatório.

Escreva em Markdown, com estas oito seções, nesta ordem, com estes títulos:

## Ficha do vídeo
Título, canal, duração, tema central em uma frase, e para quem o vídeo parece ter
sido feito. O que não estiver disponível, escreva "não informado".

## Tese central
Uma frase só. O que o autor está defendendo, não o assunto de que ele fala.

## Pontos principais
De cinco a oito, em ordem de importância, não na ordem em que apareceram.

## Frases citáveis
No máximo três, literais, cada uma como bloco de citação. Só as que funcionariam
em slide ou post. Se nenhuma servir, diga que não há.

## Dados e números
Todo número, percentual, valor ou estudo citado, com a fonte que **o autor** deu.
Se ele não citou fonte, escreva **sem fonte** ao lado. Não complete o que ele não disse.

## Aplicação na Braúna
Concreto: reunião de cliente, palestra de prospecção, aula de educação financeira,
conversa com a equipe, material institucional. Para cada uso, uma frase dizendo como
usar. Se não encaixar em nada, diga que não encaixa e explique por quê.

## Ganchos de conteúdo
Até três ideias de post ou abertura de palestra que partem do vídeo, cada uma em
uma linha.

## O que checar antes de usar
Simplificações, viés de venda, dado desatualizado, conflito de interesse, ou
qualquer coisa que um cliente atento poderia contestar.

Regras: não invente nada que não esteja na transcrição. Se a legenda automática
embolou um trecho, marque [incerto] em vez de preencher a lacuna.`;

const VARIACOES = {
  palestrante:
    "Adicione a seção ## Estrutura da fala: como ele abre, como constrói tensão, como fecha, e quanto tempo leva até o primeiro ponto prático.",
  concorrente:
    "Adicione a seção ## Leitura de concorrente: qual promessa ele faz ao público, qual objeção ele antecipa, qual o call to action e em que momento aparece.",
  aula:
    "Adicione a seção ## Ordem de aprendizado: liste os conceitos na ordem em que precisam ser aprendidos, não na ordem em que ele apresentou.",
};

const SUPADATA = "https://api.supadata.ai/v1";
const LIMITE_TRANSCRICAO = 400000;

function extrairId(url) {
  const m = String(url || "").match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/
  );
  return m ? m[1] : null;
}

function formatarDuracao(seg) {
  if (!seg || isNaN(seg)) return "";
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = Math.floor(seg % 60);
  return h ? `${h}h${String(m).padStart(2, "0")}min` : `${m}min${String(s).padStart(2, "0")}s`;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function buscarTranscricao(url, chave) {
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

async function buscarMeta(id, chave) {
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

function limparColada(texto) {
  // Remove as marcações de tempo que vêm junto quando se copia a transcrição do YouTube
  return texto
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^\d{1,2}(:\d{2}){1,2}$/.test(l) && !/^\d+\s+(segundos?|minutos?|horas?)(,\s*\d+\s+(segundos?|minutos?))*$/i.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    // Diagnóstico: diz só se as chaves existem, nunca o valor delas
    return res.status(200).json({
      supadata: Boolean(process.env.SUPADATA_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Use POST." });
  }

  const { url, variacao, transcricao: colada } = req.body || {};
  const id = extrairId(url);
  let transcricao = "";
  let meta = {};

  if (colada && colada.trim()) {
    transcricao = limparColada(colada);
    meta.legendaTipo = "colada manualmente";
  } else {
    if (!id) {
      return res.status(400).json({ erro: "Não reconheci esse link do YouTube. Confira se ele está completo." });
    }
    const chave = process.env.SUPADATA_API_KEY;
    if (!chave) {
      return res.status(503).json({
        erro: "A busca automática da transcrição ainda não está configurada.",
        detalhe: "Cole a transcrição do vídeo na caixa que abriu logo acima.",
        precisaColar: true,
      });
    }
    try {
      const t = await buscarTranscricao(url, chave);
      await esperar(1100);
      const m = await buscarMeta(id, chave);
      transcricao = t.texto;
      meta = { ...m, legendaTipo: t.idioma ? `automática (${t.idioma})` : "automática" };
    } catch (e) {
      return res.status(502).json({
        erro: "Não consegui buscar a transcrição automaticamente: " + e.message,
        detalhe: "Cole a transcrição do vídeo na caixa que abriu logo acima.",
        precisaColar: true,
      });
    }
  }

  if (transcricao.length > LIMITE_TRANSCRICAO) {
    return res.status(413).json({
      erro: "A transcrição é longa demais para uma análise só.",
      detalhe: "Divida o vídeo em partes e cole uma parte de cada vez.",
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ erro: "A chave da Anthropic não está configurada.", transcricao });
  }

  const instrucoes = [PROMPT_ANALISE, VARIACOES[variacao]].filter(Boolean).join("\n\n");
  const cabecalho = [
    `Link: ${url || "não informado"}`,
    `Título: ${meta.titulo || "não informado"}`,
    `Canal: ${meta.canal || "não informado"}`,
    `Duração: ${meta.duracao || "não informado"}`,
  ].join("\n");

  try {
    const client = new Anthropic();
    const resposta = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: instrucoes,
      messages: [
        {
          role: "user",
          content: `${cabecalho}\n\n<transcricao>\n${transcricao}\n</transcricao>`,
        },
      ],
    });

    if (resposta.stop_reason === "refusal") {
      return res.status(422).json({ erro: "O modelo recusou analisar esse conteúdo.", transcricao });
    }

    const analise = resposta.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return res.status(200).json({ analise, meta });
  } catch (e) {
    return res.status(502).json({
      erro: "A transcrição veio, mas a análise falhou.",
      detalhe: e.message,
      transcricao,
    });
  }
}
