//! The chat list: history sync, live activity, names and settings; and the
//! add/shared/can't-be-added facts of `chats`.

use super::*;
use chrono::TimeZone;

const DIRECT: &str = "15558880001@s.whatsapp.net";
const OTHER_GROUP: &str = "120363000000000002@g.us";

fn at(minute: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 1, 12, minute, 0).unwrap()
}

fn chat(jid: &str, kind: ChatKind, name: Option<&str>, minute: Option<u32>) -> ChatUpdate {
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
                chat(DIRECT, ChatKind::Direct, Some("Customer"), Some(30)),
                chat(
                    GROUP,
                    ChatKind::Group,
                    Some("ignored: roster wins"),
                    Some(10),
                ),
                chat(OTHER_GROUP, ChatKind::Group, Some("Old group"), Some(20)),
            ],
        )
        .await
        .unwrap();
    // Older activity never moves a chat back; a name-only update never adds one.
    session
        .update_chats(
            alice,
            &[
                chat(DIRECT, ChatKind::Direct, None, Some(5)),
                ChatUpdate {
                    archived: Some(true),
                    ..chat(OTHER_GROUP, ChatKind::Group, None, None)
                },
                ChatUpdate {
                    create: false,
                    ..chat(
                        "15559990000@s.whatsapp.net",
                        ChatKind::Direct,
                        Some("Stranger"),
                        None,
                    )
                },
            ],
        )
        .await
        .unwrap();

    let chats = linked.chats(ALICE).await.unwrap().chats;
    let summary: Vec<_> = chats
        .iter()
        .map(|chat| {
            (
                chat.jid.as_str(),
                chat.kind,
                chat.name.as_str(),
                chat.archived,
                chat.can_add,
                chat.cannot_add_reason.as_deref(),
                chat.group.as_ref().map(|group| group.id),
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            (
                DIRECT,
                ChatKind::Direct,
                "Customer",
                false,
                false,
                Some(cannot_add::DIRECT),
                None
            ),
            (
                OTHER_GROUP,
                ChatKind::Group,
                "Old group",
                true,
                false,
                Some(cannot_add::NOT_IN_GROUP),
                None
            ),
            (
                GROUP,
                ChatKind::Group,
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
    let (_, session, _, binding, alice, _) = adopted(&pool).await;
    let work = session.backfill_work(alice).await.unwrap();
    assert_eq!(work.len(), 1);
    assert_eq!(
        (
            work[0].state,
            work[0].anchor.clone(),
            work[0].cursor.clone()
        ),
        (BackfillState::Pending, None, None),
        "no message seen yet: waits for one"
    );
    session
        .update_chats(alice, &[chat(GROUP, ChatKind::Group, None, Some(40))])
        .await
        .unwrap();
    let work = session.backfill_work(alice).await.unwrap();
    assert_eq!(
        work[0].anchor.as_ref().map(|anchor| anchor.id.as_str()),
        Some("3EB00040")
    );

    session.backfill_requested(alice, binding.id).await.unwrap();
    session
        .backfill_unanswered(alice, binding.id)
        .await
        .unwrap();
    let work = session.backfill_work(alice).await.unwrap();
    assert_eq!(work[0].state, BackfillState::WaitingForPhone);

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
