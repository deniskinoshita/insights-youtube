import { criarCliente, FALLBACK, MODELO } from "./_comum.js";

const STATUS = ["confirmada", "parcial", "divergente", "nao_encontrada"];

const INSTRUCOES = `Você é o checador de fatos da Braúna, uma assessoria de investimentos. Um
assessor quer repetir para clientes algumas afirmações que ouviu num vídeo do YouTube.
Pesquise cada uma na internet e diga se ela se sustenta.

Regras:
- Prefira fontes primárias e oficiais: Banco Central, IBGE, CVM, B3, Anbima, Receita
  Federal, Tesouro Nacional, SUSEP, leis no planalto.gov.br, relatórios das próprias
  instituições, estudos acadêmicos. Use imprensa econômica só como apoio.
- status:
  - "confirmada": encontrou fonte confiável que diz o mesmo.
  - "parcial": a ideia se sustenta, mas o número está desatualizado, arredondado ou
    precisa de contexto.
  - "divergente": fontes confiáveis dizem outra coisa.
  - "nao_encontrada": não achou nada confiável que confirme ou desminta.
- explicacao: uma ou duas frases dizendo o que as fontes mostram, com número e data
  quando houver.
- fontes: só as páginas que você realmente usou, com título e URL. Para
  "nao_encontrada", lista vazia.
- orientacao: o que o assessor deve fazer. Para "nao_encontrada", escreva exatamente
  "Líder: buscar esta informação antes de usar com clientes." e, se souber, onde
  procurar.

Responda só com um bloco \`\`\`json contendo {"itens": [...]} com um item por afirmação,
na mesma ordem, cada item com: afirmacao, status, explicacao, fontes
[{"titulo","url"}], orientacao.`;

function extrairJson(textoResposta) {
  const bloco = textoResposta.match(/```json\s*([\s\S]*?)```/);
  const candidato = bloco ? bloco[1] : textoResposta.slice(textoResposta.indexOf("{"), textoResposta.lastIndexOf("}") + 1);
  return JSON.parse(candidato);
}

function normalizar(itens, afirmacoes) {
  return afirmacoes.map((a, i) => {
    const item = itens.find((x) => x && x.afirmacao === a.afirmacao) || itens[i] || {};
    const status = STATUS.includes(item.status) ? item.status : "nao_encontrada";
    const fontes = Array.isArray(item.fontes)
      ? item.fontes.filter((f) => f && /^https?:\/\//.test(f.url || "")).slice(0, 4)
      : [];
    return {
      afirmacao: a.afirmacao,
      status,
      explicacao: item.explicacao || "",
      fontes: status === "nao_encontrada" ? [] : fontes,
      orientacao: status === "nao_encontrada"
        ? item.orientacao || "Líder: buscar esta informação antes de usar com clientes."
        : item.orientacao || "",
    };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Use POST." });
  }

  const { afirmacoes, contexto } = req.body || {};
  const lista = (Array.isArray(afirmacoes) ? afirmacoes : [])
    .filter((a) => a && typeof a.afirmacao === "string" && a.afirmacao.trim())
    .slice(0, 6);
  if (!lista.length) {
    return res.status(200).json({ itens: [] });
  }

  const pedido = [
    `Vídeo: ${contexto?.titulo || "não informado"} (${contexto?.canal || "canal não informado"})`,
    "",
    "Afirmações para checar:",
    ...lista.map((a, i) => `${i + 1}. ${a.afirmacao}${a.por_que_checar ? ` (por que checar: ${a.por_que_checar})` : ""}`),
  ].join("\n");

  try {
    const cliente = criarCliente();
    const mensagens = [{ role: "user", content: pedido }];
    let resposta;

    // A busca roda nos servidores da Anthropic; uma rodada longa volta como
    // pause_turn e continua quando a resposta parcial é reenviada.
    for (let rodada = 0; rodada < 4; rodada++) {
      resposta = await cliente.beta.messages.create({
        model: MODELO,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        ...FALLBACK,
        system: INSTRUCOES,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 12 }],
        messages: mensagens,
      });
      if (resposta.stop_reason !== "pause_turn") break;
      mensagens.push({ role: "assistant", content: resposta.content });
    }

    if (resposta.stop_reason === "refusal") {
      return res.status(422).json({ erro: "O checador recusou pesquisar essas afirmações." });
    }

    const final = resposta.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    let itens;
    try {
      itens = extrairJson(final).itens || [];
    } catch {
      return res.status(502).json({ erro: "A checagem voltou num formato inesperado. Tente de novo." });
    }

    return res.status(200).json({ itens: normalizar(itens, lista) });
  } catch (e) {
    return res.status(502).json({ erro: "A checagem na internet falhou.", detalhe: e.message });
  }
}
