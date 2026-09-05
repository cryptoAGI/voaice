from audbol import read, measure


def test_slice_is_a_clip_of_its_own(tone_wav):
    c = read(tone_wav)
    s = c.slice(0.25, 0.75)
    assert s.rate == c.rate and s.channels == c.channels
    import math
    assert s.frames == math.ceil(0.75 * c.rate) - math.floor(0.25 * c.rate)   # floor at the start, ceil at the end
    assert "#0.250-0.750" in s.path


def test_slice_bounds_floor_start_and_ceil_end(tone_wav):
    c = read(tone_wav)
    s = c.slice(0.0001, 0.0002)          # 2.2 and 4.4 frames at 22050 Hz -> frames 2..5
    assert s.frames == 3


def test_empty_slice_refused(tone_wav):
    import pytest
    c = read(tone_wav)
    with pytest.raises(ValueError):
        c.slice(1.5, 1.5)


def test_measurements_differ_between_tone_and_silence(tone_wav):
    c = read(tone_wav)
    tone, quiet = c.slice(0.1, 0.9), c.slice(1.1, 1.9)
    assert float(str(measure.silence_ratio(tone))) < 0.01
    assert float(str(measure.silence_ratio(quiet))) > 0.99
    f0 = float(str(measure.f0_median(tone)))
    assert abs(f0 - 220.0) < 3.0, f0
