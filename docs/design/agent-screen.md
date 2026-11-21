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
- **Input gate:** the harness parses the client-to-server half of RFB. Unless
  the socket holds the driver lease, it drops key, pointer and clipboard
  messages, so a viewer can't send input even with a modified client. It also
  removes the extended-clipboard pseudo-encoding, so large guest selections
  arrive as plain clipboard text.
- **One driver:** a lease row per computer, taken by a guarded upsert, so two
  people taking over at once never both drive. Each socket learns whether it is
  the one driving. The lease lapses two minutes after the driver's last input or
  when their access is revoked. Every take-over is an audit row, ended by hand
  back or lapse.
- **Pausing the agent:** while a person drives, every `/brain/*` request from
  that agent waits (woken by a Postgres notification when the lease ends,
  bounded, then 503 with Retry-After). A step the agent already started
  finishes. The guest gets an advisory file (`~/agent/state/screen-driver`), and
  the agent gets a notice on take-over and on hand-back, with the note, on its
  next brain request.
- **Robustness:** sockets are capped per person and per computer, tickets are
  rate limited, a slow viewer can't stall the socket, a sleeping computer is
  woken first, an open screen keeps the computer from hibernating, and the
  guest's `socat` is ended when its session ends.
- **Isolation in the browser:** noVNC runs in a sandboxed `srcdoc` frame without
  same-origin access, with a strict content security policy, so a bug in the
  decoder can't reach the Macro origin. Bytes cross on a message port, and the
  frame may only send the RFB messages a viewer needs.

## Not in this version

- The tab-only and desktop-in-calls sharing paths, and the H.264 stream and
  WebRTC transports. They exist as follow-up work.
- Video recording of take-overs; only audit rows are kept.
- A "Watch my screen" chip the agent posts in a conversation.
