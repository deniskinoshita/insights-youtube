# Insights de Video do YouTube

Painel local que baixa a transcrição de qualquer vídeo do YouTube, limpa e organiza o texto, e gera uma análise estruturada com tese central, números, frases citáveis e aplicações práticas.

## Como funciona

1. Você cola o link do vídeo no painel (ou passa uma lista).
2. O `yt-dlp` baixa a legenda (automática ou manual, em PT ou EN).
3. O texto é limpo e salvo em `transcricoes/`.
4. Se a chave de API da Anthropic estiver configurada, a análise é gerada automaticamente em `analises/`.

## Pré-requisitos

- Python 3.8+
- yt-dlp (`pip install -U yt-dlp`)

## Instalação

```bash
git clone https://github.com/SEU_USUARIO/insights-youtube.git
cd insights-youtube
pip install -U yt-dlp
```

## Uso

**Painel no navegador** (um vídeo por vez):

```bash
python painel.py
```

Abre em `http://localhost:8787`. Cole a URL, clique em Processar, pronto.

**Em lote** (vários vídeos de uma vez):

```bash
python baixar_transcricoes.py links.txt
```

Crie `links.txt` com uma URL por linha.

**Com Claude Code / Cowork** (conversacional):

Conecte a pasta e diga: "analisa esse vídeo: https://youtube.com/watch?v=..."
A skill `.claude/skills/youtube-insights/SKILL.md` cuida do resto.

## Análise automática (opcional)

Configure a variável de ambiente com sua chave da Anthropic:

```bash
# Windows
setx ANTHROPIC_API_KEY "sua-chave"

# macOS / Linux
export ANTHROPIC_API_KEY="sua-chave"
```

Sem a chave, o painel salva só a transcrição. Você pode pedir a análise depois pelo Claude Code.

## Versão online (Vercel)

Endereço: https://insights-youtube-brauna.vercel.app

O código fica na pasta `vercel/` e a Vercel publica a partir dela (Root Directory = `vercel`).

- `api/analisar.js`: busca a transcrição pelo Supadata (o YouTube bloqueia os servidores da
  Vercel) e gera o relatório em JSON: resumo executivo, dados com fonte, gráficos, áreas da
  assessoria, mensagens no roteiro SPIN e perguntas SPIN.
- `api/checar.js`: pesquisa na internet cada afirmação que precisa de checagem e marca como
  confirmada, parcial, divergente ou não encontrada ("líder deve buscar").
- `public/index.html`: a página, com os gráficos e o download do relatório (A4) e da
  apresentação (16:9) em PDF.

Variáveis de ambiente na Vercel:

| Variável | Para quê |
|---|---|
| `ANTHROPIC_API_KEY` | gerar a análise e a checagem |
| `SUPADATA_API_KEY` | buscar a transcrição do YouTube |
| `ANTHROPIC_WORKSPACE_ID` | só se a chave da Anthropic não pertencer a um workspace |

Para conferir se as chaves estão configuradas, abra `/api/analisar` no navegador: a resposta
diz só se cada uma existe, nunca o valor. Se a transcrição automática falhar, a página abre
uma caixa para colar a transcrição copiada do YouTube.

## Estrutura

```
insights-youtube/
├── painel.py                  painel web local
├── baixar_transcricoes.py     processamento em lote
├── PROMPT_ANALISE.md          formato da análise (editável)
├── INSTALAR.md                guia de instalação detalhado
├── transcricoes/              uma por vídeo (não sobe pro git)
├── analises/                  uma por vídeo (não sobe pro git)
├── vercel/                    versão online (Vercel)
└── .claude/skills/youtube-insights/SKILL.md
```

## Personalizando a análise

Edite o `PROMPT_ANALISE.md`. Quer uma seção extra tipo "gancho para LinkedIn"? Adicione lá. O painel e a skill leem o mesmo arquivo.

## Licença

MIT
