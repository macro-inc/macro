use super::*;

#[derive(Clone, Copy, Debug)]
enum Mutation {
    Post,
    Edit,
    React,
    Delete,
    Typing,
}

#[tokio::test]
async fn committed_channel_sequences_reach_existing_message_events() {
    for channel in [true, false] {
        for mutation in [
            Mutation::Post,
            Mutation::Edit,
            Mutation::React,
            Mutation::Delete,
            Mutation::Typing,
        ] {
            let mut repo = fixture();
            if channel {
                repo.message.parent = MessageParent::Channel(Uuid::from_u128(20));
            }
            repo.mutation_seq = Some(42);
            // Document roots delete the whole discussion; use a reply here to
            // exercise the same single-message deletion event as channels.
            let target = if !channel && matches!(mutation, Mutation::Delete) {
                let reply = reply_from(&repo.message, 2, "macro|author@example.com");
                let id = reply.id;
                repo.replies.push(reply);
                id
            } else {
                repo.message.id
            };
            let events = Events::default();
            let service = MessageService::new(repo, events.clone());
            let receipt = if channel {
                channel_access()
            } else {
                access("macro|author@example.com", "doc", AccessLevel::Comment)
            };
            match mutation {
                Mutation::Post => {
                    service.post(receipt, post_input()).await.unwrap();
                }
                Mutation::Edit => {
                    service
                        .patch(
                            receipt,
                            target,
                            MessagePatch {
                                content: Some("edited".into()),
                                ..Default::default()
                            },
                        )
                        .await
                        .unwrap();
                }
                Mutation::React => {
                    service
                        .react(receipt, target, "👍".into(), true, None)
                        .await
                        .unwrap();
                }
                Mutation::Delete => {
                    service.delete(receipt, target, None).await.unwrap();
                }
                Mutation::Typing => {
                    service.typing(receipt, None, true, None).await.unwrap();
                }
            }

            let events = events.0.lock().unwrap();
            assert_eq!(events.len(), 1, "{mutation:?}");
            let event = &events[0];
            assert!(matches!(
                (mutation, &event.change),
                (Mutation::Post, MessageChange::Posted { .. })
                    | (Mutation::Edit, MessageChange::Edited { .. })
                    | (Mutation::React, MessageChange::ReactionChanged { .. })
                    | (Mutation::Delete, MessageChange::MessageDeleted { .. })
                    | (Mutation::Typing, MessageChange::Typing { .. })
            ));
            let expected = if channel && !matches!(mutation, Mutation::Typing) {
                Some(42)
            } else {
                None
            };
            assert_eq!(event.seq, expected, "{mutation:?}");
            // This is the object passed to the existing message_update
            // transport. The sequence remains top-level and optional.
            let payload = serde_json::to_value(event).unwrap();
            match expected {
                Some(seq) => assert_eq!(payload["seq"], seq),
                None => assert!(payload.get("seq").is_none()),
            }
        }
    }
}

#[tokio::test]
async fn unchanged_channel_reactions_publish_no_sequence_or_event() {
    let mut repo = fixture();
    repo.message.parent = MessageParent::Channel(Uuid::from_u128(20));
    repo.reaction_changed = false;
    repo.mutation_seq = Some(42);
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    service
        .react(channel_access(), repo.message.id, "👍".into(), true, None)
        .await
        .unwrap();
    assert!(events.0.lock().unwrap().is_empty());
}
