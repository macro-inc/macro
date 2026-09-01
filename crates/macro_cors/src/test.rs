use super::*;

#[test]
fn allows_localhost_and_subdomain_localhost_dev_ports() {
    for origin in [
        "http://localhost:3000",
        "http://localhost:3999",
        "http://localhost:20000",
        "http://alice.localhost:3000",
        "http://carol.localhost:3005",
    ] {
        assert!(is_allowed_origin(origin), "{origin}");
    }
}

#[test]
fn rejects_non_local_and_out_of_range_origins() {
    for origin in [
        "http://localhost:2999",
        "http://localhost:9000",
        "http://alice.localhost:9000",
        "https://alice.localhost:3000",
        "http://evil-localhost:3000",
        "http://alice.localhost.evil.com:3000",
        "http://example.com:3000",
    ] {
        assert!(!is_allowed_origin(origin), "{origin}");
    }
}

#[test]
fn allows_static_origins() {
    assert!(is_allowed_origin("https://macro.com"));
    assert!(is_allowed_origin("tauri://localhost"));
}

#[test]
fn allows_request_id_header() {
    assert!(EXTRA_HEADERS.contains(&REQUEST_ID_HEADER));
}

#[test]
fn exposes_request_id_header() {
    assert!(EXPOSED_HEADERS.contains(&REQUEST_ID_HEADER));
}

#[test]
fn allows_head_requests() {
    assert!(ALLOWED_METHODS.contains(&Method::HEAD));
}
