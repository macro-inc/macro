use super::*;

#[test]
fn finds_the_minted_hostname_in_cloudflareds_banner() {
    let line = "2026-08-27T00:00:00Z INF |  https://odds-and-ends.trycloudflare.com  |";
    assert_eq!(
        quick_tunnel_url(line).as_deref(),
        Some("https://odds-and-ends.trycloudflare.com")
    );
}

/// The banner also mentions the docs page and the local target - neither of
/// which is the tunnel.
#[test]
fn ignores_every_other_url_cloudflared_logs() {
    for line in [
        "INF Requesting new quick Tunnel on trycloudflare.com...",
        "INF |  https://developers.cloudflare.com/cloudflare-one/  |",
        "INF Route propagating http://localhost:8102",
        "",
    ] {
        assert_eq!(quick_tunnel_url(line), None, "{line}");
    }
}

/// A hostname that died at spawn reports the death, not a 30s wait.
#[test]
fn a_closed_log_reports_the_exit_immediately() {
    let started = std::time::Instant::now();
    let refusal = await_hostname(std::io::empty()).expect_err("refused");
    assert!(refusal.to_string().contains("exited"), "{refusal}");
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[test]
fn a_log_carrying_the_hostname_resolves_it() {
    let log = "INF Requesting new quick Tunnel on trycloudflare.com...\n\
               INF |  https://odds-and-ends.trycloudflare.com  |\n";
    let url = await_hostname(std::io::Cursor::new(log.to_owned())).expect("resolved");
    assert_eq!(url, "https://odds-and-ends.trycloudflare.com");
}
