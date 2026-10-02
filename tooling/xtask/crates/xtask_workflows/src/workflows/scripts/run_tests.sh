set -euo pipefail

# Temporary isolated probe: override the wrapper after BASH_ENV loads Nix.
export RUSTC_WRAPPER= RUSTC_WORKSPACE_WRAPPER=
printf 'sccache probe: RUSTC_WRAPPER=%s RUSTC_WORKSPACE_WRAPPER=%s RUST_PACKAGES=%s\n' \
  "$RUSTC_WRAPPER" "$RUSTC_WORKSPACE_WRAPPER" "$RUST_PACKAGES"

# Temporary isolated diagnostics; process names and counters only.
python3 -u - <<'PYTHON' &
import datetime
import json
import os
from pathlib import Path
import subprocess
import time


def sample():
    print('Build/test resources at ' + datetime.datetime.now(datetime.timezone.utc).isoformat(), flush=True)
    print(json.dumps({
        'cpu_count': os.cpu_count(),
        'affinity_count': len(os.sched_getaffinity(0)),
        'CARGO_BUILD_JOBS': os.environ.get('CARGO_BUILD_JOBS', '<unset>'),
        'NEXTEST_TEST_THREADS': os.environ.get('NEXTEST_TEST_THREADS', '<unset>'),
        'RUSTC_WRAPPER': os.environ.get('RUSTC_WRAPPER', '<unset>'),
        'RUSTC_WORKSPACE_WRAPPER': os.environ.get('RUSTC_WORKSPACE_WRAPPER', '<unset>'),
    }), flush=True)
    subprocess.run(['free', '-m'], check=False, timeout=5)
    for resource in ['cpu', 'io', 'memory']:
        path = Path('/proc/pressure') / resource
        if path.exists(): print(str(path) + ': ' + path.read_text().strip(), flush=True)
    relative = next((line.split('::', 1)[1] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::')), None)
    if relative is not None:
        root = Path('/sys/fs/cgroup')
        directory = root / relative.lstrip('/')
        while directory.is_relative_to(root):
            values = {}
            for name in ['cpu.max', 'cpuset.cpus.effective', 'memory.max', 'memory.high', 'memory.current', 'memory.peak', 'memory.events', 'memory.swap.max', 'memory.swap.current', 'memory.swap.peak']:
                path = directory / name
                if path.exists(): values[name] = path.read_text().strip()
            if values: print(json.dumps({'cgroup': str(directory), 'values': values}), flush=True)
            if directory == root: break
            directory = directory.parent
    processes = subprocess.run(['ps', '-eo', 'pid,ppid,comm,state,etimes,pcpu,time,rss,wchan:24', '--sort=-rss'], capture_output=True, text=True, check=False, timeout=5)
    print('\n'.join(processes.stdout.splitlines()[:21]), flush=True)
    compilers = subprocess.run(['ps', '-C', 'rustc', '-o', 'pid=,args='], capture_output=True, text=True, check=False, timeout=5)
    for compiler in compilers.stdout.splitlines():
        arguments = compiler.split()
        if '--crate-name' in arguments:
            position = arguments.index('--crate-name')
            if position + 1 < len(arguments): print(f'Compiler {arguments[0]}: {arguments[position + 1]}', flush=True)


while True:
    try:
        sample()
    except (OSError, subprocess.TimeoutExpired) as error:
        print('Resource monitor sample unavailable: ' + type(error).__name__, flush=True)
    time.sleep(60)
PYTHON
resource_monitor=$!
trap 'kill "$resource_monitor" 2>/dev/null || true; wait "$resource_monitor" 2>/dev/null || true' EXIT

# --no-tests=pass: a package filter can legitimately select a crate with no
# tests; treat that as success, not nextest's default error.
# sync-service is not part of this suite, and its storage backends are mutually
# exclusive under --all-features.
#
# Package selection uses `cargo nextest run -p`, not `--workspace -E rdeps(...)`.
# The filterset only decides which tests *run* after a workspace build; `-p`
# is what keeps an unrelated crate's test binary from being compiled.
#
# `--lib --bins --tests` is safe with `--workspace` (cargo skips packages that
# lack a given target type) but fails with `-p` when any selected package has
# no lib — xtask binaries such as xtask_nextest_filter / xtask_workflows.
# Unconstrained `-p` still runs that package's tests.

: "${RUST_PACKAGES:?RUST_PACKAGES is required}"
common=(--all-features --no-tests=pass --test-threads "$NEXTEST_TEST_THREADS")

if [ "$RUST_PACKAGES" = "all" ]; then
  cargo nextest run --workspace --exclude sync_service --lib --bins --tests "${common[@]}"
  exit 0
fi

pkg_args=()
for package in $RUST_PACKAGES; do
  [ "$package" = "sync_service" ] || pkg_args+=(-p "$package")
done

if [ "${#pkg_args[@]}" -eq 0 ]; then
  echo "No packages in the test suite were affected"
  exit 0
fi

cargo nextest run "${common[@]}" "${pkg_args[@]}"
