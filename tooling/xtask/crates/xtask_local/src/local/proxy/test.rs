use super::*;
use crate::local::{inventory, repo_root};

/// Every inventoried service that declares a path prefix must get a route in the
/// generated Caddyfile, targeting its canonical compose service name. This is
/// the guarantee that replaces the old hand-maintained route list.
#[test]
fn generates_a_route_for_every_prefixed_service() {
    let caddy = caddyfile(Mode::Local);
    for svc in inventory::RUST_SERVICES {
        let Some(prefix) = svc.path_prefix else {
            continue;
        };
        assert!(
            caddy.contains(&format!("reverse_proxy {}:8080", svc.compose_name)),
            "Caddyfile is missing a route to {}",
            svc.compose_name
        );
        assert!(
            caddy.contains(&format!("{prefix}/*")),
            "Caddyfile is missing the {prefix} prefix"
        );
    }
}

/// WebSocket services use the bare-prefix `@matcher` + explicit strip; HTTP
/// services use `handle_path`.
#[test]
fn websocket_services_use_a_matcher() {
    let caddy = caddyfile(Mode::Local);
    // connection-gateway is the inventoried WebSocket service.
    assert!(caddy.contains("@connection_gateway path /connection-gateway /connection-gateway/*"));
    assert!(caddy.contains("uri strip_prefix /connection-gateway"));
    // A plain HTTP service uses handle_path.
    assert!(caddy.contains("handle_path /auth/* {"));
}

/// The static-file block is the one route that differs by mode: LocalStack S3
/// fan-out locally, the dev-pointed service in dev.
#[test]
fn static_file_block_is_mode_specific() {
    assert!(caddyfile(Mode::Local).contains("/static-file-storage"));
    assert!(caddyfile(Mode::Dev).contains("handle_path /static-file/*"));
    assert!(!caddyfile(Mode::Dev).contains("/static-file-storage"));
}

/// Drift gate across the Rust↔TypeScript seam: every proxied service's prefix
/// must be wired into `proxyServers()` in `servers.ts`, or the frontend can't
/// reach it through the single-origin proxy. servers.ts can't be derived from
/// Rust, so this test is what keeps the two in sync.
#[test]
fn frontend_wires_every_inventory_prefix() {
    let servers = repo_root().join("apps/web/src/lib/core/constant/servers.ts");
    let src = std::fs::read_to_string(&servers)
        .unwrap_or_else(|e| panic!("reading {}: {e}", servers.display()));
    for svc in inventory::RUST_SERVICES {
        let Some(prefix) = svc.path_prefix else {
            continue;
        };
        let http = format!("${{proxyOrigin}}{prefix}");
        let ws = format!("${{wsProxyOrigin}}{prefix}");
        assert!(
            src.contains(&http) || src.contains(&ws),
            "servers.ts proxyServers() is missing prefix {prefix} (for {}); \
             the frontend can't reach it through the proxy",
            svc.compose_name
        );
    }
}
