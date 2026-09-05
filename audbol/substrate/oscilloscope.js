/*!
 * DeltaVerse nGn — oscilloscope (DVScope: scientific sound-measuring tools).
 *
 * Measures sound with 18 decimals of accuracy (cypherpunk2048 standard) over the uint256 range
 * (max 2^256-1). Eight acoustic metrics (RMS, dominant frequency, spectral centroid/rolloff/bandwidth/
 * flux, zero-crossing rate, harmonic-to-noise ratio), each encoded as an 18-decimal fixed-point BigInt
 * (×10^18), and a SHA-256/512 voiceprint that derives a uint256 scientific value — the same 18-decimal /
 * 2^256-1 domain as the scifi SCIENTIFIC mint. This is the "measure for accuracy" tool of the scifi
 * concept. Faithful port of faicey BlockchainVoicePrint formulas.
 *
 * Prototype lane (.js, zero-dep, UMD). Pure helpers run headless (Node); the Web Audio path no-ops
 * without an AnalyserNode. SHA via globalThis.crypto.subtle (Node 22 + browser).
 */
(function (global) {
  'use strict';

  var PRECISION = 18;
  var MUL = 1000000000000000000;                 // 10^18 (Number, for scaling small audio metrics)
  var MUL_BI = 1000000000000000000n;             // 10^18 (BigInt)
  var UINT256_MAX = (2n ** 256n) - 1n;           // the scientific maximum

  // ── 18-decimal fixed-point (cypherpunk2048) ──
  function toPrecision18(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 0n;
    return BigInt(Math.floor(v * MUL));
  }
  function fromPrecision18(b) {
    b = (typeof b === 'bigint') ? b : BigInt(b);
    var neg = b < 0n; if (neg) b = -b;
    var q = b / MUL_BI, r = b % MUL_BI;
    return (neg ? '-' : '') + q.toString() + '.' + r.toString().padStart(PRECISION, '0');
  }
  function bound(x) {                              // assert 0 ≤ x ≤ 2^256-1
    x = (typeof x === 'bigint') ? x : BigInt(x);
    if (x < 0n || x > UINT256_MAX) throw new RangeError('value outside uint256 [0, 2^256-1]');
    return x;
  }
  function add18(a, b) { return bound(bound(a) + bound(b)); }   // scientific fixed-point addition

  // ── metric formulas (faithful to faicey) ──
  function rms(time) { var s = 0; for (var i = 0; i < time.length; i++) s += time[i] * time[i]; return Math.sqrt(s / (time.length || 1)); }
  function peak(time) { var m = 0; for (var i = 0; i < time.length; i++) { var a = Math.abs(time[i]); if (a > m) m = a; } return m; }
  function zeroCrossingRate(time) { var c = 0; for (var i = 1; i < time.length; i++) if ((time[i] >= 0) !== (time[i - 1] >= 0)) c++; return c / (time.length || 1); }
  function binHz(i, n, sr) { return (i * sr) / (2 * n); }
  function dominantFrequency(freq, sr) { var mi = 0, mv = -Infinity; for (var i = 0; i < freq.length; i++) if (freq[i] > mv) { mv = freq[i]; mi = i; } return binHz(mi, freq.length, sr); }
  function spectralCentroid(freq, sr) { var num = 0, den = 0; for (var i = 0; i < freq.length; i++) { var m = Math.max(0, freq[i]); num += binHz(i, freq.length, sr) * m; den += m; } return den > 0 ? num / den : 0; }
  function spectralRolloff(freq, sr, frac) { frac = frac || 0.85; var tot = 0, i; for (i = 0; i < freq.length; i++) tot += Math.max(0, freq[i]); var th = tot * frac, run = 0; for (i = 0; i < freq.length; i++) { run += Math.max(0, freq[i]); if (run >= th) return binHz(i, freq.length, sr); } return 0; }
  function spectralBandwidth(freq, sr, centroid) { var num = 0, den = 0; for (var i = 0; i < freq.length; i++) { var m = Math.max(0, freq[i]); var d = binHz(i, freq.length, sr) - centroid; num += d * d * m; den += m; } return den > 0 ? Math.sqrt(num / den) : 0; }
  function spectralFlux(freq, prev) { if (!prev) return 0; var f = 0; for (var i = 0; i < freq.length; i++) { var d = Math.max(0, freq[i] - (prev[i] || 0)); f += d * d; } return Math.sqrt(f); }
  function harmonicNoiseRatio(freq) { var mx = 0, sum = 0; for (var i = 0; i < freq.length; i++) { var m = Math.max(0, freq[i]); if (m > mx) mx = m; sum += m; } var mean = sum / (freq.length || 1); return mean > 0 ? mx / mean : 0; }

  // compute the 8 metrics as floats + their 18-decimal fixed-point encodings
  function metrics(time, freq, sampleRate, prevFreq) {
    var sr = sampleRate || 44100;
    var cen = spectralCentroid(freq, sr);
    var f = {
      rms: rms(time),
      dominantFrequency: dominantFrequency(freq, sr),
      spectralCentroid: cen,
      spectralRolloff: spectralRolloff(freq, sr),
      zeroCrossingRate: zeroCrossingRate(time),
      spectralBandwidth: spectralBandwidth(freq, sr, cen),
      spectralFlux: spectralFlux(freq, prevFreq),
      harmonicNoiseRatio: harmonicNoiseRatio(freq)
    };
    var p18 = {};
    Object.keys(f).forEach(function (k) { var b = toPrecision18(f[k]); p18[k] = { wei: b.toString(), decimal: fromPrecision18(b) }; });
    return { value: f, precision18: p18, precision: PRECISION, sampleRate: sr };
  }

  // ── dB IS NOT MAGNITUDE, AND EVERY SPECTRAL METRIC ABOVE ASSUMES MAGNITUDE ──
  //
  // `AnalyserNode.getFloatFrequencyData` fills the array with DECIBELS, and a normal spectrum is
  // entirely negative — roughly -100 dB at the floor and -25 dB at a strong partial. Every formula
  // above weights its bins with `Math.max(0, freq[i])`, which for that data is zero in every bin.
  // The result: spectralCentroid, spectralRolloff, spectralBandwidth, spectralFlux and
  // harmonicNoiseRatio all returned 0.0 for any real signal, and did so silently — the voiceprint
  // still hashed, still produced a plausible uint256, and five of its eight inputs were constants.
  // Measured 2026-09-02 with a synthetic 182 Hz voice: dominantFrequency 183 Hz (correct), centroid
  // 0 (wrong).
  //
  // The faicey original read `getByteFrequencyData`, which is 0..255 and unsigned, so the formulas
  // were right for the data they were written against. This converts instead of changing them:
  // amplitude = 10^(dB/20), floored at the analyser's own minDecibels so silence is 0 rather than a
  // denormal. Feed a dB array through here first and the metrics mean what they say.
  function linearFromDb(db, floorDb, out) {
    floorDb = (floorDb == null ? -100 : floorDb);
    out = out && out.length === db.length ? out : new Float32Array(db.length);
    for (var i = 0; i < db.length; i++) {
      var v = db[i];
      out[i] = (!isFinite(v) || v <= floorDb) ? 0 : Math.pow(10, v / 20);
    }
    return out;
  }

  // hash helpers (WebCrypto)
  function subtle() { var c = global.crypto || (global.window && global.window.crypto); if (!c || !c.subtle) throw new Error('WebCrypto unavailable'); return c.subtle; }
  function hex(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2); return s; }
  function digest(algo, str) { var enc = new (global.TextEncoder || TextEncoder)(); return subtle().digest(algo, enc.encode(str)).then(hex); }

  // the scientific voiceprint: canonical JSON of the 18-decimal metrics → SHA-256/512 → uint256
  function voiceprint(m) {
    var canon = JSON.stringify({ v: 'dvscope/1', precision: PRECISION, metrics: m.precision18 || m });
    return Promise.all([digest('SHA-256', canon), digest('SHA-512', canon)]).then(function (h) {
      var sha256 = h[0], sha512 = h[1];
      var u256 = bound(BigInt('0x' + sha256));      // 256-bit hash → uint256 (≤ 2^256-1)
      return { hash: sha256, hash512: sha512, short: sha256.slice(0, 16), uint256: u256.toString(), version: 'dvscope/1' };
    });
  }

  // ── live tool (Web Audio) ──
  function DVScopeLive(opts) {
    opts = opts || {}; this.fftSize = opts.fftSize || 2048; this.sampleRate = opts.sampleRate || 44100;
    this.analyser = opts.analyser || null; this._prevFreq = null; this._time = null; this._freq = null; this._mag = null;
  }
  // A DIFFERENT SOURCE IS A DISCONTINUITY THAT _sizeTo CANNOT SEE: it drops the previous frame only
  // when a buffer LENGTH changes, and two analysers at the same fftSize change no length, so the
  // first frame of the new signal would be differenced against the last frame of the old one and
  // reported as spectral flux. Dropped here instead. Twin of Field.attach in voice-scope.js.
  DVScopeLive.prototype.attach = function (analyser) {
    analyser = analyser || null;
    if (analyser !== this.analyser) { this._prevFreq = null; this._mag = null; }
    this.analyser = analyser;
    if (analyser) { this.fftSize = analyser.fftSize; this.sampleRate = (analyser.context && analyser.context.sampleRate) || this.sampleRate; }
    return this;
  };
  // THE SAME fftSize DEFECT LIVED IN BOTH LANES AND THE TWO WERE FIXED TOGETHER — do not fix one of
  // them and leave the other. Its twin is DVVoiceScope.Field._sizeTo in engine/ngn/voice-scope.js,
  // which carries the long form of the post-mortem. read() used to say
  //   this._time = this._time || new Float32Array(n)
  // and `||` keeps the first-ever allocation for ever. fftSize is a live, writable property, so a
  // caller that raises 2048 → 8192 kept a 1024-long _freq; getFloatFrequencyData writes only as far
  // as the array it is handed, and metrics() derives Hz as (i * sr) / (2 * freq.length), so every
  // frequency came back at FOUR TIMES its true value. Lowering the size was worse: the tail of the
  // buffer was never written again and was measured as frozen values from before the change.
  // Nothing threw, nothing logged, and the voiceprint hashed it as if measured. So the buffers are
  // checked against the analyser on every read rather than trusted from attach() time.
  DVScopeLive.prototype._sizeTo = function () {
    var a = this.analyser, changed = false;
    if (!this._time || this._time.length !== a.fftSize) { this._time = new Float32Array(a.fftSize); changed = true; }
    if (!this._freq || this._freq.length !== a.frequencyBinCount) { this._freq = new Float32Array(a.frequencyBinCount); changed = true; }
    if (changed) {
      // spectralFlux is a bin-to-bin difference against the previous frame. Across a size change
      // bin 40 is no longer the same frequency, so the snapshot is not comparable and is dropped
      // rather than differenced — metrics() reports flux 0 for a missing previous frame, which is
      // the honest answer for the first frame at a new size.
      this._prevFreq = null;
      this._mag = null;
      this.fftSize = a.fftSize;   // the public field is the ANALYSER's size, not attach()'s memory
    }
    return changed;
  };
  DVScopeLive.prototype.read = function () {
    if (!this.analyser) return null;
    this._sizeTo();
    this.analyser.getFloatTimeDomainData(this._time); this.analyser.getFloatFrequencyData(this._freq);
    // dB in, magnitude out — see linearFromDb. Without this every spectral metric below is 0.
    this._mag = linearFromDb(this._freq, this.analyser.minDecibels, this._mag);
    var m = metrics(this._time, this._mag, this.sampleRate, this._prevFreq);
    this._prevFreq = this._mag.slice();
    return m;
  };
  DVScopeLive.prototype.measure = function () { var m = this.read(); return m ? voiceprint(m).then(function (vp) { m.voiceprint = vp; return m; }) : Promise.resolve(null); };

  var DVScope = {
    PRECISION: PRECISION, UINT256_MAX: UINT256_MAX,
    toPrecision18: toPrecision18, fromPrecision18: fromPrecision18, bound: bound, add18: add18,
    rms: rms, peak: peak, zeroCrossingRate: zeroCrossingRate, dominantFrequency: dominantFrequency,
    spectralCentroid: spectralCentroid, spectralRolloff: spectralRolloff, spectralBandwidth: spectralBandwidth,
    spectralFlux: spectralFlux, harmonicNoiseRatio: harmonicNoiseRatio,
    linearFromDb: linearFromDb,
    metrics: metrics, voiceprint: voiceprint, Live: DVScopeLive, version: '1.1.0'
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DVScope;
  global.DVScope = DVScope;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
