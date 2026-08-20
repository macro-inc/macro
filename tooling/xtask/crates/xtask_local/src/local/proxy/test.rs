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
        // The port must be the service's OWN container port, not a blanket
        // 8080 — this assertion used to hardcode 8080 and so enforced the bug
        // where `/agent-harness` routed to a port nothing listened on.
        assert!(
            caddy.contains(&format!(
                "reverse_proxy {}:{}",
                svc.compose_name,
                svc.container_port()
            )),
            "Caddyfile is missing a route to {} on :{}",
            svc.compose_name,
            svc.container_port()
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

/// The generated Caddy upstream port and the container's `PORT` env come from
/// two different generators (`proxy` and `gen_compose`). They must agree for
/// every proxied service: when they drifted, the proxy dialled
/// `agent_harness_service:8080` while the harness listened on 8101, and every
/// request through `/agent-harness` failed with a 502 before reaching it.
#[test]
fn proxy_upstream_port_matches_the_container_port() {
    let caddy = caddyfile(Mode::Local, false);
    for svc in inventory::RUST_SERVICES {
        if svc.path_prefix.is_none() {
            continue;
        }
        let port = svc.container_port();
        assert!(
            caddy.contains(&format!("reverse_proxy {}:{port}", svc.compose_name)),
            "{} is proxied to a port other than its container port :{port}",
            svc.compose_name
        );
        // The wrong-port route must not also be present.
        for other in [inventory::DEFAULT_CONTAINER_PORT, 8101] {
            if other != port {
                assert!(
                    !caddy.contains(&format!("reverse_proxy {}:{other}", svc.compose_name)),
                    "{} has a stale route to :{other}",
                    svc.compose_name
                );
            }
        }
    }
}

/// The harness is the one service that does not listen on the conventional
/// 8080, so it is the case the shared-source wiring exists for. Pinned
/// explicitly so a change to its port has to be made deliberately.
#[test]
fn agent_harness_is_proxied_to_its_own_port() {
    let harness = inventory::RUST_SERVICES
        .iter()
        .find(|s| s.compose_name == "agent_harness_service")
        .expect("agent_harness_service is inventoried");
    assert_eq!(harness.container_port(), 8101);
    assert!(
        caddyfile(Mode::Local, false).contains("reverse_proxy agent_harness_service:8101"),
        "the /agent-harness route must target :8101"
    );
}
