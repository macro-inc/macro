set -euo pipefail
export NIX_REMOTE=daemon
export PATH="/nix/var/nix/profiles/default/bin:$PATH"
nix --version
test -L /var/cache/nix/dev-shell
nix develop --profile /var/cache/nix/dev-shell --command bash -lc '
  set -euo pipefail
  rustc --version
  cargo --version
  cargo clippy --version
  cargo fmt --version
  cargo nextest --version
  just --version
  sqlx --version
  sccache --version
  mold --version
'
