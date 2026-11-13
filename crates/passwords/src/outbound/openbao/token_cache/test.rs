use super::*;
use std::sync::atomic::AtomicUsize;

// Sessions only come from a login response; a local stub server issues them.
async fn issue(lease_seconds: u64) -> Session {
    use axum::{Router, routing::post};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener");
    let address = listener.local_addr().expect("address");
    let app = Router::new().route(
        "/v1/auth/macro/login",
        post(move || async move {
            axum::Json(serde_json::json!({"auth":{"client_token":"synthetic-cached-token","lease_duration":lease_seconds}}))
        }),
    );
    let server = tokio::spawn(async move { axum::serve(listener, app).await.expect("server") });
    let session = openbao_client::OpenBaoClient::new(&format!("http://{address}"))
        .expect("client")
        .login_team(
            "team-fixture",
            "passwords-service",
            &openbao_client::SecretString::new("synthetic-jwt".into()),
            None,
        )
        .await
        .expect("login");
    server.abort();
    session
}

fn team() -> TeamId {
    TeamId(uuid::Uuid::now_v7())
}

async fn counted_login(
    logins: &AtomicUsize,
    session: &Session,
) -> Result<Session, crate::domain::models::Error> {
    logins.fetch_add(1, Ordering::SeqCst);
    Ok(session.clone())
}

#[tokio::test]
async fn reuses_a_live_token_and_logs_in_on_miss() {
    let session = issue(60).await;
    let cache = TokenCache::new(CAPACITY);
    let logins = AtomicUsize::new(0);
    let team = team();
    let first = cache
        .session(team, || counted_login(&logins, &session))
        .await
        .expect("miss");
    let second = cache
        .session(team, || counted_login(&logins, &session))
        .await
        .expect("hit");
    assert!(!first.cache_hit);
    assert!(second.cache_hit);
    assert_eq!(logins.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn refreshes_before_the_lease_ends() {
    let session = issue(60).await;
    tokio::time::pause();
    let cache = TokenCache::new(CAPACITY);
    let logins = AtomicUsize::new(0);
    let team = team();
    cache
        .session(team, || counted_login(&logins, &session))
        .await
        .expect("miss");
    tokio::time::advance(Duration::from_secs(39)).await;
    assert!(
        cache
            .session(team, || counted_login(&logins, &session))
            .await
            .expect("still live")
            .cache_hit
    );
    tokio::time::advance(Duration::from_secs(1)).await;
    assert!(
        !cache
            .session(team, || counted_login(&logins, &session))
            .await
            .expect("inside the refresh margin")
            .cache_hit
    );
    assert_eq!(logins.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn never_caches_a_lease_within_the_margin() {
    for lease in [0, 20] {
        let session = issue(lease).await;
        let cache = TokenCache::new(CAPACITY);
        let logins = AtomicUsize::new(0);
        let team = team();
        for _ in 0..3 {
            assert!(
                !cache
                    .session(team, || counted_login(&logins, &session))
                    .await
                    .expect("login")
                    .cache_hit
            );
        }
        assert_eq!(logins.load(Ordering::SeqCst), 3, "lease {lease}");
    }
}

#[tokio::test]
async fn a_huge_lease_is_clamped_to_the_service_token_ttl() {
    let session = issue(u64::MAX).await;
    tokio::time::pause();
    let cache = TokenCache::new(CAPACITY);
    let logins = AtomicUsize::new(0);
    let team = team();
    cache
        .session(team, || counted_login(&logins, &session))
        .await
        .expect("no overflow");
    tokio::time::advance(Duration::from_secs(39)).await;
    assert!(
        cache
            .session(team, || counted_login(&logins, &session))
            .await
            .expect("live")
            .cache_hit
    );
    tokio::time::advance(Duration::from_secs(1)).await;
    assert!(
        !cache
            .session(team, || counted_login(&logins, &session))
            .await
            .expect("refreshed at the 60-second bound")
            .cache_hit
    );
}

#[tokio::test]
async fn teams_never_share_a_token() {
    let session = issue(60).await;
    let cache = TokenCache::new(CAPACITY);
    let logins = AtomicUsize::new(0);
    let (first, second) = (team(), team());
    cache
        .session(first, || counted_login(&logins, &session))
        .await
        .expect("first team");
    assert!(
        !cache
            .session(second, || counted_login(&logins, &session))
            .await
            .expect("second team")
            .cache_hit
    );
    assert_eq!(logins.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn replacement_logs_in_once_for_a_rejected_token() {
    let session = issue(60).await;
    let cache = TokenCache::new(CAPACITY);
    let logins = AtomicUsize::new(0);
    let team = team();
    let rejected = cache
        .session(team, || counted_login(&logins, &session))
        .await
        .expect("miss");
    let replacement = cache
        .replace(team, &rejected, || counted_login(&logins, &session))
        .await
        .expect("relogin");
    assert!(!replacement.cache_hit);
    // A second caller rejected on the same old token reuses the replacement.
    assert!(
        cache
            .replace(team, &rejected, || counted_login(&logins, &session))
            .await
            .expect("replacement shared")
            .cache_hit
    );
    assert!(
        cache
            .session(team, || counted_login(&logins, &session))
            .await
            .expect("replacement kept")
            .cache_hit
    );
    assert_eq!(logins.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_cancelled_login_leaves_the_next_caller_to_log_in() {
    let session = issue(60).await;
    let cache = TokenCache::new(CAPACITY);
    let logins = AtomicUsize::new(0);
    let team = team();
    {
        let abandoned = cache.session(team, || async {
            logins.fetch_add(1, Ordering::SeqCst);
            std::future::pending::<Result<Session, crate::domain::models::Error>>().await
        });
        tokio::pin!(abandoned);
        assert!(futures::poll!(&mut abandoned).is_pending());
    }
    let lease = cache
        .session(team, || counted_login(&logins, &session))
        .await
        .expect("waiter logs in after cancellation");
    assert!(!lease.cache_hit);
    assert_eq!(logins.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn eviction_never_drops_a_slot_with_a_login_in_flight() {
    let session = issue(60).await;
    let cache = TokenCache::new(NonZeroUsize::new(1).expect("capacity"));
    let logins = AtomicUsize::new(0);
    let (busy, other) = (team(), team());
    let (release, released) = tokio::sync::oneshot::channel::<()>();
    let in_flight = cache.session(busy, || async {
        logins.fetch_add(1, Ordering::SeqCst);
        released.await.expect("release");
        Ok(session.clone())
    });
    tokio::pin!(in_flight);
    assert!(futures::poll!(&mut in_flight).is_pending());
    cache
        .session(other, || counted_login(&logins, &session))
        .await
        .expect("other team");
    release.send(()).expect("release");
    in_flight.await.expect("busy team login");
    assert!(
        cache
            .session(busy, || counted_login(&logins, &session))
            .await
            .expect("busy team kept its single-flight slot")
            .cache_hit
    );
    assert_eq!(logins.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn concurrent_callers_share_one_login() {
    let session = issue(60).await;
    let cache = TokenCache::new(CAPACITY);
    let logins = AtomicUsize::new(0);
    let team = team();
    let (release, released) = tokio::sync::oneshot::channel::<()>();
    let released = tokio::sync::Mutex::new(Some(released));
    let callers = (0..8).map(|_| {
        cache.session(team, || async {
            logins.fetch_add(1, Ordering::SeqCst);
            // Hold the first login open until every caller is queued behind it.
            if let Some(released) = released.lock().await.take() {
                released.await.expect("release");
            }
            Ok::<_, crate::domain::models::Error>(session.clone())
        })
    });
    let all = futures::future::join_all(callers);
    tokio::pin!(all);
    assert!(futures::poll!(&mut all).is_pending());
    release.send(()).expect("release");
    let leases = all.await;
    assert_eq!(logins.load(Ordering::SeqCst), 1);
    assert_eq!(
        leases
            .iter()
            .filter(|lease| lease.as_ref().expect("lease").cache_hit)
            .count(),
        7
    );
}

#[tokio::test]
async fn capacity_bounds_the_teams_kept() {
    let session = issue(60).await;
    let cache = TokenCache::new(NonZeroUsize::new(2).expect("capacity"));
    let logins = AtomicUsize::new(0);
    let (first, second, third) = (team(), team(), team());
    for team in [first, second, third] {
        cache
            .session(team, || counted_login(&logins, &session))
            .await
            .expect("login");
    }
    assert_eq!(
        cache
            .slots
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .len(),
        2
    );
    assert!(
        !cache
            .session(first, || counted_login(&logins, &session))
            .await
            .expect("evicted team logs in again")
            .cache_hit
    );
}

#[tokio::test]
async fn lease_debug_redacts_the_token() {
    let session = issue(60).await;
    let cache = TokenCache::new(CAPACITY);
    let logins = AtomicUsize::new(0);
    let lease = cache
        .session(team(), || counted_login(&logins, &session))
        .await
        .expect("login");
    assert!(!format!("{lease:?}").contains("synthetic-cached-token"));
}

#[tokio::test]
async fn callers_waiting_on_a_failed_login_share_its_failure() {
    let session = issue(60).await;
    let cache = TokenCache::new(CAPACITY);
    let logins = AtomicUsize::new(0);
    let team = team();
    let (release, released) = tokio::sync::oneshot::channel::<()>();
    let released = tokio::sync::Mutex::new(Some(released));
    let callers = (0..8).map(|_| {
        cache.session(team, || async {
            logins.fetch_add(1, Ordering::SeqCst);
            if let Some(released) = released.lock().await.take() {
                released.await.expect("release");
            }
            Err(crate::domain::models::Error::Unavailable)
        })
    });
    let all = futures::future::join_all(callers);
    tokio::pin!(all);
    assert!(futures::poll!(&mut all).is_pending());
    release.send(()).expect("release");
    assert!(all.await.iter().all(Result::is_err));
    assert_eq!(
        logins.load(Ordering::SeqCst),
        1,
        "an outage costs one login timeout, not one per waiting caller"
    );
    assert!(
        !cache
            .session(team, || counted_login(&logins, &session))
            .await
            .expect("a later caller tries again")
            .cache_hit
    );
}
