use super::*;

const ORIGIN: &str = "https://forge.tail66c63e.ts.net:3000";

#[test]
fn admits_only_the_configured_origin_in_local() {
    assert!(is_allowed(ORIGIN, "local", Some(ORIGIN)));
    for environment in ["", "development", "dev", "production", "prod"] {
        assert!(!is_allowed(ORIGIN, environment, Some(ORIGIN)));
    }
    assert!(!is_allowed(ORIGIN, "local", None));
    for origin in [
        "http://forge.tail66c63e.ts.net:3000",
        "https://forge.tail66c63e.ts.net",
        "https://forge.tail66c63e.ts.net:3001",
        "https://forge.tail66c63e.ts.net.evil:3000",
        "https://user@forge.tail66c63e.ts.net:3000",
        "https://forge.tail66c63e.ts.net:3000/app",
    ] {
        assert!(!is_allowed(origin, "local", Some(ORIGIN)), "{origin}");
    }
    for origin in [
        "https://user@forge:3000",
        "https://forge:3000/app",
        "http://forge:3000",
        "https://forge:3000/",
    ] {
        assert!(
            !is_allowed(origin, "local", Some(origin)),
            "invalid config {origin}"
        );
    }
}
