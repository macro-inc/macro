set -euo pipefail

# The same flags as run_tests.sh, so this reuses what it compiled and adds only the
# bins. sync-service isn't part of this suite: its storage backends are mutually
# exclusive under --all-features.
cargo build --workspace --exclude sync_service --bins --all-features \
  --config 'profile.dev.package."*".debug=false'
