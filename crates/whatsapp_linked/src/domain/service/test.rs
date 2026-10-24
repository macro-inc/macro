use super::*;
use chrono::Duration;

fn account(state: AccountState) -> Account {
    Account {
        id: Uuid::from_u128(1),
        user_id: "macro|alice@example.com".into(),
        identity_jid: Some("15550000001@s.whatsapp.net".into()),
        state,
        authorization_generation: 3,
    }
}

fn binding(state: BindingState, ownership_state: OwnershipState) -> Binding {
    Binding {
        id: Uuid::from_u128(2),
        team_id: Uuid::from_u128(3),
        group_jid: "120363000000000001@g.us".into(),
        user_id: "macro|alice@example.com".into(),
        state,
        ownership_state,
        adopted_at: Utc::now(),
    }
}

fn facts(observed_at: DateTime<Utc>) -> SendingFacts {
    SendingFacts {
        observing: true,
        remote_member: true,
        can_post: true,
        observed_at: Some(observed_at),
    }
}

const ON: Features = Features {
    pairing: true,
    adoption: true,
    sending: true,
};

#[test]
fn reply_block_names_the_first_missing_fact() {
    let now = Utc::now();
    let active = binding(BindingState::Active, OwnershipState::Active);
    let connected = account(AccountState::Connected);
    assert_eq!(
        reply_block(ON, Some(&connected), &active, Some(&facts(now)), now),
        None
    );
    assert_eq!(
        reply_block(
            Features::default(),
            Some(&connected),
            &active,
            Some(&facts(now)),
            now
        ),
        Some(ReplyBlock::SendingDisabled)
    );
    assert_eq!(
        reply_block(ON, None, &active, None, now),
        Some(ReplyBlock::NoAccount)
    );
    assert_eq!(
        reply_block(
            ON,
            Some(&account(AccountState::LoggedOut)),
            &active,
            None,
            now
        ),
        Some(ReplyBlock::Disconnected)
    );
    assert_eq!(
        reply_block(
            ON,
            Some(&connected),
            &binding(BindingState::Active, OwnershipState::TransferRequired),
            Some(&facts(now)),
            now
        ),
        Some(ReplyBlock::GroupUnavailable)
    );
    assert_eq!(
        reply_block(ON, Some(&connected), &active, None, now),
        Some(ReplyBlock::NotObserving)
    );
    let mut announce = facts(now);
    announce.can_post = false;
    assert_eq!(
        reply_block(ON, Some(&connected), &active, Some(&announce), now),
        Some(ReplyBlock::NotAllowedInGroup)
    );
    assert_eq!(
        reply_block(
            ON,
            Some(&connected),
            &active,
            Some(&facts(now - Duration::minutes(5))),
            now
        ),
        Some(ReplyBlock::Refreshing)
    );
}

#[test]
fn requests_are_bounded_and_operations_carry_the_right_text() {
    let key = Uuid::from_u128(9);
    let message = Uuid::from_u128(10);
    let valid = [
        ReplyContent::Text { text: "hi".into() },
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
        validate_request(&SendReply {
            idempotency_key: key,
            message: content,
            reply_to: None,
        })
        .unwrap();
    }
    let invalid = [
        ReplyContent::Text { text: "  ".into() },
        ReplyContent::Text {
            text: "x".repeat(TEXT_LIMIT_BYTES + 1),
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
            validate_request(&SendReply {
                idempotency_key: key,
                message: content,
                reply_to: None,
            })
            .is_err()
        );
    }
    assert!(
        validate_request(&SendReply {
            idempotency_key: Uuid::nil(),
            message: ReplyContent::Text { text: "hi".into() },
            reply_to: None,
        })
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
        LinkedError::Forbidden
    ));
    authorize_mutation(Mutation::Reaction, &mine, "15550000002@s.whatsapp.net", now).unwrap();
    let old = MutationTarget {
        source_at: now - Duration::minutes(11),
        ..mine
    };
    assert!(authorize_mutation(Mutation::Edit, &old, identity, now).is_err());
}

#[test]
fn group_jids_are_validated_by_shape() {
    assert!(is_group_jid("120363000000000001@g.us"));
    assert!(is_group_jid("15551234567-1600000000@g.us"));
    assert!(!is_group_jid("15551234567@s.whatsapp.net"));
    assert!(!is_group_jid("@g.us"));
    assert!(!is_group_jid("abc@g.us"));
}
