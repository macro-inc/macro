//! Disposable, in-process signed HTTP proof for the existing human vault routes.
//!
//! Set BOTS_SIGNED_VAULT_PROOF_DIR to a private /tmp/bots-vault-signed.* directory
//! with db-url (fresh migrated PostgreSQL macrodb_proof*), openbao-loopback (host:port)
//! and vault-private.pem. Provision TEAM with the matching public key and
//! ISSUER using infra/local/openbao/bootstrap.py. The test leaves its fixture
//! rows intact.
use super::*;
use crate::{
    domain::{
        agent::{ports::AccessEventSink, service::AgentVaultService},
        ports::SecretProvider,
        service::PasswordService,
    },
    inbound::{
        agent_router::{AgentRouterState, review_router},
        router::{PasswordRouterState, router},
    },
    outbound::{
        agent_directory::NoAgents,
        availability::{LocalPasswordsFlags, PasswordAvailability},
        openbao::OpenBaoProvider,
        postgres::test::support::fixture_team,
    },
};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use chrono::Utc;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use macro_authorization::{
    InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedCredential,
};
use model_user::UserContext;
use rootcause::Report;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{path::Path, sync::Arc};
use tower::ServiceExt;
use url::Url;

const ISSUER: &str = "macro-bots-signed-proof";
const TEAM: &str = "019b0000-0000-7000-8000-0000000000a1";
const ORIGINAL: &str = "fixture-value-original";
const REPLACEMENT: &str = "fixture-value-replaced";

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String,
    iss: String,
    aud: String,
    exp: i64,
}

#[derive(Clone)]
struct FixtureSigningKey(String);

impl FixtureSigningKey {
    fn new() -> Self {
        Self(format!("{}{}", Uuid::new_v4(), Uuid::new_v4()))
    }

    fn sign(&self, subject: &MacroUserIdStr<'_>) -> String {
        encode(
            &Header::new(Algorithm::HS256),
            &Claims {
                sub: subject.to_string(),
                iss: ISSUER.into(),
                aud: "passwords-http-proof".into(),
                exp: Utc::now().timestamp() + 60,
            },
            &EncodingKey::from_secret(self.0.as_bytes()),
        )
        .expect("sign isolated session")
    }
}

impl JwtValidator for FixtureSigningKey {
    fn validate_credential(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_issuer(&[ISSUER]);
        validation.set_audience(&["passwords-http-proof"]);
        let claims = decode::<Claims>(
            jwt,
            &DecodingKey::from_secret(self.0.as_bytes()),
            &validation,
        )
        .map_err(|_| Report::new(MacroAuthorizationError::InvalidCredentials))?
        .claims;

        Ok(ValidatedCredential::session(UserContext {
            user_id: claims.sub,
            fusion_user_id: String::new(),
            organization_id: None,
            permissions: None,
        }))
    }
}

struct NoDelivery;

#[async_trait::async_trait]
impl AccessEventSink for NoDelivery {
    async fn deliver(&self, _: &crate::domain::agent::ports::AccessEvent) -> Result<(), Error> {
        Err(Error::Unavailable)
    }
}

fn fixture_file(dir: &Path, name: &str) -> String {
    std::fs::read_to_string(dir.join(name)).expect("private fixture file")
}

fn loopback_endpoint(value: &str, scheme: &str) -> Url {
    let url = Url::parse(value.trim()).expect("local fixture URL");
    assert_eq!(url.scheme(), scheme);
    assert!(url.host_str() == Some("127.0.0.1") && url.port().is_some());
    assert!(url.query().is_none() && url.fragment().is_none());
    url
}

async fn call(
    app: &Router,
    method: &str,
    path: &str,
    token: &str,
    body: Value,
    expected: StatusCode,
) -> Value {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header(header::AUTHORIZATION, format!("Bearer {token}"));
    if !body.is_null() {
        request = request
            .header("x-macro-passwords", "1")
            .header(header::CONTENT_TYPE, "application/json");
    }
    let response = app
        .clone()
        .oneshot(
            request
                .body(if body.is_null() {
                    Body::empty()
                } else {
                    Body::from(body.to_string())
                })
                .expect("proof request"),
        )
        .await
        .expect("proof response");
    assert_eq!(response.status(), expected, "unexpected {method} result");
    if expected.is_success() {
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "private, no-store"
        );
    }

    let bytes = to_bytes(response.into_body(), 128 * 1024)
        .await
        .expect("bounded proof response");
    for marker in [ORIGINAL, REPLACEMENT] {
        assert!(
            !bytes
                .windows(marker.len())
                .any(|window| window == marker.as_bytes())
        );
    }
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

fn write(operation: Uuid, version: Option<i32>, value: &str) -> Value {
    json!({
        "operationId": operation,
        "expectedVersion": version,
        "name": "Signed fixture item",
        "kind": "login",
        "private": true,
        "favorite": false,
        "values": {"username": "", "password": value, "notes": "", "fields": []}
    })
}

#[tokio::test]
#[ignore = "requires a newly migrated disposable loopback PostgreSQL and team OpenBao fixture"]
async fn signed_local_vault_and_existing_item_access() {
    let dir = std::env::var_os("BOTS_SIGNED_VAULT_PROOF_DIR").expect("isolated fixture directory");
    let dir = Path::new(&dir);
    assert!(
        dir.parent() == Some(Path::new("/tmp"))
            && dir
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("bots-vault-signed."))
    );
    let db = loopback_endpoint(&fixture_file(dir, "db-url"), "postgres");
    assert!(matches!(db.path(), "/macrodb" | "/macrodb_proof"));
    let vault_url = format!("http://{}", fixture_file(dir, "openbao-loopback").trim());
    loopback_endpoint(&vault_url, "http");
    let pool = PgPool::connect(db.as_str())
        .await
        .expect("isolated database");
    let team = TeamId(Uuid::parse_str(TEAM).expect("fixture team"));
    let owner = fixture_team(&pool, team).await;
    let viewer = account(&pool, "macro|vault-viewer@example.test", false).await;
    add_member(&pool, team, &viewer).await;
    let agent = account(&pool, "macro|vault-agent@example.test", true).await;

    let repo = Arc::new(PgRepository::new(pool).expect("configured repository"));
    let provider = Arc::new(
        OpenBaoProvider::new(
            vault_url,
            ISSUER.into(),
            &fixture_file(dir, "vault-private.pem"),
        )
        .expect("isolated OpenBao"),
    );
    let flags = Arc::new(PasswordAvailability {
        flags: LocalPasswordsFlags,
        provider_configured: true,
    });
    let vault = Arc::new(PasswordService {
        repository: repo.clone(),
        provider: provider.clone(),
        availability: flags.clone(),
    });
    let signing = FixtureSigningKey::new();
    let owner_token = signing.sign(&owner.user_id);
    let viewer_token = signing.sign(&viewer);
    let authorization = MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
        signing.clone(),
        InternalAuthConfig {
            api_key: Uuid::new_v4().to_string(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    )));
    let app: Router = Router::new().nest(
        "/passwords",
        router(PasswordRouterState {
            authorization: authorization.clone(),
            service: vault.clone(),
        })
        .merge(review_router(AgentRouterState {
            authorization,
            service: Arc::new(AgentVaultService {
                vault,
                agents: repo.clone(),
                directory: Arc::new(NoAgents),
                availability: flags,
                events: Arc::new(NoDelivery),
                clock: Arc::new(Utc::now),
            }),
        })),
    );

    let items_path = format!("/passwords/teams/{}/items", team.0);
    let operation = Uuid::now_v7();
    let item = ItemId(operation);
    let detail_path = format!("{items_path}/{}", item.0);
    let untrusted = FixtureSigningKey::new().sign(&owner.user_id);
    call(
        &app,
        "GET",
        &items_path,
        &untrusted,
        Value::Null,
        StatusCode::UNAUTHORIZED,
    )
    .await;
    let absent = call(
        &app,
        "GET",
        &items_path,
        &owner_token,
        Value::Null,
        StatusCode::OK,
    )
    .await;
    assert_eq!(absent, json!([]));
    let created = call(
        &app,
        "POST",
        &items_path,
        &owner_token,
        write(operation, None, ORIGINAL),
        StatusCode::OK,
    )
    .await;
    assert_eq!(created["id"], json!(item.0));
    assert_eq!(created["version"], 1);
    call(
        &app,
        "GET",
        &detail_path,
        &viewer_token,
        Value::Null,
        StatusCode::NOT_FOUND,
    )
    .await;

    let updated = call(
        &app,
        "PUT",
        &detail_path,
        &owner_token,
        write(Uuid::now_v7(), Some(1), REPLACEMENT),
        StatusCode::OK,
    )
    .await;
    assert_eq!(updated["version"], 2);
    let stored = provider
        .read(team, item, 2)
        .await
        .expect("committed version");
    assert!(stored.password.0 == REPLACEMENT);
    call(
        &app,
        "PUT",
        &detail_path,
        &owner_token,
        write(Uuid::now_v7(), Some(1), ORIGINAL),
        StatusCode::CONFLICT,
    )
    .await;
    let patch = json!({
        "name":"Renamed signed fixture",
        "kind":"login",
        "favorite":false,
        "expectedVersion":2
    });
    let patched = call(
        &app,
        "PATCH",
        &detail_path,
        &owner_token,
        patch.clone(),
        StatusCode::OK,
    )
    .await;
    assert_eq!(patched["version"], 2);
    let detail = call(
        &app,
        "GET",
        &detail_path,
        &owner_token,
        Value::Null,
        StatusCode::OK,
    )
    .await;
    assert_eq!(detail["name"], "Renamed signed fixture");
    let catalog = call(
        &app,
        "GET",
        &items_path,
        &owner_token,
        Value::Null,
        StatusCode::OK,
    )
    .await;
    let rows = catalog.as_array().expect("item catalog");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["id"], json!(item.0));
    let wrong_team = detail_path.replace(TEAM, &Uuid::new_v4().to_string());
    call(
        &app,
        "GET",
        &wrong_team,
        &owner_token,
        Value::Null,
        StatusCode::NOT_FOUND,
    )
    .await;

    call(
        &app,
        "PUT",
        &format!("{detail_path}/share"),
        &owner_token,
        json!({"grants":[{"kind":"user","id":viewer.as_ref(),"permission":"view"}]}),
        StatusCode::NO_CONTENT,
    )
    .await;
    let view = call(
        &app,
        "GET",
        &detail_path,
        &viewer_token,
        Value::Null,
        StatusCode::OK,
    )
    .await;
    assert_eq!(view["canEdit"], false);
    call(
        &app,
        "PATCH",
        &detail_path,
        &viewer_token,
        patch,
        StatusCode::NOT_FOUND,
    )
    .await;

    let record = repo.get(team, item).await.expect("stored item");
    let RequestOutcome::Created(_) = repo
        .request(request(&record, &agent, LIMITS))
        .await
        .expect("seed one legitimate existing-item request")
    else {
        panic!("expected pending request");
    };
    let review_path = format!("/passwords/teams/{}/agent-access-requests", team.0);
    let pending = call(
        &app,
        "GET",
        &review_path,
        &owner_token,
        Value::Null,
        StatusCode::OK,
    )
    .await;
    let invisible = call(
        &app,
        "GET",
        &review_path,
        &viewer_token,
        Value::Null,
        StatusCode::OK,
    )
    .await;
    assert_eq!(invisible["requests"], json!([]));
    let row = &pending["requests"][0];
    assert_eq!(row["itemId"], json!(item.0));
    assert!(row["agentAccountId"] == agent.as_ref());
    let id = row["requestId"].as_str().expect("request id");
    let resolve_path = format!("{detail_path}/agent-access-requests/{id}/resolve");
    let approve = json!({"decision":"approve","revision":row["revision"],"permission":"view"});
    call(
        &app,
        "POST",
        &resolve_path,
        &viewer_token,
        approve.clone(),
        StatusCode::FORBIDDEN,
    )
    .await;
    let granted = call(
        &app,
        "POST",
        &resolve_path,
        &owner_token,
        approve.clone(),
        StatusCode::OK,
    )
    .await;
    assert_eq!(granted["status"], "approved");
    call(
        &app,
        "POST",
        &resolve_path,
        &owner_token,
        approve,
        StatusCode::CONFLICT,
    )
    .await;
    let managed_path = format!("{review_path}?itemId={}", item.0);
    let managed = call(
        &app,
        "GET",
        &managed_path,
        &owner_token,
        Value::Null,
        StatusCode::OK,
    )
    .await;
    assert_eq!(managed["requests"][0]["access"]["grantPermission"], "view");
    let account: String = url::form_urlencoded::byte_serialize(agent.as_ref().as_bytes()).collect();
    let revoked = call(
        &app,
        "POST",
        &format!("{detail_path}/agents/{account}/revoke"),
        &owner_token,
        json!({
            "scope":"grant_and_approval",
            "expectedPermissionRevision":managed["requests"][0]["access"]["permissionRevision"]
        }),
        StatusCode::OK,
    )
    .await;
    assert_eq!(revoked["status"], "request_access");
    assert!(revoked["grantPermission"].is_null());
    let RequestOutcome::Created(reopened) = repo
        .request(request(&record, &agent, LIMITS))
        .await
        .expect("seed a second existing-item request")
    else {
        panic!("expected a new pending request after revoke");
    };
    let reopened = reopened.request.expect("pending request");
    let denied = call(
        &app,
        "POST",
        &format!(
            "{detail_path}/agent-access-requests/{}/resolve",
            reopened.id
        ),
        &owner_token,
        json!({"decision":"deny","revision":reopened.revision}),
        StatusCode::OK,
    )
    .await;
    assert_eq!(denied["status"], "denied");
    println!("Signed repository vault create/read/update and scoped human review passed.");
}
