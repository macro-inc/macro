# openbao_client

## What it is

Typed OpenBao 2.7.2 client for the Passwords provider. The mounted root and team
specifications are captured locally and normalized before progenitor generation.

## Start here

- `spec/README.md`: exact capture provenance, mounts and reproducible commands.
- `spec/patch.py`: the only endpoint allowlist and wire-schema fixes.
- `regen.sh`: pinned progenitor generator; never edit generated output directly.
- `src/client.rs`: generated API calls, namespace sessions and secret boundaries.
- `src/error.rs`: typed causes and sensitive error-envelope retention.

## Boundaries

This crate owns wire protocol only. Passwords domain policy, operation recovery,
CAS tombstone orchestration and deletion waiting stay with its outbound adapter.
Never add raw HTTP requests or hand-built endpoint URLs to the wrapper/adapter.
Keep generated declarations private: transport buffers and arbitrary JSON cannot
provide the same lifetime guarantees as application-owned zeroizing secret types.

## Checks

- `cargo test -p openbao_client`
- `cargo clippy -p openbao_client`
- `nix develop --command crates/openbao_client/regen.sh` twice with no drift.
- `python3 -m unittest discover -s crates/openbao_client/spec -p 'test_*.py'`
- Real-provider fixtures: `crates/passwords/AGENTS.md`.

## Gotchas

- Raw root/team OpenAPI differ; retain both verbatim and normalize deterministically.
- Preserve server error messages only as `SecretString`; no raw error sources.
- Only the exact CAS mismatch error is `CasMismatch`; other 400s are rejections.
- Namespace DELETE acknowledgement requires a later parent-scoped GET 404.
- No redirect, transport retry, environment token or root token at runtime.
- Regeneration compiles a temporary Cargo workspace; acquire the project build slot.
