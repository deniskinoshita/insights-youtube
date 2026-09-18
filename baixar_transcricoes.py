#!/usr/bin/env python3
"""
Baixa as legendas de uma lista de videos do YouTube e limpa para texto corrido.

Uso:
    python baixar_transcricoes.py links.txt
    python baixar_transcricoes.py links.txt --saida minha_pasta

O arquivo links.txt deve ter uma URL por linha. Linhas vazias e linhas
comecando com # sao ignoradas.

Requer yt-dlp instalado:
    pip install -U yt-dlp
"""

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

LANGS = "pt-BR,pt,pt-orig,en,en-orig"

TIMESTAMP = re.compile(r"^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->")
TAGS = re.compile(r"<[^>]+>")
CUE_SETTINGS = re.compile(r"align:\S+|position:\S+|line:\S+|size:\S+")


def ler_links(caminho: Path) -> list[str]:
    linhas = caminho.read_text(encoding="utf-8").splitlines()
    return [l.strip() for l in linhas if l.strip() and not l.strip().startswith("#")]


def limpar_vtt(texto: str) -> str:
    """Transforma um .vtt (inclusive legenda automatica com linhas rolantes) em texto corrido."""
    saida: list[str] = []
    for linha in texto.splitlines():
        linha = linha.strip()
        if not linha:
            continue
        if linha.startswith(("WEBVTT", "Kind:", "Language:", "NOTE", "STYLE")):
            continue
        if TIMESTAMP.search(linha):
            continue
        if linha.isdigit():
            continue
        linha = TAGS.sub("", linha)
        linha = CUE_SETTINGS.sub("", linha)
        linha = re.sub(r"\s+", " ", linha).strip()
        if not linha:
            continue
        # legenda automatica repete a linha anterior a cada bloco
        if saida and linha == saida[-1]:
            continue
        if saida and saida[-1].endswith(linha):
            continue
        if saida and linha.startswith(saida[-1]):
            saida[-1] = linha
            continue
        saida.append(linha)
    return " ".join(saida)


def quebrar_paragrafos(texto: str, frases_por_paragrafo: int = 5) -> str:
    frases = re.split(r"(?<=[.!?])\s+", texto)
    blocos = [
        " ".join(frases[i : i + frases_por_paragrafo])
        for i in range(0, len(frases), frases_por_paragrafo)
    ]
    return "\n\n".join(b for b in blocos if b.strip())


def baixar(url: str, destino: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        cmd = [
            "yt-dlp",
            "--skip-download",
            "--write-subs",
            "--write-auto-subs",
            "--sub-langs", LANGS,
            "--sub-format", "vtt",
            "--convert-subs", "vtt",
            "--restrict-filenames",
            "-o", str(tmp_path / "%(title).120s.%(ext)s"),
            url,
        ]
        resultado = subprocess.run(cmd, capture_output=True, text=True)
        if resultado.returncode != 0:
            print(f"  [erro] {url}\n  {resultado.stderr.strip().splitlines()[-1:]}")
            return

        arquivos = sorted(tmp_path.glob("*.vtt"))
        if not arquivos:
            print(f"  [sem legenda] {url}")
            return

        # prefere legenda em portugues quando existir
        preferido = next((a for a in arquivos if ".pt" in a.name), arquivos[0])
        texto = limpar_vtt(preferido.read_text(encoding="utf-8", errors="ignore"))
        if not texto:
            print(f"  [legenda vazia] {url}")
            return

        nome = re.sub(r"\.[a-zA-Z-]+\.vtt$", "", preferido.name)
        alvo = destino / f"{nome}.txt"
        cabecalho = f"# {nome}\nFonte: {url}\n\n"
        alvo.write_text(cabecalho + quebrar_paragrafos(texto), encoding="utf-8")
        print(f"  ok -> {alvo.name} ({len(texto.split())} palavras)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Baixa e limpa transcricoes do YouTube.")
    parser.add_argument("lista", type=Path, help="arquivo .txt com uma URL por linha")
    parser.add_argument("--saida", type=Path, default=Path("transcricoes"))
    args = parser.parse_args()

    if not shutil.which("yt-dlp"):
        print("yt-dlp nao encontrado. Instale com: pip install -U yt-dlp")
        return 1
    if not args.lista.exists():
        print(f"Arquivo nao encontrado: {args.lista}")
        return 1

    args.saida.mkdir(parents=True, exist_ok=True)
    links = ler_links(args.lista)
    print(f"{len(links)} video(s) na fila. Salvando em {args.saida}/\n")

    for i, url in enumerate(links, 1):
        print(f"[{i}/{len(links)}] {url}")
        baixar(url, args.saida)

    print("\nPronto. Agora e so pedir ao Claude Code para ler a pasta.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
