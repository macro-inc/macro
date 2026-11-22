# Polish + boot states with Eve: preview2 3c64c3c4c49

**Build:** preview2 3c64c3c4c49 = PR A 019325d2516 + PR B 4089acb1dec + captcha #11637. Local screen stack, headless Chromium. Hard reload before recording; the served client has `statusTurningOn`.

**Part 1 (0:00–1:03) polish** (`out-polish2-0651`): phone (Chromium device emulation 390x844, touch) paused strip "Eve is paused · tools held" while driving, light and dark (emulated system theme); desktop pop-out while driving: the "You're driving" pill sits in the pop-out's header, clear of the guest's tab strip.

**Part 2 (1:03–2:44) boot states, narrow layout** (`out-boot-0653`): two 960 px windows, Alex (owner) left with the DM and Eve's screen side by side, Jordan (member) right on Eve's screen.
- Turn off: the DM header shows the Offline chip and avatar, the DM says "Eve isn't running: its computer is offline", both screens asleep (Alex: Turn on; Jordan: Try again).
- Turn on: only "Turning Eve's computer on…" on the way, Live 3.1 s later.
- **STAND-IN** for a boot whose screen never comes up: right after power-on (0.6 s after the container ran), `systemctl mask --runtime --now macro-agent-display.service` in the guest (the guest's /etc is read-only, so a runtime mask). After 118 s: "Eve's computer didn't come back" + Try again. 95 s of the window is cut. Stand-in undone (unmask, start display, restart macro-agent), Try again: Live.

**Hidden on screen:** the address bar after `/app/`.

**Findings:**
- Jordan's (member) view stays "Eve's computer is asleep" + Try again after Alex turns the computer on, with the notice "The screen closed. Reconnecting…" under it; it does not follow the boot or come back by itself.
- The "didn't come back" end still shows the notice "Couldn't reach the computer's screen. Reconnecting…" under it.
- Before this take Eve showed Offline while running: after the stack's docker stop/start, the guest's macrod stayed disconnected (`hosted_runtime` phase booting, macrod_connected false). `systemctl restart macrod` in the guest fixed it (phase running); I re-shot the polish take after that. The other agents (Ada, Bo, Cy, Dee) still show "Not responding" on Machines for the same reason.

## Captions
- 0:01 Phone (Chromium device emulation 390x844, touch): the paused strip while driving
- 0:08 Take over: the strip says "Eve is paused · tools held"
- 0:15 The same strip in dark mode (emulated system theme)
- 0:22 Hand back
- 0:29 Desktop: pop out while driving
- 0:47 In the pop-out the driving pill sits clear of the guest's tab strip
- 0:54 Hand back from the pop-out
- 1:03 Narrow layout: Alex (owner, left) and Jordan (member, right), 960 px windows
- 1:07 Alex opens Eve's screen beside the DM; Jordan watches the same screen
- 1:13 Alex turns Eve's computer off: Settings > Machines > Turn off
- 1:26 Eve offline: the DM header's status chip and avatar; both screens asleep
- 1:33 Turn on: one "Turning on" message, then Live
- 1:37 Live 3.1 s after Turn on (shown on the way: Turning Eve’s computer on…)
- 1:42 A boot that never brings the screen up: off again first
- 1:57 STAND-IN: right after power-on the guest's agent display service is masked and stopped, so its screen stays unreachable
- 2:02 The viewer rides out the boot for 2 min while the screen stays unreachable
- 2:12 (95 s of the 2 min boot window cut; the screen stayed unreachable throughout)
- 2:25 After 118 s: "Eve's computer didn't come back"
- 2:32 Stand-in undone (display unmasked and started); Try again: Live
