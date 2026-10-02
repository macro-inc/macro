use super::*;
use crate::testing::*;
use entity_access::domain::models::AccessLevel;

#[tokio::test]
async fn ssh_credentials_have_a_safe_username_prefix_without_losing_entropy() {
    let (service, _, _) = fixture(2222);
    let share = service.share(identity(), 3000).await.unwrap();
    let payload = share.token.strip_prefix("preview_").unwrap();
    assert_eq!(URL_SAFE_NO_PAD.decode(payload).unwrap().len(), 32);
    // The prefix is part of the credential, not merely a client-side decoration.
    assert!(service.authenticate_ssh(payload).is_err());
    assert!(service.authenticate_ssh(&share.token).is_ok());
}

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
            .redeem(&PreviewId::generate(), &launch.ticket)
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
            .viewer(&PreviewId::generate(), &cookie, true)
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
    for _ in 0..5 {
        let mut identity = identity();
        identity.session = AgentSessionId::new();
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
        // Nested either way: the app under the preview domain, and the preview
        // domain under the app.
        "test",
        "preview.macro.test",
    ] {
        settings.domain = domain.into();
        assert!(settings.validate().is_err());
    }
}

#[tokio::test]
async fn stopping_a_preview_does_not_bypass_the_creation_interval() {
    let (service, _, _) = fixture(2222);
    service.share(identity(), 3000).await.unwrap();
    assert!(matches!(
        service.share(identity(), 3000).await,
        Err(PreviewError::Limited)
    ));
    // Stopping releases the session slot but not the owner's pacing: otherwise
    // a stop/share loop is an unbounded lease mint.
    service.stop(receipt(AccessLevel::Edit)).await.unwrap();
    assert!(matches!(
        service.share(identity(), 3000).await,
        Err(PreviewError::Limited)
    ));
    service
        .registry
        .lock()
        .unwrap()
        .accounts
        .values_mut()
        .for_each(|a| a.last_created = Instant::now() - TOKEN_TTL);
    service.share(identity(), 3000).await.unwrap();
}
#[test]
fn local_stack_accepts_https_handoff_and_loopback_http_with_docker_ssh_fallback() {
    let (service, _, _) = fixture(2222);
    let mut settings = service.settings().clone();
    settings.domain = "preview.localhost".into();
    settings.local_ssh_fallback = true;
    for origin in [
        "http://localhost:3000",
        "https://localhost:8090",
        "https://coworker-dev:23109",
        "https://coworker-dev.local:23109",
    ] {
        settings.app_origin = origin.into();
        assert!(settings.validate().is_ok(), "{origin}");
    }
    for origin in [
        "http://coworker-dev:3000",
        "https://Coworker-Dev:23109",
        "https://preview.localhost:8090",
        "https://app.preview.localhost:8090",
    ] {
        settings.app_origin = origin.into();
        assert!(settings.validate().is_err(), "{origin}");
    }
    settings.app_origin = "https://coworker-dev:23109".into();
    settings.domain = "preview.example.test".into();
    assert!(settings.validate().is_err());
}
