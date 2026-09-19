set -euo pipefail

# Statically linked musl build of the self-hosted coding-agent daemon.
#
# The musl std that ships with the toolchain links pure-Rust crates on its own,
# but aws-lc-sys — rustls' crypto provider, and so the whole reason the daemon
# can talk HTTPS and WSS — is C, and needs a compiler that targets musl. zig is
# that compiler, which is what cargo-zigbuild wires up; it also makes the
# aarch64 build a cross-compile rather than a second runner.
#
# aws-lc-sys' own cc builder rejects zig, so force its cmake builder instead.
# The Lambda builds hit the same wall and take the same way out
# (see nix/cloud-storage.nix).
export AWS_LC_SYS_CMAKE_BUILDER=1

# The daemon runs no queries of its own, but crates in its dependency graph
# carry sqlx macros; offline mode keeps a release build from wanting a database.
export SQLX_OFFLINE=true

cargo zigbuild --release --package coding_agent_worker --target "$TARGET"
