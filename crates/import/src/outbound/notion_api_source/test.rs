use super::*;
use crate::domain::models::NotionPropertyValue;
use crate::domain::service::notion::convert::{self, ConvertContext, HostedImage};
use crate::domain::service::notion::folders::{self, PlacedPage};
use crate::domain::service::notion::{self as notion_domain, fetch};
use crate::outbound::direct_api::DirectApi;
use macro_user_id::cowlike::CowLike;
use pipedream_mcp::domain::models::ProxyMethod;
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Duration;

const USERS_ME: &str = include_str!("fixtures/users_me.json");
const PAGES: &str = include_str!("fixtures/pages.json");
const CHILDREN: &str = include_str!("fixtures/children.json");
const BLOCKS: &str = include_str!("fixtures/blocks.json");
const DATABASE: &str = include_str!("fixtures/database.json");
const DATA_SOURCE: &str = include_str!("fixtures/data_source.json");

const ROOT: &str = "1a2b0001-0000-4000-8000-000000000001";
/// The pages search returns, most recently edited first (Team Home, an
/// older ancestor, is not among them).
const SEARCH_ORDER: [&str; 7] = [
    ROOT,
    ROW_LONG,
    "1a2b0006-0000-4000-8000-000000000006",
    "1a2b0002-0000-4000-8000-000000000002",
    "1a2b0007-0000-4000-8000-000000000007",
    "1a2b0008-0000-4000-8000-000000000008",
    "1a2b0009-0000-4000-8000-000000000009",
];
const ROW_LONG: &str = "1a2b0005-0000-4000-8000-000000000005";
const HOSTED_IMAGE: &str = "https://prod-files-secure.s3.us-west-2.amazonaws.com/ws-redacted/img-redacted/architecture.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=redacted";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|dana@example.com")
        .unwrap()
        .into_owned()
}

fn id(raw: &str) -> NotionId {
    NotionId::parse(raw).unwrap()
}

fn ok(body: &Value) -> Result<ProxyResponse, ConnectProxyError> {
    Ok(ProxyResponse {
        status: 200,
        retry_after: None,
        body: body.to_string().into_bytes(),
    })
}

fn status(code: u16, body: Value) -> Result<ProxyResponse, ConnectProxyError> {
    Ok(ProxyResponse {
        status: code,
        retry_after: None,
        body: body.to_string().into_bytes(),
    })
}

/// Serves the fixtures by URL, like Notion behind the proxy. Queued
/// responses (for error tests) are served first.
#[derive(Default)]
struct FixtureNotion {
    queued: Mutex<VecDeque<Result<ProxyResponse, ConnectProxyError>>>,
    requests: Mutex<Vec<ProxyRequest>>,
}

impl ConnectProxy for FixtureNotion {
    async fn send(
        &self,
        caller: &MacroUserIdStr<'static>,
        app_slug: &str,
        request: ProxyRequest,
    ) -> Result<ProxyResponse, ConnectProxyError> {
        assert_eq!(caller, &user());
        assert_eq!(app_slug, "notion");
        self.requests.lock().unwrap().push(request.clone());
        if let Some(response) = self.queued.lock().unwrap().pop_front() {
            return response;
        }
        let path = request
            .url
            .strip_prefix("https://api.notion.com/v1")
            .expect("Notion API URL");
        let path = path.split('?').next().unwrap();
        let fixture = |raw: &str| serde_json::from_str::<Value>(raw).unwrap();
        let not_found = || {
            status(
                404,
                serde_json::json!({"object": "error", "code": "object_not_found", "message": "Could not find block"}),
            )
        };
        match (request.method, path) {
            (ProxyMethod::Get, "/users/me") => ok(&fixture(USERS_ME)),
            (ProxyMethod::Post, "/search") => {
                let pages = fixture(PAGES);
                ok(&serde_json::json!({
                    "object": "list",
                    "results": SEARCH_ORDER.map(|id| pages[id].clone()),
                    "next_cursor": null,
                    "has_more": false,
                }))
            }
            (ProxyMethod::Get, path) if path.starts_with("/pages/") => {
                match fixture(PAGES).get(&path["/pages/".len()..]) {
                    Some(page) => ok(page),
                    None => not_found(),
                }
            }
            (ProxyMethod::Get, path) if path.starts_with("/databases/") => ok(&fixture(DATABASE)),
            (ProxyMethod::Get, path) if path.starts_with("/data_sources/") => {
                ok(&fixture(DATA_SOURCE))
            }
            (ProxyMethod::Get, path) if path.ends_with("/children") => {
                let block = &path["/blocks/".len()..path.len() - "/children".len()];
                match fixture(CHILDREN).get(block) {
                    Some(listing) => ok(listing),
                    None => not_found(),
                }
            }
            (ProxyMethod::Get, path) if path.starts_with("/blocks/") => {
                match fixture(BLOCKS).get(&path["/blocks/".len()..]) {
                    Some(block) => ok(block),
                    None => not_found(),
                }
            }
            other => panic!("unexpected request {other:?}"),
        }
    }
}

fn session(proxy: Arc<FixtureNotion>) -> NotionApiSession<FixtureNotion> {
    NotionApiSource::new(proxy).open(&user())
}

#[tokio::test]
async fn owner_and_search_parse_the_fixture_workspace() {
    let proxy = Arc::new(FixtureNotion::default());
    let session = session(proxy.clone());

    assert_eq!(
        session.owner().await.unwrap(),
        NotionOwner::User("9f000000-0000-4000-8000-000000000001".into())
    );
    let results = session.search_pages(None).await.unwrap();
    assert_eq!(results.next_cursor, None);
    let titles: Vec<(&str, bool)> = results
        .pages
        .iter()
        .map(|page| (page.title.as_str(), page.archived))
        .collect();
    assert_eq!(
        titles,
        [
            ("Q4 Launch Plan", false),
            ("Exporter rewrite", false),
            ("Fix typo", false),
            ("Launch checklist", false),
            ("Old plan", true),
            ("Scratch", true),
            ("Column notes", false),
        ]
    );
    let root = &results.pages[0];
    assert_eq!(root.icon_emoji.as_deref(), Some("🚀"));
    assert_eq!(
        root.parent,
        NotionParent::Page("1a2b000a00004000800000000000000a".into())
    );
    // 2025-09-03 rows name their data source; the database id is kept.
    assert_eq!(
        results.pages[1].parent,
        NotionParent::Database("1a2b0003000040008000000000000003".into())
    );
    // Only emoji icons count.
    assert_eq!(results.pages[6].icon_emoji, None);
    assert!(matches!(results.pages[6].parent, NotionParent::Block(_)));

    let requests = proxy.requests.lock().unwrap();
    let search = &requests[1];
    assert_eq!(search.method, ProxyMethod::Post);
    assert!(
        search
            .headers
            .contains(&("Notion-Version".to_string(), NOTION_VERSION.to_string()))
    );
    assert_eq!(
        search.body.as_ref().unwrap(),
        &serde_json::json!({
            "filter": {"property": "object", "value": "page"},
            "sort": {"direction": "descending", "timestamp": "last_edited_time"},
            "page_size": 100,
        })
    );
}

#[tokio::test]
async fn database_row_properties_are_typed() {
    let session = session(Arc::new(FixtureNotion::default()));
    let row = session.page(&id(ROW_LONG)).await.unwrap();
    let properties: Vec<(&str, &NotionPropertyValue)> = row
        .properties
        .iter()
        .map(|property| (property.name.as_str(), &property.value))
        .collect();
    assert_eq!(
        properties,
        [
            (
                "Areas",
                &NotionPropertyValue::MultiSelect(vec!["Exports".into()])
            ),
            ("Attachments", &NotionPropertyValue::Skipped),
            ("Blocked by", &NotionPropertyValue::Skipped),
            (
                "Due",
                &NotionPropertyValue::Date {
                    start: "2026-11-15".into(),
                    end: None
                }
            ),
            ("Empty select", &NotionPropertyValue::Select(None)),
            ("Estimate", &NotionPropertyValue::Number(Some(8.0))),
            ("Name", &NotionPropertyValue::Title),
            ("Owner", &NotionPropertyValue::Skipped),
            ("Score", &NotionPropertyValue::Skipped),
            ("Shipped", &NotionPropertyValue::Checkbox(false)),
            (
                "Spec",
                &NotionPropertyValue::Url(Some("https://example.com/spec".into()))
            ),
            (
                "Status",
                &NotionPropertyValue::Status(Some("In progress".into()))
            ),
            (
                "Summary",
                &NotionPropertyValue::RichText("Streaming CSV exports".into())
            ),
            (
                "Tags",
                &NotionPropertyValue::MultiSelect(vec!["Q4".into(), "Infra".into()])
            ),
            (
                "Team",
                &NotionPropertyValue::Select(Some("Platform".into()))
            ),
        ]
    );
    assert_eq!(row.title, "Exporter rewrite");
}

#[tokio::test]
async fn ancestors_parse_databases_data_sources_and_blocks() {
    let session = session(Arc::new(FixtureNotion::default()));
    let database = session
        .database(&id("1a2b0003-0000-4000-8000-000000000003"))
        .await
        .unwrap();
    assert_eq!(database.title, "Projects");
    assert_eq!(database.icon_emoji.as_deref(), Some("📁"));
    assert_eq!(
        session
            .data_source_database(&id("1a2b0004-0000-4000-8000-000000000004"))
            .await
            .unwrap(),
        id("1a2b0003-0000-4000-8000-000000000003")
    );
    assert_eq!(
        session
            .block_parent(&id("1a2b0190-0000-4000-8000-000000000190"))
            .await
            .unwrap(),
        NotionParent::Block("1a2b0191000040008000000000000191".into())
    );
    assert!(matches!(
        session
            .block_parent(&id("1a2b0999-0000-4000-8000-000000000999"))
            .await,
        Err(ApiSourceError::NotFound)
    ));
}

#[tokio::test]
async fn throttled_reads_report_retry_after() {
    let proxy = Arc::new(FixtureNotion::default());
    proxy.queued.lock().unwrap().push_back(Ok(ProxyResponse {
        status: 429,
        retry_after: Some(Duration::from_secs(5)),
        body: br#"{"object":"error","code":"rate_limited"}"#.to_vec(),
    }));
    assert!(matches!(
        session(proxy).owner().await,
        Err(ApiSourceError::RateLimited {
            app: ImportSource::Notion,
            retry_after: Some(delay),
        }) if delay == Duration::from_secs(5)
    ));
}

#[tokio::test]
async fn errors_map_to_not_found_unauthorized_and_not_connected() {
    let proxy = Arc::new(FixtureNotion::default());
    proxy.queued.lock().unwrap().extend([
        status(
            403,
            serde_json::json!({"code": "restricted_resource", "message": "no access"}),
        ),
        status(
            401,
            serde_json::json!({"code": "unauthorized", "message": "bad token"}),
        ),
        Err(ConnectProxyError::NotConnected {
            app_slug: "notion".into(),
        }),
        status(
            400,
            serde_json::json!({"code": "validation_error", "message": "bad cursor"}),
        ),
    ]);
    let session = session(proxy);
    assert!(matches!(
        session.owner().await,
        Err(ApiSourceError::NotFound)
    ));
    assert!(matches!(
        session.owner().await,
        Err(ApiSourceError::Unauthorized(ImportSource::Notion))
    ));
    assert!(matches!(
        session.owner().await,
        Err(ApiSourceError::NotConnected(ImportSource::Notion))
    ));
    let error = session.owner().await.unwrap_err();
    assert!(error.to_string().contains("validation_error: bad cursor"));
}

#[tokio::test]
async fn cursors_page_through_search_and_children() {
    let proxy = Arc::new(FixtureNotion::default());
    proxy.queued.lock().unwrap().extend([
        ok(&serde_json::json!({"results": [], "next_cursor": "c/2 3", "has_more": true})),
        ok(&serde_json::json!({"results": [], "next_cursor": null, "has_more": false})),
    ]);
    let session = session(proxy.clone());

    let first = session.children(&id(ROOT), None).await.unwrap();
    assert_eq!(first.next_cursor.as_deref(), Some("c/2 3"));
    session.children(&id(ROOT), Some("c/2 3")).await.unwrap();
    session.search_pages(Some("s2")).await.unwrap();

    let requests = proxy.requests.lock().unwrap();
    assert!(
        requests[1]
            .url
            .ends_with("/children?page_size=100&start_cursor=c%2F2%203")
    );
    assert_eq!(requests[2].body.as_ref().unwrap()["start_cursor"], "s2");
}

/// Convert a fixture page end to end (API JSON → blocks → Markdown).
async fn converted(page: &str, title_for_links: Option<(&str, &str)>) -> String {
    let session = session(Arc::new(FixtureNotion::default()));
    let tree = fetch::fetch_tree(&session, &id(page)).await.unwrap();
    // Titles of the page's ancestors label links to pages that are not
    // imported, as in a real batch.
    let facts = session.page(&id(page)).await.unwrap();
    let ancestry = folders::resolve_ancestry(
        &session,
        &[PlacedPage {
            id: facts.id.clone(),
            name: notion_domain::document_name(&facts.title, facts.icon_emoji.as_deref()),
            parent: facts.parent,
        }],
    )
    .await;
    let mut context = ConvertContext {
        page_url: "https://www.notion.so/example-co/Page",
        titles: ancestry
            .nodes
            .into_iter()
            .map(|(id, node)| (id, node.name))
            .collect(),
        ..ConvertContext::default()
    };
    context.images.insert(
        HOSTED_IMAGE.into(),
        HostedImage {
            id: "0199c3e4-0000-7000-8000-00000000a001".into(),
            url: "https://static-file-service.macro.com/file/0199c3e4-0000-7000-8000-00000000a001"
                .into(),
            width: 1600,
            height: 900,
        },
    );
    if let Some((linked, name)) = title_for_links {
        context.documents.insert(
            id(linked),
            convert::LinkedDocument {
                id: "0199c3e4-0000-7000-8000-00000000d002".into(),
                name: name.into(),
            },
        );
    }
    let converted = convert::convert(&tree.blocks, tree.truncated, &context);
    format!("{}\n", converted.markdown)
}

#[tokio::test]
async fn rich_page_converts_to_the_committed_snapshot() {
    let markdown = converted(
        ROOT,
        Some(("1a2b0002-0000-4000-8000-000000000002", "Launch checklist")),
    )
    .await;
    assert_eq!(markdown, include_str!("snapshots/q4_launch_plan.md"));
}

/// Refresh the committed snapshot after an intended converter change:
/// `cargo test -p import write_notion_snapshots -- --ignored`, then review
/// the diff.
#[tokio::test]
#[ignore = "rewrites the committed snapshot"]
async fn write_notion_snapshots() {
    let dir = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/outbound/notion_api_source/snapshots"
    );
    let rich = converted(
        ROOT,
        Some(("1a2b0002-0000-4000-8000-000000000002", "Launch checklist")),
    )
    .await;
    std::fs::write(format!("{dir}/q4_launch_plan.md"), rich).unwrap();
}

/// Where each page lands, as sorted `Notion / … / name` lines.
async fn folder_lines(session: &impl NotionSession, pages: &[NotionPage]) -> Vec<String> {
    let placed: Vec<PlacedPage> = pages
        .iter()
        .map(|page| PlacedPage {
            name: notion_domain::document_name(&page.title, page.icon_emoji.as_deref()),
            id: page.id.clone(),
            parent: page.parent.clone(),
        })
        .collect();
    let ancestry = folders::resolve_ancestry(session, &placed).await;
    let ids: Vec<NotionId> = placed.iter().map(|page| page.id.clone()).collect();
    let plan = folders::plan_folders(&ids, &ancestry);
    let mut lines: Vec<String> = placed
        .iter()
        .map(|page| {
            let mut path = vec![folders::ROOT_FOLDER_NAME.to_string()];
            path.extend(plan[&page.id].iter().map(|folder| folder.name.clone()));
            format!("{} / {}", path.join(" / "), page.name)
        })
        .collect();
    lines.sort();
    lines
}

/// The folder tree discovery and import build for the fixture workspace.
#[tokio::test]
async fn fixture_workspace_folder_tree() {
    let session = session(Arc::new(FixtureNotion::default()));
    let pages = notion_domain::select_pages(&session).await.unwrap();
    assert_eq!(
        folder_lines(&session, &pages).await,
        [
            "Notion / 🏠 Team Home / Column notes",
            "Notion / 🏠 Team Home / 📁 Projects / Exporter rewrite",
            "Notion / 🏠 Team Home / 🚀 Q4 Launch Plan / Launch checklist",
            "Notion / 🏠 Team Home / 🚀 Q4 Launch Plan / 🚀 Q4 Launch Plan",
        ]
    );
}

macro_env_var::env_var! {
    /// A Notion internal-integration token for the live preview.
    struct LiveNotionVars {
        NotionApiToken,
    }
}

/// Preview discovery, folders and conversion against a real Notion workspace,
/// reading Notion's API directly instead of through Pipedream:
/// `NOTION_API_TOKEN=… cargo test -p import live_notion_preview -- --ignored --nocapture`.
/// An internal integration's owner is the workspace, not a person, so this
/// cannot check Home's "edited by me" rule.
#[tokio::test]
#[ignore = "reads a real Notion workspace; requires NOTION_API_TOKEN"]
async fn live_notion_preview() {
    let token = LiveNotionVars::new()
        .expect("set NOTION_API_TOKEN to a Notion internal integration token")
        .notion_api_token
        .as_ref()
        .to_string();
    let session =
        NotionApiSource::new(Arc::new(DirectApi::new(format!("Bearer {token}")))).open(&user());
    println!("owner: {:?}", session.owner().await.unwrap());

    let pages = notion_domain::select_pages(&session).await.unwrap();
    println!("\n{} pages selected:", pages.len());
    for page in &pages {
        println!(
            "- {} (edited {}, parent {:?})",
            notion_domain::document_name(&page.title, page.icon_emoji.as_deref()),
            page.last_edited_time,
            page.parent
        );
    }
    println!(
        "\nfolders:\n{}",
        folder_lines(&session, &pages).await.join("\n")
    );

    for page in pages.iter().take(3) {
        let tree = fetch::fetch_tree(&session, &page.id).await.unwrap();
        let context = ConvertContext {
            page_url: &page.url,
            ..ConvertContext::default()
        };
        let converted = convert::convert(&tree.blocks, tree.truncated, &context);
        println!("\n===== {} =====\n{}", page.title, converted.markdown);
    }
}
