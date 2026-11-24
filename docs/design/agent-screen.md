# Agent screens: watch and take over an agent teammate's desktop

An agent teammate works on its own Macro computer, on a virtual desktop it drives
with computer use and its browser. This feature lets the people on its team watch
that desktop live from Macro, and lets team owners and admins take it over with
keyboard and mouse, for example to type a sign-in code, then hand it back.

## What a person sees

- **Entry points:** "View screen" on the agent's member card, a Screen button in
  the header of a DM with the agent, and "View screen" on the computer's row in
  Settings > Machines. All open the same viewer as a split next to the current
  view (full screen on a phone); `/app/screen/<harnessId>` links to it directly.
- **Watching:** the live desktop, its state (connecting, live, reconnecting,
  waking, off, ended) and who is driving. There are no technical details in the
  viewer.
- **Taking over:** owners and admins see Take over. While they drive, the
  viewer owns the keyboard (Macro's own shortcuts stay quiet), the agent is
  paused, and every viewer sees "<name> is driving". Hand back (a button, or
  holding Esc) takes an optional note for the agent. Stop watching closes the
  view and hands back first.
- **Phones:** pinch and pan move only the local view; one finger can view, touch
  (tap = click, drag) or scroll; a key bar with a text field types into the
  desktop, including IME text.

## How it works

```
browser (noVNC in a sandboxed frame)
   │  WSS: RFB bytes + JSON control
agent harness ── tickets, one driver lease, RFB input gate, audit rows, agent hold
   │  Fleet::exec("socat … TCP:127.0.0.1:5901") over the host agent and vsock
guest: Xvnc on 127.0.0.1:5901 (the agent's display :1)
```

- **Transport:** the guest already runs TigerVNC's Xvnc for the agent's display,
  listening on loopback only, with no password. Nothing new listens on the
  guest. The harness reaches it through the computer fleet's existing exec path,
  running `socat` in the guest, so the same code works on Firecracker and on
  local Docker computers. VNC was chosen for the first version after comparing
  it with an H.264 stream over WebSocket and WebRTC on the same desktop: it has
  the lowest latency, pixel-exact text, works in every browser, and needs no
  encoder in the guest.
- **Tickets:** `POST /computers/{harness_id}/screen/tickets` returns a
  single-use ticket, valid for 60 seconds and stored hashed, bound to the person,
  the computer and the mode (view or drive). `GET
  /computers/{harness_id}/screen/ws?ticket=…` redeems it. Watching needs the
  harness `View` permission (every member of the computer's team); driving needs
  `Manage` (team owners and admins). Programs (agent and routine runs) and agent
  accounts are refused: a screen is a person's view.
- **Input gate:** the harness parses both halves of RFB. Unless the socket
  holds an unexpired driver lease, it drops key, pointer and clipboard messages
  from the viewer, so a viewer can't send input even with a modified client,
  and the guest's clipboard (what the agent copies or the driver pastes) never
  reaches it. To follow Xvnc's stream without decoding pixels, a viewer may
  only ask for Raw, CopyRect and ZRLE (plus pseudo-encodings that carry no
  pixel data); Xvnc doesn't send the primary selection at all.
- **One driver:** a lease row per computer, taken by a guarded upsert, so two
  people taking over at once never both hold the lease. Each socket learns
  whether it is the one driving from the lease changes' Postgres
  notification, and drops input past its lease's expiry on its own clock. A
  lease that ends early (a hand-back from the driver's other tab, a lost
  freeze) is seen only once that notification arrives and the socket's loop
  gets to it, so until then the former driver's input can still reach the
  guest, even after someone else took over. For raw input that is the
  notification's delay, milliseconds normally. A typed input already being
  written to the guest is not stopped: its write may take up to 10 seconds,
  never past the lease's own expiry. The first typed input of a socket,
  whose injector connects meanwhile, reads the lease again once connected
  and goes in only while that drive is still the socket's. The lease lapses two minutes
  after the driver's last input or when their access is revoked. Every take-over is an audit row, ended by hand
  back or lapse.
- **Pausing the agent:** a take-over first freezes the agent's unit
  (`systemctl freeze`, through a root-owned helper on a socket in a directory
  only the harness's exec user may enter and the agent's sandbox hides), so a
  step already under way stops too, whichever account its Claude uses. When
  it can't be frozen, Take over is refused with `agentNotPausable` and nothing
  claims the agent is paused. Every request names its drive and takes one
  lock in the guest, so a late thaw never undoes a newer take-over's freeze.
  The guest thaws the agent itself 3 minutes after the last renewal (its
  clock stops while the computer sleeps); a hand-back or lapse thaws it at
  once, and each replica retries every thaw the guest hasn't confirmed, for
  as long as it takes, once the computer runs. An owed thaw keeps the
  computer awake. Freezing the unit also freezes a call the agent is on;
  the call resumes at the hand-back. While a person drives, every `/brain/*` request from that
  agent also waits (woken by a Postgres notification when the lease ends,
  bounded, then 503 with Retry-After; at once on a harness shutdown). The guest
  gets an advisory file (`~/agent/state/screen-driver`), and the agent's main
  loop (requests its runtime marks `x-macro-agent-loop: main` that offer tools)
  gets a notice on take-over and on hand-back, with the note, each claimed by
  one request at a time and kept until a finished answer was handed whole
  to the agent's connection (a notice can be delivered twice; it carries the
  same id each time). An
  agent on its owner's own Claude plan calls
  Anthropic directly, so it never gets the notices; it is still frozen.
- **Robustness:** sockets are capped per person and per computer, tickets are
  rate limited, a slow viewer can't stall the socket, a sleeping computer is
  woken first, an open screen keeps the computer from hibernating (one
  opened while memory relief is already suspending it sees the computer go
  off, and opening it again wakes it), and the
  guest's `socat` is ended when its session ends. A socket whose viewer hasn't
  said its tab is visible (a `visibility` message the viewer repeats) or
  driven for 10 minutes, or 2 minutes after its tab was hidden, ends as
  `idle`, so a forgotten tab stops keeping the computer awake and a forgotten
  take-over hands back. Viewers see who drives by name, never by user id.
- **Isolation in the browser:** noVNC runs in a sandboxed `srcdoc` frame without
  same-origin access, with a strict content security policy, so a bug in the
  decoder can't reach the Macro origin. Bytes cross on a message port, and the
  frame may only send the RFB messages a viewer needs.

## Not in this version

- The tab-only and desktop-in-calls sharing paths, and the H.264 stream and
  WebRTC transports. They exist as follow-up work.
- Video recording of take-overs; only audit rows are kept.
- A "Watch my screen" chip the agent posts in a conversation.
