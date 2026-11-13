use super::*;
use crate::domain::ports::Availability;
use crate::outbound::{openbao::UnavailableProvider, postgres::PgRepository};
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError, ValidatedCredential};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_user::UserContext;
use rootcause::Report;
use tower::ServiceExt;

#[derive(Clone)]
struct Authorization;
impl MacroAuthorizationService for Authorization {
    async fn authorize(&self, token: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        Ok(UserContext {
            user_id: if token == "agent-session" {
                "macro|agent@example.test"
            } else {
                "macro|synthetic@example.test"
            }
            .into(),
            fusion_user_id: "fixture".into(),
            permissions: None,
            organization_id: None,
        })
    }
    async fn authorize_identity(
        &self,
        token: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        let mut credential = ValidatedCredential::session(self.authorize(token).await?);
        credential.origin = match token {
            "session" | "agent-session" => CredentialOrigin::Session,
            "api" => CredentialOrigin::MacroApiJwt,
            "key" => CredentialOrigin::UserApiKey,
            "agent" => CredentialOrigin::Bot,
            "internal" => CredentialOrigin::Internal,
            _ => return Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        };
        Ok(credential)
    }
    async fn authorize_user_api_key(
        &self,
        _: &str,
    ) -> Result<macro_authorization::AuthorizedUserApiKey, Report<MacroAuthorizationError>> {
        Ok(macro_authorization::AuthorizedUserApiKey {
            user_context: self.authorize("session").await?,
            account_manager: None,
        })
    }
    async fn authorize_internal(
        &self,
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Ok(Some(self.authorize("session").await?))
    }
}
struct Disabled;
#[async_trait::async_trait]
impl Availability for Disabled {
    async fn require_enabled(&self, _: &Actor) -> Result<(), Error> {
        self.require_provider()
    }
    fn require_provider(&self) -> Result<(), Error> {
        Err(Error::Unavailable)
    }
}
fn flagged_app(
    actor_result: Result<feature_flags::FlagSnapshot, String>,
    configured: bool,
) -> (
    Router,
    Arc<crate::domain::service::test::fakes::FakeRepository>,
    Arc<crate::domain::service::test::fakes::FakeProvider>,
) {
    use crate::{domain::service::test::fakes::*, outbound::availability::*};
    let repository = Arc::new(FakeRepository::new());
    let provider = Arc::new(FakeProvider::new());
    let mut flags = feature_flags::outbound::fake::FakeFeatureFlags::default();
    for user in ["macro|synthetic@example.test", "macro|agent@example.test"] {
        use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
        flags.set(
            MacroUserIdStr::parse_from_str(user).unwrap().into_owned(),
            actor_result.clone(),
        );
    }
    let app = router(PasswordRouterState {
        authorization: MacroAuthorizationState::new(Arc::new(Authorization)),
        service: Arc::new(PasswordService {
            repository: repository.clone(),
            provider: provider.clone(),
            availability: Arc::new(PasswordAvailability {
                flags,
                provider_configured: configured,
            }),
        }),
    });
    (app, repository, provider)
}
fn app() -> Router {
    flagged_app(Err("flag transport failed".into()), true).0
}
fn routes() -> Vec<(&'static str, String, serde_json::Value)> {
    let team = Uuid::from_u128(1);
    let item = format!("/teams/{team}/items/{}", Uuid::from_u128(2));
    let values = serde_json::json!({"username":"synthetic-secret", "password":"synthetic-secret", "notes":"", "fields":[]});
    let write = serde_json::json!({"operationId":Uuid::now_v7(),"name":"Fixture","kind":"login","url":null,"folderId":null,"favorite":false,"expectedVersion":1,"values":values});
    let mut create = write.clone();
    create["expectedVersion"] = serde_json::Value::Null;
    let mut routes = vec![
        ("GET", "/teams".into(), serde_json::json!({})),
        ("GET", format!("/teams/{team}/items"), serde_json::json!({})),
        ("POST", format!("/teams/{team}/items"), create),
        (
            "POST",
            format!("/teams/{team}/items/match"),
            serde_json::json!({"names":["Synthetic"]}),
        ),
        (
            "POST",
            format!("/teams/{team}/imports/{}/items", Uuid::from_u128(4)),
            serde_json::json!({"format":"bitwarden_json","target":{"kind":"root"},"private":false,"folders":[],"items":[]}),
        ),
        ("GET", item.clone(), serde_json::json!({})),
        ("GET", format!("{item}/username"), serde_json::json!({})),
        (
            "POST",
            format!("{item}/username/copy"),
            serde_json::json!({}),
        ),
        ("PUT", item.clone(), write),
        (
            "PATCH",
            item.clone(),
            serde_json::json!({"name":"Fixture","kind":"login","url":null,"folderId":null,"favorite":false,"expectedVersion":1}),
        ),
        ("DELETE", item.clone(), serde_json::json!({})),
        (
            "POST",
            format!("{item}/reveal"),
            serde_json::json!({"version":null}),
        ),
        (
            "POST",
            format!("{item}/copy"),
            serde_json::json!({"version":null}),
        ),
        ("GET", format!("{item}/history"), serde_json::json!({})),
        ("GET", format!("{item}/activity"), serde_json::json!({})),
        ("GET", format!("{item}/share"), serde_json::json!({})),
        (
            "PUT",
            format!("{item}/share"),
            serde_json::json!({"grants":[]}),
        ),
        (
            "PUT",
            format!("{item}/totp"),
            serde_json::json!({"key":"synthetic-secret"}),
        ),
        ("DELETE", format!("{item}/totp"), serde_json::json!({})),
        ("POST", format!("{item}/totp/code"), serde_json::json!({})),
        (
            "GET",
            format!("/teams/{team}/folders"),
            serde_json::json!({}),
        ),
        (
            "POST",
            format!("/teams/{team}/folders"),
            serde_json::json!({"name":"Fixture"}),
        ),
        (
            "PUT",
            format!("/teams/{team}/folders/{}", Uuid::from_u128(3)),
            serde_json::json!({"name":"Fixture"}),
        ),
        (
            "DELETE",
            format!("/teams/{team}/folders/{}", Uuid::from_u128(3)),
            serde_json::json!({}),
        ),
        (
            "PUT",
            format!("/teams/{team}/folders/{}/parent", Uuid::from_u128(3)),
            serde_json::json!({"parentId":null}),
        ),
    ];
    let heads: Vec<_> = routes
        .iter()
        .filter(|(method, _, _)| *method == "GET")
        .map(|(_, path, body)| ("HEAD", path.clone(), body.clone()))
        .collect();
    routes.extend(heads);
    routes
}
#[tokio::test]
async fn every_route_rejects_non_session_origins_and_keeps_responses_private() {
    for (method, path, body) in routes() {
        for token in [
            "session", "api", "key", "agent", "internal", "invalid", "missing",
        ] {
            let mut request = Request::builder().method(method).uri(&path);
            if token != "missing" {
                request = request.header("authorization", format!("Bearer {token}"));
            }
            let response = app()
                .oneshot(
                    request
                        .header("x-macro-passwords", "1")
                        .header("content-type", "application/json")
                        .body(Body::from(body.to_string()))
                        .expect("request"),
                )
                .await
                .expect("response");
            let expected = if token == "session" {
                StatusCode::SERVICE_UNAVAILABLE
            } else if matches!(token, "invalid" | "missing") {
                StatusCode::UNAUTHORIZED
            } else {
                StatusCode::FORBIDDEN
            };
            assert_eq!(response.status(), expected, "{method} {path}: {token}");
            assert_eq!(response.headers()[CACHE_CONTROL], "private, no-store");
            let body = to_bytes(response.into_body(), 262144).await.expect("body");
            assert!(!String::from_utf8_lossy(&body).contains("synthetic-secret"));
        }
    }
}
#[tokio::test]
async fn mutations_reject_missing_header_and_cross_site_requests() {
    for (method, path, body) in routes()
        .into_iter()
        .filter(|(method, _, _)| !matches!(*method, "GET" | "HEAD"))
    {
        for cross_site in [false, true] {
            let mut request = Request::builder()
                .method(method)
                .uri(&path)
                .header("authorization", "Bearer session")
                .header("content-type", "application/json");
            if cross_site {
                request = request
                    .header("x-macro-passwords", "1")
                    .header("sec-fetch-site", "cross-site");
            }
            let response = app()
                .oneshot(request.body(Body::from(body.to_string())).expect("request"))
                .await
                .expect("response");
            assert_eq!(response.status(), StatusCode::FORBIDDEN, "{method} {path}");
            assert_eq!(response.headers()[CACHE_CONTROL], "private, no-store");
        }
    }
}
#[tokio::test]
async fn invalid_json_never_reflects_private_input() {
    for body in [
        r#"{"kind":"synthetic-secret"}"#,
        r#"{"values":{"password":"synthetic-secret"},"url":"https://synthetic-secret:synthetic-secret@example.test"}"#,
        r#"{"password":"synthetic-secret""#,
    ] {
        let response = app()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/teams/{}/items", Uuid::from_u128(1)))
                    .header("authorization", "Bearer session")
                    .header("x-macro-passwords", "1")
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert!(matches!(
            response.status(),
            StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY
        ));
        assert_eq!(response.headers()[CACHE_CONTROL], "private, no-store");
        assert_eq!(
            to_bytes(response.into_body(), 262144).await.expect("body"),
            r#"{"code":"invalid_request"}"#
        );
    }
}

struct Enabled;
#[async_trait::async_trait]
impl Availability for Enabled {
    async fn require_enabled(&self, _: &Actor) -> Result<(), Error> {
        self.require_provider()
    }
    fn require_provider(&self) -> Result<(), Error> {
        Ok(())
    }
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn live_metadata_routes_and_share_reject_cross_team_access(pool: sqlx::PgPool) {
    use crate::domain::ports::Repository;
    use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
    async fn finish_lease_rollbacks(pool: &sqlx::PgPool) {
        // SQLx queues rollback on transaction Drop. Check out every connection so
        // the next independent request cannot race the preceding lease's release.
        let mut connections = Vec::new();
        for _ in 0..pool.options().get_max_connections() {
            connections.push(pool.acquire().await.expect("finish queued rollback"));
        }
        drop(connections);
    }
    let first = TeamId(Uuid::now_v7());
    let second = TeamId(Uuid::now_v7());
    for (user, email, team) in [
        (
            "macro|synthetic@example.test",
            "synthetic@example.test",
            first,
        ),
        ("macro|other@example.test", "other@example.test", second),
    ] {
        let macro_user_id = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO macro_user(id,username,email,stripe_customer_id) VALUES ($1,$2,$2,$3)",
            macro_user_id,
            email,
            format!("fixture-{macro_user_id}")
        )
        .execute(&pool)
        .await
        .expect("account");
        sqlx::query!(
            r#"INSERT INTO "User"(id,email,macro_user_id) VALUES ($1,$2,$3)"#,
            user,
            email,
            macro_user_id
        )
        .execute(&pool)
        .await
        .expect("user");
        sqlx::query!(
            "INSERT INTO team(id,name,owner_id) VALUES ($1,'Fixture',$2)",
            team.0,
            user
        )
        .execute(&pool)
        .await
        .expect("team");
        sqlx::query!(
            "INSERT INTO team_user(user_id,team_id,team_role) VALUES ($1,$2,'owner')",
            user,
            team.0
        )
        .execute(&pool)
        .await
        .expect("membership");
    }
    let repository = Arc::new(PgRepository::new(pool.clone()).expect("repository capacity"));
    let now = chrono::Utc::now();
    let record = Record {
        user_id: MacroUserIdStr::parse_from_str("macro|synthetic@example.test")
            .expect("identity")
            .into_owned(),
        grants: vec![],
        deleting: false,

        totp_key_id: None,
        revision: 0,
        metadata: ItemMetadata {
            id: ItemId(Uuid::now_v7()),
            team_id: first,
            name: "Synthetic login".into(),
            kind: ItemKind::Login,
            url: None,
            folder_id: None,
            favorite: false,
            version: 1,
            has_totp: false,
            shared: false,
            share_count: 0,
            created_at: now,
            updated_at: now,
            last_used_at: None,
        },
    };
    repository.save(&record, None).await.expect("metadata");
    use crate::domain::{ports::SecretProvider, service::test::fakes::FakeProvider};
    let provider = Arc::new(FakeProvider::new());
    provider
        .write(
            first,
            record.metadata.id,
            0,
            Uuid::now_v7(),
            &SecretValues {
                username: SecretString("synthetic-identifier".into()),
                password: SecretString("protected-password-marker".into()),
                notes: SecretString("protected-notes-marker".into()),
                fields: vec![SecretField {
                    label: "protected-label-marker".into(),
                    value: SecretString("protected-field-marker".into()),
                }],
            },
        )
        .await
        .expect("provider fixture");
    let app: Router = router(PasswordRouterState {
        authorization: MacroAuthorizationState::new(Arc::new(Authorization)),
        service: Arc::new(PasswordService {
            repository: repository.clone(),
            provider: provider.clone(),
            availability: Arc::new(Enabled),
        }),
    });
    let item = record.metadata.id.0;
    let interaction_service = PasswordService {
        repository: repository.clone(),
        provider: provider.clone(),
        availability: Arc::new(Enabled),
    };
    let actor = Actor {
        user_id: record.user_id.clone(),
    };
    interaction_service
        .configure_totp(
            &actor,
            first,
            record.metadata.id,
            Some(SecretString("JBSWY3DPEHPK3PXP".into())),
        )
        .await
        .expect("enrolled verification code fixture");
    for copy in [false, true] {
        finish_lease_rollbacks(&pool).await;
        let started = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        *provider.username_gate.lock().expect("fixture lock") =
            Some((started.clone(), release.clone()));
        let path = if copy {
            format!("/teams/{}/items/{item}/username/copy", first.0)
        } else {
            format!("/teams/{}/items/{item}/username", first.0)
        };
        let request = Request::builder()
            .method(if copy { "POST" } else { "GET" })
            .uri(path)
            .header("authorization", "Bearer session")
            .header("x-macro-passwords", "1")
            .body(Body::empty())
            .expect("request");
        let pending = tokio::spawn(app.clone().oneshot(request));
        started.notified().await;
        let interaction = interaction_service
            .totp(&actor, first, record.metadata.id)
            .await;
        if copy {
            assert!(matches!(interaction, Err(Error::Busy)));
            let busy = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(format!("/teams/{}/items/{item}/reveal", first.0))
                        .header("authorization", "Bearer session")
                        .header("x-macro-passwords", "1")
                        .header("content-type", "application/json")
                        .body(Body::from("{}"))
                        .expect("contending request"),
                )
                .await
                .expect("contention response");
            assert_eq!(busy.status(), StatusCode::CONFLICT);
            let body = to_bytes(busy.into_body(), 1024)
                .await
                .expect("failure body");
            let failure: Failure = serde_json::from_slice(&body).expect("typed failure");
            assert_eq!(failure.code, FailureCode::VaultBusy);
        } else {
            assert_eq!(
                interaction
                    .expect("verification code succeeds while identifier GET is paused")
                    .code
                    .0,
                "123456"
            );
        }
        release.notify_one();
        assert_eq!(
            pending
                .await
                .expect("request task")
                .expect("response")
                .status(),
            StatusCode::OK
        );
        *provider.username_gate.lock().expect("fixture lock") = None;
    }
    for (method, path, expected) in [
        (
            "GET",
            format!("/teams/{}/items/{item}/username", first.0),
            StatusCode::OK,
        ),
        (
            "POST",
            format!("/teams/{}/items/{item}/username/copy", first.0),
            StatusCode::OK,
        ),
        (
            "GET",
            format!("/teams/{}/items/{item}/username", second.0),
            StatusCode::NOT_FOUND,
        ),
        (
            "POST",
            format!("/teams/{}/items/{item}/username/copy", second.0),
            StatusCode::NOT_FOUND,
        ),
    ] {
        finish_lease_rollbacks(&pool).await;
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("authorization", "Bearer session")
                    .header("x-macro-passwords", "1")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), expected);
        assert_eq!(response.headers()[CACHE_CONTROL], "private, no-store");
        let body = to_bytes(response.into_body(), 262144).await.expect("body");
        let json: serde_json::Value = serde_json::from_slice(&body).expect("JSON");
        if expected == StatusCode::OK {
            assert_eq!(
                json,
                serde_json::json!({"username":"synthetic-identifier","version":1})
            );
        }
        for marker in [
            "protected-password-marker",
            "protected-notes-marker",
            "protected-label-marker",
            "protected-field-marker",
        ] {
            assert!(!String::from_utf8_lossy(&body).contains(marker));
        }
    }
    assert!(
        repository
            .activity(first, record.metadata.id)
            .await
            .expect("copy audit")
            .iter()
            .any(|entry| matches!(entry.action, Action::Copy))
    );
    assert_eq!(provider.reads.load(std::sync::atomic::Ordering::SeqCst), 0);
    for path in [
        format!("/teams/{}/items", first.0),
        format!("/teams/{}/items/{item}", first.0),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(path)
                    .header("authorization", "Bearer session")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 262144).await.expect("body");
        let value: serde_json::Value = serde_json::from_slice(&body).expect("JSON");
        let metadata = if value.is_array() { &value[0] } else { &value };
        assert_eq!(metadata["name"], "Synthetic login");
        assert!(metadata.get("values").is_none());
        assert!(metadata.get("password").is_none());
        assert!(metadata.get("totpKeyId").is_none());
    }
    for (path, body, expected) in [
        (
            format!("/teams/{}/items/{item}/share", first.0),
            serde_json::json!({"grants":[{"kind":"team","id":second.0.to_string(),"permission":"view"}]}),
            StatusCode::BAD_REQUEST,
        ),
        (
            format!("/teams/{}/items/{item}/share", first.0),
            serde_json::json!({"grants":[{"kind":"user","id":"macro|other@example.test","permission":"view"}]}),
            StatusCode::NOT_FOUND,
        ),
        (
            format!("/teams/{}/items/{item}/share", second.0),
            serde_json::json!({"grants":[]}),
            StatusCode::NOT_FOUND,
        ),
    ] {
        finish_lease_rollbacks(&pool).await;
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(path)
                    .header("authorization", "Bearer session")
                    .header("x-macro-passwords", "1")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), expected);
        assert_eq!(response.headers()[CACHE_CONTROL], "private, no-store");
    }
    assert!(
        repository
            .get(first, record.metadata.id)
            .await
            .expect("record")
            .grants
            .is_empty()
    );
}

#[tokio::test]
async fn every_route_rejects_verified_internal_and_api_key_headers() {
    for (method, path, body) in routes() {
        for credential_header in ["x-internal-auth-key", "x-macro-user-api-key"] {
            let response = app()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(&path)
                        .header(credential_header, "synthetic-credential")
                        .header("x-macro-passwords", "1")
                        .header("content-type", "application/json")
                        .body(Body::from(body.to_string()))
                        .expect("request"),
                )
                .await
                .expect("response");
            assert!(
                matches!(
                    response.status(),
                    StatusCode::FORBIDDEN | StatusCode::UNAUTHORIZED
                ),
                "{method} {path}: {credential_header}"
            );
            assert_eq!(response.headers()[CACHE_CONTROL], "private, no-store");
        }
    }
}

#[tokio::test]
async fn access_and_lease_contention_have_distinct_typed_failures() {
    for (error, status, code) in [
        (
            Error::Forbidden,
            StatusCode::FORBIDDEN,
            FailureCode::Forbidden,
        ),
        (Error::Busy, StatusCode::CONFLICT, FailureCode::VaultBusy),
        (
            Error::Conflict,
            StatusCode::CONFLICT,
            FailureCode::VersionConflict,
        ),
        (
            Error::NotFound,
            StatusCode::NOT_FOUND,
            FailureCode::NotFound,
        ),
        (
            Error::Invalid,
            StatusCode::BAD_REQUEST,
            FailureCode::InvalidRequest,
        ),
        (
            Error::Unavailable,
            StatusCode::SERVICE_UNAVAILABLE,
            FailureCode::VaultUnavailable,
        ),
    ] {
        let response = ApiError(error).into_response();
        assert_eq!(response.status(), status);
        let bytes = to_bytes(response.into_body(), 1024).await.unwrap();
        let failure: Failure = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(failure.code, code);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes)
                .unwrap()
                .as_object()
                .unwrap()
                .len(),
            1
        );
    }
    assert_eq!(
        serde_json::to_value(Failure {
            code: FailureCode::VaultBusy
        })
        .unwrap()["code"],
        "vault_busy"
    );
    assert_eq!(
        serde_json::to_value(Failure {
            code: FailureCode::VersionConflict
        })
        .unwrap()["code"],
        "version_conflict"
    );
}

#[tokio::test]
async fn lifecycle_routes_reject_human_agent_and_api_credentials_before_any_mutation() {
    use crate::domain::service::test::fakes::FakeRepository;
    let repository = Arc::new(FakeRepository::new());
    let app: Router = internal_router(PasswordRouterState {
        authorization: MacroAuthorizationState::new(Arc::new(Authorization)),
        service: Arc::new(PasswordService {
            repository: repository.clone(),
            provider: Arc::new(UnavailableProvider),
            availability: Arc::new(Disabled),
        }),
    });
    for token in ["session", "api", "key", "agent", "internal"] {
        for (method, path) in [("DELETE", format!("/teams/{}", Uuid::from_u128(1)))] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(path)
                        .header("authorization", format!("Bearer {token}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
            assert_eq!(response.headers()[CACHE_CONTROL], "private, no-store");
        }
    }
    assert!(repository.closed_teams.lock().unwrap().is_empty());
    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/teams/{}", Uuid::from_u128(1)))
                .header("x-internal-auth-key", "synthetic-credential")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        StatusCode::SERVICE_UNAVAILABLE,
        "verified internal callers reach fail-closed lifecycle service"
    );
    let bytes = to_bytes(response.into_body(), 1024).await.unwrap();
    let failure: Failure = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(failure.code, FailureCode::VaultUnavailable);
}

mod admission;
mod capabilities;
