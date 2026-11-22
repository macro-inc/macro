# PR B + freeze proof with agent Eve: preview2 931ef069298

**Build:** preview2 931ef069298 = PR A a7aeb9054f0 + PR B 3c56803e52f + captcha #11637. Local screen stack, headless Chromium.

**Verified before recording:** after a hard reload with the cache cleared, the served client contains PR B's new web strings ("has the computer back").

**Stand-ins (captioned in the video):**
- Local stack.
- PostHog stand-in.
- Stripe in test mode.
- An agent inbox created by hand: the image still lacks `/run/macro-agent-inbox`.
- A Docker computer instead of Firecracker.

**Not covered:**
- Hibernation while frozen. It is Firecracker-only; the local Docker fleet doesn't hibernate. Covered by unit tests.
- A real phone. The phone part uses Chromium's device emulation.

**Part 1 (0:00–2:03): PR B with Eve, VNC only.** Source: `out-eve2-0220`.
- The DM's Screen button opens Eve's desktop beside the DM.
- Take over: Eve is paused and its tools are held.
- Typing goes into a local Notes test page on Eve's desktop.
- A DM sent while Eve is paused gets no reply.
- Hand back with a note. Eve then answers the waiting DM.
- Emulated phone: Screen, Take over, Hand back.

**Part 2 (2:03–3:25): freeze check on Eve's real computer.** Source: `out-freeze2-0223`.
- Take over: `frozen` after 1.1 s. Hand back: `running` after 1.1 s.
- Take over again, then `docker pause` of the harness.
- Dead-man: the guest thawed the agent itself 177 s after the pause. 2.5 min of waiting is cut from the video.
- `docker unpause`: the drive ended as `lapsed` 0.1 s later. This is expected for a harness outage, because the 120 s input lease runs out before the 180 s dead-man.

**Part 3 (3:25–4:19): the unpaused path.** Source: `out-unpaused3-0249`. It uses t339's recipe:
1. As root in the guest, `chmod 000` the pause socket, then `systemctl thaw` the agent, while Alex keeps typing.
2. The keep and the refreeze both fail, and the drive ends as `unpaused`.
3. The viewer shows: "You're no longer driving: Eve couldn't stay paused, so it has the computer back." with Take over again.
4. With the socket restored (0660), the reap sets thaw_settled to `thawed`.

**Known in part 3:** the DM column shows "Eve isn't running: its computer is offline." That note is stale. The stack had been docker-stopped and started outside the control plane, so `hosted_runtime.state` still says phase=booting and macrod_connected=false. Eve answered a DM in 10 s right after the take.

**Hidden in post:** the ids in the browser address bar. I checked every part's contact sheet: no emails, hostnames or tokens.
