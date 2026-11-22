use super::*;

/// A header a `Connection` header names is that connection's, so it doesn't
/// cross the forwarder, nor do the fixed hop-by-hop headers or a mark or
/// trace context the program set.
#[test]
fn only_end_to_end_headers_cross_the_forwarder() {
    let mut headers = HeaderMap::new();
    headers.append("connection", HeaderValue::from_static("keep-alive, X-Hop"));
    headers.append("x-hop", HeaderValue::from_static("local"));
    headers.append("keep-alive", HeaderValue::from_static("timeout=5"));
    headers.append("x-macro-code-execution", HeaderValue::from_static("0"));
    headers.append(
        "traceparent",
        HeaderValue::from_static("00-forged-forged-01"),
    );
    headers.append("authorization", HeaderValue::from_static("Bearer token"));
    headers.append("content-type", HeaderValue::from_static("application/json"));
    let kept = end_to_end(&headers);
    let names: Vec<&str> = kept.keys().map(HeaderName::as_str).collect();
    assert_eq!(names, ["authorization", "content-type"]);
}

/// A path that could resolve outside its host's base is refused: on a shared
/// gateway origin it would reach another service, unfurl's link fetcher
/// among them.
#[test]
fn a_path_never_leaves_its_sdk_host() {
    let base = "https://gateway.example/dss";
    assert_eq!(
        confined(base, "documents/1").as_deref(),
        Some("https://gateway.example/dss/documents/1")
    );
    for rest in [
        "../unfurl/proxy",
        "documents/../../unfurl/proxy",
        "./documents",
        "%2e%2e/unfurl/proxy",
        "%2E%2E/unfurl/proxy",
        ".%2e/unfurl/proxy",
        "documents%2f..%2f..%2funfurl",
        "..\\unfurl/proxy",
        "documents%5c..%5cunfurl",
    ] {
        assert_eq!(confined(base, rest), None, "{rest}");
    }
}

/// A proxied run whose forwarder can't start fails with its own code, so it
/// is never mistaken for a runner fault or retried as a direct run.
#[test]
fn a_forwarder_that_cannot_start_fails_the_run() {
    let failure = crate::outbound::deno::forwarder_unavailable();
    assert_eq!(failure.code, crate::domain::FailureCode::Egress);
}
