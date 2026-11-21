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
  header. Phones show the full-screen layout (`views/mobile/`).

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
  Reconnecting (the last picture greyed out), Asleep (Turn on, for managers)
  or Ended.
- Members watch only: Take over is disabled with a lock and "Only owners and
  admins can take over". Owners and admins connect with a drive ticket.
- A hidden tab says so to the server (a heartbeat). After two minutes hidden
  the socket is closed ("Closed while this tab was hidden"), and it reconnects
  as soon as the tab is shown again.

## Taking over

1. Click **Take over** (owners and admins). The pill turns amber: "You're
   driving", and "{name} is paused · tools held" only when the harness froze
   the agent. Where it couldn't, Take over is refused with "Couldn't pause the
   agent on this computer…" and stays enabled.
2. Keys go to the computer while the hidden keyboard field has focus
   (`data-owns-keyboard`: app hotkeys stand down). After a Take over on
   desktop the field is focused. Click the picture to focus it again.
3. **Hold Esc** for a second, or click **Hand back**, to give control back,
   with an optional note. **Ctrl+Alt+Shift** (Control+Option+Shift on a Mac)
   leaves the keyboard without handing back.
4. Paste with Ctrl+V or Cmd+V: the text goes onto the computer's clipboard,
   then pastes. Text outside Western European characters is refused with a
   notice; type it instead. While others watch, the pill warns that watchers
   can see a paste.
5. **Stop watching** closes the stream (handing back first when driving) and
   shows "You stopped watching" with **View screen again**.

When a drive ends without the driver letting go (the lease lapsed for lack of
input, or someone else took over), a banner says "You're no longer driving"
with **Take over again**, and keys stay swallowed until the person acts on it.
A dropped connection while driving says "Connection lost while you were
driving. Reconnecting…" and wins the same drive back.

## Testing without a computer

The views and the session are tested with fake transports (vitest, jsdom):
`views/agent-screen.test.tsx` drives both layouts through drops, lapses and
take-overs; `transports/vnc-frame/novnc-clipboard.test.ts` runs the real
noVNC against a scripted RFB server. A real run needs a local stack with an
agent teammate's computer and the harness screen socket.
