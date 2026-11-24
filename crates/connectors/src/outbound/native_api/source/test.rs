//! The source over the real table, a stand-in for Autodesk's token endpoint
//! and API (wiremock), envelopes from a fake KMS, and sign-ins in memory.

use super::*;
use crate::outbound::native_api::app::ApiApp;
use crate::outbound::native_api::cipher::test::fake_cipher;
use crate::outbound::native_api::pending::MemoryPendingSignIns;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike as _;
use sqlx::PgPool;
use url::Url;
use wiremock::matchers::{body_string_contains, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const OWNER: &str = "macro|owner@example.com";
const TOKEN_PATH: &str = "/authentication/v2/token";
const HUBS_PATH: &str = "/project/v1/hubs";

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(OWNER).unwrap().into_owned()
}

fn autodesk() -> ConnectorId {
    ConnectorId::parse("autodesk").unwrap()
}

fn autodesk_key() -> ConnectorKey {
    ConnectorKey::App(autodesk())
}

struct World {
    source: NativeApiSource,
    repo: ApiAppRepo,
    cipher: GrantCipher,
    pending: Arc<MemoryPendingSignIns>,
    server: MockServer,
}

impl World {
    async fn new(pool: PgPool) -> Self {
        let server = MockServer::start().await;
        let client = OAuthClient::new(
            ApiApp::autodesk_at(Url::parse(&server.uri()).unwrap()).unwrap(),
            "client".to_owned(),
            Zeroizing::new("secret".to_owned()),
            Url::parse("https://cognition.example.com/connectors/apps/auth/callback").unwrap(),
        )
        .unwrap();
        let repo = ApiAppRepo::new(pool);
        let cipher = fake_cipher();
        let pending = Arc::new(MemoryPendingSignIns::default());
        let source = NativeApiSource::new(
            vec![client],
            repo.clone(),
            cipher.clone(),
            pending.clone() as Arc<dyn PendingSignIns>,
        )
        .unwrap();

        Self {
            source,
            repo,
            cipher,
            pending,
            server,
        }
    }

    /// The owner holds a grant whose access token expires at `expires_at`.
    async fn holding(&self, access: &str, refresh: &str, expires_at: DateTime<Utc>) {
        let grant = Grant {
            access_token: Zeroizing::new(access.to_owned()),
            refresh_token: Zeroizing::new(refresh.to_owned()),
        };
        let sealed = self
            .cipher
            .encrypt(&owner(), &autodesk(), &grant)
            .await
            .unwrap();
        self.repo
            .store(&NewGrant {
                user: &owner(),
                app: "autodesk",
                name: "Autodesk",
                access_expires_at: expires_at,
                grant: &sealed,
            })
            .await
            .unwrap();
    }

    async fn stored_grant(&self) -> Grant {
        let row = self.repo.get(&owner(), "autodesk").await.unwrap().unwrap();
        self.cipher
            .decrypt(&owner(), &autodesk(), &row.grant)
            .await
            .unwrap()
    }

    async fn api(&self) -> Arc<dyn ApiConnection> {
        let connections = self.source.connections(&owner()).await.unwrap();
        connections.into_iter().next().unwrap().api.unwrap()
    }

    fn hubs_url(&self) -> String {
        format!("{}{HUBS_PATH}", self.server.uri())
    }

    /// Autodesk answers a refresh of `refresh` with `answer`.
    async fn refresh_answers(&self, refresh: &str, answer: ResponseTemplate, times: u64) {
        Mock::given(method("POST"))
            .and(path(TOKEN_PATH))
            .and(body_string_contains("grant_type=refresh_token"))
            .and(body_string_contains(format!("refresh_token={refresh}")))
            .respond_with(answer)
            .expect(times)
            .mount(&self.server)
            .await;
    }

    /// Autodesk's hubs listing answers a call with `bearer`.
    async fn hubs_answer(&self, bearer: &str, times: u64) {
        Mock::given(method("GET"))
            .and(path(HUBS_PATH))
            .and(header("authorization", format!("Bearer {bearer}")))
            .respond_with(ResponseTemplate::new(200).set_body_string(r#"{"data":[]}"#))
            .expect(times)
            .mount(&self.server)
            .await;
    }
}

fn get(url: String) -> ApiRequest {
    ApiRequest {
        method: http::Method::GET,
        url,
        headers: http::HeaderMap::new(),
        body: None,
    }
}

fn soon() -> DateTime<Utc> {
    Utc::now() + chrono::Duration::minutes(1)
}

fn later() -> DateTime<Utc> {
    Utc::now() + chrono::Duration::hours(1)
}

fn refusal(report: &Report) -> Option<SourceRefusal> {
    report.downcast_current_context::<SourceRefusal>().cloned()
}

fn tokens(access: &str, refresh: &str) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_json(serde_json::json!({
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "Bearer",
        "expires_in": 3599,
    }))
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn connecting_sends_the_user_to_consent_and_the_callback_stores_the_grant(pool: PgPool) {
    let world = World::new(pool).await;

    let ConnectStep::OpenUrl(consent) = world
        .source
        .start_connect(&owner(), &autodesk_key())
        .await
        .unwrap()
    else {
        panic!("Autodesk connects on its consent page");
    };
    assert_eq!(consent.path(), "/authentication/v2/authorize");
    let query: std::collections::HashMap<_, _> = consent.query_pairs().into_owned().collect();
    let state = query["state"].clone();
    assert_eq!(query["code_challenge_method"], "S256");

    // Until the callback runs there is nothing to record.
    let early = world
        .source
        .complete_connect(&owner(), &autodesk())
        .await
        .unwrap_err();
    assert_eq!(
        refusal(&early),
        Some(SourceRefusal::NotFound(autodesk_key()))
    );

    Mock::given(method("POST"))
        .and(path(TOKEN_PATH))
        .and(body_string_contains("grant_type=authorization_code"))
        .and(body_string_contains("code=code-1"))
        .and(body_string_contains("code_verifier="))
        .respond_with(tokens("access-1", "refresh-1"))
        .expect(1)
        .mount(&world.server)
        .await;
    let (user, app) = world.source.complete("code-1", &state).await.unwrap();
    assert_eq!(user, owner());
    assert_eq!(app, autodesk());

    let connection = world
        .source
        .complete_connect(&owner(), &autodesk())
        .await
        .unwrap();
    assert_eq!(connection.key, autodesk_key());
    assert_eq!(connection.name, "Autodesk");
    assert_eq!(connection.grant, GrantState::Working);
    assert!(connection.mcp.is_none());
    assert!(connection.api.is_some());
    let stored = world.stored_grant().await;
    assert_eq!(stored.access_token.as_str(), "access-1");
    assert_eq!(stored.refresh_token.as_str(), "refresh-1");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn a_sign_in_state_is_spent_once(pool: PgPool) {
    let world = World::new(pool).await;
    world
        .pending
        .save(
            "state-1",
            &PendingSignIn {
                user: OWNER.to_owned(),
                app: "autodesk".to_owned(),
                verifier: "verifier".to_owned(),
            },
        )
        .await
        .unwrap();
    Mock::given(method("POST"))
        .and(path(TOKEN_PATH))
        .respond_with(tokens("access-1", "refresh-1"))
        .expect(1)
        .mount(&world.server)
        .await;

    world.source.complete("code-1", "state-1").await.unwrap();

    assert!(world.source.complete("code-1", "state-1").await.is_err());
    assert!(
        world
            .source
            .complete("code-1", "never-issued")
            .await
            .is_err()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn a_call_stamps_the_bearer_in_place_of_any_the_caller_sent(pool: PgPool) {
    let world = World::new(pool).await;
    world.holding("access-1", "refresh-1", later()).await;
    world.hubs_answer("access-1", 1).await;

    let mut request = get(world.hubs_url());
    request.headers.insert(
        http::header::AUTHORIZATION,
        http::HeaderValue::from_static("Bearer someone-elses"),
    );
    let response = world.api().await.call(request).await.unwrap();

    assert_eq!(response.status, http::StatusCode::OK);
    assert_eq!(response.body, r#"{"data":[]}"#);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn an_expiring_token_is_refreshed_once_and_the_rotated_refresh_token_kept(pool: PgPool) {
    let world = World::new(pool).await;
    world.holding("access-1", "refresh-1", soon()).await;
    world
        .refresh_answers("refresh-1", tokens("access-2", "refresh-2"), 1)
        .await;
    world.hubs_answer("access-2", 2).await;
    let api = world.api().await;

    api.call(get(world.hubs_url())).await.unwrap();
    api.call(get(world.hubs_url())).await.unwrap();

    let stored = world.stored_grant().await;
    assert_eq!(stored.access_token.as_str(), "access-2");
    assert_eq!(stored.refresh_token.as_str(), "refresh-2");
    let row = world.repo.get(&owner(), "autodesk").await.unwrap().unwrap();
    assert!(row.access_expires_at > Utc::now() + chrono::Duration::minutes(50));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn a_refused_refresh_token_needs_reauth_until_the_user_signs_in_again(pool: PgPool) {
    let world = World::new(pool).await;
    world.holding("access-1", "dead", soon()).await;
    world
        .refresh_answers(
            "dead",
            ResponseTemplate::new(400).set_body_json(serde_json::json!({
                "error": "invalid_grant",
                "error_description": "The refresh token is invalid or expired.",
            })),
            1,
        )
        .await;
    world.hubs_answer("access-1", 0).await;
    let api = world.api().await;

    let first = api.call(get(world.hubs_url())).await.unwrap_err();
    assert_eq!(
        refusal(&first),
        Some(SourceRefusal::NeedsReauth(autodesk_key()))
    );

    // The vendor is not asked again, and the listing shows it.
    let second = api.call(get(world.hubs_url())).await.unwrap_err();
    assert_eq!(
        refusal(&second),
        Some(SourceRefusal::NeedsReauth(autodesk_key()))
    );
    let listed = world.source.connections(&owner()).await.unwrap();
    assert_eq!(listed[0].grant, GrantState::Dead);
    let pending = world
        .source
        .complete_connect(&owner(), &autodesk())
        .await
        .unwrap_err();
    assert_eq!(
        refusal(&pending),
        Some(SourceRefusal::NotFound(autodesk_key()))
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn a_token_endpoint_outage_is_not_a_dead_grant(pool: PgPool) {
    let world = World::new(pool).await;
    world.holding("access-1", "refresh-1", soon()).await;
    world
        .refresh_answers("refresh-1", ResponseTemplate::new(503), 1)
        .await;

    let error = world
        .api()
        .await
        .call(get(world.hubs_url()))
        .await
        .unwrap_err();

    assert_eq!(refusal(&error), None);
    let row = world.repo.get(&owner(), "autodesk").await.unwrap().unwrap();
    assert!(!row.needs_reauth);
    assert_eq!(
        world.stored_grant().await.refresh_token.as_str(),
        "refresh-1"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn a_call_to_another_host_is_refused_before_anything_is_sent(pool: PgPool) {
    let world = World::new(pool).await;
    world.holding("access-1", "refresh-1", soon()).await;
    let api = world.api().await;

    for url in [
        "https://developer.api.autodesk.com/project/v1/hubs".to_owned(),
        "https://attacker.example.com/collect".to_owned(),
        HUBS_PATH.to_owned(),
    ] {
        assert!(api.call(get(url)).await.is_err());
    }

    // Not even a refresh went out.
    assert!(world.server.received_requests().await.unwrap().is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn removing_deletes_the_row_and_revokes_the_refresh_token(pool: PgPool) {
    let world = World::new(pool).await;
    world.holding("access-1", "refresh-1", later()).await;
    Mock::given(method("POST"))
        .and(path("/authentication/v2/revoke"))
        .and(body_string_contains("token=refresh-1"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&world.server)
        .await;

    world
        .source
        .remove(&owner(), &autodesk_key())
        .await
        .unwrap();

    assert!(world.source.connections(&owner()).await.unwrap().is_empty());
    let again = world
        .source
        .remove(&owner(), &autodesk_key())
        .await
        .unwrap_err();
    assert_eq!(
        refusal(&again),
        Some(SourceRefusal::NotFound(autodesk_key()))
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn a_failed_revoke_still_removes_the_row(pool: PgPool) {
    let world = World::new(pool).await;
    world.holding("access-1", "refresh-1", later()).await;
    Mock::given(method("POST"))
        .and(path("/authentication/v2/revoke"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&world.server)
        .await;

    world
        .source
        .remove(&owner(), &autodesk_key())
        .await
        .unwrap();

    assert!(
        world
            .repo
            .get(&owner(), "autodesk")
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn the_user_can_turn_it_off_and_rename_it(pool: PgPool) {
    let world = World::new(pool).await;
    world.holding("access-1", "refresh-1", later()).await;

    world
        .source
        .set_enabled(&owner(), &autodesk_key(), false)
        .await
        .unwrap();
    world
        .source
        .rename(&owner(), &autodesk_key(), "  Studio  ")
        .await
        .unwrap();

    let listed = world.source.connections(&owner()).await.unwrap();
    assert!(!listed[0].enabled);
    assert_eq!(listed[0].name, "Studio");
    assert!(world.source.holders(&autodesk()).await.unwrap().is_empty());
    let empty = world
        .source
        .rename(&owner(), &autodesk_key(), " ")
        .await
        .unwrap_err();
    assert_eq!(refusal(&empty), Some(SourceRefusal::EmptyName));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn it_serves_only_its_configured_apps(pool: PgPool) {
    let world = World::new(pool).await;
    let notion = ConnectorId::parse("notion").unwrap();

    assert_eq!(
        world.source.supports(&autodesk()).await.unwrap(),
        Some(Surfaces::new(false, true))
    );
    assert_eq!(world.source.supports(&notion).await.unwrap(), None);
    let refused = world
        .source
        .start_connect(&owner(), &ConnectorKey::App(notion.clone()))
        .await
        .unwrap_err();
    assert_eq!(
        refusal(&refused),
        Some(SourceRefusal::Unsupported(ConnectorKey::App(notion)))
    );
}
