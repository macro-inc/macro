# Public egress guard

Shared pure address policy for webhook delivery and IMAP/SMTP connections.
The caller resolves, filters and connects to the vetted numeric address; a
separate hostname preflight never replaces a connect-time check.

## Start here

- `src/lib.rs`: host and IPv4/IPv6 classifiers, including embedded addresses.

## Checks

- `cargo test -p egress_guard`
- When changing classification, test webhook and IMAP transport callers too.

## Gotchas

- Keep public-policy decisions here; protocol ports, TLS and local lab mappings belong to each transport.
- Preserve IPv4-mapped, NAT64 and 6to4 classification through the embedded IPv4 address.
