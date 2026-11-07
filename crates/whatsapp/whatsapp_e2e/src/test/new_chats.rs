//! Starting a chat with someone never written to: their number looked up,
//! the chat added and messaged first from Macro, and their answer by LID
//! landing in the same chat.

use whatsapp_linked::domain::models::{Lookup, LookupState};

use super::*;

/// The lookup once WhatsApp answered it.
async fn answered(world: &World, lookup: &Lookup) -> Lookup {
    let answered = wait_for_rows(&world.pool, TIMEOUT, || async {
        let read = world
            .linked
            .lookup_state(&person(ALICE), lookup.id, SendAuthority::Human)
            .await
            .unwrap();
        (read.state != LookupState::Pending).then_some(read)
    })
    .await;
    world.expect(answered, "WhatsApp answers the lookup").await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_looked_up_number_is_added_messaged_and_answers_in_the_same_chat(pool: PgPool) {
    let world = World::new(pool).await;
    let replica = world.replica().await;
    world.pair(ALICE, &world.alice).await;
    // In no group with Alice and never written to.
    let dana = world.whatsapp.add_user("15557770001", "Dana").await;
    let phone = format!("+{}", dana.phone());

    let lookup = world
        .linked
        .lookup(&person(ALICE), &phone, SendAuthority::Human)
        .await
        .unwrap();
    let found = answered(&world, &lookup).await;
    assert_eq!(
        (found.state, found.chat_jid.clone()),
        (LookupState::Found, Some(dana.jid().to_string()))
    );
    let nobody = world
        .linked
        .lookup(&person(ALICE), "+5550009", SendAuthority::Human)
        .await
        .unwrap();
    assert_eq!(
        answered(&world, &nobody).await.state,
        LookupState::NotOnWhatsApp
    );

    let listed = world.linked.chats(&person(ALICE)).await.unwrap().chats;
    let chat = listed
        .iter()
        .find(|chat| Some(&chat.jid) == found.chat_jid.as_ref())
        .expect("the found number is in the chat list");
    assert_eq!(
        (
            chat.kind,
            chat.name.as_str(),
            chat.phone_number.as_deref(),
            chat.last_activity_at,
            chat.can_add
        ),
        (
            ExternalChatKind::Direct,
            phone.as_str(),
            Some(phone.as_str()),
            None,
            true
        )
    );
    let binding = world
        .external
        .add(
            &person(ALICE),
            &AddChat {
                provider: ExternalChatProvider::WhatsApp,
                remote_id: chat.jid.clone(),
                kind: ExternalChatKind::Direct,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    assert_eq!(
        backfill_state(
            &world,
            &binding,
            &["done", "waiting_for_message", "pending"]
        )
        .await
        .0,
        "done",
        "nothing was ever written, so there is nothing to wait for"
    );

    // The first message ever: the client fetches Dana's devices and keys.
    let send = world.send(ALICE, &binding, "hi Dana, it's Alice").await;
    dana.wait_for_message(TIMEOUT, |message| {
        message.text() == Some("hi Dana, it's Alice")
    })
    .await
    .expect("Dana's phone receives Alice's first message");
    world
        .wait_send(send, &["accepted", "sent", "delivered", "read"])
        .await;

    let reply = dana
        .send_text(&world.alice.lid(), "hi Alice!")
        .await
        .unwrap();
    assert_eq!(world.timeline(&binding, &reply).await, ["hi Alice!"]);
    let direct_chats = sqlx::query_scalar!(
        r#"SELECT c.chat_jid FROM whatsapp_chat c JOIN whatsapp_linked_account a ON a.id = c.account_id
        WHERE a.user_id = $1 AND c.kind = 'direct'"#,
        ALICE
    )
    .fetch_all(&world.pool)
    .await
    .unwrap();
    assert_eq!(
        direct_chats,
        [dana.jid().to_string()],
        "Dana's LID is the same person, not a second chat"
    );
    let added = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM external_chat WHERE user_id = $1 AND kind = 'direct'"#,
        ALICE
    )
    .fetch_one(&world.pool)
    .await
    .unwrap();
    assert_eq!(added, 1);

    replica.drain(TIMEOUT).await.unwrap();
}
