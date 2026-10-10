use super::*;
use crate::domain::models::Initiator;
use uuid::Uuid;

fn now() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-10-08T12:00:00Z")
        .unwrap()
        .to_utc()
}

fn days_ago(days: i64) -> String {
    (now() - Duration::days(days)).to_rfc3339()
}

fn row(source: ImportSource, id: &str, metadata: serde_json::Value) -> ImportEntity {
    ImportEntity {
        id: Uuid::now_v7(),
        user_id: "macro|dana@example.com".into(),
        team_id: None,
        source,
        foreign_id: id.into(),
        status: ImportStatus::Imported,
        initiator: Initiator::Onboarding,
        metadata,
        entity_id: Some(format!("doc-{id}")),
        entity_type: Some(source.entity_type().into()),
        last_error: None,
        created_at: now(),
        updated_at: now(),
    }
}

fn notion(id: &str, edited_days_ago: i64, edited_by_user: Option<bool>) -> ImportEntity {
    row(
        ImportSource::Notion,
        id,
        serde_json::json!({
            "title": format!("Page {id}"),
            "url": format!("https://www.notion.so/{id}"),
            "last_edited_time": days_ago(edited_days_ago),
            "edited_by_user": edited_by_user,
        }),
    )
}

fn linear(id: &str, updated_days_ago: i64, state: &str) -> ImportEntity {
    row(
        ImportSource::Linear,
        id,
        serde_json::json!({
            "title": format!("Issue {id}"),
            "state_type": state,
            "updated_at": days_ago(updated_days_ago),
        }),
    )
}

fn ids(selected: &[ActiveImport]) -> Vec<&str> {
    selected
        .iter()
        .map(|item| item.entity_id.as_str())
        .collect()
}

#[test]
fn notion_pages_count_when_the_user_edited_them_within_two_weeks() {
    let rows = vec![
        notion("mine-old", 20, Some(true)),
        notion("mine-new", 2, Some(true)),
        notion("teammate", 1, Some(false)),
        notion("workspace-bot", 3, None),
        notion("mine-newest", 0, Some(true)),
    ];
    let selected = select_active_imports(&rows, now());
    assert_eq!(
        ids(&selected),
        ["doc-mine-newest", "doc-mine-new", "doc-workspace-bot"]
    );
    assert_eq!(selected[0].name, "Page mine-newest");
}

#[test]
fn linear_issues_count_when_started_or_recently_updated() {
    let rows = vec![
        linear("backlog-old", 30, "backlog"),
        linear("started-old", 60, "started"),
        linear("todo-recent", 5, "unstarted"),
    ];
    assert_eq!(
        ids(&select_active_imports(&rows, now())),
        ["doc-todo-recent", "doc-started-old"]
    );
}

#[test]
fn at_most_ten_per_run_and_only_imported_rows() {
    let mut rows: Vec<ImportEntity> = (0..13)
        .map(|n| notion(&format!("n{n:02}"), n, Some(true)))
        .collect();
    rows[0].status = ImportStatus::Staged;
    let selected = select_active_imports(&rows, now());
    assert_eq!(
        ids(&selected),
        (1..=10).map(|n| format!("doc-n{n:02}")).collect::<Vec<_>>()
    );
}
