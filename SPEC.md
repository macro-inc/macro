# SPEC: see (and take over) what an agent teammate is doing

Bead `mac-teammate-e2e.15`. Draft, research only, nothing built. Fixes QA **B7** (the agent's desktop runs on
Xvnc `127.0.0.1:5901` in the guest, but the owner can't see it). Builds on `/home/wolf/tmp/agent-screen/`
(`tech/RECOMMENDATION.md`, `design/`) and the Macro
[transport draft](https://macro.com/app/md/01a1f585-e38b-713f-ba22-79134cb3c573). Facts are checked on `main` at
`bb14f607cef`, with file references under **Details**.

## What we build

The agent can share one of two surfaces, and picks the one that fits:

| Surface | What people see | In calls | In the "View screen" panel |
| --- | --- | --- | --- |
| **Desktop** | The agent's own virtual desktop `:1`: every window, dialog and app, plus its signed-in browser | **Already shipped** in `packages/starter-agent`: x11grab on `:1` → LiveKit screen share | **New:** VNC/RFB through the harness → noVNC |
| **Tab** | One browser tab in a clean, signed-out browser context, with the URL blocklist enforced at the wire | **Add:** port the CDP screencast share from the older `agent-teammates/` template | Not in v1 (D8) |

Never the desktop of the person who owns the agent: only the agent's computer, display `:1`.

A correction to the brief: on hosted agents the call share **already is the desktop**, not a CDP tab
(`packages/starter-agent/behavior/capabilities/calls/DESIGN.md` "Showing the screen"). The tab-only CDP screencast
exists only in `agent-teammates/starter-agent`, which is outside the workspace. "Support both" therefore means
adding the tab mode to the hosted template, not adding a desktop mode to calls.

**Rules for both surfaces**
- The viewer always says which surface is shown ("Scout's tab: example.com" or "Scout's desktop"). People who
  may watch can **stop** the share or **switch** it to the other surface.
- A visible share indicator: a live dot in the DM header or call tile, plus a line written by code, not by the
  model ("Scout is sharing its desktop" / "Stopped sharing").
- **Watching** needs `View` on the agent's computer, which today means every member of its team. **Driving** needs
  `Manage` (team owner or admin) and a driver lease. Driving is desktop only. See D1.
- No silent thumbnails: a channel never shows screen contents to anyone who may not watch. A chip shows a
  thumbnail only to people who may watch, and only while a share is live.
- Audit rows for every watch, drive and share, always on. No video recording in v1.

**How the agent picks a surface** (the rule is in code and written into the agent's tool description):
1. A person opens **View screen** → **desktop**. The person chose, and the agent is not asked.
2. A person must act on the agent's computer (sign-in code, CAPTCHA, a fix) → **desktop**, with "Take over"
   offered.
3. In a call, showing a web page that needs no sign-in and passes the blocklist → **tab**.
4. In a call, showing anything else (a non-browser app, a dialog, a file picker, several windows, the agent's
   signed-in session) → **desktop**, under the extra call rules in D9.
5. Unsure → **tab** in a call, **desktop** outside one. Outside a call there is no tab surface in v1 (D8).

**User flow**

```
Profile / DM header ── View screen ──┐
Agent's chip "Watch my screen" ──────┤
                                     ▼
              ┌──────── side panel (pop-out ⤢) ────────┐
              │ ● Live · Scout's desktop   [Switch][Stop]│
              │ ┌─────────────────────────────────────┐ │
              │ │   noVNC, view-only                   │ │
              │ └─────────────────────────────────────┘ │
              │ [Take over]        (owner/admin only)    │
              └──────────────┬─────────────────────────┘
                     Take over│  agent's tool calls held, frame amber,
                              │  "Wolf is driving" for everyone
                              ▼
                   Hand back (button / hold Esc / 2 min idle)
                   → agent gets note + fresh screenshot, resumes

In a call: agent shares   tab ⇄ desktop   (call tile shows which; Stop)
```

**Phases**

| # | Ships | Main change |
| --- | --- | --- |
| 1 | View screen (member card, DM header, Machines row), side panel, view-only, phone watch + take-over, audit | harness screen WebSocket over `Fleet::exec` socat, noVNC panel |
| 2 | Take over / Hand back, driver lease, agent held | harness lease + held tool calls (D7) |
| 3 | Agent's "Watch my screen" chip, surface label + Switch/Stop | agent tool, chip attachment |
| 4 | Tab mode in calls, tab ⇄ desktop switch, D9 participant rule | `packages/starter-agent` calls: add the CDP tab share next to the desktop share |

**v1 UI scope (Wolf, 2026-11-19).** The panel shows the screen and its title; the state (live, reconnecting,
paused, ended); the tab/desktop choice; Take over, Hand back, Stop and pop-out; the phone zoom, touch and keyboard
controls; and a minimal "Wolf is driving". It shows **no** transport, codec, resolution, fps, latency or bandwidth
stats or badges, and **no** watching/session activity list. Audit rows and enforcement on the server are unchanged;
only the user-facing feed is gone. The transport switch and benchmark numbers live only in a separate developer
comparison panel, off by default.

**UI approval (Wolf, 2026-11-19): design direction only, no transport chosen.** He reviewed the artifact at
https://wolf-macro-google.tailc6809.ts.net:41471/, pinned in the local repo `/home/wolf/tmp/teammate-e2e/screen-compare/ui`:
- `593cd75`: the version he saw, with the 27 screenshots in `shots/`.
- `1fd4444`: adds the screenshot he reviewed, `approval/wolf-review-screenshot.png`.
- `cae08dd`: the simplified v1 version he approved (32 fresh screenshots; the developer comparison panel opens with `?dev=1`).

His words: "we dont need the technical details or the discussion section for v1", then "anyways this sounds good".
All three real transports are built against this UI. Merge stays on hold until he has seen the measured comparison.

## Decisions for Wolf

- **D1 Who watches, who drives?** I recommend watch = `View` (every team member, as today) and drive = `Manage`
  (team owner and admins).
- **D2 Viewer placement:** a side panel plus a pop-out button (my recommendation), a theater modal, or a window
  of its own.
- **D3 Share chip:** I recommend phase 3. Phases 1 and 2 fix B7 without it.
- **D4 Live thumbnail in the chip** for people who may watch, or a static chip only?
- **D5 Recording:** none in v1. Later, take-overs only?
- **D6 Phone (decided by Wolf):** full take-over on phones in v1, no watch-only mode: pinch zoom and pan, Take over / Hand back, tap/drag/scroll, an on-screen keyboard. Same authorization and driver lease as desktop.
- **D7 Hold the agent while a human drives:** hold **all** of the agent's tool calls in the harness (my
  recommendation; one place, can't be bypassed from the guest), or a guest wrapper around the computer-use and
  CDP servers only (needs an image change, and the agent can still reach X through Bash).
- **D8 Tab surface outside calls?** I recommend no in v1. Today a tab can only be published into a call. Outside a
  call the desktop covers it.
- **D9 Desktop in a call (this is how it works today):** the agent's signed-in desktop already goes to everyone
  in the call, and a call can include guests. Anyone with view access on the call can mint a guest link, and
  `POST /call/meetings/join/{token}` admits the holder (see Details). The tab's safety rules (clean signed-out
  browser, blocklist) don't exist on the desktop. I recommend showing the desktop only when everyone in the call
  may `View` the computer. Otherwise the share falls back to the tab, and the agent says why.

- **D10 How phase 4 reaches existing agents:** template changes don't reach existing agents today. The options:
  (a) ship a one-time merge into existing agents' repositories, which can conflict with the agents' own edits;
  (b) wait for the pending "image carries the template" design, so the calls code comes with the computer image;
  (c) new agents only. I recommend (b) for the calls code. D9 is a safety rule, so if (b) is far off, do (a) for
  the D9 check alone. Phases 1-3 are harness and web changes and reach every agent at once.

## Acceptance checks

1. As a team owner on a local stack (Docker agent computer): View screen opens the panel, the desktop is live in
   under 3 s, and in view mode input changes nothing (`xdotool getmouselocation` in the guest stays the same).
2. As a non-member: no View screen entry, and a hand-made ticket gets 403. A replayed or expired ticket fails.
3. Take over: the agent's next tool call is held, typing into Mousepad works, Hand back resumes the agent with the
   note. Closing the tab hands back after 2 minutes.
4. Two viewers: both see the desktop, only the driver's input lands, and both see "Wolf is driving".
5. The panel and call tile always name the surface. Stop ends the share for everyone. Switch tab ⇄ desktop works
   in a call.
6. The chip shows no thumbnail to a channel member without `View`. After the share, the chip turns into an
   "ended" state.
7. Releasing or hibernating the computer closes the panel's socket with "asleep/off".
8. One trace from the ticket to the socket close (`computer.screen.*`), and the audit rows match.
9. `cargo test -p agent_harness_service` covers tickets and the RFB input gate. `packages/starter-agent` tests cover the
   surface-choice rule and the D9 fallback.

## Answered questions

- **Q3: the call worker sees `:1`.** The agent spawns `cli.ts joinCall` as its own child process.
  `macro-agent.service` uses `agentUnit`, which sets `inherit environment`, with `DISPLAY` from
  `desktopEnvironment` and `JoinsNamespaceOf = "macro-agent-display.service"`, so it shares the display's `/tmp`
  and X socket (`nix/macro-box/_agent.nix:151-153,229-249,389`). `ffmpeg-x11grab` is on the agent's PATH for
  exactly this (`_agent.nix:67-82`).
- **Q4: guests can join.** `POST /call/record/{call_id}/link` lets anyone with view access on the call mint a
  meeting link (`crates/call/src/inbound/axum_router/meetings.rs:259`, `CallAccessLevelExtractor<ViewAccessLevel>`).
  Agents' programs are refused (`refuse_program_link`). Anyone holding the link joins as a guest through
  `POST /call/meetings/join/{token}`. Hence D9.

---

# Details

## What runs in the guest

- `macro-agent-display`: `Xvnc :1 -rfbport 5901 -interface 127.0.0.1 -localhost -SecurityTypes None
  -AlwaysShared` (`nix/macro-box/_agent.nix:426`). It has no password, listens only inside the VM, and accepts
  several clients at once. The `macro` user's own display `:0`/5900 is a different display, and we never show it.
- Openbox, Chromium with CDP on `127.0.0.1:9223`, and the `computer-use-linux` MCP server with the X11 backend
  (`_agent.nix:140-146`), so the agent acts on the whole `:1` display. `ffmpeg-full` and `socat` are in the image.
  Nothing listens off the VM: each VM has its own netns, and nftables drops all inbound traffic.

## Desktop to the panel: transport

- **Hosted (recommended):** browser WSS → gateway → `agent_harness_service` → `Fleet::exec(computer,
  ["socat","STDIO","TCP:127.0.0.1:5901"])` → host agent mTLS `GET /v1/computers/{id}/exec` → vsock → guest. This
  path already exists: `ports.rs:683`, and the harness uses it to start harnessd (`computers.rs:744`). The
  harness acts as a websockify, and no guest or host change is needed. Later, a host-agent `stream` route can
  replace the socat exec with a fixed port allowlist {5901}.
- **Local / container:** `DockerFleet::exec` is `docker exec` as `macro` with stdin attached
  (`crates/hosted_runtimes/src/outbound/docker_fleet.rs:503,719`). The Docker agent image (`agentContainer`,
  `macro-box.nix:50`) runs the same `_agent.nix` units, so the same harness code works on a local stack and
  nothing needs to be published from the container. Machines people pair themselves (macrod on a laptop) are
  out of scope: we never show a person's desktop.
- **Rejected:** macrod's outbound WSS (needs a protocol change and a macrod release, needs a relay between
  replicas, and shares the ACP socket); WebRTC for the panel (needs a guest encoder and our own input injection,
  for a panel that VNC already serves).

## Calls: what exists and what to add

- **Desktop share, shipped in the hosted template** (`packages/starter-agent/behavior/capabilities/calls/share.ts`,
  `context/desktop.ts`, `context/share-frames.ts`, `DESIGN.md` "Showing the screen"):
  - Tools `share_screen(url?)` and `stop_share`.
  - `ffmpeg-x11grab` captures `DISPLAY` (`:1`, 1920×1080) and scales it to 720p at 10 fps, in a worker.
  - I420 `ScreenFrame`s go to the SDK `publishScreenShare` → `VideoSource` → `TrackSource.SOURCE_SCREENSHARE`
    (`packages/sdk/src/calls/node.ts:67-165`). libwebrtc in `@livekit/rtc-node` encodes them in software in the
    guest.
  - The desktop's sound goes out as screen-share audio.
  - "I'm sharing my screen" and "Stopped sharing" are said by code. The share is refused when the agent joined
    uninvited, and it stops with the call.
  - Passwords are pasted, never typed on screen.
- **Tab share, only in the older template** (`agent-teammates/muppet/.../calls/share.ts`,
  `agent-teammates/starter-agent/.../calls/context/share-browser.ts`):
  - CDP `Page.startScreencast` from a new signed-out browser context.
  - `Fetch.enable` checks the blocklist on every Document request at the wire.
  - JPEGs are decoded by ffmpeg to the same 1280×720 I420 frames, then the same `publishScreenShare`.
- **VNC does not go into calls, and doesn't need to.** The desktop already reaches calls by x11grab in the guest.
  Decoding RFB from Xvnc only to re-encode it would be strictly worse. The two paths stay separate: RFB for the
  panel, x11grab or screencast for calls. Neither is faster; the encode, track and lifecycle are the same.
- **To add (phase 4):**
  - Port the tab share into `packages/starter-agent` as a second mode of `share_screen`
    (`surface: "tab" | "desktop"`).
  - Apply the selection rule and the D9 participant check in code before the capture starts.
  - Switching = stop one publication and start the other on the same `SOURCE_SCREENSHARE`. One share at a time.
  - **Limitation:** `crates/agent_git` seeds a new agent's repository from the template once
    (`docs/design/agent-teammates.md:7,16`). After that the repository is the agent's own, and the agent edits it
    itself. The tab mode, the selection rule and the D9 check therefore reach **new agents only** (D10).
- **Server-side publish (rejected):** the harness would decode RFB and publish into LiveKit as its own
  participant. That adds a media service and a second identity, with no gain while the guest already publishes.

## Security details

- **Tickets:** `POST /computers/{id}/screen/tickets` → `authorize_harness` → a ticket for one user, one
  computer and one mode (view or drive). It is single use, valid for 60 s and stored hashed, as in
  `crates/agent_preview`. The socket closes when access is revoked or the computer is released, hibernated or
  moved.
- **Input gate:** the harness parses client→server RFB. For anyone who does not hold the driver lease it drops
  KeyEvent 4, PointerEvent 5 and ClientCutText 6. Server→client bytes pass through unparsed. The driver lease is
  one Postgres row per computer, so it works across replicas.
- **Access as it is today:** `harness_access_level` (`crates/macro_db_client/migrations/20261111230600_macro_computers.sql`)
  makes an agent's computer team-scoped:
  - The team owner and team admins are Owner. Every other member is User. Nobody is Read.
  - There are no direct shares (`HarnessError::ComputerHarness`).
  - The agent's creator gets nothing extra.
  - `HarnessPermission::View` is documented as "watch its screen" and `Use` as "control the runtime screen"
    (`crates/harnesses/src/domain/models.rs:156-158`). Mapped as they stand, every member could drive, which is
    why D1 proposes `Manage` for driving.
- **Credentials on screen:** whatever the agent's desktop shows, a watcher sees too. We don't try to redact. The
  safeguards are the access check, the no-silent-thumbnails rule, D9, and no recording.
- **Hostile guest:** noVNC runs in a sandboxed iframe on a separate origin, because the guest sends the bytes.
- **Holding the agent (D7):** the agent's own processes can reach `:1`, so blocking only the computer-use and CDP
  servers leaves a gap (for example `xdotool` through Bash). Holding every tool call through the existing
  owner-approval held-tool-call path closes it. The agent also gets a runtime notification when a human starts and
  stops driving.
- **Audit:** `computer_screen_sessions(computer_id, agent_id, user_id, surface, mode, started_at, ended_at, bytes)`
  for each watch, drive and share, and `computer.screen.*` spans with the computer, agent and session ids.
