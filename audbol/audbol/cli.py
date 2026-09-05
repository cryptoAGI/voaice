# SPDX-License-Identifier: Apache-2.0
"""audbol on the command line.

    python -m audbol measure FILE [--json out.json] [--only name,name]
    python -m audbol chart   FILE --out DIR
    python -m audbol compare A.json B.json
    python -m audbol bands   FILE
    python -m audbol serve   FILE [--host 127.0.0.1] [--port 8770]
    python -m audbol template DIR [--force]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _measure(a):
    from .report import report, to_json
    names = [n.strip() for n in a.only.split(",")] if a.only else None
    r = report(a.file, names)
    if a.json:
        Path(a.json).write_text(to_json(r), encoding="utf-8")
        print("wrote %s" % a.json)
    src = r["source"]
    print("%s  %s/%s  %d Hz  %dch  %d frames  sha256 %s"
          % (Path(src["path"]).name, src["container"], src["encoding"],
             src["sample_rate"], src["channels"], src["frames"], src["sha256"][:16]))
    w = max(len(k) for k in r["measurements"])
    for k, v in r["measurements"].items():
        # The full 18 places, because the terminal is a record too. Round at the
        # point of publication, not at the point of measurement.
        print("  %-*s %28s %-6s %s" % (w, k, v["value"], v["unit"] or "", v["exactness"]))
    return 0


def _chart(a):
    from .read import read
    from . import chart as C, measure as M
    from .fixed import Fixed18
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    clip = read(a.file)
    name = Path(a.file).stem

    (out / (name + "-spectrum.svg")).write_text(
        C.spectrum(clip, "%s — spectrum" % name), encoding="utf-8")

    bands = [(b, M.band_energy(clip, b)) for b in M.BANDS]
    (out / (name + "-bands.svg")).write_text(
        C.bars(bands, "%s — power by band" % name,
               "fraction of total power; intelligibility is 700–3200 Hz",
               highlight={"intelligibility"}, places=6), encoding="utf-8")

    levels = [("peak", M.peak_dbfs(clip)), ("rms", M.rms_dbfs(clip)),
              ("crest", M.crest_factor_db(clip))]
    (out / (name + "-levels.svg")).write_text(
        C.bars(levels, "%s — levels" % name, "decibels", places=4), encoding="utf-8")

    for f in sorted(out.glob(name + "-*.svg")):
        print("%s  %d bytes" % (f, f.stat().st_size))
    return 0


def _compare(a):
    from .report import compare, to_json
    x = json.loads(Path(a.a).read_text())
    y = json.loads(Path(a.b).read_text())
    d = compare(x, y)
    same = sum(1 for v in d.values() if v.get("same"))
    print("%d measurements, %d identical, %d differ" % (len(d), same, len(d) - same))
    for k, v in d.items():
        if v.get("same") or "only_in" in v:
            continue
        print("  %-22s %24s -> %-24s  %s %s" % (k, v["a"], v["b"], v["delta"], v["unit"]))
    return 0


def _bands(a):
    from .read import read
    from . import measure as M
    clip = read(a.file)
    for b, (lo, hi) in M.BANDS.items():
        v = M.band_energy(clip, b)
        print("  %-16s %7.0f–%-7.0f Hz  %s" % (b, lo, hi, v.round(9)))
    return 0


def _serve(a):
    from .serve import serve
    return serve(a.file, a.host, a.port)


def _template(a):
    """Copy the substrate out as a starting point: the five modules, the template
    page, and the two notes. Refuses to overwrite, because a copy someone has
    started extending is exactly the file this must not replace."""
    import shutil
    src = Path(__file__).resolve().parent.parent / "substrate"
    dst = Path(a.dir)
    files = sorted(src.glob("*.js")) + [src / "template.html", src / "PROVENANCE.md", src / "TEMPLATE.md"]
    dst.mkdir(parents=True, exist_ok=True)
    clash = [f.name for f in files if (dst / f.name).exists()]
    if clash and not a.force:
        print("refusing to overwrite %s in %s (use --force)" % (", ".join(clash), dst))
        return 1
    for f in files:
        shutil.copyfile(f, dst / f.name)
        print("  %s" % (dst / f.name))
    print("open %s from disk, pick a file, press PLAY; TEMPLATE.md says where to extend" % (dst / "template.html"))
    return 0


def main(argv=None):
    p = argparse.ArgumentParser("audbol", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("measure", help="the standard battery, at full precision")
    m.add_argument("file"); m.add_argument("--json"); m.add_argument("--only")
    m.set_defaults(fn=_measure)

    c = sub.add_parser("chart", help="write SVG charts")
    c.add_argument("file"); c.add_argument("--out", default=".")
    c.set_defaults(fn=_chart)

    d = sub.add_parser("compare", help="difference two reports on the integers")
    d.add_argument("a"); d.add_argument("b")
    d.set_defaults(fn=_compare)

    b = sub.add_parser("bands", help="power by named band")
    b.add_argument("file")
    b.set_defaults(fn=_bands)

    s = sub.add_parser("serve", help="the instrument: the substrate over the file, selections re-measured on the host")
    s.add_argument("file"); s.add_argument("--host", default="127.0.0.1"); s.add_argument("--port", type=int, default=8770)
    s.set_defaults(fn=_serve)

    t = sub.add_parser("template", help="copy the substrate + template page out as a starting point")
    t.add_argument("dir"); t.add_argument("--force", action="store_true")
    t.set_defaults(fn=_template)

    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
