/*!
 * DeltaVerse nGn — voice-scope (DVVoiceScope: the voice, measured, drawn as the ground it is read on).
 *
 * WHAT IT IS. A canvas-2d substrate that draws the voice ACTUALLY PLAYING on the page: the time-domain
 * waveform, the frequency spectrum, and the inflection — the rate of change of pitch, which is the
 * thing a reader hears as "delivery" and the thing no level meter shows. Behind that it runs the
 * scientific measurement (engine/ngn/oscilloscope.js, DVScope): eight acoustic metrics at 18 decimals
 * over the uint256 range, hashed to a VOICEPRINT. So the background of a page that reads itself aloud
 * is not decoration of the audio, it is a readout of it.
 *
 * THE THREE SUB-EXPRESSIONS (as catalogued in nGn/expressions/voice-scope.xml, from faicey):
 *   oscilloscope   time-domain waveform            magenta
 *   spectrum       frequency bars, log-spaced      green
 *   inflection     pitch-change ring buffer        cyan
 * All three are drawn from ONE analyser read per frame; the palette is taken from the live theme
 * (`--dv-accent`, `--dv-agent`, `--dv-cyan`) at draw time and falls back to faicey's own three.
 *
 * IT DOES NOT DRAW A VOICE THAT IS NOT THERE. This is the whole reason the module exists rather than
 * the synthetic sine that stood in for it. There are FOUR honest states and the field is in exactly
 * one of them:
 *
 *   LIVE      an analyser is attached and carries signal → every pixel is measured.
 *   RESTING   an analyser is attached and the audio is silent (paused, or between blocks) → a flat
 *             line with the faintest breath on it. Not a waveform. Silence looks like silence.
 *   UNTAPPED  no analyser at all (speechSynthesis exposes no audio graph — there is nothing to tap)
 *             → a slow, obviously-generated standing wave at low contrast, and `state()` says
 *             'untapped' so a caller can label it. A decorative oscilloscope presented as a
 *             measurement is the one thing this must never be.
 *
 *   UNKNOWN   an analyser is attached and the read THREW — a closed context, a node cut out of
 *             its graph. Reported as its own word because it is NOT 'resting': resting is a
 *             measurement of silence, and this is the absence of a measurement. state() used to
 *             reuse the last good level here and answer 'live' with 'every pixel is measured'
 *             hung on it, and that reached production before it was caught.
 * AS A BACKGROUND. `opts.background: true` paints nothing opaque — no fill, reduced alpha, the spectrum
 * dropped to the lower third — so body text stays readable over it. Without it the field owns the
 * canvas and fills its own ground (the carousel's use).
 *
 * THE VOICEPRINT IS THROTTLED. It is two SHA digests over a canonical JSON of the metrics; at 60fps
 * that is 120 digests a second for a number that changes meaninglessly fast. It is computed at most
 * `opts.printHz` times a second (default 2) and the last one is held. `on('print', fn)` delivers it.
 *
 * IT TRACKS THE ANALYSER'S SIZE. `fftSize` is writable and pages change it live (the playdocs Scope
 * menu does), so the buffers are checked against the analyser on every read rather than sized once at
 * attach time. A caller may set `analyser.fftSize` and do nothing else; it does not need to re-attach.
 * See _sizeTo for what went wrong before that was true — it was documented at length because it was a
 * corruption nothing could see.
 *
 * IT DOES NOT PAINT A SURFACE THAT IS NOT THERE EITHER. A canvas that measures zero — collapsed by a
 * layout, or display:none because the page's background toggle is off — stops the painting rather
 * than being handed a guessed size, and paints again when the surface comes back. See _resize for how
 * a canvas that measures zero is told apart from one that has not been measured yet (they need
 * opposite answers), and _watchBox for what carries the recovery: a ResizeObserver on the canvas,
 * because THE THING THAT HIDES THIS FIELD FIRES NO EVENT AT ALL. `#bg[hidden]{display:none}` changes
 * no window dimension, so 'resize' never comes; and under prefers-reduced-motion there is no frame
 * loop to notice either, which is how the previous version left the field permanently blank on that
 * one path. The observer sees the box go to zero and sees it come back, on BOTH motion paths.
 *
 * THE SAME DEFECT FAMILY LIVES IN engine/ngn/periphery-frame.js — the border substrate mounted beside
 * this one on the same page, hidden by the same kind of toggle (`#border[hidden]{display:none}`). The
 * two were fixed together, deliberately: this codebase has twice fixed one of a pair and left its twin
 * (voice-scope and DVScope.Live had the identical fftSize bug and only one was fixed until an audit
 * found the other). If you change the recovery here, change it there.
 *
 * Prototype lane (.js, zero-dep, UMD). DPR-aware, 30fps draw cap, pauses on visibilitychange, honours
 * prefers-reduced-motion (one static frame, no rAF). Listens for `dv:pace` (sweep speed) and
 * `dv:scope` (depth of field) and unwires both on stop().
 *
 *   var f = new DVVoiceScope.Field(canvas, { background: true }).start();
 *   f.attach(analyserNode);            // from listenState().analyser, or your own graph
 *   f.on('print', function (vp) { … }); // { hash, uint256, short, … }
 */
(function (global) {
  'use strict';

  var doc = global.document;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // theme first, faicey's own palette as the floor
  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(doc.documentElement).getPropertyValue(name);
      v = (v || '').trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function Field(canvas, opts) {
    opts = opts || {};
    this.canvas = typeof canvas === 'string' ? doc.querySelector(canvas) : canvas;
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.opts = opts;
    this.background = !!opts.background;
    this.printHz = opts.printHz == null ? 2 : +opts.printHz;
    this.reduceMotion = false;
    try { this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    this.analyser = null;
    // There is deliberately no DVScope.Live here. One was allocated and attached and never read —
    // a second measurement path that did not exist, in a module whose whole argument is that there
    // is exactly one. The Field already does the read itself: ONE analyser read per frame feeds the
    // three sub-expressions AND the metrics, so a Live alongside it would be a second reader of the
    // same node, with its own buffers and its own previous-frame snapshot, answering the same
    // question a frame out of step. DVScope is used here as the formulas, not as a second tool.
    this._time = null; this._freq = null;
    this._raf = 0; this._last = 0; this._hidden = false;
    this._blank = false;               // set by _resize when the canvas is laid out to zero
    this._recheck = 0;                 // last time _frame re-measured the canvas (see _resize)
    this._ro = null;                   // the ResizeObserver that carries blank/unblank (see _watchBox)
    this._poll = 0;                    // its interval fallback, reduced motion only (see _watchBox)
    this._mag = null; this._prevFreqSnap = null;
    this._pace = 1; this._depth = 0.5;
    this._lastPrint = 0; this._printing = false;
    this._readOk = true;            // no read has failed yet; see state()
    this.print = null;                 // the last voiceprint, held
    this.metrics = null;               // the last metric read, held
    this._infl = new Float32Array(180); // the inflection ring buffer
    this._ii = 0; this._prevDom = 0;
    this._level = 0; this._levelPeak = 0;
    this._handlers = {};
    this._bound = {};
    this._t0 = (global.performance && performance.now()) || Date.now();
  }

  // ── the seam ───────────────────────────────────────────────────────────
  // An AnalyserNode, or null. Passing null is not an error and not a failure: it is the UNTAPPED
  // state, which is what speechSynthesis genuinely gives you.
  // A DIFFERENT SOURCE IS A DISCONTINUITY EVEN WHEN THE SIZE IS IDENTICAL. _sizeTo drops the
  // previous-frame spectrum only when a BUFFER LENGTH changes, and two analysers at the same
  // fftSize change no length it can see — so swapping sources without this differenced the first
  // frame of the new voice against the last frame of the old one (a spectral flux, and an
  // inflection step, between two unrelated signals) and carried a decaying peak that belonged to
  // samples that no longer exist. The same rule is in DVScope.Live.attach; the two lanes are kept
  // in step deliberately.
  Field.prototype.attach = function (analyser) {
    analyser = analyser || null;
    // _level AND _readOk BELONG IN THIS RESET, AND _level WAS THE ONE LEFT OUT.
    // Every other piece of previous-frame state was dropped on a swap and _level was not — and
    // _level is the ONLY one state() reads. So a field swapped from a loud analyser to a silent
    // one went on reporting 'live' until the next successful read, which under prefers-reduced-
    // motion is never, because start() draws one frame and stops.
    if (analyser !== this.analyser) {
      this._prevFreqSnap = null; this._mag = null; this._prevDom = 0;
      this._levelPeak = 0; this._level = 0; this._readOk = true;
    }
    this.analyser = analyser;
    if (analyser) this._sizeTo(analyser);
    return this;
  };
  Field.prototype.detach = function () { return this.attach(null); };

  // AN ANALYSER CAN BE RESIZED UNDER US AND NOTHING WILL SAY SO. fftSize is a live, writable
  // property: the playdocs Scope menu sets `analyser.fftSize = 8192` on a node this field is
  // already attached to. The buffers used to be allocated once, in attach(), and never again —
  // so after that menu was touched every reading was wrong and the field went on drawing as if
  // it were not. getFloatFrequencyData writes only as far as the array it is handed, so at 2048
  // → 8192 the 1024-long _freq caught the bottom quarter of the spectrum and DVScope.metrics,
  // which derives Hz as (i * sr) / (2 * freq.length), reported every frequency at four times its
  // true value — dominant, centroid, rolloff and bandwidth all wrong, hashed into the VOICEPRINT
  // as if measured. At 2048 → 512 it was worse: the top three quarters of _freq were never
  // written again and were drawn and hashed as frozen values from before the change.
  //
  // That is the reason this is a paragraph and not a line: the failure was INVISIBLE. The trace
  // kept drawing, the hash kept hashing, no error was thrown and no state flag changed. So the
  // buffers are checked against the analyser on every read instead of trusted from attach time.
  Field.prototype._sizeTo = function (a) {
    var changed = false;
    if (!this._time || this._time.length !== a.fftSize) { this._time = new Float32Array(a.fftSize); changed = true; }
    if (!this._freq || this._freq.length !== a.frequencyBinCount) { this._freq = new Float32Array(a.frequencyBinCount); changed = true; }
    if (changed) {
      // Spectral flux is a bin-to-bin difference against the previous frame. Across a size change
      // bin 40 is no longer the same frequency it was, so the snapshot is not comparable to the
      // new one and is dropped rather than differenced — DVScope.spectralFlux returns 0 for a
      // missing previous frame, which is the honest answer for the first frame at a new size.
      this._prevFreqSnap = null;
      this._mag = null;
      // the decaying peak is an envelope over samples that no longer exist
      this._levelPeak = 0;
      // _prevDom is deliberately NOT reset: dominantFrequency is returned in Hz, which means the
      // same thing at either size, so the inflection line carries across the change unbroken.
    }
    return changed;
  };

  // FOUR STATES, BECAUSE A FAILED READ IS NOT SILENCE.
  //
  // This returned only untapped / live / resting, deciding between the last two on a _level that a
  // FAILED read leaves untouched. So an analyser that threw — a closed context, a node detached from
  // its graph — kept whatever level it last held, and the field reported 'live' with 'every pixel is
  // measured' hung on it while nothing was being measured at all. That is the page's cardinal sin
  // committed by its own instrument, and it reached production before it was caught.
  //
  // 'unknown' is the honest fourth answer: the analyser is there and it could not be read. It is NOT
  // 'resting' — resting is a measurement of silence, and this is the absence of a measurement. Every
  // consumer gets this for free rather than each re-deriving it, which is how the deck badge and the
  // rack lamp came to disagree about the same fact.
  Field.prototype.state = function () {
    if (!this.analyser) return 'untapped';
    if (!this._readOk) return 'unknown';
    return this._level > 0.0012 ? 'live' : 'resting';
  };

  Field.prototype.on = function (ev, fn) { (this._handlers[ev] || (this._handlers[ev] = [])).push(fn); return this; };
  Field.prototype._emit = function (ev, arg) {
    var hs = this._handlers[ev]; if (!hs) return;
    for (var i = 0; i < hs.length; i++) { try { hs[i](arg); } catch (e) {} }
  };

  // ── the read ───────────────────────────────────────────────────────────
  Field.prototype._read = function (now) {
    var a = this.analyser;
    if (!a) {
      // UNTAPPED: a standing wave that is plainly generated. Slow, low amplitude, and it does not
      // pretend to a spectrum — the bars stay at the floor.
      var n = 256, t = (now - this._t0) / 1000;
      if (!this._time || this._time.length !== n) this._time = new Float32Array(n);
      for (var k = 0; k < n; k++) {
        this._time[k] = 0.16 * Math.sin(k * 0.049 + t * 0.9) * Math.sin(t * 0.31) +
                        0.05 * Math.sin(k * 0.17 - t * 0.6);
      }
      if (!this._freq || this._freq.length !== 128) this._freq = new Float32Array(128);
      for (var b = 0; b < 128; b++) this._freq[b] = -110 + 12 * Math.exp(-b / 26) * (0.6 + 0.4 * Math.sin(t * 0.7 + b * 0.09));
      this._level = 0;
      return;
    }
    // every frame, before reading: the analyser is the authority on its own size, not attach()
    this._sizeTo(a);
    // A THROW HERE IS A STATE, NOT AN ACCIDENT TO SWALLOW — see state().
    try {
      a.getFloatTimeDomainData(this._time);
      a.getFloatFrequencyData(this._freq);
      this._readOk = true;
    } catch (e) {
      this._readOk = false;
      return;                       // leave _level alone; state() reports 'unknown' rather than guessing
    }
    var s = 0;
    for (var i = 0; i < this._time.length; i++) s += this._time[i] * this._time[i];
    this._level = Math.sqrt(s / this._time.length);
    this._levelPeak = Math.max(this._level, this._levelPeak * 0.94);
  };

  // the inflection line: d(dominant frequency)/dt, the thing that makes a reading sound delivered
  // rather than recited. Pushed into a ring buffer so the line is a HISTORY, not an instant.
  Field.prototype._pushInflection = function () {
    var sr = (this.analyser && this.analyser.context && this.analyser.context.sampleRate) || 44100;
    var dom = global.DVScope ? global.DVScope.dominantFrequency(this._freq, sr) : 0;
    var d = this._prevDom ? (dom - this._prevDom) / Math.max(1, this._prevDom) : 0;
    this._prevDom = dom;
    this._infl[this._ii] = clamp(d, -1, 1);
    this._ii = (this._ii + 1) % this._infl.length;
  };

  // the voiceprint, at most printHz times a second — see the header
  Field.prototype._measure = function (now) {
    if (!this.analyser || !global.DVScope || this._printing) return;
    if (this.printHz <= 0) return;
    if (now - this._lastPrint < 1000 / this.printHz) return;
    // A BUFFER THAT DOES NOT MATCH THE ANALYSER IS NOT A MEASUREMENT, SO IT IS NOT HASHED. This
    // path deliberately does not resize: _read owns the sizing and fills what it sizes, and a
    // buffer resized here would be all zeros — a voiceprint of silence, indistinguishable from a
    // real one. Skipping the print costs at most one frame at printHz; the next read is correct.
    if (!this._time || this._time.length !== this.analyser.fftSize) return;
    if (!this._freq || this._freq.length !== this.analyser.frequencyBinCount) return;
    this._lastPrint = now;
    var sr = (this.analyser.context && this.analyser.context.sampleRate) || 44100;
    var m;
    // The analyser hands back DECIBELS and the metric formulas want MAGNITUDES; without the
    // conversion five of the eight collapse to zero and the voiceprint hashes a set of constants.
    // See DVScope.linearFromDb for the measurement that caught it.
    this._mag = global.DVScope.linearFromDb(this._freq, this.analyser.minDecibels, this._mag);
    try { m = global.DVScope.metrics(this._time, this._mag, sr, this._prevFreqSnap); } catch (e) { return; }
    this._prevFreqSnap = this._mag.slice();
    this.metrics = m;
    var self = this;
    this._printing = true;
    global.DVScope.voiceprint(m).then(function (vp) {
      self._printing = false; self.print = vp; self._emit('print', vp); self._emit('metrics', m);
    }).catch(function () { self._printing = false; });
  };

  // ── paint ──────────────────────────────────────────────────────────────
  // A CANVAS THAT MEASURES ZERO IS NOT A CANVAS THAT HAS NOT BEEN MEASURED, AND THE TWO NEED
  // OPPOSITE ANSWERS. This read `this.canvas.clientHeight || global.innerHeight`, and the || idiom
  // cannot tell "no size yet" from "size is zero". Measured on playdocs while its narrow layout
  // collapsed #strip to CSS height 0: at a 480×900 viewport the field allocated a 462×900 backing
  // store and cleared and repainted all 415,800 pixels every frame for an element displaying
  // nothing, and the backing height tracked innerHeight exactly across widths (974×900 at 1000,
  // 934×900 at 960, 914×900 at 940) — full viewport fill rate on precisely the phone-width devices
  // least able to afford it, for no pixels a reader can see. That layout has since been given a
  // definite row height (see the media query at playdocs.html), but the SHAPE of the bug outlives
  // it: `#bg[hidden]{display:none}` is set by the page's own background toggle, so switching the
  // background off leaves a connected canvas measuring 0×0 that this used to keep painting.
  //
  // THE HONEST DISTINCTION IS CONNECTEDNESS, NOT SIZE. A canvas in the document is laid out by the
  // time clientWidth is read (reading it flushes layout), so a connected canvas reporting 0 is
  // telling the truth: it is display:none, or it is laid out to zero. Either way there is no
  // surface, so the field stops painting and drops the backing store to 1×1 instead of guessing.
  // A canvas that is NOT connected genuinely has no layout to read and will not have one until it
  // is inserted — that is the case the viewport fallback was written for, and it still gets it.
  //
  // offsetParent is the obvious displayed-or-not test and is the wrong one here: it is null for a
  // position:fixed element, which is exactly how this field mounts as a page background, so it
  // would have called a live background hidden.
  //
  // A DISPLAY TOGGLE FIRES NO RESIZE EVENT, WHICH IS WHY SOMETHING HAS TO LOOK. The first version of
  // this fix hung entirely off the 'resize' listener, and playdocs hides this very field with
  // `$('bg').hidden = !prefs.bg` — hiding an element changes no window dimension, so nothing fires
  // and nothing re-measures. Measured on the headless loop: 1000 ms of frames after the toggle still
  // ran 30 clears, 60 strokes and 13,020 line segments into a 462×220 backing store displaying
  // nothing, exactly the waste this was written to stop, arriving through the one door it did not
  // watch. Worse, it was a ONE-WAY DOOR: let a genuine window resize land while the canvas was
  // hidden and it blanked correctly, but turning the background back on then painted nothing ever
  // again, because the recovery waited on the same event that never comes.
  //
  // The second version re-measured from the frame loop at 4 Hz, which closed the door — on the
  // ANIMATED path only. Under prefers-reduced-motion start() draws one frame and returns, so there
  // is no loop to hang a timer on, and hide → resize → show left the field at 1×1 and blank for the
  // life of the page. That reached production. The recovery is now a ResizeObserver on the canvas
  // (see _watchBox), which is the only party that sees display:none and its undoing without being
  // told, costs nothing while nothing changes, and does not care whether a frame loop exists.
  // The 4 Hz re-measure stays in _frame as the fallback for a browser with no ResizeObserver.
  Field.prototype._resize = function () {
    var c = this.canvas; if (!c) return;
    var d = Math.min(global.devicePixelRatio || 1, 2);
    var connected = ('isConnected' in c) ? !!c.isConnected
      : !!(doc && doc.documentElement && doc.documentElement.contains(c));
    var w = c.clientWidth, h = c.clientHeight;
    if (!connected) { w = w || global.innerWidth || 1; h = h || global.innerHeight || 1; }
    this._blank = !(w > 0 && h > 0);
    this._dpr = d;
    if (this._blank) {
      // 1×1 is the smallest legal backing store: nothing is displayed, so nothing is allocated
      if (c.width !== 1) c.width = 1;
      if (c.height !== 1) c.height = 1;
      return;
    }
    // ASSIGNING canvas.width RESETS THE BITMAP EVEN WHEN THE VALUE IS UNCHANGED — it is a spec'd
    // reset of the drawing surface, not a setter that compares — and this now runs 4 times a second
    // from the frame loop rather than only on a resize event. Measured on the headless loop with
    // the size never changing: 14 backing-store reallocations in 2000 ms unguarded, 0 guarded. So
    // only a real change is written.
    var pw = Math.max(1, Math.round(w * d)), ph = Math.max(1, Math.round(h * d));
    if (c.width !== pw) c.width = pw;
    if (c.height !== ph) c.height = ph;
  };

  // THE FIELD CANNOT KNOW IT WAS HIDDEN UNLESS SOMETHING LOOKS, so this is the thing that looks. A
  // ResizeObserver reports the canvas's own box: `display:none` collapses it (the observation arrives
  // with a 0×0 contentRect) and showing it again reports the restored box, neither of which produces
  // a window 'resize' event. It fires only on a change, so an untouched page pays nothing, and it is
  // independent of the frame loop — which is the whole point, because prefers-reduced-motion has no
  // frame loop and that is the path the last fix could not reach.
  //
  // NO FEEDBACK LOOP HERE, and that is a property of the mount, not luck: #bg and #border are sized by
  // CSS (`position:fixed;inset:0;width:100%;height:100%`, playdocs.html:96), so writing canvas.width —
  // the backing store — changes no layout box and cannot re-trigger the observation. A canvas with NO
  // css size would take its layout box from that attribute and could ring; the same is already true of
  // the 4 Hz re-measure below, so this module has always assumed a css-sized canvas.
  //
  // Fallbacks, so the header's claim holds on every path: animated → the 4 Hz re-measure in _frame,
  // kept unconditional; reduced motion with no ResizeObserver → a 4 Hz interval, the only timer this
  // module ever starts, cleared in stop(). periphery-frame.js carries the identical pair.
  //
  // WHAT WAS MEASURED, AND WHERE. A headless stub with a toggleable canvas (clientWidth/clientHeight
  // -> 0 for the hide, no 'resize' dispatched) carried 31 checks across four scenarios x three
  // motion/observer settings, run against the round-three file and this one. Counting canvas-2d
  // operations on a stub context over 1000 ms of virtual frames: hidden under reduce=false, 180 ops
  // before (the 250 ms the 4 Hz timer takes to notice) -> 0 after; hidden -> window resize -> shown
  // under reduce=true, backing left at 1x1 with 0 ops before — the one-way door that reached
  // production — -> backing 1100x800 and painting after.
  //
  // THE ResizeObserver SEMANTICS WERE THEN MEASURED IN A REAL BROWSER, and an earlier draft of this
  // paragraph was wrong to say they were not. It asserted "no browser was available this round" and
  // hung the belt-and-braces decision below on that assertion. A browser WAS available — a Playwright
  // Chromium is cached on this machine and a sibling lane drove one in the same round — and in it the
  // observer fires on BOTH the hide and the show, exactly as the spec describes: a not-rendered
  // element's box is zero, and an observation is gathered whenever the box differs from the last
  // reported one.
  //
  // The 4 Hz belt below stays anyway, and now for a reason that is true rather than one that was
  // assumed: ResizeObserver is absent on old WebViews, not every engine that will run this page has
  // been measured, and this module has twice shipped a recovery that covered one path and was
  // reported as covering the defect.
  Field.prototype._watchBox = function () {
    var s = this, RO = global.ResizeObserver;
    if (!this.canvas) return;
    if (RO) {
      try {
        this._ro = new RO(function () { s._remeasure(); });
        this._ro.observe(this.canvas);
        return;
      } catch (e) { this._ro = null; }
    }
    if (this.reduceMotion) this._poll = global.setInterval(function () { s._remeasure(); }, 250);
  };

  // Re-measure, and repaint if the surface is back. Under reduced motion nothing else will ever
  // paint, so this repaints whenever there is a surface; under motion the loop's next frame (≤33 ms)
  // does it, so this only measures.
  Field.prototype._remeasure = function () {
    this._resize();
    if (this.reduceMotion && !this._blank) this._paint(0);
  };

  Field.prototype._paint = function (now) {
    var ctx = this.ctx; if (!ctx) return;
    // Nothing is displayed, so nothing is drawn — see _resize for how a measured zero is told from
    // an unmeasured one. Only the PAINTING stops: _read and the voiceprint carry on, because a
    // 'print' listener is measuring the voice, not watching the canvas.
    if (this._blank) return;
    var W = this.canvas.width, H = this.canvas.height, d = this._dpr || 1;
    var bg = this.background;
    var cOsc = cssVar('--dv-accent', '#ff0080');
    var cSpec = cssVar('--dv-agent', '#00ff80');
    var cInfl = cssVar('--dv-cyan', '#00ffff');
    var st = this.state();
    // UNTAPPED is drawn quieter than RESTING is drawn quieter than LIVE. The contrast IS the label.
    var conf = st === 'live' ? 1 : st === 'resting' ? 0.5 : 0.28;
    // BACKGROUND MEANS BEHIND. The first version used the carousel's amplitudes with only the
    // alpha reduced, and a live voice put full-height spectrum bars directly under a paragraph —
    // measured, correct, and unreadable. A substrate that costs you the document is not a
    // background, so background mode is quieter in THREE ways rather than one: less alpha, a
    // shorter throw for the waveform, and a spectrum that stays down at the floor.
    var amp = bg ? 0.105 : 0.30;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (bg) ctx.clearRect(0, 0, W, H);
    else { ctx.fillStyle = cssVar('--dv-bg', '#05060b'); ctx.fillRect(0, 0, W, H); }

    // depth of field (dv:scope) pushes the whole drawing back
    var alpha = (bg ? 0.20 : 1) * conf * (0.55 + 0.45 * this._depth);

    // ── spectrum, along the floor ────────────────────────────────────────
    // Log-spaced buckets: linear bins put three quarters of the width on frequencies a voice never
    // reaches, so the bars looked dead on the right and crowded on the left. A voice lives in
    // 80–4000 Hz and this gives that range the room.
    var bins = this._freq ? this._freq.length : 0;
    if (bins) {
      var n = 56, base = H * (bg ? 0.995 : 0.94), maxH = H * (bg ? 0.115 : 0.34);
      ctx.globalAlpha = alpha * (bg ? 0.5 : 0.8);
      ctx.fillStyle = cSpec;
      for (var b = 0; b < n; b++) {
        var lo = Math.floor(Math.pow(bins, b / n)), hi = Math.max(lo + 1, Math.floor(Math.pow(bins, (b + 1) / n)));
        var mx = -Infinity;
        for (var q = lo; q < hi && q < bins; q++) if (this._freq[q] > mx) mx = this._freq[q];
        var mag = clamp((mx + 100) / 70, 0, 1);          // dB → 0..1 over a -100..-30 window
        var bh = mag * maxH;
        if (bh < 0.6) continue;
        var bw = W / n;
        ctx.globalAlpha = alpha * (bg ? 0.5 : 1) * (0.22 + 0.78 * mag);
        ctx.fillRect(b * bw + bw * 0.16, base - bh, bw * 0.68, bh);
      }
    }

    // ── the waveform, across the middle ──────────────────────────────────
    var mid = H * (bg ? 0.5 : 0.34);
    var t = this._time;
    if (t && t.length) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = cOsc;
      ctx.lineWidth = Math.max(1, (bg ? 1.4 : 2.2) * d);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      var step = Math.max(1, Math.floor(t.length / Math.min(1400, W)));
      var j = 0;
      for (var i2 = 0; i2 < t.length; i2 += step, j++) {
        var px = (i2 / (t.length - 1)) * W;
        var py = mid - t[i2] * H * amp;
        if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      // a live voice gets a bloom; a resting one does not, because a glow is a claim about energy
      if (st === 'live' && !this.reduceMotion) {
        ctx.globalAlpha = alpha * (bg ? 0.16 : 0.30) * clamp(this._levelPeak * 7, 0, 1);
        ctx.lineWidth = Math.max(2, 6 * d);
        ctx.stroke();
      }
    }

    // ── the inflection line ──────────────────────────────────────────────
    var L = this._infl.length;
    ctx.globalAlpha = alpha * 0.72;
    ctx.strokeStyle = cInfl;
    ctx.lineWidth = Math.max(1, 1.2 * d);
    ctx.beginPath();
    var iy = H * (bg ? 0.845 : 0.66);
    for (var k2 = 0; k2 < L; k2++) {
      var v = this._infl[(this._ii + k2) % L];
      var x2 = (k2 / (L - 1)) * W;
      var y2 = iy - v * H * (bg ? 0.065 : 0.16);
      if (k2 === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  // ── loop ───────────────────────────────────────────────────────────────
  Field.prototype._frame = function (now) {
    var s = this;
    this._raf = global.requestAnimationFrame(function (n) { s._frame(n); });
    if (this._hidden) return;
    var cap = 1000 / (30 * clamp(this._pace, 0.25, 3));
    if (this._last && now - this._last < cap) return;
    this._last = now;
    // The 4 Hz re-measure stays, and stays UNCONDITIONAL. The observer in _watchBox is the mechanism
    // that reaches the reduced-motion path; this is the belt on the path that already had one. It is
    // the cheaper of the two claims to be wrong about — one clientWidth read every 7.5 frames at the
    // 30fps cap against the possibility that some engine reports a box change differently — and this
    // module has now twice shipped a recovery that covered one path and was reported as covering the
    // defect. See _resize for the measurement.
    if (now - this._recheck >= 250) { this._recheck = now; this._resize(); }
    this._read(now);
    this._pushInflection();
    this._measure(now);
    this._paint(now);
  };

  Field.prototype.start = function () {
    if (!this.ctx) return this;
    var s = this;
    this._resize();
    // RESIZING A CANVAS CLEARS IT, so under prefers-reduced-motion the resize handler must redraw
    // the one static frame or the field is left permanently blank by its own resize — measured:
    // 0 paint operations after a 462×220 → 900×400 resize event, on a field whose whole output is
    // that single frame. The animated path needs nothing here; its next frame repaints anyway.
    this._bound.resize = function () { s._resize(); if (s.reduceMotion) s._paint(0); };
    this._bound.vis = function () { s._hidden = doc.hidden; };
    this._bound.pace = function (e) { s._pace = (e.detail && +e.detail.value) || 1; };
    this._bound.scope = function (e) { s._depth = clamp((e.detail && +e.detail.value), 0, 1) || 0.5; };
    global.addEventListener('resize', this._bound.resize);
    doc.addEventListener('visibilitychange', this._bound.vis);
    doc.addEventListener('dv:pace', this._bound.pace);
    doc.addEventListener('dv:scope', this._bound.scope);
    // the box watch is wired on BOTH paths — a hidden field is a hidden field whether or not it moves
    this._watchBox();
    if (this.reduceMotion) {
      // one true frame, then nothing moves. Still measured, still honest about its state.
      this._read((global.performance && performance.now()) || Date.now());
      this._pushInflection();
      this._paint(0);
      return this;
    }
    this._raf = global.requestAnimationFrame(function (n) { s._frame(n); });
    return this;
  };

  Field.prototype.stop = function () {
    if (this._raf) global.cancelAnimationFrame(this._raf);
    this._raf = 0;
    // an observer and an interval leak exactly the way a listener does — a stopped field that keeps
    // re-measuring and repainting a canvas the page has moved on from is a stopped field that is
    // still running. Both are dropped here, and _watchBox starts at most one of them.
    if (this._ro) { try { this._ro.disconnect(); } catch (e) {} this._ro = null; }
    if (this._poll) { global.clearInterval(this._poll); this._poll = 0; }
    // a substrate that leaks a document listener keeps answering after it is swapped out
    if (this._bound.resize) global.removeEventListener('resize', this._bound.resize);
    if (this._bound.vis) doc.removeEventListener('visibilitychange', this._bound.vis);
    if (this._bound.pace) doc.removeEventListener('dv:pace', this._bound.pace);
    if (this._bound.scope) doc.removeEventListener('dv:scope', this._bound.scope);
    this._bound = {};
    return this;
  };

  var DV = { Field: Field, version: '1.0.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = DV;
  global.DVVoiceScope = DV;
})(typeof window !== 'undefined' ? window : this);
