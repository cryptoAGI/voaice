/**
 * pronounce.js — how a voice SAYS the names it reads, for the browser and for Node.
 *
 * The twin of tools/pronounce.py: the same table (pronunciation/lexicon.json, format
 * voaice-pronunciation/1), the same rule — case-insensitive, ONE pass, longest match first — and
 * test/test_pronounce.py requires the two to produce identical text for the same input.
 *
 * Apply it to the text handed to a synthesiser (a SpeechSynthesisUtterance, a render request, a
 * phonemizer) and to nothing else: captions, highlighting and fingerprints keep the page's spelling.
 *
 *   const P = VoaicePronounce.compile(await (await fetch('pronunciation/lexicon.json')).json());
 *   speechSynthesis.speak(new SpeechSynthesisUtterance(P.spoken(block.text)));
 *   P.version   // record it beside anything you render
 *
 * No dependencies; UMD (window.VoaicePronounce, or module.exports).
 */
(function (global) {
  'use strict';

  var FORMAT = 'voaice-pronunciation/1';

  function escape(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function compile(table) {
    if (!table || table.format !== FORMAT) throw new Error('pronounce: expected format ' + FORMAT);
    var ents = (table.entries || []).slice().sort(function (a, b) { return b.match.length - a.match.length; });
    var say = {};
    ents.forEach(function (e) { say[e.match.toLowerCase()] = e.say; });
    var source = ents.map(function (e) { return escape(e.match); }).join('|');
    return {
      version: table.version,
      entries: ents,
      spoken: function (text) {
        text = String(text == null ? '' : text);
        if (!ents.length) return text;
        return text.replace(new RegExp(source, 'gi'), function (m) { return say[m.toLowerCase()]; });
      },
      find: function (text) {
        var out = {};
        if (!ents.length) return out;
        String(text == null ? '' : text).replace(new RegExp(source, 'gi'), function (m) { out[m] = (out[m] || 0) + 1; return m; });
        return out;
      },
      needs: function (text) { return ents.length > 0 && new RegExp(source, 'i').test(String(text == null ? '' : text)); }
    };
  }

  var api = { compile: compile, format: FORMAT, version: '1.0.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.VoaicePronounce = api;
})(typeof window !== 'undefined' ? window : globalThis);
