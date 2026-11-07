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
