//! The chat list: history sync, live activity, names and settings; and the
//! add/shared/can't-be-added facts of `chats`.

use super::*;
use chrono::TimeZone;

const DIRECT: &str = "15558880001@s.whatsapp.net";
const OTHER_GROUP: &str = "120363000000000002@g.us";

fn at(minute: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 1, 12, minute, 0).unwrap()
}

fn chat(jid: &str, kind: ExternalChatKind, name: Option<&str>, minute: Option<u32>) -> ChatUpdate {
    ChatUpdate {
        jid: jid.to_owned(),
        kind,
        name: name.map(str::to_owned),
        last_activity_at: minute.map(at),
        archived: None,
        pinned: None,
        anchor: minute.map(|minute| MessageAnchor {
            id: format!("3EB0{minute:04}"),
            at: at(minute),
            from_me: false,
            sender_jid: None,
        }),
        create: true,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_chat_list_merges_history_activity_and_the_roster(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    session
        .update_chats(
            alice,
            &[
                chat(DIRECT, ExternalChatKind::Direct, Some("Customer"), Some(30)),
                chat(
                    GROUP,
                    ExternalChatKind::Group,
                    Some("ignored: roster wins"),
                    Some(10),
                ),
                chat(
                    OTHER_GROUP,
                    ExternalChatKind::Group,
                    Some("Old group"),
                    Some(20),
                ),
            ],
        )
        .await
        .unwrap();
    // Older activity never moves a chat back; a name-only update never adds one.
    session
        .update_chats(
            alice,
            &[
                chat(DIRECT, ExternalChatKind::Direct, None, Some(5)),
                ChatUpdate {
                    archived: Some(true),
                    ..chat(OTHER_GROUP, ExternalChatKind::Group, None, None)
                },
                ChatUpdate {
                    create: false,
                    ..chat(
                        "15559990000@s.whatsapp.net",
                        ExternalChatKind::Direct,
                        Some("Stranger"),
                        None,
                    )
                },
            ],
        )
        .await
        .unwrap();

    let chats = linked.whatsapp.chats(&person(ALICE)).await.unwrap().chats;
    let summary: Vec<_> = chats
        .iter()
        .map(|chat| {
            (
                chat.jid.as_str(),
                chat.kind,
                chat.name.as_str(),
                chat.archived,
                chat.can_add,
                chat.cannot_add_reason,
                chat.added.as_ref().map(|group| group.id),
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            (
                DIRECT,
                ExternalChatKind::Direct,
                "Customer",
                false,
                true,
                None,
                None
            ),
            (
                OTHER_GROUP,
                ExternalChatKind::Group,
                "Old group",
                true,
                false,
                Some(CannotAdd::NotInGroup),
                None
            ),
            (
                GROUP,
                ExternalChatKind::Group,
                "Customer escalations",
                false,
                false,
                None,
                Some(binding.id)
            ),
        ]
    );
    assert_eq!(chats[0].last_activity_at, Some(at(30)));
    let anchor = sqlx::query_scalar!(
        "SELECT anchor->>'id' FROM whatsapp_chat WHERE chat_jid = $1",
        DIRECT
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        anchor.as_deref(),
        Some("3EB00030"),
        "the newest message stays the anchor"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_adoption_backfills_from_the_chat_anchor_page_by_page(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    let state = || async {
        sqlx::query_scalar!(
            "SELECT backfill_state FROM external_chat WHERE id = $1",
            binding.id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    };
    assert_eq!(
        state().await.as_deref(),
        Some("waiting_for_message"),
        "no message known yet: waits for one"
    );
    session
        .update_chats(
            alice,
            &[chat(GROUP, ExternalChatKind::Group, Some("Renamed"), None)],
        )
        .await
        .unwrap();
    assert_eq!(
        state().await.as_deref(),
        Some("waiting_for_message"),
        "a rename is no message to start from"
    );
    session
        .update_chats(
            alice,
            &[chat(GROUP, ExternalChatKind::Group, None, Some(40))],
        )
        .await
        .unwrap();
    assert_eq!(
        state().await.as_deref(),
        Some("waiting_for_phone"),
        "the chat's first message makes it importable, but the phone is only asked on the owner's Import"
    );
    assert!(session.backfill_work(alice).await.unwrap().is_empty());
    assert_eq!(
        linked
            .whatsapp
            .import_history(&person(ALICE), SendAuthority::UserApiToken)
            .await
            .unwrap_err()
            .current_context(),
        &ExternalChatError::Forbidden
    );
    assert_eq!(
        linked
            .whatsapp
            .import_history(&person(ALICE), SendAuthority::Human)
            .await
            .unwrap()
            .started,
        1
    );
    let work = session.backfill_work(alice).await.unwrap();
    assert_eq!(
        (
            work[0].state,
            work[0].anchor.as_ref().map(|anchor| anchor.id.as_str())
        ),
        (BackfillState::Pending, Some("3EB00040"))
    );

    session.backfill_requested(alice, binding.id).await.unwrap();
    session
        .backfill_unanswered(alice, binding.id)
        .await
        .unwrap();
    assert_eq!(
        state().await.as_deref(),
        Some("waiting_for_phone"),
        "an unanswered request waits for the owner, not a timer"
    );
    assert!(session.backfill_work(alice).await.unwrap().is_empty());
    linked
        .whatsapp
        .import_history(&person(ALICE), SendAuthority::Human)
        .await
        .unwrap();

    let page = |messages, oldest: u32, complete| HistoryPage {
        chat_jid: GROUP.to_owned(),
        messages,
        oldest: Some(MessageAnchor {
            id: format!("3EB0{oldest:04}"),
            at: at(oldest),
            from_me: false,
            sender_jid: None,
        }),
        complete,
    };
    assert_eq!(
        session
            .backfill_page(alice, &page(50, 20, false))
            .await
            .unwrap(),
        [(binding.id, BackfillState::Running)]
    );
    let work = session.backfill_work(alice).await.unwrap();
    assert_eq!(
        (
            work[0].imported,
            work[0].requested_at,
            work[0].cursor.as_ref().map(|c| c.id.as_str())
        ),
        (50, None, Some("3EB00020")),
        "ready for the next page, before the oldest imported"
    );
    assert_eq!(
        session
            .backfill_page(alice, &page(7, 1, true))
            .await
            .unwrap(),
        [(binding.id, BackfillState::Done)]
    );
    assert!(session.backfill_work(alice).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_chat_without_a_listed_message_starts_from_its_newest_stored_one(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    // Stored live, but the chat list never heard of it.
    session
        .ingest_event(alice, &text(1, CUSTOMER_JID, "3EB0CAFE", "hello"))
        .await
        .unwrap();
    linked
        .whatsapp
        .import_history(&person(ALICE), SendAuthority::Human)
        .await
        .unwrap();
    let work = session.backfill_work(alice).await.unwrap();
    assert_eq!(work[0].state, BackfillState::Pending);
    let anchor = work[0]
        .anchor
        .clone()
        .expect("the stored message anchors it");
    assert_eq!(
        (
            anchor.id.as_str(),
            anchor.from_me,
            anchor.sender_jid.as_deref()
        ),
        ("3EB0CAFE", false, Some(CUSTOMER_JID))
    );
    session.backfill_requested(alice, binding.id).await.unwrap();
    assert_eq!(
        session.backfill_work(alice).await.unwrap()[0].state,
        BackfillState::Running
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn ending_consent_forgets_the_old_numbers_chat_list(pool: PgPool) {
    let (linked, session, _, _, alice, _) = adopted(&pool).await;
    session
        .update_chats(
            alice,
            &[chat(
                DIRECT,
                ExternalChatKind::Direct,
                Some("Customer"),
                Some(30),
            )],
        )
        .await
        .unwrap();
    let stored = |pool: PgPool| async move {
        sqlx::query_scalar!(
            r#"SELECT (SELECT count(*) FROM whatsapp_chat WHERE account_id = $1)
                + (SELECT count(*) FROM whatsapp_roster WHERE account_id = $1) AS "count!""#,
            alice.account_id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    };
    assert!(stored(pool.clone()).await > 0);
    let account = linked
        .whatsapp
        .account(&person(ALICE))
        .await
        .unwrap()
        .unwrap();
    linked
        .whatsapp
        .disconnect(
            &person(ALICE),
            account.authorization_generation,
            SendAuthority::Human,
        )
        .await
        .unwrap();
    assert_eq!(stored(pool.clone()).await, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_batch_may_name_a_chat_twice(pool: PgPool) {
    let (linked, session, _, _, alice, _) = adopted(&pool).await;
    let mut renamed = chat(
        DIRECT,
        ExternalChatKind::Direct,
        Some("Customer (work)"),
        Some(10),
    );
    renamed.create = false;
    session
        .update_chats(
            alice,
            &[
                chat(DIRECT, ExternalChatKind::Direct, Some("Customer"), Some(40)),
                renamed,
                chat(DIRECT, ExternalChatKind::Direct, None, Some(20)),
            ],
        )
        .await
        .unwrap();
    let listed = linked.whatsapp.chats(&person(ALICE)).await.unwrap().chats;
    let direct = listed.iter().find(|chat| chat.jid == DIRECT).unwrap();
    assert_eq!(
        (direct.name.as_str(), direct.last_activity_at),
        ("Customer (work)", Some(at(40)))
    );
    let anchor = sqlx::query_scalar!(
        r#"SELECT anchor->>'id' AS "id!" FROM whatsapp_chat WHERE account_id = $1 AND chat_jid = $2"#,
        alice.account_id,
        DIRECT
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(anchor, "3EB00040");
}
