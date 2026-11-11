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
                capabilities: Default::default(),
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
                                external_account_id: "acct-1".to_owned(),
                                display_email: Some("team@example.com".to_owned()),
                                display_org: Some("Acme".to_owned()),
                                plan: Some("max".to_owned()),
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
    let redis = redis::Client::open("redis://127.0.0.1:1").unwrap();
    let control = super::ComputerControl::start(
        agent_harness::outbound::runtime_registry::RuntimeRegistry::new(),
        redis.clone(),
        &tasks,
        shutdown.clone(),
    );
    let app = super::router(
        control,
        redis,
        HarnessServiceImpl::new(repo),
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
                    "email": "team@example.com",
                    "organization": "Acme",
                    "plan": "max",
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
    shutdown.cancel();
    tasks.close();
    tasks.wait().await;
}

#[tokio::test]
async fn computer_invalid_code_is_a_typed_retryable_response() {
    use axum::response::IntoResponse as _;
    let result = serde_json::from_value(serde_json::json!({"status": "invalid_code"})).unwrap();
    let response = super::ComputerRouteError::from_result(result).into_response();
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
async fn computer_dropped_submit_reconciles_a_committed_runtime_result() {
    dropped_submit_reconciles(true).await;
}

#[tokio::test]
async fn computer_dropped_submit_reconciles_even_if_cancellation_disconnects() {
    dropped_submit_reconciles(false).await;
}

async fn dropped_submit_reconciles(acknowledge_cancel: bool) {
    use agent_runtime_protocol::domain::channel::Channel;
    use agent_runtime_protocol::domain::schema::v0::{
        ComputerCommand, ComputerControlResult, ToRuntimeMessage, ToServerMessage,
    };
    use harness_id::HarnessId;
    use harnesses::domain::{
        account_logins::{AccountLoginChange, AgentProvider, ProviderAccountIdentity},
        ports::MockHarnessRepo,
        service::HarnessServiceImpl,
    };
    use std::sync::Arc;

    let redis = redis::Client::open(macro_env_var::read_env_var("REDIS_URI").unwrap()).unwrap();
    let harness_id = HarnessId::new_from_uuid(uuid::Uuid::now_v7());
    let runtimes = agent_harness::outbound::runtime_registry::RuntimeRegistry::new();
    let (carrier, mut runtime) = Channel::duplex();
    runtimes.attach(harness_id, carrier);
    let cleanup = tokio_util::task::TaskTracker::new();
    let shutdown = tokio_util::sync::CancellationToken::new();
    let control =
        super::ComputerControl::start(runtimes, redis.clone(), &cleanup, shutdown.clone());
    let (mode_saved, saved) = tokio::sync::oneshot::channel();
    let mut repo = MockHarnessRepo::new();
    repo.expect_record_account_login()
        .times(1)
        .return_once(move |id, change| {
            assert_eq!(id, harness_id);
            assert_eq!(
                change,
                AccountLoginChange::SignedIn {
                    provider: AgentProvider::Claude,
                    account: ProviderAccountIdentity {
                        external_account_id: "acct-1".to_owned(),
                        display_email: Some("team@example.com".to_owned()),
                        display_org: Some("Acme".to_owned()),
                        plan: Some("max".to_owned()),
                    },
                    signed_in_by: macro_user_id::user_id::MacroUserIdStr::try_from(
                        "macro|owner@example.com".to_owned()
                    )
                    .unwrap(),
                }
            );
            Box::pin(async move {
                mode_saved.send(()).unwrap();
                Ok(true)
            })
        });
    let state = super::ClaudeAccessState {
        harnesses: Arc::new(HarnessServiceImpl::new(repo)),
        rollout: hosted_runtimes::domain::rollout::ComputerRollout::new(
            feature_flags::outbound::fake::FakeFeatureFlags::default(),
        ),
        fleet_attachment: FleetAttachment::Attached,
        control,
        redis: redis.clone(),
        cleanup: cleanup.clone(),
        authorization_state: macro_authorization::MacroAuthorizationState::new(Arc::new(())),
    };
    let request = tokio::spawn(async move {
        state
            .complete_sign_in(
                harness_id,
                "test-code".to_owned(),
                macro_user_id::user_id::MacroUserIdStr::try_from(
                    "macro|owner@example.com".to_owned(),
                )
                .unwrap(),
            )
            .await
    });
    let ToRuntimeMessage::ComputerControl {
        request_id: completion_id,
        command,
        ..
    } = runtime.rx.recv().await.unwrap()
    else {
        panic!("expected completion command");
    };
    assert!(matches!(
        command,
        ComputerCommand::ClaudeSignInComplete { .. }
    ));
    request.abort();
    assert!(request.await.unwrap_err().is_cancelled());
    let ToRuntimeMessage::ComputerControl {
        request_id: cancel_id,
        command,
        ..
    } = runtime.rx.recv().await.unwrap()
    else {
        panic!("expected cancel command");
    };
    assert_eq!(command, ComputerCommand::ClaudeSignInCancel);
    // macrod committed just before cancellation; its result still owns the mode write.
    runtime
        .tx
        .send(ToServerMessage::ComputerControlResponse {
            request_id: completion_id,
            result: ComputerControlResult::SignedIn {
                account_id: "acct-1".to_owned(),
                account: Some("team@example.com".to_owned()),
                organization: Some("Acme".to_owned()),
                plan: Some("max".to_owned()),
            },
        })
        .unwrap();
    if acknowledge_cancel {
        runtime
            .tx
            .send(ToServerMessage::ComputerControlResponse {
                request_id: cancel_id,
                result: ComputerControlResult::SignInCancelled,
            })
            .unwrap();
    } else {
        drop(runtime);
    }
    tokio::time::timeout(std::time::Duration::from_secs(2), saved)
        .await
        .unwrap()
        .unwrap();
    shutdown.cancel();
    cleanup.close();
    cleanup.wait().await;
    super::bus::AccountChange::claim(&redis, harness_id, &cleanup)
        .await
        .unwrap()
        .release()
        .await
        .unwrap();
}
