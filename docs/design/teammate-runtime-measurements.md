# Teammate runtime measurements

The numbers behind the choices in `teammate-runtime.md`. Every number
names its host, its method and its sample size. Synthetic data only.

## Firecracker: units in the VM vs a container in the VM

Host: a private Firecracker test host. Image `macro-box/2026-11-19a`,
4 vCPUs, 8 GiB. Host agent `1eb5c0fc34e+db16e7adeb1`. Measured on
2026-11-20. The synthetic computers (no identity) were destroyed afterwards; no user's computer
was touched.

### An agent computer (units, as today)

On the test agent computer of a local test user. Times run from the host's
start request to the guest journal's `macro-agent` lines; the guest clock is
the host's, through kvm-clock.

| What | Result | n |
| --- | --- | --- |
| Cold start (stop, then start) until `macro-agent.service` is active | 5292 / 5325 / 5124 ms, **p50 5292 ms** | 3 |
| Cold start until `start-agent: starting the runtime` | 5521 / 5502 / 5310 ms, **p50 5502 ms** | 3 |
| The start request itself | ~126 ms; the rest is the guest's boot up to the unit | 3 |
| Wake from hibernation | 1640 ms; `macro-agent` is **not** restarted, it resumes with the VM | 1 |
| Restore of a new agent computer from the golden, until the guest is ready | 900 ms (synthetic, no identity) | 1 |
| The agent process, from the runtime's start until ready | about 3.1 s (the setup trace's `agent.start`) | — |

### A container inside a computer (what running the teammate container on Firecracker would add)

On a synthetic person computer (4 vCPUs, 8 GiB, `/home` 68 GiB ext4 on ZFS).
Docker runs in the guest, socket-activated, with its data root at
`/home/.system/docker` and the containerd snapshotter. The image is
synthetic: `busybox:1.36` plus one incompressible 1536 MiB file, saved as a
1539 MiB tarball. The page cache was dropped before the load and before the
cold run.

| What | Result | n |
| --- | --- | --- |
| `docker load -i` of the 1539 MiB tarball | **33.9 s** | 1 |
| `/home` growth from that load | 110 → 3189 MiB: **+3079 MiB**, about twice the tarball (compressed content plus the unpacked snapshot) | 1 |
| `docker run --rm <image> true`, cold | **815 ms** | 1 |
| The same, warm | 345 / 352 / 396 ms | 3 |
| Restore from the golden until the guest is ready | 1062 ms | 1 |
| Wake from hibernation | 1972 / 1750 / 1912 ms, p50 1912 ms | 3 |

**Reading:** a container would add the image's load on each computer's first
start (34 s for a 1.5 GiB image), twice the image's size on every
computer's disk, and up to 0.8 s on each start. All of that would be on top
of a 5.3 s cold start, and it buys no isolation the VM lacks. Hosted
computers keep units.

## Egress from a container (dev box)

Host: a cloud VM (`HOST` its own address, `GATEWAY` its network's gateway), Docker
29.5.1, passt 2025_09_19. The method was a TCP connect only, with 4 s
timeouts; nothing was read from any service:

```
for t in 169.254.169.254:80 $GATEWAY:53 $HOST:22; do
  timeout 4 bash -c "exec 3<>/dev/tcp/${t%:*}/${t#*:}" && echo "$t open" || echo "$t closed"
done
```

It ran on the host, in `pasta --config-net`, in `pasta --config-net
--no-map-gw`, and in a `busybox` container on Docker's bridge (with
`nc -z -w 4`).

| From | Metadata 169.254.169.254:80 | Gateway :53 | Host :22 |
| --- | --- | --- | --- |
| Host | open | open | open |
| pasta | open | open | closed |
| pasta `--no-map-gw` | open | open | closed |
| Docker bridge | open | open | closed |

**Reading:** no engine's default network keeps a container away from the
LAN or the cloud metadata service. In v1, egress is reported as open on
every engine.

## The teammate runtime image (local)

Measured on the dev box (x86_64, Docker 29.5.1) with
`nix run .#teammate-runtime-test` (macrod's flags: `--memory 4g --cpus 2
--shm-size 1g`, the shipped seccomp profile, a stand-in Macro and a local
git server). The box was loaded (load average 45 to 95; 260 to 420 on the
first run, whose stream and load times were 365 s and 90 s), so the times
are upper bounds. Ranges are across the runs while the entrypoint and test
were being fixed (the image's closure did not change); the warm restart and
stop times are from the one fully passing run.

| What | Value |
| --- | --- |
| Image, gzip'd stream (`--fast`) | 1.4 to 1.5 GiB |
| Image, loaded (`docker image inspect` Size) | 3976 MiB |
| Stream + gzip | 77 to 115 s |
| `docker load` (from the gzip'd file) | 38 to 54 s |
| Cold start to `start-agent`'s exec (clone, link `node_modules`) | 0.8 to 1.4 s |
| Cold start to a healthy boot (`last-good` written) | 1.8 to 2.4 s |
| Warm restart (`docker start`) to a healthy boot | 1.7 s |
| Idle memory after 20 s (`docker stats`) | 420 to 620 MiB |
| Processes when idle | 26 |
| `docker stop -t 90` with the last sync (commit, pull, push) | 19 s |

With `teammate-boot` (crates/teammate_lifecycle) in place of start-agent,
a new container per start as macrod makes them (load average 85 to 300):

| What | Value |
| --- | --- |
| Image, loaded | 3981 MiB (8020 MiB before teammate-boot dropped its references to the Rust toolchain and vendored crates) |
| Cold start to teammate-boot's exec of the runtime | 1.4 to 1.5 s |
| Cold start to a healthy boot | 2.8 to 3.0 s |
| Warm restart (new container) to a healthy boot | 2.6 to 3.2 s |
| Idle memory after 20 s | 436 to 483 MiB |
| `docker stop -t 90` with the last sync | 25 to 51 s (51 s at load average 85; the sync's own limit is 40 s) |

The closure is the hosted agent's: the largest parts are `ffmpeg-full`
(via `ffmpeg-x11grab`, about 1.5 GiB with its closure) and Chromium
(1.8 GiB with its closure, mostly shared with it); tigervnc pulls gcc in
through fltk. A second teammate on the same engine shares every layer, so
the disk cost per extra teammate is its volume, not the image.
