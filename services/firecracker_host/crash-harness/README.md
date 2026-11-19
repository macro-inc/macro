# Crash harness

Kills the Firecracker host agent with SIGKILL (as `kill -9`) at each
named point between two steps of an operation, starts it again, and checks
what it makes of what the dead agent left. The points are
`src/crash_point.rs`; only a build with `--features crash-points` has them
(`serve --crash-at <point>`).

Runs on a Firecracker host with KVM, the jailer, nftables and a ZFS pool
with block cloning, as a sudoer. It makes its own agent (unit, dataset,
TLS, netns slots, nftables tables, uids), all named by `$PREFIX`
(`env.sh`), so it can share a host with other agents if `PREFIX`,
`PORT`, `UID_BASE` and `VETH_BASE` don't overlap theirs.

```sh
cargo build --release -p firecracker_host --features crash-points
FIRECRACKER=... JAILER=... IMAGE_SOURCE=<image dir> \
  AGENT_BUILD=target/release/firecracker-host ./setup.sh   # builds the golden
./run.sh                    # every case; or ./run.sh hibernate-published ...
./teardown.sh
```

## Cases

Each case runs one operation with the agent armed at a point, restarts the
agent unarmed, checks the state below, retries the operation where the
client would, and checks the invariants: `/health` ready (the reconcile
left nothing), and Firecracker processes, jails and taken network slots
each equal the running or paused computers. Then the computer is destroyed
and its dataset must be gone.

| Point | Operation | State after restart | Then |
|---|---|---|---|
| `create-disks-prepared` | create | absent (no record) | repeated create runs |
| `create-record-saved` | create | stopped | repeated create boots it |
| `launch-spawned` | create | stopped; the orphan VM and its jail removed | repeated create boots from the golden |
| `launch-returned` | create | stopped; the orphan VM and its jail removed | repeated create boots from the golden |
| `launch-saved` | create | running (VM adopted); `macro-restore` resumed | exec answers |
| `hibernate-flag-saved` | hibernate | paused | hibernate again, then start wakes it |
| `hibernate-snapshot-created` | hibernate | paused (unpublished snapshot dropped) | hibernate again, then start wakes it |
| `hibernate-published` | hibernate | hibernated (VM ended) | start wakes it |
| `hibernate-ended` | hibernate | hibernated | start wakes it |
| `wake-saved` | start a hibernated one | running; stale hibernation deleted | exec answers |
| `destroy-disks-deleted` | destroy | absent or stopped | destroy finishes |
| `golden-booted` | build a golden | the golden jail removed | the build runs again to ready |

The same shapes are unit-tested with fakes in
`src/domain/service/reconcile/test.rs`; this harness checks them against
real Firecracker, jailer, cgroups and ZFS.
