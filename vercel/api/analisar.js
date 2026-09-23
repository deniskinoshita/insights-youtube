import {
  buscarMeta,
  buscarTranscricao,
  criarCliente,
  esperar,
  extrairId,
  FALLBACK,
  limparColada,
  MODELO,
} from "./_comum.js";

const LIMITE_TRANSCRICAO = 400000;

export const AREAS = [
  "Investimentos",
  "Previdência",
  "Seguros",
  "Crédito e correspondente bancário",
  "Consultoria e planejamento financeiro",
  "Gestora",
  "Empresas (PJ)",
  "Educação financeira e palestras",
  "Prospecção e conteúdo",
];

const INSTRUCOES = `Você é o analista de conteúdo da Braúna, um ecossistema de assessoria de
investimentos que atende pessoas físicas e empresas com investimentos, previdência,
seguros, crédito (correspondente bancário), consultoria e planejamento financeiro,
gestora, e faz palestras de educação financeira. O relatório vai ser usado pelo líder
e pelos assessores em reunião com cliente, palestra de prospecção e conteúdo.

Número sem lastro é pior que número nenhum. Não invente nada que não esteja na
transcrição. Se a legenda automática embolou um trecho, marque [incerto].

Preencha cada campo assim:

- ficha: título, canal e duração quando vierem no cabeçalho, senão "não informado";
  tema em uma frase; público para quem o vídeo parece ter sido feito.
- resumo_executivo: de 3 a 5 frases curtas com o que mais importa, para quem só vai
  ler isso. Comece pelo que muda a vida de quem o vídeo quer atingir.
- tese_central: uma frase só, o que o autor defende, não o assunto.
- pontos_principais: de 5 a 8, em ordem de importância.
- frases_citaveis: no máximo 3, literais, só as que funcionariam em slide ou post.
- dados: todo número, percentual, valor ou estudo citado. fonte_citada é a fonte que
  o autor deu, ou "sem fonte". valor_numerico é o número puro quando existir
  (ex.: 13,75% vira 13.75), senão null.
- graficos: de 0 a 3 gráficos montados SÓ com números da transcrição que se comparam
  entre si (mesma unidade), com pelo menos 2 pontos cada. "linha" só para série no
  tempo; o resto é "barra". Se o vídeo não traz números comparáveis, devolva lista
  vazia. Nunca complete com número que o autor não disse.
- areas: avalie TODAS as áreas da lista, relevancia de 0 (não serve) a 5 (serve
  muito), e em como_usar diga numa frase o uso concreto naquela área (ou por que não
  serve).
- afirmacoes_para_checar: de 3 a 6 afirmações do vídeo que um assessor precisaria
  confirmar antes de repetir para um cliente (números, regras, estudos, promessas de
  rentabilidade, dados de mercado). Escreva cada uma de forma que dê para pesquisar.
- ganchos: até 3 ideias de post ou de abertura de palestra, uma linha cada.
- publico_do_video: para quem o vídeo foi feito, escolhendo um da lista.
- mensagens: de 1 a 3 mensagens curtas para WhatsApp, cada uma para um destinatário
  diferente (cliente, candidato a assessor, equipe). A primeira é para o destinatário
  que mais combina com o público do vídeo. Cada destinatário só entra se o vídeo
  der a ele um motivo próprio, sem ponte forçada:
    cliente: o tema interessa a quem investe (dinheiro, patrimônio, planejamento,
    economia que mexe no bolso).
    candidato a assessor: o vídeo fala de carreira, profissão, mercado de trabalho
    ou de empreender na assessoria. Um vídeo sobre mercado, economia ou tecnologia
    não vira convite de carreira só porque "o setor vai mudar".
    equipe: o vídeo traz algo que o time aplica no dia a dia (técnica de venda,
    atendimento, produto, gestão, rotina comercial).
  Se só um destinatário faz sentido, devolva uma mensagem só. É melhor uma
  mensagem boa do que três parecidas; nunca complete as três por obrigação.
  Cada mensagem segue o SPIN Selling (Neil Rackham), nesta ordem e sem dizer os nomes
  das etapas:
    Situação: uma frase leve sobre o momento da pessoa, de preferência uma pergunta
    curta ou uma observação do tipo "lembrei de você por causa de...".
    Problema: o incômodo que o vídeo toca, dito do jeito que a pessoa sentiria.
    Implicação: numa frase, o custo de deixar isso como está (tempo, dinheiro,
    oportunidade, tranquilidade).
    Necessidade de solução: feche com uma pergunta aberta que faça a própria pessoa
    dizer o valor de resolver, e deixe o próximo passo fácil (conversa de 20 minutos,
    café, ligação).
  Escreva como gente, na primeira pessoa, do jeito que um assessor que conhece a
  pessoa escreveria: 50 a 90 palavras, frases curtas, tom de conversa, sem jargão,
  sem travessão, sem lista, sem hashtag, no máximo um emoji. Nada de "não é só X, é
  Y", "no cenário atual", "descubra", "vamos juntos", "fez sentido?". Não afirme
  número, empresa, programa ou regra do vídeo como fato (eles ainda não foram
  checados); fale da ideia, não do dado. Não prometa rentabilidade nem cite produto.
  Deixe "[nome]" onde entra o nome da pessoa. Em objetivo, diga em uma frase o que a
  mensagem quer provocar.
- perguntas_spin: perguntas para usar na conversa que a mensagem principal abrir,
  2 ou 3 por etapa (situacao, problema, implicacao, necessidade), no tom de quem
  pergunta de verdade, sem cara de roteiro.
- variacao: preencha só quando a instrução extra abaixo pedir; senão null.`;

const VARIACOES = {
  palestrante:
    "Instrução extra: em variacao, com o título 'Estrutura da fala', descreva como ele abre, como constrói tensão, como fecha, e quanto tempo leva até o primeiro ponto prático.",
  concorrente:
    "Instrução extra: em variacao, com o título 'Leitura de concorrente', diga qual promessa ele faz ao público, qual objeção ele antecipa, qual o call to action e em que momento aparece.",
  aula:
    "Instrução extra: em variacao, com o título 'Ordem de aprendizado', liste os conceitos na ordem em que precisam ser aprendidos, não na ordem em que ele apresentou.",
};

const texto = { type: "string" };
const listaDeTexto = { type: "array", items: texto };
const objeto = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const ESQUEMA = objeto({
  ficha: objeto({ titulo: texto, canal: texto, duracao: texto, tema: texto, publico: texto }),
  resumo_executivo: listaDeTexto,
  tese_central: texto,
  pontos_principais: listaDeTexto,
  frases_citaveis: { type: "array", items: objeto({ texto, contexto: texto }) },
  dados: {
    type: "array",
    items: objeto({
      dado: texto,
      valor_numerico: { anyOf: [{ type: "number" }, { type: "null" }] },
      unidade: texto,
      fonte_citada: texto,
    }),
  },
  graficos: {
    type: "array",
    items: objeto({
      titulo: texto,
      tipo: { type: "string", enum: ["barra", "linha"] },
      unidade: texto,
      fonte: texto,
      pontos: { type: "array", items: objeto({ rotulo: texto, valor: { type: "number" } }) },
    }),
  },
  areas: {
    type: "array",
    items: objeto({
      area: { type: "string", enum: AREAS },
      relevancia: { type: "integer" },
      como_usar: texto,
    }),
  },
  afirmacoes_para_checar: {
    type: "array",
    items: objeto({ afirmacao: texto, por_que_checar: texto }),
  },
  ganchos: listaDeTexto,
  publico_do_video: {
    type: "string",
    enum: ["investidores", "futuros assessores", "assessores e equipes", "empresários", "público geral"],
  },
  mensagens: {
    type: "array",
    items: objeto({
      destinatario: { type: "string", enum: ["cliente", "candidato a assessor", "equipe"] },
      objetivo: texto,
      texto,
    }),
  },
  perguntas_spin: objeto({
    situacao: listaDeTexto,
    problema: listaDeTexto,
    implicacao: listaDeTexto,
    necessidade: listaDeTexto,
  }),
  variacao: { anyOf: [objeto({ titulo: texto, itens: listaDeTexto }), { type: "null" }] },
});

export default async function handler(req, res) {
  if (req.method === "GET") {
    // Diagnóstico: diz só se as chaves existem, nunca o valor delas
    return res.status(200).json({
      supadata: Boolean(process.env.SUPADATA_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      workspace: Boolean(process.env.ANTHROPIC_WORKSPACE_ID),
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

  const cabecalho = [
    `Link: ${url || "não informado"}`,
    `Título: ${meta.titulo || "não informado"}`,
    `Canal: ${meta.canal || "não informado"}`,
    `Duração: ${meta.duracao || "não informado"}`,
    `Áreas para avaliar: ${AREAS.join("; ")}`,
  ].join("\n");

  try {
    const resposta = await criarCliente().beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: ESQUEMA } },
      ...FALLBACK,
      system: [INSTRUCOES, VARIACOES[variacao]].filter(Boolean).join("\n\n"),
      messages: [
        { role: "user", content: `${cabecalho}\n\n<transcricao>\n${transcricao}\n</transcricao>` },
      ],
    });

    if (resposta.stop_reason === "refusal") {
      return res.status(422).json({ erro: "O modelo recusou analisar esse conteúdo.", transcricao });
    }
    if (resposta.stop_reason === "max_tokens") {
      return res.status(502).json({ erro: "O relatório ficou grande demais e foi cortado. Tente de novo.", transcricao });
    }

    const bruto = resposta.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    let relatorio;
    try {
      relatorio = JSON.parse(bruto);
    } catch {
      return res.status(502).json({ erro: "A análise voltou num formato inesperado. Tente de novo.", transcricao });
    }

    return res.status(200).json({ relatorio, meta, url });
  } catch (e) {
    return res.status(502).json({
      erro: "A transcrição veio, mas a análise falhou.",
      detalhe: e.message,
      transcricao,
    });
  }
}
