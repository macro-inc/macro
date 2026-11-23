# Screen: the browser the agent shares from

Chromium on a virtual display, drivable over CDP, with raw frames of the display for whoever
wants them. `systemd/agent-screen.service` runs `bin/agent serveScreen`. Its profile is never
signed in to anything: whatever it shows can end up on a call and in its recordings.

| File                           | What it holds                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `config.ts`                    | Every setting: display, port, size, programs by name, paths.                                               |
| `screen.ts`                    | What to run (argv, environment, fonts), the service loop, status, and cutting frames. Pure, or over ports. |
| `measure.ts`                   | The stamp a page draws and a reader decodes, the summary, and the measurement over ports.                  |
| `context.ts`, `context/cdp.ts` | The real ports: spawning, the process table, and the CDP client.                                           |
| `index.ts`                     | `serveScreen`, `screenStatus`, `measureScreen`.                                                            |

It needs no credential. It needs the programs the flake's shell puts on PATH (`Xvfb`, `chromium`,
`ffmpeg-x11grab`, `pulseaudio`, `parec`) and runs only as its own service: nothing in a wake
starts it, so an agent that never shares a screen never runs it.

## Reaching it

- **Display `:96`, CDP `http://127.0.0.1:9335`**, loopback only (`config.ts`).
- **Drive:** any CDP client (`context/cdp.ts` here, or Playwright's `connectOverCDP`). A new or
  front tab is what the display shows (`Page.bringToFront`). Kiosk mode: no tab strip or URL bar
  on screen.
- **Frames:** `screen.capture()` in the context. `frames()` yields I420, 1920x1080, for
  `new VideoFrame(frame, width, height, VideoBufferType.I420)`. The buffer is reused, so it's done
  with before the next one. Capture runs only while someone reads; `stop()` ends it.
- `screenStatus` says if it's up. `measureScreen` is the check after any change: healthy at
  1080p30 is 30 frames a second delivered and distinct, and a p50 latency around 50-65 ms.
- The profile (`state/private/screen/profile`) has no logins and stays that way: signing it into
  anything puts that account on the shared screen. It persists, so a login would stick.
- **Sound:** Xvfb has no audio, so `serveScreen` also runs a private PulseAudio (no config of its
  own, socket `state/run/screen/sound/native`) with one null sink, `share`. Chromium plays into it
  (`PULSE_SERVER`); `recordArgv` is `parec` on `share.monitor`, s16le 48 kHz stereo. Nothing
  plays on the machine's speakers, and the user's own sound server, if any, is never touched.
- Any local process can drive it or read its display. Nothing leaves the machine.
- `serveScreen` starts Xvfb and the sound server, then Chromium on both, and starts all three
  again when any dies, until SIGTERM. It writes `up`, `died` and `stopped` to the `screen` log
  stream.

## Choices

- **x11grab, not CDP screencast, for the display.** Screencast needs no display, but costs
  several times the CPU in Chromium, is lossy JPEG the reader must decode, stops at the tab, and
  delivers only on damage. Sharing one tab into a call uses screencast anyway, for the reason
  under "Sharing it into a call".
- **Programs from the flake's shell, by name.** Nothing here holds a store path, so there are no
  GC roots to take. `ffmpeg-x11grab` is `ffmpeg-full` under its own name: `ffmpeg` and
  `ffmpeg-headless` are built without x11grab, and `ffmpeg` stays the headless one for calls.
- **Self-hosted, not a hosted browser.** Hosted browser services offer viewers and replays, not
  live frames for your own code, and each adds a network hop.
- **Software compositing, SwiftShader only for WebGL.** GPU raster through SwiftShader costs many
  cores and drops frames. The flags in `chromiumArgv` give WebGL2 at software-compositing cost.
  Real WebGL pages will be slow: there's no GPU.

## Non-obvious

- **A blocked pipe doesn't slow ffmpeg.** Behind a slow reader it queues seconds of old frames,
  and Bun's stream buffers more on top. So `latestFrames` always drains and yields only the
  newest: falling behind costs frames, not latency. It runs on the reader's JS thread, so a
  stalled thread still queues: don't read frames on a call's thread; use a Worker or a child
  process.
- **`LD_LIBRARY_PATH` kills nix binaries.** The flake's shell sets one for LiveKit; Chromium and
  ffmpeg then die on a glibc mismatch. `cleanEnv` strips it from everything started here.
- **With no window manager**, a window sized to fit exactly comes out 1 px short and shows a
  black edge. The window is 1 px over.
- **The system's fonts draw CJK and emoji as boxes.** The flake sets `AGENT_SCREEN_FONTS` to pinned
  Noto CJK and emoji, added through a fontconfig that includes the system's.
- **Chromium rewrites its process title**, so `/proc/<pid>/cmdline` is one string: processes are
  matched on text, not argv.
- **A display can be taken with no lock file to show it.** A container on the host's network
  holds its display as an abstract socket, and its `/tmp` isn't ours. Xvfb then exits with
  "server already running". `serveScreen` logs the exit and tries again; the fix is another
  display in `config.ts`.
- **zod 4's `z.unknown()` is a required key.** The CDP message schema's fields are optional, or
  every reply without a `params` would be dropped and its command would wait forever.

## Sharing it into a call

The code is in the calls area (`calls/share*.ts`, `calls/context/share*.ts`), and its rules are
in that area's design note. What this area guarantees it: a share opens a new browser context on
this browser, disposed after, so nothing persists and nothing is signed in, and there is no code
path to the desktop.

**Screencast, not x11grab, for a share.** A new context opens its own window, and x11grab shows
whatever's on top. Screencast is the one tab by construction. It sends only on damage, so a
static page gets one frame: `everyNthFrame` above 1 yields nothing, ever. The rate comes from
delaying the ack, and the worker re-sends the newest JPEG at the target fps so the track stays
alive.

**The decoder doesn't probe.** With ffmpeg's defaults the first frame comes out seconds after
the first JPEG goes in, and publishing waits for a first frame. `-probesize 32 -analyzeduration
0 -fflags nobuffer` brings it under a second.
