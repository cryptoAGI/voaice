#!/usr/bin/env python3
"""pronounce — how a voice SAYS the names it reads. One table, every engine.

A synthesiser does not know the realm's names. piper phonemizes through espeak-ng, and espeak-ng reads
PYTHAI as /ˈpaɪtaɪ/, "pie-tie" — whisper.cpp heard a render of it as "Paitai". The name is Pyth-A-I.
The fix is a RESPELLING applied to the text handed to the synthesiser, and nowhere else: captions,
highlighting, word counts and fingerprints keep the page's own spelling.

The table is pronunciation/lexicon.json (format voaice-pronunciation/1). engine/pronounce.js is the
browser/Node twin of this file; test/test_pronounce.py requires the two to produce identical text.

  python3 tools/pronounce.py list
  python3 tools/pronounce.py say "PYTHAI's stated target"          # the text as the synthesiser gets it
  python3 tools/pronounce.py find article.txt                        # which names in a text the table changes
  python3 tools/pronounce.py check PYTHAI                            # espeak-ng IPA: as written, as said
  python3 tools/pronounce.py add SAVANTE "Sa vahnt" --why "…" --source "operator, 2026-09-14"

Rules the table keeps (and `add` enforces):
  * matching is case-insensitive and in ONE pass, longest match first, so PYTHAIML is never read as
    PYTHAI + "ML" and a spoken form is never matched again;
  * a spoken form may not contain any entry's match — it would read differently in a second pass by
    an engine that applies the table twice;
  * every change bumps `version`, and every rendered file records the version it was made with, so a
    store can find the renders a change makes wrong.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TABLE = ROOT / "pronunciation" / "lexicon.json"
FORMAT = "voaice-pronunciation/1"


def load(path=TABLE):
    t = json.loads(Path(path).read_text(encoding="utf-8"))
    if t.get("format") != FORMAT:
        raise SystemExit("%s: format is %r, expected %r" % (path, t.get("format"), FORMAT))
    return t


def compile_table(table):
    ents = sorted(table.get("entries", []), key=lambda e: -len(e["match"]))
    if not ents:
        return None, {}
    rx = re.compile("|".join(re.escape(e["match"]) for e in ents), re.IGNORECASE)
    return rx, {e["match"].lower(): e["say"] for e in ents}


def spoken(text, table=None):
    """The text as the synthesiser should receive it."""
    rx, say = compile_table(table if table is not None else load())
    return rx.sub(lambda m: say[m.group(0).lower()], text) if rx else text


def find(text, table=None):
    rx, _ = compile_table(table if table is not None else load())
    counts = {}
    for m in (rx.finditer(text) if rx else []):
        counts[m.group(0)] = counts.get(m.group(0), 0) + 1
    return counts


def espeak_ipa(text, voice):
    exe = shutil.which("espeak-ng") or shutil.which("espeak")
    if not exe:
        return None
    r = subprocess.run([exe, "-q", "--ipa", "-v", voice], input=text.encode("utf-8"), capture_output=True, timeout=30)
    return " ".join(r.stdout.decode("utf-8", "replace").split())


def validate(table):
    problems = []
    matches = [e["match"].lower() for e in table.get("entries", [])]
    if len(set(matches)) != len(matches):
        problems.append("duplicate match")
    for e in table.get("entries", []):
        for m in matches:
            if m in e["say"].lower():
                problems.append("%s: its spoken form %r contains the match %r" % (e["match"], e["say"], m))
    if not isinstance(table.get("version"), int):
        problems.append("version must be an integer")
    return problems


def save(table, path=TABLE):
    table["entries"] = sorted(table["entries"], key=lambda e: (-len(e["match"]), e["match"].lower()))
    Path(path).write_text(json.dumps(table, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="how a voice says the names it reads")
    ap.add_argument("--table", default=str(TABLE))
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    p = sub.add_parser("say"); p.add_argument("text", nargs="+")
    p = sub.add_parser("find"); p.add_argument("file", help="a text file, or - for stdin")
    p = sub.add_parser("check"); p.add_argument("term"); p.add_argument("--voice", default="en-gb")
    p = sub.add_parser("add")
    p.add_argument("match"); p.add_argument("say")
    p.add_argument("--why", required=True); p.add_argument("--source", required=True)
    p.add_argument("--voice", default="en-gb")
    a = ap.parse_args()
    table = load(a.table)

    if a.cmd == "list":
        print("%s · version %d · %d entries" % (table["format"], table["version"], len(table["entries"])))
        for e in table["entries"]:
            print("  %-12s → %-14s %s" % (e["match"], '"%s"' % e["say"], e.get("why", "")))
    elif a.cmd == "say":
        print(spoken(" ".join(a.text), table))
    elif a.cmd == "find":
        text = sys.stdin.read() if a.file == "-" else Path(a.file).read_text(encoding="utf-8")
        hits = find(text, table)
        for k, n in sorted(hits.items(), key=lambda kv: -kv[1]):
            print("  %-14s ×%d → %s" % (k, n, spoken(k, table)))
        if not hits:
            print("  nothing in this text is in the table")
    elif a.cmd == "check":
        said = spoken(a.term, table)
        written, heard = espeak_ipa(a.term, a.voice), espeak_ipa(said, a.voice)
        if written is None:
            print("espeak-ng is not installed; the table says %r → %r" % (a.term, said))
            return 1
        print("as written  %-14s /%s/" % (a.term, written))
        print("as said     %-14s /%s/%s" % (said, heard, "" if said != a.term else "   (not in the table)"))
    elif a.cmd == "add":
        entry = {"match": a.match, "say": a.say, "why": a.why, "source": a.source,
                 "ipaWritten": espeak_ipa(a.match, a.voice), "ipaSaid": espeak_ipa(a.say, a.voice),
                 "phonemizer": "espeak-ng %s" % a.voice, "added": time.strftime("%Y-%m-%d")}
        entries = [e for e in table["entries"] if e["match"].lower() != a.match.lower()]
        candidate = dict(table, entries=entries + [entry], version=table["version"] + 1)
        problems = validate(candidate)
        if problems:
            print("refused:\n  " + "\n  ".join(problems))
            return 1
        save(candidate, a.table)
        print("version %d: %s → %r  /%s/ → /%s/" % (candidate["version"], a.match, a.say, entry["ipaWritten"], entry["ipaSaid"]))
        print("every render made with an older version that contains %s now reads it the old way — re-render it" % a.match)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
