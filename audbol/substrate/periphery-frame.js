/*!
 * DeltaVerse nGn — periphery frame (DVPeriphery: the border zone, and the return to the centre).
 *
 * THE TRANSITION BETWEEN FRAMES. A substrate does not cut to the next one. The motion pixels that live
 * on the four-sided periphery LEAVE it and return to the centre; at the instant the centre is full the
 * frame says so (`dv:center`) — that is when the page swaps what is playing — and the pixels then issue
 * back out to the periphery around the new substrate. Out → in → swap → in → out. The frame is the
 * transition, and nothing else has to know how it works.
 *
 * THE GEOMETRY, in x · y · z (frame units: x,y ∈ −1..1 with y down; z ∈ 0..1):
 *
 *      z = 1        the OUTER rule — the viewport inset by the border pad, nearest the viewer
 *      z = 1/√2     the INNER rule — the plane the four EDGE stations stand on
 *      z = 0        the ORIGIN — the centre station, the reference every pixel returns to
 *
 *   The volume between the rules is the BORDER ZONE, joined by eight spokes, one per station. There are
 *   NINE stations: eight around the ring in frame-border order (top-left → clockwise → left, the same
 *   ring DVEmergentMenu docks to) and the centre, index 8, carried for reference. A station's depth is
 *   derived from its place, never dialled: z = |(x, y)| / √2 — a corner (±1, ±1) lands at z = 1, an edge
 *   mid (0, ±1) at z = 0.7071. The frame is therefore a frustum whose apex is the centre.
 *
 *   Projection is a real perspective divide, k(z) = C / (C − z), normalised so k(1) = 1: the outer rule
 *   sits exactly on the inset, and a pixel travelling z: 1 → 0 RECEDES while it converges. The WebGL
 *   renderer (periphery-frame.wjs, the `.wjs` lane) computes the identical k(z) in its vertex shader, so
 *   the GL path and the canvas-2d fallback agree. `--dv-x / --dv-y / --dv-z` are published per station
 *   (pages/periphery.css) so DOM furniture — the eight menus — stands in the same xyz frame.
 *
 * SPRINGS ARE DERIVED, NOT DIALLED. For v ← D(v + K(t − x)); x ← x + v the error map has trace 1+D−DK
 * and determinant D, so critical damping is exactly (1 + D − D·K)² = 4D, i.e. K = (1 + D − 2√D) / D.
 * With D = 1/φ that is K = 0.0740: the return to the centre never overshoots the origin — an overshoot
 * would read as a bounce, and the centre is a reference, not a trampoline.
 *
 * LIGHT IS CONSERVED. centre + periphery = 1. As the pixels drain inward the rules dim by exactly what
 * the centre gains, so the frame visibly hands its light over rather than cross-fading.
 *
 * Light  : pixel brightness = charge × depth; a dock's charge is its menu's openness (`dv:dock`).
 * Action : dv:transit → converge · dv:center (emitted) → the swap · dv:pace → ring drift · dv:scope →
 *          camera distance (the frame's own depth of field) · senses: level → shimmer, peak → outward
 *          pulse, face proximity → C (leaning in deepens the frustum).
 *
 * IT DOES NOT PAINT A FRAME THAT IS NOT THERE. This is a full-viewport border: at 1366×768 and dpr 2 it
 * clears and redraws 4.2 million backing-store pixels, 220 motion pixels and nine stations, every frame.
 * The page hides it with `$('border').hidden = !prefs.border` against `#border[hidden]{display:none}`
 * (playdocs.html:99, 721) — which fires NO event — and this went on paying all of that for a surface
 * nobody could see. A canvas that measures zero now stops the PAINTING (only the painting: _step keeps
 * running, so dv:center still fires and a transition started while hidden still completes rather than
 * stranding the page mid-swap), and paints again when the surface returns. See _resize for how a
 * measured zero is told from an unmeasured one, and _watchBox for the ResizeObserver that carries the
 * recovery — a 'resize' listener cannot, because hiding an element fires none, and under
 * prefers-reduced-motion there is no frame loop to notice either.
 *
 * THE SAME DEFECT FAMILY LIVES IN engine/ngn/voice-scope.js — the background substrate mounted beside
 * this one on the same page, hidden by the same kind of toggle (`#bg[hidden]{display:none}`). The two
 * were fixed together, deliberately: this codebase has twice fixed one of a pair and left its twin
 * (voice-scope and DVScope.Live had the identical fftSize bug and only one was fixed until an audit
 * found the other). If you change the recovery here, change it there.
 *
 * Prototype lane (.js, zero-dep, UMD). DPR-aware, 30fps cap, pauses hidden, honours prefers-reduced-motion
 * (static frame; transit still fires dv:center on the next frame so the sequence never stalls).
 *
 *   var f = new DVPeriphery.Field('#periphery', { motes: 320 }).start();
 *   f.transit({ label: 'Curl Flow', glyph: '◈' });     // converge → dv:center → emit
 *   f.charge('bottom-left', 0.8); f.stations(); f.phase();
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var PHI = 1.6180339887498949;
  var SQRT2 = 1.4142135623730951;
  var RING = ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left'];

  // critical damping, derived: (1 + D − D·K)² = 4D  →  K = (1 + D − 2√D) / D
  var SPRING_D = 1 / PHI;
  var SPRING_K = (1 + SPRING_D - 2 * Math.sqrt(SPRING_D)) / SPRING_D;   // 0.07400…

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // the square perimeter as one parameter s ∈ [0,1): 0 = top-left corner, running clockwise
  function ring(s) {
    var p = ((s % 1) + 1) % 1 * 4;
    if (p < 1) return { x: -1 + 2 * p, y: -1 };
    if (p < 2) return { x: 1, y: -1 + 2 * (p - 1) };
    if (p < 3) return { x: 1 - 2 * (p - 2), y: 1 };
    return { x: -1, y: 1 - 2 * (p - 3) };
  }
  function depthOf(x, y) { return Math.sqrt(x * x + y * y) / SQRT2; }   // z is derived from the place

  // the nine stations: eight in frame-border order, then the centre (index 8) for reference
  var STATIONS = (function () {
    var out = RING.map(function (id, i) {
      var s = i / 8, p = ring(s);
      return { id: id, i: i, s: s, x: p.x, y: p.y, z: depthOf(p.x, p.y),
               kind: (i % 2 === 0) ? 'corner' : 'edge' };
    });
    out.push({ id: 'center', i: 8, s: null, x: 0, y: 0, z: 0, kind: 'origin' });
    return out;
  })();

  function hexToRgb(h) {
    h = String(h || '').trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) return [1, 1, 1];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function Field(canvas, opts) {
    opts = opts || {};
    this.opts = opts;
    this.canvas = typeof canvas === 'string' ? doc.querySelector(canvas) : canvas;
    this.reduceMotion = false;
    try { this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    this.pad = opts.pad != null ? opts.pad : 26;          // the border pad, in css px
    this.cam = opts.cam != null ? opts.cam : 3.2;         // camera distance C, in frame units
    this._camTarget = this.cam;
    this.pace = 1;
    this.wantMotes = Math.max(24, opts.motes || 320);
    this.motes = [];
    this.charges = {};                                     // station id → 0..1 (menu openness)
    RING.forEach(function (a) { this.charges[a] = 0; }, this);
    this.charges.center = 0;

    this.phaseName = 'settled';
    this.centerLight = 0;
    this._announce = null;
    this._transit = null;
    this._raf = 0; this._last = 0; this._hidden = false;
    this._blank = false;                                   // set by _resize when the canvas measures 0
    this._recheck = 0;                                     // no-ResizeObserver fallback (see _watchBox)
    this._ro = null; this._poll = 0;
    this._ema = 16.7;                                      // frame-time EMA — pay for the pixels honestly
    this._cap = this.wantMotes;
    this._sprites = {};
    this._bound = {};
    this._senses = null;
    this._pulse = 0;
    this._shimmer = 0;
    this._t = 0;

    this.gl = null;
    this._buf = null; this._lbuf = null;
  }

  Field.prototype.stationList = function () { return STATIONS; };

  // ── layout ─────────────────────────────────────────────────────────────
  // A CANVAS THAT MEASURES ZERO IS NOT A CANVAS THAT HAS NOT BEEN MEASURED, AND THE TWO NEED OPPOSITE
  // ANSWERS. This read `clientWidth || innerWidth`, and the || idiom cannot tell "no size yet" from
  // "size is zero" — so with `#border[hidden]{display:none}` set by the page's own border toggle, a
  // connected canvas measuring 0×0 was handed the whole viewport and kept a full-viewport backing
  // store, redrawn every frame, for something displaying nothing.
  //
  // THE HONEST DISTINCTION IS CONNECTEDNESS, NOT SIZE — the same test voice-scope.js makes, for the
  // same reason. A connected canvas is laid out by the time clientWidth is read (reading it flushes
  // layout), so a connected canvas reporting 0 is telling the truth: display:none, or collapsed to
  // zero. A canvas NOT in the document has no layout to report and will not have one until it is
  // inserted — that is the case the viewport fallback exists for, and it still gets it. offsetParent
  // is the obvious displayed-or-not test and is the wrong one: it is null for position:fixed, which
  // is exactly how this frame mounts.
  //
  // WHEN BLANK IT RETURNS BEFORE TOUCHING THE GEOMETRY, and that is deliberate. cssW/halfW feed
  // project(), stations() and the published --dv-x/--dv-y/--dv-z that DOM furniture stands on; a
  // hidden frame recomputing them from 0 would clamp halfW to its 8 px floor and drag the eight
  // menus into a knot at the centre of a page whose layout has not changed. So the last good frame
  // is kept and nothing is republished until there is a real measurement again.
  Field.prototype._resize = function () {
    var c = this.canvas; if (!c) return;
    var d = Math.min(global.devicePixelRatio || 1, 2);
    var connected = ('isConnected' in c) ? !!c.isConnected
      : !!(doc && doc.documentElement && doc.documentElement.contains(c));
    var W = c.clientWidth, H = c.clientHeight;
    if (!connected) { W = W || global.innerWidth || 1; H = H || global.innerHeight || 1; }
    this._blank = !(W > 0 && H > 0);
    this.dpr = d;

    if (this._blank) {
      // never measured AND blank: project() must still answer a number rather than NaN, so the
      // viewport is used as a nominal frame — but it is not published, because it is a guess.
      if (this.cssW == null) {
        this.cssW = global.innerWidth || 1; this.cssH = global.innerHeight || 1;
        this.halfW = Math.max(8, this.cssW / 2 - this.pad);
        this.halfH = Math.max(8, this.cssH / 2 - this.pad);
      }
      // 1×1 is the smallest legal backing store: nothing is displayed, so nothing is allocated
      if (c.width !== 1 || c.height !== 1) {
        if (this.gl) this.gl.resize(1, 1); else { c.width = 1; c.height = 1; }
      }
      // THE GL LANE'S CENTRE OVERLAY IS A SEPARATE FIXED CANVAS APPENDED TO THE BODY, so hiding
      // #border does not hide it: left alone it would keep the last centre crosshair and label
      // painted over a page that has switched the frame off. Shrinking it is what clears it.
      if (this._ov && (this._ov.width !== 1 || this._ov.height !== 1)) { this._ov.width = 1; this._ov.height = 1; }
      return;
    }

    this.cssW = W; this.cssH = H;
    this.halfW = Math.max(8, W / 2 - this.pad);
    this.halfH = Math.max(8, H / 2 - this.pad);
    var pw = Math.round(W * d), ph = Math.round(H * d);
    // ASSIGNING canvas.width RESETS THE BITMAP EVEN WHEN THE VALUE IS UNCHANGED — a spec'd reset of
    // the drawing surface, not a setter that compares — and this now runs from a box observation as
    // well as from a resize event, so only a real change is written.
    if (this.gl) this.gl.resize(pw, ph);
    else if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    if (this._ov && (this._ov.width !== pw || this._ov.height !== ph)) { this._ov.width = pw; this._ov.height = ph; }
    this._publishVars();
  };

  // THE FRAME CANNOT KNOW IT WAS HIDDEN UNLESS SOMETHING LOOKS. A ResizeObserver reports the canvas's
  // own box: display:none collapses it (the observation arrives with a 0×0 contentRect) and showing it
  // again reports the restored box — neither of which produces a window 'resize' event, and neither of
  // which needs a frame loop, which is what makes it work under prefers-reduced-motion where there is
  // no loop at all. It fires only on a change, so an untouched page pays nothing.
  //
  // No feedback loop: #border is sized by css (`position:fixed;inset:0;width:100%;height:100%`,
  // playdocs.html:96), so writing the backing store changes no layout box.
  //
  // Fallbacks: animated → the 4 Hz re-measure in _frame, kept unconditional; reduced motion with no
  // ResizeObserver → a 4 Hz interval. Both cleared in stop(). voice-scope.js carries the identical
  // pair — the two are one defect family and were fixed in one pass.
  //
  // WHAT WAS MEASURED, AND WHERE. No browser was available this round: a headless stub with a
  // toggleable canvas (clientWidth/clientHeight → 0 for the hide, no 'resize' dispatched), 31 checks
  // across four scenarios × three motion/observer settings, run against the round-three file and this
  // one. Counting canvas-2d operations on a stub context at 60 motes: hidden under reduce=false, 2370
  // ops over 1000 ms of virtual frames into a 1366×768 backing store before → 0 ops and a 1×1 store
  // after; hidden → window resize → shown under reduce=true, 0 ops before (dead, the same one-way door
  // as #bg) → 79 ops and a 1100×800 store after; and a transit begun while hidden still fires dv:center
  // once and returns to 'settled'. The ResizeObserver semantics above are read from the spec (a
  // not-rendered element's box is zero, and an observation is gathered whenever the box differs from
  // the last reported one, so BOTH the hide and the show are reported), NOT measured in Chrome — which
  // is why the 4 Hz belt in _frame stays unconditional.
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

  // Re-measure, and repaint if the surface is back. Under reduced motion nothing else will ever paint,
  // so this repaints whenever there is a surface; under motion the loop's next frame does it.
  Field.prototype._remeasure = function () {
    this._resize();
    if (this.reduceMotion && !this._blank) { if (this.gl) this._drawGL(); else this._draw2d(); }
  };

  // depth factor d(z) = k(z)/k(1) — 1 at the outer rule, (C−1)/C at the origin plane
  Field.prototype.depthFactor = function (z) {
    var C = this.cam;
    return (C / (C - z)) / (C / (C - 1));
  };
  Field.prototype.project = function (x, y, z) {
    var d = this.depthFactor(z);
    return { x: this.cssW / 2 + x * this.halfW * d, y: this.cssH / 2 + y * this.halfH * d, d: d };
  };

  // publish every station as --dv-x/--dv-y/--dv-z (css px, and z as its depth factor) so DOM
  // furniture can stand in the same xyz frame — see pages/periphery.css
  Field.prototype._publishVars = function () {
    if (!doc || !doc.documentElement) return;
    var root = doc.documentElement.style;
    for (var i = 0; i < STATIONS.length; i++) {
      var s = STATIONS[i], p = this.project(s.x, s.y, s.z);
      root.setProperty('--dv-x-' + s.id, p.x.toFixed(1) + 'px');
      root.setProperty('--dv-y-' + s.id, p.y.toFixed(1) + 'px');
      root.setProperty('--dv-z-' + s.id, s.z.toFixed(4));
      root.setProperty('--dv-d-' + s.id, p.d.toFixed(4));
    }
    root.setProperty('--dv-frame-pad', this.pad + 'px');
    root.setProperty('--dv-frame-cam', String(this.cam));
  };

  // ── the motion pixels ──────────────────────────────────────────────────
  Field.prototype._seed = function () {
    var n = this._cap, m = this.motes;
    while (m.length > n) m.pop();
    while (m.length < n) {
      var s = m.length / n;                                 // evenly around the ring, not randomly
      var p = ring(s);
      m.push({ s: s, x: p.x, y: p.y, z: depthOf(p.x, p.y),
               hx: p.x, hy: p.y, hz: depthOf(p.x, p.y),     // home, on the perimeter
               vx: 0, vy: 0, vz: 0, ch: 0.25 + 0.5 * (1 - Math.abs(2 * s - 1)),
               jit: (s * 9973 % 1), r0: 1 });
    }
  };

  Field.prototype._nearestStation = function (s) {
    var best = 0, bd = 9;
    for (var i = 0; i < 8; i++) {
      var d = Math.abs(((s - STATIONS[i].s + 1.5) % 1) - 0.5);
      if (d < bd) { bd = d; best = i; }
    }
    return { i: best, d: bd };
  };

  // ── phases ─────────────────────────────────────────────────────────────
  Field.prototype.phase = function () { return this.phaseName; };

  Field.prototype.transit = function (o) {
    o = o || {};
    if (this.phaseName !== 'settled' && this._transit) return this;     // one transition at a time
    this._announce = o.label ? { label: o.label, glyph: o.glyph || '◈', at: 0 } : null;
    var ms = o.ms || this.opts.transitMs || 900;
    this._transit = {
      ms: ms,
      sweep: ms / PHI,                                    // the drain runs round the ring as a wave
      hold: Math.round(ms / (PHI * PHI * PHI)),           // the beat the centre holds before it issues
      t: 0, fired: false, onCenter: o.onCenter || null, detail: o.detail || null
    };
    this._setPhase('converging');
    if (this.reduceMotion) { this._fireCenter(); this._setPhase('settled'); this._transit = null; }
    return this;
  };
  Field.prototype.converge = function (o) { return this.transit(o); };
  Field.prototype.emit = function () {
    if (this.phaseName !== 'held') return this;
    if (this._transit) this._transit.emitAt = this._transit.t;
    this._setPhase('emitting');
    return this;
  };

  Field.prototype._setPhase = function (p) {
    if (this.phaseName === p) return;
    this.phaseName = p;
    try { doc.dispatchEvent(new CustomEvent('dv:periphery', { detail: { phase: p } })); } catch (e) {}
  };

  Field.prototype._fireCenter = function () {
    var t = this._transit;
    if (t) { if (t.fired) return; t.fired = true; }
    var d = { at: this._t, detail: t && t.detail };
    if (t && t.onCenter) { try { t.onCenter(d); } catch (e) {} }
    try { doc.dispatchEvent(new CustomEvent('dv:center', { detail: d })); } catch (e) {}
  };

  Field.prototype.charge = function (id, v) {
    if (this.charges[id] == null) return this;
    this.charges[id] = clamp(+v || 0, 0, 1);
    return this;
  };

  Field.prototype.announce = function (label, glyph) {
    this._announce = label ? { label: label, glyph: glyph || '◈', at: this._t } : null;
    return this;
  };

  Field.prototype.attachSenses = function (senses) {
    if (!senses) return this;
    this._senses = senses;
    var self = this;
    this._bound.peak = function () { self._pulse = 1; };
    try { senses.on('peak', this._bound.peak); } catch (e) {}
    return this;
  };

  // ── integration ────────────────────────────────────────────────────────
  Field.prototype._step = function (dtms) {
    var i, m, tx, ty, tz, rel, k = SPRING_K, D = SPRING_D;
    var steps = clamp(Math.round(dtms / 33.333), 1, 4);
    var T = this._transit;
    var sense = this._senses && this._senses.state;
    var level = sense ? (sense.audio.level || 0) : 0;
    this._shimmer += ((level) - this._shimmer) * 0.12;
    this._pulse *= 0.90;

    if (sense && sense.face && sense.face.present) {
      // leaning in deepens the frustum: proximity 0..1 → C 3.6 … 2.4 (nearer camera = more perspective)
      this._camTarget = 3.6 - 1.2 * clamp(sense.face.proximity, 0, 1);
    }
    this.cam += (this._camTarget - this.cam) * 0.06;

    if (T) {
      T.t += dtms;
      if (this.phaseName === 'held' && T.t - T.heldAt >= T.hold) { T.emitAt = T.t; this._setPhase('emitting'); }
    }

    for (i = 0; i < this.motes.length; i++) {
      m = this.motes[i];

      if (this.phaseName === 'converging') {
        rel = m.s * (T ? T.sweep : 0);                    // staggered by place: the drain is a sweep
        if (T.t < rel) { tx = m.x; ty = m.y; tz = m.z; }
        else { tx = 0; ty = 0; tz = 0; }
      } else if (this.phaseName === 'held') {
        tx = 0; ty = 0; tz = 0;
      } else if (this.phaseName === 'emitting') {
        rel = (1 - m.s) * (T ? T.sweep : 0);              // it issues back the other way round
        if (T && T.emitAt != null && T.t - T.emitAt < rel) { tx = 0; ty = 0; tz = 0; }
        else { tx = m.hx; ty = m.hy; tz = m.hz; }
      } else {
        // settled: drift the ring, pooling at whichever dock its menu has opened
        var near = this._nearestStation(m.s);
        var c = this.charges[STATIONS[near.i].id] || 0;
        m.s = (m.s + (0.0000090 * this.pace * dtms) * (1 - 0.85 * c) + 1) % 1;
        if (c > 0.01) {
          var ds = ((STATIONS[near.i].s - m.s + 1.5) % 1) - 0.5;
          m.s = (m.s + ds * c * 0.035 + 1) % 1;
        }
        var p = ring(m.s);
        var out = 1 + this._pulse * 0.10 + this._shimmer * 0.03 * Math.sin(this._t * 0.004 + m.jit * 6.283);
        m.hx = p.x * out; m.hy = p.y * out; m.hz = depthOf(p.x, p.y);
        tx = m.hx; ty = m.hy; tz = m.hz;
      }

      for (var q = 0; q < steps; q++) {
        m.vx = D * (m.vx + k * (tx - m.x)); m.x += m.vx;
        m.vy = D * (m.vy + k * (ty - m.y)); m.y += m.vy;
        m.vz = D * (m.vz + k * (tz - m.z)); m.z += m.vz;
      }
      m.ch = clamp(0.22 + 0.55 * (1 - m.z) + 0.5 * this._shimmer + 0.4 * this._pulse, 0, 1);
    }

    // Light is conserved: what the centre gains, the rules give up. A pixel's contribution is measured
    // against ITS OWN home radius, not against the frame diagonal — so the centre reads 1 only when the
    // pixels are actually at the origin, and 0 when they are all home. Measuring against a fixed
    // diagonal leaves a floor of ~0.19 at rest and the frame never settles.
    var lit = 0;
    for (i = 0; i < this.motes.length; i++) {
      m = this.motes[i];
      var r = Math.sqrt(m.x * m.x + m.y * m.y + m.z * m.z);
      var rh = Math.sqrt(m.hx * m.hx + m.hy * m.hy + m.hz * m.hz);
      lit += rh > 1e-6 ? clamp(1 - r / rh, 0, 1) : 1;
    }
    this.centerLight = this.motes.length ? lit / this.motes.length : 0;

    if (T && this.phaseName === 'converging' && (this.centerLight >= 0.985 || T.t > T.ms * 2.5)) {
      this._fireCenter();                                  // ← the moment the page swaps the frame
      T.heldAt = T.t; this._setPhase('held');
    }
    if (T && this.phaseName === 'emitting' && this.centerLight < 0.06 && T.t - (T.emitAt || 0) > T.sweep) {
      this._transit = null; this._setPhase('settled');
    }
  };

  // ── drawing ────────────────────────────────────────────────────────────
  Field.prototype._colors = function () {
    return {
      cool: cssVar('--dv-cyan', '#56ccf2'),
      hot:  cssVar('--dv-gold', '#ffd166'),
      rule: cssVar('--dv-violet', '#8b5cf6'),
      ink:  cssVar('--dv-ink', '#e6edf3')
    };
  };

  // the border-zone wireframe: outer rule (z=1), inner rule (z=1/√2), eight spokes, one per station
  Field.prototype._frameLines = function () {
    var out = [], i, a, b, zi = 1 / SQRT2, w = this._ruleAlphaPer();
    function seg(x1, y1, z1, x2, y2, z2, c) { out.push(x1, y1, z1, c, x2, y2, z2, c); }
    var corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (i = 0; i < 4; i++) {
      a = corners[i]; b = corners[(i + 1) % 4];
      seg(a[0], a[1], 1, b[0], b[1], 1, w.outer);
      seg(a[0] * zi, a[1] * zi, zi, b[0] * zi, b[1] * zi, zi, w.inner);
    }
    for (i = 0; i < 8; i++) {
      var s = STATIONS[i];
      seg(s.x, s.y, s.z, s.x * 0.62, s.y * 0.62, s.z * 0.62,
        clamp(w.spoke + 0.75 * (this.charges[s.id] || 0), 0, 1));
    }
    return out;
  };
  Field.prototype._ruleAlphaPer = function () {
    var give = 1 - this.centerLight;                       // conservation: the rules keep what is left
    return { outer: 0.30 + 0.55 * give, inner: 0.16 + 0.36 * give, spoke: 0.10 + 0.28 * give };
  };

  Field.prototype._drawGL = function () {
    var n = this.motes.length, i, m;
    if (!this._buf || this._buf.length < n * 4) this._buf = new Float32Array(n * 4);
    for (i = 0; i < n; i++) { m = this.motes[i]; this._buf[i * 4] = m.x; this._buf[i * 4 + 1] = m.y; this._buf[i * 4 + 2] = m.z; this._buf[i * 4 + 3] = m.ch; }
    var lines = this._frameLines();
    if (!this._lbuf || this._lbuf.length !== lines.length) this._lbuf = new Float32Array(lines.length);
    this._lbuf.set(lines);
    var c = this._colors();
    this.gl.draw({
      points: this._buf, count: n,
      lines: this._lbuf, lineCount: lines.length / 4,
      cam: this.cam,
      frame: [this.halfW / (this.cssW / 2), this.halfH / (this.cssH / 2)],
      size: 3.4 * this.dpr,
      cool: hexToRgb(c.cool), hot: hexToRgb(c.hot), rule: hexToRgb(c.rule),
      alpha: 0.85, ruleAlpha: 1
    });
    this._drawCenter2d(true);
  };

  // sprite-cached 2d fallback — a fresh radial gradient per pixel per frame kills mobile
  Field.prototype._sprite = function (hex, px) {
    var key = hex + '@' + px;
    if (this._sprites[key]) return this._sprites[key];
    var c = doc.createElement('canvas'); c.width = c.height = px * 2;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(px, px, 0, px, px, px);
    grd.addColorStop(0, hex); grd.addColorStop(0.45, hex + '99'); grd.addColorStop(1, hex + '00');
    g.fillStyle = grd; g.fillRect(0, 0, px * 2, px * 2);
    this._sprites[key] = c;
    return c;
  };

  Field.prototype._draw2d = function () {
    var g = this.ctx, d = this.dpr, i, m, p;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.clearRect(0, 0, this.cssW, this.cssH);
    var c = this._colors(), w = this._ruleAlphaPer();

    // the border zone, in the same projection the shader uses
    var lines = this._frameLines();
    g.lineWidth = 1;
    for (i = 0; i < lines.length; i += 8) {
      var a = this.project(lines[i], lines[i + 1], lines[i + 2]);
      var b = this.project(lines[i + 4], lines[i + 5], lines[i + 6]);
      g.strokeStyle = c.rule;
      g.globalAlpha = lines[i + 3];
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    g.globalAlpha = 1;

    // the motion pixels
    g.globalCompositeOperation = 'lighter';
    for (i = 0; i < this.motes.length; i++) {
      m = this.motes[i]; p = this.project(m.x, m.y, m.z);
      var px = Math.max(2, Math.round(2.4 * p.d * (0.6 + m.ch)));
      var sp = this._sprite(m.ch > 0.62 ? c.hot : c.cool, px);
      g.globalAlpha = clamp(0.30 + 0.65 * m.ch, 0, 1) * (0.4 + 0.6 * p.d);
      g.drawImage(sp, p.x - px, p.y - px);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    this._drawCenter2d(false);
  };

  // the centre station — the reference, and what the centre says when it is full
  Field.prototype._drawCenter2d = function (overlay) {
    var g = this.ctx2d || this.ctx;
    if (!g) return;
    var c = this._colors(), cx = this.cssW / 2, cy = this.cssH / 2;
    if (overlay) { g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.clearRect(0, 0, this.cssW, this.cssH); }
    var a = 0.10 + 0.55 * this.centerLight;
    g.strokeStyle = c.ink; g.globalAlpha = a * 0.5; g.lineWidth = 1;
    var r = 7 + 5 * this.centerLight;
    g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
    g.globalAlpha = a * 0.35;
    g.beginPath(); g.arc(cx, cy, r * PHI, 0, 6.2831853); g.stroke();
    if (this._announce && this.centerLight > 0.35) {
      g.globalAlpha = clamp((this.centerLight - 0.35) / 0.5, 0, 1);
      g.fillStyle = c.hot;
      g.font = '600 ' + Math.round(Math.min(this.cssW, this.cssH) * 0.030) + 'px ui-monospace, monospace';
      g.textAlign = 'center';
      g.fillText(this._announce.glyph, cx, cy - r * 2.4);
      g.fillStyle = c.ink;
      g.font = Math.round(Math.min(this.cssW, this.cssH) * 0.016) + 'px ui-monospace, monospace';
      g.fillText(this._announce.label, cx, cy + r * 3.2);
      g.textAlign = 'start';
    }
    g.globalAlpha = 1;
  };

  Field.prototype._frame = function (now) {
    var self = this;
    this._raf = requestAnimationFrame(function (n) { self._frame(n); });
    if (this._hidden) return;
    // THE FIRST FRAME ESTABLISHES THE CLOCK; IT IS NOT MEASURED AGAINST A GUESS.
    //
    // This read `var dt = this._last ? now - this._last : 16.7` and then returned when dt was under
    // the 30fps floor — so on the FIRST frame it invented 16.7 ms, found 16.7 < 33.3, and returned
    // BEFORE the line that assigns `_last`. `_last` therefore stayed 0 for the life of the page,
    // every subsequent frame invented the same 16.7 and returned again, and the frame NEVER DREW A
    // SINGLE PIXEL — on any machine, since the guess was a constant and not a timing. The canvas
    // stayed fully transparent and the failure was invisible: a border substrate that draws nothing
    // looks exactly like a page that has no border substrate.
    //
    // The idiom the other substrates use is `if (this._last && now - this._last < cap) return;` —
    // the first frame passes because there is nothing to compare it to yet. That is the whole fix.
    // dt is still needed by the integrator below, so it keeps a nominal value for that one frame.
    var dt = this._last ? now - this._last : 1000 / 30;
    if (this._last && dt < 1000 / 30) return;
    this._last = now;
    this._t = now;
    this._ema += (dt - this._ema) * 0.1;

    // adaptive: climb only on sustained headroom, back off quickly (the frame must never cost the substrate)
    if (this._ema > 40 && this._cap > 96) { this._cap = Math.max(96, Math.round(this._cap * 0.8)); this._seed(); }
    else if (this._ema < 26 && this._cap < this.wantMotes) {
      this._good = (this._good || 0) + dt;
      if (this._good > 3000) { this._cap = Math.min(this.wantMotes, Math.round(this._cap * 1.25)); this._seed(); this._good = 0; }
    } else this._good = 0;

    // the 4 Hz re-measure: unconditional, the belt to _watchBox's braces, exactly as in voice-scope.js.
    // Reading clientWidth flushes layout, so it is on a timer and not per frame — one forced reflow
    // every 7.5 frames at the 30fps cap, and either direction of the toggle caught within 250 ms.
    if (now - this._recheck >= 250) { this._recheck = now; this._resize(); }

    // A MEASURED ZERO STOPS THE PAINTING AND NOTHING ELSE. _step runs either way, on purpose: it owns
    // the transit state machine, and a transition begun before the frame was hidden must still reach
    // dv:center or the page waits forever for a swap that never comes. Only the pixels are skipped.
    this._step(dt);
    if (this._blank) return;
    if (this.gl) this._drawGL(); else this._draw2d();
  };

  Field.prototype.start = function () {
    var self = this;
    if (!this.canvas) return this;

    // WebGL lane first (periphery-frame.wjs); canvas-2d is the fallback, same projection
    if (opt(this.opts, 'webgl', true) && global.DVPeripheryGL) {
      this.gl = global.DVPeripheryGL.create(this.canvas);
    }
    if (this.gl) {
      // the centre reference is text + rules: a 2d overlay canvas above the GL canvas
      var ov = doc.createElement('canvas');
      ov.className = 'dv-periphery-overlay';
      ov.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:' +
        (this.canvas.style.zIndex || 6);
      (this.canvas.parentNode || doc.body).appendChild(ov);
      this._ov = ov; this.ctx2d = ov.getContext('2d');
    } else {
      this.ctx = this.canvas.getContext('2d');
      // A canvas is bound to the first context type it is given, for life. If a GL renderer was tried
      // on this canvas and failed — or a previous Field lost its context here — getContext('2d')
      // returns null and the fallback is dead. Take a fresh canvas in its place, carrying its identity.
      if (!this.ctx) {
        var fresh = doc.createElement('canvas');
        fresh.id = this.canvas.id; fresh.className = this.canvas.className;
        fresh.style.cssText = this.canvas.style.cssText;
        if (this.canvas.parentNode) this.canvas.parentNode.replaceChild(fresh, this.canvas);
        else (doc.body || doc.documentElement).appendChild(fresh);
        this.canvas = fresh;
        this.ctx = fresh.getContext('2d');
      }
    }

    // the overlay is sized inside _resize now, in both directions — it has to be, because the path
    // that restores this frame is a box observation, not a resize event, and an overlay left at 1×1
    // would come back blank under the returning GL frame
    this._resize();
    this._seed();

    this._bound.resize = function () { self._resize(); self._sprites = {}; };
    this._bound.vis = function () { self._hidden = doc.hidden; };
    global.addEventListener('resize', this._bound.resize);
    doc.addEventListener('visibilitychange', this._bound.vis);

    // the event contract — wired here, UNWIRED in stop(); a leaked listener answers after the swap
    this._bound.ev = {
      'dv:pace': function (e) { self.pace = clamp((e.detail && e.detail.value) || 1, 0.15, 4); },
      'dv:scope': function (e) { var v = clamp((e.detail && e.detail.value) || 0.5, 0, 1); self._camTarget = 4.4 - 2.2 * v; },
      'dv:dock': function (e) { var d = e.detail || {}; if (d.anchor) self.charge(d.anchor, d.open); },
      'dv:transit': function (e) { self.transit((e.detail) || {}); }
    };
    Object.keys(this._bound.ev).forEach(function (k) { doc.addEventListener(k, self._bound.ev[k]); });

    // the box watch is wired on BOTH motion paths — a hidden frame is a hidden frame whether or not
    // it moves, and the reduced-motion path is precisely the one that had no way to notice
    this._watchBox();

    if (this.reduceMotion) {
      this._last = 0; this._t = 0;
      this._step(16.7);
      if (!this._blank) { if (this.gl) this._drawGL(); else this._draw2d(); }
      return this;
    }
    this._raf = requestAnimationFrame(function (n) { self._frame(n); });

    // demo: the frame plays its own transition on a loop, so it can hold the stage in the carousel
    if (this.opts.demo) {
      var names = ['◈ the periphery', '⟁ the return', '✦ the centre', '◇ the frustum'];
      var k = 0;
      this._demo = setInterval(function () {
        if (self.phaseName !== 'settled') return;
        self.transit({ label: names[k % names.length], glyph: names[k % names.length].charAt(0) });
        k++;
      }, 3400);
    }
    return this;
  };

  Field.prototype.stop = function () {
    var self = this;
    cancelAnimationFrame(this._raf); this._raf = 0;
    if (this._demo) { clearInterval(this._demo); this._demo = 0; }
    // an observer and an interval leak exactly the way a listener does — see _watchBox
    if (this._ro) { try { this._ro.disconnect(); } catch (e) {} this._ro = null; }
    if (this._poll) { global.clearInterval(this._poll); this._poll = 0; }
    if (this._bound.resize) global.removeEventListener('resize', this._bound.resize);
    if (this._bound.vis) doc.removeEventListener('visibilitychange', this._bound.vis);
    if (this._bound.ev) Object.keys(this._bound.ev).forEach(function (k) { doc.removeEventListener(k, self._bound.ev[k]); });
    if (this._senses && this._bound.peak) { try { this._senses.off('peak', this._bound.peak); } catch (e) {} }
    this._bound = {};
    if (this.gl) { this.gl.destroy(); this.gl = null; }
    if (this._ov && this._ov.parentNode) this._ov.parentNode.removeChild(this._ov);
    this._ov = null; this.ctx2d = null;
    return this;
  };

  // projected stations, for anything placing DOM furniture in the frame
  Field.prototype.stations = function () {
    var self = this;
    return STATIONS.map(function (s) {
      var p = self.project(s.x, s.y, s.z);
      return { id: s.id, i: s.i, kind: s.kind, x: s.x, y: s.y, z: s.z,
               sx: p.x, sy: p.y, depth: p.d, charge: self.charges[s.id] || 0 };
    });
  };

  function opt(o, k, dflt) { return (o && o[k] != null) ? o[k] : dflt; }

  var DV = {
    Field: Field,
    STATIONS: STATIONS,
    RING: RING,
    ring: ring,
    depthOf: depthOf,
    SPRING: { D: SPRING_D, K: SPRING_K },
    version: '1.0.0'
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DV;
  global.DVPeriphery = DV;
})(typeof window !== 'undefined' ? window : this);
