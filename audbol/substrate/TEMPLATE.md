# Expanding from the substrate

`template.html` beside this file is the starting point. Copy the directory out
with `python -m audbol template DIR` (it refuses to overwrite unless `--force`),
open `DIR/template.html` from disk, pick an audio file, press PLAY. Nothing here
needs a server; the five modules are the substrate and are never edited in a copy.

## The wiring you are extending

```
<audio>  →  MediaElementSource  →  GainNode  →  [ ▶ your nodes ]  →  AnalyserNode  →  destination
                                                                          │
                              ┌───────────────────────────────────────────┼──────────────────────┐
                        voice-scope Field.attach()               pumpRing(): 8 bands        DVScope.Live.read()
                        (ground + strip: waveform,               → periphery ring.charge()   → metrics per frame
                         spectrum, inflection; state())                                      → voiceprint (print)
```

One tap, three readouts. That is the invariant worth keeping when you expand:
**everything drawn or measured reads the analyser**, so the picture cannot show
a voice that is not there and the numbers cannot disagree with the picture.
`Field.state()` names the honest state — `live`, `resting`, `untapped`,
`unknown` — and a badge that prints it is the cheapest safeguard you can add.

## The five extension points, in the order you will want them

1. **Controls (`▶ EXTEND (1)`)** — anything that changes the sound is a node
   placed *before* the analyser, so the substrate shows what you did. A control
   placed after the analyser is heard and not drawn; do not do that.
2. **A second lane (`▶ EXTEND (2)`)** — audbol's host lane. `audbol/web/index.html`
   shows the pattern: `fetch('/api/measure?from=&to=')` against `python -m audbol
   serve FILE`, so a waveform selection becomes a Fixed18 report of exactly those
   frames. Green/amber against the whole-file figure is the comparison.
3. **Spectrum → events (`▶ EXTEND (3)`)** — `pumpRing()` is where a band becomes a
   number once per frame. An *event* is a rule over those numbers: a band crossing
   a threshold, a band rising for N frames (an onset), the ratio of two bands (a
   timbre). Emit them as DOM events (`dispatchEvent(new CustomEvent('audio:onset',
   {detail}))`) and let other code listen; keep the rule and the reaction apart, the
   way `ring.charge()` is apart from the ring's drawing.
4. **Nodes in the graph (`▶ EXTEND (4)`)** — a BiquadFilter, a ConvolverNode, an
   AudioWorklet. Insert between `gain` and `analyser`. If you add a *second* tap
   (say, pre-filter), give it its own `Field` and its own badge; never feed two
   analysers into one picture.
5. **Identity (`▶ EXTEND (5)`)** — `Field.print` is the last voiceprint, a SHA-256
   over the 18-place metrics; `field.on('print', fn)` delivers each new one. This is
   the seam for *who* is speaking. cryptoAGI/voaice writes what a voice is down in
   the same terms (`voices/*.voaice`), so a print measured here can be held against
   a voice's declared identity.

## What not to do

- Do not edit the five `*.js`. Change them upstream (DeltaVerse `engine/ngn/`),
  copy back, update `PROVENANCE.md`. `tests/test_substrate.py` fails if the bytes
  drift from the recorded hashes, which is the point.
- Do not build the AudioContext before a gesture, and never call
  `createMediaElementSource` twice on one element. Both are latched in the template.
- Do not smooth a reading into a lie: a meter frozen at its last value behind a
  hidden tab reads as a level. Stop the loop or drive it to zero.
