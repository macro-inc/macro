use super::*;

#[test]
fn login_inputs_are_checked_and_normalized_for_their_step() {
    assert_eq!(
        validate_input(
            LoginStepName::EmailCode,
            LoginInput::Code {
                code: " abc-123 ".to_owned()
            }
        )
        .unwrap(),
        LoginInput::Code {
            code: "ABC123".to_owned()
        }
    );
    assert!(
        validate_input(
            LoginStepName::EmailCode,
            LoginInput::Code {
                code: "abc-12".to_owned()
            }
        )
        .is_err()
    );
    assert!(
        validate_input(
            LoginStepName::TwoFactor,
            LoginInput::Code {
                code: "123456".to_owned()
            }
        )
        .is_err()
    );
    assert_eq!(
        validate_input(
            LoginStepName::PickWorkspaces,
            LoginInput::Workspaces {
                team_ids: vec![
                    "T0BBBBBBB".to_owned(),
                    "T0AAAAAAA".to_owned(),
                    "T0BBBBBBB".to_owned()
                ]
            }
        )
        .unwrap(),
        LoginInput::Workspaces {
            team_ids: vec!["T0AAAAAAA".to_owned(), "T0BBBBBBB".to_owned()]
        }
    );
}

#[test]
fn a_channel_seen_from_two_workspaces_is_one_conversation_named_with_a_hash() {
    let user = MacroUserIdStr::parse_from_str("macro|ana@example.com").unwrap();
    let entry = |account: u128, member: bool| CatalogueEntry {
        account_id: Uuid::from_u128(account),
        conversation_id: "C0SHARED12".to_owned(),
        kind: ExternalChatKind::Group,
        name: "launch".to_owned(),
        topic: None,
        is_private: false,
        is_archived: false,
        is_member: member,
        frozen_reason: None,
        connected_teams: vec![],
        direct_person: None,
        last_activity_at: None,
        unread_count: account as u32,
    };
    let conversations = merge_catalogue(&user, vec![entry(1, false), entry(2, true)], &[]);
    assert_eq!(conversations.len(), 1);
    assert_eq!(conversations[0].name, "#launch");
    assert_eq!(
        conversations[0].accounts,
        vec![Uuid::from_u128(2), Uuid::from_u128(1)]
    );
    assert_eq!(conversations[0].unread_count, 2);
    assert!(conversations[0].can_add);
}
