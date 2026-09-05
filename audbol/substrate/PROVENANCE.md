# The substrate, saved

These five modules are the substrate of `https://deltaverse.pythai.net/playdocs`,
copied **byte for byte** from the DeltaVerse engine so audbol can put the same
picture under its own measurements. They are not edited here. When one changes
upstream, copy it again and update this file; do not patch the copy.

| file | what it is on playdocs | sha256 |
|---|---|---|
| `voice-scope.js` | the **ground** (full-bleed) and the **strip** (deck oscilloscope): waveform, log spectrum, inflection, drawn from ONE analyser read per frame; four honest states (live / resting / untapped / unknown); voiceprint every `printHz` | `9cbb8d97bc107c40619c3adc0e95e7fcc7ced3b01b6ef87acb36f60850e44da1` |
| `periphery-frame.js` | the **border**: nine stations in a perspective frustum, eight on the ring, each `charge()`d by one log-spaced band of the playing voice's spectrum | `47cb337f2723db11b4aad3177ebbf4356633c80e5b8c34926caacdebab3d4be1` |
| `oscilloscope.js` | `DVScope`: the eight acoustic metrics at 18 decimals over uint256 and the SHA-256/512 voiceprint — the browser-lane twin of `audbol.measure` | `8b155f6053ac4764df19fc6d70c6b75887175cb62c80efe34265536609aeeefa` |
| `waveform.js` | the **deck**: Audacity-grade waveform with a 256-branch peak pyramid, ruler, selection, playhead, sample-level zoom | `04d6e021abb518027eb79ce07d9c39077cf27d2cf40738f4c3315dbf154070cc` |
| `theme-read.js` | reads the `--dv-*` palette so the substrates recolour with the theme | `470fa1909c6624079ca1e5844f8c73307f5ed347449889829f7d8ddf9e644aab` |

Source: `github.com/Professor-Codephreak/DeltaVerse` (local `~/DeltaVerse`),
`engine/ngn/`, at commit `58b4245dd63495b0765fdbc8aa37f2eca5b1dce4` (2026-09-03),
MIT licence (Professor Codephreak / PYTHAI / AgenticPlace). Saved 2026-09-04.

Verify: `cd substrate && sha256sum -c <(grep -o '`[0-9a-f]\{64\}`.*' PROVENANCE.md | ...)` —
or simply `sha256sum *.js` and compare with the table.

## Why audbol wants it

audbol measures a file exactly, once, in Python. The substrate measures the
signal *as it plays*, in the browser, with the same formulas' sibling
(`DVScope`) and draws what it measured. Put together — `python -m audbol serve
FILE` — the picture is the audio you are hearing and the numbers under it are
the audio in the file, and the two can be held against each other for any
region you select on the waveform. That is the interaction: select, and the
selection is re-measured on the host in Fixed18.

## The band split, shared

playdocs lights the eight ring stations from eight log-spaced bands over
80–8000 Hz. audbol's `measure.BANDS` are named (sub / low / intelligibility /
presence / air). `serve.py` reports both: the ring keeps its eight for the
picture, the report keeps its five for the claim.
