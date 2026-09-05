# SPDX-License-Identifier: Apache-2.0
"""Compose measurements into a report that can be checked by someone else.

A forensic result is worth what its reproduction instructions are worth, so a
report carries: the sha256 of the bytes measured, the container and encoding as
the decoder saw them, every measurement as an exact integer with its unit and
how it was obtained, and the versions of the two things that could change an
answer. Nothing is rounded on the way in.
"""
from __future__ import annotations

import hashlib
import json
import platform
from datetime import datetime, timezone
from pathlib import Path

from . import measure as M
from .fixed import Fixed18, SCALE

VERSION = "0.1.0"

# The default battery. A caller wanting one number calls one function; this is
# what "measure this file" means when nobody said which.
STANDARD = ["duration", "sample_rate", "frames", "peak_dbfs", "rms_dbfs",
            "crest_factor_db", "silence_ratio", "zero_crossing_rate",
            "f0_median", "f0_iqr", "voiced_ratio", "spectral_centroid"]


def sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def measure_all(clip, names=None, bands=True) -> dict:
    out = {}
    for name in (names or STANDARD):
        fn = getattr(M, name, None)
        if fn is None:
            raise ValueError("no measurement named %r" % name)
        v = fn(clip)
        out[name] = dict(v.as_dict(), exactness=M.EXACTNESS.get(name, "float"))
    if bands:
        for b in M.BANDS:
            v = M.band_energy(clip, b)
            out["band_" + b] = dict(v.as_dict(), exactness="float",
                                    range_hz=list(M.BANDS[b]))
    return out


def report(path, names=None) -> dict:
    import numpy
    from .read import read
    clip = read(path)
    return {
        "audbol": VERSION,
        "scale": SCALE,
        "measured": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "path": str(Path(path).resolve()),
            "bytes": Path(path).stat().st_size,
            "sha256": sha256(path),
            "container": clip.container,
            "encoding": clip.encoding,
            "sample_rate": clip.rate,
            "channels": clip.channels,
            "frames": clip.frames,
        },
        # The two things that can move a spectral number without the audio
        # changing. Recorded so a disagreement has somewhere to start.
        "environment": {"python": platform.python_version(), "numpy": numpy.__version__},
        "measurements": measure_all(clip, names),
    }


def compare(a: dict, b: dict) -> dict:
    """Difference two reports, measurement by measurement, on the integers.

    Comparing the rendered strings would call 94.6 and 94.600000000000001 equal
    or unequal depending on how many places someone printed. The integer is the
    record, so the integer is what is subtracted.
    """
    out = {}
    for k, av in (a.get("measurements") or {}).items():
        bv = (b.get("measurements") or {}).get(k)
        if not bv:
            out[k] = {"only_in": "a"}
            continue
        d = int(bv["raw"]) - int(av["raw"])
        out[k] = {"a": av["value"], "b": bv["value"],
                  "delta": str(Fixed18(d, av.get("unit", ""))),
                  "unit": av.get("unit", ""), "same": d == 0}
    for k in (b.get("measurements") or {}):
        if k not in (a.get("measurements") or {}):
            out[k] = {"only_in": "b"}
    return out


def to_json(obj) -> str:
    return json.dumps(obj, indent=2, sort_keys=False)
