# Agent computer screen

Watching an agent teammate's computer, and taking over its desktop. The
viewer is `apps/web/src/features/agent-screen/`; the server side is the
agent harness's screen socket.

## Route and splits

- The route is `/app/screen/<harnessId>`, the split content id `agent-screen`
  with param `harnessId`. A pop-out adds `continueDriving=true`, which takes
  over the lease the old view left; it is never written to a shared link.
- The view is keyed on the harness id: switching computers remounts it.
- Desktop shows it as a split beside the conversation, with Pop out in the
  header. The pop-out is a wide dialog (`popoverSplit(…, { wide: true })`)
  with the status pill and title in the view itself and the picture at 16:9.
  Phones show the full-screen layout (`views/mobile/`).

## Entry points

Each appears only when the harness list gives the viewer access other than
`none` to an agent teammate's computer:

- **Agent DM header:** a **Screen** button, grouped with Call in the
  "Conversation actions" group on desktop, and its own header island on touch.
- **Member card:** **View screen** on the agent teammate's user card.
- **Settings → Computers:** the computer's row and its actions menu open the
  screen (in place when already in a split).

## Watching

- The status pill says Connecting, Waking (a hibernated computer), Live,
  Reconnecting, Asleep (Turn on, for managers) or Ended.
- Reconnecting keeps the dropped connection's last picture, greyed out, until
  the new one is live, and says "Showing the last picture" only when there is
  one. After a connection that was steady drops, its first ten retries come
  at most 2 s apart (within a minute), then the usual backoff resumes at 4 s
  and gives up with **Try again** after three more.
- A computer with as many screens open as it allows (`tooManySockets` on the
  socket, or a 429 ticket with `too_many_screens`) ends the view with "Too
  many screens are open for this computer" and **Try again**; it is not
  retried on its own.
- The ticket rate limit (a 429 with `too_many_tickets`, or with no code)
  shows "Reconnecting is paused for a minute", retries once after the
  minute, and if still limited ends with **Try again**.
- Once the view has ended (stopped, refused, gone), or while the computer is
  asleep or starting, only the overlay's own action shows: no Take over.
- Asleep, the view checks every 10 s for two minutes, then once a minute,
  while the tab is shown (and at once when it is shown again) and connects on its own once someone turns the
  computer on. A final end or asleep clears any "Reconnecting…" notice.
- **Turn on** says "Turning {name}'s computer on…" at once and keeps saying it
  through the boot: for up to two minutes, a screen that isn't up yet
  (`tunnelFailed`, `sourceUnavailable`, "off", a dropped socket) is retried
  after 2, 4, then every 5 s (about 25 tickets), without a reconnect error.
  Other errors and final ends stand. If no picture came by then, the view
  ends with "{name}'s computer didn't come back" and **Try again**, which
  starts an ordinary connect. A wake the server reports (Waking) gets the
  same ride-out.
- Members watch only: Take over is disabled with a lock and "Only owners and
  admins can take over". Owners and admins connect with a drive ticket.
- A hidden tab says so to the server (a heartbeat). After two minutes hidden
  the socket is closed ("Closed while this tab was hidden"), and it reconnects
  as soon as the tab is shown again.

## Taking over

1. Click **Take over** (owners and admins). The header pill turns amber:
   "You're driving". An amber frame goes round the picture, and a one-line
   pill over it says "{name} is paused · tools held" (only when the harness
   froze the agent) with the hand-back hints, which shorten and then drop as
   the split narrows. Where the agent couldn't be paused, Take over is refused
   with "Couldn't pause the agent on this computer…" and stays enabled.
2. Keys go to the computer while the hidden keyboard field has focus
   (`data-owns-keyboard`: app hotkeys stand down). After a Take over on
   desktop the field is focused. Click the picture to focus it again.
3. **Hold Esc** for a second, or click **Hand back**, to give control back,
   with an optional note. **Ctrl+Alt+Shift** (Control+Option+Shift on a Mac)
   leaves the keyboard without handing back.
4. Paste with Ctrl+V or Cmd+V: the text goes onto the computer's clipboard,
   then pastes. Text outside Western European characters is refused with a
   notice; type it instead. Only the driver's socket gets the computer's
   clipboard; watchers never do.
5. **Stop watching** closes the stream (handing back first when driving) and
   shows "You stopped watching" with **View screen again**.

When a drive ends without the driver letting go (the lease lapsed for lack of
input, someone else took over, or the agent couldn't stay paused and has the
computer back), a banner says "You're no longer driving" and why, with
**Take over again**, and keys stay swallowed until the person acts on it.
A dropped connection while driving says "Connection lost while you were
driving. Reconnecting…" and wins the same drive back.

On a phone the viewer is full screen: the dock and the New button stand
down while it shows. A portrait stage is filled (top-left corner in view) and
a landscape one fitted, again on every resize or rotation, until the person
zooms, pans or picks **Fit** in the zoom control.

## Testing without a computer

The views and the session are tested with fake transports (vitest, jsdom):
`views/agent-screen.test.tsx` drives both layouts through drops, lapses and
take-overs; `transports/vnc-frame/novnc-clipboard.test.ts` runs the real
noVNC against a scripted RFB server. The layouts have a backend-free browser
regression over a stand-in transport (desktop split at 600 and 380 px, phone,
light and dark), plus the real agent DM top bar (`ChannelDetailTopBar`) over
stubbed channel and team queries, where the Offline chip drops to its dot
before the agent's name truncates: `just test-agent-screen-browser` from
`apps/web`; `AGENT_SCREEN_SHOTS_DIR=<dir>` keeps a PNG of each state. CI's
Browser Tests job runs it when the viewer, that top bar, or a module the
fixture stubs changes. A real run needs a local stack with an
agent teammate's computer and the harness screen socket.
