#!/usr/bin/env python3
"""
Painel de insights de video.

Roda um painel local no navegador. Voce cola a URL do YouTube, ele baixa a
legenda, limpa, salva em transcricoes/ e, se houver chave de API configurada,
gera a analise em analises/.

Uso:
    python painel.py
    python painel.py --porta 8800

Requer:
    pip install -U yt-dlp

Opcional, para a analise automatica:
    export ANTHROPIC_API_KEY="sua-chave"       (macOS/Linux)
    setx ANTHROPIC_API_KEY "sua-chave"         (Windows, reabrir o terminal)
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = Path(__file__).resolve().parent
TRANSCRICOES = BASE / "transcricoes"
ANALISES = BASE / "analises"
PROMPT_ARQUIVO = BASE / "PROMPT_ANALISE.md"

LANGS = "pt-BR,pt,pt-orig,en,en-orig"
MODELO = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")

TIMESTAMP = re.compile(r"\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->")
TAGS = re.compile(r"<[^>]+>")
CUE = re.compile(r"align:\S+|position:\S+|line:\S+|size:\S+")


# ----------------------------------------------------------------- legendas

def limpar_vtt(texto: str) -> str:
    saida: list[str] = []
    for linha in texto.splitlines():
        linha = linha.strip()
        if not linha:
            continue
        if linha.startswith(("WEBVTT", "Kind:", "Language:", "NOTE", "STYLE")):
            continue
        if TIMESTAMP.search(linha) or linha.isdigit():
            continue
        linha = re.sub(r"\s+", " ", CUE.sub("", TAGS.sub("", linha))).strip()
        if not linha:
            continue
        if saida and (linha == saida[-1] or saida[-1].endswith(linha)):
            continue
        if saida and linha.startswith(saida[-1]):
            saida[-1] = linha
            continue
        saida.append(linha)
    return " ".join(saida)


def quebrar_paragrafos(texto: str, frases: int = 5) -> str:
    partes = re.split(r"(?<=[.!?])\s+", texto)
    blocos = [" ".join(partes[i:i + frases]) for i in range(0, len(partes), frases)]
    return "\n\n".join(b for b in blocos if b.strip())


def slug(nome: str) -> str:
    nome = re.sub(r"[^\w\s-]", "", nome, flags=re.UNICODE).strip()
    return re.sub(r"[\s_]+", "-", nome).lower()[:80] or "video"


def baixar_transcricao(url: str) -> dict:
    """Retorna {titulo, canal, duracao, texto} ou levanta RuntimeError."""
    if not shutil.which("yt-dlp"):
        raise RuntimeError("yt-dlp nao encontrado. Rode: pip install -U yt-dlp")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        cmd = [
            "yt-dlp", "--skip-download",
            "--write-subs", "--write-auto-subs",
            "--sub-langs", LANGS, "--sub-format", "vtt", "--convert-subs", "vtt",
            "--write-info-json", "--restrict-filenames",
            "-o", str(tmp_path / "video.%(ext)s"),
            url,
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            ultima = (r.stderr.strip().splitlines() or ["falha desconhecida"])[-1]
            raise RuntimeError(f"yt-dlp: {ultima}")

        vtts = sorted(tmp_path.glob("*.vtt"))
        if not vtts:
            raise RuntimeError("Esse video nao tem legenda disponivel, nem automatica.")

        info = {}
        infos = list(tmp_path.glob("*.info.json"))
        if infos:
            info = json.loads(infos[0].read_text(encoding="utf-8", errors="ignore"))

        preferido = next((v for v in vtts if ".pt" in v.name), vtts[0])
        texto = limpar_vtt(preferido.read_text(encoding="utf-8", errors="ignore"))
        if not texto:
            raise RuntimeError("A legenda veio vazia.")

        segundos = info.get("duration") or 0
        return {
            "titulo": info.get("title") or "Video sem titulo",
            "canal": info.get("uploader") or "",
            "duracao": f"{segundos // 60}min" if segundos else "",
            "texto": quebrar_paragrafos(texto),
            "palavras": len(texto.split()),
        }


# ------------------------------------------------------------------ analise

def prompt_base() -> str:
    if PROMPT_ARQUIVO.exists():
        return PROMPT_ARQUIVO.read_text(encoding="utf-8")
    return "Resuma a transcricao em topicos, com numeros, frases citaveis e aplicacoes praticas."


def analisar(dados: dict) -> str:
    chave = os.environ.get("ANTHROPIC_API_KEY")
    if not chave:
        raise RuntimeError("sem_chave")

    corpo = json.dumps({
        "model": MODELO,
        "max_tokens": 4000,
        "messages": [{
            "role": "user",
            "content": (
                f"{prompt_base()}\n\n---\n\n"
                f"Titulo: {dados['titulo']}\nCanal: {dados['canal']}\n\n"
                f"Transcricao:\n\n{dados['texto']}"
            ),
        }],
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=corpo,
        headers={
            "content-type": "application/json",
            "x-api-key": chave,
            "anthropic-version": "2023-06-01",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            dado = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"API respondeu {e.code}: {e.read().decode('utf-8')[:300]}")
    return "".join(b.get("text", "") for b in dado.get("content", []) if b.get("type") == "text")


# ------------------------------------------------------------------ arquivos

def listar() -> list[dict]:
    itens = []
    for arq in sorted(TRANSCRICOES.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True):
        cabecalho = arq.read_text(encoding="utf-8", errors="ignore").split("\n", 6)[:6]
        titulo = next((l[2:] for l in cabecalho if l.startswith("# ")), arq.stem)
        itens.append({
            "id": arq.stem,
            "titulo": titulo,
            "data": datetime.fromtimestamp(arq.stat().st_mtime).strftime("%d/%m %H:%M"),
            "temAnalise": (ANALISES / f"{arq.stem}.md").exists(),
        })
    return itens


def ler(item_id: str) -> dict:
    t = TRANSCRICOES / f"{item_id}.md"
    a = ANALISES / f"{item_id}.md"
    if not t.exists():
        raise RuntimeError("Item nao encontrado.")
    return {
        "id": item_id,
        "transcricao": t.read_text(encoding="utf-8", errors="ignore"),
        "analise": a.read_text(encoding="utf-8", errors="ignore") if a.exists() else "",
    }


def processar(url: str) -> dict:
    dados = baixar_transcricao(url)
    item_id = slug(dados["titulo"])
    TRANSCRICOES.mkdir(exist_ok=True)
    ANALISES.mkdir(exist_ok=True)

    cabecalho = (
        f"# {dados['titulo']}\n\n"
        f"Canal: {dados['canal']}  \nDuracao: {dados['duracao']}  \n"
        f"Fonte: {url}  \nPalavras: {dados['palavras']}\n\n---\n\n"
    )
    (TRANSCRICOES / f"{item_id}.md").write_text(cabecalho + dados["texto"], encoding="utf-8")

    resultado = {"id": item_id, "titulo": dados["titulo"], "canal": dados["canal"],
                 "palavras": dados["palavras"], "analise": "", "aviso": ""}
    try:
        analise = analisar(dados)
        (ANALISES / f"{item_id}.md").write_text(
            f"# Analise: {dados['titulo']}\n\nFonte: {url}\n\n---\n\n{analise}", encoding="utf-8")
        resultado["analise"] = analise
    except RuntimeError as e:
        if str(e) == "sem_chave":
            resultado["aviso"] = ("Transcricao salva. Para a analise automatica, configure "
                                  "ANTHROPIC_API_KEY, ou peca ao Claude Code para ler a pasta.")
        else:
            resultado["aviso"] = f"Transcricao salva, mas a analise falhou. {e}"
    return resultado


# ---------------------------------------------------------------- servidor

PAGINA = """<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Insights de video</title>
<style>
  :root {
    --tinta: #1d2b2a;
    --papel: #f3f1ec;
    --musgo: #3d6b55;
    --musgo-claro: #e3ebe5;
    --areia: #d8d2c6;
    --sombra: #7b7a73;
    --ambar: #9c6b1f;
    --erro: #8c3a2e;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --tinta: #e8e6df; --papel: #16201f; --musgo: #7fb195; --musgo-claro: #22302d;
      --areia: #2e3b38; --sombra: #98a29d; --ambar: #d6a350; --erro: #d98878;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--papel); color: var(--tinta);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 16px; line-height: 1.5;
  }
  header { padding: 32px 28px 24px; border-bottom: 1px solid var(--areia); }
  h1 { margin: 0 0 4px; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
  header p { margin: 0 0 22px; color: var(--sombra); font-size: 14px; }
  .barra { display: flex; gap: 10px; max-width: 760px; }
  input[type=url] {
    flex: 1; padding: 13px 15px; font-size: 15px; font-family: inherit;
    border: 1px solid var(--areia); border-radius: 6px;
    background: transparent; color: var(--tinta);
  }
  input[type=url]:focus { outline: 2px solid var(--musgo); outline-offset: 1px; border-color: transparent; }
  button {
    padding: 13px 22px; font-size: 15px; font-family: inherit; font-weight: 500;
    border: 0; border-radius: 6px; background: var(--musgo); color: var(--papel); cursor: pointer;
  }
  button:disabled { opacity: .55; cursor: progress; }
  .status { margin-top: 12px; font-size: 14px; color: var(--sombra); min-height: 20px; max-width: 760px; }
  .status.ruim { color: var(--erro); }
  main { display: grid; grid-template-columns: 270px 1fr; min-height: 60vh; }
  aside { border-right: 1px solid var(--areia); padding: 18px 0; }
  aside h2 { font-size: 13px; font-weight: 600; color: var(--sombra); margin: 0 0 10px; padding: 0 18px; }
  .item { display: block; width: 100%; text-align: left; background: none; color: var(--tinta);
          border: 0; border-left: 3px solid transparent; border-radius: 0;
          padding: 11px 18px; cursor: pointer; font-size: 14px; line-height: 1.35; }
  .item:hover { background: var(--musgo-claro); }
  .item[aria-current=true] { border-left-color: var(--musgo); background: var(--musgo-claro); }
  .item span { display: block; color: var(--sombra); font-size: 12px; margin-top: 3px; }
  .vazio { padding: 0 18px; color: var(--sombra); font-size: 14px; }
  section { padding: 22px 30px 60px; min-width: 0; }
  .abas { display: flex; gap: 20px; border-bottom: 1px solid var(--areia); margin-bottom: 22px; }
  .aba { background: none; color: var(--sombra); border: 0; border-bottom: 2px solid transparent;
         border-radius: 0; padding: 8px 0; font-size: 14px; cursor: pointer; }
  .aba[aria-selected=true] { color: var(--tinta); border-bottom-color: var(--musgo); }
  .texto { max-width: 68ch; font-family: Iowan Old Style, Palatino Linotype, Georgia, serif;
           font-size: 17px; line-height: 1.65; white-space: pre-wrap; }
  .texto h1, .texto h2 { font-family: inherit; }
  @media (max-width: 760px) { main { grid-template-columns: 1fr; } aside { border-right: 0; border-bottom: 1px solid var(--areia); } }
</style>
</head>
<body>
<header>
  <h1>Insights de video</h1>
  <p>Cole o link, receba a transcricao limpa e a leitura do que da para usar.</p>
  <div class="barra">
    <input type="url" id="url" placeholder="https://www.youtube.com/watch?v=..." autocomplete="off">
    <button id="enviar">Processar</button>
  </div>
  <div class="status" id="status"></div>
</header>
<main>
  <aside>
    <h2>Processados</h2>
    <div id="lista"><p class="vazio">Nada ainda.</p></div>
  </aside>
  <section>
    <div class="abas">
      <button class="aba" id="abaAnalise" aria-selected="true">Analise</button>
      <button class="aba" id="abaTranscricao" aria-selected="false">Transcricao</button>
    </div>
    <div class="texto" id="conteudo">Escolha um video na lista, ou processe um link novo.</div>
  </section>
</main>
<script>
let atual = null, aba = "analise", dados = {};

const $ = (id) => document.getElementById(id);

function render() {
  const alvo = aba === "analise" ? dados.analise : dados.transcricao;
  $("conteudo").textContent = alvo || (atual
    ? "Sem analise salva para esse video. Peca ao Claude Code para ler a pasta transcricoes/."
    : "Escolha um video na lista, ou processe um link novo.");
  $("abaAnalise").setAttribute("aria-selected", aba === "analise");
  $("abaTranscricao").setAttribute("aria-selected", aba === "transcricao");
}

async function carregarLista(selecionar) {
  const itens = await (await fetch("/api/lista")).json();
  const lista = $("lista");
  lista.innerHTML = itens.length ? "" : '<p class="vazio">Nada ainda.</p>';
  itens.forEach((i) => {
    const b = document.createElement("button");
    b.className = "item";
    b.setAttribute("aria-current", i.id === (selecionar || atual));
    b.innerHTML = "";
    b.appendChild(document.createTextNode(i.titulo));
    const s = document.createElement("span");
    s.textContent = i.data + (i.temAnalise ? " · com analise" : " · so transcricao");
    b.appendChild(s);
    b.onclick = () => abrir(i.id);
    lista.appendChild(b);
  });
  if (selecionar) abrir(selecionar);
}

async function abrir(id) {
  atual = id;
  dados = await (await fetch("/api/item?id=" + encodeURIComponent(id))).json();
  document.querySelectorAll(".item").forEach((b) => b.setAttribute("aria-current", false));
  render();
  carregarLista();
}

async function processar() {
  const url = $("url").value.trim();
  if (!url) return;
  const botao = $("enviar"), status = $("status");
  botao.disabled = true;
  status.className = "status";
  status.textContent = "Baixando a legenda e lendo o video. Isso leva de 20 a 60 segundos.";
  try {
    const r = await fetch("/api/processar", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.erro || "falhou");
    status.textContent = j.aviso || ("Pronto: " + j.titulo + ", " + j.palavras + " palavras.");
    $("url").value = "";
    aba = j.analise ? "analise" : "transcricao";
    carregarLista(j.id);
  } catch (e) {
    status.className = "status ruim";
    status.textContent = e.message;
  } finally {
    botao.disabled = false;
  }
}

$("enviar").onclick = processar;
$("url").addEventListener("keydown", (e) => { if (e.key === "Enter") processar(); });
$("abaAnalise").onclick = () => { aba = "analise"; render(); };
$("abaTranscricao").onclick = () => { aba = "transcricao"; render(); };
carregarLista();
</script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _json(self, dado, codigo=200):
        corpo = json.dumps(dado).encode("utf-8")
        self.send_response(codigo)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        if self.path == "/" or self.path.startswith("/?"):
            corpo = PAGINA.encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
        elif self.path == "/api/lista":
            self._json(listar())
        elif self.path.startswith("/api/item"):
            item_id = self.path.split("id=", 1)[-1]
            item_id = urllib.parse.unquote(item_id)
            try:
                self._json(ler(item_id))
            except RuntimeError as e:
                self._json({"erro": str(e)}, 404)
        else:
            self._json({"erro": "rota desconhecida"}, 404)

    def do_POST(self):
        if self.path != "/api/processar":
            return self._json({"erro": "rota desconhecida"}, 404)
        tamanho = int(self.headers.get("content-length", 0))
        pedido = json.loads(self.rfile.read(tamanho) or b"{}")
        url = (pedido.get("url") or "").strip()
        if not url.startswith("http"):
            return self._json({"erro": "Cole uma URL completa, comecando com https."}, 400)
        try:
            self._json(processar(url))
        except Exception as e:
            self._json({"erro": str(e)}, 500)


def main() -> int:
    p = argparse.ArgumentParser(description="Painel local de insights de video.")
    p.add_argument("--porta", type=int, default=8787)
    p.add_argument("--sem-navegador", action="store_true")
    args = p.parse_args()

    TRANSCRICOES.mkdir(exist_ok=True)
    ANALISES.mkdir(exist_ok=True)

    endereco = f"http://localhost:{args.porta}"
    print(f"Painel no ar em {endereco}")
    print("Chave de API:", "configurada" if os.environ.get("ANTHROPIC_API_KEY") else "nao configurada, so transcricao")
    print("Para parar, Ctrl+C.\n")
    if not args.sem_navegador:
        webbrowser.open(endereco)
    try:
        ThreadingHTTPServer(("127.0.0.1", args.porta), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\nPainel encerrado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
