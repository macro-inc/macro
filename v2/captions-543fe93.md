# Agent screen proof with Eve: preview2 543fe93759c

**Build:** preview2 543fe93759c = PR A ab9ad633b9d + PR B 3114215bc9f + captcha #11637. Harness rebuilt from 9f64e90a349 (A ab9ad633b9d). Local screen stack, headless Chromium.

**Verified before recording:** hard reload with the cache disabled; the served client has web3's new strings (`endedTooManyScreensTitle`, `reconnectingHintNoPicture`) and the one-line pill (`Ctrl+Alt+Shift to leave`).

**Stand-ins (captioned):** local stack; PostHog stand-in; Stripe test mode; a hand-created agent inbox; a Docker computer (not Firecracker); phone = Chromium device emulation; dark mode = emulated system theme.

**Hidden on screen:** the address bar after `/app/` (ids) in every frame; emails on Settings > Members (CSS blur during recording).

**Parts** (sources in `proof/`):
1. 0:00–2:03 PR B with Eve, desktop + phone (`out-eve3-0445`).
2. 2:03–2:38 Phone key bar: typed text, arrow keys move the caret (`out-phonekeys-0448`).
3. 2:38–4:49 Viewer states (`out-states-0505`, 33 s of tab loading cut): connecting→Live 0.9 s; tunnel socat killed → Reconnecting with the last picture kept (dimmed), Live again 1.1 s; 5th view → "Too many screens…" state, close one + Try again → Live; pop-out while driving (one drive carried over); dark mode while driving; Stop watching → "You stopped watching" (no Take over) → View screen again; Settings > Machines > Turn off → "Eve's computer is asleep" + Turn on → Live 4 s later.
4. 4:49–6:19 Two people (`out-two-0451`): Jordan (member) watches, Take over locked; Alex drives, Jordan sees "Alex Rivera is driving"; Alex promotes Jordan to Admin in Settings > Members; Jordan's Take over unlocks without a reload; Jordan drives while Alex watches (Alex sees "Jordan Lee is driving", no Take over); Jordan hands back, Alex takes over again; Jordan set back to Member (DB confirms `member`).
5. 6:19–8:01 Freeze (`out-freeze3-0454`, 3.4 min of waiting cut): frozen 1.1 s after take over, running 1.1 s after hand back; harness `docker pause` → guest autothaw after 222 s; unpause → drive `lapsed`.
6. 8:01–9:36 Unpaused (`out-unpaused4-0503`): pause socket chmod 000 + thaw → drive `unpaused`, banner "Eve couldn't stay paused, so it has the computer back." + Take over again; socket restored → `thaw_settled=thawed`.

**Not covered:** hibernation (Firecracker only); idle-tab close; access revoked; a real phone.

**Findings:**
- After Turn on the viewer shows "Reconnecting… / Couldn't reach the computer's screen. Reconnecting…" and never the "Waking" state; captioned so.
- The asleep state still shows a disabled Take over.
- Autothaw took 222 s after the harness pause (177 s on 931ef069298).

## Captions
- 0:01 PR A + PR B together on preview2 (commits in the footer) · VNC only
- 0:04 Eve is an agent teammate with its own Macro computer
- 0:08 Stand-ins: local stack, PostHog stand-in, Stripe test mode
- 0:11 …a hand-created agent inbox, and a Docker computer (not Firecracker)
- 0:15 The DM's Screen button opens Eve's real desktop beside the DM (VNC)
- 0:23 Take over: Alex drives; Eve is paused and its tools are held
- 0:28 Clicks and keys land on Eve's desktop, in a local test page (the app's own shortcuts stay quiet)
- 0:36 A message to Eve while it is paused: no reply yet
- 0:55 Hand back with a note: Eve gets the note and carries on
- 1:01 Eve answers the message that waited while it was paused
- 1:31 Phone: Chromium device emulation (390x844, touch), not a real device
- 1:42 Phone: the DM header's Screen button opens Eve's desktop full screen
- 1:47 Phone: Take over, then Hand back
- 1:58 Not covered: hibernation while frozen (Firecracker only); a real phone (emulated here)
- 2:03 Phone key bar: Chromium device emulation (390x844, touch), not a real device
- 2:07 The DM's Screen button opens Eve's desktop full screen
- 2:11 Take over, then Touch: a tap is a click on Eve's desktop
- 2:18 Keys: the key bar's field types into Eve's desktop
- 2:24 Arrow keys move the caret in Eve's page: two steps left, then type a dash
- 2:30 Hide keys, then Hand back
- 2:39 Viewer states on Eve's real computer (Docker, local stack)
- 2:43 Right: Eve's container, its screen tunnels (one socat per open screen), screen sessions and drives
- 2:47 Screen: Connecting, then Live
- 2:49 Live after 0.9 s
- 2:53 Kill the guest's screen tunnel (its socat, by PID): the viewer reconnects
- 2:56 Reconnecting: the last picture stays while a new tunnel opens
- 2:57 Live again 1.1 s after the tunnel was killed
- 3:01 Too many screens: one person may have 4 open on a computer; open 4 more tabs
- 3:04 (33 s of four tabs loading cut) The 5th view is refused…
- 3:06 The 5th view is refused: too many screens open for this computer
- 3:12 Close one of the others, then Try again: the 5th view connects
- 3:21 Pop out while driving: the drive moves with the view
- 3:29 Still driving in the pop-out (one open drive, right)
- 3:35 Hand back from the pop-out
- 3:46 Dark mode (the system theme, switched by Chromium emulation)
- 3:51 Dark mode while driving: the driving pill and frame
- 4:03 Stop watching: the session ends (stopped), with View screen again
- 4:11 View screen again: Live
- 4:15 Off: Settings > Machines > Eve > Turn off
- 4:29 Eve's screen while its computer is off: asleep, with Turn on
- 4:36 Turn on: the viewer shows Reconnecting (no Waking state here), then Live
- 4:40 Live 4 s after Turn on
- 4:45 Not covered here: hibernation (Firecracker only); idle-tab close; access revoked
- 4:49 Two people on Eve's screen: Alex (owner, left) and Jordan (right), separate browser sessions
- 4:54 Jordan is a team member: watching only, Take over is locked
- 4:59 Alex opens the screen beside the DM and takes over; Jordan sees who drives
- 5:10 Alex hands back
- 5:15 Alex makes Jordan a team admin: Settings > Members > Jordan > Role > Admin (emails blurred)
- 5:30 Alex goes back to the DM and the screen
- 5:32 Jordan's Take over unlocks without a reload
- 5:35 Jordan takes over while Alex watches: both see who drives
- 5:44 Alex has no Take over while Jordan drives
- 5:47 Jordan hands back; Alex takes over again
- 6:01 Alex sets Jordan back to member
- 6:15 Jordan is a member again
- 6:20 Freeze check on a real guest · preview2 543fe93759c (commits in the footer)
- 6:24 Stand-ins: local stack, PostHog stand-in, Stripe test mode
- 6:27 …a hand-created agent inbox, and a Docker computer (not Firecracker)
- 6:31 Eve's computer is a real guest; right: its agent unit's FreezerState and the drive rows
- 6:36 Take over: the guest freezes Eve's agent unit (FreezerState frozen)
- 6:44 Hand back: the unit thaws (running)
- 6:52 Take over again, then pause the harness container: no keep-alive reaches the guest
- 6:59 Dead-man: with no keep for ~180 s, the guest thaws the agent by itself
- 7:09 (3.4 min of waiting cut)
- 7:13 The guest thawed the agent 222 s after the harness was paused
- 7:20 Harness back (docker unpause): past the 120 s input lease, the drive ends as lapsed
- 7:55 Expected for a harness outage: nobody was driving any more either way
- 8:01 The unpaused path: the harness is up, but the guest helper can no longer keep the freeze
- 8:11 Take over: the agent unit is frozen; Alex types into the guest's notes page
- 8:17 Simulated helper failure, as root in the guest: pause socket chmod 000, then systemctl thaw
- 8:20 Alex keeps typing: on the next keep, the keep and the refreeze both fail
- 8:30 The harness ends the drive as unpaused; the viewer says so (thaw still owed: thaw_settled empty)
- 8:39 Socket restored (chmod 0660): the next reap round settles the owed thaw
