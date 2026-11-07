# kms_gateway

## What it is

Key management for a Macro instance on Kubernetes. It serves the part of the AWS KMS API
Macro uses, on OpenBao's transit engine, so services use `aws_sdk_kms` unchanged and keys
live in OpenBao rather than `local-kms`. Production uses real KMS; this never runs there.

## How it works

Each KMS key id or alias is one transit key, created on first use. An encryption context
becomes transit's associated data, so the wrong context fails to decrypt, as on KMS. A
ciphertext blob is the key name and transit's ciphertext, because `Decrypt` calls may not
name a key.

## Start here

- `src/api.rs`: the KMS JSON protocol and blob format.
- `src/bao.rs`: the transit client.

## Scope

- Owns: `Encrypt`, `Decrypt`, `GenerateDataKey`, and the calls provisioning makes.
- Not here: OpenBao's own lifecycle → the `openbao` workload in
  `infra/platform/components.nix`.

## Checks

- `cargo test -p kms_gateway`

## Gotchas

- `CreateKey` and `CreateAlias` succeed without creating anything, because keys appear on
  first use, and `ListAliases` is always empty.
- Request signatures are not verified: the gateway is reachable only inside its
  instance's namespace, and holds the only OpenBao token that can use transit.
