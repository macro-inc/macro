use super::*;
use crate::testing::{fixture_with, identity};
use tower::ServiceExt;

/// Settings for a local stack that published a quick tunnel: every reachability
/// path at once, which is also the only configuration that allows a proxy host.
fn local_stack(proxy: Option<&str>) -> (PreviewService, String) {
    let proxy = proxy.map(str::to_owned);
    let (service, _, _) = fixture_with(2222, |settings| {
        settings.domain = "preview.localhost".into();
        settings.https_port = 8443;
        settings.app_origin = "http://localhost:3000".into();
        settings.local_ssh_fallback = true;
        settings.ssh_proxy_host = proxy;
    });
    let key = service.settings().host_key.clone();
    (service, key)
}

async fn script(service: &PreviewService) -> String {
    let context = ServiceContext(PreviewToolContext {
        service: service.clone(),
        identity: identity(),
    });
    let user = identity().owner;
    let value = SharePreview { port: 5173 }
        .call(context, RequestContext::new(user))
        .await
        .unwrap();
    let script = value["script"].as_str().unwrap().to_owned();
    // The forward is what carries the agent's port into the tunnel; every
    // endpoint has to request it, proxied or not.
    assert_eq!(
        script.matches("-R 127.0.0.1:1:127.0.0.1:5173").count(),
        1 + usize::from(script.contains("preview_connect_proxy"))
    );
    script
}

#[tokio::test]
async fn a_local_stack_without_a_tunnel_offers_only_on_machine_endpoints() {
    let (service, _) = local_stack(None);
    let script = script(&service).await;

    assert!(script.contains("preview_connect 'localhost' 2222"));
    assert!(script.contains("preview_connect preview-gateway 2222"));
    assert!(!script.contains("preview_connect_proxy"));
    assert!(!script.contains("cloudflared"));
}

#[tokio::test]
async fn a_published_tunnel_is_tried_after_the_on_machine_endpoints() {
    let (service, _) = local_stack(Some("odds-and-ends.trycloudflare.com"));
    let script = script(&service).await;

    let connect = script
        .lines()
        .find(|line| line.starts_with("preview_connect '"))
        .expect("the connect chain is one line");
    assert_eq!(
        connect,
        "preview_connect 'localhost' 2222 || preview_connect preview-gateway 2222 || \
         preview_connect_proxy 'odds-and-ends.trycloudflare.com'"
    );
    assert!(script.contains("-o ProxyCommand=\"cloudflared access ssh --hostname $1\""));
    // The helper has to be fetched when absent: agent images do not ship it.
    assert!(script.contains("releases/latest/download/cloudflared-$preview_os-$preview_arch"));
}

#[tokio::test]
async fn every_endpoint_pins_the_same_host_key_under_its_own_name() {
    let (service, key) = local_stack(Some("odds-and-ends.trycloudflare.com"));
    let script = script(&service).await;

    let known_hosts: Vec<_> = script
        .lines()
        .skip_while(|line| !line.starts_with("cat > \"$preview_known_hosts\""))
        .skip(1)
        .take_while(|line| *line != "MACRO_PREVIEW_HOST_KEY")
        .collect();
    assert_eq!(
        known_hosts,
        vec![
            format!("[localhost]:2222 {key}"),
            format!("[preview-gateway]:2222 {key}"),
            // Dialled through a ProxyCommand on the default port, so `ssh` looks
            // this one up unbracketed.
            format!("odds-and-ends.trycloudflare.com {key}"),
        ]
    );
}

#[tokio::test]
async fn a_deployed_gateway_never_advertises_a_proxy_or_docker_endpoint() {
    let (service, _, _) = crate::testing::fixture(22);
    let script = script(&service).await;

    assert!(script.contains("preview_connect 'localhost' 22\n"));
    assert!(!script.contains("preview-gateway"));
    assert!(!script.contains("cloudflared"));
    assert!(script.contains("\nlocalhost "), "unbracketed on port 22");
}

#[test]
fn a_proxy_host_is_rejected_outside_a_local_stack() {
    let (service, _, _) = crate::testing::fixture(2222);
    let mut settings = service.settings().clone();
    settings.ssh_proxy_host = Some("odds-and-ends.trycloudflare.com".into());
    assert!(
        settings.validate().is_err(),
        "a public deployment must not reach its SSH listener through someone's quick tunnel"
    );

    settings.domain = "preview.localhost".into();
    settings.app_origin = "http://localhost:3000".into();
    assert!(settings.validate().is_ok());

    settings.ssh_proxy_host = Some("not a hostname".into());
    assert!(settings.validate().is_err());
}

#[test]
fn configured_control_hosts_are_added_to_the_loopback_allowlist() {
    assert_eq!(
        mcp_allowed_hosts(vec![
            "preview-gateway".into(),
            " localhost ".into(),
            String::new(),
        ]),
        vec!["localhost", "127.0.0.1", "::1", "preview-gateway"]
    );
}

#[test]
fn a_dropped_host_is_restored_only_from_an_allowed_forwarded_name() {
    let allowed = mcp_allowed_hosts(vec!["dev-gateway.macro.com".into()]);
    let mut headers = HeaderMap::new();
    headers.insert("x-forwarded-host", "dev-gateway.macro.com".parse().unwrap());
    restore_dropped_host(&mut headers, &"/preview/mcp".parse().unwrap(), &allowed);
    assert_eq!(headers[header::HOST], "dev-gateway.macro.com");

    let mut headers = HeaderMap::new();
    headers.insert("x-forwarded-host", "attacker.test".parse().unwrap());
    restore_dropped_host(&mut headers, &"/preview/mcp".parse().unwrap(), &allowed);
    assert!(headers.get(header::HOST).is_none());
}

#[tokio::test]
async fn live_discovery_lists_share_preview_without_a_session() {
    let (service, _, _) = crate::testing::fixture(22);
    let app = router(service, vec!["preview-gateway".into()]);
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list",
        "params": {}
    });
    let response = app
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/mcp")
                .header("host", "preview-gateway:8080")
                .header("content-type", "application/json")
                .header("accept", "application/json, text/event-stream")
                .body(axum::body::Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        response.status().is_success(),
        "discovery failed: {}",
        response.status()
    );
    let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024)
        .await
        .unwrap();
    let payload: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(payload["result"]["tools"][0]["name"], "SharePreview");
}

#[tokio::test]
async fn a_disallowed_host_is_rejected_before_tools_are_listed() {
    let (service, _, _) = crate::testing::fixture(22);
    let app = router(service, vec!["preview-gateway".into()]);
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list",
        "params": {}
    });
    let response = app
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/mcp")
                .header("host", "attacker.test")
                .header("content-type", "application/json")
                .header("accept", "application/json, text/event-stream")
                .body(axum::body::Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), axum::http::StatusCode::FORBIDDEN);
}
