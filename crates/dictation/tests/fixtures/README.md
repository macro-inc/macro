# Dictation media fixtures

These fixtures contain generated tones or silence, with no recorded speech.
They exercise container parsing, including Opus and fragmented MP4, without
requiring a codec decoder, FFmpeg, a microphone, or elapsed-time waits in tests.

Generate each `tone` file with FFmpeg using this input:

```sh
ffmpeg -f lavfi -i 'sine=frequency=440:sample_rate=16000:duration=0.1' ...
```

Output options:

| File | Options |
| --- | --- |
| `tone.webm` | `-c:a libopus tone.webm` |
| `tone.ogg` | `-c:a libopus tone.ogg` |
| `tone.mp4` | `-c:a aac -movflags frag_keyframe+empty_moov+default_base_moof tone.mp4` |
| `tone.wav` | `-c:a pcm_s16le tone.wav` |

The duration-limit fixture is generated with:

```sh
ffmpeg -f lavfi -i 'anullsrc=r=16000:cl=mono' -t 301 -c:a libopus long.ogg
```

`chrome.webm` was captured in Chromium 152 using the production `AudioRecorder`,
with a Web Audio oscillator connected to a `MediaStreamAudioDestinationNode`
instead of a microphone. It uses WebM/Opus at 64 kbit/s and stops after the first
`dataavailable` event. Unlike the FFmpeg fixture, its container has no declared
duration or packet durations; the inspector must read packet timestamps and
Opus framing. FFprobe reports four 60 ms packets, with the last starting at
180 ms, for a total of 240 ms.


