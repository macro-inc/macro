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
    assert_eq!(Operation::CrowdedPrefix.as_str(), "crowded_prefix");
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

#[test]
fn a_crowded_prefix_is_a_short_lowercase_word_that_can_be_searched_as_a_prefix() {
    assert!(CrowdedPrefix::new("con").is_ok());
    assert!(CrowdedPrefix::new("co").is_err(), "searched exactly");
    assert!(CrowdedPrefix::new("Con").is_err());
    assert!(CrowdedPrefix::new("con.").is_err());
    assert!(
        CrowdedPrefix::new("constructio").is_err(),
        "no room for the nonce"
    );
}

#[test]
fn a_late_word_starts_with_its_prefix_and_sorts_after_common_words() {
    let prefix = CrowdedPrefix::new("con").expect("a prefix");

    let word = Token::after(&prefix);

    assert_eq!(word.as_str().len(), TOKEN_LEN);
    assert!(word.as_str().starts_with("conzz"));
    assert!(word.as_str().bytes().all(|byte| byte.is_ascii_lowercase()));
    assert!(word.as_str() > "conversation" && word.as_str() > "conz");
    assert_ne!(word, Token::after(&prefix));
}
