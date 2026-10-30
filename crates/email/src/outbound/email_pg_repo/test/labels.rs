use super::*;
use crate::domain::models::{LabelListVisibility, LabelType, MessageListVisibility};

// ── list_labels_by_link_id ──────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn test_list_labels_by_link_id_returns_all_labels(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    let labels = repo.list_labels_by_link_id(link_id).await?;

    // Fixture has 4 labels for this link: INBOX, UNREAD, STARRED, MyCustomLabel
    assert_eq!(labels.len(), 4);

    // Verify ordering by name
    let names: Vec<&str> = labels.iter().map(|l| l.name.as_str()).collect();
    assert_eq!(names, vec!["INBOX", "MyCustomLabel", "STARRED", "UNREAD"]);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn test_list_labels_by_link_id_field_mapping(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;

    let labels = repo.list_labels_by_link_id(link_id).await?;
    let inbox = labels.iter().find(|l| l.name == "INBOX").unwrap();

    assert_eq!(
        inbox.id,
        Uuid::parse_str("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")?
    );
    assert_eq!(inbox.link_id, link_id);
    assert_eq!(inbox.provider_label_id, "INBOX");
    assert_eq!(inbox.message_list_visibility, MessageListVisibility::Show);
    assert_eq!(inbox.label_list_visibility, LabelListVisibility::LabelShow);
    assert_eq!(inbox.type_, LabelType::System);

    let custom = labels.iter().find(|l| l.name == "MyCustomLabel").unwrap();
    assert_eq!(custom.provider_label_id, "Label_123");
    assert_eq!(custom.type_, LabelType::User);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn test_list_labels_by_link_id_isolates_by_link(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let other_link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb")?;

    let labels = repo.list_labels_by_link_id(other_link_id).await?;

    // The other link has only 1 label in the fixture
    assert_eq!(labels.len(), 1);
    assert_eq!(labels[0].name, "INBOX");
    assert_eq!(labels[0].link_id, other_link_id);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_thread_labels"))
)]
async fn test_list_labels_by_link_id_nonexistent_link(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let fake_link_id = Uuid::parse_str("99999999-9999-9999-9999-999999999999")?;

    let labels = repo.list_labels_by_link_id(fake_link_id).await?;

    assert!(labels.is_empty());

    Ok(())
}

// ── labels_by_thread_ids ────────────────────────────────────────────

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_single_thread(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
    let repo = EmailPgRepo::new(pool);

    let thread_ids = vec![Uuid::parse_str("11111111-1111-1111-1111-111111111111")?];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    assert_eq!(labels.len(), 2, "Thread 1 should have 2 labels");

    let inbox_label = labels.iter().find(|l| l.name == "INBOX");
    assert!(inbox_label.is_some(), "Should have INBOX label");

    let important_label = labels.iter().find(|l| l.name == "IMPORTANT");
    assert!(important_label.is_some(), "Should have IMPORTANT label");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_multiple_threads(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_ids = vec![
        Uuid::parse_str("11111111-1111-1111-1111-111111111111")?,
        Uuid::parse_str("22222222-2222-2222-2222-222222222222")?,
    ];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    // Thread 1 has 2 labels (INBOX, IMPORTANT)
    // Thread 2 has 2 labels (INBOX, SENT)
    // Should get four unique labels as it's distinct across (thread_id, label_id)
    assert_eq!(
        labels.len(),
        4,
        "Should have 4 unique labels across both threads"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_no_duplicate_labels_same_thread(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    // Thread 3 has multiple messages with the same label
    let thread_ids = vec![Uuid::parse_str("33333333-3333-3333-3333-333333333333")?];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    assert_eq!(
        labels.len(),
        1,
        "Should have only 1 label despite multiple messages having it"
    );
    assert_eq!(labels[0].name, "INBOX");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_thread_with_no_labels(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_ids = vec![Uuid::parse_str("44444444-4444-4444-4444-444444444444")?];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    assert_eq!(
        labels.len(),
        0,
        "Thread with no messages/labels should return empty"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_empty_input(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_ids: Vec<Uuid> = vec![];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    assert_eq!(labels.len(), 0, "Empty input should return empty result");

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_labels"))
)]
async fn test_labels_by_thread_ids_different_label_types(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);

    let thread_ids = vec![Uuid::parse_str("55555555-5555-5555-5555-555555555555")?];
    let labels = repo.labels_by_thread_ids(&thread_ids).await?;

    assert_eq!(labels.len(), 2, "Should have both system and user labels");

    let system_label = labels.iter().find(|l| l.name == "INBOX");
    assert!(system_label.is_some());
    assert_eq!(system_label.unwrap().type_, LabelType::System);

    let user_label = labels.iter().find(|l| l.name == "MyCustomLabel");
    assert!(user_label.is_some());
    assert_eq!(user_label.unwrap().type_, LabelType::User);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_labels", "email_labels_pending_tags")
    )
)]
async fn test_labels_by_thread_ids_overlays_pending_tags(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let first = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let second = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;

    let mut labels: Vec<(Uuid, String)> = repo
        .labels_by_thread_ids(&[first, second])
        .await?
        .into_iter()
        .map(|label| (label.thread_id, label.provider_label_id))
        .collect();
    labels.sort();

    assert_eq!(
        labels,
        vec![
            (first, "IMPORTANT".to_owned()),
            (first, "INBOX".to_owned()),
            (first, "Label_123".to_owned()),
            (second, "INBOX".to_owned()),
        ]
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_labels", "email_labels_pending_tags")
    )
)]
async fn test_labels_by_message_ids_overlays_pending_tags(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let first = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?;
    let second = Uuid::parse_str("22222222-aaaa-aaaa-aaaa-222222222222")?;

    let labels = repo.labels_by_message_ids(&[first, second]).await?;
    let provider_ids = |message_id: Uuid| -> Vec<String> {
        labels[&message_id]
            .iter()
            .map(|label| label.provider_label_id.clone())
            .collect()
    };

    assert_eq!(provider_ids(first), vec!["IMPORTANT", "INBOX", "Label_123"]);
    assert_eq!(provider_ids(second), vec!["INBOX"]);

    Ok(())
}

async fn user_label_thread_ids(
    pool: &Pool<Postgres>,
    label_name: &str,
) -> anyhow::Result<Vec<Uuid>> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    let mut thread_ids: Vec<Uuid> = preview_views::user_label::user_label_preview_cursor(
        pool,
        &[link_id],
        50,
        &Query::Sort(SimpleSortMethod::UpdatedAt, ()),
        label_name,
    )
    .await?
    .into_iter()
    .map(|row| row.id)
    .collect();
    thread_ids.sort();
    Ok(thread_ids)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_labels", "email_labels_pending_tags")
    )
)]
async fn test_user_label_preview_includes_pending_tags(pool: Pool<Postgres>) -> anyhow::Result<()> {
    assert_eq!(
        user_label_thread_ids(&pool, "MyCustomLabel").await?,
        vec![
            Uuid::parse_str("11111111-1111-1111-1111-111111111111")?,
            Uuid::parse_str("55555555-5555-5555-5555-555555555555")?,
        ]
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_labels", "email_labels_queued_deletes")
    )
)]
async fn test_labels_by_thread_ids_hides_queued_label_deletes(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let first = Uuid::parse_str("11111111-1111-1111-1111-111111111111")?;
    let second = Uuid::parse_str("22222222-2222-2222-2222-222222222222")?;
    let fifth = Uuid::parse_str("55555555-5555-5555-5555-555555555555")?;

    let mut labels: Vec<(Uuid, String)> = repo
        .labels_by_thread_ids(&[first, second, fifth])
        .await?
        .into_iter()
        .map(|label| (label.thread_id, label.provider_label_id))
        .collect();
    labels.sort();

    assert_eq!(
        labels,
        vec![
            (first, "IMPORTANT".to_owned()),
            (first, "INBOX".to_owned()),
            (second, "INBOX".to_owned()),
            (second, "SENT".to_owned()),
            (fifth, "INBOX".to_owned()),
        ]
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_labels", "email_labels_queued_deletes")
    )
)]
async fn test_labels_by_message_ids_hides_queued_label_deletes(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool);
    let first = Uuid::parse_str("11111111-aaaa-aaaa-aaaa-111111111111")?;
    let second = Uuid::parse_str("22222222-aaaa-aaaa-aaaa-222222222222")?;
    let fifth = Uuid::parse_str("55555555-aaaa-aaaa-aaaa-555555555555")?;

    let labels = repo.labels_by_message_ids(&[first, second, fifth]).await?;
    let provider_ids = |message_id: Uuid| -> Vec<String> {
        labels[&message_id]
            .iter()
            .map(|label| label.provider_label_id.clone())
            .collect()
    };

    assert_eq!(provider_ids(first), vec!["IMPORTANT", "INBOX"]);
    assert_eq!(provider_ids(second), vec!["INBOX", "SENT"]);
    assert_eq!(provider_ids(fifth), vec!["INBOX"]);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_labels", "email_labels_queued_deletes")
    )
)]
async fn test_user_label_preview_hides_queued_label_deletes(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    assert!(
        user_label_thread_ids(&pool, "MyCustomLabel")
            .await?
            .is_empty()
    );

    Ok(())
}

fn relation_scans<'a>(
    node: &'a serde_json::Value,
    relation: &str,
    scans: &mut Vec<&'a serde_json::Value>,
) {
    if node["Relation Name"] == relation {
        scans.push(node);
    }
    for child in node["Plans"].as_array().into_iter().flatten() {
        relation_scans(child, relation, scans);
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_labels", "email_labels_bulk")
    )
)]
async fn test_labels_by_thread_ids_reads_labels_by_message_index(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let thread_ids = vec![Uuid::parse_str("11111111-1111-1111-1111-111111111111")?];

    let plan = sqlx::query_scalar!(
        r#"EXPLAIN (FORMAT JSON)
        SELECT DISTINCT ON (l.id, m.thread_id) l.id, m.thread_id
        FROM email_messages m
        JOIN email_effective_message_labels ml ON m.id = ml.message_id
        JOIN email_labels l ON ml.label_id = l.id
        WHERE m.thread_id = ANY($1)"#,
        &thread_ids,
    )
    .fetch_one(&pool)
    .await?
    .expect("EXPLAIN returns a JSON plan");

    let mut scans = Vec::new();
    relation_scans(&plan[0]["Plan"], "email_message_labels", &mut scans);
    assert!(
        !scans.is_empty(),
        "plan must read email_message_labels: {plan}"
    );
    for scan in scans {
        let condition = scan["Index Cond"]
            .as_str()
            .or(scan["Recheck Cond"].as_str());
        assert!(
            condition.is_some_and(|cond| cond.contains("message_id")),
            "thread label lookups must probe email_message_labels by message_id: {plan}"
        );
    }

    Ok(())
}
