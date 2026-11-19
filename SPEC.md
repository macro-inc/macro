# SPEC: see (and take over) what an agent teammate is doing

Bead `mac-teammate-e2e.15`. Draft, research only, nothing built. Fixes QA **B7** (the agent's desktop runs on
Xvnc `127.0.0.1:5901` in the guest, but the owner can't see it). Builds on `/home/wolf/tmp/agent-screen/`
(`tech/RECOMMENDATION.md`, `design/`) and the Macro
[transport draft](https://macro.com/app/md/01a1f585-e38b-713f-ba22-79134cb3c573). Facts are checked on `main` at
`bb14f607cef`, with file references under **Details**.

## What we build

The agent can share one of two surfaces, and picks the one that fits:

| Surface | What people see | Where | How |
| --- | --- | --- | --- |
| **Tab** (exists today) | One browser tab in a clean, signed-out browser context, with the URL blocklist enforced at the wire | Calls only | CDP screencast → LiveKit screen-share track (kept as is) |
| **Desktop** (new) | The agent's own virtual desktop `:1`: every window, dialog and app, plus its signed-in browser | The "View screen" panel, and calls (phase 4) | Panel: VNC/RFB through the harness → noVNC. Call: x11grab → the existing LiveKit publish |

Never the desktop of the person who owns the agent: only the agent's computer, display `:1`.

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
| 1 | View screen (member card, DM header, Machines row), side panel, view-only, watch on phone, audit | harness screen WebSocket over `Fleet::exec` socat, noVNC panel |
| 2 | Take over / Hand back, driver lease, agent held | harness lease + held tool calls (D7) |
| 3 | Agent's "Watch my screen" chip, surface label + Switch/Stop | agent tool, chip attachment |
| 4 | Desktop into calls, tab ⇄ desktop switch in calls | muppet: x11grab feed into the existing publish |

## Decisions for Wolf

- **D1 Who watches, who drives?** I recommend watch = `View` (every team member, as today) and drive = `Manage`
  (team owner and admins).
- **D2 Viewer placement:** a side panel plus a pop-out button (my recommendation), a theater modal, or a window
  of its own.
- **D3 Share chip:** I recommend phase 3. Phases 1 and 2 fix B7 without it.
- **D4 Live thumbnail in the chip** for people who may watch, or a static chip only?
- **D5 Recording:** none in v1. Later, take-overs only?
- **D6 Phone:** watch only in v1?
- **D7 Hold the agent while a human drives:** hold **all** of the agent's tool calls in the harness (my
  recommendation; one place, can't be bypassed from the guest), or a guest wrapper around the computer-use and
  CDP servers only (needs an image change, and the agent can still reach X through Bash).
- **D8 Tab surface outside calls?** I recommend no in v1. Today a tab can only be published into a call. Outside a
  call the desktop covers it.
- **D9 Desktop in a call:** the tab's safety rules (clean signed-out browser, blocklist, no typing into password
  fields) don't exist on the desktop, and a call can include guests who may not watch. I recommend allowing it only
  when everyone in the call may `View` the computer. Otherwise the share falls back to the tab, and the agent says
  why.

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
9. `cargo test -p agent_harness_service` covers tickets and the RFB input gate. muppet tests cover the
   surface-choice rule and the D9 fallback.

## Open questions (to t2j2: calls/runtime owner)

- **Q3** On a hosted agent computer, does the call worker (`@livekit/rtc-node`, muppet `calls/`) run inside the
  guest as the agent's user, so it can read display `:1` with x11grab?
- **Q4** Who may join a call the agent is in: only team members, or outside guests too? D9 depends on it.

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

## Desktop into a call: findings

- **How the tab share works today** (`agent-teammates/muppet/packages/lib/utilities/macro/calls/share.ts`,
  `frames.ts`, `starter-agent/behavior/capabilities/calls/DESIGN.md` "Showing a browser"):
  - CDP `Page.startScreencast` sends a JPEG on each damage.
  - A worker decodes it with ffmpeg into fixed-size I420 frames: 1280×720, 10 fps, quality 65. It re-sends the
    newest frame to keep the track alive.
  - The SDK `publishScreenShare` puts them on a `VideoSource` and publishes it as `TrackSource.SOURCE_SCREENSHARE`
    (`packages/sdk/src/calls/node.ts:67-165`). libwebrtc in `@livekit/rtc-node` encodes it in software, in the
    agent's process.
  - Lifecycle: the share starts with `share_screen` and is driven by `drive_screen`. It ends on `stop_share`, a
    blocked navigation, a stall, the track ending or the call ending.
- **VNC does not plug into calls.** RFB frames are a protocol for remote viewers. Inside the guest, decoding RFB
  from Xvnc only to re-encode it is strictly worse than reading the display directly. The desktop source for a
  call is therefore **ffmpeg `x11grab` on `:1`**, scaled to the same 1280×720 I420 at 10 fps, fed into the
  **same** `ScreenFrame` stream and `publishScreenShare`. Only the source changes. Encoding, the track, the
  source type and the lifecycle are all unchanged.
- **Not faster, not slower:** the encode is the same libwebrtc encode the tab already pays for (estimated at a few
  tens of percent of one vCPU at 720p10; not measured). x11grab adds a small capture and scale cost. x11grab also
  sends frames at a steady rate rather than on damage, so it uses more CPU when the screen is idle unless we skip
  unchanged frames.
- **Server-side alternative (rejected for now):** the harness decodes RFB and publishes into LiveKit as its own
  participant. That keeps the encode out of the guest, but it adds a media publisher service and a second
  participant identity. Revisit only if guest CPU in calls becomes a problem.
- **Switching surfaces in a call:** stop one publication and start the other on the same `SOURCE_SCREENSHARE`.
  There is one screen share per agent at a time.

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
