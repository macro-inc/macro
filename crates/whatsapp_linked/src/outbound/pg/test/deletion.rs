//! Deleting a Macro user removes their WhatsApp data and leaves others' intact.
use super::*;

fn text_reply(text: &str) -> SendReply {
    SendReply {
        idempotency_key: Uuid::now_v7(),
        message: ReplyContent::Text {
            text: text.into(),
            mentions: vec![],
        },
        reply_to: None,
    }
}

/// Rows still stored for a chat, by table.
async fn remaining(pool: &PgPool, group: Uuid) -> [i64; 6] {
    sqlx::query!(
        r#"SELECT
            (SELECT count(*) FROM external_chat WHERE id = $1) AS "groups!",
            (SELECT count(*) FROM external_chat_message WHERE chat_id = $1) AS "messages!",
            (SELECT count(*) FROM external_chat_person WHERE chat_id = $1) AS "people!",
            (SELECT count(*) FROM whatsapp_send WHERE chat_id = $1) AS "sends!",
            (SELECT count(*) FROM entity_access WHERE entity_id = $1) AS "grants!",
            (SELECT count(*) FROM entity WHERE id = $1) AS "entities!""#,
        group
    )
    .fetch_one(pool)
    .await
    .map(|row| {
        [
            row.groups,
            row.messages,
            row.people,
            row.sends,
            row.grants,
            row.entities,
        ]
    })
    .unwrap()
}

async fn aliases(pool: &PgPool, group: Uuid) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM whatsapp_identity_alias WHERE chat_id = $1"#,
        group
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_people_who_sent_removes_their_whatsapp_data(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    session
        .ingest_event(alice, &text(1, CUSTOMER_JID, "FIRST", "hello"))
        .await
        .unwrap();
    for (user, text) in [(ALICE, "from alice"), (BOB, "from bob")] {
        linked
            .chats
            .send_reply(
                &receipt::<MessageWrite>(user, binding.id),
                &text_reply(text),
                SendAuthority::Human,
            )
            .await
            .unwrap();
    }

    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, BOB)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        remaining(&pool, binding.id).await[3],
        1,
        "only the deleted sender's send goes"
    );
    let permission = sqlx::query_scalar!(
        "SELECT share_permission_id FROM external_chat WHERE id = $1",
        binding.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, ALICE)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(remaining(&pool, binding.id).await, [0; 6]);
    let sharing = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM "SharePermission" WHERE id = $1"#,
        permission
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(sharing, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_alias_outlives_the_account_that_saw_it(pool: PgPool) {
    let (_, session, _, binding, _, bob) = adopted(&pool).await;
    session
        .ingest_event(bob, &text(1, CUSTOMER_JID, "SEEN", "hello"))
        .await
        .unwrap();
    let before = aliases(&pool, binding.id).await;
    assert!(before > 0);
    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, BOB)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(aliases(&pool, binding.id).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn receipts_are_stored_once_per_message_and_expire(pool: PgPool) {
    use crate::domain::{
        events::{Receipt, ReceiptState},
        ports::AccountRepository,
    };
    let (_, session, repository, binding, alice, _) = adopted(&pool).await;
    let receipt = InboundEvent {
        event_id: Uuid::from_u128(77),
        group_jid: GROUP.into(),
        chat_alternate_jid: None,
        source_at: Utc::now() - Duration::days(31),
        observed_at: Utc::now(),
        kind: InboundKind::Receipt(Receipt {
            source_ids: vec!["A".into(), "B".into(), "A".into()],
            participant_jid: CUSTOMER_JID.into(),
            state: ReceiptState::Read,
        }),
    };
    assert_eq!(
        session.ingest_event(alice, &receipt).await.unwrap(),
        IngestOutcome::Applied
    );
    let stored = sqlx::query_scalar!(
        r#"SELECT receipt_state FROM whatsapp_participant_receipt WHERE chat_id = $1 ORDER BY source_id"#,
        binding.id
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(stored, vec!["read", "read"]);
    repository.expire_retained().await.unwrap();
    let left = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM whatsapp_participant_receipt WHERE chat_id = $1"#,
        binding.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(left, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_the_owners_session_stops_syncing_a_chat(pool: PgPool) {
    let (linked, _, _, binding, _, _) = adopted(&pool).await;
    for (user, authority) in [
        (ALICE, SendAuthority::UserApiToken),
        (ALICE, SendAuthority::Automation),
        (BOB, SendAuthority::Human),
    ] {
        let error = linked
            .chats
            .detach(&receipt::<MessageView>(user, binding.id), authority)
            .await
            .unwrap_err();
        assert_eq!(error.current_context(), &ExternalChatError::Forbidden);
    }
    linked
        .chats
        .detach(
            &receipt::<MessageView>(ALICE, binding.id),
            SendAuthority::Human,
        )
        .await
        .unwrap();
    use external_chat::domain::ports::ChatRepository;
    assert_eq!(
        linked.store.chat(binding.id).await.unwrap().unwrap().state,
        ChatState::Detached
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn consumed_pairings_are_pruned_after_a_day(pool: PgPool) {
    use crate::domain::ports::AccountRepository;
    let (_, _, repository, _, alice, _) = adopted(&pool).await;
    let pairings = |pool: PgPool| async move {
        sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM whatsapp_pairing WHERE account_id = $1"#,
            alice.account_id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    };
    assert_eq!(pairings(pool.clone()).await, 1);
    repository.expire_retained().await.unwrap();
    assert_eq!(pairings(pool.clone()).await, 1, "a fresh pairing stays");
    sqlx::query!(
        "UPDATE whatsapp_pairing SET consumed_at = now() - interval '2 days' WHERE account_id = $1",
        alice.account_id
    )
    .execute(&pool)
    .await
    .unwrap();
    repository.expire_retained().await.unwrap();
    assert_eq!(pairings(pool.clone()).await, 0);
}
