# voaice

**What a voice is, written down — and a way to check that a recording came from it.**

A `.voaice` is not audio and it is not a model. It is an identity card: which model
speaks the voice, what it measured as, and a **vprint** over those measurements —
eight acoustic metrics in 18-decimal fixed point, hashed to SHA-256, SHA-512 and a
uint256.

```
voices/neural.voaice     NEURAL  — piper en_GB-alan-medium, measured
voices/jaimla.voaice     JAIMLA  — piper en_GB-jenny_dioco-medium, measured
voices/vclone.voaice     vCLONE  — the template, measured into by you
tools/vprint.py          the voiceprint, server-side
tools/voaice.py          measure a wav into a .voaice; show; compare
web/capture.html         microphone capture + live vprint. No server, nothing uploaded.
engine/oscilloscope.js   the definition the Python twin must agree with
test/test_vprint.py      proves the two agree
```

These are the two saved voices of the [DeltaVerse](https://deltaverse.pythai.net/voices) —
the reference and the female voice — the ones `doc.player` and `docsreader` actually
render from. `jaimla.voaice` is what "jaimla the stored voice" means here: not a
recording of her, but the measurements that let you tell her renderings apart from
anyone else's.

## The measured voices

Measured 2026-09-03 from six DeltaVerse sentences, 22 050 Hz, FFT 2048, hop 512,
Hann, frames averaged, silence floor RMS 0.01.

| | NEURAL | JAIMLA |
|---|---|---|
| model | `en_GB-alan-medium` | `en_GB-jenny_dioco-medium` |
| f0 median | **97.14 Hz** | **182.23 Hz** |
| f0 p10–p90 | 86.13 – 108.62 | 162.13 – 220.50 |
| voiced frames | 705 (0.7% octave errors) | 771 (1.9%) |
| vprint | `44c0ab20…ba41c9e5` | `2275133b…cb3c2752` |

**They are not an octave apart.** 182.23 / 97.14 = 1.876, which is 1089 cents —
**111 cents flat of an octave**, about a semitone. The DeltaVerse pages said
"eleven cents" for a while; 183.8/94.6 is 1.943 and that is fifty cents flat, so
the arithmetic never supported it either. Near enough that the two stack rather
than clash, which is the part that matters for
[MONY](https://deltaverse.pythai.net/docsplayer) — and far enough that calling it
an octave is flattering it.

## A vprint is a fingerprint of a *measurement*

This is the most important sentence in the repository.

Change the FFT size, the sample rate, the window, the microphone, the loudness
normalisation or the length of the excerpt, and every metric moves — so the print
moves with them. Two recordings of the same person measured differently produce
different prints. That is not a defect; it is what "hash of eight floats" means.

- A vprint is **evidence that two files came from the same measured signal.**
- A vprint is **not a biometric** and must not be used as one.

`vprint.compare()` therefore **refuses** to compare prints whose measurement
parameters differ, rather than returning a similarity score that looks like an
answer. The parameters travel inside every file for exactly this reason.

One further honesty: in an averaged profile `spectralFlux` is structurally `0.0`,
because flux is a difference between consecutive frames and an averaged spectrum
has no previous frame. Seven of the eight metrics carry information in a profile;
the eighth carries information only in a live capture. It is left in so that the
canonical form is the same on both sides.

## The two implementations agree, and that is tested

"The same voiceprint" is a claim about two independent implementations of one
spec, and two implementations disagree by default — over key order, over float
rounding, over whether JSON has spaces in it. Each of those produces a different
hash while both sides look correct alone.

```bash
python3 test/test_vprint.py
```

runs the real `engine/oscilloscope.js` under node against the same metric inputs
and requires identical SHA-256, SHA-512 and uint256 for every case, including
awkward floats (`1/3`, `0.1+0.2`, `1e-18`, `√2`). It passes.

The subtlety it protects: `to_precision18` multiplies by the **float** `1e18` and
floors, exactly as JavaScript does. Using Python's exact integer `10**18` — the
obviously "more correct" thing — changes the last digit for most inputs and
silently breaks agreement.

## Use

```bash
# measure a 16-bit PCM wav into an identity
python3 tools/voaice.py measure sample.wav --id myvoice --label MYVOICE \
        --engine piper --model en_GB-alan-medium

python3 tools/voaice.py show voices/neural.voaice
python3 tools/voaice.py compare voices/neural.voaice voices/jaimla.voaice
```

`web/capture.html` does the same from a microphone. Serve it over https or
localhost (a microphone needs a secure context); it has no server side, nothing is
uploaded, and it writes the WAV and the `.voaice` in the browser.

## vCLONE captures. It does not clone.

`vCLONE` is a voice in the DeltaVerse registry that renders nothing and says so in
three words: *voice not cloned*. This repository is the honest version of that —
capture, measure, print, compare. **There is no synthesiser here**, and nothing
here will turn a capture into a speaking voice.

The `synthesis` field in every `.voaice` is the seam where one would attach, and
it is `null` in every file shipped. It exists so that the interface is written
down and so that a file claiming a voice can be asked *which model speaks it*. A
file that claims otherwise should be disbelieved until it names one.

## Provenance

`engine/oscilloscope.js` is vendored from the DeltaVerse, not linked — a local,
self-contained copy with no CDN and no remote dependency, which is the standing
rule for outside code in this fabric. It is the definition; `tools/vprint.py` is
its twin, and `test/test_vprint.py` is what keeps them one thing rather than two.

## Licence

MIT. See `LICENSE`.
