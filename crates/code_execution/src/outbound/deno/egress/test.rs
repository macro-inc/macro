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

/// A request carries a Macro credential in its `authorization` or
/// `x-macro-user-api-key` header, its `macro-access-token` cookie (among
/// others) or its `macro-api-token` query parameter, and in nothing else.
#[test]
fn a_credential_is_found_wherever_a_request_carries_one() {
    let plain = url::Url::parse("http://host/path?q=1").unwrap();
    assert!(!credentialed(&HeaderMap::new(), &plain));

    let mut headers = HeaderMap::new();
    headers.append("authorization", HeaderValue::from_static("Bearer token"));
    assert!(credentialed(&headers, &plain));

    let mut headers = HeaderMap::new();
    headers.append("x-macro-user-api-key", HeaderValue::from_static("key"));
    assert!(credentialed(&headers, &plain));

    let mut headers = HeaderMap::new();
    headers.append(
        "cookie",
        HeaderValue::from_static("theme=dark; macro-access-token=abc; other=1"),
    );
    assert!(credentialed(&headers, &plain));

    let query = url::Url::parse("http://host/path?macro-api-token=abc").unwrap();
    assert!(credentialed(&HeaderMap::new(), &query));

    // Names that only look alike are no credential.
    let mut headers = HeaderMap::new();
    headers.append(
        "cookie",
        HeaderValue::from_static("x-macro-access-token=abc; macro-access-token-old=1"),
    );
    let lookalike = url::Url::parse("http://host/path?macro-api-token-old=abc").unwrap();
    assert!(!credentialed(&headers, &lookalike));
}
