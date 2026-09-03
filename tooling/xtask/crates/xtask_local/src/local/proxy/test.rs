use super::*;
use crate::local::{inventory, repo_root};

/// Every inventoried service that declares a path prefix must get a route in the
/// generated Caddyfile, targeting its canonical compose service name. This is
/// the guarantee that replaces the old hand-maintained route list.
#[test]
fn generates_a_route_for_every_prefixed_service() {
    let caddy = caddyfile(Mode::Local, false);
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

/// Dev keeps a single origin: services that run in Dev hit local containers;
/// Local-only prefixed services fan out to the shared-dev gateway (no strip).
#[test]
fn dev_fans_local_only_prefixes_to_the_gateway() {
    let caddy = caddyfile(Mode::Dev, false);
    for svc in inventory::RUST_SERVICES {
        let Some(prefix) = svc.path_prefix else {
            continue;
        };
        if svc.in_mode(Mode::Dev) {
            assert!(
                caddy.contains(&format!("reverse_proxy {}:8080", svc.compose_name)),
                "Dev Caddyfile missing local route for {}",
                svc.compose_name
            );
            continue;
        }
        if !svc.in_mode(Mode::Local) {
            continue;
        }
        assert!(
            !caddy.contains(&format!("reverse_proxy {}:8080", svc.compose_name)),
            "Dev must not route {} to an absent local container",
            svc.compose_name
        );
        assert!(
            caddy.contains(&format!("handle {prefix}/* {{"))
                || caddy.contains(&format!("path {prefix} {prefix}/*")),
            "Dev Caddyfile missing gateway handle for {prefix}"
        );
        assert!(
            caddy.contains(&format!("reverse_proxy {DEV_GATEWAY_ORIGIN}")),
            "Dev Caddyfile missing gateway upstream for {}",
            svc.compose_name
        );
    }
    // Concrete regression for the scheduled-action / agent-harness pair.
    assert!(caddy.contains("handle /scheduled-action/* {"));
    assert!(caddy.contains("handle /agent-harness/* {"));
    assert!(!caddy.contains("reverse_proxy scheduled_action_service:8080"));
    assert!(!caddy.contains("reverse_proxy agent_harness_service:8080"));
}

/// WebSocket services use the bare-prefix `@matcher` + explicit strip; HTTP
/// services use `handle_path`.
#[test]
fn websocket_services_use_a_matcher() {
    let caddy = caddyfile(Mode::Local, false);
    // connection-gateway is the inventoried WebSocket service.
    assert!(caddy.contains("@connection_gateway path /connection-gateway /connection-gateway/*"));
    assert!(caddy.contains("uri strip_prefix /connection-gateway"));
    // A plain HTTP service uses handle_path.
    assert!(caddy.contains("handle_path /auth/* {"));
}

/// The analytics-proxy worker is reached through the single origin at `/i/*`
/// (PostHog and OTLP traces/logs), un-stripped, on its own :8098 port.
#[test]
fn analytics_proxy_route_is_present() {
    let caddy = caddyfile(Mode::Local, false);
    assert!(caddy.contains("handle /i/* {"));
    assert!(caddy.contains("reverse_proxy analytics-proxy:8098"));
}

#[test]
fn document_content_services_are_available_through_the_proxy() {
    let caddy = caddyfile(Mode::Local, false);

    assert!(caddy.contains("uri strip_prefix /sync"));
    assert!(caddy.contains("reverse_proxy sync-service:8787"));
    assert!(caddy.contains("handle_path /lexical/*"));
    assert!(caddy.contains("reverse_proxy lexical-service:8096"));
    assert!(caddy.contains("handle_path /ai-editing/*"));
    assert!(caddy.contains("reverse_proxy ai-editing-worker:8933"));
}

/// The static-file block is the one route that differs by mode: LocalStack S3
/// fan-out locally, the dev-pointed service in dev.
#[test]
fn static_file_block_is_mode_specific() {
    assert!(caddyfile(Mode::Local, false).contains("/static-file-storage"));
    assert!(caddyfile(Mode::Dev, false).contains("handle_path /static-file/*"));
    assert!(!caddyfile(Mode::Dev, false).contains("/static-file-storage"));
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

/// The static-frontend block only appears in headless mode, and serves the
/// mounted bundle under `/app` with an SPA fallback. Attached `run_local` keeps
/// the dev server as the frontend origin and must not grow the block.
#[test]
fn static_frontend_block_is_opt_in() {
    let headless = caddyfile(Mode::Local, true);
    assert!(headless.contains("handle_path /app/* {"));
    assert!(headless.contains("root * /srv/frontend"));
    assert!(headless.contains("try_files {path} /index.html"));
    assert!(headless.contains("redir / \"/app/?{query}\" 302"));
    assert!(headless.contains("handle /mailpit/*"));

    let attached = caddyfile(Mode::Local, false);
    assert!(!attached.contains("/srv/frontend"));
    assert!(!attached.contains("redir / /app/ 302"));
    assert!(!attached.contains("handle /mailpit/*"));

    let headless_dev = caddyfile(Mode::Dev, true);
    assert!(!headless_dev.contains("handle /mailpit/*"));
}
