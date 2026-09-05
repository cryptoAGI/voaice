# SPDX-License-Identifier: Apache-2.0
"""Decode audio through the system libsndfile, with nothing installed.

The precedent is docspeech, which encodes Ogg/Opus by calling libsndfile through
ctypes rather than depending on a Python audio package. This is the same trick
pointed the other way: libsndfile is already on any machine that plays sound, it
reads WAV, FLAC, Ogg/Vorbis and Ogg/Opus, and going through it means audbol has
no build step and no wheel to match against a Python version.

A forensic tool that cannot be installed does not get used, and one that pulls a
compiled dependency has a supply chain. This has neither.

THE TRAP, WRITTEN DOWN BECAUSE IT COST A SEGFAULT ONCE. `sf_readf_float` counts
FRAMES, not items. A frame is one sample per channel, so a buffer of N floats
holds N/channels frames, and handing it N produces a read past the end of the
buffer. The same confusion in the writing direction produced a six-times-too-long
mono file that only `opusinfo` revealed.
"""
from __future__ import annotations

import ctypes
import ctypes.util
from pathlib import Path

import numpy as np

SFM_READ = 0x10
SF_FORMAT_SUBMASK = 0x0000FFFF
SF_FORMAT_TYPEMASK = 0x0FFF0000

_TYPES = {0x010000: "wav", 0x020000: "aiff", 0x040000: "au", 0x170000: "flac",
          0x200000: "ogg", 0x230000: "mpeg"}
_SUBS = {0x0002: "pcm_16", 0x0003: "pcm_24", 0x0004: "pcm_32", 0x0006: "float",
         0x0060: "vorbis", 0x0064: "opus"}


class _Info(ctypes.Structure):
    # frames is sf_count_t (int64) and the field order is fixed by the ABI;
    # getting it wrong reads a plausible-looking wrong number rather than failing.
    _fields_ = [("frames", ctypes.c_int64), ("samplerate", ctypes.c_int),
                ("channels", ctypes.c_int), ("format", ctypes.c_int),
                ("sections", ctypes.c_int), ("seekable", ctypes.c_int)]


def _lib():
    name = ctypes.util.find_library("sndfile") or "libsndfile.so.1"
    lib = ctypes.CDLL(name)
    lib.sf_open.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.POINTER(_Info)]
    lib.sf_open.restype = ctypes.c_void_p
    lib.sf_readf_float.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int64]
    lib.sf_readf_float.restype = ctypes.c_int64
    lib.sf_close.argtypes = [ctypes.c_void_p]
    lib.sf_strerror.argtypes = [ctypes.c_void_p]
    lib.sf_strerror.restype = ctypes.c_char_p
    return lib


class Clip:
    """Decoded audio, plus what the container said about itself."""

    __slots__ = ("samples", "rate", "channels", "path", "container", "encoding", "frames")

    def __init__(self, samples, rate, channels, path, container, encoding):
        self.samples = samples          # float32, shape (frames, channels)
        self.rate = int(rate)
        self.channels = int(channels)
        self.path = str(path)
        self.container = container
        self.encoding = encoding
        self.frames = int(samples.shape[0])

    def mono(self):
        """Average the channels. Stated rather than assumed, because a stereo
        file whose channels differ is a different measurement per channel and
        averaging them is a choice the caller should be able to see."""
        return self.samples[:, 0] if self.channels == 1 else self.samples.mean(axis=1)

    def slice(self, start_s: float, end_s: float) -> "Clip":
        """The clip between two times, as a Clip of its own.

        Frames are cut on integer boundaries — floor at the start, ceil at the
        end — so the region is never narrower than asked for, and the cut is
        recorded on the path as `name#12.500-13.250` so a report of the slice
        says which slice it is. Every measurement then applies unchanged: a
        slice IS a clip, and nothing in `measure` needs to know it was one.
        """
        import math
        a = max(0, int(math.floor(float(start_s) * self.rate)))
        b = min(self.frames, int(math.ceil(float(end_s) * self.rate)))
        if b <= a:
            raise ValueError("empty slice: %s..%s s of a %.3f s clip"
                             % (start_s, end_s, self.frames / self.rate))
        return Clip(self.samples[a:b], self.rate, self.channels,
                    "%s#%.3f-%.3f" % (self.path, a / self.rate, b / self.rate),
                    self.container, self.encoding)

    def __repr__(self):
        return ("Clip(%s, %d frames, %d Hz, %dch, %s/%s)"
                % (Path(self.path).name, self.frames, self.rate, self.channels,
                   self.container, self.encoding))


def read(path) -> Clip:
    lib = _lib()
    info = _Info()
    h = lib.sf_open(str(path).encode(), SFM_READ, ctypes.byref(info))
    if not h:
        raise OSError("libsndfile could not open %s: %s"
                      % (path, (lib.sf_strerror(None) or b"").decode()))
    try:
        ch = max(1, info.channels)
        buf = np.empty((info.frames, ch), dtype=np.float32)
        # FRAMES, not items. See the module docstring.
        got = lib.sf_readf_float(h, buf.ctypes.data_as(ctypes.c_void_p), info.frames)
        if got < info.frames:
            buf = buf[:max(0, got)]
        return Clip(buf, info.samplerate, ch, path,
                    _TYPES.get(info.format & SF_FORMAT_TYPEMASK, "0x%06x" % (info.format & SF_FORMAT_TYPEMASK)),
                    _SUBS.get(info.format & SF_FORMAT_SUBMASK, "0x%04x" % (info.format & SF_FORMAT_SUBMASK)))
    finally:
        lib.sf_close(h)
