# Power cycle + freeze timing with Eve: preview2 856acc40c6d

**Build:** preview2 856acc40c6d = PR A 019325d2516 + PR B ef461047df7 + captcha #11637. Local screen stack, headless Chromium. Hard reload before recording; the served client has `turningOnTitle` and `endedDidNotStartTitle`.

**Hand-installed pause helper (stand-in for an image rebuild):** preview2's `nix/macro-box/files/macro-agent-pause` (sha256 a2de8a80486ab4ce6839e173b992248f0543cf7a3833621c2ed1af733000a93e) under the guest's own writeShellApplication header, at `/run/macro-agent-pause-hand/macro-agent-pause` (sha256 860e9f4c938b8e149aeeb1c720520706274b131efc2ab34092ab2472ba961363), used by `macro-agent-pause@.service` through a `/run` drop-in. Diff vs the image's helper: only the two AccuracySec lines. Installed after the power-cycle take (a power cycle wipes `/run`). Script: `proof/install-pause-helper.sh`.

**Part 1 (0:00–0:44) power cycle** (`out-power-0544`): Settings > Machines > Eve > Turn off; the DM's screen shows "Eve's computer is asleep" with Turn on and no Take over; Turn on → "Turning Eve's computer on…" (no Take over) → Live 3.6 s after Turn on; Reconnecting never appeared (polled every ~0.5 s).

**Part 2 (0:44–2:02) freeze** (`out-freeze4-0546`, 2.6 min of waiting cut): frozen 1.1 s after Take over, running 1.1 s after Hand back; harness `docker pause` → guest autothaw **177 s** after the pause (222 s before the AccuracySec fix); unpause → drive `lapsed` 1.3 s later.

**Hidden on screen:** the address bar after `/app/`.

## Captions
- 0:01 Turn off and on, on Eve's real computer (Docker, local stack)
- 0:05 Eve's screen beside the DM: Live
- 0:10 Settings > Machines > Eve > Turn off
- 0:24 Back to the DM: Eve's computer is asleep, with Turn on and no Take over
- 0:31 Turn on
- 0:32 Turning Eve's computer on… (no Take over while it starts)
- 0:34 Live 3.6 s after Turn on; no Reconnecting on the way
- 0:39 Container running; asleep showed Take over: no
- 0:45 Freeze check · guest pause helper hand-installed from preview2 (helper sha256 a2de8a80…a93e; installed file 860e9f4c…1363)
- 0:49 Stand-ins: local stack, PostHog stand-in, Stripe test mode
- 0:52 …a hand-created agent inbox, and a Docker computer (not Firecracker)
- 0:56 Eve's computer is a real guest; right: its agent unit's FreezerState and the drive rows
- 1:02 Take over: the guest freezes Eve's agent unit (FreezerState frozen)
- 1:09 Hand back: the unit thaws (running)
- 1:17 Take over again, then pause the harness container: no keep-alive reaches the guest
- 1:24 Dead-man: with no keep for ~180 s, the guest thaws the agent by itself
- 1:34 (2.6 min of waiting cut; right: the frozen-for timer)
- 1:43 The guest thawed the agent 177 s after the harness was paused
- 1:49 Harness back (docker unpause): past the 120 s input lease, the drive ends as lapsed
- 1:56 Expected for a harness outage: nobody was driving any more either way
