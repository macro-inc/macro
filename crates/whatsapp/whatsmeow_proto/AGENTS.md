# whatsmeow_proto

## What it is

The protobuf types of the `whatsmeow` port (WhatsApp linked-device client):
prost code generated at build time from whatsmeow's `proto/` tree, kept in its
own crate so the ~29k generated lines don't recompile with every edit to
`crates/whatsmeow`.

## Start here

- `proto/<goPackage>/*.proto`: copies of whatsmeow's `.proto` files with MPL-2.0 headers at
  the revision pinned in `crates/whatsmeow/AGENTS.md`.
- `build.rs`: compiles them with `protox` (pure Rust, no `protoc` needed) and
  `prost-build`.
- `src/lib.rs`: the generated module tree plus aliases named after the Go
  import paths (`waE2E` → `wa_e2e`).

## Recipes

- Update the protos: copy whatsmeow's `proto/**/*.proto` over `proto/` at the
  new revision, keep the directory layout (imports depend on it), and
  regenerate the aliases at the bottom of `src/lib.rs` if a package was added.

## Gotchas

- Preserve upstream protobuf definitions; retain the MPL-2.0 header when updating them.
- License is MPL-2.0 (see `LICENSE`), like the rest of the port.

## Related

- `crates/whatsmeow/AGENTS.md`
