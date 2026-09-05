# SPDX-License-Identifier: Apache-2.0
"""The measurements. One function per quantity, each returning a Fixed18.

MODULAR MEANS ONE QUANTITY PER FUNCTION. Every function here takes a Clip and
returns a single measured value with its unit. Nothing here writes a file,
prints, or decides what is interesting; `report.py` composes and `chart.py`
draws. A forensic result you cannot recompute one number at a time is a result
you cannot defend one number at a time.

WHERE THE EXACTNESS COMES FROM. Anything that is a ratio of integers is built
with `Fixed18.from_ratio` and never sees a float: duration is frames over rate,
silence is a count over a count, zero crossings are a count over a count. The
spectral quantities go through float arithmetic because an FFT does, and they
are converted once at the end -- so they are reproducible bit for bit on the
same input and the same numpy, which is what a report needs, rather than exact
in the mathematical sense. The distinction is recorded per measurement in
`EXACTNESS` rather than left for the reader to guess.
"""
from __future__ import annotations

import numpy as np

from .fixed import Fixed18

# How a number got here. `ratio` means no float was involved at any point.
EXACTNESS = {
    "duration": "ratio", "frames": "ratio", "sample_rate": "ratio",
    "silence_ratio": "ratio", "zero_crossing_rate": "ratio",
    "peak_dbfs": "float", "rms_dbfs": "float", "crest_factor_db": "float",
    "f0_median": "float", "f0_iqr": "float", "voiced_ratio": "ratio",
    "band_energy": "float", "spectral_centroid": "float",
}

# Named bands. The intelligibility band is not a round number chosen for looks:
# it is where consonant discrimination lives, and it is the reason a layer placed
# inside it reads as a second speaker however quiet it is, while the same layer
# outside it reads as timbre however loud.
BANDS = {
    "sub": (0.0, 80.0),
    "low": (80.0, 300.0),
    "intelligibility": (700.0, 3200.0),
    "presence": (3200.0, 6000.0),
    "air": (6000.0, 20000.0),
}

_EPS = 1e-12   # one place below the quietest thing 32-bit float audio represents


def duration(clip) -> Fixed18:
    """Seconds. Exact: a count of frames over a count of frames per second."""
    return Fixed18.from_ratio(clip.frames, clip.rate, "s")


def frames(clip) -> Fixed18:
    return Fixed18.from_ratio(clip.frames, 1, "frames")


def sample_rate(clip) -> Fixed18:
    return Fixed18.from_ratio(clip.rate, 1, "Hz")


def peak_dbfs(clip) -> Fixed18:
    x = clip.mono()
    p = float(np.max(np.abs(x))) if x.size else 0.0
    return Fixed18.from_float(20.0 * np.log10(max(p, _EPS)), "dBFS")


def rms_dbfs(clip) -> Fixed18:
    x = clip.mono()
    r = float(np.sqrt(np.mean(np.square(x, dtype=np.float64)))) if x.size else 0.0
    return Fixed18.from_float(20.0 * np.log10(max(r, _EPS)), "dBFS")


def crest_factor_db(clip) -> Fixed18:
    """Peak over RMS. How peaky the waveform is -- a limiter flattens this, so a
    low crest factor on speech is a fingerprint of processing, not of a voice."""
    return Fixed18.from_float(peak_dbfs(clip).to_float() - rms_dbfs(clip).to_float(), "dB")


def silence_ratio(clip, floor_dbfs: float = -50.0, window_ms: float = 20.0) -> Fixed18:
    """Fraction of windows below a floor. Exact: windows over windows."""
    x = clip.mono()
    n = max(1, int(clip.rate * window_ms / 1000.0))
    w = x[:len(x) // n * n].reshape(-1, n)
    if not w.size:
        return Fixed18.from_ratio(0, 1, "")
    rms = np.sqrt(np.mean(np.square(w, dtype=np.float64), axis=1))
    quiet = int(np.count_nonzero(20.0 * np.log10(np.maximum(rms, _EPS)) < floor_dbfs))
    return Fixed18.from_ratio(quiet, int(w.shape[0]), "")


def zero_crossing_rate(clip) -> Fixed18:
    """Crossings per second. Exact: a count over a duration in frames."""
    x = clip.mono()
    if x.size < 2:
        return Fixed18.from_ratio(0, 1, "1/s")
    crossings = int(np.count_nonzero(np.diff(np.signbit(x))))
    return Fixed18.from_ratio(crossings * clip.rate, int(x.size), "1/s")


def _f0_frames(clip, fmin=60.0, fmax=400.0, window_ms=40.0, hop_ms=10.0,
               floor_dbfs=-45.0):
    """Per-window fundamental by autocorrelation, voiced windows only.

    Autocorrelation rather than anything cleverer on purpose: it is short enough
    to read, it has no parameters that quietly encode a preference, and its
    failure mode -- octave errors -- is visible in the distribution rather than
    hidden in a smoothed contour. The median is reported instead of the mean for
    the same reason: one octave error moves a mean and does not move a median.
    """
    x = clip.mono().astype(np.float64)
    n = max(1, int(clip.rate * window_ms / 1000.0))
    hop = max(1, int(clip.rate * hop_ms / 1000.0))
    lo = max(1, int(clip.rate / fmax))
    hi = min(n - 1, int(clip.rate / fmin))
    if hi <= lo or x.size < n:
        return np.array([]), 0
    out, total = [], 0
    for s in range(0, x.size - n, hop):
        w = x[s:s + n]
        total += 1
        rms = np.sqrt(np.mean(w * w))
        if 20.0 * np.log10(max(rms, _EPS)) < floor_dbfs:
            continue                              # silence has no pitch
        w = w - w.mean()
        ac = np.correlate(w, w, mode="full")[n - 1:]
        if ac[0] <= 0:
            continue
        seg = ac[lo:hi]
        if not seg.size:
            continue
        k = int(np.argmax(seg)) + lo
        # A weak peak is an unvoiced window, not a low note.
        if ac[k] / ac[0] < 0.3:
            continue
        out.append(clip.rate / k)
    return np.array(out), total


def f0_median(clip, **kw) -> Fixed18:
    """Median fundamental over voiced windows, in hertz."""
    f, _ = _f0_frames(clip, **kw)
    return Fixed18.from_float(float(np.median(f)) if f.size else 0.0, "Hz")


def f0_iqr(clip, **kw) -> Fixed18:
    """Interquartile spread of the fundamental: how much the voice moves.

    A flat delivery and an expressive one can share a median exactly. This is
    the number that tells them apart, and it is the one a 'refuses to raise a
    syllable' voice is actually claiming.
    """
    f, _ = _f0_frames(clip, **kw)
    if f.size < 4:
        return Fixed18.from_float(0.0, "Hz")
    q1, q3 = np.percentile(f, [25, 75])
    return Fixed18.from_float(float(q3 - q1), "Hz")


def voiced_ratio(clip, **kw) -> Fixed18:
    """Fraction of windows that carried a pitch. Exact: windows over windows."""
    f, total = _f0_frames(clip, **kw)
    return Fixed18.from_ratio(int(f.size), max(1, total), "")


def _spectrum(clip, window=2048, hop=1024):
    x = clip.mono().astype(np.float64)
    if x.size < window:
        return np.zeros(window // 2 + 1), np.fft.rfftfreq(window, 1.0 / clip.rate)
    w = np.hanning(window)
    acc = np.zeros(window // 2 + 1)
    n = 0
    for s in range(0, x.size - window, hop):
        acc += np.abs(np.fft.rfft(x[s:s + window] * w)) ** 2
        n += 1
    return acc / max(1, n), np.fft.rfftfreq(window, 1.0 / clip.rate)


def band_energy(clip, band: str = "intelligibility") -> Fixed18:
    """Share of total power inside a named band, as a fraction of one."""
    if band not in BANDS:
        raise ValueError("unknown band %r; known: %s" % (band, ", ".join(BANDS)))
    lo, hi = BANDS[band]
    p, f = _spectrum(clip)
    total = float(p.sum())
    if total <= 0:
        return Fixed18.from_float(0.0, "")
    sel = (f >= lo) & (f < hi)
    return Fixed18.from_float(float(p[sel].sum()) / total, "")


def spectral_centroid(clip) -> Fixed18:
    """The power-weighted mean frequency -- the single number for 'brightness'."""
    p, f = _spectrum(clip)
    total = float(p.sum())
    return Fixed18.from_float(float((p * f).sum()) / total if total > 0 else 0.0, "Hz")
