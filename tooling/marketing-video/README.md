# Macro trailer

A 28-second, 1440×1440, 60 fps loop. It's entirely code: one HTML file, no After Effects.
One shape morphs through Macro's product without a cut. A cursor drives every
change on a 120 BPM grid: 28 steps, one every other beat (14 bars), so each moment has room to land.

- `VIBE=ambient|funk OUT=name ./build.sh` renders one single-vibe cut (1440 master and 1080)
- `mobile.html` + `mbuild.sh`: the Macro for iPhone ad (9:16, 1:1, 16:9 from one scene; `FMT=916|11|169`), X copy in `macro-mobile-X.md`
- `mobile2.html`: the mobile tour (liquid-glass dock intro, then Calendar, Email, More → Agents / Tasks / CRM, Team chat → @Macro → doc → task + PR). Build with `PAGE=mobile2.html OUT=macro-mobile-tour ./mbuild.sh`; Phosphor glyphs in `phx.js`
- `platform.html`: the macro.com launch ad (mark + wordmark, "A single platform for your company.", then Email, Chat, Docs, Spreadsheets, Databases, Pull requests and Coding agents on one beat each, gathering around the mark). `FMT=916|45|11`; build with `PAGE=platform.html OUT=macro-platform FMTS="916 45 11" ./mbuild.sh`
- `launch.html`: the cream launch ad (92 beats at 100 BPM, 55 s). It opens on the leading Meta creative, "Notion wasn't built like Macro" (headline, lockup, the posed Home window and its callouts), then the unified-workspace orbit (a thumb taps Macro and the apps fold in), the platform cut on the drop (each surface arrives differently), a seven-slide carousel (Email, Docs, Tasks, Calls, CRM, Calendar, Agents), and "Replace 27+ apps with a single system." People drive it: a thumb (touch indicator) swipes rows and slides with real release velocity, and a cursor aims with overshoot, correction and tremor; every slide change is a different gesture. The song is cut on its own structure (build-up, drop, filter-down into the breakdown, riser, second drop, a breath before the end-card hit) with synthesized impacts, crashes and risers in `audio/mix.py` (`MUSIC` entries take `lpEnd` and `gapEnd`; a peak limiter keeps the hits loud). Cream palette from `apps/marketing` (`cream-preview.css`). `FMT=916|45|11`; build with `PAGE=launch.html OUT=macro-launch-cream FF=/path/to/ffmpeg ./lbuild.sh`, which pipes subframes straight into ffmpeg segments (`render.mjs segments`) instead of writing ~20 GB of frames. `node sweep.mjs out.png 8 <beats…>` makes a contact sheet of any beat positions; extra Phosphor glyphs are in `phx2.js`
- `flow.html`: v3 of the cream ad, built to test against the Meta data. Frame 0 is the winning creative itself ("Notion wasn't built like Macro"); its callout lines start to flow, the thumb taps Calendar, and on the drop the Calendar line runs down into a diagram that tells one connected story in the creative's own language (hairlines, diamonds, labels): a demo call's transcript marks "six of us", "send pricing" and "Thursday", and connectors carry each one into the CRM, a task and the calendar; an agent picks up all of that context and drafts the follow-up; the team picks it up in #deals and a rollout doc; you add a line, open the draft's sources, and press Send on the second drop; pulses run back and every surface syncs. The camera pulls out to the whole labeled diagram, it folds into one shared context around the mark, and the end card gives the price ($40 a seat), the CTA and proof (a16z, SOC 2 Type II and ISO 27001, open source). `?cut=full|30|15` (48, 26.4 and 14.4 s) and `?hook=notion|slack|replace` (the opener). Everything after 5.4 s is the same for every opener, so `fbuild.sh` renders that tail once per cut and format and only the first 5.4 s per opener (`render.mjs segments` takes `FROM`/`TO`; every tool takes extra page params in `QS`, e.g. `QS="&cut=30&hook=slack"`). Build with `FF=/path/to/ffmpeg ./fbuild.sh` (`CUTS`, `HOOKS`, `FMTS` narrow it); outputs are `macro-flow-<cut>-<hook>-<fmt>.mp4`. The call feeds in `img/` come from `solid-site/src/assets/calls`
- `blocks.html`: the block ads (4:5, 9:16 and 1:1, 14.4 s each). Macro's modules are primary-colored blocks (red, yellow, blue, white, ink) on an off-white table, still in Inter and Roboto Slab. They snap together into one system: a 3×3 grid of eight modules (Calls, CRM, Tasks, Calendar, Agents, Email, Chat, Docs) that locks around the ink Macro core on the downbeat of bar 5 (beat 16), then shrinks into the end card's emblem (price, CTA keycap, proof). Every snap eases to a hover just short of its spot, snaps the last few px in, squashes along its approach, nudges its neighbors and flashes the seam. `?v=` picks the route to the system: `merge` ("Replace 27+ apps": a pile of 27 app tiles sorts itself into the eight cells, then each cell's tiles snap into a little bento and fuse into its module), `chain` ("One call updates everything": the camera follows the call block by block while tokens carry each change across the seams: the CRM stage, a task, the onboarding event, the agent's draft, Send, #deals, the rollout doc) and `fit` ("Your tools weren't built to fit together": two grey tools clunk tab against tab, then Macro's tabbed blocks drop in and click). The sound is all synthesized in `audio/bmix.py`, with no music file: a soft 100 BPM bed in F (felt kick, shaker, sub bass, an FM electric piano, a pad) sits 7 dB under close, dry foley. Each contact has a tuned body (bigger blocks sound lower, and snaps climb an F major pentatonic as the system fills), its loudest sample lands on its cue, and it is panned to where the block lands. A true-peak limiter brings the mix to −16 LUFS under −1 dBTP. Build with `FF=/path/to/ffmpeg ./bbuild.sh` (`VARIANTS`, `FMTS` narrow it); outputs are `macro-blocks-<variant>-<fmt>.mp4`
- `explainer.html`: the long-form explainer for YouTube and for prospects after a demo (16:9, 81.6 s, led by a voiceover). It opens the way the ads and the site do: 27 tools pop up in their own colors (`logos27.js`: SVG Logos and Simple Icons, both CC0) while a counter climbs to 27; a teammate and an agent hop between them on dashed trails and lose the thread; the logos fly into eleven module discs around the mark ("That's Macro"), and a price card adds up Notion, Slack, Linear and Superhuman ($84 a seat, the prices in `apps/marketing`'s savings calculator) against Macro's $40. The ring unfolds into a blueprint of the whole system, and the camera follows one demo call through it, filling each slot as the voice gets there: the call is recorded, transcribed and summarized into a team-memory rail; an agent reads the transcript, the CRM record and the email history, then updates the deal, creates tasks, proposes the onboarding and drafts the reply; you add a P.S. and send; the tasks reach a teammate's inbox; a mention shares the rollout plan with the channel; search finds all of it in under 50 ms; Claude Code, Codex and Cursor connect through the MCP server. It folds back into the ring and ends on "Replace 27+ apps with a single system.", the price, CTA and proof. Every beat is timed to the voiceover's words: `vo/script.json` holds the lines and `vo/plan.json` their starts; `vo/tts.py` speaks them with Kokoro-82M (voice `af_heart`, Apache-2.0); `vo/build_vo.py` places them, times every word with faster-whisper (`small.en`, MIT) and writes `explainer-vo.js`, which the scene reads through `vw(line, word)`, plus `explainer.srt` captions. To retime, move a line's start in `vo/plan.json` and rebuild; to use a recorded voice, put one wav per line in `vo/lines/<voice>-<speed>/` and name that voice in the plan. `audio/emix.py` mixes voice first: every line at the same loudness, the music bed about 16 dB under it while it speaks (ducked with look-ahead, its presence band dipped), −14 LUFS with true peaks under −1 dBTP. `?thumb=logos` renders the YouTube thumbnail (the 27 tools) and `?thumb=1` a second one (the finished flowchart). Build with `PY=/venv/python VO_MODELS=/path/to/models FF=/path/to/ffmpeg ./ebuild.sh` (models below); YouTube copy and chapters are in `explainer-youtube.md`
- `snipe2.html`: the juiced cut of the snipe ad (a gun with recoil, tracers and casings; double taps that shatter each tile into shards with fire, sparks, smoke and shockwaves; trauma screenshake; Macro slams in). Same build with `PAGE=snipe2.html`
- `snipe.html`: "Too many apps." A scope snipes eight app tiles on the beat, then Macro drops in: "One system. Not a bunch of siloed apps." Full-color logos from Iconify's `logos` set in `applogos.js`. Build with `PAGE=snipe.html OUT=macro-snipe FMTS="916 45 11" ./mbuild.sh`
- `PROMPT.md`: the template for new feature videos; `ROUTINE.md`: the weekday routine
- `trailer.html`: the source. Open it in a browser to watch it play live; click to start the audio.
  Add `?t=7.25` to freeze on any time. If your browser blocks fonts over `file://`, run `npx serve .`
  and open it from there.

## Look and components

Styled like macro.com: black canvas with the hero's concentric rings, dark `--b` cards with the
site's hairline edges, Inter for UI, and white pill buttons like the site CTA. Nested corners are concentric (outer radius = inner radius + inset).
Each UI piece is modeled on a real component:

| In the trailer | Source |
|---|---|
| Home feed ("Last few minutes") | `HomeAppPreview` on the site / the app's Home |
| Mentions menu (People / Documents, Agents, & Tasks, "Agent" badge) | `apps/web/.../menu/MentionsMenu/MentionsMenu.tsx`, `MentionsMenuItem.tsx` |
| `@Macro` pill, doc reference (violet file icon + underline) | `UserMention` / `DocumentMention`, as in the site's `EmailGraphics` compose scene |
| Chat bubbles | the site's "Email and chat" section |
| Command menu with `G then E` hints | `apps/web/src/features/command/CommandItem.tsx`, `CommandMenuPrimitives.tsx` |
| Icons, task status circles | `solid-site/src/assets/icons` (`wide-*`, `square-task-*`, Phosphor), inlined in `icons.js` |

`trailer-light.html` is the first, light-canvas version.

## Step grid (120 BPM, one step every 2 beats = 1 s)

| Steps | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| 1 · Button | Get Macro, cursor lands | click | → loader | → Macro disc, logo drawn piece by piece |
| 2 · Home | email row lands | channel row lands | task row lands | click Done (E), row collapses |
| 3 · Channel | → #launch thread | "@mac" opens and filters the mentions menu | Enter → @Macro pill | send |
| 4 · Agent → doc | Macro thinking dots | → "Drafted Q3 launch plan" reference | click → doc opens | lines write themselves |
| 5 · Splits | grab the doc's edge | drag, #launch slides in | past max, rubber band | release, springs to 50/50 |
| 6 · Task | "Press kit" → task card | → In progress (liquid indicator) | → Done (accent, check) | assignee + due date pop |
| 7 · ⌘K → loop | → ⌘K key → command menu | type "sh", list filters | Enter → toast | toast → Get Macro (= frame 1) |

## How it's built

- `seek(t)` computes every style from time alone: no CSS transitions, no timers, no state
  carried between frames. Rendering t=0, t=T and t=2T in any order gives identical pixels.
- Springs are closed-form step responses. A value that changes target many times is the
  sum of one spring per change, counted in both this loop and the previous one. That makes
  every property periodic, so the last frame flows into the first with position and velocity
  matching, cursor included.
- The camera follows a fine staircase of its target through a spring. The result is still a
  pure function of time, and the camera leads the drag slightly so the pane stays in frame.
- The status indicator's edges ride different springs, so the leading edge runs ahead and the
  pill squashes slightly as it stretches.
- The split drag is direct manipulation. While held, the pane width is the cursor's offset from
  the grab point, with a rubber band past max. On release it springs back using the measured
  release velocity.
- Motion blur: Playwright renders 4 subframes per frame (180° shutter), and ffmpeg `tmix` blends them.
  The cursor also gets a speed-scaled directional blur, so its fastest flick smears instead of strobing.

## Audio

- Music: **"Swish Swed" by Arulo** (Mixkit, Mixkit Stock Music Free License, OK for commercial video).
  numpy measured it at exactly 120.000 BPM. The excerpt starts on the drop's downbeat
  (kick onset at 40.032 s) and runs exactly 56 beats (14 bars).
- UI sounds (clicks, keys, ticks, pops, chime, swooshes) are synthesized in `audio/mix.py`.
  Each is placed by its measured peak, so its loudest sample lands on its cue. Master is
  −15 LUFS / −1 dBTP.

## Rebuild

```sh
FF=/path/to/ffmpeg WORKERS=4 ./build.sh
```

This needs Node with Playwright (`npm i playwright`, plus Chromium), Python 3 with numpy, and an ffmpeg build
that has `tmix` and `libx264`. `probe.mjs` checks loop continuity; `purity.mjs` checks that frames are order-independent.
Stills for review: `node render.mjs stills stills/review 0.45 1.45 2.45` (arguments are beat positions).

## Voiceover models (explainer)

```sh
python3 -m venv /tmp/vo && /tmp/vo/bin/pip install kokoro-onnx soundfile faster-whisper scipy
mkdir -p vo/models/kokoro vo/models/whisper-small.en
curl -L -o vo/models/kokoro/kokoro-v1.0.onnx https://huggingface.co/fastrtc/kokoro-onnx/resolve/main/kokoro-v1.0.onnx
curl -L -o vo/models/kokoro/voices-v1.0.bin https://huggingface.co/fastrtc/kokoro-onnx/resolve/main/voices-v1.0.bin
for f in config.json model.bin tokenizer.json vocabulary.txt; do
  curl -L -o vo/models/whisper-small.en/$f https://huggingface.co/Systran/faster-whisper-small.en/resolve/main/$f
done
PY=/tmp/vo/bin/python FF=/path/to/ffmpeg ./ebuild.sh
```

`vo/asr.py file.wav` transcribes any render back to text: a quick check that a synthetic voice says what the
script says, and that the voice still reads clearly over the music in the final mix.
