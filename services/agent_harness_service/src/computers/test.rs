use super::computer_reachable;

fn reachable(url: &str) -> Option<String> {
    computer_reachable(url.parse().unwrap()).map(|url| url.to_string())
}

#[test]
fn a_computer_is_never_given_this_machines_loopback_as_its_telemetry_intake() {
    for loopback in [
        "http://localhost:4318",
        "http://LOCALHOST:4318",
        "http://collector.localhost:4318",
        "http://127.0.0.1:4318",
        "http://[::1]:4318",
        "http://0.0.0.0:4318",
        "http://[::]:4318",
    ] {
        assert_eq!(reachable(loopback), None, "{loopback}");
    }
}

#[test]
fn a_reachable_telemetry_intake_is_kept() {
    for url in [
        "http://otel-collector:4318/",
        "https://macro-prox-dev.macroverse.workers.dev/i/otlp",
        "http://notlocalhost:4318/",
    ] {
        assert_eq!(reachable(url).as_deref(), Some(url));
    }
}
