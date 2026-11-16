use super::*;
use axum::{Router, body::Body, http::StatusCode, middleware, routing::get};
use std::sync::atomic::{AtomicUsize, Ordering};
use tower::ServiceExt;

#[tokio::test]
async fn unrelated_requests_without_opt_in_make_no_crm_lookups() {
    let lookups = Arc::new(AtomicUsize::new(0));
    let observed = lookups.clone();
    let app = Router::new()
        .route("/document", get(|| async { StatusCode::ACCEPTED }))
        .layer(middleware::from_fn(move |request, next| {
            let lookups = observed.clone();
            async move {
                respond(request, next, async move {
                    lookups.fetch_add(1, Ordering::SeqCst);
                    Some(Signal {
                        expires_at: Instant::now() + TTL,
                        value: Some(HeaderValue::from_static("none")),
                    })
                })
                .await
            }
        }));
    for opt_in in [None, Some("0"), Some("true"), Some("1")] {
        let mut request = Request::builder().uri("/document");
        if let Some(value) = opt_in {
            request = request.header(REQUEST_HEADER, value);
        }
        let response = app
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        assert_eq!(response.headers().contains_key(HEADER), opt_in == Some("1"));
        assert_eq!(
            lookups.load(Ordering::SeqCst),
            usize::from(opt_in == Some("1"))
        );
    }
}

#[tokio::test]
async fn handler_runs_while_signal_is_pending_and_keeps_its_denial() {
    let handler_ran = Arc::new(tokio::sync::Notify::new());
    let notified = handler_ran.clone();
    let app = Router::new()
        .route(
            "/crm",
            get(move || async move {
                handler_ran.notify_one();
                StatusCode::FORBIDDEN
            }),
        )
        .layer(middleware::from_fn(move |request, next| {
            let notified = notified.clone();
            async move {
                respond(request, next, async move {
                    notified.notified().await;
                    Some(Signal {
                        expires_at: Instant::now() + TTL,
                        value: Some(HeaderValue::from_static("none")),
                    })
                })
                .await
            }
        }));
    let response = app
        .oneshot(
            Request::builder()
                .uri("/crm")
                .header(REQUEST_HEADER, "1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(response.headers()[HEADER], "none");
}

#[tokio::test(start_paused = true)]
async fn memoized_signal_expires_without_sliding_on_cache_hits() {
    let cache = SignalCache::default();
    let allowed = cache
        .get("member", async { Ok(HeaderValue::from_static("allowed")) })
        .await;
    assert_eq!(allowed.value.unwrap(), "allowed");
    tokio::time::advance(Duration::from_secs(2)).await;
    let cached = cache
        .get("member", async { panic!("cache hit must not read") })
        .await;
    assert_eq!(cached.value.unwrap(), "allowed");
    tokio::time::advance(Duration::from_secs(1)).await;
    let denied = cache
        .get("member", async { Ok(HeaderValue::from_static("denied")) })
        .await;
    assert_eq!(denied.value.unwrap(), "denied");
    tokio::time::advance(TTL).await;
    let restored = cache
        .get("member", async { Ok(HeaderValue::from_static("allowed")) })
        .await;
    assert_eq!(restored.value.unwrap(), "allowed");
}

#[tokio::test]
async fn concurrent_requests_share_one_lookup_without_blocking_other_users() {
    let cache = SignalCache::default();
    let lookup_started = tokio::sync::Notify::new();
    let other_user_read = tokio::sync::Notify::new();
    let first = cache.get("first", async {
        lookup_started.notify_one();
        other_user_read.notified().await;
        Ok(HeaderValue::from_static("allowed"))
    });
    let second = async {
        lookup_started.notified().await;
        let other = cache
            .get("other", async { Ok(HeaderValue::from_static("denied")) })
            .await;
        assert_eq!(other.value.unwrap(), "denied");
        other_user_read.notify_one();
        cache
            .get("first", async { panic!("in-flight lookup must be shared") })
            .await
    };
    let (first, second) = tokio::join!(first, second);
    assert_eq!(first.value, second.value);
    assert_eq!(first.value.unwrap(), "allowed");
}

#[tokio::test(start_paused = true)]
async fn timed_out_lookup_is_bounded_and_memoized() {
    let cache = SignalCache::default();
    let start = Instant::now();
    let signal = cache.get("member", std::future::pending()).await;
    assert!(signal.value.is_none());
    assert_eq!(Instant::now() - start, QUERY_TIMEOUT);
    let cached = cache
        .get("member", async { panic!("failed lookup must be memoized") })
        .await;
    assert!(cached.value.is_none());
}

#[tokio::test(start_paused = true)]
async fn unavailable_signal_does_not_fail_or_indefinitely_delay_a_handler() {
    let app = Router::new()
        .route("/document", get(|| async { StatusCode::ACCEPTED }))
        .layer(middleware::from_fn(|request, next| async move {
            respond(request, next, std::future::pending()).await
        }));
    let start = Instant::now();
    let response = app
        .oneshot(
            Request::builder()
                .uri("/document")
                .header(REQUEST_HEADER, "1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert!(!response.headers().contains_key(HEADER));
    assert_eq!(Instant::now() - start, LOOKUP_TIMEOUT);
}

#[tokio::test(start_paused = true)]
async fn slow_handler_cannot_publish_a_signal_that_expired_while_it_ran() {
    let app = Router::new()
        .route(
            "/document",
            get(|| async {
                tokio::time::advance(TTL).await;
                StatusCode::ACCEPTED
            }),
        )
        .layer(middleware::from_fn(|request, next| async move {
            let expires_at = Instant::now() + TTL;
            respond(request, next, async move {
                Some(Signal {
                    expires_at,
                    value: Some(HeaderValue::from_static("allowed")),
                })
            })
            .await
        }));
    let response = app
        .oneshot(
            Request::builder()
                .uri("/document")
                .header(REQUEST_HEADER, "1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert!(!response.headers().contains_key(HEADER));
}

#[tokio::test]
async fn cancelled_lookup_does_not_trigger_a_retry_storm() {
    let cache = SignalCache::default();
    let task_cache = cache.clone();
    let started = Arc::new(tokio::sync::Notify::new());
    let task_started = started.clone();
    let task = tokio::spawn(async move {
        task_cache
            .get("member", async {
                task_started.notify_one();
                std::future::pending().await
            })
            .await
    });
    started.notified().await;
    task.abort();
    assert!(matches!(task.await, Err(error) if error.is_cancelled()));
    let cached = cache
        .get("member", async {
            panic!("cancelled lookup must be memoized")
        })
        .await;
    assert!(cached.value.is_none());
}

#[tokio::test]
async fn full_cache_does_not_evict_an_in_flight_lookup() {
    let cache = SignalCache(Arc::new(Mutex::new(LruCache::new(
        NonZeroUsize::new(1).unwrap(),
    ))));
    let started = tokio::sync::Notify::new();
    let release = tokio::sync::Notify::new();
    let first = cache.get("first", async {
        started.notify_one();
        release.notified().await;
        Ok(HeaderValue::from_static("allowed"))
    });
    let second = async {
        started.notified().await;
        let omitted = cache
            .get("other", async {
                panic!("full busy cache must omit the hint")
            })
            .await;
        assert!(omitted.value.is_none());
        release.notify_one();
        cache
            .get("first", async {
                panic!("active entry must not have been evicted")
            })
            .await
    };
    let (first, second) = tokio::join!(first, second);
    assert_eq!(first.value, second.value);
    assert_eq!(first.value.unwrap(), "allowed");
    // A completed entry may be evicted; capacity never grows.
    let other = cache
        .get("other", async { Ok(HeaderValue::from_static("denied")) })
        .await;
    assert_eq!(other.value.unwrap(), "denied");
    assert_eq!(cache.0.lock().await.len(), 1);
}
