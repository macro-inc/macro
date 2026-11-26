//! The provider envelope and owner-facing contacts must use the same stable order.
use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn frozen_envelope_and_each_recipient_read_use_the_same_order(pool: Pool<Postgres>) {
    let link = Uuid::from_u128(0xaaaaaaaa_aaaa_aaaa_aaaa_aaaaaaaaaaaa);
    let message = Uuid::from_u128(0xee000002_0000_0000_0000_000000000002);
    let first = Uuid::from_u128(1);
    let second = Uuid::from_u128(2);
    let mut tx = pool.begin().await.unwrap();
    // The old unspecified order happens to agree under the fixture's index
    // plan. Exercise a heap plan too: correctness must survive a planner change.
    // These transaction-local runtime settings never affect SQLx preparation.
    sqlx::query!("SET LOCAL enable_indexscan = off")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query!("SET LOCAL enable_bitmapscan = off")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            provider = 'OUTLOOK'
        WHERE
            id = $1
        "#,
        link
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        DELETE FROM
            email_message_recipients
        WHERE
            message_id = $1
        "#,
        message
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_contacts (id, link_id, email_address)
        VALUES
            ($2, $3, 'second@example.com'),
            ($1, $3, 'first@example.com')
        "#,
        first,
        second,
        link
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    // Physical insertion order deliberately differs from recipient contact-id order.
    sqlx::query!(
        r#"
        INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
        VALUES
            ($3, $2, 'TO'),
            ($3, $1, 'TO')
        "#,
        first,
        second,
        message
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    let single = email_db_client::contacts::get::fetch_db_recipients(&mut *tx, message)
        .await
        .unwrap();
    assert_eq!(
        single
            .iter()
            .map(|(contact, _)| contact.email_address.as_deref())
            .collect::<Vec<_>>(),
        [Some("first@example.com"), Some("second@example.com")]
    );
    let bulk = email_db_client::contacts::get::fetch_db_recipients_in_bulk(&mut *tx, &[message])
        .await
        .unwrap();
    assert_eq!(
        bulk[&message]
            .iter()
            .map(|(contact, _)| contact.email_address.as_deref())
            .collect::<Vec<_>>(),
        [Some("first@example.com"), Some("second@example.com")]
    );
    let actor = sqlx::query_scalar!(
        r#"
        SELECT
            macro_id
        FROM
            email_links
        WHERE
            id = $1
        "#,
        link
    )
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    super::super::draft::snapshot_outlook_draft(&mut tx, message, link, &actor)
        .await
        .unwrap();
    let payload = sqlx::query_scalar!(
        r#"
        SELECT
            desired_content
        FROM
            email_mailbox_drafts
        WHERE
            message_id = $1
        "#,
        message
    )
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    assert_eq!(
        payload["to"]
            .as_array()
            .unwrap()
            .iter()
            .map(|contact| contact["email"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["first@example.com", "second@example.com"]
    );
    tx.rollback().await.unwrap();
}
