use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::gmail::gmail_ops::ModifyMessageLabelsPayload;

const THREAD: Uuid = Uuid::from_u128(0xb1);
const ARCHIVE: Uuid = Uuid::from_u128(0xf1);
const UNARCHIVE: Uuid = Uuid::from_u128(0xf2);

async fn messages_with_label(pool: &PgPool, provider_label_id: &str) -> Vec<Uuid> {
    sqlx::query_scalar!(
        r#"
        SELECT ml.message_id FROM email_message_labels ml
        JOIN email_labels l ON l.id = ml.label_id
        WHERE l.provider_label_id = $1
        ORDER BY ml.message_id
        "#,
        provider_label_id
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn pending_markers(pool: &PgPool) -> Vec<(Uuid, Uuid)> {
    sqlx::query!(
        "SELECT message_id, write_id FROM email_gmail_pending_label_writes ORDER BY message_id, seq"
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|marker| (marker.message_id, marker.write_id))
    .collect()
}

async fn thread_state(pool: &PgPool) -> (bool, bool) {
    let thread = sqlx::query!(
        "SELECT inbox_visible, is_read FROM email_threads WHERE id = $1",
        THREAD
    )
    .fetch_one(pool)
    .await
    .unwrap();
    (thread.inbox_visible, thread.is_read)
}

async fn link(pool: &PgPool) -> Link {
    email_db_client::links::get::fetch_link_by_id(pool, Uuid::from_u128(0xa1))
        .await
        .unwrap()
        .unwrap()
}

fn message(id: u128) -> GmailMessageRef {
    GmailMessageRef {
        db_message_id: Uuid::from_u128(id),
        provider_message_id: format!("msg-{}", char::from_digit(id as u32, 16).unwrap()),
    }
}

fn inbox_write(
    write_id: Uuid,
    present: bool,
    messages: Vec<GmailMessageRef>,
) -> ModifyMessageLabelsBatchPayload {
    let label = vec!["INBOX".to_string()];
    ModifyMessageLabelsBatchPayload {
        messages,
        labels_to_add: if present { label.clone() } else { vec![] },
        labels_to_remove: if present { vec![] } else { label },
        pending_write_id: Some(write_id),
    }
}

/// A newer write unarchives message B locally, as staging does.
async fn unarchive_b(pool: &PgPool) {
    let mut tx = pool.begin().await.unwrap();
    sqlx::query!(
        "INSERT INTO email_message_labels (message_id, label_id) VALUES ($1, $2)",
        Uuid::from_u128(0xb),
        Uuid::from_u128(0xc1),
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    pending_writes::mark_pending_label_writes(
        &mut *tx,
        Uuid::from_u128(0xa1),
        &[Uuid::from_u128(0xb)],
        "INBOX",
        true,
        UNARCHIVE,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
}

fn message_ids(payload: &ModifyMessageLabelsBatchPayload) -> Vec<Uuid> {
    payload
        .messages
        .iter()
        .map(|message| message.db_message_id)
        .collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("gmail_ops_label_revert"))
)]
async fn an_older_write_waits_for_a_newer_one_and_sends_once_gmail_rejects_it(pool: PgPool) {
    unarchive_b(&pool).await;
    let archive = inbox_write(
        ARCHIVE,
        false,
        vec![message(0xa), message(0xb), message(0xc)],
    );
    let turns = label_write_turns(&pool, &archive, &message_ids(&archive), ARCHIVE)
        .await
        .unwrap();
    assert_eq!(turns[&Uuid::from_u128(0xa)], LabelWriteTurn::Send);
    assert_eq!(turns[&Uuid::from_u128(0xb)], LabelWriteTurn::Wait);

    revert_db_changes(
        &pool,
        &link(&pool).await,
        &inbox_write(UNARCHIVE, true, vec![message(0xb)]),
        vec![Uuid::from_u128(0xb)],
    )
    .await
    .unwrap();

    // B is archived again, and the archive now sends it with the others.
    assert!(messages_with_label(&pool, "INBOX").await.is_empty());
    let turns = label_write_turns(&pool, &archive, &message_ids(&archive), ARCHIVE)
        .await
        .unwrap();
    assert!(turns.values().all(|turn| *turn == LabelWriteTurn::Send));
    assert_eq!(thread_state(&pool).await, (false, true));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("gmail_ops_label_revert"))
)]
async fn a_confirmed_newer_write_supersedes_the_older_one(pool: PgPool) {
    unarchive_b(&pool).await;
    let mut tx = pool.begin().await.unwrap();
    pending_writes::confirm_pending_label_writes(&mut tx, &[Uuid::from_u128(0xb)], UNARCHIVE)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let archive = inbox_write(ARCHIVE, false, vec![message(0xa), message(0xb)]);
    let turns = label_write_turns(&pool, &archive, &message_ids(&archive), ARCHIVE)
        .await
        .unwrap();
    assert_eq!(turns[&Uuid::from_u128(0xa)], LabelWriteTurn::Send);
    assert_eq!(turns[&Uuid::from_u128(0xb)], LabelWriteTurn::Superseded);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("gmail_ops_label_revert"))
)]
async fn rejected_batch_reverts_only_the_messages_its_write_was_newest_on(pool: PgPool) {
    unarchive_b(&pool).await;

    revert_db_changes(
        &pool,
        &link(&pool).await,
        &inbox_write(ARCHIVE, false, vec![message(0xa), message(0xb)]),
        vec![Uuid::from_u128(0xa), Uuid::from_u128(0xb)],
    )
    .await
    .unwrap();

    // B keeps the newer unarchive; C was not in this batch.
    assert_eq!(
        messages_with_label(&pool, "INBOX").await,
        vec![Uuid::from_u128(0xa), Uuid::from_u128(0xb)]
    );
    assert_eq!(
        pending_markers(&pool).await,
        vec![
            (Uuid::from_u128(0xb), UNARCHIVE),
            (Uuid::from_u128(0xc), ARCHIVE),
        ]
    );
    assert_eq!(thread_state(&pool).await, (true, true));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("gmail_ops_label_revert"))
)]
async fn rejected_mark_read_restores_the_unread_message_and_thread(pool: PgPool) {
    let mark_read = Uuid::from_u128(0xf3);
    sqlx::query!(
        r#"
        INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
        VALUES ($1, $2, 'UNREAD', 'UNREAD', 'Show', 'LabelShow', 'System', NOW())
        "#,
        Uuid::from_u128(0xc2),
        Uuid::from_u128(0xa1),
    )
    .execute(&pool)
    .await
    .unwrap();
    pending_writes::mark_pending_label_writes(
        &pool,
        Uuid::from_u128(0xa1),
        &[Uuid::from_u128(0xa)],
        "UNREAD",
        false,
        mark_read,
    )
    .await
    .unwrap();
    let batch = ModifyMessageLabelsBatchPayload {
        messages: vec![message(0xa)],
        labels_to_add: vec![],
        labels_to_remove: vec!["UNREAD".to_string()],
        pending_write_id: Some(mark_read),
    };

    revert_db_changes(
        &pool,
        &link(&pool).await,
        &batch,
        vec![Uuid::from_u128(0xa)],
    )
    .await
    .unwrap();

    assert_eq!(
        messages_with_label(&pool, "UNREAD").await,
        vec![Uuid::from_u128(0xa)]
    );
    let is_read = sqlx::query_scalar!(
        "SELECT is_read FROM email_messages WHERE id = $1",
        Uuid::from_u128(0xa)
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!is_read);
    assert_eq!(thread_state(&pool).await, (false, false));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("gmail_ops_label_revert"))
)]
async fn rejected_single_message_operation_reverts_its_message(pool: PgPool) {
    let batch = ModifyMessageLabelsBatchPayload::from(ModifyMessageLabelsPayload {
        db_message_id: Uuid::from_u128(0xc),
        provider_message_id: "msg-c".to_string(),
        labels_to_add: vec![],
        labels_to_remove: vec!["INBOX".to_string()],
        pending_write_id: Some(ARCHIVE),
    });

    revert_db_changes(
        &pool,
        &link(&pool).await,
        &batch,
        vec![Uuid::from_u128(0xc)],
    )
    .await
    .unwrap();

    assert_eq!(
        messages_with_label(&pool, "INBOX").await,
        vec![Uuid::from_u128(0xc)]
    );
    assert_eq!(
        pending_markers(&pool).await,
        vec![
            (Uuid::from_u128(0xa), ARCHIVE),
            (Uuid::from_u128(0xb), ARCHIVE),
        ]
    );
}
