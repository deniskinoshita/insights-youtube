# Como instalar

Três passos. Leva uns dez minutos na primeira vez, depois é só usar.

---

## Passo 1, colocar a pasta no lugar

Descompacte o `insights-youtube.zip` numa pasta que o Claude Desktop já enxergue,
ou numa pasta nova que você vai conectar. Sugestão: `Documentos/insights-youtube`.

A estrutura fica assim:

```
insights-youtube/
├── painel.py                 o painel onde você cola a URL
├── baixar_transcricoes.py    processamento em lote, vários links de uma vez
├── PROMPT_ANALISE.md         o formato da análise, edite quando quiser
├── INSTALAR.md               este arquivo
├── transcricoes/             sai uma por vídeo
├── analises/                 sai uma por vídeo
└── .claude/skills/youtube-insights/SKILL.md
```

O `.claude/` começa com ponto, então fica oculto no Finder e no Explorer. Ele existe,
não se assuste se não aparecer.

---

## Passo 2, deixar o Cowork fazer o resto

Abra o Cowork, conecte a pasta `insights-youtube`, e cole isto:

> Conectei a pasta insights-youtube. Faça o seguinte, nessa ordem, e me diga o
> resultado de cada etapa em uma linha:
>
> 1. Verifique se o Python 3 está instalado nesta máquina. Se não estiver, me diga
>    onde baixar e pare por aqui.
> 2. Instale o yt-dlp com `pip install -U yt-dlp` e confirme a versão instalada.
> 3. Confirme que existe a pasta `.claude/skills/youtube-insights/` com o SKILL.md
>    dentro. Se não existir, crie a partir do conteúdo que estiver na pasta.
> 4. Rode `python painel.py --sem-navegador` e me diga se o servidor subiu sem erro.
>    Depois encerre.
> 5. Me diga o comando exato que eu devo digitar toda vez que quiser abrir o painel,
>    já com o caminho completo da pasta nesta máquina.

Se você quiser a análise automática dentro do painel, peça também:

> Me explique, para o meu sistema operacional, como deixar a variável de ambiente
> ANTHROPIC_API_KEY configurada de forma permanente.

---

## Passo 3, usar

**Pelo painel**, para o dia a dia, um vídeo por vez:

```bash
python painel.py
```

Abre no navegador. Você cola a URL, clica em Processar, e em 20 a 60 segundos
aparece a transcrição limpa e, se a chave estiver configurada, a análise pronta.
A lista da esquerda guarda tudo que você já processou.

**Pelo Claude Code**, quando você quer conversar sobre o conteúdo:

```
analisa esse vídeo: https://youtube.com/watch?v=...
```

A skill faz o download e aplica o PROMPT_ANALISE.md sozinha. Vantagem sobre o
painel: você pode discutir, pedir para cruzar com outro vídeo, ou mandar
transformar em roteiro de palestra na mesma conversa.

**Em lote**, quando são muitos links:

```bash
python baixar_transcricoes.py links.txt
```

Crie o `links.txt` com uma URL por linha. Depois abra o Claude Code na pasta e peça
a análise de tudo mais a síntese transversal.

---

## Se der errado

**"yt-dlp não encontrado"**
Rode `pip install -U yt-dlp`. Se o comando `pip` não existir, tente `pip3` ou
`python -m pip`.

**"Esse vídeo não tem legenda disponível"**
Acontece com vídeo muito novo ou com legenda desativada pelo canal. Não tem
contorno pelo script. Nesses casos, Claude no Chrome com o vídeo aberto.

**A análise não aparece, só a transcrição**
Falta a chave de API. Ou você configura a variável de ambiente, ou pede ao Claude
Code para ler a pasta `transcricoes/`, que é de graça e dá no mesmo resultado.

**O painel não abre no navegador**
Vá manualmente em `http://localhost:8787`. Se a porta estiver ocupada, rode
`python painel.py --porta 8800`.

**Erro de certificado ou de rede ao baixar**
Se estiver em rede corporativa com proxy, o download pode ser bloqueado. Teste no
seu wifi de casa para descartar.

---

## Ajustando o formato da análise

O `PROMPT_ANALISE.md` é o cérebro disso tudo, e é um arquivo de texto comum. Se você
quiser que toda análise já venha com uma seção "gancho para post no LinkedIn", ou
"objeção que o cliente faria", é só adicionar lá. O painel e a skill leem esse mesmo
arquivo, então muda nos dois de uma vez.
