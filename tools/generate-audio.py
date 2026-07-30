#!/usr/bin/env python3
"""
Ойын аудиосын процедуралық түрде жасау (қазақ эпикалық стилі).
Қолдану: python3 tools/generate-audio.py
Шығатын файлдар: client/assets/audio/*.ogg (немесе .wav)
"""
import math
import os
import struct
import subprocess
import wave

import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'client', 'assets', 'audio')
os.makedirs(OUT, exist_ok=True)


def save(name, data, sr=SR):
    """OGG Vorbis (soundfile), болмаса ffmpeg, болмаса WAV"""
    data = np.clip(data, -1.0, 1.0).astype(np.float32)
    ogg_path = os.path.join(OUT, name + '.ogg')
    try:
        import soundfile as sf
        sf.write(ogg_path, data, sr, format='OGG', subtype='VORBIS')
        print('OK', name + '.ogg')
        return
    except Exception:
        pass

    wav_path = os.path.join(OUT, name + '.wav')
    pcm = (data * 32000).astype(np.int16)
    with wave.open(wav_path, 'w') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    try:
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav_path,
                        '-c:a', 'libvorbis', '-q:a', '4', ogg_path], check=True)
        os.remove(wav_path)
        print('OK', name + '.ogg')
    except Exception:
        print('OK', name + '.wav')


def env(n, attack=0.01, decay=0.2, sustain=0.6, release=0.3):
    a = int(SR * attack); d = int(SR * decay); r = int(SR * release)
    s = max(0, n - a - d - r)
    return np.concatenate([
        np.linspace(0, 1, a),
        np.linspace(1, sustain, d),
        np.full(s, sustain),
        np.linspace(sustain, 0, r),
    ])[:n]


def pluck(freq, dur, amp=0.5, sr=SR):
    """Karplus-Strong — домбыра үні"""
    n = int(sr * dur)
    N = max(2, int(sr / freq))
    buf = np.random.uniform(-1, 1, N)
    out = np.zeros(n)
    for i in range(n):
        out[i] = buf[i % N]
        buf[i % N] = 0.497 * (buf[i % N] + buf[(i + 1) % N])
    return out * amp * np.exp(-np.linspace(0, 4, n))


def tone(freq, dur, amp=0.3, harmonics=(1, 0.5, 0.25), sr=SR):
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    s = sum(h * np.sin(2 * math.pi * freq * (i + 1) * t) for i, h in enumerate(harmonics))
    return s * amp * env(len(t))


def note(name_or_midi, octave=0):
    if isinstance(name_or_midi, (int, float)):
        m = name_or_midi
    else:
        names = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6,
                 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
        m = 60 + names[name_or_midi] + 12 * octave
    return 440.0 * (2 ** ((m - 69) / 12))


def build_theme():
    """Басты бет музыкасы: пентатоникалық қазақ эпикалық тақырыбы (~48 c, loop)"""
    bpm = 84
    beat = 60.0 / bpm
    total = int(SR * beat * 64)
    mix = np.zeros(total)

    # Пентатоника (A minor pentatonic)
    scale = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79]
    melody = [
        (69, 2), (72, 1), (74, 1), (72, 2), (69, 2),
        (67, 2), (69, 1), (72, 1), (69, 4),
        (64, 2), (67, 1), (69, 1), (67, 2), (64, 2),
        (62, 2), (64, 1), (67, 1), (69, 4),
        (72, 2), (74, 1), (76, 1), (74, 2), (72, 2),
        (69, 2), (72, 1), (69, 1), (67, 4),
        (69, 2), (67, 1), (64, 1), (62, 2), (60, 2),
        (57, 8),
    ]
    pos = 0
    for midi, dur in melody:
        d = beat * dur
        seg = pluck(note(midi), min(d * 1.4, 3.0), amp=0.42)
        soft = tone(note(midi), min(d * 1.2, 2.5), amp=0.10, harmonics=(1, 0.3))
        m = min(len(seg), len(soft))
        seg = seg.copy()
        seg[:m] += soft[:m]
        start = int(pos * SR)
        end = min(total, start + len(seg))
        mix[start:end] += seg[:end - start]
        pos += d

    # Бас (қобыз үні)
    bass_line = [45, 45, 41, 43] * 4
    pos = 0
    for midi in bass_line:
        d = beat * 4
        t = np.linspace(0, d, int(SR * d), endpoint=False)
        seg = (np.sin(2 * math.pi * note(midi) * t) * 0.22
               + np.sin(2 * math.pi * note(midi) * 2 * t) * 0.07)
        seg *= env(len(t), 0.15, 0.4, 0.7, 0.8)
        start = int(pos * SR); end = min(total, start + len(seg))
        mix[start:end] += seg[:end - start]
        pos += d

    # Дабыл (барабан)
    pos = 0
    while pos * SR < total:
        n = int(SR * 0.28)
        drum = (np.random.uniform(-1, 1, n) * 0.25 + np.sin(2 * math.pi * 62 * np.linspace(0, 0.28, n)) * 0.5)
        drum *= np.exp(-np.linspace(0, 12, n))
        start = int(pos * SR); end = min(total, start + n)
        mix[start:end] += drum[:end - start] * 0.4
        pos += beat * 2

    # Реверб (қарапайым)
    delay = int(SR * 0.18)
    rev = np.zeros_like(mix)
    rev[delay:] = mix[:-delay] * 0.28
    mix = mix + rev
    mix /= (np.abs(mix).max() + 1e-9)
    # Loop үшін жиектерді жұмсарту
    fade = int(SR * 1.5)
    mix[:fade] *= np.linspace(0, 1, fade)
    mix[-fade:] *= np.linspace(1, 0, fade)
    return mix * 0.75


def build_battle():
    """Бөлме ішіндегі кернеулі музыка"""
    bpm = 120
    beat = 60 / bpm
    total = int(SR * beat * 64)
    mix = np.zeros(total)
    riff = [57, 57, 60, 57, 62, 60, 57, 55]
    pos = 0
    while pos * SR < total:
        for m in riff:
            d = beat / 2
            seg = pluck(note(m), d * 2.0, amp=0.35)
            s = int(pos * SR); e = min(total, s + len(seg))
            mix[s:e] += seg[:e - s]
            pos += d
            if pos * SR >= total:
                break
    pos = 0
    while pos * SR < total:
        n = int(SR * 0.2)
        d = np.random.uniform(-1, 1, n) * 0.3 * np.exp(-np.linspace(0, 15, n))
        s = int(pos * SR); e = min(total, s + n)
        mix[s:e] += d[:e - s]
        pos += beat
    mix /= (np.abs(mix).max() + 1e-9)
    fade = int(SR * 1.0)
    mix[:fade] *= np.linspace(0, 1, fade)
    mix[-fade:] *= np.linspace(1, 0, fade)
    return mix * 0.55


def sfx_sword():
    n = int(SR * 0.45)
    t = np.linspace(0, 0.45, n)
    swoosh = np.random.uniform(-1, 1, n)
    # жиілік сүзгісі имитациясы
    k = 40
    swoosh = np.convolve(swoosh, np.hanning(k) / k, mode='same')
    swoosh *= np.exp(-np.linspace(0, 8, n))
    ring = np.sin(2 * math.pi * 2400 * t) * np.exp(-np.linspace(0, 18, n)) * 0.35
    ring += np.sin(2 * math.pi * 3600 * t) * np.exp(-np.linspace(0, 25, n)) * 0.2
    return (swoosh * 0.8 + ring) * 0.9


def sfx_correct():
    parts = []
    for m, d in [(72, 0.11), (76, 0.11), (79, 0.22)]:
        parts.append(tone(note(m), d, amp=0.5, harmonics=(1, 0.4, 0.15)))
    return np.concatenate(parts)


def sfx_wrong():
    n = int(SR * 0.5)
    t = np.linspace(0, 0.5, n)
    f = np.linspace(320, 110, n)
    s = np.sin(2 * math.pi * np.cumsum(f) / SR) * 0.5
    s += np.sin(2 * math.pi * np.cumsum(f * 1.02) / SR) * 0.3
    return s * np.exp(-np.linspace(0, 4, n))


def sfx_door():
    n = int(SR * 1.6)
    t = np.linspace(0, 1.6, n)
    rumble = np.sin(2 * math.pi * 48 * t) * 0.4 + np.sin(2 * math.pi * 71 * t) * 0.2
    creak = np.random.uniform(-1, 1, n)
    creak = np.convolve(creak, np.hanning(80) / 80, mode='same')
    creak *= (0.25 * (1 + np.sin(2 * math.pi * 5 * t)))
    envv = np.concatenate([np.linspace(0, 1, int(SR * 0.25)),
                           np.ones(n - int(SR * 0.85)),
                           np.linspace(1, 0, int(SR * 0.6))])[:n]
    return (rumble + creak) * envv * 0.7


def sfx_victory():
    parts = []
    for m, d in [(60, 0.18), (64, 0.18), (67, 0.18), (72, 0.28), (76, 0.55)]:
        parts.append(tone(note(m), d, amp=0.5, harmonics=(1, 0.5, 0.3, 0.15)))
    s = np.concatenate(parts)
    delay = int(SR * 0.12)
    rev = np.zeros_like(s); rev[delay:] = s[:-delay] * 0.35
    return (s + rev) * 0.8


def sfx_gameover():
    parts = []
    for m, d in [(64, 0.3), (60, 0.3), (55, 0.4), (48, 0.9)]:
        parts.append(tone(note(m), d, amp=0.45, harmonics=(1, 0.4, 0.2)))
    return np.concatenate(parts) * 0.85


def sfx_heart():
    n = int(SR * 0.35)
    t = np.linspace(0, 0.35, n)
    f = np.linspace(600, 180, n)
    return np.sin(2 * math.pi * np.cumsum(f) / SR) * np.exp(-np.linspace(0, 7, n)) * 0.55


def sfx_click():
    n = int(SR * 0.08)
    t = np.linspace(0, 0.08, n)
    return (np.sin(2 * math.pi * 880 * t) + 0.4 * np.sin(2 * math.pi * 1320 * t)) \
        * np.exp(-np.linspace(0, 25, n)) * 0.4


if __name__ == '__main__':
    save('theme', build_theme())
    save('battle', build_battle())
    save('sword', sfx_sword())
    save('correct', sfx_correct())
    save('wrong', sfx_wrong())
    save('door', sfx_door())
    save('victory', sfx_victory())
    save('gameover', sfx_gameover())
    save('heart-lost', sfx_heart())
    save('click', sfx_click())
    print('Аудио дайын:', OUT)
