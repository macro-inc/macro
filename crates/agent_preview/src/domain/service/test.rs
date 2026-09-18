use super::*;
use crate::testing::*;
use entity_access::domain::models::AccessLevel;

#[tokio::test]
async fn ssh_credentials_are_single_use_and_forward_is_scoped() {
    let (service, _, _) = fixture(2222);
    let share = service.share(identity(), 3000).await.unwrap();
    assert!(service.authenticate_ssh("wrong").is_err());
    let lease = service.authenticate_ssh(&share.token).unwrap();
    assert!(service.authenticate_ssh(&share.token).is_err());
    let tunnel = Arc::new(TcpTunnel("127.0.0.1:1".parse().unwrap()));
    assert!(
        service
            .register(&lease, "0.0.0.0", 1, tunnel.clone())
            .is_err()
    );
    assert!(
        service
            .register(&lease, "127.0.0.1", 3000, tunnel.clone())
            .is_err()
    );
    service
        .register(&lease, "127.0.0.1", 1, tunnel.clone())
        .unwrap();
    assert!(service.register(&lease, "127.0.0.1", 1, tunnel).is_err());
    assert!(service.launch(receipt(AccessLevel::View)).is_err());
    service.ready(&lease).await;
    assert_eq!(
        service
            .get(receipt(AccessLevel::View))
            .unwrap()
            .unwrap()
            .status,
        PreviewStatus::Ready
    );
}
#[tokio::test]
async fn browser_tickets_are_host_bound_single_use_and_permissions_rechecked() {
    let (service, authority, _) = fixture(2222);
    let share = service.share(identity(), 3000).await.unwrap();
    let lease = service.authenticate_ssh(&share.token).unwrap();
    service.ready(&lease).await;
    let launch = service.launch(receipt(AccessLevel::View)).unwrap();
    assert!(
        service
            .redeem("different-preview", &launch.ticket)
            .await
            .is_err()
    );
    let cookie = service
        .redeem(&share.preview.id, &launch.ticket)
        .await
        .unwrap();
    assert!(
        service
            .redeem(&share.preview.id, &launch.ticket)
            .await
            .is_err()
    );
    assert!(
        service
            .viewer("different-preview", &cookie, true)
            .await
            .is_err()
    );
    assert!(
        service
            .viewer(&share.preview.id, &cookie, true)
            .await
            .is_ok()
    );
    authority
        .0
        .store(false, std::sync::atomic::Ordering::SeqCst);
    assert!(
        service
            .viewer(&share.preview.id, &cookie, true)
            .await
            .is_err()
    );
    service.sweep().await;
    assert!(lease.cancel.is_cancelled());
}
#[tokio::test]
async fn expiry_stop_and_token_timeout_close_access() {
    let (service, _, _) = fixture(2222);
    let share = service.share(identity(), 3000).await.unwrap();
    service
        .registry
        .lock()
        .unwrap()
        .ssh_tokens
        .get_mut(&digest(&share.token))
        .unwrap()
        .expires = Instant::now();
    assert!(service.authenticate_ssh(&share.token).is_err());
    let lease = service.by_id(&share.preview.id).unwrap();
    service.ready(&lease).await;
    let launch = service.launch(receipt(AccessLevel::View)).unwrap();
    service
        .registry
        .lock()
        .unwrap()
        .tickets
        .get_mut(&digest(&launch.ticket))
        .unwrap()
        .expires = Instant::now();
    assert!(
        service
            .redeem(&share.preview.id, &launch.ticket)
            .await
            .is_err()
    );
    service.stop(receipt(AccessLevel::Edit)).await.unwrap();
    assert!(lease.cancel.is_cancelled());
    assert!(service.launch(receipt(AccessLevel::View)).is_err());
}
#[tokio::test]
async fn quotas_bound_sessions_and_request_loops() {
    let (service, _, _) = fixture(2222);
    assert!(service.share(identity(), 0).await.is_err());
    for number in 0..5 {
        let mut identity = identity();
        identity.session = format!("session-{number}");
        service
            .registry
            .lock()
            .unwrap()
            .accounts
            .values_mut()
            .for_each(|a| a.last_created = Instant::now() - TOKEN_TTL);
        service.share(identity, 3000).await.unwrap();
    }
    service
        .registry
        .lock()
        .unwrap()
        .accounts
        .values_mut()
        .for_each(|a| a.last_created = Instant::now() - TOKEN_TTL);
    assert!(matches!(
        service.share(identity(), 3000).await,
        Err(PreviewError::Limited)
    ));
    let budget = Budget::default();
    for _ in 0..100 {
        budget.request().unwrap();
    }
    assert!(budget.request().is_err());
    assert!(budget.bytes(1024 * 1024 * 1024 + 1).is_err());
}
#[test]
fn isolated_domains_and_shell_fields_are_validated() {
    let (service, _, _) = fixture(2222);
    let mut settings = service.settings().clone();
    for domain in [
        "macro.com",
        "preview.macro.com",
        "bad;hostname",
        "UPPERCASE.test",
        "macro.test",
    ] {
        settings.domain = domain.into();
        assert!(settings.validate().is_err());
    }
}

#[tokio::test]
async fn replacing_or_stopping_a_preview_does_not_reset_account_budget() {
    let (service, _, _) = fixture(2222);
    let first = service.share(identity(), 3000).await.unwrap();
    let lease = service.authenticate_ssh(&first.token).unwrap();
    assert!(lease.budget.bytes(1024 * 1024 * 1024).is_ok());
    assert!(matches!(
        service.share(identity(), 3000).await,
        Err(PreviewError::Limited)
    ));
    service.stop(receipt(AccessLevel::Edit)).await.unwrap();
    service
        .registry
        .lock()
        .unwrap()
        .accounts
        .values_mut()
        .for_each(|a| a.last_created = Instant::now() - TOKEN_TTL);
    let second = service.share(identity(), 3000).await.unwrap();
    let next = service.authenticate_ssh(&second.token).unwrap();
    assert!(Arc::ptr_eq(&lease.budget, &next.budget));
    assert!(next.budget.bytes(1).is_err());
}
#[test]
fn only_local_stack_accepts_loopback_http_handoff_and_docker_ssh_fallback() {
    let (service, _, _) = fixture(2222);
    let mut settings = service.settings().clone();
    settings.domain = "preview.localhost".into();
    settings.app_origin = "http://localhost:3000".into();
    settings.local_ssh_fallback = true;
    assert!(settings.validate().is_ok());
    settings.app_origin = "http://macro.test".into();
    assert!(settings.validate().is_err());
    settings.app_origin = "https://macro.test".into();
    assert!(settings.validate().is_err());
}
