use hosted_runtimes::domain::models::FleetAttachment;

#[derive(Clone)]
struct TestIdentity;

impl macro_authorization::JwtValidator for TestIdentity {
    fn validate_credential(
        &self,
        jwt: &str,
    ) -> Result<
        macro_authorization::ValidatedCredential,
        rootcause::Report<macro_authorization::MacroAuthorizationError>,
    > {
        let user_id = match jwt {
            "owner" => "macro|owner@example.com",
            "other" => "macro|other@example.com",
            "reader" => "macro|reader@example.com",
            "user" => "macro|user@example.com",
            "resident" => "macro|resident@example.com",
            _ => {
                return Err(rootcause::Report::new(
                    macro_authorization::MacroAuthorizationError::InvalidCredentials,
                ));
            }
        };
        Ok(macro_authorization::ValidatedCredential {
            origin: macro_authorization::CredentialOrigin::Session,
            identity: macro_authorization::ValidatedIdentity {
                agent_id: None,
                agent_via: None,
                user_id: user_id.to_owned(),
                fusion_user_id: "test-user".to_owned(),
                permissions: None,
                organization_id: None,
            },
        })
    }
}

#[tokio::test]
async fn computer_routes_require_harness_management_and_mode_reads_persisted_state() {
    computer_route_access(true, None, FleetAttachment::Attached).await;
}

#[tokio::test]
async fn computer_claude_sign_in_refuses_flag_off() {
    computer_route_access(false, Some("claude-sign-in"), FleetAttachment::Detached).await;
}

#[tokio::test]
async fn computer_claude_complete_refuses_flag_off() {
    computer_route_access(
        false,
        Some("claude-sign-in/complete"),
        FleetAttachment::Detached,
    )
    .await;
}

#[tokio::test]
async fn computer_claude_sign_out_refuses_flag_off() {
    computer_route_access(false, Some("claude-sign-out"), FleetAttachment::Detached).await;
}

#[tokio::test]
async fn computer_claude_mode_refuses_flag_off() {
    computer_route_access(false, Some("claude-mode"), FleetAttachment::Detached).await;
}

#[tokio::test]
async fn computer_account_routes_refuse_detached_fleet_after_authorization() {
    computer_route_access(true, None, FleetAttachment::Detached).await;
}

async fn computer_route_access(
    enabled: bool,
    only_route: Option<&str>,
    fleet_attachment: FleetAttachment,
) {
    use axum::{
        body::{Body, to_bytes},
        http::{Request, StatusCode},
    };
    use harness_id::HarnessId;
    use harnesses::domain::{
        models::{ClaudeMode, Harness, HarnessOwner},
        ports::MockHarnessRepo,
        service::HarnessServiceImpl,
    };
    use macro_authorization::{
        InternalAuthConfig, MacroAuthorizationServiceImpl, MacroAuthorizationState,
        NoBotAuthorizer, NoUserApiKeyAuthorizer,
    };
    use std::sync::Arc;
    use tower::ServiceExt as _;

    let mut repo = MockHarnessRepo::new();
    repo.expect_get_harness().returning(|id| {
        Box::pin(async move {
            Ok(Some(Harness {
                id,
                kind: "macrod".to_owned(),
                name: "Computer".to_owned(),
                owner: HarnessOwner::User {
                    user_id: "macro|owner@example.com".to_owned(),
                },
                created_by: "macro|owner@example.com".to_owned(),
                created_at: "2026-01-01T00:00:00Z".parse().unwrap(),
                updated_at: "2026-01-01T00:00:00Z".parse().unwrap(),
                allow_permission_bypass: false,
                access: Default::default(),
                shared_team_ids: Vec::new(),
                connected: false,
                last_connected_at: None,
                computer_id: Some(computer_id::ComputerId::new_from_uuid(
                    uuid::Uuid::from_u128(1),
                )),
                claude_mode: ClaudeMode::OwnAccount,
            }))
        })
    });
    repo.expect_active_account_login()
        .returning(|harness_id, provider| {
            Box::pin(async move {
                Ok(Some(
                    harnesses::domain::account_logins::HarnessAccountLogin {
                        id: uuid::Uuid::from_u128(0x1001),
                        harness_id,
                        account: harnesses::domain::account_logins::ProviderAccount {
                            id: uuid::Uuid::from_u128(0x2001),
                            provider,
                            identity: harnesses::domain::account_logins::ProviderAccountIdentity {
                                external_account_id: "sha256:0123456789abcdef0123456789abcdef"
                                    .to_owned(),
                            },
                        },
                        signed_in_by: Some(
                            macro_user_id::user_id::MacroUserIdStr::try_from(
                                "macro|owner@example.com".to_owned(),
                            )
                            .unwrap(),
                        ),
                        signed_in_at: "2026-01-02T00:00:00Z".parse().unwrap(),
                        expires_at: None,
                        signed_out_at: None,
                    },
                ))
            })
        });
    repo.expect_harness_access().returning(|_, caller| {
        Box::pin(async move {
            Ok(match caller.as_ref() {
                "macro|owner@example.com" => harnesses::domain::models::HarnessAccess::Owner,
                _ => harnesses::domain::models::HarnessAccess::None,
            })
        })
    });
    let authorization = MacroAuthorizationServiceImpl::new(
        TestIdentity,
        InternalAuthConfig {
            api_key: "test-internal-key".to_owned(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    );
    let tasks = tokio_util::task::TaskTracker::new();
    let shutdown = tokio_util::sync::CancellationToken::new();
    let mut flags = feature_flags::outbound::fake::FakeFeatureFlags::default();
    for user in ["macro|owner@example.com", "macro|other@example.com"] {
        flags.set(
            macro_user_id::user_id::MacroUserIdStr::try_from(user.to_owned()).unwrap(),
            Ok(feature_flags::FlagSnapshot::new([(
                "enable-macro-computers".into(),
                feature_flags::FlagValue::Boolean(enabled),
            )])),
        );
    }
    let harnesses = Arc::new(HarnessServiceImpl::new(repo));
    // The repo mock expects no login write; harnessd records every request.
    let transport = Arc::new(crate::computers::harnessd::fakes::FakeHarnessd::new(|_| {
        harnessd_protocol::Response::SignedOut {
            agent: harnessd_protocol::AgentProvider::Claude,
        }
    }));
    let harnessd = crate::computers::harnessd::Harnessd::new(
        transport.clone(),
        Arc::new(crate::computers::harnessd::fakes::FakeLocks::default()),
        Arc::clone(&harnesses),
    );
    let app = super::router(
        harnessd,
        harnesses,
        MacroAuthorizationState::new(Arc::new(authorization)),
        hosted_runtimes::domain::rollout::ComputerRollout::new(flags),
        fleet_attachment,
        &tasks,
    );
    let mode_url = format!("/harnesses/{}/claude-mode", HarnessId::TEST_A);
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(&mode_url)
                .header("authorization", "Bearer owner")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        if !enabled {
            StatusCode::FORBIDDEN
        } else if fleet_attachment == FleetAttachment::Detached {
            StatusCode::SERVICE_UNAVAILABLE
        } else {
            StatusCode::OK
        }
    );
    if enabled && fleet_attachment == FleetAttachment::Attached {
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(
                &to_bytes(response.into_body(), 4096).await.unwrap()
            )
            .unwrap(),
            serde_json::json!({
                "mode": "own_account",
                "account": {
                    "signedInBy": "macro|owner@example.com",
                    "signedInAt": "2026-01-02T00:00:00Z",
                    "expiresAt": null,
                },
            })
        );
    }

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server_shutdown = shutdown.clone();
    let server_app = app.clone();
    tasks.spawn(async move {
        axum::serve(listener, server_app)
            .with_graceful_shutdown(server_shutdown.cancelled_owned())
            .await
            .unwrap();
    });
    let client = reqwest::Client::new();

    for (method, suffix, body) in [
        ("GET", "claude-mode", ""),
        ("POST", "claude-sign-in", ""),
        ("POST", "claude-sign-in/complete", r#"{"code":"test-code"}"#),
        ("POST", "claude-sign-out", ""),
        ("POST", "claude-sign-in/cancel", ""),
    ] {
        if only_route.is_some_and(|route| route != suffix) {
            continue;
        }
        let response = client
            .request(
                method.parse().unwrap(),
                format!("http://{address}/harnesses/{}/{suffix}", HarnessId::TEST_A),
            )
            .header(
                "authorization",
                if enabled {
                    "Bearer other"
                } else {
                    "Bearer owner"
                },
            )
            .header("connection", "upgrade")
            .header("upgrade", "websocket")
            .header("sec-websocket-version", "13")
            .header("sec-websocket-key", "AAAAAAAAAAAAAAAAAAAAAA==")
            .header("content-type", "application/json")
            .body(body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{suffix}");
        if enabled && fleet_attachment == FleetAttachment::Detached {
            let response = client
                .request(
                    method.parse().unwrap(),
                    format!("http://{address}/harnesses/{}/{suffix}", HarnessId::TEST_A),
                )
                .bearer_auth("owner")
                .header("connection", "upgrade")
                .header("upgrade", "websocket")
                .header("sec-websocket-version", "13")
                .header("sec-websocket-key", "AAAAAAAAAAAAAAAAAAAAAA==")
                .header("content-type", "application/json")
                .body(body)
                .send()
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                StatusCode::SERVICE_UNAVAILABLE,
                "{suffix}"
            );
            assert_eq!(
                response.json::<serde_json::Value>().await.unwrap(),
                serde_json::json!({"message": "computers are not available"}),
                "{suffix}"
            );
        }
    }
    let anonymous = app
        .oneshot(
            Request::builder()
                .uri(&mode_url)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);
    // Every request above was refused before reaching the computer.
    assert!(transport.requests.lock().unwrap().is_empty());
    shutdown.cancel();
    tasks.close();
    tasks.wait().await;
}

#[tokio::test]
async fn computer_invalid_code_is_a_typed_retryable_response() {
    use axum::response::IntoResponse as _;
    let answer = serde_json::from_value(
        serde_json::json!({"result": "error", "agent": "claude", "kind": "invalid_code"}),
    )
    .unwrap();
    let response = super::ComputerRouteError::from_answer(answer).into_response();
    assert_eq!(
        response.status(),
        axum::http::StatusCode::UNPROCESSABLE_ENTITY
    );
    let body = axum::body::to_bytes(response.into_body(), 1024)
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        serde_json::json!({
            "code": "invalid_code",
            "message": "That code didn't work — sign in again to get a new one"
        })
    );
}

#[tokio::test]
async fn computer_claude_cancel_refuses_flag_off() {
    computer_route_access(
        false,
        Some("claude-sign-in/cancel"),
        FleetAttachment::Detached,
    )
    .await;
}

#[tokio::test]
async fn a_completion_whose_caller_left_still_records_its_signer() {
    use harness_id::HarnessId;
    use harnessd_protocol::{AgentProvider, ClaudeAccount, Request, Response};
    use std::sync::{Arc, Mutex};

    let changes = Arc::new(Mutex::new(Vec::new()));
    let transport = Arc::new(
        crate::computers::harnessd::fakes::FakeHarnessd::new(|_| Response::SignedIn {
            agent: AgentProvider::Claude,
            claude: Some(ClaudeAccount {
                credential_id: "sha256:0123456789abcdef0123456789abcdef".to_owned(),
                expires_at: None,
            }),
        })
        .holding_complete(),
    );
    let harnesses = Arc::new(crate::computers::harnessd::fakes::recording_harnesses(
        Arc::clone(&changes),
    ));
    let harnessd = crate::computers::harnessd::Harnessd::new(
        transport.clone(),
        Arc::new(crate::computers::harnessd::fakes::FakeLocks::default()),
        Arc::clone(&harnesses),
    );
    let cleanup = tokio_util::task::TaskTracker::new();
    let state = super::ClaudeAccessState {
        harnesses,
        harnessd: harnessd.clone(),
        rollout: hosted_runtimes::domain::rollout::ComputerRollout::new(
            feature_flags::outbound::fake::FakeFeatureFlags::default(),
        ),
        fleet_attachment: FleetAttachment::Attached,
        cleanup: cleanup.clone(),
        authorization_state: macro_authorization::MacroAuthorizationState::new(Arc::new(())),
    };
    let signer =
        macro_user_id::user_id::MacroUserIdStr::try_from("macro|owner@example.com".to_owned())
            .unwrap();
    let computer = computer_id::ComputerId::new_from_uuid(uuid::Uuid::from_u128(1));

    let request = tokio::spawn({
        let signer = signer.clone();
        async move {
            state
                .run(
                    HarnessId::TEST_A,
                    computer,
                    Request::SignInComplete {
                        agent: AgentProvider::Claude,
                        code: "abc#def".to_owned(),
                    },
                    Some(signer),
                )
                .await
        }
    });
    transport.complete_started.notified().await;
    request.abort();
    // harnessd answers the completion only after the caller left.
    transport.release_complete();
    cleanup.close();
    cleanup.wait().await;

    assert_eq!(
        *changes.lock().unwrap(),
        vec![(
            HarnessId::TEST_A,
            harnesses::domain::account_logins::AccountLoginChange::SignedIn {
                provider: AgentProvider::Claude,
                account: harnesses::domain::account_logins::ProviderAccountIdentity {
                    external_account_id: "sha256:0123456789abcdef0123456789abcdef".to_owned(),
                },
                expires_at: None,
                signed_in_by: Some(signer),
            }
        )]
    );
}

#[test]
fn only_claudes_own_https_sign_in_links_are_handed_out() {
    let real = "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&scope=user%3Ainference&state=abc";
    assert_eq!(super::trusted_sign_in_url(real).unwrap(), real);
    assert!(super::trusted_sign_in_url("https://claude.ai/oauth/authorize?state=abc").is_ok());

    for untrusted in [
        "javascript:alert(1)",
        "http://claude.com/cai/oauth/authorize?state=abc",
        "https://claude.com.evil.test/cai/oauth/authorize?state=abc",
        "https://evil.test/cai/oauth/authorize?state=abc",
        "https://claude.com/somewhere/else",
        "not a url",
    ] {
        assert!(
            matches!(
                super::trusted_sign_in_url(untrusted),
                Err(super::ComputerRouteError::UntrustedSignInUrl)
            ),
            "{untrusted}"
        );
    }
}
