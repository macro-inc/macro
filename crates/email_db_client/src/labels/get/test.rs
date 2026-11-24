use crate::labels::get::{
    fetch_message_labels_in_bulk, fetch_thread_ids_by_provider_label_ids, messages_changing_label,
};
use anyhow::Result;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::db::label::{LabelListVisibility, LabelType, MessageListVisibility};
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn fetch_message_labels_in_bulk_returns_labels_grouped_by_message_id(
    pool: Pool<Postgres>,
) -> Result<()> {
    const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS;

    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-000000008501")?;
    let message_id_2 = Uuid::parse_str("00000000-0000-0000-0000-000000008502")?;

    let result = fetch_message_labels_in_bulk(&pool, &[message_id_1, message_id_2]).await?;

    assert_eq!(result.len(), 2);

    // Message 1 should have 2 labels
    let msg_1_labels = result.get(&message_id_1).unwrap();
    assert_eq!(msg_1_labels.len(), 2);

    // Message 2 should have 1 label
    let msg_2_labels = result.get(&message_id_2).unwrap();
    assert_eq!(msg_2_labels.len(), 1);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn fetch_message_labels_in_bulk_returns_correct_label_data(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-000000008501")?;
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000801")?;

    let result = fetch_message_labels_in_bulk(&pool, &[message_id_1]).await?;

    let msg_1_labels = result.get(&message_id_1).unwrap();

    // Find INBOX label
    let inbox_label = msg_1_labels.iter().find(|l| l.name == "INBOX").unwrap();

    assert_eq!(
        inbox_label.id,
        Uuid::parse_str("00000000-0000-0000-0000-000000018001")?
    );
    assert_eq!(inbox_label.link_id, link_id);
    assert_eq!(inbox_label.provider_label_id, "INBOX");
    assert_eq!(
        inbox_label.message_list_visibility,
        MessageListVisibility::Show
    );
    assert_eq!(
        inbox_label.label_list_visibility,
        LabelListVisibility::LabelShow
    );
    assert_eq!(inbox_label.type_, LabelType::System);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn fetch_message_labels_in_bulk_returns_user_labels(pool: Pool<Postgres>) -> Result<()> {
    let message_id_1 = Uuid::parse_str("00000000-0000-0000-0000-000000008501")?;

    let result = fetch_message_labels_in_bulk(&pool, &[message_id_1]).await?;

    let msg_1_labels = result.get(&message_id_1).unwrap();

    // Find Work label (user label)
    let work_label = msg_1_labels.iter().find(|l| l.name == "Work").unwrap();

    assert_eq!(work_label.provider_label_id, "Label_Work");
    assert_eq!(work_label.type_, LabelType::User);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn fetch_message_labels_in_bulk_excludes_messages_without_labels(
    pool: Pool<Postgres>,
) -> Result<()> {
    let message_with_labels = Uuid::parse_str("00000000-0000-0000-0000-000000008501")?;
    let message_without_labels = Uuid::parse_str("00000000-0000-0000-0000-000000008503")?;

    let result =
        fetch_message_labels_in_bulk(&pool, &[message_with_labels, message_without_labels]).await?;

    // Only message with labels should be in the map
    assert_eq!(result.len(), 1);
    assert!(result.contains_key(&message_with_labels));
    assert!(!result.contains_key(&message_without_labels));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn fetch_message_labels_in_bulk_returns_empty_for_empty_input(
    pool: Pool<Postgres>,
) -> Result<()> {
    let result = fetch_message_labels_in_bulk(&pool, &[]).await?;

    assert!(result.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn fetch_message_labels_in_bulk_returns_empty_for_nonexistent_messages(
    pool: Pool<Postgres>,
) -> Result<()> {
    let nonexistent_message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000ffff")?;

    let result = fetch_message_labels_in_bulk(&pool, &[nonexistent_message_id]).await?;

    assert!(result.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn messages_changing_label_skips_messages_already_in_the_requested_state(
    pool: Pool<Postgres>,
) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000801")?;
    let in_inbox = Uuid::parse_str("00000000-0000-0000-0000-000000008501")?;
    let important = Uuid::parse_str("00000000-0000-0000-0000-000000008502")?;
    let unlabeled = Uuid::parse_str("00000000-0000-0000-0000-000000008503")?;
    let messages = [in_inbox, important, unlabeled];

    let mut gaining = messages_changing_label(&pool, link_id, &messages, "INBOX", true).await?;
    gaining.sort();
    assert_eq!(gaining, vec![important, unlabeled]);
    assert_eq!(
        messages_changing_label(&pool, link_id, &messages, "INBOX", false).await?,
        vec![in_inbox]
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("fetch_message_labels_in_bulk"))
)]
async fn threads_by_provider_label_are_distinct_and_limited_to_the_inbox(
    pool: Pool<Postgres>,
) -> Result<()> {
    let link_id = Uuid::parse_str("00000000-0000-0000-0000-000000000801")?;
    let thread_id = Uuid::parse_str("00000000-0000-0000-0000-000000008201")?;
    let other_link = Uuid::parse_str("00000000-0000-0000-0000-000000000802")?;
    let other_thread = Uuid::parse_str("00000000-0000-0000-0000-000000008202")?;

    // Another inbox holds a label with the same provider id.
    sqlx::query(
        r#"
        WITH link AS (
            INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
            VALUES ($1, 'macro|other_labels_user@example.com', $1, 'other_labels_user@example.com', 'GMAIL', true, NOW(), NOW())
        ), thread AS (
            INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
            VALUES ($2, $1, true, false, NOW(), NOW())
        ), message AS (
            INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
            VALUES ($3, $2, $1, 'provider-msg-8601', false, false, false, false, false, NOW(), NOW())
        ), label AS (
            INSERT INTO email_labels (id, link_id, provider_label_id, name, type)
            VALUES ($4, $1, 'INBOX', 'INBOX', 'System')
        )
        INSERT INTO email_message_labels (message_id, label_id) VALUES ($3, $4)
        "#,
    )
    .bind(other_link)
    .bind(other_thread)
    .bind(Uuid::parse_str("00000000-0000-0000-0000-000000008601")?)
    .bind(Uuid::parse_str("00000000-0000-0000-0000-000000018101")?)
    .execute(&pool)
    .await?;

    // Two messages of one thread carry one of the labels each.
    assert_eq!(
        fetch_thread_ids_by_provider_label_ids(
            &pool,
            link_id,
            &["INBOX".to_string(), "IMPORTANT".to_string()]
        )
        .await?,
        vec![thread_id]
    );
    assert_eq!(
        fetch_thread_ids_by_provider_label_ids(&pool, other_link, &["INBOX".to_string()]).await?,
        vec![other_thread]
    );
    assert!(
        fetch_thread_ids_by_provider_label_ids(&pool, link_id, &["Label_Personal".to_string()])
            .await?
            .is_empty()
    );
    assert!(
        fetch_thread_ids_by_provider_label_ids(&pool, link_id, &[])
            .await?
            .is_empty()
    );

    Ok(())
}
