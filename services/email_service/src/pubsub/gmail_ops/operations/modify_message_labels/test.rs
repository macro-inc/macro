use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::gmail::gmail_ops::{GmailMessageRef, ModifyMessageLabelsPayload};

async fn messages_in_inbox(pool: &PgPool) -> Vec<Uuid> {
    sqlx::query_scalar!(
        r#"
        SELECT ml.message_id FROM email_message_labels ml
        JOIN email_labels l ON l.id = ml.label_id
        WHERE l.provider_label_id = 'INBOX'
        ORDER BY ml.message_id
        "#
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn pending_markers(pool: &PgPool) -> Vec<(Uuid, Uuid)> {
    sqlx::query!(
        "SELECT message_id, write_id FROM email_gmail_pending_label_writes ORDER BY message_id"
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|marker| (marker.message_id, marker.write_id))
    .collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("gmail_ops_label_revert"))
)]
async fn rejected_batch_reverts_and_clears_its_markers_on_every_message(pool: PgPool) {
    let link = email_db_client::links::get::fetch_link_by_id(&pool, Uuid::from_u128(0xa1))
        .await
        .unwrap()
        .unwrap();
    let batch = ModifyMessageLabelsBatchPayload {
        messages: vec![
            GmailMessageRef {
                db_message_id: Uuid::from_u128(0xa),
                provider_message_id: "msg-a".to_string(),
            },
            GmailMessageRef {
                db_message_id: Uuid::from_u128(0xb),
                provider_message_id: "msg-b".to_string(),
            },
        ],
        labels_to_add: vec![],
        labels_to_remove: vec!["INBOX".to_string()],
        pending_write_id: Some(Uuid::from_u128(0xf1)),
    };

    revert_db_changes(
        &pool,
        &link,
        &batch,
        vec![Uuid::from_u128(0xa), Uuid::from_u128(0xb)],
    )
    .await;

    assert_eq!(
        messages_in_inbox(&pool).await,
        vec![Uuid::from_u128(0xa), Uuid::from_u128(0xb)]
    );
    // B's newer write and C, which this batch did not send, keep their markers.
    assert_eq!(
        pending_markers(&pool).await,
        vec![
            (Uuid::from_u128(0xb), Uuid::from_u128(0xf2)),
            (Uuid::from_u128(0xc), Uuid::from_u128(0xf1)),
        ]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("gmail_ops_label_revert"))
)]
async fn rejected_single_message_operation_clears_its_marker(pool: PgPool) {
    let link = email_db_client::links::get::fetch_link_by_id(&pool, Uuid::from_u128(0xa1))
        .await
        .unwrap()
        .unwrap();
    let batch = ModifyMessageLabelsBatchPayload::from(ModifyMessageLabelsPayload {
        db_message_id: Uuid::from_u128(0xc),
        provider_message_id: "msg-c".to_string(),
        labels_to_add: vec![],
        labels_to_remove: vec!["INBOX".to_string()],
        pending_write_id: Some(Uuid::from_u128(0xf1)),
    });

    revert_db_changes(&pool, &link, &batch, vec![Uuid::from_u128(0xc)]).await;

    assert_eq!(messages_in_inbox(&pool).await, vec![Uuid::from_u128(0xc)]);
    assert_eq!(
        pending_markers(&pool).await,
        vec![
            (Uuid::from_u128(0xa), Uuid::from_u128(0xf1)),
            (Uuid::from_u128(0xb), Uuid::from_u128(0xf2)),
        ]
    );
}
