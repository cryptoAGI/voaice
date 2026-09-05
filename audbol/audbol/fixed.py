# SPDX-License-Identifier: Apache-2.0
"""Fixed18 — a measurement that means exactly what it says.

WHY NOT A FLOAT.

A float result is not a measurement, it is a measurement plus an unknown amount
of representation noise, and the noise is in the digits you are most likely to
be arguing about. Run the same analysis twice on the same bytes and the last
places differ; put two runs side by side and you cannot tell a real change from
the arithmetic. Print it and the digits keep going, so a report has to choose a
rounding, and every consumer of the report chooses a different one.

Cryptocurrency solved this problem for money by refusing to store money as a
number with a point in it. A balance is an integer count of base units, and the
point is a display convention applied at the edge. Eighteen decimals, because
that is what an ERC-20 with 18 decimals uses and because it is more places than
any physical measurement needs -- the precision is not the claim, the EXACTNESS
is. Two equal measurements compare equal. A difference is a difference.

audbol measures audio the same way. Every quantity is an integer count of
1e-18 units, and the unit is carried alongside so a hertz is never subtracted
from a decibel.

WHAT THIS DOES NOT CLAIM.

Exactness is not accuracy. Reporting 94.600000000000000000 Hz says the
computation is reproducible to the last place, not that the vocal tract was at
94.6 Hz. And it says nothing at all about the process that produced the audio:
piper is non-deterministic by design (noise_scale 0.667, noise_w 0.8), so two
renders of the same sentence differ by around 3% in duration. An exact
measurement of a varying thing is still a measurement of a varying thing.

The distinction is the whole point of keeping them separate:

    measurement precision   what this module guarantees -- bit-identical results
                            from identical input, forever
    process variance        what the thing being measured actually does, which
                            you can only characterise by measuring it repeatedly

Conflating the two is how "the checksums differ, therefore the voice changed"
happens.
"""
from __future__ import annotations

import re
from decimal import Decimal, getcontext

SCALE = 18
ONE = 10 ** SCALE

# Decimal is used only at the parse/format edges, never in the hot path. 40
# digits is comfortably more than 18 places plus any integer part audio produces.
getcontext().prec = 40

_NUM = re.compile(r"^\s*([+-]?)(\d*)(?:\.(\d*))?\s*$")


class Fixed18:
    """An exact quantity, stored as an integer number of 1e-18 units."""

    __slots__ = ("raw", "unit")

    def __init__(self, raw: int, unit: str = "") -> None:
        if not isinstance(raw, int) or isinstance(raw, bool):
            raise TypeError("Fixed18 holds an int of base units; "
                            "use Fixed18.from_float or Fixed18.parse")
        self.raw = raw
        self.unit = unit

    # ── construction ────────────────────────────────────────────────────────
    @classmethod
    def parse(cls, text: str, unit: str = "") -> "Fixed18":
        """Parse a decimal string EXACTLY. No float ever touches the value."""
        m = _NUM.match(str(text))
        if not m or (not m.group(2) and not m.group(3)):
            raise ValueError("not a decimal number: %r" % (text,))
        sign, whole, frac = m.group(1) or "+", m.group(2) or "0", m.group(3) or ""
        if len(frac) > SCALE:
            raise ValueError("%d decimal places; this holds %d. Round it "
                             "deliberately rather than here." % (len(frac), SCALE))
        raw = int(whole) * ONE + int((frac.ljust(SCALE, "0")) or 0)
        return cls(-raw if sign == "-" else raw, unit)

    @classmethod
    def from_float(cls, x: float, unit: str = "") -> "Fixed18":
        """Convert a float ONCE, at the boundary, and never again.

        `repr(float)` gives the shortest string that round-trips, which is the
        honest rendering of what the float actually holds -- going through
        Decimal(float) instead would faithfully reproduce binary noise like
        94.599999999999994315658… and then swear it was exact to 18 places.
        """
        if x != x or x in (float("inf"), float("-inf")):
            raise ValueError("not a finite measurement: %r" % (x,))
        d = Decimal(repr(float(x)))
        return cls(int((d * ONE).to_integral_value(rounding="ROUND_HALF_EVEN")), unit)

    @classmethod
    def from_ratio(cls, num: int, den: int, unit: str = "") -> "Fixed18":
        """Exact from a ratio of integers -- the preferred route.

        Most audio measurements ARE ratios of integers: frames over sample rate,
        counts over counts. Taking that route means no float exists at any point
        and the result is exact rather than merely reproducible.
        """
        if den == 0:
            raise ZeroDivisionError("measurement with a zero denominator")
        # round half to even, on integers
        q, r = divmod(num * ONE, den)
        if den < 0:
            q, r = -q, -r
        r2 = 2 * abs(r)
        ad = abs(den)
        if r2 > ad or (r2 == ad and q % 2):
            q += 1 if (num * den) >= 0 else -1
        return cls(q, unit)

    # ── arithmetic, unit-checked ────────────────────────────────────────────
    def _same(self, other: "Fixed18") -> None:
        if self.unit != other.unit:
            raise ValueError("cannot combine %s and %s"
                             % (self.unit or "(none)", other.unit or "(none)"))

    def __add__(self, o: "Fixed18") -> "Fixed18":
        self._same(o); return Fixed18(self.raw + o.raw, self.unit)

    def __sub__(self, o: "Fixed18") -> "Fixed18":
        self._same(o); return Fixed18(self.raw - o.raw, self.unit)

    def __neg__(self) -> "Fixed18":
        return Fixed18(-self.raw, self.unit)

    def __eq__(self, o: object) -> bool:
        return isinstance(o, Fixed18) and o.raw == self.raw and o.unit == self.unit

    def __lt__(self, o: "Fixed18") -> bool:
        self._same(o); return self.raw < o.raw

    def __hash__(self) -> int:
        return hash((self.raw, self.unit))

    # ── rendering ───────────────────────────────────────────────────────────
    def __str__(self) -> str:
        sign = "-" if self.raw < 0 else ""
        w, f = divmod(abs(self.raw), ONE)
        return "%s%d.%0*d" % (sign, w, SCALE, f)

    def __repr__(self) -> str:
        return "Fixed18(%s%s)" % (self, (" " + self.unit) if self.unit else "")

    def round(self, places: int) -> str:
        """A display string. Rounding happens HERE and nowhere earlier."""
        if not 0 <= places <= SCALE:
            raise ValueError("0..%d places" % SCALE)
        if places == SCALE:
            return str(self)
        drop = 10 ** (SCALE - places)
        q, r = divmod(abs(self.raw), drop)
        if 2 * r > drop or (2 * r == drop and q % 2):
            q += 1
        sign = "-" if self.raw < 0 else ""
        if places == 0:
            return "%s%d" % (sign, q)
        w, f = divmod(q, 10 ** places)
        return "%s%d.%0*d" % (sign, w, places, f)

    def to_float(self) -> float:
        """For plotting only. A chart is a picture, not a record."""
        return self.raw / ONE

    def as_dict(self) -> dict:
        """The serialisable form: the integer is the record, the rest is help."""
        return {"raw": str(self.raw), "scale": SCALE,
                "unit": self.unit, "value": str(self)}
