use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Clone)]
struct FakeProvider(Arc<AtomicUsize>);

impl LogoProvider for FakeProvider {
    type Error = std::io::Error;

    async fn fetch(&self, _: &LogoDomain) -> Result<Logo, Self::Error> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(Logo {
            bytes: Bytes::from_static(b"logo"),
            content_type: "image/png".into(),
        })
    }
}

#[test]
fn rejects_url_injection_and_ip_literals() {
    for domain in [
        "localhost",
        "127.0.0.1",
        "[::1]",
        "example.com:8080",
        "user@example.com",
        "example.com/path",
        "example.com?query",
        "example.com#fragment",
        "-example.com",
        "example..com",
    ] {
        assert!(LogoDomain::parse(domain).is_none(), "{domain}");
    }
    assert_eq!(
        LogoDomain::parse("EXAMPLE.COM").unwrap().as_str(),
        "example.com"
    );
}

#[tokio::test]
async fn repeated_domain_reads_share_cached_bytes() {
    let calls = Arc::new(AtomicUsize::new(0));
    let service = LogoService::new(FakeProvider(calls.clone()));
    let domain = LogoDomain::parse("example.com").unwrap();
    assert_eq!(
        service.get(domain.clone()).await.unwrap().bytes,
        b"logo"[..]
    );
    assert_eq!(service.get(domain).await.unwrap().bytes, b"logo"[..]);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}
