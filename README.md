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
voices/overlord.voaice   OVERLORD — layered: the whole cast in one delivery (14 layers), measured, recipe inside
voices/leaderofearth.voaice  LEADER — layered: one voice, shaped (reference ×0.92 speed ×0.88 pitch + broadcast EQ), measured
voices/leader_tone.voaice    LEADER's second face — earth as tone, Jaimla an octave up in echo, measured
voices/espeak-ng/*.espeak.voaice  the espeak-ng lineage of neural · jaimla · overlord · ovie · participant (2026-09-02), measured
archive/espeak-ng-store-2026-09-02/  every espeak-era recording of /map, /periphery and /404, whole, with the renderer of record
archive/first-piper-overlord-2026-09-03/  the two-voice OVERLORD, the stage between espeak and the cast
tools/vprint.py          the voiceprint, server-side
tools/voaice.py          measure a wav into a .voaice; show; compare
web/capture.html         microphone capture + live vprint. No server, nothing uploaded.
engine/oscilloscope.js   the definition the Python twin must agree with
test/test_vprint.py      proves the two agree
pronunciation/lexicon.json  how the realm's names are SAID — one respelling table, every engine
tools/pronounce.py       list · say · find · check (espeak-ng IPA) · add
engine/pronounce.js      the same table and rule, for the browser and Node
test/test_pronounce.py   proves the two say the same thing
PRONUNCIATION.md         the guide to the table: every lane, and whether the table reaches it
FORMAT.md                the .voaice file format
audbol/                  the instrument: exact measurement + the playdocs substrate (see below)
archive/README.md        what the archive holds and why it is kept whole
```

`neural.voaice` and `jaimla.voaice` are the two saved voices of the [DeltaVerse](https://deltaverse.pythai.net/voices) —
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

## The rendered voices, and the lineage kept

OVERLORD and LEADER are not saved voices; they are RECIPES over the saved ones, and the
recipe is written into each file under `recipe` (the registry entry that renders it, verbatim,
from mindX `data/config/docspeech_voices.json`). Their prints were measured 2026-09-24 from the
first 30 s of their rendered reading of [/voices](https://deltaverse.pythai.net/voices), block 1
onward, with the same parameters as the saved voices.

| | OVERLORD | LEADER | LEADER · tone face |
|---|---|---|---|
| recipe | 14 layers on neural, banded, octave/unison by measurement | reference ×0.92 speed ×0.88 pitch, 4-band EQ, 0.85 s pauses | LEADER's body + earth as element + Jaimla an octave up, in echo |
| f0 median | 98.88 Hz (p90 195 — Jaimla on the octave) | **83.52 Hz** | 86.64 Hz |
| vprint | `18ff6e30…8aaf6ef267d` | `60231d6f…2742089488` | `876f7c3a…5b22f535eb9` |

OVERLORD's 27 % "octave errors" are the chord, not a fault: the tracker sees two fundamentals.
Compare it by the eight metrics.

**`overlord.voaice` is the 14-layer recipe of 2026-09-24, not the OVERLORD heard today.** Since
2026-10-07 the OVERLORD voice on rage.pythai.net is a different render (v3): the two neural voices
in unison, aligned frame by frame — see [the voaice family](#where-it-lives--the-voaice-family).
That render has not been measured into a `.voaice` yet, so no print here describes it.

**The espeak-ng lineage is kept, not overwritten.** The realm's first rendered store
(2026-09-02) was espeak-ng 1.51 wearing the voices' names — a stated ratio on the reference,
mapped onto `-s` and `-p` (neural 172/50, jaimla 161/46, overlord 147/42, ovie 185/54,
participant 172/50). On 2026-09-03 neural became piper `en_GB-alan-medium` and the store was
re-rendered; the layered cast followed. `voices/espeak-ng/` holds a measured `.voaice` per voice
of that lineage with the exact command in `recipe`, and `archive/espeak-ng-store-2026-09-02/`
holds every recording of it, whole — manifests, parts and `render-listen.mjs`, the renderer of
record. participant at ×0.98 rounds to neural's 172 wpm, so its espeak rendering is byte-identical
to neural's and carries the same vprint; that is the record, so it is kept as it is.

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

## Pronunciation — what a voice says

A voice is who speaks; [PRONUNCIATION.md](PRONUNCIATION.md) is what they say. The realm's own names
are not in any synthesiser's dictionary — espeak-ng, which piper phonemizes through, reads **PYTHAI**
as "pie-tie", and a whisper.cpp transcript of a real render said "Paitai". The name is **Pyth-A-I**:
Pyth as in Pythia, the oracle of Delphi, then A, I. One table
([`pronunciation/lexicon.json`](pronunciation/lexicon.json)) respells it for the speech only,
`tools/pronounce.py` and `engine/pronounce.js` apply it identically, and the guide says which lanes
the table reaches today and which it does not yet.

The table is at **v4, 36 entries**: the realm's names (PYTHAI, PYTHAIML, SAVANTE; v4 adds
**DeltaVerse → "Delta Verse"**, because the OVERLORD blend smeared the joined word to "Delta V")
and, since v3, the **bankML register** — scientific, technical and financial terms (`tok/s`,
`GGUF`, `ERC-`, `x402`, `18dp`, …). Each entry records the version that added it (`since`), so a
render is called *said wrong* only for names the table learned after it was made.

```bash
python3 tools/pronounce.py check PYTHAI     # /pˈaɪtaɪ/ as written · /pˈɪθ ˌeɪˈaɪ/ as said (needs espeak-ng)
python3 test/test_pronounce.py              # ok: 8 cases, python == node, table v4 with 36 entries
```

## Heard in

- **[rage.pythai.net](https://rage.pythai.net)** — every article's LISTEN button plays NEURAL and
  JAIMLA from files rendered ahead, e.g.
  [Savante's First Contribution](https://rage.pythai.net/savante-first-contribution-pythai/) and
  [Three readers, one voice](https://rage.pythai.net/three-readers-one-voice/); the render store's
  [ledger](https://deltaverse.pythai.net/audio/ledger.txt) measures each file against its text.
- **[deltaverse.pythai.net/playdocs](https://deltaverse.pythai.net/playdocs)** — any page, read in any
  cast voice, with the substrate that [`audbol/`](audbol/) keeps byte for byte;
  [listen](https://deltaverse.pythai.net/listen) · [docsreader](https://deltaverse.pythai.net/docsreader) ·
  [voices](https://deltaverse.pythai.net/voices) · [docsplayer](https://deltaverse.pythai.net/docsplayer).
- **[mindX](https://mindx.pythai.net)** — the renderers, the render queue and ledger, and the docspeech
  engines that speak these voices; its copy of the pronunciation table is
  `data/config/pronunciation.json`.
- **voicey** — [Professor-Codephreak/voaice](https://github.com/Professor-Codephreak/voaice), the voice
  stack (TTS, cloning, ASR), carried inside mindX at `voaice/`. This repository is the identity card;
  that one is the voice. The `/voicey` surface itself is in the copy mindX runs (v3.4+) and is not
  yet published there — GitHub holds v3.3.0.
- **[wordpress.reader](https://github.com/Professor-Codephreak/docsreader)** — the LISTEN button itself.

## Provenance

`engine/oscilloscope.js` is vendored from the DeltaVerse, not linked — a local,
self-contained copy with no CDN and no remote dependency, which is the standing
rule for outside code in this fabric. It is the definition; `tools/vprint.py` is
its twin, and `test/test_vprint.py` is what keeps them one thing rather than two.

## audbol — the instrument, and the wiring to expand from

[`audbol/`](audbol/) measures a file exactly (every quantity a `Fixed18`, every
report carrying the sha256 of the bytes) and puts the playdocs **substrate** under
it: `python -m audbol serve FILE` opens one loopback page where the ground, the
ring and the strip draw the voice as it plays, and a region dragged on the
waveform is re-measured on the host. The five substrate modules are kept byte for
byte with their hashes (`audbol/substrate/PROVENANCE.md`) as a **template**;
`python -m audbol template DIR` copies it out to build on.

[`audbol/WIRING.md`](audbol/WIRING.md) is the part that matters here: one tap,
three readouts, and how a band of the spectrum becomes an event you can act on —
onset, silence, timbre, **identity** (a live voiceprint held against
`voices/*.voaice`), and a host-lane proof of any region. Extend from the wiring,
not from the picture.

## Tests

```bash
python3 test/test_vprint.py                  # python and the browser agree on every case
python3 test/test_pronounce.py               # the table, said the same in python and node
cd audbol && python3 -m pytest -q tests      # 14 passed
```

All three need only `python3` and `node`; run 2026-10-07, all pass.

## Where it lives — the voaice family

voaice has two public origins. They are halves of one idea, not copies:

| | what it is |
|---|---|
| **[cryptoAGI/voaice](https://github.com/cryptoAGI/voaice)** — this repository | what a voice **is**, written down: identity cards, the vprint, vCLONE capture, the pronunciation table, the espeak-ng archive |
| **[Professor-Codephreak/voaice](https://github.com/Professor-Codephreak/voaice)** | the voice **stack**: in-house DSP, 18-dp scientific and forensic voiceprints, a non-destructive editor, WAV/OGG export, torch-free neural TTS and zero-shot cloning |

Where the voices are heard and kept:

- **Voice library on Hugging Face** — [PYTHAI/voaice](https://huggingface.co/PYTHAI/voaice):
  70 open-licensed [Piper](https://github.com/rhasspy/piper) voices, unchanged from
  [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices), each with its own licence
  and model card; Piper credited. Being published now — it may still be private when you read this.
- **The pronunciation table** — [PRONUNCIATION.md](PRONUNCIATION.md) ·
  [`pronunciation/lexicon.json`](pronunciation/lexicon.json), here.
- **playdocs** — [deltaverse.pythai.net/playdocs](https://deltaverse.pythai.net/playdocs): any page
  read in any cast voice. The ANCIENT lane renders on the reader's own device, inside a budget the
  reader sets for processor, memory and graphics (shared with LISTEN), and asks the host only when
  the device cannot. Also [/listen](https://deltaverse.pythai.net/listen), the cast at
  [/voices](https://deltaverse.pythai.net/voices), and the render
  [ledger](https://deltaverse.pythai.net/audio/ledger.txt). Source:
  [Professor-Codephreak/playdocs](https://github.com/Professor-Codephreak/playdocs).
- **The audio deck on [rage.pythai.net](https://rage.pythai.net)** — every article is read aloud
  from pre-rendered audio; the LISTEN button opens the deck
  ([docsreader](https://github.com/Professor-Codephreak/docsreader)).
- **The OVERLORD voice** — heard on
  [OVERLORD of the DeltaVerse](https://rage.pythai.net/overlord-of-the-deltaverse/); sample:
  [overlord-v3-presence.opus](https://deltaverse.pythai.net/audio/samples/overlord-v3-presence.opus).
  Two neural voices in unison, aligned frame by frame (DTW) and re-timed without re-pitching
  (WSOLA) — residual lag 0–10 ms, from a v1 median of ~100 ms — with an octave and a fifth below,
  presence harmonics, and a diffuse hall with no discrete echo.
- **[ollywoo](https://deltaverse.pythai.net/ollywoo)** — the whole suite from the high-end UI:
  the Hollywood of AI avatars, staged inside DeltaVerse, where **irecto** (the director) deploys
  the finished personas and every participant is at once director and performer.
- **Siblings** — [faicey](https://github.com/Professor-Codephreak/faicey) (FACE) ·
  [facerig](https://github.com/Professor-Codephreak/facerig) (RIG) ·
  [aivatar](https://github.com/Professor-Codephreak/aivatar) (the being they compose) ·
  [mindX](https://mindx.pythai.net) · [DeltaVerse](https://deltaverse.pythai.net).

## Licence

MIT. See `LICENSE`.
