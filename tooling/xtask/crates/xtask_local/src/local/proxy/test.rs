use super::*;
use crate::local::instance::Instance;
use crate::local::{inventory, repo_root};

fn test_instance() -> Instance {
    Instance::derive(Some("agent-a"), Some(41_000)).unwrap()
}

/// Apply rewrites exactly as Caddy does: each one, in order, over the whole
/// value. Go and Rust regexes agree on this syntax and on `$1` expansion.
fn apply(rewrites: &[HeaderRewrite], header: &str) -> String {
    rewrites.iter().fold(header.to_string(), |value, rewrite| {
        regex::Regex::new(&rewrite.find)
            .unwrap()
            .replace_all(&value, rewrite.replace.as_str())
            .into_owned()
    })
}

#[test]
fn vite_routes_cover_every_backend_prefix_and_no_frontend_routes() {
    let prefixes = frontend_path_prefixes();
    for svc in inventory::RUST_SERVICES {
        if let Some(prefix) = svc.path_prefix {
            assert!(prefixes.contains(&prefix));
        }
    }
    for prefix in [
        "/websocket",
        "/sync",
        "/i",
        "/lexical",
        "/ai-editing",
        "/static-file",
        "/local-storage",
    ] {
        assert!(prefixes.contains(&prefix));
    }
    assert!(!prefixes.contains(&"/app"));
    assert!(!prefixes.contains(&"/"));
    let unique: std::collections::HashSet<_> = prefixes.iter().collect();
    assert_eq!(unique.len(), prefixes.len());
}

/// Every inventoried service that declares a path prefix must get a route in the
/// generated Caddyfile, targeting its canonical compose service name. This is
/// the guarantee that replaces the old hand-maintained route list.
#[test]
fn generates_a_route_for_every_prefixed_service() {
    let caddy = caddyfile(&test_instance(), Mode::Local, false);
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
    let caddy = caddyfile(&test_instance(), Mode::Dev, false);
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
    let caddy = caddyfile(&test_instance(), Mode::Local, false);
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
    let caddy = caddyfile(&test_instance(), Mode::Local, false);
    assert!(caddy.contains("handle /i/* {"));
    assert!(caddy.contains("reverse_proxy analytics-proxy:8098"));
}

#[test]
fn document_content_services_are_available_through_the_proxy() {
    let caddy = caddyfile(&test_instance(), Mode::Local, false);

    assert!(caddy.contains("uri strip_prefix /sync"));
    assert!(caddy.contains("reverse_proxy sync-service:8787"));
    assert!(caddy.contains("header_up Origin http://localhost:3000"));
    assert!(!caddyfile(&test_instance(), Mode::Dev, false).contains("header_up Origin"));
    assert!(caddy.contains("handle_path /lexical/*"));
    assert!(caddy.contains("reverse_proxy lexical-service:8096"));
    assert!(caddy.contains("handle_path /ai-editing/*"));
    assert!(caddy.contains("reverse_proxy ai-editing-worker:8933"));
}

/// The static-file block is the one route that differs by mode: LocalStack S3
/// fan-out locally, the dev-pointed service in dev.
#[test]
fn static_file_block_is_mode_specific() {
    let local = caddyfile(&test_instance(), Mode::Local, false);
    assert!(local.contains("/static-file-storage"));
    // A route at site scope sorts after the Vite catch-all handle and loops.
    assert!(local.contains("handle_path /static-file/*"));
    assert!(!local.contains("route /static-file/*"));
    assert!(caddyfile(&test_instance(), Mode::Dev, false).contains("handle_path /static-file/*"));
    assert!(!caddyfile(&test_instance(), Mode::Dev, false).contains("/static-file-storage"));
    assert!(local.contains("handle_path /local-storage/*"));
    assert!(
        !caddyfile(&test_instance(), Mode::Dev, false).contains("handle_path /local-storage/*")
    );
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
/// forwards frontend requests to Vite instead of serving a bundle.
#[test]
fn static_frontend_block_is_opt_in() {
    let headless = caddyfile(&test_instance(), Mode::Local, true);
    assert!(headless.contains("handle_path /app/* {"));
    assert!(headless.contains("root * /srv/frontend"));
    assert!(headless.contains("try_files {path} /index.html"));
    assert!(headless.contains("redir / \"/app/?{query}\" 302"));
    assert!(headless.contains("handle /mailpit/*"));

    let attached = caddyfile(&test_instance(), Mode::Local, false);
    assert!(!attached.contains("/srv/frontend"));
    assert!(attached.contains("reverse_proxy host.docker.internal:{$VITE_PORT}"));
    assert!(attached.contains(&format!(
        "@backend_root path {}",
        frontend_path_prefixes().join(" ")
    )));
    assert!(attached.contains("respond @backend_root 404"));
    assert!(!headless.contains("host.docker.internal"));
    assert!(!attached.contains("redir / /app/ 302"));
    assert!(!attached.contains("handle /mailpit/*"));

    let headless_dev = caddyfile(&test_instance(), Mode::Dev, true);
    assert!(!headless_dev.contains("handle /mailpit/*"));
}

/// Only host-run Vite needs protection from concurrent module connection bursts.
#[test]
fn vite_connection_limit_is_scoped_to_frontend() {
    for mode in [Mode::Local, Mode::Dev] {
        let attached = caddyfile(&test_instance(), mode, false);
        assert_eq!(attached.matches("max_conns_per_host").count(), 1);
        let (backend_routes, frontend_route) = attached
            .split_once("reverse_proxy host.docker.internal:{$VITE_PORT} {")
            .expect("attached frontend must proxy to Vite");
        assert!(!backend_routes.contains("max_conns_per_host"));
        assert!(frontend_route.contains("transport http {\n                max_conns_per_host 16"));
        assert!(!caddyfile(&test_instance(), mode, true).contains("max_conns_per_host"));
    }
}

/// Local Caddy speaks HTTPS with a machine certificate and stamps wildcard CORS
/// on every response. Dev still uses TLS (same proxy) but does not overlay
/// CORS, because it fans out to the shared-dev gateway.
#[test]
fn local_proxy_uses_tls_and_wildcard_cors() {
    let local = caddyfile(&test_instance(), Mode::Local, false);
    assert!(local.contains("tls /etc/caddy/certs/server.pem /etc/caddy/certs/server-key.pem"));
    // Keep main's internal certificates for the separate preview listener.
    assert!(local.contains("auto_https disable_redirects"));
    assert!(local.contains("https://*.preview.localhost:8443"));
    assert!(local.contains("@cors header Origin *"));
    assert!(local.contains("@cors_preflight"));
    assert!(local.contains("Access-Control-Allow-Origin \"{http.request.header.Origin}\""));
    assert!(
        local.contains("defer"),
        "CORS overlay must defer so reverse_proxy cannot overwrite the reflected Origin"
    );
    assert!(
        !local.contains("-Access-Control-Allow-Origin"),
        "deferred -Access-Control-* deletes strip the CORS headers this overlay sets"
    );

    let dev = caddyfile(&test_instance(), Mode::Dev, false);
    assert!(dev.contains("tls /etc/caddy/certs/server.pem /etc/caddy/certs/server-key.pem"));
    assert!(!dev.contains("@cors header Origin *"));
    assert!(!dev.contains("@cors_preflight"));
}

#[test]
fn proxy_origin_is_https() {
    let instance = crate::local::instance::Instance::derive(None, None).unwrap();
    assert_eq!(url(&instance), "https://localhost:8090");
    assert_eq!(ws_url(&instance), "wss://localhost:8090");
    assert!(
        ca_pem().is_file(),
        "checked-in CA is missing at {}",
        ca_pem().display()
    );
}

/// The bug: cookies ignore ports, so logging into one stack replaced the tokens
/// of every other stack on that hostname, and each stack was sent the others'.
#[test]
fn stacks_never_see_each_others_cookies() {
    let a = cookie_rewrites(&Instance::derive(Some("agent-a"), Some(41_000)).unwrap());
    let b = cookie_rewrites(&Instance::derive(Some("agent-b"), Some(41_100)).unwrap());
    let set_cookie = "local-macro-access-token=tok; Path=/; Secure; HttpOnly; SameSite=None";

    // Same service response, different names in the shared jar.
    assert_eq!(
        apply(&a.set_cookie, set_cookie),
        "macro-agent-a--local-macro-access-token=tok; Path=/; Secure; HttpOnly; SameSite=None"
    );
    assert_eq!(
        apply(&b.set_cookie, set_cookie),
        "macro-agent-b--local-macro-access-token=tok; Path=/; Secure; HttpOnly; SameSite=None"
    );

    let jar = "macro-agent-a--local-macro-access-token=from-a; \
               macro-agent-a--local-macro-refresh-token=refresh-a; \
               macro-agent-b--local-macro-access-token=from-b; login=true";
    assert_eq!(
        apply(&a.cookie, jar),
        "local-macro-access-token=from-a; local-macro-refresh-token=refresh-a"
    );
    assert_eq!(apply(&b.cookie, jar), "local-macro-access-token=from-b");
}

#[test]
fn a_stack_signed_out_of_its_own_session_sends_no_foreign_token() {
    let a = cookie_rewrites(&Instance::derive(Some("agent-a"), Some(41_000)).unwrap());

    for jar in [
        "macro-agent-b--local-macro-access-token=from-b",
        "macro-agent-b--local-macro-access-token=from-b; login=true",
        // Tokens from before namespacing, or set on a service's own port.
        "local-macro-access-token=old; login=true",
        "login=true; local-macro-refresh-token=old",
        // A longer instance name that starts with this one is still foreign.
        "macro-agent-a-2--local-macro-access-token=other",
        "__Host-macro-agent-a-2--macro_mcp_oauth=other",
    ] {
        assert_eq!(apply(&a.cookie, jar), "", "jar: {jar}");
    }
}

/// Browsers reject a `__Host-` or `__Secure-` cookie unless the name starts
/// with that prefix, so the instance prefix goes after it.
#[test]
fn prefixed_cookie_names_keep_their_browser_prefix() {
    let a = cookie_rewrites(&test_instance());

    for (from_service, in_jar) in [
        (
            "__Host-macro_mcp_oauth=bind; Path=/; Secure",
            "__Host-macro-agent-a--macro_mcp_oauth=bind; Path=/; Secure",
        ),
        (
            "__Secure-session=s; Path=/; Secure",
            "__Secure-macro-agent-a--session=s; Path=/; Secure",
        ),
        // Leading underscores without a browser prefix are ordinary names.
        ("_ga=1; Path=/", "macro-agent-a--_ga=1; Path=/"),
        ("__other=1", "macro-agent-a--__other=1"),
    ] {
        let jar = apply(&a.set_cookie, from_service);
        assert_eq!(jar, in_jar);
        let name_value = jar.split(';').next().unwrap();
        assert_eq!(
            apply(&a.cookie, name_value),
            from_service.split(';').next().unwrap()
        );
    }
}

/// A bare copy of a name the stack sets, from an older stack or a service's
/// own port, would otherwise reach the service next to the stack's own cookie,
/// and cookie jars keep the last cookie of a name.
#[test]
fn a_bare_copy_never_shadows_the_stacks_own_cookie() {
    let a = cookie_rewrites(&test_instance());

    for (jar, reaches_service) in [
        (
            "__Host-macro-agent-a--macro_mcp_oauth=mine; __Host-macro_mcp_oauth=bare",
            "__Host-macro_mcp_oauth=mine",
        ),
        (
            "__Host-macro-preview=bare; __Host-macro-agent-a--macro-preview=mine",
            "__Host-macro-preview=mine",
        ),
        (
            "local-macro-access-token=bare; macro-agent-a--local-macro-access-token=mine",
            "local-macro-access-token=mine",
        ),
        // JavaScript-set and analytics cookies aren't for services.
        (
            "_ga=1; macro-agent-a--local-macro-access-token=mine; __Secure-x=1",
            "local-macro-access-token=mine",
        ),
    ] {
        assert_eq!(apply(&a.cookie, jar), reaches_service, "jar: {jar}");
    }
}

/// The request rules work on cookie boundaries only.
#[test]
fn request_rules_respect_cookie_boundaries() {
    let a = cookie_rewrites(&test_instance());

    for (jar, reaches_service) in [
        // A value that looks like a prefix is left alone.
        (
            "macro-agent-a--x=__Host-macro-agent-a--y",
            "x=__Host-macro-agent-a--y",
        ),
        (
            "macro-agent-a--x=macro-agent-a--y; macro-agent-a--z=1",
            "x=macro-agent-a--y; z=1",
        ),
        // A nameless cookie is dropped without taking its neighbour along.
        ("local-macro-flag; macro-agent-a--login=true", "login=true"),
        (
            "macro-agent-a--a=1; nameless; macro-agent-a--b=2",
            "a=1; b=2",
        ),
        // Cookies joined without a space, or with extra whitespace.
        (
            "macro-agent-a--a=1;macro-agent-b--b=2;macro-agent-a--c=3",
            "a=1; c=3",
        ),
        ("  macro-agent-a--a=1 ;\tlocal-macro-x=2", "a=1 "),
        ("", ""),
    ] {
        assert_eq!(apply(&a.cookie, jar), reaches_service, "jar: {jar:?}");
    }
}

/// A service deletes a cookie by setting it empty and expired; the deletion
/// has to name the prefixed cookie the browser holds.
#[test]
fn deleting_a_cookie_deletes_the_prefixed_copy() {
    let a = cookie_rewrites(&test_instance());
    assert_eq!(
        apply(
            &a.set_cookie,
            "local-macro-access-token=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
        ),
        "macro-agent-a--local-macro-access-token=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
    );
    assert_eq!(
        apply(
            &a.set_cookie,
            "__Host-macro-preview=; Path=/; Secure; Max-Age=0"
        ),
        "__Host-macro-agent-a--macro-preview=; Path=/; Secure; Max-Age=0"
    );
    // A nameless Set-Cookie has nothing to prefix and is left as sent.
    assert_eq!(apply(&a.set_cookie, "flag; Path=/"), "flag; Path=/");
}

/// Caddy treats an empty replacement as "set the header to the pattern", which
/// would overwrite the Cookie header with a regex.
#[test]
fn no_cookie_rewrite_has_an_empty_replacement() {
    let rewrites = cookie_rewrites(&test_instance());
    for rewrite in rewrites.set_cookie.iter().chain(&rewrites.cookie) {
        assert!(!rewrite.replace.is_empty(), "{}", rewrite.find);
    }
}

#[test]
fn only_local_stacks_namespace_cookies() {
    let local = caddyfile(&test_instance(), Mode::Local, true);
    assert!(
        local.contains("request_header Cookie \"; (__Host-|__Secure-)?macro-agent-a--\" \";!$1\"")
    );
    assert!(local.contains("Set-Cookie \"^macro-agent-a--__Host-\" \"__Host-macro-agent-a--\""));

    // `run_dev` shares cookies with the dev gateway's own services.
    assert!(!caddyfile(&test_instance(), Mode::Dev, true).contains("Set-Cookie"));
}

/// Runs the generated cookie block in a real Caddy in front of a stub service
/// that sets cookies and echoes the `Cookie` header it receives. CI has no
/// Caddy binary, so run it with
/// `nix shell nixpkgs#caddy -c cargo test -p xtask_local -- --ignored real_caddy`.
#[test]
#[ignore = "needs a caddy binary on PATH"]
fn real_caddy_applies_the_generated_cookie_rules() {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::process::{Child, Command, Stdio};

    struct Kill(Child);
    impl Drop for Kill {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let free_port = || {
        TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    };
    let (service, proxy) = (free_port(), free_port());

    let caddyfile = format!(
        "{{\n    admin off\n    auto_https off\n}}\n\n\
         http://127.0.0.1:{service} {{\n    header {{\n\
         +Set-Cookie \"local-macro-access-token=tok; Path=/; Secure; HttpOnly\"\n\
         +Set-Cookie \"__Host-macro_mcp_oauth=bind; Path=/; Secure\"\n\
         +Set-Cookie \"__Secure-s=1; Path=/; Secure\"\n\
         +Set-Cookie \"_ga=1; Path=/\"\n\
         +Set-Cookie \"local-macro-refresh-token=; Path=/; Max-Age=0\"\n\
         }}\n    respond \"{{http.request.header.Cookie}}\" 200\n}}\n\n\
         http://127.0.0.1:{proxy} {{\n{block}    reverse_proxy 127.0.0.1:{service}\n}}\n",
        block = cookie_block(&test_instance()),
    );
    let dir = std::env::temp_dir().join(format!("xtask-real-caddy-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let config = dir.join("Caddyfile");
    std::fs::write(&config, caddyfile).unwrap();

    let mut child = Command::new("caddy")
        .args(["run", "--adapter", "caddyfile", "--config"])
        .arg(&config)
        .env("HOME", &dir)
        .env("XDG_DATA_HOME", &dir)
        .env("XDG_CONFIG_HOME", &dir)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("caddy on PATH");
    let stderr = child.stderr.take().unwrap();
    let _caddy = Kill(child);
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if line.contains("serving initial configuration") {
                let _ = ready_tx.send(());
            }
        }
    });
    ready_rx
        .recv_timeout(std::time::Duration::from_secs(20))
        .expect("caddy started");

    let request = |cookie: &str| {
        let mut stream = TcpStream::connect(("127.0.0.1", proxy)).unwrap();
        write!(
            stream,
            "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: {cookie}\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        let (head, body) = response.split_once("\r\n\r\n").unwrap();
        let set_cookies: Vec<String> = head
            .lines()
            .filter_map(|line| line.strip_prefix("Set-Cookie: ").map(str::to_owned))
            .collect();
        (set_cookies, body.to_owned())
    };

    let (set_cookies, _) = request("x=1");
    assert_eq!(
        set_cookies,
        [
            "macro-agent-a--local-macro-access-token=tok; Path=/; Secure; HttpOnly",
            "__Host-macro-agent-a--macro_mcp_oauth=bind; Path=/; Secure",
            "__Secure-macro-agent-a--s=1; Path=/; Secure",
            "macro-agent-a--_ga=1; Path=/",
            "macro-agent-a--local-macro-refresh-token=; Path=/; Max-Age=0",
        ]
    );

    for (jar, reaches_service) in [
        (
            "macro-agent-a--local-macro-access-token=mine; macro-agent-b--local-macro-access-token=theirs; login=true",
            "local-macro-access-token=mine",
        ),
        (
            "__Host-macro-agent-a--macro_mcp_oauth=mine; __Host-macro_mcp_oauth=bare",
            "__Host-macro_mcp_oauth=mine",
        ),
        (
            "local-macro-flag; macro-agent-a--x=__Host-macro-agent-a--y;macro-agent-a--z=1",
            "x=__Host-macro-agent-a--y; z=1",
        ),
        (
            "macro-agent-b--local-macro-access-token=theirs; local-macro-access-token=old",
            "",
        ),
    ] {
        assert_eq!(request(jar).1, reaches_service, "jar: {jar}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}
