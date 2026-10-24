//! Direct chats: added from the chat list like groups, both sides of the
//! conversation kept, named after the person, sent to only by the owner.

use super::*;

fn customer_chat(name: &str) -> ChatUpdate {
    ChatUpdate {
        jid: CUSTOMER_JID.to_owned(),
        kind: ChatKind::Direct,
        name: Some(name.to_owned()),
        last_activity_at: Some(Utc::now()),
        archived: None,
        pinned: None,
        anchor: None,
        create: true,
    }
}

fn direct_text(event: u128, sender: &str, from_me: bool, source: &str, body: &str) -> InboundEvent {
    let mut event = text(event, sender, source, body);
    event.group_jid = CUSTOMER_JID.into();
    if let InboundKind::Message(message) = &mut event.kind {
        message.from_me = from_me;
    }
    event
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_direct_chat_is_added_kept_and_sent_to_only_by_its_owner(pool: PgPool) {
    workspace(&pool).await;
    let (linked, session, _) = services(&pool);
    let alice = pair(&linked, &session, ALICE, ALICE_JID).await;
    let bob = pair(&linked, &session, BOB, BOB_JID).await;
    session
        .update_chats(alice, &[customer_chat("Customer")])
        .await
        .unwrap();
    // Bob talks to the same person in his own chat.
    session
        .update_chats(bob, &[customer_chat("Customer")])
        .await
        .unwrap();

    let listed = linked.chats(ALICE).await.unwrap().chats;
    let chat = listed.iter().find(|chat| chat.jid == CUSTOMER_JID).unwrap();
    assert_eq!(
        (chat.kind, chat.can_add, chat.cannot_add_reason.as_deref()),
        (ChatKind::Direct, true, None)
    );
    let own = AdoptGroup {
        group_jid: ALICE_JID.into(),
    };
    assert!(matches!(
        linked
            .adopt(ALICE, &own, SendAuthority::Human)
            .await
            .unwrap_err()
            .current_context(),
        LinkedError::Invalid(reason) if *reason == cannot_add::OWN_CHAT
    ));
    let request = AdoptGroup {
        group_jid: CUSTOMER_JID.into(),
    };
    let binding = linked
        .adopt(ALICE, &request, SendAuthority::Human)
        .await
        .unwrap();
    assert_eq!(binding.kind, ChatKind::Direct);
    assert_eq!(
        linked
            .adopt(ALICE, &request, SendAuthority::Human)
            .await
            .unwrap()
            .id,
        binding.id,
        "adding it again returns the same chat"
    );

    let detail = linked
        .group_detail(&receipt::<MessageView>(ALICE, binding.id))
        .await
        .unwrap();
    assert_eq!(
        (
            detail.group.kind,
            detail.group.name.as_str(),
            detail.group.can_send
        ),
        (ChatKind::Direct, "Customer", true)
    );
    assert_eq!(detail.roster, None);
    let bobs_list = linked.chats(BOB).await.unwrap().chats;
    let bobs = bobs_list
        .iter()
        .find(|chat| chat.jid == CUSTOMER_JID)
        .unwrap();
    assert_eq!(
        (bobs.can_add, bobs.shared.is_none()),
        (true, true),
        "Alice's chat with the customer is not Bob's"
    );

    // Both sides of the conversation land.
    for event in [
        direct_text(1, CUSTOMER_JID, false, "3EB0HELLO", "hi, is my order out?"),
        direct_text(2, ALICE_JID, true, "3EB0REPLY", "shipping today"),
    ] {
        assert_eq!(
            session.ingest_event(alice, &event).await.unwrap(),
            IngestOutcome::Applied
        );
    }
    let messages = linked
        .messages(&receipt::<MessageView>(ALICE, binding.id), None, 10)
        .await
        .unwrap()
        .messages;
    let shown: Vec<(&str, Option<&str>)> = messages
        .iter()
        .map(|message| (message.body.as_str(), message.sender.user_id.as_deref()))
        .collect();
    assert_eq!(
        shown,
        [
            ("shipping today", Some(ALICE)),
            ("hi, is my order out?", None)
        ]
    );
    // Bob's account is not in Alice's chat: nothing it sees reaches it.
    assert_eq!(
        session
            .ingest_event(
                bob,
                &direct_text(3, CUSTOMER_JID, false, "3EB0BOB", "for Bob")
            )
            .await
            .unwrap(),
        IngestOutcome::NotObserved
    );

    // Shared with Bob: he reads, never sends.
    let mut tx = pool.begin().await.unwrap();
    entity_access_db_utils::direct_share::set(
        &mut tx,
        &binding.id,
        EntityType::WhatsAppGroup,
        &BOB.to_owned().try_into().unwrap(),
        Some(AccessLevel::View),
        false,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    session.update_groups(bob, &[], true).await.unwrap();
    let bobs_view = linked
        .group_detail(&receipt::<MessageView>(BOB, binding.id))
        .await
        .unwrap();
    assert_eq!(
        (bobs_view.group.can_send, bobs_view.group.send_reason),
        (false, Some(ReplyBlock::NotObserving))
    );
    let send = |user: &'static str| SendReply {
        idempotency_key: Uuid::now_v7(),
        message: ReplyContent::Text {
            text: format!("from {user}"),
            mentions: vec![],
        },
        reply_to: None,
    };
    assert!(
        linked
            .send_reply(
                &receipt::<MessageWrite>(BOB, binding.id),
                &send(BOB),
                SendAuthority::Human
            )
            .await
            .is_err()
    );
    linked
        .send_reply(
            &receipt::<MessageWrite>(ALICE, binding.id),
            &send(ALICE),
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let claimed = session.claim_sends(alice, 8).await.unwrap();
    assert_eq!(
        claimed
            .iter()
            .map(|send| send.group_jid.as_str())
            .collect::<Vec<_>>(),
        [CUSTOMER_JID]
    );

    // The chat follows the person's name, and the owner's next full refresh
    // keeps observing it.
    session
        .update_chats(alice, &[customer_chat("Customer (Acme)")])
        .await
        .unwrap();
    session.update_groups(alice, &[], true).await.unwrap();
    assert_eq!(
        linked
            .group_detail(&receipt::<MessageView>(ALICE, binding.id))
            .await
            .unwrap()
            .group
            .name,
        "Customer (Acme)"
    );
    assert_eq!(
        session
            .ingest_event(
                alice,
                &direct_text(4, CUSTOMER_JID, false, "3EB0LATER", "thanks!")
            )
            .await
            .unwrap(),
        IngestOutcome::Applied
    );
}
