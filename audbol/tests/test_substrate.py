"""The substrate is a template: kept byte for byte, copied out whole."""
import hashlib, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUB = ROOT / "substrate"


def recorded_hashes():
    out = {}
    for line in (SUB / "PROVENANCE.md").read_text(encoding="utf-8").splitlines():
        m = re.match(r"\| `([a-z-]+\.js)` \|.*\| `([0-9a-f]{64})` \|", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def test_every_module_matches_its_recorded_hash():
    rec = recorded_hashes()
    assert len(rec) == 5, rec
    for name, h in rec.items():
        got = hashlib.sha256((SUB / name).read_bytes()).hexdigest()
        assert got == h, "%s drifted from PROVENANCE.md — copy it back from upstream and record the new hash" % name


def test_no_unrecorded_module():
    assert {f.name for f in SUB.glob("*.js")} == set(recorded_hashes())


def test_template_page_loads_every_module_relatively():
    html = (SUB / "template.html").read_text(encoding="utf-8")
    for name in recorded_hashes():
        assert 'src="./%s"' % name in html, name
    assert html.count("▶ EXTEND (") == 5            # the five numbered marks TEMPLATE.md explains


def test_template_command_copies_everything(tmp_path):
    from audbol.cli import main
    out = tmp_path / "mine"
    assert main(["template", str(out)]) == 0
    for name in list(recorded_hashes()) + ["template.html", "PROVENANCE.md", "TEMPLATE.md"]:
        assert (out / name).read_bytes() == (SUB / name).read_bytes(), name
    assert main(["template", str(out)]) == 1            # refuses to overwrite a copy you may have edited
    assert main(["template", str(out), "--force"]) == 0
