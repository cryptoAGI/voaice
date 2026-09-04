#!/usr/bin/env python3
"""voaice.py — measure a voice into a .voaice file.

A `.voaice` is what a voice IS, written down: which model speaks it, what it
measured as, and a vprint over those measurements. It is not audio and it is not
a model — it is the identity card that lets you say "this rendering came from
that voice" and be checked on it.

    python3 tools/voaice.py measure a.wav --id neural --label NEURAL \
        --engine piper --model en_GB-alan-medium
    python3 tools/voaice.py show voices/neural.voaice
    python3 tools/voaice.py compare voices/neural.voaice voices/jaimla.voaice

THE PARAMETERS ARE PART OF THE MEASUREMENT, so they are written into the file and
`vprint.compare` refuses to compare across them. Averaging frames, the FFT size,
the window and the hop all move every metric; a print taken with one set is not
evidence about a print taken with another.

f0 IS MEASURED SEPARATELY FROM THE EIGHT, and reported with its spread rather
than as a single number. A voice does not have "a pitch": neural ranges about
90-102 Hz across six sentences and jaimla 168-206, and quoting either median
alone as though it were a constant is how "an octave apart" ends up in prose that
the arithmetic does not support.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vprint as VP  # noqa: E402

FFT = 2048
HOP = 512
WINDOW = "hann"
FORMAT_VERSION = "voaice/1"


def read_wav(path: str):
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2:
            raise SystemExit("only 16-bit PCM wav is read here; got %d bytes/sample"
                             % w.getsampwidth())
        ch, sr, n = w.getnchannels(), w.getframerate(), w.getnframes()
        pcm = np.frombuffer(w.readframes(n), dtype="<i2").astype(np.float64) / 32768.0
    if ch > 1:
        pcm = pcm.reshape(-1, ch).mean(axis=1)      # a profile is of the voice, not the placement
    return pcm, sr


def f0_track(pcm: np.ndarray, sr: int, lo: float = 60.0, hi: float = 400.0) -> list:
    """Median-of-voiced-frames f0 by autocorrelation.

    The same method the DeltaVerse octave calibration uses, and deliberately so:
    a second pitch estimator would give a second answer and there would be no way
    to say which was the voice's.
    """
    win = int(sr * 0.04)                     # 40 ms — a couple of periods at 60 Hz
    step = int(sr * 0.02)
    lo_lag, hi_lag = int(sr / hi), int(sr / lo)
    out = []
    for i in range(0, max(0, len(pcm) - win), step):
        fr = pcm[i:i + win]
        if float(np.sqrt(np.mean(fr ** 2))) < 0.01:
            continue                          # silence has no pitch
        fr = fr - fr.mean()
        ac = np.correlate(fr, fr, mode="full")[len(fr) - 1:]
        if ac[0] <= 0:
            continue
        seg = ac[lo_lag:hi_lag]
        if not len(seg):
            continue
        lag = int(np.argmax(seg)) + lo_lag
        if ac[lag] / ac[0] < 0.45:
            continue                          # unvoiced, or too noisy to call
        out.append(sr / lag)
    return out


def f0_summary(f0s: list) -> dict:
    """Median and PERCENTILES, not min and max — because of octave errors.

    Autocorrelation picks the wrong peak sometimes: a frame comes back at half
    or double the true pitch, and it takes only one of those to make the range
    absurd. Measured on the reference NEURAL rendering the raw min and max were
    63 Hz and 401 Hz for a voice whose median is 98 — a spread that says nothing
    about the voice and everything about the estimator. The 10th and 90th
    percentiles describe the same 890 frames without letting two of them speak
    for all of them, and the octave-error rate is reported rather than hidden,
    because a voice measured with 20% bad frames is a measurement to distrust.
    """
    if not f0s:
        return {"median": None, "frames": 0}
    a = np.asarray(f0s, dtype=float)
    med = float(np.median(a))
    # A frame more than a half-octave from the median is an octave error, not a
    # human being changing pitch by that much inside a read sentence.
    bad = int(np.sum((a < med / 1.5) | (a > med * 1.5)))
    return {
        "median": round(med, 2),
        "p10": round(float(np.percentile(a, 10)), 2),
        "p90": round(float(np.percentile(a, 90)), 2),
        "rawMin": round(float(a.min()), 2), "rawMax": round(float(a.max()), 2),
        "frames": len(f0s),
        "octaveErrorFrames": bad,
        "octaveErrorPct": round(100.0 * bad / len(f0s), 1),
        "method": "autocorrelation, 40 ms frames at 20 ms hop, voiced only, r>=0.45",
        "note": "median with p10-p90; raw min/max are kept but are dominated by "
                "octave errors and should not be quoted as the voice's range",
    }


def spectra(pcm: np.ndarray, sr: int):
    """Averaged magnitude spectrum and a representative time frame."""
    w = np.hanning(FFT)
    mags, frames = [], []
    for i in range(0, max(0, len(pcm) - FFT), HOP):
        fr = pcm[i:i + FFT]
        if float(np.sqrt(np.mean(fr ** 2))) < 0.01:
            continue
        mags.append(np.abs(np.fft.rfft(fr * w)))
        frames.append(fr)
    if not mags:
        raise SystemExit("nothing above the silence floor in that file")
    return np.mean(mags, axis=0), np.concatenate(frames)


def measure(path: str, meta: dict) -> dict:
    pcm, sr = read_wav(path)
    mag, voiced = spectra(pcm, sr)
    values = VP.measure(voiced.tolist(), mag.tolist(), sr)
    print_ = VP.vprint(values)
    params = {"fft": FFT, "hop": HOP, "window": WINDOW, "sampleRate": sr,
              "framesAveraged": True, "silenceFloorRms": 0.01}
    print_["params"] = params
    f0s = f0_track(pcm, sr)
    doc = {
        "format": FORMAT_VERSION,
        "id": meta["id"], "label": meta["label"],
        "engine": meta.get("engine") or "", "model": meta.get("model") or "",
        "sampleRate": sr,
        "measured": {
            "seconds": round(len(pcm) / sr, 3),
            "f0": f0_summary(f0s),
            "metrics": {k: values[k] for k in VP.METRICS},
        },
        "vprint": print_,
        "provenance": {
            "text": meta.get("text", ""),
            "source": meta.get("source", ""),
            "measuredAt": meta.get("at", ""),
            "tool": "voaice.py " + FORMAT_VERSION,
        },
        # THE SEAM, DECLARED AND EMPTY. vCLONE is a voice in the DeltaVerse
        # registry that renders nothing and says so ("voice not cloned"). This
        # field is the interface a synthesiser would satisfy: given the identity
        # above, produce speech. Nothing here implements it, and a file that
        # claims otherwise should be disbelieved until it names a model.
        "synthesis": None,
    }
    return doc


def cmd_measure(a):
    doc = measure(a.wav, {"id": a.id, "label": a.label, "engine": a.engine,
                          "model": a.model, "text": a.text or "", "source": a.wav,
                          "at": a.at or ""})
    out = a.out or os.path.join("voices", a.id + ".voaice")
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")
    m = doc["measured"]["f0"]
    print("%s -> %s" % (a.wav, out))
    print("  f0 median %s Hz  (p10-p90 %s-%s over %d frames, %s%% octave errors)"
          % (m["median"], m["p10"], m["p90"], m["frames"], m["octaveErrorPct"]))
    print("  vprint %s" % doc["vprint"]["hash"])


def cmd_show(a):
    d = json.load(open(a.file))
    m = d["measured"]
    print("%s  (%s)" % (d["label"], d["id"]))
    print("  %s %s @ %d Hz" % (d["engine"], d["model"], d["sampleRate"]))
    print("  f0 %s Hz median, p10-p90 %s-%s over %d frames (%s%% octave errors)"
          % (m["f0"]["median"], m["f0"]["p10"], m["f0"]["p90"], m["f0"]["frames"],
             m["f0"]["octaveErrorPct"]))
    for k in VP.METRICS:
        print("    %-20s %s" % (k, m["metrics"][k]))
    print("  vprint  %s" % d["vprint"]["hash"])
    print("  uint256 %s" % d["vprint"]["uint256"])
    print("  synthesis: %s" % (d["synthesis"] or "none — this file is an identity, not a model"))


def cmd_compare(a):
    x, y = json.load(open(a.a)), json.load(open(a.b))
    r = VP.compare(x["vprint"], y["vprint"])
    print("%s vs %s" % (x["label"], y["label"]))
    print(json.dumps(r, indent=1))
    fa, fb = x["measured"]["f0"], y["measured"]["f0"]
    if fa["median"] and fb["median"]:
        ratio = max(fa["median"], fb["median"]) / min(fa["median"], fb["median"])
        cents = 1200 * math.log2(ratio)
        print("  f0 ratio %.3f = %.0f cents (%+.0f from an octave)" % (ratio, cents, cents - 1200))


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    s = p.add_subparsers(dest="cmd", required=True)
    m = s.add_parser("measure"); m.set_defaults(fn=cmd_measure)
    m.add_argument("wav"); m.add_argument("--id", required=True); m.add_argument("--label", required=True)
    m.add_argument("--engine", default=""); m.add_argument("--model", default="")
    m.add_argument("--text", default=""); m.add_argument("--at", default=""); m.add_argument("--out")
    sh = s.add_parser("show"); sh.set_defaults(fn=cmd_show); sh.add_argument("file")
    c = s.add_parser("compare"); c.set_defaults(fn=cmd_compare); c.add_argument("a"); c.add_argument("b")
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
