# SPEC: watch (and take over) an agent teammate's screen

Bead `mac-teammate-e2e.15`. Status: **draft, research only, nothing built.** Fixes QA **B7**
(the guest runs Xvnc on `127.0.0.1:5901`, but the owner has no way to see it).

Builds on, does not redo: `/home/wolf/tmp/agent-screen/tech/RECOMMENDATION.md` (transport, t2p3),
`/home/wolf/tmp/agent-screen/design/` (3 UX options, t2p2; its tailnet URL `:21490` is down, 502),
and the Macro draft [transport recommendation](https://macro.com/app/md/01a1f585-e38b-713f-ba22-79134cb3c573)
(a copy of the same recommendation). Facts below were checked again on `main` at `bb14f607cef`.

## 1. What exists today

**In the guest** (agent image, `nix/macro-box/_agent.nix`):
- `macro-agent-display`: TigerVNC `Xvnc :1 -rfbport 5901 -interface 127.0.0.1 -localhost -SecurityTypes None
  -AlwaysShared` (`_agent.nix:426`). No password, loopback only, several clients allowed at once.
- Openbox, Chromium with CDP on `127.0.0.1:9223`, and the `computer-use-linux` MCP server (X11 backend,
  `_agent.nix:140-146`). The agent sees and acts on the whole `:1` display, not only the browser.
- `socat` is in the image. Nothing listens off the VM. Each VM has its own netns, and nftables drops all inbound traffic.

**Paths that can reach the guest:**
- **Host agent exec (works today):** harness → mTLS → `firecracker_host` `GET /v1/computers/{id}/exec` WebSocket →
  vsock → guest agent runs the program. In the domain this is `Fleet::exec(computer, argv) -> GuestProcess{stdin,stdout}`
  (`crates/hosted_runtimes/src/domain/ports.rs:683`). The harness already uses it to start harnessd
  (`services/agent_harness_service/src/computers.rs:744`). `exec(["socat","STDIO","TCP:127.0.0.1:5901"])`
  therefore gives the harness a raw RFB byte pipe, with no change to the guest or the host.
- **macrod's outbound WSS:** one ACP/runtime socket to `agent-harness/runtime/ws`. Using it for the screen needs a new
  channel type, a macrod release and a relay between replicas.
- **WebRTC/LiveKit:** agents already publish **one browser tab** to calls through CDP screencast
  (`muppet .../calls/share.ts`). That covers a tab only, not the desktop.

**Permissions already modelled:** `HarnessPermission::View` is documented as *"Read the runtime and watch its screen"*
and `Use` as *"Run agents or control the runtime screen"* (`crates/harnesses/src/domain/models.rs:156-158`).
`authorize_harness` maps View → any access (Owner/User/Read) and Use → Owner or User
(`crates/harnesses/src/domain/service.rs:706-711`). No route uses them for a screen yet. `crates/agent_preview` has
the lease, hashed-ticket and viewer-auth pattern we want to copy.

**Who has which access on an agent's computer today** (`harness_access_level`,
`crates/macro_db_client/migrations/20261111230600_macro_computers.sql`; `crates/harnesses/AGENTS.md` Scope):
a Macro computer's harness belongs to the **computer's team**. The team owner and team admins are Owner. **Every
other team member is User** (`edit`). Nobody outside the team has access, and direct shares and team-access
changes are refused (`HarnessError::ComputerHarness`), so nobody is ever Read on a computer. The person who bought
the computer, or who created the agent, gets nothing extra. So with no change, `View`/`Use` would let **every member
of the team watch and take over** an agent's screen.

## 2. User experience (design option A, plus two pieces from B and C)

- **Entry points:**
  1. Member card (`lib/core/component/userCardActions.tsx`): a **View screen** action next to Message, shown only
     for agents with a computer and only to people allowed to watch.
  2. DM header with the agent: a **Screen** button. While someone is watching, or a human is driving, it shows a
     live dot (same pattern as `ChannelTopBarLiveIndicators.tsx` and the call header).
  3. Settings → agents row and Machines row menu (where QA looked for it in B7): a **View screen** item.
  4. **Share chip:** the agent can post a "Watch my screen" card in a DM or channel (for example "I need a sign-in
     code"). The card shows a live thumbnail, but only to people who may watch. Everyone else sees a locked chip.
     When the session ends, the chip turns into a plain summary ("Wolf drove 14:02–14:05").
- **Viewer:** a split side panel next to the conversation, with a pop-out button for full size or a second
  monitor. noVNC scales the 1920×1080 screen to fit. Connection states: connecting, live, slow, reconnecting,
  computer asleep/off (offers "Turn on"), ended.
- **View-only (default) → Take over:** one click on **Take over**. The agent stops at once, the frame turns amber,
  and everyone watching sees "Wolf is driving". **Hand back** (button, or hold Esc) takes an optional note, which
  the agent gets with a fresh screenshot. The driver goes idle or disconnects → after 2 minutes control goes back
  automatically, and the agent asks in the conversation before it carries on.
- **Phone:** watch only in v1 (screen on top, chat below). Taking over from a phone comes later (trackpad + key row).

## 3. Security

- **Treat take-over like a shell.** Whoever drives has the agent's logged-in browser sessions, its mail, and
  anything else on the desktop.
- **Who:** checked in the harness on every ticket, using the existing `authorize_harness`. Today that means every
  team member is User. Watch = `View` and drive = `Manage` (team owner and admins), unless Wolf decides otherwise (D1).
- **Tickets:** `POST /computers/{id}/screen/tickets` returns a ticket for one user, one computer and one mode
  (view or drive). It is single use, valid for 60 s and stored hashed. The browser opens the WebSocket with it.
  Sockets close when access is revoked or the computer is released, hibernated or moved.
- **Input gate, enforced in the harness:** the harness parses only client→server RFB. For anyone who does not hold
  the driver lease it drops KeyEvent (4), PointerEvent (5) and ClientCutText (6), so view-only cannot be bypassed
  from the browser. The driver lease is one Postgres row per computer, so it works across harness replicas.
- **The agent is blocked, not just told:** while a human drives, the agent's `computer-use` and `chrome-devtools`
  tool calls are refused in code. We also send the agent a runtime notification ("A human is driving" / "handed
  back, re-observe before acting"). Where the block sits is decision D7.
- **Credentials on screen:** whatever the agent can see, a watcher can see too. Mitigations: only people who may
  watch get a thumbnail, the chip does not widen access, and no video is recorded in v1. We do not try to redact.
- **Hostile guest:** the bytes come from a computer the agent controls, so noVNC runs in a sandboxed iframe on a
  separate origin.
- **Audit:** always on. A `computer_screen_sessions` row for each watch and each take-over (user, mode, start,
  end, bytes), a line in the conversation for each take-over, and `computer.screen.*` spans
  (ticket → socket → exec → close) with computer, agent and session ids.
- **Recording:** none in v1. If we add it later, record take-overs only: the harness copies the RFB stream to S3.

## 4. Approach

**Recommended: VNC over the host agent exec path, noVNC in the web app.**

| Phase | Ships | Changes |
| --- | --- | --- |
| 1 Watch | View screen (card, DM header, Machines row), side panel, view-only, phone watch, audit rows | harness: ticket route + `GET /computers/{id}/screen` WS (socat exec, RFB input gate); DB: `computer_screen_sessions`; web: noVNC panel in sandboxed iframe. No guest/host change. |
| 2 Take over | Take over / Hand back, amber state, driver lease, idle hand-back, agent blocked + notified | harness: lease + gate on; agent tool hold (D7); runtime notification |
| 3 Share chip | Agent posts "Watch my screen" card with live thumbnail | agent tool to post the chip; message attachment type; thumbnail = harness-side periodic frame grab, access-checked |
| Later | Phone take-over, take-over recording, host-agent `stream` route instead of socat exec, WebRTC if phones on cellular are poor | |

**Alternative 1: tunnel through macrod's outbound WSS.** This would also work on bring-your-own machines.
Rejected for now: it needs a protocol change and a macrod release, the bytes must reach the replica that holds
the socket, video bursts would share the ACP socket, and macrod also runs on people's laptops, where screen access
is a much bigger trust question.

**Alternative 2: WebRTC through LiveKit, which calls already use.** Better on lossy phone networks and with many
viewers. Rejected for v1: it needs a software H.264/VP8 encoder in a guest with no GPU (0.5-1 vCPU while someone
watches), a guest image change, and input injection we would build ourselves. It is the upgrade path if
measurements show VNC is not good enough.

(CDP screencast is out: it shows one tab and misses dialogs, file pickers and other apps.)

## 5. Acceptance checks

1. As the owner, on a local stack with an agent computer: View screen on the member card opens the panel, and the
   live desktop shows within 3 s. Mouse and keys in view mode change nothing (checked with `xdotool getmouselocation`
   in the guest).
2. As a user with no access to the machine: there is no View screen entry, and a hand-made ticket request returns
   403. A replayed or expired ticket is rejected.
3. Take over: the agent's next computer-use call is refused, and it receives the notification. Typing in Mousepad
   from the browser works. Hand back resumes the agent, which sees the note. Closing the tab hands control back
   after 2 minutes.
4. Two viewers at once: both see the screen, only the driver's input lands, and both see "Wolf is driving".
5. Release or hibernate the computer while watching: the socket closes, and the panel shows "asleep/off".
6. One trace in Tempo from the ticket to the socket close. `computer_screen_sessions` rows match what happened.
7. Phone width: the panel stacks screen over chat and offers no Take over.
8. `cargo test -p agent_harness_service` covers the ticket and the RFB gate (input dropped for viewers). Web
   component tests cover the panel states.

## 6. Decisions for Wolf

- **D1 Who may watch, and who may drive?** On an agent's computer every team member is User today, and admins are
  Owner (section 1). The tech recommendation said only the agent's owner. The design recommendation said Users watch
  and the owner drives. The code's own comment says Use may control the screen. **My recommendation:** watch =
  `View` (every team member, no change). Drive = `Manage` (team owner and admins), not `Use`, because driving is a
  shell on the agent's logged-in accounts. A per-agent "let members take over" switch can come later. The agent's
  creator gets nothing beyond their team role. That matches how the computer is authorized now, so we add no new
  ownership concept.
- **D2 Viewer placement:** a side panel with a pop-out button (A, my recommendation), a theater modal (B), or its
  own window (C).
- **D3 Share chip in v1, or phase 3?** I recommend phase 3: watching and taking over fix B7 without it.
- **D4 Live thumbnail in the chip** (screen contents end up in the channel for people who may watch): yes, or a
  static chip?
- **D5 Recording:** no video in v1, audit rows only. Later, take-overs only?
- **D6 Phone:** watch only in v1?
- **D7 Where the "agent blocked while a human drives" gate lives.** `computer-use-linux` and `chrome-devtools` are
  MCP servers in the guest (`_agent.nix:140-146`), not muppet tools, so "muppet refuses" does not apply as written.
  - **(a) Harness gate (recommended):** the harness holds or denies those tool calls while the lease is held,
    reusing the owner-approval held-tool-call path. One place, it can't be bypassed from the guest, and the lease
    is already in the harness. Trade-off: it only blocks calls that go through ACP. A shell command like
    `xdotool` run from the agent's Bash tool would get through, unless Bash is also held while a human drives.
  - **(b) Guest wrapper:** a wrapper around the MCP servers refuses while a root-owned flag is set (not in
    `/run/macro-agent`, which the agent's desktop can write to). Trade-off: it needs a guest image change, and the
    agent could still drive X directly.
  - In both, the hard limit is the same: the agent's own processes can reach `:1`. Only holding every tool call
    while a human drives closes that. I recommend (a), holding all tool calls during a take-over, which is the
    simplest rule anyway.
