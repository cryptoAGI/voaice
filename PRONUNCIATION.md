# Pronunciation — how a voice says the names it reads

A `.voaice` says **who** is speaking. This file is about **what they say** — and in particular the
realm's own names, which no synthesiser has ever heard.

**The rule in one line:** a name is fixed by a **respelling** in one table,
[`pronunciation/lexicon.json`](pronunciation/lexicon.json), applied to the text handed to the
synthesiser **and to nothing else**. The page, the captions, the highlighted words, the word counts
and the fingerprints keep the page's own spelling; only the speech hears the respelling.

## The name that started this

On 2026-09-14 a render of [*Savante's First Contribution*](https://rage.pythai.net/savante-first-contribution-pythai/)
was transcribed by whisper.cpp as a check that the audio was real speech. It was — and it said
**"Paitai"**. The operator's answer: *"I pronounce it Pyth-A-I — where Pythia is pronounced as the
oracle of Delphi."*

| | text | what the synthesiser does with it |
|---|---|---|
| written | `PYTHAI` | espeak-ng: /pˈaɪtaɪ/ — "pie-tie"; whisper.cpp heard "Paitai" |
| **said** | `Pith AI` | espeak-ng: /pˈɪθ ˌeɪˈaɪ/ — **Pyth-A-I** |
| written | `PYTHAIML` | espeak-ng: /pˈaɪtaɪməl/ — "pie-tie-mull" |
| **said** | `Pith AI M L` | espeak-ng: /pˈɪθ ˌeɪˈaɪ ˌɛmˈɛl/ |
| written | `SAVANTE` | espeak-ng: /savˈɑːnteɪ/ — "sav-ahn-tay", a third syllable the name does not have |
| **said** | `Sav ont` | espeak-ng: /sˈav ˈɒnt/ — **sav-ont**, as in the old *idiot savant*: the truth teller, the master of mathematics (operator, 2026-09-23). Savante is powered by sAGI © 2026 PYTHAI |

"Pyth" is /pɪθ/, as English says the oracle. espeak-ng's own reading of *Pythia* is /pˈaɪθiə/, so
the respelling is `Pith`, not `Pyth`. Checked in context — a possessive (`Pith AI’s` →
/pˈɪθ ˌeɪˈaɪz/) and a host name (`luv.Pith AI.net` → /lˈʌv dˈɒt pˈɪθ ˌeɪˈaɪ dˈɒt nˈɛt/) both
read correctly.

## Respelling, not phonemes

Every engine in the realm takes **text**. A phoneme string would be exact for one engine and
meaningless to the rest: espeak-ng's inline `[[…]]` notation is espeak-only, the neural engines with
their own front ends ignore it, and a browser voice cannot be given phonemes at all. A respelling
works on every engine that reads English, can be checked by ear, and survives an engine change.
The table records the IPA **as measured** beside each respelling, so the claim can be checked
against the phonemizer rather than taken on trust.

## The table

`pronunciation/lexicon.json`, format `voaice-pronunciation/1`:

```jsonc
{
  "format": "voaice-pronunciation/1",
  "version": 1,                         // bumped by every change; recorded in every render
  "lang": "en",
  "phonemizer": "espeak-ng 1.51, voice en-gb — the front end piper phonemizes through",
  "rule": "case-insensitive, one pass, longest match first; …",
  "entries": [
    { "match": "PYTHAI", "say": "Pith AI",
      "why": "Pyth-A-I: Pyth as in Pythia, the oracle of Delphi, then the letters A and I",
      "source": "operator, 2026-09-14",
      "ipaWritten": "pˈaɪtaɪ", "ipaSaid": "pˈɪθ ˌeɪˈaɪ",
      "phonemizer": "espeak-ng en-gb", "added": "2026-09-14" }
  ]
}
```

Rules that are not negotiable:

- **One pass, longest match first.** `PYTHAIML` is matched before `PYTHAI`, and a replaced span is
  never matched again. Replacing entry by entry would turn `PYTHAIML` into `Pith AIML`.
- **Case-insensitive.** `PYTHAI`, `Pythai` and `pythai.net` are the same name.
- **A spoken form may not contain any entry's match.** An engine that applied the table twice would
  otherwise say something else. `tools/pronounce.py add` refuses it.
- **`version` travels with the audio.** Every render records the version it was made with, so a store
  can find exactly the files a change has made wrong.
- **`source` names who said so.** The operator, or a measurement. A name is not respelled on a guess.

## Using it

```bash
python3 tools/pronounce.py list
#   voaice-pronunciation/1 · version 1 · 2 entries
#   PYTHAIML     → "Pith AI M L"  pythaiml — the PYTHAI machine-learning archive …
#   PYTHAI       → "Pith AI"      Pyth-A-I: Pyth as in Pythia, the oracle of Delphi …

python3 tools/pronounce.py say "PYTHAI's stated target"
#   Pith AI's stated target

python3 tools/pronounce.py find article.txt        # or - for stdin
#   PYTHAI         ×7 → Pith AI

python3 tools/pronounce.py check PYTHAI            # needs espeak-ng
#   as written  PYTHAI         /pˈaɪtaɪ/
#   as said     Pith AI        /pˈɪθ ˌeɪˈaɪ/

python3 tools/pronounce.py add SAVANTE "…" --why "…" --source "operator, 2026-…"
#   measures both IPAs, refuses a spoken form that contains a match, bumps the version
```

In a page or in Node, [`engine/pronounce.js`](engine/pronounce.js) is the twin — the same table, the
same rule, no dependencies:

```html
<script src="engine/pronounce.js"></script>
<script>
  const P = VoaicePronounce.compile(await (await fetch('pronunciation/lexicon.json')).json());
  speechSynthesis.speak(new SpeechSynthesisUtterance(P.spoken(block.text)));   // the speech hears "Pith AI"
  highlight(block.text);                                                        // the page still shows PYTHAI
</script>
```

`python3 test/test_pronounce.py` runs both implementations over the same sentences and requires
identical output — the same discipline as `test_vprint.py`, for the same reason: two implementations
of one rule disagree by default.

## Where pronunciation is decided — every lane, and whether the table reaches it

A name is said by whichever front end turns text into sound. Stating plainly which lanes the table
reaches today:

| lane | heard at | front end | table applied |
|---|---|---|---|
| **The render store** — every rage article pre-rendered in NEURAL and JAIMLA | [rage.pythai.net](https://rage.pythai.net) LISTEN; files under [`deltaverse.pythai.net/audio/`](https://deltaverse.pythai.net/audio/ledger.txt) | piper → espeak-ng | **yes, v1 since 2026-09-14** — mindX `mindx_backend_service/deltaverse/render/lexicon.py` loads `data/config/pronunciation.json`, a byte copy of this table |
| playdocs, `/listen`, `/docsreader` — any page rendered on request | [deltaverse.pythai.net/playdocs](https://deltaverse.pythai.net/playdocs) · [/listen](https://deltaverse.pythai.net/listen) · [/docsreader](https://deltaverse.pythai.net/docsreader) | the docsplayer service → mindX docspeech (piper, espeak-ng) | **yes, v1 since 2026-09-14** — every docspeech engine's `synth()` applies the table (`utils/docspeech/pronunciation.py`), and the docsplayer's render key takes the table version only for texts with a name, so every other held render keeps its key. Verified: a docsplayer render of "PYTHAI is the name, and PYTHAIML is the archive." transcribed by whisper.cpp as "**PIF AI** is the name and **PIF AI ML** is the archive" — /pɪθ/, where it had heard "Paitai" |
| docs read aloud | mindx.pythai.net `/listen/{doc}` | mindX docspeech: espeak-ng over stdin, piper for the neural voices | **yes, v1 since 2026-09-14** — the same wrapped engines as the docsplayer; the build cache key carries `pron1`, so each document is read afresh the first time it is asked for under the table (live in the backend since its restart at 20:50 UTC) |
| **voicey** — the voice stack ([Professor-Codephreak/voaice](https://github.com/Professor-Codephreak/voaice), carried inside mindX at `voaice/`, documented in its `VOICEY.md`): audio.cpp families, Kokoro/OpenVoice, cloning | the `/voicey?persona=&text=` surface of the voaice service | audio.cpp's own front ends; `src/g2p.js` → espeak-ng for the phoneme-driven models | **applied, v1 since 2026-09-14 — audio not yet verified.** `src/pronounce.js` respells the line for audio.cpp, the formant floor and `/speak`; every response carries `X-Voaice-Pronunciation: 1`, and a pre-rendered line's key moves only when it contains a name. The audio could not be checked by ear: audio.cpp takes **135 s** for one short line on the idle host (393 s inside the capped speak slot), past `/voicey`'s 180 s limit, so the line falls to the formant floor — a line with no name does the same, so that is audio.cpp's speed, not the table |
| the browser's own voice (the ANCIENT lane, playdocs' live lane, wordpress.reader's host lane) | any page running the DeltaVerse `voices.js` | the platform voice (Windows, macOS, Android, speech-dispatcher) | **yes, v1 since 2026-09-14** — `voices.js` 1.4.0 carries the table (refreshed from `engine/ngn/pronunciation.json` beside it) and applies it in `utter()`; `DVVoices.pronounce(text)` returns the spoken text and an `original(i)` map, so `doc-reader.js` 2.4.1 and `client-voice.js` light the page's word from a boundary offset in the spoken text |
| visemes — the mouth shapes for a line | the faces on the stage | whisper.cpp timings + espeak-ng IPA of the line | follows the audio; phonemize the **spoken** form so the mouth matches the sound |

A lane's cache must not serve a file said under an older table. Each key takes the table version only for
text containing a name, so audio for everything else stays exactly where it was: the render store's
manifests record `lexicon`, the docsplayer's render key and voicey's line key add `pron<version>`, and
the docs reader's cache key carries it outright.

Until a lane applies the table it says the name the old way. That is stated rather than hidden:
rage's own ledger counts the renders made before v1 as **said wrong**, and the render queue redoes
them after every unrendered and edited article.

## Changing a name — the checklist

1. **Hear the problem.** Transcribe a real render (below) or run `tools/pronounce.py check NAME`.
2. **Get the pronunciation from its owner.** Write who said so in `source`.
3. **Find a respelling that phonemizes to it.** Try candidates with `espeak-ng -q --ipa -v en-gb "…"`,
   and try them *in context*: a possessive, a host name, the start of a sentence.
4. **`tools/pronounce.py add`** — it measures both IPAs, enforces the rules and bumps `version`.
5. **`python3 test/test_pronounce.py`** — Python and JS still agree.
6. **Carry the table to each lane.** For the render store, copy it byte for byte to mindX
   `data/config/pronunciation.json` and deploy the render directory. Its ledger then marks every render
   older than the new version that contains the name as *said wrong*, and the queue re-renders it.
7. **Listen again.**

## The listening test

The check that found "Paitai". No ffmpeg is needed:

```bash
opusdec --quiet --rate 16000 part-01.opus clip.wav
whisper-cli -m ggml-tiny.en.bin -f clip.wav -d 30000 -nt
```

Read the transcript against the page. A name the model has never seen comes back as its nearest
spelling, and that spelling is a phonetic transcription of what was actually said: "Paitai" is
/ˈpaɪtaɪ/.

## How espeak-ng reads the realm's names today

Measured 2026-09-14, espeak-ng 1.51, `en-gb`. **Only PYTHAI and PYTHAIML are confirmed by the
operator.** Every other row is the engine's guess, listed so that a wrong one can be caught by eye
before it is heard in a render.

| name | espeak-ng reads it | | name | espeak-ng reads it |
|---|---|---|---|---|
| **PYTHAI** | pˈaɪtaɪ → **fixed** | | ARIO | ˈaɹɪˌəʊ |
| **PYTHAIML** | pˈaɪtaɪməl → **fixed** | | LUV | lˈʌv |
| mindX | mˈaɪnd ˈɛks | | SHAMBA | ʃˈambə |
| JAIMLA | dʒˈeɪmlə | | sAGI | ˈɛs ˈɑːɡɪ |
| BANKON | bˈaŋkən | | Savante | savˈɑːnteɪ |
| DeltaVerse | dˈɛltə vˈɜːs | | codephreak | kˈəʊdfɹiːk |
| SCIEN·TIFIC | sˈaɪən tˈɪfɪk | | AgenticPlace | eɪdʒˈɛntɪk plˈeɪs |
| aGLM | ɐ dʒˌiːˌɛlˈɛm | | DAIO | dˈeɪəʊ |
| THOT | θˈɒt | | iNFT | ˈaɪ ˌɛnˌɛftˈiː |
| THlNK | tˈiː ˌeɪtʃˈɛl ˌɛŋkˈeɪ | | RAGE | ɹˈeɪdʒ |
| OVERLORD | ˈəʊvəlˌɔːd | | MASTERMIND | mˈastəmˌaɪnd |
| OVERSEER | ˌəʊvəsˈiːə | | AUTOMINDx | ˌɔːtəʊmˈaɪndks |
| voaice | vˈəʊɪs | | audbol | ˈɔːdbɒl |
| playdocs | plˈeɪdɒks | | cypherpunk | sˈaɪfəpˌʌŋk |

Two to look at first: **THlNK** is spelled with a lowercase L, so espeak reads it letter by letter
("T H L N K"); and **voaice** comes out as "voice" — which may be exactly right.

## Hear it

- **rage.pythai.net** — press LISTEN on any article; hold it for the voice menu.
  [Savante's First Contribution](https://rage.pythai.net/savante-first-contribution-pythai/) ·
  [Announcing Savante](https://rage.pythai.net/announcing-savante-sagi-cryptoagi/) ·
  [PYTHAIML — the PYTHAI Machine Learning Archive](https://rage.pythai.net/pythaiml-the-pythai-machine-learning-archive/) ·
  [Three readers, one voice](https://rage.pythai.net/three-readers-one-voice/). A render made before v1
  still says "pie-tie" until the queue reaches it; whether it has is in the
  [ledger](https://deltaverse.pythai.net/audio/ledger.txt) and the
  [queue](https://deltaverse.pythai.net/audio/queue.json).
- **deltaverse.pythai.net** — [playdocs](https://deltaverse.pythai.net/playdocs) reads any page in
  any cast voice; [listen](https://deltaverse.pythai.net/listen) is its reader;
  [docsreader](https://deltaverse.pythai.net/docsreader) is the document player;
  [voices](https://deltaverse.pythai.net/voices) is the cast, including the two `.voaice` files in this
  repository; [docsplayer](https://deltaverse.pythai.net/docsplayer) is the render host.
- **mindX** — [mindx.pythai.net](https://mindx.pythai.net) — the render store's renderers, the render
  queue, the ledger and the docspeech engines live in mindX:
  `mindx_backend_service/deltaverse/render/` (`lexicon.py`, `render_neural.py`, `render_jaimla.py`,
  `render_ledger.py`) and `data/config/pronunciation.json`.
- **voicey** — [Professor-Codephreak/voaice](https://github.com/Professor-Codephreak/voaice), the voice
  stack (speech in, speech out, measured throughout), is carried inside mindX at `voaice/`; this
  repository holds the voices' identity cards, and that one speaks them.
- **The reader** — [Professor-Codephreak/docsreader](https://github.com/Professor-Codephreak/docsreader)
  is wordpress.reader, the LISTEN button on rage.
