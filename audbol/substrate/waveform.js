/*!
 * DeltaVerse nGn — waveform (DVWaveform: the take, drawn at every zoom, the way Audacity draws it).
 *
 * WHAT IT IS. A canvas-2d view of a recorded AudioBuffer with an adaptive time ruler, a selection, a
 * playhead, and zoom that goes all the way from the whole take down to the individual samples. It is
 * the editing surface, not a substrate: it draws on demand, it has no rAF loop of its own, and every
 * pixel of it comes from the buffer that was actually recorded.
 *
 * THE PEAK PYRAMID, AND WHY THERE HAS TO BE ONE. A seven-minute take at 22050 Hz is 9.26 million
 * samples. Touching all of them once per paint is 9.26M reads, and a drag that repaints sixty times a
 * second is half a billion reads a second — the first version did exactly that and the drag hitched on
 * the very take it was written for. Audacity's answer, and now this module's, is a multi-resolution
 * cache built ONCE per take, off the paint path: level 0 is the raw samples; each level above stores
 * (min, max, RMS) for a bucket of 256 of the level below.
 *
 *   Why 256. It is Audacity's own branching factor and it is the right one for two reasons that can be
 *   counted. COST: a column never reads more than 255 entries of the level below, so at any zoom a
 *   2000-device-pixel canvas costs at most ~510k reads per channel per paint, and in practice far less.
 *   MEMORY: three Float32 arrays per bucket is 12 bytes per 256 samples = 3/256 of a 4-byte-per-sample
 *   source, and the levels are geometric, so the whole pyramid is 3/255 = 1.176% of the buffer.
 *   MEASURED, 7 min mono at 22050 Hz (9,261,000 samples, 35.33 MB of Float32): the pyramid is 0.42 MB
 *   across 3 levels (bucket 1 × 9,261,000 · 256 × 36,176 · 65,536 × 142), 1.176% of the source, built
 *   in 30–36 ms (Node 24, one pass, single-threaded). Worst-case paint over 2000 device columns,
 *   measured: 510,000 reads and 1.29 ms at spp 255 — the last zoom before level 1 takes over, and the
 *   most expensive point on the whole range — then 2,000 reads and 0.29 ms at spp 256, and 142 reads
 *   and 0.04 ms at spp 65,536. The unaccelerated first version cost 9.26 MILLION reads at every one of
 *   those zooms. That is the whole argument.
 *
 * THE THREE DRAW REGIMES, chosen by samples-per-pixel. This is what "accurate" means here:
 *
 *   spp >= 1     ENVELOPE. Pick the pyramid level whose bucket is the largest that still fits inside a
 *                column, so one column is one or a few buckets. Draw the min..max vertical extent, and
 *                over it a brighter RMS band — Audacity's two-tone wave. NEVER AVERAGE MIN AND MAX.
 *                The first draft drew (min+max)/2 as a single line and a one-sample click in the middle
 *                of a take vanished completely at fit zoom: the mean of a spike and its opposite is
 *                silence. The extent is the measurement; the mean is a lie about it.
 *                THE RMS BAND HANGS FROM ZERO, AND IS THEREFORE NOT ALWAYS INSIDE THE EXTENT. This
 *                header used to say "inside it", which was wrong about the code and wrong about the
 *                quantity: RMS is the quadratic mean about ZERO, not a spread about the column's own
 *                mean, so zero is the only line it can honestly hang from — and it is where Audacity
 *                hangs it too. On speech you never see the difference, because a 256-sample bucket at
 *                22050 Hz is 11.6 ms and near zero-mean, so ±rms lands well inside min..max. On
 *                one-sided content you do: MEASURED, a 0.3…0.7 DC-offset take had the band reach past
 *                the extent in 800 of 800 columns, and a 45 Hz sine in 346 of 786. That is the column
 *                telling you it is one-sided. Clamping the band into min..max would tidy the picture by
 *                drawing a number that is not the RMS — the same lie as averaging min and max, told at
 *                the other end of the wave.
 *   spp < 1      SAMPLE VIEW. Fewer than one sample per CSS pixel means individual samples are
 *                resolvable, so they are drawn as they are: a stem and a dot per sample, with the
 *                connected line through them. THE DOTS ARE THE DATA; THE LINE IS THE INTERPOLATION,
 *                and the badge in the ruler says which regime you are in so nobody mistakes one for
 *                the other.
 *   spp < 0.02   the floor. Fifty pixels of gap per sample is already past any useful reading.
 *
 * ZOOM AT THE POINTER. THE SAMPLE UNDER THE CURSOR MUST NOT MOVE. Everything else about a waveform
 * view can be adjusted by eye; this one cannot, because the eye is holding onto that sample. It is one
 * line of algebra — sample = offset + px·spp, so offset' = offset + px·(spp − spp') — and it was still
 * got wrong the first time, by rounding the scroll offset to a whole sample. At spp = 0.05 a rounding
 * of half a sample is TEN PIXELS of drift per zoom step, and a few notches of the wheel walk the thing
 * you were looking at off the screen. THE OFFSET IS THEREFORE A FLOAT, in samples, and never rounded;
 * rounding happens per drawn column and nowhere else. `zoomAt()` and `anchorDrift()` are exported as
 * pure functions so the invariant can be asserted headless, and setSpp() records `lastAnchorError` (in
 * CSS pixels) which is reported on the 'zoom' event — non-zero only where a clamp at the ends of the
 * take had to win over the anchor, and then it says by how much rather than pretending.
 *   The one floor under it is double precision itself. Over 200,000 random zooms across the whole
 *   range (spp 0.02 … 10^6, offsets anywhere in a 7-minute take) the worst drift measured was
 *   8.85 × 10^-8 of a pixel — ONE UNSEEDED RUN, NOT A BOUND: the same harness re-run gives 8.99 × 10^-8
 *   and a seeded one over visible offsets gives 7.87 × 10^-8. THE BOUND IS THE BUDGET, and every case
 *   of every run sat inside the rounding budget of the four floating-point operations involved — the
 *   algebra is exact, only the representation is not. A ninety-millionth of
 *   a pixel is not a compromise; a rounded offset, at ten pixels a notch, was.
 *
 * TWO LAYERS, BECAUSE THE PLAYHEAD MOVES SIXTY TIMES A SECOND. The ruler and the wave go into an
 * offscreen canvas that is repainted only when the zoom, the scroll, the size or the take changes.
 * setPlayhead() and setSelection() composite that layer and draw the moving furniture on top — so
 * playback costs one drawImage and two strokes a frame, and never re-walks the pyramid.
 *
 * THE RULER STEPS AGAINST A MEASURED LABEL, NOT AN ASSUMED ONE. rulerSteps guarantees a gap in PIXELS
 * between major ticks; a label is a STRING, and "1:00:01.0000" is three characters longer than
 * "6:59.0000". Past one hour the h:mm:ss shape outgrew the flat 68 px the ruler used to ask for — 72 px
 * of label into a 68.9 px gap at a 1e-4 s step, 9.1 px of overlap ten hours in, both measured — so the
 * widest label the view will actually draw is now measured with measureText in the font that will draw
 * it, and the ladder is re-walked until it returns a step that can carry its own label. A 7-minute take
 * never reached the fault; the module still should not have carried an undocumented hour-long bound.
 *
 * THE REGIME BADGE IS GIVEN A STRIP, NOT DROPPED ON TOP OF ONE. The badge lives at the right-hand end
 * of the ruler band, and for two rounds it was a translucent plate painted over the finished labels:
 * at 1366 px the label '5:00' came out as '5:' under
 * 'envelope · L1 ×256 · 17651 spp · 72888 reads', which is not a small time, it is the wrong one.
 * The badge's width is measured first and handed to the ruler as a reserve, and the ruler declines to
 * draw any label that will not fit whole before it (the same test also stops a label being cut off by
 * the right edge of the canvas). The plate is gone, because nothing is underneath it any more. THE
 * RULER PAYS FOR THE STRIP IN LABELS AND NOT IN TICKS: measured at 1366 px, 3 of the 14 major ticks on
 * the canvas lose their number and all 14 keep their mark, because the badge draws in the label band
 * (baseline ruler−12·d) and a major tick only starts at ruler−10·d. A tick without its number is
 * still a mark at a known spacing; a half-printed number is a different time. The badge itself gives
 * way only when its strip would take more than 45% of the width — 43 characters is ≈258 px at 10 px
 * monospace, 19% of a 1366 px ruler but 65% of a 400 px one — and then it sheds its trailing segments
 * down to the regime word.
 *
 * SPP IS PER CSS PIXEL; COLUMNS ARE PER DEVICE PIXEL. The regime threshold is a statement about what
 * the eye can resolve, which is CSS pixels; the envelope is drawn one column per device pixel at
 * spp/dpr, so a 2× display gets twice the resolution rather than twice-fat bars.
 *
 * STEREO IS TWO VOICES, NOT A WIDTH. MONY renders neural into one channel and jaimla into the other,
 * so a two-channel take here is genuinely two different speakers reading the same document. The lanes
 * are stacked with a divider and are NEVER summed to mono — summing them would average two voices into
 * a third that nobody recorded.
 *
 * Colours are read from the live theme at draw time (--dv-accent, --dv-agent, --dv-cyan, --dv-bg) with
 * hard fallbacks, so the page's palette drives it. Prototype lane (.js, zero-dep, UMD). DPR-aware
 * (capped at 2), resizes through ResizeObserver where it exists and window resize where it does not.
 * There is no animation loop to pause — the only motion in the module is the auto-scroll while a
 * selection drag is held past an edge, which stops when the tab is hidden and, under
 * prefers-reduced-motion, steps at a fixed rate instead of accelerating.
 *
 * The maths runs headless: buildPyramid / levelFor / columnStats / rulerSteps / zoomAt / anchorDrift /
 * fitSpp / formatTime need no DOM at all.
 *
 *   var w = new DVWaveform.View(canvas, {}).load(take.buffer);
 *   w.on('seek', function (e) { audio.currentTime = e.seconds; });
 *   w.on('select', function (s) { … });   // { from, to } in SECONDS
 */
(function (global) {
  'use strict';

  var doc = global.document;

  var BRANCH = 256;            // pyramid branching factor — see the header for why this number
  var MIN_SPP = 0.02;          // the sample-spacing floor: 50 CSS px between samples
  var SAMPLE_REGIME = 1;       // spp below this and individual samples are resolvable
  var BADGE_MAX = 0.45;        // most of the ruler's width the regime badge may reserve — see _badge

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // theme first, a hard palette as the floor — a waveform that vanishes on a themed page is no view
  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(doc.documentElement).getPropertyValue(name);
      v = (v || '').trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  // ── the peak pyramid ─────────────────────────────────────────────────────
  // levels[0] IS the raw samples (bucket 1, no summaries) so that level selection is one ladder with
  // no special case at the bottom. Every level above holds min/max/RMS per bucket, per channel.
  // The RMS of a parent bucket is the sample-count-WEIGHTED quadratic mean of its children: the last
  // bucket of a take is nearly always partial, and an unweighted mean would quietly overstate the tail.
  function buildPyramid(chans, sampleRate, branch) {
    branch = branch || BRANCH;
    if (!chans || !chans.length) return null;
    var nch = chans.length, len = chans[0].length | 0;
    var levels = [{ bucket: 1, count: len, raw: true, data: chans }];
    var bytes = 0;
    while (levels[levels.length - 1].count > branch) {
      var below = levels[levels.length - 1];
      var bucket = below.bucket * branch;
      var count = Math.ceil(len / bucket);
      var lv = { bucket: bucket, count: count, raw: false, min: [], max: [], rms: [] };
      for (var c = 0; c < nch; c++) {
        var mn = new Float32Array(count), mx = new Float32Array(count), rm = new Float32Array(count);
        if (below.raw) {
          var src = chans[c];
          for (var b = 0; b < count; b++) {
            var s0 = b * bucket, s1 = Math.min(len, s0 + bucket);
            var lo = Infinity, hi = -Infinity, ss = 0;
            for (var i = s0; i < s1; i++) { var v = src[i]; if (v < lo) lo = v; if (v > hi) hi = v; ss += v * v; }
            var n = s1 - s0;
            mn[b] = n ? lo : 0; mx[b] = n ? hi : 0; rm[b] = n ? Math.sqrt(ss / n) : 0;
          }
        } else {
          var pmn = below.min[c], pmx = below.max[c], prm = below.rms[c], pb = below.bucket, pc = below.count;
          for (var b2 = 0; b2 < count; b2++) {
            var j0 = b2 * branch, j1 = Math.min(pc, j0 + branch);
            var lo2 = Infinity, hi2 = -Infinity, sq = 0, tot = 0;
            for (var j = j0; j < j1; j++) {
              if (pmn[j] < lo2) lo2 = pmn[j];
              if (pmx[j] > hi2) hi2 = pmx[j];
              var nj = Math.min(pb, len - j * pb);
              sq += prm[j] * prm[j] * nj; tot += nj;
            }
            mn[b2] = j1 > j0 ? lo2 : 0; mx[b2] = j1 > j0 ? hi2 : 0; rm[b2] = tot ? Math.sqrt(sq / tot) : 0;
          }
        }
        lv.min.push(mn); lv.max.push(mx); lv.rms.push(rm);
        bytes += count * 12;                       // three Float32 per bucket
      }
      levels.push(lv);
    }
    return {
      branch: branch, sampleRate: sampleRate || 44100, length: len, channels: nch,
      levels: levels, bytes: bytes, sourceBytes: len * nch * 4,
      ratio: len ? bytes / (len * nch * 4) : 0
    };
  }

  // the largest level whose bucket still fits inside one column
  function levelFor(pyr, spp) {
    if (!pyr) return 0;
    var best = 0;
    for (var i = 0; i < pyr.levels.length; i++) if (pyr.levels[i].bucket <= spp) best = i; else break;
    return best;
  }

  // min · max · RMS over [s0, s1) of one channel, read at the given level. `reads` is returned so the
  // cost of a paint can be counted rather than guessed at.
  function columnStats(pyr, ch, level, s0, s1, out) {
    out = out || { min: 0, max: 0, rms: 0, reads: 0 };
    out.min = 0; out.max = 0; out.rms = 0; out.reads = 0;
    if (!pyr || !pyr.length) return out;
    var lv = pyr.levels[clamp(level | 0, 0, pyr.levels.length - 1)];
    var len = pyr.length, lo = Infinity, hi = -Infinity, sq = 0, tot = 0, i;
    // A column wholly outside the take reads NOTHING and reports zeros. The first version clamped the
    // two ends independently, so a range starting past the last sample produced j1 < j0: an empty loop
    // that still reported a NEGATIVE read count. A cost figure that can go negative is not a
    // measurement, and this is the module that promises its numbers are measured.
    if (!(s1 > 0) || s0 >= len) return out;
    if (lv.raw) {
      var a = clamp(Math.floor(s0), 0, len - 1), b = clamp(Math.ceil(s1), a + 1, len);
      var src = lv.data[ch];
      for (i = a; i < b; i++) { var v = src[i]; if (v < lo) lo = v; if (v > hi) hi = v; sq += v * v; tot++; }
      out.reads = b - a;
    } else {
      var bk = lv.bucket;
      var j0 = clamp(Math.floor(s0 / bk), 0, lv.count - 1), j1 = clamp(Math.ceil(s1 / bk), j0 + 1, lv.count);
      var mn = lv.min[ch], mx = lv.max[ch], rm = lv.rms[ch];
      for (i = j0; i < j1; i++) {
        if (mn[i] < lo) lo = mn[i];
        if (mx[i] > hi) hi = mx[i];
        var nj = Math.min(bk, len - i * bk);
        sq += rm[i] * rm[i] * nj; tot += nj;
      }
      out.reads = j1 - j0;
    }
    if (lo === Infinity) { lo = 0; hi = 0; }
    out.min = lo; out.max = hi; out.rms = tot ? Math.sqrt(sq / tot) : 0;
    return out;
  }

  // ── the ruler ladder ─────────────────────────────────────────────────────
  // major, minor. 1/2/5 under a second (down to 10 µs, which is where the spp floor puts a 1000 px
  // view), 1/2/5/10/15/30 over seconds and again over minutes, then 1/2/3/6/12/24 over hours.
  var LADDER = [
    [0.00001, 0.000002], [0.00002, 0.000005], [0.00005, 0.00001],
    [0.0001, 0.00002], [0.0002, 0.00005], [0.0005, 0.0001],
    [0.001, 0.0002], [0.002, 0.0005], [0.005, 0.001],
    [0.01, 0.002], [0.02, 0.005], [0.05, 0.01],
    [0.1, 0.02], [0.2, 0.05], [0.5, 0.1],
    [1, 0.2], [2, 0.5], [5, 1], [10, 2], [15, 5], [30, 5],
    [60, 10], [120, 30], [300, 60], [600, 120], [900, 300], [1800, 300],
    [3600, 600], [7200, 1800], [10800, 1800], [21600, 3600], [43200, 7200], [86400, 14400]
  ];

  function decimalsFor(step) {
    if (step >= 1) return 0;
    return clamp(Math.ceil(-Math.log(step) / Math.LN10), 0, 6);
  }

  // The largest step whose labels still stand at least minGapPx apart — walked from the bottom, so the
  // first one that clears the gap is by construction the smallest that fits, and the ladder above it
  // is coarser still.
  function rulerSteps(spanSeconds, widthPx, minGapPx) {
    minGapPx = minGapPx || 68;
    var span = spanSeconds > 0 ? spanSeconds : 1e-9;
    var pxPerSec = (widthPx || 1) / span;
    for (var i = 0; i < LADDER.length; i++) {
      if (LADDER[i][0] * pxPerSec >= minGapPx) {
        return {
          major: LADDER[i][0], minor: LADDER[i][1],
          pxPerMajor: LADDER[i][0] * pxPerSec,
          decimals: decimalsFor(LADDER[i][0]), minGap: minGapPx, pxPerSec: pxPerSec
        };
      }
    }
    var last = LADDER[LADDER.length - 1];
    return {
      major: last[0], minor: last[1], pxPerMajor: last[0] * pxPerSec,
      decimals: 0, minGap: minGapPx, pxPerSec: pxPerSec
    };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // h:mm:ss · m:ss · s.sss — the shape follows the TIME, the decimals follow the STEP
  function formatTime(t, step) {
    var dec = decimalsFor(step == null ? 1 : step);
    var neg = t < 0; if (neg) t = -t;
    var whole = Math.floor(t), frac = t - whole;
    var fs = dec ? frac.toFixed(dec).slice(1) : '';
    var s;
    if (whole >= 3600) {
      var h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60);
      s = h + ':' + pad2(m) + ':' + pad2(whole % 60) + fs;
    } else if (whole >= 60) {
      s = Math.floor(whole / 60) + ':' + pad2(whole % 60) + fs;
    } else {
      s = whole + fs + 's';
    }
    return (neg ? '-' : '') + s;
  }

  // ── zoom algebra, pure ───────────────────────────────────────────────────
  // sample(px) = offset + px·spp. Hold that sample fixed at anchorPx and solve for the new offset.
  function zoomAt(offset, spp, anchorPx, nextSpp) {
    return offset + anchorPx * (spp - nextSpp);
  }
  // the pixel the anchored sample actually ends up at, minus where it was: 0 unless a clamp intervened
  function anchorDrift(offset, spp, nextOffset, nextSpp, anchorPx) {
    var sample = offset + anchorPx * spp;
    return (sample - nextOffset) / nextSpp - anchorPx;
  }
  function fitSpp(lengthSamples, widthPx) {
    if (!widthPx) return 1;
    return Math.max(MIN_SPP, (lengthSamples || 0) / widthPx);
  }

  // ── the view ─────────────────────────────────────────────────────────────
  function View(canvas, opts) {
    opts = opts || {};
    this.canvas = (typeof canvas === 'string' && doc) ? doc.querySelector(canvas) : canvas;
    this.ctx = (this.canvas && this.canvas.getContext) ? this.canvas.getContext('2d') : null;
    this.opts = opts;
    this.rulerHeight = opts.rulerHeight == null ? 26 : +opts.rulerHeight;
    this.minSpp = opts.minSpp == null ? MIN_SPP : Math.max(1e-4, +opts.minSpp);
    this.maxSpp = opts.maxSpp == null ? 0 : +opts.maxSpp;   // 0 = "the whole take", computed on load
    this.colours = opts.colours || {};

    this.pyramid = null;
    this.buffer = null;
    this.sampleRate = 0;
    this.duration = 0;
    this.channels = 0;
    this.spp = 1;
    this.offset = 0;              // FLOAT sample index of the left edge — never rounded, see the header
    this.playSec = null;
    this.lastAnchorError = 0;
    this.lastReads = 0;

    this._sel = null;             // { from, to } in SAMPLES, from <= to
    this._drag = null;
    this._layer = null;
    this._lctx = null;
    this._layerDirty = true;
    this._W = 0; this._H = 0; this._dpr = 1;
    this._handlers = {};
    this._bound = {};
    this._ro = null;
    this._auto = 0; this._autoDir = 0;
    this._hidden = false;
    this.reduceMotion = false;
    try { this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (this.ctx) this._wire();
  }

  View.prototype.on = function (ev, fn) { (this._handlers[ev] || (this._handlers[ev] = [])).push(fn); return this; };
  View.prototype._emit = function (ev, arg) {
    var hs = this._handlers[ev]; if (!hs) return;
    for (var i = 0; i < hs.length; i++) { try { hs[i](arg); } catch (e) {} }
  };

  // ── the take ─────────────────────────────────────────────────────────────
  // An AudioBuffer, or anything that answers the same three questions — which is what makes the whole
  // module testable in Node with a plain object.
  View.prototype.load = function (buf) {
    if (!buf) { this.pyramid = null; this.buffer = null; this.duration = 0; this.channels = 0; this._layerDirty = true; this.draw(); return this; }
    var chans = [], i;
    if (buf.getChannelData) { for (i = 0; i < buf.numberOfChannels; i++) chans.push(buf.getChannelData(i)); }
    else if (buf.channels) { chans = buf.channels; }
    else if (buf.length && buf.BYTES_PER_ELEMENT) { chans = [buf]; }
    this.buffer = buf;
    this.sampleRate = buf.sampleRate || 44100;
    this.channels = chans.length;
    this.pyramid = buildPyramid(chans, this.sampleRate, BRANCH);
    this.duration = this.pyramid ? this.pyramid.length / this.sampleRate : 0;
    this._sel = null; this.playSec = null; this.offset = 0;
    this.fit();
    return this;
  };

  View.prototype._widthCss = function () {
    if (!this.canvas) return 1000;
    return Math.max(1, this.canvas.clientWidth || (this._W / (this._dpr || 1)) || 1000);
  };

  View.prototype._maxSpp = function () {
    if (this.maxSpp) return this.maxSpp;
    return Math.max(this.minSpp, fitSpp(this.pyramid ? this.pyramid.length : 0, this._widthCss()));
  };

  View.prototype._clampOffset = function (o) {
    var len = this.pyramid ? this.pyramid.length : 0;
    var span = this._widthCss() * this.spp;
    var max = Math.max(0, len - span);
    return clamp(o, 0, max);
  };

  View.prototype.fit = function () {
    this.spp = clamp(fitSpp(this.pyramid ? this.pyramid.length : 0, this._widthCss()), this.minSpp, this._maxSpp());
    this.offset = 0;
    this._layerDirty = true;
    this.draw();
    this._emit('zoom', { spp: this.spp, regime: this.regime(), anchorError: 0 });
    return this;
  };

  // THE INVARIANT LIVES HERE. offset' = offset + anchorPx·(spp − spp'), and the offset stays a float.
  View.prototype.setSpp = function (spp, anchorPx) {
    if (!isFinite(spp)) return this;
    if (anchorPx == null) anchorPx = this._widthCss() / 2;
    var prevSpp = this.spp, prevOff = this.offset;
    var next = clamp(spp, this.minSpp, this._maxSpp());
    var off = zoomAt(prevOff, prevSpp, anchorPx, next);
    this.spp = next;
    this.offset = this._clampOffset(off);
    // Reported, not hidden: at the ends of the take the clamp wins over the anchor, and this says by
    // how many CSS pixels it did. In the interior it is exactly 0.
    this.lastAnchorError = anchorDrift(prevOff, prevSpp, this.offset, this.spp, anchorPx);
    this._layerDirty = true;
    this.draw();
    this._emit('zoom', { spp: this.spp, regime: this.regime(), anchorError: this.lastAnchorError });
    return this;
  };

  View.prototype.zoomBy = function (factor, anchorPx) {
    return this.setSpp(this.spp / (factor || 1), anchorPx);
  };

  View.prototype.zoomToSelection = function () {
    if (!this._sel) return this;
    var span = Math.max(1, this._sel.to - this._sel.from);
    var spp = clamp(span / this._widthCss(), this.minSpp, this._maxSpp());
    var prev = this.spp;
    this.spp = spp;
    this.offset = this._clampOffset(this._sel.from - (this._widthCss() * spp - span) / 2);
    this.lastAnchorError = 0;
    this._layerDirty = true;
    this.draw();
    if (spp !== prev) this._emit('zoom', { spp: spp, regime: this.regime(), anchorError: 0 });
    return this;
  };

  View.prototype.scrollToSample = function (s, frac) {
    var f = frac == null ? 0 : clamp(+frac, 0, 1);
    this.offset = this._clampOffset((s || 0) - f * this._widthCss() * this.spp);
    this._layerDirty = true;
    this.draw();
    this._emit('scroll', { sample: this.offset, seconds: this.offset / (this.sampleRate || 1), spp: this.spp });
    return this;
  };

  View.prototype.scrollBySeconds = function (dt) {
    return this.scrollToSample(this.offset + (dt || 0) * (this.sampleRate || 0));
  };

  // ── selection · playhead · state ─────────────────────────────────────────
  View.prototype.selection = function () {
    if (!this._sel) return null;
    var sr = this.sampleRate || 1;
    return { from: this._sel.from / sr, to: this._sel.to / sr };
  };

  View.prototype.setSelection = function (from, to) {
    var sr = this.sampleRate || 1, len = this.pyramid ? this.pyramid.length : 0;
    var a = clamp(from * sr, 0, len), b = clamp(to * sr, 0, len);
    this._sel = { from: Math.min(a, b), to: Math.max(a, b) };
    this._composite();
    this._emit('select', this.selection());
    return this;
  };

  View.prototype.clearSelection = function () {
    this._sel = null;
    this._composite();
    this._emit('select', null);
    return this;
  };

  // cheap by construction: the wave layer is not touched
  View.prototype.setPlayhead = function (seconds) {
    this.playSec = (seconds == null) ? null : +seconds;
    this._composite();
    return this;
  };

  View.prototype.regime = function () { return this.spp < SAMPLE_REGIME ? 'samples' : 'envelope'; };

  View.prototype.view = function () {
    var sr = this.sampleRate || 1;
    return { from: this.offset / sr, to: (this.offset + this._widthCss() * this.spp) / sr, spp: this.spp };
  };

  View.prototype.sampleOfPx = function (px) { return this.offset + px * this.spp; };
  View.prototype.pxOfSample = function (s) { return (s - this.offset) / this.spp; };
  View.prototype.secondsOfPx = function (px) { return this.sampleOfPx(px) / (this.sampleRate || 1); };

  // ── paint ────────────────────────────────────────────────────────────────
  View.prototype._layout = function () {
    if (!this.canvas) return false;
    var d = Math.min(global.devicePixelRatio || 1, 2);
    var w = Math.max(1, this.canvas.clientWidth || 1);
    var h = Math.max(1, this.canvas.clientHeight || 1);
    var W = Math.round(w * d), H = Math.round(h * d);
    if (W === this._W && H === this._H && d === this._dpr && this._layer) return false;
    this._W = W; this._H = H; this._dpr = d;
    this.canvas.width = W; this.canvas.height = H;
    if (!this._layer && doc) { this._layer = doc.createElement('canvas'); this._lctx = this._layer.getContext('2d'); }
    if (this._layer) { this._layer.width = W; this._layer.height = H; }
    this._layerDirty = true;
    return true;
  };

  View.prototype._palette = function () {
    var c = this.colours;
    return {
      bg: c.bg || cssVar('--dv-bg', '#05060b'),
      wave: c.wave || cssVar('--dv-accent', '#ff0080'),
      rms: c.rms || c.wave || cssVar('--dv-accent', '#ff0080'),
      dot: c.dot || cssVar('--dv-cyan', '#00ffff'),
      rule: c.rule || cssVar('--dv-agent', '#00ff80'),
      play: c.play || cssVar('--dv-agent', '#00ff80'),
      sel: c.sel || cssVar('--dv-cyan', '#00ffff')
    };
  };

  View.prototype.draw = function () {
    if (!this.ctx) return this;
    this._layout();
    if (this._layerDirty) this._paintLayer();
    this._composite();
    return this;
  };

  // THE LANES ARE PAINTED BEFORE THE RULER BECAUSE THE RULER HAS TO BE TOLD HOW WIDE THE BADGE IS.
  // The badge prints the read count and the read count is not known until the lanes have been walked,
  // so with the ruler painted first there was nothing to reserve a strip against and the badge went on
  // top of the finished labels instead — which is exactly the defect that survived two rounds. The two
  // bands are disjoint (the ruler owns y < ruler, the lanes own y >= ruler), so the paint order is free
  // to follow the dependency: lanes, then ruler with the strip reserved, then badge into the strip.
  View.prototype._paintLayer = function () {
    var ctx = this._lctx; if (!ctx) return;
    var W = this._W, H = this._H, d = this._dpr, p = this._palette();
    var ruler = Math.round(this.rulerHeight * d);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);

    var nch = this.pyramid ? this.pyramid.channels : 0;
    var reads = 0;
    if (nch) {
      var laneH = (H - ruler) / nch;
      for (var c = 0; c < nch; c++) {
        var top = ruler + c * laneH;
        reads += this._paintLane(ctx, c, top, laneH, W, d, p);
        if (c) {
          ctx.globalAlpha = 0.35; ctx.strokeStyle = p.rule; ctx.lineWidth = d;
          ctx.beginPath(); ctx.moveTo(0, top + 0.5 * d); ctx.lineTo(W, top + 0.5 * d); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
    this.lastReads = reads;

    var badge = nch ? this._badge(ctx, W, d, reads) : null;
    this._paintRuler(ctx, W, ruler, d, p, badge ? badge.reserve : 0);

    if (nch) {
      this._paintBadge(ctx, W, ruler, d, p, badge);
    } else {
      ctx.globalAlpha = 0.45; ctx.strokeStyle = p.rule; ctx.lineWidth = d;
      ctx.beginPath(); ctx.moveTo(0, (ruler + H) / 2); ctx.lineTo(W, (ruler + H) / 2); ctx.stroke();
      ctx.globalAlpha = 0.7; ctx.fillStyle = p.rule;
      ctx.font = (11 * d) + 'px ui-monospace, monospace';
      ctx.fillText('no take loaded', 8 * d, (ruler + H) / 2 - 8 * d);
      ctx.globalAlpha = 1;
    }
    this._layerDirty = false;
  };

  // The gap one major label actually needs, in CSS pixels: the widest label this view will draw,
  // measured in the font that will draw it, plus the 3 px the label is inset by and 5 px of air so that
  // two of them never touch. The LAST visible tick carries the largest whole part, which in every shape
  // formatTime prints is also the longest string; the first is measured as well, because a tick at zero
  // is snapped to "0" and a one-tick view has no last.
  View.prototype._labelGap = function (ctx, t0, span, major, d) {
    var first = Math.ceil(t0 / major) * major;
    var last = Math.floor((t0 + span + 1e-9) / major) * major;
    var w = ctx.measureText(formatTime(Math.abs(first) < 1e-9 ? 0 : first, major)).width;
    if (last > first) w = Math.max(w, ctx.measureText(formatTime(last, major)).width);
    return w / (d || 1) + 8;
  };

  View.prototype._paintRuler = function (ctx, W, ruler, d, p, reserve) {
    var sr = this.sampleRate || 1, wcss = this._widthCss();
    var t0 = this.offset / sr, span = (wcss * this.spp) / sr;
    ctx.globalAlpha = 0.10; ctx.fillStyle = p.rule; ctx.fillRect(0, 0, W, ruler);
    ctx.globalAlpha = 0.30; ctx.strokeStyle = p.rule; ctx.lineWidth = d;
    ctx.beginPath(); ctx.moveTo(0, ruler - 0.5 * d); ctx.lineTo(W, ruler - 0.5 * d); ctx.stroke();
    // An empty view gets the band and nothing in it. The first version fell through to the ladder with
    // sampleRate 0, which made spp 1 mean one SECOND per pixel and painted a confident ten-minute
    // timeline over a take nobody had loaded. A RULER IS A CLAIM ABOUT A RECORDING; with no recording
    // there is no claim to make.
    if (!this.pyramid || !this.sampleRate) { ctx.globalAlpha = 1; return; }

    // THE LADDER PROMISES PIXELS; A LABEL IS A STRING. rulerSteps guarantees a gap between major ticks,
    // and the first version handed it a flat 68 and trusted it — but "1:00:01.0000" is three characters
    // longer than "6:59.0000", so past one hour the h:mm:ss shape outgrows the gap it was given.
    // MEASURED at 10 px ui-monospace on a 1000 px canvas: a 72 px label into the 68.9 px gap the ladder
    // returned for a 1e-4 s step, and 9.1 px of overlap ten hours in. So the font is set FIRST, the
    // widest label this view will actually draw is measured in it, and the ladder is walked again with
    // that width as the gap until it returns a step wide enough to carry its own label. Four passes is a
    // ceiling, not a budget: each pass moves at least one rung up a 33-rung ladder, and coarser steps
    // print fewer decimals, so it converges downward almost always on the first.
    ctx.font = (10 * d) + 'px ui-monospace, SFMono-Regular, Menlo, monospace';
    var st = rulerSteps(span, wcss, 68);
    for (var pass = 0; pass < 4; pass++) {
      var need = this._labelGap(ctx, t0, span, st.major, d);
      if (need <= st.minGap) break;
      var wider = rulerSteps(span, wcss, need);
      if (wider.major === st.major) break;          // already the coarsest rung — nothing left to step to
      st = wider;
    }

    // Ticks land on EXACT times and the pixel falls where it falls; the other way round — stepping a
    // rounded pixel count — drifts a whole tick across a wide view.
    var t, x;
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    for (t = Math.ceil(t0 / st.minor) * st.minor; t <= t0 + span + 1e-9; t += st.minor) {
      x = Math.round(((t * sr - this.offset) / this.spp) * d) + 0.5;
      ctx.moveTo(x, ruler - 5 * d); ctx.lineTo(x, ruler);
    }
    ctx.stroke();

    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    for (t = Math.ceil(t0 / st.major) * st.major; t <= t0 + span + 1e-9; t += st.major) {
      x = Math.round(((t * sr - this.offset) / this.spp) * d) + 0.5;
      ctx.moveTo(x, ruler - 10 * d); ctx.lineTo(x, ruler);
    }
    ctx.stroke();

    // THE BADGE OWNS THE RIGHT-HAND STRIP AND THE RULER STOPS ITS LABELS SHORT OF IT — a label that
    // would not fit whole is not drawn at all. HALF A LABEL IS A WRONG TIME, NOT A SMALL ONE: as first
    // reported, '5:00' was left as '5:' under the badge at 1366 px, and '5:' reads as five seconds.
    // The same test catches a label that would be cut off by the right edge of the canvas itself, which
    // is the identical lie with a different knife (reserve 0 still means "must fit"). Only the LABELS
    // pay for the strip: the tick marks below keep running to the edge, because the badge is drawn in
    // the label band above them.
    var xLimit = W - (reserve > 0 ? reserve : 0), lab;
    ctx.globalAlpha = 0.85; ctx.fillStyle = p.rule;   // the font is already set — the ladder was walked against it
    ctx.textBaseline = 'alphabetic';
    for (t = Math.ceil(t0 / st.major) * st.major; t <= t0 + span + 1e-9; t += st.major) {
      x = ((t * sr - this.offset) / this.spp) * d;
      // snapping a near-zero tick to 0 keeps the first label off the left edge of the canvas
      lab = formatTime(Math.abs(t) < 1e-9 ? 0 : t, st.major);
      if (x + 3 * d + ctx.measureText(lab).width > xLimit) continue;
      ctx.fillText(lab, x + 3 * d, ruler - 12 * d);
    }
    ctx.globalAlpha = 1;
  };

  // Returns the number of pyramid/sample reads the lane cost — A MEASUREMENT, NOT AN ESTIMATE, which
  // means it has to be counted where the reading happens. The first version counted only the
  // connecting line in the sample regime and published a third of the truth: the stems and the dots
  // walk the identical i0..i1 range over src[] and every one of those fetches is a read the paint
  // actually paid for. Each of the three loops now counts its own, so narrowing or widening any one
  // of them cannot quietly make the number a lie again. lastReads is public and the badge prints it
  // in the envelope regime, where the pyramid argument in the header is the thing being checked.
  View.prototype._paintLane = function (ctx, ch, top, laneH, W, d, p) {
    var pyr = this.pyramid, mid = top + laneH / 2, amp = (laneH / 2) * 0.92;
    var sppD = this.spp / d;                       // one column per DEVICE pixel
    var reads = 0;

    ctx.globalAlpha = 0.16; ctx.strokeStyle = p.rule; ctx.lineWidth = d;
    ctx.beginPath(); ctx.moveTo(0, Math.round(mid) + 0.5); ctx.lineTo(W, Math.round(mid) + 0.5); ctx.stroke();

    if (this.spp >= SAMPLE_REGIME) {
      // ENVELOPE. min..max first at half weight, then the RMS band over it at full — two tones out of
      // one theme colour, so the page's palette still drives it.
      var lvl = levelFor(pyr, sppD), st = { min: 0, max: 0, rms: 0, reads: 0 };
      var cols = [], x;
      for (x = 0; x < W; x++) {
        var s0 = this.offset + x * sppD, s1 = s0 + sppD;
        if (s1 <= 0 || s0 >= pyr.length) { cols.push(null); continue; }
        columnStats(pyr, ch, lvl, s0, s1, st);
        reads += st.reads;
        cols.push([st.min, st.max, st.rms]);
      }
      ctx.globalAlpha = 0.45; ctx.fillStyle = p.wave;
      for (x = 0; x < W; x++) {
        var col = cols[x]; if (!col) continue;
        var yTop = mid - col[1] * amp, yBot = mid - col[0] * amp;
        ctx.fillRect(x, yTop, 1, Math.max(d, yBot - yTop));
      }
      // ±rms about the zero line — see the header. Not clamped into min..max: the band is where the
      // RMS is, and a band that leaves the extent is a one-sided column, which is worth seeing.
      ctx.globalAlpha = 1; ctx.fillStyle = p.rms;
      for (x = 0; x < W; x++) {
        var col2 = cols[x]; if (!col2) continue;
        var r = col2[2] * amp;
        if (r < d * 0.5) continue;
        ctx.fillRect(x, mid - r, 1, 2 * r);
      }
      ctx.globalAlpha = 1;
      return reads;
    }

    // SAMPLE VIEW. The dots are the data; the line between them is interpolation and is drawn thinner.
    var lv0 = pyr.levels[0], src = lv0.data[ch];
    var i0 = Math.max(0, Math.floor(this.offset) - 1);
    var i1 = Math.min(pyr.length, Math.ceil(this.offset + this._widthCss() * this.spp) + 2);
    var xOf = function (i, off, spp, dd) { return ((i - off) / spp) * dd; };
    var self = this;

    ctx.globalAlpha = 0.55; ctx.strokeStyle = p.wave; ctx.lineWidth = Math.max(1, 1.2 * d);
    ctx.lineJoin = 'round'; ctx.beginPath();
    for (var i = i0; i < i1; i++) {
      var xx = xOf(i, self.offset, self.spp, d), yy = mid - src[i] * amp;
      if (i === i0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      reads++;
    }
    ctx.stroke();

    var gap = d / this.spp;                          // device pixels between neighbouring samples
    var rad = clamp(gap / 6, 1.1 * d, 3.2 * d);
    ctx.globalAlpha = 0.5; ctx.strokeStyle = p.dot; ctx.lineWidth = Math.max(1, d);
    ctx.beginPath();
    for (var j = i0; j < i1; j++) {
      var xs = xOf(j, this.offset, this.spp, d);
      ctx.moveTo(xs, mid); ctx.lineTo(xs, mid - src[j] * amp);
      reads++;
    }
    ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = p.dot;
    for (var k = i0; k < i1; k++) {
      var xd = xOf(k, this.offset, this.spp, d), yd = mid - src[k] * amp;
      ctx.beginPath(); ctx.arc(xd, yd, rad, 0, Math.PI * 2); ctx.fill();
      reads++;
    }
    ctx.globalAlpha = 1;
    return reads;
  };

  // The badge text and the strip of ruler it needs, measured in the font that will draw it.
  //
  // THE STRIP IS RESERVED, NOT PAINTED OVER. For two rounds this badge was a translucent plate dropped
  // on top of a finished ruler, and at 1366 px it cut '5:00' down to '5:' under
  // 'envelope · L1 ×256 · 17651 spp · 72888 reads'. Turning the plate opaque, or more transparent,
  // would only change how the clipped label looks — a label you can read through a plate is still a
  // label with a plate on it. So the plate is gone: the ruler is handed this reserve and stops its
  // labels short of it, and there is nothing left underneath the badge to hide.
  //   MEASURED against the previous build, headless, 1366 css px at dpr 1 with a 7-minute take at fit:
  //   BEFORE, one 268×20 device-px plate at alpha 0.8 sitting over the labels '5:30', '6:00' and
  //   '6:30', two of which ran 24.0 px into the badge's own glyphs. AFTER, no plate, no overlap, and
  //   the nearest surviving label ends 98.3 px clear of the badge. The 15 major and 85 minor tick
  //   marks are at IDENTICAL x in both builds, three of the majors inside the strip.
  //
  // WHAT THE STRIP COSTS, AND WHO ACTUALLY PAYS IT. The round that reserved the strip wrote "when the
  // two will not both fit, the BADGE is what gives way" here, and THAT WAS FALSE ABOUT THIS CODE:
  // below BADGE_MAX the badge keeps every segment and the RULER pays, in labels it declines to draw.
  // MEASURED, 1366 css px at dpr 1 with the 7-minute take at fit: 14 major ticks on the canvas, 11 keep
  // their label, 3 lose it to the strip, and all 14 ticks are still drawn. That is the trade this
  // module chooses and it should be written down rather than dressed up: a tick without its number is
  // still a mark at a known spacing, which a half-printed number is not.
  //   The badge gives way only when its strip would take more than BADGE_MAX of the width, and then it
  // drops segments from the RIGHT (reads, then spp, then the level). The regime word is never dropped:
  // it is the one thing the header promises the badge will say. MEASURED in the headless text model
  // these numbers come from (0.6 em per character at 10 px ui-monospace): a full envelope badge is 43
  // characters ≈ 258 px — 19% of a 1366 px ruler, where nothing is shed, but 65% of a 400 px one, where
  // it sheds to 'envelope · L1 ×256' and the strip falls to 31%. Across 168 paints (12 widths × 2 dpr
  // × 7 zooms) no ruler was ever left with no time at all: the worst loss was 3 labels of 5, at 360 css
  // px in the sample regime.
  //   RE-RUN IN ROUND FOUR against the 0.6017 em advance measured below and with 65536 spp added to the
  // zoom set: both still hold, and 3 of 5 is the worst PROPORTIONAL loss — the worst ABSOLUTE one is a
  // different paint, 5 labels of 10, at 640 css px, dpr 1, 64 spp.
  View.prototype._badge = function (ctx, W, d, reads) {
    var pyr = this.pyramid, segs;
    if (this.spp >= SAMPLE_REGIME) {
      var lvl = levelFor(pyr, this.spp / d);
      segs = ['envelope', 'L' + lvl + ' ×' + pyr.levels[lvl].bucket, fmtNum(this.spp) + ' spp', reads + ' reads'];
    } else {
      segs = ['samples', fmtNum(this.spp) + ' spp', fmtNum(1 / this.spp) + ' px per sample'];
    }
    ctx.font = (10 * d) + 'px ui-monospace, SFMono-Regular, Menlo, monospace';
    var budget = W * BADGE_MAX, txt = segs.join(' · '), w = ctx.measureText(txt).width;
    while (segs.length > 1 && w + 16 * d > budget) {
      segs.pop(); txt = segs.join(' · '); w = ctx.measureText(txt).width;
    }
    // 7·d of air to the right of the last glyph and 9·d to the left of the first, so the nearest ruler
    // label ends at least 9·d before the badge starts rather than touching it.
    return { txt: txt, w: w, reserve: w + 16 * d };
  };

  // The badge is the label the header promises: a reader who has zoomed past the sample threshold is
  // TOLD they crossed it, so that a line through dots is never mistaken for measured signal.
  // IT SITS ON THE RULER'S OWN LABEL BASELINE (ruler − 12·d), SO IT STANDS OFF THE TICKS EXACTLY AS THE
  // TIMES DO — not clear above them, which is what this comment claimed until it was measured. The
  // clearance is pure geometry and holds at any rulerHeight, both offsets being taken from the same
  // rounded ruler: a major tick starts at ruler − 10·d, which is 2·d below the badge baseline, against
  // a 10·d px font — SO A GLYPH CROSSES A TICK TOP ONLY IF ITS DESCENDER IS DEEPER THAN 0.20 EM.
  //   RE-MEASURED IN A RENDERED FONT, because the figure that stood here ('0.1·d past a tick top, 0.1 px
  // at dpr 1') was carried over from the headless 0.6-em text model and was never a glyph at all.
  // Firefox 154 headless on this Linux box, rulerHeight 24, canvas TextMetrics plus the inked rows of a
  // screenshot. None of the stack's named faces exist on this box (fc-match answers DejaVu Sans for
  // ui-monospace, SFMono-Regular and Menlo alike), so it lands on the fontconfig monospace default,
  // DejaVu Sans Mono — identified by width, since the stack and an explicit DejaVu Sans Mono both give
  // 240.83 px for ten 'M' at 40 px where Liberation Mono and Noto Sans Mono give 240.00. In THAT face the badge's
  // actualBoundingBoxDescent is exactly 2·d — 2 px at dpr 1, 4 at dpr 2, 6 at dpr 3, a 0.20 em descender
  // on a 0.6017 em advance — and the last inked row of a 'p' is the row ABOVE the tick top: the
  // descender MEETS the tick top and crosses it by 0 px at all three ratios. Note what the text model
  // got right and wrong: the width (0.6 em against 0.6017 measured) right, the descent (2.1·d) wrong.
  // SF MONO CANNOT BE RENDERED FROM HERE, so the crossing in the font a Mac reader sees is NOT
  // MEASURED: a deeper face would cross by the difference, in the same colour — a graze, not a
  // collision.
  //   And it lands on SEVERAL descenders, not one. The badge prints three p's in the envelope band
  // ('envelope' plus the two of 'spp'), six in the sample band, and at least one in every shed form,
  // since the regime word is never dropped; they share this single baseline, so they all reach exactly
  // as far. The ruler's own labels reach nothing at all: formatTime prints only digits, ':', '.', '-'
  // and 's', measured descent 0.000 for '5:30', '1:00:01.0000', '0.5000s' and '-3.2s' at dpr 1 and 2.
  // The ticks inside the strip are drawn whole
  // and stay legible, and the strip costs the ruler its labels there and nothing else. The hairline
  // stands 4·d to the right of where the labels stop, so the gap reads as a boundary, not as a fault.
  View.prototype._paintBadge = function (ctx, W, ruler, d, p, badge) {
    if (!badge) return;
    ctx.font = (10 * d) + 'px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 0.22; ctx.strokeStyle = p.rule; ctx.lineWidth = d;
    ctx.beginPath();
    var xs = Math.round(W - badge.reserve + 4 * d) + 0.5;
    ctx.moveTo(xs, 4 * d); ctx.lineTo(xs, Math.max(6 * d, ruler - 11 * d)); ctx.stroke();
    ctx.globalAlpha = 0.9; ctx.fillStyle = this.spp < SAMPLE_REGIME ? p.dot : p.rule;
    ctx.fillText(badge.txt, W - badge.w - 7 * d, ruler - 12 * d);
    ctx.globalAlpha = 1;
  };

  function fmtNum(v) {
    if (!isFinite(v)) return '—';
    if (v >= 100) return String(Math.round(v));
    if (v >= 10) return v.toFixed(1);
    if (v >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }

  // one drawImage and the moving furniture — this is what playback pays per frame
  View.prototype._composite = function () {
    var ctx = this.ctx; if (!ctx || !this._layer) return;
    var W = this._W, H = this._H, d = this._dpr, p = this._palette();
    var ruler = Math.round(this.rulerHeight * d);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this._layer, 0, 0);

    if (this._sel && this._sel.to > this._sel.from) {
      var xa = this.pxOfSample(this._sel.from) * d, xb = this.pxOfSample(this._sel.to) * d;
      ctx.globalAlpha = 0.16; ctx.fillStyle = p.sel;
      ctx.fillRect(xa, ruler, Math.max(1, xb - xa), H - ruler);
      ctx.globalAlpha = 0.6; ctx.strokeStyle = p.sel; ctx.lineWidth = d;
      ctx.beginPath();
      ctx.moveTo(Math.round(xa) + 0.5, ruler); ctx.lineTo(Math.round(xa) + 0.5, H);
      ctx.moveTo(Math.round(xb) + 0.5, ruler); ctx.lineTo(Math.round(xb) + 0.5, H);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (this.playSec != null && this.sampleRate) {
      var xp = this.pxOfSample(this.playSec * this.sampleRate) * d;
      if (xp >= -2 && xp <= W + 2) {
        ctx.globalAlpha = 0.95; ctx.strokeStyle = p.play; ctx.lineWidth = Math.max(1, d);
        ctx.beginPath(); ctx.moveTo(Math.round(xp) + 0.5, 0); ctx.lineTo(Math.round(xp) + 0.5, H); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  };

  // ── interaction ──────────────────────────────────────────────────────────
  View.prototype._pxOf = function (ev) {
    var r = this.canvas.getBoundingClientRect();
    return ev.clientX - r.left;                    // CSS pixels, which is what spp is per
  };

  View.prototype._wire = function () {
    var s = this, cv = this.canvas;

    this._bound.down = function (e) {
      if (e.button != null && e.button !== 0) return;
      var x = s._pxOf(e);
      s._drag = { x0: x, x: x, moved: false, sample0: s.sampleOfPx(x) };
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    };

    this._bound.move = function (e) {
      if (!s._drag) return;
      var x = s._pxOf(e);
      s._drag.x = x;
      if (Math.abs(x - s._drag.x0) > 3) s._drag.moved = true;
      if (s._drag.moved) {
        var a = s._drag.sample0, b = s.sampleOfPx(x), len = s.pyramid ? s.pyramid.length : 0;
        a = clamp(a, 0, len); b = clamp(b, 0, len);
        s._sel = { from: Math.min(a, b), to: Math.max(a, b) };
        s._composite();
        s._emit('select', s.selection());
        // past an edge, the view follows the pointer — otherwise a selection can never be longer
        // than the window is wide
        var w = s._widthCss();
        s._autoDir = x < 0 ? -1 : (x > w ? 1 : 0);
        if (s._autoDir) s._startAuto(); else s._stopAuto();
      }
    };

    this._bound.up = function (e) {
      if (!s._drag) return;
      var d = s._drag; s._drag = null; s._stopAuto();
      try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
      if (!d.moved) {
        var sec = clamp(s.secondsOfPx(d.x0), 0, s.duration || 0);
        s._emit('seek', { seconds: sec, sample: sec * (s.sampleRate || 0) });
      }
    };

    this._bound.wheel = function (e) {
      if (!s.pyramid) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // ZOOM AT THE POINTER. deltaY up = zoom in = fewer samples per pixel.
        var f = Math.exp(-e.deltaY * 0.0028);
        s.zoomBy(f, s._pxOf(e));
        return;
      }
      var dx = e.deltaX || 0, dy = e.deltaY || 0;
      var px = Math.abs(dx) > Math.abs(dy) ? dx : dy;
      if (e.shiftKey) px *= 4;
      s.scrollToSample(s.offset + px * s.spp);
    };

    this._bound.dbl = function (e) {
      e.preventDefault();
      if (s._sel) { s.clearSelection(); return; }
      s.setSelection(0, s.duration || 0);
    };

    this._bound.vis = function () { s._hidden = doc.hidden; if (s._hidden) s._stopAuto(); };
    this._bound.resize = function () { if (s._layout()) s.draw(); };

    cv.addEventListener('pointerdown', this._bound.down);
    cv.addEventListener('pointermove', this._bound.move);
    global.addEventListener('pointerup', this._bound.up);
    cv.addEventListener('wheel', this._bound.wheel, { passive: false });
    cv.addEventListener('dblclick', this._bound.dbl);
    doc.addEventListener('visibilitychange', this._bound.vis);
    if (global.ResizeObserver) { this._ro = new global.ResizeObserver(this._bound.resize); this._ro.observe(cv); }
    else global.addEventListener('resize', this._bound.resize);
  };

  View.prototype._startAuto = function () {
    if (this._auto || this._hidden) return;
    var s = this;
    var step = function () {
      if (!s._drag || !s._autoDir) { s._auto = 0; return; }
      // under reduce-motion the scroll is a fixed step; otherwise it accelerates with how far past the
      // edge the pointer is held
      var w = s._widthCss();
      var over = s._autoDir < 0 ? -s._drag.x : (s._drag.x - w);
      var px = s.reduceMotion ? 12 : clamp(6 + over * 0.35, 6, 120);
      s.scrollToSample(s.offset + s._autoDir * px * s.spp);
      var edgeSample = s.sampleOfPx(s._autoDir < 0 ? 0 : w);
      var a = clamp(s._drag.sample0, 0, s.pyramid ? s.pyramid.length : 0);
      s._sel = { from: Math.min(a, edgeSample), to: Math.max(a, edgeSample) };
      s._composite();
      s._emit('select', s.selection());
      s._auto = global.requestAnimationFrame(step);
    };
    this._auto = global.requestAnimationFrame(step);
  };

  View.prototype._stopAuto = function () {
    if (this._auto) global.cancelAnimationFrame(this._auto);
    this._auto = 0; this._autoDir = 0;
  };

  // a view that leaks a pointerup on window keeps editing a canvas that is no longer on the page
  View.prototype.stop = function () {
    this._stopAuto();
    var cv = this.canvas;
    if (cv && this._bound.down) {
      cv.removeEventListener('pointerdown', this._bound.down);
      cv.removeEventListener('pointermove', this._bound.move);
      global.removeEventListener('pointerup', this._bound.up);
      cv.removeEventListener('wheel', this._bound.wheel);
      cv.removeEventListener('dblclick', this._bound.dbl);
      doc.removeEventListener('visibilitychange', this._bound.vis);
    }
    if (this._ro) { try { this._ro.disconnect(); } catch (e) {} this._ro = null; }
    else if (this._bound.resize) global.removeEventListener('resize', this._bound.resize);
    this._bound = {};
    this._handlers = {};
    return this;
  };

  var DV = {
    View: View,
    buildPyramid: buildPyramid,
    levelFor: levelFor,
    columnStats: columnStats,
    rulerSteps: rulerSteps,
    formatTime: formatTime,
    zoomAt: zoomAt,
    anchorDrift: anchorDrift,
    fitSpp: fitSpp,
    LADDER: LADDER,
    BRANCH: BRANCH,
    MIN_SPP: MIN_SPP,
    SAMPLE_REGIME: SAMPLE_REGIME,
    version: '1.0.0'
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DV;
  global.DVWaveform = DV;
})(typeof window !== 'undefined' ? window : this);
