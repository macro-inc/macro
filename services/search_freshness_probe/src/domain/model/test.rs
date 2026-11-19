use uuid::Uuid;

use super::*;

fn id(n: u128) -> EntityId {
    EntityId(Uuid::from_u128(n))
}

fn query() -> SearchQuery {
    SearchQuery::Text {
        entity_type: EntityType::Document,
        token: Token::random(),
    }
}

#[test]
fn a_token_is_one_lowercase_word_that_differs_every_time() {
    let token = Token::random();

    assert_eq!(token.as_str().len(), TOKEN_LEN);
    assert!(token.as_str().bytes().all(|byte| byte.is_ascii_lowercase()));
    assert_ne!(token, Token::random());
}

#[test]
fn a_present_check_holds_only_when_its_entity_is_a_hit() {
    let check = Check {
        query: query(),
        entity_id: id(1),
        presence: Presence::Present,
    };

    assert!(check.holds(&[id(2), id(1)]));
    assert!(!check.holds(&[id(2)]));
    assert!(!check.holds(&[]));
}

#[test]
fn an_absent_check_holds_only_when_its_entity_is_not_a_hit() {
    let check = Check {
        query: query(),
        entity_id: id(1),
        presence: Presence::Absent,
    };

    assert!(check.holds(&[]));
    assert!(check.holds(&[id(2)]));
    assert!(!check.holds(&[id(1)]));
}

#[test]
fn tags_match_the_indexers_entity_types_and_the_monitors_outcomes() {
    assert_eq!(EntityType::AgentSession.as_str(), "agent_session");
    assert_eq!(EntityType::Message.as_str(), "message");
    assert_eq!(Operation::Delete.as_str(), "delete");
    assert_eq!(Outcome::Seen(std::time::Duration::ZERO).as_str(), "seen");
    assert_eq!(Outcome::Late(std::time::Duration::ZERO).as_str(), "late");
    assert_eq!(Outcome::WriteFailed.as_str(), "write_failed");
    assert_eq!(Outcome::SearchFailed.as_str(), "search_failed");
}

#[test]
fn only_the_probes_own_titles_count_as_probe_titles() {
    assert!(is_probe_title(MARKER));
    assert!(is_probe_title(&Token::random().title()));
    assert!(!is_probe_title("Search probe notes"));
    assert!(!is_probe_title("Search probes"));
    assert!(!is_probe_title(&format!("{} x", Token::random().title())));
    assert!(!is_probe_title("Notes on the search probe"));
}
