use super::*;
use chrono::Duration;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::SimpleSortMethod;
use models_soup::{chat::SoupChat, document::SoupDocument, project::SoupProject};
use uuid::Uuid;

fn test_user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap()
}

fn make_document_item(updated_at: DateTime<Utc>, name: &str) -> FrecencySoupItem {
    FrecencySoupItem {
        item: SoupItem::Document(SoupDocument {
            id: Uuid::new_v4(),
            document_version_id: 1,
            owner_id: test_user_id(),
            name: name.to_string(),
            file_type: Some("pdf".to_string()),
            sha: None,
            project_id: None,
            branched_from_id: None,
            branched_from_version_id: None,
            document_family_id: None,
            created_at: updated_at,
            updated_at,
            viewed_at: None,
            sub_type: None,
            deleted_at: None,
            properties: vec![],
        }),
        frecency_score: None,
    }
}

fn make_chat_item(updated_at: DateTime<Utc>, name: &str) -> FrecencySoupItem {
    FrecencySoupItem {
        item: SoupItem::Chat(SoupChat {
            id: Uuid::new_v4(),
            name: name.to_string(),
            owner_id: test_user_id(),
            project_id: None,
            is_persistent: false,
            created_at: updated_at,
            updated_at,
            viewed_at: None,
            deleted_at: None,
            properties: vec![],
        }),
        frecency_score: None,
    }
}

fn make_project_item(updated_at: DateTime<Utc>, name: &str) -> FrecencySoupItem {
    FrecencySoupItem {
        item: SoupItem::Project(SoupProject {
            id: Uuid::new_v4(),
            name: name.to_string(),
            owner_id: test_user_id(),
            parent_id: None,
            created_at: updated_at,
            updated_at,
            viewed_at: None,
            deleted_at: None,
            properties: vec![],
        }),
        frecency_score: None,
    }
}

#[test]
fn test_group_by_date_buckets() {
    let now = Utc::now();
    let items = vec![
        make_document_item(now, "Today Doc"),
        make_document_item(now - Duration::days(1), "Yesterday Doc"),
        make_document_item(now - Duration::days(3), "This Week Doc"),
        make_document_item(now - Duration::days(10), "Last Week Doc"),
    ];

    let config = GroupingConfig::new(GroupByField::Date);
    let limits = GroupedPaginationLimits {
        per_group: 10,
        total: 100,
    };
    let response = group_items(items, &config, None, limits, SimpleSortMethod::UpdatedAt).unwrap();

    assert_eq!(response.groups.len(), 4);
    assert_eq!(response.groups[0].key, "today");
    assert_eq!(response.groups[1].key, "yesterday");
    assert_eq!(response.groups[2].key, "this_week");
    assert_eq!(response.groups[3].key, "last_week");
}

#[test]
fn test_group_by_entity_type() {
    let now = Utc::now();
    let items = vec![
        make_document_item(now, "Doc 1"),
        make_chat_item(now, "Chat 1"),
        make_project_item(now, "Project 1"),
        make_document_item(now, "Doc 2"),
    ];

    let config = GroupingConfig::new(GroupByField::EntityType);
    let limits = GroupedPaginationLimits {
        per_group: 10,
        total: 100,
    };
    let response = group_items(items, &config, None, limits, SimpleSortMethod::UpdatedAt).unwrap();

    assert_eq!(response.groups.len(), 3);

    let chat_group = response.groups.iter().find(|g| g.key == "chat").unwrap();
    assert_eq!(chat_group.total_count, 1);
    assert_eq!(chat_group.label, "Chats");

    let doc_group = response
        .groups
        .iter()
        .find(|g| g.key == "document")
        .unwrap();
    assert_eq!(doc_group.total_count, 2);
    assert_eq!(doc_group.label, "Documents");

    let project_group = response.groups.iter().find(|g| g.key == "project").unwrap();
    assert_eq!(project_group.total_count, 1);
    assert_eq!(project_group.label, "Projects");
}

#[test]
fn test_per_group_limit() {
    let now = Utc::now();
    let items: Vec<_> = (0..20)
        .map(|i| make_document_item(now - Duration::hours(i), &format!("Doc {}", i)))
        .collect();

    let config = GroupingConfig::new(GroupByField::Date).with_limit(5);
    let limits = GroupedPaginationLimits {
        per_group: 5,
        total: 100,
    };
    let response = group_items(items, &config, None, limits, SimpleSortMethod::UpdatedAt).unwrap();

    // Should have at most 5 items per group
    for group in &response.groups {
        assert!(group.page_count <= 5);
    }
}

#[test]
fn test_group_key_filter() {
    let now = Utc::now();
    let items = vec![
        make_document_item(now, "Today Doc 1"),
        make_document_item(now - Duration::days(1), "Yesterday Doc 1"),
        make_document_item(now - Duration::days(1), "Yesterday Doc 2"),
    ];

    let config = GroupingConfig::new(GroupByField::Date).with_group_key("yesterday");
    let limits = GroupedPaginationLimits {
        per_group: 10,
        total: 100,
    };
    let response = group_items(items, &config, None, limits, SimpleSortMethod::UpdatedAt).unwrap();

    assert_eq!(response.groups.len(), 1);
    assert_eq!(response.groups[0].key, "yesterday");
    assert_eq!(response.items.len(), 2);
}

#[test]
fn test_total_limit() {
    let now = Utc::now();
    let items: Vec<_> = (0..50)
        .map(|i| make_document_item(now - Duration::hours(i), &format!("Doc {}", i)))
        .collect();

    let config = GroupingConfig::new(GroupByField::Date);
    let limits = GroupedPaginationLimits {
        per_group: 100,
        total: 10,
    };
    let response = group_items(items, &config, None, limits, SimpleSortMethod::UpdatedAt).unwrap();

    assert_eq!(response.items.len(), 10);
}

#[test]
fn test_pagination_cursor() {
    let now = Utc::now();

    let config = GroupingConfig::new(GroupByField::Date).with_limit(3);
    let limits = GroupedPaginationLimits {
        per_group: 3,
        total: 10,
    };

    // Generate items for first page
    let items1: Vec<_> = (0..30)
        .map(|i| make_document_item(now - Duration::hours(i), &format!("Doc {}", i)))
        .collect();

    // First page
    let response1 =
        group_items(items1, &config, None, limits, SimpleSortMethod::UpdatedAt).unwrap();
    assert!(response1.next_cursor.is_some());

    // Generate items for second page (same pattern)
    let items2: Vec<_> = (0..30)
        .map(|i| make_document_item(now - Duration::hours(i), &format!("Doc {}", i)))
        .collect();

    // Second page
    let response2 = group_items(
        items2,
        &config,
        response1.next_cursor.as_ref(),
        limits,
        SimpleSortMethod::UpdatedAt,
    )
    .unwrap();

    // With fresh items and cursor, second page should have different group positions
    // (items start at offset from cursor)
    assert!(!response2.items.is_empty());
}

#[test]
fn test_group_metadata() {
    let now = Utc::now();
    let items = vec![
        make_document_item(now, "Today Doc 1"),
        make_document_item(now, "Today Doc 2"),
        make_document_item(now - Duration::days(1), "Yesterday Doc"),
    ];

    let config = GroupingConfig::new(GroupByField::Date);
    let limits = GroupedPaginationLimits {
        per_group: 10,
        total: 100,
    };
    let response = group_items(items, &config, None, limits, SimpleSortMethod::UpdatedAt).unwrap();

    let today = response.groups.iter().find(|g| g.key == "today").unwrap();
    assert_eq!(today.total_count, 2);
    assert_eq!(today.page_count, 2);
    assert_eq!(today.start_index, 0);
    assert_eq!(today.label, "Today");
    assert_eq!(today.display_order, Some(0));

    let yesterday = response
        .groups
        .iter()
        .find(|g| g.key == "yesterday")
        .unwrap();
    assert_eq!(yesterday.total_count, 1);
    assert_eq!(yesterday.start_index, 2);
}

#[test]
fn test_empty_items() {
    let items: Vec<FrecencySoupItem> = vec![];
    let config = GroupingConfig::new(GroupByField::Date);
    let limits = GroupedPaginationLimits::default();
    let response = group_items(items, &config, None, limits, SimpleSortMethod::UpdatedAt).unwrap();

    assert!(response.items.is_empty());
    assert!(response.groups.is_empty());
    assert!(response.next_cursor.is_none());
}
