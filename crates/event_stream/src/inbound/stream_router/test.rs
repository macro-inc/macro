use super::*;
use crate::domain::models::ControlEvent;
use crate::domain::models::NormalizedEvent;

#[test]
fn stream_errors_map_to_their_statuses() {
    for (error, status) in [
        (
            StreamError::BadRequest("bad".to_owned()),
            StatusCode::BAD_REQUEST,
        ),
        (StreamError::Forbidden, StatusCode::FORBIDDEN),
        (StreamError::NotEnabled, StatusCode::NOT_FOUND),
        (StreamError::TooManyStreams, StatusCode::TOO_MANY_REQUESTS),
        (StreamError::CursorExpired, StatusCode::GONE),
    ] {
        assert_eq!(StreamHandlerError(error).into_response().status(), status);
    }
}

#[test]
fn the_api_key_digest_is_stable_and_never_the_key() {
    let mut headers = HeaderMap::new();
    headers.insert(USER_API_KEY_HEADER, "mak_secret".parse().unwrap());

    let digest = api_key_digest(&headers);

    assert_eq!(digest, api_key_digest(&headers));
    assert_eq!(digest.len(), 24);
    assert!(!digest.contains("secret"));
}

#[test]
fn events_and_control_events_encode() {
    let event = NormalizedEvent {
        event_id: "e".to_owned(),
        schema_version: 1,
        event_name: "document.updated".to_owned(),
        entity_type: "document".to_owned(),
        entity_id: "d".to_owned(),
        ordering_key: "d".to_owned(),
        occurred_at: chrono::Utc::now(),
        broker_envelope: serde_json::json!({"event_type": "document.updated"}),
    };

    assert!(
        sse_event(StreamItem::Event {
            id: "1-0".to_owned(),
            event: Arc::new(event),
        })
        .is_some()
    );
    assert!(
        sse_event(StreamItem::Control(ControlEvent::Lagged {
            cursor: Some("1-0".to_owned())
        }))
        .is_some()
    );
}

/// The router end to end over a fake stream service: which principal each
/// credential becomes, and that a harness token streams.
mod principals {
    use super::*;
    use axum::body::{Body, to_bytes};
    use axum::http::Request;
    use futures::stream::BoxStream;
    use macro_authorization::{
        AccountManagerCredential, AuthorizedUserApiKey, BOT_FOR_MACRO_USER_ID_HEADER,
        BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, BotActingUserClaims, BotAuthentication, BotScope,
        HARNESS_TOKEN_HEADER, HarnessAuthentication, HarnessAuthorizationOwner,
        INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalIdentityClaims,
        MacroAuthorizationError, MacroUserAuthentication, ValidatedCredential,
    };
    use macro_user_id::cowlike::CowLike as _;
    use model_user::UserContext;
    use rootcause::Report;
    use std::sync::Mutex;
    use tower::ServiceExt as _;

    const USER: &str = "macro|listener@example.com";
    const OWNED_BOT: Uuid = Uuid::from_u128(0xb01);
    const BORROWED_BOT: Uuid = Uuid::from_u128(0xb02);
    const HARNESS: Uuid = Uuid::from_u128(0x4a);
    const GRANT: Uuid = Uuid::from_u128(0x6a);

    fn context() -> UserContext {
        UserContext {
            user_id: USER.to_owned(),
            fusion_user_id: "fusion".to_owned(),
            permissions: None,
            organization_id: None,
        }
    }

    fn acting(origin: CredentialOrigin) -> MacroUserAuthentication {
        MacroUserAuthentication {
            origin,
            agent_id: None,
            agent_via: None,
            macro_user_id: macro_user_id::user_id::MacroUserIdStr::parse_from_str(USER)
                .unwrap()
                .into_owned(),
            user_context: context(),
        }
    }

    /// Admits `session` (bearer), `mak_own` and `mak_managed` API keys, bot
    /// tokens naming a bot id, `harness`, and the internal key `internal`.
    #[derive(Clone)]
    struct Auth;

    impl MacroAuthorizationService for Auth {
        async fn authorize(
            &self,
            jwt: &str,
        ) -> Result<UserContext, Report<MacroAuthorizationError>> {
            if jwt == "session" {
                Ok(context())
            } else {
                Err(Report::new(MacroAuthorizationError::InvalidCredentials))
            }
        }

        async fn authorize_identity(
            &self,
            jwt: &str,
        ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
            self.authorize(jwt).await.map(ValidatedCredential::session)
        }

        async fn authorize_user_api_key(
            &self,
            api_key: &str,
        ) -> Result<AuthorizedUserApiKey, Report<MacroAuthorizationError>> {
            let account_manager = match api_key {
                "mak_own" => None,
                "mak_managed" => Some(AccountManagerCredential {
                    grant_id: GRANT,
                    manager_user_id: macro_user_id::user_id::MacroUserIdStr::parse_from_str(
                        "macro|manager@example.com",
                    )
                    .unwrap()
                    .into_owned(),
                }),
                _ => return Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
            };
            Ok(AuthorizedUserApiKey {
                user_context: context(),
                account_manager,
            })
        }

        async fn authorize_bot(
            &self,
            bot_token: &str,
            bot_scope: BotScope,
            _acting_user: Option<BotActingUserClaims>,
        ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
            let bot_id = Uuid::parse_str(bot_token)
                .map_err(|_| Report::new(MacroAuthorizationError::InvalidCredentials))?;
            Ok(BotAuthentication {
                bot_id: bot_id::BotId::new_from_uuid(bot_id),
                token_id: Uuid::from_u128(0x70),
                bot_scope,
                team_id: None,
                acting_user: Some(acting(CredentialOrigin::Bot)),
            })
        }

        async fn authorize_harness(
            &self,
            harness_token: &str,
            _acting_user_claim: Option<String>,
        ) -> Result<HarnessAuthentication, Report<MacroAuthorizationError>> {
            if harness_token != "harness" {
                return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
            }
            Ok(HarnessAuthentication {
                harness_id: harness_id::HarnessId::new_from_uuid(HARNESS),
                token_id: Uuid::from_u128(0x71),
                owner: HarnessAuthorizationOwner::User {
                    user_id: USER.to_owned(),
                },
                acting_user: acting(CredentialOrigin::Harness),
            })
        }

        async fn authorize_internal(
            &self,
            provided_key: &str,
            _claims: InternalIdentityClaims,
        ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
            if provided_key == "internal" {
                Ok(Some(context()))
            } else {
                Err(Report::new(MacroAuthorizationError::InvalidCredentials))
            }
        }
    }

    /// Records who opened a stream and hands back one `agent_trigger.new`.
    #[derive(Clone, Default)]
    struct Streams {
        opened: Arc<Mutex<Vec<StreamPrincipal>>>,
    }

    impl EventStreamService for Streams {
        async fn open_stream(
            &self,
            request: OpenStream,
        ) -> Result<BoxStream<'static, StreamItem>, StreamError> {
            self.opened.lock().unwrap().push(request.principal);
            let event = NormalizedEvent {
                event_id: "0193b3a0-0000-7000-8000-000000000001".to_owned(),
                schema_version: 1,
                event_name: "agent_trigger.new".to_owned(),
                entity_type: "bot".to_owned(),
                entity_id: OWNED_BOT.to_string(),
                ordering_key: OWNED_BOT.to_string(),
                occurred_at: chrono::Utc::now(),
                broker_envelope: serde_json::json!({ "event_type": "agent_trigger.new" }),
            };
            Ok(Box::pin(futures::stream::iter([StreamItem::Event {
                id: event.event_id.clone(),
                event: Arc::new(event),
            }])))
        }

        async fn preview_enabled(&self, _principal: &StreamPrincipal) -> bool {
            false
        }
    }

    #[derive(Clone)]
    struct Owners;

    impl BotOwners for Owners {
        async fn is_owned_by(
            &self,
            bot_id: Uuid,
            user_id: &str,
        ) -> Result<bool, rootcause::Report> {
            Ok(bot_id == OWNED_BOT && user_id == USER)
        }
    }

    /// Open a stream with `headers`; the status, the body and who it opened as.
    async fn open(headers: &[(&str, &str)]) -> (StatusCode, String, Option<StreamPrincipal>) {
        let streams = Streams::default();
        let router: Router = event_stream_router(EventStreamRouterState::new(
            streams.clone(),
            Owners,
            MacroAuthorizationState::new(Arc::new(Auth)),
        ));
        let mut request = Request::builder().uri(
            "/webhook/events/stream?scope=user&filters=%5B%7B%22events%22%3A%5B%22agent_trigger.new%22%5D%7D%5D",
        );
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let response = router
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let opened = streams.opened.lock().unwrap().first().cloned();
        (status, String::from_utf8_lossy(&body).into_owned(), opened)
    }

    #[tokio::test]
    async fn a_harness_token_streams_agent_triggers_as_its_acting_user() {
        let (status, body, opened) = open(&[(HARNESS_TOKEN_HEADER, "harness")]).await;

        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("event: agent_trigger.new"), "{body}");
        let principal = opened.unwrap();
        assert_eq!(
            principal.kind,
            PrincipalKind::Harness {
                harness_id: HARNESS,
                user: macro_user_id::user_id::MacroUserIdStr::parse_from_str(USER)
                    .unwrap()
                    .into_owned(),
            }
        );
    }

    #[tokio::test]
    async fn each_credential_becomes_its_principal() {
        let session = open(&[("authorization", "Bearer session")])
            .await
            .2
            .unwrap();
        assert!(matches!(
            session.kind,
            PrincipalKind::User { api_key: false, .. }
        ));

        let api_key = open(&[(USER_API_KEY_HEADER, "mak_own")]).await.2.unwrap();
        assert!(matches!(
            api_key.kind,
            PrincipalKind::User { api_key: true, .. }
        ));
        assert!(api_key.credential_id.starts_with("api_key:"));
        assert!(!api_key.credential_id.contains("mak_own"));

        let managed = open(&[(USER_API_KEY_HEADER, "mak_managed")])
            .await
            .2
            .unwrap();
        assert!(matches!(managed.kind, PrincipalKind::AccountManager { .. }));
        assert_eq!(
            managed.credential_id,
            format!("account_manager_grant:{GRANT}")
        );

        let owned_bot = OWNED_BOT.to_string();
        let owned = open(&[
            (BOT_TOKEN_HEADER, owned_bot.as_str()),
            (BOT_SCOPE_HEADER, "user"),
            (BOT_FOR_MACRO_USER_ID_HEADER, USER),
        ])
        .await
        .2
        .unwrap();
        assert!(matches!(
            owned.kind,
            PrincipalKind::Bot {
                owned_by_user: true,
                ..
            }
        ));

        let borrowed_bot = BORROWED_BOT.to_string();
        let borrowed = open(&[
            (BOT_TOKEN_HEADER, borrowed_bot.as_str()),
            (BOT_SCOPE_HEADER, "user"),
            (BOT_FOR_MACRO_USER_ID_HEADER, USER),
        ])
        .await
        .2
        .unwrap();
        assert!(matches!(
            borrowed.kind,
            PrincipalKind::Bot {
                owned_by_user: false,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn an_internal_credential_is_refused_and_no_credential_is_unauthorized() {
        let (internal, _, opened) = open(&[
            (INTERNAL_API_KEY_HEADER, "internal"),
            (INTERNAL_MACRO_USER_ID_HEADER, USER),
        ])
        .await;
        assert_eq!(internal, StatusCode::FORBIDDEN);
        assert!(opened.is_none());

        let (anonymous, _, _) = open(&[]).await;
        assert_eq!(anonymous, StatusCode::UNAUTHORIZED);
    }
}
