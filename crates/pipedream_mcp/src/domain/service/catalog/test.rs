use super::*;
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
        priority: false,
    }
}

#[tokio::test]
async fn first_page_pins_priority_connectors_before_directory_results() {
    let directory = FakeDirectory::returning(vec![directory_entry("airtable")]);

    let page = browse_catalog(&directory, None, None, None).await.unwrap();

    let split = page.entries.iter().position(|e| !e.priority).unwrap();
    assert_eq!(split, PRIORITY_CONNECTORS.len());
    assert!(page.entries[..split].iter().all(|e| e.priority));
    assert_eq!(page.entries[split].app_slug, "airtable");
}

#[tokio::test]
async fn directory_duplicates_of_priority_connectors_are_dropped() {
    let directory =
        FakeDirectory::returning(vec![directory_entry("linear"), directory_entry("airtable")]);

    let page = browse_catalog(&directory, None, None, None).await.unwrap();

    let linear: Vec<_> = page
        .entries
        .iter()
        .filter(|e| e.app_slug == "linear")
        .collect();
    assert_eq!(linear.len(), 1, "Linear must appear exactly once");
    assert!(linear[0].priority);
    assert_eq!(
        linear[0].description.as_deref(),
        Some("Create and update issues without leaving Macro."),
        "priority tagline wins over the directory description"
    );
}

#[tokio::test]
async fn search_filters_priority_connectors_and_marks_them() {
    let directory = FakeDirectory::returning(vec![directory_entry("linear_helper")]);

    let page = browse_catalog(&directory, Some("linear"), None, None)
        .await
        .unwrap();

    assert_eq!(page.entries[0].display_name, "Linear");
    assert!(page.entries[0].priority);
    assert_eq!(
        page.entries.iter().filter(|e| e.priority).count(),
        1,
        "only the matching priority connector is pinned"
    );
    assert_eq!(page.entries[1].app_slug, "linear_helper");
}

#[tokio::test]
async fn later_pages_never_repeat_priority_connectors() {
    let directory = FakeDirectory::returning(vec![directory_entry("linear")]);

    let page = browse_catalog(&directory, None, Some("cursor-1"), None)
        .await
        .unwrap();

    assert!(
        page.entries.is_empty(),
        "priority connectors are neither pinned nor repeated on later pages"
    );
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
