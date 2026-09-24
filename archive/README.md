# archive — recordings kept for posterity

Nothing here is served. The live store is `https://deltaverse.pythai.net/audio/<doc>/<voice>/`
and it is re-rendered whenever a voice or a page changes; a render is swapped in whole and the
recording it replaces is deleted. This directory is where the replaced lineages are kept.

## espeak-ng-store-2026-09-02/

The realm's first rendered store: `/map`, `/periphery` and `/404` in five voices, rendered by
`render-listen.mjs` (kept beside them) with **espeak-ng 1.51** `-v en-us`, each voice a stated
ratio on the reference mapped onto `-s` (wpm, base 175) and `-p` (pitch, base 50), encoded
`opusenc --bitrate 24 --downmix-mono`. Layout per voice:

```
<doc>/<voice>/manifest.json   doc, voice, derivedFrom, wpm, pitch, generated, seconds, parts[] with
                              per-block marks (the exact second each block begins, measured from the WAV)
<doc>/<voice>/part-NN.opus    ~4 minutes each; the URL in the manifest carries a content hash `v`
```

| voice | wpm | pitch | derivedFrom |
|---|---|---|---|
| neural | 172 | 50 | the reference |
| jaimla | 161 | 46 | neural ×0.92 rate ×0.92 pitch |
| overlord | 147 | 42 | neural ×0.84 rate ×0.84 pitch |
| ovie | 185 | 54 | neural ×1.06 rate ×1.08 pitch |
| participant | 172 | 50 | neural ×0.98 rate ×1.00 pitch (rounds to neural: byte-identical) |

`/map` here is the page as it read on 2026-09-02 (76 blocks then as now); `/periphery` and `/404`
likewise. The same five voices' espeak renderings of `/voices` were replaced on 2026-09-03 before
any archive existed and are not recoverable. The measured identity of each voice of this lineage
is in `../voices/espeak-ng/<voice>.espeak.voaice`.

A copy of this set also sits on the render host outside the web root at
`/home/deltaverse/archive/espeak-ng-store-2026-09-02/` (the 11 recordings that were still live
when the archive was made; this directory has all 15, from the build mirror).

## first-piper-overlord-2026-09-03/

The OVERLORD between the lineages: neural and jaimla in unison, two piper voices aligned per
sentence — the observation the fourteen-layer cast was later built on. One recording, of `/voices`.
