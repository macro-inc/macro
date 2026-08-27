use super::*;
use crate::domain::models::CatalogEntry;
use std::sync::Mutex;

/// Fake directory returning a canned page and recording the query it got.
struct FakeDirectory {
    page: CatalogPage,
    seen: Mutex<Vec<(Option<String>, Option<String>, u32)>>,
}

impl FakeDirectory {
    fn returning(entries: Vec<CatalogEntry>) -> Self {
        Self {
            page: CatalogPage {
                entries,
                next_cursor: None,
            },
            seen: Mutex::new(Vec::new()),
        }
    }
}

impl ConnectorDirectory for FakeDirectory {
    async fn search(
        &self,
        search: Option<&str>,
        cursor: Option<&str>,
        limit: u32,
    ) -> anyhow::Result<CatalogPage> {
        self.seen.lock().unwrap().push((
            search.map(str::to_owned),
            cursor.map(str::to_owned),
            limit,
        ));
        Ok(self.page.clone())
    }
}

fn directory_entry(app_slug: &str) -> CatalogEntry {
    CatalogEntry {
        app_slug: app_slug.to_owned(),
        display_name: app_slug.to_owned(),
        description: Some("from the directory".to_owned()),
        icon_url: None,
    }
}

#[tokio::test]
async fn directory_results_pass_through_in_order() {
    let directory =
        FakeDirectory::returning(vec![directory_entry("slack"), directory_entry("airtable")]);

    let page = browse_catalog(&directory, None, None, None).await.unwrap();

    let slugs: Vec<_> = page.entries.iter().map(|e| e.app_slug.as_str()).collect();
    assert_eq!(slugs, ["slack", "airtable"]);
}

#[tokio::test]
async fn search_is_trimmed_and_forwarded() {
    let directory = FakeDirectory::returning(vec![]);

    browse_catalog(&directory, Some("  linear  "), Some("cursor-1"), Some(5))
        .await
        .unwrap();

    let seen = directory.seen.lock().unwrap();
    let (search, cursor, limit) = seen[0].clone();
    assert_eq!(search.as_deref(), Some("linear"));
    assert_eq!(cursor.as_deref(), Some("cursor-1"));
    assert_eq!(limit, 5);
}

#[tokio::test]
async fn blank_search_browses_and_limit_is_clamped() {
    let directory = FakeDirectory::returning(vec![]);

    browse_catalog(&directory, Some("   "), None, Some(9999))
        .await
        .unwrap();

    let seen = directory.seen.lock().unwrap();
    let (search, cursor, limit) = seen[0].clone();
    assert_eq!(search, None, "whitespace-only search means browse");
    assert_eq!(cursor, None);
    assert_eq!(limit, MAX_PAGE_SIZE);
}
