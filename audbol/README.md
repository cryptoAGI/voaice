# audbol

Pronounced "oddball". Modular scientific and forensic audio analysis, measured
exactly: every quantity is a `Fixed18` — an integer count of 1e-18 units with
its unit — and every report carries the sha256 of the bytes it measured.

```
python -m audbol measure FILE [--json out.json] [--only name,name]
python -m audbol chart   FILE --out DIR
python -m audbol compare A.json B.json
python -m audbol bands   FILE
python -m audbol serve   FILE [--host 127.0.0.1] [--port 8770]
```

Decoding goes through the system libsndfile via ctypes (WAV, FLAC, Ogg/Vorbis,
Ogg/Opus), so there is nothing to install and no wheel to match. numpy only.

## `serve` — the instrument

`python -m audbol serve FILE` opens one page on loopback that puts the
**playdocs substrate** under the file: the ground and the deck strip
(voice-scope), the border ring (periphery-frame, eight stations lit by eight
log-spaced bands of the playing voice), and the Audacity-grade waveform. The
five modules are copied byte for byte from DeltaVerse and their hashes are in
[`substrate/PROVENANCE.md`](substrate/PROVENANCE.md).

Two lanes, one file:

- **browser lane** — `DVScope` measures the signal *as it plays*, per frame,
  from the AnalyserNode that is also drawing the picture. Right-hand column,
  bottom: rms, dominant, centroid, rolloff, bandwidth, flux, zcr, hnr and the
  voiceprint, 18-place records in the tooltips.
- **host lane** — audbol measures the *file*, once, exactly. Right-hand column,
  top: the standard battery over the whole file, then over **whatever you
  select on the waveform**. Drag, and `/api/measure?from=&to=` re-measures
  those frames only; green means identical to the whole-file figure on the
  integer, amber means it differs.

Routes: `/` · `/audio` (Range requests) · `/substrate/<name>.js` ·
`/api/source` · `/api/report` · `/api/measure?from=&to=[&only=]` ·
`/api/bands?from=&to=`. The graph is built on the first press of PLAY and not
before (an AudioContext made without a gesture reads zeroes forever). Space
toggles play; LOOP SEL loops the selection.

`Clip.slice(start_s, end_s)` is what the region measurement uses: floor at the
start, ceil at the end, and the cut recorded on the clip's path.

## Layout

```
audbol/          the package: fixed · read · measure · chart · report · serve · cli
substrate/       the playdocs substrate, saved byte for byte (PROVENANCE.md) + template.html and TEMPLATE.md — `python -m audbol template DIR` copies it out to expand from
web/index.html   the instrument page `serve` opens
tests/           pytest; a synthesised tone+silence WAV is the fixture
```
