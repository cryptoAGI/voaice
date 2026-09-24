#!/usr/bin/env node
/*
 * render-listen.mjs — render a DeltaVerse page to audio, once, and keep it.
 *
 * The browser's own synthesiser gives back no file: speechSynthesis exposes no audio stream, so there is
 * nothing to seek, nothing to download and nothing to keep. This renders the same text ahead of time on
 * the host — espeak-ng for the synthesis, opusenc for the encoding — and writes immutable parts plus a
 * manifest to /audio/<doc>/<voice>/. The player prefers those when they exist (engine/ngn/doc-audio.js)
 * and falls back to live synthesis when they do not, which is most documents, most of the time.
 *
 * THE DERIVATION TRANSFERS. A DeltaVerse voice stores a RATIO from neural rather than an absolute
 * (engine/ngn/voices.js), so the same derivation maps straight onto a different engine: neural is
 * espeak-ng -s 172 -p 50, and jaimla at x0.94 rate x0.92 pitch is -s 161 -p 46. That is the whole
 * argument for ratios, demonstrated.
 *
 * The text is piped to espeak-ng on STDIN, never passed as an argument: there is no argv length limit
 * to work around and the text is never visible in `ps` on a shared host.
 *
 *   node scripts/render-listen.mjs voices                 # render voices.html in every voice
 *   node scripts/render-listen.mjs map --voice=neural     # one voice
 *   node scripts/render-listen.mjs --all --dry-run        # what it would render, and how big
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const SRC = join(ROOT, 'deploy', 'web2', 'deltaverse-landing');
const HOST = process.env.DV_HOST || 'root@168.231.126.58';
const DOCROOT = process.env.DV_DOCROOT || '/home/deltaverse/www';
const OWNER = process.env.DV_OWNER || 'deltaverse:www-data';
// Unique per run. A shared staging path means two concurrent renders race, and the one that finishes
// first deletes the other's manifests out from under it — which it did, once, between a --all run and a
// single-page run started while it was still going.
const STAGE = join(process.env.TMPDIR || '/tmp', 'dv-listen-render-' + process.pid + '-' + Date.now().toString(36));

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ALL = args.includes('--all');
const only = (args.find(a => a.startsWith('--voice=')) || '').slice(8);
const docs = args.filter(a => !a.startsWith('-'));

// the prosody of every voice, read from the module rather than restated here
global.window = global; global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const DVVoices = require(join(ROOT, 'engine', 'ngn', 'voices.js'));
const DVDocReader = require(join(ROOT, 'engine', 'ngn', 'doc-reader.js'));

const ESPEAK_BASE_WPM = 175;      // espeak-ng's own default; neural's rate multiplies it
const ESPEAK_BASE_PITCH = 50;     // 0..99
const PART_SECONDS = 240;         // a part is about four minutes: fast to start, few files to hold

// ── the document, as the reader sees it ────────────────────────────────
// Mirrors DVDocReader.collect: the same leaf blocks, the same skips, the same sentence splitting — so
// what is rendered is what would have been spoken. Regex parsing is enough because these are our own
// pages, hand-written, and a mis-parse shows up immediately as a missing block in the manifest.
const SKIP_CLASS = /(dv-reader|dv-reader-panel|foot|drift|tryit)/;
function blocksOf(html) {
  // A page need not have a <body> tag — the 404 is a bare doctype, meta, style and content, which is
  // valid and which sliced to a single character here. Fall back to everything after </head>, then to
  // the whole document.
  let at = html.indexOf('<body');
  if (at < 0) at = html.indexOf('</head>');
  if (at < 0) at = 0;
  const body = html.slice(at).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  const out = [];
  const re = /<(h1|h2|h3|h4|p|blockquote|li|cite|figcaption|dd|dt|td|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(body))) {
    const [, tag, attrs, inner] = m;
    if (tag.toLowerCase() === 'a' && !/data-read/i.test(attrs)) continue;   // anchors only when marked
    if (/data-noread/i.test(attrs)) continue;
    if (SKIP_CLASS.test(attrs)) continue;
    if (/<(h1|h2|h3|h4|p|blockquote|li|cite|dd|dt|td)\b/i.test(inner)) continue;   // containers, not leaves
    let text = inner
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&mdash;/g, '—')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&[a-z]+;/g, ' ')
      .replace(/\s+/g, ' ').trim();
    text = text.replace(/\bLISTEN\b.*$/, '').trim();
    if (text.length < 2 || !/[a-z0-9]/i.test(text)) continue;
    out.push({ tag: tag.toLowerCase(), text });
  }
  return out;
}

// ~2.6 words a second at neural's pace: enough to group parts, not a claim about the final duration
const estimate = t => t.split(/\s+/).length / 2.6;

function partition(blocks) {
  const parts = []; let cur = { blocks: [], text: [], seconds: 0 };
  blocks.forEach((b, i) => {
    const s = estimate(b.text);
    if (cur.seconds + s > PART_SECONDS && cur.blocks.length) { parts.push(cur); cur = { blocks: [], text: [], seconds: 0 }; }
    cur.blocks.push(i); cur.text.push(b.text); cur.seconds += s;
  });
  if (cur.blocks.length) parts.push(cur);
  return parts;
}

function prosodyFor(voiceId) {
  const v = DVVoices.get(voiceId);
  return {
    id: v.id, name: v.name, immutable: !!v.immutable, from: v.from || null,
    wpm: Math.round(ESPEAK_BASE_WPM * v.prosody.rate),
    pitch: Math.max(0, Math.min(99, Math.round(ESPEAK_BASE_PITCH * v.prosody.pitch))),
    rate: v.prosody.rate, pitchRatio: v.prosody.pitch
  };
}

// Render each BLOCK separately, measure it exactly, then concatenate into one part.
//
// The obvious thing — render a whole part in one call — is cheaper and loses the only information the
// player actually needs: where each block begins. Estimating block boundaries from word counts puts the
// highlight on the wrong paragraph within about a minute, which is worse than no highlight. Rendering
// per block gives EXACT offsets from the WAV frame counts, and concatenating before the encode still
// leaves one file per part. The cost is one espeak-ng invocation per block; espeak-ng runs at roughly
// 780× realtime, so a whole document is a couple of seconds.
//
// The blocks go over STDIN as JSON: never an argument, so no argv limit and nothing visible in `ps`.
function renderRemote(blocks, p, outName) {
  // The program goes in argv (base64, decoded by the remote shell) and the DATA goes on stdin.
  // A heredoc cannot be used here: `python3 - <<PY` makes the heredoc itself stdin, python consumes
  // it as the program, and sys.stdin is then at EOF — the blocks never arrive and json.load fails on
  // an empty stream. The text still never appears in `ps`, which is the reason it is on stdin at all.
  const PY = `
import hashlib,json,os,subprocess,sys,tempfile,wave
blocks = json.load(sys.stdin)
tmp = tempfile.mkdtemp()
offsets, frames_total, rate, width, chans, chunks = [], 0, None, None, None, []
for i, text in enumerate(blocks):
    wav = os.path.join(tmp, "b%04d.wav" % i)
    subprocess.run(["espeak-ng","-v","en-us","-s","${p.wpm}","-p","${p.pitch}","-w",wav],
                   input=text.encode("utf-8"), check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    w = wave.open(wav, "rb")
    if rate is None: rate, width, chans = w.getframerate(), w.getsampwidth(), w.getnchannels()
    offsets.append(round(frames_total / float(rate), 3))
    frames_total += w.getnframes()
    chunks.append(w.readframes(w.getnframes()))
    w.close(); os.unlink(wav)
joined = os.path.join(tmp, "part.wav")
o = wave.open(joined, "wb")
o.setnchannels(chans); o.setsampwidth(width); o.setframerate(rate)
for c in chunks: o.writeframes(c)
o.close()
dest = "${DOCROOT}/audio/${outName.dir}/${outName.file}"
subprocess.run(["opusenc","--quiet","--bitrate","24","--downmix-mono",joined,dest], check=True)
v = hashlib.md5(open(dest,"rb").read()).hexdigest()[:10]
print(json.dumps({"seconds": round(frames_total/float(rate),3), "wav": os.path.getsize(joined),
                  "opus": os.path.getsize(dest), "offsets": offsets, "rate": rate, "v": v}))
os.unlink(joined); os.rmdir(tmp)
`;
  const b64 = Buffer.from(PY, 'utf8').toString('base64');
  const cmd = `set -e; mkdir -p ${DOCROOT}/audio/${outName.dir}; ` +
              `python3 -c "$(printf %s '${b64}' | base64 -d)"`;
  let out;
  try {
    out = execFileSync('ssh', ['-o', 'BatchMode=yes', HOST, cmd],
      { input: JSON.stringify(blocks), maxBuffer: 16 * 1024 * 1024 }).toString();
  } catch (e) {
    const err = (e.stderr && e.stderr.toString()) || e.message;
    throw new Error('remote render failed:\n' + err.slice(0, 600));
  }
  const line = out.trim().split('\n').filter(l => l.startsWith('{')).pop();
  if (!line) throw new Error('render produced no manifest line:\n' + out.slice(0, 400));
  return JSON.parse(line);
}

const PAGES = ALL ? ['voices', 'map', 'periphery', '404'] : (docs.length ? docs : ['voices']);
const VOICES = only ? [only] : DVVoices.list().map(v => v.id);

let grand = 0;
for (const doc of PAGES) {
  const file = join(SRC, doc + '.html');
  if (!existsSync(file)) { console.error(`[listen] no such page: ${doc}.html`); continue; }
  const blocks = blocksOf(readFileSync(file, 'utf8'));
  const parts = partition(blocks);
  const words = blocks.reduce((a, b) => a + b.text.split(/\s+/).length, 0);
  console.log(`\n${doc}.html — ${blocks.length} blocks · ${words} words · ${parts.length} part(s), ~${Math.round(parts.reduce((a, p) => a + p.seconds, 0))}s`);

  for (const vid of VOICES) {
    const p = prosodyFor(vid);
    const dir = `${doc}/${vid}`;
    const derived = p.immutable ? 'the reference' : `${p.from} ×${p.rate.toFixed(2)} rate ×${p.pitchRatio.toFixed(2)} pitch`;
    if (DRY) {
      console.log(`  ${vid.padEnd(12)} espeak-ng -s ${p.wpm} -p ${p.pitch}   (${derived})`);
      continue;
    }
    mkdirSync(join(STAGE, dir), { recursive: true });
    const manifest = { doc, voice: vid, voiceName: p.name, derivedFrom: derived,
      engine: 'espeak-ng 1.51 → opusenc 24kbps mono', wpm: p.wpm, pitch: p.pitch,
      generated: new Date().toISOString(), blocks: blocks.length, parts: [] };
    let bytes = 0;
    parts.forEach((part, i) => {
      const name = `part-${String(i + 1).padStart(2, '0')}.opus`;
      const info = renderRemote(part.text, p, { dir, file: name });
      bytes += info.opus;
      // the exact second each block begins, inside this part — measured, not estimated
      // The part filename is stable, so the URL must carry the render's identity or a year-long cache
      // would serve last week's audio forever. The manifest is no-cache, so a new v is seen at once.
      manifest.parts.push({ n: i + 1, file: name, v: info.v, seconds: info.seconds, bytes: info.opus,
        from: part.blocks[0], to: part.blocks[part.blocks.length - 1],
        marks: part.blocks.map(function (b, k) { return { block: b, at: info.offsets[k] }; }) });
      process.stdout.write(`  ${vid.padEnd(12)} ${name} ${info.seconds}s ${(info.opus / 1024).toFixed(0)}KB\n`);
    });
    manifest.seconds = +manifest.parts.reduce((a, x) => a + x.seconds, 0).toFixed(3);
    manifest.bytes = bytes; grand += bytes;
    const mf = join(STAGE, dir, 'manifest.json');
    writeFileSync(mf, JSON.stringify(manifest, null, 1) + '\n');
    execFileSync('scp', ['-q', '-o', 'BatchMode=yes', mf, `${HOST}:${DOCROOT}/audio/${dir}/manifest.json`]);
    execFileSync('ssh', ['-o', 'BatchMode=yes', HOST,
      `chown -R ${OWNER} ${DOCROOT}/audio/${dir} && chmod 755 ${DOCROOT}/audio/${doc} ${DOCROOT}/audio/${dir} && chmod 644 ${DOCROOT}/audio/${dir}/*`]);
  }
}
if (!DRY) {
  try { rmSync(STAGE, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n[listen] ${(grand / 1024 / 1024).toFixed(2)} MB written to ${DOCROOT}/audio/`);
} else {
  console.log('\n(dry run — nothing rendered)');
}
