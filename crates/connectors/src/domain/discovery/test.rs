use super::*;
use crate::fake::{FakeConnection, FakeConnectors};
use macro_user_id::cowlike::CowLike as _;
use std::sync::Mutex;

/// A directory of `linear` and `notion`, each advertising `tool_count`
/// tools, that remembers what it was searched with.
struct FakeDirectory {
    tool_count: usize,
    searches: Mutex<Vec<(Option<String>, u32)>>,
}

impl FakeDirectory {
    fn new(tool_count: usize) -> Arc<Self> {
        Arc::new(Self {
            tool_count,
            searches: Mutex::new(Vec::new()),
        })
    }
}

fn catalog_app(slug: &str) -> CatalogApp {
    CatalogApp {
        id: ConnectorId::parse(slug).unwrap(),
        name: slug.to_uppercase(),
        description: None,
        icon_url: None,
        categories: Vec::new(),
        org_setup: None,
    }
}

#[async_trait::async_trait]
impl AppDirectory for FakeDirectory {
    async fn search(
        &self,
        _user: &MacroUserIdStr<'static>,
        search: Option<&str>,
        _cursor: Option<&str>,
        limit: u32,
    ) -> Result<CatalogPage, rootcause::Report> {
        self.searches
            .lock()
            .unwrap()
            .push((search.map(str::to_owned), limit));
        Ok(CatalogPage {
            apps: vec![catalog_app("linear"), catalog_app("notion")],
            next_cursor: None,
        })
    }

    async fn retrieve(
        &self,
        _user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<Option<CatalogApp>, rootcause::Report> {
        Ok(["linear", "notion"]
            .contains(&app.as_str())
            .then(|| catalog_app(app.as_str())))
    }

    async fn tools(
        &self,
        _user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<Vec<AppTool>, rootcause::Report> {
        Ok((0..self.tool_count)
            .map(|index| AppTool {
                name: format!("{app}_{index}"),
                description: String::new(),
            })
            .collect())
    }
}

fn user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{name}@example.com"))
        .unwrap()
        .into_owned()
}

fn app(slug: &str) -> ConnectorId {
    ConnectorId::parse(slug).unwrap()
}

fn catalog(
    fake: &FakeConnectors,
    directory: Arc<FakeDirectory>,
) -> Catalog<crate::domain::service::Connectors> {
    Catalog::new(directory, fake.build())
}

#[tokio::test]
async fn inspect_reports_a_held_app_as_connected() {
    let owner = user("owner");
    let fake = FakeConnectors::new()
        .with_catalog_app("linear")
        .with_connection(&owner, FakeConnection::app("linear"));

    let details = catalog(&fake, FakeDirectory::new(2))
        .inspect(&owner, &app("linear"))
        .await
        .unwrap()
        .unwrap();

    assert_eq!(details.status, Status::Connected);
    assert_eq!(details.tools.len(), 2);
    assert!(!details.tools_truncated);
}

#[tokio::test]
async fn inspect_takes_status_from_the_rules_not_from_a_row() {
    let owner = user("owner");
    let stranger = user("stranger");
    let fake = FakeConnectors::new()
        .with_catalog_app("linear")
        .with_catalog_app("notion")
        .with_connection(&owner, FakeConnection::app("linear").disabled())
        .with_connection(&stranger, FakeConnection::app("notion"));
    let catalog = catalog(&fake, FakeDirectory::new(1));

    let disabled = catalog.inspect(&owner, &app("linear")).await.unwrap();
    let not_held = catalog.inspect(&owner, &app("notion")).await.unwrap();

    assert_eq!(
        disabled.map(|details| details.status),
        Some(Status::Disabled)
    );
    assert_eq!(
        not_held.map(|details| details.status),
        Some(Status::NotConnected)
    );
}

#[tokio::test]
async fn inspect_answers_none_for_an_app_the_catalog_lacks() {
    let fake = FakeConnectors::new();

    let details = catalog(&fake, FakeDirectory::new(1))
        .inspect(&user("owner"), &app("figma"))
        .await
        .unwrap();

    assert_eq!(details, None);
}

#[tokio::test]
async fn inspect_truncates_long_tool_lists() {
    let fake = FakeConnectors::new();

    let details = catalog(&fake, FakeDirectory::new(MAX_TOOLS + 5))
        .inspect(&user("owner"), &app("linear"))
        .await
        .unwrap()
        .unwrap();

    assert_eq!(details.tools.len(), MAX_TOOLS);
    assert!(details.tools_truncated);
}

#[tokio::test]
async fn search_trims_the_query_and_clamps_the_page_size() {
    let fake = FakeConnectors::new();
    let directory = FakeDirectory::new(0);
    let catalog = catalog(&fake, directory.clone());
    let owner = user("owner");

    catalog
        .search(&owner, Some("  "), None, None)
        .await
        .unwrap();
    catalog
        .search(&owner, Some(" lin "), None, Some(500))
        .await
        .unwrap();
    catalog.search(&owner, None, None, Some(0)).await.unwrap();

    assert_eq!(
        *directory.searches.lock().unwrap(),
        vec![
            (None, DEFAULT_PAGE_SIZE),
            (Some("lin".to_owned()), MAX_PAGE_SIZE),
            (None, 1),
        ]
    );
}
