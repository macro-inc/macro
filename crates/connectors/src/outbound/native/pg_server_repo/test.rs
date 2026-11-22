use super::*;
use crate::domain::models::{ConnectorKey, ServerUrl};
use crate::domain::ports::Source;
use crate::outbound::guarded_http::AddressPolicy;
use crate::outbound::guarded_http::McpHttp;
use crate::outbound::native::models::GITHUB_MCP_SERVER_URL;
use crate::outbound::native::ports::OAuthClient;
use crate::outbound::native::source::NativeSource;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use oauth2::basic::BasicTokenType;
use oauth2::{AccessToken, StandardTokenResponse, TokenResponse as _};
use rmcp::transport::auth::VendorExtraTokenFields;
use std::sync::Arc;

const OWNER: &str = "macro|owner@example.com";
const OTHER: &str = "macro|other@example.com";
const WIKI: &str = "https://wiki.example.com/mcp";

fn key(byte: u8) -> AesKey {
    AesKey::try_from(vec![byte; 32]).unwrap()
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

fn granted(token: &str) -> StoredCredentials {
    StoredCredentials::new(
        "client".to_owned(),
        Some(StandardTokenResponse::new(
            AccessToken::new(token.to_owned()),
            BasicTokenType::Bearer,
            VendorExtraTokenFields::default(),
        )),
        Vec::new(),
        None,
    )
}

fn record(owner: &str, url: &str, credentials: Option<StoredCredentials>) -> McpServerRecord {
    McpServerRecord {
        user_id: user(owner),
        url: url.to_owned(),
        server_name: "Wiki".to_owned(),
        credentials,
        enabled: true,
        requires_sign_in: false,
    }
}

fn token(record: &McpServerRecord) -> Option<String> {
    let token = record.credentials.as_ref()?.token_response.as_ref()?;
    Some(token.access_token().secret().to_owned())
}

async fn add_other_user(pool: &PgPool) {
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id)
         VALUES ('019a0000-0000-7000-8000-000000000012', 'other', 'other@example.com', 'other')"
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id)
           VALUES ($1, 'other@example.com', '019a0000-0000-7000-8000-000000000012')"#,
        OTHER
    )
    .execute(pool)
    .await
    .unwrap();
}

/// Credentials round-trip through encryption, and the column never holds
/// them in the clear.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn credentials_are_stored_encrypted(pool: PgPool) {
    let repo = PgServerRepo::new(pool.clone(), key(7));
    repo.save(&record(OWNER, WIKI, Some(granted("secret-token"))))
        .await
        .unwrap();

    let loaded = repo.load(&user(OWNER), WIKI).await.unwrap().unwrap();
    assert_eq!(token(&loaded).as_deref(), Some("secret-token"));

    let stored = sqlx::query_scalar!(
        "SELECT credentials FROM mcp_servers WHERE user_id = $1 AND url = $2",
        OWNER,
        WIKI
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .unwrap();
    assert!(
        !stored
            .windows("secret-token".len())
            .any(|window| window == b"secret-token")
    );

    let wrong_key = PgServerRepo::new(pool, key(8));
    assert!(wrong_key.load(&user(OWNER), WIKI).await.is_err());
}

/// Saving a row without credentials, as adding a server again or toggling
/// it does, keeps the grant it holds.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn saving_without_credentials_keeps_the_grant(pool: PgPool) {
    let repo = PgServerRepo::new(pool, key(7));
    repo.save(&record(OWNER, WIKI, Some(granted("kept"))))
        .await
        .unwrap();

    let mut toggled = record(OWNER, WIKI, None);
    toggled.enabled = false;
    toggled.server_name = "Team wiki".to_owned();
    repo.save(&toggled).await.unwrap();

    let loaded = repo.load(&user(OWNER), WIKI).await.unwrap().unwrap();
    assert!(!loaded.enabled);
    assert_eq!(loaded.server_name, "Team wiki");
    assert_eq!(token(&loaded).as_deref(), Some("kept"));
}

/// Reads and deletes are scoped to the user and the exact stored URL.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn rows_are_scoped_to_their_user(pool: PgPool) {
    add_other_user(&pool).await;
    let repo = PgServerRepo::new(pool, key(7));
    repo.save(&record(OWNER, WIKI, None)).await.unwrap();
    repo.save(&record(OWNER, "https://b.example.com/mcp", None))
        .await
        .unwrap();
    repo.save(&record(OTHER, WIKI, None)).await.unwrap();

    let listed: Vec<_> = repo
        .list(&user(OWNER))
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.url)
        .collect();
    assert_eq!(listed, [WIKI, "https://b.example.com/mcp"]);

    repo.delete(&user(OWNER), WIKI).await.unwrap();
    assert!(repo.load(&user(OWNER), WIKI).await.unwrap().is_none());
    assert!(repo.load(&user(OTHER), WIKI).await.unwrap().is_some());
}

/// Never asked to sign in: the source tests below only read and change rows.
struct NoOAuth;

impl OAuthClient for NoOAuth {
    async fn start_authorization(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _server_url: &str,
        _server_name: &str,
    ) -> anyhow::Result<String> {
        anyhow::bail!("not used")
    }

    async fn exchange_authorization_code(
        &self,
        _code: &str,
        _state: &str,
    ) -> anyhow::Result<McpServerRecord> {
        anyhow::bail!("not used")
    }
}

/// The native source over the real table: each row is its normalized
/// address, GitHub's row is left to the link, and a change lands on the row
/// in its stored spelling.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn the_native_source_reads_and_changes_the_table(pool: PgPool) {
    let repo = Arc::new(PgServerRepo::new(pool, key(7)));
    repo.save(&record(OWNER, &format!("{WIKI}/"), Some(granted("token"))))
        .await
        .unwrap();
    repo.save(&record(OWNER, GITHUB_MCP_SERVER_URL, None))
        .await
        .unwrap();
    let source = NativeSource::new(
        repo.clone(),
        Arc::new(NoOAuth),
        McpHttp::new(AddressPolicy::AnyAddress).unwrap(),
    );
    let wiki = ConnectorKey::Server(ServerUrl::parse(WIKI).unwrap());

    let connections = source.connections(&user(OWNER)).await.unwrap();
    assert_eq!(connections.len(), 1);
    assert_eq!(connections[0].key, wiki);
    assert_eq!(
        connections[0].grant,
        crate::domain::ports::GrantState::Working
    );

    source
        .set_enabled(&user(OWNER), &wiki, false)
        .await
        .unwrap();
    let stored = repo
        .load(&user(OWNER), &format!("{WIKI}/"))
        .await
        .unwrap()
        .unwrap();
    assert!(!stored.enabled);
    assert_eq!(token(&stored).as_deref(), Some("token"));

    source.remove(&user(OWNER), &wiki).await.unwrap();
    let left: Vec<_> = repo
        .list(&user(OWNER))
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.url)
        .collect();
    assert_eq!(left, [GITHUB_MCP_SERVER_URL]);
}

/// A 401 without a token marks a row that holds no grant, and the mark
/// survives a toggle; a row signed in to keeps reading as it is, and signing
/// in clears the mark.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn a_server_needing_sign_in_is_marked_until_signed_in(pool: PgPool) {
    let repo = PgServerRepo::new(pool, key(7));
    let signed_in = "https://signed-in.example.com/mcp";
    repo.save(&record(OWNER, WIKI, None)).await.unwrap();
    repo.save(&record(OWNER, signed_in, Some(granted("kept"))))
        .await
        .unwrap();

    repo.mark_requires_sign_in(&user(OWNER), WIKI)
        .await
        .unwrap();
    repo.mark_requires_sign_in(&user(OWNER), signed_in)
        .await
        .unwrap();

    let mut marked = repo.load(&user(OWNER), WIKI).await.unwrap().unwrap();
    assert!(marked.requires_sign_in);
    assert!(
        !repo
            .load(&user(OWNER), signed_in)
            .await
            .unwrap()
            .unwrap()
            .requires_sign_in
    );

    marked.enabled = false;
    repo.save(&marked).await.unwrap();
    assert!(
        repo.load(&user(OWNER), WIKI)
            .await
            .unwrap()
            .unwrap()
            .requires_sign_in
    );

    // What completing a sign-in saves.
    repo.save(&record(OWNER, WIKI, Some(granted("fresh"))))
        .await
        .unwrap();
    let signed = repo.load(&user(OWNER), WIKI).await.unwrap().unwrap();
    assert!(!signed.requires_sign_in);
    assert_eq!(token(&signed).as_deref(), Some("fresh"));
}
