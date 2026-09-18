use super::*;

#[test]
fn accepts_and_canonicalizes_https_origins() {
    for (raw, expected) in [
        (
            "https://forge.tail66c63e.ts.net:3000",
            "https://forge.tail66c63e.ts.net:3000",
        ),
        ("https://Forge.example:443/", "https://forge.example"),
        ("https://[::1]:3000", "https://[::1]:3000"),
    ] {
        assert_eq!(raw.parse::<PublicOrigin>().unwrap().as_str(), expected);
    }
}

#[test]
fn rejects_non_origins_and_unsafe_input() {
    for raw in [
        "http://forge:3000",
        "forge:3000",
        "https://forge/app",
        "https://forge/a/..",
        "https://forge//",
        "https://user@forge",
        "https://@forge",
        "https://user:pass@forge",
        "https://forge?x=1",
        "https://forge#fragment",
        "https://forge:0",
        " https://forge",
        "https://for\nge",
        "https://forge\\evil",
        "https://forge:99999",
        "https://*.example.com",
        "https://.example.com",
    ] {
        assert!(raw.parse::<PublicOrigin>().is_err(), "accepted {raw:?}");
    }
}
