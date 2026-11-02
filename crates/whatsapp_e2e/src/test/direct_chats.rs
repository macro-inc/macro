//! Direct chats end to end: added from the chat list, earlier messages
//! imported from the phone, both sides live, sends from Macro, addressing by
//! phone number or LID landing in the same chat, and shared viewers reading
//! without sending.

use external_chat::domain::models::ReplyBlock;

use super::*;

/// The customer's chat in Alice's chat list, once listed.
async fn listed_customer_chat(world: &World) -> whatsapp_linked::domain::models::Chat {
    let jid = world.customer.jid().to_string();
    let chat = wait_for_rows(&world.pool, TIMEOUT, || async {
        world
            .linked
            .chats(&person(ALICE))
            .await
            .ok()?
            .chats
            .into_iter()
            .find(|chat| chat.jid == jid)
    })
    .await;
    world
        .expect(chat, "Alice's chat list has the customer's chat")
        .await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_direct_chat_imports_its_history_and_works_both_ways(pool: PgPool) {
    let world = World::new(pool).await;
    let replica = world.replica().await;
    world.pair(ALICE, &world.alice).await;
    world.pair(BOB, &world.bob).await;

    // An earlier conversation, before the chat is added.
    let question = world
        .customer
        .send_text(&world.alice.lid(), "do you ship to Lisbon?")
        .await
        .unwrap();
    world
        .alice
        .wait_for_message(TIMEOUT, |message| message.id == question)
        .await
        .expect("Alice's phone receives the question");
    let answer = world
        .alice
        .send_text(&world.customer.lid(), "yes, in three days")
        .await
        .unwrap();
    let anchored = wait_for_rows(&world.pool, TIMEOUT, || async {
        sqlx::query_scalar!(
            "SELECT 1 AS found FROM whatsapp_chat WHERE chat_jid = $1 AND anchor->>'id' = $2",
            world.customer.jid().to_string(),
            answer
        )
        .fetch_optional(&world.pool)
        .await
        .unwrap()
    })
    .await;
    world
        .expect(anchored, "the chat list knows the chat's newest message")
        .await;

    let chat = listed_customer_chat(&world).await;
    assert_eq!(
        (chat.kind, chat.can_add, chat.name.as_str()),
        (ExternalChatKind::Direct, true, "Customer")
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
    assert_eq!(binding.kind, ExternalChatKind::Direct);
    assert_eq!(world.import_history(ALICE).await, 1);
    assert_eq!(
        backfill_state(&world, &binding, &["done", "partial"])
            .await
            .0,
        "done"
    );
    let imported = wait_for_rows(&world.pool, TIMEOUT, || async {
        let stored = origins(&world.pool, binding.id).await;
        (stored.len() == 2).then_some(stored)
    })
    .await;
    assert_eq!(
        world.expect(imported, "both earlier messages land").await,
        [
            ("do you ship to Lisbon?".to_owned(), "history".to_owned()),
            ("yes, in three days".to_owned(), "history".to_owned()),
        ]
    );
    assert_eq!(world.timeline(&binding, &question).await.len(), 1);

    // Live: the customer by LID and by phone number, and Alice's phone.
    let by_lid = world
        .customer
        .send_text(&world.alice.lid(), "great, ordering now")
        .await
        .unwrap();
    let by_phone = world
        .customer
        .send_text(&world.alice.jid(), "order 1042")
        .await
        .unwrap();
    let from_phone = world
        .alice
        .send_text(&world.customer.lid(), "thanks!")
        .await
        .unwrap();
    for (source, text) in [
        (&by_lid, "great, ordering now"),
        (&by_phone, "order 1042"),
        (&from_phone, "thanks!"),
    ] {
        assert_eq!(world.timeline(&binding, source).await, [text]);
    }
    let senders = sqlx::query_scalar!(
        r#"SELECT p.user_id FROM external_chat_message m JOIN external_chat_person p ON p.id = m.person_id
        WHERE m.chat_id = $1 AND m.source_id = $2"#,
        binding.id,
        from_phone
    )
    .fetch_one(&world.pool)
    .await
    .unwrap();
    assert_eq!(
        senders.as_deref(),
        Some(ALICE),
        "Alice's own message is hers"
    );

    // From Macro.
    let send = world.send(ALICE, &binding, "it ships tomorrow").await;
    world
        .customer
        .wait_for_message(TIMEOUT, |message| {
            message.text() == Some("it ships tomorrow")
        })
        .await
        .expect("the customer's phone receives Alice's message");
    world
        .wait_send(send, &["accepted", "sent", "delivered", "read"])
        .await;

    // Shared with Bob: he reads, never sends; his account isn't in the chat.
    let mut tx = world.pool.begin().await.unwrap();
    entity_access_db_utils::direct_share::set(
        &mut tx,
        &binding.id,
        EntityType::ExternalChat,
        &BOB.to_owned().try_into().unwrap(),
        Some(AccessLevel::View),
        false,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let bobs = world
        .external
        .detail(&receipt::<ViewAccessLevel>(BOB, binding.id))
        .await
        .unwrap();
    assert_eq!(
        (bobs.chat.can_send, bobs.chat.send_reason),
        (false, Some(ReplyBlock::NotAdded))
    );
    assert!(
        world
            .external
            .send_reply(
                &receipt::<ViewAccessLevel>(BOB, binding.id),
                &SendReply {
                    idempotency_key: Uuid::now_v7(),
                    message: ReplyContent::Text {
                        text: "hi from Bob".to_owned(),
                        mentions: vec![],
                    },
                    reply_to: None,
                },
                SendAuthority::Human,
            )
            .await
            .is_err()
    );
    let read = world
        .external
        .messages(
            &receipt::<ViewAccessLevel>(BOB, binding.id),
            None,
            Some(100),
        )
        .await
        .unwrap()
        .messages;
    assert_eq!(read.len(), 6, "Bob reads the whole conversation");

    replica.drain(TIMEOUT).await.unwrap();
}
