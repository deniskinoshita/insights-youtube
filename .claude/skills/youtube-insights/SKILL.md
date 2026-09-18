---
name: youtube-insights
description: Baixa a transcricao de um ou varios videos do YouTube e extrai tese central, pontos principais, numeros, frases citaveis e aplicacoes praticas para o trabalho do Denis na Brauna. Acionar sempre que ele colar um link do YouTube, dizer "analisa esse video", "o que da para tirar disso", "processa esses links", "resume esse canal", "estuda esse palestrante", ou pedir a leitura de um video de concorrente, aula, palestra ou entrevista.
---

# Insights de video do YouTube

## Quando usar

Qualquer pedido que envolva um link do YouTube e a intencao de extrair conteudo:
analisar, resumir, estudar estilo de palestrante, mapear concorrente, ou processar
uma lista de videos de uma vez.

## Passo 1, obter a transcricao

Um video so:

```bash
python painel.py --sem-navegador &
```

ou, direto pela linha de comando, sem subir o painel:

```bash
echo "URL_AQUI" > /tmp/link.txt && python baixar_transcricoes.py /tmp/link.txt
```

Varios videos:

```bash
python baixar_transcricoes.py links.txt
```

As transcricoes limpas caem em `transcricoes/`, uma por video, com titulo, canal e
fonte no cabecalho.

Se o `yt-dlp` nao estiver instalado, rode `pip install -U yt-dlp` antes.
Se o video nao tiver legenda nenhuma, avise e siga para os proximos, nao trave a fila.

## Passo 2, analisar

Leia o arquivo `PROMPT_ANALISE.md` da raiz do projeto e siga exatamente aquele
formato. Ele define a estrutura: tese central, pontos principais, frases citaveis,
numeros com fonte, aplicacao no trabalho do Denis, e o que checar antes de usar.

Salve o resultado em `analises/<mesmo-nome-do-arquivo>.md`.

## Regras que nao mudam

- Nunca invente conteudo que nao esta na transcricao. Se a legenda automatica
  embolou o trecho, marque `[incerto]` em vez de preencher a lacuna.
- Numeros e dados sempre com a fonte que o autor citou. Se ele nao citou, escreva
  "sem fonte". Denis usa esse material em palestra e material de cliente, entao um
  numero sem lastro e pior que numero nenhum.
- Frases citaveis transcritas literalmente, no maximo tres por video.
- Na secao de aplicacao, seja concreto: palestra de prospecao, conteudo para cliente,
  argumento de reuniao, capitulo de livro. Se nao encaixar em nada, diga que nao encaixa.

## Quando forem varios videos

Depois das analises individuais, gere `analises/sintese.md` com os temas que se
repetem, onde os autores se contradizem, e o que ninguem cobriu.
