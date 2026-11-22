use super::*;
use crate::outbound::guarded_http::AddressPolicy;
use crate::outbound::native::memory_store::MemoryStore;
use crate::outbound::native::models::StoredCredentials;
use macro_user_id::cowlike::CowLike;
use oauth2::basic::BasicTokenType;
use oauth2::{AccessToken, RefreshToken, StandardTokenResponse};
use rmcp::transport::auth::VendorExtraTokenFields;
use std::sync::Mutex;

const WIKI: &str = "https://wiki.example.com/mcp";
const AUTHORIZE: &str = "https://auth.example.com/authorize?state=abc";

/// Records each sign-in it is asked to start, and completes every callback
/// with a grant for [`WIKI`].
#[derive(Default)]
struct FakeOAuth {
    started: Mutex<Vec<(String, String)>>,
}

impl OAuthClient for FakeOAuth {
    async fn start_authorization(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        server_url: &str,
        server_name: &str,
    ) -> anyhow::Result<String> {
        self.started
            .lock()
            .unwrap()
            .push((server_url.to_owned(), server_name.to_owned()));
        Ok(AUTHORIZE.to_owned())
    }

    async fn exchange_authorization_code(
        &self,
        _code: &str,
        _state: &str,
    ) -> anyhow::Result<McpServerRecord> {
        Ok(McpServerRecord {
            credentials: Some(granted("fresh")),
            ..row(WIKI, true)
        })
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned()
}

fn row(url: &str, enabled: bool) -> McpServerRecord {
    McpServerRecord {
        user_id: user(),
        url: url.to_owned(),
        server_name: "Wiki".to_owned(),
        credentials: None,
        enabled,
        requires_sign_in: false,
    }
}

/// A finished grant with a token of unknown expiry, which is handed out
/// without a refresh.
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

/// A grant whose access token expired an hour ago, with `refresh` to
/// refresh it, if any.
fn expired(refresh: Option<&str>) -> StoredCredentials {
    let mut token = StandardTokenResponse::new(
        AccessToken::new("old".to_owned()),
        BasicTokenType::Bearer,
        VendorExtraTokenFields::default(),
    );
    token.set_expires_in(Some(&std::time::Duration::from_secs(60)));
    token.set_refresh_token(refresh.map(|refresh| RefreshToken::new(refresh.to_owned())));
    let received_at = crate::outbound::native::server_access::now_epoch_secs() - 3600;
    StoredCredentials::new(
        "client".to_owned(),
        Some(token),
        Vec::new(),
        Some(received_at),
    )
}

/// A client registered for a sign-in that never finished.
fn unfinished() -> StoredCredentials {
    StoredCredentials::new("client".to_owned(), None, Vec::new(), None)
}

fn server(url: &str) -> ConnectorKey {
    ConnectorKey::Server(ServerUrl::parse(url).unwrap())
}

struct Fixture {
    store: Arc<MemoryStore>,
    oauth: Arc<FakeOAuth>,
    source: NativeSource<MemoryStore, FakeOAuth>,
}

fn holding(rows: Vec<McpServerRecord>) -> Fixture {
    let store = Arc::new(MemoryStore::holding(rows));
    let oauth = Arc::new(FakeOAuth::default());
    let source = NativeSource::new(
        store.clone(),
        oauth.clone(),
        McpHttp::new(AddressPolicy::AnyAddress).unwrap(),
    );
    Fixture {
        store,
        oauth,
        source,
    }
}

fn refusal(error: &Report) -> Option<&SourceRefusal> {
    error.downcast_current_context::<SourceRefusal>()
}

/// Every row is reported as its server's address, normalized; the resolver
/// decides which addresses are apps.
#[tokio::test]
async fn every_row_is_its_servers_address() {
    let fixture = holding(vec![
        McpServerRecord {
            credentials: Some(granted("token")),
            ..row("https://mcp.linear.app/mcp/", true)
        },
        row(WIKI, false),
    ]);

    let connections = fixture.source.connections(&user()).await.unwrap();

    let keys: Vec<_> = connections.iter().map(|c| c.key.clone()).collect();
    assert_eq!(keys, [server("https://mcp.linear.app/mcp"), server(WIKI)]);
    assert!(connections.iter().all(|c| c.source == SourceKind::Native));
    assert_eq!(connections[0].source_id, "https://mcp.linear.app/mcp/");
    assert!(connections[0].enabled);
    assert!(!connections[1].enabled);
}

/// A row's grant, from what the row shows: a finished grant works, a
/// sign-in that never finished or an expired token with nothing to refresh
/// it is dead, and a row never signed in to holds none, unless its server
/// answered 401 without a token: that one is dead until signed in.
#[tokio::test]
async fn a_rows_grant_is_read_from_the_row() {
    let fixture = holding(vec![
        McpServerRecord {
            credentials: Some(granted("token")),
            ..row("https://a.example.com/mcp", true)
        },
        McpServerRecord {
            credentials: Some(unfinished()),
            ..row("https://b.example.com/mcp", true)
        },
        row("https://c.example.com/mcp", true),
        McpServerRecord {
            credentials: Some(expired(None)),
            ..row("https://d.example.com/mcp", true)
        },
        McpServerRecord {
            credentials: Some(expired(Some("refresh"))),
            ..row("https://e.example.com/mcp", true)
        },
        McpServerRecord {
            requires_sign_in: true,
            ..row("https://f.example.com/mcp", true)
        },
        McpServerRecord {
            credentials: Some(granted("token")),
            requires_sign_in: true,
            ..row("https://g.example.com/mcp", true)
        },
    ]);

    let grants: Vec<_> = fixture
        .source
        .connections(&user())
        .await
        .unwrap()
        .iter()
        .map(|c| c.grant)
        .collect();
    assert_eq!(
        grants,
        [
            GrantState::Working,
            GrantState::Dead,
            GrantState::Missing,
            GrantState::Dead,
            GrantState::Working,
            GrantState::Dead,
            GrantState::Working
        ]
    );
}

/// Native provides MCP, never an API (rule 6), and serves no catalog app by
/// slug.
#[tokio::test]
async fn native_provides_mcp_and_never_an_api() {
    let fixture = holding(vec![row(WIKI, true)]);

    let connections = fixture.source.connections(&user()).await.unwrap();
    assert!(connections[0].mcp.is_some());
    assert!(connections[0].api.is_none());

    let linear = ConnectorId::parse("linear").unwrap();
    assert_eq!(fixture.source.supports(&linear).await.unwrap(), None);
    assert!(fixture.source.holders(&linear).await.unwrap().is_empty());
}

/// GitHub's row belongs to the account link source, in any spelling.
#[tokio::test]
async fn githubs_address_is_left_to_the_link() {
    let fixture = holding(vec![
        McpServerRecord {
            credentials: Some(granted("token")),
            ..row(&format!("{GITHUB_MCP_SERVER_URL}/"), true)
        },
        row(WIKI, true),
    ]);

    let keys: Vec<_> = fixture
        .source
        .connections(&user())
        .await
        .unwrap()
        .into_iter()
        .map(|c| c.key)
        .collect();
    assert_eq!(keys, [server(WIKI)]);

    let error = fixture
        .source
        .start_connect(&user(), &server(GITHUB_MCP_SERVER_URL))
        .await
        .unwrap_err();
    assert!(matches!(
        refusal(&error),
        Some(SourceRefusal::Unsupported(_))
    ));
}

#[tokio::test]
async fn another_users_rows_are_not_listed() {
    let other = MacroUserIdStr::parse_from_str("macro|other@example.com")
        .unwrap()
        .into_owned();
    let fixture = holding(vec![McpServerRecord {
        user_id: other,
        ..row(WIKI, true)
    }]);

    assert!(
        fixture
            .source
            .connections(&user())
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn a_user_adds_a_server_enabled_and_not_signed_in() {
    let fixture = holding(Vec::new());
    let url = ServerUrl::parse("http://localhost:9000/mcp").unwrap();

    let added = fixture
        .source
        .add_server(&user(), &url, " Local ", AddedBy::User)
        .await
        .unwrap();

    assert_eq!(added.key, ConnectorKey::Server(url));
    assert_eq!(added.name, "Local");
    assert!(added.enabled);
    assert_eq!(added.grant, GrantState::Missing);
    assert_eq!(fixture.store.rows().len(), 1);
}

/// Adding a URL the user already has, in another spelling, returns the
/// stored row with its grant untouched.
#[tokio::test]
async fn adding_a_held_url_keeps_its_grant() {
    let fixture = holding(vec![McpServerRecord {
        credentials: Some(granted("token")),
        ..row(&format!("{WIKI}/"), false)
    }]);

    let added = fixture
        .source
        .add_server(
            &user(),
            &ServerUrl::parse(WIKI).unwrap(),
            "Other",
            AddedBy::User,
        )
        .await
        .unwrap();

    assert_eq!(added.grant, GrantState::Working);
    assert!(!added.enabled);
    assert_eq!(added.name, "Wiki");
    let rows = fixture.store.rows();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].url, format!("{WIKI}/"));
}

/// Macro connects to what an agent adds, so an agent may only add public
/// `https` servers.
#[tokio::test]
async fn an_agent_may_only_add_public_https() {
    let fixture = holding(Vec::new());

    for url in [
        "http://wiki.example.com/mcp",
        "https://localhost/mcp",
        "https://10.0.0.5/mcp",
        "https://db.internal/mcp",
    ] {
        let url = ServerUrl::parse(url).unwrap();
        let error = fixture
            .source
            .add_server(&user(), &url, "Wiki", AddedBy::Agent)
            .await
            .unwrap_err();
        assert_eq!(refusal(&error), Some(&SourceRefusal::NonPublic(url)));
    }
    assert!(fixture.store.rows().is_empty());

    fixture
        .source
        .add_server(
            &user(),
            &ServerUrl::parse(WIKI).unwrap(),
            "Wiki",
            AddedBy::Agent,
        )
        .await
        .unwrap();
    assert_eq!(fixture.store.rows().len(), 1);
}

#[tokio::test]
async fn an_empty_name_is_refused() {
    let fixture = holding(vec![row(WIKI, true)]);

    let error = fixture
        .source
        .add_server(
            &user(),
            &ServerUrl::parse("https://new.example.com/mcp").unwrap(),
            "  ",
            AddedBy::User,
        )
        .await
        .unwrap_err();
    assert_eq!(refusal(&error), Some(&SourceRefusal::EmptyName));

    let error = fixture
        .source
        .rename(&user(), &server(WIKI), " ")
        .await
        .unwrap_err();
    assert_eq!(refusal(&error), Some(&SourceRefusal::EmptyName));
}

/// Changes find the row by its normalized address and save it in the
/// spelling it was stored under, keeping its grant.
#[tokio::test]
async fn toggling_and_renaming_change_the_stored_row() {
    let stored = format!("{WIKI}/");
    let fixture = holding(vec![McpServerRecord {
        credentials: Some(granted("token")),
        ..row(&stored, true)
    }]);

    fixture
        .source
        .set_enabled(&user(), &server(WIKI), false)
        .await
        .unwrap();
    fixture
        .source
        .rename(&user(), &server(WIKI), "Team wiki")
        .await
        .unwrap();

    let rows = fixture.store.rows();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].url, stored);
    assert!(!rows[0].enabled);
    assert_eq!(rows[0].server_name, "Team wiki");
    assert!(rows[0].credentials.is_some());
}

#[tokio::test]
async fn changing_a_server_the_user_lacks_is_not_found() {
    let fixture = holding(Vec::new());

    let error = fixture
        .source
        .set_enabled(&user(), &server(WIKI), false)
        .await
        .unwrap_err();
    assert_eq!(
        refusal(&error),
        Some(&SourceRefusal::NotFound(server(WIKI)))
    );
}

/// Native holds servers only; the service passes an overlaid app's server
/// address, never the app.
#[tokio::test]
async fn an_app_key_is_unsupported() {
    let fixture = holding(vec![row(WIKI, true)]);
    let app = ConnectorKey::App(ConnectorId::parse("linear").unwrap());

    for error in [
        fixture
            .source
            .set_enabled(&user(), &app, false)
            .await
            .unwrap_err(),
        fixture
            .source
            .rename(&user(), &app, "Linear")
            .await
            .unwrap_err(),
        fixture.source.remove(&user(), &app).await.unwrap_err(),
        fixture
            .source
            .start_connect(&user(), &app)
            .await
            .unwrap_err(),
    ] {
        assert_eq!(
            refusal(&error),
            Some(&SourceRefusal::Unsupported(app.clone()))
        );
    }
}

#[tokio::test]
async fn removing_deletes_the_row_in_its_stored_spelling() {
    let fixture = holding(vec![row(&format!("{WIKI}/"), true)]);

    fixture.source.remove(&user(), &server(WIKI)).await.unwrap();
    assert!(fixture.store.rows().is_empty());

    // Removing again succeeds.
    fixture.source.remove(&user(), &server(WIKI)).await.unwrap();
}

/// Signing in starts the OAuth flow for the stored row, or for an address
/// not added yet under its host's name.
#[tokio::test]
async fn connecting_a_server_starts_its_oauth_sign_in() {
    let fixture = holding(vec![row(&format!("{WIKI}/"), true)]);

    let step = fixture
        .source
        .start_connect(&user(), &server(WIKI))
        .await
        .unwrap();
    assert_eq!(step, ConnectStep::OpenUrl(Url::parse(AUTHORIZE).unwrap()));

    fixture
        .source
        .start_connect(&user(), &server("https://new.example.com/mcp"))
        .await
        .unwrap();

    assert_eq!(
        *fixture.oauth.started.lock().unwrap(),
        [
            (format!("{WIKI}/"), "Wiki".to_owned()),
            (
                "https://new.example.com/mcp".to_owned(),
                "new.example.com".to_owned()
            ),
        ]
    );
}

#[tokio::test]
async fn an_app_does_not_complete_through_native() {
    let fixture = holding(Vec::new());

    let error = fixture
        .source
        .complete_connect(&user(), &ConnectorId::parse("linear").unwrap())
        .await
        .unwrap_err();
    assert!(matches!(
        refusal(&error),
        Some(SourceRefusal::Unsupported(_))
    ));
}

async fn upstream(record: McpServerRecord) -> Result<Upstream, Report> {
    let fixture = holding(vec![record]);
    let connection = fixture.source.connections(&user()).await.unwrap().remove(0);
    connection.mcp.unwrap().upstream().await
}

/// A live token goes to the proxy as the bearer, without touching the
/// network.
#[tokio::test]
async fn the_proxy_gets_the_live_bearer() {
    let upstream = upstream(McpServerRecord {
        credentials: Some(granted("live")),
        ..row(WIKI, true)
    })
    .await
    .unwrap();

    assert_eq!(upstream.url().as_str(), WIKI);
    assert_eq!(upstream.bearer(), Some("live"));
}

/// A server added without signing in is called anonymously.
#[tokio::test]
async fn a_server_without_a_grant_is_called_anonymously() {
    let upstream = upstream(row(WIKI, true)).await.unwrap();

    assert_eq!(upstream.bearer(), None);
}

#[tokio::test]
async fn a_sign_in_that_never_finished_needs_reauth() {
    let error = upstream(McpServerRecord {
        credentials: Some(unfinished()),
        ..row(WIKI, true)
    })
    .await
    .unwrap_err();

    assert_eq!(
        refusal(&error),
        Some(&SourceRefusal::NeedsReauth(server(WIKI)))
    );
}

/// A local MCP endpoint answering every POST with `status`, with the
/// `WWW-Authenticate` challenge a server that needs sign-in sends when it is
/// 401, and counting the requests it got.
async fn endpoint(status: http::StatusCode) -> (String, Arc<std::sync::atomic::AtomicUsize>) {
    use axum::response::IntoResponse as _;
    let hits = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let router = axum::Router::new().route(
        "/mcp",
        axum::routing::post({
            let hits = Arc::clone(&hits);
            move || async move {
                hits.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let mut headers = http::HeaderMap::new();
                if status == http::StatusCode::UNAUTHORIZED {
                    headers.insert(
                        http::header::WWW_AUTHENTICATE,
                        http::HeaderValue::from_static(
                            r#"Bearer resource_metadata="https://auth.example.com/.well-known/oauth-protected-resource""#,
                        ),
                    );
                }
                (status, headers, "{}").into_response()
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (format!("http://127.0.0.1:{port}/mcp"), hits)
}

/// Adding a server that answers 401 without a token stores it as needing a
/// sign-in: its grant is dead, so it reads as needing sign-in, not connected.
#[tokio::test]
async fn adding_a_server_that_needs_sign_in_marks_it() {
    let (url, hits) = endpoint(http::StatusCode::UNAUTHORIZED).await;
    let fixture = holding(Vec::new());

    let added = fixture
        .source
        .add_server(
            &user(),
            &ServerUrl::parse(&url).unwrap(),
            "Tracker",
            AddedBy::User,
        )
        .await
        .unwrap();

    assert_eq!(added.grant, GrantState::Dead);
    assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(fixture.store.rows()[0].requires_sign_in);
    let listed = fixture.source.connections(&user()).await.unwrap();
    assert_eq!(listed[0].grant, GrantState::Dead);
}

/// A server that takes requests without a token, or doesn't answer, stays
/// as it was: connected without a sign-in.
#[tokio::test]
async fn adding_a_server_that_needs_no_sign_in_leaves_it_anonymous() {
    let (url, hits) = endpoint(http::StatusCode::OK).await;
    let fixture = holding(Vec::new());

    let added = fixture
        .source
        .add_server(
            &user(),
            &ServerUrl::parse(&url).unwrap(),
            "Docs",
            AddedBy::User,
        )
        .await
        .unwrap();

    assert_eq!(added.grant, GrantState::Missing);
    assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(!fixture.store.rows()[0].requires_sign_in);
}

/// A server already marked is refused before anything is sent to it, in
/// process and for the proxy.
#[tokio::test]
async fn a_server_needing_sign_in_is_neither_dialed_nor_addressed() {
    let (url, hits) = endpoint(http::StatusCode::UNAUTHORIZED).await;
    let fixture = holding(vec![McpServerRecord {
        requires_sign_in: true,
        ..row(&url, true)
    }]);
    let connection = fixture.source.connections(&user()).await.unwrap().remove(0);
    let mcp = connection.mcp.unwrap();

    let dialed = mcp.dial().await.map(|_| ()).unwrap_err();
    let addressed = mcp.upstream().await.unwrap_err();

    assert_eq!(
        refusal(&dialed),
        Some(&SourceRefusal::NeedsReauth(server(&url)))
    );
    assert_eq!(
        refusal(&addressed),
        Some(&SourceRefusal::NeedsReauth(server(&url)))
    );
    assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 0);
}

/// A server added before it was asked, which answers a dial without a token
/// with 401, needs reauth and is stored as needing a sign-in.
#[tokio::test]
async fn a_dial_answered_401_marks_the_server() {
    let (url, _) = endpoint(http::StatusCode::UNAUTHORIZED).await;
    let fixture = holding(vec![row(&url, true)]);
    let connection = fixture.source.connections(&user()).await.unwrap().remove(0);
    assert_eq!(connection.grant, GrantState::Missing);

    let error = connection
        .mcp
        .unwrap()
        .dial()
        .await
        .map(|_| ())
        .unwrap_err();

    assert_eq!(
        refusal(&error),
        Some(&SourceRefusal::NeedsReauth(server(&url)))
    );
    assert!(fixture.store.rows()[0].requires_sign_in);
}

/// A 401 the proxy saw marks a server called without a token, and leaves a
/// signed-in one alone.
#[tokio::test]
async fn a_reported_401_marks_only_a_server_without_a_grant() {
    let fixture = holding(vec![
        row("https://a.example.com/mcp", true),
        McpServerRecord {
            credentials: Some(granted("token")),
            ..row("https://b.example.com/mcp", true)
        },
    ]);
    for connection in fixture.source.connections(&user()).await.unwrap() {
        connection.mcp.unwrap().unauthorized().await.unwrap();
    }

    let marks: Vec<_> = fixture
        .store
        .rows()
        .iter()
        .map(|row| row.requires_sign_in)
        .collect();
    assert_eq!(marks, [true, false]);
}
