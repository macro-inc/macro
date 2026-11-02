use super::*;
use chrono::Duration;

fn account(connected: bool) -> AccountRef {
    AccountRef {
        id: Uuid::from_u128(1),
        user_id: "macro|alice@example.com".into(),
        identity: Some("15550000001@s.whatsapp.net".into()),
        connected,
        generation: 3,
    }
}

fn chat(state: ChatState) -> ChatRef {
    ChatRef {
        kind: ExternalChatKind::Group,
        id: Uuid::from_u128(2),
        provider: ExternalChatProvider::WhatsApp,
        remote_id: "120363000000000001@g.us".into(),
        user_id: "macro|alice@example.com".into(),
        state,
        adopted_at: Utc::now(),
    }
}

fn facts() -> SendingFacts {
    SendingFacts {
        observing: true,
        remote_member: true,
        can_post: true,
    }
}

fn no_mentions(_: &str, mentions: &[String]) -> ExternalChatResult<()> {
    assert!(mentions.is_empty());
    Ok(())
}

#[test]
fn reply_block_names_the_first_missing_fact() {
    let active = chat(ChatState::Active);
    let connected = account(true);
    assert_eq!(reply_block(Some(&connected), &active, Some(&facts())), None);
    assert_eq!(
        reply_block(None, &active, None),
        Some(ReplyBlock::NoAccount)
    );
    assert_eq!(
        reply_block(Some(&account(false)), &active, None),
        Some(ReplyBlock::Disconnected)
    );
    assert_eq!(
        reply_block(Some(&connected), &chat(ChatState::Detached), Some(&facts())),
        Some(ReplyBlock::Unavailable)
    );
    assert_eq!(
        reply_block(Some(&connected), &active, None),
        Some(ReplyBlock::NotAdded)
    );
    let mut announce = facts();
    announce.can_post = false;
    assert_eq!(
        reply_block(Some(&connected), &active, Some(&announce)),
        Some(ReplyBlock::NotAllowed)
    );
}

#[test]
fn requests_are_bounded_and_operations_carry_the_right_text() {
    let key = Uuid::from_u128(9);
    let message = Uuid::from_u128(10);
    let valid = [
        ReplyContent::Text {
            text: "hi".into(),
            mentions: vec![],
        },
        ReplyContent::Mutation {
            message_id: message,
            operation: Mutation::Reaction,
            text: Some(String::new()),
        },
        ReplyContent::Mutation {
            message_id: message,
            operation: Mutation::Edit,
            text: Some("fixed".into()),
        },
        ReplyContent::Mutation {
            message_id: message,
            operation: Mutation::Delete,
            text: None,
        },
    ];
    for content in valid {
        validate_request(
            &SendReply {
                idempotency_key: key,
                message: content,
                reply_to: None,
            },
            no_mentions,
        )
        .unwrap();
    }
    let invalid = [
        ReplyContent::Text {
            text: "  ".into(),
            mentions: vec![],
        },
        ReplyContent::Text {
            text: "x".repeat(TEXT_LIMIT_BYTES + 1),
            mentions: vec![],
        },
        ReplyContent::Mutation {
            message_id: message,
            operation: Mutation::Delete,
            text: Some("not allowed".into()),
        },
        ReplyContent::Mutation {
            message_id: message,
            operation: Mutation::Edit,
            text: None,
        },
    ];
    for content in invalid {
        assert!(
            validate_request(
                &SendReply {
                    idempotency_key: key,
                    message: content,
                    reply_to: None,
                },
                no_mentions
            )
            .is_err()
        );
    }
    assert!(
        validate_request(
            &SendReply {
                idempotency_key: Uuid::nil(),
                message: ReplyContent::Text {
                    text: "hi".into(),
                    mentions: vec![]
                },
                reply_to: None,
            },
            no_mentions
        )
        .is_err()
    );
}

#[test]
fn only_the_author_changes_a_recent_message() {
    let now = Utc::now();
    let mine = MutationTarget {
        source_at: now - Duration::minutes(1),
        sent_by: vec!["15550000001@s.whatsapp.net".into(), "42@lid".into()],
        deleted: false,
    };
    let identity = "15550000001@s.whatsapp.net";
    authorize_mutation(Mutation::Edit, &mine, identity, now).unwrap();
    authorize_mutation(Mutation::Delete, &mine, identity, now).unwrap();
    assert!(matches!(
        authorize_mutation(Mutation::Edit, &mine, "15550000002@s.whatsapp.net", now)
            .unwrap_err()
            .current_context(),
        ExternalChatError::Forbidden
    ));
    authorize_mutation(Mutation::Reaction, &mine, "15550000002@s.whatsapp.net", now).unwrap();
    let old = MutationTarget {
        source_at: now - Duration::minutes(11),
        ..mine
    };
    assert!(authorize_mutation(Mutation::Edit, &old, identity, now).is_err());
}
