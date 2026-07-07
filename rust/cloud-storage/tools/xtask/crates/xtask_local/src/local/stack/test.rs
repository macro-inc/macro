use super::*;

/// The quick-tunnel URL is fished out of cloudflared's boxed startup banner —
/// the parser must survive the surrounding pipes/whitespace and ignore logs
/// with no tunnel line.
#[test]
fn finds_the_trycloudflare_url_in_the_banner() {
    let banner = "\
2026-07-07T00:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...
2026-07-07T00:00:01Z INF +--------------------------------------------------------------+
2026-07-07T00:00:01Z INF |  Your quick Tunnel has been created! Visit it at:            |
2026-07-07T00:00:01Z INF |  https://oddly-shaped-example-host.trycloudflare.com         |
2026-07-07T00:00:01Z INF +--------------------------------------------------------------+
";
    assert_eq!(
        find_trycloudflare_url(banner).as_deref(),
        Some("https://oddly-shaped-example-host.trycloudflare.com")
    );
    assert_eq!(find_trycloudflare_url("no tunnel here"), None);
    // A URL must be present, not just the domain.
    assert_eq!(find_trycloudflare_url("x.trycloudflare.com"), None);
}

/// `up` writes stack.json and `update`/`status` read it back — the record and
/// the mode labels must stay in agreement.
#[test]
fn stack_state_roundtrips() {
    let state = StackState {
        mode: "local".to_string(),
        frontend: "static".to_string(),
    };
    let json = serde_json::to_string(&state).unwrap();
    let back: StackState = serde_json::from_str(&json).unwrap();
    assert_eq!(back.mode, "local");
    assert_eq!(back.frontend, "static");
    assert!(mode_from_label(&back.mode).is_ok());
    assert!(mode_from_label("nonsense").is_err());
}
