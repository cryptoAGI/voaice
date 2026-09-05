# SPDX-License-Identifier: Apache-2.0
"""Charts as SVG text, with no plotting library.

WHY SVG AND WHY NO DEPENDENCY. A chart in a forensic report has to survive being
looked at years later by someone who does not have your environment. SVG is text:
it diffs, it greps, it renders in any browser, and the numbers that produced it
are still readable inside the file. A PNG from a plotting stack is a binary blob
plus a version of that stack you no longer have.

It is also the cheap format where permanence is priced by the byte -- a spectrum
here is a few kilobytes against a few hundred for the same picture rasterised.

THE AXIS IS PART OF THE CLAIM. Every chart carries its own axis labels and its
own units, drawn from the measurements rather than passed in separately, because
a chart whose y-axis is asserted by the caller is a chart that can lie without
anyone editing the data.
"""
from __future__ import annotations

import html
from .fixed import Fixed18

_CSS = (
    "text{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#c9d4e0}"
    ".t{font-size:13px;fill:#e6edf3}.u{fill:#7f9c8a}"
    ".ax{stroke:#2b3440;stroke-width:1}"
    ".bar{fill:#3ddc84}.bar.hi{fill:#e3b341}"
    ".ln{fill:none;stroke:#3ddc84;stroke-width:1.5}"
    ".gr{stroke:#1b2430;stroke-width:1}"
)


def _open(w, h, title, subtitle=""):
    s = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" '
         'role="img" aria-label="%s">' % (w, h, w, h, html.escape(title))]
    s.append("<style>%s</style>" % _CSS)
    s.append('<rect width="%d" height="%d" fill="#05070a"/>' % (w, h))
    s.append('<text class="t" x="14" y="22">%s</text>' % html.escape(title))
    if subtitle:
        s.append('<text class="u" x="14" y="38">%s</text>' % html.escape(subtitle))
    return s


def bars(values, title="", subtitle="", width=680, height=280, highlight=None, places=4):
    """A labelled bar chart. `values` is [(label, Fixed18)], drawn in order.

    Every bar prints its own value to `places`, so the picture never has to be
    measured with a ruler to be read.
    """
    pad_l, pad_r, pad_t, pad_b = 150, 100, 54, 20
    n = max(1, len(values))
    plot_w = width - pad_l - pad_r
    row = (height - pad_t - pad_b) / n
    top = max([abs(v.to_float()) for _, v in values] + [1e-30])
    s = _open(width, height, title, subtitle)
    for i, (label, v) in enumerate(values):
        y = pad_t + i * row
        bw = max(1.0, plot_w * abs(v.to_float()) / top)
        cls = "bar hi" if (highlight and label in highlight) else "bar"
        s.append('<text x="%d" y="%.1f" text-anchor="end">%s</text>'
                 % (pad_l - 10, y + row * 0.62, html.escape(str(label))))
        s.append('<rect class="%s" x="%d" y="%.1f" width="%.1f" height="%.1f" rx="2"/>'
                 % (cls, pad_l, y + row * 0.22, bw, row * 0.56))
        s.append('<text x="%.1f" y="%.1f">%s%s</text>'
                 % (pad_l + bw + 8, y + row * 0.62, html.escape(v.round(places)),
                    (" " + v.unit) if v.unit else ""))
    s.append('<line class="ax" x1="%d" y1="%d" x2="%d" y2="%d"/>'
             % (pad_l, pad_t, pad_l, height - pad_b))
    s.append("</svg>")
    return "\n".join(s)


def line(xs, ys, title="", subtitle="", x_unit="", y_unit="",
         width=680, height=260, log_x=False):
    """A line chart over paired sequences of floats. Used for spectra."""
    import math
    pad_l, pad_r, pad_t, pad_b = 62, 18, 54, 34
    s = _open(width, height, title, subtitle)
    if not xs or not ys or len(xs) != len(ys):
        s.append("</svg>")
        return "\n".join(s)
    fx = [math.log10(max(x, 1e-9)) for x in xs] if log_x else list(xs)
    x0, x1 = min(fx), max(fx)
    y0, y1 = min(ys), max(ys)
    if x1 == x0:
        x1 = x0 + 1
    if y1 == y0:
        y1 = y0 + 1
    W, H = width - pad_l - pad_r, height - pad_t - pad_b
    px = lambda x: pad_l + W * (x - x0) / (x1 - x0)
    py = lambda y: pad_t + H - H * (y - y0) / (y1 - y0)
    for g in range(1, 4):                                  # three gridlines, no more
        y = pad_t + H * g / 4
        s.append('<line class="gr" x1="%d" y1="%.1f" x2="%d" y2="%.1f"/>' % (pad_l, y, width - pad_r, y))
    s.append('<path class="ln" d="M%s"/>'
             % " L".join("%.1f %.1f" % (px(a), py(b)) for a, b in zip(fx, ys)))
    s.append('<line class="ax" x1="%d" y1="%.1f" x2="%d" y2="%.1f"/>'
             % (pad_l, pad_t + H, width - pad_r, pad_t + H))
    for frac, val in ((0.0, xs[0]), (0.5, xs[len(xs) // 2]), (1.0, xs[-1])):
        s.append('<text x="%.1f" y="%d" text-anchor="middle">%s</text>'
                 % (pad_l + W * frac, height - 12,
                    html.escape(("%.0f" % val) + (" " + x_unit if x_unit else ""))))
    s.append('<text class="u" x="6" y="%d">%s</text>' % (pad_t + 4, html.escape(y_unit)))
    s.append("</svg>")
    return "\n".join(s)


def spectrum(clip, title="", width=680, height=260):
    """The averaged power spectrum in dB, on a log frequency axis.

    Log frequency because hearing is logarithmic: on a linear axis the octave
    that carries a voice occupies the leftmost few pixels, and every difference
    worth seeing is invisible.
    """
    import numpy as np
    from .measure import _spectrum, BANDS
    p, f = _spectrum(clip)
    keep = f > 20.0
    f, p = f[keep], p[keep]
    db = 10.0 * np.log10(np.maximum(p, 1e-20))
    db = db - db.max()
    sub = "  ".join("%s %.1f%%" % (k, 100.0 * float(p[(f >= a) & (f < b)].sum() / max(p.sum(), 1e-30)))
                    for k, (a, b) in BANDS.items())
    return line(list(map(float, f)), list(map(float, db)), title or "spectrum",
                sub, "Hz", "dB rel. peak", width, height, log_x=True)
