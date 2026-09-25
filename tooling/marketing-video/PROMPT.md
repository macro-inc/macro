# Macro feature video: prompt template (draft)

Use this to make one short, code-rendered motion video about one Macro feature.
The toolkit is in this folder: `trailer.html` is the reference implementation;
copy its engine and change the story. Nothing is made in After Effects.

<inputs>
- FEATURE: one specific Macro capability. Pick something narrow and concrete, e.g.
  "copy your calendar availability into an email", "@mention a task in a channel",
  "a task linked to its GitHub PR", "import from Linear", "draft an email from a call transcript".
- STORY: the 6–12 UI states that show it, in order, driven by a cursor and keyboard.
- LABELS: 2–5 short feature labels (1–3 words, e.g. "Team chat", "Tasks", "Docs").
</inputs>

<brand>
Match the marketing homepage (`apps/web/marketing` on `codex/marketing-homepage`,
styles in `src/styles/dark-theme.css`, `site-ui.css`, `features/marketing/components/*.css`):
- Canvas: pure black with the hero's faint concentric rings and a barely-there center bloom.
- Surfaces: dark cards `oklch(0.17 0.002 250)` (the `homepage-email-surface` recipe: its
  135° lit 1px rim and a `0 10px 40px -8px #0004` shadow). Bubbles, menus and composers use
  the glass rim (specular at the upper-left, soft at the lower-right). Shadows stay subtle.
- Accent is blue, `oklch(0.7 0.12 250)`. Never orange. Doc references use the violet doc hue.
- Type: Inter for all UI; Roboto Slab (light, about 330 weight, -0.035em) only for feature labels.
- CTA: a white pill with the Macro mark and "Get Macro", black text.
- Icons: only Macro's own set (`icons.js`, from the site's `assets/icons`: `wide-*`,
  `square-task-*`, Phosphor). One stroke weight. If an icon relies on app CSS to render,
  replace it with an equivalent that renders on its own.
</brand>

<components>
Build every piece from a real component, reading the source before drawing it:
- Mentions menu: `apps/web/src/lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/`
  (w-96, glass, rounded-xl, section labels, rows p-1.5 mx-1.5 rounded-md, the "Agent" badge).
- Inline mentions: person or agent in the blue accent, underlined. Doc references are the
  violet file icon plus an underlined label (`DocumentMention`).
- Chat: `UserMessageBubble` (rounded-3xl, a depth-3 surface), with the name above and the avatar outside.
- Composer: a fully rounded pill with the paperclip, the text, a mic, and a round send button (white when armed).
- Command menu: `features/command/CommandItem.tsx` (a 20px icon slot, "G then E" key hints, a footer).
- Tasks: the status circles (`square-task-*-circle`) and the real property chips.
- Home feed, calendar, email compose, CRM and so on: find the component or its site recreation first.
Nested corners must be concentric: outer radius = inner radius + inset.
Use believable content with the team's names (Julia, Jacob, Austin, Dana). Never use real customer data.
</components>

<direction>
One shape, never cut: every state is the same element morphing its size, radius and color
while its content swaps with a short blur (separate exit and enter timing, so text never overlaps).
A cursor drives every change with real clicks and drags. Springs everywhere, with a tiny overshoot at most.
The camera zooms so each state fills the frame and leaves room under the label.
The first frame (the Get Macro pill) has no text beyond the button. The last frame is the first frame.
Pacing: roughly 0.6–0.8 s per step, with holds on the moment that explains the feature.
Viewers on Instagram aren't reading the UI, so the label must say what's happening.
A container may grow as content arrives but never shrinks and regrows. Menus overflow their
container instead of resizing it.
Banned: bouncy easing, particle bursts, glows, gradients on UI chrome, mismatched icon strokes,
dead time, orange, fake-looking UI, anything that looks like a template.
</direction>

<music>
Alternate two Mixkit tracks (Free License): an electronic, ambient, mysterious one (~80 BPM,
default "Kodama Night Town", Mixkit 114) and a drum-focused, funky, restless one (~110 BPM,
default "Are U Ready For This?", Mixkit 1127). Sections are whole bars. Each song resumes where
it left off, cuts land on downbeats, and there's no fade at the end. Measure tempo and downbeats with
numpy (`audio/analyze.py`, `structure.py`) and check the waveform against the grid by eye.
Keep the synthesized click, key, pop and whoosh sounds, each placed by its measured peak.
Master to about −15 LUFS and −1 dBTP.
</music>

<build>
1. One HTML file, 1440×1440. Every style is computed from time inside seek(t), with no
   CSS transitions, timers or state carried between frames. Story steps map to music
   beats through `MUSIC`/`B(step)`.
2. Springs are closed-form step responses. A value that changes target many times is the sum
   of one spring per change, counted in both this loop and the previous one, so the loop is seamless.
3. Drags are direct manipulation with a rubber band. On release they spring back using the release velocity.
4. Render with Playwright: 4 subframes per frame at a 180° shutter, blended with ffmpeg tmix at 60 fps.
   The fastest-moving cursor also gets a speed-scaled directional blur.
5. Before the full render, render one still per step and fix anything early, cramped,
   off-grid or unreadable. Run `purity.mjs` and `probe.mjs`: t=0, t=T and t=2T must hash identically.
6. Deliver the 1440 master and a 1080 cut.
</build>

<gotchas>
Never put will-change on anything the camera scales. Elements outside the shape (menus, labels)
must be hidden explicitly every frame, or they leak state between frames. An element with no exit
time must not be checked against the previous loop.
</gotchas>
