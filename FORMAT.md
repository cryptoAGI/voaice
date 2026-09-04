# The `.voaice` format

JSON, one voice per file, `format: "voaice/1"`.

```jsonc
{
  "format": "voaice/1",
  "id": "neural", "label": "NEURAL",
  "engine": "piper", "model": "en_GB-alan-medium",
  "sampleRate": 22050,

  "measured": {
    "seconds": 30.17,
    "f0": {
      "median": 97.14, "p10": 86.13, "p90": 108.62,
      "rawMin": 63.18, "rawMax": 400.91,        // kept, but see below
      "frames": 705, "octaveErrorFrames": 5, "octaveErrorPct": 0.7,
      "method": "autocorrelation, 40 ms frames at 20 ms hop, voiced only, r>=0.45"
    },
    "metrics": { "rms": 0.166…, "dominantFrequency": 96.80…, … }   // the eight, as floats
  },

  "vprint": {
    "hash": "44c0ab20…", "hash512": "…", "uint256": "3109768941…",
    "version": "dvscope/1",
    "precision18": { "rms": {"wei": "166260774856505950", "decimal": "0.166260774856505950"}, … },
    "canonical": "{\"v\":\"dvscope/1\",\"precision\":18,\"metrics\":{…}}",
    "params": { "fft": 2048, "hop": 512, "window": "hann",
                "sampleRate": 22050, "framesAveraged": true, "silenceFloorRms": 0.01 }
  },

  "provenance": { "text": "…", "source": "…", "measuredAt": "2026-09-03", "tool": "voaice.py voaice/1" },
  "synthesis": null
}
```

## Rules that are not negotiable

**Metric order is part of the format.** The canonical JSON is built from an
ordered map, so a different order is a different string and a different hash:

```
rms · dominantFrequency · spectralCentroid · spectralRolloff ·
zeroCrossingRate · spectralBandwidth · spectralFlux · harmonicNoiseRatio
```

Do not sort, tidy or alphabetise it.

**The canonical form has no whitespace.** `{"v":"dvscope/1","precision":18,"metrics":{…}}`,
which is what `JSON.stringify` produces and what `json.dumps(separators=(',',':'))`
must reproduce.

**18-decimal encoding is `floor(v * 1e18)` with `1e18` as a float.** Not the exact
integer `10**18`. The IEEE-754 rounding of that multiply is part of the value, and
using the exact integer changes the last digit for most inputs — the two
implementations then disagree while both look right.

**`params` is mandatory in any file used for comparison.** A print without its
measurement parameters is a number nobody can responsibly compare to anything, and
`vprint.compare` refuses rather than guessing.

## Nulls mean nothing was measured

`measured: null` and `vprint: null` are the honest state of an unmeasured voice
(`voices/vclone.voaice`). A plausible-looking number in their place would not be.

## `synthesis` is a seam, not a feature

```jsonc
"synthesis": null
```

The interface a synthesiser would satisfy: given the identity above, produce
speech. Nothing in this repository implements one, and every shipped file has
`null` here. A `.voaice` that claims a voice should be asked which model speaks
it.

## Two kinds of measurement, and they do not mix

| | `tools/voaice.py measure` | `web/capture.html` |
|---|---|---|
| source | a 16-bit PCM wav | a live microphone |
| spectrum | averaged over frames | one analyser frame |
| `framesAveraged` | `true` | `false` |
| `spectralFlux` | structurally `0.0` | real |

They produce different prints for the same voice, on purpose, and `params` records
which is which so the comparison can refuse.
