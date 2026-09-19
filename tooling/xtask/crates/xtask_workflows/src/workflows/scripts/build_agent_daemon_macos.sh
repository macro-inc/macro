set -euo pipefail

# macOS build of the self-hosted coding-agent daemon.
#
# No zig here: the Apple targets link against the SDK the runner already has,
# and the arm64 runner cross-compiles the x86_64 slice on its own. All this
# step needs is the matching rust-std.
#
# See build_agent_daemon_linux.sh for why sqlx runs offline.
export SQLX_OFFLINE=true

rustup target add "$TARGET"

# aws-lc-sys compiles its C through cmake. The GitHub macOS image ships cmake
# today, but the build is too far downstream to discover that it stopped.
if ! command -v cmake >/dev/null 2>&1; then
  brew install cmake
fi

cargo build --release --package coding_agent_worker --target "$TARGET"
