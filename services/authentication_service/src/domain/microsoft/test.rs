use super::*;
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
use token::MockMicrosoftTokenCipher;

type Service = MicrosoftAuthService<
    MockMicrosoftGrantRepository,
    MockMicrosoftIdentityProvider,
    FakeFeatureFlags,
>;

fn attempt() -> LinkAttempt {
    LinkAttempt {
        id: macro_uuid::generate_uuid_v7(),
        owner: macro_uuid::generate_uuid_v7(),
        identity_provider_id: "microsoft".into(),
        redirect_uri: "https://auth.example.com/callback".into(),
        return_uri: Some("https://app.example.com".into()),
        verifier: Zeroizing::new("verifier".into()),
        nonce: "nonce".into(),
        calendar_requested: false,
        expires_at: Utc::now() + Duration::minutes(10),
    }
}

fn envelope() -> EncryptedMicrosoftToken {
    EncryptedMicrosoftToken {
        refresh_token_ciphertext: vec![1; 32],
        encrypted_data_key: vec![2; 32],
        nonce: vec![3; 12],
        encryption_version: 1,
        kms_key_id: "key".into(),
    }
}

fn scopes() -> Vec<String> {
    [
        "User.Read",
        "Mail.ReadWrite",
        "Mail.Send",
        "MailboxSettings.ReadWrite",
        "Contacts.ReadWrite",
        "Calendars.ReadWrite",
    ]
    .map(str::to_owned)
    .to_vec()
}

#[tokio::test]
async fn mismatched_provider_is_rejected_before_code_exchange() {
    let pending = attempt();
    let id = pending.id;
    let mut repo = MockMicrosoftGrantRepository::new();
    repo.expect_claim_link()
        .once()
        .return_once(move |_| Ok(pending));
    repo.expect_abandon_link().once().returning(|_| Ok(()));
    let service = Service::new(
        repo,
        MockMicrosoftIdentityProvider::new(),
        Arc::new(MockMicrosoftTokenCipher::new()),
    );
    assert_eq!(
        service.complete_link(id, "google", "code").await,
        Err(MicrosoftAuthError::InvalidAttempt)
    );
}

#[tokio::test]
async fn verified_mailbox_never_changes_the_initiating_owner() {
    let pending = attempt();
    let id = pending.id;
    let owner = pending.owner;
    let mut repo = MockMicrosoftGrantRepository::new();
    repo.expect_claim_link()
        .once()
        .return_once(move |_| Ok(pending));
    repo.expect_complete_link()
        .once()
        .withf(move |attempt, identity, _, _| {
            attempt.owner == owner && identity.email == "other-mailbox@example.com"
        })
        .returning(|_, _, _, _| Ok(()));
    let mut provider = MockMicrosoftIdentityProvider::new();
    provider.expect_exchange().once().returning(|_, _| {
        Ok(VerifiedGrant {
            tenant_id: "tenant".into(),
            subject_id: "subject".into(),
            mailbox_id: "mailbox".into(),
            email: "other-mailbox@example.com".into(),
            scopes: scopes(),
            refresh_token: MicrosoftRefreshToken::new("refresh".into()),
        })
    });
    let mut cipher = MockMicrosoftTokenCipher::new();
    cipher
        .expect_encrypt()
        .once()
        .withf(move |actual, email, _| {
            actual == &owner.to_string() && email == "other-mailbox@example.com"
        })
        .returning(|_, _, _| Ok(envelope()));
    let service = Service::new(repo, provider, Arc::new(cipher));
    assert_eq!(
        service
            .complete_link(id, "microsoft", "code")
            .await
            .unwrap(),
        Some("https://app.example.com".into())
    );
}

#[tokio::test]
async fn partial_consent_is_not_persisted_as_full_parity_grant() {
    let pending = attempt();
    let id = pending.id;
    let mut repo = MockMicrosoftGrantRepository::new();
    repo.expect_claim_link()
        .once()
        .return_once(move |_| Ok(pending));
    repo.expect_abandon_link().once().returning(|_| Ok(()));
    let mut provider = MockMicrosoftIdentityProvider::new();
    provider.expect_exchange().once().returning(|_, _| {
        Ok(VerifiedGrant {
            tenant_id: "tenant".into(),
            subject_id: "subject".into(),
            mailbox_id: "mailbox".into(),
            email: "mailbox@example.com".into(),
            scopes: vec!["Mail.ReadWrite".into()],
            refresh_token: MicrosoftRefreshToken::new("refresh".into()),
        })
    });
    let service = Service::new(repo, provider, Arc::new(MockMicrosoftTokenCipher::new()));
    assert_eq!(
        service.complete_link(id, "microsoft", "code").await,
        Err(MicrosoftAuthError::MissingPermissions)
    );
}

#[tokio::test]
async fn lost_rotation_fence_never_returns_or_caches_the_access_token() {
    let mut repo = MockMicrosoftGrantRepository::new();
    repo.expect_active_grant().once().returning(|_, _, _| {
        Ok(StoredGrant {
            scopes: vec![
                "User.Read".into(),
                "Mail.ReadWrite".into(),
                "Mail.Send".into(),
            ],
            id: macro_uuid::generate_uuid_v7(),
            generation: 1,
            revision: 0,
            owner: "owner".into(),
            email: "mailbox@example.com".into(),
            envelope: envelope(),
        })
    });
    repo.expect_acquire_refresh()
        .once()
        .returning(|_, _| Ok(true));
    repo.expect_finish_refresh()
        .once()
        .returning(|_, _, _, _| Ok(false));
    repo.expect_release_refresh()
        .once()
        .withf(|_, _, revoke| !revoke)
        .returning(|_, _, _| Ok(()));
    let mut provider = MockMicrosoftIdentityProvider::new();
    provider.expect_refresh().once().returning(|_| {
        Ok(RefreshedGrant {
            access_token: Zeroizing::new("must-not-escape".into()),
            refresh_token: None,
            expires_in: 3600,
            scopes: scopes(),
        })
    });
    let mut cipher = MockMicrosoftTokenCipher::new();
    cipher
        .expect_decrypt()
        .once()
        .returning(|_, _, _| Ok(MicrosoftRefreshToken::new("refresh".into())));
    let service = Service::new(repo, provider, Arc::new(cipher));
    assert!(matches!(
        service
            .access_token(macro_uuid::generate_uuid_v7(), 1, 1, false)
            .await,
        Err(MicrosoftAuthError::Busy)
    ));
    assert!(service.cache.lock().unwrap().is_empty());
}

#[tokio::test]
async fn revoked_grants_are_checked_before_cache_hits() {
    let grant_id = macro_uuid::generate_uuid_v7();
    let mut repo = MockMicrosoftGrantRepository::new();
    repo.expect_active_grant()
        .once()
        .returning(|_, _, _| Err(MicrosoftAuthError::ReauthorizationRequired));
    let service = Service::new(
        repo,
        MockMicrosoftIdentityProvider::new(),
        Arc::new(MockMicrosoftTokenCipher::new()),
    );
    service.cache.lock().unwrap().insert(
        (grant_id, 1),
        CachedToken {
            scopes: scopes(),
            value: Zeroizing::new("revoked".into()),
            expires_at: Utc::now() + Duration::hours(1),
        },
    );
    assert!(matches!(
        service
            .access_token(macro_uuid::generate_uuid_v7(), 1, 1, false)
            .await,
        Err(MicrosoftAuthError::ReauthorizationRequired)
    ));
}

#[test]
fn optional_permissions_never_revoke_a_working_mail_grant() {
    let core = vec![
        "User.Read".into(),
        "Mail.ReadWrite".into(),
        "Mail.Send".into(),
    ];
    assert!(has_required_scopes(&core));
    assert!(!has_required_scopes(&core[..2]));
    assert!(has_required_scopes(
        &core
            .iter()
            .map(|scope| format!("https://graph.microsoft.com/{scope}"))
            .collect::<Vec<_>>()
    ));
}

#[test]
fn graph_scope_spellings_have_one_persisted_representation() {
    assert_eq!(
        normalize_scopes(vec![
            "https://graph.microsoft.com/calendars.readwrite".into(),
            "Calendars.ReadWrite".into(),
            "MAIL.SEND".into()
        ]),
        vec!["Calendars.ReadWrite", "Mail.Send"]
    );
}

#[tokio::test]
async fn free_account_at_mixed_provider_limit_cannot_start_a_new_connection() {
    let mut repo = MockMicrosoftGrantRepository::new();
    repo.expect_connection_facts().once().returning(|_, _| {
        Ok(email::domain::inbox_entitlement::InboxConnectionFacts {
            professional: false,
            accessible_inboxes: 2,
            reconnecting: false,
        })
    });
    let service = Service::new(
        repo,
        MockMicrosoftIdentityProvider::new(),
        Arc::new(MockMicrosoftTokenCipher::new()),
    );
    assert!(matches!(
        service
            .start_link(
                Uuid::now_v7(),
                &MacroUserIdStr::parse_from_str("macro|person@example.com").unwrap(),
                "https://macro.test/callback".into(),
                None,
                false,
                None
            )
            .await,
        Err(MicrosoftAuthError::PaymentRequired)
    ));
}

#[tokio::test]
async fn new_connections_need_the_switch_and_the_users_flag() {
    let user = MacroUserIdStr::try_from("macro|person@example.com".to_string()).unwrap();
    let cases = [
        // (switch, flags configured, the user's flag load, admitted)
        (
            true,
            true,
            Ok(FlagSnapshot::new([(
                OUTLOOK_FLAG.into(),
                FlagValue::Boolean(true),
            )])),
            true,
        ),
        (
            true,
            true,
            Ok(FlagSnapshot::new([(
                OUTLOOK_FLAG.into(),
                FlagValue::Boolean(false),
            )])),
            false,
        ),
        (true, true, Ok(FlagSnapshot::default()), false),
        (true, true, Err("PostHog unreachable".to_owned()), false),
        (true, false, Err("never loaded".to_owned()), true),
        (
            false,
            true,
            Ok(FlagSnapshot::new([(
                OUTLOOK_FLAG.into(),
                FlagValue::Boolean(true),
            )])),
            false,
        ),
        (false, false, Err("never loaded".to_owned()), false),
    ];
    for (switch, configured, load, admitted) in cases {
        let mut flags = FakeFeatureFlags::default();
        flags.set(user.clone(), load.clone());
        let service = Service::new(
            MockMicrosoftGrantRepository::new(),
            MockMicrosoftIdentityProvider::new(),
            Arc::new(MockMicrosoftTokenCipher::new()),
        )
        .with_connections_enabled(switch)
        .with_feature_flags(configured.then_some(flags));
        assert_eq!(
            service.new_connections_enabled(&user).await,
            admitted,
            "switch {switch}, configured {configured}, load {load:?}"
        );
    }
}

#[tokio::test]
async fn flagged_off_user_cannot_start_a_new_connection() {
    let user = MacroUserIdStr::try_from("macro|person@example.com".to_string()).unwrap();
    for load in [
        Ok(FlagSnapshot::new([(
            OUTLOOK_FLAG.into(),
            FlagValue::Boolean(false),
        )])),
        Err("PostHog unreachable".to_owned()),
    ] {
        let mut repo = MockMicrosoftGrantRepository::new();
        repo.expect_connection_facts().once().returning(|_, _| {
            Ok(email::domain::inbox_entitlement::InboxConnectionFacts {
                professional: true,
                accessible_inboxes: 0,
                reconnecting: false,
            })
        });
        let mut flags = FakeFeatureFlags::default();
        flags.set(user.clone(), load);
        // No begin_link expectation: a refused start records no attempt.
        let service = Service::new(
            repo,
            MockMicrosoftIdentityProvider::new(),
            Arc::new(MockMicrosoftTokenCipher::new()),
        )
        .with_feature_flags(Some(flags));
        assert!(matches!(
            service
                .start_link(
                    Uuid::now_v7(),
                    &user,
                    "https://macro.test/callback".into(),
                    None,
                    false,
                    None
                )
                .await,
            Err(MicrosoftAuthError::NotConfigured)
        ));
    }
}

#[tokio::test]
async fn flagged_on_user_starts_a_new_connection() {
    let user = MacroUserIdStr::try_from("macro|person@example.com".to_string()).unwrap();
    let mut repo = MockMicrosoftGrantRepository::new();
    repo.expect_connection_facts().once().returning(|_, _| {
        Ok(email::domain::inbox_entitlement::InboxConnectionFacts {
            professional: true,
            accessible_inboxes: 0,
            reconnecting: false,
        })
    });
    repo.expect_begin_link().once().returning(|_| Ok(()));
    let mut provider = MockMicrosoftIdentityProvider::new();
    provider
        .expect_identity_provider_id()
        .once()
        .returning(|| Ok("microsoft".into()));
    provider
        .expect_authorize()
        .once()
        .returning(|_| Ok("https://login.example.com/authorize".into()));
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        user.clone(),
        Ok(FlagSnapshot::new([(
            OUTLOOK_FLAG.into(),
            FlagValue::Boolean(true),
        )])),
    );
    let service = Service::new(repo, provider, Arc::new(MockMicrosoftTokenCipher::new()))
        .with_feature_flags(Some(flags));
    let started = service
        .start_link(
            Uuid::now_v7(),
            &user,
            "https://macro.test/callback".into(),
            None,
            false,
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        started.authorization_url,
        "https://login.example.com/authorize"
    );
}

#[tokio::test]
async fn reconnecting_an_inbox_never_depends_on_the_flag_or_the_switch() {
    let user = MacroUserIdStr::try_from("macro|person@example.com".to_string()).unwrap();
    let reconnect = Uuid::now_v7();
    for load in [
        Ok(FlagSnapshot::new([(
            OUTLOOK_FLAG.into(),
            FlagValue::Boolean(false),
        )])),
        Err("PostHog unreachable".to_owned()),
    ] {
        let mut repo = MockMicrosoftGrantRepository::new();
        repo.expect_connection_facts()
            .once()
            .withf(move |_, id| *id == Some(reconnect))
            .returning(|_, _| {
                Ok(email::domain::inbox_entitlement::InboxConnectionFacts {
                    professional: false,
                    accessible_inboxes: 2,
                    reconnecting: true,
                })
            });
        repo.expect_begin_link().once().returning(|_| Ok(()));
        let mut provider = MockMicrosoftIdentityProvider::new();
        provider
            .expect_identity_provider_id()
            .once()
            .returning(|| Ok("microsoft".into()));
        provider
            .expect_authorize()
            .once()
            .returning(|_| Ok("https://login.example.com/authorize".into()));
        let mut flags = FakeFeatureFlags::default();
        flags.set(user.clone(), load);
        let service = Service::new(repo, provider, Arc::new(MockMicrosoftTokenCipher::new()))
            .with_connections_enabled(false)
            .with_feature_flags(Some(flags));
        assert!(
            service
                .start_link(
                    Uuid::now_v7(),
                    &user,
                    "https://macro.test/callback".into(),
                    None,
                    false,
                    Some(reconnect),
                )
                .await
                .is_ok()
        );
    }
}
