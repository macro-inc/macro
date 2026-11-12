# safe_fetch

## What it is

Shared infrastructure for any service that fetches a URL someone outside Macro
chose (a user, an agent, an email, a webhook config). `SafeFetcher` is the one
SSRF-safe way to do that; don't hand-roll another resolver or redirect loop.

## Start here

- `src/lib.rs`: what is defended and an example policy.
- `src/resolver.rs`: why the address check lives in the reqwest resolver (no
  DNS-rebinding window) and why IP-literal hosts are checked in `fetcher.rs`.
- `src/address.rs`: the blocklist; IPv6 that wraps IPv4 is judged as the IPv4.

## Scope

- Owns: address, scheme, port, redirect, time, size, and media-type limits on
  one outbound GET.
- Not here: what a caller does with the bytes (re-encoding, re-serving, caching).

## Boundaries

- Used by: `image_proxy_service`. Migration plan for the other fetchers is in the
  PR description.

## Checks

- `cargo test -p safe_fetch` — tests use a local TCP server and fake DNS
  lookups; no external network.

## Gotchas

- `private_networks_allowed` is for local dev and tests only; production policies
  leave it empty.
- Callers re-serving bytes to a browser send `X-Content-Type-Options: nosniff`
  and the accepted media type. Never add `image/svg+xml` to a re-served policy.
- Never record URL paths, queries, or userinfo in spans; they carry tokens.

## Related

- Rules: `.agents/rules/observability.md`, `.agents/rules/rust/libraries.md`
