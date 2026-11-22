# Teammate runtime: running an agent teammate on your own computer

Status: proposed, being built. Test results: see *Test log*. This document
calls something tested only when a linked run passed.

## What it is

An agent teammate today always runs on a Macro computer bought for it. Its
runtime is a set of hardened systemd units on the agent image
(`nix/macro-box/_agent.nix`).

This change lets the teammate's owner host it instead on a machine of their
own that runs macrod. There, the teammate always runs in the **teammate
runtime container**: a pinned, Nix-built OCI image made from the same
closure as the hosted units. It never runs as a bare host process, and it
never mounts the host's home or Docker socket.

The teammate stays the same Macro user wherever it runs. Its code and memory
are its git repository. A machine holds one **install** of it:

- short-lived credentials that can be revoked on their own;
- two engine volumes: the agent's, and a separate one for the owner's
  provider sign-in.

## How it works

```
Invite (web) ── POST /team_agents {computer: {kind: "own", harnessId}}
   │  account, seat, repo (as today) + team_agent_installs row (new install id, generation 1)
   ▼
agent_harness_service (the replica holding the machine's macrod socket)
   │  on connect, or on a new generation:
   │  claim the delivery (compare-and-set on the row), mint credentials
   │  (a new API key, revoking the last; a new repo token)
   │  ── RunTeammate {install, image id, environment} ──►
   ▼
macrod (crates/coding_agent_worker/src/teammate)
   │  engine check (Docker or Podman); fetch the image, verify its id
   │  volumes; credentials file; docker run (flags below)
   │  ◄── TeammateStatus {downloading | starting | running | restarting | stopped | failed}
   ▼
teammate runtime container (nix/macro-box/_teammate-runtime.nix)
   teammate-entrypoint: dbus, Xvnc :1, Openbox, PulseAudio, Chromium (CDP 9223),
   then start-agent run (the same launcher as the hosted unit)
   → bun cli.ts run → reports online (POST /team_agents/me/online)
```

The owner's journey:

1. Invite a teammate. Under *Give it a computer*, the owner chooses *My own
   computer*. Only their own paired machines are listed. Ineligible ones are
   greyed out, with the text from *Eligibility*.
2. The owner reads the trust warning (*Trust*), then invites.
3. The row shows *Downloading*, then *Starting*, then *Running*, and the
   teammate messages its owner once it's online.
4. Later, the owner can move the teammate to another of their machines, or
   remove it, from its row.

### One runtime, two launchers

The runtime closure is defined once, in `nix/macro-box/_teammate-runtime.nix`:

- Bun;
- the starter agent's `node_modules`, with muppet, the SDK and
  observability;
- Claude Code and its wrapper;
- Chromium, Xvnc, Openbox, PulseAudio, ffmpeg, xclip;
- bubblewrap, computer-use-linux, git;
- `start-agent`, `agent-stopped` and the git credential helper.

Two launchers run it:

- **Hosted Macro computers** keep the hardened systemd units over the
  guest's `/nix/store`.
- **Own computers** run the OCI image of the same closure.

Both obey one contract (below).

**Decided from measurements: hosted computers keep units.** Running the
container inside the VM was measured on Firecracker against synthetic
computers on the private stack, then destroyed. The numbers are in
`docs/design/teammate-runtime-measurements.md`, with their method.

| | Units in the agent VM (chosen) | Container in the agent VM (measured) |
| --- | --- | --- |
| First start of a computer | Restore to guest ready: 0.9 s (agent role, n=1) and 1.06 s (fresh create). Cold start until the agent unit is active: p50 5.3 s (n=3). The runtime's closure is already in the golden's `/nix/store`. The agent process then starts in about 3.1 s (setup trace). A wake from hibernation takes 1.64 s and doesn't restart the agent. | The same, **plus** `docker load` of the image on each computer's first start: **33.9 s** for 1.5 GiB. |
| Each start | The unit starts. | Plus `docker run`: **815 ms** cold, 345 to 396 ms warm. |
| Disk | The shared, read-only `/nix/store`. | **+3.0 GiB per computer** on `/home` for a 1.5 GiB image (content plus snapshot, about twice the size), counted against the sold disk. |
| Isolation | The VM is the boundary. `macro` has no root, Docker or sudo. | No gain. The agent role has no Docker socket by rule, so it would need a root launcher or rootless Podman in the image. Container traffic also skips the guest's agent-group firewall rule (5900/9222, `_agent.nix:336`), which would have to be added again on `docker0`. |
| Snapshot | Nothing new. | Anything started before the snapshot must survive the identity reset. |

The container would buy hosted computers nothing they lack, at 34 s and
3 GiB a computer. The container is for machines that have no VM boundary.
The local numbers (image size, load, cold start, idle memory) are in the
same file.

### The runtime contract (v1)

| What | Hosted unit | Container |
| --- | --- | --- |
| Agent home | `~macro/agent` | `/teammate` (the agent volume) |
| Workspace (repo clone) | `~macro/agent/workspace` | `/teammate/workspace` |
| Boot state (`last-good`, `failed-boots`, `boot-head`) | `~macro/agent/state` | `/teammate/state` |
| Browser profile | `~macro/agent/browser` | `/teammate/browser` |
| Claude Code's config and transcripts (`CLAUDE_CONFIG_DIR`) | `~macro/agent/.claude` | `/teammate/home/.claude` |
| Credentials (`MUPPET_CREDENTIALS_FILE`) | systemd credential `agent.env` | `/run/teammate/agent.env`, a read-only bind of one file |
| Provider sign-in (`HARNESSD_STATE_DIRECTORY`) | harnessd's, read-only | the provider volume, mounted **read-only** at `/teammate-provider` |
| Restart marker (`MUPPET_RESTART_FILE`) | a path unit restarts the service | the entrypoint exits 75 and macrod starts the container again |
| Exit codes | One table for both (below) | the same, as the container's exit code |
| User | `macro`, no capabilities | uid 1000 `agent`, no capabilities |

Exit codes. This table is the only interpretation of them, in
`teammate_lifecycle`. The hosted unit and the container engine don't
interpret them.

| Code | From | Means | The supervisor |
| --- | --- | --- | --- |
| 0 | runtime | Stopped | *stopped* if a stop was asked for; otherwise starts again after at least 2 s |
| 75 | runtime or `teammate-boot` | Restart after a land: the runtime sees its restart marker change and exits 75 itself | Starts again at once, not counted |
| 77 | `teammate-boot` | The last run was a 78 on last-good: the settings are wrong, not the code | *failed: badConfiguration*, no restart; the service redelivers |
| 78 | runtime or `teammate-boot` | A setting or credential is missing or invalid | Starts again with backoff. `teammate-boot` counts it as a failed boot, so code that broke its settings rolls back. |
| 79 | `teammate-boot` (or the old `start-agent`) | The code needs a newer runtime (a newer muppet, or packages the image lacks) and nothing older would run | *failed: incompatibleRuntime*, no restart until a newer image |
| other | anything | A crash, or 1 from the runtime when Macro answers but chat's event stream didn't open within 3 minutes (a code fault) | Starts again with backoff from 2 to 60 s; `teammate-boot` counts it |

Offline is not an exit. A runtime that can't reach Macro at all stays up,
shown offline and not healthy (no `last-good`), and becomes healthy once
Macro answers and chat hears it; only a stream that doesn't open while
Macro answers ends the run, as a failed boot.

77 is new with `teammate-boot`. An older image's `start-agent` never exits
77, and it exits 79 with the same meaning, so a supervisor running an older
image during the migration treats every code the same way.

`agent.env` keeps today's variables: `MACRO_API_KEY`, `MACRO_GATEWAY`, the
service addresses, `MACRO_REPO_URL`, `MACRO_REPO_TOKEN`,
`MACRO_AGENT_USER_ID`, `MACRO_AGENT_NAME`, `MACRO_TEAM_ID`. An install has
no `MACRO_COMPUTER_ID` and gets `MACRO_TEAMMATE_INSTALL_ID` instead. The
service addresses are the public ones, not those a Macro computer uses.

### The container

macrod runs the container with exactly these flags:

```
docker run --detach --name macro-teammate-<install>
  --user 1000:1000 --read-only --cap-drop=ALL --security-opt=no-new-privileges
  --security-opt seccomp=<macrod's teammate profile>
  --pids-limit 512 --memory 4g --cpus 2 --shm-size 1g
  --tmpfs /tmp --tmpfs /run/teammate-runtime
  --network macro-teammate-<install>
  --mount type=volume,src=macro-teammate-<install>,dst=/teammate
  --mount type=volume,src=macro-teammate-<install>-provider,dst=/teammate-provider,readonly
  --mount type=bind,src=<macrod state>/teammates/<install>/agent.env,dst=/run/teammate/agent.env,readonly
  --label macro.teammate.install=<install> --label macro.teammate.generation=<n>
  --label macro.teammate.delivery=<n>
  --restart no
  <image id>
```

None of the following are used:

- `--privileged`, `--device`, or published ports (`-p`);
- host network, pid or ipc namespaces;
- binds of the host's home or of any engine socket.

The engine's own AppArmor or SELinux profile stays on. `--restart no`,
because macrod alone decides when to start the container again.

- **seccomp and the inner sandboxes.** muppet hides the credentials file
  from Claude Code and capability scripts with bubblewrap
  (`startup.ts` `hiding`). Chromium sandboxes its renderers. Both work inside
  an unprivileged user namespace, and Docker's default seccomp profile blocks
  what they need when the container lacks the matching capabilities:
  - `unshare` with `CLONE_NEWUSER`;
  - `clone` with namespace flags (Chromium's zygote forks renderers with
    `CLONE_NEWPID|CLONE_NEWNET` inside its user namespace);
  - `mount`, `umount2` and `pivot_root` (bubblewrap);
  - `chroot` (Chromium).

  macrod ships one profile, `nix/macro-box/files/teammate-seccomp.json`,
  built into macrod: Docker's default plus `clone` with any flags,
  `unshare` when the flags include `CLONE_NEWUSER` (other flags may come with it; the kernel still checks their capabilities inside the new namespace), `mount`/`umount2`/`pivot_root` and
  `chroot`, each allowed only where the default would allow it with the
  capability. With no capabilities, the kernel still refuses all of these
  outside a user namespace the process created itself (checked: `unshare -n`
  fails with `EPERM`). The inner sandboxes stay on, and `--no-sandbox` and
  `seccomp=unconfined` are never used.

  The trade-off: unprivileged user namespaces are kernel attack surface
  that Docker's default profile avoids. They are allowed here because they
  buy the bubblewrap credential hiding and Chromium's renderer sandbox.

  Ubuntu 24 and later restrict user namespaces through AppArmor too. There,
  the engine check probes for a user namespace inside a throwaway container,
  reports `innerSandboxUnavailable` when it can't make one, and the machine
  is not eligible.
- **The credentials file** lives in `<macrod state>/teammates/<install>/`,
  a 0700 directory owned by macrod's user. The file is 0644, so uid 1000
  inside the container can read it under any uid mapping; the 0700
  directory is what keeps other host users out. It is written whole, by
  rename, on every new generation (the container is recreated, which
  picks up the new file), and deleted on stop. On Docker Desktop
  (macOS, Windows) it reaches the engine's Linux VM through the Desktop
  file share.
- **The provider volume** is written only by `macrod teammate sign-in`.
  That command runs a separate short-lived container: the same image,
  without the agent's credentials and with the provider volume read-write.
  It runs `claude setup-token` there, and the result is
  `/teammate-provider/claude/credential.json`, mode 0600, owned by uid
  1000. The agent mounts the volume read-only, so it can use the sign-in
  but never replace it. It can still read it, as the hosted agent reads
  harnessd's. A move or a removal deletes the volume, and the owner signs
  in again on the new machine.
- **Rootful Docker** is allowed and reported (`rootless: false`). The agent
  is uid 1000 with no capabilities either way, but the docs recommend
  rootless Docker or Podman.

### Network

Each install gets its own user-defined bridge network,
`macro-teammate-<install>`, which macrod creates with the container and
deletes with it. Two teammates on one machine therefore can't reach each
other. No ports are published, so Xvnc `:1` (127.0.0.1:5901) and Chromium's
CDP (127.0.0.1:9223) are reachable only from inside the container's own
network namespace. The host and the LAN can't reach them.

The teammate needs the internet: Macro, the model gateway, git, and the web
for its browser. It must not reach the machine it runs on, the owner's
network, a cloud VM's metadata service, or another teammate. Neither engine
stops that by itself. Measured on a cloud VM (method and numbers in
`docs/design/teammate-runtime-measurements.md`), from Docker's bridge, from
pasta (the network rootless Podman uses) and from pasta with
`--no-map-gw`, a TCP connect reached:

- the cloud metadata address `169.254.169.254:80`;
- the network's gateway (its DNS port).

**So macrod enforces egress itself, the same way on both engines** (status:
being built; results in the *Test log*). The rules live in the install's own
network namespace, never in the host's firewall:

1. **Holder.** `macro-teammate-<install>-net` owns the network namespace: the
   pinned image running `sleep` as uid 1000 with every capability dropped, on
   the install's bridge network.
2. **Guard.** A one-shot container from the same image joins the holder's
   namespace with `NET_ADMIN` only (uid 0, every other capability dropped).
   It mounts nothing, loads the ruleset macrod passes on stdin, and exits.
3. **Teammate.** It joins the holder's namespace (`--network
   container:<holder>`) with no `NET_ADMIN` or `NET_RAW`, so it can't change
   the rules. A restart reuses the holder. If the holder dies, the teammate
   has no network: it fails closed.

Before every teammate start, including after adopting a running container,
macrod reads its table back (`nft -j list table inet macro_teammate`, normalized; drops in any base chain are final, so other tables can't loosen it) and compares
it with the one it rendered. If the rules are missing, changed or can't be
applied, the start is refused with `failed:
networkIsolationUnavailable`; it never falls back to an open network. A
host with no default (or split default) route, v4 or v6, has only routes
to networks the rules drop, so the agent would run and reach nothing,
Macro included: its start is refused with `failed: egressBlocked`
instead. An adoption isn't checked for routes: a running agent whose
rules read back intact keeps running while the host is offline. Either
refusal is tried again with the restart backoff five times (about 30 seconds), then
the agent is parked: the service shows `failed` with the reason while
macrod keeps trying, waits doubling from 1 to 10 minutes, and starts it
on the first try that passes (an engine back up, a VPN reconnected). A
dockerd, firewalld or host iptables reload doesn't touch rules inside a
container's namespace. A holder that exits counts as a teammate crash, and recovery runs holder,
guard, then teammate. A stop removes the holder and the network with the
install.

The agent starts only after the guard has exited and macrod has read the
rules back and found them as rendered; the holder's networks are attached
before it starts. So the agent never runs without its network or its rules,
and macrod doesn't poll for readiness. A slow first connection after a start
costs the runtime one retry: its streams retry with backoff (an agent that
starts while Macro or the network is unreachable stays up and retries).

The ruleset filters each connection by its destination, after DNS, for TCP,
UDP and ICMP alike:

- **Allowed:** the container's own loopback, replies, DNS (port 53) to the
  engine's resolver and the exact upstream resolvers it forwards to, and
  every public address.
- **Dropped:** the host's own addresses, its on-link prefixes (IPv4 and
  IPv6, so a LAN on public or global addresses is covered) and its gateway,
  read from the host's interfaces and routes at every teammate start (an
  interface that comes up later is covered from the next start). Every
  route's destination is dropped except the default and a VPN's split
  defaults (IPv4 `/0` and `/1`, IPv6 up to `/3`), which are the internet; IPv4 0/8, 10/8, 100.64/10 (CGNAT and tailnets), 127/8 off
  loopback, 169.254/16 (link-local and metadata), 172.16/12, 192.0.0/24,
  192.168/16, 198.18/15, multicast and reserved; IPv6 `::1` off loopback,
  `::ffff:0:0/96` (v4-mapped), the NAT64 prefixes, `fc00::/7` (ULA,
  including `fd00:ec2::254`), `fe80::/10` and multicast.
- **Exceptions:** only the owner's explicit entries in macrod's config,
  each a network and its TCP ports:

  ```toml
  [[teammates.allow]]
  network = "10.20.0.5/32"
  ports = [8101]
  ```

  macrod rejects `/0`, loopback, anything overlapping the metadata ranges,
  and an entry without ports, when it starts.

Because the filter sees the connection, not the lookup, DNS rebinding, a
redirect, a proxy `CONNECT` to a private target and odd IP spellings all end
in a dropped connect.

What the rules don't cover:

- **Facts from the start.** macrod reads the host's addresses, prefixes,
  routes and engine networks when a teammate starts. An interface, a route
  or an engine network on a public subnet that appears later is covered only
  from that teammate's next start.
- **The LAN resolver's DNS port.** When the engine forwards DNS to a resolver
  on the LAN (a home router, say), port 53 on that one address is reachable
  from the agent, as DNS needs. Nothing else on that address is.
- **Macro reached through a specific route.** A host that reaches Macro only
  through a narrower route (a VPN that routes just Macro's addresses, with no
  default or split default) has that route's network dropped like any other,
  so the agent can't reach Macro. It isn't reported as `egressBlocked`, which
  covers only a host with no route to the internet at all; the agent shows
  as offline.

macrod picks the engine with `[teammates] engine = "auto" | "docker" |
"podman"`. `auto` tries Docker, then Podman, and takes the first whose
isolation probe passes. The host report names the engine, and a machine
where no engine can enforce the rules reports `networkIsolationUnavailable`,
so the Invite form shows it disabled with that reason.

On a local stack only, macrod's `[macro] teammate_network` names the stack's
Docker network (`macro-<instance>_services`), which the holder also joins,
and allows only the service address and port pairs the install was given
(never the subnet, which other teammates share), so the agent reaches the stack's services
by their in-network names; the service gives a local install those
addresses, as it gives a local Macro computer. Production never sets it.

### Identity, installs and the single-active lease

- `team_agent_installs` has one row per agent, keyed by the agent, so an
  agent has at most one install. The row holds:
  - `install_id`, new for every machine: a move makes a new install, so a
    move back never reuses a stale volume;
  - the harness;
  - `generation`, which goes up on a new install, an image update or a
    credential rotation;
  - `delivery`, the count of mints for that generation, and the
    `applied_generation` and `applied_delivery` macrod confirmed.
- **Deliveries are counted, and a resend is idempotent.** A delivery is
  `(generation, delivery)`.
  - The replica holding the socket locks the row (`SELECT … FOR UPDATE`).
    It delivers only when the runtime's last report, or its last status,
    shows a lower `(generation, delivery)` than the row's.
  - It then increments `delivery`, mints credentials and sends
    `RunTeammate` with the new pair, all in that transaction.
  - macrod applies the highest pair it has seen and ignores lower ones, so
    a late copy of an older delivery can't replace a newer one.
  - `applied_generation` and `applied_delivery` advance only when macrod
    reports `starting` or `running` for that pair: a confirmed apply.
  - A failed send leaves the runtime behind, so the next connect delivers
    again, with a higher `delivery`. Re-minting at the same generation is
    safe: it revokes a key nobody received.
  - Two replicas racing are serialized by the row lock. Each delivery
    revokes the previous key, and the runtime keeps only the highest pair,
    which is the last one minted.
  - A reconnect between a successful send and macrod's `starting` status
    re-mints once more: the key rotates and the container restarts once. It
    doesn't loop, because the next report shows the new pair applied.
- **The key name** is the same fixed one the hosted path uses
  (`replace_key` with the agent's brain key name). An agent has either a
  computer or an install, never both: an own-computer invite always makes
  a new agent. So a hosted key and an install key are never both live.
- **Reconnects are idempotent.** On connect, macrod's `TeammateHost` report
  lists the installs and generations it keeps. The service delivers only
  when that generation is behind the row. A flaky network never rotates
  keys or restarts the agent.
- **Moving to another machine** (`POST /team_agents/{agent}/install`)
  checkpoints first, then revokes:
  1. The row is marked `moving`, with the target harness.
  2. If the old machine is connected, it gets `StopTeammate`. macrod runs
     `docker stop -t 90`. On `SIGTERM`, the agent runs one final sync
     (commit, `pull --rebase`, push) when no wake is running, then exits 0.
     If a wake is running, the wake's own commit-and-land runs as it
     finishes, within the 90 seconds. A wake still running at 90 seconds
     is killed, and its unpushed work is lost. macrod reports `stopped` and deletes
     the container, its volumes and its credentials file.
  3. Once `stopped` arrives, or after 120 seconds, or at once when the old
     machine is offline, the row moves to the new harness with a new
     install id and the next generation. Only then are new credentials
     minted. Minting revokes the old key and repo token.

  The old install is never revoked while it may still be pushing its
  checkpoint. When the move finishes, the old key and repo token are
  revoked at once, not at the new machine's first delivery. An offline old
  machine loses only the work since its last push, which was never in the
  repo.
- **Removing** works as today (`revoke_all`, a new repo token, the seat
  removed). The checkpoint stop of the move runs first; the row is deleted
  last.
- **A replaced install that missed its stop**, because its machine was
  offline, runs with a revoked key. When the agent's Macro calls get a 401,
  the agent exits 78. macrod reports `failed: badConfiguration` and doesn't
  restart it. When the machine reconnects, its report lists the stale
  install, and the service sends `StopTeammate`, which deletes it. Until
  then, the stale volume (browser profile, transcripts, provider sign-in)
  stays on that machine. The teammate's profile says so: *"An old copy is
  still on my-laptop, deleted when it next connects"*.

### Lifecycle on the machine

- **macrod restarts, or the host reboots.** On start, macrod reads its
  install store and finds each container by its label. One that is still
  running is adopted, never recreated. A container that is gone, or exited
  while macrod was down, is started again.
- **Unpaired or removed machine.** One window covers every path that
  sends macrod's harness credentials: the runtime dial (a 401 or 403) and
  the bound-agent check the trigger stream makes every 10 seconds and at
  each reopen (a 401). When they are refused, and refused again 10 to 60
  seconds after the first refusal with no harness call accepted between,
  macrod stops every teammate it runs and its holder, with 10 seconds'
  grace (the agent's key went with the machine's). It keeps the volumes
  and the kept install, records why, and reports `stopped`. Any accepted
  call ends that path's refusal; once no path is refused, the agents run
  again (the service stops any it no longer wants there). A dial an edge
  keeps refusing isn't cleared by the stream's calls, so the agents stop
  once and stay down until a dial is accepted. An auth outage ends by
  itself, without a restart: within about 10 seconds of its end (the next
  bound-agent check) when only the stream was refused, and at the next
  runtime redial when the dial was too (within a minute, or 8 to 12 once
  it had been refused for 10); a refusal later than 60 seconds starts the window
  over, so blips far apart never add up. From the unpair the stop takes up
  to about 40 seconds: up to 10 to notice, a second refusal 10 to 20 later
  (the stream's reopen backoff), then the grace. A refused runtime dial is
  redialed 1 second doubling to a minute apart, and every 8 to 12 minutes
  once the refusal has lasted 10; an unpaired machine is never accepted, so its
  agents stay down. A runtime supervisor that ends (a client error it
  doesn't redial) takes its dial's refusal with it, so the stream's next
  accepted call runs the agents. A stop the service asked for is never undone.
- **Crash loop.** Failed exits (not 0, not 75) restart with a backoff from
  2 to 60 seconds, for as long as they keep failing; macrod never gives up
  on a generation by itself. `crashLoop` is only the reason an image update
  rolls back, when the new image's container doesn't stay up. An exit is
  counted only
  against the container with the current delivery's label, so a container
  being replaced never counts against the new one.
- **Logs**: `macrod teammate logs <install>` (the engine's logs for the
  container). Also `macrod teammate list` and `macrod teammate sign-in
  <install>`.

### Updates: the runtime image and the agent's code

The runtime image (muppet, the SDK, Claude Code, Chromium, the launcher) and
the agent's code (its repository) ship separately. This section says how each
reaches a self-hosted install, and labels every step:

- **tested**: implemented, with a passing run in the *Test log*;
- **untested**: implemented, but its tests haven't run yet;
- **planned**: not built.

| Step | How it works | Status |
| --- | --- | --- |
| Which image an install runs | `TeammateRuntimeImage` in `team_agents` holds one image id per architecture, the config digest the Nix build fixes. Both ids are `None` today, because no image is published. So every machine reads *unsupported platform* and gets no install. | untested |
| A new image reaches a machine | A new image id is a new generation for every install. Each is delivered like any generation: on the machine's next connection, or at once while it is connected. The service raises the generation when a machine reports an install whose delivered image differs from the configured one. | tested (end to end, *Test log*) |
| Publishing the image to a registry | It needs approval and isn't part of this change. Until then a machine gets the image with `docker load` (`nix build .#teammate-runtime-image`), as the tests do. | planned |
| Fetch and verify before replacing | macrod loads `<repository>:<id hex>`, refuses an image whose id differs (`failed: imageMismatch`), and leaves the running container alone until the new image is verified. | untested |
| The agent's volume is kept | A new generation recreates the container on the same `macro-teammate-<install>` volume (workspace, state, browser, Claude's files). Only a stop deletes the volume. | untested |
| Checkpoint before a container is replaced or stopped | `docker stop -t 90`. On `SIGTERM`, the agent runs one last commit, `pull --rebase` and push when no wake is running. | tested (image test: stop exits 0 after the last sync is pushed) |
| Credentials across an update | Each delivery mints the agent's key again, which revokes the previous one, so the replaced container's key stops working. The new container, or a rolled-back one, runs with the new delivery's credentials. | untested |
| A failed pull or start of the new image | macrod keeps the previous image's id in its install store. If the new image can't be fetched or verified, or its container doesn't stay up for 120 seconds, macrod starts the previous image again with the new credentials and reports `rolledBack {reason}`. The rollback is to the image the replaced container ran, never further back. | tested (end to end, *Test log*) |
| Code that needs a newer runtime | The launcher's muppet API check (`muppetApi` in the code against the image's `apiLevel`) runs in the container as on hosted computers. If landed code needs more and last-good would run, it exits 78 and the next start rolls the workspace back. If there is nothing older to roll back to, it exits 79. macrod treats 79 as `failed: incompatibleRuntime` and doesn't restart the container until a newer image arrives. | tested (end to end with a test image that exits 79) |
| Other exits | Like the hosted unit (`Restart=always`): macrod restarts the container with a backoff from 2 to 60 seconds. Three failed boots in a row roll the code back to last-good, inside the container. Three 78s in a row are `failed: badConfiguration`, which the service answers with a new delivery, at most once per 5 minutes. | planned in this branch |
| Offline machines | An offline machine keeps running the generation it has. Its key stays valid, because a key is minted only when a delivery reaches a connected machine. When it reconnects, its report shows it behind, and it gets the new generation then. A reconnect at the same generation and delivery sends nothing. | untested (the delivery tests are in the service's test run) |
| Runtime before code | Rolling a new image out before code that needs it is a recommendation, not something this change coordinates. The muppet API check is what makes the opposite order safe: the code stops or rolls back instead of breaking. | not built (recommendation) |

## Lifecycle controller (plan, being built)

Today two supervisors own an agent teammate's life:

- **On hosted computers, systemd runs it.** The hardened system unit
  `macro-agent.service` uses `Restart=always`, a path unit restarts it when
  `agent.env` or the restart marker changes, and `ExecStopPost=agent-stopped`
  counts failed boots (`nix/macro-box/_agent.nix`).
- **On an owner's machine, macrod's container supervisor runs it**
  (`crates/coding_agent_worker/src/teammate/supervisor.rs`).

Both run the same bash launcher, `start-agent`. On every start it:

- validates `agent.env`: missing settings exit 78;
- clones the repository and configures git;
- rolls back to last-good after three failed boots;
- adopts the image's `bun.lock`;
- links the image's `node_modules`;
- checks the muppet API the code needs against the image's (exit 78 if
  last-good would run, else exit 79; #11294);
- runs `bun cli.ts run`.

They interpret exits differently. For example, the container supervisor
treats 79 as a crash. This plan replaces both with one Rust controller.

### Flow

```
macrod (always running; systemd only keeps macrod alive)
  └─ teammate_lifecycle::Supervisor          one per install, pure policy + ports
       desired: generation, delivery, image id, credentials file
       ├─ Backend::Container  docker/podman argv (today's teammate engine)
       └─ Backend::HostedUnit systemctl start/stop of the hardened unit
                              (Restart=no; a polkit rule lets macro manage only it)
            └─ teammate-boot (Rust binary in the image and on hosted guests)
                 replaces start-agent + agent-stopped; then execs bun cli.ts run
```

- **`teammate-boot`** runs inside the sandbox (the container, or the
  hardened unit). It decides with one pure function:
  `plan_boot(state, previous_exit, head, last_good, levels, lock) -> BootPlan`.
  - Its inputs:
    - the boot state files (`last-good`, `failed-boots`, `boot-head`, kept
      where they are);
    - the previous run's exit, passed by the supervisor as
      `TEAMMATE_PREVIOUS_EXIT`;
    - the code's and the image's muppet levels.
  - Its decisions: count or reset the failed boots (what `agent-stopped`
    does today), roll back, adopt the lock, link `node_modules`, then exit
    78 or 79, or start the runtime.
  - Git and Bun stay external programs. It calls them with typed argv,
    bounded output, deadlines, and process-group cleanup.
- **The `Supervisor`** runs in macrod. It decides with one pure function:
  `on_exit(policy_state, exit) -> Action`.
  - Exit 75: start again at once. Exit 0 on a requested stop is *stopped*.
    An unrequested exit 0 starts again after at least 2 seconds.
  - Any exit of a stop the supervisor asked for reaches the next boot as
    `TEAMMATE_PREVIOUS_EXIT=0`, as systemd counts a `SIGTERM` as success.
    77 and 79 never count as failed boots. `unknown` counts once when the
    boot it ended never became healthy (its boot head isn't last-good), so
    a lost exit never hides a crash; that includes a stop the supervisor
    asked for whose exit it then lost, deliberately.
  - More than 10 starts within 10 minutes, of any kind, slow the next start
    to 60 seconds, so no exit can loop hot.
  - Exit 79: *failed: incompatibleRuntime*. Not restarted until a newer
    image arrives.
  - Exit 78 is counted as a failed boot, as `agent-stopped` counts it, so
    code that broke its own settings rolls back on the fourth start.
    - `teammate-boot` exits 77 instead when the last run was a 78 and any
      of these holds: the boot was on last-good, there is no last-good, or
      `agent.env` is still invalid. In each case the settings are wrong, not
      the code, and rolling back can't help.
    - The supervisor treats 77 as *failed: badConfiguration* and doesn't
      restart. The service answers with a new delivery, at most once per 5
      minutes.
    - So a rollback always comes before the supervisor gives up.
  - Code that needs a newer runtime (a newer muppet, or dependencies it
    changed, which need packages the image lacks), with a last-good that
    fits, is rolled back by `teammate-boot` in the same boot, without an
    exit. With none that fits, it exits 79.
  - Anything else: start again with a backoff that doubles with each failed
    exit in the last 10 minutes (2, 4, 8, 16, 32, then 60 seconds), so it
    resets itself. `teammate-boot` rolls the code back after three failed
    boots.
- **Image replacement** (container backend):
  1. Fetch and verify the new image id.
  2. Stop with a checkpoint (`SIGTERM`, then the last sync, within 90 s).
  3. Start the new image on the same volumes.
  4. If it isn't up for 120 s, or the fetch fails, start the previous image
     again with the new credentials and report *rolledBack {reason}*. Only a
     crash, a 78 or a lost process during those 120 s rolls back, and only
     once. Exits 0, 75, 77 and 79 follow the exit table. A 79 means the code
     needs even more than the new image, so the older image can't help: it is
     *failed: incompatibleRuntime*.

  Hosted computers get new images through their VM image (`hosted_runtimes`),
  never through this.
- **The supervisor's own state** survives macrod restarts, including a
  self-update re-exec or a TUI restart:
  - the backoff, the start rate, and the last exit are kept per install in
    macrod's install store;
  - a container or hosted unit that is still running is adopted, not
    restarted. Containers are found by their labels, and the hosted unit by
    its systemd state.
  - `TEAMMATE_PREVIOUS_EXIT` is `unknown` when the supervisor didn't see the
    exit (the process died while macrod was down). `teammate-boot` counts it
    once if that boot never became healthy, and the next boot records its
    own head first, so nothing is counted twice.
  - Kept times later than the clock (it stepped back) are dropped as stale,
    and no kept wait runs past 60 s.
- **On hosted computers**, macrod runs as `macro` (`macrod.service`). A
  polkit rule lets `macro` start, stop and restart exactly
  `macro-agent.service` and nothing else, and the VM test checks that it
  can't touch another unit.
- **One exit-code table.** Once the controller owns the hosted unit, the
  unit no longer interprets exit codes itself.
- **Out of scope:** herdr native sessions and the coding agents macrod runs.
- **Status** goes to the service as `TeammateStatus`, from both backends.

### Migration stages (each one reviewable, each one tested)

1. **`crates/teammate_lifecycle`**: the pure `plan_boot` and `on_exit`
   policies, the image-replacement policy and the ports, with the
   regression suite below. Nothing is wired yet.
2. **Containers**: `teammate-boot` becomes the image's launcher, replacing
   `start-agent` and `agent-stopped` there. macrod's container supervisor
   uses `on_exit`, which fixes 79. The Docker contract test runs again.
3. **Image replacement and rollback** in the container backend, through
   the fake engine and real Docker. This includes swapping the image during
   an active session: only the container is replaced, so macrod's runtime
   connection and the sessions' agent on it stay up (no redial, nothing to
   re-attach), and the teammate in the new container dials Macro itself. A
   redial that does happen (macrod restarting) re-attaches its sessions
   through the harness (`agent_harness` reattach).
4. **Hosted computers**: the unit gets `Restart=no` and
   `ExecStart=teammate-boot`, and `ExecStopPost` and the path unit go.
   macrod drives the unit through `Backend::HostedUnit`, and `ApplyAgent` and
   the restart marker become controller events. A system unit can't take an
   environment variable per start from an unprivileged caller, so macrod
   writes the previous exit to `/run/macro-agent/previous-exit` (a directory
   `macro` owns), and the unit reads it with `EnvironmentFile=`. The VM test
   (`nix/macro-box/_vm-test.nix`) proves it. This changes how hosted agents
   run, so it ships only with a new guest image, behind the hold.
5. **Lifecycle telemetry.**
   - Bounded spans and metrics, through macrod's existing opt-in OTLP
     (`src/telemetry.rs`):
     - the desired and running image, runtime and code versions;
     - download, checkpoint, start and readiness;
     - retries, and rollback reasons and outcomes;
     - delivery and reconnect state.
   - Self-hosted macrod exports through a new authenticated ingest on
     agent_harness_service (`POST /teammates/telemetry`, harness
     credential). The server stamps the install from the caller's identity
     and enforces an attribute allowlist, rate limits and payload limits. An
     offline machine keeps a bounded buffer. Nothing waits on export at
     start.
   - Metadata only: no prompts, tool payloads, environment, credentials, file
     contents or host paths.
   - One trace runs from Invite, through delivery (the `traceparent` on
     `RunTeammate`), to macrod, the container and online.

### Regression tests (stage 1 unless marked)

| Case | Expected outcome |
| --- | --- |
| Healthy boot marker written | Failed boots reset to 0. Last-good is the boot's head. |
| Deliberate stop (exit 0 on request), and stop before start | *stopped*, no failed boot (the image test covers it, stage 2) |
| Restart after a land (75) | Started again at once, not a failed boot |
| Failed-startup threshold | The third failed boot rolls back to last-good, recorded as a commit |
| Last-good restored, then its own early death | Not counted toward another rollback |
| Incompatible code, with a compatible last-good | 78, counted, rolled back on the next start, then runs |
| Incompatible code, no compatible last-good | 79: *incompatibleRuntime*, no restart until a newer image |
| Malformed config (`agent.env`, `muppetApi`) | 78, counted. On last-good the next boot exits 77, which is *badConfiguration* with a redelivery. |
| `on_exit` and `plan_boot` together: a land that breaks its settings | 78 three times, then rolled back on the fourth start, never *badConfiguration* first |
| An unrequested exit 0, repeatedly | Started again after at least 2 s, then slowed to 60 s by the start-rate cap |
| macrod restarts while the agent runs or after it died | Adopted if running. Otherwise started with `TEAMMATE_PREVIOUS_EXIT=unknown`: counted once if that boot never became healthy, never twice. |
| Code that changed its dependencies | Rolled back in the same boot to a last-good with the template's; with none, 79 |
| Network failure at start (Macro or git unreachable) | Stays up and retries, no failed boot (`mac-07b`; image test, stage 2) |
| Image fetch, verify or start failure | The previous image runs again, *rolledBack {reason}* (stage 3; fake engine and real Docker) |
| Persistent volumes kept | Same volume across generations and rollbacks. Deleted only on a stop (stage 3). |
| Offline reconnect idempotency | Same `(generation, delivery)` sends nothing. A machine behind gets one delivery (service tests). |

### Outcomes an update can have

| Situation | Outcome | Status after |
| --- | --- | --- |
| New image fetched, verified, up 120 s | Runs the new image on the same volume | *running* |
| New image can't be fetched or its id differs | Keeps or restarts the previous image with new credentials | *rolledBack: imageUnavailable / imageMismatch* |
| New image starts but dies within 120 s | Previous image, new credentials | *rolledBack: crashLoop* |
| New image runs; code needs a newer runtime, no compatible last-good | Stopped | *failed: incompatibleRuntime*, waits for a newer image |
| New code needs a newer runtime, last-good compatible | Code rolled back inside the container | *running* (on last-good) |
| Machine offline during an update | Keeps the old image and a valid key | catches up on reconnect |

### Eligibility and the engine check

macrod checks for an engine when it starts, and again when it reconnects.
While a connection's check finds the engine unreachable (Docker Desktop
not started yet, say), macrod checks again every 30 seconds and sends each
result as a fresh `TeammateHost` report. Once the engine answers and
nothing is wrong, it redials, so the dial lists `teammate-container`;
with a turn running it waits for the turn to end.
For Docker it runs `docker version` (it needs Engine 24 or later, for
`--security-opt` seccomp files and `--mount` volumes). For Podman it runs
`podman info` (4.4 or later, for pasta). It never installs an engine. It
lists `teammate-container` in its dial header only when an engine answers
and nothing is wrong, and it always sends a `TeammateHost` report.

A machine is eligible for an invite when all of these hold:

- the inviter owns its harness;
- it is connected;
- its last report has an engine and no problem.

What each problem says to the owner:

| Problem | Shown as |
| --- | --- |
| `noEngine` | *Install Podman or Docker to host teammates here.* |
| `engineUnreachable` | *Podman or Docker didn't answer. Is it running, and can you use it without sudo?* |
| `unsupportedPlatform` | *There's no teammate runtime for this computer's system yet.* |
| `belowFloor {cpus, memory, disk}` | *This computer needs at least 2 CPUs / 8 GB of memory / 20 GB free.* |
| `innerSandboxUnavailable` | *This computer's security settings block the teammate's sandbox.* |
| `networkIsolationUnavailable` | *Can't lock down an agent's network on this machine.* No engine on it could apply and verify the agent's network rules, so it gets no install rather than an open network. |
| (no report: older macrod) | *Update macrod to host teammates.* |
| (offline) | *Offline.* |

An install's run failures `networkIsolationUnavailable` and `egressBlocked`
(*this machine has no route to the internet*) are not final: macrod keeps
retrying them, up to 10 minutes apart, and the agent's Members row shows
the reason meanwhile.

The hardware floor is 2 CPUs, 8 GiB of memory and 20 GiB free, with the
container limited to 2 CPUs, 4 GiB and 512 processes. It is checked against
the local measurements (`teammate-runtime-measurements.md`):

- the idle stack uses 420 to 620 MiB, which leaves the 4 GiB limit room for
  Chromium pages and calls;
- the image is 3976 MiB once loaded (1.4 to 1.5 GiB compressed), so the
  20 GiB free covers the image, a second copy during an update, and the
  agent's volume.

Peak memory during a call is not measured yet. Measure it before the limit
is lowered.

| Platform | Engine | Status |
| --- | --- | --- |
| Linux x86-64 | Docker Engine | Target. Status: see *Test log*. |
| Linux x86-64 | Rootless Podman | Target. Status: see *Test log*. |
| Linux arm64 | Docker or Podman | Target (image built for `aarch64-linux`). Status: see *Test log*. |
| macOS, Windows | Docker Desktop, Podman machine | Detected, but no teammate runs there: macrod can't read the host's addresses and routes the rules need (`ip` is missing), so the machine reports `networkIsolationUnavailable` and the Invite form shows it disabled with *Can't lock down an agent's network on this machine.* |

### Provider sign-in and sessions

- **Model access.** By default, through Macro credits on the brain gateway,
  as on hosted computers: normal model usage. Alternatively, the owner's
  own Claude plan, through `macrod teammate sign-in` (see *The
  container*). The sign-in is never in the repository or the agent volume.
- **Sessions.** muppet starts a fresh Agent SDK session on every wake
  (`packages/muppet/agents/claude-code.ts`). The agent's continuity is the
  repository's `state/memory` and `state/private`. Claude Code's
  transcripts live in the agent volume, under `CLAUDE_CONFIG_DIR`: private,
  and never in git. The starter agent's `.gitignore` covers `.agent/`.
  Same-harness resume isn't used, so nothing claims to resume. A move does
  not export or move transcripts.

### Trust

Anything running as the machine's owner can read the teammate's
credentials (`agent.env`) and its volume, and so act as it: the owner, any
program they run, including the coding agents macrod runs there (which other
people can prompt), and anyone with admin or root on the machine. A path
deny wouldn't help: those coding agents aren't sandboxed and have the owner's
uid and the engine socket. The Invite dialog says so before Invite, in the
warning tone, with the network line from *Network*.

Only the machine's owner can host a teammate there, and only the admin who
invited it or the owner of the machine it runs on can move it. When the
hosting owner is removed from the team, stops being an admin, is deleted, or
unpairs the machine, the service parks the install: it revokes its key and
repo token before anything else is delivered, and the machine stops it. That
happens as part of the change itself: the team service parks after a member
is removed or demoted, and the harness service asks the auth service to park
after a machine is unpaired. A sweep the auth service runs every 60 seconds
over installs on such machines catches whatever those miss (a failed call, a
deleted account), and at the next delivery the service refuses and parks. A parked agent keeps its account, seat, DMs
and repository. Members shows it stopped, saying its machine can no longer
host it. Its new machine gets its key, DMs and shares, and any admin can
park it by removing its host, so only its inviter, the team's owner, or the
owner of the machine it was parked off, once an admin again with that machine
still paired, may move it to a machine of theirs (the same machine again
after a brief demotion); no other admin. After a re-pair the machine is new,
so its inviter or the team's owner moves it. Nothing restarts it by itself. Deleting the team takes every agent off its machine first
(revoked, stopped, install deleted); the database refuses to delete a team
or machine that still has an install. Hosted team agents keep their own
computers.

### Observability

- On the service: the spans `teammate.deliver` (the claim, mint and send)
  and `teammate.status`.
- On macrod: the spans `teammate.run`, `teammate.pull`, `teammate.start`
  and `teammate.stop`.
- All of these carry `install_id` and `generation`, never the agent's
  account.
- `RunTeammate` and `StopTeammate` carry the sending span's `traceparent`,
  and macrod's spans join it.
- The agent's own `agent.start` joins through `MACRO_SETUP_TRACEPARENT`.

### Billing

v1 charges no runtime fee for a self-hosted teammate. Model usage is billed
as today, or comes from the owner's own sign-in.
`SelfHostedTeammatePricing` in team_agents' config is `None` until pricing
is set. A credits-only price would remove the own sign-in. Nothing writes to
billing.

### Flags

The whole feature sits behind `enable-self-hosted-teammates`, checked on the
acting person, on top of `enable-agent-teammates`. PostHog is not changed,
so it is off everywhere.

### Not in this change

- No erase path: nothing here converts or erases a person's computer.
- No container on hosted computers.
- No registry publishing.

## Acceptance checks

- The protocol round-trips `RunTeammate`, `StopTeammate`, `TeammateHost` and
  `TeammateStatus`, and refuses install ids that could escape a container
  name.
- The image builds from the shared closure, and the hosted units still
  evaluate. The image is run with the exact flags above, with synthetic
  credentials and a local git server. Inside it:
  - uid 1000, `CapEff` 0, a read-only root, no mounts besides the three;
  - bubblewrap and the Chromium sandbox both work;
  - display `:1` is up;
  - the repo is cloned and `node_modules` linked;
  - `start-agent` reaches `bun cli.ts run`;
  - on `SIGTERM`, the agent pushes its final sync.
- macrod, against a fake engine:
  - declares the capability only when an engine answers;
  - reports each problem;
  - refuses an image whose id differs;
  - ignores an older generation;
  - starts the container again after exit 75;
  - fails on exit 78 and on a crash loop;
  - adopts a running container after its own restart;
  - deletes the volumes on stop.

  The same checks also run, in an ignored test, against a real engine.
- The service:
  - creates an install only for the inviter's own eligible harness;
  - delivers once per generation, so a reconnect at the same generation
    sends nothing;
  - when two deliveries race, the runtime ends up running the last key
    minted, and it is the only live key;
  - a send that fails after the mint is delivered again on the next
    connect, and only that new key is live;
  - on a move, stops the old install before minting for the new;
  - on a removal, stops the install and deletes its row.
- The web Invite dialog shows *My own computer*, with eligible machines,
  greyed-out machines with each problem's text, and the trust warning.
- `just check` and the tests of the crates touched; CI green on the exact
  head.

## Test log

Filled in from runs that actually passed, each with its command or CI job.

| Date (UTC) | What | Command | Result |
| --- | --- | --- | --- |
| 2026-11-20 | Protocol messages (dev box, x86-64) | `cargo test -p agent_runtime_protocol` at 3185cffb1e5 | 64 passed |
| 2026-11-20 | The image under macrod's flags, Linux x86-64, Docker 29.5.1 | `nix run .#teammate-runtime-test` at 96edc603bdd | 21 of 21 checks: uid 1000, no capabilities, no new privileges, read-only root, exact mounts, no engine socket, display :1, CDP, clone and `node_modules`, token in no process environment, bubblewrap hides `agent.env`, Chromium renderers sandboxed with the shipped seccomp, restart marker exits 75, stop exits 0 after the last sync is pushed |
| 2026-11-20 | Hosted units unchanged by the refactor | `nix eval` of the `macro-box` and `macro-box-firecracker` toplevels, agent mode on and off | `macro-agent*` units, tmpfiles rules and `/etc` identical |
| 2026-11-20 | Starter agent, including the `SIGTERM` sync | `bun test` in `packages/starter-agent` at 289384d3172 | 645 passed, 2 skipped, 0 failed |
| 2026-11-20 | Install storage, eligibility, invite, move and remove | `cargo test -p team_agents --all-features` (local throwaway Postgres) at ab174a08908 | 96 passed |
| 2026-11-20 | The image after the merge with `main` and the offline-start fix, Linux x86-64, Docker 29.5.1 | `nix run .#teammate-runtime-test` at fa2a9d5a38d | 24 of 24 checks, adding: a warm restart with Macro and git down stays up with no failed boot, then pushes its last sync once back; `docker stop -t 90` exits 0 in 19 s; a stop right after start exits 0. Cold boot to healthy 3.5 s, idle 487 MiB. |
| 2026-11-20 | Starter agent after the offline-start fix | `bun test` in `packages/starter-agent` at fa2a9d5a38d | 650 passed, 2 skipped, 0 failed |
| 2026-11-20 | Lifecycle policy (boot plan, exit table, image update) | `cargo test -p teammate_lifecycle` at cc05875ea5d | 55 passed |
| 2026-11-20 | macrod container supervisor against a fake engine | `cargo test -p coding_agent_worker --bins teammate` at cc05875ea5d | 30 passed |
| 2026-11-20 | macrod container supervisor against real Docker 29.5.1 (image swap, crash rollback, unavailable-image rollback, volume kept) | the same with `--include-ignored` | 32 passed in 134 s |
| 2026-11-20 | macrod wired end to end against a fake runtime socket and engine: `RunTeammate` gives a host report, *downloading*, *starting*, *running* and one container run | `cargo test -p coding_agent_worker --bins teammate` at e548137f646 | 39 passed |
| 2026-11-20 | Lifecycle policy after the macrod review | `cargo test -p teammate_lifecycle` at e548137f646 | 55 passed |
| 2026-11-20 | Service: delivery, image updates, telemetry ingest (local throwaway Postgres) | `cargo test -p agent_harness_service --all-features` at d9c6acd0696 | 371 + 15 + 39 passed, 13 ignored |
| 2026-11-20 | Installs, eligibility, invite, move, remove, the local image override | `cargo test -p team_agents --all-features` at d9c6acd0696 | 115 passed |
| 2026-11-20 | Web: draft, machine list and queries | `bunx vitest run src/features/settings/core src/lib/queries/team-agents` | 81 passed |
| 2026-11-20 | End to end on a local stack, Linux x86-64, Docker 29.5.1: macrod built from the branch, paired; owner invites an agent onto the machine from the Invite form | `just run_local` with the image override, macrod with `teammate_network`, the PostHog flag forced on by a local stand-in, at 1b6e8b13a91 | The agent's container ran read-only as uid 1000 with every capability dropped, the agent greeted in its DM and answered a message. macrod quit and restarted: the container kept running and was adopted. |
| 2026-11-20 | End to end: image update and failures, same stack | the runtime image override changed to derived test images, at 157a87d3400 | A new image id made a new generation and replaced the container; the agent answered after. An image whose start exits 1 rolled back to the image that had been running (`rolled_back`, `crash_loop`). An exit 79 was `failed: incompatibleRuntime` and wasn't restarted. An exit 77 was `failed: badConfiguration`; the service delivered once more, which failed the same way. Setting a good image again ran it. |
| 2026-11-21 | Egress enforcement, adversarial, Linux x86-64, Docker 29.5.1 | `nix run .#teammate-egress-test -- docker` with macrod's own ruleset renderer, at 0e53258165b | 50 passed, 0 failed, 2 untested. Each must-fail probe first succeeds from an unguarded control. Blocked: host addresses and gateway, a host listener and proxy, metadata v4, 10/8, 172.16/12, 192.168/16, 100.64/10, a LAN peer on a public v4 and on global v6, another teammate, names resolving to private addresses (DNS and `/etc/hosts`), a redirect and a proxy `CONNECT` to a private target, decimal and octal spellings, UDP and ICMP. Allowed: public HTTPS and DNS. The agent can't flush or add rules and has no `NET_ADMIN` or `NET_RAW`. Rules hold after `systemctl reload docker`, and the host's own tables hold none of them. Untested: the host's link-local IPv6 (the control can't reach it either) and a host `iptables -F` (not run: it would flush a shared firewall). In one run of five, the first connections after start timed out once (allowed and blocked alike) and then worked. |
| 2026-11-21 | Egress enforcement, adversarial, rootless Podman 5.8.2 (netavark bridges in the rootless network namespace, not pasta) | `nix run .#teammate-egress-test -- podman`, same commit | 43 passed, 0 failed, 8 untested. The same blocks hold, including the tailnet address and a LAN peer on a public address on another Podman network (found reachable first, then fixed by dropping every engine network's prefixes). Untested: the gateway, the host's addresses and a host proxy (a rootless control can't reach the host either), the test resolver (the control couldn't resolve through it), a daemon reload (there is no daemon) and a host `iptables -F`. |
| 2026-11-21 | macrod against real Docker 29.5.1: image swap, crash rollback, egress, the local-stack path | `cargo test -p coding_agent_worker --bins teammate -- --include-ignored --test-threads=1` at bc1a0661f08 | 4 of 4 real-engine tests pass: public reachable; metadata, gateway, a host listener, private ranges, CGNAT and a public-address peer on another network dropped; rule changes fail as uid 1000; on a local stack only the named service is reachable, not another container on the shared network; the holder is removed on stop |
| 2026-11-21 | macrod against real engines: confined run, image swap and rollbacks, egress, the local-stack path; Linux x86-64 | `MACRO_TEAMMATE_TEST_ENGINE=podman` and `=docker cargo test -p coding_agent_worker --bins the_real_engine -- --include-ignored --test-threads=1` at b1f7e7de02c (Podman: the flake's pinned 5.8.4 binary and its helpers on `PATH`) | Rootless Podman 5.8.4 (netavark bridges): 4 of 4 pass (254 s). Docker 29.5.1: 4 of 4 pass (223 s). Both: no capability in the agent's bounding set, the agent joins only its holder's namespace, a crashing new image and an unfetchable one roll back on the same volume, a public-address peer on another network and the private, metadata and host destinations are dropped while the public internet answers, and on a local stack only the named service is reachable. Earlier Podman failures were the tests' own (image ids without `sha256:`, the capability check, an nginx option that stopped nginx from starting) and a store shared by two Podman versions. |
