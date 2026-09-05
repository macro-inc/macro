//! The per-instance single-origin reverse proxy (Caddy).
//!
//! One backend origin the frontend points at via `VITE_LOCAL_BACKEND_ORIGIN`.
//! Path prefixes mirror the `serverHostLocal` keys in `servers.ts`; Caddy
//! `reverse_proxy` upgrades WebSockets transparently (connection-gateway,
//! websocket-service, sync-service). The `/static-file/*` block reproduces the
//! nginx CDN fan-out (S3 via LocalStack + the static-file service).

use std::path::PathBuf;

use anyhow::{Context, Result};

use super::gen_compose::caddyfile_path;
use super::instance::{Instance, Port};
use super::{Mode, inventory};

/// The host-facing proxy origin.
pub fn url(instance: &Instance) -> String {
    format!("http://localhost:{}", instance.port(Port::Proxy))
}

/// Write the instance Caddyfile and return its path. Both local and dev keep a
/// single frontend origin; Local fans every inventory prefix to a local
/// container, while Dev fans Local-only prefixes (services that must not run
/// against shared-dev) to the deployed gateway. The static-file block also
/// differs (dev has no local LocalStack). With `static_frontend` the proxy also
/// serves the built app bundle at `/app`, making it the one origin for the
/// whole product.
pub fn write_caddyfile(instance: &Instance, mode: Mode, static_frontend: bool) -> Result<PathBuf> {
    let path = caddyfile_path(instance);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .with_context(|| format!("creating proxy dir {}", dir.display()))?;
    }
    std::fs::write(&path, caddyfile(mode, static_frontend))
        .with_context(|| format!("writing {}", path.display()))?;
    Ok(path)
}

/// Assemble the Caddyfile: the listener head, the generated per-service routes
/// (from the inventory), the special non-inventory routes, the mode's
/// static-file block, the optional static-frontend block, then the tail.
fn caddyfile(mode: Mode, static_frontend: bool) -> String {
    let static_block = if mode.spec().static_files_via_localstack {
        STATIC_FILE_LOCAL
    } else {
        STATIC_FILE_DEV
    };
    let mailpit_block = if static_frontend && mode.spec().runs_local_infra {
        MAILPIT_ROUTE
    } else {
        ""
    };
    let frontend_block = if static_frontend { FRONTEND_STATIC } else { "" };
    format!(
        "{CADDY_HEAD}{routes}{SPECIAL_ROUTES}{mailpit_block}{static_block}{frontend_block}{CADDY_TAIL}",
        routes = service_routes(mode)
    )
}

/// Shared-dev gateway origin for Local-only inventory prefixes under `run-dev`.
/// Keep the path (no strip) — gateway tenants are mounted under this prefix.
const DEV_GATEWAY_ORIGIN: &str = "https://dev-gateway.macro.com";

/// Generate the reverse-proxy routes for every inventoried service that exposes
/// a path prefix. The inventory is the single source, so adding a service's
/// proxy route is one field there — not a hand-edit here that can drift.
fn service_routes(mode: Mode) -> String {
    let mut out = String::new();
    for svc in inventory::RUST_SERVICES {
        let Some(prefix) = svc.path_prefix else {
            continue;
        };
        if svc.in_mode(mode) {
            out.push_str(&local_route_block(
                prefix,
                svc.compose_name,
                svc.is_websocket,
            ));
        } else if mode == Mode::Dev && svc.in_mode(Mode::Local) {
            // Local-only: do not start the binary against shared-dev, but keep
            // the single-origin proxy by fanning out to the deployed gateway.
            out.push_str(&dev_gateway_route_block(prefix, svc.is_websocket));
        }
    }
    out
}

/// One Caddy route to a local service container (always on `:8080`). HTTP uses
/// `handle_path` (which strips the prefix); WebSocket needs the bare-prefix
/// `@matcher` + explicit strip so the frontend's trailing-slash-less connect URL
/// still matches. The target is the canonical compose service name, which always
/// resolves on the proxy's networks.
fn local_route_block(prefix: &str, target: &str, is_websocket: bool) -> String {
    if is_websocket {
        let m = matcher_name(prefix);
        format!(
            "    {m} path {prefix} {prefix}/*\n    handle {m} {{\n        uri strip_prefix {prefix}\n        reverse_proxy {target}:8080\n    }}\n"
        )
    } else {
        format!("    handle_path {prefix}/* {{\n        reverse_proxy {target}:8080\n    }}\n")
    }
}

/// Dev route to the shared gateway: keep the path prefix (gateway mounts are
/// prefixed) and set `Host` so TLS/SNI + ALB host routing work.
fn dev_gateway_route_block(prefix: &str, is_websocket: bool) -> String {
    let host = DEV_GATEWAY_ORIGIN
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    if is_websocket {
        let m = matcher_name(prefix);
        format!(
            "    {m} path {prefix} {prefix}/*\n    handle {m} {{\n        reverse_proxy {DEV_GATEWAY_ORIGIN} {{\n            header_up Host {host}\n        }}\n    }}\n"
        )
    } else {
        format!(
            "    handle {prefix}/* {{\n        reverse_proxy {DEV_GATEWAY_ORIGIN} {{\n            header_up Host {host}\n        }}\n    }}\n"
        )
    }
}

/// A Caddy named-matcher token from a path prefix (drop the slash; hyphens →
/// underscores so it's a single bare token).
fn matcher_name(prefix: &str) -> String {
    format!("@{}", prefix.trim_start_matches('/').replace('-', "_"))
}

/// Caddy listens on `{$PROXY_PORT}` (set in the compose service env). Static
/// content, plaintext HTTP, automatic WebSocket upgrade. The per-service routes
/// (generated from the inventory), the special routes, the static-file block,
/// and the closing brace follow.
const CADDY_HEAD: &str = r#"# GENERATED by `cargo x` — do not edit.
{
    auto_https off
    admin off
}

:{$PROXY_PORT} {
    # Caddy requires the block body on its own lines (no single-line `{ ... }`).
"#;

/// Routes for services that aren't in the Rust inventory (external / base-compose
/// services on their own ports), so they can't be generated from it. The
/// WebSocket routes match the bare prefix too (the frontend connects without a
/// trailing slash, which `handle_path /x/*` would miss).
const SPECIAL_ROUTES: &str = r#"    @websocket path /websocket /websocket/*
    handle @websocket {
        uri strip_prefix /websocket
        reverse_proxy websocket-service:6969
    }
    @sync path /sync /sync/*
    handle @sync {
        uri strip_prefix /sync
        reverse_proxy sync-service:8787
    }
    # Analytics/telemetry proxy worker (PostHog and OTLP traces/logs).
    # No prefix strip: the worker itself routes on the /i/{ph,dd,otlp} prefix,
    # and it listens on 8098, not the :8080 the generated routes assume.
    # Set CF-Connecting-IP (absent without Cloudflare's edge in front) so the
    # worker's rate-limit keying has a client IP instead of erroring.
    handle /i/* {
        reverse_proxy analytics-proxy:8098 {
            header_up CF-Connecting-IP {http.request.remote.host}
        }
    }
    handle_path /lexical/* {
        reverse_proxy lexical-service:8096
    }
    handle_path /ai-editing/* {
        reverse_proxy ai-editing-worker:8933
    }
"#;

const MAILPIT_ROUTE: &str = r#"    # Mailpit serves itself under /mailpit (MP_WEBROOT), so no prefix strip —
    # this is how a headless stack reads its passwordless login codes.
    handle /mailpit/* {
        reverse_proxy mailpit:8025
    }
    redir /mailpit /mailpit/ 308

"#;

/// Local: /api and /internal go to the service, everything else to the S3 bucket
/// via LocalStack (mirrors infra/local/nginx/static-file-cdn.conf).
const STATIC_FILE_LOCAL: &str = r#"    route /static-file/* {
        uri strip_prefix /static-file
        @svc path /api/* /internal/*
        reverse_proxy @svc static-file-service:8080
        rewrite * /static-file-storage{uri}
        reverse_proxy localstack:4566
    }
"#;

/// Dev: no local LocalStack — route all static-file paths through the local
/// static-file-service (which is pointed at dev S3).
const STATIC_FILE_DEV: &str = r#"    handle_path /static-file/* {
        reverse_proxy static-file-service:8080
    }
"#;

/// Headless mode: the proxy serves the built app bundle (mounted at
/// `/srv/frontend` — see `gen_compose::add_proxy_service`). The bundle is built
/// with `base: /app`, so URL space `/app/*` maps onto the dist root after the
/// prefix strip; unknown paths fall back to `index.html` (SPA routing). Caddy
/// sorts `redir` before `handle_path`, so the exact-path redirects win first.
const FRONTEND_STATIC: &str = r#"    redir / "/app/?{query}" 302
    redir /app /app/ 308
    handle_path /app/* {
        root * /srv/frontend
        try_files {path} /index.html
        file_server
    }
"#;

const CADDY_TAIL: &str = r#"
    respond "macro local proxy" 200
}
"#;

#[cfg(test)]
mod test;
