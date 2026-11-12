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

#[derive(Clone)]
struct BlockingProvider {
    entered: Arc<tokio::sync::Semaphore>,
    release: Arc<tokio::sync::Semaphore>,
    calls: Arc<AtomicUsize>,
}
impl LogoProvider for BlockingProvider {
    type Error = std::io::Error;
    async fn fetch(&self, _: &LogoDomain) -> Result<Logo, Self::Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.entered.add_permits(1);
        self.release.acquire().await.unwrap().forget();
        Ok(Logo {
            bytes: Bytes::from_static(b"logo"),
            content_type: "image/png".into(),
        })
    }
}

#[tokio::test]
async fn cache_misses_share_bounded_admission_across_clones_while_cached_reads_remain_available() {
    let provider = BlockingProvider {
        entered: Arc::new(tokio::sync::Semaphore::new(0)),
        release: Arc::new(tokio::sync::Semaphore::new(1)),
        calls: Arc::new(AtomicUsize::new(0)),
    };
    let service = LogoService::new(provider.clone());
    let cached = LogoDomain::parse("cached.example.com").unwrap();
    service.get(cached.clone()).await.unwrap();
    provider.entered.acquire().await.unwrap().forget();
    let mut workers = Vec::new();
    for index in 0..8 {
        let service = service.clone();
        workers.push(tokio::spawn(async move {
            service
                .get(LogoDomain::parse(&format!("logo-{index}.example.com")).unwrap())
                .await
        }));
    }
    provider.entered.acquire_many(8).await.unwrap().forget();
    tokio::select! {
        result = service.get(LogoDomain::parse("overflow.example.com").unwrap()) => assert!(matches!(result, Err(LogoError::Busy))),
        _ = provider.entered.acquire() => panic!("overflow request reached the provider"),
    }
    assert_eq!(provider.calls.load(Ordering::SeqCst), 9);
    assert_eq!(service.get(cached).await.unwrap().bytes, b"logo"[..]);
    provider.release.add_permits(8);
    for worker in workers {
        worker.await.unwrap().unwrap();
    }
    provider.release.add_permits(1);
    service
        .get(LogoDomain::parse("recovered.example.com").unwrap())
        .await
        .unwrap();
}
