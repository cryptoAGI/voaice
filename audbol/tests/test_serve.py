import json, threading, urllib.request
import pytest
from audbol import serve as S


@pytest.fixture(scope="module")
def server(tone_wav):
    srv = S.make_server(tone_wav, "127.0.0.1", 0)
    t = threading.Thread(target=srv.serve_forever, daemon=True); t.start()
    base = "http://127.0.0.1:%d" % srv.server_address[1]
    yield base
    srv.shutdown(); srv.server_close()


def get(base, path, headers=None):
    req = urllib.request.Request(base + path, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def test_index_and_substrate_are_served(server):
    st, h, body = get(server, "/")
    assert st == 200 and b"audbol" in body and b"/substrate/voice-scope.js" in body
    st, h, body = get(server, "/substrate/voice-scope.js")
    assert st == 200 and b"DVVoiceScope" in body
    st, _, _ = get(server, "/substrate/../audbol/serve.py")
    assert st == 404


def test_source_carries_the_hash(server, tone_wav):
    from audbol.report import sha256
    st, _, body = get(server, "/api/source")
    j = json.loads(body)
    assert st == 200 and j["sha256"] == sha256(tone_wav) and j["sample_rate"] == 22050
    assert "voice-scope.js" in j["substrate"] and "waveform.js" in j["substrate"]


def test_audio_ranges(server, tone_wav):
    size = tone_wav.stat().st_size
    st, h, body = get(server, "/audio")
    assert st == 200 and len(body) == size and h["Accept-Ranges"] == "bytes"
    st, h, body = get(server, "/audio", {"Range": "bytes=0-99"})
    assert st == 206 and len(body) == 100 and h["Content-Range"] == "bytes 0-99/%d" % size
    st, h, body = get(server, "/audio", {"Range": "bytes=-50"})
    assert st == 206 and len(body) == 50
    st, _, _ = get(server, "/audio", {"Range": "bytes=%d-" % (size + 10)})
    assert st == 416


def test_measure_whole_and_region(server):
    st, _, body = get(server, "/api/measure")
    whole = json.loads(body)
    assert st == 200 and whole["whole"] is True and "f0_median" in whole["measurements"]
    st, _, body = get(server, "/api/measure?from=0.1&to=0.9")
    tone = json.loads(body)
    assert tone["whole"] is False and tone["frames"] == int(0.8 * 22050)
    assert abs(float(tone["measurements"]["f0_median"]["value"]) - 220.0) < 3.0
    st, _, body = get(server, "/api/measure?from=1.1&to=1.9&only=silence_ratio")
    quiet = json.loads(body)
    assert list(quiet["measurements"])[0] == "silence_ratio"
    assert float(quiet["measurements"]["silence_ratio"]["value"]) > 0.99


def test_bad_region_is_a_400_not_a_crash(server):
    st, _, body = get(server, "/api/measure?from=1.5&to=1.5")
    assert st == 400 and "empty slice" in json.loads(body)["error"]
    st, _, _ = get(server, "/api/measure?from=abc")
    assert st == 400


def test_bands_route(server):
    st, _, body = get(server, "/api/bands?from=0&to=1")
    j = json.loads(body)
    assert st == 200 and set(j["bands"]) == {"sub", "low", "intelligibility", "presence", "air"}
    # a 220 Hz tone lives in 'low'
    assert float(j["bands"]["low"]["value"]) > 0.9
