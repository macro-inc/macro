//! `external_chat_changed` signals: only for real changes, and to the right scope.
use super::*;
use external_chat::signals::{self as signals, Change, ChangeSignal};
use sqlx::postgres::PgListener;

async fn listen(pool: &PgPool) -> PgListener {
    let mut listener = PgListener::connect_with(pool).await.unwrap();
    listener.listen(signals::CHANGED).await.unwrap();
    listener
}

async fn next(listener: &mut PgListener) -> Change {
    let notification = listener.recv().await.unwrap();
    ChangeSignal::parse(notification.payload()).unwrap().change
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rosters_signal_only_real_changes_and_rename_the_owners_group(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    let mut listener = listen(&pool).await;
    let mut info = group(&[ALICE_JID, BOB_JID, CUSTOMER_JID]);
    session
        .update_groups(alice, std::slice::from_ref(&info), true)
        .await
        .unwrap();
    info.name = "Escalations, renamed".into();
    info.observed_at = Utc::now();
    session.update_group(alice, &info).await.unwrap();
    assert_eq!(
        next(&mut listener).await,
        Change::Chats {
            account_id: alice.account_id
        },
        "an unchanged refresh signals nothing; the rename comes first"
    );
    assert_eq!(
        next(&mut listener).await,
        Change::Chat {
            chat_id: binding.id
        }
    );
    let detail = linked
        .chats
        .detail(&receipt::<MessageView>(ALICE, binding.id))
        .await
        .unwrap();
    assert_eq!(detail.chat.name, "Escalations, renamed");
    assert!(detail.chat.can_send);

    session.group_left(alice, GROUP, Utc::now()).await.unwrap();
    assert_eq!(
        next(&mut listener).await,
        Change::Chats {
            account_id: alice.account_id
        }
    );
    assert_eq!(
        next(&mut listener).await,
        Change::Chat {
            chat_id: binding.id
        }
    );
    assert!(
        linked
            .whatsapp
            .chats(&person(ALICE))
            .await
            .unwrap()
            .chats
            .iter()
            .all(|chat| !chat.can_add)
    );
    let detail = linked
        .chats
        .detail(&receipt::<MessageView>(ALICE, binding.id))
        .await
        .unwrap();
    assert_eq!(detail.chat.send_reason, Some(ReplyBlock::NotAdded));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn messages_and_send_outcomes_signal_their_group(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    let mut listener = listen(&pool).await;
    session
        .ingest_event(alice, &text(30, CUSTOMER_JID, "3EB0PUSH", "hello"))
        .await
        .unwrap();
    assert_eq!(
        next(&mut listener).await,
        Change::Chat {
            chat_id: binding.id
        }
    );
    let progress = linked
        .chats
        .send_reply(
            &receipt::<MessageWrite>(ALICE, binding.id),
            &SendReply {
                idempotency_key: Uuid::now_v7(),
                message: ReplyContent::Text {
                    text: "hi".into(),
                    mentions: vec![],
                },
                reply_to: None,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    session.claim_sends(alice, 8).await.unwrap();
    session
        .begin_dispatch(alice, progress.id, "3EB0REJECTED")
        .await
        .unwrap();
    session
        .record_send_outcome(
            alice,
            progress.id,
            SendOutcome::Rejected {
                code: "not_in_group".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        next(&mut listener).await,
        Change::Chat {
            chat_id: binding.id
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_retried_send_returns_the_original_whatever_happened_since(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    let request = SendReply {
        idempotency_key: Uuid::now_v7(),
        message: ReplyContent::Text {
            text: "once".into(),
            mentions: vec![],
        },
        reply_to: None,
    };
    let access = receipt::<MessageWrite>(ALICE, binding.id);
    let original = linked
        .chats
        .send_reply(&access, &request, SendAuthority::Human)
        .await
        .unwrap();
    session.claim_sends(alice, 8).await.unwrap();
    session
        .begin_dispatch(alice, original.id, "3EB0ONCE")
        .await
        .unwrap();
    session
        .record_send_outcome(alice, original.id, SendOutcome::Unknown)
        .await
        .unwrap();
    // Alice is no longer in the group: a new send would be refused.
    session.group_left(alice, GROUP, Utc::now()).await.unwrap();
    let retried = linked
        .chats
        .send_reply(&access, &request, SendAuthority::Human)
        .await
        .unwrap();
    assert_eq!(retried.id, original.id);
    assert_eq!(retried.state, DeliveryState::Unknown);
    assert!(session.claim_sends(alice, 8).await.unwrap().is_empty());
    let changed = SendReply {
        message: ReplyContent::Text {
            text: "twice".into(),
            mentions: vec![],
        },
        ..request
    };
    assert_eq!(
        linked
            .chats
            .send_reply(&access, &changed, SendAuthority::Human)
            .await
            .unwrap_err()
            .current_context(),
        &ExternalChatError::Conflict
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn change_audiences_come_from_the_store(pool: PgPool) {
    use external_chat::domain::ports::{AudienceRepository, MessageNotice};
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    assert_eq!(
        linked
            .whatsapp
            .account_owner(alice.account_id)
            .await
            .unwrap(),
        Some(ALICE.to_owned())
    );
    session
        .ingest_event(alice, &text(1, CUSTOMER_JID, "NOTICE", "hello"))
        .await
        .unwrap();
    let message = linked
        .chats
        .messages(&receipt::<MessageView>(ALICE, binding.id), None, Some(1))
        .await
        .unwrap()
        .messages[0]
        .id;
    let stored = sqlx::query_scalar!(
        r#"SELECT message_id AS "id!" FROM external_chat_message WHERE id = $1"#,
        message
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        linked
            .store
            .message_notice(binding.id, stored)
            .await
            .unwrap(),
        Some(MessageNotice {
            provider: ExternalChatProvider::WhatsApp,
            chat_name: "Customer escalations".into(),
            superseded: false,
        })
    );
    assert!(
        linked
            .store
            .link_viewers(binding.id)
            .await
            .unwrap()
            .is_empty()
    );
}
