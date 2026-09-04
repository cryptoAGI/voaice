#!/usr/bin/env python3
"""vprint.py — the voiceprint, server-side, agreeing byte for byte with the browser.

WHAT A VPRINT IS. Eight acoustic metrics, each encoded as an 18-decimal
fixed-point integer, canonicalised as JSON and hashed with SHA-256 and SHA-512.
The 256-bit digest is also read as a uint256, which is what makes it something a
contract can hold. The definition lives in `engine/oscilloscope.js` (`DVScope`)
and this file is its twin: same metric order, same encoding, same canonical form,
same digest.

WHAT A VPRINT IS NOT, and this matters more than what it is:

  A vprint is a fingerprint OF A MEASUREMENT, not of a speaker.

Change the FFT size, the sample rate, the window, the loudness normalisation or
the length of the excerpt and every metric moves, so the print moves with them.
Two recordings of the same person measured differently produce different prints,
and that is not a bug — it is what "fixed-point hash of eight floats" means. Any
comparison has to hold the measurement parameters fixed on both sides, and
`compare()` refuses to compare prints whose parameters differ rather than
returning a number that looks like an answer.

So: a vprint identifies a rendering. It is evidence that two files came from the
same measured signal. It is NOT a biometric and must not be used as one.

THE CROSS-IMPLEMENTATION TEST IS THE POINT. `test/test_vprint.py` feeds identical
metric inputs to this module and to the real `oscilloscope.js` under node, and
requires the two digests to match. Without that, "the same voiceprint" is a claim
rather than a fact — two implementations of the same spec disagree by default.
"""
from __future__ import annotations

import hashlib
import json
import math
from typing import Iterable, Sequence

PRECISION = 18
MUL = 1e18                       # a float, deliberately — see to_precision18
UINT256_MAX = (1 << 256) - 1

# ORDER IS PART OF THE FORMAT. The canonical JSON is built from an ordered map,
# so a different order is a different string and therefore a different hash. This
# is the order `metrics()` inserts them in, in oscilloscope.js, and it must not be
# sorted, tidied or alphabetised.
METRICS = ("rms", "dominantFrequency", "spectralCentroid", "spectralRolloff",
           "zeroCrossingRate", "spectralBandwidth", "spectralFlux", "harmonicNoiseRatio")


def to_precision18(v: float) -> int:
    """Match `BigInt(Math.floor(v * MUL))` exactly.

    MUL IS A FLOAT ON BOTH SIDES AND HAS TO BE. JavaScript multiplies the metric
    by the Number 1e18 and floors the result, so the rounding of that IEEE-754
    multiply is part of the value. Doing it in Python with an exact integer 10**18
    — which is the obviously "more correct" thing to reach for — gives a different
    last digit for most inputs, a different canonical string, and a different
    hash. The two implementations would then disagree while both looking right.
    """
    if not isinstance(v, (int, float)) or not math.isfinite(v):
        return 0
    return math.floor(float(v) * MUL)


def from_precision18(b: int) -> str:
    """Match `fromPrecision18`: sign, integer part, '.', 18 padded digits."""
    neg = b < 0
    if neg:
        b = -b
    q, r = divmod(b, 10 ** PRECISION)
    return ("-" if neg else "") + str(q) + "." + str(r).rjust(PRECISION, "0")


def bound(x: int) -> int:
    if x < 0 or x > UINT256_MAX:
        raise ValueError("value outside uint256 [0, 2^256-1]")
    return x


def encode(values: dict) -> dict:
    """{metric: float} -> {metric: {wei, decimal}}, in the canonical order."""
    out = {}
    for k in METRICS:
        if k not in values:
            raise KeyError("missing metric %r; a vprint needs all eight" % k)
        b = to_precision18(values[k])
        out[k] = {"wei": str(b), "decimal": from_precision18(b)}
    return out


def canonical(precision18: dict) -> str:
    """The exact string JSON.stringify produces for the same object.

    No spaces, no sorting, insertion order preserved. `json.dumps` with
    `separators=(',', ':')` and `sort_keys=False` is byte-identical to
    JSON.stringify for this shape.
    """
    return json.dumps({"v": "dvscope/1", "precision": PRECISION, "metrics": precision18},
                      separators=(",", ":"), ensure_ascii=False, sort_keys=False)


def vprint(values: dict) -> dict:
    """The print: SHA-256, SHA-512, and the digest read as a uint256."""
    p18 = encode(values)
    canon = canonical(p18)
    sha256 = hashlib.sha256(canon.encode("utf-8")).hexdigest()
    sha512 = hashlib.sha512(canon.encode("utf-8")).hexdigest()
    return {"hash": sha256, "hash512": sha512, "short": sha256[:16],
            "uint256": str(bound(int(sha256, 16))), "version": "dvscope/1",
            "precision18": p18, "canonical": canon}


# ── the metrics themselves ───────────────────────────────────────────────────
# Faithful to the formulas in oscilloscope.js. `freq` is MAGNITUDE, never
# decibels — the browser's getFloatFrequencyData returns dB and every formula
# here weights bins with max(0, x), which for a normal all-negative dB spectrum
# is zero in every bin. That failure is silent and the print hashes it as if
# measured, so linear_from_db exists and the callers use it.
def _bin_hz(i: int, n: int, sr: float) -> float:
    return (i * sr) / (2 * n)


def rms(time: Sequence[float]) -> float:
    return math.sqrt(sum(x * x for x in time) / (len(time) or 1))


def zero_crossing_rate(time: Sequence[float]) -> float:
    c = sum(1 for i in range(1, len(time)) if (time[i] >= 0) != (time[i - 1] >= 0))
    return c / (len(time) or 1)


def dominant_frequency(freq: Sequence[float], sr: float) -> float:
    mi, mv = 0, -math.inf
    for i, v in enumerate(freq):
        if v > mv:
            mv, mi = v, i
    return _bin_hz(mi, len(freq), sr)


def spectral_centroid(freq: Sequence[float], sr: float) -> float:
    num = den = 0.0
    for i, v in enumerate(freq):
        m = max(0.0, v)
        num += _bin_hz(i, len(freq), sr) * m
        den += m
    return num / den if den > 0 else 0.0


def spectral_rolloff(freq: Sequence[float], sr: float, frac: float = 0.85) -> float:
    tot = sum(max(0.0, v) for v in freq)
    th, run = tot * frac, 0.0
    for i, v in enumerate(freq):
        run += max(0.0, v)
        if run >= th:
            return _bin_hz(i, len(freq), sr)
    return 0.0


def spectral_bandwidth(freq: Sequence[float], sr: float, centroid: float) -> float:
    num = den = 0.0
    for i, v in enumerate(freq):
        m = max(0.0, v)
        d = _bin_hz(i, len(freq), sr) - centroid
        num += d * d * m
        den += m
    return math.sqrt(num / den) if den > 0 else 0.0


def spectral_flux(freq: Sequence[float], prev: Sequence[float] | None) -> float:
    if not prev:
        return 0.0
    f = 0.0
    for i, v in enumerate(freq):
        d = max(0.0, v - (prev[i] if i < len(prev) else 0.0))
        f += d * d
    return math.sqrt(f)


def harmonic_noise_ratio(freq: Sequence[float]) -> float:
    mx = 0.0
    s = 0.0
    for v in freq:
        m = max(0.0, v)
        if m > mx:
            mx = m
        s += m
    mean = s / (len(freq) or 1)
    return mx / mean if mean > 0 else 0.0


def linear_from_db(db: Iterable[float], floor_db: float = -100.0) -> list:
    """dB -> magnitude, with a floor. See the note above: this is not optional."""
    return [0.0 if d <= floor_db else 10.0 ** (d / 20.0) for d in db]


def measure(time: Sequence[float], freq: Sequence[float], sample_rate: float,
            prev_freq: Sequence[float] | None = None) -> dict:
    """The eight metrics, in the canonical order, from magnitude spectra."""
    cen = spectral_centroid(freq, sample_rate)
    return {
        "rms": rms(time),
        "dominantFrequency": dominant_frequency(freq, sample_rate),
        "spectralCentroid": cen,
        "spectralRolloff": spectral_rolloff(freq, sample_rate),
        "zeroCrossingRate": zero_crossing_rate(time),
        "spectralBandwidth": spectral_bandwidth(freq, sample_rate, cen),
        "spectralFlux": spectral_flux(freq, prev_freq),
        "harmonicNoiseRatio": harmonic_noise_ratio(freq),
    }


def compare(a: dict, b: dict) -> dict:
    """Two prints, and an honest answer about whether they are comparable.

    REFUSING IS THE FEATURE. Prints taken under different measurement parameters
    are not comparable, and returning a similarity score for them would be worse
    than returning nothing: it looks like an answer. The parameters travel with
    the print for exactly this reason.
    """
    pa, pb = a.get("params") or {}, b.get("params") or {}
    if pa and pb and pa != pb:
        diff = sorted(k for k in set(pa) | set(pb) if pa.get(k) != pb.get(k))
        return {"comparable": False,
                "why": "measured with different parameters (%s); a vprint fingerprints a "
                       "measurement, so these cannot be compared" % ", ".join(diff)}
    if a.get("hash") == b.get("hash"):
        return {"comparable": True, "identical": True, "distance": 0.0,
                "why": "identical digests — the same measured signal"}
    wa = {k: int(v["wei"]) for k, v in (a.get("precision18") or {}).items()}
    wb = {k: int(v["wei"]) for k, v in (b.get("precision18") or {}).items()}
    if not wa or not wb:
        return {"comparable": False, "why": "one of these carries no metrics to compare"}
    per = {}
    for k in METRICS:
        x, y = wa.get(k, 0), wb.get(k, 0)
        scale = max(abs(x), abs(y), 1)
        per[k] = abs(x - y) / scale
    return {"comparable": True, "identical": False,
            "distance": sum(per.values()) / len(per), "perMetric": per,
            "why": "relative distance per metric, averaged; 0 is identical and 1 is "
                   "unrelated. This is a distance between MEASUREMENTS, not a "
                   "probability that two people are the same person."}


if __name__ == "__main__":
    import sys
    if len(sys.argv) == 3:
        a = json.load(open(sys.argv[1]))
        b = json.load(open(sys.argv[2]))
        print(json.dumps(compare(a.get("vprint", a), b.get("vprint", b)), indent=1))
    else:
        print(__doc__.strip().splitlines()[0])
        print("\n  python3 vprint.py A.voaice B.voaice     compare two prints")
