# Wiring: how the audio becomes events, and how to extend it

This is the audbol instrument as it sits inside voaice. The two saved voices
this repository writes down — `voices/neural.voaice`, `voices/jaimla.voaice` —
are identities: model, measured f0, an 18-place voiceprint. audbol is the
instrument that *measures*; the substrate is the picture of the measurement;
and the wiring between them is where audio turns into events you can act on.
Read this, then `substrate/TEMPLATE.md`, then copy the template out.

## The one line to remember

```
<audio> → MediaElementSource → GainNode → [your nodes] → AnalyserNode → destination
                                                              └── everything reads THIS
```

There is one tap. The ground and the strip (`voice-scope.js`) attach to it and
draw; the border ring (`periphery-frame.js`) is charged from eight bands of its
spectrum; `DVScope.Live` reads it for the metrics and the voiceprint; and the
host lane (`python -m audbol serve FILE`) measures the *file* those samples came
from, exactly, in Fixed18. Because every readout is of the same node, no readout
can show a voice that is not there. `Field.state()` names which of four states
the picture is in (`live` · `resting` · `untapped` · `unknown`); print it.

## Extrapolating: from a picture to an event

The ring is already an event system with the reaction hard-wired to a lamp. In
`pumpRing()` each of eight log-spaced bands (80–8000 Hz) becomes one number per
frame, normalised against its own decaying peak, and `ring.charge(id, v)` is the
reaction. Pull the two apart and you have the general shape:

```js
// a RULE over the per-frame numbers …
if (band[2] > 0.6 && prevBand[2] <= 0.6) {
  // … emits an EVENT, and says nothing about what should happen
  window.dispatchEvent(new CustomEvent('audio:onset', { detail: { band: 2, at: AU.currentTime, level: band[2] } }))
}
// … and REACTIONS subscribe, anywhere, without touching the rule
window.addEventListener('audio:onset', (e) => ring.announce('onset ' + e.detail.band))
```

Rules worth having, each one a few lines over the same numbers:

| event | rule over the tap | what it is good for |
|---|---|---|
| `audio:onset` | a band rises past a threshold from below | word/syllable starts; cueing a substrate transition |
| `audio:silence` | RMS below `-50 dBFS` for N frames (audbol's `silence_ratio` floor) | pausing a reader, splitting a take |
| `audio:timbre` | ratio of `intelligibility` (700–3200 Hz) to `low` (80–300 Hz) crosses a line | telling a voice from music, or one register from another |
| `audio:print` | `field.on('print', fn)` — a new voiceprint | **identity**: hold the print against a `.voaice` |
| `audio:region` | the waveform's `select` event | re-measure exactly those frames on the host (`/api/measure?from=&to=`) |

`DVScope.metrics()` gives you the same eight quantities the voiceprint is built
from (`rms`, `dominantFrequency`, `spectralCentroid`, `spectralRolloff`,
`spectralBandwidth`, `spectralFlux`, `zeroCrossingRate`, `harmonicNoiseRatio`),
each with its `wei` string — the 18-place record. A rule written over
`m.value.*` is a rule you can also run in Python over the file with
`audbol.measure`, which is how a browser-lane event gets a host-lane proof.

## Extending: where to add, in order

1. **A control** — a node placed *before* the analyser (`▶ EXTEND (4)` in the
   template). The substrate then shows what you did. After the analyser it is
   heard and not drawn; do not do that.
2. **A rule** — in the frame loop, over the band array or `live.read()`. Emit a
   DOM event. Keep the reaction out of the rule.
3. **A reaction** — a listener. The substrate offers `ring.charge()`,
   `ring.announce(label)`, `ring.transit()`; the page offers whatever you build.
4. **A host check** — for anything that matters, take the region and ask
   `/api/measure`. The browser lane is fast and approximate; the host lane is
   exact and citable. Show both; mark disagreement.
5. **Identity** — compare a measured print to `voices/*.voaice`. The `.voaice`
   `measured.metrics` are the same eight quantities; `tools/vprint.py` and
   `engine/oscilloscope.js` agree on them to 18 places, which is the whole claim
   of this repository. An event that says *who* is speaking is a comparison of
   those numbers, and it should say how far apart they are, never just "match".

## What this copy is

`audbol/` here is a copy of the package from `Professor-Codephreak/docsreader`
at the commit named in `audbol/substrate/PROVENANCE.md`'s neighbour history. The
substrate modules are byte for byte from DeltaVerse; `tests/test_substrate.py`
fails if they drift. Run `python3 -m pytest audbol/tests` from the repo root.
