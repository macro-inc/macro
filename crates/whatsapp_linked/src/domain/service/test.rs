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
        group_jid: "120363000000000001@g.us".into(),
        user_id: "macro|alice@example.com".into(),
        state,
        ownership_state,
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

const ON: Features = Features {
    pairing: true,
    adoption: true,
    sending: true,
};

#[test]
fn reply_block_names_the_first_missing_fact() {
    let active = binding(BindingState::Active, OwnershipState::Active);
    let connected = account(AccountState::Connected);
    assert_eq!(
        reply_block(ON, Some(&connected), &active, Some(&facts())),
        None
    );
    assert_eq!(
        reply_block(
            Features::default(),
            Some(&connected),
            &active,
            Some(&facts())
        ),
        Some(ReplyBlock::SendingDisabled)
    );
    assert_eq!(
        reply_block(ON, None, &active, None),
        Some(ReplyBlock::NoAccount)
    );
    assert_eq!(
        reply_block(ON, Some(&account(AccountState::LoggedOut)), &active, None),
        Some(ReplyBlock::Disconnected)
    );
    assert_eq!(
        reply_block(
            ON,
            Some(&connected),
            &binding(BindingState::Active, OwnershipState::TransferRequired),
            Some(&facts())
        ),
        Some(ReplyBlock::GroupUnavailable)
    );
    assert_eq!(
        reply_block(ON, Some(&connected), &active, None),
        Some(ReplyBlock::NotObserving)
    );
    let mut announce = facts();
    announce.can_post = false;
    assert_eq!(
        reply_block(ON, Some(&connected), &active, Some(&announce)),
        Some(ReplyBlock::NotAllowedInGroup)
    );
}

#[test]
fn unnamed_groups_are_called_after_their_other_members() {
    let me = "15550000001@s.whatsapp.net";
    let person = |jid: &str, name: Option<&str>| Participant {
        identity: Identity {
            jid: jid.into(),
            alternate_jid: None,
            display_name: name.map(Into::into),
        },
        admin: false,
    };
    let mut group = GroupInfo {
        jid: "120363000000000001@g.us".into(),
        name: "  ".into(),
        participants: vec![
            person(me, Some("Me")),
            person("15550000002@s.whatsapp.net", Some("Ana")),
            person("15550000003@s.whatsapp.net", None),
            person("15550000004@s.whatsapp.net", Some("Cy")),
            person("99@lid", None),
        ],
        announce: false,
        disappearing: false,
        community: false,
        observed_at: Utc::now(),
        group: None,
        shared: None,
    };
    assert_eq!(group.display_name(me), "Ana, +15550000003, +2");
    group.participants.truncate(3);
    assert_eq!(group.display_name(me), "Ana, +15550000003");
    group.participants.truncate(1);
    assert_eq!(group.display_name(me), "WhatsApp group");
    group.name = "Family".into();
    assert_eq!(group.display_name(me), "Family");
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
        validate_request(&SendReply {
            idempotency_key: key,
            message: content,
            reply_to: None,
        })
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
            message: ReplyContent::Text {
                text: "hi".into(),
                mentions: vec![]
            },
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
