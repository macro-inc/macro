# swagger2openapi inputs

## What it is

Pinned npm inputs for the Incus API converter in the default Nix dev shell.
`../_swagger2openapi.nix` installs its binary; this is not a workspace package.

## Recipes

- Bump the exact dependency and package version together, regenerate
  `package-lock.json` with `npm install --package-lock-only --ignore-scripts`,
  then refresh the derivation's `npmDepsHash` using the actual Nix build output.

## Checks

- `nix develop --command swagger2openapi --version`
- `nix develop --command crates/incus_client/regen.sh --fetch`; review the
  generated diff and compare the fetched spec with the pinned upstream release.
