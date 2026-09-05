import math, struct, wave
from pathlib import Path
import pytest


@pytest.fixture(scope="session")
def tone_wav(tmp_path_factory) -> Path:
    """Two seconds: 1 s of a 220 Hz tone at -6 dBFS, then 1 s of silence. 22050 Hz mono, PCM16.
    Known content, so a measurement of a slice can be checked against arithmetic."""
    p = tmp_path_factory.mktemp("audio") / "tone.wav"
    sr = 22050
    frames = bytearray()
    for i in range(sr * 2):
        v = 0.5 * math.sin(2 * math.pi * 220 * i / sr) if i < sr else 0.0
        frames += struct.pack("<h", int(v * 32767))
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(bytes(frames))
    return p
