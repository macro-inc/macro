# Computer runtime checks

Benchmarks and guest checks for Macro computers on Firecracker hosts.

- `e2e.py`: Buy -> running -> macrod connected -> first agent reply through a
  local stack's control plane, n runs, with the setup trace and the host
  agent's launch phases; `stats.py` turns its JSON Lines into p50/p95.
- `timed.sh`: runs a command while holding the bench host's timed lock.
- `seed.py`, `flag-stub.py`: a local stack team that can buy computers
  (Stripe test mode) and the PostHog flags computers need.
- `run-checks.sh` + `guest-checks.sh` + `browser-checks.mjs`: guest
  compatibility checks, through `backends/firecracker.sh`.
- `fanout.sh`: N concurrent restored computers, memory per computer.
- `firecracker-io.py`: disk workloads inside one computer.

Host settings, all with defaults: `FIRECRACKER_HOST_CLI` (the host agent's
client, `firecracker-host client`; add `--endpoint <file>` if the host needs
one), `FIRECRACKER_STATE_DIR` (the adapter's id mappings,
`$XDG_STATE_HOME/computer-bench/firecracker`), `TIMED_LOCK` (the host's shared
benchmark lock, `/srv/locks/timed.lock`).

## Guest compatibility checks

Run the Firecracker suite on a disposable functional host once its image and
golden are ready:

```sh
FIRECRACKER_IMAGE=macro-box/2026-11-17b E2E_FUNCTIONAL=1 E2E_HIBERNATE=1 \
  SMP=4 MEM_GIB=8 ./run-checks.sh firecracker restore <results dir>
```

The runner takes `TIMED_LOCK` nonblockingly for each timed phase,
uses one guest, keeps its disks across a stop/start, and deletes its own guest
on exit. Boot, stop/start, and hibernate/wake also hold the lock because
booting guests can contaminate other measurements. Readiness requires `macro-home.target` and the mounted `/home`, not just the
guest agent. This prevents cold-boot probes from writing hidden state on the
root filesystem before the data volume mounts. Exec readiness times out
after 60 seconds (`E2E_EXEC_TIMEOUT` overrides it); failures release the lock
before cleanup. Debug exec problems separately after releasing the lock.
Exit 75 means the timed lock is busy; exit 1 means a check or lifecycle
operation failed. Never point it at an existing or production guest. Names
start with `e2e-`; `E2E_NAME` can select another unique worker-prefixed name.
The default is 4 vCPU and 16 GiB RAM; keep the host's shared resource budget.

For functional debugging during shared host builds, `E2E_FUNCTIONAL=1` skips
the timed lock and large source build (no lock file is required on the
functional host). The result has `timing_valid:false` and
`source_build_skipped:true`; elapsed values are diagnostics only and must not
be used for backend comparisons. Keep the guest within its resource budget,
and only use this mode when the host coordinator permits untimed work.

To join a host coordinator's blocking benchmark queue, wrap one suite in
`sudo flock "$TIMED_LOCK" ...` (or `timed.sh`) and pass `E2E_LOCK_HELD=1` to the
runner. It then relies on the caller's lock for the whole suite and does not
reacquire or unlock it. Check host load and background builders inside that
hold before starting, and record load at start/end. Do not set this flag
without holding the shared lock.

Phases:

- `before`: install ripgrep into the agent user's Nix profile, build and run a
  Rust crate with a crates.io dependency, Docker pull/run and Dockerfile build,
  and independently write a random `/home` sentinel and digest, even if package
  downloads fail.
- `after`: verify the package, sentinel, compiled binary, and built Docker image
  after a real stop/start.
- `big-build`: realize Git's dependencies, then rebuild Git from source in the
  block-backed `/nix/store` with four cores. `/tmp`, which backs sandbox build
  directories, must also be on a block device. Dependency preparation and source
  rebuild timings are separate. Nix `--rebuild` compares the output with the
  original build too; a reproducibility failure remains a failed check.
- `browsers`: install the Playwright driver, run headless and headful Chromium,
  and headful Firefox on the existing Xvnc `:0` desktop. Load a real HTTPS page,
  run the same 1280×720 WebGL workload for at least three seconds, and collect
  browser-tree RSS and PSS. Software renderer names are checked. Chromium uses
  SwiftShader; Firefox uses Mesa software rendering. RSS double-counts shared
  pages; PSS is preferable for density. The VNC server is not included in the
  browser process tree. Firefox, geckodriver, and Mesa are fetched through Nix; the driver paths are
  supplied explicitly so Firefox can use llvmpipe without a GPU.

The browser phase also runs `mcp-checks.py` as macro: `claude mcp list` must
report Chrome DevTools connected, then a session through the same configured
connector must discover `list_pages`/`navigate_page`/`take_snapshot`, get a real
page ID, navigate to a real HTTPS
page and return its expected text in a browser snapshot. This needs no model
credentials or LLM request; raw CLI health, tool discovery and action evidence
are archived with the phase logs. It does not exercise an LLM choosing tools.

Set `E2E_HIBERNATE=1` for adapters supporting `hibernate`. The extra phases
open a real page on the guest's existing Chromium service, save its URL/title
and a random JavaScript token, verify it after reconnecting once, then require
the same live tab and token after
hibernate/start. A reloaded tab fails this check. Package, home, cargo and Docker
persistence are checked again after hibernation.

`FIRECRACKER_HOST_CLI` selects the host agent's client. The adapter allocates
computer IDs from the e2e worker's UUID namespace, persists mappings under
`FIRECRACKER_STATE_DIR`, and removes them
only after destroy succeeds. Do not delete the counter while computers exist.
`goldenNotReady` and post-restore `guestUnreachable` responses are retried for up to 300 seconds while the host
builds a golden for the requested image/CPU/RAM shape and applies guest identity; this preparation is
included in create latency, not in guest workload timing. The pairing ID stays fixed across create retries. The CI Ubuntu image
lacks the agent user and desktop and cannot pass this suite.

`BACKEND_SCRIPT=/absolute/path/to/adapter.sh` supplies a driver for isolated
harness testing.
Adapters implement `up VARIANT NAME MAC`, `exec NAME SHELL_COMMAND`,
`stop NAME`, `start NAME MAC`, `down NAME`, and optionally `hibernate NAME`.
`up` creates a fresh guest; `stop`/`start` retain its disks; `hibernate` saves
memory and releases the VM process. Exec runs as root and returns the command's
stdout; the runner additionally checks JSON because some vsock adapters do not
propagate guest exit codes. Lifecycle failures stop the suite and trigger cleanup.

Results are JSON Lines in `checks.jsonl`, with per-phase JSON and archived
logs beside them. Browser timings and RAM are embedded in
`phases[].checks.browser_metrics.checks`. Each check records `ok`, `s`, and
`exit_code`; the runner's aggregate `ok` includes every phase. A missing result
is a failure. `cleanup.json` separately records whether guest cleanup succeeded;
a cleanup failure also makes the runner exit nonzero. Decode a log archive with `base64 -d FILE | tar -xz`.

For direct guest execution, copy `guest-checks.sh`, `browser-checks.mjs`, and `mcp-checks.py` next
to each other and run the shell script as root with one of the phase names.
Logs and state live in `/home/macro/.macro-guest-checks`. Direct execution does
not acquire a host lock: the caller must hold it for builds and timed work.
Use identical image/flake revisions, guest resources, workload, and cache
conditions when comparing benchmark variants; report any differences with the numbers.

## Clone uniqueness

`clone-uniqueness.py <uuid-a> <uuid-b>` (root, on a Firecracker host, functional)
restores two computers from one golden, compares their long-lived ids and
fresh random values, destroys both, and exits 1 if a value that must differ is
shared. `FIRECRACKER_HOST_CLI` and `FIRECRACKER_IMAGE` select the agent client
and image.

## History

Incus and raw QEMU were measured as the "before" for the Firecracker
comparison; their harnesses were removed with Incus, and their numbers are in
the project report.

## ZFS block-cloning integrity

Run the host-side check as root on a test host, passing an existing parent
filesystem dataset that you own:

    sudo python3 zfs-block-cloning-check.py POOL/OWNED_DATASET \
      --clones 8 --size-mib 256 --writes 2000

The checker requires OpenZFS kernel >= 2.2.4, matching userland/kernel
major.minor.patch versions, block cloning enabled, and both zfs_bclone_enabled
and zfs_bclone_wait_dirty set to 1. It asserts these settings; it does not
change module parameters or pool features.

Each run atomically claims a unique brtcheck-* child. Its source, clones and
received copies are mounted in a private mount namespace and removed on exit.
No existing test run is deleted. The check exercises FICLONE and cross-dataset
copy_file_range before syncing dirty source data, random writes to independent
files, then all source/cloned bytes after compressed send/receive. It also
checks that the pool checksum error count stayed unchanged. A completed run
ends with JSON after its human-readable log.

Run again with --self-test to flip a byte behind the expected-content model:
exit 1 and corruption_detected:true are the expected negative result.

Ubuntu test hosts with older userland may require --allow-userland-mismatch
--no-direct. These flags are test-host exceptions: verification may read from
the ARC and is not evidence of direct disk reads or a matched software stack.
Run without compatibility flags on a representative NixOS test host for the
strict check.

The model and injected-mismatch regressions run with the existing command:

    python3 -m unittest discover tooling/computer-bench
