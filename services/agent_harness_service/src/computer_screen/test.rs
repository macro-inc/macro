use super::bus::{Frame, decode_frame};
use super::rfb::{ClientFilter, RfbViolation};

/// What noVNC sends after connecting to Xvnc with no password: version,
/// security type None, shared ClientInit, then pixel format and encodings.
fn handshake() -> Vec<u8> {
    let mut bytes = b"RFB 003.008\n".to_vec();
    bytes.push(1);
    bytes.push(1);
    bytes.extend_from_slice(&[0; 20]);
    bytes.extend_from_slice(&[2, 0, 0, 2, 0, 0, 0, 7, 0xff, 0xff, 0xff, 0x21]);
    bytes
}

const UPDATE_REQUEST: [u8; 10] = [3, 1, 0, 0, 0, 0, 4, 0, 3, 0];
const KEY_DOWN: [u8; 8] = [4, 1, 0, 0, 0, 0, 0, 0x61];
const POINTER: [u8; 6] = [5, 1, 0, 10, 0, 20];

#[test]
fn view_only_viewers_finish_the_handshake_but_send_no_input() {
    let mut filter = ClientFilter::view_only();
    let mut stream = handshake();
    stream.extend_from_slice(&KEY_DOWN);
    stream.extend_from_slice(&UPDATE_REQUEST);
    stream.extend_from_slice(&POINTER);
    // Clipboard: "hi".
    stream.extend_from_slice(&[6, 0, 0, 0, 0, 0, 0, 2, b'h', b'i']);
    stream.extend_from_slice(&UPDATE_REQUEST);

    let mut expected = handshake();
    expected.extend_from_slice(&UPDATE_REQUEST);
    expected.extend_from_slice(&UPDATE_REQUEST);
    assert_eq!(filter.push(&stream).unwrap(), expected);
}

#[test]
fn messages_split_across_websocket_frames_are_held_until_complete() {
    let mut filter = ClientFilter::view_only();
    let mut stream = handshake();
    stream.extend_from_slice(&UPDATE_REQUEST);
    stream.extend_from_slice(&KEY_DOWN);
    let mut forwarded = Vec::new();
    for byte in &stream {
        forwarded.extend(filter.push(std::slice::from_ref(byte)).unwrap());
    }
    let mut expected = handshake();
    expected.extend_from_slice(&UPDATE_REQUEST);
    assert_eq!(forwarded, expected);
}

#[test]
fn controlling_viewers_pass_through_untouched() {
    let mut filter = ClientFilter::control();
    let mut stream = handshake();
    stream.extend_from_slice(&KEY_DOWN);
    stream.extend_from_slice(&[0xee, 1, 2]);
    assert_eq!(filter.push(&stream).unwrap(), stream);
}

#[test]
fn unreadable_streams_fail_closed() {
    assert_eq!(
        ClientFilter::view_only().push(b"RFB 003.003\n"),
        Err(RfbViolation::Version)
    );
    let mut veencrypt = b"RFB 003.008\n".to_vec();
    veencrypt.push(19);
    assert_eq!(
        ClientFilter::view_only().push(&veencrypt),
        Err(RfbViolation::Security(19))
    );
    let mut unknown = handshake();
    unknown.push(0xee);
    assert_eq!(
        ClientFilter::view_only().push(&unknown),
        Err(RfbViolation::UnknownMessage(0xee))
    );
    let mut huge_clipboard = handshake();
    huge_clipboard.extend_from_slice(&[6, 0, 0, 0, 0x7f, 0xff, 0xff, 0xff]);
    assert_eq!(
        ClientFilter::view_only().push(&huge_clipboard),
        Err(RfbViolation::TooLong)
    );
}

#[test]
fn bus_frames_carry_a_tag_byte() {
    assert!(matches!(decode_frame(&[0, 1, 2]), Frame::Data(bytes) if bytes == [1, 2]));
    assert!(matches!(decode_frame(&[1]), Frame::Closed));
    assert!(matches!(decode_frame(&[]), Frame::Closed));
}

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
    computer_route_access(true, None).await;
}

#[tokio::test]
async fn computer_viewer_screen_refuses_flag_off() {
    computer_route_access(false, Some("screen")).await;
}

#[tokio::test]
async fn computer_claude_sign_in_refuses_flag_off() {
    computer_route_access(false, Some("claude-sign-in")).await;
}

#[tokio::test]
async fn computer_claude_complete_refuses_flag_off() {
    computer_route_access(false, Some("claude-sign-in/complete")).await;
}

#[tokio::test]
async fn computer_claude_sign_out_refuses_flag_off() {
    computer_route_access(false, Some("claude-sign-out")).await;
}

#[tokio::test]
async fn computer_claude_mode_refuses_flag_off() {
    computer_route_access(false, Some("claude-mode")).await;
}

async fn computer_route_access(enabled: bool, only_route: Option<&str>) {
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
    let app = super::router(
        agent_harness::outbound::runtime_registry::RuntimeRegistry::new(),
        redis::Client::open("redis://127.0.0.1:1").unwrap(),
        HarnessServiceImpl::new(repo),
        MacroAuthorizationState::new(Arc::new(authorization)),
        hosted_runtimes::domain::rollout::ComputerRollout::new(flags),
        &tasks,
        shutdown.clone(),
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
        if enabled {
            StatusCode::OK
        } else {
            StatusCode::FORBIDDEN
        }
    );
    if enabled {
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(
                &to_bytes(response.into_body(), 1024).await.unwrap()
            )
            .unwrap(),
            serde_json::json!({"mode": "own_account"})
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
        ("GET", "screen", ""),
        ("GET", "claude-mode", ""),
        ("POST", "claude-sign-in", ""),
        ("POST", "claude-sign-in/complete", r#"{"code":"test-code"}"#),
        ("POST", "claude-sign-out", ""),
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
