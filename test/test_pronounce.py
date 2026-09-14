#!/usr/bin/env python3
"""The pronunciation table is one thing, not two.

tools/pronounce.py and engine/pronounce.js are independent implementations of one rule —
case-insensitive, one pass, longest match first. Two implementations disagree by default (regex
flavours, Unicode case folding, replacement order), and a disagreement means the browser and the
render host say a name differently. This runs both over the same sentences and requires identical
output, checks the table's own rules, and pins the cases the table exists for.

  python3 test/test_pronounce.py
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import pronounce  # noqa: E402

CASES = [
    "PYTHAI",
    "PYTHAI’s stated target is a tenth of one percent.",
    "SHAMBA LUV at luv.pythai.net pioneered the pricing of attention.",
    "the PYTHAIML archive, and pythaiml on GitHub",
    "Pythia is the oracle; PYTHAI is not Pythia.",
    "Pythai, pYtHaI, PYTHAI-PYTHAI",
    "nothing here is in the table",
    "",
]

PINNED = {
    "PYTHAI": "Pith AI",
    "PYTHAI’s stated target is a tenth of one percent.": "Pith AI’s stated target is a tenth of one percent.",
    "the PYTHAIML archive, and pythaiml on GitHub": "the Pith AI M L archive, and Pith AI M L on GitHub",
    "Pythia is the oracle; PYTHAI is not Pythia.": "Pythia is the oracle; Pith AI is not Pythia.",
}


def main():
    table = pronounce.load()
    problems = pronounce.validate(table)
    assert not problems, problems
    py = [pronounce.spoken(c, table) for c in CASES]
    for c, want in PINNED.items():
        got = pronounce.spoken(c, table)
        assert got == want, "python: %r → %r, want %r" % (c, got, want)

    node = shutil.which("node")
    if not node:
        print("SKIP parity: node is not installed (python pinned cases pass)")
        return 0
    script = (
        "const P=require(%s).compile(require(%s));"
        "const cases=JSON.parse(require('fs').readFileSync(0,'utf8'));"
        "process.stdout.write(JSON.stringify(cases.map(c=>P.spoken(c))));"
    ) % (json.dumps(str(ROOT / "engine" / "pronounce.js")), json.dumps(str(ROOT / "pronunciation" / "lexicon.json")))
    r = subprocess.run([node, "-e", script], input=json.dumps(CASES).encode("utf-8"), capture_output=True, timeout=30)
    assert r.returncode == 0, r.stderr.decode()
    js = json.loads(r.stdout.decode("utf-8"))
    for c, a, b in zip(CASES, py, js):
        assert a == b, "python and node disagree on %r: %r vs %r" % (c, a, b)
    print("ok: %d cases, python == node, table v%d with %d entries" % (len(CASES), table["version"], len(table["entries"])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
