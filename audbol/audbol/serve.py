# SPDX-License-Identifier: Apache-2.0
"""audbol as an instrument: the file, the substrate, and a selection you can measure.

    python -m audbol serve FILE [--host 127.0.0.1] [--port 8770]

WHAT IT SERVES. One page (web/index.html) that plays FILE through an AudioContext
and puts the playdocs substrate under it — the ground, the border ring, the deck
strip and the waveform, copied byte for byte (substrate/PROVENANCE.md) — and
three JSON routes that are audbol's own measurements of the same bytes:

    GET /api/report                 the standard battery over the whole file
    GET /api/measure?from=&to=      the battery over that region, in seconds
    GET /api/bands?from=&to=        power by named band over that region
    GET /audio                      the file itself, with Range requests, so
                                    the element can seek and the browser can
                                    decode it for the waveform

THE POINT OF THE TWO LANES. The browser measures the signal AS IT PLAYS (DVScope,
per frame, on whatever the graph is doing to it); audbol measures the FILE (once,
exactly, in Fixed18). They are the same formulas' two siblings and they should
agree to the accuracy of the decoder. When they do not, the page is where you
find out, and the report is what you can defend.

STDLIB ONLY. http.server is enough for one file and one reader, which is what a
forensic instrument is for. It binds to loopback by default: the file being
measured may be evidence, and a server that listens on every interface because
that was easier is a server that leaks it.

THE FILE IS DECODED ONCE. A Clip of a long take is large and reading it per
request would make the selection sluggish; it is read at start and sliced from
memory. The bytes on disk are hashed once too and the hash is on every answer,
so a report and the page it came from can be matched.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent                                   # the audbol checkout
WEB = ROOT / "web"
SUBSTRATE = ROOT / "substrate"

_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


class _State:
    """Everything the handler needs, built once in serve()."""

    def __init__(self, path):
        from .read import read
        from .report import sha256
        self.path = Path(path).resolve()
        self.clip = read(self.path)
        self.sha256 = sha256(self.path)
        self.bytes = self.path.stat().st_size
        self.mime = mimetypes.guess_type(str(self.path))[0] or "application/octet-stream"
        if self.path.suffix.lower() == ".opus":
            self.mime = "audio/ogg"                  # mimetypes does not know Opus-in-Ogg

    def region(self, q):
        """Parse from/to; missing means the whole clip. Bounds are clamped, not refused,
        because a selection dragged past the end of the waveform is a selection to the end."""
        dur = self.clip.frames / self.clip.rate
        a = float(q.get("from", ["0"])[0] or 0)
        b = float(q.get("to", [str(dur)])[0] or dur)
        a, b = max(0.0, min(a, b)), min(dur, max(a, b))
        return a, b, dur


STATE: _State | None = None


def _measure(clip, names=None):
    from .report import measure_all
    return measure_all(clip, names)


def _bands(clip):
    from . import measure as M
    return {b: dict(M.band_energy(clip, b).as_dict(), range_hz=list(M.BANDS[b])) for b in M.BANDS}


class Handler(BaseHTTPRequestHandler):
    server_version = "audbol/0.1"

    # quiet: one line per request is noise on an instrument
    def log_message(self, fmt, *args):
        if os.environ.get("AUDBOL_LOG"):
            sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def _json(self, obj, status=HTTPStatus.OK):
        body = json.dumps(obj, indent=1).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path: Path, mime=None):
        if not path.is_file():
            return self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime or mimetypes.guess_type(str(path))[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def _audio(self):
        """The file with Range support — the <audio> element seeks by asking for byte ranges,
        and decodeAudioData wants the whole thing; both are one code path here."""
        st = STATE
        size = st.bytes
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        m = _RANGE.match(rng.strip()) if rng else None
        partial = False
        if m:
            s, e = m.group(1), m.group(2)
            if s == "" and e == "":
                pass
            elif s == "":                               # suffix range: the last N bytes
                start = max(0, size - int(e))
            else:
                start = int(s)
                if e:
                    end = min(size - 1, int(e))
            if start > end or start >= size:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", "bytes */%d" % size)
                self.end_headers()
                return
            partial = True
        length = end - start + 1
        self.send_response(HTTPStatus.PARTIAL_CONTENT if partial else HTTPStatus.OK)
        self.send_header("Content-Type", st.mime)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if partial:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.send_header("X-Audbol-SHA256", st.sha256)
        self.end_headers()
        with open(st.path, "rb") as f:
            f.seek(start)
            left = length
            while left > 0:
                chunk = f.read(min(1 << 16, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        p = u.path
        st = STATE
        try:
            if p in ("/", "/index.html"):
                return self._file(WEB / "index.html", "text/html; charset=utf-8")
            if p.startswith("/substrate/"):
                name = Path(p).name
                if not re.match(r"^[a-z-]+\.js$", name):
                    return self._json({"error": "no such module"}, HTTPStatus.NOT_FOUND)
                return self._file(SUBSTRATE / name, "text/javascript; charset=utf-8")
            if p == "/audio":
                return self._audio()
            if p == "/api/source":
                c = st.clip
                return self._json({"audbol": _version(), "path": str(st.path), "name": st.path.name,
                                   "bytes": st.bytes, "sha256": st.sha256, "mime": st.mime,
                                   "container": c.container, "encoding": c.encoding,
                                   "sample_rate": c.rate, "channels": c.channels, "frames": c.frames,
                                   "seconds": c.frames / c.rate,
                                   "substrate": sorted(f.name for f in SUBSTRATE.glob("*.js"))})
            if p == "/api/report":
                from .report import report
                return self._json(report(st.path))
            if p == "/api/measure":
                a, b, dur = st.region(q)
                names = [n for n in (q.get("only", [""])[0] or "").split(",") if n] or None
                clip = st.clip if (a <= 0 and b >= dur) else st.clip.slice(a, b)
                return self._json({"sha256": st.sha256, "from": a, "to": b, "seconds": b - a,
                                   "frames": clip.frames, "whole": clip is st.clip,
                                   "measurements": _measure(clip, names)})
            if p == "/api/bands":
                a, b, dur = st.region(q)
                clip = st.clip if (a <= 0 and b >= dur) else st.clip.slice(a, b)
                return self._json({"sha256": st.sha256, "from": a, "to": b, "bands": _bands(clip)})
            return self._json({"error": "no such route", "routes": ["/", "/audio", "/substrate/<name>.js",
                                                                     "/api/source", "/api/report",
                                                                     "/api/measure?from=&to=[&only=]",
                                                                     "/api/bands?from=&to="]},
                              HTTPStatus.NOT_FOUND)
        except ValueError as e:                     # an empty slice, a bad number: the caller's, said plainly
            return self._json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
        except (BrokenPipeError, ConnectionResetError):
            return None


def _version():
    from . import __version__
    return __version__


def make_server(path, host="127.0.0.1", port=8770):
    global STATE
    STATE = _State(path)
    return ThreadingHTTPServer((host, int(port)), Handler)


def serve(path, host="127.0.0.1", port=8770):
    srv = make_server(path, host, port)
    st = STATE
    print("audbol serve  %s  %d Hz %dch %.3f s  sha256 %s"
          % (st.path.name, st.clip.rate, st.clip.channels, st.clip.frames / st.clip.rate, st.sha256[:16]))
    print("  http://%s:%d/   (ctrl-c stops it)" % (host, srv.server_address[1]))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0
