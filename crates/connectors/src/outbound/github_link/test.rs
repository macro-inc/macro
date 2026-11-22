use super::*;
use crate::outbound::guarded_http::AddressPolicy;
use crate::outbound::native::memory_store::MemoryStore;
use crate::outbound::native::models::StoredCredentials;
use axum::Router;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use macro_user_id::cowlike::CowLike;
use std::sync::Mutex;
use tokio::sync::oneshot;

const APP: &str = "https://app.example.com";

/// One user's link, in the state a test sets, recording unlinks.
struct FakeLink {
    state: Mutex<LinkToken>,
    unlinked: Mutex<u32>,
}

#[async_trait::async_trait]
impl GithubAccountLink for FakeLink {
    async fn token(&self, _user: &MacroUserIdStr<'static>) -> Result<LinkToken, Report> {
        Ok(self.state.lock().unwrap().clone())
    }

    async fn unlink(&self, _user: &MacroUserIdStr<'static>) -> Result<(), Report> {
        *self.unlinked.lock().unwrap() += 1;
        *self.state.lock().unwrap() = LinkToken::NotLinked;
        Ok(())
    }
}

/// A link service that is down.
struct BrokenLink;

#[async_trait::async_trait]
impl GithubAccountLink for BrokenLink {
    async fn token(&self, _user: &MacroUserIdStr<'static>) -> Result<LinkToken, Report> {
        Err(rootcause::report!("authentication service unavailable"))
    }

    async fn unlink(&self, _user: &MacroUserIdStr<'static>) -> Result<(), Report> {
        Err(rootcause::report!("authentication service unavailable"))
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned()
}

fn github() -> ConnectorKey {
    ConnectorKey::App(ConnectorId::github())
}

fn http() -> McpHttp {
    McpHttp::new(AddressPolicy::AnyAddress).unwrap()
}

struct Fixture {
    link: Arc<FakeLink>,
    store: Arc<MemoryStore>,
    source: GithubLinkSource<MemoryStore>,
}

fn linked(state: LinkToken, rows: Vec<McpServerRecord>) -> Fixture {
    let link = Arc::new(FakeLink {
        state: Mutex::new(state),
        unlinked: Mutex::new(0),
    });
    let store = Arc::new(MemoryStore::holding(rows));
    let source = GithubLinkSource::new(
        link.clone(),
        store.clone(),
        http(),
        &Url::parse(APP).unwrap(),
    )
    .unwrap();
    Fixture {
        link,
        store,
        source,
    }
}

fn toggle_row(url: &str, name: &str, enabled: bool) -> McpServerRecord {
    McpServerRecord {
        user_id: user(),
        url: url.to_owned(),
        server_name: name.to_owned(),
        credentials: None,
        enabled,
    }
}

fn refusal(error: &Report) -> Option<&SourceRefusal> {
    error.downcast_current_context::<SourceRefusal>()
}

#[tokio::test]
async fn an_unlinked_user_holds_nothing() {
    let fixture = linked(LinkToken::NotLinked, Vec::new());

    assert!(
        fixture
            .source
            .connections(&user())
            .await
            .unwrap()
            .is_empty()
    );
}

/// A working link is GitHub, connected, enabled under GitHub's name until
/// the user changes either.
#[tokio::test]
async fn a_working_link_is_github() {
    let fixture = linked(LinkToken::Working("token".to_owned()), Vec::new());

    let connections = fixture.source.connections(&user()).await.unwrap();

    assert_eq!(connections.len(), 1);
    let connection = &connections[0];
    assert_eq!(connection.source, SourceKind::GithubLink);
    assert_eq!(connection.key, github());
    assert_eq!(connection.name, "GitHub");
    assert!(connection.enabled);
    assert!(connection.authorized);
    assert!(connection.mcp.is_some());
    assert!(connection.api.is_none());
}

/// A link whose token GitHub no longer accepts is held but not authorized,
/// which the resolver reports as needing reauthorization (rule 8).
#[tokio::test]
async fn a_link_github_refuses_is_held_but_not_authorized() {
    let fixture = linked(LinkToken::NeedsReauth, Vec::new());

    let connection = fixture.source.connections(&user()).await.unwrap().remove(0);

    assert!(!connection.authorized);
    let error = connection.mcp.unwrap().upstream().await.unwrap_err();
    assert_eq!(refusal(&error), Some(&SourceRefusal::NeedsReauth(github())));
}

/// The toggle and name stay where they always were: a row at GitHub's
/// address, in whatever spelling it was stored.
#[tokio::test]
async fn the_stored_toggle_and_name_apply() {
    let fixture = linked(
        LinkToken::Working("token".to_owned()),
        vec![toggle_row(
            &format!("{GITHUB_MCP_SERVER_URL}/"),
            "Work GitHub",
            false,
        )],
    );

    let connection = fixture.source.connections(&user()).await.unwrap().remove(0);

    assert_eq!(connection.name, "Work GitHub");
    assert!(!connection.enabled);
}

#[tokio::test]
async fn a_failed_link_read_is_an_error() {
    let source = GithubLinkSource::new(
        Arc::new(BrokenLink),
        Arc::new(MemoryStore::default()),
        http(),
        &Url::parse(APP).unwrap(),
    )
    .unwrap();

    assert!(source.connections(&user()).await.is_err());
}

/// The proxy stamps the link's token onto calls to GitHub's MCP server.
#[tokio::test]
async fn the_proxy_gets_the_links_token() {
    let fixture = linked(LinkToken::Working("token".to_owned()), Vec::new());
    let connection = fixture.source.connections(&user()).await.unwrap().remove(0);

    let upstream = connection.mcp.unwrap().upstream().await.unwrap();

    assert_eq!(upstream.url().as_str(), GITHUB_MCP_SERVER_URL);
    assert_eq!(upstream.bearer(), Some("token"));
}

/// Dialing in process sends the link's token as the bearer.
#[tokio::test]
async fn dialing_sends_the_links_token() {
    let (sender, received) = oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(sender)));
    let router = Router::new().route(
        "/mcp",
        post(move |headers: HeaderMap| async move {
            let authorization = headers
                .get(http::header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            if let Some(sender) = sender.lock().unwrap().take() {
                let _ = sender.send(authorization);
            }
            StatusCode::UNAUTHORIZED
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });

    let fixture = linked(LinkToken::Working("token".to_owned()), Vec::new());
    let source = fixture
        .source
        .with_server(Url::parse(&format!("http://127.0.0.1:{port}/mcp")).unwrap());
    let connection = source.connections(&user()).await.unwrap().remove(0);

    assert!(connection.mcp.unwrap().dial().await.is_err());
    assert_eq!(received.await.unwrap().as_deref(), Some("Bearer token"));
}

#[tokio::test]
async fn the_link_serves_github_as_mcp_only() {
    let fixture = linked(LinkToken::NotLinked, Vec::new());

    assert_eq!(
        fixture
            .source
            .supports(&ConnectorId::github())
            .await
            .unwrap(),
        Some(Surfaces::new(true, false))
    );
    let linear = ConnectorId::parse("linear").unwrap();
    assert_eq!(fixture.source.supports(&linear).await.unwrap(), None);
    assert!(
        fixture
            .source
            .holders(&ConnectorId::github())
            .await
            .unwrap()
            .is_empty()
    );
}

/// Linking starts in settings, from the user's own hands.
#[tokio::test]
async fn connecting_github_opens_settings() {
    let fixture = linked(LinkToken::NotLinked, Vec::new());

    let step = fixture
        .source
        .start_connect(&user(), &github())
        .await
        .unwrap();

    assert_eq!(
        step,
        ConnectStep::OpenUrl(
            Url::parse("https://app.example.com/app/settings/connections").unwrap()
        )
    );
}

#[tokio::test]
async fn completing_reads_the_new_link() {
    let fixture = linked(LinkToken::NotLinked, Vec::new());
    let error = fixture
        .source
        .complete_connect(&user(), &ConnectorId::github())
        .await
        .unwrap_err();
    assert_eq!(refusal(&error), Some(&SourceRefusal::NotFound(github())));

    *fixture.link.state.lock().unwrap() = LinkToken::Working("token".to_owned());
    let connection = fixture
        .source
        .complete_connect(&user(), &ConnectorId::github())
        .await
        .unwrap();
    assert!(connection.authorized);
}

/// Toggling writes the row at GitHub's address, never with a token in it.
#[tokio::test]
async fn toggling_and_renaming_keep_the_row_without_a_token() {
    let fixture = linked(LinkToken::Working("token".to_owned()), Vec::new());

    fixture
        .source
        .set_enabled(&user(), &github(), false)
        .await
        .unwrap();
    fixture
        .source
        .rename(&user(), &github(), "Work GitHub")
        .await
        .unwrap();

    let rows = fixture.store.rows();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].url, GITHUB_MCP_SERVER_URL);
    assert_eq!(rows[0].server_name, "Work GitHub");
    assert!(!rows[0].enabled);
    assert!(rows[0].credentials.is_none());
    let connection = fixture.source.connections(&user()).await.unwrap().remove(0);
    assert!(!connection.enabled);
}

#[tokio::test]
async fn toggling_without_a_link_is_not_found() {
    let fixture = linked(LinkToken::NotLinked, Vec::new());

    let error = fixture
        .source
        .set_enabled(&user(), &github(), false)
        .await
        .unwrap_err();

    assert_eq!(refusal(&error), Some(&SourceRefusal::NotFound(github())));
    assert!(fixture.store.rows().is_empty());
}

#[tokio::test]
async fn only_github_is_served() {
    let fixture = linked(LinkToken::Working("token".to_owned()), Vec::new());
    let linear = ConnectorKey::App(ConnectorId::parse("linear").unwrap());
    let server = ConnectorKey::Server(ServerUrl::parse(GITHUB_MCP_SERVER_URL).unwrap());

    for key in [linear, server] {
        for error in [
            fixture
                .source
                .start_connect(&user(), &key)
                .await
                .unwrap_err(),
            fixture
                .source
                .set_enabled(&user(), &key, false)
                .await
                .unwrap_err(),
            fixture.source.remove(&user(), &key).await.unwrap_err(),
        ] {
            assert_eq!(
                refusal(&error),
                Some(&SourceRefusal::Unsupported(key.clone()))
            );
        }
    }
    assert_eq!(*fixture.link.unlinked.lock().unwrap(), 0);
}

/// Removing GitHub unlinks the account and forgets the toggle (rule 8).
#[tokio::test]
async fn removing_github_unlinks_the_account() {
    let fixture = linked(
        LinkToken::Working("token".to_owned()),
        vec![McpServerRecord {
            credentials: Some(StoredCredentials::new(
                "client".to_owned(),
                None,
                Vec::new(),
                None,
            )),
            ..toggle_row(GITHUB_MCP_SERVER_URL, "GitHub", false)
        }],
    );

    fixture.source.remove(&user(), &github()).await.unwrap();

    assert_eq!(*fixture.link.unlinked.lock().unwrap(), 1);
    assert!(fixture.store.rows().is_empty());
    assert!(
        fixture
            .source
            .connections(&user())
            .await
            .unwrap()
            .is_empty()
    );
}
