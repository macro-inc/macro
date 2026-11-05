use super::*;
use crate::domain::{ports::SendRepository, provider::WhatsAppProvider};
use external_chat::domain::ports::{ChatProvider, SendIntent};
use tokio::sync::Barrier;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sends_and_roster_refreshes_share_a_consistent_lock_order(pool: PgPool) {
    let (_, session, repository, binding, alice, _) = adopted(&pool).await;
    let account = WhatsAppProvider::new(repository.clone())
        .account(&person(ALICE))
        .await
        .unwrap()
        .unwrap();
    let barrier = Barrier::new(2);
    let sends = async {
        for index in 0..64 {
            let request = SendReply {
                idempotency_key: Uuid::now_v7(),
                message: ReplyContent::Text {
                    text: format!("Concurrent send {index}"),
                    mentions: vec![],
                },
                reply_to: None,
            };
            barrier.wait().await;
            repository
                .enqueue(SendIntent {
                    user: &person(ALICE),
                    account: &account,
                    chat: &binding,
                    request: &request,
                    digest: [index; 32],
                })
                .await
                .unwrap();
        }
    };
    let refreshes = async {
        for _ in 0..64 {
            let info = group(&[ALICE_JID, BOB_JID, CUSTOMER_JID]);
            barrier.wait().await;
            session.update_groups(alice, &[info], true).await.unwrap();
        }
    };
    tokio::join!(sends, refreshes);
    let claimed = session.claim_sends(alice, 64).await.unwrap();
    assert_eq!(claimed.len(), 64);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn observers_can_refresh_groups_in_opposite_orders(pool: PgPool) {
    let (linked, session, _, _, alice, bob) = adopted(&pool).await;
    let first = group(&[ALICE_JID, BOB_JID, CUSTOMER_JID]);
    let mut second = first.clone();
    second.jid = "120363000000000002@g.us".into();
    session
        .update_groups(alice, &[first.clone(), second.clone()], true)
        .await
        .unwrap();
    linked
        .chats
        .add(
            &person(ALICE),
            &AddChat {
                provider: ExternalChatProvider::WhatsApp,
                remote_id: second.jid.clone(),
                kind: ExternalChatKind::Group,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let barrier = Barrier::new(2);
    let alice_refresh = async {
        for _ in 0..32 {
            barrier.wait().await;
            session
                .update_groups(alice, &[first.clone(), second.clone()], true)
                .await
                .unwrap();
        }
    };
    let bob_refresh = async {
        for _ in 0..32 {
            barrier.wait().await;
            session
                .update_groups(bob, &[second.clone(), first.clone()], true)
                .await
                .unwrap();
        }
    };
    tokio::join!(alice_refresh, bob_refresh);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn adding_a_group_waits_for_its_first_message_in_flight(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let alice = pair(&linked, &session, ALICE, ALICE_JID).await;
    let info = group(&[ALICE_JID, CUSTOMER_JID]);
    session
        .update_groups(alice, std::slice::from_ref(&info), true)
        .await
        .unwrap();
    // The replica records the group's first message, not yet committed.
    let mut tx = pool.begin().await.unwrap();
    let account = fence_in(&mut tx, alice).await.unwrap();
    super::super::chats::update_chats_in(
        &mut tx,
        &account,
        &[ChatUpdate {
            jid: GROUP.to_owned(),
            kind: ExternalChatKind::Group,
            name: None,
            last_activity_at: Some(Utc::now()),
            archived: None,
            pinned: None,
            anchor: Some(MessageAnchor {
                id: "3EB0F157".to_owned(),
                at: Utc::now(),
                from_me: false,
                sender_jid: None,
            }),
            create: true,
        }],
    )
    .await
    .unwrap();
    let add = AddChat {
        provider: ExternalChatProvider::WhatsApp,
        remote_id: GROUP.into(),
        kind: ExternalChatKind::Group,
    };
    let alice_user = person(ALICE);
    let adding = linked.chats.add(&alice_user, &add, SendAuthority::Human);
    tokio::pin!(adding);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(500), &mut adding)
            .await
            .is_err(),
        "adding waits for the message instead of missing it"
    );
    tx.commit().await.unwrap();
    let binding = adding.await.unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT backfill_state FROM external_chat WHERE id = $1",
            binding.id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .as_deref(),
        Some("waiting_for_phone")
    );
}
