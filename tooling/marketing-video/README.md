# Macro trailer

A 28-second, 1440×1440, 60 fps loop. It's entirely code: one HTML file, no After Effects.
One shape morphs through Macro's product without a cut. A cursor drives every
change on a 120 BPM grid: 28 steps, one every other beat (14 bars), so each moment has room to land.

- `VIBE=ambient|funk OUT=name ./build.sh` renders one single-vibe cut (1440 master and 1080)
- `mobile.html` + `mbuild.sh`: the Macro for iPhone ad (9:16, 1:1, 16:9 from one scene; `FMT=916|11|169`), X copy in `macro-mobile-X.md`
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
