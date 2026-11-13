use super::*;
use crate::domain::models::{PrincipalKind, StreamPrincipal};
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashSet;

fn principal(kind: PrincipalKind) -> StreamPrincipal {
    StreamPrincipal {
        kind,
        credential_id: "test".to_owned(),
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|reader@example.com")
        .unwrap()
        .into_owned()
}

#[test]
fn every_name_is_registered_once_under_its_family() {
    let mut seen = HashSet::new();
    for entry in CATALOG {
        assert!(seen.insert(entry.name), "{} registered twice", entry.name);
        assert!(
            entry.name.split_once('.').is_some(),
            "{} has no family",
            entry.name
        );
        assert!(!entry.entity_types.is_empty());
        assert!(!entry.audience.is_empty());
    }
}

#[test]
fn an_account_manager_sees_no_webhook_lifecycle() {
    let visible = visible_to(
        &principal(PrincipalKind::AccountManager { user: user() }),
        true,
    );

    assert!(
        visible
            .iter()
            .all(|entry| !entry.name.starts_with("webhook."))
    );
    assert!(visible.iter().any(|entry| entry.name == "document.updated"));
}

#[test]
fn a_bot_its_user_does_not_own_sees_no_purely_personal_events() {
    let bot = principal(PrincipalKind::Bot {
        bot_id: uuid::Uuid::from_u128(1),
        user: user(),
        owned_by_user: false,
    });

    let visible = visible_to(&bot, true);

    assert!(visible.iter().all(|entry| entry.name != "call.ringing"));
    assert!(
        visible
            .iter()
            .any(|entry| entry.name == "agent_session.deleted"),
        "owner or entity"
    );
}
