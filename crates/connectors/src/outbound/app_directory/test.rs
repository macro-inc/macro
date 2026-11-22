use super::*;
use crate::outbound::pipedream::domain::service::discovery::ConnectorTool;
use macro_user_id::cowlike::CowLike as _;

/// A directory holding `slack`, its alias `slack_v2`, and an entry whose
/// slug names no app.
struct FakeDirectory;

fn entry(slug: &str) -> CatalogEntry {
    CatalogEntry {
        app_slug: slug.to_owned(),
        display_name: slug.to_uppercase(),
        description: None,
        icon_url: None,
        categories: Vec::new(),
    }
}

impl ConnectorDirectory for FakeDirectory {
    async fn search(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _search: Option<&str>,
        _cursor: Option<&str>,
        _limit: u32,
    ) -> anyhow::Result<crate::outbound::pipedream::domain::models::CatalogPage> {
        Ok(crate::outbound::pipedream::domain::models::CatalogPage {
            entries: vec![
                entry("slack"),
                entry("slack_v2"),
                entry("Not A Slug"),
                entry("linear"),
            ],
            next_cursor: Some("next".to_owned()),
        })
    }

    async fn retrieve(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> anyhow::Result<Option<CatalogEntry>> {
        Ok((app_slug == "linear").then(|| entry("linear")))
    }
}

impl ConnectorCapabilities for FakeDirectory {
    async fn tools(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> anyhow::Result<Vec<ConnectorTool>> {
        Ok(vec![ConnectorTool {
            name: format!("{app_slug}_search"),
            description: "Search".to_owned(),
        }])
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|browser@example.com")
        .unwrap()
        .into_owned()
}

fn app(slug: &str) -> ConnectorId {
    ConnectorId::parse(slug).unwrap()
}

#[tokio::test]
async fn a_page_lists_each_app_once_and_skips_entries_that_name_none() {
    let directory = HostedAppDirectory::new(Arc::new(FakeDirectory));

    let page = directory.search(&user(), None, None, 20).await.unwrap();

    let ids: Vec<_> = page.apps.iter().map(|app| app.id.clone()).collect();
    assert_eq!(ids, vec![app("slack"), app("linear")]);
    assert_eq!(page.next_cursor.as_deref(), Some("next"));
}

#[tokio::test]
async fn retrieve_and_tools_go_by_the_app_slug() {
    let directory = HostedAppDirectory::new(Arc::new(FakeDirectory));

    let found = directory.retrieve(&user(), &app("linear")).await.unwrap();
    let missing = directory.retrieve(&user(), &app("figma")).await.unwrap();
    let tools = directory.tools(&user(), &app("linear")).await.unwrap();

    assert_eq!(found.map(|found| found.name), Some("LINEAR".to_owned()));
    assert_eq!(missing, None);
    assert_eq!(
        tools.first().map(|tool| tool.name.as_str()),
        Some("linear_search")
    );
}
