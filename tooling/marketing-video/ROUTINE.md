# Daily Macro feature video (weekday routine)

You are making today's short Macro feature video(s) plus X copy, and delivering them to the
Macro DM with Austin Barrón and Julia Westphal (channel id `019d9cc0-d5af-714d-9e63-18eed7907d4a`).
Work at extra-high effort: think carefully at every step, check your own work visually, and
don't ship anything you haven't looked at.

## 0. Setup
- Repo: `macro-inc/macro`. The toolkit is in `tooling/marketing-video/` on `main`. If it isn't
  on main yet, check that folder out from branch `claude/eager-feynman-ajchmq`
  (`git fetch origin claude/eager-feynman-ajchmq && git checkout origin/claude/eager-feynman-ajchmq -- tooling/marketing-video`).
- Read `tooling/marketing-video/PROMPT.md` in full. It is the spec: brand, real components,
  formats, timing, music and build rules. `trailer.html` is the reference implementation.
- Tools: `pip install numpy scipy imageio-ffmpeg pillow matplotlib`. Use imageio-ffmpeg's
  binary as `FF` (it has tmix and libx264). Playwright and Chromium are preinstalled
  (`/opt/node22/lib/node_modules/playwright`). For styling, `git fetch origin codex/marketing-homepage`
  (the new site: `apps/web/marketing`); if that branch has been merged, use main.

## 1. Pick what to highlight
- Read what shipped on `main` in the last 3 days (`git log origin/main --since="3 days ago"`,
  merged PR titles and diffs). Prefer a user-visible feature you can show in 10–25 s.
- If nothing recent is interesting enough, pick one specific Macro capability instead.
  Specific means things like: copying calendar availability into an email, @mentioning a task in
  a channel, a task linked to its GitHub PR, the Cursor integration on Home, connecting
  and importing Linear, or AI drafting an email from a Macro call transcript. Never pick something generic like "Macro is fast".
- Check the last ~15 messages in the DM (`ReadChannelMessages`) and don't repeat a recent topic.
- Decide on either one video (an OP) or a thread of 2–3 videos, each with its own post.
  Make a thread only when the feature really has 2–3 distinct beats.
- Before designing, read the real components for the feature in `apps/web/src` (and their
  recreations on the marketing site). Everything on screen must be grounded in them.

## 2. Vibe for today (America/New_York weekday)
- Mon / Wed / Fri: ambient (electronic, mysterious, about 80 BPM).
- Tue / Thu: funk (drum-focused, restless, about 110 BPM).
- One vibe per video. Pick a fresh matching Mixkit track, or reuse the defaults in PROMPT.md.
  Measure tempo and downbeats, and check them against the waveform.

## 3. Build
- Write a new HTML scene per video, reusing the engine from `trailer.html`: seek(t) is a pure
  function of time, springs, the camera, the cursor, labels, the music-driven `MUSIC`/`B(step)` map, and sound cues.
- Vary the opening. The first slide has no label text. Loop seamlessly.
- Render stills (one per step) in 1:1, 9:16 and 16:9. Inspect them and fix anything early,
  cramped, off-grid, unreadable or off-brand. Iterate until it's clean.
- Run `purity.mjs` (t=0, t=T and t=2T must hash identically) and `probe.mjs`.
- Build the audio, render (4 subframes, 180° shutter, tmix) and encode 1:1 (1440×1440),
  9:16 (1080×1920) and 16:9 (1920×1080) MP4s.
- Extract a few frames from each final MP4 and look at them.

## 4. X copy
Technical voice: plain and specific about what the feature does and how. No hype, at most one
hashtag, integrations named exactly. For a thread, number the posts and say which video goes with each.

## 5. Deliver
1. Try to upload the MP4s to Macro (`UploadFile`). The tool takes the file inline as base64,
   so if a file is too large to pass that way, don't invent or truncate bytes.
2. Also attach every MP4 to this session with `SendUserFile`.
3. Post one message to the DM (`SendChannelMessage`, channel above) with:
   - the topic, and why it was picked (the PR, if any)
   - the vibe and track name (Mixkit)
   - the uploaded Macro files if the upload worked. Otherwise, a link to this Claude session
     (`https://claude.ai/code/<session_id>`, from `get_session`), where the MP4s are attached.
   - the X copy (the OP, or the numbered thread)
Don't push to any repo and don't open PRs.
