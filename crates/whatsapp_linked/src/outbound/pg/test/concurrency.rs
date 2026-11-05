use super::*;
use crate::domain::{ports::SendRepository, provider::WhatsAppProvider};
use external_chat::domain::ports::{ChatProvider, SendIntent};
use std::sync::atomic::{AtomicBool, Ordering};
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

/// A chat-list update carrying `group`'s first message.
fn first_message(group: &str) -> crate::domain::events::ChatUpdate {
    crate::domain::events::ChatUpdate {
        jid: group.to_owned(),
        kind: ExternalChatKind::Group,
        name: None,
        last_activity_at: Some(Utc::now()),
        archived: None,
        pinned: None,
        anchor: Some(MessageAnchor {
            id: "3EB0FIRST".to_owned(),
            at: Utc::now(),
            from_me: false,
            sender_jid: None,
        }),
        create: true,
    }
}

async fn backfill_state_of(pool: &PgPool, chat: Uuid) -> Option<String> {
    sqlx::query_scalar!(
        "SELECT backfill_state FROM external_chat WHERE id = $1",
        chat
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_group_added_while_its_first_message_is_recorded_can_import(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let alice = pair(&linked, &session, ALICE, ALICE_JID).await;
    session
        .update_groups(alice, &[group(&[ALICE_JID, CUSTOMER_JID])], true)
        .await
        .unwrap();

    // The replica has written the first message and has not committed yet.
    let mut recording = pool.begin().await.unwrap();
    let fenced = fence_in(&mut recording, alice).await.unwrap();
    crate::outbound::pg::chats::update_chats_in(&mut recording, &fenced, &[first_message(GROUP)])
        .await
        .unwrap();

    let added = AtomicBool::new(false);
    let add = async {
        let binding = linked
            .chats
            .add(
                &person(ALICE),
                &AddChat {
                    provider: ExternalChatProvider::WhatsApp,
                    remote_id: GROUP.into(),
                    kind: ExternalChatKind::Group,
                },
                SendAuthority::Human,
            )
            .await
            .unwrap();
        added.store(true, Ordering::SeqCst);
        binding
    };
    // Commit once the add has finished without seeing the message, or is
    // waiting on the replica's transaction.
    let commit = async {
        loop {
            let waiting = sqlx::query_scalar!(
                r#"SELECT count(*) AS "count!" FROM pg_stat_activity
                WHERE datname = current_database() AND wait_event_type = 'Lock'"#
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            if waiting > 0 || added.load(Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        recording.commit().await.unwrap();
    };
    let (binding, ()) = tokio::join!(add, commit);
    assert_eq!(
        backfill_state_of(&pool, binding.id).await.as_deref(),
        Some("waiting_for_phone"),
        "the first message makes the chat importable"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn groups_added_as_their_first_messages_arrive_can_all_import(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let alice = pair(&linked, &session, ALICE, ALICE_JID).await;
    let groups: Vec<GroupInfo> = (0..64)
        .map(|index| {
            let mut info = group(&[ALICE_JID, CUSTOMER_JID]);
            info.jid = format!("1203630000{index:08}@g.us");
            info
        })
        .collect();
    session.update_groups(alice, &groups, true).await.unwrap();

    let barrier = Barrier::new(2);
    for info in &groups {
        let add = async {
            barrier.wait().await;
            linked
                .chats
                .add(
                    &person(ALICE),
                    &AddChat {
                        provider: ExternalChatProvider::WhatsApp,
                        remote_id: info.jid.clone(),
                        kind: ExternalChatKind::Group,
                    },
                    SendAuthority::Human,
                )
                .await
                .unwrap()
        };
        let record = async {
            barrier.wait().await;
            session
                .update_chats(alice, &[first_message(&info.jid)])
                .await
                .unwrap();
        };
        let (binding, ()) = tokio::join!(add, record);
        assert_eq!(
            backfill_state_of(&pool, binding.id).await.as_deref(),
            Some("waiting_for_phone"),
            "{} missed its first message",
            info.jid
        );
    }
}
