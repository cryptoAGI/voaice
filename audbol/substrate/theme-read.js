/*!
 * DeltaVerse nGn — theme-read (DVThemeRead: read the active --dv-* palette for live renderers).
 *
 * The color theme lives in CSS custom properties (--dv-*), set by DVThemes.applyTheme(). This helper lets
 * the WebGL core and the canvas-2d substrate modules READ that palette (as hex + [r,g,b] 0..1) so every
 * substrate recolors when the theme changes. DVThemes.applyTheme() dispatches a `dv-theme` window event;
 * onChange() subscribes to it. Zero-dependency UMD.
 *
 *   var pal = DVThemeRead.palette();   // { bg, ink, primary, accent, gold, agent } each {hex, rgb:[r,g,b]}
 *   DVThemeRead.onChange(function(){ pal = DVThemeRead.palette(); });
 *
 * Homage to Dr. Richard S. Wallace.
 */
(function (global) {
  'use strict';

  // semantic role → CSS var, with a sane fallback hex (the default-dark palette)
  var VARS = {
    bg:      ['--dv-bg', '#05060c'],
    ink:     ['--dv-ink', '#e6edf3'],
    primary: ['--dv-violet', '#8b5cf6'],
    accent:  ['--dv-electric', '#9fe9ff'],
    gold:    ['--dv-gold', '#ffd166'],
    agent:   ['--dv-agent', '#3fb950']
  };

  function hexToRgb(hex) {
    hex = String(hex || '').trim();
    // emergent/synthesized themes may carry hsl() tokens (ThemeEmergence, DVThemeSynth) — read those too
    var m = /^hsla?\(\s*(-?[\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/.exec(hex);
    if (m) {
      var h = ((parseFloat(m[1]) % 360) + 360) % 360, s = Math.min(100, Math.max(0, parseFloat(m[2]))) / 100, l = Math.min(100, Math.max(0, parseFloat(m[3]))) / 100;
      var C = (1 - Math.abs(2 * l - 1)) * s, X = C * (1 - Math.abs((h / 60) % 2 - 1)), mm = l - C / 2;
      var r = 0, g = 0, b = 0;
      if (h < 60) { r = C; g = X; } else if (h < 120) { r = X; g = C; } else if (h < 180) { g = C; b = X; }
      else if (h < 240) { g = X; b = C; } else if (h < 300) { r = X; b = C; } else { r = C; b = X; }
      return [r + mm, g + mm, b + mm];
    }
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    if (hex.length < 6) return [0, 0, 0];
    var n = parseInt(hex.slice(0, 6), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function readVar(name, fallback) {
    try {
      if (global.getComputedStyle && global.document) {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name);
        if (v && v.trim()) return v.trim();
      }
    } catch (e) {}
    return fallback;
  }

  function palette() {
    var out = {};
    for (var k in VARS) { if (!VARS.hasOwnProperty(k)) continue; var hex = readVar(VARS[k][0], VARS[k][1]); out[k] = { hex: hex, rgb: hexToRgb(hex) }; }
    return out;
  }

  function onChange(cb) {
    if (!global.addEventListener) return function () {};
    global.addEventListener('dv-theme', cb);
    return function () { global.removeEventListener('dv-theme', cb); };
  }
  function emit() { try { global.dispatchEvent && global.dispatchEvent(new Event('dv-theme')); } catch (e) {} }

  var DVThemeRead = { palette: palette, onChange: onChange, emit: emit, hexToRgb: hexToRgb, VARS: VARS, version: '1.0.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = DVThemeRead;
  global.DVThemeRead = DVThemeRead;
})(typeof window !== 'undefined' ? window : this);
