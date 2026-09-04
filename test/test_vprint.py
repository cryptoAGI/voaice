#!/usr/bin/env python3
"""test_vprint.py — the Python vprint and the browser's must produce the same digest.

WHY THIS IS THE ONLY TEST THAT MATTERS HERE. "The same voiceprint" is a claim
about two independent implementations of one spec, and two implementations of one
spec disagree by default — over key order, over float rounding, over whether JSON
has spaces in it. Every one of those produces a different hash while both sides
look correct in isolation. So the real `engine/oscilloscope.js` is run under node
against the same metric inputs, and the digests are required to be equal.

The metric VALUES are supplied identically to both sides on purpose. The FFT
front-ends genuinely differ — a browser AnalyserNode and numpy are not the same
windowing — and that difference is a property of the measurement, not of the
encoding. What has to agree is everything after the eight floats.

    python3 test/test_vprint.py          (needs node for the cross-check)
"""
import json
import math
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import vprint  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FAIL = []

# Awkward on purpose: a zero, an integer, a long repeating decimal, something
# very small, something large, and a value whose float multiply by 1e18 lands
# near a boundary. Tidy numbers would hide exactly the rounding this is for.
CASES = [
    {"rms": 0.0, "dominantFrequency": 0.0, "spectralCentroid": 0.0, "spectralRolloff": 0.0,
     "zeroCrossingRate": 0.0, "spectralBandwidth": 0.0, "spectralFlux": 0.0,
     "harmonicNoiseRatio": 0.0},
    {"rms": 1.0, "dominantFrequency": 182.0, "spectralCentroid": 1234.5,
     "spectralRolloff": 3000.0, "zeroCrossingRate": 0.5, "spectralBandwidth": 900.25,
     "spectralFlux": 2.0, "harmonicNoiseRatio": 12.0},
    {"rms": 0.1, "dominantFrequency": 1 / 3, "spectralCentroid": 2 / 3,
     "spectralRolloff": 0.30000000000000004, "zeroCrossingRate": 1e-9,
     "spectralBandwidth": math.pi, "spectralFlux": math.e,
     "harmonicNoiseRatio": 1e6 + 0.7},
    {"rms": 0.049999999999999996, "dominantFrequency": 96.29999999999998,
     "spectralCentroid": 181.5000000000001, "spectralRolloff": 0.1 + 0.2,
     "zeroCrossingRate": 7 / 11, "spectralBandwidth": 1 / 7,
     "spectralFlux": 1e-18, "harmonicNoiseRatio": 2 ** 0.5},
]

NODE = r"""
const path = process.argv[2], cases = JSON.parse(require('fs').readFileSync(path, 'utf8'));
global.crypto = require('crypto').webcrypto;
const DVScope = require(process.argv[3]);
(async () => {
  const out = [];
  for (const values of cases) {
    // Build precision18 exactly as metrics() does, from the given floats, then
    // print it. This exercises toPrecision18 / fromPrecision18 / voiceprint —
    // everything downstream of the eight numbers.
    const p18 = {};
    for (const k of ['rms','dominantFrequency','spectralCentroid','spectralRolloff',
                     'zeroCrossingRate','spectralBandwidth','spectralFlux','harmonicNoiseRatio']) {
      const b = DVScope.toPrecision18(values[k]);
      p18[k] = { wei: b.toString(), decimal: DVScope.fromPrecision18(b) };
    }
    const vp = await DVScope.voiceprint({ precision18: p18 });
    out.push({ hash: vp.hash, hash512: vp.hash512, uint256: vp.uint256, p18 });
  }
  process.stdout.write(JSON.stringify(out));
})().catch(e => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });
"""


def main() -> int:
    print("cases:", len(CASES))
    mine = [vprint.vprint(c) for c in CASES]

    with tempfile.TemporaryDirectory() as d:
        cj = os.path.join(d, "cases.json")
        nj = os.path.join(d, "run.js")
        open(cj, "w").write(json.dumps(CASES))
        open(nj, "w").write(NODE)
        eng = os.path.abspath(os.path.join(ROOT, "engine", "oscilloscope.js"))
        try:
            r = subprocess.run(["node", nj, cj, eng], capture_output=True, text=True, timeout=60)
        except FileNotFoundError:
            print("SKIPPED — node is not installed, so the cross-check cannot run.\n"
                  "         The Python side alone proves nothing about agreement.")
            return 0
        if r.returncode != 0:
            FAIL.append("node failed: %s" % (r.stderr or "")[:300])
            theirs = []
        else:
            theirs = json.loads(r.stdout)

    for i, (a, b) in enumerate(zip(mine, theirs)):
        same = a["hash"] == b["hash"] and a["hash512"] == b["hash512"] and a["uint256"] == b["uint256"]
        print("  case %d  %s  py=%s  js=%s" % (i, "AGREE " if same else "DIFFER", a["short"], b["hash"][:16]))
        if not same:
            for k in vprint.METRICS:
                if a["precision18"][k] != b["p18"][k]:
                    FAIL.append("case %d: %s encodes as py=%s js=%s"
                                % (i, k, a["precision18"][k], b["p18"][k]))
            if not any("case %d" % i in f for f in FAIL):
                FAIL.append("case %d: identical encodings but different digests — the "
                            "canonical JSON differs" % i)

    # And the encoding itself, checked against values worked out by hand.
    print("\nencoding")
    for v, want in [(1.0, 10 ** 18), (0.5, 5 * 10 ** 17), (0.0, 0), (float("nan"), 0),
                    (float("inf"), 0)]:
        got = vprint.to_precision18(v)
        print("  %-6s -> %s" % (v, got))
        if got != want:
            FAIL.append("to_precision18(%s) = %s, wanted %s" % (v, got, want))
    if vprint.from_precision18(10 ** 18) != "1.000000000000000000":
        FAIL.append("from_precision18 does not pad to 18")

    # A print refuses to compare across parameters rather than inventing a number.
    print("\ncomparability")
    a = dict(vprint.vprint(CASES[1]), params={"fftSize": 2048, "sampleRate": 22050})
    b = dict(vprint.vprint(CASES[1]), params={"fftSize": 8192, "sampleRate": 22050})
    c = dict(vprint.vprint(CASES[1]), params={"fftSize": 2048, "sampleRate": 22050})
    r1, r2 = vprint.compare(a, b), vprint.compare(a, c)
    print("  different fftSize -> comparable=%s" % r1["comparable"])
    print("  same parameters   -> comparable=%s identical=%s" % (r2["comparable"], r2.get("identical")))
    if r1["comparable"]:
        FAIL.append("compared two prints measured with different parameters")
    if not r2.get("identical"):
        FAIL.append("two identical measurements did not compare as identical")

    print("\n" + "=" * 68)
    if FAIL:
        print("%d FAILURE(S):" % len(FAIL))
        for f in FAIL:
            print("  -", f)
        return 1
    print("python and the browser agree on every case")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
