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

/// A dry run's forwarder sends a catalog read's method and path, under its
/// own service, and nothing else that isn't GET or HEAD.
#[test]
fn a_dry_run_forwards_only_reads() {
    let reads = DryRunReads::new([
        ("cognition.postDecisions", "POST", "/decisions", false),
        ("email.getThread", "POST", "/threads/{id}/read", false),
        ("email.archive", "POST", "/threads/{id}/archive", true),
    ]);
    assert!(reads.allows("cognition", "POST", "/decisions"));
    assert!(reads.allows("email", "POST", "/threads/t1/read"));
    assert!(reads.allows("email", "GET", "/threads/t1/archive"));
    assert!(reads.allows("email", "HEAD", "/anything"));
    for (service, method, path) in [
        ("cognition", "DELETE", "/decisions"),
        ("email", "POST", "/decisions"),
        ("cognition", "POST", "/decisions/extra"),
        ("cognition", "POST", "/%64ecisions"),
        ("cognition", "POST", "/./decisions"),
        ("email", "POST", "/threads/t1/archive"),
        ("email", "POST", "/threads//read"),
        ("cognition", "post", "/decisions"),
        ("email", "POST", "/threads/../read"),
        ("email", "POST", "/threads/%2e%2e/read"),
        ("email", "POST", "/threads/%2E./read"),
        ("email", "POST", "/threads/./read"),
        ("email", "POST", "/threads/a%2fb/read"),
        ("email", "POST", "/threads/a%5Cb/read"),
    ] {
        assert!(
            !reads.allows(service, method, path),
            "{method} {service}{path}"
        );
    }
}

/// A dry run's forwarder refuses a write before it reaches the host, and
/// forwards a read.
#[tokio::test]
async fn a_dry_run_forwarder_refuses_writes() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let host = format!("http://{}", upstream.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = upstream.accept().await.unwrap();
        let mut buffer = vec![0; 4096];
        let count = stream.read(&mut buffer).await.unwrap();
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
            .await
            .unwrap();
        String::from_utf8_lossy(&buffer[..count]).into_owned()
    });
    let egress = RunEgress::start(
        reqwest::Client::new(),
        &BTreeMap::from([("cognition".to_owned(), host)]),
        &BTreeMap::new(),
        Some(DryRunReads::new([(
            "cognition.postDecisions",
            "POST",
            "/decisions",
            false,
        )])),
    )
    .await
    .unwrap();
    let base = egress.hosts["cognition"].clone();
    let client = reqwest::Client::new();
    let refused = client
        .delete(format!("{base}/decisions"))
        .send()
        .await
        .unwrap();
    assert_eq!(refused.status(), StatusCode::FORBIDDEN);
    let read = client
        .post(format!("{base}/decisions"))
        .body("{}")
        .send()
        .await
        .unwrap();
    assert_eq!(read.status(), StatusCode::OK);
    let forwarded = server.await.unwrap();
    assert!(forwarded.starts_with("POST /decisions "), "{forwarded}");
    egress.stop().await;
}
