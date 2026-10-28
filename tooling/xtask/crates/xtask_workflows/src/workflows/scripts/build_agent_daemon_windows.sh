set -euo pipefail

# Windows build of the self-hosted coding-agent daemon, with the runner's MSVC
# toolchain.
#
# See build_agent_daemon_linux.sh for why sqlx runs offline.
export SQLX_OFFLINE=true

# Link the C runtime into the binary. Without this, macrod.exe needs the Visual
# C++ redistributable's vcruntime DLLs, which a user's machine may not have.
# With an explicit --target, RUSTFLAGS reach only target code, and the cc and
# cmake builds of the C dependencies follow it to the static runtime.
export RUSTFLAGS="-C target-feature=+crt-static"

# aws-lc-sys assembles its x86_64 crypto with NASM; it ships those objects
# pre-assembled, which saves installing NASM on the runner.
export AWS_LC_SYS_PREBUILT_NASM=1

rustup target add "$TARGET"

if ! command -v cmake >/dev/null 2>&1; then
  choco install cmake --installargs 'ADD_CMAKE_TO_PATH=System' --no-progress -y
  export PATH="/c/Program Files/CMake/bin:$PATH"
fi

cargo build --release --package coding_agent_worker --target "$TARGET"
