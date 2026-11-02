//! Starting a direct chat with someone not in the chat list: saved contacts
//! listed without activity, and phone-number lookups answered by the session.

use super::*;
use crate::domain::{
    jid::PhoneNumber,
    models::{LOOKUP_LIMIT, LookupState},
};
use chrono::DurationRound;
use external_chat::signals::{self as signals, ChangeSignal};
use sqlx::postgres::PgListener;

// Short numbers (still E.164), so they never read as anyone's real number.
const CUSTOMER: &str = "+5550001";
const DANA: &str = "+5550002";
const STRANGER: &str = "+5550003";
const LATE: &str = "+5550004";

fn contact(jid: &str, name: &str) -> ChatUpdate {
    ChatUpdate {
        jid: jid.to_owned(),
        kind: ExternalChatKind::Direct,
        name: Some(name.to_owned()),
        last_activity_at: None,
        archived: None,
        pinned: None,
        anchor: None,
        create: true,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lookups_need_a_valid_number_a_person_and_stay_within_the_budget(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let alice = pair(&linked, &session, ALICE, ALICE_JID).await;
    let lookup = |phone: &'static str| {
        let whatsapp = linked.whatsapp.clone();
        async move {
            whatsapp
                .lookup(&person(ALICE), phone, SendAuthority::Human)
                .await
        }
    };

    for invalid in ["5550002", "+555 0002", "+0555000", "+12"] {
        assert!(matches!(
            lookup(invalid).await.unwrap_err().current_context(),
            ExternalChatError::Invalid(_)
        ));
    }
    assert_eq!(
        linked
            .whatsapp
            .lookup(&person(ALICE), DANA, SendAuthority::UserApiToken)
            .await
            .unwrap_err()
            .current_context(),
        &ExternalChatError::Forbidden,
        "only the owner's own action looks numbers up"
    );
    assert_eq!(
        linked
            .whatsapp
            .lookup(&person(BOB), DANA, SendAuthority::Human)
            .await
            .unwrap_err()
            .current_context(),
        &ExternalChatError::Disconnected
    );

    let first = lookup(DANA).await.unwrap();
    assert_eq!(
        (first.phone_number.as_str(), first.state, first.chat_jid),
        (DANA, LookupState::Pending, None)
    );
    assert_eq!(
        lookup(DANA).await.unwrap().id,
        first.id,
        "asking again while pending joins the same lookup"
    );
    assert_eq!(
        session
            .pending_lookups(alice)
            .await
            .unwrap()
            .into_iter()
            .map(|work| (work.id, work.phone_number.as_str().to_owned()))
            .collect::<Vec<_>>(),
        [(first.id, DANA.to_owned())]
    );
    assert_eq!(
        linked
            .whatsapp
            .lookup_state(&person(BOB), first.id, SendAuthority::Human)
            .await
            .unwrap_err()
            .current_context(),
        &ExternalChatError::NotFound,
        "another person's lookup is not theirs to read"
    );

    for number in 1..LOOKUP_LIMIT {
        let phone = format!("+556{number:04}");
        linked
            .whatsapp
            .lookup(&person(ALICE), &phone, SendAuthority::Human)
            .await
            .unwrap();
    }
    assert_eq!(
        lookup(STRANGER).await.unwrap_err().current_context(),
        &ExternalChatError::RateLimited
    );
    // An hour later the budget is back, and the old lookups are deleted.
    sqlx::query!("UPDATE whatsapp_lookup SET created_at = now() - interval '61 minutes'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        linked.whatsapp.expire_retained().await.unwrap(),
        u64::try_from(LOOKUP_LIMIT).unwrap()
    );
    assert_eq!(lookup(STRANGER).await.unwrap().state, LookupState::Pending);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_found_number_joins_the_chat_list_without_clobbering_it(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let alice = pair(&linked, &session, ALICE, ALICE_JID).await;
    let customer_jid = PhoneNumber::parse(CUSTOMER).unwrap().jid();
    let dana_jid = PhoneNumber::parse(DANA).unwrap().jid();
    let activity = Utc::now().duration_trunc(Duration::seconds(1)).unwrap() - Duration::days(1);
    session
        .update_chats(
            alice,
            &[ChatUpdate {
                last_activity_at: Some(activity),
                ..contact(&customer_jid, "Customer")
            }],
        )
        .await
        .unwrap();
    let start = |phone: &'static str| {
        let whatsapp = linked.whatsapp.clone();
        async move {
            whatsapp
                .lookup(&person(ALICE), phone, SendAuthority::Human)
                .await
                .unwrap()
        }
    };
    let known = start(CUSTOMER).await;
    let dana = start(DANA).await;
    let stranger = start(STRANGER).await;
    let late = start(LATE).await;
    session
        .complete_lookup(
            alice,
            known.id,
            &LookupAnswer::Found {
                jid: customer_jid.clone(),
                name: None,
            },
        )
        .await
        .unwrap();
    session
        .complete_lookup(
            alice,
            dana.id,
            &LookupAnswer::Found {
                jid: dana_jid.clone(),
                name: Some("Dana".to_owned()),
            },
        )
        .await
        .unwrap();
    session
        .complete_lookup(alice, stranger.id, &LookupAnswer::NotOnWhatsApp)
        .await
        .unwrap();
    // WhatsApp answered after the person stopped waiting: it stays failed.
    sqlx::query!(
        "UPDATE whatsapp_lookup SET created_at = now() - interval '2 minutes' WHERE id = $1",
        late.id
    )
    .execute(&pool)
    .await
    .unwrap();
    session
        .complete_lookup(alice, late.id, &LookupAnswer::NotOnWhatsApp)
        .await
        .unwrap();
    // A redelivered answer changes nothing.
    session
        .complete_lookup(alice, stranger.id, &LookupAnswer::Failed)
        .await
        .unwrap();
    assert!(matches!(
        session
            .complete_lookup(
                alice,
                stranger.id,
                &LookupAnswer::Found {
                    jid: "987654321@lid".to_owned(),
                    name: None,
                },
            )
            .await
            .unwrap_err()
            .current_context(),
        ExternalChatError::Invalid(_)
    ));

    let states = |lookup: Uuid| {
        let whatsapp = linked.whatsapp.clone();
        async move {
            let read = whatsapp
                .lookup_state(&person(ALICE), lookup, SendAuthority::Human)
                .await
                .unwrap();
            (read.state, read.chat_jid)
        }
    };
    assert_eq!(
        states(known.id).await,
        (LookupState::Found, Some(customer_jid.clone()))
    );
    assert_eq!(
        states(dana.id).await,
        (LookupState::Found, Some(dana_jid.clone()))
    );
    assert_eq!(
        states(stranger.id).await,
        (LookupState::NotOnWhatsApp, None)
    );
    assert_eq!(states(late.id).await, (LookupState::Failed, None));
    assert!(session.pending_lookups(alice).await.unwrap().is_empty());

    let listed = linked.whatsapp.chats(&person(ALICE)).await.unwrap().chats;
    let summary: Vec<_> = listed
        .iter()
        .map(|chat| {
            (
                chat.jid.as_str(),
                chat.name.as_str(),
                chat.phone_number.as_deref(),
                chat.last_activity_at,
                chat.can_add,
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            (
                customer_jid.as_str(),
                "Customer",
                Some(CUSTOMER),
                Some(activity),
                true
            ),
            (dana_jid.as_str(), "Dana", Some(DANA), None, true),
        ],
        "a lookup without a name keeps the stored name and activity"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_contact_added_before_anyone_wrote_has_nothing_to_import(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let alice = pair(&linked, &session, ALICE, ALICE_JID).await;
    let dana_jid = PhoneNumber::parse(DANA).unwrap().jid();
    let mut listener = PgListener::connect_with(&pool).await.unwrap();
    listener.listen(signals::CHANGED).await.unwrap();
    session
        .update_chats(alice, &[contact(&dana_jid, "Dana")])
        .await
        .unwrap();
    // The same address book again changes nothing; a rename does.
    session
        .update_chats(alice, &[contact(&dana_jid, "Dana")])
        .await
        .unwrap();
    session
        .update_chats(alice, &[contact(&dana_jid, "Dana Smith")])
        .await
        .unwrap();
    for _ in 0..2 {
        let notification = listener.recv().await.unwrap();
        assert_eq!(
            ChangeSignal::parse(notification.payload()).unwrap().change,
            Change::Chats {
                account_id: alice.account_id
            }
        );
    }

    let added = linked
        .chats
        .add(
            &person(ALICE),
            &AddChat {
                provider: ExternalChatProvider::WhatsApp,
                remote_id: dana_jid.clone(),
                kind: ExternalChatKind::Direct,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let name = sqlx::query_scalar!("SELECT name FROM external_chat WHERE id = $1", added.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(name, "Dana Smith");
    assert!(
        session.backfill_work(alice).await.unwrap().is_empty(),
        "nobody wrote yet, so there is nothing to wait for"
    );
    let state = || async {
        sqlx::query_scalar!(
            "SELECT backfill_state FROM external_chat WHERE id = $1",
            added.id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    };
    assert_eq!(state().await.as_deref(), Some("done"));

    let anchored = |minutes: i64| ChatUpdate {
        anchor: Some(MessageAnchor {
            id: format!("3EB0{minutes:04}"),
            at: Utc::now() + Duration::minutes(minutes),
            from_me: false,
            sender_jid: None,
        }),
        ..contact(&dana_jid, "Dana Smith")
    };
    session.update_chats(alice, &[anchored(5)]).await.unwrap();
    assert_eq!(
        state().await.as_deref(),
        Some("done"),
        "a message after adding arrives live; nothing to import"
    );
    sqlx::query!(
        "UPDATE whatsapp_chat SET anchor = NULL WHERE chat_jid = $1",
        dana_jid
    )
    .execute(&pool)
    .await
    .unwrap();
    session.update_chats(alice, &[anchored(-60)]).await.unwrap();
    assert_eq!(
        state().await.as_deref(),
        Some("waiting_for_phone"),
        "a message from before adding means the phone has earlier history, for the owner to import"
    );
}
